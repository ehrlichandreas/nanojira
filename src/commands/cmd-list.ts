'use strict';

// `nanojira list`.

import type { Flags, Element, Config } from '../core/types.ts';

import { actingNameForRead } from '../core/actor.ts';
import { checkFlags, flagString } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { readClaim } from '../core/claims.ts';
import { TYPES } from '../core/constants.ts';
import { context } from '../core/context.ts';
import { elementProblems, isIncomplete, isReady, compareElements, entryJson, countsOf } from '../core/derive.ts';
import { fail, out, printEntryLine } from '../core/output.ts';
import { valueHint } from '../core/suggest.ts';

// --ready condition 5 (§ 9, § 12 "Claims"): unclaimed, or claimed by the
// acting name. `list` has no `--as`; an invalid or absent `NJ_AUTHOR` is no
// name (reads never fail on it) -- an element claimed by someone else is
// then excluded the same as if the caller claimed nothing.
function availableToActor(backlog: string, id: string, name: string | null): boolean {
  const claim = readClaim(backlog, id);
  return claim === null || claim.by === name;
}

// Shared with `nanojira find` (§ 9a), which combines the same filters as an AND
// with its own text-match predicate.
function applyFilters(elements: Element[], flags: Flags, cfg: Config) {
  const all = flags.has('all');
  let list = elements.filter((e) => all || !e.archived);
  // A typo'd filter must be an error, never a silently empty result (§ 9).
  const status = flagString(flags, 'status');
  if (status !== undefined) {
    if (!cfg.statuses.includes(status)) {
      fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, cfg.statuses));
    }
    list = list.filter((e) => e.status === status);
  }
  const type = flagString(flags, 'type');
  if (type !== undefined) {
    if (!TYPES.includes(type)) fail('invalid_value', `unknown type '${type}'`, valueHint('type', type, TYPES));
    list = list.filter((e) => e.type === type);
  }
  const tag = flagString(flags, 'tag');
  if (tag !== undefined) list = list.filter((e) => e.tags.includes(tag));
  const parent = flagString(flags, 'parent');
  if (parent !== undefined) {
    if (!elements.some((e) => e.id === parent)) {
      fail('not_found', `--parent '${parent}' does not exist`, 'filters are validated so a typo never looks like an empty backlog');
    }
    list = list.filter((e) => e.parent === parent);
  }
  const assignee = flagString(flags, 'assignee');
  if (assignee !== undefined) list = list.filter((e) => e.assignee === assignee);
  return list.sort(compareElements);
}

function cmdList(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'ready', 'all', ...cliFieldNames('list')]), false);
  const ctx = context(flags);
  const scope = ctx.elements.filter((e: Element) => flags.has('all') || !e.archived);
  const filtered = applyFilters(ctx.elements, flags, ctx.cfg);

  if (flags.has('ready')) {
    const actor = actingNameForRead();
    const ready = filtered.filter((e) => isReady(e, ctx.cfg) && availableToActor(ctx.backlog, e.id, actor));
    const blocked = filtered.filter((e) => !isReady(e, ctx.cfg) && e.status === ctx.cfg.statuses[0] && isIncomplete(e));
    if (flags.has('json')) {
      out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: ready.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
      return 0;
    }
    out('Ready to work:');
    if (ready.length === 0) out('  (none)');
    for (const e of ready) out(`  ${e.id}  ${e.title}`);
    if (blocked.length > 0) {
      out('');
      out('Complete first:');
      for (const e of blocked) {
        out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c: string) => c.startsWith('incomplete:')).join(' ')}`);
      }
    }
    return 0;
  }

  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: filtered.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (filtered.length === 0) { out('(no matching elements)'); return 0; }
  for (const e of filtered) printEntryLine(e, ctx.cfg);
  return 0;
}

export { cmdList, applyFilters, availableToActor };
