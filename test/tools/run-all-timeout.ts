/* A test that runs past run-all's timeout is a FAIL, and is gone soon after
 * (TSK-028, DECISIONS 193). Two mechanisms, both checked here:
 *
 *   H. The harness never defers a kill. A JS signal listener only runs once
 *      the event loop is free, so a SIGTERM to a test busy in synchronous
 *      work (spawnSync, a sync loop) used to wait until that work ended --
 *      then T.finish() exited 0. With no listener, SIGTERM ends the process
 *      at once. The 'exit' cleanup handler stays.
 *        H1  SIGTERM during spawnSync('sleep 5'): dead within ~1 s, BY SIGTERM
 *        H2  SIGTERM during a 5 s busy loop: the same
 *        H3  an uncaught exception still removes the test's freshDirs
 *   R. run-all counts a fired timeout as FAIL whatever the exit status, and
 *      a child that ignores SIGTERM is killed with SIGKILL after a grace
 *      period. A COPY of run-all.ts with its timeout and grace shortened
 *      runs tiny test files: one passing, one that defers SIGTERM and then
 *      prints PASS and exits 0, one that ignores SIGTERM forever.
 *      The kill reaches the file's whole process group (TSK-029): two more
 *      files hang after starting a grandchild that ignores SIGTERM, one with
 *      its stdio detached (an orphan once the file dies), one that holds
 *      the file's stdout and stderr open (so the file's pipes never close
 *      while it lives). Neither grandchild may outlive the run.
 *        R1  pooled (--jobs=2)    R2  serial (--jobs=1)
 *   S. A process group of its own means a SIGTERM to the gate's group (or a
 *      Ctrl-C) no longer reaches a file directly: run-all, sent SIGTERM while
 *      a file that ignores it and its grandchild run, kills both and dies of
 *      the signal itself.
 */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_ALL = path.join(HERE, '..', 'run-all.ts');
const HARNESS = path.join(HERE, '..', 'lib', 'harness.ts');

/* ---- H: the harness and SIGTERM ------------------------------------------- */
const scripts = H.freshDir('t028-scripts');
const child = path.join(scripts, 'child.ts');
fs.writeFileSync(child, [
  "import { spawnSync } from 'node:child_process';",
  'import * as H from ' + JSON.stringify(HARNESS) + ';',
  "H.freshDir('t028-child');",
  "process.stdout.write('READY\\n');",
  'const mode = process.argv[2];',
  "if (mode === 'sleep') spawnSync('sleep', ['5']);",
  "if (mode === 'busy') { const t = Date.now(); while (Date.now() - t < 5000) { /* sync work */ } }",
  "if (mode === 'throw') throw new Error('t028 boom');",
  "H.T.check('ran to the end', true);",
  'H.T.finish();',
  '',
].join('\n'));
const childEnv = (root: string): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = Object.assign({}, process.env, { NJ_TEST_ROOT: root, TMPDIR: root });
  delete e.NJ_KEEP;
  return e;
};

function sigtermDuring(mode: string): Promise<{ signal: string | null; code: number | null; afterKillMs: number; out: string }> {
  const root = H.freshDir('t028-root-' + mode);
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [child, mode], { env: childEnv(root), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', killedAt = 0;
    const guard = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.stdout.on('data', (b) => {
      out += b;
      if (!killedAt && /^READY$/m.test(out)) setTimeout(() => { killedAt = Date.now(); c.kill('SIGTERM'); }, 300);
    });
    c.on('close', (code, signal) => { clearTimeout(guard); resolve({ signal, code, afterKillMs: Date.now() - killedAt, out }); });
  });
}

for (const mode of ['sleep', 'busy']) {
  const r = await sigtermDuring(mode);
  const tag = mode === 'sleep' ? 'H1 SIGTERM during spawnSync' : 'H2 SIGTERM during a sync loop';
  T.check(tag + ': the child got going', /^READY$/m.test(r.out), r.out);
  T.eq(tag + ': it dies BY the signal', r.signal, 'SIGTERM');
  T.check(tag + ': within ~1 s of the signal, not after the sync work', r.afterKillMs < 1500,
    r.afterKillMs + ' ms; code ' + r.code + '; stdout ' + JSON.stringify(r.out));
  T.check(tag + ': it never reached T.finish()', !/^PASS /m.test(r.out), r.out);
}
{
  const root = H.freshDir('t028-root-throw');
  const r = spawnSync(process.execPath, [child, 'throw'], { env: childEnv(root), encoding: 'utf8', timeout: 30000 });
  T.eq('H3 an uncaught exception: exit 1', r.status, 1);
  T.eq('H3 ... and the exit handler still removed its freshDir', fs.readdirSync(root), []);
}

