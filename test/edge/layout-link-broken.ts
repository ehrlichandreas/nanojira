/* Edge — a layout folder that is a symlink to a file, or a dangling one,
 * makes `new` fail with a one-line `io_error` naming the folder (DECISIONS
 * 218).
 *
 * A layout folder may be a symlink to a directory (DECISIONS 105). One that
 * points at a file or at nothing is `backlog:unreadable_dir` for `doctor`
 * (DECISIONS 105 F1), but `new` still tried to create the element's folder
 * there: `mkdir` failed with EEXIST or ENOENT, and the raw OS error reached
 * the top level as `internal_error`, printed twice-prefixed with its stack
 * ("Error: Error: EEXIST: file already exists, mkdir '<b>/tasks'"). Found
 * by ImprovementScout's TSK-042 check (cases 5a, 5b, 5c); the real call and
 * the dry run behaved alike.
 *
 * Each case: exit 1, `error: "io_error"`, stderr one `Error:` line naming
 * the folder plus the usual hint line, no stack; the link and its target are left as they were and
 * no element file is written. The plan form (`--input=`) reports the same
 * code for its failing node, and a dry run answers what the real call does.
 * A plain file in the folder's place (5d) is the same `io_error`, its hint
 * naming the file instead of talking about a symlink.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
const env = { NJ_NOW: H.FIXED_NOW, NJ_AUTHOR: 'agent' };

function ok(args: string[], cwd: string) {
  const r = H.runNj(args, { cwd, env });
  if (r.status !== 0) T.check('fixture: ' + args.join(' '), false, r.status + ' ' + J(r.stderr));
}

/** EPIC-001 > TSK-001, then `folder` replaced by a link to `target` (relative
 * to the backlog's parent), its former contents moved aside. */
function fixture(label: string, folder: string, target: string, makeTarget?: (o: string) => void) {
  const dir = H.freshDir(label);
  ok(['init'], dir);
  ok(['new', '--type=epic', '--title=E', '--description=D.'], dir);
  ok(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [ ] a'], dir);
  const b = path.join(dir, 'backlog'), o = path.join(dir, 'outside');
  fs.mkdirSync(path.join(o, 'aside'), { recursive: true });
  fs.renameSync(path.join(b, folder), path.join(o, 'aside', folder));
  if (makeTarget) makeTarget(o);
  fs.symlinkSync(path.join('..', target), path.join(b, folder));
  return { dir, b, o, link: path.join(b, folder) };
}

/** Every file below `root`, relative, never through a symlink. */
function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel === '' ? e.name : rel + '/' + e.name;
      if (e.isDirectory()) visit(path.join(d, e.name), r); else out.push(r);
    }
  };
  if (fs.existsSync(root)) visit(root, '');
  return out.sort();
}
const elementFiles = (b: string) => walk(b).filter((f) => /(EPIC|TSK|SUB)-\d+\.md$/.test(f));
const tree = (o: string) => walk(o).map((f) => f + ':' + fs.readFileSync(path.join(o, f), 'utf8'));

const cases: Array<[string, string, string, ((o: string) => void) | undefined, string[]]> = [
  ['5a tasks -> a file', 'tasks', 'outside/file', (o) => fs.writeFileSync(path.join(o, 'file'), 'not a folder\n'),
    ['new', '--type=task', '--parent=EPIC-001', '--title=New', '--description=D.']],
  ['5b tasks -> a dangling link', 'tasks', 'outside/missing', undefined,
    ['new', '--type=task', '--parent=EPIC-001', '--title=New', '--description=D.']],
  ['5c subtasks -> a dangling link, the target\'s parent exists', 'subtasks', 'outside/missing-dir', undefined,
    ['new', '--type=subtask', '--parent=TSK-001', '--title=New', '--description=D.']],
];

