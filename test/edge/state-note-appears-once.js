'use strict';
/* Edge — the `## Notes` heading appears exactly once (§ 10, § 9 section
 * writes).
 *
 * § 10: "`## Notes` is created at the end of the body if absent... Consecutive
 * notes are consecutive lines directly below the heading — no blank lines
 * between them." That already implies the heading itself is written once,
 * on the first `nj note` call, and every later call must locate and append
 * below the *existing* heading rather than create a new one.
 *
 * § 9 raises the same requirement from a second direction: a `--acceptance`
 * (or `--description`) section write is inserted "before `## Notes` when
 * present, else after description, else at the end". A bug in that heading
 * search (e.g. anchoring on the literal end-of-body instead of the heading)
 * would produce a second `## Notes` block instead of reusing the first.
 *
 * Correction, not a test: section-insertion and note-appending do NOT in
 * fact agree on which heading is "the" `## Notes` when more than one is hand-
 * placed in the body — `sectionHeadingIndex` returns the *first* match
 * (`nj:346`), while `nj note`'s own search has no `break` and keeps the
 * *last* one seen (`nj:1394`). Two hand-set `## Notes` headings are
 * unreachable through the CLI alone (every write here keeps the count at
 * one), but § 7 makes the body the user's property, so a hand-edit can still
 * produce them — and then `nj note` and `set --acceptance` would target
 * different headings. Logged as `AMBIGUITIES.md` 30, not pinned by a test:
 * the spec does not say which of the two searches is right, so asserting
 * either one would pin a bug rather than the spec.
 *
 * Two risk points, both asserted here as an exact count of `## Notes` lines
 * in the body, never more than one:
 *   1. three consecutive `nj note` calls on a fresh element;
 *   2. an `--acceptance` write issued *after* notes already exist, which
 *      forces the insertion code to search past `## Notes`.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/** Count exact `## Notes` heading lines in a body. */
function countNotesHeadings(body) {
  return body.split('\n').filter(l => l === '## Notes').length;
}

