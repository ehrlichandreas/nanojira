'use strict';

// Loading elements and deriving the graph.

const fs = require('fs');
const path = require('path');
const { listMd } = require('./config.js');
const { PREFIX_TYPE, TYPE_DIR, TYPES, PARENT_TYPE, PRIORITIES } = require('./constants.js');
const { parseFile, h1Of, sectionPresent, normalizeTitle } = require('./parse.js');
const { mtimeIso, readTombstones } = require('./store.js');

// ------------------------------------------------------------- element load

// A file we cannot read at all yields a stub: it stays visible and is marked,
// but no content-derived code is invented for it (§ 7, `file:unreadable`).
function unreadableElement(file, folder, cfg, err) {
  const base = path.basename(file, '.md');
  const pm = /^(EPIC|TSK|SUB)-/.exec(base);
  const ts = mtimeIso(file);
  return {
    file, folder, raw: null, body: '', fields: new Map(), order: [],
    parsed: false, readable: false,
    detail: [{ code: 'file:unreadable', message: `cannot be read — ${err.message}` }],
    problems: new Set(['file:unreadable']),
    archived: folder === 'archive',
    id: base,
    type: pm ? PREFIX_TYPE[pm[1]] : (Object.keys(TYPE_DIR).find((t) => TYPE_DIR[t] === folder) || null),
    title: '', status: cfg.statuses[0], parent: null, priority: 'normal',
    assignee: '', tags: [], depends_on: [],
    created: ts, updated: ts, archivedAt: null,
  };
}

// Nine derivers, run in the fixed order below. UNLIKE deriveGraph's mark
// passes (§ derivations, "no pass may read another pass's `problems` set"),
// these are NOT free to reorder: each writes an `el.*` field that a LATER one
// reads, and misordering them is NOT caught by a crash — it silently produces
// a different result.
//
//   deriveId      -> el.id       -> deriveType         (prefix comes from the id)
//   deriveType    -> el.type     -> deriveParent        (epic rule vs. orphaned)
//                                -> deriveBody          (acceptance only task/subtask)
//   deriveStatus  -> el.status   -> deriveArchiveState  (archive:not_done)
//   deriveTitle   -> el.title    -> deriveBody          (H1 comparison)
//   skeleton      -> el.archived -> deriveType, deriveArchiveState
//
// Example of the silent failure: run deriveParent before deriveType and
// `el.type` is `undefined`, not yet `null` or a type string, when
// deriveParent reads it. The task/subtask case does NOT diverge — `undefined
// !== null` is as true as `'task' !== null`, so `parent:orphaned` still fires
// correctly on a missing parent. What silently disappears is the EPIC case:
// `el.type === 'epic'` is false while `el.type` is still `undefined`, so an
// epic that DOES carry a `parent:` line no longer gets `parent:hierarchy` —
// not a crash, just a missing warning on a file that should have one. Only
// deriveOptionals and deriveTimestamps are free: they read `fields`/`file`
// only, and nothing inside loadElement reads what they write.

function deriveId(el, p, base) {
  let id = p.fields.get('id');
  if (typeof id !== 'string' || id.trim() === '') {
    id = base;
    if (p.parsed) el.problems.add('id:derived');
  } else {
    id = id.trim();
    if (id !== base) el.problems.add('id:mismatch');
  }
  el.id = id;
}

// The folder-lookup fallback that used to sit here is GONE, deliberately, not
// merely simplified: `TYPE_DIR` is keyed by TYPE ('epic' -> 'epics'), so
// looking it up BY FOLDER (`TYPE_DIR[folder]`) is always `undefined` for every
// real folder, and the reverse search over `TYPE_DIR`'s values never matches
// 'archive' either — both branches always produced `null`. This is not a bug
// to fix: § 7 (SPECIFICATION.md:325) defines `type:derived` as "derived from
// ID prefix", not from the folder, and § 14 (SPECIFICATION.md:908) states the
// precedence outright — "frontmatter > prefix > folder precedence; the folder
// loses". Reinstating a folder-based type would violate the spec, not repair
// it; if this needs to come back, it needs a decision, not a refactor.
function deriveType(el, p, folder) {
  const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
  const prefixType = pm ? PREFIX_TYPE[pm[1]] : null;

  const rawType = p.fields.get('type');
  if (typeof rawType === 'string' && TYPES.includes(rawType.trim())) {
    el.type = rawType.trim();
  } else if (prefixType) {
    el.type = prefixType;
    if (p.parsed) el.problems.add('type:derived');
  } else {
    el.type = null;
  }
  if (el.type === null) el.problems.add('type:folder');
  else if (!el.archived && TYPE_DIR[el.type] !== folder) el.problems.add('type:folder');
}

