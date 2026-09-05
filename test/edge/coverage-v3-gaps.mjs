/* v3 coverage gaps — the checks `test/COVERAGE-v3.md` found missing.
 *
 * Every section is named after its clause ID in COVERAGE-v3.md, which quotes
 * the spec passage or ruling it comes from. The topics belong to other
 * suites (AC-21/22/23, owned by the Oracle, whose files are being edited for
 * the V3-3 batch). The lead ruled that gap checks go here rather than into
 * those files; the Oracle may move any section into its suite later.
 *
 * Black box, as everywhere: nj through spawnSync; exit code, stdout, stderr
 * and file bytes only.
 *
 * LAYOUT-NEUTRAL BY CONSTRUCTION. Backlogs are made with `nj init`, elements
 * with `nj new`. The one bookkeeping file a leg must edit — the
 * configuration, to set a `layout` block — is found where init put it
 * (`.nanojira/config.json` from V3-4, `.nanojira.json` before). So this file
 * needs no edit when V3-4 moves the storage.
 *
 * Written before V3-2 … V3-4: against c3-baseline (`1e85263`) most legs fail
 * on their assertions, never on a crash.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('gaps-home');
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  return { cwd: o.cwd, env, unsetEnv: env.NJ_BACKLOG === undefined ? ['NJ_BACKLOG'] : [] };
}
/* Every --json failure seen in this file, for the closed-vocabulary sweep (F01). */
const FAILURES = [];
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) {
  const r = H.runJson(args, envFor(o));
  /* a failure shape — not doctor's {backlog, ok:false, problems} report */
  if (r.json && r.json.ok === false && !Array.isArray(r.json.problems)) FAILURES.push([args.join(' '), r.json.error]);
  return r;
}

/* ---- fixtures ------------------------------------------------------------ */

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function write(p, s) { mkdir(path.dirname(p)); fs.writeFileSync(p, s); return p; }
function read(p) { return H.readOrNull(p); }

/* A backlog made by nj: {dir (project), bl (backlog)}. */
function initBacklog(label) {
  const dir = H.freshDir(label);
  const r = run(['init'], { cwd: dir });
  if (r.missing || r.status !== 0) T.check('fixture: nj init (' + label + ')', false, r.status + ' ' + J(r.stderr));
  return { dir, bl: path.join(dir, 'backlog') };
}
/* Where init put the configuration / the tombstones. */
function cfgPath(bl) {
  const v3 = path.join(bl, '.nanojira', 'config.json');
  return fs.existsSync(v3) ? v3 : path.join(bl, '.nanojira.json');
}
function idsDir(bl) {
  const v3 = path.join(bl, '.nanojira', 'ids');
  return fs.existsSync(v3) ? v3 : path.join(bl, '.ids');
}
function setLayout(bl, layout) {
  const p = cfgPath(bl);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return T.check('fixture: read the configuration init wrote (' + p + ')', false, e.message);
  }
  if (layout === undefined) delete cfg.layout; else cfg.layout = layout;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}
function nw(x, args) {
  const r = runJ(['new'].concat(args), { cwd: x.dir });
  if (r.status !== 0) T.check('fixture: nj new ' + args.join(' '), false, r.status + ' ' + J(r.stderr));
  return r.json && r.json.id;
}
const DESC = ['--description=Something.'];
const COMPLETE = ['--description=Something.', '--acceptance=- [ ] It works'];
function epic(x, title, extra) { return nw(x, ['--type=epic', '--title=' + (title || 'Epic')].concat(DESC, extra || [])); }
function task(x, parent, title, extra) {
  return nw(x, ['--type=task', '--parent=' + parent, '--title=' + (title || 'Task')].concat(COMPLETE, extra || []));
}
function sub(x, parent, title) { return nw(x, ['--type=subtask', '--parent=' + parent, '--title=' + (title || 'Sub')].concat(COMPLETE)); }

/* Every element file below the backlog by id → relative path (dot-dirs skipped). */
function places(bl) {
  const out = {};
  (function walk(abs, rel) {
    let kids = [];
    try { kids = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const k of kids) {
      if (k.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + k.name : k.name;
      if (k.isDirectory()) walk(path.join(abs, k.name), r);
      else if (/^(EPIC|TSK|SUB)-\d+\.md$/.test(k.name)) out[k.name.slice(0, -3)] = r;
    }
  })(bl, '');
  return sorted(out);
}
function sorted(o) { return Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))); }
/* Move a file or folder by hand. Never throws: against an nj that put the
 * element somewhere else (a layout it does not implement yet) the source is
 * looked up by id, and a fixture that cannot be built fails as a check. */
