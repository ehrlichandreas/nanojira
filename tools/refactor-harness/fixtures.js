'use strict';

// The explicit fixture corpus: every command, every reachable failure code,
// and the cases the oracle does not reach. The list follows section 3 of
// review-verifier.md ("Fixtures, die fehlen") plus the additions it names
// ("Zusätzlich einfrieren").
//
// Scratch lives at a FIXED path, not mkdtemp — determinism first; absolute
// paths in JSON `file` and in duplicate_id messages then normalise to a stable
// token. Every fixture gets utimes, because `doctor --fix` derives `created`
// from the mtime.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./lib/record.js');

const TS = R.FIXED_NOW;
// Built from its code point on purpose: a literal BOM in this source would be
// invisible and would look like an accident rather than the fixture it is (§ 7).
const BOM = String.fromCharCode(0xfeff);

function mkBacklogConfig() {
  return JSON.stringify({
    schema: 1,
    statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  }, null, 2) + '\n';
}

/** A complete element, so completeness rules do not mask the case under test. */
function el(f) {
  const lines = ['---'];
  for (const k of ['id', 'type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived']) {
    if (f[k] === undefined) continue;
    lines.push(`${k}: ${Array.isArray(f[k]) ? '[' + f[k].join(', ') + ']' : f[k]}`);
  }
  lines.push('---', '', `# ${f.title || f.id}`, '', '## Description', f.desc === undefined ? 'd' : f.desc, '');
  if (f.type !== 'epic') lines.push('## Acceptance Criteria', f.acc === undefined ? '- [ ] a' : f.acc, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

const MUTATORS = new Set(['init', 'new', 'set', 'note', 'rm', 'archive']);
function isMutation(args) {
  const verb = args.find((a) => !a.startsWith('--'));
  if (verb === 'doctor') return args.includes('--fix');
  return MUTATORS.has(verb);
}

class Ctx {
  constructor(root, shim, node, recordPath) {
    this.root = root; this.shim = shim; this.node = node; this.recordPath = recordPath;
    this.calls = 0;
    this.probing = false;
  }

  /** A fresh, fixed-path scratch directory for one scenario. */
  dir(name) {
    const d = path.join(this.root, name);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** A backlog laid out by hand — no nj call, so `nj init` stays testable too. */
  backlog(d, elements, opts) {
    const o = opts || {};
    const b = path.join(d, 'backlog');
    for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.ids']) {
      fs.mkdirSync(path.join(b, sub), { recursive: true });
    }
    if (o.config !== null) fs.writeFileSync(path.join(b, '.nanojira.json'), o.config || mkBacklogConfig());
    for (const e of elements || []) {
      const folder = e.folder || (e.type === 'epic' ? 'epics' : e.type === 'task' ? 'tasks' : 'subtasks');
      const name = (e.file || e.id) + '.md';
      fs.writeFileSync(path.join(b, folder, name), e.raw !== undefined ? e.raw : el(e));
      if (o.tombstones !== false) {
        try { fs.closeSync(fs.openSync(path.join(b, '.ids', e.id), 'wx')); } catch { /* duplicate id */ }
      }
    }
    R.pinMtimes(b);
    return b;
  }

  nj(label, args, opts) {
    const o = opts || {};
    const env = Object.assign({}, process.env, {
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
  probe(label, o) {
    this.probing = true;
    try {
      for (const p of [[], ['list'], ['tree'], ['doctor']]) {
        this.nj(`${label}>probe:${p[0] || 'status'}:prose`, p, o);
        this.nj(`${label}>probe:${p[0] || 'status'}:json`, p.concat(['--json']), o);
      }
    } finally {
      this.probing = false;
    }
  }

  /** Prose and --json are different code paths (§ 9); freeze both. */
  both(label, args, opts) {
    this.nj(label + ':prose', args, opts);
    this.nj(label + ':json', args.concat(['--json']), opts);
  }
}

// ---------------------------------------------------------------- scenarios

const scenarios = [];
const S = (name, fn) => scenarios.push({ name, fn });

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
  const bare = (id, title) => `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nupdated: ${TS}\n---\n\n# ${title}\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n`;
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
  fs.rmSync(path.join(b, '.ids'), { recursive: true, force: true });
  R.pinMtimes(b);
  c.both('ids_missing-doctor', ['doctor'], { cwd: d });
  c.both('ids_missing-fix', ['doctor', '--fix'], { cwd: d });
  c.both('ids_missing-new-after', ['new', '--type=task', '--parent=EPIC-001', '--title=After'], { cwd: d });
});

S('faults', (c) => {
  const mk = (name) => {
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
  const bump = (msg) => fs.appendFileSync(path.join(b, 'tasks', 'TSK-001.md'), msg);
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
    el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Äpfel 日本語 👩‍💻', status: 'todo', created: TS, updated: TS, desc: 'Grüße 世界' }));
  R.pinMtimes(b);
  c.both('encoding-show-crlf', ['show', '--id=TSK-001'], { cwd: d });
  c.both('encoding-show-nfd', ['show', '--id=TSK-002'], { cwd: d });
  c.both('encoding-roundtrip', ['set', '--id=TSK-001', '--priority=high'], { cwd: d });
  c.both('encoding-note-nonascii', ['note', '--id=TSK-002', 'Notiz mit Ümläuten 日本語'], { cwd: d });
  c.both('encoding-list', ['list'], { cwd: d });
});

S('sorting', (c) => {
  const d = c.dir('sorting');
  const elements = [{ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: TS, updated: TS }];
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

module.exports = { scenarios, Ctx };
