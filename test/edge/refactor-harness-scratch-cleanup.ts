/* D189 (docs/DECISIONS.md 189, 2026-10-09) -- the white-box probes under
 * tools/refactor-harness/scratch/ (bc, r3, r3bc, r4, r4bc, r5, r6, r6bc,
 * r8, verify -- every file there that calls mkdtempSync, discovered below
 * rather than hardcoded, since D189's own listing ends in "…") create
 * `<SCRATCH_BASE>/<label>-XXXXXX/backlog` fixtures and, as of this
 * writing, never remove them: about 320 had piled up in /tmp before this
 * was noticed. This file is RED until the fix lands -- each probe should
 * leave a fresh HARNESS_SCRATCH_BASE empty once it exits, on success and
 * on failure alike.
 *
 * Each probe is invoked directly, not through baseline.ts's corpus-
 * recording shim: whether a probe cleans up after itself does not depend
 * on whether its calls are being recorded, and driving it directly is the
 * simplest way to control HARNESS_SCRATCH_BASE per run. Every probe reads
 * its own nj path from argv[2] (`bc.ts`'s own comment: "argv[2] zuerst:
 * ohne das laeuft die Sonde am Shim vorbei" -- the same convention
 * baseline.ts's shim-spawn and verify.ts's own direct-spawn both rely on);
 * `r8.ts` reads `argv.slice(2)` as a list of nj binaries to compare and is
 * handed exactly one, which it already handles (its own ternaries guard
 * the absent second/third/fourth entry).
 *
 * H.NJ_BUNDLE, not H.NJ: every probe spawns `node <NJ> args` directly
 * (the same pre-D187 convention baseline.ts itself still uses for NJ_ABS)
 * -- hand it `bin/nj` under the current, default run-all.ts target and
 * `node bin/nj` is not valid JavaScript, an unrelated break (§ 18). The
 * bundle is always `node <path> args`-compatible.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

H.requireNj();

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRATCH_DIR = path.join(REPO_ROOT, 'tools', 'refactor-harness', 'scratch');

function discoverProbes() {
  if (!fs.existsSync(SCRATCH_DIR)) return [];
  return fs.readdirSync(SCRATCH_DIR).filter((n) => n.endsWith('.ts') &&
    fs.readFileSync(path.join(SCRATCH_DIR, n), 'utf8').includes('mkdtempSync')).sort();
}

/* Under H.TMP_ROOT (tmpfs /tmp), not os.tmpdir(): TMPDIR may be on disk,
 * and a base made by H.freshDir is removed by the harness's exit handler.
 * A signal kills this file without cleanup (DECISIONS 193, TSK-028); under
 * run-all the base is inside the run root, which the leak sweep removes. */
function freshScratchBase(label: string) {
  return H.freshDir('d189-' + label);
}

/* What a probe run reports back: the fields spawnSync returned before the
 * probes ran concurrently, with the same meaning (a timeout or an output
 * overflow is `error`, as spawnSync's ETIMEDOUT / ENOBUFS were). */
type ProbeResult = { status: number | null; signal: NodeJS.Signals | null; error?: Error; stdout: string; stderr: string };

/* 300 s, not 120 s: r4/r6/verify run 50-80 nj calls back to back and
 * bc/r3bc/r4bc add 10 s hook waits, which an 8-wide run-all pool
 * (DECISIONS 199) can stretch past 120 s -- a kill the detail() line
 * below would report, but a false red all the same. */
const PROBE_TIMEOUT_MS = 300000;
const PROBE_MAX_BUFFER = 64 * 1024 * 1024;

/** Run one probe directly against `njPath`, with HARNESS_SCRATCH_BASE set
 * to `scratchBase`. Resolves once the probe has exited and its output is
 * closed. */
function runProbe(name: string, njPath: string, scratchBase: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const p = path.join(SCRATCH_DIR, name);
    const child = spawn(process.execPath, [p, njPath], {
      cwd: SCRATCH_DIR,
      env: Object.assign({}, process.env, { HARNESS_SCRATCH_BASE: scratchBase }),
    });
    let stdout = '', stderr = '', size = 0, error: Error | undefined, done = false;
    const kill = (e: Error) => { if (!error) error = e; try { child.kill('SIGTERM'); } catch (k) { /* already gone */ } };
    const collect = (append: (d: string) => void) => (d: string) => {
      size += Buffer.byteLength(d);
      if (size > PROBE_MAX_BUFFER) kill(new Error('spawn ENOBUFS: output over ' + PROBE_MAX_BUFFER + ' bytes'));
      else append(d);
    };
    child.stdout.setEncoding('utf8'); child.stdout.on('data', collect((d) => { stdout += d; }));
    child.stderr.setEncoding('utf8'); child.stderr.on('data', collect((d) => { stderr += d; }));
    const timer = setTimeout(() => kill(new Error('spawn ETIMEDOUT after ' + PROBE_TIMEOUT_MS + ' ms')), PROBE_TIMEOUT_MS);
    const finish = (status: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ status, signal, error, stdout, stderr });
    };
    child.on('error', (e) => { if (!error) error = e; finish(null, null); });
    child.on('close', (status, signal) => finish(status, signal));
  });
}

