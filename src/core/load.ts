'use strict';

// Loading elements and deriving the graph.

import type { Element, ParsedFile, Config, Context, Layout, Scan, Skeleton, WithId, WithType, WithTitle, WithStatus, WithParent, WithOptionals, WithTimestamps, WithArchiveState, NonEmptyString } from './types.ts';

import * as path from 'path';
import { PREFIX_TYPE, TYPE_FOLDER_ROLE, TYPES, PARENT_TYPE, PRIORITIES } from './constants.ts';
import { scanBacklog, folderOf, inArchive, samePlace, foldEq, expectedPlace, misplacedCode } from './layout.ts';
import { parseFile, h1Of, sectionPresent, sectionHasCheckbox, sectionCheckboxCounts, normalizeTitle } from './parse.ts';
import { mtimeIso, readTombstones } from './store.ts';
import { readElementFile } from './regular-file.ts';

// ------------------------------------------------------------- element load

/**
 * A file we cannot read at all yields a stub: it stays visible and is marked,
 * but no content-derived code is invented for it (§ 7, `file:unreadable`).
 */
function unreadableElement(file: string, folder: string, cfg: Config, err: any): Element {
  const base = path.basename(file, '.md');
  const pm = /^(EPIC|TSK|SUB)-/.exec(base);
  const ts = mtimeIso(file);
  // No frontmatter to read: the ID prefix, else the type folder it lies in.
  const byFolder = cfg.layout.group === 'type'
    ? Object.keys(TYPE_FOLDER_ROLE).find((t) => foldEq(cfg.layout.folders[TYPE_FOLDER_ROLE[t]], folder)) || null
    : null;
  return {
    file, folder, raw: null, body: '', fields: new Map(), order: [],
    parsed: false, readable: false,
    detail: [{ code: 'file:unreadable', message: `cannot be read — ${err.message}` }],
    problems: new Set(['file:unreadable']),
    archived: inArchive(folder, cfg.layout),
    id: base,
    type: pm ? PREFIX_TYPE[pm[1]] : byFolder,
    title: '', status: cfg.statuses[0], parent: null, priority: 'normal',
    assignee: '', tags: [], depends_on: [],
    created: ts, updated: ts, archivedAt: null,
  };
}

// Nine derivers, run in the fixed order below and now enforced by the type
// checker, not just asserted by a cast: each takes exactly the stage the
// PREVIOUS ones have built (Skeleton -> WithId -> WithType -> ... ->
// WithArchiveState) and returns the next stage. Swap two derivers in
// loadElement below and the earlier one's return type no longer satisfies
// the later one's parameter type -- a compile error, not a silently-accepted
// cast to the full `Element` shape regardless of how little of it exists yet
// (Verifier II's finding on the JSDoc version: the cast was right at the
// LAST call and wrong at the first, and nothing said so).
//
//   deriveId      -> el.id       -> deriveType         (prefix comes from the id)
//   deriveType    -> el.type     -> deriveParent        (epic rule vs. orphaned)
//                                -> deriveBody          (acceptance only task/subtask)
//   deriveStatus  -> el.status   -> deriveArchiveState  (archive:not_done)
//   deriveTitle   -> el.title    -> deriveBody          (H1 comparison)
//   skeleton      -> el.archived -> deriveType, deriveArchiveState
//
// Example of the silent failure this catches: run deriveParent before
// deriveType and `el.type` is `undefined`, not yet `null` or a type string,
// when deriveParent reads it. The task/subtask case does NOT diverge --
// `undefined !== null` is as true as `'task' !== null`, so `parent:orphaned`
// still fires correctly on a missing parent. What silently disappears is the
// EPIC case: `el.type === 'epic'` is false while `el.type` is still
// `undefined`, so an epic that DOES carry a `parent:` line no longer gets
// `parent:hierarchy` -- not a crash, just a missing warning on a file that
// should have one. Only deriveOptionals and deriveTimestamps are free: they
// read `fields`/`file` only, and nothing inside loadElement reads what they
// write.
//
// Each deriver returns a NEW object (`{ ...el, theFieldItAdds }`) rather than
// mutating and casting; `problems` is a `Set`, copied by reference like every
// other field, so `.add()` calls still accumulate across all nine stages
// exactly as before -- only the OUTER object per stage is a fresh reference,
// which nothing downstream depends on (loadElement returns whatever the last
// deriver produced; nothing keeps a handle on an intermediate stage).

