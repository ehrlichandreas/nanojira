/* Severity vocabulary -- every problem code in SPEC § 7's closed table is
 * known to the binary, and it treats exactly the table's warning rows as
 * warnings (TSK-022, DECISIONS 211). Through `problems.ignore` only
 * warning vs. not-warning is observable; error vs. `—` is not checked here.
 *
 * `problems.ignore` (§ 5, § 7 "Validity", DECISIONS 165/166) is the one
 * place where the binary's own severity table is observable from outside
 * for EVERY code, including the backlog-level ones: a warning code is
 * accepted and suppresses its finding, any other known code is
 * `invalid_config`, and a code the binary does not know at all is the
 * warning `config:unknown_code`. A code missing from the binary's table
 * therefore shows up as `config:unknown_code`, whatever its § 7 severity.
 *
 *   A. per § 7 table row: warning -> accepted (exit 0, no
 *      config:unknown_code naming it); error or `—` -> invalid_config.
 *   B. backlog:status_stale / backlog:tags_stale are really suppressed
 *      (STATUS.md / TAGS.md deleted; the control without ignore reports
 *      both).
 *   C. static: every `word:word` literal under src/ (bar § 9's
 *      `refused:*`) has a § 7 row, every prefix among them has at least
 *      one, and § 7's "full closed list" of warning codes is exactly the
 *      table's warning rows.
 *
 * The oracle is the spec's table, read from docs/SPECIFICATION.md, so a
 * new row is covered without editing this file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = fs.readFileSync(path.join(ROOT, 'docs', 'SPECIFICATION.md'), 'utf8').split('\n');
function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
const CODE = /`([a-z0-9_]+(?::[a-z0-9_]+)?)`/g;

/* § 7's table: code -> Doctor column ('error' | 'warning' | '—'). */
const TABLE = new Map<string, string>();
{
  const start = SPEC.findIndex(l => l.startsWith('| Code | Produced by | Doctor |'));
  T.check('fixture: § 7\'s problem-code table is found', start >= 0, 'no "| Code | Produced by | Doctor |" header');
  for (const l of start >= 0 ? SPEC.slice(start + 2) : []) {
    if (!l.startsWith('|')) break;
    const cells = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    for (const m of cells[0].matchAll(CODE)) TABLE.set(m[1], cells[cells.length - 2]);
  }
  T.check('fixture: § 7\'s table has rows', TABLE.size > 30, String(TABLE.size));
}

function configWithIgnore(ignore: string[]): string {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    problems: { ignore },
  }, null, 2) + '\n';
}
const unknownCodeFor = (d: H.JsonRunResult, code: string) =>
  (d.json && Array.isArray(d.json.problems) ? d.json.problems : [])
    .filter((p: any) => p.code === 'config:unknown_code' && String(p.message).includes("'" + code + "'"));

/* ===================================================================== */
/* A — every § 7 row through problems.ignore                              */
/* ===================================================================== */
for (const [code, doctor] of TABLE) {
  const dir = H.mkBacklog({ label: 'sev-a', config: configWithIgnore([code]) });
  const l = H.runJson(['list'], { cwd: dir });
  if (doctor === 'warning') {
    T.exit('A ' + code + ' (warning) in problems.ignore: list exits 0', l, 0);
    const d = H.runJson(['doctor'], { cwd: dir });
    T.eq('A ' + code + ' (warning) in problems.ignore: no config:unknown_code for it (the binary knows it)', unknownCodeFor(d, code), []);
  } else {
    T.exit('A ' + code + ' (' + doctor + ') in problems.ignore: list exits 1', l, 1);
    T.eq('A ' + code + ' (' + doctor + ') in problems.ignore: invalid_config, not config:unknown_code', l.json && l.json.error, 'invalid_config');
  }
}
/* The other side of the oracle: a code outside § 7 is still the warning. */
{
  const dir = H.mkBacklog({ label: 'sev-a-unknown', config: configWithIgnore(['totally:bogus']) });
  const d = H.runJson(['doctor'], { cwd: dir });
  T.exit('A totally:bogus in problems.ignore: doctor exits 0', d, 0);
  T.eq('A totally:bogus in problems.ignore: exactly one config:unknown_code naming it', unknownCodeFor(d, 'totally:bogus').length, 1);
}

