'use strict';
/* AC-11 — Archive rules.
 *
 * § 15 AC-11: "Archive rules. Archiving a subtree with open elements refuses
 * and names them; archived elements vanish from `list` and appear with `--all`;
 * `archive:split` and `archive:not_done` are caught by `doctor`."
 *
 * § 11: `nj archive --id=EPIC-001` moves the element and its entire subtree into
 * `backlog/archive/` (flat). Precondition: the element and every descendant are
 * `done`; otherwise the command refuses and lists the open elements. There is
 * no `--force`. The tool adds `archived: <ISO-8601 UTC>` to every moved element
 * and refreshes `updated`.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;
const LATER = H.LATER_NOW;

function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

function epic(id, title, status) {
  return H.element({
    id: id, type: 'epic', title: title, status: status,
    created: NOW, updated: NOW,
  }, '# ' + title + '\n\n## Description\nSomething.\n');
}

function task(id, title, status, parent) {
  return H.element({
    id: id, type: 'task', parent: parent || 'EPIC-001', title: title, status: status,
    created: NOW, updated: NOW,
  }, H.completeBody(title));
}

function subtask(id, title, status) {
  return H.element({
    id: id, type: 'subtask', parent: 'TSK-001', title: title, status: status,
    created: NOW, updated: NOW,
  }, H.completeBody(title));
}

function archivedEpic(id, title) {
  return H.element({
    id: id, type: 'epic', title: title, status: 'done',
    created: NOW, updated: NOW, archived: NOW,
  }, '# ' + title + '\n\n## Description\nSomething.\n');
}

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}

function entryOf(json, id) {
  if (!json || !Array.isArray(json.entries)) return null;
  return json.entries.filter(e => e.id === id)[0] || null;
}

/* Content hashes of every file under backlog/, so "changes nothing" means
 * bytes and not mtimes. The search index (§ 13) is a local cache that any read
 * may create, so it is excluded. */
function snapshot(backlogDir) {
  const map = {};
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
      if (e.name === '.nanojira-index.json') continue;
      map[r] = shaOf(path.join(dir, e.name));
    }
  })(backlogDir, '');
  return map;
}

function shaOf(p) {
  try { return H.sha256(fs.readFileSync(p)); } catch (e) { return '<unreadable>'; }
}

/* Read a file that nj was supposed to have written; empty when it did not. */
function readIf(dir, rel) {
  try { return fs.readFileSync(path.join(dir, 'backlog', rel), 'utf8'); } catch (e) { return ''; }
}

function changedFiles(before, after) {
  const keys = Object.keys(Object.assign({}, before, after)).sort();
  return keys.filter(k => before[k] !== after[k]);
}

/* ---- the precondition: a subtree with open elements --------------------- */

