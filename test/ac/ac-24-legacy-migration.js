'use strict';
/* AC-24 — Legacy migration (spec v3, V3-4 / TSK-028).
 *
 * § 15 AC-24: "On a v2 backlog every command except `doctor` exits 1 with
 * `legacy_layout` and changes nothing; `doctor` reports
 * `backlog:legacy_layout` (exit 2); `doctor --fix` migrates it. Afterwards
 * the configuration and every tombstone are at their v3 places with
 * unchanged content, every element file is byte-identical, `doctor` is
 * clean, and the next `nj new` allocates above every existing number. With
 * both v2 and v3 places present, `--fix` moves nothing and reports it."
 *
 * § 4 "Storage and Layout": the v2 layout (`.nanojira.json` and `.ids/` at
 * the top level) is a legacy layout; every command except `nj doctor`
 * refuses it with `legacy_layout` and points at `nj doctor --fix`. § 4
 * "Backlog location": "A folder with the legacy `.nanojira.json` at its top
 * level is `legacy_layout`, pointing at `nj doctor --fix`."
 * § 7: `backlog:legacy_layout` — error, backlog-level.
 * § 14: doctor reads `.nanojira.json` and `.ids/` from their v2 places; step
 * 0 — create `.nanojira/`, move `.nanojira.json` → `.nanojira/config.json`
 * and `.ids/` → `.nanojira/ids/` (one `rename` each; the configuration content
 * is not rewritten), delete `.nanojira-index.json` if present, replace the
 * pattern `.nanojira-index.json` in `.gitignore` by `.nanojira/index.json`
 * only when that line is present verbatim, otherwise leave `.gitignore`
 * alone and say so in a note. Both places present → nothing moved,
 * reported, never merged; and (DECISIONS 93, 95 B21) no later step writes
 * either, `backlog:legacy_layout` stays an error, exit 2.
 *
 * The v2 backlogs here are built BY HAND on purpose. After V3-4 neither
 * `nj init` nor `H.mkBacklog()` produces a v2 layout, so the legacy fixture
 * cannot depend on either. Every path of the v2 layout is spelled out below.
 *
 * Written before V3-4: against any nj that still reads v2 this suite fails
 * on its assertions (v2 is its native layout there), never on a crash.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

/* HOME pinned, NJ_BACKLOG unset unless a leg sets it. */
const HOME = H.freshDir('ac24-home');
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  return { cwd: o.cwd, env, unsetEnv: env.NJ_BACKLOG === undefined ? ['NJ_BACKLOG'] : [], input: o.input };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }

/* ---- the v2 layout, by hand ------------------------------------------- */

const V2_CONFIG = '.nanojira.json';
const V2_IDS = '.ids';
const V2_INDEX = '.nanojira-index.json';
const V3_DIR = '.nanojira';
const V3_CONFIG = '.nanojira/config.json';
const V3_IDS = '.nanojira/ids';
const V2_GITIGNORE = '.nanojira-index.json\n.nj-tmp-*\n';

/* A valid configuration in deliberately unusual formatting — four-space
 * indent, custom statuses, no trailing newline — so that a migration that
 * re-serialises it instead of moving it cannot go unnoticed. No `layout`:
 * "a migrated v2 configuration without `layout` is valid as it is" (§ 5). */
const V2_CONFIG_BYTES = '{\n    "schema": 1,\n    "statuses": ["todo", "doing", "done"],\n' +
  '    "sections": {"description": ["Description"], "acceptance": ["Acceptance Criteria"]}\n}';

function el(fields, body) { return H.element(Object.assign({ created: NOW, updated: NOW }, fields), body); }
function complete(title) { return H.completeBody(title); }

/* Clean on purpose: complete, H1 = title, valid statuses, every element
 * tombstoned — so the only findings are the layout's, and no --fix step
 * after step 0 has a reason to touch an element file. */
const ELEMENTS = {
  'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'Legacy epic', status: 'doing' },
    '# Legacy epic\n\n## Description\nThe v2 epic.\n'),
  'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Open task', status: 'todo' },
    complete('Open task') + '\n## Notes\n\n### 2026-09-21T18:00:00Z\nKept byte for byte: ümlaut, 漢字, 🚀.\n'),
  'tasks/TSK-003.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'Done task', status: 'done' },
    complete('Done task')),
  'subtasks/SUB-001.md': el({ id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'A subtask', status: 'todo' },
    complete('A subtask')),
  'archive/TSK-004.md': el({ id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'Archived task', status: 'done',
    archived: NOW }, complete('Archived task')),
};
/* Tombstones: every element plus three deleted IDs, the highest of each
 * type being a deleted one — so "allocates above every existing number"
 * needs the tombstones, not just the files. One tombstone carries bytes, so
 * "unchanged content" is not vacuously true of empty files. */
const TOMBSTONES = {
  'EPIC-001': '', 'EPIC-002': '',
  'TSK-001': '', 'TSK-002': '', 'TSK-003': '', 'TSK-004': '', 'TSK-009': 'kept\n',
  'SUB-001': '', 'SUB-004': '',
};
const NEXT = { epic: 'EPIC-003', task: 'TSK-010', subtask: 'SUB-005' };

/* The README a v2 `nj init` wrote — the bytes of v2 `dist/nj` (5318888),
 * which § 14 step 0 (DECISIONS 102) names as the one README it replaces.
 * The sha256 below guards this copy against an accidental edit. Every other
 * README (the default fixture's, a user's) is left alone with a note. */
