/* AC-20 — Section writes.
 *
 * § 15.20: "**Section writes.** `nj new`/`nj set` accept
 * `--description`/`--acceptance` (inline, `--…-file=<path>`, or `-` for
 * stdin) and write the configured section, so a CLI-created element becomes
 * complete and appears in `--ready`. Replacing and emptying follow § 9's
 * byte rule; unknown sections and `## Notes` stay untouched; `updated` is
 * refreshed; supplying both value forms for one role (or `-` for both
 * roles) is rejected with nothing written. Without the section flags,
 * `nj new`'s scaffold stays byte-identical to the AC-2 fixture."
 *
 * § 9's "Section writes" bullet pins the byte-level rules (heading = first
 * configured name for the role, replace-not-append, LF/no-BOM/trailing-
 * newline-stripped normalisation, insertion order, the EOF-merge rule for a
 * section that ends the file). Every byte-level reading below is a quotation
 * from that bullet (§ 9 lines 468–500): first matching heading wins (l. 491),
 * content + one blank line as one rule for mid-body and EOF (l. 481–484,
 * 493–497), no-H1 insertion after any leading blank lines (l. 486–487), an
 * unreadable `--<role>-file` is `not_found` (l. 492), a rejected invocation
 * writes nothing — tombstones included (l. 477–478, § 15.20 l. 991–992), and
 * `changed` lists exactly what changed (§ 15.13 l. 965, § 9 l. 489).
 * `DECISIONS.md` is NOT a source for any expectation in this file.
 */
import * as H from '../lib/harness.ts';
const T = H.T;
import fs from 'fs';
import path from 'path';
import * as MCP from '../lib/mcp-stdio.ts';

H.requireNjMcp();

const C = H.FIXED_NOW;
const LATER = H.LATER_NOW;

const J = (x: unknown) => JSON.stringify(x);
const taskPath = (d: string) => path.join(d, 'backlog', 'tasks', 'TSK-001.md');
const epicPath = (d: string) => path.join(d, 'backlog', 'epics', 'EPIC-001.md');

function mkTask(label: string, body: string) {
  return H.mkBacklog({
    label,
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend API Endpoints',
        status: 'todo', created: C, updated: C,
      }, body),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
}

/* ---- 1. nj new: inline sections fill the scaffold, element becomes complete --- */

{
  const d = H.freshDir('ac20-new');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);

  const r = H.runJson(['new', '--type=task', '--parent=EPIC-001',
    '--title=Backend API Endpoints',
    '--description=Create /login and /register.',
    '--acceptance=- [ ] Password at least 8 characters'], { cwd: d });
  T.exit('new task with --description and --acceptance', r, 0);
  T.goldenEq('new task with sections == golden', taskPath(d), 'new-task-sections.md');

  T.check('changed includes description', r.json && (r.json.changed || []).includes('description'),
    J(r.json && r.json.changed));
  T.check('changed includes acceptance', r.json && (r.json.changed || []).includes('acceptance'),
    J(r.json && r.json.changed));

  const list = H.runJson(['list'], { cwd: d });
  const entry = (list.json && list.json.entries || []).find((e: any) => e.id === 'TSK-001');
  T.eq('a CLI-created element with both sections carries no _problems',
    (entry && entry._problems || []).slice().sort().join(','), '');

  const ready = H.runJson(['list', '--ready'], { cwd: d });
  T.check('the CLI-created element appears in --ready',
    (ready.json && ready.json.entries || []).some((e: any) => e.id === 'TSK-001'),
    J(ready.json && ready.json.entries));
}

/* ---- 2. insertion: three positions, each pinned by § 9 / DECISIONS.md ------ */

{
  /* acceptance is inserted before an existing ## Notes; Description, the
   * unknown ## Other section, and Notes stay byte-for-byte untouched.
   *
   * The ## Other section is deliberate, not decorative: with Notes sitting
   * directly after Description, § 9's "before ## Notes" and its fallback
   * "else after description" land on the SAME index, so a fixture without a
   * section in between cannot tell the two rules apart — an implementation
   * that dropped the Notes branch entirely would still pass. Putting ## Other
   * between them forces the two readings apart:
   *   before Notes (§ 9, correct): Description, Other, Acceptance, Notes
   *   after description (wrong fallback only): Description, Acceptance, Other, Notes
   */
  const d = mkTask('ac20-ins-notes',
    '# Backend API Endpoints\n\n## Description\nCreate the endpoint.\n\n' +
    '## Other\nUnrelated content, untouched.\n\n' +
    '## Notes\n- ' + C + ' coder-agent: existing note\n');
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] It works'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance inserts before an existing ## Notes', r, 0);
  T.goldenEq('acceptance before Notes (not merely after description), Description/Other/Notes untouched == golden',
    taskPath(d), 'set-section-insert-with-notes.md');

  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  const order = ['## Description', '## Other', '## Acceptance Criteria', '## Notes'].map(h => bytes.indexOf(h));
  T.check('the four headings appear in that exact order (rules out the after-description fallback)',
    order.every((pos, i) => pos !== -1 && (i === 0 || pos > order[i - 1])), J(order));
}

