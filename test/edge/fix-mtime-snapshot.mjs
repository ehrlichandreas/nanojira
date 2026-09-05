/* Edge — § 14's mtime snapshot.
 *
 * "Original file mtimes are snapshotted **before step 1**, so step 5 still
 *  sees the true mtime even when step 1 already rewrote the file."
 *
 * Step 5 writes `created` from the file mtime, and step 1 (write the missing
 * `id`/`type`) is a write in its own right: § 12's atomic write is a rename of
 * a fresh temp file, so the file's mtime after step 1 is the moment of the
 * repair, not the moment of creation. An implementation that stats where it
 * writes stamps every repaired element with the repair time instead, and the
 * damage is invisible in the file's *shape* — the timestamps are well-formed
 * either way, the wrong one is merely today's date. That is why the fixture's
 * mtime is set to a fixed instant of its own, far from the pinned clock: it is
 * the only value that can tell the two apart, and this sentence is the only
 * thing that decides between them.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const C = H.FIXED_NOW;

/* Two instants far from the pinned clock and from any plausible "now", and
 * different from each other: a snapshot is a snapshot of *that* file, so a
 * single shared or hard-coded value fails at least one of them. */
const ORIGINAL_A = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));   // 2026-01-02T03:04:05Z
const ORIGINAL_B = new Date(Date.UTC(2025, 11, 24, 5, 6, 7)); // 2025-12-24T05:06:07Z

function body(title) {
  return '# ' + title + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
}

/** stat that never throws — a missing file must report as an assertion. */
function statOrNull(file) {
  try { return fs.statSync(file); } catch (e) { return null; }
}

/** Seconds-resolution ISO-8601 UTC, the format § 6 pins. */
function isoZ(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The value of a frontmatter line, or null. */
function field(text, key) {
  if (text === null) return null;
  const m = text.match(new RegExp('^' + key + ': (.*)$', 'm'));
  return m ? m[1] : null;
}

const d = H.mkBacklog({
  label: 'edge-fix-mtime',
  files: {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
      created: C, updated: C,
    }, '# Auth\n\n## Description\nD\n'),

    /* Step 1 writes `type` from the ID prefix here, so the file is rewritten
     * before step 5 reads the mtime. */
    'tasks/TSK-001.md': H.element({
      id: 'TSK-001', parent: 'EPIC-001', title: 'Needs a type',
      status: 'todo',
      // no `type`, no `created`, no `updated`
    }, body('Needs a type')),

    /* The other branch of step 1: `id` written from the file name. */
    'tasks/TSK-002.md': H.element({
      type: 'task', parent: 'EPIC-001', title: 'Needs an id',
      status: 'todo',
      // no `id`, no `created`, no `updated`
    }, body('Needs an id')),
  },
  tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
});
const bl = path.join(d, 'backlog');

const file = {
  'TSK-001': path.join(bl, 'tasks', 'TSK-001.md'),
  'TSK-002': path.join(bl, 'tasks', 'TSK-002.md'),
};
const epicFile = path.join(bl, 'epics', 'EPIC-001.md');

/* ---- the mtimes are set BEFORE `nj` runs ------------------------------- */
const before = {};
const expected = {};
for (const [id, instant] of [['TSK-001', ORIGINAL_A], ['TSK-002', ORIGINAL_B]]) {
  fs.utimesSync(file[id], instant, instant);

  const st = statOrNull(file[id]);
  if (!T.check(id + ': the fixture file exists', st !== null, 'cannot stat ' + file[id])) continue;
  before[id] = st.mtime;
  expected[id] = isoZ(st.mtime);

  // The expectation is derived from what the filesystem stored, not from what
  // was written into it, so a filesystem that rounds cannot produce a false
  // defect — but a filesystem that silently refuses the call is caught.
  T.eq(id + ': the fixture now has the mtime the test set',
    isoZ(st.mtime), isoZ(instant));

  const text = H.readOrNull(file[id]) || '';
  T.eq(id + ': the fixture has no created — step 5 will have to write it',
    field(text, 'created'), null);
  T.eq(id + ': the fixture has no updated either', field(text, 'updated'), null);
}

/* ---- run the repair ---------------------------------------------------- */
const fix = H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
// § 14: "0 when no error remains, 2 when one does." This fixture's findings
// are all warning-level per § 7's table: TSK-001 is missing `type`
// (`type:derived`) and TSK-002 is missing `id` (`id:derived`) — both derived
// consistently from the file name/folder, so no `type:folder`/`id:mismatch`
// error applies — and both are missing `created`/`updated`
// (`missing:created`/`missing:updated`, also warnings). No error-level code
// applies anywhere in this fixture, before or after the repair, so the exit
// code is pinned at exactly 0.
// AMBIGUOUS (unrelated to the exit code): § 14 does not say whether a run of
// `--fix` reports the elements it repaired or says nothing on success;
// nothing is asserted about its output here, only about the resulting file.
T.exit('doctor --fix', fix, 0);

/* ---- the two timestamps ------------------------------------------------ */
for (const id of ['TSK-001', 'TSK-002']) {
  const text = H.readOrNull(file[id]);
  const st2 = statOrNull(file[id]);
  if (!T.check(id + ': the file is still there after --fix',
    text !== null, 'cannot read ' + file[id])) continue;

  // The precondition that gives the case its point: step 1 did rewrite the
  // file, so the mtime a lazy stat at step 5 would see is this later one.
  T.check(id + ': step 1 rewrote the file (its mtime moved)',
    st2 !== null && before[id] !== undefined && st2.mtime > before[id],
    'mtime now ' + (st2 && st2.mtime.toISOString()) +
    ', before the run ' + (before[id] && before[id].toISOString()) +
    ' — if the mtime never moved, step 1 did not write and the case proves nothing');

  T.eq(id + ': created came from the pre-step-1 mtime, not from the rewrite',
    field(text, 'created'), expected[id]);
  T.check(id + ': created is not the repair clock',
    field(text, 'created') !== H.LATER_NOW, 'created: ' + field(text, 'created'));
  T.eq(id + ': § 14 step 5 set updated to now', field(text, 'updated'), H.LATER_NOW);
}

/* ---- and step 1 did write what it was supposed to ---------------------- */
T.eq('step 1 wrote the type derived from the ID prefix (TSK-001)',
  field(H.readOrNull(file['TSK-001']), 'type'), 'task');
T.eq('step 1 wrote the id from the file name (TSK-002)',
  field(H.readOrNull(file['TSK-002']), 'id'), 'TSK-002');

/* § 14: "steps that find nothing to do leave the file untouched" — the epic
 * needs nothing, so its `updated` is still the fixture's, not the run's. */
T.eq('a file with nothing to repair is left untouched',
  field(H.readOrNull(epicFile), 'updated'), C);

/* ---- the warnings step 5 was repairing are gone ------------------------ */
const list = H.runJson(['list'], { cwd: d });
const entries = (list.json && list.json.entries) || [];
for (const id of ['TSK-001', 'TSK-002']) {
  const e = entries.find(x => x.id === id);
  const problems = (e && e._problems) || [];
  T.check(id + ': missing:created is gone after --fix',
    e !== undefined && !problems.includes('missing:created'), JSON.stringify(problems));
  T.check(id + ': missing:updated is gone after --fix',
    e !== undefined && !problems.includes('missing:updated'), JSON.stringify(problems));
}

T.finish();