const V2_README = [
  '# Backlog', '',
  'This folder is a NanoJira backlog. One Markdown file per element, grouped by',
  'type: epics/, tasks/, subtasks/. Archived work lives in archive/.', '',
  'Every file has a YAML-ish frontmatter block between `---` lines and a free',
  'Markdown body. The frontmatter is the truth; the body belongs to you, except',
  'for the `# H1` (mirrors `title`) and the `## Notes` section written by',
  '`nj note`.', '',
  'An element is *ready to work* when its status is the first configured status,',
  'all `depends_on` targets are done, it carries no error, and it has a',
  'non-empty `## Description` (plus `## Acceptance Criteria` for tasks and',
  'subtasks). A heading with nothing under it counts as absent — that is',
  'deliberate.', '',
  '`.ids/` holds one empty tombstone file per allocated ID. It is versioned and',
  'must be committed: it is what guarantees IDs are never reused. Do not delete',
  'it.', '',
  'The only uncommitted artifact is `.nanojira-index.json` (a cache).', '',
  'Useful commands: `nj`, `nj list --ready`, `nj show --id=…`,',
  '`nj new --type=task --parent=EPIC-001 --title="…"`, `nj doctor`.',
].join('\n') + '\n';
const V2_README_SHA = '69c6e56833a7c37d76a0d5a0213cf1990378ac2499ac68e3697ef51ec1aaa606';
T.eq('fixture: the embedded v2 README is the 5318888 init text (sha256)', H.sha256(V2_README), V2_README_SHA);
const CUSTOM_README = '# Backlog\n\nFormat notes.\n';

/**
 * A v2 backlog at <project>/backlog. `o.gitignore`: bytes, or null for no
 * file. `o.index`: write a `.nanojira-index.json`. Returns
 * {dir (project), bl (backlog)}.
 */
function legacy(label, o) {
  const opt = Object.assign({ gitignore: V2_GITIGNORE, index: true, readme: CUSTOM_README }, o || {});
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', V2_IDS]) fs.mkdirSync(path.join(bl, sub), { recursive: true });
  fs.writeFileSync(path.join(bl, V2_CONFIG), V2_CONFIG_BYTES);
  if (opt.gitignore !== null) fs.writeFileSync(path.join(bl, '.gitignore'), opt.gitignore);
  fs.writeFileSync(path.join(bl, 'README.md'), opt.readme);
  if (opt.index) fs.writeFileSync(path.join(bl, V2_INDEX), '{"v":1}\n');
  for (const [rel, body] of Object.entries(opt.elements || ELEMENTS)) {
    fs.mkdirSync(path.dirname(path.join(bl, rel)), { recursive: true });
    fs.writeFileSync(path.join(bl, rel), body);
  }
  for (const [id, body] of Object.entries(opt.tombstones || TOMBSTONES)) fs.writeFileSync(path.join(bl, V2_IDS, id), body);
  return { dir, bl };
}

/* ---- observation ------------------------------------------------------- */

/* Every entry below `root`: type, mode, mtime, bytes. Equal snapshots mean
 * nothing was created, removed, renamed or rewritten. */
