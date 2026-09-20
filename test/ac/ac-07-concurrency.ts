/* AC-7 — Concurrency.
 *
 * The test itself lives in test/stress/concurrency.ts because it needs a
 * 20-wide process pool and an async event loop, which would drown out every
 * other AC file's structure. This wrapper keeps the "one executable file per
 * acceptance criterion" contract: it forwards the nj path and mirrors the
 * exit code.
 */
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, '..', 'stress', 'concurrency.ts');
const nj = H.NJ;
const r = spawnSync(H.NODE, [script, ...(nj ? [nj] : [])], {
  encoding: 'utf8',
  env: process.env,
  timeout: 300000,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.error) {
  console.log('FAIL ac-07-concurrency.ts — could not run stress/concurrency.ts: ' + r.error.message);
  process.exit(1);
}
process.exit(r.status === 0 ? 0 : 1);
