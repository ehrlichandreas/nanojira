'use strict';
/* AC-13 — JSON contract.
 *
 * § 15 AC-13: "JSON contract. Every command supports `--json`; read shapes and
 * the write result shape match § 9; `_problems` contains only closed-vocabulary
 * codes; `changed` lists exactly the fields that changed."
 *
 * § 9 "JSON shapes per command":
 *   list, show      {backlog, counts, entries: [{…, _problems}]}
 *   new set note rm {ok, id, changed: […], entry: {…, _problems}}
 *   archive         {ok, ids: […], changed: ["archived"], entries: […], _problems: […]}
 *   rm --cascade    {ok, ids: […], changed: ["deleted"],  entries: […], _problems: […]}
 *   tree            {backlog, counts, entries: […]} — flat, each entry carries parent
 *   doctor          {backlog, ok, problems: [{code, severity, element?, file?, line?, message}]}
 *   bare nj         {backlog, counts, ready: [≤5], incomplete: [≤5]}
 * Every entry object always carries `_problems`.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

/* The closed vocabulary of § 7. The table has 29 rows and 30 distinct codes:
 * one row, `missing:created` / `missing:updated`, names two. Counting rows
 * gives 29, and counting only separator-bearing names gives 28 — both are
 * traps (AMBIGUITIES.md #22). Adding a code is additive; renaming or
 * redefining one is forbidden. */
const TABLE = [
  'frontmatter:unreadable',
  'file:unreadable',
  'duplicate_id',
  'missing:title',
  'missing:status',
  'missing:created',
  'missing:updated',
  'id:derived',
  'id:mismatch',
  'type:derived',
  'type:folder',
  'parent:orphaned',
  'parent:dangling',
  'parent:cycle',
  'parent:hierarchy',
  'depends_on:dangling',
  'depends_on:cycle',
  'unknown:status',
  'unknown:priority',
  'done:open_children',
  'archive:not_done',
  'archive:split',
  'title:h1_mismatch',
  'incomplete:description',
  'incomplete:acceptance',
  'active_refs_archived',
  'id:no_tombstone',
  'backlog:stray_tmp',
  'backlog:ids_missing',
  'config:invalid',
];

/* Codes whose Doctor column is "—": workflow state that never becomes a doctor
 * finding (§ 7). */
const NEVER_A_FINDING = ['incomplete:description', 'incomplete:acceptance', 'active_refs_archived'];

/* Codes collected from every JSON surface the fixtures below exercise. */
const SEEN = new Set();

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}

function codesOf(entries) {
  const out = [];
  for (const e of entries || []) {
    if (e && Array.isArray(e._problems)) out.push.apply(out, e._problems);
  }
  return out;
}

function isReadShape(desc, json, r) {
  T.check(desc + ': {backlog, counts, entries[]}',
    !!json && typeof json.backlog === 'string' &&
    !!json.counts && typeof json.counts === 'object' && Array.isArray(json.entries),
    (r && r.parseError) || J(json).slice(0, 300));
  T.check(desc + ': counts carries total/errors/incomplete as numbers',
    !!json && !!json.counts && ['total', 'errors', 'incomplete']
      .every(k => typeof json.counts[k] === 'number'),
    J(json && json.counts));
  T.check(desc + ': every entry carries _problems (§ 9)',
    !!json && Array.isArray(json.entries) && json.entries.every(e => Array.isArray(e._problems)),
    J(json && json.entries).slice(0, 300));
  T.check(desc + ': every entry carries the § 6 fields as strings',
    !!json && Array.isArray(json.entries) && json.entries.every(e =>
      typeof e.id === 'string' && typeof e.type === 'string' && typeof e.title === 'string' &&
      typeof e.status === 'string' && typeof e.created === 'string' && typeof e.updated === 'string'),
    J(json && json.entries).slice(0, 300));
}

/* Run a write commands and check the § 9 write result shape. */
function write(desc, args, cwd, expectId) {
  const r = H.runJson(args, { cwd: cwd });
  T.exit(desc + ' exits 0', r, 0);
  const j = r.json;
  T.check(desc + ': --json parses', j !== null, (r.parseError || r.stdout).slice(0, 300));
  if (j) {
    T.check(desc + ': ok === true', j.ok === true, J(j).slice(0, 400));
    T.check(desc + ': changed is an array', Array.isArray(j.changed), J(j.changed));
    T.check(desc + ': _problems is an array', Array.isArray(j._problems), J(j._problems));
    T.check(desc + ': entry carries _problems',
      !!j.entry && typeof j.entry === 'object' && Array.isArray(j.entry._problems),
      J(j.entry || null).slice(0, 400));
    if (expectId) {
      T.eq(desc + ': addresses ' + expectId, j.id, expectId);
    }
  }
  return j || {};
}

