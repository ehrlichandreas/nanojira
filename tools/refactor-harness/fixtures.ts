// The explicit fixture corpus: every command, every reachable failure code,
// and the cases the oracle does not reach. The list follows section 3 of
// review-verifier.md ("Fixtures, die fehlen") plus the additions it names
// ("Zusätzlich einfrieren").
//
// Scratch lives at a FIXED path, not mkdtemp — determinism first; absolute
// paths in JSON `file` and in duplicate_id messages then normalise to a stable
// token. Every fixture gets utimes, because `doctor --fix` derives `created`
// from the mtime.

import fs from 'fs';
import path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as R from './lib/record.ts';

const TS = R.FIXED_NOW;
// Built from its code point on purpose: a literal BOM in this source would be
// invisible and would look like an accident rather than the fixture it is (§ 7).
const BOM = String.fromCharCode(0xfeff);

function mkBacklogConfig(): string {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  }, null, 2) + '\n';
}

interface ElementSpec {
  id: string;
  type?: string;
  parent?: string;
  title?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  tags?: string[];
  depends_on?: string[];
  created?: string;
  updated?: string;
  archived?: string;
  desc?: string;
  acc?: string;
  folder?: string;
  file?: string;
  raw?: string;
}

const EL_FIELDS: (keyof ElementSpec)[] = [
  'id', 'type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived',
];

