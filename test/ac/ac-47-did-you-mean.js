'use strict';
/* AC-47 — did-you-mean, docs/SPECIFICATION.md § 9 "Did-you-mean" (v3.6,
 * DECISIONS 158 EV-3, promoted: commit 755820e; tightened by DECISIONS
 * 160, commit 8554333).
 *
 * AC-47 (§ 15): "--priority=medium is still invalid_value, its hint now
 * did you mean 'normal'? Known priorities: … (the fixed synonym, checked
 * first). A --status/--type/--priority value within the length-dependent
 * threshold (OSA distance ≤ 1 for a ≤ 4-character value, ≤ 2 otherwise)
 * of exactly one allowed value gets the same treatment; a value
 * equidistant from two allowed values, or further than the threshold
 * from all of them, gets the unchanged hint with no suggestion —
 * confirmed with a constructed tie case, not merely a documented
 * intention. No alias is ever accepted as the value itself: nj set
 * --priority=medium still fails, exactly as before."
 *
 * Found by an outside team (feedback/team-a TSK-001): --priority=
 * medium is rejected with no indication of what to use instead.
 *
 * DECISIONS 160: a replay showed --status=nope hinting "did you mean
 * 'done'?" — correct under the old flat ≤ 2 rule, but noise (distance 2
 * replaces half of a 4-character word). New threshold is length-
 * dependent: ≤ 1 when the input has ≤ 4 characters, ≤ 2 otherwise.
 * Addendum: distance is OSA (optimal string alignment), which counts an
 * adjacent transposition as a single edit, not two substitutions — so
 * "hgih"→high and "tsak"→task (both a transposed pair) are distance 1,
 * not 2, and stay hinted even at 4 characters; "nope"→done has no
 * transposition available and stays at distance 2, so it does not.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
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

function fixture(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  return dir;
}

/* ===================================================================== */
/* D1 — the fixed synonym table: `medium` -> `normal`, checked first,    */
/* regardless of edit distance                                           */
/* ===================================================================== */
{
  const dir = fixture('ac47-d1');
  const r = runJ(['set', '--id=EPIC-001', '--priority=medium'], dir);
  T.exit('D1 --priority=medium: exit 1', r, 1);
  T.eq('D1 still invalid_value — no alias is ever accepted', r.json && r.json.error, 'invalid_value');
  T.check('D1 the hint suggests normal', /did you mean 'normal'\?/.test(r.json && r.json.hint || ''), J(r.json));
  T.check('D1 the hint still lists the known priorities', /Known priorities: low, normal, high, urgent/.test(r.json && r.json.hint || ''), J(r.json));

  const el = H.readOrNull(require('path').join(dir, 'backlog', 'epics', 'EPIC-001.md')) || '';
  T.check('D1 priority was never written', !/^priority:/m.test(el), el);
}

/* ===================================================================== */
/* D2 — a ≤ 4-character value, OSA distance 1 via an adjacent            */
/* transposition, unambiguous: a priority typo (DECISIONS 160's own      */
/* named example — "hgih"→high is 2 edits under plain Levenshtein, which  */
/* would put it over the ≤ 1 threshold, but 1 under OSA, so it stays     */
/* hinted)                                                                */
/* ===================================================================== */
{
  const dir = fixture('ac47-d2');
  const r = runJ(['set', '--id=EPIC-001', '--priority=hgih'], dir);
  T.exit('D2 --priority=hgih: exit 1', r, 1);
  T.eq('D2 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D2 the hint suggests high (4 characters, OSA distance 1 via the gi/ih transposition, unambiguous)', /did you mean 'high'\?/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D3 — the same OSA-transposition case for --type (DECISIONS 160's own  */
/* named example, "tsak"→task)                                           */
/* ===================================================================== */
{
  const dir = H.freshDir('ac47-d3');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const r = runJ(['new', '--type=tsak', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('D3 --type=tsak: exit 1', r, 1);
  T.eq('D3 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D3 the hint suggests task (4 characters, OSA distance 1 via the sa/as transposition, unambiguous)', /did you mean 'task'\?/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D4 — a ≤ 4-character value, distance 1, unambiguous: a status typo    */
/* (against the DEFAULT statuses list)                                   */
/* ===================================================================== */
{
  const dir = fixture('ac47-d4');
  const r = runJ(['set', '--id=EPIC-001', '--status=don'], dir);
  T.exit('D4 --status=don: exit 1', r, 1);
  T.eq('D4 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D4 the hint suggests done (distance 1 from done, 2 from doing — unambiguous)',
    /did you mean 'done'\?/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D5 — a constructed TIE: equidistant from two allowed values —         */
/* no suggestion, the plain hint only                                    */
/* ===================================================================== */
{
  const dir = H.mkBacklog({
    label: 'ac47-d5',
    config: JSON.stringify({
      schema: 1,
      statuses: ['aaa', 'aab', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    }, null, 2) + '\n',
  });
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const r = runJ(['set', '--id=EPIC-001', '--status=aac'], dir);
  T.exit('D5 --status=aac (equidistant from aaa and aab): exit 1', r, 1);
  T.eq('D5 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D5 NO suggestion is made (a tie must not guess)', !/did you mean/.test(r.json && r.json.hint || ''), J(r.json));
  T.check('D5 the plain known-values hint is still present', /Known statuses: aaa, aab, done/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D6 — further than the threshold from everything: no suggestion either */
/* ===================================================================== */
{
  const dir = fixture('ac47-d6');
  const r = runJ(['set', '--id=EPIC-001', '--priority=zzzzzzzz'], dir);
  T.exit('D6 a wildly wrong priority: exit 1', r, 1);
  T.eq('D6 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D6 no suggestion (nothing is within the threshold)', !/did you mean/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D7 (DECISIONS 160) — a ≤ 4-character value at distance 2: NO          */
/* suggestion. The replay that triggered 160: --status=nope hinted       */
/* "did you mean 'done'?" under the old flat ≤ 2 rule; "nope" is 4       */
/* characters, so the new threshold for it is ≤ 1, and OSA distance 2 is */
/* over that — unlike D2/D3's typos, nope/done has no adjacent           */
/* transposition to shorten it (n/d and p/n are substitutions, not a     */
/* swap).                                                                 */
/* ===================================================================== */
{
  const dir = fixture('ac47-d7');
  const r = runJ(['set', '--id=EPIC-001', '--status=nope'], dir);
  T.exit('D7 --status=nope: exit 1', r, 1);
  T.eq('D7 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D7 no suggestion (4 characters, OSA distance 2 from done — over the ≤ 1 threshold)',
    !/did you mean/.test(r.json && r.json.hint || ''), J(r.json));
}

/* ===================================================================== */
/* D8 (DECISIONS 160) — a > 4-character typo still works, unaffected by  */
/* the tightened threshold (which only tightens ≤ 4-character values):   */
/* "urgnet"→urgent (the ne/en transposition, OSA distance 1 — well under  */
/* either threshold, demonstrating the >4-character case is untouched)   */
/* ===================================================================== */
{
  const dir = fixture('ac47-d8');
  const r = runJ(['set', '--id=EPIC-001', '--priority=urgnet'], dir);
  T.exit('D8 --priority=urgnet: exit 1', r, 1);
  T.eq('D8 invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('D8 the hint suggests urgent (6 characters, OSA distance 1 via the ne/en transposition, unambiguous)',
    /did you mean 'urgent'\?/.test(r.json && r.json.hint || ''), J(r.json));
}

T.finish();
