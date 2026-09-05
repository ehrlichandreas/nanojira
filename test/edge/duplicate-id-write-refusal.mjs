/* Edge — duplicate IDs (§ 9).
 *
 * "Duplicate IDs: reads show both entries, marked duplicate_id. Writes refuse
 *  and name both absolute file paths plus the exact manual repair step.
 *  Escape hatch: any write command accepts --file=<path> (absolute, or
 *  relative to the backlog) instead of --id to address one file
 *  unambiguously."
 *
 * The escape hatch exists because a refusal an agent cannot act on turns into
 * a retry loop. So the refusal must not merely be correct — it must be
 * actionable, and there must be a way through.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const ONE = '# One\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n';
const TWO = '# Two\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n';

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'One',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, ONE),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Two',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, TWO),
    },
    tombstones: ['TSK-001', 'TSK-002'],
  });
}

/* ---- the refusal ------------------------------------------------------- */
{
  const d = fixture('edge-dupe-refuse');
  const a = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  const b = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-002.md'), 'utf8');

  const r = H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  T.exit('write addressed at a duplicated id is refused', r, 1);

  T.eq('first file unchanged (checksum)',
    H.sha256(fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8')), H.sha256(a));
  T.eq('second file unchanged (checksum)',
    H.sha256(fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-002.md'), 'utf8')), H.sha256(b));

  /* Both paths, named in full — not just the bare id. */
  const msg = r.stdout + r.stderr;
  T.contains('the refusal names TSK-001.md', msg, 'TSK-001.md');
  T.contains('the refusal names TSK-002.md', msg, 'TSK-002.md');
  T.check('the refusal gives an absolute path', msg.includes(path.join(d, 'backlog')),
    'message was: ' + JSON.stringify(msg));
  T.contains('the refusal names the code', msg, 'duplicate_id');
}

/* ---- the escape hatch -------------------------------------------------- */
{
  const d = fixture('edge-dupe-file');
  // Relative to the backlog, per the spec's "relative to the backlog" wording.
  const r = H.runNj(['set', '--file=tasks/TSK-001.md', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--file addresses one file unambiguously', r, 0);

  const one = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  const two = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-002.md'), 'utf8');
  T.contains('the addressed file was written', one, 'status: doing');
  T.check('the other duplicated file was NOT written', two.includes('status: todo'),
    JSON.stringify(two.slice(0, 160)));
}

/* ---- an absolute --file path works too --------------------------------- */
{
  const d = fixture('edge-dupe-abs');
  const abs = path.join(d, 'backlog', 'tasks', 'TSK-002.md');
  const r = H.runNj(['set', '--file=' + abs, '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('absolute --file path is accepted', r, 0);
  const two = fs.readFileSync(abs, 'utf8');
  T.contains('the addressed file was written', two, 'status: doing');
}

T.finish();
