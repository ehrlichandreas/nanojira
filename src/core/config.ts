'use strict';

// Configuration and backlog discovery.

import type { Config, Flags, Layout } from './types.ts';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { flagString } from './args.ts';
import { DEFAULT_CONFIG, FOLDER_ROLES, GROUPS, SEVERITY, V3_DIR_REL, V3_CONFIG_REL, LEGACY_CONFIG_REL } from './constants.ts';
import { fail } from './output.ts';
import { sleepMs } from './store.ts';
import { readRegularFile, TEXT_FILE_CAP } from './regular-file.ts';
import { VERSION, parseVersionTuple, compareVersionTuples } from './version.ts';

// ------------------------------------------------------------ configuration

interface ConfigWarning { code: string; message: string }
interface ValidationResult { errors: string[]; warnings: ConfigWarning[] }

const TOP_LEVEL_KEYS = ['schema', 'statuses', 'sections', 'layout', 'claims', 'problems', 'minVersion', 'ids'];

function validateConfig(obj: any): ValidationResult {
  const errs: string[] = [];
  const warnings: ConfigWarning[] = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { errors: ['configuration must be a JSON object'], warnings: [] };
  }
  // An unrecognised top-level key is a warning, not an error (DECISIONS
  // 166 correcting 165/163 D's own premise): a 3.6-or-older nanojira silently
  // ignored it anyway, so this is only ever a visibility change, never a
  // behaviour change, for a binary new enough to apply this rule at all.
  for (const k of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.includes(k)) warnings.push({ code: 'config:unknown_key', message: `unknown top-level key '${k}'` });
  }
  if (obj.schema !== undefined && obj.schema !== 1) errs.push(`unsupported schema ${JSON.stringify(obj.schema)} (expected 1)`);
  const st = obj.statuses;
  if (!Array.isArray(st)) errs.push('statuses must be an array');
  else {
    if (st.length < 2) errs.push('statuses needs at least two entries');
    if (st.some((s) => typeof s !== 'string' || !/^[a-z_]+$/.test(s))) errs.push('every status must match [a-z_]+');
    if (new Set(st).size !== st.length) errs.push('statuses must be unique');
    if (st.length > 0 && st[st.length - 1] !== 'done') errs.push("the last status must be 'done'");
  }
  const sec = obj.sections;
  if (sec === null || typeof sec !== 'object' || Array.isArray(sec)) errs.push('sections must be an object');
  else {
    for (const role of ['description', 'acceptance']) {
      const list = sec[role];
      if (!Array.isArray(list) || list.length === 0 || list.some((n) => typeof n !== 'string' || n.trim() === '')) {
        errs.push(`sections.${role} must be a non-empty array of heading names`);
      }
    }
  }
  if (obj.layout !== undefined) {
    const r = validateLayout(obj.layout);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.claims !== undefined) {
    const r = validateClaims(obj.claims);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.problems !== undefined) {
    const r = validateProblems(obj.problems);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (obj.ids !== undefined) {
    const r = validateIds(obj.ids);
    errs.push(...r.errors);
    warnings.push(...r.warnings);
  }
  // minVersion's VALUE shape only, here -- the running-version COMPARISON
  // (and its own needs_newer_nj short-circuit) happens earlier, in
  // loadConfig, before this function is even called (§ 5 "minVersion",
  // DECISIONS 166: "checked before any other configuration validation").
  // Reached only when that comparison did not already short-circuit --
  // i.e. minVersion is absent, malformed, or already satisfied.
  if (obj.minVersion !== undefined && parseVersionTuple(typeof obj.minVersion === 'string' ? obj.minVersion : '') === null) {
    errs.push(`minVersion must be exactly three dot-separated non-negative integers (got ${JSON.stringify(obj.minVersion)})`);
  }
  return { errors: errs, warnings };
}

