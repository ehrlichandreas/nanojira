/* Edge — the upward search tells "nothing here" from "could not look"
 * (§ 4 "Backlog location", DECISIONS 204, completing DECISIONS 93 F4).
 *
 * A probe on the search (`<dir>/.njrc`, `<dir>/backlog`) that fails with
 * ENOENT or ENOTDIR means "not here, keep walking". Any other error means
 * the search could not look there: `io_error`, exactly one stderr line
 * naming the directory and the OS reason — never `no_backlog`, and never a
 * walk on past it to some backlog further up.
 *
 * hardening-v3-1's D96 legs pin the headline case (an unsearchable
 * ancestor of the cwd, for list / bare / doctor / init). This file pins the
 * edges of the rule:
 *
 *   S1 --backlog / NJ_BACKLOG skip the search: an unsearchable ancestor of
 *      the cwd does not matter then.
 *   S2 the io_error line names the directory being searched and EACCES.
 *   S3 a `backlog` symlink loop in an ancestor (ELOOP) is io_error, not
 *      "not here".
 *   S4 the search stops at the first backlog it finds: the same loop one
 *      level ABOVE a found backlog is never probed.
 *   S5 a dangling `backlog` symlink is ENOENT: "not here", the search goes
 *      on and finds the backlog above it.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const mkdir = (p: string): string => { fs.mkdirSync(p, { recursive: true }); return p; };
const lines = (s: string): string[] => s.split('\n').filter((l) => l !== '');
const parse = (r: RunResult): any => { try { return JSON.parse(r.stdout); } catch { return null; } };
const ACCESS_RE = /EACCES|EPERM|permission denied|not permitted/i;

function initAt(dir: string) {
  const r = H.runNj(['init'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] });
  if (r.status !== 0) throw new Error('init in ' + dir + ' failed: ' + r.stderr);
}

/* Run nj from `<locked>/cwd` with `<locked>` at mode 000 (the D96 shell
 * wrapper, against the bundle so no nested launcher shell prints its own
 * getcwd banner first). */
function underLocked(args: string[], env: Record<string, string>): RunResult & { locked: string; missing?: string } {
  const root = H.freshDir('disc-locked');
  const locked = mkdir(path.join(root, 'locked'));
  const cwd = mkdir(path.join(locked, 'cwd'));
  const e: Record<string, string | undefined> = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW }, env);
  if (!('NJ_BACKLOG' in env)) delete e.NJ_BACKLOG;
  const inv = H.njCommand(H.NJ_BUNDLE as string, args);
  const r = spawnSync('/bin/sh',
    ['-c', 'cd "$1" || exit 97; chmod 000 "$2" || exit 98; shift 2; "$@"; rc=$?; chmod 755 "$0"; exit $rc',
      locked, cwd, locked, inv.cmd].concat(inv.args),
    { cwd: root, env: e as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60000 });
  try { fs.chmodSync(locked, 0o755); } catch { /* restored by the shell */ }
  const out: RunResult & { locked: string; missing?: string } = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', locked };
  if (r.error) out.missing = 'spawn failed: ' + r.error.message;
  else if (r.status === 97 || r.status === 98) out.missing = 'could not enter/lock the ancestor (exit ' + r.status + ')';
  return out;
}

/* Root searches anything; then the locked legs cannot be built. */
const lockable = (() => {
  const probe = H.freshDir('disc-lockprobe');
  const lk = mkdir(path.join(probe, 'l'));
  mkdir(path.join(lk, 'x'));
  fs.chmodSync(lk, 0o000);
  let searchable = false;
  try { fs.statSync(path.join(lk, 'x')); searchable = true; } catch { /* expected */ }
  fs.chmodSync(lk, 0o755);
  return !searchable;
})();

