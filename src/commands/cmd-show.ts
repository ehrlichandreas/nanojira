'use strict';

// `nj show`.

import type { Flags, Element, Config } from '../core/types.ts';

import { checkFlags } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { context, resolveTarget } from '../core/context.ts';
import { elementProblems, compareElements, entryJson, countsOf } from '../core/derive.ts';
import { out } from '../core/output.ts';

function cmdShow(flags: Flags) {
  checkFlags(flags, [], new Set(['json', ...cliFieldNames('show')]), false);
  const ctx = context(flags);
  const el = resolveTarget(ctx, flags, false);
  const scope = ctx.elements;
  // Reads show every file claiming the id, each marked duplicate_id (§ 9).
  const shown = flags.has('file') ? [el] : ctx.elements.filter((e: Element) => e.id === el.id).sort(compareElements);
  if (flags.has('json')) {
    const entries = shown.map((e) => entryJson(e, ctx.backlog, ctx.cfg));
    // `entry` (DECISIONS 171 C, § 9): additive, identical to entries[0],
    // present exactly when `entries` has exactly one element -- never for a
    // duplicate_id target (two entries). `list`/`find` never carry it.
    out(JSON.stringify(Object.assign(
      { backlog: ctx.backlog, counts: countsOf(scope.filter((e: Element) => !e.archived)), entries },
      entries.length === 1 ? { entry: entries[0] } : {},
    ), null, 2));
    return 0;
  }
  if (shown.length > 1) {
    out(`⚠ ${el.id} is carried by ${shown.length} files (duplicate_id) — showing all of them.`);
    out('');
  }
  for (const one of shown) {
    if (shown.length > 1) out(`--- ${one.file} ---`);
    showOne(one, ctx.cfg);
    if (one !== shown[shown.length - 1]) out('');
  }
  return 0;
}

function showOne(el: Element, cfg: Config) {
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
  const probs = elementProblems(el, cfg.problems.ignore);
  out(`  problems  ${probs.length ? probs.join(' ') : '(none)'}`);
  out('');
  process.stdout.write(el.body.replace(/^\n/, ''));
  if (el.body !== '' && !el.body.endsWith('\n')) out('');
}

export { cmdShow };
