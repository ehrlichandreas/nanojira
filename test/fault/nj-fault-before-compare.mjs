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
 * rendezvous — the only reason this can be a deterministic test.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.mjs';
const T = H.T;

/* This file spawns nj directly rather than through H.runNj, so it has to ask
 * for the guard itself — otherwise an unset NJ reaches spawn() as "null". */
H.requireNj();

const TASK = 'tasks/TSK-001.md';

/** A complete, ready task, byte-identical to what a parallel writer starts from. */
function fixture(label) {
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

/** Start nj and hand back a promise for its exit; never rejects. */
function startNj(args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env, { NJ_NOW: o.now || H.LATER_NOW }, o.env || {});
  const inv = H.njCommand(H.NJ, args);
  const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const done = new Promise(resolve => {
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
  return { child, done };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The parallel writer's version of the file: same bytes, one field changed. */
function parallelVersion() {
  return H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
    status: 'review', created: H.FIXED_NOW, updated: H.LATER_NOW,
  }, '# Backend API Endpoints\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n');
}

async function playParallelWrite(d) {
  const file = path.join(d, 'backlog', TASK);
  await sleep(1000);                      // let nj finish its first read
  fs.writeFileSync(file, parallelVersion());
  fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');   // release nj
  return file;
}

/* ---- without --force: the write must be refused ------------------------ */
(async () => {
  {
    const d = fixture('fault-before-compare');
    const file = path.join(d, 'backlog', TASK);

    const { done } = startNj(['set', '--id=TSK-001', '--status=doing'],
      { cwd: d, env: { NJ_FAULT: 'before-compare' } });
    await playParallelWrite(d);
    const r = await done;

    T.exit('a parallel change aborts the write', r, 1);
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

    const { done } = startNj(['set', '--id=TSK-001', '--status=doing', '--force'],
      { cwd: d, env: { NJ_FAULT: 'before-compare' } });
    await playParallelWrite(d);
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

  T.finish();
})().catch(e => {
  console.log('FAIL fault/nj-fault-before-compare.js — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