function deriveId(el: Skeleton, p: ParsedFile, base: string): WithId {
  let id = p.fields.get('id');
  if (typeof id !== 'string' || id.trim() === '') {
    id = base;
    if (p.parsed) el.problems.add('id:derived');
  } else {
    id = id.trim();
    if (id !== base) el.problems.add('id:mismatch');
  }
  return { ...el, id };
}

// The folder-lookup fallback that used to sit here is GONE, deliberately, not
// merely simplified: `TYPE_DIR` (v2's type → folder table, now
// `layout.folders`) was keyed by TYPE ('epic' -> 'epics'), so
// looking it up BY FOLDER (`TYPE_DIR[folder]`) is always `undefined` for every
// real folder, and the reverse search over `TYPE_DIR`'s values never matches
// 'archive' either — both branches always produced `null`. This is not a bug
// to fix: § 7 (docs/SPECIFICATION.md:329) defines `type:derived` as "derived from
// ID prefix", not from the folder, and § 14 (docs/SPECIFICATION.md:916) states the
// precedence outright — "frontmatter > prefix > folder precedence; the folder
// loses". Reinstating a folder-based type would violate the spec, not repair
// it; if this needs to come back, it needs a decision, not a refactor.
// Where the file lies is checked against the layout in deriveGraph
// (`markPlaces`): under `hierarchy` the place depends on the parent chain, which
// one file alone cannot know. What stays here is the type that cannot be
// determined at all — `type:folder` in every group, as in v2.
function deriveType(el: WithId, p: ParsedFile): WithType {
  const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
  const prefixType = pm ? PREFIX_TYPE[pm[1]] : null;

  let type: string | null;
  const rawType = p.fields.get('type');
  if (typeof rawType === 'string' && TYPES.includes(rawType.trim())) {
    type = rawType.trim();
  } else if (prefixType) {
    type = prefixType;
    if (p.parsed) el.problems.add('type:derived');
  } else {
    type = null;
  }
  if (type === null) el.problems.add('type:folder');
  return { ...el, type };
}

function deriveTitle(el: WithType, p: ParsedFile): WithTitle {
  const title = p.fields.get('title');
  const t = typeof title === 'string' ? normalizeTitle(title) : '';
  if (t === '') el.problems.add('missing:title');
  return { ...el, title: t };
}

function deriveStatus(el: WithTitle, p: ParsedFile, cfg: Config): WithStatus {
  let status: string;
  const raw = p.fields.get('status');
  if (typeof raw !== 'string' || raw.trim() === '') {
    status = cfg.statuses[0];
    if (p.parsed) el.problems.add('missing:status');
  } else {
    status = raw.trim();
    if (!cfg.statuses.includes(status)) el.problems.add('unknown:status');
  }
  return { ...el, status };
}

