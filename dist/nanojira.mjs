#!/usr/bin/env node

// src/core/args.ts
import * as fs4 from "node:fs";

// src/core/constants.ts
var TYPE_PREFIX = { epic: "EPIC", task: "TSK", subtask: "SUB" };
var PREFIX_TYPE = { EPIC: "epic", TSK: "task", SUB: "subtask" };
var TYPES = ["epic", "task", "subtask"];
var PARENT_TYPE = { task: "epic", subtask: "task" };
var PRIORITIES = ["low", "normal", "high", "urgent"];
var PRIORITY_WEIGHT = { urgent: 4, high: 3, normal: 2, low: 1 };
var FIELD_ORDER = [
  "id",
  "type",
  "parent",
  "title",
  "status",
  "priority",
  "assignee",
  "tags",
  "depends_on",
  "created",
  "updated",
  "archived"
];
var LIST_FIELDS = /* @__PURE__ */ new Set(["tags", "depends_on"]);
var SECTION_ROLES = ["description", "acceptance"];
var SECTION_FLAGS = ["description", "description-file", "acceptance", "acceptance-file"];
var SETTABLE_FIELDS = ["title", "parent", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var NEW_FIELDS = ["type", "parent", "title", "status", "priority", "assignee", "tags", "depends_on"].concat(SECTION_FLAGS);
var ENTRY_FIELDS = [
  "id",
  "type",
  "parent",
  "title",
  "status",
  "priority",
  "assignee",
  "tags",
  "depends_on",
  "created",
  "updated",
  "archived",
  "file",
  "_problems",
  "_claim"
];
var TYPE_FOLDER_ROLE = { epic: "epics", task: "tasks", subtask: "subtasks" };
var FOLDER_ROLES = ["epics", "tasks", "subtasks", "archive"];
var GROUPS = ["type", "hierarchy", "flat"];
var V3_DIR_REL = ".nanojira";
var V3_CONFIG_REL = ".nanojira/config.json";
var V3_IDS_REL = ".nanojira/ids";
var V3_INDEX_REL = ".nanojira/index.json";
var LEGACY_CONFIG_REL = ".nanojira.json";
var LEGACY_IDS_REL = ".ids";
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
var IDS_BUCKET_PAD = 6;
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
  "backlog:claims_unignored": "warning",
  "acceptance:no_checkbox": "warning",
  "done:no_acceptance": "warning",
  "done:open_acceptance": "warning",
  "config:unknown_key": "warning",
  "config:unknown_code": "warning"
};
var BLOCKS_READY = /* @__PURE__ */ new Set([
  "frontmatter:unreadable",
  "file:unreadable",
  "duplicate_id",
  "missing:title",
  "id:mismatch",
  "type:folder",
  "layout:misplaced",
  "parent:dangling",
  "parent:cycle",
  "parent:hierarchy",
  "depends_on:dangling",
  "depends_on:cycle",
  "unknown:status",
  "done:open_children",
  "archive:not_done",
  "archive:split",
  "incomplete:description",
  "incomplete:acceptance"
]);
var BACKLOG_LEVEL = /* @__PURE__ */ new Set(["backlog:stray_tmp", "backlog:ids_missing", "backlog:unreadable_dir", "config:invalid", "config:unknown_key", "config:unknown_code"]);

// src/core/dry-run.ts
import * as fs3 from "node:fs";
import * as os from "node:os";
import * as path3 from "node:path";

// src/core/claims.ts
import * as fs from "node:fs";
import * as path from "node:path";
var ROUNDS = 100;
function claimsRootDir(backlog) {
  return path.join(backlog, ".nanojira", "claims");
}
function claimsDir(backlog, id) {
  return path.join(claimsRootDir(backlog), id);
}
function allClaimDirs(backlog) {
  let names;
  try {
    names = fs.readdirSync(claimsRootDir(backlog));
  } catch {
    return [];
  }
  return names.filter((n) => !n.startsWith(".")).map((n) => ({ id: n, dir: claimsDir(backlog, n) }));
}
function highestEntry(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => b - a);
  for (const g of gens) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, String(g)), "utf8");
    } catch {
      continue;
    }
    const [kind, name, time] = raw.split("\n");
    if (kind !== "claimed" && kind !== "released") continue;
    return { gen: g, kind, name, time };
  }
  return null;
}
function allEntriesAscending(backlog, id) {
  const dir = claimsDir(backlog, id);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
  const entries = [];
  for (const g of gens) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, String(g)), "utf8");
    } catch {
      continue;
    }
    const [kind, name, time] = raw.split("\n");
    if (kind !== "claimed" && kind !== "released") continue;
    entries.push({ gen: g, kind, name, time });
  }
  return entries;
}
var rootExistsCache = null;
function claimsRootExists(backlog) {
  if (rootExistsCache && rootExistsCache.backlog === backlog) return rootExistsCache.exists;
  const exists = fs.existsSync(claimsRootDir(backlog));
  rootExistsCache = { backlog, exists };
  return exists;
}
function readClaim(backlog, id) {
  if (!claimsRootExists(backlog)) return null;
  const h = highestEntry(claimsDir(backlog, id));
  return h && h.kind === "claimed" ? { by: h.name, since: h.time } : null;
}
function isClaimStale(since, staleAfterHours, nowMs2) {
  if (staleAfterHours <= 0) return false;
  const ageHours = (nowMs2 - Date.parse(since)) / 36e5;
  return ageHours > staleAfterHours;
}
function appendEntry(dir, baseGen, kind, name, time) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const content = `${kind}
${name}
${time}
`;
  const fd = fs.openSync(tmp, "wx");
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
    }
  }
  try {
    fs.linkSync(tmp, path.join(dir, String(baseGen + 1)));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
    }
    if (e.code === "EEXIST") return "eexist";
    if (e.code === "ENOENT") return "enoent";
    throw e;
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
  }
  return "ok";
}
function transition(backlog, id, time, decide) {
  const dir = claimsDir(backlog, id);
  for (let round = 0; round < ROUNDS; round++) {
    const h = highestEntry(dir);
    const d = decide(h);
    if ("terminal" in d) return { ok: false, terminal: d.holder ? "refused" : "noop", holder: d.holder };
    const baseGen = h ? h.gen : 0;
    const r = appendEntry(dir, baseGen, d.append.kind, d.append.name, time);
    if (r === "ok") return { ok: true, gen: baseGen + 1, base: h };
  }
  return { ok: false, terminal: "changed_in_parallel" };
}
function rollback(backlog, id, fromGen, kind, name, time) {
  const dir = claimsDir(backlog, id);
  let gen = fromGen;
  for (let round = 0; round < ROUNDS; round++) {
    const r = appendEntry(dir, gen, kind, name, time);
    if (r === "ok" || r === "eexist") return;
    const h = highestEntry(dir);
    gen = h ? h.gen : 0;
  }
}
function removeClaimDirWholesale(backlog, id) {
  const dir = claimsDir(backlog, id);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (/^\d+$/.test(n)) {
      try {
        fs.unlinkSync(path.join(dir, n));
      } catch {
      }
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
  }
}
function releaseUnconditional(backlog, id, time) {
  const decide = (h) => {
    const held = h && h.kind === "claimed" ? h.name : null;
    if (held === null) return { terminal: true };
    return { append: { kind: "released", name: held } };
  };
  const t = transition(backlog, id, time, decide);
  return t.ok ? { gen: t.gen, holder: t.base.name } : void 0;
}
function undoRelease(backlog, id, holder, time) {
  const dir = claimsDir(backlog, id);
  const h = highestEntry(dir);
  rollback(backlog, id, h ? h.gen : 0, "claimed", holder, time);
}

// src/core/parse.ts
function readQuoted(raw, i) {
  let out2 = "";
  i++;
  for (; ; ) {
    if (i >= raw.length) throw new Error("unterminated quoted value");
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n !== '"' && n !== "\\") throw new Error(`invalid escape '\\${n === void 0 ? "" : n}'`);
      out2 += n;
      i += 2;
      continue;
    }
    if (c === '"') return { value: out2, next: i + 1 };
    out2 += c;
    i++;
  }
}
function parseList(raw) {
  const items = [];
  let i = 1;
  let closed = false;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    if (raw[i] === "]") {
      i++;
      closed = true;
      break;
    }
    if (raw[i] === '"') {
      const r = readQuoted(raw, i);
      items.push(r.value);
      i = r.next;
    } else {
      const start = i;
      while (i < raw.length && raw[i] !== "," && raw[i] !== "]") i++;
      items.push(raw.slice(start, i).trim());
    }
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    if (raw[i] === ",") {
      i++;
      continue;
    }
    if (raw[i] === "]") {
      i++;
      closed = true;
      break;
    }
    throw new Error(`unexpected character '${raw[i]}' in list`);
  }
  if (!closed) throw new Error("list is not closed by ']'");
  if (raw.slice(i).trim() !== "") throw new Error("trailing characters after list");
  return items;
}
function parseValue(raw, isListField) {
  let value;
  if (raw.startsWith("[")) {
    value = parseList(raw);
  } else if (raw.startsWith('"')) {
    const r = readQuoted(raw, 0);
    if (raw.slice(r.next).trim() !== "") throw new Error("trailing characters after quoted value");
    value = r.value;
  } else {
    value = raw;
  }
  if (isListField && !Array.isArray(value)) {
    const s = String(value).trim();
    value = s === "" ? [] : [s];
  }
  return value;
}
function quote(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function serializeScalar(v) {
  const s = String(v).replace(/[\r\n]+/g, " ");
  if (s === "" || s.startsWith("[") || s.startsWith('"')) return quote(s);
  return s;
}
function serializeItem(v) {
  const s = String(v).replace(/[\r\n]+/g, " ");
  if (s === "" || s.includes(",") || s.includes("]") || s.startsWith('"') || s !== s.trim()) return quote(s);
  return s;
}
function serializeValue(v) {
  if (Array.isArray(v)) return "[" + v.map(serializeItem).join(", ") + "]";
  return serializeScalar(v);
}
function isEmptyValue(v) {
  if (v === void 0 || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v) === "";
}
function parseFile(rawText) {
  let text = rawText;
  if (text.charCodeAt(0) === 65279) text = text.slice(1);
  text = text.replace(/\r\n/g, "\n");
  const problems = [];
  const fields = /* @__PURE__ */ new Map();
  const order = [];
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    problems.push({ code: "frontmatter:unreadable", line: 1, message: "no '---' on line 1" });
    return { fields, order, body: text, problems, parsed: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    problems.push({ code: "frontmatter:unreadable", line: 1, message: "frontmatter is not closed by '---'" });
    return { fields, order, body: lines.slice(1).join("\n"), problems, parsed: false };
  }
  for (let i = 1; i < end; i++) {
    const ln = lines[i];
    if (ln.trim() === "") continue;
    if (ln[0] === "#") continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):([\s\S]*)$/.exec(ln);
    if (!m) {
      problems.push({ code: "frontmatter:unreadable", line: i + 1, message: `cannot parse line: ${ln}` });
      continue;
    }
    const key = m[1];
    let rawVal = m[2];
    if (rawVal.startsWith(" ")) rawVal = rawVal.slice(1);
    if (fields.has(key)) {
      problems.push({ code: "frontmatter:unreadable", line: i + 1, message: `duplicate key '${key}'` });
      continue;
    }
    let value;
    try {
      value = parseValue(rawVal, LIST_FIELDS.has(key));
    } catch (e) {
      problems.push({ code: "frontmatter:unreadable", line: i + 1, message: `${key}: ${e.message}` });
      continue;
    }
    fields.set(key, value);
    order.push(key);
  }
  return { fields, order, body: lines.slice(end + 1).join("\n"), problems, parsed: true };
}
function serialize(fields, order, body) {
  const out2 = ["---"];
  const written = /* @__PURE__ */ new Set();
  for (const k of FIELD_ORDER) {
    written.add(k);
    if (!fields.has(k)) continue;
    const v = fields.get(k);
    if (isEmptyValue(v)) continue;
    out2.push(k + ": " + serializeValue(v));
  }
  for (const k of order) {
    if (written.has(k)) continue;
    written.add(k);
    if (!fields.has(k)) continue;
    out2.push(k + ": " + serializeValue(fields.get(k)));
  }
  out2.push("---");
  return out2.join("\n") + "\n" + body;
}
function h1Of(body) {
  const lines = body.split("\n");
  for (const ln of lines) {
    if (ln.trim() === "") continue;
    const m = /^#(?!#)[ \t]*(.*?)[ \t]*$/.exec(ln);
    return m ? m[1] : null;
  }
  return null;
}
function syncH1(body, title) {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (/^#(?!#)/.test(lines[i])) {
      lines[i] = "# " + title;
      return lines.join("\n");
    }
    return body;
  }
  return body;
}
function sectionPresent(body, names) {
  const want = names.map((n) => String(n).trim().toLowerCase());
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1].replace(/:\s*$/, "").trim().toLowerCase();
    if (!want.includes(name)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,2}[ \t]/.test(lines[j])) break;
      if (lines[j].trim() !== "") return true;
    }
  }
  return false;
}
function normalizeTitle(t) {
  return String(t).replace(/[\r\n]+/g, " ").trim();
}
function sectionHeadingIndex(lines, names) {
  const want = names.map((n) => String(n).trim().toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    if (want.includes(m[1].replace(/:\s*$/, "").trim().toLowerCase())) return i;
  }
  return -1;
}
var CHECKBOX_RE = /^([ \t]*)(-|\*|\+|\d+\.|\d+\))\ \[( |x|X)\](.*)$/;
function sectionEnd(lines, headingIdx) {
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}[ \t]/.test(lines[i])) return i;
  }
  return lines.length;
}
function sectionHasCheckbox(body, names) {
  const lines = body.split("\n");
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return false;
  const end = sectionEnd(lines, idx);
  let fence = null;
  for (let i = idx + 1; i < end; i++) {
    const line = lines[i];
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) fence = null;
      continue;
    }
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length };
      continue;
    }
    if (CHECKBOX_RE.test(line)) return true;
  }
  return false;
}
function sectionCheckboxCounts(body, names) {
  const lines = body.split("\n");
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return null;
  const end = sectionEnd(lines, idx);
  let fence = null;
  let total = 0;
  let unticked = 0;
  for (let i = idx + 1; i < end; i++) {
    const line = lines[i];
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) fence = null;
      continue;
    }
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length };
      continue;
    }
    const m = CHECKBOX_RE.exec(line);
    if (m) {
      total++;
      if (m[3] === " ") unticked++;
    }
  }
  return { total, unticked };
}
function normalizeSectionContent(raw) {
  let t = String(raw);
  if (t.charCodeAt(0) === 65279) t = t.slice(1);
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return t.replace(/\n+$/, "");
}
function sectionInsertPoint(lines, role, cfg) {
  if (role === "description") {
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i < lines.length && /^#(?!#)/.test(lines[i])) i++;
    while (i < lines.length && lines[i].trim() === "") i++;
    return i;
  }
  const notes = sectionHeadingIndex(lines, ["Notes"]);
  if (notes !== -1) return notes;
  const desc = sectionHeadingIndex(lines, cfg.sections.description);
  if (desc !== -1) return sectionEnd(lines, desc);
  return lines.length;
}
function writeSection(body, role, cfg, content) {
  const names = cfg.sections[role];
  const lines = body.split("\n");
  const contentLines = content === "" ? [] : content.split("\n");
  const at = sectionHeadingIndex(lines, names);
  if (at !== -1) {
    lines.splice(at + 1, sectionEnd(lines, at) - at - 1, ...contentLines, "");
  } else {
    lines.splice(sectionInsertPoint(lines, role, cfg), 0, `## ${names[0]}`, ...contentLines, "");
  }
  return lines.join("\n");
}
function applySections(body, wanted, cfg) {
  const changed = [];
  let result = body;
  for (const role of SECTION_ROLES) {
    if (!wanted.has(role)) continue;
    const next = writeSection(result, role, cfg, wanted.get(role));
    if (next !== result) {
      result = next;
      changed.push(role);
    }
  }
  return { body: result, changed };
}
var NOTE_LINE_RE = /^-\ (\S+)\ (.*)$/;
function parseNotes(body) {
  const lines = body.split("\n");
  const notes = [];
  let inNotes = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,2}[ \t]/.test(line)) {
      const h2 = /^##[ \t]+(.*?)[ \t]*$/.exec(line);
      inNotes = !!h2 && h2[1].replace(/:\s*$/, "").trim().toLowerCase() === "notes";
      i++;
      continue;
    }
    if (!inNotes) {
      i++;
      continue;
    }
    const m = NOTE_LINE_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const idx = m[2].indexOf(": ");
    if (idx === -1) {
      i++;
      continue;
    }
    const actor = m[2].slice(0, idx);
    const parts = [m[2].slice(idx + 2)];
    let j = i + 1;
    while (j < lines.length && (lines[j] === "" || lines[j].startsWith("  "))) {
      parts.push(lines[j] === "" ? "" : lines[j].slice(2));
      j++;
    }
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    notes.push({ at: m[1], actor, text: parts.join("\n") });
    i = j;
  }
  return notes;
}
function renderNoteLine(ts, signer, text) {
  const [first, ...rest] = text.split("\n");
  return [`- ${ts} ${signer}: ${first}`, ...rest.map((l) => l === "" ? "  " : `  ${l}`)].join("\n");
}
function notesSectionBounds(lines) {
  let headingLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (m && m[1].replace(/:\s*$/, "").trim().toLowerCase() === "notes") headingLine = i;
  }
  if (headingLine === -1) return null;
  let endLine = lines.length;
  for (let j = headingLine + 1; j < lines.length; j++) {
    if (/^#{1,2}[ \t]/.test(lines[j])) {
      endLine = j;
      break;
    }
  }
  return { headingLine, endLine };
}

