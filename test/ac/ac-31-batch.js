'use strict';
/* AC-31 — Batch writes (`--id=A,B,C`), docs/SPECIFICATION.md § 4 (`STATUS.md`
 * once per batch), § 9 "Batch writes", § 12 (restates atomicity unchanged;
 * D135, 2f17921, pins NJ_FAULT to firing once per batch)
 * (v3.2 proposal § D, promoted: DECISIONS 123/125/134, commit 01622e7).
 *
 * AC-31 (§ 15): "`--id=A,B,C` on `set`, `note`, `check`, `claim` or
 * `release` applies the same field map or action to all named IDs. A
 * preflight failure on any one ID (unknown ID, a repeated ID —
 * `invalid_value` — ambiguous `check` target, invalid field value,
 * missing/invalid acting name, an archived element, an unreadable stub)
 * aborts the whole batch — nothing is written for any ID, and `STATUS.md`
 * is not regenerated — and is reported for the ID(s) that failed. Once
 * preflight passes for every ID, each one writes independently: a
 * `--force`-less parallel edit on one ID during the write phase fails only
 * that ID with `changed_in_parallel`, a competing claim is
 * `refused:claimed` only for that ID, and every other ID still succeeds;
 * `STATUS.md` is regenerated once, after every ID's write phase has
 * finished, provided at least one ID was actually written. Exit 0 only
 * when every ID succeeded, 1 otherwise. `--id=A,B,C` with `--file` is
 * `invalid_target`. The JSON shape is exactly `{ok, results: [{id, ok,
 * …}]}`, `results` in the order `--id` named the elements, each entry the
 * single-write §9/§12a shape for its command plus `id` — failures
 * optionally carry `hint`, exactly as a single write's failure shape does;
 * a single `--id=A` (no comma) is unaffected and keeps today's unwrapped
 * shape."
 *
 * Written before batch writes exist: red everywhere until implemented.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
const LATER = H.LATER_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac31-home');
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

/* EPIC-001 with TSK-001/002/003, all todo and complete. */
function model(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const body = ['--description=Something.', '--acceptance=- [ ] It works'];
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=The epic.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task one'].concat(body), { cwd: dir, env: at(NOW) }), 'new TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task two'].concat(body), { cwd: dir, env: at(NOW) }), 'new TSK-002');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task three'].concat(body), { cwd: dir, env: at(NOW) }), 'new TSK-003');
  return { dir, bl };
}

function taskPath(id) { return path.join('tasks', id + '.md'); }
function elementFile(x, id) { return path.join(x.bl, taskPath(id)); }
function bytes(p) { return H.readOrNull(p); }
function statusPath(x) { return path.join(x.bl, 'STATUS.md'); }

function assigneeOf(x, id) {
  const b = bytes(elementFile(x, id)) || '';
  const m = /^assignee: (.*)$/m.exec(b);
  return m ? m[1] : undefined;
}
function priorityOf(x, id) {
  const b = bytes(elementFile(x, id)) || '';
  const m = /^priority: (.*)$/m.exec(b);
  return m ? m[1] : undefined;
}

function resultOf(json, id) {
  return ((json && json.results) || []).find(r => r.id === id);
}

/* An unreadable stub (a dangling symlink), § 6, tombstoned so `new` would
 * never re-mint the id — the same fixture pattern ac-27-claim.js uses. */
function addUnreadableStub(x, id) {
  const stub = elementFile(x, id);
  try { fs.symlinkSync(path.join(x.dir, 'no-such-target'), stub); }
  catch (e) { T.check('fixture: unreadable stub ' + id, false, e.code); }
  fs.writeFileSync(path.join(x.bl, '.nanojira', 'ids', id), '');
}

