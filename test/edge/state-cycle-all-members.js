'use strict';
/* Edge — `depends_on:cycle` is reported on every actual member of a cycle,
 * not just one (§ 7 problem codes, § 9 JSON shapes, § 15 AC-10).
 *
 * NARROWED after review (see the team log): the file originally also
 * asserted this was the *only* code the closed vocabulary intends —
 * i.e. that only cycle members carry it, never an element that merely
 * depends on one. That claim does not survive: § 7 defines `depends_on:cycle`
 * over a whole-graph predicate ("the `depends_on` graph contains a cycle"),
 * with no stated rule for which element(s) the finding attaches to, and the
 * project already has a precedent for the *opposite* choice on the
 * structurally identical question — `AMBIGUITIES.md` 17 leaves open which
 * side of a two-sided violation carries `parent:hierarchy` and the oracle
 * deliberately asserts only "the code appears", not "only the violating
 * side carries it". Cross-verification also found that the current `nj`
 * implements a third, broader reading in practice: an element that merely
 * *depends on* a cycle member — without being one itself — carries
 * `depends_on:cycle` too. So at least three readings are live:
 *
 *   (a) member    — only elements that are themselves on a cycle;
 *   (b) reaches    — (a) plus any element whose `depends_on` chain leads
 *                     into a cycle, transitively;
 *   (c) every element — the graph predicate read as backlog-global, with no
 *                     per-element attribution at all.
 *
 * This file asserts only what is true under every one of the three: every
 * actual cycle member carries the code (true under (a), (b) and trivially
 * (c)), and an element with *no* `depends_on` at all does not (false only
 * under the degenerate (c), which the control check below already rules out
 * empirically — nothing here decides (a) vs (b) for an element that merely
 * points at a cycle). A "reacher" element (depends on a cycle member, is not
 * itself one) is included in the fixture without any assertion on its
 * `_problems`, so that whichever reading the lead rules gets a fixture ready
 * to pin against, instead of needing a new one. The three-reading write-up
 * above goes to the lead as the `AMBIGUITIES.md` entry text; it is not
 * inserted into that file from here.
 *
 * The previous version also carried a `--ready` block asserting cycle
 * members are excluded from `--ready`. Dropped: that exclusion follows from
 * § 9 condition 2 ("every `depends_on` target is `done`") on its own — a
 * cycle member's target is never `done` — independent of any problem code,
 * so the block was vacuous evidence for the per-member claim this file makes
 * and `ac/ac-10-dependencies.js` already covers `--ready` exclusion.
 */
const H = require('../lib/harness.js');
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

function task(id, title, opts) {
  const o = opts || {};
  const f = { id, type: 'task', parent: 'EPIC-001', title, status: 'todo' };
  if (o.depends) f.depends_on = '[' + o.depends.join(', ') + ']';
  f.created = H.FIXED_NOW;
  f.updated = H.FIXED_NOW;
  return H.element(f, H.completeBody(title));
}

function entryOf(json, id) {
  return ((json && json.entries) || []).find(e => e.id === id);
}

const MEMBERS = ['TSK-001', 'TSK-002', 'TSK-003'];

/* ---- a 3-node cycle, a dependency-free control, and a reacher ----------- */
{
  const d = H.mkBacklog({
    label: 'edge-cycle-3',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': task('TSK-001', 'A', { depends: ['TSK-002'] }),
      'tasks/TSK-002.md': task('TSK-002', 'B', { depends: ['TSK-003'] }),
      'tasks/TSK-003.md': task('TSK-003', 'C', { depends: ['TSK-001'] }),
      'tasks/TSK-004.md': task('TSK-004', 'Control, no dependency at all'),
      // Reacher: depends on a cycle member, is not itself on the cycle.
      // No assertion on its _problems below — see the header note.
      'tasks/TSK-005.md': task('TSK-005', 'Reacher, points at the cycle', { depends: ['TSK-001'] }),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005'],
  });

  /* per-element check via `list` — the black-box surface an agent actually
   * reads for one element's state. Fixed count: one check per known member,
   * regardless of what else the implementation reports. */
  const list = H.runJson(['list'], { cwd: d, timeout: 20000 });
  T.exit('list with a 3-cycle', list, 0);
  for (const id of MEMBERS) {
    const e = entryOf(list.json, id);
    const probs = (e && e._problems) || [];
    T.check(id + ' individually carries depends_on:cycle',
      probs.includes('depends_on:cycle'), id + ' problems = ' + J(probs));
  }
  const ctl = entryOf(list.json, 'TSK-004');
  T.check('a dependency-free control carries no depends_on:cycle (rules out "every element")',
    !((ctl && ctl._problems) || []).includes('depends_on:cycle'),
    J(ctl && ctl._problems));

  /* the same claim via `doctor` — each member gets its own finding, checked
   * by identity rather than by counting or set-equality, so an
   * implementation that additionally flags the reacher (reading (b)) does
   * not break this file — only the per-member claim is asserted. */
  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.exit('doctor with a 3-cycle', doc, 2);
  const cycleFindings = ((doc.json && doc.json.problems) || [])
    .filter(p => p.code === 'depends_on:cycle');
  for (const id of MEMBERS) {
    const p = cycleFindings.find(x => x.element === id);
    T.check(id + ' has its own doctor finding, severity error',
      !!p && p.severity === 'error', J(p));
  }
}

/* ---- a 2-node mutual cycle: both members, not just the one named first -- */
{
  const d = H.mkBacklog({
    label: 'edge-cycle-2',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': task('TSK-001', 'A', { depends: ['TSK-002'] }),
      'tasks/TSK-002.md': task('TSK-002', 'B', { depends: ['TSK-001'] }),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });

  /* No reacher in this fixture — EPIC-001 exists too, but nothing depends on
   * or is depended on across the cycle boundary — so exact-set equality is
   * safe under readings (a) and (b); the degenerate (c) is already ruled out
   * empirically by the dependency-free control in the block above. */
  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.exit('doctor with a 2-cycle', doc, 2);
  const elements = ((doc.json && doc.json.problems) || [])
    .filter(p => p.code === 'depends_on:cycle')
    .map(p => p.element).sort();
  T.eq('doctor reports depends_on:cycle on both members of a mutual cycle',
    J(elements), J(['TSK-001', 'TSK-002']));
}

T.finish();
