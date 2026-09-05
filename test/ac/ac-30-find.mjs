/* AC-30 — `nj find`, docs/SPECIFICATION.md § 9a, § 9 (JSON shapes, failure
 * codes), § 13 (v3.2 proposal § C, promoted: DECISIONS 123/131, commit
 * 1e4f062; D132, 64b82dd, pins § 9a's wording to toLowerCase()'s actual
 * lowercase mapping, not full Unicode case folding).
 *
 * AC-30 (§ 15): "`nj find "<text>"` returns every element whose title or
 * body (including `## Notes`) contains `<text>` as a substring,
 * case-insensitive by default (`String.prototype.toLowerCase()`'s lowercase
 * mapping on both sides, not full Unicode case folding) and exact with
 * `--case-sensitive`; combines with `--status`/`--type`/`--tag`/
 * `--parent`/`--assignee` as an AND; archived elements are excluded without
 * `--all` and included with it, same as `list`. The JSON shape matches
 * `list`'s read shape exactly, no `_match` field. A search matching nothing
 * returns `entries: []`, exit 0 (a read never fails on 'no results' — same
 * as an empty `list --status=doing`). `<text>` given as the literal empty
 * string is `invalid_value`."
 *
 * Written before `nj find` exists: red everywhere until it is implemented.
 */
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW;
function J(x) { return JSON.stringify(x === undefined ? null : x); }

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

function ids(json) { return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : []; }

/* A fixture with distinguishing text in every field `find` searches: a
 * title, a body paragraph, and a note. Plus an archived element (excluded
 * by default, § 11) and content exercising toLowerCase()'s lowercase-mapping
 * edges (not full Unicode case folding, D132). */
