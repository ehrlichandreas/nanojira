'use strict';
/* § 9's exit-code table and § 12's `fault:<hook>` strings.
 *
 * Three things the suite asserted nowhere before this file:
 *
 * 1. **`fault:before-rename`.** `edge/failure-vocabulary.js` pins
 *    `fault:after-tmp-write` and nothing else; `fault/nj-fault-points.js`
 *    drives both hooks but asserts exit code and file bytes, never the
 *    `error` string. One of the three hook names was therefore free to be
 *    misspelled — `fault:before_rename`, `fault:rename` — with the whole
 *    suite still green, because an agent branching on the string is the only
 *    thing that would notice.
 *
 * 2. **The hooks on the other write commands.** § 12 states the hooks as a
 *    property of the atomic write, not of `nj set`. `new`, `note` and
 *    `archive` all go through it (§ 12 says so for `archive` explicitly), so
 *    all three must abort with the same code and leave the target alone.
 *    `nj new` is the interesting one: there is no previous revision to
 *    preserve, so "leaves the target file untouched" means the element file
 *    must not exist at all.
 *
 * 3. **`2` is `nj doctor` only** (§ 9's exit-code table). Nothing asserted
 *    the negative half. A refactor that routes a doctor helper through a
 *    shared exit path could start returning 2 from `list` on a broken
 *    backlog, and every existing test would still pass — they all assert
 *    0 or 1 on paths where the backlog is clean, or assert 2 on `doctor`.
 *    The same table's row for `0` — "success, including reads that merely
 *    *report* data problems via `_problems`" — is asserted here against a
 *    backlog carrying an `error`-severity problem, which is exactly the
 *    state where a read is most tempting to fail.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT PIN.
 *
 * § 9 declares `invalid_env`, `invalid_backlog_env`, `id_allocation_failed`
 * and `internal_error` **reserved**: "the implementation may emit them from
 * its own error paths, but only from the set. A later revision may pin them."
 * The spec has not decided which path produces which, so asserting one would
 * be inventing a ruling. What § 9 *has* decided for those paths is the
 * envelope: `--json` makes **every** exit path write JSON, on failure
 * `{ok:false, error:"<code>"}` with exit 1, and `error` comes from the closed
 * set. That is asserted; the specific code is not.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* § 9's closed set, transcribed a second time on purpose: if
 * `edge/failure-vocabulary.js` and this file ever disagree about the
 * vocabulary, that disagreement is itself the finding. */
const PLAIN = [
  'no_backlog', 'backlog_without_config', 'invalid_config', 'invalid_env',
  'invalid_backlog_env', 'unknown_field', 'unknown_command', 'missing_argument',
  'missing_value', 'invalid_value', 'invalid_target', 'not_found',
  'duplicate_id', 'exists', 'changed_in_parallel', 'id_allocation_failed',
  'internal_error',
];
const REFUSED = ['unreadable', 'archived', 'children_open', 'has_children',
  'not_done', 'parent_archived'];
const HOOKS = ['before-compare', 'after-tmp-write', 'before-rename'];
const CLOSED = new Set(PLAIN
  .concat(REFUSED.map(r => 'refused:' + r))
  .concat(HOOKS.map(h => 'fault:' + h)));

const NOW = H.FIXED_NOW;
const goodBody = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';

function jsonOf(r) {
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
/* 1 + 2. The `fault:<hook>` strings, on every write command           */
/* ------------------------------------------------------------------ */

/* A backlog with a done epic + done task, so `archive` has something it is
 * allowed to move and `set`/`note` have something to write. */
function writable(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'done',
        created: NOW, updated: NOW,
      }, '# E\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done',
        assignee: 'coder-agent', created: NOW, updated: NOW,
      }, goodBody('T')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

/* The write commands that go through § 12's atomic write. `archive` is
 * included because § 12 names it: "archive routes its comparison through the
 * same guarded path as the other two". */
const WRITES = [
  { name: 'set', args: ['set', '--id=TSK-001', '--status=doing', '--json'], target: 'tasks/TSK-001.md' },
  { name: 'note', args: ['note', '--id=TSK-001', 'a note', '--json'], target: 'tasks/TSK-001.md' },
  /* `archive` moves EPIC-001's whole subtree; the source file must still be
   * in place and archive/ must still be empty. */
  { name: 'archive', args: ['archive', '--id=EPIC-001', '--json'], target: 'epics/EPIC-001.md' },
];