function snapshot(root) {
  const out = [];
  (function walk(abs, rel) {
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { out.push(rel + ' ?' + e.code); return; }
    const head = rel + ' mode=' + (st.mode & 0o7777).toString(8) + ' mtime=' + st.mtimeMs;
    if (st.isSymbolicLink()) { out.push(head + ' link->' + fs.readlinkSync(abs)); return; }
    if (st.isDirectory()) {
      out.push(head + ' dir');
      let kids = [];
      try { kids = fs.readdirSync(abs).sort(); } catch (e) { out.push(rel + '/ ?' + e.code); }
      for (const k of kids) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    let sha = '?';
    try { sha = H.sha256(fs.readFileSync(abs)); } catch (e) { sha = '?' + e.code; }
    out.push(head + ' size=' + st.size + ' sha=' + sha);
  })(root, '.');
  return out;
}
function sameTree(desc, before, after) {
  const gone = before.filter(l => !after.includes(l));
  const added = after.filter(l => !before.includes(l));
  return T.check(desc, gone.length === 0 && added.length === 0,
    (gone.length ? 'before only: ' + J(gone.slice(0, 6)) + '\n     ' : '') +
    (added.length ? 'after only:  ' + J(added.slice(0, 6)) : ''));
}

/* {relpath: bytes} of every file below `bl`, as buffers → hex-free sha. */
function files(bl) {
  const out = {};
  (function walk(abs, rel) {
    let kids;
    try { kids = fs.readdirSync(abs); } catch (e) { return; }
    for (const k of kids.sort()) {
      const a = path.join(abs, k), r = rel ? rel + '/' + k : k;
      let st;
      try { st = fs.lstatSync(a); } catch (e) { continue; }
      if (st.isDirectory()) walk(a, r);
      else out[r] = H.sha256(fs.readFileSync(a));
    }
  })(bl, '');
  return out;
}
function ls(p) { return H.lsOrEmpty(p); }
function bytes(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

const LEGACY_SET = ['backlog:legacy_layout:error'];

/* ===================================================================== */
/* L1 — every command except doctor: exit 1, legacy_layout, no change     */
/* ===================================================================== */

/* `legacy_layout` is checked before any command-specific precondition (an
 * acting name, an archived target, …), so each entry below just needs an
 * argument list that *would* be sensible on a migrated backlog — none of
 * those preconditions is ever reached. `unarchive` addresses TSK-004, the
 * one element already sitting under `archive/`; `claim`/`release`/`check`
 * get the flags that would otherwise be their own first refusal (`--as`, a
 * `--text` matching the checkbox `H.completeBody` writes). */
const COMMANDS = [
  ['bare nj', []],
  ['list', ['list']],
  ['list --all', ['list', '--all']],
  ['list --ready', ['list', '--ready']],
  ['find', ['find', 'Must']],
  ['show', ['show', '--id=TSK-001']],
  ['tree', ['tree']],
  ['new', ['new', '--type=task', '--parent=EPIC-001', '--title=Must not be written']],
  ['set', ['set', '--id=TSK-001', '--status=doing']],
  ['note', ['note', '--id=TSK-001', 'Must not be written']],
  ['check', ['check', '--id=TSK-001', '--text=It works', '--on']],
  ['rm', ['rm', '--id=SUB-001']],
  ['rm --cascade', ['rm', '--id=TSK-001', '--cascade']],
  ['archive', ['archive', '--id=TSK-003']],
  ['unarchive', ['unarchive', '--id=TSK-004']],
  ['claim', ['claim', '--id=TSK-001', '--as=agent']],
  ['release', ['release', '--id=TSK-001', '--as=agent']],
];

/* `build()` gives a FRESH {o, root} per run: against an nj that does write,
 * the human run would otherwise consume the fixture (rm, archive) and the
 * --json run would fail for an unrelated reason. */
function refusal(desc, argsOrFn, build) {
  const argsOf = x => (typeof argsOrFn === 'function' ? argsOrFn(x) : argsOrFn);
  let x = build();
  let before = snapshot(x.root);
  const r = run(argsOf(x), x.o);
  T.exit(desc + ': exit 1', r, 1);
  T.check(desc + ': stderr points at `nj doctor --fix` (§ 4)', /doctor --fix/.test(r.stderr || ''), 'stderr = ' + J(r.stderr));
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test(r.stderr || ''), J(r.stderr));
  sameTree(desc + ': changes nothing — the whole tree identical before/after (AC-24)', before, snapshot(x.root));
  x = build();
  before = snapshot(x.root);
  const rj = runJ(argsOf(x), x.o);
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: {ok:false} (§ 9)', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 300));
  T.eq(desc + ' --json: error is legacy_layout', rj.json && rj.json.error, 'legacy_layout');
  T.check(desc + ' --json: never a read shape', !(rj.json && (Array.isArray(rj.json.entries) || Array.isArray(rj.json.ready))),
    J(rj.json).slice(0, 300));
  sameTree(desc + ' --json: changes nothing', before, snapshot(x.root));
}

/* Found by the upward search, from the project root and from a subfolder. */
for (const [name, args] of COMMANDS) {
  refusal('L1 ' + name + ' on a v2 backlog (search)', args, () => {
    const x = legacy('ac24-cmd');
    return { o: { cwd: x.dir }, root: x.dir };
  });
}
refusal('L1 list from a subfolder of a project with a v2 backlog', ['list'], () => {
  const x = legacy('ac24-sub');
  const sub = path.join(x.dir, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  return { o: { cwd: sub }, root: x.dir };
});

/* Through each explicit source. RULED (DECISIONS 101, AMBIGUITIES 71): § 4's "a folder
 * with the legacy `.nanojira.json` at its top level is `legacy_layout`" is
 * not restricted to the search, so a --backlog / NJ_BACKLOG / .njrc that
 * names a v2 backlog is `legacy_layout`, not `invalid_backlog_*`. */
function viaSource(kind) {
  return () => {
    const x = legacy('ac24-' + kind);
    const cwd = path.join(x.dir, 'elsewhere');
    fs.mkdirSync(cwd);
    if (kind === 'rc') fs.writeFileSync(path.join(cwd, '.njrc'), 'backlog = ../backlog\n');
    const o = { cwd };
    if (kind === 'env') o.env = { NJ_BACKLOG: x.bl };
    return { o, root: x.dir, bl: x.bl };
  };
}
/* The flag's value names the fixture built for that run, so args are a
 * function of it. */
refusal('L1 list --backlog=<v2 backlog>', x => ['list', '--backlog=' + x.bl], viaSource('flag'));
refusal('L1 new --backlog=<v2 backlog>', x => ['new', '--type=epic', '--title=No', '--backlog=' + x.bl], viaSource('flag'));
refusal('L1 NJ_BACKLOG=<v2 backlog> list', ['list'], viaSource('env'));
refusal('L1 .njrc → <v2 backlog>, list', ['list'], viaSource('rc'));

/* `init` at a v2 backlog: `exists`, like any occupied target (DECISIONS
 * 101, AMBIGUITIES 72), and it must not touch it. */
{
  const x = legacy('ac24-init');
  const before = snapshot(x.dir);
  const r = run(['init'], { cwd: x.dir });
  T.exit('L1 init where a v2 backlog is: exit 1', r, 1);
  const rj = runJ(['init'], { cwd: x.dir });
  T.check('L1 init where a v2 backlog is --json: {ok:false}', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout));
  T.eq('L1 init where a v2 backlog is --json: error is exists (DECISIONS 101)', rj.json && rj.json.error, 'exists');
  sameTree('L1 init where a v2 backlog is: changes nothing', before, snapshot(x.dir));
}

/* ===================================================================== */
/* L2 — doctor: backlog:legacy_layout, exit 2, reads the v2 places        */
/* ===================================================================== */

{
  const x = legacy('ac24-doctor');
  const before = snapshot(x.dir);
  const r = run(['doctor'], { cwd: x.dir });
  T.exit('L2 doctor on a v2 backlog: exit 2', r, 2);
  const rj = runJ(['doctor'], { cwd: x.dir });
  T.exit('L2 doctor --json: exit 2', rj, 2);
  T.check('L2 doctor --json: the doctor shape {backlog, ok:false, problems[]} (§ 9)',
    !!rj.json && rj.json.ok === false && Array.isArray(rj.json.problems), J(rj.json).slice(0, 300));
  /* The fixture is otherwise clean. STATUS.md does not exist in a v2
   * backlog and statusFile defaults to true, so its absence is the one other
   * finding § 14 predicts (`backlog:status_stale`, warning). RULED
   * (DECISIONS 101, AMBIGUITIES 74): doctor runs every other check against
   * the v2 places. */
  T.sameSet('L2 doctor: backlog:legacy_layout (error) — and nothing but the missing STATUS.md',
    H.doctorSet(rj) || ['<no problems array>'], LEGACY_SET.concat(['backlog:status_stale:warning']));
  const f = (rj.json && rj.json.problems || []).find(p => p && p.code === 'backlog:legacy_layout');
  T.check('L2 backlog:legacy_layout is backlog-level: no element (§ 9)', !!f && f.element === undefined, J(f));
  sameTree('L2 doctor changes nothing', before, snapshot(x.dir));
}
{
  /* doctor reads the v2 places (§ 14): the configuration from
   * .nanojira.json (its statuses decide `unknown:status`), the tombstones
   * from .ids/ (a missing one is `id:no_tombstone`). */
  const els = Object.assign({}, ELEMENTS, {
    'tasks/TSK-005.md': el({ id: 'TSK-005', type: 'task', parent: 'EPIC-001', title: 'In review', status: 'review' },
      complete('In review')),
  });
  const x = legacy('ac24-doctor-reads', { elements: els });
  const rj = runJ(['doctor'], { cwd: x.dir });
  T.exit('L2 doctor on a v2 backlog with findings: exit 2', rj, 2);
  T.sameSet('L2 doctor reads .nanojira.json and .ids/: `review` is unknown to the v2 statuses, TSK-005 has no tombstone',
    H.doctorSet(rj) || ['<no problems array>'],
    LEGACY_SET.concat(['backlog:status_stale:warning', 'unknown:status:warning', 'id:no_tombstone:warning']));
}

/* ===================================================================== */
/* L3 — doctor --fix migrates                                             */
/* ===================================================================== */

/* Everything outside the bookkeeping must be byte-identical afterwards. */
const BOOKKEEPING = new Set([V2_CONFIG, V2_INDEX, '.gitignore', 'STATUS.md', 'README.md']);
function outsideBookkeeping(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const top = k.split('/')[0];
    if (BOOKKEEPING.has(k) || top === V2_IDS || top === V3_DIR) continue;
    out[k] = v;
  }
  return out;
}

