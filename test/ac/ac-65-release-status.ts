/* AC-65 — `release --status=<value>` (docs/SPECIFICATION.md § 9, § 12a;
 * DECISIONS 220; TSK-044).
 *
 * Found by an outside team (feedback/knowledge4ai-team TSK-001): a builder
 * released an element it had picked up by accident, and the file still
 * said `status: doing` and `assignee: <builder>`. The board showed it as
 * in progress although nobody held it, and the Lead had to reset it by
 * hand with `set --status=todo --assignee=`.
 *
 * `release --status=<value>` sets the status in the same call, with the
 * same allowed values and checks as `claim --status=`, and clears the
 * assignee when it is the releasing name, so the element is ready for
 * someone else again (`next` skips an element assigned to another name).
 * Plain `release` is unchanged: it never writes the file.
 *
 * Written before the fix: red against v4.2.0.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr) + J(r.stdout));
  return r;
}
function run(args: string[], cwd: string): RunResult {
  return H.runNj(args, { cwd, env: { NJ_NOW: H.FIXED_NOW }, unsetEnv: ['NJ_BACKLOG'] });
}
function runJ(args: string[], cwd: string) {
  return H.runJson(args, { cwd, env: { NJ_NOW: H.FIXED_NOW }, unsetEnv: ['NJ_BACKLOG'] });
}
function changedOf(r: { json?: any }): string[] | null {
  return r.json && Array.isArray(r.json.changed) ? [...r.json.changed].sort() : null;
}
function entry(dir: string, id: string): any {
  const r = runJ(['show', '--id=' + id], dir);
  return r.json && r.json.entries && r.json.entries[0];
}

/** An epic with two tasks, both `todo`, unassigned and unclaimed. */
function fixture(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] x'], dir), 'new task 1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] x'], dir), 'new task 2');
  return dir;
}

/* ===================================================================== */
/* (a) release --status=<value>                                          */
/* ===================================================================== */

/* R1: the feedback case, in one call. */
{
  const dir = fixture('ac65-r1');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=doing'], dir), 'claim --status=doing');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=todo'], dir);
  T.exit('R1 release --status=todo: exit 0', r, 0);
  T.eq('R1 changed: claim, status, assignee', J(changedOf(r)), J(['assignee', 'claim', 'status']));
  T.eq('R1 result entry: status todo', r.json && r.json.entry && r.json.entry.status, 'todo');
  T.check('R1 result entry: no assignee', !!r.json && !!r.json.entry && !('assignee' in r.json.entry), J(r.json));
  T.eq('R1 result: claim null', r.json && r.json.claim, null);
  const e = entry(dir, 'TSK-001');
  T.eq('R1 show: status todo', e && e.status, 'todo');
  T.check('R1 show: no assignee', !!e && !('assignee' in e), J(e));
  T.eq('R1 show: unclaimed', e && e._claim, null);
}

/* R2: text output names the status, as `claim --status=` does. */
{
  const dir = fixture('ac65-r2');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=doing'], dir), 'claim --status=doing');
  const r = run(['release', '--id=TSK-001', '--as=alice', '--status=todo'], dir);
  T.exit('R2 text: exit 0', r, 0);
  T.eq('R2 text: one line naming the status', r.stdout, 'TSK-001 released by alice (status: todo)\n');
}

