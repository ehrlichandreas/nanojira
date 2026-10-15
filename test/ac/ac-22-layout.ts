/* AC-22 — Layout (spec v3, V3-2).
 *
 * § 15 AC-22: "For each group (`type`, `hierarchy`, `flat`) and for renamed
 * folders: `new`, `archive`, `rm` and `rm --cascade` put and remove files
 * exactly where § 4, § 11 and § 12 say; `list`, `tree`, `show` and `--json`
 * give the same answers in every group, apart from file paths. Changing
 * `group` or a folder name on a populated backlog: every element reports
 * `type:folder` or `layout:misplaced`, commands keep working, one
 * `doctor --fix` moves everything, a following `doctor` is clean, and every
 * element file is byte-identical to before the move. Under `hierarchy` a
 * hand-edited `parent` makes the file `layout:misplaced`, and `--fix` moves
 * it; an unresolvable `parent` chain is reported and never moved."
 *
 * § 4 (groupings, "found wherever they lie"), § 5 (layout block), § 7
 * (`type:folder` for group `type`, `layout:misplaced` for the others), § 11
 * (archive placement per group), § 12 (folders under `hierarchy`), § 14
 * `--fix` step 3; DECISIONS 90–94 where they rule V3-2 points.
 *
 * Sections: B1 placement per group and folder names (new/rm/rm --cascade/
 * archive), B2 same answers in every group, B3 changing the layout + one
 * --fix, B4 hand-edited parent under hierarchy, B5 unresolvable chain never
 * moved, B6 elements found wherever they lie. The clause map is mirrored in
 * AC-MATRIX.md.
 *
 * STORAGE. Since V3-4 the configuration lives at `.nanojira/config.json`
 * and tombstones in `.nanojira/ids/` — CONFIG_REL and IDS_REL below, taken
 * from the harness. STATUS.md (V3-3) is not asserted on.
 *
 * v2 COMPATIBILITY. Group `type` is v2 behaviour, so every `type` leg built
 * WITHOUT a `layout` block (§ 5: "a missing `layout` … means the default")
 * must pass against v2 `dist/nj`; legs that need a `layout` block are v3.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult, JsonRunResult } from '../lib/harness.ts';
const T = H.T;

/* ---- storage paths, from the harness (§ 4 v3 layout) ----------------- */
const CONFIG_REL = H.CONFIG_REL;
const IDS_REL = H.IDS_REL;

const NOW = H.FIXED_NOW;
const DEFAULT_FOLDERS = { epics: 'epics', tasks: 'tasks', subtasks: 'subtasks', archive: 'archive' };

/* The layout `block` (configuration input), the per-element `model` dict,
 * and the derived `Layout` are all genuinely dynamic, free-form shapes
 * (a fixture-authoring DSL, not the CLI's own JSON contract) — typed as
 * `any`/loose records throughout this file rather than modelled precisely. */
type Block = any;
type ElModel = Record<string, any>;
interface Layout {
  block: Block;
  group: string;
  folders: Record<string, string>;
}

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }
function out(r: RunResult) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

/* ---- the layout model, from § 4 and § 11 ----------------------------- */

/**
 * A layout as the suite understands it. `block` is what goes into the
 * configuration: `undefined` writes no `layout` key at all.
 */
function layoutOf(block: Block): Layout {
  const b = block || {};
  return {
    block,
    group: b.group || 'type',
    folders: Object.assign({}, DEFAULT_FOLDERS, b.folders || {}),
  };
}

/**
 * Where § 4 / § 11 put an element, relative to the backlog.
 *   type       <folder of type>/<id>.md; archived: <archive>/<id>.md
 *   flat       <id>.md;                  archived: <archive>/<id>.md
 *   hierarchy  EPIC/EPIC.md, EPIC/TSK/TSK.md, EPIC/TSK/SUB.md;
 *              archived: the same below <archive>/. An element without
 *              `parent` sits at the top of the tree (DECISIONS 91 B15):
 *              TSK/TSK.md, SUB.md.
 * The `archived` flag of the model decides the target (DECISIONS 92 Q2).
 */
function placeOf(L: Layout, model: ElModel, id: string): string {
  const el = model[id];
  const arch = !!el.archived;
  if (L.group === 'type') {
    const folder = arch ? L.folders.archive : L.folders[el.type + 's'];
    return folder + '/' + id + '.md';
  }
  if (L.group === 'flat') return (arch ? L.folders.archive + '/' : '') + id + '.md';
  const dirs: string[] = [];
  for (let p = el.parent; p; p = model[p].parent) dirs.unshift(p);
  if (el.type !== 'subtask') dirs.push(id);
  return (arch ? L.folders.archive + '/' : '') + dirs.concat([id + '.md']).join('/');
}

/* A model is { id: {type, parent, status, archived, title, incomplete} }. */
function el(type: string, parent: string | undefined, status?: string, extra?: Record<string, any>): any {
  return Object.assign({ type, parent, status: status || 'todo' }, extra || {});
}

function elementBytes(id: string, e: any): string {
  const title = e.title || ('Title ' + id);
  const fields: Record<string, unknown> = { id, type: e.type, parent: e.parent, title, status: e.status, created: NOW, updated: NOW };
  if (e.archived) fields.archived = NOW;
  let body = '# ' + title + '\n\n## Description\nSomething.\n';
  // Ticked for a live `done` element: an unticked box there would also carry
  // done:open_acceptance (D176 B), which these layout fixtures do not pin.
  if (e.type !== 'epic' && !e.incomplete) body += '\n## Acceptance Criteria\n- [' + (e.status === 'done' ? 'x' : ' ') + '] It works\n';
  return H.element(fields, body);
}

function configBytes(block: Block): string {
  const c: any = {
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  };
  if (block !== undefined) c.layout = block;
  return JSON.stringify(c, null, 2) + '\n';
}

function writeConfig(bl: string, block: Block): void {
  const p = path.join(bl, CONFIG_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, configBytes(block));
}

/**
 * A hand-built backlog with every element at its place under `block`.
 * Group `type` gets its four folders, as `nj init` lays them out; every
 * group gets its archive folder. Returns { dir, bl, L, model }.
 */
function mkLayoutBacklog(label: string, block: Block, model: ElModel): { dir: string; bl: string; L: Layout; model: ElModel } {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const L = layoutOf(block);
  fs.mkdirSync(path.join(bl, IDS_REL), { recursive: true });
  writeConfig(bl, block);
  fs.writeFileSync(path.join(bl, '.gitignore'), H.GITIGNORE);
  fs.writeFileSync(path.join(bl, 'README.md'), '# Backlog\n\nFormat notes.\n');
  const folders: string[] = L.group === 'type' ? Object.values(L.folders) : [L.folders.archive];
  for (const f of folders) fs.mkdirSync(path.join(bl, f), { recursive: true });
  for (const id of Object.keys(model)) {
    writeFile(bl, placeOf(L, model, id), elementBytes(id, model[id]));
    fs.writeFileSync(path.join(bl, IDS_REL, id), '');
  }
  H.writeStatus(bl);      // a fresh overview, as every hand-built fixture has (DECISIONS 100)
  H.writeTags(bl);
  return { dir, bl, L, model };
}

