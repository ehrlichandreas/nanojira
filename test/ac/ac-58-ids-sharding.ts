/* AC-58 — Configurable `ids/` sharding (range-bucketed tombstones),
 * docs/SPECIFICATION.md § 5 (`ids.shardSize`), § 7 (`backlog:ids_layout_mismatch`),
 * § 8 "Sharding `ids/` for large backlogs", § 14 (`--fix` migration).
 *
 * Team task 01a13fea + its clarifying addendum 01a13ff0: `shardSize`
 * undefined or `0` is a distinct unsharded branch (today's flat
 * `ids/<TYPE>-<n>`), never a literal divisor; a positive `shardSize` `S`
 * buckets tombstones at `ids/<TYPE>/<bucket>/<TYPE>-<n>`,
 * `bucket = floor(n / S)`. `O_CREAT|O_EXCL` on the tombstone file stays the
 * sole claiming authority throughout — only the path depth changes.
 *
 * Sections: A config validation, B allocation correctness across a bucket
 * boundary, C concurrent contention right at a boundary, D start-value
 * computation staying cheap (never scans an old bucket), E doctor detection
 * + `--fix` migration both directions, F default/unsharded backward
 * compatibility.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

interface Model { dir: string; bl: string; }
function run(args: string[], o?: { cwd?: string; env?: Record<string, string> }) { return H.runNj(args, o); }
function runJ(args: string[], o?: { cwd?: string; env?: Record<string, string> }) { return H.runJson(args, o); }

function ok(r: H.RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

function model(label: string): Model {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  return { dir, bl };
}

function configPath(x: Model) { return path.join(x.bl, '.nanojira', 'config.json'); }
function readConfig(x: Model) { return JSON.parse(fs.readFileSync(configPath(x), 'utf8')); }
function writeConfig(x: Model, cfg: any) { fs.writeFileSync(configPath(x), JSON.stringify(cfg, null, 2) + '\n'); }
function setIds(x: Model, ids: any) {
  const cfg = readConfig(x);
  if (ids === undefined) delete cfg.ids;
  else cfg.ids = ids;
  writeConfig(x, cfg);
}

function idsDir(x: Model) { return path.join(x.bl, '.nanojira', 'ids'); }
function bucketDir(x: Model, prefix: string, bucket: number) {
  return path.join(idsDir(x), prefix, String(bucket).padStart(6, '0'));
}
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let names: string[];
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const full = path.join(d, n);
      const r = rel ? rel + '/' + n : n;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* A. config validation                                                */
/* ------------------------------------------------------------------ */

function sectionA() {
  {
    const x = model('a1-bad-type');
    setIds(x, { shardSize: 'five' });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A1 shardSize a string: doctor exits 2', r, 2);
    T.contains('A1 reports config:invalid naming shardSize', J(r.json && r.json.problems), 'shardSize');
  }
  {
    const x = model('a2-negative');
    setIds(x, { shardSize: -1 });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A2 shardSize negative: doctor exits 2', r, 2);
    T.check('A2 config:invalid present', H.doctorSet(r)?.some((c) => c.startsWith('config:invalid')), J(H.doctorSet(r)));
  }
  {
    const x = model('a3-non-integer');
    setIds(x, { shardSize: 2.5 });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A3 shardSize non-integer: doctor exits 2', r, 2);
    T.check('A3 config:invalid present', H.doctorSet(r)?.some((c) => c.startsWith('config:invalid')), J(H.doctorSet(r)));
  }
  {
    const x = model('a4-zero-is-off');
    setIds(x, { shardSize: 0 });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A4 shardSize=0 is valid (off, same as absent)', r, 0);
  }
  {
    const x = model('a5-unknown-key');
    setIds(x, { shardSize: 10, bogus: 1 });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A5 unknown key inside ids: still exits 0 (warning, not fatal)', r, 0);
    T.check('A5 config:unknown_key present', H.doctorSet(r)?.some((c) => c.startsWith('config:unknown_key')), J(H.doctorSet(r)));
  }
  {
    const x = model('a6-positive-valid');
    setIds(x, { shardSize: 5 });
    const r = runJ(['doctor'], { cwd: x.dir });
    T.exit('A6 a valid positive shardSize: doctor exits 0', r, 0);
  }
}

