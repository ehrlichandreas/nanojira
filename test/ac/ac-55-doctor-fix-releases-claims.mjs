/* AC-55 — `nj doctor --fix` releases every claim on a final-status
 * element, docs/SPECIFICATION.md § 14 "`--fix`" step 7b, § 12a "Final
 * status releases the claim" (v3.10, DECISIONS 182 A, promoted: commit
 * <pending>).
 *
 * AC-55 (§ 15 item 57): "`nj doctor --fix` releases every claim still
 * held on an element in the final status -- live or archived, whoever
 * holds it -- the same unconditional release `set`/`claim --status=<last>`
 * already perform in one write (§ 12a), applied in bulk. Same claim-log
 * entry (`released <holder>`, next generation); the element's own file
 * is never touched either way. Claims on elements NOT in the final
 * status are never touched by --fix, stale or not. Plain `doctor` (no
 * --fix) never releases anything. Named in `fixed[]`, one line per
 * element, naming the id and the released holder. Idempotent: a second
 * --fix releases nothing."
 *
 * Found by feedback/team-a: a backlog move turned up 32
 * claim:stale warnings, all on elements set to done before v3.8's own
 * automatic release existed -- their cleanup had to pose as each holder
 * (`release --as=<holder>`) one at a time.
 *
 * Written before the fix lands: red everywhere until step 7b exists.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }
function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args, cwd, env) { return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }
function runJ(args, cwd, env) { return H.runJson(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] }); }

function fixture(label) {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: NOW }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.',
    '--acceptance=- [x] x'], dir, { NJ_NOW: NOW }), 'new task');
  return dir;
}

function claimsDir(dir, id) { return path.join(dir, 'backlog', '.nanojira', 'claims', id); }
/** Hand-write a single `claimed <name>` entry at generation 1 and mirror
 * `assignee` the same way a real `nj claim` would, WITHOUT ever setting
 * `status` in that same call -- so v3.8 B's own automatic release never
 * fires, leaving exactly the "done, claimed, never released" state the
 * fix exists for (the same construction ac-29-stale-claims.js uses for
 * `claim:stale`). */
function claimAt(dir, id, name, since) {
  fs.mkdirSync(claimsDir(dir, id), { recursive: true });
  fs.writeFileSync(path.join(claimsDir(dir, id), '1'), 'claimed\n' + name + '\n' + since + '\n');
  ok(run(['set', '--id=' + id, '--assignee=' + name], dir, { NJ_NOW: since }), 'mirror assignee=' + name);
}
/** Same, but for an element already archived: `nj set` refuses to write to
 * an archived element at all (read-only, round one), so there is no way
 * to mirror `assignee` through a real command -- only the claim directory
 * itself can be reconstructed, exactly the residue a straight backlog
 * move/copy could leave behind independent of `nj archive`'s own
 * wholesale removal on its own normal path. */
function claimAtArchived(dir, id, name, since) {
  fs.mkdirSync(claimsDir(dir, id), { recursive: true });
  fs.writeFileSync(path.join(claimsDir(dir, id), '1'), 'claimed\n' + name + '\n' + since + '\n');
}
function elementFile(dir, id, archived) {
  return path.join(dir, 'backlog', archived ? 'archive' : 'tasks', id + '.md');
}
function bytes(p) { return H.readOrNull(p); }
function highestEntry(dir, id) {
  const gens = H.lsOrEmpty(claimsDir(dir, id)).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (gens.length === 0) return null;
  return fs.readFileSync(path.join(claimsDir(dir, id), String(gens[gens.length - 1])), 'utf8');
}

/* ===================================================================== */
/* C1 -- a LIVE done element, claimed, never released: --fix releases it */
/* ===================================================================== */
{
  const dir = fixture('ac55-c1');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: NOW }), 'set done (unclaimed, nothing to release yet)');
  claimAt(dir, 'TSK-001', 'alice', NOW);
  const before = bytes(elementFile(dir, 'TSK-001'));

  const f = runJ(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C1 doctor --fix on a done, claimed element: exit 0', f, 0);
  T.check('C1 fixed[] names TSK-001 and alice',
    Array.isArray(f.json && f.json.fixed) && f.json.fixed.some(l => l.includes('TSK-001') && l.includes('alice')),
    J(f.json && f.json.fixed));

  T.eq('C1 the element file is byte-identical (a release never touches the file)',
    bytes(elementFile(dir, 'TSK-001')), before);

  const entry = highestEntry(dir, 'TSK-001');
  T.check('C1 the claim log\'s highest entry is "released\\nalice\\n<ts>\\n" -- same shape as v3.8 B\'s own release',
    !!entry && /^released\nalice\n.+\n$/.test(entry), J(entry));

  const show = runJ(['show', '--id=TSK-001'], dir, { NJ_NOW: NOW });
  T.eq('C1 the element reads as unclaimed afterward', show.json && show.json.entries[0]._claim, null);

  const d2 = runJ(['doctor'], dir, { NJ_NOW: NOW });
  T.check('C1 a plain doctor afterward: no claim:stale, no claim:orphaned left to report',
    !(H.doctorSet(d2) || []).some(code => code.startsWith('claim:')), J(d2.json && d2.json.problems));
}