// src/core/store.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
function pinnedNow() {
  const pinned = process.env.NJ_NOW;
  if (pinned === void 0 || pinned === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
    fail("invalid_env", `invalid NJ_NOW '${pinned}' (expected ISO-8601 UTC, e.g. 2026-09-21T18:02:44Z)`);
  }
  return pinned;
}
function checkClockEnv() {
  pinnedNow();
}
function nowIso() {
  return pinnedNow() ?? (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function nowMs() {
  return Date.parse(nowIso());
}
function mtimeIso(file) {
  try {
    return new Date(fs2.statSync(file).mtime).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function readTombstones(dir, shardSize) {
  const out2 = /* @__PURE__ */ new Set();
  if (!shardSize) {
    let names;
    try {
      names = fs2.readdirSync(dir);
    } catch {
      return out2;
    }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      out2.add(n);
    }
    return out2;
  }
  let types;
  try {
    types = fs2.readdirSync(dir);
  } catch {
    return out2;
  }
  for (const t of types) {
    if (t.startsWith(".")) continue;
    const typeDir = path2.join(dir, t);
    let buckets;
    try {
      buckets = fs2.readdirSync(typeDir);
    } catch {
      continue;
    }
    for (const b of buckets) {
      if (b.startsWith(".")) continue;
      let names;
      try {
        names = fs2.readdirSync(path2.join(typeDir, b));
      } catch {
        continue;
      }
      for (const n of names) if (!n.startsWith(".")) out2.add(n);
    }
  }
  return out2;
}
function bucketName(n, shardSize) {
  const b = Math.floor(n / shardSize);
  const s = String(b).padStart(IDS_BUCKET_PAD, "0");
  if (s.length > IDS_BUCKET_PAD) {
    return hardExit(
      "id_allocation_failed",
      `nanojira: bucket ${b} (for id number ${n}, ids.shardSize=${shardSize}) needs more than ${IDS_BUCKET_PAD} digits \u2014 this is a hard limit`
    );
  }
  return s;
}
var TOMBSTONE_ID_RE = /^(EPIC|TSK|SUB)-(\d+)$/;
function tombstoneLocation(idsDir, id, shardSize) {
  if (!shardSize) return { dir: idsDir, file: path2.join(idsDir, id) };
  const m = TOMBSTONE_ID_RE.exec(id);
  const prefix = m ? m[1] : id;
  const n = m ? parseInt(m[2], 10) : 0;
  const dir = path2.join(idsDir, prefix, bucketName(n, shardSize));
  return { dir, file: path2.join(dir, id) };
}
function highestShardedMax(idsDir, prefix) {
  const typeDir = path2.join(idsDir, prefix);
  let buckets;
  try {
    buckets = fs2.readdirSync(typeDir).filter((b) => !b.startsWith("."));
  } catch {
    return 0;
  }
  if (buckets.length === 0) return 0;
  buckets.sort();
  const hi = buckets[buckets.length - 1];
  let names;
  try {
    names = fs2.readdirSync(path2.join(typeDir, hi));
  } catch {
    return 0;
  }
  const re = new RegExp("^" + prefix + "-(\\d+)$");
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max;
}
function allocateId(idsDir, type, elements, shardSize) {
  const prefix = TYPE_PREFIX[type];
  fs2.mkdirSync(idsDir, { recursive: true });
  let max = 0;
  const consider = (id) => {
    const m = new RegExp("^" + prefix + "-(\\d+)$").exec(id);
    if (m) {
      const n2 = parseInt(m[1], 10);
      if (n2 > max) max = n2;
    }
  };
  if (shardSize) max = highestShardedMax(idsDir, prefix);
  else for (const t of readTombstones(idsDir)) consider(t);
  for (const el of elements) consider(el.id);
  let n = max + 1;
  for (let i = 0; i < 100; i++) {
    const id = prefix + "-" + String(n).padStart(3, "0");
    const { dir, file } = tombstoneLocation(idsDir, id, shardSize);
    if (dir !== idsDir) fs2.mkdirSync(dir, { recursive: true });
    try {
      fs2.closeSync(fs2.openSync(file, "wx"));
      return id;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      n++;
    }
  }
  return hardExit("id_allocation_failed", `nanojira: id allocation failed after 100 retries (${prefix})`);
}
function atomicWrite(target, content) {
  const dir = path2.dirname(target);
  const tmp = path2.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const fault = process.env.NJ_FAULT;
  const fd = fs2.openSync(tmp, "wx");
  try {
    fs2.writeFileSync(fd, content, "utf8");
    if (fault === "after-tmp-write") {
      fs2.closeSync(fd);
      hardExit("fault:after-tmp-write", "nanojira: aborted at fault injection point after-tmp-write");
    }
    fs2.fsyncSync(fd);
  } finally {
    try {
      fs2.closeSync(fd);
    } catch {
    }
  }
  if (fault === "before-rename") {
    hardExit("fault:before-rename", "nanojira: aborted at fault injection point before-rename");
  }
  fs2.renameSync(tmp, target);
}
function mirrorWrite(target, content) {
  const dir = path2.dirname(target);
  const tmp = path2.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const fault = process.env.NJ_FAULT;
  const fd = fs2.openSync(tmp, "wx");
  try {
    fs2.writeFileSync(fd, content, "utf8");
    if (fault === "after-tmp-write") {
      fs2.closeSync(fd);
      fail("fault:after-tmp-write", "nanojira: aborted at fault injection point after-tmp-write");
    }
    fs2.fsyncSync(fd);
  } finally {
    try {
      fs2.closeSync(fd);
    } catch {
    }
  }
  if (fault === "before-rename") {
    fail("fault:before-rename", "nanojira: aborted at fault injection point before-rename");
  }
  fs2.renameSync(tmp, target);
}
function atomicReplace(target, content) {
  const tmp = path2.join(path2.dirname(target), `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  try {
    const fd = fs2.openSync(tmp, "wx");
    try {
      fs2.writeFileSync(fd, content, "utf8");
      fs2.fsyncSync(fd);
    } finally {
      fs2.closeSync(fd);
    }
    fs2.renameSync(tmp, target);
  } catch (e) {
    try {
      fs2.unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
}
function compareGuard(el, force, backlog, hint, catchable) {
  if (process.env.NJ_FAULT === "before-compare" && backlog) {
    const marker = path2.join(backlog, ".nj-fault-go");
    const ready = process.env.NJ_FAULT_READY;
    if (ready) {
      try {
        fs2.writeFileSync(ready, el.id + "\n");
      } catch (e) {
        const msg = `nanojira: before-compare could not write NJ_FAULT_READY ${ready}: ${e.message}`;
        if (catchable) fail("fault:before-compare", msg);
        hardExit("fault:before-compare", msg);
      }
    }
    const deadline = Date.now() + 1e4;
    while (!fs2.existsSync(marker)) {
      if (Date.now() >= deadline) {
        const msg = "nanojira: before-compare timed out after 10s waiting for .nj-fault-go";
        if (catchable) fail("fault:before-compare", msg);
        hardExit("fault:before-compare", msg);
      }
      sleepMs(50);
    }
  }
  if (force) return;
  let current;
  try {
    current = fs2.readFileSync(el.file, "utf8");
  } catch {
    current = null;
  }
  if (current !== el.raw) {
    fail(
      "changed_in_parallel",
      `${el.id} changed in parallel, please run again`,
      hint === void 0 ? "use --force to overwrite deliberately" : hint
    );
  }
}
function guardedWrite(el, content, force, backlog) {
  compareGuard(el, force, backlog);
  atomicWrite(el.file, content);
}
function guardedWriteCatchable(el, content, force, backlog) {
  compareGuard(el, force, backlog, void 0, true);
  mirrorWrite(el.file, content);
}
function planMove(src, dst) {
  const plan = { renames: [], emptied: [], conflicts: [] };
  const visit = (from, to) => {
    let target;
    try {
      target = fs2.lstatSync(to);
    } catch (e) {
      if (e.code === "ENOENT") {
        plan.renames.push([from, to]);
        return;
      }
      plan.conflicts.push(to);
      return;
    }
    let source;
    try {
      source = fs2.lstatSync(from);
    } catch {
      plan.conflicts.push(to);
      return;
    }
    if (target.dev === source.dev && target.ino === source.ino) return;
    if (!target.isDirectory() || !source.isDirectory()) {
      plan.conflicts.push(to);
      return;
    }
    for (const n of fs2.readdirSync(from).sort()) visit(path2.join(from, n), path2.join(to, n));
    plan.emptied.push(from);
  };
  visit(src, dst);
  return plan;
}
function runMove(plan) {
  for (const [from, to] of plan.renames) {
    fs2.mkdirSync(path2.dirname(to), { recursive: true });
    fs2.renameSync(from, to);
  }
  for (const dir of plan.emptied) {
    try {
      fs2.rmdirSync(dir);
    } catch {
    }
  }
}
function renderElement(el, fieldOverrides, bodyOverride) {
  const fields = new Map(el.fields);
  for (const [k, v] of fieldOverrides) {
    if (v === void 0) fields.delete(k);
    else fields.set(k, v);
  }
  const order = el.order.slice();
  for (const k of fields.keys()) if (!order.includes(k)) order.push(k);
  return serialize(fields, order, bodyOverride === void 0 ? el.body : bodyOverride);
}

// src/core/derive.ts
function elementProblems(el, ignore = []) {
  return Array.from(el.problems).filter((c) => !BACKLOG_LEVEL.has(c) && !ignore.includes(c)).sort();
}
function hasError(el) {
  return elementProblems(el).some((c) => SEVERITY[c] === "error");
}
function isIncomplete(el) {
  if (hasError(el)) return false;
  return elementProblems(el).some((c) => c.startsWith("incomplete:"));
}
function isReady(el, cfg) {
  if (el.archived) return false;
  if (el.status !== cfg.statuses[0]) return false;
  for (const c of el.problems) if (BLOCKS_READY.has(c)) return false;
  for (const dep of el.depends_on) {
    const t = el.byId.get(dep);
    if (!t) return false;
    if (t.archived) continue;
    if (t.status !== "done") return false;
    if (t.problems.has("done:open_children")) return false;
  }
  return true;
}
function hasOpenChild(el) {
  return el.children.some((c) => !c.archived && c.status !== "done");
}
function idSortKey(id) {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(id);
  return m ? [m[1], parseInt(m[2], 10), ""] : ["\uFFFF", 0, id];
}
function priorityWeight(p) {
  const w = PRIORITY_WEIGHT[p];
  return w === void 0 ? PRIORITY_WEIGHT.normal : w;
}
function compareElements(a, b) {
  const w = priorityWeight(b.priority) - priorityWeight(a.priority);
  if (w !== 0) return w;
  const ka = idSortKey(a.id);
  const kb = idSortKey(b.id);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}
function entryJson(el, backlog, cfg) {
  const e = { id: el.id, type: el.type };
  if (el.parent !== null) e.parent = el.parent;
  e.title = el.title;
  e.status = el.status;
  e.priority = el.priority;
  if (el.assignee !== "") e.assignee = el.assignee;
  e.tags = el.tags;
  e.depends_on = el.depends_on;
  e.created = el.created;
  e.updated = el.updated;
  if (el.archivedAt !== null) e.archived = el.archivedAt;
  e.file = el.file;
  const claim2 = readClaim(backlog, el.id);
  const probs = elementProblems(el, cfg.problems.ignore);
  if (claim2 && isClaimStale(claim2.since, cfg.claims.staleAfterHours, nowMs())) probs.push("claim:stale");
  e._problems = probs.sort();
  e._claim = claim2;
  return e;
}
function countsOf(scope, backlogErrors = 0) {
  return {
    total: scope.length,
    errors: scope.filter(hasError).length + backlogErrors,
    incomplete: scope.filter(isIncomplete).length
  };
}
function openAcceptanceExtra(el, cfg, isFinal) {
  if (!isFinal) return {};
  if (!elementProblems(el, cfg.problems.ignore).includes("done:open_acceptance")) return {};
  const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
  return counts ? { open_acceptance: counts } : {};
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
var output = { json: false };
function hardExit(code, message) {
  process.stderr.write(message + "\n");
  if (output.json) process.stdout.write(JSON.stringify({ ok: false, error: code }, null, 2) + "\n");
  process.exit(1);
}
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});
function out(s) {
  process.stdout.write(s + "\n");
}
function problemSuffix(el, cfg) {
  const codes = elementProblems(el, cfg.problems.ignore);
  return codes.length > 0 ? "  " + codes.join(" ") : "";
}
function printEntryLine(el, cfg) {
  const arch = el.archived ? " (archived)" : "";
  out(`  ${el.id}  ${el.status.padEnd(8)} ${el.title}${arch}${problemSuffix(el, cfg)}`);
}
function writeFeedback(el, cfg, headline) {
  out(headline);
  for (const code of elementProblems(el, cfg.problems.ignore)) {
    if (code === "incomplete:acceptance") out(`\u26A0 ${el.id} has no acceptance criteria. Add them before starting.`);
    else if (code === "incomplete:description") out(`\u26A0 ${el.id} has no description. Add one before starting.`);
    else if (code === "acceptance:no_checkbox") out(`\u26A0 ${el.id} has acceptance criteria with no checkbox items \u2014 nothing for check to tick.`);
    else if (code === "done:no_acceptance") out(`\u26A0 ${el.id} is done with no acceptance criteria.`);
    else if (code === "done:open_acceptance") {
      const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
      out(`\u26A0 ${el.id} is done with ${counts ? counts.unticked : "?"} of ${counts ? counts.total : "?"} acceptance boxes still unticked.`);
    } else out(`\u26A0 ${el.id}: ${code}`);
  }
}
function buildWriteResult(el, changed, backlog, cfg, extra) {
  const entry = entryJson(el, backlog, cfg);
  return Object.assign({ ok: true, id: el.id, changed, entry, _problems: entry._problems }, extra || {});
}
function emitWriteResult(json, el, changed, backlog, cfg, extra) {
  if (!json) return;
  out(JSON.stringify(buildWriteResult(el, changed, backlog, cfg, extra), null, 2));
}
function emitFailure(code, message, hint) {
  process.stderr.write(`Error: ${message}
`);
  if (hint) process.stderr.write(`${hint}
`);
  if (output.json) {
    const res = { ok: false, error: code };
    if (hint) res.hint = hint;
    out(JSON.stringify(res, null, 2));
  }
  process.exitCode = 1;
}

// src/core/dry-run.ts
var state = {
  armed: false,
  finished: false,
  real: null,
  sandbox: null,
  scratch: null,
  /** Backlog-relative path → the target a symlink was given in the copy. */
  links: /* @__PURE__ */ new Map(),
  stdout: [],
  writeOut: null
};
function isDryRun() {
  return state.armed;
}
function armDryRun() {
  if (state.armed) return;
  state.armed = true;
  const stdout = process.stdout;
  const stderr = process.stderr;
  const origOut = stdout.write.bind(stdout);
  const origErr = stderr.write.bind(stderr);
  state.writeOut = (s) => {
    origOut(s);
  };
  const text = (chunk) => typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  stdout.write = ((chunk) => {
    state.stdout.push(text(chunk));
    return true;
  });
  stderr.write = ((chunk) => origErr(toReal(text(chunk))));
  process.on("exit", finishDryRun);
}
function toReal(s) {
  if (state.sandbox === null || state.real === null) return s;
  return s.split(state.sandbox).join(state.real);
}
function deepToReal(v) {
  if (typeof v === "string") return toReal(v);
  if (Array.isArray(v)) return v.map(deepToReal);
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepToReal(x);
    return o;
  }
  return v;
}
function isInside(p, root) {
  if (p === root) return "";
  const prefix = root.endsWith(path3.sep) ? root : root + path3.sep;
  return p.startsWith(prefix) ? p.slice(prefix.length) : null;
}
function realpathLoose(p) {
  try {
    return fs3.realpathSync.native(p);
  } catch {
  }
  try {
    return path3.join(fs3.realpathSync.native(path3.dirname(p)), path3.basename(p));
  } catch {
    return path3.resolve(p);
  }
}
function intoSandbox(p) {
  if (state.sandbox === null || state.real === null) return p;
  let rel = isInside(path3.resolve(p), path3.resolve(state.real));
  if (rel === null) rel = isInside(realpathLoose(p), realpathLoose(state.real));
  if (rel === null) return p;
  return rel === "" ? state.sandbox : path3.join(state.sandbox, rel);
}
function copyTimes(dst, st) {
  fs3.utimesSync(dst, st.atimeMs / 1e3, st.mtimeMs / 1e3);
}
function copyEntry(src, dst, rel, root) {
  let st;
  try {
    st = fs3.lstatSync(src);
  } catch {
    return;
  }
  if (st.isDirectory()) return copyDir(src, dst, rel, root, st);
  if (st.isSymbolicLink()) {
    const target = fs3.readlinkSync(src);
    const outside = !path3.isAbsolute(target) && isInside(path3.resolve(path3.dirname(src), target), root) === null;
    const written = outside ? path3.resolve(path3.dirname(src), target) : target;
    fs3.symlinkSync(written, dst);
    state.links.set(rel, written);
    return;
  }
  if (!st.isFile()) return;
  try {
    fs3.copyFileSync(src, dst, fs3.constants.COPYFILE_FICLONE);
  } catch {
    fs3.writeFileSync(dst, "");
  }
  fs3.chmodSync(dst, st.mode & 4095);
  copyTimes(dst, st);
}
function copyDir(src, dst, rel, root, st) {
  fs3.mkdirSync(dst);
  let names;
  try {
    names = fs3.readdirSync(src);
  } catch {
    names = null;
  }
  for (const n of names || []) copyEntry(path3.join(src, n), path3.join(dst, n), rel === "" ? n : rel + "/" + n, root);
  fs3.chmodSync(dst, st.mode & 4095);
  copyTimes(dst, st);
}
function sandboxFor(real) {
  if (!state.armed) return real;
  if (state.sandbox !== null) {
    if (real === state.real) return state.sandbox;
    throw new Error(`dry run: a second backlog '${real}' in one call (already copied '${state.real}')`);
  }
  const tmp = os.tmpdir();
  try {
    const scratch = fs3.mkdtempSync(path3.join(fs3.realpathSync.native(tmp), "nj-dry-run-"));
    state.scratch = scratch;
    state.real = real;
    state.sandbox = path3.join(scratch, path3.basename(real) || "backlog");
    let st;
    try {
      st = fs3.statSync(real);
    } catch {
      st = null;
    }
    if (st !== null && st.isDirectory()) copyDir(real, state.sandbox, "", path3.resolve(real), st);
  } catch (e) {
    removeScratch();
    state.real = null;
    state.sandbox = null;
    const reason = e && e.message ? String(e.message).split("\n")[0] : String(e);
    return fail("io_error", `cannot make the dry run's scratch copy in ${tmp}: ${reason}`, "set TMPDIR to a writable directory with room for a copy of the backlog");
  }
  return state.sandbox;
}
function removeScratch() {
  if (state.scratch === null) return;
  const scratch = state.scratch;
  state.scratch = null;
  try {
    fs3.rmSync(scratch, { recursive: true, force: true });
    return;
  } catch {
  }
  const open = (d) => {
    try {
      fs3.chmodSync(d, 448);
    } catch {
      return;
    }
    let names;
    try {
      names = fs3.readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = path3.join(d, n);
      try {
        if (fs3.lstatSync(p).isDirectory()) open(p);
      } catch {
      }
    }
  };
  open(scratch);
  try {
    fs3.rmSync(scratch, { recursive: true, force: true });
  } catch (e) {
    process.stderr.write(`Warning: dry run scratch copy not removed: ${scratch} (${e && e.message ? e.message : e})
`);
  }
}
function snapshot(root) {
  const out2 = /* @__PURE__ */ new Map();
  if (root === null) return out2;
  let st;
  try {
    st = fs3.statSync(root);
  } catch {
    return out2;
  }
  if (!st.isDirectory()) return out2;
  out2.set(".", { kind: "dir", content: null });
  const walk = (dir, rel) => {
    let names;
    try {
      names = fs3.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = path3.join(dir, n);
      const r = rel === "" ? n : rel + "/" + n;
      let s;
      try {
        s = fs3.lstatSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        out2.set(r, { kind: "dir", content: null });
        walk(p, r);
      } else if (s.isSymbolicLink()) out2.set(r, { kind: "symlink", content: fs3.readlinkSync(p) });
      else if (s.isFile()) {
        let c;
        try {
          c = fs3.readFileSync(p, "utf8");
        } catch {
          c = null;
        }
        out2.set(r, { kind: "file", content: c });
      }
    }
  };
  walk(root, "");
  return out2;
}
function diffTrees() {
  const before = snapshot(state.real);
  const after = snapshot(state.sandbox);
  const paths = Array.from(/* @__PURE__ */ new Set([...before.keys(), ...after.keys()])).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const changes = [];
  const del = (p, n) => changes.push({ path: p, kind: n.kind, op: "delete", before: n.content, after: null });
  const add = (p, n) => changes.push({ path: p, kind: n.kind, op: "create", before: null, after: n.content });
  for (const p of paths) {
    const a = before.get(p);
    const b = after.get(p);
    if (a !== void 0 && b === void 0) del(p, a);
    else if (a === void 0 && b !== void 0) add(p, b);
    else if (a !== void 0 && b !== void 0) {
      if (a.kind !== b.kind) {
        del(p, a);
        add(p, b);
      } else if (a.kind === "symlink") {
        if (b.content !== state.links.get(p)) changes.push({ path: p, kind: "symlink", op: "modify", before: a.content, after: b.content });
      } else if (a.kind === "file" && a.content !== null && b.content !== null && a.content !== b.content) {
        changes.push({ path: p, kind: "file", op: "modify", before: a.content, after: b.content });
      }
    }
  }
  return changes;
}
function humanSummary(changes) {
  if (changes.length === 0) return "Dry run: nothing written. The real call would change nothing.\n";
  const lines = changes.map((c) => `  ${c.op.padEnd(6)}  ${c.path}${c.kind === "dir" && c.path !== "." ? "/" : ""}`);
  return `Dry run: nothing written. The real call would change ${changes.length} path${changes.length === 1 ? "" : "s"}:
${lines.join("\n")}
`;
}
function finishDryRun() {
  if (!state.armed || state.finished) return;
  state.finished = true;
  let changes = [];
  let failure = null;
  try {
    changes = diffTrees();
  } catch (e) {
    failure = e && e.message ? String(e.message) : String(e);
  }
  removeScratch();
  const held = state.stdout.join("");
  let text;
  if (failure !== null) {
    process.stderr.write(`Error: dry run: cannot compute the changes: ${failure}
`);
    text = output.json ? JSON.stringify({ ok: false, error: "internal_error", dry_run: true, changes: [] }, null, 2) + "\n" : "";
    process.exitCode = 1;
  } else if (output.json) {
    let parsed;
    try {
      parsed = JSON.parse(held);
    } catch {
      parsed = void 0;
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result = Object.assign(deepToReal(parsed), { dry_run: true, changes });
      text = JSON.stringify(result, null, 2) + "\n";
    } else {
      text = toReal(held);
    }
  } else {
    text = toReal(held) + humanSummary(changes);
  }
  try {
    state.writeOut(text);
  } catch {
  }
}

// src/core/args.ts
var FLAG_ALIASES = /* @__PURE__ */ new Map([["depends-on", "depends_on"]]);
function displayFlagName(name) {
  for (const [shown, internal] of FLAG_ALIASES) if (internal === name) return shown;
  return name;
}
function parseArgs(argv) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  for (const a of argv) {
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      let name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const value = eq === -1 ? true : a.slice(eq + 1);
      name = FLAG_ALIASES.get(name) ?? name;
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
var GLOBAL_CONTROLS = ["backlog"];
function allowedControlSet(commandControls, isWrite) {
  return /* @__PURE__ */ new Set([...commandControls, ...GLOBAL_CONTROLS, ...isWrite ? ["dry-run"] : []]);
}
function checkFlags(flags, allowedFields, commandControls, isWrite) {
  const allowedControls = allowedControlSet(commandControls, isWrite);
  for (const name of flags.keys()) {
    if (allowedControls.has(name)) continue;
    if (allowedFields.includes(name)) continue;
    const suffix = isWrite ? " Nothing written." : "";
    const known = allowedFields.length > 0 ? `Known fields: ${allowedFields.join(", ")}` : `Known flags: ${Array.from(allowedControls).sort().map((f) => "--" + f).join(", ")}`;
    fail("unknown_field", `unknown field '${name}'.${suffix}`, known);
  }
  if (flags.has("dry-run")) {
    armDryRun();
    if (flags.get("dry-run") !== true) fail("invalid_value", "--dry-run takes no value", "pass --dry-run on its own");
  }
}
function flagString(flags, name) {
  const v = flags.get(name);
  if (v === void 0) return void 0;
  if (v === true) return fail("missing_value", `--${name} needs a value (use --${name}=\u2026)`);
  return v;
}
function parseListFlag(flags, name) {
  const v = flagString(flags, name);
  if (v === void 0) return void 0;
  if (v === "") return [];
  const items = v.split(",").map((s) => s.trim()).filter((s) => s !== "");
  for (const it of items) {
    if (it.includes("]")) fail("invalid_value", `--${name.replace("_", "-")} item '${it}' contains ']', which is not accepted on the command line`);
  }
  return items;
}
function readStdin() {
  try {
    return fs4.readFileSync(0, "utf8");
  } catch (e) {
    return fail("invalid_value", `cannot read stdin \u2014 ${e.message}`, "pipe the text in, or pass a path with --<role>-file=<path>");
  }
}
function readSectionFlags(flags) {
  const src = /* @__PURE__ */ new Map();
  for (const role of SECTION_ROLES) {
    const inline = flagString(flags, role);
    const file = flagString(flags, role + "-file");
    if (inline !== void 0 && file !== void 0) {
      fail(
        "invalid_value",
        `--${role} and --${role}-file are mutually exclusive. Nothing written.`,
        `pass the text with --${role}=\u2026 or the path with --${role}-file=\u2026`
      );
    }
    if (inline !== void 0) src.set(role, { inline });
    else if (file !== void 0) src.set(role, { file });
  }
  const viaStdin = SECTION_ROLES.filter((r) => src.has(r) && src.get(r).file === "-");
  if (viaStdin.length > 1) {
    fail(
      "invalid_value",
      `--${viaStdin[0]}-file=- and --${viaStdin[1]}-file=- both read stdin, which can only be consumed once. Nothing written.`,
      "read one role from a file or pass it inline"
    );
  }
  const wanted = /* @__PURE__ */ new Map();
  for (const role of SECTION_ROLES) {
    if (!src.has(role)) continue;
    const s = src.get(role);
    if (s.inline !== void 0) {
      wanted.set(role, normalizeSectionContent(s.inline));
      continue;
    }
    if (s.file === "-") {
      wanted.set(role, normalizeSectionContent(readStdin()));
      continue;
    }
    let raw;
    try {
      raw = fs4.readFileSync(s.file, "utf8");
    } catch (e) {
      fail(
        "not_found",
        `--${role}-file: cannot read '${s.file}' \u2014 ${e.message}. Nothing written.`,
        "give a readable path, or `-` to read stdin"
      );
    }
    wanted.set(role, normalizeSectionContent(raw));
  }
  return wanted;
}

// src/commands/cmd-archive.ts
import * as fs11 from "node:fs";
import * as path10 from "node:path";

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
    controls: ["json", "force", "allow-open-children", "id", "file", "input", "quiet", "fields"],
    write: true
  },
  note: { fields: [], controls: [...OUTPUT, "force", "text", "text-file", ...cliFieldNames("note")], write: true },
  check: { fields: [], controls: [...OUTPUT, "force", ...cliFieldNames("check")], write: true },
  show: { fields: [], controls: ["json", ...cliFieldNames("show")], write: false },
  log: { fields: [], controls: ["json", ...cliFieldNames("log")], write: false },
  list: { fields: [], controls: ["json", "ready", "all", ...cliFieldNames("list")], write: false },
  find: { fields: [], controls: ["json", "all", ...cliFieldNames("find")], write: false },
  tree: { fields: [], controls: ["json", "all", ...cliFieldNames("tree")], write: false },
  tags: { fields: [], controls: ["json"], write: false },
  rm: { fields: [], controls: ["json", ...cliFieldNames("rm")], write: true },
  archive: { fields: [], controls: ["json", ...cliFieldNames("archive")], write: true },
  unarchive: { fields: [], controls: ["json", ...cliFieldNames("unarchive")], write: true },
  // Only `status` in "Known fields:", as the original error text had it.
  claim: { fields: ["status"], controls: [...OUTPUT, ...cliFieldNames("claim").filter((f) => f !== "status")], write: true },
  release: { fields: [], controls: [...OUTPUT, ...cliFieldNames("release")], write: true },
  next: { fields: cliFieldNames("next"), controls: ["json"], write: true },
  doctor: { fields: [], controls: ["json", "dry-run", ...cliFieldNames("doctor")], write: false }
};
function cliSpec(command) {
  const s = Object.hasOwn(CLI_SPEC, command) ? CLI_SPEC[command] : void 0;
  if (!s) throw new Error(`cli-flags: unknown command '${command}'`);
  return s;
}
function checkCommandFlags(flags, command) {
  const s = cliSpec(command);
  checkFlags(flags, s.fields, new Set(s.controls), s.write);
}
function acceptedFlagNames(command) {
  if (!Object.hasOwn(CLI_SPEC, command)) return null;
  const s = CLI_SPEC[command];
  const accepted = /* @__PURE__ */ new Set([...s.fields, ...s.controls, ...allowedControlSet(s.controls, s.write)]);
  const tableOrder = Object.hasOwn(FLAG_TABLE, command) ? cliFieldNames(command).filter((f) => accepted.has(f)) : [];
  return Array.from(/* @__PURE__ */ new Set([...tableOrder, ...accepted]));
}
var doc = (text, value) => value === void 0 ? { text } : { value, text };
var FILTER = {
  status: doc("only elements with this status", "<value>"),
  type: doc("only elements of this type", "<value>"),
  tag: doc("only elements carrying this tag", "<tag>"),
  parent: doc("only direct children of this element", "<id>"),
  assignee: doc("only elements assigned to this name", "<name>")
};
var BATCH_ID = doc("the element to act on; A,B,C applies the same write to each", "<id>");
var FLAG_DOCS = {
  id: doc("the element to act on", "<id>"),
  file: doc("address one file of a duplicated ID, instead of --id", "<path>"),
  json: doc("print the result as JSON"),
  backlog: doc("use this backlog (else NJ_BACKLOG, else the upward search)", "<path>"),
  "dry-run": doc("run against a scratch copy; nothing is written"),
  quiet: doc("with --json: print only {ok, id}, plus _problems when non-empty"),
  fields: doc("with --json: keep only these entry fields, in this order", "<a,b,...>"),
  force: doc("overwrite a parallel change"),
  "allow-open-children": doc("allow the final status while children are still open"),
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
  ready: doc("only elements ready to start"),
  all: doc("include archived elements")
};
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
    notes: doc("which notes to show (default all)", "none|all|last:N")
  },
  log: {
    id: doc("the element whose history to show", "<id>"),
    last: doc("show only the last N events", "<N>")
  },
  list: FILTER,
  find: { ...FILTER, "case-sensitive": doc("match the text with exact case") },
  tree: { id: doc("show only this element and what is below it", "<id>") },
  rm: { cascade: doc("also remove every element below this one") },
  claim: {
    id: BATCH_ID,
    as: doc("claim as this name", "<name>"),
    steal: doc("take over the claim this holder has", "<holder>"),
    status: doc("also set this status", "<value>")
  },
  release: { id: BATCH_ID, as: doc("release the claim held under this name", "<name>") },
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

// src/core/context.ts
import * as fs8 from "node:fs";
import * as path7 from "node:path";

// src/core/config.ts
import * as fs5 from "node:fs";
import * as os2 from "node:os";
import * as path4 from "node:path";

// src/core/version.ts
var VERSION = "4.1.1";
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
  const file = path4.join(backlog, rel);
  let raw;
  try {
    raw = fs5.readFileSync(file, "utf8");
  } catch {
    return { config: DEFAULT_CONFIG, errors: [`${rel} is missing`], warnings: [], needsNewerNj: null };
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
  return fs5.existsSync(path4.join(dir, V3_CONFIG_REL)) || fs5.existsSync(path4.join(dir, LEGACY_CONFIG_REL));
}
function claim(dir, src, lenient) {
  const shown = src.kind === "njrc" ? escapeInvisible(dir) : dir;
  if (!isDir(dir)) fail(SOURCE_CODE[src.kind], `no backlog at ${shown} (from ${sourceName(src)})`);
  if (lenient || holdsBacklog(dir)) return dir;
  if (fs5.existsSync(path4.join(dir, V3_DIR_REL))) {
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
    if (flag === "") fail("missing_value", "--backlog needs a value (use --backlog=\u2026)");
    return { dir: fromCwd(flag), src: { kind: "flag" } };
  }
  const env = process.env.NJ_BACKLOG;
  if (env !== void 0 && env !== "") return { dir: fromCwd(env), src: { kind: "env" } };
  return null;
}
function njrcLocation(dir) {
  const file = path4.join(dir, ".njrc");
  const raw = readNjrc(file);
  if (raw === null) return null;
  const value = parseNjrc(file, raw).get("backlog");
  if (value === void 0) return null;
  const expanded = value.startsWith("~/") ? path4.join(os2.homedir(), value.slice(2)) : value;
  return { dir: path4.resolve(dir, expanded), src: { kind: "njrc", file } };
}
function readNjrc(file) {
  let link;
  try {
    link = fs5.lstatSync(file);
  } catch (e) {
    return searchMiss(e, path4.dirname(file));
  }
  const bad = (reason, hint) => fail("invalid_njrc", `invalid .njrc at ${file}: ${reason}`, hint);
  checkOwner(link.uid, bad);
  njrcSwapFaultHook(path4.dirname(file));
  let fd;
  try {
    fd = fs5.openSync(file, fs5.constants.O_RDONLY | fs5.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === "ELOOP") return bad("it is a symlink loop (ELOOP)");
    if (e.code === "ENOENT") {
      let fresh;
      try {
        fresh = fs5.lstatSync(file);
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
      st = fs5.fstatSync(fd);
    } catch (e) {
      return bad(`cannot stat it -- ${e.code || e.message}`);
    }
    checkOwner(st.uid, bad);
    if (!st.isFile()) return bad(st.isDirectory() ? "it is a directory, not a file" : "it is not a regular file");
    let raw;
    try {
      raw = fs5.readFileSync(fd, "utf8");
    } catch (e) {
      return bad(`cannot read it -- ${e.code || e.message}`);
    }
    return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  } finally {
    fs5.closeSync(fd);
  }
}
function njrcSwapFaultHook(dir) {
  if (process.env.NJ_FAULT !== "njrc-swap") return;
  const marker = path4.join(dir, ".nj-fault-go");
  const deadline = Date.now() + 1e4;
  while (!fs5.existsSync(marker)) {
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
function initLocation(flags) {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return explicit.dir;
  for (let dir = workingDir(); ; dir = path4.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return rc.dir;
    if (path4.dirname(dir) === dir) break;
  }
  return path4.join(workingDir(), "backlog");
}
function workingDir() {
  try {
    return process.cwd();
  } catch (e) {
    return fail("io_error", `cannot determine the working directory: ${oneLine(e)}`);
  }
}
function fromCwd(p) {
  return path4.isAbsolute(p) ? path4.resolve(p) : path4.resolve(workingDir(), p);
}
function oneLine(e) {
  const msg = e && e.message ? String(e.message) : String(e);
  return msg.split("\n")[0];
}
function findBacklog(flags, lenient) {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return claim(explicit.dir, explicit.src, lenient);
  for (let dir = workingDir(); ; dir = path4.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return claim(rc.dir, rc.src, lenient);
    const candidate = path4.join(dir, "backlog");
    if (searchIsDir(candidate)) {
      if (lenient || holdsBacklog(candidate)) return candidate;
      fail(
        "backlog_without_config",
        `${candidate} exists but has no ${V3_CONFIG_REL}`,
        "run `nanojira doctor` \u2014 it tolerates the missing file and reports config:invalid"
      );
    }
    if (path4.dirname(dir) === dir) break;
  }
  return fail(
    "no_backlog",
    `no backlog found (looked for backlog/${V3_CONFIG_REL} upward from the working directory)`,
    "run `nanojira init` to create one, or set NJ_BACKLOG"
  );
}
function isDir(p) {
  try {
    return fs5.statSync(p).isDirectory();
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
    return fs5.statSync(p).isDirectory();
  } catch (e) {
    return searchMiss(e, path4.dirname(p)) ?? false;
  }
}
function isLegacyBacklog(backlog) {
  return fs5.existsSync(path4.join(backlog, LEGACY_CONFIG_REL));
}

// src/core/load.ts
import * as fs7 from "node:fs";
import * as path6 from "node:path";

// src/core/layout.ts
import * as fs6 from "node:fs";
import * as path5 from "node:path";
var INTERNAL_DIRS = [".ids", ".nanojira"];
var TOP_LEVEL_DOCS = /* @__PURE__ */ new Set(["README.md", "STATUS.md", "TAGS.md"]);
var ID_FOLDER = /^(EPIC|TSK|SUB)-\d+$/;
function foldEq(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}
function scanBacklog(backlog, layout) {
  const files = [];
  const dirs = [backlog];
  const unreadable = [];
  const readEntries = (dir) => {
    let entries;
    try {
      entries = fs6.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code !== "ENOENT") unreadable.push({ dir, reason: e.code || e.message });
      return [];
    }
    return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  };
  const walk = (dir, folder, entries) => {
    for (const e of entries) {
      const abs = path5.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        dirs.push(abs);
        walk(abs, folder === "" ? e.name : folder + "/" + e.name, readEntries(abs));
      } else if (e.name.endsWith(".md") && !(e.isSymbolicLink() && isDirectory(abs))) {
        files.push({ file: abs, folder });
      }
    }
  };
  const roleNames = FOLDER_ROLES.map((r) => layout.folders[r]);
  const top = readEntries(backlog).filter((e) => !(TOP_LEVEL_DOCS.has(e.name) && !e.isDirectory()));
  const isRoleName = (name) => roleNames.some((n) => foldEq(n, name));
  for (const n of roleNames) {
    const e = top.find((t) => foldEq(t.name, n));
    if (e === void 0) continue;
    const abs = path5.join(backlog, e.name);
    if (e.isSymbolicLink()) {
      let st;
      try {
        st = fs6.statSync(abs);
      } catch (err) {
        unreadable.push({ dir: abs, reason: err.code === "ENOENT" ? "dangling symlink" : err.code || err.message });
        continue;
      }
      if (!st.isDirectory()) {
        unreadable.push({ dir: abs, reason: "not a directory" });
        continue;
      }
    } else if (!e.isDirectory()) {
      continue;
    }
    dirs.push(abs);
    walk(abs, e.name, readEntries(abs));
  }
  walk(backlog, "", top.filter((e) => !isRoleName(e.name)));
  for (const n of INTERNAL_DIRS) {
    const abs = path5.join(backlog, n);
    if (isDirectory(abs)) dirs.push(abs);
  }
  return { files, dirs, unreadable };
}
function isDirectory(p) {
  try {
    return fs6.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function folderOf(backlog, file) {
  const rel = path5.relative(backlog, path5.dirname(file));
  return rel === "" ? "" : rel.split(path5.sep).join("/");
}
function inArchive(folder, layout) {
  const a = layout.folders.archive;
  if (folder.length === a.length) return foldEq(folder, a);
  if (folder.length > a.length && folder[a.length] === "/") return foldEq(folder.slice(0, a.length), a);
  return false;
}
function samePlace(want, have, layout) {
  if (layout.group !== "hierarchy") return foldEq(want, have);
  const strip = (s) => {
    const seg = s.split("/")[0];
    return foldEq(seg, layout.folders.archive) ? { archived: true, rest: s.slice(seg.length + 1) } : { archived: false, rest: s };
  };
  const w = strip(want), h = strip(have);
  return w.archived === h.archived && w.rest === h.rest;
}
function hierarchyDir(el, byId) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  for (let cur = el; cur !== void 0; ) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    chain.unshift(cur);
    if (cur.parent === null) break;
    cur = byId.get(cur.parent);
    if (cur === void 0) return null;
  }
  return chain.filter((c) => c.type === "epic" || c.type === "task").map((c) => c.id).join("/");
}
function placeOf(el, byId, layout, archived) {
  if (el.type === null) return null;
  const inArch = (dir2) => archived ? [layout.folders.archive, dir2].filter((d) => d !== "").join("/") : dir2;
  if (layout.group === "type") return archived ? layout.folders.archive : layout.folders[TYPE_FOLDER_ROLE[el.type]];
  if (layout.group === "flat") return inArch("");
  const dir = hierarchyDir(el, byId);
  return dir === null ? null : inArch(dir);
}
function expectedPlace(el, byId, layout) {
  return placeOf(el, byId, layout, el.archived);
}
function moveTarget(el, byId, layout) {
  return placeOf(el, byId, layout, el.archived || el.archivedAt !== null);
}
function misplacedCode(layout) {
  return layout.group === "type" ? "type:folder" : "layout:misplaced";
}
function ownFolder(el) {
  if (el.type !== "epic" && el.type !== "task") return null;
  const dir = path5.dirname(el.file);
  return path5.basename(dir) === el.id ? dir : null;
}
function removeEmptiedIdFolders(backlog, dirs) {
  for (const start of dirs) {
    for (let d = start; d !== backlog && d.startsWith(backlog + path5.sep) && ID_FOLDER.test(path5.basename(d)); d = path5.dirname(d)) {
      try {
        fs6.rmdirSync(d);
      } catch {
        break;
      }
    }
  }
}

// src/core/load.ts
function unreadableElement(file, folder, cfg, err) {
  const base = path6.basename(file, ".md");
  const pm = /^(EPIC|TSK|SUB)-/.exec(base);
  const ts = mtimeIso(file);
  const byFolder = cfg.layout.group === "type" ? Object.keys(TYPE_FOLDER_ROLE).find((t) => foldEq(cfg.layout.folders[TYPE_FOLDER_ROLE[t]], folder)) || null : null;
  return {
    file,
    folder,
    raw: null,
    body: "",
    fields: /* @__PURE__ */ new Map(),
    order: [],
    parsed: false,
    readable: false,
    detail: [{ code: "file:unreadable", message: `cannot be read \u2014 ${err.message}` }],
    problems: /* @__PURE__ */ new Set(["file:unreadable"]),
    archived: inArchive(folder, cfg.layout),
    id: base,
    type: pm ? PREFIX_TYPE[pm[1]] : byFolder,
    title: "",
    status: cfg.statuses[0],
    parent: null,
    priority: "normal",
    assignee: "",
    tags: [],
    depends_on: [],
    created: ts,
    updated: ts,
    archivedAt: null
  };
}
function deriveId(el, p, base) {
  let id = p.fields.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    id = base;
    if (p.parsed) el.problems.add("id:derived");
  } else {
    id = id.trim();
    if (id !== base) el.problems.add("id:mismatch");
  }
  return { ...el, id };
}
function deriveType(el, p) {
  const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
  const prefixType = pm ? PREFIX_TYPE[pm[1]] : null;
  let type;
  const rawType = p.fields.get("type");
  if (typeof rawType === "string" && TYPES.includes(rawType.trim())) {
    type = rawType.trim();
  } else if (prefixType) {
    type = prefixType;
    if (p.parsed) el.problems.add("type:derived");
  } else {
    type = null;
  }
  if (type === null) el.problems.add("type:folder");
  return { ...el, type };
}
function deriveTitle(el, p) {
  const title = p.fields.get("title");
  const t = typeof title === "string" ? normalizeTitle(title) : "";
  if (t === "") el.problems.add("missing:title");
  return { ...el, title: t };
}
function deriveStatus(el, p, cfg) {
  let status;
  const raw = p.fields.get("status");
  if (typeof raw !== "string" || raw.trim() === "") {
    status = cfg.statuses[0];
    if (p.parsed) el.problems.add("missing:status");
  } else {
    status = raw.trim();
    if (!cfg.statuses.includes(status)) el.problems.add("unknown:status");
  }
  return { ...el, status };
}
function deriveParent(el, p) {
  const raw = p.fields.get("parent");
  const parent = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  if (el.type === "epic") {
    if (parent !== null) el.problems.add("parent:hierarchy");
  } else if (el.type !== null && parent === null) {
    el.problems.add("parent:orphaned");
  }
  return { ...el, parent };
}
function deriveOptionals(el, p) {
  let priority;
  const pri = p.fields.get("priority");
  if (typeof pri !== "string" || pri.trim() === "") {
    priority = "normal";
  } else {
    priority = pri.trim();
    if (!PRIORITIES.includes(priority)) el.problems.add("unknown:priority");
  }
  const asg = p.fields.get("assignee");
  const assignee = typeof asg === "string" ? asg : "";
  const tags = Array.isArray(p.fields.get("tags")) ? p.fields.get("tags") : [];
  const depends_on = Array.isArray(p.fields.get("depends_on")) ? p.fields.get("depends_on") : [];
  return { ...el, priority, assignee, tags, depends_on };
}
function deriveTimestamps(el, p, file) {
  let created;
  const rawCreated = p.fields.get("created");
  if (typeof rawCreated !== "string" || rawCreated.trim() === "") {
    created = mtimeIso(file);
    if (p.parsed) el.problems.add("missing:created");
  } else {
    created = rawCreated.trim();
  }
  let updated;
  const rawUpdated = p.fields.get("updated");
  if (typeof rawUpdated !== "string" || rawUpdated.trim() === "") {
    updated = mtimeIso(file);
    if (p.parsed) el.problems.add("missing:updated");
  } else {
    updated = rawUpdated.trim();
  }
  return { ...el, created, updated };
}
function deriveArchiveState(el, p) {
  const arch = p.fields.get("archived");
  const archivedAt = typeof arch === "string" && arch.trim() !== "" ? arch.trim() : null;
  if (el.archived && el.status !== "done") el.problems.add("archive:not_done");
  return { ...el, archivedAt };
}
function deriveBody(el, p, cfg) {
  const h1 = h1Of(p.body);
  if (h1 !== null && el.title !== "" && h1 !== el.title) el.problems.add("title:h1_mismatch");
  if (p.parsed) {
    const descOk = sectionPresent(p.body, cfg.sections.description);
    if (!descOk) el.problems.add("incomplete:description");
    if (el.type === "task" || el.type === "subtask") {
      const acceptanceOk = sectionPresent(p.body, cfg.sections.acceptance);
      if (!acceptanceOk) {
        el.problems.add("incomplete:acceptance");
        if (el.status === "done" && !el.archived) el.problems.add("done:no_acceptance");
      } else if (!sectionHasCheckbox(p.body, cfg.sections.acceptance)) {
        if (!el.archived) el.problems.add("acceptance:no_checkbox");
      } else if (el.status === "done" && !el.archived) {
        const counts = sectionCheckboxCounts(p.body, cfg.sections.acceptance);
        if (counts && counts.unticked > 0) el.problems.add("done:open_acceptance");
      }
    }
  }
  return el;
}
function loadElement(file, backlog, cfg, folder = folderOf(backlog, file)) {
  let raw;
  try {
    raw = fs7.readFileSync(file, "utf8");
  } catch (err) {
    return unreadableElement(file, folder, cfg, err);
  }
  const p = parseFile(raw);
  const problems = /* @__PURE__ */ new Set();
  for (const d of p.problems) problems.add(d.code);
  const base = path6.basename(file, ".md");
  const skeleton = {
    file,
    folder,
    raw,
    body: p.body,
    fields: p.fields,
    order: p.order,
    parsed: p.parsed,
    readable: true,
    detail: p.problems,
    problems,
    archived: inArchive(folder, cfg.layout)
  };
  const withId = deriveId(skeleton, p, base);
  const withType = deriveType(withId, p);
  const withTitle = deriveTitle(withType, p);
  const withStatus = deriveStatus(withTitle, p, cfg);
  const withParent = deriveParent(withStatus, p);
  const withOptionals = deriveOptionals(withParent, p);
  const withTimestamps = deriveTimestamps(withOptionals, p, file);
  const withArchiveState = deriveArchiveState(withTimestamps, p);
  const final = deriveBody(withArchiveState, p, cfg);
  return final;
}
function loadBacklog(backlog, cfg, idsDir) {
  const scan = scanBacklog(backlog, cfg.layout);
  const elements = scan.files.map(({ file, folder }) => loadElement(file, backlog, cfg, folder));
  deriveGraph(elements, idsDir, cfg);
  return { elements, scan };
}
function indexById(elements) {
  const byId = /* @__PURE__ */ new Map();
  const counts = /* @__PURE__ */ new Map();
  for (const el of elements) {
    counts.set(el.id, (counts.get(el.id) || 0) + 1);
    if (!byId.has(el.id)) byId.set(el.id, el);
  }
  return { byId, counts };
}
function childMap(elements) {
  const m = /* @__PURE__ */ new Map();
  for (const e of elements) {
    if (e.parent === null) continue;
    const a = m.get(e.parent);
    if (a) a.push(e);
    else m.set(e.parent, [e]);
  }
  return m;
}
function descendants(ctx, el) {
  if (!ctx.kids) ctx.kids = childMap(ctx.elements);
  const out2 = [];
  const seen = /* @__PURE__ */ new Set([el.id]);
  const walk = (cur) => {
    for (const c of ctx.kids.get(cur.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out2.push(c);
      walk(c);
    }
  };
  walk(el);
  return out2;
}
function markDuplicateIds(elements, counts) {
  for (const el of elements) {
    if (counts.get(el.id) > 1) el.problems.add("duplicate_id");
  }
}
function markParentEdges(elements, byId) {
  for (const el of elements) {
    if (el.parent === null) continue;
    const p = byId.get(el.parent);
    if (!p) {
      el.problems.add("parent:dangling");
      continue;
    }
    if (el.type && PARENT_TYPE[el.type] && p.type && p.type !== PARENT_TYPE[el.type]) {
      el.problems.add("parent:hierarchy");
    }
    if (p.archived && !el.archived) el.problems.add("archive:split");
  }
}
function markParentCycles(elements, byId) {
  for (const el of elements) {
    const seen = /* @__PURE__ */ new Set([el.id]);
    let cur = el;
    for (; ; ) {
      if (cur.parent === null) break;
      if (seen.has(cur.parent)) {
        el.problems.add("parent:cycle");
        break;
      }
      seen.add(cur.parent);
      const next = byId.get(cur.parent);
      if (!next) break;
      cur = next;
    }
  }
}
function markDependsOnEdges(elements, byId) {
  for (const el of elements) {
    for (const dep of el.depends_on) {
      const t = byId.get(dep);
      if (!t) {
        el.problems.add("depends_on:dangling");
        continue;
      }
      if (t.archived) el.problems.add("active_refs_archived");
    }
  }
}
function markDependsOnCycles(elements, byId) {
  const state2 = /* @__PURE__ */ new Map();
  const hasCycle = (id) => {
    const st = state2.get(id);
    if (st === "done") return false;
    if (st === "open") return true;
    const el = byId.get(id);
    if (!el) return false;
    state2.set(id, "open");
    for (const dep of el.depends_on) {
      if (hasCycle(dep)) {
        state2.set(id, "done");
        return true;
      }
    }
    state2.set(id, "done");
    return false;
  };
  for (const el of elements) {
    state2.clear();
    if (hasCycle(el.id)) el.problems.add("depends_on:cycle");
  }
}
function markOpenChildren(elements, children) {
  for (const el of elements) {
    if (el.status !== "done") continue;
    const kids = children.get(el.id) || [];
    if (kids.some((k) => !k.archived && k.status !== "done")) el.problems.add("done:open_children");
  }
}
function markPlaces(elements, byId, layout) {
  const code = misplacedCode(layout);
  for (const el of elements) {
    if (!el.readable) continue;
    const want = expectedPlace(el, byId, layout);
    if (want !== null && !samePlace(want, el.folder, layout)) el.problems.add(code);
  }
}
function markMissingTombstones(elements, idsDir, shardSize) {
  const ids = readTombstones(idsDir, shardSize);
  for (const el of elements) {
    if (!ids.has(el.id)) el.problems.add("id:no_tombstone");
  }
}
function attachGraph(elements, byId, children) {
  for (const el of elements) {
    el.byId = byId;
    el.children = children.get(el.id) || [];
  }
}
function deriveGraph(elements, idsDir, cfg) {
  const { byId, counts } = indexById(elements);
  markDuplicateIds(elements, counts);
  markParentEdges(elements, byId);
  markParentCycles(elements, byId);
  markDependsOnEdges(elements, byId);
  markDependsOnCycles(elements, byId);
  const children = childMap(elements);
  markOpenChildren(elements, children);
  markPlaces(elements, byId, cfg.layout);
  markMissingTombstones(elements, idsDir, cfg.ids.shardSize);
  attachGraph(elements, byId, children);
  return byId;
}

// src/core/context.ts
function context(flags, opts) {
  const backlog = sandboxFor(findBacklog(flags, Boolean(opts && opts.lenient)));
  const legacy = isLegacyBacklog(backlog);
  if (legacy && !(opts && opts.lenient)) {
    fail(
      "legacy_layout",
      `${backlog} is a legacy (v2) backlog \u2014 every command but \`doctor\` refuses it`,
      "run `nanojira doctor --fix` to migrate it to the v3 layout"
    );
  }
  const { config, errors, warnings, needsNewerNj } = loadConfig(backlog, legacy);
  if (needsNewerNj) {
    fail(
      "needs_newer_nj",
      `this backlog requires nanojira ${needsNewerNj.required} or newer; running ${needsNewerNj.running}`,
      `running ${needsNewerNj.running}, requires ${needsNewerNj.required} \u2014 upgrade nanojira`
    );
  }
  if (errors.length > 0 && !(opts && opts.tolerateConfig)) {
    const configFile = path7.join(backlog, legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL);
    fail("invalid_config", `invalid configuration in ${configFile}: ${errors[0]}`, "run `nanojira doctor` for the full report");
  }
  const idsDir = path7.join(backlog, legacy ? LEGACY_IDS_REL : V3_IDS_REL);
  const loadedAt = Date.now();
  const { elements, scan } = loadBacklog(backlog, config, idsDir);
  return { backlog, cfg: config, configErrors: errors, configWarnings: warnings, elements, scan, loadedAt, legacy, idsDir };
}
function requireTargetFlagSyntax(flags) {
  const file = flagString(flags, "file");
  const id = flagString(flags, "id");
  if (file !== void 0 && id !== void 0) fail("invalid_target", "use either --id or --file, not both");
  if (file === void 0 && id === void 0) fail("missing_argument", "--id is required");
}
function resolveTarget(ctx, flags, forWrite) {
  const file = flagString(flags, "file");
  const id = flagString(flags, "id");
  if (file !== void 0 && id !== void 0) fail("invalid_target", "use either --id or --file, not both");
  if (file !== void 0) {
    const abs = intoSandbox(path7.isAbsolute(file) ? file : path7.resolve(ctx.backlog, file));
    const real = (p) => {
      try {
        return fs8.realpathSync.native(p);
      } catch {
      }
      const dir = path7.dirname(p);
      let rdir;
      try {
        rdir = fs8.realpathSync.native(dir);
      } catch {
        rdir = path7.resolve(dir);
      }
      return path7.join(rdir, path7.basename(p));
    };
    const want = real(abs);
    const el = ctx.elements.find((e) => real(e.file) === want);
    if (!el) return fail("not_found", `no element file at '${abs}'`);
    return el;
  }
  if (id === void 0) return fail("missing_argument", "--id is required");
  return resolveById(ctx, id, forWrite);
}
function resolveById(ctx, id, forWrite) {
  const matches = ctx.elements.filter((e) => e.id === id);
  if (matches.length === 0) return fail("not_found", `no element with id '${id}'`);
  if (matches.length > 1) {
    if (forWrite) {
      const paths = matches.map((m) => "  " + m.file).join("\n");
      fail(
        "duplicate_id",
        `duplicate_id: '${id}' is carried by more than one file \u2014 refusing to write.
${paths}`,
        `edit the frontmatter 'id' of one file to a free number and rename the file to match, then re-run; or address one file directly with --file=<path>`
      );
    }
    return matches[0];
  }
  return matches[0];
}
function requireWritable(el) {
  if (el.problems.has("file:unreadable")) {
    fail(
      "refused:unreadable",
      `${el.id} (${el.file}) cannot be read \u2014 refusing to write`,
      "check the file and its permissions, then run `nanojira doctor`"
    );
  }
  if (el.problems.has("frontmatter:unreadable")) {
    fail(
      "refused:unreadable",
      `${el.id} (${el.file}) has unreadable frontmatter \u2014 refusing to write`,
      "repair the file by hand, then run `nanojira doctor`"
    );
  }
}
function requireNoStubs(ctx, verb) {
  const stubs = ctx.elements.filter((e) => e.problems.has("file:unreadable")).sort(compareElements);
  if (stubs.length === 0) return;
  const names = stubs.map((s) => `  ${s.id}  ${s.file}`).join("\n");
  fail(
    "refused:unreadable",
    `${verb} is refused while the backlog contains unreadable files \u2014 their parents cannot be read, so no subtree can be determined:
${names}`,
    "make the files readable (or move them out of the backlog), then run `nanojira doctor` and retry"
  );
}
function requireNoUnreadableDirs(ctx, verb) {
  if (ctx.scan.unreadable.length === 0) return;
  const names = ctx.scan.unreadable.map((u) => `  ${path7.relative(ctx.backlog, u.dir)}`).join("\n");
  fail(
    "refused:unreadable_dir",
    `${verb} is refused while the backlog contains an unreadable directory \u2014 files inside it are not seen, so no subtree can be determined:
${names}`,
    "make the directory readable, then run `nanojira doctor` and retry"
  );
}
function requireActive(el, verb) {
  if (el.archived) {
    fail(
      "refused:archived",
      `${el.id} is archived \u2014 ${verb} is refused on archived elements`,
      "archived elements are read-only in round one; `nanojira unarchive` is round two"
    );
  }
}

// src/core/on-change.ts
import { spawn } from "node:child_process";
var DEFAULT_TIMEOUT_S = 10;
var MAX_TIMEOUT_S = 86400;
var WRITERS = /* @__PURE__ */ new Set(["init", "new", "set", "note", "check", "claim", "release", "next", "archive", "unarchive", "rm", "doctor"]);
var armed = null;
var pending = null;
function beginOnChange(cmd, flags) {
  armed = null;
  pending = null;
  const hook = process.env.NJ_ON_CHANGE;
  if (hook === void 0 || hook === "") return;
  if (process.env.NJ_HOOK_COMMAND !== void 0) return;
  if (cmd === null || !WRITERS.has(cmd)) return;
  if (cmd === "doctor" && !flags.has("fix")) return;
  if (flags.has("dry-run")) return;
  armed = { command: cmd, hook, timeoutS: hookTimeout() };
}
function hookTimeout() {
  const raw = process.env.NJ_ON_CHANGE_TIMEOUT;
  if (raw === void 0) return DEFAULT_TIMEOUT_S;
  const n = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= MAX_TIMEOUT_S)) {
    fail(
      "invalid_env",
      `invalid NJ_ON_CHANGE_TIMEOUT '${raw}' (expected whole seconds, 1 to ${MAX_TIMEOUT_S})`,
      "unset it for the 10-second default"
    );
  }
  return n;
}
function recordChange(backlog, build) {
  if (armed === null) return;
  if (isDryRun()) return;
  pending = { backlog, result: build() };
}
function hookIds(result) {
  if (typeof result.id === "string") return [result.id];
  if (Array.isArray(result.ids)) return result.ids;
  if (Array.isArray(result.results)) {
    return result.results.filter((r) => r.ok === true).map((r) => r.id);
  }
  if (Array.isArray(result.created)) return result.created;
  return [];
}
function warn(what) {
  process.stderr.write(`Warning: NJ_ON_CHANGE hook ${what}; the write itself succeeded and is unchanged
`);
}
function fireRecordedChange() {
  if (armed === null || pending === null) return;
  const { command, hook, timeoutS } = armed;
  const { backlog, result } = pending;
  armed = null;
  pending = null;
  const env = Object.assign({}, process.env);
  delete env.NJ_ON_CHANGE;
  delete env.NJ_ON_CHANGE_TIMEOUT;
  env.NJ_HOOK_COMMAND = command;
  env.NJ_HOOK_IDS = hookIds(result).join(",");
  env.NJ_BACKLOG = backlog;
  let child;
  try {
    child = spawn("/bin/sh", ["-c", hook], { cwd: backlog, env, stdio: ["pipe", 2, 2], detached: true });
  } catch (e) {
    warn(`could not be started (${e && e.message ? e.message : String(e)})`);
    return;
  }
  let settled = false;
  let timedOut = false;
  const killGroup = () => {
    if (child.pid === void 0) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
    }
  };
  const onSignal = (sig) => {
    killGroup();
    detachSignals();
    process.kill(process.pid, sig);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const detachSignals = () => {
    for (const s of signals) process.removeListener(s, onSignal);
  };
  for (const s of signals) process.on(s, onSignal);
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, timeoutS * 1e3);
  const settle = () => {
    settled = true;
    clearTimeout(timer);
    detachSignals();
  };
  child.on("error", (e) => {
    if (settled) return;
    settle();
    warn(`could not be started (${e.message})`);
  });
  child.on("exit", (code, signal) => {
    if (settled) return;
    settle();
    if (timedOut) warn(`timed out after ${timeoutS}s and was killed`);
    else if (signal !== null) warn(`was killed by ${signal}`);
    else if (code !== 0) warn(`exited with status ${code}${code === 127 ? " (command not found)" : ""}`);
  });
  child.stdin.on("error", () => {
  });
  child.stdin.end(JSON.stringify(result, null, 2) + "\n");
}