for (const hook of ['after-tmp-write', 'before-rename']) {
  for (const w of WRITES) {
    const d = writable('exit-fault-' + hook + '-' + w.name);
    const targetPath = path.join(d, 'backlog', w.target);
    const before = fs.readFileSync(targetPath, 'utf8');

    const r = H.runNj(w.args, { cwd: d, env: { NJ_FAULT: hook, NJ_NOW: H.LATER_NOW } });
    const tag = 'NJ_FAULT=' + hook + ' on `nj ' + w.name + '`';

    T.exit(tag + ' — exit 1', r, 1);

    /* Null-safe, never guarded — see the note in `exit-doctor-fix.js`: a
     * conditional block here would let an unparseable stdout DELETE the three
     * assertions below instead of failing them, and a shrinking check count
     * is indistinguishable from a passing run. */
    const js = jsonOf(r);
    T.check(tag + ' — stdout is JSON (§ 9: every exit path)', js !== null,
      JSON.stringify(String(r.stdout).slice(0, 200)));
    T.check(tag + ' — ok is false', !!js && js.ok === false,
      JSON.stringify(js && js.ok));
    /* THE assertion this file exists for: the hook names itself, spelled
     * exactly as § 9's `fault:<hook>` row and § 12's hook list agree. */
    T.eq(tag + ' — error is fault:' + hook, js && js.error, 'fault:' + hook);
    T.check(tag + ' — the code is inside the closed set',
      !!js && CLOSED.has(js.error), JSON.stringify(js && js.error));
    T.check(tag + ' — the prose additionally reaches stderr',
      String(r.stderr || '').trim().length > 0, JSON.stringify(r.stderr));

    T.eq(tag + ' — the target is byte-identical',
      H.sha256(fs.readFileSync(targetPath, 'utf8')), H.sha256(before));
    /* § 12 puts the temp file "in the same folder" as the target, so for
     * `archive` a surviving `.nj-tmp-*` inside archive/ is correct and is
     * filtered out here. What must not be there is an *element*: § 11 forbids
     * a partially executed archive, and a fault is the sharpest test of it. */
    T.eq(tag + ' — no element reached archive/',
      JSON.stringify(H.listFiles(d, 'archive').filter(f => !f.startsWith('.nj-tmp-'))), '[]');
  }
}

/* `nj new` under a fault: there is no previous revision, so the observable
 * form of "the target file is untouched" is that no element file appears. */
for (const hook of ['after-tmp-write', 'before-rename']) {
  const d = writable('exit-fault-' + hook + '-new');
  const tasksBefore = H.listFiles(d, 'tasks');

  const r = H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Fresh', '--json'],
    { cwd: d, env: { NJ_FAULT: hook, NJ_NOW: H.LATER_NOW } });
  const tag = 'NJ_FAULT=' + hook + ' on `nj new`';

  T.exit(tag + ' — exit 1', r, 1);
  const js = jsonOf(r);
  T.check(tag + ' — stdout is JSON', js !== null,
    JSON.stringify(String(r.stdout).slice(0, 200)));
  T.eq(tag + ' — error is fault:' + hook, js && js.error, 'fault:' + hook);

  /* The temp file is expected (§ 12 leaves it for `doctor --fix`); a finished
   * element file is not. Filter the temp out and the folder must be as it
   * was — a half-written TSK-002.md here would be the § 12 violation. */
  const after = H.listFiles(d, 'tasks').filter(f => !f.startsWith('.nj-tmp-'));
  T.eq(tag + ' — no element file was created',
    JSON.stringify(after), JSON.stringify(tasksBefore));
}

/* ------------------------------------------------------------------ */
/* 3. § 9's exit-code table                                            */
/* ------------------------------------------------------------------ */

/* A backlog carrying an `error`-severity § 7 problem (`parent:dangling`:
 * Doctor = error, blocks --ready). This is the state where the exit-code
 * table's two interesting rows meet: `doctor` must exit 2 here, and every
 * read must still exit 0 while *reporting* the problem. */
function broken(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
        created: NOW, updated: NOW,
      }, '# E\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-404', title: 'Dangling',
        status: 'todo', created: NOW, updated: NOW,
      }, goodBody('Dangling')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