{
  /* Notes present, NO Description section at all (moved here from
   * edge/state-note-appears-once, TSK-049; it closed a gap in the insert
   * rule). § 9: acceptance is inserted "before ## Notes when present" --
   * full stop, not "before Notes, provided a description section also
   * exists". If the insertion point falls back to "after description" (not
   * found) or "at the end" instead of the Notes anchor, acceptance lands
   * after Notes. The fixture must not already carry an `## Acceptance
   * Criteria` section -- with one present, `set --acceptance` replaces it in
   * place and the insertion-point logic asserted here never runs at all. */
  const d = H.mkBacklog({
    label: 'ac20-ins-notes-no-description',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: C, updated: C,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Notes, no description',
        status: 'todo', created: C, updated: C,
      }, '# Notes, no description\n\n## Notes\n' +
        '- 2026-09-20T10:00:00Z human: Pre-existing finding\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const rs = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] Criterion'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance on a body with Notes but no Description', rs, 0);

  const body = fs.readFileSync(taskPath(d), 'utf8');
  const lines = body.split('\n');
  T.eq('## Notes still appears exactly once', lines.filter((l) => l === '## Notes').length, 1);
  T.contains('the acceptance section was written', body, '## Acceptance Criteria');
  T.contains('the pre-existing note survived', body, 'Pre-existing finding');
  T.check('no ## Description section was invented',
    !body.includes('## Description'), JSON.stringify(body));

  const accIdx = lines.indexOf('## Acceptance Criteria');
  const notesIdx = lines.indexOf('## Notes');
  T.check('acceptance sits before ## Notes even with no ## Description at all',
    accIdx >= 0 && notesIdx >= 0 && accIdx < notesIdx,
    'acceptance at ' + accIdx + ', notes at ' + notesIdx);
}

{
  /* § 9 l. 486–487: "`description` after the H1 block (or at the start of the
   * body when there is no H1, after any leading blank lines)" — not glued onto
   * the closing frontmatter '---'. */
  const d = mkTask('ac20-ins-noh1', '## Acceptance Criteria\n- [ ] x\n');
  const r = H.runNj(['set', '--id=TSK-001', '--description=Filled in.'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description on a body with no H1', r, 0);
  T.goldenEq('description inserted at body start (no H1) == golden',
    taskPath(d), 'set-section-insert-no-h1.md');
}

{
  /* acceptance inserted after description when nothing else follows — the
   * insertion also lands at EOF, so this doubles as the EOF-merge check
   * (§ 9: the separating blank line and the file's one trailing newline are
   * the same newline). */
  const d = H.mkBacklog({
    label: 'ac20-ins-after-desc',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Task',
        status: 'todo', created: C, updated: C,
      }, '# Task\n\n## Description\nFilled already.\n'),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] Done'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance inserts after description at end of body', r, 0);
  T.goldenEq('acceptance inserted after description == golden',
    taskPath(d), 'set-section-insert-after-description.md');

  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.check('the file ends with exactly one trailing newline, never a blank line',
    bytes.endsWith('\n') && !bytes.endsWith('\n\n'), J(bytes.slice(-20)));
}

{
  /* § 9 l. 491: "If several headings match one role, the **first** match
   * wins." The second is left byte-for-byte alone (l. 488–489). */
  const d = mkTask('ac20-dup-heading',
    '# Backend API Endpoints\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [ ] first heading content\n\n' +
    '## Acceptance Criteria\n- [ ] second heading content\n');
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] replaced'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance targets only the first of two matching headings', r, 0);
  T.goldenEq('first heading replaced, second untouched == golden',
    taskPath(d), 'set-section-duplicate-heading.md');

  /* § 7 l. 280–283: a section is present when its heading has at least one
   * non-empty line below it — the FIRST heading, just replaced, now has one.
   * This fixture says nothing about whether the untouched second heading
   * would count on its own (first empty, second filled): that case is pinned
   * by no passage and by no fixture — see AMBIGUITIES.md / TSK-016. */
  const list = H.runJson(['list'], { cwd: d });
  const e = (list.json && list.json.entries || []).find((x: any) => x.id === 'TSK-001');
  T.check('the element is complete (both headings still read as acceptance)',
    !(e && e._problems || []).includes('incomplete:acceptance'), J(e && e._problems));
}

