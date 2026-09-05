/* AC-53 — `nj set --parent=<id>` reparents a task or subtask,
 * docs/SPECIFICATION.md § 4, § 9 "Rules", § 15 item 55 (v3.9, DECISIONS
 * 176 A, 177, promoted: commit <pending>).
 *
 * AC-53 (§ 15, corrected per DECISIONS 177): "The new parent must exist,
 * be live and be the correct type -- the error codes mirror new's own
 * --parent validation: missing is not_found, wrong-type is
 * invalid_target, archived is refused:parent_archived, given to an epic
 * at all is invalid_value; nothing is written in any of these cases. The
 * id, body and claim log (keyed by id) are unchanged; the type never
 * changes. set --parent=<old> restores the previous state exactly --
 * same file location, same frontmatter apart from updated -- there is no
 * separate nj undo command. Under hierarchy the file (subtask) or whole
 * folder (task) relocates to the new parent in the same write that
 * changes parent; under type/flat only the frontmatter changes. --input
 * set accepts parent as one more settable field."
 *
 * Found by an outside team (feedback/team-b-tests TSK-014): moving
 * a task to a different epic (reorganising a backlog without losing its
 * id, notes or claim history) required hand-editing the file.
 *
 * D176's original "uniform invalid_value" ruling and its "nj undo"
 * mention were both corrected by DECISIONS 177 before implementation
 * started -- this suite reflects the corrected ruling.
 *
 * Written before the fix lands: red against the current build (set has
 * no --parent flag at all yet -- unknown_field).
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
function runStdin(args, cwd, input) { return H.runJson(args, { cwd, input, unsetEnv: ['NJ_BACKLOG'], env: { NJ_NOW: H.FIXED_NOW } }); }

function hierarchyConfig() {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    layout: { group: 'hierarchy' },
  }, null, 2) + '\n';
}

function hierarchyBacklog(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  fs.writeFileSync(path.join(dir, 'backlog', H.CONFIG_REL), hierarchyConfig());
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  return dir;
}

/* ===================================================================== */
/* A1 -- hierarchy: reparenting a SUBTASK moves its file to the new       */
/* task's folder; id, body (description/acceptance/notes) and claim log  */
/* survive                                                                */
/* ===================================================================== */
{
  const dir = hierarchyBacklog('ac53-a1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1 under E1');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T2 under E2');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S1', '--description=D.', '--acceptance=- [ ] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new S1 under T1');
  ok(run(['note', '--id=SUB-001', 'a note before reparenting', '--as=alice'], dir, { NJ_NOW: H.FIXED_NOW }), 'note on S1');
  ok(run(['claim', '--id=SUB-001', '--as=bob'], dir, { NJ_NOW: H.FIXED_NOW }), 'claim S1 as bob');

  const oldPath = path.join(dir, 'backlog', 'EPIC-001', 'TSK-001', 'SUB-001.md');
  const newPath = path.join(dir, 'backlog', 'EPIC-002', 'TSK-002', 'SUB-001.md');
  T.check('A1 fixture: old file exists before reparenting', fs.existsSync(oldPath), oldPath);
  const before = fs.readFileSync(oldPath, 'utf8');

  const r = runJ(['set', '--id=SUB-001', '--parent=TSK-002'], dir);
  T.exit('A1 set --parent=TSK-002: exit 0', r, 0);
  T.eq('A1 id is unchanged', r.json && r.json.id, 'SUB-001');
  T.eq('A1 entry.parent is now TSK-002', r.json && r.json.entry && r.json.entry.parent, 'TSK-002');

  T.check('A1 the file moved: new path exists', fs.existsSync(newPath), newPath);
  T.check('A1 the file moved: old path is gone', !fs.existsSync(oldPath), oldPath);

  const after = fs.existsSync(newPath) ? fs.readFileSync(newPath, 'utf8') : '';
  T.check('A1 the note survives the move', /a note before reparenting/.test(after), after);
  T.check('A1 the note author survives', /alice/.test(after), after);
  T.check('A1 the acceptance checkbox survives, untouched', /- \[ \] x/.test(after), after);

  const show = runJ(['show', '--id=SUB-001'], dir);
  T.eq('A1 the claim survives the move (keyed by id, not path)',
    show.json && show.json.entry && show.json.entry._claim && show.json.entry._claim.by, 'bob');

  const log = runJ(['log', '--id=SUB-001'], dir);
  T.check('A1 the claim log (nj log) still shows the earlier claim',
    JSON.stringify(log.json || {}).includes('bob'), J(log.json));
}

