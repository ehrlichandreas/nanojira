/* AC-60 — `nanojira show --notes=none|all|last:N` and `nanojira log --last=N`,
 * docs/SPECIFICATION.md § 9b "`show --notes` / `log --last`".
 *
 * Team task TSK-005 (feedback/scans-team): long-running tickets collect
 * 20+ notes; agents only need the latest one or two and otherwise grep the
 * `.md` file directly, bypassing the tool.
 *
 * Sections: A show default (byte-identical, no new JSON keys), B
 * `--notes=none`, C `--notes=last:N`, D `--notes=all` explicit, E
 * validation (unknown value, `last:0`, `last:-N`, validated before
 * addressing), F zero-notes element (no-op regardless of mode), G
 * `last:N` at or above the real count (no truncation banner), H
 * multi-line note fidelity under truncation, I duplicate_id — each entry
 * projected independently, J log default (byte-identical), K `log
 * --last=N` (tail of any event kind + `events_total`), L `--last`
 * validation, M a hand-edited malformed note line is dropped under
 * `--notes=none`/`last:N` exactly as `log` already drops it, N
 * duplicate_id `--notes=last:N` in the HUMAN form, O `--file=`
 * addressing for both `show --notes` and `log --last`.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

interface Model { dir: string; bl: string }

function run(args: string[], o?: { cwd?: string; env?: Record<string, string> }) { return H.runNj(args, o); }
function runJ(args: string[], o?: { cwd?: string; env?: Record<string, string> }) { return H.runJson(args, o); }

function ok(r: H.RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

function model(label: string): Model {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  return { dir, bl };
}

function newEpic(x: Model, title = 'E'): string {
  const r = runJ(['new', '--type=epic', `--title=${title}`], { cwd: x.dir });
  return r.json.id;
}
function newTask(x: Model, parent: string, title = 'T'): string {
  const r = runJ(['new', '--type=task', `--parent=${parent}`, `--title=${title}`,
    '--description=d', '--acceptance=- [ ] a'], { cwd: x.dir });
  return r.json.id;
}
function addNote(x: Model, id: string, text: string): void {
  ok(run(['note', `--id=${id}`, text], { cwd: x.dir }), `note '${text}' on ${id}`);
}

/* ------------------------------------------------------------------ */
/* A. show default: byte-identical, no new JSON keys                  */
/* ------------------------------------------------------------------ */

function sectionA() {
  const x = model('a-show-default');
  const e = newEpic(x);
  const t = newTask(x, e);
  for (const n of ['one', 'two', 'three']) addNote(x, t, n);

  const human = run(['show', `--id=${t}`], { cwd: x.dir });
  T.exit('A1 plain show exits 0', human, 0);
  T.contains('A1 body prints every note untouched', human.stdout, 'one');
  T.contains('A1 body prints every note untouched (2)', human.stdout, 'two');
  T.contains('A1 body prints every note untouched (3)', human.stdout, 'three');
  T.check('A1 no truncation placeholder appears by default', !human.stdout.includes('hidden'), human.stdout);

  const r = runJ(['show', `--id=${t}`, '--json'], { cwd: x.dir });
  T.exit('A2 show --json exits 0', r, 0);
  T.check('A2 entry carries no notes key by default', !('notes' in r.json.entry), J(r.json.entry));
  T.check('A2 entry carries no notes_total key by default', !('notes_total' in r.json.entry), J(r.json.entry));
}

/* ------------------------------------------------------------------ */
/* B. --notes=none                                                     */
/* ------------------------------------------------------------------ */

function sectionB() {
  const x = model('b-notes-none');
  const e = newEpic(x);
  const t = newTask(x, e);
  for (const n of ['alpha', 'bravo', 'charlie']) addNote(x, t, n);

  const human = run(['show', `--id=${t}`, '--notes=none'], { cwd: x.dir });
  T.exit('B1 show --notes=none exits 0', human, 0);
  T.check('B1 real note text is hidden', !human.stdout.includes('alpha') && !human.stdout.includes('bravo') && !human.stdout.includes('charlie'), human.stdout);
  T.contains('B1 placeholder names the total hidden', human.stdout, '(3 notes hidden');
  T.contains('B1 Notes heading itself still prints', human.stdout, '## Notes');

  const r = runJ(['show', `--id=${t}`, '--notes=none', '--json'], { cwd: x.dir });
  T.exit('B2 show --notes=none --json exits 0', r, 0);
  T.eq('B2 entry.notes is empty', r.json.entry.notes, []);
  T.eq('B2 entry.notes_total is the real count', r.json.entry.notes_total, 3);
}