function writeFile(bl: string, rel: string, content: string): string {
  const p = path.join(bl, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/* Every *.md below the backlog except the top README.md and STATUS.md and
 * anything under the bookkeeping places — the element files, as § 4 counts
 * them. */
function mdFiles(bl: string): string[] {
  const res: string[] = [];
  const skip = new Set([CONFIG_REL, IDS_REL, '.nanojira'].map(s => s.split('/')[0]));
  (function walk(d: string, rel: string) {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (!rel && skip.has(e.name)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.name.endsWith('.md') && r !== 'README.md' && r !== 'STATUS.md' && r !== 'TAGS.md') res.push(r);
    }
  })(bl, '');
  return res.sort();
}

function expectedFiles(L: Layout, model: ElModel): string[] {
  return Object.keys(model).map(id => placeOf(L, model, id)).sort();
}

function isDir(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

function run(args: string[], bl: string): RunResult { return H.runNj(args, { cwd: path.dirname(bl), unsetEnv: ['NJ_BACKLOG'] }); }
function runJ(args: string[], bl: string): JsonRunResult { return H.runJson(args, { cwd: path.dirname(bl), unsetEnv: ['NJ_BACKLOG'] }); }

function entriesById(json: any): Record<string, any> {
  const m: Record<string, any> = {};
  for (const e of (json && Array.isArray(json.entries) ? json.entries : [])) m[e.id] = e;
  return m;
}

function doctorClean(desc: string, bl: string): JsonRunResult {
  const r = runJ(['doctor'], bl);
  T.exit(desc + ': doctor exits 0', r, 0);
  T.eq(desc + ': doctor reports no problem', H.doctorSet(r), []);
  return r;
}

/* § 11: archive adds `archived:` and refreshes `updated`; nothing else
 * changes. Under the pinned clock `updated` keeps its value, so every
 * archived file must be the fixture bytes with `archived:` in canonical
 * order (§ 7) — exactly what elementBytes() renders for an archived model. */
function archivedBytes(desc: string, bl: string, L: Layout, model: ElModel, ids: string[]) {
  for (const id of ids) {
    T.eq(desc + ': ' + id + ' is its old bytes plus archived: (§ 11)',
      H.readOrNull(path.join(bl, placeOf(L, model, id))), elementBytes(id, model[id]));
  }
}

/* ===================================================================== */
/* B1 — placement per group and folder names: new, rm, rm --cascade,     */
/*      archive put and remove files where § 4, § 11, § 12 say           */
/* ===================================================================== */

function baseModel(): ElModel {
  return {
    'EPIC-001': el('epic', undefined, 'todo'),
    'TSK-001': el('task', 'EPIC-001', 'todo'),
    'SUB-001': el('subtask', 'TSK-001', 'todo'),
    'EPIC-002': el('epic', undefined, 'done'),
    'TSK-002': el('task', 'EPIC-002', 'done'),
    'SUB-002': el('subtask', 'TSK-002', 'done'),
    'TSK-005': el('task', 'EPIC-001', 'done'),
    'SUB-005': el('subtask', 'TSK-005', 'done'),
  };
}

const RENAMED = { epics: 'Big', tasks: 'work_items', subtasks: 'small-1', archive: 'shelf' };

const VARIANTS = [
  { name: 'type, no layout block (v2 behaviour)', block: undefined },
  { name: 'type, explicit default layout', block: { group: 'type', folders: Object.assign({}, DEFAULT_FOLDERS), statusFile: true } },
  { name: 'type, renamed folders', block: { group: 'type', folders: RENAMED } },
  /* DECISIONS 97 (56): a subset of the folder keys; the others default */
  { name: 'type, folders subset (tasks only)', block: { group: 'type', folders: { tasks: 'work_items' } } },
  { name: 'flat', block: { group: 'flat' } },
  { name: 'flat, renamed archive', block: { group: 'flat', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) } },
  { name: 'hierarchy', block: { group: 'hierarchy' } },
  { name: 'hierarchy, renamed archive', block: { group: 'hierarchy', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) } },
];

for (const V of VARIANTS) {
  const tag = 'B1 [' + V.name + ']';
  const fx = mkLayoutBacklog('ac22-b1', V.block, baseModel());
  const { bl, L, model } = fx;
  const hier = L.group === 'hierarchy';
  const files = () => mdFiles(bl);

  T.eq(tag + ' fixture: every file at its place', files(), expectedFiles(L, model));
  doctorClean(tag + ' fixture as built', bl);

  /* § 12: under hierarchy, an existing folder is reused by `new` */
  if (hier) writeFile(bl, 'EPIC-003/keep.txt', 'kept\n');

  const ne = runJ(['new', '--type=epic', '--title=Third'], bl);
  T.exit(tag + ' new epic: exit 0', ne, 0);
  T.eq(tag + ' new epic: EPIC-003', ne.json && ne.json.id, 'EPIC-003');
  model['EPIC-003'] = el('epic', undefined, 'todo');
  const nt = runJ(['new', '--type=task', '--parent=EPIC-003', '--title=Sixth'], bl);
  T.exit(tag + ' new task: exit 0', nt, 0);
  model['TSK-006'] = el('task', 'EPIC-003', 'todo');
  const ns = runJ(['new', '--type=subtask', '--parent=TSK-006', '--title=Sixth sub'], bl);
  T.exit(tag + ' new subtask: exit 0', ns, 0);
  model['SUB-006'] = el('subtask', 'TSK-006', 'todo');
  T.eq(tag + ' new puts epic, task and subtask at their places', files(), expectedFiles(L, model));
  if (hier) {
    T.eq(tag + ' new reused the existing EPIC-003/ folder', H.readOrNull(path.join(bl, 'EPIC-003', 'keep.txt')), 'kept\n');
  }

  const r1 = runJ(['rm', '--id=SUB-006'], bl);
  T.exit(tag + ' rm subtask: exit 0', r1, 0);
  delete model['SUB-006'];
  T.eq(tag + ' rm subtask removes exactly its file', files(), expectedFiles(L, model));
  if (hier) T.check(tag + ' rm subtask keeps the task folder, which still holds TSK-006.md',
    isDir(path.join(bl, 'EPIC-003', 'TSK-006')), '');

  const r2 = runJ(['rm', '--id=TSK-006'], bl);
  T.exit(tag + ' rm task: exit 0', r2, 0);
  delete model['TSK-006'];
  T.eq(tag + ' rm task removes exactly its file', files(), expectedFiles(L, model));
  if (hier) T.check(tag + ' rm task removes its folder once empty (§ 12)',
    !fs.existsSync(path.join(bl, 'EPIC-003', 'TSK-006')), H.lsOrEmpty(path.join(bl, 'EPIC-003')).join(','));

  runJ(['new', '--type=task', '--parent=EPIC-003', '--title=Seventh'], bl);
  runJ(['new', '--type=subtask', '--parent=TSK-007', '--title=Seventh sub'], bl);
  model['TSK-007'] = el('task', 'EPIC-003', 'todo');
  model['SUB-007'] = el('subtask', 'TSK-007', 'todo');
  T.eq(tag + ' second subtree created at its places', files(), expectedFiles(L, model));
  const rc = runJ(['rm', '--id=EPIC-003', '--cascade'], bl);
  T.exit(tag + ' rm --cascade: exit 0', rc, 0);
  delete model['EPIC-003']; delete model['TSK-007']; delete model['SUB-007'];
  T.eq(tag + ' rm --cascade removes exactly the subtree\'s files', files(), expectedFiles(L, model));
  if (hier) {
    T.check(tag + ' rm --cascade removes each emptied folder (§ 12)',
      !fs.existsSync(path.join(bl, 'EPIC-003', 'TSK-007')), H.lsOrEmpty(path.join(bl, 'EPIC-003')).join(','));
    T.eq(tag + ' rm --cascade never deletes what else a folder holds (§ 12)',
      H.lsOrEmpty(path.join(bl, 'EPIC-003')), ['keep.txt']);
  }

  /* § 11: archive an epic subtree */
  const ae = runJ(['archive', '--id=EPIC-002'], bl);
  T.exit(tag + ' archive epic subtree: exit 0', ae, 0);
  for (const id of ['EPIC-002', 'TSK-002', 'SUB-002']) model[id].archived = true;
  T.eq(tag + ' archive moves the subtree to its archive places (§ 11)', files(), expectedFiles(L, model));
  archivedBytes(tag + ' archive epic', bl, L, model, ['EPIC-002', 'TSK-002', 'SUB-002']);
  if (hier) T.check(tag + ' archive moved the epic folder as a whole',
    !fs.existsSync(path.join(bl, 'EPIC-002')), H.lsOrEmpty(bl).join(','));

  /* § 11: archive a task subtree whose epic stays active */
  if (hier) writeFile(bl, 'EPIC-001/TSK-005/keep2.txt', 'rides along\n');
  const at = runJ(['archive', '--id=TSK-005'], bl);
  T.exit(tag + ' archive task subtree: exit 0', at, 0);
  for (const id of ['TSK-005', 'SUB-005']) model[id].archived = true;
  T.eq(tag + ' archive moves the task subtree to its archive places (§ 11)', files(), expectedFiles(L, model));
  archivedBytes(tag + ' archive task', bl, L, model, ['TSK-005', 'SUB-005']);
  if (hier) {
    const a = L.folders.archive;
    T.eq(tag + ' the task folder moved with one rename — its other content came along (§ 11, § 12)',
      H.readOrNull(path.join(bl, a, 'EPIC-001', 'TSK-005', 'keep2.txt')), 'rides along\n');
    T.check(tag + ' the active task folder is gone', !fs.existsSync(path.join(bl, 'EPIC-001', 'TSK-005')), '');
    T.eq(tag + ' the created ancestor archive folder holds no element file of its own (§ 11)',
      H.lsOrEmpty(path.join(bl, a, 'EPIC-001')), ['TSK-005']);
  }

  const act = runJ(['list'], bl);
  const all = runJ(['list', '--all'], bl);
  T.eq(tag + ' archived elements vanish from list',
    Object.keys(entriesById(act.json)).sort(), ['EPIC-001', 'SUB-001', 'TSK-001']);
  T.eq(tag + ' and appear with --all',
    Object.keys(entriesById(all.json)).sort(),
    ['EPIC-001', 'EPIC-002', 'SUB-001', 'SUB-002', 'SUB-005', 'TSK-001', 'TSK-002', 'TSK-005']);
  doctorClean(tag + ' after every operation', bl);
}

