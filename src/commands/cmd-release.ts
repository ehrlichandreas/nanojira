'use strict';

// `nanojira release` (§ 12 "Claims", § 12a).

import type { Flags, Element, Context } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import type { Entry } from '../core/claims.ts';
import { requireTransitionable, transition, undoRelease } from '../core/claims.ts';
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
import { touchedFiles, withFiles } from '../core/touched.ts';
import { requireChildrenDone } from './cmd-set.ts';

const STABLE_HINT = 'the element changed in parallel — retry once it is stable';

type Overrides = Map<string, string | string[] | undefined>;

/**
 * What `release --status=<value>` writes (§ 12a, DECISIONS 220): the status,
 * and the assignee cleared when it is the releasing name, so the element is
 * ready for someone else again (`next` skips one assigned to another name).
 * Empty when nothing would change: no write at all, as plain `release`.
 */
function statusOverrides(el: Element, name: string, status: string, ts: string): { overrides: Overrides; changed: string[] } {
  const overrides: Overrides = new Map();
  const changed: string[] = [];
  if (status !== el.status) { overrides.set('status', status); changed.push('status'); }
  if (el.assignee !== '' && el.assignee === name) { overrides.set('assignee', undefined); changed.push('assignee'); }
  if (changed.length > 0) overrides.set('updated', ts);
  return { overrides, changed };
}

/** The checks `claim --status=` makes (§ 9), before any claim entry is
 * appended: a refused call releases nothing. In a batch, run in preflight. */
function requireStatusWritable(ctx: Context, el: Element, name: string, status: string, allowOpen: boolean, ts: string): void {
  requireWritable(el);
  requireActive(ctx, el, 'release');
  if (status === 'done') requireChildrenDone(ctx, el, allowOpen, 'release');
  const { overrides } = statusOverrides(el, name, status, ts);
  if (overrides.size > 0) renderElement(el, overrides, undefined); // refused:too_large writes nothing (DECISIONS 215)
}

/** The release CAS loop for one element. Plain `release` never touches the
 * file (§ 12a); with `--status`, the guarded write follows the release and
 * a failed write undoes it, as `claim`'s mirror write does. The single and
 * batch paths share it. */
function releaseOne(ctx: Context, el: Element, name: string, status: string | undefined, ts: string) {
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
  if (status === undefined) {
    const entry = entryJson(el, ctx.backlog, ctx.cfg);
    return { ok: true, changed, entry, _problems: entry._problems, claim: null };
  }

  const write = statusOverrides(el, name, status, ts);
  if (write.changed.length > 0) {
    try {
      compareGuard(el, false, ctx.backlog, STABLE_HINT, true);
      mirrorWrite(el.file, renderElement(el, write.overrides, undefined));
    } catch (e) {
      if (t.ok) undoRelease(ctx.backlog, el.id, name, ts);
      throw e;
    }
    changed.push(...write.changed);
  }
  const fresh = write.changed.length > 0 ? loadElement(el.file, ctx.backlog, ctx.cfg) : el;
  if (fresh !== el) deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
  const isFinalStatus = status === ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
  return Object.assign(
    { ok: true, changed, entry, _problems: entry._problems, claim: null },
    openAcceptanceExtra(fresh, ctx.cfg, isFinalStatus),
  );
}

function cmdRelease(flags: Flags) {
  checkCommandFlags(flags, 'release');
  const json = flags.has('json');
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const name = resolveActingName(flags, true) as string;

  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
  }
  const allowOpen = flags.has('allow-open-children');

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const result = runBatch<Element, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        if (status !== undefined) requireStatusWritable(ctx, el, name, status, allowOpen, nowIso());
        requireTransitionable(ctx.backlog, el.id);
        return el;
      },
      (el) => releaseOne(ctx, el, name, status, nowIso()),
    );
    if (result.anyWritten && status !== undefined) { refreshStatus(ctx.backlog, ctx.cfg, ctx); refreshTags(ctx.backlog, ctx.cfg, ctx); }
    const results = opts.quiet || opts.fields !== undefined
      ? result.results.map((r: any) => (r.ok ? trimResult(r, opts) : r))
      : result.results;
    const files = touchedFiles(ctx.backlog);
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results, files }));
    const wrapper = { ok: result.ok, results, files };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else {
      for (const r of result.results as any[]) {
        out(r.ok === false ? `${r.id}: Error: ${r.error}` : releasedLine(r.id, r.changed || [], name, status));
      }
    }
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  const ts = nowIso();
  if (status !== undefined) requireStatusWritable(ctx, el, name, status, allowOpen, ts);
  const single = releaseOne(ctx, el, name, status, ts);
  if (status !== undefined && single.changed.some((c) => c !== 'claim')) {
    refreshStatus(ctx.backlog, ctx.cfg, ctx);
    refreshTags(ctx.backlog, ctx.cfg, ctx);
  }

  // Field order: `ok` then `id` — see cmd-claim.ts's cmdClaim for why both
  // keys are pre-seeded.
  const built = withFiles(Object.assign({ ok: (single as any).ok, id: el.id }, single), ctx.backlog);
  recordChange(ctx.backlog, () => built);
  if (json) {
    const final = opts.quiet || opts.fields !== undefined ? trimResult(built, opts) : built;
    out(JSON.stringify(final, null, 2));
  } else {
    out(releasedLine(el.id, single.changed, name, status));
    if (status !== undefined) for (const code of single._problems as string[]) out(`⚠ ${el.id}: ${code}`);
  }
  return 0;
}

/** The text line: plain `release` as before; with `--status`, the status
 * is named, as `claim --status=` names it. */
function releasedLine(id: string, changed: string[], name: string, status: string | undefined): string {
  if (status === undefined) return changed.length > 0 ? `${id} released by ${name}` : `${id} is already unclaimed`;
  return changed.includes('claim') ? `${id} released by ${name} (status: ${status})` : `${id} is already unclaimed (status: ${status})`;
}

export { cmdRelease };
