/* Edge — NC17 gap: order of `doctor`'s `problems[]`.
 *
 * RULED (lead): NOT pinned. § 9 (Z. 551-553) gives an explicit, normative sort
 * rule for `list`/`tree`/bare `nj` ("deterministic: priority … then id
 * ascending. Never filesystem order.") — proof the spec authors know how to
 * write an order rule when they mean one, and did write one, elsewhere in the
 * same section. No equivalent sentence exists for `doctor`'s `problems[]`
 * (confirmed: no hit for order/sort/first/before near "problems" anywhere in
 * SPECIFICATION.md). § 14's terminal transcript (Z. 884-886, two `ERROR`
 * lines before one `WARNING` line) is worked-example prose, not a rule —
 * contrast the numbered `--fix` step list in the same section, which *is*
 * normative. An initial reading here ("errors precede warnings") was tested
 * and came back red against c1-baseline (nj returned
 * `["warning","error","error","error"]`); escalated rather than weakened, and
 * the lead ruled it unpinned on the grounds above.
 *
 * What stays assertable under EVERY reading: the fixture produces the right
 * findings with the right severities. No order assertion remains.
 *
 * The fixture is kept exactly as built, because it is still useful: the
 * WARNING-causing element sorts FIRST by every ordering `nj` is known to use
 * elsewhere (id ascending, creation order, directory listing), and the two
 * ERROR-causing elements sort LAST by all of those — so "severity-grouped"
 * and "nj's incidental scan order" make different, distinguishable
 * predictions on this exact data. If the spec owner ever pins an order, the
 * one-line reactivation is the same `lastIndexOf`/`indexOf` check this file
 * used to carry.
 */
import * as H from '../lib/harness.mjs';
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

// AAA sorts first alphabetically/by id/by creation order/by directory listing
// — it is the WARNING case (unknown status). ZZZ and ZZZ2 sort last by every
// one of those — they are the ERROR cases (duplicate_id). If `problems[]`
// merely reflected scan/creation/id order, AAA's warning would lead; the
// severity-grouped reading requires it to trail both errors instead.
const d = H.mkBacklog({
  label: 'order-doctor-severity',
  files: {
    'epics/AAA-001.md': H.element({
      // AAA-001 is a hand-placed file name so it sorts before the ZZZ files
      // in every plain-string / directory-listing order; its content is the
      // WARNING case: an unknown status value.
      id: 'AAA-001', type: 'epic', title: 'First alphabetically, a warning',
      status: 'not-a-real-status', created: NOW, updated: NOW,
    }, '# First alphabetically, a warning\n\n## Description\nD\n'),
    'epics/ZZZ-001.md': H.element({
      id: 'ZZZ-001', type: 'epic', title: 'Last alphabetically, an error (dup A)',
      status: 'todo', created: NOW, updated: NOW,
    }, '# Last alphabetically, an error (dup A)\n\n## Description\nD\n'),
    'epics/ZZZ-002.md': H.element({
      // Same id as ZZZ-001 -> duplicate_id, an ERROR, on the two
      // latest-sorting files in the backlog.
      id: 'ZZZ-001', type: 'epic', title: 'Last alphabetically, an error (dup B)',
      status: 'todo', created: NOW, updated: NOW,
    }, '# Last alphabetically, an error (dup B)\n\n## Description\nD\n'),
  },
  tombstones: ['AAA-001', 'ZZZ-001'],
});

const doc = H.runJson(['doctor'], { cwd: d });
T.exit('doctor --json on a backlog with both severities', doc, 2);

const problems = (doc.json && doc.json.problems) || [];
T.check('the fixture really produced both an error and a warning (non-vacuous)',
  problems.some(p => p.severity === 'error') && problems.some(p => p.severity === 'warning'),
  J(problems));

// RULED not pinned (see file header) — no order assertion. Reactivation, if
// the spec owner ever pins one, is this one line:
//   const severities = problems.map(p => p.severity);
//   T.check('errors precede warnings', severities.lastIndexOf('error') <
//     severities.indexOf('warning'), J(severities));

/* Set equality closes the half containment cannot see. Derived from § 7 for
 * this fixture: AAA-001 carries a status outside the configured list
 * (`unknown:status`), and ZZZ-001.md / ZZZ-002.md both carry `id: ZZZ-001`
 * (`duplicate_id` ×2) with ZZZ-002.md's name disagreeing with it
 * (`id:mismatch`). */
T.sameSet('the findings are exactly § 7\'s set for this fixture',
  H.doctorSet(doc) || ['<no problems array>'],
  ['unknown:status:warning', 'duplicate_id:error', 'duplicate_id:error',
    'id:mismatch:error']);

T.finish();
