/*
 * NanoJira verification harness — zero dependencies, Node built-ins only.
 *
 * Contract for every test file in this tree:
 *
 *   import * as H from '../lib/harness.ts';
 *   H.runNj(['list'], {cwd: dir});
 *   H.T.eq('description', actual, expected);
 *   H.T.finish();          // prints PASS/FAIL, exits 0 or 1
 *
 * The nj script path is given as argv[2] (or the NJ environment variable).
 * Tests drive `nj` as a black box: they never require() it, never read its
 * source, and assert only on observable behaviour — exit code, stdout, stderr
 * and the bytes of the files it leaves behind.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* One-off git config from the environment never reaches a fixture
 * (DECISIONS 202, A). git reads GIT_CONFIG_COUNT/KEY_<n>/VALUE_<n> (and
 * GIT_CONFIG_PARAMETERS, what `git -c` exports to its children) ABOVE a
 * repo's own local config -- and tools/release.ts is invoked with exactly
 * these, carrying the release signing identity. Inherited by the test gate,
 * they overrode every fixture repo's own `git config user.signingkey`
 * (ac-56's fixture tags came out unsignable). Scrubbed here, once, at load,
 * so every git a test spawns -- with or without an explicit env -- sees only
 * the config its fixture set up; a case that needs them (release-regression's
 * signing fixtures) passes them explicitly. */
const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/;
for (const k of Object.keys(process.env)) {
  if (GIT_CONFIG_ENV.test(k)) delete process.env[k];
}

export interface NjCommand {
  cmd: string;
  args: string[];
}

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  timeout?: number;
  unsetEnv?: string[];
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  missing?: string;
  shim?: unknown;
  /** Wall time of the spawn, set by runPath(). */
  ms?: number;
}

export interface JsonRunResult extends RunResult {
  // deliberately `any`: the oracle drives nanojira as a black box and
  // asserts on whatever shape a given command's --json happens to return
  // (show/list/doctor/etc. each have a different shape); modelling the
  // full CLI JSON contract here would duplicate src/'s own types without
  // adding safety the black-box tests actually rely on.
  json: any;
  parseError: string | null;
}

/* Resolved to an absolute path at load time. Tests spawn nanojira with the scratch
 * backlog as cwd, so a relative path given here would be re-resolved against
 * the wrong directory and every test would report CANNOT RUN — pointing at the
 * suite instead of at the missing argument. */
const NJ: string | null = (() => {
  const given = process.env.NJ || process.argv[2] || null;
  return given ? path.resolve(given) : null;
})();
const NODE: string = process.env.NJ_NODE || process.execPath;

/* How to invoke a given nanojira-or-nanojira-mcp path (§ 18, DECISIONS 187): a `.mjs`/
 * `.cjs`/`.js` file (the gate's own frozen `dist/nanojira.mjs`/old extensionless
 * `dist/nanojira` steps included) is run as `<NODE> <path> <args>`, so NJ_NODE
 * still pins exactly which node runs it (that file has no shebang logic of
 * its own to honour NJ_NODE); a launcher with no such extension (`bin/nanojira`,
 * a POSIX sh script) is run directly -- `node bin/nanojira` is not valid
 * JavaScript for node to parse, and the launcher already reads NJ_NODE
 * itself (§ 18's wrapper contract). Every suite driving nanojira or nanojira-mcp
 * through a raw spawn (not just runNj/runJson below) uses this, so a
 * caller does not have to special-case `bin/nanojira` at every call site. */
function isDirectExec(p: string): boolean { return !/\.(mjs|cjs|js|ts)$/.test(p); }
function njCommand(njPath: string, args: string[]): NjCommand {
  if (!isDirectExec(njPath)) return { cmd: NODE, args: [njPath].concat(args) };
  return { cmd: njPath, args };
}

/* `dist/nanojira-mcp.mjs` (§ 17 "MCP Interface"), resolved the same way NJ is:
 * NJ_MCP wins if set, otherwise the sibling `nanojira-mcp` next to whatever NJ
 * resolved to, with NJ's own extension (both ship from the same `dist/`
 * directory, § 3, § 18) — `.mjs` for the current bundle, or none for an old,
 * frozen `dist/nanojira` replayed by the gate. Not required to exist — tests that
 * need it check with requireNjMcp(). */
const NJ_MCP: string | null = (() => {
  const given = process.env.NJ_MCP || null;
  if (given) return path.resolve(given);
  return NJ ? path.join(path.dirname(NJ), 'nanojira-mcp' + path.extname(NJ)) : null;
})();

/* The bundle itself, always a `dist/*.mjs` path, regardless of which shape
 * (bin/ launcher or bare bundle) NJ resolves to (D187 addendum, 81cd90a): a
 * few tests need to run `dist/nanojira.mjs` directly even when NJ under test is
 * `bin/nanojira` — e.g. a NODE_OPTIONS-preloaded shim (fault/det-id-retry.ts),
 * since `bin/nanojira`'s wrapper deliberately strips NODE_OPTIONS before exec'ing
 * node (§ 18) and would silently defeat the shim rather than fail loudly.
 * When NJ is already a bundle path, NJ_BUNDLE is simply NJ itself. */
const NJ_BUNDLE: string | null = (() => {
  if (!NJ) return null;
  if (!isDirectExec(NJ)) return NJ;
  return path.join(path.dirname(NJ), '..', 'dist', path.basename(NJ) + '.mjs');
})();

/* Fixed clock for every run (§ 12). Timestamps are the only non-deterministic
 * part of a NanoJira file, so pinning the clock is what makes byte-exact
 * golden comparison possible without normalisation. */
const FIXED_NOW = '2026-09-21T18:00:00Z';
const LATER_NOW = '2026-09-21T19:30:00Z';

