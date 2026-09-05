/* Edge — the ORDER of the `changed` array in a write result (§ 9), not just
 * its membership. AC-13 already pins that `changed` "lists exactly the fields
 * that changed" (a set); no test anywhere pins the order those fields appear
 * in when several change in one call. Left unpinned, a refactor is free to
 * reorder it silently — this is exactly the kind of hole the byte-identity
 * gate exists to catch.
 *
 * ORDER — AMBIGUOUS, reading taken: § 9 never states an order for `changed`.
 * Frontmatter fields appear in § 7's canonical key order (the one order the
 * spec *does* fix, and the only one consistent with § 9's own principle,
 * Z. 414 — "one vocabulary in three places: command line, file, JSON
 * output" — a write result is exactly that JSON-output place), and section
 * roles (`description`, `acceptance`) are appended after the frontmatter
 * fields, in § 9's own canonical role order for section insertion (Z. 508).
 * Caveat, disclosed rather than hidden: `nj`'s own internal field-processing
 * order happens to already match § 7's canonical order, so a passing test
 * here cannot distinguish "the spec fixes this order" from "nj coincidentally
 * processes fields in this order" — the argv-scramble below is still a real
 * regression catcher (it rules out plain argv-echo), just not proof of which
 * of those two the *reason* is.
 *
 * MEMBERSHIP for `nj new` — RULED by the lead: all written frontmatter fields
 * EXCEPT `created`/`updated`, in § 7 canonical order, then the section roles.
 * Spec anchor: § 9 Z. 614 requires `changed` to *additionally* name the
 * section roles `new`/`set` wrote — establishing `changed` as a full
 * accounting of what a write touched, not a list of the flags supplied, so on
 * a fresh creation every frontmatter field counts as written/changed. The
 * `created`/`updated` exclusion is the one point § 9 leaves open, and is
 * exactly what the ruling closes; it is not derivable from Z. 614 alone.
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

function backlog() {
  return H.mkBacklog({
    label: 'enc-changed-order',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend',
        status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Backend')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

/* ---- four frontmatter fields in one `set`, given out of canonical order - */
{
  const d = backlog();
  // Given on the command line in a deliberately scrambled order (tags first,
  // status last) — if the tool merely echoed argv order, this would catch it.
  const w = H.runJson(['set', '--id=TSK-001',
    '--tags=a,b', '--assignee=coder-agent', '--priority=high', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj set with four fields, given out of canonical order', w, 0);
  T.eq('changed follows § 7 canonical key order, not argv order',
    w.json && w.json.changed, ['status', 'priority', 'assignee', 'tags']);
}

/* ---- two frontmatter fields ---------------------------------------------- */
{
  const d = backlog();
  const w = H.runJson(['set', '--id=TSK-001', '--priority=urgent', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj set with two fields', w, 0);
  T.eq('status (canonical position 5) precedes priority (position 6)',
    w.json && w.json.changed, ['status', 'priority']);
}

/* ---- a frontmatter field together with a section role -------------------- */
{
  const d = backlog();
  const w = H.runJson(['set', '--id=TSK-001', '--acceptance=New crit',
    '--status=doing', '--description=New text'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj set with a frontmatter field and both section roles', w, 0);
  T.eq('frontmatter field first, then section roles in canonical role order ' +
    '(description, then acceptance) regardless of argv order',
    w.json && w.json.changed, ['status', 'description', 'acceptance']);
}

/* ---- `nj new` with several optional fields supplied ---------------------- */
{
  // Membership per the lead's ruling (see header comment): all written
  // frontmatter fields except created/updated — so the required fields
  // (id, type, title, status) are named too, not just the optional ones
  // given on the command line.
  const d = H.mkBacklog({ label: 'enc-changed-order-new' });
  const w = H.runJson(['new', '--type=epic', '--title=X',
    '--assignee=coder-agent', '--priority=high', '--tags=a,b'], { cwd: d });
  T.exit('nj new with three optional fields, given out of canonical order', w, 0);
  T.eq('nj new orders changed by § 7 canonical key order (required fields, then optional)',
    w.json && w.json.changed, ['id', 'type', 'title', 'status', 'priority', 'assignee', 'tags']);
}

T.finish();
