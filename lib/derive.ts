'use strict';

// Derived views over loaded elements: problems, readiness, ordering, JSON entries.

import type { Element, Config, EntryJson } from './types.ts';

import { PRIORITY_WEIGHT, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL } from './constants.ts';

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
function entryJson(el: Element): EntryJson {
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
  e._problems = elementProblems(el);
  return e as EntryJson;
}

function countsOf(scope: Element[]) {
  return {
    total: scope.length,
    errors: scope.filter(hasError).length,
    incomplete: scope.filter(isIncomplete).length,
  };
}

export { elementProblems, isIncomplete, isReady, compareElements, entryJson, countsOf };