/* The probes are independent -- each one's fixtures live under its own
 * HARNESS_SCRATCH_BASE, and the before-compare legs (bc, r3bc, r4bc, r6bc)
 * synchronise on a marker inside their own backlog -- so they run
 * concurrently, at most PROBE_CONCURRENCY at once. Most of the file's time
 * is fixed holds, not work: bc.ts alone waits out the 10 s before-compare
 * timeout three times (~33 s), r3bc/r4bc ~13 s each. Longest first, so
 * bc.ts sets the critical path and the short ones fill the other slots.
 * The checks are emitted afterwards, in the original order. */
const PROBE_CONCURRENCY = 4;
const LONGEST_FIRST = ['bc.ts', 'r3bc.ts', 'r4bc.ts', 'verify.ts'];

async function inPool<R>(jobs: (() => Promise<R>)[], cap: number): Promise<R[]> {
  const results: R[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); }
  };
  await Promise.all(Array.from({ length: Math.min(cap, jobs.length) }, worker));
  return results;
}

function removeIfPresent(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const probes = discoverProbes();
T.check('fixture: at least one mkdtempSync-using probe was found under ' + SCRATCH_DIR,
  probes.length > 0, JSON.stringify(probes));

/* Every "empty afterwards" failure detail names the probe's own exit
 * status and signal, not just the leftover listing -- a probe killed by
 * a timeout (test/run-all.ts's own spawnSync timeout included: 300 s
 * here, SIGTERM by default) is otherwise indistinguishable at a glance
 * from one that ran to completion and simply failed to clean up (D189
 * follow-up: the gate found bc.ts had left all 6 of its own dirs behind
 * in one run, and the detail line is what makes a kill-under-load
 * recognisable immediately instead of needing a second, manual repro). */
function detail(left: string[] | null, r: ProbeResult) {
  return 'left=' + JSON.stringify(left) + ' status=' + r.status + ' signal=' + r.signal;
}

/** One probe leg: a fresh scratch base, the run, what it left behind. */
type Leg = { r: ProbeResult; left: string[] | null };
async function leg(name: string, njPath: string, label: string): Promise<Leg> {
  const base = freshScratchBase(label);
  const r = await runProbe(name, njPath, base);
  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  removeIfPresent(base);
  return { r, left };
}

/* Failure path, reached without touching any probe's own source: point
 * r6bc.ts at a broken "nj" (`/dev/null`, a valid empty JS program -- node
 * runs it, exits 0, prints nothing) so its single nj-invoking child
 * produces empty, non-JSON stdout. r6bc.ts's close handler does
 * `JSON.parse(out)` with no try/catch around it -- today, an uncaught
 * exception, crashing the probe before any cleanup could run (once added)
 * gets a chance to. This is exactly the "injected throw" / "probe whose
 * nj command fails" case D189 asks this file to cover. */
const FAILURE_LEG = 'r6bc-failure';

async function probeLegs(): Promise<Map<string, Leg>> {
  const rank = (n: string) => { const i = LONGEST_FIRST.indexOf(n); return i === -1 ? LONGEST_FIRST.length : i; };
  const order = probes.slice().sort((a, b) => rank(a) - rank(b));
  const keys = order.concat([FAILURE_LEG]);
  const jobs = order.map((name) => () => leg(name, H.NJ_BUNDLE as string, name.replace(/\.ts$/, '')))
    .concat([() => leg('r6bc.ts', '/dev/null', FAILURE_LEG)]);
  const legs = await inPool(jobs, PROBE_CONCURRENCY);
  return new Map(keys.map((k, i) => [k, legs[i]]));
}

function assertProbeLegs(legs: Map<string, Leg>): void {
  for (const name of probes) {
    const { r, left } = legs.get(name) as Leg;
    T.check(name + ': the probe spawned and exited (did not fail to start)',
      !r.error, r.error && r.error.message);
    T.check(name + ': HARNESS_SCRATCH_BASE is empty once the probe exits',
      JSON.stringify(left) === JSON.stringify([]), detail(left, r));
  }
  const { r, left } = legs.get(FAILURE_LEG) as Leg;
  T.check('r6bc.ts failure path: a broken nj really did make the probe fail (non-zero exit)',
    r.status !== 0, 'status=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 300));
  T.check('r6bc.ts failure path: HARNESS_SCRATCH_BASE is still empty after the probe dies on an uncaught exception',
    JSON.stringify(left) === JSON.stringify([]), detail(left, r));
}

/* ===================================================================== */
/* Signal legs (D189 follow-up) -- a probe killed by a signal mid-run     */
/* never reaches a process.on('exit', ...) handler by default; a fix     */
/* that only wires 'exit' leaves this path uncovered, exactly the gate's  */
/* own bc.ts finding (SIGTERM ~0.4 s after start: exit 143, bc1-* stays   */
/* behind). Covered here for bc.ts only (one probe is enough to prove    */
/* the class of bug) -- one leg each for SIGTERM, SIGINT and SIGHUP,     */
/* reached deterministically: poll the scratch base for the FIRST        */
/* fixture bc.ts creates (bc1-*) rather than a fixed sleep, so the signal */
/* always lands once real work (a live mkdtempSync'd fixture, almost      */
/* certainly still in use by the nj child bc.ts's own leg 1 just spawned) */
/* has happened -- never before it exists, never flakily late either.    */
/*                                                                        */
/* Verdict choice (Lead's decision for this leg, so the Implementer is   */
/* held to the same single contract): the probe must end THROUGH THE     */
/* SIGNAL ITSELF -- `result.signal === 'SIGTERM'/'SIGINT'/'SIGHUP'`, not  */
/* a 128+n exit code. A probe that wants to clean up before it dies has   */
/* to install its own handler (the default disposition terminates before */
/* any of its own code would run) and then RE-RAISE the same signal on    */
/* itself (e.g. process.kill(process.pid, sig) after removing its own     */
/* listener, so the default disposition finishes the job) -- which is     */
/* what Node's 'exit' event reports back as `signal: sig, code: null`.    */
/* ===================================================================== */
/** Poll (never a fixed sleep) until `dir` has at least one entry, or
 * `timeoutMs` elapses. Resolves true/false for which happened. */
async function pollUntilNonEmpty(dir: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) return true;
    if (Date.now() >= deadline) return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    await sleep(20);
  }
}

