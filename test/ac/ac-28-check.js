'use strict';
/* AC-28 — `nj check`, docs/SPECIFICATION.md § 10a (v3.2 proposal § A,
 * promoted: DECISIONS 122/123/125/126, commit 2130cbe; D128, bf2de4b,
 * adds the default-ticks / both-flags-invalid_value rule).
 *
 * AC-28 (§ 15): "A checkbox is any `-`/`*`/`+`/`<digits>.`/`<digits>)`-marked
 * list item, at any indentation, followed by `[ ]`, `[x]` or `[X]`; `[x]`
 * and `[X]` both count as ticked on read, only `[ ]` as unticked, and a
 * write always produces `[x]` (`--on`) or `[ ]` (`--off`), never `[X]`. `nj
 * check --id=TSK-007 --text=<substring>` and `--item=<n>` each address the
 * same checkbox when there is exactly one countable match; `--on` an
 * unticked box and `--off` a ticked one each flip exactly that line's
 * bracket content and nothing else, byte-for-byte, with `updated`
 * refreshed; `--on` already-on and `--off` already-off each exit 0 with
 * `changed: []` and change no byte. With neither `--on` nor `--off`, the
 * command ticks, exactly as `--on` would; `--on` with `--off` is
 * `invalid_value`, changing nothing. A checkbox inside `## Notes`, or inside
 * a fenced code block (``` or ~~~, nested or indented), is never counted or
 * matched — neither addresses it and neither index includes it. `--text`
 * matching no countable checkbox, or `--item` out of range, is `not_found`;
 * `--text` matching two or more is `ambiguous_target`. `check` on an
 * archived element is `refused:archived`, on an unreadable stub
 * `refused:unreadable`, and `--id`+`--file` together is `invalid_target`,
 * each exiting 1 and changing nothing. `NJ_FAULT=before-rename` leaves the
 * file at its previous revision; a parallel edit aborts with
 * `changed_in_parallel` unless `--force`."
 *
 * Written before `nj check` exists: red everywhere until it is implemented.
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

const HOME = H.freshDir('ac28-home');
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

/* ---- fixtures ---------------------------------------------------------- */

/* The countable checkboxes, in document order, exercising every marker
 * (dash, star, plus, ordered-dot, ordered-paren), nesting, and [X] read as
 * ticked — plus a fenced one (must never count) and a Notes one (must never
 * count). */
const MARKERS_BODY =
  '# Markers\n\n' +
  '## Description\n' +
  'Exercises every checkbox marker (§ 10a).\n\n' +
  '## Acceptance Criteria\n' +
  '- [ ] dash unticked\n' +
  '- [x] dash ticked\n' +
  '* [ ] star unticked\n' +
  '+ [ ] plus unticked\n' +
  '1. [ ] ordered-dot unticked\n' +
  '1) [ ] ordered-paren unticked\n' +
  '  - [ ] nested dash unticked\n' +
  '    * [X] nested star UPPERCASE ticked\n\n' +
  '```markdown\n' +
  '- [ ] inside a fence, must never count\n' +
  '```\n\n' +
  '  ```\n' +
  '  - [ ] inside an indented fence, must never count\n' +
  '  ```\n\n' +
  '~~~\n' +
  '- [ ] inside a tilde fence, must never count\n' +
  '~~~\n\n' +
  '````\n' +
  '```\n' +
  '- [ ] a shorter fence inside a longer one is literal content, must never count\n' +
  '```\n' +
  '````\n\n' +
  '## Notes\n' +
  '- 2026-09-21T18:00:00Z coder-agent: fixture note\n' +
  '- [ ] a checkbox under Notes, must never count\n';

const COUNTABLE = [
  'dash unticked',
  'dash ticked',
  'star unticked',
  'plus unticked',
  'ordered-dot unticked',
  'ordered-paren unticked',
  'nested dash unticked',
  'nested star UPPERCASE ticked',
];

function model(label, body) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  const taskFile = path.join(bl, 'tasks', 'TSK-001.md');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task',
    '--description=D.', '--acceptance=- [ ] placeholder'], { cwd: dir, env: at(NOW) }), 'new task');
  if (body !== undefined) {
    const raw = H.readOrNull(taskFile) || '';
    const fm = raw.slice(0, raw.indexOf('---', 3) + 3);
    fs.writeFileSync(taskFile, fm + '\n\n' + body);
  }
  return { dir, bl };
}