/** A complete element, so completeness rules do not mask the case under test. */
function el(f: ElementSpec): string {
  const lines = ['---'];
  for (const k of EL_FIELDS) {
    const v = f[k];
    if (v === undefined) continue;
    lines.push(`${k}: ${Array.isArray(v) ? '[' + v.join(', ') + ']' : v}`);
  }
  lines.push('---', '', `# ${f.title || f.id}`, '', '## Description', f.desc === undefined ? 'd' : f.desc, '');
  if (f.type !== 'epic') lines.push('## Acceptance Criteria', f.acc === undefined ? '- [ ] a' : f.acc, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

const MUTATORS = new Set(['init', 'new', 'set', 'note', 'rm', 'archive']);
function isMutation(args: string[]): boolean {
  const verb = args.find((a) => !a.startsWith('--'));
  if (verb === 'doctor') return args.includes('--fix');
  return MUTATORS.has(verb || '');
}

interface BacklogOpts {
  config?: string | null;
  tombstones?: boolean;
}

interface NjOpts {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  unsetEnv?: string[];
  backlogEnv?: string;
}

export class Ctx {
  root: string;
  shim: string;
  node: string;
  recordPath: string;
  calls: number;
  probing: boolean;

  constructor(root: string, shim: string, node: string, recordPath: string) {
    this.root = root; this.shim = shim; this.node = node; this.recordPath = recordPath;
    this.calls = 0;
    this.probing = false;
  }

  /** A fresh, fixed-path scratch directory for one scenario. */
  dir(name: string): string {
    const d = path.join(this.root, name);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /**
   * A backlog laid out by hand — no nj call, so `nj init` stays testable
   * too. The v3 layout (§ 4, V3-4): bookkeeping lives in `.nanojira/`, not
   * at the top level.
   */
  backlog(d: string, elements?: ElementSpec[], opts?: BacklogOpts): string {
    const o = opts || {};
    const b = path.join(d, 'backlog');
    for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira/ids']) {
      fs.mkdirSync(path.join(b, sub), { recursive: true });
    }
    if (o.config !== null) fs.writeFileSync(path.join(b, '.nanojira', 'config.json'), o.config || mkBacklogConfig());
    for (const e of elements || []) {
      const folder = e.folder || (e.type === 'epic' ? 'epics' : e.type === 'task' ? 'tasks' : 'subtasks');
      const name = (e.file || e.id) + '.md';
      fs.writeFileSync(path.join(b, folder, name), e.raw !== undefined ? e.raw : el(e));
      if (o.tombstones !== false) {
        try { fs.closeSync(fs.openSync(path.join(b, '.nanojira', 'ids', e.id), 'wx')); } catch { /* duplicate id */ }
      }
    }
    R.pinMtimes(b);
    return b;
  }

  nj(label: string, args: string[], opts?: NjOpts): SpawnSyncReturns<string> {
    const o = opts || {};
    const env: Record<string, string | undefined> = Object.assign({}, process.env, {
      HARNESS_RECORD: this.recordPath,
      HARNESS_LABEL: label,
    }, o.env || {});
    delete env.NJ_BACKLOG;          // § 4: discovery must be exercised, not short-circuited
    if (!env.NJ_NOW) env.NJ_NOW = TS;
    for (const k of o.unsetEnv || []) delete env[k];
    if (o.backlogEnv) env.NJ_BACKLOG = o.backlogEnv;
    this.calls++;
    const res = spawnSync(this.node, [this.shim].concat(args), {
      cwd: o.cwd || this.root,
      env,
      input: o.input,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!this.probing && isMutation(args)) this.probe(label, o);
    return res;
  }

  /**
   * After every state change, freeze the derived views as well. The bytes a
   * write produced are only half the contract; the other half is what `list`,
   * `tree`, `doctor` and the bare status say about the backlog afterwards —
   * including `_problems` order and the prose layout, which no acceptance
   * criterion pins (AC-13 covers JSON shapes, AC-14 only the sort order).
   */
  probe(label: string, o?: NjOpts): void {
    this.probing = true;
    try {
      for (const p of [[], ['list'], ['tree'], ['doctor']] as string[][]) {
        this.nj(`${label}>probe:${p[0] || 'status'}:prose`, p, o);
        this.nj(`${label}>probe:${p[0] || 'status'}:json`, p.concat(['--json']), o);
      }
    } finally {
      this.probing = false;
    }
  }

  /** Prose and --json are different code paths (§ 9); freeze both. */
  both(label: string, args: string[], opts?: NjOpts): void {
    this.nj(label + ':prose', args, opts);
    this.nj(label + ':json', args.concat(['--json']), opts);
  }
}

// ---------------------------------------------------------------- scenarios

export interface Scenario {
  name: string;
  fn: (c: Ctx) => void;
}

export const scenarios: Scenario[] = [];
const S = (name: string, fn: (c: Ctx) => void) => scenarios.push({ name, fn });

S('init', (c) => {
  const d = c.dir('init');
  c.both('init', ['init'], { cwd: d });          // the second call hits `exists`
  c.both('init-again', ['init'], { cwd: d });
  c.both('init-status', [], { cwd: d });
});

S('discovery', (c) => {
  const empty = c.dir('disc-empty');
  c.both('no_backlog', ['list'], { cwd: empty });

  const noCfg = c.dir('disc-nocfg');
  fs.mkdirSync(path.join(noCfg, 'backlog'), { recursive: true });
  c.both('backlog_without_config', ['list'], { cwd: noCfg });

  const badCfg = c.dir('disc-badcfg');
  c.backlog(badCfg, [], { config: '{"schema":1,"statuses":["todo"],"sections":{}}\n' });
  c.both('invalid_config', ['list'], { cwd: badCfg });
  c.both('invalid_config-doctor', ['doctor'], { cwd: badCfg });

  const ok = c.dir('disc-ok');
  const b = c.backlog(ok, [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }]);
  const nested = path.join(ok, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  c.both('nested-cwd', ['list'], { cwd: nested });
  c.both('njbacklog-env', ['list'], { cwd: c.root, backlogEnv: b });
  c.both('invalid_backlog_env', ['list'], { cwd: c.root, backlogEnv: path.join(ok, 'nope') });
  c.both('invalid_env-njnow', ['list'], { cwd: ok, env: { NJ_NOW: 'not-a-time' } });
});

S('commands-happy', (c) => {
  const d = c.dir('happy');
  c.backlog(d, []);
  c.both('new-epic', ['new', '--type=epic', '--title=Epic One'], { cwd: d });
  c.both('new-task', ['new', '--type=task', '--parent=EPIC-001', '--title=Task One'], { cwd: d });
  c.both('new-subtask', ['new', '--type=subtask', '--parent=TSK-001', '--title=Sub One'], { cwd: d });
  c.both('show', ['show', '--id=TSK-001'], { cwd: d });
  c.both('list', ['list'], { cwd: d });
  c.both('tree', ['tree'], { cwd: d });
  c.both('tree-id', ['tree', '--id=EPIC-001'], { cwd: d });
  c.both('tree-all', ['tree', '--all'], { cwd: d });
  c.both('status-bare', [], { cwd: d });
  c.both('doctor', ['doctor'], { cwd: d });
  c.both('note', ['note', '--id=TSK-001', 'a note'], { cwd: d });
  c.both('note-second', ['note', '--id=TSK-001', 'second note'], { cwd: d });
  c.both('set-desc', ['set', '--id=TSK-001', '--description=desc text'], { cwd: d });
  c.both('set-acc', ['set', '--id=TSK-001', '--acceptance=- [ ] crit'], { cwd: d });
  c.both('list-ready', ['list', '--ready'], { cwd: d });
  c.both('list-all', ['list', '--all'], { cwd: d });
});

S('help', (c) => {
  const d = c.dir('help');
  c.backlog(d, []);
  c.nj('help', ['help'], { cwd: d });
  c.nj('help-json', ['help', '--json'], { cwd: d });
  c.nj('flag-help', ['--help'], { cwd: d });
  c.both('unknown_command', ['frobnicate'], { cwd: d });
});

S('set-all-six-and-noop', (c) => {
  const d = c.dir('set6');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Dep', status: 'done', created: TS, updated: TS },
  ]);
  // M2a: all six settable fields at once — pins the `changed` order.
  c.both('set-six', ['set', '--id=TSK-001', '--title=New Title', '--status=doing',
    '--priority=high', '--assignee=someone', '--tags=a,b', '--depends-on=TSK-002'], { cwd: d });
  // Decision 17: no effective change writes nothing at all.
  c.both('set-noop', ['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  c.both('set-clear-lists', ['set', '--id=TSK-001', '--tags=', '--depends-on='], { cwd: d });
  c.both('set-empty-assignee', ['set', '--id=TSK-001', '--assignee='], { cwd: d });
});

S('flag-errors', (c) => {
  const d = c.dir('flagerr');
  c.backlog(d, [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }]);
  c.both('unknown_field', ['set', '--id=EPIC-001', '--statuss=done'], { cwd: d });
  // M2b: several invalid flags at once — the first failing check must win.
  c.both('multi-invalid', ['set', '--id=EPIC-001', '--statuss=done', '--nope=1'], { cwd: d });
  c.both('multi-invalid-new', ['new', '--type=bogus', '--title=', '--parent=NOPE-1'], { cwd: d });
  c.both('missing_value', ['set', '--id=EPIC-001', '--title'], { cwd: d });
  c.both('missing_argument', ['set', '--title=x'], { cwd: d });
  c.both('invalid_value-status', ['set', '--id=EPIC-001', '--status=nope'], { cwd: d });
  c.both('invalid_value-priority', ['set', '--id=EPIC-001', '--priority=nope'], { cwd: d });
  c.both('not_found', ['show', '--id=TSK-999'], { cwd: d });
  c.both('invalid_target-both', ['show', '--id=EPIC-001', '--file=x'], { cwd: d });
  c.both('list-filter-bad-status', ['list', '--status=nope'], { cwd: d });
  c.both('list-filter-bad-parent', ['list', '--parent=NOPE-1'], { cwd: d });
  c.both('tags-bracket', ['set', '--id=EPIC-001', '--tags=a]b'], { cwd: d });

  // Which check wins when a section SOURCE and another flag are both invalid.
  // Nothing else in the corpus or the oracle combines the two, so a step that
  // moved readSectionFlags past the status check would pass every gate while
  // silently changing which code the caller sees.
  //
  // The two verbs are deliberately asymmetric, and that asymmetry is the point:
  //   set  reads the sections FIRST  -> the section source decides
  //   new  reads the sections LAST   -> the field validation decides,
  //                                     because `new` must not allocate an id
  //                                     for a call it will refuse (§ 8).
  // It looks like an inconsistency and is not. Anyone "unifying" the two will
  // break one of the two contracts, so both legs are pinned here.
  c.both('prec-set-missing-file', ['set', '--id=EPIC-001', '--status=nope', '--description-file=/nope/missing.txt'], { cwd: d });
  c.both('prec-new-missing-file', ['new', '--type=task', '--parent=EPIC-001', '--title=x', '--status=nope', '--description-file=/nope/missing.txt'], { cwd: d });
  // Both legs answer invalid_value here, so only the HINT tells them apart —
  // that is why stderr is recorded byte for byte and not just the code.
  c.both('prec-set-both-stdin', ['set', '--id=EPIC-001', '--status=nope', '--description-file=-', '--acceptance-file=-'], { cwd: d });
  c.both('prec-new-both-stdin', ['new', '--type=task', '--parent=EPIC-001', '--title=x', '--status=nope', '--description-file=-', '--acceptance-file=-'], { cwd: d });
  // A wrong-type parent against a section source: parent resolution sits
  // between the two in `new`, so this leg pins the middle of the order.
  c.both('prec-new-parent-vs-section', ['new', '--type=task', '--parent=EPIC-999', '--title=x', '--description-file=/nope/missing.txt'], { cwd: d });
});

S('parent-rules', (c) => {
  const d = c.dir('parent');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
  ]);
  c.both('invalid_target-wrongtype', ['new', '--type=task', '--parent=TSK-001', '--title=x'], { cwd: d });
  c.both('invalid_target-sub-under-epic', ['new', '--type=subtask', '--parent=EPIC-001', '--title=x'], { cwd: d });
  c.both('not_found-parent', ['new', '--type=task', '--parent=EPIC-999', '--title=x'], { cwd: d });
  c.both('epic-with-parent', ['new', '--type=epic', '--parent=EPIC-001', '--title=x'], { cwd: d });
  c.both('missing-parent', ['new', '--type=task', '--title=x'], { cwd: d });
  c.both('not_found-depends', ['new', '--type=task', '--parent=EPIC-001', '--title=x', '--depends-on=TSK-999'], { cwd: d });
});

