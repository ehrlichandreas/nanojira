'use strict';
/* AC-27 — `nj claim` / `nj release`, docs/SPECIFICATION.md § 9 "The acting
 * name", § 12 "Claims", § 12a, § 11a's claims paragraph, § 14 step 7a, § 7
 * (DECISIONS 110, 114, 115, 117, commit b7ffad6).
 *
 * AC-27 (§ 15): "Twenty processes run `nj claim --id=TSK-001` in parallel,
 * each with its own acting name: exactly one exits 0; the other nineteen
 * exit 1 with `refused:claimed` naming the winner; the element is claimed by
 * the winner and its `assignee` is the winner's name; `doctor` is clean but
 * for `backlog:claims_unignored` where the fixture's `.gitignore` lacks the
 * line. A claim by the holder again is exit 0, re-asserting with one more
 * `claimed` entry — `changed` is empty unless `--status` changes the status.
 * `release` by another name is `refused:claimed`; by the holder it releases
 * the claim and keeps `assignee`. Steal race: ten concurrent
 * `--steal=<holder>` have exactly one winner, and no claim is lost — the
 * final holder is the one process that reported success, the claim sequence
 * holds exactly one `claimed` entry per successful claim or steal and
 * nothing between them, and a steal naming the wrong holder, run
 * concurrently with the others, changes nothing. A landed steal whose own
 * `assignee` write then fails is reported as `claim:mismatch`, not rolled
 * back — the steal stands. `release` racing a steal of the same claim:
 * exactly one of the two succeeds. `NJ_AUTHOR=b nj list --ready` omits an
 * element claimed by `a` and lists one claimed by `b`; a backlog without
 * claims answers `--ready` exactly as before condition 5 existed. A claimed
 * element can still be `set`, `note`d, archived and removed by anyone, and
 * `archive`/`rm` remove its claim. A plain claim whose `assignee` write
 * fails (`NJ_FAULT=before-rename`) is rolled back and ends `released`; a
 * re-assertion whose `assignee` write fails instead keeps its claim — its
 * rollback restores `claimed N`, the entry it read, not a release. A
 * done-but-live element keeps its claim through `doctor --fix` (only
 * archived or gone elements are `claim:orphaned`); a stray temp file in the
 * claims tree is `backlog:stray_tmp`, removed by `doctor --fix`. `nj
 * unarchive` of an element with a leftover orphaned claim directory removes
 * it wholesale, the same as `archive`/`rm`, before the first move: the
 * unarchived element starts unclaimed unless a straggler's append raced the
 * removal. `nj init` writes `.nanojira/claims/` into `.gitignore`; on an
 * existing backlog with claims, `doctor --fix` appends it once, keeping
 * CRLF, and never creates a missing `.gitignore`. `claim` without a name is
 * `missing_argument`; on an archived element, `refused:archived`. `--as`
 * outranks `NJ_AUTHOR`; an invalid `--as` is `invalid_value`, an invalid
 * `NJ_AUTHOR` is `invalid_env`, on `claim`, `release` and `note` alike."
 *
 * NOT DETERMINISTICALLY TESTABLE: the straggler-race outcome during
 * `nj unarchive`'s claim-dir removal (a claim's own in-flight `link()`
 * landing in the exact window between the removal's `readdir` and its
 * `unlink`s) has no fault hook to force it, unlike `before-compare`'s
 * go-marker. C8 below tests the common, forceable case (the removal runs
 * with nothing racing it); the race itself is recorded as AMBIGUITIES.md 85,
 * in the spirit of `stress/concurrency.js`'s "NOT COVERED" retry leg. The
 * meaning of a third kind of file in a claims directory — neither a
 * generation nor a `.nj-tmp-*` temp file — is also unpinned; recorded as
 * AMBIGUITIES.md 84. C10 asserts only that such a file does not crash a
 * read, nothing stronger.
 *
 * Written before `nj claim` exists: red everywhere until it is implemented.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
const LATER = H.LATER_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac27-home');
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset = [];
  for (const k of ['NJ_AUTHOR', 'NJ_BACKLOG', 'NJ_FAULT']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }
const at = t => ({ NJ_NOW: t });
const later = env => Object.assign({ NJ_NOW: LATER }, env || {});

/* ---- fixtures: `nj init`/`nj new` only -------------------------------- */

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* EPIC-001 with TSK-001 and TSK-002, both todo and complete (ready-eligible,
 * so --ready / condition 5 has something to show either way). */
function model(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const body = ['--description=Something.', '--acceptance=- [x] It works'];
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=The epic.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task one'].concat(body), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task two'].concat(body), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  return { dir, bl };
}

function taskPath(id) {
  if (/^EPIC-/.test(id)) return path.join('epics', id + '.md');
  if (/^SUB-/.test(id)) return path.join('subtasks', id + '.md');
  return path.join('tasks', id + '.md');
}
function elementFile(x, id) { return path.join(x.bl, taskPath(id)); }
function assigneeOf(x, id) {
  const b = H.readOrNull(elementFile(x, id)) || '';
  const m = /^assignee: (.*)$/m.exec(b);
  return m ? m[1] : undefined;
}
function statusOf(x, id) {
  const b = H.readOrNull(elementFile(x, id)) || '';
  const m = /^status: (.*)$/m.exec(b);
  return m ? m[1] : undefined;
}

function claim(x, args, env) {
  const a = typeof args === 'string' ? ['--id=' + args] : args;
  return runJ(['claim'].concat(a), { cwd: x.dir, env: later(env) });
}
function release(x, args, env) {
  const a = typeof args === 'string' ? ['--id=' + args] : args;
  return runJ(['release'].concat(a), { cwd: x.dir, env: later(env) });
}

