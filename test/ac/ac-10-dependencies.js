'use strict';
/* AC-10 — Dependencies.
 *
 * § 15 AC-10: "Dependencies. `--ready` honours `depends_on` — including
 * satisfied references into the archive; cycles are detected and do not spin
 * into an endless loop."
 *
 * § 9 `--ready`: an element is ready when
 *   1. `status` equals `statuses[0]`,
 *   2. every `depends_on` target is `done` and carries no `done:open_children`,
 *   3. no problem code with Blocks = yes is present,
 *   4. the element is complete (§ 7).
 * § 11: a `depends_on` pointing into the archive is satisfied by definition and
 * surfaces as `active_refs_archived` — informational, never blocking.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

/* A complete task: description and acceptance both non-empty, so readiness is
 * decided by the dependency edge alone and not by incompleteness. */
function task(id, title, opts) {
  const o = opts || {};
  const f = {
    id: id, type: 'task', parent: o.parent || 'EPIC-001', title: title,
    status: o.status || 'todo',
  };
  if (o.priority) f.priority = o.priority;
  if (o.depends) f.depends_on = '[' + o.depends.join(', ') + ']';
  f.created = NOW;
  f.updated = NOW;
  return H.element(f, H.completeBody(title));
}

function epic(id, title, status) {
  return H.element({
    id: id, type: 'epic', title: title, status: status || 'todo',
    created: NOW, updated: NOW,
  }, '# ' + title + '\n\n## Description\nSomething.\n');
}

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}

function entryOf(json, id) {
  if (!json || !Array.isArray(json.entries)) return null;
  return json.entries.filter(e => e.id === id)[0] || null;
}

function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

/* Fill the empty scaffolded sections so the element counts as complete (§ 7).
 * Fixture surgery on a file this test wrote, not a look at the tool. */
function fillBody(dir, rel) {
  const p = path.join(dir, 'backlog', rel);
  if (!fs.existsSync(p)) return false;  // nj never created it; that failure is already reported
  const s = fs.readFileSync(p, 'utf8')
    .replace('## Description\n', '## Description\nSomething.\n')
    .replace('## Acceptance Criteria\n', '## Acceptance Criteria\n- [ ] It works\n');
  fs.writeFileSync(p, s);
  return true;
}

/* ---- both directions of the dependency edge ----------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac10-ready',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth'),
      'tasks/TSK-001.md': task('TSK-001', 'Waits for an unfinished task', { depends: ['TSK-002'] }),
      'tasks/TSK-002.md': task('TSK-002', 'Still open'),
      'tasks/TSK-003.md': task('TSK-003', 'Already closed', { status: 'done' }),
      'tasks/TSK-004.md': task('TSK-004', 'Waits for a closed task', { depends: ['TSK-003'] }),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004'],
  });

  const r = H.runJson(['list', '--ready'], { cwd: d });
  T.exit('list --ready reports data problems via _problems, so it exits 0', r, 0);
  const ready = ids(r.json);
  T.check('list --ready --json carries entries[]', ready.length > 0, r.parseError || r.stdout);
  T.check('todo + depends_on a done task = ready (TSK-004)',
    ready.includes('TSK-004'), 'ready = ' + ready.join(', '));
  T.check('todo + depends_on an undone task = not ready (TSK-001)',
    !ready.includes('TSK-001'), 'ready = ' + ready.join(', '));
  T.check('a done element is not ready, its status is not statuses[0] (TSK-003)',
    !ready.includes('TSK-003'), 'ready = ' + ready.join(', '));

  const rh = H.runNj(['list', '--ready'], { cwd: d });
  T.exit('list --ready (human)', rh, 0);
  // § 9's example prints "Ready to work:" and, for the rest, "Complete first:";
  // splitting without the colon tolerates harmless spelling of that heading.
  const readyBlock = String(rh.stdout).split('Complete first')[0];
  T.check('the human ready block lists TSK-004',
    readyBlock.includes('TSK-004'), J(rh.stdout).slice(0, 400));
  T.check('the human ready block does not offer the blocked TSK-001',
    !readyBlock.includes('TSK-001'), J(rh.stdout).slice(0, 400));
}

/* ---- a target that is done but carries done:open_children --------------- */