/* ------------------------------------------------------------------ */
/* B. allocation correctness across a bucket boundary                 */
/* ------------------------------------------------------------------ */

function sectionB() {
  const x = model('b1-boundary');
  setIds(x, { shardSize: 5 });
  ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
  for (let i = 1; i <= 13; i++) ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: x.dir }), 'new task ' + i);

  T.sameSet('B1 bucket 0 holds TSK-001..004', H.lsOrEmpty(bucketDir(x, 'TSK', 0)), ['TSK-001', 'TSK-002', 'TSK-003', 'TSK-004']);
  T.sameSet('B1 bucket 1 holds TSK-005..009', H.lsOrEmpty(bucketDir(x, 'TSK', 1)), ['TSK-005', 'TSK-006', 'TSK-007', 'TSK-008', 'TSK-009']);
  T.sameSet('B1 bucket 2 holds TSK-010..013 (not yet full)', H.lsOrEmpty(bucketDir(x, 'TSK', 2)), ['TSK-010', 'TSK-011', 'TSK-012', 'TSK-013']);
  T.sameSet('B1 EPIC bucket 0 holds EPIC-001', H.lsOrEmpty(bucketDir(x, 'EPIC', 0)), ['EPIC-001']);

  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit('B1 doctor is clean after sharded allocation', d, 0);

  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T14'], { cwd: x.dir }), 'new task 14');
  T.sameSet('B2 allocation continues in the same (not-yet-full) bucket', H.lsOrEmpty(bucketDir(x, 'TSK', 2)),
    ['TSK-010', 'TSK-011', 'TSK-012', 'TSK-013', 'TSK-014']);

  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T15'], { cwd: x.dir }), 'new task 15');
  T.check('B3 crossing into a new bucket creates it', fs.existsSync(bucketDir(x, 'TSK', 3)), bucketDir(x, 'TSK', 3));
  T.sameSet('B3 new bucket holds exactly the new id', H.lsOrEmpty(bucketDir(x, 'TSK', 3)), ['TSK-015']);
}

/* ------------------------------------------------------------------ */
/* C. concurrent O_CREAT|O_EXCL contention right at a bucket boundary  */
/* ------------------------------------------------------------------ */

type NjOpts = { cwd?: string };
function nj(args: string[], opts?: NjOpts): Promise<RunResult> {
  const o = opts || {};
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW });
    const inv = H.njCommand(H.NJ as string, args);
    const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
  });
}
async function poolRun<T2, R>(items: T2[], limit: number, worker: (item: T2, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function runner() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function sectionC() {
  const x = model('c1-concurrent-boundary');
  setIds(x, { shardSize: 5 });
  ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
  // Three sequential creates land TSK-001..003, one short of filling bucket 0
  // (ids 0-4) — a wide burst of concurrent creators right after this must
  // claim 004 (the last slot in bucket 0) and then roll into bucket 1
  // without two of them ever claiming the same number.
  for (let i = 1; i <= 3; i++) ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: x.dir }), 'seed ' + i);

  const titles = Array.from({ length: 20 }, (_, i) => 'C' + i);
  const results = await poolRun(titles, 20, (t) => nj(['new', '--type=task', '--parent=EPIC-001', '--title=' + t], { cwd: x.dir }));
  const failed = results.filter((r) => r.status !== 0);
  T.check('C1 all 20 boundary-racing creators exit 0', failed.length === 0,
    failed.slice(0, 3).map((r) => 'exit ' + r.status + ' ' + r.stderr.trim()).join('\n'));

  const files = H.lsOrEmpty(path.join(x.bl, 'tasks')).filter((f) => f.endsWith('.md'));
  const ids = files.map((f) => f.replace(/\.md$/, ''));
  T.check('C2 23 unique task IDs (3 seed + 20 raced)', new Set(ids).size === 23, 'got ' + ids.length + ' (' + new Set(ids).size + ' unique)');

  // Every id claimed exactly once as a tombstone, spread across the buckets
  // its number implies — no id lost, none doubled, none in the wrong bucket.
  const allTombs = tree(idsDir(x)).filter((p) => /^TSK\//.test(p));
  const tombIds = allTombs.map((p) => path.basename(p));
  T.check('C3 one tombstone per claimed task id', new Set(tombIds).size === tombIds.length && tombIds.length === 23,
    'tombstones ' + tombIds.length + ', unique ' + new Set(tombIds).size);
  let misplaced = 0;
  for (const p of allTombs) {
    const m = /^TSK\/(\d+)\/TSK-(\d+)$/.exec(p);
    if (!m) { misplaced++; continue; }
    const bucket = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (Math.floor(n / 5) !== bucket) misplaced++;
  }
  T.check('C4 every tombstone sits in the bucket its number implies', misplaced === 0, misplaced + ' misplaced');

  const d = runJ(['doctor'], { cwd: x.dir });
  T.exit('C5 doctor clean after the race', d, 0);
}

