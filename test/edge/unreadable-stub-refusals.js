'use strict';
/* Edge — `rm` and `archive` refuse while an unreadable stub exists (§ 9).
 *
 * § 9: "**`rm` and `archive` refuse (`refused:unreadable`) while any
 *  `file:unreadable` element exists anywhere in the backlog.** A stub carries
 *  no readable `parent` (it has none to read), so the subtree of any element
 *  cannot be determined while a stub exists — a cascade could orphan it, an
 *  archive could split it. Refusing is the only answer that honours 'a mode
 *  that leaves orphaned elements does not exist'. The error names the stub
 *  paths and says how to resolve them; single `rm` is covered by the same
 *  rule."
 *
 * The rule is deliberately backlog-wide: a stub has no readable `parent`, so
 * there is no way to tell whether it *would* have been inside the subtree being
 * removed. That is why the refusal cannot be scoped to the target, and why the
 * descendant case below is not a special case — it is the reason for the rule.
 *
 * `file:unreadable` is "element file cannot be read at all (dangling symlink,
 * permissions)". A dangling symlink is used: it is portable and behaves the
 * same for root and non-root, where a chmod-based fixture would silently stop
 * testing anything when the suite runs as root.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const NOW = H.FIXED_NOW;
const p = (d, rel) => path.join(d, 'backlog', rel);

/**
 * A healthy subtree plus one unreadable stub.
 * `stubAt` decides where the stub sits — a sibling under tasks/, or under
 * subtasks/ where it would be a descendant of the removed subtree.
 */
function fixture(label, stubAt) {
  const d = H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Root',
        status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Root')),
      'subtasks/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Child',
        status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Child')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });
  const stub = p(d, stubAt);
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.symlinkSync(path.join(d, 'this-target-does-not-exist'), stub);
  fs.writeFileSync(p(d, '.ids/STUB-001'), '');
  return { dir: d, stubRel: stubAt };
}

/** Byte-level snapshot of everything the command could touch. */
function snapshot(d) {
  const walk = rel => {
    const out = {};
    for (const entry of H.lsOrEmpty(p(d, rel))) {
      const full = p(d, rel + '/' + entry);
      let st;
      try { st = fs.lstatSync(full); } catch (e) { out[rel + '/' + entry] = 'lstat-failed'; continue; }
      if (st.isSymbolicLink()) out[rel + '/' + entry] = 'symlink';
      else if (st.isDirectory()) Object.assign(out, walk(rel + '/' + entry));
      else out[rel + '/' + entry] = H.sha256(fs.readFileSync(full, 'utf8'));
    }
    return out;
  };
  return walk('.');
}

const SCOPES = [
  { name: 'rm --id', args: ['rm', '--id=TSK-001'] },
  { name: 'rm --cascade', args: ['rm', '--id=TSK-001', '--cascade'] },
  { name: 'archive', args: ['archive', '--id=EPIC-001'] },
];

/* ---- the stub beside the target ---------------------------------------- */
for (const scope of SCOPES) {
  const { dir: d, stubRel } = fixture('edge-stub-' + scope.name.replace(/\W+/g, '-'),
    'tasks/TSK-002.md');
  const before = snapshot(d);

  /* Guard against a vacuous fixture: the stub must actually be producing the
   * condition the rule keys on, before the refusal proves anything. */
  const doc = H.runJson(['doctor'], { cwd: d });
  const findings = ((doc.json && doc.json.problems) || []).filter(x => x.code === 'file:unreadable');
  T.check(scope.name + ' — the fixture really produces file:unreadable', findings.length === 1,
    JSON.stringify((doc.json && doc.json.problems) || []));

  const r = H.runJson(scope.args, { cwd: d });
  T.exit(scope.name + ' — refuses while a stub exists', r, 1);
  T.eq(scope.name + ' — the code is refused:unreadable',
    r.json && r.json.error, 'refused:unreadable');
  T.contains(scope.name + ' — the error names the stub path',
    (r.stdout || '') + (r.stderr || ''), stubRel);
  T.eq(scope.name + ' — nothing was moved or deleted',
    JSON.stringify(snapshot(d)), JSON.stringify(before));
}

/* ---- the stub as a would-be descendant of the target -------------------- */
for (const scope of SCOPES) {
  const { dir: d } = fixture('edge-stub-desc-' + scope.name.replace(/\W+/g, '-'),
    'subtasks/SUB-002.md');
  const before = snapshot(d);

  const r = H.runJson(scope.args, { cwd: d });
  T.exit(scope.name + ' (stub under the subtree) — refuses', r, 1);
  T.eq(scope.name + ' (stub under the subtree) — refused:unreadable',
    r.json && r.json.error, 'refused:unreadable');
  T.eq(scope.name + ' (stub under the subtree) — nothing moved or deleted',
    JSON.stringify(snapshot(d)), JSON.stringify(before));
}

/* ---- non-vacuity: with the stub gone the command succeeds ---------------
 * Without this, every assertion above would also pass on a build that refused
 * everything. Each control has to satisfy its own command's OTHER
 * preconditions, or it proves nothing: `rm --id` needs a leaf (a parent is
 * caught by the child rule), and `archive` needs a fully finished subtree.
 * The first attempt at this block failed for exactly that reason and reported
 * `refused:has_children` — which is itself evidence the fixture was wrong, not
 * the implementation.
 */
{
  const leaf = () => H.mkBacklog({
    label: 'edge-stub-control-leaf',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Root',
        status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Root')),
      'subtasks/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Leaf',
        status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Leaf')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'SUB-001'],
  });

  const d1 = leaf();
  const r1 = H.runJson(['rm', '--id=SUB-001'], { cwd: d1 });
  T.exit('rm --id — succeeds once the stub is gone (leaf target)', r1, 0);
  T.check('rm --id — ok is true', !!(r1.json && r1.json.ok === true),
    JSON.stringify(r1.json && r1.json.ok).slice(0, 200));

  const d2 = leaf();
  const r2 = H.runJson(['rm', '--id=TSK-001', '--cascade'], { cwd: d2 });
  T.exit('rm --cascade — succeeds once the stub is gone', r2, 0);
  T.check('rm --cascade — ok is true', !!(r2.json && r2.json.ok === true),
    JSON.stringify(r2.json && r2.json.ok).slice(0, 200));

  const d3 = leaf();
  for (const id of ['SUB-001', 'TSK-001', 'EPIC-001']) {
    const s = H.runNj(['set', '--id=' + id, '--status=done'], { cwd: d3 });
    if (s.status !== 0) T.check('control fixture: set ' + id + ' done', false, s.stderr);
  }
  const r3 = H.runJson(['archive', '--id=EPIC-001'], { cwd: d3 });
  T.exit('archive — succeeds once the stub is gone (subtree finished)', r3, 0);
  T.check('archive — ok is true', !!(r3.json && r3.json.ok === true),
    JSON.stringify(r3.json && r3.json.ok).slice(0, 200));
}

T.finish();
