/* Fault injection — the compare-before-write guard (§ 12, § 9).
 *
 * `before-compare` — after the first read and before the compare re-read, poll
 * for `<backlog>/.nj-fault-go` (timeout 10 s, then exit 1). The test changes
 * the target file, then creates the marker: expect exit 1 with
 * "changed in parallel", or exit 0 with `--force`.
 *
 * This is the one hook that makes § 12's compare-before-write guard testable:
 * the residual window is otherwise unreachable, because two writes inside the
 * same second are indistinguishable by timestamp (which is exactly why § 12
 * compares full content instead). DECISIONS.md names this as the gap the
 * verifier should drive.
 *
 * The marker is a "go" signal: `nj` blocks after its first read until the test
 * says it has finished playing the parallel writer. That turns a race into a
 * rendezvous — the only reason this can be a deterministic test. The other
 * half of the rendezvous is `NJ_FAULT_READY` (§ 12, DECISIONS 201): nj writes
 * it once it is holding, so the test plants its change only after nj's first
 * read. Until then the test slept 1 s and hoped, which a loaded machine could
 * outlast.
 *
 * The --json codes of two hooks (closing NC3) live here too, merged from
 * fault/fault-hook-json.ts (TSK-049): `fault:before-rename`, and
 * `fault:before-compare` on the 10 s timeout path. That timeout run starts
 * at the top and runs alongside the human timeout leg below, so the file
 * waits out nj's 10 s hold once, not twice; its checks come last.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

/* This file spawns nj directly rather than through H.runNj, so it has to ask
 * for the guard itself — otherwise an unset NJ reaches spawn() as "null". */
H.requireNj();

const TASK = 'tasks/TSK-001.md';

/** A complete, ready task, byte-identical to what a parallel writer starts from. */
function fixture(label: string) {
  const d = H.mkBacklog({
    label,
    files: {
      [TASK]: H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Backend API Endpoints\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['TSK-001'],
  });
  return d;
}

type StartNjOpts = { cwd?: string; now?: string; env?: Record<string, string> };

/** Start nj and hand back a promise for its exit; never rejects. */
function startNj(args: string[], opts?: StartNjOpts) {
  const o = opts || {};
  const env = Object.assign({}, process.env, { NJ_NOW: o.now || H.LATER_NOW }, o.env || {});
  const inv = H.njCommand(H.NJ as string, args);
  const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const done = new Promise<RunResult>(resolve => {
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
  return { child, done };
}

/** The parallel writer's version of the file: same bytes, one field changed. */
function parallelVersion() {
  return H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
    status: 'review', created: H.FIXED_NOW, updated: H.LATER_NOW,
  }, '# Backend API Endpoints\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n');
}

/* The fixture fault/fault-hook-json.ts used: an epic and its complete task. */
function hookJsonFixture(label: string) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('T')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

/* All three `NJ_FAULT` hooks pinned as exact `--json` error codes (§ 12,
 * § 9's closed vocabulary). `fault:after-tmp-write` is pinned in
 * edge/failure-vocabulary.ts; these are the other two. Started at once,
 * asserted at the end of the file. */
function startHookJson() {
  const rename = H.runJsonAsync(['set', '--id=TSK-001', '--status=doing'],
    { cwd: hookJsonFixture('fault-json-before-rename'), env: { NJ_FAULT: 'before-rename' } });
  /* fault:before-compare: never drop .nj-fault-go, so it times out
   * deterministically after 10 s and hardExit's fault:before-compare fires.
   * 30 s, not 15 s, around the fixed ~10 s hook wait: node start + bundle
   * load on a loaded machine (run-all's parallel pool, DECISIONS 199) can
   * eat a 5 s margin. Only the lower bound is asserted. */
  const d = hookJsonFixture('fault-json-before-compare');
  const start = Date.now();
  const compare = H.runJsonAsync(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_FAULT: 'before-compare' }, timeout: 30000 })
    .then(r => ({ r, elapsed: Date.now() - start }));
  return { rename, compare };
}

