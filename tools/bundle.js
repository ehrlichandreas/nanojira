#!/usr/bin/env node
'use strict';

// Builds dist/nj, the one executable file that ships (§ 3), from src/nj.ts
// and src/commands/ + src/core/, using esbuild (DECISIONS 83: build-time
// tooling may choose its own libraries; run time still has no dependency and
// no `node_modules`). esbuild is a devDependency, required only here --
// never by anything under src/, so it is not part of what ships.
//
//   node tools/bundle.js           write dist/nj
//   node tools/bundle.js --check   build in memory; exit 1 unless dist/nj is
//                                  byte-identical (a stale bundle is caught)
//
// esbuild bundles `src/nj.ts` -- the entry point, unmodified, with its
// shebang -- and everything it `require`s under src/commands/ and src/core/,
// into one CommonJS file. `platform: 'node'` externalises Node built-ins (`fs`, `path`, …)
// instead of trying to bundle them. Output is deterministic: no absolute
// paths, no timestamps (checked below, and by `--check` itself, which is
// exactly a determinism check run against the committed file).

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'nj.ts');
const OUT = path.join(ROOT, 'dist', 'nj');

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

const result = esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  // Without this, esbuild writes its `// <path>` module comments relative to
  // the invocation cwd -- three different callers (repo root, /, /tmp) built
  // three different byte sequences from the same sources. Pinned so the
  // output depends only on the sources, never on where `bundle.js` was run.
  absWorkingDir: ROOT,
  metafile: true, // gives the exact set of files actually bundled, for checkStrict
});
if (result.errors.length) {
  for (const e of result.errors) process.stderr.write(`bundle: ${e.text}\n`);
  process.exit(2);
}
checkStrict(Object.keys(result.metafile.inputs));
const out = Buffer.from(result.outputFiles[0].contents);

if (process.argv.includes('--check')) {
  let have = null;
  try { have = fs.readFileSync(OUT); } catch { /* missing counts as stale */ }
  if (!have || !have.equals(out)) {
    process.stderr.write('bundle --check: dist/nj is STALE -- a fresh build differs. Run `node tools/bundle.js` and commit dist/nj.\n');
    process.exit(1);
  }
  process.stdout.write('bundle --check: dist/nj is byte-identical to a fresh build\n');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  fs.chmodSync(OUT, 0o755);
  process.stdout.write(`bundle: dist/nj written (${out.length} bytes)\n`);
}
