/* @slow: one of the longest pooled files, ~66 s at 8 jobs (NJ_TEST_TIMES, 2026-10-18); start it first (run-all.ts, test/README.md) */
/* AC-25 — Note author (`NJ_AUTHOR`, `--as`), docs/SPECIFICATION.md § 9 "The
 * acting name" and § 10 (v3.1 proposal § 0/§ A, promoted: DECISIONS 110/112,
 * then generalized to cover `--as` by § C's promotion, DECISIONS 117/b7ffad6
 * — `nj note --as` is no longer `unknown_field`, N6 below).
 *
 * Source: docs/proposals/v3.1.md (5d1c83d) with the lead's rulings on it
 * (A-1: a whitespace-only NJ_AUTHOR is invalid).
 *
 * AC-25: "With `NJ_AUTHOR` set, `nj note` signs with it — whether or not the
 * element has an `assignee` — and the note line is otherwise byte-identical
 * to § 10's; the value is trimmed. Unset or empty, the signer is the
 * `assignee`, else `?`, exactly as in v3. A value that is whitespace-only,
 * multi-line or contains `:` exits 1 with `invalid_env` and leaves the file
 * byte-identical, while `list`/`show`/`set` under the same environment
 * behave as without it. `NJ_AUTHOR` never changes `assignee`."
 *
 * § 9 "The acting name": `--as` (on the commands that have one, including
 * `nj note` as of § C's promotion) outranks `NJ_AUTHOR`, outranks none; an
 * empty `NJ_AUTHOR` or `--as` is unset; a name is valid when, trimmed, it is
 * non-empty, a single line and has no `:`; the trimmed value is used; reads
 * never fail on it.
 *
 * HOW BYTES ARE COMPARED. Every case builds two identical backlogs with
 * `nj init` / `nj new` under the pinned clock, notes once with and once
 * without NJ_AUTHOR, and requires the first file to equal the second with
 * only the signer of the note line replaced. That is "otherwise
 * byte-identical to § 10's" as a check, with no golden to maintain and no
 * dependence on the storage layout (V3-4 lands before v3.1).
 *
 * Written before v3.1 exists: red everywhere until it is implemented.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

const LATER = H.LATER_NOW;
function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac25-home');
type EnvMap = Record<string, string | undefined>;
interface RunOptsIn {
  cwd: string;
  env?: EnvMap;
}
/* NJ_AUTHOR and NJ_BACKLOG are unset unless a leg sets them. */
function envFor(o: RunOptsIn) {
  const env: EnvMap = Object.assign({ HOME }, (o && o.env) || {});
  const unset: string[] = [];
  for (const k of ['NJ_AUTHOR', 'NJ_BACKLOG']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args: string[], o: RunOptsIn) { return H.runNj(args, envFor(o)); }
function runJ(args: string[], o: RunOptsIn) { return H.runJson(args, envFor(o)); }
const later = (env?: EnvMap) => Object.assign({ NJ_NOW: LATER }, env || {});

/* ---- fixtures (nj init / nj new only) --------------------------------- */

function places(bl: string): Record<string, string> {
  const out: Record<string, string> = {};
  (function walk(abs: string, rel: string) {
    let kids: fs.Dirent[] = [];
    try { kids = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const k of kids) {
      if (k.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + k.name : k.name;
      if (k.isDirectory()) walk(path.join(abs, k.name), r);
      else if (/^(EPIC|TSK|SUB)-\d+\.md$/.test(k.name)) out[k.name.slice(0, -3)] = r;
    }
  })(bl, '');
  return out;
}
/* A backlog with EPIC-001 and TSK-001; `assignee` optional. */
function backlog(label: string, assignee?: string | null): { dir: string; bl: string } {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const steps = [
    ['init'],
    ['new', '--type=epic', '--title=Epic', '--description=Something.'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints']
      .concat(assignee ? ['--assignee=' + assignee] : []),
  ];
  for (const s of steps) {
    const r = run(s, { cwd: dir });
    if (r.missing || r.status !== 0) T.check('fixture: nj ' + s.join(' '), false, r.status + ' ' + J(r.stderr));
  }
  return { dir, bl };
}
function taskFile(x: { bl: string }) { return path.join(x.bl, places(x.bl)['TSK-001'] || '<no TSK-001>'); }
function bytes(p: string) { return H.readOrNull(p); }

/* Every file below `root`: bytes and mtime. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  (function walk(abs: string, rel: string) {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e) { return; }
    if (st.isDirectory()) {
      out.push(rel + '/ ' + st.mtimeMs);
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
    } else out.push(rel + ' ' + st.mtimeMs + ' ' + H.sha256(fs.readFileSync(abs)));
  })(root, '.');
  return out;
}

const TEXT = 'Parser splits at the first colon';
const noteLine = (signer: string) => '- ' + LATER + ' ' + signer + ': ' + TEXT;

/**
 * Note in two twin backlogs — with `env` and without NJ_AUTHOR — and
 * require the first file to be the second with only the signer replaced.
 */
function signs(desc: string, env: EnvMap | undefined, assignee: string | null | undefined, expectSigner: string) {
  const a = backlog('ac25-a', assignee);
  const b = backlog('ac25-b', assignee);
  const ra = runJ(['note', '--id=TSK-001', TEXT], { cwd: a.dir, env: later(env) });
  const rb = runJ(['note', '--id=TSK-001', TEXT], { cwd: b.dir, env: later() });
  T.exit(desc + ': note exit 0', ra, 0);
  T.check(desc + ': --json result {ok:true, changed:["body"]} (§ 10)',
    !!ra.json && ra.json.ok === true && J(ra.json.changed) === J(['body']), J(ra.json).slice(0, 300));
  const control = bytes(taskFile(b));
  const baseSigner = assignee || '?';
  T.check(desc + ': fixture — the v3 control signs with ' + J(baseSigner), rb.status === 0 && !!control && control.includes(noteLine(baseSigner) + '\n'),
    J(control));
  const want = control === null ? null : control.replace(noteLine(baseSigner) + '\n', noteLine(expectSigner) + '\n');
  T.eq(desc + ': signed ' + J(expectSigner) + ', the file otherwise byte-identical to the v3 note', bytes(taskFile(a)), want);
  return a;
}

/* ===================================================================== */
/* N1 — NJ_AUTHOR signs, with or without assignee; the value is trimmed    */
/* ===================================================================== */

{
  const a = signs('N1 NJ_AUTHOR=reviewer, element with an assignee', { NJ_AUTHOR: 'reviewer' }, 'alice', 'reviewer');
  const t = bytes(taskFile(a)) || '';
  T.check('N1 NJ_AUTHOR never changes assignee: assignee is still alice', /^assignee: alice$/m.test(t), J(t));
  const s = runJ(['show', '--id=TSK-001'], { cwd: a.dir });
  const e = s.json && Array.isArray(s.json.entries) ? s.json.entries[0] : null;
  T.eq('N1 show: assignee is still alice', e && e.assignee, 'alice');
}
{
  const a = signs('N1 NJ_AUTHOR=reviewer, element without assignee', { NJ_AUTHOR: 'reviewer' }, null, 'reviewer');
  T.check('N1 NJ_AUTHOR never sets assignee: no assignee key appears', !/^assignee:/m.test(bytes(taskFile(a)) || ''),
    J(bytes(taskFile(a))));
}
signs('N1 the value is trimmed (spaces)', { NJ_AUTHOR: '   reviewer  ' }, 'alice', 'reviewer');
signs('N1 the value is trimmed (tabs)', { NJ_AUTHOR: '\treviewer\t' }, null, 'reviewer');
signs('N1 inner spaces are kept', { NJ_AUTHOR: 'code reviewer' }, null, 'code reviewer');
signs('N1 a non-ASCII name is signed as given', { NJ_AUTHOR: 'Rüdiger 漢字 🚀' }, 'alice', 'Rüdiger 漢字 🚀');
signs('N1 a name like the assignee changes nothing but is still the signer', { NJ_AUTHOR: 'alice' }, 'alice', 'alice');
/* DECISIONS 104 (76): only spaces and tabs are trimmed; Unicode spaces are
 * literal characters of the name. */
signs('N1 Unicode spaces are literal, not trimmed (DECISIONS 104)', { NJ_AUTHOR: '\u00a0reviewer\u2003' }, 'alice', '\u00a0reviewer\u2003');
signs('N1 a name of one NBSP is a valid name (DECISIONS 104)', { NJ_AUTHOR: ' \u00a0 ' }, null, '\u00a0');

/* Unset or empty: exactly v3 (§ 0: empty counts as unset, like NJ_BACKLOG). */
signs('N2 NJ_AUTHOR empty counts as unset: the assignee signs', { NJ_AUTHOR: '' }, 'alice', 'alice');
signs('N2 NJ_AUTHOR empty counts as unset: "?" signs', { NJ_AUTHOR: '' }, null, '?');

/* Two notes, two signers: consecutive lines directly below the heading (§ 10). */
{
  const x = backlog('ac25-two', 'alice');
  run(['note', '--id=TSK-001', 'first'], { cwd: x.dir, env: later({ NJ_AUTHOR: 'reviewer' }) });
  run(['note', '--id=TSK-001', 'second'], { cwd: x.dir, env: later() });
  T.check('N3 two notes: the acting name, then the assignee, as consecutive lines',
    (bytes(taskFile(x)) || '').includes('## Notes\n- ' + LATER + ' reviewer: first\n- ' + LATER + ' alice: second\n'),
    J(bytes(taskFile(x))));
}

/* ===================================================================== */
/* N4 — an invalid name: note exits 1 with invalid_env, writes nothing    */
/* ===================================================================== */

for (const [label, value] of [
  ['whitespace-only (A-1)', '   '],
  ['a tab only (A-1)', '\t'],
  ['multi-line', 'code\nreviewer'],
  /* DECISIONS 104 (76): any \n or \r left after trimming spaces and tabs,
   * trailing included, is multi-line */
  ['with a trailing newline (DECISIONS 104)', 'reviewer\n'],
  ['with a leading newline (DECISIONS 104)', '\nreviewer'],
  ['with a trailing CR (DECISIONS 104)', 'reviewer\r'],
  ['with an inner CR (DECISIONS 104)', 'code\rreviewer'],
  ['with CRLF then spaces (DECISIONS 104)', 'reviewer\r\n  '],
  ['containing ":"', 'agent:1'],
  ['a trailing ":"', 'reviewer:'],
]) {
  const desc = 'N4 NJ_AUTHOR ' + label;
  const x = backlog('ac25-bad', 'alice');
  const before = snapshot(x.dir);
  const r = run(['note', '--id=TSK-001', TEXT], { cwd: x.dir, env: later({ NJ_AUTHOR: value }) });
  T.exit(desc + ': note exit 1', r, 1);
  T.check(desc + ': the prose starts with "Error: " (DECISIONS 88)', /^Error: /.test(r.stderr || ''), J(r.stderr));
  T.check(desc + ': no stack trace', !/^\s+at\s+\S/m.test(r.stderr || ''), J(r.stderr));
  const rj = runJ(['note', '--id=TSK-001', TEXT], { cwd: x.dir, env: later({ NJ_AUTHOR: value }) });
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: {ok:false} (§ 9)', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 200));
  T.eq(desc + ' --json: error is invalid_env', rj.json && rj.json.error, 'invalid_env');
  T.check(desc + ': nothing written — the whole backlog byte- and mtime-identical', J(snapshot(x.dir)) === J(before),
    'changed');

  /* "list/show/set under the same environment behave as without it";
   * reads never fail on it (§ 0). */
  const env = { NJ_AUTHOR: value };
  for (const args of [[], ['list'], ['list', '--ready'], ['list', '--all'], ['show', '--id=TSK-001'], ['tree'], ['doctor']]) {
    const w = run(args, { cwd: x.dir, env });
    const wo = run(args, { cwd: x.dir });
    T.check(desc + ': nj ' + (args.join(' ') || '(bare)') + ' behaves as without it (exit, stdout)',
      w.status === wo.status && w.stdout === wo.stdout, 'with: ' + w.status + ' ' + J(w.stderr) + ' / without: ' + wo.status);
  }
}
{
  /* Other writes ignore NJ_AUTHOR (§ A): set and new under an invalid value
   * give the same bytes as without it. */
  const a = backlog('ac25-set-a', 'alice');
  const b = backlog('ac25-set-b', 'alice');
  const bad = { NJ_AUTHOR: 'agent:1' };
  const sa = runJ(['set', '--id=TSK-001', '--status=doing'], { cwd: a.dir, env: later(bad) });
  const sb = runJ(['set', '--id=TSK-001', '--status=doing'], { cwd: b.dir, env: later() });
  T.exit('N5 set under an invalid NJ_AUTHOR: exit 0', sa, 0);
  T.eq('N5 set under an invalid NJ_AUTHOR: the file is what set writes without it', bytes(taskFile(a)), bytes(taskFile(b)));
  T.eq('N5 set under an invalid NJ_AUTHOR: the same result object', sa.json, sb.json && JSON.parse(JSON.stringify(sb.json).split(b.dir).join(a.dir)));
  const na = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: a.dir, env: later(bad) });
  run(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: b.dir, env: later() });
  T.exit('N5 new under an invalid NJ_AUTHOR: exit 0', na, 0);
  T.eq('N5 new under an invalid NJ_AUTHOR: the new file is what new writes without it',
    bytes(path.join(a.bl, places(a.bl)['TSK-002'] || '<none>')), bytes(path.join(b.bl, places(b.bl)['TSK-002'] || '<none>')));
  const va = runJ(['set', '--id=TSK-001', '--assignee=bob'], { cwd: a.dir, env: later({ NJ_AUTHOR: 'reviewer' }) });
  T.exit('N5 set --assignee under a valid NJ_AUTHOR: exit 0', va, 0);
  T.check('N5 NJ_AUTHOR never changes assignee: set --assignee=bob sets bob, not the acting name',
    /^assignee: bob$/m.test(bytes(taskFile(a)) || ''), J(bytes(taskFile(a))));
}

