'use strict';

// `nj new`.

import type { Flags, Context, Element, EntryJson } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags, flagString, parseListFlag, readSectionFlags } from '../core/args.ts';
import { TYPE_FOLDER_ROLE, TYPES, PARENT_TYPE, PRIORITIES, FIELD_ORDER, SECTION_ROLES, NEW_FIELDS, TYPE_PREFIX } from '../core/constants.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { readInputText, parseInputJson } from '../core/input.ts';
import { context } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { folderOf, expectedPlace } from '../core/layout.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { Fail, fail, hardExit, out, writeFeedback, emitWriteResult, output } from '../core/output.ts';
import { serialize, normalizeTitle, normalizeSectionContent, sectionPresent, sectionHasCheckbox, applySections } from '../core/parse.ts';
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
 * The explicit-`--parent` resolution rules (§ 6): required for every type but
 * `epic` (which must not have one), must exist, must be readable, must be the
 * right type, must not be archived. Shared by the single-element path below
 * AND a `--input` plan node that gives its own `parent` (§ 9 "`--input`" —
 * a plan's explicit `parent` always names a real, already-existing element,
 * exactly like `--parent` does today; only a `children` entry's IMPLIED
 * parent is new, and that has no equivalent here to reuse).
 */
// `a`/`an` for a PARENT_TYPE value (§ 9): only ever "task" or "epic", but
// spelled out instead of hard-coded so a third parent type never silently
// regresses this.
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * `verb` (DECISIONS 178): the archived-parent refusal's own wording —
 * `new` is about to CREATE a child under the given parent, `set --parent`
 * is about to MOVE an existing one there; same code, same every other
 * word, just the one verb that actually differs between the two callers.
 */
function checkExplicitParent(ctx: Context, type: string, parent: string | undefined, verb: 'create' | 'move' = 'create'): string | undefined {
  if (type === 'epic') {
    if (parent !== undefined) fail('invalid_value', 'epics must not have a --parent');
    return undefined;
  }
  if (parent === undefined) return fail('missing_argument', `--parent is required for ${type} (must be ${article(PARENT_TYPE[type])} ${PARENT_TYPE[type]})`);
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
  if (p.type !== PARENT_TYPE[type]) {
    fail('invalid_target', `parent '${parent}' is ${article(p.type as string)} ${p.type}, but ${article(type)} ${type} needs ${article(PARENT_TYPE[type])} ${PARENT_TYPE[type]}`);
  }
  if (p.archived) {
    fail('refused:parent_archived', `parent '${parent}' is archived — refusing to ${verb} a child under it`,
      'a fresh child of an archived parent would immediately carry archive:split');
  }
  return p.id;
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
  checkExplicitParent(ctx, type, parent);

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

function buildBody(ctx: Context, type: string, cleanTitle: string, sections: Map<string, string>): string {
  let body = `\n# ${cleanTitle}\n\n## ${ctx.cfg.sections.description[0]}\n`;
  if (type !== 'epic') body += `\n## ${ctx.cfg.sections.acceptance[0]}\n`;
  // Untouched without any section given, so the scaffold stays byte-identical
  // to the AC-2 fixture (AC-20).
  if (sections.size > 0) body = applySections(body, sections, ctx.cfg).body;
  return body;
}

function cmdNew(flags: Flags) {
  checkFlags(flags, cliFieldNames('new'), new Set(['json', 'input', 'dry-run']), true);
  const json = flags.has('json');
  const ctx = context(flags);

  const inputValue = flagString(flags, 'input');
  const dryRun = flags.has('dry-run');

  if (inputValue !== undefined) {
    for (const f of cliFieldNames('new')) {
      if (flags.has(f)) fail('invalid_value', '--input cannot be combined with field flags');
    }
    return cmdNewInput(ctx, inputValue, dryRun);
  }
  if (dryRun) fail('invalid_value', '--dry-run requires --input');

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

  const body = buildBody(ctx, type, cleanTitle, sections);

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

// ===================================================================== //
// `--input` — JSON plans for `new` (§ 9, DECISIONS 171 A, 172)
// ===================================================================== //

const REAL_ID_SHAPE = new RegExp('^(' + Object.values(TYPE_PREFIX).join('|') + ')-\\d+$');
const PLAN_ALLOWED_KEYS = new Set([...NEW_FIELDS, 'ref']);

interface FlatNode {
  path: string;
  raw: Record<string, unknown>;
  parentIndex: number | null; // null: top-level
  hadChildren: boolean;
}

/** A structural plan-shape error (DECISIONS 174.2): `flattenPlan` runs
 * before any node has even been assigned to `validatePlanNode`'s per-node
 * try/catch (which is what normally attaches `failed_at` from `labelOf`),
 * so these carry their own JSON path directly on the thrown `Fail` — the
 * one spot in this file a `Fail` needs an extra field to report through. */
function failAtPath(code: string, message: string, path: string): never {
  const e = new Fail(message, undefined, code) as Fail & { failedAt: string };
  e.failedAt = path;
  throw e;
}

/** Flattens the plan (array/`children` nesting) into pre-order, each node's
 * own `path` a JSON-path string from the root, always 0-indexed even for a
 * single top-level object (§ 9, DECISIONS 172 item 4). */
function flattenPlan(nodes: unknown[], basePath: string, parentIndex: number | null, out: FlatNode[]): void {
  nodes.forEach((raw, i) => {
    const nodePath = `${basePath}[${i}]`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      failAtPath('invalid_value', `plan element at ${nodePath} must be a JSON object`, nodePath);
    }
    const obj = raw as Record<string, unknown>;
    const children = obj.children;
    const rest: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) if (k !== 'children') rest[k] = obj[k];
    const myIndex = out.length;
    out.push({ path: nodePath, raw: rest, parentIndex, hadChildren: children !== undefined });
    if (children !== undefined) {
      if (!Array.isArray(children)) failAtPath('invalid_value', `'children' at ${nodePath} must be an array`, nodePath);
      flattenPlan(children, `${nodePath}.children`, myIndex, out);
    }
  });
}

