#!/usr/bin/env node
'use strict';

// Builds the two executable files that ship (§ 3, § 18): dist/nj.mjs from
// src/nj.ts, and dist/nj-mcp.mjs from src/nj-mcp.ts (§ 17 "MCP Interface") --
// each one everything it `require`s/`import`s under src/commands/ and
// src/core/, bundled by esbuild (DECISIONS 83: build-time tooling may choose
// its own libraries; run time still has no dependency and no
// `node_modules`). esbuild is a devDependency, required only here -- never
// by anything under src/, so it is not part of what ships.
//
//   node tools/bundle.js           write dist/nj.mjs and dist/nj-mcp.mjs
//   node tools/bundle.js --check   build both in memory; exit 1 unless BOTH
//                                  are byte-identical (a stale bundle is caught)
//
// esbuild bundles each entry point -- unmodified, with its shebang -- and
// everything it imports under src/commands/ and src/core/, into one ESM file
// (DECISIONS 185 addendum 9b3d0de: `.mjs`, matching the other
// `agent-skills` Node skills). `platform: 'node'` externalises Node
// built-ins (`fs`, `path`, …) instead of trying to bundle them; a plugin
// below additionally normalises every externalised specifier to its
// `node:`-prefixed form and fails the build outright on any import that is
// not a recognised Node built-in -- nothing from `node_modules` ships in the
// bundle, enforced here, not merely by convention. Output is deterministic:
// no absolute paths, no timestamps (checked below, and by `--check` itself,
// which is exactly a determinism check run against the committed file).

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { builtinModules } = require('module');

const ROOT = path.resolve(__dirname, '..');
// The one version source (§ 9 "--version", D151): read here, at build
// time, and handed to esbuild's `define` below so both bundles embed the
// literal string — neither binary reads package.json at runtime.
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TARGETS = [
  { entry: path.join(ROOT, 'src', 'nj.ts'), out: path.join(ROOT, 'dist', 'nj.mjs') },
  { entry: path.join(ROOT, 'src', 'nj-mcp.ts'), out: path.join(ROOT, 'dist', 'nj-mcp.mjs') },
];

// node:* only (DECISIONS 185 addendum 9b3d0de): a relative/absolute import
// is left to esbuild's own resolver (it gets bundled in); anything else must
// name a real Node built-in, and is rewritten to its `node:`-prefixed form
// in the OUTPUT regardless of how the source spelled it -- so the shipped
// bundle's own import specifiers are uniformly `node:*`, never bare.
const builtins = new Set(builtinModules);
const nodeOnlyImports = {
  name: 'node-only-imports',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('.') || args.path.startsWith('/')) return null;
      const bare = args.path.startsWith('node:') ? args.path.slice(5) : args.path;
      if (!builtins.has(bare)) {
        return { errors: [{ text: `import '${args.path}' is not a node:* built-in -- the shipped bundle may import only Node built-ins` }] };
      }
      return { path: 'node:' + bare, external: true };
    });
  },
};

// esbuild only emits a file-wide 'use strict' when the ENTRY has one, and
// having emitted it, it does not re-wrap each module in its own directive --
// every module ends up sharing that ONE strict-mode scope, sloppy or not.
// A source that lacked its own 'use strict' would flip modes silently (a
// bare function's `this` becomes `undefined` instead of the global object,
// among other differences) with nothing here to say so. Every source today
// happens to start with 'use strict'; this makes that a checked contract
// instead of an accident nobody would notice breaking.
function checkStrict(files) {
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const start = lines[0].startsWith('#!') ? 1 : 0;
    const first = (lines[start] || '').trim();
    if (first !== "'use strict';" && first !== '"use strict";') {
      process.stderr.write(`bundle: ${rel} has no leading 'use strict' -- esbuild would fold it into the entry's strict scope instead of giving it its own, silently.\n`);
      process.exit(2);
    }
  }
}

const checking = process.argv.includes('--check');

async function main() {
  let staleAny = false;

  for (const { entry, out: OUT } of TARGETS) {
    const rel = path.relative(ROOT, OUT);
    // `build` (async), not `buildSync`: esbuild refuses plugins (needed for
    // nodeOnlyImports above) in the synchronous API.
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [nodeOnlyImports],
      write: false,
      logLevel: 'silent',
      // Without this, esbuild writes its `// <path>` module comments relative to
      // the invocation cwd -- three different callers (repo root, /, /tmp) built
      // three different byte sequences from the same sources. Pinned so the
      // output depends only on the sources, never on where `bundle.js` was run.
      absWorkingDir: ROOT,
      metafile: true, // gives the exact set of files actually bundled, for checkStrict
      define: { __NJ_VERSION__: JSON.stringify(PKG_VERSION) },
    });
    if (result.errors.length) {
      for (const e of result.errors) process.stderr.write(`bundle: ${e.text}\n`);
      process.exit(2);
    }
    checkStrict(Object.keys(result.metafile.inputs));
    const out = Buffer.from(result.outputFiles[0].contents);

    if (checking) {
      let have = null;
      try { have = fs.readFileSync(OUT); } catch { /* missing counts as stale */ }
      if (!have || !have.equals(out)) {
        process.stderr.write(`bundle --check: ${rel} is STALE -- a fresh build differs. Run \`node tools/bundle.js\` and commit ${rel}.\n`);
        staleAny = true;
        continue;
      }
      process.stdout.write(`bundle --check: ${rel} is byte-identical to a fresh build\n`);
    } else {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, out);
      fs.chmodSync(OUT, 0o755);
      process.stdout.write(`bundle: ${rel} written (${out.length} bytes)\n`);
    }
  }
  if (staleAny) process.exit(1);
}

main();
