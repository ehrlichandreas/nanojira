#!/usr/bin/env node
// S0 driver: record the observable behaviour of a given nj, or verify a later
// nj against that record.
//
//   node baseline.ts record --nj=/abs/path/to/nj
//   node baseline.ts verify --nj=/abs/path/to/nj
//
// The nj path is always explicit. There is no default and no PATH lookup: a
// baseline recorded against the wrong binary is worse than no baseline.
//
// "cannot run" is kept hard-separated from "failed" throughout. A corpus part
// that could not execute (missing scratch scripts, missing oracle) is a gap in
// coverage and is reported as such — never silently folded into a pass.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import * as R from './lib/record.ts';
import { scenarios, Ctx } from './fixtures.ts';
import expectedGapsList from './expected-gaps.ts';

const HERE = import.meta.dirname;
const PROJECT = path.resolve(HERE, '..', '..');
const SHIM = path.join(HERE, 'nj-shim.ts');
// Pinned for every child, the same as gate.ts's tee(): a caller that forgot
// NJ_NODE still gets this runtime, so a suite that does its own runtime
// discovery (ac-15) is driven by the one actually running baseline.ts, not
// left to search fixed relative paths that may not exist on this machine.
const NJ_NODE_FOR_CHILDREN = process.env.NJ_NODE || process.execPath;
// Set once, inherited by every child this spawns (fixtures via Ctx, oracle
// suites, scratch scripts: all `Object.assign({}, process.env, …)`). When
// run outside gate.ts (a bare `record`/`verify`), this is baseline.ts's
// own responsibility — gate.ts also sets it, for the frozen test/ it
// replays, which cannot be changed and still calls the raw os.tmpdir().
process.env.TMPDIR = R.CANONICAL_TMP_ROOT;
const BASELINE_DIR = path.join(HERE, 'baseline');
// Gzipped: the raw NDJSON is ~29 MB because every call snapshots every
// backlog file, and a 100-element AC-7 backlog is snapshotted hundreds of
// times. At 3.3 MB it is a reasonable thing to keep in git history, and zlib
// is a Node built-in, so the zero-dependency rule (§ 3) still holds.
const CORPUS = path.join(BASELINE_DIR, 'corpus.ndjson.gz');
const HEADER = path.join(BASELINE_DIR, 'header.json');
// R.CANONICAL_TMP_ROOT, not os.tmpdir(): see its own comment in
// lib/record.ts for why (TMPDIR contamination; the un-resolved-vs-realpath'd
// /tmp mismatch that broke ctx.projectRoot matching under gate.ts).
const RAW_CORPUS = path.join(R.CANONICAL_TMP_ROOT, `nj-s0-record-${process.pid}.ndjson`);

function arg(name: string, dflt: string | null): string | null {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
}

// A full record/verify run takes minutes and prints NOTHING until it is
// done -- collect() only returns after every fixture, oracle suite and
// scratch script has run. A short timeout on a silent process is then
// indistinguishable from a genuine hang; both look like nothing happening.
// Emitted to STDERR (stdout carries only the final report a caller might
// capture) with a running elapsed time, one line per corpus part started.
const HEARTBEAT_START = Date.now();
function heartbeat(what: string): void {
  const s = ((Date.now() - HEARTBEAT_START) / 1000).toFixed(0).padStart(4);
  process.stderr.write(`[+${s}s] ${what}\n`);
}

const mode = process.argv[2];
if (mode !== 'record' && mode !== 'verify' && mode !== 'digest') {
  process.stderr.write('usage: baseline.ts <record|verify> --nj=<path to nj> [--scratch=<dir>] [--scripts=<dir>]\n' +
    '                                   [--limit=<n>] [--diff-out=<file>]  (verify only)\n' +
    '       baseline.ts digest    (prints the test/ digest of this tree and the one the baseline pins)\n');
  process.exit(2);
}

const NJ = arg('nj', null);
// `digest` involves no nj; it is handled once testDigest() is defined, below.
if (mode !== 'digest' && !NJ) {
  process.stderr.write('baseline.ts: --nj=<path> is required (no default, no PATH lookup)\n');
  process.exit(2);
}
if (mode !== 'digest' && !fs.existsSync(NJ as string)) {
  process.stderr.write(`baseline.ts: no nj at ${NJ}\n`);
  process.exit(2);
}
const NJ_ABS = NJ ? path.resolve(NJ) : null;
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
const SCRATCH = path.resolve(arg('scratch', path.join(R.CANONICAL_TMP_ROOT, `nj-s0-scratch-${process.pid}`)) as string);
// No signal handlers here, on purpose. The whole run is one synchronous
// spawnSync loop that never returns to the event loop, so a JS handler would
// never run -- and registering one turns off Node's default "die on SIGTERM",
// which left a stopped run alive until gate.ts's SIGKILL 10 s later (found
// by testing the handler that stood here). The default death is the right
// one; gate.ts removes this pid's nj-s0-* files once the group is gone, and
// its start-up prune covers whatever SIGKILL leaves.
// In the repo, not in /tmp: this corpus part vanished on reboot and took
// `record` down with it (code 4). Same lesson as the scoping sources.
const SCRIPTS = path.resolve(arg('scripts', path.join(HERE, 'scratch')) as string);

