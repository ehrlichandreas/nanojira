'use strict';
/* AC-3 — Fault tolerance.
 *
 * § 15.3: "**Fault tolerance.** The § 7 table is played through file by file:
 * every variant loads, carries the exact code from the closed vocabulary, and
 * the rest of the backlog keeps working."
 *
 * Every case is one hand-written backlog holding ONE malformed element plus
 * ONE healthy element (see `healthyEpic()`). For each case we assert, from
 * `nj list --json` only:
 *
 *   - the malformed entry carries exactly the one expected code in _problems,
 *   - counts.total still includes both elements,
 *   - the healthy entry loads with an empty _problems,
 *   - `nj doctor` exits per the "Doctor" column of § 7 (2 for error, 0 for
 *     warning and for the `—` codes, which are never findings), and
 *     `doctor --json` carries the code with the matching `severity`,
 *   - `list --ready` follows the "Blocks --ready" column.
 *
 * Fixtures are hand-built with mkBacklog (§ 7 fixtures must not be produced by
 * the code path they verify).
 */
const H = require('../lib/harness.js');
const T = H.T;
const fs = require('fs');
const path = require('path');

const C = H.FIXED_NOW;

/* ---- fixture helpers --------------------------------------------------- */

const bodyOf = t => '# ' + t + '\n\n## Description\nDo the thing.\n\n' +
  '## Acceptance Criteria\n- [ ] It works\n';

/** The healthy element every case shares: a complete, ready epic. */
function healthyEpic() {
  return {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Platform', status: 'todo',
      created: C, updated: C,
    }, '# Platform\n\n## Description\nGroundwork for everything.\n'),
  };
}

const BASE_TASK = {
  id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Login route',
  status: 'todo', created: C, updated: C,
};

function taskFields(over, drop) {
  const f = Object.assign({}, BASE_TASK, over || {});
  for (const k of drop || []) delete f[k];
  return f;
}

/** One malformed task file at tasks/TSK-001.md. */
function badTask(over, drop, body) {
  const f = taskFields(over, drop);
  return { 'tasks/TSK-001.md': H.element(f, body === undefined ? bodyOf(f.title) : body) };
}

function file(rel, fields, body) {
  const o = {};
  o[rel] = H.element(fields, body);
  return o;
}

const DEFAULT_TOMBSTONES = ['EPIC-001', 'TSK-001', 'SUB-001'];

function sortedCodes(e) {
  return (e && Array.isArray(e._problems)) ? e._problems.slice().sort().join(',') : null;
}

function entriesOf(r) { return (r.json && Array.isArray(r.json.entries)) ? r.json.entries : []; }

/* ---- the § 7 table, one line per code ---------------------------------- */
/*
 * The closed vocabulary is 28 distinct codes spread over 27 table rows — the
 * `missing:created` / `missing:updated` row names two, and `duplicate_id` and
 * `active_refs_archived` carry no `:`/`.` so a pattern-based count misses them.
 *
 * Not in the table, deliberately:
 *   parent:cycle   — a cycle can only be built from task→task parents, which
 *                    is a `parent:hierarchy` violation at the same time; § 7
 *                    does not pin which of the two codes (or both) appear.
 *   duplicate_id   — needs two files on the same id, so it cannot have the
 *                    "one malformed + one healthy" shape; covered below.
 *   archive:*      — need archive placement, and archive:split may sit on
 *                    either side of the split; covered below with --all.
 *   backlog:*, config:invalid — backlog-level, not element-level (§ 7).
 *
 * AMBIGUOUS: the order inside `_problems` is not pinned — codes are compared
 * as a sorted set throughout.
 *
 * AMBIGUOUS: `list --ready --json` is read as returning the ready elements
 * only, because § 9 defines "ready" as a property of the element. The § 9
 * human example prints an extra "Complete first:" block for blocked elements;
 * an implementation that also returned those in `entries` (marked by their
 * blocking codes) would be defensible and is not distinguished here.
 */