// § 5 `problems.ignore` (DECISIONS 165/166): only a warning-severity code
// (§ 7's own Doctor column) may be listed. A known error or `incomplete:*`
// code is misuse, not version skew, and stays `invalid_config`; a code
// outside § 7's closed vocabulary entirely is instead the warning
// `config:unknown_code` and is simply skipped (166 amends 165's original
// `invalid_config` for this one sub-case).
function validateProblems(p: any): ValidationResult {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return { errors: ['problems must be an object'], warnings: [] };
  const errs: string[] = [];
  const warnings: ConfigWarning[] = [];
  for (const k of Object.keys(p)) {
    if (k !== 'ignore') warnings.push({ code: 'config:unknown_key', message: `unknown key 'problems.${k}'` });
  }
  if (p.ignore !== undefined) {
    if (!Array.isArray(p.ignore) || p.ignore.some((c: any) => typeof c !== 'string')) {
      errs.push('problems.ignore must be an array of strings');
    } else {
      for (const code of p.ignore) {
        const sev = SEVERITY[code];
        if (sev === undefined) warnings.push({ code: 'config:unknown_code', message: `unknown code '${code}' in problems.ignore` });
        else if (sev !== 'warning') errs.push(`problems.ignore: '${code}' is not a warning-severity code and cannot be ignored`);
      }
    }
  }
  return { errors: errs, warnings };
}

// Only a code that is BOTH recognised and warning-severity ever suppresses
// anything -- an unknown one was already warned about and skipped above;
// a known non-warning one would already have made the config invalid, so
// readProblems is never reached in that case.
function readProblems(p: any): { ignore: string[] } {
  if (!p || !Array.isArray(p.ignore)) return { ignore: [] };
  return { ignore: p.ignore.filter((c: string) => SEVERITY[c] === 'warning') };
}

// § 5: an optional top-level `claims` block, not written by `init`. An
// unknown key inside it is now a warning (DECISIONS 166), the same
// typo-safety `layout`/`layout.folders` have, just no longer fatal.
function validateClaims(c: any): ValidationResult {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return { errors: ['claims must be an object'], warnings: [] };
  const errs: string[] = [];
  const warnings: ConfigWarning[] = [];
  for (const k of Object.keys(c)) {
    if (k !== 'staleAfterHours') warnings.push({ code: 'config:unknown_key', message: `unknown key 'claims.${k}'` });
  }
  if (c.staleAfterHours !== undefined) {
    const v = c.staleAfterHours;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errs.push(`claims.staleAfterHours must be a non-negative integer (got ${JSON.stringify(v)})`);
    }
  }
  return { errors: errs, warnings };
}

function readClaims(c: any): { staleAfterHours: number } {
  const d = DEFAULT_CONFIG.claims.staleAfterHours;
  return { staleAfterHours: c && c.staleAfterHours !== undefined ? c.staleAfterHours : d };
}

// § 5 `ids`: an optional top-level block, not written by `init`. `shardSize`
// undefined or `0` both mean today's flat `ids/<TYPE>-<n>` layout -- `0` is
// "off", the same reading `layout.statusFile`/`claims.staleAfterHours: 0`
// already get, never a literal divisor (that would be `Infinity`/`NaN`).
function validateIds(c: any): ValidationResult {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return { errors: ['ids must be an object'], warnings: [] };
  const errs: string[] = [];
  const warnings: ConfigWarning[] = [];
  for (const k of Object.keys(c)) {
    if (k !== 'shardSize') warnings.push({ code: 'config:unknown_key', message: `unknown key 'ids.${k}'` });
  }
  if (c.shardSize !== undefined) {
    const v = c.shardSize;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errs.push(`ids.shardSize must be a non-negative integer (got ${JSON.stringify(v)})`);
    }
  }
  return { errors: errs, warnings };
}

function readIds(c: any): { shardSize: number } {
  const d = DEFAULT_CONFIG.ids.shardSize;
  return { shardSize: c && c.shardSize !== undefined ? c.shardSize : d };
}

