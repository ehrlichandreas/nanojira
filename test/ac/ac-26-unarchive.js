'use strict';
/* AC-26 — `nj unarchive`, docs/SPECIFICATION.md § 11a (v3.1 proposal § B,
 * promoted: DECISIONS 110/112).
 *
 * Source: docs/proposals/v3.1.md (5d1c83d) with the lead's rulings on it:
 * B-1 unarchive takes the archived subtree; B-2 no --status; B-3 the
 * `archived` key is dropped.
 *
 * AC-26: "For each group (`type`, `hierarchy`, `flat`) and for renamed
 * folders: `archive` followed by `unarchive` of the same element returns
 * every file of the subtree to the path it had before the archive,
 * byte-identical except for `updated`; the `archived` key is gone; `list`
 * shows the elements again without `--all`; `STATUS.md` lists them; a
 * following `doctor` is clean. Under `hierarchy`, unarchiving an epic whose
 * child task was archived separately earlier brings both back (merge), and
 * unarchiving a task under an active epic moves only the task's folder.
 * Changing `group` between `archive` and `unarchive` places the files by the
 * new layout. `refused:not_archived`, `refused:parent_archived`,
 * `refused:unreadable`, `refused:misplaced` and `exists` each exit 1 and
 * change no byte of the backlog. With `NJ_FAULT=before-compare` a parallel
 * edit aborts with `changed_in_parallel`; with `NJ_FAULT=before-rename`
 * nothing has moved and every file is its previous revision."
 *
 * Plus the § 11a rules the criterion summarises: placement by the layout at
 * command time; the D90/D94 merge on the way back; emptied ID-shaped archive
 * folders removed; `status` kept; order and atomicity as `archive` (DECISIONS
 * 91 B16) and a second unarchive completing a crashed one; the § 9
 * read-only amendment; the known flags; the output shape.
 *
 * LAYOUT-NEUTRAL: backlogs come from `nj init`, elements from `nj new`; the
 * one bookkeeping edit (a `layout` block) goes to the config where init put
 * it. V3-4 lands before v3.1, so this file needs no edit for it.
 *
 * Written before v3.1 exists: red everywhere until it is implemented.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
const ARCHIVED_AT = H.LATER_NOW;
const UNARCHIVED_AT = '2026-09-21T21:00:00Z';
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac26-home');
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset = [];
  for (const k of ['NJ_BACKLOG', 'NJ_AUTHOR', 'NJ_FAULT']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }
const at = t => ({ NJ_NOW: t });

/* ---- fixtures ------------------------------------------------------------ */

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function write(p, s) { mkdir(path.dirname(p)); fs.writeFileSync(p, s); return p; }
function read(p) { return H.readOrNull(p); }
function cfgPath(bl) {
  const v3 = path.join(bl, '.nanojira', 'config.json');
  return fs.existsSync(v3) ? v3 : path.join(bl, H.CONFIG_REL);
}
function idsDir(bl) {
  const v3 = path.join(bl, '.nanojira', 'ids');
  return fs.existsSync(v3) ? v3 : path.join(bl, H.IDS_REL);
}
function setLayout(bl, layout) {
  const p = cfgPath(bl);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return T.check('fixture: read the configuration init wrote (' + p + ')', false, e.message);
  }
  cfg.layout = layout;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}
