'use strict';

// Where element files lie (§ 4): the recursive scan, and the place each
// grouping gives an element. The frontmatter is the truth; the place is
// derived from it, never the other way round.

import type { Element, Layout, Scan } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { FOLDER_ROLES, TYPE_FOLDER_ROLE } from './constants.ts';
import { ID_SHAPE, idShaped } from './id-shape.ts';

// ---------------------------------------------------------------------- scan

// Bookkeeping directories nanojira scans for its own temp files; element files
// never lie there. Every dot-directory is outside the element scan anyway.
const INTERNAL_DIRS = ['.ids', '.nanojira'];
// Human-facing files at the top of the backlog; everywhere else a `*.md` is
// an element file (DECISIONS 91 B12).
const TOP_LEVEL_DOCS = new Set(['README.md', 'STATUS.md', 'TAGS.md']);

/** A folder named like an element ID — the folders group `hierarchy` creates. */
const ID_FOLDER = ID_SHAPE;

// A configured folder name is matched case-insensitively wherever it is
// compared against what actually lies on disk — for placement and for
// archived-ness alike. Safe because DECISIONS 91 B14 already requires the
// four configured names to be distinct case-insensitively, so this can never
// fold two different configured folders into one (DECISIONS 105).
function foldEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * One walk over the backlog. The order is observable (first-wins on
 * duplicate IDs, children in scan order), so it extends v2's rather than
 * replacing it: the four configured folders first, in role order, then the
 * rest of the top level by name; inside a directory, entries by name,
 * depth-first. A backlog that only uses the type folders scans exactly as v2
 * did.
 *
 * Bounds (DECISIONS 91 B11): a directory whose name starts with `.` is never
 * entered (`.ids/`, `.nanojira/`, `.git`, …), a directory symlink is never
 * followed, a file symlink is read like a file — a dangling one becomes a
 * `file:unreadable` stub, as in v2. `.md` is case-sensitive.
 */
function scanBacklog(backlog: string, layout: Layout): Scan {
  const files: { file: string; folder: string }[] = [];
  const dirs: string[] = [backlog];
  const unreadable: { dir: string; reason: string }[] = [];
  const readEntries = (dir: string): fs.Dirent[] => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e.code !== 'ENOENT') unreadable.push({ dir, reason: e.code || e.message });
      return [];
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  // Dirent types, not a stat per entry: the scan stays one readdir per folder.
  // The relative folder is built per folder, not per file (path.relative on
  // every file costs ~20 ms at 10 000 elements).
  const walk = (dir: string, folder: string, entries: fs.Dirent[]) => {
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue;
        dirs.push(abs);
        walk(abs, folder === '' ? e.name : folder + '/' + e.name, readEntries(abs));
      } else if (e.name.endsWith('.md') && !(e.isSymbolicLink() && isDirectory(abs))) {
        files.push({ file: abs, folder });
      }
    }
  };
  const roleNames: string[] = FOLDER_ROLES.map((r) => layout.folders[r]);
  const top = readEntries(backlog).filter((e) => !(TOP_LEVEL_DOCS.has(e.name) && !e.isDirectory()));
  const isRoleName = (name: string) => roleNames.some((n) => foldEq(n, name));
  // The four configured layout folders, matched case-insensitively (DECISIONS
  // 105), are walked first, in role order. A layout folder that is itself a
  // directory symlink is FOLLOWED, as v2's plain readdir did — only what lies
  // BELOW it stays subject to B11's no-follow rule. A dangling or non-directory
  // one is `backlog:unreadable_dir`, never silently dropped (DECISIONS 105 F1).
  for (const n of roleNames) {
    const e = top.find((t) => foldEq(t.name, n));
    if (e === undefined) continue;
    const abs = path.join(backlog, e.name);
    if (e.isSymbolicLink()) {
      let st;
      try {
        st = fs.statSync(abs);
      } catch (err: any) {
        unreadable.push({ dir: abs, reason: err.code === 'ENOENT' ? 'dangling symlink' : (err.code || err.message) });
        continue;
      }
      if (!st.isDirectory()) { unreadable.push({ dir: abs, reason: 'not a directory' }); continue; }
    } else if (!e.isDirectory()) {
      continue;
    }
    dirs.push(abs);
    walk(abs, e.name, readEntries(abs));
  }
  walk(backlog, '', top.filter((e) => !isRoleName(e.name)));
  for (const n of INTERNAL_DIRS) {
    const abs = path.join(backlog, n);
    if (isDirectory(abs)) dirs.push(abs);
  }
  return { files, dirs, unreadable };
}

function isDirectory(p: string) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** `file`'s directory relative to the backlog, `/`-separated, `''` at the top. */
function folderOf(backlog: string, file: string): string {
  const rel = path.relative(backlog, path.dirname(file));
  return rel === '' ? '' : rel.split(path.sep).join('/');
}

/**
 * Archived exactly when the file lies below the archive folder (§ 4),
 * matched case-insensitively against the configured name like every other
 * placement decision (DECISIONS 105 F2).
 */