// MUST run on every path, unconditionally — no `p.parsed` guard, no early
// return. Empty or whitespace becomes `null`, never `''`; that normalisation
// is what makes `=== null` (rather than a falsy test) correct everywhere else
// a `parent` is read. Four callers sit on it, all comparing `=== null`:
// `childMap` and `markParentEdges`/`markParentCycles` below, and the root
// filter in `cmdTree` (`commands/cmd-tree.ts`). Route this behind a condition that
// not every element reaches, and an element with a blank `parent:` line gets
// `''` instead of `null` — `childMap` then groups it under the key `''`
// instead of treating it as a root, silently, and nothing here would notice.
// `NonEmptyString` makes that a compile error now, not just a documented
// risk: `el.parent = ''` anywhere outside this cast is rejected by tsc (see
// constants.ts). This is the ONE place the brand is established.
function deriveParent(el: WithStatus, p: ParsedFile): WithParent {
  const raw = p.fields.get('parent');
  const parent = (typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null) as NonEmptyString | null;
  if (el.type === 'epic') {
    if (parent !== null) el.problems.add('parent:hierarchy');
  } else if (el.type !== null && parent === null) {
    el.problems.add('parent:orphaned');
  }
  return { ...el, parent };
}

function deriveOptionals(el: WithParent, p: ParsedFile): WithOptionals {
  let priority: string;
  const pri = p.fields.get('priority');
  if (typeof pri !== 'string' || pri.trim() === '') {
    priority = 'normal';
  } else {
    priority = pri.trim();
    // The value stays in the file untouched; only the sort weight falls back (§ 7).
    if (!PRIORITIES.includes(priority)) el.problems.add('unknown:priority');
  }

  // Deliberately NOT normalised to `null` like `parent` above — a missing
  // `assignee` stays `''`. `cmdSet` (commands/cmd-set.ts) compares
  // `assignee !== el.assignee` and turns a `''` into an `undefined` override,
  // which is how `nanojira set --assignee=` deletes the field. Unifying this with
  // `parent`'s `null` convention would silently change that delete behaviour.
  const asg = p.fields.get('assignee');
  const assignee = typeof asg === 'string' ? asg : '';

  const tags = Array.isArray(p.fields.get('tags')) ? p.fields.get('tags') as string[] : [];
  const depends_on = Array.isArray(p.fields.get('depends_on')) ? p.fields.get('depends_on') as string[] : [];
  return { ...el, priority, assignee, tags, depends_on };
}

// Unrolled rather than looped over ['created', 'updated'] -- a loop can only
// widen the return type to "some Record", the same genericity the staged
// design exists to avoid; two nearly-identical blocks keep each field's type
// exact.
function deriveTimestamps(el: WithOptionals, p: ParsedFile, file: string): WithTimestamps {
  let created: string;
  const rawCreated = p.fields.get('created');
  if (typeof rawCreated !== 'string' || rawCreated.trim() === '') {
    created = mtimeIso(file);
    if (p.parsed) el.problems.add('missing:created');
  } else {
    created = rawCreated.trim();
  }

  let updated: string;
  const rawUpdated = p.fields.get('updated');
  if (typeof rawUpdated !== 'string' || rawUpdated.trim() === '') {
    updated = mtimeIso(file);
    if (p.parsed) el.problems.add('missing:updated');
  } else {
    updated = rawUpdated.trim();
  }

  return { ...el, created, updated };
}

function deriveArchiveState(el: WithTimestamps, p: ParsedFile): WithArchiveState {
  const arch = p.fields.get('archived');
  const archivedAt = typeof arch === 'string' && arch.trim() !== '' ? arch.trim() : null;
  if (el.archived && el.status !== 'done') el.problems.add('archive:not_done');
  return { ...el, archivedAt };
}