function move(bl, from, to) {
  let src = path.join(bl, from);
  if (!fs.existsSync(src)) {
    const id = path.basename(from).replace(/\.md$/, '');
    const at = places(bl)[id];
    if (at && /\.md$/.test(from)) src = path.join(bl, at);
  }
  try {
    mkdir(path.dirname(path.join(bl, to)));
    fs.renameSync(src, path.join(bl, to));
    return true;
  } catch (e) {
    T.check('fixture: move ' + from + ' → ' + to, false, e.code + ' (nj placed it elsewhere: ' + J(places(bl)) + ')');
    return false;
  }
}
function codesOf(json, id) {
  const e = json && Array.isArray(json.entries) ? json.entries.find(x => x.id === id) : null;
  return e && Array.isArray(e._problems) ? e._problems : null;
}
function doctorCodes(r) { return (r.json && Array.isArray(r.json.problems) ? r.json.problems : []).map(p => p.code + ':' + p.severity); }
function findingsFor(r, id) {
  return (r.json && Array.isArray(r.json.problems) ? r.json.problems : []).filter(p => p.element === id).map(p => p.code);
}
function ids(json) { return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : []; }

/* ===================================================================== */
/* L10 / W01 — every command works on a misplaced file; writes land where */
/* it lies (§ 4; DECISIONS 97 62)                                          */
/* ===================================================================== */

/* Three ways to be misplaced: group `type` with a hand-moved file, and a
 * group change to `flat` or `hierarchy` on a populated backlog. */
const MISPLACE = {
  'type, hand-moved': x => { move(x.bl, 'tasks/TSK-001.md', 'epics/TSK-001.md'); },
  'flat after a group change': x => { setLayout(x.bl, { group: 'flat' }); },
  'hierarchy after a group change': x => { setLayout(x.bl, { group: 'hierarchy' }); },
};
for (const [how, misplace] of Object.entries(MISPLACE)) {
  const tag = 'L10/W01 [' + how + ']';
  const x = initBacklog('gaps-mis');
  epic(x); task(x, 'EPIC-001'); sub(x, 'TSK-001');
  misplace(x);
  const at = places(x.bl)['TSK-001'] || '<no TSK-001>';
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check(tag + ' fixture: TSK-001 is reported misplaced',
    findingsFor(d, 'TSK-001').some(c => c === 'type:folder' || c === 'layout:misplaced'), J(findingsFor(d, 'TSK-001')));

  const n = runJ(['note', '--id=TSK-001', 'Noted while misplaced'], { cwd: x.dir });
  T.exit(tag + ' note on the misplaced file: exit 0', n, 0);
  T.check(tag + ' the note lands in the file where it lies', (read(path.join(x.bl, at)) || '').includes('Noted while misplaced'),
    'file ' + at);
  const s = runJ(['set', '--id=TSK-001', '--status=doing'], { cwd: x.dir });
  T.exit(tag + ' set on the misplaced file: exit 0', s, 0);
  T.check(tag + ' the new status lands in the file where it lies', /^status: doing$/m.test(read(path.join(x.bl, at)) || ''),
    'file ' + at);
  T.eq(tag + ' the writes did not relocate it (only archive, --fix or the user move files)', places(x.bl)['TSK-001'], at);

  const rm = runJ(['rm', '--id=SUB-001'], { cwd: x.dir });
  T.exit(tag + ' rm of a (possibly) misplaced subtask: exit 0', rm, 0);
  T.check(tag + ' rm removed its file', places(x.bl)['SUB-001'] === undefined, J(places(x.bl)));
}
{
  const tag = 'L10 [type, hand-moved] archive';
  const x = initBacklog('gaps-mis-arch');
  epic(x); task(x, 'EPIC-001');
  run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir });
  run(['set', '--id=EPIC-001', '--status=done'], { cwd: x.dir });
  move(x.bl, 'tasks/TSK-001.md', 'subtasks/TSK-001.md');
  const a = runJ(['archive', '--id=EPIC-001'], { cwd: x.dir });
  T.exit(tag + ' of a subtree with a misplaced member: exit 0', a, 0);
  T.eq(tag + ': both files are in the archive folder', [places(x.bl)['EPIC-001'], places(x.bl)['TSK-001']],
    ['archive/EPIC-001.md', 'archive/TSK-001.md']);
}
{
  const tag = 'L10 [type, hand-moved] rm --cascade';
  const x = initBacklog('gaps-mis-casc');
  epic(x); task(x, 'EPIC-001'); sub(x, 'TSK-001');
  move(x.bl, 'tasks/TSK-001.md', 'epics/TSK-001.md');
  const r = runJ(['rm', '--id=EPIC-001', '--cascade'], { cwd: x.dir });
  T.exit(tag + ' over a misplaced member: exit 0', r, 0);
  T.eq(tag + ': no element file is left', places(x.bl), {});
}

