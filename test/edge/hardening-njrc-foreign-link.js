'use strict';
/* DECISIONS 98 / § 4 "Ownership": "For a symlinked `.njrc` both the link and
 * its target must pass." — the direction a non-root user cannot build: a
 * symlink owned by ANOTHER uid, pointing at a target the current user owns.
 *
 * Split from `hardening-v3-1.js` on purpose. Making a symlink owned by
 * someone else needs root (`lchown`), or an existing foreign symlink on the
 * scratch filesystem to hard-link. Where neither exists this file reports
 * `— CANNOT RUN` on its first line, which `run-all.js` counts as a coverage
 * gap, not as a failure — so the rest of the hardening suite can still go
 * green on such a machine, and the gap stays visible in every summary.
 *
 * On macOS the hard-link route is closed as well: link(2) follows a symlink
 * and links its target (checked: the result is detected and reported as
 * CANNOT RUN, never run as if it were the link). It works where link(2)
 * does not follow (Linux), and as root everywhere.
 *
 * Black box: nj via spawnSync; exit code, stdout, stderr and file bytes.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function canon(p) {
  try { return fs.realpathSync(p); } catch (e) { /* fall through */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch (e) { return path.resolve(p); }
}

const ME = typeof process.getuid === 'function' ? process.getuid() : null;
const SEARCH_ROOTS = ['/Users/Shared', '/private/var/db', '/private/var/tmp', '/Library/Preferences',
  '/Library/Caches', '/private/var/log', '/var/lib', '/var/cache', '/var/log', '/usr/share'];

function cannotRun(reason) {
  console.log('FAIL ' + path.basename(__filename) + ' — CANNOT RUN');
  console.log('  ' + reason);
  console.log('  Not a defect: this machine offers no symlink owned by another uid, and');
  console.log('  making one needs root. Run as root (or where such a link exists) to cover it.');
  process.exit(1);
}

function findForeignSymlink(dev) {
  let found = null, visited = 0;
  function walk(dir, depth) {
    if (found || depth > 4 || visited > 40000) return;
    let kids;
    try { kids = fs.readdirSync(dir); } catch (e) { return; }
    for (const k of kids) {
      if (found) return;
      visited++;
      const p = path.join(dir, k);
      let st;
      try { st = fs.lstatSync(p); } catch (e) { continue; }
      if (st.isSymbolicLink() && st.dev === dev && st.uid !== 0 && st.uid !== ME) { found = p; return; }
      if (st.isDirectory()) walk(p, depth + 1);
    }
  }
  for (const r of SEARCH_ROOTS) walk(r, 0);
  return found;
}

if (ME === null) cannotRun('no process.getuid() on this platform — ownership is POSIX');

/* Decide feasibility before any scratch directory exists, so a CANNOT RUN
 * leaves nothing behind. */
/* The same device `H.freshDir()`'s own fixtures live on (H.TMP_ROOT, not
 * os.tmpdir() — see harness.js for why), so a found foreign symlink can
 * actually be hard-linked into the fixtures this file builds below. */
const foreignLink = ME === 0 ? null : findForeignSymlink(fs.statSync(H.TMP_ROOT).dev);
if (ME !== 0 && !foreignLink) {
  cannotRun('not root, and no symlink owned by a non-root uid other than ' + ME +
    ' on the scratch filesystem (searched ' + SEARCH_ROOTS.join(', ') + ')');
}

const HOME = H.freshDir('fl-home');
const root = H.freshDir('fl');
const proj = path.join(root, 'proj');
const work = path.join(proj, 'work');
fs.mkdirSync(work, { recursive: true });
const rc = path.join(proj, '.njrc');
function giveUp(reason) {
  for (const d of [HOME, root]) fs.rmSync(d, { recursive: true, force: true });
  cannotRun(reason);
}

/* The target is always ours (or root's, when we are root): empty, so an nj
 * that checked only the target would accept it and search on. */
const target = path.join(proj, 'own-target.njrc');
fs.writeFileSync(target, '');

let linkUid;
if (ME === 0) {
  fs.symlinkSync(target, rc);
  try { fs.lchownSync(rc, 1, 0); } catch (e) { giveUp('lchown failed as root: ' + e.message); }
  linkUid = fs.lstatSync(rc).uid;
} else {
  try { fs.linkSync(foreignLink, rc); } catch (e) { giveUp('hard-linking the foreign symlink ' + foreignLink + ' failed: ' + e.code); }
  const st = fs.lstatSync(rc);
  if (!st.isSymbolicLink() || st.uid === ME || st.uid === 0) {
    giveUp('hard-linking ' + foreignLink + ' gave ' + (st.isSymbolicLink() ? 'a link of uid ' + st.uid : 'the link\'s target, not the link'));
  }
  linkUid = st.uid;
}

