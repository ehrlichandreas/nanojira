'use strict';
/* Edge — setting `done` on an already-`done` element (§ 9, § 12).
 *
 * § 9: "`nj set --status=done` on an element with children not `done` is
 * refused unless `--allow-open-children`; forcing it produces
 * `done:open_children`."
 *
 * That sentence is phrased as a property of the *call* — "an element with
 * children not done" — not of a todo→done *transition*. The existing
 * done-open-children.js suite only ever calls `--status=done` once, while the
 * element is still `todo`; it never asks what happens when the element is
 * already `done` and the guard is asked to fire again. Two things follow
 * from a literal reading and are decided by the spec:
 *
 *   (a) re-asserting `done` on an element that is already `done` and has no
 *       open children is not itself a reason to refuse — nothing in § 9 makes
 *       "value unchanged" a refusal condition, so this must still succeed.
 *   (b) the open-children guard re-evaluates the *current* child state on
 *       every `--status=done` call, including one that is a no-op on the
 *       `status` field itself — an element that reached `done` earlier via
 *       `--allow-open-children` (or a hand-edit) and still has an open child
 *       must be refused again if `--status=done` is repeated without the flag.
 *
 * What is NOT decided, and is therefore not asserted here: whether such a
 * no-op call bumps `updated` and what `changed` reports for the unchanged
 * `status` field. That is `AMBIGUITIES.md` item 13, already on file — this
 * test does not re-litigate it, only the parts the spec does pin.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* ---- (a) done-on-done on a leaf succeeds — it is not a refusal ---------- */
{
  const d = H.mkBacklog({
    label: 'edge-done-on-done-leaf',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Leaf',
        status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Leaf')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const r = H.runJson(['set', '--id=TSK-001', '--status=done'], { cwd: d });
  T.exit('re-asserting done on an already-done leaf succeeds', r, 0);
  T.check('ok:true', r.json && r.json.ok === true, JSON.stringify(r.json));
  T.eq('the element is still reported as done', r.json && r.json.entry && r.json.entry.status, 'done');

  const after = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  T.contains('the file still carries status: done', after, 'status: done');
}

/* ---- (b) the open-children guard re-fires on a repeated done ------------ */
{
  const d = H.mkBacklog({
    label: 'edge-done-on-done-guard',
    files: {
      'epics/EPIC-001.md': H.element({
        // Already `done`, by hand — as if reached earlier via
        // --allow-open-children — while a child is still open.
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'done',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Still open',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Still open')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const epicPath = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  const before = fs.readFileSync(epicPath, 'utf8');

  const r = H.runNj(['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  T.exit('repeating done without --allow-open-children is refused again', r, 1);
  T.eq('nothing was written (checksum)',
    H.sha256(fs.readFileSync(epicPath, 'utf8')), H.sha256(before));

  const msg = r.stdout + r.stderr;
  T.contains('the refusal names the still-open child', msg, 'TSK-001');

  const js = H.runJson(['set', '--id=EPIC-001', '--status=done'], { cwd: d });
  T.exit('the repeated refusal has a JSON form', js, 1);
  T.eq('the code is refused:children_open, same as a fresh transition',
    js.json && js.json.error, 'refused:children_open');

  /* The sanctioned way still works even though the value does not change. */
  const ok = H.runJson(['set', '--id=EPIC-001', '--status=done', '--allow-open-children'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('--allow-open-children permits the repeated done', ok, 0);
  T.check('ok:true', ok.json && ok.json.ok === true, JSON.stringify(ok.json));
}

T.finish();