{
  // Built through the CLI, so the state is produced the sanctioned way:
  // § 9 says forcing `done` over open children produces done:open_children.
  const d = H.freshDir('ac10-openchildren');
  T.exit('init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.exit('new parent task',
    H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Parent with an open child'], { cwd: d }), 0);
  T.exit('new open subtask',
    H.runNj(['new', '--type=subtask', '--parent=TSK-001', '--title=Still open'], { cwd: d }), 0);

  const jDep = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Dependent',
    '--depends-on=TSK-001'], { cwd: d });
  T.exit('new dependent task', jDep, 0);
  const depId = (jDep.json || {}).id || 'TSK-002';

  const jCtl = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Control'], { cwd: d });
  T.exit('new control task', jCtl, 0);
  const ctlId = (jCtl.json || {}).id || 'TSK-003';

  // The dependent and the control need non-empty Description and Acceptance,
  // otherwise incompleteness would block them for an unrelated reason.
  fillBody(d, 'tasks/' + depId + '.md');
  fillBody(d, 'tasks/' + ctlId + '.md');

  T.exit('force the parent done while its child is open',
    H.runNj(['set', '--id=TSK-001', '--status=done', '--allow-open-children'], { cwd: d }), 0);

  const s = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('show TSK-001', s, 0);
  const probs = (entryOf(s.json, 'TSK-001') || {})._problems || [];
  T.check('forcing done over an open child produces done:open_children (§ 9)',
    probs.includes('done:open_children'), 'problems = ' + J(probs));

  const r = H.runJson(['list', '--ready'], { cwd: d });
  T.exit('list --ready', r, 0);
  const ready = ids(r.json);
  T.check('a target that carries done:open_children does not satisfy depends_on (§ 9 rule 2)',
    !ready.includes(depId), 'ready = ' + ready.join(', '));
  T.check('the control task without dependencies is ready (the check above is not vacuous)',
    ready.includes(ctlId), 'ready = ' + ready.join(', '));
}

/* ---- a depends_on into the archive is satisfied (§ 11) ------------------ */

{
  const d = H.mkBacklog({
    label: 'ac10-archive',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth'),
      'archive/TSK-003.md': H.element({
        id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'Closed and shelved',
        status: 'done', created: NOW, updated: NOW, archived: NOW,
      }, H.completeBody('Closed and shelved')),
      'tasks/TSK-001.md': task('TSK-001', 'Waits for an archived task', { depends: ['TSK-003'] }),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-003'],
  });

  const r = H.runJson(['list', '--ready'], { cwd: d });
  T.exit('list --ready with a dependency into the archive', r, 0);
  T.check('an archived depends_on target counts as satisfied (TSK-001 is ready)',
    ids(r.json).includes('TSK-001'), 'ready = ' + ids(r.json).join(', '));

  const s = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('show TSK-001', s, 0);
  const e = entryOf(s.json, 'TSK-001');
  T.check('show --json returns the addressed entry', !!e, (s.parseError || s.stdout).slice(0, 300));
  const probs = (e && e._problems) || [];
  T.check('the reference into the archive surfaces as active_refs_archived',
    probs.includes('active_refs_archived'), 'problems = ' + J(probs));
}

/* ---- cycles are detected and terminate --------------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac10-cycle',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth'),
      'tasks/TSK-001.md': task('TSK-001', 'Cycle A', { depends: ['TSK-002'] }),
      'tasks/TSK-002.md': task('TSK-002', 'Cycle B', { depends: ['TSK-001'] }),
      'tasks/TSK-003.md': task('TSK-003', 'Self cycle', { depends: ['TSK-003'] }),
      'tasks/TSK-004.md': task('TSK-004', 'Control, no dependency'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004'],
  });

  // A 20 s budget: a resolver that walks the cycle without a visited set has to
  // be killed, and being killed is the failure this asserts.
  const rt = H.runNj(['list', '--ready'], { cwd: d, timeout: 20000 });
  T.check('list --ready terminates on a depends_on cycle (20 s timeout, process not killed)',
    rt.status !== null && !rt.missing && !rt.signal,
    'status=' + rt.status + ' signal=' + rt.signal + ' ' + (rt.missing || ''));
  T.exit('list --ready with a cycle is still a successful read (exit 0)', rt, 0);

  const j = H.runJson(['list'], { cwd: d });
  T.exit('list with a cycle', j, 0);
  const codes = [];
  for (const id of ['TSK-001', 'TSK-002', 'TSK-003']) {
    const e = entryOf(j.json, id);
    if (e && Array.isArray(e._problems)) codes.push.apply(codes, e._problems);
  }
  T.check('the cycle is reported as depends_on:cycle',
    codes.includes('depends_on:cycle'), 'codes = ' + J(codes));

  const rj = H.runJson(['list', '--ready'], { cwd: d });
  T.exit('list --ready --json with a cycle', rj, 0);
  const ready = ids(rj.json);
  T.check('no element in a depends_on cycle is ready',
    !ready.includes('TSK-001') && !ready.includes('TSK-002') && !ready.includes('TSK-003'),
    'ready = ' + ready.join(', '));
  T.check('the control task is ready (the check above is not vacuous)',
    ready.includes('TSK-004'), 'ready = ' + ready.join(', '));
}

T.finish();