// § 5: every part of `layout` is optional, but what is there must be right.
// An unknown key inside it is now a warning (DECISIONS 166) rather than
// fatal -- a typo stays visible without stopping work.
function validateLayout(lay: any): ValidationResult {
  if (lay === null || typeof lay !== 'object' || Array.isArray(lay)) return { errors: ['layout must be an object'], warnings: [] };
  const errs: string[] = [];
  const warnings: ConfigWarning[] = [];
  for (const k of Object.keys(lay)) {
    if (!['group', 'folders', 'statusFile', 'tagsFile'].includes(k)) warnings.push({ code: 'config:unknown_key', message: `unknown key 'layout.${k}'` });
  }
  if (lay.group !== undefined && !GROUPS.includes(lay.group)) {
    errs.push(`layout.group must be one of ${GROUPS.join(', ')} (got ${JSON.stringify(lay.group)})`);
  }
  if (lay.statusFile !== undefined && typeof lay.statusFile !== 'boolean') errs.push('layout.statusFile must be true or false');
  if (lay.tagsFile !== undefined && typeof lay.tagsFile !== 'boolean') errs.push('layout.tagsFile must be true or false');
  const f = lay.folders;
  if (f === undefined) return { errors: errs, warnings };
  if (f === null || typeof f !== 'object' || Array.isArray(f)) { errs.push('layout.folders must be an object'); return { errors: errs, warnings }; }
  for (const k of Object.keys(f)) {
    if (!(FOLDER_ROLES as string[]).includes(k)) warnings.push({ code: 'config:unknown_key', message: `unknown key 'layout.folders.${k}'` });
  }
  // Compared case-insensitively: APFS and NTFS are, by default (DECISIONS 91).
  const names: string[] = [];
  for (const role of FOLDER_ROLES) {
    const name = f[role] === undefined ? DEFAULT_CONFIG.layout.folders[role] : f[role];
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      errs.push(`layout.folders.${role} must be a folder name matching [A-Za-z0-9][A-Za-z0-9_-]* (got ${JSON.stringify(name)})`);
      continue;
    }
    // Those are the folder names of group `hierarchy` (§ 4).
    if (/^(EPIC|TSK|SUB)-\d+$/i.test(name)) errs.push(`layout.folders.${role} '${name}' has the form of an element ID`);
    // A `backlog/` inside the backlog would capture discovery from within it.
    if (name.toLowerCase() === 'backlog') errs.push(`layout.folders.${role} must not be named '${name}'`);
    if (names.includes(name.toLowerCase())) errs.push(`layout.folders: '${name}' is used twice — folder names must be distinct`);
    names.push(name.toLowerCase());
  }
  return { errors: errs, warnings };
}

function readLayout(lay: any): Layout {
  const d = DEFAULT_CONFIG.layout;
  if (lay === undefined) return { group: d.group, folders: { ...d.folders }, statusFile: d.statusFile, tagsFile: d.tagsFile };
  return {
    group: lay.group === undefined ? d.group : lay.group,
    folders: { ...d.folders, ...(lay.folders || {}) },
    statusFile: lay.statusFile === undefined ? d.statusFile : lay.statusFile,
    tagsFile: lay.tagsFile === undefined ? d.tagsFile : lay.tagsFile,
  };
}

