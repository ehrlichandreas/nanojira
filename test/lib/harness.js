'use strict';
/*
 * NanoJira verification harness — zero dependencies, Node built-ins only.
 *
 * Contract for every test file in this tree:
 *
 *   const H = require('../lib/harness.js');
 *   H.runNj(['list'], {cwd: dir});
 *   H.T.eq('description', actual, expected);
 *   H.T.finish();          // prints PASS/FAIL, exits 0 or 1
 *
 * The nj script path is given as argv[2] (or the NJ environment variable).
 * Tests drive `nj` as a black box: they never require() it, never read its
 * source, and assert only on observable behaviour — exit code, stdout, stderr
 * and the bytes of the files it leaves behind.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

/* Resolved to an absolute path at load time. Tests spawn nj with the scratch
 * backlog as cwd, so a relative path given here would be re-resolved against
 * the wrong directory and every test would report CANNOT RUN — pointing at the
 * suite instead of at the missing argument. */
const NJ = (() => {
  const given = process.env.NJ || process.argv[2] || null;
  return given ? path.resolve(given) : null;
})();
const NODE = process.env.NJ_NODE || process.execPath;

/* Fixed clock for every run (§ 12). Timestamps are the only non-deterministic
 * part of a NanoJira file, so pinning the clock is what makes byte-exact
 * golden comparison possible without normalisation. */
const FIXED_NOW = '2026-09-21T18:00:00Z';
const LATER_NOW = '2026-09-21T19:30:00Z';

const GOLDEN_DIR = path.join(__dirname, '..', 'golden');

const _tmpDirs = [];

/** A fresh empty directory. Not a backlog — use mkBacklog() for that. */
function freshDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-' + (label || 't') + '-'));
  _tmpDirs.push(dir);
  return dir;
}

/**
 * A hand-built backlog, written by the test rather than by `nj init`.
 * Fixture-driven tests must not depend on the very code path they verify.
 *
 * Returns the project directory (the backlog lives in <dir>/backlog).
 *
 * USE THE RETURN VALUE — this function creates its own scratch directory. Do
 * NOT call freshDir() alongside it and then read from that directory instead:
 *
 *   const d = H.freshDir('x');      // ✗ wrong — the backlog lands elsewhere
 *   H.mkBacklog({files: {...}});    //   and every read below sees nothing
 *
 *   const d = H.mkBacklog({label: 'x', files: {...}});   // ✓
 */
