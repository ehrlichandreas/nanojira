/* AC-63 -- NJ_ON_CHANGE, the optional change hook (§ 9 "`NJ_ON_CHANGE`",
 * DECISIONS 200; scans feedback TSK-011). Two acceptance criteria:
 *
 *   "hook runs after a successful write with the JSON result on stdin"
 *   "failure of the hook never corrupts the backlog"
 *
 * Every leg drives the real binary. A capture hook records, per call, its
 * stdin and its NJ_HOOK_COMMAND / NJ_HOOK_IDS / NJ_BACKLOG / cwd / whether
 * NJ_ON_CHANGE leaked into it, in its own directory under AC63_CAP (named
 * after the hook shell's own pid, so N calls leave N directories).
 *
 *   A. every writer fires exactly once; stdin is byte-identical to the
 *      --json stdout of the same call; the env and cwd are as specified.
 *   B. stdin is the FULL result even without --json and under --quiet /
 *      --fields (twin backlogs, same NJ_NOW).
 *   C. never fires on a refusal or failure, a read, a dry run, a
 *      `doctor --fix` with nothing to fix, or inside a hook
 *      (NJ_HOOK_COMMAND set).
 *   D. without NJ_ON_CHANGE (unset or empty) -- and with a silent,
 *      succeeding hook -- stdout, stderr, exit and the tree are
 *      byte-identical.
 *   E. a failing hook (non-zero exit, chatter on stdout, missing command,
 *      killed) leaves exit code, stdout and the tree byte-identical to the
 *      no-hook twin; the hook's stdout lands on stderr, never on stdout.
 *   F. timeout: a hung hook and everything it started are killed;
 *      a bad NJ_ON_CHANGE_TIMEOUT is invalid_env with nothing written.
 *   G. recursion guard: a hook that itself runs `nanojira note` does not
 *      fire again, even when it re-exports NJ_ON_CHANGE; the hook sees a
 *      consistent backlog.
 *   H. batch: one call with the batch result; a batch with a runtime
 *      failure still fires (something was written), a preflight abort
 *      does not.
 *   I. a hook key in .nanojira/config.json is ignored (a doctor warning),
 *      never executed.
 *   J. static: core/on-change.ts never reads the backlog's configuration,
 *      and both of its dry-run guards are in place.
 *   K. --dry-run (DECISIONS 197) never fires: every writer, prose and
 *      JSON, --quiet/--fields, doctor --fix with nothing to fix, a plan
 *      that stops part way, a dry run that ends in a refusal -- no call,
 *      the real tree unchanged, stdout/stderr identical to the same dry run without a
 *      hook (so the scratch copy, nj-dry-run-*, is never handed to one).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function q(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }
/* How a hook's own shell invokes the nanojira under test. */
const NJ_SH = (() => { const c = H.njCommand(H.NJ as string, []); return [c.cmd, ...c.args].map(q).join(' '); })();

const CAPTURE = [
  'd="$AC63_CAP/call-$$"', 'mkdir "$d"', 'cat > "$d/stdin"',
  'printf %s "$NJ_HOOK_COMMAND" > "$d/command"', 'printf %s "$NJ_HOOK_IDS" > "$d/ids"',
  'printf %s "$NJ_BACKLOG" > "$d/backlog"', 'pwd -P > "$d/cwd"',
  'printf %s "${NJ_ON_CHANGE-<unset>}" > "$d/on_change"',
  'printf %s "${NJ_ON_CHANGE_TIMEOUT-<unset>}" > "$d/timeout"',
].join('; ');

interface Call { stdin: string; command: string; ids: string; backlog: string; cwd: string; onChange: string; timeout: string }

function calls(cap: string): Call[] {
  return fs.readdirSync(cap).filter((n) => n.startsWith('call-')).sort().map((n) => {
    // A hook killed mid-capture leaves files missing: reported, not a crash.
    const r = (f: string) => H.readOrNull(path.join(cap, n, f)) ?? '<missing>';
    return { stdin: r('stdin'), command: r('command'), ids: r('ids'), backlog: r('backlog'), cwd: r('cwd').trim(), onChange: r('on_change'), timeout: r('timeout') };
  });
}

function plain(d: string, args: string[], input?: string): RunResult {
  return H.runNj(args, { cwd: d, input });
}
function hooked(d: string, cap: string, args: string[], extra?: Record<string, string>, input?: string): RunResult {
  return H.runNj(args, { cwd: d, input, env: Object.assign({ NJ_ON_CHANGE: CAPTURE, AC63_CAP: cap }, extra || {}) });
}

/* Every file under <d>/backlog as "<rel> <sha256>" -- claims and ids included. */
function snapshot(d: string): string[] {
  const root = path.join(d, 'backlog');
  const out: string[] = [];
  (function walk(abs: string, rel: string) {
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isDirectory()) { for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k); return; }
    if (st.isSymbolicLink()) { out.push(rel + ' ->' + fs.readlinkSync(abs)); return; }
    out.push(rel + ' ' + H.sha256(fs.readFileSync(abs)));
  })(root, '.');
  return out.sort();
}

/* The fixture: built WITHOUT the hook, through the real binary -- once,
 * into a template that every fixture() then copies. The backlog stores no
 * absolute path (and NJ_NOW is pinned), so a copy is byte-identical to a
 * fresh build; five spawns per fixture were most of this file's wall time. */
