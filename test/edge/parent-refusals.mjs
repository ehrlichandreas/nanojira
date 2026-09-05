/* Edge — `nj new` may not take an archived or an unreadable parent (§ 9).
 *
 * § 9, "Rules":
 *   "The parent must be **active** — an archived parent is refused, since a
 *    fresh child of an archived parent would instantly carry `archive:split`.
 *    An **unreadable stub** (`file:unreadable`) is refused as a parent for the
 *    same reason: its type cannot be verified, and § 6 forbids inventing facts
 *    about it."
 *
 * § 9's failure vocabulary is closed and carries both reasons verbatim:
 *   `refused:<reason>`, reason ∈ unreadable | archived | children_open |
 *              has_children | not_done | parent_archived
 *
 * One invariant, two doors: a child may not be created against a parent the
 * tool cannot vouch for. The two cases still have to be told apart — "the
 * parent is on the shelf" and "the parent's file is broken" are different
 * repairs — so the code, not only the exit code, is asserted.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

const p = (d, rel) => path.join(d, 'backlog', rel);
const mdFiles = (d, rel) => H.lsOrEmpty(p(d, rel)).filter(f => f.endsWith('.md'));

const ELEMENT_DIRS = ['epics', 'tasks', 'subtasks', 'archive'];

/**
 * Every element file in the backlog, checksummed. "Nothing is written" is a
 * claim about the whole tree, not about the one path we happened to think of —
 * a refused `nj new` that half-created a file somewhere else would still be a
 * defect. Unreadable entries (the dangling symlink below) are recorded as such
 * instead of throwing.
 */
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
  for (const dir of ELEMENT_DIRS) walk(dir);
  return out;
}

/** § 9 pins the failure shape: `{ok:false, error:"<code>"}` on stdout, exit 1. */
function failureShape(desc, r) {
  return T.check(desc,
    !!r.json && r.json.ok === false && typeof r.json.error === 'string',
    JSON.stringify(r.json || r.stdout).slice(0, 300));
}

const CHILD = ['new', '--type=task', '--parent=EPIC-001', '--title=Child of the epic'];

/* ---- (a) the parent is an archived epic --------------------------------- */

function archivedParent(label) {
  return H.mkBacklog({
    label,
    files: {
      /* § 11: an archived element is the one that moved into archive/ and
       * carries the tool-written timestamp; "archived ⇒ done" is the invariant
       * § 11 keeps, so the fixture keeps it too. */
      'archive/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Shipped', status: 'done',
        created: H.FIXED_NOW, updated: H.LATER_NOW, archived: H.LATER_NOW,
      }, '# Shipped\n\n## Description\nDone long ago.\n'),
    },
    tombstones: ['EPIC-001'],
  });
}

{
  const d = archivedParent('edge-parent-archived');
  const before = elementSums(d);

  const human = H.runNj(CHILD, { cwd: d });
  T.exit('a task under an archived epic is refused', human, 1);
  T.check('the refusal reaches stderr (§ 9: the prose error text additionally goes to stderr)',
    human.stderr.trim().length > 0,
    'stderr was empty; stdout: ' + JSON.stringify(human.stdout));
  T.eq('the refusal wrote no task file', JSON.stringify(mdFiles(d, 'tasks')), JSON.stringify([]));
  T.eq('the backlog is byte-identical after the refusal',
    JSON.stringify(elementSums(d)), JSON.stringify(before));

  const js = H.runJson(CHILD, { cwd: d });
  T.exit('the same refusal with --json is exit 1', js, 1);
  failureShape('--json failure shape: {ok:false, error:"<code>"}', js);
  /* The reason vocabulary of § 9 contains exactly one reason for this case, so
   * the code is not a free choice: the refusal is about the parent. */
  T.eq('the error code is refused:parent_archived', js.json && js.json.error, 'refused:parent_archived');
  T.eq('the refused run still wrote no task file',
    JSON.stringify(mdFiles(d, 'tasks')), JSON.stringify([]));
  T.eq('the archived parent is untouched by the refused write',
    JSON.stringify(elementSums(d)), JSON.stringify(before));

  /* AMBIGUOUS: § 8 claims an ID with a tombstone and § 9 pins no ordering
   * between validation and allocation, so whether a refused `nj new` may burn
   * a fresh tombstone is unpinned. The oracle asserts only that no pre-existing
   * tombstone was altered — not that `.nanojira/ids/` gained nothing. */
  T.check('no pre-existing tombstone was altered',
    H.readOrNull(p(d, H.IDS_REL + '/EPIC-001')) !== null, '.nanojira/ids/EPIC-001 is gone');
}

