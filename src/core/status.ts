'use strict';

// The status overview, `STATUS.md` (§ 4): rendered from the elements,
// written after every successful write, checked by `doctor`. Derived, never
// read as truth.

import type { Element, Config, Context } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { compareElements } from './derive.ts';
import { scanBacklog } from './layout.ts';
import { loadElement } from './load.ts';
import { atomicReplace } from './store.ts';

// --------------------------------------------------------------------- render

function statusPath(backlog: string) {
  return path.join(backlog, 'STATUS.md');
}

/**
 * The byte-exact § 4 format: one section per configured status, in
 * configuration order, each present even when empty; a last `?` section for
 * everything else — an unconfigured status, or an unreadable stub, which has
 * none — only when non-empty. `list` order inside a section; archived
 * elements are left out; the link is the path relative to the backlog.
 */
function renderStatus(elements: Element[], cfg: Config): string {
  const sections: Map<string, Element[]> = new Map(cfg.statuses.map((s) => [s, []]));
  const other: Element[] = [];
  for (const el of elements) {
    if (el.archived) continue;
    const list = el.readable ? sections.get(el.status) : undefined;
    (list === undefined ? other : list).push(el);
  }
  const line = (el: Element) => {
    const link = (el.folder === '' ? '' : el.folder + '/') + path.basename(el.file);
    return `- [${el.id}](${link})` + (el.title === '' ? '' : ' ' + el.title);
  };
  const block = (name: string, els: Element[]) =>
    [`## ${name} (${els.length})`].concat(els.length > 0 ? ['', ...els.slice().sort(compareElements).map(line)] : []).join('\n');
  const blocks = ['# Status'].concat(Array.from(sections, ([name, els]) => block(name, els)));
  if (other.length > 0) blocks.push(block('?', other));
  return blocks.join('\n\n') + '\n';
}

/** What `doctor` compares against, from elements it has already loaded. */
function statusIsFresh(backlog: string, elements: Element[], cfg: Config): boolean {
  let current;
  try { current = fs.readFileSync(statusPath(backlog), 'utf8'); } catch { return false; }
  return current === renderStatus(elements, cfg);
}

// ---------------------------------------------------------------------- write

// A file whose ctime is older than the command's load start by at least this
// much cannot have changed since the command read it; the margin absorbs
// clock granularity between the kernel's ctime and Date.now() (DECISIONS 103).
const CTIME_MARGIN_MS = 2000;

/**
 * After a successful write: one full scan — every folder listed, every file
 * stat'ed — so the overview shows the backlog as it is now, a racing
 * writer's change included; then an atomic replace. Only files new to the
 * command, or with a ctime newer than its load start minus the margin, are
 * re-read; every other file reuses the element `ctx` already loaded. ctime
 * cannot be set by utimes and moves with every write and rename, so this
 * equals a full re-read at a sixth of the cost (DECISIONS 103). A failure is
 * a warning, never the command's failure (§ 4, DECISIONS 95 B19, 99).
 * Returns whether the file's bytes changed.
 */
function refreshStatus(backlog: string, cfg: Config, ctx?: Context): boolean {
  if (!cfg.layout.statusFile) return false;
  try {
    const known: Map<string, Element> = new Map(ctx ? ctx.elements.map((e) => [e.file, e]) : []);
    const cutoff = ctx ? ctx.loadedAt - CTIME_MARGIN_MS : -Infinity;
    const elements = scanBacklog(backlog, cfg.layout).files.map(({ file, folder }) => {
      const had = known.get(file);
      if (had !== undefined) {
        let ctime = Infinity;
        try { ctime = fs.statSync(file).ctimeMs; } catch { /* unreadable now: read it, becomes a stub */ }
        if (ctime < cutoff) return had;
      }
      return loadElement(file, backlog, cfg, folder);
    });
    const fresh = renderStatus(elements, cfg);
    let current = null;
    try { current = fs.readFileSync(statusPath(backlog), 'utf8'); } catch { /* missing or not a file: rewrite */ }
    if (current === fresh) return false;
    atomicReplace(statusPath(backlog), fresh);
    return true;
  } catch (e: any) {
    const reason = e && e.message ? String(e.message).split('\n')[0] : String(e);
    process.stderr.write(`Warning: STATUS.md not updated (${reason})\n`);
    return false;
  }
}

export { renderStatus, statusIsFresh, refreshStatus };