// verify only. LIMIT caps the per-call listing printed to stdout, same
// default (40) and same meaning as always (DECISIONS 121: the true total
// and the per-command tally are never capped, only this listing is).
// DIFF_OUT, if given, writes EVERY differing call — never capped at
// LIMIT, never clipped at 400 chars — to the named file, so a step with
// far more diffs than any reasonable stdout listing can still be
// inspected call by call instead of guessed at from the tally alone.
const LIMIT = Number(arg('limit', '40'));
const diffOutArg = arg('diff-out', null);
const DIFF_OUT = diffOutArg ? path.resolve(diffOutArg) : null;

// Every child — fixture calls, the oracle, the scratch scripts — reaches the
// shim through this. The shim refuses to run without it, which is how the
// fixture corpus silently recording nothing would be caught.
process.env.HARNESS_NJ = NJ_ABS as string;
// Lets the shim tell our fixtures apart from foreign mkdtemp directories.
process.env.HARNESS_SCRATCH = SCRATCH;

const cannotRun: string[] = [];   // coverage gaps — never counted as success
const notRecorded: string[] = [];  // ran and passed, but NOT in the byte corpus
// Red verdicts: an oracle suite that ran and failed, or a white-box probe
// that ran to its summary and reported a ✗. Kept apart from both lists above:
// a red verdict is a statement about nj, a gap is a statement about coverage.
// `verify` once printed "oracle suite FAILED" and still exited 0 with
// BEHAVIOUR UNCHANGED, because only the byte diff gated (DECISIONS 90 B2).
const redVerdicts: string[] = [];
interface Part { name: string; calls: number; detail: string; failed?: number; }
const parts: Part[] = [];       // { name, calls, detail }

// What the digest covers. Executable test content only: the suites, their
// shared library, and the golden fixtures with their manifest. Prose under
// test/ (AMBIGUITIES.md, AC-MATRIX.md, README.md) is deliberately OUT.
//
// A digest over all of test/ once fired on a single documentation line. A
// guard that cries over a comment teaches people to click Code 6 away — and
// then the case it exists for, a suite changed without being renamed, goes
// past unnoticed. Narrowing it is not weakening it; it is aiming it.
// `run-all.mjs` belongs in here and is not a document: it decides which suites
// are collected at all, how a result is classified, and what counts as
// "cannot run". That classification is precisely where today's recurring
// disease sat — "ran" mistaken for "checked". Change the collecting logic and
// the digest must move, or this guard looks straight past it.
const DIGEST_SCOPE = ['ac', 'edge', 'fault', 'golden', 'lib', 'run-all.mjs', 'stress'];

/**
 * Digest over the scoped oracle content: every path plus its hash, folded into
 * one value. The suite LIST alone would not notice a suite that changed while
 * keeping its name. Equivalent to
 *   find test/ac test/edge test/fault test/golden test/lib test/run-all.mjs \
 *        test/stress -type f | sort | xargs shasum -a 256 | shasum -a 256
 * Run from the project root: the paths go into the hash, so the `test/` prefix
 * is part of the value.
 */
