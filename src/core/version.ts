'use strict';

// The one version string both binaries report (§ 9 "--version", § 17,
// D151): embedded at build time by tools/bundle.ts's esbuild `define`,
// from package.json's own "version" field — never read at runtime, so
// dist/nanojira and dist/nanojira-mcp cannot drift apart from each other or from a
// package.json a user's install happens to have changed since building.
declare const __NJ_VERSION__: string;

const VERSION: string = __NJ_VERSION__;

/** `"X.Y.Z"` (exactly three dot-separated non-negative integers) -> the
 * tuple, or `null` for any other shape (§ 5 "minVersion", DECISIONS 166) --
 * never a string compare, so `"3.9.0"` correctly reads as older than
 * `"3.10.0"`. */
function parseVersionTuple(s: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
function compareVersionTuples(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export { VERSION, parseVersionTuple, compareVersionTuples };
