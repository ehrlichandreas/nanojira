'use strict';

// The one id-shape check (§ 6): `EPIC-<n>`, `TSK-<n>` or `SUB-<n>`. An id
// read from a frontmatter is otherwise taken as written, so an id is checked
// here wherever it is about to become part of a path — the claim directory
// `.nanojira/claims/<id>/`, the file name `doctor --fix` renames to, the
// folder `hierarchy` gives an epic or task. A malformed id never names a
// path: a write that would need one is refused (`refused:invalid_id`, § 9),
// a read that would need one finds nothing (DECISIONS 215, TSK-033).

import { fail } from './output.ts';

// At most 15 digits: every number stays a safe integer (2^53 has 16) and
// every file or folder name made from an id stays far below the usual
// 255-byte limit — `TSK-<300 digits>` once reached `mkdir`/`rename` and died
// with a raw ENAMETOOLONG (DECISIONS 215).
const ID_SHAPE = /^(EPIC|TSK|SUB)-\d{1,15}$/;

function idShaped(id: string): boolean {
  return ID_SHAPE.test(id);
}

const INVALID_ID_HINT = 'give the element an id of the form EPIC-<n>, TSK-<n> or SUB-<n> by hand (and rename its file to match), then run `nanojira doctor`';

/** Refuses before anything is written when one of `ids` is malformed. */
function requireIdShaped(ids: string[], verb: string): void {
  const bad = ids.filter((id) => !idShaped(id));
  if (bad.length === 0) return;
  const names = bad.map((id) => `  ${JSON.stringify(id)}`).join('\n');
  fail('refused:invalid_id', `${verb} is refused — ${bad.length === 1 ? 'this id is' : 'these ids are'} not of the form EPIC-<n>, TSK-<n> or SUB-<n> (§ 6), so no path may be made from ${bad.length === 1 ? 'it' : 'them'}:\n${names}`,
    INVALID_ID_HINT);
}

export { ID_SHAPE, idShaped, requireIdShaped };
