/*
 * A minimal, hand-rolled JSON-RPC-over-stdio driver for `dist/nanojira-mcp`
 * (§ 17 "MCP Interface"), built the same way the rest of this oracle is:
 * black box, zero dependencies, newline-delimited JSON framing per the MCP
 * stdio transport (no embedded newlines; stdout carries protocol frames
 * only, stderr is free for logging — § 17).
 *
 * This is NOT a general MCP client: it knows exactly the shapes `nanojira-mcp`
 * is specified to answer (modern per-request `_meta`, or the legacy
 * `initialize` handshake), nothing more. The conformance leg
 * (`ac-32-mcp-sdk.ts`) drives the same server through the *real* MCP SDK
 * client instead, to catch anything a hand-rolled driver's own
 * assumptions could paper over.
 */
import { spawn } from 'child_process';
import { njCommand } from './harness.ts';

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-11-25';

export interface SpawnServerOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface RequestOpts {
  id?: number | string;
  timeout?: number;
}

export interface ExitInfo {
  status: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
}

// deliberately `any`: JSON-RPC message payloads vary by method (the whole
// point of this driver is to send/receive whatever shape a given MCP
// method uses), so modelling them precisely here would just re-describe
// the MCP spec without adding safety the black-box tests rely on.
export type RpcMessage = any;

