'use strict';
// Blindness matrix: one-part mutants of nj (copies) × every oracle suite.
// A suite is BLIND to a part when the mutant altered that part (hit logged) and the suite stayed green.
//
//   node run.js <repo> [--nj=<path>] [--compare=<before.json>] [mutant …]
//
// --nj       mutation base (default <repo>/nj). Before/after runs must share it.
// --compare  a previous result file; aborts when its nj sha differs, then prints
//            per-mutant regressions (blind gained, covering lost).
// Result file: /tmp/blind/matrix-<testDigest8>-<njSha8>.json, header inside.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const opt = (name) => { const a = args.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const REPO = args.find(a => !a.startsWith('--'));
const ONLY = args.filter(a => !a.startsWith('--')).slice(1);
const NODE = process.execPath;
const ROOT = '/tmp/blind';
const NJ_PATH = opt('nj') || path.join(REPO, 'nj');
const COMPARE = opt('compare');
const NJ_SRC = fs.readFileSync(NJ_PATH, 'utf8');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Same scope and folding as tools/refactor-harness/baseline.js testDigest().
const DIGEST_SCOPE = ['ac', 'edge', 'fault', 'golden', 'lib', 'run-all.js', 'stress'];
function testDigest(testRoot) {
  const files = [];
  const walk = (abs, rel) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, n), r = rel ? rel + '/' + n : n;
      if (fs.statSync(a).isDirectory()) walk(a, r); else files.push({ abs: a, rel: r });
    }
  };
  for (const entry of DIGEST_SCOPE) {
    const abs = path.join(testRoot, entry);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(abs, entry); else files.push({ abs, rel: entry });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return sha256(files.map(f => `${sha256(fs.readFileSync(f.abs))}  test/${f.rel}\n`).join(''));
}

const HIT = "const __hit = (t) => { if (process.env.NJ_HITLOG) require('fs').appendFileSync(process.env.NJ_HITLOG, t + '\\n'); };\n";
const SUM = "out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);";
const SUMFIX = "out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} remaining`);";
const DOCTOR_HEAD = "const ctx = context({ lenient: true, tolerateConfig: true });\n  const findings = collectFindings(ctx);";

