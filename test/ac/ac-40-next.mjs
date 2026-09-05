/* AC-40 — `nj next`, docs/SPECIFICATION.md § 12b (v3.5, DECISIONS 154,
 * promoted: commit 1406a40).
 *
 * AC-40 (§ 15): "Given N `--ready` elements and M concurrent `nj next
 * --as=<distinct name each>` calls with M <= N, every call exits 0 and
 * claims a distinct element; with M > N, exactly N calls succeed and the
 * rest exit 1 none_ready. A single `nj next --as=a` claims the
 * highest-priority, lowest-id `--ready` element — the same order `list
 * --ready`/bare `nj` print; --type, --tag, --parent and --assignee narrow
 * the candidate set exactly as they narrow `list --ready`'s. An element
 * already claimed by the acting name is itself `--ready` (§ 9 condition
 * 5) and a valid, re-assertable candidate — `next --as=a` on a backlog
 * where `a` already holds the top candidate re-asserts it, exit 0,
 * changed empty unless --status changes the status. --status=<s> claims
 * and sets status in the one write, exactly as on claim; omitted, status
 * is untouched. No acting name is missing_argument. Nothing --ready at
 * all, or every candidate losing its race, is none_ready, exit 1,
 * {ok: false, error, hint?} — no extra field. A successful claim's result
 * is claim's own shape plus skipped, the ids raced away before it, in
 * attempt order, always present ([] when none). An element that becomes
 * unreadable, archived, or turns out to be a duplicate_id after being
 * read as --ready but before next reaches it is surfaced as that
 * failure, not silently skipped — only refused:claimed advances to the
 * next candidate. --id=A,B,C and --file are not accepted. A failed
 * mirror write on the winning claim rolls back exactly as a plain
 * claim's would (§ 12a)."
 *
 * Written before `nj next` exists: red everywhere until it is
 * implemented.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.mjs';
import * as MCP from '../lib/mcp-stdio.mjs';
const T = H.T;

H.requireNj();
H.requireNjMcp();

const NOW = H.FIXED_NOW;
const LATER = H.LATER_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac40-home');
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

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* A complete (ready-eligible) task body. */
const BODY = ['--description=Something.', '--acceptance=- [x] It works'];

function taskPath(id) {
  if (/^EPIC-/.test(id)) return path.join('epics', id + '.md');
  if (/^SUB-/.test(id)) return path.join('subtasks', id + '.md');
  return path.join('tasks', id + '.md');
}
function elementFile(x, id) { return path.join(x.bl, taskPath(id)); }
function statusOf(x, id) {
  const b = H.readOrNull(elementFile(x, id)) || '';
  const m = /^status: (.*)$/m.exec(b);
  return m ? m[1] : undefined;
}
function claimsDir(x, id) { return path.join(x.bl, '.nanojira', 'claims', id); }
function genNums(x, id) {
  return H.lsOrEmpty(claimsDir(x, id)).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
}

function next(x, args, env) {
  const a = Array.isArray(args) ? args : [];
  return runJ(['next'].concat(a), { cwd: x.dir, env: later(env) });
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

/* ===================================================================== */
/* N1 — a single candidate: success shape, skipped: [] (§ 12b)            */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n1');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };

  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N1 next --as=alice: exit 0', r, 0);
  T.eq('N1 next: claims TSK-001', r.json && r.json.id, 'TSK-001');
  T.check('N1 next: --json {ok:true, claim:{by:"alice"}}',
    !!r.json && r.json.ok === true && r.json.claim && r.json.claim.by === 'alice', J(r.json).slice(0, 300));
  T.eq('N1 next: skipped is [] (nothing raced away)', r.json && r.json.skipped, []);
  T.eq('N1 next: genNums is [1]', genNums(x, 'TSK-001'), [1]);
}