/* ===================================================================== */
/* B — the two stale warnings are suppressed, not just accepted           */
/* ===================================================================== */
function staleBacklog(label: string, ignore: string[] | null): string {
  const dir = H.freshDir(label);
  for (const s of [['init'], ['new', '--type=epic', '--title=E', '--description=D.', '--tags=ui']]) {
    const r = H.runNj(s, { cwd: dir });
    if (r.status !== 0) throw new Error('fixture ' + label + ': ' + s.join(' ') + ' -> ' + H.describeRun(r));
  }
  const bl = path.join(dir, 'backlog');
  if (ignore) {
    const p = path.join(bl, '.nanojira', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    cfg.problems = { ignore };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  }
  for (const f of ['STATUS.md', 'TAGS.md']) fs.rmSync(path.join(bl, f), { force: true });
  return dir;
}
const codesOf = (d: H.JsonRunResult) => (d.json && Array.isArray(d.json.problems) ? d.json.problems : []).map((p: any) => p.code).sort();
{
  const control = H.runJson(['doctor'], { cwd: staleBacklog('sev-b-control', null) });
  T.check('B control: without ignore, doctor reports backlog:status_stale', codesOf(control).includes('backlog:status_stale'), J(control.json));
  T.check('B control: without ignore, doctor reports backlog:tags_stale', codesOf(control).includes('backlog:tags_stale'), J(control.json));
  const d = H.runJson(['doctor'], { cwd: staleBacklog('sev-b', ['backlog:status_stale', 'backlog:tags_stale']) });
  T.exit('B both stale codes ignored: doctor exits 0', d, 0);
  T.eq('B both stale codes ignored: doctor reports nothing (no stale warning, no config:unknown_code)', codesOf(d), []);
}

/* ===================================================================== */
/* C — static: source literals and the closed list against the table      */
/* ===================================================================== */
{
  /* Every quoted `word:word` literal, independent of TABLE: prefixes taken
   * from the table would let a parser that drops a whole prefix group
   * (every backlog:* row, say) also drop that group from the scan, and
   * nothing would notice. `refused:*` is § 9's failure vocabulary
   * (failure-vocabulary.ts), not a § 7 problem code, and neither is a
   * real built-in import specifier like `'node:fs'` (core/kernel.ts,
   * DECISIONS 231) -- only a name `builtinModules` knows, so a code like
   * `node:stale` is still scanned; a new non-code literal of this shape
   * shows up here as a red diff and has to be listed deliberately. */
  const NOT_PROBLEM_CODES = new Set(['refused']);
  const builtin = (lit: string) => lit.startsWith('node:') && builtinModules.includes(lit.slice(5));
  const literal = /['"`]([a-z][a-z0-9_]*:[a-z][a-z0-9_]*)['"`]/g;
  const seen = new Map<string, string>();
  (function walk(d: string) {
    for (const k of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, k.name);
      if (k.isDirectory()) walk(p);
      else if (k.name.endsWith('.ts')) for (const m of fs.readFileSync(p, 'utf8').matchAll(literal)) if (!NOT_PROBLEM_CODES.has(m[1].split(':')[0]) && !builtin(m[1]) && !seen.has(m[1])) seen.set(m[1], path.relative(ROOT, p));
    }
  })(path.join(ROOT, 'src'));
  T.check('C the scan finds the source\'s codes at all', seen.size > 30, String(seen.size));
  const tablePrefixes = new Set(Array.from(TABLE.keys()).map(c => c.split(':')[0]));
  const srcPrefixes = Array.from(new Set(Array.from(seen.keys()).map(c => c.split(':')[0]))).sort();
  T.eq('C every code prefix used under src/ has at least one § 7 row', srcPrefixes.filter(x => !tablePrefixes.has(x)), []);
  const missing = Array.from(seen.keys()).filter(c => !TABLE.has(c)).sort();
  T.eq('C every code-shaped literal under src/ has a § 7 row', missing.map(c => c + ' (' + seen.get(c) + ')'), []);

  const at = SPEC.findIndex(l => l.includes('full closed list of warning-severity'));
  T.check('fixture: § 7\'s "full closed list of warning-severity codes" is found', at >= 0, 'not found');
  const end = at >= 0 ? SPEC.findIndex((l, i) => i > at && /themselves \(DECISIONS 166/.test(l)) : -1;
  const closed = new Set<string>();
  for (const l of at >= 0 && end >= 0 ? SPEC.slice(at, end + 1) : []) for (const m of l.matchAll(CODE)) if (m[1].includes(':')) closed.add(m[1]);
  const warnings = Array.from(TABLE).filter(([, d]) => d === 'warning').map(([c]) => c).sort();
  T.eq('C § 7\'s closed list of warning codes is exactly the table\'s warning rows', Array.from(closed).sort(), warnings);
}

T.finish();