function bytes(p) { return H.readOrNull(p); }
function taskFile(x) { return path.join(x.bl, 'tasks', 'TSK-001.md'); }

function check(x, args, env) {
  const list = typeof args === 'string' ? [args] : args;
  const hasAddress = list.some(a => /^--(id|file)=/.test(a));
  const a = hasAddress ? list : ['--id=TSK-001'].concat(list);
  return runJ(['check'].concat(a), { cwd: x.dir, env: later(env) });
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

function refused(desc, x, args, code, env) {
  const before = snapshot(x.dir);
  const r = run(['check'].concat(args), { cwd: x.dir, env: later(env) });
  T.exit(desc + ': exit 1', r, 1);
  T.check(desc + ': the prose starts with "Error: "', /^Error: /.test(r.stderr || ''), J(r.stderr));
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test(r.stderr || ''), J(r.stderr));
  const rj = runJ(['check'].concat(args), { cwd: x.dir, env: later(env) });
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: {ok:false}', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 200));
  T.eq(desc + ' --json: error is ' + code, rj.json && rj.json.error, code);
  sameTree(desc + ': no byte of the backlog changed', before, snapshot(x.dir));
}

/* ===================================================================== */
/* D1 — every checkbox marker is recognised, nested items count, [X] reads */
/* as ticked, document order gives --item its index (§ 10a)                */
/* ===================================================================== */
{
  /* --item and --text address the SAME line: tick via --item, confirm via
   * --text that it is now ticked (and a fresh --item still finds it). */
  for (let i = 0; i < COUNTABLE.length; i++) {
    const x = model('ac28-d1b-' + i, MARKERS_BODY);
    const r = check(x, ['--item=' + (i + 1), '--on'], {});
    T.exit('D1b --item=' + (i + 1) + ' (' + COUNTABLE[i] + '): --on exit 0', r, 0);
    const b = bytes(taskFile(x)) || '';
    const line = b.split('\n').find(l => l.includes(COUNTABLE[i]));
    /* Item 8 ("nested star UPPERCASE ticked") already reads as ticked
     * ([X]) before --on runs, so --on is a no-op (D5) and the box stays
     * [X], never flipped to [x] — unlike every other item here, which
     * starts unticked and does become [x]. */
    const alreadyTicked = COUNTABLE[i].includes('UPPERCASE ticked');
    T.check('D1b --item=' + (i + 1) + ': "' + COUNTABLE[i] + '" is ' +
      (alreadyTicked ? 'left as [X] (already ticked, --on is a no-op)' : 'now ticked [x]'),
      !!line && (alreadyTicked ? /\[X\]/.test(line) : /\[x\]/.test(line)), J(line));
  }
}
{
  const x = model('ac28-d1-text', MARKERS_BODY);
  const r = check(x, ['--text=nested star', '--on'], {});
  T.exit('D1 --text uniquely matches "nested star UPPERCASE ticked": exit 0', r, 0);
  const b = bytes(taskFile(x)) || '';
  const line = b.split('\n').find(l => l.includes('nested star'));
  T.check('D1 --text: the nested, indented star-marker line is matched and stays [X] (already ticked, --on is a no-op)',
    !!line && /^\s*\* \[X\] nested star UPPERCASE ticked$/.test(line), J(line));
}
{
  /* [X] (uppercase) reads as already ticked: --on is a no-op. */
  const x = model('ac28-d1-upper-noop', MARKERS_BODY);
  const before = bytes(taskFile(x));
  const r = check(x, ['--text=UPPERCASE', '--on'], {});
  T.exit('D1 [X] already ticked: --on is a no-op, exit 0', r, 0);
  T.eq('D1 [X] --on no-op: changed is []', r.json && r.json.changed, []);
  T.eq('D1 [X] --on no-op: byte-identical', bytes(taskFile(x)), before);
}

/* ===================================================================== */
/* D2 — fence-awareness: ``` and ~~~, indented, nested/longer (§ 10a)      */
/* ===================================================================== */
{
  const x = model('ac28-d2-fence', MARKERS_BODY);
  for (const needle of ['inside a fence', 'inside an indented fence', 'inside a tilde fence', 'a shorter fence inside a longer one']) {
    const r = runJ(['check', '--id=TSK-001', '--text=' + needle, '--on'], { cwd: x.dir, env: later() });
    T.eq('D2 a checkbox-shaped line ' + J(needle) + ': not_found (fenced, never matched)', r.json && r.json.error, 'not_found');
  }
  /* The countable total is exactly COUNTABLE.length -- --item past it is out of range. */
  const over = runJ(['check', '--id=TSK-001', '--item=' + (COUNTABLE.length + 1), '--on'], { cwd: x.dir, env: later() });
  T.eq('D2 --item past the countable total (fenced/Notes lines excluded from the count): not_found', over.json && over.json.error, 'not_found');
}

