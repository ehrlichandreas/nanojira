'use strict';

// `nanojira next` (§ 12b, DECISIONS 154): one call that picks the highest-ranked
// `--ready` element and claims it, closing the gap where a separate
// `list --ready` and `claim` let two callers read the same top candidate
// before either claims it. Built on `claim`'s own CAS (`claimOne`) — never
// a second implementation of it.

import type { Flags } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { ENTRY_FIELDS } from '../core/constants.ts';
import { context, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { isReady, hasOpenChild } from '../core/derive.ts';
import { Fail, fail, out } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { parseOutputOpts, trimResult } from '../core/result-opts.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { nowIso } from '../core/store.ts';
import { valueHint } from '../core/suggest.ts';
import { withFiles } from '../core/touched.ts';
import { applyFilters, availableToActor } from './cmd-list.ts';
import { claimOne } from './cmd-claim.ts';
import { requireChildrenDone } from './cmd-set.ts';

function cmdNext(flags: Flags) {
  checkCommandFlags(flags, 'next');
  const json = flags.has('json');
  // As on `claim`, whose shape `next` returns (DECISIONS 229): checked
  // before anything is claimed.
  const opts = parseOutputOpts(flags, json, ENTRY_FIELDS);
  const name = resolveActingName(flags, true) as string;

  const ctx = context(flags);
  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
  }

  // `--status` is next's own write target (as on `claim`), not a filter —
  // `list`'s own `--status` filter would otherwise collide with it. The
  // candidate list is read exactly once (§ 12b): never re-scanned mid-loop.
  const filterFlags = new Map(flags);
  filterFlags.delete('status');
  // D156: `next` takes leaf work only. A --ready element with at least one
  // OPEN child (neither done nor archived) is never a candidate, whatever
  // type it is — a childless epic, or one whose children are all done, is
  // unaffected. This is `next`'s own extra filter, applied after `list`'s
  // own `--ready`/filters; `list --ready` and bare `nanojira` are unchanged.
  //
  // D158 PA-5: an `assignee` naming someone other than the acting name is
  // also disqualifying, on by default — not an option. This composes with
  // the `--assignee=<v>` filter `applyFilters` already applied above: with
  // `--assignee=` (empty) or `--assignee=<name>` the two conditions agree;
  // with any other value they can never both hold, so the result is
  // `none_ready`, not a special case.
  const candidates = applyFilters(ctx.elements, filterFlags, ctx.cfg)
    .filter((e) => isReady(e, ctx.cfg, ctx.backlog) && availableToActor(ctx.backlog, e.id, name) && !hasOpenChild(e)
      && (e.assignee === '' || e.assignee === name));

  const skipped: string[] = [];
  for (const candidate of candidates) {
    const el = resolveById(ctx, candidate.id, true);
    requireWritable(el);
    requireActive(ctx, el, 'claim');
    // Open children never reach here (D156 above), but an unreadable
    // directory can hide one, so the parent rule runs as on `claim`.
    if (status === 'done') requireChildrenDone(ctx, el, false, 'next');

    let single;
    try {
      single = claimOne(ctx, el, name, status, undefined, nowIso());
    } catch (e: any) {
      // Only a lost race moves on to the next candidate (§ 12b step 2);
      // every other claim failure is surfaced immediately (step 3).
      if (e instanceof Fail && e.code === 'refused:claimed') { skipped.push(el.id); continue; }
      throw e;
    }

    refreshStatus(ctx.backlog, ctx.cfg, ctx);
    refreshTags(ctx.backlog, ctx.cfg, ctx);
    const built = withFiles(Object.assign({ ok: (single as any).ok, id: el.id }, single, { skipped }), ctx.backlog);
    recordChange(ctx.backlog, () => built);
    if (json) {
      out(JSON.stringify(opts.quiet || opts.fields !== undefined ? trimResult(built, opts) : built, null, 2));
    } else {
      out(`${el.id} claimed by ${name}${status !== undefined ? ` (status: ${status})` : ''}`);
      for (const code of (single as any)._problems as string[]) out(`⚠ ${el.id}: ${code}`);
    }
    return 0;
  }

  fail('none_ready', `no --ready candidate is available for ${name}`,
    skipped.length > 0 ? `${skipped.length} candidate${skipped.length === 1 ? '' : 's'} tried, all lost the race` : undefined);
}

export { cmdNext };