function claimsDir(x, id) { return path.join(x.bl, '.nanojira', 'claims', id); }
function genNames(x, id) { return H.lsOrEmpty(claimsDir(x, id)).filter(n => /^\d+$/.test(n)); }
function genNums(x, id) { return genNames(x, id).map(Number).sort((a, b) => a - b); }
function readGen(x, id, g) { return H.readOrNull(path.join(claimsDir(x, id), String(g))); }
function highest(x, id) {
  const ns = genNums(x, id);
  if (!ns.length) return null;
  const g = ns[ns.length - 1];
  const raw = readGen(x, id, g);
  if (raw === null) return null;
  const [kind, name, time] = raw.split('\n');
  return { gen: g, kind, name, time };
}
function writeGen(x, id, g, kind, name, time) {
  const d = claimsDir(x, id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, String(g)), kind + '\n' + name + '\n' + time + '\n');
}

/* Every file below `root`, with bytes — for "nothing changed" checks. */
function snapshot(root) {
  const out = [];
  (function walk(abs, rel) {
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { return; }
    if (st.isDirectory()) {
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    if (st.isSymbolicLink()) { out.push(rel + ' ->' + fs.readlinkSync(abs)); return; }
    out.push(rel + ' ' + H.sha256(fs.readFileSync(abs)));
  })(root, '.');
  return out;
}
function sameTree(desc, before, after) {
  const gone = before.filter(l => !after.includes(l)), added = after.filter(l => !before.includes(l));
  return T.check(desc, !gone.length && !added.length,
    (gone.length ? 'before only: ' + J(gone.slice(0, 5)) + '\n     ' : '') + (added.length ? 'after only: ' + J(added.slice(0, 5)) : ''));
}

/** A refusal: exit 1 both human and `--json`, a clean message, nothing written. */
function refused(desc, x, cmd, args, code, env) {
  const before = snapshot(x.dir);
  const r = run([cmd].concat(args), { cwd: x.dir, env: later(env) });
  T.exit(desc + ': exit 1', r, 1);
  T.check(desc + ': the prose starts with "Error: "', /^Error: /.test(r.stderr || ''), J(r.stderr));
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test(r.stderr || ''), J(r.stderr));
  const rj = runJ([cmd].concat(args), { cwd: x.dir, env: later(env) });
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: {ok:false}', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 200));
  T.eq(desc + ' --json: error is ' + code, rj.json && rj.json.error, code);
  sameTree(desc + ': no byte of the backlog changed', before, snapshot(x.dir));
  return rj;
}

/* ===================================================================== */
/* C1 — claim, re-assert, steal, release: the state machine (§ 12a)       */
/* ===================================================================== */
{
  const x = model('ac27-c1');

  const r1 = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C1 plain claim: exit 0', r1, 0);
  T.eq('C1 plain claim: assignee is alice', assigneeOf(x, 'TSK-001'), 'alice');
  T.eq('C1 plain claim: one entry, generation 1', genNums(x, 'TSK-001'), [1]);
  T.eq('C1 plain claim: entry 1 is "claimed alice"', (highest(x, 'TSK-001') || {}).kind + ' ' + (highest(x, 'TSK-001') || {}).name, 'claimed alice');
  T.check('C1 --json: {ok:true, claim:{by:"alice"}}', !!r1.json && r1.json.ok === true && r1.json.claim && r1.json.claim.by === 'alice', J(r1.json).slice(0, 300));
  T.check('C1 --json: changed names assignee', ((r1.json || {}).changed || []).includes('assignee'), J(r1.json && r1.json.changed));

  const r2 = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C1 re-assert (same name, already held): exit 0', r2, 0);
  T.eq('C1 re-assert: a new entry is appended (generation 2)', genNums(x, 'TSK-001'), [1, 2]);
  T.eq('C1 re-assert: entry 2 is claimed alice again', (highest(x, 'TSK-001') || {}).name, 'alice');
  T.eq('C1 re-assert: changed is empty (no --status)', (r2.json || {}).changed, []);

  const r3 = claim(x, 'TSK-001', { NJ_AUTHOR: 'bob' });
  T.exit('C1 a different name while held: exit 1', r3, 1);
  T.eq('C1 a different name while held: refused:claimed', r3.json && r3.json.error, 'refused:claimed');
  T.check('C1 refused:claimed names the holder alice', /alice/.test(r3.stderr || ''), J(r3.stderr));
  T.eq('C1 refused:claimed: nothing appended', genNums(x, 'TSK-001'), [1, 2]);
  T.eq('C1 refused:claimed: assignee unchanged', assigneeOf(x, 'TSK-001'), 'alice');

  const r4 = claim(x, ['--id=TSK-001', '--steal=alice'], { NJ_AUTHOR: 'bob' });
  T.exit('C1 steal from the right holder: exit 0', r4, 0);
  T.eq('C1 steal: assignee is now bob', assigneeOf(x, 'TSK-001'), 'bob');
  T.eq('C1 steal: a new entry 3, claimed bob', genNums(x, 'TSK-001'), [1, 2, 3]);
  T.eq('C1 steal: --json stolen_from is alice', r4.json && r4.json.stolen_from, 'alice');

  const r5 = claim(x, ['--id=TSK-001', '--steal=carol'], { NJ_AUTHOR: 'dave' });
  T.exit('C1 steal naming the wrong holder: exit 1', r5, 1);
  T.eq('C1 steal wrong holder: refused:claimed', r5.json && r5.json.error, 'refused:claimed');
  T.check('C1 steal wrong holder names the real holder bob', /bob/.test(r5.stderr || ''), J(r5.stderr));
  T.eq('C1 steal wrong holder: nothing appended', genNums(x, 'TSK-001'), [1, 2, 3]);

  const r6 = release(x, 'TSK-001', { NJ_AUTHOR: 'carol' });
  T.exit('C1 release by a non-holder: exit 1', r6, 1);
  T.eq('C1 release non-holder: refused:claimed', r6.json && r6.json.error, 'refused:claimed');
  T.check('C1 release non-holder names the holder bob', /bob/.test(r6.stderr || ''), J(r6.stderr));

  const r7 = release(x, 'TSK-001', { NJ_AUTHOR: 'bob' });
  T.exit('C1 release by the holder: exit 0', r7, 0);
  T.eq('C1 release: a new entry 4, released bob', genNums(x, 'TSK-001'), [1, 2, 3, 4]);
  T.eq('C1 release: highest entry is released', (highest(x, 'TSK-001') || {}).kind, 'released');
  T.eq('C1 release: assignee is left as it is (still bob)', assigneeOf(x, 'TSK-001'), 'bob');
  T.eq('C1 release: --json changed is ["claim"]', (r7.json || {}).changed, ['claim']);

  const r8 = release(x, 'TSK-001', { NJ_AUTHOR: 'anyone' });
  T.exit('C1 release on an unclaimed element: exit 0, nothing to do', r8, 0);
  T.eq('C1 release unclaimed: no new entry', genNums(x, 'TSK-001'), [1, 2, 3, 4]);

  const r9 = claim(x, ['--id=TSK-001', '--steal=bob'], { NJ_AUTHOR: 'erin' });
  T.exit('C1 steal of an already-unclaimed element: a plain claim, exit 0', r9, 0);
  T.eq('C1 steal-of-unclaimed: assignee is erin', assigneeOf(x, 'TSK-001'), 'erin');
}

