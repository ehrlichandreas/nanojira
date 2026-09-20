/* AC-43 — multi-line notes, docs/SPECIFICATION.md § 10 "Multi-line text",
 * § 12c (v3.6, DECISIONS 158 EV-7, promoted: commit b7a812f).
 *
 * AC-43 (§ 15): "nj note --id=X \"$(printf 'one\\ntwo\\n\\nfour')\" writes
 * `- <ts> <author>: one` followed by three more lines — `  two`, a line
 * that is exactly two spaces, and `  four` — each indented exactly two
 * spaces; \r\n and lone \r in the given text normalise to \n first, the
 * same as every other write path. nj log --id=X --json's matching
 * event's text is exactly \"one\\ntwo\\n\\nfour\" — continuation lines
 * rejoined, indent stripped, the blank line restored empty; its human
 * line prints one, then two, a blank line, then four, each of the
 * continuation lines indented the same two spaces the file stores. nj
 * check never matches a checkbox-shaped continuation line (## Notes is
 * out of its scope entirely, § 10a, independent of indentation); nj find
 * still matches a substring anywhere in the note's text, continuation
 * lines included, as plain body text. A hand-added line directly below a
 * note that is neither empty nor two-space-indented ends that note's
 * continuation and is itself silently skipped if it doesn't start a
 * fresh note (DECISIONS 155), never merged into the note above it.
 * --as/NJ_AUTHOR reject a multi-line acting name exactly as before —
 * unaffected by any of this, since it governs the name, not the note
 * text."
 *
 * Found by an outside team (feedback/team-b-tests TSK-007): a
 * multi-line note text used to be silently flattened into one line
 * (newlines replaced by single spaces).
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult, JsonRunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

interface Fixture { dir: string; bl: string; }

function fixture(label: string): Fixture {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(H.runNj(['init'], { cwd: dir }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic', '--description=D.'], { cwd: dir, env: { NJ_NOW: H.FIXED_NOW } }), 'new epic');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--description=D.', '--acceptance=- [x] x'],
    { cwd: dir, env: { NJ_NOW: H.FIXED_NOW } }), 'new TSK-001');
  return { dir, bl };
}
function taskFile(x: Fixture): string { return path.join(x.bl, 'tasks', 'TSK-001.md'); }
function run(args: string[], cwd: string, env?: Record<string, string | undefined>): RunResult {
  return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] });
}
function runJ(args: string[], cwd: string, env?: Record<string, string | undefined>): JsonRunResult {
  return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] });
}

/* ===================================================================== */
/* M1 — the exact file shape: first line inline, each later line         */
/* indented two spaces, a blank line kept as exactly two spaces          */
/* ===================================================================== */
{
  const x = fixture('ac43-m1');
  const r = run(['note', '--id=TSK-001', 'one\ntwo\n\nfour', '--as=tracker'], x.dir);
  T.exit('M1 nj note with embedded \\n: exit 0', r, 0);
  const body = fs.readFileSync(taskFile(x), 'utf8');
  const notesIdx = body.indexOf('## Notes\n');
  T.check('M1 fixture: ## Notes exists', notesIdx !== -1, body);
  const tail = body.slice(notesIdx + '## Notes\n'.length);
  const lines = tail.split('\n');
  T.eq('M1 line 1: the note line, first text line inline', lines[0], '- ' + H.FIXED_NOW + ' tracker: one');
  T.eq('M1 line 2: "two", indented two spaces', lines[1], '  two');
  T.eq('M1 line 3: the blank line, kept as exactly two spaces', lines[2], '  ');
  T.eq('M1 line 4: "four", indented two spaces', lines[3], '  four');
}

/* ===================================================================== */
/* M2 — CRLF and a lone CR both normalise to \n                          */
/* ===================================================================== */
{
  const x = fixture('ac43-m2');
  const r = run(['note', '--id=TSK-001', 'a\r\nb\rc', '--as=tracker'], x.dir);
  T.exit('M2 nj note with CRLF and a lone CR: exit 0', r, 0);
  const body = fs.readFileSync(taskFile(x), 'utf8');
  const notesIdx = body.indexOf('## Notes\n');
  const tail = body.slice(notesIdx + '## Notes\n'.length);
  const lines = tail.split('\n');
  T.eq('M2 line 1: "a" inline', lines[0], '- ' + H.FIXED_NOW + ' tracker: a');
  T.eq('M2 line 2: "b", indented (CRLF normalised)', lines[1], '  b');
  T.eq('M2 line 3: "c", indented (lone CR normalised)', lines[2], '  c');
  T.check('M2 no raw \\r survives anywhere in the file', !body.includes('\r'), J(body));
}

/* ===================================================================== */
/* M3 — nj log --json: text is exactly the normalised multi-line string  */
/* ===================================================================== */
{
  const x = fixture('ac43-m3');
  ok(run(['note', '--id=TSK-001', 'one\ntwo\n\nfour', '--as=tracker'], x.dir), 'note');
  const r = runJ(['log', '--id=TSK-001'], x.dir);
  T.exit('M3 nj log --json: exit 0', r, 0);
  const noteEvent = ((r.json || {}).events || []).find((e: any) => e.kind === 'note');
  T.check('M3 fixture: a note event exists', !!noteEvent, J(r.json));
  T.eq('M3 the note event\'s text is exactly "one\\ntwo\\n\\nfour"', noteEvent && noteEvent.text, 'one\ntwo\n\nfour');
}

