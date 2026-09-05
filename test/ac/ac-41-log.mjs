/* AC-41 — `nj log`, docs/SPECIFICATION.md § 12c (v3.5, DECISIONS 154/155,
 * promoted: commit <pending>).
 *
 * AC-41 (§ 15): "For an element with a `created` timestamp, N claim
 * generations and M notes, `nj log --id=…` returns exactly N+M+1 events
 * merged by `at` ascending, each `kind` one of `created | claimed |
 * reasserted | stolen | released | note`: a plain claim after
 * `unclaimed`/`released` is `claimed`; the same name claiming again is
 * `reasserted`; a different name landing via `--steal` is `stolen`;
 * `release` is `released`; each note line is one `note` event with its
 * own actor and text. No write command's output or bytes change —
 * replayed against a pre-`log` baseline, nothing differs. Two events
 * sharing one timestamp (a fixed `NJ_NOW`) sort `created`, then claims
 * in generation order, then notes in document order, every time. `--id`
 * naming a duplicate is `duplicate_id`; `--file=<path>` disambiguates it,
 * the same as a write's escape hatch, even though `log` writes nothing;
 * `--id` naming nothing is `not_found`, matching `show`. `log` reads an
 * archived element same as `show` does; its claim events are gone
 * because `archive` already deletes the claims directory, leaving only
 * `created` and notes. A fresh clone with no local claims shows
 * `created` and notes only, never claim events, because
 * `.nanojira/claims/` is git-ignored (§ 12a) — a field-level change
 * (`status`, `priority`, …) is not shown at all, by design, and the spec
 * states both limits plainly. An unreadable stub addressed directly is
 * `refused:unreadable`."
 *
 * Written before `nj log` exists: red everywhere until it is
 * implemented.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
import * as MCP from '../lib/mcp-stdio.mjs';
const T = H.T;

H.requireNj();
H.requireNjMcp();

const NOW = H.FIXED_NOW;
const LATER = H.LATER_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

function envFor(o) {
  const env = Object.assign({}, (o && o.env) || {});
  const unset = [];
  for (const k of ['NJ_AUTHOR', 'NJ_BACKLOG', 'NJ_FAULT']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

function fixture(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  return { dir, bl };
}
function newEpic(x, t) {
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: x.dir, env: { NJ_NOW: t } }), 'new epic');
}
function newTask(x, t, extra) {
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--description=D.',
    '--acceptance=- [x] It works'].concat(extra || []), { cwd: x.dir, env: { NJ_NOW: t } }), 'new TSK-001');
}
function log(x, args, env) { return runJ(['log'].concat(args || []), { cwd: x.dir, env: env || {} }); }
function claimsDir(x, id) { return path.join(x.bl, '.nanojira', 'claims', id); }

/* Six distinct, strictly increasing timestamps for unambiguous ordering. */
const T0 = '2026-09-21T18:00:00Z';
const T1 = '2026-09-21T18:01:00Z';
const T2 = '2026-09-21T18:02:00Z';
const T3 = '2026-09-21T18:03:00Z';
const T4 = '2026-09-21T18:04:00Z';
const T5 = '2026-09-21T18:05:00Z';

/* ===================================================================== */
/* L1 — the full event kind vocabulary, in order (§ 12c)                  */
/* ===================================================================== */
{
  const x = fixture('ac41-l1');
  newEpic(x, T0);
  newTask(x, T0);
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T1 } }), 'claim alice');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T2 } }), 're-assert alice');
  ok(run(['claim', '--id=TSK-001', '--as=bob', '--steal=alice'], { cwd: x.dir, env: { NJ_NOW: T3 } }), 'steal bob');
  ok(run(['note', '--id=TSK-001', 'did something', '--as=bob'], { cwd: x.dir, env: { NJ_NOW: T4 } }), 'note bob');
  ok(run(['release', '--id=TSK-001', '--as=bob'], { cwd: x.dir, env: { NJ_NOW: T5 } }), 'release bob');

  const r = log(x, ['--id=TSK-001']);
  T.exit('L1 nj log: exit 0', r, 0);
  const events = (r.json || {}).events;
  T.eq('L1 exactly 6 events (N=4 claim gens + M=1 note + 1 created)', events && events.length, 6);
  T.eq('L1 event 1: created, no actor, at T0', events && events[0], { at: T0, kind: 'created' });
  T.eq('L1 event 2: claimed by alice at T1', events && events[1], { at: T1, kind: 'claimed', actor: 'alice' });
  T.eq('L1 event 3: reasserted by alice at T2', events && events[2], { at: T2, kind: 'reasserted', actor: 'alice' });
  T.eq('L1 event 4: stolen by bob at T3', events && events[3], { at: T3, kind: 'stolen', actor: 'bob' });
  T.eq('L1 event 5: note by bob at T4, with text', events && events[4], { at: T4, kind: 'note', actor: 'bob', text: 'did something' });
  T.eq('L1 event 6: released by bob at T5', events && events[5], { at: T5, kind: 'released', actor: 'bob' });
  T.eq('L1 top-level id is TSK-001', r.json && r.json.id, 'TSK-001');
  T.eq('L1 ok is true', r.json && r.json.ok, true);
}