{
  const d = H.mkBacklog({
    label: 'ac11-refuse',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth', 'done'),
      'tasks/TSK-001.md': task('TSK-001', 'Still running', 'doing'),
      'subtasks/SUB-001.md': subtask('SUB-001', 'Not started', 'todo'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });

  const before = snapshot(path.join(d, 'backlog'));
  const r = H.runNj(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('archiving a subtree with open elements is refused (exit 1)', r, 1);
  T.contains('the refusal names the open task TSK-001', out(r), 'TSK-001');
  T.contains('the refusal names the open subtask SUB-001', out(r), 'SUB-001');

  const after = snapshot(path.join(d, 'backlog'));
  const changed = changedFiles(before, after);
  T.check('a refused archive writes nothing (byte-exact snapshot of every file)',
    changed.length === 0, 'changed: ' + changed.join(', '));
  T.check('nothing was moved into backlog/archive/',
    H.listFiles(d, 'archive').length === 0, J(H.listFiles(d, 'archive')));
  T.check('the refused element is still in backlog/epics/',
    H.existsInBacklog(d, 'epics/EPIC-001.md'), 'epics/EPIC-001.md is gone');
}

/* ---- a legal archive: the subtree moves, list hides it, --all shows it --- */

{
  const d = H.mkBacklog({
    label: 'ac11-legal',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', 'Auth', 'done'),
      'tasks/TSK-001.md': task('TSK-001', 'Backend API Endpoints', 'done'),
      'subtasks/SUB-001.md': subtask('SUB-001', 'Login route', 'done'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });

  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: LATER } });
  T.exit('nj archive --json exits 0 for a finished subtree', r, 0);
  const j = r.json || {};
  T.check('archive ok === true', j.ok === true, (r.parseError || J(j)).slice(0, 300));
  T.check('archive reports every moved id (§ 9: {ok, ids, changed, entries, _problems})',
    Array.isArray(j.ids) && j.ids.slice().sort().join(',') === 'EPIC-001,SUB-001,TSK-001',
    J(j.ids));
  T.eq('archive reports changed: ["archived"]', j.changed, ['archived']);
  T.check('archive entries is an array', Array.isArray(j.entries), J(j.entries));
  T.check('archive _problems is an array', Array.isArray(j._problems), J(j._problems));

  for (const id of ['EPIC-001', 'TSK-001', 'SUB-001']) {
    T.check(id + '.md is now in the flat archive folder',
      H.existsInBacklog(d, 'archive/' + id + '.md'), 'missing backlog/archive/' + id + '.md');
  }
  T.check('backlog/epics/ is empty again', H.listFiles(d, 'epics').length === 0,
    J(H.listFiles(d, 'epics')));
  T.check('backlog/tasks/ is empty again', H.listFiles(d, 'tasks').length === 0,
    J(H.listFiles(d, 'tasks')));
  T.check('backlog/subtasks/ is empty again', H.listFiles(d, 'subtasks').length === 0,
    J(H.listFiles(d, 'subtasks')));

  const bytes = readIf(d, 'archive/EPIC-001.md');
  T.contains('the moved element carries archived: <timestamp>', bytes, 'archived: ' + LATER);
  T.contains('archiving refreshes updated', bytes, 'updated: ' + LATER);
  T.contains('archiving does not touch the status', bytes, 'status: done');
  const subBytes = readIf(d, 'archive/SUB-001.md');
  T.contains('every moved descendant carries archived too', subBytes, 'archived: ' + LATER);

  const l = H.runJson(['list'], { cwd: d });
  T.exit('list after archiving', l, 0);
  const visible = ids(l.json);
  T.check('archived elements vanish from list',
    !visible.includes('EPIC-001') && !visible.includes('TSK-001') && !visible.includes('SUB-001'),
    'list = ' + visible.join(', '));

  const all = H.runJson(['list', '--all'], { cwd: d });
  T.exit('list --all after archiving', all, 0);
  for (const id of ['EPIC-001', 'TSK-001', 'SUB-001']) {
    const e = entryOf(all.json, id);
    T.check('list --all shows the archived ' + id, !!e,
      'entries = ' + J(ids(all.json)));
    T.check('list --all: ' + id + ' carries its archived timestamp (§ 11)',
      !!e && e.archived === LATER, e ? J(e.archived) : 'entry missing');
  }

  const human = H.runNj(['list'], { cwd: d });
  T.exit('list (human) after archiving', human, 0);
  T.check('the human list hides archived elements too',
    !out(human).includes('TSK-001'), J(human.stdout).slice(0, 300));
}

/* ---- doctor catches archive:split and archive:not_done ------------------ */

{
  const d = H.mkBacklog({
    label: 'ac11-doctor',
    files: {
      // Parent inside the archive …
      'archive/EPIC-001.md': archivedEpic('EPIC-001', 'Shelved epic'),
      // … child outside it: archive:split, produced by manual file moves.
      'tasks/TSK-001.md': task('TSK-001', 'Child left outside', 'done'),
      // Archived while not done: archive:not_done.
      'archive/TSK-002.md': H.element({
        id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Archived while open',
        status: 'doing', created: NOW, updated: NOW, archived: NOW,
      }, H.completeBody('Archived while open')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });

  const r = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor exits 2 while the archive rules are broken', r, 2);
  const problems = (r.json && r.json.problems) || [];
  const found = problems.map(p => p.code + ':' + p.severity);
  T.check('doctor reports archive:split as an error', found.includes('archive:split:error'),
    J(found));
  T.check('doctor reports archive:not_done as an error', found.includes('archive:not_done:error'),
    J(found));
  T.check('doctor ok is false when an error finding exists', r.json && r.json.ok === false,
    (r.parseError || J(r.json)).slice(0, 300));

  const rh = H.runNj(['doctor'], { cwd: d });
  T.exit('doctor (human) exits 2 as well', rh, 2);
  // Which of the two elements the finding names is not pinned; that it names
  // one of them — and not just a bare code — is what § 14's report format does.
  T.check('the human report names one of the elements involved in the split',
    out(rh).includes('TSK-001') || out(rh).includes('EPIC-001'),
    J(out(rh)).slice(0, 400));
}

T.finish();