let template: string | null = null;
function fixtureTemplate(): string {
  if (template) return template;
  const d = H.freshDir('ac63-template');
  const steps: string[][] = [
    ['init'],
    ['new', '--type=epic', '--title=Auth', '--description=Login.', '--acceptance=- [ ] works'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=Login route', '--description=Wire it.', '--acceptance=- [ ] wire the route'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=Logout route', '--description=Unwire it.', '--acceptance=- [ ] unwire'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=Spare', '--description=Spare.', '--acceptance=- [ ] spare'],
  ];
  for (const s of steps) {
    const r = plain(d, s);
    if (r.status !== 0) throw new Error('fixture template: ' + s.join(' ') + ' -> ' + H.describeRun(r));
  }
  return (template = path.join(d, 'backlog'));
}
function fixture(label: string): { d: string; cap: string; bl: string } {
  const src = fixtureTemplate();
  const d = H.freshDir('ac63-' + label);
  const cap = H.freshDir('ac63cap-' + label);
  const bl = path.join(d, 'backlog');
  fs.cpSync(src, bl, { recursive: true });
  return { d, cap, bl };
}
function pre(d: string, steps: string[][]) {
  for (const s of steps) {
    const r = plain(d, s);
    if (r.status !== 0) throw new Error('pre: ' + s.join(' ') + ' -> ' + H.describeRun(r));
  }
}

/* ---------------------------------------------------------------- */
/* A. every writer fires exactly once, stdin === --json stdout       */
/* ---------------------------------------------------------------- */
interface WriterCase {
  name: string; args: string[]; command: string; ids: string | ((j: any) => string);
  pre?: string[][]; prepare?: (bl: string) => void; input?: string; exit?: number;
}
const WRITERS: WriterCase[] = [
  { name: 'new', args: ['new', '--type=task', '--parent=EPIC-001', '--title=Fresh'], command: 'new', ids: 'TSK-004' },
  { name: 'new --input plan', args: ['new', '--input=-'], command: 'new', ids: 'TSK-004,TSK-005',
    input: JSON.stringify([{ type: 'task', parent: 'EPIC-001', title: 'P1' }, { type: 'task', parent: 'EPIC-001', title: 'P2' }]) },
  { name: 'set', args: ['set', '--id=TSK-001', '--status=doing'], command: 'set', ids: 'TSK-001' },
  { name: 'set (no-op)', args: ['set', '--id=TSK-001', '--title=Login route'], command: 'set', ids: 'TSK-001' },
  { name: 'set done (releases a claim)', args: ['set', '--id=TSK-001', '--status=done'], command: 'set', ids: 'TSK-001',
    pre: [['check', '--id=TSK-001', '--text=wire'], ['claim', '--id=TSK-001', '--as=alice']] },
  { name: 'note', args: ['note', '--id=TSK-001', 'hello', '--as=alice'], command: 'note', ids: 'TSK-001' },
  { name: 'check', args: ['check', '--id=TSK-001', '--text=wire'], command: 'check', ids: 'TSK-001' },
  { name: 'claim', args: ['claim', '--id=TSK-001', '--as=alice'], command: 'claim', ids: 'TSK-001' },
  { name: 'release', args: ['release', '--id=TSK-001', '--as=alice'], command: 'release', ids: 'TSK-001',
    pre: [['claim', '--id=TSK-001', '--as=alice']] },
  { name: 'next', args: ['next', '--as=alice'], command: 'next', ids: (j) => j.id },
  { name: 'archive', args: ['archive', '--id=EPIC-002'], command: 'archive', ids: 'EPIC-002',
    pre: [['new', '--type=epic', '--title=Old', '--status=done']] },
  { name: 'unarchive', args: ['unarchive', '--id=EPIC-002'], command: 'unarchive', ids: 'EPIC-002',
    pre: [['new', '--type=epic', '--title=Old', '--status=done'], ['archive', '--id=EPIC-002']] },
  { name: 'rm', args: ['rm', '--id=TSK-003'], command: 'rm', ids: 'TSK-003' },
  { name: 'rm --cascade', args: ['rm', '--id=EPIC-002', '--cascade'], command: 'rm', ids: 'EPIC-002,TSK-004',
    pre: [['new', '--type=epic', '--title=Doomed'], ['new', '--type=task', '--parent=EPIC-002', '--title=Doomed child']] },
  { name: 'doctor --fix', args: ['doctor', '--fix'], command: 'doctor', ids: '',
    prepare: (bl) => fs.unlinkSync(path.join(bl, 'STATUS.md')) },
  { name: 'batch set', args: ['set', '--id=TSK-001,TSK-002', '--priority=high'], command: 'set', ids: 'TSK-001,TSK-002' },
];

for (const w of WRITERS) {
  const { d, cap, bl } = fixture('a');
  if (w.pre) pre(d, w.pre);
  if (w.prepare) w.prepare(bl);
  const r = hooked(d, cap, w.args.concat(['--json']), undefined, w.input);
  T.exit('A ' + w.name + ': exit', r, w.exit ?? 0);
  const c = calls(cap);
  T.eq('A ' + w.name + ': the hook fired exactly once', c.length, 1);
  if (c.length !== 1) continue;
  T.eq('A ' + w.name + ': stdin is byte-identical to the --json stdout', c[0].stdin, r.stdout);
  let j: any = null;
  try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
  T.check('A ' + w.name + ': stdout is parseable JSON', j !== null, r.stdout);
  T.eq('A ' + w.name + ': NJ_HOOK_COMMAND', c[0].command, w.command);
  T.eq('A ' + w.name + ': NJ_HOOK_IDS', c[0].ids, typeof w.ids === 'function' ? w.ids(j) : w.ids);
  T.eq('A ' + w.name + ': NJ_BACKLOG is the absolute backlog path', c[0].backlog, bl);
  T.eq('A ' + w.name + ': cwd is the backlog root', c[0].cwd, bl);
  T.eq('A ' + w.name + ': NJ_ON_CHANGE is unset inside the hook', c[0].onChange, '<unset>');
  T.eq('A ' + w.name + ': NJ_ON_CHANGE_TIMEOUT is unset inside the hook', c[0].timeout, '<unset>');
}

{
  const d = H.freshDir('ac63-init');
  const cap = H.freshDir('ac63cap-init');
  const r = hooked(d, cap, ['init', '--json']);
  T.exit('A init: exit', r, 0);
  const c = calls(cap);
  T.eq('A init: fired once', c.length, 1);
  if (c.length === 1) {
    T.eq('A init: stdin === --json stdout', c[0].stdin, r.stdout);
    T.eq('A init: NJ_HOOK_COMMAND', c[0].command, 'init');
    T.eq('A init: NJ_HOOK_IDS is empty', c[0].ids, '');
    T.eq('A init: cwd is the new backlog root', c[0].cwd, path.join(d, 'backlog'));
  }
}

/* ---------------------------------------------------------------- */
/* B. full result without --json and under --quiet/--fields          */
/* ---------------------------------------------------------------- */
{
  const ref = fixture('b-ref');
  const refRun = plain(ref.d, ['set', '--id=TSK-001', '--status=doing', '--json']);
  T.exit('B reference run', refRun, 0);
  const variants: Array<[string, string[]]> = [
    ['human output', ['set', '--id=TSK-001', '--status=doing']],
    ['--quiet', ['set', '--id=TSK-001', '--status=doing', '--json', '--quiet']],
    ['--fields', ['set', '--id=TSK-001', '--status=doing', '--json', '--fields=id']],
  ];
  for (const [label, args] of variants) {
    const f = fixture('b');
    const r = hooked(f.d, f.cap, args);
    T.exit('B ' + label + ': exit', r, 0);
    const c = calls(f.cap);
    T.eq('B ' + label + ': fired once', c.length, 1);
    if (c.length === 1) {
      T.eq('B ' + label + ': stdin is the full, untrimmed --json result', c[0].stdin, refRun.stdout.split(ref.d).join(f.d));
    }
  }
  const f = fixture('b-human-out');
  const twin = fixture('b-human-twin');
  T.eq('B human output: stdout unchanged by the hook',
    hooked(f.d, f.cap, ['set', '--id=TSK-001', '--status=doing']).stdout.split(f.d).join('<D>'),
    plain(twin.d, ['set', '--id=TSK-001', '--status=doing']).stdout.split(twin.d).join('<D>'));
}

/* ---------------------------------------------------------------- */
/* C. never fires on a refusal, a read, a dry run, inside a hook     */
/* ---------------------------------------------------------------- */
{
  const { d, cap } = fixture('c');
  pre(d, [['new', '--type=epic', '--title=Old', '--status=done'], ['archive', '--id=EPIC-002'],
    ['claim', '--id=TSK-002', '--as=bob']]);
  const before = snapshot(d);
  const refusals: Array<[string, string[], string]> = [
    ['invalid value', ['set', '--id=TSK-001', '--status=bogus'], 'invalid_value'],
    ['unknown field', ['set', '--id=TSK-001', '--colour=red'], 'unknown_field'],
    ['not found', ['set', '--id=TSK-099', '--status=doing'], 'not_found'],
    ['archived', ['set', '--id=EPIC-002', '--priority=high'], 'refused:archived'],
    ['claimed', ['claim', '--id=TSK-002', '--as=alice'], 'refused:claimed'],
    ['children open', ['set', '--id=EPIC-001', '--status=done'], 'refused:children_open'],
    ['has children', ['rm', '--id=EPIC-001'], 'refused:has_children'],
    ['not done', ['archive', '--id=EPIC-001'], 'refused:not_done'],
    ['not archived', ['unarchive', '--id=EPIC-001'], 'refused:not_archived'],
    ['check no match', ['check', '--id=TSK-001', '--text=nothing-like-this'], 'not_found'],
    ['next none ready', ['next', '--as=alice', '--tag=no-such-tag'], 'none_ready'],
    ['batch preflight abort', ['set', '--id=TSK-001,TSK-099', '--priority=high'], ''],
    ['new bad parent', ['new', '--type=task', '--parent=EPIC-099', '--title=X'], 'not_found'],
    ['init exists', ['init'], 'exists'],
    ['note without text', ['note', '--id=TSK-001'], ''],
  ];
  for (const [label, args, code] of refusals) {
    const r = hooked(d, cap, args.concat(['--json']));
    T.exit('C refusal ' + label + ': exit 1', r, 1);
    if (code !== '') {
      let j: any = null;
      try { j = JSON.parse(r.stdout); } catch { /* */ }
      T.eq('C refusal ' + label + ': error code', j && j.error, code);
    }
  }
  // A plan whose second node is invalid: validated whole before the first
  // write, so nothing is created and nothing fires.
  const badPlan = hooked(d, cap, ['new', '--input=-', '--json'], undefined,
    JSON.stringify([{ type: 'task', parent: 'EPIC-001', title: 'fine' }, { type: 'task', parent: 'EPIC-001', title: 'bad', colour: 'red' }]));
  T.exit('C refusal new --input with an invalid node: exit 1', badPlan, 1);
  const reads: string[][] = [
    [], ['list'], ['list', '--all'], ['show', '--id=TSK-001'], ['find', 'route'], ['tree'], ['tags'],
    ['log', '--id=TSK-001'], ['doctor'],
    ['new', '--input=-', '--dry-run'],
  ];
  for (const args of reads) {
    const input = args.includes('--dry-run') ? JSON.stringify({ type: 'task', parent: 'EPIC-001', title: 'Dry' }) : undefined;
    const r = hooked(d, cap, args.concat(['--json']), undefined, input);
    T.exit('C read/dry run `' + (args.join(' ') || '(bare)') + '`: exit 0', r, 0);
  }
  for (const args of [['--version'], ['--help'], ['set', '--help'], ['help']]) hooked(d, cap, args);
  T.eq('C: not one call after refusals, reads, dry run, help', calls(cap).length, 0);
  T.eq('C: refusals and reads left the backlog byte-identical', snapshot(d), before);

  const nothing = hooked(d, cap, ['doctor', '--fix', '--json']);
  let nj: any = null;
  try { nj = JSON.parse(nothing.stdout); } catch { /* */ }
  T.eq('C doctor --fix with nothing to fix: fixed is empty', nj && nj.fixed, []);
  T.eq('C doctor --fix with nothing to fix: no call', calls(cap).length, 0);

  const guarded = hooked(d, cap, ['set', '--id=TSK-001', '--priority=low', '--json'], { NJ_HOOK_COMMAND: 'set' });
  T.exit('C inside a hook (NJ_HOOK_COMMAND set): write succeeds', guarded, 0);
  T.eq('C inside a hook (NJ_HOOK_COMMAND set): no call', calls(cap).length, 0);
}

/* ---------------------------------------------------------------- */
/* D. no hook => byte-identical; a silent hook adds nothing          */
/* ---------------------------------------------------------------- */
{
  const seq: string[][] = [
    ['set', '--id=TSK-001', '--status=doing'], ['note', '--id=TSK-001', 'n', '--as=al'],
    ['claim', '--id=TSK-002', '--as=al', '--json'], ['set', '--id=TSK-001,TSK-002', '--priority=low', '--json'],
    ['set', '--id=TSK-001', '--status=bogus'], ['rm', '--id=TSK-003', '--json'], ['list', '--json'],
  ];
  const envs: Array<[string, Record<string, string> | null]> = [
    ['unset', null],
    ['empty', { NJ_ON_CHANGE: '' }],
    ['unset, bad timeout ignored', { NJ_ON_CHANGE_TIMEOUT: 'nonsense' }],
    ['silent succeeding hook', { NJ_ON_CHANGE: ':' }],
  ];
  const runs = envs.map(([label, env]) => {
    const f = fixture('d');
    const outs = seq.map((args) => {
      const r = H.runNj(args, { cwd: f.d, env: env || {} });
      return [r.status, r.stdout.split(f.d).join('<D>'), r.stderr.split(f.d).join('<D>')];
    });
    return { label, outs, tree: snapshot(f.d) };
  });
  for (const run of runs.slice(1)) {
    T.eq('D ' + run.label + ': exit/stdout/stderr identical to NJ_ON_CHANGE unset', run.outs, runs[0].outs);
    T.eq('D ' + run.label + ': tree identical to NJ_ON_CHANGE unset', run.tree, runs[0].tree);
  }
}

/* ---------------------------------------------------------------- */
/* E. a failing hook never corrupts anything                         */
/* ---------------------------------------------------------------- */
{
  const twin = fixture('e-twin');
  const ref = plain(twin.d, ['set', '--id=TSK-001', '--status=doing', '--json']);
  const refTree = snapshot(twin.d);
  const failing: Array<[string, string, string]> = [
    ['non-zero exit', 'cat >/dev/null; exit 3', 'exited with status 3'],
    ['chatter on stdout and stderr', 'echo HOOK-STDOUT-AC63; echo HOOK-STDERR-AC63 >&2; exit 1', 'exited with status 1'],
    ['missing command', 'no-such-command-ac63', 'exited with status 127'],
    ['killed by a signal', 'kill -9 $$', 'was killed by SIGKILL'],
    ['never reads stdin', 'exit 0', ''],
    ['vandal stdout only', 'echo "{\\"ok\\": false}"', ''],
  ];
  for (const [label, hook, warning] of failing) {
    const f = fixture('e');
    const r = H.runNj(['set', '--id=TSK-001', '--status=doing', '--json'], { cwd: f.d, env: { NJ_ON_CHANGE: hook } });
    T.exit('E ' + label + ': exit code unchanged (0)', r, 0);
    T.eq('E ' + label + ': stdout is exactly the no-hook --json result', r.stdout.split(f.d).join(twin.d), ref.stdout);
    let parsed = true;
    try { JSON.parse(r.stdout); } catch { parsed = false; }
    T.check('E ' + label + ': stdout parses as one JSON document', parsed, r.stdout);
    T.eq('E ' + label + ': backlog byte-identical to the no-hook twin', snapshot(f.d), refTree);
    if (warning !== '') {
      T.contains('E ' + label + ': stderr warns', r.stderr, 'Warning: NJ_ON_CHANGE hook ' + warning);
      T.contains('E ' + label + ': the warning says the write stands', r.stderr, 'the write itself succeeded and is unchanged');
    } else {
      T.check('E ' + label + ': no warning for a hook that exits 0', !r.stderr.includes('Warning: NJ_ON_CHANGE'), r.stderr);
    }
    if (label.startsWith('chatter')) {
      T.check('E chatter: the hook\'s stdout never reaches nanojira\'s stdout', !r.stdout.includes('HOOK-STDOUT-AC63'), r.stdout);
      T.contains('E chatter: the hook\'s stdout goes to nanojira\'s stderr', r.stderr, 'HOOK-STDOUT-AC63');
      T.contains('E chatter: the hook\'s stderr goes to nanojira\'s stderr', r.stderr, 'HOOK-STDERR-AC63');
    }
  }
  // Human output: the same discipline, stdout is exactly the no-hook text.
  const f = fixture('e-human');
  const t2 = fixture('e-human-twin');
  const r = H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: f.d, env: { NJ_ON_CHANGE: 'echo HOOK-STDOUT-AC63; exit 2' } });
  const r2 = plain(t2.d, ['set', '--id=TSK-001', '--status=doing']);
  T.exit('E human: exit 0', r, 0);
  T.eq('E human: stdout identical to the no-hook twin', r.stdout.split(f.d).join('<D>'), r2.stdout.split(t2.d).join('<D>'));
  // A failing hook after a batch, too.
  const fb = fixture('e-batch');
  const tb = fixture('e-batch-twin');
  const rb = H.runNj(['set', '--id=TSK-001,TSK-002', '--priority=high', '--json'], { cwd: fb.d, env: { NJ_ON_CHANGE: 'exit 9' } });
  const rb2 = plain(tb.d, ['set', '--id=TSK-001,TSK-002', '--priority=high', '--json']);
  T.exit('E batch: exit 0', rb, 0);
  T.eq('E batch: stdout identical to the no-hook twin', rb.stdout.split(fb.d).join(tb.d), rb2.stdout);
  T.eq('E batch: tree identical to the no-hook twin', snapshot(fb.d), snapshot(tb.d));
}

