'use strict';

// nanojira's own bookkeeping — `.nanojira/` with `claims/` and `ids/` below
// it, and a legacy backlog's `.ids/` — is never meant to be a symlink, at
// any level. A layout folder may be one (DECISIONS 105); these may not: a
// crafted or cloned backlog could otherwise point a claim directory, the
// claims root or the tombstone directory anywhere, and claim cleanup would
// delete there, `claim` and `new` would write there (DECISIONS 215,
// TSK-033). So a write that would pass through such a link is refused
// (`refused:symlink`, § 9) before anything is written, a read finds nothing
// behind it, and `doctor --fix` leaves it alone with a note.

import * as fs from 'fs';
import * as path from 'path';
import { fail } from './output.ts';

const INTERNAL_ROOTS = ['.nanojira', '.ids'];

// Directories already seen to be real (never symlinks) in this process: the
// same few ancestors (`.nanojira`, `.nanojira/claims`) are asked about once
// per element by `list`, so each is lstat'ed once, not once per element.
// Only a positive answer is kept; a link or a missing path is asked again.
// A write or removal re-checks with `fresh` right before it acts: a
// directory swapped for a link after the first check must not pass on the
// strength of that earlier answer.
const realDirs: Set<string> = new Set();

/**
 * The first component of `target` that is a symlink, from its internal root
 * (the last `.nanojira` or `.ids` in the path) down to `target` itself; null
 * when there is none, or when the path leaves the internal tree or stops
 * existing before one is met (nothing below a missing directory exists).
 */
function internalSymlink(target: string, fresh = false): string | null {
  const parts = path.resolve(target).split(path.sep);
  const at = Math.max(...INTERNAL_ROOTS.map((r) => parts.lastIndexOf(r)));
  if (at < 1) return null;
  for (let i = at; i < parts.length; i++) {
    const p = parts.slice(0, i + 1).join(path.sep);
    if (!fresh && realDirs.has(p)) continue;
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { return null; }
    if (st.isSymbolicLink()) return p;
    if (st.isDirectory()) realDirs.add(p);
  }
  return null;
}

/** The backlog-relative name of `link` for a message: everything from its internal root on. */
function shownName(link: string): string {
  const parts = link.split(path.sep);
  const at = Math.max(...INTERNAL_ROOTS.map((r) => parts.lastIndexOf(r)));
  return parts.slice(at).join('/');
}

const SYMLINK_HINT = 'replace the link with a real directory holding the same contents (or remove it), then retry';

/** Refuses before anything is written when `target` lies behind a symlink inside nanojira's bookkeeping. */
function requireNoInternalSymlink(target: string, verb: string, fresh = false): void {
  const link = internalSymlink(target, fresh);
  if (link === null) return;
  fail('refused:symlink', `${verb} is refused — ${shownName(link)} is a symlink, and nanojira never writes or deletes through a symlink inside its own bookkeeping (§ 9, DECISIONS 215)`,
    SYMLINK_HINT);
}

/** The `doctor --fix` note for a link it leaves alone. */
function symlinkNote(link: string): string {
  return `${shownName(link)}: a symlink — not followed, not changed (DECISIONS 215); replace it with a real directory, or remove the link by hand`;
}

export { internalSymlink, requireNoInternalSymlink, shownName, symlinkNote };