/* ------------------------------------------------------------------ */
/* C. --notes=last:N                                                   */
/* ------------------------------------------------------------------ */

function sectionC() {
  const x = model('c-notes-last-n');
  const e = newEpic(x);
  const t = newTask(x, e);
  for (const n of ['n1', 'n2', 'n3', 'n4']) addNote(x, t, n);

  const human = run(['show', `--id=${t}`, '--notes=last:2'], { cwd: x.dir });
  T.exit('C1 show --notes=last:2 exits 0', human, 0);
  T.check('C1 earlier notes are hidden', !human.stdout.includes('n1') && !human.stdout.includes('n2'), human.stdout);
  T.contains('C1 the last 2 notes still print, in order', human.stdout, 'n3');
  T.contains('C1 the last 2 notes still print, in order (n4 after n3)', human.stdout.slice(human.stdout.indexOf('n3')), 'n4');
  T.contains('C1 placeholder names how many are hidden', human.stdout, '(2 earlier notes hidden');

  const r = runJ(['show', `--id=${t}`, '--notes=last:2', '--json'], { cwd: x.dir });
  T.exit('C2 show --notes=last:2 --json exits 0', r, 0);
  T.eq('C2 entry.notes keeps exactly the last 2, in order', r.json.entry.notes.map((n: any) => n.text), ['n3', 'n4']);
  T.eq('C2 entry.notes_total is the real, unfiltered count', r.json.entry.notes_total, 4);

  // --notes=last:1, the common "just the newest" case.
  const r1 = runJ(['show', `--id=${t}`, '--notes=last:1', '--json'], { cwd: x.dir });
  T.eq('C3 --notes=last:1 keeps exactly the newest', r1.json.entry.notes.map((n: any) => n.text), ['n4']);
}

/* ------------------------------------------------------------------ */
/* D. --notes=all, given explicitly                                    */
/* ------------------------------------------------------------------ */

function sectionD() {
  const x = model('d-notes-all-explicit');
  const e = newEpic(x);
  const t = newTask(x, e);
  addNote(x, t, 'only one');

  const human = run(['show', `--id=${t}`, '--notes=all'], { cwd: x.dir });
  const humanDefault = run(['show', `--id=${t}`], { cwd: x.dir });
  T.eq('D1 --notes=all human output is identical to the default', human.stdout, humanDefault.stdout);

  const r = runJ(['show', `--id=${t}`, '--notes=all', '--json'], { cwd: x.dir });
  T.exit('D2 show --notes=all --json exits 0', r, 0);
  T.eq('D2 entry.notes is the full list, unlike the omitted-flag default', r.json.entry.notes.map((n: any) => n.text), ['only one']);
  T.eq('D2 entry.notes_total', r.json.entry.notes_total, 1);
}

/* ------------------------------------------------------------------ */
/* E. validation                                                       */
/* ------------------------------------------------------------------ */

