'use strict';

// `--dry-run` on every write command (§ 9 "`--dry-run`", DECISIONS 197).
//
// The whole call runs unchanged against a scratch copy of the backlog in the
// OS temp directory. The real backlog is only ever read: `context()` and
// `init` hand every command the copy's path instead of the real one, so no
// writer anywhere needs to know a dry run is happening, and a writer added
// later cannot forget a switch it never had to check. Afterwards the copy is
// compared with the real backlog. The difference is the `changes` list, and
// the copy is removed. stdout is held back until then: the command's own
// result goes out once, with the copy's path mapped back to the real one and
// `dry_run`/`changes` appended (JSON) or a summary appended (prose).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fail, output } from './output.ts';

type Kind = 'file' | 'dir' | 'symlink';

interface Change {
  path: string;
  kind: Kind;
  op: 'create' | 'modify' | 'delete';
  before: string | null;
  after: string | null;
}

/** One path in a snapshot. `content` is a file's text, or a symlink's target;
 * `null` for a directory, or for a file that cannot be read. */
interface Node { kind: Kind; content: string | null }

const state = {
  armed: false,
  finished: false,
  real: null as string | null,
  sandbox: null as string | null,
  scratch: null as string | null,
  /** Backlog-relative path → the target a symlink was given in the copy. */
  links: new Map<string, string>(),
  stdout: [] as string[],
  writeOut: null as ((s: string) => void) | null,
};

function isDryRun(): boolean { return state.armed; }

/**
 * Starts a dry run: holds stdout back and maps the copy's path back to the
 * real one on stderr. Called by `checkFlags` once `--dry-run` has passed
 * as an allowed flag, before the command does anything else.
 */
function armDryRun() {
  if (state.armed) return;
  state.armed = true;
  const stdout = process.stdout;
  const stderr = process.stderr;
  const origOut = stdout.write.bind(stdout);
  const origErr = stderr.write.bind(stderr);
  state.writeOut = (s: string) => { origOut(s); };
  const text = (chunk: unknown) => (typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
  stdout.write = ((chunk: unknown) => { state.stdout.push(text(chunk)); return true; }) as typeof stdout.write;
  stderr.write = ((chunk: unknown) => origErr(toReal(text(chunk)))) as typeof stderr.write;
  // `hardExit` ends the process directly; this still owes it the result.
  process.on('exit', finishDryRun);
}

/** The path the real call would use, with the copy's path mapped back. */
function toReal(s: string): string {
  if (state.sandbox === null || state.real === null) return s;
  return s.split(state.sandbox).join(state.real);
}

function deepToReal(v: unknown): unknown {
  if (typeof v === 'string') return toReal(v);
  if (Array.isArray(v)) return v.map(deepToReal);
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepToReal(x);
    return o;
  }
  return v;
}

function isInside(p: string, root: string): string | null {
  if (p === root) return '';
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return p.startsWith(prefix) ? p.slice(prefix.length) : null;
}

function realpathLoose(p: string): string {
  try { return fs.realpathSync.native(p); } catch { /* missing or dangling */ }
  try { return path.join(fs.realpathSync.native(path.dirname(p)), path.basename(p)); } catch { return path.resolve(p); }
}

/**
 * A caller-supplied path (`--file=`) that names something inside the real
 * backlog, mapped to the same place inside the copy. Anything else is
 * returned unchanged.
 */
function intoSandbox(p: string): string {
  if (state.sandbox === null || state.real === null) return p;
  let rel = isInside(path.resolve(p), path.resolve(state.real));
  if (rel === null) rel = isInside(realpathLoose(p), realpathLoose(state.real));
  if (rel === null) return p;
  return rel === '' ? state.sandbox : path.join(state.sandbox, rel);
}

// ------------------------------------------------------------------- copy

function copyTimes(dst: string, st: fs.Stats) {
  fs.utimesSync(dst, st.atimeMs / 1000, st.mtimeMs / 1000);
}

