'use strict';
/* AC-17 — Configuration.
 *
 * § 15 AC-17: "Configuration. An invalid `.nanojira/config.json` (bad statuses, `done`
 * not last) makes commands fail with exit 1 pointing at `doctor`, and `doctor`
 * reports it with exit 2."
 *
 * § 5: `statuses` is non-empty, at least two entries, unique, each matching
 * `[a-z_]+`; the last entry must be `done`; the first entry is the initial
 * state. An invalid configuration makes every command except `nj doctor` fail
 * with exit 1 and a pointer to `nj doctor`; `doctor` reports the defect (exit 2).
 * The code is `config:invalid`, a backlog-level finding (§ 7).
 *
 * Spec v3 extends AC-17 (V3-2): "… an unknown `layout` key, an invalid or
 * duplicate folder name … A configuration without `layout` is valid and
 * behaves exactly like the defaults." § 5 layout rules: `group` ∈ type |
 * hierarchy | flat; `folders` holds the four keys, each matching
 * `[A-Za-z0-9][A-Za-z0-9_-]*`, pairwise distinct, none of the form
 * `EPIC-<n>`, `TSK-<n>`, `SUB-<n>`, validated under every group;
 * `statusFile` is `true` or `false` (validated from V3-2, DECISIONS 92 Q1);
 * an unknown key inside `layout` or `layout.folders` is invalid; `backlog`
 * is no folder name, and names compare case-insensitively (DECISIONS 91
 * B13, B14). The layout block is written into the
 * configuration at its current place (`H.mkBacklog`'s config); the second
 * half of this file is additive and leaves the v2 half untouched.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

function config(statuses) {
  return J({
    schema: 1,
    statuses: statuses,
    sections: {
      description: ['Description'],
      acceptance: ['Acceptance Criteria'],
    },
  }, null, 2) + '\n';
}

/* Content hashes, so "nothing written" means bytes and not mtimes. The search
 * index (§ 13) is a local cache any read may create, so it is excluded. */
function snapshot(backlogDir) {
  const map = {};
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
      if (r === H.INDEX_REL) continue;
      map[r] = shaOf(path.join(dir, e.name));
    }
  })(backlogDir, '');
  return map;
}

function shaOf(p) {
  try { return H.sha256(fs.readFileSync(p)); } catch (e) { return '<unreadable>'; }
}

function changedFiles(before, after) {
  const keys = Object.keys(Object.assign({}, before, after)).sort();
  return keys.filter(k => before[k] !== after[k]);
}

/* D100 + Verifier T3: under config:invalid nj renders no overview. The
 * harness writes none into such a fixture (H.statusFor is null), so here an
 * appearing STATUS.md can only be nj creating one. */
function noOverviewCreated(desc, d) {
  const p = path.join(d, 'backlog', 'STATUS.md');
  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.exit(desc + ': doctor --fix exits 2', fix, 2);
  T.check(desc + ': no STATUS.md is created under config:invalid (D100)', !fs.existsSync(p),
    JSON.stringify(H.readOrNull(p)));
}

const INVALID = [
  { label: 'done is not the last status', statuses: ['todo', 'done', 'doing'] },
  { label: 'a status does not match [a-z_]+', statuses: ['todo', 'In Progress', 'done'] },
  { label: 'fewer than two statuses', statuses: ['todo'] },
  { label: 'no statuses at all', statuses: [] },
  { label: 'duplicate statuses', statuses: ['todo', 'todo', 'done'] },
];

/* Every command that uses a backlog. `nj init` is not among them: it *creates*
 * the configuration and refuses when backlog/ already exists, so § 5's rule
 * ("every command except nj doctor") does not reach it. `config:invalid` is
 * checked before any command-specific precondition (an acting name, an
 * archived target, …), so each command below just needs an argument list
 * that *would* be sensible on a healthy backlog — none of those
 * preconditions is ever reached. `claim`/`release`/`check` get the flags
 * that would otherwise be their own first refusal (`--as`, a `--text` that
 * matches the `## Acceptance Criteria` checkbox `taskFixture` writes). */
const COMMANDS = [
  ['bare nj', []],
  ['list', ['list']],
  ['find', ['find', 'Backend']],
  ['show', ['show', '--id=TSK-001']],
  ['tree', ['tree']],
  ['new', ['new', '--type=task', '--parent=EPIC-001', '--title=X']],
  ['set', ['set', '--id=TSK-001', '--status=doing']],
  ['note', ['note', '--id=TSK-001', 'text']],
  ['check', ['check', '--id=TSK-001', '--text=It works', '--on']],
  ['rm', ['rm', '--id=TSK-001']],
  ['archive', ['archive', '--id=EPIC-001']],
  ['unarchive', ['unarchive', '--id=EPIC-001']],
  ['claim', ['claim', '--id=TSK-001', '--as=agent']],
  ['release', ['release', '--id=TSK-001', '--as=agent']],
];

