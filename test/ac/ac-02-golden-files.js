'use strict';
/* AC-2 — Golden files.
 *
 * "After any number of set/note cycles, each file is byte-identical to the
 *  golden fixture produced by the normative serializer (fixtures are generated
 *  under a fixed NJ_NOW, § 12); unknown fields and unknown body sections are
 *  unchanged."
 *
 * Every case below performs a real write and then compares the resulting bytes
 * against test/golden/. The clock is pinned so no normalisation is needed —
 * normalising is exactly what would hide a serializer defect.
 */
const path = require('path');
const fs = require('fs');
const H = require('../lib/harness.js');
const T = H.T;

const epicFile = d => path.join(d, 'backlog', 'epics', 'EPIC-001.md');
const taskFile = d => path.join(d, 'backlog', 'tasks', 'TSK-001.md');
const subFile = d => path.join(d, 'backlog', 'subtasks', 'SUB-001.md');

function init(dir) {
  T.exit('nj init', H.runNj(['init'], { cwd: dir }), 0);
}

/* ---- § 9 new: the scaffold, one golden per element type ---------------- */

{
  const d = H.freshDir('ac02-new');
  init(d);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.goldenEq('nj new epic == golden', epicFile(d), 'new-epic.md');

  T.exit('new task', H.runNj(['new', '--type=task', '--parent=EPIC-001',
    '--title=Backend API Endpoints'], { cwd: d }), 0);
  T.goldenEq('nj new task == golden', taskFile(d), 'new-task.md');

  T.exit('new subtask', H.runNj(['new', '--type=subtask', '--parent=TSK-001',
    '--title=Login route'], { cwd: d }), 0);
  T.goldenEq('nj new subtask == golden', subFile(d), 'new-subtask.md');
}

/* ---- § 9 set: every field, list fields, emptied lists ------------------ */