const GOLDEN_DIR = path.join(__dirname, '..', 'golden');

/* The v3 layout (§ 4, V3-4): everything only nanojira needs lives in `.nanojira/`.
 * Every suite that names a bookkeeping path takes it from here, so a layout
 * change is one edit. (`ac/ac-24-legacy-migration.ts` spells the v2 paths
 * out itself — its fixtures are the legacy layout on purpose.) */
const CONFIG_REL = '.nanojira/config.json';
const IDS_REL = '.nanojira/ids';
const INDEX_REL = '.nanojira/index.json';
const GITIGNORE = INDEX_REL + '\n.nj-tmp-*\n';

/* Fixture root — deliberately NOT `os.tmpdir()`. `os.tmpdir()` honours
 * `TMPDIR`, and in at least one real environment this suite has run in,
 * `TMPDIR` is a path with a genuine backlog somewhere in its OWN ancestor
 * chain (another team's working tree, `TMPDIR=.../state/tmp` under a repo
 * whose root holds `backlog/`). A fixture meant to prove "no backlog is
 * findable" (an empty directory, no `--backlog`, no `NJ_BACKLOG`) then
 * silently finds that unrelated backlog via nj's own upward search (§ 4) —
 * a real backlog, real entries, exit 0 — instead of `no_backlog`, passing
 * or failing for the wrong reason depending on what's in it that day.
 *
 * Realpath'd either way — `NJ_TEST_ROOT`'s own value included, not just
 * the `/tmp` default — because macOS's `/tmp` is itself a symlink to
 * `/private/tmp`, and a fixture path containing the un-resolved form
 * causes a real, separate failure: `nanojira-mcp` resolves its own `--backlog`
 * at startup and reports paths back in `entry.file`/JSON through that
 * resolved form, so a byte comparison against the CLI side's own
 * un-resolved fixture path (`/tmp/nj-xxx/...` vs `/private/tmp/nj-xxx/
 * ...`) fails on the symlink alone, nothing behavioural
 * (`ac-32-mcp-sdk.ts` C3, `ac-32-mcp.ts` M6, `ac-40-next.ts` N12 — all
 * three confirmed passing under this fix). A caller setting
 * `TMPDIR=/tmp/…` and expecting that alone to steer fixtures would hit
 * this same trap; realpathing whatever root is actually used, always,
 * is what closes it, not merely documenting it. `/tmp`'s own ancestors
 * (`/private`, `/`) are never going to hold a backlog — this is the same
 * root the team's own standing safety rule already names for ad hoc
 * fixtures ("Fixtures only under /tmp/oracle-*"), just applied to the
 * oracle's own harness too. */
const TMP_ROOT = fs.realpathSync(process.env.NJ_TEST_ROOT || '/tmp');

const _tmpDirs: string[] = [];

/** A fresh empty directory. Not a backlog — use mkBacklog() for that. */
function freshDir(label?: string): string {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'nj-' + (label || 't') + '-'));
  _tmpDirs.push(dir);
  return dir;
}

export interface BacklogOpts {
  label?: string;
  config?: string;
  files?: Record<string, string>;
  tombstones?: string[];
}

/**
 * A hand-built backlog, written by the test rather than by `nj init`.
 * Fixture-driven tests must not depend on the very code path they verify.
 *
 * Returns the project directory (the backlog lives in <dir>/backlog).
 *
 * USE THE RETURN VALUE — this function creates its own scratch directory. Do
 * NOT call freshDir() alongside it and then read from that directory instead:
 *
 *   const d = H.freshDir('x');      // ✗ wrong — the backlog lands elsewhere
 *   H.mkBacklog({files: {...}});    //   and every read below sees nothing
 *
 *   const d = H.mkBacklog({label: 'x', files: {...}});   // ✓
 */
