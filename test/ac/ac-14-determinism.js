'use strict';
/* AC-14 — Determinism.
 *
 * § 15 AC-14: "Determinism. `list`/`tree` ordering is priority-desc, id-asc,
 * stable across platforms and calls."
 *
 * § 9 "Sort order" of `list`, `tree` and bare `nj` is deterministic: priority
 * weight descending (urgent 4, high 3, normal 2, low 1, missing 2), then `id`
 * ascending. Never filesystem order.
 *
 * The fixture is written in a deliberately scrambled order, so readdir() order
 * is neither the expected one nor sorted. A missing priority weighs 2, the same
 * as `normal` — which is why TSK-003 sorts between TSK-002 and TSK-007.
 */
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

function task(id, title, priority) {
  const f = {
    id: id, type: 'task', parent: 'EPIC-001', title: title, status: 'todo',
  };
  if (priority) f.priority = priority;
  f.created = NOW;
  f.updated = NOW;
  return H.element(f, H.completeBody(title));
}

function epic(id, title, priority) {
  const f = {
    id: id, type: 'epic', title: title, status: 'todo',
  };
  if (priority) f.priority = priority;
  f.created = NOW;
  f.updated = NOW;
  return H.element(f, '# ' + title + '\n\n## Description\nSomething.\n');
}

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}

/* Files are written in this order on purpose. Note that TSK-006 is written
 * before TSK-004 although it must sort after it: anything that reports the
 * directory listing fails. */
const FILES = {
  'tasks/TSK-006.md': task('TSK-006', 'High, written first', 'high'),
  'tasks/TSK-003.md': task('TSK-003', 'No priority at all'),
  'tasks/TSK-001.md': task('TSK-001', 'Low', 'low'),
  'tasks/TSK-007.md': task('TSK-007', 'Normal', 'normal'),
  'tasks/TSK-005.md': task('TSK-005', 'Urgent', 'urgent'),
  'tasks/TSK-002.md': task('TSK-002', 'Normal, lower id', 'normal'),
  'tasks/TSK-004.md': task('TSK-004', 'High, written last', 'high'),
  'epics/EPIC-001.md': epic('EPIC-001', 'Auth', 'urgent'),
};

const TOMBSTONES = ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004',
  'TSK-005', 'TSK-006', 'TSK-007'];

/* urgent(4): TSK-005 — the epic is urgent too and EPIC-001 < TSK-005
 * high(3):   TSK-004, TSK-006
 * normal(2): TSK-002, TSK-003 (missing priority), TSK-007
 * low(1):    TSK-001 */
const EXPECTED_TASKS = ['TSK-005', 'TSK-004', 'TSK-006', 'TSK-002', 'TSK-003', 'TSK-007', 'TSK-001'];
const EXPECTED_ALL = ['EPIC-001'].concat(EXPECTED_TASKS);

const d = H.mkBacklog({ label: 'ac14-order', files: FILES, tombstones: TOMBSTONES });

/* ---- list: priority desc, then id asc ---------------------------------- */

{
  const r = H.runJson(['list', '--type=task'], { cwd: d });
  T.exit('list --type=task --json', r, 0);
  T.eq('list order is priority-desc, then id-asc', ids(r.json), EXPECTED_TASKS);

  const order = ids(r.json);
  T.check('a missing priority weighs as much as normal (2): TSK-002 < TSK-003 < TSK-007',
    order.indexOf('TSK-002') < order.indexOf('TSK-003') &&
    order.indexOf('TSK-003') < order.indexOf('TSK-007'),
    'order = ' + order.join(', '));
  T.check('high beats normal (TSK-006 before TSK-002)',
    order.indexOf('TSK-006') < order.indexOf('TSK-002'), 'order = ' + order.join(', '));
  T.check('low sorts last (TSK-001)', order.indexOf('TSK-001') === order.length - 1,
    'order = ' + order.join(', '));

  const ra = H.runJson(['list'], { cwd: d });
  T.exit('list --json without a type filter', ra, 0);
  T.eq('list puts the urgent epic before the urgent task (id ascending across types)',
    ids(ra.json), EXPECTED_ALL);
}

/* ---- tree: same order, depth-first ------------------------------------- */

{
  const r = H.runJson(['tree'], { cwd: d });
  T.exit('tree --json', r, 0);
  T.eq('tree is depth-first with the same sort inside a parent',
    ids(r.json), EXPECTED_ALL);

  const rh = H.runNj(['tree'], { cwd: d });
  T.exit('tree (human)', rh, 0);
  T.check('the human tree lists the children in the same order',
    ['TSK-005', 'TSK-004', 'TSK-006', 'TSK-002', 'TSK-003', 'TSK-007', 'TSK-001']
      .every((id, i, all) => rh.stdout.indexOf(id) >= 0 &&
        (i === 0 || rh.stdout.indexOf(all[i - 1]) < rh.stdout.indexOf(id))),
    J(rh.stdout).slice(0, 400));
}

/* ---- stable across calls ----------------------------------------------- */

{
  const runs = [
    ['list', ['list']],
    ['list --json', ['list', '--json']],
    ['tree', ['tree']],
    ['tree --json', ['tree', '--json']],
  ];
  for (const [name, args] of runs) {
    const a = H.runNj(args, { cwd: d });
    const b = H.runNj(args, { cwd: d });
    T.exit(name + ' (first run)', a, 0);
    T.check(name + ' prints byte-identical stdout on a second call',
      a.stdout === b.stdout,
      J(a.stdout).slice(0, 200) + '\n     vs ' + J(b.stdout).slice(0, 200));
  }
}

/* ---- the same fixture in another directory orders the same way ---------- */

{
  const d2 = H.mkBacklog({ label: 'ac14-order2', files: FILES, tombstones: TOMBSTONES });
  const r = H.runJson(['list'], { cwd: d2 });
  T.exit('list from a second copy of the fixture', r, 0);
  T.eq('the order does not depend on the directory or the inode numbers',
    ids(r.json), EXPECTED_ALL);

  const t = H.runJson(['tree'], { cwd: d2 });
  T.exit('tree from a second copy of the fixture', t, 0);
  T.eq('tree order is the same in the second copy', ids(t.json), EXPECTED_ALL);
}

/* ---- an unknown priority weighs as the default (DECISIONS 100, 70) --------
 * § 9 names weights for the four values and a missing priority; a value
 * outside them (`unknown:priority`) sorts with the default's 2 — measured v2
 * behaviour, kept. TSK-003 must land between the two normals, by id. */
{
  const u = H.mkBacklog({
    label: 'ac14-unknown-priority',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth'),
      'tasks/TSK-001.md': task('TSK-001', 'Urgent', 'urgent'),
      'tasks/TSK-002.md': task('TSK-002', 'Normal', 'normal'),
      'tasks/TSK-003.md': task('TSK-003', 'Weird priority', 'someday'),
      'tasks/TSK-004.md': task('TSK-004', 'Normal too', 'normal'),
      'tasks/TSK-005.md': task('TSK-005', 'Low', 'low'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005'],
  });
  const r = H.runJson(['list', '--type=task'], { cwd: u });
  T.exit('list with an unknown priority value', r, 0);
  T.eq('an unknown priority sorts with the default weight, tied with normal, by id',
    ids(r.json), ['TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005']);
}

T.finish();