/* § 11 / DECISIONS 90, 94: under hierarchy an archive folder left by an
 * earlier archive of a descendant is a merge target, not an occupied path —
 * recursively: existing folders are merged into, at every level. */
for (const block of [{ group: 'hierarchy' }, { group: 'hierarchy', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) }]) {
  const tag = 'B1 [hierarchy merge, archive ' + (block.folders ? 'shelf' : 'archive') + ']';
  const model: ElModel = {
    'EPIC-004': el('epic', undefined, 'done'),
    'TSK-009': el('task', 'EPIC-004', 'done'),
    'SUB-009': el('subtask', 'TSK-009', 'done'),
    'SUB-010': el('subtask', 'TSK-009', 'done'),
    'TSK-010': el('task', 'EPIC-004', 'done'),
  };
  const fx = mkLayoutBacklog('ac22-b1m', block, model);
  const { bl, L } = fx;
  T.exit(tag + ' archive a subtask first: exit 0', runJ(['archive', '--id=SUB-010'], bl), 0);
  model['SUB-010'].archived = true;
  T.eq(tag + ' the subtask lies below two created ancestor folders', mdFiles(bl), expectedFiles(L, model));
  T.exit(tag + ' then its task: exit 0 — merged one level down (D94)', runJ(['archive', '--id=TSK-009'], bl), 0);
  model['TSK-009'].archived = true; model['SUB-009'].archived = true;
  T.eq(tag + ' the task subtree merged into the existing folders', mdFiles(bl), expectedFiles(L, model));
  const ae = runJ(['archive', '--id=EPIC-004'], bl);
  T.exit(tag + ' then the epic: exit 0 — the ancestor folder is not "occupied"', ae, 0);
  model['EPIC-004'].archived = true; model['TSK-010'].archived = true;
  T.eq(tag + ' the epic subtree merged into the existing archive folder', mdFiles(bl), expectedFiles(L, model));
  archivedBytes(tag, bl, L, model, Object.keys(model));
  T.check(tag + ' the emptied source folder is removed', !fs.existsSync(path.join(bl, 'EPIC-004')), H.lsOrEmpty(bl).join(','));
  doctorClean(tag + ' after the three archives', bl);
}

/* DECISIONS 91 B16: archive writes archived:/updated in place first, then
 * moves; NJ_FAULT=before-rename fires before the first rename — so the
 * previous revision is intact and nothing moves (§ 12, AC-9's hook). */
for (const block of [undefined, { group: 'hierarchy' }]) {
  const tag = 'B1 [' + (block ? 'hierarchy' : 'type, v2') + ' archive, NJ_FAULT=before-rename]';
  const model: ElModel = {
    'EPIC-004': el('epic', undefined, 'done'),
    'TSK-010': el('task', 'EPIC-004', 'done'),
    'SUB-010': el('subtask', 'TSK-010', 'done'),
  };
  const fx = mkLayoutBacklog('ac22-b1f', block, model);
  const { bl, L } = fx;
  const before = mdFiles(bl);
  const r = H.runNj(['archive', '--id=EPIC-004'], { cwd: path.dirname(bl), unsetEnv: ['NJ_BACKLOG'], env: { NJ_FAULT: 'before-rename' } });
  T.exit(tag + ': exit 1', r, 1);
  T.eq(tag + ': nothing moved', mdFiles(bl), before);
  for (const id of Object.keys(model)) {
    T.eq(tag + ': ' + id + ' is the previous revision',
      H.readOrNull(path.join(bl, placeOf(L, model, id))), elementBytes(id, model[id]));
  }
}

/* D94: only a file at a file's target path, or a file/folder mismatch, is a
 * conflict — then `exists`, all targets verified first, nothing moves. */
{
  const tag = 'B1 [hierarchy merge conflict]';
  const model: ElModel = {
    'EPIC-004': el('epic', undefined, 'done'),
    'TSK-010': el('task', 'EPIC-004', 'done'),
  };
  const fx = mkLayoutBacklog('ac22-b1c', { group: 'hierarchy' }, model);
  const { bl } = fx;
  writeFile(bl, 'archive/EPIC-004/TSK-010', 'a file where the task folder must go\n');
  const before = mdFiles(bl);
  const r = runJ(['archive', '--id=EPIC-004'], bl);
  T.exit(tag + ': exit 1', r, 1);
  T.eq(tag + ': exists', r.json && r.json.error, 'exists');
  T.eq(tag + ': nothing moved', mdFiles(bl), before);
  T.eq(tag + ': the blocking file is untouched',
    H.readOrNull(path.join(bl, 'archive', 'EPIC-004', 'TSK-010')), 'a file where the task folder must go\n');
}

