/* Edge — every `problems.ignore` example in the shipped docs is one nanojira
 * accepts.
 *
 * 4.1.0's SKILL.md gave `incomplete:acceptance` as its example for
 * `"problems": {"ignore": [...]}`. § 5/§ 15 item 50 never allowed that: only
 * warning-severity codes (§ 7's Doctor column) may be listed. Any other known
 * code makes every command but `doctor` fail with `invalid_config` (`doctor`
 * itself reports `config:invalid` and exits 2). An agent following the line
 * broke its whole backlog; nothing caught it, because no test read the docs.
 *
 * This file does: for each shipped doc (SKILL.md, references/*.md, README.md,
 * docs/GUIDE.md, docs/AGENT-INSTRUCTIONS.md) it cuts the text into blocks — a
 * fenced code block, a list item with its continuation lines, or a paragraph —
 * keeps the blocks that name `"ignore":` or `problems.ignore`, and collects
 * every code in them and in a fence right after one: a token in backticks
 * or quotes that is either code-shaped (`family:name`, digits allowed) or a
 * colon-less § 7 code such as `duplicate_id` (the vocabulary is read from
 * the spec's § 7 table). The set
 * found is pinned per doc. Each code is written alone into a scratch config,
 * and both `doctor --json` and `list --json` must accept it: no
 * `config:invalid`, no `config:unknown_code` (a misspelt example would be
 * skipped silently), no `invalid_config`. Controls show the oracle does
 * catch each kind of bad example.
 *
 * A block about ignoring that names a concrete code as a counter-example
 * would trip this too; phrase it generally ("any code that is not
 * warning-severity"), or put it outside the block.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REFS = path.join(ROOT, 'references');
const DOCS = ['SKILL.md', 'README.md', path.join('docs', 'GUIDE.md'), path.join('docs', 'AGENT-INSTRUCTIONS.md')]
  .concat(fs.existsSync(REFS) ? fs.readdirSync(REFS).filter((f) => f.endsWith('.md')).sort().map((f) => path.join('references', f)) : []);

/* Blocks: a fenced code block is one block; outside fences a blank line or
 * the start of a list item ends the block before it. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [], fenced = false;
  const flush = () => { if (cur.length) out.push(cur.join('\n')); cur = []; };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (!fenced) { flush(); fenced = true; cur.push(line); } else { cur.push(line); fenced = false; flush(); }
      continue;
    }
    if (fenced) { cur.push(line); continue; }
    if (line.trim() === '') { flush(); continue; }
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) flush();
    cur.push(line);
  }
  flush();
  return out;
}

const IGNORE_RE = /"ignore"\s*:|problems\.ignore/;

/* § 7's closed vocabulary, read from the SPECIFICATION table rows (first
 * cell: one or more backticked codes), never hard-coded here. */
