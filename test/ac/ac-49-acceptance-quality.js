'use strict';
/* AC-49 — acceptance quality warnings + problems.ignore + config forward
 * compatibility, docs/SPECIFICATION.md § 5/§ 7 "Acceptance quality
 * warnings" / "Warnings can be switched off per backlog" / "Config
 * forward compatibility" (v3.7, DECISIONS 163 E/F, 165, 166, promoted:
 * commit <pending>).
 *
 * AC-49 (§ 15): "Two new, never-blocking problem codes (task/subtask
 * only): acceptance:no_checkbox when the acceptance section has content
 * but zero countable checkbox lines within its own span;
 * done:no_acceptance when status is done and the acceptance section is
 * absent/empty (alongside incomplete:acceptance, which still fires too).
 * Both are doctor warnings (exit code unaffected) and appear in
 * new/set/note/check's own text feedback. Neither changes --ready, list,
 * or any count. An optional problems.ignore config list of
 * warning-severity codes suppresses them everywhere they're reported --
 * doctor, _problems, write feedback, doctor's own warning tally -- but
 * never the readiness computation itself. A known error or incomplete:*
 * code in that list is invalid_config; an unknown one is the warning
 * config:unknown_code and is skipped (DECISIONS 166). An unrecognised
 * top-level config key, or one inside layout/layout.folders/claims/
 * problems, is the warning config:unknown_key, not invalid_config
 * (DECISIONS 166, correcting 165's own premise). An optional
 * minVersion: 'X.Y.Z' fails every command, including doctor, with
 * needs_newer_nj (naming both versions) when the running nj compares
 * older -- numeric tuple comparison, not a string compare -- checked
 * before any other validation; --version and --help are unaffected,
 * structurally, not as a special case. A malformed minVersion is
 * invalid_config."
 *
 * Found by an outside team: feedback/team-b-tests TSK-011
 * (acceptance text without '- [ ]' lines is silently untickable, doctor
 * says nothing); feedback/team-a TSK-006 (a done task with empty
 * acceptance criteria, doctor says nothing). problems.ignore (DECISIONS
 * 165) followed directly from the Oracle's own read-only count for E/F
 * against team-b-app-test's real backlog: 287
 * done:no_acceptance warnings is noise for a team whose empty acceptance
 * is deliberate (one-task-per-test-case elements tracked via tags).
 * DECISIONS 166 (team-b-tests TSK-012) amends 165 and extends it:
 * the Lead had assumed an older nj already rejects an unknown top-level
 * config key and had not checked; the Oracle found, and the Lead
 * confirmed live against 3.5.0 and 3.6.0, that it is silently ignored
 * instead -- which is what makes problems/minVersion safe additions for
 * a not-yet-upgraded fleet, and what the new config:unknown_key warning
 * (and minVersion's own needs_newer_nj gate) are built on.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers (neither code exists in SEVERITY yet, so neither
 * ever appears in _problems or doctor's report; the problems config key
 * is not validated or acted on at all yet).
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

function freshBacklog(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  return dir;
}

/* ===================================================================== */
/* E1 — acceptance has content but no checkbox line: acceptance:no_checkbox */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-e1');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=Just a sentence, no checkbox.'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E1 nj new: exit 0', r, 0);
  T.check('E1 _problems carries acceptance:no_checkbox',
    (r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
  T.check('E1 _problems does NOT carry incomplete:acceptance (section has content)',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('incomplete:acceptance'), J(r.json));

  const d = runJ(['doctor'], dir);
  const finding = (d.json && d.json.problems || []).find((p) => p.code === 'acceptance:no_checkbox');
  T.check('E1 doctor reports acceptance:no_checkbox', !!finding, J(d.json));
  T.eq('E1 doctor severity is warning', finding && finding.severity, 'warning');
  T.eq('E1 doctor exit code unaffected (0, no errors)', d.status, 0);
}

/* ===================================================================== */
/* E2 — acceptance has a real checkbox line: no acceptance:no_checkbox   */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-e2');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [ ] a real checkbox'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E2 nj new: exit 0', r, 0);
  T.check('E2 _problems does NOT carry acceptance:no_checkbox',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* E3 — acceptance absent entirely: incomplete:acceptance fires, NOT     */
/* acceptance:no_checkbox (mutually exclusive — no_checkbox requires     */
/* content to exist at all)                                              */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-e3');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E3 nj new: exit 0', r, 0);
  const probs = (r.json && r.json.entry && r.json.entry._problems) || [];
  T.check('E3 _problems carries incomplete:acceptance', probs.includes('incomplete:acceptance'), J(r.json));
  T.check('E3 _problems does NOT carry acceptance:no_checkbox', !probs.includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* E4 — a checkbox-looking line inside a FENCED code block within        */
/* acceptance does not count: still acceptance:no_checkbox               */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-e4');
  const acceptance = 'Example:\n```\n- [ ] not a real item, just an example\n```\n';
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=' + acceptance], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E4 nj new: exit 0', r, 0);
  T.check('E4 _problems carries acceptance:no_checkbox (fenced example does not count)',
    (r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* E6 (Verifier) — a checkbox in a DIFFERENT section (Description) does  */
/* not satisfy acceptance:no_checkbox: the warning is about the          */
/* acceptance section's OWN span, not whether a checkbox exists anywhere */
/* in the body                                                           */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-e6');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T',
    '--description=' + '- [ ] a checkbox, but in Description', '--acceptance=prose only, no checkbox here'],
    dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E6 nj new: exit 0', r, 0);
  T.check('E6 _problems carries acceptance:no_checkbox (a checkbox in Description does not count)',
    (r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* E5 — epics are exempt: no acceptance section concept, never this code */
/* ===================================================================== */
{
  const dir = H.freshDir('ac49-e5');
  ok(run(['init'], dir), 'nj init');
  const r = runJ(['new', '--type=epic', '--title=E', '--description=prose, no checkbox anywhere'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('E5 nj new epic: exit 0', r, 0);
  T.check('E5 an epic never carries acceptance:no_checkbox',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* F1 — a done task with empty acceptance: done:no_acceptance (and       */
/* incomplete:acceptance still fires too — independent axes)             */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-f1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, no acceptance');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('F1 nj set --status=done: exit 0 (never blocked)', r, 0);
  const probs = (r.json && r.json.entry && r.json.entry._problems) || [];
  T.check('F1 _problems carries done:no_acceptance', probs.includes('done:no_acceptance'), J(r.json));
  T.check('F1 _problems also carries incomplete:acceptance (independent axis, still fires)',
    probs.includes('incomplete:acceptance'), J(r.json));

  const d = runJ(['doctor'], dir);
  const finding = (d.json && d.json.problems || []).find((p) => p.code === 'done:no_acceptance');
  T.check('F1 doctor reports done:no_acceptance', !!finding, J(d.json));
  T.eq('F1 doctor severity is warning', finding && finding.severity, 'warning');
  T.eq('F1 doctor exit code unaffected (0, no errors)', d.status, 0);
}

/* ===================================================================== */
/* F2 — a done task WITH acceptance content (even without a checkbox):   */
/* no done:no_acceptance                                                 */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-f2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=some prose, no checkbox'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('F2 nj set --status=done: exit 0', r, 0);
  T.check('F2 _problems does NOT carry done:no_acceptance (content exists)',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('done:no_acceptance'), J(r.json));
}

/* ===================================================================== */
/* F3 — NOT done, empty acceptance: incomplete:acceptance fires, NOT     */
/* done:no_acceptance (only `done` triggers F)                           */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-f3');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('F3 nj new (status todo): exit 0', r, 0);
  T.check('F3 _problems does NOT carry done:no_acceptance (not done)',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('done:no_acceptance'), J(r.json));
}

/* ===================================================================== */
/* G1 — neither warning changes --ready, list, or counts: an element     */
/* with E is still --ready if otherwise complete                          */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-g1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=prose only, no checkbox'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task');
  const r = runJ(['list', '--ready'], dir);
  T.check('G1 the element with acceptance:no_checkbox is still --ready (never blocks)',
    (r.json && r.json.entries || []).some((e) => e.id === 'TSK-001'), J(r.json));
  const counts = runJ(['list'], dir).json && runJ(['list'], dir).json.counts;
  T.eq('G1 counts.incomplete is 0 (acceptance:no_checkbox is not an incomplete:* code)', counts && counts.incomplete, 0);
}

/* ===================================================================== */
/* H1 — exact text feedback for both warnings, via nj new/set             */
/* ===================================================================== */
{
  const dir = freshBacklog('ac49-h1');
  const r = run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=prose, no checkbox'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('H1 nj new: exit 0', r, 0);
  T.check('H1 exact prose for acceptance:no_checkbox',
    /has acceptance criteria with no checkbox items — nothing for check to tick\./.test(r.stdout), J(r.stdout));

  const dir2 = freshBacklog('ac49-h1b');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.'], dir2, { NJ_NOW: H.FIXED_NOW }), 'new task, no acceptance');
  const r2 = run(['set', '--id=TSK-001', '--status=done'], dir2, { NJ_NOW: H.FIXED_NOW });
  T.exit('H1 nj set --status=done: exit 0', r2, 0);
  T.check('H1 exact prose for done:no_acceptance',
    /is done with no acceptance criteria\./.test(r2.stdout), J(r2.stdout));
}

/* ===================================================================== */
/* I — `problems.ignore` (DECISIONS 165): a config-level opt-out for      */
/* warning-severity codes, suppressed everywhere they're reported but     */
/* never changing the readiness computation itself.                      */
/* ===================================================================== */

function configWithIgnore(ignore) {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    problems: { ignore },
  }, null, 2) + '\n';
}

function epicFile() {
  return H.element(
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW },
    '# E\n\n## Description\nD.\n',
  );
}

/* DECISIONS 167: an ARCHIVED EPIC-001, parent of the done+empty-acceptance
 * TSK-001 below -- so the fixture is a valid archived subtree (an archived
 * element's parent must itself be archived, § 11a), not just one file with
 * an `archived:` stamp in isolation. */
function archivedEpicFile() {
  return H.element(
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', archived: H.FIXED_NOW, created: H.FIXED_NOW, updated: H.FIXED_NOW },
    '# E\n\n## Description\nD.\n',
  );
}

function doneNoAcceptanceFile(archived) {
  const fields = { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW };
  if (archived) fields.archived = H.FIXED_NOW;
  return H.element(fields, '# T\n\n## Description\nD.\n\n## Acceptance Criteria\n');
}

/* I1 — `problems.ignore: ["done:no_acceptance"]` suppresses it from       */
/* _problems, doctor, AND write feedback -- incomplete:acceptance (a       */
/* DIFFERENT, non-ignorable code) still fires, unaffected                 */
{
  const dir = H.mkBacklog({
    label: 'ac49-i1',
    config: configWithIgnore(['done:no_acceptance']),
    files: { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': doneNoAcceptanceFile() },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = runJ(['show', '--id=TSK-001'], dir);
  const probs = (r.json && r.json.entries && r.json.entries[0] && r.json.entries[0]._problems) || [];
  T.check('I1 _problems does NOT carry done:no_acceptance (ignored)', !probs.includes('done:no_acceptance'), J(r.json));
  T.check('I1 _problems STILL carries incomplete:acceptance (different code, not ignored)', probs.includes('incomplete:acceptance'), J(r.json));

  const d = runJ(['doctor'], dir);
  T.check('I1 doctor does NOT report done:no_acceptance', !(d.json && d.json.problems || []).some((p) => p.code === 'done:no_acceptance'), J(d.json));

  const setR = run(['set', '--id=TSK-001', '--priority=high'], dir);
  T.check('I1 write feedback does NOT print the done:no_acceptance line', !/is done with no acceptance criteria/.test(setR.stdout), J(setR.stdout));
}

/* I2 — `problems.ignore: ["acceptance:no_checkbox"]` suppresses E the    */
/* same way                                                               */
{
  const dir = H.mkBacklog({ label: 'ac49-i2', config: configWithIgnore(['acceptance:no_checkbox']), files: { 'epics/EPIC-001.md': epicFile() }, tombstones: ['EPIC-001'] });
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=prose only, no checkbox'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('I2 nj new: exit 0', r, 0);
  T.check('I2 _problems does NOT carry acceptance:no_checkbox (ignored)',
    !(r.json && r.json.entry && r.json.entry._problems || []).includes('acceptance:no_checkbox'), J(r.json));
  const d = runJ(['doctor'], dir);
  T.check('I2 doctor does NOT report acceptance:no_checkbox', !(d.json && d.json.problems || []).some((p) => p.code === 'acceptance:no_checkbox'), J(d.json));
}

/* I3 — an ERROR code in `ignore`: invalid_config                        */
{
  const dir = H.mkBacklog({ label: 'ac49-i3', config: configWithIgnore(['missing:title']) });
  const r = runJ(['list'], dir);
  T.exit('I3 an error code (missing:title) in problems.ignore: exit 1', r, 1);
  T.eq('I3 invalid_config', r.json && r.json.error, 'invalid_config');
}

/* I4 — an `incomplete:*` code in `ignore`: invalid_config (the one axis  */
/* this feature must never touch)                                        */
{
  const dir = H.mkBacklog({ label: 'ac49-i4', config: configWithIgnore(['incomplete:acceptance']) });
  const r = runJ(['list'], dir);
  T.exit('I4 incomplete:acceptance in problems.ignore: exit 1', r, 1);
  T.eq('I4 invalid_config', r.json && r.json.error, 'invalid_config');
}

/* I5 — an unknown code in `ignore`: NOT invalid_config (DECISIONS 166    */
/* amends this one sub-case) -- config:unknown_code, a warning, skipped.  */
/* The full behaviour (doctor reports it, OTHER valid codes still apply)  */
/* is pinned in J2 below; this leg only confirms commands still succeed.  */
{
  const dir = H.mkBacklog({ label: 'ac49-i5', config: configWithIgnore(['totally:bogus']) });
  const r = runJ(['list'], dir);
  T.exit('I5 an unknown code in problems.ignore: exit 0 (not invalid_config)', r, 0);
}

/* I6 — the default (no `problems` key at all): both E/F stay on, exactly */
/* today's behaviour -- reusing the same done+empty-acceptance fixture,   */
/* no ignore configured this time                                        */
{
  const dir = H.mkBacklog({
    label: 'ac49-i6',
    files: { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': doneNoAcceptanceFile() },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = runJ(['show', '--id=TSK-001'], dir);
  T.check('I6 default (no problems.ignore): done:no_acceptance IS reported',
    ((r.json && r.json.entries && r.json.entries[0] && r.json.entries[0]._problems) || []).includes('done:no_acceptance'), J(r.json));
}

/* I7 — `backlog:claims_unignored` is a WARNING, so it is eligible too    */
/* (answers the v3.5 "no opt-out" friction) -- confirmed against a        */
/* control case (no ignore) that the warning IS normally reported, not    */
/* merely assumed                                                        */
{
  const files = { '.nanojira/claims/.keep': '' };
  const control = H.mkBacklog({ label: 'ac49-i7-control', files });
  const dControl = runJ(['doctor'], control);
  T.check('I7 control: backlog:claims_unignored IS normally reported',
    (dControl.json && dControl.json.problems || []).some((p) => p.code === 'backlog:claims_unignored'), J(dControl.json));

  const dir = H.mkBacklog({ label: 'ac49-i7', config: configWithIgnore(['backlog:claims_unignored']), files });
  const d = runJ(['doctor'], dir);
  T.check('I7 with it ignored: backlog:claims_unignored is NOT reported',
    !(d.json && d.json.problems || []).some((p) => p.code === 'backlog:claims_unignored'), J(d.json));
}

/* I8 — suppressing a code does NOT change the readiness computation:    */
/* `unknown:status` (a warning that DOES block --ready, § 7) still keeps */
/* its element out of --ready even while ignored -- only the REPORT goes */
/* quiet, confirmed against a control case without the ignore             */
{
  const badStatusFile = H.element(
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'bogus', created: H.FIXED_NOW, updated: H.FIXED_NOW },
    H.completeBody('T'),
  );
  const files = { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': badStatusFile };

  const control = H.mkBacklog({ label: 'ac49-i8-control', files, tombstones: ['EPIC-001', 'TSK-001'] });
  const rControl = runJ(['show', '--id=TSK-001'], control);
  T.check('I8 control: unknown:status IS normally reported',
    ((rControl.json && rControl.json.entries && rControl.json.entries[0] && rControl.json.entries[0]._problems) || []).includes('unknown:status'), J(rControl.json));
  const readyControl = runJ(['list', '--ready'], control);
  T.check('I8 control: TSK-001 is NOT --ready (unknown:status blocks it)',
    !(readyControl.json && readyControl.json.entries || []).some((e) => e.id === 'TSK-001'), J(readyControl.json));

  const dir = H.mkBacklog({ label: 'ac49-i8', config: configWithIgnore(['unknown:status']), files, tombstones: ['EPIC-001', 'TSK-001'] });
  const r = runJ(['show', '--id=TSK-001'], dir);
  T.check('I8 ignored: unknown:status is NOT in _problems anymore',
    !((r.json && r.json.entries && r.json.entries[0] && r.json.entries[0]._problems) || []).includes('unknown:status'), J(r.json));
  const ready = runJ(['list', '--ready'], dir);
  T.check('I8 ignored: TSK-001 is STILL NOT --ready (suppressing the report does not fix the underlying defect)',
    !(ready.json && ready.json.entries || []).some((e) => e.id === 'TSK-001'), J(ready.json));
}

/* ===================================================================== */
/* J — config forward compatibility (DECISIONS 166): unknown keys are    */
/* warnings, and minVersion/needs_newer_nj.                               */
/* ===================================================================== */

/* J1 — an unknown TOP-LEVEL config key: config:unknown_key, a warning,  */
/* not invalid_config -- every command still succeeds                    */
{
  const dir = H.mkBacklog({
    label: 'ac49-j1',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      totally_unrecognised_top_level_key: 1,
    }, null, 2) + '\n',
  });
  const r = runJ(['list'], dir);
  T.exit('J1 list still exits 0 (unknown top-level key)', r, 0);
  const d = runJ(['doctor'], dir);
  T.exit('J1 doctor exits 0 (warning only)', d, 0);
  T.check('J1 doctor reports config:unknown_key', (d.json && d.json.problems || []).some((p) => p.code === 'config:unknown_key' && p.severity === 'warning'), J(d.json));
  T.check('J1 config:invalid is NOT reported', !(d.json && d.json.problems || []).some((p) => p.code === 'config:invalid'), J(d.json));
}

/* J2 — an unknown CODE inside problems.ignore: config:unknown_code, a   */
/* warning, SKIPPED -- but every OTHER, valid code in the same list      */
/* still applies                                                         */
{
  const dir = H.mkBacklog({
    label: 'ac49-j2',
    config: configWithIgnore(['totally:bogus', 'done:no_acceptance']),
    files: { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': doneNoAcceptanceFile() },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = runJ(['list'], dir);
  T.exit('J2 list still exits 0 (unknown code in problems.ignore)', r, 0);
  const d = runJ(['doctor'], dir);
  T.exit('J2 doctor exits 0 (warning only)', d, 0);
  T.check('J2 doctor reports config:unknown_code for totally:bogus', (d.json && d.json.problems || []).some((p) => p.code === 'config:unknown_code' && p.severity === 'warning'), J(d.json));
  T.check('J2 config:invalid is NOT reported', !(d.json && d.json.problems || []).some((p) => p.code === 'config:invalid'), J(d.json));
  T.check('J2 done:no_acceptance (the OTHER, valid code) is still suppressed', !(d.json && d.json.problems || []).some((p) => p.code === 'done:no_acceptance'), J(d.json));
}

/* J3 — minVersion: a running nj OLDER than required fails every command */
/* with needs_newer_nj, naming both versions -- including doctor, which  */
/* invalid_config otherwise exempts                                      */
{
  const dir = H.mkBacklog({
    label: 'ac49-j3',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: '99.0.0',
    }, null, 2) + '\n',
  });
  const r = runJ(['list'], dir);
  T.exit('J3 list fails with exit 1 (nj older than minVersion)', r, 1);
  T.eq('J3 needs_newer_nj', r.json && r.json.error, 'needs_newer_nj');
  const vr = H.runJson(['--version'], { unsetEnv: ['NJ_BACKLOG'] });
  T.check('J3 the hint names the required version (visible under --json, not only on stderr)', (r.json && r.json.hint || '').includes('99.0.0'), J(r.json));
  T.check('J3 the hint names the running version', vr.json && vr.json.version && (r.json && r.json.hint || '').includes(vr.json.version), J(r.json) + ' vs running ' + J(vr.json));

  const d = runJ(['doctor'], dir);
  T.exit('J3 doctor ALSO fails with exit 1 (needs_newer_nj, no exemption)', d, 1);
  T.eq('J3 doctor: needs_newer_nj', d.json && d.json.error, 'needs_newer_nj');
}

/* J4 — minVersion at or below the running version: no effect at all     */
{
  const dir = H.mkBacklog({
    label: 'ac49-j4',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: '0.0.0',
    }, null, 2) + '\n',
  });
  const r = runJ(['list'], dir);
  T.exit('J4 list exits 0 (nj newer than a trivially low minVersion)', r, 0);
}

/* J5 — version comparison is NUMERIC, never lexicographic: a running    */
/* major version "3" is lexicographically GREATER than "10" (the         */
/* character '3' sorts after '1'), but numerically 3 < 10 -- a string    */
/* compare would wrongly allow this through. (Assumes the running major  */
/* version is the single digit 3, true for the whole v3 line.)           */
{
  const dir = H.mkBacklog({
    label: 'ac49-j5',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: '10.0.0',
    }, null, 2) + '\n',
  });
  const r = runJ(['list'], dir);
  T.exit('J5 list fails with needs_newer_nj (numeric 3 < 10, not a string compare)', r, 1);
  T.eq('J5 needs_newer_nj', r.json && r.json.error, 'needs_newer_nj');
}

/* J6 — a malformed minVersion (not exactly three dot-separated          */
/* non-negative integers): invalid_config, a bad VALUE for a known key,  */
/* not a version-skew question                                           */
for (const bad of ['3.6', '3.6.0.1', '3.6.x', 'v3.6.0', 'not-a-version', '']) {
  const dir = H.mkBacklog({
    label: 'ac49-j6-' + bad.replace(/[^a-z0-9]+/gi, '-'),
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: bad,
    }, null, 2) + '\n',
  });
  const r = runJ(['list'], dir);
  T.exit('J6 malformed minVersion ' + J(bad) + ': list fails with exit 1', r, 1);
  T.eq('J6 malformed minVersion ' + J(bad) + ': invalid_config', r.json && r.json.error, 'invalid_config');
}