{
  const d = broken('exit-table-reads');

  /* Non-vacuity first: if `doctor` did not exit 2 here the fixture carries no
   * error at all, and every assertion below would be about a clean backlog. */
  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('the fixture really carries an error finding (doctor exits 2)', doc, 2);
  T.check('doctor names parent:dangling',
    !!doc.json && Array.isArray(doc.json.problems) &&
    doc.json.problems.some(p => p && p.code === 'parent:dangling'),
    JSON.stringify(doc.json && doc.json.problems));

  /* § 9's row for `0`: "success — including reads that merely *report* data
   * problems via `_problems`". */
  const READS = [
    { name: 'list', args: ['list'] },
    { name: 'list --all', args: ['list', '--all'] },
    { name: 'list --ready', args: ['list', '--ready'] },
    { name: 'show', args: ['show', '--id=TSK-001'] },
    { name: 'tree', args: ['tree'] },
    { name: 'bare nj', args: [] },
  ];
  for (const rd of READS) {
    T.exit('`nj ' + rd.name + '` reports the problem and exits 0 (prose)',
      H.runNj(rd.args, { cwd: d }), 0);
    T.exit('`nj ' + rd.name + '` reports the problem and exits 0 (--json)',
      H.runJson(rd.args, { cwd: d }), 0);
  }

  /* And the report really happened — exit 0 must mean "reported", not
   * "did not look". */
  const show = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.check('the read carries the code in _problems',
    !!show.json && Array.isArray(show.json.entries) && show.json.entries.length === 1 &&
    Array.isArray(show.json.entries[0]._problems) &&
    show.json.entries[0]._problems.includes('parent:dangling'),
    JSON.stringify(show.json && show.json.entries));
  T.check('the read counts the error',
    !!show.json && !!show.json.counts && show.json.counts.errors >= 1,
    JSON.stringify(show.json && show.json.counts));
}

