/* AC-61 — `--dry-run` on every write command, docs/SPECIFICATION.md § 9
 * "`--dry-run`" (DECISIONS 197).
 *
 * Team task TSK-007 (feedback/scans-team): "--dry-run on every write
 * command" and "test: dry-run leaves the backlog byte-identical".
 *
 * Every supported command goes through probe(): the same fixture is built
 * twice, the dry run runs against one copy, the real call against the
 * other. Then:
 *   - the dry-run copy is byte-identical afterwards: the same file list,
 *     and for every path the same kind, mode, size, mtime and bytes
 *     (directories included, so a temp file created and removed again
 *     would show through the directory's own mtime);
 *   - the exit code, stderr and the JSON result equal the real call's
 *     (paths mapped from one copy to the other), apart from `dry_run`
 *     and `changes`;
 *   - `changes` equals what the real call actually changed, computed
 *     here independently from the two trees;
 *   - the scratch copy in TMPDIR is gone.
 *
 * Sections: A every supported command, success; B refusals return the
 * real call's code; C read commands and plain `doctor` reject the flag;
 * D `--quiet`/`--fields` compose; E prose output; F `--file=<abs path>`;
 * G an unreadable directory (skipped as root).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

// Every call gets a scratch TMPDIR of its own (probe() checks it is left
// empty), so even a broken build never leaves a copy in the real one.
const ENV = { NJ_NOW: H.FIXED_NOW, NJ_AUTHOR: 'coder-agent', TMPDIR: H.freshDir('tmpdir') };

interface RunO { input?: string; env?: Record<string, string | undefined> }

function run(args: string[], cwd: string, o?: RunO) {
  return H.runNj(args, { cwd, input: o && o.input, env: Object.assign({}, ENV, (o && o.env) || {}), unsetEnv: ['NJ_BACKLOG'] });
}
function runJ(args: string[], cwd: string, o?: RunO) {
  return H.runJson(args, { cwd, input: o && o.input, env: Object.assign({}, ENV, (o && o.env) || {}), unsetEnv: ['NJ_BACKLOG'] });
}
function ok(r: H.RunResult, what: string) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/** rel → a line naming kind, mode, size, mtime and content hash. Byte
 * identity of the whole tree is equality of these maps. */
function fingerprint(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (p: string, rel: string) => {
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { return; }
    const meta = `mode=${(st.mode & 0o7777).toString(8)} mtime=${st.mtimeMs}`;
    if (st.isDirectory()) {
      out.set(rel, `dir ${meta}`);
      let names: string[] = [];
      try { names = fs.readdirSync(p); } catch { return; }
      for (const n of names) visit(path.join(p, n), rel === '.' ? n : rel + '/' + n);
    } else if (st.isSymbolicLink()) {
      out.set(rel, `link ${fs.readlinkSync(p)}`);
    } else {
      let h = 'unreadable';
      try { h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { /* mode 000 */ }
      out.set(rel, `file ${meta} size=${st.size} sha=${h}`);
    }
  };
  visit(root, '.');
  return out;
}

function fingerprintDiff(a: Map<string, string>, b: Map<string, string>): string[] {
  const d: string[] = [];
  for (const [k, v] of a) if (b.get(k) !== v) d.push(`${k}: ${v} -> ${b.has(k) ? b.get(k) : '(gone)'}`);
  for (const [k, v] of b) if (!a.has(k)) d.push(`${k}: (new) ${v}`);
  return d;
}

interface Node { kind: string; content: string | null }

function contents(root: string): Map<string, Node> {
  const out = new Map<string, Node>();
  if (!fs.existsSync(root)) return out;
  const visit = (p: string, rel: string) => {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      out.set(rel, { kind: 'dir', content: null });
      let names: string[] = [];
      try { names = fs.readdirSync(p); } catch { /* mode 000 (section G) */ }
      for (const n of names) visit(path.join(p, n), rel === '.' ? n : rel + '/' + n);
    } else out.set(rel, { kind: 'file', content: fs.readFileSync(p, 'utf8') });
  };
  visit(root, '.');
  return out;
}

/** The spec's `changes` list (§ 9 "`--dry-run`"), derived independently
 * from the tree before and after the real call. */