function taskFixture(id, title, status, parent) {
  return H.element({
    id: id, type: 'task', parent: parent || 'EPIC-001', title: title, status: status,
    created: NOW, updated: NOW,
  }, '# ' + title + '\n\n## Description\nSomething.\n\n## Acceptance Criteria\n- [ ] It works\n');
}

for (const bad of INVALID) {
  const d = H.mkBacklog({
    label: 'ac17-' + bad.label.replace(/[^a-z0-9]+/gi, '-'),
    config: config(bad.statuses),
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      'tasks/TSK-001.md': taskFixture('TSK-001', 'Backend API Endpoints', 'todo'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const before = snapshot(path.join(d, 'backlog'));

  for (const [name, args] of COMMANDS) {
    const r = H.runNj(args, { cwd: d });
    T.exit(name + ' fails with exit 1 on an invalid config (' + bad.label + ')', r, 1);
    T.contains(name + ' points at nj doctor (' + bad.label + ')', out(r), 'doctor');
  }

  const after = snapshot(path.join(d, 'backlog'));
  const changed = changedFiles(before, after);
  T.check('a failing command writes nothing (' + bad.label + ')',
    changed.length === 0, 'changed: ' + changed.join(', '));
  T.check('no element was created (' + bad.label + ')',
    H.listFiles(d, 'tasks').length === 1, J(H.listFiles(d, 'tasks')));

  const rh = H.runNj(['doctor'], { cwd: d });
  T.exit('doctor exits 2 on an invalid config (' + bad.label + ')', rh, 2);

  const rj = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor --json exits 2 on an invalid config (' + bad.label + ')', rj, 2);
  const j = rj.json || {};
  const problems = Array.isArray(j.problems) ? j.problems : [];
  const invalid = problems.filter(p => p.code === 'config:invalid');
  T.check('doctor reports config:invalid (' + bad.label + ')', invalid.length >= 1,
    /* CODE-set equality: every one of these fixtures breaks § 5 and nothing
     * else, so `config:invalid` must be the ONLY code reported. The count is
     * left open on purpose — § 5 lists several rules and does not say whether
     * breaking two of them yields one finding or two ('no statuses at all'
     * violates more than one), so cardinality is unpinned while the code set
     * is not. This is what closes the blindness: containment could not see a
     * spurious extra finding of a different code. */
    (rj.parseError || J(problems)).slice(0, 400));
  T.sameSet('config:invalid is the only code reported (' + bad.label + ')',
    [...new Set(H.doctorSet(rj) || ['<no problems array>'])], ['config:invalid:error']);
  T.check('config:invalid is an error finding (' + bad.label + ')',
    invalid.length >= 1 && invalid[0].severity === 'error', J(invalid[0] || null));
  T.check('config:invalid is backlog-level: it carries no element (§ 9)',
    invalid.length >= 1 && !invalid[0].element, J(invalid[0] || null));
  T.check('doctor ok is false (' + bad.label + ')', j.ok === false,
    J(j).slice(0, 300));
  noOverviewCreated('config ' + bad.label, d);
}

/* ---- v3: the layout block (§ 5) ------------------------------------------ */

function layoutConfig(layout) {
  return J({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: {
      description: ['Description'],
      acceptance: ['Acceptance Criteria'],
    },
    layout: layout,
  }, null, 2) + '\n';
}

const FOLDERS = { epics: 'epics', tasks: 'tasks', subtasks: 'subtasks', archive: 'archive' };
const withFolder = (k, v, group) =>
  ({ group: group || 'type', folders: Object.assign({}, FOLDERS, { [k]: v }) });

const INVALID_LAYOUT = [
  { label: 'unknown key inside layout', layout: { group: 'type', colour: 'blue' } },
  { label: 'unknown key inside layout.folders',
    layout: { group: 'type', folders: Object.assign({}, FOLDERS, { docs: 'docs' }) } },
  { label: 'group is not type, hierarchy or flat', layout: { group: 'tree' } },
  { label: 'folder name with a space', layout: withFolder('tasks', 'my tasks') },
  { label: 'folder name starting with a dash', layout: withFolder('tasks', '-tasks') },
  { label: 'empty folder name', layout: withFolder('tasks', '') },
  { label: 'folder name with a path separator', layout: withFolder('archive', '../escape') },
  { label: 'folder name of the form TSK-<n>', layout: withFolder('tasks', 'TSK-12') },
  { label: 'folder name of the form EPIC-<n>', layout: withFolder('archive', 'EPIC-1') },
  { label: 'duplicate folder names',
    layout: { group: 'type', folders: Object.assign({}, FOLDERS, { tasks: 'items', subtasks: 'items' }) } },
  { label: 'invalid folder name under flat (still validated)', layout: withFolder('epics', 'bad name', 'flat') },
  { label: 'duplicate folder names under hierarchy (still validated)',
    layout: { group: 'hierarchy', folders: Object.assign({}, FOLDERS, { epics: 'same', tasks: 'same' }) } },
  { label: 'statusFile is not a boolean', layout: { group: 'type', statusFile: 'yes' } },
  /* DECISIONS 91 B13: `backlog` is forbidden as a folder name, case-insensitively */
  { label: 'folder name backlog', layout: withFolder('archive', 'backlog') },
  { label: 'folder name Backlog (case-insensitive)', layout: withFolder('tasks', 'Backlog') },
  /* DECISIONS 91 B14: distinctness and the ID-shape check are case-insensitive */
  { label: 'duplicate folder names differing only in case',
    layout: { group: 'type', folders: Object.assign({}, FOLDERS, { tasks: 'Items', subtasks: 'items' }) } },
  { label: 'folder name shaped like an ID in lower case', layout: withFolder('tasks', 'tsk-12') },
  /* DECISIONS 97 (56): distinctness is checked on the EFFECTIVE names — a
   * subset that renames tasks to the default name of epics collides */
  { label: 'a folders subset colliding with a default name',
    layout: { group: 'type', folders: { tasks: 'epics' } } },
];

function fixtureWith(label, cfg) {
  return H.mkBacklog({
    label: 'ac17-layout-' + label.replace(/[^a-z0-9]+/gi, '-'),
    config: cfg,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      'tasks/TSK-001.md': taskFixture('TSK-001', 'Backend API Endpoints', 'todo'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

for (const bad of INVALID_LAYOUT) {
  const d = fixtureWith(bad.label, layoutConfig(bad.layout));
  const before = snapshot(path.join(d, 'backlog'));

  for (const [name, args] of COMMANDS) {
    const r = H.runNj(args, { cwd: d });
    T.exit('layout: ' + name + ' fails with exit 1 (' + bad.label + ')', r, 1);
    T.contains('layout: ' + name + ' points at nj doctor (' + bad.label + ')', out(r), 'doctor');
  }
  const changed = changedFiles(before, snapshot(path.join(d, 'backlog')));
  T.check('layout: a failing command writes nothing (' + bad.label + ')',
    changed.length === 0, 'changed: ' + changed.join(', '));

  const rj = H.runJson(['doctor'], { cwd: d });
  T.exit('layout: doctor --json exits 2 (' + bad.label + ')', rj, 2);
  T.sameSet('layout: config:invalid is the only code reported (' + bad.label + ')',
    [...new Set(H.doctorSet(rj) || ['<no problems array>'])], ['config:invalid:error']);
  const inv = ((rj.json && rj.json.problems) || []).filter(p => p.code === 'config:invalid');
  T.check('layout: config:invalid is backlog-level (' + bad.label + ')',
    inv.length >= 1 && !inv[0].element, J(inv[0] || null));
  T.exit('layout: doctor (human) exits 2 (' + bad.label + ')', H.runNj(['doctor'], { cwd: d }), 2);
  noOverviewCreated('layout: ' + bad.label, d);
}

/* Valid layout blocks: every part is optional (§ 5). The elements lie in
 * the type folders, so under `flat` they are misplaced — but the
 * configuration itself is valid, so commands run and doctor raises no
 * config:invalid. */
const VALID_LAYOUT = [
  { label: 'empty layout block', layout: {} },
  { label: 'group only', layout: { group: 'flat' } },
  { label: 'statusFile false', layout: { statusFile: false } },
  { label: 'renamed folders', layout: { group: 'hierarchy', folders: { epics: 'E1', tasks: 'work_items', subtasks: 'small-1', archive: 'shelf' } } },
  /* DECISIONS 97 (56): any subset of the four keys; a missing key is its default */
  { label: 'a folders subset (archive only)', layout: { group: 'type', folders: { archive: 'shelf' } } },
  { label: 'an empty folders object', layout: { folders: {} } },
];
for (const ok of VALID_LAYOUT) {
  const d = fixtureWith('ok-' + ok.label, layoutConfig(ok.layout));
  const r = H.runJson(['list'], { cwd: d });
  T.exit('layout: a valid layout block is accepted by list (' + ok.label + ')', r, 0);
  const rj = H.runJson(['doctor'], { cwd: d });
  T.check('layout: doctor raises no config:invalid (' + ok.label + ')',
    Array.isArray(rj.json && rj.json.problems) && !rj.json.problems.some(p => p.code === 'config:invalid'),
    (rj.parseError || J(rj.json)).slice(0, 300));
}

/* "A configuration without `layout` is valid and behaves exactly like the
 * defaults": the same backlog, once without `layout` and once with the
 * block `nj init` writes (§ 5), answers every read identically. */
{
  const DEFAULT_LAYOUT = { group: 'type', folders: FOLDERS, statusFile: true };
  const without = fixtureWith('default-without', config(['todo', 'doing', 'blocked', 'review', 'done']));
  const withBlock = fixtureWith('default-with', layoutConfig(DEFAULT_LAYOUT));
  const mask = (x, d) => J(x).split(fs.realpathSync(path.join(d, 'backlog'))).join('<BL>')
    .split(path.join(d, 'backlog')).join('<BL>');
  for (const args of [[], ['list'], ['list', '--all'], ['tree'], ['show', '--id=TSK-001'], ['doctor']]) {
    const a = H.runJson(args, { cwd: without });
    const b = H.runJson(args, { cwd: withBlock });
    const label = args.join(' ') || 'bare nj';
    T.exit('layout: ' + label + ' with the default layout block exits like without it', b, a.status);
    T.eq('layout: ' + label + ' answers the same with and without the default layout block',
      mask(b.json, withBlock), mask(a.json, without));
  }
}

/* ---- § 14 / DECISIONS 93 F3: --fix writes nothing while config:invalid --- */

/* Each fixture carries a repair `--fix` would make on a valid backlog — a
 * missing tombstone (§ 14 step 4) — so "writes nothing" is not vacuous. */
for (const [label, cfg] of [
  ['invalid statuses', config(['todo', 'done', 'doing'])],
  ['invalid layout block', layoutConfig({ group: 'tree' })],
]) {
  const d = fixtureWith('fix-' + label, cfg);
  fs.rmSync(path.join(d, 'backlog', H.IDS_REL, 'TSK-001'));
  const before = snapshot(path.join(d, 'backlog'));
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.exit('--fix on an invalid config (' + label + '): exit 2', r, 2);
  const changed = changedFiles(before, snapshot(path.join(d, 'backlog')));
  T.check('--fix on an invalid config writes nothing (' + label + ')',
    changed.length === 0, 'changed: ' + changed.join(', '));
}
{
  /* the F3 scenario: --backlog one level too high, at a project directory */
  const d = fixtureWith('fix-project-dir', config(['todo', 'doing', 'blocked', 'review', 'done']));
  fs.writeFileSync(path.join(d, 'README.md'), '# A project\n');
  const before = snapshot(d);
  const r = H.runJson(['doctor', '--fix', '--backlog=' + d], { cwd: d });
  T.exit('--fix with --backlog at a project directory: exit 2 (no configuration there)', r, 2);
  const changed = changedFiles(before, snapshot(d));
  T.check('--fix with --backlog at a project directory writes nothing into it',
    changed.length === 0, 'changed: ' + changed.join(', '));
}

/* ---- DECISIONS 102: no placement judgement while config:invalid ------------
 * § 5 (amended): "While the configuration is invalid (`config:invalid`), no
 * placement is judged: `type:folder` and `layout:misplaced` are not
 * reported, because the layout they would be judged against is unknown."
 * Each fixture first lies exactly where a VALID layout puts it (checked
 * clean), then the configuration is broken without moving a file — so any
 * location code afterwards can only come from judging against a guessed
 * (default) layout. */
function mdTree(root) {
  const out = [];
  (function walk(d, rel) {
    for (const n of H.lsOrEmpty(d)) {
      const r = rel ? rel + '/' + n : n;
      let st; try { st = fs.statSync(path.join(d, n)); } catch (e) { continue; }
      if (st.isDirectory()) walk(path.join(d, n), r); else out.push(r);
    }
  })(root, '');
  return out.sort();
}
const E1 = H.element({ id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo', created: NOW, updated: NOW },
  '# Auth\n\n## Description\nSomething.\n');
const T1 = taskFixture('TSK-001', 'Backend API Endpoints', 'todo');
const T2 = taskFixture('TSK-002', 'Second task', 'todo');
const PLACEMENT = [
  { label: 'files in a renamed tasks folder "work", then folders.tasks = "backlog" (the reported repro)',
    valid: { group: 'type', folders: { tasks: 'work' } },
    invalid: { group: 'type', folders: { tasks: 'backlog' } },
    files: { 'epics/EPIC-001.md': E1, 'work/TSK-001.md': T1, 'work/TSK-002.md': T2 } },
  { label: 'hierarchy, then an invalid archive folder name',
    valid: { group: 'hierarchy' },
    invalid: { group: 'hierarchy', folders: { archive: 'bad name' } },
    files: { 'EPIC-001/EPIC-001.md': E1, 'EPIC-001/TSK-001/TSK-001.md': T1, 'EPIC-001/TSK-002/TSK-002.md': T2 } },
  { label: 'hierarchy, then an unknown group',
    valid: { group: 'hierarchy' },
    invalid: { group: 'tree' },
    files: { 'EPIC-001/EPIC-001.md': E1, 'EPIC-001/TSK-001/TSK-001.md': T1, 'EPIC-001/TSK-002/TSK-002.md': T2 } },
  { label: 'flat, then an unknown layout key',
    valid: { group: 'flat' },
    invalid: { group: 'flat', colour: 'blue' },
    files: { 'EPIC-001.md': E1, 'TSK-001.md': T1, 'TSK-002.md': T2 } },
  { label: 'flat, then duplicate folder names',
    valid: { group: 'flat' },
    invalid: { group: 'flat', folders: { epics: 'same', tasks: 'same' } },
    files: { 'EPIC-001.md': E1, 'TSK-001.md': T1, 'TSK-002.md': T2 } },
];
const LOCATION = ['type:folder', 'layout:misplaced'];
for (const c of PLACEMENT) {
  const tag = 'D102 [' + c.label + ']';
  const d = H.mkBacklog({ label: 'ac17-d102', config: layoutConfig(c.valid), files: c.files,
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'] });
  const bl = path.join(d, 'backlog');
  const ok = H.runJson(['doctor'], { cwd: d });
  T.exit(tag + ' fixture: with the valid layout, doctor exits 0', ok, 0);
  T.eq(tag + ' fixture: with the valid layout, every file is at its place', H.doctorSet(ok), []);

  fs.writeFileSync(path.join(bl, H.CONFIG_REL), layoutConfig(c.invalid));
  const tree = mdTree(bl);

  const rj = H.runJson(['doctor'], { cwd: d });
  T.exit(tag + ' doctor exits 2', rj, 2);
  const probs = (rj.json && Array.isArray(rj.json.problems)) ? rj.json.problems : [];
  T.check(tag + ' doctor reports no type:folder / layout:misplaced (§ 5, D102)',
    Array.isArray(rj.json && rj.json.problems) && !probs.some(p => LOCATION.includes(p.code)),
    J(probs.filter(p => LOCATION.includes(p.code))).slice(0, 300));
  T.sameSet(tag + ' doctor reports exactly config:invalid',
    [...new Set(H.doctorSet(rj) || ['<no problems array>'])], ['config:invalid:error']);
  const rh = H.runNj(['doctor'], { cwd: d });
  /* the only finding is backlog-level, so the human report names no element
   * — independent of how a location finding would be worded */
  T.check(tag + ' the human doctor names no element (no per-file placement finding)',
    !/\b(EPIC|TSK)-00[12]\b/.test(rh.stdout), J(rh.stdout).slice(0, 300));

  /* list refuses on an invalid configuration (§ 5), so its entries — and
   * their _problems — cannot carry a location code either */
  const ls = H.runJson(['list'], { cwd: d });
  T.exit(tag + ' list --json exits 1', ls, 1);
  T.eq(tag + ' list --json: invalid_config, not a read with entries',
    J({ error: ls.json && ls.json.error, entries: !!(ls.json && ls.json.entries) }),
    J({ error: 'invalid_config', entries: false }));

  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.exit(tag + ' doctor --fix exits 2 and moves nothing', fix, 2);
  T.eq(tag + ' doctor --fix left every file where it was', mdTree(bl), tree);
  T.check(tag + ' doctor --fix reports no location code either',
    !((fix.json && fix.json.problems) || []).some(p => LOCATION.includes(p.code)),
    J(fix.json && fix.json.problems).slice(0, 300));
}

T.finish();