/* L11 — "`nj set` has no --parent" (§ 4) is obsolete since TSK-056/D176/
 * D177: `set --parent=<id>` reparents a task or subtask. Dropped rather
 * than updated in place — the full behaviour (same-type reparent, the
 * error codes mirroring `new`'s own, the hierarchy move, the restore
 * round trip) is owned by ac/ac-53-set-parent.js, which would otherwise
 * duplicate it. */

/* ===================================================================== */
/* C07 / C09 — § 5 folder names                                            */
/* ===================================================================== */
for (const [label, folders] of [
  ['SUB-<n>', { subtasks: 'SUB-3' }],
  ['sub-<n> in lower case', { tasks: 'sub-12' }],
]) {
  const x = initBacklog('gaps-subname');
  setLayout(x.bl, { folders });
  const r = runJ(['list'], { cwd: x.dir });
  T.exit('C07 a folder name of the form ' + label + ': list exit 1', r, 1);
  T.eq('C07 a folder name of the form ' + label + ': invalid_config', r.json && r.json.error, 'invalid_config');
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit('C07 a folder name of the form ' + label + ': doctor exit 2', d, 2);
  T.check('C07 a folder name of the form ' + label + ': doctor reports config:invalid', doctorCodes(d).includes('config:invalid:error'),
    J(doctorCodes(d)));
}
for (const [group, want] of [
  ['flat', { 'EPIC-001': 'EPIC-001.md', 'TSK-001': 'TSK-001.md', 'SUB-001': 'SUB-001.md' }],
  ['hierarchy', { 'EPIC-001': 'EPIC-001/EPIC-001.md', 'TSK-001': 'EPIC-001/TSK-001/TSK-001.md', 'SUB-001': 'EPIC-001/TSK-001/SUB-001.md' }],
]) {
  /* § 5: "Under hierarchy and flat only archive is used" — renamed type
   * folders change nothing about where elements go. */
  const tag = 'C09 [' + group + ', renamed epics/tasks/subtasks]';
  const x = initBacklog('gaps-unused');
  setLayout(x.bl, { group, folders: { epics: 'big', tasks: 'work', subtasks: 'small' } });
  epic(x); task(x, 'EPIC-001'); sub(x, 'TSK-001');
  T.eq(tag + ' new puts every element at its ' + group + ' place', places(x.bl), sorted(want));
  T.check(tag + ' no renamed type folder is created',
    !['big', 'work', 'small'].some(n => fs.existsSync(path.join(x.bl, n))), J(H.lsOrEmpty(x.bl)));
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check(tag + ' doctor reports no layout code', !doctorCodes(d).some(c => /^(layout:misplaced|type:folder)/.test(c)), J(doctorCodes(d)));
}

/* ===================================================================== */
/* P02 — layout:misplaced blocks --ready (§ 7)                             */
/* ===================================================================== */
{
  const x = initBacklog('gaps-ready');
  setLayout(x.bl, { group: 'flat' });
  epic(x); task(x, 'EPIC-001', 'Ready task');
  const before = runJ(['list', '--ready'], { cwd: x.dir });
  T.check('P02 control: the complete todo task is ready at its flat place', ids(before.json).includes('TSK-001'), J(ids(before.json)));
  move(x.bl, 'TSK-001.md', 'stray/TSK-001.md');
  const l = runJ(['list', '--all'], { cwd: x.dir });
  T.check('P02 the moved task carries layout:misplaced', (codesOf(l.json, 'TSK-001') || []).includes('layout:misplaced'),
    J(codesOf(l.json, 'TSK-001')));
  const r = runJ(['list', '--ready'], { cwd: x.dir });
  T.exit('P02 list --ready: exit 0', r, 0);
  T.check('P02 layout:misplaced keeps it out of --ready (§ 7: blocks --ready)', !ids(r.json).includes('TSK-001'), J(ids(r.json)));
}