/* ===================================================================== */
/* L2 — tie-break: created, then claims (generation order), then notes    */
/* (document order), all at the exact same timestamp (§ 12c)              */
/* ===================================================================== */
{
  const x = fixture('ac41-l2');
  newEpic(x, T0);
  /* Created AND the first claim at the exact same instant. */
  newTask(x, T0);
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T0 } }), 'claim at T0');
  ok(run(['note', '--id=TSK-001', 'first', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T0 } }), 'note 1 at T0');
  ok(run(['note', '--id=TSK-001', 'second', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T0 } }), 'note 2 at T0');

  const r = log(x, ['--id=TSK-001']);
  T.exit('L2 nj log: exit 0', r, 0);
  const kinds = ((r.json || {}).events || []).map(e => e.kind);
  T.eq('L2 all four events share T0, tie-broken created < claim < notes (doc order)',
    kinds, ['created', 'claimed', 'note', 'note']);
  const texts = ((r.json || {}).events || []).filter(e => e.kind === 'note').map(e => e.text);
  T.eq('L2 the two notes keep their own document order (first, then second)', texts, ['first', 'second']);
}

/* ===================================================================== */
/* L3 — no field-level history: a `set` leaves no event (§ 12c)           */
/* ===================================================================== */
{
  const x = fixture('ac41-l3');
  newEpic(x, T0);
  newTask(x, T0);
  const before = log(x, ['--id=TSK-001']);
  ok(run(['set', '--id=TSK-001', '--status=doing', '--priority=high', '--title=Renamed'],
    { cwd: x.dir, env: { NJ_NOW: T1 } }), 'set status/priority/title');
  const after = log(x, ['--id=TSK-001']);
  T.eq('L3 a field-only set leaves the event list unchanged', after.json && after.json.events, before.json && before.json.events);
}

/* ===================================================================== */
/* L4 — duplicate_id / --file (§ 12c, the first read with a --file        */
/* escape hatch)                                                          */
/* ===================================================================== */
{
  const x = fixture('ac41-l4');
  newEpic(x, T0);
  newTask(x, T0);
  fs.writeFileSync(path.join(x.bl, 'tasks', 'TSK-001-dup.md'),
    H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Dup', status: 'todo', created: T0, updated: T0 },
      H.completeBody('Dup')));
  const r = log(x, ['--id=TSK-001']);
  T.exit('L4 log --id on a duplicate id, no --file: exit 1', r, 1);
  T.eq('L4 duplicate_id', r.json && r.json.error, 'duplicate_id');
  const viaFile = log(x, ['--file=tasks/TSK-001.md']);
  T.exit('L4 --file disambiguates: exit 0', viaFile, 0);
  T.eq('L4 --file: top-level id is still TSK-001', viaFile.json && viaFile.json.id, 'TSK-001');
}
{
  const x = fixture('ac41-l4-both');
  newEpic(x, T0);
  newTask(x, T0);
  const r = log(x, ['--id=TSK-001', '--file=tasks/TSK-001.md']);
  T.exit('L4 --id and --file together: exit 1', r, 1);
  T.eq('L4 --id and --file together: invalid_target', r.json && r.json.error, 'invalid_target');
}

/* ===================================================================== */
/* L5 — unknown id: not_found, matching `show` (§ 12c)                    */
/* ===================================================================== */
{
  const x = fixture('ac41-l5');
  newEpic(x, T0);
  const r = log(x, ['--id=TSK-404']);
  T.exit('L5 log --id=TSK-404: exit 1', r, 1);
  T.eq('L5 not_found', r.json && r.json.error, 'not_found');
  const showR = runJ(['show', '--id=TSK-404'], { cwd: x.dir });
  T.eq('L5 matches show\'s own unknown-id code', r.json && r.json.error, showR.json && showR.json.error);
}

/* ===================================================================== */
/* L6 — archived elements: readable like `show`; claim history is gone   */
/* because `archive` deletes the claims directory (§ 12a, § 12c)         */
/* ===================================================================== */
{
  const x = fixture('ac41-l6');
  newEpic(x, T0);
  newTask(x, T0);
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T1 } }), 'claim');
  ok(run(['note', '--id=TSK-001', 'a note', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T2 } }), 'note');
  ok(run(['release', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T3 } }), 'release');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: { NJ_NOW: T4 } }), 'set done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: { NJ_NOW: T5 } }), 'archive');
  T.check('L6 fixture: the claim directory is gone after archive', !fs.existsSync(claimsDir(x, 'TSK-001')), '');

  const r = log(x, ['--id=TSK-001']);
  T.exit('L6 log on an archived element: exit 0, same as show', r, 0);
  const kinds = ((r.json || {}).events || []).map(e => e.kind);
  T.eq('L6 claim/release events are gone; only created and the note remain', kinds, ['created', 'note']);
}

