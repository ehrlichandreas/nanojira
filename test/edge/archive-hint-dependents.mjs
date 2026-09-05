/* Edge — archive's _problems union and its deliberate absence of `dependents`
 * (Not-covered #5: "archive-Hint, kein dependents bei archive").
 *
 * § 9 JSON shapes: "archive ... does NOT [carry dependents] — a depends_on
 * pointing into the archive is satisfied by definition (§ 11), so there is
 * nothing to warn about and nothing an agent must act on."
 *
 * DECISIONS.md #62: "`rm --cascade` emits a top-level `_problems: []` while
 * `archive` emits the union. The asymmetry is deliberate ... deleted elements
 * are gone, so their problems are gone with them; archived elements still
 * exist and can still carry findings." That union — archive's own "hint"
 * about what it just moved — had never been exercised with a genuinely
 * non-empty case; every existing test only checked "_problems is an array".
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

const C = H.FIXED_NOW;
const J = x => JSON.stringify(x);

/* ---- archive's top-level _problems is the UNION of the entries' findings */

{
  /* TSK-001 is deliberately archived without ever having had a tombstone:
   * id:no_tombstone (warning) does not block archiving (only "done" does),
   * so it must survive as a real finding in the archived entry — and archive
   * must surface it at the top level too, unlike rm --cascade. */
  const d = H.mkBacklog({
    label: 'archive-hint-union',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'done',
        created: C, updated: C,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Done, no tombstone',
        status: 'done', created: C, updated: C,
      }, H.completeBody('Done, no tombstone')),
    },
    tombstones: ['EPIC-001'],
  });

  const before = H.runJson(['list', '--all'], { cwd: d });
  const t1Before = (before.json.entries || []).find(e => e.id === 'TSK-001');
  T.check('control: TSK-001 carries id:no_tombstone before archiving',
    !!t1Before && (t1Before._problems || []).includes('id:no_tombstone'),
    J(t1Before && t1Before._problems));

  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('archive succeeds — a missing tombstone is a warning, not a blocker', r, 0);

  T.check('archive top-level _problems is an array', Array.isArray(r.json && r.json._problems),
    J(r.json && r.json._problems));
  T.check('the union is NOT empty (DECISIONS.md #62: archive emits the union)',
    !!r.json && r.json._problems.length > 0, J(r.json && r.json._problems));
  T.check('the union includes id:no_tombstone from the archived TSK-001',
    !!r.json && r.json._problems.includes('id:no_tombstone'), J(r.json && r.json._problems));

  const t1After = (r.json.entries || []).find(e => e.id === 'TSK-001');
  T.check('the archived entry itself also carries its own _problems',
    !!t1After && (t1After._problems || []).includes('id:no_tombstone'), J(t1After));
}

/* ---- non-vacuity control: a clean subtree archives with an EMPTY union -- */

{
  const d = H.mkBacklog({
    label: 'archive-hint-clean',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'done',
        created: C, updated: C,
      }, '# Auth\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });
  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('archiving a clean element succeeds', r, 0);
  T.eq('the union is [] when no archived entry carries a finding — the union check above is not vacuous',
    r.json && r.json._problems, []);
}

/* ---- archive never carries a `dependents` field (unlike rm/rm --cascade) */

{
  const d = H.mkBacklog({
    label: 'archive-no-dependents-field',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'done',
        created: C, updated: C,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Root of the archive',
        status: 'done', created: C, updated: C,
      }, H.completeBody('Root of the archive')),
      'epics/EPIC-002.md': H.element({
        id: 'EPIC-002', type: 'epic', title: 'Elsewhere', status: 'todo',
        created: C, updated: C,
      }, '# Elsewhere\n\n## Description\nD\n'),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-002', title: 'Depends on the archived task',
        status: 'todo', depends_on: '[TSK-001]', created: C, updated: C,
      }, H.completeBody('Depends on the archived task')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'EPIC-002', 'TSK-002'],
  });

  /* Someone still actively depends_on the element being archived — exactly
   * the situation § 11 says must never block archival, and exactly the
   * situation where a `dependents` field, if archive had one, would have
   * something to report. It deliberately does not. */
  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('archive succeeds despite the live external reference', r, 0);
  T.check('archive result has no "dependents" key at all (§ 9: only rm/rm --cascade carry it)',
    !!r.json && !('dependents' in r.json), J(r.json && Object.keys(r.json)));

  const list = H.runJson(['list'], { cwd: d });
  const t2 = (list.json.entries || []).find(e => e.id === 'TSK-002');
  T.check('the referencing element sees active_refs_archived instead (§ 11: satisfied by definition)',
    !!t2 && (t2._problems || []).includes('active_refs_archived'), J(t2 && t2._problems));
}

T.finish();
