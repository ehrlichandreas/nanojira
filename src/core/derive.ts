'use strict';

// Derived views over loaded elements: problems, readiness, ordering, JSON entries.

import type { Element, Config, EntryJson } from './types.ts';

import { readClaim, isClaimStale, elementClaimLink } from './claims.ts';
import { PRIORITY_WEIGHT, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL } from './constants.ts';
import { sectionCheckboxCounts, sectionCheckboxItems, sectionContent } from './parse.ts';
import { nowMs } from './store.ts';

// -------------------------------------------------------------- derivations

// `ignore` (§ 5/§ 7 "problems.ignore", DECISIONS 165/166): warning codes a
// backlog has opted to suppress everywhere they're reported -- never here
// in a way that reaches `isReady` (below), which reads `el.problems`
// directly, not through this function, so suppressing a report can never
// quietly change the readiness computation (§ 7 "never the readiness
// computation itself").
function elementProblems(el: Element, ignore: readonly string[] = []) {
  return Array.from(el.problems).filter((c) => !BACKLOG_LEVEL.has(c) && !ignore.includes(c)).sort();
}

function hasError(el: Element) {
  return elementProblems(el).some((c) => SEVERITY[c] === 'error');
}

function isIncomplete(el: Element) {
  if (hasError(el)) return false;
  return elementProblems(el).some((c) => c.startsWith('incomplete:'));
}

// `backlog` adds the one blocking code that lives outside the element file:
// element-level `claim:symlink` (§ 7, DECISIONS 215), read from its claims.
function isReady(el: Element, cfg: Config, backlog?: string) {
  if (el.archived) return false;
  if (el.status !== cfg.statuses[0]) return false;
  for (const c of el.problems) if (BLOCKS_READY.has(c)) return false;
  if (backlog !== undefined && elementClaimLink(backlog, el.id) !== null) return false;
  for (const dep of el.depends_on) {
    const t = (el.byId as Map<string, Element>).get(dep);
    if (!t) return false;
    if (t.archived) continue;
    if (t.status !== 'done') return false;
    if (t.problems.has('done:open_children')) return false;
  }
  return true;
}

/**
 * The leaf-work rule (DECISIONS 156, reused by `next` and, since v3.6
 * DECISIONS 158 EV-4, bare `nanojira`'s own "Ready to work"): true when `el` has
 * at least one child that is neither `done` nor archived. `list --ready`
 * never calls this — it stays a pure readiness filter over § 9's five
 * conditions, container or not.
 */
function hasOpenChild(el: Element): boolean {
  return (el.children as Element[]).some((c) => !c.archived && c.status !== 'done');
}

function idSortKey(id: string): [string, number, string] {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(id);
  return m ? [m[1], parseInt(m[2], 10), ''] : ['￿', 0, id];
}

function priorityWeight(p: string) {
  const w = PRIORITY_WEIGHT[p];
  return w === undefined ? PRIORITY_WEIGHT.normal : w;
}