/* ===================================================================== */
/* H1 — a single --id=A (no comma) is unaffected: unwrapped shape          */
/* ===================================================================== */
{
  const x = model('ac31-h1');
  const r = runJ(['set', '--id=TSK-001', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H1 single --id: exit 0', r, 0);
  T.check('H1 single --id: no results array, today\'s unwrapped shape',
    !!r.json && r.json.ok === true && !('results' in r.json) && r.json.id === 'TSK-001', J(r.json));
}

/* ===================================================================== */
/* H2 — the basic batch: all succeed, wrapper shape, order preserved       */
/* ===================================================================== */
{
  const x = model('ac31-h2');
  const r = runJ(['set', '--id=TSK-003,TSK-001,TSK-002', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H2 batch all succeed: exit 0', r, 0);
  T.check('H2 top level: {ok: true, results}', !!r.json && r.json.ok === true && Array.isArray(r.json.results), J(r.json));
  T.eq('H2 results are in the order --id named them (not sorted)',
    (r.json.results || []).map(e => e.id), ['TSK-003', 'TSK-001', 'TSK-002']);
  T.check('H2 every result has ok:true and the single-write shape plus id',
    (r.json.results || []).every(e => e.ok === true && Array.isArray(e.changed) && e.entry && Array.isArray(e._problems)),
    J(r.json.results));
  T.eq('H2 all three priorities actually changed', ['TSK-001', 'TSK-002', 'TSK-003'].map(id => priorityOf(x, id)), ['high', 'high', 'high']);
}

/* ===================================================================== */
/* H3 — preflight: an unknown ID aborts the whole batch; results names     */
/* only the failing id (D136c), the two innocent ids are absent            */
/* ===================================================================== */
{
  const x = model('ac31-h3');
  const before = [bytes(elementFile(x, 'TSK-001')), bytes(elementFile(x, 'TSK-002'))];
  const r = runJ(['set', '--id=TSK-001,TSK-999,TSK-002', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H3 unknown ID in batch: exit 1', r, 1);
  T.check('H3 unknown ID: reported for the failing id', !!resultOf(r.json, 'TSK-999') && resultOf(r.json, 'TSK-999').error === 'not_found', J(r.json));
  T.eq('H3 (D136c): results lists ONLY TSK-999, not the two innocent ids',
    (r.json && r.json.results || []).map(e => e.id), ['TSK-999']);
  T.eq('H3 nothing written: TSK-001/TSK-002 byte-identical',
    [bytes(elementFile(x, 'TSK-001')), bytes(elementFile(x, 'TSK-002'))], before);
}

/* ===================================================================== */
/* H4 — preflight: a repeated ID (after trimming) is invalid_value          */
/* ===================================================================== */
{
  const x = model('ac31-h4');
  const r = runJ(['set', '--id=TSK-001, TSK-001', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H4 repeated ID (incl. after trimming whitespace): exit 1', r, 1);
  T.eq('H4 repeated ID: invalid_value (D136b: a batch-wide argument error)', r.json && r.json.error, 'invalid_value');
  T.check('H4 repeated ID: the generic unwrapped shape, no results array at all (D136b)', !r.json || !('results' in r.json), J(r.json));
  T.check('H4 repeated ID: nothing written', priorityOf(x, 'TSK-001') !== 'high', priorityOf(x, 'TSK-001'));
}

/* ===================================================================== */
/* H5 — --id=A,B,C with --file is invalid_target (D136b: argument error)   */
/* ===================================================================== */
{
  const x = model('ac31-h5');
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--file=' + taskPath('TSK-001'), '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H5 --id=A,B,C with --file: exit 1', r, 1);
  T.eq('H5: invalid_target', r.json && r.json.error, 'invalid_target');
  T.check('H5: no results array (D136b)', !r.json || !('results' in r.json), J(r.json));
}

/* ===================================================================== */
/* H6 — preflight: an archived element aborts the whole batch; results     */
/* names ONLY the failing id (D136c), the innocent id is absent, not       */
/* merely unwritten                                                       */
/* ===================================================================== */
{
  const x = model('ac31-h6');
  ok(run(['set', '--id=TSK-003', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'TSK-003 done');
  ok(run(['archive', '--id=TSK-003'], { cwd: x.dir, env: later() }), 'archive TSK-003');
  const before = bytes(elementFile(x, 'TSK-001'));
  const r = runJ(['set', '--id=TSK-001,TSK-003', '--priority=high'], { cwd: x.dir, env: later() });
  T.exit('H6 archived element in batch: exit 1', r, 1);
  T.check('H6: reported as refused:archived for TSK-003', resultOf(r.json, 'TSK-003') && resultOf(r.json, 'TSK-003').error === 'refused:archived', J(r.json));
  T.eq('H6 (D136c): results lists ONLY TSK-003, not the innocent TSK-001',
    (r.json && r.json.results || []).map(e => e.id), ['TSK-003']);
  T.eq('H6: TSK-001 (the innocent id) is untouched — whole batch aborted', bytes(elementFile(x, 'TSK-001')), before);
}

/* ===================================================================== */
/* H7 — preflight: an unreadable stub aborts the whole batch; results      */
/* names only the failing id (D136c)                                      */
/* ===================================================================== */
{
  const x = model('ac31-h7');
  addUnreadableStub(x, 'TSK-009');
  const before = bytes(elementFile(x, 'TSK-001'));
  const r = runJ(['set', '--id=TSK-001,TSK-009', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H7 unreadable stub in batch: exit 1', r, 1);
  T.check('H7: reported as refused:unreadable for TSK-009', resultOf(r.json, 'TSK-009') && resultOf(r.json, 'TSK-009').error === 'refused:unreadable', J(r.json));
  T.eq('H7 (D136c): results lists ONLY TSK-009', (r.json && r.json.results || []).map(e => e.id), ['TSK-009']);
  T.eq('H7: TSK-001 untouched', bytes(elementFile(x, 'TSK-001')), before);
}

/* ===================================================================== */
/* H8 — a batch-wide argument error (unknown_field / invalid field value)  */
/* is the generic unwrapped shape, no results array (D136b)                */
/* ===================================================================== */
{
  const x = model('ac31-h8');
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--bogus=x'], { cwd: x.dir, env: at(NOW) });
  T.exit('H8 unknown field: exit 1', r, 1);
  T.eq('H8: unknown_field, argument error (not per-ID)', r.json && r.json.error, 'unknown_field');
  T.check('H8: no results array (D136b)', !r.json || !('results' in r.json), J(r.json));
}
{
  const x = model('ac31-h8b');
  const r = runJ(['set', '--id=TSK-001,TSK-002', '--status=not-a-status'], { cwd: x.dir, env: at(NOW) });
  T.exit('H8b invalid field value: exit 1', r, 1);
  T.eq('H8b (D136b): invalid_value, the generic unwrapped shape', r.json && r.json.error, 'invalid_value');
  T.check('H8b: no results array', !r.json || !('results' in r.json), J(r.json));
  T.check('H8b: nothing written', priorityOf(x, 'TSK-001') !== 'not-a-status', priorityOf(x, 'TSK-001'));
}

/* ===================================================================== */
/* H9 — runtime failure in the middle: a pre-existing claim on B fails     */
/* only B; A and C still succeed (refused:claimed, § 12a)                  */
/* ===================================================================== */
{
  const x = model('ac31-h9');
  ok(run(['claim', '--id=TSK-002', '--as=bob'], { cwd: x.dir, env: at(NOW) }), 'bob claims TSK-002');
  const r = runJ(['claim', '--id=TSK-001,TSK-002,TSK-003', '--as=alice'], { cwd: x.dir, env: later() });
  T.exit('H9 one ID already claimed by another name: exit 1 (not every ID succeeded)', r, 1);
  const ra = resultOf(r.json, 'TSK-001'), rb = resultOf(r.json, 'TSK-002'), rc = resultOf(r.json, 'TSK-003');
  T.check('H9 TSK-001 (A) succeeds', ra && ra.ok === true, J(ra));
  T.check('H9 TSK-002 (B) fails with refused:claimed, naming the holder in hint', rb && rb.ok === false && rb.error === 'refused:claimed', J(rb));
  T.check('H9 TSK-003 (C) still succeeds — a runtime failure on B does not stop C', rc && rc.ok === true, J(rc));
  T.eq('H9 TSK-001 assignee is alice', assigneeOf(x, 'TSK-001'), 'alice');
  T.eq('H9 TSK-002 assignee is still bob (the batch never touched it)', assigneeOf(x, 'TSK-002'), 'bob');
  T.eq('H9 TSK-003 assignee is alice', assigneeOf(x, 'TSK-003'), 'alice');
  T.check('H9 top-level ok is false (not every result succeeded)', r.json && r.json.ok === false, J(r.json));
  T.eq('H9 (form 3, runtime): results names ALL THREE ids, succeeded or not — unlike a preflight abort',
    (r.json && r.json.results || []).map(e => e.id), ['TSK-001', 'TSK-002', 'TSK-003']);
}

/* ===================================================================== */
/* H10 — STATUS.md: not touched when the whole batch fails preflight;      */
/* correctly reflects every change after a partial-success batch           */
/* ===================================================================== */
{
  const x = model('ac31-h10-preflight');
  const before = bytes(statusPath(x));
  const r = runJ(['set', '--id=TSK-001,TSK-999', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H10a preflight-failed batch: exit 1', r, 1);
  T.eq('H10a STATUS.md untouched when nothing was written', bytes(statusPath(x)), before);
}
{
  /* Not independently black-box-observable: whether the regeneration
   * happens exactly once, vs. once per successfully-written ID that
   * happens to converge on the same final bytes either way. What IS
   * observable, and is what this case checks: the end state is the single,
   * fully-converged rendering after every ID's write phase — not a
   * snapshot frozen at an intermediate ID. */
  const x = model('ac31-h10-partial');
  ok(run(['claim', '--id=TSK-002', '--as=bob'], { cwd: x.dir, env: at(NOW) }), 'bob claims TSK-002');
  ok(run(['set', '--id=TSK-001', '--status=doing'], { cwd: x.dir, env: at(NOW) }), 'TSK-001 doing (for STATUS.md content)');
  const r = runJ(['claim', '--id=TSK-001,TSK-002,TSK-003', '--as=alice', '--status=review'], { cwd: x.dir, env: later() });
  T.exit('H10b partial-success batch: exit 1', r, 1);
  T.eq('H10b STATUS.md reflects the fully-converged post-batch state (TSK-001/TSK-003 moved to review)',
    bytes(statusPath(x)), H.statusFor(x.bl));
}

/* ===================================================================== */
/* H11 — note and check also take --id=A,B,C                               */
/* ===================================================================== */
{
  const x = model('ac31-h11-note');
  const r = runJ(['note', '--id=TSK-001,TSK-002', 'A shared note'], { cwd: x.dir, env: at(NOW) });
  T.exit('H11 note batch: exit 0', r, 0);
  T.check('H11 note batch: both files gained the note',
    ['TSK-001', 'TSK-002'].every(id => /A shared note/.test(bytes(elementFile(x, id)) || '')), 'missing on one');
}
{
  const x = model('ac31-h11-check');
  const r = runJ(['check', '--id=TSK-001,TSK-002', '--text=It works', '--on'], { cwd: x.dir, env: at(NOW) });
  T.exit('H11 check batch: exit 0', r, 0);
  T.check('H11 check batch: both boxes ticked',
    ['TSK-001', 'TSK-002'].every(id => /\[x\] It works/.test(bytes(elementFile(x, id)) || '')), 'missing on one');
}
{
  /* check's own preflight (ambiguous_target / not_found) aborts the whole
   * batch, same as any other command's preflight condition. */
  const x = model('ac31-h11-check-ambiguous');
  ok(run(['set', '--id=TSK-002', '--acceptance=- [ ] It works\n- [ ] It works'], { cwd: x.dir, env: at(NOW) }), 'TSK-002 two matching boxes');
  const before = bytes(elementFile(x, 'TSK-001'));
  const r = runJ(['check', '--id=TSK-001,TSK-002', '--text=It works', '--on'], { cwd: x.dir, env: at(NOW) });
  T.exit('H11 check batch with an ambiguous target: exit 1', r, 1);
  T.check('H11: reported as ambiguous_target for TSK-002',
    resultOf(r.json, 'TSK-002') && resultOf(r.json, 'TSK-002').error === 'ambiguous_target', J(r.json));
  T.eq('H11 (D136c): results lists ONLY TSK-002, not the innocent TSK-001',
    (r.json && r.json.results || []).map(e => e.id), ['TSK-002']);
  T.eq('H11: TSK-001 untouched — whole batch aborted', bytes(elementFile(x, 'TSK-001')), before);
}

/* ===================================================================== */
/* H12 — release also takes --id=A,B,C; changed: ["claim"]                 */
/* ===================================================================== */
{
  const x = model('ac31-h12');
  ok(run(['claim', '--id=TSK-001,TSK-002', '--as=alice'], { cwd: x.dir, env: at(NOW) }), 'alice claims TSK-001,TSK-002');
  const r = runJ(['release', '--id=TSK-001,TSK-002', '--as=alice'], { cwd: x.dir, env: later() });
  T.exit('H12 release batch: exit 0', r, 0);
  T.check('H12 both results report changed: ["claim"]',
    (r.json.results || []).every(e => e.ok === true && J(e.changed) === J(['claim'])), J(r.json.results));
}

/* ===================================================================== */
/* H13 — exit code: 0 only when every ID succeeded                        */
/* ===================================================================== */
{
  const x = model('ac31-h13');
  const r = runJ(['set', '--id=TSK-001,TSK-002,TSK-003', '--priority=urgent'], { cwd: x.dir, env: at(NOW) });
  T.exit('H13 every ID succeeds: exit 0', r, 0);
  T.eq('H13 top-level ok is true', r.json && r.json.ok, true);
}

/* ===================================================================== */
/* H14 — human (non --json) output: exits correctly, prints something     */
/* ===================================================================== */
{
  const x = model('ac31-h14');
  const rh = run(['set', '--id=TSK-001,TSK-002', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.exit('H14 human batch: exit 0', rh, 0);
  T.check('H14 human batch: mentions both ids', /TSK-001/.test(rh.stdout) && /TSK-002/.test(rh.stdout), J(rh.stdout));
}

/* ===================================================================== */
/* H15 — NJ_FAULT fires once per batch (D135): the first ID in execution   */
/* order that reaches the hook fails; the hook is then spent, so every     */
/* later ID writes normally                                                */
/* ===================================================================== */
{
  const x = model('ac31-h15');
  const before = bytes(elementFile(x, 'TSK-001'));
  const r = runJ(['set', '--id=TSK-001,TSK-002,TSK-003', '--priority=urgent'],
    { cwd: x.dir, env: Object.assign(at(NOW), { NJ_FAULT: 'before-rename' }) });
  T.exit('H15 a fault mid-batch: exit 1 (not every ID succeeded)', r, 1);
  const ra = resultOf(r.json, 'TSK-001'), rb = resultOf(r.json, 'TSK-002'), rc = resultOf(r.json, 'TSK-003');
  T.check('H15 the first ID in execution order (TSK-001) hits the fault',
    ra && ra.ok === false && ra.error === 'fault:before-rename', J(ra));
  T.eq('H15 TSK-001\'s file is untouched by the aborted write', bytes(elementFile(x, 'TSK-001')), before);
  T.check('H15 the hook is spent: TSK-002 writes normally', rb && rb.ok === true, J(rb));
  T.check('H15 the hook is spent: TSK-003 writes normally too', rc && rc.ok === true, J(rc));
  T.eq('H15 TSK-002/TSK-003 actually got the priority written',
    [priorityOf(x, 'TSK-002'), priorityOf(x, 'TSK-003')], ['urgent', 'urgent']);
  T.check('H15 a single command is unchanged by batches existing: NJ_FAULT still aborts it outright',
    (() => {
      const y = model('ac31-h15-single');
      const single = runJ(['set', '--id=TSK-001', '--priority=urgent'],
        { cwd: y.dir, env: Object.assign(at(NOW), { NJ_FAULT: 'before-rename' }) });
      return single.status === 1 && single.json && single.json.error === 'fault:before-rename' && !('results' in single.json);
    })(), 'single-command NJ_FAULT regressed');
}

/* ===================================================================== */
/* H16 — every batch command's top-level keys are exactly {ok, results},  */
/* on a runtime-completion result AND on a per-ID preflight abort (D137)  */
/* ===================================================================== */
function topKeys(json) { return json ? Object.keys(json).sort() : null; }
{
  const x = model('ac31-h16-set');
  const r1 = runJ(['set', '--id=TSK-001,TSK-002', '--priority=high'], { cwd: x.dir, env: at(NOW) });
  T.eq('H16 set (runtime completion): top-level keys are exactly [ok, results]', topKeys(r1.json), ['ok', 'results']);
  const y = model('ac31-h16-set-abort');
  const r2 = runJ(['set', '--id=TSK-001,TSK-999', '--priority=high'], { cwd: y.dir, env: at(NOW) });
  T.eq('H16 set (preflight abort): top-level keys are exactly [ok, results]', topKeys(r2.json), ['ok', 'results']);
}
{
  const x = model('ac31-h16-note');
  const r1 = runJ(['note', '--id=TSK-001,TSK-002', 'shared note'], { cwd: x.dir, env: at(NOW) });
  T.eq('H16 note (runtime completion): top-level keys are exactly [ok, results]', topKeys(r1.json), ['ok', 'results']);
  const y = model('ac31-h16-note-abort');
  const r2 = runJ(['note', '--id=TSK-001,TSK-999', 'shared note'], { cwd: y.dir, env: at(NOW) });
  T.eq('H16 note (preflight abort): top-level keys are exactly [ok, results]', topKeys(r2.json), ['ok', 'results']);
}
{
  const x = model('ac31-h16-check');
  const r1 = runJ(['check', '--id=TSK-001,TSK-002', '--text=It works', '--on'], { cwd: x.dir, env: at(NOW) });
  T.eq('H16 check (runtime completion): top-level keys are exactly [ok, results]', topKeys(r1.json), ['ok', 'results']);
  const y = model('ac31-h16-check-abort');
  const r2 = runJ(['check', '--id=TSK-001,TSK-999', '--text=It works', '--on'], { cwd: y.dir, env: at(NOW) });
  T.eq('H16 check (preflight abort): top-level keys are exactly [ok, results]', topKeys(r2.json), ['ok', 'results']);
}
{
  const x = model('ac31-h16-claim');
  const r1 = runJ(['claim', '--id=TSK-001,TSK-002', '--as=alice'], { cwd: x.dir, env: at(NOW) });
  T.eq('H16 claim (runtime completion): top-level keys are exactly [ok, results]', topKeys(r1.json), ['ok', 'results']);
  const y = model('ac31-h16-claim-abort');
  const r2 = runJ(['claim', '--id=TSK-001,TSK-999', '--as=alice'], { cwd: y.dir, env: at(NOW) });
  T.eq('H16 claim (preflight abort): top-level keys are exactly [ok, results]', topKeys(r2.json), ['ok', 'results']);
}
{
  const x = model('ac31-h16-release');
  ok(run(['claim', '--id=TSK-001,TSK-002', '--as=alice'], { cwd: x.dir, env: at(NOW) }), 'alice claims TSK-001,TSK-002 for H16');
  const r1 = runJ(['release', '--id=TSK-001,TSK-002', '--as=alice'], { cwd: x.dir, env: later() });
  T.eq('H16 release (runtime completion): top-level keys are exactly [ok, results]', topKeys(r1.json), ['ok', 'results']);
  const y = model('ac31-h16-release-abort');
  ok(run(['claim', '--id=TSK-001', '--as=alice'], { cwd: y.dir, env: at(NOW) }), 'alice claims TSK-001 for H16 abort');
  const r2 = runJ(['release', '--id=TSK-001,TSK-999', '--as=alice'], { cwd: y.dir, env: later() });
  T.eq('H16 release (preflight abort): top-level keys are exactly [ok, results]', topKeys(r2.json), ['ok', 'results']);
}

/* ===================================================================== */
/* H17 — NJ_FAULT=before-compare fires once in a batch too (D135/D137):    */
/* a real parallel writer races TSK-001's compare; the marker is created   */
/* after the parallel edit, so it resolves to changed_in_parallel (§ 12),  */
/* not the 10s timeout's fault:before-compare; TSK-002/TSK-003 still write */
/* ===================================================================== */
(async () => {
  const { spawn } = require('child_process');
  function startNj(args, o) {
    const env = Object.assign({}, process.env, o.env || {});
    for (const k of ['NJ_AUTHOR', 'NJ_BACKLOG']) delete env[k];
    const child = spawn(H.NODE, [H.NJ].concat(args), { cwd: o.cwd, env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const done = new Promise(resolve => {
      child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
      child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
    });
    return done;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const x = model('ac31-h17');
  const before = bytes(elementFile(x, 'TSK-001'));
  const donePromise = startNj(['set', '--id=TSK-001,TSK-002,TSK-003', '--priority=urgent', '--json'],
    { cwd: x.dir, env: Object.assign(at(NOW), { NJ_FAULT: 'before-compare' }) });
  await sleep(1000);                                            // let nj finish TSK-001's first read
  const parallel = (bytes(elementFile(x, 'TSK-001')) || '').replace('status: todo', 'status: doing');
  fs.writeFileSync(elementFile(x, 'TSK-001'), parallel);         // a real concurrent edit
  fs.writeFileSync(path.join(x.bl, '.nj-fault-go'), '');         // release nj
  const r = await donePromise;

  T.check('H17 the batch process does not crash or hang', r.status === 0 || r.status === 1, J(r));
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  T.check('H17 --json still parses', !!json, 'stdout: ' + J(r.stdout) + ' stderr: ' + J(r.stderr));
  T.exit('H17 not every ID succeeded: exit 1', r, 1);
  const ra = resultOf(json, 'TSK-001'), rb = resultOf(json, 'TSK-002'), rc = resultOf(json, 'TSK-003');
  T.check('H17 TSK-001 fails with changed_in_parallel (§ 12: marker created after a parallel edit)',
    ra && ra.ok === false && ra.error === 'changed_in_parallel', J(ra));
  T.eq('H17 TSK-001\'s file reflects ONLY the parallel edit, not nj\'s own write',
    bytes(elementFile(x, 'TSK-001')), parallel);
  T.check('H17 the hook is spent: TSK-002 still writes normally', rb && rb.ok === true, J(rb));
  T.check('H17 the hook is spent: TSK-003 still writes normally too', rc && rc.ok === true, J(rc));
  T.eq('H17 TSK-002/TSK-003 actually got the priority written',
    [priorityOf(x, 'TSK-002'), priorityOf(x, 'TSK-003')], ['urgent', 'urgent']);
  T.eq('H17 (form 3, runtime): results names all three ids', (json && json.results || []).map(e => e.id), ['TSK-001', 'TSK-002', 'TSK-003']);

  /* =================================================================== */
  /* H18 — NJ_FAULT=before-compare with NO marker ever created (D135,     */
  /* D137): TSK-001 waits out the full ~10s timeout and fails with        */
  /* fault:before-compare; the hook is then spent, so TSK-002 is written  */
  /* WITHOUT a second ~10s wait — one timeout per batch, not one per ID.  */
  /* Against 05e8bfa this currently hardExits the whole process instead,  */
  /* killing TSK-002 along with it: expected red.                        */
  /* =================================================================== */
  {
    const y = model('ac31-h18');
    const before18 = bytes(elementFile(y, 'TSK-001'));
    const t0 = Date.now();
    const r18 = H.runJson(['set', '--id=TSK-001,TSK-002', '--priority=urgent'],
      { cwd: y.dir, env: Object.assign(at(NOW), { NJ_FAULT: 'before-compare' }), timeout: 20000 });
    const elapsed = Date.now() - t0;
    T.check('H18 the batch process does not die outright: a status and JSON come back',
      r18.status !== null && !r18.missing, J(r18));
    T.check('H18 --json still parses', !!r18.json, 'stdout: ' + J(r18.stdout) + ' stderr: ' + J(r18.stderr));
    T.exit('H18 not every ID succeeded: exit 1', r18, 1);
    const ra18 = resultOf(r18.json, 'TSK-001'), rb18 = resultOf(r18.json, 'TSK-002');
    T.check('H18 TSK-001 times out after ~10s and fails with fault:before-compare',
      ra18 && ra18.ok === false && ra18.error === 'fault:before-compare', J(ra18));
    T.eq('H18 TSK-001 is left unchanged (the aborted write touched nothing)', bytes(elementFile(y, 'TSK-001')), before18);
    T.check('H18 the hook is spent: TSK-002 still gets written, not also timed out or killed',
      rb18 && rb18.ok === true, J(rb18));
    T.eq('H18 TSK-002 actually got the priority written', priorityOf(y, 'TSK-002'), 'urgent');
    T.eq('H18 (form 3, runtime): results names both ids', (r18.json && r18.json.results || []).map(e => e.id), ['TSK-001', 'TSK-002']);
    T.check('H18 one ~10s wait total, not one per ID (D135: the hook fires once)',
      elapsed < 16000, 'elapsed ' + elapsed + 'ms — looks like a second ~10s wait happened');
  }

  T.finish();
})();
