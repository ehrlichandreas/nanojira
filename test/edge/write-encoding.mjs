/* Edge — the write side of § 7's encoding rules.
 *
 * § 7 pins both directions of one fact: "UTF-8 BOM is stripped, `\r\n` is
 * treated as `\n`. Files are always **written** as LF without BOM, regardless
 * of how they were read."
 *
 * The parse half is already pinned by edge/frontmatter-grammar.js. The write
 * half is the half no later reader can repair: a BOM or a CRLF the writer
 * emits travels into git, into every diff and into every downstream consumer
 * that is not as forgiving as nj's own parser. So every write path the CLI
 * offers is driven here, and the result is inspected as *raw bytes* — read as a
 * string, a stray \r is invisible and a BOM would have been stripped by the
 * very reader the test was using.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const CR = 0x0D;
const LF = 0x0A;

/** Raw bytes of a file, or null. Never throws: an absent file must surface as
 *  a failed assertion, not as a stack trace about ENOENT. */
function bytesOrNull(file) {
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

function inBacklog(d, ...rel) {
  return path.join(d, 'backlog', ...rel);
}

function startsWithBOM(buf) {
  return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

/** How many LF bytes the file ends with. */
function trailingLFs(buf) {
  let n = 0;
  for (let i = buf.length - 1; i >= 0 && buf[i] === LF; i--) n++;
  return n;
}

/** § 7's write contract for one file: no CR, no BOM, exactly one trailing LF.
 *  Returns the bytes, or null when the file cannot be read. */
// AMBIGUOUS: § 9 pins "the file ends with exactly one trailing newline" for
// what `nj new` scaffolds, and § 7 keeps the body byte-for-byte otherwise —
// whether a body that itself ends in a blank line keeps its second \n through
// a rewrite is not pinned. Every fixture below ends with a single line ending,
// which is what makes "exactly one" a statement about the line ending and not
// about trailing blank-line policy.
function cleanEncoding(label, file) {
  const buf = bytesOrNull(file);
  if (!T.check(label + ': the file exists', buf !== null, 'cannot read ' + file)) return null;
  T.check(label + ': no CR byte anywhere', buf.indexOf(CR) === -1,
    'first CR at offset ' + buf.indexOf(CR) + ' of ' + buf.length + ' bytes');
  T.check(label + ': no UTF-8 BOM', !startsWithBOM(buf),
    'first bytes: ' + buf.slice(0, 3).toString('hex'));
  T.eq(label + ': ends with exactly one LF', trailingLFs(buf), 1);
  return buf;
}

function pendingTask(title) {
  return H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: title,
    status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
  }, H.completeBody(title));
}

const EPIC = H.element({
  id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
  created: H.FIXED_NOW, updated: H.FIXED_NOW,
}, '# Auth\n\n## Description\nD\n');

