'use strict';
/* Fault injection — all three `NJ_FAULT` hooks pinned as exact `--json` error
 * codes (§ 12, § 9's "closed vocabulary"), closing NC3.
 *
 * `fault:after-tmp-write` was already pinned this way in
 * `edge/failure-vocabulary.js`. The other two hooks were exercised
 * (`fault/nj-fault-points.js`, `fault/nj-fault-before-compare.js`) but never
 * asserted against the exact `--json` string — a wrong or renamed code on
 * either path would not have been caught. This suite closes that gap for the
 * remaining two, so all three fault codes are now string-pinned somewhere.
 */
const H = require('../lib/harness.js');
const T = H.T;

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('T')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

// fault:before-rename -- eq-pin the literal JSON error string, same shape as
// failure-vocabulary.js's existing 'fault:after-tmp-write' case.
{
  const d = fixture('fault-json-before-rename');
  const r = H.runJson(['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NJ_FAULT: 'before-rename' } });
  T.exit('NJ_FAULT=before-rename --json exit 1', r, 1);
  T.eq('the code is fault:before-rename', r.json && r.json.error, 'fault:before-rename');
}

// fault:before-compare -- same, but never drop .nj-fault-go, so it times out
// deterministically after 10s and hardExit's fault:before-compare fires.
{
  const d = fixture('fault-json-before-compare');
  const start = Date.now();
  const r = H.runJson(['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NJ_FAULT: 'before-compare' }, timeout: 15000 });
  const elapsed = Date.now() - start;
  T.exit('NJ_FAULT=before-compare --json exit 1 (after ~10s timeout)', r, 1);
  T.eq('the code is fault:before-compare', r.json && r.json.error, 'fault:before-compare');
  T.check('roughly a 10s wait happened (not an immediate different failure)', elapsed >= 9000, 'elapsed=' + elapsed + 'ms');
}

T.finish();
