/* Edge — `parent:cycle` reaches into the archive, not just the active tree
 * (§ 7, § 11, § 14).
 *
 * § 7 does not scope `parent:cycle` to active elements — the code table has
 * no "active only" qualifier, unlike codes that are explicitly conditioned
 * on archive placement (`archive:split`, `archive:not_done`). § 11 confirms
 * archived elements keep participating in the graph generally: "References
 * survive: a `depends_on` pointing at an archived element is satisfied by
 * definition." § 14 lists `nj doctor`'s checks without gating any of them on
 * `--all` — unlike `list`/`tree`, which § 11 explicitly says hide archived
 * elements unless `--all` is given.
 *
 * Isolated on purpose: a self-referencing archived element (status `done`,
 * so `archive:not_done` never fires) rather than a cycle that crosses the
 * active/archive boundary — crossing the boundary would also trigger
 * `archive:split` (§ 7: "part of a subtree in archive, part outside"), which
 * is a different code this file has no business asserting on.
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

const d = H.mkBacklog({
  label: 'cycle-parent-archived',
  files: {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
      created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, H.completeBody('Auth')),
    // Self-referencing, but archived and done — isolates parent:cycle from
    // archive:not_done and archive:split.
    'archive/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'TSK-001', title: 'Self-parented, archived',
      status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW, archived: H.FIXED_NOW,
    }, H.completeBody('Self-parented, archived')),
  },
  tombstones: ['EPIC-001', 'TSK-001'],
});

/* doctor scans the whole backlog, including archive/, without needing
 * --all (§ 14 gates no check on it; ac-11-archive-rules.js's doctor calls
 * for archive:split/archive:not_done already establish this convention). */
const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
T.exit('doctor with a self-referencing archived parent', doc, 2);

const problems = (doc.json && doc.json.problems) || [];
/* Two conditions, both § 7: TSK-001 points at itself (`parent:cycle`), and a
 * task whose parent is a task violates § 6's "epic → task → subtask"
 * (`parent:hierarchy`). Both are errors. */
T.sameSet('the findings are exactly § 7\'s set for this fixture',
  H.doctorSet(doc) || ['<no problems array>'],
  ['parent:cycle:error', 'parent:hierarchy:error']);
const p = problems.find(x => x.code === 'parent:cycle' && x.element === 'TSK-001');
T.check('the archived element carries its own parent:cycle finding, severity error',
  !!p && p.severity === 'error', J(p));

T.check('archive:not_done does not also fire (isolated: status is done)',
  !problems.some(x => x.code === 'archive:not_done' && x.element === 'TSK-001'),
  J(problems));
T.check('archive:split does not also fire (isolated: no active/archive boundary crossed)',
  !problems.some(x => x.code === 'archive:split' && x.element === 'TSK-001'),
  J(problems));

T.finish();