function mkBacklog(opts?: BacklogOpts): string {
  const o = opts || {};
  const dir = freshDir(o.label || 'backlog');
  const bl = path.join(dir, 'backlog');
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', IDS_REL]) {
    fs.mkdirSync(path.join(bl, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(bl, CONFIG_REL), o.config || DEFAULT_CONFIG);
  fs.writeFileSync(path.join(bl, '.gitignore'), GITIGNORE);
  fs.writeFileSync(path.join(bl, 'README.md'), '# Backlog\n\nFormat notes.\n');
  for (const [rel, body] of Object.entries(o.files || {})) {
    writeRaw(bl, rel, body);
  }
  for (const id of o.tombstones || []) {
    fs.writeFileSync(path.join(bl, IDS_REL, id), '');
  }
  writeStatus(bl);
  writeTags(bl);
  return dir;
}

const DEFAULT_CONFIG = JSON.stringify({
  schema: 1,
  statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
  sections: {
    description: ['Description'],
    acceptance: ['Acceptance Criteria'],
  },
}, null, 2) + '\n';

/* ------------------------------------------------------------------ */
/* STATUS.md (spec v3 § 4) — one renderer for the whole oracle          */
/* ------------------------------------------------------------------ */

const STATUS_WEIGHT: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

export interface StatusEntry {
  id: string;
  status?: string;
  priority?: string;
  title?: string;
  path: string;
}

/**
 * The § 4 overview for a list of ACTIVE entries {id, status, priority,
 * title, path}. `status` is what `list` shows: a missing status is already
 * statuses[0], an unreadable stub has none (→ `?`). One section per
 * configured status, in order, even when empty; `## ? (n)` last, only when
 * non-empty. Within a section: priority weight descending — missing or
 * unknown = the default's 2 (DECISIONS 100) — then id ascending, then path
 * (both files of a duplicate_id, DECISIONS 95). `- [ID](path) title`; no
 * trailing space without a title. Sections separated by one empty line,
 * exactly one final newline.
 */
function renderStatus(entries: StatusEntry[], statuses?: string[]): string {
  const st = statuses || JSON.parse(DEFAULT_CONFIG).statuses;
  const w = (e: StatusEntry) => (e.priority !== undefined ? STATUS_WEIGHT[e.priority] : undefined) || 2;
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const order = (a: StatusEntry, b: StatusEntry) => (w(b) - w(a)) || cmp(a.id, b.id) || cmp(a.path, b.path);
  const line = (e: StatusEntry) => '- [' + e.id + '](' + e.path + ')' + (e.title ? ' ' + e.title : '');
  const out = ['# Status'];
  for (const s of st) {
    const items = entries.filter(e => e.status === s).sort(order);
    out.push('', '## ' + s + ' (' + items.length + ')');
    if (items.length) out.push('', ...items.map(line));
  }
  const other = entries.filter(e => !st.includes(e.status)).sort(order);
  if (other.length) out.push('', '## ? (' + other.length + ')', '', ...other.map(line));
  return out.join('\n') + '\n';
}

/* The frontmatter fields STATUS.md needs, read per § 7's grammar: a `---`
 * line first and the NEXT `---` closing it, split at the first `:`, one
 * leading space stripped, `#` lines are comments, a quoted value unescaped;
 * an empty known value is absent (§ 14). No block, or a block that is never
 * closed (`frontmatter:unreadable` — nothing in it can be trusted, so no
 * title and no status; the status is then derived, DECISIONS 95 B18) → no
 * fields. */
function statusFields(text: string): Record<string, string> {
  const t = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = t.split('\n');
  const f: Record<string, string> = {};
  if (lines[0] !== '---') return f;
  if (lines.indexOf('---', 1) === -1) return f;
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const l = lines[i];
    if (l.startsWith('#')) continue;
    const c = l.indexOf(':');
    if (c < 0) continue;
    const k = l.slice(0, c);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    let v = l.slice(c + 1);
    if (v.startsWith(' ')) v = v.slice(1);
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1');
    if (v !== '') f[k] = v;
  }
  return f;
}

/**
 * The STATUS.md `nj` would write for a hand-built backlog, from what lies
 * on disk: every `*.md` below it (the v3 scan, § 4 / DECISIONS 91 B11–B12:
 * dot-directories and directory symlinks skipped, the top-level README.md
 * and STATUS.md excluded), archived when below the archive folder, an
 * unreadable file a stub under `?`. Returns null when the configuration
 * cannot be read or switches the overview off (`statusFile: false`) — then
 * nothing is rendered (DECISIONS 100: no overview while config:invalid).
 */
function statusFor(backlogDir: string): string | null {
  let cfg: any;
  try { cfg = JSON.parse(fs.readFileSync(path.join(backlogDir, STATUS_CONFIG_REL), 'utf8')); } catch (e) { return null; }
  if (!configValidForStatus(cfg)) return null;
  const statuses: string[] = cfg.statuses;
  const layout = cfg.layout || {};
  if (layout.statusFile === false) return null;
  const archive: string = (layout.folders && layout.folders.archive) || 'archive';
  const entries: StatusEntry[] = [];
  (function walk(d: string, rel: string) {
    let names: string[];
    try { names = fs.readdirSync(d).sort(); } catch (e) { return; }
    for (const n of names) {
      const r = rel ? rel + '/' + n : n;
      const p = path.join(d, n);
      let lst: fs.Stats, st: fs.Stats | null = null;
      try { lst = fs.lstatSync(p); } catch (e) { continue; }
      try { st = fs.statSync(p); } catch (e) { /* dangling symlink */ }
      if (lst.isDirectory()) { if (!n.startsWith('.')) walk(p, r); continue; }
      if (lst.isSymbolicLink() && st && st.isDirectory()) continue;
      if (!n.endsWith('.md') || (!rel && (n === 'README.md' || n === 'STATUS.md' || n === 'TAGS.md'))) continue;
      if (r === archive || r.startsWith(archive + '/')) continue;
      let text: string | null = null;
      try { text = fs.readFileSync(p, 'utf8'); } catch (e) { /* stub */ }
      if (text === null) { entries.push({ id: n.slice(0, -3), status: undefined, title: undefined, path: r }); continue; }
      const f = statusFields(text);
      entries.push({ id: f.id || n.slice(0, -3), status: f.status || statuses[0], priority: f.priority, title: f.title, path: r });
    }
  })(backlogDir, '');
  return renderStatus(entries, statuses);
}

/**
 * Parses a `tags: [a, b, "c, d"]` line's array value — the only on-disk
 * shape a list field ever takes (parse.ts's own `serializeValue`, always
 * one physical line, newlines in an item already folded to spaces before
 * serialization). Just enough fidelity for the quoting rules
 * `serializeItem` uses (quoted only when an item needs it): this harness's
 * own fixtures never need more.
 */
function parseTagsArray(raw: string): string[] {
  const m = /^\[([\s\S]*)\]$/.exec(raw.trim());
  if (!m) return [];
  const inner = m[1].trim();
  if (inner === '') return [];
  const items: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (inner[i] === ' ') i++;
    if (inner[i] === '"') {
      let j = i + 1, s = '';
      while (j < inner.length && inner[j] !== '"') {
        if (inner[j] === '\\' && j + 1 < inner.length) { s += inner[j + 1]; j += 2; } else { s += inner[j]; j++; }
      }
      items.push(s);
      i = j + 1;
      while (inner[i] === ' ') i++;
      if (inner[i] === ',') i++;
    } else {
      let j = inner.indexOf(',', i);
      if (j === -1) j = inner.length;
      items.push(inner.slice(i, j).trim());
      i = j + 1;
    }
  }
  return items;
}