function testDigest(root?: string): string | null {
  const base = root || path.join(PROJECT, 'test');
  if (!fs.existsSync(base)) return null;
  const files: { abs: string; rel: string }[] = [];
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

// `digest`: what gate.ts asks before it runs anything, so that a --frozen tag
// that does not belong to this baseline is named as such at once, instead of
// surfacing as exit 6 "stale baseline, re-record" -- the wrong advice there.
if (mode === 'digest') {
  let pinned: string | null = null;
  try { pinned = JSON.parse(fs.readFileSync(HEADER, 'utf8')).testDigest || null; } catch {}
  process.stdout.write(JSON.stringify({ current: testDigest(), pinned }) + '\n');
  process.exit(0);
}

function njSha(): string {
  return R.sha256(fs.readFileSync(NJ_ABS as string));
}

// The code under test is nj PLUS the modules it loads. Hashing nj alone
// would print the same number after a change that lives entirely in a
// module -- an identity that does not cover what it names. Only the
// `current` side of verify is multi-file; the header's njSha256 is the
// single-file baseline every record runs against, and stays as it is.
//
// Layout moved from flat lib/*.ts (pre-restructure) to src/commands/*.ts +
// src/core/*.ts. Both are probed: an nj path with a sibling lib/ (an old
// baseline, e.g. c1/c2-baseline) still hashes under the old label; a modern
// source nj (src/nanojira.ts) hashes commands/ and core/ under their own
// labels. A dist/nanojira.mjs (bundled, no siblings) falls back to nj alone,
// as before.
function codeSha(): { sha: string; files: number; label: string } {
  const root = path.dirname(NJ_ABS as string);
  const readMods = (dir: string): string[] | null => {
    try { return fs.readdirSync(dir).filter((n) => n.endsWith('.js') || n.endsWith('.ts')).sort(); } catch { return null; }
  };
  const lib = readMods(path.join(root, 'lib'));
  const lines = [`${R.sha256(fs.readFileSync(NJ_ABS as string))}  ${path.basename(NJ_ABS as string)}\n`];
  let files = 1;
  let label = path.basename(NJ_ABS as string);
  if (lib) {
    lines.push(...lib.map((n) => `${R.sha256(fs.readFileSync(path.join(root, 'lib', n)))}  lib/${n}\n`));
    files += lib.length;
    label += ' + lib/';
  } else {
    const subs: string[] = [];
    for (const sub of ['commands', 'core']) {
      const mods = readMods(path.join(root, sub)) || [];
      lines.push(...mods.map((n) => `${R.sha256(fs.readFileSync(path.join(root, sub, n)))}  ${sub}/${n}\n`));
      files += mods.length;
      if (mods.length) subs.push(sub + '/');
    }
    if (subs.length) label += ' + ' + subs.join(' + ');
  }
  return { sha: R.sha256(lines.join('')), files, label };
}

// ------------------------------------------------------------- corpus parts

function countLines(p: string): number {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0).length; } catch { return 0; }
}

function runFixtures(recordPath: string): Part {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const c = new Ctx(SCRATCH, SHIM, process.execPath, recordPath);
  const threw: string[] = [];
  for (const s of scenarios) {
    heartbeat(`fixture ${s.name}`);
    try {
      s.fn(c);
    } catch (e) {
      threw.push(`${s.name}: ${e && (e as Error).message}`);
    }
  }
  for (const f of threw) {
    process.stderr.write('  fixture scenario threw: ' + f + '\n');
    cannotRun.push('fixture ' + f);
  }
  return { name: 'fixtures', calls: c.calls, detail: `${scenarios.length} scenarios, ${threw.length} threw` };
}

/**
 * Suites are run one by one rather than through run-all.mjs, for one reason:
 * each needs its OWN label in the record. Without that, every oracle call is
 * tagged `oracle` and a concurrent suite cannot be told apart from a
 * deterministic one — which is exactly the distinction the comparison needs.
 * Enumeration mirrors run-all.mjs (ac, fault, edge; `stress/` is deliberately
 * not collected there because ac-07 already wraps it), and pass/fail/cannot-run
 * are decided by the same rule, so the totals stay comparable.
 */
function oracleSuites(): string[] {
  const root = path.join(PROJECT, 'test');
  const out: string[] = [];
  for (const dir of ['ac', 'fault', 'edge']) {
    const p = path.join(root, dir);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.mjs')) out.push(dir + '/' + f);
  }
  return out;
}

// Suites whose output is inherently timing-dependent, not just hard to route
// through the shim. `edge/stdout-epipe.mjs` (TSK-018) races a `| head -1`
// reader's close against nj's later writes on purpose — how much output
// lands before the pipe breaks varies run to run, so byte-recording it once
// would freeze a race outcome as if it were the canonical behaviour, and a
// later verify could go red for a timing difference that is not a
// regression. Pass/fail still counts toward the oracle gate; only the bytes
// are excluded. Explicit list, like DIRECT_ONLY_SCRIPTS: a new suite like
// this is not tolerated silently, it has to be entered here deliberately.
//
// `ac/ac-15-no-dependencies.mjs` joined when its lone-copy leg began copying
// the nj under test instead of <project>/dist/nj (3b563e8). Under the harness
// the nj under test is nj-shim, which cannot run alone (it needs
// lib/record.ts beside it): the suite went red through the shim and green
// directly, and `record` refused c3 with exit 5. The copy-alone property is
// the one thing a stand-in cannot have, so the verdict is taken against the
// real nj, and its few calls leave the corpus.
// `edge/hardening-v3-1.mjs` joined for a different reason than ac-15: its F4
// and D96 legs put the CWD itself out of reach (deleted, or an ancestor made
// unsearchable) and then assert nj's own one-line io_error prose. `nj-shim`
// calls process.cwd() at its own top level, before it ever reaches the real
// nj (to pass an explicit `cwd` to the spawnSync that forwards the call) —
// and in that same broken CWD, process.cwd() itself throws, uncaught, which
// prints an 18-line Node internal stack instead of nj's clean one-liner. The
// real nj is never even reached. Through the shim: red. Direct: green. Same
// shape as ac-15 — a property the stand-in cannot have (here, "survives a
// CWD lookup before the real binary runs at all") — so the verdict is taken
// against the real nj.
const VERDICT_ONLY_SUITES = new Map([
  ['edge/stdout-epipe.mjs', 'timing-dependent'],
  ['ac/ac-15-no-dependencies.mjs', 'copies the nj under test alone; the shim cannot run alone'],
  ['edge/hardening-v3-1.mjs', "the shim's own process.cwd() call throws in its deleted/unsearchable-CWD legs, before the real nj runs"],
]);

