// Oracle suites that are CANNOT RUN on purpose where the environment lacks
// what they need: known, named and reasoned, so they neither stop every gate
// with exit 4 nor pass unseen. baseline.ts and gate.ts report each one BY
// NAME on every run, and any CANNOT RUN not listed here is still a coverage
// gap (exit 4).
//
// A suite listed here is also verdict-only in baseline.ts: it runs directly,
// never through the shim, so the corpus does not depend on whether the
// recording machine could run it. Otherwise a corpus recorded where it could
// not run would be missing its calls on a machine where it can, and every
// later call would show up shifted.
//
// An entry is a decision, like VERDICT_ONLY_SUITES: add one only with the
// reason, and the commit that made the suite environment-conditional.

export interface ExpectedGap {
  suite: string;
  reason: string;
}

const expectedGaps: ExpectedGap[] = [
  {
    suite: 'edge/hardening-njrc-foreign-link.mjs',
    reason:
      'needs root, or a symlink owned by another non-root uid on the scratch filesystem, to prove ' +
      'a foreign-owned .njrc link is refused (DECISIONS 98); a normal user account on this machine ' +
      'has neither (718c230)',
  },
  {
    suite: 'ac/ac-15-no-dependencies.mjs',
    reason:
      "searches a fixed set of paths relative to its own location for the runtime Node (§ 3: " +
      'workspace/portable/runtime/<platform>/bin/node), honouring NJ_NODE only as an explicit ' +
      "override; this recording machine's runtime lives somewhere else entirely, none of the " +
      'fixed paths exist, and NJ_NODE is deliberately left unset here so every suite is driven ' +
      'the same way the suite itself is designed to be run',
  },
];

export default expectedGaps;