S('done-open-children', (c) => {
  const d = c.dir('doneopen');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
  ]);
  // M3: the children_open check runs BEFORE `status !== el.status`, so setting
  // done on an already-done parent refuses instead of being a no-op.
  c.both('done-on-done-open-children', ['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  c.both('allow-open-children', ['set', '--id=EPIC-001', '--status=done', '--allow-open-children'], { cwd: d });
  c.both('doctor-open-children', ['doctor'], { cwd: d });
});

S('cycles', (c) => {
  // M1: which elements carry the cycle code is semantics, not performance.
  const d = c.dir('cycles');
  c.backlog(d, [
    { id: 'TSK-001', type: 'task', parent: 'TSK-002', title: 'A', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'TSK-001', title: 'B', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-003', type: 'task', parent: 'TSK-003', title: 'Self', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'D1', status: 'todo', depends_on: ['TSK-005'], created: TS, updated: TS },
    { id: 'TSK-005', type: 'task', parent: 'EPIC-001', title: 'D2', status: 'todo', depends_on: ['TSK-006'], created: TS, updated: TS },
    { id: 'TSK-006', type: 'task', parent: 'EPIC-001', title: 'D3', status: 'todo', depends_on: ['TSK-004'], created: TS, updated: TS },
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
  ]);
  c.both('cycles-tree', ['tree'], { cwd: d });
  c.both('cycles-list', ['list'], { cwd: d });
  c.both('cycles-doctor', ['doctor'], { cwd: d });
  c.both('cycles-ready', ['list', '--ready'], { cwd: d });
});

S('duplicate-ids', (c) => {
  const d = c.dir('dup');
  const b = c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-005', type: 'task', parent: 'EPIC-001', title: 'First', status: 'todo', created: TS, updated: TS },
  ]);
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-005-copy.md'),
    el({ id: 'TSK-005', type: 'task', parent: 'EPIC-001', title: 'Second', status: 'todo', created: TS, updated: TS }));
  R.pinMtimes(b);
  c.both('dup-show', ['show', '--id=TSK-005'], { cwd: d });
  c.both('dup-list', ['list'], { cwd: d });
  c.both('dup-doctor', ['doctor'], { cwd: d });
  c.both('duplicate_id-write', ['set', '--id=TSK-005', '--status=doing'], { cwd: d });
  c.both('dup-file-escape', ['set', `--file=${path.join(b, 'tasks', 'TSK-005-copy.md')}`, '--status=doing'], { cwd: d });
  c.both('dup-file-relative', ['show', '--file=tasks/TSK-005.md'], { cwd: d });
});

S('duplicate-ids-fix-mtimes', (c) => {
  // Decision 59: the mtime snapshot is keyed by path, so two files carrying the
  // same id keep their own `created`.
  const d = c.dir('dupfix');
  const b = c.backlog(d, [], { tombstones: false });
  const bare = (id: string, title: string) => `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nupdated: ${TS}\n---\n\n# ${title}\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`;
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-005.md'), bare('TSK-005', 'One'));
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-005-copy.md'), bare('TSK-005', 'Two'));
  R.pinMtimes(b);
  const older = new Date('2019-06-07T08:09:10Z');
  fs.utimesSync(path.join(b, 'tasks', 'TSK-005-copy.md'), older, older);
  c.both('dupfix-doctor', ['doctor'], { cwd: d });
  c.both('dupfix-fix', ['doctor', '--fix'], { cwd: d });
});

S('stubs', (c) => {
  const d = c.dir('stubs');
  const b = c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: TS, updated: TS },
  ]);
  // A dangling symlink is an unreadable stub that needs no chmod, so it works
  // as root too (where chmod 000 would not deny the owner).
  fs.symlinkSync(path.join(b, 'does-not-exist.md'), path.join(b, 'subtasks', 'SUB-001.md'));
  R.pinMtimes(b);
  c.both('stub-list', ['list'], { cwd: d });
  c.both('stub-tree', ['tree'], { cwd: d });
  c.both('stub-show', ['show', '--id=SUB-001'], { cwd: d });
  c.both('stub-doctor', ['doctor'], { cwd: d });
  c.both('stub-rm', ['rm', '--id=TSK-001'], { cwd: d });
  c.both('stub-rm-cascade', ['rm', '--id=EPIC-001', '--cascade'], { cwd: d });
  c.both('stub-archive', ['archive', '--id=EPIC-001'], { cwd: d });
  c.both('stub-new-parent', ['new', '--type=subtask', '--parent=SUB-001', '--title=x'], { cwd: d });
  c.both('stub-set', ['set', '--id=SUB-001', '--status=doing'], { cwd: d });
  c.both('stub-file-dangling', ['show', `--file=${path.join(b, 'subtasks', 'SUB-001.md')}`], { cwd: d });
  c.both('stub-fix', ['doctor', '--fix'], { cwd: d });
});

S('rm-and-dependents', (c) => {
  const d = c.dir('rm');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
    { id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'S', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Dependent', status: 'todo', depends_on: ['TSK-001'], created: TS, updated: TS },
    { id: 'TSK-003', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'ArchivedDependent', status: 'done', depends_on: ['TSK-001'], created: TS, updated: TS, archived: TS },
  ]);
  c.both('refused-has_children', ['rm', '--id=TSK-001'], { cwd: d });
  c.both('rm-cascade-dependents', ['rm', '--id=TSK-001', '--cascade'], { cwd: d });
  c.both('rm-after', ['doctor'], { cwd: d });
});