/** The `tags` field of one element file, [] for a stub or one with none. */
function tagsOf(text: string): string[] {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = t.split('\n');
  if (lines[0] !== '---') return [];
  const end = lines.indexOf('---', 1);
  if (end === -1) return [];
  for (let i = 1; i < end; i++) {
    const m = /^tags:(.*)$/.exec(lines[i]);
    if (!m) continue;
    let v = m[1];
    if (v.startsWith(' ')) v = v.slice(1);
    return parseTagsArray(v);
  }
  return [];
}

/**
 * The TAGS.md `nj` would write for a hand-built backlog (DECISIONS: mirrors
 * `statusFor`, applied to the tag vocabulary instead of status): every tag
 * across every `*.md` below the backlog (top-level README.md/STATUS.md/
 * TAGS.md excluded, same scan as `statusFor`), WITH archived elements
 * included this time — unlike `STATUS.md`, there is no per-status grouping
 * to carve an archived exception out of, and vocabulary drift is exactly as
 * real for an archived element's tags as for a live one's. Returns null
 * under the same conditions `statusFor` does (config unreadable/invalid, or
 * `tagsFile: false`).
 */
function tagsFor(backlogDir: string): string | null {
  let cfg: any;
  try { cfg = JSON.parse(fs.readFileSync(path.join(backlogDir, STATUS_CONFIG_REL), 'utf8')); } catch (e) { return null; }
  if (!configValidForStatus(cfg)) return null;
  const layout = cfg.layout || {};
  if (layout.tagsFile === false) return null;
  const counts = new Map<string, number>();
  (function walk(d: string, rel: string) {
    let names: string[];
    try { names = fs.readdirSync(d).sort(); } catch (e) { return; }
    for (const n of names) {
      const r = rel ? rel + '/' + n : n;
      const p = path.join(d, n);
      let lst: fs.Stats, st: fs.Stats | null = null;
      try { lst = fs.lstatSync(p); } catch (e) { continue; }
      try { st = fs.statSync(p); } catch (e) { /* dangling symlink */ }
      if (lst.isDirectory()) { if (!n.startsWith('.')) walk(p, r); continue; }
      if (lst.isSymbolicLink() && st && st.isDirectory()) continue;
      if (!n.endsWith('.md') || (!rel && (n === 'README.md' || n === 'STATUS.md' || n === 'TAGS.md'))) continue;
      let text: string | null = null;
      try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; /* stub: no tags */ }
      for (const tag of tagsOf(text)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  })(backlogDir, '');
  const names = Array.from(counts.keys()).sort();
  const body = names.length > 0 ? names.map((n) => '- `' + n + '` (' + counts.get(n) + ')').join('\n') : '(no tags in use)';
  return '# Tags\n\n' + body + '\n';
}

/**
 * Whether a parsed configuration satisfies § 5 — the statuses rule and the
 * layout block. Anything else is `config:invalid`, under which nj renders no
 * overview (DECISIONS 100); returning null for it keeps hand-built
 * invalid-config fixtures free of STATUS.md, so a suite can see nj CREATE one
 * (Verifier finding T3). `sections` is not validated here: § 5 gives it no
 * rule beyond its shape, and no fixture breaks it.
 */
function configValidForStatus(cfg: any): boolean {
  if (!cfg || typeof cfg !== 'object') return false;
  const st = cfg.statuses;
  if (!Array.isArray(st) || st.length < 2) return false;
  if (!st.every((x: unknown) => typeof x === 'string' && /^[a-z_]+$/.test(x))) return false;
  if (new Set(st).size !== st.length || st[st.length - 1] !== 'done') return false;
  if (cfg.layout === undefined) return true;
  const L = cfg.layout;
  if (!L || typeof L !== 'object' || Array.isArray(L)) return false;
  if (Object.keys(L).some(k => !['group', 'folders', 'statusFile', 'tagsFile'].includes(k))) return false;
  if (L.group !== undefined && !['type', 'hierarchy', 'flat'].includes(L.group)) return false;
  if (L.statusFile !== undefined && typeof L.statusFile !== 'boolean') return false;
  if (L.tagsFile !== undefined && typeof L.tagsFile !== 'boolean') return false;
  if (L.folders !== undefined) {
    const F = L.folders;
    if (!F || typeof F !== 'object' || Array.isArray(F)) return false;
    const KEYS = ['epics', 'tasks', 'subtasks', 'archive'];
    if (Object.keys(F).some(k => !KEYS.includes(k))) return false;
    const eff = KEYS.map(k => (F[k] === undefined ? k : F[k]));
    for (const n of eff) {
      if (typeof n !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(n)) return false;
      if (/^(EPIC|TSK|SUB)-\d+$/i.test(n) || n.toLowerCase() === 'backlog') return false;
    }
    if (new Set(eff.map((n: string) => n.toLowerCase())).size !== eff.length) return false;
  }
  return true;
}

/**
 * Write a fresh STATUS.md into a hand-built backlog — `H.mkBacklog` does it
 * for every fixture (DECISIONS 100), and a test that changes elements by
 * hand afterwards calls it again before a `doctor` whose findings it pins.
 * Accepts the project dir or the backlog dir. v2 and V3-2 never read a
 * top-level STATUS.md, so the file is neutral for them.
 */
function writeStatus(dirOrBacklog: string): string | null {
  const bl = fs.existsSync(path.join(dirOrBacklog, STATUS_CONFIG_REL)) ? dirOrBacklog : path.join(dirOrBacklog, 'backlog');
  const s = statusFor(bl);
  if (s !== null) fs.writeFileSync(path.join(bl, 'STATUS.md'), s);
  return s;
}

/** `writeStatus`'s own twin, for TAGS.md — `H.mkBacklog` calls both. */
function writeTags(dirOrBacklog: string): string | null {
  const bl = fs.existsSync(path.join(dirOrBacklog, STATUS_CONFIG_REL)) ? dirOrBacklog : path.join(dirOrBacklog, 'backlog');
  const s = tagsFor(bl);
  if (s !== null) fs.writeFileSync(path.join(bl, 'TAGS.md'), s);
  return s;
}

/* The configuration's place until V3-4 moves it (V3-4: '.nanojira/config.json'). */
const STATUS_CONFIG_REL = '.nanojira/config.json';

/** Write raw bytes into a backlog, creating parent folders. */
function writeRaw(backlogRootOrProject: string, rel: string, content: string): string {
  const base = path.basename(backlogRootOrProject) === 'backlog'
    ? backlogRootOrProject
    : path.join(backlogRootOrProject, 'backlog');
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/** Read a file from a backlog (or the project dir if rel starts with 'backlog/'). */
function readInBacklog(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, 'backlog', rel), 'utf8');
}