function sectionE() {
  const x = model('e-notes-validation');
  const e = newEpic(x);
  const t = newTask(x, e);

  {
    const r = runJ(['show', `--id=${t}`, '--notes=bogus', '--json'], { cwd: x.dir });
    T.exit('E1 unknown --notes value: exit 1', r, 1);
    T.eq('E1 error code is invalid_value', r.json.error, 'invalid_value');
    T.contains('E1 hint lists the known values', r.json.hint, 'none');
    T.contains('E1 hint lists the known values (2)', r.json.hint, 'all');
    T.contains('E1 hint lists the known values (3)', r.json.hint, 'last:N');
  }
  {
    // Close to a real value ('al' -> 'all') -- did-you-mean reused from
    // suggest.ts, the same machinery --fields already uses (§ 9).
    const r = runJ(['show', `--id=${t}`, '--notes=al', '--json'], { cwd: x.dir });
    T.exit('E2 near-miss --notes value: exit 1', r, 1);
    T.contains('E2 hint suggests the close value', r.json.hint, "did you mean 'all'?");
  }
  {
    const r = runJ(['show', `--id=${t}`, '--notes=last:0', '--json'], { cwd: x.dir });
    T.exit('E3 --notes=last:0: exit 1', r, 1);
    T.eq('E3 error code is invalid_value', r.json.error, 'invalid_value');
  }
  {
    const r = runJ(['show', `--id=${t}`, '--notes=last:-3', '--json'], { cwd: x.dir });
    T.exit('E4 --notes=last:-3: exit 1', r, 1);
    T.eq('E4 error code is invalid_value', r.json.error, 'invalid_value');
  }
  {
    const r = runJ(['show', `--id=${t}`, '--notes=last:abc', '--json'], { cwd: x.dir });
    T.exit('E5 --notes=last:abc (non-numeric N): exit 1', r, 1);
    T.eq('E5 error code is invalid_value', r.json.error, 'invalid_value');
  }
  {
    // Validated before addressing even resolves (§ 9 "a bad value writes/
    // reads nothing"): a bad --notes value wins over a --id that does not
    // exist, same ordering discipline every other flag-value check has.
    const r = runJ(['show', '--id=TSK-999', '--notes=bogus', '--json'], { cwd: x.dir });
    T.eq('E6 bad --notes beats an unresolved --id', r.json.error, 'invalid_value');
  }
}

/* ------------------------------------------------------------------ */
/* F. zero-notes element: a no-op regardless of mode                   */
/* ------------------------------------------------------------------ */

function sectionF() {
  const x = model('f-zero-notes');
  const e = newEpic(x);

  const humanDefault = run(['show', `--id=${e}`], { cwd: x.dir });
  const humanNone = run(['show', `--id=${e}`, '--notes=none'], { cwd: x.dir });
  const humanLast = run(['show', `--id=${e}`, '--notes=last:5'], { cwd: x.dir });
  T.eq('F1 --notes=none on a zero-note element is a no-op', humanNone.stdout, humanDefault.stdout);
  T.eq('F2 --notes=last:N on a zero-note element is a no-op', humanLast.stdout, humanDefault.stdout);
  T.check('F3 no Notes heading is invented', !humanNone.stdout.includes('## Notes'), humanNone.stdout);

  const r = runJ(['show', `--id=${e}`, '--notes=none', '--json'], { cwd: x.dir });
  T.eq('F4 entry.notes is empty', r.json.entry.notes, []);
  T.eq('F5 entry.notes_total is 0', r.json.entry.notes_total, 0);
}

/* ------------------------------------------------------------------ */
/* G. --notes=last:N at or above the real count: no banner             */
/* ------------------------------------------------------------------ */

function sectionG() {
  const x = model('g-last-n-no-truncation');
  const e = newEpic(x);
  const t = newTask(x, e);
  addNote(x, t, 'solo');

  const humanDefault = run(['show', `--id=${t}`], { cwd: x.dir });
  const humanLast = run(['show', `--id=${t}`, '--notes=last:10'], { cwd: x.dir });
  T.eq('G1 --notes=last:N >= total matches the default byte-for-byte', humanLast.stdout, humanDefault.stdout);
  T.check('G2 no hidden-count banner appears', !humanLast.stdout.includes('hidden'), humanLast.stdout);
}

/* ------------------------------------------------------------------ */
/* H. multi-line note fidelity under truncation                       */
/* ------------------------------------------------------------------ */