{
  const d = H.freshDir('ac02-set');
  init(d);
  H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Other'], { cwd: d });

  // TSK-002 has to exist for the depends_on target to resolve.
  // List fields are set, not appended, and an emptied list is an empty optional
  // field that gets omitted. That pair is exercised on the *fresh* element
  // first, so `golden/set-empty-lists.md` matches the state it describes:
  // untouched title, no priority/assignee/depends_on, only `updated` moved.
  const rTags = H.runNj(['set', '--id=TSK-001', '--tags=backend,auth'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --tags=a,b', rTags, 0);
  T.contains('the tags were written', H.readOrNull(taskFile(d)) || '', 'tags: [backend, auth]');

  const r2 = H.runNj(['set', '--id=TSK-001', '--tags='], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --tags= (empty)', r2, 0);
  T.goldenEq('emptied list field is omitted == golden', taskFile(d), 'set-empty-lists.md');

  const r = H.runNj(['set', '--id=TSK-001', '--title=Login: Errors', '--status=doing',
    '--priority=high', '--assignee=coder-agent', '--tags=backend,auth',
    '--depends-on=TSK-002'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set every field', r, 0);
  T.goldenEq('set all fields == golden', taskFile(d), 'set-all-fields.md');
}

/* ---- § 7 body: only the H1 moves on a title change --------------------- */

{
  const d = H.mkBacklog({
    label: 'ac02-body',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Original',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Original\n\n## Description\nKeep this byte-for-byte.\n\n  Indented and oddly   spaced.\n\n## Acceptance Criteria\n- [ ] untouched\n'),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--title=Renamed'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set title', r, 0);
  T.goldenEq('title change rewrites only the H1 == golden', taskFile(d),
    'set-title-body-untouched.md');
}

/* ---- § 10 note --------------------------------------------------------- */

{
  const d = H.freshDir('ac02-note');
  init(d);
  H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints'], { cwd: d });

  // Unassigned first: the note signs with '?'.
  const r1 = H.runNj(['note', '--id=TSK-001', 'Parser splits at the first colon'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj note (unassigned)', r1, 0);
  T.goldenEq('note without assignee == golden', taskFile(d), 'note-append-unassigned.md');
}

{
  const d = H.freshDir('ac02-note2');
  init(d);
  H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints'], { cwd: d });
  H.runNj(['set', '--id=TSK-001', '--assignee=coder-agent'], { cwd: d });

  const r = H.runNj(['note', '--id=TSK-001', 'Parser splits at the first colon'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj note (assigned)', r, 0);
  T.goldenEq('note signs with assignee == golden', taskFile(d), 'note-append.md');
}

{
  // A second note must append under the existing ## Notes heading.
  const d = H.mkBacklog({
    label: 'ac02-note3',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', assignee: 'coder-agent',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Backend API Endpoints\n\n## Description\n\n## Acceptance Criteria\n\n## Notes\n- ' +
        H.FIXED_NOW + ' coder-agent: first\n'),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['note', '--id=TSK-001', 'second'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('second nj note', r, 0);
  T.goldenEq('second note appends under ## Notes == golden', taskFile(d), 'note-second.md');
}

/* ---- § 11 archive ------------------------------------------------------ */

{
  const d = H.freshDir('ac02-arch');
  init(d);
  H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d });
  H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints'], { cwd: d });
  H.runNj(['set', '--id=TSK-001', '--status=done'], { cwd: d });
  H.runNj(['set', '--id=EPIC-001', '--status=done'], { cwd: d });

  const r = H.runNj(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj archive', r, 0);
  T.goldenEq('archived epic == golden',
    path.join(d, 'backlog', 'archive', 'EPIC-001.md'), 'archive-epic.md');
  T.goldenEq('archived task == golden',
    path.join(d, 'backlog', 'archive', 'TSK-001.md'), 'archive-task.md');
}

/* ---- § 14 doctor --fix ------------------------------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac02-fixid',
    files: {
      'tasks/TSK-005.md': H.element({
        type: 'task', parent: 'EPIC-001', title: 'No id here',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# No id here\n\n## Description\nX\n'),
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nY\n'),
    },
    tombstones: ['EPIC-001', 'TSK-005'],
  });
  /* § 14: "0 when no error remains, 2 when one does." TSK-005's only defect is
   * a missing `id` — `id:derived` (§ 7: warning, since the file name `TSK-005`
   * agrees with the `tasks/` folder, so no `id:mismatch` error applies) — and
   * EPIC-001 is clean. No error-level code applies anywhere in this fixture,
   * so the exit code is pinned at exactly 0. */
  T.exit('doctor --fix (missing id)',
    H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);
  T.goldenEq('--fix writes id from file name == golden', taskFile2(d), 'fix-id-from-name.md');
}

function taskFile2(d) { return path.join(d, 'backlog', 'tasks', 'TSK-005.md'); }

{
  const d = H.mkBacklog({
    label: 'ac02-fixh1',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Truth',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Stale heading\n\n## Description\n\n## Acceptance Criteria\n'),
    },
    tombstones: ['TSK-001'],
  });
  // § 14: "0 when no error remains, 2 when one does." This fixture's
  // `parent: EPIC-001` points at nothing — no epics/EPIC-001.md, and no
  // EPIC-001 tombstone either — so `parent:dangling` applies (§ 7: error).
  // § 14 explicitly forbids `--fix` from inventing parents, so this finding
  // survives the repair regardless of AMBIGUITIES.md 5's before/after
  // question (both readings see it): the exit code is pinned at exactly 2.
  T.exit('doctor --fix (H1 drift)',
    H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 2);
  T.goldenEq('--fix pulls the H1 up from title == golden', taskFile(d), 'fix-h1.md');
}

/* ---- unknown fields and unknown body sections survive a write cycle ---- */

{
  const d = H.mkBacklog({
    label: 'ac02-unknown',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
        estimate: '3', custom_flag: 'keep-me',
      }, '# Backend API Endpoints\n\n## Description\n\n## Acceptance Criteria\n\n## Rollout\nDo not touch this section.\n'),
    },
    tombstones: ['TSK-001'],
  });
  H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  const after = fs.readFileSync(taskFile(d), 'utf8');
  T.contains('unknown field estimate survives', after, 'estimate: 3');
  T.contains('unknown field custom_flag survives', after, 'custom_flag: keep-me');
  T.contains('unknown body section survives', after, '## Rollout\nDo not touch this section.');
}

T.finish();
