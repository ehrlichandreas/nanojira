'use strict';

// `nj archive`.

import type { Flags, Element } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { context, resolveTarget, requireWritable, requireNoStubs, requireActive } from '../core/context.ts';
import { elementProblems, entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph, descendants } from '../core/load.ts';
import { fail, out } from '../core/output.ts';
import { nowIso, atomicWrite, compareGuard, renderElement } from '../core/store.ts';

function cmdArchive(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context(flags);
  requireNoStubs(ctx, 'archive');
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
  const archiveDir = path.join(ctx.backlog, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });

  // Every target is checked before the first move (§ 11): a partial archive
  // would leave an archived parent with a live child (archive:split +
  // duplicate_id) and no clean recovery. A collision moves nothing.
  const plan = subtree.map((e: Element) => ({ el: e, target: path.join(archiveDir, path.basename(e.file)) }));
  for (const { target } of plan) {
    if (fs.existsSync(target)) {
      fail('exists', `${target} already exists — refusing to overwrite; nothing was moved`,
        'move or delete the file in archive/, then archive again');
    }
  }
  // Compare all sources too, before any of them moves — same reason.
  for (const { el: e } of plan) {
    compareGuard(e, false, ctx.backlog, 'retry once the backlog is stable — archive takes no --force');
  }

  const moved: Element[] = [];
  for (const { el: e, target } of plan) {
    atomicWrite(target, renderElement(e, new Map([['archived', ts], ['updated', ts]]), undefined));
    fs.unlinkSync(e.file);
    moved.push(loadElement(target, 'archive', ctx.cfg));
  }
  deriveGraph(ctx.elements.filter((e: Element) => !subtree.includes(e)).concat(moved), ctx.backlog);

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