/* § 11 / § 9 / DECISIONS 92 Q4: under hierarchy an epic or task archives as
 * its folder, so its subtree must lie inside it and nothing foreign may.
 * Otherwise refused:misplaced, nothing moves, and nj doctor --fix is named. */
for (const [what, arrange] of [
  ['a subtree member lies outside the folder', (bl: string) => {
    fs.renameSync(path.join(bl, 'EPIC-005', 'TSK-011'), path.join(bl, 'EPIC-001', 'TSK-011'));
  }],
  ['a foreign element file lies inside the folder', (bl: string) => {
    fs.renameSync(path.join(bl, 'EPIC-001', 'TSK-012'), path.join(bl, 'EPIC-005', 'TSK-012'));
  }],
] as [string, (bl: string) => void][]) {
  const tag = 'B1 [hierarchy refused:misplaced, ' + what + ']';
  const model: ElModel = {
    'EPIC-001': el('epic', undefined, 'todo'),
    'TSK-012': el('task', 'EPIC-001', 'todo'),
    'EPIC-005': el('epic', undefined, 'done'),
    'TSK-011': el('task', 'EPIC-005', 'done'),
  };
  const fx = mkLayoutBacklog('ac22-b1r', { group: 'hierarchy' }, model);
  const { bl } = fx;
  arrange(bl);
  const before = mdFiles(bl);
  const r = run(['archive', '--id=EPIC-005'], bl);
  T.exit(tag + ': exit 1', r, 1);
  T.contains(tag + ': points at nj doctor --fix', out(r), 'doctor --fix');
  const rj = runJ(['archive', '--id=EPIC-005'], bl);
  T.eq(tag + ' --json: refused:misplaced', rj.json && rj.json.error, 'refused:misplaced');
  T.eq(tag + ': nothing moved', mdFiles(bl), before);
}

/* ===================================================================== */
/* B2 — list, tree, show and --json give the same answers in every group, */
/*      apart from file paths                                            */
/* ===================================================================== */

function sameAnswerModel(): ElModel {
  const m = baseModel();
  for (const id of ['EPIC-002', 'TSK-002', 'SUB-002']) m[id].archived = true;
  m['TSK-008'] = el('task', 'EPIC-001', 'todo', { incomplete: true, title: 'Missing criteria' });
  m['TSK-001'].title = 'Login route';
  return m;
}

const READS: [string, string[]][] = [
  ['bare nj', []], ['list', ['list']], ['list --all', ['list', '--all']], ['list --ready', ['list', '--ready']],
  ['tree', ['tree']], ['tree --all', ['tree', '--all']], ['show TSK-001', ['show', '--id=TSK-001']],
  ['show SUB-002 (archived)', ['show', '--id=SUB-002']], ['show TSK-008', ['show', '--id=TSK-008']],
  ['doctor', ['doctor']],
];

/* "apart from file paths": the backlog path, and any string that names an
 * element file, are masked; everything else must match. */
function maskPaths(s: unknown, bl: string): string {
  let t = String(s);
  for (const p of [fs.realpathSync(bl), bl]) t = t.split(p).join('<BL>');
  return t.replace(/[^\s"'()]*\.md\b/g, '<FILE>');
}
function maskJson(x: any, bl: string): any {
  if (Array.isArray(x)) return x.map(v => maskJson(v, bl));
  if (x && typeof x === 'object') {
    const o: Record<string, any> = {};
    for (const k of Object.keys(x)) if (k !== 'backlog') o[k] = maskJson(x[k], bl);
    return o;
  }
  return typeof x === 'string' ? maskPaths(x, bl) : x;
}

{
  const groups: [string, Block][] = [
    ['type, no layout block', undefined],
    ['type, renamed folders', { group: 'type', folders: RENAMED }],
    ['flat', { group: 'flat' }],
    ['hierarchy', { group: 'hierarchy' }],
  ];
  const fxs: [string, ReturnType<typeof mkLayoutBacklog>][] = groups.map(([n, b]) => [n, mkLayoutBacklog('ac22-b2', b, sameAnswerModel())]);
  const [refName, ref] = fxs[0];
  for (const [label, args] of READS) {
    const rj = runJ(args, ref.bl);
    const rh = run(args, ref.bl);
    const refJ = J(maskJson(rj.json, ref.bl));
    const refH = maskPaths(rh.stdout, ref.bl);
    T.check('B2 reference (' + refName + ') ' + label + ' --json parses', rj.json !== null, rj.stdout.slice(0, 200));
    for (const [name, fx] of fxs.slice(1)) {
      const oj = runJ(args, fx.bl);
      const oh = run(args, fx.bl);
      T.eq('B2 ' + label + ' --json: exit code in ' + name + ' equals ' + refName, oj.status, rj.status);
      T.eq('B2 ' + label + ' --json: same answer in ' + name + ' as in ' + refName + ' (paths masked)',
        J(maskJson(oj.json, fx.bl)), refJ);
      T.eq('B2 ' + label + ' (human): same output in ' + name + ' as in ' + refName + ' (paths masked)',
        maskPaths(oh.stdout, fx.bl), refH);
    }
  }
}

/* ===================================================================== */
/* B3 — changing group or a folder name on a populated backlog            */
/* ===================================================================== */

function migrationModel(): ElModel {
  return {
    'EPIC-001': el('epic', undefined, 'todo'),
    'TSK-001': el('task', 'EPIC-001', 'todo'),
    'SUB-001': el('subtask', 'TSK-001', 'todo'),
    'TSK-002': el('task', 'EPIC-001', 'todo'),
    'EPIC-002': el('epic', undefined, 'done', { archived: true }),
    'TSK-003': el('task', 'EPIC-002', 'done', { archived: true }),
    'SUB-003': el('subtask', 'TSK-003', 'done', { archived: true }),
  };
}

const MIGRATIONS = [
  { from: undefined, to: { group: 'hierarchy' }, code: 'layout:misplaced', name: 'type → hierarchy' },
  { from: undefined, to: { group: 'flat' }, code: 'layout:misplaced', name: 'type → flat' },
  /* the archive folder keeps its name here; its rename has its own rows below */
  { from: undefined, to: { group: 'type', folders: { epics: 'Big', tasks: 'work_items', subtasks: 'small-1', archive: 'archive' } },
    code: 'type:folder', name: 'type → renamed type folders' },
  { from: { group: 'hierarchy' }, to: { group: 'type', folders: Object.assign({}, DEFAULT_FOLDERS), statusFile: true },
    code: 'type:folder', name: 'hierarchy → type' },
  { from: { group: 'flat' }, to: { group: 'hierarchy' }, code: 'layout:misplaced', name: 'flat → hierarchy' },
  /* DECISIONS 92 Q2: below the old archive folder a file is misplaced, and
   * `archived:` makes the new archive folder its target */
  { from: undefined, to: { group: 'type', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) },
    code: 'type:folder', name: 'type, archive → shelf' },
  { from: { group: 'hierarchy' }, to: { group: 'hierarchy', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) },
    code: 'layout:misplaced', name: 'hierarchy, archive → shelf' },
];

