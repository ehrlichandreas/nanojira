/* AC-59 — Write-command `--fields`/`--quiet` and `nanojira note`'s
 * `--text`/`--text-file`, docs/SPECIFICATION.md § 9 "`--fields` / `--quiet`"
 * and § 10 `nanojira note`.
 *
 * Team tasks TSK-004 (scans/feedback) and TSK-006: `--fields=<a,b,...>` and
 * `--quiet` on new/set/note/check/claim/release, and `note --text=`/
 * `--text-file=<path|->` alongside the existing positional text.
 *
 * Sections: A `--fields` projection content and ordering, B unknown
 * `--fields` name rejected before any write, C `--fields`+`--quiet`
 * conflict, D both require `--json`, E `--quiet` shape (incl. non-empty
 * `_problems` kept), F `--quiet` on `claim` drops claim-specific extras
 * too, G batch (`--id=A,B,C`) trimming — success trimmed, failure
 * untouched, H error output is never trimmed, I default output is
 * unaffected (regression guard), J `--input` rejects `--quiet`/`--fields`,
 * K–R `note --text`/`--text-file`.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

interface Model { dir: string; bl: string }

function run(args: string[], o?: { cwd?: string; input?: string }) { return H.runNj(args, o); }
function runJ(args: string[], o?: { cwd?: string; input?: string }) { return H.runJson(args, o); }

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

function noteBody(x: Model, id: string): string {
  const folder = id.startsWith('EPIC-') ? 'epics' : id.startsWith('TSK-') ? 'tasks' : 'subtasks';
  return fs.readFileSync(path.join(x.bl, folder, id + '.md'), 'utf8');
}

/* ------------------------------------------------------------------ */
/* A. `--fields` projection content and ordering                       */
/* ------------------------------------------------------------------ */

function sectionA() {
  const x = model('a-fields-projection');
  const e = newEpic(x);
  const t = newTask(x, e);

  {
    const r = runJ(['set', `--id=${t}`, '--status=doing', '--fields=id,status'], { cwd: x.dir });
    T.exit('A1 set --fields=id,status exits 0', r, 0);
    T.eq('A1 entry has exactly {id, status}, in that order', Object.keys(r.json.entry), ['id', 'status']);
    T.eq('A1 entry.id', r.json.entry.id, t);
    T.eq('A1 entry.status', r.json.entry.status, 'doing');
    T.check('A1 envelope keeps changed', J(r.json.changed), J(['status']));
    T.check('A1 envelope keeps top-level _problems', Array.isArray(r.json._problems), J(r.json));
  }
  {
    // Reversed order in --fields is reflected in the projected object's
    // own key order (§ 9: "--fields projects entry... in the order given").
    const r = runJ(['set', `--id=${t}`, '--priority=high', '--fields=status,id'], { cwd: x.dir });
    T.exit('A2 set --fields=status,id exits 0', r, 0);
    T.eq('A2 entry key order follows --fields, not entryJson order', Object.keys(r.json.entry), ['status', 'id']);
  }
  {
    // A name --fields asks for that the entry does not currently carry
    // (e.g. `parent` on an epic) is simply absent, not an error and not
    // `null` — entryJson() itself never materialises it.
    const r = runJ(['set', `--id=${e}`, '--priority=low', '--fields=id,parent,priority'], { cwd: x.dir });
    T.exit('A3 set --fields naming an absent field exits 0', r, 0);
    T.eq('A3 absent field is omitted, not null', Object.keys(r.json.entry), ['id', 'priority']);
  }
}

/* ------------------------------------------------------------------ */
/* B. unknown `--fields` name: rejected before any write               */
/* ------------------------------------------------------------------ */