// Environment-conditional suites (expected-gaps.ts). Verdict-only too: their
// calls must not depend on the recording machine. Their CANNOT RUN is
// reported by name, not counted as a gap.
const EXPECTED_GAPS = new Map(expectedGapsList.map((g) => [g.suite, g.reason]));
const expectedGapsHit: string[] = [];

// The verdict-only set a recording was made with is part of what the corpus
// means: a suite in the set has no calls in it, a suite outside it has.
// Verifying with a different set shifts every later call -- found by the
// Implementer when gate.ts ran 90a8347's harness (ac-15 verdict-only)
// against the c2 corpus (ac-15 recorded): every call from ac-15 onward
// showed as a label/argv shift. So `record` writes the set into the header,
// and `verify` uses THE HEADER'S set, not this file's.
function currentVerdictOnly(): Map<string, string> {
  const m = new Map(VERDICT_ONLY_SUITES);
  for (const [s, why] of EXPECTED_GAPS) m.set(s, 'environment-conditional (expected-gaps.ts): ' + why);
  return m;
}

// Headers from before the field existed (c2, c3) name the set only in
// notRecorded, as "<dir>/<suite>.mjs (<reason>: verdict taken directly, …)".
// The preload-instrumented suites are not part of it: they go through the
// shim first and fall back only when it is not engaged, the same in record
// and verify. Derived that way, c2 gives {stdout-epipe} and c3 gives
// {ac-15, stdout-epipe}, which is exactly the set each was recorded with.
function headerVerdictOnly(header: any): Map<string, string> {
  const now = currentVerdictOnly();
  if (Array.isArray(header.verdictOnlySuites)) {
    return new Map(header.verdictOnlySuites.map((s: string) => [s, now.get(s) || 'verdict-only in the baseline']));
  }
  const m = new Map<string, string>();
  for (const n of header.notRecorded || []) {
    const x = /^([a-z]+\/[^ ]+\.mjs) \(([^:]+):/.exec(n);
    if (x && x[2] !== 'preload-instrumented') m.set(x[1], x[2]);
  }
  return m;
}

let VERDICT_ONLY_IN_USE = currentVerdictOnly();

function runOracle(recordPath: string): Part | null {
  const root = path.join(PROJECT, 'test');
  const suites = oracleSuites();
  if (suites.length === 0) {
    cannotRun.push('oracle: no suites found under test/{ac,fault,edge}');
    return null;
  }
  const before = countLines(recordPath);
  let passed = 0, failed = 0, cr = 0;
  const failedNames: string[] = [];
  for (const s of suites) {
    heartbeat(`oracle ${s}`);

    if (VERDICT_ONLY_IN_USE.has(s)) {
      const direct = spawnSync(process.execPath, [path.join(root, s), NJ_ABS as string], {
        cwd: PROJECT,
        env: Object.assign({}, process.env, { NJ: NJ_ABS, NJ_NODE: NJ_NODE_FOR_CHILDREN }),
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      // Same classification as below: a CANNOT RUN is a gap, not a verdict.
      // AC-15 says CANNOT RUN when it finds no runtime.
      const directFirst = ((direct.stdout || '') + (direct.stderr || '')).split('\n')[0] || '';
      if (/— CANNOT RUN/.test(directFirst)) {
        cr++;
        if (EXPECTED_GAPS.has(s)) expectedGapsHit.push(`${s}: ${EXPECTED_GAPS.get(s)}`);
        else cannotRun.push('oracle suite could not run: ' + s);
      }
      else if (direct.status === 0) { passed++; notRecorded.push(`${s} (${VERDICT_ONLY_IN_USE.get(s)}: verdict taken directly, calls not in the corpus)`); }
      else { failed++; failedNames.push(s); }
      continue;
    }

    const r = spawnSync(process.execPath, [path.join(root, s), SHIM], {
      cwd: PROJECT,
      env: Object.assign({}, process.env, {
        HARNESS_NJ: NJ_ABS,
        HARNESS_RECORD: recordPath,
        HARNESS_LABEL: 'oracle:' + s,
        NJ: SHIM,
        NJ_NODE: NJ_NODE_FOR_CHILDREN,
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
      const direct = spawnSync(process.execPath, [path.join(root, s), NJ_ABS as string], {
        cwd: PROJECT,
        env: Object.assign({}, process.env, { NJ: NJ_ABS, NJ_NODE: NJ_NODE_FOR_CHILDREN }),
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      out = (direct.stdout || '') + (direct.stderr || '');
      status = direct.status;
      notRecorded.push(s + ' (preload-instrumented: verdict taken directly, calls not in the corpus)');
    }

    const firstLine = out.split('\n')[0] || '';
    if (/— CANNOT RUN/.test(firstLine)) {
      cr++;
      if (EXPECTED_GAPS.has(s)) expectedGapsHit.push(`${s}: ${EXPECTED_GAPS.get(s)}`);
      else cannotRun.push('oracle suite could not run: ' + s);
    }
    else if (status === 0) passed++;
    else { failed++; failedNames.push(s); }
  }
  for (const n of failedNames) {
    process.stderr.write('  oracle suite FAILED: ' + n + '\n');
    redVerdicts.push('oracle suite failed: ' + n);
  }
  return {
    name: 'oracle',
    calls: countLines(recordPath) - before,
    detail: `passed ${passed}/${suites.length}, failed ${failed}, cannot run ${cr}`,
    failed,
  };
}

/**
 * Probes that must NOT be routed through the shim. `verify.ts` reads nj's own
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
const DIRECT_ONLY_SCRIPTS = new Set(['verify.ts']);

// A white-box probe's verdict: its closing summary line (scratch/verify.ts
// prints it last, then exits 1 on any ✗). Status alone cannot tell a ✗ from a
// crash, since an uncaught throw exits 1 too. Summary present with K > 0 ->
// red, whatever the status; summary present with K = 0 and status 0 -> green;
// anything else (no summary, or "0 failed" with a non-zero status) -> the
// probe did not complete cleanly, which is a coverage gap.
const VERDICT_LINE = /^(\d+)\/(\d+) checks passed, (\d+) failed$/m;

function runScratchScripts(recordPath: string): Part | null {
  if (!fs.existsSync(SCRIPTS)) {
    cannotRun.push(`scratch scripts: ${SCRIPTS} not found — the verifier's ad-hoc probes are not in the corpus`);
    return null;
  }
  const files = fs.readdirSync(SCRIPTS).filter((n) => n.endsWith('.ts')).sort();
  if (files.length === 0) {
    cannotRun.push(`scratch scripts: no .ts under ${SCRIPTS}`);
    return null;
  }
  const before = countLines(recordPath);
  let contributed = 0;
  for (const n of files) {
    heartbeat(`scratch ${n}`);
    const p = path.join(SCRIPTS, n);

    if (DIRECT_ONLY_SCRIPTS.has(n)) {
      const direct = spawnSync(process.execPath, [p, NJ_ABS as string], {
        cwd: SCRIPTS,
        env: Object.assign({}, process.env, { NJ: NJ_ABS, NJ_NODE: NJ_NODE_FOR_CHILDREN }),
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const verdict = VERDICT_LINE.exec(direct.stdout || '');
      // A ✗ is red whatever the exit status (I1, gate-instrument.md): the
      // summary line is the contract, the status only backs it up. Status 0
      // with "1 failed" used to fall through to "ran and passed".
      if (verdict && Number(verdict[3]) > 0) {
        const crosses = (direct.stdout || '').split('\n').filter((l) => /^\s*✗ /.test(l)).map((l) => l.trim());
        process.stderr.write(`  scratch ${n}: ${verdict[3]} of ${verdict[2]} checks failed\n`);
        for (const c of crosses) redVerdicts.push(`scratch ${n}: ${c}`);
      } else if (!verdict || direct.status !== 0) {
        cannotRun.push(`scratch ${n}: exited ${direct.status} ${verdict ? '' : 'without its summary line '}even when run directly`);
      } else {
        notRecorded.push(`${n} (white-box probe: reads nj's source, ${verdict[1]}/${verdict[2]} checks, verdict taken directly, calls not in the corpus)`);
      }
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
        NJ_NODE: NJ_NODE_FOR_CHILDREN,
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

function collect(recordPath: string): number {
  fs.rmSync(recordPath, { force: true });
  fs.writeFileSync(recordPath, '');
  parts.length = 0;
  cannotRun.length = 0;
  notRecorded.length = 0;
  redVerdicts.length = 0;
  expectedGapsHit.length = 0;
  parts.push(runFixtures(recordPath));
  const o = runOracle(recordPath);
  if (o) parts.push(o);
  const s = runScratchScripts(recordPath);
  if (s) parts.push(s);
  return countLines(recordPath);
}

// ---------------------------------------------------------------- comparing

function stripSha(after: any): any {
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
function key(rec: any): string {
  const r = JSON.parse(JSON.stringify(rec));
  if (r.after) r.after = stripSha(r.after);
  delete r.cwdHash;   // per-run identity, compared as an ordinal instead
  return JSON.stringify(r);
}

function readRecords(p: string): any[] {
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
  'oracle:ac/ac-07-concurrency.mjs',
  'oracle:edge/tombstone-partial-loss.mjs',
]);

/**
 * Finer than CONCURRENT_SUITES: some suites mix racy and deterministic
 * scratch backlogs in one file, and `rec.label` is assigned per SUITE FILE
 * (test/.../baseline.ts's suite runner), not per scenario — so a whole-suite
 * exclusion would also blind the diff to every deterministic backlog the
 * same file happens to create. Keyed by suite label, each value a list of
 * `backlogLabel` PREFIXES (nj-shim, H.freshDir's naming) that are racy within
 * that suite; everything else in the same file stays in the strict compare.
 *
 * ac-27-claim.mjs's C5 block (§ 12a) spawns real concurrent child processes
 * for claim/steal/release races — which one wins, and so the exact bytes of
 * the claim sequence and mirror write, is nondeterministic by design, the
 * same reason AC-7 is in CONCURRENT_SUITES above. Its other ~58 backlogs
 * (C1-C4, C6-C10) use a fixed NJ_NOW and no concurrency, so they compare
 * strictly like any other suite.
 *
 * The list is explicit rather than pattern-matched, same reasoning as
 * CONCURRENT_SUITES: a NEW racy backlog in this suite is not silently
 * tolerated, it shows up as a red diff and has to be entered here
 * deliberately.
 */
const CONCURRENT_BACKLOG_PREFIXES = new Map([
  ['oracle:ac/ac-27-claim.mjs', ['ac27-c5-claim', 'ac27-c5-steal', 'ac27-c5-release-steal']],
]);

function isConcurrentProbe(rec: any): boolean {
  if (CONCURRENT_SUITES.has(rec.label)) return true;
  const prefixes = CONCURRENT_BACKLOG_PREFIXES.get(rec.label);
  if (!prefixes || !rec.backlogLabel) return false;
  return prefixes.some((p) => rec.backlogLabel.startsWith(p));
}

/**
 * Nondeterminism is a property of the BACKLOG, not of the single call: once
 * 100 racing `nj new` have landed, every later read of that backlog inherits
 * the race (which title got which id). So the mark spreads to every record
 * sharing the same scratch backlog.
 */
function markNondeterministic(recs: any[]): boolean[] {
  const tainted = new Set<string>();
  for (const r of recs) if (isConcurrentProbe(r)) tainted.add(r.cwdHash);
  const flags = recs.map((r) => tainted.has(r.cwdHash));
  return flags;
}

// Returns the shown diffs (capped at `limit`, for the per-call listing) PLUS
// the true total and a tally by command (argv[0]) — the loop itself never
// stops early, so a run with far more differing calls than `limit` is never
// silently undercounted at the one place (`shown.length`) callers used to
// read as "how many" (DECISIONS 121: the cap hid 2,934 real diffs behind a
// report that only ever said 40).
function diff(oldRecs: any[], newRecs: any[], limit: number): { shown: any[]; total: number; byCommand: Map<string, number> } {
  const shown: any[] = [];
  const byCommand = new Map<string, number>();
  let total = 0;
  const skipA = markNondeterministic(oldRecs);
  const skipB = markNondeterministic(newRecs);
  const n = Math.max(oldRecs.length, newRecs.length);
  for (let i = 0; i < n; i++) {
    const a = oldRecs[i], b = newRecs[i];
    let d: any;
    if (!a) { d = { i, kind: 'extra', label: b.label, argv: b.argv }; }
    else if (!b) { d = { i, kind: 'missing', label: a.label, argv: a.argv }; }
    else {
      if (skipA[i] || skipB[i]) continue;
      if (key(a) === key(b)) continue;
      const fields: string[] = [];
      for (const f of ['label', 'argv', 'cwd', 'env', 'exit', 'stdout', 'stderr']) {
        if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) fields.push(f);
      }
      const ka = a.after ? JSON.stringify(stripSha(a.after)) : null;
      const kb = b.after ? JSON.stringify(stripSha(b.after)) : null;
      if (ka !== kb) fields.push('after');
      d = { i, kind: 'changed', label: a.label, argv: a.argv, fields, a, b };
    }
    total++;
    const cmd = (d.argv && d.argv[0]) || '(bare)';
    byCommand.set(cmd, (byCommand.get(cmd) || 0) + 1);
    if (shown.length < limit) shown.push(d);
  }
  return { shown, total, byCommand };
}

// `full`: false clips long before/after values to 400 chars for the stdout
// listing (as always); true (--diff-out) never clips, because a file meant
// for inspecting every diff defeats its own purpose if it silently
// truncates the one thing being inspected.
function clip(s: string | undefined, full: boolean): string {
  if (s === undefined) return '(undefined)';
  if (full) return s;
  return s.length > 400 ? s.slice(0, 400) + ' …' : s;
}

// Renders one diff as text and returns it, rather than writing directly —
// so the same rendering serves both the capped stdout listing and the
// uncapped --diff-out file, the only difference being `full` (clip) and
// which sink the caller sends the string to.
function renderDiff(d: any, full: boolean): string {
  const out: string[] = [];
  out.push(`\n  #${d.i} [${d.label}] nj ${(d.argv || []).join(' ')}\n`);
  if (d.kind !== 'changed') { out.push(`    ${d.kind}\n`); return out.join(''); }
  out.push(`    differs in: ${d.fields.join(', ')}\n`);
  for (const f of d.fields) {
    if (f === 'after') {
      const fa = (d.a.after && d.a.after.files) || {};
      const fb = (d.b.after && d.b.after.files) || {};
      for (const name of new Set(Object.keys(fa).concat(Object.keys(fb)))) {
        const x = fa[name] && fa[name].nsha, y = fb[name] && fb[name].nsha;
        if (x !== y) out.push(`      file ${name}: ${x || '(absent)'} -> ${y || '(absent)'}\n`);
      }
      const sa = d.a.after && d.a.after.stray, sb = d.b.after && d.b.after.stray;
      if (sa !== sb) out.push(`      stray .nj-tmp: ${sa} -> ${sb}\n`);
      const ia = JSON.stringify(d.a.after && d.a.after.ids), ib = JSON.stringify(d.b.after && d.b.after.ids);
      if (ia !== ib) out.push(`      .ids: ${ia} -> ${ib}\n`);
      continue;
    }
    out.push(`      ${f}:\n        was: ${clip(JSON.stringify(d.a[f]), full)}\n        now: ${clip(JSON.stringify(d.b[f]), full)}\n`);
  }
  return out.join('');
}

function showDiff(d: any): void {
  process.stdout.write(renderDiff(d, false));
}

// -------------------------------------------------------------------- modes

function reportParts(total: number): void {
  process.stdout.write('\ncorpus\n');
  for (const p of parts) process.stdout.write(`  ${p.name.padEnd(10)} ${String(p.calls).padStart(6)} calls   ${p.detail}\n`);
  process.stdout.write(`  ${'total'.padEnd(10)} ${String(total).padStart(6)} calls\n`);
  if (notRecorded.length) {
    process.stdout.write('\nran and passed, but NOT byte-recorded:\n');
    for (const c of notRecorded) process.stdout.write('  ' + c + '\n');
  }
  if (expectedGapsHit.length) {
    process.stdout.write('\nexpected gaps (expected-gaps.ts: could not run here, by design -- NOT a pass, not a stop):\n');
    for (const g of expectedGapsHit) process.stdout.write('  ' + g + '\n');
  }
  if (cannotRun.length) {
    process.stdout.write('\ncannot run (coverage gap, NOT a pass):\n');
    for (const c of cannotRun) process.stdout.write('  ' + c + '\n');
  }
}

/**
 * A run that checked nothing must never look like a run that passed.
 *
 * test/run-all.mjs reports 39/39 "cannot run" when NJ is unset and still exits
 * without drama — correct black-box discipline for an oracle written before its
 * implementation, but a trap during a refactor: one forgotten env variable
 * would disguise a real regression as a harmless skip. So the harness treats
 * any cannot-run as a hard stop of its own, separately from any failure.
 */
function reportRed(): void {
  process.stdout.write(`\nRED VERDICTS (${redVerdicts.length}):\n`);
  for (const r of redVerdicts) process.stdout.write('  ' + r + '\n');
}

function abortOnCoverageGap(): void {
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
    njPath: path.relative(PROJECT, NJ_ABS as string),
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
    // The suites run directly, without the shim: no calls of theirs are in
    // the corpus, and verify must use exactly this set (see headerVerdictOnly).
    verdictOnlySuites: oracleSuites().filter((s) => VERDICT_ONLY_IN_USE.has(s)),
    expectedGaps: expectedGapsHit.slice(),
    note: 'Comparison key excludes per-file raw sha; nsha (normalised content) is normative.',
  } as Record<string, any>;
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
  if (redVerdicts.length) {
    reportRed();
    process.stdout.write(`\nABORT: ${redVerdicts.length} red verdict(s) while recording.\n`);
    process.stdout.write('A baseline is only worth recording from a green revision.\n');
    process.exit(5);
  }
  abortOnCoverageGap();
  process.exit(0);
}

// verify
if (!fs.existsSync(CORPUS)) {
  process.stderr.write(`baseline.ts: no baseline at ${CORPUS} — run \`record\` first\n`);
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

// The oracle part of the corpus is only comparable while test/ holds the same
// suites. the Oracle extends the oracle in parallel, so a changed suite list is the
// expected case, not a freak one — and it must be said out loud. Otherwise the
// extra calls show up as a wall of "extra"/"missing" records and read like an
// nj regression, which is the worst way to learn that test/ moved.
//
// Checked BEFORE the corpus runs, not after: both look at test/ only, and a
// stale baseline found after a seven-minute replay is seven minutes wasted.
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

const recordedSuites: string[] | null = header.oracleSuites || null;
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

VERDICT_ONLY_IN_USE = headerVerdictOnly(header);
{
  const now = [...currentVerdictOnly().keys()].filter((s) => oracleSuites().includes(s)).sort().join(', ');
  const used = [...VERDICT_ONLY_IN_USE.keys()].sort().join(', ');
  if (now !== used) {
    process.stdout.write(`\nnote: verdict-only set taken from the baseline: {${used}}; this harness alone would use {${now}}.\n`);
  }
}

const tmp = path.join(R.CANONICAL_TMP_ROOT, `nj-s0-verify-${process.pid}.ndjson`);
const total = collect(tmp);
const oldRecs = readRecords(CORPUS);
const newRecs = readRecords(tmp);
// DIFF_OUT needs every diff, not just the first LIMIT — diff()'s own cap
// only applies to `shown`, so pass it no cap at all when the file is
// requested; the stdout listing below still caps at LIMIT regardless.
const { shown: diffs, total: diffTotal, byCommand: diffByCommand } = diff(oldRecs, newRecs, DIFF_OUT ? Infinity : LIMIT);

reportParts(total);
const excluded = markNondeterministic(oldRecs).filter(Boolean).length;
process.stdout.write(`\nbaseline: ${oldRecs.length} calls, nj sha256 ${header.njSha256}\n`);
const code = codeSha();
process.stdout.write(`current : ${newRecs.length} calls, current code sha256 (${code.label}, ${code.files} files) ${code.sha}\n`);
process.stdout.write(`compared: ${oldRecs.length - excluded} calls (${excluded} excluded as nondeterministic by design — concurrency)\n`);

if (!process.env.HARNESS_KEEP) {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.rmSync(tmp, { force: true });
}

// Precedence, all findings printed first: a red verdict (8) wins over a
// coverage gap (4), and a gap wins over a byte diff (1). A red verdict must
// never hide behind an expected exit 1: a step with named, intended diffs
// (DECISIONS 88) is gated on exit 1 plus reading the list, and a failing
// suite in that same run would otherwise pass unseen. A gap still stops the
// diff from being shown, as before: diffs from an incomplete run are noise.
const unchanged = diffTotal === 0 && oldRecs.length === newRecs.length;
if (redVerdicts.length) reportRed();
if (cannotRun.length === 0) {
  if (unchanged) process.stdout.write('\nBEHAVIOUR UNCHANGED — the recorded surface is identical.\n');
  else {
    // Always the true total and a per-command tally, even when the per-call
    // listing below is capped — a run with far more diffs than the cap must
    // never look like "only 40" (DECISIONS 121).
    const tally = [...diffByCommand.entries()].sort((a, b) => b[1] - a[1]).map(([cmd, n]) => `${cmd} ${n}`).join(', ');
    process.stdout.write(`\nBEHAVIOUR CHANGED — ${diffTotal} differing call(s): ${tally}\n`);
    const shownOnStdout = diffs.slice(0, LIMIT);
    if (shownOnStdout.length < diffTotal) process.stdout.write(`(truncated: showing ${shownOnStdout.length} of ${diffTotal})\n`);
    for (const d of shownOnStdout) showDiff(d);
    if (DIFF_OUT) {
      const text = `${diffTotal} differing call(s): ${tally}\n` + diffs.map((d) => renderDiff(d, true)).join('');
      fs.writeFileSync(DIFF_OUT, text);
      process.stdout.write(`\nfull diff (all ${diffs.length} call(s), un-clipped) written to ${DIFF_OUT}\n`);
    }
    process.stdout.write('\nA differing call is a stop, not something to adjust the baseline for.\n');
  }
}
if (redVerdicts.length) {
  process.stdout.write(`\nVERDICT RED — ${redVerdicts.length} failing suite(s)/check(s), listed under RED VERDICTS above.\n`);
  if (cannotRun.length) process.stdout.write(`Also ${cannotRun.length} coverage gap(s), listed under "cannot run".\n`);
  process.stdout.write('This is a statement about nj, whatever the byte diff says.\n');
  process.exit(8);
}
abortOnCoverageGap();
process.exit(unchanged ? 0 : 1);
