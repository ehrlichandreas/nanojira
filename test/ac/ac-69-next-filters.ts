/* AC-69 — `--exclude-tag=` and `--min-priority=` on `next`, `list` and
 * `find`; `next --help` says up front that `next` claims
 * (docs/SPECIFICATION.md § 9, § 12b; DECISIONS 224; TSK-047).
 *
 * Found by an outside team (feedback/knowledge4ai-team TSK-004): their
 * builders wanted the next item that is not `waiting:user` and at least
 * `high`. `--tag=` only selects; there was no way to leave a tag out or
 * set a priority floor, so they read `list --ready` and claimed by hand,
 * the race `next` exists to close. A builder also ran `next` "to have a
 * look" and claimed an item it never meant to take.
 *
 * Written before the fix: red against 0aafd61.
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
const UNSET = ['NJ_BACKLOG', 'NJ_ON_CHANGE', 'NJ_AUTHOR'];
function run(args: string[], cwd: string): RunResult {
  return H.runNj(args, { cwd, env: ENV, unsetEnv: UNSET });
}
function runJ(args: string[], cwd: string) {
  return H.runJson(args, { cwd, env: ENV, unsetEnv: UNSET });
}
function ids(r: { json?: any }): string[] | null {
  return r.json && Array.isArray(r.json.entries) ? r.json.entries.map((e: any) => e.id) : null;
}

/* TSK-001 high [x], TSK-002 urgent [y], TSK-003 normal [], TSK-004 low [x, z]; all ready. */
function fixture(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  const tasks: Array<[string, string]> = [['high', 'x'], ['urgent', 'y'], ['normal', ''], ['low', 'x,z']];
  tasks.forEach(([prio, tags], i) => {
    const args = ['new', '--type=task', '--parent=EPIC-001', '--title=T' + (i + 1), '--description=D.', '--acceptance=- [ ] a', '--priority=' + prio];
    ok(run(tags === '' ? args : args.concat(['--tags=' + tags]), dir), 'new task ' + (i + 1));
  });
  return dir;
}

/* L — list --ready */
{
  const dir = fixture('ac69-l');
  const ready = (extra: string[]) => ids(runJ(['list', '--ready', '--type=task'].concat(extra), dir));
  T.eq('L baseline: all four, by priority', J(ready([])), J(['TSK-002', 'TSK-001', 'TSK-003', 'TSK-004']));
  T.eq('L --exclude-tag=x: TSK-001 and TSK-004 left out', J(ready(['--exclude-tag=x'])), J(['TSK-002', 'TSK-003']));
  T.eq('L --exclude-tag=x,y: any of them excludes', J(ready(['--exclude-tag=x,y'])), J(['TSK-003']));
  T.eq('L --exclude-tag=z: one of several tags is enough', J(ready(['--exclude-tag=z'])), J(['TSK-002', 'TSK-001', 'TSK-003']));
  T.eq('L --min-priority=high: high and urgent', J(ready(['--min-priority=high'])), J(['TSK-002', 'TSK-001']));
  T.eq('L --min-priority=low: everything', J(ready(['--min-priority=low'])), J(['TSK-002', 'TSK-001', 'TSK-003', 'TSK-004']));
  T.eq('L --min-priority=urgent: urgent only', J(ready(['--min-priority=urgent'])), J(['TSK-002']));
  T.eq('L both: AND', J(ready(['--exclude-tag=y', '--min-priority=high'])), J(['TSK-001']));
  const text = run(['list', '--ready', '--type=task', '--min-priority=urgent'], dir);
  T.check('L text mode: only TSK-002 under Ready to work', /TSK-002/.test(text.stdout || '') && !/TSK-001/.test(text.stdout || ''), J(text.stdout));
}

/* P — plain list and find take them too */
{
  const dir = fixture('ac69-p');
  T.eq('P list --min-priority=normal', J(ids(runJ(['list', '--type=task', '--min-priority=normal'], dir))), J(['TSK-002', 'TSK-001', 'TSK-003']));
  T.eq('P list --exclude-tag=x', J(ids(runJ(['list', '--type=task', '--exclude-tag=x'], dir))), J(['TSK-002', 'TSK-003']));
  T.eq('P find --exclude-tag=y --min-priority=normal', J(ids(runJ(['find', 'T', '--type=task', '--exclude-tag=y', '--min-priority=normal'], dir))), J(['TSK-001', 'TSK-003']));
}