/* ===================================================================== */
/* T02 — the start value counts element files wherever they lie (§ 8)     */
/* ===================================================================== */
{
  const x = initBacklog('gaps-start-flat');
  setLayout(x.bl, { group: 'flat' });
  epic(x);
  write(path.join(x.bl, 'TSK-007.md'), H.element({ id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'Untombstoned',
    status: 'todo', created: NOW, updated: NOW }, H.completeBody('Untombstoned')));
  T.eq('T02 [flat] a new task allocates above an untombstoned TSK-007', task(x, 'EPIC-001'), 'TSK-008');
}
{
  const x = initBacklog('gaps-start-hier');
  setLayout(x.bl, { group: 'hierarchy' });
  epic(x);
  write(path.join(x.bl, 'EPIC-001/TSK-005/TSK-005.md'), H.element({ id: 'TSK-005', type: 'task', parent: 'EPIC-001',
    title: 'Untombstoned', status: 'todo', created: NOW, updated: NOW }, H.completeBody('Untombstoned')));
  write(path.join(x.bl, 'archive/EPIC-009/EPIC-009.md'), H.element({ id: 'EPIC-009', type: 'epic', title: 'Archived, untombstoned',
    status: 'done', created: NOW, updated: NOW, archived: NOW }, '# Archived, untombstoned\n\n## Description\nD.\n'));
  T.eq('T02 [hierarchy] a new task allocates above an untombstoned TSK-005 in its folder', task(x, 'EPIC-001'), 'TSK-006');
  T.eq('T02 [hierarchy] a new epic allocates above an untombstoned archived EPIC-009', epic(x, 'Next'), 'EPIC-010');
}

/* ===================================================================== */
/* K06 — an interrupted hierarchy merge is archive:split (§ 12 limit)     */
/* ===================================================================== */
{
  const x = initBacklog('gaps-split');
  setLayout(x.bl, { group: 'hierarchy' });
  epic(x); task(x, 'EPIC-001');
  run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir });
  run(['set', '--id=EPIC-001', '--status=done'], { cwd: x.dir });
  const a = runJ(['archive', '--id=EPIC-001'], { cwd: x.dir });
  T.exit('K06 fixture: archive the hierarchy subtree', a, 0);
  /* the state a crash between the merge renames leaves: the task still live
   * under its archived parent */
  move(x.bl, 'archive/EPIC-001/TSK-001', 'EPIC-001/TSK-001');
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit('K06 a half-merged hierarchy archive: doctor exit 2', d, 2);
  T.check('K06 a half-merged hierarchy archive is reported as archive:split', doctorCodes(d).some(c => c.startsWith('archive:split')),
    J(doctorCodes(d)));
}

/* ===================================================================== */
/* D14 — --fix removes only emptied ID-shaped folders, never recursively   */
/* ===================================================================== */
{
  const tag = 'D14 [hierarchy → type]';
  const x = initBacklog('gaps-rmdir');
  setLayout(x.bl, { group: 'hierarchy' });
  epic(x); task(x, 'EPIC-001');
  write(path.join(x.bl, 'misc/notes.txt'), 'mine\n');
  mkdir(path.join(x.bl, 'empty-misc'));
  write(path.join(x.bl, 'EPIC-001/keep.txt'), 'foreign content\n');
  setLayout(x.bl, { group: 'type' });
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(tag + ' --fix: exit 0', r, 0);
  T.eq(tag + ' elements moved to the type folders', places(x.bl), sorted({ 'EPIC-001': 'epics/EPIC-001.md', 'TSK-001': 'tasks/TSK-001.md' }));
  T.check(tag + ' a non-ID folder with content is kept', read(path.join(x.bl, 'misc/notes.txt')) === 'mine\n', J(H.lsOrEmpty(x.bl)));
  T.check(tag + ' an empty non-ID folder is kept (only ID-shaped folders are removed)', fs.existsSync(path.join(x.bl, 'empty-misc')),
    J(H.lsOrEmpty(x.bl)));
  T.eq(tag + ' an ID-shaped folder still holding foreign content survives with it', read(path.join(x.bl, 'EPIC-001/keep.txt')),
    'foreign content\n');
  T.check(tag + ' the emptied ID-shaped task folder is removed', !fs.existsSync(path.join(x.bl, 'EPIC-001/TSK-001')),
    J(H.lsOrEmpty(path.join(x.bl, 'EPIC-001'))));
}

