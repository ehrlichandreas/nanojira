/* Edge — a boolean flag takes no value (§ 9 Rules, TSK-034 F3).
 *
 * "A flag that takes no value is given on its own; `--name=<anything>` is
 *  invalid_value and nothing is written." Every command tested only whether
 * the flag was present, so `rm --cascade=false` cascaded, `check --off=false`
 * unticked and `doctor --fix=no` fixed. `--dry-run` was the one boolean that
 * already refused a value.
 *
 * The oracle is the list below, written from the help text's own contract
 * (a flag shown without `=<value>` takes none), and cross-checked against
 * `--help` so a new boolean cannot slip past it.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const BOOLEANS: Record<string, string[]> = {
  init: ['json', 'dry-run'],
  new: ['json', 'quiet', 'dry-run'],
  set: ['json', 'force', 'allow-open-children', 'check-all', 'quiet', 'dry-run'],
  note: ['json', 'quiet', 'force', 'dry-run'],
  check: ['on', 'off', 'json', 'quiet', 'force', 'dry-run'],
  show: ['json'],
  log: ['json'],
  list: ['json', 'ready', 'all'],
  find: ['case-sensitive', 'json', 'all'],
  tree: ['json', 'all'],
  tags: ['json'],
  rm: ['cascade', 'json', 'dry-run'],
  archive: ['json', 'dry-run'],
  unarchive: ['json', 'dry-run'],
  claim: ['json', 'quiet', 'allow-open-children', 'check-all', 'dry-run'],
  release: ['json', 'quiet', 'allow-open-children', 'dry-run'],
  next: ['json', 'dry-run'],
  doctor: ['fix', 'json', 'dry-run'],
};

function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Has a child',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Has a child\n\n## Description\nD\n\n## Acceptance Criteria\n- [x] ticked\n'),
      'subtasks/SUB-002.md': H.element({
        id: 'SUB-002', type: 'subtask', parent: 'TSK-002', title: 'Child',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Child\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-002', 'SUB-002'],
  });
}

/** Every file under backlog/, path → sha256: "nothing written" for a whole tree. */
function snapshot(d: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(d, p)] = H.sha256(fs.readFileSync(p));
    }
  };
  walk(path.join(d, 'backlog'));
  return out;
}

/* ---- the three silent cases from the survey ---------------------------- */
const SILENT: Array<[string, string[]]> = [
  ['rm --cascade=false', ['rm', '--id=TSK-002', '--cascade=false']],
  ['check --off=false', ['check', '--id=TSK-002', '--item=1', '--off=false']],
  ['doctor --fix=no', ['doctor', '--fix=no']],
];
for (const [label, args] of SILENT) {
  const d = fixture(`edge-bool-${args[0]}`);
  // Something for doctor --fix to repair: a missing tombstone.
  fs.unlinkSync(path.join(d, 'backlog', H.IDS_REL, 'SUB-002'));
  const before = snapshot(d);
  const r = H.runJson(args, { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit(`${label} is refused`, r, 1);
  T.eq(`${label}: the code is invalid_value`, r.json && r.json.error, 'invalid_value');
  T.contains(`${label}: the message names the flag`, r.stdout + r.stderr, `--${args[args.length - 1].slice(2).split('=')[0]} takes no value`);
  T.eq(`${label}: nothing was written`, JSON.stringify(snapshot(d)), JSON.stringify(before));
}

/* ---- every boolean on every command ------------------------------------ */
{
  const d = fixture('edge-bool-every');
  const before = snapshot(d);
  for (const [cmd, names] of Object.entries(BOOLEANS)) {
    for (const name of names) {
      const args = [cmd, `--${name}=yes`];
      // `--json=yes` is itself the JSON switch; any other flag adds --json
      // to read the code.
      const r = name === 'json' ? H.runNj(args, { cwd: d }) : H.runJson(args, { cwd: d });
      let code: string | undefined;
      try { code = JSON.parse(r.stdout).error; } catch { code = undefined; }
      T.eq(`${cmd} --${name}=yes is invalid_value (exit ${r.status})`, code, 'invalid_value');
    }
  }
  const bare = H.runNj(['--json=yes'], { cwd: d });
  let code: string | undefined;
  try { code = JSON.parse(bare.stdout).error; } catch { code = undefined; }
  T.eq('bare nanojira --json=yes is invalid_value', code, 'invalid_value');
  for (const args of [['--version=yes'], ['--version', '--json=yes']]) {
    const v = H.runNj(args.concat(args[0] === '--version' ? [] : ['--json']), { cwd: d });
    T.exit(`nanojira ${args.join(' ')} is refused`, v, 1);
    T.contains(`nanojira ${args.join(' ')} names the flag`, v.stderr, 'takes no value');
  }
  T.eq('every refusal wrote nothing', JSON.stringify(snapshot(d)), JSON.stringify(before));

  // The bare flag still works.
  T.exit('rm --cascade (bare) still cascades', H.runNj(['rm', '--id=TSK-002', '--cascade'], { cwd: d }), 0);
  T.check('the subtree is gone', !fs.existsSync(path.join(d, 'backlog', 'subtasks', 'SUB-002.md')));
}

/* ---- the oracle matches --help ----------------------------------------- */
{
  const d = fixture('edge-bool-help');
  for (const [cmd, names] of Object.entries(BOOLEANS)) {
    const help = H.runNj([cmd, '--help'], { cwd: d }).stdout;
    const shown = help.split('\n').map((l) => /^ {2}--([a-z-]+)(\s|$)/.exec(l)).filter(Boolean).map((m) => (m as RegExpExecArray)[1]);
    T.sameSet(`${cmd}: the booleans are exactly the flags --help shows without a value`, shown, names);
  }
}

T.finish();
