'use strict';
/* AC-4 — Incompleteness.
 *
 * § 15.4: "**Incompleteness.** A task without description or acceptance
 * criteria is excluded from `--ready`, marked in `list`, carries the code in
 * `_problems`, and every write on it emits the hint. Epics need only a
 * description."
 *
 * § 7 defines the level: a `task`/`subtask` is Incomplete when its
 * `## Description` section or its acceptance section is absent or empty; an
 * `epic` is Incomplete when its `## Description` is absent or empty.
 */
const H = require('../lib/harness.js');
const T = H.T;
const fs = require('fs');
const path = require('path');

const C = H.FIXED_NOW;
const TASK_PATH = d => path.join(d, 'backlog', 'tasks', 'TSK-001.md');

function entriesOf(r) { return (r.json && Array.isArray(r.json.entries)) ? r.json.entries : []; }
function findBy(r, id) { return entriesOf(r).find(e => e.id === id) || null; }
function sortedCodes(e) {
  return (e && Array.isArray(e._problems)) ? e._problems.slice().sort().join(',') : null;
}

const BOTH = 'incomplete:acceptance,incomplete:description';

const d = H.mkBacklog({
  label: 'ac04',
  files: {
    // An epic with a description and no acceptance section: § 7 exempts epics.
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Platform', status: 'todo',
      created: C, updated: C,
    }, '# Platform\n\n## Description\nGroundwork for everything.\n'),
    // An epic without a description: `incomplete:description`, no acceptance code.
    'epics/EPIC-002.md': H.element({
      id: 'EPIC-002', type: 'epic', title: 'Bare epic', status: 'todo',
      created: C, updated: C,
    }, '# Bare epic\n'),
    // The element under test: neither section, so both codes.
    'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Login route',
      status: 'todo', created: C, updated: C,
    }, '# Login route\n'),
    // Control: a complete task, same status, no dependencies.
    'tasks/TSK-002.md': H.element({
      id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Registration',
      status: 'todo', created: C, updated: C,
    }, '# Registration\n\n## Description\nDo the thing.\n\n' +
      '## Acceptance Criteria\n- [ ] It works\n'),
  },
  tombstones: ['EPIC-001', 'EPIC-002', 'TSK-001', 'TSK-002'],
});

/* ---- the codes --------------------------------------------------------- */

const list = H.runJson(['list'], { cwd: d });
T.exit('list --json', list, 0);
T.eq('a task with neither section carries both codes',
  sortedCodes(findBy(list, 'TSK-001')), BOTH);
T.check('the incomplete task is still listed', findBy(list, 'TSK-001') !== null);
T.check('the complete control task carries no code',
  sortedCodes(findBy(list, 'TSK-002')) === '', JSON.stringify(findBy(list, 'TSK-002')));
T.check('an epic with only a description is complete (§ 7 exemption)',
  sortedCodes(findBy(list, 'EPIC-001')) === '', JSON.stringify(findBy(list, 'EPIC-001')));
T.check('an epic without a description is incomplete',
  sortedCodes(findBy(list, 'EPIC-002')) === 'incomplete:description',
  JSON.stringify(findBy(list, 'EPIC-002')));

/* ---- exclusion from --ready -------------------------------------------- */

const ready = H.runJson(['list', '--ready'], { cwd: d });
T.exit('list --ready --json', ready, 0);
const readyIds = new Set(entriesOf(ready).map(e => e.id));
T.check('the incomplete task is excluded from --ready', !readyIds.has('TSK-001'),
  'ready: ' + Array.from(readyIds).join(','));
T.check('the incomplete epic is excluded from --ready', !readyIds.has('EPIC-002'),
  'ready: ' + Array.from(readyIds).join(','));
T.check('the complete control task is ready', readyIds.has('TSK-002'),
  'ready: ' + Array.from(readyIds).join(','));
T.check('the epic with a description is ready', readyIds.has('EPIC-001'),
  'ready: ' + Array.from(readyIds).join(','));

/* ---- marked in list ---------------------------------------------------- */

const listHuman = H.runNj(['list'], { cwd: d });
T.exit('list', listHuman, 0);
// AMBIGUOUS: § 15.4 says the element is "marked in list" without pinning the
// mark. Asserted as: the human listing names the element and flags its
// incompleteness (either as the code or as prose).
T.check('the incomplete task is marked in list',
  !listHuman.missing && listHuman.stdout.indexOf('TSK-001') >= 0 &&
  /incomplete|not complete|missing/i.test(listHuman.stdout),
  'stdout: ' + JSON.stringify(listHuman.stdout.slice(0, 400)));

/* ---- every write emits the hint on stdout ------------------------------ */

const writes = [
  { label: 'set --priority', args: ['set', '--id=TSK-001', '--priority=high'] },
  { label: 'set --status', args: ['set', '--id=TSK-001', '--status=doing'] },
  { label: 'note', args: ['note', '--id=TSK-001', 'a note is not a description'] },
  { label: 'set --status (back to the initial state)', args: ['set', '--id=TSK-001', '--status=todo'] },
];
for (const w of writes) {
  const r = H.runNj(w.args, { cwd: d });
  T.exit('nj ' + w.label + ' on an incomplete element', r, 0);
  // AMBIGUOUS: the wording of the hint is not pinned — § 9's example is
  // "⚠ TSK-009 has no acceptance criteria. Add them before starting." Asserted
  // as: stdout mentions the acceptance requirement (prose or the code itself),
  // and it is on stdout, as § 15.4 requires.
  T.check('nj ' + w.label + ' emits the hint on stdout',
    !r.missing && /acceptance/i.test(r.stdout),
    'stdout: ' + JSON.stringify(r.stdout.slice(0, 400)));
}

T.contains('nj note appended under ## Notes', fs.readFileSync(TASK_PATH(d), 'utf8'), '## Notes');

/* ---- a write does not launder the codes -------------------------------- */

const after = H.runJson(['list'], { cwd: d });
T.exit('list --json after the writes', after, 0);
T.eq('a note does not satisfy the description requirement (§ 10)',
  sortedCodes(findBy(after, 'TSK-001')), BOTH);

// `urgent` is a real change from the `high` written above: a write that changes
// nothing may legitimately report an empty `changed` (AMBIGUITIES.md #13), and
// this assertion is about a write that does change a field.
const writeResult = H.runJson(['set', '--id=TSK-001', '--priority=urgent'], { cwd: d });
T.exit('set --json', writeResult, 0);
T.eq('the write result repeats the codes in _problems',
  writeResult.json && Array.isArray(writeResult.json._problems)
    ? writeResult.json._problems.slice().sort().join(',') : null, BOTH);
T.check('the write result carries the element',
  !!writeResult.json && !!writeResult.json.entry && writeResult.json.entry.id === 'TSK-001',
  JSON.stringify(writeResult.json && writeResult.json.entry));
T.eq('the write result lists exactly the changed field',
  writeResult.json && writeResult.json.changed, ['priority']);

const readyAgain = H.runJson(['list', '--ready'], { cwd: d });
T.exit('list --ready --json after the writes', readyAgain, 0);
T.check('the element is still excluded from --ready while incomplete',
  !new Set(entriesOf(readyAgain).map(e => e.id)).has('TSK-001'),
  'ready: ' + entriesOf(readyAgain).map(e => e.id).join(','));

T.finish();