// `legacy` picks the v2 top-level file instead of the v3 one — `doctor` is
// the one caller that ever passes `true` (§ 14: "doctor reads the v2
// places"); step 0 is the only thing that moves a backlog off it.
function loadConfig(backlog: string, legacy?: boolean) {
  const rel = legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL;
  const file = path.join(backlog, rel);
  let raw;
  try {
    raw = readRegularFile(file, TEXT_FILE_CAP);
  } catch (e: any) {
    // A FIFO, a device or an oversized file is never read (DECISIONS 215);
    // anything but a plain absence says what it is.
    const why = e && e.code === 'ENOENT' ? 'is missing' : `cannot be read — ${e && e.message ? e.message : String(e)}`;
    return { config: DEFAULT_CONFIG, errors: [`${rel} ${why}`], warnings: [], needsNewerNj: null };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e: any) {
    return { config: DEFAULT_CONFIG, errors: [`${rel} is not valid JSON: ${e.message}`], warnings: [], needsNewerNj: null };
  }
  // minVersion (§ 5, DECISIONS 166): checked before any other validation --
  // a well-formed, unmet requirement short-circuits straight to
  // needs_newer_nj, never a confusing report about fields this binary may
  // not even recognise. A malformed minVersion, or one already satisfied,
  // falls through to the normal validation below (where a malformed one is
  // reported as any other bad value is, § 5 "minVersion").
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.minVersion === 'string') {
    const required = parseVersionTuple(obj.minVersion);
    if (required !== null && compareVersionTuples(parseVersionTuple(VERSION) as [number, number, number], required) < 0) {
      return { config: DEFAULT_CONFIG, errors: [], warnings: [], needsNewerNj: { running: VERSION, required: obj.minVersion } };
    }
  }
  const { errors, warnings } = validateConfig(obj);
  if (errors.length > 0) return { config: DEFAULT_CONFIG, errors, warnings, needsNewerNj: null };
  return {
    config: {
      schema: 1, statuses: obj.statuses.slice(),
      sections: { description: obj.sections.description.slice(), acceptance: obj.sections.acceptance.slice() },
      layout: readLayout(obj.layout),
      claims: readClaims(obj.claims),
      problems: readProblems(obj.problems),
      ids: readIds(obj.ids),
    },
    errors: [],
    warnings,
    needsNewerNj: null,
  };
}

// ----------------------------------------------------------------- discover

// Where the backlog comes from (§ 4, Backlog location). The first source that
// is set is binding: when it holds no backlog the command fails naming that
// source, and never falls through to a lower one.
type Source = { kind: 'flag' } | { kind: 'env' } | { kind: 'njrc'; file: string };

const SOURCE_CODE = { flag: 'invalid_backlog_flag', env: 'invalid_backlog_env', njrc: 'invalid_backlog_njrc' } as const;

function sourceName(src: Source) {
  return src.kind === 'flag' ? '--backlog' : src.kind === 'env' ? 'NJ_BACKLOG' : src.file;
}

// "Holds a backlog" (§ 4): the v3 configuration, OR — unmigrated — the v2
// one; a legacy backlog is found, not refused by location, and refused
// later as `legacy_layout` instead (AMBIGUITIES 71). `doctor` alone reaches
// a legacy one with `lenient`, where neither file needs to exist at all.
function holdsBacklog(dir: string): boolean {
  return fs.existsSync(path.join(dir, V3_CONFIG_REL)) || fs.existsSync(path.join(dir, LEGACY_CONFIG_REL));
}

// `lenient` (doctor) accepts any existing directory, so a missing config can
// be reported instead of refused. `dir` is shown escaped for an `.njrc`
// source: it can carry bytes straight out of the file's parsed value
// (TSK-029 T3), and a raw invisible character in the message would hide the
// very thing that made the value wrong.
function claim(dir: string, src: Source, lenient: boolean): string {
  const shown = src.kind === 'njrc' ? escapeInvisible(dir) : dir;
  if (!isDir(dir)) fail(SOURCE_CODE[src.kind], `no backlog at ${shown} (from ${sourceName(src)})`);
  if (lenient || holdsBacklog(dir)) return dir;
  // "A folder with `.nanojira/` but without `config.json`… is
  // `backlog_without_config`" (§ 4) — unconditionally, not only when the
  // search finds it: the directory IS there, only its configuration is
  // missing, which is a different failure from "nothing at this path" and
  // must say so regardless of which source named it.
  if (fs.existsSync(path.join(dir, V3_DIR_REL))) {
    fail('backlog_without_config', `${shown} exists but has no ${V3_CONFIG_REL}`,
      'run `nanojira doctor` — it tolerates the missing file and reports config:invalid');
  }
  fail(SOURCE_CODE[src.kind], `no backlog at ${shown} (from ${sourceName(src)})`,
    `the directory has no ${V3_CONFIG_REL} — check the path, or run \`nanojira init\` with the same source to create a backlog there`);
}

