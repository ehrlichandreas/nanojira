/* AC-67 — `files` against git itself (docs/SPECIFICATION.md § 9 "files";
 * DECISIONS 222; TSK-045 review).
 *
 * The oracle here is `git status` in a repository holding the backlog:
 * every path git reports as changed after a call must be in `files` (a
 * `moved` entry's `from` included), and nothing else.
 *
 * G1 — a call that fails after part of its writes landed still names
 * them. `new` writes its tombstone under `.nanojira/ids/` before the
 * element file; with the element's folder read-only the tombstone stays
 * and the call fails with internal_error. `archive` moves a task, then
 * cannot move its subtask. Under the hierarchy layout, `set --parent`
 * and `new` into a read-only epic folder. Before the fix those failure
 * results carried no `files` at all.
 *
 * G2 — the documented commit recipe, run from the backlog root, commits
 * exactly what the call wrote, for created, modified, moved and deleted
 * paths, and leaves another agent's staged file staged. A call that wrote
 * nothing commits nothing: the `[ -n "$P" ]` guard keeps a bare
 * `git commit --` from committing the whole index.
 *
 * Written before the fix: red against 94ee7a9.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
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
const UNSET = ['NJ_BACKLOG', 'NJ_ON_CHANGE'];
function run(args: string[], cwd: string, input?: string): RunResult {
  return H.runNj(args, { cwd, env: ENV, unsetEnv: UNSET, input });
}
function runJ(args: string[], cwd: string) {
  return H.runJson(args, { cwd, env: ENV, unsetEnv: UNSET });
}

/* git with no system or global configuration: no signing, no hooks, a fixed identity. */
const GIT_ENV: Record<string, string> = Object.assign({}, process.env as Record<string, string>, {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'ac67', GIT_AUTHOR_EMAIL: 'ac67@localhost',
  GIT_COMMITTER_NAME: 'ac67', GIT_COMMITTER_EMAIL: 'ac67@localhost',
});
function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}
function gitOk(cwd: string, args: string[]): string {
  const r = git(cwd, args);
  if (r.status !== 0) T.check('fixture: git ' + args.join(' '), false, r.status + ' ' + J(r.stderr));
  return r.stdout || '';
}
function repo(dir: string): void {
  gitOk(dir, ['init', '-q']);
  gitOk(dir, ['add', '-A']);
  gitOk(dir, ['commit', '-q', '-m', 'fixture']);
}
/** `git status` as `path op` lines (created/modified/deleted), relative to the repository root, sorted. */
function statusLines(root: string): string[] {
  const out = gitOk(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  return out.split('\0').filter((l) => l !== '').map((l) => {
    const xy = l.slice(0, 2);
    const p = l.slice(3);
    return p + (xy === '??' || xy.includes('A') ? ' created' : xy.includes('D') ? ' deleted' : ' modified');
  }).sort();
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

function writeConfig(bl: string, hierarchy: boolean): void {
  fs.writeFileSync(path.join(bl, H.CONFIG_REL), JSON.stringify(Object.assign({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  }, hierarchy ? { layout: { group: 'hierarchy' } } : {}), null, 2) + '\n');
}
/** EPIC-001 > TSK-001 > SUB-001, all done, plus EPIC-002; flat or hierarchy layout. */
function fixture(label: string, hierarchy: boolean): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  writeConfig(path.join(dir, 'backlog'), hierarchy);
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir), 'new E1');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir), 'new E2');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] a', '--status=done'], dir), 'new task');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.', '--acceptance=- [x] a', '--status=done'], dir), 'new subtask');
  return dir;
}

/** Can this process write into a mode-555 directory (root can)? Then G1 cannot be exercised. */
function readOnlyHolds(dir: string): boolean {
  const probe = path.join(dir, 'ro-probe');
  fs.mkdirSync(probe);
  fs.chmodSync(probe, 0o555);
  let holds = true;
  try { fs.writeFileSync(path.join(probe, 'x'), ''); holds = false; } catch { /* good */ }
  fs.chmodSync(probe, 0o755);
  fs.rmSync(probe, { recursive: true, force: true });
  return holds;
}

/* ===================================================================== */
/* G1 — a failure after a partial write still names what landed          */
/* ===================================================================== */
function failsAfterWriting(label: string, dir: string, args: string[], readOnly: string): void {
  const bl = path.join(dir, 'backlog');
  repo(bl);
  const ro = path.join(bl, readOnly);
  fs.chmodSync(ro, 0o555);
  let r;
  try { r = runJ(args, dir); } finally { fs.chmodSync(ro, 0o755); }
  T.check(label + ': fails', r.status === 1 && r.json && r.json.ok === false, r.status + ' ' + J(r.json));
  const changed = statusLines(bl);
  T.check(label + ': part of the call landed before it failed (git status not clean)', changed.length > 0, J(changed));
  const files = r.json && r.json.files;
  T.check(label + ': the failure result carries files', Array.isArray(files), J(r.json));
  if (Array.isArray(files)) T.eq(label + ': files is exactly what git status shows', J(filesLines(files)), J(changed));
}