/* ---- three notes on a fresh element: one heading, three lines ---------- */
{
  const d = H.mkBacklog({
    label: 'edge-note-once-fresh',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Noted',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Noted')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const p = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  for (const text of ['First finding', 'Second finding', 'Third finding']) {
    const r = H.runNj(['note', '--id=TSK-001', text], { cwd: d });
    T.exit('nj note "' + text + '" succeeds', r, 0);
  }

  const body = fs.readFileSync(p, 'utf8');
  T.eq('## Notes appears exactly once after three note calls',
    countNotesHeadings(body), 1);
  T.contains('the first note text is present', body, 'First finding');
  T.contains('the second note text is present', body, 'Second finding');
  T.contains('the third note text is present', body, 'Third finding');

  const lines = body.split('\n');
  const idx = lines.indexOf('## Notes');
  T.check('the three note lines sit directly below the heading, no blanks between',
    lines[idx + 1].includes('First finding') &&
    lines[idx + 2].includes('Second finding') &&
    lines[idx + 3].includes('Third finding'),
    JSON.stringify(lines.slice(idx, idx + 4)));
}

/* ---- notes already present (hand-placed), then more notes --------------- */
{
  const d = H.mkBacklog({
    label: 'edge-note-once-preexisting',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Pre-noted',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Pre-noted\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n\n' +
        '## Notes\n- 2026-09-20T10:00:00Z human: Earlier finding\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const p = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  const r1 = H.runNj(['note', '--id=TSK-001', 'New finding'], { cwd: d });
  T.exit('note on an element with a pre-existing ## Notes succeeds', r1, 0);

  const body1 = fs.readFileSync(p, 'utf8');
  T.eq('## Notes still appears exactly once', countNotesHeadings(body1), 1);
  T.contains('the pre-existing note survives', body1, 'Earlier finding');
  T.contains('the new note was appended', body1, 'New finding');
}

/* ---- an --acceptance write after notes exist must not duplicate Notes -- */
{
  const d = H.mkBacklog({
    label: 'edge-note-once-section-write',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      // No Acceptance Criteria section yet — the write below must insert one.
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Insert target',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      // An unrelated section sits between Description and where Notes will
      // land. Without it, "before ## Notes" and "after description" name the
      // same index and the assertion below would pass even if the
      // implementation used the wrong rule — this section makes the two
      // insertion points different, so the test can actually tell them apart.
      }, '# Insert target\n\n## Description\nD\n\n## Somewhere Else\nUnrelated content.\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const p = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  const rn = H.runNj(['note', '--id=TSK-001', 'A finding before acceptance exists'], { cwd: d });
  T.exit('note before the acceptance section exists', rn, 0);
  T.eq('## Notes appears exactly once after the note', countNotesHeadings(fs.readFileSync(p, 'utf8')), 1);

  const rs = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] Criterion'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --acceptance after notes already exist', rs, 0);

  const body = fs.readFileSync(p, 'utf8');
  T.eq('## Notes still appears exactly once after the section write',
    countNotesHeadings(body), 1);
  T.contains('the acceptance section was written', body, '## Acceptance Criteria');
  T.contains('the unrelated section survived untouched', body, 'Unrelated content.');
  T.contains('the earlier note survived the section insertion',
    body, 'A finding before acceptance exists');

  /* § 9: acceptance is inserted "before ## Notes when present" — not merely
   * "after description". With the unrelated section between them, the two
   * rules now disagree on where Acceptance lands, so this actually exercises
   * the clause it cites instead of passing on either rule. */
  const lines = body.split('\n');
  const descIdx = lines.indexOf('## Description');
  const elseIdx = lines.indexOf('## Somewhere Else');
  const accIdx = lines.indexOf('## Acceptance Criteria');
  const notesIdx = lines.indexOf('## Notes');
  T.check('the unrelated section survived, still after Description',
    descIdx >= 0 && elseIdx > descIdx, 'description at ' + descIdx + ', else at ' + elseIdx);
  T.check('acceptance sits before ## Notes, not merely after description ' +
    '(it lands after the unrelated section, not before it)',
    accIdx >= 0 && notesIdx >= 0 && elseIdx >= 0 && elseIdx < accIdx && accIdx < notesIdx,
    'else at ' + elseIdx + ', acceptance at ' + accIdx + ', notes at ' + notesIdx);
}

/* ---- Notes present, NO Description section at all --------------------- *
 * § 9: acceptance is inserted "before ## Notes when present" — full stop,
 * not "before Notes, provided a description section also exists". A body
 * that has `## Notes` but no `## Description` at all isolates exactly that:
 * if the insertion point falls back to "after description" (not found) or
 * "at the end" instead of the Notes anchor, acceptance lands after Notes.
 * The fixture must not already carry an `## Acceptance Criteria` section —
 * with one present, `set --acceptance` replaces it in place and the
 * insertion-point logic asserted here never runs at all. */
{
  const d = H.mkBacklog({
    label: 'edge-note-once-no-description',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, H.completeBody('Auth')),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Notes, no description',
        status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Notes, no description\n\n## Notes\n' +
        '- 2026-09-20T10:00:00Z human: Pre-existing finding\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const p = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  const rs = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] Criterion'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --acceptance on a body with Notes but no Description', rs, 0);

  const body = fs.readFileSync(p, 'utf8');
  T.eq('## Notes still appears exactly once', countNotesHeadings(body), 1);
  T.contains('the acceptance section was written', body, '## Acceptance Criteria');
  T.contains('the pre-existing note survived', body, 'Pre-existing finding');
  T.check('no ## Description section was invented',
    !body.includes('## Description'), JSON.stringify(body));

  const lines = body.split('\n');
  const accIdx = lines.indexOf('## Acceptance Criteria');
  const notesIdx = lines.indexOf('## Notes');
  T.check('acceptance sits before ## Notes even with no ## Description at all',
    accIdx >= 0 && notesIdx >= 0 && accIdx < notesIdx,
    'acceptance at ' + accIdx + ', notes at ' + notesIdx);
}

T.finish();
