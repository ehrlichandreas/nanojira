'use strict';
/* AC-54 — `done:open_acceptance` (G), a third never-blocking acceptance
 * quality warning, docs/SPECIFICATION.md § 7 "Acceptance quality
 * warnings" / § 15 item 56 (v3.9, DECISIONS 176 B, promoted: commit
 * <pending>).
 *
 * AC-54 (§ 15): "A live task/subtask that is done with at least one
 * unticked countable checkbox in its Acceptance Criteria section.
 * Mutually exclusive with acceptance:no_checkbox (E, zero checkboxes)
 * and done:no_acceptance (F, section absent/empty) by construction.
 * Archived elements never carry it, same as E/F. doctor and
 * new/set/note/check's own prose name the count ('1 of 3 acceptance
 * boxes still unticked'); set/claim additionally carry it in their own
 * --json result as open_acceptance?: {unticked, total}, present exactly
 * when a write naming --status=<last> in that call leaves it on the
 * element. problems.ignore silences the code and this additive field
 * together."
 *
 * Found by an outside team (feedback/team-c TSK-001): a done
 * task/subtask with content in its acceptance section, but a box still
 * unticked, was never flagged -- the existing done:no_acceptance (F)
 * only catches an ABSENT/EMPTY section, not an open one.
 *
 * Written before the fix lands: red against the current build (the code
 * does not exist in SEVERITY yet, so it never appears in _problems or
 * doctor's report, and set/claim never carry the additive field).
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

function freshBacklog(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  return dir;
}

function configWithIgnore(ignore) {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    problems: { ignore },
  }, null, 2) + '\n';
}

/* ===================================================================== */
/* G1 -- a done task with one ticked and two unticked boxes:               */
/* done:open_acceptance, counting correctly                               */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [x] one\n- [ ] two\n- [ ] three'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, 1 ticked 2 unticked');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G1 set --status=done: exit 0 (never blocks)', r, 0);
  const probs = (r.json && r.json.entry && r.json.entry._problems) || [];
  T.check('G1 _problems carries done:open_acceptance', probs.includes('done:open_acceptance'), J(r.json));
  T.check('G1 _problems does NOT carry done:no_acceptance (section has content)',
    !probs.includes('done:no_acceptance'), J(r.json));
  T.check('G1 _problems does NOT carry acceptance:no_checkbox (checkboxes exist)',
    !probs.includes('acceptance:no_checkbox'), J(r.json));

  T.eq('G1 result carries open_acceptance.unticked = 2',
    r.json && r.json.open_acceptance && r.json.open_acceptance.unticked, 2);
  T.eq('G1 result carries open_acceptance.total = 3',
    r.json && r.json.open_acceptance && r.json.open_acceptance.total, 3);

  const d = runJ(['doctor'], dir);
  const finding = (d.json && d.json.problems || []).find((p) => p.code === 'done:open_acceptance');
  T.check('G1 doctor reports done:open_acceptance', !!finding, J(d.json));
  T.eq('G1 doctor severity is warning', finding && finding.severity, 'warning');
  T.check('G1 doctor message names the count (2 of 3)', !!(finding && /2 of 3/.test(finding.message || '')), J(finding));
  T.eq('G1 doctor exit code unaffected (0, no errors)', d.status, 0);
}

/* ===================================================================== */
/* G2 -- a done task with EVERY box ticked: no open_acceptance at all      */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [x] one\n- [x] two'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, all ticked');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G2 set --status=done: exit 0', r, 0);
  T.check('G2 _problems does NOT carry done:open_acceptance (nothing unticked)',
    !((r.json && r.json.entry && r.json.entry._problems) || []).includes('done:open_acceptance'), J(r.json));
  T.check('G2 result does NOT carry open_acceptance (absent, not null)',
    !('open_acceptance' in (r.json || {})), J(r.json));
}

/* ===================================================================== */
/* G3 -- NOT done, with an unticked box: no done:open_acceptance (only    */
/* done triggers it)                                                      */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g3');
  const r = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [ ] one'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('G3 nj new (status todo): exit 0', r, 0);
  T.check('G3 _problems does NOT carry done:open_acceptance (not done)',
    !((r.json && r.json.entry && r.json.entry._problems) || []).includes('done:open_acceptance'), J(r.json));
}

/* ===================================================================== */
/* G4 -- mutual exclusivity with F: a done task with an ABSENT acceptance */
/* section gets done:no_acceptance, never done:open_acceptance            */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g4');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, no acceptance');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G4 set --status=done: exit 0', r, 0);
  const probs = (r.json && r.json.entry && r.json.entry._problems) || [];
  T.check('G4 _problems carries done:no_acceptance', probs.includes('done:no_acceptance'), J(r.json));
  T.check('G4 _problems does NOT carry done:open_acceptance (no checkbox to be unticked)',
    !probs.includes('done:open_acceptance'), J(r.json));
}