function inArchive(folder: string, layout: Layout) {
  const a = layout.folders.archive;
  if (folder.length === a.length) return foldEq(folder, a);
  if (folder.length > a.length && folder[a.length] === '/') return foldEq(folder.slice(0, a.length), a);
  return false;
}

/**
 * Whether `want` (the layout's computed place, in the configured names'
 * exact case) and `have` (the folder actually on disk) name the same place.
 * Segment-wise, so an ID folder under `hierarchy` still compares exactly —
 * only the leading archive-folder segment, if present, folds case, the same
 * as `inArchive` (DECISIONS 105 F2).
 */
function samePlace(want: string, have: string, layout: Layout): boolean {
  if (layout.group !== 'hierarchy') return foldEq(want, have);
  const strip = (s: string) => {
    const seg = s.split('/')[0];
    return foldEq(seg, layout.folders.archive) ? { archived: true, rest: s.slice(seg.length + 1) } : { archived: false, rest: s };
  };
  const w = strip(want), h = strip(have);
  return w.archived === h.archived && w.rest === h.rest;
}

// -------------------------------------------------------------------- places

/**
 * The folder path (relative, `/`-separated) of `el` under `hierarchy`: the
 * tree becomes the folder structure — an epic or task gets a folder named
 * after its ID below its parent's, a subtask lies in its parent's. Without a
 * `parent` the element starts at the top (DECISIONS 91 B15). null when the
 * chain cannot be followed: a `parent` that points at nothing, or a cycle —
 * anywhere up the chain — and when an epic or task on it has an id that is
 * not § 6-shaped, which never becomes a folder name (DECISIONS 215).
 */
function hierarchyDir(el: Element, byId: Map<string, Element>): string | null {
  const chain: Element[] = [];
  const seen: Set<string> = new Set();
  for (let cur: Element | undefined = el; cur !== undefined;) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    chain.unshift(cur);
    if (cur.parent === null) break;
    cur = byId.get(cur.parent);
    if (cur === undefined) return null;
  }
  const folders = chain.filter((c) => c.type === 'epic' || c.type === 'task');
  if (!folders.every((c) => idShaped(c.id))) return null;
  return folders.map((c) => c.id).join('/');
}

/**
 * The folder (relative to the backlog, `/`-separated) the layout gives `el`,
 * active or below the archive folder; null when it cannot be determined — an
 * unknown type, or an unfollowable parent chain under `hierarchy`.
 */
function placeOf(el: Element, byId: Map<string, Element>, layout: Layout, archived: boolean): string | null {
  if (el.type === null) return null;
  const inArch = (dir: string) => (archived ? [layout.folders.archive, dir].filter((d) => d !== '').join('/') : dir);
  if (layout.group === 'type') return archived ? layout.folders.archive : layout.folders[TYPE_FOLDER_ROLE[el.type]];
  if (layout.group === 'flat') return inArch('');
  const dir = hierarchyDir(el, byId);
  return dir === null ? null : inArch(dir);
}

/** Where the file should lie now: archived-ness is its location (§ 4). */
function expectedPlace(el: Element, byId: Map<string, Element>, layout: Layout) {
  return placeOf(el, byId, layout, el.archived);
}

/**
 * Where `doctor --fix` moves a misplaced file. `archived:` in the frontmatter
 * decides only this target, never whether the file is misplaced: a file off
 * its place that carries it belongs below the archive folder (e.g. under an
 * archive folder since renamed), one without it to its active place
 * (DECISIONS 92 Q2).
 */
function moveTarget(el: Element, byId: Map<string, Element>, layout: Layout) {
  return placeOf(el, byId, layout, el.archived || el.archivedAt !== null);
}

/** The code a file off its place carries — `type:folder` keeps its v2 meaning for group `type` (§ 7). */
function misplacedCode(layout: Layout) {
  return layout.group === 'type' ? 'type:folder' : 'layout:misplaced';
}

/** The folder a hierarchy epic or task owns: named after its ID, holding its file. */
function ownFolder(el: Element): string | null {
  if (el.type !== 'epic' && el.type !== 'task') return null;
  const dir = path.dirname(el.file);
  return path.basename(dir) === el.id ? dir : null;
}

// The folders a move left behind: removed once empty, walking up, but only
// the ID-shaped ones `hierarchy` creates — never a type folder, never with
// anything still in it, never recursively (DECISIONS 92). Shared by
// `doctor --fix` step 3 and `nanojira unarchive` (§ 11a).
function removeEmptiedIdFolders(backlog: string, dirs: Set<string>) {
  for (const start of dirs) {
    for (let d = start; d !== backlog && d.startsWith(backlog + path.sep) && ID_FOLDER.test(path.basename(d)); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
}

export { ID_FOLDER, scanBacklog, folderOf, inArchive, samePlace, placeOf, expectedPlace, moveTarget, misplacedCode, ownFolder, removeEmptiedIdFolders, foldEq };
