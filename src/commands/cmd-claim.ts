'use strict';

// `nj claim` (§ 12 "Claims", § 12a).

import type { Flags, Element } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { checkFlags, flagString } from '../core/args.ts';
import type { Entry } from '../core/claims.ts';
import { rollback, transition } from '../core/claims.ts';
import { context, requireTargetFlagSyntax, resolveTarget, requireWritable, requireActive } from '../core/context.ts';
import { entryJson, elementProblems } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { compareGuard, mirrorWrite, nowIso, renderElement } from '../core/store.ts';

const STABLE_HINT = 'the element changed in parallel — nj claim takes no --force; retry once it is stable';

function cmdClaim(flags: Flags) {
  checkFlags(flags, ['status'], new Set(['json', 'id', 'file', 'as', 'steal']), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true) as string;

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'claim');

  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, `Known statuses: ${ctx.cfg.statuses.join(', ')}`);
  }

  const steal = flagString(flags, 'steal');
  const ts = nowIso();

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
    compareGuard(el, false, ctx.backlog, STABLE_HINT);
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
  refreshStatus(ctx.backlog, ctx.cfg, ctx);

  const claim = { by: name, since: ts };
  if (json) {
    const entry = entryJson(fresh, ctx.backlog);
    out(JSON.stringify(Object.assign(
      { ok: true, id: fresh.id, changed, entry, _problems: entry._problems, claim },
      stolenFrom !== undefined ? { stolen_from: stolenFrom } : {},
      previousAssignee !== undefined ? { previous_assignee: previousAssignee } : {},
    ), null, 2));
  } else {
    out(`${fresh.id} claimed by ${name}${status !== undefined ? ` (status: ${status})` : ''}`);
    for (const code of elementProblems(fresh)) out(`⚠ ${fresh.id}: ${code}`);
  }
  return 0;
}

export { cmdClaim };
