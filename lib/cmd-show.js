'use strict';

// `nj show`.

const { checkFlags } = require('./args.js');
const { context, resolveTarget } = require('./context.js');
const { elementProblems, compareElements, entryJson, countsOf } = require('./derive.js');
const { out } = require('./output.js');

function cmdShow(flags) {
  checkFlags(flags, [], new Set(['json', 'id', 'file']), false);
  const ctx = context();
  const el = resolveTarget(ctx, flags, false);
  const scope = ctx.elements;
  // Reads show every file claiming the id, each marked duplicate_id (§ 9).
  const shown = flags.has('file') ? [el] : ctx.elements.filter((e) => e.id === el.id).sort(compareElements);
  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope.filter((e) => !e.archived)), entries: shown.map(entryJson) }, null, 2));
    return 0;
  }
  if (shown.length > 1) {
    out(`⚠ ${el.id} is carried by ${shown.length} files (duplicate_id) — showing all of them.`);
    out('');
  }
  for (const one of shown) {
    if (shown.length > 1) out(`--- ${one.file} ---`);
    showOne(one);
    if (one !== shown[shown.length - 1]) out('');
  }
  return 0;
}

function showOne(el) {
  out(`${el.id}  ${el.title}`);
  out(`  type      ${el.type}`);
  if (el.parent) out(`  parent    ${el.parent}`);
  out(`  status    ${el.status}`);
  out(`  priority  ${el.priority}`);
  if (el.assignee) out(`  assignee  ${el.assignee}`);
  if (el.tags.length) out(`  tags      ${el.tags.join(', ')}`);
  if (el.depends_on.length) out(`  depends   ${el.depends_on.join(', ')}`);
  out(`  created   ${el.created}`);
  out(`  updated   ${el.updated}`);
  if (el.archivedAt) out(`  archived  ${el.archivedAt}`);
  out(`  file      ${el.file}`);
  const probs = elementProblems(el);
  out(`  problems  ${probs.length ? probs.join(' ') : '(none)'}`);
  out('');
  process.stdout.write(el.body.replace(/^\n/, ''));
  if (el.body !== '' && !el.body.endsWith('\n')) out('');
}

module.exports = { cmdShow };
