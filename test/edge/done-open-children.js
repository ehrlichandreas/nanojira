'use strict';
/* Edge — done on a parent with open children (§ 9, § 7).
 *
 * "nj set --status=done on an element with children not done is refused unless
 *  --allow-open-children; forcing it produces done:open_children. --force has
 *  exactly one meaning: overwrite a parallel change (§ 12). It never weakens
 *  the parent rule."
 *
 * The last sentence is the one worth a test of its own: `--force` and
 * `--allow-open-children` are different flags with different jobs, and it is
 * tempting to let --force imply the other.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Open one',
        status: 'doing', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Open one\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Open two',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Open two\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });
}

const epicPath = d => path.join(d, 'backlog', 'epics', 'EPIC-001.md');

/* ---- refusal ----------------------------------------------------------- */
{
  const d = fixture('edge-done-refuse');
  const before = fs.readFileSync(epicPath(d), 'utf8');

  const r = H.runNj(['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  T.exit('done on an epic with open children is refused', r, 1);
  T.eq('nothing was written (checksum)',
    H.sha256(fs.readFileSync(epicPath(d), 'utf8')), H.sha256(before));

  const msg = r.stdout + r.stderr;
  T.contains('the refusal names the first open child', msg, 'TSK-001');
  T.contains('the refusal names the second open child', msg, 'TSK-002');

  /* The refusal also has a machine-readable half: § 9's failure shape with a
   * code from the closed vocabulary. AMBIGUOUS: § 9 lists
   * `refused:children_open` in the vocabulary and states the behaviour, but
   * does not map this path to that name — the mapping is inferred from the
   * name, as elsewhere (AMBIGUITIES.md 23). */
  const js = H.runJson(['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  T.exit('the refusal has a JSON form', js, 1);
  T.check('the JSON failure shape holds',
    !!js.json && js.json.ok === false && typeof js.json.error === 'string',
    JSON.stringify(js.json));
  T.eq('the code is refused:children_open', js.json && js.json.error, 'refused:children_open');
}

/* ---- --force does NOT weaken the parent rule -------------------------- */
{
  const d = fixture('edge-done-force');
  const r = H.runNj(['set', '--id=EPIC-001', '--status=done', '--force'], { cwd: d });
  T.exit('--force alone does not bypass the parent rule', r, 1);
  const after = fs.readFileSync(epicPath(d), 'utf8');
  T.check('--force alone wrote nothing', after.includes('status: todo'),
    JSON.stringify(after.slice(0, 200)));
}

/* ---- the sanctioned way ----------------------------------------------- */
{
  const d = fixture('edge-done-allow');
  const r = H.runNj(['set', '--id=EPIC-001', '--status=done', '--allow-open-children'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--allow-open-children permits the write', r, 0);

  const after = fs.readFileSync(epicPath(d), 'utf8');
  T.contains('the epic is now done', after, 'status: done');

  const list = H.runJson(['list'], { cwd: d });
  const epic = ((list.json && list.json.entries) || []).find(e => e.id === 'EPIC-001');
  T.check('the epic carries done:open_children',
    epic && (epic._problems || []).includes('done:open_children'),
    JSON.stringify(epic && epic._problems));

  /* §7: done:open_children is a WARNING finding, so doctor reports it but
   * does not exit 2 on it alone. */
  const doc = H.runJson(['doctor'], { cwd: d });
  const p = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'done:open_children');
  T.sameSet('the findings are exactly the one done:open_children warning',
    H.doctorSet(doc) || ['<no problems array>'], ['done:open_children:warning']);
  T.eq('done:open_children severity is warning', p[0] && p[0].severity, 'warning');
}

/* ---- a done-but-open parent does not satisfy depends_on (§ 9 ready 2) -- */
{
  const d = fixture('edge-done-dep');
  H.runNj(['set', '--id=EPIC-001', '--status=done', '--allow-open-children'], { cwd: d });
  H.writeRaw(d, 'tasks/TSK-003.md', H.element({
    id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'Depends on an open parent',
    status: 'todo', depends_on: '[EPIC-001]',
    created: H.FIXED_NOW, updated: H.FIXED_NOW,
  }, '# Depends on an open parent\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'));
  fs.writeFileSync(path.join(d, 'backlog', H.IDS_REL, 'TSK-003'), '');

  const list = H.runJson(['list', '--ready'], { cwd: d });
  const ready = ((list.json && list.json.entries) || []).map(e => e.id);
  T.check('a done parent with open children is NOT a satisfied dependency',
    !ready.includes('TSK-003'), 'ready set: ' + JSON.stringify(ready));
}

T.finish();
