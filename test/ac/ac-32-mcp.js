'use strict';
/* AC-32…AC-37 — `nj-mcp`, docs/SPECIFICATION.md § 17 "MCP Interface"
 * (v3.3 proposal, promoted: DECISIONS 122/143/144/145/146, commit 05485ae;
 * `next` and `log` added to the tool surface in v3.5, DECISIONS 154/155,
 * commits 1406a40/<pending> — AC-32's own text amended, so TOOLS below
 * includes both. Their own MCP legs live in ac/ac-40-next.js and
 * ac/ac-41-log.js, not here.)
 *
 * Hand-rolled stdio driver (test/lib/mcp-stdio.js), both eras. Covers
 * framing/ids, -32601/-32602/-32022, tools/list (exact set, the
 * doctor --fix / --allow-destructive gate, no backlog field in any
 * schema), tools/call result fidelity against `dist/nj --json`, isError
 * with the unmodified body, per-call `as` validation (D119), explicit
 * --backlog confinement, concurrent pipelined calls, and cancellation.
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
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const MCP = require('../lib/mcp-stdio.js');
const T = H.T;

H.requireNj();
H.requireNjMcp();

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

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
function normalizeRoot(value, root) {
  return JSON.parse(JSON.stringify(value).split(root).join('<FIXTURE-ROOT>'));
}

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* A real backlog, built via the CLI (not by hand): EPIC-001/TSK-001,
 * complete, so writes have something uncontroversial to act on. */
function model(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: NOW };
  ok(H.runNj(['init'], { cwd: dir, env }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic', '--description=D.'], { cwd: dir, env }), 'new epic');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Task',
    '--description=D.', '--acceptance=- [ ] x'], { cwd: dir, env }), 'new task');
  return { dir, bl };
}

function spawnMcp(x, args, env) {
  return MCP.spawnServer(H.NJ_MCP, ['--backlog=' + x.bl].concat(args || []),
    { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}

async function withServer(x, args, env, fn) {
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
    const names = ((r.result || {}).tools || []).map(t => t.name).sort();
    T.eq('M5 tools/list (no flag): exact set, rm absent, doctor --fix not separately listed',
      names, TOOLS.slice().sort());
    T.check('M5 no tool schema names a "backlog" field',
      ((r.result || {}).tools || []).every(t => !(t.inputSchema && t.inputSchema.properties && 'backlog' in t.inputSchema.properties)),
      J((r.result || {}).tools));
    const doctorTool = ((r.result || {}).tools || []).find(t => t.name === 'doctor');
    T.check('M5 doctor tool\'s schema has no "fix" field without --allow-destructive',
      !!doctorTool && !(doctorTool.inputSchema && doctorTool.inputSchema.properties && 'fix' in doctorTool.inputSchema.properties),
      J(doctorTool));
  });
}
{
  const x = model('mcp-m5b');
  await withServer(x, ['--allow-destructive'], {}, async s => {
    const r = await s.modernToolsList();
    const doctorTool = ((r.result || {}).tools || []).find(t => t.name === 'doctor');
    T.check('M5 with --allow-destructive: doctor tool\'s schema HAS a "fix" field',
      !!doctorTool && !!(doctorTool.inputSchema && doctorTool.inputSchema.properties && 'fix' in doctorTool.inputSchema.properties),
      J(doctorTool));
    const names = ((r.result || {}).tools || []).map(t => t.name);
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
      entries.some(e => e.id === 'TSK-001'), J(entries));
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
    T.check('M10 call 1 answers about TSK-001', e1.some(e => e.id === 'TSK-001'), J(e1));
    const e2 = (r2.result && r2.result.structuredContent && r2.result.structuredContent.entries) || [];
    T.check('M10 call 2 answers about EPIC-001, not mixed up with call 1', e2.some(e => e.id === 'EPIC-001'), J(e2));
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
/* M12 — nj-mcp finds its sibling `nj` by its OWN extension (DECISIONS   */
/* 179): as `nj-mcp` (no extension) it spawns `nj`; as `nj-mcp.cjs` it   */
/* must spawn `nj.cjs`, not a same-named sh wrapper next to it — `node`  */
/* cannot parse a shell script, so the call would otherwise fail.        */
/* ===================================================================== */
function spawnMcpAt(njMcpPath, x, args, env) {
  return MCP.spawnServer(njMcpPath, ['--backlog=' + x.bl].concat(args || []),
    { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}
async function withServerAt(njMcpPath, x, args, env, fn) {
  const s = spawnMcpAt(njMcpPath, x, args, env);
  try { await fn(s); } finally { await s.close(); }
}
function copyExec(src, dest) {
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
}
{
  /* M12a — baseline, unchanged layout: dist/nj-mcp next to dist/nj (both
   * extensionless). Already green; a control for M12b. */
  const bin = H.freshDir('mcp-m12a-bin');
  copyExec(H.NJ, path.join(bin, 'nj'));
  copyExec(H.NJ_MCP, path.join(bin, 'nj-mcp'));
  const x = model('mcp-m12a');
  await withServerAt(path.join(bin, 'nj-mcp'), x, [], {}, async s => {
    const r = await s.modernToolsCall('doctor', {});
    T.check('M12a extensionless nj-mcp next to extensionless nj: no protocol error',
      !r.error, J(r.error));
    T.check('M12a extensionless nj-mcp next to extensionless nj: doctor returns a result',
      !!(r.result && r.result.structuredContent), J(r.result));
  });
}
{
  /* M12b — a release per D179: nj-mcp.cjs next to nj.cjs AND a same-named
   * sh wrapper `nj` (not `nj.cjs`) that a careless sibling lookup would
   * hit instead. nj-mcp must notice its own `.cjs` extension and spawn
   * `nj.cjs`, never the wrapper. */
  const bin = H.freshDir('mcp-m12b-bin');
  copyExec(H.NJ, path.join(bin, 'nj.cjs'));
  copyExec(H.NJ_MCP, path.join(bin, 'nj-mcp.cjs'));
  fs.writeFileSync(path.join(bin, 'nj'),
    '#!/bin/sh\nexec node "$(dirname "$0")/nj.cjs" "$@"\n');
  fs.chmodSync(path.join(bin, 'nj'), 0o755);
  const x = model('mcp-m12b');
  await withServerAt(path.join(bin, 'nj-mcp.cjs'), x, [], {}, async s => {
    const r = await s.modernToolsCall('doctor', {});
    T.check('M12b nj-mcp.cjs spawns nj.cjs (its own extension), not the sh wrapper `nj`: no protocol error',
      !r.error, J(r.error));
    T.check('M12b nj-mcp.cjs spawns nj.cjs (its own extension), not the sh wrapper `nj`: doctor returns a result',
      !!(r.result && r.result.structuredContent), J(r.result) + ' stderr=' + s.stderr());
  });
}

T.finish();
})();
