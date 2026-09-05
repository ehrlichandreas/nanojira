/* AC-42 — global flags before the command word, docs/SPECIFICATION.md
 * § 9 "Rules" (v3.6, DECISIONS 158 EV-6, promoted: commit b7a812f).
 *
 * AC-42 (§ 15): "nj --backlog=<path> list and nj --json list
 * --backlog=<path> both run list, byte-identical to the same call with
 * --backlog/--json placed after list; so does any other order or
 * repetition of just those two flags ahead of the command word. nj
 * --backlog=<path> show --id=X runs show --id=X against that backlog,
 * not unknown_field for --id. A flag other than --backlog/--json ahead
 * of the command word — including one valid for the command that
 * follows, e.g. nj --status=doing set --id=X — is unknown_field against
 * the bare command's own known flags (--backlog, --json), the whole
 * input parsed as the bare invocation; the command word that followed
 * is never run and never silently substituted for. nj --backlog=X alone
 * (every token a recognised global flag) is bare nj against that
 * backlog, unchanged. nj --version --backlog=X and nj --backlog=X
 * --version are each still unknown_field for --version (DECISIONS
 * 151/152), in either order."
 *
 * Found by an outside team (feedback/team-b-tests TSK-006): a
 * global flag before the command word used to silently drop the
 * command (`list` fell back to the bare status; `show` failed
 * unknown_field for `--id`).
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

H.requireNj();

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

function fixture(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(H.runNj(['init'], { cwd: dir }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic', '--description=D.'], { cwd: dir, env: { NJ_NOW: H.FIXED_NOW } }), 'new epic');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--description=D.', '--acceptance=- [x] x'],
    { cwd: dir, env: { NJ_NOW: H.FIXED_NOW } }), 'new TSK-001');
  return { dir, bl };
}
function run(args, cwd) { return H.runNj(args, { cwd, unsetEnv: ['NJ_BACKLOG'] }); }

/* ===================================================================== */
/* G1 — `--backlog` before `list`: must run `list`, not bare status      */
/* ===================================================================== */
{
  const x = fixture('ac42-g1');
  const canonical = run(['list', '--backlog=' + x.bl], x.dir);
  T.exit('G1 canonical `list --backlog=X`: exit 0', canonical, 0);

  const before = run(['--backlog=' + x.bl, 'list'], x.dir);
  T.exit('G1 `--backlog=X list`: exit 0', before, 0);
  T.eq('G1 `--backlog=X list` is byte-identical to `list --backlog=X`', before.stdout, canonical.stdout);
  T.check('G1 it is NOT the bare-status shape (no "Ready to work:" header)',
    !/Ready to work:/.test(before.stdout), J(before.stdout));
}

