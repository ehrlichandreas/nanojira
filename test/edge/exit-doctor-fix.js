'use strict';
/* `doctor --fix` — the exit code, pinned (§ 14).
 *
 * WHY THIS FILE EXISTS.
 *
 * § 14 decides the rule without leaving a gap:
 *
 *   "`doctor --fix` reports the **actions it took** plus the findings that
 *    **remain** ... while its **exit code reflects the state *after*** them:
 *    0 when no error remains, 2 when one does. A warning that survives does
 *    not raise the exit code. An agent that uses `--fix` as a gate therefore
 *    needs no second `doctor` run."
 *
 * The suite nonetheless tolerated **both** values at every `--fix` call —
 * `T.exit(desc, r, [0, 2])` at seven sites (`ac/ac-02` ×2, `ac/ac-18`,
 * `edge/empty-value-rule`, `edge/fix-duplicate-mtimes`, `edge/fix-mtime-
 * snapshot`, `edge/write-encoding`), with `edge/tombstone-partial-loss` not
 * pinning it at all. `AMBIGUITIES.md` 5 records why (the implementation was
 * still moving) and calls tightening it a follow-up. This is that follow-up,
 * done in new files so the seven carriers stay untouched.
 *
 * An either/or there is not a small looseness. `--fix` is the one command an
 * agent is invited to use as a **gate**: exit 0 means "proceed". Accepting
 * either value means the gate is never tested at all — a `--fix` that
 * returned 2 on a fully repaired backlog (blocking a correct agent) and one
 * that returned 0 on a surviving `duplicate_id` (waving a broken one
 * through) are both green under `[0, 2]`, and they are opposite bugs.
 *
 * HOW EACH EXPECTATION IS DERIVED — from § 14's repair list, never from `nj`.
 *
 * § 14 enumerates what `--fix` repairs (steps 1–8) and, separately, what it
 * must **never** do: "guess status values, resolve duplicate IDs, invent
 * parents, rewrite the body, or overwrite an existing value — even an
 * invalid one". So for each fixture the question has one answer: does an
 * **error**-severity finding (§ 7's Doctor column) survive the eight steps?
 *   - repaired by a step               → no error remains → **0**
 *   - on the "never" list, or no step  → the error remains → **2**
 *   - only warnings remain             → **0**, explicitly
 *
 * Three invariants are asserted at every scenario, because each catches a
 * different way the rule can break:
 *   (a) the exit code itself;
 *   (b) `--fix`'s own `--json` `ok` field agrees with it — § 9: "`ok` is true
 *       exactly when no `error` finding exists";
 *   (c) a plain `doctor` run *afterwards* returns the same code — which is
 *       precisely § 14's "needs no second doctor run", made mechanical.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const NOW = H.FIXED_NOW;
const FIXENV = { NJ_NOW: H.LATER_NOW };

const epicBody = t => '# ' + t + '\n\n## Description\nD\n';
const taskBody = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';

/** The healthy epic every fixture is built around, so a task has a parent. */
const EPIC = {
  'epics/EPIC-001.md': H.element({
    id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
    created: NOW, updated: NOW,
  }, epicBody('E')),
};

const idsOf = d => H.lsOrEmpty(path.join(d, 'backlog', H.IDS_REL));

/**
 * Drive one fixture through `doctor` → `doctor --fix` → `doctor`.
 *
 * `preExit` and `fixExit` are single values on purpose: § 14 decides both,
 * so an array here would be the very tolerance this file removes.
 */