// src/core/status.ts
import * as fs9 from "node:fs";
import * as path8 from "node:path";
function statusPath(backlog) {
  return path8.join(backlog, "STATUS.md");
}
function renderStatus(elements, cfg) {
  const sections = new Map(cfg.statuses.map((s) => [s, []]));
  const other = [];
  for (const el of elements) {
    if (el.archived) continue;
    const list = el.readable ? sections.get(el.status) : void 0;
    (list === void 0 ? other : list).push(el);
  }
  const line = (el) => {
    const link = (el.folder === "" ? "" : el.folder + "/") + path8.basename(el.file);
    return `- [${el.id}](${link})` + (el.title === "" ? "" : " " + el.title);
  };
  const block = (name, els) => [`## ${name} (${els.length})`].concat(els.length > 0 ? ["", ...els.slice().sort(compareElements).map(line)] : []).join("\n");
  const blocks = ["# Status"].concat(Array.from(sections, ([name, els]) => block(name, els)));
  if (other.length > 0) blocks.push(block("?", other));
  return blocks.join("\n\n") + "\n";
}
function statusIsFresh(backlog, elements, cfg) {
  let current;
  try {
    current = fs9.readFileSync(statusPath(backlog), "utf8");
  } catch {
    return false;
  }
  return current === renderStatus(elements, cfg);
}
var CTIME_MARGIN_MS = 2e3;
function refreshStatus(backlog, cfg, ctx) {
  if (!cfg.layout.statusFile) return false;
  try {
    const known = new Map(ctx ? ctx.elements.map((e) => [e.file, e]) : []);
    const cutoff = ctx ? ctx.loadedAt - CTIME_MARGIN_MS : -Infinity;
    const elements = scanBacklog(backlog, cfg.layout).files.map(({ file, folder }) => {
      const had = known.get(file);
      if (had !== void 0) {
        let ctime = Infinity;
        try {
          ctime = fs9.statSync(file).ctimeMs;
        } catch {
        }
        if (ctime < cutoff) return had;
      }
      return loadElement(file, backlog, cfg, folder);
    });
    const fresh = renderStatus(elements, cfg);
    let current = null;
    try {
      current = fs9.readFileSync(statusPath(backlog), "utf8");
    } catch {
    }
    if (current === fresh) return false;
    atomicReplace(statusPath(backlog), fresh);
    return true;
  } catch (e) {
    const reason = e && e.message ? String(e.message).split("\n")[0] : String(e);
    process.stderr.write(`Warning: STATUS.md not updated (${reason})
`);
    return false;
  }
}