for (const M of MIGRATIONS) {
  const tag = 'B3 [' + M.name + ']';
  const other = M.code === 'type:folder' ? 'layout:misplaced' : 'type:folder';
  const fx = mkLayoutBacklog('ac22-b3', M.from, migrationModel());
  const { bl, model } = fx;
  doctorClean(tag + ' before the change', bl);
  const oldL = fx.L;

  writeConfig(bl, M.to);
  const newL = layoutOf(M.to);

  /* AMBIGUOUS (AMBIGUITIES 61): "every element reports" is read as every
   * element whose place the change moves.
   * An archived file under type/flat stays at <archive>/<id>.md when only
   * the other folders or the type/flat choice change: it is not misplaced. */
  const moves = Object.keys(model).filter(id => placeOf(oldL, model, id) !== placeOf(newL, model, id));
  T.check(tag + ' fixture: the change moves at least one element', moves.length > 0, '');
  const all = runJ(['list', '--all'], bl);
  T.exit(tag + ' list --all after the change: exit 0', all, 0);
  const byId = entriesById(all.json);
  for (const id of Object.keys(model)) {
    const p = byId[id] ? byId[id]._problems || [] : null;
    if (moves.includes(id)) {
      T.check(tag + ' ' + id + ' (moved by the change) reports ' + M.code, !!p && p.includes(M.code), J(p));
    } else {
      T.check(tag + ' ' + id + ' (still at its place) reports no location code',
        !!p && !p.includes(M.code), J(p));
    }
    T.check(tag + ' ' + id + ' does not report ' + other + ' (§ 7: one code per group)',
      !!p && !p.includes(other), J(p));
  }
  /* A layout change can change which files are archived (a renamed archive
   * folder, D92 Q2), and with it the overview. This suite is about
   * locations, not the overview (AC-23's): refresh it, so the pinned set
   * holds before V3-3 and after it alike (DECISIONS 100). */
  H.writeStatus(bl);
  H.writeTags(bl);
  const pre = runJ(['doctor'], bl);
  T.exit(tag + ' doctor before --fix: exit 2', pre, 2);
  T.sameSet(tag + ' doctor before --fix: only ' + M.code + ' findings',
    [...new Set(H.doctorSet(pre) || ['<no problems array>'])], [M.code + ':error']);

  /* commands keep working */
  /* § 4: archived exactly when below the archive folder — until --fix, a
   * file left below a renamed-away archive folder is ACTIVE (D92 Q2) */
  const belowArchive = (L: Layout, id: string) => placeOf(oldL, model, id).startsWith(L.folders.archive + '/');
  const activeNow = Object.keys(model).filter(id => !belowArchive(newL, id)).sort();
  const ls = runJ(['list'], bl);
  T.exit(tag + ' list keeps working', ls, 0);
  T.eq(tag + ' list shows every element not below the (new) archive folder',
    Object.keys(entriesById(ls.json)).sort(), activeNow);
  T.exit(tag + ' tree keeps working', runJ(['tree'], bl), 0);
  T.exit(tag + ' show keeps working', runJ(['show', '--id=SUB-001'], bl), 0);
  const st = runJ(['set', '--id=TSK-002', '--status=doing'], bl);
  T.exit(tag + ' set keeps working', st, 0);
  model['TSK-002'].status = 'doing';
  /* AMBIGUOUS (AMBIGUITIES 62): set on a misplaced file writes it where it
   * lies; § 4 says files move only through archive, doctor --fix or by hand. */
  T.eq(tag + ' set writes in place — only archive, doctor --fix or a hand move relocate (§ 4)',
    H.readOrNull(path.join(bl, placeOf(oldL, model, 'TSK-002'))) !== null, true);
  const nw = runJ(['new', '--type=subtask', '--parent=TSK-001', '--title=Fresh'], bl);
  T.exit(tag + ' new keeps working', nw, 0);
  T.eq(tag + ' new: SUB-004', nw.json && nw.json.id, 'SUB-004');
  model['SUB-004'] = el('subtask', 'TSK-001', 'todo');
  T.check(tag + ' new puts the fresh element at its place in the new layout',
    fs.existsSync(path.join(bl, placeOf(newL, model, 'SUB-004'))), J(mdFiles(bl)));

  /* bytes before the move, by id */
  const before: Record<string, string | null> = {};
  for (const id of Object.keys(model)) {
    const L = id === 'SUB-004' ? newL : oldL;
    before[id] = H.readOrNull(path.join(bl, placeOf(L, model, id)));
  }
  T.check(tag + ' every element file was readable before the move',
    Object.values(before).every(b => b !== null), J(mdFiles(bl)));

  /* AMBIGUITIES 60: target folders that do not exist yet (renamed type
   * folders, hierarchy folders) are created by --fix — the criterion's own
   * scenario, a config edit followed by one --fix, requires it. */
  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' one doctor --fix: exit 0', fix, 0);
  T.eq(tag + ' --fix moved everything to the new layout', mdFiles(bl), expectedFiles(newL, model));
  T.eq(tag + ' after --fix, list shows exactly the elements without archived:',
    Object.keys(entriesById(runJ(['list'], bl).json)).sort(),
    Object.keys(model).filter(id => !model[id].archived).sort());
  for (const id of Object.keys(model)) {
    T.check(tag + ' ' + id + ' is byte-identical after the move',
      H.readOrNull(path.join(bl, placeOf(newL, model, id))) === before[id],
      J(H.readOrNull(path.join(bl, placeOf(newL, model, id)))).slice(0, 200));
  }
  if (oldL.group === 'hierarchy' && newL.group !== 'hierarchy') {
    /* DECISIONS 92: --fix removes the emptied hierarchy folders (ID-shaped) */
    const left = H.lsOrEmpty(bl).concat(H.lsOrEmpty(path.join(bl, newL.folders.archive)))
      .filter(n => /^(EPIC|TSK|SUB)-\d+$/.test(n));
    T.eq(tag + ' the emptied hierarchy folders are removed', left, []);
  }
  doctorClean(tag + ' after --fix', bl);
}

/* DECISIONS 92 Q2, the other half: below the old archive folder WITHOUT
 * `archived:` a file belongs to its active place — --fix never archives. */
{
  const tag = 'B3 [type, archive → shelf, file without archived:]';
  const fx = mkLayoutBacklog('ac22-b3q2', undefined, migrationModel());
  const { bl } = fx;
  const bytes = elementBytes('TSK-011', el('task', 'EPIC-001', 'done'));
  writeFile(bl, 'archive/TSK-011.md', bytes);
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-011'), '');
  writeConfig(bl, { group: 'type', folders: Object.assign({}, DEFAULT_FOLDERS, { archive: 'shelf' }) });
  const byId = entriesById(runJ(['list'], bl).json);
  T.check(tag + ' it is active now (not below the archive folder) and type:folder',
    !!byId['TSK-011'] && (byId['TSK-011']._problems || []).includes('type:folder'), J(byId['TSK-011']));
  T.exit(tag + ' doctor --fix: exit 0', runJ(['doctor', '--fix'], bl), 0);
  T.eq(tag + ' --fix moved it to its active place, not into shelf/',
    H.readOrNull(path.join(bl, 'tasks', 'TSK-011.md')), bytes);
  T.check(tag + ' nothing of it in shelf/', !fs.existsSync(path.join(bl, 'shelf', 'TSK-011.md')), '');
}