function expectedChanges(before: Map<string, Node>, after: Map<string, Node>) {
  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const res: object[] = [];
  for (const p of paths) {
    const a = before.get(p), b = after.get(p);
    if (a && !b) res.push({ path: p, kind: a.kind, op: 'delete', before: a.content, after: null });
    else if (!a && b) res.push({ path: p, kind: b.kind, op: 'create', before: null, after: b.content });
    else if (a && b && a.kind !== b.kind) {
      res.push({ path: p, kind: a.kind, op: 'delete', before: a.content, after: null });
      res.push({ path: p, kind: b.kind, op: 'create', before: null, after: b.content });
    } else if (a && b && a.content !== b.content) res.push({ path: p, kind: a.kind, op: 'modify', before: a.content, after: b.content });
  }
  return res;
}

function swapPaths(v: unknown, from: string, to: string): unknown {
  if (typeof v === 'string') return v.split(from).join(to);
  if (Array.isArray(v)) return v.map((x) => swapPaths(x, from, to));
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = swapPaths(x, from, to);
    return o;
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function edit(file: string, f: (s: string) => string) { fs.writeFileSync(file, f(fs.readFileSync(file, 'utf8'))); }
function setConfig(dir: string, f: (c: any) => void) {
  const p = path.join(dir, 'backlog', '.nanojira', 'config.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  f(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
}

/** EPIC-001 > TSK-001 (todo, acceptance ticked), TSK-002 (todo, tagged,
 * acceptance open); EPIC-002 done > TSK-003 done. */
function base(dir: string, configure?: (dir: string) => void) {
  ok(run(['init'], dir), 'init');
  if (configure) configure(dir);
  ok(run(['new', '--type=epic', '--title=E1', '--description=D.'], dir), 'EPIC-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] a'], dir), 'TSK-001');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [ ] b', '--tags=api'], dir), 'TSK-002');
  ok(run(['new', '--type=epic', '--title=E2', '--description=D.'], dir), 'EPIC-002');
  ok(run(['new', '--type=task', '--parent=EPIC-002', '--title=T3', '--description=D.', '--acceptance=- [x] c'], dir), 'TSK-003');
  ok(run(['set', '--id=TSK-003', '--status=done'], dir), 'TSK-003 done');
  ok(run(['set', '--id=EPIC-002', '--status=done'], dir), 'EPIC-002 done');
}

const BASE = (dir: string) => base(dir);

/** Each fixture is built once, by the CLI, then copied into every
 * directory that needs it (mtimes kept) — building it for both the dry
 * and the real copy of every probe would triple the run time. */
const built = new Map<(dir: string) => void, string>();
function fromTemplate(setup: (dir: string) => void, dir: string) {
  let t = built.get(setup);
  if (t === undefined) {
    t = H.freshDir('template');
    setup(t);
    built.set(setup, t);
  }
  fs.cpSync(t, dir, { recursive: true, preserveTimestamps: true });
}

interface Probe {
  label: string;
  setup: (dir: string) => void;
  /** Build the fixture in place instead of copying a template (section G:
   * a mode-000 directory cannot be copied). */
  fresh?: boolean;
  args: (dir: string) => string[];
  input?: string;
  /** The tree compared: the backlog, unless the call creates it (`init`). */
  root?: (dir: string) => string;
  json?: boolean;
}

const backlogOf = (dir: string) => path.join(dir, 'backlog');

/**
 * Runs `p` as a dry run on one copy and for real on another, and checks
 * everything the spec promises about the pair. Returns both results.
 */
