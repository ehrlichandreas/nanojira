'use strict';

// `files: [{path, op}]` on every write result (§ 9 "files", DECISIONS 222).
//
// Every write nanojira makes goes through a handful of helpers (store.ts's
// atomic writes and moves, the tombstone allocation, a few `doctor --fix`
// and `init` steps), and each one records the path here as it lands. A
// command attaches the collapsed list to its result right before printing
// it. One journal per process: the CLI is one process per call, and
// `nanojira-mcp` spawns one for every tool call.
//
// Under `--dry-run` the writes land in the scratch copy and the paths are
// made relative to the copy's backlog root, so the list reads as the real
// call's would.

import * as fs from 'fs';
import * as path from 'path';
import { V3_INDEX_REL, LEGACY_INDEX_REL } from './constants.ts';

type Op = 'created' | 'modified' | 'moved' | 'deleted';

interface FileEntry { path: string; op: Op; from?: string }

/** Absolute path → what happened to it so far, in first-touch order. */
const journal = new Map<string, { op: Op; from?: string }>();

/** The backlog root this call writes to (the copy's, under `--dry-run`),
 * once known: what a failure result's `files` is relative to. */
let root: string | null = null;
function setJournalRoot(backlog: string): void { root = backlog; }

/** A file is about to be written at `abs`: created when nothing is there yet. */
function existedBefore(abs: string): boolean {
  try { fs.lstatSync(abs); return true; } catch { return false; }
}

/** Records a write that has landed. `existed`: whether `abs` was there before it. */
function touchWrite(abs: string, existed: boolean): void {
  const prev = journal.get(abs);
  if (prev === undefined) journal.set(abs, { op: existed ? 'modified' : 'created' });
  else if (prev.op === 'deleted') journal.set(abs, { op: 'modified' });
  // created, modified and moved stay what they are
}

/** Records that the file at `abs` is gone. */
function touchDelete(abs: string): void {
  const prev = journal.get(abs);
  if (prev !== undefined && prev.op === 'created') { journal.delete(abs); return; }
  if (prev !== undefined && prev.op === 'moved') {
    journal.delete(abs);
    touchDelete(prev.from as string);
    return;
  }
  journal.set(abs, { op: 'deleted' });
}

/** Records that the file at `from` now lives at `to` (one file, not a folder). */
function touchMove(from: string, to: string): void {
  const prev = journal.get(from);
  journal.delete(from);
  if (prev !== undefined && prev.op === 'created') { journal.set(to, { op: 'created' }); return; }
  const origin = prev !== undefined && prev.op === 'moved' ? (prev.from as string) : from;
  if (origin === to) { journal.set(to, { op: 'modified' }); return; }
  journal.set(to, { op: 'moved', from: origin });
}

/** Records every file below `abs` (or `abs` itself) as deleted; called
 * before a recursive removal, while the files are still there to list. */
function touchDeleteTree(abs: string): void {
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch { return; }
  if (!st.isDirectory()) { touchDelete(abs); return; }
  for (const n of fs.readdirSync(abs).sort()) touchDeleteTree(path.join(abs, n));
}

/** Records a `rename(from, to)` that has landed: one file, or every file
 * below a folder that moved as a whole. */
function touchRename(from: string, to: string): void {
  let st: fs.Stats;
  try { st = fs.lstatSync(to); } catch { return; }
  if (!st.isDirectory()) { touchMove(from, to); return; }
  for (const n of fs.readdirSync(to).sort()) touchRename(path.join(from, n), path.join(to, n));
}

/** Never listed: the claim bookkeeping and the index (both gitignored), and
 * nanojira's own scratch files, which are never meant to be committed. */
function listed(rel: string): boolean {
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (rel === V3_INDEX_REL || rel === LEGACY_INDEX_REL || rel === '.nanojira/claims' || rel.startsWith('.nanojira/claims/')) return false;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return !base.startsWith('.nj-tmp-') && !base.startsWith('.nj-rm-');
}

/** The journal as `files`: paths relative to `backlog` with `/` separators,
 * sorted by path. `[]` when nothing was written. */
function touchedFiles(backlog: string): FileEntry[] {
  const rel = (abs: string) => path.relative(backlog, abs).split(path.sep).join('/');
  const out: FileEntry[] = [];
  for (const [abs, e] of journal) {
    const p = rel(abs);
    if (!listed(p)) continue;
    if (e.op === 'moved') {
      const from = rel(e.from as string);
      out.push(listed(from) ? { path: p, op: 'moved', from } : { path: p, op: 'created' });
    } else {
      out.push({ path: p, op: e.op });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `files` for a failure result: what landed before the call failed, or
 * `undefined` when nothing listed was written (the key is then left out). */
function failureFiles(): FileEntry[] | undefined {
  if (root === null || journal.size === 0) return undefined;
  const files = touchedFiles(root);
  return files.length > 0 ? files : undefined;
}

/** `result` with `files` appended (a new object; `result` is left as it is). */
function withFiles<T extends object>(result: T, backlog: string): T & { files: FileEntry[] } {
  return Object.assign({}, result, { files: touchedFiles(backlog) });
}

export type { FileEntry };
export { setJournalRoot, failureFiles, existedBefore, touchWrite, touchDelete, touchDeleteTree, touchMove, touchRename, touchedFiles, withFiles };