/* ===================================================================== */
/* D15 — --fix never archives or un-archives (DECISIONS 92 Q2)             */
/* ===================================================================== */
{
  const x = initBacklog('gaps-unarch');
  epic(x); task(x, 'EPIC-001'); task(x, 'EPIC-001', 'Hand-archived stamp');
  move(x.bl, 'tasks/TSK-001.md', 'archive/TSK-001.md');                 // archived by location, no archived:
  const f2 = path.join(x.bl, 'tasks/TSK-002.md');
  write(f2, (read(f2) || '').replace(/^(updated: .*)$/m, '$1\narchived: ' + NOW));   // archived: at an active place
  run(['doctor', '--fix'], { cwd: x.dir });
  T.eq('D15 a file below the archive folder without archived: stays archived', places(x.bl)['TSK-001'], 'archive/TSK-001.md');
  T.eq('D15 a hand-written archived: at an active place stays active', places(x.bl)['TSK-002'], 'tasks/TSK-002.md');
  const l = runJ(['list'], { cwd: x.dir });
  T.check('D15 list: TSK-001 is not active, TSK-002 is', !ids(l.json).includes('TSK-001') && ids(l.json).includes('TSK-002'),
    J(ids(l.json)));
}

/* ===================================================================== */
/* D17 — parent:cycle under hierarchy: no layout code, never moved (D91)  */
/* ===================================================================== */
{
  const x = initBacklog('gaps-cycle');
  setLayout(x.bl, { group: 'hierarchy' });
  epic(x);
  const t = (id, parent) => H.element({ id, type: 'task', parent, title: 'Cycle ' + id, status: 'todo', created: NOW, updated: NOW },
    H.completeBody('Cycle ' + id));
  write(path.join(x.bl, 'TSK-001/TSK-001.md'), t('TSK-001', 'TSK-002'));
  write(path.join(x.bl, 'TSK-002/TSK-002.md'), t('TSK-002', 'TSK-001'));
  for (const id of ['TSK-001', 'TSK-002']) write(path.join(idsDir(x.bl), id), '');
  const before = places(x.bl);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('D17 fixture: parent:cycle is reported', doctorCodes(d).some(c => c.startsWith('parent:cycle')), J(doctorCodes(d)));
  for (const id of ['TSK-001', 'TSK-002']) {
    T.check('D17 ' + id + ' in a parent cycle carries no layout code', !findingsFor(d, id).includes('layout:misplaced'),
      J(findingsFor(d, id)));
  }
  run(['doctor', '--fix'], { cwd: x.dir });
  T.eq('D17 --fix moves neither member of the cycle', places(x.bl), before);
}

/* ===================================================================== */
/* N05 / N06 — scan bounds (DECISIONS 91 B11, B12)                        */
/* ===================================================================== */
{
  const x = initBacklog('gaps-nm');
  epic(x);
  write(path.join(x.bl, 'node_modules/TSK-009.md'), H.element({ id: 'TSK-009', type: 'task', parent: 'EPIC-001', title: 'In node_modules',
    status: 'todo', created: NOW, updated: NOW }, H.completeBody('In node_modules')));
  write(path.join(idsDir(x.bl), 'TSK-009'), '');
  const l = runJ(['list', '--all'], { cwd: x.dir });
  T.check('N05 an element file under node_modules/ is read (no special role)', ids(l.json).includes('TSK-009'), J(ids(l.json)));
  T.check('N05 … and carries type:folder', (codesOf(l.json, 'TSK-009') || []).includes('type:folder'), J(codesOf(l.json, 'TSK-009')));
  run(['doctor', '--fix'], { cwd: x.dir });
  T.eq('N05 --fix moves it to tasks/', places(x.bl)['TSK-009'], 'tasks/TSK-009.md');
}
{
  const x = initBacklog('gaps-status-deep');
  epic(x);
  write(path.join(x.bl, 'tasks/STATUS.md'), '# Not the overview\n');
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit('N06 a STATUS.md below the top level is an element file: doctor exit 2', d, 2);
  T.check('N06 … and a finding names tasks/STATUS.md',
    (d.json && Array.isArray(d.json.problems) ? d.json.problems : []).some(p => J(p).includes('STATUS.md')), J(d.json && d.json.problems).slice(0, 300));
}

