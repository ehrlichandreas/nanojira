/* AC-23 — Status overview (spec v3, V3-3).
 *
 * § 15 AC-23: "After `init` and after every write command, `STATUS.md` is
 * byte-identical to the golden fixture of § 4 for that state — including
 * empty statuses, the `?` section and archived elements left out. A
 * hand-edited or deleted `STATUS.md` is `backlog:status_stale` (warning,
 * exit 0) and `doctor --fix` restores it. With `statusFile: false` no command
 * creates or checks it. An unwritable `STATUS.md` leaves the write's exit
 * code unchanged and prints the § 4 warning."
 *
 * § 4 "Status overview (`STATUS.md`)" (format, problem elements — DECISIONS
 * 95 B18, the failure rule — B19), § 5 `layout.statusFile`, § 7
 * `backlog:status_stale`, § 14 step 9.
 *
 * An unknown `priority` sorts with the default's weight (DECISIONS 100,
 * AMBIGUITIES 70) — C3b.
 *
 * Sections: C1 init, C2 every write command in sequence, C3 link paths per
 * group, C4 problem elements, C5 stale / deleted / conflicted and read
 * commands, C6 statusFile false, C7 an unwritable STATUS.md.
 *
 * GOLDENS. test/golden/status-*.md are hand-written from § 4's format. The
 * intermediate states of C2 are rendered by `H.renderStatus()` — the same
 * rules, in code, shared with every hand-built fixture (DECISIONS 100) — and
 * the renderer is itself checked against every golden before it is trusted
 * (C0). `H.statusFor()`, which renders a hand-built backlog from disk, is
 * checked against the C3 and C4 goldens on those very fixtures.
 *
 * STORAGE. Since V3-4 the configuration lives at `.nanojira/config.json` and
 * tombstones in `.nanojira/ids/` — CONFIG_REL / IDS_REL, from the harness.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunOpts, RunResult, JsonRunResult, StatusEntry, BacklogOpts } from '../lib/harness.ts';
const T = H.T;

/* ---- storage paths, from the harness (§ 4 v3 layout) ----------------- */
const CONFIG_REL = H.CONFIG_REL;
const IDS_REL = H.IDS_REL;

const NOW = H.FIXED_NOW;
const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

/* ---- the § 4 format, as code: the shared renderer (lib/harness.js) ---- */

const renderStatus = H.renderStatus;

/* ---- fixtures ---------------------------------------------------------- */

/** The `layout` block of a hand-built config (§ 5). */
interface ConfigLayout {
  group?: string;
  folders?: Record<string, string>;
  statusFile?: boolean;
}

interface Config {
  schema: number;
  statuses: string[];
  sections: { description: string[]; acceptance: string[] };
  layout?: ConfigLayout;
}

function configBytes(layout?: ConfigLayout): string {
  const c: Config = {
    schema: 1,
    statuses: STATUSES,
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  };
  if (layout !== undefined) c.layout = layout;
  return JSON.stringify(c, null, 2) + '\n';
}

interface ElementOpts { body?: string }

function elementBytes(f: Record<string, unknown>, opts?: ElementOpts): string {
  const o = opts || {};
  const fields = Object.assign({ created: NOW, updated: NOW }, f);
  const title = f.title;
  let body = (title ? '# ' + title + '\n\n' : '') + '## Description\nSomething.\n';
  if (f.type !== 'epic') body += '\n## Acceptance Criteria\n- [ ] It works\n';
  return H.element(fields, o.body === undefined ? body : o.body);
}

/** A hand-built backlog file's content: raw bytes, or a dangling symlink spec. */
type FileContent = string | { symlink: string };

/** The project fixture `mkFixture`/`initBacklog` return: {dir, bl}, plus an
 * optional `init` result for a backlog made by `nj init` itself. */
interface Fixture { dir: string; bl: string; init?: RunResult }

/**
 * A hand-built backlog: `files` maps a backlog-relative path to bytes (or to
 * {symlink: target}); `ids` are tombstoned. Group `type` gets its folders.
 */