/* ===================================================================== */
/* D3 — `## Notes` is excluded (§ 10a)                                     */
/* ===================================================================== */
{
  const x = model('ac28-d3-notes', MARKERS_BODY);
  const r = runJ(['check', '--id=TSK-001', '--text=under Notes', '--on'], { cwd: x.dir, env: later() });
  T.eq('D3 a checkbox under ## Notes: not_found (excluded from the scan)', r.json && r.json.error, 'not_found');
}

/* ===================================================================== */
/* D4 — addressing: exactly one of --text/--item; not_found;               */
/* ambiguous_target (§ 10a, § 9)                                           */
/* ===================================================================== */
{
  const x = model('ac28-d4-both', MARKERS_BODY);
  const before = snapshot(x.dir);
  const r = runJ(['check', '--id=TSK-001', '--text=dash', '--item=1', '--on'], { cwd: x.dir, env: later() });
  T.exit('D4 both --text and --item: exit 1', r, 1);
  T.eq('D4 both --text and --item: invalid_value', r.json && r.json.error, 'invalid_value');
  sameTree('D4 both: nothing written', before, snapshot(x.dir));
}
{
  const x = model('ac28-d4-neither', MARKERS_BODY);
  const before = snapshot(x.dir);
  const r = runJ(['check', '--id=TSK-001', '--on'], { cwd: x.dir, env: later() });
  T.exit('D4 neither --text nor --item: exit 1', r, 1);
  T.eq('D4 neither: missing_argument', r.json && r.json.error, 'missing_argument');
  sameTree('D4 neither: nothing written', before, snapshot(x.dir));
}
{
  const x = model('ac28-d4-notfound', MARKERS_BODY);
  refused('D4 --text matching nothing', x, ['--id=TSK-001', '--text=no-such-checkbox-text', '--on'], 'not_found', {});
  refused('D4 --item=0 (out of range)', x, ['--id=TSK-001', '--item=0', '--on'], 'not_found', {});
  refused('D4 --item past the count (out of range)', x, ['--id=TSK-001', '--item=999', '--on'], 'not_found', {});
}
{
  /* DECISIONS 129: a literally empty --text= is invalid_value, even where
   * exactly one checkbox exists — it matches every checkbox, so it would
   * silently tick the only one for the wrong reason (an unexpanded
   * variable), not because the caller actually named it. */
  const ONE_BOX_BODY = '# One\n\n## Description\nD.\n\n## Acceptance Criteria\n- [ ] the only box\n';
  const x = model('ac28-d4-empty-text', ONE_BOX_BODY);
  refused('D4 --text= (empty), even with exactly one checkbox', x,
    ['--id=TSK-001', '--text=', '--on'], 'invalid_value', {});
}
{
  /* DECISIONS 129: no trimming — a whitespace-only --text is not empty and
   * stays a plain substring. A single space is a substring of every line
   * here (they all have spaces between words), so it matches several
   * checkboxes and is ambiguous_target — not invalid_value, proving it was
   * actually used as a (too broad) substring, not short-circuited as empty. */
  const x = model('ac28-d4-whitespace-text', MARKERS_BODY);
  refused('D4 --text=" " (whitespace-only, not trimmed to empty)', x,
    ['--id=TSK-001', '--text= ', '--on'], 'ambiguous_target', {});
}
{
  const x = model('ac28-d4-ambiguous', MARKERS_BODY);
  refused('D4 --text matching two or more ("unticked" matches several)', x,
    ['--id=TSK-001', '--text=unticked', '--on'], 'ambiguous_target', {});
}