/* C1 refusals before anything is written (§ 12a step 1) */
{
  const x = model('ac27-c1-archived');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set TSK-001 done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() }), 'archive TSK-001');
  refused('C1 claim on an archived element', x, 'claim', ['--id=TSK-001'], 'refused:archived', { NJ_AUTHOR: 'alice' });
}
{
  const x = model('ac27-c1-unreadable');
  const stub = path.join(x.bl, 'tasks', 'TSK-009.md');
  try { fs.symlinkSync(path.join(x.dir, 'no-such-target'), stub); }
  catch (e) { T.check('fixture: unreadable stub', false, e.code); }
  fs.writeFileSync(path.join(x.bl, '.nanojira', 'ids', 'TSK-009'), '');
  refused('C1 claim on an unreadable stub', x, 'claim', ['--id=TSK-009'], 'refused:unreadable', { NJ_AUTHOR: 'alice' });
  const other = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C1 … but not backlog-wide: a different, readable element still claims', other, 0);
}
{
  const x = model('ac27-c1-dup');
  fs.writeFileSync(path.join(x.bl, 'tasks', 'TSK-001-dup.md'),
    H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Dup', status: 'todo', created: NOW, updated: NOW },
      H.completeBody('Dup')));
  refused('C1 claim on a duplicate id without --file', x, 'claim', ['--id=TSK-001'], 'duplicate_id', { NJ_AUTHOR: 'alice' });
  const viaFile = claim(x, ['--file=tasks/TSK-001.md'], { NJ_AUTHOR: 'alice' });
  T.exit('C1 --file disambiguates a duplicate id', viaFile, 0);
}
{
  const x = model('ac27-c1-badstatus');
  refused('C1 claim --status=bogus', x, 'claim', ['--id=TSK-001', '--status=bogus'], 'invalid_value', { NJ_AUTHOR: 'alice' });
}

