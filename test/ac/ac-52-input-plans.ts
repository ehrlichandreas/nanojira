/* AC-52 — `--input` JSON plans for `new`/`set`, docs/SPECIFICATION.md
 * § 9 "`--input` — JSON plans for `new`/`set`" (v3.8, DECISIONS 171 A,
 * 172, 173, promoted: commit <pending>).
 *
 * AC-52 (§ 15): "--input=<file|-> takes a JSON object (keys = exactly
 * the command's own flag names) -- or, for new only, an array, and
 * children nesting with parent implied. Mutually exclusive with field
 * flags. set never takes an array: one object, addressing stays on the
 * CLI. A ref (always @-prefixed; a bare name or a decorated real id is
 * invalid_value) lets depends_on target a same-plan sibling declared
 * EARLIER in write order -- a forward or self reference is
 * invalid_value, failed_at naming the referencing object; parent is
 * never ref-aware. The whole plan validates before the first write;
 * write order and id order are both depth-first pre-order. A mid-plan
 * failure names created, refs resolved so far, and failed_at (a ref or
 * a JSON path) -- the one documented exception to every other failure
 * shape's {ok, error, hint}. Success is the existing single shape for
 * one object, a new {ok, ids, entries, refs} otherwise. acceptance may
 * be a JSON array of strings, one - [ ] ... line each, so
 * acceptance:no_checkbox cannot happen through --input. --dry-run (new
 * only, requires --input) validates and reports the would-be shape,
 * writing nothing."
 *
 * Draft reviewed by both outside teams against real plans of their own
 * (team-a, team-b-tests) before any test existed — DECISIONS
 * 172 amends the original draft (ecea716): no set plan form (confirmed);
 * refs must start with '@', the draft's shadowing rule dropped entirely;
 * a refs map in the result; failed_at; --dry-run; acceptance as an
 * array. Two legs below (D1, D2) are built directly from the shapes
 * each lead checked the draft against.
 *
 * B5-B9 (DECISIONS 173) were added after a live bug at d50b3fa: a plan
 * whose "Review" node named depends_on: ["@impl"] while @impl was
 * declared LATER passed validation, wrote everything, and stored
 * depends_on: ["undefined"] -- a silent wrong dependency, exactly what
 * the @-prefix rule above was supposed to rule out. B5/B8 are that case
 * (same subtree, then across subtrees); B6 is the direct backward-order
 * contrast; B7 is the self-reference boundary case; B9 closes the
 * second gap found alongside it, a ref given as parent.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers (--input does not exist at all yet, so every call
 * below is unknown_field today; B5/B8's forward ref and B9's ref-as-
 * parent are additionally red against d50b3fa specifically, where
 * --input exists but validation does not catch either).
 *
 * H1-H4 (DECISIONS 174) were added from the Verifier's own adversarial
 * review (docs/verification/v3-8-input.md): two `failed_at` gaps found
 * live, adjacent to D173's but not the same bug. H1-H3 are structural
 * plan-shape errors (`flattenPlan`'s own checks: a non-object array
 * member, null, a non-array `children`) raised outside the Fail wrapper
 * every other validation failure goes through, so none of them carries
 * `failed_at` today. H4 is the other gap: a REAL, catchable mid-plan
 * WRITE failure (`subtasks/` made read-only after the epic/task level
 * would already be writable) — not a `Fail` the command throws on
 * purpose, so the write loop's catch reraises it bare today, skipping
 * the same `created`/`refs`/`failed_at` enrichment a thrown `Fail`
 * already gets. H4 also pins the DECISIONS 174 `refs`-filtering rule
 * (the Lead caught the first draft of this leg asserting the opposite):
 * `refs` names only elements actually written, never the failing
 * element's own ref even when it declared one — a `ref` pointing at an
 * id nothing was ever written to is the same class of silent wrong
 * answer D173 removed. (A THIRD related case, a fault-hook abort
 * mid-plan, was ruled not a defect — D174.1 — since a fault hook
 * simulates an uncatchable crash; it has no leg here, and § 9 now states
 * that case in prose instead.) H4 skips itself with a reason if running as root,
 * where `chmod 555` does not restrict writes.
 */
