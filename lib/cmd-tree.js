'use strict';

// `nj tree`.

const { checkFlags, flagString } = require('./args.js');
const { context } = require('./context.js');
const { compareElements, entryJson, countsOf } = require('./derive.js');
const { childMap } = require('./load.js');
const { fail, out, problemSuffix } = require('./output.js');

function cmdTree(flags) {
  checkFlags(flags, [], new Set(['json', 'all', 'id']), false);
  const ctx = context();
  const all = flags.has('all');
  const scope = ctx.elements.filter((e) => all || !e.archived);
  const id = flagString(flags, 'id');

  let roots;
  if (id !== undefined) {
    const el = scope.find((e) => e.id === id);
    if (!el) fail('not_found', `no element with id '${id}'`);
    roots = [el];
  } else {
    const ids = new Set(scope.map((e) => e.id));
    roots = scope.filter((e) => e.parent === null || !ids.has(e.parent)).sort(compareElements);
  }

  const ordered = [];
  const visited = new Set();
  const byParent = childMap(scope);
  for (const a of byParent.values()) a.sort(compareElements);
  const walk = (el, depth) => {
    if (visited.has(el.id)) return;
    visited.add(el.id);
    ordered.push({ el, depth });
    const kids = byParent.get(el.id) || [];
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Elements inside a parent cycle are reachable from no root — surface them as
  // roots of their own rather than hiding them (§ 7, `parent:cycle`).
  if (id === undefined) {
    for (const el of scope.slice().sort(compareElements)) walk(el, 0);
  }

  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope), entries: ordered.map((o) => entryJson(o.el)) }, null, 2));
    return 0;
  }
  if (ordered.length === 0) { out('(empty backlog)'); return 0; }
  for (const { el, depth } of ordered) {
    out(`${'  '.repeat(depth)}${el.id}  ${el.status.padEnd(8)} ${el.title}${el.archived ? ' (archived)' : ''}${problemSuffix(el)}`);
  }
  return 0;
}

module.exports = { cmdTree };
