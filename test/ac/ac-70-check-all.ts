/* AC-70 — `set`/`claim --status=<last> --check-all` ticks every open
 * acceptance box in the same write (docs/SPECIFICATION.md § 9, § 12a;
 * DECISIONS 225; TSK-048).
 *
 * Found by an outside team (feedback/knowledge4ai-team TSK-005): closing an
 * element took one `check` per criterion and then `set --status=done`, or
 * a `done` with open boxes and the `done:open_acceptance` warning. Now one
 * explicit flag does it in the same write and names what it ticked. It is
 * never implicit: a plain `--status=done` leaves the boxes, and the
 * warning, as they were.
 *
 * Written before the fix: red against 6c9f48b.
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
function run(args: string[], cwd: string, input?: string): RunResult {
  return H.runNj(args, { cwd, env: ENV, unsetEnv: UNSET, input });
}
function runJ(args: string[], cwd: string, input?: string) {
  return H.runJson(args, { cwd, env: ENV, unsetEnv: UNSET, input });
}

const ACCEPTANCE = '- [x] a\n- [ ] b\n  * [ ] c\n```\n- [ ] fenced\n```';
/* `n` tasks under EPIC-001, each with a checkbox in its description and ACCEPTANCE (or `acc`). */
function fixture(label: string, n: number, acc?: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir), 'new epic');
  for (let i = 1; i <= n; i++) {
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i, '--description=Plan:\n- [ ] desc box',
      '--acceptance=' + (acc === undefined ? ACCEPTANCE : acc)], dir), 'new task ' + i);
  }
  return dir;
}
function body(dir: string, id: string): string {
  return fs.readFileSync(path.join(dir, 'backlog', 'tasks', id + '.md'), 'utf8');
}
const TICKED = '- [x] a\n- [x] b\n  * [x] c\n```\n- [ ] fenced\n```';

/* S1 — set --status=done --check-all */
{
  const dir = fixture('ac70-s1', 1);
  const r = runJ(['set', '--id=TSK-001', '--status=done', '--check-all'], dir);
  T.exit('S1 set --check-all: exit 0', r, 0);
  const b = body(dir, 'TSK-001');
  T.check('S1 every open acceptance box ticked, the fenced one left', b.includes(TICKED), J(b));
  T.check('S1 a box outside the acceptance section is left', b.includes('- [ ] desc box'), J(b));
  T.eq('S1 checked names the ticked lines', J(r.json && r.json.checked), J(['b', 'c']));
  T.check('S1 changed: status and acceptance', r.json && J(r.json.changed) === J(['status', 'acceptance']), J(r.json && r.json.changed));
  T.check('S1 no open_acceptance, no done:open_acceptance', r.json && !('open_acceptance' in r.json) && !(r.json._problems || []).includes('done:open_acceptance'), J(r.json));
  T.check('S1 files names the element file', r.json && (r.json.files || []).some((f: any) => f.path === 'tasks/TSK-001.md' && f.op === 'modified'), J(r.json && r.json.files));
  const again = runJ(['set', '--id=TSK-001', '--status=done', '--check-all'], dir);
  T.check('S1 again: nothing open, checked [], unchanged', again.json && J(again.json.checked) === '[]' && J(again.json.changed) === '[]', J(again.json));
}

/* S2 — never implicit */
{
  const dir = fixture('ac70-s2', 1);
  const r = runJ(['set', '--id=TSK-001', '--status=done'], dir);
  T.exit('S2 plain --status=done: exit 0', r, 0);
  T.check('S2 boxes left open', body(dir, 'TSK-001').includes(ACCEPTANCE), J(body(dir, 'TSK-001')));
  T.check('S2 open_acceptance still reported, no checked key', r.json && 'open_acceptance' in r.json && !('checked' in r.json), J(r.json));
}

/* S3 — nothing open: checked [] next to the status change */
{
  const dir = fixture('ac70-s3', 1, '- [x] a');
  const r = runJ(['set', '--id=TSK-001', '--status=done', '--check-all'], dir);
  T.check('S3 all ticked already: checked [], status changed', r.json && J(r.json.checked) === '[]' && J(r.json.changed) === J(['status']), J(r.json));
}