function mkFixture(label: string, layout: ConfigLayout | undefined,
  files: Record<string, FileContent>, ids?: string[]): Fixture {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  fs.mkdirSync(path.join(bl, IDS_REL), { recursive: true });
  const cfg = path.join(bl, CONFIG_REL);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, configBytes(layout));
  fs.writeFileSync(path.join(bl, '.gitignore'), H.GITIGNORE);
  fs.writeFileSync(path.join(bl, 'README.md'), '# Backlog\n\nFormat notes.\n');
  for (const f of ['epics', 'tasks', 'subtasks', 'archive']) fs.mkdirSync(path.join(bl, f), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(bl, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (typeof content !== 'string' && content.symlink) fs.symlinkSync(content.symlink, p);
    else fs.writeFileSync(p, content as string);
  }
  for (const id of ids || []) fs.writeFileSync(path.join(bl, IDS_REL, id), '');
  // This suite is about STATUS.md; a fresh TAGS.md keeps backlog:tags_stale
  // out of every doctorSet assertion below that was written before TAGS.md
  // existed (DECISIONS 100, same rationale status.ts's own fixtures get).
  H.writeTags(bl);
  return { dir, bl };
}

/* A backlog made by `nj init` — V3-3 changes init itself, so C1/C2 drive it. */
function initBacklog(label: string): Fixture {
  const dir = H.freshDir(label);
  const r = H.runNj(['init'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] });
  return { dir, bl: path.join(dir, 'backlog'), init: r };
}

function run(args: string[], fx: Fixture, extra?: RunOpts): RunResult {
  return H.runNj(args, Object.assign({ cwd: fx.dir, unsetEnv: ['NJ_BACKLOG'] }, extra || {}));
}
function runJ(args: string[], fx: Fixture, extra?: RunOpts): JsonRunResult {
  return H.runJson(args, Object.assign({ cwd: fx.dir, unsetEnv: ['NJ_BACKLOG'] }, extra || {}));
}

const statusPath = (fx: Fixture): string => path.join(fx.bl, 'STATUS.md');
const readStatus = (fx: Fixture): string | null => H.readOrNull(statusPath(fx));

function statusIs(desc: string, fx: Fixture, expected: string): boolean {
  const got = readStatus(fx);
  if (got === expected) return T.check(desc, true);
  const gl = String(got).split('\n'), el = expected.split('\n');
  let i = 0; while (i < el.length && gl[i] === el[i]) i++;
  return T.check(desc, false, got === null ? 'STATUS.md does not exist' :
    'first diff at line ' + (i + 1) + '\n     expected: ' + J(el[i]) + '\n     actual:   ' + J(gl[i]));
}

function statusIsGolden(desc: string, fx: Fixture, golden: string): boolean {
  return statusIs(desc + ' (golden/' + golden + ')', fx, H.golden(golden));
}

function problemsOf(r: JsonRunResult): any[] { return (r.json && Array.isArray(r.json.problems)) ? r.json.problems : []; }

/* § 4: "Warning: STATUS.md not updated (<reason>)" — one full stderr line
 * (DECISIONS 99, AMBIGUITIES 69). */
const WARN_RE = /^Warning: STATUS\.md not updated \((.+)\)$/m;

/* ===================================================================== */
/* C0 — the renderer reproduces every hand-written golden                 */
/* ===================================================================== */

interface SeqEntry { id: string; title: string; path: string; priority?: string }
const SEQ: Record<'E1' | 'T1' | 'T2' | 'S1' | 'E2', SeqEntry> = {
  E1: { id: 'EPIC-001', title: 'Verhaltensvertrag', path: 'epics/EPIC-001.md' },
  T1: { id: 'TSK-001', title: 'Parser haerten', priority: 'high', path: 'tasks/TSK-001.md' },
  T2: { id: 'TSK-002', title: 'Not-covered-Blindstellen schliessen', path: 'tasks/TSK-002.md' },
  S1: { id: 'SUB-001', title: 'Ümlaut ✓ 日本', path: 'subtasks/SUB-001.md' },
  E2: { id: 'EPIC-002', title: 'Abgeschlossen', path: 'epics/EPIC-002.md' },
};
const at = (k: keyof typeof SEQ, status: string): StatusEntry => Object.assign({}, SEQ[k], { status });

interface GroupPaths { E: string; T1: string; T2: string; S: string; A: string; A2: string }