/** Adds no field of its own -- deriveBody only reads and marks problems. */
function deriveBody(el: WithArchiveState, p: ParsedFile, cfg: Config): WithArchiveState {
  const h1 = h1Of(p.body);
  if (h1 !== null && el.title !== '' && h1 !== el.title) el.problems.add('title:h1_mismatch');

  if (p.parsed) {
    const descOk = sectionPresent(p.body, cfg.sections.description);
    if (!descOk) el.problems.add('incomplete:description');
    if (el.type === 'task' || el.type === 'subtask') {
      const acceptanceOk = sectionPresent(p.body, cfg.sections.acceptance);
      if (!acceptanceOk) {
        el.problems.add('incomplete:acceptance');
        // F, done:no_acceptance (§ 7, DECISIONS 163, 167): independent of
        // incomplete:acceptance, which still fires too -- `done` can never
        // reach --ready regardless (it isn't statuses[0]), so this is not a
        // new leniency, just a second, more specific warning on top. Live
        // elements only (DECISIONS 167): an archived element is exempt.
        if (el.status === 'done' && !el.archived) el.problems.add('done:no_acceptance');
      } else if (!sectionHasCheckbox(p.body, cfg.sections.acceptance)) {
        // E, acceptance:no_checkbox (§ 7, DECISIONS 163, 167): mutually
        // exclusive with incomplete:acceptance -- this one requires content
        // to exist at all, which the `acceptanceOk` branch above already
        // confirmed. Live elements only: an archived element is exempt.
        if (!el.archived) el.problems.add('acceptance:no_checkbox');
      } else if (el.status === 'done' && !el.archived) {
        // G, done:open_acceptance (§ 7, DECISIONS 176 B): mutually exclusive
        // with E/F by construction -- this branch only runs once a checkbox
        // section with actual checkboxes exists. Live, done elements only.
        const counts = sectionCheckboxCounts(p.body, cfg.sections.acceptance);
        if (counts && counts.unticked > 0) el.problems.add('done:open_acceptance');
      }
    }
  }
  return el;
}

function loadElement(file: string, backlog: string, cfg: Config, folder: string = folderOf(backlog, file)): Element {
  let raw;
  try {
    raw = readElementFile(file);
  } catch (err: any) {
    return unreadableElement(file, folder, cfg, err);
  }
  const p = parseFile(raw);
  const problems: Set<string> = new Set();
  for (const d of p.problems) problems.add(d.code);

  const base = path.basename(file, '.md');
  const skeleton: Skeleton = {
    file, folder, raw, body: p.body, fields: p.fields, order: p.order,
    parsed: p.parsed, readable: true, detail: p.problems, problems,
    archived: inArchive(folder, cfg.layout),
  };

  const withId = deriveId(skeleton, p, base);
  const withType = deriveType(withId, p);
  const withTitle = deriveTitle(withType, p);
  const withStatus = deriveStatus(withTitle, p, cfg);
  const withParent = deriveParent(withStatus, p);
  const withOptionals = deriveOptionals(withParent, p);
  const withTimestamps = deriveTimestamps(withOptionals, p, file);
  const withArchiveState = deriveArchiveState(withTimestamps, p);
  const final = deriveBody(withArchiveState, p, cfg);

  return final;
}

// Elements are found wherever they lie (§ 4), so a layout change never breaks
// a command between editing the configuration and running `doctor --fix`.
function loadBacklog(backlog: string, cfg: Config, idsDir: string): { elements: Element[]; scan: Scan } {
  const scan = scanBacklog(backlog, cfg.layout);
  const elements = scan.files.map(({ file, folder }) => loadElement(file, backlog, cfg, folder));
  deriveGraph(elements, idsDir, cfg);
  return { elements, scan };
}

/**
 * Index by id. FIRST WINS on duplicates: the parent-type and archive:split
 * checks below resolve through this map, so which of two same-id files they
 * see is observable. `counts` is kept separately because the map alone can no
 * longer tell whether an id appeared twice.
 */
function indexById(elements: Element[]) {
  const byId: Map<string, Element> = new Map();
  const counts: Map<string, number> = new Map();
  for (const el of elements) {
    counts.set(el.id, (counts.get(el.id) || 0) + 1);
    if (!byId.has(el.id)) byId.set(el.id, el);
  }
  return { byId, counts };
}

