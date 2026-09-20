/* Edge — `doctor --fix` and the mtime snapshot, keyed by PATH (§ 14).
 *
 * § 14: "Original file mtimes are snapshotted **before step 1**, so step 5
 *  still sees the true mtime even when step 1 already rewrote the file."
 *
 * The failure this guards is a snapshot keyed by element *id* rather than by
 * file path. With two files claiming the same `id` — which § 14 explicitly
 * refuses to resolve, so `--fix` must cope with the state rather than repair it
 * — an id-keyed snapshot holds one mtime for both, and the second file silently
 * gets the first file's `created`. Nothing fails loudly: the files are valid,
 * and only the timestamp is a lie.
 *
 * Two fixtures, distinct mtimes, distinct ids in the filename, one shared
 * frontmatter id. Each file must end with its OWN created.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const p = (d: string, rel: string) => path.join(d, 'backlog', rel);

/* Two clearly distinct instants, on whole seconds so the ISO form is exact
 * and a comparison cannot fail on sub-second rounding. */
const T_A = new Date('2026-03-04T05:06:07Z');
const T_B = new Date('2026-07-08T09:10:11Z');
const ISO_A = '2026-03-04T05:06:07Z';
const ISO_B = '2026-07-08T09:10:11Z';

/* Both files are missing `type` (so step 1 rewrites them) and `created` (so
 * step 5 fills it from the mtime). `updated` is present, so step 5 leaves it. */
function body(title: string): string {
  return '---\nid: TSK-001\nparent: EPIC-001\ntitle: ' + title + '\nstatus: todo\n' +
    'updated: ' + H.FIXED_NOW + '\n---\n\n# ' + title + '\n\n## Description\nD\n\n' +
    '## Acceptance Criteria\n- [ ] x\n';
}

const d = H.mkBacklog({ label: 'edge-fix-dup-mtimes', tombstones: ['TSK-001', 'TSK-002'] });
fs.writeFileSync(p(d, 'tasks/TSK-001.md'), body('One'));
fs.writeFileSync(p(d, 'tasks/TSK-002.md'), body('Two'));

/* Distinct mtimes, set after writing. The instant, not the content, is what
 * this test distinguishes. */
fs.utimesSync(p(d, 'tasks/TSK-001.md'), T_A, T_A);
fs.utimesSync(p(d, 'tasks/TSK-002.md'), T_B, T_B);
/* the elements came after mkBacklog: refresh the overview (spec v3 § 4) so
 * the pinned set below does not gain backlog:status_stale (DECISIONS 100) */
H.writeStatus(d);

const before = H.runJson(['doctor'], { cwd: d });
/* The complete § 7 set for this fixture, not just the duplicate: both files
 * carry `id: TSK-001` (`duplicate_id` ×2), TSK-002.md's name disagrees with
 * that id (`id:mismatch`), neither declares `type` (`type:derived` ×2) or
 * `created` (`missing:created` ×2), and EPIC-001 does not exist in this
 * fixture at all (`parent:dangling` ×2). */
T.sameSet('the fixture holds exactly § 7\'s set, duplicate id included',
  H.doctorSet(before) || ['<no problems array>'],
  ['duplicate_id:error', 'duplicate_id:error', 'id:mismatch:error',
    'type:derived:warning', 'type:derived:warning',
    'missing:created:warning', 'missing:created:warning',
    'parent:dangling:error', 'parent:dangling:error']);

const fix = H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
// § 14: "0 when no error remains, 2 when one does" — and separately, "Never
// automatically … resolve duplicate IDs". `duplicate_id` (§ 7: error) is the
// fixture's whole point and is explicitly on the never-automatically list, so
// it is guaranteed to still be present after the repair — the exit code is
// pinned at exactly 2, not tolerated as [0, 2].
T.exit('doctor --fix runs', fix, 2);

/* --fix must not have resolved the duplicate: § 14 "Never ... resolve
 * duplicate IDs". A rename would give one of them a different id. */
T.check('both files are still there',
  H.readOrNull(p(d, 'tasks/TSK-001.md')) !== null &&
  H.readOrNull(p(d, 'tasks/TSK-002.md')) !== null,
  'ls: ' + JSON.stringify(H.lsOrEmpty(p(d, 'tasks'))));

const a = H.readOrNull(p(d, 'tasks/TSK-001.md'));
const b = H.readOrNull(p(d, 'tasks/TSK-002.md'));

/* The heart of it: two paths, one shared id, two mtimes — two `created`. */
T.contains('file A got its own created (not the other file\'s)',
  a || '', 'created: ' + ISO_A);
T.contains('file B got its own created (not the other file\'s)',
  b || '', 'created: ' + ISO_B);
T.check('file A did not receive file B\'s mtime', !(a || '').includes(ISO_B),
  JSON.stringify((a || '').slice(0, 240)));
T.check('file B did not receive file A\'s mtime', !(b || '').includes(ISO_A),
  JSON.stringify((b || '').slice(0, 240)));

/* Step 1 also rewrote them, so this is a real before/after, not a no-op. */
T.contains('file A got its missing type from the ID prefix', a || '', 'type: task');
T.contains('file B got its missing type from the ID prefix', b || '', 'type: task');

/* And the duplicate is still reported afterwards — the fix repaired what it
 * may repair and left the ambiguity alone. */
const after = H.runJson(['doctor'], { cwd: d });
T.exit('doctor still exits 2 on the unresolved duplicate', after, 2);
T.check('duplicate_id is still reported',
  ((after.json && after.json.problems) || []).some((x: any) => x.code === 'duplicate_id'),
  JSON.stringify((after.json && after.json.problems) || []));

T.finish();
