'use strict';

// `nj` without a command: the status overview.

const { checkFlags } = require('./args.js');
const { context } = require('./context.js');
const { elementProblems, isIncomplete, isReady, compareElements, entryJson, countsOf } = require('./derive.js');
const { out } = require('./output.js');

function cmdStatus(flags) {
  checkFlags(flags, [], new Set(['json']), false);
  const ctx = context();
  const scope = ctx.elements.filter((e) => !e.archived);
  const counts = countsOf(scope);
  const ready = scope.filter((e) => isReady(e, ctx.cfg)).sort(compareElements).slice(0, 5);
  const incomplete = scope.filter(isIncomplete).sort(compareElements).slice(0, 5);

  if (flags.has('json')) {
    out(JSON.stringify({
      backlog: ctx.backlog, counts,
      ready: ready.map(entryJson), incomplete: incomplete.map(entryJson),
    }, null, 2));
    return 0;
  }
  out(`backlog: ${ctx.backlog}`);
  out(`${counts.total} entries · ${counts.errors} error${counts.errors === 1 ? '' : 's'} · ${counts.incomplete} incomplete`);
  out('');
  out('Ready to work:');
  if (ready.length === 0) out('  (none)');
  for (const e of ready) out(`  ${e.id}  ${e.title}`);
  if (incomplete.length > 0) {
    out('');
    out('Complete first:');
    for (const e of incomplete) {
      out(`  ${e.id}  ${e.title}      ${elementProblems(e).filter((c) => c.startsWith('incomplete:')).join(' ')}`);
    }
  }
  if (counts.errors > 0) {
    out('');
    out(`${counts.errors} element${counts.errors === 1 ? '' : 's'} with errors — run \`nj doctor\`.`);
  }
  return 0;
}

module.exports = { cmdStatus };
