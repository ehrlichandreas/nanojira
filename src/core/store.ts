'use strict';

// Storage: clock, tombstones, atomic writes.

import type { Element } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { TYPE_PREFIX, IDS_BUCKET_PAD } from './constants.ts';
import { fail, hardExit } from './output.ts';
import { serialize } from './parse.ts';
import { readElementFile, ELEMENT_FILE_CAP } from './regular-file.ts';
import { internalSymlink, requireNoInternalSymlink } from './internal-path.ts';
import { idShaped } from './id-shape.ts';

// -------------------------------------------------------------------- clock

// NJ_NOW when set (and not empty), validated; null when the wall clock applies.
function pinnedNow(): string | null {
  const pinned = process.env.NJ_NOW;
  if (pinned === undefined || pinned === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
    fail('invalid_env', `invalid NJ_NOW '${pinned}' (expected ISO-8601 UTC, e.g. 2026-09-21T18:02:44Z)`,
      'fix NJ_NOW, or unset it for the system clock');
  }
  return pinned;
}

/** Refuses an invalid NJ_NOW up front (§ 12, DECISIONS 207): called once at
 * dispatch, so every command fails the same way whether or not it would ever
 * have read the clock -- not only the ones that happen to reach nowIso()
 * (a read over a backlog with a claim did, the same read without one did not). */
function checkClockEnv(): void {
  pinnedNow();
}

function nowIso(): string {
  return pinnedNow() ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The same clock as `nowIso()` (NJ_NOW when set, else the wall clock), as epoch ms — for `claim:stale`'s age arithmetic (§ 12 "Claims"). */
function nowMs(): number {
  return Date.parse(nowIso());
}

function mtimeIso(file: string) {
  try {
    return new Date(fs.statSync(file).mtime).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return '1970-01-01T00:00:00Z';
  }
}

// A sync sleep without dependencies — only used by the before-compare fault hook.
function sleepMs(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// --------------------------------------------------------------- tombstones

// `dir` is the actual tombstone folder in use — `.nanojira/ids` or, on a
// legacy backlog (`doctor` only), `.ids` — passed in, never assumed (§ 8,
// DECISIONS 95 B22). `shardSize` falsy (0/undefined) means today's flat
// layout; a legacy backlog is always flat (sharding is v3-only) and every
// caller there passes `shardSize` undefined.
//
// Under sharding this still visits every tombstone that has ever been
// allocated — same as the flat case — just walked as `ids/<TYPE>/<bucket>/*`
// instead of one flat `readdirSync`. That is fine for every caller of this
// function (doctor's checks, and the id:no_tombstone pass over the whole
// element set): the one caller that must NOT do an O(total-ever-allocated)
// scan is `allocateId`'s own start-value computation below, which never
// calls this — it only ever looks at the single highest bucket.
/**
 * The symlinks tombstones are never read or written through (DECISIONS 215):
 * `ids/` itself (or `.nanojira/`), else each linked type directory or bucket
 * of a sharded layout. One of them means part of the never-reuse record is
 * out of reach, which `doctor` reports as `backlog:ids_missing`. Exactly
 * `readTombstones`' own blind spots: in a flat `ids/` a linked entry is a
 * tombstone, counted by its name, so only `ids/` itself can hide any.
 */
function idsSymlinks(dir: string, shardSize?: number): string[] {
  const root = internalSymlink(dir);
  if (root !== null) return [root];
  const links: string[] = [];
  if (!shardSize) return links;
  let types: fs.Dirent[];
  try { types = fs.readdirSync(dir, { withFileTypes: true }); } catch { return links; }
  for (const te of types) {
    if (te.name.startsWith('.') || !(te.isDirectory() || te.isSymbolicLink())) continue;
    const typeDir = path.join(dir, te.name);
    if (te.isSymbolicLink()) { links.push(typeDir); continue; }
    let buckets: fs.Dirent[];
    try { buckets = fs.readdirSync(typeDir, { withFileTypes: true }); } catch { continue; }
    for (const be of buckets) if (!be.name.startsWith('.') && be.isSymbolicLink()) links.push(path.join(typeDir, be.name));
  }
  return links.sort();
}

function readTombstones(dir: string, shardSize?: number): Set<string> {
  const out: Set<string> = new Set();
  // Never listed through a symlink (DECISIONS 215): a linked `ids/` reads as
  // empty, which `doctor` reports as `backlog:ids_missing`.
  if (internalSymlink(dir) !== null) return out;
  if (!shardSize) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return out; }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      out.add(n);
    }
    return out;
  }
  let types;
  try { types = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const te of types) {
    const t = te.name;
    if (t.startsWith('.') || te.isSymbolicLink()) continue;
    const typeDir = path.join(dir, t);
    let buckets;
    try { buckets = fs.readdirSync(typeDir, { withFileTypes: true }); } catch { continue; }
    for (const be of buckets) {
      const b = be.name;
      if (b.startsWith('.') || be.isSymbolicLink()) continue;
      let names;
      try { names = fs.readdirSync(path.join(typeDir, b)); } catch { continue; }
      for (const n of names) if (!n.startsWith('.')) out.add(n);
    }
  }
  return out;
}

