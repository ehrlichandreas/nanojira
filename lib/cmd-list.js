'use strict';

// `nj list`.

const { checkFlags, flagString } = require('./args.js');
const { TYPES } = require('./constants.js');
const { context } = require('./context.js');
const { elementProblems, isIncomplete, isReady, compareElements, entryJson, countsOf } = require('./derive.js');
const { fail, out, printEntryLine } = require('./output.js');

function applyFilters(elements, flags, cfg) {
  const all = flags.has('all');
  let list = elements.filter((e) => all || !e.archived);
  // A typo'd filter must be an error, never a silently empty result (§ 9).
  const status = flagString(flags, 'status');
  if (status !== undefined) {
    if (!cfg.statuses.includes(status)) {
      fail('invalid_value', `unknown status '${status}'`, `Known statuses: ${cfg.statuses.join(', ')}`);
    }
    list = list.filter((e) => e.status === status);
  }
  const type = flagString(flags, 'type');
  if (type !== undefined) {
    if (!TYPES.includes(type)) fail('invalid_value', `unknown type '${type}'`, `Known types: ${TYPES.join(', ')}`);
    list = list.filter((e) => e.type === type);
  }
  const tag = flagString(flags, 'tag');
  if (tag !== undefined) list = list.filter((e) => e.tags.includes(tag));
  const parent = flagString(flags, 'parent');
  if (parent !== undefined) {
    if (!elements.some((e) => e.id === parent)) {
      fail('not_found', `--parent '${parent}' does not exist`, 'filters are validated so a typo never looks like an empty backlog');
    }
    list = list.filter((e) => e.parent === parent);
  }
  const assignee = flagString(flags, 'assignee');
  if (assignee !== undefined) list = list.filter((e) => e.assignee === assignee);
  return list.sort(compareElements);
}

function cmdList(flags) {
  checkFlags(flags, [], new Set(['json', 'ready', 'all', 'status', 'type', 'tag', 'parent', 'assignee']), false);
  const ctx = context();
  const scope = ctx.elements.filter((e) => flags.has('all') || !e.archived);
  const filtered = applyFilters(ctx.elements, flags, ctx.cfg);

  if (flags.has('ready')) {
    const ready = filtered.filter((e) => isReady(e, ctx.cfg));
    const blocked = filtered.filter((e) => !isReady(e, ctx.cfg) && e.status === ctx.cfg.statuses[0] && isIncomplete(e));
    if (flags.has('json')) {
      out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope), entries: ready.map(entryJson) }, null, 2));
      return 0;
    }
    out('Ready to work:');
    if (ready.length === 0) out('  (none)');
    for (const e of ready) out(`  ${e.id}  ${e.title}`);
    if (blocked.length > 0) {
      out('');
      out('Complete first:');
      for (const e of blocked) {
        out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c) => c.startsWith('incomplete:')).join(' ')}`);
      }
    }
    return 0;
  }

  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope), entries: filtered.map(entryJson) }, null, 2));
    return 0;
  }
  if (filtered.length === 0) { out('(no matching elements)'); return 0; }
  for (const e of filtered) printEntryLine(e, ctx.cfg);
  return 0;
}

module.exports = { cmdList };