S('archive', (c) => {
  const d = c.dir('archive');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
  ]);
  c.both('refused-not_done', ['archive', '--id=EPIC-001'], { cwd: d });

  const d2 = c.dir('archive-ok');
  const b2 = c.backlog(d2, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: TS, updated: TS },
  ]);
  fs.writeFileSync(path.join(b2, 'archive', 'TSK-001.md'),
    el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Collision', status: 'done', created: TS, updated: TS, archived: TS }));
  R.pinMtimes(b2);
  c.both('exists-collision', ['archive', '--id=EPIC-001'], { cwd: d2 });
  fs.rmSync(path.join(b2, 'archive', 'TSK-001.md'));
  c.both('archive-ok', ['archive', '--id=EPIC-001'], { cwd: d2 });
  c.both('archive-list-hidden', ['list'], { cwd: d2 });
  c.both('archive-list-all', ['list', '--all'], { cwd: d2 });
  c.both('refused-archived-set', ['set', '--id=TSK-001', '--status=doing'], { cwd: d2 });
  c.both('refused-archived-rm', ['rm', '--id=TSK-001'], { cwd: d2 });
  c.both('refused-archived-note', ['note', '--id=TSK-001', 'x'], { cwd: d2 });
  c.both('refused-parent_archived', ['new', '--type=task', '--parent=EPIC-001', '--title=x'], { cwd: d2 });

  const d3 = c.dir('archive-split');
  c.backlog(d3, [
    { id: 'EPIC-001', type: 'epic', folder: 'archive', title: 'E', status: 'done', created: TS, updated: TS, archived: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Live child', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'NotDone', status: 'todo', created: TS, updated: TS, archived: TS },
  ]);
  c.both('archive-split-doctor', ['doctor'], { cwd: d3 });
});

S('doctor-fix-combinations', (c) => {
  const d = c.dir('fixcombo');
  const b = c.backlog(d, [], { tombstones: false });
  // Rename + move + missing created, all in one run.
  fs.writeFileSync(path.join(b, 'epics', 'wrongname.md'),
    `---\nid: TSK-007\ntitle: Renamed and moved\nstatus: todo\nupdated: ${TS}\n---\n\n# Renamed and moved\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`);
  // Empty known field vs empty unknown key (decision 60 / § 14).
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-008.md'),
    `---\nid: TSK-008\ntype: task\nparent: EPIC-001\ntitle: Empty values\nstatus:\ncustom:\nupdated: ${TS}\n---\n\n# Empty values\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`);
  // One unparsable line must produce exactly one NOTE and no rewrite.
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-009.md'),
    `---\nid: TSK-009\ntype: task\nthis line cannot parse\ntitle: Broken\nstatus: todo\ncreated: ${TS}\nupdated: ${TS}\n---\n\n# Broken\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`);
  // H1 drift.
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-010.md'),
    `---\nid: TSK-010\ntype: task\nparent: EPIC-001\ntitle: Real Title\nstatus: todo\ncreated: ${TS}\nupdated: ${TS}\n---\n\n# Drifted H1\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`);
  // Unknown status is a warning, not an error (AC-19).
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-011.md'),
    el({ id: 'TSK-011', type: 'task', parent: 'EPIC-001', title: 'Odd status', status: 'blocked-on-review', created: TS, updated: TS }));
  fs.writeFileSync(path.join(b, 'epics', 'EPIC-001.md'),
    el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }));
  fs.writeFileSync(path.join(b, '.nj-tmp-4242-deadbeef'), 'stray\n');
  R.pinMtimes(b);
  c.both('fixcombo-doctor', ['doctor'], { cwd: d });
  c.both('fixcombo-fix', ['doctor', '--fix'], { cwd: d });
  c.both('fixcombo-doctor-after', ['doctor'], { cwd: d });
  c.both('fixcombo-fix-idempotent', ['doctor', '--fix'], { cwd: d });
});

S('ids-missing', (c) => {
  const d = c.dir('idsmissing');
  const b = c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: TS, updated: TS },
  ]);
  fs.rmSync(path.join(b, '.nanojira', 'ids'), { recursive: true, force: true });
  R.pinMtimes(b);
  c.both('ids_missing-doctor', ['doctor'], { cwd: d });
  c.both('ids_missing-fix', ['doctor', '--fix'], { cwd: d });
  c.both('ids_missing-new-after', ['new', '--type=task', '--parent=EPIC-001', '--title=After'], { cwd: d });
});

S('faults', (c) => {
  const mk = (name: string) => {
    const d = c.dir(name);
    c.backlog(d, [
      { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
      { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: TS, updated: TS },
    ]);
    return d;
  };
  for (const hook of ['after-tmp-write', 'before-rename']) {
    const d = mk('fault-' + hook);
    c.both('fault-set-' + hook, ['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NJ_FAULT: hook } });
    c.both('fault-note-' + hook, ['note', '--id=TSK-001', 'x'], { cwd: d, env: { NJ_FAULT: hook } });
    c.both('fault-archive-' + hook, ['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_FAULT: hook } });
    c.both('fault-cleanup-' + hook, ['doctor', '--fix'], { cwd: d });
  }
  // before-compare: the marker exists up front, so the guard passes straight
  // through instead of waiting out its ten seconds.
  for (const verb of [['set', '--id=TSK-001', '--status=doing'], ['note', '--id=TSK-001', 'x'], ['archive', '--id=EPIC-001']]) {
    const d = mk('fault-bc-' + verb[0]);
    fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    c.both('fault-bc-' + verb[0], verb, { cwd: d, env: { NJ_FAULT: 'before-compare' } });
  }
});

S('changed-in-parallel', (c) => {
  const d = c.dir('parallel');
  const b = c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: TS, updated: TS },
  ]);
  // before-compare with the marker already present and the file changed under
  // us: the re-read sees different bytes and refuses. The hint differs per
  // caller (decision 67) — archive must not point at --force.
  const bump = (msg: string) => fs.appendFileSync(path.join(b, 'tasks', 'TSK-001.md'), msg);
  fs.writeFileSync(path.join(b, '.nj-fault-go'), '');
  bump('');
  c.both('cip-set', ['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  c.both('cip-force', ['set', '--id=TSK-001', '--status=doing', '--force'], { cwd: d });
});

S('encoding', (c) => {
  const d = c.dir('encoding');
  const b = c.backlog(d, [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }]);
  // BOM + CRLF must round-trip to LF without BOM (§ 7).
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-001.md'),
    BOM + `---\r\nid: TSK-001\r\ntype: task\r\nparent: EPIC-001\r\ntitle: CRLF und BOM\r\nstatus: todo\r\ncreated: ${TS}\r\nupdated: ${TS}\r\n---\r\n\r\n# CRLF und BOM\r\n\r\n## Description\r\nd\r\n\r\n## Acceptance Criteria\r\n- [ ] a\r\n`);
  // Non-ASCII, including an NFD title and a multi-part emoji (§ 2, AC-16).
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-002.md'),
    el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Äpfel 日本語 👩‍💻', status: 'todo', created: TS, updated: TS, desc: 'Grüße 世界' }));
  R.pinMtimes(b);
  c.both('encoding-show-crlf', ['show', '--id=TSK-001'], { cwd: d });
  c.both('encoding-show-nfd', ['show', '--id=TSK-002'], { cwd: d });
  c.both('encoding-roundtrip', ['set', '--id=TSK-001', '--priority=high'], { cwd: d });
  c.both('encoding-note-nonascii', ['note', '--id=TSK-002', 'Notiz mit Ümläuten 日本語'], { cwd: d });
  c.both('encoding-list', ['list'], { cwd: d });
});

S('sorting', (c) => {
  const d = c.dir('sorting');
  const elements: ElementSpec[] = [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }];
  const prios = ['urgent', 'high', 'normal', 'low', 'bogus', undefined];
  prios.forEach((p, i) => {
    elements.push({
      id: `TSK-${String(900 + i * 7)}`, type: 'task', parent: 'EPIC-001',
      title: `P ${p || 'none'}`, status: 'todo', priority: p, created: TS, updated: TS,
    });
  });
  // IDs at and past 1000 exercise the numeric sort key, not string order.
  elements.push({ id: 'TSK-1000', type: 'task', parent: 'EPIC-001', title: 'Thousand', status: 'todo', created: TS, updated: TS });
  elements.push({ id: 'TSK-1001', type: 'task', parent: 'EPIC-001', title: 'ThousandOne', status: 'todo', priority: 'urgent', created: TS, updated: TS });
  c.backlog(d, elements);
  c.both('sort-list', ['list'], { cwd: d });
  c.both('sort-tree', ['tree'], { cwd: d });
  c.both('sort-status', [], { cwd: d });
  c.both('sort-doctor', ['doctor'], { cwd: d });
  c.both('filter-tag', ['list', '--tag=none'], { cwd: d });
  c.both('filter-assignee', ['list', '--assignee=nobody'], { cwd: d });
  c.both('filter-type', ['list', '--type=task'], { cwd: d });
  c.both('filter-parent', ['list', '--parent=EPIC-001'], { cwd: d });
});

S('ready-and-incomplete', (c) => {
  const d = c.dir('ready');
  const b = c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Ready', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Waiting', status: 'todo', depends_on: ['TSK-001'], created: TS, updated: TS },
    { id: 'TSK-003', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'ArchivedDep', status: 'done', created: TS, updated: TS, archived: TS },
    { id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'RefsArchived', status: 'todo', depends_on: ['TSK-003'], created: TS, updated: TS },
  ]);
  // Empty acceptance section: a heading with nothing under it stays incomplete.
  fs.writeFileSync(path.join(b, 'tasks', 'TSK-005.md'),
    `---\nid: TSK-005\ntype: task\nparent: EPIC-001\ntitle: Empty sections\nstatus: todo\ncreated: ${TS}\nupdated: ${TS}\n---\n\n# Empty sections\n\n## Description\nd\n\n## Acceptance Criteria\n   \n`);
  R.pinMtimes(b);
  c.both('ready', ['list', '--ready'], { cwd: d });
  c.both('ready-all', ['list', '--ready', '--all'], { cwd: d });
  c.both('incomplete-show', ['show', '--id=TSK-005'], { cwd: d });
  c.both('incomplete-doctor', ['doctor'], { cwd: d });
});