// Zero-padded bucket directory name for element-number `n` under
// `shardSize` (§ 8). `IDS_BUCKET_PAD` is fixed forever — see its own comment
// (constants.ts) — so a bucket number that would need more digits is a hard
// error rather than a silently wrong sort order.
function bucketName(n: number, shardSize: number): string {
  const b = Math.floor(n / shardSize);
  const s = String(b).padStart(IDS_BUCKET_PAD, '0');
  if (s.length > IDS_BUCKET_PAD) {
    return hardExit('id_allocation_failed',
      `nanojira: bucket ${b} (for id number ${n}, ids.shardSize=${shardSize}) needs more than ${IDS_BUCKET_PAD} digits — this is a hard limit`);
  }
  return s;
}

const TOMBSTONE_ID_RE = /^(EPIC|TSK|SUB)-(\d+)$/;

// Where tombstone `id` lives, both under flat and sharded layouts (§ 8).
// `dir` is what `allocateId` must `mkdir(..., {recursive: true})` before
// the `O_CREAT|O_EXCL` attempt; `file` is the tombstone itself. Flat:
// `dir === idsDir` (already created by the caller once). The prefix and
// number are read from `id` itself, never from a caller-supplied `type` --
// a mismatched one (a hand-placed element whose `type:` disagrees with its
// own ID prefix) must still land at the bucket its ID number actually
// implies, not wherever a wrong type would put it.
function tombstoneLocation(idsDir: string, id: string, shardSize: number): { dir: string; file: string } {
  if (!shardSize) return { dir: idsDir, file: path.join(idsDir, id) };
  const m = TOMBSTONE_ID_RE.exec(id);
  const prefix = m ? m[1] : id;
  const n = m ? parseInt(m[2], 10) : 0;
  const dir = path.join(idsDir, prefix, bucketName(n, shardSize));
  return { dir, file: path.join(dir, id) };
}

// The highest element-number already claimed for `prefix`, scanning only
// the single highest-numbered bucket directory (§ 8) — never the whole
// `ids/<prefix>/` tree. Tombstones are never removed (never-reuse), and
// `allocateId` only ever probes upward from the current max, so numbers
// are dense with no permanent gaps below it: the bucket holding the global
// max for `prefix` is always the highest-numbered bucket that exists for
// it. A directory this cannot list (gone, or deliberately unreadable, as
// the regression test below simulates for an OLD bucket) is treated as
// empty rather than failing the allocation.
function highestShardedMax(idsDir: string, prefix: string): number {
  const typeDir = path.join(idsDir, prefix);
  let buckets;
  try { buckets = fs.readdirSync(typeDir).filter((b) => !b.startsWith('.')); } catch { return 0; }
  if (buckets.length === 0) return 0;
  buckets.sort();
  const hi = buckets[buckets.length - 1];
  let names;
  try { names = fs.readdirSync(path.join(typeDir, hi)); } catch { return 0; }
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) { const v = parseInt(m[1], 10); if (v > max) max = v; }
  }
  return max;
}