interface ValidatedNode {
  type: string;
  cleanTitle: string;
  parentMode: 'top' | 'explicit' | 'implied';
  explicitParentId?: string;
  parentIndex?: number;
  status?: string;
  priority?: string;
  assignee?: string;
  tags?: string[];
  deps?: string[];
  sections: Map<string, string>;
  /** This node's own `ref`, once validated — the caller adds it to
   * `declaredSoFar` only after this node's own checks (including its own
   * `depends_on`) are done, so a self-reference never resolves (DECISIONS
   * 173: "declared earlier" never includes "declared here"). */
  ownRef?: string;
}

/** `description`/`acceptance`(`-file`) for one plan node — the JSON
 * equivalent of `readSectionFlags`, operating on already-typed JSON values
 * instead of CLI strings. `acceptance` may be an array of strings, one
 * `- [ ] …` line each (DECISIONS 172 item 6). */
function collectNodeSections(raw: Record<string, unknown>, nodePath: string, stdinState: { consumed: boolean }): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const role of SECTION_ROLES) {
    const inline = raw[role];
    const filePath = raw[role + '-file'];
    if (inline !== undefined && filePath !== undefined) {
      fail('invalid_value', `'${role}' and '${role}-file' at ${nodePath} are mutually exclusive`);
    }
    if (inline !== undefined) {
      if (role === 'acceptance' && Array.isArray(inline)) {
        for (const line of inline) if (typeof line !== 'string') fail('invalid_value', `'acceptance' array items at ${nodePath} must be strings`);
        wanted.set(role, normalizeSectionContent((inline as string[]).map((s) => `- [ ] ${s}`).join('\n')));
        continue;
      }
      if (typeof inline !== 'string') fail('invalid_value', `'${role}' at ${nodePath} must be a string${role === 'acceptance' ? ' or an array of strings' : ''}`);
      wanted.set(role, normalizeSectionContent(inline));
      continue;
    }
    if (filePath !== undefined) {
      if (typeof filePath !== 'string') fail('invalid_value', `'${role}-file' at ${nodePath} must be a string`);
      if (filePath === '-') {
        if (stdinState.consumed) fail('invalid_value', `${nodePath}: '${role}-file'='-' cannot read stdin — already consumed`);
        stdinState.consumed = true;
        let stdinText: string;
        try { stdinText = fs.readFileSync(0, 'utf8'); } catch (e: any) {
          return fail('invalid_value', `cannot read stdin — ${e.message}`);
        }
        wanted.set(role, normalizeSectionContent(stdinText));
        continue;
      }
      let text: string;
      try { text = fs.readFileSync(filePath, 'utf8'); } catch (e: any) {
        return fail('not_found', `'${role}-file': cannot read '${filePath}' — ${e.message}`);
      }
      wanted.set(role, normalizeSectionContent(text));
    }
  }
  return wanted;
}

