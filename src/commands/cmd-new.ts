'use strict';

// `nj new`.

import type { Flags, Context, Element } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags, flagString, parseListFlag, readSectionFlags } from '../core/args.ts';
import { TYPE_FOLDER_ROLE, TYPES, PARENT_TYPE, PRIORITIES, FIELD_ORDER, SECTION_ROLES } from '../core/constants.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { context } from '../core/context.ts';
import { folderOf, expectedPlace } from '../core/layout.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, hardExit, writeFeedback, emitWriteResult } from '../core/output.ts';
import { serialize, normalizeTitle, applySections } from '../core/parse.ts';
import { valueHint } from '../core/suggest.ts';
import { refreshStatus } from '../core/status.ts';
import { nowIso, allocateId, atomicWrite } from '../core/store.ts';

/** Whether `dir` already holds a file named `name`, comparing case-insensitively. */
function collidesCaseInsensitively(dir: string, name: string): boolean {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return false; }
  const lower = name.toLowerCase();
  return names.some((n) => n.toLowerCase() === lower);
}

interface NewFlags {
  type: string;
  cleanTitle: string;
  parent: string | undefined;
  status: string | undefined;
  priority: string | undefined;
  assignee: string | undefined;
  tags: string[] | undefined;
  deps: string[] | undefined;
  sections: Map<string, string>;
}

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
function validateNewFlags(ctx: Context, flags: Flags): NewFlags {
  const type = flagString(flags, 'type');
  if (type === undefined) return fail('missing_argument', '--type is required', `Known types: ${TYPES.join(', ')}`);
  if (!TYPES.includes(type)) return fail('invalid_value', `unknown type '${type}'`, valueHint('type', type, TYPES));

  const title = flagString(flags, 'title');
  if (title === undefined || normalizeTitle(title) === '') return fail('missing_argument', '--title is required and must not be empty');
  const cleanTitle = normalizeTitle(title);

  const parent = flagString(flags, 'parent');
  if (type === 'epic') {
    if (parent !== undefined) fail('invalid_value', 'epics must not have a --parent');
  } else {
    if (parent === undefined) return fail('missing_argument', `--parent is required for ${type} (must be a ${PARENT_TYPE[type]})`);
    const p = ctx.elements.find((e: Element) => e.id === parent);
    if (!p) return fail('not_found', `parent '${parent}' does not exist`);
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
    fail('invalid_value', `unknown status '${status}'`, valueHint('status', status, ctx.cfg.statuses));
  }
  const priority = flagString(flags, 'priority');
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    fail('invalid_value', `unknown priority '${priority}'`, valueHint('priority', priority, PRIORITIES));
  }
  const assignee = flagString(flags, 'assignee');
  const tags = parseListFlag(flags, 'tags');
  const deps = parseListFlag(flags, 'depends_on');
  if (deps !== undefined) {
    for (const d of deps) {
      if (!ctx.elements.some((e: Element) => e.id === d)) fail('not_found', `depends_on target '${d}' does not exist`);
    }
  }

  // Read and validate the section flags before the ID is allocated: a rejection
  // here must not burn a tombstone (§ 8, decision 31).
  const sections = readSectionFlags(flags);

  return { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections };
}

/**
 * The folder a new element goes into (§ 4). Under `hierarchy` it is its
 * parent's place plus, for an epic or task, a folder of its own. A parent
 * whose own place cannot be determined (its chain is broken) lends the folder
 * its file lies in instead — the child is then as misplaced as the parent,
 * and `doctor` reports both.
 */
function newPlace(ctx: Context, type: string, id: string, parent: string | undefined): string {
  const { group, folders } = ctx.cfg.layout;
  if (group === 'type') return folders[TYPE_FOLDER_ROLE[type]];
  if (group === 'flat') return '';
  const own = type === 'subtask' ? [] : [id];
  if (parent === undefined) return own.join('/');
  const p = ctx.elements.find((e: Element) => e.id === parent) as Element;
  const at = expectedPlace(p, p.byId as Map<string, Element>, ctx.cfg.layout);
  return [at === null ? folderOf(ctx.backlog, p.file) : at].concat(own).filter((s) => s !== '').join('/');
}

function cmdNew(flags: Flags) {
  checkFlags(flags, cliFieldNames('new'), new Set(['json']), true);
  const json = flags.has('json');
  const ctx = context(flags);

  const { type, cleanTitle, parent, status, priority, assignee, tags, deps, sections } =
    validateNewFlags(ctx, flags);

  // A case-insensitively taken name is never overwritten (DECISIONS 106
  // F10): the allocator sees only tracked IDs (tombstones and loaded
  // elements), which a stray hand-written file with an unusual extension
  // case (`TSK-001.MD`) is neither — `.md` is matched case-sensitively by
  // the scan (§ 4 B11). A collision at the actual write path retries with a
  // fresh id; each attempt's own tombstone raises the allocator's start
  // value, so the retry is bounded exactly as allocation itself is (§ 8).
  let id: string, dir: string, file: string;
  for (let attempt = 0; ; attempt++) {
    id = allocateId(ctx.idsDir, type, ctx.elements);
    dir = path.join(ctx.backlog, ...newPlace(ctx, type, id, parent).split('/'));
    file = path.join(dir, id + '.md');
    if (!collidesCaseInsensitively(dir, id + '.md')) break;
    if (attempt >= 100) return hardExit('id_allocation_failed', `nj: id allocation failed after 100 retries (${id} collides with an existing file)`);
  }
  const ts = nowIso();

  const fields: Map<string, string | string[]> = new Map();
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

  // Under `hierarchy` the element's own folder (epic, task) is created first;
  // one that already exists is reused (§ 12).
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(file, serialize(fields, Array.from(fields.keys()), body));

  const el = loadElement(file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.concat([el]), ctx.idsDir, ctx.cfg.layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);

  const changed: string[] = FIELD_ORDER.filter((f: string) => fields.has(f) && f !== 'created' && f !== 'updated')
    .concat(SECTION_ROLES.filter((r: string) => sections.has(r)));
  if (json) emitWriteResult(true, el, changed, ctx.backlog, ctx.cfg);
  else writeFeedback(el, ctx.cfg, `${id} created → ${file}`);
  return 0;
}

export { cmdNew };