// `shardSize` falsy (0/undefined, § 5 "ids.shardSize") keeps today's flat
// behaviour byte-for-byte. A positive value buckets tombstones at
// `ids/<TYPE>/<bucket>/<TYPE>-<n>` (§ 8) — `O_CREAT|O_EXCL` on the tombstone
// file remains the sole claiming authority either way; only the path depth
// and the start-value scan change.
function allocateId(idsDir: string, type: string, elements: Element[], shardSize: number): string {
  const prefix = TYPE_PREFIX[type];
  // A tombstone is the first write of `new`: none may land behind a symlink
  // (DECISIONS 215). The type directory is checked here too, since the
  // start value is read from it under sharding.
  requireNoInternalSymlink(shardSize ? path.join(idsDir, prefix) : idsDir, 'allocating a new id');
  fs.mkdirSync(idsDir, { recursive: true });

  let max = 0;
  const consider = (id: string) => {
    if (!idShaped(id)) return; // a 300-digit id must not become the start value (DECISIONS 215)
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  };
  if (shardSize) max = highestShardedMax(idsDir, prefix);
  else for (const t of readTombstones(idsDir)) consider(t);
  for (const el of elements) consider(el.id);

  let n = max + 1;
  for (let i = 0; i < 100; i++) {
    const id = prefix + '-' + String(n).padStart(3, '0');
    // § 6 bounds the number at 15 digits; a longer id would be malformed
    // the moment it exists (DECISIONS 215) — refused before its tombstone.
    if (!idShaped(id)) {
      return hardExit('id_allocation_failed', `nanojira: the next ${prefix} id would be ${id}, more than 15 digits — this is a hard limit (§ 6)`);
    }
    const { dir, file } = tombstoneLocation(idsDir, id, shardSize);
    if (dir !== idsDir) {
      requireNoInternalSymlink(dir, 'allocating a new id');
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      fs.closeSync(fs.openSync(file, 'wx'));
      return id;
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      n++;
    }
  }
  return hardExit('id_allocation_failed', `nanojira: id allocation failed after 100 retries (${prefix})`);
}

// ------------------------------------------------------------ atomic writes

function atomicWrite(target: string, content: string) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const fault = process.env.NJ_FAULT;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    if (fault === 'after-tmp-write') {
      fs.closeSync(fd);
      hardExit('fault:after-tmp-write', 'nanojira: aborted at fault injection point after-tmp-write');
    }
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (fault === 'before-rename') {
    hardExit('fault:before-rename', 'nanojira: aborted at fault injection point before-rename');
  }
  fs.renameSync(tmp, target);
}

/**
 * Identical to atomicWrite, except a fault hook raises a catchable `Fail`
 * instead of exiting the process directly. `nanojira claim`'s mirror write (§ 12a)
 * must run its rollback after ANY failure, fault hooks included, so it
 * cannot use atomicWrite's own hard-exit shortcut — there would be no
 * process left to perform the rollback.
 */
function mirrorWrite(target: string, content: string) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const fault = process.env.NJ_FAULT;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    if (fault === 'after-tmp-write') {
      fs.closeSync(fd);
      fail('fault:after-tmp-write', 'nanojira: aborted at fault injection point after-tmp-write');
    }
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (fault === 'before-rename') {
    fail('fault:before-rename', 'nanojira: aborted at fault injection point before-rename');
  }
  fs.renameSync(tmp, target);
}

/**
 * The same temp + fsync + rename as atomicWrite, for a derived file
 * (STATUS.md): no fault hooks — they belong to the element write, which
 * has already happened — and a failure throws after removing its temp file,
 * so a failed overview leaves nothing behind for `doctor` to report.
 */
