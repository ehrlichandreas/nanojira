/* export-skill exports only a tag signed by the pinned release key
 * (TSK-040 step A; DECISIONS 226).
 *
 * tools/export-skill.mts ran `git tag -v` only, so a tag signed by ANY key
 * in the verifier's keyring passed: the 2026-10-18 survey (§ 6) exported a
 * tag signed by a freshly generated "Mallory" key. Now package.json's
 * "releaseKey" pins the release key's primary fingerprint, and the export
 * needs a VALIDSIG from exactly that key (`git verify-tag --raw`); an
 * expired or revoked pinned key, another key, or a pin that is not 40 hex
 * digits is refused before anything is written. The tag's name is bound
 * too: refs/tags/<tag> is resolved once and must be a tag object that
 * names <tag> itself (TSK-040 A R1).
 *
 * Every key here is generated into a throwaway GNUPGHOME under TMPDIR;
 * every gpg and git call passes that GNUPGHOME, so the user's keyring is
 * never read or written. The pin is read from the package.json beside the
 * script (DECISIONS 226), so the fixture repo carries its own copy of the
 * tools and its own pin.
 *
 * Written before the fix: red against cd29035.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);

const GNUPGHOME = H.freshDir('xkey-gnupg');
fs.chmodSync(GNUPGHOME, 0o700);
const ENV: Record<string, string> = Object.assign({}, process.env as Record<string, string>,
  { GNUPGHOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

function gpg(args: string[]) {
  const r = spawnSync('gpg', ['--batch'].concat(args), { env: ENV, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) T.check('fixture: gpg ' + args.join(' '), false, r.stderr);
  return r;
}
/** A new ed25519 signing key; returns its primary fingerprint. */
function newKey(name: string, extra: string[] = [], expire = '0'): string {
  gpg(extra.concat(['--passphrase', '', '--quick-gen-key', name + ' <' + name.toLowerCase() + '@example.invalid>', 'ed25519', 'sign', expire]));
  const list = gpg(['--list-secret-keys', '--with-colons', name.toLowerCase() + '@example.invalid']).stdout;
  const m = /^fpr:::::::::([0-9A-F]{40}):/m.exec(list);
  T.check('fixture: fingerprint of ' + name, !!m, list);
  return m ? m[1] : '';
}

const OWNER = newKey('Owner');
const MALLORY = newKey('Mallory');
/* Created and used to sign on 2020-01-01, valid for one day: expired now. */
const FAKED = ['--faked-system-time', '20200101T000000'];
const EXPIRED = newKey('Expiring', FAKED, '1d');

/* The fixture repo: the shipped files export-skill copies, the tools beside
 * their own package.json, one commit, one tag per signer. */
const repo = H.freshDir('xkey-repo');
function git(args: string[], env: Record<string, string> = ENV) {
  const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) T.check('fixture: git ' + args.join(' '), false, r.stderr);
  return r;
}
git(['init', '-q']);
for (const rel of ['SKILL.md', 'LICENSE', 'bin/nanojira', 'bin/nanojira-mcp', 'bin/nanojira.cmd', 'bin/nanojira-mcp.cmd',
  'dist/nanojira.mjs', 'dist/nanojira-mcp.mjs', 'tools/export-skill.mts', 'tools/release-key.mts']) {
  if (!fs.existsSync(path.join(ROOT, rel))) continue; // release-key.mts: absent before the fix
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(repo, rel));
}
function pin(value: unknown) {
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nanojira', version: '0.0.1', releaseKey: value }) + '\n');
}
pin(OWNER);
git(['add', '-A']);
git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture']);
function signedTag(name: string, key: string, gpgProgram = 'gpg') {
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'user.signingkey=' + key,
    '-c', 'gpg.program=' + gpgProgram, 'tag', '-s', name, '-m', name]);
}
signedTag('v-owner', OWNER);
signedTag('v-mallory', MALLORY);
const fakedGpg = path.join(GNUPGHOME, 'gpg-2020.sh');
fs.writeFileSync(fakedGpg, '#!/bin/sh\nexec gpg ' + FAKED.join(' ') + ' "$@"\n', { mode: 0o755 });
signedTag('v-expired', EXPIRED, fakedGpg);