// src/core/tags.ts
import * as fs10 from "node:fs";
import * as path9 from "node:path";

// src/core/suggest.ts
var SYNONYMS = {
  type: {},
  status: {},
  priority: { medium: "normal" }
};
var FIELD_LABEL = { type: "types", status: "statuses", priority: "priorities" };
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
function listHint(label, value, allowed) {
  const known = `Known ${label}: ${allowed.join(", ")}`;
  const suggestion = nearestMatch(value, allowed);
  return suggestion === null ? known : `did you mean '${suggestion}'? ${known}`;
}

// src/core/tags.ts
function tagsPath(backlog) {
  return path9.join(backlog, "TAGS.md");
}
function tagCounts(elements) {
  const counts = /* @__PURE__ */ new Map();
  for (const el of elements) {
    for (const t of el.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}
function renderTags(elements, cfg) {
  void cfg;
  const counts = tagCounts(elements);
  const names = Array.from(counts.keys()).sort();
  const lines = names.map((name) => `- \`${name}\` (${counts.get(name)})`);
  const body = lines.length > 0 ? lines.join("\n") : "(no tags in use)";
  return `# Tags

${body}
`;
}
function tagsIsFresh(backlog, elements, cfg) {
  let current;
  try {
    current = fs10.readFileSync(tagsPath(backlog), "utf8");
  } catch {
    return false;
  }
  return current === renderTags(elements, cfg);
}
var CTIME_MARGIN_MS2 = 2e3;
function refreshTags(backlog, cfg, ctx) {
  if (!cfg.layout.tagsFile) return false;
  try {
    const known = new Map(ctx ? ctx.elements.map((e) => [e.file, e]) : []);
    const cutoff = ctx ? ctx.loadedAt - CTIME_MARGIN_MS2 : -Infinity;
    const elements = scanBacklog(backlog, cfg.layout).files.map(({ file, folder }) => {
      const had = known.get(file);
      if (had !== void 0) {
        let ctime = Infinity;
        try {
          ctime = fs10.statSync(file).ctimeMs;
        } catch {
        }
        if (ctime < cutoff) return had;
      }
      return loadElement(file, backlog, cfg, folder);
    });
    const fresh = renderTags(elements, cfg);
    let current = null;
    try {
      current = fs10.readFileSync(tagsPath(backlog), "utf8");
    } catch {
    }
    if (current === fresh) return false;
    atomicReplace(tagsPath(backlog), fresh);
    return true;
  } catch (e) {
    const reason = e && e.message ? String(e.message).split("\n")[0] : String(e);
    process.stderr.write(`Warning: TAGS.md not updated (${reason})
`);
    return false;
  }
}
function normalizeTag(s) {
  return s.toLowerCase().replace(/[-_]/g, "");
}
function nearMatchTag(tag, known) {
  const target = normalizeTag(tag);
  const threshold = target.length <= 4 ? 1 : 2;
  const byNorm = /* @__PURE__ */ new Map();
  for (const k of known) {
    const nk = normalizeTag(k);
    if (!byNorm.has(nk)) byNorm.set(nk, k);
  }
  let best = [];
  let bestDist = Infinity;
  for (const [nk, raw] of byNorm) {
    const d = osaDistance(target, nk);
    if (d < bestDist) {
      bestDist = d;
      best = [raw];
    } else if (d === bestDist) best.push(raw);
  }
  return bestDist <= threshold && best.length === 1 ? best[0] : null;
}
function warnTagNearMatches(newTags, priorTags) {
  const known = new Set(priorTags);
  for (const tag of newTags) {
    if (known.has(tag)) continue;
    const match = nearMatchTag(tag, Array.from(known));
    if (match !== null) {
      process.stderr.write(
        `Warning: tag '${tag}' looks like it might be a drifted spelling of existing tag '${match}' -- did you mean to reuse '${match}'?
`
      );
    }
    known.add(tag);
  }
}

// src/commands/cmd-archive.ts
var STABLE_HINT = "retry once the backlog is stable \u2014 archive takes no --force";
function archiveFlat(ctx, subtree, ts) {
  const archiveDir = path10.join(ctx.backlog, ctx.cfg.layout.folders.archive);
  fs11.mkdirSync(archiveDir, { recursive: true });
  const plan = subtree.map((e) => ({ el: e, target: path10.join(archiveDir, path10.basename(e.file)) }));
  for (const { target } of plan) {
    if (fs11.existsSync(target)) {
      fail(
        "exists",
        `${target} already exists \u2014 refusing to overwrite; nothing was moved`,
        `move or delete the file in ${ctx.cfg.layout.folders.archive}/, then archive again`
      );
    }
  }
  for (const { el: e } of plan) compareGuard(e, false, ctx.backlog, STABLE_HINT);
  const moved = [];
  for (const { el: e, target } of plan) {
    atomicWrite(target, renderElement(e, /* @__PURE__ */ new Map([["archived", ts], ["updated", ts]]), void 0));
    fs11.unlinkSync(e.file);
    moved.push(loadElement(target, ctx.backlog, ctx.cfg));
  }
  return moved;
}
function archiveHierarchy(ctx, el, subtree, ts) {
  const refuse = (why) => fail(
    "refused:misplaced",
    `${el.id} cannot be archived \u2014 ${why}; nothing was moved`,
    "run `nanojira doctor --fix` to move the files into their places, then archive again"
  );
  const off = subtree.filter((e) => e.problems.has("layout:misplaced"));
  if (off.length > 0) refuse(`these files are not where the layout puts them: ${off.map((e) => e.id).join(", ")}`);
  let src = el.file;
  if (el.type !== "subtask") {
    const own = ownFolder(el);
    if (own === null) return refuse(`${el.file} does not lie in a folder of its own named ${el.id}/`);
    const inside = (f) => f.startsWith(own + path10.sep);
    const outside = subtree.filter((e) => !inside(e.file));
    if (outside.length > 0) refuse(`part of its subtree lies outside ${own}/: ${outside.map((e) => e.id).join(", ")}`);
    const foreign = ctx.elements.filter((e) => inside(e.file) && !subtree.includes(e));
    if (foreign.length > 0) refuse(`${own}/ also holds files of other elements: ${foreign.map((e) => e.id).join(", ")}`);
    src = own;
  }
  const dst = path10.join(ctx.backlog, ctx.cfg.layout.folders.archive, path10.relative(ctx.backlog, src));
  const plan = planMove(src, dst);
  if (plan.conflicts.length > 0) {
    fail(
      "exists",
      `${plan.conflicts[0]} already exists \u2014 refusing to overwrite; nothing was moved`,
      `move or delete it in ${ctx.cfg.layout.folders.archive}/, then archive again`
    );
  }
  for (const e of subtree) compareGuard(e, false, ctx.backlog, STABLE_HINT);
  for (const e of subtree) atomicWrite(e.file, renderElement(e, /* @__PURE__ */ new Map([["archived", ts], ["updated", ts]]), void 0));
  runMove(plan);
  return subtree.map((e) => loadElement(path10.join(dst, path10.relative(src, e.file)), ctx.backlog, ctx.cfg));
}
function cmdArchive(flags) {
  checkCommandFlags(flags, "archive");
  const json = flags.has("json");
  const ctx = context(flags);
  requireNoStubs(ctx, "archive");
  requireNoUnreadableDirs(ctx, "archive");
  const el = resolveTarget(ctx, flags, true);
  requireActive(el, "archive");
  const subtree = [el].concat(descendants(ctx, el)).filter((e) => !e.archived);
  const open = subtree.filter((e) => e.status !== "done");
  if (open.length > 0) {
    const names = open.map((c) => `  ${c.id}  ${c.status.padEnd(8)} ${c.title}`).join("\n");
    fail(
      "refused:not_done",
      `${el.id} cannot be archived \u2014 these elements are not done:
${names}`,
      "finish them first; there is no --force for archiving"
    );
  }
  for (const e of subtree) requireWritable(e);
  const ts = nowIso();
  const moved = ctx.cfg.layout.group === "hierarchy" ? archiveHierarchy(ctx, el, subtree, ts) : archiveFlat(ctx, subtree, ts);
  for (const e of subtree) removeClaimDirWholesale(ctx.backlog, e.id);
  deriveGraph(ctx.elements.filter((e) => !subtree.includes(e)).concat(moved), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const built = {
    ok: true,
    ids: moved.map((m) => m.id),
    changed: ["archived"],
    entries: moved.map((m) => entryJson(m, ctx.backlog, ctx.cfg)),
    _problems: Array.from(new Set(moved.flatMap((m) => elementProblems(m, ctx.cfg.problems.ignore)))).sort()
  };
  recordChange(ctx.backlog, () => built);
  if (json) {
    out(JSON.stringify(built, null, 2));
  } else {
    for (const m of moved) out(`${m.id} archived \u2192 ${m.file}`);
  }
  return 0;
}

// src/core/batch.ts
function parseBatchIds(flags) {
  const raw = flagString(flags, "id");
  if (raw === void 0 || !raw.includes(",")) return null;
  const ids = raw.split(",").map((s) => s.trim());
  const seen = /* @__PURE__ */ new Set();
  for (const id of ids) {
    if (seen.has(id)) fail("invalid_value", `'${id}' is named twice in --id=${raw} (after trimming whitespace)`);
    seen.add(id);
  }
  return ids;
}
function asFailure(id, e) {
  if (e instanceof Fail) return { id, ok: false, error: e.code, hint: e.hint };
  return { id, ok: false, error: "internal_error", hint: e instanceof Error ? e.stack : String(e) };
}
function runBatch(ids, preflight, write) {
  const items = [];
  const preflightFailures = [];
  for (const id of ids) {
    try {
      items.push(preflight(id));
    } catch (e) {
      preflightFailures.push(asFailure(id, e));
    }
  }
  if (preflightFailures.length > 0) {
    return { ok: false, results: preflightFailures, anyWritten: false };
  }
  const results = [];
  let anyWritten = false;
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = write(items[i]);
      anyWritten = true;
      results.push(Object.assign({ id: ids[i] }, r));
    } catch (e) {
      const failure = asFailure(ids[i], e);
      results.push(failure);
      if (failure.error.startsWith("fault:") && process.env.NJ_FAULT !== void 0) delete process.env.NJ_FAULT;
    }
  }
  return { ok: results.every((r) => r.ok === true), results, anyWritten };
}

// src/core/result-opts.ts
function parseOutputOpts(flags, json) {
  const quiet = flags.has("quiet");
  const fieldsRaw = flagString(flags, "fields");
  if (quiet && fieldsRaw !== void 0) {
    fail(
      "invalid_value",
      "--quiet cannot be combined with --fields",
      "use --fields=<list> to choose fields, or --quiet for {ok, id}"
    );
  }
  if (quiet && !json) fail("invalid_value", "--quiet requires --json");
  if (fieldsRaw !== void 0 && !json) fail("invalid_value", "--fields requires --json");
  if (fieldsRaw === void 0) return { quiet };
  const names = fieldsRaw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (names.length === 0) fail("invalid_value", "--fields must not be empty");
  for (const n of names) {
    if (!ENTRY_FIELDS.includes(n)) {
      fail("invalid_value", `unknown field '${n}' in --fields`, listHint("entry fields", n, ENTRY_FIELDS));
    }
  }
  return { quiet, fields: names };
}
function trimResult(result, opts) {
  if (opts.quiet) {
    const out2 = { ok: result.ok, id: result.id };
    const probs = result._problems;
    if (Array.isArray(probs) && probs.length > 0) out2._problems = probs;
    return out2;
  }
  if (opts.fields !== void 0) {
    const entry = result.entry;
    if (entry === void 0) return result;
    const projected = {};
    for (const f of opts.fields) if (f in entry) projected[f] = entry[f];
    return Object.assign({}, result, { entry: projected });
  }
  return result;
}
function emitWriteResultOpts(json, el, changed, backlog, cfg, extra, opts) {
  if (!json) return;
  const result = buildWriteResult(el, changed, backlog, cfg, extra);
  const final = opts.quiet || opts.fields !== void 0 ? trimResult(result, opts) : result;
  out(JSON.stringify(final, null, 2));
}

// src/commands/cmd-check.ts
function scanCheckboxes(body) {
  const lines = body.split("\n");
  const boxes = [];
  let inNotes = false;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) fence = null;
      continue;
    }
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length };
      continue;
    }
    if (/^#{1,2}[ \t]/.test(line)) {
      const h2 = /^##[ \t]+(.*?)[ \t]*$/.exec(line);
      inNotes = !!h2 && h2[1].replace(/:\s*$/, "").trim().toLowerCase() === "notes";
      continue;
    }
    if (inNotes) continue;
    const m = CHECKBOX_RE.exec(line);
    if (m) boxes.push({ line: i, rest: m[4], ticked: m[3] !== " " });
  }
  return { lines, boxes };
}
function prepareCheck(el, text, item, wantOn) {
  const { lines, boxes } = scanCheckboxes(el.body);
  let target;
  if (item !== void 0) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 1 || n > boxes.length) fail("not_found", `--item=${item} is out of range (1..${boxes.length})`);
    target = boxes[n - 1];
  } else {
    const matches = boxes.filter((b) => b.rest.includes(text));
    if (matches.length === 0) fail("not_found", `no checkbox line contains '${text}'`);
    if (matches.length > 1) {
      fail("ambiguous_target", `'${text}' matches ${matches.length} checkbox lines`, "--item=<n> addresses exactly one, or narrow --text");
    }
    target = matches[0];
  }
  if (target.ticked === wantOn) return { el, newBody: null };
  const line = lines[target.line];
  const m = CHECKBOX_RE.exec(line);
  lines[target.line] = `${m[1]}${m[2]} [${wantOn ? "x" : " "}]${m[4]}`;
  return { el, newBody: lines.join("\n") };
}
function cmdCheck(flags) {
  checkCommandFlags(flags, "check");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);
  requireTargetFlagSyntax(flags);
  const text = flagString(flags, "text");
  const item = flagString(flags, "item");
  if (text !== void 0 && item !== void 0) fail("invalid_value", "use either --text or --item, not both");
  if (text === void 0 && item === void 0) fail("missing_argument", "nanojira check needs --text=<substring> or --item=<n>");
  if (text === "") fail("invalid_value", "--text must not be empty");
  if (flags.has("on") && flags.has("off")) fail("invalid_value", "use either --on or --off, not both");
  const wantOn = !flags.has("off");
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const ts2 = nowIso();
    const result = runBatch(
      batchIds,
      (id) => {
        const el2 = resolveById(ctx, id, true);
        requireWritable(el2);
        requireActive(el2, "check");
        return prepareCheck(el2, text, item, wantOn);
      },
      (prepared2) => {
        if (prepared2.newBody === null) {
          const entry2 = entryJson(prepared2.el, ctx.backlog, ctx.cfg);
          return { ok: true, changed: [], entry: entry2, _problems: entry2._problems };
        }
        guardedWriteCatchable(prepared2.el, renderElement(prepared2.el, /* @__PURE__ */ new Map([["updated", ts2]]), prepared2.newBody), flags.has("force"), ctx.backlog);
        const fresh2 = loadElement(prepared2.el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e) => e.file === prepared2.el.file ? fresh2 : e), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh2, ctx.backlog, ctx.cfg);
        return { ok: true, changed: ["body"], entry, _problems: entry._problems };
      }
    );
    if (result.anyWritten) {
      refreshStatus(ctx.backlog, ctx.cfg, ctx);
      refreshTags(ctx.backlog, ctx.cfg, ctx);
    }
    const results = opts.quiet || opts.fields !== void 0 ? result.results.map((r) => r.ok ? trimResult(r, opts) : r) : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results) out(r.ok ? `${r.id} ${wantOn ? "checked" : "unchecked"}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, "check");
  const prepared = prepareCheck(el, text, item, wantOn);
  if (prepared.newBody === null) {
    recordChange(ctx.backlog, () => buildWriteResult(el, [], ctx.backlog, ctx.cfg));
    if (json) emitWriteResultOpts(true, el, [], ctx.backlog, ctx.cfg, void 0, opts);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }
  const ts = nowIso();
  guardedWrite(el, renderElement(el, /* @__PURE__ */ new Map([["updated", ts]]), prepared.newBody), flags.has("force"), ctx.backlog);
  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e) => e.file === el.file ? fresh : e), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  recordChange(ctx.backlog, () => buildWriteResult(fresh, ["body"], ctx.backlog, ctx.cfg));
  if (json) emitWriteResultOpts(true, fresh, ["body"], ctx.backlog, ctx.cfg, void 0, opts);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} ${wantOn ? "checked" : "unchecked"}`);
  return 0;
}

// src/core/actor.ts
function validActorName(raw) {
  const trimmed = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  if (trimmed === "" || /[\n\r]/.test(trimmed) || trimmed.includes(":")) return null;
  return trimmed;
}
function resolveActingName(flags, required) {
  const asRaw = flagString(flags, "as");
  if (asRaw !== void 0) {
    const name = validActorName(asRaw);
    if (name === null) fail("invalid_value", `invalid --as '${asRaw}' (must be non-empty after trimming spaces/tabs, a single line, and contain no ':')`);
    return name;
  }
  const envRaw = process.env.NJ_AUTHOR;
  if (envRaw !== void 0 && envRaw !== "") {
    const name = validActorName(envRaw);
    if (name === null) fail("invalid_env", `invalid NJ_AUTHOR '${envRaw}' (must be non-empty after trimming spaces/tabs, a single line, and contain no ':')`);
    return name;
  }
  if (required) fail("missing_argument", "an acting name is required: pass --as=<name> or set NJ_AUTHOR");
  return null;
}
function actingNameForRead() {
  const envRaw = process.env.NJ_AUTHOR;
  if (envRaw === void 0 || envRaw === "") return null;
  return validActorName(envRaw);
}

// src/commands/cmd-claim.ts
var STABLE_HINT2 = "the element changed in parallel \u2014 nanojira claim takes no --force; retry once it is stable";
function claimOne(ctx, el, name, status, steal, ts) {
  const decide = (h) => {
    const held = h && h.kind === "claimed" ? h.name : null;
    if (steal !== void 0) {
      if (held !== null && held !== steal) return { terminal: true, holder: held };
      return { append: { kind: "claimed", name } };
    }
    if (held !== null && held !== name) return { terminal: true, holder: held };
    return { append: { kind: "claimed", name } };
  };
  const t = transition(ctx.backlog, el.id, ts, decide);
  if (!t.ok) {
    if (t.terminal === "changed_in_parallel") {
      fail("changed_in_parallel", `${el.id}: too many concurrent claim attempts, please retry`);
    }
    fail("refused:claimed", `${el.id} is already claimed by ${t.holder} \u2014 refused`, "use --steal=<holder> to take it over");
  }
  const reassert = t.base !== null && t.base.kind === "claimed" && t.base.name === name;
  const landedSteal = !reassert && steal !== void 0 && t.base !== null && t.base.kind === "claimed";
  const stolenFrom = landedSteal ? t.base.name : void 0;
  const previousAssignee = el.assignee !== "" && el.assignee !== name ? el.assignee : void 0;
  const changed = [];
  if (el.assignee !== name) changed.push("assignee");
  if (status !== void 0 && status !== el.status) changed.push("status");
  const overrides = /* @__PURE__ */ new Map([["assignee", name], ["updated", ts]]);
  if (status !== void 0) overrides.set("status", status);
  const isFinalStatus = status !== void 0 && status === ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
  const released = isFinalStatus ? releaseUnconditional(ctx.backlog, el.id, ts) : void 0;
  try {
    compareGuard(el, false, ctx.backlog, STABLE_HINT2, true);
    mirrorWrite(el.file, renderElement(el, overrides, void 0));
  } catch (e) {
    if (released !== void 0) undoRelease(ctx.backlog, el.id, released.holder, ts);
    if (!landedSteal) {
      const h = highestEntry(claimsDir(ctx.backlog, el.id));
      const restore = reassert ? { kind: "claimed", name } : { kind: "released", name };
      rollback(ctx.backlog, el.id, h ? h.gen : 0, restore.kind, restore.name, ts);
    }
    throw e;
  }
  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e) => e.file === el.file ? fresh : e), ctx.idsDir, ctx.cfg);
  const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
  const claim2 = released !== void 0 ? null : { by: name, since: ts };
  return Object.assign(
    { ok: true, changed, entry, _problems: entry._problems, claim: claim2 },
    stolenFrom !== void 0 ? { stolen_from: stolenFrom } : {},
    previousAssignee !== void 0 ? { previous_assignee: previousAssignee } : {},
    released !== void 0 ? { released: released.holder } : {},
    openAcceptanceExtra(fresh, ctx.cfg, isFinalStatus)
  );
}
function cmdClaim(flags) {
  checkCommandFlags(flags, "claim");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);
  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true);
  const status = flagString(flags, "status");
  if (status !== void 0 && !ctx.cfg.statuses.includes(status)) {
    fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, ctx.cfg.statuses));
  }
  const steal = flagString(flags, "steal");
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const result = runBatch(
      batchIds,
      (id) => {
        const el2 = resolveById(ctx, id, true);
        requireWritable(el2);
        requireActive(el2, "claim");
        return el2;
      },
      (el2) => claimOne(ctx, el2, name, status, steal, nowIso())
    );
    if (result.anyWritten) {
      refreshStatus(ctx.backlog, ctx.cfg, ctx);
      refreshTags(ctx.backlog, ctx.cfg, ctx);
    }
    const results = opts.quiet || opts.fields !== void 0 ? result.results.map((r) => r.ok ? trimResult(r, opts) : r) : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results) out(r.ok ? `${r.id} claimed by ${name}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, "claim");
  const ts = nowIso();
  const single = claimOne(ctx, el, name, status, steal, ts);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const built = Object.assign({ ok: single.ok, id: el.id }, single);
  recordChange(ctx.backlog, () => built);
  if (json) {
    const final = opts.quiet || opts.fields !== void 0 ? trimResult(built, opts) : built;
    out(JSON.stringify(final, null, 2));
  } else {
    out(`${el.id} claimed by ${name}${status !== void 0 ? ` (status: ${status})` : ""}`);
    for (const code of single._problems) out(`\u26A0 ${el.id}: ${code}`);
  }
  return 0;
}

// src/commands/cmd-list.ts
function availableToActor(backlog, id, name) {
  const claim2 = readClaim(backlog, id);
  return claim2 === null || claim2.by === name;
}
function applyFilters(elements, flags, cfg) {
  const all = flags.has("all");
  let list = elements.filter((e) => all || !e.archived);
  const status = flagString(flags, "status");
  if (status !== void 0) {
    if (!cfg.statuses.includes(status)) {
      fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, cfg.statuses));
    }
    list = list.filter((e) => e.status === status);
  }
  const type = flagString(flags, "type");
  if (type !== void 0) {
    if (!TYPES.includes(type)) fail("invalid_value", `unknown type '${type}'`, valueHint("type", type, TYPES));
    list = list.filter((e) => e.type === type);
  }
  const tag = flagString(flags, "tag");
  if (tag !== void 0) list = list.filter((e) => e.tags.includes(tag));
  const parent = flagString(flags, "parent");
  if (parent !== void 0) {
    if (!elements.some((e) => e.id === parent)) {
      fail("not_found", `--parent '${parent}' does not exist`, "filters are validated so a typo never looks like an empty backlog");
    }
    list = list.filter((e) => e.parent === parent);
  }
  const assignee = flagString(flags, "assignee");
  if (assignee !== void 0) list = list.filter((e) => e.assignee === assignee);
  return list.sort(compareElements);
}
function cmdList(flags) {
  checkCommandFlags(flags, "list");
  const ctx = context(flags);
  const scope = ctx.elements.filter((e) => flags.has("all") || !e.archived);
  const filtered = applyFilters(ctx.elements, flags, ctx.cfg);
  if (flags.has("ready")) {
    const actor = actingNameForRead();
    const ready = filtered.filter((e) => isReady(e, ctx.cfg) && availableToActor(ctx.backlog, e.id, actor));
    const blocked = filtered.filter((e) => !isReady(e, ctx.cfg) && e.status === ctx.cfg.statuses[0] && isIncomplete(e));
    if (flags.has("json")) {
      out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: ready.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
      return 0;
    }
    out("Ready to work:");
    if (ready.length === 0) out("  (none)");
    for (const e of ready) out(`  ${e.id}  ${e.title}`);
    if (blocked.length > 0) {
      out("");
      out("Complete first:");
      for (const e of blocked) {
        out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c) => c.startsWith("incomplete:")).join(" ")}`);
      }
    }
    return 0;
  }
  if (flags.has("json")) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: filtered.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (filtered.length === 0) {
    out("(no matching elements)");
    return 0;
  }
  for (const e of filtered) printEntryLine(e, ctx.cfg);
  return 0;
}