/* S4 — with --input, and with an acceptance replace in the same call */
{
  const dir = fixture('ac70-s4', 2);
  const r = runJ(['set', '--id=TSK-001', '--input=-', '--check-all'], dir, JSON.stringify({ status: 'done' }));
  T.eq('S4 --input status done: checked', J(r.json && r.json.checked), J(['b', 'c']));
  const r2 = runJ(['set', '--id=TSK-002', '--status=done', '--check-all', '--acceptance=- [ ] new one'], dir);
  T.eq('S4 replace then tick: the new line ticked', J(r2.json && r2.json.checked), J(['new one']));
  T.check('S4 replace then tick: on disk', body(dir, 'TSK-002').includes('- [x] new one'), J(body(dir, 'TSK-002')));
}

/* B — batch: per member */
{
  const dir = fixture('ac70-b', 2);
  ok(run(['check', '--id=TSK-002', '--item=3'], dir), 'tick b (item 3, after the description box and a) on TSK-002');
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--status=done', '--check-all'], dir);
  T.exit('B batch: exit 0', r, 0);
  const res = (r.json && r.json.results) || [];
  T.eq('B batch: each member names its own', J(res.map((x: any) => x.checked)), J([['b', 'c'], ['c']]));
  T.check('B batch: not on the wrapper', r.json && !('checked' in r.json), J(r.json && Object.keys(r.json)));
}

/* C — claim */
{
  const dir = fixture('ac70-c', 2);
  const r = runJ(['claim', '--id=TSK-001', '--as=alice', '--status=done', '--check-all'], dir);
  T.exit('C claim --check-all: exit 0', r, 0);
  T.eq('C claim: checked', J(r.json && r.json.checked), J(['b', 'c']));
  T.check('C claim: ticked on disk', body(dir, 'TSK-001').includes(TICKED), J(body(dir, 'TSK-001')));
  T.check('C claim: changed names acceptance, the claim is released', r.json && (r.json.changed || []).includes('acceptance') && r.json.released === 'alice', J(r.json));
  const b = runJ(['claim', '--id=TSK-001,TSK-002', '--as=bob', '--status=done', '--check-all'], dir);
  T.eq('C claim batch: per member', J(((b.json && b.json.results) || []).map((x: any) => x.checked)), J([[], ['b', 'c']]));
}

/* D — --dry-run reports the same and writes nothing */
{
  const dir = fixture('ac70-d', 1);
  const real = fixture('ac70-d-real', 1);
  const args = ['set', '--id=TSK-001', '--status=done', '--check-all'];
  const before = body(dir, 'TSK-001');
  const d = runJ(args.concat(['--dry-run']), dir);
  const r = runJ(args, real);
  T.eq('D --dry-run: same checked', J(d.json && d.json.checked), J(r.json && r.json.checked));
  T.eq('D --dry-run: same files', J(d.json && d.json.files), J(r.json && r.json.files));
  T.eq('D --dry-run: nothing written', body(dir, 'TSK-001'), before);
}

/* R — refusals, nothing written */
{
  const dir = fixture('ac70-r', 1);
  const before = body(dir, 'TSK-001');
  for (const [what, args] of [
    ['set --check-all alone', ['set', '--id=TSK-001', '--check-all']],
    ['set --check-all with --status=review', ['set', '--id=TSK-001', '--status=review', '--check-all']],
    ['set --check-all with only another field', ['set', '--id=TSK-001', '--priority=high', '--check-all']],
    ['claim --check-all without --status', ['claim', '--id=TSK-001', '--as=alice', '--check-all']],
    ['claim --check-all with --status=doing', ['claim', '--id=TSK-001', '--as=alice', '--status=doing', '--check-all']],
  ] as Array<[string, string[]]>) {
    const r = runJ(args, dir);
    T.check('R ' + what + ': invalid_value', r.status !== 0 && r.json && r.json.error === 'invalid_value', r.status + ' ' + J(r.json));
  }
  const rel = runJ(['release', '--id=TSK-001', '--as=alice', '--status=done', '--check-all'], dir);
  T.check('R release does not take --check-all', rel.status !== 0 && rel.json && rel.json.ok === false, J(rel.json));
  const nx = runJ(['next', '--as=alice', '--status=done', '--check-all'], dir);
  T.check('R next does not take --check-all', nx.status !== 0 && nx.json && nx.json.ok === false, J(nx.json));
  T.eq('R nothing written', body(dir, 'TSK-001'), before);
  T.check('R no claim was taken', (runJ(['show', '--id=TSK-001'], dir).json || { entry: {} }).entry._claim === null, '');
}

/* H — --help */
{
  const dir = fixture('ac70-h', 0);
  for (const cmd of ['set', 'claim']) {
    T.check(cmd + ' --help lists --check-all', /--check-all\s/.test(run([cmd, '--help'], dir).stdout || ''), '');
  }
}

T.finish();