function migrated(desc, x, fix, gitignoreWant, wantNote) {
  const before = files(x.bl);
  const tombs = {};
  for (const id of ls(path.join(x.bl, V2_IDS))) tombs[id] = bytes(path.join(x.bl, V2_IDS, id));
  const cfg = bytes(path.join(x.bl, V2_CONFIG));
  const readmeBefore = bytes(path.join(x.bl, 'README.md'));
  /* "each one `rename`" (§ 14 step 0): a rename keeps the inode and the
   * mtime; a copy-and-delete does not. */
  const statOf = p => { try { const st = fs.statSync(p); return st.ino + '@' + st.mtimeMs; } catch (e) { return null; } };
  const cfgStat = statOf(path.join(x.bl, V2_CONFIG));
  const idsStat = statOf(path.join(x.bl, V2_IDS));
  const tombStat = {};
  for (const id of Object.keys(tombs)) tombStat[id] = statOf(path.join(x.bl, V2_IDS, id));

  const r = fix();
  T.exit(desc + ': doctor --fix exit 0 — no error remains (§ 14)', r, 0);
  T.check(desc + ': fixed[] reports the migration', !!r.json && Array.isArray(r.json.fixed) && r.json.fixed.length > 0,
    'fixed = ' + J(r.json && r.json.fixed));
  T.sameSet(desc + ': problems[] after the repair is empty', H.doctorSet(r) || ['<no problems array>'], []);

  T.eq(desc + ': .nanojira/config.json holds the v2 configuration byte for byte', bytes(path.join(x.bl, V3_CONFIG)), cfg);
  T.check(desc + ': .nanojira.json is gone from the top level', !fs.existsSync(path.join(x.bl, V2_CONFIG)), 'still there');
  T.eq(desc + ': .nanojira/ids/ holds every tombstone', ls(path.join(x.bl, V3_IDS)), Object.keys(tombs).sort());
  const moved = {};
  for (const id of Object.keys(tombs)) moved[id] = bytes(path.join(x.bl, V3_IDS, id));
  T.eq(desc + ': every tombstone keeps its content', moved, tombs);
  T.check(desc + ': .ids/ is gone from the top level', !fs.existsSync(path.join(x.bl, V2_IDS)), 'still there');
  T.eq(desc + ': the configuration was moved by rename (same inode and mtime)', statOf(path.join(x.bl, V3_CONFIG)), cfgStat);
  T.eq(desc + ': .ids/ was moved by one rename (the folder keeps its inode)',
    statOf(path.join(x.bl, V3_IDS)) && statOf(path.join(x.bl, V3_IDS)).split('@')[0], idsStat && idsStat.split('@')[0]);
  const tombAfter = {};
  for (const id of Object.keys(tombs)) tombAfter[id] = statOf(path.join(x.bl, V3_IDS, id));
  T.eq(desc + ': every tombstone keeps its inode and mtime (moved, not rewritten)', tombAfter, tombStat);
  T.check(desc + ': .nanojira-index.json is deleted', !fs.existsSync(path.join(x.bl, V2_INDEX)), 'still there');
  T.eq(desc + ': every element file is byte-identical',
    outsideBookkeeping(files(x.bl)), outsideBookkeeping(before));
  T.eq(desc + ': .gitignore', bytes(path.join(x.bl, '.gitignore')), gitignoreWant);
  const notes = r.json && Array.isArray(r.json.notes) ? r.json.notes : [];
  if (wantNote) {
    T.check(desc + ': a note says .gitignore was left alone (§ 14)', notes.some(n => J(n).includes('.gitignore')), 'notes = ' + J(notes));
  }
  /* README.md (§ 14 step 0, DECISIONS 102) */
  const readme = bytes(path.join(x.bl, 'README.md'));
  if (readmeBefore === V2_README) {
    T.check(desc + ': the pristine v2 README is replaced by the v3 text', readme !== null && readme !== V2_README, J(readme).slice(0, 200));
    T.check(desc + ': the v3 README names .nanojira/', (readme || '').includes('.nanojira/'), J(readme).slice(0, 300));
    T.check(desc + ': the v3 README no longer names the v2 places (.ids/, .nanojira.json, .nanojira-index.json)',
      !/\.ids\/|\.nanojira\.json|\.nanojira-index\.json/.test(readme || ''), J(readme).slice(0, 300));
  } else {
    T.eq(desc + ': a README that is not the v2 init text is left alone, byte for byte', readme, readmeBefore);
    T.check(desc + ': a note says README.md was left alone (§ 14)', notes.some(n => J(n).includes('README')), 'notes = ' + J(notes));
  }

  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(desc + ': a following doctor exits 0', d, 0);
  T.sameSet(desc + ': a following doctor is clean', H.doctorSet(d) || ['<no problems array>'], []);

  const l = runJ(['list', '--all'], { cwd: x.dir });
  T.exit(desc + ': list works on the migrated backlog', l, 0);
  T.eq(desc + ': list --all shows every element', (l.json && l.json.entries || []).map(e => e.id).sort(),
    ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-003', 'TSK-004']);
  for (const [type, extra] of [['epic', []], ['task', ['--parent=EPIC-001']], ['subtask', ['--parent=TSK-001']]]) {
    const n = runJ(['new', '--type=' + type, '--title=After migration'].concat(extra), { cwd: x.dir });
    T.exit(desc + ': nj new --type=' + type + ' after the migration', n, 0);
    T.eq(desc + ': the next ' + type + ' is above every existing number (tombstones included)', n.json && n.json.id, NEXT[type]);
  }
  T.check(desc + ': new tombstones land in .nanojira/ids/', ls(path.join(x.bl, V3_IDS)).includes(NEXT.task),
    J(ls(path.join(x.bl, V3_IDS))));
  T.check(desc + ': and .ids/ is not recreated', !fs.existsSync(path.join(x.bl, V2_IDS)), 'recreated');
}

{
  /* The default v2 .gitignore: the verbatim line is replaced, the other
   * line kept. */
  const x = legacy('ac24-fix');
  migrated('L3 search', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }), '.nanojira/index.json\n.nj-tmp-*\n', false);
}
{
  const x = legacy('ac24-fix-flag', { index: false });
  const cwd = path.join(x.dir, 'elsewhere');
  fs.mkdirSync(cwd);
  migrated('L3 --backlog, no index file', x, () => runJ(['doctor', '--fix', '--backlog=' + x.bl], { cwd }),
    '.nanojira/index.json\n.nj-tmp-*\n', false);
}
{
  /* User lines around the verbatim one: only that line changes. */
  const x = legacy('ac24-fix-gi-extra', { gitignore: '# mine\nnode_modules/\n.nanojira-index.json\n*.log\n.nj-tmp-*\n' });
  migrated('L3 .gitignore with user lines', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }),
    '# mine\nnode_modules/\n.nanojira/index.json\n*.log\n.nj-tmp-*\n', false);
}
/* CRLF (DECISIONS 101): the verbatim match ignores a trailing \r, and the
 * replacement keeps the line's own ending. */
{
  const x = legacy('ac24-fix-gi-crlf', { gitignore: '.nanojira-index.json\r\n.nj-tmp-*\r\n' });
  migrated('L3 a CRLF .gitignore', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }),
    '.nanojira/index.json\r\n.nj-tmp-*\r\n', false);
}
{
  const x = legacy('ac24-fix-gi-mixed', { gitignore: '# mine\n.nanojira-index.json\r\n.nj-tmp-*\n' });
  migrated('L3 a mixed-ending .gitignore: only that line, its CRLF kept', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }),
    '# mine\n.nanojira/index.json\r\n.nj-tmp-*\n', false);
}
{
  /* the last line without any line end */
  const x = legacy('ac24-fix-gi-noeol', { gitignore: '.nj-tmp-*\n.nanojira-index.json' });
  migrated('L3 the verbatim line as the last line without a newline', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }),
    '.nj-tmp-*\n.nanojira/index.json', false);
}