/* § 9's row for `2`: "`nj doctor` only". The negative half — no other command
 * may ever produce it, on success paths or failure paths alike. */
{
  const d = broken('exit-table-two');

  /* Failure paths on the broken backlog, chosen to span the whole surface:
   * argument errors, resolution errors, and success paths. A `2` leaking out
   * of any of them would make an agent's `doctor`-gate ambiguous.
   *
   * `exit` is the value § 9 decides for that invocation, one per row. An
   * earlier revision asserted `r.status === 0 || r.status === 1` here, which
   * was an either/or of the exact kind this bundle was written to remove:
   * § 9's exit-code table decides every one of these, so accepting both
   * values would have let a read start failing, or a rejection start
   * succeeding, without a single red line. The `!== 2` check is kept
   * alongside because it names the claim this section is about — it is not a
   * second tolerance, both assertions are single-valued. */
  const NON_DOCTOR = [
    /* § 9: `0` — "success — including reads that merely *report* data
     * problems via `_problems`". */
    { name: 'list', args: ['list'], exit: 0 },
    { name: 'list --json', args: ['list', '--json'], exit: 0 },
    { name: 'tree --all', args: ['tree', '--all', '--json'], exit: 0 },
    { name: 'bare nj', args: [], exit: 0 },
    /* § 9: a write that succeeds is a success; EPIC-001 is healthy, has no
     * children, and `doing` is not `done`, so no rule refuses it. */
    { name: 'set (succeeds)', args: ['set', '--id=EPIC-001', '--status=doing', '--json'], exit: 0 },
    { name: 'note (succeeds)', args: ['note', '--id=EPIC-001', 'hello', '--json'], exit: 0 },

    /* § 9: `1` — "command failed ... hard errors (no backlog found, unknown
     * field, refusal, retries exhausted)". Each row below names the § 9
     * condition that puts it there. */
    { name: 'show (missing id)', args: ['show', '--id=TSK-999', '--json'], exit: 1 },        // `--id` names nothing
    { name: 'unknown command', args: ['bogus', '--json'], exit: 1 },                         // unknown subcommand
    { name: 'unknown field', args: ['set', '--id=TSK-001', '--statuss=done', '--json'], exit: 1 },
    { name: 'missing argument', args: ['set', '--status=doing', '--json'], exit: 1 },
    { name: 'invalid value', args: ['set', '--id=TSK-001', '--priority=nope', '--json'], exit: 1 },
    /* § 9: "list filters are validated ... a typo'd filter is an error
     * (exit 1), never a silently empty result." */
    { name: 'invalid list filter', args: ['list', '--status=nope', '--json'], exit: 1 },
    /* § 9: "`nj new` validates: `--parent` ... must exist". */
    { name: 'new under a dangling parent', args: ['new', '--type=task', '--parent=EPIC-404', '--title=X', '--json'], exit: 1 },
    /* § 4: "`nj init` ... Refuses if a `backlog/` already exists." */
    { name: 'init over an existing backlog', args: ['init', '--json'], exit: 1 },
  ];
  for (const c of NON_DOCTOR) {
    const r = H.runNj(c.args, { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
    T.check('exit 2 is doctor-only — `' + c.name + '` did not use it',
      r.status !== 2, 'got exit ' + r.status +
      (r.stderr ? '\n     stderr: ' + String(r.stderr).slice(0, 200) : ''));
    T.exit('`' + c.name + '` exits ' + c.exit, r, c.exit);
  }
}

/* A fault hook must not borrow `2` either: it is an abort, i.e. § 9's `1`. */
{
  const d = writable('exit-table-fault-two');
  for (const hook of ['after-tmp-write', 'before-rename']) {
    const r = H.runNj(['set', '--id=TSK-001', '--status=doing', '--json'],
      { cwd: d, env: { NJ_FAULT: hook, NJ_NOW: H.LATER_NOW } });
    T.exit('NJ_FAULT=' + hook + ' exits 1, never 2', r, 1);
  }
}

/* `nj doctor` on a *clean* backlog is the other side of the `2` row: the code
 * belongs to doctor, but only when an error finding exists. */
{
  const d = writable('exit-table-clean');
  T.exit('doctor on a clean backlog exits 0', H.runJson(['doctor'], { cwd: d }), 0);
}

/* ------------------------------------------------------------------ */
/* 4. Reserved codes — the envelope only, never the code               */
/* ------------------------------------------------------------------ */

/* § 9: "With `--json`, **every** exit path writes JSON to stdout: on failure,
 * `{ok: false, error: "<code>", hint: "…"}` (hint optional) with exit 1."
 *
 * "Every exit path" includes the environment-level aborts, which are exactly
 * the paths § 9's reserved codes were set aside for. The code is not asserted
 * — § 9 explicitly leaves it open — but the envelope is pinned, because an
 * agent parsing stdout must not meet a bare stderr message on one path and
 * JSON on every other. `fault/nj-now-invalid.js` drives the same abort
 * without `--json` and so says nothing about this.
 *
 * AMBIGUOUS — *when* an invalid `NJ_NOW` is rejected. § 12 says "`NJ_NOW`
 * fixes the clock: if set, every timestamp the tool writes uses exactly this
 * value; an invalid value exits 1." Whether that validation happens at
 * startup (so a pure read like `nj list` also exits 1) or at the moment a
 * timestamp is needed (so reads are unaffected) is not stated, and the two
 * readings disagree on every read command. The cases below therefore drive a
 * **writing** command, where both readings agree on exit 1 — the same choice
 * `fault/nj-now-invalid.js` makes with `nj init`. The read case is reported
 * as an open question, not decided here. */
const ENV_ABORTS = [
  {
    /* § 12: "an invalid value exits 1". */
    name: 'invalid NJ_NOW',
    args: ['set', '--id=TSK-001', '--status=doing', '--json'],
    env: { NJ_NOW: 'yesterday afternoon' },
  },
  {
    name: 'NJ_NOW without the Z',
    args: ['set', '--id=TSK-001', '--status=doing', '--json'],
    env: { NJ_NOW: '2026-09-21T18:00:00' },
  },
  {
    /* § 4 rule 1: "If `NJ_BACKLOG` is set, it points at the backlog folder."
     * When it does not, the run cannot proceed — but § 9 leaves the code
     * unpinned between `no_backlog` and the reserved `invalid_backlog_env`. */
    name: 'NJ_BACKLOG pointing at a nonexistent folder',
    args: ['list', '--json'],
    env: {},
    backlogEnv: 'nowhere',
  },
];

for (const c of ENV_ABORTS) {
  const d = writable('exit-env-' + c.name.replace(/[^a-z]+/gi, '-').toLowerCase());
  const env = Object.assign({}, c.env);
  if (c.backlogEnv) env.NJ_BACKLOG = path.join(d, c.backlogEnv);

  const r = H.runNj(c.args, { cwd: d, env });
  T.exit(c.name + ' — exits 1', r, 1);

  const js = jsonOf(r);
  T.check(c.name + ' — stdout is JSON (§ 9: every exit path)', js !== null,
    JSON.stringify(String(r.stdout).slice(0, 200)));
  T.check(c.name + ' — ok is false', !!js && js.ok === false,
    JSON.stringify(js && js.ok));
  /* Deliberately membership, not equality: § 9 calls the candidate codes
   * reserved and does not map this path to one. Tightening this to a single
   * code is a spec ruling, not a test edit. */
  T.check(c.name + ' — error is inside the closed vocabulary',
    !!js && typeof js.error === 'string' && CLOSED.has(js.error),
    JSON.stringify(js && js.error));
  T.check(c.name + ' — hint is a string when present',
    !!js && (js.hint === undefined || typeof js.hint === 'string'),
    JSON.stringify(js && js.hint));
  T.check(c.name + ' — the prose additionally reaches stderr',
    String(r.stderr || '').trim().length > 0, JSON.stringify(r.stderr));
}

/* The reserved codes are part of the vocabulary even though no path is mapped
 * to one. If a refactor drops them from the set, the membership assertions
 * above would silently start rejecting a legitimate code. */
for (const reserved of ['invalid_env', 'invalid_backlog_env',
  'id_allocation_failed', 'internal_error']) {
  T.check('§ 9 reserves ' + reserved + ' inside the closed set',
    CLOSED.has(reserved));
}

T.finish();
