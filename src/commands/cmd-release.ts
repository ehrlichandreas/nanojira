'use strict';

// `nj release` (§ 12 "Claims", § 12a).

import type { Flags } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { checkFlags } from '../core/args.ts';
import type { Entry } from '../core/claims.ts';
import { transition } from '../core/claims.ts';
import { context, requireTargetFlagSyntax, resolveTarget } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { fail, out } from '../core/output.ts';
import { nowIso } from '../core/store.ts';

function cmdRelease(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file', 'as']), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true) as string;

  const el = resolveTarget(ctx, flags, true);
  const ts = nowIso();

  // `release` never touches the element file — only the claim sequence — so
  // it does not check `refused:archived`/`refused:unreadable` (§ 12a is
  // silent on both; archiving already clears the claim, and a release
  // concerns the claim directory only, never the element's own readability).
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
  if (json) {
    const entry = entryJson(el, ctx.backlog);
    out(JSON.stringify({ ok: true, id: el.id, changed, entry, _problems: entry._problems, claim: null }, null, 2));
  } else {
    out(t.ok ? `${el.id} released by ${name}` : `${el.id} is already unclaimed`);
  }
  return 0;
}

export { cmdRelease };