/* Not verbatim → .gitignore left alone, and a note says so. */
for (const [label, gi] of [
  ['without the line', '.nj-tmp-*\n'],
  ['with a rooted "/.nanojira-index.json"', '/.nanojira-index.json\n.nj-tmp-*\n'],
  ['with a trailing comment on the line', '.nanojira-index.json # index\n.nj-tmp-*\n'],
]) {
  const x = legacy('ac24-fix-gi', { gitignore: gi });
  migrated('L3 .gitignore ' + label, x, () => runJ(['doctor', '--fix'], { cwd: x.dir }), gi, true);
}
{
  /* RULED (DECISIONS 101, AMBIGUITIES 74): "otherwise … left alone and a
   * note says so" covers an absent file as well: not created, and noted. */
  const x = legacy('ac24-fix-nogi', { gitignore: null });
  migrated('L3 no .gitignore at all (not created)', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }), null, true);
}
{
  /* RULED (DECISIONS 101, AMBIGUITIES 73): an EMPTY `.nanojira/` beside the v2 files is
   * neither v3 place (`config.json`, `ids/`), so step 0 proceeds. */
  const x = legacy('ac24-fix-emptydir');
  fs.mkdirSync(path.join(x.bl, V3_DIR));
  migrated('L3 an empty .nanojira/ already present', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }),
    '.nanojira/index.json\n.nj-tmp-*\n', false);
}
{
  /* DECISIONS 102: the README a v2 init wrote is replaced by the v3 text */
  const x = legacy('ac24-fix-readme', { readme: V2_README });
  migrated('L3 the pristine v2 README', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }), '.nanojira/index.json\n.nj-tmp-*\n', false);
}
{
  /* one byte off the v2 text is a user's README: left alone, noted */
  const x = legacy('ac24-fix-readme-edited', { readme: V2_README + 'My own line.\n' });
  migrated('L3 a v2 README with one line added', x, () => runJ(['doctor', '--fix'], { cwd: x.dir }), '.nanojira/index.json\n.nj-tmp-*\n', false);
}
{
  /* Human output of the same repair: exit 0 as well. */
  const x = legacy('ac24-fix-human');
  const r = run(['doctor', '--fix'], { cwd: x.dir });
  T.exit('L3 doctor --fix (human): exit 0', r, 0);
  T.check('L3 doctor --fix (human): migrated', fs.existsSync(path.join(x.bl, V3_CONFIG)) && !fs.existsSync(path.join(x.bl, V2_CONFIG)),
    J(ls(x.bl)));
}

/* ===================================================================== */
/* L4 — v2 and v3 places both present: nothing moves, nothing is written  */
/* ===================================================================== */