/**
 * Parent → children, in scan order. The single implementation; it serves three
 * DIFFERENT input sets and must keep serving all three:
 *   - deriveGraph's element array, rebuilt on every one of its five calls
 *   - cmdTree's `scope`, a FILTERED array (archived hidden without --all)
 *   - descendants(), over the whole context
 * None of them may be quietly turned into another. In particular this is not
 * memoised across deriveGraph's calls: `set --parent` (v3.9) moves an element
 * under another parent, and an index built before that write is a real bug
 * that no net reports (DECISIONS 81). (`doctor --fix` never touches `parent`,
 * `rm` does not re-derive after writing, and `archive` presupposes a done
 * subtree, so `set --parent` is the one verb that moves parentage today.)
 *
 * Depends on the `parent` normalisation in deriveParent: empty or whitespace
 * becomes `null`, never `''`. That is what makes `=== null` here equivalent to
 * a falsy test — without it the two would part ways on a blank `parent:` line.
 * Neither side used to say so, which is how an invariant disappears.
 *
 * Built once per call rather than scanning the whole element list per node:
 * that scan-per-node made `tree`, `rm --cascade` and `archive` O(n²) — 971 ms
 * at 10 000 elements against ~222 ms with the map (§ 13). Insertion order is
 * the scan order, so the unsorted callers keep their output byte for byte.
 */
function childMap(elements: Element[]) {
  const m: Map<string, Element[]> = new Map();
  for (const e of elements) {
    if (e.parent === null) continue;
    const a = m.get(e.parent);
    if (a) a.push(e); else m.set(e.parent, [e]);
  }
  return m;
}

