/* AC-48 — `nj set --add-tags` / `--remove-tags`, docs/SPECIFICATION.md § 9
 * (v3.7, DECISIONS 163 B, promoted: commit <pending>).
 *
 * AC-48 (§ 15): "An incremental alternative to --tags=, for set only:
 * --remove-tags takes effect first, then --add-tags appends anything
 * named there not already present, in its own order, after whatever tags
 * were not removed (their relative order kept). Adding a present tag, or
 * removing an absent one, is a no-op for that tag, not an error. Combined
 * with --tags= in the same call is invalid_value, nothing written, in
 * every combination. Both work in batch (--id=A,B,C), each ID's own tags
 * read and changed independently. Each tag is validated the same as
 * --tags's own items. nj-mcp's set tool schema gains both fields."
 *
 * Found by an outside team (feedback/team-b-tests TSK-008):
 * --tags= replaces the whole tag set; removing one tag meant re-listing
 * every other tag by hand, easy to lose one.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers (both flags are unknown_field today).
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
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args: string[], cwd?: string, env?: Record<string, string | undefined>): RunResult {
  return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] });
}
function runJ(args: string[], cwd?: string, env?: Record<string, string | undefined>) {
  return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] });
}

function fixture(label: string, tags?: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  const tagArg = tags !== undefined ? ['--tags=' + tags] : [];
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'].concat(tagArg), dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  return dir;
}

/* ===================================================================== */
/* B1 — `--add-tags` appends a new tag after the existing ones           */
/* ===================================================================== */
{
  const dir = fixture('ac48-b1', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--add-tags=c'], dir);
  T.exit('B1 --add-tags=c: exit 0', r, 0);
  T.eq('B1 tags end up a,b,c (existing order kept, new tag appended)', r.json && r.json.entry && r.json.entry.tags, ['a', 'b', 'c']);
  T.check('B1 "tags" is reported in changed', (r.json && r.json.changed || []).includes('tags'), J(r.json));
}

/* ===================================================================== */
/* B2 — `--add-tags` of an already-present tag is a no-op (not           */
/* duplicated, does not move, "tags" not reported as changed)            */
/* ===================================================================== */
{
  const dir = fixture('ac48-b2', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--add-tags=a'], dir);
  T.exit('B2 --add-tags=a (already present): exit 0', r, 0);
  T.eq('B2 tags unchanged: a,b (not a,b,a)', r.json && r.json.entry && r.json.entry.tags, ['a', 'b']);
  T.check('B2 "tags" is NOT reported in changed (nothing actually changed)', !(r.json && r.json.changed || []).includes('tags'), J(r.json));
}

/* ===================================================================== */
/* B3 — `--remove-tags` removes an existing tag                          */
/* ===================================================================== */
{
  const dir = fixture('ac48-b3', 'a,b,c');
  const r = runJ(['set', '--id=EPIC-001', '--remove-tags=b'], dir);
  T.exit('B3 --remove-tags=b: exit 0', r, 0);
  T.eq('B3 tags end up a,c (b removed, a/c keep their relative order)', r.json && r.json.entry && r.json.entry.tags, ['a', 'c']);
  T.check('B3 "tags" is reported in changed', (r.json && r.json.changed || []).includes('tags'), J(r.json));
}

/* ===================================================================== */
/* B4 — `--remove-tags` of an absent tag is a no-op, not an error         */
/* ===================================================================== */
{
  const dir = fixture('ac48-b4', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--remove-tags=zzz'], dir);
  T.exit('B4 --remove-tags=zzz (absent): exit 0, not an error', r, 0);
  T.eq('B4 tags unchanged: a,b', r.json && r.json.entry && r.json.entry.tags, ['a', 'b']);
  T.check('B4 "tags" is NOT reported in changed', !(r.json && r.json.changed || []).includes('tags'), J(r.json));
}

/* ===================================================================== */
/* B5 — both together: remove first, then add; added tags land at the    */
/* end, after whatever was not removed                                   */
/* ===================================================================== */
{
  const dir = fixture('ac48-b5', 'a,b,c');
  const r = runJ(['set', '--id=EPIC-001', '--remove-tags=b', '--add-tags=d,e'], dir);
  T.exit('B5 --remove-tags=b --add-tags=d,e: exit 0', r, 0);
  T.eq('B5 tags end up a,c,d,e', r.json && r.json.entry && r.json.entry.tags, ['a', 'c', 'd', 'e']);
}

/* ===================================================================== */
/* B6 — a tag named in BOTH --remove-tags and --add-tags ends up         */
/* present, appended at the END (removed from its old position, not      */
/* re-inserted there)                                                     */
/* ===================================================================== */
{
  const dir = fixture('ac48-b6', 'a,b,c');
  const r = runJ(['set', '--id=EPIC-001', '--remove-tags=a', '--add-tags=a,d'], dir);
  T.exit('B6 --remove-tags=a --add-tags=a,d: exit 0', r, 0);
  T.eq('B6 tags end up b,c,a,d (a moved to the end, not left at the front)', r.json && r.json.entry && r.json.entry.tags, ['b', 'c', 'a', 'd']);
}

/* ===================================================================== */
/* B7 — a tag repeated within --add-tags itself is only ever added once  */
/* ===================================================================== */
{
  const dir = fixture('ac48-b7', 'a');
  const r = runJ(['set', '--id=EPIC-001', '--add-tags=b,b,c'], dir);
  T.exit('B7 --add-tags=b,b,c: exit 0', r, 0);
  T.eq('B7 tags end up a,b,c (b only once)', r.json && r.json.entry && r.json.entry.tags, ['a', 'b', 'c']);
}

/* ===================================================================== */
/* B8 — combined with `--tags=`: invalid_value, nothing written, in      */
/* every combination                                                      */
/* ===================================================================== */
{
  const dir = fixture('ac48-b8a', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--tags=x', '--add-tags=c'], dir);
  T.exit('B8 --tags= with --add-tags: exit 1', r, 1);
  T.eq('B8 invalid_value', r.json && r.json.error, 'invalid_value');
  const after = runJ(['show', '--id=EPIC-001'], dir);
  T.eq('B8 nothing written: tags still a,b', after.json && after.json.entries && after.json.entries[0] && after.json.entries[0].tags, ['a', 'b']);
}
{
  const dir = fixture('ac48-b8b', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--tags=x', '--remove-tags=a'], dir);
  T.exit('B8 --tags= with --remove-tags: exit 1', r, 1);
  T.eq('B8 invalid_value', r.json && r.json.error, 'invalid_value');
}
{
  const dir = fixture('ac48-b8c', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--tags=x', '--add-tags=c', '--remove-tags=a'], dir);
  T.exit('B8 --tags= with both: exit 1', r, 1);
  T.eq('B8 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* B9 — per-item validation, same as --tags: an item containing ']' is   */
/* invalid_value                                                          */
/* ===================================================================== */
{
  const dir = fixture('ac48-b9', 'a');
  const r = runJ(['set', '--id=EPIC-001', '--add-tags=bad]tag'], dir);
  T.exit('B9 --add-tags with a ] item: exit 1', r, 1);
  T.eq('B9 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* B10 — a fully no-op call (add present, remove absent): exit 0,        */
/* "tags" absent from changed, nothing rewritten                          */
/* ===================================================================== */
{
  const dir = fixture('ac48-b10', 'a,b');
  const r = runJ(['set', '--id=EPIC-001', '--add-tags=a', '--remove-tags=zzz'], dir);
  T.exit('B10 fully no-op add/remove: exit 0', r, 0);
  T.eq('B10 tags unchanged: a,b', r.json && r.json.entry && r.json.entry.tags, ['a', 'b']);
  T.check('B10 "tags" not reported in changed', !(r.json && r.json.changed || []).includes('tags'), J(r.json));
}

/* ===================================================================== */
/* B11 — batch: each ID's own current tags, changed independently        */
/* ===================================================================== */
{
  const dir = H.freshDir('ac48-b11');
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=a,b'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] x', '--tags=x'], dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] x', '--tags=y,z'], dir, { NJ_NOW: H.FIXED_NOW }), 'new TSK-002');
  const r = runJ(['set', '--id=EPIC-001,TSK-001,TSK-002', '--add-tags=shared', '--remove-tags=a,y'], dir);
  T.exit('B11 batch add/remove: exit 0', r, 0);
  const byId: Record<string, any> = {};
  for (const one of (r.json && r.json.results) || []) byId[one.id] = one;
  T.eq('B11 EPIC-001: a removed, shared appended -> b,shared', byId['EPIC-001'] && byId['EPIC-001'].entry && byId['EPIC-001'].entry.tags, ['b', 'shared']);
  T.eq('B11 TSK-001: no a/y to remove, shared appended -> x,shared', byId['TSK-001'] && byId['TSK-001'].entry && byId['TSK-001'].entry.tags, ['x', 'shared']);
  T.eq('B11 TSK-002: y removed, shared appended -> z,shared', byId['TSK-002'] && byId['TSK-002'].entry && byId['TSK-002'].entry.tags, ['z', 'shared']);
}

/* ===================================================================== */
/* B12 — `nj-mcp`'s `set` tool schema gains `add-tags` and `remove-tags`, */
/* and calling it actually changes the tags, same as the CLI              */
/* ===================================================================== */
(async () => {
  const dir = H.freshDir('ac48-b12');
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: H.FIXED_NOW };
  ok(H.runNj(['init', '--backlog=' + bl], { cwd: dir, env, unsetEnv: ['NJ_BACKLOG'] }), 'nj init');
  ok(H.runNj(['new', '--backlog=' + bl, '--type=epic', '--title=E', '--description=D.', '--tags=a,b'], { cwd: dir, env, unsetEnv: ['NJ_BACKLOG'] }), 'new epic');

  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + bl], { cwd: dir, env });
  try {
    const list = await s.modernToolsList();
    const setTool = ((list.result || {}).tools || []).find((t: any) => t.name === 'set');
    T.check('B12 set tool schema has an "add-tags" field',
      !!setTool && !!(setTool.inputSchema && setTool.inputSchema.properties && 'add-tags' in setTool.inputSchema.properties), J(setTool));
    T.check('B12 set tool schema has a "remove-tags" field',
      !!setTool && !!(setTool.inputSchema && setTool.inputSchema.properties && 'remove-tags' in setTool.inputSchema.properties), J(setTool));

    const r = await s.modernToolsCall('set', { id: 'EPIC-001', 'remove-tags': 'a', 'add-tags': 'c' });
    T.check('B12 tools/call: no protocol error', !r.error, J(r.error));
    const content = r.result && r.result.content && r.result.content[0] && JSON.parse(r.result.content[0].text);
    T.eq('B12 tools/call result tags: b,c (same remove-then-add rule as the CLI)',
      content && content.entry && content.entry.tags, ['b', 'c']);
  } finally {
    await s.close();
  }
  T.finish();
})();
