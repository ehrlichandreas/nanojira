'use strict';
/* Edge — `nj rm` with inbound depends_on edges (§ 9).
 *
 * § 9, `nj rm`:
 *   "nj rm refuses while child elements exist and names them. --cascade deletes
 *    the subtree. Tombstones remain either way. If other elements `depends_on`
 *    the removed element, `rm` names them as a warning (`depends_on:dangling`
 *    will follow). A mode that leaves orphaned elements does not exist."
 *
 * A warning, not a refusal: the child rule is the only hard gate, and the
 * dangling edge left behind is `doctor`'s to report. Naming the dependents is
 * what keeps that warning actionable — an agent that deletes an element
 * silently breaks every edge pointing into it, and the point of the sentence is
 * that it does not have to find them itself.
 */
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const p = (d, rel) => path.join(d, 'backlog', rel);

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Removed',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Removed')),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Depends on the removed one',
        status: 'todo', depends_on: '[TSK-001]',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Depends on the removed one')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });
}

/* ---- the human path: a warning that names them, and still deletes ------- */

{
  const d = fixture('edge-rm-dependents');

  const human = H.runNj(['rm', '--id=TSK-001'], { cwd: d });
  T.exit('removing an element others depend on is a warning, not a refusal', human, 0);

  /* AMBIGUOUS: § 9 places *error* prose on stderr and says nothing about where
   * a non-fatal warning goes, so the naming is asserted on stdout+stderr
   * combined rather than on one stream. */
  const msg = (human.stdout || '') + (human.stderr || '');
  T.contains('the warning names the dependent', msg, 'TSK-002');
  /* AMBIGUOUS: whether the warning also quotes the code it forecasts
   * (`depends_on:dangling`) is unpinned — § 9's parenthetical reads as the
   * consequence, not necessarily as wording. Only the naming is asserted. */

  T.check('the deletion happened', H.readOrNull(p(d, 'tasks/TSK-001.md')) === null,
    'tasks/TSK-001.md is still there');
  T.check('its tombstone remains (§ 8: the ID stays claimed forever)',
    H.readOrNull(p(d, H.IDS_REL + '/TSK-001')) !== null, '.nanojira/ids/TSK-001 is gone');

  const dep = H.readOrNull(p(d, 'tasks/TSK-002.md'));
  T.check('the dependent itself survives', dep !== null, 'tasks/TSK-002.md is gone');
  T.check('the dependent keeps the reference — that is what dangles',
    !!dep && dep.includes('depends_on: [TSK-001]'),
    JSON.stringify(dep === null ? null : dep.slice(0, 200)));

  /* "(depends_on:dangling will follow)" — the follow-through is what the
   * warning is a warning about, and § 7 makes it an error finding. */
  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor exits 2 on the dangling reference (§ 7: Doctor = error)', doc, 2);
  T.sameSet('the findings are exactly the one dangling-reference error',
    H.doctorSet(doc) || ['<no problems array>'], ['depends_on:dangling:error']);
  const findings = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'depends_on:dangling');
  T.eq('exactly one depends_on:dangling finding', findings.length, 1);
  T.eq('the finding is carried by the dependent (§ 9 doctor shape: element)',
    findings[0] && findings[0].element, 'TSK-002');
  T.eq('its severity is error', findings[0] && findings[0].severity, 'error');

  const list = H.runJson(['list'], { cwd: d });
  const t2 = ((list.json && list.json.entries) || []).filter(e => e.id === 'TSK-002')[0];
  T.check('the dependent surfaces the code in _problems (§ 9 read shape)',
    !!t2 && (t2._problems || []).includes('depends_on:dangling'),
    JSON.stringify(t2 && t2._problems));
}

/* ---- the --json path: `dependents` is a REQUIRED field (§ 9) ------------ */