/* ---- every command of § 9 answers to --json ---------------------------- */

{
  const d = H.freshDir('ac13-cmds');

  // AMBIGUOUS: § 9 requires --json from every command and lists shapes for the
  // other ten, but gives none for `init`. Only "runs and parses" is asserted.
  const jInit = H.runJson(['init'], { cwd: d });
  T.exit('nj init --json exits 0', jInit, 0);
  T.check('nj init --json parses as JSON', jInit.json !== null,
    (jInit.parseError || jInit.stdout).slice(0, 300));

  write('nj new (epic)', ['new', '--type=epic', '--title=Auth'], d, 'EPIC-001');
  write('nj new (task)', ['new', '--type=task', '--parent=EPIC-001', '--title=First'], d, 'TSK-001');
  write('nj new (task, second)', ['new', '--type=task', '--parent=EPIC-001', '--title=Second'], d, 'TSK-002');
  write('nj new (subtask)', ['new', '--type=subtask', '--parent=TSK-001', '--title=Sub'], d, 'SUB-001');

  // AMBIGUOUS: § 9 does not say which names `nj new` reports in `changed` —
  // title, status, created and updated are all written at creation.
  const jp = write('nj set --priority', ['set', '--id=TSK-002', '--priority=high'], d, 'TSK-002');
  T.eq('changed lists exactly the field that changed: ["priority"]', jp.changed, ['priority']);

  const ja = write('nj set --assignee', ['set', '--id=TSK-002', '--assignee=coder-agent'], d, 'TSK-002');
  T.eq('changed lists exactly the field that changed: ["assignee"]', ja.changed, ['assignee']);

  const jt = write('nj set --title', ['set', '--id=TSK-001', '--title=Renamed'], d, 'TSK-001');
  T.eq('changed lists exactly the field that changed: ["title"]', jt.changed, ['title']);

  const j2 = write('nj set (two fields)', ['set', '--id=TSK-002', '--status=doing', '--priority=low'], d, 'TSK-002');
  T.eq('changed lists exactly the two fields that changed', (j2.changed || []).slice().sort(),
    ['priority', 'status']);

  // AMBIGUOUS: a note lives in the body, not in a schema field; § 9 does not
  // pin which name `nj note` reports in `changed`. Only "non-empty array" —
  // checked by write() — is asserted.
  const jn = write('nj note', ['note', '--id=TSK-001', 'A note for the log'], d, 'TSK-001');
  T.check('nj note reports at least one changed name', Array.isArray(jn.changed) && jn.changed.length >= 1,
    J(jn.changed));

  const js = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('nj show --json exits 0', js, 0);
  isReadShape('show', js.json, js);
  T.check('show returns exactly the addressed element',
    ids(js.json).join(',') === 'TSK-001', J(ids(js.json)));

  const jl = H.runJson(['list'], { cwd: d });
  T.exit('nj list --json exits 0', jl, 0);
  isReadShape('list', jl.json, jl);
  T.check('list --json is not empty', ids(jl.json).length > 0, J(ids(jl.json)));

  const jtr = H.runJson(['tree'], { cwd: d });
  T.exit('nj tree --json exits 0', jtr, 0);
  isReadShape('tree', jtr.json, jtr);
  const tEntry = id => (jtr.json && jtr.json.entries || []).filter(e => e.id === id)[0];
  T.eq('tree: a child carries its parent (flat, § 9)', (tEntry('TSK-001') || {}).parent, 'EPIC-001');
  T.eq('tree: a subtask carries its parent', (tEntry('SUB-001') || {}).parent, 'TSK-001');
  T.check('tree is flat: no nested children arrays',
    !!jtr.json && jtr.json.entries.every(e => !Array.isArray(e.children)),
    J(jtr.json && jtr.json.entries).slice(0, 300));

  const jr = H.runJson(['rm', '--id=TSK-002'], { cwd: d });
  T.exit('nj rm --json exits 0', jr, 0);
  const rj = jr.json || {};
  T.check('rm: ok === true', rj.ok === true, (jr.parseError || J(rj)).slice(0, 300));
  T.eq('rm: id is the removed element', rj.id, 'TSK-002');
  T.eq('rm: changed is ["deleted"]', rj.changed, ['deleted']);
  T.check('rm: entry carries _problems', !!rj.entry && Array.isArray(rj.entry._problems),
    J(rj.entry || null).slice(0, 300));
  T.check('rm: the file is gone', !H.existsInBacklog(d, 'tasks/TSK-002.md'), 'tasks/TSK-002.md still there');
  T.check('rm: the tombstone stays (§ 8)',
    fs.existsSync(path.join(d, 'backlog', '.ids', 'TSK-002')), '.ids/TSK-002 missing');

  write('nj set (subtask done)', ['set', '--id=SUB-001', '--status=done'], d, 'SUB-001');
  write('nj set (task done)', ['set', '--id=TSK-001', '--status=done'], d, 'TSK-001');
  write('nj set (epic done)', ['set', '--id=EPIC-001', '--status=done'], d, 'EPIC-001');

  const jarc = H.runJson(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('nj archive --json exits 0', jarc, 0);
  const aj = jarc.json || {};
  T.check('archive: ok === true', aj.ok === true, (jarc.parseError || J(aj)).slice(0, 300));
  T.check('archive: ids names the whole moved subtree',
    Array.isArray(aj.ids) && aj.ids.slice().sort().join(',') === 'EPIC-001,SUB-001,TSK-001',
    J(aj.ids));
  T.eq('archive: changed is ["archived"]', aj.changed, ['archived']);
  T.check('archive: entries carries _problems on every entry',
    Array.isArray(aj.entries) && aj.entries.every(e => Array.isArray(e._problems)),
    J(aj.entries).slice(0, 300));
  T.check('archive: top-level _problems is an array', Array.isArray(aj._problems),
    J(aj._problems));

  const jdoc = H.runJson(['doctor'], { cwd: d });
  // Everything is archived, done and tombstoned — by § 7/§ 11 that is a clean
  // backlog, so doctor exits 0 and warns about nothing.
  T.exit('nj doctor --json exits 0 on a clean backlog', jdoc, 0);
  const dj = jdoc.json || {};
  T.check('doctor: {backlog, ok, problems[]}',
    typeof dj.backlog === 'string' && typeof dj.ok === 'boolean' && Array.isArray(dj.problems),
    (jdoc.parseError || J(dj)).slice(0, 300));
  T.eq('doctor: ok is true when no error finding exists', dj.ok, true);
  T.eq('doctor: problems is empty', (dj.problems || []).length, 0);

  const jbare = H.runJson([], { cwd: d });
  T.exit('bare nj --json exits 0', jbare, 0);
  const bj = jbare.json || {};
  T.check('bare nj: {backlog, counts, ready[], incomplete[]}',
    typeof bj.backlog === 'string' && !!bj.counts &&
    Array.isArray(bj.ready) && Array.isArray(bj.incomplete),
    (jbare.parseError || J(bj)).slice(0, 300));
  T.check('bare nj: ready carries at most 5 entries (§ 9)',
    Array.isArray(bj.ready) && bj.ready.length <= 5, J(bj.ready));
  T.check('bare nj: incomplete carries at most 5 entries (§ 9)',
    Array.isArray(bj.incomplete) && bj.incomplete.length <= 5, J(bj.incomplete));
  T.check('bare nj: every ready entry carries _problems',
    Array.isArray(bj.ready) && bj.ready.every(e => Array.isArray(e._problems)),
    J(bj.ready).slice(0, 300));
}

/* ---- rm --cascade has its own shape (§ 9) ------------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac13-cascade',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend', status: 'todo',
        created: NOW, updated: NOW,
      }, H.completeBody('Backend')),
      'subtasks/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Login route', status: 'todo',
        created: NOW, updated: NOW,
      }, H.completeBody('Login route')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });

  const r = H.runJson(['rm', '--id=EPIC-001', '--cascade'], { cwd: d });
  T.exit('nj rm --cascade --json exits 0', r, 0);
  const j = r.json || {};
  T.check('rm --cascade: ok === true', j.ok === true, (r.parseError || J(j)).slice(0, 300));
  T.check('rm --cascade: ids names the whole deleted subtree',
    Array.isArray(j.ids) && j.ids.slice().sort().join(',') === 'EPIC-001,SUB-001,TSK-001',
    J(j.ids));
  T.eq('rm --cascade: changed is ["deleted"]', j.changed, ['deleted']);
  T.check('rm --cascade: entries is an array', Array.isArray(j.entries),
    J(j.entries));
  T.check('rm --cascade: top-level _problems is an array', Array.isArray(j._problems),
    J(j._problems));
  T.check('rm --cascade: every deleted file is gone',
    !H.existsInBacklog(d, 'epics/EPIC-001.md') && !H.existsInBacklog(d, 'tasks/TSK-001.md') &&
    !H.existsInBacklog(d, 'subtasks/SUB-001.md'), 'some file survived');
}

/* ---- duplicate_id: reads show both entries, marked ---------------------- */

{
  const st = (id, fields, body) => H.element(Object.assign({
    id: id, type: 'task', parent: 'EPIC-001', title: 'Element ' + id, status: 'todo',
    created: NOW, updated: NOW,
  }, fields), body);

  // Two files carrying the same frontmatter id. Such a backlog may legitimately
  // refuse writes (§ 9), so nothing is written here — only read.
  const d = H.mkBacklog({
    label: 'ac13-duplicate',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      'tasks/TSK-009.md': st('TSK-009', {}, H.completeBody('Element TSK-009')),
      'tasks/TSK-010.md': st('TSK-010', { id: 'TSK-009' }, H.completeBody('Element TSK-010')),
    },
    tombstones: ['EPIC-001', 'TSK-009', 'TSK-010'],
  });

  const r = H.runJson(['list', '--all'], { cwd: d });
  T.exit('list with a duplicate id exits 0 (§ 9: reads show both entries)', r, 0);
  const entries = (r.json && r.json.entries) || [];
  const marked = entries.filter(e => Array.isArray(e._problems) && e._problems.includes('duplicate_id'));
  T.check('both files of the duplicate id are shown',
    entries.filter(e => e.id === 'TSK-009').length === 2, J(ids(r.json)));
  T.check('both of them are marked duplicate_id', marked.length === 2, J(entries));
  for (const c of codesOf(entries)) SEEN.add(c);

  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor exits 2 on a duplicate id', doc, 2);
  const found = ((doc.json || {}).problems || []).map(p => p.code);
  T.check('doctor reports duplicate_id', found.includes('duplicate_id'), J(found));
  for (const c of found) SEEN.add(c);
}

