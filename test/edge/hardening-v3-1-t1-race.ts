/* @serial: T1 runs a busy-loop swapper (one full core, up to 90 s) beside 500 nj runs each held to a 5 s hang timeout (run-all.ts, test/README.md) */
/* Hardening after V3-1, T1 follow-up -- the `.njrc` swap race for a plain
 * file, split out of edge/hardening-v3-1.ts so that only this leg runs in
 * the serial phase; the rest of that file is pool-safe (freshDir-only
 * writes, a pinned HOME, no process-wide state). The leg below is moved
 * verbatim; HOME, run(), J(), cannotRun() and FoundFile are the same
 * definitions as there.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function cannotRun(desc: string, reason: string | undefined): void { T.notCovered(desc, reason || '(no reason given)'); }

/* HOME is pinned so no real ~/.njrc can take part; NJ_BACKLOG is unset
 * unless a leg sets it. */
const HOME = H.freshDir('hard-home');
interface Opts { cwd?: string; env?: Record<string, string | undefined> }
function envFor(o: Opts) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset: string[] = env.NJ_BACKLOG === undefined ? ['NJ_BACKLOG'] : [];
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args: string[], o: Opts) { return H.runNj(args, envFor(o)); }

type FoundFile = { path: string; size: number; uid: number } | null;

/* ===================================================================== */
/* T1 (follow-up) — the `.njrc` ownership check for a PLAIN FILE still    */
/* races: swap a root-owned decoy and a foreign-owned payload under one   */
/* path while `nj list` runs repeatedly (docs/verification/v3-2-followup */
/* .md, Verifier, finding T1)                                            */
/* ===================================================================== */

/*
 * The symlink case (D98 above) is covered by a fd-based re-check already.
 * The still-open gap is the PLAIN FILE: `lstat`-then-`open`, both by path.
 * Swap the path's target between those two syscalls and the bytes `open`
 * reads are not the bytes `lstat` approved.
 *
 * This needs two REAL files owned by different, non-me uids — one root's,
 * one a third party's — with genuinely different content, so a leak is
 * black-box OBSERVABLE: an accepted root file and a leaked foreign file
 * must be tellable apart from the outside. Two canonical macOS files are
 * tried first (the Verifier's own repro: `/private/etc/hosts`, root-owned,
 * never empty; a CoreMediaIO/AssetCache-style plist under
 * `/Library/Preferences`, commonly owned by a system service account) and
 * a directory search is the fallback. Without both → not covered, never a
 * guess (README "not covered").
 */

/*
 * A note on how reliably this leg catches the bug. The race itself is real
 * and reproduces readily (several hits per 300–500 iterations) when `nj` is
 * driven in a tight loop directly from a shell, with the swapper as a sibling
 * shell background job — confirmed independently, outside this test file, as
 * part of writing it. Driven through this harness's own `spawnSync` instead
 * — `nj` as a *grandchild of a Node.js parent* — the same swapper, against
 * the same binary, did not land a single hit across many 300–500-iteration
 * attempts in the sandboxed tool this suite was authored in, including with
 * multiple concurrent swappers and several process-spawning strategies
 * (`spawn`, `spawn` detached+unref, via an intermediate `/bin/sh -c`, async
 * concurrent batches). Swapper throughput was comparable or higher in every
 * case, so the gap is not a matter of swap speed; it looks like a property of
 * that specific nested-Node-process environment, not of the race or of this
 * code. The checks below are written as a REAL assertion, not a tolerant
 * "not covered" escape hatch (README, AC-7's retry leg is the precedent for
 * when that is the right call; this is not that case) — if your environment
 * doesn't land a hit either, that is a report-worthy gap in THIS leg's
 * reliability, not evidence the race is fixed.
 */
const RACE_ME = typeof process.getuid === 'function' ? process.getuid() : null;
const RACE_CANDIDATE_ROOTS = ['/Library/Preferences', '/Library/Caches', '/Users/Shared',
  '/private/var/db', '/private/var/log'];

/* Smallest READABLE, NON-EMPTY file under `dir` (recursively, bounded)
 * matching `pred(lstat)`, on the same device as `dev` (hard-linking needs
 * that). Content must be non-empty so a leaked read is distinguishable
 * from an accepted one — unlike the single empty file F1 above settles
 * for, which does not need to be. */