function scenario(name, opts) {
  const d = opts.fixture();

  /* The state *before* the repairs, so a fixture that never carried the
   * problem cannot pass by accident.
   *
   * `preSet`/`postSet` are the COMPLETE set of findings § 7's table produces
   * for the fixture, as `code:severity` — not a code the run must contain.
   * Containment was the old form and it is blind by construction: a mutant
   * that appends one spurious `title:h1_mismatch` warning alongside real
   * findings left this file green with 23 logged hits. Set equality is what
   * turns an *extra* finding into a failure. */
  const pre = H.runJson(['doctor'], { cwd: d });
  T.exit(name + ' — doctor before --fix exits ' + opts.preExit, pre, opts.preExit);
  T.sameSet(name + ' — findings before --fix are exactly § 7\'s set',
    H.doctorSet(pre) || ['<no problems array>'], opts.preSet);

  const statusPath = path.join(d, 'backlog', 'STATUS.md');
  const statusBefore = H.readOrNull(statusPath);
  const fix = H.runJson(['doctor', '--fix'], { cwd: d, env: FIXENV });
  /* DECISIONS 100: step 9 appears in fixed[] exactly when it changed
   * STATUS.md's bytes — missing, stale, or made stale by an earlier step's
   * move or rename. Observable from outside, so the expected count follows
   * the bytes: before V3-3 they never change and nothing is added. */
  const statusRegenerated = H.readOrNull(statusPath) !== statusBefore;

  /* (a) § 14's rule itself. */
  T.exit(name + ' — doctor --fix exits ' + opts.fixExit, fix, opts.fixExit);

  /* The shape is asserted, never assumed. An earlier revision guarded the two
   * invariants below with `if (fix.json && typeof fix.json.ok === 'boolean')`
   * and `if (Array.isArray(fix.json.problems))` — so an implementation that
   * simply omitted either field made both invariants DISAPPEAR and the file
   * still reported PASS, with 101 checks instead of 118. Fewer checks looked
   * exactly like a green run. That is the failure mode this whole file exists
   * to remove, so the guards are gone: § 9 pins doctor's JSON as
   * `{backlog, ok, problems: [...]}`, which makes a missing field a contract
   * breach to be reported, not a variant to be politely skipped.
   *
   * Every assertion below is null-safe rather than conditional, so the check
   * COUNT is a constant of this file — it cannot shrink under a mutation. */
  const okIsBool = !!fix.json && typeof fix.json.ok === 'boolean';
  T.check(name + ' — --fix --json carries a boolean ok (§ 9 doctor shape)',
    okIsBool, JSON.stringify(fix.json && fix.json.ok));

  /* (b) § 9: doctor's `ok` "is true exactly when no `error` finding exists",
   * and § 14 makes `--fix`'s report describe the state after the repairs. So
   * `ok` and the exit code are two views of one fact and must agree. */
  T.check(name + ' — --fix ok agrees with the exit code',
    okIsBool && fix.json.ok === (opts.fixExit === 0),
    'ok=' + JSON.stringify(fix.json && fix.json.ok) + ' exit=' + fix.status);

  const hasProblems = !!fix.json && Array.isArray(fix.json.problems);
  T.check(name + ' — --fix --json carries a problems array (§ 9 doctor shape)',
    hasProblems, JSON.stringify(fix.json && fix.json.problems));

  /* § 14: `problems[]` reflects the state *after* the repairs, so an
   * error-severity entry must appear exactly when the exit is 2. */
  const errs = hasProblems
    ? fix.json.problems.filter(p => p && p.severity === 'error') : null;
  T.check(name + ' — a surviving error appears in problems[] iff exit 2',
    hasProblems && (errs.length > 0) === (opts.fixExit === 2),
    'exit ' + opts.fixExit + ', surviving errors: ' +
    (errs === null ? '(no problems array)' : JSON.stringify(errs.map(p => p.code))));

  /* (c) "An agent that uses `--fix` as a gate therefore needs no second
   * `doctor` run." The second run is made here only to prove the first
   * answer was already correct. */
  const post = H.runJson(['doctor'], { cwd: d });
  T.exit(name + ' — doctor after --fix exits ' + opts.fixExit, post, opts.fixExit);

  /* § 14: `--fix` repairs exactly the steps it lists and nothing else, so the
   * surviving set is derivable too — and a repair that *introduced* a finding
   * would show up here and nowhere else. */
  T.sameSet(name + ' — findings after --fix are exactly § 7\'s remaining set',
    H.doctorSet(post) || ['<no problems array>'], opts.postSet);
  T.sameSet(name + ' — --fix\'s own problems[] matches the post-state (§ 14)',
    H.doctorSet(fix) || ['<no problems array>'], opts.postSet);

  /* notes[] — the third array of § 14's report ("`fixed[]`, `notes[]` and
   * `problems[]`"). This file produced it in six scenarios and asserted it in
   * none, so a `--fix` that dropped every note, or invented one, stayed green.
   *
   * What the spec says goes in it, and therefore what `opts.notes` encodes:
   *   - § 8: "Tombstones for already-deleted IDs cannot be recovered; `--fix`
   *     reports that the never-reuse guarantee is void for those numbers."
   *     One report, in § 8's own words — asserted by the word `never-reuse`,
   *     which is the spec's, not `nj`'s.
   *   - § 14: "Ambiguity is reported, not guessed at." A step that DECLINES
   *     (step 2's "rename … when … the target is free", when it is not) is
   *     one note naming the file it did not rename. The FILE, not the id:
   *     where step 2 declines, two files carry that id, and § 9 makes the file
   *     the only unambiguous address under a duplicate id.
   *   - Nothing else. The "never" list (status, duplicates, parents) is not a
   *     step that declines — it is reported through `problems[]`, "the
   *     findings that remain", which this file already pins. So every other
   *     scenario expects `notes[]` EMPTY, the half `includes()` never checked.
   *
   * Wording beyond that is not pinned. `opts.notes` is one array of required
   * substrings per expected note; every scenario must declare it. All checks
   * are null-safe, so the check count is a constant of this file. */
  const notes = fix.json && Array.isArray(fix.json.notes) ? fix.json.notes : null;
  T.check(name + ' — --fix --json carries a notes array (§ 14)', notes !== null,
    JSON.stringify(fix.json && fix.json.notes));
  T.check(name + ' — the scenario declares its expected notes', Array.isArray(opts.notes),
    'opts.notes missing');
  const wantNotes = Array.isArray(opts.notes) ? opts.notes : [];
  T.eq(name + ' — notes[] holds exactly ' + wantNotes.length + ' note(s)',
    notes === null ? '<no notes array>' : notes.length, wantNotes.length);
  wantNotes.forEach((needles, i) => {
    const note = notes && typeof notes[i] === 'string' ? notes[i] : '';
    T.check(name + ' — note ' + (i + 1) + ' names ' + needles.join(' + '),
      needles.every(n => note.includes(n)), JSON.stringify(notes));
  });

  /* fixed[] — the first array of § 14's report ("`fixed[]`, `notes[]` and
   * `problems[]`"), and the one this file produced in 9 scenarios without
   * asserting anything about it — the exact gap `notes[]` had before this.
   *
   * § 14: "`doctor --fix` reports the **actions it took**" — the eight steps
   * it enumerates, in the order it enumerates them ("Steps run **in this
   * order**"). So `fixed[]` is derivable per scenario without reading `nj`:
   * one entry per DISTINCT step that acted (never one per file a step
   * touched — the tombstone step reports once whether it claims one id or
   * several, the same singular-report shape `notes[]`'s void note already
   * established for step 4), in ascending step order. A step that finds
   * nothing to do ("steps that find nothing to do leave the file
   * untouched") contributes no entry.
   *
   * `opts.fixed` is one array of required substrings per expected entry, in
   * step order — the same shape `opts.notes` uses. Every substring is
   * either a structural identifier already fixed by the fixture (an id or
   * file name the scenario itself named) or a word the spec uses for that
   * step (§ 14: "rename", "move … into the correct type folder", "write the
   * `id`", "write `status`", "the H1", "tombstone", "stray"), never a
   * fragment of `nj`'s sentence. Checked against both the pre-split and the
   * post-split `nj`, identical on each. */
  const fixed = fix.json && Array.isArray(fix.json.fixed) ? fix.json.fixed : null;
  T.check(name + ' — --fix --json carries a fixed array (§ 14)', fixed !== null,
    JSON.stringify(fix.json && fix.json.fixed));
  T.check(name + ' — the scenario declares its expected fixed[] steps', Array.isArray(opts.fixed),
    'opts.fixed missing');
  const wantFixed = Array.isArray(opts.fixed) ? opts.fixed : [];
  const wantCount = wantFixed.length + (statusRegenerated ? 1 : 0);
  T.eq(name + ' — fixed[] holds exactly ' + wantFixed.length + ' step(s), plus step 9 iff STATUS.md changed',
    fixed === null ? '<no fixed array>' : fixed.length, wantCount);
  /* one check, whichever way the bytes went, so the count stays constant */
  T.check(name + ' — fixed[] names STATUS.md exactly when step 9 changed it (D100), and last (step order)',
    !!fixed && (statusRegenerated
      ? fixed.length > 0 && String(fixed[fixed.length - 1]).includes('STATUS.md') &&
        fixed.slice(0, -1).every(e => !String(e).includes('STATUS.md'))
      : fixed.every(e => !String(e).includes('STATUS.md'))),
    'STATUS.md changed: ' + statusRegenerated + ', fixed = ' + JSON.stringify(fixed));
  wantFixed.forEach((needles, i) => {
    const entry = fixed && typeof fixed[i] === 'string' ? fixed[i] : '';
    T.check(name + ' — fixed step ' + (i + 1) + ' names ' + needles.join(' + '),
      needles.every(n => entry.includes(n)), JSON.stringify(fixed));
  });

  if (opts.after) opts.after(d, fix, post);
  return d;
}

