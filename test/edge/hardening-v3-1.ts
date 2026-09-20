/* Hardening after V3-1 — DECISIONS 93 findings F1, F3, F4 (TSK-029).
 *
 * Derived from spec v3 only, written before the implementation:
 *
 * F1  § 4 `.njrc`, "Ownership": "A `.njrc` the search reaches must be owned
 *     by the current user or by root; otherwise the command exits 1 with
 *     `invalid_njrc` and `nj: invalid .njrc at <abs path>: owned by uid <n>,
 *     not by you` — never silently skipped, never obeyed. … `--backlog` and
 *     `NJ_BACKLOG` stop the search first and so bypass the check."
 *     § 4 `nj init` consults "the nearest `.njrc`", so init is bound too.
 *
 * F3  § 14 `--fix`: "While `config:invalid` … holds, `--fix` writes nothing
 *     … a directory that is not a valid backlog — reached by a mistyped
 *     `--backlog` or `NJ_BACKLOG` — must not receive tombstones, moves or
 *     rewrites." § 14 reporting: the exit code reflects the state after.
 *
 * F4  § 9 closed vocabulary gains `io_error`; § 9 spec-named paths: "a
 *     filesystem call on a named target fails (`init` into a read-only or
 *     non-directory parent; a deleted working directory) → `io_error`".
 *     DECISIONS 93 F4: "one line naming the path and the OS reason, never a
 *     stack."
 *
 * D96 § 4 lexing and odd files that AC-21 A7b does not cover (FIFO,
 *     ELOOP, a BOM not at the very start, a lone `\r`), and an unsearchable
 *     ancestor of the cwd as one more `io_error` case.
 *
 * Black box: nj is driven through spawnSync, and only exit code, stdout,
 * stderr and file bytes are asserted. Backlogs are made with `nj init` (and
 * `nj new`) rather than by hand, so this suite follows the layout move of
 * V3-4 without edits: nothing here depends on where the config lives.
 *
 * The prose prefix is the implementation's `Error: `; § 4's `nj: ` lines
 * illustrate the message, not the prefix (DECISIONS 88).
 *
 * A leg that cannot be exercised on this machine fails with `CANNOT RUN:
 * <reason>` in its detail — never a silent pass (README "not covered").
 */
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function cannotRun(desc: string, reason: string | undefined): void { T.check(desc, false, 'CANNOT RUN: ' + reason); }