/** Validates one flattened plan node, in the same type → title → parent →
 * status → priority → … order the single-element path uses (§ 9). Throws
 * `Fail` on the first violation — the caller attaches `failed_at`. */
function validatePlanNode(ctx: Context, node: FlatNode, flat: FlatNode[], seenRefs: Set<string>, anyRefIndex: Map<string, number>, declaredSoFar: Set<string>, stdinState: { consumed: boolean }): ValidatedNode {
  const raw = node.raw;
  for (const k of Object.keys(raw)) {
    if (!PLAN_ALLOWED_KEYS.has(k)) {
      fail('unknown_field', `unknown field '${k}' in --input plan at ${node.path}. Nothing written.`, `Known fields: ${Array.from(PLAN_ALLOWED_KEYS).join(', ')}`);
    }
  }

  const type = raw.type;
  if (type === undefined) fail('missing_argument', `--type is required (${node.path})`, `Known types: ${TYPES.join(', ')}`);
  if (typeof type !== 'string' || !TYPES.includes(type)) fail('invalid_value', `unknown type '${String(type)}' (${node.path})`, valueHint('type', String(type), TYPES));

  const titleRaw = raw.title;
  if (titleRaw === undefined || typeof titleRaw !== 'string' || normalizeTitle(titleRaw) === '') {
    fail('missing_argument', `--title is required and must not be empty (${node.path})`);
  }
  const cleanTitle = normalizeTitle(titleRaw as string);

  if ((type as string) === 'subtask' && node.hadChildren) {
    fail('invalid_target', `${node.path}: a subtask may not have children`);
  }

  const hasOwnParent = Object.prototype.hasOwnProperty.call(raw, 'parent');
  let parentMode: 'top' | 'explicit' | 'implied';
  let explicitParentId: string | undefined;
  let parentIndex: number | undefined;

  if (node.parentIndex === null) {
    if (hasOwnParent) {
      parentMode = 'explicit';
      const p = raw.parent;
      if (typeof p !== 'string') fail('invalid_value', `'parent' at ${node.path} must be a string`);
      // `parent` is never ref-aware (DECISIONS 173): a real id only, never a
      // lookup against this plan's own `ref`s. An element parented under
      // another new element in the same plan is expressed by nesting it
      // under that element's `children` instead.
      if ((p as string).startsWith('@')) {
        fail('invalid_value', `'parent' at ${node.path} is never ref-aware — '@...' is invalid; nest this element under 'children' instead of naming a ref as its parent`);
      }
      explicitParentId = checkExplicitParent(ctx, type as string, p as string);
    } else {
      if (type !== 'epic') fail('missing_argument', `'parent' is required for ${type} at ${node.path} (must be ${article(PARENT_TYPE[type as string])} ${PARENT_TYPE[type as string]})`);
      parentMode = 'top';
    }
  } else {
    if (hasOwnParent) fail('invalid_value', `${node.path}: a children entry must not also give 'parent' — its parent is implied by nesting`);
    parentMode = 'implied';
    parentIndex = node.parentIndex;
    const parentType = flat[parentIndex].raw.type as string;
    if (type === 'epic' || PARENT_TYPE[type as string] !== parentType) {
      fail('invalid_target', `${node.path}: a ${parentType} cannot have a ${String(type)} child`);
    }
  }

  const status = raw.status;
  if (status !== undefined) {
    if (typeof status !== 'string' || !ctx.cfg.statuses.includes(status)) fail('invalid_value', `unknown status '${String(status)}' (${node.path})`, valueHint('status', String(status), ctx.cfg.statuses));
  }
  const priority = raw.priority;
  if (priority !== undefined) {
    if (typeof priority !== 'string' || !PRIORITIES.includes(priority)) fail('invalid_value', `unknown priority '${String(priority)}' (${node.path})`, valueHint('priority', String(priority), PRIORITIES));
  }
  const assignee = raw.assignee;
  if (assignee !== undefined && typeof assignee !== 'string') fail('invalid_value', `'assignee' at ${node.path} must be a string`);

  const tagsRaw = raw.tags;
  if (tagsRaw !== undefined && (!Array.isArray(tagsRaw) || tagsRaw.some((t: unknown) => typeof t !== 'string'))) {
    fail('invalid_value', `'tags' at ${node.path} must be an array of strings`);
  }
  const tags = tagsRaw as string[] | undefined;

  const ref = raw.ref;
  if (ref !== undefined) {
    if (typeof ref !== 'string' || !ref.startsWith('@')) fail('invalid_value', `'ref' at ${node.path} must start with '@'`);
    if (REAL_ID_SHAPE.test(ref.slice(1))) fail('invalid_value', `'ref' at ${node.path} looks like a real id ('${ref}') — a decorated real id is never a valid ref name`);
    if (seenRefs.has(ref)) fail('invalid_value', `'${ref}' is declared on more than one object in this plan`);
    seenRefs.add(ref);
  }

  const depsRaw = raw.depends_on;
  let deps: string[] | undefined;
  if (depsRaw !== undefined) {
    if (!Array.isArray(depsRaw) || depsRaw.some((d: unknown) => typeof d !== 'string')) fail('invalid_value', `'depends_on' at ${node.path} must be an array of strings`);
    deps = depsRaw as string[];
    for (const d of deps) {
      if (d.startsWith('@')) {
        if (REAL_ID_SHAPE.test(d.slice(1))) fail('invalid_value', `depends_on entry '${d}' at ${node.path} looks like a real id, not a ref`);
        if (!anyRefIndex.has(d)) fail('not_found', `depends_on target '${d}' does not resolve to any ref declared in this plan`);
        // A ref must be declared EARLIER in the plan's write order
        // (DECISIONS 173): a forward reference — `d` exists somewhere in the
        // plan, but not among refs already declared by the time this node is
        // reached — is invalid_value, never a silent "resolves to whatever
        // gets written later." A self-reference is the boundary case of the
        // same rule: `declaredSoFar` never contains this node's own ref
        // while this node's own depends_on is being checked.
        if (!declaredSoFar.has(d)) {
          fail('invalid_value', `depends_on target '${d}' at ${node.path} is not declared earlier in the plan (a ref may only be used after the object declaring it)`,
            'move the object that declares this ref earlier in the plan, before this one');
        }
      } else if (!ctx.elements.some((e: Element) => e.id === d)) {
        fail('not_found', `depends_on target '${d}' does not exist`);
      }
    }
  }

  const sections = collectNodeSections(raw, node.path, stdinState);

  return {
    type: type as string, cleanTitle, parentMode, explicitParentId, parentIndex, status,
    priority: priority as string | undefined, assignee: assignee as string | undefined, tags, deps, sections,
    ownRef: typeof ref === 'string' ? ref : undefined,
  };
}

