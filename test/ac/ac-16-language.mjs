/* AC-16 — Language.
 *
 * § 15 AC-16: "Language. Non-ASCII values (umlauts, CJK, emoji) survive every
 * write cycle byte-exact — except the documented `title` normalisation — and
 * English output is produced regardless of the values' language."
 *
 * § 2: values are stored byte-exact UTF-8 and are never transliterated or
 * translated; the only value normalised on write is `title` (single line,
 * trimmed, § 7). CLI messages, error texts and help are English.
 * § 7: `key: value` splits at the FIRST `:`, so `title: Login: Errors` yields
 * `Login: Errors`.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}

function entryOf(json, id) {
  if (!json || !Array.isArray(json.entries)) return null;
  return json.entries.filter(e => e.id === id)[0] || null;
}

/** True when the file contains the exact UTF-8 bytes of `s` (§ 2). */
function hasBytes(file, s) {
  try { return fs.readFileSync(file).includes(Buffer.from(s, 'utf8')); } catch (e) { return false; }
}

/** The first bytes of a file, for failure details; never throws. */
function bytesOf(file) {
  try { return fs.readFileSync(file, 'utf8').slice(0, 300); } catch (e) { return '<unreadable: ' + e.message + '>'; }
}

/** The body of a file, everything after the closing frontmatter delimiter. */
function bodyPart(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const parts = text.split('\n---\n');
  return parts.length > 1 ? parts.slice(1).join('\n---\n') : null;
}

/* Values are removed longest-first, so a note line containing a tag does not
 * leave the tag's tail behind. Whatever is left must be ASCII. */
function stripValues(text, values) {
  let s = String(text);
  for (const v of values.slice().sort((a, b) => b.length - a.length)) {
    if (v) s = s.split(v).join('<value>');
  }
  return s;
}

function firstNonAscii(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return 'non-ASCII at ' + i + ': ' + J(s.slice(Math.max(0, i - 60), i + 60));
    }
  }
  return '';
}

/* ---- non-ASCII values survive the write cycles -------------------------- */

const d = H.freshDir('ac16-rich');
const taskFile = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

{
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  T.exit('nj new epic with an umlaut title',
    H.runNj(['new', '--type=epic', '--title=Übersicht'], { cwd: d }), 0);
  T.exit('nj new task with a colon in the title',
    H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Login: Errors'], { cwd: d }), 0);
  T.exit('nj set assignee and tags in three scripts',
    H.runNj(['set', '--id=TSK-001', '--assignee=Jörg', '--tags=hören,日本語,🎉'], { cwd: d }), 0);

  T.check('a title with a colon survives byte-exact (split at the FIRST colon, § 7)',
    hasBytes(taskFile, 'title: Login: Errors'), bytesOf(taskFile));
  T.check('an umlaut assignee survives byte-exact',
    hasBytes(taskFile, 'assignee: Jörg'), bytesOf(taskFile));
  T.check('CJK and emoji tags survive byte-exact, in order',
    hasBytes(taskFile, 'tags: [hören, 日本語, 🎉]'), bytesOf(taskFile));

  const s = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('show --json', s, 0);
  const e = entryOf(s.json, 'TSK-001') || {};
  T.eq('the title round-trips through the parser', e.title, 'Login: Errors');
  T.eq('the assignee round-trips through the parser', e.assignee, 'Jörg');
  T.eq('the tags round-trip through the parser', e.tags, ['hören', '日本語', '🎉']);
}

{
  // Every write cycle, including the two that touch the body.
  T.exit('nj note with CJK and an emoji',
    H.runNj(['note', '--id=TSK-001', '日本語のメモ 🎉'], { cwd: d }), 0);
  T.exit('nj set --status', H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d }), 0);
  T.exit('nj set --tags (second write cycle)',
    H.runNj(['set', '--id=TSK-001', '--tags=hören,日本語,🎉'], { cwd: d }), 0);

  T.check('the CJK note line survives the write cycles byte-exact',
    hasBytes(taskFile, '日本語のメモ 🎉'), bytesOf(taskFile));
  T.check('the title still survives after the cycles', hasBytes(taskFile, 'title: Login: Errors'));
  T.check('the tags still survive after the cycles',
    hasBytes(taskFile, 'tags: [hören, 日本語, 🎉]'));
  T.check('the H1 still carries the title, colon included',
    hasBytes(taskFile, '# Login: Errors'));

  const s = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('show --json after the cycles', s, 0);
  const e = entryOf(s.json, 'TSK-001') || {};
  T.eq('the assignee survives the cycles', e.assignee, 'Jörg');
  T.eq('the title survives the cycles', e.title, 'Login: Errors');
}

/* ---- the one documented exception: title normalisation ------------------ */

{
  T.exit('nj set --title with surrounding whitespace',
    H.runNj(['set', '--id=TSK-001', '--title=  Viel Platz  '], { cwd: d }), 0);
  T.check('leading and trailing whitespace is dropped from the title (§ 7)',
    hasBytes(taskFile, 'title: Viel Platz'), bytesOf(taskFile));
  T.check('the H1 is synchronised with the normalised title',
    hasBytes(taskFile, '# Viel Platz'), bytesOf(taskFile));

  T.exit('nj set --title with a line break',
    H.runNj(['set', '--id=TSK-001', '--title=Erste Zeile\nZweite Zeile'], { cwd: d }), 0);
  T.check('a line break in the title becomes a space',
    hasBytes(taskFile, 'title: Erste Zeile Zweite Zeile'),
    bytesOf(taskFile));
  T.check('the H1 is single-line too',
    hasBytes(taskFile, '# Erste Zeile Zweite Zeile'),
    bytesOf(taskFile));

  // Normalisation is limited to line breaks and surrounding whitespace: a
  // decomposed value (o + combining diaeresis) is neither trimmed nor composed.
  // The NFD literal below is J, o, U+0308, r, g — deliberately different bytes
  // from the composed J, o, U+00F6, r, g the last check looks for.
  const NFD = 'Jörg';
  T.exit('nj set with a decomposed (NFD) assignee',
    H.runNj(['set', '--id=TSK-001', '--assignee=' + NFD], { cwd: d }), 0);
  T.check('a decomposed value is stored byte-exact, never normalised to NFC',
    hasBytes(taskFile, 'assignee: ' + NFD), bytesOf(taskFile));
  T.check('the composed form is not what was written',
    !hasBytes(taskFile, 'assignee: Jörg'), 'the tool composed the value');
}