S('sections', (c) => {
  const d = c.dir('sections');
  c.backlog(d, [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }]);
  const f = path.join(d, 'desc.txt');
  fs.writeFileSync(f, 'from a file\r\nwith CRLF\r\n\r\n\r\n');
  c.both('sec-new-inline', ['new', '--type=task', '--parent=EPIC-001', '--title=Sec', '--description=inline text', '--acceptance=- [ ] one'], { cwd: d });
  c.both('sec-set-file', ['set', '--id=TSK-001', `--description-file=${f}`], { cwd: d });
  c.nj('sec-set-stdin', ['set', '--id=TSK-001', '--acceptance-file=-'], { cwd: d, input: 'from stdin\n' });
  c.both('sec-empty', ['set', '--id=TSK-001', '--description='], { cwd: d });
  c.both('sec-refill', ['set', '--id=TSK-001', '--description=refilled'], { cwd: d });
  c.both('sec-mutual-exclusion', ['set', '--id=TSK-001', '--description=a', `--description-file=${f}`], { cwd: d });
  c.both('sec-both-stdin', ['set', '--id=TSK-001', '--description-file=-', '--acceptance-file=-'], { cwd: d });
  c.both('sec-missing-file', ['set', '--id=TSK-001', '--description-file=/nope/missing.txt'], { cwd: d });
  c.both('sec-epic-acceptance', ['set', '--id=EPIC-001', '--acceptance=- [ ] on an epic'], { cwd: d });
  c.both('sec-note-untouched', ['note', '--id=TSK-001', 'a note that must survive'], { cwd: d });
  c.both('sec-after-note', ['set', '--id=TSK-001', '--description=rewritten after the note'], { cwd: d });
});

S('attach-second-derive', (c) => {
  // The SECOND deriveGraph call. `cmdNew`, `cmdSet`, `cmdNote` and `cmdArchive`
  // each re-run it on a derived array after the write, and it mutates the
  // element objects in place. Nothing reads the attached `byId`/`children`
  // afterwards — what the second call really delivers is the `problems` set on
  // the freshly reloaded element, and that IS observable: it drives the ⚠ lines
  // of the prose feedback and `_problems` in the JSON result.
  //
  // Two failure forms land here, both measured by mutant in a97de5f:
  //   - a pass computes but does not write back into the element
  //     (markOpenChildren): oracle 53/56 red, replay red -- both nets catch it,
  //     this scenario only adds depth;
  //   - the second deriveGraph call works on copies instead of the real
  //     objects: oracle 56/56 GREEN, replay red over 40+ calls including this
  //     scenario -- the form only the corpus sees.
  // Before this scenario the path was covered only indirectly.
  //
  // A third form, "attaches before the marks have run", is NOT a failure today,
  // and this scenario demonstrably does not catch it. Mutant on nj 5f25efc4
  // with childMap + attachGraph moved ahead of all mark passes: this scenario
  // 0/94 calls differ, full fixture corpus 0/1878, oracle 62/62 (2418 checks).
  // Control mutant (the copies form above) on the same rig: 88/94 differ.
  // It is excluded by a CONDITION, not a fact: the DECISIONS 77 rule (no pass
  // reads another pass's `problems`) plus two more -- the mark passes write no
  // element field other than `problems`, and none reads `el.byId`/`el.children`
  // (childMap reads only `e.parent`, which no pass writes). Break any of these
  // and the attach position becomes load-bearing, and this scenario will not
  // tell you.
  const d = c.dir('attach');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Parent', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Open child', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Dangling dep', status: 'todo', depends_on: ['TSK-404'], created: TS, updated: TS },
    { id: 'TSK-003', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'Archived', status: 'done', created: TS, updated: TS, archived: TS },
    { id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'Refs archived', status: 'todo', depends_on: ['TSK-003'], created: TS, updated: TS },
  ]);

  // The write SUCCEEDS, so the ⚠ line below can only come from the second
  // deriveGraph having marked the reloaded element.
  c.both('attach-set-done-open-children', ['set', '--id=EPIC-001', '--status=done', '--allow-open-children'], { cwd: d });
  // Same path through `note`, which reports the element's problems too.
  c.both('attach-note-dangling', ['note', '--id=TSK-002', 'note on a dangling dependent'], { cwd: d });
  // …and through `new`, whose result carries the problems of the fresh element.
  c.both('attach-new-refs-archived', ['new', '--type=task', '--parent=EPIC-001', '--title=New refs archived', '--depends-on=TSK-003'], { cwd: d });
  // `archive` emits the union over everything it moved (decision 62).
  c.both('attach-archive-union', ['archive', '--id=TSK-002'], { cwd: d });

  // The two readers of the attached fields, on the FIRST graph:
  // `el.byId` in isReady(), and `el.children` in the children_open check.
  c.both('attach-ready-byid', ['list', '--ready'], { cwd: d });
  c.both('attach-status-byid', [], { cwd: d });
  c.both('attach-children-refusal', ['set', '--id=EPIC-001', '--status=done'], { cwd: d });
});