/* /var and /private/var are one place on macOS: compare by the folder named. */
function canon(p: string): string {
  try { return fs.realpathSync(p); } catch (e) { /* fall through */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch (e) { return path.resolve(p); }
}
function samePath(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && canon(a) === canon(b);
}
/* Does `text` name `p`, in either its given or its canonical spelling? */
function names(text: unknown, p: string): boolean {
  const s = String(text || '');
  return s.includes(p) || s.includes(canon(p));
}

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
function runJ(args: string[], o: Opts) { return H.runJson(args, envFor(o)); }

function mkdir(p: string): string { fs.mkdirSync(p, { recursive: true }); return p; }

/* A backlog made by nj itself, holding one epic whose title is the marker
 * that identifies WHICH backlog a later command read. */
function initBacklog(target: string, marker: string): string {
  const cwd = mkdir(path.dirname(target));
  const i = run(['init', '--backlog=' + target], { cwd });
  const n = run(['new', '--type=epic', '--title=' + marker, '--backlog=' + target], { cwd });
  if (i.missing || n.missing || i.status !== 0 || n.status !== 0) {
    T.check('fixture: nj init + nj new build the marker backlog at ' + target, false,
      'init: ' + i.status + ' ' + J(i.stderr) + '; new: ' + n.status + ' ' + J(n.stderr));
  }
  return target;
}

function titles(json: any): string[] {
  return json && Array.isArray(json.entries) ? json.entries.map((e: any) => e && e.title) : [];
}

/* Minimal shape shared by every spawn-result-like object this suite passes
 * to noStack()/stderrLines() — the real RunResult/JsonRunResult from the
 * harness, and the ad hoc {status, stdout, stderr, ...} shapes built by this
 * file's own deleted-cwd / locked-ancestor / bounded-run helpers below. */
interface HasOutput { stdout: string; stderr: string }

/* The whole tree under `root`, every entry with its type, mode, mtime and —
 * for files — its bytes. Symlinks are recorded, never followed. Two equal
 * snapshots mean nothing was created, removed, renamed or rewritten. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  function walk(abs: string, rel: string): void {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e) { out.push(rel + ' ?' + (e as NodeJS.ErrnoException).code); return; }
    const head = rel + ' mode=' + (st.mode & 0o7777).toString(8) + ' mtime=' + st.mtimeMs;
    if (st.isSymbolicLink()) { out.push(head + ' link->' + fs.readlinkSync(abs)); return; }
    if (st.isDirectory()) {
      out.push(head + ' dir');
      let kids: string[] = [];
      try { kids = fs.readdirSync(abs).sort(); } catch (e) { out.push(rel + '/ ?' + (e as NodeJS.ErrnoException).code); }
      for (const k of kids) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    let sha = '?';
    try { sha = H.sha256(fs.readFileSync(abs)); } catch (e) { sha = '?' + (e as NodeJS.ErrnoException).code; }
    out.push(head + ' size=' + st.size + ' sha=' + sha);
  }
  walk(root, '.');
  return out;
}
function sameTree(desc: string, before: string[], after: string[]) {
  const gone = before.filter(l => !after.includes(l));
  const added = after.filter(l => !before.includes(l));
  return T.check(desc, gone.length === 0 && added.length === 0,
    (gone.length ? 'before only: ' + J(gone.slice(0, 8)) + '\n     ' : '') +
    (added.length ? 'after only:  ' + J(added.slice(0, 8)) : ''));
}

/* No "    at fn (file:line)" frames anywhere a caller can see. */
const FRAME_RE = /^\s+at\s+\S/m;
function noStack(desc: string, r: HasOutput) {
  T.check(desc + ': no stack trace on stderr', !FRAME_RE.test(r.stderr || ''), 'stderr = ' + J(r.stderr));
  T.check(desc + ': no stack trace on stdout', !FRAME_RE.test(r.stdout || ''), 'stdout = ' + J(r.stdout));
}
function stderrLines(r: HasOutput): string[] { return String(r.stderr || '').split('\n').filter(l => l.trim() !== ''); }

/* ===================================================================== */
/* F1 — .njrc ownership (§ 4 "Ownership", DECISIONS 93 F1)               */
/* ===================================================================== */

/*
 * Making a file owned by another uid takes root (chown). Without root this
 * suite looks for a file that GENUINELY belongs to another, non-root uid on
 * this machine and hard-links it into the scratch tree as `.njrc`. A hard
 * link is the file itself — one inode, one owner — so there is no question
 * of whose ownership counts (for a symlink both count — DECISIONS 98, see
 * the D98 section below). The link is only a directory entry in
 * a scratch folder we own; removing it does not touch the original.
 *
 * The file has to be on the scratch directory's filesystem, readable (so
 * the only thing wrong with it is its owner) and preferably empty (so a
 * `.njrc` that is obeyed instead of refused sets no location and the search
 * visibly continues past it).
 */
const ME = typeof process.getuid === 'function' ? process.getuid() : null;
const SEARCH_ROOTS = ['/Users/Shared', '/private/var/db', '/private/var/tmp', '/Library/Preferences',
  '/Library/Caches', '/private/var/log', '/var/lib', '/var/cache', '/var/log', '/usr/share'];

type FoundFile = { path: string; size: number; uid: number } | null;
function findFile(pred: (st: fs.Stats) => boolean, tmpDev: number): FoundFile {
  let best: FoundFile = null, visited = 0;
  function walk(dir: string, depth: number): void {
    if (best && best.size === 0) return;
    if (depth > 4 || visited > 40000) return;
    let kids: string[];
    try { kids = fs.readdirSync(dir); } catch (e) { return; }
    for (const k of kids) {
      if (best && best.size === 0) return;
      visited++;
      const p = path.join(dir, k);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch (e) { continue; }
      if (st.dev !== tmpDev) continue;
      if (st.isDirectory()) { walk(p, depth + 1); continue; }
      if (!st.isFile() || !pred(st)) continue;
      try { fs.accessSync(p, fs.constants.R_OK); } catch (e) { continue; }
      if (!best || st.size < best.size) best = { path: p, size: st.size, uid: st.uid };
    }
  }
  for (const r of SEARCH_ROOTS) walk(r, 0);
  return best;
}

/* Place a `.njrc` in `dir` that is owned by a foreign or a root uid. Returns
 * {rc, uid, how} or {reason} when this machine offers no way. */
interface RcResult { reason?: string; rc?: string; uid?: number; how?: string; size?: number }
function plantRc(dir: string, kind: 'foreign' | 'root'): RcResult {
  mkdir(dir);
  const rc = path.join(dir, '.njrc');
  if (ME === null) return { reason: 'no process.getuid() on this platform — ownership is POSIX' };
  if (ME === 0) {
    fs.writeFileSync(rc, '');
    const uid = kind === 'foreign' ? 1 : 0;
    try { fs.chownSync(rc, uid, 0); } catch (e) { return { reason: 'chown failed as root: ' + (e as Error).message }; }
    return { rc, uid, how: 'chown to uid ' + uid };
  }
  if (kind === 'root' || kind === 'foreign') {
    const tmpDev = fs.statSync(dir).dev;
    const pred = kind === 'root' ? (st: fs.Stats) => st.uid === 0 : (st: fs.Stats) => st.uid !== 0 && st.uid !== ME;
    const cached = _found[kind] !== undefined ? _found[kind] : (_found[kind] = findFile(pred, tmpDev));
    if (!cached) {
      return { reason: 'not root, and no readable ' + (kind === 'root' ? 'root-owned' : 'non-root, non-' + ME + ' uid') +
        ' file on the scratch filesystem to hard-link (searched ' + SEARCH_ROOTS.join(', ') + ')' };
    }
    try { fs.linkSync(cached.path, rc); } catch (e) {
      return { reason: 'hard-linking ' + cached.path + ' as .njrc failed: ' + (e as NodeJS.ErrnoException).code };
    }
    const st = fs.lstatSync(rc);
    if (kind === 'foreign' && (st.uid === ME || st.uid === 0)) return { reason: 'link reports uid ' + st.uid };
    return { rc, uid: st.uid, size: st.size, how: 'hard link to ' + cached.path };
  }
  throw new Error('plantRc kind ' + kind);
}
const _found: Record<string, FoundFile> = {};

/* § 4: "invalid .njrc at <abs path>: owned by uid <n>, not by you", behind
 * the `Error: ` prefix (DECISIONS 88). */
const OWNED_RE = /^Error: invalid \.njrc at (.+): owned by uid (\d+), not by you$/m;

function ownershipRefusal(desc: string, args: string[], o: Opts, rc: string, uid: number, root: string) {
  const before = snapshot(root);
  const r = run(args, o);
  T.exit(desc + ': exit 1', r, 1);
  const m = OWNED_RE.exec(r.stderr || '');
  T.check(desc + ': stderr carries "Error: invalid .njrc at <abs path>: owned by uid <n>, not by you" (§ 4)',
    !!m, 'stderr = ' + J(r.stderr) + ', stdout = ' + J(String(r.stdout).slice(0, 300)));
  if (m) {
    T.check(desc + ': the path is the absolute path of that .njrc',
      path.isAbsolute(m[1]) && samePath(m[1], rc), 'path = ' + J(m[1]) + ', expected ' + J(rc));
    T.eq(desc + ': the uid is the file\'s owner', m[2], String(uid));
  }
  noStack(desc, r);
  const rj = runJ(args, o);
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: failure shape {ok:false, error} (§ 9)',
    !!rj.json && rj.json.ok === false && typeof rj.json.error === 'string', J(rj.json || rj.stdout).slice(0, 300));
  T.eq(desc + ' --json: error is invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
  T.check(desc + ' --json: never a read shape with entries', !(rj.json && Array.isArray(rj.json.entries)),
    J(rj.json).slice(0, 300));
  T.check(desc + ' --json: the prose error still reaches stderr (§ 9)', OWNED_RE.test(rj.stderr || ''),
    'stderr = ' + J(rj.stderr));
  sameTree(desc + ': nothing created, removed or rewritten anywhere in the scratch tree', before, snapshot(root));
  return r;
}

/*   root/
 *     backlog/          ← found by nothing unless the search falls through
 *     proj/.njrc        ← owned by another uid (empty)
 *     proj/work/        ← cwd
 *
 * Every leg gets its own fixture: against an nj that obeys the planted file,
 * a refused write would otherwise land in the shared backlog and turn the
 * following legs red for a reason that is not theirs. */
interface F1Fixture { root: string; OUTER: string; proj: string; work: string; reason?: string; rc?: string; uid?: number; how?: string; size?: number }
function f1Fixture(): F1Fixture {
  const root = H.freshDir('hard-f1');
  const OUTER = initBacklog(path.join(root, 'backlog'), 'Outer marker');
  const proj = mkdir(path.join(root, 'proj'));
  const work = mkdir(path.join(proj, 'work'));
  return Object.assign({ root, OUTER, proj, work }, plantRc(proj, 'foreign'));
}

const f1Probe = f1Fixture();
if (!f1Probe.rc) {
  cannotRun('F1 a .njrc owned by another uid is refused', f1Probe.reason);
} else {
  const legs: [string, string[], 'work' | 'proj'][] = [
    ['F1 list, foreign .njrc in an ancestor', ['list'], 'work'],
    ['F1 list, foreign .njrc in the cwd', ['list'], 'proj'],
    ['F1 bare nj, foreign .njrc', [], 'work'],
    ['F1 show, foreign .njrc', ['show', '--id=EPIC-001'], 'work'],
    ['F1 tree, foreign .njrc', ['tree'], 'work'],
    ['F1 new (a write), foreign .njrc', ['new', '--type=epic', '--title=Planted'], 'work'],
    /* doctor is lenient about the backlog, not about the location rules:
     * § 4 says "the command exits 1", so not 0 and not doctor's 2. */
    ['F1 doctor, foreign .njrc', ['doctor'], 'work'],
    ['F1 doctor --fix, foreign .njrc', ['doctor', '--fix'], 'work'],
    /* § 4 `nj init`: the target comes from "the nearest `.njrc`" — the
     * finding's own case is init creating a backlog where a planted file
     * says. Refused: no ./backlog in the cwd, nothing anywhere. */
    ['F1 init, foreign .njrc in an ancestor', ['init'], 'work'],
    ['F1 init, foreign .njrc in the cwd', ['init'], 'proj'],
  ];
  for (const [desc, args, where] of legs) {
    const x = f1Fixture();
    ownershipRefusal(desc, args, { cwd: x[where] }, x.rc as string, x.uid as number, x.root);
    if (args[0] === 'init') {
      T.check(desc + ': no ./backlog created in the cwd', !fs.existsSync(path.join(x[where], 'backlog')),
        'exists: ' + path.join(x[where], 'backlog'));
    }
  }

  /* "never silently skipped": the outer backlog must not be what answered. */
  {
    const x = f1Fixture();
    const lj = runJ(['list'], { cwd: x.work });
    T.check('F1 the search does not fall through to the outer backlog',
      !titles(lj.json).includes('Outer marker') && !(lj.json && samePath(lj.json.backlog, x.OUTER)),
      J(lj.json).slice(0, 300));
  }

  /* --backlog and NJ_BACKLOG stop the search first and bypass the check. */
  {
    const x = f1Fixture();
    const o = { cwd: x.work };
    const fl = runJ(['list', '--backlog=' + x.OUTER], o);
    T.exit('F1 --backlog bypasses the check: exit 0', fl, 0);
    T.eq('F1 --backlog bypasses the check: reads the flagged backlog', titles(fl.json), ['Outer marker']);
    const ev = runJ(['list'], Object.assign({ env: { NJ_BACKLOG: x.OUTER } }, o));
    T.exit('F1 NJ_BACKLOG bypasses the check: exit 0', ev, 0);
    T.eq('F1 NJ_BACKLOG bypasses the check: reads that backlog', titles(ev.json), ['Outer marker']);
    const flRel = runJ(['list', '--backlog=../../backlog'], o);
    T.exit('F1 a relative --backlog bypasses the check too: exit 0', flRel, 0);
    T.eq('F1 a relative --backlog bypasses the check too: reads that backlog', titles(flRel.json), ['Outer marker']);
    const fdoc = runJ(['doctor', '--backlog=' + x.OUTER], o);
    T.exit('F1 doctor --backlog bypasses the check: exit 0 on a clean backlog', fdoc, 0);
    const T1 = path.join(x.root, 'via-flag');
    const fi = run(['init', '--backlog=' + T1], o);
    T.exit('F1 init --backlog bypasses the check: exit 0', fi, 0);
    T.check('F1 init --backlog bypasses the check: the backlog exists', fs.existsSync(T1), T1);
    const T2 = path.join(x.root, 'via-env');
    const ei = run(['init'], Object.assign({ env: { NJ_BACKLOG: T2 } }, o));
    T.exit('F1 init via NJ_BACKLOG bypasses the check: exit 0', ei, 0);
    T.check('F1 init via NJ_BACKLOG bypasses the check: the backlog exists', fs.existsSync(T2), T2);
  }

  /* "A `.njrc` the search REACHES": one shadowed by a nearer source is
   * never reached, so it cannot fail the run. */
  {
    const x = f1Fixture();
    const near = mkdir(path.join(x.work, 'near-rc'));
    fs.writeFileSync(path.join(near, '.njrc'), 'backlog = ../../../backlog\n');
    const nr = runJ(['list'], { cwd: near });
    T.exit('F1 a nearer own .njrc shadows the foreign one: exit 0', nr, 0);
    T.eq('F1 a nearer own .njrc shadows the foreign one: reads its target', titles(nr.json), ['Outer marker']);
    const nearBl = mkdir(path.join(x.work, 'near-bl'));
    initBacklog(path.join(nearBl, 'backlog'), 'Near marker');
    const nb = runJ(['list'], { cwd: nearBl });
    T.exit('F1 a nearer backlog/ shadows the foreign .njrc: exit 0', nb, 0);
    T.eq('F1 a nearer backlog/ shadows the foreign .njrc: reads it', titles(nb.json), ['Near marker']);
  }
}

/* Owned by the current user → works (the ordinary case, AC-21 in the
 * small, re-asserted here next to its refusal). */
{
  const root = H.freshDir('hard-f1-own');
  const BL = initBacklog(path.join(root, 'shared', 'bl'), 'Own marker');
  const proj = mkdir(path.join(root, 'proj'));
  const work = mkdir(path.join(proj, 'work'));
  fs.writeFileSync(path.join(proj, '.njrc'), 'backlog = ../shared/bl\n');
  T.eq('F1 control: the .njrc belongs to the current user', ME === null ? null : fs.statSync(path.join(proj, '.njrc')).uid, ME);
  const r = runJ(['list'], { cwd: work });
  T.exit('F1 own .njrc: list exit 0', r, 0);
  T.eq('F1 own .njrc: list reads its target', titles(r.json), ['Own marker']);
  T.check('F1 own .njrc: --json reports that backlog', !!r.json && samePath(r.json.backlog, BL), J(r.json && r.json.backlog));
  fs.writeFileSync(path.join(proj, '.njrc'), 'backlog = ../shared/fresh\n');
  const i = run(['init'], { cwd: work });
  T.exit('F1 own .njrc: init exit 0', i, 0);
  T.check('F1 own .njrc: init creates the backlog the .njrc names',
    fs.existsSync(path.join(root, 'shared', 'fresh')), path.join(root, 'shared', 'fresh'));
}

/* Owned by root → works. An empty root-owned `.njrc` sets no location, so
 * the search continues to the backlog above it (§ 4 "A `.njrc` without
 * `backlog` … the search continues upward"), and init falls back to
 * ./backlog. */
{
  const root = H.freshDir('hard-f1-root');
  initBacklog(path.join(root, 'backlog'), 'Above root rc');
  const proj = mkdir(path.join(root, 'proj'));
  const work = mkdir(path.join(proj, 'work'));
  const f = plantRc(proj, 'root');
  if (!f.rc) {
    cannotRun('F1 a root-owned .njrc is accepted', f.reason);
  } else if (f.size !== 0 && f.size !== undefined) {
    cannotRun('F1 a root-owned .njrc is accepted', 'the only root-owned file found is not empty (' + f.how + ')');
  } else {
    T.eq('F1 root control: the .njrc is owned by uid 0', fs.statSync(f.rc).uid, 0);
    const r = runJ(['list'], { cwd: work });
    T.exit('F1 root-owned .njrc: list exit 0', r, 0);
    T.eq('F1 root-owned .njrc (no backlog key): the search continues to the backlog above', titles(r.json), ['Above root rc']);
    const i = run(['init'], { cwd: work });
    T.exit('F1 root-owned .njrc: init exit 0', i, 0);
    T.check('F1 root-owned .njrc (no backlog key): init creates ./backlog',
      fs.existsSync(path.join(work, 'backlog')), path.join(work, 'backlog'));
  }
}

/* ===================================================================== */
/* D98 — a symlinked `.njrc`: link AND target; ownership is checked first */
/* ===================================================================== */

/* § 4 (as amended by DECISIONS 98): "For a symlinked `.njrc` both the link
 * and its target must pass. Ownership is checked before the file is read, so
 * it is reported ahead of every other `.njrc` fault."
 *
 * Foreign-owned things are, again, real ones found on this machine (as root:
 * made and chown'ed). A symlink we create is ours; its TARGET can be a
 * foreign file or directory anywhere, so no hard link and no same-filesystem
 * rule is needed there. The one direction a non-root user cannot build — a
 * FOREIGN link to an own target — lives in its own file,
 * `hardening-njrc-foreign-link.ts`, so that on a machine without such a link
 * it reports CANNOT RUN (a coverage gap) instead of turning this whole suite
 * red forever. */

/* First entry under SEARCH_ROOTS for which pred(lstat, path) holds. */
type FoundEntry = { path: string; uid: number; size: number } | null;
function findEntry(pred: (st: fs.Stats, p: string) => boolean, dev?: number): FoundEntry {
  let found: FoundEntry = null, visited = 0;
  function walk(dir: string, depth: number): void {
    if (found || depth > 4 || visited > 40000) return;
    let kids: string[];
    try { kids = fs.readdirSync(dir); } catch (e) { return; }
    for (const k of kids) {
      if (found) return;
      visited++;
      const p = path.join(dir, k);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch (e) { continue; }
      if (dev !== undefined && st.dev !== dev) { if (!st.isDirectory()) continue; }
      if ((dev === undefined || st.dev === dev) && pred(st, p)) { found = { path: p, uid: st.uid, size: st.size }; return; }
      if (st.isDirectory()) walk(p, depth + 1);
    }
  }
  for (const r of SEARCH_ROOTS) walk(r, 0);
  return found;
}
const isForeign = (st: fs.Stats): boolean => ME !== null && st.uid !== 0 && st.uid !== ME;
function readable(p: string): boolean { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch (e) { return false; } }

/* Would § 4 reject this content with "line <n>: …"? (Only then does
 * "ownership first" show: a parse-first nj would print the line error.) */
function malformedNjrc(buf: Buffer): boolean {
  let t = buf.toString('utf8');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  if (/\r(?!\n)/.test(t)) return true;
  for (const raw of t.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) return true;
    if (line.slice(0, i).trim() !== 'backlog' || line.slice(i + 1).trim() === '') return true;
  }
  return false;
}

