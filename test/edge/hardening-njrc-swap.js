'use strict';
/* NJ_FAULT=njrc-swap — the non-root leg (§ 4, D137/D138/D139, v3.2 § E.1,
 * promoted 625e083; confirmed by D139, fc3359e, after 5633007 briefly got
 * the ordering backwards and was reverted, 10aa169).
 *
 * The hook fires BETWEEN the ownership `lstat` and the `open()` — exactly
 * where TSK-029's residual race lives, not after `open()`. So a `.njrc`
 * *path* swap during the pause is NOT inert: `open()` hasn't happened yet,
 * and when it finally runs (after the marker, or the 10 s timeout), it
 * opens whatever is now at the path — the SWAPPED-IN file, not whatever the
 * original `lstat` saw. `nj` must then check ownership and read content
 * consistently from that one, newly-opened file. This is deterministically
 * testable without root: swap `.njrc`'s path for a file the SAME user
 * owns, naming a completely different backlog, during the pause.
 *
 * This is the leg hardening-njrc-foreign-link.js's E.1 section cannot be:
 * that one additionally swaps in a FOREIGN-owned link (needs root or a
 * foreign symlink on the filesystem) to exercise the privilege half of the
 * race. This file needs neither, and must run as covered on every machine.
 *
 * Black box: nj as a real child process (spawn, not spawnSync — the pause
 * has to be driven live); exit code, stdout, stderr and the resolved
 * backlog path.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function canon(p) {
  if (typeof p !== 'string') return null;
  try { return fs.realpathSync(p); } catch (e) { /* fall through */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch (e) { return path.resolve(p); }
}

const HOME = H.freshDir('njswap-home');

/** Returns {child, done}: `child` to inspect liveness directly (whether the
 * pause is real, not merely a wall-clock coincidence), `done` for the
 * eventual result. */
