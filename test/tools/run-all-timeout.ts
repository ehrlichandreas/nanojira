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
 *        R1  pooled (--jobs=2)    R2  serial (--jobs=1)
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
};
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
  const outer = path.join(base, 'outer'), tmp = path.join(base, 'tmp');
  fs.mkdirSync(outer); fs.mkdirSync(tmp);
  const e: NodeJS.ProcessEnv = Object.assign({}, process.env, { NJ_TEST_ROOT: outer, TMPDIR: tmp });
  delete e.NJ_KEEP; delete e.NJ_TEST_TIMES; delete e.NJ_TEST_JOBS;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(base, 'test', 'run-all.ts'), ...args, 'unused-nj'],
    { cwd: base, env: e, encoding: 'utf8', timeout: 40000, killSignal: 'SIGKILL' });
  killLeftovers(base);
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - t0 };
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
  T.check(label + ': only the passing file passes', /^passed\s+1 \/ 3$/m.test(c.out), tail);
  T.check(label + ': the file that deferred SIGTERM and printed PASS is a FAIL', /^  ac\/b-defer\.ts$/m.test(c.out), tail);
  T.check(label + ': the file that ignores SIGTERM is a FAIL', /^  ac\/c-ignore\.ts$/m.test(c.out), tail);
  T.check(label + ': both name the timeout', (c.out.match(/timed out after 1\.5 s/g) || []).length === 2, tail);
  T.check(label + ': and the run ends soon, not after the sleep or never', c.ms < 15000, tail);
}

T.finish();