// The measured set. name → [needle, replacement, expectedCount]. Do not edit
// between a before and an after run — add probes below instead.
const MUTANTS = {
  'doc-sum-warn': [SUM, SUM.replace("${warnings.length} warning${warnings.length === 1 ? '' : 's'}", "${(warnings.length && __hit('doc-sum-warn'), 0)} warnings"), 1],
  'doc-sum-err': [SUM, SUM.replace("${errors.length} error${errors.length === 1 ? '' : 's'}", "${(errors.length && __hit('doc-sum-err'), 0)} errors"), 1],
  'doc-sum-entries': [SUM, SUM.replace('${ctx.elements.length} entries', "${(ctx.elements.length && __hit('doc-sum-entries'), 0)} entries"), 1],
  'doc-prose-warnlines': [
    "for (const f of findings) {\n      const where = f.element ? f.element : path.relative(ctx.backlog, f.file);\n      const line = f.line",
    "for (const f of findings) {\n      if (f.severity === 'warning') { __hit('doc-prose-warnlines'); continue; }\n      const where = f.element ? f.element : path.relative(ctx.backlog, f.file);\n      const line = f.line", 1],
  'doc-json-nowarn': ["ok: errors.length === 0, problems: findings }", "ok: errors.length === 0, problems: findings.filter((f) => f.severity === 'error' || (__hit('doc-json-nowarn'), false)) }", 1],
  'counts-errors': ['errors: scope.filter(hasError).length,', "errors: (scope.filter(hasError).length && __hit('counts-errors'), 0),", 1],
  'counts-incomplete': ['incomplete: scope.filter(isIncomplete).length,', "incomplete: (scope.filter(isIncomplete).length && __hit('counts-incomplete'), 0),", 1],
  'counts-total': ['total: scope.length,', "total: (scope.length && __hit('counts-total'), 0),", 1],
  'write-toplevel-problems': ['_problems: entry._problems }', "_problems: (entry._problems.length && __hit('write-toplevel-problems'), []) }", 1],
  'write-feedback-warn': ['out(headline);\n  for (const code of elementProblems(el)) {', "out(headline);\n  for (const code of elementProblems(el)) { __hit('write-feedback-warn'); continue;", 1],
  'list-prose-marker': ['${arch}${problemSuffix(el)}`', "${arch}${(problemSuffix(el) && __hit('list-prose-marker'), '')}`", 1],
  'rm-dependents': ['dependents: dependents.map((d) => d.id) }', "dependents: (dependents.length && __hit('rm-dependents'), []) }", 2],
  'archive-entries': ['entries: moved.map(entryJson),', "entries: (__hit('archive-entries'), []),", 1],
  'fix-notes': ['fixed: actions, notes, problems: findings', "fixed: actions, notes: (notes.length && __hit('fix-notes'), []), problems: findings", 1],
  'fix-fixed': ['fixed: actions, notes, problems: findings', "fixed: (actions.length && __hit('fix-fixed'), []), notes, problems: findings", 1],
  'fix-prose-warn': [SUMFIX, SUMFIX.replace("${warnings.length} warning${warnings.length === 1 ? '' : 's'}", "${(warnings.length && __hit('fix-prose-warn'), 0)} warnings"), 1],
  'bare-incomplete': ['${counts.incomplete} incomplete`', "${(counts.incomplete && __hit('bare-incomplete'), 0)} incomplete`", 1],
  'read-extra-problem': ['e._problems = elementProblems(el);', "e._problems = (__hit('read-extra-problem'), elementProblems(el).concat(['unknown:priority']));", 1],
  'doc-extra-warn-dirty': [DOCTOR_HEAD, DOCTOR_HEAD + "\n  if (findings.length > 0) { __hit('doc-extra-warn-dirty'); findings.push({ code: 'title:h1_mismatch', severity: 'warning', element: ctx.elements[0].id, file: ctx.elements[0].file, message: 'spurious' }); }", 1],
  'doc-extra-warn': [DOCTOR_HEAD, DOCTOR_HEAD + "\n  if (ctx.elements.length > 0) { __hit('doc-extra-warn'); findings.push({ code: 'title:h1_mismatch', severity: 'warning', element: ctx.elements[0].id, file: ctx.elements[0].file, message: 'spurious' }); }", 1],
};

// Probes are NOT in the measured set: run only when named. A `reached` probe
// changes no output and hits unconditionally — it separates "line never
// executed" from "executed, but never under the mutant's condition".
const PROBES = {
  'probe-fix-prose-reached': [SUMFIX, "__hit('probe-fix-prose-reached'); " + SUMFIX, 1],
  'probe-bare-reached': ['${counts.incomplete} incomplete`', "${(__hit('probe-bare-reached'), counts.incomplete)} incomplete`", 1],
  'probe-fix-notes-prose': ['for (const n of notes) out(`NOTE    ${n}`);', "for (const n of notes) { __hit('probe-fix-notes-prose'); }", 1],
};

function build(name) {
  const [needle, repl, n] = MUTANTS[name] || PROBES[name] || (() => { throw new Error('unknown mutant ' + name); })();
  const count = NJ_SRC.split(needle).length - 1;
  if (count !== n) throw new Error(name + ': needle found ' + count + 'x, expected ' + n);
  let src = NJ_SRC.split(needle).join(repl);
  src = src.replace("'use strict';\n", "'use strict';\n" + HIT);
  const dir = path.join(ROOT, 'mut', name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'nj');
  fs.writeFileSync(file, src);
  return file;
}

function suites() {
  const out = [];
  for (const d of ['ac', 'fault', 'edge']) {
    for (const f of fs.readdirSync(path.join(REPO, 'test', d)).sort()) if (f.endsWith('.js')) out.push(d + '/' + f);
  }
  return out;
}