/* ===================================================================== */
/* C2 — acting name resolution: --as > NJ_AUTHOR > none (§ 9)             */
/* ===================================================================== */
{
  const x = model('ac27-c2-missing');
  const r = claim(x, 'TSK-001', {});
  T.exit('C2 claim with no acting name: exit 1', r, 1);
  T.eq('C2 claim with no acting name: missing_argument', r.json && r.json.error, 'missing_argument');
  const rr = release(x, 'TSK-001', {});
  T.exit('C2 release with no acting name: exit 1', rr, 1);
  T.eq('C2 release with no acting name: missing_argument', rr.json && rr.json.error, 'missing_argument');
}
{
  const x = model('ac27-c2-empty');
  const r = claim(x, 'TSK-001', { NJ_AUTHOR: '' });
  T.exit('C2 empty NJ_AUTHOR counts as unset: exit 1', r, 1);
  T.eq('C2 empty NJ_AUTHOR: missing_argument', r.json && r.json.error, 'missing_argument');
}
for (const bad of [' ', '\t', 'a\nb', 'a\rb', 'a:b']) {
  const x = model('ac27-c2-invalid-env');
  const before = snapshot(x.dir);
  const r = claim(x, 'TSK-001', { NJ_AUTHOR: bad });
  T.exit('C2 NJ_AUTHOR=' + J(bad) + ': exit 1', r, 1);
  T.eq('C2 NJ_AUTHOR=' + J(bad) + ': invalid_env', r.json && r.json.error, 'invalid_env');
  T.check('C2 NJ_AUTHOR=' + J(bad) + ': nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}
/* An empty --as is NOT unset the way an empty NJ_AUTHOR is (§ 9, DECISIONS
 * 119): "empty counts as unset" is stated for the environment variable only;
 * a name "from either source" must be non-empty. */
for (const bad of ['', ' ', '\t', 'a\nb', 'a:b']) {
  const x = model('ac27-c2-invalid-as-claim');
  const before = snapshot(x.dir);
  const r = runJ(['claim', '--id=TSK-001', '--as=' + bad], { cwd: x.dir, env: later() });
  T.exit('C2 claim --as=' + J(bad) + ': exit 1', r, 1);
  T.eq('C2 claim --as=' + J(bad) + ': invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('C2 claim --as=' + J(bad) + ': nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}
for (const bad of ['', ' ', '\t', 'a\nb', 'a:b']) {
  const x = model('ac27-c2-invalid-as-release');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  const before = snapshot(x.dir);
  const r = runJ(['release', '--id=TSK-001', '--as=' + bad], { cwd: x.dir, env: later() });
  T.exit('C2 release --as=' + J(bad) + ': exit 1', r, 1);
  T.eq('C2 release --as=' + J(bad) + ': invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('C2 release --as=' + J(bad) + ': nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}
{
  const x = model('ac27-c2-outrank');
  const r = runJ(['claim', '--id=TSK-001', '--as=erin'], { cwd: x.dir, env: later({ NJ_AUTHOR: 'bogus:name' }) });
  T.exit('C2 valid --as outranks a malformed NJ_AUTHOR: exit 0', r, 0);
  T.eq('C2 --as outranks NJ_AUTHOR: assignee is erin', assigneeOf(x, 'TSK-001'), 'erin');
}
{
  const x = model('ac27-c2-prec');
  const bad = later({ NJ_AUTHOR: 'a:b' });
  const r1 = runJ(['claim', '--id=TSK-001', '--bogus=1'], { cwd: x.dir, env: bad });
  T.eq('C2 precedence: an unknown flag beats the invalid name: unknown_field', r1.json && r1.json.error, 'unknown_field');
  const r2 = runJ(['claim'], { cwd: x.dir, env: bad });
  T.eq('C2 precedence: a missing --id beats the invalid name: missing_argument', r2.json && r2.json.error, 'missing_argument');
  const r3 = runJ(['claim', '--id=TSK-404'], { cwd: x.dir, env: bad });
  T.eq('C2 precedence: the invalid name beats an unknown target: invalid_env', r3.json && r3.json.error, 'invalid_env');
}

/* ===================================================================== */
/* C3 — --status: claim and start in one write (§ 12a)                    */
/* ===================================================================== */
{
  const x = model('ac27-c3');
  const r = claim(x, ['--id=TSK-001', '--status=doing'], { NJ_AUTHOR: 'alice' });
  T.exit('C3 claim --status=doing: exit 0', r, 0);
  T.eq('C3 claim --status=doing: status is doing', statusOf(x, 'TSK-001'), 'doing');
  T.check('C3 claim --status=doing: changed names assignee and status',
    ['assignee', 'status'].every(k => ((r.json || {}).changed || []).includes(k)), J(r.json && r.json.changed));

  const r2 = claim(x, ['--id=TSK-001', '--status=review'], { NJ_AUTHOR: 'alice' });
  T.exit('C3 re-assert with --status changes status: exit 0', r2, 0);
  T.check('C3 re-assert --status: changed names status', ((r2.json || {}).changed || []).includes('status'), J(r2.json && r2.json.changed));
  T.eq('C3 re-assert --status: a new entry is appended', genNums(x, 'TSK-001').length, 2);
  T.eq('C3 re-assert --status: status is review', statusOf(x, 'TSK-001'), 'review');

  refused('C3 claim --status=bogus', x, 'claim', ['--id=TSK-002', '--status=bogus'], 'invalid_value', { NJ_AUTHOR: 'alice' });
}

/* ===================================================================== */
/* C4 — rollback on a failed mirror write (§ 12a, DECISIONS 114/115)      */
/* ===================================================================== */
{
  const x = model('ac27-c4-plain');
  const r = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice', NJ_FAULT: 'before-rename' });
  T.exit('C4 plain claim, mirror write fails: exit 1', r, 1);
  T.eq('C4 plain claim, mirror write fails: fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  T.eq('C4 plain claim rollback: two entries (claimed, then released)', genNums(x, 'TSK-001'), [1, 2]);
  T.eq('C4 plain claim rollback: entry 2 is released', (highest(x, 'TSK-001') || {}).kind, 'released');
  T.eq('C4 plain claim rollback: element ends unclaimed (assignee untouched)', assigneeOf(x, 'TSK-001'), undefined);
  const after = claim(x, 'TSK-001', { NJ_AUTHOR: 'bob' });
  T.exit('C4 … and a later claim by someone else succeeds', after, 0);
}
{
  const x = model('ac27-c4-reassert');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'initial claim');
  const r = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice', NJ_FAULT: 'before-rename' });
  T.exit('C4 re-assertion, mirror write fails: exit 1', r, 1);
  T.eq('C4 re-assertion, mirror write fails: fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  T.eq('C4 re-assertion rollback: three entries', genNums(x, 'TSK-001'), [1, 2, 3]);
  T.check('C4 re-assertion rollback: every entry restores claimed alice (not released)',
    [1, 2, 3].every(g => /^claimed\nalice\n/.test(readGen(x, 'TSK-001', g) || '')),
    J([1, 2, 3].map(g => readGen(x, 'TSK-001', g))));
  T.eq('C4 re-assertion rollback: the claim is kept (assignee still alice)', assigneeOf(x, 'TSK-001'), 'alice');
}
{
  const x = model('ac27-c4-steal');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'initial claim');
  const r = claim(x, ['--id=TSK-001', '--steal=alice'], { NJ_AUTHOR: 'bob', NJ_FAULT: 'before-rename' });
  T.exit('C4 a landed steal, mirror write fails: exit 1', r, 1);
  T.eq('C4 landed steal, mirror write fails: fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  T.eq('C4 landed steal: not rolled back — two entries, both claimed', genNums(x, 'TSK-001'), [1, 2]);
  T.eq('C4 landed steal: the chain says bob', (highest(x, 'TSK-001') || {}).name, 'bob');
  T.eq('C4 landed steal: assignee still says alice (the mirror write failed)', assigneeOf(x, 'TSK-001'), 'alice');
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('C4 landed steal: doctor reports claim:mismatch', (H.doctorSet(d) || []).includes('claim:mismatch:warning'), J(d.json && d.json.problems));
}

/* C4 continued (D138, 47dc2d9, § 12a): the SAME rollback, but triggered by
 * NJ_FAULT=before-compare's TIMEOUT path (no marker ever created) rather
 * than before-rename's immediate abort — the mirror write's guard is the
 * same compare-before-write (§ 12) either way, so the rollback outcome is
 * identical: a plain claim ends released, a re-assertion keeps claimed N. */
function claimTimeout(x, id, authorEnv) {
  const env = Object.assign({ HOME, NJ_NOW: LATER, NJ_FAULT: 'before-compare' }, authorEnv || {});
  return H.runJson(['claim', '--id=' + id], { cwd: x.dir, env, unsetEnv: ['NJ_BACKLOG'], timeout: 15000 });
}
{
  const x = model('ac27-c4-compare-plain');
  const r = claimTimeout(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C4 (before-compare timeout) plain claim, mirror write never confirmed: exit 1', r, 1);
  T.eq('C4 (before-compare timeout): fault:before-compare', r.json && r.json.error, 'fault:before-compare');
  T.eq('C4 (before-compare timeout) plain claim rollback: two entries (claimed, then released)',
    genNums(x, 'TSK-001'), [1, 2]);
  T.eq('C4 (before-compare timeout) plain claim rollback: entry 2 is released', (highest(x, 'TSK-001') || {}).kind, 'released');
  T.eq('C4 (before-compare timeout) plain claim rollback: element ends unclaimed', assigneeOf(x, 'TSK-001'), undefined);
  const after = claim(x, 'TSK-001', { NJ_AUTHOR: 'bob' });
  T.exit('C4 (before-compare timeout) … and a later claim by someone else succeeds', after, 0);
}
{
  const x = model('ac27-c4-compare-reassert');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'initial claim');
  const r = claimTimeout(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C4 (before-compare timeout) re-assertion, mirror write never confirmed: exit 1', r, 1);
  T.eq('C4 (before-compare timeout) re-assertion: fault:before-compare', r.json && r.json.error, 'fault:before-compare');
  T.eq('C4 (before-compare timeout) re-assertion rollback: three entries', genNums(x, 'TSK-001'), [1, 2, 3]);
  T.check('C4 (before-compare timeout) re-assertion rollback: every entry restores claimed alice (not released)',
    [1, 2, 3].every(g => /^claimed\nalice\n/.test(readGen(x, 'TSK-001', g) || '')),
    J([1, 2, 3].map(g => readGen(x, 'TSK-001', g))));
  T.eq('C4 (before-compare timeout) re-assertion rollback: the claim is kept (assignee still alice)',
    assigneeOf(x, 'TSK-001'), 'alice');
}

/* ===================================================================== */
/* C6 — _claim visibility; --ready condition 5 (§ 9)                      */
/* ===================================================================== */
{
  const x = model('ac27-c6');
  const show0 = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  T.eq('C6 _claim is null when unclaimed', show0.json && show0.json.entries[0]._claim, null);
  const list0 = runJ(['list'], { cwd: x.dir });
  T.check('C6 list: _claim is null for every entry when unclaimed',
    (list0.json && list0.json.entries || []).every(e => e._claim === null), J(list0.json && list0.json.entries));

  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  const show1 = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  const c = show1.json && show1.json.entries[0]._claim;
  T.check('C6 _claim is {by, since} when claimed',
    !!c && c.by === 'alice' && typeof c.since === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.since), J(c));

  const readyA = runJ(['list', '--ready'], { cwd: x.dir, env: later({ NJ_AUTHOR: 'alice' }) });
  T.check('C6 --ready as the holder: TSK-001 is included', (readyA.json && readyA.json.entries || []).some(e => e.id === 'TSK-001'), J(readyA.json && readyA.json.entries));
  const readyB = runJ(['list', '--ready'], { cwd: x.dir, env: later({ NJ_AUTHOR: 'bob' }) });
  T.check('C6 --ready as a different name: TSK-001 is excluded', !(readyB.json && readyB.json.entries || []).some(e => e.id === 'TSK-001'), J(readyB.json && readyB.json.entries));
  T.check('C6 --ready as a different name: TSK-002 (unclaimed) is included', (readyB.json && readyB.json.entries || []).some(e => e.id === 'TSK-002'), J(readyB.json && readyB.json.entries));
  const readyNone = runJ(['list', '--ready'], { cwd: x.dir });
  T.check('C6 --ready with no acting name at all: TSK-001 is excluded (an invalid/absent name is no name)', !(readyNone.json && readyNone.json.entries || []).some(e => e.id === 'TSK-001'), J(readyNone.json && readyNone.json.entries));
}

/* ===================================================================== */
/* C7 — .gitignore: init's third pattern, backlog:claims_unignored,       */
/* doctor --fix's append rule including the mixed-ending fallback (§ 12a) */
/* ===================================================================== */
{
  const x = model('ac27-c7-init');
  const gi = H.readOrNull(path.join(x.bl, '.gitignore')) || '';
  const lines = gi.split('\n').map(s => s.trim()).filter(Boolean);
  T.eq('C7 nj init: .gitignore has exactly three patterns', lines.slice().sort().join('|'),
    '.nanojira/claims/|.nanojira/index.json|.nj-tmp-*');
}
function stripClaimsLine(x) {
  const p = path.join(x.bl, '.gitignore');
  fs.writeFileSync(p, (H.readOrNull(p) || '').split('\n').filter(l => l.trim() !== '.nanojira/claims/').join('\n'));
}
{
  const x = model('ac27-c7-unignored');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  stripClaimsLine(x);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('C7 doctor reports backlog:claims_unignored', (H.doctorSet(d) || []).includes('backlog:claims_unignored:warning'), J(d.json && d.json.problems));
}
{
  const x = model('ac27-c7-clean');
  stripClaimsLine(x);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('C7 a backlog that never claimed anything: no backlog:claims_unignored finding',
    !(H.doctorSet(d) || []).includes('backlog:claims_unignored:warning'), J(d.json && d.json.problems));
}
for (const [name, content, expected] of [
  ['LF', 'node_modules/\n', 'node_modules/\n.nanojira/claims/\n'],
  ['CRLF', 'node_modules/\r\n', 'node_modules/\r\n.nanojira/claims/\r\n'],
  ['mixed, last line LF', 'a/\r\nb/\n', 'a/\r\nb/\n.nanojira/claims/\n'],
  ['mixed, last line CRLF', 'a/\nb/\r\n', 'a/\nb/\r\n.nanojira/claims/\r\n'],
  ['no trailing newline', 'node_modules/', 'node_modules/\n.nanojira/claims/\n'],
  ['empty file', '', '.nanojira/claims/\n'],
]) {
  const x = model('ac27-c7-fix-' + name.replace(/[^a-z]/gi, ''));
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  fs.writeFileSync(path.join(x.bl, '.gitignore'), content);
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C7 --fix (' + name + '): exit 0', r, 0);
  T.eq('C7 --fix (' + name + '): appends the line correctly', H.readOrNull(path.join(x.bl, '.gitignore')), expected);
}
{
  const x = model('ac27-c7-nogi');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  fs.rmSync(path.join(x.bl, '.gitignore'));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C7 no .gitignore at all: --fix exit 0', r, 0);
  T.check('C7 no .gitignore: --fix creates none', !fs.existsSync(path.join(x.bl, '.gitignore')), '');
  T.check('C7 no .gitignore: a note says so', (r.json && r.json.notes || []).some(n => J(n).includes('.gitignore')), J(r.json && r.json.notes));
}

/* ===================================================================== */
/* C8 — archive/rm/unarchive remove claim directories (§ 12a, § 11a)      */
/* ===================================================================== */
{
  const x = model('ac27-c8-archive');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  T.check('C8 fixture: the claim directory exists', fs.existsSync(claimsDir(x, 'TSK-001')), '');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  const r = run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() });
  T.exit('C8 archive a claimed, done element: exit 0', r, 0);
  T.check('C8 archive removes the claim directory', !fs.existsSync(claimsDir(x, 'TSK-001')), '');
}
{
  const x = model('ac27-c8-rm');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  const r = run(['rm', '--id=TSK-001'], { cwd: x.dir, env: later() });
  T.exit('C8 rm a claimed element: exit 0', r, 0);
  T.check('C8 rm removes the claim directory', !fs.existsSync(claimsDir(x, 'TSK-001')), '');
}
{
  const x = model('ac27-c8-unarchive');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() }), 'archive');
  T.check('C8 fixture: claim dir gone after archive', !fs.existsSync(claimsDir(x, 'TSK-001')), '');
  const r = run(['unarchive', '--id=TSK-001'], { cwd: x.dir, env: later() });
  T.exit('C8 unarchive: exit 0', r, 0);
  const r2 = claim(x, 'TSK-001', { NJ_AUTHOR: 'bob' });
  T.exit('C8 the unarchived element can be freshly claimed (starts unclaimed)', r2, 0);
  T.eq('C8 … at a fresh generation 1, not inheriting old history', genNums(x, 'TSK-001'), [1]);
}
{
  /* P-6 (DECISIONS 115): a leftover orphaned claim directory — simulating a
   * partially-cleaned archive, whose own cleanup left a straggler's entry —
   * is removed by unarchive before the first move, while the element is
   * still archived. */
  const x = model('ac27-c8-p6');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() }), 'archive');
  writeGen(x, 'TSK-001', 1, 'claimed', 'straggler', LATER);
  T.check('C8 fixture: a leftover claim dir exists on the archived element', fs.existsSync(claimsDir(x, 'TSK-001')), '');
  const r = run(['unarchive', '--id=TSK-001'], { cwd: x.dir, env: later() });
  T.exit('C8 P-6: unarchive removes the leftover claim dir: exit 0', r, 0);
  T.check('C8 P-6: the claim directory is gone', !fs.existsSync(claimsDir(x, 'TSK-001')), '');
}

