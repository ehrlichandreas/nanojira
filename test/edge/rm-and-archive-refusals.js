'use strict';
/* Edge — rm with children, and archiving an open subtree (§ 9, § 11).
 *
 * § 9: "nj rm refuses while child elements exist and names them. --cascade
 *       deletes the subtree. Tombstones remain either way. A mode that leaves
 *       orphaned elements does not exist."
 * § 11: "Precondition: the element and every descendant are done. Otherwise
 *        the command refuses and lists the open elements. There is no
 *        --force: finish first, then archive."
 *
 * Both refusals must be *actionable*: an agent that cannot see which child is
 * in the way will retry, and a retry loop on a refusal is the failure mode
 * that costs a budget without producing anything.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

function fixture(label, statuses) {
  const s = statuses || {};
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: s.epic || 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Task one',
        status: s.t1 || 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Task one\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
      'subtasks/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Sub one',
        status: s.s1 || 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Sub one\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });
}

const p = (d, rel) => path.join(d, 'backlog', rel);
const sums = d => ({
  epic: H.sha256(fs.readFileSync(p(d, 'epics/EPIC-001.md'), 'utf8')),
  task: H.sha256(fs.readFileSync(p(d, 'tasks/TSK-001.md'), 'utf8')),
  sub: H.sha256(fs.readFileSync(p(d, 'subtasks/SUB-001.md'), 'utf8')),
});

/* ---- rm with children -------------------------------------------------- */
{
  const d = fixture('edge-rm-refuse');
  const before = sums(d);

  const r = H.runNj(['rm', '--id=TSK-001'], { cwd: d });
  T.exit('rm on a task with a subtask is refused', r, 1);
  T.eq('nothing was deleted', JSON.stringify(sums(d)), JSON.stringify(before));

  const msg = r.stdout + r.stderr;
  T.contains('the refusal names the blocking child', msg, 'SUB-001');

  /* AMBIGUOUS: `refused:has_children` is in § 9's closed vocabulary and § 9
   * states this behaviour, but the spec does not map the path to the name —
   * the mapping is inferred, as elsewhere (AMBIGUITIES.md 23). */
  const js = H.runJson(['rm', '--id=TSK-001'], { cwd: d });
  T.exit('the rm refusal has a JSON form', js, 1);
  T.eq('the code is refused:has_children', js.json && js.json.error, 'refused:has_children');

  /* The same rule one level up. */
  const r2 = H.runNj(['rm', '--id=EPIC-001'], { cwd: d });
  T.exit('rm on an epic with a subtree is refused', r2, 1);
  T.contains('the refusal names the direct child', r2.stdout + r2.stderr, 'TSK-001');
}

/* ---- rm --cascade ----------------------------------------------------- */
{
  const d = fixture('edge-rm-cascade');
  const r = H.runNj(['rm', '--id=TSK-001', '--cascade'], { cwd: d });
  T.exit('rm --cascade deletes the subtree', r, 0);

  T.check('the task file is gone', !fs.existsSync(p(d, 'tasks/TSK-001.md')));
  T.check('the subtask file is gone', !fs.existsSync(p(d, 'subtasks/SUB-001.md')));
  T.check('the parent epic survives', fs.existsSync(p(d, 'epics/EPIC-001.md')));

  /* "Tombstones remain either way." */
  T.check('tombstone TSK-001 remains', fs.existsSync(p(d, '.ids/TSK-001')));
  T.check('tombstone SUB-001 remains', fs.existsSync(p(d, '.ids/SUB-001')));

  /* "A mode that leaves orphaned elements does not exist." */
  const doc = H.runJson(['doctor'], { cwd: d });
  const codes = ((doc.json && doc.json.problems) || []).map(x => x.code);
  T.check('no parent:dangling after a cascade', !codes.includes('parent:dangling'),
    JSON.stringify(codes));
}

/* ---- archive with an open subtree -------------------------------------- */
{
  const d = fixture('edge-arch-open', { epic: 'todo', t1: 'todo', s1: 'doing' });
  const before = sums(d);

  const r = H.runNj(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('archiving a subtree with open elements is refused', r, 1);
  T.eq('nothing was moved', JSON.stringify(sums(d)), JSON.stringify(before));

  /* AMBIGUOUS: `refused:not_done` is in § 9's closed vocabulary and § 11
   * states this behaviour, but the spec does not map the path to the name —
   * inferred, as elsewhere (AMBIGUITIES.md 23). */
  const js = H.runJson(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('the archive refusal has a JSON form', js, 1);
  T.eq('the code is refused:not_done', js.json && js.json.error, 'refused:not_done');
  T.check('nothing landed in archive/',
    fs.readdirSync(p(d, 'archive')).length === 0,
    JSON.stringify(fs.readdirSync(p(d, 'archive'))));

  const msg = r.stdout + r.stderr;
  T.contains('the refusal lists the open epic', msg, 'EPIC-001');
  T.contains('the refusal lists the open task', msg, 'TSK-001');
  T.contains('the refusal lists the open subtask', msg, 'SUB-001');
}

/* ---- archive has no --force ------------------------------------------- */
{
  const d = fixture('edge-arch-force', { epic: 'todo', t1: 'todo', s1: 'todo' });
  const r = H.runNj(['archive', '--id=EPIC-001', '--force'], { cwd: d });
  T.exit('there is no --force for archive', r, 1);
  T.check('nothing was moved by --force',
    fs.readdirSync(p(d, 'archive')).length === 0);
}

/* ---- a fully done subtree archives ------------------------------------ */
{
  const d = fixture('edge-arch-ok', { epic: 'done', t1: 'done', s1: 'done' });
  const r = H.runNj(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('a fully done subtree archives', r, 0);

  for (const rel of ['archive/EPIC-001.md', 'archive/TSK-001.md', 'archive/SUB-001.md']) {
    T.check(rel + ' moved into archive/', fs.existsSync(p(d, rel)), 'missing ' + rel);
  }
  T.check('epics/ is empty',
    fs.readdirSync(p(d, 'epics')).filter(f => f.endsWith('.md')).length === 0);
  T.check('tombstones remain after archive', fs.existsSync(p(d, '.ids/TSK-001')));
}

T.finish();