/* ------------------------------------------------------------------ */
/* D. start-value computation stays cheap (never scans an old bucket)  */
/* ------------------------------------------------------------------ */

function sectionD() {
  const x = model('d1-cheap-start-value');
  setIds(x, { shardSize: 5 });
  ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
  for (let i = 1; i <= 14; i++) ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: x.dir }), 'seed ' + i);
  // TSK-001..014: buckets 0 (001-004), 1 (005-009), 2 (010-014, now full).
  // Make the OLDEST bucket unreadable. If the allocator's start-value
  // computation ever fell back to scanning the whole ids/TSK/ tree instead
  // of only the highest bucket, this would surface as EACCES right here —
  // the one behaviour the team task calls out as the thing sharding must
  // not regress into (an O(total-ever-allocated) scan).
  const oldBucket = bucketDir(x, 'TSK', 0);
  fs.chmodSync(oldBucket, 0o000);
  try {
    const r = ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T15'], { cwd: x.dir }), 'new task while an old bucket is unreadable');
    T.check('D1 allocation succeeds without ever touching the unreadable old bucket', r.status === 0, J(r.stderr));
    T.check('D1 the new id is TSK-015, continuing from the live bucket only', /TSK-015/.test(r.stdout), r.stdout);
  } finally {
    fs.chmodSync(oldBucket, 0o755);
  }
}

/* ------------------------------------------------------------------ */
/* E. doctor detection + --fix migration, both directions              */
/* ------------------------------------------------------------------ */