function sectionB() {
  const x = model('b-unknown-field');
  const e = newEpic(x);
  const t = newTask(x, e);
  const before = fs.readFileSync(path.join(x.bl, 'tasks', t + '.md'), 'utf8');

  {
    const r = runJ(['set', `--id=${t}`, '--status=doing', '--fields=bogus'], { cwd: x.dir });
    T.exit('B1 unknown --fields name: exit 1', r, 1);
    T.eq('B1 error code is invalid_value', r.json.error, 'invalid_value');
    T.check('B1 hint lists known fields', String(r.json.hint).includes('id'), J(r.json));
    const after = fs.readFileSync(path.join(x.bl, 'tasks', t + '.md'), 'utf8');
    T.eq('B1 nothing written — file byte-identical', after, before);
  }
  {
    // Close to a real name ('statuss' -> 'status', OSA distance 1 on 7
    // characters) -- did-you-mean reused from suggest.ts (§ 9).
    const r = runJ(['set', `--id=${t}`, '--status=doing', '--fields=statuss'], { cwd: x.dir });
    T.exit('B2 near-miss --fields name: exit 1', r, 1);
    T.eq('B2 error code is invalid_value', r.json.error, 'invalid_value');
    T.contains('B2 hint suggests the close field name', r.json.hint, "did you mean 'status'?");
    const after = fs.readFileSync(path.join(x.bl, 'tasks', t + '.md'), 'utf8');
    T.eq('B2 nothing written on a near-miss either', after, before);
  }
  {
    const r = runJ(['set', `--id=${t}`, '--fields='], { cwd: x.dir });
    T.exit('B3 empty --fields=: exit 1', r, 1);
    T.eq('B3 error code is invalid_value', r.json.error, 'invalid_value');
  }
}

/* ------------------------------------------------------------------ */
/* C. `--fields` + `--quiet` conflict                                  */
/* ------------------------------------------------------------------ */

function sectionC() {
  const x = model('c-fields-quiet-conflict');
  const e = newEpic(x);
  const r = runJ(['set', `--id=${e}`, '--priority=high', '--fields=id', '--quiet'], { cwd: x.dir });
  T.exit('C1 --fields with --quiet: exit 1', r, 1);
  T.eq('C1 error code is invalid_value', r.json.error, 'invalid_value');
  const show = runJ(['show', `--id=${e}`], { cwd: x.dir });
  T.eq('C1 nothing written', show.json.entry.priority, 'normal');
}

/* ------------------------------------------------------------------ */
/* D. both require `--json`                                            */
/* ------------------------------------------------------------------ */

function sectionD() {
  const x = model('d-requires-json');
  const e = newEpic(x);
  {
    const r = run(['set', `--id=${e}`, '--priority=high', '--quiet'], { cwd: x.dir });
    T.exit('D1 --quiet without --json: exit 1', r, 1);
    T.contains('D1 stderr explains --json is required', r.stderr, '--quiet requires --json');
  }
  {
    const r = run(['set', `--id=${e}`, '--priority=high', '--fields=id'], { cwd: x.dir });
    T.exit('D2 --fields without --json: exit 1', r, 1);
    T.contains('D2 stderr explains --json is required', r.stderr, '--fields requires --json');
  }
}

/* ------------------------------------------------------------------ */
/* E. `--quiet` shape                                                  */
/* ------------------------------------------------------------------ */

