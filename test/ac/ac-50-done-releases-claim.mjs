/* AC-50 — final status releases the claim, docs/SPECIFICATION.md § 12a
 * "Final status releases the claim" (v3.8, DECISIONS 171 B, promoted:
 * commit <pending>).
 *
 * AC-50 (§ 15): "A write that sets status to the last configured status
 * (always done) via nj set, nj claim --status=<last>, or
 * nj next --status=<last> releases the element's existing claim,
 * whoever holds it, in the same call -- reported additively as
 * released: '<holder>', absent when there was none to release.
 * Unconditional: not nj release's own ownership check. A refused
 * set --status=done (children_open, without --allow-open-children)
 * releases nothing; a forced one does. The release is attempted before
 * the guarded write and rolled back if that write fails, the same order
 * and rollback discipline nj claim's own mirror write already has."
 *
 * Found by an outside team (feedback/team-b-tests TSK-013): the new
 * claim:stale warning found 12 stale claims, 10 of them on elements
 * already done -- claimed, finished, never released, because release is
 * a separate step agents forget.
 *
 * Replay class this introduces: a set/claim/next call that reaches the
 * last configured status on a CLAIMED element now differs from a
 * pre-v3.8 baseline by construction -- the JSON result gains `released`,
 * and the claims directory gains one more entry (a `released` generation)
 * it would not have had before. An unclaimed element reaching the same
 * status is unaffected (no new claims entry, no `released` key) and so
 * replays identically to before.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers (the field does not exist yet, and nothing is
 * released automatically).
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

H.requireNj();

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args, cwd, env) { return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
function runJ(args, cwd, env) { return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }

function fixture(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task');
  return dir;
}

/* ===================================================================== */
/* B1 — set --status=done on a CLAIMED element: releases it, result      */
/* carries released:<holder> -- and since `set` has no --as/actor at     */
/* all, this is already "whoever holds it", not an acting-name match     */
/* ===================================================================== */
{
  const dir = fixture('ac50-b1');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], dir), 'claim as alice');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('B1 set --status=done: exit 0', r, 0);
  T.eq('B1 result carries released:"alice"', r.json && r.json.released, 'alice');

  const after = runJ(['show', '--id=TSK-001'], dir);
  T.eq('B1 the element is unclaimed afterward (_claim null)', after.json && after.json.entries && after.json.entries[0] && after.json.entries[0]._claim, null);
}

/* ===================================================================== */
/* B2 — unclaimed element set to done: no `released` key at all (absent, */
/* not null)                                                              */
/* ===================================================================== */
{
  const dir = fixture('ac50-b2');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('B2 set --status=done (unclaimed): exit 0', r, 0);
  T.check('B2 "released" key is absent, not null', !('released' in (r.json || {})), J(r.json));
}

/* ===================================================================== */
/* B3 — a REFUSED set --status=done (children_open, no                  */
/* --allow-open-children) releases nothing: the claim survives           */
/* ===================================================================== */
{
  const dir = fixture('ac50-b3');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.', '--acceptance=- [ ] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new open subtask');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], dir), 'claim as alice');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('B3 refused set --status=done (open child): exit 1', r, 1);
  T.eq('B3 refused:children_open', r.json && r.json.error, 'refused:children_open');

  const after = runJ(['show', '--id=TSK-001'], dir);
  T.eq('B3 the claim is untouched: still alice', after.json && after.json.entries && after.json.entries[0] && after.json.entries[0]._claim && after.json.entries[0]._claim.by, 'alice');
}

/* ===================================================================== */
/* B4 — a FORCED set --status=done (--allow-open-children) still         */
/* releases: the write proceeds, so the release applies the same as any  */
/* other successful final-status write                                   */
/* ===================================================================== */
{
  const dir = fixture('ac50-b4');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.', '--acceptance=- [ ] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new open subtask');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], dir), 'claim as alice');
  const r = runJ(['set', '--id=TSK-001', '--status=done', '--allow-open-children'], dir);
  T.exit('B4 forced set --status=done: exit 0', r, 0);
  T.eq('B4 result carries released:"alice"', r.json && r.json.released, 'alice');
}

/* ===================================================================== */
/* B5 — claim --status=done: releases the claim it just made, in the    */
/* SAME call -- the claims sequence gains both entries (claimed then     */
/* released); the final state is unclaimed                               */
/* ===================================================================== */
{
  const dir = fixture('ac50-b5');
  const r = runJ(['claim', '--id=TSK-001', '--as=alice', '--status=done'], dir);
  T.exit('B5 claim --status=done: exit 0', r, 0);
  T.eq('B5 result carries released:"alice" (released what it just claimed)', r.json && r.json.released, 'alice');
  T.eq('B5 result\'s own claim field is null (released by the end of the call)', r.json && r.json.claim, null);

  const after = runJ(['show', '--id=TSK-001'], dir);
  T.eq('B5 the element is unclaimed afterward', after.json && after.json.entries && after.json.entries[0] && after.json.entries[0]._claim, null);
}

/* ===================================================================== */
/* B6 — next --status=done: same as claim --status=done, since next     */
/* claims via the same path                                              */
/* ===================================================================== */
{
  const dir = fixture('ac50-b6');
  const r = runJ(['next', '--as=alice', '--status=done'], dir);
  T.exit('B6 next --status=done: exit 0', r, 0);
  T.eq('B6 result carries released:"alice"', r.json && r.json.released, 'alice');
  T.eq('B6 result\'s own claim field is null', r.json && r.json.claim, null);
}

/* ===================================================================== */
/* B7 — batch set --id=A,B --status=done: per-ID, independently -- one   */
/* claimed, one not                                                       */
/* ===================================================================== */
{
  const dir = H.freshDir('ac50-b7');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-002');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], dir), 'claim TSK-001 as alice');
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--status=done'], dir);
  T.exit('B7 batch set --status=done: exit 0', r, 0);
  const byId = {};
  for (const one of (r.json && r.json.results) || []) byId[one.id] = one;
  T.eq('B7 TSK-001 (was claimed): released:"alice"', byId['TSK-001'] && byId['TSK-001'].released, 'alice');
  T.check('B7 TSK-002 (never claimed): no released key', byId['TSK-002'] && !('released' in byId['TSK-002']), J(byId['TSK-002']));
}

/* ===================================================================== */
/* B8 — a NON-final status (--status=doing) does NOT release: contrast,  */
/* confirming the rule is specifically about the LAST status, not any    */
/* status write                                                           */
/* ===================================================================== */
{
  const dir = fixture('ac50-b8');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], dir), 'claim as alice');
  const r = runJ(['set', '--id=TSK-001', '--status=doing'], dir);
  T.exit('B8 set --status=doing: exit 0', r, 0);
  T.check('B8 no released key (not the last status)', !('released' in (r.json || {})), J(r.json));

  const after = runJ(['show', '--id=TSK-001'], dir);
  T.eq('B8 still claimed by alice', after.json && after.json.entries && after.json.entries[0] && after.json.entries[0]._claim && after.json.entries[0]._claim.by, 'alice');
}

T.finish();
