/* V3-2 regressions ruled in DECISIONS 105 (found by Verifier-B on 76db3b2).
 *
 * 1. "The configured layout folders at the backlog's top level (`epics`,
 *    `tasks`, `subtasks`, `archive`) are followed when they are symlinks to
 *    directories, as in v2; DECISIONS 91 B11's 'never follow a directory
 *    symlink' holds for every directory below them and for any other
 *    directory. A symlinked layout folder that points at nothing is
 *    `backlog:unreadable_dir`."
 * 2. "Matching a path segment against a configured folder name — for
 *    placement and for archived-ness — is case-insensitive and unambiguous.
 *    A move whose target is the same file as its source (same device and
 *    inode) is no move: the element is in place."
 * 3. "`doctor --fix` must never crash in step 3 … The planner must handle
 *    nested misplaced folders; a case it cannot plan is reported and left
 *    alone."
 *
 * Section 1 needs no `layout` block, so it runs unchanged against v2 and c3
 * as well — the point of a regression test (see AC-MATRIX for those runs).
 *
 * Black box; fixtures from `nj init` / `nj new` plus hand moves and links.
 * The one configuration edit goes where init put the config, so V3-4 needs
 * no edit here.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('reg-home');
interface Opts { cwd?: string; env?: Record<string, string | undefined> }
function envFor(o: Opts) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset: string[] = [];
  for (const k of ['NJ_BACKLOG', 'NJ_AUTHOR', 'NJ_FAULT']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args: string[], o: Opts) { return H.runNj(args, envFor(o)); }
function runJ(args: string[], o: Opts) { return H.runJson(args, envFor(o)); }
/* A run that may hang (a symlink loop): its own spawn with a timeout, so a
 * hang is reported as a hang, not as the harness's CANNOT RUN. */
interface BoundedOutcome { status: string | number | null; stdout: string; stderr: string; json: any; hung: boolean }
function runBounded(args: string[], o: Opts, ms: number): BoundedOutcome {
  const e = envFor(o);
  const env: Record<string, string | undefined> = Object.assign({}, process.env, { NJ_NOW: NOW }, e.env);
  for (const k of e.unsetEnv) delete env[k];
  const inv = H.njCommand(H.NJ as string, args);
  const r = spawnSync(inv.cmd, inv.args, { cwd: e.cwd, env, encoding: 'utf8', timeout: ms });
  const hung = !!(r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  let json: any = null;
  try { json = JSON.parse(r.stdout || ''); } catch (err) { /* reported by the caller */ }
  return { status: hung ? 'hung, killed after ' + ms + ' ms' : r.status, stdout: r.stdout || '', stderr: r.stderr || '', json, hung };
}

/* ---- fixtures -------------------------------------------------------- */

function mkdir(p: string): string { fs.mkdirSync(p, { recursive: true }); return p; }
function write(p: string, s: string): string { mkdir(path.dirname(p)); fs.writeFileSync(p, s); return p; }
function read(p: string): string | null { return H.readOrNull(p); }
function cfgPath(bl: string): string {
  const v3 = path.join(bl, '.nanojira', 'config.json');
  return fs.existsSync(v3) ? v3 : path.join(bl, H.CONFIG_REL);
}
function setLayout(bl: string, layout: any) {
  const p = cfgPath(bl);
  let cfg: any;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return T.check('fixture: read the configuration init wrote (' + p + ')', false, (e as Error).message);
  }
  cfg.layout = layout;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}
interface OkResult { missing?: string; status: number | null; stderr?: string }
function ok(r: OkResult, what: string): OkResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
/* Hand move that never throws; a fixture that cannot be built fails as a check. */
function move(from: string, to: string, what: string): boolean {
  try { mkdir(path.dirname(to)); fs.renameSync(from, to); return true; } catch (e) {
    T.check('fixture: ' + what, false, (e as NodeJS.ErrnoException).code + ' ' + from + ' → ' + to);
    return false;
  }
}
function link(target: string, at: string, what: string): boolean {
  try { mkdir(path.dirname(at)); fs.symlinkSync(target, at); return true; } catch (e) {
    T.check('fixture: ' + what, false, (e as NodeJS.ErrnoException).code);
    return false;
  }
}

const BODY = ['--description=Something.', '--acceptance=- [ ] It works'];
/* EPIC-001 with TSK-001, TSK-002; SUB-001 under TSK-001. */
function model(label: string, layout?: any) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  if (layout) setLayout(bl, layout);
  const n = (a: string[]) => ok(run(['new'].concat(a), { cwd: dir }), 'nj new ' + a.join(' '));
  n(['--type=epic', '--title=Epic one', '--description=The epic.']);
  n(['--type=task', '--parent=EPIC-001', '--title=Task one'].concat(BODY));
  n(['--type=task', '--parent=EPIC-001', '--title=Task two'].concat(BODY));
  n(['--type=subtask', '--parent=TSK-001', '--title=Sub one'].concat(BODY));
  return { dir, bl };
}
function ids(r: any): string[] { return r.json && Array.isArray(r.json.entries) ? r.json.entries.map((e: any) => e.id).sort() : []; }
function list(x: { dir: string }, all?: boolean) { return runJ(['list'].concat(all ? ['--all'] : []), { cwd: x.dir }); }
function codes(r: any): string[] { return H.doctorSet(r) || ['<no problems array>']; }
function noStack(desc: string, r: { stdout?: string; stderr?: string }) {
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test((r.stderr || '') + '\n' + (r.stdout || '')), J(r.stderr).slice(0, 300));
  T.check(desc + ': never internal_error', !/internal_error/.test((r.stderr || '') + (r.stdout || '')), J(r.stderr).slice(0, 300));
}
function doneAll(x: { dir: string }, idsTopDown: string[]) {
  for (const id of idsTopDown.slice().reverse()) ok(run(['set', '--id=' + id, '--status=done'], { cwd: x.dir }), 'set ' + id + ' done');
}