/* J7 — `--version` is unaffected by a too-new minVersion: it never      */
/* resolves a backlog/config at all                                      */
{
  const dir = H.mkBacklog({
    label: 'ac49-j7',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: '99.0.0',
    }, null, 2) + '\n',
  });
  const r = run(['--version'], dir);
  T.exit('J7 --version: still exit 0, unaffected by minVersion', r, 0);
}

/* J8 — `nj <command> --help` is unaffected by a too-new minVersion: its */
/* own backlog/config resolution is already best-effort and silent       */
{
  const dir = H.mkBacklog({
    label: 'ac49-j8',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
      minVersion: '99.0.0',
    }, null, 2) + '\n',
  });
  const r = run(['set', '--help'], dir);
  T.exit('J8 nj set --help: still exit 0, unaffected by minVersion', r, 0);
}

/* J9 -- version comparison across a TWO-DIGIT minor (v3-10.md § 13): a   */
/* naive string/lexical compare reads "3.10.0" as OLDER than "3.9.0"      */
/* ('1' < '9' in the second component), which a numeric tuple compare     */
/* must not fall for. Every value here is derived from the running       */
/* nj's own --version, not hardcoded, so the leg tracks the next bump     */
/* automatically instead of going stale. */
{
  const vr = H.runJson(['--version'], { unsetEnv: ['NJ_BACKLOG'] });
  const parts = ((vr.json && vr.json.version) || '').split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    T.check('fixture: J9 nj --version is exactly X.Y.Z', false, J(vr.json));
  } else {
    const [maj, min, patch] = parts;
    const oneMinorBelow = maj + '.' + (min - 1) + '.' + patch;
    const running = maj + '.' + min + '.' + patch;
    const oneMinorAbove = maj + '.' + (min + 1) + '.' + patch;

    function minVersionCheck(label, minVersion, expectPass) {
      const dir = H.mkBacklog({
        label: 'ac49-j9-' + label,
        config: JSON.stringify({
          schema: 1,
          statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
          sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
          minVersion,
        }, null, 2) + '\n',
      });
      const r = runJ(['list'], dir);
      if (expectPass) {
        T.exit('J9 minVersion=' + minVersion + ' (running ' + running + '): list exits 0', r, 0);
      } else {
        T.exit('J9 minVersion=' + minVersion + ' (running ' + running + '): list fails with exit 1', r, 1);
        T.eq('J9 minVersion=' + minVersion + ': needs_newer_nj', r.json && r.json.error, 'needs_newer_nj');
      }
    }
    /* one minor BELOW the running version: with a running minor >= 10
     * (true from 3.10.0 onward) this is exactly the lexical trap -- a
     * string compare reads e.g. "3.9.0" as newer than "3.10.0" and
     * would wrongly fail this case. min === 0 has no minor below to
     * construct; skip with a reason rather than asserting a negative
     * minor. */
    if (min > 0) {
      minVersionCheck('below', oneMinorBelow, true);
    } else {
      T.check('J9 skipped: running minor is 0, no minor below to construct', true, 'skip');
    }
    minVersionCheck('exact', running, true);
    minVersionCheck('above', oneMinorAbove, false);
  }
}