/* ===================================================================== */
/* C2 -- the prose form (no --json) also names the id and holder         */
/* ===================================================================== */
{
  const dir = fixture('ac55-c2');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: NOW }), 'set done');
  claimAt(dir, 'TSK-001', 'bob', NOW);

  const f = run(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C2 doctor --fix: exit 0', f, 0);
  T.check('C2 prose output names TSK-001 and bob on a FIXED line',
    /FIXED.*TSK-001.*bob/.test(f.stdout) || /FIXED.*bob.*TSK-001/.test(f.stdout), f.stdout);
}

/* ===================================================================== */
/* C3 -- an ARCHIVED done element still carrying a claim directory: also */
/* released (the team-a case: a straight backlog move/copy can      */
/* leave claim artefacts behind independent of `nj archive`'s own        */
/* wholesale removal on the normal path)                                 */
/* ===================================================================== */
{
  const dir = fixture('ac55-c3');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: NOW }), 'set done');
  ok(run(['archive', '--id=TSK-001'], dir, { NJ_NOW: NOW }), 'archive the done task');
  /* Hand-write the claim directory AFTER archiving: `nj archive` itself
   * already removes any claim a normal archive would have found, so this
   * reconstructs the residual state directly -- the same black-box
   * technique ac-29/ac-50 already use for claim fixtures nj's own verbs
   * cannot produce in one step. */
  claimAtArchived(dir, 'TSK-001', 'carol', NOW);
  T.check('fixture: the archived file carries the hand-written claim directory',
    fs.existsSync(claimsDir(dir, 'TSK-001')), claimsDir(dir, 'TSK-001'));

  const f = runJ(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C3 doctor --fix on an archived done element with a claim: exit 0', f, 0);
  T.check('C3 fixed[] names TSK-001 and carol',
    Array.isArray(f.json && f.json.fixed) && f.json.fixed.some(l => l.includes('TSK-001') && l.includes('carol')),
    J(f.json && f.json.fixed));
  T.check('C3 no claim directory survives for TSK-001 (released, and/or pruned as orphaned -- either way, gone)',
    !fs.existsSync(claimsDir(dir, 'TSK-001')) || !/^claimed/.test(highestEntry(dir, 'TSK-001') || ''),
    J(H.lsOrEmpty(claimsDir(dir, 'TSK-001'))));
}

/* ===================================================================== */
/* C4 -- claims on an UNFINISHED element are never touched, stale or not */
/* ===================================================================== */
{
  const dir = fixture('ac55-c4');
  claimAt(dir, 'TSK-001', 'dave', '2026-01-01T00:00:00Z'); // long ago: definitely stale too
  const beforeFile = bytes(elementFile(dir, 'TSK-001'));
  const beforeEntry = highestEntry(dir, 'TSK-001');

  const f = runJ(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C4 doctor --fix: exit 0', f, 0);
  T.check('C4 fixed[] does not mention TSK-001\'s claim',
    !(f.json && f.json.fixed || []).some(l => l.includes('TSK-001') && /release/i.test(l)), J(f.json && f.json.fixed));
  T.eq('C4 the element file is untouched', bytes(elementFile(dir, 'TSK-001')), beforeFile);
  T.eq('C4 the claim log gained no new entry', highestEntry(dir, 'TSK-001'), beforeEntry);

  const d2 = runJ(['doctor'], dir, { NJ_NOW: NOW });
  T.check('C4 claim:stale is still reported after --fix (never repaired, only finality triggers release)',
    (H.doctorSet(d2) || []).includes('claim:stale:warning'), J(d2.json && d2.json.problems));
}

/* ===================================================================== */
/* C5 -- plain `doctor` (no --fix) never releases anything                */
/* ===================================================================== */
{
  const dir = fixture('ac55-c5');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: NOW }), 'set done');
  claimAt(dir, 'TSK-001', 'erin', NOW);
  const beforeFile = bytes(elementFile(dir, 'TSK-001'));
  const beforeEntry = highestEntry(dir, 'TSK-001');

  const d = runJ(['doctor'], dir, { NJ_NOW: NOW });
  T.exit('C5 plain doctor: exit 0 (a warning, if any, never raises it)', d, 0);
  T.eq('C5 plain doctor: the element file is untouched', bytes(elementFile(dir, 'TSK-001')), beforeFile);
  T.eq('C5 plain doctor: the claim log gained no new entry', highestEntry(dir, 'TSK-001'), beforeEntry);
  T.check('C5 plain doctor: no fixed[] key at all (not --fix)', !('fixed' in (d.json || {})), J(d.json));
}

/* ===================================================================== */
/* C6 -- idempotent: a second --fix releases nothing                      */
/* ===================================================================== */
{
  const dir = fixture('ac55-c6');
  ok(run(['set', '--id=TSK-001', '--status=done'], dir, { NJ_NOW: NOW }), 'set done');
  claimAt(dir, 'TSK-001', 'frank', NOW);

  const f1 = runJ(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C6 first --fix: exit 0', f1, 0);
  const afterFirst = highestEntry(dir, 'TSK-001');

  const f2 = runJ(['doctor', '--fix'], dir, { NJ_NOW: NOW });
  T.exit('C6 second --fix: exit 0', f2, 0);
  T.check('C6 second --fix: fixed[] carries no release for TSK-001 (nothing left to release)',
    !(f2.json && f2.json.fixed || []).some(l => l.includes('TSK-001') && /release/i.test(l)), J(f2.json && f2.json.fixed));
  T.eq('C6 the claim log is unchanged by the second --fix', highestEntry(dir, 'TSK-001'), afterFirst);
}

T.finish();
