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

/* Format violations. The two boundary cases AMBIGUITIES.md 15 left open
 * are decided since (§ 12 "Clock pinning", DECISIONS 207: "empty means
 * unset, otherwise exactly YYYY-MM-DDTHH:MM:SSZ and a real instant") and
 * pinned at the end of this file, with trailing text after the Z. */
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

/* The rule's edges, one check each (found by mutants, TSK-050): the shape
 * is anchored at both ends, the instant must be real, and empty is unset. */
for (const [value, refused, what] of [
  ['2026-01-02T03:04:05Zx', true, 'trailing text after the Z is invalid_env'],
  ['2026-13-02T03:04:05Z', true, 'a month 13 (right shape, no such instant) is invalid_env'],
  ['', false, 'empty means unset: the wall clock, exit 0'],
] as const) {
  const d = H.freshDir('fault-now-edge');
  H.runNj(['init'], { cwd: d });
  const r = H.runJson(['new', '--type=epic', '--title=Auth'], { cwd: d, env: { NJ_NOW: value } });
  // The code, not just exit 1: a missing backlog would exit 1 as well.
  if (refused) T.eq('NJ_NOW=' + JSON.stringify(value) + ': ' + what, r.json && r.json.error, 'invalid_env');
  else T.exit('NJ_NOW=' + JSON.stringify(value) + ': ' + what, r, 0);
}

T.finish();
