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
 * G an unreadable directory (skipped as root); H a layout folder, or an ID
 * folder under `hierarchy`, that is a symlink to a directory outside the
 * backlog: the dry run writes nothing there either (TSK-042, DECISIONS
 * 218), while the real call still writes through it (DECISIONS 105);
 * I `$TMPDIR` inside the backlog or inside a linked layout folder's target:
 * the copy leaves its own scratch folder out instead of copying itself
 * into itself (DECISIONS 218); J a FIFO as `config.json`, or among the
 * element files: the dry run is refused like the real call instead of
 * blocking on it or leaving it out of the copy (DECISIONS 215, 218).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
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
  T.eq('D --quiet: {ok, id, files} plus dry_run and changes', Object.keys(q.dry.json || {}), ['ok', 'id', 'files', 'dry_run', 'changes']);
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

/* ------------------------------------------------------------------ */
/* H. A top-level folder symlinked outside the backlog (TSK-042)       */
/* ------------------------------------------------------------------ */

/** contents(), but a symlink at the backlog's top level that points at a
 * directory is walked as that directory: the real call writes through it
 * (DECISIONS 105), so that is where its changes are. */
function contentsFollowTop(root: string): Map<string, Node> {
  const out = new Map<string, Node>();
  const visit = (p: string, rel: string, top: boolean) => {
    let st = fs.lstatSync(p);
    if (top && st.isSymbolicLink()) { try { st = fs.statSync(p); } catch { /* dangling */ } }
    if (st.isDirectory()) {
      out.set(rel, { kind: 'dir', content: null });
      for (const n of fs.readdirSync(p)) visit(path.join(p, n), rel === '.' ? n : rel + '/' + n, rel === '.');
    } else if (st.isSymbolicLink()) out.set(rel, { kind: 'symlink', content: fs.readlinkSync(p) });
    else out.set(rel, { kind: 'file', content: fs.readFileSync(p, 'utf8') });
  };
  visit(root, '.', false);
  return out;
}

