/* AC-74 — `--status=` on `list`/`find` takes a comma-separated list
 * (docs/SPECIFICATION.md § 9a/§ 9; DECISIONS addendum; TSK-055).
 *
 * Found by an outside team (feedback/fernuni-hagen, 2026-10-24):
 * `list --status=todo,doing` failed with `unknown status 'todo,doing'`, so
 * checking for any open work took one call per status. `--exclude-tag`
 * already takes a comma list; `--status` on every read that has it (`list`,
 * `find`) should too. `next`/`claim`/`release`/`set`/`new` keep the single
 * value their own commands have always had -- this is about reads that
 * list/select several elements, not a write that sets one status on one
 * element.
 *
 * Written before the fix: red against d29efa23.
 *
 * A2/C's padded-item legs and E9/E10 (Reviewer MUST, TSK-055 fixup,
 * rel470 integration) pin a regression the first cut introduced: trimming
 * each comma-split item, matching `--exclude-tag`'s own trim, silently
 * turned `" todo"` into a match instead of refusing it, where v4.6.0's
 * single-value form had refused `" todo"` outright. Red against
 * c94d3215 (the un-amended commit), in a second worktree at that sha.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
import * as MCP from '../lib/mcp-stdio.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();
H.requireNjMcp();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr) + J(r.stdout));
  return r;
}
const ENV = { NJ_NOW: H.FIXED_NOW };
const UNSET = ['NJ_BACKLOG', 'NJ_ON_CHANGE', 'NJ_AUTHOR'];
function run(args: string[], cwd: string): RunResult {
  return H.runNj(args, { cwd, env: ENV, unsetEnv: UNSET });
}
function runJ(args: string[], cwd: string) {
  return H.runJson(args, { cwd, env: ENV, unsetEnv: UNSET });
}
function ids(r: { json?: any }): string[] | null {
  return r.json && Array.isArray(r.json.entries) ? r.json.entries.map((e: any) => e.id) : null;
}

/* TSK-001 todo, TSK-002 doing, TSK-003 blocked, TSK-004 done. */
function fixture(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  const statuses = ['todo', 'doing', 'blocked', 'done'];
  statuses.forEach((s, i) => {
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + (i + 1), '--description=D.', '--acceptance=- [ ] a'], dir), 'new task ' + (i + 1));
    if (s !== 'todo') ok(run(['set', '--id=TSK-00' + (i + 1), '--status=' + s], dir), 'set status ' + s);
  });
  return dir;
}

/* A — a single value behaves exactly as before, on list and find */
{
  const dir = fixture('ac74-a');
  T.eq('A list --status=todo: single value, unchanged', J(ids(runJ(['list', '--status=todo', '--type=task'], dir))), J(['TSK-001']));
  T.eq('A find --status=doing: single value, unchanged', J(ids(runJ(['find', 'T', '--status=doing'], dir))), J(['TSK-002']));
}

/* A2 — a single value with stray whitespace is refused exactly as v4.6.0  */
/*      did, byte-identical message and hint (Reviewer MUST, TSK-055       */
/*      fixup): never trimmed, since a status name never legitimately      */
/*      carries whitespace.                                                */
{
  const dir = fixture('ac74-a2');
  const spaced = runJ(['list', '--status= todo', '--type=task'], dir);
  T.check('A2 list --status=" todo": invalid_value, not silently matched', spaced.status !== 0 && spaced.json && spaced.json.error === 'invalid_value', J(spaced.json));
  T.eq('A2 list --status=" todo": byte-identical hint to v4.6.0', spaced.json && spaced.json.hint,
    "did you mean 'todo'? Known statuses: todo, doing, blocked, review, done");
  const bogusSpaced = runJ(['list', '--status= bogus', '--type=task'], dir);
  T.check('A2 list --status=" bogus": invalid_value', bogusSpaced.status !== 0 && bogusSpaced.json && bogusSpaced.json.error === 'invalid_value', J(bogusSpaced.json));
  T.eq('A2 list --status=" bogus": byte-identical hint to v4.6.0 (no did-you-mean)', bogusSpaced.json && bogusSpaced.json.hint,
    'Known statuses: todo, doing, blocked, review, done');
}

