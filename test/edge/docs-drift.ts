/* Edge — the docs' mechanical facts match the shipped tool (TSK-039).
 *
 * The improvement survey (§ 9) found facts in the docs that had drifted
 * from the tool, each one a line an agent reads first: the GUIDE's MCP tool
 * list lacked `next` and `log`, both documented `init` outputs lacked
 * `TAGS.md`, the spec's `--version` passage named `3.4.0` "as of this
 * round", the ARCHITECTURE module map lacked `core/on-change.ts`, and the
 * archived-element refusal still told agents that `nanojira unarchive` was
 * "round two". Nothing caught them, because no test compared them with the
 * tool. This file does, for the facts a machine can check, and every
 * expectation comes from the tool or the tree, never from a list written
 * here:
 *
 * A. Every MCP tool list in the docs (GUIDE § 19, SPEC § 15 item 32 and
 *    § 17 "Tool surface") names exactly what the real `nanojira-mcp`
 *    answers to `tools/list`, in its order.
 * B. Every documented `init` transcript equals the output of a real `init`
 *    in a directory named `proj`, the path shortened to `…` as the docs do.
 * C. A release version named in the spec's `--version` passage or in the
 *    GUIDE's introduction equals `package.json`'s.
 * D. The ARCHITECTURE module map has a row for every module under
 *    `src/core/`, and its `commands/` row counts the files there.
 * E. The spec's closed failure vocabulary (§ 9) and the codes `src/`
 *    produces are the same set: a code the source emits but the spec does
 *    not list, or one the spec lists but no source line names, is drift.
 *    Read from both sides, so a code added with its spec line (TSK-033's
 *    `refused:symlink`, `refused:too_large`) needs no change here. A code
 *    built at run time would slip past both, so each call of an emitter
 *    (any function whose first parameter is `code: string`) must name
 *    its code as one literal (two exceptions).
 * F. Every refused:archived points at the `nanojira unarchive` call that
 *    works: the topmost archived ancestor, each archived root of an
 *    `rm --cascade` subtree, in one grammatical number; so does
 *    refused:parent_archived (new under, or set --parent to, an archived
 *    parent).
 * G. `bin/` and `dist/` hold exactly the files `tools/bundle.ts` generates
 *    (§ 18), and every "N generated files" in the spec and ARCHITECTURE
 *    counts them.
 *
 * C, D, E and G read files of the repo itself (spec, ARCHITECTURE, `src/`):
 * they guard the docs against the tree, not the tool against the spec.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
import * as MCP from '../lib/mcp-stdio.ts';
const T = H.T;

H.requireNj();
H.requireNjMcp();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GUIDE = read('docs/GUIDE.md');
const SPEC = read('docs/SPECIFICATION.md');
const ARCH = read('docs/ARCHITECTURE.md');
const VERSION: string = JSON.parse(read('package.json')).version;
const NOW = H.FIXED_NOW;

/** The backticked names in `text`, in order. */
function ticked(text: string): string[] {
  return Array.from(text.matchAll(/`([^`]+)`/g), (m) => m[1]);
}

/** The text from `start` (a regex) up to the first match of `end` after it,
 * or null if `start` is not found. */
function passage(text: string, start: RegExp, end: RegExp): string | null {
  const i = text.search(start);
  if (i === -1) return null;
  const rest = text.slice(i);
  const j = rest.slice(1).search(end);
  return j === -1 ? rest : rest.slice(0, j + 1);
}

(async () => {

/* A. MCP tool lists ------------------------------------------------------ */
{
  const dir = H.freshDir('drift-mcp');
  const env = { NJ_NOW: NOW };
  T.eq('A fixture: init', H.runNj(['init'], { cwd: dir, env }).status, 0);
  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + path.join(dir, 'backlog')], { cwd: dir, env });
  let tools: string[] = [];
  try {
    const r = await s.modernToolsList();
    tools = ((r.result || {}).tools || []).map((t: any) => t.name);
  } finally { await s.close(); }
  T.check('A the real tools/list answers (at least 10 tools)', tools.length >= 10, J(tools));
  const lists: Array<[string, string | null]> = [
    ['GUIDE § 19 "Tools:"', passage(GUIDE, /^- Tools: /m, /\*\*`rm`/)],
    ['SPEC § 15 item 32', passage(SPEC, /^32\. \*\*MCP tool surface\.\*\*/m, /; `rm` is/)],
    ['SPEC § 17 "Tool surface"', passage(SPEC, /^`tools\/list` names exactly:/m, /\n\n/)],
  ];
  for (const [where, text] of lists) {
    T.check(`A ${where}: the passage is found`, text !== null, '');
    if (text === null) continue;
    const names = ticked(text).filter((n) => n !== 'tools/list' && n !== 'nanojira-mcp');
    T.eq(`A ${where} names exactly the real tools/list, in its order`, names, tools);
  }
}

/* B. init transcripts ---------------------------------------------------- */
{
  const dir = path.join(H.freshDir('drift-init'), 'proj');
  fs.mkdirSync(dir);
  const r = H.runNj(['init'], { cwd: dir, env: { NJ_NOW: NOW } });
  T.eq('B fixture: a real init succeeds', r.status, 0);
  const real = r.stdout.split(path.join(dir, 'backlog')).join('…/proj/backlog').replace(/\n+$/, '');
  T.check('B the real init names TAGS.md (the fact that drifted)', real.includes('TAGS.md'), real);
  const docs: Array<[string, string]> = [['README.md', read('README.md')], ['docs/GUIDE.md', GUIDE]];
  for (const [rel, text] of docs) {
    const shown: string[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^\$ (bin\/)?nanojira init$/.test(lines[i])) continue;
      const out: string[] = [];
      for (let k = i + 1; k < lines.length && !/^```/.test(lines[k]) && !/^\$ /.test(lines[k]); k++) out.push(lines[k]);
      shown.push(out.join('\n'));
    }
    T.check(`B ${rel}: shows at least one init transcript`, shown.length > 0, '');
    shown.forEach((s, n) => T.eq(`B ${rel}: init transcript #${n + 1} equals a real init`, s, real));
  }
}