/* § 14 step 3: "every target must be free, otherwise that element is
 * reported and stays" — made testable without a duplicate id by putting a
 * directory, or a non-.md file, at the target path (DECISIONS 97). */
{
  const tag = 'B3 [type, target not free: a directory named like the file]';
  const fx = mkLayoutBacklog('ac22-b3nf', undefined, migrationModel());
  const { bl } = fx;
  const wrong = path.join(bl, 'subtasks', 'TSK-002.md');
  fs.renameSync(path.join(bl, 'tasks', 'TSK-002.md'), wrong);
  fs.mkdirSync(path.join(bl, 'tasks', 'TSK-002.md'));
  fs.writeFileSync(path.join(bl, 'tasks', 'TSK-002.md', 'keep.txt'), 'blocker\n');
  const bytes = fs.readFileSync(wrong, 'utf8');
  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' doctor --fix: exit 2 — type:folder remains', fix, 2);
  T.eq(tag + ' the element stays where it was, unchanged', H.readOrNull(wrong), bytes);
  T.eq(tag + ' the blocking directory is untouched',
    H.lsOrEmpty(path.join(bl, 'tasks', 'TSK-002.md')), ['keep.txt']);
  const after = runJ(['doctor'], bl);
  T.check(tag + ' it is still reported',
    ((after.json && after.json.problems) || []).some((p: any) => p.code === 'type:folder' && p.element === 'TSK-002'),
    J(after.json && after.json.problems).slice(0, 300));
}
{
  const tag = 'B3 [hierarchy, target not free: a file where the folder must go]';
  const model: ElModel = { 'EPIC-001': el('epic', undefined, 'todo'), 'EPIC-002': el('epic', undefined, 'todo') };
  const fx = mkLayoutBacklog('ac22-b3nh', { group: 'hierarchy' }, model);
  const { bl } = fx;
  const moved = path.join(bl, 'misc', 'EPIC-002');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(path.join(bl, 'EPIC-002'), moved);
  fs.writeFileSync(path.join(bl, 'EPIC-002'), 'a plain file where the epic folder must go\n');
  const bytes = fs.readFileSync(path.join(moved, 'EPIC-002.md'), 'utf8');
  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' doctor --fix: exit 2 — layout:misplaced remains', fix, 2);
  T.eq(tag + ' the epic stays where it was, unchanged', H.readOrNull(path.join(moved, 'EPIC-002.md')), bytes);
  T.eq(tag + ' the blocking file is untouched', H.readOrNull(path.join(bl, 'EPIC-002')),
    'a plain file where the epic folder must go\n');
  const after = runJ(['doctor'], bl);
  T.check(tag + ' it is still reported',
    ((after.json && after.json.problems) || []).some((p: any) => p.code === 'layout:misplaced' && p.element === 'EPIC-002'),
    J(after.json && after.json.problems).slice(0, 300));
}

/* v2 behaviour, group `type` without a layout block: a file in the wrong
 * type folder is `type:folder`, and --fix moves it byte-identically. */
{
  const tag = 'B3 [type, v2: task in the subtasks folder]';
  const fx = mkLayoutBacklog('ac22-b3v2', undefined, migrationModel());
  const { bl } = fx;
  const wrong = path.join(bl, 'subtasks', 'TSK-002.md');
  fs.renameSync(path.join(bl, 'tasks', 'TSK-002.md'), wrong);
  const bytes = fs.readFileSync(wrong, 'utf8');
  const p = entriesById(runJ(['list'], bl).json)['TSK-002'];
  T.check(tag + ' reports type:folder', !!p && (p._problems || []).includes('type:folder'), J(p));
  T.exit(tag + ' doctor --fix: exit 0', runJ(['doctor', '--fix'], bl), 0);
  T.eq(tag + ' the file is in tasks/ again', mdFiles(bl), expectedFiles(fx.L, fx.model));
  T.eq(tag + ' byte-identical after the move', H.readOrNull(path.join(bl, 'tasks', 'TSK-002.md')), bytes);
  doctorClean(tag + ' after --fix', bl);
}

/* ===================================================================== */
/* B4 — hierarchy: a hand-edited parent makes the file layout:misplaced,  */
/*      --fix moves it (§ 4, § 14 step 3)                                 */
/* ===================================================================== */

{
  const tag = 'B4 [hierarchy, hand-edited parent]';
  const model: ElModel = {
    'EPIC-001': el('epic', undefined, 'todo'),
    'EPIC-002': el('epic', undefined, 'todo'),
    'TSK-002': el('task', 'EPIC-001', 'todo'),
    'SUB-002': el('subtask', 'TSK-002', 'todo'),
    'TSK-003': el('task', 'EPIC-001', 'todo'),
  };
  const fx = mkLayoutBacklog('ac22-b4', { group: 'hierarchy' }, model);
  const { bl, L } = fx;
  doctorClean(tag + ' before the edit', bl);

  const oldFile = path.join(bl, 'EPIC-001', 'TSK-002', 'TSK-002.md');
  const edited = fs.readFileSync(oldFile, 'utf8').replace('parent: EPIC-001\n', 'parent: EPIC-002\n');
  fs.writeFileSync(oldFile, edited);
  writeFile(bl, 'EPIC-001/TSK-002/keep.txt', 'rides along\n');
  const subBytes = fs.readFileSync(path.join(bl, 'EPIC-001', 'TSK-002', 'SUB-002.md'), 'utf8');
  model['TSK-002'].parent = 'EPIC-002';

  const byId = entriesById(runJ(['list'], bl).json);
  T.check(tag + ' TSK-002 reports layout:misplaced',
    !!byId['TSK-002'] && (byId['TSK-002']._problems || []).includes('layout:misplaced'), J(byId['TSK-002']));
  T.check(tag + ' TSK-002 reports the new parent',
    !!byId['TSK-002'] && byId['TSK-002'].parent === 'EPIC-002', J(byId['TSK-002']));
  /* SUB-002's place follows its parent chain, which now runs through EPIC-002 */
  T.check(tag + ' SUB-002, below it, reports layout:misplaced too',
    !!byId['SUB-002'] && (byId['SUB-002']._problems || []).includes('layout:misplaced'), J(byId['SUB-002']));
  T.check(tag + ' TSK-003, untouched, reports nothing',
    !!byId['TSK-003'] && (byId['TSK-003']._problems || []).length === 0, J(byId['TSK-003']));
  T.exit(tag + ' doctor: exit 2', runJ(['doctor'], bl), 2);

  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' doctor --fix: exit 0', fix, 0);
  T.eq(tag + ' --fix moved the subtree under EPIC-002', mdFiles(bl), expectedFiles(L, model));
  T.eq(tag + ' the task folder moved with its top folder — other content came along (§ 14 step 3)',
    H.readOrNull(path.join(bl, 'EPIC-002', 'TSK-002', 'keep.txt')), 'rides along\n');
  T.eq(tag + ' TSK-002 is byte-identical to the hand-edited file',
    H.readOrNull(path.join(bl, 'EPIC-002', 'TSK-002', 'TSK-002.md')), edited);
  T.eq(tag + ' SUB-002 is byte-identical',
    H.readOrNull(path.join(bl, 'EPIC-002', 'TSK-002', 'SUB-002.md')), subBytes);
  doctorClean(tag + ' after --fix', bl);
}

/* ===================================================================== */
/* B5 — hierarchy: an unresolvable parent chain is reported, never moved  */
/*      (DECISIONS 91 B15: no layout code for it); a task without parent  */
/*      has a place — the top of the tree — and is judged like any other   */
/* ===================================================================== */