function groupEntries(paths: GroupPaths): StatusEntry[] {
  return [
    { id: 'EPIC-001', status: 'todo', priority: 'urgent', title: 'Plattform', path: paths.E },
    { id: 'TSK-001', status: 'doing', title: 'Login-Route', path: paths.T1 },
    { id: 'SUB-001', status: 'todo', priority: 'low', title: 'Fehlercodes', path: paths.S },
    { id: 'TSK-002', status: 'waiting', title: 'Warten auf Review', path: paths.T2 },
  ];
}
interface GroupDef { layout?: ConfigLayout; paths: GroupPaths }
const GROUPS: Record<string, GroupDef> = {
  type: { layout: undefined, paths: { E: 'epics/EPIC-001.md', T1: 'tasks/TSK-001.md', T2: 'tasks/TSK-002.md', S: 'subtasks/SUB-001.md',
    A: 'archive/EPIC-002.md', A2: 'archive/TSK-003.md' } },
  renamed: { layout: { group: 'type', folders: { epics: 'Big', tasks: 'work_items', subtasks: 'small-1', archive: 'shelf' } },
    paths: { E: 'Big/EPIC-001.md', T1: 'work_items/TSK-001.md', T2: 'work_items/TSK-002.md', S: 'small-1/SUB-001.md',
      A: 'shelf/EPIC-002.md', A2: 'shelf/TSK-003.md' } },
  flat: { layout: { group: 'flat' }, paths: { E: 'EPIC-001.md', T1: 'TSK-001.md', T2: 'TSK-002.md', S: 'SUB-001.md',
    A: 'archive/EPIC-002.md', A2: 'archive/TSK-003.md' } },
  hierarchy: { layout: { group: 'hierarchy' }, paths: { E: 'EPIC-001/EPIC-001.md', T1: 'EPIC-001/TSK-001/TSK-001.md',
    T2: 'EPIC-001/TSK-002/TSK-002.md', S: 'EPIC-001/TSK-001/SUB-001.md',
    A: 'archive/EPIC-002/EPIC-002.md', A2: 'archive/EPIC-002/TSK-003/TSK-003.md' } },
};
const PROBLEM_ENTRIES: StatusEntry[] = [
  { id: 'EPIC-001', status: 'todo', title: 'Home epic', path: 'epics/EPIC-001.md' },
  { id: 'TSK-004', status: 'todo', title: 'No status here', path: 'tasks/TSK-004.md' },
  { id: 'TSK-005', status: undefined, title: undefined, path: 'tasks/TSK-005.md' },
  { id: 'TSK-006', status: 'todo', title: undefined, path: 'tasks/TSK-006.md' },
  { id: 'TSK-007', status: 'todo', title: 'Dup B', path: 'tasks/TSK-070.md' },
  { id: 'TSK-007', status: 'todo', title: 'Dup A', path: 'tasks/TSK-007.md' },
];

T.eq('C0 renderer = golden status-init.md', renderStatus([]), H.golden('status-init.md'));
T.eq('C0 renderer = golden status-sequence-done.md',
  renderStatus([at('E1', 'todo'), at('T1', 'todo'), at('T2', 'doing'), at('S1', 'todo'), at('E2', 'done')]),
  H.golden('status-sequence-done.md'));
T.eq('C0 renderer = golden status-sequence-archived.md',
  renderStatus([at('E1', 'todo'), at('T1', 'todo'), at('T2', 'doing')]), H.golden('status-sequence-archived.md'));
for (const [g, def] of Object.entries(GROUPS)) {
  T.eq('C0 renderer = golden status-group-' + g + '.md', renderStatus(groupEntries(def.paths)),
    H.golden('status-group-' + g + '.md'));
}
T.eq('C0 renderer = golden status-problems.md', renderStatus(PROBLEM_ENTRIES), H.golden('status-problems.md'));

/* ===================================================================== */
/* C1 — nj init writes STATUS.md: every configured status, all empty      */
/* ===================================================================== */

const seq = initBacklog('ac23-seq');
T.exit('C1 nj init: exit 0', seq.init as RunResult, 0);
statusIsGolden('C1 after init, STATUS.md lists every configured status, empty', seq, 'status-init.md');

/* ===================================================================== */
/* C2 — after every write command, the overview for that state            */
/* ===================================================================== */