/* ---- R: run-all and its timeout ------------------------------------------ */
const FILES: Record<string, string> = {
  'a-ok.ts': "console.log('PASS a-ok.ts (1 checks)');\n",
  // the old harness's behaviour: a SIGTERM listener that cannot run during
  // sync work, which then ends and exits 0 -- inside the kill grace, so only
  // the timed-out flag, not a signal, can make it a FAIL in the pool
  'b-defer.ts': "import { spawnSync } from 'node:child_process';\n" +
    "process.on('SIGTERM', () => {});\nspawnSync('sleep', ['2']);\nconsole.log('PASS b-defer.ts (1 checks)');\n",
  'c-ignore.ts': "process.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n",
  'd-orphan.ts': grandchildFile('d', "'ignore'"),
  'e-holder.ts': grandchildFile('e', "['ignore', 'inherit', 'inherit']"),
};
/* A file that starts test/gc.mjs (outside every collected directory) and
 * hangs. gc.mjs ignores SIGTERM and writes its pid to <base>/pids/<tag>,
 * passed in through GC_PIDS: the file is written before the case's base
 * directory exists. */
function grandchildFile(tag: string, stdio: string, prelude = ''): string {
  return prelude + "import { spawn } from 'node:child_process';\nimport path from 'node:path';\n" +
    "import { fileURLToPath } from 'node:url';\n" +
    "const gc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gc.mjs');\n" +
    'spawn(process.execPath, [gc, path.join(process.env.GC_PIDS, ' + JSON.stringify(tag) + ')], { stdio: ' + stdio + ' });\n' +
    'setInterval(() => {}, 1000);\n';
}
const GC = "import fs from 'node:fs';\nprocess.on('SIGTERM', () => {});\n" +
  'fs.writeFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 1000);\n';
const src = fs.readFileSync(RUN_ALL, 'utf8');
T.check('R: run-all has a per-file timeout constant', /^const TIMEOUT_MS = \d+;$/m.test(src), '');
T.check('R: run-all has a kill grace constant', /^const KILL_GRACE_MS = \d+;$/m.test(src), '');
const patched = src.replace(/^const TIMEOUT_MS = \d+;$/m, 'const TIMEOUT_MS = 1500;')
  .replace(/^const KILL_GRACE_MS = \d+;$/m, 'const KILL_GRACE_MS = 1000;');

function runCase(label: string, args: string[]) {
  const base = H.freshDir('t028-' + label);
  fs.mkdirSync(path.join(base, 'test', 'ac'), { recursive: true });
  fs.writeFileSync(path.join(base, 'test', 'run-all.ts'), patched);
  for (const [f, body] of Object.entries(FILES)) fs.writeFileSync(path.join(base, 'test', 'ac', f), body);
  fs.writeFileSync(path.join(base, 'test', 'gc.mjs'), GC);
  const outer = path.join(base, 'outer'), tmp = path.join(base, 'tmp'), pids = path.join(base, 'pids');
  fs.mkdirSync(outer); fs.mkdirSync(tmp); fs.mkdirSync(pids);
  const e: NodeJS.ProcessEnv = Object.assign({}, process.env, { NJ_TEST_ROOT: outer, TMPDIR: tmp, GC_PIDS: pids });
  delete e.NJ_KEEP; delete e.NJ_TEST_TIMES; delete e.NJ_TEST_JOBS;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(base, 'test', 'run-all.ts'), ...args, 'unused-nj'],
    { cwd: base, env: e, encoding: 'utf8', timeout: 40000, killSignal: 'SIGKILL' });
  const ms = Date.now() - t0;
  const alive: Record<string, string> = {};
  for (const tag of ['d', 'e']) alive[tag] = grandchildState(path.join(pids, tag));
  killLeftovers(base);
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), ms, alive };
}
/* 'gone', 'alive (pid N)', or 'never started'. A grandchild that is gone
 * may stay a zombie for a moment until init reaps it; that counts as gone.
 * Polled for up to 2 s, so a SIGKILL still being delivered is not a FAIL. */
function grandchildState(pidFile: string): string {
  if (!fs.existsSync(pidFile)) return 'never started';
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const until = Date.now() + 2000;
  for (;;) {
    let zombie = false;
    try { zombie = / Z /.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8').replace(/^.*\)/, ')')); } catch (e) { /* no /proc */ }
    try { process.kill(pid, 0); } catch (e) { return 'gone'; }
    if (zombie) return 'gone';
    if (Date.now() > until) return 'alive (pid ' + pid + ')';
    spawnSync('sleep', ['0.1']);
  }
}
/* On a red run the guard above kills run-all, which leaves the file that
 * ignores SIGTERM running forever: kill whatever still runs from this case. */