function sectionH() {
  const x = model('h-multiline-fidelity');
  const e = newEpic(x);
  const t = newTask(x, e);
  addNote(x, t, 'first note, single line');
  const multi = 'kept note\nsecond line\n\nfourth line, after a blank one';
  ok(run(['note', `--id=${t}`, multi], { cwd: x.dir }), 'multi-line note');

  const human = run(['show', `--id=${t}`, '--notes=last:1'], { cwd: x.dir });
  T.exit('H1 show --notes=last:1 exits 0', human, 0);
  T.contains('H1 first line of the kept note', human.stdout, ': kept note');
  T.contains('H1 continuation line two-space indented', human.stdout, '\n  second line\n');
  T.contains('H1 blank continuation kept as two spaces', human.stdout, '\n  \n');
  T.contains('H1 continuation after the blank line', human.stdout, '\n  fourth line, after a blank one');
  T.check('H1 the dropped note is gone', !human.stdout.includes('first note, single line'), human.stdout);

  const r = runJ(['show', `--id=${t}`, '--notes=last:1', '--json'], { cwd: x.dir });
  T.eq('H2 JSON text is byte-identical to what was written, continuation indent stripped', r.json.entry.notes[0].text, multi);
}

/* ------------------------------------------------------------------ */
/* I. duplicate_id: --notes= projects each entry independently         */
/* ------------------------------------------------------------------ */

function sectionI() {
  const el = (id: string, notes: string[]) => {
    const noteLines = notes.map((n, i) => `- 2026-09-21T18:0${i}:00Z author: ${n}`).join('\n');
    const body = notes.length > 0 ? `\n# Dup\n\n## Description\nd\n\n## Notes\n${noteLines}\n` : '\n# Dup\n\n## Description\nd\n';
    return H.element({ id, type: 'task', parent: 'EPIC-001', title: 'Dup', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, body);
  };
  const d = H.mkBacklog({
    label: 'i-duplicate-id',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, '\n# E\n\n## Description\nd\n'),
      'tasks/TSK-009.md': el('TSK-009', ['a1', 'a2', 'a3']),
      'tasks/TSK-009-dup.md': el('TSK-009', ['b1']),
    },
  });

  const r = runJ(['show', '--id=TSK-009', '--notes=last:1', '--json'], { cwd: d });
  T.exit('I1 show on a duplicate id exits 0', r, 0);
  T.eq('I1 both files are reported', r.json.entries.length, 2);
  const byTotal = [...r.json.entries].sort((a: any, b: any) => a.notes_total - b.notes_total);
  T.eq('I2 the 1-note file keeps its own single note', byTotal[0].notes.map((n: any) => n.text), ['b1']);
  T.eq('I2 the 1-note file reports its own total', byTotal[0].notes_total, 1);
  T.eq('I3 the 3-note file keeps only its own last note', byTotal[1].notes.map((n: any) => n.text), ['a3']);
  T.eq('I3 the 3-note file reports its own total', byTotal[1].notes_total, 3);
  T.check('I4 no additive top-level entry key for a duplicate_id target', !('entry' in r.json), J(Object.keys(r.json)));

  const human = run(['show', '--id=TSK-009', '--notes=none'], { cwd: d });
  T.exit('I5 duplicate_id human output exits 0', human, 0);
  T.contains('I5 both files are printed', human.stdout, 'TSK-009.md');
  T.contains('I5 both files are printed (2)', human.stdout, 'TSK-009-dup.md');
  T.check('I5 neither file leaks its real note text', !human.stdout.includes('a1') && !human.stdout.includes('b1'), human.stdout);
}

/* ------------------------------------------------------------------ */
/* J. log default: byte-identical, no events_total key                 */
/* ------------------------------------------------------------------ */

function sectionJ() {
  const x = model('j-log-default');
  const e = newEpic(x);
  const t = newTask(x, e);
  addNote(x, t, 'only note');

  const r = runJ(['log', `--id=${t}`, '--json'], { cwd: x.dir });
  T.exit('J1 plain log exits 0', r, 0);
  T.check('J1 no events_total key by default', !('events_total' in r.json), J(r.json));
  T.eq('J1 events has created + the one note', r.json.events.length, 2);
}

/* ------------------------------------------------------------------ */
/* K. log --last=N: tail of any event kind                             */
/* ------------------------------------------------------------------ */

