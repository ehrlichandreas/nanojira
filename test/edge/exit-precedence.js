'use strict';
/* Error precedence — which failure wins when several apply at once (§ 4,
 * § 5, § 9, § 11).
 *
 * WHY THIS IS ITS OWN FILE.
 *
 * Every other failure test in the suite builds a fixture with exactly one
 * thing wrong. Real backlogs are not like that, and neither is the code: a
 * refusal, a resolution failure and an argument error can all apply to one
 * invocation, and the agent branches on whichever code comes back. Reorder
 * two checks in a refactor and the exit code stays 1, the write still does
 * not happen, every existing test stays green — and the agent is told
 * `not_found` where the spec says `refused:unreadable`, so it creates a
 * replacement element instead of repairing a stub.
 *
 * THE DISCIPLINE THIS FILE USES.
 *
 * A precedence question only has a testable answer where the spec ordered
 * the two checks. Where it did not, guessing would freeze the current build
 * order into the oracle — the exact failure mode the briefing warns about,
 * since the refactor would then be verified against itself. So:
 *
 *   - Ordered by the spec  → the winning code is asserted, one value.
 *   - Not ordered          → reported as an open question; only the part the
 *                            spec *does* decide is asserted, namely exit 1
 *                            and that the backlog is byte-identical
 *                            afterwards ("nothing is written", § 9/AC-6).
 *
 * Every scenario also carries a **control**: the same command with the
 * higher-priority condition removed, asserting the code that then wins.
 * Without it a tool that always answered `refused:unreadable` would pass the
 * whole first section.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const NOW = H.FIXED_NOW;
const p = (d, rel) => path.join(d, 'backlog', rel);
const body = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
const epicBody = t => '# ' + t + '\n\n## Description\nD\n';

/** Every file under backlog/, checksummed — "nothing is written", literally. */
function backlogSums(d) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of H.lsOrEmpty(abs)) {
      const child = path.join(abs, name);
      const childRel = rel ? rel + '/' + name : name;
      let st;
      try { st = fs.lstatSync(child); } catch (e) { continue; }
      if (st.isDirectory()) walk(child, childRel);
      else if (st.isSymbolicLink()) out[childRel] = 'symlink:' + fs.readlinkSync(child);
      else {
        const content = H.readOrNull(child);
        out[childRel] = H.sha256(content === null ? '\u0000' : content);
      }
    }
  };
  walk(path.join(d, 'backlog'), '');
  return out;
}

/**
 * Run a command that must fail, assert the code, and assert that the whole
 * backlog is byte-identical afterwards.
 *
 * `code` is a single string where the spec ordered the checks, and `null`
 * where it did not — in which case only the unordered part is asserted.
 */
function refuses(desc, d, args, code, opts) {
  const before = backlogSums(d);
  const r = H.runJson(args, Object.assign({ cwd: d, env: { NJ_NOW: H.LATER_NOW } }, opts || {}));

  T.exit(desc + ' — exits 1', r, 1);
  if (code === null) {
    /* Unordered by the spec: the code is an open question, so only the
     * envelope is pinned. Deliberately NOT an either/or over two codes. */
    T.check(desc + ' — the code is a string (mapping unpinned, see report)',
      !!r.json && typeof r.json.error === 'string', JSON.stringify(r.json));
  } else {
    T.eq(desc + ' — the code is ' + code, r.json && r.json.error, code);
  }
  T.eq(desc + ' — nothing was written', JSON.stringify(backlogSums(d)), JSON.stringify(before));
  return r;
}

/* ================================================================== */
/* 1. The stub guard runs before the target is resolved (§ 9)          */
/* ================================================================== */