function sectionH() {
  /** Moves backlog/<name> to <dir>/outside/<name> and links it back. */
  const linkOut = (name: string, absolute: boolean) => (dir: string) => {
    const b = backlogOf(dir), o = path.join(dir, 'outside');
    fs.mkdirSync(o, { recursive: true });
    fs.renameSync(path.join(b, name), path.join(o, name));
    fs.symlinkSync(absolute ? path.join(o, name) : path.join('..', 'outside', name), path.join(b, name));
  };
  const NEW = ['new', '--type=task', '--parent=EPIC-001', '--title=dry', '--description=D.', '--acceptance=- [ ] x'];
  const SET = ['set', '--id=TSK-001', '--status=doing'];
  const CLAIM = ['claim', '--id=TSK-002', '--as=agent'];
  // A configured folder name; linked under another case it is still read
  // (matched case-insensitively, DECISIONS 105) — `set` rewrites a file in
  // it, while `new` places under the configured spelling.
  const WORK = (dir: string) => base(dir, (d) => setConfig(d, (c) => { c.layout = { folders: { tasks: 'work' } }; }));
  const linkWork = (dir: string) => {
    linkOut('work', true)(dir);
    fs.renameSync(path.join(backlogOf(dir), 'work'), path.join(backlogOf(dir), 'Work'));
  };
  // [label, fixture, layout change, args]: every call writes into the
  // linked folder.
  // --file= naming the element by its real path behind the link.
  const CLAIM_FILE = (dir: string) => ['claim', '--file=' + path.join(dir, 'outside', 'tasks', 'TSK-002.md'), '--as=agent'];
  const cases: Array<[string, (dir: string) => void, (dir: string) => void, string[] | ((dir: string) => string[])]> = [
    ['tasks, relative link: new', BASE, linkOut('tasks', false), NEW],
    ['tasks, absolute link: new', BASE, linkOut('tasks', true), NEW],
    ['tasks, absolute link: set', BASE, linkOut('tasks', true), SET],
    ['tasks, absolute link: claim', BASE, linkOut('tasks', true), CLAIM],
    ['tasks, relative link: claim --file=<path behind the link>', BASE, linkOut('tasks', false), CLAIM_FILE],
    ['configured folder work: new', WORK, linkOut('work', true), NEW],
    ['configured folder work, linked as Work: set', WORK, linkWork, SET],
  ];
  for (const [clabel, setup, restructure, argsOf] of cases) {
    const argsFor = (dir: string) => (typeof argsOf === 'function' ? argsOf(dir) : argsOf);
    const label = 'H ' + clabel;
    const dryDir = H.freshDir('h-dry'), realDir = H.freshDir('h-real');
    fromTemplate(setup, dryDir); restructure(dryDir);
    fromTemplate(setup, realDir); restructure(realDir);
    const tmp = H.freshDir('h-tmpdir');
    const outside = (dir: string) => path.join(dir, 'outside');
    const outBefore = fingerprint(outside(dryDir));
    const blBefore = fingerprint(backlogOf(dryDir));
    const before = contentsFollowTop(backlogOf(dryDir));
    const realOutBefore = fingerprint(outside(realDir));
    const dry = runJ(argsFor(dryDir).concat(['--dry-run']), dryDir, { env: { TMPDIR: tmp } });
    const real = runJ(argsFor(realDir), realDir);
    T.eq(`${label}: the dry run writes nothing in the linked folder`, fingerprintDiff(outBefore, fingerprint(outside(dryDir))), []);
    T.eq(`${label}: the backlog itself stays byte-identical`, fingerprintDiff(blBefore, fingerprint(backlogOf(dryDir))), []);
    T.eq(`${label}: no scratch copy left in TMPDIR`, fs.readdirSync(tmp), []);
    T.eq(`${label}: exit code is the real call's (0)`, [dry.status, real.status], [0, 0]);
    T.check(`${label}: dry_run is true`, !!dry.json && dry.json.dry_run === true, J(dry.json));
    T.eq(`${label}: changes equals what the real call changed`, J(dry.json && dry.json.changes),
      J(expectedChanges(before, contentsFollowTop(backlogOf(realDir)))));
    T.check(`${label}: the real call wrote through the link (DECISIONS 105)`,
      fingerprintDiff(realOutBefore, fingerprint(outside(realDir))).length > 0, '');
  }

  // Below the top level a directory symlink is never followed by the scan
  // (DECISIONS 91 B11), but `hierarchy` still places a new child in its
  // parent's ID folder through one. The dry run reports that write and
  // makes it in the scratch copy only.
  const HIER = (dir: string) => {
    base(dir, (d) => setConfig(d, (c) => { c.layout = { group: 'hierarchy' }; }));
    const b = backlogOf(dir), o = path.join(dir, 'outside');
    fs.mkdirSync(o);
    // EPIC-001.md stays readable at the top level; its ID folder moves out.
    fs.renameSync(path.join(b, 'EPIC-001', 'EPIC-001.md'), path.join(b, 'EPIC-001.md'));
    fs.renameSync(path.join(b, 'EPIC-001'), path.join(o, 'EPIC-001'));
    fs.symlinkSync(path.join('..', 'outside', 'EPIC-001'), path.join(b, 'EPIC-001'));
  };
  const hl = 'H hierarchy, ID folder EPIC-001 linked out: new';
  const dryDir = H.freshDir('h-hier-dry'), realDir = H.freshDir('h-hier-real');
  HIER(dryDir); HIER(realDir);
  const tmp = H.freshDir('h-hier-tmpdir');
  const outBefore = fingerprint(path.join(dryDir, 'outside'));
  const blBefore = fingerprint(backlogOf(dryDir));
  const realOutBefore = fingerprint(path.join(realDir, 'outside'));
  const dry = runJ(NEW.concat(['--dry-run']), dryDir, { env: { TMPDIR: tmp } });
  const real = runJ(NEW, realDir);
  T.eq(`${hl}: the dry run writes nothing in the linked folder`, fingerprintDiff(outBefore, fingerprint(path.join(dryDir, 'outside'))), []);
  T.eq(`${hl}: the backlog itself stays byte-identical`, fingerprintDiff(blBefore, fingerprint(backlogOf(dryDir))), []);
  T.eq(`${hl}: no scratch copy left in TMPDIR`, fs.readdirSync(tmp), []);
  T.eq(`${hl}: exit code is the real call's (0)`, [dry.status, real.status], [0, 0]);
  const created = fingerprintDiff(realOutBefore, fingerprint(path.join(realDir, 'outside')));
  T.check(`${hl}: the real call wrote through the link`, created.some((l) => l.includes('EPIC-001/TSK-004/TSK-004.md')), J(created));
  const changes = (dry.json && dry.json.changes) || [];
  T.eq(`${hl}: changes names the write through the link, and nothing else in it`,
    changes.filter((c: any) => c.path.startsWith('EPIC-001/')).map((c: any) => c.op + ' ' + c.kind + ' ' + c.path),
    ['create dir EPIC-001/TSK-004', 'create file EPIC-001/TSK-004/TSK-004.md']);
}