/* ===================================================================== */
/* K — DECISIONS 167: both E/F apply to LIVE elements only. An archived   */
/* done element with empty acceptance gets neither warning; the SAME     */
/* fixture, unarchived, still gets it -- confirmed by contrast, not       */
/* merely asserting the archived case alone.                             */
/* ===================================================================== */

/* K1 — archived: no done:no_acceptance, in _problems or doctor          */
{
  const dir = H.mkBacklog({
    label: 'ac49-k1',
    files: { 'archive/EPIC-001.md': archivedEpicFile(), 'archive/TSK-001.md': doneNoAcceptanceFile(true) },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = runJ(['show', '--id=TSK-001'],dir);
  T.exit('K1 show --all on the archived element: exit 0', r, 0);
  const probs = (r.json && r.json.entries && r.json.entries[0] && r.json.entries[0]._problems) || [];
  T.check('K1 an ARCHIVED done element with empty acceptance does NOT carry done:no_acceptance',
    !probs.includes('done:no_acceptance'), J(r.json));

  const d = runJ(['doctor'], dir);
  T.exit('K1 doctor exits 0', d, 0);
  T.check('K1 doctor does NOT report done:no_acceptance for the archived element',
    !(d.json && d.json.problems || []).some((p) => p.code === 'done:no_acceptance'), J(d.json));
}

/* K2 — the identical fixture, LIVE (not archived): still gets the       */
/* warning -- the contrast that proves K1 is about archived status, not  */
/* some other, coincidental difference                                   */
{
  const dir = H.mkBacklog({
    label: 'ac49-k2',
    files: { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': doneNoAcceptanceFile(false) },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = runJ(['show', '--id=TSK-001'], dir);
  T.exit('K2 show on the LIVE element: exit 0', r, 0);
  const probs = (r.json && r.json.entries && r.json.entries[0] && r.json.entries[0]._problems) || [];
  T.check('K2 the SAME fixture, live, DOES carry done:no_acceptance',
    probs.includes('done:no_acceptance'), J(r.json));

  const d = runJ(['doctor'], dir);
  T.check('K2 doctor DOES report done:no_acceptance for the live element',
    (d.json && d.json.problems || []).some((p) => p.code === 'done:no_acceptance'), J(d.json));
}

/* K3 — the same live/archived contrast for E, acceptance:no_checkbox    */
{
  const archivedDir = H.mkBacklog({
    label: 'ac49-k3-archived',
    files: {
      'archive/EPIC-001.md': archivedEpicFile(),
      'archive/TSK-001.md': H.element(
        { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', archived: H.FIXED_NOW, created: H.FIXED_NOW, updated: H.FIXED_NOW },
        '# T\n\n## Description\nD.\n\n## Acceptance Criteria\nprose only, no checkbox\n',
      ),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const ra = runJ(['show', '--id=TSK-001'],archivedDir);
  T.check('K3 an ARCHIVED element with no-checkbox acceptance does NOT carry acceptance:no_checkbox',
    !((ra.json && ra.json.entries && ra.json.entries[0] && ra.json.entries[0]._problems) || []).includes('acceptance:no_checkbox'), J(ra.json));

  const liveDir = H.mkBacklog({
    label: 'ac49-k3-live',
    files: {
      'epics/EPIC-001.md': epicFile(),
      'tasks/TSK-001.md': H.element(
        { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW },
        '# T\n\n## Description\nD.\n\n## Acceptance Criteria\nprose only, no checkbox\n',
      ),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const rl = runJ(['show', '--id=TSK-001'], liveDir);
  T.check('K3 the SAME fixture, live, DOES carry acceptance:no_checkbox',
    ((rl.json && rl.json.entries && rl.json.entries[0] && rl.json.entries[0]._problems) || []).includes('acceptance:no_checkbox'), J(rl.json));
}

T.finish();