/* B — a comma list matches ANY of the listed statuses */
{
  const dir = fixture('ac74-b');
  T.eq('B list --status=todo,doing', J(ids(runJ(['list', '--status=todo,doing', '--type=task'], dir))), J(['TSK-001', 'TSK-002']));
  T.eq('B list --status=doing,todo: order of the flag does not change the result order', J(ids(runJ(['list', '--status=doing,todo', '--type=task'], dir))), J(['TSK-001', 'TSK-002']));
  T.eq('B find --status=blocked,done', J(ids(runJ(['find', 'T', '--status=blocked,done'], dir))), J(['TSK-003', 'TSK-004']));
  T.eq('B all four statuses listed: everything', J(ids(runJ(['list', '--status=todo,doing,blocked,done', '--type=task'], dir))),
    J(['TSK-001', 'TSK-002', 'TSK-003', 'TSK-004']));
}

/* C — an unknown or empty item is invalid_value, naming that one item and */
/*     the allowed values -- nothing is listed, not a partial result       */
{
  const dir = fixture('ac74-c');
  for (const cmd of [['list'], ['find', 'T']]) {
    const bad = runJ(cmd.concat(['--status=todo,bogus']), dir);
    T.check(cmd.join(' ') + ' --status=todo,bogus: invalid_value', bad.status !== 0 && bad.json && bad.json.error === 'invalid_value', J(bad.json));
    T.check(cmd.join(' ') + ' --status=todo,bogus: names the bad item, not the whole list',
      bad.json && /unknown status 'bogus'/.test(bad.stderr || '') || (bad.json && bad.json.hint && /todo, doing, blocked, review, done/.test(bad.json.hint)),
      J(bad.json) + J(bad.stderr));
    const trailing = runJ(cmd.concat(['--status=todo,']), dir);
    T.check(cmd.join(' ') + " --status=todo, (trailing comma): invalid_value on the empty item",
      trailing.status !== 0 && trailing.json && trailing.json.error === 'invalid_value', J(trailing.json));
    const doubled = runJ(cmd.concat(['--status=todo,,doing']), dir);
    T.check(cmd.join(' ') + ' --status=todo,,doing (doubled comma): invalid_value on the empty item',
      doubled.status !== 0 && doubled.json && doubled.json.error === 'invalid_value', J(doubled.json));
    // Reviewer MUST (TSK-055 fixup): a space after the comma is not
    // trimmed either -- "todo, doing" names " doing" exactly, as given.
    const padded = runJ(cmd.concat(['--status=todo, doing']), dir);
    T.check(cmd.join(' ') + ' --status=todo, doing (padded item): invalid_value, not silently matched',
      padded.status !== 0 && padded.json && padded.json.error === 'invalid_value', J(padded.json));
    T.eq(cmd.join(' ') + ' --status=todo, doing: names " doing" exactly as given, byte-identical hint to v4.6.0',
      padded.json && padded.json.hint, "did you mean 'doing'? Known statuses: todo, doing, blocked, review, done");
  }
  T.check('C a refused list/find reports nothing claimed or changed (reads anyway, but nothing partial)',
    (ids(runJ(['list', '--type=task'], dir)) || []).length === 4, '');
}

