/* export-kernel is retired (DECISIONS 239, TSK-062): from 4.8.0
 * src/core/kernel.ts is a vendored copy of cli-kernel, whose own
 * tools/export.mts exports and checks it. The old tool stays as a pointer:
 * whatever it is called with, it names cli-kernel's tools/export.mts on
 * stderr, writes nothing and exits 2. The export and its checks are
 * cli-kernel's tests now; test/edge/kernel-neutral.ts checks the copy here.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(ROOT, 'tools', 'export-kernel.mts');
const dir = H.freshDir('xkernel-pointer');

for (const args of [[], ['v4.8.0', 'kernel.ts'], ['--check', 'kernel.ts'], ['v4.8.0', 'kernel.ts', '--check']]) {
  const label = args.length === 0 ? '(no arguments)' : args.join(' ');
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  T.check('export-kernel ' + label + ': exit 2', r.status === 2, 'status ' + r.status + ': ' + r.stderr);
  T.check('export-kernel ' + label + ': names cli-kernel\'s tools/export.mts',
    /retired in nanojira 4\.8\.0/.test(r.stderr) && /<cli-kernel>\/tools\/export\.mts <tag> <dest-file>/.test(r.stderr), r.stderr);
  T.check('export-kernel ' + label + ': prints nothing on stdout', r.stdout === '', r.stdout);
  T.eq('export-kernel ' + label + ': writes nothing', fs.readdirSync(dir), []);
}
T.finish();