S('dup-across-archive', (c) => {
  // The third failure form: `byId.set` without its `has` guard, i.e. last-wins
  // instead of first-wins. Exactly the slip a pass rewrite makes, and today it
  // passes BOTH nets — the oracle stays green, and no byte probe reacts.
  //
  // It only becomes observable when the duplicated id exists twice with
  // DIFFERENT archived-ness and something resolves through it:
  //   TSK-001 lives in tasks/ (todo) and in archive/ (done)
  //   SUB-001 hangs under TSK-001      -> the archive:split side
  //   TSK-002 depends_on TSK-001       -> the active_refs_archived side
  // first-wins resolves both to the ACTIVE twin, so neither code appears.
  // last-wins resolves to the archived one and invents both.
  //
  // Which of two duplicates counts as a parent or dependency target is nj's
  // reading, not the spec's — § 9 only says reads show both entries. The
  // corpus may hold that; the oracle may not.
  const d = c.dir('dup-archive');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Active twin', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-001', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'Archived twin', status: 'done', created: TS, updated: TS, archived: TS },
    { id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Child of the duplicate', status: 'todo', created: TS, updated: TS },
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Dependent on the duplicate', status: 'todo', depends_on: ['TSK-001'], created: TS, updated: TS },
  ]);
  // The two carriers. Under first-wins both are clean; last-wins puts
  // archive:split on the child and active_refs_archived on the dependent.
  c.both('dupacr-child', ['show', '--id=SUB-001'], { cwd: d });
  c.both('dupacr-dependent', ['show', '--id=TSK-002'], { cwd: d });
  // doctor counts the findings, so the error total moves too (2 vs 3).
  c.both('dupacr-doctor', ['doctor'], { cwd: d });
  c.both('dupacr-list', ['list', '--all'], { cwd: d });
  c.both('dupacr-tree', ['tree', '--all'], { cwd: d });
  // `--ready` resolves depends_on through byId, so it reads the same map.
  c.both('dupacr-ready', ['list', '--ready'], { cwd: d });
  // show --id on the duplicate itself must still surface BOTH entries (§ 9).
  c.both('dupacr-show-both', ['show', '--id=TSK-001'], { cwd: d });
});

S('dup-across-archive-epic', (c) => {
  // Zweite Form derselben Fehlerklasse, unabhaengig vom Verifier gebaut
  // (seine Sonde: scoping/pending/probe-lastwins.js). Sie trifft den
  // first-wins-Mechanismus von einer anderen Seite:
  //
  //   dup-across-archive        das KIND haengt an einer duplizierten TASK,
  //                             dazu ein depends_on auf dieselbe ID
  //   dup-across-archive-epic   das duplizierte Element ist der ELTERNTEIL,
  //                             und darunter haengt eine gewoehnliche Task
  //
  // Zwei Formen aus zwei Koepfen treffen den Mechanismus aus zwei Richtungen.
  // Haengt eine von ihnen an einer Eigenheit ihrer eigenen Konstruktion, faellt
  // das nur auf, wenn eine zweite danebensteht.
  const d = c.dir('dup-archive-epic');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Active twin', status: 'todo', created: TS, updated: TS },
    { id: 'EPIC-001', type: 'epic', folder: 'archive', title: 'Archived twin', status: 'done', created: TS, updated: TS, archived: TS },
    { id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Child', status: 'todo', created: TS, updated: TS },
  ]);
  // first-wins loest auf den AKTIVEN Zwilling auf -> das Kind bleibt sauber.
  // last-wins loest auf den archivierten -> archive:split auf TSK-001.
  c.both('dupepic-child', ['show', '--id=TSK-001'], { cwd: d });
  c.both('dupepic-list-all', ['list', '--all'], { cwd: d });
  c.both('dupepic-doctor', ['doctor'], { cwd: d });
  c.both('dupepic-tree-all', ['tree', '--all'], { cwd: d });
  c.both('dupepic-show-both', ['show', '--id=EPIC-001'], { cwd: d });
});

