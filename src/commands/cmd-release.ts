'use strict';

// `nanojira release` (§ 12 "Claims", § 12a).

import type { Flags, Element, Context } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import type { Entry } from '../core/claims.ts';
import { requireTransitionable, transition } from '../core/claims.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { fail, out } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { parseOutputOpts, trimResult } from '../core/result-opts.ts';
import { nowIso } from '../core/store.ts';

/** The release CAS loop for one element — never touches the file (§ 12a), so nothing here needs a catchable write; the single and batch paths share it unchanged. */
function releaseOne(ctx: Context, el: Element, name: string, ts: string) {
  const decide = (h: Entry | null) => {
    const held = h && h.kind === 'claimed' ? h.name : null;
    if (held === null) return { terminal: true as const }; // unclaimed: nothing to do
    if (held !== name) return { terminal: true as const, holder: held };
    return { append: { kind: 'released' as const, name } };
  };

  const t = transition(ctx.backlog, el.id, ts, decide);
  if (!t.ok) {
    if (t.terminal === 'changed_in_parallel') {
      fail('changed_in_parallel', `${el.id}: too many concurrent release attempts, please retry`);
    }
    if (t.terminal === 'refused') {
      fail('refused:claimed', `${el.id} is claimed by ${t.holder} — refused`, 'only the holder may release it');
    }
  }

  const changed = t.ok ? ['claim'] : [];
  const entry = entryJson(el, ctx.backlog, ctx.cfg);
  return { ok: true, changed, entry, _problems: entry._problems, claim: null };
}

function cmdRelease(flags: Flags) {
  checkCommandFlags(flags, 'release');
  const json = flags.has('json');
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true) as string;

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const result = runBatch<Element, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireTransitionable(ctx.backlog, el.id);
        return el;
      },
      (el) => releaseOne(ctx, el, name, nowIso()),
    );
    const results = opts.quiet || opts.fields !== undefined
      ? result.results.map((r: any) => (r.ok ? trimResult(r, opts) : r))
      : result.results;
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results }));
    const wrapper = { ok: result.ok, results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else {
      for (const r of result.results as any[]) {
        out(r.ok === false ? `${r.id}: Error: ${r.error}` : (r.changed || []).length > 0 ? `${r.id} released by ${name}` : `${r.id} is already unclaimed`);
      }
    }
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  const ts = nowIso();
  const single = releaseOne(ctx, el, name, ts);

  // Field order: `ok` then `id` — see cmd-claim.ts's cmdClaim for why both
  // keys are pre-seeded.
  const built = Object.assign({ ok: (single as any).ok, id: el.id }, single);
  recordChange(ctx.backlog, () => built);
  if (json) {
    const final = opts.quiet || opts.fields !== undefined ? trimResult(built, opts) : built;
    out(JSON.stringify(final, null, 2));
  } else {
    out(single.changed.length > 0 ? `${el.id} released by ${name}` : `${el.id} is already unclaimed`);
  }
  return 0;
}

export { cmdRelease };
