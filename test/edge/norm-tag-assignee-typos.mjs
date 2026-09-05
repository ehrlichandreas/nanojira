/* Edge — NC10 gap: typo'd variants of `--tag`/`--assignee`.
 *
 * § 9 (Z. 459-462): "Unknown field flags are rejected — nothing is written —
 * and the known fields are listed. A control flag that the addressed command
 * does not take is rejected the same way, as `unknown_field` (e.g. `nj
 * archive --force`, § 12)." The `archive --force` example shows the rule is
 * not scoped to write-only flags: it fires for ANY flag the command does not
 * recognise, control or schema.
 *
 * § 9 (Z. 548-550), on `list` specifically: "a typo'd filter is an error
 * (exit 1), never a silently empty result."
 *
 * `nj list`'s synopsis (§ 9) names `--tag` (singular) as the filter; `--tags`
 * (plural) is the WRITE flag for `new`/`set`. Using the write flag's name as
 * a list filter is exactly the typo this file targets: a plausible mistake
 * (the schema field is `tags`, plural) that the CLI must reject, not
 * silently ignore or silently treat as `--tag`.
 *
 * Mutation probe: each typo'd call is paired with the CORRECT flag name on
 * the same fixture, so the test does not just check "always rejects" — it
 * shows the boundary between "recognised" and "typo'd" actually exists.
 */
import path from 'path';
import * as H from '../lib/harness.mjs';
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

function backlog() {
  return H.mkBacklog({ label: 'norm-typo' });
}

/* ---- `list --tags=` (plural — the write flag's name, not the filter's) -- */
{
  const d = backlog();
  T.exit('nj new (tagged)', H.runNj(['new', '--type=epic', '--title=X',
    '--tags=alpha'], { cwd: d }), 0);

  const typo = H.runJson(['list', '--tags=alpha'], { cwd: d });
  T.exit('list --tags= (typo: plural, the write-flag name) is rejected', typo, 1);
  T.eq('the rejection carries the closed-vocabulary code unknown_field (§ 9)',
    typo.json && typo.json.error, 'unknown_field');
  T.check('the error mentions the known field, so a caller can self-correct (§ 9 "known fields are listed")',
    /\btag\b/i.test((typo.json && JSON.stringify(typo.json)) || ''),
    J(typo.json));

  // The boundary: the CORRECT singular name on the identical fixture works.
  const correct = H.runJson(['list', '--tag=alpha'], { cwd: d });
  T.exit('list --tag= (the real filter) is accepted', correct, 0);
  T.check('and it actually finds the tagged element — not vacuously accepted',
    ((correct.json && correct.json.entries) || []).some(e => e.id === 'EPIC-001'),
    J(correct.json));
}

/* ---- `list --asignee=` (missing an "s" — a plausible typo) -------------- */
{
  const d = backlog();
  T.exit('nj new (assigned)', H.runNj(['new', '--type=epic', '--title=X',
    '--assignee=coder-agent'], { cwd: d }), 0);

  const typo = H.runJson(['list', '--asignee=coder-agent'], { cwd: d });
  T.exit('list --asignee= (typo) is rejected', typo, 1);
  T.eq('the rejection carries the closed-vocabulary code unknown_field (§ 9)',
    typo.json && typo.json.error, 'unknown_field');

  const correct = H.runJson(['list', '--assignee=coder-agent'], { cwd: d });
  T.exit('list --assignee= (correctly spelled) is accepted', correct, 0);
  T.check('and it actually finds the assigned element — not vacuously accepted',
    ((correct.json && correct.json.entries) || []).some(e => e.id === 'EPIC-001'),
    J(correct.json));
}

/* ---- the same typo on a WRITE command: `nj new --assigne=` (missing an e) */
{
  const d = backlog();
  const typo = H.runJson(['new', '--type=epic', '--title=X', '--assigne=coder-agent'],
    { cwd: d });
  T.exit('nj new --assigne= (typo, write side) is rejected', typo, 1);
  T.eq('the rejection carries the closed-vocabulary code unknown_field (§ 9)',
    typo.json && typo.json.error, 'unknown_field');
  T.check('nothing was written — no element exists at all (§ 9 "nothing is written")',
    H.lsOrEmpty(path.join(d, 'backlog', 'epics')).length === 0,
    'epics/: ' + J(H.lsOrEmpty(path.join(d, 'backlog', 'epics'))));

  const correct = H.runJson(['new', '--type=epic', '--title=X', '--assignee=coder-agent'],
    { cwd: d });
  T.exit('nj new --assignee= (correctly spelled) is accepted', correct, 0);
}

T.finish();