/* ================================================================== */
/* Exit 0 — every error was repaired, or only warnings were ever there */
/* ================================================================== */

/* The control. A clean backlog must not be dirtied by --fix; if this one ever
 * exits 2, every "repaired" verdict below is meaningless. */
scenario('clean backlog', {
  fixed: [],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-clean', files: EPIC, tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0, preSet: [], postSet: [],
});

/* § 14 step 1: "write the `id` from the file name ... when missing".
 * `id:derived` is a WARNING, so the pre-exit is already 0 — this case pins
 * the other half of the rule: repairing a warning must not *raise* the exit. */
scenario('id missing (warning, step 1)', {
  /* Step 1 acted, no other step could: § 14 step 1 writes id from the file
   * name. */
  fixed: [['EPIC-001']],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-idderived',
    files: {
      'epics/EPIC-001.md': H.element({
        type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW,
      }, epicBody('E')),
    },
    tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0,
  /* § 7: `id:derived` — "`id` absent — derived from file name" (warning). */
  preSet: ['id:derived:warning'], postSet: [],
  after: d => T.contains('the id was written from the file name',
    H.readInBacklog(d, 'epics/EPIC-001.md'), 'id: EPIC-001'),
});

/* § 14 step 2: "rename the file to match the `id` ... and the target is
 * free". `id:mismatch` is an ERROR (§ 7), so this is the decisive shape:
 * 2 before, 0 after. */
