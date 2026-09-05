/* Three output surfaces that were produced but never asserted (§ 9, § 14).
 *
 * The blindness matrix (tools/blindness-matrix) found three rows no suite
 * covered: bare `nj` was only ever run on backlogs with zero incomplete
 * elements, `doctor --fix` was never run in prose with a surviving warning,
 * and `--fix --json`'s `notes[]` was produced in six places and asserted in
 * none. All three sit on `doctorFix`/the short status — the code the refactor
 * touches last and most.
 *
 * WHAT IS PINNED, AND FROM WHERE.
 *
 * 1. Bare `nj` with an incomplete element. § 9 pins the JSON shape outright:
 *    `{backlog, counts, ready: [entries ≤ 5], incomplete: [entries ≤ 5]}`, and
 *    `counts` as `{total, errors, incomplete}`. That is asserted exactly. The
 *    prose is pinned only as "short status: counts, top ready, problems"
 *    (§ 9 command table) — so the prose must NAME the incomplete element and
 *    its code, and that is all that is asserted.
 *    AMBIGUOUS: the prose *format* of the counts (the status line) is not
 *    given anywhere in § 9 — the `Ready to work / Complete first` block is the
 *    `list --ready` example, not bare `nj`. The count digits are therefore
 *    not asserted here; pinning them needs a ruling.
 *
 * 2. `doctor --fix` in prose with a warning that survives. § 14: `--fix`
 *    "reports the actions it took plus the findings that remain", and its
 *    "never" list keeps `unknown:status` (a WARNING, § 7) untouched. The
 *    finding line is asserted in § 14's own report form
 *    (`WARNING TSK-101: unknown status 'blocked-on-review'`), the status is
 *    asserted preserved, and a plain `doctor` afterwards is asserted against
 *    § 14's summary line — which is pinned for `doctor`.
 *    AMBIGUOUS: § 14 does not show `--fix`'s own summary line, so its warning
 *    count is not asserted. `exit-doctor-fix` covers the same scenario in
 *    `--json`; this is its prose half.
 *
 * 3. `notes[]`. § 14 names it as part of the `--json` report ("`fixed[]`,
 *    `notes[]` and `problems[]`") and says "Ambiguity is reported, not guessed
 *    at"; § 8 says `--fix` "reports that the never-reuse guarantee is void" for
 *    unrecoverable tombstones. So: the array exists in every run; it is EMPTY
 *    when nothing was declined (the half `includes()` never checked); it holds
 *    exactly one note per declined step, naming the element involved; and the
 *    tombstone note carries § 8's words. Note *wording* beyond that is not
 *    pinned.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const NOW = H.FIXED_NOW;
const FIXENV = { NJ_NOW: H.LATER_NOW };
const epicBody = t => '# ' + t + '\n\n## Description\nD\n';
const taskBody = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
const el = (f, body) => H.element(Object.assign({ created: NOW, updated: NOW }, f), body);
const EPIC = el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo' }, epicBody('E'));
const ids = a => a.map(e => e && e.id);

/* ================================================================== */
/* 1. Bare `nj` on a backlog that has something incomplete (§ 9)      */
/* ================================================================== */
{
  const d = H.mkBacklog({
    label: 'surface-bare',
    files: {
      'epics/EPIC-001.md': EPIC,
      'tasks/TSK-007.md': el({ id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'Login route', status: 'todo' },
        taskBody('Login route')),
      /* § 7: an empty acceptance heading counts as absent → incomplete:acceptance. */
      'tasks/TSK-009.md': el({ id: 'TSK-009', type: 'task', parent: 'EPIC-001', title: 'Registration', status: 'todo' },
        '# Registration\n\n## Description\nD\n\n## Acceptance Criteria\n'),
    },
    tombstones: ['EPIC-001', 'TSK-007', 'TSK-009'],
  });

  const j = H.runJson([], { cwd: d });
  T.exit('bare nj --json exits 0 with an incomplete element present', j, 0);
  T.eq('counts is {total, errors, incomplete} with the incomplete one counted',
    j.json && j.json.counts, { total: 3, errors: 0, incomplete: 1 });
  /* EPIC-001 has an open child (TSK-007, neither done nor archived), so
   * bare nj's own leaf rule (DECISIONS 156/158, § 9 "--ready") excludes
   * it from ready[] in favour of TSK-007 itself — list --ready would
   * still name both; this is bare nj's own JSON shape specifically. */
  T.sameSet('ready[] holds exactly the complete, todo, LEAF elements',
    ids((j.json && j.json.ready) || []), ['TSK-007']);
  T.sameSet('incomplete[] holds exactly the incomplete element',
    ids((j.json && j.json.incomplete) || []), ['TSK-009']);
  const inc = j.json && j.json.incomplete && j.json.incomplete[0];
  T.sameSet('the incomplete entry carries exactly its code in _problems',
    (inc && inc._problems) || ['<no entry>'], ['incomplete:acceptance']);

  const p = H.runNj([], { cwd: d });
  T.exit('bare nj (prose) exits 0', p, 0);
  T.contains('the short status names the incomplete element', p.stdout, 'TSK-009');
  T.contains('the short status names its problem code', p.stdout, 'incomplete:acceptance');
  T.contains('the short status names the ready element', p.stdout, 'TSK-007');
}