/** A broken internal invariant (DECISIONS 174): never caught by the write
 * loop's own catch and reported as an ordinary plan failure — it must stay
 * loud, the same uncaught crash any other `nj` bug produces, so it is never
 * mistaken for an expected, catchable failure mode like a permissions error. */
class InternalInvariantBroken extends Error {}

function emitPlanFailure(e: Fail, failedAt: string, extra?: { created: string[]; refs: Record<string, string> }): number {
  process.stderr.write(`Error: ${e.message}\n`);
  if (e.hint) process.stderr.write(`${e.hint}\n`);
  if (output.json) {
    const res: Record<string, unknown> = { ok: false, error: e.code };
    if (e.hint) res.hint = e.hint;
    if (extra) { res.created = extra.created; res.refs = extra.refs; }
    res.failed_at = failedAt;
    out(JSON.stringify(res, null, 2));
  }
  return 1;
}

/** `--dry-run`'s would-be shape (§ 9, DECISIONS 172 item 5): exactly the
 * fields given (plus the resolved parent, a JSON path when implied), the
 * same "defaults never materialised" discipline real writes have — except
 * `tags`/`depends_on`, always present as arrays, matching `entryJson`'s own
 * convention for a real entry. */
function dryRunEntry(ctx: Context, flat: FlatNode[], node: FlatNode, v: ValidatedNode): Record<string, unknown> {
  const body = buildBody(ctx, v.type, v.cleanTitle, v.sections);
  const e: Record<string, unknown> = { type: v.type };
  const parent = v.parentMode === 'explicit' ? v.explicitParentId
    : v.parentMode === 'implied' ? flat[v.parentIndex as number].path
      : undefined;
  if (parent !== undefined) e.parent = parent;
  e.title = v.cleanTitle;
  if (v.status !== undefined) e.status = v.status;
  if (v.priority !== undefined) e.priority = v.priority;
  if (v.assignee !== undefined && v.assignee !== '') e.assignee = v.assignee;
  e.tags = v.tags || [];
  e.depends_on = v.deps || [];
  const probs: string[] = [];
  if (!sectionPresent(body, ctx.cfg.sections.description)) probs.push('incomplete:description');
  if (v.type !== 'epic') {
    if (!sectionPresent(body, ctx.cfg.sections.acceptance)) probs.push('incomplete:acceptance');
    else if (!sectionHasCheckbox(body, ctx.cfg.sections.acceptance)) probs.push('acceptance:no_checkbox');
  }
  e._problems = probs.sort();
  return e;
}