function sectionE() {
  {
    // flat tombstones already on disk, config now asks for sharded.
    const x = model('e1-flat-to-sharded');
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    for (let i = 1; i <= 7; i++) ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: x.dir }), 'seed ' + i);
    T.sameSet('E1 starts flat', tree(idsDir(x)), ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005', 'TSK-006', 'TSK-007']);

    setIds(x, { shardSize: 3 });
    const d1 = runJ(['doctor'], { cwd: x.dir });
    T.exit('E1 doctor reports the mismatch as an error', d1, 2);
    T.check('E1 backlog:ids_layout_mismatch present', H.doctorSet(d1)?.includes('backlog:ids_layout_mismatch:error'), J(H.doctorSet(d1)));

    const f1 = runJ(['doctor', '--fix'], { cwd: x.dir });
    T.exit('E1 --fix exits 0', f1, 0);
    T.check('E1 fixed[] names the migration', (f1.json.fixed as string[]).some((s) => s.includes('sharded')), J(f1.json.fixed));
    T.sameSet('E1 now laid out sharded, by bucket (shardSize=3)', tree(idsDir(x)), [
      'EPIC/000000/EPIC-001',
      'TSK/000000/TSK-001', 'TSK/000000/TSK-002',
      'TSK/000001/TSK-003', 'TSK/000001/TSK-004', 'TSK/000001/TSK-005',
      'TSK/000002/TSK-006', 'TSK/000002/TSK-007',
    ]);
    T.eq('E1 doctor is clean afterwards', H.doctorSet(runJ(['doctor'], { cwd: x.dir })), []);
  }
  {
    // sharded tombstones already on disk, config now asks for flat.
    const x = model('e2-sharded-to-flat');
    setIds(x, { shardSize: 3 });
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    for (let i = 1; i <= 7; i++) ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i], { cwd: x.dir }), 'seed ' + i);
    T.check('E2 starts sharded', tree(idsDir(x)).some((p) => p.startsWith('TSK/')), J(tree(idsDir(x))));

    setIds(x, { shardSize: 0 });
    const d2 = runJ(['doctor'], { cwd: x.dir });
    T.exit('E2 doctor reports the mismatch as an error', d2, 2);
    T.check('E2 backlog:ids_layout_mismatch present', H.doctorSet(d2)?.includes('backlog:ids_layout_mismatch:error'), J(H.doctorSet(d2)));

    const f2 = runJ(['doctor', '--fix'], { cwd: x.dir });
    T.exit('E2 --fix exits 0', f2, 0);
    T.check('E2 fixed[] names the migration', (f2.json.fixed as string[]).some((s) => s.includes('flat')), J(f2.json.fixed));
    T.sameSet('E2 now laid out flat', tree(idsDir(x)),
      ['EPIC-001', 'TSK-001', 'TSK-002', 'TSK-003', 'TSK-004', 'TSK-005', 'TSK-006', 'TSK-007']);
    T.eq('E2 doctor is clean afterwards', H.doctorSet(runJ(['doctor'], { cwd: x.dir })), []);

    // Allocation keeps working, now-flat, with no stray bucket dirs left behind.
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T8'], { cwd: x.dir }), 'new task 8 after migrating to flat');
    T.check('E2 no leftover TYPE directories after migrating to flat', !tree(idsDir(x)).some((p) => p.includes('/')), J(tree(idsDir(x))));
  }
  {
    // mixed on-disk state (partial migration) is always reported, regardless
    // of which way the configuration currently points.
    const x = model('e3-mixed');
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1'], { cwd: x.dir }), 'new task');
    // Hand-craft a stray sharded copy alongside the real flat ones, simulating
    // a crash mid-`--fix`.
    fs.mkdirSync(bucketDir(x, 'TSK', 7), { recursive: true });
    fs.writeFileSync(path.join(bucketDir(x, 'TSK', 7), 'TSK-999'), '');

    const d3 = runJ(['doctor'], { cwd: x.dir });
    T.exit('E3 mixed layout (flat config): reported as an error', d3, 2);
    T.check('E3 backlog:ids_layout_mismatch present', H.doctorSet(d3)?.includes('backlog:ids_layout_mismatch:error'), J(H.doctorSet(d3)));

    const f3 = runJ(['doctor', '--fix'], { cwd: x.dir });
    T.exit('E3 --fix normalises to the configured (flat) layout', f3, 0);
    T.sameSet('E3 TSK-999 moved up to the flat layout', tree(idsDir(x)), ['EPIC-001', 'TSK-001', 'TSK-999']);
  }
  {
    // A target collision during a sharded -> flat migration must leave the
    // colliding tombstone exactly where it is -- never silently destroyed by
    // cleaning up the (still non-empty) bucket/type directory around it.
    const x = model('e4-collision-preserved');
    setIds(x, { shardSize: 3 });
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1'], { cwd: x.dir }), 'new task');
    // A flat TSK-001 already sitting at the target the sharded TSK-001 would move to.
    fs.writeFileSync(path.join(idsDir(x), 'TSK-001'), '');

    setIds(x, { shardSize: 0 });
    const f4 = runJ(['doctor', '--fix'], { cwd: x.dir });
    // The collision leaves the layout genuinely mixed (one TSK-001 moved,
    // the other could not) -- still correctly reported, not silently
    // swallowed; "repairs unambiguous cases only" (§ 14).
    T.exit('E4 --fix still exits 2: the leftover collision keeps it mismatched', f4, 2);
    T.check('E4 notes the collision', (f4.json.notes as string[]).some((s) => s.includes('TSK-001')), J(f4.json.notes));
    T.check('E4 backlog:ids_layout_mismatch still reported after --fix', H.doctorSet(f4)?.includes('backlog:ids_layout_mismatch:error'), J(H.doctorSet(f4)));
    T.check('E4 the sharded TSK-001 tombstone still exists (never destroyed)',
      fs.existsSync(path.join(bucketDir(x, 'TSK', 0), 'TSK-001')), tree(idsDir(x)).join(', '));
    T.check('E4 the flat TSK-001 tombstone also still exists', fs.existsSync(path.join(idsDir(x), 'TSK-001')), tree(idsDir(x)).join(', '));
    T.check('E4 EPIC-001 still migrated to flat despite the TSK collision', fs.existsSync(path.join(idsDir(x), 'EPIC-001')), tree(idsDir(x)).join(', '));
  }
  {
    // Bug #1's exact scenario, Reviewer's repro: a hand-placed element whose
    // `type:` field disagrees with its own ID prefix (SPECIFICATION.md § 8
    // treats a hand-placed element with an arbitrary number as legitimate).
    // `doctor --fix`'s tombstone backfill must bucket it by the ID's OWN
    // prefix, never by `type` -- a caller-supplied `type` is exactly what
    // the original bug trusted instead.
    const x = model('e5-backfill-type-id-prefix-mismatch');
    setIds(x, { shardSize: 10 });
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    H.mkElement(x.bl, 'tasks/EPIC-055.md', {
      id: 'EPIC-055', type: 'task', parent: 'EPIC-001', title: 'Hand-placed mismatch', status: 'todo',
      created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, H.completeBody('Hand-placed mismatch'));

    const d5 = runJ(['doctor'], { cwd: x.dir });
    T.check('E5 id:no_tombstone reported for the hand-placed element before --fix',
      H.doctorSet(d5)?.includes('id:no_tombstone:warning'), J(H.doctorSet(d5)));

    const f5 = runJ(['doctor', '--fix'], { cwd: x.dir });
    T.exit('E5 --fix exits 0 (the backfill is the only thing to repair)', f5, 0);
    T.check('E5 fixed[] names the backfill', (f5.json.fixed as string[]).some((s) => s.includes('missing tombstone')), J(f5.json.fixed));
    T.check("E5 the backfilled tombstone lands under EPIC/ (the id's own prefix), not TSK/",
      fs.existsSync(path.join(bucketDir(x, 'EPIC', 5), 'EPIC-055')), tree(idsDir(x)).join(', '));
    T.check('E5 never lands under TSK/, which the (wrong) type field would imply',
      !fs.existsSync(path.join(bucketDir(x, 'TSK', 5), 'EPIC-055')), tree(idsDir(x)).join(', '));
    T.eq('E5 doctor is clean afterwards', H.doctorSet(runJ(['doctor'], { cwd: x.dir })), []);
  }
}