/* A foreign-owned thing of `kind`, or {reason}. As root it is made here. */
interface ForeignThingResult { reason?: string; path?: string; uid?: number; size?: number }
const _foreign: Record<string, ForeignThingResult> = {};
function foreignThing(kind: 'file' | 'dir' | 'malformed' | 'unreadable', dev?: number): ForeignThingResult {
  if (_foreign[kind]) return _foreign[kind];
  let r: ForeignThingResult;
  if (ME === null) r = { reason: 'no process.getuid() on this platform' };
  else if (ME === 0) {
    const d = H.freshDir('hard-d98-own');
    const p = path.join(d, kind);
    if (kind === 'dir') fs.mkdirSync(p);
    else fs.writeFileSync(p, kind === 'malformed' ? 'this line has no equals sign\n' : '');
    if (kind === 'unreadable') fs.chmodSync(p, 0o000);
    fs.chownSync(p, 1, 0);
    r = { path: p, uid: 1 };
  } else {
    const preds: Record<'file' | 'dir' | 'malformed' | 'unreadable', (st: fs.Stats, p: string) => boolean> = {
      'file': (st, p) => st.isFile() && isForeign(st) && st.size === 0 && readable(p),
      'dir': st => st.isDirectory() && isForeign(st),
      'malformed': (st, p) => st.isFile() && isForeign(st) && st.size > 0 && st.size < 1 << 20 && readable(p) &&
        malformedNjrc(fs.readFileSync(p)),
      'unreadable': (st, p) => st.isFile() && isForeign(st) && !readable(p),
    };
    const hit = findEntry(preds[kind], kind === 'malformed' || kind === 'unreadable' ? dev : undefined);
    r = hit || { reason: 'not root, and no foreign-owned ' + kind + ' found under ' + SEARCH_ROOTS.join(', ') +
      (dev !== undefined ? ' on the scratch filesystem' : '') };
  }
  _foreign[kind] = r;
  return r;
}

