'use strict';
/* AC-19 — Doctor axis.
 *
 * "A backlog of freshly created elements yields doctor exit 0 with an empty
 *  problems[]; elements carrying only incomplete:* produce no doctor finding
 *  (they surface in list/_problems only); a hand-written unknown status
 *  produces a WARNING finding — printed, but exit 0; a duplicate ID produces
 *  exit 2."
 *
 * This criterion pins the two-axis model of §7: the Doctor column decides what
 * is a finding and what the exit code is, the Blocks column decides readiness.
 * They are independent, and the log line for — codes is the place where the
 * two are easiest to accidentally couple.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* ---- fresh backlog: exit 0, empty problems[] --------------------------- */
{
  const d = H.freshDir('ac19-fresh');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=A'], { cwd: d }), 0);
  T.exit('new task', H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=T'], { cwd: d }), 0);

  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor on a fresh backlog exits 0', doc, 0);
  T.check('ok is true', doc.json && doc.json.ok === true, JSON.stringify(doc.json && doc.json.ok));
  T.check('problems[] is empty',
    doc.json && Array.isArray(doc.json.problems) && doc.json.problems.length === 0,
    JSON.stringify(doc.json && doc.json.problems));
}

/* ---- incomplete:* is a workflow state, never a doctor finding ---------- */
{
  const d = H.freshDir('ac19-incomplete');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  H.runNj(['new', '--type=epic', '--title=A'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=T'], { cwd: d });

  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor still exits 0 with incomplete elements present', doc, 0);
  const codes = ((doc.json && doc.json.problems) || []).map(p => p.code);
  T.check('no incomplete:* in doctor problems[]',
    !codes.some(c => c.startsWith('incomplete:')),
    JSON.stringify(codes));

  /* But they must be visible where they belong. */
  const list = H.runJson(['list'], { cwd: d });
  const task = ((list.json && list.json.entries) || []).find(e => e.id === 'TSK-001');
  T.check('incomplete:acceptance is in list _problems',
    task && (task._problems || []).includes('incomplete:acceptance'),
    JSON.stringify(task && task._problems));
  T.check('incomplete:description is in list _problems',
    task && (task._problems || []).includes('incomplete:description'),
    JSON.stringify(task && task._problems));

  const listText = H.runNj(['list'], { cwd: d });
  T.contains('list marks the incomplete element', listText.stdout, 'incomplete:');
}

/* ---- unknown status: a warning finding, printed, exit 0 --------------- */
{
  const d = H.mkBacklog({
    label: 'ac19-unknown',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'A', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# A\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'blocked-on-review', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# T\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('a warning alone exits 0', doc, 0);
  const p = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'unknown:status');
  T.check('unknown:status is a finding', p.length === 1,
    JSON.stringify((doc.json && doc.json.problems) || []));
  T.eq('unknown:status severity is warning', p[0] && p[0].severity, 'warning');
  T.eq('unknown:status names the element', p[0] && p[0].element, 'TSK-001');
  /* The word WARNING belongs to § 14's human format; the --json run above
   * carries `severity: "warning"` instead. Assert each in its own form. */
  const docHuman = H.runNj(['doctor'], { cwd: d });
  T.exit('the human form also exits 0 (a warning is not an error)', docHuman, 0);
  T.contains('the warning is printed', docHuman.stdout, 'WARNING');
  T.check('ok stays true', doc.json && doc.json.ok === true);
}

/* ---- duplicate ID: exit 2 -------------------------------------------- */
{
  const d = H.mkBacklog({
    label: 'ac19-dupe',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'One',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# One\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n'),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Two',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Two\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['TSK-001', 'TSK-002'],
  });

  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('a duplicate ID exits 2', doc, 2);
  const p = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'duplicate_id');
  T.check('duplicate_id is reported', p.length >= 1,
    JSON.stringify((doc.json && doc.json.problems) || []));
  T.eq('duplicate_id severity is error', p[0] && p[0].severity, 'error');

  /* Reads show both entries, marked. */
  const list = H.runJson(['list'], { cwd: d });
  const dupes = ((list.json && list.json.entries) || []).filter(e => e.id === 'TSK-001');
  T.check('reads show both entries carrying the duplicated id', dupes.length === 2,
    'entries with id TSK-001: ' + dupes.length);
  T.check('both are marked duplicate_id',
    dupes.every(e => (e._problems || []).includes('duplicate_id')),
    JSON.stringify(dupes.map(e => e._problems)));
}

T.finish();