// src/commands/cmd-find.ts
var CONTEXT_MAX = 100;
function truncate(s) {
  return s.length > CONTEXT_MAX ? s.slice(0, CONTEXT_MAX) + "\u2026" : s;
}
function matchContext(el, needle, fold) {
  for (const line of el.body.split("\n")) {
    if (fold(line).includes(needle)) return truncate(line.trim());
  }
  if (fold(el.title).includes(needle)) return truncate(el.title);
  return null;
}
function cmdFind(flags, positional) {
  checkCommandFlags(flags, "find");
  if (positional.length === 0) fail("missing_argument", "nanojira find needs the search text as an argument", 'nanojira find "<text>"');
  const text = positional.join(" ");
  if (text === "") fail("invalid_value", "<text> must not be empty");
  const ctx = context(flags);
  const scope = ctx.elements.filter((e) => flags.has("all") || !e.archived);
  const filtered = applyFilters(ctx.elements, flags, ctx.cfg);
  const caseSensitive = flags.has("case-sensitive");
  const fold = (s) => caseSensitive ? s : s.toLowerCase();
  const needle = fold(text);
  const matched = filtered.filter((e) => fold(e.title).includes(needle) || fold(e.body).includes(needle));
  if (flags.has("json")) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: matched.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (matched.length === 0) {
    out("(no matches)");
    return 0;
  }
  for (const e of matched) {
    printEntryLine(e, ctx.cfg);
    const line = matchContext(e, needle, fold);
    if (line !== null) out(`    ${line}`);
  }
  return 0;
}

// src/commands/cmd-doctor.ts
import * as fs14 from "node:fs";
import * as path12 from "node:path";

// src/commands/cmd-new.ts
import * as fs13 from "node:fs";
import * as path11 from "node:path";

// src/core/input.ts
import * as fs12 from "node:fs";
function readInputText(value) {
  if (value === "-") {
    try {
      return fs12.readFileSync(0, "utf8");
    } catch (e) {
      return fail("invalid_value", `cannot read stdin \u2014 ${e.message}`, "pipe the JSON in, or pass a path with --input=<path>");
    }
  }
  try {
    return fs12.readFileSync(value, "utf8");
  } catch (e) {
    return fail("not_found", `--input: cannot read '${value}' \u2014 ${e.message}`);
  }
}
function parseInputJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fail("invalid_value", `--input is not valid JSON \u2014 ${e.message}`);
  }
}

