'use strict';

// `nj set`.

import type { Flags, Element, Context } from '../core/types.ts';

import { checkFlags, flagString, parseListFlag, readSectionFlags } from '../core/args.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { PRIORITIES } from '../core/constants.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { context, resolveTarget, resolveById, requireWritable, requireNoUnreadableDirs, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out, writeFeedback, emitWriteResult } from '../core/output.ts';
import { syncH1, normalizeTitle, applySections } from '../core/parse.ts';
import { refreshStatus } from '../core/status.ts';
import { valueHint } from '../core/suggest.ts';
import { nowIso, guardedWrite, guardedWriteCatchable, renderElement } from '../core/store.ts';

type SectionRole = 'description' | 'acceptance';
// The two field namespaces `nj set` can touch: real Element properties, and
// the section roles that live in the body rather than the frontmatter.
type SetField = keyof Element | SectionRole;

interface SetItem { el: Element; overrides: Map<string, string | string[] | undefined>; changed: SetField[]; newBody: string | undefined }

function cmdSet(flags: Flags) {
  // `id`/`file` stay out of the "Known fields:" list (as before this was
  // moved onto the shared table): they are the addressing mechanism, not
  // a settable field, and the original error text never named them here.
  checkFlags(flags, cliFieldNames('set').filter((f) => f !== 'id' && f !== 'file'),
    new Set(['json', 'force', 'allow-open-children', 'id', 'file']), true);
  const json = flags.has('json');
  const force = flags.has('force');
  const allowOpen = flags.has('allow-open-children');
  const ctx = context(flags);

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    if (flagString(flags, 'file') !== undefined) fail('invalid_target', 'use either --id or --file, not both');
    // "An invalid flag value" is a batch-wide argument error (DECISIONS
    // 136b), not a per-ID one: checked once, before any ID's own preflight,
    // the same value checks `collectSetOverrides` repeats harmlessly per ID.
    validateFieldValues(ctx, flags);
    const result = runBatch<SetItem, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(el, 'set');
        const { overrides, changed, newBody } = collectSetOverrides(ctx, el, flags, allowOpen);
        return { el, overrides, changed, newBody };
      },
      (item) => {
        if (item.changed.length === 0) {
          const entry = entryJson(item.el, ctx.backlog, ctx.cfg);
          return { ok: true, changed: [], entry, _problems: entry._problems };
        }
        item.overrides.set('updated', nowIso());
        guardedWriteCatchable(item.el, renderElement(item.el, item.overrides, item.newBody), force, ctx.backlog);
        const fresh = loadElement(item.el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e: Element) => (e.file === item.el.file ? fresh : e)), ctx.idsDir, ctx.cfg.layout);
        const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
        return { ok: true, changed: item.changed, entry, _problems: entry._problems };
      },
    );
    if (result.anyWritten) refreshStatus(ctx.backlog, ctx.cfg, ctx);
    const wrapper = { ok: result.ok, results: result.results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} → ${(r.changed || []).join(', ') || 'unchanged'}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'set');

  const { overrides, changed, newBody } = collectSetOverrides(ctx, el, flags, allowOpen);

  if (changed.length === 0) {
    if (json) emitWriteResult(true, el, [], ctx.backlog, ctx.cfg);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }

  overrides.set('updated', nowIso());
  guardedWrite(el, renderElement(el, overrides, newBody), force, ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg.layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  if (json) emitWriteResult(true, fresh, changed, ctx.backlog, ctx.cfg);
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
 * one, because an unchanged body must be written back byte-identical. Also
 * the per-ID preflight for a batch write (§ 9): every check here runs
 * before anything is written, for a single element exactly as for one of a
 * batch's members.
 */
/**
 * The pure, element-independent half of `collectSetOverrides`'s validation —
 * batch-wide for a batch write (§ 9 "Batch writes", DECISIONS 136b): an
 * invalid flag value is an argument error, not one ID's problem, checked
 * once before any ID's own preflight.
 */
function validateFieldValues(ctx: Context, flags: Flags) {
  const title = flagString(flags, 'title');
  if (title !== undefined && normalizeTitle(title) === '') fail('invalid_value', '--title must not be empty');
  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
  }
  const priority = flagString(flags, 'priority');
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    fail('invalid_value', `unknown priority '${priority}'`, valueHint('priority', priority, PRIORITIES));
  }
  validateTagsCombination(flags);
}