// A parent cycle (including a self-parent) must not recurse forever (§ 7,
// `parent:cycle`); the visited set also stops an element being listed twice.
function descendants(ctx: Context, el: Element) {
  // Memo safe only while no verb moves parentage -- see childMap, DECISIONS 81.
  if (!ctx.kids) ctx.kids = childMap(ctx.elements);
  const out: Element[] = [];
  const seen = new Set([el.id]);
  const walk = (cur: Element) => {
    for (const c of (ctx.kids as Map<string, Element[]>).get(cur.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

function markDuplicateIds(elements: Element[], counts: Map<string, number>) {
  for (const el of elements) {
    if ((counts.get(el.id) as number) > 1) el.problems.add('duplicate_id');
  }
}

function markParentEdges(elements: Element[], byId: Map<string, Element>) {
  for (const el of elements) {
    if (el.parent === null) continue;
    const p = byId.get(el.parent);
    if (!p) { el.problems.add('parent:dangling'); continue; }
    if (el.type && PARENT_TYPE[el.type] && p.type && p.type !== PARENT_TYPE[el.type]) {
      el.problems.add('parent:hierarchy');
    }
    if (p.archived && !el.archived) el.problems.add('archive:split');
  }
}

/** Walks upward per element; the seen set is what stops a self-parent (§ 7). */
function markParentCycles(elements: Element[], byId: Map<string, Element>) {
  for (const el of elements) {
    const seen = new Set([el.id]);
    let cur = el;
    for (;;) {
      if (cur.parent === null) break;
      if (seen.has(cur.parent)) { el.problems.add('parent:cycle'); break; }
      seen.add(cur.parent);
      const next = byId.get(cur.parent);
      if (!next) break;
      cur = next;
    }
  }
}

function markDependsOnEdges(elements: Element[], byId: Map<string, Element>) {
  for (const el of elements) {
    for (const dep of el.depends_on) {
      const t = byId.get(dep);
      if (!t) { el.problems.add('depends_on:dangling'); continue; }
      if (t.archived) el.problems.add('active_refs_archived');
    }
  }
}

/**
 * The memo is cleared PER ELEMENT, and that is semantics, not a missed
 * optimisation: without the reset only the first member of a cycle reaching
 * `hasCycle` would be marked, and the rest would be memoised as 'done'. The
 * reset is what makes every member of a 3-cycle carry `depends_on:cycle`.
 * Keeping it costs a re-walk per element; removing it would change WHICH
 * elements carry the code.
 */
function markDependsOnCycles(elements: Element[], byId: Map<string, Element>) {
  const state: Map<string, string> = new Map();
  const hasCycle = (id: string): boolean => {
    const st = state.get(id);
    if (st === 'done') return false;
    if (st === 'open') return true;
    const el = byId.get(id);
    if (!el) return false;
    state.set(id, 'open');
    for (const dep of el.depends_on) {
      if (hasCycle(dep)) { state.set(id, 'done'); return true; }
    }
    state.set(id, 'done');
    return false;
  };
  for (const el of elements) {
    state.clear();
    if (hasCycle(el.id)) el.problems.add('depends_on:cycle');
  }
}

/** Archived children count as done — § 11's "archived ⇒ done" (decision 23). */
function markOpenChildren(elements: Element[], children: Map<string, Element[]>) {
  for (const el of elements) {
    if (el.status !== 'done') continue;
    const kids = children.get(el.id) || [];
    if (kids.some((k) => !k.archived && k.status !== 'done')) el.problems.add('done:open_children');
  }
}

/**
 * A file off the place its layout gives it (§ 4). Unreadable stubs are
 * exempt, as in v2 — nothing about them is known but the file name — and so
 * is an element whose place cannot be determined (unknown type, or a
 * hierarchy parent chain that dangles or cycles): its own error says why
 * (DECISIONS 91 B15).
 */
function markPlaces(elements: Element[], byId: Map<string, Element>, layout: Layout) {
  const code = misplacedCode(layout);
  for (const el of elements) {
    if (!el.readable) continue;
    const want = expectedPlace(el, byId, layout);
    if (want !== null && !samePlace(want, el.folder, layout)) el.problems.add(code);
  }
}

function markMissingTombstones(elements: Element[], idsDir: string, shardSize: number) {
  const ids = readTombstones(idsDir, shardSize);
  for (const el of elements) {
    if (!ids.has(el.id)) el.problems.add('id:no_tombstone');
  }
}

/**
 * Last, and MUTATING. Two readers, both on the first graph: `el.byId` in
 * isReady(), `el.children` in the children_open check of `nanojira set`. Commands
 * call deriveGraph a second time after writing, on a derived array, and rely
 * on the marks above landing on the real objects — a pass that computed into
 * copies would leave the feedback lines and `_problems` empty while every
 * oracle suite stayed green (pinned in the corpus, scenario
 * `attach-second-derive`).
 */
function attachGraph(elements: Element[], byId: Map<string, Element>, children: Map<string, Element[]>) {
  for (const el of elements) {
    el.byId = byId;
    el.children = children.get(el.id) || [];
  }
}

/**
 * Eleven steps over the element list: two index builds (indexById, childMap) and
 * nine passes. They are listed here in the order they
 * must run: the index builds sit exactly where they sat before, because the
 * children index is built after the cycle pass and hoisting it would reorder
 * execution for no gain.
 *
 * RULE FOR WHOEVER ADDS THE NEXT PASS: a pass must not read another pass's
 * `problems` set. Today none does — every access is an `.add` — and that alone
 * is why the order of the mark passes is free and reordering them is
 * unobservable. The first pass that reads what another wrote makes the order
 * load-bearing, and nothing here would notice the breach.
 */
function deriveGraph(elements: Element[], idsDir: string, cfg: Config) {
  const { byId, counts } = indexById(elements);
  markDuplicateIds(elements, counts);
  markParentEdges(elements, byId);
  markParentCycles(elements, byId);
  markDependsOnEdges(elements, byId);
  markDependsOnCycles(elements, byId);
  const children = childMap(elements);
  markOpenChildren(elements, children);
  markPlaces(elements, byId, cfg.layout);
  markMissingTombstones(elements, idsDir, cfg.ids.shardSize);
  attachGraph(elements, byId, children);
  return byId;
}

export { loadElement, childMap, deriveGraph, descendants, loadBacklog };