/* D — --help: list/find show the list form and the allowed values; next   */
/*     (and every write) keeps its own single-value --status doc           */
{
  const dir = fixture('ac74-d');
  for (const cmd of ['list', 'find']) {
    const h = run([cmd, '--help'], dir).stdout || '';
    const line = h.split('\n').find((l) => l.trimStart().startsWith('--status=')) || '';
    T.check(cmd + " --help: --status shows the list form '<a,b,...>'", /--status=<a,b,\.\.\.>/.test(line), J(line));
    T.check(cmd + ' --help: --status names the allowed values', /allowed: todo, doing, blocked, review, done/.test(line), J(line));
  }
  const next = run(['next', '--help'], dir).stdout || '';
  const nextLine = next.split('\n').find((l) => l.trimStart().startsWith('--status=')) || '';
  T.check("next --help: --status stays single-value ('<value>', not a list)", /--status=<value>/.test(nextLine), J(nextLine));
  T.check('next --help: --status still names the allowed values', /allowed: todo, doing, blocked, review, done/.test(nextLine), J(nextLine));
}

/* E — MCP: list/find's status schema has no enum (a strict client would   */
/*     reject the list form against one); the allowed values are still in */
/*     the description. Every other tool's status field keeps its enum.   */
(async () => {
  const dir = fixture('ac74-e');
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: H.FIXED_NOW };

  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + bl], { cwd: dir, env });
  try {
    const list = await s.modernToolsList();
    const tools = (list.result || {}).tools || [];
    const byName = (n: string) => tools.find((t: any) => t.name === n);

    for (const name of ['list', 'find']) {
      const tool = byName(name);
      const statusProp = tool && tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.status;
      T.check(`E1 ${name} tool: status has no enum (list form, TSK-055)`, !!statusProp && statusProp.enum === undefined, J(statusProp));
      T.check(`E2 ${name} tool: status description names the allowed values`,
        !!statusProp && /todo, doing, blocked, review, done/.test(statusProp.description || ''), J(statusProp));
    }
    for (const name of ['next', 'claim', 'release', 'new', 'set']) {
      const tool = byName(name);
      const statusProp = tool && tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.status;
      T.check(`E3 ${name} tool: status keeps its enum (single value, unaffected)`,
        !!statusProp && Array.isArray(statusProp.enum) && statusProp.enum.length === 5, J(statusProp));
    }

    const r1 = await s.modernToolsCall('list', { status: 'todo,doing' });
    T.check('E4 tools/call list status=todo,doing: no protocol error', !r1.error, J(r1.error));
    const content1 = r1.result && r1.result.content && r1.result.content[0] && JSON.parse(r1.result.content[0].text);
    T.eq('E5 tools/call list status=todo,doing: both statuses, same as the CLI',
      content1 && content1.entries && content1.entries.filter((e: any) => e.type === 'task').map((e: any) => e.id), ['TSK-001', 'TSK-002']);

    const r2 = await s.modernToolsCall('find', { text: 'T', status: 'blocked,done' });
    const content2 = r2.result && r2.result.content && r2.result.content[0] && JSON.parse(r2.result.content[0].text);
    T.eq('E6 tools/call find status=blocked,done', content2 && content2.entries && content2.entries.map((e: any) => e.id), ['TSK-003', 'TSK-004']);

    const r3 = await s.modernToolsCall('list', { status: 'todo,bogus' });
    T.check('E7 tools/call list status=todo,bogus: refused as isError', r3.result && r3.result.isError === true, J(r3.result));
    T.eq('E8 tools/call list status=todo,bogus: invalid_value, naming the bad item',
      r3.result && r3.result.structuredContent && r3.result.structuredContent.error, 'invalid_value');

    // Reviewer MUST (TSK-055 fixup): the MCP pre-check never trims either --
    // "todo, doing" names " doing" exactly, same as the CLI.
    const r4 = await s.modernToolsCall('list', { status: 'todo, doing' });
    T.check('E9 tools/call list status="todo, doing": refused as isError, not silently matched', r4.result && r4.result.isError === true, J(r4.result));
    T.eq('E10 tools/call list status="todo, doing": invalid_value, naming the padded item',
      r4.result && r4.result.structuredContent && r4.result.structuredContent.error, 'invalid_value');
  } finally {
    await s.close();
  }
  T.finish();
})();