{
  const state: Record<string, StatusEntry> = {};  // key -> entry; active only
  const expect = () => renderStatus(Object.values(state));
  const step = (desc: string, args: string[], change: () => void, golden?: string) => {
    const r = runJ(args, seq);
    T.exit('C2 ' + desc + ': exit 0', r, 0);
    T.check('C2 ' + desc + ': no STATUS.md warning when it can be written', !WARN_RE.test(r.stderr), J(r.stderr));
    change();
    if (golden) statusIsGolden('C2 after ' + desc, seq, golden);
    else statusIs('C2 after ' + desc + ', STATUS.md matches the state', seq, expect());
    return r;
  };
  step('new epic', ['new', '--type=epic', '--title=Verhaltensvertrag'], () => { state.E1 = at('E1', 'todo'); });
  step('new task (high)', ['new', '--type=task', '--parent=EPIC-001', '--title=Parser haerten', '--priority=high'],
    () => { state.T1 = at('T1', 'todo'); });
  step('new task', ['new', '--type=task', '--parent=EPIC-001', '--title=Not-covered-Blindstellen schliessen'],
    () => { state.T2 = at('T2', 'todo'); });
  step('set --status=doing', ['set', '--id=TSK-002', '--status=doing'], () => { state.T2.status = 'doing'; });
  step('note', ['note', '--id=TSK-001', 'Split at the first colon'], () => {});
  step('new subtask, non-ASCII title as stored', ['new', '--type=subtask', '--parent=TSK-001', '--title=Ümlaut ✓ 日本'],
    () => { state.S1 = at('S1', 'todo'); });
  step('new second epic', ['new', '--type=epic', '--title=Abgeschlossen'], () => { state.E2 = at('E2', 'todo'); });
  step('set --status=done', ['set', '--id=EPIC-002', '--status=done'], () => { state.E2.status = 'done'; },
    'status-sequence-done.md');
  step('rm', ['rm', '--id=SUB-001'], () => { delete state.S1; });
  step('new third epic', ['new', '--type=epic', '--title=Weg damit'],
    () => { state.E3 = { id: 'EPIC-003', title: 'Weg damit', status: 'todo', path: 'epics/EPIC-003.md' }; });
  step('new task under it', ['new', '--type=task', '--parent=EPIC-003', '--title=Auch weg'],
    () => { state.T3 = { id: 'TSK-003', title: 'Auch weg', status: 'todo', path: 'tasks/TSK-003.md' }; });
  step('rm --cascade', ['rm', '--id=EPIC-003', '--cascade'], () => { delete state.E3; delete state.T3; });
  step('archive — archived elements are left out', ['archive', '--id=EPIC-002'], () => { delete state.E2; },
    'status-sequence-archived.md');
  step('doctor --fix with nothing to repair', ['doctor', '--fix'], () => {}, 'status-sequence-archived.md');

  T.eq('C2 no temp file is left in the backlog root (atomic write, § 12)',
    H.lsOrEmpty(seq.bl).filter(n => n.startsWith('.nj-tmp-')), []);
  const all = runJ(['list', '--all'], seq);
  T.check('C2 STATUS.md is never read as an element (§ 4)',
    Array.isArray(all.json && all.json.entries) && all.json.entries.every((e: any) => !/STATUS/.test(J(e))),
    J(all.json && all.json.entries).slice(0, 300));
  const doc = runJ(['doctor'], seq);
  T.exit('C2 doctor on the result: exit 0', doc, 0);
  T.eq('C2 doctor on the result: no finding — the overview is fresh', H.doctorSet(doc), []);
}

/* ===================================================================== */
/* C3 — link paths per group: relative to the backlog, '/' separators;    */
/*      the ? section; archived elements left out                         */
/* ===================================================================== */