/* root/backlog (marker), root/proj/.njrc (the case), cwd root/proj/work */
function d98Fixture(label: string) {
  const root = H.freshDir(label);
  const OUTER = initBacklog(path.join(root, 'backlog'), 'Outer marker');
  const proj = mkdir(path.join(root, 'proj'));
  const work = mkdir(path.join(proj, 'work'));
  return { root, OUTER, proj, work, rc: path.join(proj, '.njrc') };
}

/* 63: my link → a foreign file / a foreign directory. Refused with the
 * TARGET's uid; for the directory, ownership comes ahead of "not a regular
 * file" (65). */
for (const [kind, desc] of [
  ['file', 'D98 my symlink → a foreign-owned file'],
  ['dir', 'D98 my symlink → a foreign-owned directory (ownership before "not a regular file")'],
] as ['file' | 'dir', string][]) {
  const t = foreignThing(kind);
  if (!t.path) { cannotRun(desc, t.reason); continue; }
  for (const [what, args] of [['list', ['list']], ['init', ['init']]] as [string, string[]][]) {
    const x = d98Fixture('hard-d98-' + kind);
    fs.symlinkSync(t.path, x.rc);
    ownershipRefusal(desc + ', ' + what, args, { cwd: x.work }, x.rc, t.uid as number, x.root);
  }
}

/* 63 control: my link → a root-owned empty file passes; the empty .njrc
 * sets nothing and the search continues to the backlog above. */
{
  const desc = 'D98 control: my symlink → a root-owned empty file is accepted';
  const t = ME === 0 ? { path: '/dev/null', uid: 0 } :
    findEntry((st, p) => st.isFile() && st.uid === 0 && st.size === 0 && readable(p));
  if (!t || !t.path) cannotRun(desc, 'no readable, empty, root-owned file found under ' + SEARCH_ROOTS.join(', '));
  else {
    const x = d98Fixture('hard-d98-rootlink');
    fs.symlinkSync(t.path, x.rc);
    const r = runJ(['list'], { cwd: x.work });
    T.exit(desc + ': exit 0', r, 0);
    T.eq(desc + ': the search continues to the backlog above', titles(r.json), ['Outer marker']);
  }
}

/* 65: ownership first — a foreign file that is ALSO malformed, or ALSO
 * unreadable, gets the ownership message, never "line <n>" or a read error:
 * a foreign file is never parsed. Hard links (same filesystem). */
for (const [kind, desc] of [
  ['malformed', 'D98 a foreign-owned AND malformed .njrc: the ownership message, not "line <n>"'],
  ['unreadable', 'D98 a foreign-owned AND unreadable .njrc: the ownership message, not a read error'],
] as ['malformed' | 'unreadable', string][]) {
  const x = d98Fixture('hard-d98-' + kind);
  const t = foreignThing(kind, fs.statSync(x.proj).dev);
  if (!t.path) { cannotRun(desc, t.reason); continue; }
  try { fs.linkSync(t.path, x.rc); } catch (e) { cannotRun(desc, 'hard-linking ' + t.path + ' failed: ' + (e as NodeJS.ErrnoException).code); continue; }
  const r = ownershipRefusal(desc, ['list'], { cwd: x.work }, x.rc, t.uid as number, x.root);
  T.check(desc + ': no "line <n>:" in the message', !/invalid \.njrc at .*: line \d+:/.test(r.stderr || ''), J(r.stderr));
}

/* ===================================================================== */
/* F3 — `doctor --fix` on a non-backlog writes nothing (§ 14)            */
/* ===================================================================== */

/* A project directory mistaken for a backlog: no configuration, but files
 * that every --fix step would otherwise act on — a non-ID `.md` in tasks/
 * (the finding's own case: it got a tombstone named `notes`), an element
 * without `id`/`type` (step 1), no tombstones at all (step 4), no
 * status/created/updated (step 5), a stale H1 (step 6), a stray temp file
 * (step 7). */
