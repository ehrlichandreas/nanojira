'use strict';

// `nj unarchive` (§ 11a) — the inverse of `nj archive`.

import type { Flags, Element, Context } from '../core/types.ts';

import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { removeClaimDirWholesale } from '../core/claims.ts';
import { context, resolveTarget, requireWritable, requireNoStubs } from '../core/context.ts';
import { elementProblems, entryJson } from '../core/derive.ts';
import { ownFolder, placeOf, removeEmptiedIdFolders } from '../core/layout.ts';
import { deriveGraph } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { nowIso, atomicWrite, compareGuard, planMove, runMove, renderElement } from '../core/store.ts';
import { loadElement } from '../core/load.ts';

const STABLE_HINT = 'retry once the backlog is stable — unarchive takes no --force';
const FIX_HINT = 'run `nj doctor --fix` to move the files into their places, then unarchive again';

/** Depth-first, pre-order, siblings by `id` ascending (§ 11a "Output"). */
function orderedSubtree(ctx: Context, el: Element): Element[] {
  const children: Map<string, Element[]> = new Map();
  for (const e of ctx.elements) {
    if (e.parent === null) continue;
    const a = children.get(e.parent);
    if (a) a.push(e); else children.set(e.parent, [e]);
  }
  for (const a of children.values()) a.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const out: Element[] = [el];
  const seen = new Set([el.id]);
  const walk = (cur: Element) => {
    for (const c of children.get(cur.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

interface Unit { e: Element; src: string; dir: boolean }

/**
 * One move per unit: a hierarchy epic/task that owns a folder moves as that
 * folder (one `rename`, or a D90/94 merge when the target already exists); a
 * subtask, or an epic/task with no folder of its own (loose in the archive,
 * or `type`/`flat`), moves as its lone file. A unit nested inside an already
 * selected folder unit is dropped — the folder move already carries it.
 */
function buildUnits(stillArchived: Element[], hierarchy: boolean): Unit[] {
  const units: Unit[] = [];
  const covered: string[] = [];
  for (const e of stillArchived) {
    const own = hierarchy ? ownFolder(e) : null;
    const src = own !== null ? own : e.file;
    if (covered.some((d) => src === d || src.startsWith(d + path.sep))) continue;
    units.push({ e, src, dir: own !== null });
    if (own !== null) covered.push(own);
  }
  return units;
}

function unitTarget(backlog: string, byId: Map<string, Element>, layout: Context['cfg']['layout'], u: Unit): string {
  const dirRel = placeOf(u.e, byId, layout, false) as string;
  const dir = path.join(backlog, dirRel);
  return u.dir ? dir : path.join(dir, path.basename(u.e.file));
}

function cmdUnarchive(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context(flags);
  // Backlog-wide, evaluated before the target is resolved (§ 11a, as `archive`).
  requireNoStubs(ctx, 'unarchive');
  const el = resolveTarget(ctx, flags, true);

  if (!el.archived) fail('refused:not_archived', `${el.id} is not archived — unarchive is refused`);
  if (el.parent !== null) {
    const parentEl = ctx.elements.find((e: Element) => e.id === el.parent);
    if (parentEl && parentEl.archived) {
      fail('refused:parent_archived', `${el.id}'s parent '${el.parent}' is archived — unarchive it instead; its archived subtree comes with it`);
    }
  }

  const full = orderedSubtree(ctx, el);
  const stillArchived = full.filter((e: Element) => e.archived);
  for (const e of stillArchived) requireWritable(e);

  const layout = ctx.cfg.layout;
  const hierarchy = layout.group === 'hierarchy';
  const byId: Map<string, Element> = new Map();
  for (const e of ctx.elements) if (!byId.has(e.id)) byId.set(e.id, e);

  const refuse = (why: string): never => fail('refused:misplaced', `${el.id} cannot be unarchived — ${why}; nothing was moved`, FIX_HINT);

  if (hierarchy && placeOf(el, byId, layout, false) === null) {
    refuse(`its parent chain cannot be resolved`);
  }

  const units = buildUnits(stillArchived, hierarchy);

  if (hierarchy) {
    for (const u of units) {
      if (!u.dir) continue;
      const prefix = u.src + path.sep;
      const foreign = ctx.elements.filter((x: Element) => x.file.startsWith(prefix) && !full.includes(x));
      if (foreign.length > 0) {
        refuse(`${u.src} also holds files of other elements: ${foreign.map((f: Element) => f.id).join(', ')}`);
      }
    }
  }

  const plans = units.map((u) => ({ u, plan: planMove(u.src, unitTarget(ctx.backlog, byId, layout, u)) }));
  for (const { plan } of plans) {
    if (plan.conflicts.length > 0) {
      fail('exists', `${plan.conflicts[0]} already exists — refusing to overwrite; nothing was moved`,
        `move or delete it, then unarchive again`);
    }
  }

  // A leftover orphaned claim directory (a straggler's append during a
  // partially-cleaned archive) is removed wholesale, the same as
  // `archive`/`rm`, now that unarchive has decided to proceed — after every
  // refusal above, while the element is still archived, before the first
  // write (§ 12a, DECISIONS 115 P-6).
  for (const e of stillArchived) removeClaimDirWholesale(ctx.backlog, e.id);

  const ts = nowIso();
  for (const e of stillArchived) {
    compareGuard(e, false, ctx.backlog, STABLE_HINT);
    atomicWrite(e.file, renderElement(e, new Map([['archived', undefined], ['updated', ts]]), undefined));
  }

  const emptiedFrom: Set<string> = new Set();
  for (const { u, plan } of plans) {
    runMove(plan);
    emptiedFrom.add(path.dirname(u.src));
  }
  removeEmptiedIdFolders(ctx.backlog, emptiedFrom);

  const moved = stillArchived.map((e: Element) => {
    const own = units.find((u) => u.e.id === e.id);
    if (own) {
      const target = unitTarget(ctx.backlog, byId, layout, own);
      return loadElement(own.dir ? path.join(target, path.basename(e.file)) : target, ctx.backlog, ctx.cfg);
    }
    // Carried along by an ancestor's folder move: its new path sits below
    // that unit's target at the same relative position.
    const covering = units.find((u) => u.dir && e.file.startsWith(u.src + path.sep));
    const target = covering ? unitTarget(ctx.backlog, byId, layout, covering) : e.file;
    const file = covering ? path.join(target, path.relative(covering.src, e.file)) : target;
    return loadElement(file, ctx.backlog, ctx.cfg);
  });

  deriveGraph(ctx.elements.filter((e: Element) => !stillArchived.includes(e)).concat(moved), ctx.idsDir, layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);

  if (json) {
    out(JSON.stringify({
      ok: true, ids: moved.map((m) => m.id), changed: ['unarchived'],
      entries: moved.map((m) => entryJson(m, ctx.backlog)),
      _problems: Array.from(new Set(moved.flatMap(elementProblems))).sort(),
    }, null, 2));
  } else {
    for (const m of moved) out(`${m.id} unarchived → ${m.file}`);
  }
  return 0;
}

export { cmdUnarchive };