/* ===================================================================== */
/* A2 -- hierarchy: reparenting a TASK moves its WHOLE folder, including  */
/* its own subtask children's files, in one move                         */
/* ===================================================================== */
{
  const dir = hierarchyBacklog('ac53-a2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1 under E1');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S1', '--description=D.', '--acceptance=- [ ] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new S1 under T1');

  const oldTask = path.join(dir, 'backlog', 'EPIC-001', 'TSK-001', 'TSK-001.md');
  const oldSub = path.join(dir, 'backlog', 'EPIC-001', 'TSK-001', 'SUB-001.md');
  T.check('A2 fixture: old task file exists', fs.existsSync(oldTask), oldTask);
  T.check('A2 fixture: old subtask file exists', fs.existsSync(oldSub), oldSub);

  const r = runJ(['set', '--id=TSK-001', '--parent=EPIC-002'], dir);
  T.exit('A2 set --parent=EPIC-002: exit 0', r, 0);
  T.eq('A2 entry.parent is now EPIC-002', r.json && r.json.entry && r.json.entry.parent, 'EPIC-002');

  const newTask = path.join(dir, 'backlog', 'EPIC-002', 'TSK-001', 'TSK-001.md');
  const newSub = path.join(dir, 'backlog', 'EPIC-002', 'TSK-001', 'SUB-001.md');
  T.check('A2 the task file moved under the new epic', fs.existsSync(newTask), newTask);
  T.check('A2 the subtask file moved along with its parent task, in the same call',
    fs.existsSync(newSub), newSub);
  T.check('A2 the old folder is gone', !fs.existsSync(oldTask) && !fs.existsSync(oldSub), oldTask + ' / ' + oldSub);

  const sub = runJ(['show', '--id=SUB-001'], dir);
  T.eq('A2 the subtask itself still reports parent=TSK-001 (unchanged, it never moved relative to its own task)',
    sub.json && sub.json.entry && sub.json.entry.parent, 'TSK-001');
}

/* ===================================================================== */
/* A3 -- group `type` (the default): reparenting changes only the         */
/* frontmatter -- the file stays in its type folder, nothing relocates   */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a3');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1');

  const taskPath = path.join(dir, 'backlog', 'tasks', 'TSK-001.md');
  T.check('A3 fixture: task file exists in tasks/ before reparenting', fs.existsSync(taskPath), taskPath);

  const r = runJ(['set', '--id=TSK-001', '--parent=EPIC-002'], dir);
  T.exit('A3 set --parent=EPIC-002 (group type): exit 0', r, 0);
  T.eq('A3 entry.parent is now EPIC-002', r.json && r.json.entry && r.json.entry.parent, 'EPIC-002');
  T.check('A3 the file never left tasks/ (group type places by type, not parent)',
    fs.existsSync(taskPath), taskPath);
}

/* ===================================================================== */
/* A4 -- wrong type: a TASK given another TASK's id as its new --parent   */
/* (a task's parent must be an epic)                                     */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a4');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T2');
  const before = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');

  const r = runJ(['set', '--id=TSK-001', '--parent=TSK-002'], dir);
  T.exit('A4 a TASK given another TASK as --parent (wrong type, needs an epic): exit 1', r, 1);
  T.eq('A4 invalid_target (mirrors new, DECISIONS 177)', r.json && r.json.error, 'invalid_target');
  const after = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  T.eq('A4 nothing written', after, before);
}

/* ===================================================================== */
/* A5 -- missing parent: --parent names an id that does not exist         */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a5');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1');
  const before = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');

  const r = runJ(['set', '--id=TSK-001', '--parent=EPIC-999'], dir);
  T.exit('A5 --parent names an id that does not exist: exit 1', r, 1);
  T.eq('A5 not_found (mirrors new, DECISIONS 177)', r.json && r.json.error, 'not_found');
  const after = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  T.eq('A5 nothing written', after, before);
}

