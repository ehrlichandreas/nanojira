/* AC-32…AC-37 — `nj-mcp`, docs/SPECIFICATION.md § 17 "MCP Interface"
 * (v3.3 proposal, promoted: DECISIONS 122/143/144/145/146, commit 05485ae;
 * `next` and `log` added to the tool surface in v3.5, DECISIONS 154/155,
 * commits 1406a40/<pending> — AC-32's own text amended, so TOOLS below
 * includes both. Their own MCP legs live in ac/ac-40-next.ts and
 * ac/ac-41-log.ts, not here.)
 *
 * Hand-rolled stdio driver (test/lib/mcp-stdio.ts), both eras. Covers
 * framing/ids, -32601/-32602/-32022, tools/list (exact set, the
 * doctor --fix / --allow-destructive gate, no backlog field in any
 * schema), tools/call result fidelity against `dist/nj --json`, isError
 * with the unmodified body, per-call `as` validation (D119), explicit
 * --backlog confinement, concurrent pipelined calls, cancellation, and
 * an invalid NJ_NOW refused per call, not at startup (D207, TSK-018).
 *
 * AC-32: tools/list names exactly list/show/find/tree/new/set/note/
 * check/claim/release/next/log/archive/unarchive/doctor; rm never
 * present; doctor --fix present only with --allow-destructive.
 * AC-33: tools/call content is byte-identical to `dist/nj --json`.
 * AC-34: backlog resolved once at startup, every spawned child gets
 * --backlog explicitly, no schema names a backlog field.
 * AC-35: batch (`id` as a comma string) and `as` (D119-validated,
 * outranks NJ_AUTHOR) parity with the CLI.
 * AC-37: server/discover's DiscoverResult, initialize's response,
 * UnsupportedProtocolVersionError (-32022), -32602 vs isError, -32601.
 *
 * Written before `nj-mcp` exists: CANNOT RUN until it does (the oracle
 * is built first, same discipline every other suite here has).
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import * as MCP from '../lib/mcp-stdio.ts';
import type { RunResult } from '../lib/harness.ts';
import type { McpServerDriver } from '../lib/mcp-stdio.ts';
const T = H.T;

H.requireNj();
H.requireNjMcp();

const NOW = H.FIXED_NOW;
function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

const TOOLS = ['list', 'show', 'find', 'tree', 'new', 'set', 'note', 'check',
  'claim', 'release', 'next', 'log', 'archive', 'unarchive', 'doctor'];

/* For a WRITE comparison, the CLI side and the MCP side must be two
 * independent fixtures (a write can't be applied once and then "read"
 * through both paths without one call seeing the other's effect) — but
 * each fixture's own `H.freshDir` root is a distinct mkdtemp path, and
 * that root appears verbatim inside any absolute path field the result
 * carries (`entry.file`, `backlog`, …). Comparing the raw JSON would
 * therefore fail on the fixture roots alone, even when every byte that
 * actually matters is identical. This replaces each fixture's own root
 * with one fixed placeholder before comparing — the ONLY normalisation
 * applied; everything else in the JSON, including the relative tail of
 * every path, is still compared byte for byte. (Reads don't need this:
 * the same fixture can serve both the CLI call and the MCP call, so the
 * root is identical on both sides already — see M6's `list` case below.) */
function normalizeRoot(value: unknown, root: string) {
  return JSON.parse(JSON.stringify(value).split(root).join('<FIXTURE-ROOT>'));
}

function ok(r: RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

interface Model {
  dir: string;
  bl: string;
}

/* A real backlog, built via the CLI (not by hand): EPIC-001/TSK-001,
 * complete, so writes have something uncontroversial to act on. */
function model(label: string): Model {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: NOW };
  ok(H.runNj(['init'], { cwd: dir, env }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic', '--description=D.'], { cwd: dir, env }), 'new epic');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Task',
    '--description=D.', '--acceptance=- [ ] x'], { cwd: dir, env }), 'new task');
  return { dir, bl };
}

function spawnMcp(x: Model, args: string[], env?: Record<string, string | undefined>) {
  return MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + x.bl].concat(args || []),
    { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}

