'use strict';
/* AC-45 — bare `nj`'s "Ready to work" applies the leaf rule,
 * `list --ready` does not. docs/SPECIFICATION.md § 9 "`--ready`" (v3.6,
 * DECISIONS 158 EV-4, promoted: commit b7a812f).
 *
 * AC-45 (§ 15): "Given an epic whose only child is open (not done, not
 * archived) and otherwise --ready, bare nj omits the epic from 'Ready to
 * work' (the child appears instead, if it is itself --ready) while nj
 * list --ready still names the epic — the same backlog, two different,
 * both-correct answers, confirmed in one fixture rather than inferred.
 * An epic with no children, or whose children are all done/archived,
 * appears in both. This is the named, accepted replay class DECISIONS
 * 158 records: a bare-status call on a backlog containing such a
 * container differs from a pre-v3.6 baseline by construction."
 *
 * Found by an outside team (feedback/team-b-tests TSK-004): bare
 * `nj` listed epics under "Ready to work" even though every child was
 * blocked, with no rollup or problem code explaining it.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args, cwd, env) { return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
function runJ(args, cwd, env) { return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
const BODY = ['--description=D.', '--acceptance=- [x] x'];

/* ===================================================================== */
/* R1 — an epic with one open child: bare `nj` omits the epic, names the */
/* child instead; `list --ready` still names the epic                    */
/* ===================================================================== */
{
  const dir = H.freshDir('ac45-r1');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Open task'].concat(BODY), dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');

  const bare = runJ([], dir);
  T.exit('R1 bare nj --json: exit 0', bare, 0);
  const bareReadyIds = ((bare.json || {}).ready || []).map(e => e.id);
  T.check('R1 bare nj: EPIC-001 is NOT in "ready" (has an open child)', !bareReadyIds.includes('EPIC-001'), J(bareReadyIds));
  T.check('R1 bare nj: TSK-001 IS in "ready" instead', bareReadyIds.includes('TSK-001'), J(bareReadyIds));

  const listReady = runJ(['list', '--ready'], dir);
  T.exit('R1 list --ready --json: exit 0', listReady, 0);
  const listReadyIds = ((listReady.json || {}).entries || []).map(e => e.id);
  T.check('R1 list --ready: EPIC-001 IS named (unchanged, a pure readiness filter)',
    listReadyIds.includes('EPIC-001'), J(listReadyIds));
  T.check('R1 list --ready: TSK-001 is also named', listReadyIds.includes('TSK-001'), J(listReadyIds));
}

/* ===================================================================== */
/* R2 — human output agrees with the JSON: "Ready to work:" omits the    */
/* epic, `list --ready`'s own human output still names it                */
/* ===================================================================== */
{
  const dir = H.freshDir('ac45-r2');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=ParentEpic', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=ChildTask'].concat(BODY), dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');

  const bare = run([], dir);
  T.exit('R2 bare nj: exit 0', bare, 0);
  T.check('R2 bare nj human output: does not mention ParentEpic under Ready to work',
    !new RegExp('Ready to work:[\\s\\S]*ParentEpic').test(bare.stdout), J(bare.stdout));
  T.check('R2 bare nj human output: mentions ChildTask', /ChildTask/.test(bare.stdout), J(bare.stdout));

  const listReady = run(['list', '--ready'], dir);
  T.check('R2 list --ready human output: still mentions ParentEpic', /ParentEpic/.test(listReady.stdout), J(listReady.stdout));
}

/* ===================================================================== */
/* R3 — a childless epic appears in both (unaffected)                    */
/* ===================================================================== */
{
  const dir = H.freshDir('ac45-r3');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Lonely', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');

  const bare = runJ([], dir);
  T.check('R3 bare nj: the childless epic IS in ready', ((bare.json || {}).ready || []).some(e => e.id === 'EPIC-001'), J(bare.json));
  const listReady = runJ(['list', '--ready'], dir);
  T.check('R3 list --ready: the childless epic IS named', ((listReady.json || {}).entries || []).some(e => e.id === 'EPIC-001'), J(listReady.json));
}

/* ===================================================================== */
/* R4 — an epic whose only child is `done` appears in both (no open      */
/* child left)                                                           */
/* ===================================================================== */
{
  const dir = H.freshDir('ac45-r4');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Done-children', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Finished'].concat(BODY), dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: H.FIXED_NOW }), 'mark TSK-001 done');

  const bare = runJ([], dir);
  T.check('R4 bare nj: the epic (all children done) IS in ready', ((bare.json || {}).ready || []).some(e => e.id === 'EPIC-001'), J(bare.json));
}

/* ===================================================================== */
/* R5 — an epic whose only child is archived appears in both (archived   */
/* never counts as open)                                                 */
/* ===================================================================== */
{
  const dir = H.freshDir('ac45-r5');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Archived-child', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Gone'].concat(BODY), dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: H.FIXED_NOW }), 'mark done');
  ok(run(['archive', '--id=TSK-001'], dir, { NJ_NOW: H.FIXED_NOW }), 'archive it');

  const bare = runJ([], dir);
  T.check('R5 bare nj: the epic (only child archived) IS in ready', ((bare.json || {}).ready || []).some(e => e.id === 'EPIC-001'), J(bare.json));
}

T.finish();
