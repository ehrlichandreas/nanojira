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
import path from 'path';
import fs from 'fs';
import * as H from '../lib/harness.ts';
const T = H.T;

const TASK = 'tasks/TSK-001.md';

const fm = (updated: string) => ({
  id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo',
  created: H.FIXED_NOW, updated,
});

function fixture(label: string, body: string) {
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

/* ---- write: the region's own end (the next level-2 heading) sits past   */
/*      the fence's closing delimiter, which is inside the replaced span   */
/*      -- so replacing it strands the opener with nothing left to close   */
/*      it. That RESULT leaves a fence open from the opener to EOF, the    */
/*      exact shape TSK-053 v2 (DECISIONS 233) refuses, rather than        */
/*      silently writing a file where every later section is invisible to  */
/*      `check`'s own continuous fence scan. § 7's "destroys the fence     */
/*      content" byte rule still describes what the splice itself would    */
/*      produce; it no longer describes what reaches disk, because this    */
/*      is exactly the result TSK-053 v2 now refuses before it is written. */
{
  const d = fixture('det-fence-write', FENCED_ONLY);
  const before = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  const r = H.runJson(['set', '--id=TSK-001', '--description=NEW'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('write: set refuses (TSK-053 v2): exit 1', r, 1);
  T.eq('write: refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  const got = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  T.eq('write: nothing written -- file is byte-identical to before', got, before);
}

/* ---- write: fenced heading first, real heading later — same shape,      */
/*      same refusal: the fake heading's own span still strands the        */
/*      opener with no closer before the result's next boundary.          */
{
  const d = fixture('det-fence-first',
    '# T\n\n```md\n## Description\ninside the fence\n```\n\n## Description\nreal one\n\n' +
    '## Acceptance Criteria\n- [ ] x\n');
  const before = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  const r = H.runJson(['set', '--id=TSK-001', '--description=NEW'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('first match: set refuses (TSK-053 v2): exit 1', r, 1);
  T.eq('first match: refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  const got = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
  T.eq('first match: nothing written -- file is byte-identical to before', got, before);
}

T.finish();