{
  /* § 9: "the heading written is the first name configured for that role" —
   * even when a later alias is configured too, insertion writes the first one. */
  const d = H.mkBacklog({
    label: 'ac20-heading-alias',
    config: JSON.stringify({
      schema: 1,
      statuses: ['todo', 'doing', 'done'],
      sections: {
        description: ['Description'],
        acceptance: ['Acceptance Criteria', 'Akzeptanzkriterien'],
      },
    }, null, 2) + '\n',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
        status: 'todo', created: C, updated: C,
      }, '# Endpoint\n\n## Description\nD\n'),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] x'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance inserts a fresh heading', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the first configured alias is written, not the second',
    bytes, '## Acceptance Criteria\n- [ ] x');
  T.check('the second alias name was not written',
    !bytes.includes('## Akzeptanzkriterien'), JSON.stringify(bytes));
}

/* ---- 3. replace and empty, unknown sections stay untouched ----------------- */

{
  const d = mkTask('ac20-replace',
    '# Backend API Endpoints\n\n## Description\nOld description.\nSecond line of old description.\n\n' +
    '## Acceptance Criteria\n- [ ] It works\n\n## Rollout\nDo not touch this section.\n');
  const before = H.sha256(fs.readFileSync(taskPath(d)));
  const r = H.runNj(['set', '--id=TSK-001', '--description=New description text.'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description replaces existing content', r, 0);
  T.goldenEq('replace == golden (Acceptance/Rollout untouched)', taskPath(d), 'set-section-replace.md');
  T.check('the checksum actually changed (non-vacuity control)',
    H.sha256(fs.readFileSync(taskPath(d))) !== before, 'the file did not change');
}

{
  const d = mkTask('ac20-empty',
    '# Backend API Endpoints\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [ ] It works\n\n## Rollout\nKeep this.\n');
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance='], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance= (empty) empties the section', r, 0);
  T.goldenEq('emptied section == golden (scaffold-empty shape, Rollout untouched)',
    taskPath(d), 'set-section-empty.md');

  const list = H.runJson(['list'], { cwd: d });
  const e = (list.json && list.json.entries || []).find((x: any) => x.id === 'TSK-001');
  T.check('an emptied acceptance section counts as incomplete',
    (e && e._problems || []).includes('incomplete:acceptance'), J(e && e._problems));
}

/* ---- 4. inline / file / stdin are the same value source, byte-equivalent -- */

{
  const CONTENT = 'Line one.\nLine two.';

  const dInline = mkTask('ac20-src-inline',
    '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  T.exit('inline --description', H.runNj(['set', '--id=TSK-001', '--description=' + CONTENT],
    { cwd: dInline, env: { NJ_NOW: LATER } }), 0);

  const dFile = mkTask('ac20-src-file',
    '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  const srcFile = path.join(H.freshDir('ac20-src-file-content'), 'description.txt');
  // UTF-8 BOM, CRLF and trailing blank lines: all three must normalise away
  // (§ 9: "normalised to LF, without BOM, trailing newlines stripped").
  fs.writeFileSync(srcFile, String.fromCharCode(0xFEFF) + 'Line one.\r\nLine two.\r\n\r\n\r\n');
  T.exit('--description-file=<path>', H.runNj(['set', '--id=TSK-001', '--description-file=' + srcFile],
    { cwd: dFile, env: { NJ_NOW: LATER } }), 0);

  const dStdin = mkTask('ac20-src-stdin',
    '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  T.exit('--description-file=- (stdin)', H.runNj(['set', '--id=TSK-001', '--description-file=-'],
    { cwd: dStdin, env: { NJ_NOW: LATER }, input: 'Line one.\nLine two.\n\n\n' }), 0);

  const inlineBytes = fs.readFileSync(taskPath(dInline), 'utf8');
  const fileBytes = fs.readFileSync(taskPath(dFile), 'utf8');
  const stdinBytes = fs.readFileSync(taskPath(dStdin), 'utf8');

  T.eq('file source == inline bytes (CRLF normalised, trailing newlines stripped)', fileBytes, inlineBytes);
  T.eq('stdin source == inline bytes (trailing newlines stripped)', stdinBytes, inlineBytes);
  T.contains('the content landed under the Description heading', inlineBytes,
    '## Description\nLine one.\nLine two.\n\n## Acceptance Criteria');
}

