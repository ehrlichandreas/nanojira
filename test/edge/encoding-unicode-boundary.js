'use strict';
/* Edge — Unicode boundary cases for `title` (§ 2, § 7) not exercised by
 * ac-16-language.js.
 *
 * ac-16 already covers umlauts, CJK, a single-codepoint emoji, NFD, and the
 * documented title normalisation (line-break-to-space, trim). This file
 * closes the specific traps a byte-exact refactor gate cares about:
 *
 *  - characters outside the BMP (surrogate pairs in UTF-16, 4 bytes in UTF-8)
 *  - a multi-codepoint ZWJ grapheme cluster (several surrogate pairs joined
 *    by U+200D) — a naive char-by-char or length-based routine can split one
 *    in the middle without any single check catching it
 *  - a surrogate pair sitting directly at the edge of a trim or a
 *    line-break-to-space substitution, where an off-by-one is most likely
 *
 * § 2/§ 7 pin no length limit anywhere on `title` (checked: the only
 * "length"/"character" hits in SPECIFICATION.md are example body text, not a
 * rule), so there is no byte-length-vs-character-length rule to test against
 * — noted here rather than invented.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

/** Raw bytes of a file, or null. */
function bytesOrNull(file) {
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

/** True when a file's raw bytes contain the exact UTF-8 encoding of `s`. */
function hasBytes(file, s) {
  const buf = bytesOrNull(file);
  return buf !== null && buf.includes(Buffer.from(s, 'utf8'));
}

const PARTY = '\u{1F389}';              // 🎉 U+1F389, astral, one surrogate pair
const CONFETTI = '\u{1F38A}';           // 🎊 U+1F38A, astral, one surrogate pair
// Family emoji: four astral codepoints joined by ZWJ (U+200D) — seven UTF-16
// code units, four surrogate pairs, one grapheme cluster.
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';

/* ---- a ZWJ multi-codepoint sequence as the entire title ----------------- */
{
  const d = H.mkBacklog({ label: 'enc-unicode-zwj' });
  const r = H.runNj(['new', '--type=epic', '--title=' + FAMILY], { cwd: d });
  T.exit('nj new with a ZWJ family-emoji title', r, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  T.check('the ZWJ sequence survives byte-exact in the frontmatter (no whitespace to trim)',
    hasBytes(file, 'title: ' + FAMILY), 'file bytes: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('the ZWJ sequence survives byte-exact in the H1',
    hasBytes(file, '# ' + FAMILY), 'expected H1 line with the full sequence');

  // § 9's JSON-shapes table groups `show` with `list`: {backlog, counts,
  // entries: […]} — a single-element entries array, not a singular `entry`.
  const s = H.runJson(['show', '--id=EPIC-001'], { cwd: d });
  T.exit('show --json', s, 0);
  const shown = s.json && s.json.entries && s.json.entries[0];
  T.eq('the title round-trips through the parser as one JS string',
    shown && shown.title, FAMILY);
  T.check('the raw --json stdout carries the literal UTF-8 bytes, not \\u escapes',
    s.stdout.includes(FAMILY) && !/\\u200d|\\ud83d|\\ud83c/i.test(s.stdout),
    'stdout: ' + J(s.stdout));
}

/* ---- an astral character directly adjacent to a normalised line break --- */
{
  const d = H.mkBacklog({ label: 'enc-unicode-linebreak' });
  const title = PARTY + '\n' + CONFETTI;
  const r = H.runNj(['new', '--type=epic', '--title=' + title], { cwd: d });
  T.exit('nj new with astral characters either side of a line break', r, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  const expected = PARTY + ' ' + CONFETTI;
  T.check('the line break becomes exactly one space, both surrogate pairs intact (§ 7)',
    hasBytes(file, 'title: ' + expected), 'file bytes: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('neither surrogate pair was split (no lone surrogate / replacement char)',
    !hasBytes(file, '�'), 'found U+FFFD (replacement character) — a surrogate pair was torn apart');
}

/* ---- an astral character directly adjacent to the trimmed edge ---------- */
{
  const d = H.mkBacklog({ label: 'enc-unicode-trim' });
  const raw = '  ' + PARTY + 'World' + CONFETTI + '  ';
  const r = H.runNj(['new', '--type=epic', '--title=' + raw], { cwd: d });
  T.exit('nj new with astral characters at the trim boundary', r, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  const expected = PARTY + 'World' + CONFETTI;
  T.check('ASCII whitespace is trimmed without touching the adjacent surrogate pairs (§ 7)',
    hasBytes(file, 'title: ' + expected), 'file bytes: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('the H1 carries the same trimmed, intact value',
    hasBytes(file, '# ' + expected), 'expected H1 with both surrogate pairs intact');
}

T.finish();
