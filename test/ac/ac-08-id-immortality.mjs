/* AC-8 — ID immortality.
 *
 * "Archive 50 elements and delete 10; create one of the same type; the new ID
 *  is 51 (or the next free number above every tombstone)."
 *
 * The normative part is the parenthesis: the allocator's start value is the
 * highest number across .nanojira/ids/ and all element files (active and archive), and
 * O_CREAT|O_EXCL does the claiming. The test therefore asserts the ID is above
 * every tombstone rather than pinning the literal 51 — but it also pins 51,
 * because in this setup that is what the rule yields.
 *
 * Layout note: the 40 survivors are archived as a whole subtree (the epic with
 * them) so that the run does not trip archive:split, which is a different
 * criterion and would make this test fail for the wrong reason.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const d = H.freshDir('ac08');

T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
T.exit('epic E1', H.runNj(['new', '--type=epic', '--title=E1'], { cwd: d }), 0);
T.exit('epic E2 (parent for the new task)',
  H.runNj(['new', '--type=epic', '--title=E2'], { cwd: d }), 0);

for (let i = 1; i <= 50; i++) {
  const r = H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: d });
  if (r.status !== 0) { T.check('created TSK-' + String(i).padStart(3, '0'), false, r.stderr); break; }
}

const tasksDir = path.join(d, 'backlog', 'tasks');
const before = H.lsOrEmpty(tasksDir).filter(f => f.endsWith('.md')).sort();
T.eq('50 tasks allocated', String(before.length), '50');
T.eq('IDs run TSK-001 … TSK-050',
  (before.length ? before[0].replace('.md', '') : '(none)') + ' … ' +
  (before.length ? before[before.length - 1].replace('.md', '') : '(none)'),
  'TSK-001 … TSK-050');

/* ---- delete 10 -------------------------------------------------------- */
for (let i = 41; i <= 50; i++) {
  const id = 'TSK-' + String(i).padStart(3, '0');
  const r = H.runNj(['rm', '--id=' + id], { cwd: d });
  if (r.status !== 0) T.check('rm ' + id, false, r.stderr);
}
T.eq('40 task files remain',
  String(H.lsOrEmpty(tasksDir).filter(f => f.endsWith('.md')).length), '40');

/* The 10 deleted IDs must survive as tombstones — that is the whole point. */
const idsDir = path.join(d, 'backlog', H.IDS_REL);
const tombstones = H.lsOrEmpty(idsDir);
for (let i = 41; i <= 50; i++) {
  const id = 'TSK-' + String(i).padStart(3, '0');
  T.check('tombstone survives rm for ' + id, tombstones.includes(id));
}

/* ---- archive the surviving 40 as a subtree ----------------------------- */
for (let i = 1; i <= 40; i++) {
  const id = 'TSK-' + String(i).padStart(3, '0');
  const r = H.runNj(['set', '--id=' + id, '--status=done'], { cwd: d });
  if (r.status !== 0) T.check('set ' + id + ' done', false, r.stderr);
}
T.exit('set EPIC-001 done', H.runNj(['set', '--id=EPIC-001', '--status=done'], { cwd: d }), 0);

const rArch = H.runNj(['archive', '--id=EPIC-001'], { cwd: d });
T.exit('archive the subtree', rArch, 0);
T.eq('no task files left active',
  String(H.lsOrEmpty(tasksDir).filter(f => f.endsWith('.md')).length), '0');
T.eq('41 elements in the archive',
  String(H.lsOrEmpty(path.join(d, 'backlog', 'archive')).filter(f => f.endsWith('.md')).length), '41');

/* ---- the new element must not recycle ---------------------------------- */
const rNew = H.runNj(['new', '--type=task', '--parent=EPIC-002', '--title=After archive'],
  { cwd: d });
T.exit('nj new after archive+rm', rNew, 0);

const active = H.lsOrEmpty(tasksDir).filter(f => f.endsWith('.md'));
T.eq('exactly one new task', String(active.length), '1');

const newId = active[0] ? active[0].replace('.md', '') : '(none)';
T.eq('new ID is TSK-051', newId, 'TSK-051');

/* The allocation under test claims its own tombstone, so that tombstone is in
 * .nanojira/ids/ by the time we look. Counting it would make `newNum > highest` a
 * comparison of the ID with itself — the claim is that the allocator started
 * above every tombstone that existed *before* this allocation. */
const priorTombstones = H.lsOrEmpty(idsDir)
  .filter(f => /^TSK-\d+$/.test(f) && f !== newId)
  .map(f => parseInt(f.slice(4), 10))
  .reduce((a, b) => Math.max(a, b), 0);
const newNum = parseInt(newId.slice(4), 10) || 0;
T.check('the new ID is above every tombstone that predated it', newNum > priorTombstones,
  'new ' + newId + ' vs highest prior tombstone TSK-' + priorTombstones);
T.check('and it is exactly the next number after them', newNum === priorTombstones + 1,
  'new ' + newId + ', highest prior tombstone TSK-' + priorTombstones);

T.finish();