function probe(p: Probe) {
  const json = p.json !== false;
  const dryDir = H.freshDir(p.label + '-dry');
  const realDir = H.freshDir(p.label + '-real');
  if (p.fresh) { p.setup(dryDir); p.setup(realDir); } else { fromTemplate(p.setup, dryDir); fromTemplate(p.setup, realDir); }
  const root = p.root || backlogOf;
  const tmp = H.freshDir(p.label + '-tmpdir');
  const fpBefore = fingerprint(root(dryDir));
  const before = contents(root(dryDir));
  const runner = (args: string[], cwd: string, o: RunO): H.JsonRunResult =>
    (json ? runJ(args, cwd, o) : Object.assign(run(args, cwd, o), { json: null, parseError: null }));
  const dry = runner(p.args(dryDir).concat(['--dry-run']), dryDir, { input: p.input, env: { TMPDIR: tmp } });
  const fpAfter = fingerprint(root(dryDir));
  const real = runner(p.args(realDir), realDir, { input: p.input });

  T.eq(`${p.label}: dry run leaves the backlog byte-identical`, fingerprintDiff(fpBefore, fpAfter), []);
  T.eq(`${p.label}: no scratch copy left in TMPDIR`, fs.readdirSync(tmp), []);
  T.eq(`${p.label}: exit code is the real call's (${real.status})`, dry.status, real.status);
  T.eq(`${p.label}: stderr is the real call's`, dry.stderr, real.stderr.split(realDir).join(dryDir));
  if (json) {
    const d = dry.json, r = real.json;
    T.check(`${p.label}: dry_run is true`, d && d.dry_run === true, J(d));
    const rest = Object.assign({}, d);
    delete rest.dry_run; delete rest.changes;
    T.eq(`${p.label}: result equals the real call's`, J(rest), J(swapPaths(r, realDir, dryDir)));
    T.eq(`${p.label}: dry_run and changes come last`, Object.keys(d || {}).slice(-2), ['dry_run', 'changes']);
    T.eq(`${p.label}: changes equals what the real call changed`, J(d && d.changes), J(expectedChanges(before, contents(root(realDir)))));
  }
  return { dry, real, dryDir, realDir };
}

/* ------------------------------------------------------------------ */
/* A. Every supported command, success                                 */
/* ------------------------------------------------------------------ */

