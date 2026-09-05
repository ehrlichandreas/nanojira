/* AC-7 — Concurrency.
 *
 * The test itself lives in test/stress/concurrency.mjs because it needs a
 * 20-wide process pool and an async event loop, which would drown out every
 * other AC file's structure. This wrapper keeps the "one executable file per
 * acceptance criterion" contract: it forwards the nj path and mirrors the
 * exit code.
 */
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, '..', 'stress', 'concurrency.mjs');
const r = spawnSync(H.NODE, [script].concat(H.NJ ? [H.NJ] : []), {
  encoding: 'utf8',
  env: process.env,
  timeout: 300000,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.error) {
  console.log('FAIL ac-07-concurrency.js — could not run stress/concurrency.js: ' + r.error.message);
  process.exit(1);
}
process.exit(r.status === 0 ? 0 : 1);