function ambiguous(desc, x) {
  const before = snapshot(x.dir);
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(desc + ': doctor --fix exit 2 (DECISIONS 95 B21)', r, 2);
  T.check(desc + ': backlog:legacy_layout still reported as an error',
    (H.doctorSet(r) || []).includes('backlog:legacy_layout:error'), J(r.json && r.json.problems).slice(0, 300));
  T.check(desc + ': fixed[] is empty — no step wrote anything (§ 14, DECISIONS 93)',
    !!r.json && Array.isArray(r.json.fixed) && r.json.fixed.length === 0, 'fixed = ' + J(r.json && r.json.fixed));
  sameTree(desc + ': nothing moved, merged or written — the whole tree identical', before, snapshot(x.dir));
  const h = run(['doctor', '--fix'], { cwd: x.dir });
  T.exit(desc + ' (human): exit 2', h, 2);
  sameTree(desc + ' (human): still nothing written', before, snapshot(x.dir));
}
{
  const x = legacy('ac24-both-cfg');
  fs.mkdirSync(path.join(x.bl, V3_DIR));
  fs.writeFileSync(path.join(x.bl, V3_CONFIG), '{"schema": 1, "statuses": ["todo", "done"]}\n');
  ambiguous('L4 .nanojira.json and .nanojira/config.json both present', x);
}
{
  const x = legacy('ac24-both-ids');
  fs.mkdirSync(path.join(x.bl, V3_IDS), { recursive: true });
  fs.writeFileSync(path.join(x.bl, V3_IDS, 'TSK-001'), '');
  ambiguous('L4 .ids/ and .nanojira/ids/ both present', x);
}
{
  const x = legacy('ac24-both-ids-empty');
  fs.mkdirSync(path.join(x.bl, V3_IDS), { recursive: true });
  ambiguous('L4 .ids/ and an empty .nanojira/ids/ both present', x);
}
{
  const x = legacy('ac24-both-all');
  fs.mkdirSync(path.join(x.bl, V3_IDS), { recursive: true });
  fs.writeFileSync(path.join(x.bl, V3_CONFIG), V2_CONFIG_BYTES);
  ambiguous('L4 both places of both present', x);
}

/* ===================================================================== */
/* L5 — an interrupted step 0: the renames happened, the fix-ups did not  */
/*      (DECISIONS 108 G2)                                                */
/* ===================================================================== */

/*
 * § 14 step 0 renames the configuration and the tombstones, deletes the v2
 * index file, then fixes up `.gitignore` and `README.md`. A crash between
 * the renames and the fix-ups — or, before G2, any `--fix` run whose first
 * call already finished the renames — left a backlog that `doctor` no
 * longer recognises as legacy (there is no top-level `.nanojira.json` to
 * key `backlog:legacy_layout` on), so step 0 never ran again, and the
 * `.gitignore`/README fix-ups were undone forever. G2's fix: those two
 * fix-ups run on every `--fix`, legacy or not — both are no-ops when
 * nothing matches.
 *
 * The fixture below simulates exactly that crash point by hand: a BY THE
 * BOOK v3 backlog (config and tombstones already at their v3 places,
 * element files already where group `type` puts them — the renames'
 * result) whose `.gitignore` and `README.md` are still the stale v2 bytes
 * the renames never touched.
 */

/**
 * A v3 backlog whose `.gitignore`/`README.md` are still v2 — the interrupted
 * step 0 state. `o.gitignore`: bytes, or null for no file. `o.readme`: the
 * README bytes (default: the pristine v2 text, so the replacement leg is
 * exercised by default).
 */
function interrupted(label, o) {
  const opt = Object.assign({ gitignore: V2_GITIGNORE, readme: V2_README }, o || {});
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive']) fs.mkdirSync(path.join(bl, sub), { recursive: true });
  fs.mkdirSync(path.join(bl, V3_IDS), { recursive: true });
  fs.writeFileSync(path.join(bl, V3_CONFIG), V2_CONFIG_BYTES);
  if (opt.gitignore !== null) fs.writeFileSync(path.join(bl, '.gitignore'), opt.gitignore);
  if (opt.readme !== null) fs.writeFileSync(path.join(bl, 'README.md'), opt.readme);
  for (const [rel, body] of Object.entries(ELEMENTS)) {
    fs.mkdirSync(path.dirname(path.join(bl, rel)), { recursive: true });
    fs.writeFileSync(path.join(bl, rel), body);
  }
  for (const id of Object.keys(TOMBSTONES)) fs.writeFileSync(path.join(bl, V3_IDS, id), TOMBSTONES[id]);
  return { dir, bl };
}

/*
 * RULING (DECISIONS 108 G2 follow-up): on a backlog that is NOT legacy —
 * this fixture, after the renames — the .gitignore/README fix-ups are
 * SILENT when they don't apply: no note, no `fixed[]` entry. A note "left
 * alone" is for an actual step-0 migration of a genuinely legacy backlog
 * (the L3 section above, unchanged); otherwise every `--fix` on every
 * ordinary v3 backlog would gain a note for a check that was never
 * relevant. A fix-up that DOES apply is reported in `fixed[]` regardless —
 * DECISIONS 100: "`fixed[]` lists what `--fix` wrote" — so silence is only
 * for the part that changed nothing. `gitignoreApplies`/`readmeApplies`:
 * whether that fix-up was expected to change this fixture's starting bytes.
 */
