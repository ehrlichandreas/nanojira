'use strict';

// `nj new`.

const fs = require('fs');
const path = require('path');
const { checkFlags, flagString, parseListFlag, readSectionFlags } = require('./args.js');
const { TYPE_DIR, TYPES, PARENT_TYPE, PRIORITIES, FIELD_ORDER, SECTION_ROLES, NEW_FIELDS } = require('./constants.js');
const { context } = require('./context.js');
const { loadElement, deriveGraph } = require('./load.js');
const { fail, writeFeedback, emitWriteResult } = require('./output.js');
const { serialize, normalizeTitle, applySections } = require('./parse.js');
const { nowIso, allocateId, atomicWrite } = require('./store.js');

/**
 * Validate everything `nj new` needs, before anything is created.
 *
 * The ORDER of these checks is observable: with several bad flags at once the
 * first failing check decides the reported code, so type → title → parent
 * (exists → readable → right type → active) → status → priority → deps →
 * section sources must stay exactly as it is.
 *
 * Nothing in here allocates or writes. That is the point: `nj new` must not
 * burn a tombstone for a call it is going to refuse (§ 8, decision 31), so the
 * caller allocates only after this returns.
 */
function validateNewFlags(ctx, flags) {
  const type = flagString(flags, 'type');
  if (type === undefined) fail('missing_argument', '--type is required', `Known types: ${TYPES.join(', ')}`);
  if (!TYPES.includes(type)) fail('invalid_value', `unknown type '${type}'`, `Known types: ${TYPES.join(', ')}`);

  const title = flagString(flags, 'title');
  if (title === undefined || normalizeTitle(title) === '') fail('missing_argument', '--title is required and must not be empty');
  const cleanTitle = normalizeTitle(title);

  const parent = flagString(flags, 'parent');
  if (type === 'epic') {
    if (parent !== undefined) fail('invalid_value', 'epics must not have a --parent');
  } else {
    if (parent === undefined) fail('missing_argument', `--parent is required for ${type} (must be a ${PARENT_TYPE[type]})`);
    const p = ctx.elements.find((e) => e.id === parent);
    if (!p) fail('not_found', `parent '${parent}' does not exist`);
    // An unreadable stub is refused for the same reason as an archived parent:
    // its type cannot be verified and § 6 forbids inventing facts (§ 9).
    if (p.problems.has('file:unreadable') || p.problems.has('frontmatter:unreadable')) {
      fail('refused:unreadable', `parent '${parent}' (${p.file}) cannot be read — refusing to create a child under it`,
        'its type cannot be verified; repair the file, then run `nj doctor`');
    }
    // A wrong-type parent is a bad *target*, not a bad value: the flag names an
    // element that exists and is spelled correctly (§ 9 code table).
    if (p.type !== PARENT_TYPE[type]) fail('invalid_target', `parent '${parent}' is a ${p.type}, but a ${type} needs a ${PARENT_TYPE[type]}`);
    if (p.archived) {
      fail('refused:parent_archived', `parent '${parent}' is archived — refusing to create a child under it`,
        'a fresh child of an archived parent would immediately carry archive:split');
    }
  }

  const status = flagString(flags, 'status');
  if (status !== undefined && !ctx.cfg.statuses.includes(status)) {
    fail('invalid_value', `unknown status '${status}'`, `Known statuses: ${ctx.cfg.statuses.join(', ')}`);
  }
  const priority = flagString(flags, 'priority');
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    fail('invalid_value', `unknown priority '${priority}'`, `Known priorities: ${PRIORITIES.join(', ')}`);
  }
  const assignee = flagString(flags, 'assignee');
  const tags = parseListFlag(flags, 'tags');
  const deps = parseListFlag(flags, 'depends_on');
  if (deps !== undefined) {
    for (const d of deps) {
      if (!ctx.elements.some((e) => e.id === d)) fail('not_found', `depends_on target '${d}' does not exist`);
    }
  }

  // Read and validate the section flags before the ID is allocated: a rejection
  // here must not burn a tombstone (§ 8, decision 31).
  const sections = readSectionFlags(flags);

  return { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections };
}

function cmdNew(flags) {
  checkFlags(flags, NEW_FIELDS, new Set(['json']), true);
  const json = flags.has('json');
  const ctx = context();

  const { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections } =
    validateNewFlags(ctx, flags);

  const id = allocateId(ctx.backlog, type, ctx.elements);
  const ts = nowIso();

  const fields = new Map();
  fields.set('id', id);
  fields.set('type', type);
  if (parent !== undefined) fields.set('parent', parent);
  fields.set('title', cleanTitle);
  fields.set('status', status === undefined ? ctx.cfg.statuses[0] : status);
  if (priority !== undefined) fields.set('priority', priority);
  if (assignee !== undefined && assignee !== '') fields.set('assignee', assignee);
  if (tags !== undefined && tags.length > 0) fields.set('tags', tags);
  if (deps !== undefined && deps.length > 0) fields.set('depends_on', deps);
  fields.set('created', ts);
  fields.set('updated', ts);

  let body = `\n# ${cleanTitle}\n\n## ${ctx.cfg.sections.description[0]}\n`;
  if (type !== 'epic') body += `\n## ${ctx.cfg.sections.acceptance[0]}\n`;
  // Untouched without the flags, so the scaffold stays byte-identical to the
  // AC-2 fixture (AC-20).
  if (sections.size > 0) body = applySections(body, sections, ctx.cfg).body;

  const dir = path.join(ctx.backlog, TYPE_DIR[type]);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.md');
  atomicWrite(file, serialize(fields, Array.from(fields.keys()), body));

  const el = loadElement(file, TYPE_DIR[type], ctx.cfg);
  deriveGraph(ctx.elements.concat([el]), ctx.backlog);

  const changed = FIELD_ORDER.filter((f) => fields.has(f) && f !== 'created' && f !== 'updated')
    .concat(SECTION_ROLES.filter((r) => sections.has(r)));
  if (json) emitWriteResult(true, el, changed);
  else writeFeedback(el, ctx.cfg, `${id} created → ${file}`);
  return 0;
}

module.exports = { cmdNew };
