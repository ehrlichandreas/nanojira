/* Edge — empty `--tag` / `--assignee` (§ 9), not exercised anywhere else.
 *
 * § 9 pins validation only for `--status` and `--parent` — not `--tag` or
 * `--assignee` — and free-text fields with no registry (§ 6) have nothing to
 * validate against, so an empty value on either filter is not an error; it is
 * a literal filter value like any other. This is an omission argument (§ 9
 * simply never names these two as validated), not a positive spec statement,
 * so it is weaker footing than the rest of this file's assertions.
 *
 *  - `--tags=` on a write **empties the list** (§ 9), and the CLI's own
 *    `--tags`/`--depends-on` parser never produces an empty-string item, so
 *    in a **CLI-created backlog** `list --tag=` can only ever match zero
 *    elements. This is a claim about what the CLI writes, not about the data
 *    model in general — a hand-edited file can carry `tags: [""]`, and that
 *    element WOULD match `--tag=`; the test below only ever drives `nj new`,
 *    so it stays inside the claim it is actually allowed to make.
 *  - `assignee` defaults to empty (§ 6) and is written only when non-empty
 *    (§ 7 "empty optional fields are omitted"), so `list --assignee=`
 *    matches exactly the elements with no assignee set.
 *
 * The write side is the same § 7 rule from the other direction: `--assignee=`
 * on `new` or `set` sets the field to empty, which the serializer then omits
 * — the line is dropped (or, for `set`, removed if it was there).
 */
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

function ids(json: any): string[] {
  return json && Array.isArray(json.entries) ? json.entries.map((e: any) => e.id).sort() : [];
}

/* ---- `list --tag=` matches nothing: no tag is ever the empty string ----- */
{
  const d = H.mkBacklog({ label: 'enc-empty-tag' });
  T.exit('nj new (tagged)', H.runNj(['new', '--type=epic', '--title=Tagged',
    '--tags=alpha,beta'], { cwd: d }), 0);
  T.exit('nj new (untagged)', H.runNj(['new', '--type=epic', '--title=Untagged'],
    { cwd: d }), 0);

  const r = H.runJson(['list', '--tag='], { cwd: d });
  T.exit('list --tag= is accepted, not an unknown/invalid filter', r, 0);
  T.eq('an empty --tag matches nothing in a CLI-created backlog (see header comment)',
    ids(r.json), []);
}

/* ---- `list --assignee=` matches the unassigned elements ----------------- */
{
  const d = H.mkBacklog({ label: 'enc-empty-assignee' });
  T.exit('nj new (assigned)', H.runNj(['new', '--type=epic', '--title=Assigned',
    '--assignee=coder-agent'], { cwd: d }), 0);
  T.exit('nj new (unassigned)', H.runNj(['new', '--type=epic', '--title=Unassigned'],
    { cwd: d }), 0);

  const r = H.runJson(['list', '--assignee='], { cwd: d });
  T.exit('list --assignee= is accepted, not an unknown/invalid filter', r, 0);
  T.eq('an empty --assignee matches exactly the elements with no assignee set',
    ids(r.json), ['EPIC-002']);
}

/* ---- `nj new --assignee=` — an explicitly empty optional field is omitted */
{
  const d = H.mkBacklog({ label: 'enc-empty-assignee-new' });
  T.exit('nj new --assignee= (empty at creation)',
    H.runNj(['new', '--type=epic', '--title=X', '--assignee='], { cwd: d }), 0);

  T.check('an explicitly empty assignee is omitted from the file, like an unset one (§ 7)',
    !H.readInBacklog(d, 'epics/EPIC-001.md').split('\n').some(l => l.startsWith('assignee:')),
    H.readInBacklog(d, 'epics/EPIC-001.md'));

  // § 9's JSON-shapes table groups `show` with `list`: {backlog, counts,
  // entries: […]} — a single-element entries array, not a singular `entry`.
  const s = H.runJson(['show', '--id=EPIC-001'], { cwd: d });
  T.exit('show --json', s, 0);
  const shown = s.json && s.json.entries && s.json.entries[0];
  // AMBIGUOUS: § 9 does not say what an entry object carries. NOT the
  // reasoning: "JSON mirrors the file's present fields" — that claim is false
  // on its face, since `priority`/`tags`/`depends_on` appear in the JSON with
  // their effective (possibly default) value even when the file has no line
  // for them at all (cross-verified finding, reported to the lead for a
  // pending § 9 amendment). `assignee` behaves differently from those three —
  // omitted, not defaulted — which is the asserted, reproducible shape below;
  // it is reported as an open shape question, not derived from any spec
  // passage that decides it either way.
  T.check('the JSON entry omits assignee entirely when unset (AMBIGUOUS — see comment)',
    shown && !Object.prototype.hasOwnProperty.call(shown, 'assignee'),
    J(shown));
}

/* ---- `nj set --assignee=` clears a previously set assignee -------------- */
{
  const d = H.mkBacklog({ label: 'enc-empty-assignee-clear' });
  T.exit('nj new (assigned)', H.runNj(['new', '--type=epic', '--title=X',
    '--assignee=coder-agent'], { cwd: d }), 0);

  const rel = 'epics/EPIC-001.md';
  T.check('the fixture really has an assignee before the clear',
    H.readInBacklog(d, rel).split('\n').some(l => l === 'assignee: coder-agent'),
    H.readInBacklog(d, rel));

  const w = H.runJson(['set', '--id=EPIC-001', '--assignee='],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('nj set --assignee= (clearing)', w, 0);
  T.eq('changed names the field that was cleared', w.json && w.json.changed, ['assignee']);

  T.check('the assignee line is removed from the file, not written empty (§ 7)',
    !H.readInBacklog(d, rel).split('\n').some(l => l.startsWith('assignee:')),
    H.readInBacklog(d, rel));

  const after = H.runJson(['list', '--assignee='], { cwd: d });
  T.exit('list --assignee= after the clear', after, 0);
  T.eq('the cleared element now matches the unassigned filter',
    ids(after.json), ['EPIC-001']);
}

T.finish();
