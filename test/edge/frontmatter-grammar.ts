/* Edge — the frontmatter grammar (§ 7).
 *
 * Every rule here is pinned verbatim by § 7, so none of it needs a judgement
 * call. The parser is the component that decides whether a hand-edited file
 * survives, and hand-editing is the normal case for a file-based backlog.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

/** One element file, raw bytes, so the test controls every character. */
function withRawTask(label: string, raw: string): string {
  const d = H.mkBacklog({ label, tombstones: ['TSK-001'] });
  fs.writeFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), raw);
  return d;
}

function taskEntry(d: string) {
  const r = H.runJson(['list'], { cwd: d });
  const e = ((r.json && r.json.entries) || []).find((x: any) => x.id === 'TSK-001');
  return { entry: e, raw: r };
}

const BASE_BODY = '\n# T\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';

/* ---- split at the FIRST colon, one leading space stripped -------------- */
{
  const d = withRawTask('edge-fm-colon',
    '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: Login: Errors\n' +
    'status: todo\ncreated: ' + H.FIXED_NOW + '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  T.eq('title keeps everything after the first colon', entry && entry.title, 'Login: Errors');
}

/* ---- a value that starts with [ must be quoted to stay a string -------- */
{
  const d = withRawTask('edge-fm-quoted',
    '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: "[draft], not a list"\n' +
    'status: todo\ncreated: ' + H.FIXED_NOW + '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  T.eq('a quoted value keeps its brackets and comma', entry && entry.title, '[draft], not a list');
}

/* ---- an empty value is written quoted, and reads back empty ------------ */
{
  const d = withRawTask('edge-fm-empty',
    '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: ""\n' +
    'status: todo\ncreated: ' + H.FIXED_NOW + '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  T.check('an empty title is reported as missing:title',
    entry && (entry._problems || []).includes('missing:title'),
    JSON.stringify(entry && entry._problems));
}

/* ---- list items: unquoted items are trimmed, quoted ones keep commas --- */
{
  const d = withRawTask('edge-fm-list',
    '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: T\nstatus: todo\n' +
    'tags: [ backend ,  auth ]\n' +
    'created: ' + H.FIXED_NOW + '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  const tags = (entry && entry.tags) || [];
  T.eq('unquoted list items are trimmed of surrounding whitespace',
    tags.join('|'), 'backend|auth');
}

/* ---- comment lines are ignored ---------------------------------------- */
{
  const d = withRawTask('edge-fm-comment',
    '---\n# this line is a comment\nid: TSK-001\ntype: task\nparent: EPIC-001\n' +
    'title: T\nstatus: todo\ncreated: ' + H.FIXED_NOW + '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  T.eq('the element parses despite a comment line', entry && entry.title, 'T');
  T.check('a comment is not a problem',
    entry && !(entry._problems || []).includes('frontmatter:unreadable'),
    JSON.stringify(entry && entry._problems));
}

/* ---- BOM is stripped, CRLF is treated as LF ---------------------------- */
{
  const raw = '﻿---\r\nid: TSK-001\r\ntype: task\r\nparent: EPIC-001\r\n' +
    'title: T\r\nstatus: todo\r\ncreated: ' + H.FIXED_NOW + '\r\nupdated: ' + H.FIXED_NOW +
    '\r\n---\r\n\r\n# T\r\n\r\n## Description\r\nD\r\n\r\n## Acceptance Criteria\r\n- [ ] x\r\n';
  const d = withRawTask('edge-fm-bom-crlf', raw);
  const { entry } = taskEntry(d);
  T.eq('a BOM+CRLF file parses', entry && entry.id, 'TSK-001');
  T.eq('its title is intact', entry && entry.title, 'T');
  T.check('no unreadable frontmatter reported',
    entry && !(entry._problems || []).includes('frontmatter:unreadable'),
    JSON.stringify(entry && entry._problems));
}

/* ---- an unreadable line does not break the file ------------------------ */
{
  const d = withRawTask('edge-fm-badline',
    '---\nid: TSK-001\nthis line has no colon at all\ntype: task\nparent: EPIC-001\n' +
    'title: Still readable\nstatus: todo\ncreated: ' + H.FIXED_NOW +
    '\nupdated: ' + H.FIXED_NOW + '\n---\n' + BASE_BODY);
  const { entry } = taskEntry(d);
  T.check('the element stays visible', entry !== undefined,
    JSON.stringify(entry));
  T.eq('the readable lines stay in use', entry && entry.title, 'Still readable');
  T.check('the unreadable line is reported as a problem',
    entry && (entry._problems || []).length > 0,
    JSON.stringify(entry && entry._problems));
  /* The line number is a *doctor* field, not something list entries carry, so
   * it is looked for where § 9 says it lives: doctor's problem objects.
   *
   * AMBIGUOUS: § 7 says an unreadable line is "reported as a problem (with
   * line number)", but the closed vocabulary's only candidate,
   * frontmatter:unreadable, is defined as "frontmatter block cannot be
   * parsed" — a different condition. Whether one bad line inside a parsable
   * block uses that code or needs a new one is unpinned, so the code is not
   * asserted; the presence of a line number is. */
  const doc = H.runJson(['doctor'], { cwd: d });
  const findings = ((doc.json && doc.json.problems) || [])
    .filter((x: any) => x.element === 'TSK-001' || x.file === 'TSK-001.md');
  /* NOT converted to set equality, deliberately. The code for a bad *line*
   * inside a parsable block is unpinned (see the note above), and a first
   * attempt to pin the finding COUNT instead ("one bad line is one defect")
   * was an over-derivation: § 7 says the line "is reported as a problem",
   * not that it is the element's only problem — a line that fails to parse
   * takes its field with it, which can satisfy further § 7 conditions. With
   * neither the code nor the count derivable, this site stays containment
   * and stays blind to an extra finding; it is reported as such rather than
   * closed by guessing. */
  T.check('doctor reports the element as a finding', findings.length >= 1,
    JSON.stringify((doc.json && doc.json.problems) || []));
  T.check('the finding carries a line number',
    findings.some((x: any) => typeof x.line === 'number' && x.line > 0),
    JSON.stringify(findings));
}

T.finish();
