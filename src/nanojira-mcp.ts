#!/usr/bin/env node
'use strict';

// `nanojira-mcp` — a second, independent entry point (§ 17 "MCP Interface", § 3):
// `nanojira`'s existing commands as MCP tools over stdio, for an MCP-speaking
// agent that would otherwise shell out to `dist/nanojira` and parse `--json` by
// hand. Hand-rolled JSON-RPC, never `@modelcontextprotocol/sdk` (that
// package is a test-only devDependency for the oracle's conformance leg,
// D144/D147) — this file has no runtime dependency and no `node_modules`,
// the same promise `dist/nanojira` itself makes (§ 3, AC-38).
//
// Architecture (§ 17 "Architecture"): one `dist/nanojira` process per tool call.
// A tool call becomes the CLI argument list the equivalent invocation would
// have, plus an explicit `--backlog=<the server's own resolved path>`, run
// as a child with `--json`; its parsed stdout becomes the tool result
// unchanged. Zero duplicated logic, zero new concurrency model, contract
// fidelity by construction.

import * as path from 'path';
import { spawn } from 'child_process';
import { parseArgs } from './core/args.ts';
import { findBacklog } from './core/config.ts';
import { Fail } from './core/output.ts';
import type { FieldSpec } from './core/flag-table.ts';
import { commandFields } from './core/flag-table.ts';
import { VERSION } from './core/version.ts';

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-11-25';
const META_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_NAME = 'nanojira-mcp';
// The identical value `nanojira --version` reports (§ 9, § 17, D151) — one
// package.json source embedded into both binaries at build time, never a
// separately maintained string.
const SERVER_VERSION = VERSION;

// `tools/list`'s exact, fixed order (§ 17 "Tool surface"). `rm` is never
// present — omitted unconditionally, not merely gated.
const TOOL_NAMES = ['list', 'show', 'find', 'tree', 'new', 'set', 'note',
  'check', 'claim', 'release', 'next', 'log', 'archive', 'unarchive', 'doctor'];

/** `doctor`'s `fix` field exists in its schema only when the server was
 * launched with `--allow-destructive` (§ 17): the gate is schema-level,
 * not a runtime check inside the tool. Every other tool's fields are its
 * flag-table entry minus the `*-file` fields (`description-file`,
 * `acceptance-file`): those read any path the caller names, which would
 * let a tool call copy a local file into the backlog, and an MCP client
 * has the text in hand anyway (TSK-035, DECISIONS 214). `file` stays: it
 * addresses an already-scanned element, never an arbitrary path. */
function toolFields(name: string, allowDestructive: boolean): FieldSpec[] {
  if (name === 'doctor' && !allowDestructive) return [];
  return commandFields(name).filter((f) => !f.name.endsWith('-file'));
}

/* Per-call timeout (TSK-035): a child that never finishes would otherwise
 * hold its call, and with it the client, for good. CALL_MARGIN_S is far
 * beyond any real call; a write's NJ_ON_CHANGE hook runs inside the child
 * for up to NJ_ON_CHANGE_TIMEOUT seconds (default 10), so that is added
 * when a hook is set. A child past it gets SIGTERM (nanojira passes that
 * on to a running hook's group), then SIGKILL after KILL_GRACE_MS. */
const CALL_MARGIN_S = 60;
const KILL_GRACE_MS = 5000;
/* How long a call waits for the child's stderr to end once the child has
 * exited and its stdout has ended. Whatever nanojira itself wrote is in the
 * pipe by then; only a process it left behind (a hook job that left the
 * hook's group, `setsid`) can hold the pipe longer, and the call must not
 * wait for that one (D214, TSK-035 review). */
const STDERR_DRAIN_MS = 200;
function callTimeoutMs(): number {
  const raw = process.env.NJ_ON_CHANGE_TIMEOUT;
  const hookS = !process.env.NJ_ON_CHANGE ? 0 : raw !== undefined && /^[1-9][0-9]*$/.test(raw) ? Math.min(Number(raw), 86400) : 10;
  return (CALL_MARGIN_S + hookS) * 1000;
}

