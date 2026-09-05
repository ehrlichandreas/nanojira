/* AC-51 — `show --json` carries `entry`, docs/SPECIFICATION.md § 9
 * "JSON shapes per command" (v3.8, DECISIONS 171 C, promoted:
 * commit <pending>).
 *
 * AC-51 (§ 15): "Additive: identical to entries[0], present exactly when
 * entries has one element -- never for a duplicate_id target (two
 * entries) or, in principle, none. list/find never carry it."
 *
 * Removes the list-shape trap that bit the Oracle's own AC authors twice
 * (D157, D168): `nj show --json` on a single id returns the same
 * {backlog, counts, entries: [...]} shape list does, not a bare object --
 * a script that assumed otherwise read `entry.tags` on `undefined` and
 * the check silently never compared anything (not a hypothetical: this
 * exact mistake shipped in two different AC files before being caught).
 *
 * Replay class this introduces: a `show --json` call that resolves to
 * exactly one entry now differs from a pre-v3.8 baseline by
 * construction -- the JSON result gains the additive `entry` key. A
 * duplicate_id show (two entries) is unaffected and replays identically
 * to before, since `entry` never appears there.
 *
 * Written before the fix lands: red against the current build (the key
 * does not exist yet).
 */
import fs from 'fs';
import path from 'path';
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

/* ===================================================================== */
/* C1 — show --json --id=<single>: entry is present and identical to     */
/* entries[0]                                                            */
/* ===================================================================== */
{
  const dir = H.freshDir('ac51-c1');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const r = runJ(['show', '--id=EPIC-001'], dir);
  T.exit('C1 show --json: exit 0', r, 0);
  T.check('C1 entry is present', r.json && 'entry' in r.json, J(r.json));
  T.eq('C1 entry is identical to entries[0]', r.json && r.json.entry, r.json && r.json.entries && r.json.entries[0]);
}

/* ===================================================================== */
/* C2 — show --json --file=<path>: also a single resolve, entry present  */
/* ===================================================================== */
{
  const dir = H.freshDir('ac51-c2');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const r = runJ(['show', '--file=' + path.join(dir, 'backlog', 'epics', 'EPIC-001.md')], dir);
  T.exit('C2 show --json --file=: exit 0', r, 0);
  T.eq('C2 entry is identical to entries[0]', r.json && r.json.entry, r.json && r.json.entries && r.json.entries[0]);
}

/* ===================================================================== */
/* C3 — a duplicate_id show (two files carry the same id): entries has   */
/* two elements, entry is ABSENT -- not present-but-undefined, not the   */
/* first of the two, genuinely missing from the object                   */
/* ===================================================================== */
{
  const dir = H.freshDir('ac51-c3');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  // Duplicate: hand-copy TSK-001.md to a second file carrying the same id.
  const bl = path.join(dir, 'backlog');
  fs.copyFileSync(path.join(bl, 'tasks', 'TSK-001.md'), path.join(bl, 'tasks', 'TSK-001-copy.md'));
  const r = runJ(['show', '--id=TSK-001'], dir);
  T.exit('C3 show --json on a duplicate_id: exit 0', r, 0);
  T.eq('C3 entries has two elements', r.json && r.json.entries && r.json.entries.length, 2);
  T.check('C3 entry key is absent (not present for a duplicate_id target)', !(r.json && 'entry' in r.json), J(r.json));
}

/* ===================================================================== */
/* C4 — list/find never carry `entry`, even when they resolve to exactly */
/* one element -- the field is show-specific, not "exactly one result"   */
/* in general                                                             */
/* ===================================================================== */
{
  const dir = H.freshDir('ac51-c4');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=Unique', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const rl = runJ(['list'], dir);
  T.eq('C4 list: exactly one entry (fixture sanity)', rl.json && rl.json.entries && rl.json.entries.length, 1);
  T.check('C4 list never carries entry, even with exactly one result', !(rl.json && 'entry' in rl.json), J(rl.json));

  const rf = runJ(['find', 'Unique'], dir);
  T.eq('C4 find: exactly one hit (fixture sanity)', rf.json && rf.json.entries && rf.json.entries.length, 1);
  T.check('C4 find never carries entry either', !(rf.json && 'entry' in rf.json), J(rf.json));
}

T.finish();
