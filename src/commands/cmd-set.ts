'use strict';

// `nj set`.

import type { Flags, Element, Context } from '../core/types.ts';

import { checkFlags, flagString, parseListFlag, readSectionFlags } from '../core/args.ts';
import { PRIORITIES, SETTABLE_FIELDS } from '../core/constants.ts';
import { context, resolveTarget, requireWritable, requireNoUnreadableDirs, requireActive } from '../core/context.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, writeFeedback, emitWriteResult } from '../core/output.ts';
import { syncH1, normalizeTitle, applySections } from '../core/parse.ts';
import { refreshStatus } from '../core/status.ts';
import { nowIso, guardedWrite, renderElement } from '../core/store.ts';

type SectionRole = 'description' | 'acceptance';
// The two field namespaces `nj set` can touch: real Element properties, and
// the section roles that live in the body rather than the frontmatter.
type SetField = keyof Element | SectionRole;

function cmdSet(flags: Flags) {
  checkFlags(flags, SETTABLE_FIELDS, new Set(['json', 'force', 'allow-open-children', 'id', 'file']), true);
  const json = flags.has('json');
  const force = flags.has('force');
  const allowOpen = flags.has('allow-open-children');
  const ctx = context(flags);
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'set');

  const { overrides, changed, newBody } = collectSetOverrides(ctx, el, flags, allowOpen);

  if (changed.length === 0) {
    if (json) emitWriteResult(true, el, [], ctx.backlog);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }

  overrides.set('updated', nowIso());
  guardedWrite(el, renderElement(el, overrides, newBody), force, ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg.layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  if (json) emitWriteResult(true, fresh, changed, ctx.backlog);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} → ${changed.map((c: SetField) => `${c}=${describeField(fresh, c)}`).join(', ')}`);
  return 0;
}

/**
 * Decide what `nj set` would change, without changing anything.
 *
 * Three orderings in here are load-bearing and must not be tidied:
 *  - the section flags are read FIRST, so a rejected value source fails before
 *    any other validation reports a different code;
 *  - `changed` follows the flag processing order (title, status, priority,
 *    assignee, tags, depends_on, then the section roles) — it is observable in
 *    the JSON result, so the sequence is part of the contract;
 *  - the children_open check runs BEFORE `status !== el.status`, which is why
 *    `--status=done` on an already-done parent with open children refuses
 *    instead of being a no-op. That looks like an oversight and is not.
 *
 * Returns the overrides, the ordered `changed` list, and a replacement body —
 * `newBody` stays undefined unless the title sync or a section write produced
 * one, because an unchanged body must be written back byte-identical.
 */
function collectSetOverrides(ctx: Context, el: Element, flags: Flags, allowOpen: boolean) {
  const sections = readSectionFlags(flags);
  const overrides: Map<string, string | string[] | undefined> = new Map();
  const changed: SetField[] = [];

  const title = flagString(flags, 'title');
  let newBody;
  if (title !== undefined) {
    const clean = normalizeTitle(title);
    if (clean === '') fail('invalid_value', '--title must not be empty');
    if (clean !== el.title) {
      overrides.set('title', clean);
      changed.push('title');
      newBody = syncH1(el.body, clean);
    }
  }

  const status = flagString(flags, 'status');
  if (status !== undefined) {
    if (!ctx.cfg.statuses.includes(status)) {
      fail('invalid_value', `unknown status '${status}'`, `Known statuses: ${ctx.cfg.statuses.join(', ')}`);
    }
    if (status === 'done') {
      // An unreadable directory anywhere hides whatever elements lie inside
      // it — including, possibly, an open child of `el` — so the open-
      // children check below cannot be trusted while one exists; a silent
      // `done` would be worse than refusing (DECISIONS 106 F4).
      requireNoUnreadableDirs(ctx, 'set --status=done');
      const open = (el.children as Element[]).filter((c) => !c.archived && c.status !== 'done');
      if (open.length > 0 && !allowOpen) {
        const names = open.map((c) => `  ${c.id}  ${c.status.padEnd(8)} ${c.title}`).join('\n');
        fail('refused:children_open', `${el.id} has children that are not done — refusing to set done:\n${names}`,
          'finish them first, or pass --allow-open-children');
      }
    }
    if (status !== el.status) { overrides.set('status', status); changed.push('status'); }
  }

  const priority = flagString(flags, 'priority');
  if (priority !== undefined) {
    if (!PRIORITIES.includes(priority)) fail('invalid_value', `unknown priority '${priority}'`, `Known priorities: ${PRIORITIES.join(', ')}`);
    if (priority !== el.priority) { overrides.set('priority', priority); changed.push('priority'); }
  }

  const assignee = flagString(flags, 'assignee');
  if (assignee !== undefined && assignee !== el.assignee) {
    overrides.set('assignee', assignee === '' ? undefined : assignee);
    changed.push('assignee');
  }

  for (const field of ['tags', 'depends_on'] as const) {
    const v = parseListFlag(flags, field);
    if (v === undefined) continue;
    if (field === 'depends_on') {
      for (const d of v) {
        if (!ctx.elements.some((e: Element) => e.id === d)) fail('not_found', `depends_on target '${d}' does not exist`);
      }
    }
    const cur = el[field];
    if (v.length !== cur.length || v.some((x: string, i: number) => x !== cur[i])) {
      overrides.set(field, v.length === 0 ? undefined : v);
      changed.push(field);
    }
  }

  // Sections ride on whatever body the title sync produced, so `--title` and a
  // section write in one call compose. A role that rewrites to the identical
  // bytes is not a change (decision 17).
  if (sections.size > 0) {
    const base = newBody === undefined ? el.body : newBody;
    const applied = applySections(base, sections, ctx.cfg);
    if (applied.body !== base) newBody = applied.body;
    changed.push(...(applied.changed as SectionRole[]));
  }

  return { overrides, changed, newBody };
}

function isSectionRole(field: SetField): field is SectionRole {
  return field === 'description' || field === 'acceptance';
}

function describeField(el: Element, field: SetField): string {
  if (isSectionRole(field)) return '(body section)';
  const v = el[field];
  return Array.isArray(v) ? (v.length ? v.join(',') : '(empty)') : (typeof v === 'string' && v === '' ? '(empty)' : String(v));
}

export { cmdSet };