function existsInBacklog(dir: string, rel: string): boolean {
  return fs.existsSync(path.join(dir, 'backlog', rel));
}

/**
 * Directory listing that never throws. A partially built (or stubbed)
 * implementation produces no directories at all, and a test that dies with
 * ENOENT there reports nothing useful — it must fail on its assertion instead.
 * Returns [] for anything that is not a readable directory.
 */
function lsOrEmpty(p: string): string[] {
  try { return fs.readdirSync(p).sort(); } catch (e) { return []; }
}

/** File read that never throws — null when the file is absent or unreadable. */
function readOrNull(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function listFiles(dir: string, rel?: string): string[] {
  const p = path.join(dir, 'backlog', rel || '.');
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).sort();
}

/** Canonical frontmatter for fixture files, in § 7 key order. */
function element(fields: Record<string, unknown>, body?: string): string {
  const order = ['id', 'type', 'parent', 'title', 'status', 'priority',
    'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived'];
  const keys = order.filter(k => fields[k] !== undefined)
    .concat(Object.keys(fields).filter(k => !order.includes(k)));
  const fm = keys.map(k => k + ': ' + fields[k]).join('\n');
  return '---\n' + fm + '\n---\n\n' + (body === undefined ? '' : body);
}

function mkElement(dir: string, rel: string, fields: Record<string, unknown>, body?: string): string {
  return writeRaw(dir, rel, element(fields, body));
}

/** A minimal but *complete* task body, for fixtures where completeness is not the point. */
function completeBody(title: string): string {
  return '# ' + title + '\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [ ] It works\n';
}

/** Like completeBody, but ticked -- for a live `done` fixture where the
 * unticked box is not the point and would otherwise draw an unrelated
 * done:open_acceptance warning (DECISIONS 176 B). */
function doneBody(title: string): string {
  return '# ' + title + '\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [x] It works\n';
}

function sha256(s: string | NodeJS.ArrayBufferView): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * A doctor run's findings as a comparable set: `code:severity` per finding,
 * the two axes § 7's table defines together. Pass the result of
 * `runJson(['doctor'], …)`.
 *
 * Returns `null` when there is no `problems` array at all — § 9 pins
 * doctor's shape as `{backlog, ok, problems}`, so a missing array is a
 * contract breach, and `null` makes `sameSet` report it instead of silently
 * comparing against an empty set.
 */
function doctorSet(result: { json?: any }): string[] | null {
  const problems = result && result.json && result.json.problems;
  if (!Array.isArray(problems)) return null;
  return problems.map((p: any) => String(p && p.code) + ':' + String(p && p.severity));
}

/**
 * The § 14 summary line, built from the spec's own example:
 *
 *   backlog/: 47 entries, 2 errors, 1 warning
 *
 * Two things that example pins and that nothing in the oracle asserted: the
 * **warning** count exists at all (`ac-16` only checks that the word
 * "entries" occurs), and the counts are singularised — "2 errors" next to
 * "1 warning" is what fixes `error`/`warning` as `s`-at-≠1.
 *
 * AMBIGUOUS: the singular of "entries" is not shown anywhere in § 14, so a
 * one-element backlog is not pinned. Callers must avoid N = 1 rather than
 * guess between "1 entry" and "1 entries"; `entriesWord` exists only to make
 * that choice explicit at the call site if a ruling ever lands.
 */
function summaryLine(label: string, entries: number, errors: number, warnings: number, entriesWord?: string): string {
  const s = (k: number, word: string) => k + ' ' + word + (k === 1 ? '' : 's');
  return label + ': ' + entries + ' ' + (entriesWord || 'entries') + ', ' +
    s(errors, 'error') + ', ' + s(warnings, 'warning');
}