function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* Every element file (by id) → path relative to the backlog; dot-dirs skipped. */
function places(bl) {
  const out = {};
  (function walk(abs, rel) {
    let kids = [];
    try { kids = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const k of kids) {
      if (k.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + k.name : k.name;
      if (k.isDirectory() && !k.isSymbolicLink()) walk(path.join(abs, k.name), r);
      else if (/^(EPIC|TSK|SUB)-\d+\.md$/.test(k.name)) out[k.name.slice(0, -3)] = r;
    }
  })(bl, '');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
/* {id: {path, bytes}} for the given ids. */
function state(bl, ids) {
  const p = places(bl), out = {};
  for (const id of ids) out[id] = { path: p[id] || null, bytes: p[id] ? read(path.join(bl, p[id])) : null };
  return out;
}
/* Every entry below `root` with mode, mtime and bytes; .nj-tmp-* optional. */
function snapshot(root, skipTmp) {
  const out = [];
  (function walk(abs, rel) {
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { return; }
    if (skipTmp && /^\.nj-tmp-/.test(path.basename(abs))) return;
    const head = rel + ' ' + (st.mode & 0o7777).toString(8) + ' ' + st.mtimeMs;
    if (st.isSymbolicLink()) { out.push(head + ' ->' + fs.readlinkSync(abs)); return; }
    if (st.isDirectory()) {
      out.push(head + ' dir');
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    out.push(head + ' ' + H.sha256(fs.readFileSync(abs)));
  })(root, '.');
  return out;
}
function sameTree(desc, before, after) {
  const gone = before.filter(l => !after.includes(l)), added = after.filter(l => !before.includes(l));
  return T.check(desc, !gone.length && !added.length,
    (gone.length ? 'before only: ' + J(gone.slice(0, 5)) + '\n     ' : '') + (added.length ? 'after only: ' + J(added.slice(0, 5)) : ''));
}
const stripUpdated = s => (s === null ? null : s.replace(/^updated: .*\n/m, ''));

const SUBTREE = ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-002'];
const OTHERS = ['EPIC-002', 'TSK-003'];

/*
 * EPIC-001 ── TSK-001 ── SUB-001        (all done: the archive precondition)
 *          └─ TSK-002
 * EPIC-002 ── TSK-003                   (active, todo: must never be touched)
 */
function model(label, layout) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  if (layout) setLayout(bl, layout);
  const n = args => ok(run(['new'].concat(args), { cwd: dir, env: at(NOW) }), 'nj new ' + args.join(' '));
  const body = ['--description=Something.', '--acceptance=- [x] It works'];
  n(['--type=epic', '--title=Epic one', '--description=The first epic.']);
  n(['--type=task', '--parent=EPIC-001', '--title=Task one'].concat(body));
  n(['--type=subtask', '--parent=TSK-001', '--title=Sub one'].concat(body));
  n(['--type=task', '--parent=EPIC-001', '--title=Task two', '--priority=high'].concat(body));
  n(['--type=epic', '--title=Epic two', '--description=The other epic.']);
  n(['--type=task', '--parent=EPIC-002', '--title=Task three'].concat(body));
  for (const id of ['SUB-001', 'TSK-001', 'TSK-002', 'EPIC-001']) {
    ok(run(['set', '--id=' + id, '--status=done'], { cwd: dir, env: at(NOW) }), 'set ' + id + ' done');
  }
  return { dir, bl };
}
function archive(x, id) { return ok(runJ(['archive', '--id=' + id], { cwd: x.dir, env: at(ARCHIVED_AT) }), 'archive ' + id); }
function unarchive(x, args, env) {
  return runJ(['unarchive'].concat(typeof args === 'string' ? ['--id=' + args] : args), { cwd: x.dir, env: Object.assign(at(UNARCHIVED_AT), env || {}) });
}
function listIds(x, all) {
  const r = runJ(['list'].concat(all ? ['--all'] : []), { cwd: x.dir });
  return r.json && Array.isArray(r.json.entries) ? r.json.entries.map(e => e.id) : [];
}

/**
 * The round trip every group must pass: the files come back to `want`
 * (id → path; default: where they were before the archive), byte-identical
 * but for `updated`, which carries the unarchive time; no `archived`.
 */
function returned(tag, x, before, r, want) {
  T.exit(tag + ' unarchive: exit 0', r, 0);
  const after = state(x.bl, SUBTREE);
  for (const id of SUBTREE) {
    const w = want ? want[id] : before[id].path;
    T.eq(tag + ' ' + id + ' is back at ' + w, after[id].path, w);
    T.eq(tag + ' ' + id + ' is byte-identical to before the archive, except updated', stripUpdated(after[id].bytes), stripUpdated(before[id].bytes));
    T.check(tag + ' ' + id + ': updated is refreshed to the unarchive time', new RegExp('^updated: ' + UNARCHIVED_AT + '$', 'm').test(after[id].bytes || ''),
      J((after[id].bytes || '').split('\n').filter(l => l.startsWith('updated')))) ;
    T.check(tag + ' ' + id + ': the archived key is gone (B-3)', !/^archived:/m.test(after[id].bytes || ''), J(after[id].bytes));
    T.check(tag + ' ' + id + ': status is kept (done)', /^status: done$/m.test(after[id].bytes || ''), J(after[id].bytes));
  }
  T.check(tag + ' list shows the subtree again without --all', SUBTREE.every(id => listIds(x).includes(id)), J(listIds(x)));
  /* output shape (§ 11a "Output"): archive's, changed ["unarchived"] */
  const j = r.json || {};
  T.check(tag + ' --json: {ok:true, changed:["unarchived"]}', j.ok === true && J(j.changed) === J(['unarchived']), J(j).slice(0, 300));
  const ids = Array.isArray(j.ids) ? j.ids : [];
  T.eq(tag + ' --json: ids are exactly the moved subtree', ids.slice().sort(), SUBTREE);
  const parentOf = { 'TSK-001': 'EPIC-001', 'TSK-002': 'EPIC-001', 'SUB-001': 'TSK-001' };
  T.check(tag + ' --json: ids are top-down (every parent before its children)',
    Object.entries(parentOf).every(([c, p]) => !ids.includes(c) || (ids.includes(p) && ids.indexOf(p) < ids.indexOf(c)) || !SUBTREE.includes(p)), J(ids));
  T.check(tag + ' --json: siblings by id ascending (DECISIONS 104, 79)', ids.indexOf('TSK-001') < ids.indexOf('TSK-002'), J(ids));
  const entries = Array.isArray(j.entries) ? j.entries : [];
  T.eq(tag + ' --json: entries are the moved elements', entries.map(e => e && e.id).sort(), SUBTREE);
  T.check(tag + ' --json: the entries carry no archived timestamp (their new state)', entries.every(e => e && e.archived === undefined), J(entries).slice(0, 300));
  T.check(tag + ' --json: _problems is an array', Array.isArray(j._problems), J(j._problems));
}
function statusListsThem(tag, x) {
  const s = read(path.join(x.bl, 'STATUS.md')) || '';
  const p = places(x.bl);
  T.check(tag + ' STATUS.md lists every unarchived element at its path', SUBTREE.every(id => s.includes('- [' + id + '](' + p[id] + ')')), J(s));
}
function doctorClean(tag, x) {
  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(tag + ' a following doctor: exit 0', d, 0);
  T.sameSet(tag + ' a following doctor is clean', H.doctorSet(d) || ['<no problems array>'], []);
}

/* ===================================================================== */
/* U1 — the round trip, per group and with renamed folders (AC-26)        */
/* ===================================================================== */

const GROUPS = [
  ['type', null, 'archive'],
  ['type, renamed folders', { group: 'type', folders: { epics: 'e', tasks: 't', subtasks: 's', archive: 'shelf' } }, 'shelf'],
  ['flat', { group: 'flat' }, 'archive'],
  ['flat, renamed archive', { group: 'flat', folders: { archive: 'shelf' } }, 'shelf'],
  ['hierarchy', { group: 'hierarchy' }, 'archive'],
  ['hierarchy, renamed archive', { group: 'hierarchy', folders: { archive: 'shelf' } }, 'shelf'],
];
for (const [name, layout, arch] of GROUPS) {
  const tag = 'U1 [' + name + ']';
  const x = model('ac26-u1', layout);
  const before = state(x.bl, SUBTREE);
  const others = snapshot(path.join(x.bl), true).filter(l => OTHERS.some(id => l.includes(id)));
  archive(x, 'EPIC-001');
  T.check(tag + ' fixture: archive moved the subtree below ' + arch + '/',
    SUBTREE.every(id => (places(x.bl)[id] || '').startsWith(arch + '/')), J(places(x.bl)));
  const r = unarchive(x, 'EPIC-001');
  returned(tag, x, before, r);
  statusListsThem(tag, x);
  doctorClean(tag, x);
  T.eq(tag + ' the other epic and its task are untouched (bytes and mtime)',
    snapshot(path.join(x.bl), true).filter(l => OTHERS.some(id => l.includes(id))), others);
  if (name.startsWith('hierarchy')) {
    T.check(tag + ' the emptied archive folder EPIC-001/ is removed', !fs.existsSync(path.join(x.bl, arch, 'EPIC-001')),
      J(H.lsOrEmpty(path.join(x.bl, arch))));
  }
  const again = unarchive(x, 'EPIC-001');
  T.exit(tag + ' a second unarchive of the now active epic: exit 1', again, 1);
  T.eq(tag + ' … refused:not_archived', again.json && again.json.error, 'refused:not_archived');
}

/* --file works like --id (§ 9) */
{
  const x = model('ac26-file');
  const before = state(x.bl, SUBTREE);
  archive(x, 'EPIC-001');
  const r = unarchive(x, ['--file=' + places(x.bl)['EPIC-001']]);
  returned('U1 [type, --file=<path relative to the backlog>]', x, before, r);
}

/* ===================================================================== */
/* U2 — hierarchy: task alone, epic with a separately archived task,      */
/* and the D90/D94 merge on the way back                                  */
/* ===================================================================== */
{
  const tag = 'U2 [hierarchy, a task under an active epic]';
  const x = model('ac26-u2a', { group: 'hierarchy' });
  run(['set', '--id=EPIC-001', '--status=doing'], { cwd: x.dir, env: at(NOW) });     // the epic stays active
  const epicBefore = snapshot(path.join(x.bl, 'EPIC-001', 'EPIC-001.md'));
  const t2Before = snapshot(path.join(x.bl, 'EPIC-001', 'TSK-002'));
  const before = state(x.bl, ['TSK-001', 'SUB-001']);
  archive(x, 'TSK-001');
  write(path.join(x.bl, 'archive', 'EPIC-001', 'TSK-001', 'notes.txt'), 'kept with the folder\n');
  const r = unarchive(x, 'TSK-001');
  T.exit(tag + ': exit 0', r, 0);
  const p = places(x.bl);
  T.eq(tag + ' the task and its subtask are back at their paths', [p['TSK-001'], p['SUB-001']], [before['TSK-001'].path, before['SUB-001'].path]);
  T.eq(tag + ' the task folder moved as a whole: its other content came along',
    read(path.join(x.bl, 'EPIC-001', 'TSK-001', 'notes.txt')), 'kept with the folder\n');
  T.eq(tag + ' the epic file is untouched (bytes and mtime)', snapshot(path.join(x.bl, 'EPIC-001', 'EPIC-001.md')), epicBefore);
  T.eq(tag + ' the sibling task folder is untouched', snapshot(path.join(x.bl, 'EPIC-001', 'TSK-002')), t2Before);
  T.check(tag + ' the emptied ID-shaped archive folder EPIC-001/ is removed', !fs.existsSync(path.join(x.bl, 'archive', 'EPIC-001')),
    J(H.lsOrEmpty(path.join(x.bl, 'archive'))));
  T.eq(tag + ' --json: ids are the task and its subtask', (r.json && r.json.ids || []).slice().sort(), ['SUB-001', 'TSK-001']);
}
{
  const tag = 'U2 [hierarchy, an epic whose task was archived separately earlier]';
  const x = model('ac26-u2b', { group: 'hierarchy' });
  const before = state(x.bl, SUBTREE);
  archive(x, 'TSK-001');
  archive(x, 'EPIC-001');                                   // merges into archive/EPIC-001/ (§ 11, D94)
  T.check(tag + ' fixture: the whole subtree is below archive/EPIC-001/',
    SUBTREE.every(id => (places(x.bl)[id] || '').startsWith('archive/EPIC-001/')), J(places(x.bl)));
  const r = unarchive(x, 'EPIC-001');
  returned(tag, x, before, r);
  doctorClean(tag, x);
}
{
  const tag = 'U2 [hierarchy, the target task folder already exists: merge (D90, D94)]';
  const x = model('ac26-u2c', { group: 'hierarchy' });
  run(['set', '--id=EPIC-001', '--status=doing'], { cwd: x.dir, env: at(NOW) });
  const before = state(x.bl, ['TSK-001', 'SUB-001']);
  archive(x, 'TSK-001');
  write(path.join(x.bl, 'EPIC-001', 'TSK-001', 'keep.txt'), 'already here\n');       // an existing, non-element folder content
  const r = unarchive(x, 'TSK-001');
  T.exit(tag + ': exit 0', r, 0);
  const p = places(x.bl);
  T.eq(tag + ' both files arrived in the existing folder', [p['TSK-001'], p['SUB-001']], [before['TSK-001'].path, before['SUB-001'].path]);
  T.eq(tag + ' what the folder held survives (merged into, never replaced)', read(path.join(x.bl, 'EPIC-001', 'TSK-001', 'keep.txt')), 'already here\n');
  T.check(tag + ' the emptied archive folders are removed', !fs.existsSync(path.join(x.bl, 'archive', 'EPIC-001')),
    J(H.lsOrEmpty(path.join(x.bl, 'archive'))));
}

/* ===================================================================== */
/* U3 — a layout change between archive and unarchive: placement by the   */
/* layout at command time (§ 11a)                                          */
/* ===================================================================== */
const HIER = { 'EPIC-001': 'EPIC-001/EPIC-001.md', 'TSK-001': 'EPIC-001/TSK-001/TSK-001.md',
  'TSK-002': 'EPIC-001/TSK-002/TSK-002.md', 'SUB-001': 'EPIC-001/TSK-001/SUB-001.md' };
for (const [name, from, to, want] of [
  ['hierarchy → type', { group: 'hierarchy' }, { group: 'type' },
    { 'EPIC-001': 'epics/EPIC-001.md', 'TSK-001': 'tasks/TSK-001.md', 'TSK-002': 'tasks/TSK-002.md', 'SUB-001': 'subtasks/SUB-001.md' }],
  ['type → flat', null, { group: 'flat' },
    { 'EPIC-001': 'EPIC-001.md', 'TSK-001': 'TSK-001.md', 'TSK-002': 'TSK-002.md', 'SUB-001': 'SUB-001.md' }],
  ['type → renamed type folders', null, { group: 'type', folders: { tasks: 'work', subtasks: 'bits' } },
    { 'EPIC-001': 'epics/EPIC-001.md', 'TSK-001': 'work/TSK-001.md', 'TSK-002': 'work/TSK-002.md', 'SUB-001': 'bits/SUB-001.md' }],
  /* DECISIONS 104 (75): the current layout wins — a flat archive is gathered
   * by the parent chain and placed in hierarchy shape */
  ['type → hierarchy', null, { group: 'hierarchy' }, HIER],
  ['flat → hierarchy', { group: 'flat' }, { group: 'hierarchy' }, HIER],
]) {
  const tag = 'U3 [' + name + ']';
  const x = model('ac26-u3', from);
  const before = state(x.bl, SUBTREE);
  archive(x, 'EPIC-001');
  setLayout(x.bl, to);
  const r = unarchive(x, 'EPIC-001');
  returned(tag, x, before, r, want);
  if (name.startsWith('hierarchy')) {
    T.check(tag + ' the emptied ID-shaped archive folders are removed', !fs.existsSync(path.join(x.bl, 'archive', 'EPIC-001')),
      J(H.lsOrEmpty(path.join(x.bl, 'archive'))));
  }
}
{
  /* DECISIONS 104 (75): under hierarchy, a member lying elsewhere IN the
   * archive is gathered by its chain, not refused */
  const tag = 'U3 [hierarchy, a subtree member moved elsewhere inside the archive]';
  const x = model('ac26-u3-gather', { group: 'hierarchy' });
  const before = state(x.bl, SUBTREE);
  archive(x, 'EPIC-001');
  try { fs.renameSync(path.join(x.bl, 'archive', 'EPIC-001', 'TSK-002'), path.join(x.bl, 'archive', 'TSK-002')); }
  catch (e) { T.check('fixture: move archive/EPIC-001/TSK-002 to archive/TSK-002', false, e.code + ' ' + J(places(x.bl))); }
  returned(tag, x, before, unarchive(x, 'EPIC-001'));
  T.check(tag + ' the emptied archive/TSK-002/ is removed', !fs.existsSync(path.join(x.bl, 'archive', 'TSK-002')),
    J(H.lsOrEmpty(path.join(x.bl, 'archive'))));
}

/* ===================================================================== */
/* U4 — every refusal exits 1 and changes no byte (AC-26)                 */
/* ===================================================================== */

function refused(desc, x, args, code, extra) {
  const before = snapshot(x.dir);
  const r = run(['unarchive'].concat(args), { cwd: x.dir, env: at(UNARCHIVED_AT) });
  T.exit(desc + ': exit 1', r, 1);
  T.check(desc + ': the prose starts with "Error: "', /^Error: /.test(r.stderr || ''), J(r.stderr));
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test(r.stderr || ''), J(r.stderr));
  if (extra) extra(r);
  const rj = runJ(['unarchive'].concat(args), { cwd: x.dir, env: at(UNARCHIVED_AT) });
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: {ok:false}', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 200));
  T.eq(desc + ' --json: error is ' + code, rj.json && rj.json.error, code);
  sameTree(desc + ': no byte of the backlog changed (the whole tree identical)', before, snapshot(x.dir));
}
const pointsAtFix = desc => r => T.check(desc + ': points at nj doctor --fix', /doctor --fix/.test(r.stderr || ''), J(r.stderr));

for (const [name, layout] of [['type', null], ['hierarchy', { group: 'hierarchy' }]]) {
  {
    const x = model('ac26-na', layout);
    refused('U4 [' + name + '] an active element: refused:not_archived', x, ['--id=EPIC-002'], 'refused:not_archived');
  }
  {
    const x = model('ac26-pa', layout);
    archive(x, 'EPIC-001');
    refused('U4 [' + name + '] a task whose epic is archived: refused:parent_archived', x, ['--id=TSK-001'], 'refused:parent_archived');
  }
  {
    const x = model('ac26-ur', layout);
    archive(x, 'EPIC-001');
    const stub = name === 'type' ? 'tasks/TSK-009.md' : 'EPIC-002/TSK-009/TSK-009.md';
    mkdir(path.dirname(path.join(x.bl, stub)));
    try { fs.symlinkSync(path.join(x.dir, 'no-such-target'), path.join(x.bl, stub)); }        // § 7 file:unreadable
    catch (e) { T.check('fixture: the unreadable stub', false, e.code); }
    write(path.join(idsDir(x.bl), 'TSK-009'), '');
    refused('U4 [' + name + '] while an unreadable stub exists: refused:unreadable', x, ['--id=EPIC-001'], 'refused:unreadable');
    /* "evaluated before the target is resolved" (§ 11a): the stub wins over
     * what the target would have produced */
    refused('U4 [' + name + '] a stub exists and the target is active: refused:unreadable first', x, ['--id=EPIC-002'], 'refused:unreadable');
    refused('U4 [' + name + '] a stub exists and the target is unknown: refused:unreadable first', x, ['--id=EPIC-404'], 'refused:unreadable');
  }
}
{
  /* exists: a folder where a file goes (type, flat), a file where a folder goes (hierarchy) */
  const x = model('ac26-ex-type');
  archive(x, 'EPIC-001');
  mkdir(path.join(x.bl, 'tasks', 'TSK-002.md'));
  refused('U4 [type] a folder at a target file path: exists', x, ['--id=EPIC-001'], 'exists');
}
{
  const x = model('ac26-ex-flat', { group: 'flat' });
  archive(x, 'EPIC-001');
  mkdir(path.join(x.bl, 'SUB-001.md'));
  refused('U4 [flat] a folder at a target file path: exists', x, ['--id=EPIC-001'], 'exists');
}
{
  const x = model('ac26-ex-hier', { group: 'hierarchy' });
  run(['set', '--id=EPIC-001', '--status=doing'], { cwd: x.dir, env: at(NOW) });
  archive(x, 'TSK-001');
  write(path.join(x.bl, 'EPIC-001', 'TSK-001'), 'a file where the task folder must go\n');
  refused('U4 [hierarchy] a file where the task folder must go: exists', x, ['--id=TSK-001'], 'exists');
}
{
  const x = model('ac26-ex-merge', { group: 'hierarchy' });
  run(['set', '--id=EPIC-001', '--status=doing'], { cwd: x.dir, env: at(NOW) });
  archive(x, 'TSK-001');
  mkdir(path.join(x.bl, 'EPIC-001', 'TSK-001', 'SUB-001.md'));
  refused('U4 [hierarchy] inside the merge, a folder at a target file path: exists', x, ['--id=TSK-001'], 'exists');
}
{
  /* DECISIONS 104 (75), amended (82): a subtree member already lying outside
   * the archive (a manual move produced archive:split) is NOT a refusal in
   * any group — § 11a leaves it untouched, and unarchiving the parent heals
   * the split; under hierarchy the parent's folder merges into the existing
   * active one (D90/94). */
  const tag = 'U2 [hierarchy, a subtree member already moved outside the archive heals the split (D104 82)]';
  const x = model('ac26-split-heal', { group: 'hierarchy' });
  const REST = ['EPIC-001', 'TSK-001', 'SUB-001'];
  const before = state(x.bl, REST);
  archive(x, 'EPIC-001');
  try { mkdir(path.join(x.bl, 'EPIC-001')); fs.renameSync(path.join(x.bl, 'archive', 'EPIC-001', 'TSK-002'), path.join(x.bl, 'EPIC-001', 'TSK-002')); }
  catch (e) { T.check('fixture: move archive/EPIC-001/TSK-002 back out of the archive', false, e.code + ' ' + J(places(x.bl))); }
  const t2Before = snapshot(path.join(x.bl, 'EPIC-001', 'TSK-002'));
  const split = runJ(['doctor'], { cwd: x.dir });
  T.check(tag + ' fixture: doctor sees the split before unarchive', (H.doctorSet(split) || []).includes('archive:split:error'), J(split.json && split.json.problems));
  const r = unarchive(x, 'EPIC-001');
  T.exit(tag + ': exit 0', r, 0);
  const after = state(x.bl, REST);
  for (const id of REST) {
    T.eq(tag + ' ' + id + ' is back at ' + before[id].path, after[id].path, before[id].path);
    T.eq(tag + ' ' + id + ' is byte-identical to before the archive, except updated', stripUpdated(after[id].bytes), stripUpdated(before[id].bytes));
    T.check(tag + ' ' + id + ': the archived key is gone', !/^archived:/m.test(after[id].bytes || ''), J(after[id].bytes));
  }
  T.eq(tag + ' TSK-002 is untouched (bytes and mtime) — only archived members move', snapshot(path.join(x.bl, 'EPIC-001', 'TSK-002')), t2Before);
  const j = r.json || {};
  T.check(tag + ' --json: changed is ["unarchived"]', J(j.changed) === J(['unarchived']), J(j).slice(0, 300));
  T.eq(tag + ' --json: ids are exactly the three members that were still archived', (j.ids || []).slice().sort(), REST.slice().sort());
  T.check(tag + ' --json: TSK-002 is not among the moved ids', !(j.ids || []).includes('TSK-002'), J(j.ids));
  doctorClean(tag, x);
}
{
  const x = model('ac26-mis-in', { group: 'hierarchy' });
  archive(x, 'EPIC-001');
  write(path.join(x.bl, 'archive', 'EPIC-001', 'EPIC-009.md'), H.element({ id: 'EPIC-009', type: 'epic', title: 'Foreign',
    status: 'done', created: NOW, updated: NOW, archived: NOW }, '# Foreign\n\n## Description\nD.\n'));
  write(path.join(idsDir(x.bl), 'EPIC-009'), '');
  refused('U4 [hierarchy] a foreign element file inside the archived folder: refused:misplaced', x, ['--id=EPIC-001'], 'refused:misplaced',
    pointsAtFix('U4 [hierarchy] foreign file inside'));
}
{
  const x = model('ac26-mis-chain', { group: 'hierarchy' });
  write(path.join(x.bl, 'archive', 'EPIC-777', 'TSK-005', 'TSK-005.md'), H.element({ id: 'TSK-005', type: 'task', parent: 'EPIC-777',
    title: 'Orphan in the archive', status: 'done', created: NOW, updated: NOW, archived: NOW }, H.completeBody('Orphan in the archive')));
  write(path.join(idsDir(x.bl), 'TSK-005'), '');
  refused('U4 [hierarchy] an unresolvable parent chain: refused:misplaced', x, ['--id=TSK-005'], 'refused:misplaced',
    pointsAtFix('U4 [hierarchy] unresolvable chain'));
}

/* DECISIONS 104 (80): under type/flat placement does not depend on the
 * chain — an archived task with a dangling parent comes back. */
for (const [name, layout, archRel, want] of [
  ['type', null, 'archive/TSK-005.md', 'tasks/TSK-005.md'],
  ['flat', { group: 'flat' }, 'archive/TSK-005.md', 'TSK-005.md'],
]) {
  const tag = 'U4 [' + name + '] an unresolvable parent chain is no refusal outside hierarchy';
  const x = model('ac26-chain-ok', layout);
  write(path.join(x.bl, archRel), H.element({ id: 'TSK-005', type: 'task', parent: 'EPIC-777', title: 'Orphan in the archive',
    status: 'done', created: NOW, updated: NOW, archived: NOW }, H.completeBody('Orphan in the archive')));
  write(path.join(idsDir(x.bl), 'TSK-005'), '');
  const r = unarchive(x, 'TSK-005');
  T.exit(tag + ': exit 0', r, 0);
  T.eq(tag + ': placed at its ' + name + ' place', places(x.bl)['TSK-005'], want);
  T.check(tag + ': the archived key is gone', !/^archived:/m.test(read(path.join(x.bl, want)) || ''), J(read(path.join(x.bl, want))));
}

/* DECISIONS 104 (81): unreadable → not_archived → parent_archived →
 * misplaced → exists. (unreadable-first is asserted above.) */
{
  const x = model('ac26-p-na-pa');
  archive(x, 'EPIC-001');
  try { fs.renameSync(path.join(x.bl, 'archive', 'TSK-002.md'), path.join(x.bl, 'tasks', 'TSK-002.md')); }
  catch (e) { T.check('fixture: bring TSK-002 back by hand', false, e.code + ' ' + J(places(x.bl))); }
  refused('U4 precedence: an active element under an archived parent is refused:not_archived, not parent_archived', x,
    ['--id=TSK-002'], 'refused:not_archived');
}
{
  const x = model('ac26-p-pa-ex');
  archive(x, 'EPIC-001');
  mkdir(path.join(x.bl, 'tasks', 'TSK-001.md'));
  refused('U4 precedence: parent_archived before exists', x, ['--id=TSK-001'], 'refused:parent_archived');
}
{
  const x = model('ac26-p-pa-mis', { group: 'hierarchy' });
  archive(x, 'EPIC-001');
  write(path.join(x.bl, 'archive', 'EPIC-001', 'TSK-001', 'EPIC-009.md'), H.element({ id: 'EPIC-009', type: 'epic', title: 'Foreign',
    status: 'done', created: NOW, updated: NOW, archived: NOW }, '# Foreign\n\n## Description\nD.\n'));
  write(path.join(idsDir(x.bl), 'EPIC-009'), '');
  refused('U4 precedence (hierarchy): parent_archived before misplaced', x, ['--id=TSK-001'], 'refused:parent_archived');
}
{
  const x = model('ac26-p-mis-ex', { group: 'hierarchy' });
  run(['set', '--id=EPIC-001', '--status=doing'], { cwd: x.dir, env: at(NOW) });
  archive(x, 'TSK-001');
  write(path.join(x.bl, 'archive', 'EPIC-001', 'TSK-001', 'EPIC-009.md'), H.element({ id: 'EPIC-009', type: 'epic', title: 'Foreign',
    status: 'done', created: NOW, updated: NOW, archived: NOW }, '# Foreign\n\n## Description\nD.\n'));
  write(path.join(idsDir(x.bl), 'EPIC-009'), '');
  write(path.join(x.bl, 'EPIC-001', 'TSK-001'), 'a file where the task folder must go\n');
  refused('U4 precedence (hierarchy): misplaced before exists', x, ['--id=TSK-001'], 'refused:misplaced');
}

/* ===================================================================== */
/* U5 — interface: flags, targets, the § 9 read-only amendment            */
/* ===================================================================== */
{
  const x = model('ac26-if');
  archive(x, 'EPIC-001');
  const known = run(['unarchive', '--id=EPIC-001', '--bogus=1'], { cwd: x.dir });
  T.exit('U5 unarchive --bogus: exit 1', known, 1);
  const line = /^Known flags: (.*)$/m.exec((known.stdout || '') + '\n' + (known.stderr || ''));
  T.eq('U5 "Known flags:" of unarchive is exactly --id, --file, --json, --backlog',
    line ? line[1].split(/,\s*/).map(s => s.trim()).sort() : null, ['--backlog', '--file', '--id', '--json']);
  for (const [flag, why] of [['--force', 'no --force (§ 12)'], ['--status=todo', 'no --status (B-2)']]) {
    const before = snapshot(x.dir);
    const r = runJ(['unarchive', '--id=EPIC-001', flag], { cwd: x.dir });
    T.exit('U5 unarchive ' + flag + ': exit 1 — ' + why, r, 1);
    T.eq('U5 unarchive ' + flag + ': unknown_field', r.json && r.json.error, 'unknown_field');
    sameTree('U5 unarchive ' + flag + ': nothing changed', before, snapshot(x.dir));
  }
  const both = runJ(['unarchive', '--id=EPIC-001', '--file=' + places(x.bl)['EPIC-001']], { cwd: x.dir });
  T.eq('U5 --id and --file together: invalid_target (§ 9)', both.json && both.json.error, 'invalid_target');
  const none = runJ(['unarchive', '--id=EPIC-404'], { cwd: x.dir });
  T.eq('U5 an unknown id: not_found (§ 9)', none.json && none.json.error, 'not_found');
  const bare = runJ(['unarchive'], { cwd: x.dir });
  T.eq('U5 neither --id nor --file: missing_argument (§ 9)', bare.json && bare.json.error, 'missing_argument');

  /* § 9 amendment: set, note, rm and archive still refuse an archived
   * element; unarchive is the one write that accepts it. */
  for (const args of [['set', '--id=TSK-001', '--status=todo'], ['note', '--id=TSK-001', 'x'], ['rm', '--id=SUB-001'], ['archive', '--id=EPIC-001']]) {
    const before = snapshot(x.dir);
    const r = runJ(args, { cwd: x.dir });
    T.eq('U5 ' + args[0] + ' on an archived element: refused:archived', r.json && r.json.error, 'refused:archived');
    sameTree('U5 ' + args[0] + ' on an archived element: nothing changed', before, snapshot(x.dir));
  }
  const back = unarchive(x, 'EPIC-001');
  T.exit('U5 unarchive accepts the archived element', back, 0);
}

/* ===================================================================== */
/* U6 — order and atomicity (§ 11a, DECISIONS 91 B16; § 12 hooks)          */
/* ===================================================================== */
for (const [name, layout] of [['type', null], ['hierarchy', { group: 'hierarchy' }]]) {
  for (const hook of ['before-rename', 'after-tmp-write']) {
    const tag = 'U6 [' + name + '] NJ_FAULT=' + hook;
    const x = model('ac26-fault', layout);
    archive(x, 'EPIC-001');
    const before = state(x.bl, SUBTREE);
    const r = unarchive(x, 'EPIC-001', { NJ_FAULT: hook });
    T.exit(tag + ': exit 1', r, 1);
    T.eq(tag + ': fault:' + hook, r.json && r.json.error, 'fault:' + hook);
    T.eq(tag + ': nothing has moved and every file is its previous revision', state(x.bl, SUBTREE), before);
  }
}
{
  /* A crash between the in-place rewrites and the moves leaves files below
   * the archive folder without `archived:` — archived by location, no
   * finding — and a second unarchive completes it (§ 11a). */
  const tag = 'U6 [type] a crashed unarchive';
  const x = model('ac26-crash');
  const before = state(x.bl, SUBTREE);
  archive(x, 'EPIC-001');
  for (const id of SUBTREE) {
    const f = path.join(x.bl, places(x.bl)[id] || '<none>');
    const b = read(f);
    if (b !== null) fs.writeFileSync(f, b.replace(/^archived: .*\n/m, ''));
  }
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check(tag + ': the half-done state is no finding for the subtree (archived by location)',
    !(d.json && Array.isArray(d.json.problems) ? d.json.problems : []).some(p => SUBTREE.includes(p.element)), J(d.json && d.json.problems).slice(0, 300));
  T.check(tag + ': … and the files are still archived (not listed without --all)', !SUBTREE.some(id => listIds(x).includes(id)), J(listIds(x)));
  const r = unarchive(x, 'EPIC-001');
  returned(tag + ', completed by a second unarchive', x, before, r);
}

/* NJ_FAULT=before-compare: a parallel edit aborts with changed_in_parallel. */
function startNj(args, cwd, env) {
  const e = Object.assign({}, process.env, { NJ_NOW: UNARCHIVED_AT, HOME }, env);
  for (const k of ['NJ_BACKLOG', 'NJ_AUTHOR']) delete e[k];
  const inv = H.njCommand(H.NJ, args);
  const child = spawn(inv.cmd, inv.args, { cwd, env: e });
  let out = '', err = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { err += c; });
  return new Promise(resolve => {
    child.on('error', er => resolve({ status: null, stdout: '', stderr: String(er.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}
(async () => {
  for (const [name, layout, arch] of [['type', null, 'archive'], ['hierarchy', { group: 'hierarchy' }, 'archive']]) {
    const tag = 'U6 [' + name + '] NJ_FAULT=before-compare with a parallel edit';
    const x = model('ac26-cmp', layout);
    archive(x, 'EPIC-001');
    const done = startNj(['unarchive', '--id=EPIC-001', '--json'], x.dir, { NJ_FAULT: 'before-compare' });
    await new Promise(r => setTimeout(r, 1000));
    /* play the parallel writer on every file of the subtree — whichever nj
     * compares first has changed (AMBIGUITIES 78) */
    for (const id of SUBTREE) {
      const f = path.join(x.bl, places(x.bl)[id] || '<none>');
      const b = read(f);
      if (b !== null) fs.writeFileSync(f, b + '\nParallel edit.\n');
    }
    write(path.join(x.bl, '.nj-fault-go'), '');
    const r = await done;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.eq(tag + ': exit 1', r.status, 1);
    T.eq(tag + ': changed_in_parallel', json && json.error, 'changed_in_parallel');
    T.check(tag + ': nothing moved out of the archive', SUBTREE.every(id => (places(x.bl)[id] || '').startsWith(arch + '/')), J(places(x.bl)));
    T.check(tag + ': the parallel edit is never overwritten', SUBTREE.every(id => (read(path.join(x.bl, places(x.bl)[id] || '<none>')) || '').includes('Parallel edit.')),
      J(places(x.bl)));
  }
  /* DECISIONS 104 (78): before-compare fires per file, top-down. The
   * parallel writer changes only TSK-002 — after EPIC-001 and TSK-001 in any
   * top-down order. On abort the earlier files carry their in-place write,
   * nothing has moved, and a second unarchive completes. The go-marker is
   * kept present while nj runs, whether or not nj consumes it. */
  {
    const tag = 'U6 [type] NJ_FAULT=before-compare, a parallel edit of a later file';
    const x = model('ac26-cmp-late');
    const before = state(x.bl, SUBTREE);
    archive(x, 'EPIC-001');
    let running = true;
    const done = startNj(['unarchive', '--id=EPIC-001', '--json'], x.dir, { NJ_FAULT: 'before-compare' }).then(r => { running = false; return r; });
    await new Promise(r => setTimeout(r, 1000));
    const f2 = path.join(x.bl, places(x.bl)['TSK-002'] || '<none>');
    const b2 = read(f2);
    if (b2 !== null) fs.writeFileSync(f2, b2 + '\nParallel edit.\n');
    const go = path.join(x.bl, '.nj-fault-go');
    while (running) {
      if (!fs.existsSync(go)) write(go, '');
      await new Promise(r => setTimeout(r, 150));
    }
    const r = await done;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    try { fs.rmSync(go, { force: true }); } catch (e) { /* gone */ }
    T.eq(tag + ': exit 1', r.status, 1);
    T.eq(tag + ': changed_in_parallel', json && json.error, 'changed_in_parallel');
    T.check(tag + ': nothing has moved', SUBTREE.every(id => (places(x.bl)[id] || '').startsWith('archive/')), J(places(x.bl)));
    for (const id of ['EPIC-001', 'TSK-001']) {
      T.check(tag + ': the earlier file ' + id + ' carries its in-place write (archived: gone)',
        !/^archived:/m.test(read(path.join(x.bl, places(x.bl)[id] || '<none>')) || 'archived: ?'), J(read(path.join(x.bl, places(x.bl)[id] || '<none>'))));
    }
    T.check(tag + ': TSK-002 keeps the parallel edit and its archived key', /Parallel edit\./.test(read(f2) || '') && /^archived:/m.test(read(f2) || ''),
      J(read(f2)));
    const again = unarchive(x, 'EPIC-001');
    T.exit(tag + ': a second unarchive completes it', again, 0);
    const p = places(x.bl);
    T.eq(tag + ': … every file back at its place', SUBTREE.map(id => p[id]), SUBTREE.map(id => before[id].path));
    T.check(tag + ': … and the parallel edit survived', /Parallel edit\./.test(read(path.join(x.bl, p['TSK-002'] || '<none>')) || ''),
      J(read(path.join(x.bl, p['TSK-002'] || '<none>'))));
  }
  T.finish();
})();