function inputSchema(fields: FieldSpec[]) {
  const properties: Record<string, { type: string }> = {};
  for (const f of fields) properties[f.name] = { type: f.kind === 'boolean' ? 'boolean' : 'string' };
  return { type: 'object', properties, additionalProperties: false };
}

function buildToolList(allowDestructive: boolean) {
  return TOOL_NAMES.map((name) => ({
    name,
    inputSchema: inputSchema(toolFields(name, allowDestructive)),
  }));
}

// -------------------------------------------------------------------- main

// The complete set of startup arguments nanojira-mcp recognises (§ 17, D152): a
// typo here must not pass silently and start the server as if it had been
// left off — the same "a typo must not pass" rule `nanojira`'s own checkFlags
// already enforces, mirrored here since nanojira-mcp has no per-command flag
// table of its own, only this one fixed startup shape.
const KNOWN_STARTUP_FLAGS = ['backlog', 'allow-destructive', 'version'];
const KNOWN_STARTUP_HINT = `Known: ${KNOWN_STARTUP_FLAGS.map((f) => '--' + f).join(', ')}`;

/** Before any backlog resolution or stdio protocol traffic (D152): one
 * stderr line naming the offending argument, nothing on stdout. */
function rejectStartup(message: string): never {
  process.stderr.write(`nanojira-mcp: ${message} ${KNOWN_STARTUP_HINT}\n`);
  process.exit(1);
}