scenario('id mismatch, target free (error, step 2)', {
  /* Step 2 acted (rename), then step 4 (the newly-named TSK-002 had no
   * tombstone) — in that order, exactly as § 14 requires. */
  fixed: [['TSK-001.md', 'TSK-002.md'], ['tombstone']],
  /* AMBIGUOUS (AMBIGUITIES 47): recorded, not derived. A PARTIAL backfill —
   * one element's tombstone, `.nanojira/ids/` otherwise intact — is not the case § 8
   * words the void note for, yet `nj` emits it. The count is pinned as the
   * reading in force so a ruling on 47 is a one-line edit here. */
  notes: [['never-reuse']],
  fixture: () => H.mkBacklog({
    label: 'exitfix-mismatch',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
    tombstones: ['EPIC-001'],
  }),
  preExit: 2, fixExit: 0,
  /* `id:mismatch` (error) from TSK-001.md carrying TSK-002, plus
   * `id:no_tombstone` (warning) because TSK-002 was never claimed. */
  preSet: ['id:mismatch:error', 'id:no_tombstone:warning'], postSet: [],
  after: d => {
    T.check('the file was renamed to match the id',
      H.existsInBacklog(d, 'tasks/TSK-002.md') && !H.existsInBacklog(d, 'tasks/TSK-001.md'),
      JSON.stringify(H.listFiles(d, 'tasks')));
  },
});

/* § 14 step 3: "move a file into the correct type folder — only when `id`
 * prefix and `type` agree". `type:folder` is an ERROR. */