/* ===================================================================== */
/* C9 — doctor --fix: orphan removal only (archived/gone, never merely    */
/* done); never touches a live claim's entries; claim:mismatch is never   */
/* auto-resolved (§ 12a, § 14 step 7a)                                    */
/* ===================================================================== */
{
  const x = model('ac27-c9-done');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C9 doctor --fix on a done-but-live claimed element: exit 0', r, 0);
  T.check('C9 the claim directory survives (done alone does not orphan it)', fs.existsSync(claimsDir(x, 'TSK-001')), '');
  T.eq('C9 the claim is still active', assigneeOf(x, 'TSK-001'), 'alice');
}
{
  const x = model('ac27-c9-gone');
  writeGen(x, 'TSK-404', 1, 'claimed', 'nobody', LATER);
  T.check('C9 fixture: a claim dir for a nonexistent id exists', fs.existsSync(claimsDir(x, 'TSK-404')), '');
  const d1 = runJ(['doctor'], { cwd: x.dir });
  T.check('C9 doctor reports claim:orphaned (backlog-level, nonexistent id)', (H.doctorSet(d1) || []).includes('claim:orphaned:warning'), J(d1.json && d1.json.problems));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C9 doctor --fix: exit 0', r, 0);
  T.check('C9 --fix removes the orphaned claim dir', !fs.existsSync(claimsDir(x, 'TSK-404')), '');
}
{
  const x = model('ac27-c9-archived');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() }), 'archive');
  writeGen(x, 'TSK-001', 1, 'claimed', 'straggler', LATER);
  const d1 = runJ(['doctor'], { cwd: x.dir });
  T.check('C9 doctor reports claim:orphaned for the archived element', (H.doctorSet(d1) || []).includes('claim:orphaned:warning'), J(d1.json && d1.json.problems));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C9 doctor --fix: exit 0', r, 0);
  T.check('C9 --fix removes it', !fs.existsSync(claimsDir(x, 'TSK-001')), '');
}
{
  const x = model('ac27-c9-live-entries');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 're-assert');
  const before = genNums(x, 'TSK-001').map(g => readGen(x, 'TSK-001', g));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C9 --fix on a live, multi-entry claim: exit 0', r, 0);
  const after = genNums(x, 'TSK-001').map(g => readGen(x, 'TSK-001', g));
  T.eq('C9 --fix never prunes a live claim\'s entries', after, before);
}
{
  const x = model('ac27-c9-mismatch');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim');
  const p = elementFile(x, 'TSK-001');
  fs.writeFileSync(p, (H.readOrNull(p) || '').replace(/^assignee: alice$/m, 'assignee: someone-else'));
  const d1 = runJ(['doctor'], { cwd: x.dir });
  T.check('C9 fixture: claim:mismatch is reported', (H.doctorSet(d1) || []).includes('claim:mismatch:warning'), J(d1.json && d1.json.problems));
  const r = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C9 --fix: exit 0 (a warning never raises the exit code)', r, 0);
  T.eq('C9 --fix never resolves claim:mismatch: assignee is untouched', assigneeOf(x, 'TSK-001'), 'someone-else');
  const d2 = runJ(['doctor'], { cwd: x.dir });
  T.check('C9 claim:mismatch still reported after --fix', (H.doctorSet(d2) || []).includes('claim:mismatch:warning'), J(d2.json && d2.json.problems));
}

