#!/usr/bin/env node
'use strict';

// Builds dist/nj, the one executable file that ships (§ 3), from nj and lib/.
// Node built-ins only -- no dependency at build time either.
//
//   node tools/build.js           write dist/nj
//   node tools/build.js --check   build in memory; exit 1 unless dist/nj is
//                                 byte-identical (a stale bundle is caught)
//
// WHAT IS GUARANTEED. For every source the build ACCEPTS, the bundle behaves
// like Node's own CommonJS loader running the sources:
//   - each module is its source file verbatim inside a function, so it keeps
//     its own scope and decides its own strictness ('use strict' or not) --
//     the bundle adds no file-wide directive;
//   - `this` at module top level is module.exports;
//   - a module is evaluated on its first require and cached; if it throws
//     while loading, the cache entry is dropped, so the next require evaluates
//     it again and throws again, as in Node;
//   - cycles see the partially filled exports, as in Node.
// Everything the wrapper does NOT reproduce is REFUSED at build time (exit 2)
// instead of emulated:
//   - __filename, __dirname, `arguments` (Node's wrapper takes five
//     parameters, this one three), require.main/resolve/cache, and
//     module.parent/id/filename/paths/children/loaded;
//   - any use of `require` that is not a direct call `require('...')` -- an
//     alias, `require (`, require.call, require[...] -- and any require whose
//     argument is not a string literal;
//   - relative requires of anything but an existing .js file (no .json, no
//     directories, no extension guessing).
// The checks are textual: a match inside a comment or a string also refuses
// the build. That is deliberate -- a false refusal is loud, a missed one ships.
// Each module is compiled on its own as the wrapper's function body before it
// goes in, so no source can close its wrapper and open another. Finally the
// finished bundle is compiled with vm.Script; output that does not parse is
// never written and never passes --check.
//
// Deterministic: the entry first, then modules sorted by path; no timestamps,
// no absolute paths. A fresh build of an unchanged tree is byte-identical.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'nj';
const OUT = path.join(ROOT, 'dist', 'nj');

function fail(msg) {
  process.stderr.write(`build: ${msg}\n`);
  process.exit(2);
}

// Module-scope features the wrapper does not provide.
const UNSUPPORTED = /\b__filename\b|\b__dirname\b|\barguments\b|\brequire\.(main|resolve|cache)\b|\bmodule\.(parent|id|filename|paths|children|loaded)\b/;
// `require` anywhere except directly followed by `(`.
const INDIRECT_REQUIRE = /\brequire\b(?!\()/;
const REQUIRE_CALL = /\brequire\(([^)]*)\)/g;

function collect() {
  const mods = new Map();   // id (posix path relative to ROOT) -> source
  const queue = [ENTRY];
  while (queue.length) {
    const id = queue.shift();
    if (mods.has(id)) continue;
    let src;
    try { src = fs.readFileSync(path.join(ROOT, id), 'utf8'); } catch (e) { fail(`cannot read ${id}: ${e.message}`); }
    if (id === ENTRY) {
      if (!src.startsWith('#!')) fail(`${id}: expected a shebang on line 1`);
      src = src.slice(src.indexOf('\n') + 1);   // Node strips it too; inside a function it is a syntax error
    }
    // Each module must compile ON ITS OWN as the body of the wrapper function.
    // Otherwise a source with unbalanced braces could close its wrapper and
    // open another inside the bundle: invalid for Node, yet a bundle that
    // parses as a whole -- the check on the finished bundle cannot see it.
    try {
      vm.compileFunction(src, ['exports', 'require', 'module'], { filename: id });
    } catch (e) {
      fail(`${id}: does not compile as a module on its own: ${e.message}`);
    }
    const bad = UNSUPPORTED.exec(src);
    if (bad) fail(`${id}: uses ${bad[0]}, which the bundle does not provide`);
    const indirect = INDIRECT_REQUIRE.exec(src);
    if (indirect) {
      const line = src.slice(0, indirect.index).split('\n').length + (id === ENTRY ? 1 : 0);
      fail(`${id}:${line}: \`require\` used other than as a direct call require('...') -- cannot be bundled`);
    }
    for (const m of src.matchAll(REQUIRE_CALL)) {
      const arg = m[1].trim();
      const lit = /^'([^']*)'$/.exec(arg) || /^"([^"]*)"$/.exec(arg);
      if (!lit) fail(`${id}: require(${arg}) -- only string literals can be bundled`);
      const spec = lit[1];
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;   // a Node built-in
      if (!spec.endsWith('.js')) fail(`${id}: require('${spec}') -- only .js files can be bundled`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
      let st = null;
      try { st = fs.statSync(path.join(ROOT, target)); } catch { /* reported below */ }
      if (!st || !st.isFile()) fail(`${id}: require('${spec}') -> ${target} is not an existing file`);
      queue.push(target);
    }
    mods.set(id, src);
  }
  return mods;
}