function deriveTitle(el, p) {
  const title = p.fields.get('title');
  el.title = typeof title === 'string' ? normalizeTitle(title) : '';
  if (el.title === '') el.problems.add('missing:title');
}

function deriveStatus(el, p, cfg) {
  const status = p.fields.get('status');
  if (typeof status !== 'string' || status.trim() === '') {
    el.status = cfg.statuses[0];
    if (p.parsed) el.problems.add('missing:status');
  } else {
    el.status = status.trim();
    if (!cfg.statuses.includes(el.status)) el.problems.add('unknown:status');
  }
}

// MUST run on every path, unconditionally — no `p.parsed` guard, no early
// return. Empty or whitespace becomes `null`, never `''`; that normalisation
// is what makes `=== null` (rather than a falsy test) correct everywhere else
// a `parent` is read. Four callers sit on it, all comparing `=== null`:
// `childMap` and `markParentEdges`/`markParentCycles` below, and the root
// filter in `cmdTree` (`lib/cmd-tree.js`). Route this behind a condition that
// not every element reaches, and an element with a blank `parent:` line gets
// `''` instead of `null` — `childMap` then groups it under the key `''`
// instead of treating it as a root, silently, and nothing here would notice.
function deriveParent(el, p) {
  const parent = p.fields.get('parent');
  el.parent = typeof parent === 'string' && parent.trim() !== '' ? parent.trim() : null;
  if (el.type === 'epic') {
    if (el.parent !== null) el.problems.add('parent:hierarchy');
  } else if (el.type !== null && el.parent === null) {
    el.problems.add('parent:orphaned');
  }
}

function deriveOptionals(el, p) {
  const pri = p.fields.get('priority');
  if (typeof pri !== 'string' || pri.trim() === '') {
    el.priority = 'normal';
  } else {
    el.priority = pri.trim();
    // The value stays in the file untouched; only the sort weight falls back (§ 7).
    if (!PRIORITIES.includes(el.priority)) el.problems.add('unknown:priority');
  }

  // Deliberately NOT normalised to `null` like `parent` above — a missing
  // `assignee` stays `''`. `cmdSet` (lib/cmd-set.js) compares
  // `assignee !== el.assignee` and turns a `''` into an `undefined` override,
  // which is how `nj set --assignee=` deletes the field. Unifying this with
  // `parent`'s `null` convention would silently change that delete behaviour.
  const asg = p.fields.get('assignee');
  el.assignee = typeof asg === 'string' ? asg : '';

  el.tags = Array.isArray(p.fields.get('tags')) ? p.fields.get('tags') : [];
  el.depends_on = Array.isArray(p.fields.get('depends_on')) ? p.fields.get('depends_on') : [];
}

function deriveTimestamps(el, p, file) {
  for (const [field, code] of [['created', 'missing:created'], ['updated', 'missing:updated']]) {
    const v = p.fields.get(field);
    if (typeof v !== 'string' || v.trim() === '') {
      el[field] = mtimeIso(file);
      if (p.parsed) el.problems.add(code);
    } else {
      el[field] = v.trim();
    }
  }
}

function deriveArchiveState(el, p) {
  const arch = p.fields.get('archived');
  el.archivedAt = typeof arch === 'string' && arch.trim() !== '' ? arch.trim() : null;
  if (el.archived && el.status !== 'done') el.problems.add('archive:not_done');
}

function deriveBody(el, p, cfg) {
  const h1 = h1Of(p.body);
  if (h1 !== null && el.title !== '' && h1 !== el.title) el.problems.add('title:h1_mismatch');

  if (p.parsed) {
    const descOk = sectionPresent(p.body, cfg.sections.description);
    if (!descOk) el.problems.add('incomplete:description');
    if (el.type === 'task' || el.type === 'subtask') {
      if (!sectionPresent(p.body, cfg.sections.acceptance)) el.problems.add('incomplete:acceptance');
    }
  }
}