for (const [label, folder, target, makeTarget, args] of cases) {
  for (const dry of [false, true]) {
    const tag = label + (dry ? ' (dry run)' : '');
    const x = fixture('llb-' + folder + (dry ? '-dry' : ''), folder, target, makeTarget);
    const linkBefore = fs.readlinkSync(x.link);
    const outBefore = tree(x.o);
    const filesBefore = elementFiles(x.b);
    const r = H.runJson(args.concat(['--json'], dry ? ['--dry-run'] : []), { cwd: x.dir, env });
    T.eq(`${tag}: exit 1`, r.status, 1);
    T.eq(`${tag}: error is io_error`, r.json && r.json.error, 'io_error');
    const lines = r.stderr.split('\n').filter((l: string) => l !== '');
    T.eq(`${tag}: stderr is the Error: line and the hint, nothing else`, lines.length, 2);
    T.check(`${tag}: the --json hint is the stderr hint line`, lines.length === 2 && r.json && r.json.hint === lines[1], J(r.json));
    T.check(`${tag}: the line is one Error: naming the folder`, lines.length > 0 && /^Error: (?!Error)/.test(lines[0]) && lines[0].includes(x.link), J(r.stderr));
    T.check(`${tag}: no stack trace`, !/\n\s+at /.test(r.stderr), J(r.stderr));
    T.check(`${tag}: the hint is about a symlink`, /symlink/.test(String(r.json && r.json.hint)), J(r.json));
    T.eq(`${tag}: the link is unchanged`, fs.readlinkSync(x.link), linkBefore);
    T.eq(`${tag}: the outside tree is unchanged`, tree(x.o), outBefore);
    T.eq(`${tag}: no element file written`, elementFiles(x.b), filesBefore);
  }
}

/* 5d: a plain file where the folder should be, no symlink anywhere. The
 * hint says so, and names the file, instead of the symlink text, which
 * would send you looking for a link that is not there (Reviewer N1). */
for (const dry of [false, true]) {
  const tag = '5d tasks is a plain file' + (dry ? ' (dry run)' : '');
  const dir = H.freshDir('llb-file' + (dry ? '-dry' : ''));
  ok(['init'], dir);
  ok(['new', '--type=epic', '--title=E', '--description=D.'], dir);
  const b = path.join(dir, 'backlog'), file = path.join(b, 'tasks');
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, 'not a folder\n');
  const r = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=New', '--description=D.', '--json'].concat(dry ? ['--dry-run'] : []), { cwd: dir, env });
  T.eq(`${tag}: exit 1`, r.status, 1);
  T.eq(`${tag}: error is io_error`, r.json && r.json.error, 'io_error');
  T.eq(`${tag}: the hint names the file in the way`, r.json && r.json.hint, `a file or other non-directory is in the way at ${file}; move it`);
  const lines = r.stderr.split('\n').filter((l: string) => l !== '');
  T.eq(`${tag}: stderr is the Error: line and the hint`, lines, lines.length === 2 && /^Error: (?!Error)/.test(lines[0]) ? [lines[0], r.json && r.json.hint] : ['Error: …', 'hint']);
  T.eq(`${tag}: the file is unchanged`, fs.readFileSync(file, 'utf8'), 'not a folder\n');
  T.eq(`${tag}: no element file written`, elementFiles(b), ['epics/EPIC-001.md']);
}

/* The plan form: the failing node's error is the same io_error. */
{
  const x = fixture('llb-plan', 'tasks', 'outside/missing');
  const plan = JSON.stringify({ type: 'task', parent: 'EPIC-001', title: 'P', description: 'D.' });
  const r = H.runJson(['new', '--input=-', '--json'], { cwd: x.dir, env, input: plan });
  T.eq('plan: exit 1', r.status, 1);
  T.eq('plan: error is io_error', r.json && r.json.error, 'io_error');
  T.check('plan: no stack trace', !/\n\s+at /.test(r.stderr) && !JSON.stringify(r.json).includes('    at '), J(r.json));
}

T.finish();