function copyEntry(src: string, dst: string, rel: string, root: string) {
  let st: fs.Stats;
  try { st = fs.lstatSync(src); } catch { return; } // vanished meanwhile
  if (st.isDirectory()) return copyDir(src, dst, rel, root, st);
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(src);
    // A relative link that leaves the backlog would dangle in the copy;
    // pointing it at the same place absolutely keeps it readable. Writes
    // never go through a link: every element write is a rename onto it.
    const outside = !path.isAbsolute(target) && isInside(path.resolve(path.dirname(src), target), root) === null;
    const written = outside ? path.resolve(path.dirname(src), target) : target;
    fs.symlinkSync(written, dst);
    state.links.set(rel, written);
    return;
  }
  if (!st.isFile()) return; // a FIFO, socket or device is never a backlog file
  try {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  } catch {
    // Unreadable: an empty stand-in with the same mode reads as unreadable
    // too, so the dry run reports the same stub the real call would.
    fs.writeFileSync(dst, '');
  }
  fs.chmodSync(dst, st.mode & 0o7777);
  copyTimes(dst, st);
}

function copyDir(src: string, dst: string, rel: string, root: string, st: fs.Stats) {
  fs.mkdirSync(dst);
  let names: string[] | null;
  try { names = fs.readdirSync(src); } catch { names = null; } // unreadable: copied empty, same mode
  for (const n of names || []) copyEntry(path.join(src, n), path.join(dst, n), rel === '' ? n : rel + '/' + n, root);
  fs.chmodSync(dst, st.mode & 0o7777);
  copyTimes(dst, st);
}

/**
 * The backlog path the command works on: the real one, or during a dry run
 * a scratch copy of it (created on first use, the same copy for every later
 * call in this process — `doctor --fix` reloads its context several times).
 * A `real` that does not exist yet (`init`) gets a copy path that does not
 * exist either.
 */
function sandboxFor(real: string): string {
  if (!state.armed) return real;
  if (state.sandbox !== null) {
    if (real === state.real) return state.sandbox;
    throw new Error(`dry run: a second backlog '${real}' in one call (already copied '${state.real}')`);
  }
  const tmp = os.tmpdir();
  try {
    const scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(tmp), 'nj-dry-run-'));
    state.scratch = scratch;
    state.real = real;
    state.sandbox = path.join(scratch, path.basename(real) || 'backlog');
    let st: fs.Stats | null;
    try { st = fs.statSync(real); } catch { st = null; }
    if (st !== null && st.isDirectory()) copyDir(real, state.sandbox, '', path.resolve(real), st);
  } catch (e: any) {
    removeScratch();
    state.real = null;
    state.sandbox = null;
    const reason = e && e.message ? String(e.message).split('\n')[0] : String(e);
    return fail('io_error', `cannot make the dry run's scratch copy in ${tmp}: ${reason}`, 'set TMPDIR to a writable directory with room for a copy of the backlog');
  }
  return state.sandbox;
}

function removeScratch() {
  if (state.scratch === null) return;
  const scratch = state.scratch;
  state.scratch = null;
  try { fs.rmSync(scratch, { recursive: true, force: true }); return; } catch { /* a mode-000 directory inside */ }
  const open = (d: string) => {
    try { fs.chmodSync(d, 0o700); } catch { return; }
    let names: string[];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      try { if (fs.lstatSync(p).isDirectory()) open(p); } catch { /* gone */ }
    }
  };
  open(scratch);
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e: any) {
    process.stderr.write(`Warning: dry run scratch copy not removed: ${scratch} (${e && e.message ? e.message : e})\n`);
  }
}

// ------------------------------------------------------------------- diff