scenario('wrong type folder (error, step 3)', {
  fixed: [['TSK-003']],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-folder',
    files: Object.assign({}, EPIC, {
      'subtasks/TSK-003.md': H.element({
        id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
    tombstones: ['EPIC-001', 'TSK-003'],
  }),
  preExit: 2, fixExit: 0,
  preSet: ['type:folder:error'], postSet: [],
  after: d => T.check('the file was moved into tasks/',
    H.existsInBacklog(d, 'tasks/TSK-003.md') && !H.existsInBacklog(d, 'subtasks/TSK-003.md'),
    'tasks=' + JSON.stringify(H.listFiles(d, 'tasks')) +
    ' subtasks=' + JSON.stringify(H.listFiles(d, 'subtasks'))),
});

/* § 14 step 4 on the ERROR half: `backlog:ids_missing`. AC-18 drives the same
 * loss but tolerates `[0, 2]` on the `--fix` call; here the code is the
 * assertion. */
scenario('.nanojira/ids/ lost entirely (error, step 4)', {
  fixed: [['tombstone']],
  /* § 8's case exactly: `.nanojira/ids/` gone, so deleted IDs' tombstones may be lost. */
  notes: [['never-reuse']],
  fixture: () => {
    const d = H.mkBacklog({
      label: 'exitfix-idsmissing', files: EPIC, tombstones: ['EPIC-001'],
    });
    fs.rmSync(path.join(d, 'backlog', H.IDS_REL), { recursive: true, force: true });
    return d;
  },
  preExit: 2, fixExit: 0,
  /* AMBIGUOUS: § 8 makes an absent `.nanojira/ids/` `backlog:ids_missing` (error) and
   * separately makes an element without a tombstone `id:no_tombstone`
   * (warning). Both conditions literally hold here; the spec does not say
   * the backlog-level code suppresses the element-level one. Reading used:
   * both are reported. */
  preSet: ['backlog:ids_missing:error', 'id:no_tombstone:warning'], postSet: [],
  after: d => T.eq('the tombstone was restored',
    JSON.stringify(idsOf(d)), JSON.stringify(['EPIC-001'])),
});

/* § 14 step 4 on the WARNING half: `id:no_tombstone`. */
scenario('one tombstone missing (warning, step 4)', {
  fixed: [['tombstone']],
  /* AMBIGUOUS (AMBIGUITIES 47): recorded, not derived. A PARTIAL backfill —
   * one element's tombstone, `.nanojira/ids/` otherwise intact — is not the case § 8
   * words the void note for, yet `nj` emits it. The count is pinned as the
   * reading in force so a ruling on 47 is a one-line edit here. */
  notes: [['never-reuse']],
  fixture: () => H.mkBacklog({
    label: 'exitfix-notombstone',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
    tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0,
  preSet: ['id:no_tombstone:warning'], postSet: [],
  after: d => T.eq('the missing tombstone was created',
    JSON.stringify(idsOf(d)), JSON.stringify(['EPIC-001', 'TSK-001'])),
});

/* § 14 step 5: status/created/updated filled in — all three WARNINGS. */
scenario('status and timestamps missing (warnings, step 5)', {
  fixed: [['EPIC-001']],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-step5',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E' },
        epicBody('E')),
    },
    tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0,
  /* § 7: three separate warnings, one per absent known field. */
  preSet: ['missing:status:warning', 'missing:created:warning', 'missing:updated:warning'],
  postSet: [],
  after: d => {
    const body = H.readInBacklog(d, 'epics/EPIC-001.md');
    T.contains('status was filled from statuses[0]', body, 'status: todo');
    T.contains('updated was filled with now', body, 'updated: ' + H.LATER_NOW);
  },
});

/* § 14 step 6: "pull the H1 up from `title`". `title:h1_mismatch` is a
 * WARNING. */
scenario('H1 drift (warning, step 6)', {
  fixed: [['EPIC-001', 'H1']],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-h1',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Real Title', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Stale Heading\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0,
  preSet: ['title:h1_mismatch:warning'], postSet: [],
  after: d => T.contains('the H1 was pulled up from title',
    H.readInBacklog(d, 'epics/EPIC-001.md'), '# Real Title'),
});

/* § 14 step 7: "remove stray `.nj-tmp-*` files". `backlog:stray_tmp` is a
 * WARNING. */
scenario('stray temp file (warning, step 7)', {
  fixed: [['.nj-tmp-4242-deadbeef']],
  notes: [],
  fixture: () => {
    const d = H.mkBacklog({
      label: 'exitfix-stray', files: EPIC, tombstones: ['EPIC-001'],
    });
    H.writeRaw(d, 'tasks/.nj-tmp-4242-deadbeef', 'half a file\n');
    return d;
  },
  preExit: 0, fixExit: 0,
  preSet: ['backlog:stray_tmp:warning'], postSet: [],
  after: d => T.eq('the stray temp file is gone',
    JSON.stringify(H.listFiles(d, 'tasks')), '[]'),
});

/* THE case § 14's last sentence is about: "A warning that survives does not
 * raise the exit code."
 *
 * `unknown:status` is a WARNING that `--fix` must not touch — § 14's "never"
 * list opens with "guess status values" and closes with "overwrite an
 * existing value — even an invalid one; invalid existing values are
 * reported, not repaired". So the finding is still there afterwards and the
 * exit is still 0. An implementation that summed severities instead of
 * counting errors would return 2 here, and `[0, 2]` would not notice. */
scenario('unknown status survives --fix (warning stays, exit stays 0)', {
  /* Not a step that acted: step 5 writes status only "when missing" — it
   * is present, just invalid, and an invalid existing value is "reported,
   * not repaired" (§ 14) — through problems[], not fixed[]. */
  fixed: [],
  /* Not a declined step: step 5 fills status only "when missing". The
   * invalid value is "reported, not repaired" — through problems[]. */
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-unknownstatus',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'blocked-on-review',
        created: NOW, updated: NOW,
      }, epicBody('E')),
    },
    tombstones: ['EPIC-001'],
  }),
  preExit: 0, fixExit: 0,
  /* The warning survives § 14's "never guess status values" — same set
   * before and after, which is the whole point of this scenario. */
  preSet: ['unknown:status:warning'], postSet: ['unknown:status:warning'],
  after: (d, fix, post) => {
    T.contains('the invalid status was NOT overwritten',
      H.readInBacklog(d, 'epics/EPIC-001.md'), 'status: blocked-on-review');
    T.check('the warning is still reported after --fix',
      !!post.json && Array.isArray(post.json.problems) &&
      post.json.problems.some(p => p && p.code === 'unknown:status' && p.severity === 'warning'),
      JSON.stringify(post.json && post.json.problems));
  },
});