import fs from 'fs';
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
function runStdin(args: string[], cwd: string, input: string) { return H.runJson(args, { cwd, input, unsetEnv: ['NJ_BACKLOG'], env: { NJ_NOW: H.FIXED_NOW } }); }

function fixture(label: string) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new task');
  return dir;
}

function writeInputFile(dir: string, obj: unknown) {
  const p = path.join(dir, 'plan.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

function subtaskCount(dir: string) {
  const d = path.join(dir, 'backlog', 'subtasks');
  return fs.existsSync(d) ? fs.readdirSync(d).length : 0;
}
function taskCount(dir: string) {
  const d = path.join(dir, 'backlog', 'tasks');
  return fs.existsSync(d) ? fs.readdirSync(d).length : 0;
}

/* ===================================================================== */
/* A1 — a single object via --input=-: same shape as the equivalent      */
/* field flags would produce                                             */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a1');
  ok(run(['init'], dir), 'nj init');
  const plan = { type: 'epic', title: 'Login', description: 'Users can sign in.' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('A1 new --input=- (single object): exit 0', r, 0);
  T.eq('A1 single-object shape: plain id, not ids/entries', r.json && r.json.id, 'EPIC-001');
  T.check('A1 entry carries the given title', r.json && r.json.entry && r.json.entry.title === 'Login', J(r.json));
}

/* ===================================================================== */
/* A2 — --input=<path>: reads a file instead of stdin                    */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a2');
  ok(run(['init'], dir), 'nj init');
  const p = writeInputFile(dir, { type: 'epic', title: 'E', description: 'D.' });
  const r = runJ(['new', '--input=' + p], dir);
  T.exit('A2 new --input=<path>: exit 0', r, 0);
  T.eq('A2 id allocated', r.json && r.json.id, 'EPIC-001');
}

/* ===================================================================== */
/* A3 — an unreadable --input path: not_found                            */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a3');
  ok(run(['init'], dir), 'nj init');
  const r = runJ(['new', '--input=' + path.join(dir, 'nope.json')], dir);
  T.exit('A3 unreadable --input path: exit 1', r, 1);
  T.eq('A3 not_found', r.json && r.json.error, 'not_found');
}

/* ===================================================================== */
/* A4 — malformed JSON: invalid_value                                    */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a4');
  ok(run(['init'], dir), 'nj init');
  const r = runStdin(['new', '--input=-'], dir, '{not json');
  T.exit('A4 malformed JSON: exit 1', r, 1);
  T.eq('A4 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* A5 — --input mutually exclusive with field flags                      */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a5');
  ok(run(['init'], dir), 'nj init');
  const r = runStdin(['new', '--input=-', '--title=X'], dir, JSON.stringify({ type: 'epic', title: 'E', description: 'D.' }));
  T.exit('A5 --input with a field flag: exit 1', r, 1);
  T.eq('A5 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* A6 — an unknown key in the input object: unknown_field                */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-a6');
  ok(run(['init'], dir), 'nj init');
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify({ type: 'epic', title: 'E', description: 'D.', bogus: 1 }));
  T.exit('A6 unknown key: exit 1', r, 1);
  T.eq('A6 unknown_field', r.json && r.json.error, 'unknown_field');
}

/* ===================================================================== */
/* A7 — set --input= takes exactly one object; an array is rejected      */
/* ===================================================================== */
{
  const dir = fixture('ac52-a7');
  const r = runStdin(['set', '--id=TSK-001', '--input=-'], dir, JSON.stringify([{ status: 'doing' }]));
  T.exit('A7 set --input= with an array: exit 1', r, 1);
  T.check('A7 not a silent success', r.json && r.json.error, J(r.json));
}