function findNonEmptyFile(pred: (st: fs.Stats) => boolean, dev: number): FoundFile {
  let best: FoundFile = null, visited = 0;
  function walk(dir: string, depth: number): void {
    if ((best && best.size > 0) || depth > 3 || visited > 20000) return;
    let kids: string[]; try { kids = fs.readdirSync(dir); } catch (e) { return; }
    for (const k of kids) {
      if (best && best.size > 0) return;
      visited++;
      const p = path.join(dir, k);
      let st: fs.Stats; try { st = fs.lstatSync(p); } catch (e) { continue; }
      if (st.dev !== dev) continue;
      if (st.isDirectory()) { walk(p, depth + 1); continue; }
      if (!st.isFile() || st.size === 0 || !pred(st)) continue;
      try { fs.accessSync(p, fs.constants.R_OK); } catch (e) { continue; }
      best = { path: p, size: st.size, uid: st.uid };
    }
  }
  for (const r of RACE_CANDIDATE_ROOTS) walk(r, 0);
  return best;
}

function findRaceFile(kind: 'root' | 'foreign', dev: number): FoundFile {
  const canonical = kind === 'root' ? ['/private/etc/hosts', '/etc/hosts']
    : ['/Library/Preferences/com.apple.AssetCache.plist'];
  for (const p of canonical) {
    try {
      const st = fs.statSync(p);
      if (st.dev !== dev || st.size === 0) continue;
      if (kind === 'root' ? st.uid !== 0 : (st.uid === 0 || st.uid === RACE_ME)) continue;
      fs.accessSync(p, fs.constants.R_OK);
      return { path: p, size: st.size, uid: st.uid };
    } catch (e) { /* try the next */ }
  }
  const pred = kind === 'root' ? (st: fs.Stats) => st.uid === 0 : (st: fs.Stats) => st.uid !== 0 && st.uid !== RACE_ME;
  return findNonEmptyFile(pred, dev);
}

/* The swapper runs as its own OS process (Node is single-threaded, and the
 * foreground drives `nj` with blocking `spawnSync` calls) so it keeps
 * racing WHILE each `nj list` runs, not only between calls. It alternates
 * `.njrc` between fresh hard links to the two master files — `rename(2)`
 * is what both the finding and the fix discuss, and a hard link costs
 * nothing to recreate each round (it is a second directory entry on the
 * same inode, never a copy). Stops when `stopFlag` appears. */
function swapperSource(rcPath: string, decoyMaster: string, payloadMaster: string, stopFlag: string): string {
  return [
    'const fs = require(' + JSON.stringify('fs') + ');',
    'const rc = ' + JSON.stringify(rcPath) + ';',
    'const decoyMaster = ' + JSON.stringify(decoyMaster) + ';',
    'const payloadMaster = ' + JSON.stringify(payloadMaster) + ';',
    'const stop = ' + JSON.stringify(stopFlag) + ';',
    'const decoyLink = rc + ".decoy-link";',
    'const payloadLink = rc + ".payload-link";',
    'let rounds = 0;',
    'while (!fs.existsSync(stop)) {',
    '  rounds++;',
    '  try { fs.linkSync(decoyMaster, decoyLink); } catch (e) {}',
    '  try { fs.renameSync(decoyLink, rc); } catch (e) {}',
    '  try { fs.linkSync(payloadMaster, payloadLink); } catch (e) {}',
    '  try { fs.renameSync(payloadLink, rc); } catch (e) {}',
    '}',
    'try { fs.writeFileSync(stop + ".rounds", String(rounds)); } catch (e) {}',
  ].join('\n');
}