{
  const tag = 'B5 [hierarchy, unresolvable chain]';
  const fx = mkLayoutBacklog('ac22-b5', { group: 'hierarchy' }, {
    'EPIC-001': el('epic', undefined, 'todo'),
    'TSK-001': el('task', 'EPIC-001', 'todo'),
  });
  const { bl } = fx;
  /* TSK-007 names an epic that does not exist; SUB-007 hangs below it. */
  const dangling = { 'EPIC-001/TSK-007/TSK-007.md': elementBytes('TSK-007', el('task', 'EPIC-099', 'todo')),
    'EPIC-001/TSK-007/SUB-007.md': elementBytes('SUB-007', el('subtask', 'TSK-007', 'todo')) };
  for (const [rel, bytes] of Object.entries(dangling)) {
    writeFile(bl, rel, bytes);
    fs.writeFileSync(path.join(bl, IDS_REL, path.basename(rel, '.md')), '');
  }
  const filesBefore = mdFiles(bl);

  const pre = runJ(['doctor'], bl);
  T.exit(tag + ' doctor: exit 2', pre, 2);
  const probs = (pre.json && Array.isArray(pre.json.problems)) ? pre.json.problems : [];
  T.check(tag + ' TSK-007 is reported parent:dangling',
    probs.some((p: any) => p.code === 'parent:dangling' && p.element === 'TSK-007'), J(probs).slice(0, 400));
  const byId = entriesById(runJ(['list'], bl).json);
  for (const id of ['TSK-007', 'SUB-007']) {
    T.check(tag + ' ' + id + ' carries no layout code — its place cannot be computed',
      !!byId[id] && !(byId[id]._problems || []).includes('layout:misplaced'), J(byId[id]));
  }

  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' doctor --fix: exit 2 — parent:dangling remains', fix, 2);
  T.eq(tag + ' --fix moved nothing', mdFiles(bl), filesBefore);
  for (const [rel, bytes] of Object.entries(dangling)) {
    T.eq(tag + ' ' + rel + ' is untouched', H.readOrNull(path.join(bl, rel)), bytes);
  }
}

{
  const tag = 'B5 [hierarchy, task without parent]';
  const model: ElModel = {
    'EPIC-001': el('epic', undefined, 'todo'),
    'TSK-008': el('task', undefined, 'todo'),
    'SUB-008': el('subtask', 'TSK-008', 'todo'),
  };
  const fx = mkLayoutBacklog('ac22-b5o', { group: 'hierarchy' }, model);
  const { bl, L } = fx;
  T.eq(tag + ' fixture: at the top of the tree', mdFiles(bl), ['EPIC-001/EPIC-001.md', 'TSK-008/SUB-008.md', 'TSK-008/TSK-008.md']);
  const clean = runJ(['doctor'], bl);
  T.exit(tag + ' at its place: doctor exits 0 (parent:orphaned is a warning)', clean, 0);
  T.sameSet(tag + ' at its place: only parent:orphaned', H.doctorSet(clean) || ['<no problems array>'], ['parent:orphaned:warning']);
  const ready = runJ(['list', '--ready'], bl);
  T.check(tag + ' parent:orphaned alone does not block --ready (§ 7, D91 B15)',
    !!entriesById(ready.json)['TSK-008'], J(Object.keys(entriesById(ready.json))));

  /* moved by hand under EPIC-001: misplaced, and --fix moves it back */
  fs.renameSync(path.join(bl, 'TSK-008'), path.join(bl, 'EPIC-001', 'TSK-008'));
  const bytes = fs.readFileSync(path.join(bl, 'EPIC-001', 'TSK-008', 'TSK-008.md'), 'utf8');
  const byId = entriesById(runJ(['list'], bl).json);
  T.check(tag + ' moved under an epic by hand: layout:misplaced',
    !!byId['TSK-008'] && (byId['TSK-008']._problems || []).includes('layout:misplaced'), J(byId['TSK-008']));
  const fix = runJ(['doctor', '--fix'], bl);
  T.exit(tag + ' doctor --fix: exit 0', fix, 0);
  T.eq(tag + ' --fix moved it back to the top of the tree', mdFiles(bl), expectedFiles(L, model));
  T.eq(tag + ' byte-identical', H.readOrNull(path.join(bl, 'TSK-008', 'TSK-008.md')), bytes);
}

/* ===================================================================== */
/* B6 — elements are found wherever they lie (§ 4): every *.md below the  */
/*      backlog except README.md, STATUS.md and .nanojira/; archived      */
/*      exactly when below the archive folder                             */
/* ===================================================================== */

{
  /* group type: a task in a stray subfolder is found, is type:folder, and
   * --fix moves it to tasks/ */
  const tag = 'B6 [type]';
  const fx = mkLayoutBacklog('ac22-b6t', undefined, migrationModel());
  const { bl } = fx;
  const stray = 'misc/deeper/TSK-009.md';
  const bytes = elementBytes('TSK-009', el('task', 'EPIC-001', 'todo'));
  writeFile(bl, stray, bytes);
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-009'), '');
  const byId = entriesById(runJ(['list'], bl).json);
  T.check(tag + ' a *.md in a stray subfolder is read as an element', !!byId['TSK-009'], J(Object.keys(byId)));
  T.check(tag + ' and carries type:folder',
    !!byId['TSK-009'] && (byId['TSK-009']._problems || []).includes('type:folder'), J(byId['TSK-009']));
  T.exit(tag + ' show finds it', runJ(['show', '--id=TSK-009'], bl), 0);
  T.exit(tag + ' doctor --fix: exit 0', runJ(['doctor', '--fix'], bl), 0);
  T.eq(tag + ' --fix moved it to tasks/, byte-identical',
    H.readOrNull(path.join(bl, 'tasks', 'TSK-009.md')), bytes);
  T.check(tag + ' the stray place is empty now', !fs.existsSync(path.join(bl, stray)), '');
  doctorClean(tag + ' after --fix', bl);
}

{
  const tag = 'B6 [flat]';
  const fx = mkLayoutBacklog('ac22-b6f', { group: 'flat' }, migrationModel());
  const { bl } = fx;
  const bytes = elementBytes('TSK-009', el('task', 'EPIC-001', 'todo'));
  writeFile(bl, 'misc/TSK-009.md', bytes);
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-009'), '');
  const byId = entriesById(runJ(['list'], bl).json);
  T.check(tag + ' a *.md in a subfolder carries layout:misplaced',
    !!byId['TSK-009'] && (byId['TSK-009']._problems || []).includes('layout:misplaced'), J(byId['TSK-009']));
  T.exit(tag + ' doctor --fix: exit 0', runJ(['doctor', '--fix'], bl), 0);
  T.eq(tag + ' --fix moved it to the backlog top level, byte-identical',
    H.readOrNull(path.join(bl, 'TSK-009.md')), bytes);
  doctorClean(tag + ' after --fix', bl);
}

