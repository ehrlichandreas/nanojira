'use strict';

// `nj show`.

import type { Flags, Element } from '../core/types.ts';

import { checkFlags } from '../core/args.ts';
import { context, resolveTarget } from '../core/context.ts';
import { elementProblems, compareElements, entryJson, countsOf } from '../core/derive.ts';
import { out } from '../core/output.ts';

function cmdShow(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file']), false);
  const ctx = context(flags);
  const el = resolveTarget(ctx, flags, false);
  const scope = ctx.elements;
  // Reads show every file claiming the id, each marked duplicate_id (§ 9).
  const shown = flags.has('file') ? [el] : ctx.elements.filter((e: Element) => e.id === el.id).sort(compareElements);
  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope.filter((e: Element) => !e.archived)), entries: shown.map(entryJson) }, null, 2));
    return 0;
  }
  if (shown.length > 1) {
    out(`⚠ ${el.id} is carried by ${shown.length} files (duplicate_id) — showing all of them.`);
    out('');
  }
  for (const one of shown) {
    if (shown.length > 1) out(`--- ${one.file} ---`);
    showOne(one);
    if (one !== shown[shown.length - 1]) out('');
  }
  return 0;
}

function showOne(el: Element) {
  out(`${el.id}  ${el.title}`);
  out(`  type      ${el.type}`);
  if (el.parent) out(`  parent    ${el.parent}`);
  out(`  status    ${el.status}`);
  out(`  priority  ${el.priority}`);
  if (el.assignee) out(`  assignee  ${el.assignee}`);
  if (el.tags.length) out(`  tags      ${el.tags.join(', ')}`);
  if (el.depends_on.length) out(`  depends   ${el.depends_on.join(', ')}`);
  out(`  created   ${el.created}`);
  out(`  updated   ${el.updated}`);
  if (el.archivedAt) out(`  archived  ${el.archivedAt}`);
  out(`  file      ${el.file}`);
  const probs = elementProblems(el);
  out(`  problems  ${probs.length ? probs.join(' ') : '(none)'}`);
  out('');
  process.stdout.write(el.body.replace(/^\n/, ''));
  if (el.body !== '' && !el.body.endsWith('\n')) out('');
}

export { cmdShow };