/* ===================================================================== */
/* S04 / S14 / D16 — STATUS.md (§ 4, § 14, DECISIONS 95 B19)              */
/* (S07 and S22 are closed in ac-23 C3b and exit-doctor-fix by the Oracle) */
/* ===================================================================== */

/* The ids listed in one `## <status> (n)` section of STATUS.md, in order. */
function statusSection(bl, status) {
  const t = read(path.join(bl, 'STATUS.md'));
  if (t === null) return null;
  const parts = t.split(/^## /m);
  const sec = parts.find(p => p.startsWith(status + ' ('));
  if (!sec) return [];
  return [...sec.matchAll(/^- \[([A-Z]+-\d+)\]\(([^)]*)\)/mg)].map(m => m[1] + ' ' + m[2]);
}
{
  /* S04: never read — a hand-edited STATUS.md changes no command's output */
  const x = initBacklog('gaps-never-read');
  epic(x); task(x, 'EPIC-001'); task(x, 'EPIC-001', 'Second');
  const reads = [[], ['list'], ['list', '--all'], ['list', '--ready'], ['tree'], ['show', '--id=TSK-001']];
  const snap = () => reads.map(a => { const h = run(a, { cwd: x.dir }), j = run(a.concat(['--json']), { cwd: x.dir }); return [h.status, h.stdout, j.stdout]; });
  const before = snap();
  const lie = '# Status\n\n## done (1)\n\n- [TSK-001](tasks/TSK-001.md) A lie\n';
  write(path.join(x.bl, 'STATUS.md'), lie);
  T.eq('S04 a hand-edited STATUS.md changes no read command\'s output (human and --json)', snap(), before);
  T.eq('S04 reads leave the hand-edited STATUS.md alone', read(path.join(x.bl, 'STATUS.md')), lie);
}
{
  /* S14: a failed overview keeps doctor --fix's exit code — also 2 */
  const x = initBacklog('gaps-fix-exit');
  epic(x);
  write(path.join(x.bl, 'tasks/TSK-001.md'), H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-999', title: 'Dangling',
    status: 'todo', created: NOW, updated: NOW }, H.completeBody('Dangling')));
  write(path.join(idsDir(x.bl), 'TSK-001'), '');
  try { fs.rmSync(path.join(x.bl, 'STATUS.md'), { force: true }); } catch (e) { /* absent */ }
  write(path.join(x.bl, 'STATUS.md', 'blocker'), 'a directory where the overview goes\n');
  const r = run(['doctor', '--fix'], { cwd: x.dir });
  T.exit('S14 doctor --fix with a surviving error and an unwritable STATUS.md: exit 2', r, 2);
  T.check('S14 … and it prints the § 4 warning', /^Warning: STATUS\.md not updated \(.+\)$/m.test(r.stderr || ''), J(r.stderr));
  const rj = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('S14 --json: exit 2', rj, 2);
}
{
  /* D16: step 9 runs last, so STATUS.md reflects the repairs of the same run */
  const x = initBacklog('gaps-step9');
  epic(x);
  write(path.join(x.bl, 'subtasks/TSK-001.md'), H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Misfiled',
    created: NOW, updated: NOW }, H.completeBody('Misfiled')));                    // wrong folder AND no status
  write(path.join(idsDir(x.bl), 'TSK-001'), '');
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('D16 --fix repairs a misfiled, status-less task: exit 0', r, 0);
  T.check('D16 STATUS.md lists it under statuses[0] at its repaired path', (statusSection(x.bl, 'todo') || []).includes('TSK-001 tasks/TSK-001.md'),
    J(statusSection(x.bl, 'todo')));
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('D16 the next doctor finds STATUS.md current (no backlog:status_stale)', !doctorCodes(d).some(c => c.startsWith('backlog:status_stale')),
    J(doctorCodes(d)));
}

