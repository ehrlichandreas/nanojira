#!/usr/bin/env node
'use strict';

// `nj-mcp` — a second, independent entry point (§ 17 "MCP Interface", § 3):
// `nj`'s existing commands as MCP tools over stdio, for an MCP-speaking
// agent that would otherwise shell out to `dist/nj` and parse `--json` by
// hand. Hand-rolled JSON-RPC, never `@modelcontextprotocol/sdk` (that
// package is a test-only devDependency for the oracle's conformance leg,
// D144/D147) — this file has no runtime dependency and no `node_modules`,
// the same promise `dist/nj` itself makes (§ 3, AC-38).
//
// Architecture (§ 17 "Architecture"): one `dist/nj` process per tool call.
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
const SERVER_NAME = 'nj-mcp';
// The identical value `nj --version` reports (§ 9, § 17, D151) — one
// package.json source embedded into both binaries at build time, never a
// separately maintained string.
const SERVER_VERSION = VERSION;

// `tools/list`'s exact, fixed order (§ 17 "Tool surface"). `rm` is never
// present — omitted unconditionally, not merely gated.
const TOOL_NAMES = ['list', 'show', 'find', 'tree', 'new', 'set', 'note',
  'check', 'claim', 'release', 'archive', 'unarchive', 'doctor'];

/** `doctor`'s `fix` field exists in its schema only when the server was
 * launched with `--allow-destructive` (§ 17): the gate is schema-level,
 * not a runtime check inside the tool. Every other tool's fields are
 * exactly its flag-table entry. */
function toolFields(name: string, allowDestructive: boolean): FieldSpec[] {
  if (name !== 'doctor') return commandFields(name);
  return allowDestructive ? commandFields('doctor') : [];
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

// The complete set of startup arguments nj-mcp recognises (§ 17, D152): a
// typo here must not pass silently and start the server as if it had been
// left off — the same "a typo must not pass" rule `nj`'s own checkFlags
// already enforces, mirrored here since nj-mcp has no per-command flag
// table of its own, only this one fixed startup shape.
const KNOWN_STARTUP_FLAGS = ['backlog', 'allow-destructive', 'version'];
const KNOWN_STARTUP_HINT = `Known: ${KNOWN_STARTUP_FLAGS.map((f) => '--' + f).join(', ')}`;

/** Before any backlog resolution or stdio protocol traffic (D152): one
 * stderr line naming the offending argument, nothing on stdout. */
function rejectStartup(message: string): never {
  process.stderr.write(`nj-mcp: ${message} ${KNOWN_STARTUP_HINT}\n`);
  process.exit(1);
}

function main() {
  const argv = parseArgs(process.argv.slice(2));

  for (const name of argv.flags.keys()) {
    if (!KNOWN_STARTUP_FLAGS.includes(name)) rejectStartup(`unknown argument '--${name}'.`);
  }
  if (argv.positional.length > 0) rejectStartup(`unknown argument '${argv.positional[0]}'.`);

  // Same rule as `nj --version` (§ 9, § 17, D151/D152): checked before the
  // backlog resolution below, so it works anywhere, resolving no backlog —
  // and, like `nj --version`, combined with anything else (nj-mcp has no
  // --json) it is rejected rather than silently printing the version.
  if (argv.flags.has('version')) {
    const others = Array.from(argv.flags.keys()).filter((k) => k !== 'version');
    if (others.length > 0) rejectStartup(`--version takes no other argument (got '--${others[0]}').`);
    process.stdout.write(`nj-mcp ${VERSION}\n`);
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
    process.stderr.write(`nj-mcp: ${e instanceof Fail ? e.message : String(e)}\n`);
    process.exit(1);
  }

  // The sibling `dist/nj` next to this file — both ship from the same
  // `dist/` directory (§ 3), built in the same commit. Never guessed from
  // PATH or re-derived from cwd: that is exactly the ambiguity `--backlog`
  // confinement below exists to remove.
  const njPath = path.join(path.dirname(path.resolve(process.argv[1])), 'nj');

  // Children spawned for in-flight tool calls, so a disconnect (stdin
  // closes) can clean them up instead of leaving zombies — distinct from
  // `notifications/cancelled` (§ 17), which is a no-op for a still-running
  // call: cancelling a write mid-flight would be exactly the half-done
  // state § 12's compare-before-write exists to prevent.
  const liveChildren = new Set<import('child_process').ChildProcess>();

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

    const flagArgs: string[] = [];
    const positionals: string[] = [];
    for (const f of fields) {
      if (!(f.name in args)) continue;
      const v = args[f.name];
      if (f.positional) { positionals.push(String(v)); continue; }
      if (f.kind === 'boolean') { if (v) flagArgs.push(`--${f.name}`); continue; }
      flagArgs.push(`--${f.name}=${v}`);
    }
    // `--backlog` explicit on every spawn (§ 17 "Confinement is mechanical,
    // not incidental"), `--json` always, so the child's stdout is exactly
    // the object this call returns as `structuredContent`.
    const childArgv = [njPath, name, ...flagArgs, `--backlog=${backlog}`, '--json', ...positionals];

    const child = spawn(process.execPath, childArgv, { env: process.env });
    liveChildren.add(child);
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => {
      liveChildren.delete(child);
      respondError(id, -32603, `Internal error: failed to spawn nj: ${e.message}`);
    });
    child.on('close', (code) => {
      liveChildren.delete(child);
      let parsed: unknown = null;
      try { parsed = JSON.parse(out); } catch { /* leave null; stderr below explains */ }
      if (parsed === null) {
        respondError(id, -32603, `Internal error: nj exited ${code} without parsable --json output: ${err.slice(0, 500)}`);
        return;
      }
      const isError = code !== 0;
      respond(id, {
        content: [{ type: 'text', text: JSON.stringify(parsed) }],
        structuredContent: parsed,
        isError,
      });
    });
  }

  function handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      respondError(null, -32700, 'Parse error');
      return;
    }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      respondError('id' in (msg || {}) ? msg.id : null, -32600, 'Invalid Request');
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
  process.stdin.on('end', () => {
    for (const child of liveChildren) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    process.exit(0);
  });
}

main();
