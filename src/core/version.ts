'use strict';

// The one version string both binaries report (§ 9 "--version", § 17,
// D151): embedded at build time by tools/bundle.js's esbuild `define`,
// from package.json's own "version" field — never read at runtime, so
// dist/nj and dist/nj-mcp cannot drift apart from each other or from a
// package.json a user's install happens to have changed since building.
declare const __NJ_VERSION__: string;

const VERSION: string = __NJ_VERSION__;

export { VERSION };