/* R3: an unknown status is invalid_value; nothing changes. */
{
  const dir = fixture('ac65-r3');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=doing'], dir), 'claim --status=doing');
  const file = entry(dir, 'TSK-001').file;
  const before = fs.readFileSync(file, 'utf8');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=nope'], dir);
  T.exit('R3 unknown status: exit 1', r, 1);
  T.eq('R3 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('R3 still claimed by alice', entry(dir, 'TSK-001')._claim && entry(dir, 'TSK-001')._claim.by, 'alice');
  T.eq('R3 file unchanged', fs.readFileSync(file, 'utf8'), before);
}

/* R4: held by someone else: refused:claimed, no status write. */
{
  const dir = fixture('ac65-r4');
  ok(run(['claim', '--id=TSK-001', '--as=bob', '--status=doing'], dir), 'claim as bob');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=todo'], dir);
  T.exit('R4 not the holder: exit 1', r, 1);
  T.eq('R4 refused:claimed', r.json && r.json.error, 'refused:claimed');
  const e = entry(dir, 'TSK-001');
  T.eq('R4 status still doing', e && e.status, 'doing');
  T.eq('R4 assignee still bob', e && e.assignee, 'bob');
  T.eq('R4 still claimed by bob', e && e._claim && e._claim.by, 'bob');
}

/* R5: nothing to release: the status is still written; someone else's
 * assignee is left alone. */
{
  const dir = fixture('ac65-r5');
  ok(run(['set', '--id=TSK-001', '--status=doing', '--assignee=bob'], dir), 'set doing, assignee bob');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=todo'], dir);
  T.exit('R5 unclaimed: exit 0', r, 0);
  T.eq('R5 changed: status only', J(changedOf(r)), J(['status']));
  const e = entry(dir, 'TSK-001');
  T.eq('R5 status todo', e && e.status, 'todo');
  T.eq('R5 assignee bob kept', e && e.assignee, 'bob');
}

/* R6: --status=done follows claim's parent rule. */
{
  const dir = fixture('ac65-r6');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.', '--acceptance=- [ ] x'], dir), 'open subtask');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=doing'], dir), 'claim --status=doing');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=done'], dir);
  T.exit('R6 open child: exit 1', r, 1);
  T.eq('R6 refused:children_open', r.json && r.json.error, 'refused:children_open');
  T.eq('R6 claim survives', entry(dir, 'TSK-001')._claim && entry(dir, 'TSK-001')._claim.by, 'alice');
  const f = runJ(['release', '--id=TSK-001', '--as=alice', '--status=done', '--allow-open-children'], dir);
  T.exit('R6 --allow-open-children: exit 0', f, 0);
  const e = entry(dir, 'TSK-001');
  T.eq('R6 forced: status done', e && e.status, 'done');
  T.eq('R6 forced: unclaimed', e && e._claim, null);
}

/* R7: plain release is unchanged: the file is not touched. */
{
  const dir = fixture('ac65-r7');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=doing'], dir), 'claim --status=doing');
  const file = entry(dir, 'TSK-001').file;
  const before = fs.readFileSync(file, 'utf8');
  const r = runJ(['release', '--id=TSK-001', '--as=alice'], dir);
  T.exit('R7 plain release: exit 0', r, 0);
  T.eq('R7 changed: claim only', J(changedOf(r)), J(['claim']));
  T.eq('R7 file byte-identical', fs.readFileSync(file, 'utf8'), before);
}

/* R8: batch, two elements, one call. */
{
  const dir = fixture('ac65-r8');
  ok(run(['claim', '--id=TSK-001,TSK-002', '--as=alice', '--status=doing'], dir), 'batch claim --status=doing');
  const r = runJ(['release', '--id=TSK-001,TSK-002', '--as=alice', '--status=todo'], dir);
  T.exit('R8 batch: exit 0', r, 0);
  for (const id of ['TSK-001', 'TSK-002']) {
    const e = entry(dir, id);
    T.eq('R8 ' + id + ': status todo', e && e.status, 'todo');
    T.eq('R8 ' + id + ': unclaimed', e && e._claim, null);
  }
  const bad = runJ(['release', '--id=TSK-001,TSK-002', '--as=alice', '--status=nope'], dir);
  T.exit('R8 batch, unknown status: exit 1', bad, 1);
  T.eq('R8 batch, unknown status: invalid_value', bad.json && bad.json.error, 'invalid_value');
}

/* R9: --status equal to the current one: only the claim and the
 * releasing name's assignee change. */
{
  const dir = fixture('ac65-r9');
  ok(run(['claim', '--id=TSK-001', '--as=alice', '--status=blocked'], dir), 'claim --status=blocked');
  const r = runJ(['release', '--id=TSK-001', '--as=alice', '--status=blocked'], dir);
  T.exit('R9 same status: exit 0', r, 0);
  T.eq('R9 changed: assignee, claim', J(changedOf(r)), J(['assignee', 'claim']));
  const e = entry(dir, 'TSK-001');
  T.eq('R9 status still blocked', e && e.status, 'blocked');
  T.check('R9 no assignee', !!e && !('assignee' in e), J(e));
}

T.finish();