/* ================================================================== */
/* Exit 2 — an error finding survives, because § 14 forbids the repair */
/* ================================================================== */

/* § 14's "never" list: "resolve duplicate IDs". `duplicate_id` is an ERROR. */
scenario('duplicate id survives (error, exit 2)', {
  /* § 14's "never" list: "resolve duplicate IDs" — no step acts. */
  fixed: [],
  /* Step 2 declines for TSK-002.md: its rename target TSK-001.md exists. */
  notes: [['TSK-002.md']],
  fixture: () => H.mkBacklog({
    label: 'exitfix-dupe',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'One',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('One')),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Two',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('Two')),
    }),
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  }),
  preExit: 2, fixExit: 2,
  /* Two files share TSK-001, so `duplicate_id` (error) applies to both; and
   * TSK-002.md carrying `id: TSK-001` is additionally `id:mismatch` (error).
   * AMBIGUOUS: § 7 does not say whether `duplicate_id` is reported once for
   * the clash or once per participating file. Reading used: per file, since
   * § 9 says element-level findings carry `element`. */
  preSet: ['duplicate_id:error', 'duplicate_id:error', 'id:mismatch:error'],
  postSet: ['duplicate_id:error', 'duplicate_id:error', 'id:mismatch:error'],
  after: d => T.eq('both files are still there — the duplicate was not resolved',
    JSON.stringify(H.listFiles(d, 'tasks')),
    JSON.stringify(['TSK-001.md', 'TSK-002.md'])),
});

