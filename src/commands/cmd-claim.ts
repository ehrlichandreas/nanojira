'use strict';

// `nj claim` (§ 12 "Claims", § 12a).

import type { Flags, Element, Context } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { checkFlags, flagString } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import type { Entry } from '../core/claims.ts';
import { rollback, transition } from '../core/claims.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { compareGuard, mirrorWrite, nowIso, renderElement } from '../core/store.ts';
import { valueHint } from '../core/suggest.ts';

const STABLE_HINT = 'the element changed in parallel — nj claim takes no --force; retry once it is stable';

/** The claim CAS loop, mirror write and rollback for one element — already catchable (mirrorWrite), so the single and batch paths share it unchanged. */
function claimOne(ctx: Context, el: Element, name: string, status: string | undefined, steal: string | undefined, ts: string) {
  const decide = (h: Entry | null) => {
    const held = h && h.kind === 'claimed' ? h.name : null;
    if (steal !== undefined) {
      // unclaimed -> a plain claim of N; claimed H -> succeeds only from H.
      if (held !== null && held !== steal) return { terminal: true as const, holder: held };
      return { append: { kind: 'claimed' as const, name } };
    }
    // unclaimed, or already held by N (re-assert via a real CAS append,
    // never a bare read — docs/review/claim-protocol.md § 1.4).
    if (held !== null && held !== name) return { terminal: true as const, holder: held };
    return { append: { kind: 'claimed' as const, name } };
  };

  const t = transition(ctx.backlog, el.id, ts, decide);
  if (!t.ok) {
    if (t.terminal === 'changed_in_parallel') {
      fail('changed_in_parallel', `${el.id}: too many concurrent claim attempts, please retry`);
    }
    fail('refused:claimed', `${el.id} is already claimed by ${t.holder} — refused`, 'use --steal=<holder> to take it over');
  }

  const reassert = t.base !== null && t.base.kind === 'claimed' && t.base.name === name;
  const landedSteal = !reassert && steal !== undefined && t.base !== null && t.base.kind === 'claimed';
  const stolenFrom = landedSteal ? (t.base as Entry).name : undefined;
  const previousAssignee = el.assignee !== '' && el.assignee !== name ? el.assignee : undefined;

  const changed: string[] = [];
  if (el.assignee !== name) changed.push('assignee');
  if (status !== undefined && status !== el.status) changed.push('status');

  const overrides = new Map<string, string | string[] | undefined>([['assignee', name], ['updated', ts]]);
  if (status !== undefined) overrides.set('status', status);

  try {
    compareGuard(el, false, ctx.backlog, STABLE_HINT, true);
    mirrorWrite(el.file, renderElement(el, overrides, undefined));
  } catch (e) {
    // A landed steal is never rolled back (§ 12a): reported as
    // claim:mismatch by `doctor`, not undone. A plain claim or a
    // re-assertion restores what this invocation read.
    if (!landedSteal) {
      const restore = reassert ? { kind: 'claimed' as const, name } : { kind: 'released' as const, name };
      rollback(ctx.backlog, el.id, t.gen, restore.kind, restore.name, ts);
    }
    throw e;
  }

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg.layout);
  const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
  const claim = { by: name, since: ts };
  return Object.assign(
    { ok: true, changed, entry, _problems: entry._problems, claim },
    stolenFrom !== undefined ? { stolen_from: stolenFrom } : {},
    previousAssignee !== undefined ? { previous_assignee: previousAssignee } : {},
  );
}

function cmdClaim(flags: Flags) {
  // `status` stays in `allowedFields`, not `commandControls` (as before
  // this was moved onto the shared table): the original "Known fields:"
  // error text named only `status`, never the other claim flags.
  checkFlags(flags, ['status'], new Set(['json', ...cliFieldNames('claim').filter((f) => f !== 'status')]), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true) as string;

  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
  }
  const steal = flagString(flags, 'steal');

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const result = runBatch<Element, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(el, 'claim');
        return el;
      },
      (el) => claimOne(ctx, el, name, status, steal, nowIso()),
    );
    if (result.anyWritten) refreshStatus(ctx.backlog, ctx.cfg, ctx);
    const wrapper = { ok: result.ok, results: result.results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} claimed by ${name}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'claim');

  const ts = nowIso();
  const single = claimOne(ctx, el, name, status, steal, ts);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);

  if (json) {
    // Field order: `ok` then `id`, matching every other single-ID JSON
    // shape (rm, set, note, check) — Object.assign keeps a key already in
    // the target at its target position, so pre-seeding both here (not
    // just `id`) is what keeps `ok` first.
    out(JSON.stringify(Object.assign({ ok: (single as any).ok, id: el.id }, single), null, 2));
  } else {
    out(`${el.id} claimed by ${name}${status !== undefined ? ` (status: ${status})` : ''}`);
    for (const code of (single as any)._problems as string[]) out(`⚠ ${el.id}: ${code}`);
  }
  return 0;
}

export { cmdClaim, claimOne };
