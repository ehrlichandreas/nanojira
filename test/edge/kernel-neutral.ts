/* Edge — the CLI kernel is cli-kernel's vendored copy and stays
 * project-neutral (DECISIONS 231, 239; TSK-050, TSK-062).
 *
 * `src/core/kernel.ts` is cli-kernel's `src/kernel.ts`, exported from a
 * signed release tag with cli-kernel's `tools/export.mts`: one provenance
 * header line, then the tag's bytes. It must never be edited here (fix it
 * in cli-kernel, release, re-export). So:
 *   A1  the header records a release, and the body still matches its
 *       sha256 -- the offline `--check`, recomputed here so it runs
 *       without a cli-kernel checkout;
 *   A2  cli-kernel's own `--check <file>` (offline), and the verified
 *       `<tag> <file> --check` (signature by the pinned key, byte for
 *       byte), when a cli-kernel checkout is beside this one or named by
 *       NJ_CLI_KERNEL -- not covered otherwise;
 *   A3  the kernel imports only `node:*` built-ins and names nanojira only
 *       on its license line;
 *   A4  NJ_NOW is named once, in `core/clock.ts`, and nothing else takes
 *       the clock from `kernel.ts` directly.
 * Its `parseArgs` takes the flag table as an optional spec: a `string`
 * flag takes the next token as its value; without the spec every bare flag
 * is `true`. Aliases and value sameness come from the caller.
 */
import fs from 'fs';
import path from 'path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KERNEL = path.join(ROOT, 'src', 'core', 'kernel.ts');
const HEADER = /^\/\/ cli-kernel (v\d+\.\d+\.\d+) commit ([0-9a-f]{40}) sha256 ([0-9a-f]{64})\n/;
const LICENSE_LINE = '// Copyright (c) the nanojira authors';

/* A1. provenance header, body unchanged ---------------------------------- */
const raw = fs.readFileSync(KERNEL);
const header = HEADER.exec(raw.toString('utf8'));
T.check('A1 kernel.ts starts with a cli-kernel provenance header', header !== null, raw.toString('utf8').split('\n')[0]);
const tag = header ? header[1] : '';
if (header) {
  const body = raw.subarray(Buffer.byteLength(header[0], 'utf8'));
  T.eq('A1 the body still matches the header\'s sha256 (no local edit)',
    crypto.createHash('sha256').update(body).digest('hex'), header[3]);
  T.eq('A1 the body starts with \'use strict\' and the SPDX line',
    body.toString('utf8').split('\n').slice(0, 2), ["'use strict';", '// SPDX-License-Identifier: MIT']);
}

/* A2. cli-kernel's own checks, when a checkout is at hand ----------------- */
{
  const checkout = process.env.NJ_CLI_KERNEL || path.join(ROOT, '..', 'cli-kernel');
  const tool = path.join(checkout, 'tools', 'export.mts');
  if (!fs.existsSync(tool)) {
    T.notCovered('A2 cli-kernel\'s --check on kernel.ts', `no cli-kernel checkout at ${checkout} (set NJ_CLI_KERNEL)`);
  } else {
    const run = (args: string[]) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 60000 });
    const offline = run(['--check', KERNEL]);
    T.check('A2 cli-kernel\'s offline --check passes', offline.status === 0, String(offline.stderr));
    const verified = run([tag, KERNEL, '--check']);
    if (verified.status === 2) {
      T.notCovered('A2 cli-kernel\'s verified ' + tag + ' --check', 'the checkout could not verify the tag: ' + String(verified.stderr).trim());
    } else {
      T.check('A2 cli-kernel\'s verified ' + tag + ' --check passes (signed tag, byte for byte)', verified.status === 0, String(verified.stderr));
    }
  }
}