S('archived-child-not-done', (c) => {
  // Decision 23: archivierte Kinder zaehlen als done. Kein Orakel-Fixture hat
  // ein archiviertes Kind -- die Regel haengt damit allein am Korpus.
  //
  // Dass das Orakel sie nicht deckt, ist nicht dasselbe wie "kein Test fuehrt
  // den Aufruf aus": ac-11 fuehrt ihn aus und bleibt gruen, weil es nur die
  // beiden ERROR-Findings assertiert und die zusaetzliche WARNING samt der
  // Summenzeile nicht ansieht. Deckung der EINGABE ist keine Deckung des
  // VERHALTENS.
  //
  // Beide Kopien des Praedikats (markOpenChildren und die children_open-Pruefung
  // in cmdSet) tragen dieselbe Ausnahme. Wer sie zusammenfuehrt, ohne dass das
  // hier haengt, fuehrt zwei Praedikate zusammen, deren Uebereinstimmung nichts
  // prueft.
  const d = c.dir('archived-child');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Done parent', status: 'done', created: TS, updated: TS },
    // archiviert UND nicht done: zaehlt trotzdem als done fuers Elternteil
    { id: 'TSK-001', type: 'task', folder: 'archive', parent: 'EPIC-001', title: 'Archived, not done', status: 'todo', created: TS, updated: TS, archived: TS },
    // aktives, fertiges Geschwister -- damit die Liste nicht leer ist
    { id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Active and done', status: 'done', created: TS, updated: TS },
  ]);
  // Ohne die Ausnahme traegt EPIC-001 done:open_children -- sichtbar als
  // zusaetzliche WARNING und in der Summenzeile von doctor.
  c.both('archkid-doctor', ['doctor'], { cwd: d });
  c.both('archkid-show-parent', ['show', '--id=EPIC-001'], { cwd: d });
  c.both('archkid-list-all', ['list', '--all'], { cwd: d });
  c.both('archkid-tree-all', ['tree', '--all'], { cwd: d });
  // Die zweite Kopie des Praedikats: die children_open-Pruefung in `set`.
  // Ohne die Ausnahme wuerde dieser Aufruf verweigert statt durchzugehen.
  c.both('archkid-set-done-again', ['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  c.both('archkid-set-doing', ['set', '--id=EPIC-001', '--status=doing'], { cwd: d });
});

S('id-derived', (c) => {
  // Ableiter 1 der S3-Karte: `id` fehlt, also gewinnt der Dateiname. Bisher
  // trugen VIER aufgezeichnete Aufrufe diesen Code -- zu duenn fuer eine
  // Stelle, an der S3 schneidet.
  //
  // Zwei Dinge haengen hier, und beide brechen STILL, nicht mit einem Absturz:
  //
  // 1. Die Kette `id -> type`. Der Typ kommt aus dem PRAEFIX der id, und die
  //    id kann aus dem Dateinamen stammen. Ein Schnitt, der deriveType vor
  //    deriveId zieht, liest ein `undefined`, findet kein Praefix und faellt
  //    weiter -- ohne Fehler, mit anderem Ergebnis. `EPIC-900.md` unter
  //    `tasks/` macht den Unterschied sichtbar: ueber das Praefix wird es ein
  //    `epic` (und traegt deshalb type:derived und type:folder), ohne Praefix
  //    bliebe der Typ `null` und type:derived verschwaende.
  // 2. Der `p.parsed`-Waechter. Ohne lesbares Frontmatter wird die id genauso
  //    aus dem Dateinamen abgeleitet, aber id:derived wird NICHT gemeldet.
  //    Wer die Ableitung und ihre Meldung trennt, verliert genau diese
  //    Unterscheidung -- und beide Faelle liefern dieselbe id.
  const d = c.dir('id-derived');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Parent', status: 'todo', created: TS, updated: TS },
    // Reiner Fall: Frontmatter lesbar, `id` fehlt, `type` steht da.
    {
      id: 'TSK-900', folder: 'tasks', file: 'TSK-900',
      raw: ['---', 'type: task', 'parent: EPIC-001', 'title: Ohne id-Feld', 'status: todo',
            'created: ' + TS, 'updated: ' + TS, '---', '', '# Ohne id-Feld', '',
            '## Description', 'd', '', '## Acceptance Criteria', '- [ ] a', ''].join('\n'),
    },
    // Der Unterscheider fuer die Reihenfolge: weder `id` noch `type`. Die id
    // kommt aus dem Dateinamen, der Typ aus ihrem Praefix -- und der Praefix
    // widerspricht dem Ordner, was den Unterschied beobachtbar macht.
    {
      id: 'EPIC-900', folder: 'tasks', file: 'EPIC-900',
      raw: ['---', 'title: Praefix gegen Ordner', 'status: todo',
            'created: ' + TS, 'updated: ' + TS, '---', '', '# Praefix gegen Ordner', '',
            '## Description', 'd', ''].join('\n'),
    },
    // Ableitung ohne Meldung: kein Frontmatter, also greift der p.parsed-Waechter.
    {
      id: 'TSK-901', folder: 'tasks', file: 'TSK-901',
      raw: ['# Kein Frontmatter', '', 'Nur Prosa, kein Trennstrich.', ''].join('\n'),
    },
  ]);
  c.both('idder-doctor', ['doctor'], { cwd: d });
  c.both('idder-list-all', ['list', '--all'], { cwd: d });
  c.both('idder-tree-all', ['tree', '--all'], { cwd: d });
  // Einzeln gezeigt, damit der Vergleich die Codes pro Element trennt und
  // nicht nur die Summenzeile von doctor.
  c.both('idder-show-plain', ['show', '--id=TSK-900'], { cwd: d });
  c.both('idder-show-prefix-vs-folder', ['show', '--id=EPIC-900'], { cwd: d });
  c.both('idder-show-unparsed', ['show', '--id=TSK-901'], { cwd: d });
});

S('type-folder', (c) => {
  // Ableiter 2 der S3-Karte. Ebenfalls vier aufgezeichnete Aufrufe bisher.
  //
  // `type:folder` entsteht auf ZWEI verschiedenen Wegen, die der Code in einer
  // Zeile zusammenzieht: der Typ ist gar nicht bestimmbar (`null`), oder er ist
  // bestimmt und passt nicht zum Ordner. Beide werden hier einzeln gezeigt.
  //
  // Dazu ein Befund beim Lesen, der in S3 gefaehrlich wird: der Ordner-Zweig
  // der Typableitung ist UNERREICHBAR. `TYPE_DIR` ist nach Typ verschluesselt
  // (`epic -> epics`), abgefragt wird es aber mit dem Ordner (`TYPE_DIR['tasks']`)
  // und ist deshalb immer `undefined`; der Zweig darunter sucht im Archiv nach
  // einem Typ, dessen Ordner `archive` heisst, und findet keinen. `type:derived`
  // kommt daher ausschliesslich aus dem Praefix, nie aus dem Ordner. Diese
  // Fixture haelt das fest: faende ein Aufraeumen in S3 den vermeintlich
  // gemeinten Weg, wuerden `lose-notiz` und `lose-archiv-notiz` einen Typ
  // bekommen, statt `null` zu bleiben -- und das Orakel saehe es nicht.
  const d = c.dir('type-folder');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Parent', status: 'todo', created: TS, updated: TS },
    // (a) Typ gueltig, aber im falschen Ordner: der zweite Weg.
    {
      id: 'TSK-800', folder: 'tasks', file: 'TSK-800',
      raw: ['---', 'id: TSK-800', 'type: epic', 'title: Epic im tasks-Ordner', 'status: todo',
            'created: ' + TS, 'updated: ' + TS, '---', '', '# Epic im tasks-Ordner', '',
            '## Description', 'd', ''].join('\n'),
    },
    // (b) Typ nicht bestimmbar: kein type-Feld, kein Praefix im Namen.
    {
      id: 'lose-notiz', folder: 'tasks', file: 'lose-notiz',
      raw: ['---', 'id: lose-notiz', 'title: Weder Feld noch Praefix', 'status: todo',
            'created: ' + TS, 'updated: ' + TS, '---', '', '# Weder Feld noch Praefix', '',
            '## Description', 'd', ''].join('\n'),
    },
    // (c) Dasselbe im Archiv -- der Zweig, dessen Suche nie faendig wird.
    {
      id: 'lose-archiv-notiz', folder: 'archive', file: 'lose-archiv-notiz',
      raw: ['---', 'id: lose-archiv-notiz', 'title: Im Archiv ohne Typ', 'status: done',
            'created: ' + TS, 'updated: ' + TS, 'archived: ' + TS, '---', '',
            '# Im Archiv ohne Typ', '', '## Description', 'd', ''].join('\n'),
    },
    // (d) Gegenprobe: archiviert und im falschen Ordner, aber MIT Typ. Die
    //     Ordnerpruefung ist fuer Archiviertes ausgenommen, also kein Code.
    {
      id: 'TSK-801', folder: 'archive', file: 'TSK-801',
      raw: ['---', 'id: TSK-801', 'type: task', 'parent: EPIC-001', 'title: Archiviert mit Typ',
            'status: done', 'created: ' + TS, 'updated: ' + TS, 'archived: ' + TS, '---', '',
            '# Archiviert mit Typ', '', '## Description', 'd', '',
            '## Acceptance Criteria', '- [ ] a', ''].join('\n'),
    },
  ]);
  c.both('typefold-doctor', ['doctor'], { cwd: d });
  c.both('typefold-list-all', ['list', '--all'], { cwd: d });
  c.both('typefold-tree-all', ['tree', '--all'], { cwd: d });
  c.both('typefold-show-wrong-folder', ['show', '--id=TSK-800'], { cwd: d });
  c.both('typefold-show-null-type', ['show', '--id=lose-notiz'], { cwd: d });
  c.both('typefold-show-null-type-archived', ['show', '--id=lose-archiv-notiz'], { cwd: d });
  c.both('typefold-show-exempt', ['show', '--id=TSK-801'], { cwd: d });
});