/* ------------------------------------------------------------------ */
/* I. $TMPDIR inside what is copied (DECISIONS 218)                    */
/* ------------------------------------------------------------------ */

function sectionI() {
  const linkTasks = (dir: string) => {
    const b = backlogOf(dir), o = path.join(dir, 'outside');
    fs.mkdirSync(o);
    fs.renameSync(path.join(b, 'tasks'), path.join(o, 'tasks'));
    fs.symlinkSync(path.join('..', 'outside', 'tasks'), path.join(b, 'tasks'));
    fs.mkdirSync(path.join(o, 'tasks', 'tmp'));
  };
  const dotTmp = (dir: string) => { fs.mkdirSync(path.join(backlogOf(dir), '.tmp')); };
  const cases: Array<[string, (dir: string) => void, string, string]> = [
    ['I TMPDIR inside the linked tasks target', linkTasks, 'outside/tasks/tmp', 'outside'],
    ['I TMPDIR inside the backlog (.tmp)', dotTmp, 'backlog/.tmp', 'backlog'],
  ];
  const NEW = ['new', '--type=task', '--parent=EPIC-001', '--title=dry', '--description=D.', '--acceptance=- [ ] x'];
  for (const [label, restructure, tmpRel, watched] of cases) {
    const dryDir = H.freshDir('i-dry'), realDir = H.freshDir('i-real');
    fromTemplate(BASE, dryDir); restructure(dryDir);
    fromTemplate(BASE, realDir); restructure(realDir);
    const tmp = path.join(dryDir, tmpRel);
    // The scratch folder comes and goes inside $TMPDIR, so only that one
    // directory's own entry (its mtime) may differ afterwards.
    const fp = () => { const m = fingerprint(path.join(dryDir, watched)); m.delete(path.relative(path.join(dryDir, watched), tmp)); return m; };
    const fpBefore = fp();
    const before = contentsFollowTop(backlogOf(dryDir));
    const dry = runJ(NEW.concat(['--dry-run']), dryDir, { env: { TMPDIR: tmp } });
    const real = runJ(NEW, realDir);
    T.eq(`${label}: exit codes (dry, real) are both 0`, [dry.status, real.status], [0, 0]);
    T.check(`${label}: no io_error from a copy of the copy`, !(dry.json && dry.json.error), J(dry.json) + ' ' + dry.stderr.slice(0, 300));
    T.eq(`${label}: ${watched}/ stays byte-identical`, fingerprintDiff(fpBefore, fp()), []);
    T.eq(`${label}: no scratch copy left in TMPDIR`, fs.readdirSync(tmp), []);
    T.eq(`${label}: changes equals what the real call changed`, J(dry.json && dry.json.changes),
      J(expectedChanges(before, contentsFollowTop(backlogOf(realDir)))));
  }
}

/* ------------------------------------------------------------------ */
/* J. A FIFO as the configuration (DECISIONS 215, 218)                 */
/* ------------------------------------------------------------------ */

