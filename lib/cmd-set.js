'use strict';

// `nj set`.

const { checkFlags, flagString, parseListFlag, readSectionFlags } = require('./args.js');
const { PRIORITIES, SECTION_ROLES, SETTABLE_FIELDS } = require('./constants.js');
const { context, resolveTarget, requireWritable, requireActive } = require('./context.js');
const { loadElement, deriveGraph } = require('./load.js');
const { fail, writeFeedback, emitWriteResult } = require('./output.js');
const { syncH1, normalizeTitle, applySections } = require('./parse.js');
const { nowIso, guardedWrite, renderElement } = require('./store.js');

function cmdSet(flags) {
  checkFlags(flags, SETTABLE_FIELDS, new Set(['json', 'force', 'allow-open-children', 'id', 'file']), true);
  const json = flags.has('json');
  const force = flags.has('force');
  const allowOpen = flags.has('allow-open-children');
  const ctx = context();
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'set');

  const { overrides, changed, newBody } = collectSetOverrides(ctx, el, flags, allowOpen);

  if (changed.length === 0) {
    if (json) emitWriteResult(true, el, []);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }

  overrides.set('updated', nowIso());
  guardedWrite(el, renderElement(el, overrides, newBody), force, ctx.backlog);

  const fresh = loadElement(el.file, el.folder, ctx.cfg);
  deriveGraph(ctx.elements.map((e) => (e.file === el.file ? fresh : e)), ctx.backlog);
  if (json) emitWriteResult(true, fresh, changed);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} → ${changed.map((c) => `${c}=${describeField(fresh, c)}`).join(', ')}`);
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
function collectSetOverrides(ctx, el, flags, allowOpen) {
  const sections = readSectionFlags(flags);
  const overrides = new Map();
  const changed = [];

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
      const open = el.children.filter((c) => !c.archived && c.status !== 'done');
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

  for (const field of ['tags', 'depends_on']) {
    const v = parseListFlag(flags, field);
    if (v === undefined) continue;
    if (field === 'depends_on') {
      for (const d of v) {
        if (!ctx.elements.some((e) => e.id === d)) fail('not_found', `depends_on target '${d}' does not exist`);
      }
    }
    const cur = el[field];
    if (v.length !== cur.length || v.some((x, i) => x !== cur[i])) {
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
    changed.push(...applied.changed);
  }

  return { overrides, changed, newBody };
}

function describeField(el, field) {
  if (SECTION_ROLES.includes(field)) return '(body section)';
  const v = el[field];
  return Array.isArray(v) ? (v.length ? v.join(',') : '(empty)') : (v === '' ? '(empty)' : String(v));
}

module.exports = { cmdSet };