function sectionE() {
  const x = model('e-quiet-shape');
  const e = newEpic(x);
  const t = newTask(x, e);
  {
    const r = runJ(['set', `--id=${t}`, '--status=doing', '--quiet'], { cwd: x.dir });
    T.exit('E1 set --quiet exits 0', r, 0);
    T.eq('E1 shape is exactly {ok, id} (no open problems)', Object.keys(r.json).sort(), ['id', 'ok']);
    T.eq('E1 id', r.json.id, t);
    T.eq('E1 ok', r.json.ok, true);
  }
  {
    // --status=done with unticked acceptance leaves done:open_acceptance
    // (§ 9, DECISIONS 176 B) — a non-empty _problems must survive --quiet.
    const r = runJ(['set', `--id=${t}`, '--status=done', '--quiet'], { cwd: x.dir });
    T.exit('E2 set --status=done --quiet exits 0', r, 0);
    T.eq('E2 shape is {ok, id, _problems} — warnings survive --quiet', Object.keys(r.json).sort(), ['_problems', 'id', 'ok']);
    T.check('E2 _problems names done:open_acceptance', r.json._problems.includes('done:open_acceptance'), J(r.json));
  }
  {
    // A no-op write (nothing changed) still gets the minimal shape, and an
    // empty _problems is dropped exactly as a non-empty one is kept.
    const t2 = newTask(x, e, 'T2');
    runJ(['set', `--id=${t2}`, '--status=doing'], { cwd: x.dir });
    const r = runJ(['set', `--id=${t2}`, '--status=doing', '--quiet'], { cwd: x.dir });
    T.exit('E3 no-op set --quiet exits 0', r, 0);
    T.eq('E3 no-op shape is exactly {ok, id}', Object.keys(r.json).sort(), ['id', 'ok']);
  }
}

/* ------------------------------------------------------------------ */
/* F. `--quiet` on `claim`: drops claim-specific extras too             */
/* ------------------------------------------------------------------ */

function sectionF() {
  const x = model('f-quiet-claim');
  const e = newEpic(x);
  const t = newTask(x, e);
  const r = runJ(['claim', `--id=${t}`, '--as=agent-1', '--quiet'], { cwd: x.dir });
  T.exit('F1 claim --quiet exits 0', r, 0);
  T.eq('F1 shape is exactly {ok, id} — claim/changed dropped too', Object.keys(r.json).sort(), ['id', 'ok']);

  const rel = runJ(['release', `--id=${t}`, '--as=agent-1', '--quiet'], { cwd: x.dir });
  T.exit('F2 release --quiet exits 0', rel, 0);
  T.eq('F2 shape is exactly {ok, id}', Object.keys(rel.json).sort(), ['id', 'ok']);
}

/* ------------------------------------------------------------------ */
/* G. batch: success trimmed, failure untouched                        */
/* ------------------------------------------------------------------ */

function sectionG() {
  const x = model('g-batch-trim');
  const e = newEpic(x);
  const t1 = newTask(x, e, 'T1');
  const t2 = newTask(x, e, 'T2');
  {
    const r = runJ(['set', `--id=${t1},${t2}`, '--priority=high', '--quiet'], { cwd: x.dir });
    T.exit('G1 batch set --quiet exits 0', r, 0);
    T.eq('G1 two results', r.json.results.length, 2);
    for (const item of r.json.results) T.eq('G1 each success item is exactly {id, ok}', Object.keys(item).sort(), ['id', 'ok']);
  }
  {
    // One real id, one that does not exist: a per-ID preflight failure,
    // reported in full even under --quiet (§ 9 "Error output is never
    // trimmed").
    const r = runJ(['set', `--id=${t1},TSK-999`, '--priority=low', '--quiet'], { cwd: x.dir });
    T.exit('G2 batch with one bad id: exit 1', r, 1);
    T.eq('G2 only the failing id is listed (preflight abort)', r.json.results.length, 1);
    T.eq('G2 failing item keeps its full shape', Object.keys(r.json.results[0]).sort(), ['error', 'id', 'ok']);
    T.eq('G2 failing item error', r.json.results[0].error, 'not_found');
  }
  {
    const r = runJ(['set', `--id=${t1},${t2}`, '--priority=urgent', '--fields=id,priority'], { cwd: x.dir });
    T.exit('G3 batch set --fields exits 0', r, 0);
    for (const item of r.json.results) T.eq('G3 each entry is projected', Object.keys(item.entry), ['id', 'priority']);
  }
}

/* ------------------------------------------------------------------ */
/* H. error output is never trimmed                                    */
/* ------------------------------------------------------------------ */

