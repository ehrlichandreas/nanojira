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
const RAW_CORPUS = path.join(os.tmpdir(), `nj-s0-record-${process.pid}.ndjson`);

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
// Per RUN, not a fixed path. A shared scratch tree made two concurrent runs
// tear at the same fixtures, and the result was indistinguishable from a real
// regression: same exit 1, same wall of content diffs, no distinguishing
// message. "Red means roll back" is only sound while red says something about
// the code — otherwise someone eventually discards a clean step, and trust in
// red runs goes with it.
//
// Determinism does not suffer: the normaliser folds this root to <FIXTURES>
// before anything is recorded, so the root may vary while the records stay
// byte-identical. That is checked, not assumed (see README).
const SCRATCH = path.resolve(arg('scratch', path.join(os.tmpdir(), `nj-s0-scratch-${process.pid}`)));
// In the repo, not in /tmp: this corpus part vanished on reboot and took
// `record` down with it (code 4). Same lesson as the scoping sources.
const SCRIPTS = path.resolve(arg('scripts', path.join(HERE, 'scratch')));

// Every child — fixture calls, the oracle, the scratch scripts — reaches the
// shim through this. The shim refuses to run without it, which is how the
// fixture corpus silently recording nothing would be caught.
process.env.HARNESS_NJ = NJ_ABS;
// Lets the shim tell our fixtures apart from foreign mkdtemp directories.
process.env.HARNESS_SCRATCH = SCRATCH;

const cannotRun = [];   // coverage gaps — never counted as success
const notRecorded = [];  // ran and passed, but NOT in the byte corpus
const parts = [];       // { name, calls, detail }

// What the digest covers. Executable test content only: the suites, their
// shared library, and the golden fixtures with their manifest. Prose under
// test/ (AMBIGUITIES.md, AC-MATRIX.md, README.md) is deliberately OUT.
//
// A digest over all of test/ once fired on a single documentation line. A
// guard that cries over a comment teaches people to click Code 6 away — and
// then the case it exists for, a suite changed without being renamed, goes
// past unnoticed. Narrowing it is not weakening it; it is aiming it.
// `run-all.js` belongs in here and is not a document: it decides which suites
// are collected at all, how a result is classified, and what counts as
// "cannot run". That classification is precisely where today's recurring
// disease sat — "ran" mistaken for "checked". Change the collecting logic and
// the digest must move, or this guard looks straight past it.
const DIGEST_SCOPE = ['ac', 'edge', 'fault', 'golden', 'lib', 'run-all.js', 'stress'];

/**
 * Digest over the scoped oracle content: every path plus its hash, folded into
 * one value. The suite LIST alone would not notice a suite that changed while
 * keeping its name. Equivalent to
 *   find test/ac test/edge test/fault test/golden test/lib test/run-all.js \
 *        test/stress -type f | sort | xargs shasum -a 256 | shasum -a 256
 * Run from the project root: the paths go into the hash, so the `test/` prefix
 * is part of the value.
 */
