/* Edge — AC-20 section-write gaps (Not-covered #18), heading-matching half.
 *
 * ac-20-section-writes.js only proves INSERTION uses the first configured
 * alias (§ 9: "the heading written is the first name configured for that
 * role, matched case-insensitively on read"). It never proves the READ half
 * of that same sentence: that an EXISTING heading — a second alias, a
 * different case, a trailing colon — is recognised and REPLACED in place,
 * never duplicated. It also never proves the whole-file BOM/CRLF rule (§ 7:
 * "UTF-8 BOM is stripped, \r\n is treated as \n ... written as LF without
 * BOM, regardless of how it was read") against a section write specifically,
 * nor the degenerate body shapes (empty body, no trailing newline, H1-only,
 * a body of nothing but blank lines) that § 9's insertion rule has to cover.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const C = H.FIXED_NOW;
const LATER = H.LATER_NOW;
const taskPath = d => path.join(d, 'backlog', 'tasks', 'TSK-001.md');
const BOM = 0xFEFF;

function mkTask(label, body, config) {
  const o = { label, files: { 'tasks/TSK-001.md': H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
    status: 'todo', created: C, updated: C,
  }, body) }, tombstones: ['TSK-001', 'EPIC-001'] };
  if (config) o.config = config;
  return H.mkBacklog(o);
}

/* ---- existing heading matching: replace in place, never duplicate ------ */

