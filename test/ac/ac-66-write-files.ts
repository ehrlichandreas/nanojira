/* AC-66 — every write result lists the files it touched: `files: [{path,
 * op}]` (docs/SPECIFICATION.md § 9; DECISIONS 222; TSK-045).
 *
 * Found by an outside team (feedback/knowledge4ai-team TSK-002): in a shared
 * checkout they commit with a pathspec, `git commit -- <own files>`, never
 * `git add backlog/`. `new` also writes the tombstone `.nanojira/ids/<ID>`,
 * which nothing in the result named, so their Lead committed two subtasks
 * without their tombstones. STATUS.md, TAGS.md and the files a `set
 * --parent` moves under the hierarchy layout raise the same question.
 *
 * The oracle is the backlog itself: every case snapshots the real backlog
 * before and after the real call, and `files` must name exactly the paths
 * whose content appeared, changed or disappeared. A `moved` entry counts
 * as its `from` deleted and its `path` created. Left out on both sides:
 * `.nanojira/claims/` and `.nanojira/index.json` (gitignored bookkeeping)
 * and nanojira's own scratch files (`.nj-tmp-*`, `.nj-rm-*`).
 *
 * Also: paths are relative to the backlog root and sorted; `files` is `[]`
 * when nothing is written; it survives `--quiet` and `--fields`; a batch
 * carries it once, on the wrapper; `--dry-run` lists what the real call
 * writes; the NJ_ON_CHANGE hook's stdin carries it too.
 *
 * Written before the fix: red against 79a4e74.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr) + J(r.stdout));
  return r;
}
const ENV = { NJ_NOW: H.FIXED_NOW };
function run(args: string[], cwd: string, env?: Record<string, string>): RunResult {
  return H.runNj(args, { cwd, env: Object.assign({}, ENV, env || {}), unsetEnv: ['NJ_BACKLOG', 'NJ_ON_CHANGE'] });
}
function runJ(args: string[], cwd: string, env?: Record<string, string>) {
  const unsetEnv = env && 'NJ_ON_CHANGE' in env ? ['NJ_BACKLOG'] : ['NJ_BACKLOG', 'NJ_ON_CHANGE'];
  return H.runJson(args, { cwd, env: Object.assign({}, ENV, env || {}), unsetEnv });
}

const OPS = ['created', 'modified', 'moved', 'deleted'];

/** Every file below the backlog root, by relative path, minus what is never listed. */
function snapshot(bl: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const n of fs.readdirSync(dir).sort()) {
      const r = rel === '' ? n : rel + '/' + n;
      if (r === '.nanojira/claims' || r === '.nanojira/index.json' || n.startsWith('.nj-tmp-') || n.startsWith('.nj-rm-')) continue;
      const p = path.join(dir, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else files.set(r, st.isSymbolicLink() ? 'link:' + fs.readlinkSync(p) : fs.readFileSync(p, 'utf8'));
    }
  };
  if (fs.existsSync(bl)) walk(bl, '');
  return files;
}
/** What changed between two snapshots, as `path op` lines (op: created/modified/deleted), sorted. */
function diffLines(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [p, v] of b) {
    if (!a.has(p)) out.push(p + ' created');
    else if (a.get(p) !== v) out.push(p + ' modified');
  }
  for (const p of a.keys()) if (!b.has(p)) out.push(p + ' deleted');
  return out.sort();
}
/** `files` as the same kind of lines: a move is its `from` deleted and its `path` created. */
function filesLines(files: any[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.op === 'moved') { out.push(f.from + ' deleted'); out.push(f.path + ' created'); }
    else out.push(f.path + ' ' + f.op);
  }
  return out.sort();
}
/** `files`' own shape: an array of {path, op[, from]}, relative paths, sorted by path, no duplicates. */
function checkShape(label: string, files: unknown): files is any[] {
  if (!Array.isArray(files)) { T.check(label + ': files is an array', false, J(files)); return false; }
  const bad = files.filter((f: any) => !f || typeof f.path !== 'string' || !OPS.includes(f.op)
    || path.isAbsolute(f.path) || f.path.startsWith('..') || f.path.includes('\\')
    || (f.op === 'moved') !== (typeof f.from === 'string')
    || Object.keys(f).some((k) => !['path', 'op', 'from'].includes(k)));
  T.check(label + ': every entry is {path, op[, from]}, relative', bad.length === 0, J(bad));
  const paths = files.map((f: any) => f.path);
  T.check(label + ': sorted by path, each path once', J(paths) === J([...new Set(paths)].sort()), J(paths));
  return true;
}