/** The dry run reads the configured folder names before it copies
 * anything (DECISIONS 218); a FIFO there must be refused like the real
 * call refuses it (`invalid_config`, DECISIONS 215), never block on the
 * open. The fingerprint helpers read every file, so they are not used on
 * this tree. */
function sectionJ() {
  if (process.platform === 'win32') { T.notCovered('J a FIFO config.json', 'no mkfifo on Windows'); return; }
  const fifo = (dir: string): string | null => {
    const file = path.join(backlogOf(dir), '.nanojira', 'config.json');
    fs.rmSync(file);
    return spawnSync('mkfifo', [file]).status === 0 ? file : null;
  };
  const dryDir = H.freshDir('j-dry'), realDir = H.freshDir('j-real');
  fromTemplate(BASE, dryDir); fromTemplate(BASE, realDir);
  const dryCfg = fifo(dryDir), realCfg = fifo(realDir);
  if (dryCfg === null || realCfg === null) { T.notCovered('J a FIFO config.json', 'mkfifo failed'); return; }
  const tmp = H.freshDir('j-tmpdir');
  const SET = ['set', '--id=TSK-001', '--title=renamed', '--json'];
  const opts = (cwd: string, extra: Record<string, string>) => ({ cwd, timeout: 20000, env: Object.assign({}, ENV, extra), unsetEnv: ['NJ_BACKLOG'] });
  const dry = H.runJson(SET.concat(['--dry-run']), opts(dryDir, { TMPDIR: tmp }));
  const real = H.runJson(SET, opts(realDir, {}));
  T.check('J FIFO config.json, --dry-run: returns instead of hanging', dry.status !== null, H.describeRun(dry));
  T.eq('J FIFO config.json: the real call is invalid_config', [real.status, real.json && real.json.error], [1, 'invalid_config']);
  T.eq('J FIFO config.json, --dry-run: the same exit code and error as the real call',
    [dry.status, dry.json && dry.json.error], [real.status, real.json && real.json.error]);
  T.eq('J FIFO config.json, --dry-run: the same stderr (paths mapped)', dry.stderr, real.stderr.split(realDir).join(dryDir));
  T.check('J FIFO config.json, --dry-run: it is still the FIFO', fs.lstatSync(dryCfg).isFIFO(), '');
  T.eq('J FIFO config.json, --dry-run: no scratch copy left in TMPDIR', fs.readdirSync(tmp), []);

  // A FIFO among the element files is a stub (`file:unreadable`) for the
  // real call, so `rm` is refused; the copy must hold something that reads
  // the same way, not leave it out.
  const eDry = H.freshDir('j-el-dry'), eReal = H.freshDir('j-el-real');
  fromTemplate(BASE, eDry); fromTemplate(BASE, eReal);
  for (const d of [eDry, eReal]) spawnSync('mkfifo', [path.join(backlogOf(d), 'tasks', 'TSK-009.md')]);
  const RM = ['rm', '--id=TSK-002', '--json'];
  const tmp2 = H.freshDir('j-el-tmpdir');
  const rDry = H.runJson(RM.concat(['--dry-run']), opts(eDry, { TMPDIR: tmp2 }));
  const rReal = H.runJson(RM, opts(eReal, {}));
  T.check('J FIFO element file, --dry-run: returns instead of hanging', rDry.status !== null, H.describeRun(rDry));
  T.eq('J FIFO element file: the real rm is refused:unreadable', [rReal.status, rReal.json && rReal.json.error], [1, 'refused:unreadable']);
  T.eq('J FIFO element file, --dry-run: the same exit code and error as the real call',
    [rDry.status, rDry.json && rDry.json.error], [rReal.status, rReal.json && rReal.json.error]);
  T.eq('J FIFO element file, --dry-run: the same stderr (paths mapped)', rDry.stderr, rReal.stderr.split(eReal).join(eDry));
  T.eq('J FIFO element file, --dry-run: no scratch copy left in TMPDIR', fs.readdirSync(tmp2), []);
}

sectionA();
sectionB();
sectionC();
sectionD();
sectionE();
sectionF();
sectionG();
sectionH();
sectionI();
sectionJ();
T.finish();
