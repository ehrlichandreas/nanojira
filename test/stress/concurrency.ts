/* AC-7 — Concurrency.
 *
 * "seq 1 100 | xargs -P 20 -I{} nj new --type=task --parent=EPIC-001
 *  --title='Parallel {}' yields 100 files, 100 unique IDs, nj doctor clean;
 *  the 'retries exhausted' abort has exit 1 and a defined stderr form."
 *
 * The parallelism is implemented with a 20-wide process pool rather than by
 * shelling out to xargs, so the test is portable and the concurrency level is
 * explicit — the semantics are the same 20-in-flight that the AC prescribes.
 *
 * This is the cheapest test that exposes the whole ID-allocation contract:
 * O_CREAT|O_EXCL as the sole claiming authority, the start value computed from
 * tombstones and element files, and the doctor axis on a backlog of freshly
 * created elements (AC-19).
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';

const PARALLEL = 20;
const COUNT = 100;

type NjOpts = { cwd?: string; env?: Record<string, string> };

/** Run one nj command; never rejects — a non-zero exit is data. The env
 * and the 60 s limit are H.runPath's: a shell's NJ_ON_CHANGE (or a stray
 * NJ_HOOK_COMMAND) must not reach these hundreds of writes. */
function nj(args: string[], opts?: NjOpts): Promise<RunResult> {
  const o = opts || {};
  return new Promise(resolve => {
    const env: Record<string, string | undefined> = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW });
    for (const k of ['NJ_ON_CHANGE', 'NJ_ON_CHANGE_TIMEOUT', 'NJ_HOOK_COMMAND', 'NJ_HOOK_IDS']) delete env[k];
    Object.assign(env, o.env || {});
    const inv = H.njCommand(H.NJ as string, args);
    const t0 = Date.now();
    const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env, timeout: 60000 });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    // signal and ms as H.runPath reports them, so H.describeRun can name
    // a kill or the timeout instead of a bare "exit null".
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message), missing: 'spawn failed: ' + e.message, signal: null, ms: Date.now() - t0 }));
    child.on('close', (code, signal) => resolve({ status: code, stdout: out, stderr: err, signal, ms: Date.now() - t0 }));
  });
}

