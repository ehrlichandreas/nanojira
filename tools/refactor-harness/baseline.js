#!/usr/bin/env node
'use strict';

// S0 driver: record the observable behaviour of a given nj, or verify a later
// nj against that record.
//
//   node baseline.js record --nj=/abs/path/to/nj
//   node baseline.js verify --nj=/abs/path/to/nj
//
// The nj path is always explicit. There is no default and no PATH lookup: a
// baseline recorded against the wrong binary is worse than no baseline.
//
// "cannot run" is kept hard-separated from "failed" throughout. A corpus part
// that could not execute (missing scratch scripts, missing oracle) is a gap in
// coverage and is reported as such — never silently folded into a pass.

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const R = require('./lib/record.js');
const { scenarios, Ctx } = require('./fixtures.js');

const HERE = __dirname;
const PROJECT = path.resolve(HERE, '..', '..');
const SHIM = path.join(HERE, 'nj-shim');
const BASELINE_DIR = path.join(HERE, 'baseline');
// Gzipped: the raw NDJSON is ~29 MB because every call snapshots every
// backlog file, and a 100-element AC-7 backlog is snapshotted hundreds of
// times. At 3.3 MB it is a reasonable thing to keep in git history, and zlib
// is a Node built-in, so the zero-dependency rule (§ 3) still holds.
const CORPUS = path.join(BASELINE_DIR, 'corpus.ndjson.gz');
const HEADER = path.join(BASELINE_DIR, 'header.json');
const RAW_CORPUS = path.join(os.tmpdir(), 'nj-s0-record.ndjson');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
}

const mode = process.argv[2];
if (mode !== 'record' && mode !== 'verify') {
  process.stderr.write('usage: baseline.js <record|verify> --nj=<path to nj> [--scratch=<dir>] [--scripts=<dir>]\n');
  process.exit(2);
}

const NJ = arg('nj', null);
if (!NJ) {
  process.stderr.write('baseline.js: --nj=<path> is required (no default, no PATH lookup)\n');
  process.exit(2);
}
if (!fs.existsSync(NJ)) {
  process.stderr.write(`baseline.js: no nj at ${NJ}\n`);
  process.exit(2);
}
const NJ_ABS = path.resolve(NJ);
const SCRATCH = path.resolve(arg('scratch', path.join(os.tmpdir(), 'nj-s0-scratch')));
const SCRIPTS = path.resolve(arg('scripts', '/tmp/v2'));

// Every child — fixture calls, the oracle, the scratch scripts — reaches the
// shim through this. The shim refuses to run without it, which is how the
// fixture corpus silently recording nothing would be caught.
process.env.HARNESS_NJ = NJ_ABS;

const cannotRun = [];   // coverage gaps — never counted as success
const notRecorded = [];  // ran and passed, but NOT in the byte corpus
const parts = [];       // { name, calls, detail }

function njSha() {
  return R.sha256(fs.readFileSync(NJ_ABS));
}

// ------------------------------------------------------------- corpus parts

function countLines(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0).length; } catch { return 0; }
}

function runFixtures(recordPath) {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const c = new Ctx(SCRATCH, SHIM, process.execPath, recordPath);
  const threw = [];
  for (const s of scenarios) {
    try {
      s.fn(c);
    } catch (e) {
      threw.push(`${s.name}: ${e && e.message}`);
    }
  }
  for (const f of threw) {
    process.stderr.write('  fixture scenario threw: ' + f + '\n');
    cannotRun.push('fixture ' + f);
  }
  return { name: 'fixtures', calls: c.calls, detail: `${scenarios.length} scenarios, ${threw.length} threw` };
}

/**
 * Suites are run one by one rather than through run-all.js, for one reason:
 * each needs its OWN label in the record. Without that, every oracle call is
 * tagged `oracle` and a concurrent suite cannot be told apart from a
 * deterministic one — which is exactly the distinction the comparison needs.
 * Enumeration mirrors run-all.js (ac, fault, edge; `stress/` is deliberately
 * not collected there because ac-07 already wraps it), and pass/fail/cannot-run
 * are decided by the same rule, so the totals stay comparable.
 */
