'use strict';
/* Run the whole oracle and summarise.
 *
 *   node run-all.js /path/to/nj
 *
 * Exits 0 only if every test passed. The summary separates "failed" from
 * "could not run", because those mean different things: a failure is a defect
 * in the implementation, a cannot-run is a missing prerequisite (usually the
 * implementation itself, since the oracle is built first).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const REPO_ROOT = path.join(ROOT, '..');
/* Defaults to the repo's own launcher (§ 18, DECISIONS 187) -- the real
 * entry point every consumer actually calls, not only the dist/ bundle it
 * wraps. An explicit NJ/argv[2] (the gate passes a frozen dist/*.mjs step,
 * for instance) still wins. */
const NJ = process.env.NJ || process.argv[2] || path.join(REPO_ROOT, 'bin', 'nj');
const NODE = process.env.NJ_NODE || process.execPath;

function collect(dir) {
  const out = [];
  const p = path.join(ROOT, dir);
  if (!fs.existsSync(p)) return out;
  for (const f of fs.readdirSync(p).sort()) {
    if (f.endsWith('.js')) out.push(path.join(dir, f));
  }
  return out;
}

/* `stress/` is deliberately not collected: ac/ac-07-concurrency.js wraps
 * stress/concurrency.js, so scanning both would run the heaviest test twice —
 * doubling the wall clock and inflating the test count with a duplicate.
 *
 * `proposed/` is deliberately not collected either: it holds proposal-v3.1
 * suites (AC-25/26) written ahead of spec acceptance. They are not gated
 * until v3.1 is promoted into the spec and moved into ac/. */
const tests = [].concat(collect('ac'), collect('fault'), collect('edge'));

if (tests.length === 0) {
  console.log('no tests found under ' + ROOT);
  process.exit(1);
}

const passed = [], failed = [], cannotRun = [];

for (const t of tests) {
  const r = spawnSync(NODE, [path.join(ROOT, t)].concat(NJ ? [NJ] : []), {
    encoding: 'utf8',
    env: process.env,
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const firstLine = out.split('\n')[0] || '(no output)';
  process.stdout.write(out.endsWith('\n') || out === '' ? out : out + '\n');

  if (/— CANNOT RUN/.test(firstLine)) cannotRun.push(t);
  else if (r.status === 0) passed.push(t);
  else failed.push(t);
}

const total = tests.length;
console.log('\n' + '='.repeat(64));
console.log('passed     ' + String(passed.length).padStart(3) + ' / ' + total);
console.log('failed     ' + String(failed.length).padStart(3) + ' / ' + total);
console.log('cannot run ' + String(cannotRun.length).padStart(3) + ' / ' + total);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log('  ' + f);
}
if (cannotRun.length) {
  console.log('\ncannot run (prerequisite missing, not a defect):');
  for (const f of cannotRun.slice(0, 5)) console.log('  ' + f);
  if (cannotRun.length > 5) console.log('  … and ' + (cannotRun.length - 5) + ' more');
}
console.log('\nFill AC-MATRIX.md from this run; record `not covered` wherever a\n' +
  'conditional leg did not execute.');
process.exit(failed.length === 0 && cannotRun.length === 0 ? 0 : 1);