/* A backlog above, so a link that is obeyed or skipped instead of refused
 * shows up as a successful read. */
{
  const bl = path.join(root, 'backlog');
  const i = H.runNj(['init', '--backlog=' + bl], { cwd: root, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('fixture: nj init builds the backlog above', i, 0);
}

const OWNED_RE = /^Error: invalid \.njrc at (.+): owned by uid (\d+), not by you$/m;
for (const [desc, args] of [['list', ['list']], ['init', ['init']]]) {
  const d = 'D98 a foreign-owned symlink → my own target, ' + desc;
  const r = H.runNj(args, { cwd: work, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
  T.exit(d + ': exit 1', r, 1);
  const m = OWNED_RE.exec(r.stderr || '');
  T.check(d + ': stderr carries "Error: invalid .njrc at <abs path>: owned by uid <n>, not by you" (§ 4)',
    !!m, 'stderr = ' + J(r.stderr) + ', stdout = ' + J(String(r.stdout).slice(0, 200)));
  if (m) {
    T.check(d + ': the path is that .njrc (the link)', canon(path.dirname(m[1])) === canon(proj) && path.basename(m[1]) === '.njrc', J(m[1]));
    T.eq(d + ': the uid is the LINK\'s owner', m[2], String(linkUid));
  }
  const rj = H.runJson(args, { cwd: work, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
  T.exit(d + ' --json: exit 1', rj, 1);
  T.eq(d + ' --json: error is invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
  if (desc === 'init') T.check(d + ': no ./backlog created', !fs.existsSync(path.join(work, 'backlog')), path.join(work, 'backlog'));
}

/* ===================================================================== */
/* E.1 (D138, § 4) — NJ_FAULT=njrc-swap: the SAME foreign-link scenario   */
/* above, made deterministic instead of a chance race. `nj` is paused in  */
/* the window between the ownership `lstat` and the `open()`; while it    */
/* waits, `.njrc` is swapped from a benign, self-owned target to the      */
/* foreign-owned link, then released. A hit here proves the ownership     */
/* check runs against what the fd actually opens — the post-swap target — */
/* not a decision cached from the pre-swap `lstat`.                       */
/* ===================================================================== */
(async () => {
  const { spawn } = require('child_process');
  function startNj(args, o) {
    const env = Object.assign({}, process.env, o.env || {});
    delete env.NJ_BACKLOG;
    const inv = H.njCommand(H.NJ, args);
    const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    return new Promise(resolve => {
      child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
      child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
    });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const tag = 'E.1 [NJ_FAULT=njrc-swap, deterministic]';
  const root2 = H.freshDir('fl-swap');
  const proj2 = path.join(root2, 'proj');
  const work2 = path.join(proj2, 'work');
  fs.mkdirSync(work2, { recursive: true });
  const rc2 = path.join(proj2, '.njrc');
  const bl2 = path.join(root2, 'backlog');

  /* The initial, benign .njrc: self-owned, resolves to a real backlog —
   * what the pre-swap `lstat` sees, and what a buggy pre-open-only check
   * would keep trusting. */
  {
    const i = H.runNj(['init', '--backlog=' + bl2], { cwd: root2, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check(tag + ' fixture: nj init builds the backlog above', i.status === 0, J(i.stderr));
    fs.writeFileSync(rc2, 'backlog = ' + bl2 + '\n');
  }
  /* Sanity: that benign .njrc, alone, is accepted (no swap in play). */
  {
    const solo = H.runNj(['list'], { cwd: work2, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check(tag + ' fixture: the benign .njrc alone is accepted', solo.status === 0, J(solo.stderr));
  }

  const donePromise = startNj(['list', '--json'],
    { cwd: work2, env: { HOME, NJ_FAULT: 'njrc-swap' } });
  await sleep(1000);                                  // let nj finish its lstat, enter the wait
  fs.unlinkSync(rc2);
  if (ME === 0) {
    fs.symlinkSync(target, rc2);
    try { fs.lchownSync(rc2, 1, 0); } catch (e) { T.check(tag + ' fixture: lchown for the swap', false, e.message); }
  } else {
    fs.linkSync(foreignLink, rc2);                    // the same foreign link used above
  }
  fs.writeFileSync(path.join(proj2, '.nj-fault-go'), '');   // release nj — the swap is already in place
  const r = await donePromise;

  T.exit(tag + ': exit 1 (the post-swap, foreign-owned target wins)', r, 1);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check(tag + ': --json still parses (no crash)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.eq(tag + ': error is invalid_njrc, not fault:njrc-swap — the timeout never happened, the marker did', json && json.error, 'invalid_njrc');
  const m = OWNED_RE.exec(r.stderr || '');
  T.check(tag + ': stderr names the foreign uid (proves the fd-based check saw the post-swap target)',
    !!m && m[2] === String(linkUid), 'stderr = ' + J(r.stderr) + ', expected uid ' + linkUid);
  T.check(tag + ': no ./backlog created under work2 (the read never proceeded)',
    !fs.existsSync(path.join(work2, 'backlog')), path.join(work2, 'backlog'));

  T.finish();
})();