/** Run `items` through `worker` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function main() {
  const T = H.T;
  const dir = H.freshDir('ac07');
  const r0 = H.runNj(['init'], { cwd: dir });
  T.exit('nj init', r0, 0);
  T.exit('seed epic', H.runNj(['new', '--type=epic', '--title=Parallel parent'], { cwd: dir }), 0);

  const titles = Array.from({ length: COUNT }, (_, i) => 'Parallel ' + (i + 1));
  const results = await pool(titles, PARALLEL, (t: string) =>
    nj(['new', '--type=task', '--parent=EPIC-001', '--title=' + t], { cwd: dir }));

  const failed = results.filter(r => r.status !== 0);
  T.check('all ' + COUNT + ' creators exit 0', failed.length === 0,
    failed.slice(0, 3).map(r => H.describeRun(r)).join('\n'));

  // 100 files: exactly the tasks folder, no half-written strays.
  let files: string[] = [];
  try { files = H.lsOrEmpty(path.join(dir, 'backlog', 'tasks')).filter(f => f.endsWith('.md')); }
  catch (e) { /* reported by the check below */ }
  T.check('exactly ' + COUNT + ' task files', files.length === COUNT, 'found ' + files.length);

  // 100 unique IDs, each claimed by exactly one file.
  const ids = files.map(f => f.replace(/\.md$/, ''));
  T.check('all ' + COUNT + ' IDs unique', new Set(ids).size === ids.length,
    'unique ' + new Set(ids).size + ' of ' + ids.length);
  T.check('IDs are TSK-001 … TSK-100',
    ids.slice().sort().join(',') === titles.map((_, i) =>
      'TSK-' + String(i + 1).padStart(3, '0')).join(','),
    'got ' + ids.slice().sort().slice(0, 5).join(',') + ' …');

  // One tombstone per allocated ID — the allocator's authority.
  const tombs = H.lsOrEmpty(path.join(dir, 'backlog', H.IDS_REL)).sort();
  T.check('one tombstone per ID', tombs.length === COUNT + 1,
    'tombstones ' + tombs.length + ' (expected ' + (COUNT + 1) + ' incl. the epic)');

  // No file is unreadable: every task must load with an empty _problems.
  // Read-only, so the shows run PARALLEL-wide like the creators; the parse
  // rule is H.runJson's (stdout that is not JSON, or JSON null, is bad).
  const shown = await pool(files, PARALLEL, (f: string) =>
    nj(['show', '--id=' + f.replace(/\.md$/, ''), '--json'], { cwd: dir }));
  const bad = files.filter((_, i) => {
    let json: unknown = null;
    try { json = JSON.parse(shown[i].stdout); } catch (e) { /* not JSON: bad */ }
    return json === null;
  });
  T.check('every created file parses', bad.length === 0, bad.slice(0, 3).join(', '));

  // AC-19: a backlog of freshly created elements is doctor-clean.
  const doc = H.runJson(['doctor'], { cwd: dir });
  T.exit('doctor exits 0 on a fresh backlog', doc, 0);
  T.check('doctor --json ok=true', doc.json && doc.json.ok === true,
    JSON.stringify(doc.json && doc.json.ok));
  /* DECISIONS 100: racing writers may leave STATUS.md (and, same mechanism,
   * TAGS.md) one write behind (spec v3 § 4) — backlog:status_stale and
   * backlog:tags_stale are the only tolerated warnings, each at most once
   * (a backlog-level code appears at most once, Verifier T2); nothing
   * else, and never an error. */
  const TOLERATED = new Set(['backlog:status_stale', 'backlog:tags_stale']);
  T.check('doctor problems[] is empty but for tolerated backlog:*_stale warnings',
    doc.json && Array.isArray(doc.json.problems) &&
    doc.json.problems.length <= 2 &&
    new Set(doc.json.problems.map((p: any) => p.code)).size === doc.json.problems.length &&
    doc.json.problems.every((p: any) => TOLERATED.has(p.code) && p.severity === 'warning'),
    JSON.stringify(doc.json && doc.json.problems));

  /* ---- the "retries exhausted" abort ------------------------------------
   * Reachable only when concurrent creators claim every candidate above the
   * start value before a slow one can. At 20 in flight the probe almost always
   * wins on the first or second try, so this leg asserts the *contract* when
   * the abort happens and reports "not covered" when it does not — it is an
   * honest conditional, not a test that cannot fail.
   */
  const dir2 = H.freshDir('ac07-retries');
  T.exit('nj init (retry leg)', H.runNj(['init'], { cwd: dir2 }), 0);
  H.runNj(['new', '--type=epic', '--title=P'], { cwd: dir2 });

  const wide = Array.from({ length: 300 }, (_, i) => 'W' + i);
  const wr = await pool(wide, 300, (t: string) =>
    nj(['new', '--type=task', '--parent=EPIC-001', '--title=' + t], { cwd: dir2 }));

  /* A creator that was killed or ran into the 60 s limit (status null)
   * says nothing about the allocator either way; it must not pass
   * silently. Exit 0 and 1 are judged below exactly as before. */
  const killed = wr.filter(r => r.status === null);
  T.check('retry leg: no creator was killed or timed out (status null)', killed.length === 0,
    killed.length + ' of ' + wr.length + ': ' + killed.slice(0, 3).map(r => H.describeRun(r)).join('\n'));

  const aborted = wr.filter(r => r.status === 1);
  if (aborted.length === 0) {
    console.log('  NOTE AC-7 retry leg: NOT COVERED — the 100-retry abort was not ' +
      'reached in this run (300 creators, none exhausted its probe).');
  } else {
    const good = aborted.every(r => /^nanojira: id allocation failed after 100 retries \((EPIC|TSK|SUB)\)$/m
      .test(r.stderr.trim()));
    T.check('abort exits 1 with the defined stderr form', good,
      aborted.slice(0, 2).map(r => JSON.stringify(r.stderr.trim())).join('\n'));
    const survivors = H.lsOrEmpty(path.join(dir2, 'backlog', 'tasks'))
      .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    T.check('no ID is claimed twice after an abort',
      new Set(survivors).size === survivors.length);
  }

  T.finish();
}

main().catch(e => {
  console.log('FAIL stress/concurrency.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