function interruptedFix(desc, x, gitignoreWant, gitignoreApplies, readmeApplies) {
  /* Non-vacuous: this is NOT a legacy backlog — no top-level `.nanojira.json`
   * means `backlog:legacy_layout` does not fire, which is exactly why step 0
   * (gated on that finding, before G2) never ran again. */
  const pre = runJ(['doctor'], { cwd: x.dir });
  T.check(desc + ': fixture is not seen as legacy (no backlog:legacy_layout)',
    !(H.doctorSet(pre) || []).includes('backlog:legacy_layout:error'), J(pre.json && pre.json.problems).slice(0, 300));

  const before = outsideBookkeeping(files(x.bl));
  const tombsBefore = {};
  for (const id of ls(path.join(x.bl, V3_IDS))) tombsBefore[id] = bytes(path.join(x.bl, V3_IDS, id));
  const cfgBefore = bytes(path.join(x.bl, V3_CONFIG));

  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(desc + ': doctor --fix exit 0 — no error remains (§ 14)', r, 0);
  T.sameSet(desc + ': problems[] after the repair is empty', H.doctorSet(r) || ['<no problems array>'], []);

  T.eq(desc + ': every element file is still byte-identical (G2 touches no element)',
    outsideBookkeeping(files(x.bl)), before);
  const tombsAfter = {};
  for (const id of ls(path.join(x.bl, V3_IDS))) tombsAfter[id] = bytes(path.join(x.bl, V3_IDS, id));
  T.eq(desc + ': every tombstone is still byte-identical', tombsAfter, tombsBefore);
  T.eq(desc + ': .nanojira/config.json is still byte-identical', bytes(path.join(x.bl, V3_CONFIG)), cfgBefore);

  const notes = r.json && Array.isArray(r.json.notes) ? r.json.notes : [];
  T.eq(desc + ': no note is produced — this backlog was never legacy (§ 14, DECISIONS 108 G2)', notes, []);
  const fixed = r.json && Array.isArray(r.json.fixed) ? r.json.fixed : [];

  T.eq(desc + ': .gitignore', bytes(path.join(x.bl, '.gitignore')), gitignoreWant);
  if (gitignoreApplies) {
    T.check(desc + ': fixed[] reports the .gitignore replacement', fixed.some(n => J(n).includes('.gitignore')), J(fixed));
  } else {
    T.check(desc + ': fixed[] does not mention .gitignore — nothing to do', !fixed.some(n => J(n).includes('.gitignore')), J(fixed));
  }

  const readme = bytes(path.join(x.bl, 'README.md'));
  if (readmeApplies) {
    T.check(desc + ': the pristine v2 README is replaced by the v3 text', readme !== null && readme !== V2_README, J(readme).slice(0, 200));
    T.check(desc + ': the v3 README names .nanojira/', (readme || '').includes('.nanojira/'), J(readme).slice(0, 300));
    T.check(desc + ': the v3 README no longer names the v2 places (.ids/, .nanojira.json, .nanojira-index.json)',
      !/\.ids\/|\.nanojira\.json|\.nanojira-index\.json/.test(readme || ''), J(readme).slice(0, 300));
    T.check(desc + ': fixed[] reports the README replacement', fixed.some(n => J(n).includes('README')), J(fixed));
  } else {
    T.check(desc + ': fixed[] does not mention README — nothing to do', !fixed.some(n => J(n).includes('README')), J(fixed));
  }

  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit(desc + ': a following doctor exits 0', d, 0);
  T.sameSet(desc + ': a following doctor is clean', H.doctorSet(d) || ['<no problems array>'], []);

  /* "a second --fix is a no-op" (DECISIONS 108 G2): both fix-ups already
   * match (or were already left alone), so nothing is written again. */
  const treeAfterFirst = snapshot(x.dir);
  const r2 = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit(desc + ': a second doctor --fix: exit 0', r2, 0);
  T.eq(desc + ': a second doctor --fix is a no-op: fixed[] is empty', r2.json && r2.json.fixed, []);
  T.eq(desc + ': a second doctor --fix is a no-op: notes[] is empty', r2.json && r2.json.notes, []);
  sameTree(desc + ': a second doctor --fix is a no-op: nothing written', treeAfterFirst, snapshot(x.dir));

  const l = runJ(['list', '--all'], { cwd: x.dir });
  T.exit(desc + ': list works on the repaired backlog', l, 0);
  T.eq(desc + ': list --all shows every element', (l.json && l.json.entries || []).map(e => e.id).sort(),
    ['EPIC-001', 'SUB-001', 'TSK-001', 'TSK-003', 'TSK-004']);
}

{
  /* Both fix-ups apply: the default verbatim .gitignore and the pristine
   * v2 README, with nothing else to migrate. */
  const x = interrupted('ac24-g2-both');
  interruptedFix('L5 an interrupted step 0, both fix-ups due', x,
    '.nanojira/index.json\n.nj-tmp-*\n', true, true);
}
{
  /* The README was edited: left alone, SILENTLY (not legacy); .gitignore
   * still fixed, reported. */
  const x = interrupted('ac24-g2-readme-edited', { readme: V2_README + 'My own line.\n' });
  interruptedFix('L5 an interrupted step 0, README already edited', x,
    '.nanojira/index.json\n.nj-tmp-*\n', true, false);
}
{
  /* .gitignore is not verbatim (the pattern reworded): left alone,
   * SILENTLY; the README still gets replaced, reported. */
  const x = interrupted('ac24-g2-gi-reworded', { gitignore: '# index\n.nj-tmp-*\n' });
  interruptedFix('L5 an interrupted step 0, .gitignore not verbatim', x,
    '# index\n.nj-tmp-*\n', false, true);
}
{
  /* Neither applies: both left alone, SILENTLY, exit 0 all the same —
   * a fix-up that doesn't apply is not a fault, and not a note either
   * on a backlog this was never legacy (§ 14, DECISIONS 108 G2). */
  const x = interrupted('ac24-g2-neither', { gitignore: '.nj-tmp-*\n', readme: CUSTOM_README });
  interruptedFix('L5 an interrupted step 0, neither fix-up applies', x, '.nj-tmp-*\n', false, false);
}
{
  /* No .gitignore at all: not created, SILENTLY (DECISIONS 101/74 for the
   * rule; 108 G2 follow-up for the silence on a non-legacy backlog). */
  const x = interrupted('ac24-g2-nogi', { gitignore: null });
  interruptedFix('L5 an interrupted step 0, no .gitignore at all', x, null, false, true);
}

