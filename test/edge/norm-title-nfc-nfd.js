'use strict';
/* Edge — NC10 gap: does `title` survive Unicode composition form (NFC vs NFD)
 * byte-exact, or does `nj` normalise it?
 *
 * § 7 (Z. 252-253): "Titles are normalised on write: line breaks become spaces,
 * leading and trailing whitespace is dropped. This is the single exception to
 * § 2's byte-exact rule." The exception is enumerated — line breaks and
 * surrounding whitespace, nothing about composition form — so composition
 * normalisation is not part of the documented exception, and § 2's byte-exact
 * promise should apply to it undiminished.
 *
 * AMBIGUOUS (this is AMBIGUITIES.md 10, extended, not a new item): item 10
 * already flags "Unicode normalisation of title on write" as unpinned and
 * notes it "affects ac-16 (non-ASCII values)" — but ac-16 only drives this
 * question for `assignee` (a value § 7's exception never touches at all), not
 * for `title` (the one field the exception DOES touch, right next to the
 * composition question). This file is the missing case: the one field where
 * "normalised, but only for these two things" is actually in tension with
 * "byte-exact, except for that". Reading taken, same as ac-16 takes for
 * assignee: NFD survives byte-exact, because § 7's enumeration of what
 * normalisation touches does not include composition form.
 *
 * Mutation probe: every check below pairs "the NFD bytes survive" with "the
 * NFC bytes are NOT what was written" — a silent auto-composition regression
 * flips the second check red, not just the first going missing.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

function bytesOrNull(file) {
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

function hasBytes(file, s) {
  const buf = bytesOrNull(file);
  return buf !== null && buf.includes(Buffer.from(s, 'utf8'));
}

// "Jörg" two ways: NFC is one codepoint for ö (U+00F6); NFD is o + combining
// diaeresis (U+006F U+0308) — different bytes, same rendered glyph.
const NFC = '\u{4A}\u{F6}\u{72}\u{67}';            // J ö r g  (ö = U+00F6)
const NFD = '\u{4A}\u{6F}\u{308}\u{72}\u{67}';      // J o + combining diaeresis, r g

if (NFC.normalize('NFC') !== NFC || NFD.normalize('NFD') !== NFD) {
  throw new Error('fixture bug: NFC/NFD literals are not already in canonical form');
}
if (Buffer.from(NFC, 'utf8').equals(Buffer.from(NFD, 'utf8'))) {
  throw new Error('fixture bug: NFC and NFD literals must be different bytes');
}

/* ---- an NFD title, alone ------------------------------------------------- */
{
  const d = H.mkBacklog({ label: 'norm-title-nfd' });
  const r = H.runNj(['new', '--type=epic', '--title=' + NFD], { cwd: d });
  T.exit('nj new with an NFD title', r, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  T.check('the NFD bytes survive byte-exact in the frontmatter (§ 2, § 7)',
    hasBytes(file, 'title: ' + NFD), 'file: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('the tool did not compose it to NFC',
    !hasBytes(file, 'title: ' + NFC), 'the file carries the NFC form — composition happened');
  T.check('the H1 carries the same NFD bytes',
    hasBytes(file, '# ' + NFD), 'expected an NFD H1');
  T.check('the H1 was not composed to NFC either',
    !hasBytes(file, '# ' + NFC), 'the H1 carries the NFC form');

  const s = H.runJson(['show', '--id=EPIC-001'], { cwd: d });
  T.exit('show --json', s, 0);
  const shown = s.json && s.json.entries && s.json.entries[0];
  T.eq('the parsed title is still the NFD string (JS string equality is code-unit exact)',
    shown && shown.title, NFD);
}

/* ---- an NFD title THROUGH a set cycle, so a write-path composer would show */
{
  const d = H.mkBacklog({ label: 'norm-title-nfd-set' });
  T.exit('nj new (plain title)',
    H.runNj(['new', '--type=epic', '--title=Placeholder'], { cwd: d }), 0);
  const w = H.runNj(['set', '--id=EPIC-001', '--title=' + NFD],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj set --title with an NFD value', w, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  T.check('nj set also leaves the NFD bytes untouched',
    hasBytes(file, 'title: ' + NFD), 'file: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('nj set did not compose it to NFC either',
    !hasBytes(file, 'title: ' + NFC), 'the file carries the NFC form after set — composition happened');
}

/* ---- NFD interacting with the ONE real title exception: line-break trim - */
{
  // The documented exception (line-break -> space) must still fire, and must
  // not, as a side effect, run the value through a Unicode-normalising step —
  // a naive implementation of "trim + collapse" via a locale-aware string
  // routine could accidentally normalise composition too.
  const d = H.mkBacklog({ label: 'norm-title-nfd-linebreak' });
  const raw = '  ' + NFD + '\n' + NFD + '  ';
  const r = H.runNj(['new', '--type=epic', '--title=' + raw], { cwd: d });
  T.exit('nj new with an NFD title spanning a trimmed line break', r, 0);

  const file = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  const expected = NFD + ' ' + NFD;
  T.check('line-break normalisation and trim happen, composition does not (§ 7)',
    hasBytes(file, 'title: ' + expected),
    'file: ' + J(bytesOrNull(file) && bytesOrNull(file).toString('utf8')));
  T.check('the composed (NFC) form is not what got written',
    !hasBytes(file, 'title: ' + NFC + ' ' + NFC),
    'the file carries the NFC form — the documented exception also composed the value');
}

T.finish();
