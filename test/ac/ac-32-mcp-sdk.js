'use strict';
/* AC-32…AC-37 conformance leg — drives `dist/nj-mcp` through the OFFICIAL
 * MCP SDK's client (`@modelcontextprotocol/sdk`, a devDependency used only
 * by tests, never shipped — DECISIONS 144, § 17, § 3).
 *
 * Why this file exists separately from `ac-32-mcp.js`: that suite's own
 * driver (`test/lib/mcp-stdio.js`) is hand-rolled, knowing only the exact
 * shapes `nj-mcp` is specified to answer — a real client exercises
 * `nj-mcp` against the actual protocol library's own request construction,
 * era-detection probing and response parsing, catching anything the
 * hand-rolled driver's own assumptions could paper over (§ 17, § F of the
 * proposal this promotes).
 *
 * The devDependency is not installed as of this commit (checked: `npm ls
 * @modelcontextprotocol/sdk` reports nothing under this project). Per the
 * task that wrote this file, adding it needs network/npm access this
 * session did not have standing authorization to use without asking, so
 * this leg reports CANNOT RUN — not a failure — until it is added, the
 * same "a missing prerequisite, not a defect" discipline
 * `hardening-njrc-foreign-link.js` already uses for the root-only gap. The
 * oracle as a whole must stay runnable offline, so this file's absence
 * must never turn the rest of the suite red.
 */
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();
H.requireNjMcp();

function cannotRun(reason) {
  console.log('FAIL ' + path.basename(__filename) + ' — CANNOT RUN');
  console.log('  ' + reason);
  console.log('  Not a defect: @modelcontextprotocol/sdk is a devDependency used only');
  console.log('  by this file (§ 17, DECISIONS 144) and is not installed in this tree.');
  console.log('  `npm install --save-dev @modelcontextprotocol/sdk` (needs network) to cover it.');
  process.exit(1);
}

let Client, StdioClientTransport;
try {
  ({ Client } = require('@modelcontextprotocol/sdk/client/index.js'));
  ({ StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js'));
} catch (e) {
  cannotRun('require(\'@modelcontextprotocol/sdk\') failed: ' + e.message);
}

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

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

/** A fresh SDK client, connected over stdio to a freshly spawned `nj-mcp`. */
async function connect(x, extraArgs) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [H.NJ_MCP, '--backlog=' + x.bl].concat(extraArgs || []),
    cwd: x.dir,
    env: Object.assign({}, process.env, { NJ_NOW: NOW }),
  });
  const client = new Client({ name: 'nj-oracle-sdk-conformance', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

(async () => {
  /* C1 — the real client's own dual-era probing succeeds against nj-mcp:
   * connect() itself performs the handshake (server/discover or
   * initialize, whichever the client's own era-detection chooses), so a
   * clean connect is already the first assertion. */
  {
    const x = model('mcp-sdk-c1');
    let client = null;
    try {
      client = await connect(x);
      T.check('C1 the real SDK client connects to nj-mcp (handshake succeeds)', true, '');
    } catch (e) {
      T.check('C1 the real SDK client connects to nj-mcp (handshake succeeds)', false, e.message);
    } finally {
      if (client) { try { await client.close(); } catch (e) { /* best effort */ } }
    }
  }

  /* C2 — tools/list through the real client matches the hand-rolled       */
  /* driver's own expectation: the exact tool set, no backlog field.      */
  {
    const x = model('mcp-sdk-c2');
    const client = await connect(x);
    try {
      const { tools } = await client.listTools();
      const names = (tools || []).map(t => t.name).sort();
      T.eq('C2 tools/list via the real SDK client: exact set, rm absent',
        names, ['archive', 'check', 'claim', 'doctor', 'find', 'list', 'log', 'new',
          'next', 'note', 'release', 'set', 'show', 'tree', 'unarchive'].sort());
      T.check('C2 no tool schema names a "backlog" field',
        (tools || []).every(t => !(t.inputSchema && t.inputSchema.properties && 'backlog' in t.inputSchema.properties)),
        J(tools));
    } finally {
      await client.close();
    }
  }

  /* C3 — a real tools/call through the SDK client gets exactly `dist/nj   */
  /* --json`'s own output as structuredContent.                            */
  {
    const x = model('mcp-sdk-c3');
    const cli = H.runJson(['show', '--id=TSK-001'], { cwd: x.dir, env: { NJ_NOW: NOW } });
    const client = await connect(x);
    try {
      const res = await client.callTool({ name: 'show', arguments: { id: 'TSK-001' } });
      T.check('C3 tools/call via the real SDK client: no isError', !res.isError, J(res));
      T.eq('C3 structuredContent is byte-identical to `dist/nj --json`', res.structuredContent, cli.json);
    } finally {
      await client.close();
    }
  }

  /* C4 — a failure surfaces as isError, with the unmodified body, through  */
  /* the real client too (not just the hand-rolled driver's own parsing).  */
  {
    const x = model('mcp-sdk-c4');
    const cli = H.runJson(['show', '--id=TSK-999'], { cwd: x.dir, env: { NJ_NOW: NOW } });
    const client = await connect(x);
    try {
      const res = await client.callTool({ name: 'show', arguments: { id: 'TSK-999' } });
      T.check('C4 a CLI-level failure: isError true via the real SDK client', res.isError === true, J(res));
      T.eq('C4 content is the unmodified {ok:false, error, hint?} body', res.structuredContent, cli.json);
    } finally {
      await client.close();
    }
  }

  T.finish();
})().catch(e => {
  console.log('FAIL ' + path.basename(__filename) + ' — uncaught: ' + (e && e.stack || e));
  process.exit(1);
});