/* § 9 states the order outright, and states the reason:
 *
 *   "The guard is a property of the **backlog**, not of the addressed
 *    element, so it is evaluated **before the target is resolved**: while a
 *    stub exists, even a `--id` that names nothing yields
 *    `refused:unreadable`, not `not_found`."
 *
 * That last clause is the only precedence rule the spec spells out with an
 * example, and nothing asserted it. `edge/unreadable-stub-refusals.js`
 * drives `rm`/`archive` against *real* targets, which cannot distinguish
 * "guard first" from "guard after resolution" — both orders refuse.
 *
 * The fixture carries four different would-be winners so all four losers are
 * exercised against the same guard: a name that resolves to nothing, an
 * archived element, an element with children, and a not-done subtree. */
function stubbed(label, withStub) {
  const d = H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Open Epic', status: 'todo',
        created: NOW, updated: NOW,
      }, epicBody('Open Epic')),
      /* A child, so EPIC-001 is `refused:has_children` for `rm` and
       * `refused:not_done` for `archive`. */
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Child',
        status: 'todo', created: NOW, updated: NOW,
      }, body('Child')),
      'archive/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Shelved',
        status: 'done', created: NOW, updated: NOW, archived: NOW,
      }, body('Shelved')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });
  if (withStub) {
    /* § 7: `file:unreadable` — "element file cannot be read at all (dangling
     * symlink, permissions)". The symlink form is used for the same reason
     * `edge/unreadable-stub-refusals.js` uses it: a chmod fixture stops
     * testing anything when the suite runs as root. */
    fs.symlinkSync(path.join(d, 'no-such-target'), p(d, 'tasks/TSK-003.md'));
    fs.writeFileSync(p(d, '.ids/TSK-003'), '');
  }
  return d;
}

/* The four collisions. `loses` is the code the control must produce — it is
 * what the command would answer if the guard were not there, which is how
 * this file proves the guard is what decided. */
const STUB_CASES = [
  {
    name: 'a --id that names nothing',
    args: ['rm', '--id=TSK-909'],
    loses: 'not_found',            // § 9: "`--parent`, `--depends-on` or `--file` names nothing"
  },
  {
    name: 'an archived target',
    args: ['rm', '--id=TSK-002'],
    loses: 'refused:archived',     // § 9: archived elements are read-only
  },
  {
    name: 'a target with children',
    args: ['rm', '--id=EPIC-001'],
    loses: 'refused:has_children', // § 9: "`rm` refuses while child elements exist"
  },
  {
    name: 'an unfinished subtree',
    args: ['archive', '--id=EPIC-001'],
    loses: 'refused:not_done',     // § 11: the precondition
  },
];

for (const c of STUB_CASES) {
  const slug = c.name.replace(/[^a-z]+/gi, '-');

  /* With the stub: § 9's stated order says the guard wins, whatever the
   * target turns out to be. */
  refuses('stub present, ' + c.name + ' → the guard wins',
    stubbed('exitprec-stub-' + slug, true), c.args, 'refused:unreadable');

  /* The control. Same command, no stub — the target-level code must win, or
   * the assertion above proved nothing about ordering. */
  refuses('no stub, ' + c.name + ' → ' + c.loses + ' wins',
    stubbed('exitprec-nostub-' + slug, false), c.args, c.loses);
}

/* ================================================================== */
/* 2. An invalid configuration gates every non-doctor command (§ 5)    */
/* ================================================================== */

/* § 5: "An invalid configuration makes every command except `nj doctor`
 * fail with exit 1 and a pointer to `nj doctor`; `doctor` reports the defect
 * (exit 2)." § 9's table maps the condition to `invalid_config`.
 *
 * The cases below are the ones where the order is forced rather than merely
 * plausible: each competing check *needs the config or the backlog*, so it
 * cannot have run first. `--status` is validated "against the configured
 * statuses" (§ 9), and `--id` resolution needs the element files. An
 * argument-shape error such as a misspelled flag is NOT tested here — see
 * the open questions in the report. */
