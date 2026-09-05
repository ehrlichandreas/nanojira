'use strict';

// Storage: clock, tombstones, atomic writes.

import type { Element } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { TYPE_PREFIX } from './constants.ts';
import { fail, hardExit } from './output.ts';
import { serialize } from './parse.ts';

// -------------------------------------------------------------------- clock

function nowIso(): string {
  const pinned = process.env.NJ_NOW;
  if (pinned !== undefined && pinned !== '') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
      fail('invalid_env', `invalid NJ_NOW '${pinned}' (expected ISO-8601 UTC, e.g. 2026-09-21T18:02:44Z)`);
    }
    return pinned;
  }
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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
// DECISIONS 95 B22).
function readTombstones(dir: string) {
  const out: Set<string> = new Set();
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n.startsWith('.')) continue;
    out.add(n);
  }
  return out;
}

function allocateId(idsDir: string, type: string, elements: Element[]): string {
  const prefix = TYPE_PREFIX[type];
  fs.mkdirSync(idsDir, { recursive: true });

  let max = 0;
  const consider = (id: string) => {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  };
  for (const t of readTombstones(idsDir)) consider(t);
  for (const el of elements) consider(el.id);

  let n = max + 1;
  for (let i = 0; i < 100; i++) {
    const id = prefix + '-' + String(n).padStart(3, '0');
    try {
      fs.closeSync(fs.openSync(path.join(idsDir, id), 'wx'));
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
  try { current = fs.readFileSync(el.file, 'utf8'); } catch { current = null; }
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
  return serialize(fields, order, bodyOverride === undefined ? el.body : bodyOverride);
}

export { nowIso, nowMs, mtimeIso, readTombstones, allocateId, atomicWrite, mirrorWrite, atomicReplace, compareGuard, guardedWrite, guardedWriteCatchable, planMove, runMove, renderElement, sleepMs };
