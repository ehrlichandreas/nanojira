/* Edge — tombstone burn: a deleted ID is never reallocated (§ 8, § 15 AC-8).
 *
 * § 8: "IDs are never reused — provided `.nanojira/ids/` is preserved. ... `nj archive`
 * and `nj rm` leave tombstones in place — the ID stays claimed forever...
 * The allocator computes only a start value — the highest number found across
 * `.nanojira/ids/` *and* all element files (active and archive) — and probes upward
 * from there with `O_CREAT|O_EXCL`."
 *
 * § 15 AC-8: "Archive 50 elements and delete 10; create one of the same type;
 * the new ID is 51 (or the next free number above every tombstone)."
 *
 * Correction: `ac/ac-08-id-immortality.js` already deletes TSK-041..050 — the
 * ten *highest* of fifty — and confirms the next allocation is TSK-051, so
 * "delete the highest, verify the next create skips it" is not a gap this
 * file closes; at that scale it is largely redundant with AC-8. What this
 * file adds on top, kept deliberately small so the redundant part stays
 * cheap to run and to read:
 *
 *   1. an isolated `rm`-only reproduction with no `archive` in the mix, so a
 *      failure here points at the allocator/rm path specifically rather than
 *      at their interaction;
 *   2. a pin on the tombstone's actual bytes — § 8 calls it "an empty
 *      tombstone file", and AC-8 checks only that the tombstone *exists*,
 *      never that it is empty.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const bl = (d: string) => path.join(d, 'backlog');
const tasksOf = (d: string) => H.lsOrEmpty(path.join(bl(d), 'tasks'));
const idsOf = (d: string) => H.lsOrEmpty(path.join(bl(d), H.IDS_REL)).filter(f => /^TSK-/.test(f));

function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
    },
    tombstones: ['EPIC-001'],
  });
}

const d = fixture('edge-tombstone-burn');

/* Two tasks, created through `nj new` so the real allocator runs. */
const n1 = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=First',
  '--description=D', '--acceptance=A'], { cwd: d });
T.exit('create the first task', n1, 0);
T.eq('the first task is TSK-001', n1.json && n1.json.id, 'TSK-001');

const n2 = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Second',
  '--description=D', '--acceptance=A'], { cwd: d });
T.exit('create the second task', n2, 0);
T.eq('the second task is TSK-002', n2.json && n2.json.id, 'TSK-002');

T.eq('two tombstones exist before the burn', JSON.stringify(idsOf(d)),
  JSON.stringify(['TSK-001', 'TSK-002']));

/* Burn the highest number: remove TSK-002 (a leaf, no children). */
const rm = H.runJson(['rm', '--id=TSK-002'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
T.exit('remove the second task', rm, 0);
T.check('rm reports ok:true', rm.json && rm.json.ok === true, JSON.stringify(rm.json));

T.eq('the task file is gone', JSON.stringify(tasksOf(d)), JSON.stringify(['TSK-001.md']));
T.eq('the tombstone remains — the ID stays claimed forever',
  JSON.stringify(idsOf(d)), JSON.stringify(['TSK-001', 'TSK-002']));
const tombstoneBytes = H.readOrNull(path.join(bl(d), H.IDS_REL, 'TSK-002'));
T.eq('the tombstone is an empty file (§ 8: an empty tombstone file)', tombstoneBytes, '');

/* The next task of the same type must skip the burned number entirely. */
const n3 = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Third',
  '--description=D', '--acceptance=A'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
T.exit('create the third task', n3, 0);
T.eq('the third task is TSK-003, not the burned TSK-002', n3.json && n3.json.id, 'TSK-003');

T.eq('two task files exist, TSK-002 is not resurrected',
  JSON.stringify(tasksOf(d)), JSON.stringify(['TSK-001.md', 'TSK-003.md']));
T.eq('three tombstones exist, in never-reuse order',
  JSON.stringify(idsOf(d)), JSON.stringify(['TSK-001', 'TSK-002', 'TSK-003']));

const body3 = H.readOrNull(path.join(bl(d), 'tasks', 'TSK-003.md'));
T.check('the new file carries its own id in the frontmatter',
  body3 !== null && body3.includes('id: TSK-003'), JSON.stringify(body3));

T.finish();