function atomicReplace(target: string, content: string) {
  const tmp = path.join(path.dirname(target), `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  try {
    const fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

// Compare-before-write, shared by `set`, `note` and `archive` (§ 12) so that
// NJ_FAULT=before-compare covers all three.
// `hint` is caller-specific: `archive` takes no `--force`, so pointing at it
// there would name a flag the command rejects as unknown_field.
// `catchable`: a batch write (§ 9 "Batch writes") needs the before-compare
// timeout to fail only that one ID and be spent (D135, D137) -- the same
// reason mirrorWrite exists alongside atomicWrite. A single-ID command
// (the default) keeps the exact hard-exit behaviour it always had.
function compareGuard(el: Element, force: boolean, backlog?: string, hint?: string, catchable?: boolean) {
  // Fault hook: hold between the first read and the compare re-read so a test
  // can deterministically change the target underneath us (§ 12).
  if (process.env.NJ_FAULT === 'before-compare' && backlog) {
    const marker = path.join(backlog, '.nj-fault-go');
    // NJ_FAULT_READY=<path>: say "holding now" before the poll starts, so a
    // test plants its parallel change after the first read instead of
    // guessing with a sleep (§ 12, DECISIONS 201). Unset: nothing written.
    const ready = process.env.NJ_FAULT_READY;
    if (ready) {
      try {
        fs.writeFileSync(ready, el.id + '\n');
      } catch (e) {
        const msg = `nanojira: before-compare could not write NJ_FAULT_READY ${ready}: ${(e as Error).message}`;
        if (catchable) fail('fault:before-compare', msg);
        hardExit('fault:before-compare', msg);
      }
    }
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(marker)) {
      if (Date.now() >= deadline) {
        const msg = 'nanojira: before-compare timed out after 10s waiting for .nj-fault-go';
        if (catchable) fail('fault:before-compare', msg);
        hardExit('fault:before-compare', msg);
      }
      sleepMs(50);
    }
  }
  if (force) return;
  let current;
  try { current = readElementFile(el.file); } catch { current = null; }
  if (current !== el.raw) {
    fail('changed_in_parallel', `${el.id} changed in parallel, please run again`,
      hint === undefined ? 'use --force to overwrite deliberately' : hint);
  }
}

function guardedWrite(el: Element, content: string, force: boolean, backlog?: string) {
  compareGuard(el, force, backlog);
  atomicWrite(el.file, content);
}

/**
 * Identical to guardedWrite, except the write goes through mirrorWrite
 * instead of atomicWrite: a batch write (§ 9 "Batch writes") needs its
 * `NJ_FAULT` hook catchable, the same reason `nanojira claim`'s own mirror write
 * already needs it -- a single-ID command keeps calling guardedWrite
 * unchanged, so `NJ_FAULT` still aborts it outright (D135).
 */
function guardedWriteCatchable(el: Element, content: string, force: boolean, backlog?: string) {
  compareGuard(el, force, backlog, undefined, true);
  mirrorWrite(el.file, content);
}

// -------------------------------------------------------------------- moves

interface MovePlan {
  /** `[from, to]`, each one `rename`, in execution order. */
  renames: [string, string][];
  /** Source folders emptied by a merge, deepest first — removed with rmdir afterwards. */
  emptied: string[];
  /** Target paths already taken; a plan with any of them must not run. */
  conflicts: string[];
}

/**
 * Moving `src` (a file or a folder) to `dst`, planned before anything moves
 * (§ 11: all targets are verified first). A free target is one `rename`. An
 * existing folder where a folder goes is merged into — each entry one
 * `rename`, recursively — so a folder an earlier archive left behind never
 * blocks the next one (DECISIONS 90). Only a file already at a target path
 * (or a file where a folder goes, or the reverse) is a conflict; nothing is
 * ever overwritten.
 */
function planMove(src: string, dst: string): MovePlan {
  const plan: MovePlan = { renames: [], emptied: [], conflicts: [] };
  const visit = (from: string, to: string) => {
    let target;
    try {
      target = fs.lstatSync(to);
    } catch (e: any) {
      // Only "nothing is there yet" clears the way. Anything else — most
      // often ENOTDIR, a file sitting where an ancestor of `to` needs to be a
      // directory — means the path is blocked, and must be a conflict here,
      // before the first write, not a `mkdir` failure mid-move that leaves a
      // stamped file with nothing moved (TSK-029 T2).
      if (e.code === 'ENOENT') { plan.renames.push([from, to]); return; }
      plan.conflicts.push(to);
      return;
    }
    let source;
    try { source = fs.lstatSync(from); } catch { plan.conflicts.push(to); return; }
    // The same file under both paths — a case-only rename on a case-folding
    // filesystem, or `from` and `to` are literally identical — is already in
    // place: nothing to plan (DECISIONS 105 F2).
    if (target.dev === source.dev && target.ino === source.ino) return;
    if (!target.isDirectory() || !source.isDirectory()) { plan.conflicts.push(to); return; }
    for (const n of fs.readdirSync(from).sort()) visit(path.join(from, n), path.join(to, n));
    plan.emptied.push(from);
  };
  visit(src, dst);
  return plan;
}

/** Runs a conflict-free plan: missing ancestor folders first, then the renames, then rmdir the emptied sources. */
function runMove(plan: MovePlan) {
  for (const [from, to] of plan.renames) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  for (const dir of plan.emptied) {
    try { fs.rmdirSync(dir); } catch { /* something new appeared in it: it stays */ }
  }
}

function renderElement(el: Element, fieldOverrides: Map<string, string | string[] | undefined>, bodyOverride?: string) {
  const fields = new Map(el.fields);
  for (const [k, v] of fieldOverrides) {
    if (v === undefined) fields.delete(k);
    else fields.set(k, v);
  }
  const order = el.order.slice();
  for (const k of fields.keys()) if (!order.includes(k)) order.push(k);
  return requireWithinCap(el.id, serialize(fields, order, bodyOverride === undefined ? el.body : bodyOverride));
}

/**
 * `mkdir -p` for the folder an element is written into. Something that is
 * not a directory in the way — a file, or a layout folder linked to a file
 * or to nothing (DECISIONS 105 F1, 218) — is a one-line `io_error` naming
 * the path; any other OS error is left to the caller, as before. The hint
 * follows what is in the way: a symlink gets the symlink text, anything
 * else is named as the file to move (Reviewer N1).
 */
function makeFolder(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e: any) {
    if (!e || (e.code !== 'EEXIST' && e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) throw e;
    const block = inTheWay(dir);
    fail('io_error', `cannot create the folder ${e.path || dir} (${e.code}): something that is not a directory is in the way`,
      block !== null && !block.link
        ? `a file or other non-directory is in the way at ${block.at}; move it`
        : 'a layout folder that is a symlink must point at an existing directory; `nanojira doctor` reports one that does not as backlog:unreadable_dir');
  }
}

/** The first component of `dir`, from the top, that `mkdir -p` cannot pass:
 * a symlink not leading to a directory, or anything else that is not one.
 * Null when every existing component is a directory (a race). Only on the
 * error path, so the extra `lstat` calls cost nothing otherwise. */
function inTheWay(dir: string): { at: string; link: boolean } | null {
  const chain: string[] = [];
  for (let p = path.resolve(dir); ; p = path.dirname(p)) {
    chain.unshift(p);
    if (path.dirname(p) === p) break;
  }
  for (const p of chain) {
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { return null; }
    if (st.isDirectory()) continue;
    if (!st.isSymbolicLink()) return { at: p, link: false };
    let toDir = false;
    try { toDir = fs.statSync(p).isDirectory(); } catch { /* dangling or a loop */ }
    if (!toDir) return { at: p, link: true };
  }
  return null;
}

const TOO_LARGE_HINT = 'an element file is capped at 1 MiB so it can always be read back; shorten the text, or keep large content in a separate file and link to it';

/**
 * The write side of the element-file cap (DECISIONS 215): nanojira never
 * writes an element it would then refuse to read (`file:unreadable` above
 * 1 MiB, § 7). Every element write renders its content first, so this runs
 * before anything is written; `refused:too_large` (§ 9) otherwise.
 */
function requireWithinCap(id: string, content: string): string {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > ELEMENT_FILE_CAP) {
    fail('refused:too_large', `${id}: the element file would be ${size} bytes, above the 1 MiB cap on element files (§ 7) — nothing was written`, TOO_LARGE_HINT);
  }
  return content;
}

export { makeFolder, checkClockEnv, nowIso, nowMs, mtimeIso, idsSymlinks, readTombstones, allocateId, tombstoneLocation, atomicWrite, mirrorWrite, atomicReplace, compareGuard, guardedWrite, guardedWriteCatchable, planMove, runMove, renderElement, requireWithinCap, sleepMs };
