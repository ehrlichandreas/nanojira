'use strict';
/* Edge — `parent:cycle` across the shapes a parent chain can loop in (§ 7).
 *
 * § 7: `parent:cycle` | `parent` graph contains a cycle | error | yes.
 * Same whole-graph-predicate wording as `depends_on:cycle` (item 25 in
 * AMBIGUITIES.md), so the same three-reading ambiguity applies here by
 * direct analogy — see the header note near the branch fixture below and the
 * AMBIGUITIES text sent to the lead alongside this file.
 *
 * Coverage before this file: `ac/ac-03-fault-tolerance.js` deliberately
 * excludes `parent:cycle` from its "one malformed element, closed
 * vocabulary" pass — its own comment says why: "a cycle can only be built
 * from task→task parents, which is a `parent:hierarchy` violation at the
 * same time; § 7 does not pin which of the two codes (or both) appear."
 * `ac/ac-13-json-contract.js` only names the code in a vocabulary-string
 * list, never builds a cycle. So before this file, no fixture in the tree
 * actually exercises `markParentCycles` beyond that vocabulary mention.
 *
 * That structural fact — a parent cycle needs same-typed parent links, which
 * is *itself* always a `parent:hierarchy` violation — is unavoidable for
 * every shape below, so every fixture here also carries `parent:hierarchy`.
 * This file does not assert on that (ac-03 already covers `parent:hierarchy`
 * on its own, and item 17 already tracks which side of it carries the code);
 * only `parent:cycle` itself is asserted.
 *
 * Shapes covered: self-reference (the degenerate 1-cycle, § 7's own comment
 * in `nj` calls out "what stops a self-parent"), a 2-cycle, a 3-node chain,
 * and a branch that points *at* a cycle without being *on* it — the parent
 * analogue of `state-cycle-all-members.js`'s "reacher". A cycle spanning an
 * archived node is a distinct shape and lives in its own file,
 * `cycle-parent-archived.js`, since combining it here would also drag in
 * `archive:split`.
 */
const H = require('../lib/harness.js');
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

function task(id, title, parent) {
  return H.element({
    id, type: 'task', parent, title, status: 'todo',
    created: H.FIXED_NOW, updated: H.FIXED_NOW,
  }, H.completeBody(title));
}

function entryOf(json, id) {
  return ((json && json.entries) || []).find(e => e.id === id);
}

/* ---- self-reference: the degenerate 1-cycle ----------------------------- */
{
  const d = H.mkBacklog({
    label: 'cycle-parent-self',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': task('TSK-001', 'Self-parented', 'TSK-001'),
      'tasks/TSK-002.md': task('TSK-002', 'Healthy control', 'EPIC-001'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });

  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.exit('doctor with a self-referencing parent', doc, 2);
  /* Exactly one element is affected, so the whole set is derivable: TSK-001
   * points at itself (`parent:cycle`) and is thereby a task parented by a
   * task, which § 6's three-level rule forbids (`parent:hierarchy`).
   * EPIC-001 and TSK-002 are healthy. */
  T.sameSet('the findings are exactly § 7\'s set for this fixture',
    H.doctorSet(doc) || ['<no problems array>'],
    ['parent:cycle:error', 'parent:hierarchy:error']);
  const findings = ((doc.json && doc.json.problems) || [])
    .filter(p => p.code === 'parent:cycle');
  const self = findings.find(p => p.element === 'TSK-001');
  T.check('the self-referencing task carries parent:cycle',
    !!self && self.severity === 'error', J(self));

  const list = H.runJson(['list'], { cwd: d, timeout: 20000 });
  T.exit('list with a self-referencing parent', list, 0);
  const ctl = entryOf(list.json, 'TSK-002');
  T.check('a healthy sibling carries no parent:cycle (the check above is not vacuous)',
    !((ctl && ctl._problems) || []).includes('parent:cycle'), J(ctl && ctl._problems));
}

/* ---- 2-cycle and a 3-node chain, plus a branch that reaches but is not on
 * either one — no assertion on the branch's own _problems: whether "reaches"
 * counts is exactly the open question this file reports, not decides. ------ */
{
  const d = H.mkBacklog({
    label: 'cycle-parent-shapes',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      // 2-cycle: TSK-001 <-> TSK-002
      'tasks/TSK-001.md': task('TSK-001', 'Two-cycle A', 'TSK-002'),
      'tasks/TSK-002.md': task('TSK-002', 'Two-cycle B', 'TSK-001'),
      // 3-node chain: TSK-003 -> TSK-004 -> TSK-005 -> TSK-003
      'tasks/TSK-003.md': task('TSK-003', 'Chain A', 'TSK-004'),
      'tasks/TSK-004.md': task('TSK-004', 'Chain B', 'TSK-005'),
      'tasks/TSK-005.md': task('TSK-005', 'Chain C', 'TSK-003'),
      // Branch: points at the 2-cycle, is not itself on it.
      'tasks/TSK-006.md': task('TSK-006', 'Branch, points at the 2-cycle', 'TSK-001'),
      // Dependency-free control: a proper child of the epic.
      'tasks/TSK-007.md': task('TSK-007', 'Healthy control', 'EPIC-001'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005',
      'TSK-006', 'TSK-007'],
  });

  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.exit('doctor with a 2-cycle, a 3-chain and a branch', doc, 2);
  /* CODE-set equality, deliberately not element-set equality. Whether a node
   * that merely *reaches* a cycle is flagged too is the reading this file
   * leaves open (readings (a)/(b) in the header), so the cardinality stays
   * unpinned — but no code other than `parent:cycle` may appear, which is
   * what closes the "extra spurious finding" blindness here. */
  T.sameSet('only the two § 6/§ 7 parent codes are reported for this fixture',
    [...new Set(H.doctorSet(doc) || ['<no problems array>'])].sort(),
    ['parent:cycle:error', 'parent:hierarchy:error']);
  const cycleFindings = ((doc.json && doc.json.problems) || [])
    .filter(p => p.code === 'parent:cycle');

  for (const id of ['TSK-001', 'TSK-002']) {
    const p = cycleFindings.find(x => x.element === id);
    T.check(id + ' (2-cycle member) has its own parent:cycle finding, severity error',
      !!p && p.severity === 'error', J(p));
  }
  for (const id of ['TSK-003', 'TSK-004', 'TSK-005']) {
    const p = cycleFindings.find(x => x.element === id);
    T.check(id + ' (3-chain member) has its own parent:cycle finding, severity error',
      !!p && p.severity === 'error', J(p));
  }

  const list = H.runJson(['list'], { cwd: d, timeout: 20000 });
  T.exit('list with a 2-cycle, a 3-chain and a branch', list, 0);
  const ctl = entryOf(list.json, 'TSK-007');
  T.check('a healthy control (proper child of the epic) carries no parent:cycle',
    !((ctl && ctl._problems) || []).includes('parent:cycle'), J(ctl && ctl._problems));
}

T.finish();