/* ===================================================================== */
/* C10 — non-numeric entries in a claims directory (§ 12 "Claims")        */
/* ===================================================================== */
{
  const x = model('ac27-c10-stray-tmp');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim');
  fs.mkdirSync(claimsDir(x, 'TSK-001'), { recursive: true });
  fs.writeFileSync(path.join(claimsDir(x, 'TSK-001'), '.nj-tmp-12345-abcde'), 'claimed\nghost\n' + LATER + '\n');
  const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  T.eq('C10 a stray temp file is not mistaken for a generation: _claim.by is still alice',
    show.json && show.json.entries[0]._claim && show.json.entries[0]._claim.by, 'alice');
  const r = claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' });
  T.exit('C10 a re-assert still works alongside the stray temp file: exit 0', r, 0);
  T.eq('C10 the new entry is generation 2, numeric, ignoring the temp file', genNums(x, 'TSK-001'), [1, 2]);
  const d = runJ(['doctor'], { cwd: x.dir });
  T.check('C10 doctor reports the stray temp file as backlog:stray_tmp', (H.doctorSet(d) || []).includes('backlog:stray_tmp:warning'), J(d.json && d.json.problems));
  const f = runJ(['doctor', '--fix'], { cwd: x.dir });
  T.exit('C10 --fix: exit 0', f, 0);
  T.check('C10 --fix removes the stray temp file (step 7, now covers claims/)',
    !fs.existsSync(path.join(claimsDir(x, 'TSK-001'), '.nj-tmp-12345-abcde')), '');
  T.eq('C10 --fix leaves the real entries untouched', genNums(x, 'TSK-001'), [1, 2]);
}
{
  /* AMBIGUITIES.md 84: a third kind of file (neither a generation nor a
   * .nj-tmp-* temp file) is unpinned. Asserted here only as "must not
   * crash a read" — nothing stronger. */
  const x = model('ac27-c10-junk');
  ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'alice' }), 'claim');
  fs.mkdirSync(claimsDir(x, 'TSK-001'), { recursive: true });
  fs.writeFileSync(path.join(claimsDir(x, 'TSK-001'), 'README'), 'not a generation\n');
  const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  T.check('C10 an unrecognised file in the claims dir does not crash a read',
    !!show.json && !!show.json.entries && !!show.json.entries[0]._claim && show.json.entries[0]._claim.by === 'alice',
    J(show.json));
}
{
  /* Numeric ordering, not lexicographic (string "10" < "9"): generation 10
   * must read as higher than single-digit generations. */
  const x = model('ac27-c10-numeric');
  for (let g = 1; g <= 10; g++) writeGen(x, 'TSK-001', g, 'claimed', 'g' + g, LATER);
  const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  T.eq('C10 the highest generation is found numerically (10), not lexicographically (9)',
    show.json && show.json.entries[0]._claim && show.json.entries[0]._claim.by, 'g10');
}

