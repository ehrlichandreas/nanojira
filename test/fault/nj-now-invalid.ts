/* Fault injection — invalid NJ_NOW (§ 12).
 *
 * "NJ_NOW=<ISO-8601 UTC> fixes the clock ... an invalid value exits 1."
 *
 * The hook is what makes byte-exact golden comparison possible, so a silent
 * fallback to the real clock would be the worst outcome: every golden test
 * would start failing intermittently instead of failing once, loudly, here.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

/* Only unambiguous format violations belong here. Two plausible-looking cases
 * are deliberately NOT asserted, because the spec does not decide them:
 *   ''  — an empty value is "set but empty"; whether that is invalid or means
 *         "unset" is not stated.
 *   '2026-13-45T99:99:99Z' — shape-valid, semantically impossible. A regex
 *         validator accepts it; only a calendar check rejects it. § 12 says
 *         "an invalid value exits 1" without saying which kind of invalid.
 * Both are listed in AMBIGUITIES.md. Asserting either would be guessing. */
const BAD = [
  '2026-09-21 18:00:00',      // no T, no Z — a plausible hand-written typo
  '2026-09-21T18:00:00',      // missing the Z
  '2026-09-21T18:00:00+02:00',// an offset instead of UTC
  'yesterday',
  '2026-09-21',
  'not-a-date',
];

for (const value of BAD) {
  const d = H.freshDir('fault-now');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  const r = H.runNj(['new', '--type=epic', '--title=Auth'],
    { cwd: d, env: { NJ_NOW: value } });
  T.exit('NJ_NOW=' + JSON.stringify(value) + ' exits 1', r, 1);
  T.check('NJ_NOW=' + JSON.stringify(value) + ': nothing was written',
    H.lsOrEmpty(path.join(d, 'backlog', 'epics')).length === 0,
    'epics/: ' + JSON.stringify(H.lsOrEmpty(path.join(d, 'backlog', 'epics'))));
}

/* A valid value must of course be accepted, and used verbatim. */
{
  const d = H.freshDir('fault-now-ok');
  H.runNj(['init'], { cwd: d });
  T.exit('a valid NJ_NOW is accepted',
    H.runNj(['new', '--type=epic', '--title=Auth'],
      { cwd: d, env: { NJ_NOW: '2026-01-02T03:04:05Z' } }), 0);
  const body = H.readOrNull(path.join(d, 'backlog', 'epics', 'EPIC-001.md'));
  T.check('the element was created', body !== null, 'EPIC-001.md was not written');
  T.contains('created uses the pinned clock verbatim', body || '', 'created: 2026-01-02T03:04:05Z');
  T.contains('updated uses the pinned clock verbatim', body || '', 'updated: 2026-01-02T03:04:05Z');
}

T.finish();
