#!/usr/bin/env node

// src/nanojira-mcp.ts
import * as path8 from "node:path";
import { spawn } from "node:child_process";

// src/core/args.ts
import * as fs8 from "node:fs";
import * as path6 from "node:path";

// src/core/constants.ts
var TYPES = ["epic", "task", "subtask"];
var PRIORITIES = ["low", "normal", "high", "urgent"];
var SECTION_FLAGS = ["description", "description-file", "acceptance", "acceptance-file"];
var SETTABLE_FIELDS = ["title", "parent", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var NEW_FIELDS = ["type", "parent", "title", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var FOLDER_ROLES = ["epics", "tasks", "subtasks", "archive"];
var GROUPS = ["type", "hierarchy", "flat"];
var V3_DIR_REL = ".nanojira";
var V3_CONFIG_REL = ".nanojira/config.json";
var V3_INDEX_REL = ".nanojira/index.json";
var LEGACY_CONFIG_REL = ".nanojira.json";
var LEGACY_INDEX_REL = ".nanojira-index.json";
var DEFAULT_CONFIG = {
  schema: 1,
  statuses: ["todo", "doing", "blocked", "review", "done"],
  sections: { description: ["Description"], acceptance: ["Acceptance Criteria"] },
  layout: {
    group: "type",
    folders: { epics: "epics", tasks: "tasks", subtasks: "subtasks", archive: "archive" },
    statusFile: true,
    tagsFile: true
  },
  claims: { staleAfterHours: 24 },
  problems: { ignore: [] },
  ids: { shardSize: 0 }
};
var SEVERITY = {
  "frontmatter:unreadable": "error",
  "file:unreadable": "error",
  "duplicate_id": "error",
  "missing:title": "error",
  "missing:status": "warning",
  "missing:created": "warning",
  "missing:updated": "warning",
  "id:derived": "warning",
  "id:mismatch": "error",
  "type:derived": "warning",
  "type:folder": "error",
  "layout:misplaced": "error",
  "parent:orphaned": "warning",
  "parent:dangling": "error",
  "parent:cycle": "error",
  "parent:hierarchy": "error",
  "depends_on:dangling": "error",
  "depends_on:cycle": "error",
  "unknown:status": "warning",
  "unknown:priority": "warning",
  "done:open_children": "warning",
  "archive:not_done": "error",
  "archive:split": "error",
  "title:h1_mismatch": "warning",
  "incomplete:description": null,
  "incomplete:acceptance": null,
  "active_refs_archived": null,
  "id:no_tombstone": "warning",
  "backlog:stray_tmp": "warning",
  "backlog:ids_missing": "error",
  "backlog:ids_layout_mismatch": "error",
  "backlog:legacy_layout": "error",
  "backlog:unreadable_dir": "error",
  "backlog:status_stale": "warning",
  "backlog:tags_stale": "warning",
  "config:invalid": "error",
  "claim:mismatch": "warning",
  "claim:orphaned": "warning",
  "claim:stale": "warning",
  "claim:symlink": "error",
  "backlog:claims_unignored": "warning",
  "acceptance:no_checkbox": "warning",
  "done:no_acceptance": "warning",
  "done:open_acceptance": "warning",
  "config:unknown_key": "warning",
  "config:unknown_code": "warning"
};

// src/core/dry-run.ts
import * as fs7 from "node:fs";
import * as os from "node:os";
import * as path5 from "node:path";

// src/core/claims.ts
import * as fs3 from "node:fs";
import * as path2 from "node:path";

// src/core/internal-path.ts
import * as fs from "node:fs";
import * as path from "node:path";

// src/core/regular-file.ts
import * as fs2 from "node:fs";
var MiB = 1024 * 1024;
var TEXT_FILE_CAP = MiB;
function capText(cap) {
  return cap % MiB === 0 ? `${cap / MiB} MiB` : cap % 1024 === 0 ? `${cap / 1024} KiB` : `${cap} bytes`;
}
function readRegularFile(file, cap, opts = {}) {
  const flags = fs2.constants.O_RDONLY | fs2.constants.O_NONBLOCK | (opts.noFollow ? fs2.constants.O_NOFOLLOW : 0);
  const fd = fs2.openSync(file, flags);
  try {
    const st = fs2.fstatSync(fd);
    if (!st.isFile()) throw new Error("not a regular file");
    if (st.size > cap) throw new Error(`larger than ${capText(cap)} (${st.size} bytes)`);
    let buf = Buffer.alloc(st.size + 1);
    let n = 0;
    for (; ; ) {
      if (n === buf.length) {
        if (n > cap) throw new Error(`larger than ${capText(cap)}`);
        const grown = Buffer.alloc(Math.min(buf.length * 2, cap + 1));
        buf.copy(grown, 0, 0, n);
        buf = grown;
      }
      const r = fs2.readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
    }
    return buf.toString("utf8", 0, n);
  } finally {
    fs2.closeSync(fd);
  }
}

// src/core/kernel.ts
import * as fs4 from "node:fs";
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
var decorateFailure = (res) => res;
function setFailureDecorator(fn) {
  decorateFailure = fn;
}
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});
function parseArgs(argv, kinds, opts) {
  const aliases = opts?.aliases;
  const sameValue2 = opts?.sameValue ?? ((_name, a, b) => a === b);
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  const repeated = [];
  let options = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (options && a === "--") {
      options = false;
      continue;
    }
    if (options && a.startsWith("--")) {
      const eq = a.indexOf("=");
      const typed = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const name = aliases?.get(typed) ?? typed;
      let value = eq === -1 ? true : a.slice(eq + 1);
      if (value === true && kinds !== void 0 && Object.hasOwn(kinds, name) && kinds[name] === "string" && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        value = argv[++i];
      }
      if (flags.has(name) && !sameValue2(name, flags.get(name), value) && !repeated.some((r) => r.name === name)) {
        repeated.push({ name, typed });
      }
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional, repeated };
}
function flagString(flags, name) {
  const v = flags.get(name);
  if (v === void 0) return void 0;
  if (v === true) return fail("missing_value", `--${name} needs a value (use --${name}=\u2026 or --${name} <value>)`);
  return v;
}
function osaDistance(a, b) {
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) d.push([i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[m][n];
}
function nearestMatch(value, allowed) {
  const threshold = value.length <= 4 ? 1 : 2;
  let best = [];
  let bestDist = Infinity;
  for (const v of allowed) {
    const d = osaDistance(value, v);
    if (d < bestDist) {
      bestDist = d;
      best = [v];
    } else if (d === bestDist) best.push(v);
  }
  return bestDist <= threshold && best.length === 1 ? best[0] : null;
}

// src/core/store.ts
import * as fs6 from "node:fs";
import * as path4 from "node:path";

// src/core/touched.ts
import * as fs5 from "node:fs";
import * as path3 from "node:path";
var journal = /* @__PURE__ */ new Map();
var root = null;
function listed(rel) {
  if (rel === "" || rel.startsWith("..") || path3.isAbsolute(rel)) return false;
  if (rel === V3_INDEX_REL || rel === LEGACY_INDEX_REL || rel === ".nanojira/claims" || rel.startsWith(".nanojira/claims/")) return false;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return !base.startsWith(".nj-tmp-") && !base.startsWith(".nj-rm-");
}
function touchedFiles(backlog) {
  const rel = (abs) => path3.relative(backlog, abs).split(path3.sep).join("/");
  const out2 = [];
  for (const [abs, e] of journal) {
    const p = rel(abs);
    if (!listed(p)) continue;
    if (e.op === "moved") {
      const from = rel(e.from);
      out2.push(listed(from) ? { path: p, op: "moved", from } : { path: p, op: "created" });
    } else {
      out2.push({ path: p, op: e.op });
    }
  }
  return out2.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function failureFiles() {
  if (root === null || journal.size === 0) return void 0;
  const files = touchedFiles(root);
  return files.length > 0 ? files : void 0;
}

// src/core/store.ts
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// src/core/output.ts
function withFailureFiles(res) {
  const files = failureFiles();
  return files === void 0 ? res : Object.assign({}, res, { files });
}
setFailureDecorator(withFailureFiles);

// src/core/args.ts
var FLAG_ALIASES = /* @__PURE__ */ new Map([["depends-on", "depends_on"]]);
function sameValue(name, a, b) {
  if (a === b) return true;
  return name === "backlog" && typeof a === "string" && typeof b === "string" && a !== "" && b !== "" && path6.resolve(a) === path6.resolve(b);
}
function parseArgs2(argv, kinds) {
  return parseArgs(argv, kinds, { aliases: FLAG_ALIASES, sameValue });
}

// src/core/flag-table.ts
var str = (name) => ({ name, kind: "string" });
var bool = (name) => ({ name, kind: "boolean" });
var FLAG_TABLE = {
  list: { fields: [str("status"), str("type"), str("tag"), str("parent"), str("assignee"), str("exclude-tag"), str("min-priority")] },
  find: { fields: [
    str("status"),
    str("type"),
    str("tag"),
    str("parent"),
    str("assignee"),
    str("exclude-tag"),
    str("min-priority"),
    bool("case-sensitive"),
    { name: "text", kind: "string", positional: true }
  ] },
  show: { fields: [str("id"), str("file"), str("notes")] },
  log: { fields: [str("id"), str("file"), str("last")] },
  tree: { fields: [str("id")] },
  // Built from the same NEW_FIELDS/SETTABLE_FIELDS constants.ts and
  // cmd-new.ts/cmd-set.ts already validate against — one list, not two
  // hand-kept-in-sync copies.
  new: { fields: NEW_FIELDS.map(str) },
  // --add-tags/--remove-tags (DECISIONS 163 B): an incremental alternative
  // to --tags=, set-only, hyphenated like case-sensitive/allow-open-children
  // (no pre-existing Element field to normalise onto, unlike depends-on).
  set: { fields: [str("id"), str("file")].concat(SETTABLE_FIELDS.map(str), [str("add-tags"), str("remove-tags"), str("add-acceptance")]) },
  note: { fields: [str("id"), str("file"), str("as"), { name: "text", kind: "string", positional: true }] },
  check: { fields: [str("id"), str("file"), str("text"), str("item"), bool("on"), bool("off")] },
  claim: { fields: [str("id"), str("file"), str("as"), str("steal"), str("status")] },
  release: { fields: [str("id"), str("file"), str("as"), str("status")] },
  // No id/file (§ 12b "Not applicable"): `next` picks its own target, the
  // same reason `new` has neither.
  next: { fields: [str("as"), str("status"), str("type"), str("tag"), str("parent"), str("assignee"), str("exclude-tag"), str("min-priority")] },
  archive: { fields: [str("id"), str("file")] },
  unarchive: { fields: [str("id"), str("file")] },
  doctor: { fields: [bool("fix")] },
  // `rm` answers only `nanojira rm --help`'s question (DECISIONS 163 A) -- it is
  // never an `nanojira-mcp` tool (TOOL_NAMES omits it unconditionally, § 17),
  // and this entry does not change that.
  rm: { fields: [str("id"), str("file"), bool("cascade")] }
};
function spec(command) {
  const s = FLAG_TABLE[command];
  if (!s) throw new Error(`flag-table: unknown command '${command}'`);
  return s;
}
function cliFieldNames(command) {
  return spec(command).fields.filter((f) => !f.positional).map((f) => f.name);
}
function commandFields(command) {
  return spec(command).fields;
}

// src/core/cli-flags.ts
var OUTPUT = ["json", "quiet", "fields"];
var CLI_SPEC = {
  // Bare `nanojira` (the short status); `nanojira --help` is the general help.
  status: { fields: [], controls: ["json"], write: false },
  // `init` and `doctor` (`--fix`) are not write commands to `checkFlags`,
  // so they name `--dry-run` themselves.
  init: { fields: [], controls: ["json", "dry-run"], write: false },
  new: { fields: cliFieldNames("new"), controls: ["json", "input", "quiet", "fields"], write: true },
  // `id`/`file` stay out of "Known fields:": they address the element, they
  // are not settable fields.
  set: {
    fields: cliFieldNames("set").filter((f) => f !== "id" && f !== "file"),
    controls: ["json", "force", "allow-open-children", "check-all", "id", "file", "input", "quiet", "fields"],
    write: true
  },
  note: { fields: [], controls: [...OUTPUT, "force", "text", "text-file", ...cliFieldNames("note")], write: true },
  check: { fields: [], controls: [...OUTPUT, "force", ...cliFieldNames("check")], write: true },
  show: { fields: [], controls: ["json", "fields", ...cliFieldNames("show")], write: false },
  log: { fields: [], controls: ["json", ...cliFieldNames("log")], write: false },
  // The reads take `--fields` but no `--quiet` (DECISIONS 229).
  list: { fields: [], controls: ["json", "fields", "ready", "all", ...cliFieldNames("list")], write: false },
  find: { fields: [], controls: ["json", "fields", "all", "text", ...cliFieldNames("find")], write: false },
  tree: { fields: [], controls: ["json", "all", ...cliFieldNames("tree")], write: false },
  tags: { fields: [], controls: ["json"], write: false },
  rm: { fields: [], controls: ["json", ...cliFieldNames("rm")], write: true },
  archive: { fields: [], controls: ["json", ...cliFieldNames("archive")], write: true },
  unarchive: { fields: [], controls: ["json", ...cliFieldNames("unarchive")], write: true },
  // Only `status` in "Known fields:", as the original error text had it.
  claim: { fields: ["status"], controls: [...OUTPUT, ...cliFieldNames("claim").filter((f) => f !== "status"), "allow-open-children", "check-all"], write: true },
  // Only `status` in "Known fields:", as for claim.
  release: { fields: ["status"], controls: [...OUTPUT, ...cliFieldNames("release").filter((f) => f !== "status"), "allow-open-children"], write: true },
  next: { fields: cliFieldNames("next"), controls: [...OUTPUT], write: true },
  doctor: { fields: [], controls: ["json", "dry-run", ...cliFieldNames("doctor")], write: false }
};
var doc = (text, value) => value === void 0 ? { text } : { value, text };
var FILTER = {
  status: doc("only elements with this status", "<value>"),
  type: doc("only elements of this type", "<value>"),
  tag: doc("only elements carrying this tag", "<tag>"),
  parent: doc("only direct children of this element", "<id>"),
  assignee: doc("only elements assigned to this name", "<name>"),
  "exclude-tag": doc("leave out elements carrying any of these tags", "<a,b,...>"),
  "min-priority": doc("only elements of this priority or higher", "<value>")
};
var BATCH_ID = doc("the element to act on; A,B,C applies the same write to each", "<id>");
var FLAG_DOCS = {
  id: doc("the element to act on", "<id>"),
  file: doc("address one file of a duplicated ID, instead of --id", "<path>"),
  json: doc("print the result as JSON"),
  backlog: doc("use this backlog (else NJ_BACKLOG, else the upward search)", "<path>"),
  "dry-run": doc("run against a scratch copy; nothing is written"),
  quiet: doc("with --json: print only {ok, id, files}, plus _problems when non-empty"),
  fields: doc("with --json: keep only these entry fields, in this order", "<a,b,...>"),
  force: doc("overwrite a parallel change"),
  "allow-open-children": doc("allow the final status while children are still open"),
  "check-all": doc("with --status=<final status>: tick every open acceptance box in the same write"),
  input: doc("read the fields as one JSON object from a file, - for stdin", "<path|->"),
  as: doc("act as this name", "<name>"),
  title: doc("the title", "<text>"),
  parent: doc("the parent element", "<id>"),
  status: doc("the status to set", "<value>"),
  priority: doc("the priority", "<value>"),
  assignee: doc("the assignee", "<name>"),
  type: doc("the element type", "<value>"),
  tags: doc("the whole tag list (replaces it; empty clears it)", "<a,b,...>"),
  "add-tags": doc("add these tags, keep the others", "<a,b,...>"),
  "remove-tags": doc("remove these tags, keep the others", "<a,b,...>"),
  depends_on: doc("the whole dependency list (replaces it; empty clears it)", "<ID,...>"),
  description: doc("the Description section", "<text>"),
  "description-file": doc("the Description section from a file, - for stdin", "<path|->"),
  acceptance: doc("the Acceptance Criteria section", "<text>"),
  "acceptance-file": doc("the Acceptance Criteria section from a file, - for stdin", "<path|->"),
  "add-acceptance": doc("append one unticked Acceptance Criteria line, keep the rest", "<text>"),
  ready: doc("only elements ready to start"),
  all: doc("include archived elements")
};
var READ_FIELDS = doc("with --json: keep only these fields of every entry, in this order", "<a,b,...>");
var COMMAND_DOCS = {
  init: { backlog: doc("create the backlog at this path", "<path>") },
  new: { input: doc("read the element, or a whole plan, as JSON from a file, - for stdin", "<path|->") },
  set: { id: BATCH_ID, parent: doc("move the element under this parent", "<id>") },
  note: {
    id: BATCH_ID,
    as: doc("sign the note with this name", "<name>"),
    text: doc("the note text, instead of the positional argument", "<text>"),
    "text-file": doc("read the note text from a file, - for stdin", "<path|->")
  },
  check: {
    id: BATCH_ID,
    text: doc("the acceptance item whose text contains this", "<substring>"),
    item: doc("the n-th acceptance item, counting from 1", "<n>"),
    on: doc("tick the item (the default)"),
    off: doc("untick the item")
  },
  show: {
    id: doc("the element to show", "<id>"),
    fields: doc("with --json: keep only these fields of the entry, in this order", "<a,b,...>"),
    notes: doc("which notes to show (default all)", "none|all|last:N")
  },
  log: {
    id: doc("the element whose history to show", "<id>"),
    last: doc("show only the last N events", "<N>")
  },
  list: { ...FILTER, fields: READ_FIELDS },
  find: { ...FILTER, fields: READ_FIELDS, "case-sensitive": doc("match the text with exact case"), text: doc("the search text, instead of the positional argument", "<text>") },
  tree: { id: doc("show only this element and what is below it", "<id>") },
  rm: { cascade: doc("also remove every element below this one") },
  claim: {
    id: BATCH_ID,
    as: doc("claim as this name", "<name>"),
    steal: doc("take over the claim this holder has", "<holder>"),
    status: doc("also set this status", "<value>")
  },
  release: {
    id: BATCH_ID,
    as: doc("release the claim held under this name", "<name>"),
    status: doc("also set this status, and clear the assignee if it is this name", "<value>")
  },
  next: {
    ...FILTER,
    as: doc("claim as this name", "<name>"),
    status: doc("also set this status on the claimed element", "<value>")
  },
  doctor: {
    fix: doc("repair what can be repaired automatically"),
    "dry-run": doc("with --fix: show what would change; nothing is written")
  }
};
function flagDoc(command, name) {
  const own = Object.hasOwn(COMMAND_DOCS, command) ? COMMAND_DOCS[command] : {};
  if (Object.hasOwn(own, name)) return own[name];
  if (Object.hasOwn(FLAG_DOCS, name)) return FLAG_DOCS[name];
  return { text: "" };
}

// src/core/config.ts
import * as fs9 from "node:fs";
import * as os2 from "node:os";
import * as path7 from "node:path";

// src/core/version.ts
var VERSION = "4.6.0";
function parseVersionTuple(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareVersionTuples(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// src/core/config.ts
var TOP_LEVEL_KEYS = ["schema", "statuses", "sections", "layout", "claims", "problems", "minVersion", "ids"];
function validateConfig(obj) {
  const errs = [];
  const warnings = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { errors: ["configuration must be a JSON object"], warnings: [] };
  }
  for (const k of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.includes(k)) warnings.push({ code: "config:unknown_key", message: `unknown top-level key '${k}'` });
  }
  if (obj.schema !== void 0 && obj.schema !== 1) errs.push(`unsupported schema ${JSON.stringify(obj.schema)} (expected 1)`);
  const st = obj.statuses;
  if (!Array.isArray(st)) errs.push("statuses must be an array");
  else {
    if (st.length < 2) errs.push("statuses needs at least two entries");
    if (st.some((s) => typeof s !== "string" || !/^[a-z_]+$/.test(s))) errs.push("every status must match [a-z_]+");
    if (new Set(st).size !== st.length) errs.push("statuses must be unique");
    if (st.length > 0 && st[st.length - 1] !== "done") errs.push("the last status must be 'done'");
  }
  const sec = obj.sections;
  if (sec === null || typeof sec !== "object" || Array.isArray(sec)) errs.push("sections must be an object");
  else {
    for (const role of ["description", "acceptance"]) {
      const list = sec[role];
      if (!Array.isArray(list) || list.length === 0 || list.some((n) => typeof n !== "string" || n.trim() === "")) {
        errs.push(`sections.${role} must be a non-empty array of heading names`);
      }
    }
  }
  if (obj.layout !== void 0) {
    const r = validateLayout(obj.layout);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.claims !== void 0) {
    const r = validateClaims(obj.claims);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.problems !== void 0) {
    const r = validateProblems(obj.problems);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.ids !== void 0) {
    const r = validateIds(obj.ids);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.minVersion !== void 0 && parseVersionTuple(typeof obj.minVersion === "string" ? obj.minVersion : "") === null) {
    errs.push(`minVersion must be exactly three dot-separated non-negative integers (got ${JSON.stringify(obj.minVersion)})`);
  }
  return { errors: errs, warnings };
}
function validateProblems(p) {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return { errors: ["problems must be an object"], warnings: [] };
  const errs = [];
  const warnings = [];
  for (const k of Object.keys(p)) {
    if (k !== "ignore") warnings.push({ code: "config:unknown_key", message: `unknown key 'problems.${k}'` });
  }
  if (p.ignore !== void 0) {
    if (!Array.isArray(p.ignore) || p.ignore.some((c) => typeof c !== "string")) {
      errs.push("problems.ignore must be an array of strings");
    } else {
      for (const code of p.ignore) {
        const sev = SEVERITY[code];
        if (sev === void 0) warnings.push({ code: "config:unknown_code", message: `unknown code '${code}' in problems.ignore` });
        else if (sev !== "warning") errs.push(`problems.ignore: '${code}' is not a warning-severity code and cannot be ignored`);
      }
    }
  }
  return { errors: errs, warnings };
}
function readProblems(p) {
  if (!p || !Array.isArray(p.ignore)) return { ignore: [] };
  return { ignore: p.ignore.filter((c) => SEVERITY[c] === "warning") };
}
function validateClaims(c) {
  if (c === null || typeof c !== "object" || Array.isArray(c)) return { errors: ["claims must be an object"], warnings: [] };
  const errs = [];
  const warnings = [];
  for (const k of Object.keys(c)) {
    if (k !== "staleAfterHours") warnings.push({ code: "config:unknown_key", message: `unknown key 'claims.${k}'` });
  }
  if (c.staleAfterHours !== void 0) {
    const v = c.staleAfterHours;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      errs.push(`claims.staleAfterHours must be a non-negative integer (got ${JSON.stringify(v)})`);
    }
  }
  return { errors: errs, warnings };
}
function readClaims(c) {
  const d = DEFAULT_CONFIG.claims.staleAfterHours;
  return { staleAfterHours: c && c.staleAfterHours !== void 0 ? c.staleAfterHours : d };
}
function validateIds(c) {
  if (c === null || typeof c !== "object" || Array.isArray(c)) return { errors: ["ids must be an object"], warnings: [] };
  const errs = [];
  const warnings = [];
  for (const k of Object.keys(c)) {
    if (k !== "shardSize") warnings.push({ code: "config:unknown_key", message: `unknown key 'ids.${k}'` });
  }
  if (c.shardSize !== void 0) {
    const v = c.shardSize;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      errs.push(`ids.shardSize must be a non-negative integer (got ${JSON.stringify(v)})`);
    }
  }
  return { errors: errs, warnings };
}
function readIds(c) {
  const d = DEFAULT_CONFIG.ids.shardSize;
  return { shardSize: c && c.shardSize !== void 0 ? c.shardSize : d };
}
function validateLayout(lay) {
  if (lay === null || typeof lay !== "object" || Array.isArray(lay)) return { errors: ["layout must be an object"], warnings: [] };
  const errs = [];
  const warnings = [];
  for (const k of Object.keys(lay)) {
    if (!["group", "folders", "statusFile", "tagsFile"].includes(k)) warnings.push({ code: "config:unknown_key", message: `unknown key 'layout.${k}'` });
  }
  if (lay.group !== void 0 && !GROUPS.includes(lay.group)) {
    errs.push(`layout.group must be one of ${GROUPS.join(", ")} (got ${JSON.stringify(lay.group)})`);
  }
  if (lay.statusFile !== void 0 && typeof lay.statusFile !== "boolean") errs.push("layout.statusFile must be true or false");
  if (lay.tagsFile !== void 0 && typeof lay.tagsFile !== "boolean") errs.push("layout.tagsFile must be true or false");
  const f = lay.folders;
  if (f === void 0) return { errors: errs, warnings };
  if (f === null || typeof f !== "object" || Array.isArray(f)) {
    errs.push("layout.folders must be an object");
    return { errors: errs, warnings };
  }
  for (const k of Object.keys(f)) {
    if (!FOLDER_ROLES.includes(k)) warnings.push({ code: "config:unknown_key", message: `unknown key 'layout.folders.${k}'` });
  }
  const names = [];
  for (const role of FOLDER_ROLES) {
    const name = f[role] === void 0 ? DEFAULT_CONFIG.layout.folders[role] : f[role];
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      errs.push(`layout.folders.${role} must be a folder name matching [A-Za-z0-9][A-Za-z0-9_-]* (got ${JSON.stringify(name)})`);
      continue;
    }
    if (/^(EPIC|TSK|SUB)-\d+$/i.test(name)) errs.push(`layout.folders.${role} '${name}' has the form of an element ID`);
    if (name.toLowerCase() === "backlog") errs.push(`layout.folders.${role} must not be named '${name}'`);
    if (names.includes(name.toLowerCase())) errs.push(`layout.folders: '${name}' is used twice \u2014 folder names must be distinct`);
    names.push(name.toLowerCase());
  }
  return { errors: errs, warnings };
}
function readLayout(lay) {
  const d = DEFAULT_CONFIG.layout;
  if (lay === void 0) return { group: d.group, folders: { ...d.folders }, statusFile: d.statusFile, tagsFile: d.tagsFile };
  return {
    group: lay.group === void 0 ? d.group : lay.group,
    folders: { ...d.folders, ...lay.folders || {} },
    statusFile: lay.statusFile === void 0 ? d.statusFile : lay.statusFile,
    tagsFile: lay.tagsFile === void 0 ? d.tagsFile : lay.tagsFile
  };
}
function loadConfig(backlog, legacy) {
  const rel = legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL;
  const file = path7.join(backlog, rel);
  let raw;
  try {
    raw = readRegularFile(file, TEXT_FILE_CAP);
  } catch (e) {
    const why = e && e.code === "ENOENT" ? "is missing" : `cannot be read \u2014 ${e && e.message ? e.message : String(e)}`;
    return { config: DEFAULT_CONFIG, errors: [`${rel} ${why}`], warnings: [], needsNewerNj: null };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { config: DEFAULT_CONFIG, errors: [`${rel} is not valid JSON: ${e.message}`], warnings: [], needsNewerNj: null };
  }
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj) && typeof obj.minVersion === "string") {
    const required = parseVersionTuple(obj.minVersion);
    if (required !== null && compareVersionTuples(parseVersionTuple(VERSION), required) < 0) {
      return { config: DEFAULT_CONFIG, errors: [], warnings: [], needsNewerNj: { running: VERSION, required: obj.minVersion } };
    }
  }
  const { errors, warnings } = validateConfig(obj);
  if (errors.length > 0) return { config: DEFAULT_CONFIG, errors, warnings, needsNewerNj: null };
  return {
    config: {
      schema: 1,
      statuses: obj.statuses.slice(),
      sections: { description: obj.sections.description.slice(), acceptance: obj.sections.acceptance.slice() },
      layout: readLayout(obj.layout),
      claims: readClaims(obj.claims),
      problems: readProblems(obj.problems),
      ids: readIds(obj.ids)
    },
    errors: [],
    warnings,
    needsNewerNj: null
  };
}
var SOURCE_CODE = { flag: "invalid_backlog_flag", env: "invalid_backlog_env", njrc: "invalid_backlog_njrc" };
function sourceName(src) {
  return src.kind === "flag" ? "--backlog" : src.kind === "env" ? "NJ_BACKLOG" : src.file;
}
function holdsBacklog(dir) {
  return fs9.existsSync(path7.join(dir, V3_CONFIG_REL)) || fs9.existsSync(path7.join(dir, LEGACY_CONFIG_REL));
}
function claim(dir, src, lenient) {
  const shown = src.kind === "njrc" ? escapeInvisible(dir) : dir;
  if (!isDir(dir)) fail(SOURCE_CODE[src.kind], `no backlog at ${shown} (from ${sourceName(src)})`);
  if (lenient || holdsBacklog(dir)) return dir;
  if (fs9.existsSync(path7.join(dir, V3_DIR_REL))) {
    fail(
      "backlog_without_config",
      `${shown} exists but has no ${V3_CONFIG_REL}`,
      "run `nanojira doctor` \u2014 it tolerates the missing file and reports config:invalid"
    );
  }
  fail(
    SOURCE_CODE[src.kind],
    `no backlog at ${shown} (from ${sourceName(src)})`,
    `the directory has no ${V3_CONFIG_REL} \u2014 check the path, or run \`nanojira init\` with the same source to create a backlog there`
  );
}
function escapeInvisible(s) {
  return s.replace(/[^\x20-\x7E]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
function explicitLocation(flags) {
  const flag = flagString(flags, "backlog");
  if (flag !== void 0) {
    if (flag === "") fail("invalid_value", "--backlog must not be empty", "give a value, or leave --backlog out");
    return { dir: fromCwd(flag), src: { kind: "flag" } };
  }
  const env = process.env.NJ_BACKLOG;
  if (env !== void 0 && env !== "") return { dir: fromCwd(env), src: { kind: "env" } };
  return null;
}
function njrcLocation(dir) {
  const file = path7.join(dir, ".njrc");
  const raw = readNjrc(file);
  if (raw === null) return null;
  const value = parseNjrc(file, raw).get("backlog");
  if (value === void 0) return null;
  const expanded = value.startsWith("~/") ? path7.join(os2.homedir(), value.slice(2)) : value;
  return { dir: path7.resolve(dir, expanded), src: { kind: "njrc", file } };
}
function readNjrc(file) {
  let link;
  try {
    link = fs9.lstatSync(file);
  } catch (e) {
    return searchMiss(e, path7.dirname(file));
  }
  const bad = (reason, hint) => fail("invalid_njrc", `invalid .njrc at ${file}: ${reason}`, hint);
  checkOwner(link.uid, bad);
  njrcSwapFaultHook(path7.dirname(file));
  let fd;
  try {
    fd = fs9.openSync(file, fs9.constants.O_RDONLY | fs9.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === "ELOOP") return bad("it is a symlink loop (ELOOP)");
    if (e.code === "ENOENT") {
      let fresh;
      try {
        fresh = fs9.lstatSync(file);
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
      st = fs9.fstatSync(fd);
    } catch (e) {
      return bad(`cannot stat it -- ${e.code || e.message}`);
    }
    checkOwner(st.uid, bad);
    if (!st.isFile()) return bad(st.isDirectory() ? "it is a directory, not a file" : "it is not a regular file");
    let raw;
    try {
      raw = fs9.readFileSync(fd, "utf8");
    } catch (e) {
      return bad(`cannot read it -- ${e.code || e.message}`);
    }
    return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  } finally {
    fs9.closeSync(fd);
  }
}
function njrcSwapFaultHook(dir) {
  if (process.env.NJ_FAULT !== "njrc-swap") return;
  const marker = path7.join(dir, ".nj-fault-go");
  const deadline = Date.now() + 1e4;
  while (!fs9.existsSync(marker)) {
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
  return path7.isAbsolute(p) ? path7.resolve(p) : path7.resolve(workingDir(), p);
}
function oneLine(e) {
  const msg = e && e.message ? String(e.message) : String(e);
  return msg.split("\n")[0];
}
function findBacklog(flags, lenient) {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return claim(explicit.dir, explicit.src, lenient);
  for (let dir = workingDir(); ; dir = path7.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return claim(rc.dir, rc.src, lenient);
    const candidate = path7.join(dir, "backlog");
    if (searchIsDir(candidate)) {
      if (lenient || holdsBacklog(candidate)) return candidate;
      fail(
        "backlog_without_config",
        `${candidate} exists but has no ${V3_CONFIG_REL}`,
        "run `nanojira doctor` \u2014 it tolerates the missing file and reports config:invalid"
      );
    }
    if (path7.dirname(dir) === dir) break;
  }
  return fail(
    "no_backlog",
    `no backlog found (looked for backlog/${V3_CONFIG_REL} upward from the working directory)`,
    "run `nanojira init` to create one, or set NJ_BACKLOG"
  );
}
function isDir(p) {
  try {
    return fs9.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function searchMiss(e, dir) {
  if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return null;
  return fail("io_error", `cannot search ${dir} for a backlog: ${oneLine(e)}`);
}
function searchIsDir(p) {
  try {
    return fs9.statSync(p).isDirectory();
  } catch (e) {
    return searchMiss(e, path7.dirname(p)) ?? false;
  }
}
function isLegacyBacklog(backlog) {
  return fs9.existsSync(path7.join(backlog, LEGACY_CONFIG_REL));
}

// src/core/suggest.ts
var SYNONYMS = {
  type: {},
  status: {},
  priority: { medium: "normal" }
};
var FIELD_LABEL = { type: "types", status: "statuses", priority: "priorities" };
function suggestValue(field, value, allowed) {
  const synonym = SYNONYMS[field][value];
  if (synonym !== void 0 && allowed.includes(synonym)) return synonym;
  return nearestMatch(value, allowed);
}
function valueHint(field, value, allowed) {
  const known = `Known ${FIELD_LABEL[field]}: ${allowed.join(", ")}`;
  const suggestion = suggestValue(field, value, allowed);
  return suggestion === null ? known : `did you mean '${suggestion}'? ${known}`;
}

// src/nanojira-mcp.ts
var MODERN_VERSION = "2026-07-28";
var LEGACY_VERSION = "2025-11-25";
var META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
var SERVER_NAME = "nanojira-mcp";
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
var TOOL_DESCRIPTIONS = {
  list: "List the live elements, optionally filtered.",
  show: "Show one element in full: its fields, sections and notes.",
  find: "Find the elements whose title or sections contain a text, with the same filters as list.",
  tree: "Show the epic > task > subtask tree, or only the part below one element.",
  new: "Create an epic, task or subtask; a task needs a parent epic, a subtask a parent task.",
  set: "Change fields or sections of an element, or of several.",
  note: "Append a signed, timestamped note to an element.",
  check: "Tick or untick one acceptance criterion of an element, chosen by text or by item.",
  claim: "Claim an element for a name, optionally setting its status.",
  release: "Release a claim held under a name.",
  next: "Claim the highest-priority ready element in one call; none_ready when there is none.",
  log: "Show an element's history: creation, claims, releases and notes.",
  archive: "Move a done element and its whole subtree into the archive folder.",
  unarchive: "Move an archived element and its archived subtree back to their active places.",
  doctor: "Check the backlog and report every problem found; fix, offered only when the server allows destructive tools, repairs what it can."
};
var REQUIRED = { new: ["type", "title"], find: ["text"], note: ["text"] };
var SHRINKABLE = ["new", "set", "note", "check", "claim", "release", "next"];
var WRITES = [...SHRINKABLE, "archive", "unarchive"];
var READS_WITH_FIELDS = ["list", "find", "show"];
function toolFields(name, allowDestructive) {
  if (name === "doctor") return allowDestructive ? [...commandFields(name), { name: "dry-run", kind: "boolean" }] : [];
  const fields = commandFields(name).filter((f) => !f.name.endsWith("-file"));
  if (SHRINKABLE.includes(name)) fields.push({ name: "quiet", kind: "boolean" }, { name: "fields", kind: "string" });
  else if (READS_WITH_FIELDS.includes(name)) fields.push({ name: "fields", kind: "string" });
  if (WRITES.includes(name)) fields.push({ name: "dry-run", kind: "boolean" });
  return fields;
}
function configuredStatuses(backlog) {
  try {
    if (isLegacyBacklog(backlog)) return null;
    const { config, errors, needsNewerNj } = loadConfig(backlog);
    return errors.length === 0 && !needsNewerNj ? config.statuses : null;
  } catch {
    return null;
  }
}
function allowedValues(field, statuses) {
  if (field === "status") return statuses;
  if (field === "type") return TYPES;
  if (field === "priority" || field === "min-priority") return PRIORITIES;
  return null;
}
var MCP_TEXT = { "find.text": "the search text", "note.text": "the note text" };
function propertyDescription(tool, field) {
  const d = flagDoc(tool, field);
  const text = (MCP_TEXT[`${tool}.${field}`] ?? d.text).replace(/^with --json: /, "").replace(/--([a-z][a-z-]*)/g, "$1");
  return d.value !== void 0 && /[,|]/.test(d.value) ? `${text}: ${d.value}` : text;
}
var CALL_MARGIN_S = 60;
var KILL_GRACE_MS = 5e3;
var STDERR_DRAIN_MS = 200;
function callTimeoutMs() {
  const raw = process.env.NJ_ON_CHANGE_TIMEOUT;
  const hookS = !process.env.NJ_ON_CHANGE ? 0 : raw !== void 0 && /^[1-9][0-9]*$/.test(raw) ? Math.min(Number(raw), 86400) : 10;
  return (CALL_MARGIN_S + hookS) * 1e3;
}
function refusal(problems) {
  const first = problems[0];
  const body = { ok: false, error: first.error };
  if (first.hint !== void 0) body.hint = first.hint;
  body.problems = problems.map((p) => p.allowed === void 0 ? { field: p.field, error: p.error } : { field: p.field, error: p.error, allowed: p.allowed });
  const text = problems.map((p) => `Error: ${p.message}${p.hint !== void 0 ? "\n" + p.hint : ""}`).join("\n");
  return { content: [{ type: "text", text: JSON.stringify(body) }, { type: "text", text }], structuredContent: body, isError: true };
}
function inputSchema(name, fields, statuses) {
  const properties = {};
  for (const f of fields) {
    const p = {
      type: f.kind === "boolean" ? "boolean" : "string",
      description: propertyDescription(name, f.name)
    };
    const values = allowedValues(f.name, statuses);
    if (values) p.enum = values.slice();
    properties[f.name] = p;
  }
  const required = REQUIRED[name] ? { required: REQUIRED[name].slice() } : {};
  return { type: "object", properties, ...required, additionalProperties: false };
}
function buildToolList(allowDestructive, backlog) {
  const statuses = configuredStatuses(backlog);
  return TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: inputSchema(name, toolFields(name, allowDestructive), statuses)
  }));
}
var KNOWN_STARTUP_FLAGS = ["backlog", "allow-destructive", "version"];
var KNOWN_STARTUP_HINT = `Known: ${KNOWN_STARTUP_FLAGS.map((f) => "--" + f).join(", ")}`;
function rejectStartup(message) {
  process.stderr.write(`nanojira-mcp: ${message} ${KNOWN_STARTUP_HINT}
`);
  process.exit(1);
}
function main() {
  const argv = parseArgs2(process.argv.slice(2), { backlog: "string", "allow-destructive": "boolean", version: "boolean" });
  for (const name of argv.flags.keys()) {
    if (!KNOWN_STARTUP_FLAGS.includes(name)) rejectStartup(`unknown argument '--${name}'.`);
  }
  if (argv.positional.length > 0) rejectStartup(`unknown argument '${argv.positional[0]}'.`);
  if (argv.flags.has("version")) {
    const others = Array.from(argv.flags.keys()).filter((k) => k !== "version");
    if (others.length > 0) rejectStartup(`--version takes no other argument (got '--${others[0]}').`);
    process.stdout.write(`nanojira-mcp ${VERSION}
`);
    process.exit(0);
  }
  const allowDestructive = argv.flags.has("allow-destructive");
  let backlog;
  try {
    backlog = findBacklog(argv.flags, false);
  } catch (e) {
    process.stderr.write(`nanojira-mcp: ${e instanceof Fail ? e.message : String(e)}
`);
    process.exit(1);
  }
  const njPath = path8.join(path8.dirname(path8.resolve(process.argv[1])), "nanojira.mjs");
  const liveChildren = /* @__PURE__ */ new Set();
  const timeoutMs = callTimeoutMs();
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
    const problems = [];
    for (const key of REQUIRED[name] || []) {
      if (!(key in args)) problems.push({ field: key, error: "missing_argument", message: `tool '${name}' requires '${key}'` });
    }
    const statuses = configuredStatuses(backlog);
    for (const f of fields) {
      const values = f.name in args ? allowedValues(f.name, statuses) : null;
      if (values && !values.includes(args[f.name])) {
        problems.push({
          field: f.name,
          error: "invalid_value",
          allowed: values.slice(),
          message: `'${f.name}' must be one of: ${values.join(", ")} (got ${JSON.stringify(args[f.name])})`,
          hint: valueHint(f.name === "min-priority" ? "priority" : f.name, String(args[f.name]), values)
        });
      }
    }
    if (problems.length > 0) {
      respond(id, refusal(problems));
      return;
    }
    const flagArgs = [];
    for (const f of fields) {
      if (!(f.name in args)) continue;
      const v = args[f.name];
      if (f.kind === "boolean") {
        if (v) flagArgs.push(`--${f.name}`);
        continue;
      }
      flagArgs.push(`--${f.name}=${v}`);
    }
    const childArgv = [njPath, name, ...flagArgs, `--backlog=${backlog}`, "--json"];
    const child = spawn(process.execPath, childArgv, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    liveChildren.add(child);
    let out2 = "";
    let err = "";
    let answered = false;
    let finished = false;
    let grace;
    let drain;
    const answer = (fn) => {
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
      answer(() => respondError(id, -32603, `Internal error: nanojira did not finish within ${timeoutMs / 1e3} s; killed`));
      try {
        child.kill("SIGTERM");
      } catch {
      }
      grace = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out2 += c;
    });
    child.stderr.on("data", (c) => {
      if (!answered) err += c;
    });
    child.on("error", (e) => {
      answer(() => respondError(id, -32603, `Internal error: failed to spawn nanojira: ${e.message}`));
      done();
    });
    let exitCode;
    let stdoutEnded = false;
    let stderrEnded = false;
    const settle = () => {
      if (exitCode === void 0 || !stdoutEnded || finished) return;
      if (!stderrEnded && !drain) {
        drain = setTimeout(() => {
          stderrEnded = true;
          settle();
        }, STDERR_DRAIN_MS);
        return;
      }
      if (!stderrEnded) return;
      complete(exitCode);
    };
    child.on("exit", (code) => {
      exitCode = code;
      settle();
    });
    child.stdout.on("end", () => {
      stdoutEnded = true;
      settle();
    });
    child.stderr.on("end", () => {
      stderrEnded = true;
      settle();
    });
    child.on("close", (code) => {
      exitCode = exitCode === void 0 ? code : exitCode;
      stdoutEnded = true;
      stderrEnded = true;
      settle();
    });
    const complete = (code) => {
      answer(() => {
        let parsed = null;
        try {
          parsed = JSON.parse(out2);
        } catch {
        }
        if (parsed === null) {
          respondError(id, -32603, `Internal error: nanojira exited ${code} without parsable --json output: ${err.slice(0, 500)}`);
          return;
        }
        const isError = code !== 0;
        const content = [{ type: "text", text: JSON.stringify(parsed) }];
        if (isError && err.trim() !== "") content.push({ type: "text", text: err.trim().slice(0, 4e3) });
        respond(id, { content, structuredContent: parsed, isError });
      });
      done();
    };
  }
  function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }
    const isObject = msg !== null && typeof msg === "object" && !Array.isArray(msg);
    if (!isObject || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      respondError(isObject && "id" in msg ? msg.id : null, -32600, "Invalid Request");
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
        respond(id, { tools: buildToolList(allowDestructive, backlog) });
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
  let stdinEnded = false;
  function exitWhenIdle() {
    if (stdinEnded && liveChildren.size === 0) process.stdout.write("", () => process.exit(0));
  }
  process.stdin.on("end", () => {
    stdinEnded = true;
    exitWhenIdle();
  });
}
main();
