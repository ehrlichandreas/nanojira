/* @slow: one of the longest pooled files, ~98 s at 8 jobs (NJ_TEST_TIMES, 2026-10-18); start it first (run-all.ts, test/README.md) */
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
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

H.requireNj();

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRATCH_DIR = path.join(REPO_ROOT, 'tools', 'refactor-harness', 'scratch');
const TMP_ROOT = fs.realpathSync(os.tmpdir());

function discoverProbes() {
  if (!fs.existsSync(SCRATCH_DIR)) return [];
  return fs.readdirSync(SCRATCH_DIR).filter((n) => n.endsWith('.ts') &&
    fs.readFileSync(path.join(SCRATCH_DIR, n), 'utf8').includes('mkdtempSync')).sort();
}

function freshScratchBase(label: string) {
  return fs.mkdtempSync(path.join(TMP_ROOT, 'nj-d189-' + label + '-'));
}

/** Run one probe directly against `njPath`, with HARNESS_SCRATCH_BASE set
 * to `scratchBase`. Returns the spawnSync result. */
function runProbe(name: string, njPath: string, scratchBase: string) {
  const p = path.join(SCRATCH_DIR, name);
  return spawnSync(process.execPath, [p, njPath], {
    cwd: SCRATCH_DIR,
    env: Object.assign({}, process.env, { HARNESS_SCRATCH_BASE: scratchBase }),
    encoding: 'utf8',
    /* 300 s, not 120 s: r4/r6/verify run 50-80 nj calls back to back and
     * bc/r3bc/r4bc add 10 s hook waits, which an 8-wide run-all pool
     * (DECISIONS 199) can stretch past 120 s -- a kill the detail() line
     * below would report, but a false red all the same. */
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
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
function detail(left: string[] | null, r: ReturnType<typeof runProbe>) {
  return 'left=' + JSON.stringify(left) + ' status=' + r.status + ' signal=' + r.signal;
}

for (const name of probes) {
  const base = freshScratchBase(name.replace(/\.ts$/, ''));
  const r = runProbe(name, H.NJ_BUNDLE as string, base);
  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check(name + ': the probe spawned and exited (did not fail to start)',
    !r.error, r.error && r.error.message);
  T.check(name + ': HARNESS_SCRATCH_BASE is empty once the probe exits',
    JSON.stringify(left) === JSON.stringify([]), detail(left, r));
  removeIfPresent(base);
}

/* Failure path, reached without touching any probe's own source: point
 * r6bc.ts at a broken "nj" (`/dev/null`, a valid empty JS program -- node
 * runs it, exits 0, prints nothing) so its single nj-invoking child
 * produces empty, non-JSON stdout. r6bc.ts's close handler does
 * `JSON.parse(out)` with no try/catch around it -- today, an uncaught
 * exception, crashing the probe before any cleanup could run (once added)
 * gets a chance to. This is exactly the "injected throw" / "probe whose
 * nj command fails" case D189 asks this file to cover. */
{
  const base = freshScratchBase('r6bc-failure');
  const r = runProbe('r6bc.ts', '/dev/null', base);
  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check('r6bc.ts failure path: a broken nj really did make the probe fail (non-zero exit)',
    r.status !== 0, 'status=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 300));
  T.check('r6bc.ts failure path: HARNESS_SCRATCH_BASE is still empty after the probe dies on an uncaught exception',
    JSON.stringify(left) === JSON.stringify([]), detail(left, r));
  removeIfPresent(base);
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
  const sigs: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  for (const sig of sigs) await bcSignalLeg(sig);
  T.finish();
})();
