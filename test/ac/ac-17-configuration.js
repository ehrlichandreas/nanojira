'use strict';
/* AC-17 — Configuration.
 *
 * § 15 AC-17: "Configuration. An invalid `.nanojira.json` (bad statuses, `done`
 * not last) makes commands fail with exit 1 pointing at `doctor`, and `doctor`
 * reports it with exit 2."
 *
 * § 5: `statuses` is non-empty, at least two entries, unique, each matching
 * `[a-z_]+`; the last entry must be `done`; the first entry is the initial
 * state. An invalid configuration makes every command except `nj doctor` fail
 * with exit 1 and a pointer to `nj doctor`; `doctor` reports the defect (exit 2).
 * The code is `config:invalid`, a backlog-level finding (§ 7).
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

function config(statuses) {
  return J({
    schema: 1,
    statuses: statuses,
    sections: {
      description: ['Description'],
      acceptance: ['Acceptance Criteria'],
    },
  }, null, 2) + '\n';
}

/* Content hashes, so "nothing written" means bytes and not mtimes. The search
 * index (§ 13) is a local cache any read may create, so it is excluded. */
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

function changedFiles(before, after) {
  const keys = Object.keys(Object.assign({}, before, after)).sort();
  return keys.filter(k => before[k] !== after[k]);
}

const INVALID = [
  { label: 'done is not the last status', statuses: ['todo', 'done', 'doing'] },
  { label: 'a status does not match [a-z_]+', statuses: ['todo', 'In Progress', 'done'] },
  { label: 'fewer than two statuses', statuses: ['todo'] },
  { label: 'no statuses at all', statuses: [] },
  { label: 'duplicate statuses', statuses: ['todo', 'todo', 'done'] },
];

/* Every command that uses a backlog. `nj init` is not among them: it *creates*
 * the configuration and refuses when backlog/ already exists, so § 5's rule
 * ("every command except nj doctor") does not reach it. */
const COMMANDS = [
  ['bare nj', []],
  ['list', ['list']],
  ['show', ['show', '--id=TSK-001']],
  ['tree', ['tree']],
  ['new', ['new', '--type=task', '--parent=EPIC-001', '--title=X']],
  ['set', ['set', '--id=TSK-001', '--status=doing']],
  ['note', ['note', '--id=TSK-001', 'text']],
  ['rm', ['rm', '--id=TSK-001']],
  ['archive', ['archive', '--id=EPIC-001']],
];

function taskFixture(id, title, status, parent) {
  return H.element({
    id: id, type: 'task', parent: parent || 'EPIC-001', title: title, status: status,
    created: NOW, updated: NOW,
  }, '# ' + title + '\n\n## Description\nSomething.\n\n## Acceptance Criteria\n- [ ] It works\n');
}

for (const bad of INVALID) {
  const d = H.mkBacklog({
    label: 'ac17-' + bad.label.replace(/[^a-z0-9]+/gi, '-'),
    config: config(bad.statuses),
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nSomething.\n'),
      'tasks/TSK-001.md': taskFixture('TSK-001', 'Backend API Endpoints', 'todo'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });

  const before = snapshot(path.join(d, 'backlog'));

  for (const [name, args] of COMMANDS) {
    const r = H.runNj(args, { cwd: d });
    T.exit(name + ' fails with exit 1 on an invalid config (' + bad.label + ')', r, 1);
    T.contains(name + ' points at nj doctor (' + bad.label + ')', out(r), 'doctor');
  }

  const after = snapshot(path.join(d, 'backlog'));
  const changed = changedFiles(before, after);
  T.check('a failing command writes nothing (' + bad.label + ')',
    changed.length === 0, 'changed: ' + changed.join(', '));
  T.check('no element was created (' + bad.label + ')',
    H.listFiles(d, 'tasks').length === 1, J(H.listFiles(d, 'tasks')));

  const rh = H.runNj(['doctor'], { cwd: d });
  T.exit('doctor exits 2 on an invalid config (' + bad.label + ')', rh, 2);

  const rj = H.runJson(['doctor'], { cwd: d });
  T.exit('doctor --json exits 2 on an invalid config (' + bad.label + ')', rj, 2);
  const j = rj.json || {};
  const problems = Array.isArray(j.problems) ? j.problems : [];
  const invalid = problems.filter(p => p.code === 'config:invalid');
  T.check('doctor reports config:invalid (' + bad.label + ')', invalid.length >= 1,
    /* CODE-set equality: every one of these fixtures breaks § 5 and nothing
     * else, so `config:invalid` must be the ONLY code reported. The count is
     * left open on purpose — § 5 lists several rules and does not say whether
     * breaking two of them yields one finding or two ('no statuses at all'
     * violates more than one), so cardinality is unpinned while the code set
     * is not. This is what closes the blindness: containment could not see a
     * spurious extra finding of a different code. */
    (rj.parseError || J(problems)).slice(0, 400));
  T.sameSet('config:invalid is the only code reported (' + bad.label + ')',
    [...new Set(H.doctorSet(rj) || ['<no problems array>'])], ['config:invalid:error']);
  T.check('config:invalid is an error finding (' + bad.label + ')',
    invalid.length >= 1 && invalid[0].severity === 'error', J(invalid[0] || null));
  T.check('config:invalid is backlog-level: it carries no element (§ 9)',
    invalid.length >= 1 && !invalid[0].element, J(invalid[0] || null));
  T.check('doctor ok is false (' + bad.label + ')', j.ok === false,
    J(j).slice(0, 300));
}

T.finish();