function model(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(H.runNj(['init'], { cwd: dir }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic Alpha', '--description=Nothing special.'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-001');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend work',
    '--description=Something about rate limiting in requests.',
    '--acceptance=- [ ] It works', '--tags=backend'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'TSK-001');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Frontend work',
    '--description=Nothing notable here.', '--acceptance=- [ ] ok', '--tags=frontend',
    '--status=doing'], { cwd: dir, env: { NJ_NOW: NOW } }), 'TSK-002');
  ok(H.runNj(['note', '--id=TSK-002', 'A workaround for zzzeta was applied'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'note on TSK-002');
  ok(H.runNj(['new', '--type=subtask', '--parent=TSK-001', '--title=Subtask Gamma',
    '--description=Contains a zzzgamma marker.', '--acceptance=- [ ] done'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'SUB-001');
  /* An archived element, excluded by default (§ 11). */
  ok(H.runNj(['new', '--type=epic', '--title=Archived Epic',
    '--description=Carries an archivedneedle marker.', '--status=done'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-002');
  ok(H.runNj(['archive', '--id=EPIC-002'], { cwd: dir, env: { NJ_NOW: NOW } }), 'archive EPIC-002');
  /* toLowerCase()'s lowercase-mapping fixtures (§ 9a: applied to both sides,
   * not full Unicode case folding — D132). */
  ok(H.runNj(['new', '--type=epic', '--title=Ärger Epic', '--description=German umlaut Ä.'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-003 (Ä)');
  ok(H.runNj(['new', '--type=epic', '--title=Straße Epic', '--description=Sharp s: straße.'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-004 (ß)');
  ok(H.runNj(['new', '--type=epic', '--title=İstanbul Office',
    '--description=Dotted capital I: İstanbul.'], { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-005 (İ)');
  ok(H.runNj(['new', '--type=epic', '--title=Fox Epic',
    '--description=The quick brown fox jumps over the lazy dog.'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'EPIC-006 (word-boundary body)');
  return { dir, bl };
}

function find(x, args, env) {
  return H.runJson(['find'].concat(args), { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}
function findH(x, args, env) {
  return H.runNj(['find'].concat(args), { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env || {}) });
}

/* ===================================================================== */
/* G1 — fields: title, body, notes                                        */
/* ===================================================================== */
{
  const x = model('ac30-g1');
  T.eq('G1 title match', ids(find(x, ['Frontend']).json), ['TSK-002']);
  T.eq('G1 body match', ids(find(x, ['rate limiting']).json), ['TSK-001']);
  T.eq('G1 note match (## Notes is part of the body, § 7)', ids(find(x, ['zzzeta']).json), ['TSK-002']);
  T.eq('G1 subtask body match', ids(find(x, ['zzzgamma']).json), ['SUB-001']);
}

/* ===================================================================== */
/* G2 — case-insensitive by default (ASCII fold); --case-sensitive exact   */
/* ===================================================================== */
{
  const x = model('ac30-g2');
  T.eq('G2 default: lowercase query matches a capitalised title', ids(find(x, ['backend']).json), ['TSK-001']);
  T.eq('G2 default: uppercase query matches too', ids(find(x, ['BACKEND']).json), ['TSK-001']);
  T.eq('G2 --case-sensitive: exact case matches', ids(find(x, ['Backend', '--case-sensitive']).json), ['TSK-001']);
  T.eq('G2 --case-sensitive: wrong case misses', ids(find(x, ['backend', '--case-sensitive']).json), []);
}

/* ===================================================================== */
/* G3 — toLowerCase()'s actual lowercase mapping, not full Unicode case     */
/* folding (D132): Ä/ä, ß, and the İ (dotted capital I) consequence        */
/* ===================================================================== */
{
  const x = model('ac30-g3');
  T.eq('G3 Ä lowercases to ä: query "ärger" matches "Ärger Epic"',
    ids(find(x, ['ärger']).json), ['EPIC-003']);
  T.eq('G3 ÄRGER (uppercase) also matches, same mapping',
    ids(find(x, ['ÄRGER']).json), ['EPIC-003']);
  T.eq('G3 toLowerCase() does not map ß to "ss" (unlike toUpperCase()\'s ' +
    'special-casing the other way): lowercase query "strasse" does NOT ' +
    'match body text "straße"',
    ids(find(x, ['strasse']).json), []);
  T.eq('G3 uppercase query "STRASSE" (→ "strasse" lowercased) does NOT match "straße" either',
    ids(find(x, ['STRASSE']).json), []);
  T.eq('G3 ß matches itself (plain substring, no special-casing needed)',
    ids(find(x, ['straße']).json), ['EPIC-004']);
  T.eq('G3 İ (U+0130): plain ASCII "istanbul" does NOT match "İstanbul" — ' +
    'toLowerCase() maps İ to "i" + a combining dot above (i̇), not plain "i", ' +
    'so the ASCII substring is not found (named spec consequence, § 9a, D132)',
    ids(find(x, ['istanbul']).json), []);
  T.eq('G3 İ matches itself: the same mapping applied to both sides of an identical query',
    ids(find(x, ['İstanbul']).json), ['EPIC-005']);
}

/* ===================================================================== */
/* G4 — substring, including across word boundaries; not a word-boundary  */
/* or regex match (§ 9a)                                                  */
/* ===================================================================== */
{
  const x = model('ac30-g4');
  T.eq('G4 a substring spanning two words ("ck bro" in "quick brown") matches',
    ids(find(x, ['ck bro']).json), ['EPIC-006']);
  T.eq('G4 a substring with no word-boundary alignment still matches',
    ids(find(x, ['uick brow']).json), ['EPIC-006']);
}

/* ===================================================================== */
/* G5 — --all includes the archive; excluded by default (§ 11)            */
/* ===================================================================== */
{
  const x = model('ac30-g5');
  T.eq('G5 archived element excluded by default', ids(find(x, ['archivedneedle']).json), []);
  T.eq('G5 --all includes it', ids(find(x, ['archivedneedle', '--all']).json), ['EPIC-002']);
}

/* ===================================================================== */
/* G6 — combines with list's filters as an AND (§ 9a)                     */
/* ===================================================================== */
{
  const x = model('ac30-g6');
  T.eq('G6 query "work" alone matches both work items',
    ids(find(x, ['work']).json).sort(), ['TSK-001', 'TSK-002']);
  T.eq('G6 query "work" AND --tag=backend narrows to the one with that tag',
    ids(find(x, ['work', '--tag=backend']).json), ['TSK-001']);
  T.eq('G6 query "work" AND --status=doing narrows to the doing one',
    ids(find(x, ['work', '--status=doing']).json), ['TSK-002']);
  T.eq('G6 query "work" AND an unmatching filter: empty',
    ids(find(x, ['work', '--tag=backend', '--status=doing']).json), []);
}

/* ===================================================================== */
/* G7 — the empty query is invalid_value (D119/D129 precedent, § 9a)      */
/* ===================================================================== */
{
  const x = model('ac30-g7');
  const r = find(x, ['']);
  T.exit('G7 empty query: exit 1', r, 1);
  T.eq('G7 empty query: invalid_value', r.json && r.json.error, 'invalid_value');
}

/* ===================================================================== */
/* G8 — output shape matches list's exactly; no _match field              */
/* ===================================================================== */
{
  const x = model('ac30-g8');
  const r = find(x, ['Backend']);
  T.exit('G8 exit 0', r, 0);
  const j = r.json;
  T.check('G8 shape: {backlog, counts, entries}',
    !!j && typeof j.backlog === 'string' && !!j.counts && Array.isArray(j.entries), J(j).slice(0, 300));
  const e = (j.entries || [])[0];
  T.check('G8 entry carries _problems and _claim, same as list/show',
    !!e && Array.isArray(e._problems) && ('_claim' in e), J(e));
  T.check('G8 no _match field anywhere on the entry', !e || !('_match' in e), J(e));
}

/* ===================================================================== */
/* G9 — ordering: priority descending, then id ascending — same as list   */
/* ===================================================================== */
{
  const dir = H.freshDir('ac30-g9');
  const x = { dir, bl: path.join(dir, 'backlog') };
  ok(H.runNj(['init'], { cwd: dir }), 'nj init');
  ok(H.runNj(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: { NJ_NOW: NOW } }), 'epic');
  /* Created low-priority first, so creation order and id order both put it
   * before the urgent one — only a correct priority-descending sort moves
   * the urgent, later-created, higher-numbered task first. */
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Widget Z',
    '--description=D.', '--acceptance=- [ ] x', '--priority=low'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'TSK-001 (low)');
  ok(H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Widget A',
    '--description=D.', '--acceptance=- [ ] x', '--priority=urgent'],
    { cwd: dir, env: { NJ_NOW: NOW } }), 'TSK-002 (urgent)');
  const r = find(x, ['Widget']);
  T.eq('G9 priority descending beats id ascending and creation order',
    ids(r.json), ['TSK-002', 'TSK-001']);
}

/* ===================================================================== */
/* G10 — no match: entries: [], exit 0 (a read never fails on "no results")*/
/* ===================================================================== */
{
  const x = model('ac30-g10');
  const r = find(x, ['zzz-nothing-matches-this-xyz']);
  T.exit('G10 no match: exit 0', r, 0);
  T.eq('G10 no match: entries is []', ids(r.json), []);
}

/* ===================================================================== */
/* G11 — human output: exits 0, prints something, no crash                */
/* ===================================================================== */
{
  const x = model('ac30-g11');
  const rh = findH(x, ['Backend']);
  T.exit('G11 human find: exit 0', rh, 0);
  T.check('G11 human find prints something', (rh.stdout || '').length > 0, J(rh.stdout));
}

T.finish();