/* ---------------------------------------------------------------- */
/* F. timeout                                                        */
/* ---------------------------------------------------------------- */
{
  const { d, cap } = fixture('f');
  const twin = fixture('f-twin');
  plain(twin.d, ['set', '--id=TSK-001', '--status=doing']);
  // `sleep` runs as a grandchild (the trailing `wait` stops sh exec'ing it),
  // so only a process-group kill reaches it; if it survived it would hold
  // this harness's stderr pipe open for 60 s.
  const hook = 'sleep 60 & echo $! > "$AC63_CAP/sleeppid"; wait';
  const t0 = Date.now();
  const r = H.runNj(['set', '--id=TSK-001', '--status=doing', '--json'],
    { cwd: d, env: { NJ_ON_CHANGE: hook, NJ_ON_CHANGE_TIMEOUT: '1', AC63_CAP: cap }, timeout: 30000 });
  const elapsed = Date.now() - t0;
  T.exit('F timeout: exit code unchanged (0)', r, 0);
  // 19 s: nj's own start counts too, and a loaded pool (DECISIONS 199/201) stretches it; the hung hook's 60 s stays far out of reach.
  T.check('F timeout: returned within the timeout plus slack, not after the hook\'s 60 s', elapsed < 19000, elapsed + ' ms');
  T.check('F timeout: took at least the timeout', elapsed >= 900, elapsed + ' ms');
  T.contains('F timeout: stderr warns', r.stderr, 'Warning: NJ_ON_CHANGE hook timed out after 1s and was killed');
  T.eq('F timeout: the write stands, tree identical to the no-hook twin', snapshot(d), snapshot(twin.d));
  let alive = true;
  try {
    const pid = Number(fs.readFileSync(path.join(cap, 'sleeppid'), 'utf8').trim());
    for (let i = 0; i < 50 && alive; i++) {
      try { process.kill(pid, 0); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch { alive = false; }
    }
  } catch (e) { T.check('F timeout: the hook recorded its grandchild\'s pid', false, String(e)); }
  T.check('F timeout: the hook\'s grandchild was killed with it', !alive);

  for (const bad of ['0', 'abc', '1.5', '-1', '86401', '', ' 5']) {
    const f = fixture('f-bad');
    const before = snapshot(f.d);
    const rb = hooked(f.d, f.cap, ['set', '--id=TSK-001', '--status=doing', '--json'], { NJ_ON_CHANGE_TIMEOUT: bad });
    T.exit('F bad timeout ' + JSON.stringify(bad) + ': exit 1', rb, 1);
    let j: any = null;
    try { j = JSON.parse(rb.stdout); } catch { /* */ }
    T.eq('F bad timeout ' + JSON.stringify(bad) + ': invalid_env', j && j.error, 'invalid_env');
    T.eq('F bad timeout ' + JSON.stringify(bad) + ': nothing written', snapshot(f.d), before);
    T.eq('F bad timeout ' + JSON.stringify(bad) + ': no call', calls(f.cap).length, 0);
    const read = hooked(f.d, f.cap, ['list', '--json'], { NJ_ON_CHANGE_TIMEOUT: bad });
    T.exit('F bad timeout ' + JSON.stringify(bad) + ': a read is unaffected', read, 0);
  }
  const ok = fixture('f-ok');
  const rk = hooked(ok.d, ok.cap, ['set', '--id=TSK-001', '--status=doing'], { NJ_ON_CHANGE_TIMEOUT: '86400' });
  T.exit('F timeout 86400 is accepted', rk, 0);
  T.eq('F timeout 86400: fired', calls(ok.cap).length, 1);
}

/* ---------------------------------------------------------------- */
/* G. recursion guard; the hook sees a consistent backlog            */
/* ---------------------------------------------------------------- */
{
  const variants: Array<[string, string]> = [
    ['plain nested note', `printf x >> "$AC63_CAP/count"; ${NJ_SH} note --id=TSK-001 "from the hook" --as=hook-bot`],
    ['nested note re-exporting NJ_ON_CHANGE',
      `printf x >> "$AC63_CAP/count"; NJ_ON_CHANGE='printf y >> "$AC63_CAP/count"' ${NJ_SH} note --id=TSK-001 "from the hook" --as=hook-bot`],
  ];
  for (const [label, hook] of variants) {
    const { d, cap, bl } = fixture('g');
    const r = H.runNj(['set', '--id=TSK-001', '--status=doing', '--json'], { cwd: d, env: { NJ_ON_CHANGE: hook, AC63_CAP: cap } });
    T.exit('G ' + label + ': exit 0', r, 0);
    T.check('G ' + label + ': no warning', !r.stderr.includes('Warning: NJ_ON_CHANGE'), r.stderr);
    T.eq('G ' + label + ': the hook ran exactly once (no nested firing)', H.readOrNull(path.join(cap, 'count')), 'x');
    const show = H.runJson(['show', '--id=TSK-001'], { cwd: d });
    T.eq('G ' + label + ': the outer write landed', show.json && show.json.entry.status, 'doing');
    T.contains('G ' + label + ': the nested note landed', fs.readFileSync(path.join(bl, 'tasks', 'TSK-001.md'), 'utf8'), 'from the hook');
  }
  {
    const { d, cap, bl } = fixture('g-consistent');
    const hook = `${NJ_SH} show --id=TSK-001 --json > "$AC63_CAP/show.json"; ${NJ_SH} doctor --json > "$AC63_CAP/doctor.json"; `
      + `cp STATUS.md "$AC63_CAP/STATUS.md"; ls -aR > "$AC63_CAP/ls.txt"; ls .nanojira/claims/TSK-001 > "$AC63_CAP/claims.txt" 2>/dev/null; true`;
    const r = H.runNj(['claim', '--id=TSK-001', '--as=alice', '--status=doing', '--json'], { cwd: d, env: { NJ_ON_CHANGE: hook, AC63_CAP: cap } });
    T.exit('G consistent: exit 0', r, 0);
    const showRaw = H.readOrNull(path.join(cap, 'show.json'));
    const docRaw = H.readOrNull(path.join(cap, 'doctor.json'));
    const statusSeen = H.readOrNull(path.join(cap, 'STATUS.md'));
    const lsSeen = H.readOrNull(path.join(cap, 'ls.txt'));
    T.check('G consistent: the hook ran and recorded what it saw', showRaw !== null && docRaw !== null && statusSeen !== null && lsSeen !== null);
    if (showRaw !== null && docRaw !== null && statusSeen !== null && lsSeen !== null) {
      const show = JSON.parse(showRaw);
      T.eq('G consistent: inside the hook, show already sees the new status', show.entry.status, 'doing');
      T.eq('G consistent: inside the hook, show already sees the claim', show.entry._claim && show.entry._claim.by, 'alice');
      T.eq('G consistent: inside the hook, doctor finds no error', JSON.parse(docRaw).ok, true);
      T.contains('G consistent: STATUS.md is already regenerated when the hook starts', statusSeen, 'TSK-001');
      T.eq('G consistent: STATUS.md the hook saw is the final one', statusSeen, fs.readFileSync(path.join(bl, 'STATUS.md'), 'utf8'));
      T.check('G consistent: no .nj-tmp-* file exists while the hook runs', !lsSeen.includes('.nj-tmp-'));
    }
  }
}

/* ---------------------------------------------------------------- */
/* H. batch                                                          */
/* ---------------------------------------------------------------- */
{
  // A runtime failure on the first ID (NJ_FAULT fires once per batch,
  // catchable) -- the second ID is still written, so the hook fires once,
  // with the whole batch result, naming only the written ID.
  const { d, cap } = fixture('h');
  const r = hooked(d, cap, ['set', '--id=TSK-001,TSK-002', '--priority=high', '--json'], { NJ_FAULT: 'after-tmp-write' });
  T.exit('H partial batch: exit 1 (one ID failed)', r, 1);
  let j: any = null;
  try { j = JSON.parse(r.stdout); } catch { /* */ }
  T.eq('H partial batch: TSK-001 failed, TSK-002 succeeded', j && j.results.map((x: any) => x.ok), [false, true]);
  const c = calls(cap);
  T.eq('H partial batch: fired exactly once', c.length, 1);
  if (c.length === 1) {
    T.eq('H partial batch: stdin === --json stdout (the whole batch result)', c[0].stdin, r.stdout);
    T.eq('H partial batch: NJ_HOOK_IDS names only the written ID', c[0].ids, 'TSK-002');
  }
  for (const cmd of [['note', 'n', '--as=al'], ['check', '--text=route'], ['claim', '--as=al']]) {
    const f = fixture('h-' + cmd[0]);
    const [verb, ...rest] = cmd;
    const ids = verb === 'check' ? '--id=TSK-001,TSK-002' : '--id=TSK-001,TSK-002,TSK-003';
    const args = verb === 'check' ? ['check', ids, '--item=1'] : [verb, ids, ...rest];
    const rr = hooked(f.d, f.cap, args.concat(['--json']));
    T.exit('H batch ' + verb + ': exit 0', rr, 0);
    const cc = calls(f.cap);
    T.eq('H batch ' + verb + ': one call for the whole batch', cc.length, 1);
    if (cc.length === 1) {
      T.eq('H batch ' + verb + ': stdin === --json stdout', cc[0].stdin, rr.stdout);
      T.eq('H batch ' + verb + ': NJ_HOOK_IDS', cc[0].ids, ids.slice(5));
    }
  }
}

/* A `new --input` plan that stops part way (DECISIONS 174) has still
 * written what it created: the hook fires with that failure result. One
 * that fails on its very first write created nothing and does not fire.
 * The write failure is real: `tasks/` made read-only (skipped as root). */
if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  const partial = fixture('h-plan-partial');
  const tasksDir = path.join(partial.bl, 'tasks');
  fs.chmodSync(tasksDir, 0o555);
  try {
    const rp = hooked(partial.d, partial.cap, ['new', '--input=-', '--json'], undefined,
      JSON.stringify([{ type: 'epic', title: 'Partial' }, { type: 'task', parent: 'EPIC-001', title: 'Blocked' }]));
    T.exit('H plan stopped part way: exit 1', rp, 1);
    let jp: any = null;
    try { jp = JSON.parse(rp.stdout); } catch { /* */ }
    T.eq('H plan stopped part way: created names the epic', jp && jp.created, ['EPIC-002']);
    const cp = calls(partial.cap);
    T.eq('H plan stopped part way: fired once', cp.length, 1);
    if (cp.length === 1) {
      T.eq('H plan stopped part way: stdin === --json stdout', cp[0].stdin, rp.stdout);
      T.eq('H plan stopped part way: NJ_HOOK_IDS names what was created', cp[0].ids, 'EPIC-002');
    }
    const first = fixture('h-plan-first');
    fs.chmodSync(path.join(first.bl, 'tasks'), 0o555);
    try {
      const rf = hooked(first.d, first.cap, ['new', '--input=-', '--json'], undefined,
        JSON.stringify([{ type: 'task', parent: 'EPIC-001', title: 'Blocked' }, { type: 'epic', title: 'Never' }]));
      T.exit('H plan failing on its first write: exit 1', rf, 1);
      T.eq('H plan failing on its first write: created nothing, no call', calls(first.cap).length, 0);
    } finally { fs.chmodSync(path.join(first.bl, 'tasks'), 0o755); }
  } finally { fs.chmodSync(tasksDir, 0o755); }
} else {
  console.log('  (H plan-stopped-part-way legs skipped: running as root, chmod cannot force a write failure)');
}

