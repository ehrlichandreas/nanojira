/* AC-68 — replacing acceptance keeps the ticks of unchanged lines;
 * `acceptance_ticks_reset`; `set --add-acceptance=` (docs/SPECIFICATION.md
 * § 9; DECISIONS 223; TSK-046).
 *
 * Found by an outside team (feedback/knowledge4ai-team TSK-003), and hit
 * again by our own Lead re-scoping TSK-044: `set --acceptance=` to add one
 * criterion wrote the whole list back unticked, and nothing in the result
 * said ticks had been lost.
 *
 * Now a new line whose text after the checkbox exactly matches a ticked
 * old line stays ticked, each old ticked line used at most once. The
 * result reports `acceptance_ticks_reset: <n>` when n old ticked lines
 * were not kept, and leaves the key out otherwise. `--add-acceptance=`
 * appends one unticked line and keeps everything else as it was.
 *
 * Written before the fix: red against 0c52b90.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr) + J(r.stdout));
  return r;
}
const ENV = { NJ_NOW: H.FIXED_NOW };
function run(args: string[], cwd: string, input?: string): RunResult {
  return H.runNj(args, { cwd, env: ENV, unsetEnv: ['NJ_BACKLOG', 'NJ_ON_CHANGE'], input });
}
function runJ(args: string[], cwd: string, input?: string) {
  return H.runJson(args, { cwd, env: ENV, unsetEnv: ['NJ_BACKLOG', 'NJ_ON_CHANGE'], input });
}

/** A backlog with EPIC-001 and one task per acceptance text given. */
function fixture(label: string, acceptances: string[]): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  acceptances.forEach((a, i) => {
    const args = ['new', '--type=task', '--parent=EPIC-001', '--title=T' + (i + 1), '--description=D.'];
    ok(run(a === '' ? args : args.concat(['--acceptance=' + a]), dir), 'new task ' + (i + 1));
  });
  return dir;
}
function file(dir: string, id: string): string {
  return fs.readFileSync(path.join(dir, 'backlog', 'tasks', id + '.md'), 'utf8');
}
/** The lines of the Acceptance Criteria section, blank lines left out. */
function acceptance(dir: string, id: string): string[] {
  const lines = file(dir, id).split('\n');
  const at = lines.indexOf('## Acceptance Criteria');
  if (at === -1) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i] !== '') out.push(lines[i]);
  return out;
}
function resetOf(r: { json?: any }): unknown { return r.json && r.json.acceptance_ticks_reset; }

/* A1 — a replace keeps ticks on unchanged lines, reports the lost one */
{
  const dir = fixture('ac68-a1', ['- [x] a\n- [ ] b\n- [x] c']);
  const r = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] a\n- [ ] b\n- [ ] d'], dir);
  T.exit('A1 replace: exit 0', r, 0);
  T.eq('A1 replace: a stays ticked, b and the new d unticked', J(acceptance(dir, 'TSK-001')), J(['- [x] a', '- [ ] b', '- [ ] d']));
  T.eq('A1 replace: acceptance_ticks_reset is 1 (c)', resetOf(r), 1);
  T.check('A1 replace: changed names acceptance', r.json && J(r.json.changed) === J(['acceptance']), J(r.json && r.json.changed));
}

/* A2 — every tick kept: no key */
{
  const dir = fixture('ac68-a2', ['- [x] a\n- [ ] b']);
  const r = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] a\n- [ ] b\n- [ ] new'], dir);
  T.exit('A2 replace: exit 0', r, 0);
  T.eq('A2 replace: a stays ticked', J(acceptance(dir, 'TSK-001')), J(['- [x] a', '- [ ] b', '- [ ] new']));
  T.check('A2 replace: no acceptance_ticks_reset when nothing is lost', r.json && !('acceptance_ticks_reset' in r.json), J(r.json));
  const same = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] a\n- [ ] b\n- [ ] new'], dir);
  T.check('A2 the same text again: unchanged, ticks kept', same.json && J(same.json.changed) === '[]' && !('acceptance_ticks_reset' in same.json), J(same.json));
}

