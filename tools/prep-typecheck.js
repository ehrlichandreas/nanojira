#!/usr/bin/env node
'use strict';

// tsc cannot resolve a file with no extension at all -- confirmed:
// `tsc nj` fails with TS6231 regardless of how it is named in tsconfig
// (`files`, `include`, or a CLI argument), because its module resolution
// only tries '.ts'/'.js'/… suffixes, never an exact extensionless path.
// `nj` itself must stay extensionless (§ 3, the shipped entry point) and
// unmodified, so this makes a throwaway, gitignored `.js` copy for tsc to
// read instead -- byte-for-byte identical, shebang included (tsc accepts a
// leading `#!` line in a .js file). `npm run typecheck` runs this first.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
fs.copyFileSync(path.join(ROOT, 'nj'), path.join(ROOT, '.nj.tsc-shadow.js'));
