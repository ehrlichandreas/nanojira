/* The closed failure vocabulary (§ 9) — a § 9 contract, not one of § 15's 19
 * acceptance criteria, which is why it lives here rather than in ac/.
 *
 * "`error` carries a code from this closed set, and the additive-only rule of
 *  § 7 applies to it in the same way ... This is a **different axis** from the
 *  § 7 problem codes: those describe element state, these describe command
 *  outcomes."
 *
 * With `--json`, every exit path writes JSON to stdout; on failure
 * `{ok: false, error: "<code>", hint: "…"}` with exit 1, and the prose error
 * text **additionally** goes to stderr — that clause constrains the JSON
 * stream, not the stderr stream.
 *
 * TWO TIERS, deliberately.
 *
 * Tier 1 (no inference) applies to every path: exit 1, stdout parses as JSON,
 * `ok:false`, an `error` from the closed set, and prose on stderr as well. It
 * also asserts at the end that no code outside the set was ever produced.
 *
 * Tier 2 pins the specific code for a path. § 9 carries a **normative
 * condition→code table**, so every code asserted below is a quotation from it,
 * not an inference from a suggestive name.
 *
 * An earlier revision of this file accepted either of two codes wherever the
 * mapping was unclear, and that is worth recording because it failed silently:
 * § 9 maps a wrong-type `--parent` to `invalid_target`, the implementation
 * emitted `invalid_value` — also in the closed set — and an either/or assertion
 * stayed green while the spec was violated. An either/or is only honest when
 * the spec genuinely leaves the choice open; where the spec decides, accepting
 * two codes is indistinguishable from accepting a bug.
 *
 * Four codes remain unpinned because § 9 says so explicitly: `invalid_env`,
 * `invalid_backlog_env`, `id_allocation_failed` and `internal_error` are
 * **reserved** — the implementation may emit them from its own error paths,
 * and this file therefore asserts only that they are inside the closed set,
 * never that a path produces one.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as H from '../lib/harness.mjs';
const T = H.T;

/* § 9's table, transcribed. */
const PLAIN = [
  'no_backlog', 'backlog_without_config', 'invalid_config', 'io_error',
  'needs_newer_nj', 'invalid_env', 'invalid_backlog_env', 'unknown_field',
  'invalid_backlog_flag', 'invalid_backlog_njrc', 'invalid_njrc',
  'legacy_layout', 'unknown_command', 'missing_argument',
  'missing_value', 'invalid_value', 'invalid_target', 'not_found',
  'duplicate_id', 'exists', 'changed_in_parallel', 'id_allocation_failed',
  'internal_error', 'ambiguous_target', 'none_ready',
];
const REFUSED = ['unreadable', 'unreadable_dir', 'archived', 'children_open',
  'has_children', 'not_done', 'parent_archived', 'misplaced', 'not_archived',
  'claimed'];
const HOOKS = ['before-compare', 'after-tmp-write', 'before-rename'];
const CLOSED = new Set(PLAIN
  .concat(REFUSED.map(r => 'refused:' + r))
  .concat(HOOKS.map(h => 'fault:' + h)));

/* Every code actually observed, so the "nothing outside the set" claim is made
 * over real output rather than over the expectation table. */
const SEEN = new Set();

const TASK = 'tasks/TSK-001.md';
const NOW = H.FIXED_NOW;

const goodBody = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';

/** A healthy backlog with one complete task, reused by the argument-level cases. */
function healthy(label) {
  return H.mkBacklog({
    label,
    files: {
      [TASK]: H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo',
        created: NOW, updated: NOW,
      }, goodBody('T')),
    },
    tombstones: ['TSK-001'],
  });
}

/**
 * Run a command that must fail, and check the whole envelope.
 * `args` must already include `--json`.
 */
