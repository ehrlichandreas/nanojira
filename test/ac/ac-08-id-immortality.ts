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
 *
 * Why S1-S3 below (TSK-049): in the scenario above every id ever allocated
 * left its tombstone, so the tombstones are dense 1..50 and the O_EXCL
 * claim walks up past every one of them. A start value that ignores the
 * tombstones, the element files or only the archived ones lands on 51 all
 * the same: the scenario cannot see which of the three sources the
 * allocator reads. It only fails when both halves break (a tombstone lost,
 * or no O_EXCL). S1-S3 each give one source a number above the other two
 * with a gap below it, so dropping that source from the start value hands
 * out a lower, free id. Their fixtures are written by hand (§ 6 makes the
 * folder the user's), as an untombstoned element file or a lone tombstone
 * arrives with a copied file or a merge.
 *
 * Speed (TSK-049): the 50 tasks come from one `new --input=-` plan (the
 * same allocator, one id per node) and the 40 `set --status=done` are one
 * batch write (AC-31); rm takes one id per call and stays one call per id.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const d = H.freshDir('ac08');
const pad = (i: number) => String(i).padStart(3, '0');

T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
T.exit('epic E1', H.runNj(['new', '--type=epic', '--title=E1'], { cwd: d }), 0);
T.exit('epic E2 (parent for the new task)',
  H.runNj(['new', '--type=epic', '--title=E2'], { cwd: d }), 0);

{
  const plan = Array.from({ length: 50 }, (_, i) => ({ type: 'task', parent: 'EPIC-001', title: 'T' + (i + 1) }));
  const r = H.runJson(['new', '--input=-'], { cwd: d, input: JSON.stringify(plan) });
  const got = (r.json && r.json.ids) || [];
  for (let i = 1; i <= 50; i++) {
    if (got[i - 1] !== 'TSK-' + pad(i)) { T.check('created TSK-' + pad(i), false, r.stderr + JSON.stringify(got)); break; }
  }
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
  const id = 'TSK-' + pad(i);
  const r = H.runNj(['rm', '--id=' + id], { cwd: d });
  if (r.status !== 0) T.check('rm ' + id, false, r.stderr);
}
T.eq('40 task files remain',
  String(H.lsOrEmpty(tasksDir).filter(f => f.endsWith('.md')).length), '40');

/* The 10 deleted IDs must survive as tombstones — that is the whole point. */
const idsDir = path.join(d, 'backlog', H.IDS_REL);
const tombstones = H.lsOrEmpty(idsDir);
for (let i = 41; i <= 50; i++) {
  const id = 'TSK-' + pad(i);
  T.check('tombstone survives rm for ' + id, tombstones.includes(id));
}

/* ---- archive the surviving 40 as a subtree ----------------------------- */
{
  const ids = Array.from({ length: 40 }, (_, i) => 'TSK-' + pad(i + 1));
  const r = H.runJson(['set', '--id=' + ids.join(','), '--status=done'], { cwd: d });
  const results: any[] = (r.json && r.json.results) || [];
  for (const id of ids) {
    const one = results.find((x) => x.id === id);
    if (!one || one.ok !== true) T.check('set ' + id + ' done', false, r.stderr + JSON.stringify(one));
  }
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

/* ---- S1-S3: each source of the start value on its own (see the header) - */
const NOW = H.FIXED_NOW;
const epic = H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW },
  '# E\n\n## Description\nD.\n');
const task = (id: string, extra?: Record<string, string>) => H.element(
  Object.assign({ id, type: 'task', parent: 'EPIC-001', title: id, status: 'todo', created: NOW, updated: NOW }, extra || {}),
  H.completeBody(id));
const SOURCES: [string, string, Record<string, string>, string[], string][] = [
  ['S1 a lone tombstone (TSK-200) above every element file', 's1',
    { 'tasks/TSK-001.md': task('TSK-001') }, ['TSK-001', 'TSK-200'], 'TSK-201'],
  ['S2 an active element file without a tombstone (TSK-300) above every tombstone', 's2',
    { 'tasks/TSK-001.md': task('TSK-001'), 'tasks/TSK-300.md': task('TSK-300') }, ['TSK-001'], 'TSK-301'],
  ['S3 an archived element file without a tombstone (TSK-400) above every tombstone', 's3',
    { 'tasks/TSK-001.md': task('TSK-001'), 'archive/TSK-400.md': task('TSK-400', { status: 'done', archived: NOW }) }, ['TSK-001'], 'TSK-401'],
];
await H.runLegs(SOURCES.map(([desc, label, files, tombs, want]) => async (t: H.BufferedContext) => {
  const x = H.mkBacklog({ label: 'ac08-' + label, files: Object.assign({ 'epics/EPIC-001.md': epic }, files), tombstones: ['EPIC-001'].concat(tombs) });
  const r = await H.runJsonAsync(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: x });
  t.exit(desc + ': nj new exits 0', r, 0);
  t.eq(desc + ': the new ID is the next number above it', r.json && r.json.id, want);
  t.check(desc + ': and its tombstone was claimed', fs.existsSync(path.join(x, 'backlog', H.IDS_REL, want)), want);
}));

T.finish();
