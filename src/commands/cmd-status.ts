'use strict';

// `nanojira` without a command: the status overview.

import type { Flags } from '../core/types.ts';

import { checkCommandFlags } from '../core/cli-flags.ts';
import { context } from '../core/context.ts';
import { elementProblems, isIncomplete, isReady, hasOpenChild, compareElements, entryJson, countsOf } from '../core/derive.ts';
import { out } from '../core/output.ts';

function cmdStatus(flags: Flags) {
  checkCommandFlags(flags, 'status');
  const ctx = context(flags);
  const scope = ctx.elements.filter((e) => !e.archived);
  const counts = countsOf(scope, ctx.scan.unreadable.length);
  // D158 EV-4: bare `nanojira`'s own "Ready to work" applies the D156 leaf rule
  // (reused, not reimplemented) — an element with an open child is left
  // out here, in favor of that child if it is itself ready. `list --ready`
  // (cmd-list.ts) does not call this: it stays a pure readiness filter.
  const ready = scope.filter((e) => isReady(e, ctx.cfg) && !hasOpenChild(e)).sort(compareElements).slice(0, 5);
  const incomplete = scope.filter(isIncomplete).sort(compareElements).slice(0, 5);

  if (flags.has('json')) {
    out(JSON.stringify({
      backlog: ctx.backlog, counts,
      ready: ready.map((e) => entryJson(e, ctx.backlog, ctx.cfg)), incomplete: incomplete.map((e) => entryJson(e, ctx.backlog, ctx.cfg)),
    }, null, 2));
    return 0;
  }
  out(`backlog: ${ctx.backlog}`);
  out(`${counts.total} entries · ${counts.errors} error${counts.errors === 1 ? '' : 's'} · ${counts.incomplete} incomplete`);
  out('');
  out('Ready to work:');
  if (ready.length === 0) out('  (none)');
  for (const e of ready) out(`  ${e.id}  ${e.title}`);
  if (incomplete.length > 0) {
    out('');
    out('Complete first:');
    for (const e of incomplete) {
      out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c: string) => c.startsWith('incomplete:')).join(' ')}`);
    }
  }
  if (counts.errors > 0) {
    out('');
    out(`${counts.errors} element${counts.errors === 1 ? '' : 's'} with errors — run \`nanojira doctor\`.`);
  }
  return 0;
}

export { cmdStatus };
