'use strict';
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
 * Each probe is invoked directly, not through baseline.js's corpus-
 * recording shim: whether a probe cleans up after itself does not depend
 * on whether its calls are being recorded, and driving it directly is the
 * simplest way to control HARNESS_SCRATCH_BASE per run. Every probe reads
 * its own nj path from argv[2] (`bc.js`'s own comment: "argv[2] zuerst:
 * ohne das laeuft die Sonde am Shim vorbei" -- the same convention
 * baseline.js's shim-spawn and verify.js's own direct-spawn both rely on);
 * `r8.js` reads `argv.slice(2)` as a list of nj binaries to compare and is
 * handed exactly one, which it already handles (its own ternaries guard
 * the absent second/third/fourth entry).
 *
 * H.NJ_BUNDLE, not H.NJ: every probe spawns `node <NJ> args` directly
 * (the same pre-D187 convention baseline.js itself still uses for NJ_ABS)
 * -- hand it `bin/nj` under the current, default run-all.js target and
 * `node bin/nj` is not valid JavaScript, an unrelated break (§ 18). The
 * bundle is always `node <path> args`-compatible.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

H.requireNj();

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRATCH_DIR = path.join(REPO_ROOT, 'tools', 'refactor-harness', 'scratch');
const TMP_ROOT = fs.realpathSync(os.tmpdir());

function discoverProbes() {
  if (!fs.existsSync(SCRATCH_DIR)) return [];
  return fs.readdirSync(SCRATCH_DIR).filter((n) => n.endsWith('.js') &&
    fs.readFileSync(path.join(SCRATCH_DIR, n), 'utf8').includes('mkdtempSync')).sort();
}

function freshScratchBase(label) {
  return fs.mkdtempSync(path.join(TMP_ROOT, 'nj-d189-' + label + '-'));
}

/** Run one probe directly against `njPath`, with HARNESS_SCRATCH_BASE set
 * to `scratchBase`. Returns the spawnSync result. */
function runProbe(name, njPath, scratchBase) {
  const p = path.join(SCRATCH_DIR, name);
  return spawnSync(process.execPath, [p, njPath], {
    cwd: SCRATCH_DIR,
    env: Object.assign({}, process.env, { HARNESS_SCRATCH_BASE: scratchBase }),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function removeIfPresent(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const probes = discoverProbes();
T.check('fixture: at least one mkdtempSync-using probe was found under ' + SCRATCH_DIR,
  probes.length > 0, JSON.stringify(probes));

/* Every "empty afterwards" failure detail names the probe's own exit
 * status and signal, not just the leftover listing -- a probe killed by
 * a timeout (test/run-all.js's own spawnSync timeout included: 120 s
 * here, SIGTERM by default) is otherwise indistinguishable at a glance
 * from one that ran to completion and simply failed to clean up (D189
 * follow-up: the gate found bc.js had left all 6 of its own dirs behind
 * in one run, and the detail line is what makes a kill-under-load
 * recognisable immediately instead of needing a second, manual repro). */
function detail(left, r) {
  return 'left=' + JSON.stringify(left) + ' status=' + r.status + ' signal=' + r.signal;
}

for (const name of probes) {
  const base = freshScratchBase(name.replace(/\.js$/, ''));
  const r = runProbe(name, H.NJ_BUNDLE, base);
  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check(name + ': the probe spawned and exited (did not fail to start)',
    !r.error, r.error && r.error.message);
  T.check(name + ': HARNESS_SCRATCH_BASE is empty once the probe exits',
    JSON.stringify(left) === JSON.stringify([]), detail(left, r));
  removeIfPresent(base);
}

/* Failure path, reached without touching any probe's own source: point
 * r6bc.js at a broken "nj" (`/dev/null`, a valid empty JS program -- node
 * runs it, exits 0, prints nothing) so its single nj-invoking child
 * produces empty, non-JSON stdout. r6bc.js's close handler does
 * `JSON.parse(out)` with no try/catch around it -- today, an uncaught
 * exception, crashing the probe before any cleanup could run (once added)
 * gets a chance to. This is exactly the "injected throw" / "probe whose
 * nj command fails" case D189 asks this file to cover. */
{
  const base = freshScratchBase('r6bc-failure');
  const r = runProbe('r6bc.js', '/dev/null', base);
  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check('r6bc.js failure path: a broken nj really did make the probe fail (non-zero exit)',
    r.status !== 0, 'status=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 300));
  T.check('r6bc.js failure path: HARNESS_SCRATCH_BASE is still empty after the probe dies on an uncaught exception',
    JSON.stringify(left) === JSON.stringify([]), detail(left, r));
  removeIfPresent(base);
}

/* ===================================================================== */
/* Signal legs (D189 follow-up) -- a probe killed by a signal mid-run     */
/* never reaches a process.on('exit', ...) handler by default; a fix     */
/* that only wires 'exit' leaves this path uncovered, exactly the gate's  */
/* own bc.js finding (SIGTERM ~0.4 s after start: exit 143, bc1-* stays   */
/* behind). Covered here for bc.js only (one probe is enough to prove    */
/* the class of bug) -- one leg each for SIGTERM, SIGINT and SIGHUP,     */
/* reached deterministically: poll the scratch base for the FIRST        */
/* fixture bc.js creates (bc1-*) rather than a fixed sleep, so the signal */
/* always lands once real work (a live mkdtempSync'd fixture, almost      */
/* certainly still in use by the nj child bc.js's own leg 1 just spawned) */
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
async function pollUntilNonEmpty(dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) return true;
    if (Date.now() >= deadline) return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    await sleep(20);
  }
}

/** Spawn bc.js against H.NJ_BUNDLE with HARNESS_SCRATCH_BASE = scratchBase,
 * send `sig` once its first fixture exists, and report what happened. */
async function bcSignalLeg(sig) {
  const base = freshScratchBase('bc-' + sig);
  const p = path.join(SCRATCH_DIR, 'bc.js');
  const child = spawn(process.execPath, [p, H.NJ_BUNDLE], {
    cwd: SCRATCH_DIR,
    env: Object.assign({}, process.env, { HARNESS_SCRATCH_BASE: base }),
  });
  const exitPromise = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

  const appeared = await pollUntilNonEmpty(base, 15000);
  T.check('bc.js ' + sig + ': fixture: the first fixture appeared before the signal was sent',
    appeared, 'base=' + base);
  child.kill(appeared ? sig : 'SIGKILL');

  const timedOut = { code: null, signal: null, timedOut: true };
  const exitInfo = await Promise.race([exitPromise, sleep(20000).then(() => timedOut)]);
  if (exitInfo.timedOut) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } await exitPromise; }

  const left = fs.existsSync(base) ? fs.readdirSync(base) : null;
  T.check('bc.js ' + sig + ': the probe really did end by that signal (result.signal === ' + JSON.stringify(sig) + ')',
    exitInfo.signal === sig, 'expected signal ' + sig + ', got code=' + exitInfo.code + ' signal=' + exitInfo.signal);
  T.check('bc.js ' + sig + ': HARNESS_SCRATCH_BASE is empty once the probe is killed mid-run',
    JSON.stringify(left) === JSON.stringify([]),
    'left=' + JSON.stringify(left) + ' code=' + exitInfo.code + ' signal=' + exitInfo.signal);
  removeIfPresent(base);
}

(async () => {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) await bcSignalLeg(sig);
  T.finish();
})();
