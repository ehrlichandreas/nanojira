'use strict';
// Blindness matrix: one-part mutants of the code under test (copies) × every oracle suite.
// A suite is BLIND to a part when the mutant altered that part (hit logged) and the suite stayed green.
//
//   node run.ts <repo> [--nj=<path>] [--compare=<before.json>] [mutant …]
//
// --nj       entry point of the mutation base (default <repo>/src/nanojira.ts). The
//            code under test is that file PLUS every module beside it in
//            commands/ and core/ — the same set tools/refactor-harness/
//            baseline.ts hashes as codeSha. A base without those directories
//            (c1-baseline, or a legacy flat lib/) is simply nj alone or nj + lib/.
//            Before/after runs must share the base.
// --compare  a previous result file; aborts when its code identity differs,
//            then prints per-mutant regressions (blind gained, covering lost).
// Result file: /tmp/blind/matrix-<testDigest8>-<codeSha8>.json, header inside.
//
// Each mutant is a DIRECTORY copy (entry + commands/ + core/), because since
// the module split a lone mutated nj dies on its first require(). A needle is
// looked up in the entry and in every module and mutated where it is found; a
// needle that matches in more than one file is an error, not a hit — the
// mutant would otherwise silently change two places, or the wrong one.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const opt = (name: string): string | null => { const a = args.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const REPO_ARG = args.find(a => !a.startsWith('--'));
if (!REPO_ARG) { console.error('usage: node run.ts <repo> [--nj=<path>] [--compare=<before.json>] [mutant …]'); process.exit(2); }
const REPO: string = REPO_ARG;
const ONLY = args.filter(a => !a.startsWith('--')).slice(1);
const NODE = process.execPath;
const ROOT = '/tmp/blind';
const NJ_PATH = path.resolve(opt('nj') || path.join(REPO, 'src', 'nanojira.ts'));
const COMPARE = opt('compare');