function mkBacklog(opts) {
  const o = opts || {};
  const dir = freshDir(o.label || 'backlog');
  const bl = path.join(dir, 'backlog');
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.ids']) {
    fs.mkdirSync(path.join(bl, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(bl, '.nanojira.json'), o.config || DEFAULT_CONFIG);
  fs.writeFileSync(path.join(bl, '.gitignore'),
    '.nanojira-index.json\n.nj-tmp-*\n');
  fs.writeFileSync(path.join(bl, 'README.md'), '# Backlog\n\nFormat notes.\n');
  for (const [rel, body] of Object.entries(o.files || {})) {
    writeRaw(bl, rel, body);
  }
  for (const id of o.tombstones || []) {
    fs.writeFileSync(path.join(bl, '.ids', id), '');
  }
  return dir;
}

const DEFAULT_CONFIG = JSON.stringify({
  schema: 1,
  statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
  sections: {
    description: ['Description'],
    acceptance: ['Acceptance Criteria'],
  },
}, null, 2) + '\n';

/** Write raw bytes into a backlog, creating parent folders. */
function writeRaw(backlogRootOrProject, rel, content) {
  const base = path.basename(backlogRootOrProject) === 'backlog'
    ? backlogRootOrProject
    : path.join(backlogRootOrProject, 'backlog');
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/** Read a file from a backlog (or the project dir if rel starts with 'backlog/'). */
function readInBacklog(dir, rel) {
  return fs.readFileSync(path.join(dir, 'backlog', rel), 'utf8');
}

function existsInBacklog(dir, rel) {
  return fs.existsSync(path.join(dir, 'backlog', rel));
}

/**
 * Directory listing that never throws. A partially built (or stubbed)
 * implementation produces no directories at all, and a test that dies with
 * ENOENT there reports nothing useful — it must fail on its assertion instead.
 * Returns [] for anything that is not a readable directory.
 */
function lsOrEmpty(p) {
  try { return fs.readdirSync(p).sort(); } catch (e) { return []; }
}

/** File read that never throws — null when the file is absent or unreadable. */
function readOrNull(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function listFiles(dir, rel) {
  const p = path.join(dir, 'backlog', rel || '.');
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).sort();
}

/** Canonical frontmatter for fixture files, in § 7 key order. */
function element(fields, body) {
  const order = ['id', 'type', 'parent', 'title', 'status', 'priority',
    'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived'];
  const keys = order.filter(k => fields[k] !== undefined)
    .concat(Object.keys(fields).filter(k => !order.includes(k)));
  const fm = keys.map(k => k + ': ' + fields[k]).join('\n');
  return '---\n' + fm + '\n---\n\n' + (body === undefined ? '' : body);
}

function mkElement(dir, rel, fields, body) {
  return writeRaw(dir, rel, element(fields, body));
}

/** A minimal but *complete* task body, for fixtures where completeness is not the point. */
function completeBody(title) {
  return '# ' + title + '\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [ ] It works\n';
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * A doctor run's findings as a comparable set: `code:severity` per finding,
 * the two axes § 7's table defines together. Pass the result of
 * `runJson(['doctor'], …)`.
 *
 * Returns `null` when there is no `problems` array at all — § 9 pins
 * doctor's shape as `{backlog, ok, problems}`, so a missing array is a
 * contract breach, and `null` makes `sameSet` report it instead of silently
 * comparing against an empty set.
 */
function doctorSet(result) {
  const problems = result && result.json && result.json.problems;
  if (!Array.isArray(problems)) return null;
  return problems.map(p => String(p && p.code) + ':' + String(p && p.severity));
}

/**
 * The § 14 summary line, built from the spec's own example:
 *
 *   backlog/: 47 entries, 2 errors, 1 warning
 *
 * Two things that example pins and that nothing in the oracle asserted: the
 * **warning** count exists at all (`ac-16` only checks that the word
 * "entries" occurs), and the counts are singularised — "2 errors" next to
 * "1 warning" is what fixes `error`/`warning` as `s`-at-≠1.
 *
 * AMBIGUOUS: the singular of "entries" is not shown anywhere in § 14, so a
 * one-element backlog is not pinned. Callers must avoid N = 1 rather than
 * guess between "1 entry" and "1 entries"; `entriesWord` exists only to make
 * that choice explicit at the call site if a ruling ever lands.
 */
function summaryLine(label, entries, errors, warnings, entriesWord) {
  const s = (k, word) => k + ' ' + word + (k === 1 ? '' : 's');
  return label + ': ' + entries + ' ' + (entriesWord || 'entries') + ', ' +
    s(errors, 'error') + ', ' + s(warnings, 'warning');
}

/** Golden file bytes, as frozen in test/golden. */
function golden(name) {
  return fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function goldenPath(name) {
  return path.join(GOLDEN_DIR, name);
}

/**
 * Run `nj`. Returns {status, stdout, stderr, signal}. Never throws on a
 * non-zero exit — that is data, not an error.
 */
function runNj(args, opts) {
  const o = opts || {};
  if (!NJ) return abortNoImplementation('no nj path given (pass it as argv[2] or set NJ)');
  if (!fs.existsSync(NJ)) return abortNoImplementation('nj not found at ' + NJ);
  const env = Object.assign({}, process.env, { NJ_NOW: FIXED_NOW }, o.env || {});
  for (const k of o.unsetEnv || []) delete env[k];
  const r = spawnSync(NODE, [NJ].concat(args), {
    cwd: o.cwd,
    env,
    input: o.input,
    encoding: 'utf8',
    timeout: o.timeout || 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) {
    return { status: null, stdout: '', stderr: String(r.error.message), missing: 'spawn failed: ' + r.error.message };
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal };
}

/** Run nj and parse stdout as JSON, asserting the exit code is as expected. */
function runJson(args, opts) {
  const o = opts || {};
  const r = runNj(args.concat(['--json']), o);
  let json = null, parseError = null;
  try { json = JSON.parse(r.stdout); } catch (e) { parseError = e.message; }
  return Object.assign({}, r, { json, parseError });
}

/* ------------------------------------------------------------------ */
/* Test context                                                        */
/* ------------------------------------------------------------------ */

const T = {
  _failures: [],
  _checks: 0,
  _name: path.basename(process.argv[1] || 'test'),

  /** Record a boolean assertion. */
  check(desc, cond, detail) {
    this._checks++;
    if (!cond) {
      this._failures.push({ desc, detail: detail === undefined ? '' : String(detail) });
    }
    return !!cond;
  },

  eq(desc, actual, expected) {
    const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
    const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
    return this.check(desc, a === e, 'expected ' + JSON.stringify(e) + '\n     got      ' + JSON.stringify(a));
  },

  /** Byte-exact file comparison against a golden fixture. */
  goldenEq(desc, actualPath, goldenName) {
    let actual;
    try { actual = fs.readFileSync(actualPath, 'utf8'); }
    catch (e) { return this.check(desc, false, 'cannot read ' + actualPath + ': ' + e.message); }
    const want = golden(goldenName);
    if (actual === want) return this.check(desc, true);
    return this.check(desc, false,
      'file differs from golden/' + goldenName + '\n' + firstDiff(actual, want));
  },

  /**
   * Assert the exit code against a single expected value.
   *
   * `expected` must not be an array. An array reads as the honest form of
   * "the spec does not pin the code", but it is indistinguishable from
   * quietly accepting a bug (AMBIGUITIES.md 23: an either/or here once let a
   * wrong-but-in-set exit code through for a whole round). Derive one value
   * from the spec instead — if it comes back red, that is a finding to
   * escalate, not a reason to widen the assertion.
   */
  exit(desc, result, expected) {
    if (Array.isArray(expected)) {
      throw new Error('T.exit(' + JSON.stringify(desc) + ', …): expected must be a single ' +
        'exit code, not an array — derive one value from the spec (AMBIGUITIES.md 23) ' +
        'instead of tolerating a set of them');
    }
    if (result.missing) {
      return this.check(desc, false, 'CANNOT RUN: ' + result.missing +
        '\n     (the implementation does not exist yet — the oracle is built first)');
    }
    const ok = result.status === expected;
    return this.check(desc, ok,
      'expected exit ' + expected + ', got ' + result.status +
      (result.stderr ? '\n     stderr: ' + trunc(result.stderr) : ''));
  },

  /** A substring assertion that prints surrounding context on failure. */
  contains(desc, haystack, needle) {
    return this.check(desc, String(haystack).includes(needle),
      'expected to contain ' + JSON.stringify(needle) + '\n     in  ' + JSON.stringify(trunc(haystack)));
  },

  /**
   * Assert that two collections hold EXACTLY the same items — nothing
   * missing and, crucially, nothing extra.
   *
   * WHY THIS EXISTS. The oracle's doctor assertions were written as
   * containment (`found.includes(code)`, `problems.some(p => …)`), and a
   * containment check cannot see an *additional* item by construction. A
   * blindness matrix over one-part mutants of `nj` measured the cost: a
   * mutant that appends one spurious `title:h1_mismatch` WARNING whenever
   * real findings already exist left 19 suites green and was caught by none
   * of them. On *clean* backlogs five suites catch it, via
   * `problems.length === 0` — but the moment a genuine finding exists, an
   * extra misclassification became invisible across the whole oracle.
   *
   * So the oracle was good at catching what goes MISSING and blind to what
   * gets ADDED. `sameSet` closes that half: the expected set is derived from
   * § 7's problem-code table — which condition produces which code at which
   * severity — and anything beyond it is a failure, not a tolerated extra.
   *
   * Order-insensitive on purpose: § 9 pins doctor's problem *shape*, and the
   * ordering question belongs to `edge/order-doctor-problems-severity.js`.
   */
  sameSet(desc, actual, expected) {
    const a = [...actual].map(String).sort();
    const e = [...expected].map(String).sort();
    if (a.length === e.length && a.every((v, i) => v === e[i])) return this.check(desc, true);
    const missing = e.filter(v => !a.includes(v));
    const extra = a.filter(v => !e.includes(v));
    return this.check(desc, false,
      (missing.length ? 'MISSING    ' + JSON.stringify(missing) + '\n     ' : '') +
      (extra.length ? 'UNEXPECTED ' + JSON.stringify(extra) + '\n     ' : '') +
      'expected ' + JSON.stringify(e) + '\n     got      ' + JSON.stringify(a));
  },

  finish() {
    const name = this._name;
    if (this._failures.length === 0) {
      console.log('PASS ' + name + ' (' + this._checks + ' checks)');
      cleanup();
      process.exit(0);
    }
    console.log('FAIL ' + name + ' — ' + this._failures.length + ' of ' + this._checks + ' checks failed');
    for (const f of this._failures) {
      console.log('  ✗ ' + f.desc);
      if (f.detail) console.log('    ' + f.detail);
    }
    cleanup();
    process.exit(1);
  },
};

function trunc(s, n) {
  s = String(s);
  n = n || 400;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** First differing line, with both sides — the useful part of a byte diff. */
function firstDiff(a, b) {
  const al = a.split('\n'), bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return '     first diff at line ' + (i + 1) +
        '\n     expected: ' + JSON.stringify(bl[i] === undefined ? '<EOF>' : bl[i]) +
        '\n     actual:   ' + JSON.stringify(al[i] === undefined ? '<EOF>' : al[i]);
    }
  }
  return '     (files differ only in trailing bytes)';
}

/**
 * The oracle is built before the implementation, so "nj is absent" is the
 * expected state, not an error case. Abort loudly and cleanly on the first
 * attempt to drive it, rather than letting a later readFileSync fail with an
 * unrelated ENOENT — a stack trace about a missing task file says nothing
 * about the actual situation.
 */
function abortNoImplementation(missing) {
  const name = path.basename(process.argv[1] || 'test');
  console.log('FAIL ' + name + ' — CANNOT RUN');
  console.log('  ' + missing);
  console.log('  This is the expected state before the implementation exists:' +
    ' the oracle is built first.');
  console.log('  The suite verifies the spec, not the code — there is nothing ' +
    'to check until `nj` runs.');
  cleanup();
  process.exit(1);
}

/**
 * Assert that a runnable `nj` was supplied. Call this at the top of any test
 * that spawns nj itself instead of going through runNj() — otherwise an unset
 * NJ reaches spawn() as the string "null" and the test dies with a confusing
 * spawn error instead of the clean CANNOT RUN the suite promises.
 */
function requireNj() {
  if (!NJ) abortNoImplementation('no nj path given (pass it as argv[2] or set NJ)');
  if (!fs.existsSync(NJ)) abortNoImplementation('nj not found at ' + NJ);
}

function cleanup() {
  if (process.env.NJ_KEEP === '1') return;
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

module.exports = {
  NJ, NODE, FIXED_NOW, LATER_NOW, DEFAULT_CONFIG,
  T,
  freshDir, mkBacklog, writeRaw, readInBacklog, existsInBacklog, listFiles, lsOrEmpty, readOrNull,
  requireNj,
  element, mkElement, completeBody,
  doctorSet, summaryLine,
  sha256, golden, goldenPath,
  runNj, runJson,
  fetchJson: runJson,
};