async function withServer(x: Model, args: string[], env: Record<string, string | undefined> | undefined, fn: (s: McpServerDriver) => Promise<void>) {
  const s = spawnMcp(x, args, env);
  try { await fn(s); } finally { await s.close(); }
}

(async () => {

/* ===================================================================== */
/* M1 — dual-era handshake: server/discover and initialize                */
/* ===================================================================== */
await withServer(model('mcp-m1a'), [], {}, async s => {
  const r = await s.discover();
  T.check('M1 server/discover: no top-level error', !r.error, J(r.error));
  const res = r.result || {};
  T.eq('M1 discover: supportedVersions names both pinned revisions',
    (res.supportedVersions || []).slice().sort(), ['2025-11-25', '2026-07-28']);
  T.eq('M1 discover: capabilities is exactly {tools: {}}', res.capabilities, { tools: {} });
  T.check('M1 discover: resultType is "complete"', res.resultType === 'complete', J(res.resultType));
});
await withServer(model('mcp-m1b'), [], {}, async s => {
  const r = await s.initialize();
  T.check('M1 initialize: no top-level error', !r.error, J(r.error));
  const res = r.result || {};
  T.eq('M1 initialize: declares the legacy revision 2025-11-25', res.protocolVersion, '2025-11-25');
  T.eq('M1 initialize: capabilities is exactly {tools: {}}', res.capabilities, { tools: {} });
});

/* ===================================================================== */
/* M2 — framing and id correlation                                       */
/* ===================================================================== */
await withServer(model('mcp-m2'), [], {}, async s => {
  const r1 = await s.request('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }, { id: 'alpha' });
  T.eq('M2 a request with a string id gets a response carrying the same id', r1.id, 'alpha');
  const r2 = await s.request('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }, { id: 42 });
  T.eq('M2 a request with a numeric id gets a response carrying the same id', r2.id, 42);
});

/* ===================================================================== */
/* M3 — unknown method, in either era: -32601                            */
/* ===================================================================== */
await withServer(model('mcp-m3'), [], {}, async s => {
  const r = await s.request('resources/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
  T.check('M3 unknown method (modern): -32601', r.error && r.error.code === -32601, J(r.error));
  const r2 = await s.request('prompts/list', {});
  T.check('M3 unknown method (legacy-shaped, no _meta): -32601', r2.error && r2.error.code === -32601, J(r2.error));
});

/* ===================================================================== */
/* M4 — malformed tools/call arguments: -32602, before any child spawns  */
/* ===================================================================== */
{
  const x = model('mcp-m4');
  await withServer(x, [], {}, async s => {
    const before = H.readOrNull(path.join(x.bl, 'tasks', 'TSK-001.md'));
    const r = await s.modernToolsCall('set', { id: 123, priority: 'high' }); // id must be a string
    T.check('M4 wrong-typed required argument: -32602', r.error && r.error.code === -32602, J(r.error));
    T.eq('M4 no dist/nj child was ever spawned: the file is untouched',
      H.readOrNull(path.join(x.bl, 'tasks', 'TSK-001.md')), before);
  });
}

/* ===================================================================== */
/* M5 — tools/list: exact set, the --allow-destructive gate, no backlog  */
/* field in any schema                                                    */
/* ===================================================================== */
{
  const x = model('mcp-m5a');
  await withServer(x, [], {}, async s => {
    const r = await s.modernToolsList();
    const names = ((r.result || {}).tools || []).map((t: any) => t.name).sort();
    T.eq('M5 tools/list (no flag): exact set, rm absent, doctor --fix not separately listed',
      names, TOOLS.slice().sort());
    T.check('M5 no tool schema names a "backlog" field',
      ((r.result || {}).tools || []).every((t: any) => !(t.inputSchema && t.inputSchema.properties && 'backlog' in t.inputSchema.properties)),
      J((r.result || {}).tools));
    const doctorTool = ((r.result || {}).tools || []).find((t: any) => t.name === 'doctor');
    T.check('M5 doctor tool\'s schema has no "fix" field without --allow-destructive',
      !!doctorTool && !(doctorTool.inputSchema && doctorTool.inputSchema.properties && 'fix' in doctorTool.inputSchema.properties),
      J(doctorTool));
  });
}
{
  const x = model('mcp-m5b');
  await withServer(x, ['--allow-destructive'], {}, async s => {
    const r = await s.modernToolsList();
    const doctorTool = ((r.result || {}).tools || []).find((t: any) => t.name === 'doctor');
    T.check('M5 with --allow-destructive: doctor tool\'s schema HAS a "fix" field',
      !!doctorTool && !!(doctorTool.inputSchema && doctorTool.inputSchema.properties && 'fix' in doctorTool.inputSchema.properties),
      J(doctorTool));
    const names = ((r.result || {}).tools || []).map((t: any) => t.name);
    T.check('M5 with --allow-destructive: rm is still never present', !names.includes('rm'), J(names));
  });
}

/* ===================================================================== */
/* M6 — tools/call result fidelity against `dist/nj --json`               */
/* ===================================================================== */
{
  /* Two INDEPENDENT fixtures — a write, so each side gets its own copy to
   * apply its own write to; only each fixture's own root path is
   * normalized before comparing (see normalizeRoot above). */
  const x = model('mcp-m6');
  const cli = H.runJson(['set', '--id=TSK-001', '--priority=high'], { cwd: x.dir, env: { NJ_NOW: NOW } });
  const y = model('mcp-m6'); // identically built, independent fixture for the MCP side
  await withServer(y, [], {}, async s => {
    const mcpR = await s.modernToolsCall('set', { id: 'TSK-001', priority: 'high' });
    T.check('M6 set via MCP: no protocol-level error', !mcpR.error, J(mcpR.error));
    const content = mcpR.result && mcpR.result.structuredContent;
    T.eq('M6 set: MCP structuredContent is byte-identical to `dist/nj --json` (fixture roots normalized)',
      normalizeRoot(content, y.dir), normalizeRoot(cli.json, x.dir));
  });
}
{
  /* A READ: the same ONE fixture serves both calls, so its root path is
   * identical on both sides already — no normalization needed, and the
   * comparison is genuinely over every byte, fixture root included. */
  const x = model('mcp-m6-list');
  const cli = H.runJson(['list'], { cwd: x.dir, env: { NJ_NOW: NOW } });
  await withServer(x, [], {}, async s => {
    const mcpR = await s.modernToolsCall('list', {});
    const content = mcpR.result && mcpR.result.structuredContent;
    T.eq('M6 list: MCP structuredContent is byte-identical to `dist/nj --json`', content, cli.json);
  });
}

/* ===================================================================== */
/* M7 — isError with the unmodified {ok:false, error, hint?} body         */
/* ===================================================================== */
{
  /* Two independent fixtures, same as M6's write case — but safe without
   * normalizeRoot: a failure body is {ok:false, error, hint?} only (§ 9's
   * generic single-write failure shape), never an `entry`/`file` field,
   * so no fixture-root path ever appears in either side to begin with. */
  const x = model('mcp-m7');
  const cli = H.runJson(['set', '--id=TSK-999', '--priority=high'], { cwd: x.dir, env: { NJ_NOW: NOW } });
  const y = model('mcp-m7');
  await withServer(y, [], {}, async s => {
    const r = await s.modernToolsCall('set', { id: 'TSK-999', priority: 'high' });
    T.check('M7 a schema-valid call the CLI rejects: no protocol-level error', !r.error, J(r.error));
    T.check('M7 isError is true', r.result && r.result.isError === true, J(r.result));
    T.eq('M7 content is the unmodified {ok:false, error, hint?} body', r.result && r.result.structuredContent, cli.json);
  });
}

/* ===================================================================== */
/* M8 — the acting name: `as`, D119-validated, outranks NJ_AUTHOR         */
/* ===================================================================== */
{
  const x = model('mcp-m8');
  await withServer(x, [], { NJ_AUTHOR: 'server-default' }, async s => {
    const r = await s.modernToolsCall('note', { id: 'TSK-001', text: 'hello', as: 'alice' });
    T.check('M8 note with as=alice: exit ok', r.result && r.result.structuredContent && r.result.structuredContent.ok === true, J(r.result));
    const body = H.readOrNull(path.join(x.bl, 'tasks', 'TSK-001.md')) || '';
    T.check('M8 the note is signed alice, not the server default NJ_AUTHOR', /alice: hello/.test(body), body);
  });
}
{
  const x = model('mcp-m8-invalid');
  await withServer(x, [], {}, async s => {
    const r = await s.modernToolsCall('note', { id: 'TSK-001', text: 'hello', as: 'bad:name' });
    T.check('M8 an invalid as (contains ":", D119): isError true', r.result && r.result.isError === true, J(r.result));
    T.eq('M8 invalid as: invalid_value', r.result && r.result.structuredContent && r.result.structuredContent.error, 'invalid_value');
  });
}

/* ===================================================================== */
/* M9 — explicit --backlog confinement: a child never re-resolves from    */
/* its own cwd/.njrc, even when that search would find a DIFFERENT       */
/* backlog                                                                */
/* ===================================================================== */
{
  const a = model('mcp-m9-a');
  const bOuter = H.freshDir('mcp-m9-b');
  const bProj = path.join(bOuter, 'proj');
  fs.mkdirSync(bProj, { recursive: true });
  ok(H.runNj(['init', '--backlog=' + path.join(bOuter, 'backlog-b')], { cwd: bOuter, env: { NJ_NOW: NOW } }), 'init backlog B');
  fs.writeFileSync(path.join(bProj, '.njrc'), 'backlog = ' + path.join(bOuter, 'backlog-b') + '\n');
  /* nj-mcp's OWN cwd is bProj — if it (or any child it spawns) ever
   * re-ran § 4's search instead of using the explicit --backlog it
   * resolved at startup, it would land on backlog B, not A. */
  await withServer({ dir: bProj, bl: a.bl }, [], {}, async s => {
    const r = await s.modernToolsCall('list', {});
    const entries = (r.result && r.result.structuredContent && r.result.structuredContent.entries) || [];
    T.check('M9 confinement: list reads backlog A (its own resolved backlog), not B (cwd\'s .njrc)',
      entries.some((e: any) => e.id === 'TSK-001'), J(entries));
  });
}

/* ===================================================================== */
/* M10 — concurrent, pipelined calls correlate correctly                  */
/* ===================================================================== */
{
  const x = model('mcp-m10');
  await withServer(x, [], {}, async s => {
    const calls = [
      s.modernToolsCall('show', { id: 'TSK-001' }, { id: 'c1' }),
      s.modernToolsCall('show', { id: 'EPIC-001' }, { id: 'c2' }),
      s.modernToolsList({ id: 'c3' }),
    ];
    const [r1, r2, r3] = await Promise.all(calls);
    T.eq('M10 pipelined call 1 resolves with its own id', r1.id, 'c1');
    T.eq('M10 pipelined call 2 resolves with its own id', r2.id, 'c2');
    T.eq('M10 pipelined call 3 resolves with its own id', r3.id, 'c3');
    const e1 = (r1.result && r1.result.structuredContent && r1.result.structuredContent.entries) || [];
    T.check('M10 call 1 answers about TSK-001', e1.some((e: any) => e.id === 'TSK-001'), J(e1));
    const e2 = (r2.result && r2.result.structuredContent && r2.result.structuredContent.entries) || [];
    T.check('M10 call 2 answers about EPIC-001, not mixed up with call 1', e2.some((e: any) => e.id === 'EPIC-001'), J(e2));
  });
}

/* ===================================================================== */
/* M11 — cancellation: accepted, a no-op, no crash, the call still        */
/* completes and is answered (§ 17: SHOULD, not MUST, suppress it)        */
/* ===================================================================== */
{
  const x = model('mcp-m11');
  await withServer(x, [], {}, async s => {
    const pending = s.modernToolsCall('list', {}, { id: 'cancel-me' });
    s.notify('notifications/cancelled', { requestId: 'cancel-me' });
    const r = await pending;
    T.check('M11 a cancelled call still completes and is answered', !!r.result, J(r));
    T.check('M11 no crash: stderr carries no stack frame', !/^\s*at .*:\d+:\d+\)?$/m.test(s.stderr()), s.stderr());
  });
}

/* ===================================================================== */
/* M12 — nj-mcp.mjs looks for its sibling nj.mjs unconditionally          */
/* (DECISIONS 185 addendum 9b3d0de, replacing D179's extension-matching   */
/* rule now that the bundle is ESM-only, one fixed extension): present,   */
/* a tool call works; missing, the one call that needed it fails fast     */
/* and cleanly (§ 17 "A missing sibling") — never a hang, never a crash   */
/* of the server itself. A fixture that makes the server die outright     */
/* (e.g. a bad copy) must still fail this test cleanly, not hang until    */
/* mcp-stdio.ts's internal timeout and crash the whole suite with an      */
/* unhandled rejection — ac-56's own W5/W6 note the same class of risk;   */
/* this is why mcp-stdio.ts's request() now rejects every pending call    */
/* promptly when the child process exits, instead of waiting out a fixed */
/* timeout no matter what.                                                */
/* ===================================================================== */
function spawnMcpAt(njMcpPath: string, x: Model, args: string[], env?: Record<string, string | undefined>) {
  return MCP.spawnServer(njMcpPath, ['--backlog=' + x.bl].concat(args || []),
    { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}
async function withServerAt(njMcpPath: string, x: Model, args: string[], env: Record<string, string | undefined> | undefined, fn: (s: McpServerDriver) => Promise<void>) {
  const s = spawnMcpAt(njMcpPath, x, args, env);
  try { await fn(s); } finally { await s.close(); }
}
{
  /* M12a — both siblings present, the shipped unit copied together (§ 18:
   * the whole SKILL.md+bin/+dist/ tree for a bin/ launcher, just the two
   * .mjs files for a bare dist/*.mjs — H.copyShippedUnit picks whichever
   * matches what's under test): a tool call works exactly as it does
   * against the repo's own dist/. */
  const bin = H.freshDir('mcp-m12a-bin');
  const unit = H.copyShippedUnit(bin);
  const x = model('mcp-m12a');
  await withServerAt(unit.njMcp, x, [], {}, async s => {
    let r;
    try {
      r = await s.modernToolsCall('doctor', {});
    } catch (e) {
      T.check('M12a nj.mjs + nj-mcp.mjs copied together: tools/call doctor did not fail/hang', false, String(e && (e as Error).message) + ' stderr=' + s.stderr());
      return;
    }
    T.check('M12a nj.mjs + nj-mcp.mjs copied together: no protocol error',
      !r.error, J(r.error));
    T.check('M12a nj.mjs + nj-mcp.mjs copied together: doctor returns a result',
      !!(r.result && r.result.structuredContent), J(r.result));
  });
}
{
  /* M12b — the shipped unit copied WITHOUT nj-mcp's nj.mjs sibling
   * module (only that module removed — the launcher itself, in bin/
   * mode, is left in place): the server process itself starts and stays
   * up (it needs no sibling to answer server/discover or to parse a
   * request — only a tool call that actually spawns nj needs one); the
   * tools/call this leg makes must fail fast as a clean JSON-RPC
   * protocol error (§ 17), never hang and never crash nj-mcp itself —
   * confirmed separately by a second, unrelated call succeeding
   * afterward in the SAME session. */
  const bin = H.freshDir('mcp-m12b-bin');
  const unit = H.copyShippedUnit(bin);
  fs.rmSync(unit.njModule, { force: true });
  T.check('fixture: M12b has no nj.mjs sibling module', !fs.existsSync(unit.njModule), unit.njModule);
  const x = model('mcp-m12b');
  await withServerAt(unit.njMcp, x, [], {}, async s => {
    let r;
    try {
      /* The harness's own 15 s default, not a tighter 5 s: the window also
       * covers nanojira-mcp's cold boot, which a loaded machine (run-all's
       * parallel pool, DECISIONS 199) can stretch past 5 s. A real hang
       * still trips it. */
      r = await s.modernToolsCall('doctor', {}, { timeout: 15000 });
    } catch (e) {
      T.check('M12b missing nj.mjs sibling: tools/call fails cleanly, not a hang/crash', false, String(e && (e as Error).message) + ' stderr=' + s.stderr());
      return;
    }
    T.check('M12b missing nj.mjs sibling: a protocol-level error (not a tool-content isError), naming the missing module',
      !!r.error && /nj\.mjs|cannot find module/i.test(JSON.stringify(r.error)), J(r.error));
    T.check('M12b missing nj.mjs sibling: the server process is still alive (only the call failed, not the server)',
      !s.child.killed && s.child.exitCode === null, 'exitCode=' + s.child.exitCode);

    /* The same session still answers an unrelated call normally. */
    const r2 = await s.modernToolsList({});
    T.check('M12b after the failed call, tools/list in the SAME session still answers normally', !r2.error && Array.isArray(r2.result && r2.result.tools), J(r2));
  });
}

/* ===================================================================== */
/* M13 — an invalid NJ_NOW: refused per call, never at startup            */
/* (DECISIONS 207, TSK-018). nanojira-mcp itself never reads NJ_NOW; it   */
/* passes its environment to every child, whose dispatch refuses it       */
/* (§ 12). So the server starts and answers the handshake and tools/list, */
/* and each tool call, a read and a write, is an isError `invalid_env`    */
/* with nothing written -- .nanojira/ids included: a late, lazy check     */
/* would let `new` burn its id before refusing (D207).                    */
/* ===================================================================== */
function snapshotBacklog(bl: string): string[] {
  const out: string[] = [];
  (function walk(abs: string, rel: string) {
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) {
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    out.push(rel + ' ' + H.sha256(fs.readFileSync(abs)));
  })(bl, '.');
  return out;
}
{
  const x = model('mcp-m13');
  const before = snapshotBacklog(x.bl);
  await withServer(x, [], { NJ_NOW: 'bogus' }, async s => {
    /* A server that refused at startup would reject the first request
     * (mcp-stdio.ts rejects pending calls once the child exits): one clean
     * failing check, not an unhandled rejection (M12's note). */
    try {
      const init = await s.initialize();
      T.check('M13 bogus NJ_NOW: the server starts, initialize answers', !init.error && !!init.result, J(init));
    } catch (e) {
      T.check('M13 bogus NJ_NOW: the server starts, initialize answers', false, String(e && (e as Error).message) + ' stderr=' + s.stderr());
      return;
    }
    const list = await s.legacyToolsList();
    T.eq('M13 bogus NJ_NOW: tools/list answers the full set',
      ((list.result || {}).tools || []).map((t: any) => t.name).sort(), TOOLS.slice().sort());
    const calls: [string, Record<string, unknown>][] = [
      ['list', {}],
      ['new', { type: 'task', parent: 'EPIC-001', title: 'Probe' }],
    ];
    for (const [name, args] of calls) {
      const r = await s.legacyToolsCall(name, args);
      const body = r.result && r.result.structuredContent;
      T.check('M13 bogus NJ_NOW: tools/call ' + name + ' is a tool error, not a protocol error',
        !r.error && r.result && r.result.isError === true, J(r));
      T.check('M13 bogus NJ_NOW: tools/call ' + name + ' carries the CLI\'s invalid_env',
        !!body && body.ok === false && body.error === 'invalid_env', J(body));
      /* DECISIONS 212 (TSK-025): the server drops the child's stderr once
       * stdout parses, so the body's hint is the only place an MCP client
       * learns which variable is wrong. */
      T.check('M13 bogus NJ_NOW: tools/call ' + name + ' carries a hint naming NJ_NOW',
        !!body && typeof body.hint === 'string' && /\bNJ_NOW\b/.test(body.hint), J(body));
    }
  });
  T.eq('M13 bogus NJ_NOW: the backlog is byte-identical, .nanojira/ids included', snapshotBacklog(x.bl), before);
}

T.finish();
})();