{
  /* .nanojira/ is never scanned, whatever it holds; nor is any other
   * directory whose name starts with "." (DECISIONS 91 B11). STATUS.md is
   * V3-3's and not asserted here. */
  const tag = 'B6 [exclusions]';
  const fx = mkLayoutBacklog('ac22-b6x', undefined, migrationModel());
  const { bl } = fx;
  writeFile(bl, '.nanojira/notes.md', elementBytes('TSK-010', el('task', 'EPIC-001', 'todo')));
  writeFile(bl, '.obsidian/TSK-012.md', elementBytes('TSK-012', el('task', 'EPIC-001', 'todo')));
  writeFile(bl, 'tasks/TSK-015.MD', elementBytes('TSK-015', el('task', 'EPIC-001', 'todo')));
  const outside = H.freshDir('ac22-outside');
  fs.writeFileSync(path.join(outside, 'TSK-013.md'), elementBytes('TSK-013', el('task', 'EPIC-001', 'todo')));
  fs.symlinkSync(outside, path.join(bl, 'linked'));
  const all = runJ(['list', '--all'], bl);
  const seen = Object.keys(entriesById(all.json));
  T.check(tag + ' a *.md under .nanojira/ is not an element', !seen.includes('TSK-010'), J(seen));
  T.check(tag + ' a *.md under another dot-directory is not an element (B11)', !seen.includes('TSK-012'), J(seen));
  T.check(tag + ' a directory symlink is never followed (B11)', !seen.includes('TSK-013'), J(seen));
  fs.symlinkSync(bl, path.join(bl, 'epics', 'loop'));
  const looped = H.runJson(['list', '--all'], { cwd: path.dirname(bl), unsetEnv: ['NJ_BACKLOG'], timeout: 20000 });
  T.exit(tag + ' a symlink loop neither hangs nor crashes (B11): list exits 0', looped, 0);
  T.eq(tag + ' and lists the same elements', Object.keys(entriesById(looped.json)), seen);
  T.check(tag + ' the suffix is case-sensitive: *.MD is not an element (B11)', !seen.includes('TSK-015'), J(seen));
  T.eq(tag + ' the top-level README.md is not an element: --all lists exactly the model',
    Object.keys(entriesById(all.json)).sort(), Object.keys(fx.model).sort());
}

{
  /* a symlinked FILE is read like a file (DECISIONS 91 B11) */
  const tag = 'B6 [file symlink]';
  const fx = mkLayoutBacklog('ac22-b6s', undefined, migrationModel());
  const { bl } = fx;
  const outside = H.freshDir('ac22-outside-file');
  const target = path.join(outside, 'TSK-014.md');
  fs.writeFileSync(target, elementBytes('TSK-014', el('task', 'EPIC-001', 'todo')));
  fs.symlinkSync(target, path.join(bl, 'tasks', 'TSK-014.md'));
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-014'), '');
  T.check(tag + ' a symlinked element file is read', !!entriesById(runJ(['list'], bl).json)['TSK-014'], '');
}

{
  /* README.md below the top level is an element file and is reported
   * (DECISIONS 91 B12) */
  const tag = 'B6 [README.md below the top level]';
  const fx = mkLayoutBacklog('ac22-b6r', undefined, migrationModel());
  const { bl } = fx;
  writeFile(bl, 'epics/README.md', '# Notes about epics\n');
  const r = runJ(['doctor'], bl);
  T.exit(tag + ' doctor exits 2', r, 2);
  const probs = (r.json && Array.isArray(r.json.problems)) ? r.json.problems : [];
  T.check(tag + ' a finding names epics/README.md',
    probs.some((p: any) => J(p).includes('README.md')), J(probs).slice(0, 400));
}

{
  /* a hand-written `archived:` at a valid active place is no finding
   * (DECISIONS 92 Q2, v2 behaviour) */
  const tag = 'B6 [archived: at an active place]';
  const fx = mkLayoutBacklog('ac22-b6h', undefined, migrationModel());
  const { bl } = fx;
  writeFile(bl, 'tasks/TSK-016.md', elementBytes('TSK-016', el('task', 'EPIC-001', 'done', { archived: true })));
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-016'), '');
  const e = entriesById(runJ(['list'], bl).json)['TSK-016'];
  T.check(tag + ' it is active — listed without --all', !!e, '');
  T.check(tag + ' and carries no location code',
    !!e && !(e._problems || []).some((c: any) => c === 'type:folder' || c === 'layout:misplaced'), J(e));
}

{
  /* a directory below the backlog that cannot be listed is reported, never
   * silently skipped: backlog:unreadable_dir, error, backlog-level
   * (§ 7, DECISIONS 93 F9) */
  const tag = 'B6 [unreadable directory]';
  const fx = mkLayoutBacklog('ac22-b6u', undefined, migrationModel());
  const { bl } = fx;
  const locked = path.join(bl, 'misc');
  writeFile(bl, 'misc/notes.md', '# private\n');
  fs.chmodSync(locked, 0o000);
  H.writeStatus(bl);      // the overview as nj can see it: misc/ is unlisted
  H.writeTags(bl);
  try {
    const canList = (() => { try { fs.readdirSync(locked); return true; } catch (e) { return false; } })();
    if (canList) {
      T.check(tag + ' not covered: this process can list a mode-000 directory (running as root?)', false, locked);
    } else {
      const r = runJ(['doctor'], bl);
      T.exit(tag + ' doctor exits 2', r, 2);
      T.sameSet(tag + ' doctor reports exactly backlog:unreadable_dir',
        H.doctorSet(r) || ['<no problems array>'], ['backlog:unreadable_dir:error']);
      const f = ((r.json && r.json.problems) || []).find((p: any) => p.code === 'backlog:unreadable_dir');
      T.check(tag + ' the finding is backlog-level (no element)', !!f && !f.element, J(f));
    }
  } finally {
    fs.chmodSync(locked, 0o755);
  }
}

/* An element whose type cannot be determined (no `type`, no known ID
 * prefix) carries type:folder in every group (DECISIONS 92). */
for (const [name, block, rel] of [
  ['type, v2', undefined, 'tasks/BUG-001.md'],
  ['flat', { group: 'flat' }, 'BUG-001.md'],
  ['hierarchy', { group: 'hierarchy' }, 'BUG-001.md'],
] as [string, Block, string][]) {
  const tag = 'B6 [' + name + ', undeterminable type]';
  const fx = mkLayoutBacklog('ac22-b6b', block, migrationModel());
  writeFile(fx.bl, rel, H.element({ id: 'BUG-001', title: 'Odd one', status: 'todo', created: NOW, updated: NOW },
    '# Odd one\n\n## Description\nSomething.\n'));
  const all = runJ(['list', '--all'], fx.bl);
  const e = Object.values(entriesById(all.json)).find((x: any) => JSON.stringify(x).includes('BUG-001'));
  T.check(tag + ' the file is read and carries type:folder',
    !!e && (e._problems || []).includes('type:folder'), J(e || Object.keys(entriesById(all.json))));
}

{
  /* archived exactly when below the archive folder (group type, v2) */
  const tag = 'B6 [archived by location]';
  const fx = mkLayoutBacklog('ac22-b6a', undefined, migrationModel());
  const { bl } = fx;
  const done = el('task', 'EPIC-001', 'done');
  writeFile(bl, 'archive/TSK-011.md', elementBytes('TSK-011', done));
  fs.writeFileSync(path.join(bl, IDS_REL, 'TSK-011'), '');
  T.check(tag + ' a file below archive/ is hidden from list',
    !entriesById(runJ(['list'], bl).json)['TSK-011'], '');
  T.check(tag + ' and listed with --all', !!entriesById(runJ(['list', '--all'], bl).json)['TSK-011'], '');
}

T.finish();
