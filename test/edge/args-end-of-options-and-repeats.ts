/* Edge — `--` ends option parsing; a flag repeated with a different value
 * is refused (§ 9 Rules, TSK-034 F11).
 *
 * "`--` ends the options: every token after it is a positional, even one
 *  that starts with `--`." It used to be skipped, so
 * `note --as=scout -- "--as=mallory" hello` signed the note `mallory`.
 *
 * "A flag given twice with different values is invalid_value and nothing is
 *  written; an identical repeat is accepted." It used to be last-wins, which
 * is how the line above could override an earlier `--as`. Wrappers that add
 * `--json` or the same `--backlog` a second time keep working. `--help`
 * keeps its precedence: it never fails.
 *
 * "A command that takes no positional refuses one, naming it
 *  (unexpected_argument)." Without that, a flag placed after `--` on such a
 * command was silently dropped and a write reported success while changing
 * nothing. Only `note` and `find` take a positional.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Uses --flaglike text', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Uses --flaglike text\n\n## Description\nD\n'),
      'epics/EPIC-002.md': H.element({
        id: 'EPIC-002', type: 'epic', title: 'Other', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Other\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001', 'EPIC-002'],
  });
}

const epicPath = (d: string) => path.join(d, 'backlog', 'epics', 'EPIC-001.md');
const lastNote = (d: string) => fs.readFileSync(epicPath(d), 'utf8').split('\n').filter((l) => l.startsWith('- ')).pop() || '';

/* ---- `--` ends the options --------------------------------------------- */
{
  const d = fixture('edge-args-dashdash-note');
  const r = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--', '--as=mallory', 'hello'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('note … -- "--as=mallory" hello: written', r, 0);
  T.contains('the note is signed by the --as before --', lastNote(d), ' scout: ');
  T.contains('the token after -- is note text', lastNote(d), 'scout: --as=mallory hello');
}
{
  const d = fixture('edge-args-dashdash-json');
  const r = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--json', '--', '--not-a-flag'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('note --json -- "--not-a-flag": written', r, 0);
  T.contains('the text is "--not-a-flag"', lastNote(d), 'scout: --not-a-flag');
  let ok = false;
  try { ok = JSON.parse(r.stdout).ok === true; } catch { ok = false; }
  T.check('--json before -- still applies', ok, r.stdout);
}
{
  const d = fixture('edge-args-dashdash-help');
  const r = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--', '--help'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('note -- --help: written, not help', r, 0);
  T.contains('the text is "--help"', lastNote(d), 'scout: --help');
}
{
  const d = fixture('edge-args-dashdash-version');
  const r = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--', '--version'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('note -- --version: written, not the version', r, 0);
  T.contains('the text is "--version"', lastNote(d), 'scout: --version');
}
{
  const d = fixture('edge-args-dashdash-find');
  // Not runJson: its trailing --json would land after -- as search text.
  const r = H.runNj(['find', '--json', '--', '--flaglike'], { cwd: d });
  let ids: string[] = [];
  try { ids = JSON.parse(r.stdout).entries.map((e: any) => e.id); } catch { ids = []; }
  T.exit('find -- --flaglike: exit 0', r, 0);
  T.eq('find searched for "--flaglike"', JSON.stringify(ids), '["EPIC-001"]');
}
{
  const d = fixture('edge-args-dashdash-trailing');
  T.exit('a trailing -- with nothing after it is fine', H.runNj(['list', '--json', '--'], { cwd: d }), 0);
}

