'use strict';
/* Edge — a taken move target aborts the archive before the first move (§ 11).
 *
 * § 11:
 *   "All move targets are verified before the first move. If any target path
 *    already exists in `archive/`, the command aborts with `exists` and moves
 *    **nothing**. A partially executed archive is forbidden — it would leave
 *    the backlog with an archived parent and a live child (`archive:split`,
 *    `duplicate_id`) and no clean recovery."
 *
 * That sentence is a regression guard as much as a rule: with the check inside
 * the move loop, a collision on the *second* element leaves the first one
 * already archived — the exact half-state § 11 forbids. So this test counts
 * bytes in every folder rather than only looking at the file the collision
 * names, and the epic (moved first) is the one that betrays a half-done run.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const p = (d, rel) => path.join(d, 'backlog', rel);
const mdFiles = (d, rel) => H.lsOrEmpty(p(d, rel)).filter(f => f.endsWith('.md'));

const SOURCES = ['epics/EPIC-001.md', 'tasks/TSK-001.md', 'tasks/TSK-002.md'];
const IDS = ['EPIC-001', 'TSK-001', 'TSK-002'];

/* A leftover already sitting on one of the targets: an element from an earlier
 * shelf, under the name the move would write. */
const STALE = H.element({
  id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Task one (stale shelf copy)',
  status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW, archived: H.LATER_NOW,
}, '# Task one (stale shelf copy)\n\n## Description\nD\n\n## Acceptance Criteria\n- [x] x\n');
const STALE_SUM = H.sha256(STALE);
const STALE_REL = 'archive/TSK-001.md';

function doneElement(fields, body) {
  return H.element(Object.assign({
    status: 'done', created: H.FIXED_NOW, updated: H.FIXED_NOW,
  }, fields), body);
}

/* § 11's precondition is met in both fixtures: the epic and every descendant
 * are `done`. The only difference is whether a target is occupied. */
function fixture(label, collide) {
  const files = {
    'epics/EPIC-001.md': doneElement({ id: 'EPIC-001', type: 'epic', title: 'Shipped' },
      '# Shipped\n\n## Description\nD\n'),
    'tasks/TSK-001.md': doneElement({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Task one' },
      H.completeBody('Task one')),
    'tasks/TSK-002.md': doneElement({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'Task two' },
      H.completeBody('Task two')),
  };
  if (collide) files[STALE_REL] = STALE;
  return H.mkBacklog({ label, files, tombstones: IDS });
}

/** Every element file, checksummed — "moves nothing" is a claim about the tree. */
function elementSums(d) {
  const out = {};
  const walk = rel => {
    for (const name of H.lsOrEmpty(p(d, rel))) {
      const child = rel + '/' + name;
      const abs = p(d, child);
      let st = null;
      try { st = fs.lstatSync(abs); } catch (e) { continue; }
      if (st.isDirectory()) { walk(child); continue; }
      const bytes = H.readOrNull(abs);
      out[child] = bytes === null ? '<unreadable>' : H.sha256(bytes);
    }
  };
  for (const dir of ['epics', 'tasks', 'subtasks', 'archive']) walk(dir);
  return out;
}

/* AMBIGUOUS: a file at archive/TSK-001.md is, by the ID↔file-name bijection,
 * also an element claiming TSK-001, so § 9's "writes refuse, naming the code
 * duplicate_id" could be argued to fire first on this fixture. § 11 states the
 * outcome for exactly this situation — "if any target path already exists in
 * archive/" — as `exists`, and that is what is asserted. A ruling that gives
 * duplicate_id precedence here is a one-line edit. */

/* ---- the collision, human path ----------------------------------------- */

{
  const d = fixture('edge-arch-collide', true);
  const before = elementSums(d);
  T.eq('fixture: archive/ holds exactly the pre-placed file', JSON.stringify(mdFiles(d, 'archive')),
    JSON.stringify(['TSK-001.md']));

  const r = H.runNj(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('a taken move target aborts the archive', r, 1);
  T.check('the abort says something',
    (r.stdout + r.stderr).trim().length > 0, 'no output at all');

  T.eq('nothing moved: every element file is byte-identical',
    JSON.stringify(elementSums(d)), JSON.stringify(before));
  for (const rel of SOURCES) {
    T.check(rel + ' is still in its folder', H.readOrNull(p(d, rel)) !== null, 'missing');
  }
  T.eq('archive/ still holds exactly the pre-placed file',
    JSON.stringify(mdFiles(d, 'archive')), JSON.stringify(['TSK-001.md']));
  const stale = H.readOrNull(p(d, STALE_REL));
  T.check('the pre-placed file was not overwritten',
    stale !== null && H.sha256(stale) === STALE_SUM,
    stale === null ? 'gone' : 'bytes differ');
}

/* ---- the collision, --json path ---------------------------------------- */

{
  const d = fixture('edge-arch-collide-json', true);
  const before = elementSums(d);

  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('--json: the abort is exit 1', r, 1);
  T.check('--json failure shape: {ok:false, error:"<code>"} (§ 9)',
    !!r.json && r.json.ok === false && typeof r.json.error === 'string',
    JSON.stringify(r.json || r.stdout).slice(0, 300));
  T.eq('the error code is exists', r.json && r.json.error, 'exists');

  T.eq('--json moved nothing either: every element file is byte-identical',
    JSON.stringify(elementSums(d)), JSON.stringify(before));
  T.eq('archive/ still holds exactly the pre-placed file',
    JSON.stringify(mdFiles(d, 'archive')), JSON.stringify(['TSK-001.md']));
}

/* ---- with every target free, the same subtree still archives ----------- */

{
  const d = fixture('edge-arch-clean', false);
  T.eq('fixture: archive/ starts empty', JSON.stringify(mdFiles(d, 'archive')), JSON.stringify([]));

  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('with every target free the same subtree archives', r, 0);
  T.check('--json write shape for archive: ok:true with ids (§ 9)',
    !!r.json && r.json.ok === true && Array.isArray(r.json.ids),
    JSON.stringify(r.json || r.stdout).slice(0, 300));
  T.check('changed names the effect § 9 pins for archive',
    !!r.json && Array.isArray(r.json.changed) && r.json.changed.indexOf('archived') !== -1,
    JSON.stringify(r.json && r.json.changed));

  const ids = (r.json && r.json.ids) || [];
  for (const id of IDS) {
    T.check('ids names the moved element ' + id, ids.indexOf(id) !== -1, JSON.stringify(ids));
    T.check('archive/' + id + '.md exists', H.readOrNull(p(d, 'archive/' + id + '.md')) !== null);
  }
  for (const rel of SOURCES) {
    T.check(rel + ' left its type folder', H.readOrNull(p(d, rel)) === null, 'still there');
  }
  for (const id of IDS) {
    T.check('tombstone ' + id + ' remains (§ 8)',
      H.readOrNull(p(d, H.IDS_REL + '/' + id)) !== null, H.IDS_REL + '/' + id + ' is gone');
  }

  /* § 11: "The tool adds `archived: <ISO-8601 UTC>` to the frontmatter of every
   * moved element and refreshes `updated`." § 12 pins the clock to NJ_NOW, so
   * the byte value is not a guess. */
  const moved = H.readOrNull(p(d, 'archive/TSK-002.md'));
  T.contains('the moved element carries the archive timestamp', String(moved),
    'archived: ' + H.LATER_NOW);
  T.contains('the moved element has its updated refreshed', String(moved),
    'updated: ' + H.LATER_NOW);
}

T.finish();