/* C. Versions named in the docs ------------------------------------------ */
{
  T.check('C package.json has a version', /^\d+\.\d+\.\d+$/.test(VERSION), VERSION);
  const versionPassage = passage(SPEC, /^\*\*There is exactly one version source\*\*/m, /\n\n/);
  T.check('C SPEC: the --version source passage is found', versionPassage !== null, '');
  const named = (text: string) => Array.from(text.matchAll(/(?<![\w.§])v?(\d+\.\d+(?:\.\d+)?)(?![\w.]*\d)/g), (m) => m[1]);
  if (versionPassage !== null) {
    const stale = named(versionPassage).filter((v) => v !== VERSION);
    T.eq('C SPEC --version passage names no version but package.json\'s', stale, []);
    T.check('C SPEC --version passage names the real bundles (dist/*.mjs)',
      !/`dist\/nanojira`|`dist\/nanojira-mcp`/.test(versionPassage), versionPassage);
  }
  const intro = GUIDE.slice(0, GUIDE.search(/^## /m));
  const major = VERSION.split('.').slice(0, 2).join('.');
  const staleIntro = named(intro).filter((v) => v !== VERSION && v !== major);
  T.eq('C GUIDE introduction names no release but the current one', staleIntro, []);
}

/* D. ARCHITECTURE module map --------------------------------------------- */
{
  const map = ARCH.slice(ARCH.search(/^## 2\. Module map/m), ARCH.search(/^## 3\. /m));
  T.check('D the module map section is found', map.length > 0, '');
  const rows = Array.from(map.matchAll(/^\| `core\/([^`]+\.ts)`/gm), (m) => m[1]).sort();
  const core = fs.readdirSync(path.join(ROOT, 'src', 'core')).filter((f) => f.endsWith('.ts')).sort();
  T.eq('D every src/core module has a row, and every row a module', rows, core);
  const cmdRow = /^\| `commands\/[^`]+` … `commands\/[^`]+` \((\d+) modules\)/m.exec(map);
  const cmds = fs.readdirSync(path.join(ROOT, 'src', 'commands')).filter((f) => f.endsWith('.ts'));
  T.check('D the commands/ row is found', cmdRow !== null, '');
  if (cmdRow) T.eq('D the commands/ row counts the files in src/commands', Number(cmdRow[1]), cmds.length);
}

/* E. Failure vocabulary: spec == source ---------------------------------- */
{
  const s9 = SPEC.slice(SPEC.search(/^### Failure codes — closed vocabulary/m));
  const fence = s9.slice(s9.indexOf('```') + 3, s9.indexOf('```', s9.indexOf('```') + 3));
  const spec = new Set<string>();
  let family: string | null = null; // the `refused`/`fault` line being continued
  for (const raw of fence.split('\n')) {
    const line = raw.trim();
    const m = /^(refused|fault):<\w+>\s+\w+ ∈ (.*)$/.exec(line);
    const reasons = m ? m[2] : (family !== null && /^[a-z_-]+( \| [a-z_-]+)*( \|)?$/.test(line) ? line : null);
    if (m) family = m[1];
    if (reasons !== null) {
      for (const r of reasons.split('|').map((x) => x.trim()).filter(Boolean)) spec.add(family + ':' + r);
      continue;
    }
    family = null;
    for (const w of line.split(/\s+/)) if (/^[a-z_]+$/.test(w)) spec.add(w);
  }
  for (const c of ['no_backlog', 'unexpected_argument', 'refused:claimed', 'fault:before-rename']) {
    T.check('E the spec\'s closed set is read, with ' + c, spec.has(c), J([...spec]));
  }
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  // Codes the source produces: the first argument of fail/hardExit/
  // emitFailure, an `error:` literal, and the code a Fail is built with.
  // The emitters: every function whose first parameter is `code: string`
  // (fail, hardExit, emitFailure, cmd-new's failAtPath, …), so a new one
  // is covered without an edit here. describeFinding takes a § 7 finding
  // code, not a failure code.
  const NOT_FAILURE = new Set(['describeFinding']);
  const emitters = Array.from(new Set(Array.from(src.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(\s*code:\s*string\b/g), (m) => m[1])))
    .filter((n) => !NOT_FAILURE.has(n)).sort();
  for (const n of ['emitFailure', 'fail', 'failAtPath', 'hardExit']) T.check(`E ${n} is found as an emitter`, emitters.includes(n), J(emitters));
  const CALL = `\\b(?:${emitters.join('|')})\\(\\s*`;
  const emitted = new Set<string>();
  for (const re of [new RegExp(CALL + "'([a-z_]+(?::[a-z_-]+)?)'", 'g'), /\berror: '([a-z_]+(?::[a-z_-]+)?)'/g,
    /new Fail\([^;]*?, '([a-z_]+(?::[a-z_-]+)?)'\)/g]) {
    for (const m of src.matchAll(re)) emitted.add(m[1]);
  }
  const quoted = new Set(Array.from(src.matchAll(/'([a-z_]+(?::[a-z_-]+)?)'/g), (m) => m[1]));
  // A code built at run time (`'refused:' + r`, a template literal) would
  // pass both directions above unseen, so every such call's first argument
  // must be one quoted literal, or one of the few that carry a code already
  // checked where it was made.
  const ALLOWED_FIRST = /^(?:SOURCE_CODE\[[a-z.]+\]|e\.code)\s*[,)]/;
  const dynamic: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8').split('\n').map((l) => (/^\s*(?:\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');
    for (const m of text.matchAll(new RegExp('(?<!function\\s)' + CALL, 'g'))) {
      const rest = text.slice((m.index as number) + m[0].length);
      if (/^'[a-z_]+(?::[a-z_-]+)?'\s*[,)]/.test(rest) || ALLOWED_FIRST.test(rest)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      dynamic.push(`${path.relative(ROOT, f)}:${line}: ${rest.slice(0, 40).split('\n')[0]}`);
    }
  }
  T.eq('E every emitter call names its code as one literal (or SOURCE_CODE[…], e.code)', dynamic, []);
  T.eq('E every code the source emits is in the spec\'s closed set', [...emitted].filter((c) => !spec.has(c)).sort(), []);
  T.eq('E every code in the spec\'s closed set is named in the source', [...spec].filter((c) => !quoted.has(c)).sort(), []);
}

/* F. The archived refusal's hint ----------------------------------------- */
/** Each refused:archived names the unarchive call(s) that make the target
 * writable again, in one grammatical number, and following it works. */
function archivedCase(label: string, setup: string[][], call: string[], want: { ids: string[]; not: string[]; plural: boolean }) {
  const dir = H.freshDir('drift-archived-' + label);
  const env = { NJ_NOW: NOW };
  for (const args of [['init'] as string[]].concat(setup)) {
    T.eq(`F ${label} fixture: ${args.join(' ')}`, H.runNj(args, { cwd: dir, env }).status, 0);
  }
  const files = () => H.runJson(['list', '--all', '--json'], { cwd: dir, env }).stdout;
  const before = files();
  const r = H.runJson(call.concat(['--json']), { cwd: dir, env });
  const hint = String(r.json && r.json.hint);
  T.eq(`F ${label}: refused:archived`, r.json && r.json.error, 'refused:archived');
  for (const id of want.ids) T.check(`F ${label}: the hint names \`nanojira unarchive --id=${id}\``, hint.includes('nanojira unarchive --id=' + id), hint);
  for (const id of want.not) T.check(`F ${label}: the hint does not send you to ${id}`, !hint.includes('--id=' + id + '`'), hint);
  T.check(`F ${label}: no "round one/two"`, !/round (one|two)/.test(hint) && !/round (one|two)/.test(r.stderr), hint + ' / ' + r.stderr);
  T.check(`F ${label}: one grammatical number (${want.plural ? 'plural' : 'singular'})`, want.plural
    ? /^archived elements are read-only; restore them first with /.test(hint)
    : /^an archived element is read-only; restore it first with /.test(hint), hint);
  T.eq(`F ${label}: nothing written`, files(), before);
  for (const id of want.ids) {
    T.eq(`F ${label}: following the hint, unarchive --id=${id} succeeds`, H.runNj(['unarchive', '--id=' + id], { cwd: dir, env }).status, 0);
  }
  T.eq(`F ${label}: then the refused call succeeds`, H.runNj(call, { cwd: dir, env }).status, 0);
}
const epic = ['new', '--type=epic', '--title=E', '--description=D.'];
const task = (t: string) => ['new', '--type=task', '--parent=EPIC-001', '--title=' + t, '--description=D.'];
archivedCase('set', [epic, ['set', '--id=EPIC-001', '--status=done'], ['archive', '--id=EPIC-001']],
  ['set', '--id=EPIC-001', '--title=X'], { ids: ['EPIC-001'], not: [], plural: false });
archivedCase('child', [epic, task('T'), ['set', '--id=TSK-001', '--status=done'], ['set', '--id=EPIC-001', '--status=done'],
  ['archive', '--id=EPIC-001']], ['set', '--id=TSK-001', '--title=X'], { ids: ['EPIC-001'], not: ['TSK-001'], plural: false });
archivedCase('rm-cascade-one', [epic, task('T'), ['set', '--id=TSK-001', '--status=done'], ['archive', '--id=TSK-001']],
  ['rm', '--id=EPIC-001', '--cascade'], { ids: ['TSK-001'], not: [], plural: false });
archivedCase('rm-cascade-two', [epic, task('T1'), ['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.'],
  task('T2'), task('T3'), ['set', '--id=SUB-001', '--status=done'], ['set', '--id=TSK-001', '--status=done'],
  ['set', '--id=TSK-002', '--status=done'], ['archive', '--id=TSK-001'], ['archive', '--id=TSK-002']],
  ['rm', '--id=EPIC-001', '--cascade'], { ids: ['TSK-001', 'TSK-002'], not: ['SUB-001', 'TSK-003'], plural: true });

/** refused:parent_archived (new under, or set --parent to, an archived
 * parent) says what the call would do and names the unarchive call that
 * restores the parent; following it works. */
function parentArchivedCase(label: string, setup: string[][], call: string[], want: { id: string; not: string[]; lead: RegExp }) {
  const dir = H.freshDir('drift-parent-archived-' + label);
  const env = { NJ_NOW: NOW };
  for (const args of [['init'] as string[]].concat(setup)) {
    T.eq(`F ${label} fixture: ${args.join(' ')}`, H.runNj(args, { cwd: dir, env }).status, 0);
  }
  const files = () => H.runJson(['list', '--all', '--json'], { cwd: dir, env }).stdout;
  const before = files();
  const r = H.runJson(call.concat(['--json']), { cwd: dir, env });
  const hint = String(r.json && r.json.hint);
  T.eq(`F ${label}: refused:parent_archived`, r.json && r.json.error, 'refused:parent_archived');
  T.check(`F ${label}: the hint names \`nanojira unarchive --id=${want.id}\``, hint.includes('`nanojira unarchive --id=' + want.id + '`'), hint);
  for (const id of want.not) T.check(`F ${label}: the hint does not send you to ${id}`, !hint.includes('--id=' + id + '`'), hint);
  T.check(`F ${label}: the hint is worded for this call`, want.lead.test(hint), hint);
  T.eq(`F ${label}: nothing written`, files(), before);
  T.eq(`F ${label}: following the hint, unarchive --id=${want.id} succeeds`, H.runNj(['unarchive', '--id=' + want.id], { cwd: dir, env }).status, 0);
  T.eq(`F ${label}: then the refused call succeeds`, H.runNj(call, { cwd: dir, env }).status, 0);
}
const doneEpic = [epic, ['set', '--id=EPIC-001', '--status=done'], ['archive', '--id=EPIC-001']];
parentArchivedCase('new-under', doneEpic, ['new', '--type=task', '--parent=EPIC-001', '--title=N', '--description=D.'],
  { id: 'EPIC-001', not: [], lead: /^a new child of an archived parent would at once carry archive:split; restore the parent first with / });
parentArchivedCase('set-parent', doneEpic.concat([['new', '--type=epic', '--title=E2', '--description=D.'],
  ['new', '--type=task', '--parent=EPIC-002', '--title=T', '--description=D.']]), ['set', '--id=TSK-001', '--parent=EPIC-001'],
  { id: 'EPIC-001', not: ['TSK-001', 'EPIC-002'], lead: /^an element moved under an archived parent would at once carry archive:split; restore the parent first with / });
parentArchivedCase('new-under-archived-task', [epic, task('T'), ['set', '--id=TSK-001', '--status=done'], ['set', '--id=EPIC-001', '--status=done'],
  ['archive', '--id=EPIC-001']], ['new', '--type=subtask', '--parent=TSK-001', '--title=S', '--description=D.'],
  { id: 'EPIC-001', not: ['TSK-001'], lead: /^a new child of an archived parent would at once carry archive:split; restore the parent first with `nanojira unarchive --id=EPIC-001`, its topmost archived ancestor \(§ 11a\)$/ });

/* G. "N generated files" ------------------------------------------------- */
{
  // The list is tools/bundle.ts's own: `--check` names every file it
  // generates, one line each (§ 18).
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'bundle.ts'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  const generated = Array.from(((b.stdout || '') + (b.stderr || '')).matchAll(/^bundle --check: (\S+) is /gm), (m) => m[1]).sort();
  T.check('G bundle.ts --check names its generated files (at least 2)', generated.length >= 2, J([b.status, b.stdout, b.stderr]));
  const onDisk = ['bin', 'dist'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).map((f) => d + '/' + f)).sort();
  T.eq('G bin/ and dist/ hold exactly what bundle.ts generates', onDisk, generated);
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  for (const [rel, text] of [['docs/SPECIFICATION.md', SPEC], ['docs/ARCHITECTURE.md', ARCH]] as const) {
    const said = Array.from(text.matchAll(/\b(two|three|four|five|six|seven|eight) generated files\b/g), (m) => WORDS[m[1]]);
    T.eq(`G ${rel}: every "N generated files" counts the ${generated.length} in bin/ and dist/`,
      said.filter((n) => n !== generated.length), []);
  }
}

T.finish();
})();
