/* export-kernel exports src/core/kernel.ts from a signed release tag with a
 * provenance header, and --check tells a local edit from an update
 * (TSK-057, feedback from the nanoadr team).
 *
 * Signature verification itself (the pinned release key, an expired or
 * revoked key, a missing key, a renamed-ref replay, a pin that is not 40
 * hex digits) is tools/release-key.mts's own job, already exhaustively
 * covered by test/tools/export-skill-key.ts against the exact same
 * helpers export-kernel.mts calls -- this file only proves export-kernel
 * wires that check in (one refused leg) and its own kernel-specific
 * behaviour: the header line's exact shape, the sha256 it records, the
 * symlink/non-regular-file destination refusal, and --check.
 *
 * Every key here is generated into a throwaway GNUPGHOME under TMPDIR; the
 * user's keyring is never read or written.
 */
import * as crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);

const GNUPGHOME = H.freshDir('xkernel-gnupg');
fs.chmodSync(GNUPGHOME, 0o700);
const ENV: Record<string, string> = Object.assign({}, process.env as Record<string, string>,
  { GNUPGHOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

function gpg(args: string[]) {
  const r = spawnSync('gpg', ['--batch'].concat(args), { env: ENV, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) T.check('fixture: gpg ' + args.join(' '), false, r.stderr);
  return r;
}
function newKey(name: string): string {
  gpg(['--passphrase', '', '--quick-gen-key', name + ' <' + name.toLowerCase() + '@example.invalid>', 'ed25519', 'sign', '0']);
  const list = gpg(['--list-secret-keys', '--with-colons', name.toLowerCase() + '@example.invalid']).stdout;
  const m = /^fpr:::::::::([0-9A-F]{40}):/m.exec(list);
  T.check('fixture: fingerprint of ' + name, !!m, list);
  return m ? m[1] : '';
}

const OWNER = newKey('Owner');
const MALLORY = newKey('Mallory');

const repo = H.freshDir('xkernel-repo');
function git(args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, env: ENV, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) T.check('fixture: git ' + args.join(' '), false, r.stderr);
  return r;
}
git(['init', '-q']);
for (const rel of ['tools/export-kernel.mts', 'tools/release-key.mts']) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(repo, rel));
}
const KERNEL_BODY = "'use strict';\n\n// a fixture kernel.ts, standing in for the real one.\nexport const x = 1;\n";
fs.mkdirSync(path.join(repo, 'src', 'core'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'core', 'kernel.ts'), KERNEL_BODY);
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nanojira', version: '0.0.1', releaseKey: OWNER }) + '\n');
git(['add', '-A']);
git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture']);
const commit = git(['rev-parse', 'HEAD']).stdout.trim();
function signedTag(name: string, key: string) {
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'user.signingkey=' + key, 'tag', '-s', name, '-m', name]);
}
signedTag('v-owner', OWNER);
signedTag('v-mallory', MALLORY);

function exportKernel(args: string[], label: string) {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'export-kernel.mts')].concat(args),
    { cwd: repo, env: ENV, encoding: 'utf8', timeout: 30000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const EXPECTED_SHA = crypto.createHash('sha256').update(KERNEL_BODY).digest('hex');

/* K1 — the pinned key's tag exports: header line's exact shape, body byte
 * for byte, sha256 matches the fixture kernel.ts */
{
  const dest = path.join(H.freshDir('xkernel-dest-k1'), 'kernel.ts');
  const r = exportKernel(['v-owner', dest], 'k1');
  T.check('K1 exit 0', r.status === 0, J(r));
  const written = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  T.eq('K1 header line', written.split('\n')[0] + '\n',
    `// nanojira kernel v-owner commit ${commit} sha256 ${EXPECTED_SHA}\n`);
  T.eq('K1 body is the fixture kernel.ts, byte for byte', written.slice(written.indexOf('\n') + 1), KERNEL_BODY);
}

/* K2 — a tag signed by another key (not the pin) is refused, nothing
 * written: proves the wiring into release-key.mts's own check, not a
 * weaker one of export-kernel's own */
{
  const dest = path.join(H.freshDir('xkernel-dest-k2'), 'kernel.ts');
  const r = exportKernel(['v-mallory', dest], 'k2');
  T.check('K2 exit 2', r.status === 2, J(r));
  T.check('K2 release_key_mismatch', r.stderr.includes('release_key_mismatch'), J(r.stderr));
  T.check('K2 nothing written', !fs.existsSync(dest), '');
}

/* K3 — an unknown tag name is refused, nothing written */
{
  const dest = path.join(H.freshDir('xkernel-dest-k3'), 'kernel.ts');
  const r = exportKernel(['v-does-not-exist', dest], 'k3');
  T.check('K3 exit 2, tag_invalid', r.status === 2 && r.stderr.includes('tag_invalid'), J(r));
  T.check('K3 nothing written', !fs.existsSync(dest), '');
}

/* K4 — a symlinked destination is refused before anything is read from git */
{
  const dir = H.freshDir('xkernel-dest-k4');
  const real = path.join(dir, 'real.ts');
  const dest = path.join(dir, 'link.ts');
  fs.writeFileSync(real, 'old\n');
  fs.symlinkSync(real, dest);
  const r = exportKernel(['v-owner', dest], 'k4');
  T.check('K4 exit 2, names "symlink"', r.status === 2 && r.stderr.includes('symlink'), J(r));
  T.eq('K4 the symlink target is untouched', fs.readFileSync(real, 'utf8'), 'old\n');
}

/* K5 — a destination that exists and is a directory (not a regular file)
 * is refused */
{
  const dest = path.join(H.freshDir('xkernel-dest-k5'), 'adir');
  fs.mkdirSync(dest);
  const r = exportKernel(['v-owner', dest], 'k5');
  T.check('K5 exit 2, not a regular file', r.status === 2 && r.stderr.includes('not a regular file'), J(r));
}

/* K6 — --check: a freshly exported file matches; a local edit does not,
 * exit 1 with a one-line reason; a file with no header is also exit 1 */
{
  const dest = path.join(H.freshDir('xkernel-dest-k6'), 'kernel.ts');
  exportKernel(['v-owner', dest], 'k6-export');
  const ok = exportKernel(['--check', dest], 'k6-ok');
  T.check('K6 check on an unmodified export: exit 0', ok.status === 0, J(ok));

  fs.appendFileSync(dest, '// edited locally\n');
  const edited = exportKernel(['--check', dest], 'k6-edited');
  T.check('K6 check after a local edit: exit 1', edited.status === 1, J(edited));
  const lines = edited.stderr.split('\n').filter(Boolean);
  T.check('K6 edited: one stderr line, naming the mismatch', lines.length === 1 && lines[0].includes('no longer matches'), J(edited.stderr));

  const noHeader = path.join(H.freshDir('xkernel-dest-k6b'), 'plain.ts');
  fs.writeFileSync(noHeader, "'use strict';\n");
  const nh = exportKernel(['--check', noHeader], 'k6-noheader');
  T.check('K6 check on a file with no header: exit 1', nh.status === 1, J(nh));
}

T.finish();
