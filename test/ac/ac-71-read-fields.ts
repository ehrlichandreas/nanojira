/* AC-71 — `--fields` on the read commands, `--quiet`/`--fields` on `next`
 * (TSK-037, DECISIONS 229; docs/SPECIFICATION.md § 9 "`--fields` /
 * `--quiet`").
 *
 * `list`, `find` and `show` take `--fields=<a,b,...>` over their entry
 * keys and project every entry, the envelope unchanged; `show` keeps
 * `entry` identical to `entries[0]`. `next` takes `--quiet`/`--fields`
 * exactly as `claim` does, whose shape it returns. An unknown or empty
 * `--fields` is `invalid_value` with the allowed names, refused before
 * `next` claims anything. The reads take no `--quiet`. Without the flags
 * the output is byte-identical (one golden `list --json`).
 *
 * Written before the change: red against 4.4.0 step C, before TSK-037.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);
const ENV = { NJ_NOW: '2026-10-22T01:00:00Z', NJ_AUTHOR: 'Tester' };

const dir = H.freshDir('ac71');
const bl = path.join(dir, 'backlog');
const run = (args: string[]) => H.runNj(args, { cwd: dir, env: ENV });
const runJ = (args: string[]) => H.runJson(args, { cwd: dir, env: ENV });
function ok(r: H.RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr) + J(r.stdout));
  return r;
}
ok(run(['init']), 'init');
const epic = runJ(['new', '--type=epic', '--title=Epic one']).json.id;
const task = runJ(['new', '--type=task', `--parent=${epic}`, '--title=Task one', '--description=d', '--acceptance=- [ ] a']).json.id;
ok(run(['note', `--id=${task}`, '--text=a note', '--as=Tester']), 'note');

/* G — the default output is byte-identical (golden) */
{
  const r = ok(run(['list', '--json']), 'list --json');
  const golden = JSON.stringify({
    backlog: bl,
    counts: { total: 2, errors: 0, incomplete: 1 },
    entries: [
      { id: epic, type: 'epic', title: 'Epic one', status: 'todo', priority: 'normal', tags: [], depends_on: [],
        created: '2026-10-22T01:00:00Z', updated: '2026-10-22T01:00:00Z', file: path.join(bl, 'epics', epic + '.md'),
        _problems: ['incomplete:description'], _claim: null },
      { id: task, type: 'task', parent: epic, title: 'Task one', status: 'todo', priority: 'normal', tags: [], depends_on: [],
        created: '2026-10-22T01:00:00Z', updated: '2026-10-22T01:00:00Z', file: path.join(bl, 'tasks', task + '.md'),
        _problems: [], _claim: null },
    ],
  }, null, 2) + '\n';
  T.eq('G list --json without --fields: byte-identical to the golden output', r.stdout, golden);
}

/* L — list and find project every entry, in the order given; the envelope stays */
for (const args of [['list'], ['list', '--ready'], ['find', 'one']]) {
  const r = runJ(args.concat(['--fields=status,id']));
  const what = args.join(' ') + ' --fields=status,id';
  T.exit('L ' + what + ': exit 0', r, 0);
  T.eq('L ' + what + ': envelope keys', r.json && Object.keys(r.json), ['backlog', 'counts', 'entries']);
  T.check('L ' + what + ': every entry is exactly {status, id}',
    r.json && Array.isArray(r.json.entries) && r.json.entries.length > 0 && r.json.entries.every((e: object) => J(Object.keys(e)) === J(['status', 'id'])), J(r.json));
}

/* S — show: entries and entry projected alike; --notes adds notes to the vocabulary */
{
  const r = runJ(['show', `--id=${task}`, '--fields=id,title']);
  T.exit('S show --fields=id,title: exit 0', r, 0);
  T.eq('S show: entry is {id, title}', r.json && r.json.entry, { id: task, title: 'Task one' });
  T.eq('S show: entry === entries[0]', J(r.json?.entries?.[0]), J(r.json && r.json.entry));
  const n = runJ(['show', `--id=${task}`, '--notes=all', '--fields=id,notes_total']);
  T.eq('S show --notes=all --fields=id,notes_total', n.json && n.json.entry, { id: task, notes_total: 1 });
}

/* N — next: --fields narrows entry only, --quiet is claim's {ok, id, files} */
{
  const r = runJ(['next', '--as=Tester', '--fields=id,status', `--parent=${epic}`]);
  T.exit('N next --fields: exit 0', r, 0);
  T.eq('N next --fields: entry is {id, status}', r.json && r.json.entry, { id: task, status: 'todo' });
  T.check('N next --fields: the envelope keeps claim and skipped', r.json?.claim && Array.isArray(r.json?.skipped), J(r.json));
  ok(run(['release', `--id=${task}`, '--as=Tester']), 'release');
  const q = runJ(['next', '--as=Tester', '--quiet', `--parent=${epic}`]);
  T.eq('N next --quiet: keys are {ok, id, files}', q.json && Object.keys(q.json), ['ok', 'id', 'files']);
  ok(run(['release', `--id=${task}`, '--as=Tester']), 'release');
}

/* R — refusals: unknown and empty names list the allowed ones; next claims nothing; no --quiet on reads */
{
  const u = runJ(['list', '--fields=id,statuss']);
  T.check('R list --fields=id,statuss: invalid_value, did-you-mean status',
    u.status === 1 && u.json && u.json.error === 'invalid_value' && String(u.json.hint).includes("did you mean 'status'?"), J(u.json));
  const e = runJ(['find', 'one', '--fields=']);
  T.check('R find --fields=: invalid_value', e.status === 1 && e.json && e.json.error === 'invalid_value', J(e.json));
  const s = runJ(['show', `--id=${task}`, '--fields=body']);
  T.check('R show --fields=body: invalid_value naming the allowed fields',
    s.status === 1 && s.json && s.json.error === 'invalid_value' && String(s.json.hint).includes('notes_total'), J(s.json));
  const n = runJ(['next', '--as=Tester', '--fields=bogus']);
  T.check('R next --fields=bogus: invalid_value', n.status === 1 && n.json && n.json.error === 'invalid_value', J(n.json));
  const after = runJ(['show', `--id=${task}`]).json;
  T.eq('R next --fields=bogus: nothing claimed', after && after.entry && after.entry._claim, null);
  const nj = run(['list', '--fields=id']);
  T.check('R list --fields without --json: invalid_value', nj.status === 1 && nj.stderr.includes('--fields requires --json'), nj.stderr);
  const q = runJ(['list', '--quiet']);
  T.check('R list --quiet: unknown_field', q.status === 1 && q.json && q.json.error === 'unknown_field', J(q.json));
}

T.finish();