/* ------------------------------------------------------------------ */
/* F. default/unsharded backward compatibility                        */
/* ------------------------------------------------------------------ */

function sectionF() {
  {
    const x = model('f1-default-unaffected');
    const cfg = readConfig(x);
    T.check('F1 a freshly-initialised backlog has no ids block', cfg.ids === undefined, J(cfg));

    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1'], { cwd: x.dir }), 'new task');
    T.sameSet('F1 tombstones stay flat with no config change', tree(idsDir(x)), ['EPIC-001', 'TSK-001']);
    T.eq('F1 doctor clean, no mismatch finding appears unasked', H.doctorSet(runJ(['doctor'], { cwd: x.dir })), []);
  }
  {
    // Explicit shardSize: 0 reads identically to the key being absent.
    const x = model('f2-explicit-zero-same-as-absent');
    setIds(x, { shardSize: 0 });
    ok(run(['new', '--type=epic', '--title=E'], { cwd: x.dir }), 'new epic');
    T.sameSet('F2 shardSize:0 still produces a flat tombstone', tree(idsDir(x)), ['EPIC-001']);
  }
}

async function main() {
  sectionA();
  sectionB();
  await sectionC();
  sectionD();
  sectionE();
  sectionF();
  T.finish();
}

main().catch((e) => {
  console.log('FAIL ac-58-ids-sharding.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