function expectFailure(desc, args, opts, expectedCode) {
  const r = H.runNj(args, opts || {});
  T.exit(desc + ' — exits 1', r, 1);

  let json = null, parseError = null;
  try { json = JSON.parse(r.stdout); } catch (e) { parseError = e.message; }
  if (!T.check(desc + ' — stdout is pure JSON', json !== null,
    (parseError || '') + ' :: ' + JSON.stringify(String(r.stdout).slice(0, 200)))) {
    return null;
  }

  T.check(desc + ' — ok is false', json.ok === false, JSON.stringify(json.ok));
  T.check(desc + ' — error is in the closed vocabulary',
    typeof json.error === 'string' && CLOSED.has(json.error), JSON.stringify(json.error));
  T.check(desc + ' — hint is a string when present',
    json.hint === undefined || typeof json.hint === 'string', JSON.stringify(json.hint));
  T.check(desc + ' — the prose additionally reaches stderr',
    String(r.stderr || '').trim().length > 0, JSON.stringify(r.stderr));

  if (typeof json.error === 'string') SEEN.add(json.error);
  /* `expectedCode` is deliberately a single string. The array form this helper
   * used to accept is gone on purpose: it made a wrong-but-in-set code
   * indistinguishable from a correct one. If a genuine either/or is ever
   * needed, it has to be argued for here, not switched on quietly. */
  if (expectedCode) {
    T.eq(desc + ' — code is ' + expectedCode, json.error, expectedCode);
  }
  return json;
}

/* ---- discovery-level failures ------------------------------------------ */

{
  // No backlog anywhere above an empty scratch directory.
  const d = H.freshDir('ac20-nobacklog');
  expectFailure('no backlog found', ['list', '--json'],
    { cwd: d, unsetEnv: ['NJ_BACKLOG'] }, 'no_backlog');
}

{
  // backlog/ exists but .nanojira/config.json does not — § 4's "says exactly that".
  const d = H.freshDir('ac20-noconfig');
  fs.mkdirSync(path.join(d, 'backlog', 'tasks'), { recursive: true });
  const json = expectFailure('backlog without config', ['list', '--json'],
    { cwd: d, unsetEnv: ['NJ_BACKLOG'] }, 'backlog_without_config');
  if (json) {
    const hinted = String(json.hint || '') + ' ' + String(json.error || '');
    T.check('the config case is distinguishable from a plain missing backlog',
      json.error !== 'no_backlog', JSON.stringify(json.error));
    void hinted;
  }
}

{
  const d = H.mkBacklog({ label: 'ac20-badconfig' });
  fs.writeFileSync(path.join(d, 'backlog', H.CONFIG_REL),
    JSON.stringify({ schema: 1, statuses: ['todo', 'done', 'doing'] }));   // done not last
  expectFailure('invalid configuration', ['list', '--json'], { cwd: d }, 'invalid_config');
}

/* ---- argument-level failures, on a healthy backlog ---------------------- */

{
  const d = healthy('ac20-args');

  expectFailure('unknown subcommand', ['bogus', '--json'], { cwd: d }, 'unknown_command');
  expectFailure('unknown field flag', ['set', '--id=TSK-001', '--statuss=done', '--json'],
    { cwd: d }, 'unknown_field');
  expectFailure('missing required argument', ['set', '--status=doing', '--json'],
    { cwd: d }, 'missing_argument');
  expectFailure('flag without a value', ['set', '--json', '--id=TSK-001', '--title'],
    { cwd: d }, 'missing_value');
  expectFailure('value outside the permitted set', ['set', '--id=TSK-001', '--priority=nonsense', '--json'],
    { cwd: d }, 'invalid_value');
  /* A reference that resolves to nothing is `not_found`; `invalid_target` is
   * the case § 9 describes as "must exist with the correct type" failing on
   * the *type* — a parent that exists but is the wrong kind of element. Both
   * mappings are name-inferred (see the header). */
  expectFailure('reference to a nonexistent element',
    ['set', '--id=TSK-001', '--depends-on=TSK-999', '--json'], { cwd: d }, 'not_found');
  /* § 9's normative table: "`--parent` names an element of the **wrong type**"
   * → `invalid_target`. `invalid_value` is the separate row for a value that
   * fails validation (`--status`, `--priority`, `--type`). Pinned, not chosen
   * between. */
  expectFailure('parent of the wrong type',
    ['new', '--type=task', '--parent=TSK-001', '--title=Child', '--json'],
    { cwd: d }, 'invalid_target');

  /* The neighbouring row, so the two are not confused for each other: a value
   * that fails validation is `invalid_value`, not `invalid_target`. */
  expectFailure('a value outside the permitted set is invalid_value, not invalid_target',
    ['new', '--type=badtype', '--title=X', '--json'], { cwd: d }, 'invalid_value');
  expectFailure('nonexistent element', ['show', '--id=TSK-999', '--json'],
    { cwd: d }, 'not_found');

  /* § 4: "nj init ... Refuses if a `backlog/` already exists." */
  expectFailure('init over an existing backlog', ['init', '--json'], { cwd: d }, 'exists');

  /* § 12's hooks report themselves through the `fault:<hook>` shape. */
  expectFailure('an injected fault names its hook',
    ['set', '--id=TSK-001', '--status=doing', '--json'],
    { cwd: d, env: { NJ_FAULT: 'after-tmp-write' } }, 'fault:after-tmp-write');
}