{
  const tag = 'T1-follow-up [.njrc swap race, plain file]';
  /* The same device H.freshDir()'s own fixtures live on (H.TMP_ROOT, not
   * os.tmpdir() — see harness.ts for why). */
  const dev = fs.statSync(H.TMP_ROOT).dev;
  const decoy = findRaceFile('root', dev);
  const payload = findRaceFile('foreign', dev);
  if (RACE_ME === null) {
    cannotRun(tag, 'no process.getuid() on this platform — ownership is POSIX');
  } else if (!decoy) {
    cannotRun(tag, 'no readable, non-empty root-owned file found under ' + RACE_CANDIDATE_ROOTS.join(', '));
  } else if (!payload) {
    cannotRun(tag, 'no readable, non-empty file owned by a foreign, non-root uid found under ' + RACE_CANDIDATE_ROOTS.join(', '));
  } else {
    const payloadSignature = fs.readFileSync(payload.path, 'utf8').split('\n').find(l => l.trim() !== '');
    if (!payloadSignature) {
      cannotRun(tag, 'the payload candidate (' + payload.path + ') has no non-blank line to detect a leak by');
    } else {
      /* ---- fixture sanity: each file alone, statically, behaves as the  */
      /* single-shot F1/D98 legs already pin — so a leak below is known to */
      /* come from the RACE, not from these files failing to trigger it.  */
      const dir = H.freshDir('hard-t1race');
      const rc = path.join(dir, '.njrc');
      fs.linkSync(payload.path, rc);
      const soloPayload = run(['list'], { cwd: dir });
      T.exit(tag + ' fixture: the payload ALONE is refused (exit 1)', soloPayload, 1);
      T.check(tag + ' fixture: the payload ALONE never leaks its content',
        !(soloPayload.stdout + soloPayload.stderr).includes(payloadSignature),
        J((soloPayload.stdout + soloPayload.stderr)).slice(0, 300));
      T.check(tag + ' fixture: the payload ALONE is refused by ownership, naming its uid',
        new RegExp('owned by uid ' + payload.uid + ', not by you').test(soloPayload.stderr), J(soloPayload.stderr));
      fs.unlinkSync(rc);
      fs.linkSync(decoy.path, rc);
      const soloDecoy = run(['list'], { cwd: dir });
      T.check(tag + ' fixture: the decoy ALONE is accepted by ownership (root)',
        !/owned by uid/.test(soloDecoy.stderr || ''), J(soloDecoy.stderr));
      fs.unlinkSync(rc);

      /* ---- the race itself -------------------------------------------- */
      const stopFlag = path.join(dir, '.stop-race');
      const swapperFile = path.join(dir, '.swapper.js');
      fs.writeFileSync(swapperFile, swapperSource(rc, decoy.path, payload.path, stopFlag));
      const swapper = spawn(H.NODE, [swapperFile], { stdio: 'ignore', detached: false });
      let leaked = false, leakedSample = '', hung = 0, badExit = [], frames = 0;
      const N = 500;
      const DEADLINE_MS = 90000;
      const started = Date.now();
      let ran = 0;
      try {
        for (; ran < N && Date.now() - started < DEADLINE_MS; ran++) {
          const env = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW, HOME });
          delete env.NJ_BACKLOG;
          const inv = H.njCommand(H.NJ as string, ['list']);
          const r = spawnSync(inv.cmd, inv.args, { cwd: dir, env, encoding: 'utf8', timeout: 5000 });
          if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') { hung++; continue; }
          const out = (r.stdout || '') + (r.stderr || '');
          if (out.includes(payloadSignature)) { leaked = true; if (!leakedSample) leakedSample = out.slice(0, 400); }
          if (/^\s*at .*:\d+:\d+\)?$/m.test(out)) frames++;
          if (r.status !== 0 && r.status !== 1) badExit.push(r.status === null ? (r.signal || 'null') : r.status);
        }
      } finally {
        fs.writeFileSync(stopFlag, '');
        if (swapper && swapper.pid) {
          try { swapper.kill('SIGTERM'); } catch (e) { /* already gone */ }
        }
      }
      T.check(tag + ': at least one iteration ran (fixture is not vacuous)', ran > 0, 'ran = ' + ran);
      T.check(tag + ': nothing hangs — no run was killed for a timeout', hung === 0, hung + ' of ' + ran + ' runs hung');
      T.check(tag + ': no run crashed with a stack trace', frames === 0, frames + ' of ' + ran + ' runs');
      T.eq(tag + ': every exit code is 0 (accepted the root file) or 1 (refused)', badExit, []);
      T.check(tag + ': the foreign file\'s content is NEVER parsed, across ' + ran + ' runs — no message quotes its first line',
        !leaked, 'leaked on at least one run: ' + J(leakedSample));
      try { fs.unlinkSync(rc); } catch (e) { /* may not exist */ }
      try { fs.unlinkSync(rc + '.decoy-link'); } catch (e) { /* */ }
      try { fs.unlinkSync(rc + '.payload-link'); } catch (e) { /* */ }
    }
  }
}

T.finish();