{
  /* § 9 l. 492: "A `--<role>-file` path that cannot be read is `not_found`,
   * matching `--file`." */
  const d = mkTask('ac20-file-missing',
    '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  const before = H.sha256(fs.readFileSync(taskPath(d)));
  const r = H.runJson(['set', '--id=TSK-001', '--description-file=' + path.join(d, 'nope.txt')], { cwd: d });
  T.exit('an unreadable --description-file is rejected', r, 1);
  T.eq('the error code is not_found', r.json && r.json.error, 'not_found');
  T.check('the file is unchanged', H.sha256(fs.readFileSync(taskPath(d))) === before, 'checksum changed');
}

/* ---- 5. mutual exclusion: both forms, or '-' for both roles --------------- */

{
  const d = mkTask('ac20-mutex',
    '# Endpoint\n\n## Description\nOriginal.\n\n## Acceptance Criteria\n- [ ] x\n');
  const before = H.sha256(fs.readFileSync(taskPath(d)));

  const r1 = H.runJson(['set', '--id=TSK-001', '--description=A', '--description-file=' + taskPath(d)],
    { cwd: d });
  T.exit('both value forms for one role is rejected', r1, 1);
  T.eq('the error code is invalid_value (both forms)', r1.json && r1.json.error, 'invalid_value');
  T.check('nothing was written (both forms)',
    H.sha256(fs.readFileSync(taskPath(d))) === before, 'checksum changed');

  const r2 = H.runJson(['set', '--id=TSK-001', '--description-file=-', '--acceptance-file=-'], { cwd: d });
  T.exit('"-" for both roles in one invocation is rejected', r2, 1);
  T.eq('the error code is invalid_value ("-" for both roles)', r2.json && r2.json.error, 'invalid_value');
  T.check('nothing was written ("-" for both roles)',
    H.sha256(fs.readFileSync(taskPath(d))) === before, 'checksum changed');
}

{
  /* § 9 l. 477–478 and § 15.20 l. 991–992: a rejected invocation is "rejected
   * … with nothing written" — read here as including the tombstone in .nanojira/ids/,
   * which is a written file. The spec states no validate-before-allocate
   * order in so many words; the corpus records the .nanojira/ids/ listing per call. */
  const d = H.freshDir('ac20-mutex-new');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);

  const r = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Nope',
    '--description=A', '--description-file=' + epicPath(d)], { cwd: d });
  T.exit('nj new with both value forms for one role is rejected', r, 1);
  T.eq('the error code is invalid_value', r.json && r.json.error, 'invalid_value');
  T.eq('no task file was written', H.listFiles(d, 'tasks').join(','), '');

  const ok = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Real'], { cwd: d });
  T.exit('a following legitimate new succeeds', ok, 0);
  T.eq('it claims TSK-001 — the rejected attempt burned no tombstone', ok.json && ok.json.id, 'TSK-001');
}

/* ---- 6. `changed`: § 15.13 l. 965 "lists exactly the fields that changed",
 * § 9 l. 489 "changed names the role" — set reports a role only when bytes
 * differ. Whether a no-op set also leaves `updated` untouched is NOT decided
 * by the spec (AMBIGUITIES.md 13); that half is held byte-exact by the S0
 * corpus (scratch:r6.js) and is deliberately not asserted here. ------------ */