function exportTag(tag: string, label: string, env: Record<string, string> = ENV) {
  const dest = path.join(H.freshDir('xkey-dest-' + label), 'exported');
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'export-skill.mts'), tag, dest],
    { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
  return { status: r.status, stderr: r.stderr || '', written: fs.existsSync(dest) };
}
/** A refusal: exit 2, one stderr line with `code`, naming `found` and the pin, nothing written. */
function refused(what: string, r: ReturnType<typeof exportTag>, code: string, names: string[]) {
  const lines = r.stderr.split('\n').filter(Boolean);
  T.check(what + ': exit 2, one stderr line', r.status === 2 && lines.length === 1, r.status + ' ' + J(r.stderr));
  T.check(what + ': the line names ' + code + ' and ' + names.join(', '),
    lines.length === 1 && lines[0].includes(code) && names.every((n) => lines[0].includes(n)), J(r.stderr));
  T.check(what + ': nothing written', !r.written, '');
}

/* K1 — the pinned key's tag exports */
{
  const r = exportTag('v-owner', 'owner');
  T.check('K1 tag signed by the pinned key: exported', r.status === 0 && r.written, r.status + ' ' + J(r.stderr));
}

/* K2 — another key in the keyring: refused, naming both fingerprints */
refused('K2 tag signed by Mallory', exportTag('v-mallory', 'mallory'), 'release_key_mismatch', [OWNER, MALLORY]);

/* K6 — the name is bound: another ref to the genuine tag object (a
 * lightweight alias, a ref written by hand) is refused, so an old signed
 * tag cannot be replayed under a new name; the genuine name still exports. */
{
  git(['tag', 'v-alias', 'v-owner']);
  git(['update-ref', 'refs/tags/v-renamed', 'refs/tags/v-owner']);
  for (const name of ['v-alias', 'v-renamed']) {
    const r = exportTag(name, name);
    const lines = r.stderr.split('\n').filter(Boolean);
    T.check('K6 ' + name + ' -> the v-owner tag object: refused, tag_invalid naming both names, nothing written',
      r.status === 2 && lines.length === 1 && lines[0].includes('tag_invalid') && lines[0].includes(J('v-owner')) &&
      lines[0].includes(J(name)) && !r.written, r.status + ' ' + J(r.stderr));
  }
  const nl = exportTag('v-owner\nforged line', 'newline');
  T.check('K6 a name with a newline: quoted, one stderr line', nl.status === 2 && nl.stderr.split('\n').filter(Boolean).length === 1 &&
    nl.stderr.includes(J('v-owner\nforged line')), J(nl.stderr));
  const again = exportTag('v-owner', 'owner-again');
  T.check('K6 the genuine v-owner still exports', again.status === 0 && again.written, again.status + ' ' + J(again.stderr));
}

/* K7 — the reason says what went wrong: the release key missing from the
 * keyring (gpg pairs NO_PUBKEY with ERRSIG), gpg not running at all (no
 * status for a signed tag), and an annotated tag with no signature. */
{
  const empty = H.freshDir('xkey-empty-gnupg');
  fs.chmodSync(empty, 0o700);
  const nokey = exportTag('v-owner', 'nokey', Object.assign({}, ENV, { GNUPGHOME: empty }));
  refused('K7 release key not in the keyring', nokey, 'release_key_mismatch', [OWNER, 'signing key not in the keyring']);
  const nogpg = exportTag('v-owner', 'nogpg', Object.assign({}, ENV,
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'gpg.program', GIT_CONFIG_VALUE_0: path.join(empty, 'no-such-gpg') }));
  refused('K7 gpg missing', nogpg, 'release_key_mismatch', [OWNER, 'gpg printed no status']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'tag', '-a', 'v-unsigned', '-m', 'unsigned']);
  refused('K7 annotated tag without a signature', exportTag('v-unsigned', 'unsigned'), 'release_key_mismatch', ['(no signature)']);
}

/* K3 — an expired pinned key */
pin(EXPIRED);
refused('K3 tag signed by the pinned key, now expired', exportTag('v-expired', 'expired'), 'release_key_mismatch', [EXPIRED]);

/* K4 — a pin that is not 40 hex digits; checked before the tag */
pin(OWNER.slice(0, 39));
refused('K4 pin of 39 hex digits', exportTag('v-owner', 'badpin'), 'release_key_invalid', [OWNER.slice(0, 39)]);

/* K5 — a revoked pinned key (gpg's own revocation certificate, imported) */
{
  pin(OWNER);
  const rev = path.join(GNUPGHOME, 'openpgp-revocs.d', OWNER + '.rev');
  const cert = fs.readFileSync(rev, 'utf8').replace(/^:-----BEGIN/m, '-----BEGIN');
  const certFile = path.join(GNUPGHOME, 'owner-revoke.asc');
  fs.writeFileSync(certFile, cert);
  gpg(['--import', certFile]);
  refused('K5 tag signed by the pinned key, now revoked', exportTag('v-owner', 'revoked'), 'release_key_mismatch', [OWNER]);
}

T.finish();