/* § 14's "never" list: "invent parents". `parent:dangling` is an ERROR. */
scenario('dangling parent survives (error, exit 2)', {
  fixed: [],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-dangling',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-404', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
    tombstones: ['EPIC-001', 'TSK-001'],
  }),
  preExit: 2, fixExit: 2,
  preSet: ['parent:dangling:error'], postSet: ['parent:dangling:error'],
  after: d => T.contains('the parent was not invented',
    H.readInBacklog(d, 'tasks/TSK-001.md'), 'parent: EPIC-404'),
});

/* `depends_on:dangling` is an ERROR and is not among the eight steps. */
scenario('dangling depends_on survives (error, exit 2)', {
  /* depends_on:dangling is not one of the eight steps. */
  fixed: [],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-dep',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', depends_on: '[TSK-404]', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
    tombstones: ['EPIC-001', 'TSK-001'],
  }),
  preExit: 2, fixExit: 2,
  preSet: ['depends_on:dangling:error'], postSet: ['depends_on:dangling:error'],
});

/* `archive:not_done` is an ERROR (§ 11's "archived ⇒ done" invariant) and is
 * not among the eight steps — § 14 must not silently flip a status to make
 * the archive consistent. */
scenario('archive:not_done survives (error, exit 2)', {
  fixed: [],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-archnotdone',
    files: {
      'archive/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
        created: NOW, updated: NOW, archived: NOW,
      }, epicBody('E')),
    },
    tombstones: ['EPIC-001'],
  }),
  preExit: 2, fixExit: 2,
  preSet: ['archive:not_done:error'], postSet: ['archive:not_done:error'],
  after: d => T.contains('the status was not flipped to done',
    H.readInBacklog(d, 'archive/EPIC-001.md'), 'status: todo'),
});

/* § 5 / § 14: `config:invalid` is a backlog-level ERROR and is not one of the
 * eight repair steps — `doctor` is the only command that runs at all here,
 * and it must still report 2 after `--fix`. */
scenario('invalid config survives (error, exit 2)', {
  /* config:invalid is not one of the eight steps. */
  fixed: [],
  notes: [],
  fixture: () => H.mkBacklog({
    label: 'exitfix-badconfig', files: EPIC, tombstones: ['EPIC-001'],
    /* `done` is not the last entry — § 5's positions are load-bearing. */
    config: JSON.stringify({ schema: 1, statuses: ['todo', 'done', 'doing'] }) + '\n',
  }),
  preExit: 2, fixExit: 2,
  /* TWO findings, not one: the fixture's config violates § 5 twice — `done`
   * is not the last status, and `sections` is absent entirely (the override
   * replaces the harness default rather than extending it). § 14 has doctor
   * report "the defect", and two defects are two findings that happen to
   * share a code.
   *
   * AMBIGUOUS: § 7 labels `config:invalid` "backlog-level", which could also
   * be read as one finding per backlog no matter how many § 5 rules are
   * broken. Reading used: one per violation — it is the one that keeps the
   * count informative, and § 14's summary counts findings, not codes. */
  preSet: ['config:invalid:error', 'config:invalid:error'],
  postSet: ['config:invalid:error', 'config:invalid:error'],
});

/* § 14 step 2 is conditional: the rename happens "when frontmatter and file
 * name disagree **and the target is free**". Here it is not, so the step
 * cannot run.
 *
 * The exit is over-determined and deliberately not claimed otherwise: two
 * files carry `TSK-002`, so `duplicate_id` is an ERROR here on its own and
 * would force exit 2 even if step 2 had never been conditional. That is
 * unavoidable — occupying a rename target with a valid element necessarily
 * duplicates its id. The exit code therefore proves little on its own; the
 * `after` assertions below carry the actual content of this case, by showing
 * the step *declined* rather than overwrote. */