// src/commands/cmd-new.ts
function collidesCaseInsensitively(dir, name) {
  let names;
  try {
    names = fs13.readdirSync(dir);
  } catch {
    return false;
  }
  const lower = name.toLowerCase();
  return names.some((n) => n.toLowerCase() === lower);
}
function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
function checkExplicitParent(ctx, type, parent, verb = "create") {
  if (type === "epic") {
    if (parent !== void 0) fail("invalid_value", "epics must not have a --parent");
    return void 0;
  }
  if (parent === void 0) return fail("missing_argument", `--parent is required for ${type} (must be ${article(PARENT_TYPE[type])} ${PARENT_TYPE[type]})`);
  const p = ctx.elements.find((e) => e.id === parent);
  if (!p) return fail("not_found", `parent '${parent}' does not exist`);
  if (p.problems.has("file:unreadable") || p.problems.has("frontmatter:unreadable")) {
    fail(
      "refused:unreadable",
      `parent '${parent}' (${p.file}) cannot be read \u2014 refusing to create a child under it`,
      "its type cannot be verified; repair the file, then run `nanojira doctor`"
    );
  }
  if (p.type !== PARENT_TYPE[type]) {
    fail("invalid_target", `parent '${parent}' is ${article(p.type)} ${p.type}, but ${article(type)} ${type} needs ${article(PARENT_TYPE[type])} ${PARENT_TYPE[type]}`);
  }
  if (p.archived) {
    fail(
      "refused:parent_archived",
      `parent '${parent}' is archived \u2014 refusing to ${verb} a child under it`,
      "a fresh child of an archived parent would immediately carry archive:split"
    );
  }
  return p.id;
}
function validateNewFlags(ctx, flags) {
  const type = flagString(flags, "type");
  if (type === void 0) return fail("missing_argument", "--type is required", `Known types: ${TYPES.join(", ")}`);
  if (!TYPES.includes(type)) return fail("invalid_value", `unknown type '${type}'`, valueHint("type", type, TYPES));
  const title = flagString(flags, "title");
  if (title === void 0 || normalizeTitle(title) === "") return fail("missing_argument", "--title is required and must not be empty");
  const cleanTitle = normalizeTitle(title);
  const parent = flagString(flags, "parent");
  checkExplicitParent(ctx, type, parent);
  const status = flagString(flags, "status");
  if (status !== void 0 && !ctx.cfg.statuses.includes(status)) {
    fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, ctx.cfg.statuses));
  }
  const priority = flagString(flags, "priority");
  if (priority !== void 0 && !PRIORITIES.includes(priority)) {
    fail("invalid_value", `unknown priority '${priority}'`, valueHint("priority", priority, PRIORITIES));
  }
  const assignee = flagString(flags, "assignee");
  const tags = parseListFlag(flags, "tags");
  const deps = parseListFlag(flags, "depends_on");
  if (deps !== void 0) {
    for (const d of deps) {
      if (!ctx.elements.some((e) => e.id === d)) fail("not_found", `depends_on target '${d}' does not exist`);
    }
  }
  const sections = readSectionFlags(flags);
  return { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections };
}
function newPlace(ctx, type, id, parent) {
  const { group, folders } = ctx.cfg.layout;
  if (group === "type") return folders[TYPE_FOLDER_ROLE[type]];
  if (group === "flat") return "";
  const own = type === "subtask" ? [] : [id];
  if (parent === void 0) return own.join("/");
  const p = ctx.elements.find((e) => e.id === parent);
  const at = expectedPlace(p, p.byId, ctx.cfg.layout);
  return [at === null ? folderOf(ctx.backlog, p.file) : at].concat(own).filter((s) => s !== "").join("/");
}
function buildBody(ctx, type, cleanTitle, sections) {
  let body = `
# ${cleanTitle}

## ${ctx.cfg.sections.description[0]}
`;
  if (type !== "epic") body += `
## ${ctx.cfg.sections.acceptance[0]}
`;
  if (sections.size > 0) body = applySections(body, sections, ctx.cfg).body;
  return body;
}
function cmdNew(flags) {
  checkCommandFlags(flags, "new");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);
  const inputValue = flagString(flags, "input");
  if (inputValue !== void 0) {
    for (const f of cliFieldNames("new")) {
      if (flags.has(f)) fail("invalid_value", "--input cannot be combined with field flags");
    }
    if (opts.quiet || opts.fields !== void 0) fail("invalid_value", "--input cannot be combined with --quiet or --fields");
    return cmdNewInput(ctx, inputValue);
  }
  const { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections } = validateNewFlags(ctx, flags);
  let id, dir, file;
  for (let attempt = 0; ; attempt++) {
    id = allocateId(ctx.idsDir, type, ctx.elements, ctx.cfg.ids.shardSize);
    dir = path11.join(ctx.backlog, ...newPlace(ctx, type, id, parent).split("/"));
    file = path11.join(dir, id + ".md");
    if (!collidesCaseInsensitively(dir, id + ".md")) break;
    if (attempt >= 100) return hardExit("id_allocation_failed", `nanojira: id allocation failed after 100 retries (${id} collides with an existing file)`);
  }
  const ts = nowIso();
  const fields = /* @__PURE__ */ new Map();
  fields.set("id", id);
  fields.set("type", type);
  if (parent !== void 0) fields.set("parent", parent);
  fields.set("title", cleanTitle);
  fields.set("status", status === void 0 ? ctx.cfg.statuses[0] : status);
  if (priority !== void 0) fields.set("priority", priority);
  if (assignee !== void 0 && assignee !== "") fields.set("assignee", assignee);
  if (tags !== void 0 && tags.length > 0) fields.set("tags", tags);
  if (deps !== void 0 && deps.length > 0) fields.set("depends_on", deps);
  fields.set("created", ts);
  fields.set("updated", ts);
  const body = buildBody(ctx, type, cleanTitle, sections);
  fs13.mkdirSync(dir, { recursive: true });
  atomicWrite(file, serialize(fields, Array.from(fields.keys()), body));
  if (tags !== void 0 && tags.length > 0) warnTagNearMatches(tags, ctx.elements.flatMap((e) => e.tags));
  const el = loadElement(file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.concat([el]), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const changed = FIELD_ORDER.filter((f) => fields.has(f) && f !== "created" && f !== "updated").concat(SECTION_ROLES.filter((r) => sections.has(r)));
  recordChange(ctx.backlog, () => buildWriteResult(el, changed, ctx.backlog, ctx.cfg));
  if (json) emitWriteResultOpts(true, el, changed, ctx.backlog, ctx.cfg, void 0, opts);
  else writeFeedback(el, ctx.cfg, `${id} created \u2192 ${file}`);
  return 0;
}
var REAL_ID_SHAPE = new RegExp("^(" + Object.values(TYPE_PREFIX).join("|") + ")-\\d+$");
var PLAN_ALLOWED_KEYS = /* @__PURE__ */ new Set([...NEW_FIELDS, "ref"]);
function failAtPath(code, message, path16) {
  const e = new Fail(message, void 0, code);
  e.failedAt = path16;
  throw e;
}
function flattenPlan(nodes, basePath, parentIndex, out2) {
  nodes.forEach((raw, i) => {
    const nodePath = `${basePath}[${i}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      failAtPath("invalid_value", `plan element at ${nodePath} must be a JSON object`, nodePath);
    }
    const obj = raw;
    const children = obj.children;
    const rest = {};
    for (const k of Object.keys(obj)) if (k !== "children") rest[k] = obj[k];
    const myIndex = out2.length;
    out2.push({ path: nodePath, raw: rest, parentIndex, hadChildren: children !== void 0 });
    if (children !== void 0) {
      if (!Array.isArray(children)) failAtPath("invalid_value", `'children' at ${nodePath} must be an array`, nodePath);
      flattenPlan(children, `${nodePath}.children`, myIndex, out2);
    }
  });
}
function collectNodeSections(raw, nodePath, stdinState) {
  const wanted = /* @__PURE__ */ new Map();
  for (const role of SECTION_ROLES) {
    const inline = raw[role];
    const filePath = raw[role + "-file"];
    if (inline !== void 0 && filePath !== void 0) {
      fail("invalid_value", `'${role}' and '${role}-file' at ${nodePath} are mutually exclusive`);
    }
    if (inline !== void 0) {
      if (role === "acceptance" && Array.isArray(inline)) {
        for (const line of inline) if (typeof line !== "string") fail("invalid_value", `'acceptance' array items at ${nodePath} must be strings`);
        wanted.set(role, normalizeSectionContent(inline.map((s) => `- [ ] ${s}`).join("\n")));
        continue;
      }
      if (typeof inline !== "string") fail("invalid_value", `'${role}' at ${nodePath} must be a string${role === "acceptance" ? " or an array of strings" : ""}`);
      wanted.set(role, normalizeSectionContent(inline));
      continue;
    }
    if (filePath !== void 0) {
      if (typeof filePath !== "string") fail("invalid_value", `'${role}-file' at ${nodePath} must be a string`);
      if (filePath === "-") {
        if (stdinState.consumed) fail("invalid_value", `${nodePath}: '${role}-file'='-' cannot read stdin \u2014 already consumed`);
        stdinState.consumed = true;
        let stdinText;
        try {
          stdinText = fs13.readFileSync(0, "utf8");
        } catch (e) {
          return fail("invalid_value", `cannot read stdin \u2014 ${e.message}`);
        }
        wanted.set(role, normalizeSectionContent(stdinText));
        continue;
      }
      let text;
      try {
        text = fs13.readFileSync(filePath, "utf8");
      } catch (e) {
        return fail("not_found", `'${role}-file': cannot read '${filePath}' \u2014 ${e.message}`);
      }
      wanted.set(role, normalizeSectionContent(text));
    }
  }
  return wanted;
}
function validatePlanNode(ctx, node, flat, seenRefs, anyRefIndex, declaredSoFar, stdinState) {
  const raw = node.raw;
  for (const k of Object.keys(raw)) {
    if (!PLAN_ALLOWED_KEYS.has(k)) {
      fail("unknown_field", `unknown field '${k}' in --input plan at ${node.path}. Nothing written.`, `Known fields: ${Array.from(PLAN_ALLOWED_KEYS).join(", ")}`);
    }
  }
  const type = raw.type;
  if (type === void 0) fail("missing_argument", `--type is required (${node.path})`, `Known types: ${TYPES.join(", ")}`);
  if (typeof type !== "string" || !TYPES.includes(type)) fail("invalid_value", `unknown type '${String(type)}' (${node.path})`, valueHint("type", String(type), TYPES));
  const titleRaw = raw.title;
  if (titleRaw === void 0 || typeof titleRaw !== "string" || normalizeTitle(titleRaw) === "") {
    fail("missing_argument", `--title is required and must not be empty (${node.path})`);
  }
  const cleanTitle = normalizeTitle(titleRaw);
  if (type === "subtask" && node.hadChildren) {
    fail("invalid_target", `${node.path}: a subtask may not have children`);
  }
  const hasOwnParent = Object.prototype.hasOwnProperty.call(raw, "parent");
  let parentMode;
  let explicitParentId;
  let parentIndex;
  if (node.parentIndex === null) {
    if (hasOwnParent) {
      parentMode = "explicit";
      const p = raw.parent;
      if (typeof p !== "string") fail("invalid_value", `'parent' at ${node.path} must be a string`);
      if (p.startsWith("@")) {
        fail("invalid_value", `'parent' at ${node.path} is never ref-aware \u2014 '@...' is invalid; nest this element under 'children' instead of naming a ref as its parent`);
      }
      explicitParentId = checkExplicitParent(ctx, type, p);
    } else {
      if (type !== "epic") fail("missing_argument", `'parent' is required for ${type} at ${node.path} (must be ${article(PARENT_TYPE[type])} ${PARENT_TYPE[type]})`);
      parentMode = "top";
    }
  } else {
    if (hasOwnParent) fail("invalid_value", `${node.path}: a children entry must not also give 'parent' \u2014 its parent is implied by nesting`);
    parentMode = "implied";
    parentIndex = node.parentIndex;
    const parentType = flat[parentIndex].raw.type;
    if (type === "epic" || PARENT_TYPE[type] !== parentType) {
      fail("invalid_target", `${node.path}: ${article(parentType)} ${parentType} cannot have ${article(String(type))} ${String(type)} child`);
    }
  }
  const status = raw.status;
  if (status !== void 0) {
    if (typeof status !== "string" || !ctx.cfg.statuses.includes(status)) fail("invalid_value", `unknown status '${String(status)}' (${node.path})`, valueHint("status", String(status), ctx.cfg.statuses));
  }
  const priority = raw.priority;
  if (priority !== void 0) {
    if (typeof priority !== "string" || !PRIORITIES.includes(priority)) fail("invalid_value", `unknown priority '${String(priority)}' (${node.path})`, valueHint("priority", String(priority), PRIORITIES));
  }
  const assignee = raw.assignee;
  if (assignee !== void 0 && typeof assignee !== "string") fail("invalid_value", `'assignee' at ${node.path} must be a string`);
  const tagsRaw = raw.tags;
  if (tagsRaw !== void 0 && (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== "string"))) {
    fail("invalid_value", `'tags' at ${node.path} must be an array of strings`);
  }
  const tags = tagsRaw;
  const ref = raw.ref;
  if (ref !== void 0) {
    if (typeof ref !== "string" || !ref.startsWith("@")) fail("invalid_value", `'ref' at ${node.path} must start with '@'`);
    if (REAL_ID_SHAPE.test(ref.slice(1))) fail("invalid_value", `'ref' at ${node.path} looks like a real id ('${ref}') \u2014 a decorated real id is never a valid ref name`);
    if (seenRefs.has(ref)) fail("invalid_value", `'${ref}' is declared on more than one object in this plan`);
    seenRefs.add(ref);
  }
  const depsRaw = raw.depends_on;
  let deps;
  if (depsRaw !== void 0) {
    if (!Array.isArray(depsRaw) || depsRaw.some((d) => typeof d !== "string")) fail("invalid_value", `'depends_on' at ${node.path} must be an array of strings`);
    deps = depsRaw;
    for (const d of deps) {
      if (d.startsWith("@")) {
        if (REAL_ID_SHAPE.test(d.slice(1))) fail("invalid_value", `depends_on entry '${d}' at ${node.path} looks like a real id, not a ref`);
        if (!anyRefIndex.has(d)) fail("not_found", `depends_on target '${d}' does not resolve to any ref declared in this plan`);
        if (!declaredSoFar.has(d)) {
          fail(
            "invalid_value",
            `depends_on target '${d}' at ${node.path} is not declared earlier in the plan (a ref may only be used after the object declaring it)`,
            "move the object that declares this ref earlier in the plan, before this one"
          );
        }
      } else if (!ctx.elements.some((e) => e.id === d)) {
        fail("not_found", `depends_on target '${d}' does not exist`);
      }
    }
  }
  const sections = collectNodeSections(raw, node.path, stdinState);
  return {
    type,
    cleanTitle,
    parentMode,
    explicitParentId,
    parentIndex,
    status,
    priority,
    assignee,
    tags,
    deps,
    sections,
    ownRef: typeof ref === "string" ? ref : void 0
  };
}
var InternalInvariantBroken = class extends Error {
};
function emitPlanFailure(e, failedAt, extra, backlog) {
  process.stderr.write(`Error: ${e.message}
`);
  if (e.hint) process.stderr.write(`${e.hint}
`);
  const res = { ok: false, error: e.code };
  if (e.hint) res.hint = e.hint;
  if (extra) {
    res.created = extra.created;
    res.refs = extra.refs;
  }
  res.failed_at = failedAt;
  if (extra && backlog !== void 0) recordChange(backlog, () => res);
  if (output.json) out(JSON.stringify(res, null, 2));
  return 1;
}
function cmdNewInput(ctx, inputValue) {
  const rawText = readInputText(inputValue);
  const parsed = parseInputJson(rawText);
  if (parsed === null || typeof parsed !== "object") fail("invalid_value", "--input must be a JSON object or an array of objects");
  const isSingular = !Array.isArray(parsed);
  const topArray = isSingular ? [parsed] : parsed;
  if (topArray.length === 0) fail("invalid_value", "--input array must not be empty");
  const flat = [];
  try {
    flattenPlan(topArray, "", null, flat);
  } catch (e) {
    if (e instanceof Fail) return emitPlanFailure(e, e.failedAt ?? "[0]");
    throw e;
  }
  const anyRefIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < flat.length; i++) {
    const r = flat[i].raw.ref;
    if (typeof r === "string" && !anyRefIndex.has(r)) anyRefIndex.set(r, i);
  }
  const labelOf = (n) => typeof n.raw.ref === "string" && n.raw.ref !== "" ? n.raw.ref : n.path;
  const stdinState = { consumed: inputValue === "-" };
  const seenRefs = /* @__PURE__ */ new Set();
  const declaredSoFar = /* @__PURE__ */ new Set();
  const validated = [];
  for (let i = 0; i < flat.length; i++) {
    try {
      const v = validatePlanNode(ctx, flat[i], flat, seenRefs, anyRefIndex, declaredSoFar, stdinState);
      validated.push(v);
      if (v.ownRef !== void 0) declaredSoFar.add(v.ownRef);
    } catch (e) {
      if (e instanceof Fail) return emitPlanFailure(e, labelOf(flat[i]));
      throw e;
    }
  }
  let elements = ctx.elements.slice();
  const created = [];
  const realIdByIndex = [];
  const refRealId = /* @__PURE__ */ new Map();
  const entries = [];
  let lastFields;
  let lastSections;
  for (let i = 0; i < flat.length; i++) {
    const node = flat[i];
    const v = validated[i];
    try {
      const liveCtx = Object.assign({}, ctx, { elements });
      const parentId = v.parentMode === "explicit" ? v.explicitParentId : v.parentMode === "implied" ? realIdByIndex[v.parentIndex] : void 0;
      let id = "", dir = "", file = "";
      for (let attempt = 0; ; attempt++) {
        id = allocateId(liveCtx.idsDir, v.type, liveCtx.elements, liveCtx.cfg.ids.shardSize);
        dir = path11.join(liveCtx.backlog, ...newPlace(liveCtx, v.type, id, parentId).split("/"));
        file = path11.join(dir, id + ".md");
        if (!collidesCaseInsensitively(dir, id + ".md")) break;
        if (attempt >= 100) return hardExit("id_allocation_failed", `nanojira: id allocation failed after 100 retries (${id} collides with an existing file)`);
      }
      realIdByIndex[i] = id;
      const resolvedDeps = (v.deps || []).map((d) => {
        if (!d.startsWith("@")) return d;
        const real = refRealId.get(d);
        if (real === void 0) throw new InternalInvariantBroken(`unresolved ref '${d}' reached the write phase at ${node.path} \u2014 this must have been caught at validation`);
        return real;
      });
      const ts = nowIso();
      const fields = /* @__PURE__ */ new Map();
      fields.set("id", id);
      fields.set("type", v.type);
      if (parentId !== void 0) fields.set("parent", parentId);
      fields.set("title", v.cleanTitle);
      fields.set("status", v.status === void 0 ? ctx.cfg.statuses[0] : v.status);
      if (v.priority !== void 0) fields.set("priority", v.priority);
      if (v.assignee !== void 0 && v.assignee !== "") fields.set("assignee", v.assignee);
      if (v.tags !== void 0 && v.tags.length > 0) fields.set("tags", v.tags);
      if (resolvedDeps.length > 0) fields.set("depends_on", resolvedDeps);
      fields.set("created", ts);
      fields.set("updated", ts);
      lastFields = fields;
      lastSections = v.sections;
      const body = buildBody(ctx, v.type, v.cleanTitle, v.sections);
      fs13.mkdirSync(dir, { recursive: true });
      atomicWrite(file, serialize(fields, Array.from(fields.keys()), body));
      created.push(id);
      if (typeof node.raw.ref === "string") refRealId.set(node.raw.ref, id);
      if (v.tags !== void 0 && v.tags.length > 0) warnTagNearMatches(v.tags, elements.flatMap((e) => e.tags));
      const el = loadElement(file, liveCtx.backlog, liveCtx.cfg);
      elements = elements.concat([el]);
      deriveGraph(elements, liveCtx.idsDir, liveCtx.cfg);
      entries.push(entryJson(el, ctx.backlog, ctx.cfg));
    } catch (e) {
      refreshStatus(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }));
      refreshTags(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }));
      if (e instanceof InternalInvariantBroken) throw e;
      const extra = created.length > 0 ? { created, refs: Object.fromEntries(refRealId) } : void 0;
      if (e instanceof Fail) return emitPlanFailure(e, labelOf(node), extra, ctx.backlog);
      const err = e;
      const wrapped = new Fail(err && err.stack ? err.stack : String(e), void 0, "internal_error");
      return emitPlanFailure(wrapped, labelOf(node), extra, ctx.backlog);
    }
  }
  refreshStatus(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }));
  refreshTags(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }));
  if (isSingular && flat.length === 1) {
    const fields = lastFields;
    const sections = lastSections;
    const changed = FIELD_ORDER.filter((f) => fields.has(f) && f !== "created" && f !== "updated").concat(SECTION_ROLES.filter((r) => sections.has(r)));
    const el = elements[elements.length - 1];
    recordChange(ctx.backlog, () => buildWriteResult(el, changed, ctx.backlog, ctx.cfg));
    if (output.json) emitWriteResult(true, el, changed, ctx.backlog, ctx.cfg);
    else writeFeedback(el, ctx.cfg, `${created[0]} created \u2192 ${el.file}`);
    return 0;
  }
  const refsObj = Object.fromEntries(refRealId);
  const built = { ok: true, ids: created, entries, refs: refsObj, _problems: [] };
  recordChange(ctx.backlog, () => built);
  if (output.json) {
    out(JSON.stringify(built, null, 2));
  } else {
    out(`created: ${created.join(", ")}`);
  }
  return 0;
}

// src/core/readme-texts.ts
var V2_README = `# Backlog

This folder is a NanoJira backlog. One Markdown file per element, grouped by
type: epics/, tasks/, subtasks/. Archived work lives in archive/.

Every file has a YAML-ish frontmatter block between \`---\` lines and a free
Markdown body. The frontmatter is the truth; the body belongs to you, except
for the \`# H1\` (mirrors \`title\`) and the \`## Notes\` section written by
\`nj note\`.

An element is *ready to work* when its status is the first configured status,
all \`depends_on\` targets are done, it carries no error, and it has a
non-empty \`## Description\` (plus \`## Acceptance Criteria\` for tasks and
subtasks). A heading with nothing under it counts as absent \u2014 that is
deliberate.

\`.ids/\` holds one empty tombstone file per allocated ID. It is versioned and
must be committed: it is what guarantees IDs are never reused. Do not delete
it.

The only uncommitted artifact is \`.nanojira-index.json\` (a cache).

Useful commands: \`nj\`, \`nj list --ready\`, \`nj show --id=\u2026\`,
\`nj new --type=task --parent=EPIC-001 --title="\u2026"\`, \`nj doctor\`.
`;
var V3_README = `# Backlog

This folder is a NanoJira backlog: one Markdown file per element (epics,
tasks, subtasks). Where the files lie is set by \`layout\` in
\`.nanojira/config.json\` \u2014 by default one folder per type (\`epics/\`,
\`tasks/\`, \`subtasks/\`), with finished work in \`archive/\`.

Every file has a frontmatter block between \`---\` lines and a free Markdown
body. The frontmatter is the truth; the body belongs to you, except for the
\`# H1\` (mirrors \`title\`), the \`## Notes\` section written by \`nanojira note\`, and
the sections \`nanojira new\`/\`nanojira set\` write when asked to.

An element is *ready to work* when its status is the first configured status,
all \`depends_on\` targets are done, it carries no error, and it has a
non-empty \`## Description\` (plus \`## Acceptance Criteria\` for tasks and
subtasks). A heading with nothing under it counts as absent \u2014 that is
deliberate.

\`STATUS.md\` is a generated overview by status. Do not edit it; \`nanojira\` rewrites
it after every change, and \`nanojira doctor --fix\` repairs it.

\`.nanojira/\` holds what only \`nanojira\` needs: the configuration and \`ids/\`, one
empty tombstone file per allocated ID. Both are versioned and must be
committed \u2014 the tombstones are what guarantee IDs are never reused. Do not
delete them. Only \`.nanojira/index.json\` (a cache) and temporary files are
ignored.

Useful commands: \`nanojira\`, \`nanojira list --ready\`, \`nanojira show --id=\u2026\`,
\`nanojira new --type=task --parent=EPIC-001 --title="\u2026"\`, \`nanojira doctor\`.
`;

// src/commands/cmd-doctor.ts
function collectFindings(ctx) {
  const findings = [];
  if (ctx.legacy) {
    findings.push({
      code: "backlog:legacy_layout",
      severity: "error",
      file: path12.join(ctx.backlog, LEGACY_CONFIG_REL),
      message: `the backlog is in the v2 (legacy) layout (${LEGACY_CONFIG_REL}, ${LEGACY_IDS_REL}/) \u2014 \`nanojira doctor --fix\` migrates it to .nanojira/`
    });
  }
  const configFile = path12.join(ctx.backlog, ctx.legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL);
  for (const e of ctx.configErrors) {
    findings.push({ code: "config:invalid", severity: "error", file: configFile, message: e });
  }
  for (const w of ctx.configWarnings) {
    findings.push({ code: w.code, severity: "warning", file: configFile, message: w.message });
  }
  const elements = ctx.elements.slice().sort(compareElements);
  const dupGroups = /* @__PURE__ */ new Map();
  for (const el of elements) {
    if (!dupGroups.has(el.id)) dupGroups.set(el.id, []);
    dupGroups.get(el.id).push(el);
  }
  for (const el of elements) {
    for (const code of elementProblems(el)) {
      const sev = SEVERITY[code];
      if (sev === null || sev === void 0) continue;
      if (ctx.configErrors.length > 0 && (code === "type:folder" || code === "layout:misplaced")) continue;
      if (code === "frontmatter:unreadable" || code === "file:unreadable") {
        for (const d of el.detail) {
          if (d.code !== code) continue;
          findings.push({ code, severity: sev, element: el.id, file: el.file, line: d.line, message: d.message });
        }
        continue;
      }
      findings.push({ code, severity: sev, element: el.id, file: el.file, message: describeFinding(code, el, dupGroups, ctx.cfg) });
    }
  }
  const scan = ctx.scan;
  for (const file of strayTmpFiles(scan.dirs.concat(claimsScanDirs(ctx.backlog)))) {
    findings.push({ code: "backlog:stray_tmp", severity: "warning", file, message: "stray temp file from an interrupted write" });
  }
  findings.push(...collectClaimFindings(ctx));
  if (claimsNeedGitignoreLine(ctx.backlog)) {
    findings.push({
      code: "backlog:claims_unignored",
      severity: "warning",
      file: path12.join(ctx.backlog, ".gitignore"),
      message: ".nanojira/claims/ exists but .gitignore has no line that is exactly '.nanojira/claims/'"
    });
  }
  for (const { dir, reason } of scan.unreadable) {
    findings.push({ code: "backlog:unreadable_dir", severity: "error", file: dir, message: `folder cannot be listed (${reason}) \u2014 element files in it are not seen` });
  }
  const tombs = readTombstones(ctx.idsDir, ctx.cfg.ids.shardSize);
  if (ctx.elements.length > 0 && tombs.size === 0) {
    findings.push({ code: "backlog:ids_missing", severity: "error", file: ctx.idsDir, message: `${path12.relative(ctx.backlog, ctx.idsDir)}/ is missing or empty while element files exist \u2014 the never-reuse guarantee is not in force` });
  }
  if (ctx.configErrors.length === 0) {
    const actual = detectIdsLayout(ctx.idsDir);
    const wantSharded = ctx.cfg.ids.shardSize > 0;
    if (actual === "mixed" || actual === "flat" && wantSharded || actual === "sharded" && !wantSharded) {
      const want = wantSharded ? `sharded (ids.shardSize=${ctx.cfg.ids.shardSize})` : "flat";
      findings.push({
        code: "backlog:ids_layout_mismatch",
        severity: "error",
        file: ctx.idsDir,
        message: `${path12.relative(ctx.backlog, ctx.idsDir)}/ is laid out ${actual} on disk but the configuration wants ${want} \u2014 \`nanojira doctor --fix\` moves the tombstones`
      });
    }
  }
  if (ctx.configErrors.length === 0 && ctx.cfg.layout.statusFile && !statusIsFresh(ctx.backlog, ctx.elements, ctx.cfg)) {
    findings.push({ code: "backlog:status_stale", severity: "warning", file: path12.join(ctx.backlog, "STATUS.md"), message: "STATUS.md is missing or differs from a fresh rendering \u2014 `nanojira doctor --fix` regenerates it" });
  }
  if (ctx.configErrors.length === 0 && ctx.cfg.layout.tagsFile && !tagsIsFresh(ctx.backlog, ctx.elements, ctx.cfg)) {
    findings.push({ code: "backlog:tags_stale", severity: "warning", file: path12.join(ctx.backlog, "TAGS.md"), message: "TAGS.md is missing or differs from a fresh rendering \u2014 `nanojira doctor --fix` regenerates it" });
  }
  if (ctx.cfg.problems.ignore.length === 0) return findings;
  const ignore = new Set(ctx.cfg.problems.ignore);
  return findings.filter((f) => !ignore.has(f.code));
}
function strayTmpFiles(dirs) {
  const found = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs14.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.sort()) if (n.startsWith(".nj-tmp-")) found.push(path12.join(dir, n));
  }
  return found;
}
function claimsScanDirs(backlog) {
  return [claimsRootDir(backlog), ...allClaimDirs(backlog).map((c) => c.dir)];
}
function collectClaimFindings(ctx) {
  const findings = [];
  for (const { id, dir } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    const h = highestEntry(dir);
    if (!el) {
      findings.push({ code: "claim:orphaned", severity: "warning", file: dir, message: `claim directory for '${id}', which does not exist` });
      continue;
    }
    if (el.archived) {
      findings.push({ code: "claim:orphaned", severity: "warning", element: el.id, file: dir, message: `${el.id} is archived but still carries a claim directory` });
    }
    if (h && h.kind === "claimed" && h.name !== el.assignee) {
      findings.push({
        code: "claim:mismatch",
        severity: "warning",
        element: el.id,
        file: el.file,
        message: `claimed by '${h.name}' but assignee is '${el.assignee || "(empty)"}'`
      });
    }
    if (h && h.kind === "claimed" && isClaimStale(h.time, ctx.cfg.claims.staleAfterHours, nowMs())) {
      findings.push({
        code: "claim:stale",
        severity: "warning",
        element: el.id,
        file: el.file,
        message: `claimed by '${h.name}' since ${h.time}, past the ${ctx.cfg.claims.staleAfterHours}h staleness threshold`
      });
    }
  }
  return findings;
}
var CLAIMS_GITIGNORE_LINE = ".nanojira/claims/";
function gitignoreHasClaimsLine(backlog) {
  let content;
  try {
    content = fs14.readFileSync(path12.join(backlog, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return content.split("\n").some((l) => l.replace(/\r$/, "") === CLAIMS_GITIGNORE_LINE);
}
function claimsNeedGitignoreLine(backlog) {
  return fs14.existsSync(claimsRootDir(backlog)) && !gitignoreHasClaimsLine(backlog);
}
function appendGitignoreLine(content, line) {
  if (content === "") return line + "\n";
  if (content.endsWith("\r\n")) return content + line + "\r\n";
  if (content.endsWith("\n")) return content + line + "\n";
  return content + "\n" + line + "\n";
}
function backlogLabel(backlog) {
  const rel = path12.relative(workingDir(), toReal(backlog));
  return (rel === "" ? "." : rel) + "/";
}
function describeFinding(code, el, dupGroups, cfg) {
  switch (code) {
    case "duplicate_id":
      return `duplicate id, also in: ${dupGroups.get(el.id).filter((o) => o !== el).map((o) => o.file).join(", ")}`;
    case "missing:title":
      return "title is absent or empty";
    case "missing:status":
      return `status absent \u2014 defaulted`;
    case "missing:created":
      return "created absent \u2014 taken from file mtime";
    case "missing:updated":
      return "updated absent \u2014 taken from file mtime";
    case "id:derived":
      return "id absent \u2014 derived from the file name";
    case "id:mismatch":
      return `frontmatter id '${el.id}' does not match the file name`;
    case "type:derived":
      return `type absent \u2014 derived as '${el.type}'`;
    case "type:folder":
      return el.type === null ? "type cannot be determined from id, frontmatter or folder" : `type '${el.type}' does not match folder '${el.folder}/'`;
    case "layout:misplaced":
      return `file lies in '${el.folder === "" ? "." : el.folder}/', not where the layout puts it`;
    case "parent:orphaned":
      return "parent is absent";
    case "parent:dangling":
      return `parent '${el.parent}' points at nothing`;
    case "parent:cycle":
      return "parent chain contains a cycle";
    case "parent:hierarchy":
      return el.type === "epic" ? "an epic must not have a parent" : `a ${el.type} needs ${article(PARENT_TYPE[el.type])} ${PARENT_TYPE[el.type]} as parent`;
    case "depends_on:dangling":
      return `depends_on points at a missing element (${el.depends_on.join(", ")})`;
    case "depends_on:cycle":
      return "depends_on graph contains a cycle";
    case "unknown:status":
      return `unknown status '${el.status}'`;
    case "unknown:priority":
      return `unknown priority '${el.priority}' \u2014 sorted as normal, value left untouched`;
    case "file:unreadable":
      return "file cannot be read";
    case "done:open_children":
      return "done while children are not done";
    case "archive:not_done":
      return `archived but status is '${el.status}'`;
    case "archive:split":
      return `parent '${el.parent}' is archived while this element is not`;
    case "title:h1_mismatch":
      return "H1 in the body differs from title";
    case "id:no_tombstone":
      return "no tombstone in the ids folder \u2014 hand-created, or partial tombstone loss";
    case "acceptance:no_checkbox":
      return "acceptance criteria has content but no checkbox items \u2014 nothing for check to tick";
    case "done:no_acceptance":
      return "done with no acceptance criteria";
    case "done:open_acceptance": {
      const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
      return `done with ${counts ? counts.unticked : "?"} of ${counts ? counts.total : "?"} acceptance boxes still unticked`;
    }
    default:
      return code;
  }
}
function cmdDoctor(flags) {
  checkCommandFlags(flags, "doctor");
  const json = flags.has("json");
  if (flags.has("fix")) return doctorFix(flags, json);
  if (flags.has("dry-run")) fail("invalid_value", "--dry-run requires --fix", "plain `nanojira doctor` never writes; add --fix to preview its repairs");
  const ctx = context(flags, { lenient: true, tolerateConfig: true });
  const findings = collectFindings(ctx);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  if (json) {
    out(JSON.stringify({ backlog: ctx.backlog, ok: errors.length === 0, problems: findings }, null, 2));
  } else {
    out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
    if (findings.length > 0) out("");
    for (const f of findings) {
      const where = f.element ? f.element : path12.relative(ctx.backlog, f.file);
      const line = f.line ? ` (line ${f.line})` : "";
      out(`${f.severity === "error" ? "ERROR  " : "WARNING"} ${where}: ${f.message}${line}`);
    }
  }
  return errors.length > 0 ? 2 : 0;
}
function fixSkip(el, notes) {
  if (el.problems.has("file:unreadable")) {
    notes.push(`${path12.basename(el.file)}: cannot be read \u2014 not touched by --fix`);
    return true;
  }
  if (el.problems.has("frontmatter:unreadable")) {
    notes.push(`${el.id}: has unparsable frontmatter lines \u2014 not touched by --fix, repair it by hand`);
    return true;
  }
  return false;
}
function makeFixCtx(flags) {
  const actions = [];
  const notes = [];
  const reload = () => context(flags, { lenient: true, tolerateConfig: true });
  const skipped = /* @__PURE__ */ new Set();
  const guard = (el) => {
    if (!el.problems.has("file:unreadable") && !el.problems.has("frontmatter:unreadable")) return false;
    if (!skipped.has(el.id)) {
      skipped.add(el.id);
      fixSkip(el, notes);
    }
    return true;
  };
  const absent = (el, k) => {
    if (!el.fields.has(k)) return true;
    const v = el.fields.get(k);
    return Array.isArray(v) ? v.length === 0 : String(v === void 0 || v === null ? "" : v).trim() === "";
  };
  const mtimes = /* @__PURE__ */ new Map();
  const rekey = (from, to) => {
    for (const [k, v] of Array.from(mtimes)) {
      if (k === from) {
        mtimes.delete(k);
        mtimes.set(to, v);
      } else if (k.startsWith(from + path12.sep)) {
        mtimes.delete(k);
        mtimes.set(to + k.slice(from.length), v);
      }
    }
  };
  const rename = (from, to) => {
    fs14.renameSync(from, to);
    rekey(from, to);
  };
  const move = (plan) => {
    runMove(plan);
    for (const [from, to] of plan.renames) rekey(from, to);
  };
  return { actions, notes, guard, absent, mtimes, rename, move, reload, stage: 0 };
}
function fixStep0(ctx, fc) {
  const backlog = ctx.backlog;
  const v3Config = path12.join(backlog, V3_CONFIG_REL);
  const v3Ids = path12.join(backlog, V3_IDS_REL);
  if (fs14.existsSync(v3Config) || fs14.existsSync(v3Ids)) {
    fc.notes.push(`both the v2 and the v3 place exist (${LEGACY_CONFIG_REL} / ${LEGACY_IDS_REL} and ${V3_CONFIG_REL} / ${V3_IDS_REL}) \u2014 ambiguous, nothing moved; remove one copy by hand and run \`nanojira doctor --fix\` again`);
    return;
  }
  fs14.mkdirSync(path12.join(backlog, V3_DIR_REL), { recursive: true });
  fc.rename(path12.join(backlog, LEGACY_CONFIG_REL), v3Config);
  fc.rename(path12.join(backlog, LEGACY_IDS_REL), v3Ids);
  const legacyIndex = path12.join(backlog, LEGACY_INDEX_REL);
  if (fs14.existsSync(legacyIndex)) fs14.unlinkSync(legacyIndex);
  fc.actions.push(`migrated the legacy layout: ${LEGACY_CONFIG_REL} \u2192 ${V3_CONFIG_REL}, ${LEGACY_IDS_REL}/ \u2192 ${V3_IDS_REL}/`);
}
function fixStrayIds(ctx, fc) {
  const backlog = ctx.backlog;
  const strayDir = path12.join(backlog, LEGACY_IDS_REL);
  if (!fs14.existsSync(strayDir)) return;
  const stray = readTombstones(strayDir);
  const real = readTombstones(path12.join(backlog, V3_IDS_REL), ctx.cfg.ids.shardSize);
  for (const id of stray) if (!real.has(id)) return;
  fs14.rmSync(strayDir, { recursive: true, force: true });
  fc.notes.push(`removed the stray top-level ${LEGACY_IDS_REL}/ (every tombstone in it was already in ${V3_IDS_REL}/, \xA7 14 step 0)`);
}
var TOMBSTONE_RE = /^(EPIC|TSK|SUB)-(\d+)$/;
function detectIdsLayout(idsDir) {
  let entries;
  try {
    entries = fs14.readdirSync(idsDir, { withFileTypes: true });
  } catch {
    return "empty";
  }
  let flat = false, sharded = false;
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (!e.isDirectory() && TOMBSTONE_RE.test(e.name)) flat = true;
    else if (e.isDirectory() && Object.prototype.hasOwnProperty.call(PREFIX_TYPE, e.name)) sharded = true;
  }
  if (flat && sharded) return "mixed";
  if (flat) return "flat";
  if (sharded) return "sharded";
  return "empty";
}
function fixIdsLayout(ctx, fc) {
  const idsDir = ctx.idsDir;
  const actual = detectIdsLayout(idsDir);
  const wantSharded = ctx.cfg.ids.shardSize > 0;
  if (actual === "empty") return;
  if (actual === "flat" && !wantSharded) return;
  if (actual === "sharded" && wantSharded) return;
  let moved = 0;
  if (!wantSharded) {
    for (const prefix of Object.keys(PREFIX_TYPE)) {
      const typeDir = path12.join(idsDir, prefix);
      let buckets;
      try {
        buckets = fs14.readdirSync(typeDir);
      } catch {
        continue;
      }
      for (const b of buckets) {
        if (b.startsWith(".")) continue;
        const bucketDir = path12.join(typeDir, b);
        let names;
        try {
          names = fs14.readdirSync(bucketDir);
        } catch {
          continue;
        }
        for (const n of names) {
          if (n.startsWith(".")) continue;
          const target = path12.join(idsDir, n);
          if (fs14.existsSync(target)) {
            fc.notes.push(`${path12.join(prefix, b, n)}: cannot move to the flat layout \u2014 ${n} already exists there`);
            continue;
          }
          fs14.renameSync(path12.join(bucketDir, n), target);
          moved++;
        }
        try {
          fs14.rmdirSync(bucketDir);
        } catch {
        }
      }
      try {
        fs14.rmdirSync(typeDir);
      } catch {
      }
    }
  } else {
    let entries;
    try {
      entries = fs14.readdirSync(idsDir);
    } catch {
      entries = [];
    }
    for (const n of entries) {
      if (n.startsWith(".")) continue;
      if (!TOMBSTONE_RE.test(n)) continue;
      const { dir, file } = tombstoneLocation(idsDir, n, ctx.cfg.ids.shardSize);
      if (fs14.existsSync(file)) {
        fc.notes.push(`${n}: cannot move to the sharded layout \u2014 already exists at ${path12.relative(idsDir, file)}`);
        continue;
      }
      fs14.mkdirSync(dir, { recursive: true });
      fs14.renameSync(path12.join(idsDir, n), file);
      moved++;
    }
  }
  if (moved > 0) {
    fc.actions.push(`moved ${moved} tombstone${moved === 1 ? "" : "s"} in ${path12.relative(ctx.backlog, idsDir)}/ to the ${wantSharded ? "sharded" : "flat"} layout`);
  }
}
function fixGitignore(backlog, fc, verbose) {
  const p = path12.join(backlog, ".gitignore");
  let content;
  try {
    content = fs14.readFileSync(p, "utf8");
  } catch {
    if (verbose) fc.notes.push(".gitignore does not exist \u2014 not created");
    return;
  }
  let changed = false;
  const lines = content.split("\n").map((line) => {
    const hasCR = line.endsWith("\r");
    if ((hasCR ? line.slice(0, -1) : line) !== LEGACY_INDEX_REL) return line;
    changed = true;
    return V3_INDEX_REL + (hasCR ? "\r" : "");
  });
  if (!changed) {
    if (verbose) fc.notes.push(`.gitignore does not have the '${LEGACY_INDEX_REL}' line verbatim \u2014 left alone`);
    return;
  }
  atomicWrite(p, lines.join("\n"));
  fc.actions.push(`.gitignore: replaced the '${LEGACY_INDEX_REL}' line with '${V3_INDEX_REL}'`);
}
function fixReadme(backlog, fc, verbose) {
  const p = path12.join(backlog, "README.md");
  let content;
  try {
    content = fs14.readFileSync(p, "utf8");
  } catch {
    return;
  }
  if (content !== V2_README) {
    if (verbose) fc.notes.push("README.md is not the v2 init text \u2014 left alone");
    return;
  }
  atomicWrite(p, V3_README);
  fc.actions.push("README.md: replaced the v2 init text with the v3 text");
}
function fixSnapshotMtimes(fc) {
  for (const el of fc.reload().elements) fc.mtimes.set(el.file, mtimeIso(el.file));
  return { ...fc, stage: 1 };
}
function idShaped(el) {
  return ID_FOLDER.test(el.id);
}
function fixStep1(fc) {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !idShaped(el)) continue;
    const ov = /* @__PURE__ */ new Map();
    if (el.problems.has("id:derived") && fc.absent(el, "id")) ov.set("id", el.id);
    if (el.problems.has("type:derived") && el.type && fc.absent(el, "type")) ov.set("type", el.type);
    if (ov.size === 0) continue;
    ov.set("updated", nowIso());
    atomicWrite(el.file, renderElement(el, ov, void 0));
    fc.actions.push(`${el.id}: wrote ${Array.from(ov.keys()).filter((k) => k !== "updated").join(", ")} into the frontmatter`);
  }
  return { ...fc, stage: 2 };
}
function fixStep2(fc) {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el)) continue;
    if (!el.problems.has("id:mismatch")) continue;
    const target = path12.join(path12.dirname(el.file), el.id + ".md");
    if (fs14.existsSync(target)) {
      fc.notes.push(`${el.file}: cannot rename to ${path12.basename(target)} \u2014 target exists`);
      continue;
    }
    fc.rename(el.file, target);
    fc.actions.push(`renamed ${path12.basename(el.file)} \u2192 ${path12.basename(target)}`);
  }
  return { ...fc, stage: 3 };
}
function fixStep3(fc) {
  const layout = fc.reload().cfg.layout;
  const rounds = layout.group === "hierarchy" ? ["epic", "task", "subtask"] : [null];
  const left = /* @__PURE__ */ new Set();
  const noted = /* @__PURE__ */ new Set();
  for (const round of rounds) {
    for (let moved = true; moved; ) {
      moved = false;
      const ctx = fc.reload();
      for (const el of ctx.elements) {
        if (round !== null && el.type !== round) continue;
        if (noted.has(el.id)) continue;
        if (fc.guard(el) || el.type === null || !el.problems.has(misplacedCode(layout))) continue;
        if (layout.group === "type") {
          const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
          if (!pm || PREFIX_TYPE[pm[1]] !== el.type) {
            fc.notes.push(`${el.id}: id prefix and type disagree \u2014 not moved, resolve by hand`);
            noted.add(el.id);
            continue;
          }
        }
        if (layout.group === "hierarchy" && chainProblem(el)) {
          fc.notes.push(`${el.id}: its parent chain has problems \u2014 not moved, resolve by hand`);
          noted.add(el.id);
          continue;
        }
        const dir = moveTarget(el, el.byId, layout);
        const own = layout.group === "hierarchy" ? ownFolder(el) : null;
        if (own !== null && !folderArchivedAgrees(ctx.elements, own, el.archived || el.archivedAt !== null)) {
          fc.notes.push(`${el.id}: its folder holds elements that disagree on archived: \u2014 not moved, resolve by hand`);
          noted.add(el.id);
          continue;
        }
        const src = own === null ? el.file : own;
        const dst = own === null ? path12.join(ctx.backlog, dir, path12.basename(el.file)) : path12.join(ctx.backlog, dir);
        const shown = (dir === "" ? "." : dir) + "/";
        if (layout.group === "type") fs14.mkdirSync(path12.dirname(dst), { recursive: true });
        const plan = planMove(src, dst);
        if (plan.conflicts.length > 0) {
          fc.notes.push(`${el.id}: cannot move into ${shown} \u2014 target exists`);
          noted.add(el.id);
          continue;
        }
        fc.move(plan);
        left.add(path12.dirname(src));
        fc.actions.push(own === null ? `moved ${el.id} \u2192 ${shown}` : `moved ${el.id} with its folder \u2192 ${shown}`);
        moved = true;
        break;
      }
    }
  }
  removeEmptiedIdFolders(fc.reload().backlog, left);
  return { ...fc, stage: 4 };
}
function folderArchivedAgrees(elements, own, expectArchived) {
  const prefix = own + path12.sep;
  return elements.every((e) => !e.file.startsWith(prefix) || (e.archived || e.archivedAt !== null) === expectArchived);
}
function chainProblem(el) {
  const byId = el.byId;
  const seen = /* @__PURE__ */ new Set();
  for (let cur = el; cur !== void 0 && !seen.has(cur.id); cur = cur.parent === null ? void 0 : byId.get(cur.parent)) {
    seen.add(cur.id);
    if (["parent:dangling", "parent:cycle", "parent:hierarchy"].some((c) => cur.problems.has(c))) return true;
  }
  return false;
}
function fixStep4(fc) {
  const ctx = fc.reload();
  const dir = ctx.idsDir;
  const shardSize = ctx.cfg.ids.shardSize;
  fs14.mkdirSync(dir, { recursive: true });
  const tombs = readTombstones(dir, shardSize);
  let created = 0;
  for (const el of ctx.elements) {
    if (!idShaped(el) || tombs.has(el.id)) continue;
    const { dir: tdir, file } = tombstoneLocation(dir, el.id, shardSize);
    if (tdir !== dir) fs14.mkdirSync(tdir, { recursive: true });
    try {
      fs14.closeSync(fs14.openSync(file, "wx"));
      created++;
    } catch {
    }
  }
  if (created > 0) {
    fc.actions.push(`created ${created} missing tombstone${created === 1 ? "" : "s"} in ${path12.relative(ctx.backlog, dir)}/`);
    fc.notes.push("tombstones for already-deleted IDs cannot be recovered \u2014 the never-reuse guarantee is void for those numbers");
  }
  return { ...fc, stage: 5 };
}
function fixStep5(fc) {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !idShaped(el)) continue;
    const ov = /* @__PURE__ */ new Map();
    if (el.problems.has("missing:status") && fc.absent(el, "status")) ov.set("status", el.status);
    if (el.problems.has("missing:created") && fc.absent(el, "created")) {
      ov.set("created", fc.mtimes.get(el.file) || el.created);
    }
    if (ov.size === 0 && !el.problems.has("missing:updated")) continue;
    const wrote = Array.from(ov.keys());
    ov.set("updated", nowIso());
    atomicWrite(el.file, renderElement(el, ov, void 0));
    fc.actions.push(`${el.id}: wrote ${wrote.concat(["updated"]).join(", ")}`);
  }
  return { ...fc, stage: 6 };
}
function fixStep6(fc) {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !el.problems.has("title:h1_mismatch")) continue;
    atomicWrite(el.file, renderElement(el, /* @__PURE__ */ new Map([["updated", nowIso()]]), syncH1(el.body, el.title)));
    fc.actions.push(`${el.id}: synchronised the H1 with title`);
  }
  return { ...fc, stage: 7 };
}
function fixStep7(fc) {
  const ctx = fc.reload();
  for (const file of strayTmpFiles(ctx.scan.dirs.concat(claimsScanDirs(ctx.backlog)))) {
    fs14.unlinkSync(file);
    fc.actions.push(`removed stray temp file ${path12.relative(ctx.backlog, file)}`);
  }
  return { ...fc, stage: 8 };
}
function fixStep7a(fc) {
  const ctx = fc.reload();
  for (const { id, dir } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    if (el && !el.archived) continue;
    const entry = highestEntry(dir);
    const holder = entry && entry.kind === "claimed" ? entry.name : null;
    removeClaimDirWholesale(ctx.backlog, id);
    if (fs14.existsSync(dir)) continue;
    fc.actions.push(holder !== null ? `${id}: released ${holder}` : `removed the orphaned claim directory for ${id}`);
  }
  if (claimsNeedGitignoreLine(ctx.backlog)) {
    const p = path12.join(ctx.backlog, ".gitignore");
    let content;
    try {
      content = fs14.readFileSync(p, "utf8");
    } catch {
      fc.notes.push(".gitignore does not exist \u2014 not created (the claims/ line was not added)");
      return { ...fc, stage: 8 };
    }
    atomicWrite(p, appendGitignoreLine(content, CLAIMS_GITIGNORE_LINE));
    fc.actions.push(`.gitignore: appended '${CLAIMS_GITIGNORE_LINE}'`);
  }
  return { ...fc, stage: 8 };
}
function fixStep7b(fc) {
  const ctx = fc.reload();
  const finalStatus = ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
  const ts = nowIso();
  for (const { id } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    if (!el || el.status !== finalStatus) continue;
    const released = releaseUnconditional(ctx.backlog, id, ts);
    if (released !== void 0) fc.actions.push(`${id}: released ${released.holder}`);
  }
  return { ...fc, stage: 8 };
}
function fixStep8(fc) {
  return { ...fc, stage: 9 };
}
function fixStep9(fc) {
  const before = fc.reload();
  if (refreshTags(before.backlog, before.cfg, before)) fc.actions.push("regenerated TAGS.md");
  if (refreshStatus(before.backlog, before.cfg, before)) fc.actions.push("regenerated STATUS.md");
  const ctx = fc.reload();
  const findings = collectFindings(ctx);
  return { ...fc, stage: 10, ctx, findings };
}
function doctorFix(flags, json) {
  const fc0 = makeFixCtx(flags);
  let start = fc0.reload();
  const wasLegacy = start.legacy;
  if (start.legacy) {
    fixStep0(start, fc0);
    start = fc0.reload();
  } else {
    fixStrayIds(start, fc0);
    start = fc0.reload();
  }
  if (start.legacy || start.configErrors.length > 0) return fixReport(json, fc0.actions, fc0.notes, start, collectFindings(start));
  fixGitignore(start.backlog, fc0, wasLegacy);
  fixReadme(start.backlog, fc0, wasLegacy);
  fixIdsLayout(start, fc0);
  const fc1 = fixSnapshotMtimes(fc0);
  const fc2 = fixStep1(fc1);
  const fc3 = fixStep2(fc2);
  const fc4 = fixStep3(fc3);
  const fc5 = fixStep4(fc4);
  const fc6 = fixStep5(fc5);
  const fc7 = fixStep6(fc6);
  const fc8 = fixStep7(fc7);
  const fc8a = fixStep7a(fc8);
  const fc8b = fixStep7b(fc8a);
  const fc9 = fixStep8(fc8b);
  const { actions, notes, ctx, findings } = fixStep9(fc9);
  return fixReport(json, actions, notes, ctx, findings);
}
function fixReport(json, actions, notes, ctx, findings) {
  const errors = findings.filter((f) => f.severity === "error");
  const built = { backlog: ctx.backlog, ok: errors.length === 0, fixed: actions, notes, problems: findings };
  if (actions.length > 0) recordChange(ctx.backlog, () => built);
  if (json) {
    out(JSON.stringify(built, null, 2));
  } else {
    for (const a of actions) out(`FIXED   ${a}`);
    for (const n of notes) out(`NOTE    ${n}`);
    if (actions.length === 0) out("Nothing to fix.");
    out("");
    const warnings = findings.filter((f) => f.severity === "warning");
    out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"} remaining`);
    for (const f of findings) {
      const where = f.element ? f.element : path12.relative(ctx.backlog, f.file);
      out(`${f.severity === "error" ? "ERROR  " : "WARNING"} ${where}: ${f.message}`);
    }
  }
  return errors.length > 0 ? 2 : 0;
}