/* ---- the body stays byte-for-byte --------------------------------------- */

{
  const title = 'Übersicht: 日本語';
  const body = '# ' + title + '\n\n## Description\nZeile eins. 🎉\n\n' +
    '## Acceptance Criteria\n- [ ] Bedingung erfüllt\n\n## Rollout\nÄnderungen anwenden.\n';
  const dir = H.mkBacklog({
    label: 'ac16-body',
    files: {
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: title, status: 'todo',
        assignee: 'Jörg', created: NOW, updated: NOW,
      }, body),
    },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const p = path.join(dir, 'backlog', 'tasks', 'TSK-001.md');
  const before = bodyPart(p);
  T.exit('nj set --status on a multilingual body',
    H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: dir }), 0);
  const after = bodyPart(p);
  T.check('the body is written back byte-for-byte unchanged (§ 7)',
    before === after, 'before: ' + J(before) + '\n     after:  ' + J(after));
  T.check('the H1 was not rewritten when the title did not change',
    hasBytes(p, '# ' + title), 'the H1 moved');

  T.exit('nj note on a multilingual body',
    H.runNj(['note', '--id=TSK-001', '追加メモ 🎉'], { cwd: dir }), 0);
  const noted = bodyPart(p);
  T.check('the note text is appended byte-exact',
    !!noted && noted.includes('追加メモ 🎉'), J(noted).slice(-200));
  T.check('the original body text is still there, unchanged',
    !!noted && noted.includes(body.split('\n\n## Rollout')[0]),
    J(noted).slice(0, 300));
}

/* ---- English output regardless of the data's language ------------------- */

const VALUES = ['Übersicht', 'Login: Errors', 'Jörg', 'hören', '日本語', '🎉',
  '日本語のメモ', 'Viel Platz', 'Erste Zeile', 'Zweite Zeile', 'Jörg'];

{
  const rl = H.runNj(['list'], { cwd: d });
  T.exit('list on the multilingual backlog', rl, 0);
  const listed = stripValues(out(rl), VALUES);
  T.check('list output is ASCII apart from the data values — English CLI (§ 2)',
    /^[\x00-\x7F]*$/.test(listed), firstNonAscii(listed));

  const rd = H.runNj(['doctor'], { cwd: d });
  T.exit('doctor on the multilingual backlog', rd, 0);
  T.contains('the doctor summary line is English (§ 14: "… entries, … errors, … warning")',
    rd.stdout, 'entries');
  const doctored = stripValues(out(rd), VALUES);
  T.check('doctor output is ASCII apart from the data values',
    /^[\x00-\x7F]*$/.test(doctored), firstNonAscii(doctored));

  // Write feedback (§ 9: "the element's open problems in the same block").
  const rw = H.runNj(['set', '--id=TSK-001', '--status=done'], { cwd: d });
  T.exit('set on the multilingual backlog', rw, 0);
  /* § 9's own write-feedback example is `TSK-009 → doing` followed by a
   * `⚠ TSK-009 has no acceptance criteria…` line, so the human write output
   * carries two non-ASCII marks by design. They are format, not data, and are
   * stripped alongside the values — demanding pure ASCII here would fail a
   * conforming implementation for matching the spec's own example. */
  const written = stripValues(out(rw), VALUES)
    .split('→').join('<arrow>').split('⚠').join('<warn>');
  T.check('write feedback is ASCII apart from the data values and the format marks',
    /^[\x00-\x7F]*$/.test(written), firstNonAscii(written));

  // A rejected command is English too, and carries no data values at all.
  const rb = H.runNj(['set', '--id=TSK-001', '--statuss=done'], { cwd: d });
  T.exit('an unknown field flag is rejected', rb, 1);
  T.check('the rejection message is pure ASCII',
    /^[\x00-\x7F]*$/.test(out(rb)), firstNonAscii(out(rb)));
}

{
  // A ready element, so the "Ready to work:" block of § 9 is actually printed.
  const dir = H.mkBacklog({
    label: 'ac16-ready',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Übersicht', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Übersicht\n\n## Description\nEtwas.\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Login: Errors',
        status: 'todo', assignee: 'Jörg', created: NOW, updated: NOW,
      }, '# Login: Errors\n\n## Description\nEtwas.\n\n## Acceptance Criteria\n- [ ] Es funktioniert\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = H.runNj(['list', '--ready'], { cwd: dir });
  T.exit('list --ready on a multilingual backlog', r, 0);
  T.check('the ready list actually lists the element (the checks below are not vacuous)',
    r.stdout.includes('TSK-001'), J(r.stdout).slice(0, 300));
  T.contains('the ready heading is English (§ 9 example: "Ready to work:")',
    r.stdout, 'Ready to work:');
  const ready = stripValues(out(r), ['Übersicht', 'Login: Errors', 'Jörg']);
  T.check('the ready output is ASCII apart from the data values',
    /^[\x00-\x7F]*$/.test(ready), firstNonAscii(ready));
}

T.finish();