{
  const scratch = H.freshDir('ac67-probe');
  if (!readOnlyHolds(scratch)) {
    T.notCovered('G1 partial-failure legs', 'this process can write into a mode-555 directory (root?)');
  } else {
    failsAfterWriting('G1 new, tasks/ read-only (tombstone written, element write fails)', fixture('ac67-g1-new', false),
      ['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.'], 'tasks');
    failsAfterWriting('G1 archive, subtasks/ read-only (half archived)', fixture('ac67-g1-archive', false),
      ['archive', '--id=TSK-001'], 'subtasks');
    failsAfterWriting('G1 hierarchy set --parent, EPIC-002/ read-only', fixture('ac67-g1-reparent', true),
      ['set', '--id=TSK-001', '--parent=EPIC-002', '--description=Changed.'], 'EPIC-002');
    failsAfterWriting('G1 hierarchy new, EPIC-002/ read-only', fixture('ac67-g1-hnew', true),
      ['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.'], 'EPIC-002');
  }
}

/* ===================================================================== */
/* G2 — the documented recipe commits exactly this call's files           */
/* ===================================================================== */
const JQ = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
/* SPEC § 9 / GUIDE § 5, word for word but for the nanojira path and the command. */
const RECIPE = 'cd backlog && P=$("$NJ" "$@" --json | jq -r \'.files[] | .path, .from // empty\'); '
  + '[ -n "$P" ] && git add -- $P && git commit -q -m "$MSG" -- $P';

/** Runs the recipe for `args` in the repository at `dir` (the backlog lives in `dir/backlog`). */
function recipe(dir: string, args: string[], input?: string) {
  const env = Object.assign({}, GIT_ENV, ENV, { NJ: H.NJ as string, MSG: args.join(' ') });
  for (const k of UNSET) delete (env as Record<string, string>)[k];
  return spawnSync('sh', ['-c', RECIPE, 'recipe'].concat(args), { cwd: dir, env, input, encoding: 'utf8' });
}
/** Runs `args` through the recipe and checks the commit holds exactly the call's files. */
function commits(label: string, dir: string, args: string[], input?: string): void {
  const before = gitOk(dir, ['rev-parse', 'HEAD']).trim();
  // The same call's files, from a dry run first: what the recipe is about to commit.
  const d = H.runJson(args.concat(['--dry-run']), { cwd: dir, env: ENV, unsetEnv: UNSET, input });
  const want = ((d.json && d.json.files) || []).flatMap((f: any) => (f.op === 'moved' ? [f.from, f.path] : [f.path]))
    .map((p: string) => 'backlog/' + p).sort();
  T.check(label + ': the call writes something', want.length > 0, J(d.json));
  const r = recipe(dir, args, input);
  T.check(label + ': recipe exits 0', r.status === 0, r.status + ' ' + J(r.stderr) + J(r.stdout));
  const after = gitOk(dir, ['rev-parse', 'HEAD']).trim();
  T.check(label + ': one new commit', after !== before && gitOk(dir, ['rev-parse', 'HEAD~1']).trim() === before, before + ' ' + after);
  const committed = gitOk(dir, ['show', '--no-renames', '--name-only', '--format=', 'HEAD']).split('\n').filter((l) => l !== '').sort();
  T.eq(label + ': the commit holds exactly the call\'s files', J(committed), J(want));
  T.eq(label + ': nothing else changed; the other agent\'s file is still staged, uncommitted',
    J(gitOk(dir, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter((l) => l !== '')), J(['A  OTHER.md']));
}
function otherAgentStages(dir: string): void {
  fs.writeFileSync(path.join(dir, 'OTHER.md'), 'another agent, mid-change\n');
  gitOk(dir, ['add', 'OTHER.md']);
}

if (!JQ) {
  T.notCovered('G2 commit recipe', 'jq is not on PATH');
} else {
  const dir = fixture('ac67-g2', false);
  repo(dir);
  otherAgentStages(dir);
  commits('G2 new', dir, ['new', '--type=task', '--parent=EPIC-002', '--title=T2', '--description=D.']);
  commits('G2 plan', dir, ['new', '--input=-'], JSON.stringify({
    type: 'task', parent: 'EPIC-002', title: 'P', description: 'D.',
    children: [{ type: 'subtask', title: 'PS', description: 'D.' }],
  }));
  commits('G2 archive', dir, ['archive', '--id=TSK-001']);
  commits('G2 unarchive', dir, ['unarchive', '--id=TSK-001']);
  commits('G2 rm', dir, ['rm', '--id=TSK-002']);

  // Nothing written: the guard stops the commit, the other agent's file stays staged.
  const before = gitOk(dir, ['rev-parse', 'HEAD']).trim();
  const r = recipe(dir, ['set', '--id=TSK-001', '--priority=normal']);
  T.check('G2 no-op set: the guard stops the recipe (non-zero, no commit)', r.status !== 0 && gitOk(dir, ['rev-parse', 'HEAD']).trim() === before, r.status + ' ' + J(r.stderr));
  T.eq('G2 no-op set: the other agent\'s file is still staged',
    J(gitOk(dir, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter((l) => l !== '')), J(['A  OTHER.md']));

  const hdir = fixture('ac67-g2-h', true);
  repo(hdir);
  otherAgentStages(hdir);
  commits('G2 hierarchy set --parent', hdir, ['set', '--id=TSK-001', '--parent=EPIC-002']);
}

T.finish();
