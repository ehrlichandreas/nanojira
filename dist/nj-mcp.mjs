#!/usr/bin/env node

// src/nj-mcp.ts
import * as path4 from "node:path";
import { spawn } from "node:child_process";

// src/core/args.ts
import * as fs3 from "node:fs";

// src/core/constants.ts
var SECTION_FLAGS = ["description", "description-file", "acceptance", "acceptance-file"];
var SETTABLE_FIELDS = ["title", "parent", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var NEW_FIELDS = ["type", "parent", "title", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var V3_DIR_REL = ".nanojira";
var V3_CONFIG_REL = ".nanojira/config.json";
var LEGACY_CONFIG_REL = ".nanojira.json";

// src/core/claims.ts
import * as fs from "node:fs";
import * as path from "node:path";

// src/core/store.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// src/core/output.ts
var Fail = class extends Error {
  hint;
  code;
  constructor(message, hint, code) {
    super(message);
    this.hint = hint;
    this.code = code || "failed";
  }
};
function fail(code, message, hint) {
  throw new Fail(message, hint, code);
}
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

// src/core/args.ts
function parseArgs(argv) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  for (const a of argv) {
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      let name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const value = eq === -1 ? true : a.slice(eq + 1);
      if (name === "depends-on") name = "depends_on";
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
function flagString(flags, name) {
  const v = flags.get(name);
  if (v === void 0) return void 0;
  if (v === true) return fail("missing_value", `--${name} needs a value (use --${name}=\u2026)`);
  return v;
}

// src/core/config.ts
import * as fs4 from "node:fs";
import * as os from "node:os";
import * as path3 from "node:path";

// src/core/version.ts
var VERSION = "3.11.0";

// src/core/config.ts
var SOURCE_CODE = { flag: "invalid_backlog_flag", env: "invalid_backlog_env", njrc: "invalid_backlog_njrc" };
function sourceName(src) {
  return src.kind === "flag" ? "--backlog" : src.kind === "env" ? "NJ_BACKLOG" : src.file;
}
function holdsBacklog(dir) {
  return fs4.existsSync(path3.join(dir, V3_CONFIG_REL)) || fs4.existsSync(path3.join(dir, LEGACY_CONFIG_REL));
}
function claim(dir, src, lenient) {
  const shown = src.kind === "njrc" ? escapeInvisible(dir) : dir;
  if (!isDir(dir)) fail(SOURCE_CODE[src.kind], `no backlog at ${shown} (from ${sourceName(src)})`);
  if (lenient || holdsBacklog(dir)) return dir;
  if (fs4.existsSync(path3.join(dir, V3_DIR_REL))) {
    fail(
      "backlog_without_config",
      `${shown} exists but has no ${V3_CONFIG_REL}`,
      "run `nj doctor` \u2014 it tolerates the missing file and reports config:invalid"
    );
  }
  fail(
    SOURCE_CODE[src.kind],
    `no backlog at ${shown} (from ${sourceName(src)})`,
    `the directory has no ${V3_CONFIG_REL} \u2014 check the path, or run \`nj init\` with the same source to create a backlog there`
  );
}
function escapeInvisible(s) {
  return s.replace(/[^\x20-\x7E]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
function explicitLocation(flags) {
  const flag = flagString(flags, "backlog");
  if (flag !== void 0) {
    if (flag === "") fail("missing_value", "--backlog needs a value (use --backlog=\u2026)");
    return { dir: fromCwd(flag), src: { kind: "flag" } };
  }
  const env = process.env.NJ_BACKLOG;
  if (env !== void 0 && env !== "") return { dir: fromCwd(env), src: { kind: "env" } };
  return null;
}
function njrcLocation(dir) {
  const file = path3.join(dir, ".njrc");
  const raw = readNjrc(file);
  if (raw === null) return null;
  const value = parseNjrc(file, raw).get("backlog");
  if (value === void 0) return null;
  const expanded = value.startsWith("~/") ? path3.join(os.homedir(), value.slice(2)) : value;
  return { dir: path3.resolve(dir, expanded), src: { kind: "njrc", file } };
}
function readNjrc(file) {
  let link;
  try {
    link = fs4.lstatSync(file);
  } catch {
    return null;
  }
  const bad = (reason, hint) => fail("invalid_njrc", `invalid .njrc at ${file}: ${reason}`, hint);
  checkOwner(link.uid, bad);
  njrcSwapFaultHook(path3.dirname(file));
  let fd;
  try {
    fd = fs4.openSync(file, fs4.constants.O_RDONLY | fs4.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === "ELOOP") return bad("it is a symlink loop (ELOOP)");
    if (e.code === "ENOENT") {
      let fresh;
      try {
        fresh = fs4.lstatSync(file);
      } catch {
        return null;
      }
      return fresh.isSymbolicLink() ? bad("it is a dangling symlink") : null;
    }
    return bad(`cannot open it -- ${e.code || e.message}`);
  }
  try {
    let st;
    try {
      st = fs4.fstatSync(fd);
    } catch (e) {
      return bad(`cannot stat it -- ${e.code || e.message}`);
    }
    checkOwner(st.uid, bad);
    if (!st.isFile()) return bad(st.isDirectory() ? "it is a directory, not a file" : "it is not a regular file");
    let raw;
    try {
      raw = fs4.readFileSync(fd, "utf8");
    } catch (e) {
      return bad(`cannot read it -- ${e.code || e.message}`);
    }
    return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  } finally {
    fs4.closeSync(fd);
  }
}
function njrcSwapFaultHook(dir) {
  if (process.env.NJ_FAULT !== "njrc-swap") return;
  const marker = path3.join(dir, ".nj-fault-go");
  const deadline = Date.now() + 1e4;
  while (!fs4.existsSync(marker)) {
    if (Date.now() >= deadline) return;
    sleepMs(50);
  }
}
function checkOwner(uid, bad) {
  if (typeof process.getuid !== "function") return;
  if (uid !== process.getuid() && uid !== 0) {
    bad(`owned by uid ${uid}, not by you`, "use --backlog=<path> or NJ_BACKLOG, or change the owner");
  }
}
var NJRC_KEYS = ["backlog"];
function trimBlank(s) {
  return s.replace(/^[ \t]+|[ \t]+$/g, "");
}
function parseNjrc(file, raw) {
  const values = /* @__PURE__ */ new Map();
  const bad = (n, reason) => fail(
    "invalid_njrc",
    `invalid .njrc at ${file}: line ${n}: ${reason}`,
    `one \`key = value\` per line, a line starting with \`#\` is a comment; known keys: ${NJRC_KEYS.join(", ")}`
  );
  const lines = raw.split("\n");
  lines.forEach((full, i) => {
    const line = i < lines.length - 1 && full.endsWith("\r") ? full.slice(0, -1) : full;
    if (line.includes("\r")) bad(i + 1, "a carriage return (\\r) not followed by a line feed");
    const t = trimBlank(line);
    if (t === "" || t.startsWith("#")) return;
    const eq = t.indexOf("=");
    if (eq === -1) bad(i + 1, `no '=' in '${escapeInvisible(t)}'`);
    const key = trimBlank(t.slice(0, eq));
    const value = trimBlank(t.slice(eq + 1));
    if (!NJRC_KEYS.includes(key)) bad(i + 1, `unknown key '${escapeInvisible(key)}'`);
    if (value === "") bad(i + 1, `empty value for '${escapeInvisible(key)}'`);
    if (values.has(key)) bad(i + 1, `repeated key '${escapeInvisible(key)}'`);
    values.set(key, value);
  });
  return values;
}
function workingDir() {
  try {
    return process.cwd();
  } catch (e) {
    return fail("io_error", `cannot determine the working directory: ${oneLine(e)}`);
  }
}
function fromCwd(p) {
  return path3.isAbsolute(p) ? path3.resolve(p) : path3.resolve(workingDir(), p);
}
function oneLine(e) {
  const msg = e && e.message ? String(e.message) : String(e);
  return msg.split("\n")[0];
}
function findBacklog(flags, lenient) {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return claim(explicit.dir, explicit.src, lenient);
  for (let dir = workingDir(); ; dir = path3.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return claim(rc.dir, rc.src, lenient);
    const candidate = path3.join(dir, "backlog");
    if (isDir(candidate)) {
      if (lenient || holdsBacklog(candidate)) return candidate;
      fail(
        "backlog_without_config",
        `${candidate} exists but has no ${V3_CONFIG_REL}`,
        "run `nj doctor` \u2014 it tolerates the missing file and reports config:invalid"
      );
    }
    if (path3.dirname(dir) === dir) break;
  }
  return fail(
    "no_backlog",
    `no backlog found (looked for backlog/${V3_CONFIG_REL} upward from the working directory)`,
    "run `nj init` to create one, or set NJ_BACKLOG"
  );
}
function isDir(p) {
  try {
    return fs4.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// src/core/flag-table.ts
var str = (name) => ({ name, kind: "string" });
var bool = (name) => ({ name, kind: "boolean" });
var FLAG_TABLE = {
  list: { fields: [str("status"), str("type"), str("tag"), str("parent"), str("assignee")] },
  find: { fields: [
    str("status"),
    str("type"),
    str("tag"),
    str("parent"),
    str("assignee"),
    bool("case-sensitive"),
    { name: "text", kind: "string", positional: true }
  ] },
  show: { fields: [str("id"), str("file")] },
  log: { fields: [str("id"), str("file")] },
  tree: { fields: [str("id")] },
  // Built from the same NEW_FIELDS/SETTABLE_FIELDS constants.ts and
  // cmd-new.ts/cmd-set.ts already validate against — one list, not two
  // hand-kept-in-sync copies.
  new: { fields: NEW_FIELDS.map(str) },
  // --add-tags/--remove-tags (DECISIONS 163 B): an incremental alternative
  // to --tags=, set-only, hyphenated like case-sensitive/allow-open-children
  // (no pre-existing Element field to normalise onto, unlike depends-on).
  set: { fields: [str("id"), str("file")].concat(SETTABLE_FIELDS.map(str), [str("add-tags"), str("remove-tags")]) },
  note: { fields: [str("id"), str("file"), str("as"), { name: "text", kind: "string", positional: true }] },
  check: { fields: [str("id"), str("file"), str("text"), str("item"), bool("on"), bool("off")] },
  claim: { fields: [str("id"), str("file"), str("as"), str("steal"), str("status")] },
  release: { fields: [str("id"), str("file"), str("as")] },
  // No id/file (§ 12b "Not applicable"): `next` picks its own target, the
  // same reason `new` has neither.
  next: { fields: [str("as"), str("status"), str("type"), str("tag"), str("parent"), str("assignee")] },
  archive: { fields: [str("id"), str("file")] },
  unarchive: { fields: [str("id"), str("file")] },
  doctor: { fields: [bool("fix")] },
  // `rm` answers only `nj rm --help`'s question (DECISIONS 163 A) -- it is
  // never an `nj-mcp` tool (TOOL_NAMES omits it unconditionally, § 17),
  // and this entry does not change that.
  rm: { fields: [str("id"), str("file"), bool("cascade")] }
};
function spec(command) {
  const s = FLAG_TABLE[command];
  if (!s) throw new Error(`flag-table: unknown command '${command}'`);
  return s;
}
function commandFields(command) {
  return spec(command).fields;
}

// src/nj-mcp.ts
var MODERN_VERSION = "2026-07-28";
var LEGACY_VERSION = "2025-11-25";
var META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
var SERVER_NAME = "nj-mcp";
var SERVER_VERSION = VERSION;
var TOOL_NAMES = [
  "list",
  "show",
  "find",
  "tree",
  "new",
  "set",
  "note",
  "check",
  "claim",
  "release",
  "next",
  "log",
  "archive",
  "unarchive",
  "doctor"
];
function toolFields(name, allowDestructive) {
  if (name !== "doctor") return commandFields(name);
  return allowDestructive ? commandFields("doctor") : [];
}
function inputSchema(fields) {
  const properties = {};
  for (const f of fields) properties[f.name] = { type: f.kind === "boolean" ? "boolean" : "string" };
  return { type: "object", properties, additionalProperties: false };
}
function buildToolList(allowDestructive) {
  return TOOL_NAMES.map((name) => ({
    name,
    inputSchema: inputSchema(toolFields(name, allowDestructive))
  }));
}
var KNOWN_STARTUP_FLAGS = ["backlog", "allow-destructive", "version"];
var KNOWN_STARTUP_HINT = `Known: ${KNOWN_STARTUP_FLAGS.map((f) => "--" + f).join(", ")}`;
function rejectStartup(message) {
  process.stderr.write(`nj-mcp: ${message} ${KNOWN_STARTUP_HINT}
`);
  process.exit(1);
}
function main() {
  const argv = parseArgs(process.argv.slice(2));
  for (const name of argv.flags.keys()) {
    if (!KNOWN_STARTUP_FLAGS.includes(name)) rejectStartup(`unknown argument '--${name}'.`);
  }
  if (argv.positional.length > 0) rejectStartup(`unknown argument '${argv.positional[0]}'.`);
  if (argv.flags.has("version")) {
    const others = Array.from(argv.flags.keys()).filter((k) => k !== "version");
    if (others.length > 0) rejectStartup(`--version takes no other argument (got '--${others[0]}').`);
    process.stdout.write(`nj-mcp ${VERSION}
`);
    process.exit(0);
  }
  const allowDestructive = argv.flags.has("allow-destructive");
  let backlog;
  try {
    backlog = findBacklog(argv.flags, false);
  } catch (e) {
    process.stderr.write(`nj-mcp: ${e instanceof Fail ? e.message : String(e)}
`);
    process.exit(1);
  }
  const njPath = path4.join(path4.dirname(path4.resolve(process.argv[1])), "nj.mjs");
  const liveChildren = /* @__PURE__ */ new Set();
  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }
  function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
  }
  function respondError(id, code, message, data) {
    const error = { code, message };
    if (data !== void 0) error.data = data;
    send({ jsonrpc: "2.0", id, error });
  }
  function handleToolsCall(id, params) {
    const name = params && params.name;
    const args = params && params.arguments || {};
    if (typeof name !== "string" || !TOOL_NAMES.includes(name)) {
      respondError(id, -32602, `Invalid params: unknown tool '${name}'`);
      return;
    }
    const fields = toolFields(name, allowDestructive);
    const byName = new Map(fields.map((f) => [f.name, f]));
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      respondError(id, -32602, 'Invalid params: "arguments" must be an object');
      return;
    }
    for (const key of Object.keys(args)) {
      const f = byName.get(key);
      if (!f) {
        respondError(id, -32602, `Invalid params: unknown argument '${key}' for tool '${name}'`);
        return;
      }
      const v = args[key];
      const okType = f.kind === "string" ? typeof v === "string" : typeof v === "boolean";
      if (!okType) {
        respondError(id, -32602, `Invalid params: '${key}' must be a ${f.kind === "string" ? "string" : "boolean"}`);
        return;
      }
    }
    const flagArgs = [];
    const positionals = [];
    for (const f of fields) {
      if (!(f.name in args)) continue;
      const v = args[f.name];
      if (f.positional) {
        positionals.push(String(v));
        continue;
      }
      if (f.kind === "boolean") {
        if (v) flagArgs.push(`--${f.name}`);
        continue;
      }
      flagArgs.push(`--${f.name}=${v}`);
    }
    const childArgv = [njPath, name, ...flagArgs, `--backlog=${backlog}`, "--json", ...positionals];
    const child = spawn(process.execPath, childArgv, { env: process.env });
    liveChildren.add(child);
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", (e) => {
      liveChildren.delete(child);
      respondError(id, -32603, `Internal error: failed to spawn nj: ${e.message}`);
    });
    child.on("close", (code) => {
      liveChildren.delete(child);
      let parsed = null;
      try {
        parsed = JSON.parse(out);
      } catch {
      }
      if (parsed === null) {
        respondError(id, -32603, `Internal error: nj exited ${code} without parsable --json output: ${err.slice(0, 500)}`);
        return;
      }
      const isError = code !== 0;
      respond(id, {
        content: [{ type: "text", text: JSON.stringify(parsed) }],
        structuredContent: parsed,
        isError
      });
    });
  }
  function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }
    if (msg === null || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      respondError("id" in (msg || {}) ? msg.id : null, -32600, "Invalid Request");
      return;
    }
    const hasId = "id" in msg;
    const { method } = msg;
    const params = msg.params || {};
    if (!hasId) return;
    const { id } = msg;
    const meta = params && params._meta;
    const version = meta && meta[META_VERSION_KEY];
    if (version !== void 0 && version !== MODERN_VERSION) {
      respondError(
        id,
        -32022,
        "Unsupported protocol version",
        { supported: [MODERN_VERSION, LEGACY_VERSION], requested: version }
      );
      return;
    }
    switch (method) {
      case "server/discover":
        respond(id, {
          resultType: "complete",
          supportedVersions: [MODERN_VERSION, LEGACY_VERSION],
          capabilities: { tools: {} },
          _meta: { "io.modelcontextprotocol/serverInfo": { name: SERVER_NAME, version: SERVER_VERSION } }
        });
        return;
      case "initialize":
        respond(id, {
          protocolVersion: LEGACY_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        });
        return;
      case "tools/list":
        respond(id, { tools: buildToolList(allowDestructive) });
        return;
      case "tools/call":
        handleToolsCall(id, params);
        return;
      default:
        respondError(id, -32601, "Method not found");
        return;
    }
  }
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() !== "") handleLine(line);
    }
  });
  process.stdin.on("end", () => {
    for (const child of liveChildren) {
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }
    process.exit(0);
  });
}
main();