{
  const d = mkTask('ac20-changed',
    '# Endpoint\n\n## Description\nOriginal text.\n\n## Acceptance Criteria\n- [ ] x\n');

  const r1 = H.runJson(['set', '--id=TSK-001', '--description=Original text.'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description=<identical text>', r1, 0);
  T.eq('changed is empty for a no-op section write', r1.json && r1.json.changed, []);

  const r2 = H.runJson(['set', '--id=TSK-001', '--description=Different text.'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description=<different text>', r2, 0);
  T.eq('changed lists exactly ["description"]', r2.json && r2.json.changed, ['description']);
  T.contains('updated was bumped by the real write', fs.readFileSync(taskPath(d), 'utf8'), 'updated: ' + LATER);
}

/* ---- 6b. atomic write: a section write goes through the same guarded path - */

{
  /* § 12's NJ_FAULT=after-tmp-write hook; fault/nj-fault-points.js already
   * covers both injection points in depth for the generic write path — this
   * checks only that a *section* write is not special-cased around it. The
   * compare-before-write race (NJ_FAULT=before-compare) compares full file
   * content regardless of which field changed, so it is covered generically
   * there too and is not duplicated here. */
  const d = mkTask('ac20-fault',
    '# Endpoint\n\n## Description\nOriginal.\n\n## Acceptance Criteria\n- [ ] x\n');
  const before = fs.readFileSync(taskPath(d), 'utf8');

  const r = H.runNj(['set', '--id=TSK-001', '--description=New text'],
    { cwd: d, env: { NJ_FAULT: 'after-tmp-write', NJ_NOW: LATER } });
  T.exit('NJ_FAULT=after-tmp-write aborts a section write', r, 1);

  const after = fs.readFileSync(taskPath(d), 'utf8');
  T.eq('the target file is byte-identical to before', H.sha256(after), H.sha256(before));

  const tmp = fs.readdirSync(path.dirname(taskPath(d))).filter(f => f.startsWith('.nj-tmp-'));
  T.check('one temp file survives, holding the new content',
    tmp.length === 1 && fs.readFileSync(path.join(path.dirname(taskPath(d)), tmp[0]), 'utf8')
      .includes('New text'), JSON.stringify(tmp));
}

/* ---- 7. ready / _problems: the end-to-end point of AC-20 ------------------ */

{
  const d = H.freshDir('ac20-ready');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  H.runNj(['new', '--type=epic', '--title=Auth', '--description=Groundwork.'], { cwd: d });
  T.exit('new task without sections', H.runNj(['new', '--type=task', '--parent=EPIC-001',
    '--title=Login route'], { cwd: d }), 0);

  const before = H.runJson(['list'], { cwd: d });
  const eBefore = (before.json && before.json.entries || []).find((e: any) => e.id === 'TSK-001');
  T.check('a freshly scaffolded task is incomplete',
    (eBefore && eBefore._problems || []).includes('incomplete:description') &&
    (eBefore && eBefore._problems || []).includes('incomplete:acceptance'),
    J(eBefore && eBefore._problems));

  const readyBefore = H.runJson(['list', '--ready'], { cwd: d });
  T.check('it is excluded from --ready before the sections are filled',
    !(readyBefore.json && readyBefore.json.entries || []).some((e: any) => e.id === 'TSK-001'),
    J(readyBefore.json && readyBefore.json.entries));

  const r = H.runNj(['set', '--id=TSK-001', '--description=Do the thing.',
    '--acceptance=- [ ] It works'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set fills both sections', r, 0);

  const after = H.runJson(['list'], { cwd: d });
  const eAfter = (after.json && after.json.entries || []).find((e: any) => e.id === 'TSK-001');
  T.eq('the element now carries no _problems',
    (eAfter && eAfter._problems || []).slice().sort().join(','), '');

  const readyAfter = H.runJson(['list', '--ready'], { cwd: d });
  T.check('it now appears in --ready',
    (readyAfter.json && readyAfter.json.entries || []).some((e: any) => e.id === 'TSK-001'),
    J(readyAfter.json && readyAfter.json.entries));
}

/* ---- 8. scaffold unchanged: no section flags == the AC-2 fixture ---------- */

{
  const d = H.freshDir('ac20-scaffold');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic (no section flags)', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.goldenEq('new epic scaffold unchanged == golden', epicPath(d), 'new-epic.md');

  T.exit('new task (no section flags)', H.runNj(['new', '--type=task', '--parent=EPIC-001',
    '--title=Backend API Endpoints'], { cwd: d }), 0);
  T.goldenEq('new task scaffold unchanged == golden', taskPath(d), 'new-task.md');
}

/* ---- 9. refused:open_fence (TSK-053 v2, DECISIONS 233): a write's        */
/*         RESULTING body never leaves a fence open at a section boundary   */
/*         or EOF -- checked whole-body, not per-span (Scout MUST).         */

const openFenceBody = '# Backend API Endpoints\n\n## Description\nIntro.\n\n```\n' +
  '## Looks like a heading\nmore\n```\n\nAfter fence.\n\n## Acceptance Criteria\n- [ ] keep me\n';

// A single opener with no matching closer anywhere in Description's own
// span (unlike openFenceBody, which has a closer paired with a fake-heading
// opener -- splicing that one out leaves the orphaned closer behind acting
// as a NEW opener). Here, splicing the span removes the only delimiter,
// so the result is genuinely clean: the repair path this fixture tests.
const singleOpenFenceBody = '# Backend API Endpoints\n\n## Description\nIntro.\n\n```\n' +
  'never closes\n\n## Acceptance Criteria\n- [ ] keep me\n';

{
  // Description's own span ends at the next heading-matching line,
  // regardless of fence state (§ 7, line-based `sectionEnd`); here that
  // heading is Acceptance Criteria itself, so replacing the span removes
  // the lone unclosed opener along with it -- the result is clean, and
  // this repair must succeed.
  const d = mkTask('ac20-open-fence-repair', singleOpenFenceBody);
  const r = H.runJson(['set', '--id=TSK-001', '--description=New description.'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description replaces the broken span: exit 0 (repair path)', r, 0);
  T.eq('Description replaced as usual', r.json && r.json.entry && r.json.entry.id, 'TSK-001');
}

{
  // Scout MUST: a write that does NOT touch Description (only Acceptance)
  // leaves Description's own open fence in the result -- `check`'s
  // continuous, never-reset-at-sections scan would then treat the new
  // Acceptance content as still inside that fence. The whole-body check
  // must catch this even though Acceptance's own span has no local problem.
  const d = mkTask('ac20-open-fence-elsewhere-acceptance', openFenceBody);
  const before = fs.readFileSync(taskPath(d), 'utf8');

  const r = H.runJson(['set', '--id=TSK-001', '--add-acceptance=another'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('--add-acceptance while Description has an open fence: exit 1', r, 1);
  T.eq('refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  T.eq('nothing written: file is byte-identical to before', fs.readFileSync(taskPath(d), 'utf8'), before);

  const r2 = H.runJson(['set', '--id=TSK-001', '--acceptance=- [ ] replaced'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('--acceptance (full replace) same file: exit 1', r2, 1);
  T.eq('--acceptance: refused:open_fence too', r2.json && r2.json.error, 'refused:open_fence');
  T.eq('--acceptance: nothing written either', fs.readFileSync(taskPath(d), 'utf8'), before);
}

{
  // Same fence-truncation pattern, but in the Acceptance section itself.
  const body = '# Backend API Endpoints\n\n## Description\nIntro.\n\n' +
    '## Acceptance Criteria\n- [ ] keep me\n\n```\n## Looks like a heading\nmore\n```\n\nAfter fence.\n';
  const d = mkTask('ac20-open-fence-acceptance', body);
  const before = fs.readFileSync(taskPath(d), 'utf8');

  const r = H.runJson(['set', '--id=TSK-001', '--add-acceptance=another'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('--add-acceptance on a fence-truncated Acceptance: exit 1', r, 1);
  T.eq('--add-acceptance: refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  T.eq('--add-acceptance: nothing written', fs.readFileSync(taskPath(d), 'utf8'), before);
}

{
  // Review MUST #1: new content the write ITSELF supplies can open the
  // fence -- not just an old span's orphan. One-shot `new` with a
  // `--description` whose own value never closes its fence must refuse
  // before the file is ever created.
  const d = H.freshDir('ac20-open-fence-new-description');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('new epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);

  const r = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=One shot',
    '--description=unclosed\n```\nfence never closes',
    '--acceptance=- [ ] item one'], { cwd: d });
  T.exit('new with a self-opening Description fence: exit 1', r, 1);
  T.eq('refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  T.eq('no task file created', fs.existsSync(taskPath(d)), false);
}

{
  // Scout's batch case: both ids' Acceptance sections are locally fine, but
  // TSK-001's Description already has an open fence -- the whole-body check
  // must still catch it, and the batch's existing all-or-nothing contract
  // (DECISIONS 215) must leave TSK-002 untouched too.
  const d = H.mkBacklog({
    label: 'ac20-open-fence-batch',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Broken', status: 'todo', created: C, updated: C,
      }, openFenceBody),
      'tasks/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Clean', status: 'todo', created: C, updated: C,
      }, '# Clean\n\n## Description\nFine.\n\n## Acceptance Criteria\n- [ ] item one\n'),
    },
    tombstones: ['TSK-001', 'TSK-002', 'EPIC-001'],
  });
  const beforeClean = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-002.md'), 'utf8');

  const r = H.runJson(['set', '--id=TSK-001,TSK-002', '--add-acceptance=new box'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('batch add-acceptance, one id has an open fence elsewhere: exit 1', r, 1);
  T.eq('batch overall not ok', r.json && r.json.ok, false);
  T.eq('TSK-001 refused:open_fence', r.json && r.json.results && r.json.results[0] && r.json.results[0].error, 'refused:open_fence');
  T.eq('TSK-002 (clean sibling) left untouched too -- all-or-nothing',
    fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-002.md'), 'utf8'), beforeClean);
}

{
  // `note` builds and writes body text too (§ 10) -- it must run the same
  // whole-body check before appending under `## Notes`.
  const d = mkTask('ac20-open-fence-note', openFenceBody);
  const before = fs.readFileSync(taskPath(d), 'utf8');
  const r = H.runJson(['note', '--id=TSK-001', 'a note'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('note on a file with an open fence: exit 1', r, 1);
  T.eq('note: refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  T.eq('note: nothing written', fs.readFileSync(taskPath(d), 'utf8'), before);
}

{
  // Frontmatter-only writes (status/tags/claim/check) never rebuild section
  // text, so they stay unaffected even on a file with an open fence.
  const d = mkTask('ac20-open-fence-frontmatter-unaffected', openFenceBody);
  const r = H.runJson(['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('--status on a file with an open fence: exit 0 (frontmatter-only)', r, 0);
  const r2 = H.runJson(['check', '--id=TSK-001', '--item=1'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('check --item on a file with an open fence: exit 0 (frontmatter-only)', r2, 0);
}

{
  // Same shape, but the fence is closed before Description's real end:
  // no refusal.
  const body = '# Backend API Endpoints\n\n## Description\nIntro.\n\n```\nan example\n```\n\nAfter fence.\n\n' +
    '## Acceptance Criteria\n- [ ] keep me\n';
  const d = mkTask('ac20-closed-fence-description', body);
  const r = H.runJson(['set', '--id=TSK-001', '--description=New description.'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description with a properly closed fence: exit 0 (unaffected)', r, 0);
  T.eq('Description replaced as usual', r.json && r.json.entry && r.json.entry.id, 'TSK-001');
}

/* ---- false-refusal controls: every clean fence shape still succeeds ---- */

const fenceControls: Array<[string, string]> = [
  ['closed tilde', 'a\n~~~\ncode\n~~~\nb'],
  ['4-backtick open/close (contains a bare ``` inside)', 'a\n````\ncode with ``` inside\n````\nb'],
  ['indented fence', 'a\n   ```\n   code\n   ```\nb'],
  ['info-string fence', 'a\n```ts\ncode\n```\nb'],
  ['fence opened+closed entirely inside the section', 'a\n```\ncode\n```\nmore text b'],
];
for (const [label, descText] of fenceControls) {
  const body = `# Backend API Endpoints\n\n## Description\n${descText}\n\n## Acceptance Criteria\n- [ ] keep me\n`;
  const d = mkTask(`ac20-fence-control-${label.replace(/[^a-z0-9]+/gi, '-')}`, body);
  const r = H.runJson(['set', '--id=TSK-001', '--add-acceptance=x'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit(`false-refusal control (${label}): exit 0`, r, 0);
}

{
  // CRLF line endings: a closed fence is unaffected, an unclosed one still refuses.
  const closed = '# T\r\n\r\n## Description\r\na\r\n```\r\ncode\r\n```\r\nb\r\n\r\n## Acceptance Criteria\r\n- [ ] keep me\r\n';
  const d1 = mkTask('ac20-crlf-closed', closed);
  const r1 = H.runJson(['set', '--id=TSK-001', '--add-acceptance=x'], { cwd: d1, env: { NJ_NOW: LATER } });
  T.exit('CRLF closed fence: exit 0', r1, 0);

  const unclosed = '# T\r\n\r\n## Description\r\na\r\n```\r\ncode never closes\r\n\r\n## Acceptance Criteria\r\n- [ ] keep me\r\n';
  const d2 = mkTask('ac20-crlf-unclosed', unclosed);
  const r2 = H.runJson(['set', '--id=TSK-001', '--add-acceptance=x'], { cwd: d2, env: { NJ_NOW: LATER } });
  T.exit('CRLF unclosed fence: exit 1', r2, 1);
  T.eq('CRLF unclosed: refused:open_fence', r2.json && r2.json.error, 'refused:open_fence');
}

{
  // Compat: older nanojira wrote note text with no fence validation at all,
  // so a backlog already on disk can have a Notes entry with an unclosed
  // fence trailing to end of file. `## Notes` is always the body's last
  // section, so nothing with real content follows one left open there --
  // this must NOT start refusing unrelated writes after upgrading.
  const body = '# T\n\n## Description\nFine.\n\n## Acceptance Criteria\n- [ ] keep me\n\n' +
    '## Notes\n- 2026-01-01T00:00:00Z alice: example\n```\nnever closed, written before this check existed\n';
  const d1 = mkTask('ac20-legacy-note-fence-description', body);
  const r1 = H.runJson(['set', '--id=TSK-001', '--description=New.'], { cwd: d1, env: { NJ_NOW: LATER } });
  T.exit('compat: set --description with a legacy unclosed Notes fence: exit 0', r1, 0);

  const d2 = mkTask('ac20-legacy-note-fence-acceptance', body);
  const r2 = H.runJson(['set', '--id=TSK-001', '--add-acceptance=more'], { cwd: d2, env: { NJ_NOW: LATER } });
  T.exit('compat: --add-acceptance with a legacy unclosed Notes fence: exit 0', r2, 0);

  const d3 = mkTask('ac20-legacy-note-fence-note', body);
  const r3 = H.runJson(['note', '--id=TSK-001', 'another note'], { cwd: d3, env: { NJ_NOW: LATER } });
  T.exit('compat: note with a legacy unclosed Notes fence: exit 0', r3, 0);
}

{
  // The Notes-EOF compat exemption is narrow: it only excuses a fence that
  // opens INSIDE Notes and trails to EOF, never one that opens BEFORE Notes
  // and is still open when the ## Notes heading itself is reached. A fix
  // that widened the exemption to "any fence open at/entering Notes" would
  // wrongly let this one through too. `## Notes` is the very next heading
  // after the opener here (nothing else in between), and the write is
  // `note` -- it only appends under the existing `## Notes`, inserting no
  // heading of its own before it -- so only the widened-exemption mutant,
  // not an unrelated inserted heading, could make this pass.
  const body = '# T\n\n## Description\nFine.\n```\nnever closed before Notes\n\n' +
    '## Notes\n- 2026-01-01T00:00:00Z alice: existing note\n';
  const d = mkTask('ac20-fence-before-notes-still-refused', body);
  const before = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  const r = H.runJson(['note', '--id=TSK-001', 'another note'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('fence opened before ## Notes, open at the Notes heading: exit 1', r, 1);
  T.eq('fence before Notes: refused:open_fence', r.json && r.json.error, 'refused:open_fence');
  const got = fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8');
  T.eq('fence before Notes: nothing written -- file is byte-identical to before', got, before);
}

/* ---- MCP: the cross-section refusal (Description broken, Acceptance    */
/*      write) surfaces through tools/call the same as the CLI            */
(async () => {
  const dir = H.freshDir('ac20-mcp-open-fence');
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: LATER };
  H.runNj(['init', '--backlog=' + bl], { cwd: dir, env, unsetEnv: ['NJ_BACKLOG'] });
  H.runNj(['new', '--backlog=' + bl, '--type=epic', '--title=E', '--description=D.'],
    { cwd: dir, env, unsetEnv: ['NJ_BACKLOG'] });
  const taskFile = path.join(bl, 'tasks', 'TSK-001.md');
  H.runNj(['new', '--backlog=' + bl, '--type=task', '--parent=EPIC-001', '--title=T',
    '--acceptance=- [ ] keep me'], { cwd: dir, env, unsetEnv: ['NJ_BACKLOG'] });
  const raw = fs.readFileSync(taskFile, 'utf8');
  const brokenDescription = 'Intro.\n\n```\n## Looks like a heading\nmore\n```\n\nAfter fence.\n\n';
  fs.writeFileSync(taskFile, raw.replace('## Description\n\n', '## Description\n' + brokenDescription));

  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + bl], { cwd: dir, env });
  try {
    const r = await s.modernToolsCall('set', { id: 'TSK-001', 'add-acceptance': 'another' });
    T.check('MCP: no protocol-level error', !r.error, JSON.stringify(r.error));
    T.check('MCP: isError is true (open_fence surfaces through tools/call)',
      r.result && r.result.isError === true, JSON.stringify(r.result));
    const content = r.result && r.result.structuredContent;
    T.eq('MCP: the cross-section refusal is refused:open_fence', content && content.error, 'refused:open_fence');
  } finally {
    await s.close();
  }
  T.finish();
})();
