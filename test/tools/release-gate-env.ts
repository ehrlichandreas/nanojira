/* The release gate (`npm test` = `node test/run-all.ts`, no argument) has to
 * be able to go green in the environment tools/release.ts is actually run
 * in. The 4.1.0 release rehearsal (DECISIONS 202) found four ways it could
 * not, none of them a defect of nanojira itself; each case below runs the
 * affected test file the way the gate does and pins it green:
 *
 *   A. GIT_CONFIG_* one-off config in the outer environment -- exactly how
 *      release.ts's own header says to supply the signing identity --
 *      outranks every fixture repo's own `git config user.signingkey`.
 *      ac-56's fixture tags then could not be signed and the file crashed.
 *      The harness now scrubs those variables when it loads.
 *   B. ac-15 copied the nanojira under test ALONE into a bare directory and
 *      ran it with `node` -- but under the gate that is bin/nanojira, the sh
 *      launcher (D187), not a bundle. It now copies the bundle the launcher
 *      runs (H.NJ_BUNDLE).
 *   D. ac-15 reported CANNOT RUN whenever neither NJ_NODE nor a portable
 *      runtime/ above the checkout existed, even with a perfectly good Node
 *      >= 24 running it. It now falls back to process.execPath then; an
 *      explicit NJ_NODE that does not exist is still CANNOT RUN.
 *   J. `.gitignore`'s `node_modules/` (trailing slash) matches only a
 *      directory, never the node_modules SYMLINK every worktree and scratch
 *      clone of this repo carries.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AC15 = path.join(ROOT, 'test', 'ac', 'ac-15-no-dependencies.ts');
const AC56 = path.join(ROOT, 'test', 'ac', 'ac-56-exported-skill-folder.ts');
const LAUNCHER = path.join(ROOT, 'bin', 'nanojira');

interface Run { status: number | null; stdout: string; stderr: string; }

/* Runs one test file the way run-all does (`<node> <file> <nj>`), with
 * `set` merged over this process's environment and `unset` removed. */
function runTestFile(file: string, nj: string, set: Record<string, string>, unset: string[]): Run {
  const env: Record<string, string | undefined> = Object.assign({}, process.env, set);
  for (const k of unset) delete env[k];
  const r = spawnSync(process.execPath, [file, nj], { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function tail(r: Run): string {
  return ('exit ' + r.status + '\n' + r.stdout + r.stderr).split('\n').slice(-12).join('\n');
}

/* ---- A: ac-56 under a leaked GIT_CONFIG_* signing identity ---------------- */
{
  const r = runTestFile(AC56, H.NJ as string, {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.signingkey', GIT_CONFIG_VALUE_0: '0000000000000000000000000000000000000000',
    GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'leak@example.invalid',
    GIT_CONFIG_PARAMETERS: "'user.name'='leak probe'",
  }, []);
  T.check('A: ac-56 is green with GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS in the outer environment',
    r.status === 0 && /^PASS ac-56/m.test(r.stdout), tail(r));
}

/* ---- B: ac-15 against the bin/ launcher, as `npm test` runs it ------------ */
{
  const r = runTestFile(AC15, LAUNCHER, { NJ_NODE: H.NODE }, []);
  T.check('B: ac-15 is green when the nanojira under test is the bin/nanojira launcher',
    r.status === 0 && /^PASS ac-15/m.test(r.stdout), tail(r));
}

/* ---- D: ac-15 with no NJ_NODE at all -------------------------------------- */
{
  const major = parseInt(process.version.replace(/^v/, ''), 10);
  if (major >= 24) {
    const r = runTestFile(AC15, LAUNCHER, {}, ['NJ_NODE']);
    T.check('D: ac-15 without NJ_NODE, run by a Node >= 24: green, not CANNOT RUN',
      r.status === 0 && /^PASS ac-15/m.test(r.stdout), tail(r));
  } else {
    T.check('D: this suite runs on Node >= 24 (§ 3)', false, process.version);
  }
  const bogus = path.join(H.freshDir('gate-env-no-node'), 'node');
  const pinned = runTestFile(AC15, LAUNCHER, { NJ_NODE: bogus }, []);
  T.check('D: an explicit NJ_NODE that does not exist is still CANNOT RUN (no silent fallback)',
    pinned.status !== 0 && /CANNOT RUN/.test(pinned.stdout), tail(pinned));
}

/* ---- J: .gitignore ignores a node_modules symlink ------------------------- */
{
  const dir = H.freshDir('gate-env-gitignore');
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const r = spawnSync('git', ['check-ignore', '-q', 'node_modules'], { cwd: dir, encoding: 'utf8' });
  T.eq('J: .gitignore ignores node_modules when it is a symlink', r.status, 0);
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  T.check('J: git status does not list the node_modules symlink', !/node_modules/.test(st.stdout), st.stdout);
}

T.finish();
