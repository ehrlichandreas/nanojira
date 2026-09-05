/* AC-9 — Atomicity.
 *
 * "With NJ_FAULT=after-tmp-write and NJ_FAULT=before-rename the previous
 *  revision is intact, no half file exists, exit is 1, and doctor --fix
 *  removes the temp file."
 *
 * The injection points are §12: after the temp file is written but before
 * fsync, and after fsync but immediately before rename. Both must leave the
 * target file byte-identical to its previous revision — the reader must see
 * either the old or the new complete file, never half of one.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const TASK = 'tasks/TSK-001.md';
const BODY = '# Backend API Endpoints\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nD\n'),
      [TASK]: H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, BODY),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

function taskPath(d) { return path.join(d, 'backlog', TASK); }

function tmpFiles(d) {
  return fs.readdirSync(path.join(d, 'backlog', 'tasks'))
    .filter(f => f.startsWith('.nj-tmp-'));
}

for (const mode of ['after-tmp-write', 'before-rename']) {
  const d = fixture('ac09-' + mode);
  const before = fs.readFileSync(taskPath(d), 'utf8');
  const sumBefore = H.sha256(before);

  const r = H.runNj(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_FAULT: mode, NJ_NOW: H.LATER_NOW } });
  T.exit('NJ_FAULT=' + mode + ' exits 1', r, 1);

  const after = fs.readFileSync(taskPath(d), 'utf8');
  T.eq('NJ_FAULT=' + mode + ': previous revision is intact (checksum)',
    H.sha256(after), sumBefore);
  T.check('NJ_FAULT=' + mode + ': status was not written', after.includes('status: todo'),
    'file now contains: ' + JSON.stringify(after.slice(0, 200)));

  T.check('NJ_FAULT=' + mode + ': exactly one stray temp file',
    tmpFiles(d).length === 1, 'found ' + JSON.stringify(tmpFiles(d)));
  T.check('NJ_FAULT=' + mode + ': temp file name matches .nj-tmp-*',
    tmpFiles(d).every(f => /^\.nj-tmp-/.test(f)));

  /* No half file anywhere: every file in tasks/ is either the untouched
   * revision or a temp file. */
  const strays = fs.readdirSync(path.join(d, 'backlog', 'tasks'))
    .filter(f => f.endsWith('.md') && f !== 'TSK-001.md');
  T.check('NJ_FAULT=' + mode + ': no half-written target file', strays.length === 0,
    JSON.stringify(strays));

  /* The temp file is a doctor finding (warning) and --fix removes it. */
  const doc = H.runJson(['doctor'], { cwd: d });
  const p = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'backlog:stray_tmp');
  T.sameSet('NJ_FAULT=' + mode + ': the findings are exactly the stray temp warning',
    H.doctorSet(doc) || ['<no problems array>'], ['backlog:stray_tmp:warning']);
  T.eq('NJ_FAULT=' + mode + ': backlog:stray_tmp severity is warning',
    p[0] && p[0].severity, 'warning');

  const fix = H.runNj(['doctor', '--fix'], { cwd: d });
  T.check('NJ_FAULT=' + mode + ': doctor --fix ran', fix.status === 0 || fix.status === 2,
    'exit ' + fix.status + ' ' + fix.stderr);
  T.check('NJ_FAULT=' + mode + ': doctor --fix removed the temp file',
    tmpFiles(d).length === 0, 'still present: ' + JSON.stringify(tmpFiles(d)));

  /* The revision survived the whole cycle untouched. */
  T.eq('NJ_FAULT=' + mode + ': revision still intact after --fix',
    H.sha256(fs.readFileSync(taskPath(d), 'utf8')), sumBefore);
}

/* A successful write does leave a temp file behind for a *reader* to never
 * see — but after a clean run no stray may remain. */
{
  const d = fixture('ac09-clean');
  T.exit('clean set exits 0', H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d }), 0);
  T.check('a clean write leaves no temp file behind', tmpFiles(d).length === 0,
    JSON.stringify(tmpFiles(d)));
}

T.finish();