function sectionH() {
  const x = model('h-error-untrimmed');
  const e = newEpic(x);
  const t = newTask(x, e);
  ok(run(['claim', `--id=${t}`, '--as=holder'], { cwd: x.dir }), 'claim as holder');

  const withQuiet = runJ(['claim', `--id=${t}`, '--as=someone-else', '--quiet'], { cwd: x.dir });
  const withoutQuiet = runJ(['claim', `--id=${t}`, '--as=someone-else'], { cwd: x.dir });
  T.exit('H1 claim steal-less attempt (--quiet): exit 1', withQuiet, 1);
  T.exit('H2 claim steal-less attempt (no flag): exit 1', withoutQuiet, 1);
  T.eq('H1 error shape is identical with or without --quiet', withQuiet.json, withoutQuiet.json);
  T.eq('H1 error code', withQuiet.json.error, 'refused:claimed');
  T.check('H1 hint present', typeof withQuiet.json.hint === 'string' && withQuiet.json.hint.length > 0, J(withQuiet.json));

  const withFields = runJ(['claim', `--id=${t}`, '--as=someone-else', '--fields=id'], { cwd: x.dir });
  T.eq('H3 error shape is identical with --fields too', withFields.json, withoutQuiet.json);
}

/* ------------------------------------------------------------------ */
/* I. default output: unaffected (regression guard)                    */
/* ------------------------------------------------------------------ */

function sectionI() {
  const x = model('i-default-unaffected');
  const e = newEpic(x);
  const t = newTask(x, e);
  const r = runJ(['set', `--id=${t}`, '--status=doing'], { cwd: x.dir });
  T.exit('I1 plain set exits 0', r, 0);
  T.sameSet('I1 full envelope keys, unchanged by this feature existing',
    Object.keys(r.json), ['ok', 'id', 'changed', 'entry', '_problems']);
  T.sameSet('I1 full entry keys, unchanged', Object.keys(r.json.entry),
    ['id', 'type', 'parent', 'title', 'status', 'priority', 'tags', 'depends_on', 'created', 'updated', 'file', '_problems', '_claim']);
}

/* ------------------------------------------------------------------ */
/* J. `--input` rejects `--quiet`/`--fields`                            */
/* ------------------------------------------------------------------ */

function sectionJ() {
  const x = model('j-input-rejects');
  const plan = JSON.stringify({ type: 'epic', title: 'From plan' });
  {
    const r = runJ(['new', '--input=-', '--quiet'], { cwd: x.dir, input: plan });
    T.exit('J1 new --input with --quiet: exit 1', r, 1);
    T.eq('J1 error code', r.json.error, 'invalid_value');
  }
  {
    const r = runJ(['new', '--input=-', '--fields=id'], { cwd: x.dir, input: plan });
    T.exit('J2 new --input with --fields: exit 1', r, 1);
    T.eq('J2 error code', r.json.error, 'invalid_value');
  }
}

/* ------------------------------------------------------------------ */
/* K–R. `note --text`/`--text-file`                                    */
/* ------------------------------------------------------------------ */