/** Runs `args` for real and checks `files` against what changed on disk. Returns the result. */
function writes(label: string, dir: string, args: string[], env?: Record<string, string>) {
  const bl = path.join(dir, 'backlog');
  const before = snapshot(bl);
  const r = runJ(args, dir, env);
  T.exit(label + ': exit 0', r, 0);
  const files = r.json && r.json.files;
  if (checkShape(label, files)) {
    T.eq(label + ': files is exactly what changed on disk', J(filesLines(files)), J(diffLines(before, snapshot(bl))));
  }
  return r;
}

function flat(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [ ] a'], dir), 'new task 1');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] a'], dir), 'new task 2');
  return dir;
}
function hierarchy(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  fs.writeFileSync(path.join(dir, 'backlog', H.CONFIG_REL), JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    layout: { group: 'hierarchy' },
  }, null, 2) + '\n');
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir), 'new E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] a'], dir), 'new task');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.', '--acceptance=- [x] a'], dir), 'new subtask');
  return dir;
}
function opsOf(r: { json?: any }): string[] {
  return ((r.json && r.json.files) || []).map((f: any) => f.path + ' ' + f.op);
}

/* ===================================================================== */
/* F1 — every writer, flat layout                                        */
/* ===================================================================== */
{
  const dir = H.freshDir('ac66-f1-init');
  writes('F1 init', dir, ['init']);
}
{
  const dir = flat('ac66-f1');
  const n = writes('F1 new', dir, ['new', '--type=task', '--parent=EPIC-001', '--title=T3', '--description=D.']);
  T.check('F1 new: names its tombstone', opsOf(n).some((l) => /^\.nanojira\/ids\/.*TSK-003 created$/.test(l)), J(opsOf(n)));
  T.check('F1 new: names its element file', opsOf(n).includes('tasks/TSK-003.md created'), J(opsOf(n)));
  writes('F1 set --status', dir, ['set', '--id=TSK-001', '--status=doing']);
  const t = writes('F1 set --tags', dir, ['set', '--id=TSK-001', '--tags=alpha']);
  T.check('F1 set --tags: names TAGS.md', opsOf(t).some((l) => l.startsWith('TAGS.md ')), J(opsOf(t)));
  writes('F1 note', dir, ['note', '--id=TSK-001', 'a note', '--as=alice']);
  writes('F1 check', dir, ['check', '--id=TSK-001', '--text=a']);
  writes('F1 claim', dir, ['claim', '--id=TSK-002', '--as=alice']);
  writes('F1 release --status', dir, ['release', '--id=TSK-002', '--as=alice', '--status=todo']);
  writes('F1 next', dir, ['next', '--as=bob', '--status=doing']);
  writes('F1 set --status=done', dir, ['set', '--id=TSK-002', '--status=done']);
  writes('F1 rm', dir, ['rm', '--id=TSK-003']);
  writes('F1 set TSK-001 done', dir, ['set', '--id=TSK-001', '--status=done']);
  const a = writes('F1 archive', dir, ['archive', '--id=TSK-001']);
  T.check('F1 archive: a move', opsOf(a).includes('archive/TSK-001.md moved'), J(a.json && a.json.files));
  writes('F1 unarchive', dir, ['unarchive', '--id=TSK-001']);
}

