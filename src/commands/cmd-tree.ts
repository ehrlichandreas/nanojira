'use strict';

// `nj tree`.

import type { Flags, Element } from '../core/types.ts';

import { checkFlags, flagString } from '../core/args.ts';
import { context } from '../core/context.ts';
import { compareElements, entryJson, countsOf } from '../core/derive.ts';
import { childMap } from '../core/load.ts';
import { fail, out, problemSuffix } from '../core/output.ts';

function cmdTree(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'all', 'id']), false);
  const ctx = context(flags);
  const all = flags.has('all');
  const scope = ctx.elements.filter((e: Element) => all || !e.archived);
  const id = flagString(flags, 'id');

  let roots: Element[];
  if (id !== undefined) {
    const el = scope.find((e: Element) => e.id === id);
    if (!el) return fail('not_found', `no element with id '${id}'`);
    roots = [el];
  } else {
    const ids = new Set(scope.map((e: Element) => e.id));
    roots = scope.filter((e: Element) => e.parent === null || !ids.has(e.parent)).sort(compareElements);
  }

  const ordered: { el: Element; depth: number }[] = [];
  const visited = new Set();
  const byParent = childMap(scope);
  for (const a of byParent.values()) a.sort(compareElements);
  const walk = (el: Element, depth: number) => {
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
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope), entries: ordered.map((o) => entryJson(o.el, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (ordered.length === 0) { out('(empty backlog)'); return 0; }
  for (const { el, depth } of ordered) {
    out(`${'  '.repeat(depth)}${el.id}  ${el.status.padEnd(8)} ${el.title}${el.archived ? ' (archived)' : ''}${problemSuffix(el)}`);
  }
  return 0;
}

export { cmdTree };