/* ===================================================================== */
/* L7 — claim history is local to the working copy only (§ 12a, § 12c):   */
/* removing the claims directory (simulating a fresh clone, since         */
/* `.nanojira/claims/` is git-ignored) drops claim events, keeps notes    */
/* ===================================================================== */
{
  const x = fixture('ac41-l7');
  newEpic(x, T0);
  newTask(x, T0);
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T1 } }), 'claim');
  ok(run(['note', '--id=TSK-001', 'a note', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T2 } }), 'note');
  const before = log(x, ['--id=TSK-001']);
  T.check('L7 fixture: before removal, a claimed event is present',
    ((before.json || {}).events || []).some(e => e.kind === 'claimed'), J(before.json));

  fs.rmSync(claimsDir(x, 'TSK-001'), { recursive: true, force: true });
  const after = log(x, ['--id=TSK-001']);
  T.exit('L7 log still succeeds with no local claims dir', after, 0);
  const kinds = ((after.json || {}).events || []).map(e => e.kind);
  T.eq('L7 only created and the note remain, as a fresh clone would see', kinds, ['created', 'note']);
}

/* ===================================================================== */
/* L8 — an unreadable stub addressed directly: refused:unreadable, not    */
/* show's tolerant file:unreadable (§ 12c — log cannot derive without     */
/* reading the element itself)                                            */
/* ===================================================================== */
{
  const x = fixture('ac41-l8');
  const stub = path.join(x.bl, 'tasks', 'TSK-001.md');
  try { fs.symlinkSync(path.join(x.dir, 'no-such-target'), stub); }
  catch (e) { T.check('fixture: unreadable stub', false, e.code); }
  fs.writeFileSync(path.join(x.bl, '.nanojira', 'ids', 'TSK-001'), '');
  const r = log(x, ['--id=TSK-001']);
  T.exit('L8 log on an unreadable stub: exit 1', r, 1);
  T.eq('L8 refused:unreadable', r.json && r.json.error, 'refused:unreadable');
}

/* ===================================================================== */
/* L9 — human output: one line per event, in merged order (§ 12c)         */
/* ===================================================================== */
{
  const x = fixture('ac41-l9');
  newEpic(x, T0);
  newTask(x, T0);
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T1 } }), 'claim');
  const human = run(['log', '--id=TSK-001'], { cwd: x.dir });
  T.exit('L9 human output: exit 0', human, 0);
  T.check('L9 one line mentions created', /created/.test(human.stdout), J(human.stdout));
  T.check('L9 one line mentions claimed by alice', /claimed by alice/.test(human.stdout), J(human.stdout));
  T.eq('L9 exactly two lines (one per event)', human.stdout.trim().split('\n').length, 2);
}

/* ===================================================================== */
/* L10 — `nj help` lists `log` (§ 9, § 12c)                                */
/* ===================================================================== */
{
  const x = fixture('ac41-l10');
  const r = run(['help'], { cwd: x.dir });
  T.exit('L10 nj help: exit 0', r, 0);
  T.check('L10 help text mentions the log command', /\blog\b/.test(r.stdout), J(r.stdout).slice(0, 200));
}

/* ===================================================================== */
/* L11 — the nj-mcp `log` tool (§ 17, AC-32 amended)                      */
/* ===================================================================== */
(async () => {
  function mcpFixture(label) {
    const x = fixture(label);
    newEpic(x, T0);
    newTask(x, T0);
    ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: x.dir, env: { NJ_NOW: T1 } }), 'claim');
    return x;
  }
  function spawnMcp(x, args, env) {
    return MCP.spawnServer(H.NJ_MCP, ['--backlog=' + x.bl].concat(args || []),
      { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
  }
  async function withServer(x, args, env, fn) {
    const s = spawnMcp(x, args, env);
    try { await fn(s); } finally { await s.close(); }
  }

  const cliFixture = mcpFixture('ac41-l11-cli');
  const cli = log(cliFixture, ['--id=TSK-001']);
  const mcpFixtureX = mcpFixture('ac41-l11-mcp');
  await withServer(mcpFixtureX, [], {}, async s => {
    const r = await s.modernToolsCall('log', { id: 'TSK-001' });
    T.check('L11 log via MCP: no protocol-level error', !r.error, J(r.error));
    const content = r.result && r.result.structuredContent;
    T.eq('L11 log: MCP structuredContent is byte-identical to `dist/nj --json`', content, cli.json);
  });

  T.finish();
})();