/* ===================================================================== */
/* C5 — concurrency, real parallel processes (§ 12a, AC-27)               */
/* ===================================================================== */
function spawnNj(args, cwd, env) {
  const e = Object.assign({}, process.env, { NJ_NOW: LATER, HOME }, env);
  delete e.NJ_BACKLOG;
  return new Promise(resolve => {
    const inv = H.njCommand(H.NJ, args);
    const child = spawn(inv.cmd, inv.args, { cwd, env: e });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', er => resolve({ status: null, stdout: '', stderr: String(er.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}
function parseJsonStdout(r) {
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

(async () => {
  {
    const x = model('ac27-c5-claim');
    const N = 20;
    const names = Array.from({ length: N }, (_, i) => 'agent-' + i);
    const results = await pool(names, N, name =>
      spawnNj(['claim', '--id=TSK-001', '--json'], x.dir, { NJ_AUTHOR: name }));
    const winnerIdx = results.map((r, i) => (r.status === 0 ? i : -1)).filter(i => i >= 0);
    T.check('C5 exactly one of ' + N + ' parallel claimants wins', winnerIdx.length === 1, 'winners: ' + winnerIdx.length);
    const winnerName = winnerIdx.length === 1 ? names[winnerIdx[0]] : null;
    const losers = results.filter((r, i) => winnerIdx[0] !== i);
    T.check('C5 every other claimant exits 1 refused:claimed naming the winner', losers.every(r => {
      const j = parseJsonStdout(r);
      return r.status === 1 && j && j.error === 'refused:claimed';
    }), J(losers.slice(0, 3).map(r => r.stdout)));
    T.eq('C5 assignee is the winner', assigneeOf(x, 'TSK-001'), winnerName);
    const d = runJ(['doctor'], { cwd: x.dir });
    T.exit('C5 doctor exits 0', d, 0);
    T.sameSet('C5 doctor is clean', H.doctorSet(d) || ['<no problems array>'], []);
  }
  {
    const x = model('ac27-c5-steal');
    ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'holder' }), 'initial claim');
    const N = 10;
    const names = Array.from({ length: N }, (_, i) => 'stealer-' + i);
    const results = await pool(names, N, name =>
      spawnNj(['claim', '--id=TSK-001', '--steal=holder', '--json'], x.dir, { NJ_AUTHOR: name }));
    const winners = results.filter(r => r.status === 0);
    T.check('C5 steal race: exactly one of ' + N + ' wins', winners.length === 1, 'winners: ' + winners.length);
    const claimedCount = genNums(x, 'TSK-001').filter(g => (readGen(x, 'TSK-001', g) || '').startsWith('claimed')).length;
    T.eq('C5 steal race: exactly 2 claimed entries total (initial + the one winner) — no claim lost', claimedCount, 2);
    const losers = results.filter(r => r.status !== 0);
    T.check('C5 steal race: every other steal exits 1 refused:claimed', losers.every(r => {
      const j = parseJsonStdout(r);
      return r.status === 1 && j && j.error === 'refused:claimed';
    }), J(losers.slice(0, 3).map(r => r.stdout)));
  }
  {
    /* DECISIONS 120: unlike two steals, a release racing a steal is not
     * "exactly one wins" — if the release lands first, the steal's retry
     * reads unclaimed and becomes a plain claim (§ 12a "Stealing" bullet 3),
     * so both exit 0. If the steal lands first, the release reads a
     * different holder and is refused:claimed naming the stealer. Either
     * way the stealer ends up holding it. Repeated over several rounds,
     * like the suite's other races, since either landing order is possible
     * and one run could get lucky and never exercise the other. */
    const ROUNDS = 8;
    for (let round = 1; round <= ROUNDS; round++) {
      const x = model('ac27-c5-release-steal-' + round);
      ok(claim(x, 'TSK-001', { NJ_AUTHOR: 'holder' }), 'initial claim');
      const [relR, stealR] = await Promise.all([
        spawnNj(['release', '--id=TSK-001', '--json'], x.dir, { NJ_AUTHOR: 'holder' }),
        spawnNj(['claim', '--id=TSK-001', '--steal=holder', '--json'], x.dir, { NJ_AUTHOR: 'stealer' }),
      ]);
      const tag = 'C5 release racing a steal (round ' + round + ')';
      T.exit(tag + ': the steal exits 0', stealR, 0);
      const relJson = parseJsonStdout(relR);
      T.check(tag + ': the release exits 0, or refused:claimed naming the stealer',
        relR.status === 0 || (relR.status === 1 && relJson && relJson.error === 'refused:claimed'),
        J({ status: relR.status, stdout: relR.stdout }));
      const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
      const c = show.json && show.json.entries[0]._claim;
      T.check(tag + ': the stealer ends up holding it', !!c && c.by === 'stealer', J(c));
      T.eq(tag + ': assignee agrees', assigneeOf(x, 'TSK-001'), 'stealer');
      const d = runJ(['doctor'], { cwd: x.dir });
      T.check(tag + ': no claim:mismatch', !(H.doctorSet(d) || []).includes('claim:mismatch:warning'), J(d.json && d.json.problems));
    }
  }

  T.finish();
})();