for (const [g, def] of Object.entries(GROUPS)) {
  const P = def.paths;
  const el = (f: Record<string, unknown>, p: string) => [p, elementBytes(f)];
  const files = Object.fromEntries([
    el({ id: 'EPIC-001', type: 'epic', title: 'Plattform', status: 'todo', priority: 'urgent' }, P.E),
    el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Login-Route', status: 'doing' }, P.T1),
    el({ id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Fehlercodes', status: 'todo', priority: 'low' }, P.S),
    el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Warten auf Review', status: 'waiting' }, P.T2),
    el({ id: 'EPIC-002', type: 'epic', title: 'Erledigt', status: 'done', archived: NOW }, P.A),
    el({ id: 'TSK-003', type: 'task', parent: 'EPIC-002', title: 'Alt', status: 'done', archived: NOW }, P.A2),
  ]);
  const fx = mkFixture('ac23-g-' + g, def.layout, files, ['EPIC-001', 'EPIC-002', 'TSK-001', 'TSK-002', 'TSK-003', 'SUB-001']);
  T.eq('C0 H.statusFor renders the [' + g + '] fixture as the golden', H.statusFor(fx.bl),
    H.golden('status-group-' + g + '.md'));
  const fix = runJ(['doctor', '--fix'], fx);
  T.exit('C3 [' + g + '] doctor --fix: exit 0 (unknown:status is a warning)', fix, 0);
  statusIsGolden('C3 [' + g + '] STATUS.md', fx, 'status-group-' + g + '.md');
  const doc = runJ(['doctor'], fx);
  T.sameSet('C3 [' + g + '] doctor afterwards: only unknown:status, no status_stale',
    H.doctorSet(doc) || ['<no problems array>'], ['unknown:status:warning']);
}

/* C3b — an unknown priority sorts with the default weight, tied with normal,
 * by id (DECISIONS 100, AMBIGUITIES 70); the lines are spelled out, not
 * rendered, so the renderer's weight table is checked too. */
{
  const t = (id: string, title: string, priority?: string) => elementBytes(Object.assign(
    { id, type: 'task', parent: 'EPIC-001', title, status: 'todo' }, priority ? { priority } : {}));
  const fx = mkFixture('ac23-prio', undefined, {
    'epics/EPIC-001.md': elementBytes({ id: 'EPIC-001', type: 'epic', title: 'Home epic', status: 'done' }),
    'tasks/TSK-001.md': t('TSK-001', 'Urgent', 'urgent'),
    'tasks/TSK-002.md': t('TSK-002', 'Normal', 'normal'),
    'tasks/TSK-003.md': t('TSK-003', 'Weird priority', 'someday'),
    'tasks/TSK-004.md': t('TSK-004', 'Normal too', 'normal'),
    'tasks/TSK-005.md': t('TSK-005', 'Low', 'low'),
  }, ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005']);
  const expected = '# Status\n\n## todo (5)\n\n' +
    '- [TSK-001](tasks/TSK-001.md) Urgent\n- [TSK-002](tasks/TSK-002.md) Normal\n' +
    '- [TSK-003](tasks/TSK-003.md) Weird priority\n- [TSK-004](tasks/TSK-004.md) Normal too\n' +
    '- [TSK-005](tasks/TSK-005.md) Low\n\n## doing (0)\n\n## blocked (0)\n\n## review (0)\n\n' +
    '## done (1)\n\n- [EPIC-001](epics/EPIC-001.md) Home epic\n';
  T.eq('C0 H.statusFor weighs an unknown priority as the default', H.statusFor(fx.bl), expected);
  T.exit('C3b doctor --fix with an unknown priority: exit 0 (a warning)', runJ(['doctor', '--fix'], fx), 0);
  statusIs('C3b an unknown priority sorts with the default weight, tied with normal, by id', fx, expected);
}

/* ===================================================================== */
/* C4 — problem elements (§ 4, DECISIONS 95 B18)                          */
/* ===================================================================== */

{
  const f = (fields: Record<string, unknown>, body?: string) => elementBytes(fields, body === undefined ? {} : { body });
  const fx = mkFixture('ac23-problems', undefined, {
    'epics/EPIC-001.md': f({ id: 'EPIC-001', type: 'epic', title: 'Home epic', status: 'todo' }),
    /* missing:status — listed under the derived statuses[0] */
    'tasks/TSK-004.md': f({ id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'No status here' }),
    /* file:unreadable stub (dangling symlink) — no status, so under ? */
    'tasks/TSK-005.md': { symlink: '/nonexistent/nj-ac23/TSK-005.md' },
    /* no title — "- [ID](path)", no trailing space */
    'tasks/TSK-006.md': f({ id: 'TSK-006', type: 'task', parent: 'EPIC-001', status: 'todo' },
      '## Description\nSomething.\n\n## Acceptance Criteria\n- [ ] It works\n'),
    /* duplicate_id — both files, ordered by path */
    'tasks/TSK-007.md': f({ id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'Dup A', status: 'todo' }),
    'tasks/TSK-070.md': f({ id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'Dup B', status: 'todo' }),
  }, ['EPIC-001', 'TSK-004', 'TSK-005', 'TSK-006', 'TSK-007']);
  T.eq('C0 H.statusFor renders the problem fixture as the golden', H.statusFor(fx.bl), H.golden('status-problems.md'));
  /* a write that repairs nothing, so the problems are still there when the
   * overview is rendered (doctor --fix would fill missing:status first) */
  const r = runJ(['note', '--id=EPIC-001', 'trigger the overview'], fx);
  T.exit('C4 note on a healthy element: exit 0', r, 0);
  statusIsGolden('C4 STATUS.md with problem elements', fx, 'status-problems.md');
}

/* ===================================================================== */
/* C5 — stale, deleted, conflicted; reads never write; --fix restores     */
/* ===================================================================== */

function freshSmall(label: string): Fixture {
  const fx = initBacklog(label);
  runJ(['new', '--type=epic', '--title=Verhaltensvertrag'], fx);
  runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Parser haerten', '--priority=high'], fx);
  return fx;
}
const SMALL = renderStatus([at('E1', 'todo'), at('T1', 'todo')]);

const READS: [string, string[]][] = [['bare nj', []], ['list', ['list']], ['list --all', ['list', '--all']],
  ['tree', ['tree']], ['show', ['show', '--id=TSK-001']], ['doctor', ['doctor']]];

const STALE_CASES: [string, (fx: Fixture) => void][] = [
  ['hand-edited', fx => fs.appendFileSync(statusPath(fx), '- [TSK-999](tasks/TSK-999.md) Hand-added\n')],
  ['deleted', fx => fs.rmSync(statusPath(fx), { force: true })],
  ['merge-conflicted', fx => fs.writeFileSync(statusPath(fx),
    '# Status\n\n<<<<<<< HEAD\n## todo (1)\n=======\n## todo (2)\n>>>>>>> feature\n')],
];
for (const [what, spoil] of STALE_CASES) {
  const tag = 'C5 [' + what + ']';
  const fx = freshSmall('ac23-stale');
  statusIs(tag + ' fixture: the overview is fresh', fx, SMALL);
  spoil(fx);
  const spoiled = readStatus(fx);

  const doc = runJ(['doctor'], fx);
  T.exit(tag + ' doctor: exit 0 — a warning', doc, 0);
  T.sameSet(tag + ' doctor reports exactly backlog:status_stale', H.doctorSet(doc) || ['<no problems array>'],
    ['backlog:status_stale:warning']);
  const f = problemsOf(doc).find((p: any) => p.code === 'backlog:status_stale');
  T.check(tag + ' backlog:status_stale is backlog-level (no element)', !!f && !f.element, J(f));

  for (const [name, args] of READS) {
    run(args, fx);
    T.eq(tag + ' ' + name + ' does not write STATUS.md', readStatus(fx), spoiled);
  }
  const bad = run(['set', '--id=TSK-001', '--statuss=doing'], fx);
  T.exit(tag + ' a rejected write: exit 1', bad, 1);
  T.eq(tag + ' a rejected write does not regenerate STATUS.md (only a successful write does)', readStatus(fx), spoiled);

  const fix = runJ(['doctor', '--fix'], fx);
  T.exit(tag + ' doctor --fix: exit 0', fix, 0);
  statusIs(tag + ' doctor --fix restores it byte-identically', fx, SMALL);
  const after = runJ(['doctor'], fx);
  T.eq(tag + ' doctor afterwards is clean', H.doctorSet(after), []);
}

{
  /* any successful write also repairs a stale overview (§ 4 "Written …
   * after every successful write") */
  const fx = freshSmall('ac23-stale-write');
  fs.writeFileSync(statusPath(fx), 'garbage\n');
  T.exit('C5 set on a backlog with a stale overview: exit 0', runJ(['set', '--id=TSK-001', '--status=doing'], fx), 0);
  statusIs('C5 the successful write rewrote the overview for the new state', fx,
    renderStatus([at('E1', 'todo'), at('T1', 'doing')]));
}

/* ===================================================================== */
/* C6 — statusFile: false — never created, never checked, left alone      */
/* ===================================================================== */

function offFixture(label: string, statusContent?: string): Fixture {
  const files: Record<string, string> = {
    'epics/EPIC-001.md': elementBytes({ id: 'EPIC-001', type: 'epic', title: 'Home epic', status: 'todo' }),
    'tasks/TSK-001.md': elementBytes({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Work', status: 'todo' }),
  };
  if (statusContent !== undefined) files['STATUS.md'] = statusContent;
  return mkFixture(label, { statusFile: false }, files, ['EPIC-001', 'TSK-001']);
}

{
  const fx = offFixture('ac23-off');
  const STEPS: [string, string[]][] = [['new', ['new', '--type=task', '--parent=EPIC-001', '--title=More']],
    ['set', ['set', '--id=TSK-001', '--status=doing']], ['note', ['note', '--id=TSK-001', 'x']],
    ['archive', ['archive', '--id=TSK-002']], ['doctor --fix', ['doctor', '--fix']]];
  for (const [name, args] of STEPS) {
    if (name === 'archive') runJ(['set', '--id=TSK-002', '--status=done'], fx);
    const r = runJ(args, fx);
    T.exit('C6 statusFile false: ' + name + ' exit 0', r, 0);
    T.check('C6 statusFile false: ' + name + ' creates no STATUS.md', readStatus(fx) === null, J(readStatus(fx)));
  }
  const doc = runJ(['doctor'], fx);
  T.exit('C6 statusFile false, no STATUS.md: doctor exit 0', doc, 0);
  T.eq('C6 statusFile false: doctor does not check a missing STATUS.md', H.doctorSet(doc), []);
}

{
  const junk = 'hand-written, not an overview\n';
  const fx = offFixture('ac23-off-existing', junk);
  const STEPS: [string, string[]][] = [['new', ['new', '--type=task', '--parent=EPIC-001', '--title=More']],
    ['set', ['set', '--id=TSK-001', '--status=doing']], ['doctor --fix', ['doctor', '--fix']]];
  for (const [name, args] of STEPS) {
    T.exit('C6 statusFile false, existing file: ' + name + ' exit 0', runJ(args, fx), 0);
    T.eq('C6 statusFile false: ' + name + ' leaves an existing STATUS.md alone', readStatus(fx), junk);
  }
  const doc = runJ(['doctor'], fx);
  T.eq('C6 statusFile false: doctor does not check an existing, stale STATUS.md', H.doctorSet(doc), []);
}

/* ===================================================================== */
/* C7 — an unwritable STATUS.md never fails the write (§ 4, D95 B19)      */
/* ===================================================================== */

function maskJson(r: JsonRunResult, fx: Fixture) {
  let s = J(r.json);
  for (const p of [fs.realpathSync(fx.bl), fx.bl]) s = s.split(p).join('<BL>');
  return s;
}

const UNWRITABLE_CASES: [string, (fx: Fixture) => void, (fx: Fixture) => void][] = [
  ['STATUS.md is a non-empty directory', fx => {
    fs.rmSync(statusPath(fx), { force: true });
    fs.mkdirSync(statusPath(fx));
    fs.writeFileSync(path.join(statusPath(fx), 'keep.txt'), 'x\n');
  }, fx => { fs.rmSync(statusPath(fx), { recursive: true, force: true }); }],
  ['the backlog root is read-only', fx => { fs.chmodSync(fx.bl, 0o555); },
    fx => { fs.chmodSync(fx.bl, 0o755); }],
];
for (const [how, block, unblock] of UNWRITABLE_CASES) {
  const tag = 'C7 [' + how + ']';
  const fx = freshSmall('ac23-unw');
  const twin = freshSmall('ac23-twin');
  block(fx);
  let covered = true;
  if (how.includes('read-only')) {
    try { fs.writeFileSync(path.join(fx.bl, '.probe'), ''); fs.rmSync(path.join(fx.bl, '.probe')); covered = false; } catch (e) { /* good */ }
  }
  try {
    if (!covered) {
      T.check(tag + ' not covered: this process can write a mode-555 directory (root?)', false, fx.bl);
      continue;
    }
    const CLAIM_STEPS: [string, string[]][] = [['set', ['set', '--id=TSK-001', '--status=doing']],
      ['new', ['new', '--type=task', '--parent=EPIC-001', '--title=Noch eine']]];
    for (const [name, args] of CLAIM_STEPS) {
      const r = runJ(args, fx);
      const t = runJ(args, twin);
      T.exit(tag + ' ' + name + ': the exit code is unchanged (0)', r, t.status === null ? 0 : t.status);
      T.check(tag + ' ' + name + ': stderr carries "Warning: STATUS.md not updated (<reason>)"', WARN_RE.test(r.stderr), J(r.stderr));
      T.check(tag + ' ' + name + ': the warning is on stderr, not in the JSON stream', !WARN_RE.test(r.stdout), J(r.stdout).slice(0, 200));
      T.eq(tag + ' ' + name + ': the --json result is unchanged', maskJson(r, fx), maskJson(t, twin));
    }
    const shown = runJ(['show', '--id=TSK-001'], fx);
    const e = shown.json && Array.isArray(shown.json.entries) ? shown.json.entries[0] : null;
    T.eq(tag + ' the element write itself happened', e && e.status, 'doing');

    /* doctor --fix keeps the exit code its findings give */
    const fix = runJ(['doctor', '--fix'], fx);
    T.exit(tag + ' doctor --fix: exit 0 — its only finding is a warning', fix, 0);
    T.check(tag + ' doctor --fix warns as well', WARN_RE.test(fix.stderr), J(fix.stderr));
  } finally {
    unblock(fx);
  }
  const doc = runJ(['doctor'], fx);
  T.exit(tag + ' the next doctor: exit 0', doc, 0);
  // TAGS.md never needs a write here at all (freshSmall's fixture and the
  // CLAIM_STEPS below never touch tags, so its content is "(no tags in
  // use)" throughout, matching reality even if a write attempt would have
  // been blocked) -- backlog:tags_stale never enters into either case.
  T.sameSet(tag + ' the next doctor reports backlog:status_stale', H.doctorSet(doc) || ['<no problems array>'],
    ['backlog:status_stale:warning']);
}

/* ===================================================================== */
/* C8 — an earlier --fix step's move or rename makes the overview stale:  */
/*      step 9 rewrites it with the new paths and reports it (D100 as     */
/*      amended in f97e2f7; Verifier finding T1)                          */
/* ===================================================================== */

/* exit-doctor-fix derives its expectation from the observed bytes, so a
 * --fix that moved files but skipped step 9 would pass there. These cases
 * assert the outcome itself: the new paths in STATUS.md, the fixed[] entry,
 * and a clean doctor afterwards. Red before V3-3 by design. */
{
  const task = (id: string, over?: Record<string, unknown>) => H.element(Object.assign({ id, type: 'task', parent: 'EPIC-001',
    title: 'Task ' + id, status: 'todo', created: NOW, updated: NOW }, over || {}), H.completeBody('Task ' + id));
  const epic = H.element({ id: 'EPIC-001', type: 'epic', title: 'Home epic', status: 'todo', created: NOW, updated: NOW },
    '# Home epic\n\n## Description\nSomething.\n');
  interface C8Case {
    what: string;
    files: Record<string, string>;
    edit?: (bl: string) => void;
    after: (bl: string) => boolean;
  }
  const CASES: C8Case[] = [
    { what: 'step 2 renames a file to match its id',
      files: { 'epics/EPIC-001.md': epic, 'tasks/TSK-001.md': task('TSK-002') },
      after: bl => fs.existsSync(path.join(bl, 'tasks', 'TSK-002.md')) },
    { what: 'step 3 moves a file into its type folder',
      files: { 'epics/EPIC-001.md': epic, 'subtasks/TSK-001.md': task('TSK-001') },
      after: bl => fs.existsSync(path.join(bl, 'tasks', 'TSK-001.md')) },
    { what: 'a layout change (type → flat) and --fix',
      files: { 'epics/EPIC-001.md': epic, 'tasks/TSK-001.md': task('TSK-001') },
      edit: bl => {
        const p = path.join(bl, CONFIG_REL);
        const c = JSON.parse(fs.readFileSync(p, 'utf8'));
        c.layout = { group: 'flat' };
        fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
      },
      after: bl => fs.existsSync(path.join(bl, 'TSK-001.md')) },
  ];
  for (const c of CASES) {
    const tag = 'C8 [' + c.what + ']';
    const d = H.mkBacklog({ label: 'ac23-c8', files: c.files, tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'] });
    const fx: Fixture = { dir: d, bl: path.join(d, 'backlog') };
    if (c.edit) c.edit(fx.bl);
    const before = readStatus(fx);
    T.eq(tag + ' fixture: the overview is fresh before --fix', before, H.statusFor(fx.bl));
    const fix = runJ(['doctor', '--fix'], fx);
    T.exit(tag + ' doctor --fix: exit 0', fix, 0);
    T.check(tag + ' fixture: the repair happened', c.after(fx.bl), J(fs.readdirSync(fx.bl)));
    const fresh = H.statusFor(fx.bl);
    T.check(tag + ' fixture: the repair changed the rendering (else this case is vacuous)', fresh !== before, '');
    statusIs(tag + ' STATUS.md lists the NEW paths after --fix', fx, fresh as string);
    const fixed = fix.json && Array.isArray(fix.json.fixed) ? fix.json.fixed : null;
    T.check(tag + ' fixed[] ends with the STATUS.md entry (step 9, last)',
      !!fixed && fixed.length > 0 && String(fixed[fixed.length - 1]).includes('STATUS.md'), J(fixed));
    const doc = runJ(['doctor'], fx);
    T.check(tag + ' the next doctor reports no backlog:status_stale',
      !(H.doctorSet(doc) || ['<no problems array>']).includes('backlog:status_stale:warning'), J(H.doctorSet(doc)));
  }
}

T.finish();
