/* Fault injection — the two NJ_FAULT points, distinguished (§ 12).
 *
 * ac-09 asserts the AC-9 outcome (previous revision intact, stray tmp, exit 1,
 * --fix removes it). This file asserts the thing that tells the two injection
 * points apart: how far the write got before it aborted.
 *
 *   after-tmp-write — the temp file holds the *new* content, unflushed
 *   before-rename   — the temp file holds the new content, flushed and closed
 *
 * In both cases the target file is untouched. If an implementation aborted
 * before writing the temp file at all, or wrote it into the target, these
 * assertions fail while ac-09 would still pass — that is the point of having
 * both.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const TASK = 'tasks/TSK-001.md';

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      [TASK]: H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Backend API Endpoints\n\n## Description\n\n## Acceptance Criteria\n'),
    },
    tombstones: ['TSK-001'],
  });
}

const tasksDir = d => path.join(d, 'backlog', 'tasks');
const tmpOf = d => fs.readdirSync(tasksDir(d)).filter(f => f.startsWith('.nj-tmp-'));

for (const mode of ['after-tmp-write', 'before-rename']) {
  const d = fixture('fault-' + mode);
  const targetBefore = fs.readFileSync(path.join(tasksDir(d), 'TSK-001.md'), 'utf8');

  const r = H.runNj(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_FAULT: mode, NJ_NOW: H.LATER_NOW } });

  T.exit('NJ_FAULT=' + mode + ': exit 1', r, 1);

  const tmp = tmpOf(d);
  T.check('NJ_FAULT=' + mode + ': one temp file survives', tmp.length === 1,
    JSON.stringify(tmp));

  if (tmp.length === 1) {
    const tmpBody = fs.readFileSync(path.join(tasksDir(d), tmp[0]), 'utf8');
    T.contains('NJ_FAULT=' + mode + ': the temp file holds the NEW content',
      tmpBody, 'status: doing');
    T.contains('NJ_FAULT=' + mode + ': the temp file is a complete element file',
      tmpBody, 'id: TSK-001');
    T.check('NJ_FAULT=' + mode + ': the temp file is not empty',
      tmpBody.length > 50, 'length ' + tmpBody.length);
  }

  const targetAfter = fs.readFileSync(path.join(tasksDir(d), 'TSK-001.md'), 'utf8');
  T.eq('NJ_FAULT=' + mode + ': target is byte-identical to before',
    H.sha256(targetAfter), H.sha256(targetBefore));
  T.check('NJ_FAULT=' + mode + ': target still says todo',
    targetAfter.includes('status: todo'));

  /* A reader must never see a half file: the only extra file is the temp. */
  const others = fs.readdirSync(tasksDir(d)).filter(f => f !== 'TSK-001.md' && !f.startsWith('.nj-tmp-'));
  T.check('NJ_FAULT=' + mode + ': no other file was created', others.length === 0,
    JSON.stringify(others));
}

T.finish();
