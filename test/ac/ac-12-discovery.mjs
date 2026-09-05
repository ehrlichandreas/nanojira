/* AC-12 — Discovery.
 *
 * § 15 AC-12: "Discovery. `list` from a nested subdirectory finds the backlog;
 * from an unrelated directory it exits 1 with a hard error (never a silent
 * empty result); `NJ_BACKLOG` is honoured."
 *
 * § 4 "Backlog discovery":
 *   1. If NJ_BACKLOG is set, it points at the backlog folder. Use it.
 *   2. Otherwise walk upward from the working directory to the first directory
 *      that contains backlog/.nanojira/config.json. Use that backlog.
 *   3. If nothing is found: exit 1 with a hard error. Never fall back to a
 *      relative path, never operate on an empty backlog, never auto-create.
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

/* The same folder, however it is spelled — /var and /private/var are the same
 * place on macOS and a symmetric comparison is the honest one. */
function samePath(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch (e) { return false; }
}

/* § 4 leaves the *reporting* form of the discovered folder unpinned (the JSON
 * example shows an absolute path); either form is accepted as long as it names
 * the same folder. */
function reportsBacklog(json, runCwd, backlogDir) {
  const bl = json && json.backlog;
  if (typeof bl !== 'string' || !bl) return false;
  return path.isAbsolute(bl)
    ? samePath(bl, backlogDir)
    : samePath(path.resolve(runCwd, bl), backlogDir);
}

function taskBody(title) {
  return '# ' + title + '\n\n## Description\nSomething.\n\n' +
    '## Acceptance Criteria\n- [ ] It works\n';
}

function taskFile(id, title) {
  return H.element({
    id: id, type: 'task', parent: 'EPIC-001', title: title, status: 'todo',
    created: NOW, updated: NOW,
  }, taskBody(title));
}

/* A second, hand-built backlog somewhere else in the tree. */
function secondBacklog(projectDir, rel, id, title) {
  const bl = path.join(projectDir, rel);
  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', H.IDS_REL]) {
    fs.mkdirSync(path.join(bl, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(bl, H.CONFIG_REL), H.DEFAULT_CONFIG);
  fs.writeFileSync(path.join(bl, '.gitignore'), H.GITIGNORE);
  fs.writeFileSync(path.join(bl, 'README.md'), '# Backlog\n');
  fs.writeFileSync(path.join(bl, H.IDS_REL, id), '');
  fs.writeFileSync(path.join(bl, 'tasks', id + '.md'), taskFile(id, title));
  return bl;
}

/* ---- nested subdirectory ------------------------------------------------ */

const proj = H.mkBacklog({
  label: 'ac12-nested',
  files: { 'tasks/TSK-001.md': taskFile('TSK-001', 'Found from below') },
  tombstones: ['TSK-001'],
});
const nested = path.join(proj, 'work', 'notes');
fs.mkdirSync(nested, { recursive: true });

{
  const r = H.runJson(['list'], { cwd: nested });
  T.exit('list from a nested subdirectory exits 0', r, 0);
  T.check('list from a nested subdirectory finds the backlog (walk upward)',
    ids(r.json).includes('TSK-001'), 'entries = ' + J(ids(r.json)));
  T.check('list --json reports the discovered backlog folder',
    reportsBacklog(r.json, nested, path.join(proj, 'backlog')),
    'backlog = ' + J(r.json && r.json.backlog));

  const rh = H.runNj(['list'], { cwd: nested });
  T.exit('list (human) from a nested subdirectory', rh, 0);
  T.contains('the human list shows the discovered element', rh.stdout, 'TSK-001');
}

/* ---- an unrelated directory is a hard error, never an empty result ------ */

const unrelated = H.freshDir('ac12-unrelated');

{
  const r = H.runNj(['list'], { cwd: unrelated });
  T.exit('list from an unrelated directory is a hard error (exit 1)', r, 1);
  T.check('the hard error is not silent', out(r).trim().length > 0, 'no output at all');
  T.check('never a silent "0 entries" result (§ 4 rule 3)',
    !/\b0\s*entr/i.test(out(r)), J(out(r)).slice(0, 300));

  const rj = H.runJson(['list'], { cwd: unrelated });
  T.exit('list --json from an unrelated directory is a hard error', rj, 1);
  T.check('nor a successful read shape with an entry list',
    !(rj.json && Array.isArray(rj.json.entries)),
    J(rj.json || rj.stdout).slice(0, 300));
}

/* ---- NJ_BACKLOG overrides discovery ------------------------------------- */

const other = H.mkBacklog({
  label: 'ac12-other',
  files: { 'tasks/TSK-900.md': taskFile('TSK-900', 'Somewhere else') },
  tombstones: ['TSK-900'],
});

{
  const r = H.runJson(['list'], { cwd: unrelated, env: { NJ_BACKLOG: path.join(proj, 'backlog') } });
  T.exit('NJ_BACKLOG is honoured from an unrelated directory', r, 0);
  T.check('NJ_BACKLOG: the pointed-at backlog is listed',
    ids(r.json).includes('TSK-001'), 'entries = ' + J(ids(r.json)));

  // Run from inside another backlog: rule 1 beats rule 2.
  const r2 = H.runJson(['list'], { cwd: other, env: { NJ_BACKLOG: path.join(proj, 'backlog') } });
  T.exit('NJ_BACKLOG wins over the backlog found by the upward walk', r2, 0);
  T.check('NJ_BACKLOG: the env backlog is used, not the surrounding one',
    ids(r2.json).includes('TSK-001') && !ids(r2.json).includes('TSK-900'),
    'entries = ' + J(ids(r2.json)));
}

{
  // A NJ_BACKLOG that points nowhere must not fall back to the walk — that
  // would silently answer from a different backlog.
  // AMBIGUOUS: § 4 pins "use it" and forbids falling back, but does not spell
  // out the exit code for a NJ_BACKLOG target that does not exist. Exit 1 is
  // the code for every other hard error (§ 9).
  const r3 = H.runJson(['list'], { cwd: nested, env: { NJ_BACKLOG: path.join(unrelated, 'nope') } });
  T.exit('NJ_BACKLOG pointing at a non-existent folder is a hard error', r3, 1);
  T.check('no fallback to the backlog the walk would have found',
    !(r3.json && Array.isArray(r3.json.entries)),
    J(r3.json || r3.stdout).slice(0, 300));
}

/* ---- the walk stops at the first directory containing the config -------- */

const outer = H.mkBacklog({
  label: 'ac12-outer',
  files: { 'tasks/TSK-001.md': taskFile('TSK-001', 'Outer backlog') },
  tombstones: ['TSK-001'],
});
secondBacklog(outer, path.join('sub', 'backlog'), 'TSK-002', 'Inner backlog task');
const deep = path.join(outer, 'sub', 'deep');
fs.mkdirSync(deep, { recursive: true });

{
  const r = H.runJson(['list'], { cwd: deep });
  T.exit('list from two levels below a nested backlog', r, 0);
  const got = ids(r.json);
  T.check('the nearest backlog wins (the first directory containing backlog/.nanojira/config.json)',
    got.includes('TSK-002'), 'entries = ' + J(got));
  T.check('the outer backlog is not used', !got.includes('TSK-001'),
    'entries = ' + J(got));
  T.check('list --json reports the inner backlog folder',
    reportsBacklog(r.json, deep, path.join(outer, 'sub', 'backlog')),
    'backlog = ' + J(r.json && r.json.backlog));
}

T.finish();