/* ---- a repeated flag is refused ---------------------------------------- */
const CONFLICTS: Array<[string, string[]]> = [
  ['--title twice, different values', ['set', '--id=EPIC-001', '--title=a', '--title=b']],
  ['--depends-on and --depends_on, different values', ['set', '--id=EPIC-001', '--depends-on=EPIC-002', '--depends_on=']],
  ['--as twice on note, different values', ['note', '--id=EPIC-001', '--as=scout', '--as=mallory', 'hello']],
  ['--backlog before and after the command, different values', ['--backlog=backlog', 'list', '--backlog=elsewhere']],
];
for (const [label, args] of CONFLICTS) {
  const d = fixture(`edge-args-repeat-${label.replace(/[^a-z]+/g, '-')}`);
  const before = fs.readFileSync(epicPath(d), 'utf8');
  const r = H.runNj(args, { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit(`${label}: refused`, r, 1);
  T.contains(`${label}: the message says the flag is given more than once`, r.stderr, 'more than once');
  T.eq(`${label}: nothing was written`, H.sha256(fs.readFileSync(epicPath(d), 'utf8')), H.sha256(before));
}

/* ---- an identical repeat is accepted ----------------------------------- */
{
  const d = fixture('edge-args-same-title');
  const r = H.runNj(['set', '--id=EPIC-001', '--title=a', '--title=a'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--title=a twice: accepted', r, 0);
  T.contains('--title=a twice: the title is a', fs.readFileSync(epicPath(d), 'utf8'), 'title: a\n');
}
{
  const d = fixture('edge-args-same-alias');
  const r = H.runNj(['set', '--id=EPIC-001', '--depends-on=EPIC-002', '--depends_on=EPIC-002'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--depends-on and --depends_on with the same value: accepted', r, 0);
  T.contains('the dependency is set once', fs.readFileSync(epicPath(d), 'utf8'), 'depends_on: [EPIC-002]');
}
{
  const d = fixture('edge-args-same-as');
  const r = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--as=scout', 'hello'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--as=scout twice on note: accepted', r, 0);
  T.contains('the note is signed scout', lastNote(d), 'scout: hello');
}
for (const [label, args] of [
  ['--json twice (a boolean repeat is always identical)', ['--json', 'list', '--json']],
  ['the same --backlog before and after the command', ['--backlog=backlog', 'list', '--backlog=backlog', '--json']],
  ['--version twice', ['--version', '--version']],
] as Array<[string, string[]]>) {
  const d = fixture(`edge-args-same-${label.replace(/[^a-z]+/g, '-')}`);
  const r = H.runNj(args, { cwd: d });
  T.exit(`${label}: accepted`, r, 0);
}
{
  const d = fixture('edge-args-repeat-json-code');
  const r = H.runJson(['set', '--id=EPIC-001', '--title=a', '--title=b'], { cwd: d });
  T.eq('a repeated flag is invalid_value', r.json && r.json.error, 'invalid_value');
  T.contains('the message names the flag', r.stderr, '--title');
}
{
  const d = fixture('edge-args-repeat-help');
  const r = H.runNj(['list', '--help', '--help'], { cwd: d });
  T.exit('--help twice still prints help (help never fails)', r, 0);
  T.contains('it is list\'s help', r.stdout, '--ready');
}

/* ---- a positional on a command that takes none ------------------------- */
const STRAY: Array<[string, string[], string]> = [
  ['set --json -- --status=doing', ['set', '--id=EPIC-001', '--json', '--', '--status=doing'], '--status=doing'],
  ['set status=done (the old typo)', ['set', '--id=EPIC-001', '--json', 'status=done'], 'status=done'],
  ['list --json -- --status=doing', ['list', '--json', '--', '--status=doing'], '--status=doing'],
  ['list --json stray', ['list', '--json', 'stray'], 'stray'],
];
for (const [label, args, token] of STRAY) {
  const d = fixture(`edge-args-stray-${label.replace(/[^a-z]+/g, '-')}`);
  const before = fs.readFileSync(epicPath(d), 'utf8');
  const r = H.runNj(args, { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  let code: string | undefined;
  try { code = JSON.parse(r.stdout).error; } catch { code = undefined; }
  T.exit(`${label}: refused`, r, 1);
  T.eq(`${label}: the code is unexpected_argument`, code, 'unexpected_argument');
  T.contains(`${label}: the message names the token`, r.stderr, `'${token}'`);
  T.eq(`${label}: nothing was written`, H.sha256(fs.readFileSync(epicPath(d), 'utf8')), H.sha256(before));
}
{
  const d = fixture('edge-args-stray-bare');
  const r = H.runNj(['--', 'list', '--json'], { cwd: d });
  T.exit('-- list --json: refused, not the bare summary', r, 1);
  T.contains('-- list --json: the message names "list"', r.stderr, "'list'");
}
{
  // Every command that takes no positional, with the stray token last.
  const d = fixture('edge-args-stray-every');
  const before = fs.readFileSync(epicPath(d), 'utf8');
  for (const cmd of ['init', 'new', 'set', 'check', 'show', 'log', 'list', 'tree', 'tags', 'rm', 'archive',
    'unarchive', 'claim', 'release', 'next', 'doctor']) {
    const r = H.runNj([cmd, '--json', 'stray'], { cwd: d });
    let code: string | undefined;
    try { code = JSON.parse(r.stdout).error; } catch { code = undefined; }
    T.eq(`${cmd} stray: unexpected_argument`, code, 'unexpected_argument');
  }
  const bare = H.runNj(['--json', 'stray'], { cwd: d });
  T.contains('bare nanojira with a stray word is still unknown_command', bare.stdout, 'unknown_command');
  T.eq('no stray call wrote anything', H.sha256(fs.readFileSync(epicPath(d), 'utf8')), H.sha256(before));
}

/* ---- precedence: an unknown flag or command wins ----------------------- */
{
  const d = fixture('edge-args-precedence');
  const code = (args: string[]) => {
    const r = H.runNj(args, { cwd: d });
    try { return JSON.parse(r.stdout).error; } catch { return undefined; }
  };
  T.eq('list --bogus=1 --bogus=2: unknown_field, not invalid_value', code(['list', '--json', '--bogus=1', '--bogus=2']), 'unknown_field');
  T.eq('set --bogus stray: unknown_field, not unexpected_argument', code(['set', '--id=EPIC-001', '--json', '--bogus', 'stray']), 'unknown_field');
  T.eq('an unknown command with a conflicting repeat: unknown_command', code(['bogus', '--json', '--a=1', '--a=2']), 'unknown_command');
  T.eq('a known flag repeated beside an unknown one: unknown_field', code(['list', '--json', '--tag=a', '--tag=b', '--bogus']), 'unknown_field');
}

/* ---- a conflicting repeat is reported as the user spelled it ----------- */
for (const [label, args, shown] of [
  ['--depends_on twice', ['set', '--id=EPIC-001', '--depends_on=EPIC-002', '--depends_on='], '--depends_on is given'],
  ['--depends-on twice', ['set', '--id=EPIC-001', '--depends-on=EPIC-002', '--depends-on='], '--depends-on is given'],
  ['--depends-on then --depends_on', ['set', '--id=EPIC-001', '--depends-on=EPIC-002', '--depends_on='], '--depends_on is given'],
] as Array<[string, string[], string]>) {
  const d = fixture(`edge-args-spelling-${label.replace(/[^a-z]+/g, '-')}`);
  const r = H.runNj(args, { cwd: d });
  T.contains(`${label}: named as typed`, r.stderr, shown);
}

/* ---- --backlog repeats compare as resolved paths ----------------------- */
{
  const d = fixture('edge-args-backlog-resolved');
  const abs = path.join(d, 'backlog');
  for (const second of ['backlog/', './backlog', abs, abs + '/']) {
    const r = H.runNj(['--backlog=backlog', 'list', `--backlog=${second}`, '--json'], { cwd: d });
    T.exit(`--backlog=backlog and --backlog=${second === abs ? '<absolute>' : second === abs + '/' ? '<absolute>/' : second}: the same backlog, accepted`, r, 0);
  }
  const other = H.runNj(['--backlog=backlog', 'list', '--backlog=elsewhere', '--json'], { cwd: d });
  T.exit('--backlog=backlog and --backlog=elsewhere: still refused', other, 1);
  // Only --backlog: every other flag compares exactly.
  const as = H.runNj(['note', '--id=EPIC-001', '--as=scout', '--as=./scout', 'hello'], { cwd: d });
  T.exit('--as=scout and --as=./scout: refused (only --backlog is a path)', as, 1);
}

T.finish();
