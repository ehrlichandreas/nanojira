'use strict';

// `nj archive`.

import type { Flags, Element, Context } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { context, resolveTarget, requireWritable, requireNoStubs, requireNoUnreadableDirs, requireActive } from '../core/context.ts';
import { elementProblems, entryJson } from '../core/derive.ts';
import { ownFolder } from '../core/layout.ts';
import { loadElement, deriveGraph, descendants } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { nowIso, atomicWrite, compareGuard, planMove, runMove, renderElement } from '../core/store.ts';

const STABLE_HINT = 'retry once the backlog is stable — archive takes no --force';

// Groups `type` and `flat`: every file directly in the archive folder (§ 11).
// IDs are unique and never reused, so no collisions are possible.
function archiveFlat(ctx: Context, subtree: Element[], ts: string): Element[] {
  const archiveDir = path.join(ctx.backlog, ctx.cfg.layout.folders.archive);
  fs.mkdirSync(archiveDir, { recursive: true });

  // Every target is checked before the first move (§ 11): a partial archive
  // would leave an archived parent with a live child (archive:split +
  // duplicate_id) and no clean recovery. A collision moves nothing.
  const plan = subtree.map((e: Element) => ({ el: e, target: path.join(archiveDir, path.basename(e.file)) }));
  for (const { target } of plan) {
    if (fs.existsSync(target)) {
      fail('exists', `${target} already exists — refusing to overwrite; nothing was moved`,
        `move or delete the file in ${ctx.cfg.layout.folders.archive}/, then archive again`);
    }
  }
  // Compare all sources too, before any of them moves — same reason.
  for (const { el: e } of plan) compareGuard(e, false, ctx.backlog, STABLE_HINT);

  const moved: Element[] = [];
  for (const { el: e, target } of plan) {
    atomicWrite(target, renderElement(e, new Map([['archived', ts], ['updated', ts]]), undefined));
    fs.unlinkSync(e.file);
    moved.push(loadElement(target, ctx.backlog, ctx.cfg));
  }
  return moved;
}

/**
 * Group `hierarchy`: the archive mirrors the active nesting (§ 11). An epic or
 * task moves as its folder, a subtask as its file, to the same relative place
 * below the archive folder. Only a subtree that lies together can move as one:
 * the element in its own folder, every descendant inside it, nothing foreign
 * in it, nothing misplaced — otherwise `refused:misplaced`, nothing moved
 * (DECISIONS 92 Q4). Order as v2 (DECISIONS 91 B16): every file's
 * `archived`/`updated` is written in place first, then the move.
 */
function archiveHierarchy(ctx: Context, el: Element, subtree: Element[], ts: string): Element[] {
  const refuse = (why: string): never => fail('refused:misplaced', `${el.id} cannot be archived — ${why}; nothing was moved`,
    'run `nj doctor --fix` to move the files into their places, then archive again');
  const off = subtree.filter((e: Element) => e.problems.has('layout:misplaced'));
  if (off.length > 0) refuse(`these files are not where the layout puts them: ${off.map((e: Element) => e.id).join(', ')}`);

  let src = el.file;
  if (el.type !== 'subtask') {
    const own = ownFolder(el);
    if (own === null) return refuse(`${el.file} does not lie in a folder of its own named ${el.id}/`);
    const inside = (f: string) => f.startsWith(own + path.sep);
    const outside = subtree.filter((e: Element) => !inside(e.file));
    if (outside.length > 0) refuse(`part of its subtree lies outside ${own}/: ${outside.map((e: Element) => e.id).join(', ')}`);
    const foreign = ctx.elements.filter((e: Element) => inside(e.file) && !subtree.includes(e));
    if (foreign.length > 0) refuse(`${own}/ also holds files of other elements: ${foreign.map((e: Element) => e.id).join(', ')}`);
    src = own;
  }
  const dst = path.join(ctx.backlog, ctx.cfg.layout.folders.archive, path.relative(ctx.backlog, src));
  const plan = planMove(src, dst);
  if (plan.conflicts.length > 0) {
    fail('exists', `${plan.conflicts[0]} already exists — refusing to overwrite; nothing was moved`,
      `move or delete it in ${ctx.cfg.layout.folders.archive}/, then archive again`);
  }
  for (const e of subtree) compareGuard(e, false, ctx.backlog, STABLE_HINT);

  for (const e of subtree) atomicWrite(e.file, renderElement(e, new Map([['archived', ts], ['updated', ts]]), undefined));
  runMove(plan);
  return subtree.map((e: Element) => loadElement(path.join(dst, path.relative(src, e.file)), ctx.backlog, ctx.cfg));
}

function cmdArchive(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context(flags);
  requireNoStubs(ctx, 'archive');
  requireNoUnreadableDirs(ctx, 'archive');
  const el = resolveTarget(ctx, flags, true);
  requireActive(el, 'archive');

  const subtree = [el].concat(descendants(ctx, el)).filter((e: Element) => !e.archived);
  const open = subtree.filter((e: Element) => e.status !== 'done');
  if (open.length > 0) {
    const names = open.map((c: Element) => `  ${c.id}  ${c.status.padEnd(8)} ${c.title}`).join('\n');
    fail('refused:not_done', `${el.id} cannot be archived — these elements are not done:\n${names}`,
      'finish them first; there is no --force for archiving');
  }
  for (const e of subtree) requireWritable(e);

  const ts = nowIso();
  const moved = ctx.cfg.layout.group === 'hierarchy'
    ? archiveHierarchy(ctx, el, subtree, ts)
    : archiveFlat(ctx, subtree, ts);
  deriveGraph(ctx.elements.filter((e: Element) => !subtree.includes(e)).concat(moved), ctx.idsDir, ctx.cfg.layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);

  if (json) {
    out(JSON.stringify({
      ok: true, ids: moved.map((m) => m.id), changed: ['archived'],
      entries: moved.map(entryJson),
      _problems: Array.from(new Set(moved.flatMap(elementProblems))).sort(),
    }, null, 2));
  } else {
    for (const m of moved) out(`${m.id} archived → ${m.file}`);
  }
  return 0;
}

export { cmdArchive };