/* ===================================================================== */
/* B09 / B11 / B13 / B14 / R03 — location and prose (§ 4, § 9, D88)       */
/* ===================================================================== */
{
  /* B09: a folder with .nanojira/ but without config.json is
   * backlog_without_config — from every source, never invalid_backlog_* */
  const x = initBacklog('gaps-noconf');
  epic(x);
  fs.rmSync(cfgPath(x.bl), { force: true });
  mkdir(path.join(x.bl, '.nanojira'));
  const cwd = mkdir(path.join(x.dir, 'elsewhere'));
  const rcDir = mkdir(path.join(x.dir, 'via-rc'));
  fs.writeFileSync(path.join(rcDir, '.njrc'), 'backlog = ../backlog\n');
  for (const [label, args, o] of [
    ['the search', ['list'], { cwd: x.dir }],
    ['--backlog', ['list', '--backlog=' + x.bl], { cwd }],
    ['NJ_BACKLOG', ['list'], { cwd, env: { NJ_BACKLOG: x.bl } }],
    ['.njrc', ['list'], { cwd: rcDir }],
  ]) {
    const r = runJ(args, o);
    T.exit('B09 .nanojira/ without config.json via ' + label + ': exit 1', r, 1);
    T.eq('B09 .nanojira/ without config.json via ' + label + ': backlog_without_config', r.json && r.json.error, 'backlog_without_config');
    T.check('B09 … the error points at nanojira doctor', /nanojira doctor/.test(r.stderr || ''), J(r.stderr));
  }
}
{
  /* B11: the prose prefix is the implementation's `Error: ` (DECISIONS 88)
   * — on every location error, not only the binding and .njrc ones */
  const empty = H.freshDir('gaps-prefix-empty');
  const noConf = H.freshDir('gaps-prefix-noconf');
  mkdir(path.join(noConf, 'backlog', 'tasks'));
  const legacyDir = H.freshDir('gaps-prefix-legacy');
  const lbl = path.join(legacyDir, 'backlog');
  for (const s of ['epics', 'tasks', 'subtasks', 'archive', '.ids']) mkdir(path.join(lbl, s));
  fs.writeFileSync(path.join(lbl, '.nanojira.json'), H.DEFAULT_CONFIG);
  const file = path.join(empty, 'plain.txt');
  fs.writeFileSync(file, 'x\n');
  const badCfg = initBacklog('gaps-prefix-badcfg');
  write(cfgPath(badCfg.bl), JSON.stringify({ schema: 1, statuses: ['todo', 'done', 'doing'] }));
  for (const [label, args, o] of [
    ['no_backlog', ['list'], { cwd: empty }],
    ['backlog_without_config', ['list'], { cwd: noConf }],
    ['legacy_layout', ['list'], { cwd: legacyDir }],
    ['io_error', ['init', '--backlog=' + file + '/sub'], { cwd: empty }],
    ['invalid_config', ['list'], { cwd: badCfg.dir }],
  ]) {
    const r = run(args, o);
    T.exit('B11 ' + label + ': exit 1', r, 1);
    T.check('B11 ' + label + ': the prose starts with "Error: "', /^Error: /.test(r.stderr || ''), J(r.stderr));
    runJ(args, o);
  }
}
{
  /* B13: "Known fields:" of new/set lists schema fields only (DECISIONS 88) */
  const x = initBacklog('gaps-known');
  epic(x);
  for (const args of [['new', '--type=epic', '--title=X', '--bogus=1'], ['set', '--id=EPIC-001', '--bogus=1']]) {
    const r = run(args, { cwd: x.dir });
    T.exit('B13 ' + args[0] + ' --bogus: exit 1', r, 1);
    const line = /^Known fields: (.*)$/m.exec((r.stdout || '') + '\n' + (r.stderr || ''));
    T.check('B13 ' + args[0] + ': prints a "Known fields:" line', !!line, J(r.stderr));
    T.check('B13 ' + args[0] + ': the "Known fields:" line does not list --backlog', !!line && !/backlog/.test(line[1]), J(line && line[0]));
  }
}
{
  /* B14: nj help gains exactly one --backlog line (DECISIONS 88) */
  const d = H.freshDir('gaps-help');
  for (const args of [['help'], ['--help'], ['help', '--json']]) {
    const r = run(args, { cwd: d });
    T.exit('B14 nj ' + args.join(' ') + ': exit 0', r, 0);
    T.eq('B14 nj ' + args.join(' ') + ': exactly one line names --backlog', (r.stdout || '').split('\n').filter(l => l.includes('--backlog')).length, 1);
  }
}
{
  /* R03: the value is literal — no variables; only a LEADING ~/ expands */
  const root = H.freshDir('gaps-literal');
  const rcDir = mkdir(path.join(root, 'rc'));
  const mk = (rel, marker) => {
    const x = initBacklog('gaps-literal-src');
    epic(x, marker);
    const target = path.join(rcDir, rel);
    mkdir(path.dirname(target));
    try { fs.renameSync(x.bl, target); } catch (e) { T.check('fixture: place the backlog at ' + rel, false, e.code); }
    return target;
  };
  const decoyHome = mkdir(path.join(root, 'home'));
  const titlesAt = (value, env) => {
    fs.writeFileSync(path.join(rcDir, '.njrc'), 'backlog = ' + value + '\n');
    const r = runJ(['list'], { cwd: rcDir, env: Object.assign({ HOME: decoyHome }, env || {}) });
    return (r.json && Array.isArray(r.json.entries) ? r.json.entries : []).map(e => e.title);
  };
  mk('$HOME/bl', 'Literal dollar');
  try { fs.renameSync(initBacklog('gaps-literal-decoy').bl, path.join(decoyHome, 'bl')); } catch (e) { T.check('fixture: the decoy backlog', false, e.code); }
  T.eq('R03 "$HOME/bl" is a literal folder name, not the home directory', titlesAt('$HOME/bl'), ['Literal dollar']);
  mk('${NJ_GAPS_X}/bl', 'Literal braces');
  T.eq('R03 "${VAR}/bl" is literal', titlesAt('${NJ_GAPS_X}/bl', { NJ_GAPS_X: 'nope' }), ['Literal braces']);
  mk('a/~/bl', 'Inner tilde');
  T.eq('R03 a "~/" that is not leading is literal', titlesAt('a/~/bl'), ['Inner tilde']);
}