scenario('id mismatch, target occupied (step 2 declines, exit 2)', {
  /* Step 2 DECLINES (§ 14: "only when ... the target is free") — a decline
   * is a note, not a fixed[] entry: the step took no action. */
  fixed: [],
  /* Step 2 declines for TSK-001.md: its rename target TSK-002.md exists. */
  notes: [['TSK-001.md']],
  fixture: () => H.mkBacklog({
    label: 'exitfix-occupied',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Claimant',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('Claimant')),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Occupant',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('Occupant')),
    }),
    tombstones: ['EPIC-001', 'TSK-002'],
  }),
  preExit: 2, fixExit: 2,
  /* Same shape as the duplicate-id scenario: both files carry TSK-002, and
   * TSK-001.md's name disagrees with its frontmatter id. */
  preSet: ['duplicate_id:error', 'duplicate_id:error', 'id:mismatch:error'],
  postSet: ['duplicate_id:error', 'duplicate_id:error', 'id:mismatch:error'],
  after: d => {
    /* The isolating assertion: the rename did NOT happen. Without it the
     * scenario would also pass if `--fix` had overwritten the occupant —
     * which would destroy an element file to satisfy a rename. */
    T.eq('neither file was renamed away',
      JSON.stringify(H.listFiles(d, 'tasks')),
      JSON.stringify(['TSK-001.md', 'TSK-002.md']));
    T.contains('the occupant is untouched',
      H.readInBacklog(d, 'tasks/TSK-002.md'), 'title: Occupant');
  },
});

/* ================================================================== */
/* Step order — § 14's own justification, made observable              */
/* ================================================================== */

/* § 14: "the tombstone backfill claims the **frontmatter** `id`, so it must
 * run after the rename, or it would claim the wrong number while the right
 * one stays unprotected."
 *
 * `tasks/TSK-005.md` carrying `id: TSK-009`, with no tombstones at all. Both
 * findings are ERRORs (`id:mismatch`, `backlog:ids_missing`) and both are
 * repairable, so the exit is 0 — but the *evidence* is which tombstone
 * exists afterwards. Step 4 before step 2 would leave `.nanojira/ids/TSK-005`: the
 * wrong number claimed, TSK-009 free for reuse, and § 8's never-reuse
 * guarantee quietly void. The exit code alone cannot see that, which is why
 * it is asserted separately. */
scenario('tombstone backfill runs after the rename (step 4 after step 2)', {
  /* Step 2 acted (rename TSK-005 -> TSK-009), then step 4 (both the freshly
   * renamed element and the pre-existing gap needed tombstones) — § 14's
   * own ordering rule, made observable a second way alongside the `after`
   * assertion below. */
  fixed: [['TSK-005.md', 'TSK-009.md'], ['tombstone']],
  /* `.nanojira/ids/` empty = § 8's case. Two types are unclaimed and there is still
   * ONE report: § 8 says `--fix` "reports that" the guarantee is void. */
  notes: [['never-reuse']],
  /* mkBacklog creates `.nanojira/ids/` empty when no tombstones are given — which is
   * itself `backlog:ids_missing`, the second (repairable) error here. */
  fixture: () => H.mkBacklog({
    label: 'exitfix-order',
    files: Object.assign({}, EPIC, {
      'tasks/TSK-005.md': H.element({
        id: 'TSK-009', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, taskBody('T')),
    }),
  }),
  preExit: 2, fixExit: 0,
  /* `.nanojira/ids/` is empty while elements exist (`backlog:ids_missing`, error),
   * TSK-005.md carries TSK-009 (`id:mismatch`, error), and neither element
   * is claimed (`id:no_tombstone` ×2, warning) — same co-occurrence reading
   * as the `.nanojira/ids/`-lost scenario above. */
  preSet: ['backlog:ids_missing:error', 'id:mismatch:error',
    'id:no_tombstone:warning', 'id:no_tombstone:warning'],
  postSet: [],
  after: d => {
    T.check('the file carries its frontmatter id',
      H.existsInBacklog(d, 'tasks/TSK-009.md') && !H.existsInBacklog(d, 'tasks/TSK-005.md'),
      JSON.stringify(H.listFiles(d, 'tasks')));
    T.eq('the tombstone claims the frontmatter id, not the old file name',
      JSON.stringify(idsOf(d)), JSON.stringify(['EPIC-001', 'TSK-009']));
  },
});

T.finish();