/** Spawn bc.ts against H.NJ_BUNDLE with HARNESS_SCRATCH_BASE = scratchBase,
 * send `sig` once its first fixture exists, and report what happened. */
type ExitOutcome = { code: number | null; signal: NodeJS.Signals | null; timedOut?: boolean };

async function bcSignalLeg(sig: NodeJS.Signals) {
  const base = freshScratchBase('bc-' + sig);
  const p = path.join(SCRATCH_DIR, 'bc.ts');
  const child = spawn(process.execPath, [p, H.NJ_BUNDLE as string], {
    cwd: SCRATCH_DIR,
    env: Object.assign({}, process.env, { HARNESS_SCRATCH_BASE: base }),
  });
  const exitPromise = new Promise<ExitOutcome>((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })));

  const appeared = await pollUntilNonEmpty(base, 15000);
  T.check('bc.ts ' + sig + ': fixture: the first fixture appeared before the signal was sent',
    appeared, 'base=' + base);
  child.kill(appeared ? sig : 'SIGKILL');

  const timedOut: ExitOutcome = { code: null, signal: null, timedOut: true };
  const exitInfo = await Promise.race([exitPromise, sleep(20000).then(() => timedOut)]);
  if (exitInfo.timedOut) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } await exitPromise; }

  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check('bc.ts ' + sig + ': the probe really did end by that signal (result.signal === ' + JSON.stringify(sig) + ')',
    exitInfo.signal === sig, 'expected signal ' + sig + ', got code=' + exitInfo.code + ' signal=' + exitInfo.signal);
  T.check('bc.ts ' + sig + ': HARNESS_SCRATCH_BASE is empty once the probe is killed mid-run',
    JSON.stringify(left) === JSON.stringify([]),
    'left=' + JSON.stringify(left) + ' code=' + exitInfo.code + ' signal=' + exitInfo.signal);
  removeIfPresent(base);
}

(async () => {
  assertProbeLegs(await probeLegs());
  const sigs: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  for (const sig of sigs) await bcSignalLeg(sig);
  T.finish();
})();