/* ---- `nj new` — the three scaffolds ------------------------------------ */
{
  const d = H.mkBacklog({ label: 'edge-enc-new' });
  T.exit('nj new --type=epic', H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.exit('nj new --type=task', H.runNj(['new', '--type=task', '--parent=EPIC-001',
    '--title=Backend API Endpoints'], { cwd: d }), 0);
  T.exit('nj new --type=subtask', H.runNj(['new', '--type=subtask', '--parent=TSK-001',
    '--title=Login route'], { cwd: d }), 0);

  cleanEncoding('nj new (epic)', inBacklog(d, 'epics', 'EPIC-001.md'));
  cleanEncoding('nj new (task)', inBacklog(d, 'tasks', 'TSK-001.md'));
  cleanEncoding('nj new (subtask)', inBacklog(d, 'subtasks', 'SUB-001.md'));
}

/* ---- `nj set` ---------------------------------------------------------- */
{
  const d = H.mkBacklog({
    label: 'edge-enc-set',
    files: { 'epics/EPIC-001.md': EPIC, 'tasks/TSK-001.md': pendingTask('Login route') },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const file = inBacklog(d, 'tasks', 'TSK-001.md');
  const before = bytesOrNull(file);

  T.exit('nj set --status=doing', H.runNj(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  const after = bytesOrNull(file);
  T.check('the set really rewrote the file',
    before !== null && after !== null && H.sha256(before) !== H.sha256(after),
    'bytes unchanged — the encoding assertions below would pass vacuously');
  cleanEncoding('nj set', file);
}

/* ---- `nj note` --------------------------------------------------------- */
{
  const d = H.mkBacklog({
    label: 'edge-enc-note',
    files: { 'epics/EPIC-001.md': EPIC, 'tasks/TSK-001.md': pendingTask('Login route') },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const file = inBacklog(d, 'tasks', 'TSK-001.md');

  T.exit('nj note', H.runNj(['note', '--id=TSK-001', 'Parser splits at the first colon'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  cleanEncoding('nj note', file);
}

/* ---- `doctor --fix` ---------------------------------------------------- */
{
  const d = H.mkBacklog({
    label: 'edge-enc-fix',
    files: {
      'epics/EPIC-001.md': EPIC,
      /* It arrives missing `type`, `status`, `created` and `updated`, and with
       * a stale H1, so steps 1, 5 and 6 all write. */
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', parent: 'EPIC-001', title: 'Truth',
      }, '# Stale heading\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const file = inBacklog(d, 'tasks', 'TSK-001.md');
  const before = bytesOrNull(file);

  // § 14: "0 when no error remains, 2 when one does." This fixture's findings
  // are all warning-level per § 7's table: TSK-001 is missing `type`
  // (`type:derived`, consistent with the `tasks/` folder and `TSK-` prefix, so
  // no `type:folder` error), missing `status`/`created`/`updated`
  // (`missing:status`/`missing:created`/`missing:updated`), and its H1
  // disagrees with `title` (`title:h1_mismatch`, warning). No error-level code
  // applies anywhere in this fixture, so the exit code is pinned at exactly 0.
  T.exit('doctor --fix', H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  const after = bytesOrNull(file);
  T.check('the fix really rewrote the file',
    before !== null && after !== null && H.sha256(before) !== H.sha256(after),
    'bytes unchanged — the encoding assertions below would pass vacuously');
  cleanEncoding('doctor --fix', file);
}

/* ---- a BOM + CRLF file, rewritten by `nj set` -------------------------- */
{
  const d = H.mkBacklog({
    label: 'edge-enc-crlf',
    files: {
      'epics/EPIC-001.md': EPIC,
      // As a Windows editor leaves it: a real U+FEFF at the head of the file
      // and CRLF on every line. (The BOM below is a literal character in this
      // source file, exactly as in edge/frontmatter-grammar.js.)
      'tasks/TSK-001.md':
        '﻿---\r\n' +
        'id: TSK-001\r\n' +
        'type: task\r\n' +
        'parent: EPIC-001\r\n' +
        'title: Windows edit\r\n' +
        'status: todo\r\n' +
        'created: ' + H.FIXED_NOW + '\r\n' +
        'updated: ' + H.FIXED_NOW + '\r\n' +
        '---\r\n' +
        '\r\n' +
        '# Windows edit\r\n' +
        '\r\n' +
        '## Description\r\nD\r\n' +
        '\r\n' +
        '## Acceptance Criteria\r\n- [ ] x\r\n',
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const file = inBacklog(d, 'tasks', 'TSK-001.md');

  const fixture = bytesOrNull(file);
  T.check('the fixture really is BOM + CRLF',
    fixture !== null && startsWithBOM(fixture) && fixture.indexOf(CR) !== -1,
    'first bytes: ' + (fixture ? fixture.slice(0, 6).toString('hex') : 'unreadable'));

  T.exit('nj set on a BOM+CRLF file', H.runNj(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  // AMBIGUOUS: § 7 says the body is written back byte-for-byte unchanged and,
  // two paragraphs earlier, that files are "always written as LF without BOM,
  // regardless of how they were read". A CRLF body sits between the two: the
  // first reading keeps its \r, the second forbids it. The oracle applies the
  // second to the whole file — it is the sentence that speaks about writing,
  // and it is the stronger promise, since a file with mixed line endings is
  // exactly the outcome both sentences exist to prevent.
  const after = cleanEncoding('nj set (input was BOM+CRLF)', file);
  if (after) {
    const text = after.toString('utf8');
    T.check('the body survived the rewrite, in LF',
      text.includes('## Acceptance Criteria\n- [ ] x\n'),
      JSON.stringify(text));
  }

  const list = H.runJson(['list'], { cwd: d });
  const e = ((list.json && list.json.entries) || []).find(x => x.id === 'TSK-001');
  T.eq('the rewritten file still parses', e && e.title, 'Windows edit');
  T.eq('the change landed', e && e.status, 'doing');
}

T.finish();
