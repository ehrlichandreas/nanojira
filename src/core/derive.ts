'use strict';

// Derived views over loaded elements: problems, readiness, ordering, JSON entries.

import type { Element, Config, EntryJson } from './types.ts';

import { readClaim, isClaimStale } from './claims.ts';
import { PRIORITY_WEIGHT, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL } from './constants.ts';
import { nowMs } from './store.ts';

// -------------------------------------------------------------- derivations

function elementProblems(el: Element) {
  return Array.from(el.problems).filter((c) => !BACKLOG_LEVEL.has(c)).sort();
}

function hasError(el: Element) {
  return elementProblems(el).some((c) => SEVERITY[c] === 'error');
}

function isIncomplete(el: Element) {
  if (hasError(el)) return false;
  return elementProblems(el).some((c) => c.startsWith('incomplete:'));
}

function isReady(el: Element, cfg: Config) {
  if (el.archived) return false;
  if (el.status !== cfg.statuses[0]) return false;
  for (const c of el.problems) if (BLOCKS_READY.has(c)) return false;
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
 * DECISIONS 158 EV-4, bare `nj`'s own "Ready to work"): true when `el` has
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
  const probs = elementProblems(el);
  if (claim && isClaimStale(claim.since, cfg.claims.staleAfterHours, nowMs())) probs.push('claim:stale');
  e._problems = probs.sort();
  e._claim = claim;
  return e as EntryJson;
}

// `backlogErrors` folds in error-severity findings that are not about any
// one element — an unreadable directory hiding files nj never even saw is
// exactly the sort of problem a caller must not read past as "0 errors"
// (DECISIONS 106 F4).
function countsOf(scope: Element[], backlogErrors = 0) {
  return {
    total: scope.length,
    errors: scope.filter(hasError).length + backlogErrors,
    incomplete: scope.filter(isIncomplete).length,
  };
}

export { elementProblems, isIncomplete, isReady, hasOpenChild, compareElements, entryJson, countsOf };