export interface McpServerDriver {
  child: ReturnType<typeof spawn>;
  request(method: string, params?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage>;
  notify(method: string, params?: Record<string, unknown>): void;
  rawSend(obj: unknown): void;
  close(): Promise<ExitInfo | null>;
  discover(ropts?: RequestOpts): Promise<RpcMessage>;
  modernToolsList(ropts?: RequestOpts): Promise<RpcMessage>;
  modernToolsCall(name: string, args?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage>;
  initialize(ropts?: RequestOpts): Promise<RpcMessage>;
  legacyToolsList(ropts?: RequestOpts): Promise<RpcMessage>;
  legacyToolsCall(name: string, args?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage>;
  stderr(): string;
  unsolicited(): RpcMessage[];
}

/**
 * Spawn `dist/nanojira-mcp` (or whatever `njMcpPath` names) and return a driver:
 *   - request(method, params, opts) -> Promise<message>  (resolves on a
 *     response carrying the matching id — an error response resolves too,
 *     with `.error` set; this driver never throws on a JSON-RPC error,
 *     the same "it's data, not an exception" discipline the rest of the
 *     harness already has for a CLI's non-zero exit)
 *   - notify(method, params) -> void (no id, no response expected)
 *   - rawSend(obj) -> void (for malformed-envelope tests)
 *   - stderr() -> string accumulated so far
 *   - close() -> {status, signal} once the process has exited
 *   - child -> the underlying ChildProcess, for liveness checks
 */
function spawnServer(njMcpPath: string, args?: string[], opts?: SpawnServerOpts): McpServerDriver {
  const o = opts || {};
  const env = Object.assign({}, process.env, o.env || {});
  /* `njMcpPath` may be `dist/nanojira-mcp.mjs` (run via node, so NJ_NODE still
   * picks which one) or `bin/nanojira-mcp` (a POSIX sh launcher, run directly --
   * § 18, DECISIONS 187; the same dispatch runNj itself uses). */
  const inv = njCommand(njMcpPath, args || []);
  const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });

  let buf = '';
  let errBuf = '';
  let nextId = 1;
  const pending = new Map<number | string, { resolve: (m: RpcMessage) => void; reject: (e: Error) => void }>();
  const unsolicited: RpcMessage[] = [];

  /* Decoded by the stream, not per chunk: a multibyte character split
   * across two chunks would otherwise arrive as two U+FFFD (TSK-035). */
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() === '') continue;
      let msg: RpcMessage;
      try { msg = JSON.parse(line); } catch (e) { unsolicited.push({ parseError: (e as Error).message, line }); continue; }
      if (msg && 'id' in msg && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id)!;
        pending.delete(msg.id);
        resolve(msg);
      } else {
        unsolicited.push(msg);
      }
    }
  });
  child.stderr!.on('data', (chunk: string) => { errBuf += chunk; });

  /* A dead server must fail every STILL-PENDING request promptly, not
   * leave each one to its own fixed timeout -- a server that crashed (or
   * never started, e.g. a missing sibling under a broken fixture) would
   * otherwise hang every caller for the full timeout and, since nothing
   * here would ever settle those promises otherwise, surface as an
   * unhandled rejection rather than a clean failure once the timeout
   * finally does fire. `exited` also lets a request() placed AFTER the
   * child has already died fail immediately instead of waiting at all. */
  let exited: ExitInfo | null = null;
  function rejectAllPending(reason: string) {
    for (const [, { reject }] of pending) reject(new Error(reason));
    pending.clear();
  }
  const exitPromise: Promise<ExitInfo> = new Promise(resolve => {
    child.on('error', e => {
      exited = { status: null, signal: null, spawnError: e.message };
      resolve(exited);
      rejectAllPending('the server process failed to spawn: ' + e.message);
    });
    child.on('close', (code, signal) => {
      exited = { status: code, signal };
      resolve(exited);
      rejectAllPending('the server process exited (code=' + code + ' signal=' + signal +
        ') before answering -- stderr: ' + errBuf.slice(0, 2000));
    });
  });

  function rawSend(obj: unknown): void {
    child.stdin!.write(JSON.stringify(obj) + '\n');
  }

  function request(method: string, params?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage> {
    const ro = ropts || {};
    const id = ro.id !== undefined ? ro.id : nextId++;
    const timeoutMs = ro.timeout || 15000;
    const msg = { jsonrpc: '2.0', id, method, params: params || {} };
    if (exited) {
      const ex: ExitInfo = exited;
      return Promise.reject(new Error('the server process already exited (code=' + ex.status +
        ' signal=' + ex.signal + (ex.spawnError ? ' spawnError=' + ex.spawnError : '') +
        ') before this request was sent -- stderr: ' + errBuf.slice(0, 2000)));
    }
    const p: Promise<RpcMessage> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timed out waiting for a response to ' + method + ' (id=' + id + ')'));
      }, timeoutMs);
      pending.set(id, { resolve: m => { clearTimeout(timer); resolve(m); }, reject: e => { clearTimeout(timer); reject(e); } });
    });
    rawSend(msg);
    return p;
  }

  function notify(method: string, params?: Record<string, unknown>): void {
    rawSend({ jsonrpc: '2.0', method, params: params || {} });
  }

  /* Modern per-request `_meta`, carrying the one key `nanojira-mcp` needs to
   * detect the era (§ 17); `clientInfo`/`clientCapabilities` are included
   * only where the real `server/discover` example in the spec shows them. */
  function modernMeta(extra?: Record<string, unknown>): Record<string, unknown> {
    return Object.assign({ 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION }, extra || {});
  }

  function discover(ropts?: RequestOpts): Promise<RpcMessage> {
    return request('server/discover', {
      _meta: modernMeta({
        'io.modelcontextprotocol/clientInfo': { name: 'nj-oracle', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      }),
    }, ropts);
  }

  function modernToolsList(ropts?: RequestOpts): Promise<RpcMessage> {
    return request('tools/list', { _meta: modernMeta() }, ropts);
  }

  function modernToolsCall(name: string, args?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage> {
    return request('tools/call', { name, arguments: args || {}, _meta: modernMeta() }, ropts);
  }

  function initialize(ropts?: RequestOpts): Promise<RpcMessage> {
    return request('initialize', {
      protocolVersion: LEGACY_VERSION,
      clientInfo: { name: 'nj-oracle', version: '1.0.0' },
      capabilities: {},
    }, ropts);
  }

  function legacyToolsList(ropts?: RequestOpts): Promise<RpcMessage> {
    return request('tools/list', {}, ropts);
  }

  function legacyToolsCall(name: string, args?: Record<string, unknown>, ropts?: RequestOpts): Promise<RpcMessage> {
    return request('tools/call', { name, arguments: args || {} }, ropts);
  }

  async function close(): Promise<ExitInfo | null> {
    try { child.stdin!.end(); } catch (e) { /* already closed */ }
    const r = await Promise.race([exitPromise, new Promise<null>(res => setTimeout(() => res(null), 3000))]);
    if (!r) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } return exitPromise; }
    return r;
  }

  return {
    child, request, notify, rawSend, close,
    discover, modernToolsList, modernToolsCall,
    initialize, legacyToolsList, legacyToolsCall,
    stderr: () => errBuf,
    unsolicited: () => unsolicited.slice(),
  };
}

export { spawnServer, MODERN_VERSION, LEGACY_VERSION };