/* ===================================================================== */
/* N2 — ranking: highest priority, then lowest id (§ 12b, list's order)   */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n2');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  /* Creation order deliberately scrambled vs. the expected ranking, so a
   * pass can't be an accident of insertion order. */
  const specs = [
    ['One', 'normal'], ['Two', 'urgent'], ['Three', 'high'], ['Four', 'low'], ['Five', 'urgent'],
  ];
  for (const [title, priority] of specs) {
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=' + title, '--priority=' + priority].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new ' + title);
  }
  const x = { dir, bl };
  /* TSK-002 (urgent), TSK-005 (urgent): tie broken by id ascending.
   * TSK-003 (high), TSK-001 (normal), TSK-004 (low), in that order. */
  const expected = ['TSK-002', 'TSK-005', 'TSK-003', 'TSK-001', 'TSK-004'];
  for (let i = 0; i < expected.length; i++) {
    const r = next(x, ['--type=task'], { NJ_AUTHOR: 'picker-' + i });
    T.exit('N2 pick ' + (i + 1) + ': exit 0', r, 0);
    T.eq('N2 pick ' + (i + 1) + ' is ' + expected[i], r.json && r.json.id, expected[i]);
  }
  const last = next(x, ['--type=task'], { NJ_AUTHOR: 'picker-last' });
  T.exit('N2 after all 5 are claimed by distinct names: none_ready', last, 1);
  T.eq('N2 exhausted: none_ready', last.json && last.json.error, 'none_ready');
}

