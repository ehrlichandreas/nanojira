/* Run the whole oracle and summarise.
 *
 *   node run-all.ts [--jobs=<n>] /path/to/nj
 *
 * Exits 0 only if every test passed. The summary separates "failed" from
 * "could not run", because those mean different things: a failure is a defect
 * in the implementation, a cannot-run is a missing prerequisite (usually the
 * implementation itself, since the oracle is built first).
 *
 * Test files run concurrently, `--jobs=<n>` (or NJ_TEST_JOBS) at a time,
 * default min(os.availableParallelism(), 8) (DECISIONS 199). Each file's
 * stdout+stderr is buffered and printed as one block, in collected order, as
 * soon as every earlier file in the pool has finished -- never interleaved.
 * A file whose header carries a `@serial` marker (see hasMark() and
 * test/README.md) is held back and run alone, one at a time, after the pool
 * has drained. A file marked `@slow` is started first, so the longest files
 * do not begin late and stretch the pool (DECISIONS 201); this changes the
 * dispatch order only, never the print order. `--jobs=1` is the old strictly
 * serial loop: collected order, markers irrelevant, byte-identical output.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(ROOT, '..');

const JOBS_FLAG = /^--jobs=(.*)$/;
const jobsArg = process.argv.slice(2).map((a) => JOBS_FLAG.exec(a)).find(Boolean);
const positional = process.argv.slice(2).filter((a) => !JOBS_FLAG.test(a));

/* Defaults to the repo's own launcher (§ 18, DECISIONS 187) -- the real
 * entry point every consumer actually calls, not only the dist/ bundle it
 * wraps. An explicit NJ/argv[2] (the gate passes a frozen dist/*.mjs step,
 * for instance) still wins. `--jobs=` is the only flag taken out before
 * that positional is read, so every older invocation means what it did. */
const NJ = process.env.NJ || positional[0] || path.join(REPO_ROOT, 'bin', 'nanojira');
const NODE = process.env.NJ_NODE || process.execPath;

function parseJobs(): number {
  const raw = jobsArg ? jobsArg[1] : process.env.NJ_TEST_JOBS;
  if (raw === undefined || raw === '') return Math.max(1, Math.min(os.availableParallelism(), 8));
  if (!/^[1-9][0-9]*$/.test(raw)) {
    console.log('run-all: ' + (jobsArg ? '--jobs' : 'NJ_TEST_JOBS') + ' must be a positive integer, got ' + JSON.stringify(raw));
    process.exit(2);
  }
  return Number(raw);
}
const JOBS = parseJobs();

function collect(dir: string): string[] {
  const out: string[] = [];
  const p = path.join(ROOT, dir);
  if (!fs.existsSync(p)) return out;
  for (const f of fs.readdirSync(p).sort()) {
    if (f.endsWith('.ts')) out.push(path.join(dir, f));
  }
  return out;
}

/* A marker (`@serial`, `@slow`) must open a comment line of the file's
 * header -- `/* @serial: …` or ` * @slow: …` -- before its first `import`,
 * so prose mentioning it further down never trips it. The rest of the line
 * is the reason. */
function hasMark(t: string, mark: string): boolean {
  const src = fs.readFileSync(path.join(ROOT, t), 'utf8');
  const head = src.split(/^import\b/m)[0];
  return new RegExp('^\\s*(?:/\\*+|\\*)\\s*@' + mark + '\\b', 'm').test(head);
}

/* `stress/` is deliberately not collected: ac/ac-07-concurrency.ts wraps
 * stress/concurrency.ts, so scanning both would run the heaviest test twice —
 * doubling the wall clock and inflating the test count with a duplicate.
 *
 * `proposed/` is deliberately not collected either: it holds proposal-v3.1
 * suites (AC-25/26) written ahead of spec acceptance. They are not gated
 * until v3.1 is promoted into the spec and moved into ac/.
 *
 * `tools/` holds regression tests for this repo's own dev-time tooling
 * (TSK-003: tools/release.ts), not spec-pinned behaviour of the `nj` binary
 * itself -- unlike ac/fault/edge, nothing there reads the NJ path this
 * runner passes as argv[2]. Collected anyway: a release wrapper that
 * itself gates on `npm test` is only as good as `npm test` actually
 * running its regression test. */
const tests: string[] = [...collect('ac'), ...collect('fault'), ...collect('edge'), ...collect('tools')];

if (tests.length === 0) {
  console.log('no tests found under ' + ROOT);
  process.exit(1);
}

const TIMEOUT_MS = 600000;
const MAX_BUFFER = 64 * 1024 * 1024;

interface Result { status: number | null; out: string }
type Verdict = 'passed' | 'failed' | 'cannotRun';