function sectionA() {
  probe({ label: 'a-init', setup: () => {}, args: () => ['init'], root: (d) => path.join(d, 'backlog') });
  probe({ label: 'a-new', setup: BASE, args: () => ['new', '--type=task', '--parent=EPIC-001', '--title=New', '--description=D.', '--acceptance=- [ ] n', '--tags=api,ui'] });
  probe({
    label: 'a-new-input', setup: BASE, args: () => ['new', '--input=-'],
    input: JSON.stringify([{ type: 'epic', title: 'P', description: 'D.', children: [
      { ref: '@a', type: 'task', title: 'PA', description: 'D.', acceptance: ['x'] },
      { type: 'task', title: 'PB', description: 'D.', acceptance: ['y'], depends_on: ['@a'] }] }]),
  });
  probe({
    label: 'a-new-sharded', args: () => ['new', '--type=epic', '--title=S', '--description=D.'],
    setup: (d) => base(d, (x) => setConfig(x, (c) => { c.ids = { shardSize: 2 }; })),
  });
  probe({ label: 'a-set', setup: BASE, args: () => ['set', '--id=TSK-002', '--status=doing', '--priority=high', '--add-tags=ui'] });
  probe({ label: 'a-set-input', setup: BASE, args: () => ['set', '--id=TSK-002', '--input=-'], input: JSON.stringify({ title: 'Renamed', status: 'review' }) });
  probe({ label: 'a-set-batch', setup: BASE, args: () => ['set', '--id=TSK-001,TSK-002', '--priority=low'] });
  probe({
    label: 'a-set-parent-hierarchy', args: () => ['set', '--id=TSK-002', '--parent=EPIC-002'],
    setup: (d) => base(d, (x) => setConfig(x, (c) => { c.layout.group = 'hierarchy'; })),
  });
  probe({ label: 'a-note', setup: BASE, args: () => ['note', '--id=TSK-002', 'a dry note'] });
  probe({ label: 'a-check', setup: BASE, args: () => ['check', '--id=TSK-002', '--text=b'] });
  probe({ label: 'a-claim', setup: BASE, args: () => ['claim', '--id=TSK-002', '--as=alice', '--status=doing'] });
  probe({
    label: 'a-claim-done', args: () => ['claim', '--id=TSK-001', '--as=alice', '--status=done'],
    setup: (d) => { base(d); ok(run(['claim', '--id=TSK-001', '--as=alice'], d), 'claim'); },
  });
  probe({
    label: 'a-release', args: () => ['release', '--id=TSK-002', '--as=alice'],
    setup: (d) => { base(d); ok(run(['claim', '--id=TSK-002', '--as=alice'], d), 'claim'); },
  });
  probe({ label: 'a-next', setup: BASE, args: () => ['next', '--as=bob', '--status=doing'] });
  probe({ label: 'a-archive', setup: BASE, args: () => ['archive', '--id=EPIC-002'] });
  probe({
    label: 'a-unarchive', args: () => ['unarchive', '--id=EPIC-002'],
    setup: (d) => { base(d); ok(run(['archive', '--id=EPIC-002'], d), 'archive'); },
  });
  probe({ label: 'a-rm', setup: BASE, args: () => ['rm', '--id=TSK-002'] });
  probe({
    label: 'a-rm-cascade', args: () => ['rm', '--id=EPIC-001', '--cascade'],
    setup: (d) => { base(d); ok(run(['claim', '--id=TSK-001', '--as=alice'], d), 'claim'); },
  });
  probe({
    label: 'a-doctor-fix', args: () => ['doctor', '--fix'],
    setup: (d) => {
      base(d);
      const bl = backlogOf(d);
      fs.unlinkSync(path.join(bl, 'STATUS.md'));
      fs.unlinkSync(path.join(bl, '.nanojira', 'ids', 'TSK-001'));
      fs.renameSync(path.join(bl, 'tasks', 'TSK-002.md'), path.join(bl, 'epics', 'TSK-002.md'));
      edit(path.join(bl, 'tasks', 'TSK-001.md'), (s) => s.replace('# T1', '# Other heading'));
    },
  });
  // The copy keeps every mtime: --fix fills a missing created/updated from
  // the file's own mtime, so a copy stamped "now" would write other bytes.
  probe({
    label: 'a-doctor-fix-mtime', args: () => ['doctor', '--fix'],
    setup: (d) => {
      base(d);
      const f = path.join(backlogOf(d), 'tasks', 'TSK-002.md');
      edit(f, (s) => s.replace(/^updated: .*\n/m, '').replace(/^created: .*\n/m, ''));
      fs.utimesSync(f, new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));
    },
  });
  // Two dry runs in a row report the same would-be id: nothing was reserved.
  {
    const dir = H.freshDir('a-not-reserved');
    base(dir);
    const r1 = runJ(['new', '--type=epic', '--title=X', '--dry-run'], dir);
    const r2 = runJ(['new', '--type=epic', '--title=X', '--dry-run'], dir);
    T.check('A not reserved: both dry runs report EPIC-003', r1.json && r1.json.id === 'EPIC-003' && r2.json && r2.json.id === 'EPIC-003', J([r1.json && r1.json.id, r2.json && r2.json.id]));
  }
}

/* ------------------------------------------------------------------ */
/* B. Refusals return the real call's code                             */
/* ------------------------------------------------------------------ */

function sectionB() {
  const nf = probe({ label: 'b-not-found', setup: BASE, args: () => ['set', '--id=TSK-099', '--status=doing'] });
  T.eq('B not_found', nf.dry.json && nf.dry.json.error, 'not_found');
  T.eq('B a refused dry run lists no changes', nf.dry.json && nf.dry.json.changes, []);
  const nd = probe({ label: 'b-archive-not-done', setup: BASE, args: () => ['archive', '--id=EPIC-001'] });
  T.check('B archive of an open epic is refused:*', nd.dry.json && /^refused:/.test(nd.dry.json.error), J(nd.dry.json));
  const cl = probe({
    label: 'b-claimed', args: () => ['claim', '--id=TSK-002', '--as=bob'],
    setup: (d) => { base(d); ok(run(['claim', '--id=TSK-002', '--as=alice'], d), 'claim'); },
  });
  T.eq('B refused:claimed', cl.dry.json && cl.dry.json.error, 'refused:claimed');
  const pl = probe({
    label: 'b-bad-plan', setup: BASE, args: () => ['new', '--input=-'],
    input: JSON.stringify([{ type: 'epic', title: 'P', children: [{ type: 'task', title: 'Q', depends_on: ['@later'] }, { ref: '@later', type: 'task', title: 'R' }] }]),
  });
  T.check('B a bad plan: invalid_value with failed_at', pl.dry.json && pl.dry.json.error === 'invalid_value' && pl.dry.json.failed_at !== undefined, J(pl.dry.json));
  const ex = probe({ label: 'b-init-exists', setup: BASE, args: () => ['init'] });
  T.eq('B init on an existing backlog: exists', ex.dry.json && ex.dry.json.error, 'exists');
  probe({ label: 'b-batch-partial', setup: BASE, args: () => ['set', '--id=TSK-002,EPIC-001', '--status=done'] });
  probe({ label: 'b-dup-flags', setup: BASE, args: () => ['set', '--id=TSK-002', '--tags=a', '--add-tags=b'] });
}