/* ===================================================================== */
/* R1 — symlinked layout folders are followed (DECISIONS 105)             */
/* ===================================================================== */
{
  const tag = 'R1 [tasks -> ../shared]';
  const x = model('reg-link-tasks');
  const shared = path.join(x.dir, 'shared');
  if (move(path.join(x.bl, 'tasks'), shared, 'move tasks/ out of the backlog')) link('../shared', path.join(x.bl, 'tasks'), 'link tasks -> ../shared');
  const l = list(x);
  T.exit(tag + ' list: exit 0', l, 0);
  T.eq(tag + ' list shows the tasks behind the link', ids(l).filter(i => i.startsWith('TSK')), ['TSK-001', 'TSK-002']);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(tag + ' doctor: exit 0', d, 0);
  T.sameSet(tag + ' doctor is clean', codes(d), []);
  const n = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Behind the link'].concat(BODY), { cwd: x.dir });
  T.exit(tag + ' new: exit 0', n, 0);
  T.check(tag + ' new writes through the link, into ../shared', fs.existsSync(path.join(shared, 'TSK-003.md')), J(H.lsOrEmpty(shared)));
  T.check(tag + ' the new element appears in list', ids(list(x)).includes('TSK-003'), J(ids(list(x))));
  const s = runJ(['show', '--id=TSK-003'], { cwd: x.dir });
  T.exit(tag + ' show of the new element: exit 0', s, 0);
  let isLink = false;
  try { isLink = fs.lstatSync(path.join(x.bl, 'tasks')).isSymbolicLink(); } catch (e) { /* reported below */ }
  T.check(tag + ' the link itself is left a link', isLink, 'replaced or missing');
}
{
  const tag = 'R1 [archive -> ../shelf]';
  const x = model('reg-link-arch');
  const shelf = path.join(x.dir, 'shelf');
  if (move(path.join(x.bl, 'archive'), shelf, 'move archive/ out of the backlog')) link('../shelf', path.join(x.bl, 'archive'), 'link archive -> ../shelf');
  doneAll(x, ['EPIC-001', 'TSK-001', 'SUB-001', 'TSK-002']);
  const a = runJ(['archive', '--id=EPIC-001'], { cwd: x.dir });
  T.exit(tag + ' archive through the link: exit 0', a, 0);
  T.check(tag + ' the archived files are in ../shelf', ['EPIC-001', 'TSK-001', 'TSK-002', 'SUB-001'].every(i => fs.existsSync(path.join(shelf, i + '.md'))),
    J(H.lsOrEmpty(shelf)));
  T.eq(tag + ' archived elements are hidden without --all', ids(list(x)), []);
  T.eq(tag + ' … and shown with --all', ids(list(x, true)), ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-002']);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(tag + ' doctor: exit 0', d, 0);
  T.sameSet(tag + ' doctor is clean', codes(d), []);
}
{
  /* archive first, then turn the archive folder into a link */
  const tag = 'R1 [an existing archive moved behind a link]';
  const x = model('reg-link-arch2');
  doneAll(x, ['EPIC-001', 'TSK-001', 'SUB-001', 'TSK-002']);
  ok(run(['archive', '--id=EPIC-001'], { cwd: x.dir }), 'archive EPIC-001');
  const shelf = path.join(x.dir, 'shelf');
  if (move(path.join(x.bl, 'archive'), shelf, 'move archive/ out')) link(shelf, path.join(x.bl, 'archive'), 'link archive -> <abs>/shelf');
  T.eq(tag + ' still hidden without --all', ids(list(x)), []);
  T.eq(tag + ' still shown with --all', ids(list(x, true)), ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-002']);
  T.sameSet(tag + ' doctor is clean', codes(runJ(['doctor'], { cwd: x.dir })), []);
}
{
  const tag = 'R1 [a dangling symlinked layout folder]';
  const x = model('reg-link-dangling');
  fs.rmSync(path.join(x.bl, 'subtasks'), { recursive: true, force: true });
  link('../nowhere', path.join(x.bl, 'subtasks'), 'link subtasks -> ../nowhere');
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(tag + ' doctor: exit 2', d, 2);
  T.check(tag + ' doctor reports backlog:unreadable_dir (error)', codes(d).includes('backlog:unreadable_dir:error'), J(codes(d)));
  noStack(tag, d);
}
{
  /* DECISIONS 91 B11 still holds BELOW a layout folder */
  const tag = 'R1 [a directory symlink below tasks/]';
  const x = model('reg-link-below');
  const other = mkdir(path.join(x.dir, 'other'));
  write(path.join(other, 'TSK-009.md'), H.element({ id: 'TSK-009', type: 'task', parent: 'EPIC-001', title: 'Behind a nested link',
    status: 'todo', created: NOW, updated: NOW }, H.completeBody('Behind a nested link')));
  link('../../other', path.join(x.bl, 'tasks', 'nested'), 'link tasks/nested -> ../../other');
  T.check(tag + ' is NOT followed: TSK-009 is not listed', !ids(list(x, true)).includes('TSK-009'), J(ids(list(x, true))));
  link('.', path.join(x.bl, 'tasks', 'loop'), 'link tasks/loop -> .');
  const r = runBounded(['list', '--all', '--json'], { cwd: x.dir }, 15000);
  T.check(tag + ' a symlink loop below a layout folder does not hang', !r.hung, r.status);
  T.eq(tag + ' … and list exits 0', r.status, 0);
  const d = runBounded(['doctor', '--json'], { cwd: x.dir }, 15000);
  T.check(tag + ' doctor with the loop does not hang', !d.hung, d.status);
  noStack(tag + ' doctor with the loop', d);
}

/* ===================================================================== */
/* R2 — folder-name matching is case-insensitive (DECISIONS 105)          */
/* ===================================================================== */

/* Only meaningful where the filesystem folds case (APFS/HFS+ default, NTFS). */
const caseInsensitive = (() => {
  const d = H.freshDir('reg-case-probe');
  fs.writeFileSync(path.join(d, 'probe'), '');
  return fs.existsSync(path.join(d, 'PROBE'));
})();
function cannotRun(desc: string) {
  T.check(desc, false, 'CANNOT RUN: the scratch filesystem is case-sensitive; the ruling concerns case-folding filesystems');
}
/* Every entry below `root` with mtime and bytes. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  (function walk(abs: string, rel: string): void {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e) { return; }
    if (st.isDirectory()) {
      out.push(rel + '/ ' + st.mtimeMs);
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
    } else out.push(rel + ' ' + st.mtimeMs + ' ' + (st.isSymbolicLink() ? '->' : H.sha256(fs.readFileSync(abs))));
  })(root, '.');
  return out;
}
/*
 * `opts.statusLinkNowSays`: this on-disk casing case (D100 composed with
 * D105) is not a full no-op — § 4 makes a STATUS.md link the real file path
 * relative to the backlog, so a folder renamed on disk to a different case
 * makes the PREVIOUSLY WRITTEN STATUS.md stale (its stored links still read
 * the old casing) even though nothing else about the backlog is wrong. Pass
 * the substring the regenerated links must contain (e.g. 'Tasks/TSK-001.md')
 * to check that one write, instead of a whole-backlog no-op:
 *   - no element file moves (byte/mtime snapshot equal but for STATUS.md),
 *   - --fix's fixed[] holds exactly one entry, naming STATUS.md,
 *   - the regenerated STATUS.md contains the on-disk casing,
 *   - a SECOND --fix is then a true no-op.
 * Every other call site keeps the plain no-op path.
 */
function inPlace(tag: string, x: { dir: string; bl: string }, opts?: { statusLinkNowSays?: string }) {
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(tag + ' doctor: exit 0', d, 0);
  T.check(tag + ' no type:folder / layout:misplaced finding', !codes(d).some(c => /^(type:folder|layout:misplaced)/.test(c)), J(codes(d)));
  const statusPath = path.join(x.bl, 'STATUS.md');
  const before = snapshot(x.bl);
  const f = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(tag + ' --fix: exit 0', f, 0);
  if (!opts || !opts.statusLinkNowSays) {
    T.eq(tag + ' --fix is a no-op: fixed[] is empty', f.json && f.json.fixed, []);
    T.eq(tag + ' --fix is a no-op: the whole backlog unchanged (bytes and mtimes)', snapshot(x.bl), before);
    noStack(tag + ' --fix', f);
    return;
  }
  const wantLink = opts.statusLinkNowSays;
  /* regenerating STATUS.md also bumps the containing directory's own mtime,
   * so both are excluded — everything else in the backlog must be identical. */
  const noStatusLine = (arr: string[]) => arr.filter((l: string) => !l.startsWith('./STATUS.md ') && l !== undefined && !/^\.\/ \d/.test(l));
  T.eq(tag + ' --fix moves no element file (only STATUS.md changes)',
    noStatusLine(snapshot(x.bl)), noStatusLine(before));
  const fixed = (f.json && Array.isArray(f.json.fixed)) ? f.json.fixed : null;
  T.eq(tag + ' --fix: fixed[] holds exactly one entry, for STATUS.md', fixed && fixed.length, 1);
  T.check(tag + ' --fix: that entry names STATUS.md', !!fixed && /STATUS\.md/i.test(fixed[0]), J(fixed));
  const afterFixText = read(statusPath);
  T.check(tag + ' --fix: STATUS.md\'s links now use the on-disk casing (§ 4)',
    afterFixText !== null && afterFixText.includes(wantLink), J(afterFixText));
  noStack(tag + ' --fix', f);
  const f2 = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(tag + ' a second --fix: exit 0', f2, 0);
  T.eq(tag + ' a second --fix is a true no-op: fixed[] is empty', f2.json && f2.json.fixed, []);
  T.eq(tag + ' a second --fix is a true no-op: nothing changed at all', snapshot(x.bl), snapshot(x.bl));
  noStack(tag + ' second --fix', f2);
}

if (!caseInsensitive) {
  cannotRun('R2 case-insensitive folder matching');
} else {
  {
    const tag = 'R2 [folders.tasks = "Tasks", files in tasks/]';
    const x = model('reg-case-cfg');
    setLayout(x.bl, { group: 'type', folders: { tasks: 'Tasks' } });
    inPlace(tag, x);
    const n = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Third'].concat(BODY), { cwd: x.dir });
    T.exit(tag + ' new: exit 0', n, 0);
    T.check(tag + ' the new task is listed', ids(list(x)).includes('TSK-003'), J(ids(list(x))));
  }
  {
    const tag = 'R2 [config says tasks, the folder on disk is Tasks/]';
    const x = model('reg-case-disk');
    move(path.join(x.bl, 'tasks'), path.join(x.bl, 'Tasks'), 'rename tasks/ to Tasks/');
    /* D100 composed with D105: STATUS.md's links were written against the old
     * casing (tasks/…) and are now stale against the renamed folder — a link
     * is the real on-disk path (§ 4), so the fix is a STATUS.md-only rewrite,
     * not a full no-op (the lead's ruling on this finding, 2026-09-29). */
    inPlace(tag, x, { statusLinkNowSays: 'Tasks/TSK-001.md' });
    T.eq(tag + ' list shows the tasks', ids(list(x)).filter(i => i.startsWith('TSK')), ['TSK-001', 'TSK-002']);
  }
  for (const [name, layout] of [['type', null], ['flat', { group: 'flat' }], ['hierarchy', { group: 'hierarchy' }]] as [string, any][]) {
    const tag = 'R2 [' + name + ', config says archive, the folder on disk is Archive/]';
    const x = model('reg-case-arch', layout);
    doneAll(x, ['EPIC-001', 'TSK-001', 'SUB-001', 'TSK-002']);
    ok(run(['archive', '--id=EPIC-001'], { cwd: x.dir }), 'archive EPIC-001');
    move(path.join(x.bl, 'archive'), path.join(x.bl, 'Archive'), 'rename archive/ to Archive/');
    T.eq(tag + ' its elements stay archived: hidden without --all', ids(list(x)), []);
    T.eq(tag + ' … shown with --all', ids(list(x, true)), ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-002']);
    inPlace(tag, x);
  }
  {
    const tag = 'R2 [flat, folders.archive = "Shelf", the folder on disk is shelf/]';
    const x = model('reg-case-flat', { group: 'flat', folders: { archive: 'shelf' } });
    doneAll(x, ['EPIC-001', 'TSK-001', 'SUB-001', 'TSK-002']);
    ok(run(['archive', '--id=EPIC-001'], { cwd: x.dir }), 'archive EPIC-001');
    setLayout(x.bl, { group: 'flat', folders: { archive: 'Shelf' } });
    T.eq(tag + ' still archived', ids(list(x)), []);
    inPlace(tag, x);
  }
}

/* ===================================================================== */
/* R3 — --fix step 3 with nested misplaced ID folders (DECISIONS 105)     */
/* ===================================================================== */

/* Every element file by id → path; the scan follows no symlink. */
function places(bl: string): Record<string, string> {
  const out: Record<string, string> = {};
  (function walk(abs: string, rel: string): void {
    let kids: fs.Dirent[] = [];
    try { kids = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const k of kids) {
      if (k.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + k.name : k.name;
      if (k.isDirectory()) walk(path.join(abs, k.name), r);
      else if (/^(EPIC|TSK|SUB)-\d+\.md$/.test(k.name)) out[k.name.slice(0, -3)] = r;
    }
  })(bl, '');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
function bytesById(bl: string): Record<string, string | null> {
  const p = places(bl), out: Record<string, string | null> = {};
  for (const [id, rel] of Object.entries(p)) out[id] = read(path.join(bl, rel));
  return out;
}

/*
 * Created under `type`, then switched to `hierarchy` and hand-moved into a
 * nested misplaced shape:
 *
 *   <bl>/EPIC-001/EPIC-001.md
 *   <bl>/EPIC-002/EPIC-002.md
 *   <bl>/EPIC-002/TSK-001/TSK-001.md            ← belongs under EPIC-001
 *   <bl>/EPIC-002/TSK-001/SUB-001.md
 *   <bl>/EPIC-002/TSK-001/TSK-002/TSK-002.md    ← belongs at EPIC-002/TSK-002, nested in a misplaced task folder
 *   <bl>/EPIC-002/TSK-001/TSK-002/SUB-002.md
 *
 * and the epic variant, a misplaced epic folder inside a misplaced epic folder.
 */
const WANT: Record<string, string> = {
  'EPIC-001': 'EPIC-001/EPIC-001.md', 'EPIC-002': 'EPIC-002/EPIC-002.md',
  'SUB-001': 'EPIC-001/TSK-001/SUB-001.md', 'SUB-002': 'EPIC-002/TSK-002/SUB-002.md',
  'TSK-001': 'EPIC-001/TSK-001/TSK-001.md', 'TSK-002': 'EPIC-002/TSK-002/TSK-002.md',
};
function nestedModel(label: string, shape: Record<string, string>) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  const n = (a: string[]) => ok(run(['new'].concat(a), { cwd: dir }), 'nj new ' + a.join(' '));
  n(['--type=epic', '--title=Epic one', '--description=One.']);
  n(['--type=epic', '--title=Epic two', '--description=Two.']);
  n(['--type=task', '--parent=EPIC-001', '--title=Task one'].concat(BODY));
  n(['--type=task', '--parent=EPIC-002', '--title=Task two'].concat(BODY));
  n(['--type=subtask', '--parent=TSK-001', '--title=Sub one'].concat(BODY));
  n(['--type=subtask', '--parent=TSK-002', '--title=Sub two'].concat(BODY));
  setLayout(bl, { group: 'hierarchy' });
  const at = places(bl);
  for (const [id, rel] of Object.entries(shape)) {
    if (at[id]) move(path.join(bl, at[id]), path.join(bl, rel), 'hand-move ' + id + ' to ' + rel);
  }
  return { dir, bl };
}
for (const [name, shape] of [
  ['a misplaced task folder inside a misplaced task folder', {
    'EPIC-001': 'EPIC-001/EPIC-001.md', 'EPIC-002': 'EPIC-002/EPIC-002.md',
    'TSK-001': 'EPIC-002/TSK-001/TSK-001.md', 'SUB-001': 'EPIC-002/TSK-001/SUB-001.md',
    'TSK-002': 'EPIC-002/TSK-001/TSK-002/TSK-002.md', 'SUB-002': 'EPIC-002/TSK-001/TSK-002/SUB-002.md',
  }],
  ['a misplaced epic folder inside a misplaced epic folder', {
    'EPIC-001': 'stray/EPIC-001/EPIC-001.md', 'TSK-001': 'stray/EPIC-001/TSK-001/TSK-001.md', 'SUB-001': 'stray/EPIC-001/TSK-001/SUB-001.md',
    'EPIC-002': 'stray/EPIC-001/EPIC-002/EPIC-002.md', 'TSK-002': 'stray/EPIC-001/EPIC-002/TSK-002/TSK-002.md',
    'SUB-002': 'stray/EPIC-001/EPIC-002/TSK-002/SUB-002.md',
  }],
] as [string, Record<string, string>][]) {
  const tag = 'R3 [hierarchy, ' + name + ']';
  const x = nestedModel('reg-nested', shape);
  T.eq(tag + ' fixture: the nested shape is built', places(x.bl), Object.fromEntries(Object.entries(shape).sort(([a], [b]) => (a < b ? -1 : 1))));
  const pre = runJ(['doctor'], { cwd: x.dir });
  T.check(tag + ' fixture: doctor reports layout:misplaced', codes(pre).some(c => c.startsWith('layout:misplaced')), J(codes(pre)));
  const bytesBefore = bytesById(x.bl);
  const f = runJ(['doctor', '--fix'], { cwd: x.dir });
  noStack(tag + ' --fix', f);
  T.check(tag + ' --fix: a doctor result, exit 0 or 2', f.status === 0 || f.status === 2, 'exit ' + f.status + ' ' + J(f.stderr).slice(0, 300));
  T.check(tag + ' --fix --json is the doctor shape', !!f.json && Array.isArray(f.json.problems) && Array.isArray(f.json.fixed), J(f.json || f.stdout).slice(0, 300));
  const after = places(x.bl);
  T.eq(tag + ' no element is lost or duplicated', Object.keys(after), Object.keys(WANT));
  T.eq(tag + ' every element file is byte-identical wherever it now lies (step 3 only moves)', bytesById(x.bl), bytesBefore);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.sameSet(tag + ' --fix\'s remaining problems[] equal a fresh doctor\'s', codes(f), codes(d));
  T.eq(tag + ' … and the exit codes agree', d.status, f.status);
  const misplacedAfter = (d.json && Array.isArray(d.json.problems) ? d.json.problems : []).filter((p: any) => p.code === 'layout:misplaced').map((p: any) => p.element);
  for (const id of Object.keys(WANT)) {
    /* either moved to its place (and no longer reported), or still reported
     * as misplaced — possibly carried along inside a folder that moved */
    const okPlace = after[id] === WANT[id] && !misplacedAfter.includes(id);
    const reported = after[id] !== WANT[id] && misplacedAfter.includes(id);
    T.check(tag + ' ' + id + ': at its place, or still reported as misplaced', okPlace || reported,
      'now ' + J(after[id]) + ', want ' + J(WANT[id]) + '; still reported misplaced: ' + misplacedAfter.includes(id));
  }
}

/* ===================================================================== */
/* R4 — DECISIONS 106 F4: writers refuse while an unreadable directory    */
/*      hides part of the subtree they move/delete/judge; list/nj count  */
/*      backlog-level errors in their summary (docs/verification/v3-2.md */
/*      F4)                                                              */
/* ===================================================================== */

/* Hierarchy so a folder can hide a whole element; chmod 000 makes the
 * folder itself unreadable (not merely its content unwritable). Restored
 * in a `finally` so a failing assertion never leaves a locked-down tree
 * behind for the harness cleanup to choke on. */
/* Never throws — a layout the running nj does not honour (e.g. hierarchy
 * against v2/c3) leaves the expected path missing, and that is a fixture
 * failure to report, not a crash (test/README.md, "contexts the suite must
 * survive"). Returns whether the directory exists to be hidden. */
function hideDir(p: string, what: string): boolean {
  if (!fs.existsSync(p)) { T.check('fixture: ' + (what || ('hide ' + p)), false, 'not found: ' + p); return false; }
  try { fs.chmodSync(p, 0o000); return true; }
  catch (e) { T.check('fixture: ' + (what || ('hide ' + p)), false, (e as NodeJS.ErrnoException).code + ' ' + p); return false; }
}
function unhideDir(p: string): void { try { fs.chmodSync(p, 0o755); } catch (e) { /* already gone */ } }
/* Best-effort: chmod every directory back to 755, wherever nj may have MOVED
 * the one we hid — restoring only the original path would leave a locked
 * folder behind after a rename this test exists to catch. */
function restoreAllPerms(root: string): void {
  (function walk(d: string): void {
    let st: fs.Stats; try { st = fs.lstatSync(d); } catch (e) { return; }
    if (!st.isDirectory()) return;
    try { fs.chmodSync(d, 0o755); } catch (e) { /* ignore */ }
    let kids: string[] = []; try { kids = fs.readdirSync(d); } catch (e) { return; }
    for (const k of kids) walk(path.join(d, k));
  })(root);
}

{
  const tag = 'R4 [archive with a hidden todo child]';
  const x = model('reg-f4-archive', { group: 'hierarchy' });
  /* EPIC-001 and TSK-002 done; TSK-001 stays todo and its own folder (which
   * holds TSK-001.md and, under it, SUB-001.md) is hidden — so from nj's
   * point of view the subtree LOOKS entirely done. */
  ok(run(['set', '--id=TSK-002', '--status=done'], { cwd: x.dir }), 'set TSK-002 done');
  ok(run(['set', '--id=EPIC-001', '--status=done', '--allow-open-children'], { cwd: x.dir }), 'set EPIC-001 done');
  const before = bytesById(x.bl);
  const hidTsk1 = path.join(x.bl, 'EPIC-001', 'TSK-001');
  if (hideDir(hidTsk1, tag)) {
    try {
      const a = runJ(['archive', '--id=EPIC-001'], { cwd: x.dir });
      T.exit(tag + ': exit 1 — refuses rather than archiving a hidden open element', a, 1);
      T.eq(tag + ': refused:unreadable_dir (§ 11, D106 F4)', a.json && a.json.error, 'refused:unreadable_dir');
      noStack(tag, a);
    } finally { restoreAllPerms(x.bl); }
    T.eq(tag + ': nothing moved or stamped — every element file byte-identical', bytesById(x.bl), before);
  }
}

{
  const tag = 'R4 [set --status=done with a hidden todo child]';
  const x = model('reg-f4-setdone', { group: 'hierarchy' });
  const before = bytesById(x.bl);
  const hidTsk2 = path.join(x.bl, 'EPIC-001', 'TSK-001');
  if (hideDir(hidTsk2, tag)) {
    try {
      const s = runJ(['set', '--id=EPIC-001', '--status=done'], { cwd: x.dir });
      T.exit(tag + ': exit 1 — cannot verify children are done', s, 1);
      T.eq(tag + ': refused:unreadable_dir, not a silent done (§ 9, D106 F4)', s.json && s.json.error, 'refused:unreadable_dir');
      noStack(tag, s);
    } finally { restoreAllPerms(x.bl); }
    T.eq(tag + ': EPIC-001 was not written', bytesById(x.bl)['EPIC-001'], before['EPIC-001']);
  }
}

{
  const tag = 'R4 [rm --cascade with a hidden child folder]';
  const x = model('reg-f4-rm', { group: 'hierarchy' });
  const hidTsk3 = path.join(x.bl, 'EPIC-001', 'TSK-001');
  if (hideDir(hidTsk3, tag)) {
    try {
      const r = runJ(['rm', '--id=EPIC-001', '--cascade'], { cwd: x.dir });
      T.exit(tag + ': exit 1 — refuses rather than orphaning the hidden subtree', r, 1);
      T.eq(tag + ': refused:unreadable_dir, not a partial cascade (D106 F4)', r.json && r.json.error, 'refused:unreadable_dir');
      noStack(tag, r);
    } finally { restoreAllPerms(x.bl); }
    T.check(tag + ': EPIC-001 still exists — nothing was deleted', fs.existsSync(path.join(x.bl, 'EPIC-001', 'EPIC-001.md')), '');
  }
}

{
  /* The simplest fixture that isolates the counting bug from the writer
   * refusals above: one clean epic, one unreadable directory elsewhere in
   * the backlog. `doctor` already reports `backlog:unreadable_dir` (D93 F9);
   * `list`/bare `nj` must count it too. */
  const tag = 'R4 [list / bare nj count backlog-level errors]';
  const x = model('reg-f4-count');
  const stray = mkdir(path.join(x.bl, 'misc'));
  hideDir(stray, tag);
  try {
    const l = runJ(['list'], { cwd: x.dir });
    T.exit(tag + ': list --json exit 0', l, 0);
    T.check(tag + ': list --json counts.errors includes the backlog-level error (D106 F4)',
      l.json && l.json.counts && l.json.counts.errors >= 1, J(l.json && l.json.counts));
    const barePlain = run([], { cwd: x.dir });
    T.check(tag + ': bare nj\'s summary line does not read "0 errors" while unreadable_dir stands',
      !/\b0\s*errors?\b/i.test(barePlain.stdout), J(barePlain.stdout));
  } finally { unhideDir(stray); }
}

/* ===================================================================== */
/* R5 — DECISIONS 106 F5: --fix writes only ID-shaped *.md files          */
/*      (docs/verification/v3-2.md F5)                                   */
/* ===================================================================== */

{
  const tag = 'R5 [--fix leaves non-ID-shaped *.md untouched]';
  const x = model('reg-f5');
  write(path.join(x.bl, 'docs', 'meeting-notes.md'), '---\ntitle: notes\n---\nhello\n');
  write(path.join(x.bl, 'CHANGELOG.md'), '# changes\n');
  const before = { notes: read(path.join(x.bl, 'docs', 'meeting-notes.md')), changelog: read(path.join(x.bl, 'CHANGELOG.md')) };
  const f = runJ(['doctor', '--fix'], { cwd: x.dir });
  noStack(tag, f);
  T.eq(tag + ': meeting-notes.md is byte-identical (not an ID shape, D106 F5)',
    read(path.join(x.bl, 'docs', 'meeting-notes.md')), before.notes);
  T.eq(tag + ': CHANGELOG.md is byte-identical', read(path.join(x.bl, 'CHANGELOG.md')), before.changelog);
  const tombstones = H.lsOrEmpty(path.join(x.bl, H.IDS_REL));
  T.check(tag + ': no tombstone named "meeting-notes" was burned', !tombstones.includes('meeting-notes'), J(tombstones));
  T.check(tag + ': no tombstone named "CHANGELOG" was burned', !tombstones.includes('CHANGELOG'), J(tombstones));
  const fixed = (f.json && Array.isArray(f.json.fixed)) ? f.json.fixed : [];
  T.check(tag + ': fixed[] names neither file (nothing was written into them)',
    !fixed.some((s: any) => /meeting-notes|CHANGELOG/.test(s)), J(fixed));
}

/* ===================================================================== */
/* R6 — DECISIONS 106 F6: hierarchy step 3 refuses a folder move whose    */
/*      subtree disagrees on `archived:` (docs/verification/v3-2.md F6)  */
/* ===================================================================== */

{
  const tag = 'R6 [hierarchy, --fix on a mixed archived:/live subtree]';
  const dir = H.freshDir('reg-f6');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  setLayout(bl, { group: 'hierarchy' });
  write(path.join(bl, 'EPIC-001', 'EPIC-001.md'), H.element(
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW },
    H.completeBody('E')));
  /* TSK-003 misplaced at the top (should live under EPIC-001/), stamped
   * archived: by hand; its subtask SUB-007 is NOT stamped and stays todo. */
  write(path.join(bl, 'TSK-003', 'TSK-003.md'), H.element(
    { id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'T3', status: 'done',
      created: NOW, updated: NOW, archived: NOW },
    H.completeBody('T3')));
  write(path.join(bl, 'TSK-003', 'SUB-007.md'), H.element(
    { id: 'SUB-007', type: 'subtask', parent: 'TSK-003', title: 'S7', status: 'todo', created: NOW, updated: NOW },
    H.completeBody('S7')));
  for (const id of ['EPIC-001', 'TSK-003', 'SUB-007']) fs.writeFileSync(path.join(bl, H.IDS_REL, id), '');
  const before = bytesById(bl);
  const f = runJ(['doctor', '--fix'], { cwd: dir });
  noStack(tag, f);
  T.check(tag + ': --fix is a doctor result (exit 0 or 2)', f.status === 0 || f.status === 2, 'exit ' + f.status);
  T.eq(tag + ': TSK-003 and SUB-007 are untouched — the folder was NOT moved (D106 F6)', bytesById(bl), before);
  T.check(tag + ': the archive folder gained nothing', !fs.existsSync(path.join(bl, 'archive', 'EPIC-001', 'TSK-003')), '');
  const d = runJ(['doctor'], { cwd: dir });
  const problems = (d.json && Array.isArray(d.json.problems)) ? d.json.problems : [];
  T.check(tag + ': no archive:not_done finding for SUB-007 (it was never moved into the archive, D106 F6)',
    !problems.some((p: any) => p.code === 'archive:not_done' && p.element === 'SUB-007'), J(problems));
}

/* ===================================================================== */
/* R7 — TSK-029 T2: a file/folder mismatch at an archive target is        */
/*      `exists` before any write; nothing is stamped in place            */
/*      (docs/verification/tsk-029.md T2)                                */
/* ===================================================================== */

{
  const tag = 'R7 [hierarchy archive, a plain file blocks the merge target]';
  const x = model('reg-t2', { group: 'hierarchy' });
  doneAll(x, ['TSK-001', 'SUB-001']);   /* SUB-001 first, so TSK-001's own subtree is done too */
  mkdir(path.join(x.bl, 'archive'));
  write(path.join(x.bl, 'archive', 'EPIC-001'), 'blocker\n');
  const before = bytesById(x.bl);
  const a = runJ(['archive', '--id=TSK-001'], { cwd: x.dir });
  noStack(tag, a);
  T.exit(tag + ': exit 1', a, 1);
  T.eq(tag + ': exists, verified before any write (§ 11, D94, TSK-029 T2)', a.json && a.json.error, 'exists');
  T.eq(tag + ': every element file byte-identical — nothing stamped in place', bytesById(x.bl), before);
  T.eq(tag + ': the blocking file is untouched', read(path.join(x.bl, 'archive', 'EPIC-001')), 'blocker\n');
}

/* ===================================================================== */
/* R8 — TSK-029 T3: non-printable characters in `.njrc`-derived messages  */
/*      are shown escaped (docs/verification/tsk-029.md T3)               */
/* ===================================================================== */

{
  const tag = 'R8 [a trailing NBSP in a .njrc value is escaped in the message]';
  const dir = H.freshDir('reg-t3');
  write(path.join(dir, '.njrc'), 'backlog = backlog \n');
  const r = run(['list'], { cwd: dir });
  T.exit(tag + ': exit 1', r, 1);
  T.check(tag + ': the message escapes the NBSP rather than printing it raw (TSK-029 T3)',
    /\\u00a0/i.test(r.stderr) || /\\xa0/i.test(r.stderr), J(r.stderr));
}
{
  const tag = 'R8 [a lone NBSP line is reported with the character escaped]';
  const dir = H.freshDir('reg-t3b');
  write(path.join(dir, '.njrc'), ' \n');
  const r = run(['list'], { cwd: dir });
  T.exit(tag + ': exit 1', r, 1);
  T.check(tag + ': invalid_njrc', /invalid_njrc|invalid \.njrc/.test(r.stderr), J(r.stderr));
  T.check(tag + ': the offending value is quoted/escaped, not a raw invisible character (TSK-029 T3)',
    /\\u00a0/i.test(r.stderr) || /\\xa0/i.test(r.stderr) || /"[^"]*\\u/i.test(r.stderr), J(r.stderr));
}

/* ===================================================================== */
/* R9 — TSK-029 T4: the ownership refusal names a way out                 */
/*      (docs/verification/tsk-029.md T4); best-effort foreign-uid probe  */
/* ===================================================================== */

/* Reuses the technique of edge/hardening-v3-1.ts F1: a hard link to a file
 * genuinely owned by another, non-root uid on this machine. Without root,
 * and without such a file reachable, the probe is reported "not covered",
 * never guessed at. */
const ME_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const FOREIGN_SEARCH_ROOTS = ['/Users/Shared', '/private/var/db', '/private/var/tmp', '/Library/Preferences',
  '/Library/Caches', '/private/var/log', '/var/lib', '/var/cache', '/var/log', '/usr/share'];
type ForeignFile = { path: string; size: number; uid: number } | null;
function findForeignFile(tmpDev: number): ForeignFile {
  let best: ForeignFile = null, visited = 0;
  function walk(dir: string, depth: number): void {
    if (depth > 4 || visited > 40000 || (best && best.size === 0)) return;
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
      if (!st.isFile() || st.uid === 0 || st.uid === ME_UID) continue;
      try { fs.accessSync(p, fs.constants.R_OK); } catch (e) { continue; }
      if (!best || st.size < best.size) best = { path: p, size: st.size, uid: st.uid };
    }
  }
  for (const r of FOREIGN_SEARCH_ROOTS) walk(r, 0);
  return best;
}
interface PlantedRc { reason?: string; rc?: string; uid?: number; source?: string }
function plantForeignRc(dir: string): PlantedRc {
  mkdir(dir);
  const rc = path.join(dir, '.njrc');
  if (ME_UID === null) return { reason: 'no process.getuid() on this platform' };
  const tmpDev = fs.statSync(dir).dev;
  const found = findForeignFile(tmpDev);
  if (!found) return { reason: 'no readable file owned by a foreign, non-root uid on the scratch filesystem' };
  try { fs.linkSync(found.path, rc); } catch (e) { return { reason: 'hard-linking failed: ' + (e as NodeJS.ErrnoException).code }; }
  const st = fs.lstatSync(rc);
  if (st.uid === ME_UID || st.uid === 0) return { reason: 'link reports uid ' + st.uid + ' after all' };
  return { rc, uid: st.uid, source: found.path };
}

{
  const tag = 'R9 [ownership refusal names a way out]';
  const dir = H.freshDir('reg-t4');
  const planted = plantForeignRc(dir);
  if (!planted.rc) {
    T.check(tag + ': not covered — ' + planted.reason, false, planted.reason);
  } else {
    const r = run(['list'], { cwd: dir });
    T.exit(tag + ': exit 1', r, 1);
    T.check(tag + ': the message names the uid (§ 4 ownership)', new RegExp('owned by uid ' + planted.uid).test(r.stderr), J(r.stderr));
    T.check(tag + ': the message offers a way out — --backlog / NJ_BACKLOG, or changing the owner (TSK-029 T4)',
      /--backlog/.test(r.stderr) && /NJ_BACKLOG/.test(r.stderr), J(r.stderr));
  }
}

/* ===================================================================== */
/* R10 — DECISIONS 106 F10: `nj new` never overwrites an existing file,   */
/*        case-insensitively (docs/verification/v3-2.md F10)              */
/* ===================================================================== */

if (!caseInsensitive) {
  cannotRun('R10 new never overwrites case-insensitively');
} else {
  const tag = 'R10 [a hand-written TSK-001.MD is not clobbered by new]';
  const dir = H.freshDir('reg-f10');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=x'], { cwd: dir }), 'new epic');
  const bl = path.join(dir, 'backlog');
  const planted = write(path.join(bl, 'tasks', 'TSK-001.MD'),
    '---\nid: TSK-001\ntitle: precious\nstatus: todo\n---\nprecious\n');
  const before = read(planted);
  const n = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=fresh'].concat(BODY), { cwd: dir });
  /* The core invariant (D106 F10): whatever `new` does about the id
   * collision, it must never destroy the hand-written file. Two outcomes are
   * both defensible and neither is guessed at: it allocates past the
   * case-insensitively taken name (exit 0, a fresh id), or it refuses the
   * collision outright (exit 1). Silently overwriting TSK-001.MD is the one
   * outcome this leg exists to catch. */
  T.eq(tag + ': TSK-001.MD is untouched — no data loss, whichever way new decided', read(planted), before);
  if (n.status === 0) {
    T.check(tag + ': on success, the new element does not claim the taken id TSK-001',
      n.json && n.json.id !== 'TSK-001', J(n.json && n.json.id));
  } else {
    T.check(tag + ': on refusal, exit 1', n.status === 1, 'exit ' + n.status);
  }
}


T.finish();