function runSuite(nj, mutant, suite) {
  const hitDir = path.join(ROOT, 'hits', mutant);
  fs.mkdirSync(hitDir, { recursive: true });
  const hitLog = path.join(hitDir, suite.replace('/', '__') + '.log');
  try { fs.unlinkSync(hitLog); } catch (e) { /* fresh */ }
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { NJ: nj, NJ_HITLOG: hitLog });
    delete env.NODE_OPTIONS;
    const child = spawn(NODE, [path.join(REPO, 'test', suite), nj], { env, cwd: REPO });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { out += c; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
    child.on('close', code => {
      clearTimeout(timer);
      let hits = 0;
      try { hits = fs.readFileSync(hitLog, 'utf8').split('\n').filter(Boolean).length; } catch (e) { /* none */ }
      resolve({ status: code, hits, first: (out.split('\n')[0] || '').slice(0, 120) });
    });
  });
}

async function pool(items, width, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k]); }
  }));
  return results;
}

const classify = (row) => {
  const blind = [], covering = [];
  for (const [s, v] of Object.entries(row)) {
    if (v.hits > 0 && v.status === 0) blind.push(s); else if (v.hits > 0) covering.push(s);
  }
  return { blind, covering };
};

(async () => {
  const header = {
    testDigest: testDigest(path.join(REPO, 'test')),
    njSha256: sha256(NJ_SRC),
    njPath: NJ_PATH,
    node: process.version,
    date: new Date().toISOString(),
  };
  let before = null;
  if (COMPARE) {
    before = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
    if (!before.header) { console.error('COMPARE ABORTED: ' + COMPARE + ' has no header — not a comparable run'); process.exit(2); }
    if (before.header.njSha256 !== header.njSha256) {
      console.error('COMPARE ABORTED: nj sha differs — before ' + before.header.njSha256.slice(0, 8) +
        ', now ' + header.njSha256.slice(0, 8) + '. Before/after must mutate the same base nj (--nj=<path>).');
      process.exit(2);
    }
  }
  const names = ONLY.length ? ONLY : Object.keys(MUTANTS);
  const all = suites();
  const file = path.join(ROOT, 'matrix-' + header.testDigest.slice(0, 8) + '-' + header.njSha256.slice(0, 8) + '.json');
  const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { header, mutants: {} };
  result.header = Object.assign({}, result.header, header, { suites: all.length });
  console.log('test digest ' + header.testDigest.slice(0, 8) + '  nj ' + header.njSha256.slice(0, 8) + '  suites ' + all.length + '  → ' + file);

  for (const name of names) {
    const nj = build(name);
    const res = await pool(all, 4, s => runSuite(nj, name, s));
    result.mutants[name] = {};
    const brokeUnhit = [];
    all.forEach((s, k) => {
      result.mutants[name][s] = res[k];
      if (res[k].hits === 0 && res[k].status !== 0) brokeUnhit.push(s + ': ' + res[k].first);
    });
    const { blind, covering } = classify(result.mutants[name]);
    console.log('=== ' + name);
    console.log('  BLIND    (' + blind.length + '): ' + (blind.map(s => s + ' (' + result.mutants[name][s].hits + ' hits)').join(', ') || '-'));
    console.log('  COVERING (' + covering.length + '): ' + (covering.join(', ') || '-'));
    if (brokeUnhit.length) console.log('  RED WITHOUT HIT (mutant side effect?): ' + brokeUnhit.join(' | '));
    if (before && before.mutants[name]) {
      const b = classify(before.mutants[name]);
      // Loosened = a suite that covered before and does not now. A suite that
      // is blind now but never reached the line before is newly EXERCISED —
      // more visibility, reported separately, never a regression.
      const lostCovering = b.covering.filter(s => !covering.includes(s));
      const newlyExercised = blind.filter(s => !b.blind.includes(s) && !b.covering.includes(s));
      const flag = lostCovering.length ? '  REGRESSION' : '  ok';
      console.log('  vs before (' + before.header.testDigest.slice(0, 8) + '): blind ' + b.blind.length + '→' + blind.length +
        ', covering ' + b.covering.length + '→' + covering.length + flag +
        (lostCovering.length ? '\n    covering lost: ' + lostCovering.join(', ') : '') +
        (newlyExercised.length ? '\n    newly exercised, blind: ' + newlyExercised.join(', ') : ''));
    } else if (before) {
      console.log('  vs before: mutant not in before-run — measured separately, not comparable');
    }
    fs.writeFileSync(file, JSON.stringify(result, null, 1));
  }
})().catch(e => { console.error(e.stack || e); process.exit(1); });