function bundle(mods) {
  const ids = [ENTRY].concat([...mods.keys()].filter((id) => id !== ENTRY).sort());
  const parts = [
    '#!/usr/bin/env node',
    '// GENERATED by tools/build.js from nj and lib/ -- do not edit; edit the',
    '// sources and run `node tools/build.js`. Each module below is its source',
    '// file verbatim, wrapped the way Node wraps a CommonJS module; no',
    '// file-wide directive, so every module keeps its own strictness.',
    '',
    'const __njNodeRequire = require;',
    'const __njModules = {',
  ];
  for (const id of ids) {
    const src = mods.get(id);
    parts.push(`${JSON.stringify(id)}: function (exports, require, module) {`);
    parts.push(src.endsWith('\n') ? src.slice(0, -1) : src);
    parts.push('},');
  }
  parts.push(
    '};',
    '',
    'const __njCache = new Map();',
    'function __njLoad(id, spec, from) {',
    "  'use strict';",
    '  const hit = __njCache.get(id);',
    '  if (hit) return hit.exports;',
    '  const fn = __njModules[id];',
    '  if (typeof fn !== \'function\') {',
    "    const e = new Error(`Cannot find module '${spec}' from '${from}' (not in the bundle)`);",
    "    e.code = 'MODULE_NOT_FOUND';",
    '    throw e;',
    '  }',
    '  const module = { exports: {} };',
    '  __njCache.set(id, module);',
    "  const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';",
    '  const req = (s) => {',
    "    if (!s.startsWith('./') && !s.startsWith('../')) return __njNodeRequire(s);",
    '    const parts = [];',
    "    for (const seg of (dir + '/' + s).split('/')) {",
    "      if (seg === '' || seg === '.') continue;",
    "      if (seg === '..') parts.pop(); else parts.push(seg);",
    '    }',
    "    return __njLoad(parts.join('/'), s, id);",
    '  };',
    '  try {',
    '    fn.call(module.exports, module.exports, req, module);',
    '  } catch (e) {',
    '    __njCache.delete(id);   // as in Node: a module that threw is evaluated again next time',
    '    throw e;',
    '  }',
    '  return module.exports;',
    '}',
    '',
    `__njLoad(${JSON.stringify(ENTRY)}, ${JSON.stringify(ENTRY)}, '(entry)');`,
    '',
  );
  return parts.join('\n');
}

const out = bundle(collect());
try {
  new vm.Script(out, { filename: 'dist/nj' });
} catch (e) {
  fail(`the bundle does not compile: ${e.message} -- nothing written`);
}
if (process.argv.includes('--check')) {
  let have = null;
  try { have = fs.readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
  if (have !== out) {
    process.stderr.write('build --check: dist/nj is STALE -- a fresh build differs. Run `node tools/build.js` and commit dist/nj.\n');
    process.exit(1);
  }
  process.stdout.write('build --check: dist/nj is byte-identical to a fresh build\n');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  fs.chmodSync(OUT, 0o755);
  process.stdout.write(`build: dist/nj written (${Buffer.byteLength(out)} bytes)\n`);
}