/* ---------------------------------------------------------------- */
/* I. a hook key in config.json is never executed                    */
/* ---------------------------------------------------------------- */
{
  const { d, cap, bl } = fixture('i');
  const pwned = path.join(cap, 'pwned');
  const cfgPath = path.join(bl, '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const evil = 'touch ' + q(pwned);
  for (const k of ['onChange', 'on_change', 'NJ_ON_CHANGE', 'hook', 'hooks']) cfg[k] = k === 'hooks' ? { onChange: evil } : evil;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r1 = plain(d, ['set', '--id=TSK-001', '--status=doing', '--json']);
  T.exit('I no env, hook keys in config: the write succeeds', r1, 0);
  T.check('I no env: the config hook was never executed', !fs.existsSync(pwned));
  const r2 = hooked(d, cap, ['set', '--id=TSK-001', '--priority=high', '--json']);
  T.exit('I env set too: the write succeeds', r2, 0);
  T.check('I env set too: the config hook was still never executed', !fs.existsSync(pwned));
  T.eq('I env set too: only the env hook ran, once', calls(cap).length, 1);
  const doc = H.runJson(['doctor'], { cwd: d });
  const unknown = (doc.json && doc.json.problems || []).filter((p: any) => p.code === 'config:unknown_key').map((p: any) => p.message).join(' | ');
  for (const k of ['onChange', 'on_change', 'NJ_ON_CHANGE', 'hook', 'hooks']) {
    T.contains('I doctor reports config key ' + k + ' as unknown (ignored)', unknown, `'${k}'`);
  }
  T.check('I doctor itself did not execute it either', !fs.existsSync(pwned));
}

/* ---------------------------------------------------------------- */
/* K. --dry-run never fires                                          */
/* ---------------------------------------------------------------- */
{
  interface DryCase { name: string; args: string[]; exit: number; pre?: string[][]; prepare?: (bl: string) => void; input?: string; code?: string }
  const DRY: DryCase[] = [
    { name: 'set', args: ['set', '--id=TSK-001', '--status=doing'], exit: 0 },
    { name: 'set, prose output', args: ['set', '--id=TSK-001', '--priority=high'], exit: 0 },
    { name: 'new', args: ['new', '--type=task', '--parent=EPIC-001', '--title=Dry'], exit: 0 },
    { name: 'new --input plan', args: ['new', '--input=-'], exit: 0,
      input: JSON.stringify([{ type: 'task', parent: 'EPIC-001', title: 'D1' }, { type: 'task', parent: 'EPIC-001', title: 'D2' }]) },
    { name: 'claim', args: ['claim', '--id=TSK-001', '--as=alice', '--status=doing'], exit: 0 },
    { name: 'release', args: ['release', '--id=TSK-001', '--as=alice'], exit: 0, pre: [['claim', '--id=TSK-001', '--as=alice']] },
    { name: 'next', args: ['next', '--as=alice'], exit: 0 },
    { name: 'note', args: ['note', '--id=TSK-001', 'dry', '--as=alice'], exit: 0 },
    { name: 'check', args: ['check', '--id=TSK-001', '--text=wire'], exit: 0 },
    { name: 'batch set', args: ['set', '--id=TSK-001,TSK-002', '--priority=high'], exit: 0 },
    { name: 'rm', args: ['rm', '--id=TSK-003'], exit: 0 },
    { name: 'rm --cascade', args: ['rm', '--id=EPIC-001', '--cascade'], exit: 0 },
    { name: 'archive', args: ['archive', '--id=EPIC-002'], exit: 0, pre: [['new', '--type=epic', '--title=Old', '--status=done']] },
    { name: 'unarchive', args: ['unarchive', '--id=EPIC-002'], exit: 0,
      pre: [['new', '--type=epic', '--title=Old', '--status=done'], ['archive', '--id=EPIC-002']] },
    { name: 'doctor --fix (something to fix)', args: ['doctor', '--fix'], exit: 0, prepare: (bl) => fs.unlinkSync(path.join(bl, 'STATUS.md')) },
    { name: 'refusal: invalid value', args: ['set', '--id=TSK-001', '--status=bogus'], exit: 1, code: 'invalid_value' },
    { name: 'refusal: children open', args: ['set', '--id=EPIC-001', '--status=done'], exit: 1, code: 'refused:children_open' },
    { name: 'refusal: claimed', args: ['claim', '--id=TSK-001', '--as=alice'], exit: 1, code: 'refused:claimed', pre: [['claim', '--id=TSK-001', '--as=bob']] },
    { name: 'refusal: batch with a runtime failure', args: ['set', '--id=TSK-001,TSK-002', '--priority=high'], exit: 1 },
  ];
  for (const k of DRY) {
    const prose = k.name.includes('prose');
    const args = k.args.concat(['--dry-run'], prose ? [] : ['--json']);
    const f = fixture('k');
    const twin = fixture('k-twin');
    for (const x of [f, twin]) { if (k.pre) pre(x.d, k.pre); if (k.prepare) k.prepare(x.bl); }
    const before = snapshot(f.d);
    // The batch leg's runtime failure is real: NJ_FAULT, catchable in a batch.
    const fault: Record<string, string> = k.name.includes('runtime failure') ? { NJ_FAULT: 'after-tmp-write' } : {};
    const r = hooked(f.d, f.cap, args, fault, k.input);
    const rt = H.runNj(args, { cwd: twin.d, input: k.input, env: fault });
    T.exit('K dry run ' + k.name + ': exit', r, k.exit);
    if (!prose) {
      let j: any = null;
      try { j = JSON.parse(r.stdout); } catch { /* */ }
      T.eq('K dry run ' + k.name + ': it was a dry run', j && j.dry_run, true);
      if (k.code !== undefined) T.eq('K dry run ' + k.name + ': refusal code', j && j.error, k.code);
      if (k.exit === 0) T.check('K dry run ' + k.name + ': the real call would have changed something', j && Array.isArray(j.changes) && j.changes.length > 0, j && j.changes);
    } else {
      T.contains('K dry run ' + k.name + ': prose summary', r.stdout, 'Dry run: nothing written.');
    }
    const c = calls(f.cap);
    T.eq('K dry run ' + k.name + ': the hook never fired', c.length, 0);
    for (const call of c) {
      T.check('K dry run ' + k.name + ': NJ_BACKLOG is never the scratch copy', !call.backlog.includes('nj-dry-run-'), call.backlog);
    }
    T.check('K dry run ' + k.name + ': no hook warning', !r.stderr.includes('NJ_ON_CHANGE'), r.stderr);
    T.eq('K dry run ' + k.name + ': the real tree is unchanged', snapshot(f.d), before);
    // A fault leaves a temp file whose name carries a pid and a random tail.
    const norm = (out: string, dir: string) => out.split(dir).join('<D>').replace(/\.nj-tmp-[0-9]+-[a-z0-9]+/g, '.nj-tmp-<X>');
    T.eq('K dry run ' + k.name + ': stdout identical to the same dry run with no hook', norm(r.stdout, f.d), norm(rt.stdout, twin.d));
    T.eq('K dry run ' + k.name + ': stderr identical to the same dry run with no hook', r.stderr.split(f.d).join('<D>'), rt.stderr.split(twin.d).join('<D>'));
  }
  // init --dry-run: no backlog exists yet, nothing is created, nothing fires.
  const d = H.freshDir('ac63-k-init');
  const cap = H.freshDir('ac63cap-k-init');
  const ri = hooked(d, cap, ['init', '--dry-run', '--json']);
  T.exit('K dry run init: exit 0', ri, 0);
  T.check('K dry run init: no backlog created', !fs.existsSync(path.join(d, 'backlog')));
  T.eq('K dry run init: the hook never fired', calls(cap).length, 0);
  // Shapes under --dry-run with the hook armed: --quiet, --fields,
  // doctor --fix with nothing to fix. No call, real tree unchanged, and
  // exactly the dry-run shape § 9 "--dry-run" pins.
  const parse = (r: RunResult): any => { try { return JSON.parse(r.stdout); } catch { return null; } };
  {
    const fq = fixture('k-quiet');
    const before = snapshot(fq.d);
    const rq = hooked(fq.d, fq.cap, ['set', '--id=TSK-001', '--status=doing', '--quiet', '--dry-run', '--json']);
    const jq = parse(rq);
    T.exit('K dry run --quiet: exit 0', rq, 0);
    T.eq('K dry run --quiet: keys are exactly {ok, id, dry_run, changes}', jq && Object.keys(jq), ['ok', 'id', 'dry_run', 'changes']);
    T.check('K dry run --quiet: changes name the element file', jq && jq.changes.some((c: any) => c.path === 'tasks/TSK-001.md' && c.op === 'modify'), jq && jq.changes);
    T.eq('K dry run --quiet: the hook never fired', calls(fq.cap).length, 0);
    T.eq('K dry run --quiet: the real tree is unchanged', snapshot(fq.d), before);

    const ff = fixture('k-fields');
    const beforeF = snapshot(ff.d);
    const rf = hooked(ff.d, ff.cap, ['set', '--id=TSK-001', '--status=doing', '--fields=status,id', '--dry-run', '--json']);
    const jf = parse(rf);
    T.exit('K dry run --fields: exit 0', rf, 0);
    T.eq('K dry run --fields: entry narrowed, in the order given', jf && jf.entry, { status: 'doing', id: 'TSK-001' });
    T.eq('K dry run --fields: dry_run and changes appended last', jf && Object.keys(jf).slice(-2), ['dry_run', 'changes']);
    T.eq('K dry run --fields: the hook never fired', calls(ff.cap).length, 0);
    T.eq('K dry run --fields: the real tree is unchanged', snapshot(ff.d), beforeF);

    const fd = fixture('k-doctor-nothing');
    const beforeD = snapshot(fd.d);
    const rd = hooked(fd.d, fd.cap, ['doctor', '--fix', '--dry-run', '--json']);
    const jd = parse(rd);
    T.exit('K dry run doctor --fix, nothing to fix: exit 0', rd, 0);
    T.eq('K dry run doctor --fix, nothing to fix: fixed is empty', jd && jd.fixed, []);
    T.eq('K dry run doctor --fix, nothing to fix: dry_run', jd && jd.dry_run, true);
    T.eq('K dry run doctor --fix, nothing to fix: changes is empty', jd && jd.changes, []);
    T.eq('K dry run doctor --fix, nothing to fix: the hook never fired', calls(fd.cap).length, 0);
    T.eq('K dry run doctor --fix, nothing to fix: the real tree is unchanged', snapshot(fd.d), beforeD);
  }
  // A plan that fails part way under --dry-run: the copy keeps the real
  // modes, so a read-only tasks/ fails the second node there too. The
  // would-be partial result is reported, nothing fires (skipped as root).
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const fp = fixture('k-plan-partial');
    const tasksDir = path.join(fp.bl, 'tasks');
    fs.chmodSync(tasksDir, 0o555);
    try {
      const beforeP = snapshot(fp.d);
      const rp = hooked(fp.d, fp.cap, ['new', '--input=-', '--dry-run', '--json'], undefined,
        JSON.stringify([{ type: 'epic', title: 'Partial' }, { type: 'task', parent: 'EPIC-001', title: 'Blocked' }]));
      const jp = parse(rp);
      T.exit('K dry run plan stopped part way: exit 1', rp, 1);
      T.eq('K dry run plan stopped part way: created names the epic', jp && jp.created, ['EPIC-002']);
      T.check('K dry run plan stopped part way: failed_at is reported', jp && typeof jp.failed_at === 'string', jp);
      T.eq('K dry run plan stopped part way: dry_run', jp && jp.dry_run, true);
      T.check('K dry run plan stopped part way: changes list the epic it created',
        jp && Array.isArray(jp.changes) && jp.changes.some((c: any) => c.path === 'epics/EPIC-002.md' && c.op === 'create'), jp && jp.changes);
      T.eq('K dry run plan stopped part way: the hook never fired', calls(fp.cap).length, 0);
      T.check('K dry run plan stopped part way: no hook warning', !rp.stderr.includes('NJ_ON_CHANGE'), rp.stderr);
      T.eq('K dry run plan stopped part way: the real tree is unchanged', snapshot(fp.d), beforeP);
    } finally { fs.chmodSync(tasksDir, 0o755); }
  } else {
    console.log('  (K dry-run plan-stopped-part-way leg skipped: running as root)');
  }
  // The hook stays armed for the very next real write in the same backlog.
  const f = fixture('k-after');
  hooked(f.d, f.cap, ['set', '--id=TSK-001', '--status=doing', '--dry-run', '--json']);
  const real = hooked(f.d, f.cap, ['set', '--id=TSK-001', '--status=doing', '--json']);
  const ca = calls(f.cap);
  T.eq('K a real write after a dry run fires once', ca.length, 1);
  if (ca.length === 1) {
    T.eq('K ... with the real backlog as NJ_BACKLOG', ca[0].backlog, f.bl);
    T.eq('K ... and the real result on stdin', ca[0].stdin, real.stdout);
  }
}