/* ===================================================================== */
/* F01 — nothing outside the v3 closed failure vocabulary (§ 9)           */
/* ===================================================================== */
{
  const CLOSED = new Set(['no_backlog', 'backlog_without_config', 'invalid_config', 'io_error', 'needs_newer_nj', 'invalid_env',
    'invalid_backlog_env', 'unknown_field', 'invalid_backlog_flag', 'invalid_backlog_njrc', 'invalid_njrc', 'legacy_layout',
    'unknown_command', 'missing_argument', 'missing_value', 'invalid_value', 'invalid_target', 'not_found', 'duplicate_id',
    'exists', 'changed_in_parallel', 'id_allocation_failed', 'internal_error', 'ambiguous_target', 'none_ready']);
  const REFUSED = ['unreadable', 'unreadable_dir', 'archived', 'children_open', 'has_children', 'not_done', 'parent_archived', 'misplaced', 'not_archived', 'claimed'];
  const FAULT = ['before-compare', 'after-tmp-write', 'before-rename'];
  const inSet = c => CLOSED.has(c) || (/^refused:/.test(c) && REFUSED.includes(c.slice(8))) || (/^fault:/.test(c) && FAULT.includes(c.slice(6)));
  /* a few v3 paths on top of those above */
  const d = H.freshDir('gaps-vocab');
  runJ(['list', '--backlog=' + path.join(d, 'nope')], { cwd: d });
  runJ(['list'], { cwd: d, env: { NJ_BACKLOG: path.join(d, 'nope') } });
  fs.writeFileSync(path.join(d, '.njrc'), 'Backlog = x\n');
  runJ(['list'], { cwd: d });
  fs.writeFileSync(path.join(d, '.njrc'), 'backlog = nope\n');
  runJ(['list'], { cwd: d });
  runJ(['list', '--backlog'], { cwd: d });
  const bad = FAILURES.filter(([, code]) => !inSet(String(code)));
  T.check('F01 every failure path in this file carries an error code from the v3 closed set (§ 9)',
    FAILURES.length > 0 && bad.length === 0, FAILURES.length + ' paths; outside the set: ' + J(bad.slice(0, 8)));
}

T.finish();
