'use strict';

// Derived views over loaded elements: problems, readiness, ordering, JSON entries.

const { PRIORITY_WEIGHT, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL } = require('./constants.js');

// -------------------------------------------------------------- derivations

function elementProblems(el) {
  return Array.from(el.problems).filter((c) => !BACKLOG_LEVEL.has(c)).sort();
}

function hasError(el) {
  return elementProblems(el).some((c) => SEVERITY[c] === 'error');
}

function isIncomplete(el) {
  if (hasError(el)) return false;
  return elementProblems(el).some((c) => c.startsWith('incomplete:'));
}

function isReady(el, cfg) {
  if (el.archived) return false;
  if (el.status !== cfg.statuses[0]) return false;
  for (const c of el.problems) if (BLOCKS_READY.has(c)) return false;
  for (const dep of el.depends_on) {
    const t = el.byId.get(dep);
    if (!t) return false;
    if (t.archived) continue;
    if (t.status !== 'done') return false;
    if (t.problems.has('done:open_children')) return false;
  }
  return true;
}

function idSortKey(id) {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(id);
  return m ? [m[1], parseInt(m[2], 10), ''] : ['￿', 0, id];
}

function priorityWeight(p) {
  const w = PRIORITY_WEIGHT[p];
  return w === undefined ? PRIORITY_WEIGHT.normal : w;
}

function compareElements(a, b) {
  const w = priorityWeight(b.priority) - priorityWeight(a.priority);
  if (w !== 0) return w;
  const ka = idSortKey(a.id);
  const kb = idSortKey(b.id);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

function entryJson(el) {
  const e = { id: el.id, type: el.type };
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
  return e;
}

function countsOf(scope) {
  return {
    total: scope.length,
    errors: scope.filter(hasError).length,
    incomplete: scope.filter(isIncomplete).length,
  };
}

module.exports = { elementProblems, isIncomplete, isReady, compareElements, entryJson, countsOf };
