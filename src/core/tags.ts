'use strict';

// The tag vocabulary overview, `TAGS.md`: every tag in use across the
// backlog, with its carrier count, rendered from the elements, written
// after every successful write, checked by `doctor` — the same
// "regenerated artifact, never incrementally patched" mechanism `STATUS.md`
// (status.ts) already uses, applied to `tags` instead of `status`: a
// fully-regenerated file can never drift from the element files the way an
// append-only log could (a tag removed from every element would leave a
// ghost entry there unless every removal path also remembered to clean it
// up — regenerating from scratch has no such path to forget).
//
// Unlike `STATUS.md`, archived elements are NOT left out: an archived
// element's tags are still "in use" for drift-visibility purposes (the
// whole point of this file), and there is no per-status grouping dimension
// to apply the "? section" treatment to — just one flat, sorted list.

import type { Element, Config, Context } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { scanBacklog } from './layout.ts';
import { loadElement } from './load.ts';
import { atomicReplace } from './store.ts';
import { osaDistance } from './suggest.ts';

// --------------------------------------------------------------------- render

function tagsPath(backlog: string) {
  return path.join(backlog, 'TAGS.md');
}

/** Every tag currently in use, with how many elements carry it. */
function tagCounts(elements: Element[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const el of elements) {
    for (const t of el.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

/**
 * The tag vocabulary, sorted. `cfg` is unused today — kept only so this
 * mirrors `renderStatus(elements, cfg)`'s own signature exactly, since there
 * is no per-status-like grouping dimension for tags to apply it to.
 */
function renderTags(elements: Element[], cfg: Config): string {
  void cfg;
  const counts = tagCounts(elements);
  const names = Array.from(counts.keys()).sort();
  const lines = names.map((name) => `- \`${name}\` (${counts.get(name)})`);
  const body = lines.length > 0 ? lines.join('\n') : '(no tags in use)';
  return `# Tags\n\n${body}\n`;
}

/** What `doctor` compares against, from elements it has already loaded. */
function tagsIsFresh(backlog: string, elements: Element[], cfg: Config): boolean {
  let current;
  try { current = fs.readFileSync(tagsPath(backlog), 'utf8'); } catch { return false; }
  return current === renderTags(elements, cfg);
}

// ---------------------------------------------------------------------- write

// Mirrors status.ts's own CTIME_MARGIN_MS exactly (DECISIONS 103) — kept as
// its own local constant rather than imported, the same "exact mirror, not
// a shared refactor" choice this whole module makes relative to status.ts.
const CTIME_MARGIN_MS = 2000;

/**
 * After a successful write: one full scan, then an atomic replace — same
 * incremental re-read discipline as `refreshStatus` (status.ts). A failure
 * is a warning, never the command's failure. Returns whether the file's
 * bytes changed.
 */
function refreshTags(backlog: string, cfg: Config, ctx?: Context): boolean {
  if (!cfg.layout.tagsFile) return false;
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
    const fresh = renderTags(elements, cfg);
    let current = null;
    try { current = fs.readFileSync(tagsPath(backlog), 'utf8'); } catch { /* missing or not a file: rewrite */ }
    if (current === fresh) return false;
    atomicReplace(tagsPath(backlog), fresh);
    return true;
  } catch (e: any) {
    const reason = e && e.message ? String(e.message).split('\n')[0] : String(e);
    process.stderr.write(`Warning: TAGS.md not updated (${reason})\n`);
    return false;
  }
}

// ------------------------------------------------------------- near-match

/** Case/hyphen/underscore-insensitive, for comparing two tag spellings. */
function normalizeTag(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, '');
}

/**
 * The one near-match, or null when none is unambiguous — same policy
 * `suggestValue` (suggest.ts) already uses for did-you-mean hints: OSA
 * distance <= 1 for a <= 4-character (normalized) tag, <= 2 otherwise, and
 * only when exactly one known tag reaches that distance. A distance of 0
 * (two spellings that normalize identically, e.g. "Backend"/"backend") is
 * the central case this exists to catch, not excluded.
 */
function nearMatchTag(tag: string, known: string[]): string | null {
  const target = normalizeTag(tag);
  const threshold = target.length <= 4 ? 1 : 2;
  // Deduplicated by NORMALIZED form first: two raw spellings already in
  // `known` that normalize identically (the drift this whole feature exists
  // to catch, e.g. "backend" and "back-end" both already present) are one
  // candidate, not two tied-for-best ones -- counting them separately would
  // make a third variant's distance-0 match against either look ambiguous
  // and suppress the warning exactly where it is most warranted.
  const byNorm = new Map<string, string>();
  for (const k of known) {
    const nk = normalizeTag(k);
    if (!byNorm.has(nk)) byNorm.set(nk, k);
  }
  let best: string[] = [];
  let bestDist = Infinity;
  for (const [nk, raw] of byNorm) {
    const d = osaDistance(target, nk);
    if (d < bestDist) { bestDist = d; best = [raw]; } else if (d === bestDist) best.push(raw);
  }
  return bestDist <= threshold && best.length === 1 ? best[0] : null;
}

/**
 * Prints one non-blocking warning per tag in `newTags` that is new (not
 * already in `priorTags`, verbatim) and looks like a drifted spelling of a
 * tag that already exists — never affects the exit code, the write, or
 * JSON output (§ matches `status.ts`'s own `Warning: ...` stderr style,
 * never the stdout per-element `writeFeedback` style, since this is
 * transient to this one invocation rather than a persistent per-element
 * problem). A tag introduced earlier in the same call also counts as
 * "already known" for any later tag in the same call.
 */
function warnTagNearMatches(newTags: string[], priorTags: string[]): void {
  const known = new Set(priorTags);
  for (const tag of newTags) {
    if (known.has(tag)) continue;
    const match = nearMatchTag(tag, Array.from(known));
    if (match !== null) {
      process.stderr.write(
        `Warning: tag '${tag}' looks like it might be a drifted spelling of existing tag '${match}' -- did you mean to reuse '${match}'?\n`);
    }
    known.add(tag);
  }
}

export { tagsPath, tagCounts, renderTags, tagsIsFresh, refreshTags, nearMatchTag, warnTagNearMatches };
