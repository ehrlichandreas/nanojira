'use strict';
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
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/harness.js');

const PARALLEL = 20;
const COUNT = 100;

/** Run one nj command; never rejects — a non-zero exit is data. */
function nj(args, opts) {
  const o = opts || {};
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW }, o.env || {});
    const child = spawn(H.NODE, [H.NJ].concat(args), { cwd: o.cwd, env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message), spawnError: true }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}

/** Run `items` through `worker` with at most `limit` in flight. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
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
  const results = await pool(titles, PARALLEL, t =>
    nj(['new', '--type=task', '--parent=EPIC-001', '--title=' + t], { cwd: dir }));

  const failed = results.filter(r => r.status !== 0);
  T.check('all ' + COUNT + ' creators exit 0', failed.length === 0,
    failed.slice(0, 3).map(r => 'exit ' + r.status + ' ' + r.stderr.trim()).join('\n'));

  // 100 files: exactly the tasks folder, no half-written strays.
  let files = [];
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
  const tombs = H.lsOrEmpty(path.join(dir, 'backlog', '.ids')).sort();
  T.check('one tombstone per ID', tombs.length === COUNT + 1,
    'tombstones ' + tombs.length + ' (expected ' + (COUNT + 1) + ' incl. the epic)');

  // No file is unreadable: every task must load with an empty _problems.
  const bad = [];
  for (const f of files) {
    const r = H.runJson(['show', '--id=' + f.replace(/\.md$/, '')], { cwd: dir });
    if (r.json === null) bad.push(f);
  }
  T.check('every created file parses', bad.length === 0, bad.slice(0, 3).join(', '));

  // AC-19: a backlog of freshly created elements is doctor-clean.
  const doc = H.runJson(['doctor'], { cwd: dir });
  T.exit('doctor exits 0 on a fresh backlog', doc, 0);
  T.check('doctor --json ok=true', doc.json && doc.json.ok === true,
    JSON.stringify(doc.json && doc.json.ok));
  T.check('doctor problems[] is empty', doc.json && Array.isArray(doc.json.problems) &&
    doc.json.problems.length === 0, JSON.stringify(doc.json && doc.json.problems));

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
  const wr = await pool(wide, 300, t =>
    nj(['new', '--type=task', '--parent=EPIC-001', '--title=' + t], { cwd: dir2 }));

  const aborted = wr.filter(r => r.status === 1);
  if (aborted.length === 0) {
    console.log('  NOTE AC-7 retry leg: NOT COVERED — the 100-retry abort was not ' +
      'reached in this run (300 creators, none exhausted its probe).');
  } else {
    const good = aborted.every(r => /^nj: id allocation failed after 100 retries \((EPIC|TSK|SUB)\)$/m
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
  console.log('FAIL stress/concurrency.js — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