/* ===================================================================== */
/* A8 — set --input= supplies the field map; addressing stays on the CLI */
/* ===================================================================== */
{
  const dir = fixture('ac52-a8');
  const r = runStdin(['set', '--id=TSK-001', '--input=-'], dir, JSON.stringify({ status: 'doing', priority: 'high' }));
  T.exit('A8 set --input= (field map only): exit 0', r, 0);
  T.eq('A8 status written', r.json && r.json.entry && r.json.entry.status, 'doing');
  T.eq('A8 priority written', r.json && r.json.entry && r.json.entry.priority, 'high');
}

/* ===================================================================== */
/* B1 — ref must start with @: a bare name is invalid_value               */
/* ===================================================================== */
{
  const dir = fixture('ac52-b1');
  const plan = { type: 'subtask', parent: 'TSK-001', ref: 'impl', title: 'Implement', description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B1 ref without @: exit 1', r, 1);
  T.eq('B1 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B1 nothing written (subtasks dir still empty)', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* B2 — a depends_on entry that is a decorated real id (@ + real id      */
/* shape) is invalid_value, regardless of whether that id exists         */
/* ===================================================================== */
{
  const dir = fixture('ac52-b2');
  const plan = { type: 'subtask', parent: 'TSK-001', title: 'Review', depends_on: ['@TSK-001'], description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B2 depends_on with a decorated real id: exit 1', r, 1);
  T.eq('B2 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B2 nothing written', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* B3 — an unresolvable @-ref (no matching ref declared) is not_found,    */
/* the same code an unresolvable real id already gets                    */
/* ===================================================================== */
{
  const dir = fixture('ac52-b3');
  const plan = { type: 'subtask', parent: 'TSK-001', title: 'Review', depends_on: ['@nope'], description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B3 unresolvable ref: exit 1', r, 1);
  T.eq('B3 not_found', r.json && r.json.error, 'not_found');
  T.eq('B3 nothing written', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* B4 — two objects declaring the same ref: invalid_value (ambiguous)    */
/* ===================================================================== */
{
  const dir = fixture('ac52-b4');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', ref: '@dup', title: 'A', description: 'D.', acceptance: '- [ ] x' },
    { type: 'subtask', parent: 'TSK-001', ref: '@dup', title: 'B', description: 'D.', acceptance: '- [ ] x' },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B4 duplicate ref: exit 1', r, 1);
  T.eq('B4 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B4 nothing written (both objects, not just the second)', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* B5 — a FORWARD ref: depends_on names a ref declared LATER in write    */
/* order -- invalid_value, failed_at names the REFERENCING object,       */
/* nothing is written (DECISIONS 173, found live at d50b3fa: this passed */
/* validation and wrote depends_on: ["undefined"])                       */
/* ===================================================================== */
{
  const dir = fixture('ac52-b5');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', title: 'Review', depends_on: ['@impl'], description: 'D.', acceptance: '- [ ] x' },
    { type: 'subtask', parent: 'TSK-001', ref: '@impl', title: 'Implement', description: 'D.', acceptance: '- [ ] x' },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B5 forward ref: exit 1', r, 1);
  T.eq('B5 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B5 failed_at names the referencing object (the first, by JSON path)', r.json && r.json.failed_at, '[0]');
  T.eq('B5 nothing written: backlog dir has no subtasks at all', subtaskCount(dir), 0);
  T.check('B5 no created/refs (validation failure, nothing attempted)',
    !('created' in (r.json || {})) && !('refs' in (r.json || {})), J(r.json));
}

/* ===================================================================== */
/* B6 — the reverse order: the SAME two objects, impl declared before    */
/* review, still works -- direct contrast with B5                        */
/* ===================================================================== */
{
  const dir = fixture('ac52-b6');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', ref: '@impl', title: 'Implement', description: 'D.', acceptance: '- [ ] x' },
    { type: 'subtask', parent: 'TSK-001', title: 'Review', depends_on: ['@impl'], description: 'D.', acceptance: '- [ ] x' },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B6 backward ref: exit 0', r, 0);
  const entries = (r.json && r.json.entries) || [];
  T.eq('B6 review\'s depends_on resolved to impl\'s real id', entries[1] && entries[1].depends_on, [entries[0] && entries[0].id]);
}

/* ===================================================================== */
/* B7 — a SELF-reference: an object's own ref, in its own depends_on --  */
/* invalid_value, the boundary case of "declared earlier" (declared here */
/* is never "earlier")                                                   */
/* ===================================================================== */
{
  const dir = fixture('ac52-b7');
  const plan = { type: 'subtask', parent: 'TSK-001', ref: '@x', depends_on: ['@x'], title: 'Self', description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B7 self-reference: exit 1', r, 1);
  T.eq('B7 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B7 failed_at names the object itself (it has a ref, so by ref not JSON path)', r.json && r.json.failed_at, '@x');
  T.eq('B7 nothing written', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* B8 — a FORWARD ref ACROSS SUBTREES: a child of task 1 depends on a    */
/* ref declared on a child of task 2, which comes later in write order   */
/* -- not just a same-parent sibling case                                */
/* ===================================================================== */
{
  const dir = H.freshDir('ac52-b8');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const plan = {
    type: 'task', parent: 'EPIC-001', title: 'Task 1', description: 'D.', acceptance: '- [ ] x',
    children: [
      { type: 'subtask', title: 'T1 child depends on T2\'s child', depends_on: ['@t2-impl'], description: 'D.', acceptance: '- [ ] x' },
    ],
  };
  const plan2 = {
    type: 'task', parent: 'EPIC-001', title: 'Task 2', description: 'D.', acceptance: '- [ ] x',
    children: [
      { type: 'subtask', ref: '@t2-impl', title: 'T2 impl', description: 'D.', acceptance: '- [ ] x' },
    ],
  };
  // Both tasks and both subtrees in one plan, task 1 (and its forward-looking
  // child) declared first, task 2 (and the ref it needs) declared second.
  const fullPlan = [plan, plan2];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(fullPlan));
  T.exit('B8 forward ref across subtrees: exit 1', r, 1);
  T.eq('B8 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('B8 failed_at names the referencing object by JSON path (it declared no ref of its own)', r.json && r.json.failed_at, '[0].children[0]');
  T.eq('B8 nothing written at all (not even Task 1 itself)', taskCount(dir), 0);
}

/* ===================================================================== */
/* B9 — parent is never ref-aware: an explicit "parent": "@x" is          */
/* invalid_value, not a ref lookup and not not_found (DECISIONS 173, the  */
/* second gap found alongside the forward-ref one)                       */
/* ===================================================================== */
{
  const dir = fixture('ac52-b9');
  const plan = [
    { type: 'task', parent: 'EPIC-001', ref: '@t2', title: 'Task 2', description: 'D.', acceptance: '- [ ] x' },
    { type: 'subtask', parent: '@t2', title: 'Orphan', description: 'D.', acceptance: '- [ ] x' },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('B9 ref used as parent: exit 1', r, 1);
  T.eq('B9 invalid_value (not not_found)', r.json && r.json.error, 'invalid_value');
  T.eq('B9 nothing written: still just the one task the fixture created', taskCount(dir), 1);
  T.eq('B9 nothing written: no subtasks', subtaskCount(dir), 0);
}

/* ===================================================================== */
/* D1 (team-a's real plan shape) — a top-level OBJECT with an       */
/* EXPLICIT parent (an existing task) plus its own children              */
/* ===================================================================== */
{
  const dir = fixture('ac52-d1');
  const plan = {
    type: 'subtask', parent: 'TSK-001', ref: '@impl', title: 'Implement the thing',
    description: 'D.', acceptance: '- [ ] x',
  };
  // A second call shape: the same idea, but the top-level object carries
  // children of its own (still rooted at an explicit, not implied, parent).
  const withChildren = {
    type: 'task', parent: 'EPIC-001', title: 'New task under an existing epic',
    description: 'D.', acceptance: '- [ ] x',
    children: [
      { type: 'subtask', title: 'Sub A', description: 'D.', acceptance: '- [ ] x' },
      { type: 'subtask', title: 'Sub B', description: 'D.', acceptance: '- [ ] x' },
    ],
  };
  const r1 = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('D1a a top-level subtask with an explicit parent: exit 0', r1, 0);
  T.eq('D1a parent is the named existing task', r1.json && r1.json.entry && r1.json.entry.parent, 'TSK-001');

  const r2 = runStdin(['new', '--input=-'], dir, JSON.stringify(withChildren));
  T.exit('D1b a top-level object with an explicit parent AND children: exit 0', r2, 0);
  T.eq('D1b plural shape: 3 ids (the task plus its two subtasks)', r2.json && r2.json.ids && r2.json.ids.length, 3);
  const entries2 = (r2.json && r2.json.entries) || [];
  T.eq('D1b the top-level object\'s own parent is the named existing epic', entries2[0] && entries2[0].parent, 'EPIC-001');
  T.eq('D1b its children\'s parent is implied: the new task itself', entries2[1] && entries2[1].parent, entries2[0] && entries2[0].id);
}

/* ===================================================================== */
/* D2 (team-b's real plan shape) — an ARRAY of top-level subtasks, */
/* each with an explicit parent naming the SAME existing task, a review  */
/* depends_on its own impl via ref                                       */
/* ===================================================================== */
{
  const dir = fixture('ac52-d2');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', ref: '@impl', title: 'Implement X',
      description: 'D.', acceptance: ['Route registered', 'Tests pass'] },
    { type: 'subtask', parent: 'TSK-001', title: 'Review X', assignee: 'bob',
      depends_on: ['@impl'], description: 'D.', acceptance: ['Code reviewed'] },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('D2 array of top-level subtasks under an existing task: exit 0', r, 0);
  T.eq('D2 both ids created', r.json && r.json.ids && r.json.ids.length, 2);
  const entries = (r.json && r.json.entries) || [];
  T.eq('D2 both share the same explicit parent', entries.map((e: any) => e.parent), ['TSK-001', 'TSK-001']);
  T.eq('D2 the review\'s depends_on resolved from the ref to the impl\'s real id', entries[1] && entries[1].depends_on, [entries[0] && entries[0].id]);
  T.eq('D2 refs map names @impl -> the real id', r.json && r.json.refs && r.json.refs['@impl'], entries[0] && entries[0].id);
  T.check('D2 acceptance arrays became checkbox lines (no acceptance:no_checkbox)',
    !((entries[0] && entries[0]._problems) || []).includes('acceptance:no_checkbox') &&
    !((entries[1] && entries[1]._problems) || []).includes('acceptance:no_checkbox'), J(entries));
}

/* ===================================================================== */
/* E1 — acceptance as a JSON array: each string becomes a checkbox line  */
/* ===================================================================== */
{
  const dir = fixture('ac52-e1');
  const plan = { type: 'subtask', parent: 'TSK-001', title: 'S',
    description: 'D.', acceptance: ['200 with a valid password', '401 otherwise'] };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('E1 acceptance as array: exit 0', r, 0);
  T.check('E1 no acceptance:no_checkbox (array form always produces checkboxes)',
    !((r.json && r.json.entry && r.json.entry._problems) || []).includes('acceptance:no_checkbox'), J(r.json));
  const body = (r.json && r.json.entry && r.json.entry.file) ? fs.readFileSync(r.json.entry.file, 'utf8') : '';
  T.check('E1 both lines written as - [ ] checkboxes, in order',
    /- \[ \] 200 with a valid password\n- \[ \] 401 otherwise/.test(body), body);
}

/* ===================================================================== */
/* E2 — an EMPTY acceptance array: same end state as an empty string --  */
/* incomplete:acceptance, not acceptance:no_checkbox (nothing to scan)   */
/* ===================================================================== */
{
  const dir = fixture('ac52-e2');
  const plan = { type: 'subtask', parent: 'TSK-001', title: 'S', description: 'D.', acceptance: [] };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('E2 empty acceptance array: exit 0', r, 0);
  T.check('E2 incomplete:acceptance (empty section, same as --acceptance=)',
    ((r.json && r.json.entry && r.json.entry._problems) || []).includes('incomplete:acceptance'), J(r.json));
  T.check('E2 NOT acceptance:no_checkbox (an empty section is not "content with no checkbox")',
    !((r.json && r.json.entry && r.json.entry._problems) || []).includes('acceptance:no_checkbox'), J(r.json));
}

/* ===================================================================== */
/* F1 — --dry-run: full validation, no write, would-be shape, no ids     */
/* ===================================================================== */
{
  const dir = fixture('ac52-f1');
  const plan = { type: 'subtask', parent: 'TSK-001', title: 'S', description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-', '--dry-run'], dir, JSON.stringify(plan));
  T.exit('F1 --dry-run: exit 0', r, 0);
  T.check('F1 dry_run:true', r.json && r.json.dry_run === true, J(r.json));
  T.check('F1 no id/ids/file/created/updated/refs anywhere', !r.json.id && !r.json.ids && !r.json.refs, J(r.json));
  const entry = (r.json && r.json.entries && r.json.entries[0]) || {};
  T.eq('F1 the entry carries the given title', entry.title, 'S');
  T.check('F1 no file was actually written', !fs.existsSync(path.join(dir, 'backlog', 'subtasks')) || fs.readdirSync(path.join(dir, 'backlog', 'subtasks')).length === 0, 'a file was written');
}

/* ===================================================================== */
/* F2 — a dry run that would fail validation still fails, same code      */
/* ===================================================================== */
{
  const dir = fixture('ac52-f2');
  const plan = { type: 'subtask', parent: 'TSK-001', ref: 'bad-no-at', title: 'S', description: 'D.', acceptance: '- [ ] x' };
  const r = runStdin(['new', '--input=-', '--dry-run'], dir, JSON.stringify(plan));
  T.exit('F2 --dry-run with an invalid plan: exit 1', r, 1);
  T.eq('F2 invalid_value (same as without --dry-run)', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* F3 — --dry-run without --input is invalid_value                       */
/* ===================================================================== */
{
  const dir = fixture('ac52-f3');
  const r = runJ(['new', '--type=epic', '--title=X', '--description=D.', '--dry-run'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('F3 --dry-run without --input: exit 1', r, 1);
  T.eq('F3 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* F4 — --dry-run on set is unknown_field (set has no plan form to       */
/* preview)                                                               */
/* ===================================================================== */
{
  const dir = fixture('ac52-f4');
  const r = runStdin(['set', '--id=TSK-001', '--input=-', '--dry-run'], dir, JSON.stringify({ status: 'doing' }));
  T.exit('F4 set --dry-run: exit 1', r, 1);
  T.eq('F4 unknown_field', r.json && r.json.error, 'unknown_field');
}

/* ===================================================================== */
/* G1 — mid-plan failure: created + refs (resolved so far) + failed_at   */
/* name the object at fault                                               */
/* ===================================================================== */
{
  const dir = fixture('ac52-g1');
  // Two siblings; the second has a bad parent type (invalid_target),
  // discovered during validation -- but to exercise failed_at's JSON-path
  // form (not a ref), the failing object declares no ref of its own.
  const plan = [
    { type: 'subtask', parent: 'TSK-001', ref: '@ok', title: 'Fine', description: 'D.', acceptance: '- [ ] x' },
    { type: 'subtask', parent: 'EPIC-001', title: 'Wrong parent type', description: 'D.', acceptance: '- [ ] x' },
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('G1 a plan with one invalid object: exit 1', r, 1);
  T.eq('G1 invalid_target (subtask parent must be a task)', r.json && r.json.error, 'invalid_target');
  T.eq('G1 failed_at names the second top-level object by JSON path', r.json && r.json.failed_at, '[1]');
  T.check('G1 no created/refs (this failed at validation, nothing attempted)',
    !('created' in (r.json || {})) && !('refs' in (r.json || {})), J(r.json));
}

/* ===================================================================== */
/* H1-H3 — structural plan-shape errors (DECISIONS 174.2, found by the   */
/* Verifier): a non-object array member, null, and a non-array children  */
/* are raised in flattenPlan itself, OUTSIDE validatePlanNode's Fail     */
/* wrapper -- today they reach the top-level handler with no failed_at   */
/* at all, contradicting "on both a mid-plan write failure and a         */
/* validation failure". Each must carry failed_at as the JSON path, and  */
/* write nothing.                                                        */
/* ===================================================================== */
{
  const dir = fixture('ac52-h1');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', title: 'Fine', description: 'D.', acceptance: '- [ ] x' },
    42,
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('H1 a non-object array member: exit 1', r, 1);
  T.eq('H1 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('H1 failed_at names the offending element by JSON path', r.json && r.json.failed_at, '[1]');
  T.eq('H1 nothing written', subtaskCount(dir), 0);
}

{
  const dir = fixture('ac52-h2');
  const plan = [
    { type: 'subtask', parent: 'TSK-001', title: 'Fine', description: 'D.', acceptance: '- [ ] x' },
    null,
  ];
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('H2 a null array member: exit 1', r, 1);
  T.eq('H2 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('H2 failed_at names the offending element by JSON path', r.json && r.json.failed_at, '[1]');
  T.eq('H2 nothing written', subtaskCount(dir), 0);
}

{
  const dir = fixture('ac52-h3');
  const plan = { type: 'epic', title: 'E', description: 'D.', children: 'nope' };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('H3 a non-array children: exit 1', r, 1);
  T.eq('H3 invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('H3 failed_at names the object whose children is malformed', r.json && r.json.failed_at, '[0]');
  T.check('H3 nothing written (no new epic beyond the fixture\'s own)',
    taskCount(dir) === 1 && subtaskCount(dir) === 0, J(r.json));
}

/* ===================================================================== */
/* H4 — a REAL, catchable mid-plan WRITE failure: subtasks/ made         */
/* read-only after the epic/task level would already be writable, so     */
/* the epic and task write successfully and the subtask's own write      */
/* fails with EACCES (DECISIONS 174.1 is the fault-hook variant of this,  */
/* ruled not a defect since a fault hook simulates an uncatchable crash;  */
/* this is the real, catchable case the ruling asked the Verifier -- and  */
/* in its place here, the Oracle -- to prove instead). The failure is     */
/* NOT a Fail the command throws on purpose, so it surfaces as            */
/* internal_error, the same code an identical EACCES already gets from a  */
/* plain `nj set` on a read-only target -- `io_error` is reserved (§ 9's  */
/* own problem-code table) for init's own target and the working-         */
/* directory check specifically, not a generic write-time OS error        */
/* anywhere else, so asserting internal_error here is the behaviour       */
/* already consistent with every other command, not a new exception.      */
/*                                                                         */
/* The task itself declares a ref (@t) that DOES succeed (tasks/ stays    */
/* writable), so this leg checks both halves of the DECISIONS 174 rule    */
/* in one plan: refs includes a successfully-written element's own ref    */
/* (@t -> TSK-001) and EXCLUDES the failing element's own ref (@a) --     */
/* the corrected rule, after the Lead caught the first draft of this leg  */
/* asserting the opposite (refs containing a ref pointing at an id        */
/* nothing was ever written to -- the same class of silent wrong answer   */
/* D173 removed).                                                         */
/*                                                                         */
/* Today this is red because the write loop's catch only enriches a       */
/* thrown Fail with created/refs/failed_at and reraises anything else      */
/* bare -- the enrichment never runs for this very real, very catchable    */
/* failure. (The `e instanceof Fail` branch that already computes         */
/* `Object.fromEntries(refRealId)` is itself unreached by ANY input        */
/* today -- nothing inside cmd-new.ts's write loop ever throws a Fail --   */
/* so there is no separate live case to exercise it through; fixing this   */
/* leg's path is the one live proof available for the refs-filtering       */
/* rule, and the fix belongs in the one shared expression both branches    */
/* read from.) Skips with a reason if running as root, where chmod 555    */
/* does not restrict writes and this mechanism cannot produce an EACCES.  */
/* ===================================================================== */
{
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    T.check('H4 (mid-plan write failure): skipped', false,
      'CANNOT RUN: running as root, chmod 555 does not restrict root -- cannot construct a real EACCES this way on this machine');
  } else {
    const dir = H.freshDir('ac52-h4');
    ok(run(['init'], dir), 'nj init');
    const subtasksDir = path.join(dir, 'backlog', 'subtasks');
    fs.mkdirSync(subtasksDir, { recursive: true });
    fs.chmodSync(subtasksDir, 0o555);
    const plan = {
      type: 'epic', title: 'E', description: 'D.',
      children: [
        { type: 'task', ref: '@t', title: 'T', description: 'D.', acceptance: '- [x] x',
          children: [
            { type: 'subtask', ref: '@a', title: 'A', description: 'D.', acceptance: '- [ ] x' },
          ] },
      ],
    };
    let r;
    try {
      r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
    } finally {
      fs.chmodSync(subtasksDir, 0o755);
    }
    T.exit('H4 a real mid-plan write failure: exit 1', r, 1);
    T.eq('H4 internal_error (an uncaught OS error, same as a plain `nj set` on a read-only target gets)',
      r.json && r.json.error, 'internal_error');
    T.eq('H4 created lists the epic and task, written before the failure', r.json && r.json.created,
      ['EPIC-001', 'TSK-001']);
    T.eq('H4 refs includes @t (TSK-001 was actually written)', r.json && r.json.refs && r.json.refs['@t'], 'TSK-001');
    T.check('H4 refs EXCLUDES @a (its own object, SUB-001, was never written)',
      !(r.json && r.json.refs && '@a' in r.json.refs), J(r.json));
    T.eq('H4 failed_at names the failing subtask by its own ref', r.json && r.json.failed_at, '@a');
    T.eq('H4 the epic and task files actually exist on disk', taskCount(dir), 1);
    T.eq('H4 the subtask file itself was never written', subtaskCount(dir), 0);
  }
}

/* ===================================================================== */
/* I1 -- the nesting-rejection message uses the article helper, same as   */
/* every other message built from a type name (DECISIONS 182 B, D180's    */
/* known gap: this one spot still said "a epic"). A subtask nested        */
/* directly under an epic -- the invalid_target case line 396 of          */
/* cmd-new.ts raises -- names the WRONG parent type with its correct      */
/* article: "an epic", not "a epic".                                      */
/* ===================================================================== */
{
  const dir = fixture('ac52-i1');
  const plan = {
    type: 'epic', title: 'E', description: 'D.',
    children: [
      { type: 'subtask', title: 'S', description: 'D.', acceptance: '- [ ] x' },
    ],
  };
  const r = runStdin(['new', '--input=-'], dir, JSON.stringify(plan));
  T.exit('I1 a subtask nested directly under an epic: exit 1', r, 1);
  T.eq('I1 invalid_target', r.json && r.json.error, 'invalid_target');
  /* The prose text (where the article lives) is Fail's own `message`,
   * never part of --json (only `error`/`hint` are, § 9) -- so this reads
   * stderr, same as every other article-wording check in this tree. */
  T.check('I1 stderr says "an epic", not "a epic"', /\ban epic\b/.test(r.stderr), r.stderr);
  T.check('I1 stderr never says "a epic"', !/\ba epic\b/.test(r.stderr), r.stderr);
}

T.finish();