function badConfig(label) {
  return H.mkBacklog({
    label,
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, body('T')),
    },
    tombstones: ['TSK-001'],
    /* § 5: "The **last** entry must be `done`". */
    config: JSON.stringify({ schema: 1, statuses: ['todo', 'done', 'doing'] }) + '\n',
  });
}

{
  const d = badConfig('exitprec-badconfig');

  refuses('invalid config beats an invalid --status filter (both need the config)',
    d, ['list', '--status=nonexistent'], 'invalid_config');
  refuses('invalid config beats not_found (both need the backlog)',
    d, ['show', '--id=TSK-909'], 'invalid_config');
  refuses('invalid config beats a write on a real element',
    d, ['set', '--id=TSK-001', '--status=doing'], 'invalid_config');
  refuses('invalid config beats an invalid --status on a write',
    d, ['set', '--id=TSK-001', '--status=nonexistent'], 'invalid_config');

  /* The stated exception, and the other half of the rule: `doctor` is the one
   * command that still runs, and it reports the defect with exit 2. */
  const doc = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor is the exception and exits 2', doc, 2);
  T.check('doctor names config:invalid',
    !!doc.json && Array.isArray(doc.json.problems) &&
    doc.json.problems.some(pr => pr && pr.code === 'config:invalid' && pr.severity === 'error'),
    JSON.stringify(doc.json && doc.json.problems));
}

/* ================================================================== */
/* 3. Discovery runs before anything it would enable (§ 4)             */
/* ================================================================== */

/* § 4: "If a `backlog/` exists but `.nanojira.json` is missing, the error
 * says exactly that and points at `nj doctor` (which tolerates the missing
 * file and reports `config:invalid`) — never a plain 'no backlog found'."
 *
 * `edge/discovery-message.js` pins the message for `list`. The precedence
 * angle is different: the diagnosis must also beat a target-level failure,
 * and the parenthesis about `doctor` is itself a precedence exception that
 * nothing asserted. */
{
  const d = H.freshDir('exitprec-noconfig');
  fs.mkdirSync(path.join(d, 'backlog', 'tasks'), { recursive: true });
  const NO_ENV = { cwd: d, unsetEnv: ['NJ_BACKLOG'], env: { NJ_NOW: H.LATER_NOW } };

  for (const c of [
    { name: 'show of a name that could not resolve anyway', args: ['show', '--id=TSK-909'], pin: true },
    { name: 'a write', args: ['set', '--id=TSK-001', '--status=doing'], pin: true },
    /* An argument-shape error competing with discovery is NOT ordered by the
     * spec (see the report); only § 4's "never a plain 'no backlog found'"
     * is asserted for it. */
    { name: 'an unknown field flag', args: ['list', '--nonsense=1'], pin: false },
  ]) {
    const r = H.runJson(c.args, NO_ENV);
    T.exit('missing config, ' + c.name + ' — exits 1', r, 1);
    if (c.pin) {
      T.eq('missing config, ' + c.name + ' — the code is backlog_without_config',
        r.json && r.json.error, 'backlog_without_config');
    } else {
      T.check('missing config, ' + c.name + ' — never a plain no_backlog',
        !!r.json && r.json.error !== 'no_backlog', JSON.stringify(r.json));
    }
  }

  /* § 4's parenthesis, asserted: `doctor` tolerates the missing file. */
  const doc = H.runJson(['doctor'], NO_ENV);
  T.exit('doctor tolerates the missing config and exits 2', doc, 2);
  T.check('doctor reports it as config:invalid',
    !!doc.json && Array.isArray(doc.json.problems) &&
    doc.json.problems.some(pr => pr && pr.code === 'config:invalid'),
    JSON.stringify(doc.json && doc.json.problems));
}

/* ================================================================== */
/* 4. A control flag the command does not take (§ 9)                   */
/* ================================================================== */