function sectionK() {
  const x = model('k-log-last-n');
  const e = newEpic(x);
  const t = newTask(x, e);
  ok(run(['claim', `--id=${t}`, '--as=alice'], { cwd: x.dir }), 'claim');
  addNote(x, t, 'note after claim');
  ok(run(['release', `--id=${t}`, '--as=alice'], { cwd: x.dir }), 'release');

  const full = runJ(['log', `--id=${t}`, '--json'], { cwd: x.dir });
  T.eq('K0 four events total (created, claimed, note, released)', full.json.events.length, 4);

  const r = runJ(['log', `--id=${t}`, '--last=2', '--json'], { cwd: x.dir });
  T.exit('K1 log --last=2 exits 0', r, 0);
  T.eq('K1 keeps exactly the last 2 events, any kind', r.json.events.map((ev: any) => ev.kind), full.json.events.slice(-2).map((ev: any) => ev.kind));
  T.eq('K2 events_total is the real, unfiltered count', r.json.events_total, 4);

  const human = run(['log', `--id=${t}`, '--last=2'], { cwd: x.dir });
  const humanFull = run(['log', `--id=${t}`], { cwd: x.dir });
  const tailLines = humanFull.stdout.split('\n').filter((l) => l !== '');
  // The last 2 human lines of the untruncated run must equal --last=2's
  // whole output -- counting lines, not events, is deliberately avoided
  // here since a multi-line note would make them differ; this fixture's
  // events are all single-line.
  T.eq('K3 human output is the tail of the untruncated listing', human.stdout.trim(), tailLines.slice(-2).join('\n'));
}

/* ------------------------------------------------------------------ */
/* L. log --last validation                                            */
/* ------------------------------------------------------------------ */

function sectionL() {
  const x = model('l-log-last-validation');
  const e = newEpic(x);
  const t = newTask(x, e);

  for (const bad of ['0', '-3', 'abc', '']) {
    const r = runJ(['log', `--id=${t}`, `--last=${bad}`, '--json'], { cwd: x.dir });
    T.exit(`L1 log --last=${JSON.stringify(bad)}: exit 1`, r, 1);
    T.eq(`L1 error code for --last=${JSON.stringify(bad)}`, r.json.error, 'invalid_value');
  }
}

/* ------------------------------------------------------------------ */
/* M. a hand-edited malformed note line is dropped under --notes=none  */
/* and --notes=last:N, exactly as log already drops it                 */
/* ------------------------------------------------------------------ */

function sectionM() {
  const body = '\n# M\n\n## Description\nd\n\n## Notes\n'
    + '- 2026-09-21T18:00:00Z author: keep1\n'
    + '- hand-edited line with no actor separator\n'
    + '- 2026-09-21T18:02:00Z author: keep2\n';
  const d = H.mkBacklog({
    label: 'm-malformed-note-line',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, '\n# E\n\n## Description\nd\n'),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'M', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, body),
    },
  });

  const humanNone = run(['show', '--id=TSK-001', '--notes=none'], { cwd: d });
  T.exit('M1 show --notes=none exits 0', humanNone, 0);
  T.check('M1 the malformed line itself never prints', !humanNone.stdout.includes('hand-edited line'), humanNone.stdout);
  T.contains('M1 placeholder counts only the 2 well-formed notes', humanNone.stdout, '(2 notes hidden');

  const rNone = runJ(['show', '--id=TSK-001', '--notes=none', '--json'], { cwd: d });
  T.exit('M2 show --notes=none --json exits 0', rNone, 0);
  T.eq('M2 entry.notes is empty', rNone.json.entry.notes, []);
  T.eq('M2 entry.notes_total counts only the well-formed notes', rNone.json.entry.notes_total, 2);

  const humanLast = run(['show', '--id=TSK-001', '--notes=last:1'], { cwd: d });
  T.exit('M3 show --notes=last:1 exits 0', humanLast, 0);
  T.check('M3 the malformed line itself never prints', !humanLast.stdout.includes('hand-edited line'), humanLast.stdout);
  T.contains('M3 the last well-formed note still prints', humanLast.stdout, 'keep2');
  T.check('M3 the earlier well-formed note is hidden, not the malformed one', !humanLast.stdout.includes('keep1'), humanLast.stdout);

  const rLast = runJ(['show', '--id=TSK-001', '--notes=last:1', '--json'], { cwd: d });
  T.exit('M4 show --notes=last:1 --json exits 0', rLast, 0);
  T.eq('M4 entry.notes keeps only the last well-formed note', rLast.json.entry.notes.map((n: any) => n.text), ['keep2']);
  T.eq('M4 entry.notes_total counts only the well-formed notes', rLast.json.entry.notes_total, 2);
}