const SPEC = path.join(ROOT, 'docs', 'SPECIFICATION.md');
const VOCAB: string[] = [];
{
  const spec = fs.readFileSync(SPEC, 'utf8');
  const s7 = spec.slice(spec.search(/^## 7\. /m), spec.search(/^## 8\. /m));
  for (const row of s7.split('\n').filter((l) => /^\| `/.test(l))) {
    for (const m of row.split('|')[1].matchAll(/`([^`]+)`/g)) if (VOCAB.indexOf(m[1]) === -1) VOCAB.push(m[1]);
  }
}
T.check('§ 7 vocabulary read from the spec (at least 40 codes)', VOCAB.length >= 40, String(VOCAB.length));
for (const c of ['duplicate_id', 'active_refs_archived', 'title:h1_mismatch', 'done:open_acceptance']) {
  T.check('§ 7 vocabulary includes ' + c, VOCAB.indexOf(c) !== -1, J(VOCAB));
}

/* A token right inside backticks, double or single quotes (lookarounds, so one
 * pair's closing quote is never taken as the next pair's opening one). It
 * counts as a code when it is code-shaped (`family:name`, digits allowed;
 * a misspelt one is still collected and then fails as config:unknown_code)
 * or when it is a § 7 code without a colon (`duplicate_id`). */
const TOKEN_RE = /(?<=[`"'])[a-z0-9_]+(?::[a-z0-9_]+)?(?=[`"'])/g;
function isCode(t: string): boolean { return t.indexOf(':') !== -1 || VOCAB.indexOf(t) !== -1; }

/* A block that names the ignore list, plus the fenced block right after it
 * (blank lines between are fine): "add it to `problems.ignore`:" followed by
 * a ```json fence that holds only the array would otherwise be a block of
 * its own without the word "ignore" in it. */
function ignoreExamples(text: string): string[] {
  const codes: string[] = [];
  const bs = blocks(text);
  for (let i = 0; i < bs.length; i++) {
    if (!IGNORE_RE.test(bs[i])) continue;
    const scope = [bs[i]];
    if (i + 1 < bs.length && /^\s*```/.test(bs[i + 1])) scope.push(bs[i + 1]);
    for (const b of scope) for (const m of b.matchAll(TOKEN_RE)) if (isCode(m[0]) && codes.indexOf(m[0]) === -1) codes.push(m[0]);
  }
  return codes;
}

/* The extractor itself, so a fixed doc cannot make this file vacuous. */
T.eq('extractor: finds the code in a list item continued on the next line (4.1.0 SKILL.md)',
  ignoreExamples('- **Noisy warnings?** `"problems": {"ignore": [<codes>]}` in `.nanojira/config.json` silences\n' +
    '  warning-level `_problems` codes (e.g. `incomplete:acceptance`) without changing the data.\n' +
    '- **Next**: `refused:children_open` is not about ignoring.\n'),
  ['incomplete:acceptance']);
T.eq('extractor: finds a quoted code in a fenced block, not the wildcard after it',
  ignoreExamples('```json\n"problems": {"ignore": ["done:open_acceptance"]}\n```\n\n' +
    'Any warning code can be listed; an `incomplete:*` code cannot.\n'),
  ['done:open_acceptance']);
T.eq('extractor: finds a § 7 code without a colon, quoted or backticked',
  ignoreExamples('`"problems": {"ignore": ["duplicate_id"]}` or `active_refs_archived`, not `problems`\n'),
  ['duplicate_id', 'active_refs_archived']);
T.eq('extractor: finds the code in a fence that follows an ignore block, blank line between',
  ignoreExamples('Add the code to `problems.ignore`:\n\n```json\n["incomplete:acceptance"]\n```\n'),
  ['incomplete:acceptance']);
T.eq('extractor: a fence after a block that does not name the ignore list is not an example',
  ignoreExamples('Mark it done:\n\n```json\n["done:open_acceptance"]\n```\n'),
  []);
T.eq('extractor: finds a single-quoted code',
  ignoreExamples("`problems.ignore` takes e.g. 'done:no_acceptance'; it's not for errors\n"),
  ['done:no_acceptance']);
T.eq('extractor: finds a code with a digit in it',
  ignoreExamples('"problems": {"ignore": ["title:h1_mismatch"]}\n'),
  ['title:h1_mismatch']);

/* Pinned exactly, per doc: an example added, dropped or no longer found
 * shows up here first. Check a new one against § 7, then update the pin. */
const EXPECTED: Record<string, string[]> = {
  'SKILL.md': ['done:open_acceptance'],
  'docs/GUIDE.md': ['unknown:status', 'config:unknown_key', 'config:unknown_code', 'done:open_acceptance'],
};
const found: { doc: string; code: string }[] = [];
const byDoc: Record<string, string[]> = {};
for (const doc of DOCS) {
  const p = path.join(ROOT, doc);
  T.check('the shipped doc exists: ' + doc, fs.existsSync(p), p);
  if (!fs.existsSync(p)) continue;
  const codes = ignoreExamples(fs.readFileSync(p, 'utf8'));
  if (codes.length) byDoc[doc.split(path.sep).join('/')] = codes;
  for (const code of codes) found.push({ doc, code });
}
T.eq('the problems.ignore examples found, per doc, are exactly the pinned set', byDoc, EXPECTED);

function configWith(codes: string[]): string {
  return JSON.stringify(Object.assign(JSON.parse(H.DEFAULT_CONFIG), { problems: { ignore: codes } }), null, 2) + '\n';
}

interface Probe { doctor: H.JsonRunResult; codes: string[] | null; list: H.JsonRunResult }
function probe(label: string, code: string): Probe {
  const dir = H.mkBacklog({ label, config: configWith([code]) });
  const doctor = H.runJson(['doctor'], { cwd: dir });
  const codes = doctor.json && Array.isArray(doctor.json.problems) ? doctor.json.problems.map((p: { code: string }) => p.code) : null;
  return { doctor, codes, list: H.runJson(['list'], { cwd: dir }) };
}

function accepted(desc: string, code: string): void {
  const r = probe('ignore-ex', code);
  T.exit(desc + ': doctor exit 0', r.doctor, 0);
  T.check(desc + ': doctor reports no config:invalid', r.codes !== null && r.codes.indexOf('config:invalid') === -1, r.doctor.stdout);
  T.check(desc + ': doctor reports no config:unknown_code (the example is a real code)',
    r.codes !== null && r.codes.indexOf('config:unknown_code') === -1, r.doctor.stdout);
  T.exit(desc + ': list exit 0', r.list, 0);
  T.check(desc + ': list is not invalid_config', !!r.list.json && r.list.json.ok !== false, r.list.stdout + r.list.stderr);
}

/* Controls: the oracle above does tell each kind of bad example apart. */
for (const code of ['incomplete:acceptance', 'duplicate_id', 'active_refs_archived']) {
  const r = probe('ignore-ctl', code);
  T.check('control: ignoring ' + code + ' is config:invalid in doctor', r.codes !== null && r.codes.indexOf('config:invalid') !== -1, r.doctor.stdout);
  T.eq('control: ignoring ' + code + ' makes list fail with invalid_config', r.list.json && r.list.json.error, 'invalid_config');
}
{
  const r = probe('ignore-ctl', 'done:open_acceptanc');
  T.check('control: a misspelt code (done:open_acceptanc) is config:unknown_code in doctor',
    r.codes !== null && r.codes.indexOf('config:unknown_code') !== -1, r.doctor.stdout);
  T.exit('control: a misspelt code still lets list run (it is only a warning)', r.list, 0);
}

for (const f of found) accepted(f.doc + ' example ' + f.code, f.code);

T.finish();