/* § 9 gives this one as its own worked example:
 *
 *   "A control flag that the addressed command does not take is rejected the
 *    same way, as `unknown_field` (e.g. `nj archive --force`, § 12)."
 *
 * `edge/rm-and-archive-refusals.js` drives `archive --force` and asserts
 * exit 1 and that nothing moved, but not the code.
 *
 * UNPINNED WHERE A SECOND FAILURE COMPETES (lead ruling). An earlier revision
 * asserted `unknown_field` for the two collision cases as well, reading § 9's
 * "Unknown field flags are **rejected** — nothing is written" as putting the
 * flag check before execution. That reading is plausible but the spec does
 * not actually order the two checks, and pinning an unordered pair would
 * hand the oracle a rule the spec never made: a legitimate reordering of the
 * checks during the refactor would then turn red on correct behaviour. The
 * S0 corpus already covers what nj *does* — byte-identical against 2895
 * recorded invocations — so a silent change in which error wins is caught
 * there, without promoting an unstated order to spec law. Consistent with
 * the project's handling of `parent:hierarchy` (AMBIGUITIES 17).
 *
 * The clean case (no competing failure) stays pinned. */
{
  const notDone = label => H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Open', status: 'todo',
        created: NOW, updated: NOW,
      }, epicBody('Open')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Child',
        status: 'todo', created: NOW, updated: NOW,
      }, body('Child')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  /* AMBIGUOUS (ruled unpinned): `unknown_field` vs `refused:not_done`. The
   * flag is bogus AND the subtree is unfinished; § 9 and § 11 each define
   * their own code but neither orders the two checks. Envelope only. */
  refuses('`archive --force` on an unfinished subtree — two codes apply, order unstated',
    notDone('exitprec-af1'), ['archive', '--id=EPIC-001', '--force'], null);

  /* Control: without the flag there is only one failure left, and § 11 names
   * it — so this one IS pinned, and it is what makes the case above a
   * genuine collision rather than a single-fault run. */
  refuses('`archive` on the same subtree without the flag — refused:not_done',
    notDone('exitprec-af2'), ['archive', '--id=EPIC-001'], 'refused:not_done');

  /* AMBIGUOUS (ruled unpinned): `unknown_field` vs `not_found`. */
  refuses('`archive --force` on a name that resolves to nothing — two codes apply',
    notDone('exitprec-af3'), ['archive', '--id=EPIC-909', '--force'], null);
}

/* ================================================================== */
/* 5. `--id` together with `--file` (§ 9)                              */
/* ================================================================== */

/* § 9's normative table maps "`--id` and `--file` given together" to
 * `invalid_target`, with no condition attached — the two flags are
 * alternatives ("**instead of** `--id`"), so the conflict is a property of
 * the argument list and cannot depend on what either one resolves to. The
 * second case is the precedence claim: both name nothing, and the conflict
 * still wins over `not_found`. */
{
  const fixture = label => H.mkBacklog({
    label,
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, body('T')),
    },
    tombstones: ['TSK-001'],
  });

  refuses('--id and --file together, both valid — invalid_target',
    fixture('exitprec-if1'),
    ['set', '--id=TSK-001', '--file=tasks/TSK-001.md', '--status=doing'],
    'invalid_target');

  /* AMBIGUOUS (ruled unpinned): `invalid_target` vs `not_found`. The flags
   * conflict AND neither names an element. § 9's table gives the conflict a
   * code and gives "names nothing" a code, but does not say which check runs
   * first — so the code stays open here even though the case above pins it. */
  refuses('--id and --file together, both naming nothing — two codes apply',
    fixture('exitprec-if2'),
    ['set', '--id=TSK-909', '--file=tasks/TSK-909.md', '--status=doing'],
    null);

  /* Control: `--file` alone naming nothing is § 9's `not_found` row. */
  refuses('--file alone naming nothing — not_found',
    fixture('exitprec-if3'),
    ['set', '--file=tasks/TSK-909.md', '--status=doing'], 'not_found');
}