/* ------------------------------------------------------------------ */
/* N. duplicate_id: --notes=last:N in the HUMAN form                   */
/* ------------------------------------------------------------------ */

function sectionN() {
  const el = (id: string, notes: string[]) => {
    const noteLines = notes.map((n, i) => `- 2026-09-21T18:0${i}:00Z author: ${n}`).join('\n');
    const body = notes.length > 0 ? `\n# Dup\n\n## Description\nd\n\n## Notes\n${noteLines}\n` : '\n# Dup\n\n## Description\nd\n';
    return H.element({ id, type: 'task', parent: 'EPIC-001', title: 'Dup', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, body);
  };
  const d = H.mkBacklog({
    label: 'n-duplicate-id-last-human',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, '\n# E\n\n## Description\nd\n'),
      'tasks/TSK-009.md': el('TSK-009', ['a1', 'a2', 'a3']),
      'tasks/TSK-009-dup.md': el('TSK-009', ['b1', 'b2']),
    },
  });

  const human = run(['show', '--id=TSK-009', '--notes=last:1'], { cwd: d });
  T.exit('N1 duplicate_id human --notes=last:1 exits 0', human, 0);
  T.contains('N1 both files are printed', human.stdout, 'TSK-009.md');
  T.contains('N1 both files are printed (2)', human.stdout, 'TSK-009-dup.md');
  T.contains('N2 the 3-note file keeps only its own last note', human.stdout, 'a3');
  T.contains('N2 the 2-note file keeps only its own last note', human.stdout, 'b2');
  T.check('N3 neither file leaks an earlier note of its own', !human.stdout.includes('a1') && !human.stdout.includes('a2') && !human.stdout.includes('b1'), human.stdout);
}

/* ------------------------------------------------------------------ */
/* O. --file=<path> addressing, instead of --id=, for both commands    */
/* ------------------------------------------------------------------ */

function sectionO() {
  const x = model('o-file-addressing');
  const e = newEpic(x);
  const t = newTask(x, e);
  for (const n of ['x1', 'x2', 'x3']) addNote(x, t, n);
  const filePath = `tasks/${t}.md`;

  const viaId = runJ(['show', `--id=${t}`, '--notes=last:1', '--json'], { cwd: x.dir });
  const viaFile = runJ(['show', `--file=${filePath}`, '--notes=last:1', '--json'], { cwd: x.dir });
  T.exit('O1 show --file= --notes=last:1 exits 0', viaFile, 0);
  T.eq('O1 --file= and --id= resolve to the same projected entry', viaFile.json.entry, viaId.json.entry);

  ok(run(['claim', `--id=${t}`, '--as=alice'], { cwd: x.dir }), 'claim');

  const logViaId = runJ(['log', `--id=${t}`, '--last=2', '--json'], { cwd: x.dir });
  const logViaFile = runJ(['log', `--file=${filePath}`, '--last=2', '--json'], { cwd: x.dir });
  T.exit('O2 log --file= --last=2 exits 0', logViaFile, 0);
  T.eq('O2 --file= and --id= produce identical truncated events', logViaFile.json.events, logViaId.json.events);
  T.eq('O2 --file= reports the same events_total', logViaFile.json.events_total, logViaId.json.events_total);
}

async function main() {
  sectionA();
  sectionB();
  sectionC();
  sectionD();
  sectionE();
  sectionF();
  sectionG();
  sectionH();
  sectionI();
  sectionJ();
  sectionK();
  sectionL();
  sectionM();
  sectionN();
  sectionO();
  T.finish();
}

main().catch((e) => {
  console.log('FAIL ac-60-show-notes-last.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