/* ===================================================================== */
/* G5 -- mutual exclusivity with E: a done task whose acceptance section  */
/* has content but zero countable checkboxes gets acceptance:no_checkbox, */
/* never done:open_acceptance                                            */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g5');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=just a sentence, no checkbox'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, prose only');
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G5 set --status=done: exit 0', r, 0);
  const probs = (r.json && r.json.entry && r.json.entry._problems) || [];
  T.check('G5 _problems carries acceptance:no_checkbox', probs.includes('acceptance:no_checkbox'), J(r.json));
  T.check('G5 _problems does NOT carry done:open_acceptance (zero checkboxes, not "at least one unticked")',
    !probs.includes('done:open_acceptance'), J(r.json));
}

/* ===================================================================== */
/* G6 -- archived: a done, archived element with an unticked box never    */
/* carries done:open_acceptance, contrasted with the identical live       */
/* fixture which does                                                     */
/* ===================================================================== */
{
  function epicFile() {
    return H.element(
      { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW },
      '# E\n\n## Description\nD.\n',
    );
  }
  function archivedEpicFile() {
    return H.element(
      { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', archived: H.FIXED_NOW, created: H.FIXED_NOW, updated: H.FIXED_NOW },
      '# E\n\n## Description\nD.\n',
    );
  }
  function doneOpenFile(archived) {
    const fields = { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW };
    if (archived) fields.archived = H.FIXED_NOW;
    return H.element(fields, '# T\n\n## Description\nD.\n\n## Acceptance Criteria\n- [ ] still open\n');
  }

  const archivedDir = H.mkBacklog({
    label: 'ac54-g6-archived',
    files: { 'archive/EPIC-001.md': archivedEpicFile(), 'archive/TSK-001.md': doneOpenFile(true) },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const ra = runJ(['show', '--id=TSK-001'], archivedDir);
  T.check('G6 an ARCHIVED done element with an unticked box does NOT carry done:open_acceptance',
    !((ra.json && ra.json.entries && ra.json.entries[0] && ra.json.entries[0]._problems) || []).includes('done:open_acceptance'),
    J(ra.json));

  const liveDir = H.mkBacklog({
    label: 'ac54-g6-live',
    files: { 'epics/EPIC-001.md': epicFile(), 'tasks/TSK-001.md': doneOpenFile(false) },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const rl = runJ(['show', '--id=TSK-001'], liveDir);
  T.check('G6 the SAME fixture, live, DOES carry done:open_acceptance',
    ((rl.json && rl.json.entries && rl.json.entries[0] && rl.json.entries[0]._problems) || []).includes('done:open_acceptance'),
    J(rl.json));
}

/* ===================================================================== */
/* G7 -- text feedback on `set` names the count, matching doctor's own    */
/* wording                                                                 */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g7');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [ ] one'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, 1 unticked');
  const r = run(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G7 set --status=done: exit 0', r, 0);
  T.check('G7 exact prose names the count (1 of 1)',
    /is done with 1 of 1 acceptance boxes? still unticked\./.test(r.stdout), J(r.stdout));
}

/* ===================================================================== */
/* G8 -- `problems.ignore: ["done:open_acceptance"]` suppresses the code  */
/* from _problems/doctor AND suppresses set's own additive field together */
/* ===================================================================== */
{
  const dir = H.freshDir('ac54-g8');
  ok(run(['init'], dir), 'nj init');
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(dir, 'backlog', '.nanojira', 'config.json'), configWithIgnore(['done:open_acceptance']));
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [ ] one'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, 1 unticked');

  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('G8 set --status=done (ignored): exit 0', r, 0);
  T.check('G8 _problems does NOT carry done:open_acceptance (ignored)',
    !((r.json && r.json.entry && r.json.entry._problems) || []).includes('done:open_acceptance'), J(r.json));
  T.check('G8 the result does NOT carry open_acceptance either (suppressed together)',
    !('open_acceptance' in (r.json || {})), J(r.json));

  const d = runJ(['doctor'], dir);
  T.check('G8 doctor does NOT report done:open_acceptance', !(d.json && d.json.problems || []).some((p) => p.code === 'done:open_acceptance'), J(d.json));
}

/* ===================================================================== */
/* G9 -- `nj claim --status=done` on a claimed element with an unticked   */
/* box carries open_acceptance the same way `set` does                   */
/* ===================================================================== */
{
  const dir = freshBacklog('ac54-g9');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [ ] one'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task, 1 unticked');
  const r = runJ(['claim', '--id=TSK-001', '--as=alice', '--status=done'], dir);
  T.exit('G9 claim --status=done: exit 0', r, 0);
  T.eq('G9 result carries open_acceptance.unticked = 1',
    r.json && r.json.open_acceptance && r.json.open_acceptance.unticked, 1);
  T.eq('G9 result carries open_acceptance.total = 1',
    r.json && r.json.open_acceptance && r.json.open_acceptance.total, 1);
}

T.finish();