function projectFiles(dir: string): string {
  mkdir(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks', 'notes.md'), 'hello\n');
  fs.writeFileSync(path.join(dir, 'tasks', 'TSK-001.md'),
    '---\ntitle: Real title\n---\n\n# Old heading\n\n## Description\nD\n');
  fs.writeFileSync(path.join(dir, 'tasks', '.nj-tmp-4242-deadbeef'), 'half a file\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# A project, not a backlog\n');
  return dir;
}

/* `build()` returns a FRESH {root, extra, o} per run: against an nj that
 * does write, a shared fixture would already be repaired by the first run
 * and every later run would pass vacuously. */
interface FixBuild { root: string; extra: string[]; o: Opts }
function fixWritesNothing(desc: string, build: () => FixBuild) {
  let x = build();
  let before = snapshot(x.root);
  const r = run(['doctor', '--fix'].concat(x.extra), x.o);
  T.exit(desc + ': exit 2 — config:invalid is an error that remains (§ 14)', r, 2);
  noStack(desc, r);
  sameTree(desc + ': writes NOTHING — full tree identical before/after', before, snapshot(x.root));

  x = build();
  before = snapshot(x.root);
  const rj = runJ(['doctor', '--fix'].concat(x.extra), x.o);
  T.exit(desc + ' --json: exit 2', rj, 2);
  const probs: any[] | null = rj.json && Array.isArray(rj.json.problems) ? rj.json.problems : null;
  T.check(desc + ' --json: problems[] still reports config:invalid as an error',
    !!probs && probs.some((p: any) => p && p.code === 'config:invalid' && p.severity === 'error'),
    J(rj.json).slice(0, 400));
  T.check(desc + ' --json: fixed[] is empty — no action was taken',
    !!rj.json && Array.isArray(rj.json.fixed) && rj.json.fixed.length === 0,
    'fixed = ' + J(rj.json && rj.json.fixed));
  sameTree(desc + ' --json: writes NOTHING — full tree identical before/after', before, snapshot(x.root));

  /* Plain doctor agrees: config:invalid holds, exit 2. */
  x = build();
  const d = runJ(['doctor'].concat(x.extra), x.o);
  T.exit(desc + ': plain doctor exit 2', d, 2);
}

function f3Project(label: string) {
  const root = H.freshDir(label);
  const proj = projectFiles(mkdir(path.join(root, 'proj')));
  const cwd = mkdir(path.join(root, 'elsewhere'));
  return { root, proj, cwd };
}

fixWritesNothing('F3 doctor --fix --backlog=<project dir>', () => {
  const x = f3Project('hard-f3-flag');
  return { root: x.root, extra: ['--backlog=' + x.proj], o: { cwd: x.cwd } };
});
/* The finding's typo: `--backlog=.` from the project root. */
fixWritesNothing('F3 doctor --fix --backlog=. from the project root', () => {
  const x = f3Project('hard-f3-dot');
  return { root: x.root, extra: ['--backlog=.'], o: { cwd: x.proj } };
});
fixWritesNothing('F3 NJ_BACKLOG=<project dir> doctor --fix', () => {
  const x = f3Project('hard-f3-env');
  return { root: x.root, extra: [], o: { cwd: x.cwd, env: { NJ_BACKLOG: x.proj } } };
});

/* The same through the other two sources doctor accepts any directory from
 * (DECISIONS 88): a `.njrc` pointing one level too high, and a config-less
 * `backlog/` reached by the search (backlog_without_config for every other
 * command; doctor "tolerates the missing file and reports config:invalid"). */
fixWritesNothing('F3 .njrc → <project dir>, doctor --fix', () => {
  const x = f3Project('hard-f3-rc');
  fs.writeFileSync(path.join(x.cwd, '.njrc'), 'backlog = ../proj\n');
  return { root: x.root, extra: [], o: { cwd: x.cwd } };
});
fixWritesNothing('F3 config-less backlog/ found by the search, doctor --fix', () => {
  const root = H.freshDir('hard-f3-search');
  projectFiles(mkdir(path.join(root, 'backlog')));
  return { root, extra: [], o: { cwd: root } };
});

/* Control — the comparator is not vacuous: the same files in a backlog WITH
 * a valid configuration are repaired, so the tree does change. */
{
  const root = H.freshDir('hard-f3-ctl');
  const BL = path.join(root, 'backlog');
  const i = run(['init'], { cwd: root });
  T.exit('F3 control: nj init', i, 0);
  projectFiles(BL);
  const before = snapshot(root);
  const r = runJ(['doctor', '--fix'], { cwd: root });
  T.check('F3 control: with a valid config, --fix does write (the snapshot sees it)',
    JSON.stringify(before) !== JSON.stringify(snapshot(root)), 'tree unchanged; exit ' + r.status + ' ' + J(r.stderr));
  T.check('F3 control: with a valid config, fixed[] is non-empty',
    !!r.json && Array.isArray(r.json.fixed) && r.json.fixed.length > 0, 'fixed = ' + J(r.json && r.json.fixed));
}

/* ===================================================================== */
/* F4 — io_error: one line, the path, the OS reason, never a stack        */
/* ===================================================================== */

/* `pathOf` is the path the line must name. For a non-directory parent the
 * named target is `<file>/sub`, and the failing call is on `<file>`; the
 * target's spelling contains the file's, so requiring the file's path is
 * satisfied by either reading of "naming the path". */
interface IoR { status: number | null; stdout: string; stderr: string; missing?: string }
interface IoRj extends IoR { json?: any; parseError?: string | null }
function ioError(desc: string, r: IoR, rj: IoRj, pathOf: string | null, reasonRe: RegExp | null) {
  T.exit(desc + ': exit 1', r, 1);
  noStack(desc, r);
  const lines = stderrLines(r);
  T.eq(desc + ': exactly one stderr line (DECISIONS 93 F4)', lines.length, 1);
  if (pathOf) T.check(desc + ': the line names the path', names(r.stderr, pathOf), 'stderr = ' + J(r.stderr) + ', path = ' + J(pathOf));
  if (reasonRe) T.check(desc + ': the line gives the OS reason', reasonRe.test(r.stderr || ''), 'stderr = ' + J(r.stderr));
  T.check(desc + ': never internal_error', !/internal_error/.test((r.stderr || '') + (r.stdout || '')), J(r.stderr));

  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: stdout is one well-formed JSON document', rj.json !== null,
    'parse error: ' + rj.parseError + '; stdout = ' + J(rj.stdout));
  T.check(desc + ' --json: {ok:false}', !!rj.json && rj.json.ok === false, J(rj.json));
  T.eq(desc + ' --json: error is io_error', rj.json && rj.json.error, 'io_error');
  noStack(desc + ' --json', rj);
  T.eq(desc + ' --json: exactly one stderr line', stderrLines(rj).length, 1);
}

const ENOTDIR_RE = /ENOTDIR|not a directory/i;
const EACCES_RE = /EACCES|EPERM|permission denied|read-only|not permitted/i;

/* Non-directory parent, through each source that names init's target. */
{
  const root = H.freshDir('hard-f4-file');
  const file = path.join(root, 'plain.txt');
  fs.writeFileSync(file, 'I am a file\n');
  const cwd = root;
  const cases: [string, string[], Opts][] = [
    ['F4 init --backlog=<regular file>/sub', ['init', '--backlog=' + file + '/sub'], { cwd }],
    ['F4 init --backlog=<regular file>/sub (relative)', ['init', '--backlog=plain.txt/sub'], { cwd }],
    ['F4 init --backlog=<regular file>/a/b', ['init', '--backlog=' + file + '/a/b'], { cwd }],
    ['F4 NJ_BACKLOG=<regular file>/sub init', ['init'], { cwd, env: { NJ_BACKLOG: file + '/sub' } }],
  ];
  const rcDir = mkdir(path.join(root, 'rc'));
  fs.writeFileSync(path.join(rcDir, '.njrc'), 'backlog = ../plain.txt/sub\n');
  cases.push(['F4 .njrc → <regular file>/sub, init', ['init'], { cwd: rcDir }]);
  for (const [desc, args, o] of cases) {
    const before = snapshot(root);
    const r = run(args, o);
    const rj = runJ(args, o);
    ioError(desc, r, rj, file, ENOTDIR_RE);
    sameTree(desc + ': nothing created or changed', before, snapshot(root));
  }
  T.eq('F4 the regular file keeps its bytes', H.readOrNull(file), 'I am a file\n');
}