/* ===================================================================== */
/* N3 — filters: --type, --tag, --parent, --assignee (§ 12b)              */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n3-type');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Other epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new EPIC-001');
  ok(run(['new', '--type=epic', '--title=Parent', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new EPIC-002');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=Task'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const r = next(x, ['--type=task'], { NJ_AUTHOR: 'alice' });
  T.exit('N3 --type=task: exit 0', r, 0);
  T.eq('N3 --type=task picks the only task, not either ready epic', r.json && r.json.id, 'TSK-001');
}
{
  const dir = H.freshDir('ac40-n3-tag');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--tags=a'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Two', '--tags=b'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  const x = { dir, bl };
  const r = next(x, ['--tag=b'], { NJ_AUTHOR: 'alice' });
  T.exit('N3 --tag=b: exit 0', r, 0);
  T.eq('N3 --tag=b picks TSK-002, not the higher-ranked (lower id) TSK-001', r.json && r.json.id, 'TSK-002');
}
{
  const dir = H.freshDir('ac40-n3-parent');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=A', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new EPIC-001');
  ok(run(['new', '--type=epic', '--title=B', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new EPIC-002');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=Two'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  const x = { dir, bl };
  const r = next(x, ['--parent=EPIC-002'], { NJ_AUTHOR: 'alice' });
  T.exit('N3 --parent=EPIC-002: exit 0', r, 0);
  T.eq('N3 --parent=EPIC-002 picks TSK-002, not the lower-id TSK-001', r.json && r.json.id, 'TSK-002');
}
{
  /* N3's --assignee leg, rewritten (stale vs PA-5, DECISIONS 158): the
   * old version had `--as=alice --assignee=carol` pick TSK-001, assigned
   * to carol — but PA-5 means alice can never get an element assigned to
   * someone else, filter or no filter (AC-44 A6: that combination is
   * always none_ready). The filter itself still needs covering, so this
   * now tests it the only way it composes with PA-5's default: the
   * acting name matching the filter value, and the empty-string filter
   * narrowing to unassigned candidates only. */
  const dir = H.freshDir('ac40-n3-assignee');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--assignee=carol'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Two'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  const x = { dir, bl };

  const asCarol = next(x, ['--assignee=carol'], { NJ_AUTHOR: 'carol' });
  T.exit('N3 --as=carol --assignee=carol: exit 0', asCarol, 0);
  T.eq('N3 --as=carol --assignee=carol picks TSK-001 (hers), not the lower-ranked-by-id TSK-002',
    asCarol.json && asCarol.json.id, 'TSK-001');
}
{
  const dir = H.freshDir('ac40-n3-assignee-empty');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One', '--assignee=carol'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Two'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  const x = { dir, bl };

  const asAliceEmpty = next(x, ['--assignee='], { NJ_AUTHOR: 'alice' });
  T.exit('N3 --as=alice --assignee= (empty): exit 0', asAliceEmpty, 0);
  T.eq('N3 --as=alice --assignee= picks TSK-002 (unassigned), excluding TSK-001 (carol\'s)',
    asAliceEmpty.json && asAliceEmpty.json.id, 'TSK-002');
}

/* ===================================================================== */
/* N4 — re-assertion: an element the caller already holds is itself       */
/* --ready and a valid candidate (§ 9 condition 5, § 12b)                 */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n4');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const r1 = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N4 first next: exit 0', r1, 0);
  T.eq('N4 first next: claims TSK-001', r1.json && r1.json.id, 'TSK-001');

  const r2 = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N4 second next, same caller, only candidate is the one already held: exit 0 (re-assert)', r2, 0);
  T.eq('N4 re-assert: still TSK-001', r2.json && r2.json.id, 'TSK-001');
  T.eq('N4 re-assert: changed is empty (no --status)', (r2.json || {}).changed, []);
  T.eq('N4 re-assert: a new generation is appended', genNums(x, 'TSK-001'), [1, 2]);
  T.eq('N4 re-assert: skipped is []', r2.json && r2.json.skipped, []);

  /* A DIFFERENT acting name never even sees TSK-001 as a candidate (§ 9
   * condition 5 excludes it outright) — not a race, nothing to skip. */
  const r3 = next(x, [], { NJ_AUTHOR: 'bob' });
  T.exit('N4 a different name, nothing else ready: none_ready, not refused:claimed', r3, 1);
  T.eq('N4 bob: none_ready', r3.json && r3.json.error, 'none_ready');
}

/* ===================================================================== */
/* N5 — --status: claim and start in the one write (§ 12b, as on claim)   */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n5');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const r = next(x, ['--status=doing'], { NJ_AUTHOR: 'alice' });
  T.exit('N5 next --status=doing: exit 0', r, 0);
  T.eq('N5 status is doing', statusOf(x, 'TSK-001'), 'doing');
  T.check('N5 changed names assignee and status',
    ['assignee', 'status'].every(k => ((r.json || {}).changed || []).includes(k)), J(r.json && r.json.changed));

  const bad = next(x, ['--status=bogus'], { NJ_AUTHOR: 'bob' });
  T.exit('N5 next --status=bogus: exit 1', bad, 1);
  T.eq('N5 next --status=bogus: invalid_value', bad.json && bad.json.error, 'invalid_value');
}

/* ===================================================================== */
/* N6 — none_ready: nothing ready at all (§ 12b)                          */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n6-empty');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  const x = { dir, bl };
  const before = snapshot(x.dir);
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N6 no elements at all: none_ready, exit 1', r, 1);
  T.eq('N6 empty backlog: none_ready', r.json && r.json.error, 'none_ready');
  T.check('N6 empty backlog: nothing extra beyond {ok,error,hint?}',
    !r.json || Object.keys(r.json).every(k => ['ok', 'error', 'hint'].includes(k)), J(r.json));
  T.check('N6 nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}
{
  const dir = H.freshDir('ac40-n6-incomplete');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Incomplete'], { cwd: dir, env: at(NOW) }), 'new TSK-001, incomplete');
  const x = { dir, bl };
  const r = next(x, ['--type=task'], { NJ_AUTHOR: 'alice' });
  T.exit('N6 the only task is incomplete, so not --ready: none_ready', r, 1);
  T.eq('N6 incomplete-only: none_ready', r.json && r.json.error, 'none_ready');
}

/* ===================================================================== */
/* N7 — missing acting name (§ 9, § 12b)                                  */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n7');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const before = snapshot(x.dir);
  const r = next(x, [], {});
  T.exit('N7 next with no acting name: exit 1', r, 1);
  T.eq('N7 next with no acting name: missing_argument', r.json && r.json.error, 'missing_argument');
  T.check('N7 nothing written', J(snapshot(x.dir)) === J(before), 'changed');

  const r2 = next(x, [], { NJ_AUTHOR: '' });
  T.exit('N7 empty NJ_AUTHOR counts as unset: exit 1', r2, 1);
  T.eq('N7 empty NJ_AUTHOR: missing_argument', r2.json && r2.json.error, 'missing_argument');
}

/* ===================================================================== */
/* N8 — --id and --file are not accepted (§ 12b "Not applicable")         */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n8');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const before = snapshot(x.dir);
  const r1 = next(x, ['--id=TSK-001'], { NJ_AUTHOR: 'alice' });
  T.exit('N8 next --id=TSK-001: exit 1', r1, 1);
  T.eq('N8 next --id=…: unknown_field', r1.json && r1.json.error, 'unknown_field');
  const r2 = next(x, ['--file=tasks/TSK-001.md'], { NJ_AUTHOR: 'alice' });
  T.exit('N8 next --file=…: exit 1', r2, 1);
  T.eq('N8 next --file=…: unknown_field', r2.json && r2.json.error, 'unknown_field');
  T.check('N8 nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}

/* ===================================================================== */
/* N9 — rollback on a failed mirror write (§ 12b, inherits § 12a step 3)  */
/* ===================================================================== */
{
  const dir = H.freshDir('ac40-n9');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice', NJ_FAULT: 'before-rename' });
  T.exit('N9 mirror write fails: exit 1', r, 1);
  T.eq('N9 mirror write fails: fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  T.eq('N9 rollback: two entries (claimed, then released)', genNums(x, 'TSK-001'), [1, 2]);
  const after = next(x, [], { NJ_AUTHOR: 'bob' });
  T.exit('N9 … and a later next by someone else succeeds', after, 0);
  T.eq('N9 bob gets TSK-001', after.json && after.json.id, 'TSK-001');
}

/* ===================================================================== */
/* N10 — leaf work only: a `--ready` element with an open child is not a  */
/* candidate, whatever the filters (§ 12b, DECISIONS 156)                 */
/* ===================================================================== */
{
  /* An epic with an open (not done, not archived) task is skipped in
   * favour of that task. */
  const dir = H.freshDir('ac40-n11-skip');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Open'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N10 epic with an open task: exit 0', r, 0);
  T.eq('N10 the open task is picked, not the epic that contains it', r.json && r.json.id, 'TSK-001');

  /* --type=epic does not make the container eligible either — the rule
   * applies whatever the filters. */
  const r2 = next(x, ['--type=epic'], { NJ_AUTHOR: 'bob' });
  T.exit('N10 --type=epic, but the only epic still has an open child: none_ready', r2, 1);
  T.eq('N10 --type=epic: none_ready, not the epic', r2.json && r2.json.error, 'none_ready');
}
{
  /* A childless epic is itself a valid candidate — closing it is real
   * work. */
  const dir = H.freshDir('ac40-n11-childless');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N10 a childless epic: exit 0', r, 0);
  T.eq('N10 the childless epic is picked', r.json && r.json.id, 'EPIC-001');
}
{
  /* An epic whose only child is done (not archived) has no OPEN child
   * left, so it is a candidate again. */
  const dir = H.freshDir('ac40-n11-alldone');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Done'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: dir, env: at(NOW) }), 'set TSK-001 done');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N10 an epic whose only child is done: exit 0', r, 0);
  T.eq('N10 the epic is picked (no open child left)', r.json && r.json.id, 'EPIC-001');
}
{
  /* An archived child does not count as open either. */
  const dir = H.freshDir('ac40-n11-archived');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Gone'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: dir, env: at(NOW) }), 'set TSK-001 done');
  ok(run(['archive', '--id=TSK-001'], { cwd: dir, env: later() }), 'archive TSK-001');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N10 an epic whose only child is archived: exit 0', r, 0);
  T.eq('N10 the epic is picked (an archived child never counts as open)', r.json && r.json.id, 'EPIC-001');
}
{
  /* The same rule one level down: a task with an open subtask is
   * skipped in favour of the subtask — and the epic above the task is
   * ALSO excluded, since the task (its child) is itself open. */
  const dir = H.freshDir('ac40-n11-subtask');
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=subtask', '--parent=TSK-001', '--title=Sub'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new SUB-001');
  const x = { dir, bl };
  const r = next(x, [], { NJ_AUTHOR: 'alice' });
  T.exit('N10 task with an open subtask: exit 0', r, 0);
  T.eq('N10 the open subtask is picked, not the task or the epic above it', r.json && r.json.id, 'SUB-001');
}