/* ================================================================== */
/* 6. Two value forms for one section role (§ 9)                       */
/* ================================================================== */

/* § 9: "Supplying both value forms for one role, or `-` for both roles in
 * one invocation, is rejected (`invalid_value`) with nothing written."
 *
 * `ac/ac-20-section-writes.js` covers that rejection with a *readable* file,
 * where no second failure competes — so the single-fault case is pinned here
 * too.
 *
 * UNPINNED WHERE A SECOND FAILURE COMPETES (lead ruling). An earlier revision
 * argued that "with nothing written" made the conflict a pre-execution check
 * that must beat the `not_found` of an unreadable `--<role>-file` path. That
 * argument does not hold: § 9 gives the unreadable-path case `not_found`
 * while it, too, writes nothing, so "nothing written" separates neither
 * check from the other and orders nothing. Envelope only. */
{
  const fixture = label => H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
        created: NOW, updated: NOW,
      }, epicBody('E')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T',
        status: 'todo', created: NOW, updated: NOW,
      }, body('T')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const missingPath = path.join('/', 'nonexistent-nj-fixture', 'description.txt');

  /* AMBIGUOUS (ruled unpinned): `invalid_value` vs `not_found`. Both value
   * forms are supplied AND the path is unreadable; § 9 names a code for each
   * and orders neither. */
  refuses('both value forms for one role, the file unreadable — two codes apply',
    fixture('exitprec-r1'),
    ['set', '--id=TSK-001', '--description=inline', '--description-file=' + missingPath],
    null);

  /* Control: the unreadable path alone is § 9's `not_found`. */
  refuses('an unreadable --description-file alone — not_found',
    fixture('exitprec-r2'),
    ['set', '--id=TSK-001', '--description-file=' + missingPath],
    'not_found');

  /* `-` for both roles, on `nj new` — nothing written means no element file
   * appears either. `input` is supplied so a tool that read stdin anyway
   * cannot hang the suite. */
  refuses('`-` for both roles — invalid_value, nothing written',
    fixture('exitprec-r3'),
    ['new', '--type=task', '--parent=EPIC-001', '--title=X',
      '--description-file=-', '--acceptance-file=-'],
    'invalid_value', { input: '' });
}

/* ================================================================== */
/* 7. Unfinished subtree AND an occupied move target                   */
/* ================================================================== */

/* AMBIGUOUS (ruled unpinned): `refused:not_done` vs `exists` vs
 * `duplicate_id`.
 *
 * An earlier revision pinned `refused:not_done`, reading § 11's wording as an
 * order: the done-check is introduced as a "**Precondition:**" while the
 * target check belongs to the move procedure ("All move targets are verified
 * before the first move"), and a precondition is what must hold before the
 * procedure is entered. That is a reasonable reading of an editorial heading,
 * but it is not a stated rule, and the fixture is over-determined anyway — an
 * occupant on an archive target necessarily shares its id with the live
 * element, so `duplicate_id` applies as a third candidate. Pinning one of
 * three codes that the spec never ranked would freeze today's check order.
 *
 * What is asserted instead is the part § 11 does decide and that holds under
 * every reading: the command fails, and it moves **nothing** — "A partially
 * executed archive is forbidden". The whole-backlog checksum in `refuses()`
 * carries that. */
{
  const collide = label => H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Open', status: 'todo',
        created: NOW, updated: NOW,
      }, epicBody('Open')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Child',
        status: 'todo', created: NOW, updated: NOW,
      }, body('Child')),
      /* A stale shelf copy sitting on the target the move would write. */
      'archive/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Stale',
        status: 'done', created: NOW, updated: NOW, archived: NOW,
      }, body('Stale')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  refuses('an unfinished subtree with an occupied target — fails, and moves nothing',
    collide('exitprec-notdone-exists'), ['archive', '--id=EPIC-001'], null);
}

T.finish();