/* ===================================================================== */
/* G2 — `--backlog` before `show --id=…`: must run `show`, not           */
/* unknown_field for --id (the exact bug report)                         */
/* ===================================================================== */
{
  const x = fixture('ac42-g2');
  const canonical = H.runJson(['show', '--id=TSK-001', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G2 canonical `show --id=TSK-001 --backlog=X --json`: exit 0', canonical, 0);

  const before = H.runJson(['--backlog=' + x.bl, 'show', '--id=TSK-001'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G2 `--backlog=X show --id=TSK-001 --json`: exit 0', before, 0);
  T.eq('G2 byte-identical JSON to the canonical placement', before.json, canonical.json);
  T.check('G2 not the old unknown_field(id) bug',
    !(before.json && before.json.error === 'unknown_field'), J(before.json));
}

/* ===================================================================== */
/* G3 — `--json` before `list`, `--backlog` after: both global flags,    */
/* either order, either side of the command                              */
/* ===================================================================== */
{
  const x = fixture('ac42-g3');
  const canonical = H.runJson(['list', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  const r1 = H.runJson(['list', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.eq('G3 fixture sanity: two canonical calls agree', r1.json, canonical.json);

  const beforeJson = H.runNj(['--json', 'list', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  let parsed; try { parsed = JSON.parse(beforeJson.stdout); } catch (e) { parsed = null; }
  T.exit('G3 `--json list --backlog=X`: exit 0', beforeJson, 0);
  T.eq('G3 `--json list --backlog=X` is byte-identical JSON to canonical', parsed, canonical.json);

  const bothBefore = H.runNj(['--json', '--backlog=' + x.bl, 'list'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  let parsed2; try { parsed2 = JSON.parse(bothBefore.stdout); } catch (e) { parsed2 = null; }
  T.exit('G3 `--json --backlog=X list` (both global flags first): exit 0', bothBefore, 0);
  T.eq('G3 `--json --backlog=X list` is byte-identical JSON to canonical', parsed2, canonical.json);

  const reversedBefore = H.runNj(['--backlog=' + x.bl, '--json', 'list'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  let parsed3; try { parsed3 = JSON.parse(reversedBefore.stdout); } catch (e) { parsed3 = null; }
  T.exit('G3 `--backlog=X --json list` (reversed order): exit 0', reversedBefore, 0);
  T.eq('G3 `--backlog=X --json list` is byte-identical JSON to canonical', parsed3, canonical.json);
}

/* ===================================================================== */
/* G4 — `--backlog=X` alone (nothing else): bare `nj`, unchanged          */
/* ===================================================================== */
{
  const x = fixture('ac42-g4');
  const canonical = run([], x.dir).missing ? null : H.runNj(['--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  const bare = H.runNj(['--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G4 `nj --backlog=X` alone: exit 0', bare, 0);
  T.check('G4 bare status shape (has "Ready to work:" or similar short-status marker)',
    /entries ·|Ready to work:|Complete first:|backlog:/.test(bare.stdout), J(bare.stdout));
}

/* ===================================================================== */
/* G5 — an unrecognized flag before the command word: unknown_field,     */
/* the command never silently runs, never silently falls back either     */
/* ===================================================================== */
{
  const x = fixture('ac42-g5');
  const r = H.runJson(['--bogus', 'list', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G5 `--bogus list --backlog=X`: exit 1', r, 1);
  T.eq('G5 unknown_field', r.json && r.json.error, 'unknown_field');
}

/* ===================================================================== */
/* G5b — the scan really STOPS at the unknown flag, rather than merely   */
/* producing unknown_field for some other reason. `--bogus` above (G5)   */
/* is unrecognized by EVERY command, so a buggy scan that kept looking   */
/* for the command word past it, found `list`, and dispatched it with    */
/* `--bogus` still attached would ALSO land on unknown_field — list      */
/* rejects `--bogus` too, by coincidence, not because the scan stopped.  */
/* `--status` is not a global flag, but `list` (unlike bare `nj`) DOES   */
/* accept it; used with a value `list` would happily filter on, a scan   */
/* that kept going past it and reached `list` would exit 0, filtered —   */
/* not unknown_field. Observing unknown_field here is therefore only     */
/* possible if the scan stopped at `--status` and dispatched bare `nj`   */
/* (which does not know `--status`), proving the stop, not assuming it.  */
/* ===================================================================== */
{
  const x = fixture('ac42-g5b');
  const r = H.runJson(['--status=doing', 'list', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G5b `--status=doing list --backlog=X`: exit 1, not a filtered list', r, 1);
  T.eq('G5b unknown_field (bare `nj` does not know --status; `list` would have)', r.json && r.json.error, 'unknown_field');

  // Contrast: `list` genuinely does accept `--status`, placed correctly —
  // proof the flag itself isn't rejected everywhere, only ahead of the
  // command word where the scan has already stopped.
  const canonical = H.runJson(['list', '--status=doing', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G5b the canonical placement (--status after list) works: exit 0', canonical, 0);
}

/* ===================================================================== */
/* G6 — a command-specific flag before the command word is NOT reordered */
/* across the boundary: unknown_field against the bare command, the      */
/* later command never dispatched with it                                */
/* ===================================================================== */
{
  const x = fixture('ac42-g6');
  const before = H.runJson(['--status=doing', 'set', '--id=TSK-001'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G6 `--status=doing set --id=TSK-001`: exit 1', before, 1);
  T.eq('G6 unknown_field (not applied to `set` by reordering)', before.json && before.json.error, 'unknown_field');

  const afterStatus = H.runJson(['set', '--id=TSK-001', '--status=doing'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G6 the canonical placement (--status after set) still works: exit 0', afterStatus, 0);
}

/* ===================================================================== */
/* G7 — `--version`'s own exclusivity is untouched by this rule          */
/* (DECISIONS 151/152): combined with --backlog in either order, still   */
/* unknown_field for --version, never a backlog-scoped version query     */
/* ===================================================================== */
{
  const x = fixture('ac42-g7');
  const r1 = H.runJson(['--version', '--backlog=' + x.bl], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G7 `--version --backlog=X`: exit 1', r1, 1);
  T.eq('G7 `--version --backlog=X`: unknown_field', r1.json && r1.json.error, 'unknown_field');

  const r2 = H.runJson(['--backlog=' + x.bl, '--version'], { cwd: x.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G7 `--backlog=X --version`: exit 1', r2, 1);
  T.eq('G7 `--backlog=X --version`: unknown_field', r2.json && r2.json.error, 'unknown_field');
}

/* ===================================================================== */
/* G8 — repeated/conflicting --backlog: last occurrence wins, regardless */
/* of position relative to the command word                              */
/* ===================================================================== */
{
  const x1 = fixture('ac42-g8a');
  const x2 = fixture('ac42-g8b');
  const r = H.runJson(['--backlog=' + x1.bl, 'list', '--backlog=' + x2.bl], { cwd: x1.dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit('G8 two conflicting --backlog, pre- and post-command: exit 0', r, 0);
  T.eq('G8 the LAST --backlog wins (the one after the command)', r.json && r.json.backlog, x2.bl);
}

T.finish();