/* ------------------------------------------------------------------ */
/* C. Read commands and plain doctor reject the flag                   */
/* ------------------------------------------------------------------ */

function sectionC() {
  const dir = H.freshDir('c-reads');
  base(dir);
  const fp = fingerprint(backlogOf(dir));
  for (const args of [['list'], ['show', '--id=TSK-001'], ['show', '--id=TSK-001', '--notes=last:1'], ['find', 'T1'], ['tree'], ['tags'],
    ['log', '--id=TSK-001'], ['log', '--id=TSK-001', '--last=1'], []]) {
    const r = runJ(args.concat(['--dry-run']), dir);
    const name = args.length > 0 ? args.filter((a) => !a.startsWith('--id=')).join(' ') : '(bare)';
    T.exit(`C ${name} --dry-run: exit 1`, r, 1);
    T.eq(`C ${name} --dry-run: unknown_field`, r.json && r.json.error, 'unknown_field');
    T.check(`C ${name} --dry-run: no dry_run marker (not a dry run)`, r.json && !('dry_run' in r.json), J(r.json));
  }
  const d = runJ(['doctor', '--dry-run'], dir);
  T.exit('C doctor --dry-run without --fix: exit 1', d, 1);
  T.eq('C doctor --dry-run without --fix: invalid_value', d.json && d.json.error, 'invalid_value');
  T.contains('C doctor --dry-run without --fix: says why', d.stderr, '--dry-run requires --fix');
  const v = runJ(['set', '--id=TSK-002', '--status=doing', '--dry-run=yes'], dir);
  T.exit('C --dry-run=yes: exit 1', v, 1);
  T.eq('C --dry-run=yes: invalid_value', v.json && v.json.error, 'invalid_value');
  const t = runJ(['set', '--id=TSK-002', '--status=doing', '--dry-run'], dir, { env: { TMPDIR: path.join(dir, 'no-such-tmp') } });
  T.exit('C no scratch copy possible: exit 1', t, 1);
  T.eq('C no scratch copy possible: io_error', t.json && t.json.error, 'io_error');
  T.contains('C no scratch copy possible: names the temporary directory', t.stderr, path.join(dir, 'no-such-tmp'));
  T.eq('C nothing above wrote anything', fingerprintDiff(fp, fingerprint(backlogOf(dir))), []);
}

/* ------------------------------------------------------------------ */
/* D. --quiet / --fields compose                                       */
/* ------------------------------------------------------------------ */

function sectionD() {
  const q = probe({ label: 'd-quiet', setup: BASE, args: () => ['set', '--id=TSK-002', '--status=doing', '--quiet'] });
  T.eq('D --quiet: {ok, id} plus dry_run and changes', Object.keys(q.dry.json || {}), ['ok', 'id', 'dry_run', 'changes']);
  T.check('D --quiet: changes still carry contents', q.dry.json && q.dry.json.changes.length > 0 && typeof q.dry.json.changes[0].after === 'string', J(q.dry.json));
  const f = probe({ label: 'd-fields', setup: BASE, args: () => ['set', '--id=TSK-002', '--status=doing', '--fields=id,status'] });
  T.eq('D --fields: entry projected as in a real call', Object.keys((f.dry.json && f.dry.json.entry) || {}), ['id', 'status']);
  probe({ label: 'd-quiet-batch', setup: BASE, args: () => ['note', '--id=TSK-001,TSK-002', '--quiet', 'n'] });
  const nj = probe({ label: 'd-quiet-no-json', setup: BASE, args: () => ['set', '--id=TSK-002', '--status=doing', '--quiet'], json: false });
  T.exit('D --quiet without --json: still invalid_value under --dry-run', nj.dry, 1);
}