/* ===================================================================== */
/* G1 — a stray top-level .ids/ left by a crash BETWEEN step 0's two      */
/* renames, on a backlog that is otherwise already v3 (DECISIONS 108 G1,  */
/* promoted v3.2 § E.2, D138: SPECIFICATION.md § 14 step 0)               */
/* ===================================================================== */

/*
 * Distinct from L4's "both v2 and v3 places present" (above): L4's fixture
 * is still legacy (the CONFIG is still at its v2 place, so the whole
 * backlog reads as `backlog:legacy_layout` and step 0 refuses to touch
 * anything, ambiguous). This fixture is already fully v3 — config and the
 * real tombstones both at their v3 places, `.gitignore`/README already
 * correct — with only a stray top-level `.ids/` left over from a crash
 * that finished the OTHER rename (`.nanojira.json` → `.nanojira/config.json`)
 * but not this one (`.ids/` → `.nanojira/ids/`). `backlog:legacy_layout`
 * does not fire here (no top-level `.nanojira.json`), so this is reached
 * only because G2 (above) made the renameless fix-ups — and now this
 * cleanup — run on every `--fix`, not only a `backlog:legacy_layout` one.
 */

/**
 * A v3 backlog (step 0 fully done, no `.gitignore`/README drift) with a
 * stray top-level `.ids/` holding `strayTombstones`. `.nanojira/ids/`
 * always carries the real `TOMBSTONES`.
 */
function strayIds(label, strayTombstones) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive']) fs.mkdirSync(path.join(bl, sub), { recursive: true });
  fs.mkdirSync(path.join(bl, V3_IDS), { recursive: true });
  fs.writeFileSync(path.join(bl, V3_CONFIG), V2_CONFIG_BYTES);
  fs.writeFileSync(path.join(bl, '.gitignore'), '.nanojira/index.json\n.nj-tmp-*\n');
  fs.writeFileSync(path.join(bl, 'README.md'), CUSTOM_README);
  for (const [rel, body] of Object.entries(ELEMENTS)) {
    fs.mkdirSync(path.dirname(path.join(bl, rel)), { recursive: true });
    fs.writeFileSync(path.join(bl, rel), body);
  }
  for (const id of Object.keys(TOMBSTONES)) fs.writeFileSync(path.join(bl, V3_IDS, id), TOMBSTONES[id]);
  fs.mkdirSync(path.join(bl, V2_IDS), { recursive: true });
  for (const [id, body] of Object.entries(strayTombstones)) fs.writeFileSync(path.join(bl, V2_IDS, id), body);
  return { dir, bl };
}

{
  /* Every tombstone in the stray .ids/ is already mirrored in
   * .nanojira/ids/ (a subset of the real set): --fix removes the stray
   * directory outright, notes it, changes nothing else, and a repeat run
   * is a no-op. */
  const mirrored = { 'EPIC-001': '', 'TSK-001': 'kept\n' };
  const x = strayIds('ac24-g1-mirrored', mirrored);
  const pre = runJ(['doctor'], { cwd: x.dir });
  T.check('G1 fixture: not seen as legacy', !(H.doctorSet(pre) || []).includes('backlog:legacy_layout:error'),
    J(pre.json && pre.json.problems).slice(0, 300));
  T.check('G1 fixture: the stray .ids/ exists before --fix', fs.existsSync(path.join(x.bl, V2_IDS)), 'missing');

  const before = outsideBookkeeping(files(x.bl));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.check('G1 mirrored: --fix does not fail the run', r.status === 0 || r.status === 2, J(r.json));
  T.check('G1 mirrored: the stray .ids/ is gone', !fs.existsSync(path.join(x.bl, V2_IDS)), 'still there');
  T.eq('G1 mirrored: .nanojira/ids/ is untouched (every real tombstone, unchanged content)',
    Object.keys(TOMBSTONES).sort().map(id => bytes(path.join(x.bl, V3_IDS, id))),
    Object.keys(TOMBSTONES).sort().map(id => TOMBSTONES[id]));
  T.eq('G1 mirrored: every element file is byte-identical', outsideBookkeeping(files(x.bl)), before);
  const notes = (r.json && r.json.notes) || [];
  T.check('G1 mirrored: a note says the stray .ids/ was removed (§ 14)',
    notes.some(n => J(n).includes('.ids')), 'notes = ' + J(notes));

  const r2 = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.check('G1 mirrored: a second --fix is a no-op for this (no .ids/ to remove, no note about it)',
    !((r2.json && r2.json.notes) || []).some(n => J(n).includes('.ids')), J(r2.json && r2.json.notes));
  T.check('G1 mirrored: doctor stays clean of this (no crash, no new finding)', r2.status === 0 || r2.status === 2, J(r2.json));
}
{
  /* A tombstone in the stray .ids/ that .nanojira/ids/ does NOT have:
   * never discard a tombstone that exists nowhere else (§ 8) — the stray
   * directory is left alone entirely, including its mirrored siblings. */
  const unmirrored = { 'EPIC-001': '', 'TSK-999': 'orphan\n' };
  const x = strayIds('ac24-g1-unmirrored', unmirrored);
  const before = outsideBookkeeping(files(x.bl));
  const beforeStray = fs.readdirSync(path.join(x.bl, V2_IDS)).sort();

  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.check('G1 unmirrored: --fix does not fail the run', r.status === 0 || r.status === 2, J(r.json));
  T.check('G1 unmirrored: the stray .ids/ is left alone entirely', fs.existsSync(path.join(x.bl, V2_IDS)), 'removed');
  T.eq('G1 unmirrored: every tombstone in it is untouched, including the mirrored one',
    fs.readdirSync(path.join(x.bl, V2_IDS)).sort(), beforeStray);
  T.eq('G1 unmirrored: TSK-999 — found nowhere else — is not discarded (§ 8 never-reuse)',
    bytes(path.join(x.bl, V2_IDS, 'TSK-999')), 'orphan\n');
  T.eq('G1 unmirrored: every element file is byte-identical', outsideBookkeeping(files(x.bl)), before);
}

T.finish();
