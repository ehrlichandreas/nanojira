'use strict';

// `nanojira claim` (§ 12 "Claims", § 12a).

import type { Flags, Element, Context } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import type { Entry } from '../core/claims.ts';
import { rollback, transition, releaseUnconditional, undoRelease, highestEntry, claimsDir } from '../core/claims.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson, openAcceptanceExtra } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { parseOutputOpts, trimResult } from '../core/result-opts.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { compareGuard, mirrorWrite, nowIso, renderElement } from '../core/store.ts';
import { valueHint } from '../core/suggest.ts';

const STABLE_HINT = 'the element changed in parallel — nanojira claim takes no --force; retry once it is stable';

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

  // Final status releases the claim (§ 12a, DECISIONS 171 B): `claim`/`next
  // --status=<last>` release the very claim this call just made, in the
  // same call -- attempted before the guarded write, same order as the
  // claim transition itself.
  const isFinalStatus = status !== undefined && status === ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
  const released = isFinalStatus ? releaseUnconditional(ctx.backlog, el.id, ts) : undefined;

  try {
    compareGuard(el, false, ctx.backlog, STABLE_HINT, true);
    mirrorWrite(el.file, renderElement(el, overrides, undefined));
  } catch (e) {
    if (released !== undefined) undoRelease(ctx.backlog, el.id, released.holder, ts);
    // A landed steal is never rolled back (§ 12a): reported as
    // claim:mismatch by `doctor`, not undone. A plain claim or a
    // re-assertion restores what this invocation read.
    if (!landedSteal) {
      const h = highestEntry(claimsDir(ctx.backlog, el.id));
      const restore = reassert ? { kind: 'claimed' as const, name } : { kind: 'released' as const, name };
      rollback(ctx.backlog, el.id, h ? h.gen : 0, restore.kind, restore.name, ts);
    }
    throw e;
  }

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
  const claim = released !== undefined ? null : { by: name, since: ts };
  return Object.assign(
    { ok: true, changed, entry, _problems: entry._problems, claim },
    stolenFrom !== undefined ? { stolen_from: stolenFrom } : {},
    previousAssignee !== undefined ? { previous_assignee: previousAssignee } : {},
    released !== undefined ? { released: released.holder } : {},
    openAcceptanceExtra(fresh, ctx.cfg, isFinalStatus),
  );
}

function cmdClaim(flags: Flags) {
  checkCommandFlags(flags, 'claim');
  const json = flags.has('json');
  const opts = parseOutputOpts(flags, json);
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
    if (result.anyWritten) { refreshStatus(ctx.backlog, ctx.cfg, ctx); refreshTags(ctx.backlog, ctx.cfg, ctx); }
    const results = opts.quiet || opts.fields !== undefined
      ? result.results.map((r: any) => (r.ok ? trimResult(r, opts) : r))
      : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
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
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  // Field order: `ok` then `id`, matching every other single-ID JSON
  // shape (rm, set, note, check) — Object.assign keeps a key already in
  // the target at its target position, so pre-seeding both here (not
  // just `id`) is what keeps `ok` first.
  const built = Object.assign({ ok: (single as any).ok, id: el.id }, single);
  recordChange(ctx.backlog, () => built);
  if (json) {
    const final = opts.quiet || opts.fields !== undefined ? trimResult(built, opts) : built;
    out(JSON.stringify(final, null, 2));
  } else {
    out(`${el.id} claimed by ${name}${status !== undefined ? ` (status: ${status})` : ''}`);
    for (const code of (single as any)._problems as string[]) out(`⚠ ${el.id}: ${code}`);
  }
  return 0;
}

export { cmdClaim, claimOne };