/* ---- (b) the parent is an unreadable stub ------------------------------- */

{
  const d = H.mkBacklog({ label: 'edge-parent-unreadable', tombstones: ['EPIC-001'] });
  const stub = p(d, 'epics/EPIC-001.md');

  /* § 7's table names the cause: "file:unreadable — element file cannot be read
   * at all (dangling symlink, permissions)". The dangling symlink is that
   * cause, and unlike a permission bit it behaves the same for root and
   * non-root, so the fixture cannot be vacuous depending on who runs it.
   *
   * AMBIGUOUS: the other reading of "unreadable parent" — a frontmatter block
   * that cannot be parsed (§ 7 `frontmatter:unreadable`) — is not pinned for
   * this rule. § 9's sentence names `file:unreadable`, and for an unparsable
   * block the id and type are derivable from the file name (§ 7 `id:derived`,
   * `type:derived`), so accepting such a parent is defensible. Only the case
   * § 9 actually names is asserted here. */
  try { fs.symlinkSync(stub + '.gone', stub); } catch (e) { /* the check below reports it */ }
  T.check('fixture: the parent file cannot be read at all',
    H.readOrNull(stub) === null && fs.lstatSync(stub).isSymbolicLink(),
    'the stub is readable — the fixture proves nothing');

  const before = elementSums(d);

  const human = H.runNj(CHILD, { cwd: d });
  T.exit('a task under an unreadable parent stub is refused', human, 1);
  T.check('the refusal reaches stderr (§ 9)',
    human.stderr.trim().length > 0,
    'stderr was empty; stdout: ' + JSON.stringify(human.stdout));
  T.eq('the refusal wrote no task file', JSON.stringify(mdFiles(d, 'tasks')), JSON.stringify([]));

  const js = H.runJson(CHILD, { cwd: d });
  T.exit('the same refusal with --json is exit 1', js, 1);
  failureShape('--json failure shape: {ok:false, error:"<code>"}', js);
  T.eq('the error code is refused:unreadable', js.json && js.json.error, 'refused:unreadable');
  T.eq('nothing in the backlog changed', JSON.stringify(elementSums(d)), JSON.stringify(before));

  /* § 6: the type is immutable and the ID prefix fixes it — the tool may not
   * invent a type for a file it cannot read, so it may not create the child. */
  T.eq('the unreadable stub is still there, still unreadable',
    elementSums(d)['epics/EPIC-001.md'], '<unreadable>');
}

/* ---- the refusals are not blanket: an active parent still works --------- */

{
  const d = H.mkBacklog({
    label: 'edge-parent-ok',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Active', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Active\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });

  const r = H.runNj(CHILD, { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('an active parent is accepted — the refusals above are not blanket', r, 0);
  T.eq('exactly one task file was created', JSON.stringify(mdFiles(d, 'tasks')), JSON.stringify(['TSK-001.md']));

  const created = H.readOrNull(p(d, 'tasks/TSK-001.md'));
  T.check('the child is written under the parent it named',
    !!created && created.includes('parent: EPIC-001'),
    JSON.stringify(created === null ? null : created.slice(0, 200)));
  T.check('the child carries the title it was given',
    !!created && created.includes('title: Child of the epic'),
    JSON.stringify(created === null ? null : created.slice(0, 200)));
}

T.finish();