/* ------------------------------------------------------------------ */
/* E. Prose output                                                     */
/* ------------------------------------------------------------------ */

function sectionE() {
  const s = probe({ label: 'e-prose', setup: BASE, args: () => ['set', '--id=TSK-002', '--status=doing'], json: false });
  const summary = 'Dry run: nothing written. The real call would change 2 paths:\n  modify  STATUS.md\n  modify  tasks/TSK-002.md\n';
  T.eq('E prose: the real output, then the summary', s.dry.stdout, s.real.stdout.split(s.realDir).join(s.dryDir) + summary);
  const n = probe({ label: 'e-prose-new', setup: BASE, args: () => ['new', '--type=epic', '--title=X'], json: false });
  T.contains('E prose: a created element file is listed', n.dry.stdout, '  create  epics/EPIC-003.md\n');
  T.contains('E prose: the would-be headline names the real path', n.dry.stdout, path.join(n.dryDir, 'backlog', 'epics', 'EPIC-003.md'));
  const i = probe({ label: 'e-prose-init', setup: () => {}, args: () => ['init'], json: false, root: (d) => path.join(d, 'backlog') });
  T.contains('E prose: init lists the backlog folder itself as "."', i.dry.stdout, '  create  .\n');
  T.contains('E prose: directories carry a trailing slash', i.dry.stdout, '  create  epics/\n');
  const f = probe({ label: 'e-prose-fail', setup: BASE, args: () => ['set', '--id=TSK-099', '--status=doing'], json: false });
  T.eq('E prose failure: stdout is the summary alone', f.dry.stdout, 'Dry run: nothing written. The real call would change nothing.\n');
  const df = probe({ label: 'e-prose-doctor-fix', setup: (d) => { base(d); fs.unlinkSync(path.join(backlogOf(d), 'STATUS.md')); }, args: () => ['doctor', '--fix'], json: false });
  T.contains('E prose: doctor --fix names the backlog relative to the cwd, not the scratch copy', df.dry.stdout, 'backlog/: ');
}

/* ------------------------------------------------------------------ */
/* F. --file=<absolute path into the real backlog>                     */
/* ------------------------------------------------------------------ */

function sectionF() {
  const r = probe({ label: 'f-file-abs', setup: BASE, args: (d) => ['set', `--file=${path.join(backlogOf(d), 'tasks', 'TSK-002.md')}`, '--status=doing'] });
  T.eq('F --file=<abs>: ok', r.dry.json && r.dry.json.ok, true);
  T.eq('F --file=<abs>: entry.file is the real path', r.dry.json && r.dry.json.entry && r.dry.json.entry.file, path.join(backlogOf(r.dryDir), 'tasks', 'TSK-002.md'));
  probe({ label: 'f-file-rel', setup: BASE, args: () => ['note', '--file=tasks/TSK-002.md', 'x'] });
  probe({ label: 'f-file-missing', setup: BASE, args: (d) => ['set', `--file=${path.join(backlogOf(d), 'tasks', 'NOPE.md')}`, '--status=doing'] });
}

/* ------------------------------------------------------------------ */
/* G. An unreadable directory: the same refusal (skipped as root)      */
/* ------------------------------------------------------------------ */

function sectionG() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    T.check('G skipped: running as root, where mode 000 does not restrict reads', true);
    return;
  }
  const locked: string[] = [];
  const setup = (d: string) => {
    base(d);
    const p = path.join(backlogOf(d), 'tasks', 'locked');
    fs.mkdirSync(p);
    fs.writeFileSync(path.join(p, 'x.md'), 'x');
    fs.chmodSync(p, 0o000);
    locked.push(p);
  };
  try {
    const r = probe({ label: 'g-unreadable-dir', setup, fresh: true, args: () => ['archive', '--id=EPIC-002'] });
    T.eq('G refused:unreadable_dir, as the real call', r.dry.json && r.dry.json.error, 'refused:unreadable_dir');
  } finally {
    for (const p of locked) fs.chmodSync(p, 0o755);
  }
}

sectionA();
sectionB();
sectionC();
sectionD();
sectionE();
sectionF();
sectionG();
T.finish();