/* A3. imports and names ---------------------------------------------------- */
{
  const src = raw.toString('utf8');
  // `import x from '…'`, `export … from "…"` and a bare side-effect
  // `import '…'`, either quote; then `import(…)` / `require(…)`.
  const specs = Array.from(src.matchAll(/^\s*(?:import|export)\b[^;'"]*?['"]([^'"]+)['"]/gm), (m) => m[1]);
  const dynamic = Array.from(src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g), (m) => m[1]);
  T.check('A3 kernel.ts has at least one import', specs.length > 0, '');
  T.eq('A3 kernel.ts imports only node:* built-ins', [...specs, ...dynamic].filter((s) => !s.startsWith('node:')), []);
  T.check('A3 the header says it is copied verbatim', /copy verbatim, project-neutral/.test(src.slice(0, 600)), '');
  T.eq('A3 kernel.ts names nanojira only on its license line',
    Array.from(src.matchAll(/^.*nanojira.*$/gim), (m) => m[0].trim()), [LICENSE_LINE]);
  T.check('A3 kernel.ts reads no NJ_ variable itself', !/NJ_/.test(src), '');
}

/* A4. NJ_NOW is named once, in core/clock.ts ------------------------------- */
{
  const calls: string[] = [];
  const clockImports: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts') || p === KERNEL) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\bsetClockEnv\s*\(([^)]*)\)/g)) calls.push(path.relative(ROOT, p) + ': ' + m[1]);
      for (const m of text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/kernel\.ts'/gm)) {
        if (/\b(setClockEnv|checkClockEnv|nowIso|nowMs)\b/.test(m[1])) clockImports.push(path.relative(ROOT, p));
      }
    }
  })(path.join(ROOT, 'src'));
  T.eq('A4 setClockEnv is called once, with NJ_NOW, in core/clock.ts', calls, [path.join('src', 'core', 'clock.ts') + ": 'NJ_NOW'"]);
  T.eq('A4 only core/clock.ts takes the clock from kernel.ts', clockImports, [path.join('src', 'core', 'clock.ts')]);
}

/* B. no "agent-skills" in src/ or dist/ ---------------------------------- */
{
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && fs.readFileSync(p, 'utf8').includes('agent-skills')) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'dist'));
  T.eq('B no file under src/ or dist/ names agent-skills', hits, []);
}

/* C. parseArgs' spec param ----------------------------------------------- */
(async () => {
  const K = await import(KERNEL);
  const kinds = { title: 'string', json: 'boolean' } as const;
  const flat = (r: { flags: Map<string, string | true>; positional: string[]; repeated: unknown[] }) =>
    ({ flags: Object.fromEntries(r.flags), positional: r.positional, repeated: r.repeated });

  T.eq('C a string flag takes the next token',
    flat(K.parseArgs(['--title', 'Two words', 'x'], kinds)), { flags: { title: 'Two words' }, positional: ['x'], repeated: [] });
  T.eq('C a boolean flag never takes the next token',
    flat(K.parseArgs(['--json', 'x'], kinds)), { flags: { json: true }, positional: ['x'], repeated: [] });
  T.eq('C without the spec every bare flag is true',
    flat(K.parseArgs(['--title', 'x'])), { flags: { title: true }, positional: ['x'], repeated: [] });
  T.eq('C a flag the spec does not know is true',
    flat(K.parseArgs(['--other', 'x'], kinds)), { flags: { other: true }, positional: ['x'], repeated: [] });
  T.eq('C a next token starting with -- is not taken as the value',
    flat(K.parseArgs(['--title', '--json'], kinds)), { flags: { title: true, json: true }, positional: [], repeated: [] });
  T.eq('C `-` is a value', flat(K.parseArgs(['--title', '-'], kinds)), { flags: { title: '-' }, positional: [], repeated: [] });
  T.eq('C `--` ends the options',
    flat(K.parseArgs(['--', '--title', 'x'], kinds)), { flags: {}, positional: ['--title', 'x'], repeated: [] });
  T.eq('C =value wins over the next token',
    flat(K.parseArgs(['--title=a', 'b'], kinds)), { flags: { title: 'a' }, positional: ['b'], repeated: [] });
  T.eq('C a different repeat is reported with the spelling typed',
    flat(K.parseArgs(['--title=a', '--name=b'], kinds, { aliases: new Map([['name', 'title']]) })),
    { flags: { title: 'b' }, positional: [], repeated: [{ name: 'title', typed: 'name' }] });
  T.eq('C an identical repeat is not reported',
    flat(K.parseArgs(['--title=a', '--title', 'a'], kinds)).repeated, []);
  T.eq('C the caller decides which values are the same',
    flat(K.parseArgs(['--title=a', '--title=A'], kinds, { sameValue: (_n: string, a: string | true, b: string | true) => String(a).toLowerCase() === String(b).toLowerCase() })).repeated, []);
  T.eq('C allowedControlSet adds the caller\'s global controls',
    Array.from(K.allowedControlSet(['force'], ['backlog'])), ['force', 'backlog']);
  T.finish();
})().catch((e) => {
  console.log('FAIL edge/kernel-neutral.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