/* ---- S1 / S2: an unsearchable ancestor of the cwd ---- */
if (!lockable) {
  T.notCovered('S1/S2 unsearchable ancestor legs', 'a mode-000 directory is still searchable here (root?)');
} else {
  const elsewhere = H.freshDir('disc-elsewhere');
  initAt(elsewhere);
  const bl = path.join(elsewhere, 'backlog');

  const viaEnv = underLocked(['list', '--json'], { NJ_BACKLOG: bl });
  if (viaEnv.missing) T.notCovered('S1 NJ_BACKLOG', viaEnv.missing);
  else {
    T.exit('S1 NJ_BACKLOG skips the search: list under an unsearchable ancestor succeeds', viaEnv, 0);
    T.eq('S1 NJ_BACKLOG: reads that backlog', parse(viaEnv) && parse(viaEnv).backlog, bl);
  }
  const viaFlag = underLocked(['list', '--backlog=' + bl, '--json'], {});
  if (viaFlag.missing) T.notCovered('S1 --backlog', viaFlag.missing);
  else {
    T.exit('S1 --backlog skips the search: list under an unsearchable ancestor succeeds', viaFlag, 0);
    T.eq('S1 --backlog: reads that backlog', parse(viaFlag) && parse(viaFlag).backlog, bl);
  }

  const r = underLocked(['list'], {});
  const rj = underLocked(['list', '--json'], {});
  if (r.missing || rj.missing) T.notCovered('S2 the io_error line', r.missing || rj.missing || '');
  else {
    const cwd = path.join(r.locked, 'cwd');
    T.exit('S2 exit 1', r, 1);
    T.eq('S2 exactly one stderr line', lines(r.stderr).length, 1);
    T.contains('S2 the line names the directory it could not search', r.stderr, `cannot search ${cwd} for a backlog: `);
    T.check('S2 the line gives the OS reason', ACCESS_RE.test(r.stderr), r.stderr);
    T.eq('S2 --json: io_error', parse(rj) && parse(rj).error, 'io_error');
    T.check('S2 never no_backlog', !/no backlog found|no_backlog/.test(r.stderr + rj.stdout), r.stderr);
  }
}

/* ---- S3 / S4 / S5: symlinked `backlog` candidates ---- */
{
  // S3: <root>/backlog -> itself (ELOOP); cwd <root>/a/b, nothing nearer.
  const root = H.freshDir('disc-loop');
  fs.symlinkSync('backlog', path.join(root, 'backlog'));
  const cwd = mkdir(path.join(root, 'a', 'b'));
  const r = H.runNj(['list'], { cwd, unsetEnv: ['NJ_BACKLOG'] });
  const rj = H.runJson(['list'], { cwd, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('S3 a backlog symlink loop on the search: exit 1', r, 1);
  T.eq('S3 exactly one stderr line', lines(r.stderr).length, 1);
  T.contains('S3 the line names the directory', r.stderr, `cannot search ${root} for a backlog: `);
  T.check('S3 the line gives the OS reason (ELOOP)', /ELOOP|too many (levels of )?symbolic links/i.test(r.stderr), r.stderr);
  T.eq('S3 --json: io_error', rj.json && rj.json.error, 'io_error');

  // S4: a real backlog at <root>/a stops the search below the loop.
  initAt(path.join(root, 'a'));
  const found = H.runJson(['list'], { cwd, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('S4 the search stops at the first backlog: the loop above is never probed', found, 0);
  T.eq('S4 reads the nearer backlog', found.json && found.json.backlog, path.join(root, 'a', 'backlog'));
}
{
  // S5: <root>/a/backlog -> a missing target; a real backlog at <root>.
  const root = H.freshDir('disc-dangling');
  initAt(root);
  mkdir(path.join(root, 'a'));
  fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'a', 'backlog'));
  const cwd = mkdir(path.join(root, 'a', 'b'));
  const r = H.runJson(['list'], { cwd, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('S5 a dangling backlog symlink is "not here": the search goes on', r, 0);
  T.eq('S5 reads the backlog above it', r.json && r.json.backlog, path.join(root, 'backlog'));
}

T.finish();