{
  const d = fixture('edge-rm-dependents-json');

  const js = H.runJson(['rm', '--id=TSK-001'], { cwd: d });
  T.exit('the same removal with --json', js, 0);
  T.check('--json write shape: ok:true with the removed id (§ 9)',
    !!js.json && js.json.ok === true && js.json.id === 'TSK-001',
    JSON.stringify(js.json || js.stdout).slice(0, 300));
  T.check('changed is a list (§ 9 write shape)',
    !!js.json && Array.isArray(js.json.changed),
    JSON.stringify(js.json && js.json.changed));
  T.check('the deletion happened', H.readOrNull(p(d, 'tasks/TSK-001.md')) === null);
  T.check('its tombstone remains', H.readOrNull(p(d, H.IDS_REL + '/TSK-001')) !== null);

  /* § 9: "`rm` additionally carries `dependents: […]` — the elements whose
   * `depends_on` names the removed one, empty when there are none".
   * A required field, asserted unconditionally. */
  T.check('dependents is present and an array (§ 9: rm carries it)',
    !!js.json && Array.isArray(js.json.dependents),
    JSON.stringify(js.json && js.json.dependents));
  T.check('dependents names the dependent',
    !!js.json && Array.isArray(js.json.dependents) &&
    js.json.dependents.indexOf('TSK-002') !== -1,
    JSON.stringify(js.json && js.json.dependents));
  T.eq('dependents holds exactly the one dependent',
    JSON.stringify(js.json && js.json.dependents), JSON.stringify(['TSK-002']));
}

/* ---- the empty case: the field is required, so `[]` must be emitted ----- */

{
  const d = fixture('edge-rm-dependents-none');
  /* Nothing depends on TSK-002, so this is the "empty when there are none"
   * half of the § 9 sentence — the half an "assert only if present" check can
   * never reach. */
  const js = H.runJson(['rm', '--id=TSK-002'], { cwd: d });
  T.exit('removing an element nobody depends on', js, 0);
  T.check('dependents is present even when empty',
    !!js.json && Array.isArray(js.json.dependents),
    JSON.stringify(js.json && js.json.dependents));
  T.check('dependents is [] when there are none',
    !!js.json && Array.isArray(js.json.dependents) && js.json.dependents.length === 0,
    JSON.stringify(js.json && js.json.dependents));
}

/* ---- rm --cascade: § 9 gives it its OWN shape --------------------------- */

{
  const d = H.mkBacklog({
    label: 'edge-rm-cascade-dependents',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Root',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Root')),
      'subtasks/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Child',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Child')),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Depends on the subtree',
        status: 'todo', depends_on: '[TSK-001]',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Depends on the subtree')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001', 'TSK-002'],
  });

  const js = H.runJson(['rm', '--id=TSK-001', '--cascade'], { cwd: d });
  T.exit('rm --cascade', js, 0);

  /* § 9's table row for `rm --cascade`: {ok, ids, changed: ["deleted"],
   * entries, _problems} with the top-level `_problems` explicitly `[]`. */
  T.check('ok is true', !!js.json && js.json.ok === true, JSON.stringify(js.json && js.json.ok));
  T.check('ids lists every removed element',
    !!js.json && Array.isArray(js.json.ids) &&
    js.json.ids.slice().sort().join(',') === 'SUB-001,TSK-001',
    JSON.stringify(js.json && js.json.ids));
  T.eq('changed is ["deleted"]',
    JSON.stringify(js.json && js.json.changed), JSON.stringify(['deleted']));
  T.check('entries is a list',
    !!js.json && Array.isArray(js.json.entries), JSON.stringify(js.json && js.json.entries));
  T.check('the top-level _problems is [] for a cascade (§ 9: the elements are gone)',
    !!js.json && Array.isArray(js.json._problems) && js.json._problems.length === 0,
    JSON.stringify(js.json && js.json._problems));

  /* NOTE, reported rather than asserted: the brief for this task asked for
   * `dependents` unconditionally on `rm --cascade` too, but § 9's table gives
   * that command its own row and does not list the field there. Only `rm` is
   * pinned to carry it, so only `rm` is asserted. If the intent is that a
   * cascade also names its dependents, that is a spec addition, not a test
   * change. */
}

T.finish();