S('double-heading', (c) => {
  // TSK-016: zwei Ueberschriften derselben Rolle, die ERSTE leer, die ZWEITE
  // mit Inhalt. Bisher die einzige gefundene Luecke, die BEIDE Netze zugleich
  // hat -- das Orakel sieht sie nicht, weil Paragraf 7 den Fall nicht
  // entscheidet, und der Replay sah sie nicht, weil kein aufgezeichneter
  // Aufruf sie ausloeste.
  //
  // Gemessen, nicht abgeleitet: die beiden Seiten von nj sind sich UNEINIG,
  // welche Ueberschrift zaehlt.
  //   Vollstaendigkeitspruefung: laeuft ueber ALLE Ueberschriften der Rolle
  //     und ist zufrieden, sobald IRGENDEINE Inhalt traegt -- das Element
  //     gilt als vollstaendig, obwohl die erste leer ist.
  //   Schreibweg: nimmt die ERSTE und laesst die zweite stehen -- nach einem
  //     `set --description` hat die Datei zwei gefuellte Abschnitte.
  // Diese Fixture entscheidet nichts davon; sie haelt fest, was heute
  // geschieht, damit ein Schnitt es nicht unbemerkt umdreht. Die Lesart
  // gehoert nach AMBIGUITIES.md, nicht hierher.
  const d = c.dir('double-heading');
  c.backlog(d, [
    { id: 'EPIC-001', type: 'epic', title: 'Parent', status: 'todo', created: TS, updated: TS },
    // Erste leer, zweite gefuellt -- in beiden Rollen.
    {
      id: 'TSK-001', folder: 'tasks', file: 'TSK-001',
      raw: ['---', 'id: TSK-001', 'type: task', 'parent: EPIC-001', 'title: Erste leer zweite voll',
            'status: todo', 'created: ' + TS, 'updated: ' + TS, '---', '',
            '# Erste leer zweite voll', '',
            '## Description', '',
            '## Description', 'Der Inhalt steht in der zweiten.', '',
            '## Acceptance Criteria', '',
            '## Acceptance Criteria', '- [ ] auch hier die zweite', ''].join('\n'),
    },
    // Gegenprobe: dieselbe Verdopplung, aber die erste traegt den Inhalt.
    // Beide Elemente gelten als vollstaendig -- der Unterschied liegt allein
    // darin, WO der Schreibweg landet.
    {
      id: 'TSK-002', folder: 'tasks', file: 'TSK-002',
      raw: ['---', 'id: TSK-002', 'type: task', 'parent: EPIC-001', 'title: Erste voll zweite leer',
            'status: todo', 'created: ' + TS, 'updated: ' + TS, '---', '',
            '# Erste voll zweite leer', '',
            '## Description', 'Der Inhalt steht in der ersten.', '',
            '## Description', '',
            '## Acceptance Criteria', '- [ ] erste traegt', '',
            '## Acceptance Criteria', ''].join('\n'),
    },
  ]);
  // Erst der Lesebefund -- und der Zeuge dafuer ist NICHT `doctor`.
  // `incomplete:description` hat in der Severity-Tabelle den Wert `null`, faellt
  // also aus dem doctor-Bericht heraus; sichtbar wird es allein als Warnzeile in
  // der Rueckmeldung NACH einem Schreibvorgang. Ein `set --status` ruehrt keinen
  // Abschnitt an und zwingt die Vollstaendigkeitspruefung trotzdem, sich zu
  // aeussern: bleibt die Zeile aus, gilt "erste leer, zweite voll" als
  // vollstaendig. Genau das ist die offene Lesart aus TSK-016.
  c.both('dblhead-doctor', ['doctor'], { cwd: d });
  c.both('dblhead-show-empty-first', ['show', '--id=TSK-001'], { cwd: d });
  c.both('dblhead-show-full-first', ['show', '--id=TSK-002'], { cwd: d });
  c.both('dblhead-status-empty-first', ['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  // Dann der Schreibbefund: in WELCHE der beiden Ueberschriften wird
  // geschrieben? Die Probe nach der Mutation friert die Datei mit ein.
  c.both('dblhead-set-desc-empty-first', ['set', '--id=TSK-001', '--description=Neu geschrieben'], { cwd: d });
  c.both('dblhead-set-acc-empty-first', ['set', '--id=TSK-001', '--acceptance=- [ ] neu geschrieben'], { cwd: d });
  c.both('dblhead-show-after-write', ['show', '--id=TSK-001'], { cwd: d });
  // Und das Leeren: raeumt es die erste Ueberschrift, waehrend die zweite
  // das Element weiter als vollstaendig ausweist?
  c.both('dblhead-clear-desc-full-first', ['set', '--id=TSK-002', '--description='], { cwd: d });
  c.both('dblhead-show-after-clear', ['show', '--id=TSK-002'], { cwd: d });
  // Gegenprobe zum Zeugen oben: jetzt sind BEIDE Ueberschriften leer, also muss
  // die Warnzeile kommen. Ohne diesen Aufruf hielte die Fixture nur fest, dass
  // nichts gemeldet wird -- und das tut sie auch dann, wenn die Pruefung
  // versehentlich gar nichts mehr meldet.
  c.both('dblhead-status-after-clear', ['set', '--id=TSK-002', '--status=doing'], { cwd: d });
});
