'use strict';
/* AC-18 — Tombstone integrity.
 *
 * "Deleting backlog/.ids/ and running doctor yields backlog:ids_missing as
 *  ERROR with exit 2 — never a clean pass; doctor --fix restores tombstones
 *  for all surviving element IDs and reports that tombstones for deleted IDs
 *  are unrecoverable; a subsequent nj new allocates above every existing
 *  element number."
 *
 * This is the criterion that guards the failure mode where a silently lost
 * .ids/ directory would let the allocator reissue an ID that a parent or
 * depends_on edge still points at.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const d = H.mkBacklog({
  label: 'ac18',
  files: {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
      created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Auth\n\n## Description\nReal work.\n'),
    'tasks/TSK-007.md': H.element({
      id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'Highest task',
      status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Highest task\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
  },
  tombstones: ['EPIC-001', 'TSK-001', 'TSK-007'],
});
const bl = path.join(d, 'backlog');

/* Two tombstones with no element: these stand in for IDs deleted with nj rm.
 * Their numbers exist nowhere else, which is precisely what makes them
 * unrecoverable once .ids/ is gone. */
T.check('fixture has tombstones without elements',
  fs.existsSync(path.join(bl, '.ids', 'TSK-001')) &&
  !fs.existsSync(path.join(bl, 'tasks', 'TSK-001.md')));

/* ---- the loss --------------------------------------------------------- */
fs.rmSync(path.join(bl, '.ids'), { recursive: true, force: true });
T.check('.ids/ is gone', !fs.existsSync(path.join(bl, '.ids')));

const doc = H.runJson(['doctor'], { cwd: d });
T.exit('doctor exits 2 after losing .ids/', doc, 2);
T.check('doctor --json ok=false', doc.json && doc.json.ok === false,
  JSON.stringify(doc.json && doc.json.ok));

const problems = (doc.json && doc.json.problems) || [];
const idsMissing = problems.filter(p => p.code === 'backlog:ids_missing');
T.check('backlog:ids_missing is reported', idsMissing.length === 1,
  'codes: ' + JSON.stringify(problems.map(p => p.code)));
T.eq('backlog:ids_missing has severity error', idsMissing[0] && idsMissing[0].severity, 'error');
T.check('backlog:ids_missing carries no element field',
  idsMissing[0] && idsMissing[0].element === undefined,
  JSON.stringify(idsMissing[0]));
T.check('each surviving element reports id:no_tombstone',
  problems.filter(p => p.code === 'id:no_tombstone').length === 2,
  'id:no_tombstone count: ' +
  problems.filter(p => p.code === 'id:no_tombstone').length);

/* Not a clean pass: the human output must show an ERROR line too (§ 14's
 * example). `doc` above is the --json run, which carries codes and severities,
 * not the words — asserting the word against JSON is the mistake this
 * replaces. So ask for the human form explicitly. */
const docHuman = H.runNj(['doctor'], { cwd: d });
T.exit('doctor (human form) also exits 2', docHuman, 2);
T.contains('doctor prints an ERROR line', docHuman.stdout, 'ERROR');
T.check('doctor stdout is not a clean pass',
  !/0 errors/.test(docHuman.stdout), docHuman.stdout);

/* ---- nj new must not recycle ----------------------------------------- */
const rNew = H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=After loss'],
  { cwd: d });
T.exit('nj new still works without .ids/', rNew, 0);
const created = fs.readdirSync(path.join(bl, 'tasks')).filter(f => f.endsWith('.md')).sort();
T.eq('new ID allocates above every existing element number',
  created.join(','), 'TSK-007.md,TSK-008.md');

/* ---- doctor --fix restores ------------------------------------------- */
const fix = H.runNj(['doctor', '--fix'], { cwd: d });
/* AMBIGUOUS (AMBIGUITIES.md 5): § 9 pins exit 2 for `doctor` with an error
 * finding, but not whether `--fix` samples the findings before or after the
 * repairs — so a repairable backlog may legitimately exit 0 or 2 here. Both
 * are accepted; the real assertion is on the resulting files. */
T.exit('doctor --fix runs', fix, [0, 2]);

for (const id of ['EPIC-001', 'TSK-007', 'TSK-008']) {
  T.check('--fix restored the tombstone for ' + id,
    fs.existsSync(path.join(bl, '.ids', id)),
    'missing .ids/' + id);
}
T.check('--fix does not invent a tombstone for the deleted TSK-001',
  !fs.existsSync(path.join(bl, '.ids', 'TSK-001')),
  'TSK-001 was deleted and can never be proven; --fix must not guess');

/* The report that the guarantee is void for lost IDs. The wording is not
 * pinned by the spec, so this matches a family of phrasings.
 * AMBIGUOUS: §8/§14 say --fix "reports that the never-reuse guarantee is void
 * for those numbers" without fixing the wording or the stream. */
T.check('--fix reports the unrecoverable IDs',
  /unrecover|void|never.?reuse|deleted/i.test(fix.stdout + fix.stderr),
  'stdout: ' + JSON.stringify(fix.stdout) + '\n     stderr: ' + JSON.stringify(fix.stderr));

const after = H.runJson(['doctor'], { cwd: d });
T.check('doctor no longer reports backlog:ids_missing',
  !((after.json && after.json.problems) || []).some(p => p.code === 'backlog:ids_missing'),
  JSON.stringify((after.json && after.json.problems) || []));
T.check('doctor no longer reports id:no_tombstone',
  !((after.json && after.json.problems) || []).some(p => p.code === 'id:no_tombstone'));

T.finish();