{
  const d = mkTask('archive-ac20-match-colon',
    '# Endpoint\n\n## Description\nD\n\n## Acceptance Criteria:\n- [ ] old\n');
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=- [ ] new'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --acceptance matches an existing heading with a trailing colon', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the content was replaced', bytes, '- [ ] new');
  T.check('the old content is gone', !bytes.includes('- [ ] old'), bytes);
  T.eq('exactly one Acceptance heading remains (no duplicate)',
    (bytes.match(/^## Acceptance Criteria:?$/gm) || []).length, 1);
}

{
  const d = mkTask('archive-ac20-match-case',
    '# Endpoint\n\n## description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  const r = H.runNj(['set', '--id=TSK-001', '--description=new'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description matches an existing lower-case heading', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the content was replaced under the original (lower-case) heading', bytes, '## description\nnew');
  T.check('no second, differently-cased heading was inserted',
    !bytes.includes('## Description\n'), bytes);
}

{
  /* a second configured alias, already present in the body, must be matched
   * and replaced — not left alone while a fresh "## Description" is inserted
   * next to it. */
  const d = mkTask('archive-ac20-match-alias',
    '# Endpoint\n\n## Beschreibung\nalt\n\n## Acceptance Criteria\n- [ ] x\n',
    JSON.stringify({
      schema: 1, statuses: ['todo', 'doing', 'done'],
      sections: { description: ['Description', 'Beschreibung'], acceptance: ['Acceptance Criteria'] },
    }, null, 2) + '\n');
  const r = H.runNj(['set', '--id=TSK-001', '--description=neu'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description matches the second configured alias already in the body', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the alias heading is kept and its content replaced', bytes, '## Beschreibung\nneu');
  T.check('no "## Description" heading was inserted alongside it',
    !bytes.includes('## Description\n'), bytes);
}

/* ---- the whole TARGET file may itself carry a BOM/CRLF on disk --------- */

{
  const rawLF = H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
    status: 'todo', created: C, updated: C,
  }, '# Endpoint\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n');
  const rawCRLF = rawLF.replace(/\n/g, '\r\n');

  const d = H.mkBacklog({ label: 'archive-ac20-bom-target', files: {}, tombstones: ['TSK-001', 'EPIC-001'] });
  fs.writeFileSync(taskPath(d), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(rawCRLF, 'utf8')]));

  const before = fs.readFileSync(taskPath(d), 'utf8');
  T.check('fixture sanity: the target file starts with a BOM',
    before.charCodeAt(0) === BOM, 'first char code ' + before.charCodeAt(0));
  T.check('fixture sanity: the target file uses CRLF', before.includes('\r\n'), 'no CRLF found');

  const r = H.runNj(['set', '--id=TSK-001', '--description=New text'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('a section write on a BOM+CRLF target file succeeds', r, 0);

  const after = fs.readFileSync(taskPath(d), 'utf8');
  T.check('the whole file loses its BOM', after.charCodeAt(0) !== BOM, 'first char code ' + after.charCodeAt(0));
  T.check('the whole file is rewritten as LF (no CRLF survives anywhere)',
    !after.includes('\r\n'), JSON.stringify(after.slice(0, 200)));
  T.contains('the new content is present', after, 'New text');
  T.contains('untouched content (Acceptance) survives, LF-normalised', after, '## Acceptance Criteria\n- [ ] x');
}

/* ---- degenerate bodies § 9's insertion rule has to cover --------------- */

{
  /* empty body: frontmatter's mandatory blank line, then nothing. */
  const d = H.mkBacklog({
    label: 'archive-ac20-empty-body',
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: C, updated: C,
    }, '') },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--description=D'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description on a completely empty body', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the section was inserted', bytes, '## Description\nD\n');
  T.check('the file ends with exactly one trailing newline',
    bytes.endsWith('\n') && !bytes.endsWith('\n\n'), JSON.stringify(bytes.slice(-10)));
}

{
  /* body with content but no trailing newline at all. */
  const d = H.mkBacklog({
    label: 'archive-ac20-no-trailing-nl',
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: C, updated: C,
    }, '# Endpoint') },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--description=D'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description on a body with no trailing newline (H1 only, no newline at EOF)', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the H1 line survives verbatim', bytes, '# Endpoint');
  T.contains('the section content is present', bytes, '## Description\nD\n');
  T.check('the file ends with exactly one trailing newline',
    bytes.endsWith('\n') && !bytes.endsWith('\n\n'), JSON.stringify(bytes.slice(-10)));
  /* AMBIGUOUS: § 9 says description is inserted "after the H1 block" but does
   * not define that term for the degenerate case where the H1 line itself has
   * no trailing blank line to begin with (every other fixture in this suite
   * — including nj's own scaffold — already has one). Two readings:
   *   (a) normalise to the scaffold's one-blank-line H1/section separation
   *       ("# Endpoint\n\n## Description\n...") — my original assumption;
   *   (b) insert immediately after the H1 line as found, adding no separator
   *       that was not already there ("# Endpoint\n## Description\n...").
   * nj (c1-baseline, sha256 c866d2b2…50c0) implements (b). Escalated to the
   * lead rather than asserted either way — see the bundle report. */
}

{
  /* H1-only body: description then acceptance land in canonical order. */
  const d = H.mkBacklog({
    label: 'archive-ac20-h1-only',
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: C, updated: C,
    }, '# Endpoint\n') },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--acceptance=A', '--description=D'],
    { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set both sections on an H1-only body, flags given in reverse order', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.eq('description precedes acceptance regardless of flag order (canonical role order)',
    bytes.indexOf('## Description') < bytes.indexOf('## Acceptance Criteria'), true);
  T.contains('both sections landed with their content', bytes, '## Description\nD\n\n## Acceptance Criteria\nA\n');
}

{
  /* no H1, and several leading blank lines instead of the usual single one. */
  const d = H.mkBacklog({
    label: 'archive-ac20-noh1-blank-lines',
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: C, updated: C,
    }, '\n\n## Acceptance Criteria\n- [ ] x\n') },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
  const r = H.runNj(['set', '--id=TSK-001', '--description=D'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('set --description on a no-H1 body with extra leading blank lines', r, 0);
  const bytes = fs.readFileSync(taskPath(d), 'utf8');
  T.contains('the section landed before the existing Acceptance heading', bytes,
    '## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n');
}

T.finish();