/* ===================================================================== */
/* A6 -- archived parent: the new parent exists and is the right type,    */
/* but is archived                                                        */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a6');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.', '--status=done'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  ok(run(['archive', '--id=EPIC-002'], dir, { NJ_NOW: H.FIXED_NOW }), 'archive E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1');
  const before = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');

  const r = runJ(['set', '--id=TSK-001', '--parent=EPIC-002'], dir);
  T.exit('A6 --parent names an ARCHIVED epic: exit 1', r, 1);
  T.eq('A6 refused:parent_archived (mirrors new, DECISIONS 177)', r.json && r.json.error, 'refused:parent_archived');
  const after = fs.readFileSync(path.join(dir, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  T.eq('A6 nothing written', after, before);
}

/* ===================================================================== */
/* A7 -- --parent given to an EPIC at all: invalid_value, an epic never   */
/* has a parent                                                          */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a7');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  const before = fs.readFileSync(path.join(dir, 'backlog', 'epics', 'EPIC-001.md'), 'utf8');

  const r = runJ(['set', '--id=EPIC-001', '--parent=EPIC-002'], dir);
  T.exit('A7 --parent given to an epic: exit 1', r, 1);
  T.eq('A7 invalid_value', r.json && r.json.error, 'invalid_value');
  const after = fs.readFileSync(path.join(dir, 'backlog', 'epics', 'EPIC-001.md'), 'utf8');
  T.eq('A7 nothing written', after, before);
}

/* ===================================================================== */
/* A8 -- `set --input=` accepts `parent` as one more settable field       */
/* ===================================================================== */
{
  const dir = H.freshDir('ac53-a8');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1');

  const r = runStdin(['set', '--id=TSK-001', '--input=-'], dir, JSON.stringify({ parent: 'EPIC-002' }));
  T.exit('A8 set --input= with "parent": exit 0', r, 0);
  T.eq('A8 entry.parent is now EPIC-002', r.json && r.json.entry && r.json.entry.parent, 'EPIC-002');
}

/* ===================================================================== */
/* A9 -- there is no `nj undo`; set --parent=<old> restores the previous  */
/* state exactly: same file location, same frontmatter apart from        */
/* `updated` (DECISIONS 177, correcting D176's mistaken "undo" mention)   */
/* ===================================================================== */
{
  const dir = hierarchyBacklog('ac53-a9');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T1 under E1');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new T2 under E2');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S1', '--description=D.', '--acceptance=- [ ] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new S1 under T1');

  const origPath = path.join(dir, 'backlog', 'EPIC-001', 'TSK-001', 'SUB-001.md');
  const origBefore = fs.readFileSync(origPath, 'utf8');

  const moved = runJ(['set', '--id=SUB-001', '--parent=TSK-002'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('A9 fixture: reparent S1 to TSK-002 first: exit 0', moved, 0);
  const movedPath = path.join(dir, 'backlog', 'EPIC-002', 'TSK-002', 'SUB-001.md');
  T.check('A9 fixture: subtask now at TSK-002', fs.existsSync(movedPath), movedPath);

  const restored = runJ(['set', '--id=SUB-001', '--parent=TSK-001'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('A9 set --parent=<old> (TSK-001) restores it: exit 0', restored, 0);
  T.eq('A9 entry.parent is back to TSK-001', restored.json && restored.json.entry && restored.json.entry.parent, 'TSK-001');
  T.check('A9 the file sits back at its original location', fs.existsSync(origPath), origPath);
  T.check('A9 the file is gone from the intermediate location', !fs.existsSync(movedPath), movedPath);

  const origAfter = fs.existsSync(origPath) ? fs.readFileSync(origPath, 'utf8') : '';
  const stripUpdated = (s) => s.replace(/^updated:.*$/m, 'updated: <stripped>');
  T.eq('A9 frontmatter is identical to before the round trip, apart from `updated`',
    stripUpdated(origAfter), stripUpdated(origBefore));
}

T.finish();