/* ===================================================================== */
/* D5 — a no-op is not refused: --on already-on, --off already-off         */
/* (§ 10a)                                                                 */
/* ===================================================================== */
{
  const x = model('ac28-d5-on-noop', MARKERS_BODY);
  const before = bytes(taskFile(x));
  const r = check(x, ['--text=dash ticked', '--on'], {});
  T.exit('D5 --on an already-ticked box: exit 0', r, 0);
  T.eq('D5 --on no-op: changed is []', r.json && r.json.changed, []);
  T.eq('D5 --on no-op: byte-identical', bytes(taskFile(x)), before);
}
{
  /* "plus unticked" (not "dash unticked"): "dash unticked" is also a
   * substring of "nested dash unticked", which would make --text ambiguous
   * — this block needs a generic unticked box, not specifically the dash
   * marker (D1b already exercises every marker, dash included). */
  const x = model('ac28-d5-off-noop', MARKERS_BODY);
  const before = bytes(taskFile(x));
  const r = check(x, ['--text=plus unticked', '--off'], {});
  T.exit('D5 --off an already-unticked box: exit 0', r, 0);
  T.eq('D5 --off no-op: changed is []', r.json && r.json.changed, []);
  T.eq('D5 --off no-op: byte-identical', bytes(taskFile(x)), before);
}

/* ===================================================================== */
/* D5b — with neither --on nor --off, the command ticks (DECISIONS 128);  */
/* --on with --off is invalid_value (§ 10a)                               */
/* ===================================================================== */
{
  const x = model('ac28-d5b-default', MARKERS_BODY);
  const r = check(x, ['--text=plus unticked'], {});
  T.exit('D5b neither --on nor --off: exit 0 (defaults to ticking)', r, 0);
  const line = (bytes(taskFile(x)) || '').split('\n').find(l => l.includes('plus unticked'));
  T.eq('D5b neither flag: the box is ticked, exactly as --on would', line, '+ [x] plus unticked');
  T.check('D5b neither flag: changed is ["body"]', J(r.json && r.json.changed) === J(['body']), J(r.json && r.json.changed));
}
{
  const x = model('ac28-d5b-both', MARKERS_BODY);
  refused('D5b --on together with --off', x, ['--id=TSK-001', '--text=plus unticked', '--on', '--off'], 'invalid_value', {});
}

/* ===================================================================== */
/* D6 — byte-exactness: only the bracket content changes (§ 10a)          */
/* ===================================================================== */
{
  const x = model('ac28-d6', MARKERS_BODY);
  const before = bytes(taskFile(x)) || '';
  const r = check(x, ['--text=plus unticked', '--on'], {});
  T.exit('D6 --on: exit 0', r, 0);
  const after = bytes(taskFile(x)) || '';
  const want = before.replace('+ [ ] plus unticked', '+ [x] plus unticked').replace(/^updated: .*$/m, 'updated: ' + LATER);
  T.eq('D6 --on: byte-identical to before except the one bracket and updated', after, want);
  T.check('D6 --json: changed is ["body"]', J(r.json && r.json.changed) === J(['body']), J(r.json && r.json.changed));
}
{
  const x = model('ac28-d6-untick', MARKERS_BODY);
  const before = bytes(taskFile(x)) || '';
  const r = check(x, ['--text=dash ticked', '--off'], {});
  T.exit('D6 --off: exit 0', r, 0);
  const after = bytes(taskFile(x)) || '';
  const want = before.replace('- [x] dash ticked', '- [ ] dash ticked').replace(/^updated: .*$/m, 'updated: ' + LATER);
  T.eq('D6 --off: byte-identical to before except the one bracket and updated', after, want);
}
{
  /* Leading whitespace and the list marker survive untouched for a nested item. */
  const x = model('ac28-d6-nested', MARKERS_BODY);
  const r = check(x, ['--text=nested dash', '--on'], {});
  T.exit('D6 nested item --on: exit 0', r, 0);
  const line = (bytes(taskFile(x)) || '').split('\n').find(l => l.includes('nested dash'));
  T.eq('D6 nested item: leading whitespace and marker untouched, only the bracket flipped',
    line, '  - [x] nested dash unticked');
}

/* ===================================================================== */
/* D7 — completeness is independent of checkbox state (§ 10a, § 7)         */
/* ===================================================================== */
{
  const x = model('ac28-d7', MARKERS_BODY);
  const before = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  check(x, ['--text=plus unticked', '--on'], {});
  const after = runJ(['show', '--id=TSK-001'], { cwd: x.dir });
  T.eq('D7 ticking a box does not change completeness (_problems unaffected)',
    J((before.json && before.json.entries[0]._problems || []).slice().sort()),
    J((after.json && after.json.entries[0]._problems || []).slice().sort()));
}