/* ---- _problems speaks only the closed vocabulary of § 7 ----------------- */

{
  const st = (id, fields, body) => H.element(Object.assign({
    id: id, type: 'task', parent: 'EPIC-001', title: 'Element ' + id, status: 'todo',
    created: NOW, updated: NOW,
  }, fields), body);

  const d = H.mkBacklog({
    label: 'ac13-codes',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      // a clean, complete task
      'tasks/TSK-001.md': st('TSK-001', {}, H.completeBody('Element TSK-001')),
      // incomplete:acceptance — description present, acceptance missing
      'tasks/TSK-002.md': st('TSK-002', {}, '# Element TSK-002\n\n## Description\nSomething.\n'),
      // incomplete:description
      'tasks/TSK-003.md': st('TSK-003', {}, '# Element TSK-003\n\n## Acceptance Criteria\n- [ ] x\n'),
      // unknown:status
      'tasks/TSK-004.md': st('TSK-004', { status: 'waiting' }, H.completeBody('Element TSK-004')),
      // parent:dangling
      'tasks/TSK-005.md': st('TSK-005', { parent: 'EPIC-042' }, H.completeBody('Element TSK-005')),
      // depends_on:dangling
      'tasks/TSK-006.md': st('TSK-006', { depends_on: '[TSK-404]' }, H.completeBody('Element TSK-006')),
      // title:h1_mismatch
      'tasks/TSK-007.md': st('TSK-007', { title: 'Real title' },
        '# Stale heading\n\n## Description\nX\n\n## Acceptance Criteria\n- [ ] y\n'),
      // id:no_tombstone — no tombstone is written for TSK-008
      'tasks/TSK-008.md': st('TSK-008', {}, H.completeBody('Element TSK-008')),
      // archive:not_done
      'archive/TSK-020.md': st('TSK-020', { status: 'doing', archived: NOW },
        H.completeBody('Element TSK-020')),
      // backlog:stray_tmp — a temp file left by a crashed write (§ 12)
      '.nj-tmp-4242-deadbeef': 'half a write\n',
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005',
      'TSK-006', 'TSK-007', 'TSK-020'],
  });

  const jl = H.runJson(['list', '--all'], { cwd: d });
  T.exit('list --all on the problem fixture', jl, 0);
  for (const c of codesOf(jl.json && jl.json.entries)) SEEN.add(c);

  const js = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('show on the problem fixture', js, 0);
  for (const c of codesOf(js.json && js.json.entries)) SEEN.add(c);

  const jw = H.runJson(['set', '--id=TSK-002', '--status=doing'], { cwd: d });
  T.exit('write on the problem fixture', jw, 0);
  const wprobs = (jw.json && jw.json._problems) || [];
  T.check('the write result repeats the open problems of the written element (§ 9 example)',
    wprobs.includes('incomplete:acceptance'), J(wprobs));
  for (const c of wprobs) SEEN.add(c);
  for (const c of codesOf([(jw.json || {}).entry])) SEEN.add(c);

  const jdoc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor exits 2 while error findings exist', jdoc, 2);
  const dj = jdoc.json || {};
  const findings = dj.problems || [];
  for (const p of findings) SEEN.add(p.code);

  const unknown = Array.from(SEEN).filter(c => TABLE.indexOf(c) === -1).sort();
  T.check('every code seen comes from the closed table of § 7',
    unknown.length === 0, 'not in the table: ' + J(unknown));
  T.check('the fixture actually produced codes (the check above is not vacuous)',
    SEEN.size >= 10, 'codes = ' + J(Array.from(SEEN).sort()));

  const expected = ['incomplete:acceptance', 'incomplete:description', 'unknown:status',
    'parent:dangling', 'depends_on:dangling', 'title:h1_mismatch', 'id:no_tombstone',
    'archive:not_done', 'backlog:stray_tmp'];
  for (const want of expected) {
    T.check('the fixture surfaces ' + want, SEEN.has(want),
      'collected: ' + J(Array.from(SEEN).sort()));
  }

  T.eq('doctor: ok is false while an error finding exists', dj.ok, false);
  const badSeverity = findings.filter(p => p.severity !== 'error' && p.severity !== 'warning');
  T.check('doctor: every finding carries severity ∈ {error, warning} (the Doctor column)',
    badSeverity.length === 0, J(badSeverity).slice(0, 300));
  const dashFindings = findings.filter(p => NEVER_A_FINDING.indexOf(p.code) !== -1);
  T.check('doctor: codes with Doctor "—" never appear as findings (§ 7)',
    dashFindings.length === 0, J(dashFindings).slice(0, 300));
  const stray = findings.filter(p => p.code === 'backlog:stray_tmp')[0];
  T.check('doctor: a backlog-level finding carries no element (§ 9)',
    !!stray && !stray.element, J(stray));
}