/* ================================================================== */
/* 2. `doctor --fix` in prose, a warning survives (§ 14)               */
/* ================================================================== */
{
  const d = H.mkBacklog({
    label: 'surface-fix-prose',
    files: {
      'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'blocked-on-review' }, epicBody('E')),
      /* A second element, so the summary avoids the unpinned singular of "entries". */
      'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo' }, taskBody('T')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const fix = H.runNj(['doctor', '--fix'], { cwd: d, env: FIXENV });
  T.exit('--fix (prose) exits 0: a surviving warning does not raise the code', fix, 0);
  T.check('--fix (prose) reports the surviving finding in § 14\'s line form',
    /^WARNING EPIC-001: unknown status 'blocked-on-review'$/m.test(fix.stdout),
    JSON.stringify(fix.stdout.slice(0, 400)));
  T.contains('the invalid status was not guessed at',
    H.readInBacklog(d, 'epics/EPIC-001.md'), 'status: blocked-on-review');

  const doc = H.runNj(['doctor'], { cwd: d });
  T.exit('doctor afterwards exits 0', doc, 0);
  T.eq('doctor afterwards prints § 14\'s summary line with the warning counted',
    doc.stdout.split('\n')[0], H.summaryLine('backlog/', 2, 0, 1));
}

/* ================================================================== */
/* 3. `--fix --json` notes[] (§ 14, § 8)                               */
/* ================================================================== */

function fixJson(name, d, exit) {
  const r = H.runJson(['doctor', '--fix'], { cwd: d, env: FIXENV });
  T.exit(name + ' — --fix --json exits ' + exit, r, exit);
  const js = r.json || {};
  T.check(name + ' — report carries fixed[], notes[] and problems[] (§ 14)',
    Array.isArray(js.fixed) && Array.isArray(js.notes) && Array.isArray(js.problems),
    JSON.stringify(Object.keys(js)));
  return Array.isArray(js.notes) ? js.notes : ['<no notes array>'];
}

/* Nothing declined → notes is empty, not merely "contains nothing specific".
 * The repair is step 6 (H1 pulled up from `title`), which touches no
 * tombstone. AMBIGUOUS, deliberately not used here: a backfill of ONE missing
 * tombstone (`id:no_tombstone`) is observationally the same as partial
 * tombstone loss (§ 7), and § 8's "reports that the never-reuse guarantee is
 * void" is stated for the missing-`.nanojira/ids/` case — whether a partial backfill
 * must carry that note too is not decided, so it is not asserted. */
{
  const d = H.mkBacklog({
    label: 'surface-notes-empty',
    files: { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'Real Title', status: 'todo' },
      '# Stale Heading\n\n## Description\nD\n') },
    tombstones: ['EPIC-001'],
  });
  const notes = fixJson('H1 drift repaired', d, 0);
  T.sameSet('H1 drift repaired — notes[] is empty', notes, []);
  T.contains('H1 drift repaired — the H1 was pulled up from title',
    H.readInBacklog(d, 'epics/EPIC-001.md'), '# Real Title');
}

/* Step 2 declines: "rename … when … the target is free" — it is not. */
{
  const d = H.mkBacklog({
    label: 'surface-notes-occupied',
    files: { 'epics/EPIC-001.md': EPIC,
      'tasks/TSK-001.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Claimant', status: 'todo' }, taskBody('Claimant')),
      'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Occupant', status: 'todo' }, taskBody('Occupant')) },
    tombstones: ['EPIC-001', 'TSK-002'],
  });
  const notes = fixJson('occupied rename target', d, 2);
  T.eq('occupied rename target — exactly one note', notes.length, 1);
  T.check('occupied rename target — the note names the file or id involved',
    /TSK-00[12]/.test(String(notes[0])), JSON.stringify(notes));
  T.eq('occupied rename target — neither file was renamed away',
    H.listFiles(d, 'tasks'), ['TSK-001.md', 'TSK-002.md']);
}

/* Step 3 declines: move "only when id prefix and type agree" — they do not. */
{
  const d = H.mkBacklog({
    label: 'surface-notes-prefix',
    files: { 'epics/EPIC-001.md': EPIC,
      'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo' }, taskBody('T')),
      'tasks/TSK-005.md': el({ id: 'TSK-005', type: 'subtask', parent: 'TSK-001', title: 'S', status: 'todo' }, taskBody('S')) },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-005'],
  });
  const notes = fixJson('prefix/type disagree', d, 2);
  T.eq('prefix/type disagree — exactly one note', notes.length, 1);
  T.contains('prefix/type disagree — the note names the element', String(notes[0]), 'TSK-005');
  T.check('prefix/type disagree — the file was not moved',
    H.existsInBacklog(d, 'tasks/TSK-005.md') && !H.existsInBacklog(d, 'subtasks/TSK-005.md'),
    JSON.stringify(H.listFiles(d, 'subtasks')));
}

/* § 8: tombstones for deleted IDs "cannot be recovered; --fix reports that
 * the never-reuse guarantee is void for those numbers". */
{
  const d = H.mkBacklog({ label: 'surface-notes-void', files: { 'epics/EPIC-001.md': EPIC }, tombstones: ['EPIC-001'] });
  fs.rmSync(path.join(d, 'backlog', H.IDS_REL), { recursive: true, force: true });
  const notes = fixJson('.nanojira/ids/ lost', d, 0);
  T.eq('.nanojira/ids/ lost — exactly one note', notes.length, 1);
  T.contains('.nanojira/ids/ lost — the note says the never-reuse guarantee is void (§ 8)',
    String(notes[0]), 'never-reuse');
}

T.finish();