async function checkHookJson(started: ReturnType<typeof startHookJson>) {
  const r = await started.rename;
  T.exit('NJ_FAULT=before-rename --json exit 1', r, 1);
  T.eq('the code is fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  const { r: rc, elapsed } = await started.compare;
  T.exit('NJ_FAULT=before-compare --json exit 1 (after ~10s timeout)', rc, 1);
  T.eq('the code is fault:before-compare', rc.json && rc.json.error, 'fault:before-compare');
  T.check('roughly a 10s wait happened (not an immediate different failure)', elapsed >= 9000, 'elapsed=' + elapsed + 'ms');
}

async function playParallelWrite(d: string, ready: ReturnType<typeof H.faultReady>, done: Promise<RunResult>) {
  const file = path.join(d, 'backlog', TASK);
  T.check('nj reached the before-compare hold (NJ_FAULT_READY written)', await ready.wait(done), ready.file);
  fs.writeFileSync(file, parallelVersion());
  fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');   // release nj
  return file;
}

/* ---- without --force: the write must be refused ------------------------ */
(async () => {
  const hookJson = startHookJson();
  {
    const d = fixture('fault-before-compare');
    const file = path.join(d, 'backlog', TASK);

    const ready = H.faultReady('fault-before-compare');
    const { done } = startNj(['set', '--id=TSK-001', '--status=doing'],
      { cwd: d, env: ready.env });
    await playParallelWrite(d, ready, done);
    const r = await done;

    T.exit('a parallel change aborts the write', r, 1);
    T.eq('NJ_FAULT_READY names the held element', H.readOrNull(ready.file), 'TSK-001\n');
    T.check('the abort says so in words',
      /changed in parallel|parallel/i.test(r.stdout + r.stderr),
      'stdout: ' + JSON.stringify(r.stdout) + '\n     stderr: ' + JSON.stringify(r.stderr));

    /* The parallel writer's version must survive: refusing means not writing. */
    const after = fs.readFileSync(file, 'utf8');
    T.contains('the parallel change is not overwritten', after, 'status: review');
    T.check('nj did not write its own value', !after.includes('status: doing'),
      JSON.stringify(after.slice(0, 240)));
    T.eq('the file is byte-identical to the parallel version',
      H.sha256(after), H.sha256(parallelVersion()));
  }

  /* ---- with --force: the write goes through ---------------------------- */
  {
    const d = fixture('fault-before-compare-force');
    const file = path.join(d, 'backlog', TASK);

    const ready = H.faultReady('fault-before-compare-force');
    const { done } = startNj(['set', '--id=TSK-001', '--status=doing', '--force'],
      { cwd: d, env: ready.env });
    await playParallelWrite(d, ready, done);
    const r = await done;

    T.exit('--force overrides the guard deliberately', r, 0);
    const after = fs.readFileSync(file, 'utf8');
    T.contains('--force applied nj\'s write', after, 'status: doing');
  }

  /* ---- the hook must not hang when the marker never appears ------------- */
  {
    const d = fixture('fault-before-compare-timeout');
    const t0 = Date.now();
    const { done } = startNj(['set', '--id=TSK-001', '--status=doing'],
      { cwd: d, env: { NJ_FAULT: 'before-compare' } });
    const r = await done;                    // no marker written at all
    const elapsed = Date.now() - t0;

    T.exit('without the marker the poll times out and exits 1', r, 1);
    T.check('the timeout fires near the 10 s the spec pins',
      elapsed >= 9000 && elapsed < 20000, 'elapsed ' + elapsed + ' ms');
    const after = fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8');
    T.check('a timed-out compare wrote nothing', after.includes('status: todo'),
      JSON.stringify(after.slice(0, 200)));
  }

  /* ---- NJ_FAULT_READY that cannot be written: fail like the timeout ----- */
  {
    const d = fixture('fault-before-compare-ready-unwritable');
    const bad = path.join(H.freshDir('fault-ready-bad'), 'no-such-dir', 'ready');
    const t0 = Date.now();
    const { done } = startNj(['set', '--id=TSK-001', '--status=doing', '--json'],
      { cwd: d, env: { NJ_FAULT: 'before-compare', NJ_FAULT_READY: bad } });
    fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');   // would release a hold at once
    const r = await done;
    let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.exit('an unwritable NJ_FAULT_READY exits 1', r, 1);
    T.eq('… with fault:before-compare', json && json.error, 'fault:before-compare');
    T.check('… at once, not after the 10 s poll', Date.now() - t0 < 9000, 'elapsed ' + (Date.now() - t0) + ' ms');
    T.check('… and writes nothing', fs.readFileSync(path.join(d, 'backlog', TASK), 'utf8').includes('status: todo'), '');
  }

  await checkHookJson(hookJson);

  T.finish();
})().catch(e => {
  console.log('FAIL fault/nj-fault-before-compare.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