/* F2 — `new --input` with a plan of three, from stdin. */
{
  const dir = flat('ac66-f2');
  const bl = path.join(dir, 'backlog');
  const before = snapshot(bl);
  const plan = JSON.stringify({ type: 'task', parent: 'EPIC-001', title: 'P', description: 'D.',
    children: [{ type: 'subtask', title: 'S1', description: 'D.' }, { type: 'subtask', title: 'S2', description: 'D.' }] });
  const r = H.runJson(['new', '--input=-'], { cwd: dir, input: plan, env: ENV, unsetEnv: ['NJ_BACKLOG', 'NJ_ON_CHANGE'] });
  T.exit('F2 plan: exit 0', r, 0);
  if (checkShape('F2 plan', r.json && r.json.files)) {
    T.eq('F2 plan: files is exactly what changed on disk', J(filesLines(r.json.files)), J(diffLines(before, snapshot(bl))));
    T.eq('F2 plan: three tombstones', r.json.files.filter((f: any) => f.path.startsWith('.nanojira/ids/')).length, 3);
  }
}

/* ===================================================================== */
/* F3 — moves under the hierarchy layout                                 */
/* ===================================================================== */
{
  const dir = hierarchy('ac66-f3');
  const s = writes('F3 set --parent', dir, ['set', '--id=TSK-001', '--parent=EPIC-002']);
  const moved = ((s.json && s.json.files) || []).filter((f: any) => f.op === 'moved');
  T.check('F3 set --parent: the task and its subtask are moves', moved.length === 2, J(s.json && s.json.files));
  T.check('F3 set --parent: from names the old place', moved.every((f: any) => f.from.startsWith('EPIC-001/')), J(moved));
  writes('F3 set --status=done (subtask first)', dir, ['set', '--id=SUB-001', '--status=done']);
  writes('F3 set --status=done', dir, ['set', '--id=TSK-001', '--status=done']);
  const a = writes('F3 archive', dir, ['archive', '--id=TSK-001']);
  T.check('F3 archive: moves', ((a.json && a.json.files) || []).filter((f: any) => f.op === 'moved').length === 2, J(a.json && a.json.files));
  writes('F3 unarchive', dir, ['unarchive', '--id=TSK-001']);
}

/* ===================================================================== */
/* F4 — no write: files is []; claims never listed                       */
/* ===================================================================== */
{
  const dir = flat('ac66-f4');
  const r = writes('F4 plain claim, assignee changes', dir, ['claim', '--id=TSK-001', '--as=alice']);
  T.check('F4 claim: nothing under .nanojira/claims/', !opsOf(r).some((l) => l.includes('claims')), J(opsOf(r)));
  const rel = writes('F4 plain release', dir, ['release', '--id=TSK-001', '--as=alice']);
  T.eq('F4 plain release: files []', J(rel.json && rel.json.files), '[]');
  const same = writes('F4 set to the same value', dir, ['set', '--id=TSK-002', '--priority=normal']);
  T.eq('F4 set no-op: files []', J(same.json && same.json.files), '[]');
}

/* ===================================================================== */
/* F5 — batch: once, on the wrapper                                      */
/* ===================================================================== */
{
  const dir = flat('ac66-f5');
  const r = writes('F5 batch set', dir, ['set', '--id=TSK-001,TSK-002', '--priority=high']);
  T.check('F5 batch: both element files', opsOf(r).includes('tasks/TSK-001.md modified') && opsOf(r).includes('tasks/TSK-002.md modified'), J(opsOf(r)));
  const per = ((r.json && r.json.results) || []).filter((x: any) => 'files' in x);
  T.eq('F5 batch: no files on the per-element results', per.length, 0);
}

/* ===================================================================== */
/* F6 — --quiet and --fields keep it                                     */
/* ===================================================================== */
{
  const dir = flat('ac66-f6');
  const q = writes('F6 set --quiet', dir, ['set', '--id=TSK-001', '--status=doing', '--quiet']);
  T.eq('F6 --quiet: ok, id, files only', J(Object.keys(q.json || {}).sort()), J(['files', 'id', 'ok']));
  writes('F6 set --fields', dir, ['set', '--id=TSK-001', '--status=review', '--fields=status']);
}