function argvFor(t: string): string[] {
  return [path.join(ROOT, t)].concat(NJ ? [NJ] : []);
}

function runSync(t: string): Result {
  const r = spawnSync(NODE, argvFor(t), {
    encoding: 'utf8',
    env: process.env,
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* The async twin of runSync(), kept to spawnSync's observable contract so a
 * file's verdict cannot depend on which phase ran it: stdin closed at once,
 * stdout then stderr (not interleaved), SIGTERM and a null status on the
 * timeout or once either stream passes MAX_BUFFER, and a spawn error is an
 * empty-output null status. */
function runAsync(t: string): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(NODE, argvFor(t), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    let outLen = 0, errLen = 0, done = false;
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
    const timer = setTimeout(kill, TIMEOUT_MS);
    child.stdin.on('error', () => { /* child exited before reading stdin */ });
    child.stdin.end();
    child.stdout.on('data', (b: Buffer) => { outLen += b.length; if (outLen > MAX_BUFFER) kill(); else out.push(b); });
    child.stderr.on('data', (b: Buffer) => { errLen += b.length; if (errLen > MAX_BUFFER) kill(); else err.push(b); });
    const finish = (status: number | null, text: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, out: text });
    };
    child.on('error', () => finish(null, ''));
    child.on('close', (code, signal) => {
      const overflow = outLen > MAX_BUFFER || errLen > MAX_BUFFER;
      finish(signal || overflow ? null : code, Buffer.concat(out).toString('utf8') + Buffer.concat(err).toString('utf8'));
    });
  });
}

function classify(r: Result): Verdict {
  const firstLine = r.out.split('\n')[0] || '(no output)';
  if (/— CANNOT RUN/.test(firstLine)) return 'cannotRun';
  if (r.status === 0) return 'passed';
  return 'failed';
}

const verdicts: Verdict[] = new Array(tests.length);

/* NJ_TEST_TIMES=<file>: write each file's wall time there (TSV, slowest
 * first, with the phase it ran in and its start offset). Nothing on stdout
 * changes. It is the measurement behind `@slow` (test/README.md). */
const T0 = Date.now();
const times: { t: string; phase: string; start: number; ms: number }[] = [];
function timed<R>(t: string, phase: string, run: () => R | Promise<R>): Promise<R> {
  const start = Date.now();
  return Promise.resolve(run()).then((v) => { times.push({ t, phase, start: start - T0, ms: Date.now() - start }); return v; });
}

function report(i: number, r: Result) {
  process.stdout.write(r.out.endsWith('\n') || r.out === '' ? r.out : r.out + '\n');
  verdicts[i] = classify(r);
}

/* `indices` is the print order (collected); `order` the dispatch order, a
 * permutation of positions into `indices`. */
async function runPool(indices: number[], order: number[]) {
  const results: (Result | undefined)[] = new Array(indices.length);
  let next = 0, printed = 0;
  const flush = () => {
    while (printed < indices.length && results[printed]) {
      report(indices[printed], results[printed] as Result);
      results[printed] = { status: null, out: '' };   // release the buffer; only the verdict is kept
      printed++;
    }
  };
  const worker = async () => {
    while (next < order.length) {
      const k = order[next++];
      results[k] = await timed(tests[indices[k]], 'pool', () => runAsync(tests[indices[k]]));
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, indices.length) }, worker));
}

const all = tests.map((_, i) => i);
if (JOBS === 1) {
  for (const i of all) report(i, await timed(tests[i], 'serial', () => runSync(tests[i])));
} else {
  const serial = all.filter((i) => hasMark(tests[i], 'serial'));
  const pooled = all.filter((i) => !serial.includes(i));
  const slow = pooled.map((_, k) => k).filter((k) => hasMark(tests[pooled[k]], 'slow'));
  await runPool(pooled, slow.concat(pooled.map((_, k) => k).filter((k) => !slow.includes(k))));
  for (const i of serial) report(i, await timed(tests[i], 'serial', () => runSync(tests[i])));
}
if (process.env.NJ_TEST_TIMES) {
  fs.writeFileSync(process.env.NJ_TEST_TIMES, 'file\tphase\tstart_ms\tms\n' + times.sort((a, b) => b.ms - a.ms)
    .map((x) => [x.t, x.phase, x.start, x.ms].join('\t')).join('\n') + '\n' + 'total\t-\t0\t' + (Date.now() - T0) + '\n');
}

/* Lists in collected order whatever order the files finished in, so the
 * summary of a pooled run is the summary of a serial one. */
const passed = tests.filter((_, i) => verdicts[i] === 'passed');
const failed = tests.filter((_, i) => verdicts[i] === 'failed');
const cannotRun = tests.filter((_, i) => verdicts[i] === 'cannotRun');

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
