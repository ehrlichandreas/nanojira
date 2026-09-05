/* AC-5 — Empty sections.
 *
 * § 15.5: "**Empty sections.** An empty or whitespace-only
 * `## Acceptance Criteria` counts as incomplete; a heading followed by nothing
 * never counts as present."
 *
 * § 7 pins the matching rule: "A section counts as present only if it exists
 * **and** contains at least one non-empty line below the heading (a heading
 * followed by nothing does not count …). Headings are level-2 (`## `), matched
 * case-insensitively against the configured names; a trailing `:` is
 * tolerated."
 *
 * Every probe below is one task in one backlog; the body differs only in the
 * section shape.
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

const C = H.FIXED_NOW;

function entriesOf(r) { return (r.json && Array.isArray(r.json.entries)) ? r.json.entries : []; }
function sortedCodes(e) {
  return (e && Array.isArray(e._problems)) ? e._problems.slice().sort().join(',') : null;
}

const DESCR = '## Description\nDo the thing.\n';
const ACCEPT = '## Acceptance Criteria\n- [ ] It works\n';

/* id, what the body does, body after the H1, expected codes (sorted) */
const PROBES = [
  ['TSK-001', 'acceptance heading followed by nothing (end of file)',
    DESCR + '## Acceptance Criteria\n', 'incomplete:acceptance'],
  ['TSK-002', 'acceptance heading followed by whitespace only',
    DESCR + '## Acceptance Criteria\n   \n\t\n\n', 'incomplete:acceptance'],
  ['TSK-003', 'acceptance heading followed by a real line',
    DESCR + ACCEPT, ''],
  ['TSK-004', 'lower-case acceptance heading is matched',
    DESCR + '## acceptance criteria\n- [ ] It works\n', ''],
  ['TSK-005', 'trailing colon on the acceptance heading is tolerated',
    DESCR + '## Acceptance Criteria:\n- [ ] It works\n', ''],
  // AMBIGUOUS (AMBIGUITIES.md #16): the spec does not spell out whether lines
  // under a *later* level-2 heading count for an earlier section; the
  // section-scoped reading (a section ends at the next heading, so acceptance
  // is empty here) is chosen — it is the only reading under which an empty
  // `## Acceptance Criteria` stays a real gate.
  ['TSK-006', 'acceptance heading followed by another heading with content below',
    DESCR + '## Acceptance Criteria\n\n## Notes\n- a note\n', 'incomplete:acceptance'],
  ['TSK-007', 'a level-3 heading is not a section heading (§ 7: level-2 only)',
    DESCR + '### Acceptance Criteria\n- [ ] It works\n', 'incomplete:acceptance'],
  ['TSK-008', 'description heading followed by whitespace only',
    '## Description\n   \n\n' + ACCEPT, 'incomplete:description'],
  ['TSK-009', 'lower-case description heading with a trailing colon is matched',
    '## description:\nDo the thing.\n\n' + ACCEPT, ''],
];

const files = {
  'epics/EPIC-001.md': H.element({
    id: 'EPIC-001', type: 'epic', title: 'Platform', status: 'todo',
    created: C, updated: C,
  }, '# Platform\n\n## Description\nGroundwork for everything.\n'),
};
const tombstones = ['EPIC-001'];

PROBES.forEach(([id, , tail], i) => {
  const title = 'Section probe ' + (i + 1);
  files['tasks/' + id + '.md'] = H.element({
    id, type: 'task', parent: 'EPIC-001', title, status: 'todo',
    created: C, updated: C,
  }, '# ' + title + '\n\n' + tail);
  tombstones.push(id);
});

const d = H.mkBacklog({ label: 'ac05', files, tombstones });

const list = H.runJson(['list'], { cwd: d });
T.exit('list --json', list, 0);
const byId = new Map(entriesOf(list).map(e => [e.id, e]));

const ready = H.runJson(['list', '--ready'], { cwd: d });
T.exit('list --ready --json', ready, 0);
const readyIds = new Set(entriesOf(ready).map(e => e.id));

for (const [id, what, , expected] of PROBES) {
  const got = sortedCodes(byId.get(id));
  T.check(id + ' — ' + what + ' → ' + (expected || 'complete'), got === expected,
    'expected ' + JSON.stringify(expected) + '\n     got      ' + JSON.stringify(got));
  T.check(id + ' — ' + (expected ? 'excluded from' : 'included in') + ' --ready',
    expected ? !readyIds.has(id) : readyIds.has(id),
    'ready: ' + Array.from(readyIds).join(','));
}

/* A write must not invent content for an empty section. */
{
  const r = H.runNj(['set', '--id=TSK-001', '--priority=high'], { cwd: d });
  T.exit('set --priority on an empty-section element', r, 0);
  const after = H.runJson(['list'], { cwd: d });
  T.exit('list --json after the write', after, 0);
  const e = entriesOf(after).find(x => x.id === 'TSK-001');
  T.check('an empty acceptance section survives a write as incomplete',
    sortedCodes(e) === 'incomplete:acceptance', JSON.stringify(e && e._problems));
}

T.finish();