function compareElements(a: Element, b: Element) {
  const w = priorityWeight(b.priority) - priorityWeight(a.priority);
  if (w !== 0) return w;
  const ka = idSortKey(a.id);
  const kb = idSortKey(b.id);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

/**
 * Built incrementally -- the object literal starts with only `id`/`type` and
 * every other field is added a few lines below, unconditionally except
 * `parent`/`assignee`/`archived`. `Partial` types the literal as it actually
 * grows; the `EntryJson` cast on return says what every caller can rely on
 * once the function has run to completion.
 */
function entryJson(el: Element, backlog: string, cfg: Config): EntryJson {
  const e: Partial<EntryJson> = { id: el.id, type: el.type };
  if (el.parent !== null) e.parent = el.parent;
  e.title = el.title;
  e.status = el.status;
  e.priority = el.priority;
  if (el.assignee !== '') e.assignee = el.assignee;
  e.tags = el.tags;
  e.depends_on = el.depends_on;
  e.created = el.created;
  e.updated = el.updated;
  if (el.archivedAt !== null) e.archived = el.archivedAt;
  e.file = el.file;
  // claim:stale (§ 7, § 12 "Claims") is computed fresh here, never stored in
  // el.problems — like claim:mismatch/claim:orphaned, it depends on the
  // claims directory and the clock, not on the element file alone. Field
  // order (_problems before _claim) matches the pre-existing EntryJson shape.
  const claim = readClaim(backlog, el.id);
  const probs = elementProblems(el, cfg.problems.ignore);
  const fresh: string[] = [];
  if (claim && isClaimStale(claim.since, cfg.claims.staleAfterHours, nowMs())) fresh.push('claim:stale');
  // claim:symlink (§ 7, DECISIONS 215), element-level: computed fresh the same way.
  if (elementClaimLink(backlog, el.id) !== null) fresh.push('claim:symlink');
  // problems.ignore applies to these too: suppressed everywhere, not only
  // in doctor (§ 7, DECISIONS 221).
  for (const c of fresh) if (!cfg.problems.ignore.includes(c)) probs.push(c);
  e._problems = probs.sort();
  e._claim = claim;
  return e as EntryJson;
}

// A blank line (trim() === '') at either end of a section's content is
// structure (separating the heading or the next heading from the text),
// never content (TSK-051). The leading side is always this function's own
// job: `sectionContent` never sees a leading one for content nanojira itself
// writes (the write path always starts right after the heading line), but
// a hand-edited file can. The trailing side looks covered by
// `sectionContent`'s own `normalizeSectionContent`, which strips trailing
// *newline characters* -- but that only removes fully empty trailing
// lines, not a final line that is whitespace-only without a newline after
// it (the line directly above the next heading, in a hand-edited file).
// That line still reaches here with its spaces intact, so the trailing
// loop below is live, not dead -- confirmed by AC-73 section L.
function trimBlankLines(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/**
 * `description`/`acceptance` (TSK-051, show/list `--json`, scans TSK-014):
 * appended to an already-built `entryJson` result, never produced by
 * `entryJson` itself, so a write command's own `entry` (never asked for
 * these) stays exactly as it was. `description` is the Description
 * section's text trimmed of leading/trailing blank lines -- `null` when
 * the section has no heading at all, `""` when it has one with nothing (or
 * only blank lines) under it. `acceptance` is `sectionCheckboxItems` as it
 * is -- each item's `item` is its own `check --item=<n>` number (TSK-052
 * item 1), not its position within this array -- `[]` either way the
 * section has nothing.
 */
function withBodyExtra<T extends EntryJson>(entry: T, body: string, cfg: Config): T & { description: string | null; acceptance: { text: string; checked: boolean; item: number }[] } {
  const raw = sectionContent(body, cfg.sections.description);
  const description = raw === null ? null : trimBlankLines(raw);
  const acceptance = sectionCheckboxItems(body, cfg.sections.acceptance);
  return Object.assign({}, entry, { description, acceptance });
}

// `backlogErrors` folds in error-severity findings that are not about any
// one element — an unreadable directory hiding files nanojira never even saw is
// exactly the sort of problem a caller must not read past as "0 errors"
// (DECISIONS 106 F4).
function countsOf(scope: Element[], backlogErrors = 0) {
  return {
    total: scope.length,
    errors: scope.filter(hasError).length + backlogErrors,
    incomplete: scope.filter(isIncomplete).length,
  };
}

/**
 * `open_acceptance` (§ 9, § 12a, DECISIONS 176 B): the additive result
 * field `set`/`claim` carry alongside `entry`, present exactly when this
 * call named `--status=<last>` AND that leaves `done:open_acceptance` on
 * the written element (not suppressed by `problems.ignore`) -- never
 * computed, let alone shown, for a write that didn't name the final status
 * itself, even if the element happened to already be done.
 */
function openAcceptanceExtra(el: Element, cfg: Config, isFinal: boolean): { open_acceptance: { unticked: number; total: number } } | Record<string, never> {
  if (!isFinal) return {};
  if (!elementProblems(el, cfg.problems.ignore).includes('done:open_acceptance')) return {};
  const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
  return counts ? { open_acceptance: counts } : {};
}

export { priorityWeight, elementProblems, isIncomplete, isReady, hasOpenChild, compareElements, entryJson, withBodyExtra, countsOf, openAcceptanceExtra };