/* ===================================================================== */
/* N7 — precedence (DECISIONS 104, 77): argument parsing → the acting name */
/* → target resolution → refusals                                         */
/* ===================================================================== */
{
  const x = backlog('ac25-prec', 'alice');
  const bad = later({ NJ_AUTHOR: 'agent:1' });
  const cases: [string, string[], string][] = [
    ['an unknown flag beats the invalid name', ['note', '--id=TSK-001', '--bogus=1', TEXT], 'unknown_field'],
    ['a missing --id beats the invalid name', ['note', TEXT], 'missing_argument'],
    ['--id without a value beats the invalid name', ['note', '--id', TEXT], 'missing_value'],
    ['the invalid name beats an unknown target', ['note', '--id=TSK-404', TEXT], 'invalid_env'],
  ];
  for (const [label, args, code] of cases) {
    const before = snapshot(x.dir);
    const r = runJ(args, { cwd: x.dir, env: bad });
    T.exit('N7 ' + label + ': exit 1', r, 1);
    T.eq('N7 ' + label + ': ' + code, r.json && r.json.error, code);
    T.check('N7 ' + label + ': nothing written', J(snapshot(x.dir)) === J(before), 'changed');
  }
  /* `--id` and `--file` given together ranks with argument parsing, like
   * "neither given" (DECISIONS 111): it beats an invalid NJ_AUTHOR, and a
   * valid NJ_AUTHOR does not let the conflict through either. */
  {
    const fileArg = places(x.bl)['TSK-001'];
    const before = snapshot(x.dir);
    const r = runJ(['note', '--id=TSK-001', '--file=' + fileArg, TEXT], { cwd: x.dir, env: bad });
    T.exit('N7 --id and --file together beats the invalid name: exit 1', r, 1);
    T.eq('N7 --id and --file together beats the invalid name: invalid_target', r.json && r.json.error, 'invalid_target');
    T.check('N7 --id and --file together beats the invalid name: nothing written', J(snapshot(x.dir)) === J(before), 'changed');
  }
  {
    const fileArg = places(x.bl)['TSK-001'];
    const before = snapshot(x.dir);
    const r = runJ(['note', '--id=TSK-001', '--file=' + fileArg, TEXT], { cwd: x.dir, env: later({ NJ_AUTHOR: 'reviewer' }) });
    T.exit('N7 --id and --file together under a valid NJ_AUTHOR: exit 1', r, 1);
    T.eq('N7 --id and --file together under a valid NJ_AUTHOR: invalid_target', r.json && r.json.error, 'invalid_target');
    T.check('N7 --id and --file together under a valid NJ_AUTHOR: nothing written', J(snapshot(x.dir)) === J(before), 'changed');
  }
  /* … and it beats a refusal: an archived element */
  const y = backlog('ac25-prec-arch', 'alice');
  for (const a of [['set', '--id=TSK-001', '--status=done'], ['set', '--id=EPIC-001', '--status=done'], ['archive', '--id=EPIC-001']]) {
    const r = run(a, { cwd: y.dir, env: later() });
    if (r.missing || r.status !== 0) T.check('fixture: nj ' + a.join(' '), false, r.status + ' ' + J(r.stderr));
  }
  const before = snapshot(y.dir);
  const r = runJ(['note', '--id=TSK-001', TEXT], { cwd: y.dir, env: bad });
  T.eq('N7 the invalid name beats refused:archived: invalid_env', r.json && r.json.error, 'invalid_env');
  T.check('N7 … nothing written', J(snapshot(y.dir)) === J(before), 'changed');
  const control = runJ(['note', '--id=TSK-001', TEXT], { cwd: y.dir, env: later() });
  T.eq('N7 control: without NJ_AUTHOR the archived element is refused:archived', control.json && control.json.error, 'refused:archived');
}

