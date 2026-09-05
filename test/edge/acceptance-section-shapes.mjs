/* Edge — what counts as a present acceptance section (§ 7).
 *
 * § 7: "A section counts as present only if it exists and contains at least
 *  one non-empty line below the heading (a heading followed by nothing does
 *  not count ...). Headings are level-2 (## ), matched case-insensitively
 *  against the configured names; a trailing ':' is tolerated."
 *
 * ac-05 covers the empty and whitespace-only cases. This file probes the
 * boundary from the other side: shapes that are unusual but that the spec's
 * literal rule ("at least one non-empty line") does count as present.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const CASES = [
  { name: 'heading followed directly by a sub-heading', keep: true,
    body: '## Acceptance Criteria\n### Detail\n' },
  { name: 'heading followed by a list item', keep: true,
    body: '## Acceptance Criteria\n- [ ] something\n' },
  { name: 'heading followed by a bare prose line', keep: true,
    body: '## Acceptance Criteria\nIt must work.\n' },
  { name: 'heading followed by only blank lines', keep: false,
    body: '## Acceptance Criteria\n\n\n   \n' },
  { name: 'heading at EOF with no newline', keep: false,
    body: '## Acceptance Criteria' },
  { name: 'heading present with a trailing colon', keep: true,
    body: '## Acceptance Criteria:\n- [ ] x\n' },
  { name: 'heading in a different case', keep: true,
    body: '## acceptance criteria\n- [ ] x\n' },
];

for (const c of CASES) {
  const d = H.mkBacklog({
    label: 'edge-acc-shape',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Shape',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Shape\n\n## Description\nD\n\n' + c.body),
    },
    tombstones: ['TSK-001'],
  });

  const list = H.runJson(['list'], { cwd: d });
  const e = ((list.json && list.json.entries) || []).find(x => x.id === 'TSK-001');
  const probs = (e && e._problems) || [];
  const flagged = probs.includes('incomplete:acceptance');
  T.check(c.name + ' → ' + (c.keep ? 'counts as present' : 'counts as incomplete'),
    flagged === !c.keep,
    'incomplete:acceptance present: ' + flagged + ', _problems: ' + JSON.stringify(probs));
}

/* The configured heading names are configurable (§ 5): a German backlog
 * renames the heading and the completeness check keeps working. */
{
  const d = H.mkBacklog({
    label: 'edge-acc-config',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'done'],
      sections: {
        description: ['Beschreibung'],
        acceptance: ['Akzeptanzkriterien', 'Acceptance Criteria'],
      },
    }, null, 2) + '\n',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Deutsch',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Deutsch\n\n## Beschreibung\nD\n\n## Akzeptanzkriterien\n- [ ] x\n'),
    },
    tombstones: ['TSK-001'],
  });

  const list = H.runJson(['list'], { cwd: d });
  const e = ((list.json && list.json.entries) || []).find(x => x.id === 'TSK-001');
  const probs = (e && e._problems) || [];
  T.check('renamed headings satisfy the completeness check',
    !probs.includes('incomplete:acceptance') && !probs.includes('incomplete:description'),
    JSON.stringify(probs));
}

T.finish();