// src/commands/cmd-init.ts
import * as fs15 from "node:fs";
import * as path13 from "node:path";
function probeCreatable(target) {
  let dir = path13.dirname(target);
  for (; ; ) {
    let st;
    try {
      st = fs15.statSync(dir);
    } catch {
      st = null;
    }
    if (st !== null) {
      if (!st.isDirectory()) fail("io_error", `cannot create the backlog at ${target}: ENOTDIR: not a directory, mkdir '${target}'`);
      try {
        fs15.accessSync(dir, fs15.constants.W_OK | fs15.constants.X_OK);
      } catch (e) {
        fail("io_error", `cannot create the backlog at ${target}: ${oneLine(e)}`);
      }
      return;
    }
    const up = path13.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}
function cmdInit(flags) {
  checkCommandFlags(flags, "init");
  const json = flags.has("json");
  const target = initLocation(flags);
  if (fs15.existsSync(target)) fail("exists", `${target} already exists`);
  if (isDryRun()) probeCreatable(target);
  const backlog = sandboxFor(target);
  try {
    fs15.mkdirSync(backlog, { recursive: true });
    for (const d of ["epics", "tasks", "subtasks", "archive", V3_IDS_REL]) {
      fs15.mkdirSync(path13.join(backlog, d), { recursive: true });
    }
    const { claims, problems, ids, ...written } = DEFAULT_CONFIG;
    void claims;
    void problems;
    void ids;
    fs15.writeFileSync(path13.join(backlog, ".nanojira", "config.json"), JSON.stringify(written, null, 2) + "\n", "utf8");
    fs15.writeFileSync(path13.join(backlog, ".gitignore"), ".nanojira/index.json\n.nj-tmp-*\n.nanojira/claims/\n", "utf8");
    fs15.writeFileSync(path13.join(backlog, "README.md"), V3_README, "utf8");
  } catch (e) {
    fail("io_error", `cannot create the backlog at ${backlog}: ${oneLine(e)}`);
  }
  refreshStatus(backlog, { ...DEFAULT_CONFIG });
  refreshTags(backlog, { ...DEFAULT_CONFIG });
  const built = { ok: true, backlog, changed: ["created"] };
  recordChange(backlog, () => built);
  if (json) out(JSON.stringify(built, null, 2));
  else {
    out(`Created backlog at ${backlog}`);
    out("  epics/ tasks/ subtasks/ archive/ .nanojira/");
    out("  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md TAGS.md");
  }
  return 0;
}

// src/commands/cmd-log.ts
var SOURCE_CREATED = 0;
var SOURCE_CLAIM = 1;
var SOURCE_NOTE = 2;
function requireReadableForLog(el) {
  if (el.problems.has("file:unreadable")) {
    fail(
      "refused:unreadable",
      `${el.id} (${el.file}) cannot be read \u2014 refusing to log`,
      "check the file and its permissions, then run `nanojira doctor`"
    );
  }
  if (el.problems.has("frontmatter:unreadable")) {
    fail(
      "refused:unreadable",
      `${el.id} (${el.file}) has unreadable frontmatter \u2014 refusing to log`,
      "repair the file by hand, then run `nanojira doctor`"
    );
  }
}
function claimEvents(backlog, id) {
  const events = [];
  let prev = null;
  for (const e of allEntriesAscending(backlog, id)) {
    const kind = e.kind === "released" ? "released" : prev === null || prev.kind === "released" ? "claimed" : prev.name === e.name ? "reasserted" : "stolen";
    events.push({ at: e.time, kind, actor: e.name, _source: SOURCE_CLAIM });
    prev = { kind: e.kind, name: e.name };
  }
  return events;
}
function formatEvent(e) {
  if (e.kind === "created") return `${e.at} created`;
  if (e.kind === "note") {
    const [first, ...rest] = (e.text || "").split("\n");
    return [`${e.at} ${e.actor}: ${first}`, ...rest.map((l) => l === "" ? "  " : `  ${l}`)].join("\n");
  }
  const verb = e.kind === "reasserted" ? "re-asserted" : e.kind;
  return `${e.at} ${verb} by ${e.actor}`;
}
function parseLastFlag(flags) {
  const raw = flagString(flags, "last");
  if (raw === void 0) return void 0;
  const n = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 1) return n;
  fail("invalid_value", `--last=${raw} must be a positive integer`);
}
function cmdLog(flags) {
  checkCommandFlags(flags, "log");
  const json = flags.has("json");
  const ctx = context(flags);
  const last = parseLastFlag(flags);
  const el = resolveTarget(ctx, flags, true);
  requireReadableForLog(el);
  const events = [{ at: el.created, kind: "created", _source: SOURCE_CREATED }];
  events.push(...claimEvents(ctx.backlog, el.id));
  for (const n of parseNotes(el.body)) events.push({ at: n.at, kind: "note", actor: n.actor, text: n.text, _source: SOURCE_NOTE });
  events.sort((a, b) => a.at !== b.at ? a.at < b.at ? -1 : 1 : a._source - b._source);
  const merged = events.map(({ _source, ...rest }) => rest);
  const visible = last === void 0 ? merged : merged.slice(Math.max(0, merged.length - last));
  if (json) {
    const result = { ok: true, id: el.id, events: visible };
    if (last !== void 0) result.events_total = merged.length;
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  for (const e of visible) out(formatEvent(e));
  return 0;
}

// src/commands/cmd-next.ts
function cmdNext(flags) {
  checkCommandFlags(flags, "next");
  const json = flags.has("json");
  const name = resolveActingName(flags, true);
  const ctx = context(flags);
  const status = flagString(flags, "status");
  if (status !== void 0 && !ctx.cfg.statuses.includes(status)) {
    fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, ctx.cfg.statuses));
  }
  const filterFlags = new Map(flags);
  filterFlags.delete("status");
  const candidates = applyFilters(ctx.elements, filterFlags, ctx.cfg).filter((e) => isReady(e, ctx.cfg) && availableToActor(ctx.backlog, e.id, name) && !hasOpenChild(e) && (e.assignee === "" || e.assignee === name));
  const skipped = [];
  for (const candidate of candidates) {
    const el = resolveById(ctx, candidate.id, true);
    requireWritable(el);
    requireActive(el, "claim");
    let single;
    try {
      single = claimOne(ctx, el, name, status, void 0, nowIso());
    } catch (e) {
      if (e instanceof Fail && e.code === "refused:claimed") {
        skipped.push(el.id);
        continue;
      }
      throw e;
    }
    refreshStatus(ctx.backlog, ctx.cfg, ctx);
    refreshTags(ctx.backlog, ctx.cfg, ctx);
    const built = Object.assign({ ok: single.ok, id: el.id }, single, { skipped });
    recordChange(ctx.backlog, () => built);
    if (json) {
      out(JSON.stringify(built, null, 2));
    } else {
      out(`${el.id} claimed by ${name}${status !== void 0 ? ` (status: ${status})` : ""}`);
      for (const code of single._problems) out(`\u26A0 ${el.id}: ${code}`);
    }
    return 0;
  }
  fail(
    "none_ready",
    `no --ready candidate is available for ${name}`,
    skipped.length > 0 ? `${skipped.length} candidate${skipped.length === 1 ? "" : "s"} tried, all lost the race` : void 0
  );
}

// src/commands/cmd-note.ts
import * as fs16 from "node:fs";
function withNote(el, text, signer, ts) {
  const line = renderNoteLine(ts, signer, text);
  let body = el.body;
  const lines = body.split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (m && m[1].replace(/:\s*$/, "").trim().toLowerCase() === "notes") idx = i;
  }
  if (idx === -1) {
    body = body.replace(/\n+$/, "\n");
    if (body !== "" && !body.endsWith("\n")) body += "\n";
    body += `
## Notes
${line}
`;
    return body;
  }
  let end = lines.length;
  for (let j = idx + 1; j < lines.length; j++) {
    if (/^#{1,2}[ \t]/.test(lines[j])) {
      end = j;
      break;
    }
  }
  let insert = end;
  while (insert > idx + 1 && lines[insert - 1] === "") insert--;
  lines.splice(insert, 0, line);
  return lines.join("\n");
}
function resolveNoteText(flags, positional) {
  const textFlag = flagString(flags, "text");
  const textFile = flagString(flags, "text-file");
  const given = [positional.length > 0, textFlag !== void 0, textFile !== void 0].filter(Boolean).length;
  if (given > 1) {
    fail(
      "invalid_value",
      "the note text was given more than one way (positional, --text, --text-file). Nothing written.",
      "pass it as a positional argument, with --text=\u2026, or with --text-file=<path|->, not more than one"
    );
  }
  let raw;
  if (textFile !== void 0) {
    raw = textFile === "-" ? readStdin() : readTextFile(textFile);
  } else if (textFlag !== void 0) {
    raw = textFlag;
  } else {
    raw = positional.join(" ");
  }
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (text === "") {
    fail(
      "missing_argument",
      "nanojira note needs the note text as an argument",
      'nanojira note --id=TSK-007 "\u2026" (or --text=\u2026, --text-file=<path|->)'
    );
  }
  return text;
}
function readTextFile(filePath) {
  try {
    return fs16.readFileSync(filePath, "utf8");
  } catch (e) {
    return fail(
      "not_found",
      `--text-file: cannot read '${filePath}' \u2014 ${e.message}. Nothing written.`,
      "give a readable path, or `-` to read stdin"
    );
  }
}
function cmdNote(flags, positional) {
  checkCommandFlags(flags, "note");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);
  requireTargetFlagSyntax(flags);
  const text = resolveNoteText(flags, positional);
  const author = resolveActingName(flags, false);
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const ts2 = nowIso();
    const result = runBatch(
      batchIds,
      (id) => {
        const el2 = resolveById(ctx, id, true);
        requireWritable(el2);
        requireActive(el2, "note");
        return el2;
      },
      (el2) => {
        const signer2 = author !== null ? author : el2.assignee !== "" ? el2.assignee : "?";
        const newBody2 = withNote(el2, text, signer2, ts2);
        guardedWriteCatchable(el2, renderElement(el2, /* @__PURE__ */ new Map([["updated", ts2]]), newBody2), flags.has("force"), ctx.backlog);
        const fresh2 = loadElement(el2.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e) => e.file === el2.file ? fresh2 : e), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh2, ctx.backlog, ctx.cfg);
        return { ok: true, changed: ["body"], entry, _problems: entry._problems };
      }
    );
    if (result.anyWritten) {
      refreshStatus(ctx.backlog, ctx.cfg, ctx);
      refreshTags(ctx.backlog, ctx.cfg, ctx);
    }
    const results = opts.quiet || opts.fields !== void 0 ? result.results.map((r) => r.ok ? trimResult(r, opts) : r) : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results) out(r.ok ? `${r.id} note added` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, "note");
  const ts = nowIso();
  const signer = author !== null ? author : el.assignee !== "" ? el.assignee : "?";
  const newBody = withNote(el, text, signer, ts);
  const overrides = /* @__PURE__ */ new Map([["updated", ts]]);
  guardedWrite(el, renderElement(el, overrides, newBody), flags.has("force"), ctx.backlog);
  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e) => e.file === el.file ? fresh : e), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  recordChange(ctx.backlog, () => buildWriteResult(fresh, ["body"], ctx.backlog, ctx.cfg));
  if (json) emitWriteResultOpts(true, fresh, ["body"], ctx.backlog, ctx.cfg, void 0, opts);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} note added`);
  return 0;
}

// src/commands/cmd-release.ts
function releaseOne(ctx, el, name, ts) {
  const decide = (h) => {
    const held = h && h.kind === "claimed" ? h.name : null;
    if (held === null) return { terminal: true };
    if (held !== name) return { terminal: true, holder: held };
    return { append: { kind: "released", name } };
  };
  const t = transition(ctx.backlog, el.id, ts, decide);
  if (!t.ok) {
    if (t.terminal === "changed_in_parallel") {
      fail("changed_in_parallel", `${el.id}: too many concurrent release attempts, please retry`);
    }
    if (t.terminal === "refused") {
      fail("refused:claimed", `${el.id} is claimed by ${t.holder} \u2014 refused`, "only the holder may release it");
    }
  }
  const changed = t.ok ? ["claim"] : [];
  const entry = entryJson(el, ctx.backlog, ctx.cfg);
  return { ok: true, changed, entry, _problems: entry._problems, claim: null };
}
function cmdRelease(flags) {
  checkCommandFlags(flags, "release");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);
  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true);
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const result = runBatch(
      batchIds,
      (id) => resolveById(ctx, id, true),
      (el2) => releaseOne(ctx, el2, name, nowIso())
    );
    const results = opts.quiet || opts.fields !== void 0 ? result.results.map((r) => r.ok ? trimResult(r, opts) : r) : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else {
      for (const r of result.results) {
        out(r.ok === false ? `${r.id}: Error: ${r.error}` : (r.changed || []).length > 0 ? `${r.id} released by ${name}` : `${r.id} is already unclaimed`);
      }
    }
    return result.ok ? 0 : 1;
  }
  const el = resolveTarget(ctx, flags, true);
  const ts = nowIso();
  const single = releaseOne(ctx, el, name, ts);
  const built = Object.assign({ ok: single.ok, id: el.id }, single);
  recordChange(ctx.backlog, () => built);
  if (json) {
    const final = opts.quiet || opts.fields !== void 0 ? trimResult(built, opts) : built;
    out(JSON.stringify(final, null, 2));
  } else {
    out(single.changed.length > 0 ? `${el.id} released by ${name}` : `${el.id} is already unclaimed`);
  }
  return 0;
}

// src/commands/cmd-rm.ts
import * as fs17 from "node:fs";
function removeIfEmpty(dir) {
  try {
    fs17.rmdirSync(dir);
  } catch {
  }
}
function cmdRm(flags) {
  checkCommandFlags(flags, "rm");
  const json = flags.has("json");
  const ctx = context(flags);
  requireNoStubs(ctx, "rm");
  requireNoUnreadableDirs(ctx, "rm");
  const el = resolveTarget(ctx, flags, true);
  requireActive(el, "rm");
  const kids = descendants(ctx, el);
  if (kids.length > 0 && !flags.has("cascade")) {
    const names = kids.map((c) => `  ${c.id}  ${c.title}`).join("\n");
    fail(
      "refused:has_children",
      `${el.id} still has child elements \u2014 refusing to delete:
${names}`,
      "pass --cascade to delete the whole subtree"
    );
  }
  const victims = [el].concat(kids);
  const archivedVictims = victims.filter((v) => v.archived);
  if (archivedVictims.length > 0) {
    fail(
      "refused:archived",
      `the subtree contains archived elements \u2014 refusing to delete:
${archivedVictims.map((v) => "  " + v.id).join("\n")}`,
      "archived elements are read-only in round one"
    );
  }
  const victimIds = new Set(victims.map((v) => v.id));
  const dependents = ctx.elements.filter((e) => !victimIds.has(e.id) && e.depends_on.some((d) => victimIds.has(d))).sort(compareElements);
  const entries = victims.map((v) => entryJson(v, ctx.backlog, ctx.cfg));
  for (const v of victims.slice().reverse()) {
    fs17.unlinkSync(v.file);
    const own = ctx.cfg.layout.group === "hierarchy" ? ownFolder(v) : null;
    if (own !== null) removeIfEmpty(own);
    removeClaimDirWholesale(ctx.backlog, v.id);
  }
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const built = flags.has("cascade") && kids.length > 0 ? { ok: true, ids: victims.map((v) => v.id), changed: ["deleted"], entries, _problems: [], dependents: dependents.map((d) => d.id) } : { ok: true, id: el.id, changed: ["deleted"], entry: entries[0], _problems: entries[0]._problems, dependents: dependents.map((d) => d.id) };
  recordChange(ctx.backlog, () => built);
  if (json) {
    out(JSON.stringify(built, null, 2));
  } else {
    for (const v of victims) out(`${v.id} deleted (${v.file})`);
    out(`Tombstone${victims.length > 1 ? "s" : ""} kept \u2014 the ID${victims.length > 1 ? "s stay" : " stays"} claimed forever.`);
    for (const d of dependents) {
      out(`\u26A0 ${d.id} depends_on a deleted element \u2014 it now carries depends_on:dangling.`);
    }
  }
  return 0;
}

// src/commands/cmd-set.ts
import * as path14 from "node:path";
function buildSetInputFlags(inputValue) {
  const raw = readInputText(inputValue);
  const parsed = parseInputJson(raw);
  if (Array.isArray(parsed)) fail("invalid_value", "set --input= takes exactly one object, not an array \u2014 set has no plan form");
  if (parsed === null || typeof parsed !== "object") fail("invalid_value", "--input must be a JSON object");
  const allowed = cliFieldNames("set").filter((f) => f !== "id" && f !== "file");
  const synFlags = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!allowed.includes(key)) {
      fail("unknown_field", `unknown field '${key}' in --input. Nothing written.`, `Known fields: ${allowed.join(", ")}`);
    }
    if (key === "acceptance" && Array.isArray(value)) {
      for (const line of value) if (typeof line !== "string") fail("invalid_value", `--input: 'acceptance' array items must be strings`);
      synFlags.set(key, value.map((s) => `- [ ] ${s}`).join("\n"));
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item !== "string") fail("invalid_value", `--input: '${key}' array items must be strings`);
      synFlags.set(key, value.join(","));
      continue;
    }
    if (typeof value !== "string") fail("invalid_value", `--input: '${key}' must be a string${key === "acceptance" ? " or an array of strings" : ""}`);
    synFlags.set(key, value);
  }
  return synFlags;
}
function reparentMove(ctx, el, newParentId) {
  if (ctx.cfg.layout.group !== "hierarchy") return null;
  const byId = new Map(el.byId);
  const shadow = { ...el, parent: newParentId };
  byId.set(el.id, shadow);
  const dir = expectedPlace(shadow, byId, ctx.cfg.layout);
  if (el.type === "subtask") return { src: el.file, dst: path14.join(ctx.backlog, dir, path14.basename(el.file)) };
  const own = ownFolder(el);
  return { src: own, dst: path14.join(ctx.backlog, dir) };
}
function setsFinalStatus(ctx, overrides) {
  return overrides.get("status") === ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
}
function cmdSet(flags) {
  checkCommandFlags(flags, "set");
  const json = flags.has("json");
  const opts = parseOutputOpts(flags, json);
  const force = flags.has("force");
  const allowOpen = flags.has("allow-open-children");
  const ctx = context(flags);
  const inputValue = flagString(flags, "input");
  let sourceFlags = flags;
  if (inputValue !== void 0) {
    for (const f of cliFieldNames("set").filter((x) => x !== "id" && x !== "file")) {
      if (flags.has(f)) fail("invalid_value", "--input cannot be combined with field flags");
    }
    if (opts.quiet || opts.fields !== void 0) fail("invalid_value", "--input cannot be combined with --quiet or --fields");
    sourceFlags = buildSetInputFlags(inputValue);
  }
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    if (flagString(flags, "file") !== void 0) fail("invalid_target", "use either --id or --file, not both");
    validateFieldValues(ctx, sourceFlags);
    const result = runBatch(
      batchIds,
      (id) => {
        const el2 = resolveById(ctx, id, true);
        requireWritable(el2);
        requireActive(el2, "set");
        const { overrides: overrides2, changed: changed2, newBody: newBody2, movePlan: movePlan2, moveDst: moveDst2 } = collectSetOverrides(ctx, el2, sourceFlags, allowOpen);
        return { el: el2, overrides: overrides2, changed: changed2, newBody: newBody2, movePlan: movePlan2, moveDst: moveDst2 };
      },
      (item) => {
        if (item.changed.length === 0) {
          const entry2 = entryJson(item.el, ctx.backlog, ctx.cfg);
          return { ok: true, changed: [], entry: entry2, _problems: entry2._problems };
        }
        const ts2 = nowIso();
        item.overrides.set("updated", ts2);
        const isFinal2 = setsFinalStatus(ctx, item.overrides);
        const released2 = isFinal2 ? releaseUnconditional(ctx.backlog, item.el.id, ts2) : void 0;
        try {
          guardedWriteCatchable(item.el, renderElement(item.el, item.overrides, item.newBody), force, ctx.backlog);
        } catch (e) {
          if (released2 !== void 0) undoRelease(ctx.backlog, item.el.id, released2.holder, ts2);
          throw e;
        }
        if (item.movePlan !== null) runMove(item.movePlan);
        const fresh2 = loadElement(item.moveDst ?? item.el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e) => e.file === item.el.file ? fresh2 : e), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh2, ctx.backlog, ctx.cfg);
        return Object.assign(
          { ok: true, changed: item.changed, entry, _problems: entry._problems },
          released2 !== void 0 ? { released: released2.holder } : {},
          openAcceptanceExtra(fresh2, ctx.cfg, isFinal2)
        );
      }
    );
    if (result.anyWritten) {
      refreshStatus(ctx.backlog, ctx.cfg, ctx);
      refreshTags(ctx.backlog, ctx.cfg, ctx);
    }
    const results = opts.quiet || opts.fields !== void 0 ? result.results.map((r) => r.ok ? trimResult(r, opts) : r) : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results) out(r.ok ? `${r.id} \u2192 ${(r.changed || []).join(", ") || "unchanged"}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, "set");
  const { overrides, changed, newBody, movePlan, moveDst } = collectSetOverrides(ctx, el, sourceFlags, allowOpen);
  if (changed.length === 0) {
    recordChange(ctx.backlog, () => buildWriteResult(el, [], ctx.backlog, ctx.cfg));
    if (json) emitWriteResultOpts(true, el, [], ctx.backlog, ctx.cfg, void 0, opts);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }
  const ts = nowIso();
  overrides.set("updated", ts);
  const isFinal = setsFinalStatus(ctx, overrides);
  const released = isFinal ? releaseUnconditional(ctx.backlog, el.id, ts) : void 0;
  if (isFinal) {
    try {
      guardedWriteCatchable(el, renderElement(el, overrides, newBody), force, ctx.backlog);
    } catch (e) {
      if (released !== void 0) undoRelease(ctx.backlog, el.id, released.holder, ts);
      throw e;
    }
  } else {
    guardedWrite(el, renderElement(el, overrides, newBody), force, ctx.backlog);
  }
  if (movePlan !== null) runMove(movePlan);
  const fresh = loadElement(moveDst ?? el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e) => e.file === el.file ? fresh : e), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const extra = Object.assign({}, released !== void 0 ? { released: released.holder } : {}, openAcceptanceExtra(fresh, ctx.cfg, isFinal));
  recordChange(ctx.backlog, () => buildWriteResult(fresh, changed, ctx.backlog, ctx.cfg, extra));
  if (json) emitWriteResultOpts(true, fresh, changed, ctx.backlog, ctx.cfg, extra, opts);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} \u2192 ${changed.map((c) => `${c}=${describeField(fresh, c)}`).join(", ")}`);
  return 0;
}
function validateFieldValues(ctx, flags) {
  const title = flagString(flags, "title");
  if (title !== void 0 && normalizeTitle(title) === "") fail("invalid_value", "--title must not be empty");
  const status = flagString(flags, "status");
  if (status !== void 0 && !ctx.cfg.statuses.includes(status)) {
    fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, ctx.cfg.statuses));
  }
  const priority = flagString(flags, "priority");
  if (priority !== void 0 && !PRIORITIES.includes(priority)) {
    fail("invalid_value", `unknown priority '${priority}'`, valueHint("priority", priority, PRIORITIES));
  }
  validateTagsCombination(flags);
}
function validateTagsCombination(flags) {
  const direct = flagString(flags, "tags");
  if (direct === void 0) return;
  if (flagString(flags, "add-tags") !== void 0 || flagString(flags, "remove-tags") !== void 0) {
    fail(
      "invalid_value",
      "--tags cannot be combined with --add-tags or --remove-tags",
      "use --tags=<list> to replace the whole list, or --add-tags/--remove-tags to change it incrementally"
    );
  }
}
function applyTagsEdits(current, remove, add) {
  const kept = remove === void 0 ? current.slice() : current.filter((t) => !remove.includes(t));
  if (add === void 0) return kept;
  for (const t of add) if (!kept.includes(t)) kept.push(t);
  return kept;
}
function collectSetOverrides(ctx, el, flags, allowOpen) {
  const sections = readSectionFlags(flags);
  validateTagsCombination(flags);
  const overrides = /* @__PURE__ */ new Map();
  const changed = [];
  const title = flagString(flags, "title");
  let newBody;
  if (title !== void 0) {
    const clean = normalizeTitle(title);
    if (clean === "") fail("invalid_value", "--title must not be empty");
    if (clean !== el.title) {
      overrides.set("title", clean);
      changed.push("title");
      newBody = syncH1(el.body, clean);
    }
  }
  const parent = flagString(flags, "parent");
  let movePlan = null;
  let moveDst = null;
  if (parent !== void 0) {
    const newParentId = checkExplicitParent(ctx, el.type, parent, "move");
    if (newParentId !== el.parent) {
      overrides.set("parent", newParentId);
      changed.push("parent");
      const move = reparentMove(ctx, el, newParentId);
      if (move !== null) {
        const plan = planMove(move.src, move.dst);
        if (plan.conflicts.length > 0) {
          fail(
            "exists",
            `${plan.conflicts[0]} already exists \u2014 refusing to overwrite; nothing was moved`,
            "move or delete it, then set --parent again"
          );
        }
        movePlan = plan;
        moveDst = el.type === "subtask" ? move.dst : path14.join(move.dst, path14.basename(el.file));
      }
    }
  }
  const status = flagString(flags, "status");
  if (status !== void 0) {
    if (!ctx.cfg.statuses.includes(status)) {
      fail("invalid_value", `unknown status '${status}'`, valueHint("status", status, ctx.cfg.statuses));
    }
    if (status === "done") {
      requireNoUnreadableDirs(ctx, "set --status=done");
      const open = el.children.filter((c) => !c.archived && c.status !== "done");
      if (open.length > 0 && !allowOpen) {
        const names = open.map((c) => `  ${c.id}  ${c.status.padEnd(8)} ${c.title}`).join("\n");
        fail(
          "refused:children_open",
          `${el.id} has children that are not done \u2014 refusing to set done:
${names}`,
          "finish them first, or pass --allow-open-children"
        );
      }
    }
    if (status !== el.status) {
      overrides.set("status", status);
      changed.push("status");
    }
  }
  const priority = flagString(flags, "priority");
  if (priority !== void 0) {
    if (!PRIORITIES.includes(priority)) fail("invalid_value", `unknown priority '${priority}'`, valueHint("priority", priority, PRIORITIES));
    if (priority !== el.priority) {
      overrides.set("priority", priority);
      changed.push("priority");
    }
  }
  const assignee = flagString(flags, "assignee");
  if (assignee !== void 0 && assignee !== el.assignee) {
    overrides.set("assignee", assignee === "" ? void 0 : assignee);
    changed.push("assignee");
  }
  const directTags = parseListFlag(flags, "tags");
  const addTags = parseListFlag(flags, "add-tags");
  const removeTags = parseListFlag(flags, "remove-tags");
  const nextTags = directTags !== void 0 ? directTags : addTags !== void 0 || removeTags !== void 0 ? applyTagsEdits(el.tags, removeTags, addTags) : void 0;
  if (nextTags !== void 0) {
    const cur = el.tags;
    if (nextTags.length !== cur.length || nextTags.some((x, i) => x !== cur[i])) {
      overrides.set("tags", nextTags.length === 0 ? void 0 : nextTags);
      changed.push("tags");
      const added = nextTags.filter((t) => !cur.includes(t));
      if (added.length > 0) warnTagNearMatches(added, ctx.elements.flatMap((e) => e.tags));
    }
  }
  const depsV = parseListFlag(flags, "depends_on");
  if (depsV !== void 0) {
    for (const d of depsV) {
      if (!ctx.elements.some((e) => e.id === d)) fail("not_found", `depends_on target '${d}' does not exist`);
    }
    const cur = el.depends_on;
    if (depsV.length !== cur.length || depsV.some((x, i) => x !== cur[i])) {
      overrides.set("depends_on", depsV.length === 0 ? void 0 : depsV);
      changed.push("depends_on");
    }
  }
  if (sections.size > 0) {
    const base = newBody === void 0 ? el.body : newBody;
    const applied = applySections(base, sections, ctx.cfg);
    if (applied.body !== base) newBody = applied.body;
    changed.push(...applied.changed);
  }
  return { overrides, changed, newBody, movePlan, moveDst };
}
function isSectionRole(field) {
  return field === "description" || field === "acceptance";
}
function describeField(el, field) {
  if (isSectionRole(field)) return "(body section)";
  const v = el[field];
  return Array.isArray(v) ? v.length ? v.join(",") : "(empty)" : typeof v === "string" && v === "" ? "(empty)" : String(v);
}

// src/commands/cmd-show.ts
function parseNotesFlag(flags) {
  const raw = flagString(flags, "notes");
  if (raw === void 0) return void 0;
  if (raw === "all") return { kind: "all" };
  if (raw === "none") return { kind: "none" };
  const m = /^last:(-?\d+)$/.exec(raw);
  if (m !== null) {
    const n = Number(m[1]);
    if (n >= 1) return { kind: "last", n };
    fail("invalid_value", `--notes=last:${m[1]} \u2014 N must be a positive integer, not ${m[1]}`);
  }
  fail("invalid_value", `unknown --notes value '${raw}'`, listHint("--notes values", raw, ["none", "all", "last:N"]));
}
function visibleNotes(all, mode) {
  if (mode.kind === "all") return all;
  if (mode.kind === "none") return [];
  return all.slice(Math.max(0, all.length - mode.n));
}
function withNotesExtra(entry, body, mode) {
  if (mode === void 0) return entry;
  const all = parseNotes(body);
  return Object.assign({}, entry, { notes: visibleNotes(all, mode), notes_total: all.length });
}
function renderBodyForNotes(body, mode) {
  if (mode === void 0 || mode.kind === "all") return body;
  const lines = body.split("\n");
  const bounds = notesSectionBounds(lines);
  if (bounds === null) return body;
  const all = parseNotes(body);
  if (all.length === 0) return body;
  const visible = visibleNotes(all, mode);
  const hidden = all.length - visible.length;
  const before = lines.slice(0, bounds.headingLine + 1);
  const after = lines.slice(bounds.endLine);
  const placeholder = mode.kind === "none" ? [`(${all.length} note${all.length === 1 ? "" : "s"} hidden \u2014 pass --notes=all or --notes=last:N to see them)`] : hidden > 0 ? [`(${hidden} earlier note${hidden === 1 ? "" : "s"} hidden \u2014 pass --notes=all to see them)`] : [];
  const rendered = visible.map((n) => renderNoteLine(n.at, n.actor, n.text));
  return before.concat(placeholder, rendered, after).join("\n");
}
function cmdShow(flags) {
  checkCommandFlags(flags, "show");
  const ctx = context(flags);
  const mode = parseNotesFlag(flags);
  const el = resolveTarget(ctx, flags, false);
  const scope = ctx.elements;
  const shown = flags.has("file") ? [el] : ctx.elements.filter((e) => e.id === el.id).sort(compareElements);
  if (flags.has("json")) {
    const entries = shown.map((e) => withNotesExtra(entryJson(e, ctx.backlog, ctx.cfg), e.body, mode));
    out(JSON.stringify(Object.assign(
      { backlog: ctx.backlog, counts: countsOf(scope.filter((e) => !e.archived)), entries },
      entries.length === 1 ? { entry: entries[0] } : {}
    ), null, 2));
    return 0;
  }
  if (shown.length > 1) {
    out(`\u26A0 ${el.id} is carried by ${shown.length} files (duplicate_id) \u2014 showing all of them.`);
    out("");
  }
  for (const one of shown) {
    if (shown.length > 1) out(`--- ${one.file} ---`);
    showOne(one, ctx.cfg, mode);
    if (one !== shown[shown.length - 1]) out("");
  }
  return 0;
}
function showOne(el, cfg, mode) {
  out(`${el.id}  ${el.title}`);
  out(`  type      ${el.type}`);
  if (el.parent) out(`  parent    ${el.parent}`);
  out(`  status    ${el.status}`);
  out(`  priority  ${el.priority}`);
  if (el.assignee) out(`  assignee  ${el.assignee}`);
  if (el.tags.length) out(`  tags      ${el.tags.join(", ")}`);
  if (el.depends_on.length) out(`  depends   ${el.depends_on.join(", ")}`);
  out(`  created   ${el.created}`);
  out(`  updated   ${el.updated}`);
  if (el.archivedAt) out(`  archived  ${el.archivedAt}`);
  out(`  file      ${el.file}`);
  const probs = elementProblems(el, cfg.problems.ignore);
  out(`  problems  ${probs.length ? probs.join(" ") : "(none)"}`);
  out("");
  const displayBody = renderBodyForNotes(el.body, mode);
  process.stdout.write(displayBody.replace(/^\n/, ""));
  if (displayBody !== "" && !displayBody.endsWith("\n")) out("");
}

// src/commands/cmd-status.ts
function cmdStatus(flags) {
  checkCommandFlags(flags, "status");
  const ctx = context(flags);
  const scope = ctx.elements.filter((e) => !e.archived);
  const counts = countsOf(scope, ctx.scan.unreadable.length);
  const ready = scope.filter((e) => isReady(e, ctx.cfg) && !hasOpenChild(e)).sort(compareElements).slice(0, 5);
  const incomplete = scope.filter(isIncomplete).sort(compareElements).slice(0, 5);
  if (flags.has("json")) {
    out(JSON.stringify({
      backlog: ctx.backlog,
      counts,
      ready: ready.map((e) => entryJson(e, ctx.backlog, ctx.cfg)),
      incomplete: incomplete.map((e) => entryJson(e, ctx.backlog, ctx.cfg))
    }, null, 2));
    return 0;
  }
  out(`backlog: ${ctx.backlog}`);
  out(`${counts.total} entries \xB7 ${counts.errors} error${counts.errors === 1 ? "" : "s"} \xB7 ${counts.incomplete} incomplete`);
  out("");
  out("Ready to work:");
  if (ready.length === 0) out("  (none)");
  for (const e of ready) out(`  ${e.id}  ${e.title}`);
  if (incomplete.length > 0) {
    out("");
    out("Complete first:");
    for (const e of incomplete) {
      out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c) => c.startsWith("incomplete:")).join(" ")}`);
    }
  }
  if (counts.errors > 0) {
    out("");
    out(`${counts.errors} element${counts.errors === 1 ? "" : "s"} with errors \u2014 run \`nanojira doctor\`.`);
  }
  return 0;
}

// src/commands/cmd-tags.ts
function cmdTags(flags) {
  checkCommandFlags(flags, "tags");
  const ctx = context(flags);
  const counts = tagCounts(ctx.elements);
  const names = Array.from(counts.keys()).sort();
  if (flags.has("json")) {
    out(JSON.stringify({ ok: true, tags: names.map((name) => ({ name, count: counts.get(name) })) }, null, 2));
    return 0;
  }
  if (names.length === 0) out("(no tags in use)");
  for (const name of names) out(`${name} (${counts.get(name)})`);
  return 0;
}

// src/commands/cmd-tree.ts
function cmdTree(flags) {
  checkCommandFlags(flags, "tree");
  const ctx = context(flags);
  const all = flags.has("all");
  const scope = ctx.elements.filter((e) => all || !e.archived);
  const id = flagString(flags, "id");
  let roots;
  if (id !== void 0) {
    const el = scope.find((e) => e.id === id);
    if (!el) return fail("not_found", `no element with id '${id}'`);
    roots = [el];
  } else {
    const ids = new Set(scope.map((e) => e.id));
    roots = scope.filter((e) => e.parent === null || !ids.has(e.parent)).sort(compareElements);
  }
  const ordered = [];
  const visited = /* @__PURE__ */ new Set();
  const byParent = childMap(scope);
  for (const a of byParent.values()) a.sort(compareElements);
  const walk = (el, depth) => {
    if (visited.has(el.id)) return;
    visited.add(el.id);
    ordered.push({ el, depth });
    const kids = byParent.get(el.id) || [];
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  if (id === void 0) {
    for (const el of scope.slice().sort(compareElements)) walk(el, 0);
  }
  if (flags.has("json")) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope), entries: ordered.map((o) => entryJson(o.el, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (ordered.length === 0) {
    out("(empty backlog)");
    return 0;
  }
  for (const { el, depth } of ordered) {
    out(`${"  ".repeat(depth)}${el.id}  ${el.status.padEnd(8)} ${el.title}${el.archived ? " (archived)" : ""}${problemSuffix(el, ctx.cfg)}`);
  }
  return 0;
}

// src/commands/cmd-unarchive.ts
import * as path15 from "node:path";
var STABLE_HINT3 = "retry once the backlog is stable \u2014 unarchive takes no --force";
var FIX_HINT = "run `nanojira doctor --fix` to move the files into their places, then unarchive again";
function orderedSubtree(ctx, el) {
  const children = /* @__PURE__ */ new Map();
  for (const e of ctx.elements) {
    if (e.parent === null) continue;
    const a = children.get(e.parent);
    if (a) a.push(e);
    else children.set(e.parent, [e]);
  }
  for (const a of children.values()) a.sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  const out2 = [el];
  const seen = /* @__PURE__ */ new Set([el.id]);
  const walk = (cur) => {
    for (const c of children.get(cur.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out2.push(c);
      walk(c);
    }
  };
  walk(el);
  return out2;
}
function buildUnits(stillArchived, hierarchy) {
  const units = [];
  const covered = [];
  for (const e of stillArchived) {
    const own = hierarchy ? ownFolder(e) : null;
    const src = own !== null ? own : e.file;
    if (covered.some((d) => src === d || src.startsWith(d + path15.sep))) continue;
    units.push({ e, src, dir: own !== null });
    if (own !== null) covered.push(own);
  }
  return units;
}
function unitTarget(backlog, byId, layout, u) {
  const dirRel = placeOf(u.e, byId, layout, false);
  const dir = path15.join(backlog, dirRel);
  return u.dir ? dir : path15.join(dir, path15.basename(u.e.file));
}
function cmdUnarchive(flags) {
  checkCommandFlags(flags, "unarchive");
  const json = flags.has("json");
  const ctx = context(flags);
  requireNoStubs(ctx, "unarchive");
  const el = resolveTarget(ctx, flags, true);
  if (!el.archived) fail("refused:not_archived", `${el.id} is not archived \u2014 unarchive is refused`);
  if (el.parent !== null) {
    const parentEl = ctx.elements.find((e) => e.id === el.parent);
    if (parentEl && parentEl.archived) {
      fail("refused:parent_archived", `${el.id}'s parent '${el.parent}' is archived \u2014 unarchive it instead; its archived subtree comes with it`);
    }
  }
  const full = orderedSubtree(ctx, el);
  const stillArchived = full.filter((e) => e.archived);
  for (const e of stillArchived) requireWritable(e);
  const layout = ctx.cfg.layout;
  const hierarchy = layout.group === "hierarchy";
  const byId = /* @__PURE__ */ new Map();
  for (const e of ctx.elements) if (!byId.has(e.id)) byId.set(e.id, e);
  const refuse = (why) => fail("refused:misplaced", `${el.id} cannot be unarchived \u2014 ${why}; nothing was moved`, FIX_HINT);
  if (hierarchy && placeOf(el, byId, layout, false) === null) {
    refuse(`its parent chain cannot be resolved`);
  }
  const units = buildUnits(stillArchived, hierarchy);
  if (hierarchy) {
    for (const u of units) {
      if (!u.dir) continue;
      const prefix = u.src + path15.sep;
      const foreign = ctx.elements.filter((x) => x.file.startsWith(prefix) && !full.includes(x));
      if (foreign.length > 0) {
        refuse(`${u.src} also holds files of other elements: ${foreign.map((f) => f.id).join(", ")}`);
      }
    }
  }
  const plans = units.map((u) => ({ u, plan: planMove(u.src, unitTarget(ctx.backlog, byId, layout, u)) }));
  for (const { plan } of plans) {
    if (plan.conflicts.length > 0) {
      fail(
        "exists",
        `${plan.conflicts[0]} already exists \u2014 refusing to overwrite; nothing was moved`,
        `move or delete it, then unarchive again`
      );
    }
  }
  for (const e of stillArchived) removeClaimDirWholesale(ctx.backlog, e.id);
  const ts = nowIso();
  for (const e of stillArchived) {
    compareGuard(e, false, ctx.backlog, STABLE_HINT3);
    atomicWrite(e.file, renderElement(e, /* @__PURE__ */ new Map([["archived", void 0], ["updated", ts]]), void 0));
  }
  const emptiedFrom = /* @__PURE__ */ new Set();
  for (const { u, plan } of plans) {
    runMove(plan);
    emptiedFrom.add(path15.dirname(u.src));
  }
  removeEmptiedIdFolders(ctx.backlog, emptiedFrom);
  const moved = stillArchived.map((e) => {
    const own = units.find((u) => u.e.id === e.id);
    if (own) {
      const target2 = unitTarget(ctx.backlog, byId, layout, own);
      return loadElement(own.dir ? path15.join(target2, path15.basename(e.file)) : target2, ctx.backlog, ctx.cfg);
    }
    const covering = units.find((u) => u.dir && e.file.startsWith(u.src + path15.sep));
    const target = covering ? unitTarget(ctx.backlog, byId, layout, covering) : e.file;
    const file = covering ? path15.join(target, path15.relative(covering.src, e.file)) : target;
    return loadElement(file, ctx.backlog, ctx.cfg);
  });
  deriveGraph(ctx.elements.filter((e) => !stillArchived.includes(e)).concat(moved), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  const built = {
    ok: true,
    ids: moved.map((m) => m.id),
    changed: ["unarchived"],
    entries: moved.map((m) => entryJson(m, ctx.backlog, ctx.cfg)),
    _problems: Array.from(new Set(moved.flatMap((m) => elementProblems(m, ctx.cfg.problems.ignore)))).sort()
  };
  recordChange(ctx.backlog, () => built);
  if (json) {
    out(JSON.stringify(built, null, 2));
  } else {
    for (const m of moved) out(`${m.id} unarchived \u2192 ${m.file}`);
  }
  return 0;
}

// src/core/help.ts
var HELP = `nanojira \u2014 NanoJira, a local file-based task tool for agents

  nanojira --version                      print the version and exit
  nanojira                                short status: counts, top ready, problems
  nanojira init                           create the backlog layout
  nanojira <any command> --backlog=<path> use this backlog (else NJ_BACKLOG, else .njrc/backlog/ upward)
  NJ_NOW=<ISO-8601 UTC>                   pin every written timestamp (verification/testing only)
  NJ_ON_CHANGE=<command>                  after each successful write, run it with the --json result on stdin (env only)
  nanojira new --type=task --parent=EPIC-001 --title="\u2026"
               [--status=\u2026] [--priority=\u2026] [--tags=a,b] [--assignee=\u2026] [--depends-on=\u2026]
               [--description=\u2026 | --description-file=\u2026] [--acceptance=\u2026 | --acceptance-file=\u2026]
  nanojira set --id=TSK-009 [--title=\u2026] [--status=\u2026] [--priority=\u2026]
               [--tags=\u2026] [--assignee=\u2026] [--depends-on=\u2026] [--force] [--allow-open-children]
               [--description=\u2026 | --description-file=\u2026] [--acceptance=\u2026 | --acceptance-file=\u2026]

Section writes replace the section; --<role>-file=- reads stdin.
  nanojira note --id=TSK-009 ["text" | --text=\u2026 | --text-file=-|<path>] [--as=\u2026]
  nanojira check --id=TSK-009 [--text=<substring> | --item=<n>] [--on | --off] [--force]
  nanojira show --id=TSK-009 [--notes=none|all|last:N]
  nanojira log --id=TSK-009 [--last=N]
  nanojira list [--status=\u2026] [--type=\u2026] [--tag=\u2026] [--parent=\u2026] [--assignee=\u2026] [--ready] [--all]
  nanojira find "<text>" [--status=\u2026] [--type=\u2026] [--tag=\u2026] [--parent=\u2026] [--assignee=\u2026] [--all] [--case-sensitive]
  nanojira tree [--id=EPIC-001] [--all]
  nanojira tags                           every tag in use, with its carrier count
  nanojira rm --id=TSK-009 [--cascade]
  nanojira archive --id=EPIC-001
  nanojira unarchive --id=EPIC-001
  nanojira claim --id=TSK-009 [--as=\u2026] [--status=\u2026] [--steal=<holder>]
  nanojira release --id=TSK-009 [--as=\u2026]
  nanojira next [--as=\u2026] [--status=\u2026] [--type=\u2026] [--tag=\u2026] [--parent=\u2026] [--assignee=\u2026]
  nanojira doctor [--fix]

Every command accepts --json. Write commands accept --file=<path> instead of
--id to address one file of a duplicated ID unambiguously. set/note/check/
claim/release accept --id=A,B,C (two or more) to apply the same write to
every named element; results come back as {ok, results: [...]}. new/set/
note/check/claim/release accept --quiet ({ok, id}, plus _problems when
non-empty) and --fields=<a,b,...> (keeps entry only, narrowed to those
names) to shrink a --json write result; both require --json and are
mutually exclusive with each other and with --input. show accepts
--notes=none|all|last:N to narrow which notes it shows (all, the default,
is unchanged); log accepts --last=N to show only the last N events of any
kind. Both work with or without --json, and add notes_total/events_total
alongside the narrowed list when given.

Every write command (init, new, set, note, check, claim, release, next,
archive, unarchive, rm, doctor --fix) accepts --dry-run: the whole call
runs against a scratch copy and nothing in the backlog is written. The
result is the real call's own, plus "dry_run": true and "changes": [{path,
kind, op, before, after}] with --json, or a summary of the paths without.

Exit codes: 0 success \xB7 1 command failed \xB7 2 doctor found at least one error.
`;
function synopsisFor(command) {
  const lines = HELP.split("\n");
  const out2 = [];
  let capturing = false;
  let found = false;
  for (const line of lines) {
    const m = /^ {2}nanojira {1,}(\S+)/.exec(line);
    if (m) {
      capturing = m[1] === command;
      if (capturing) {
        found = true;
        out2.push(line);
      }
      continue;
    }
    if (capturing && /^ {2,}\[/.test(line)) {
      out2.push(line);
      continue;
    }
    capturing = false;
  }
  return found ? out2 : null;
}
function closedVocab(fieldName, flags) {
  if (fieldName === "type") return TYPES;
  if (fieldName === "priority") return PRIORITIES;
  if (fieldName !== "status") return null;
  try {
    const backlog = findBacklog(flags, false);
    if (isLegacyBacklog(backlog)) return DEFAULT_CONFIG.statuses;
    const { config, errors } = loadConfig(backlog, false);
    return errors.length === 0 ? config.statuses : DEFAULT_CONFIG.statuses;
  } catch {
    return DEFAULT_CONFIG.statuses;
  }
}
function commandHelp(command, flags) {
  const synopsis = synopsisFor(command);
  if (synopsis === null) return HELP;
  const names = acceptedFlagNames(command);
  if (names === null) return synopsis.join("\n") + "\n";
  const rows = names.map((name) => {
    const d = flagDoc(command, name);
    const vocab = closedVocab(name, flags);
    const text = vocab ? `${d.text}; allowed: ${vocab.join(", ")}` : d.text;
    return { left: `  --${displayFlagName(name)}${d.value === void 0 ? "" : "=" + d.value}`, text };
  });
  const width = Math.max(...rows.map((r) => r.left.length)) + 3;
  const lines = synopsis.slice();
  if (rows.length > 0) {
    lines.push("");
    for (const r of rows) lines.push((r.left.padEnd(width) + r.text).trimEnd());
  }
  return lines.join("\n") + "\n";
}

// src/nanojira.ts
var GLOBAL_PREFIX_FLAGS = /* @__PURE__ */ new Set(["backlog", "json"]);
function splitCommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return { cmd: a, rest: argv.slice(0, i).concat(argv.slice(i + 1)) };
    const eq = a.indexOf("=");
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!GLOBAL_PREFIX_FLAGS.has(name)) break;
  }
  return { cmd: null, rest: argv };
}
function main(argv) {
  const pre = parseArgs(argv);
  output.json = pre.flags.has("json");
  if (pre.flags.has("version")) {
    const onlyVersionAndJson = Array.from(pre.flags.keys()).every((k) => k === "version" || k === "json");
    if (onlyVersionAndJson && pre.positional.length === 0) {
      process.stdout.write(output.json ? JSON.stringify({ version: VERSION }) + "\n" : `nanojira ${VERSION}
`);
      return 0;
    }
    fail("unknown_field", `unknown field 'version'.`, "--version takes no other flag and names no command");
  }
  const { cmd, rest } = splitCommand(argv);
  const { flags, positional } = parseArgs(rest);
  if (cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.has("help")) {
    process.stdout.write(cmd === null ? HELP : commandHelp(cmd, flags));
    return 0;
  }
  checkClockEnv();
  beginOnChange(cmd, flags);
  switch (cmd) {
    case null:
      return cmdStatus(flags);
    case "init":
      return cmdInit(flags);
    case "new":
      return cmdNew(flags);
    case "set":
      return cmdSet(flags);
    case "note":
      return cmdNote(flags, positional);
    case "check":
      return cmdCheck(flags);
    case "show":
      return cmdShow(flags);
    case "log":
      return cmdLog(flags);
    case "list":
      return cmdList(flags);
    case "find":
      return cmdFind(flags, positional);
    case "tree":
      return cmdTree(flags);
    case "tags":
      return cmdTags(flags);
    case "rm":
      return cmdRm(flags);
    case "archive":
      return cmdArchive(flags);
    case "unarchive":
      return cmdUnarchive(flags);
    case "claim":
      return cmdClaim(flags);
    case "release":
      return cmdRelease(flags);
    case "next":
      return cmdNext(flags);
    case "doctor":
      return cmdDoctor(flags);
    default:
      fail("unknown_command", `unknown command '${cmd}'`, "run `nanojira help` for the command list");
  }
}
var returned = false;
try {
  process.exitCode = main(process.argv.slice(2));
  returned = true;
} catch (e) {
  if (e instanceof Fail) {
    emitFailure(e.code, e.message, e.hint);
  } else {
    emitFailure("internal_error", e && e.stack ? e.stack : String(e));
  }
}
finishDryRun();
if (returned) fireRecordedChange();