/* ===================================================================== */
/* N11 — concurrency, real parallel processes (§ 12b, AC-40)              */
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
  let n = 0;
  async function runner() {
    for (;;) {
      const i = n++;
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
function readyFixture(label, n) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  for (let i = 0; i < n; i++) {
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task ' + i].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new task ' + i);
  }
  return { dir, bl };
}

(async () => {
  {
    /* M == N: every process succeeds, each claims a DISTINCT element. */
    const N = 5;
    const x = readyFixture('ac40-n10-eq', N);
    const names = Array.from({ length: N }, (_, i) => 'agent-' + i);
    const results = await pool(names, N, name => spawnNj(['next', '--json'], x.dir, { NJ_AUTHOR: name }));
    T.check('N11 (M==N) every one of ' + N + ' concurrent next calls exits 0',
      results.every(r => r.status === 0), J(results.map(r => ({ status: r.status, out: r.stdout.slice(0, 120) }))));
    const ids = results.map(r => (parseJsonStdout(r) || {}).id);
    T.check('N11 (M==N) every claimed id is distinct', new Set(ids).size === N, J(ids));
    const d = runJ(['doctor'], { cwd: x.dir });
    T.sameSet('N11 (M==N) doctor is clean', H.doctorSet(d) || ['<no problems array>'], []);
  }
  {
    /* M > N: exactly N succeed, the rest exit 1 none_ready. */
    const N = 3, M = 10;
    const x = readyFixture('ac40-n10-gt', N);
    const names = Array.from({ length: M }, (_, i) => 'agent-' + i);
    const results = await pool(names, M, name => spawnNj(['next', '--json'], x.dir, { NJ_AUTHOR: name }));
    const winners = results.filter(r => r.status === 0);
    const losers = results.filter(r => r.status !== 0);
    T.eq('N11 (M>N) exactly ' + N + ' of ' + M + ' succeed', winners.length, N);
    const ids = winners.map(r => (parseJsonStdout(r) || {}).id);
    T.check('N11 (M>N) every winner claims a distinct element', new Set(ids).size === N, J(ids));
    T.check('N11 (M>N) every loser is none_ready', losers.every(r => {
      const j = parseJsonStdout(r);
      return r.status === 1 && j && j.error === 'none_ready';
    }), J(losers.slice(0, 3).map(r => r.stdout)));
  }
  {
    /* skipped[]: two processes, two ready elements with distinct priority
     * so both target the SAME top candidate first. Exactly one process
     * wins it outright (skipped: []); the other necessarily loses that
     * race and falls through to the second element (skipped: [the first
     * id]) — deterministic in outcome, not just probable, because there
     * are exactly as many candidates as losers-plus-winners at each rank. */
    const dir = H.freshDir('ac40-n10-skipped');
    const bl = path.join(dir, 'backlog');
    ok(run(['init'], { cwd: dir }), 'nj init');
    ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Top', '--priority=urgent'].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new TSK-001 (urgent)');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Second', '--priority=low'].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new TSK-002 (low)');
    const x = { dir, bl };
    const [ra, rb] = await Promise.all([
      spawnNj(['next', '--json'], x.dir, { NJ_AUTHOR: 'alice' }),
      spawnNj(['next', '--json'], x.dir, { NJ_AUTHOR: 'bob' }),
    ]);
    const ja = parseJsonStdout(ra), jb = parseJsonStdout(rb);
    T.exit('N11 (skipped) alice: exit 0', ra, 0);
    T.exit('N11 (skipped) bob: exit 0', rb, 0);
    const ids = [ja && ja.id, jb && jb.id].sort();
    T.eq('N11 (skipped) the two winners claim TSK-001 and TSK-002 between them', ids, ['TSK-001', 'TSK-002']);
    const onTop = ja && ja.id === 'TSK-001' ? ja : jb;
    const onSecond = ja && ja.id === 'TSK-001' ? jb : ja;
    T.eq('N11 (skipped) whoever got TSK-001 (the top candidate) skipped nothing', onTop && onTop.skipped, []);
    T.eq('N11 (skipped) whoever fell through to TSK-002 skipped TSK-001', onSecond && onSecond.skipped, ['TSK-001']);
  }

  /* ===================================================================== */
  /* N12 — the nj-mcp `next` tool (§ 17, AC-32 amended, AC-40)              */
  /* ===================================================================== */
  {
    function mcpFixture(label) {
      const dir = H.freshDir(label);
      const bl = path.join(dir, 'backlog');
      ok(run(['init'], { cwd: dir }), 'nj init');
      ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
      ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
      return { dir, bl };
    }
    function spawnMcp(x, args, env) {
      return MCP.spawnServer(H.NJ_MCP, ['--backlog=' + x.bl].concat(args || []),
        { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
    }
    async function withServer(x, args, env, fn) {
      const s = spawnMcp(x, args, env);
      try { await fn(s); } finally { await s.close(); }
    }
    function normalizeRoot(value, root) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value).split(root).join('<FIXTURE-ROOT>'));
    }

    const cliFixture = mcpFixture('ac40-n11-cli');
    const cli = runJ(['next'], { cwd: cliFixture.dir, env: { NJ_AUTHOR: 'alice', NJ_NOW: NOW }, unsetEnv: ['NJ_BACKLOG'] });
    const mcpFixtureX = mcpFixture('ac40-n11-mcp');
    await withServer(mcpFixtureX, [], {}, async s => {
      const r = await s.modernToolsCall('next', { as: 'alice' });
      T.check('N12 next via MCP: no protocol-level error', !r.error, J(r.error));
      const content = r.result && r.result.structuredContent;
      T.eq('N12 next: MCP structuredContent is byte-identical to `dist/nj --json` (fixture roots normalized)',
        normalizeRoot(content, mcpFixtureX.dir), normalizeRoot(cli.json, cliFixture.dir));
    });

    const failFixture = mcpFixture('ac40-n11-fail');
    const cliFail = runJ(['next'], { cwd: failFixture.dir, env: {}, unsetEnv: ['NJ_AUTHOR', 'NJ_BACKLOG'] });
    const mcpFailFixture = mcpFixture('ac40-n11-fail-mcp');
    await withServer(mcpFailFixture, [], {}, async s => {
      const r = await s.modernToolsCall('next', {});
      T.check('N12 next via MCP, no `as`: no protocol-level error', !r.error, J(r.error));
      T.check('N12 next via MCP, no `as`: isError true', r.result && r.result.isError === true, J(r.result));
      T.eq('N12 next via MCP, no `as`: the unmodified {ok:false, error, hint?} body', r.result && r.result.structuredContent, cliFail.json);
    });
  }

  /* ===================================================================== */
  /* N13 — a mid-loop, non-race failure on the candidate `next` is CURRENTLY */
  /* processing must surface immediately, never advance (§ 12b step 3).      */
  /*                                                                          */
  /* `refused:archived`/`refused:unreadable`/`duplicate_id` are each excluded */
  /* from the `--ready` candidate set UPSTREAM of next's own loop (confirmed  */
  /* below in the "unreachable" sub-block) — an archived, unreadable or       */
  /* duplicate-id element is never even a candidate to begin with, so none    */
  /* of the three can be the code `next` itself surfaces mid-loop. The one    */
  /* available seam that genuinely reaches the loop's per-candidate          */
  /* resolve/claim step after the snapshot was taken is `NJ_FAULT=           */
  /* before-compare` on the top candidate's own guarded write (the same      */
  /* hook test/fault/nj-fault-before-compare.js already uses for `set`):    */
  /* it pauses `next` AFTER the snapshot and AFTER the claim-generation CAS  */
  /* has already decided "unclaimed, proceed" for the top candidate, so a    */
  /* concurrent edit to the TOP candidate's own bytes makes ITS OWN resumed  */
  /* compare fail with `changed_in_parallel` — a non-`refused:claimed`       */
  /* failure, exercising the exact code path (the loop's uncaught re-throw)  */
  /* `refused:archived`/`refused:unreadable` would also hit if they were     */
  /* ever reachable mid-loop. A SECOND candidate is independently broken     */
  /* (archived / made unreadable) during the very same pause, with no        */
  /* contention of its own (nothing else is touching it) — proving `next`    */
  /* never advances to look at it: the asserted error is `next`'s own        */
  /* `changed_in_parallel`, never the second candidate's `refused:archived`/ */
  /* `refused:unreadable` (which is exactly what the "advance on any         */
  /* failure" mutation would instead produce, since it would reach the       */
  /* second candidate and fail on IT).                                      */
  /* ===================================================================== */
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function midLoopFailureFixture(label) {
    const dir = H.freshDir(label);
    const bl = path.join(dir, 'backlog');
    ok(run(['init'], { cwd: dir }), 'nj init');
    ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Top', '--priority=urgent'].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new TSK-001 (top)');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Second', '--priority=low'].concat(BODY),
      { cwd: dir, env: at(NOW) }), 'new TSK-002 (second)');
    return { dir, bl };
  }

  /** Runs `next` paused on TSK-001 (the top candidate) via before-compare,
   * breaks TSK-002 (the second candidate) via `breakSecond`, concurrently
   * edits TSK-001's own bytes so its OWN resumed compare fails, then
   * releases the pause and returns the result. */
  async function runMidLoopFailure(x, breakSecond) {
    const env = Object.assign({}, process.env, { NJ_NOW: LATER, HOME, NJ_FAULT: 'before-compare', NJ_AUTHOR: 'alice' });
    delete env.NJ_BACKLOG;
    const inv = H.njCommand(H.NJ, ['next', '--json']);
    const child = spawn(inv.cmd, inv.args, { cwd: x.dir, env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const done = new Promise(resolve => child.on('close', code => resolve({ status: code, stdout: out, stderr: err })));

    await sleep(1000); // let next's first read of TSK-001 land (matches the existing before-compare fault test's own convention)
    breakSecond(x);
    ok(run(['set', '--id=TSK-001', '--priority=high'], { cwd: x.dir, env: later() }), 'concurrent edit of TSK-001 (the paused candidate)');
    fs.writeFileSync(path.join(x.bl, '.nj-fault-go'), '');
    return done;
  }

  {
    const x = await midLoopFailureFixture('ac40-n13-archived');
    const r = await runMidLoopFailure(x, xx => {
      ok(run(['set', '--id=TSK-002', '--status=done'], { cwd: xx.dir, env: later() }), 'mark TSK-002 done before archiving');
      ok(run(['archive', '--id=TSK-002'], { cwd: xx.dir, env: later() }), 'archive TSK-002 mid-pause');
    });
    const j = parseJsonStdout(r);
    T.exit('N13 (archived second candidate) exit 1', r, 1);
    T.eq('N13 (archived second candidate) surfaces changed_in_parallel, not refused:archived — next never reached TSK-002',
      j && j.error, 'changed_in_parallel');
    T.check('N13 (archived second candidate) TSK-002 was archived but never claimed',
      !/assignee:/.test(H.readOrNull(path.join(x.bl, 'archive', 'TSK-002.md')) || ''), '');
  }
  {
    const x = await midLoopFailureFixture('ac40-n13-unreadable');
    const r = await runMidLoopFailure(x, xx => {
      const stub = path.join(xx.bl, 'tasks', 'TSK-002.md');
      fs.rmSync(stub);
      fs.symlinkSync(path.join(xx.dir, 'no-such-target'), stub);
    });
    const j = parseJsonStdout(r);
    T.exit('N13 (unreadable second candidate) exit 1', r, 1);
    T.eq('N13 (unreadable second candidate) surfaces changed_in_parallel, not refused:unreadable — next never reached TSK-002',
      j && j.error, 'changed_in_parallel');
  }

  /* duplicate_id: confirmed UNREACHABLE as a next-specific mid-loop failure
   * — § 7's problem table marks duplicate_id as blocking --ready, so a
   * duplicated candidate is excluded from next's own candidate snapshot
   * from the start (never attempted, let alone mid-loop); the Verifier's
   * own note already hedged this ("duplicate_id, if reachable"). Asserted
   * here directly rather than left unstated, confirming the exclusion
   * rather than assuming it. */
  {
    const dir = H.freshDir('ac40-n13-duplicate-unreachable');
    const bl = path.join(dir, 'backlog');
    ok(run(['init'], { cwd: dir }), 'nj init');
    ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
    ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=One'].concat(BODY), { cwd: dir, env: at(NOW) }), 'new TSK-001');
    fs.writeFileSync(path.join(bl, 'tasks', 'TSK-001-dup.md'),
      H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Dup', status: 'todo', created: NOW, updated: NOW },
        H.completeBody('Dup')));
    const x = { dir, bl };
    const r = next(x, [], { NJ_AUTHOR: 'alice' });
    T.exit('N13 a duplicate-id-only ready set: exit 1', r, 1);
    T.eq('N13 duplicate_id is unreachable mid-loop: next reports none_ready, not duplicate_id',
      r.json && r.json.error, 'none_ready');
  }

  T.finish();
})();