/* ===================================================================== */
/* D8 — refusals before anything is written (§ 10a)                       */
/* ===================================================================== */
{
  const x = model('ac28-d8-archived', MARKERS_BODY);
  ok(run(['set', '--id=TSK-001', '--status=done'], { cwd: x.dir, env: at(NOW) }), 'set done');
  ok(run(['archive', '--id=TSK-001'], { cwd: x.dir, env: later() }), 'archive');
  refused('D8 check on an archived element', x, ['--id=TSK-001', '--text=dash', '--on'], 'refused:archived', {});
}
{
  const x = model('ac28-d8-unreadable');
  const stub = path.join(x.bl, 'tasks', 'TSK-009.md');
  try { fs.symlinkSync(path.join(x.dir, 'no-such-target'), stub); }
  catch (e) { T.check('fixture: unreadable stub', false, e.code); }
  fs.writeFileSync(path.join(x.bl, '.nanojira', 'ids', 'TSK-009'), '');
  refused('D8 check on an unreadable stub', x, ['--id=TSK-009', '--text=x', '--on'], 'refused:unreadable', {});
}
{
  const x = model('ac28-d8-idfile', MARKERS_BODY);
  refused('D8 --id and --file together', x,
    ['--id=TSK-001', '--file=tasks/TSK-001.md', '--text=dash', '--on'], 'invalid_target', {});
}

/* ===================================================================== */
/* D9 — NJ_FAULT and a real parallel edit (§ 10a, § 12)                   */
/* ===================================================================== */
{
  const x = model('ac28-d9-fault', MARKERS_BODY);
  const before = bytes(taskFile(x));
  const r = check(x, ['--text=plus unticked', '--on'], { NJ_FAULT: 'before-rename' });
  T.exit('D9 NJ_FAULT=before-rename: exit 1', r, 1);
  T.eq('D9 NJ_FAULT=before-rename: fault:before-rename', r.json && r.json.error, 'fault:before-rename');
  T.eq('D9 NJ_FAULT=before-rename: file at its previous revision', bytes(taskFile(x)), before);
}

function spawnNj(args, cwd, env) {
  const e = Object.assign({}, process.env, { NJ_NOW: LATER, HOME }, env);
  for (const k of ['NJ_BACKLOG', 'NJ_AUTHOR']) delete e[k];
  const inv = H.njCommand(H.NJ, args);
  const child = spawn(inv.cmd, inv.args, { cwd, env: e });
  let out = '', err = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { err += c; });
  return new Promise(resolve => {
    child.on('error', er => resolve({ status: null, stdout: '', stderr: String(er.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}

(async () => {
  {
    const x = model('ac28-d9-compare', MARKERS_BODY);
    const done = spawnNj(['check', '--id=TSK-001', '--text=plus unticked', '--on', '--json'], x.dir, { NJ_FAULT: 'before-compare' });
    await new Promise(r => setTimeout(r, 1000));
    const b = bytes(taskFile(x));
    if (b !== null) fs.writeFileSync(taskFile(x), b + '\nParallel edit.\n');
    fs.writeFileSync(path.join(x.bl, '.nj-fault-go'), '');
    const r = await done;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.eq('D9 a parallel edit during check: exit 1', r.status, 1);
    T.eq('D9 a parallel edit during check: changed_in_parallel', json && json.error, 'changed_in_parallel');
    T.check('D9 a parallel edit during check: the parallel edit is never overwritten, and the box stays unticked',
      /Parallel edit\./.test(bytes(taskFile(x)) || '') && /\+ \[ \] plus unticked/.test(bytes(taskFile(x)) || ''),
      J(bytes(taskFile(x))));
  }
  {
    const x = model('ac28-d9-force', MARKERS_BODY);
    const done = spawnNj(['check', '--id=TSK-001', '--text=plus unticked', '--on', '--force', '--json'], x.dir, { NJ_FAULT: 'before-compare' });
    await new Promise(r => setTimeout(r, 1000));
    const b = bytes(taskFile(x));
    if (b !== null) fs.writeFileSync(taskFile(x), b + '\nParallel edit.\n');
    fs.writeFileSync(path.join(x.bl, '.nj-fault-go'), '');
    const r = await done;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
    T.eq('D9 --force overrides a parallel edit during check: exit 0', r.status, 0);
    const final = bytes(taskFile(x)) || '';
    T.check('D9 --force: the box is ticked despite the parallel edit', /\+ \[x\] plus unticked/.test(final), J(final));
  }

  T.finish();
})();