/* ---------------------------------------------------------------- */
/* J. static: the hook module never reads the backlog's config       */
/* ---------------------------------------------------------------- */
{
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const mod = path.join(SRC, 'core', 'on-change.ts');
  if (fs.existsSync(mod)) {
    const text = fs.readFileSync(mod, 'utf8');
    const imports = (text.match(/^import .* from '([^']+)';$/gm) || []).map((l) => l.replace(/^.* from '([^']+)';$/, '$1'));
    T.eq('J on-change.ts imports only child_process, types, output and dry-run (no config, no fs, no load)',
      imports.filter((i) => !['./types.ts', 'child_process', './output.ts', './dry-run.ts'].includes(i)), []);
    T.check('J on-change.ts reads the hook from process.env.NJ_ON_CHANGE', text.includes('process.env.NJ_ON_CHANGE'));
    // The two dry-run guards are redundant on purpose, so leg K alone
    // cannot see one of them go missing: each is pinned here instead.
    T.check('J dry-run guard 1: beginOnChange never arms on --dry-run', text.includes("if (flags.has('dry-run')) return;"));
    T.check('J dry-run guard 2: recordChange ignores a dry run', text.includes('if (isDryRun()) return;'));
  } else {
    console.log('  (J skipped: src/core/on-change.ts not present next to this suite)');
  }
}

T.finish();
