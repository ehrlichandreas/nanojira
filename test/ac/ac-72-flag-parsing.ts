/* AC-72 — flag parsing from the flag table, one code for an empty value,
 * the full unknown_field hint (TSK-038, DECISIONS 230; docs/SPECIFICATION.md
 * § 9 "Rules").
 *
 *   V  a string flag takes `--name value` as well as `--name=value`; a
 *      value starting with `--` still needs `=`; `--name -` reads stdin;
 *      `--` ends the options; a leading `--backlog <path>` works; a
 *      boolean never takes the next token.
 *   E  a given flag with an empty value is invalid_value everywhere;
 *      missing_argument stays for a required flag that is absent.
 *   I  check --item=abc is invalid_value, not not_found.
 *   H  the unknown_field hint lists every flag the command accepts, in
 *      its documented spelling.
 *
 * Stray positionals (4.2.0's unexpected_argument, every command) and
 * `find --text=` (TSK-035) are covered by
 * test/edge/args-end-of-options-and-repeats.ts and ac-30.
 *
 * Written before the change: red against 4.4.0 with TSK-037, before TSK-038.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);
const ENV = { NJ_NOW: '2026-10-22T01:00:00Z', NJ_AUTHOR: 'Tester' };

const dir = H.freshDir('ac72');
const bl = path.join(dir, 'backlog');
/** Runs with the given argv exactly (no --json appended) and parses stdout. */
function run(args: string[], input?: string, cwd = dir) {
  const r = H.runNj(args, { cwd, env: ENV, input });
  let json: any = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return Object.assign(r, { json });
}
const code = (args: string[]) => { const r = run(args.concat(['--json'])); return r.json ? (r.json.ok === false ? r.json.error : 'OK') : 'no JSON: ' + r.stderr; };
function ok(r: ReturnType<typeof run>, what: string) {
  if (r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stdout) + J(r.stderr));
  return r;
}
ok(run(['init', '--json']), 'init');
ok(run(['new', '--type=epic', '--title=E', '--json']), 'epic');
ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=d', '--acceptance=- [ ] a', '--json']), 'task');
const taskFile = path.join(bl, 'tasks', 'TSK-001.md');

/* V — `--name value` */
{
  const r = run(['new', '--type', 'epic', '--title', 'Two words', '--json']);
  T.check('V1 new --type epic --title "Two words": created with that title', r.status === 0 && r.json?.entry?.title === 'Two words', J(r.json) + r.stderr);
  const s = run(['set', '--id', 'TSK-001', '--status', 'doing', '--json']);
  T.check('V2 set --id TSK-001 --status doing: status doing', s.status === 0 && s.json?.entry?.status === 'doing', J(s.json) + s.stderr);
  const d = run(['set', '--id', 'TSK-001', '--description-file', '-', '--json'], 'from stdin\n');
  T.check('V3 --description-file - reads stdin', d.status === 0 && fs.readFileSync(taskFile, 'utf8').includes('from stdin'), J(d.json) + d.stderr);
  const dash = run(['new', '--type=epic', '--title', '--json']);
  T.check('V4 a value starting with -- is not taken: --title is missing_value', dash.json?.error === 'missing_value', J(dash.json) + dash.stderr);
  const n = run(['note', '--id', 'TSK-001', '--as', 'Tester', '--json', '--', '--looks-like-a-flag']);
  T.check('V5 -- ends the options: note text "--looks-like-a-flag"',
    n.status === 0 && fs.readFileSync(taskFile, 'utf8').includes('--looks-like-a-flag'), J(n.json) + n.stderr);
  // A flag-table boolean never takes the next token: the word stays the search text.
  const f = run(['find', '--case-sensitive', 'Two', '--json']);
  T.check('V7 find --case-sensitive Two: the boolean leaves "Two" as the text, and finds it',
    f.status === 0 && Array.isArray(f.json?.entries) && f.json.entries.some((e: any) => e.title === 'Two words'), J(f.json) + f.stderr);
  const elsewhere = H.freshDir('ac72-cwd');
  const g = run(['--backlog', bl, 'list', '--json'], undefined, elsewhere);
  T.check('V6 a leading --backlog <path> before the command', g.status === 0 && g.json?.backlog === bl, J(g.json) + g.stderr);
  const b = run(['--backlog', bl, '--json'], undefined, elsewhere);
  T.check('V6 a leading --backlog <path> with no command (the summary)', b.status === 0 && b.json !== null && b.json.ok !== false, J(b.json) + b.stderr);
}

/* E — empty values: invalid_value; an absent required flag: missing_argument */
{
  const before = fs.readFileSync(taskFile, 'utf8');
  for (const args of [
    ['new', '--type=epic', '--title='],
    ['new', '--type=task', '--parent=', '--title=X'],
    ['new', '--type=epic', '--title=X', '--description-file='],
    ['set', '--id=', '--status=doing'],
    ['set', '--id=TSK-001', '--parent='],
    ['set', '--input='],
    ['note', '--id=TSK-001', '--text='],
    ['note', '--id=TSK-001', '--text=   '],
    ['note', '--id=TSK-001', '--text-file='],
    ['check', '--id=TSK-001', '--item='],
    ['show', '--file='],
    ['claim', '--id=TSK-001', '--steal='],
    ['list', '--tag='],
    ['list', '--parent='],
    ['list', '--backlog='],
  ]) {
    T.eq('E ' + args.join(' ') + ': invalid_value', code(args), 'invalid_value');
  }
  T.eq('E nothing written', fs.readFileSync(taskFile, 'utf8'), before);
  T.eq('E new without --title: missing_argument', code(['new', '--type=epic']), 'missing_argument');
  T.eq('E note without text: missing_argument', code(['note', '--id=TSK-001']), 'missing_argument');
  T.eq('E show without --id: missing_argument', code(['show']), 'missing_argument');
}

/* I — check --item */
{
  T.eq('I check --item=abc: invalid_value', code(['check', '--id=TSK-001', '--item=abc']), 'invalid_value');
  for (const v of ['1.5', '1.0', '+1', '1e0', '0x1']) {
    T.eq('I check --item=' + v + ': invalid_value', code(['check', '--id=TSK-001', '--item=' + v]), 'invalid_value');
  }
  T.eq('I check --item="   1" (BSD wc -l padding): ticks item 1', code(['check', '--id=TSK-001', '--item=   1']), 'OK');
  T.eq('I check --item=9 (out of range) stays not_found', code(['check', '--id=TSK-001', '--item=9']), 'not_found');
}

/* H — the unknown_field hint: every accepted flag, documented spelling */
{
  const c = run(['claim', '--id=TSK-001', '--bogus', '--json']);
  const hint = String(c.json?.hint);
  for (const f of ['--id', '--file', '--as', '--steal', '--status', '--allow-open-children', '--check-all', '--quiet', '--fields', '--json', '--backlog', '--dry-run']) {
    T.check('H claim --bogus: the hint names ' + f, c.json?.error === 'unknown_field' && new RegExp('(^|[ ,:])' + f + '(,|$)').test(hint), hint);
  }
  const s = run(['set', '--id=TSK-001', '--bogus=1', '--json']);
  const sh = String(s.json?.hint);
  T.check('H set --bogus: --depends-on, not depends_on', s.json?.error === 'unknown_field' && sh.includes('--depends-on') && !sh.includes('depends_on'), sh);
  T.check('H set --bogus: names --id and --backlog too', sh.includes('--id,') && sh.includes('--backlog'), sh);
}

T.finish();
