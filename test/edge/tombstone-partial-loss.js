'use strict';
/* Edge — partial tombstone loss (§ 8).
 *
 * AC-18 covers the total loss of .ids/. The partial case is the one that is
 * easy to get wrong in the other direction: it is *not* an error.
 *
 * § 8: "An element file without a tombstone is a WARNING (id:no_tombstone):
 *  the same observable state can also be produced by partial tombstone loss,
 *  so it must surface — but a hand-drafted element is legitimate work and
 *  stays eligible for --ready."
 *
 * So: doctor reports it, doctor still exits 0 (no error finding), the element
 * remains --ready, and allocation still starts above every element number.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const d = H.mkBacklog({
  label: 'edge-partial-tombstones',
  files: {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
      created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Auth\n\n## Description\nD\n'),
    'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Has a tombstone',
      status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Has a tombstone\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    'tasks/TSK-002.md': H.element({
      id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Lost its tombstone',
      status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Lost its tombstone\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
  },
  // TSK-002 deliberately has no tombstone. .ids/ is non-empty, so this is
  // NOT backlog:ids_missing.
  tombstones: ['EPIC-001', 'TSK-001'],
});
const bl = path.join(d, 'backlog');

/* ---- it surfaces ------------------------------------------------------ */
const doc = H.runJson(['doctor'], { cwd: d });
const codes = ((doc.json && doc.json.problems) || []).map(p => p.code);
T.check('id:no_tombstone is reported', codes.includes('id:no_tombstone'),
  JSON.stringify(codes));
T.check('backlog:ids_missing is NOT reported (the directory exists)',
  !codes.includes('backlog:ids_missing'), JSON.stringify(codes));
T.eq('no error-severity finding, so doctor exits 0', doc.status, 0);

const p = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'id:no_tombstone');
T.eq('id:no_tombstone severity is warning', p[0] && p[0].severity, 'warning');
T.eq('only the element that lost its tombstone is named',
  p.map(x => x.element).join(','), 'TSK-002');

/* ---- but it does not block work --------------------------------------- */
const list = H.runJson(['list'], { cwd: d });
const t2 = ((list.json && list.json.entries) || []).find(e => e.id === 'TSK-002');
T.check('TSK-002 carries the code', t2 && (t2._problems || []).includes('id:no_tombstone'),
  JSON.stringify(t2 && t2._problems));

const ready = H.runJson(['list', '--ready'], { cwd: d });
const readyIds = ((ready.json && ready.json.entries) || []).map(e => e.id);
T.check('a hand-drafted element stays eligible for --ready', readyIds.includes('TSK-002'),
  'ready set: ' + JSON.stringify(readyIds));

/* ---- allocation still starts above every element number --------------- */
const r = H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: d });
T.exit('nj new works with a partial .ids/', r, 0);
const created = fs.readdirSync(path.join(bl, 'tasks')).filter(f => f.endsWith('.md')).sort();
T.eq('the new ID is above the highest element number', created.join(','),
  'TSK-001.md,TSK-002.md,TSK-003.md');

/* ---- --fix restores it ------------------------------------------------ */
T.check('doctor --fix runs', H.runNj(['doctor', '--fix'], { cwd: d }).status !== null);
T.check('--fix created the missing tombstone',
  fs.existsSync(path.join(bl, '.ids', 'TSK-002')));

const after = H.runJson(['doctor'], { cwd: d });
T.check('id:no_tombstone is gone after --fix',
  !((after.json && after.json.problems) || []).some(x => x.code === 'id:no_tombstone'),
  JSON.stringify((after.json && after.json.problems) || []));

T.finish();