/** Golden file bytes, as frozen in test/golden. */
function golden(name: string): string {
  return fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function goldenPath(name: string): string {
  return path.join(GOLDEN_DIR, name);
}

/**
 * Run `nj`. Returns {status, stdout, stderr, signal}. Never throws on a
 * non-zero exit — that is data, not an error.
 */
function runPath(njPath: string | null, args: string[], opts?: RunOpts): RunResult {
  const o = opts || {};
  if (!njPath) return abortNoImplementation('no nanojira path given (pass it as argv[2] or set NJ)');
  if (!fs.existsSync(njPath)) return abortNoImplementation('nanojira not found at ' + njPath);
  const env = Object.assign({}, process.env, { NJ_NOW: FIXED_NOW });
  // A suite run from a shell (or from inside a hook) that has NJ_ON_CHANGE
  // set must not push test fixtures to that shell's real hook, nor have a
  // stray NJ_HOOK_COMMAND silently disarm the hook a test sets itself
  // (§ 9 "`NJ_ON_CHANGE`"). A test that wants them passes them in `env`.
  for (const k of ['NJ_ON_CHANGE', 'NJ_ON_CHANGE_TIMEOUT', 'NJ_HOOK_COMMAND', 'NJ_HOOK_IDS']) delete env[k];
  Object.assign(env, o.env || {});
  for (const k of o.unsetEnv || []) delete env[k];
  const inv = njCommand(njPath, args);
  const t0 = Date.now();
  const r = spawnSync(inv.cmd, inv.args, {
    cwd: o.cwd,
    env,
    input: o.input,
    encoding: 'utf8',
    timeout: o.timeout || 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  if (r.error) {
    return { status: null, stdout: '', stderr: String(r.error.message), missing: 'spawn failed: ' + r.error.message, signal: r.signal, ms };
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal, ms };
}

/** One line saying how a run ended -- for a fixture step that must not
 * fail, so a rare `status: null` names its own cause (a signal, the spawn
 * timeout, a spawn error) instead of leaving it to a re-run to guess. */
function describeRun(r: RunResult): string {
  return 'status=' + r.status + ' signal=' + (r.signal || null) +
    (r.missing ? ' error=' + JSON.stringify(r.missing) : '') +
    (r.ms !== undefined ? ' after ' + r.ms + ' ms' : '') +
    ' stderr=' + JSON.stringify((r.stderr || '').slice(0, 500));
}
function runNj(args: string[], opts?: RunOpts): RunResult { return runPath(NJ, args, opts); }

/** Run nanojira and parse stdout as JSON, asserting the exit code is as expected. */
function runJson(args: string[], opts?: RunOpts): JsonRunResult {
  const o = opts || {};
  const r = runNj(args.concat(['--json']), o);
  let json: any = null, parseError: string | null = null;
  try { json = JSON.parse(r.stdout); } catch (e) { parseError = (e as Error).message; }
  return Object.assign({}, r, { json, parseError });
}

/* ------------------------------------------------------------------ */
/* Test context                                                        */
/* ------------------------------------------------------------------ */

export interface Failure {
  desc: string;
  detail: string;
}

export interface NotCovered {
  desc: string;
  reason: string;
}

export interface TestContext {
  _failures: Failure[];
  _notCovered: NotCovered[];
  _checks: number;
  _name: string;
  check(desc: string, cond: unknown, detail?: unknown): boolean;
  eq(desc: string, actual: unknown, expected: unknown): boolean;
  goldenEq(desc: string, actualPath: string, goldenName: string): boolean;
  exit(desc: string, result: RunResult, expected: number): boolean;
  contains(desc: string, haystack: unknown, needle: string): boolean;
  sameSet(desc: string, actual: Iterable<unknown>, expected: Iterable<unknown>): boolean;
  notCovered(desc: string, reason: string): void;
  finish(): void;
}

const T: TestContext = {
  _failures: [],
  _notCovered: [],
  _checks: 0,
  _name: path.basename(process.argv[1] || 'test'),

  /** Record a boolean assertion. */
  check(desc, cond, detail) {
    this._checks++;
    if (!cond) {
      this._failures.push({ desc, detail: detail === undefined ? '' : String(detail) });
    }
    return !!cond;
  },

  eq(desc, actual, expected) {
    const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
    const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
    return this.check(desc, a === e, 'expected ' + JSON.stringify(e) + '\n     got      ' + JSON.stringify(a));
  },

  /** Byte-exact file comparison against a golden fixture. */
  goldenEq(desc, actualPath, goldenName) {
    let actual: string;
    try { actual = fs.readFileSync(actualPath, 'utf8'); }
    catch (e) { return this.check(desc, false, 'cannot read ' + actualPath + ': ' + (e as Error).message); }
    const want = golden(goldenName);
    if (actual === want) return this.check(desc, true);
    return this.check(desc, false,
      'file differs from golden/' + goldenName + '\n' + firstDiff(actual, want));
  },

  /**
   * Assert the exit code against a single expected value.
   *
   * `expected` must not be an array. An array reads as the honest form of
   * "the spec does not pin the code", but it is indistinguishable from
   * quietly accepting a bug (AMBIGUITIES.md 23: an either/or here once let a
   * wrong-but-in-set exit code through for a whole round). Derive one value
   * from the spec instead — if it comes back red, that is a finding to
   * escalate, not a reason to widen the assertion.
   */
  exit(desc, result, expected) {
    if (Array.isArray(expected)) {
      throw new Error('T.exit(' + JSON.stringify(desc) + ', …): expected must be a single ' +
        'exit code, not an array — derive one value from the spec (AMBIGUITIES.md 23) ' +
        'instead of tolerating a set of them');
    }
    if (result.missing) {
      return this.check(desc, false, 'CANNOT RUN: ' + result.missing +
        '\n     (the implementation does not exist yet — the oracle is built first)');
    }
    const ok = result.status === expected;
    return this.check(desc, ok,
      'expected exit ' + expected + ', got ' + result.status +
      (result.stderr ? '\n     stderr: ' + trunc(result.stderr) : ''));
  },

  /** A substring assertion that prints surrounding context on failure. */
  contains(desc, haystack, needle) {
    return this.check(desc, String(haystack).includes(needle),
      'expected to contain ' + JSON.stringify(needle) + '\n     in  ' + JSON.stringify(trunc(haystack)));
  },

  /**
   * Assert that two collections hold EXACTLY the same items — nothing
   * missing and, crucially, nothing extra.
   *
   * WHY THIS EXISTS. The oracle's doctor assertions were written as
   * containment (`found.includes(code)`, `problems.some(p => …)`), and a
   * containment check cannot see an *additional* item by construction. A
   * blindness matrix over one-part mutants of `nj` measured the cost: a
   * mutant that appends one spurious `title:h1_mismatch` WARNING whenever
   * real findings already exist left 19 suites green and was caught by none
   * of them. On *clean* backlogs five suites catch it, via
   * `problems.length === 0` — but the moment a genuine finding exists, an
   * extra misclassification became invisible across the whole oracle.
   *
   * So the oracle was good at catching what goes MISSING and blind to what
   * gets ADDED. `sameSet` closes that half: the expected set is derived from
   * § 7's problem-code table — which condition produces which code at which
   * severity — and anything beyond it is a failure, not a tolerated extra.
   *
   * Order-insensitive on purpose: § 9 pins doctor's problem *shape*, and the
   * ordering question belongs to `edge/order-doctor-problems-severity.ts`.
   */
  sameSet(desc, actual, expected) {
    const a = [...actual].map(String).sort();
    const e = [...expected].map(String).sort();
    if (a.length === e.length && a.every((v, i) => v === e[i])) return this.check(desc, true);
    const missing = e.filter(v => !a.includes(v));
    const extra = a.filter(v => !e.includes(v));
    return this.check(desc, false,
      (missing.length ? 'MISSING    ' + JSON.stringify(missing) + '\n     ' : '') +
      (extra.length ? 'UNEXPECTED ' + JSON.stringify(extra) + '\n     ' : '') +
      'expected ' + JSON.stringify(e) + '\n     got      ' + JSON.stringify(a));
  },

  /**
   * Record a leg that cannot be exercised in THIS environment because a
   * named prerequisite is missing (root, a foreign uid, a case-folding
   * filesystem, a macOS-only path, ...) — not a defect, and not the same
   * thing as `T.exit`'s `result.missing` (the implementation itself is
   * absent, which stays a hard failure). Counted alongside real checks,
   * listed separately in the summary, and never enough by itself to turn
   * the file red: a file whose only gaps are not-covered legs, with no
   * real assertion failure, still passes.
   */
  notCovered(desc, reason) {
    this._checks++;
    this._notCovered.push({ desc, reason });
  },

  finish() {
    const name = this._name;
    const notCoveredNote = this._notCovered.length ? ', ' + this._notCovered.length + ' not covered' : '';
    const listNotCovered = () => {
      for (const nc of this._notCovered) {
        console.log('  - ' + nc.desc + ' (not covered)');
        console.log('    ' + nc.reason);
      }
    };
    if (this._failures.length === 0) {
      console.log('PASS ' + name + ' (' + this._checks + ' checks' + notCoveredNote + ')');
      listNotCovered();
      cleanup();
      process.exit(0);
    }
    console.log('FAIL ' + name + ' — ' + this._failures.length + ' of ' + this._checks + ' checks failed' + notCoveredNote);
    for (const f of this._failures) {
      console.log('  ✗ ' + f.desc);
      if (f.detail) console.log('    ' + f.detail);
    }
    listNotCovered();
    cleanup();
    process.exit(1);
  },
};

function trunc(s: unknown, n?: number): string {
  const str = String(s);
  const limit = n || 400;
  return str.length > limit ? str.slice(0, limit) + '…' : str;
}

/** First differing line, with both sides — the useful part of a byte diff. */
function firstDiff(a: string, b: string): string {
  const al = a.split('\n'), bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return '     first diff at line ' + (i + 1) +
        '\n     expected: ' + JSON.stringify(bl[i] === undefined ? '<EOF>' : bl[i]) +
        '\n     actual:   ' + JSON.stringify(al[i] === undefined ? '<EOF>' : al[i]);
    }
  }
  return '     (files differ only in trailing bytes)';
}

/**
 * The oracle is built before the implementation, so "nj is absent" is the
 * expected state, not an error case. Abort loudly and cleanly on the first
 * attempt to drive it, rather than letting a later readFileSync fail with an
 * unrelated ENOENT — a stack trace about a missing task file says nothing
 * about the actual situation.
 */
function abortNoImplementation(missing: string): never {
  const name = path.basename(process.argv[1] || 'test');
  console.log('FAIL ' + name + ' — CANNOT RUN');
  console.log('  ' + missing);
  console.log('  This is the expected state before the implementation exists:' +
    ' the oracle is built first.');
  console.log('  The suite verifies the spec, not the code — there is nothing ' +
    'to check until `nanojira` runs.');
  cleanup();
  process.exit(1);
}

/**
 * Assert that a runnable `nj` was supplied. Call this at the top of any test
 * that spawns nj itself instead of going through runNj() — otherwise an unset
 * NJ reaches spawn() as the string "null" and the test dies with a confusing
 * spawn error instead of the clean CANNOT RUN the suite promises.
 */
function requireNj(): void {
  if (!NJ) abortNoImplementation('no nanojira path given (pass it as argv[2] or set NJ)');
  if (!fs.existsSync(NJ)) abortNoImplementation('nanojira not found at ' + NJ);
}

/**
 * Assert that a runnable `nanojira-mcp` was supplied (§ 17). `nanojira-mcp` is written
 * after `nj` itself, so this reports CANNOT RUN — not a failure — until it
 * exists, the same "the oracle is built first" discipline requireNj() has.
 */
function requireNjMcp(): void {
  if (!NJ_MCP) abortNoImplementation('no nanojira-mcp path given (set NJ_MCP, or NJ next to a sibling nanojira-mcp)');
  if (!fs.existsSync(NJ_MCP)) abortNoImplementation('nanojira-mcp not found at ' + NJ_MCP);
}

function cleanup(): void {
  if (process.env.NJ_KEEP === '1') return;
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

/* A test that crashes with an uncaught exception, or that a caller's own
 * timeout (test/run-all.ts's spawnSync, det-id-retry.ts's engaged() early
 * process.exit(1) abort) ends before T.finish() ever runs, still leaves
 * every freshDir() it created up to that point unless cleanup() also runs
 * from here — T.finish()'s own call is not reached in either case. Same
 * fix as D189 (tools/refactor-harness/scratch/lib/cleanup.ts): a
 * process-wide 'exit' handler, which node still runs after an uncaught
 * exception or an explicit process.exit() (both fire 'exit' before the
 * process truly dies), plus SIGTERM/SIGINT/SIGHUP handlers for the case a
 * caller's timeout kills the test outright — node's default disposition
 * for those three never fires 'exit' at all. Each signal handler cleans up,
 * drops itself, then re-raises the same signal against our own pid so the
 * parent still observes the test die BY that signal, exactly as it would
 * have with no handler installed. */
process.on('exit', cleanup);
for (const name of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  const handler = () => {
    cleanup();
    process.removeListener(name, handler);
    process.kill(process.pid, name);
  };
  process.on(name, handler);
}

export interface ShippedUnit {
  nj: string;
  njMcp: string;
  njModule: string;
  njMcpModule: string;
}

/**
 * Copies the actual shipped unit nanojira/nanojira-mcp are part of (§ 18) into destDir —
 * nothing more, nothing less — so a "no dependency outside what's shipped"
 * test means the same thing whichever shape is under test:
 *
 *   - a `bin/` launcher (no .mjs/.cjs/.js extension, e.g. `bin/nanojira`) ships
 *     together with the rest of its release tree, `SKILL.md` + `bin/` +
 *     `dist/` (its own relative sibling lookup depends on sitting next to
 *     `dist/`) — copied whole, via fs.cpSync, from the launcher's own
 *     grandparent directory (works the same for the repo root and for an
 *     exported skill folder, since both have this same three-entry shape).
 *   - a bare `dist/*.mjs` path ships alone next to its one sibling .mjs
 *     (§ 17's sibling lookup is same-directory only there) — copied as the
 *     two files, flat, as before.
 *
 * Returns the entry points a caller should spawn ({nj, njMcp}) and the
 * actual module files nanojira-mcp's sibling lookup cares about ({njModule,
 * njMcpModule}) — distinct from the entry points in bin/ mode — so a test
 * can delete just the "missing sibling" module without touching the
 * launcher itself.
 */
function copyShippedUnit(destDir: string): ShippedUnit {
  requireNj();
  requireNjMcp();
  const nj = NJ as string;
  const njMcp = NJ_MCP as string;
  if (isDirectExec(nj)) {
    const srcRoot = path.resolve(path.dirname(nj), '..');
    fs.copyFileSync(path.join(srcRoot, 'SKILL.md'), path.join(destDir, 'SKILL.md'));
    fs.cpSync(path.join(srcRoot, 'bin'), path.join(destDir, 'bin'), { recursive: true });
    fs.cpSync(path.join(srcRoot, 'dist'), path.join(destDir, 'dist'), { recursive: true });
    return {
      nj: path.join(destDir, 'bin', path.basename(nj)),
      njMcp: path.join(destDir, 'bin', path.basename(njMcp)),
      njModule: path.join(destDir, 'dist', 'nanojira.mjs'),
      njMcpModule: path.join(destDir, 'dist', 'nanojira-mcp.mjs'),
    };
  }
  const njDest = path.join(destDir, path.basename(nj));
  const njMcpDest = path.join(destDir, path.basename(njMcp));
  fs.copyFileSync(nj, njDest); fs.chmodSync(njDest, 0o755);
  fs.copyFileSync(njMcp, njMcpDest); fs.chmodSync(njMcpDest, 0o755);
  return { nj: njDest, njMcp: njMcpDest, njModule: njDest, njMcpModule: njMcpDest };
}

/**
 * The `NJ_FAULT=before-compare` rendezvous with a ready signal (§ 12,
 * DECISIONS 201). Pass `env` to the paused nj, then `await wait(done)`
 * before planting the parallel change: it resolves `true` once nj has
 * written NJ_FAULT_READY (its first read is done and it is holding),
 * `false` if `done` (the child's own exit promise) settles first or
 * `timeoutMs` passes. The ready file lives in its own fresh directory,
 * never inside the backlog, so a test's snapshot of the backlog tree is
 * unaffected. This replaces the old 1 s sleep, which a loaded machine
 * (run-all's parallel pool, DECISIONS 199) could outlast and then fail
 * the test for nothing.
 */
function faultReady(label?: string) {
  const file = path.join(freshDir((label || 'fault') + '-ready'), 'ready');
  return {
    file,
    env: { NJ_FAULT: 'before-compare', NJ_FAULT_READY: file } as Record<string, string>,
    async wait(done?: Promise<unknown>, timeoutMs = 30000): Promise<boolean> {
      let settled = false;
      if (done) done.then(() => { settled = true; }, () => { settled = true; });
      const deadline = Date.now() + timeoutMs;
      while (!fs.existsSync(file)) {
        if (settled || Date.now() >= deadline) return fs.existsSync(file);
        await new Promise((r) => setTimeout(r, 10));
      }
      return true;
    },
  };
}

export {
  NJ, NJ_MCP, NJ_BUNDLE, NODE, njCommand, FIXED_NOW, LATER_NOW, DEFAULT_CONFIG,
  CONFIG_REL, IDS_REL, INDEX_REL, GITIGNORE,
  TMP_ROOT,
  T,
  renderStatus, statusFor, writeStatus, configValidForStatus, tagsFor, writeTags,
  freshDir, mkBacklog, writeRaw, readInBacklog, existsInBacklog, listFiles, lsOrEmpty, readOrNull,
  requireNj, requireNjMcp,
  isDirectExec, copyShippedUnit,
  element, mkElement, completeBody, doneBody,
  doctorSet, summaryLine,
  sha256, golden, goldenPath,
  runNj, runPath, runJson, describeRun,
  runJson as fetchJson,
  faultReady,
};