function oracleSuites() {
  const root = path.join(PROJECT, 'test');
  const out = [];
  for (const dir of ['ac', 'fault', 'edge']) {
    const p = path.join(root, dir);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.js')) out.push(dir + '/' + f);
  }
  return out;
}

function runOracle(recordPath) {
  const root = path.join(PROJECT, 'test');
  const suites = oracleSuites();
  if (suites.length === 0) {
    cannotRun.push('oracle: no suites found under test/{ac,fault,edge}');
    return null;
  }
  const before = countLines(recordPath);
  let passed = 0, failed = 0, cr = 0;
  const failedNames = [];
  for (const s of suites) {
    const r = spawnSync(process.execPath, [path.join(root, s), SHIM], {
      cwd: PROJECT,
      env: Object.assign({}, process.env, {
        HARNESS_NJ: NJ_ABS,
        HARNESS_RECORD: recordPath,
        HARNESS_LABEL: 'oracle:' + s,
        NJ: SHIM,
      }),
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    let out = (r.stdout || '') + (r.stderr || '');
    let status = r.status;

    // Some suites instrument nj from the inside via a NODE_OPTIONS preload
    // (fault/det-*). The preload also loads into the shim, and since the shim
    // outlives its child it writes the counter log last — clobbering the real
    // counts with zeros. Such a suite cannot be byte-recorded through an extra
    // process layer. Re-run it directly so its verdict still counts, and
    // declare it as absent from the corpus rather than calling it a failure.
    if (status !== 0 && /SHIM NOT ENGAGED/.test(out)) {
      const direct = spawnSync(process.execPath, [path.join(root, s), NJ_ABS], {
        cwd: PROJECT,
        env: Object.assign({}, process.env, { NJ: NJ_ABS }),
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      out = (direct.stdout || '') + (direct.stderr || '');
      status = direct.status;
      notRecorded.push(s + ' (preload-instrumented: verdict taken directly, calls not in the corpus)');
    }

    const firstLine = out.split('\n')[0] || '';
    if (/— CANNOT RUN/.test(firstLine)) { cr++; cannotRun.push('oracle suite could not run: ' + s); }
    else if (status === 0) passed++;
    else { failed++; failedNames.push(s); }
  }
  for (const n of failedNames) process.stderr.write('  oracle suite FAILED: ' + n + '\n');
  return {
    name: 'oracle',
    calls: countLines(recordPath) - before,
    detail: `passed ${passed}/${suites.length}, failed ${failed}, cannot run ${cr}`,
    failed,
  };
}

function runScratchScripts(recordPath) {
  if (!fs.existsSync(SCRIPTS)) {
    cannotRun.push(`scratch scripts: ${SCRIPTS} not found — the verifier's ad-hoc probes are not in the corpus`);
    return null;
  }
  const files = fs.readdirSync(SCRIPTS).filter((n) => n.endsWith('.js')).sort();
  if (files.length === 0) {
    cannotRun.push(`scratch scripts: no .js under ${SCRIPTS}`);
    return null;
  }
  const before = countLines(recordPath);
  let ran = 0;
  for (const n of files) {
    const p = path.join(SCRIPTS, n);
    const r = spawnSync(process.execPath, [p, SHIM], {
      cwd: SCRIPTS,
      env: Object.assign({}, process.env, {
        HARNESS_NJ: NJ_ABS,
        HARNESS_RECORD: recordPath,
        HARNESS_LABEL: 'scratch:' + n,
        NJ: SHIM,
      }),
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) cannotRun.push(`scratch ${n}: ${r.error.message}`);
    else ran++;
  }
  return { name: 'scratch', calls: countLines(recordPath) - before, detail: `${ran}/${files.length} scripts executed` };
}

function collect(recordPath) {
  fs.rmSync(recordPath, { force: true });
  fs.writeFileSync(recordPath, '');
  parts.length = 0;
  cannotRun.length = 0;
  notRecorded.length = 0;
  parts.push(runFixtures(recordPath));
  const o = runOracle(recordPath);
  if (o) parts.push(o);
  const s = runScratchScripts(recordPath);
  if (s) parts.push(s);
  return countLines(recordPath);
}

// ---------------------------------------------------------------- comparing

function stripSha(after) {
  const c = JSON.parse(JSON.stringify(after));
  if (c.files) for (const f of Object.keys(c.files)) delete c.files[f].sha;
  return c;
}

/**
 * The comparison key. Raw per-file SHAs are dropped: a file whose `created`
 * came from an unpinned mtime differs on every run while being correct. The
 * normalised hash (`nsha`) is what a refactor must not move. Raw SHAs stay in
 * the record for forensics.
 */
function key(rec) {
  const r = JSON.parse(JSON.stringify(rec));
  if (r.after) r.after = stripSha(r.after);
  delete r.cwdHash;   // per-run identity, compared as an ordinal instead
  return JSON.stringify(r);
}

function readRecords(p) {
  const raw = p.endsWith('.gz')
    ? zlib.gunzipSync(fs.readFileSync(p)).toString('utf8')
    : fs.readFileSync(p, 'utf8');
  return raw.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

/**
 * AC-7 drives 100 `nj new` through `xargs -P 20`. Which call wins which ID,
 * the interleaving, and how many temp files are in flight at any instant are
 * nondeterministic BY DESIGN — that is the property the suite exists to prove.
 * Comparing those records across runs would produce noise that trains the
 * reader to ignore the diff, which is the one thing a baseline must never do.
 *
 * So they are excluded from the strict comparison, counted, and reported. The
 * rule is deliberately narrow: if AC-7 ever renames its fixtures, these records
 * fall back into the strict set and the diff goes red rather than quiet.
 */
/**
 * Suites that race on purpose. Their interleaving, which call wins which id,
 * and how many temp files are in flight are nondeterministic BY DESIGN — that
 * is the property they exist to prove (AC-7, § 8, § 12). Comparing those
 * records across runs would produce noise that trains the reader to ignore the
 * diff, which is the one thing a baseline must never do.
 *
 * The list is explicit rather than pattern-matched: a NEW concurrent suite is
 * not silently tolerated, it shows up as a red diff and has to be added here
 * deliberately.
 */
const CONCURRENT_SUITES = new Set([
  'oracle:ac/ac-07-concurrency.js',
  'oracle:edge/tombstone-partial-loss.js',
]);

function isConcurrentProbe(rec) {
  return CONCURRENT_SUITES.has(rec.label);
}

/**
 * Nondeterminism is a property of the BACKLOG, not of the single call: once
 * 100 racing `nj new` have landed, every later read of that backlog inherits
 * the race (which title got which id). So the mark spreads to every record
 * sharing the same scratch backlog.
 */
function markNondeterministic(recs) {
  const tainted = new Set();
  for (const r of recs) if (isConcurrentProbe(r)) tainted.add(r.cwdHash);
  const flags = recs.map((r) => tainted.has(r.cwdHash));
  return flags;
}

function diff(oldRecs, newRecs, limit) {
  const out = [];
  const skipA = markNondeterministic(oldRecs);
  const skipB = markNondeterministic(newRecs);
  const n = Math.max(oldRecs.length, newRecs.length);
  for (let i = 0; i < n && out.length < limit; i++) {
    const a = oldRecs[i], b = newRecs[i];
    if (!a) { out.push({ i, kind: 'extra', label: b.label, argv: b.argv }); continue; }
    if (!b) { out.push({ i, kind: 'missing', label: a.label, argv: a.argv }); continue; }
    if (skipA[i] || skipB[i]) continue;
    if (key(a) === key(b)) continue;
    const fields = [];
    for (const f of ['label', 'argv', 'cwd', 'env', 'exit', 'stdout', 'stderr']) {
      if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) fields.push(f);
    }
    const ka = a.after ? JSON.stringify(stripSha(a.after)) : null;
    const kb = b.after ? JSON.stringify(stripSha(b.after)) : null;
    if (ka !== kb) fields.push('after');
    out.push({ i, kind: 'changed', label: a.label, argv: a.argv, fields, a, b });
  }
  return out;
}

function clip(s) {
  if (s === undefined) return '(undefined)';
  return s.length > 400 ? s.slice(0, 400) + ' …' : s;
}

function showDiff(d) {
  process.stdout.write(`\n  #${d.i} [${d.label}] nj ${(d.argv || []).join(' ')}\n`);
  if (d.kind !== 'changed') { process.stdout.write(`    ${d.kind}\n`); return; }
  process.stdout.write(`    differs in: ${d.fields.join(', ')}\n`);
  for (const f of d.fields) {
    if (f === 'after') {
      const fa = (d.a.after && d.a.after.files) || {};
      const fb = (d.b.after && d.b.after.files) || {};
      for (const name of new Set(Object.keys(fa).concat(Object.keys(fb)))) {
        const x = fa[name] && fa[name].nsha, y = fb[name] && fb[name].nsha;
        if (x !== y) process.stdout.write(`      file ${name}: ${x || '(absent)'} -> ${y || '(absent)'}\n`);
      }
      const sa = d.a.after && d.a.after.stray, sb = d.b.after && d.b.after.stray;
      if (sa !== sb) process.stdout.write(`      stray .nj-tmp: ${sa} -> ${sb}\n`);
      const ia = JSON.stringify(d.a.after && d.a.after.ids), ib = JSON.stringify(d.b.after && d.b.after.ids);
      if (ia !== ib) process.stdout.write(`      .ids: ${ia} -> ${ib}\n`);
      continue;
    }
    process.stdout.write(`      ${f}:\n        was: ${clip(JSON.stringify(d.a[f]))}\n        now: ${clip(JSON.stringify(d.b[f]))}\n`);
  }
}

// -------------------------------------------------------------------- modes

function reportParts(total) {
  process.stdout.write('\ncorpus\n');
  for (const p of parts) process.stdout.write(`  ${p.name.padEnd(10)} ${String(p.calls).padStart(6)} calls   ${p.detail}\n`);
  process.stdout.write(`  ${'total'.padEnd(10)} ${String(total).padStart(6)} calls\n`);
  if (notRecorded.length) {
    process.stdout.write('\nran and passed, but NOT byte-recorded:\n');
    for (const c of notRecorded) process.stdout.write('  ' + c + '\n');
  }
  if (cannotRun.length) {
    process.stdout.write('\ncannot run (coverage gap, NOT a pass):\n');
    for (const c of cannotRun) process.stdout.write('  ' + c + '\n');
  }
}

/**
 * A run that checked nothing must never look like a run that passed.
 *
 * test/run-all.js reports 39/39 "cannot run" when NJ is unset and still exits
 * without drama — correct black-box discipline for an oracle written before its
 * implementation, but a trap during a refactor: one forgotten env variable
 * would disguise a real regression as a harmless skip. So the harness treats
 * any cannot-run as a hard stop of its own, separately from any failure.
 */
function abortOnCoverageGap() {
  if (cannotRun.length === 0) return;
  process.stdout.write(`\nABORT: ${cannotRun.length} part(s) of the corpus could not run.\n`);
  process.stdout.write('A run that verified nothing is not a pass. Fix the prerequisite and re-run.\n');
  process.exit(4);
}

if (mode === 'record') {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const total = collect(RAW_CORPUS);
  const header = {
    njSha256: njSha(),
    njPath: path.relative(PROJECT, NJ_ABS),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    recordedAt: new Date().toISOString(),
    calls: total,
    parts: parts.map((p) => ({ name: p.name, calls: p.calls, detail: p.detail })),
    oracleSuites: oracleSuites(),
    cannotRun: cannotRun.slice(),
    notRecorded: notRecorded.slice(),
    note: 'Comparison key excludes per-file raw sha; nsha (normalised content) is normative.',
  };
  // The shim appends plain NDJSON (it must stay append-only and cheap); the
  // driver compresses once, at the end.
  fs.writeFileSync(CORPUS, zlib.gzipSync(fs.readFileSync(RAW_CORPUS), { level: 9 }));
  fs.rmSync(RAW_CORPUS, { force: true });
  fs.writeFileSync(HEADER, JSON.stringify(header, null, 2) + '\n');
  reportParts(total);
  process.stdout.write(`\nnj sha256 ${header.njSha256}\nbaseline written: ${path.relative(PROJECT, CORPUS)} (${total} calls)\n`);
  const oracle = parts.find((p) => p.name === 'oracle');
  if (oracle && oracle.failed) {
    process.stdout.write(`\nABORT: the oracle reported ${oracle.failed} failing suite(s) while recording.\n`);
    process.stdout.write('A baseline is only worth recording from a green revision.\n');
    process.exit(5);
  }
  abortOnCoverageGap();
  process.exit(0);
}

// verify
if (!fs.existsSync(CORPUS)) {
  process.stderr.write(`baseline.js: no baseline at ${CORPUS} — run \`record\` first\n`);
  process.exit(2);
}
const header = JSON.parse(fs.readFileSync(HEADER, 'utf8'));
const tmp = path.join(os.tmpdir(), `nj-s0-verify-${process.pid}.ndjson`);
const total = collect(tmp);
const oldRecs = readRecords(CORPUS);
const newRecs = readRecords(tmp);
const diffs = diff(oldRecs, newRecs, 40);

reportParts(total);
const excluded = markNondeterministic(oldRecs).filter(Boolean).length;
process.stdout.write(`\nbaseline: ${oldRecs.length} calls, nj sha256 ${header.njSha256}\n`);
process.stdout.write(`current : ${newRecs.length} calls, nj sha256 ${njSha()}\n`);
process.stdout.write(`compared: ${oldRecs.length - excluded} calls (${excluded} excluded as nondeterministic by design — AC-7 concurrency)\n`);

// The oracle part of the corpus is only comparable while test/ holds the same
// suites. the Oracle extends the oracle in parallel, so a changed suite list is the
// expected case, not a freak one — and it must be said out loud. Otherwise the
// extra calls show up as a wall of "extra"/"missing" records and read like an
// nj regression, which is the worst way to learn that test/ moved.
const recordedSuites = header.oracleSuites || null;
if (recordedSuites) {
  const now = oracleSuites();
  const added = now.filter((s) => !recordedSuites.includes(s));
  const gone = recordedSuites.filter((s) => !now.includes(s));
  if (added.length || gone.length) {
    process.stdout.write('\nABORT: the oracle suite list changed since the baseline was recorded.\n');
    for (const a of added) process.stdout.write('  added since: ' + a + '\n');
    for (const g of gone) process.stdout.write('  gone since : ' + g + '\n');
    process.stdout.write('This is a stale baseline, not an nj regression.\n');
    process.stdout.write('Re-record on the unchanged nj, then verify again.\n');
    process.exit(6);
  }
}

abortOnCoverageGap();

if (diffs.length === 0 && oldRecs.length === newRecs.length) {
  process.stdout.write('\nBEHAVIOUR UNCHANGED — the recorded surface is identical.\n');
  process.exit(0);
}
process.stdout.write(`\nBEHAVIOUR CHANGED — ${diffs.length} differing call(s)${diffs.length === 40 ? ' (truncated)' : ''}:\n`);
for (const d of diffs) showDiff(d);
process.stdout.write('\nA differing call is a stop, not something to adjust the baseline for.\n');
process.exit(1);