function loadElement(file, folder, cfg) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return unreadableElement(file, folder, cfg, err);
  }
  const p = parseFile(raw);
  const problems = new Set();
  for (const d of p.problems) problems.add(d.code);

  const base = path.basename(file, '.md');
  const el = {
    file, folder, raw, body: p.body, fields: p.fields, order: p.order,
    parsed: p.parsed, readable: true, detail: p.problems, problems,
    archived: folder === 'archive',
  };

  deriveId(el, p, base);
  deriveType(el, p, folder);
  deriveTitle(el, p);
  deriveStatus(el, p, cfg);
  deriveParent(el, p);
  deriveOptionals(el, p);
  deriveTimestamps(el, p, file);
  deriveArchiveState(el, p);
  deriveBody(el, p, cfg);

  return el;
}

function loadBacklog(backlog, cfg) {
  const elements = [];
  for (const folder of ['epics', 'tasks', 'subtasks', 'archive']) {
    for (const file of listMd(path.join(backlog, folder))) {
      elements.push(loadElement(file, folder, cfg));
    }
  }
  deriveGraph(elements, backlog);
  return elements;
}

/**
 * Index by id. FIRST WINS on duplicates: the parent-type and archive:split
 * checks below resolve through this map, so which of two same-id files they
 * see is observable. `counts` is kept separately because the map alone can no
 * longer tell whether an id appeared twice.
 */
function indexById(elements) {
  const byId = new Map();
  const counts = new Map();
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
 * memoised across deriveGraph's calls -- not because a memo breaks anything
 * today, but because it is harmless ONLY while round one has no verb that moves
 * parentage: `set` takes no `--parent` (SETTABLE_FIELDS), `doctor --fix` never
 * touches `parent`, `rm` does not re-derive after writing, and `archive`
 * presupposes a done subtree. Those are properties of this round, not
 * guarantees of the spec -- § 4 provides for re-parenting. The moment a verb
 * can move an element, an index built before the write is a real bug that no
 * net reports (DECISIONS 81); the step that brings such a verb brings the
 * fixture with it.
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
function childMap(elements) {
  const m = new Map();
  for (const e of elements) {
    if (e.parent === null) continue;
    const a = m.get(e.parent);
    if (a) a.push(e); else m.set(e.parent, [e]);
  }
  return m;
}

// A parent cycle (including a self-parent) must not recurse forever (§ 7,
// `parent:cycle`); the visited set also stops an element being listed twice.
function descendants(ctx, el) {
  // Memo safe only while no verb moves parentage -- see childMap, DECISIONS 81.
  if (!ctx.kids) ctx.kids = childMap(ctx.elements);
  const out = [];
  const seen = new Set([el.id]);
  const walk = (cur) => {
    for (const c of ctx.kids.get(cur.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

function markDuplicateIds(elements, counts) {
  for (const el of elements) {
    if (counts.get(el.id) > 1) el.problems.add('duplicate_id');
  }
}

function markParentEdges(elements, byId) {
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
function markParentCycles(elements, byId) {
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

function markDependsOnEdges(elements, byId) {
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
function markDependsOnCycles(elements, byId) {
  const state = new Map();
  const hasCycle = (id) => {
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
function markOpenChildren(elements, children) {
  for (const el of elements) {
    if (el.status !== 'done') continue;
    const kids = children.get(el.id) || [];
    if (kids.some((k) => !k.archived && k.status !== 'done')) el.problems.add('done:open_children');
  }
}

function markMissingTombstones(elements, backlog) {
  const ids = readTombstones(backlog);
  for (const el of elements) {
    if (!ids.has(el.id)) el.problems.add('id:no_tombstone');
  }
}

/**
 * Last, and MUTATING. Two readers, both on the first graph: `el.byId` in
 * isReady(), `el.children` in the children_open check of `nj set`. Commands
 * call deriveGraph a second time after writing, on a derived array, and rely
 * on the marks above landing on the real objects — a pass that computed into
 * copies would leave the feedback lines and `_problems` empty while every
 * oracle suite stayed green (pinned in the corpus, scenario
 * `attach-second-derive`).
 */
function attachGraph(elements, byId, children) {
  for (const el of elements) {
    el.byId = byId;
    el.children = children.get(el.id) || [];
  }
}

/**
 * Eight passes over the element list. They are listed here in the order they
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
function deriveGraph(elements, backlog) {
  const { byId, counts } = indexById(elements);
  markDuplicateIds(elements, counts);
  markParentEdges(elements, byId);
  markParentCycles(elements, byId);
  markDependsOnEdges(elements, byId);
  markDependsOnCycles(elements, byId);
  const children = childMap(elements);
  markOpenChildren(elements, children);
  markMissingTombstones(elements, backlog);
  attachGraph(elements, byId, children);
  return byId;
}

module.exports = { loadElement, childMap, deriveGraph, descendants, loadBacklog };