/* ===================================================================== */
/* M4 — nj log human output: each continuation line on its own line,     */
/* indented the same two spaces, never joined back into one line         */
/* ===================================================================== */
{
  const x = fixture('ac43-m4');
  ok(run(['note', '--id=TSK-001', 'one\ntwo\n\nfour', '--as=tracker'], x.dir), 'note');
  const r = run(['log', '--id=TSK-001'], x.dir);
  T.exit('M4 nj log human output: exit 0', r, 0);
  const lines = r.stdout.split('\n');
  const idx = lines.findIndex(l => l.includes('tracker: one'));
  T.check('M4 fixture: the note\'s first line is found', idx !== -1, J(r.stdout));
  T.eq('M4 next line is "  two"', lines[idx + 1], '  two');
  T.eq('M4 next line is the blank continuation ("  ")', lines[idx + 2], '  ');
  T.eq('M4 next line is "  four"', lines[idx + 3], '  four');
}

/* ===================================================================== */
/* M5 — `nj check` never matches a checkbox-shaped continuation line      */
/* ===================================================================== */
{
  const x = fixture('ac43-m5');
  ok(run(['note', '--id=TSK-001', 'see below\n- [ ] looks like a checkbox but is not one', '--as=tracker'], x.dir), 'note');
  const r = runJ(['check', '--id=TSK-001', '--text=looks like a checkbox'], x.dir);
  T.exit('M5 check --text matching only the fake checkbox in Notes: exit 1', r, 1);
  T.eq('M5 not_found (Notes is out of scope, continuation line or not)', r.json && r.json.error, 'not_found');
  const body = fs.readFileSync(taskFile(x), 'utf8');
  T.check('M5 the continuation line is untouched (still unticked, still indented)',
    body.includes('  - [ ] looks like a checkbox but is not one'), J(body));
}

/* ===================================================================== */
/* M6 — `nj find` still matches a substring inside a continuation line    */
/* ===================================================================== */
{
  const x = fixture('ac43-m6');
  ok(run(['note', '--id=TSK-001', 'first line\na very particular phrase\nthird line', '--as=tracker'], x.dir), 'note');
  const r = runJ(['find', 'a very particular phrase'], x.dir);
  T.exit('M6 nj find matching a continuation line: exit 0', r, 0);
  T.check('M6 TSK-001 is found', ((r.json || {}).entries || []).some((e: any) => e.id === 'TSK-001'), J(r.json));
}

/* ===================================================================== */
/* M7 — a hand-added line directly below a note, neither empty nor       */
/* two-space-indented, ends the continuation and is itself skipped        */
/* (not merged into the note above it)                                    */
/* ===================================================================== */
{
  const x = fixture('ac43-m7');
  ok(run(['note', '--id=TSK-001', 'the real note', '--as=tracker'], x.dir), 'note');
  const file = taskFile(x);
  const body = fs.readFileSync(file, 'utf8');
  const stray = body.replace(
    '- ' + H.FIXED_NOW + ' tracker: the real note\n',
    '- ' + H.FIXED_NOW + ' tracker: the real note\nhand-added, unindented, not a note line\n',
  );
  T.check('fixture: the stray line was actually inserted', stray !== body, '');
  fs.writeFileSync(file, stray);

  const r = runJ(['log', '--id=TSK-001'], x.dir);
  T.exit('M7 nj log: exit 0', r, 0);
  const noteEvent = ((r.json || {}).events || []).find((e: any) => e.kind === 'note');
  T.eq('M7 the note\'s own text is unaffected by the stray line below it', noteEvent && noteEvent.text, 'the real note');
  T.check('M7 the stray line produces no event of its own (silently skipped)',
    ((r.json || {}).events || []).every((e: any) => !(e.text || '').includes('hand-added')), J(r.json));
}

/* ===================================================================== */
/* M8 — --as/NJ_AUTHOR still reject a multi-line acting name, unaffected  */
/* by the note TEXT's own newline handling                                */
/* ===================================================================== */
{
  const x = fixture('ac43-m8');
  const r = runJ(['note', '--id=TSK-001', 'hello', '--as=a\nb'], x.dir);
  T.exit('M8 --as with an embedded newline: exit 1', r, 1);
  T.eq('M8 invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* M9 — no new size/line-count limit: a large multi-line note succeeds    */
/* ===================================================================== */
{
  const x = fixture('ac43-m9');
  const bigText = Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\n');
  const r = run(['note', '--id=TSK-001', bigText, '--as=tracker'], x.dir);
  T.exit('M9 a 200-line note: exit 0', r, 0);
  const rj = runJ(['log', '--id=TSK-001'], x.dir);
  const noteEvent = ((rj.json || {}).events || []).find((e: any) => e.kind === 'note');
  T.eq('M9 all 200 lines round-trip through nj log', noteEvent && noteEvent.text, bigText);
}

T.finish();
