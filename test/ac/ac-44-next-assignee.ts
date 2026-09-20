/* AC-44 — `nj next` respects an existing `assignee`, docs/SPECIFICATION.md
 * § 12b (v3.6, DECISIONS 158 PA-5, promoted: commit b7a812f).
 *
 * AC-44 (§ 15): "A --ready, leaf element with assignee set to a name
 * other than the acting name is never a candidate: given TSK-001
 * (assignee: bob) and TSK-002 (unassigned), both otherwise equally
 * ranked, nj next --as=alice claims TSK-002, skipping TSK-001 entirely
 * (not even in skipped, since it was never a candidate to begin with —
 * the same way an element claimed by someone else never appears as a
 * next candidate either). nj next --as=bob (matching TSK-001's own
 * assignee) claims TSK-001. The comparison is exact, byte-for-byte —
 * Bob does not match bob, and an assignee with incidental whitespace
 * matches nothing. --assignee= (empty) narrows to unassigned candidates
 * only; --assignee=<the acting name> narrows to candidates already
 * assigned to the acting name; --assignee=<anyone else> always yields
 * none_ready (the filter and the default can never both be satisfied by
 * the same candidate unless the two names are the same). list --ready
 * is unchanged by any of this — confirmed by a fixture where list
 * --ready still shows an element assigned to someone else, while next
 * --as=<a different name> does not offer it."
 *
 * Found by an outside team (feedback/team-a TSK-004/TSK-005): `nj
 * next` used to hand out an element explicitly assigned to someone
 * else, including an author's own review.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args: string[], cwd: string, env?: Record<string, string | undefined>) { return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
function runJ(args: string[], cwd: string, env?: Record<string, string | undefined>) { return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
const BODY = ['--description=D.', '--acceptance=- [x] x'];

function twoTaskFixture(label: string, assigneeOfFirst?: string) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const t1 = ['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY);
  if (assigneeOfFirst !== undefined) t1.push('--assignee=' + assigneeOfFirst);
  ok(run(t1, dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Two'].concat(BODY), dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-002');
  return { dir, bl };
}

/* ===================================================================== */
/* A1 — the core rule: a different acting name skips the assigned one,   */
/* an unassigned candidate is picked instead                              */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a1', 'bob');
  const r = runJ(['next', '--as=alice'], x.dir);
  T.exit('A1 next --as=alice: exit 0', r, 0);
  T.eq('A1 picks TSK-002 (unassigned), not TSK-001 (assigned to bob)', r.json && r.json.id, 'TSK-002');
  T.eq('A1 TSK-001 is not even in skipped — it was never a candidate', r.json && r.json.skipped, []);
}

/* ===================================================================== */
/* A2 — the matching acting name DOES get the assigned element           */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a2', 'bob');
  const r = runJ(['next', '--as=bob'], x.dir);
  T.exit('A2 next --as=bob: exit 0', r, 0);
  T.eq('A2 bob gets TSK-001, the one assigned to bob', r.json && r.json.id, 'TSK-001');
}

/* ===================================================================== */
/* A3 — exact, byte-for-byte comparison: case and whitespace both matter */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a3', 'Bob');
  const r = runJ(['next', '--as=bob'], x.dir);
  T.exit('A3 next --as=bob when assignee is "Bob" (different case): exit 0', r, 0);
  T.eq('A3 "bob" does not match "Bob" — TSK-002 (unassigned) is picked instead', r.json && r.json.id, 'TSK-002');
}
{
  const x = twoTaskFixture('ac44-a3-ws', ' bob');
  const r = runJ(['next', '--as=bob'], x.dir);
  T.exit('A3 next --as=bob when assignee has incidental leading whitespace: exit 0', r, 0);
  T.eq('A3 " bob" does not match "bob" — TSK-002 (unassigned) is picked instead', r.json && r.json.id, 'TSK-002');
}

/* ===================================================================== */
/* A4 — `--assignee=` (empty): narrows to unassigned candidates only,    */
/* excluding ones already assigned to the acting name itself             */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a4', 'alice');
  const r = runJ(['next', '--as=alice', '--assignee='], x.dir);
  T.exit('A4 next --as=alice --assignee= : exit 0', r, 0);
  T.eq('A4 picks TSK-002 (unassigned), excluding TSK-001 (assigned to alice herself)', r.json && r.json.id, 'TSK-002');
}

/* ===================================================================== */
/* A5 — `--assignee=<acting name>`: narrows to candidates already        */
/* assigned to the acting name, excluding unassigned ones                 */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a5', 'alice');
  const r = runJ(['next', '--as=alice', '--assignee=alice'], x.dir);
  T.exit('A5 next --as=alice --assignee=alice: exit 0', r, 0);
  T.eq('A5 picks TSK-001 (assigned to alice), excluding unassigned TSK-002', r.json && r.json.id, 'TSK-001');
}

/* ===================================================================== */
/* A6 — `--assignee=<anyone else>`: always none_ready (the filter and     */
/* the default can never both be satisfied unless the names agree)       */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a6');
  const r = runJ(['next', '--as=alice', '--assignee=carol'], x.dir);
  T.exit('A6 next --as=alice --assignee=carol: exit 1', r, 1);
  T.eq('A6 none_ready', r.json && r.json.error, 'none_ready');
}

/* ===================================================================== */
/* A7 — `list --ready` is unchanged: still shows an element assigned to  */
/* someone else, even though `next` would never offer it                 */
/* ===================================================================== */
{
  const x = twoTaskFixture('ac44-a7', 'bob');
  const listR = runJ(['list', '--ready'], x.dir, { NJ_AUTHOR: 'alice' });
  T.exit('A7 list --ready --as=alice: exit 0', listR, 0);
  T.check('A7 list --ready still names TSK-001 (assigned to bob) — unchanged by PA-5',
    ((listR.json || {}).entries || []).some((e: any) => e.id === 'TSK-001'), J(listR.json));

  const nextR = runJ(['next', '--as=alice'], x.dir);
  T.exit('A7 next --as=alice: exit 0', nextR, 0);
  T.eq('A7 but next --as=alice never offers TSK-001', nextR.json && nextR.json.id, 'TSK-002');
}

/* ===================================================================== */
/* A8 — the PA-4 scenario directly: an author cannot pick up a review    */
/* explicitly assigned to someone else                                    */
/* ===================================================================== */
{
  const dir = H.freshDir('ac44-a8');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Review the PR', '--assignee=reviewer'].concat(BODY),
    dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001 (the review, assigned to reviewer)');
  const r = runJ(['next', '--as=author'], dir);
  T.exit('A8 the author tries next: exit 1 (nothing else ready)', r, 1);
  T.eq('A8 none_ready — the review assigned to reviewer is never offered to author', r.json && r.json.error, 'none_ready');
  const r2 = runJ(['next', '--as=reviewer'], dir);
  T.exit('A8 the reviewer gets it: exit 0', r2, 0);
  T.eq('A8 reviewer claims TSK-001', r2.json && r2.json.id, 'TSK-001');
}

T.finish();