function cmdNewInput(ctx: Context, inputValue: string, dryRun: boolean) {
  const rawText = readInputText(inputValue);
  const parsed = parseInputJson(rawText);
  if (parsed === null || typeof parsed !== 'object') fail('invalid_value', '--input must be a JSON object or an array of objects');
  const isSingular = !Array.isArray(parsed);
  const topArray = (isSingular ? [parsed] : parsed) as unknown[];
  if (topArray.length === 0) fail('invalid_value', '--input array must not be empty');

  const flat: FlatNode[] = [];
  try {
    flattenPlan(topArray, '', null, flat);
  } catch (e) {
    if (e instanceof Fail) return emitPlanFailure(e, (e as Fail & { failedAt?: string }).failedAt ?? '[0]');
    throw e;
  }

  const anyRefIndex = new Map<string, number>();
  for (let i = 0; i < flat.length; i++) {
    const r = flat[i].raw.ref;
    if (typeof r === 'string' && !anyRefIndex.has(r)) anyRefIndex.set(r, i);
  }

  const labelOf = (n: FlatNode) => (typeof n.raw.ref === 'string' && n.raw.ref !== '' ? (n.raw.ref as string) : n.path);
  const stdinState = { consumed: inputValue === '-' };
  const seenRefs = new Set<string>();
  // Refs available to `depends_on`, as of "earlier in write order" (DECISIONS
  // 173) — grows one node at a time, strictly AFTER that node's own checks
  // (including its own `depends_on`) finish, so a forward or self reference
  // never resolves.
  const declaredSoFar = new Set<string>();

  const validated: ValidatedNode[] = [];
  for (let i = 0; i < flat.length; i++) {
    try {
      const v = validatePlanNode(ctx, flat[i], flat, seenRefs, anyRefIndex, declaredSoFar, stdinState);
      validated.push(v);
      if (v.ownRef !== undefined) declaredSoFar.add(v.ownRef);
    } catch (e) {
      if (e instanceof Fail) return emitPlanFailure(e, labelOf(flat[i]));
      throw e;
    }
  }

  if (dryRun) {
    const entries = flat.map((node, i) => dryRunEntry(ctx, flat, node, validated[i]));
    if (output.json) out(JSON.stringify({ ok: true, dry_run: true, entries }, null, 2));
    else for (const e of entries) out(`would create: ${(e as any).type} "${(e as any).title}"`);
    return 0;
  }

  let elements = ctx.elements.slice();
  const created: string[] = [];
  const realIdByIndex: (string | undefined)[] = [];
  const refRealId = new Map<string, string>();
  const entries: EntryJson[] = [];
  let lastFields: Map<string, string | string[]> | undefined;
  let lastSections: Map<string, string> | undefined;

  for (let i = 0; i < flat.length; i++) {
    const node = flat[i];
    const v = validated[i];
    try {
      const liveCtx = Object.assign({}, ctx, { elements }) as Context;
      const parentId = v.parentMode === 'explicit' ? v.explicitParentId
        : v.parentMode === 'implied' ? realIdByIndex[v.parentIndex as number]
          : undefined;

      let id = '', dir = '', file = '';
      for (let attempt = 0; ; attempt++) {
        id = allocateId(liveCtx.idsDir, v.type, liveCtx.elements);
        dir = path.join(liveCtx.backlog, ...newPlace(liveCtx, v.type, id, parentId).split('/'));
        file = path.join(dir, id + '.md');
        if (!collidesCaseInsensitively(dir, id + '.md')) break;
        if (attempt >= 100) return hardExit('id_allocation_failed', `nj: id allocation failed after 100 retries (${id} collides with an existing file)`);
      }
      realIdByIndex[i] = id;

      // Validation guarantees every `@ref` was declared earlier in write
      // order, so by the time its own depends_on is resolved here the ref's
      // real id is already in `refRealId` — asserted, not assumed (D173: a
      // validator gap once let this silently write the string "undefined").
      // A failure here means a VALIDATION invariant broke, not a plan the
      // caller gave us wrong — it must stay loud (DECISIONS 174), never
      // dressed up as a normal plan failure by the catch below.
      const resolvedDeps = (v.deps || []).map((d) => {
        if (!d.startsWith('@')) return d;
        const real = refRealId.get(d);
        if (real === undefined) throw new InternalInvariantBroken(`unresolved ref '${d}' reached the write phase at ${node.path} — this must have been caught at validation`);
        return real;
      });

      const ts = nowIso();
      const fields: Map<string, string | string[]> = new Map();
      fields.set('id', id);
      fields.set('type', v.type);
      if (parentId !== undefined) fields.set('parent', parentId);
      fields.set('title', v.cleanTitle);
      fields.set('status', v.status === undefined ? ctx.cfg.statuses[0] : v.status);
      if (v.priority !== undefined) fields.set('priority', v.priority);
      if (v.assignee !== undefined && v.assignee !== '') fields.set('assignee', v.assignee);
      if (v.tags !== undefined && v.tags.length > 0) fields.set('tags', v.tags);
      if (resolvedDeps.length > 0) fields.set('depends_on', resolvedDeps);
      fields.set('created', ts);
      fields.set('updated', ts);
      lastFields = fields;
      lastSections = v.sections;

      const body = buildBody(ctx, v.type, v.cleanTitle, v.sections);

      fs.mkdirSync(dir, { recursive: true });
      atomicWrite(file, serialize(fields, Array.from(fields.keys()), body));
      created.push(id);
      // `refs` lists only elements actually written (DECISIONS 174): a ref
      // set before the write could succeed would point at an id nothing
      // was ever written to if THIS write then failed -- the same class of
      // silent wrong answer D173 removed from depends_on. Earlier nodes'
      // refs are already in `refRealId` by the time this node's own
      // depends_on is resolved above, so deferring this node's own entry
      // to here changes nothing else.
      if (typeof node.raw.ref === 'string') refRealId.set(node.raw.ref, id);

      const el = loadElement(file, liveCtx.backlog, liveCtx.cfg);
      elements = elements.concat([el]);
      deriveGraph(elements, liveCtx.idsDir, liveCtx.cfg.layout);
      entries.push(entryJson(el, ctx.backlog, ctx.cfg));
    } catch (e) {
      refreshStatus(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }) as Context);
      // A broken internal invariant (DECISIONS 174) must stay loud, not be
      // dressed up as a normal plan failure — it propagates uncaught, same
      // as any other `nj` bug.
      if (e instanceof InternalInvariantBroken) throw e;
      const extra = created.length > 0 ? { created, refs: Object.fromEntries(refRealId) } : undefined;
      if (e instanceof Fail) return emitPlanFailure(e, labelOf(node), extra);
      // ANY other error — a raw OS error (EACCES, ENOSPC, …) from mkdirSync/
      // atomicWrite, not a `Fail` this command throws on purpose — is a
      // real, catchable mid-plan write failure (DECISIONS 174): reported as
      // internal_error, the same code an identical failure already gets
      // from a plain `nj set` on a read-only target, with the same
      // additive created/refs/failed_at a thrown Fail already gets here.
      // The message keeps the stack, matching nj.ts's own top-level
      // "anything that reaches here keeps its stack" convention.
      const err = e as { message?: string; stack?: string } | undefined;
      const wrapped = new Fail(err && err.stack ? err.stack : String(e), undefined, 'internal_error');
      return emitPlanFailure(wrapped, labelOf(node), extra);
    }
  }

  refreshStatus(ctx.backlog, ctx.cfg, Object.assign({}, ctx, { elements }) as Context);

  if (isSingular && flat.length === 1) {
    const fields = lastFields as Map<string, string | string[]>;
    const sections = lastSections as Map<string, string>;
    const changed: string[] = FIELD_ORDER.filter((f: string) => fields.has(f) && f !== 'created' && f !== 'updated')
      .concat(SECTION_ROLES.filter((r: string) => sections.has(r)));
    const el = elements[elements.length - 1];
    if (output.json) emitWriteResult(true, el, changed, ctx.backlog, ctx.cfg);
    else writeFeedback(el, ctx.cfg, `${created[0]} created → ${el.file}`);
    return 0;
  }

  const refsObj = Object.fromEntries(refRealId);
  if (output.json) {
    out(JSON.stringify({ ok: true, ids: created, entries, refs: refsObj, _problems: [] }, null, 2));
  } else {
    out(`created: ${created.join(', ')}`);
  }
  return 0;
}

export { cmdNew, checkExplicitParent, article };