function main() {
  const argv = parseArgs(process.argv.slice(2));

  for (const name of argv.flags.keys()) {
    if (!KNOWN_STARTUP_FLAGS.includes(name)) rejectStartup(`unknown argument '--${name}'.`);
  }
  if (argv.positional.length > 0) rejectStartup(`unknown argument '${argv.positional[0]}'.`);

  // Same rule as `nanojira --version` (§ 9, § 17, D151/D152): checked before the
  // backlog resolution below, so it works anywhere, resolving no backlog —
  // and, like `nanojira --version`, combined with anything else (nanojira-mcp has no
  // --json) it is rejected rather than silently printing the version.
  if (argv.flags.has('version')) {
    const others = Array.from(argv.flags.keys()).filter((k) => k !== 'version');
    if (others.length > 0) rejectStartup(`--version takes no other argument (got '--${others[0]}').`);
    process.stdout.write(`nanojira-mcp ${VERSION}\n`);
    process.exit(0);
  }

  const allowDestructive = argv.flags.has('allow-destructive');

  // Resolved exactly once, by the same rules as every CLI command (§ 4),
  // and served for the life of this process (§ 17 "Shape and backlog
  // confinement"). Failure here must not corrupt the stdout protocol
  // stream, so it is reported on stderr and the process exits — nothing
  // has spoken JSON-RPC yet.
  let backlog: string;
  try {
    backlog = findBacklog(argv.flags, false);
  } catch (e: any) {
    process.stderr.write(`nanojira-mcp: ${e instanceof Fail ? e.message : String(e)}\n`);
    process.exit(1);
  }

  // The sibling `nanojira.mjs` next to this file — both ship from the same
  // directory (§ 3, § 18), built in the same commit. Never guessed from PATH
  // or re-derived from cwd: that is exactly the ambiguity `--backlog`
  // confinement below exists to remove. This file is always invoked as
  // `dist/nanojira-mcp.mjs` directly, or via the exported folder's `bin/nanojira-mcp`
  // wrapper, which execs `dist/nanojira-mcp.mjs` the same way — either way its own
  // sibling is `nanojira.mjs` in the same `dist/` directory (DECISIONS 185
  // addendum 9b3d0de, replacing the earlier `.cjs` sibling lookup, D179).
  const njPath = path.join(path.dirname(path.resolve(process.argv[1])), 'nanojira.mjs');

  // Children spawned for in-flight tool calls. A disconnect (stdin
  // closes) lets them finish and answer, then the process exits: killing a
  // write mid-flight would be exactly the half-done state § 12's
  // compare-before-write exists to prevent — the same reason
  // `notifications/cancelled` (§ 17) is a no-op for a still-running call.
  // The per-call timeout bounds the wait (TSK-035).
  const liveChildren = new Set<import('child_process').ChildProcess>();
  const timeoutMs = callTimeoutMs();

  function send(obj: object) { process.stdout.write(JSON.stringify(obj) + '\n'); }

  function respond(id: unknown, result: object) { send({ jsonrpc: '2.0', id, result }); }
  function respondError(id: unknown, code: number, message: string, data?: object) {
    const error: { code: number; message: string; data?: object } = { code, message };
    if (data !== undefined) error.data = data;
    send({ jsonrpc: '2.0', id, error });
  }

  function handleToolsCall(id: unknown, params: any) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (typeof name !== 'string' || !TOOL_NAMES.includes(name)) {
      respondError(id, -32602, `Invalid params: unknown tool '${name}'`);
      return;
    }
    const fields = toolFields(name, allowDestructive);
    const byName = new Map(fields.map((f) => [f.name, f]));
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      respondError(id, -32602, 'Invalid params: "arguments" must be an object');
      return;
    }
    for (const key of Object.keys(args)) {
      const f = byName.get(key);
      if (!f) { respondError(id, -32602, `Invalid params: unknown argument '${key}' for tool '${name}'`); return; }
      const v = args[key];
      const okType = f.kind === 'string' ? typeof v === 'string' : typeof v === 'boolean';
      if (!okType) {
        respondError(id, -32602, `Invalid params: '${key}' must be a ${f.kind === 'string' ? 'string' : 'boolean'}`);
        return;
      }
    }

    // Every field, a positional one (note/find `text`) included, goes as
    // `--name=value`: a value is never parsed as a flag that way. A bare
    // positional starting with `--` would be (`--text-file=<path>` read
    // a local file into the note, TSK-035).
    const flagArgs: string[] = [];
    for (const f of fields) {
      if (!(f.name in args)) continue;
      const v = args[f.name];
      if (f.kind === 'boolean') { if (v) flagArgs.push(`--${f.name}`); continue; }
      flagArgs.push(`--${f.name}=${v}`);
    }
    // `--backlog` explicit on every spawn (§ 17 "Confinement is mechanical,
    // not incidental"), `--json` always, so the child's stdout is exactly
    // the object this call returns as `structuredContent`.
    const childArgv = [njPath, name, ...flagArgs, `--backlog=${backlog}`, '--json'];

    // stdin ignored: no tool reads it, and a pipe never closed would hang
    // any child that tried (TSK-035).
    const child = spawn(process.execPath, childArgv, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    liveChildren.add(child);
    let out = '';
    let err = '';
    let answered = false;
    let finished = false;
    let grace: NodeJS.Timeout | undefined;
    let drain: NodeJS.Timeout | undefined;
    const answer = (fn: () => void) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      fn();
    };
    const done = () => {
      if (finished) return;
      finished = true;
      liveChildren.delete(child);
      if (grace) clearTimeout(grace);
      if (drain) clearTimeout(drain);
      exitWhenIdle();
    };
    const timer = setTimeout(() => {
      answer(() => respondError(id, -32603, `Internal error: nanojira did not finish within ${timeoutMs / 1000} s; killed`));
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      grace = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
    }, timeoutMs);
    // Decoded by the stream, so a multibyte character split across two
    // chunks arrives whole (TSK-035).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    // Still read after the answer, so a writer left holding the pipe never
    // blocks on a full one; kept only until the answer.
    child.stderr.on('data', (c: string) => { if (!answered) err += c; });
    child.on('error', (e) => {
      answer(() => respondError(id, -32603, `Internal error: failed to spawn nanojira: ${e.message}`));
      done();
    });
    // Finished = the child has exited AND its stdout has ended (its whole
    // result is in), not 'close', which also waits for stderr: a process
    // the child left holding stderr would otherwise hold the call, and
    // turn a write that succeeded into the timeout's -32603 (D214).
    let exitCode: number | null | undefined;
    let stdoutEnded = false;
    let stderrEnded = false;
    const settle = () => {
      if (exitCode === undefined || !stdoutEnded || finished) return;
      if (!stderrEnded && !drain) { drain = setTimeout(() => { stderrEnded = true; settle(); }, STDERR_DRAIN_MS); return; }
      if (!stderrEnded) return;
      complete(exitCode);
    };
    child.on('exit', (code) => { exitCode = code; settle(); });
    child.stdout.on('end', () => { stdoutEnded = true; settle(); });
    child.stderr.on('end', () => { stderrEnded = true; settle(); });
    child.on('close', (code) => { exitCode = exitCode === undefined ? code : exitCode; stdoutEnded = true; stderrEnded = true; settle(); });
    const complete = (code: number | null) => {
      answer(() => {
        let parsed: unknown = null;
        try { parsed = JSON.parse(out); } catch { /* leave null; stderr below explains */ }
        if (parsed === null) {
          respondError(id, -32603, `Internal error: nanojira exited ${code} without parsable --json output: ${err.slice(0, 500)}`);
          return;
        }
        const isError = code !== 0;
        // A failure's message (`Error: …` and its hint) is on stderr, never
        // in the --json body; a second text block carries it, the body
        // itself stays exactly the CLI's (TSK-035).
        const content = [{ type: 'text', text: JSON.stringify(parsed) }];
        if (isError && err.trim() !== '') content.push({ type: 'text', text: err.trim().slice(0, 4000) });
        respond(id, { content, structuredContent: parsed, isError });
      });
      done();
    };
  }

  function handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      respondError(null, -32700, 'Parse error');
      return;
    }
    // A string, a number, `true`, null or an array is valid JSON but no
    // request: `'id' in` a primitive throws, which crashed the server
    // (TSK-035).
    const isObject = msg !== null && typeof msg === 'object' && !Array.isArray(msg);
    if (!isObject || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      respondError(isObject && 'id' in msg ? msg.id : null, -32600, 'Invalid Request');
      return;
    }
    const hasId = 'id' in msg;
    const { method } = msg;
    const params = msg.params || {};

    // A notification (no id): accepted, never answered (§ 17
    // "Legacy notifications" — `notifications/initialized` is a no-op
    // since every tool call is already a fresh process;
    // `notifications/cancelled` is a no-op for the same compare-before-
    // write reason the class comment above gives).
    if (!hasId) return;
    const { id } = msg;

    // Era detection (§ 17 "Protocol: a dual-era server"): a request whose
    // `_meta` carries the protocol-version key is modern; this check
    // applies uniformly, not only to `tools/call`.
    const meta = params && params._meta;
    const version = meta && meta[META_VERSION_KEY];
    if (version !== undefined && version !== MODERN_VERSION) {
      respondError(id, -32022, 'Unsupported protocol version',
        { supported: [MODERN_VERSION, LEGACY_VERSION], requested: version });
      return;
    }

    switch (method) {
      case 'server/discover':
        respond(id, {
          resultType: 'complete',
          supportedVersions: [MODERN_VERSION, LEGACY_VERSION],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION } },
        });
        return;
      case 'initialize':
        respond(id, {
          protocolVersion: LEGACY_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;
      case 'tools/list':
        respond(id, { tools: buildToolList(allowDestructive) });
        return;
      case 'tools/call':
        handleToolsCall(id, params);
        return;
      default:
        respondError(id, -32601, 'Method not found');
        return;
    }
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() !== '') handleLine(line);
    }
  });
  let stdinEnded = false;
  function exitWhenIdle() {
    // Once the last answer is flushed: a pipe write is asynchronous on Windows.
    if (stdinEnded && liveChildren.size === 0) process.stdout.write('', () => process.exit(0));
  }
  process.stdin.on('end', () => {
    stdinEnded = true;
    exitWhenIdle();
  });
}

main();