/** --tags= replaces the whole list; --add-tags/--remove-tags change it
 * incrementally (DECISIONS 163 B). Mixing the two intentions in one call
 * is never assumed to mean one or the other -- invalid_value, in every
 * combination, nothing written. */
function validateTagsCombination(flags: Flags) {
  const direct = flagString(flags, 'tags');
  if (direct === undefined) return;
  if (flagString(flags, 'add-tags') !== undefined || flagString(flags, 'remove-tags') !== undefined) {
    fail('invalid_value', '--tags cannot be combined with --add-tags or --remove-tags',
      'use --tags=<list> to replace the whole list, or --add-tags/--remove-tags to change it incrementally');
  }
}

/** Remove, then add (DECISIONS 163 B, pinned order): every tag in `remove`
 * is dropped from wherever it sits; every tag in `add`, in its own order,
 * is appended to what remains, but only if not already there -- a tag
 * named in both lists ends up present, moved to the end; a tag repeated
 * within `add` itself is added only once (the `includes` check below
 * catches its own second occurrence the same way). Tags not removed keep
 * their original relative order. */
function applyTagsEdits(current: string[], remove: string[] | undefined, add: string[] | undefined): string[] {
  const kept = remove === undefined ? current.slice() : current.filter((t) => !remove.includes(t));
  if (add === undefined) return kept;
  for (const t of add) if (!kept.includes(t)) kept.push(t);
  return kept;
}

function collectSetOverrides(ctx: Context, el: Element, flags: Flags, allowOpen: boolean) {
  const sections = readSectionFlags(flags);
  validateTagsCombination(flags);
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
      fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
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
    if (!PRIORITIES.includes(priority)) fail('invalid_value', `unknown priority '${priority}'`, valueHint('priority', priority, PRIORITIES));
    if (priority !== el.priority) { overrides.set('priority', priority); changed.push('priority'); }
  }

  const assignee = flagString(flags, 'assignee');
  if (assignee !== undefined && assignee !== el.assignee) {
    overrides.set('assignee', assignee === '' ? undefined : assignee);
    changed.push('assignee');
  }

  // --tags= replaces the list outright; --add-tags/--remove-tags edit it
  // incrementally (DECISIONS 163 B) -- validateTagsCombination above
  // already refused any call naming both kinds, so at most one path here
  // ever applies.
  const directTags = parseListFlag(flags, 'tags');
  const addTags = parseListFlag(flags, 'add-tags');
  const removeTags = parseListFlag(flags, 'remove-tags');
  const nextTags = directTags !== undefined ? directTags
    : addTags !== undefined || removeTags !== undefined ? applyTagsEdits(el.tags, removeTags, addTags)
      : undefined;
  if (nextTags !== undefined) {
    const cur = el.tags;
    if (nextTags.length !== cur.length || nextTags.some((x, i) => x !== cur[i])) {
      overrides.set('tags', nextTags.length === 0 ? undefined : nextTags);
      changed.push('tags');
    }
  }

  const depsV = parseListFlag(flags, 'depends_on');
  if (depsV !== undefined) {
    for (const d of depsV) {
      if (!ctx.elements.some((e: Element) => e.id === d)) fail('not_found', `depends_on target '${d}' does not exist`);
    }
    const cur = el.depends_on;
    if (depsV.length !== cur.length || depsV.some((x, i) => x !== cur[i])) {
      overrides.set('depends_on', depsV.length === 0 ? undefined : depsV);
      changed.push('depends_on');
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
