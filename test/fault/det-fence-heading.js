'use strict';
/* Determinism — the fence limitation, pinned (§ 7 Body).
 *
 * § 7: "Section matching is line-based and **not** fenced-code-aware: a
 * `## Description` line inside a fenced block is a section heading for reads
 * and writes alike, so a section write replaces that region and destroys the
 * fence content. Fence-aware matching is deliberately out of scope for round
 * one."
 *
 * A disclosed limitation is still a contract: a refactor that quietly becomes
 * fence-aware changes bytes on disk and completeness verdicts. Both sides are
 * pinned here — the read (the fenced heading counts as the section) and the
 * write (the region up to the next level-2 heading is replaced, closing fence
 * included; § 9 "first match wins").
 */
const path = require('path');
const fs = require('fs');
const H = require('../lib/harness.js');
const T = H.T;

const TASK = 'tasks/TSK-001.md';

const fm = updated => ({
  id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo',
  created: H.FIXED_NOW, updated,
});

function fixture(label, body) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# E\n\n## Description\nD\n'),
      [TASK]: H.element(fm(H.FIXED_NOW), body),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

const FENCED_ONLY =
  '# T\n\n```md\n## Description\ninside the fence\n```\n\n## Acceptance Criteria\n- [ ] x\n';

/* ---- read: the fenced heading IS the description section ---------------- */
{
  const d = fixture('det-fence-read', FENCED_ONLY);
  const r = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('read: show exits 0', r, 0);
  const entry = r.json && r.json.entries && r.json.entries[0];
  T.eq('read: the fenced heading counts as a present description — no incomplete:*',
    entry && entry._problems, []);
}

/* ---- write: the fenced region is replaced, closing fence destroyed ------ */
{
  const d = fixture('det-fence-write', FENCED_ONLY);
  const r = H.runJson(['set', '--id=TSK-001', '--description=NEW'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('write: set exits 0', r, 0);
  T.check('write: changed names the role', r.json && r.json.changed.includes('description'),
    JSON.stringify(r.json && r.json.changed));
  const want = H.element(fm(H.LATER_NOW),
    '# T\n\n```md\n## Description\nNEW\n\n## Acceptance Criteria\n- [ ] x\n');
  const got = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  T.eq('write: region up to the next level-2 heading replaced, closing ``` gone', got, want);
}

/* ---- write: fenced heading first, real heading later — first match wins - */
{
  const d = fixture('det-fence-first',
    '# T\n\n```md\n## Description\ninside the fence\n```\n\n## Description\nreal one\n\n' +
    '## Acceptance Criteria\n- [ ] x\n');
  const r = H.runJson(['set', '--id=TSK-001', '--description=NEW'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('first match: set exits 0', r, 0);
  const want = H.element(fm(H.LATER_NOW),
    '# T\n\n```md\n## Description\nNEW\n\n## Description\nreal one\n\n' +
    '## Acceptance Criteria\n- [ ] x\n');
  const got = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  T.eq('first match: the fenced heading is written, the real one untouched', got, want);
}

T.finish();