/* ---- bare nj caps ready/incomplete at five ------------------------------ */

{
  const files = {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
      created: NOW, updated: NOW,
    }, '# Auth\n\n## Description\nSomething.\n'),
  };
  const tombstones = ['EPIC-001'];
  for (let i = 1; i <= 7; i++) {
    const id = 'TSK-' + String(i).padStart(3, '0');
    files['tasks/' + id + '.md'] = H.element({
      id: id, type: 'task', parent: 'EPIC-001', title: 'Ready ' + i, status: 'todo',
      created: NOW, updated: NOW,
    }, H.completeBody('Ready ' + i));
    tombstones.push(id);
  }
  const d = H.mkBacklog({ label: 'ac13-cap', files: files, tombstones: tombstones });

  const r = H.runJson([], { cwd: d });
  T.exit('bare nj --json on a backlog with eight ready elements', r, 0);
  const j = r.json || {};
  T.check('bare nj: ready is an array', Array.isArray(j.ready), J(j.ready));
  T.check('bare nj: the ready list is capped at 5 (§ 9)',
    Array.isArray(j.ready) && j.ready.length <= 5, 'length ' + (j.ready || []).length);
  T.check('bare nj: the ready list is not empty', Array.isArray(j.ready) && j.ready.length >= 1,
    'length ' + (j.ready || []).length);
  T.check('bare nj: every ready entry carries _problems',
    Array.isArray(j.ready) && j.ready.every(e => Array.isArray(e._problems)),
    J(j.ready).slice(0, 300));
}

T.finish();