/* Read-only parent. Root ignores directory permissions, so as root this leg
 * cannot be built. */
{
  const root = H.freshDir('hard-f4-ro');
  const ro = mkdir(path.join(root, 'ro'));
  fs.chmodSync(ro, 0o555);
  let writable = false;
  try { fs.writeFileSync(path.join(ro, '.probe'), ''); writable = true; fs.unlinkSync(path.join(ro, '.probe')); } catch (e) { /* expected */ }
  if (writable) {
    cannotRun('F4 init into a read-only parent → io_error',
      'a 0555 directory is still writable here (running as uid ' + ME + ')');
  } else {
    const cases: [string, string[], Opts][] = [
      ['F4 init --backlog=<read-only dir>/bl', ['init', '--backlog=' + path.join(ro, 'bl')], { cwd: root }],
      ['F4 init --backlog=<read-only dir>/deep/bl', ['init', '--backlog=' + path.join(ro, 'deep', 'bl')], { cwd: root }],
      ['F4 NJ_BACKLOG=<read-only dir>/bl init', ['init'], { cwd: root, env: { NJ_BACKLOG: path.join(ro, 'bl') } }],
      /* no source: init's default target is ./backlog in a read-only cwd */
      ['F4 init in a read-only cwd (./backlog)', ['init'], { cwd: ro }],
    ];
    for (const [desc, args, o] of cases) {
      const before = snapshot(root);
      const r = run(args, o);
      const rj = runJ(args, o);
      ioError(desc, r, rj, ro, EACCES_RE);
      sameTree(desc + ': nothing created or changed', before, snapshot(root));
    }
  }
  fs.chmodSync(ro, 0o755);
}

/* A deleted working directory. spawn() cannot start a child in a directory
 * that does not exist, so a shell enters it, removes it, and execs nj —
 * nj starts with a cwd that is gone. Exit 97/98 means the wrapper failed,
 * which is the suite's fault, reported as CANNOT RUN.
 *
 * njPath defaults to H.NJ_BUNDLE, not H.NJ, for the same reason
 * runUnderLockedAncestor's own doc comment gives (D187 addendum, 81cd90a):
 * execing `bin/nj` here is execing a SECOND shell from a cwd that is
 * already gone, and that nested shell's own startup getcwd() failure
 * prints its own line to stderr before nj's own code runs. */
interface SpawnOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  parent: string;
  dir: string;
  missing?: string;
  json?: any;
  parseError?: string;
}
function runInDeletedCwd(args: string[], json: boolean, njPath?: string | null): SpawnOutcome {
  const parent = H.freshDir('hard-f4-gone');
  const dir = mkdir(path.join(parent, 'gone'));
  const env = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW, HOME });
  delete env.NJ_BACKLOG;
  const inv = H.njCommand(njPath || (H.NJ_BUNDLE as string), args.concat(json ? ['--json'] : []));
  const r = spawnSync('/bin/sh',
    ['-c', 'cd "$1" || exit 97; rmdir "$1" || exit 98; shift; exec "$@"', 'sh', dir, inv.cmd]
      .concat(inv.args),
    { cwd: parent, env, encoding: 'utf8', timeout: 60000 });
  const res: SpawnOutcome = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', parent, dir };
  if (r.error) res.missing = 'spawn /bin/sh failed: ' + r.error.message;
  else if (r.status === 97 || r.status === 98) res.missing = 'the shell wrapper could not enter/remove the cwd (exit ' + r.status + ')';
  if (json) {
    try { res.json = JSON.parse(res.stdout); } catch (e) { res.json = null; res.parseError = (e as Error).message; }
  }
  return res;
}

for (const [desc, args] of [
  ['F4 list in a deleted cwd', ['list']],
  ['F4 bare nj in a deleted cwd', []],
  ['F4 doctor in a deleted cwd', ['doctor']],
  ['F4 init in a deleted cwd', ['init']],
] as [string, string[]][]) {
  const r = runInDeletedCwd(args, false);
  const rj = runInDeletedCwd(args, true);
  if (r.missing || rj.missing) { cannotRun(desc, r.missing || rj.missing); continue; }
  /* AMBIGUOUS (AMBIGUITIES 64): which path the line names. A deleted cwd has
   * no path the OS will report; nj may know it only from $PWD. The code is
   * pinned by § 9's table — `io_error`, not `no_backlog` — and so is the
   * one-line, no-stack form; the path is not asserted. */
  ioError(desc, r, rj, null, null);
  T.eq(desc + ': nothing created where the cwd was', H.lsOrEmpty(r.parent), []);
}

/* F4 deleted cwd, bin/nj-specific (D187 addendum, 81cd90a) — same reasoning
 * and same shape as D96's own bin/nj-specific leg below: skipped when the
 * path under test already IS the bundle. */
if (H.NJ && H.NJ !== H.NJ_BUNDLE) {
  for (const [desc, args] of [
    ['F4 (bin/nj) list in a deleted cwd', ['list']],
    ['F4 (bin/nj) bare nj in a deleted cwd', []],
    ['F4 (bin/nj) doctor in a deleted cwd', ['doctor']],
    ['F4 (bin/nj) init in a deleted cwd', ['init']],
  ] as [string, string[]][]) {
    const r = runInDeletedCwd(args, false, H.NJ);
    const rBundle = runInDeletedCwd(args, false, H.NJ_BUNDLE);
    if (r.missing || rBundle.missing) { cannotRun(desc, r.missing || rBundle.missing); continue; }
    T.exit(desc + ': exit 1, nj\'s own exit code, regardless of any nested shell banner first', r, 1);
    noStack(desc, r);
    const lines = stderrLines(r);
    const last = lines[lines.length - 1] || '';
    T.eq(desc + ': the LAST stderr line is exactly nj\'s own (same as against the bundle)',
      last, (stderrLines(rBundle)[0] || ''));
    T.eq(desc + ': nothing created where the cwd was', H.lsOrEmpty(r.parent), []);
  }
}

/* ===================================================================== */
/* D90 / D96 — `.njrc` odd files and lexing that AC-21 A7b does not cover */
/* ===================================================================== */

/* AC-21 A7b already asserts: a BOM at the start, CRLF, the first-`=`
 * split, case-sensitive keys, an inline `#`, a directory / dangling symlink
 * / unreadable `.njrc`, the symlink base and `~/.njrc`. Not repeated here.
 * What follows is what DECISIONS 96 sends to TSK-029 and A7b lacks. */

/* § 4: "invalid .njrc at <abs path>: <reason>" (no line number) and
 * "invalid .njrc at <abs path>: line <n>: <reason>", prefix per D88. */
const RC_ANY_RE = /^Error: invalid \.njrc at (.+?\.njrc): (.+)$/m;
const RC_LINE_RE = /^Error: invalid \.njrc at (.+?\.njrc): line (\d+): (.+)$/m;

/* nj on a path that might block (a FIFO): its own spawn with a timeout, so
 * a hang is reported as a hang, not as the harness's "spawn failed" (which
 * T.exit would print as CANNOT RUN — a suite verdict for a product bug). */
interface BoundedOutcome { status: string | number | null; stdout: string; stderr: string; hung: boolean; json?: any }
function runBounded(args: string[], o: Opts, ms: number): BoundedOutcome {
  const e = envFor(o);
  const env: Record<string, string | undefined> = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW }, e.env);
  for (const k of e.unsetEnv) delete env[k];
  const inv = H.njCommand(H.NJ as string, args);
  const r = spawnSync(inv.cmd, inv.args, { cwd: e.cwd, env, encoding: 'utf8', timeout: ms });
  const hung = !!(r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  const out: BoundedOutcome = { status: hung ? 'hung — killed after ' + ms + ' ms' : r.status, stdout: r.stdout || '', stderr: r.stderr || '', hung };
  try { out.json = JSON.parse(out.stdout); } catch (err) { out.json = null; }
  return out;
}