/* ===================================================================== */
/* F7 — --dry-run lists what the real call writes                         */
/* ===================================================================== */
{
  const dir = flat('ac66-f7');
  const real = flat('ac66-f7-real');
  for (const args of [
    ['new', '--type=task', '--parent=EPIC-001', '--title=T3', '--description=D.'],
    ['set', '--id=TSK-001', '--status=doing', '--tags=x'],
    ['rm', '--id=TSK-002'],
  ]) {
    const d = runJ([...args, '--dry-run'], dir);
    const r = writes('F7 ' + args[0] + ' (real)', real, args);
    T.eq('F7 ' + args[0] + ' --dry-run: same files as the real call', J(d.json && d.json.files), J(r.json && r.json.files));
    ok(run(args, dir), 'apply ' + args[0] + ' to the dry-run fixture too');
  }
}

/* ===================================================================== */
/* F8 — the NJ_ON_CHANGE hook's stdin carries it                          */
/* ===================================================================== */
{
  const dir = flat('ac66-f8');
  const cap = path.join(H.freshDir('ac66-f8-cap'), 'stdin.json');
  const r = runJ(['set', '--id=TSK-001', '--status=doing'], dir, { NJ_ON_CHANGE: 'cat > "$AC66_CAP"', AC66_CAP: cap });
  T.exit('F8 set with a hook: exit 0', r, 0);
  let hook: any = null;
  try { hook = JSON.parse(fs.readFileSync(cap, 'utf8')); } catch { /* checked below */ }
  T.eq('F8 hook stdin: the same files', J(hook && hook.files), J(r.json && r.json.files));
}

/* ===================================================================== */
/* F9 — doctor --fix                                                      */
/* ===================================================================== */
{
  const dir = flat('ac66-f9');
  const bl = path.join(dir, 'backlog');
  const tomb = (snapshot(bl).has('.nanojira/ids/TSK-001') ? '.nanojira/ids/TSK-001' : null);
  if (tomb !== null) fs.unlinkSync(path.join(bl, tomb));
  fs.unlinkSync(path.join(bl, 'STATUS.md'));
  const r = writes('F9 doctor --fix', dir, ['doctor', '--fix']);
  T.check('F9 doctor --fix: names STATUS.md', opsOf(r).includes('STATUS.md created'), J(opsOf(r)));
}

/* ===================================================================== */
/* F10 — a hard exit still names what had landed                          */
/* ===================================================================== */
/* `hardExit` (fault hooks, exhausted allocator) skips the normal error
 * handling; its --json failure object still carries `files` when part of
 * the call is already on disk (DECISIONS 222). Since DECISIONS 231 that
 * goes through the kernel's failure decorator, which output.ts registers. */
{
  const dir = flat('ac66-f10');
  const bl = path.join(dir, 'backlog');
  const before = snapshot(bl);
  const r = H.runJson(['new', '--input=-'], {
    cwd: dir, input: JSON.stringify({ type: 'epic', title: 'E2', description: 'D.' }),
    env: Object.assign({}, ENV, { NJ_FAULT: 'after-tmp-write' }), unsetEnv: ['NJ_BACKLOG', 'NJ_ON_CHANGE'],
  });
  T.exit('F10 new --input under NJ_FAULT=after-tmp-write: exit 1', r, 1);
  T.eq('F10 the code is fault:after-tmp-write', r.json && r.json.error, 'fault:after-tmp-write');
  T.eq('F10 files: the tombstone that landed', J(r.json && r.json.files), J([{ path: '.nanojira/ids/EPIC-002', op: 'created' }]));
  T.eq('F10 files matches the backlog', J(diffLines(before, snapshot(bl))), J(['.nanojira/ids/EPIC-002 created']));
}

T.finish();