/* A3 — exact text, duplicates used once each, explicit ticks stay */
{
  const dir = fixture('ac68-a3', ['- [x] a\n- [x] a\n- [x] Case\n- [x] tail', '- [x] once\n- [ ] other']);
  const r = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] a\n- [ ] a\n- [ ] a\n- [ ] case\n- [ ] tail '], dir);
  T.eq('A3 duplicates: two old ticked a → the first two new a', J(acceptance(dir, 'TSK-001')),
    J(['- [x] a', '- [x] a', '- [ ] a', '- [ ] case', '- [ ] tail ']));
  T.eq('A3 exact match only (case, trailing space): 2 reset', resetOf(r), 2);
  const r2 = runJ(['set', '--id=TSK-002', '--acceptance=- [ ] once\n- [ ] once\n- [x] other'], dir);
  T.eq('A3 one old tick, two matching lines: only the first; an explicit tick stays', J(acceptance(dir, 'TSK-002')),
    J(['- [x] once', '- [ ] once', '- [x] other']));
  T.check('A3 nothing lost: no key', r2.json && !('acceptance_ticks_reset' in r2.json), J(r2.json));
}

/* A4 — the text after the checkbox is what matches: marker and tick style */
{
  const dir = fixture('ac68-a4', ['- [X] upper\n* [x] star']);
  runJ(['set', '--id=TSK-001', '--acceptance=1. [ ] upper\n- [ ] star'], dir);
  T.eq('A4 another list marker still matches; the old tick character is kept', J(acceptance(dir, 'TSK-001')), J(['1. [X] upper', '- [x] star']));
}

/* A5 — a checkbox inside a code fence is not a criterion, old or new */
{
  const dir = fixture('ac68-a5', ['- [x] real\n```\n- [x] fenced\n```']);
  const r = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] fenced\n```\n- [ ] real\n```'], dir);
  T.eq('A5 fences: neither line is ticked', J(acceptance(dir, 'TSK-001')), J(['- [ ] fenced', '```', '- [ ] real', '```']));
  T.eq('A5 fences: the one real tick is reset', resetOf(r), 1);
}

/* A6 — --acceptance-file, --input (array and string) */
{
  const dir = fixture('ac68-a6', ['- [x] a\n- [x] b', '- [x] a\n- [x] b', '- [x] a\n- [x] b']);
  const f = path.join(dir, 'acc.md');
  fs.writeFileSync(f, '- [ ] a\n- [ ] c\n');
  const r1 = runJ(['set', '--id=TSK-001', '--acceptance-file=' + f], dir);
  T.eq('A6 --acceptance-file: a kept', J(acceptance(dir, 'TSK-001')), J(['- [x] a', '- [ ] c']));
  T.eq('A6 --acceptance-file: 1 reset', resetOf(r1), 1);
  const r2 = runJ(['set', '--id=TSK-002', '--input=-'], dir, JSON.stringify({ acceptance: ['b', 'c'] }));
  T.eq('A6 --input array: b kept', J(acceptance(dir, 'TSK-002')), J(['- [x] b', '- [ ] c']));
  T.eq('A6 --input array: 1 reset', resetOf(r2), 1);
  const r3 = runJ(['set', '--id=TSK-003', '--input=-'], dir, JSON.stringify({ acceptance: '- [ ] a\n- [ ] b' }));
  T.eq('A6 --input string: both kept', J(acceptance(dir, 'TSK-003')), J(['- [x] a', '- [x] b']));
  T.check('A6 --input string: no key', r3.json && !('acceptance_ticks_reset' in r3.json), J(r3.json));
}

/* A7 — batch: per member */
{
  const dir = fixture('ac68-a7', ['- [x] a\n- [x] b', '- [x] a']);
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--acceptance=- [ ] a'], dir);
  T.exit('A7 batch: exit 0', r, 0);
  const res = (r.json && r.json.results) || [];
  T.eq('A7 batch: TSK-001 reports 1 reset', res[0] && res[0].acceptance_ticks_reset, 1);
  T.check('A7 batch: TSK-002 loses nothing, no key', res[1] && !('acceptance_ticks_reset' in res[1]), J(res[1]));
  T.check('A7 batch: not on the wrapper', r.json && !('acceptance_ticks_reset' in r.json), J(r.json && Object.keys(r.json)));
  T.eq('A7 batch: both keep a ticked', J([acceptance(dir, 'TSK-001'), acceptance(dir, 'TSK-002')]), J([['- [x] a'], ['- [x] a']]));
}