function killLeftovers(base: string) {
  let pids: string[] = [];
  try { pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch (e) { return; }
  for (const p of pids) {
    let cmd = '';
    try { cmd = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8'); } catch (e) { continue; }
    if (cmd.includes(base + '/test/') && Number(p) !== process.pid) { try { process.kill(Number(p), 'SIGKILL'); } catch (e) { /* gone */ } }
  }
}
for (const [label, args] of [['R1 pooled', ['--jobs=2']], ['R2 serial', ['--jobs=1']]] as [string, string[]][]) {
  const c = runCase(label.split(' ')[0].toLowerCase(), args);
  const tail = ('exit ' + c.status + ', ' + c.ms + ' ms\n' + c.out).split('\n').slice(-14).join('\n');
  T.eq(label + ': run-all exits 1', c.status, 1);
  T.check(label + ': only the passing file passes', /^passed\s+1 \/ 5$/m.test(c.out), tail);
  T.check(label + ': the file that deferred SIGTERM and printed PASS is a FAIL', /^  ac\/b-defer\.ts$/m.test(c.out), tail);
  T.check(label + ': the file that ignores SIGTERM is a FAIL', /^  ac\/c-ignore\.ts$/m.test(c.out), tail);
  T.check(label + ': the files that started a grandchild are FAILs',
    /^  ac\/d-orphan\.ts$/m.test(c.out) && /^  ac\/e-holder\.ts$/m.test(c.out), tail);
  T.check(label + ': all four name the timeout', (c.out.match(/timed out after 1\.5 s/g) || []).length === 4, tail);
  T.check(label + ': and the run ends soon, not after the sleep or never', c.ms < 25000, tail);
  T.eq(label + ': the orphaned grandchild that ignores SIGTERM is gone', c.alive.d, 'gone');
  T.eq(label + ': the grandchild holding the pipes is gone', c.alive.e, 'gone');
}

{
  const base = H.freshDir('t029-signal');
  fs.mkdirSync(path.join(base, 'test', 'ac'), { recursive: true });
  fs.writeFileSync(path.join(base, 'test', 'run-all.ts'), src);
  fs.writeFileSync(path.join(base, 'test', 'gc.mjs'), GC);
  fs.writeFileSync(path.join(base, 'test', 'ac', 'f-hang.ts'), grandchildFile('f', "'ignore'",
    "import fs from 'node:fs';\nprocess.on('SIGTERM', () => {});\n" +
    "fs.writeFileSync(process.env.GC_PIDS + '/f-file', String(process.pid));\n"));
  const outer = path.join(base, 'outer'), tmp = path.join(base, 'tmp'), pids = path.join(base, 'pids');
  fs.mkdirSync(outer); fs.mkdirSync(tmp); fs.mkdirSync(pids);
  const e: NodeJS.ProcessEnv = Object.assign({}, process.env, { NJ_TEST_ROOT: outer, TMPDIR: tmp, GC_PIDS: pids });
  delete e.NJ_KEEP; delete e.NJ_TEST_TIMES; delete e.NJ_TEST_JOBS;
  const ra = spawn(process.execPath, [path.join(base, 'test', 'run-all.ts'), '--jobs=2', 'unused-nj'], { cwd: base, env: e, stdio: 'ignore' });
  const guard = setTimeout(() => ra.kill('SIGKILL'), 40000);
  const closed = new Promise<{ signal: string | null; code: number | null }>((resolve) => ra.on('close', (code, signal) => resolve({ code, signal })));
  const started = Date.now();
  while (!(fs.existsSync(path.join(pids, 'f')) && fs.existsSync(path.join(pids, 'f-file'))) && Date.now() - started < 20000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const ready = fs.existsSync(path.join(pids, 'f')) && fs.existsSync(path.join(pids, 'f-file'));
  const killedAt = Date.now();
  ra.kill('SIGTERM');
  const r = await closed;
  const afterMs = Date.now() - killedAt;
  clearTimeout(guard);
  const file = grandchildState(path.join(pids, 'f-file')), gc = grandchildState(path.join(pids, 'f'));
  killLeftovers(base);
  T.check('S: the file and its grandchild got going', ready, fs.readdirSync(pids).join(' '));
  T.eq('S: run-all dies BY the SIGTERM', r.signal, 'SIGTERM');
  T.check('S: within ~5 s, not at its own timeout', afterMs < 5000, afterMs + ' ms; code ' + r.code);
  T.eq('S: the file that ignores SIGTERM is gone', file, 'gone');
  T.eq('S: its grandchild that ignores SIGTERM is gone', gc, 'gone');
}

T.finish();