function sectionKR() {
  const x = model('k-note-text');
  const e = newEpic(x);

  {
    const r = runJ(['note', `--id=${e}`, '--text=hello from --text'], { cwd: x.dir });
    T.exit('K1 note --text exits 0', r, 0);
    T.contains('K1 note line carries the --text content', noteBody(x, e), 'hello from --text');
  }
  {
    const tmp = path.join(x.dir, 'note.txt');
    fs.writeFileSync(tmp, 'hello from a file\n');
    const r = runJ(['note', `--id=${e}`, `--text-file=${tmp}`], { cwd: x.dir });
    T.exit('L1 note --text-file=<path> exits 0', r, 0);
    T.contains('L1 note line carries the file content', noteBody(x, e), 'hello from a file');
  }
  {
    const r = runJ(['note', `--id=${e}`, '--text-file=-'], { cwd: x.dir, input: 'hello from stdin\n' });
    T.exit('M1 note --text-file=- (stdin) exits 0', r, 0);
    T.contains('M1 note line carries the stdin content', noteBody(x, e), 'hello from stdin');
  }
  {
    const r = runJ(['note', `--id=${e}`, 'hello positional'], { cwd: x.dir });
    T.exit('N1 positional note text still works', r, 0);
    T.contains('N1 note line carries the positional content', noteBody(x, e), 'hello positional');
  }
  const before = noteBody(x, e);
  {
    const r = runJ(['note', `--id=${e}`, 'positional text', '--text=flag text'], { cwd: x.dir });
    T.exit('O1 positional + --text together: exit 1', r, 1);
    T.eq('O1 error code', r.json.error, 'invalid_value');
    T.eq('O1 nothing written', noteBody(x, e), before);
  }
  {
    const r = runJ(['note', `--id=${e}`, 'positional text', '--text-file=-'], { cwd: x.dir, input: 'x' });
    T.exit('O2 positional + --text-file together: exit 1', r, 1);
    T.eq('O2 error code', r.json.error, 'invalid_value');
    T.eq('O2 nothing written', noteBody(x, e), before);
  }
  {
    const tmp = path.join(x.dir, 'note2.txt');
    fs.writeFileSync(tmp, 'y');
    const r = runJ(['note', `--id=${e}`, `--text=flag`, `--text-file=${tmp}`], { cwd: x.dir });
    T.exit('O3 --text + --text-file together: exit 1', r, 1);
    T.eq('O3 error code', r.json.error, 'invalid_value');
    T.eq('O3 nothing written', noteBody(x, e), before);
  }
  {
    // Multi-line text via --text is normalised and rendered exactly as
    // the positional form already is (DECISIONS 158 EV-7, § 10
    // "Multi-line text"): first line on the note line itself, every
    // following line indented two spaces.
    const r = runJ(['note', `--id=${e}`, '--text=Line one\nLine two\n\nLine four, after a blank line'], { cwd: x.dir });
    T.exit('P1 multi-line --text exits 0', r, 0);
    const body = noteBody(x, e);
    T.contains('P1 first line on the note line itself', body, ': Line one');
    T.contains('P1 continuation line two-space indented', body, '\n  Line two\n');
    T.contains('P1 blank continuation line is two spaces, not empty', body, '\n  \n');
    T.contains('P1 continuation after the blank line', body, '\n  Line four, after a blank line');
  }
  {
    const r = runJ(['note', `--id=${e}`, `--text-file=${path.join(x.dir, 'does-not-exist.txt')}`], { cwd: x.dir });
    T.exit('Q1 --text-file naming a missing path: exit 1', r, 1);
    T.eq('Q1 error code', r.json.error, 'not_found');
  }
  {
    const r = runJ(['note', `--id=${e}`, '--text='], { cwd: x.dir });
    T.exit('R1 empty --text alone: exit 1', r, 1);
    T.eq('R1 error code', r.json.error, 'missing_argument');
  }
  {
    // --quiet/--fields apply to note's own write result exactly as the
    // other five commands (§ 9).
    const r = runJ(['note', `--id=${e}`, '--text=quiet note', '--quiet'], { cwd: x.dir });
    T.exit('S1 note --quiet exits 0', r, 0);
    // `e` carries an open incomplete:description from newEpic() never
    // giving one -- confirms a non-empty _problems survives --quiet here too.
    T.eq('S1 shape keeps the open _problems warning', Object.keys(r.json).sort(), ['_problems', 'id', 'ok']);
    T.check('S1 _problems names incomplete:description', r.json._problems.includes('incomplete:description'), JSON.stringify(r.json));
  }
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
  sectionKR();
  T.finish();
}

main().catch((e) => {
  console.log('FAIL ac-59-fields-quiet-text.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
