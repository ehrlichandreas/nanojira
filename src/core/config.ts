'use strict';

// Configuration and backlog discovery.

import type { Config, Flags } from './types.ts';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { flagString } from './args.ts';
import { DEFAULT_CONFIG } from './constants.ts';
import { fail } from './output.ts';

// ------------------------------------------------------------ configuration

function validateConfig(obj: any) {
  const errs = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return ['configuration must be a JSON object'];
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
  return errs;
}

function loadConfig(backlog: string) {
  const file = path.join(backlog, '.nanojira.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { config: DEFAULT_CONFIG, errors: [`.nanojira.json is missing`] };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e: any) {
    return { config: DEFAULT_CONFIG, errors: [`.nanojira.json is not valid JSON: ${e.message}`] };
  }
  const errors = validateConfig(obj);
  if (errors.length > 0) return { config: DEFAULT_CONFIG, errors };
  return {
    config: { schema: 1, statuses: obj.statuses.slice(), sections: { description: obj.sections.description.slice(), acceptance: obj.sections.acceptance.slice() } },
    errors: [],
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

// `lenient` (doctor) accepts any existing directory, so a missing config can
// be reported instead of refused.
function claim(dir: string, src: Source, lenient: boolean): string {
  if (!isDir(dir)) fail(SOURCE_CODE[src.kind], `no backlog at ${dir} (from ${sourceName(src)})`);
  if (!lenient && !fs.existsSync(path.join(dir, '.nanojira.json'))) {
    fail(SOURCE_CODE[src.kind], `no backlog at ${dir} (from ${sourceName(src)})`,
      'the directory has no .nanojira.json — check the path, or run `nj init` with the same source to create a backlog there');
  }
  return dir;
}

// The sources before the upward search: --backlog, then NJ_BACKLOG. Both
// resolve against the working directory; `init` shares this with findBacklog.
function explicitLocation(flags: Flags): { dir: string; src: Source } | null {
  const flag = flagString(flags, 'backlog');
  if (flag !== undefined) {
    if (flag === '') fail('missing_value', '--backlog needs a value (use --backlog=…)');
    return { dir: path.resolve(flag), src: { kind: 'flag' } };
  }
  const env = process.env.NJ_BACKLOG;
  if (env !== undefined && env !== '') return { dir: path.resolve(env), src: { kind: 'env' } };
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
function readNjrc(file: string): string | null {
  try { fs.lstatSync(file); } catch { return null; }
  const bad = (reason: string): never => fail('invalid_njrc', `invalid .njrc at ${file}: ${reason}`);
  let st;
  try { st = fs.statSync(file); } catch { return bad('it is a dangling symlink'); }
  if (!st.isFile()) return bad(st.isDirectory() ? 'it is a directory, not a file' : 'it is not a regular file');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e: any) { return bad(`cannot read it — ${e.code || e.message}`); }
  return raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
}

const NJRC_KEYS = ['backlog'];

function parseNjrc(file: string, raw: string): Map<string, string> {
  const values: Map<string, string> = new Map();
  const bad = (n: number, reason: string): never =>
    fail('invalid_njrc', `invalid .njrc at ${file}: line ${n}: ${reason}`,
      `one \`key = value\` per line, a line starting with \`#\` is a comment; known keys: ${NJRC_KEYS.join(', ')}`);
  raw.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq === -1) bad(i + 1, `no '=' in '${t}'`);
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (!NJRC_KEYS.includes(key)) bad(i + 1, `unknown key '${key}'`);
    if (value === '') bad(i + 1, `empty value for '${key}'`);
    if (values.has(key)) bad(i + 1, `repeated key '${key}'`);
    values.set(key, value);
  });
  return values;
}

// `init` takes its target from the same sources, except that the upward
// search looks only for a `.njrc` — an existing `backlog/` is never a target
// for `init` — and ends at `./backlog` (§ 4, `nj init`).
function initLocation(flags: Flags): string {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return explicit.dir;
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return rc.dir;
    if (path.dirname(dir) === dir) break;
  }
  return path.resolve(process.cwd(), 'backlog');
}

function findBacklog(flags: Flags, lenient: boolean): string {
  const explicit = explicitLocation(flags);
  if (explicit !== null) return claim(explicit.dir, explicit.src, lenient);
  // Nearest directory wins; within one directory `.njrc` beats `backlog/`.
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const rc = njrcLocation(dir);
    if (rc !== null) return claim(rc.dir, rc.src, lenient);
    const candidate = path.join(dir, 'backlog');
    if (isDir(candidate)) {
      if (lenient || fs.existsSync(path.join(candidate, '.nanojira.json'))) return candidate;
      // A backlog folder without its config is a different failure from "none
      // at all" and must say so rather than send the caller hunting (§ 4).
      fail('backlog_without_config', `${candidate} exists but has no .nanojira.json`,
        'run `nj doctor` — it tolerates the missing file and reports config:invalid');
    }
    if (path.dirname(dir) === dir) break;
  }
  return fail('no_backlog', 'no backlog found (looked for backlog/.nanojira.json upward from the working directory)',
    'run `nj init` to create one, or set NJ_BACKLOG');
}

function isDir(p: string) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listMd(dir: string) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n: string) => n.endsWith('.md')).sort().map((n: string) => path.join(dir, n));
}

export { loadConfig, findBacklog, initLocation, listMd };