function testDigest(root) {
  const base = root || path.join(PROJECT, 'test');
  if (!fs.existsSync(base)) return null;
  const files = [];
  for (const entry of DIGEST_SCOPE) {
    const abs = path.join(base, entry);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      for (const f of R.walk(abs, '', [])) files.push({ abs: f.abs, rel: entry + '/' + f.rel });
    } else {
      files.push({ abs, rel: entry });
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const lines = files.map((f) => `${R.sha256(fs.readFileSync(f.abs))}  test/${f.rel}\n`);
  return R.sha256(lines.join(''));
}

function njSha() {
  return R.sha256(fs.readFileSync(NJ_ABS));
}

// The code under test is nj PLUS the modules it loads from lib/. Hashing nj
// alone would print the same number after a change that lives entirely in
// lib/ -- an identity that does not cover what it names. Only the `current`
// side of verify is multi-file; the header's njSha256 is the single-file
// baseline every record runs against, and stays as it is.
function codeSha() {
  const root = path.dirname(NJ_ABS);
  const lib = path.join(root, 'lib');
  let mods = [];
  try { mods = fs.readdirSync(lib).filter((n) => n.endsWith('.js')).sort(); } catch { /* no lib/: nj alone */ }
  const lines = [`${R.sha256(fs.readFileSync(NJ_ABS))}  ${path.basename(NJ_ABS)}\n`]
    .concat(mods.map((n) => `${R.sha256(fs.readFileSync(path.join(lib, n)))}  lib/${n}\n`));
  return { sha: R.sha256(lines.join('')), files: 1 + mods.length };
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

/**
 * Probes that must NOT be routed through the shim. `verify.js` reads nj's own
 * source and parses its SEVERITY table out of it — handed the shim it finds no
 * such table, dies mid-run, and leaves a truncated trail of calls in the
 * corpus, which is worse than contributing none. A white-box probe cannot be
 * byte-recorded through a stand-in, the same way the preload-instrumented
 * oracle suite cannot.
 *
 * Explicit list, like CONCURRENT_SUITES: a NEW white-box probe is not
 * tolerated silently, it shows up as a coverage gap and has to be entered here
 * deliberately.
 */
const DIRECT_ONLY_SCRIPTS = new Set(['verify.js']);

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
  let contributed = 0;
  for (const n of files) {
    const p = path.join(SCRIPTS, n);

    if (DIRECT_ONLY_SCRIPTS.has(n)) {
      const direct = spawnSync(process.execPath, [p, NJ_ABS], {
        cwd: SCRIPTS,
        env: Object.assign({}, process.env, { NJ: NJ_ABS }),
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (direct.status !== 0) cannotRun.push(`scratch ${n}: exited ${direct.status} even when run directly`);
      else notRecorded.push(`${n} (white-box probe: reads nj's source, verdict taken directly, calls not in the corpus)`);
      continue;
    }

    const at = countLines(recordPath);
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
    // "Spawned without error" is NOT the same as "took part". Nine of these
    // probes hardcoded an absolute nj path, ignored the one they were handed,
    // and so ran past the shim entirely: they recorded nothing while the
    // summary happily said "11/11 scripts executed". A script that contributes
    // no call has verified nothing here, and must not read as coverage.
    const added = countLines(recordPath) - at;
    if (r.error) cannotRun.push(`scratch ${n}: ${r.error.message}`);
    else if (r.status !== 0) cannotRun.push(`scratch ${n}: exited ${r.status} — did not complete`);
    else if (added === 0) cannotRun.push(`scratch ${n}: ran but recorded no call — does it honour the nj path it is given?`);
    else contributed++;
  }
  return {
    name: 'scratch',
    calls: countLines(recordPath) - before,
    detail: `${contributed}/${files.length} scripts contributed calls`,
  };
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
    testDigest: testDigest(),
    // Verzeichnisse mit Schrägstrich, Dateien ohne — der Geltungsbereich soll
    // lesbar sein, ohne dass man raten muss, was davon ein Verzeichnis ist.
    testDigestScope: DIGEST_SCOPE.map((d) => 'test/' + d + (d.includes('.') ? '' : '/')),
    cannotRun: cannotRun.slice(),
    notRecorded: notRecorded.slice(),
    note: 'Comparison key excludes per-file raw sha; nsha (normalised content) is normative.',
  };
  // The shim appends plain NDJSON (it must stay append-only and cheap); the
  // driver compresses once, at the end.
  fs.writeFileSync(CORPUS, zlib.gzipSync(fs.readFileSync(RAW_CORPUS), { level: 9 }));
  fs.rmSync(RAW_CORPUS, { force: true });
  // The header names the corpus it belongs to. Two `record` runs at once would
  // still race on these two files, and a header paired with someone else's
  // corpus is the one corruption that would look plausible. No lock: a stale
  // lock after a crash is the failure mode nj itself refuses (§ 12). Detect
  // instead of exclude.
  header.corpusSha256 = R.sha256(fs.readFileSync(CORPUS));
  fs.writeFileSync(HEADER, JSON.stringify(header, null, 2) + '\n');
  if (!process.env.HARNESS_KEEP) fs.rmSync(SCRATCH, { recursive: true, force: true });
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

// Does this header belong to this corpus? Only checked when the baseline was
// recorded with the field, so an older baseline still verifies. A mismatch
// gets its OWN exit code: a damaged reference must never wear the shape of a
// finding about nj.
if (header.corpusSha256) {
  const actual = R.sha256(fs.readFileSync(CORPUS));
  if (actual !== header.corpusSha256) {
    process.stdout.write('\nABORT: header and corpus do not belong together.\n');
    process.stdout.write(`  header names: ${header.corpusSha256}\n  corpus is   : ${actual}\n`);
    process.stdout.write('Two recordings probably overlapped. Re-record; this says nothing about nj.\n');
    process.exit(7);
  }
}

const tmp = path.join(os.tmpdir(), `nj-s0-verify-${process.pid}.ndjson`);
const total = collect(tmp);
const oldRecs = readRecords(CORPUS);
const newRecs = readRecords(tmp);
const diffs = diff(oldRecs, newRecs, 40);

reportParts(total);
const excluded = markNondeterministic(oldRecs).filter(Boolean).length;
process.stdout.write(`\nbaseline: ${oldRecs.length} calls, nj sha256 ${header.njSha256}\n`);
const code = codeSha();
process.stdout.write(`current : ${newRecs.length} calls, current code sha256 (nj + lib/, ${code.files} files) ${code.sha}\n`);
process.stdout.write(`compared: ${oldRecs.length - excluded} calls (${excluded} excluded as nondeterministic by design — AC-7 concurrency)\n`);

// The oracle part of the corpus is only comparable while test/ holds the same
// suites. the Oracle extends the oracle in parallel, so a changed suite list is the
// expected case, not a freak one — and it must be said out loud. Otherwise the
// extra calls show up as a wall of "extra"/"missing" records and read like an
// nj regression, which is the worst way to learn that test/ moved.
if (header.testDigest) {
  const now = testDigest();
  if (now !== header.testDigest) {
    process.stdout.write('\nABORT: test/ has changed since the baseline was recorded.\n');
    process.stdout.write(`  recorded: ${header.testDigest}\n  current : ${now}\n`);
    process.stdout.write('This is a stale baseline, not an nj regression.\n');
    process.stdout.write('Re-record on the unchanged nj, then verify again.\n');
    process.exit(6);
  }
}

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

if (!process.env.HARNESS_KEEP) {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.rmSync(tmp, { force: true });
}

if (diffs.length === 0 && oldRecs.length === newRecs.length) {
  process.stdout.write('\nBEHAVIOUR UNCHANGED — the recorded surface is identical.\n');
  process.exit(0);
}
process.stdout.write(`\nBEHAVIOUR CHANGED — ${diffs.length} differing call(s)${diffs.length === 40 ? ' (truncated)' : ''}:\n`);
for (const d of diffs) showDiff(d);
process.stdout.write('\nA differing call is a stop, not something to adjust the baseline for.\n');
process.exit(1);