function snapshot(root: string | null): Map<string, Node> {
  const out: Map<string, Node> = new Map();
  if (root === null) return out;
  let st: fs.Stats;
  try { st = fs.statSync(root); } catch { return out; }
  if (!st.isDirectory()) return out;
  out.set('.', { kind: 'dir', content: null });
  const walk = (dir: string, rel: string) => {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n);
      const r = rel === '' ? n : rel + '/' + n;
      let s: fs.Stats;
      try { s = fs.lstatSync(p); } catch { continue; }
      if (s.isDirectory()) { out.set(r, { kind: 'dir', content: null }); walk(p, r); }
      else if (s.isSymbolicLink()) out.set(r, { kind: 'symlink', content: fs.readlinkSync(p) });
      else if (s.isFile()) {
        let c: string | null;
        try { c = fs.readFileSync(p, 'utf8'); } catch { c = null; }
        out.set(r, { kind: 'file', content: c });
      }
    }
  };
  walk(root, '');
  return out;
}

/** Every path whose existence, kind or content differs between the real
 * backlog and its copy, sorted by path; a path that changed kind is a
 * `delete` followed by a `create`. */
function diffTrees(): Change[] {
  const before = snapshot(state.real);
  const after = snapshot(state.sandbox);
  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const changes: Change[] = [];
  const del = (p: string, n: Node) => changes.push({ path: p, kind: n.kind, op: 'delete', before: n.content, after: null });
  const add = (p: string, n: Node) => changes.push({ path: p, kind: n.kind, op: 'create', before: null, after: n.content });
  for (const p of paths) {
    const a = before.get(p);
    const b = after.get(p);
    if (a !== undefined && b === undefined) del(p, a);
    else if (a === undefined && b !== undefined) add(p, b);
    else if (a !== undefined && b !== undefined) {
      if (a.kind !== b.kind) { del(p, a); add(p, b); }
      else if (a.kind === 'symlink') {
        if (b.content !== state.links.get(p)) changes.push({ path: p, kind: 'symlink', op: 'modify', before: a.content, after: b.content });
      } else if (a.kind === 'file' && a.content !== null && b.content !== null && a.content !== b.content) {
        changes.push({ path: p, kind: 'file', op: 'modify', before: a.content, after: b.content });
      }
    }
  }
  return changes;
}

// ----------------------------------------------------------------- output

function humanSummary(changes: Change[]): string {
  if (changes.length === 0) return 'Dry run: nothing written. The real call would change nothing.\n';
  const lines = changes.map((c) => `  ${c.op.padEnd(6)}  ${c.path}${c.kind === 'dir' && c.path !== '.' ? '/' : ''}`);
  return `Dry run: nothing written. The real call would change ${changes.length} path${changes.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n`;
}

/**
 * Computes `changes`, removes the copy and writes the held-back stdout once.
 * Called at the end of `main` and, for a `process.exit` path, from the
 * `exit` event; whichever comes first does the work.
 */
function finishDryRun() {
  if (!state.armed || state.finished) return;
  state.finished = true;
  let changes: Change[] = [];
  let failure: string | null = null;
  try { changes = diffTrees(); } catch (e: any) { failure = e && e.message ? String(e.message) : String(e); }
  removeScratch();
  const held = state.stdout.join('');
  let text: string;
  if (failure !== null) {
    process.stderr.write(`Error: dry run: cannot compute the changes: ${failure}\n`);
    text = output.json ? JSON.stringify({ ok: false, error: 'internal_error', dry_run: true, changes: [] }, null, 2) + '\n' : '';
    process.exitCode = 1;
  } else if (output.json) {
    let parsed: unknown;
    try { parsed = JSON.parse(held); } catch { parsed = undefined; }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = Object.assign(deepToReal(parsed) as Record<string, unknown>, { dry_run: true, changes });
      text = JSON.stringify(result, null, 2) + '\n';
    } else {
      text = toReal(held);
    }
  } else {
    text = toReal(held) + humanSummary(changes);
  }
  try { (state.writeOut as (s: string) => void)(text); } catch { /* reader gone: same as EPIPE */ }
}

export type { Change };
export { isDryRun, armDryRun, sandboxFor, intoSandbox, toReal, finishDryRun };