const CASES = [
  // --- Doctor = error, blocks --ready ------------------------------------
  { code: 'frontmatter:unreadable', doctor: 2, blocks: true, relaxed: true,
    // The § 7 condition is "frontmatter block cannot be parsed": the block opens
    // with `---` and is never closed, so nothing in it can be trusted.
    // AMBIGUOUS (AMBIGUITIES.md #9): which *further* codes such a block produces
    // (id:derived, missing:title, missing:status, parent:orphaned, …) is not
    // pinned. The containment check above therefore stays as the spec-derived
    // assertion.
    //
    // `also` exists so the set-equality check below can still run: without it
    // this row would be the one hole left in the file, and the blindness this
    // conversion removes would survive exactly here. The two extra codes are
    // NOT a derivation — they are the reading currently in force, recorded so
    // a ruling on #9 becomes a one-line edit instead of a hunt. Both are at
    // least consistent with § 7 ("the readable lines stay in use"): with the
    // block unclosed, `title` is unreachable (missing:title, error) and so is
    // `parent` on a task (parent:orphaned, warning).
    also: ['missing:title:error', 'parent:orphaned:warning'],
    // The bad-*line* variant inside an otherwise parsable block is unpinned
    // as well and is covered by edge/frontmatter-grammar.js.
    bad: { 'tasks/TSK-001.md':
      '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: Login route\n' +
      'status: todo\ncreated: ' + C + '\nupdated: ' + C + '\n\n' + bodyOf('Login route') } },

  { code: 'missing:title', doctor: 2, blocks: true,
    // The body carries no H1: with an empty title an H1 could also be read as
    // `title:h1_mismatch` drift, which § 7 does not pin.
    bad: badTask({}, ['title'],
      '## Description\nDo the thing.\n\n## Acceptance Criteria\n- [ ] It works\n') },

  { code: 'id:mismatch', doctor: 2, blocks: true,
    // AMBIGUOUS: whether the tombstone check follows the frontmatter id or the
    // file name is not pinned; both numbers are tombstoned so the case isolates
    // id:mismatch.
    bad: badTask({ id: 'TSK-002' }),
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002', 'SUB-001'] },

  { code: 'type:folder', doctor: 2, blocks: true,
    // A task in the epics folder: wrong under either reading of § 14 step 3
    // (the `type` field says task, the id prefix says TSK, the folder says
    // epic).
    bad: file('epics/TSK-001.md', taskFields(), bodyOf('Login route')) },

  { code: 'parent:dangling', doctor: 2, blocks: true,
    bad: badTask({ parent: 'EPIC-999' }) },

  { code: 'parent:hierarchy', doctor: 2, blocks: true, twoSided: true, badId: 'SUB-001',
    // § 6: epic → task → subtask; a subtask under an epic is not three levels.
    // AMBIGUOUS: this violation is visible from both ends — the subtask has a
    // wrong-typed parent, the epic has a wrong-typed child — and § 7 does not
    // say which side carries the code. That is why this case relaxes the
    // "exactly one malformed entry" invariant (AMBIGUITIES.md #17).
    bad: file('subtasks/SUB-001.md', {
      id: 'SUB-001', type: 'subtask', parent: 'EPIC-001', title: 'Login route',
      status: 'todo', created: C, updated: C,
    }, bodyOf('Login route')) },

  { code: 'depends_on:dangling', doctor: 2, blocks: true,
    bad: badTask({ depends_on: '[TSK-999]' }) },

  // --- Doctor = warning, --ready blocked ---------------------------------
  { code: 'unknown:status', doctor: 0, blocks: true,
    bad: badTask({ status: 'waiting' }) },

  { code: 'done:open_children', doctor: 0, blocks: true, total: 3,
    bad: badTask({ status: 'done' }),
    extra: file('subtasks/SUB-001.md', {
      id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Login route details',
      status: 'todo', created: C, updated: C,
    }, bodyOf('Login route details')) },

  // --- Doctor = warning, --ready unaffected ------------------------------
  { code: 'missing:status', doctor: 0, blocks: false, bad: badTask({}, ['status']) },
  { code: 'missing:created', doctor: 0, blocks: false, bad: badTask({}, ['created']) },
  { code: 'missing:updated', doctor: 0, blocks: false, bad: badTask({}, ['updated']) },
  { code: 'id:derived', doctor: 0, blocks: false, bad: badTask({}, ['id']) },
  { code: 'type:derived', doctor: 0, blocks: false, bad: badTask({}, ['type']) },
  { code: 'parent:orphaned', doctor: 0, blocks: false, bad: badTask({}, ['parent']) },
  { code: 'title:h1_mismatch', doctor: 0, blocks: false,
    bad: badTask({}, [], '# Stale heading\n\n## Description\nDo the thing.\n\n' +
      '## Acceptance Criteria\n- [ ] It works\n') },
  { code: 'id:no_tombstone', doctor: 0, blocks: false,
    // .ids/ stays non-empty (the epic keeps its tombstone), so this is not
    // also backlog:ids_missing.
    bad: badTask({}), tombstones: ['EPIC-001', 'SUB-001'] },

  // --- Doctor = —, never a finding, --ready blocked ----------------------
  { code: 'incomplete:description', doctor: 0, blocks: true, finding: false,
    bad: badTask({}, [], '# Login route\n\n## Acceptance Criteria\n- [ ] It works\n') },
  { code: 'incomplete:acceptance', doctor: 0, blocks: true, finding: false,
    bad: badTask({}, [], '# Login route\n\n## Description\nDo the thing.\n') },
];

for (const c of CASES) {
  const name = c.code;
  const total = c.total || 2;
  const d = H.mkBacklog({
    label: 'ac03-' + name.replace(/:/g, '-'),
    files: Object.assign({}, healthyEpic(), c.bad, c.extra || {}),
    tombstones: c.tombstones || DEFAULT_TOMBSTONES,
  });

  const r = H.runJson(['list'], { cwd: d });
  T.exit(name + ' — list --json', r, 0);
  const entries = entriesOf(r);
  const bad = entries.filter(e => Array.isArray(e._problems) && e._problems.length > 0);
  const clean = entries.filter(e => Array.isArray(e._problems) && e._problems.length === 0);

  T.check(name + ' — counts.total still loads the whole backlog',
    !!r.json && !!r.json.counts && r.json.counts.total === total,
    'expected total ' + total + ', got ' + JSON.stringify(r.json && r.json.counts));
  if (c.twoSided) {
    // See AMBIGUITIES.md #17: the code may land on the violating child, on the
    // parent, or on both. Assert the violator and that nothing else is lost;
    // do not pin the distribution.
    const violator = entries.find(e => e.id === c.badId);
    T.check(name + ' — the violating element carries the code',
      !!violator && sortedCodes(violator) === name,
      'expected [' + name + '] on ' + c.badId + ', got ' +
      JSON.stringify(violator && violator._problems));
    T.check(name + ' — the whole backlog still loads', entries.length === total,
      'entries: ' + entries.map(e => e.id).join(','));
  } else {
    T.check(name + ' — exactly one entry is malformed', bad.length === 1,
      JSON.stringify(entries.map(e => [e.id, e._problems])));
    if (c.relaxed) {
      // This code's condition does not pin the codes that accompany it (see the
      // case for the reason); the healthy element is still the only clean one.
      T.check(name + ' — the malformed entry carries the code',
        bad.length === 1 && Array.isArray(bad[0]._problems) &&
        bad[0]._problems.indexOf(name) >= 0,
        'expected ' + name + ' among ' +
        JSON.stringify(bad.length === 1 ? bad[0]._problems : null));
    } else {
      T.check(name + ' — _problems carry exactly this code',
        bad.length === 1 && sortedCodes(bad[0]) === name,
        'expected [' + name + ']\n     got      ' +
        JSON.stringify(bad.length === 1 ? sortedCodes(bad[0]) : null));
    }
    T.check(name + ' — the healthy element still loads clean', clean.length === total - 1,
      'clean entries: ' + clean.map(e => e.id).join(',') + ' of ' + total);
  }
  // AMBIGUOUS (AMBIGUITIES.md #11): whether counts.errors counts elements at
  // Error level or findings is not pinned; the assertion below (≥1 / ===0)
  // holds under either reading.
  T.check(name + ' — counts.errors follows the Doctor column',
    !!r.json && !!r.json.counts &&
    (c.doctor === 2 ? r.json.counts.errors >= 1 : r.json.counts.errors === 0),
    'counts: ' + JSON.stringify(r.json && r.json.counts));

  const dj = H.runJson(['doctor'], { cwd: d });
  T.exit(name + ' — doctor exits per the Doctor column', dj, c.doctor === 2 ? 2 : 0);
  T.check(name + ' — doctor --json ok flag', !!dj.json && dj.json.ok === (c.doctor === 0),
    'ok: ' + JSON.stringify(dj.json && dj.json.ok));
  const probs = (dj.json && Array.isArray(dj.json.problems)) ? dj.json.problems : [];
  const mine = probs.filter(p => p && p.code === name);
  if (c.finding === false) {
    T.check(name + ' — is never a doctor finding (§ 7 Doctor column is "—")',
      dj.json !== null && mine.length === 0,
      'problems: ' + JSON.stringify(probs.map(p => p.code)));
  } else {
    T.check(name + ' — doctor reports the code with the right severity',
      mine.length >= 1 && mine.every(p => p.severity === (c.doctor === 2 ? 'error' : 'warning')),
      'problems: ' + JSON.stringify(probs));
  }

  /* Set equality over the WHOLE finding list, not just this row's code.
   *
   * The containment checks above are what a blindness matrix caught: a mutant
   * appending one spurious `title:h1_mismatch` warning alongside real findings
   * scored 21 hits in this file and left it green, because `mine` filters to
   * the row's own code and never looks at what else came back. The expected
   * set is § 7's Doctor column for the row (a `—` row contributes nothing),
   * plus `also` where the fixture unavoidably satisfies a second condition —
   * each one justified at the row. */
  const expected = (c.finding === false ? [] :
    [name + ':' + (c.doctor === 2 ? 'error' : 'warning')]).concat(c.also || []);
  T.sameSet(name + ' — the findings are exactly § 7\'s set for this fixture',
    H.doctorSet(dj) || ['<no problems array>'], expected);

  const rd = H.runJson(['list', '--ready'], { cwd: d });
  T.exit(name + ' — list --ready', rd, 0);
  const readyIds = new Set(entriesOf(rd).map(e => e.id));
  if (!c.twoSided) {
    T.check(name + ' — the healthy element is ready', readyIds.has('EPIC-001'),
      'ready: ' + Array.from(readyIds).join(','));
  }
  // For a two-sided violation the parent may legitimately carry the code as
  // well, so it is not asserted to be ready; the violating element's exclusion
  // is asserted below in both shapes.
  const badId = c.badId || (bad.length === 1 ? bad[0].id : null);
  T.check(name + ' — the malformed element ' +
    (c.blocks ? 'is kept out of' : 'stays in') + ' --ready',
    badId !== null && (c.blocks ? !readyIds.has(badId) : readyIds.has(badId)),
    'element ' + badId + ', ready: ' + Array.from(readyIds).join(','));
}

/* ---- duplicate_id: two files on one ID (§ 9) --------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac03-duplicate',
    files: Object.assign({}, healthyEpic(), {
      'tasks/TSK-001.md': H.element(taskFields({ title: 'First' }), bodyOf('First')),
      'tasks/TSK-002.md': H.element(taskFields({ id: 'TSK-001', title: 'Second' }),
        bodyOf('Second')),
    }),
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });

  const r = H.runJson(['list'], { cwd: d });
  T.exit('duplicate_id — list --json', r, 0);
  const entries = entriesOf(r);
  const dupes = entries.filter(e => Array.isArray(e._problems) &&
    e._problems.indexOf('duplicate_id') >= 0);
  T.check('duplicate_id — reads show both entries marked', dupes.length === 2,
    JSON.stringify(entries.map(e => [e.id, e.title, e._problems])));
  T.check('duplicate_id — counts.total includes both',
    !!r.json && !!r.json.counts && r.json.counts.total === 3,
    JSON.stringify(r.json && r.json.counts));
  T.check('duplicate_id — the unrelated element stays clean',
    entries.some(e => e.id === 'EPIC-001' && Array.isArray(e._problems) &&
      e._problems.length === 0));
  // AMBIGUOUS: tasks/TSK-002.md cannot be named after the ID it claims without
  // colliding with the other file, so it necessarily also carries id:mismatch.
  // § 7 does not say whether that is suppressed for a duplicate; only
  // duplicate_id is asserted.

  T.exit('duplicate_id — doctor exit', H.runJson(['doctor'], { cwd: d }), 2);

  const backlogPath = (r.json && r.json.backlog) || path.join(d, 'backlog');
  const f1 = path.join(backlogPath, 'tasks', 'TSK-001.md');
  const f2 = path.join(backlogPath, 'tasks', 'TSK-002.md');
  const before = H.sha256(fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md')));
  const w = H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  T.exit('duplicate_id — writes refuse (§ 9)', w, 1);
  T.contains('duplicate_id — the refusal names the first absolute path', w.stdout + w.stderr, f1);
  T.contains('duplicate_id — the refusal names the second absolute path', w.stdout + w.stderr, f2);
  T.check('duplicate_id — nothing was written',
    H.sha256(fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'))) === before);
}

/* ---- depends_on:cycle -------------------------------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac03-dep-cycle',
    files: Object.assign({}, healthyEpic(), {
      'tasks/TSK-001.md': H.element(taskFields({ depends_on: '[TSK-002]' }),
        bodyOf('Login route')),
      'tasks/TSK-002.md': H.element(taskFields({ id: 'TSK-002', title: 'Registration',
        depends_on: '[TSK-001]' }), bodyOf('Registration')),
    }),
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });

  // Short timeouts: a cycle that spins forever must fail loudly, not hang.
  const r = H.runJson(['list'], { cwd: d, timeout: 20000 });
  T.exit('depends_on:cycle — list --json terminates', r, 0);
  const entries = entriesOf(r);
  const codes = new Set();
  for (const e of entries) {
    for (const c of (Array.isArray(e._problems) ? e._problems : [])) codes.add(c);
  }
  T.check('depends_on:cycle — the cycle is reported', codes.has('depends_on:cycle'),
    JSON.stringify(entries.map(e => [e.id, e._problems])));
  // AMBIGUOUS: whether one or every participating element carries the code is
  // not pinned; presence, the doctor exit and the --ready effect are asserted.
  T.check('depends_on:cycle — the healthy element stays clean',
    entries.some(e => e.id === 'EPIC-001' && Array.isArray(e._problems) &&
      e._problems.length === 0));

  const rd = H.runJson(['list', '--ready'], { cwd: d, timeout: 20000 });
  T.exit('depends_on:cycle — list --ready terminates', rd, 0);
  const readyIds = new Set(entriesOf(rd).map(e => e.id));
  T.check('depends_on:cycle — neither participant is ready',
    !readyIds.has('TSK-001') && !readyIds.has('TSK-002'),
    'ready: ' + Array.from(readyIds).join(','));
  T.check('depends_on:cycle — the healthy element is unaffected', readyIds.has('EPIC-001'));

  T.exit('depends_on:cycle — doctor exit',
    H.runJson(['doctor'], { cwd: d, timeout: 20000 }), 2);
}

/* ---- archive rules (§ 11): archive:not_done --------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac03-arch-notdone',
    files: Object.assign({}, healthyEpic(), {
      'archive/EPIC-002.md': H.element({
        id: 'EPIC-002', type: 'epic', title: 'Half finished', status: 'doing',
        created: C, updated: C, archived: C,
      }, '# Half finished\n\n## Description\nStill going.\n'),
    }),
    tombstones: ['EPIC-001', 'EPIC-002'],
  });

  const plain = H.runJson(['list'], { cwd: d });
  T.exit('archive:not_done — list --json', plain, 0);
  T.check('archive:not_done — hidden from list without --all',
    entriesOf(plain).every(e => e.id !== 'EPIC-002'),
    JSON.stringify(entriesOf(plain).map(e => e.id)));

  const r = H.runJson(['list', '--all'], { cwd: d });
  T.exit('archive:not_done — list --all --json', r, 0);
  const entries = entriesOf(r);
  const e = entries.find(x => x.id === 'EPIC-002');
  T.check('archive:not_done — the archived element carries the code',
    sortedCodes(e) === 'archive:not_done', JSON.stringify(e && e._problems));
  T.check('archive:not_done — the active element stays clean',
    entries.some(x => x.id === 'EPIC-001' && Array.isArray(x._problems) &&
      x._problems.length === 0));
  T.exit('archive:not_done — doctor exit', H.runJson(['doctor'], { cwd: d }), 2);
}

/* ---- archive rules (§ 11): archive:split ------------------------------- */

{
  const d = H.mkBacklog({
    label: 'ac03-arch-split',
    files: Object.assign({}, healthyEpic(), {
      'archive/EPIC-002.md': H.element({
        id: 'EPIC-002', type: 'epic', title: 'Shipped', status: 'done',
        created: C, updated: C, archived: C,
      }, '# Shipped\n\n## Description\nDone long ago.\n'),
      'tasks/TSK-005.md': H.element({
        id: 'TSK-005', type: 'task', parent: 'EPIC-002', title: 'Left behind',
        status: 'done', created: C, updated: C,
      }, bodyOf('Left behind')),
    }),
    tombstones: ['EPIC-001', 'EPIC-002', 'TSK-005'],
  });

  const r = H.runJson(['list', '--all'], { cwd: d });
  T.exit('archive:split — list --all --json', r, 0);
  const entries = entriesOf(r);
  const codes = new Set();
  for (const e of entries) {
    for (const c of (Array.isArray(e._problems) ? e._problems : [])) codes.add(c);
  }
  T.check('archive:split — the split is reported', codes.has('archive:split'),
    JSON.stringify(entries.map(e => [e.id, e._problems])));
  // AMBIGUOUS: whether the code lands on the archived parent, on the outside
  // child, or on both is not pinned; only its presence is asserted. (Same
  // two-sided shape as AMBIGUITIES.md #17, where the distribution is relaxed.)
  T.check('archive:split — the unrelated element stays clean',
    entries.some(e => e.id === 'EPIC-001' && Array.isArray(e._problems) &&
      e._problems.length === 0));
  T.exit('archive:split — doctor exit', H.runJson(['doctor'], { cwd: d }), 2);
}

T.finish();