/* A .njrc that is not a readable regular file: exit 1, invalid_njrc, no
 * line number, no fall-through to the backlog/ beside it. */
function rcFileRefusal(desc: string, cwd: string, rcPath: string, reasonCheck?: (reason: string) => void) {
  const r = runBounded(['list'], { cwd }, 15000);
  T.check(desc + ': returns (does not hang)', !r.hung, r.status);
  T.eq(desc + ': exit 1', r.status, 1);
  const m = RC_ANY_RE.exec(r.stderr);
  T.check(desc + ': stderr carries "Error: invalid .njrc at <abs path>: <reason>" (§ 4)', !!m, 'stderr = ' + J(r.stderr));
  if (m) {
    T.check(desc + ': the path is that .njrc', path.isAbsolute(m[1]) &&
      canon(path.dirname(m[1])) === canon(path.dirname(rcPath)) && path.basename(m[1]) === '.njrc', J(m[1]));
    T.check(desc + ': no line number (§ 4)', !/^line \d+:/.test(m[2]), J(m[2]));
    if (reasonCheck) reasonCheck(m[2]);
  }
  noStack(desc, r);
  const rj = runBounded(['list', '--json'], { cwd }, 15000);
  T.check(desc + ' --json: returns (does not hang)', !rj.hung, rj.status);
  T.eq(desc + ' --json: error is invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
  T.check(desc + ' --json: never a read shape (no fall-through to backlog/ beside it)',
    !(rj.json && Array.isArray(rj.json.entries)), J(rj.json).slice(0, 200));
}

function rcLineRefusal(desc: string, cwd: string, rcPath: string, line: number | null) {
  const r = run(['list'], { cwd });
  T.exit(desc + ': exit 1', r, 1);
  const m = RC_LINE_RE.exec(r.stderr || '');
  T.check(desc + ': stderr carries "Error: invalid .njrc at <abs path>: line <n>: <reason>" (§ 4)', !!m, 'stderr = ' + J(r.stderr));
  if (m) {
    T.check(desc + ': the path is that .njrc', samePath(m[1], rcPath), J(m[1]));
    if (line !== null) T.eq(desc + ': the line number', m[2], String(line));
  }
  const rj = runJ(['list'], { cwd });
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.eq(desc + ' --json: error is invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
}

{
  const root = H.freshDir('hard-rc');
  let n = 0;
  /* Each case: its own directory with a backlog/ beside the .njrc, so a
   * .njrc that is skipped instead of refused shows up as a read. */
  const caseDir = () => {
    const d = mkdir(path.join(root, 'c' + (n++)));
    initBacklog(path.join(d, 'backlog'), 'Beside marker');
    return d;
  };

  /* FIFO (D96 F10): opening it for reading blocks until a writer comes —
   * nj must refuse it as "not a regular file", never open it. */
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    const mk = spawnSync('mkfifo', [rc], { encoding: 'utf8' });
    if (mk.error || mk.status !== 0 || !fs.lstatSync(rc).isFIFO()) {
      cannotRun('D96 a FIFO .njrc → invalid_njrc', 'mkfifo failed: ' + (mk.error ? mk.error.message : mk.stderr));
    } else {
      rcFileRefusal('D96 a FIFO .njrc', d, rc);
    }
  }

  /* Self-linking .njrc (ELOOP, D96): refused, and with its own reason —
   * not reported as a dangling link. */
  const eloopReason = (desc: string) => (reason: string) => {
    T.check(desc + ': the reason is not "dangling" (D96)', !/dangling/i.test(reason), J(reason));
    T.check(desc + ': the reason names the loop (ELOOP / symlink loop / too many levels of symbolic links)',
      /ELOOP|loop|too many (levels of )?symbolic links/i.test(reason), J(reason));
  };
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.symlinkSync('.njrc', rc);
    rcFileRefusal('D96 a .njrc symlinked to itself', d, rc, eloopReason('D96 a .njrc symlinked to itself'));
  }
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.symlinkSync('loop-b', rc);
    fs.symlinkSync('.njrc', path.join(d, 'loop-b'));
    rcFileRefusal('D96 a two-link symlink cycle as .njrc', d, rc, eloopReason('D96 a two-link symlink cycle as .njrc'));
  }

  /* A BOM counts only at the very start of the file (§ 4 as amended,
   * D96); anywhere else it is an ordinary character. */
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.writeFileSync(rc, '# where\n\uFEFFbacklog = backlog\n');
    rcLineRefusal('D96 a BOM at the start of line 2: the key "\\uFEFFbacklog" is unknown', d, rc, 2);
  }
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.writeFileSync(rc, '\uFEFF\uFEFFbacklog = backlog\n');
    rcLineRefusal('D96 a second BOM after the leading one is an ordinary character (unknown key)', d, rc, 1);
  }
  {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.writeFileSync(rc, '\n\uFEFF# not a comment any more\n');
    rcLineRefusal('D96 "\\uFEFF#" on line 2 is not a whole-line comment (a line without "=")', d, rc, 2);
  }
  {
    /* In a value: "bl\uFEFF" names a folder that does not exist; the
     * decoy `bl` does. The ordinary character is kept, never trimmed. */
    const d = caseDir();
    initBacklog(path.join(d, 'bl'), 'Decoy marker');
    const rc = path.join(d, '.njrc');
    fs.writeFileSync(rc, 'backlog = bl\uFEFF\n');
    const rj = runJ(['list'], { cwd: d });
    T.exit('D96 a BOM at the end of the value is part of it: exit 1', rj, 1);
    T.eq('D96 a BOM at the end of the value is part of it: invalid_backlog_njrc (the decoy "bl" is not used)',
      rj.json && rj.json.error, 'invalid_backlog_njrc');
  }
  {
    /* Control: the leading BOM is still dropped. */
    const d = caseDir();
    fs.writeFileSync(path.join(d, '.njrc'), '\uFEFFbacklog = backlog\n');
    const rj = runJ(['list'], { cwd: d });
    T.exit('D96 control: a BOM at the very start is dropped: exit 0', rj, 0);
    T.eq('D96 control: a BOM at the very start is dropped: reads the backlog', titles(rj.json), ['Beside marker']);
  }

  /* A lone \r (§ 4 as amended, D96): "a `\r` not followed by `\n` is
   * `invalid_njrc`". DECISIONS 98 (AMBIGUITIES 67/68): that includes a `\r`
   * as the file's last byte, and it is reported as
   * `line <n>: <reason>` with n the line holding the `\r`, lines counted by
   * `\n`. */
  const loneCr = (desc: string, content: string, line: number | null) => {
    const d = caseDir();
    const rc = path.join(d, '.njrc');
    fs.writeFileSync(rc, content);
    rcLineRefusal(desc, d, rc, line);
    const r = run(['list'], { cwd: d });
    noStack(desc, r);
    const rj = runJ(['list'], { cwd: d });
    T.check(desc + ' --json: never a read shape', !(rj.json && Array.isArray(rj.json.entries)), J(rj.json).slice(0, 200));
  };
  /* The case § 4 names: a classic-Mac file would read as one comment line
   * and silently set nothing — the backlog/ beside it would answer. Counted
   * by \n it is all line 1. */
  loneCr('D96 a classic-Mac .njrc ("\\r" line ends only)', '# where the backlog lives\rbacklog = backlog\r\n', 1);
  loneCr('D96 a lone "\\r" inside a value', 'backlog = back\rlog\n', 1);
  loneCr('D96 a lone "\\r" on a comment line', '# a\rb\nbacklog = backlog\n', 1);
  loneCr('D98 a lone "\\r" on line 3 (lines counted by "\\n")', '# one\n# two\nbacklog = back\rlog\n', 3);
  loneCr('D98 a "\\r" as the last byte of the file', 'backlog = backlog\r', 1);
  loneCr('D98 a "\\r" as the last byte, after a CRLF line', '# c\r\nbacklog = backlog\r', 2);
  {
    /* Control: CRLF still works right next to these (A7b has the full case). */
    const d = caseDir();
    fs.writeFileSync(path.join(d, '.njrc'), '# c\r\nbacklog = backlog\r\n');
    const rj = runJ(['list'], { cwd: d });
    T.exit('D96 control: CRLF still works', rj, 0);
  }
}