const sha256 = (buf: string | Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

/* The code under test, keyed by its path inside a mutant directory: the entry
 * is always written as `nj`, modules as `commands/<name>.ts`/`core/<name>.ts`
 * — the layout the entry's `require('./commands/…')`/`require('./core/…')`
 * expects. A legacy flat lib/ beside NJ_PATH (an old baseline) is still read
 * under its own `lib/<name>` label, for result files recorded before the
 * restructure. */
const listMods = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(n => n.endsWith('.js') || n.endsWith('.ts')).sort() : [];
const LIB_DIR = path.join(path.dirname(NJ_PATH), 'lib');
const LIB_FILES = listMods(LIB_DIR);
const SUBDIRS: string[] = LIB_FILES.length ? [] : ['commands', 'core'];
const SUB_FILES: Record<string, string[]> = Object.assign({}, ...SUBDIRS.map(sub => ({ [sub]: listMods(path.join(path.dirname(NJ_PATH), sub)) })));
const SOURCES: Record<string, string> = Object.assign({ nj: fs.readFileSync(NJ_PATH, 'utf8') },
  ...LIB_FILES.map(n => ({ ['lib/' + n]: fs.readFileSync(path.join(LIB_DIR, n), 'utf8') })),
  ...SUBDIRS.flatMap(sub => SUB_FILES[sub].map(n => ({ [sub + '/' + n]: fs.readFileSync(path.join(path.dirname(NJ_PATH), sub, n), 'utf8') }))));

/* Byte-for-byte the identity baseline.ts codeSha() computes: one line per
 * file, entry first under its own basename, then each module dir sorted.
 * Hashing nj alone would name a 64-line entry point and miss every change
 * in its modules. */
function codeSha(): string {
  const lines = [`${sha256(fs.readFileSync(NJ_PATH))}  ${path.basename(NJ_PATH)}\n`]
    .concat(LIB_FILES.map(n => `${sha256(fs.readFileSync(path.join(LIB_DIR, n)))}  lib/${n}\n`))
    .concat(SUBDIRS.flatMap(sub => SUB_FILES[sub].map(n => `${sha256(fs.readFileSync(path.join(path.dirname(NJ_PATH), sub, n)))}  ${sub}/${n}\n`)));
  return sha256(lines.join(''));
}

// Same scope and folding as tools/refactor-harness/baseline.ts testDigest().
const DIGEST_SCOPE = ['ac', 'edge', 'fault', 'golden', 'lib', 'run-all.mjs', 'stress'];
function testDigest(testRoot: string): string {
  const files: { abs: string; rel: string }[] = [];
  const walk = (abs: string, rel: string): void => {
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

// S4: lib/*.ts are real ES modules now (import/export throughout) -- `require`
// is not a global there, so the injected helper needs `import` instead, under
// a name (`__fs`) no source file already binds. `nj` itself stays CommonJS
// (the entry point, unconverted), where `import` would be a syntax error and
// `require` is exactly right -- hence one snippet per target, not a constant.
function hitSnippet(target: string): string {
  return target === 'nj'
    ? "const __hit = (t) => { if (process.env.NJ_HITLOG) require('fs').appendFileSync(process.env.NJ_HITLOG, t + '\\n'); };\n"
    : "import * as __fs from 'fs';\nconst __hit = (t) => { if (process.env.NJ_HITLOG) __fs.appendFileSync(process.env.NJ_HITLOG, t + '\\n'); };\n";
}
const SUM = "out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);";
const SUMFIX = "out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} remaining`);";
const DOCTOR_HEAD = "const ctx = context({ lenient: true, tolerateConfig: true });\n  const findings = collectFindings(ctx);";

type Mutant = [needle: string, replacement: string, expectedCount: number];

// The measured set. name → [needle, replacement, expectedCount]. Do not edit
// between a before and an after run — add probes below instead.
const MUTANTS: Record<string, Mutant> = {
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
  'rm-dependents': ['dependents: dependents.map((d: Element) => d.id) }', "dependents: (dependents.length && __hit('rm-dependents'), []) }", 2],
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
const PROBES: Record<string, Mutant> = {
  'probe-fix-prose-reached': [SUMFIX, "__hit('probe-fix-prose-reached'); " + SUMFIX, 1],
  'probe-bare-reached': ['${counts.incomplete} incomplete`', "${(__hit('probe-bare-reached'), counts.incomplete)} incomplete`", 1],
  'probe-fix-notes-prose': ['for (const n of notes) out(`NOTE    ${n}`);', "for (const n of notes) { __hit('probe-fix-notes-prose'); }", 1],
};

/* Returns { nj: <path of the mutant's entry>, file: <file that was mutated> }. */
function build(name: string): { nj: string; file: string } {
  const found = MUTANTS[name] || PROBES[name];
  if (!found) throw new Error('unknown mutant ' + name);
  const [needle, repl, n] = found;
  const matches = Object.entries(SOURCES)
    .map(([rel, src]): [string, number] => [rel, src.split(needle).length - 1]).filter(([, c]) => c > 0);
  if (matches.length > 1) {
    throw new Error(name + ': needle matches in more than one file (' +
      matches.map(([rel, c]) => rel + '×' + c).join(', ') + ') — an error, not a hit');
  }
  const count = matches.length ? matches[0][1] : 0;
  if (count !== n) throw new Error(name + ': needle found ' + count + 'x, expected ' + n);
  const target = matches[0][0];
  const anchor = "'use strict';\n";
  if (!SOURCES[target].includes(anchor)) throw new Error(name + ': ' + target + " has no 'use strict'; line to put __hit() after");

  /* A fresh directory every time: a mutant dir left over from an earlier base
   * could still hold modules this base does not have. */
  const dir = path.join(ROOT, 'mut', name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const sub of LIB_FILES.length ? ['lib'] : SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  // The entry keeps NJ_PATH's own extension (`.ts` for src/nj.ts, none for a
  // pre-restructure `nj`): src/nj.ts now carries real TypeScript syntax
  // (parameter types), which Node's native type-stripping only applies by
  // extension -- an extensionless copy of TS-typed source is a syntax error.
  const entryExt = path.extname(NJ_PATH);
  for (const [rel, src] of Object.entries(SOURCES)) {
    const out = rel === target
      ? src.split(needle).join(repl).replace(anchor, anchor + hitSnippet(target))   // __hit() lives in the mutated file
      : src;
    fs.writeFileSync(path.join(dir, rel === 'nj' ? 'nj' + entryExt : rel), out);
  }
  return { nj: path.join(dir, 'nj' + entryExt), file: target };
}

function suites(): string[] {
  const out: string[] = [];
  for (const d of ['ac', 'fault', 'edge']) {
    for (const f of fs.readdirSync(path.join(REPO, 'test', d)).sort()) if (f.endsWith('.mjs')) out.push(d + '/' + f);
  }
  return out;
}

interface SuiteResult {
  status: number | null;
  hits: number;
  first: string;
}

function runSuite(nj: string, mutant: string, suite: string): Promise<SuiteResult> {
  const hitDir = path.join(ROOT, 'hits', mutant);
  fs.mkdirSync(hitDir, { recursive: true });
  const hitLog = path.join(hitDir, suite.replace('/', '__') + '.log');
  try { fs.unlinkSync(hitLog); } catch { /* fresh */ }
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
      try { hits = fs.readFileSync(hitLog, 'utf8').split('\n').filter(Boolean).length; } catch { /* none */ }
      resolve({ status: code, hits, first: (out.split('\n')[0] || '').slice(0, 120) });
    });
  });
}

async function pool<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k]); }
  }));
  return results;
}