/* N — next */
{
  const dir = fixture('ac69-n');
  const dry = runJ(['next', '--as=alice', '--min-priority=high', '--exclude-tag=y', '--dry-run'], dir);
  T.check('N --dry-run picks TSK-001', dry.json && dry.json.ok === true && dry.json.id === 'TSK-001', J(dry.json));
  T.eq('N --dry-run claimed nothing', J(ids(runJ(['list', '--ready', '--type=task', '--min-priority=high'], dir))), J(['TSK-002', 'TSK-001']));
  const none = runJ(['next', '--as=alice', '--min-priority=urgent', '--exclude-tag=y'], dir);
  T.check('N nothing left after the filters: none_ready', none.status !== 0 && none.json && none.json.error === 'none_ready', J(none.json));
  const r = runJ(['next', '--as=alice', '--exclude-tag=y'], dir);
  T.check('N --exclude-tag=y skips the urgent TSK-002, claims TSK-001', r.json && r.json.ok === true && r.json.id === 'TSK-001', J(r.json));
  const r2 = runJ(['next', '--as=bob', '--min-priority=normal', '--exclude-tag=y'], dir);
  T.check('N next for bob: TSK-003 (TSK-001 is claimed, TSK-004 is low)', r2.json && r2.json.ok === true && r2.json.id === 'TSK-003', J(r2.json));
}

/* E — bad values are invalid_value, never an empty result */
{
  const dir = fixture('ac69-e');
  for (const cmd of [['list', '--ready'], ['list'], ['find', 'T'], ['next', '--as=alice']]) {
    const r = runJ(cmd.concat(['--min-priority=hi']), dir);
    T.check(cmd.join(' ') + ' --min-priority=hi: invalid_value', r.status !== 0 && r.json && r.json.error === 'invalid_value', J(r.json));
    T.check(cmd.join(' ') + ' --min-priority=hi: the hint lists the priorities', r.json && /low, normal, high, urgent/.test(r.json.hint || ''), J(r.json));
    const e = runJ(cmd.concat(['--exclude-tag=']), dir);
    T.check(cmd.join(' ') + ' --exclude-tag= (empty): invalid_value', e.status !== 0 && e.json && e.json.error === 'invalid_value', J(e.json));
  }
  T.check('E nothing was claimed by a refused next', (ids(runJ(['list', '--ready', '--type=task'], dir)) || []).length === 4, '');
}

/* H — --help and SKILL.md */
{
  const dir = fixture('ac69-h');
  const help = run(['next', '--help'], dir).stdout || '';
  const first = help.split('\n')[0];
  T.check('H next --help: the first line says next claims the element it picks', /next claims the element it picks/.test(first), J(first));
  T.check('H next --help: the first line names list --ready and next --dry-run', /list --ready/.test(first) && /next --dry-run/.test(first), J(first));
  for (const cmd of ['next', 'list', 'find']) {
    const h = run([cmd, '--help'], dir).stdout || '';
    const line = (n: string) => h.split('\n').find((l) => l.trimStart().startsWith('--' + n + '=')) || '';
    T.check(cmd + ' --help lists --exclude-tag', line('exclude-tag') !== '', J(h));
    T.check(cmd + ' --help: --min-priority lists the priorities', /allowed: low, normal, high, urgent$/.test(line('min-priority')), J(line('min-priority')));
  }
  const general = run(['--help'], dir).stdout || '';
  T.check('H nanojira --help: says next claims', /next claims the element it picks/.test(general), '');
  const skill = path.resolve(path.dirname(H.NJ as string), '..', 'SKILL.md');
  if (!fs.existsSync(skill)) {
    T.notCovered('H SKILL.md says next claims', 'no SKILL.md next to ' + H.NJ);
  } else {
    const entry = fs.readFileSync(skill, 'utf8').split('\n').find((l) => l.includes('**Next work**')) || '';
    T.check('H SKILL.md: the next entry starts by saying next claims', /^- \*\*Next work\*\*: `nanojira next` claims the element it picks/.test(entry), J(entry));
  }
}

T.finish();