/* ===================================================================== */
/* D96 — a cwd whose ancestor is unsearchable → io_error (F4 class)       */
/* ===================================================================== */

/* A shell enters <root>/locked/cwd, then chmod 000 <root>/locked, runs nj,
 * and restores the mode. The cwd itself still exists; every absolute path
 * through `locked` — the cwd's own, and each `.njrc`/`backlog/` probe on
 * the search — now fails with EACCES.
 *
 * njPath defaults to H.NJ_BUNDLE, not H.NJ (D187 addendum, 81cd90a): when
 * the path under test is `bin/nj`, the outer orchestrating `/bin/sh` here
 * execs a SECOND, nested shell (bin/nj's own shebang) after the ancestor is
 * already locked — that nested shell's own startup getcwd() call fails and
 * prints its own "shell-init: ... getcwd ..." line to stderr before nj's
 * own code ever runs, which is not nj's own output and would defeat the
 * single-stderr-line assertion below for a reason that has nothing to do
 * with nj. Against the bundle (`dist/nj.mjs`, run directly by node, no
 * nested shell) that banner never appears, so the strict check stays
 * meaningful; the bin/nj-specific leg below checks only what still holds
 * for a `bin/` launcher — the LAST stderr line and the exit code are nj's
 * own, regardless of what a nested shell may have printed first (§ 18). */
interface LockedOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  root: string;
  locked: string;
  missing?: string;
  json?: any;
  parseError?: string;
}
function runUnderLockedAncestor(args: string[], json: boolean, njPath?: string | null): LockedOutcome {
  const root = H.freshDir('hard-f4-locked');
  const locked = mkdir(path.join(root, 'locked'));
  const cwd = mkdir(path.join(locked, 'cwd'));
  const env = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW, HOME });
  delete env.NJ_BACKLOG;
  const inv = H.njCommand(njPath || (H.NJ_BUNDLE as string), args.concat(json ? ['--json'] : []));
  const r = spawnSync('/bin/sh',
    ['-c', 'cd "$1" || exit 97; chmod 000 "$2" || exit 98; shift 2; "$@"; rc=$?; chmod 755 "$0"; exit $rc',
      locked, cwd, locked, inv.cmd].concat(inv.args),
    { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  try { fs.chmodSync(locked, 0o755); } catch (e) { /* restored by the shell already */ }
  const res: LockedOutcome = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', root, locked };
  if (r.error) res.missing = 'spawn /bin/sh failed: ' + r.error.message;
  else if (r.status === 97 || r.status === 98) res.missing = 'the shell wrapper could not enter/lock the ancestor (exit ' + r.status + ')';
  if (json) { try { res.json = JSON.parse(res.stdout); } catch (e) { res.json = null; res.parseError = (e as Error).message; } }
  return res;
}

{
  /* Root searches anything: then the leg cannot be built. */
  const probeRoot = H.freshDir('hard-f4-lockprobe');
  const lk = mkdir(path.join(probeRoot, 'l'));
  mkdir(path.join(lk, 'x'));
  fs.chmodSync(lk, 0o000);
  let searchable = false;
  try { fs.statSync(path.join(lk, 'x')); searchable = true; } catch (e) { /* expected */ }
  fs.chmodSync(lk, 0o755);
  for (const [desc, args] of [
    ['D96 list with an unsearchable ancestor of the cwd', ['list']],
    ['D96 bare nj with an unsearchable ancestor of the cwd', []],
    ['D96 doctor with an unsearchable ancestor of the cwd', ['doctor']],
    ['D96 init with an unsearchable ancestor of the cwd', ['init']],
  ] as [string, string[]][]) {
    if (searchable) { cannotRun(desc, 'a mode-000 directory is still searchable here (uid ' + ME + ')'); continue; }
    const r = runUnderLockedAncestor(args, false);
    const rj = runUnderLockedAncestor(args, true);
    if (r.missing || rj.missing) { cannotRun(desc, r.missing || rj.missing); continue; }
    /* AMBIGUOUS (AMBIGUITIES 64): as for a deleted cwd, getcwd() itself
     * fails here, so the path is not asserted — only the OS reason. */
    ioError(desc, r, rj, null, EACCES_RE);
    T.eq(desc + ': nothing created in the cwd', H.lsOrEmpty(path.join(r.locked, 'cwd')), []);
  }
}

/* D96, bin/nj-specific (D187 addendum, 81cd90a): skipped when the path
 * under test already IS the bundle (the strict leg above already covers
 * that case, identically). When it is a `bin/` launcher, its own shebang
 * execs a second, nested `/bin/sh` after the ancestor is already locked;
 * that shell's own startup getcwd() call fails and writes its own
 * "shell-init: ... getcwd ..." line to stderr BEFORE nj's own code ever
 * runs — confirmed by hand: against `bin/nj` this adds exactly that one
 * line ahead of nj's own, unchanged, single line; against the bundle there
 * is no such line at all. Not nj's output and not asserted against; what
 * still holds, and is checked here, is that the exit code and the LAST
 * stderr line remain exactly nj's own (§ 18 notes this limitation). */
if (H.NJ && H.NJ !== H.NJ_BUNDLE) {
  const probeRoot = H.freshDir('hard-f4-lockprobe-bin');
  const lk = mkdir(path.join(probeRoot, 'l'));
  mkdir(path.join(lk, 'x'));
  fs.chmodSync(lk, 0o000);
  let searchable = false;
  try { fs.statSync(path.join(lk, 'x')); searchable = true; } catch (e) { /* expected */ }
  fs.chmodSync(lk, 0o755);
  for (const [desc, args] of [
    ['D96 (bin/nj) list with an unsearchable ancestor of the cwd', ['list']],
    ['D96 (bin/nj) bare nj with an unsearchable ancestor of the cwd', []],
    ['D96 (bin/nj) doctor with an unsearchable ancestor of the cwd', ['doctor']],
    ['D96 (bin/nj) init with an unsearchable ancestor of the cwd', ['init']],
  ] as [string, string[]][]) {
    if (searchable) { cannotRun(desc, 'a mode-000 directory is still searchable here (uid ' + ME + ')'); continue; }
    const r = runUnderLockedAncestor(args, false, H.NJ);
    const rBundle = runUnderLockedAncestor(args, false, H.NJ_BUNDLE);
    if (r.missing || rBundle.missing) { cannotRun(desc, r.missing || rBundle.missing); continue; }
    T.exit(desc + ': exit 1, nj\'s own exit code, regardless of any nested shell banner first', r, 1);
    noStack(desc, r);
    const lines = stderrLines(r);
    const last = lines[lines.length - 1] || '';
    T.eq(desc + ': the LAST stderr line is exactly nj\'s own (same as against the bundle)',
      last, (stderrLines(rBundle)[0] || ''));
    T.eq(desc + ': nothing created in the cwd', H.lsOrEmpty(path.join(r.locked, 'cwd')), []);
  }
}

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
 * a directory search is the fallback. Without both → CANNOT RUN, never a
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