const classify = (row: Record<string, SuiteResult>): { blind: string[]; covering: string[] } => {
  const blind: string[] = [], covering: string[] = [];
  for (const [s, v] of Object.entries(row)) {
    if (v.hits > 0 && v.status === 0) blind.push(s); else if (v.hits > 0) covering.push(s);
  }
  return { blind, covering };
};

interface MatrixHeader {
  testDigest: string;
  codeSha256: string;
  codeFiles: number;
  njSha256: string;
  njPath: string;
  node: string;
  date: string;
  suites?: number;
}
interface MatrixResult {
  header: MatrixHeader;
  mutants: Record<string, Record<string, SuiteResult>>;
}

(async () => {
  const header: MatrixHeader = {
    testDigest: testDigest(path.join(REPO, 'test')),
    codeSha256: codeSha(),
    codeFiles: Object.keys(SOURCES).length,
    njSha256: sha256(SOURCES.nj),       // the entry alone — kept for older result files
    njPath: NJ_PATH,
    node: process.version,
    date: new Date().toISOString(),
  };
  let before: MatrixResult | null = null;
  if (COMPARE) {
    before = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
    if (!before!.header) { console.error('COMPARE ABORTED: ' + COMPARE + ' has no header — not a comparable run'); process.exit(2); }
    /* Identity is the whole code under test. A result file from before the
     * split carries only njSha256; that identifies its base completely only
     * when this base is single-file too, so it is accepted only then. */
    const same = before!.header.codeSha256
      ? before!.header.codeSha256 === header.codeSha256
      : LIB_FILES.length === 0 && before!.header.njSha256 === header.njSha256;
    if (!same) {
      const was = before!.header.codeSha256 ? 'code ' + before!.header.codeSha256.slice(0, 8)
        : 'nj ' + before!.header.njSha256.slice(0, 8) + ' (single-file, pre-split header)';
      console.error('COMPARE ABORTED: code identity differs — before ' + was + ', now code ' +
        header.codeSha256.slice(0, 8) + ' (' + header.codeFiles + ' files). Before/after must mutate the same base (--nj=<path>).');
      process.exit(2);
    }
  }
  const names = ONLY.length ? ONLY : Object.keys(MUTANTS);
  const all = suites();
  const file = path.join(ROOT, 'matrix-' + header.testDigest.slice(0, 8) + '-' + header.codeSha256.slice(0, 8) + '.json');
  const result: MatrixResult = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { header, mutants: {} };
  result.header = Object.assign({}, result.header, header, { suites: all.length });
  console.log('test digest ' + header.testDigest.slice(0, 8) + '  code ' + header.codeSha256.slice(0, 8) +
    ' (' + header.codeFiles + ' files)  suites ' + all.length + '  → ' + file);

  /* Build every mutant before running a single suite: a needle that no longer
   * matches, or matches in two files, fails here in a second — not after half
   * an hour of suites against the mutants that happened to come first. */
  const built: Record<string, { nj: string; file: string }> = {};
  for (const name of names) built[name] = build(name);
  for (const name of names) console.log('  built ' + name.padEnd(26) + '→ ' + built[name].file);

  for (const name of names) {
    const nj = built[name].nj;
    const res = await pool(all, 4, s => runSuite(nj, name, s));
    result.mutants[name] = {};
    const brokeUnhit: string[] = [];
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