/* A8 — --dry-run reports the same; text mode warns on stderr */
{
  const dir = fixture('ac68-a8', ['- [x] a\n- [x] b']);
  const args = ['set', '--id=TSK-001', '--acceptance=- [ ] a\n- [ ] c'];
  const d = runJ(args.concat(['--dry-run']), dir);
  T.eq('A8 --dry-run: acceptance_ticks_reset 1', resetOf(d), 1);
  T.eq('A8 --dry-run: nothing written', J(acceptance(dir, 'TSK-001')), J(['- [x] a', '- [x] b']));
  const t = run(args, dir);
  T.exit('A8 text mode: exit 0', t, 0);
  T.check('A8 text mode: stderr says one ticked line was reset', /1 ticked acceptance line/.test(t.stderr || ''), J(t.stderr));
  const d2 = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] z', '--dry-run'], dir);
  const r2 = runJ(['set', '--id=TSK-001', '--acceptance=- [ ] z'], dir);
  T.eq('A8 --dry-run and the real call agree', J(resetOf(d2)), J(resetOf(r2)));
}

/* A9 — --add-acceptance appends one unticked line */
{
  const dir = fixture('ac68-a9', ['- [x] a\n- [ ] b', '', '- [x] a']);
  const r = runJ(['set', '--id=TSK-001', '--add-acceptance=c'], dir);
  T.exit('A9 add: exit 0', r, 0);
  T.eq('A9 add: appended, everything else as it was', J(acceptance(dir, 'TSK-001')), J(['- [x] a', '- [ ] b', '- [ ] c']));
  T.check('A9 add: changed names acceptance, no reset key', r.json && J(r.json.changed) === J(['acceptance']) && !('acceptance_ticks_reset' in r.json), J(r.json));
  const r2 = runJ(['set', '--id=TSK-002', '--add-acceptance=first'], dir);
  T.exit('A9 add to an element with no section: exit 0', r2, 0);
  T.eq('A9 add: the section is created', J(acceptance(dir, 'TSK-002')), J(['- [ ] first']));
  const r3 = runJ(['set', '--id=TSK-003', '--input=-'], dir, JSON.stringify({ 'add-acceptance': 'via input' }));
  T.exit('A9 --input add-acceptance: exit 0', r3, 0);
  T.eq('A9 --input add-acceptance: appended', J(acceptance(dir, 'TSK-003')), J(['- [x] a', '- [ ] via input']));
  const n = runJ(['set', '--id=TSK-003', '--add-acceptance=  padded  '], dir);
  T.exit('A9 add: surrounding blanks trimmed, exit 0', n, 0);
  T.eq('A9 add: trimmed', acceptance(dir, 'TSK-003').slice(-1)[0], '- [ ] padded');
  const b = runJ(['set', '--id=TSK-001,TSK-002', '--add-acceptance=both'], dir);
  T.exit('A9 batch add: exit 0', b, 0);
  T.eq('A9 batch add: each gets the line', J([acceptance(dir, 'TSK-001').slice(-1)[0], acceptance(dir, 'TSK-002').slice(-1)[0]]), J(['- [ ] both', '- [ ] both']));
}

/* A10 — refusals, nothing written */
{
  const dir = fixture('ac68-a10', ['- [x] a', '- [x] a']);
  const before = file(dir, 'TSK-001');
  const f = path.join(dir, 'acc.md');
  fs.writeFileSync(f, '- [ ] x\n');
  const cases: Array<[string, string[], string | undefined]> = [
    ['with --acceptance', ['set', '--id=TSK-001', '--acceptance=- [ ] x', '--add-acceptance=y'], undefined],
    ['with --acceptance-file', ['set', '--id=TSK-001', '--acceptance-file=' + f, '--add-acceptance=y'], undefined],
    ['both keys in --input', ['set', '--id=TSK-001', '--input=-'], JSON.stringify({ acceptance: ['x'], 'add-acceptance': 'y' })],
    ['empty text', ['set', '--id=TSK-001', '--add-acceptance=  '], undefined],
    ['a line break in the text', ['set', '--id=TSK-001', '--add-acceptance=one\ntwo'], undefined],
    ['given twice with different values', ['set', '--id=TSK-001', '--add-acceptance=y', '--add-acceptance=z'], undefined],
    ['in a batch, with --acceptance', ['set', '--id=TSK-001,TSK-002', '--acceptance=- [ ] x', '--add-acceptance=y'], undefined],
  ];
  for (const [what, args, input] of cases) {
    const r = runJ(args, dir, input);
    T.check('A10 ' + what + ': invalid_value', r.status !== 0 && r.json && r.json.error === 'invalid_value', r.status + ' ' + J(r.json));
  }
  T.eq('A10 nothing written', file(dir, 'TSK-001'), before);
}

/* A11 — set --help lists the new flag */
{
  const h = run(['set', '--help'], fixture('ac68-a11', []));
  T.check('A11 set --help lists --add-acceptance', (h.stdout || '').includes('--add-acceptance'), J(h.stdout));
}

T.finish();