// Any character outside printable ASCII (space through ~) becomes a \uXXXX
// escape — NBSP, a lone \v/\f, U+2028, a BOM mid-value — so a message never
// shows an invisible character as though it were absent (TSK-029 T3). Applied
// only to text taken from untrusted input (an `.njrc` key, value or the path
// derived from one), never to nanojira's own static prose.
function escapeInvisible(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// The sources before the upward search: --backlog, then NJ_BACKLOG. Both
// resolve against the working directory; `init` shares this with findBacklog.
function explicitLocation(flags: Flags): { dir: string; src: Source } | null {
  const flag = flagString(flags, 'backlog');
  if (flag !== undefined) {
    if (flag === '') fail('invalid_value', '--backlog must not be empty', 'give a value, or leave --backlog out');
    return { dir: fromCwd(flag), src: { kind: 'flag' } };
  }
  const env = process.env.NJ_BACKLOG;
  if (env !== undefined && env !== '') return { dir: fromCwd(env), src: { kind: 'env' } };
  return null;
}

// The `.njrc` in `dir`, if there is one and it sets `backlog`: the value,
// `~/` expanded and resolved against `dir`. Any format violation is fatal —
// a `.njrc` the search reaches is always parsed in full.
// A symlinked `.njrc` is read through the link, but a relative value still
// resolves against the directory the link lies in — where the search found it.
function njrcLocation(dir: string): { dir: string; src: Source } | null {
  const file = path.join(dir, '.njrc');
  const raw = readNjrc(file);
  if (raw === null) return null;
  const value = parseNjrc(file, raw).get('backlog');
  if (value === undefined) return null;
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  return { dir: path.resolve(dir, expanded), src: { kind: 'njrc', file } };
}

// null when there is no `.njrc` at all. Anything else that is not a readable
// regular file — a directory, a dangling symlink, a FIFO, no read permission —
// is a `.njrc` the search reached and could not use: fatal, not "absent" (§ 4).
//
// Ownership comes first, before a single byte is read: a `.njrc` planted in a
// shared ancestor (`/tmp`) must not steer another user's `nanojira`, so one owned
// by anybody but the current user or root is refused — for a symlink, the
// link and its target both (§ 4, DECISIONS 93 F1, 98).
// Checked and read through ONE file descriptor (TSK-029 T1): `lstat` for the
// link's own owner, then `open(O_RDONLY|O_NONBLOCK)`, `fstat` on that same fd
// for the target's owner and `isFile()`, then the read -- also from that fd.
// Three separate by-path lookups (lstat, stat, readFileSync-by-path) left a
// window in which the file on disk could be swapped between the ownership
// check and the read: demonstrated, a decoy that passes the check, then the
// real payload underneath it. `O_NONBLOCK` also makes a FIFO fail the open
// outright instead of blocking forever, the same hazard D96 found for a path
// opened without it.
function readNjrc(file: string): string | null {
  let link;
  try { link = fs.lstatSync(file); } catch (e: any) { return searchMiss(e, path.dirname(file)); }
  const bad = (reason: string, hint?: string): never => fail('invalid_njrc', `invalid .njrc at ${file}: ${reason}`, hint);
  checkOwner(link.uid, bad);
  njrcSwapFaultHook(path.dirname(file));
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (e: any) {
    if (e.code === 'ELOOP') return bad('it is a symlink loop (ELOOP)');
    // Judged by a FRESH lstat, not the one above (D142): the njrc-swap pause
    // can remove or replace the path between that lstat and this open(), so
    // the original's isSymbolicLink() no longer describes what's there now.
    // Nothing there now -- whether it was a regular file or a symlink --
    // means the entry was removed outright: absent at this level, the
    // search (§ 4) continues upward exactly as if nothing had been here. A
    // symlink still there, with its target missing, is a genuine dangling
    // link and stays a fault.
    if (e.code === 'ENOENT') {
      let fresh;
      try { fresh = fs.lstatSync(file); } catch { return null; }
      return fresh.isSymbolicLink() ? bad('it is a dangling symlink') : null;
    }
    return bad(`cannot open it -- ${e.code || e.message}`);
  }
  try {
    // `checkOwner`'s own `fail()` must reach the caller unmasked \u2014 it is not
    // a filesystem error, so it stays outside the try below, which exists
    // only to turn a REAL fstat/read failure into `invalid_njrc` too.
    let st;
    try {
      st = fs.fstatSync(fd);
    } catch (e: any) {
      return bad(`cannot stat it -- ${e.code || e.message}`);
    }
    // Unconditional, not only for a symlink (Verifier, v3-2-followup.md T1):
    // the bytes read always come from THIS fd, so the ownership that matters
    // is always fstat(fd).uid — for a plain file that is the same uid lstat
    // already saw, a cheap re-check; for a symlink it is the target's. Gating
    // this on `isSymbolicLink()` left the by-path `lstat` immediately before
    // `open()` as the plain file's ONLY check, and a file swapped into that
    // path between the two syscalls raced straight through it — reproduced
    // twice independently. `checkOwner(link.uid, bad)` above stays too, as a
    // cheap early rejection; it must never be the only one.
    checkOwner(st.uid, bad);
    if (!st.isFile()) return bad(st.isDirectory() ? 'it is a directory, not a file' : 'it is not a regular file');
    let raw;
    try {
      raw = fs.readFileSync(fd, 'utf8');
    } catch (e: any) {
      return bad(`cannot read it -- ${e.code || e.message}`);
    }
    // A BOM counts only at the very start; anywhere else it is an ordinary character.
    return raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * NJ_FAULT=njrc-swap (verification hook, § 4): a pure pause between the
 * ownership `lstat` and the `open()` -- the exact window TSK-029's residual
 * race lived in. Polls for `<dir>/.nj-fault-go` (timeout 10s, the same
 * marker filename `before-compare` uses, § 12). Released by the marker or
 * by the timeout, `nanojira` always proceeds to `open()` next -- there is no
 * `fault:njrc-swap` code, so this never fails or throws.
 */
function njrcSwapFaultHook(dir: string) {
  if (process.env.NJ_FAULT !== 'njrc-swap') return;
  const marker = path.join(dir, '.nj-fault-go');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(marker)) {
    if (Date.now() >= deadline) return;
    sleepMs(50);
  }
}

function checkOwner(uid: number, bad: (reason: string, hint?: string) => never) {
  // Ownership is POSIX; where there are no uids there is nothing to check.
  if (typeof process.getuid !== 'function') return;
  if (uid !== process.getuid() && uid !== 0) {
    bad(`owned by uid ${uid}, not by you`, 'use --backlog=<path> or NJ_BACKLOG, or change the owner');
  }
}

const NJRC_KEYS = ['backlog'];

// Spaces and tabs only: String.prototype.trim would also eat a BOM, which
// counts as whitespace nowhere but at the very start of the file (§ 4).
function trimBlank(s: string) {
  return s.replace(/^[ \t]+|[ \t]+$/g, '');
}

function parseNjrc(file: string, raw: string): Map<string, string> {
  const values: Map<string, string> = new Map();
  const bad = (n: number, reason: string): never =>
    fail('invalid_njrc', `invalid .njrc at ${file}: line ${n}: ${reason}`,
      `one \`key = value\` per line, a line starting with \`#\` is a comment; known keys: ${NJRC_KEYS.join(', ')}`);
  const lines = raw.split('\n');
  lines.forEach((full, i) => {
    // A `\r` counts as line-end whitespace only right before a `\n`; a lone
    // one would let a classic-Mac file read as a single comment line and
    // silently set nothing (§ 4, DECISIONS 96, 98).
    const line = i < lines.length - 1 && full.endsWith('\r') ? full.slice(0, -1) : full;
    if (line.includes('\r')) bad(i + 1, 'a carriage return (\\r) not followed by a line feed');
    const t = trimBlank(line);
    if (t === '' || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq === -1) bad(i + 1, `no '=' in '${escapeInvisible(t)}'`);
    const key = trimBlank(t.slice(0, eq));
    const value = trimBlank(t.slice(eq + 1));
    if (!NJRC_KEYS.includes(key)) bad(i + 1, `unknown key '${escapeInvisible(key)}'`);
    if (value === '') bad(i + 1, `empty value for '${escapeInvisible(key)}'`);
    if (values.has(key)) bad(i + 1, `repeated key '${escapeInvisible(key)}'`);
    values.set(key, value);
  });
  return values;
}

// `init` takes its target from the same sources, except that the upward
// search looks only for a `.njrc` — an existing `backlog/` is never a target
// for `init` — and ends at `./backlog` (§ 4, `nanojira init`).
function initLocation(flags: Flags): string {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return explicit.dir;
  for (let dir = workingDir(); ; dir = path.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return rc.dir;
    if (path.dirname(dir) === dir) break;
  }
  return path.join(workingDir(), 'backlog');
}

/**
 * The working directory, or `io_error` when the OS cannot give it — deleted,
 * or below an ancestor the user may not search (DECISIONS 93 F4, 96). Every
 * relative path goes through this, never through Node's own implicit cwd,
 * whose failure would surface as a stack trace.
 */
function workingDir(): string {
  try {
    return process.cwd();
  } catch (e: any) {
    return fail('io_error', `cannot determine the working directory: ${oneLine(e)}`);
  }
}

function fromCwd(p: string) {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(workingDir(), p);
}

/** An OS error as one line: its code and message, never its stack. */
function oneLine(e: any): string {
  const msg = e && e.message ? String(e.message) : String(e);
  return msg.split('\n')[0];
}

function findBacklog(flags: Flags, lenient: boolean): string {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return claim(explicit.dir, explicit.src, lenient);
  // Nearest directory wins; within one directory `.njrc` beats `backlog/`.
  for (let dir = workingDir(); ; dir = path.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return claim(rc.dir, rc.src, lenient);
    const candidate = path.join(dir, 'backlog');
    if (searchIsDir(candidate)) {
      if (lenient || holdsBacklog(candidate)) return candidate;
      // A backlog folder without its config is a different failure from "none
      // at all" and must say so rather than send the caller hunting (§ 4).
      fail('backlog_without_config', `${candidate} exists but has no ${V3_CONFIG_REL}`,
        'run `nanojira doctor` — it tolerates the missing file and reports config:invalid');
    }
    if (path.dirname(dir) === dir) break;
  }
  return fail('no_backlog', `no backlog found (looked for backlog/${V3_CONFIG_REL} upward from the working directory)`,
    'run `nanojira init` to create one, or set NJ_BACKLOG');
}

function isDir(p: string) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// The upward search (§ 4 "Backlog location", DECISIONS 204): a probe that
// finds nothing there — ENOENT, or ENOTDIR — means "not here, keep
// walking". Any other error (EACCES/EPERM from an unsearchable ancestor, a
// `backlog` symlink loop, an I/O error) means the search could not look,
// and is `io_error`, one line naming the directory and the OS reason:
// reporting `no_backlog` instead would claim an answer the search never
// got, and walking on past it could find a different, wrong backlog above.
function searchMiss(e: any, dir: string): null {
  if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
  return fail('io_error', `cannot search ${dir} for a backlog: ${oneLine(e)}`);
}

function searchIsDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch (e: any) { return searchMiss(e, path.dirname(p)) ?? false; }
}

// The legacy signal: the v2 configuration at the backlog's top level. §4:
// "A folder with the legacy `.nanojira.json` at its top level is
// `legacy_layout`" — unconditionally, regardless of whether `.nanojira/`
// also exists (an ambiguous step 0 is still a legacy backlog, DECISIONS 95 B21).
function isLegacyBacklog(backlog: string): boolean {
  return fs.existsSync(path.join(backlog, LEGACY_CONFIG_REL));
}

export { loadConfig, findBacklog, initLocation, workingDir, oneLine, holdsBacklog, isLegacyBacklog };