function startNj(args, o) {
  const env = Object.assign({}, process.env, o.env || {});
  delete env.NJ_BACKLOG;
  const child = spawn(H.NODE, [H.NJ].concat(args), { cwd: o.cwd, env });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const done = new Promise(resolve => {
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
  return { child, done };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Two real, independent backlogs (A, B) plus a project dir with `.njrc`
 * initially naming A, and a work/ subfolder below it for `nj` to run from.
 * Each backlog gets its own distinguishing marker element, so a read that
 * actually reaches one or the other is independently checkable. */
function fixture(label) {
  const dir = H.freshDir(label);
  const proj = path.join(dir, 'proj');
  const work = path.join(proj, 'work');
  fs.mkdirSync(work, { recursive: true });
  const blA = path.join(dir, 'backlog-a');
  const blB = path.join(dir, 'backlog-b');
  for (const [bl, title] of [[blA, 'Marker in A'], [blB, 'Marker in B']]) {
    const i = H.runNj(['init', '--backlog=' + bl], { cwd: dir, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check('fixture: nj init builds ' + path.basename(bl), i.status === 0, J(i.stderr));
    const mk = H.runNj(['new', '--type=epic', '--title=' + title, '--description=D.', '--backlog=' + bl],
      { cwd: dir, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check('fixture: ' + title + ' exists', mk.status === 0, J(mk.stderr));
  }
  const rc = path.join(proj, '.njrc');
  fs.writeFileSync(rc, 'backlog = ' + blA + '\n');
  return { dir, proj, work, rc, blA, blB };
}

/** A same-user replacement `.njrc`, naming a DIFFERENT backlog, installed
 * via an ATOMIC rename onto the original path (never unlink+create). */
function swapTo(x, targetBl) {
  const swapFile = path.join(x.proj, '.njrc.swap-in');
  fs.writeFileSync(swapFile, 'backlog = ' + targetBl + '\n');
  fs.renameSync(swapFile, x.rc);
}

/* ===================================================================== */
/* S1 — released by the go-marker: `nj` uses the SWAPPED-IN content        */
/* (open() has not happened yet when the hook fires — § 4)                 */
/* ===================================================================== */
(async () => {
  const tag = 'S1 [marker release]';
  const x = fixture('njswap-s1');

  const { child, done } = startNj(['list', '--json'], { cwd: x.work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
  await sleep(1000);                                  // let nj reach the pre-open pause
  T.check(tag + ': nj is genuinely still running — paused for the hook, not already exited',
    child.exitCode === null, 'exitCode = ' + child.exitCode + ' (a real pause must still be in progress here)');
  swapTo(x, x.blB);                                    // same-user, different backlog, atomic rename
  fs.writeFileSync(path.join(x.proj, '.nj-fault-go'), '');
  const r = await done;

  T.exit(tag + ': exit 0 — open() runs after the swap, on the new content', r, 0);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check(tag + ': --json still parses (no crash, no hang)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.check(tag + ': the resolved backlog is the SWAPPED-IN B, not the original A',
    !!json && canon(json.backlog) === canon(x.blB), 'backlog = ' + J(json && json.backlog) + ', expected ' + x.blB);
  const titles = (json && json.entries || []).map(e => e.title);
  T.check(tag + ': the marker element from B is actually present in the read (content, not just the path, is consistent)',
    titles.includes('Marker in B'), J(titles));
  T.check(tag + ': the marker element from A is NOT present — nothing is merged from the original',
    !titles.includes('Marker in A'), J(titles));

  await s2(); await s3(); await s4(); await s5(); T.finish();
})();

/* ===================================================================== */
/* S2 — released by the ~10s TIMEOUT (no marker ever created): the same    */
/* outcome as S1, just arrived at later — § 4 says "proceed with whatever  */
/* is at that path by then" on timeout, the same as a marker release,     */
/* not an abort (njrc-swap has no fault:njrc-swap outcome, unlike          */
/* before-compare's distinct timeout behaviour)                            */
/* ===================================================================== */
async function s2() {
  const tag = 'S2 [timeout release, no marker]';
  const x = fixture('njswap-s2');

  const { child, done } = startNj(['list', '--json'], { cwd: x.work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
  await sleep(1000);                                  // let nj reach the pre-open pause
  T.check(tag + ': nj is genuinely still running when the swap happens',
    child.exitCode === null, 'exitCode = ' + child.exitCode);
  swapTo(x, x.blB);                                    // swapped in, but no marker ever follows
  const t0 = Date.now();
  const r = await done;                                // resolves only once nj's own ~10s timeout elapses
  const elapsed = Date.now() - t0;

  T.exit(tag + ': exit 0 — the timeout, like the marker, just lets nj proceed to open()', r, 0);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check(tag + ': --json still parses', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.check(tag + ': the resolved backlog is the SWAPPED-IN B, same as the marker-release case',
    !!json && canon(json.backlog) === canon(x.blB), 'backlog = ' + J(json && json.backlog) + ', expected ' + x.blB);
  T.check(tag + ': no fault:njrc-swap code — timeout "proceeds", it does not abort (§ 4)',
    !(json && json.error), 'error = ' + J(json && json.error));
  T.check(tag + ': roughly one ~10s wait, not instantaneous and not doubled',
    elapsed > 8000 && elapsed < 16000, 'elapsed ' + elapsed + 'ms');
}

/* ===================================================================== */
/* S3 — `.njrc` is REMOVED (not replaced) during the pause: treated as     */
/* absent at that level, the search continues to the next ancestor         */
/* (D140). Two endings: one where an outer ancestor's own `.njrc` is       */
/* found (3a), one where nothing is and the search ends in `no_backlog`    */
/* (3b) — proving either way that NOTHING falls back to the old content.   */
/* ===================================================================== */
async function s3() {
  /* 3a: an outer ancestor directory has its own .njrc, naming a third,
   * independent backlog C — the search must reach it once proj/.njrc is
   * gone, exactly as if proj/ had never had a .njrc of its own. */
  {
    const tag = 'S3a [removed, outer .njrc found]';
    const outer = H.freshDir('njswap-s3a');
    const proj = path.join(outer, 'proj');
    const work = path.join(proj, 'work');
    fs.mkdirSync(work, { recursive: true });
    const blA = path.join(outer, 'backlog-a');
    const blC = path.join(outer, 'backlog-c');
    for (const [bl, title] of [[blA, 'Marker in A'], [blC, 'Marker in C']]) {
      const i = H.runNj(['init', '--backlog=' + bl], { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
      T.check(tag + ' fixture: nj init builds ' + path.basename(bl), i.status === 0, J(i.stderr));
      const mk = H.runNj(['new', '--type=epic', '--title=' + title, '--description=D.', '--backlog=' + bl],
        { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
      T.check(tag + ' fixture: ' + title + ' exists', mk.status === 0, J(mk.stderr));
    }
    const outerRc = path.join(outer, '.njrc');
    fs.writeFileSync(outerRc, 'backlog = ' + blC + '\n');
    const innerRc = path.join(proj, '.njrc');
    fs.writeFileSync(innerRc, 'backlog = ' + blA + '\n');

    const { child, done } = startNj(['list', '--json'], { cwd: work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
    await sleep(1000);                                  // let nj reach the pre-open pause, on proj/.njrc
    T.check(tag + ': nj is genuinely still running when .njrc is removed',
      child.exitCode === null, 'exitCode = ' + child.exitCode);
    fs.unlinkSync(innerRc);                               // removed outright, nothing put back
    fs.writeFileSync(path.join(proj, '.nj-fault-go'), '');
    const r = await done;

    T.exit(tag + ': exit 0 — the search continues upward and succeeds', r, 0);
    let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.check(tag + ': --json still parses (no crash)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
    T.check(tag + ': resolves the OUTER ancestor\'s own .njrc (backlog C), not A',
      !!json && canon(json.backlog) === canon(blC), 'backlog = ' + J(json && json.backlog) + ', expected ' + blC);
    const titles = (json && json.entries || []).map(e => e.title);
    T.check(tag + ': the marker element from C is present', titles.includes('Marker in C'), J(titles));
    T.check(tag + ': the marker element from A (the removed .njrc\'s target) is NOT present — no stale fall-back',
      !titles.includes('Marker in A'), J(titles));
  }
  /* 3b: no ancestor has anything at all — the search must end in
   * no_backlog, not a crash and not a silent success on stale content. */
  {
    const tag = 'S3b [removed, nothing else found: no_backlog]';
    const outer = H.freshDir('njswap-s3b');
    const proj = path.join(outer, 'proj');
    const work = path.join(proj, 'work');
    fs.mkdirSync(work, { recursive: true });
    const blA = path.join(outer, 'backlog-a');
    const i = H.runNj(['init', '--backlog=' + blA], { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check(tag + ' fixture: nj init builds backlog-a', i.status === 0, J(i.stderr));
    const innerRc = path.join(proj, '.njrc');
    fs.writeFileSync(innerRc, 'backlog = ' + blA + '\n');

    const { child, done } = startNj(['list', '--json'], { cwd: work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
    await sleep(1000);
    T.check(tag + ': nj is genuinely still running when .njrc is removed',
      child.exitCode === null, 'exitCode = ' + child.exitCode);
    fs.unlinkSync(innerRc);
    fs.writeFileSync(path.join(proj, '.nj-fault-go'), '');
    const r = await done;

    T.exit(tag + ': exit 1 — no backlog found anywhere above', r, 1);
    let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.check(tag + ': --json still parses (no crash)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
    T.eq(tag + ': error is no_backlog, not a stale read of A and not fault:njrc-swap',
      json && json.error, 'no_backlog');
  }
}

/* ===================================================================== */
/* S4 — `.njrc` is a SYMLINK; the LINK ITSELF is unlinked during the       */
/* pause (D142, § 4: "removed outright" means the link, for a symlinked    */
/* .njrc). Same outcome as S3a: absent at that level, search continues     */
/* upward to the outer ancestor's own .njrc — NOT invalid_njrc.            */
/* ===================================================================== */
async function s4() {
  const tag = 'S4 [symlink .njrc, LINK removed, outer .njrc found]';
  const outer = H.freshDir('njswap-s4');
  const proj = path.join(outer, 'proj');
  const work = path.join(proj, 'work');
  fs.mkdirSync(work, { recursive: true });
  const blA = path.join(outer, 'backlog-a');
  const blC = path.join(outer, 'backlog-c');
  for (const [bl, title] of [[blA, 'Marker in A'], [blC, 'Marker in C']]) {
    const i = H.runNj(['init', '--backlog=' + bl], { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check(tag + ' fixture: nj init builds ' + path.basename(bl), i.status === 0, J(i.stderr));
    const mk = H.runNj(['new', '--type=epic', '--title=' + title, '--description=D.', '--backlog=' + bl],
      { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
    T.check(tag + ' fixture: ' + title + ' exists', mk.status === 0, J(mk.stderr));
  }
  const outerRc = path.join(outer, '.njrc');
  fs.writeFileSync(outerRc, 'backlog = ' + blC + '\n');
  const target = path.join(proj, 'target.njrc');
  fs.writeFileSync(target, 'backlog = ' + blA + '\n');
  const innerRc = path.join(proj, '.njrc');
  fs.symlinkSync(target, innerRc);                      // .njrc is a symlink → target → backlog A

  const { child, done } = startNj(['list', '--json'], { cwd: work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
  await sleep(1000);
  T.check(tag + ': nj is genuinely still running when the link is removed',
    child.exitCode === null, 'exitCode = ' + child.exitCode);
  fs.unlinkSync(innerRc);                               // the LINK itself is gone; target.njrc still exists
  fs.writeFileSync(path.join(proj, '.nj-fault-go'), '');
  const r = await done;

  T.exit(tag + ': exit 0 — the search continues upward and succeeds', r, 0);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check(tag + ': --json still parses (no crash)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.check(tag + ': resolves the OUTER ancestor\'s own .njrc (backlog C), not A, and not invalid_njrc',
    !!json && canon(json.backlog) === canon(blC), 'backlog = ' + J(json && json.backlog) + ', expected ' + blC + ', got error ' + J(json && json.error));
  const titles = (json && json.entries || []).map(e => e.title);
  T.check(tag + ': the marker element from C is present', titles.includes('Marker in C'), J(titles));
  T.check(tag + ': the marker element from A is NOT present', !titles.includes('Marker in A'), J(titles));
}

/* ===================================================================== */
/* S5 — `.njrc` is a SYMLINK; the link stays but its TARGET is removed     */
/* during the pause, leaving a dangling symlink. Distinct from S4 (D142):  */
/* the link itself is still there, so this is the already-existing        */
/* dangling-symlink case — invalid_njrc, as today, NOT "absent".           */
/* ===================================================================== */
async function s5() {
  const tag = 'S5 [symlink .njrc, TARGET removed → dangling, invalid_njrc]';
  const outer = H.freshDir('njswap-s5');
  const proj = path.join(outer, 'proj');
  const work = path.join(proj, 'work');
  fs.mkdirSync(work, { recursive: true });
  const blA = path.join(outer, 'backlog-a');
  const i = H.runNj(['init', '--backlog=' + blA], { cwd: outer, env: { HOME }, unsetEnv: ['NJ_BACKLOG'] });
  T.check(tag + ' fixture: nj init builds backlog-a', i.status === 0, J(i.stderr));
  const target = path.join(proj, 'target.njrc');
  fs.writeFileSync(target, 'backlog = ' + blA + '\n');
  const innerRc = path.join(proj, '.njrc');
  fs.symlinkSync(target, innerRc);

  const { child, done } = startNj(['list', '--json'], { cwd: work, env: { HOME, NJ_FAULT: 'njrc-swap' } });
  await sleep(1000);
  T.check(tag + ': nj is genuinely still running when the target is removed',
    child.exitCode === null, 'exitCode = ' + child.exitCode);
  fs.unlinkSync(target);                                // the TARGET is gone; the link itself still exists
  fs.writeFileSync(path.join(proj, '.nj-fault-go'), '');
  const r = await done;

  T.exit(tag + ': exit 1 — a dangling symlink is invalid_njrc, not "absent"', r, 1);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check(tag + ': --json still parses (no crash)', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.eq(tag + ': error is invalid_njrc (the existing dangling-symlink rule), not no_backlog',
    json && json.error, 'invalid_njrc');
}
