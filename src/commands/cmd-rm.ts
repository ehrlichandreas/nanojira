'use strict';

// `nj rm`.

import type { Flags, Element, EntryJson } from '../core/types.ts';

import * as fs from 'fs';
import { checkFlags } from '../core/args.ts';
import { context, resolveTarget, requireNoStubs, requireActive } from '../core/context.ts';
import { compareElements, entryJson } from '../core/derive.ts';
import { descendants } from '../core/load.ts';
import { fail, out } from '../core/output.ts';

function cmdRm(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'cascade', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context(flags);
  requireNoStubs(ctx, 'rm');
  const el = resolveTarget(ctx, flags, true);
  requireActive(el, 'rm');
  const kids = descendants(ctx, el);

  if (kids.length > 0 && !flags.has('cascade')) {
    const names = kids.map((c: Element) => `  ${c.id}  ${c.title}`).join('\n');
    fail('refused:has_children', `${el.id} still has child elements — refusing to delete:\n${names}`,
      'pass --cascade to delete the whole subtree');
  }

  const victims = [el].concat(kids);
  const archivedVictims = victims.filter((v: Element) => v.archived);
  if (archivedVictims.length > 0) {
    fail('refused:archived', `the subtree contains archived elements — refusing to delete:\n${archivedVictims.map((v: Element) => '  ' + v.id).join('\n')}`,
      'archived elements are read-only in round one');
  }
  const victimIds = new Set(victims.map((v: Element) => v.id));
  // Removing an element leaves depends_on:dangling behind on its dependents;
  // name them rather than let doctor be the first to mention it (§ 9).
  const dependents = ctx.elements
    .filter((e: Element) => !victimIds.has(e.id) && e.depends_on.some((d: string) => victimIds.has(d)))
    .sort(compareElements);

  const entries: EntryJson[] = victims.map(entryJson);
  for (const v of victims) fs.unlinkSync(v.file);

  if (json) {
    if (flags.has('cascade') && kids.length > 0) {
      out(JSON.stringify({ ok: true, ids: victims.map((v: Element) => v.id), changed: ['deleted'], entries, _problems: [], dependents: dependents.map((d: Element) => d.id) }, null, 2));
    } else {
      out(JSON.stringify({ ok: true, id: el.id, changed: ['deleted'], entry: entries[0], _problems: entries[0]._problems, dependents: dependents.map((d: Element) => d.id) }, null, 2));
    }
  } else {
    for (const v of victims) out(`${v.id} deleted (${v.file})`);
    out(`Tombstone${victims.length > 1 ? 's' : ''} kept — the ID${victims.length > 1 ? 's stay' : ' stays'} claimed forever.`);
    for (const d of dependents) {
      out(`⚠ ${d.id} depends_on a deleted element — it now carries depends_on:dangling.`);
    }
  }
  return 0;
}

export { cmdRm };