/* ---- element-state failures -------------------------------------------- */

{
  // Duplicate id: the table's note says the element state *is* the cause.
  const d = H.mkBacklog({
    label: 'ac20-dupe',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'One', status: 'todo',
        created: NOW, updated: NOW,
      }, goodBody('One')),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Two', status: 'todo',
        created: NOW, updated: NOW,
      }, goodBody('Two')),
    },
    tombstones: ['TSK-001', 'TSK-002'],
  });
  expectFailure('write against a duplicated id',
    ['set', '--id=TSK-001', '--status=doing', '--json'], { cwd: d }, 'duplicate_id');
}

{
  // An archived element is read-only in round one (§ 9).
  const d = H.mkBacklog({
    label: 'ac20-archived',
    files: {
      'archive/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Old', status: 'done',
        created: NOW, updated: NOW, archived: NOW,
      }, goodBody('Old')),
    },
    tombstones: ['TSK-001'],
  });
  expectFailure('write on an archived element',
    ['set', '--id=TSK-001', '--status=doing', '--json'], { cwd: d }, 'refused:archived');
}

{
  // An element whose frontmatter cannot be parsed must not be round-tripped.
  const d = H.mkBacklog({ label: 'ac20-unreadable', tombstones: ['TSK-001'] });
  fs.writeFileSync(path.join(d, 'backlog', TASK),
    '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: Broken\n' +
    'status: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n\n' + goodBody('Broken'));
  expectFailure('write on an element with unreadable frontmatter',
    ['set', '--id=TSK-001', '--status=doing', '--json'], { cwd: d }, 'refused:unreadable');
}

/* ---- the race: changed_in_parallel (§ 12) ------------------------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function startNj(args, opts) {
  const env = Object.assign({}, process.env, { NJ_NOW: H.LATER_NOW }, opts.env || {});
  const inv = H.njCommand(H.NJ, args);
  const child = spawn(inv.cmd, inv.args, { cwd: opts.cwd, env });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  return new Promise(resolve => {
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}

(async () => {
  {
    const d = healthy('ac20-race');
    const file = path.join(d, 'backlog', TASK);

    const pending = startNj(['set', '--id=TSK-001', '--status=doing', '--json'],
      { cwd: d, env: { NJ_FAULT: 'before-compare' } });
    await sleep(1000);                       // let nj finish its first read
    fs.writeFileSync(file, H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'review',
      created: NOW, updated: H.LATER_NOW,
    }, goodBody('T')));
    fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await pending;

    T.exit('a parallel change exits 1', r, 1);
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.check('the race reports JSON on stdout', json !== null,
      JSON.stringify(String(r.stdout).slice(0, 200)));
    if (json) {
      T.check('ok is false', json.ok === false, JSON.stringify(json.ok));
      if (typeof json.error === 'string') SEEN.add(json.error);
      T.eq('the race names changed_in_parallel', json.error, 'changed_in_parallel');
    }
    T.contains('the parallel version survived', fs.readFileSync(file, 'utf8'), 'status: review');
  }

  /* ---- the whole point: nothing outside the closed set ------------------ */
  const strays = [...SEEN].filter(c => !CLOSED.has(c));
  T.check('no code outside the closed vocabulary was ever emitted',
    strays.length === 0, 'unexpected: ' + JSON.stringify(strays));
  T.check('the run exercised a meaningful part of the vocabulary',
    SEEN.size >= 12, SEEN.size + ' distinct codes: ' + [...SEEN].sort().join(', '));

  T.finish();
})().catch(e => {
  console.log('FAIL failure-vocabulary.js — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