/* ===================================================================== */
/* N6 — `--as` on `nj note` (§ 9 "The acting name", promoted with C,      */
/* DECISIONS 110/117/b7ffad6): signs like NJ_AUTHOR, and outranks it      */
/* ===================================================================== */
{
  const a = backlog('ac25-asA', 'alice');
  const b = backlog('ac25-asB', 'alice');
  const ra = runJ(['note', '--id=TSK-001', '--as=reviewer', TEXT], { cwd: a.dir, env: later() });
  const rb = runJ(['note', '--id=TSK-001', TEXT], { cwd: b.dir, env: later() });
  T.exit('N6 note --as=reviewer: exit 0', ra, 0);
  const control = bytes(taskFile(b));
  T.check('N6 fixture — the v3 control signs with alice', rb.status === 0 && !!control && control.includes(noteLine('alice') + '\n'), J(control));
  const want = control === null ? null : control.replace(noteLine('alice') + '\n', noteLine('reviewer') + '\n');
  T.eq('N6 note --as=reviewer: signed "reviewer", file otherwise byte-identical to the v3 note', bytes(taskFile(a)), want);
  T.check('N6 note --as never changes assignee: assignee is still alice', /^assignee: alice$/m.test(bytes(taskFile(a)) || ''), J(bytes(taskFile(a))));
}
{
  const a = backlog('ac25-asOutranksA', 'alice');
  const b = backlog('ac25-asOutranksB', 'alice');
  const ra = runJ(['note', '--id=TSK-001', '--as=reviewer', TEXT], { cwd: a.dir, env: later({ NJ_AUTHOR: 'other' }) });
  const rb = runJ(['note', '--id=TSK-001', TEXT], { cwd: b.dir, env: later() });
  T.exit('N6 note --as=reviewer with NJ_AUTHOR=other set too: exit 0', ra, 0);
  const control = bytes(taskFile(b));
  const want = control === null ? null : control.replace(noteLine('alice') + '\n', noteLine('reviewer') + '\n');
  T.eq('N6 --as outranks NJ_AUTHOR: signed "reviewer", not "other"', bytes(taskFile(a)), want);
}
/* An empty --as is NOT unset the way an empty NJ_AUTHOR is (§ 9, DECISIONS
 * 119): "empty counts as unset" is stated for the environment variable only;
 * a name "from either source" must be non-empty. An explicit flag with no
 * name is a caller's mistake, same as whitespace-only/multi-line/colon. */
for (const bad of ['', '  ', 'a\nb', 'a:b']) {
  const x = backlog('ac25-asInvalid', 'alice');
  const before = snapshot(x.dir);
  const r = runJ(['note', '--id=TSK-001', '--as=' + bad, TEXT], { cwd: x.dir, env: later() });
  T.exit('N6 note --as=' + J(bad) + ': exit 1 — invalid_value, not invalid_env', r, 1);
  T.eq('N6 note --as=' + J(bad) + ': invalid_value', r.json && r.json.error, 'invalid_value');
  T.check('N6 note --as=' + J(bad) + ': nothing written', J(snapshot(x.dir)) === J(before), 'changed');
}

T.finish();
