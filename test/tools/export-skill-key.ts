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
 * K8-K10 (DECISIONS 240, TSK-062): every git call ignores GIT_DIR and its
 * family, one-off GIT_CONFIG_* and replace objects (refs/replace/ and
 * GIT_REPLACE_REF_BASE); a tag must point at a commit (not a tree, not
 * another tag) whose package.json is named like the running checkout's.
 * K11-K12 (DECISIONS 241, TSK-063): and whose subject starts with
 * '<name> <tag>: ', as every real release tag's does.
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
/* The fixture's own git must see replace refs (K8b's probe), even under
 * release.ts's gate, which runs the suite with GIT_NO_REPLACE_OBJECTS=1. */
for (const name of ['GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[name];

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
// A release commit's subject: '<name> <tag>: <title>' (K11).
git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'nanojira v-owner: fixture']);
function signedTag(name: string, key: string, gpgProgram = 'gpg', target: string[] = []) {
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'user.signingkey=' + key,
    '-c', 'gpg.program=' + gpgProgram, 'tag', '-s', name, '-m', name].concat(target));
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
  const skill = fs.existsSync(path.join(dest, 'SKILL.md')) ? fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8') : null;
  return { status: r.status, stderr: r.stderr || '', written: fs.existsSync(dest), skill };
}
const GENUINE_SKILL = fs.readFileSync(path.join(repo, 'SKILL.md'), 'utf8');
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
  // gpg.program from a config file git trusts (one-off GIT_CONFIG_* is
  // ignored since DECISIONS 240, K8d).
  const noGpgConfig = path.join(empty, 'gitconfig');
  fs.writeFileSync(noGpgConfig, '[gpg]\n\tprogram = ' + path.join(empty, 'no-such-gpg') + '\n');
  const nogpg = exportTag('v-owner', 'nogpg', Object.assign({}, ENV, { GIT_CONFIG_GLOBAL: noGpgConfig }));
  refused('K7 gpg missing', nogpg, 'release_key_mismatch', [OWNER, 'gpg printed no status']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'tag', '-a', 'v-unsigned', '-m', 'unsigned']);
  refused('K7 annotated tag without a signature', exportTag('v-unsigned', 'unsigned'), 'release_key_mismatch', ['(no signature)']);
}

/* K8 — git's environment cannot redirect the check (DECISIONS 240). Each
 * leg exports the genuine v-owner byte for byte, where honouring the
 * variable would refuse it or export other bytes. */
{
  const exportsGenuine = (what: string, r: ReturnType<typeof exportTag>) =>
    T.check(what + ': exports the genuine SKILL.md', r.status === 0 && r.skill === GENUINE_SKILL,
      r.status + ' ' + J(r.stderr) + ' ' + J((r.skill || '').slice(0, 60)));

  /* K8a — GIT_DIR (and GIT_WORK_TREE) naming a decoy repository with no such tag */
  const decoy = H.freshDir('xkey-decoy');
  spawnSync('git', ['init', '-q'], { cwd: decoy, env: ENV });
  exportsGenuine('K8a GIT_DIR at a decoy repository',
    exportTag('v-owner', 'gitdir', Object.assign({}, ENV, { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy })));

  /* An unsigned commit with another SKILL.md, the same tree otherwise. */
  const commit = git(['rev-parse', 'v-owner^{commit}']).stdout.trim();
  const evilBlob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env: ENV, input: 'evil\n', encoding: 'utf8' }).stdout.trim();
  const idx = path.join(H.freshDir('xkey-index'), 'index');
  const idxEnv = Object.assign({}, ENV, { GIT_INDEX_FILE: idx });
  git(['read-tree', commit], idxEnv);
  git(['update-index', '--cacheinfo', '100644,' + evilBlob + ',SKILL.md'], idxEnv);
  const evilTree = git(['write-tree'], idxEnv).stdout.trim();
  const evil = git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit-tree', evilTree, '-m', 'evil']).stdout.trim();

  /* K8b — refs/replace/<signed commit> -> the evil commit */
  git(['replace', commit, evil]);
  const probe = git(['show', 'v-owner:SKILL.md']).stdout;
  T.check('K8b fixture: plain git follows the replace ref', probe === 'evil\n', J(probe));
  exportsGenuine('K8b refs/replace/<commit>', exportTag('v-owner', 'replace'));
  git(['replace', '-d', commit]);

  /* K8c — the same replacement under GIT_REPLACE_REF_BASE */
  git(['update-ref', 'refs/elsewhere/' + commit, evil]);
  exportsGenuine('K8c GIT_REPLACE_REF_BASE at refs/elsewhere/',
    exportTag('v-owner', 'replacebase', Object.assign({}, ENV, { GIT_REPLACE_REF_BASE: 'refs/elsewhere/' })));
  git(['update-ref', '-d', 'refs/elsewhere/' + commit]);

  /* K8d — one-off config (a gpg.program that does not exist, a decoy
   * replace setting) through GIT_CONFIG_COUNT/KEY/VALUE and PARAMETERS */
  exportsGenuine('K8d GIT_CONFIG_* and GIT_CONFIG_PARAMETERS injection', exportTag('v-owner', 'configenv', Object.assign({}, ENV, {
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'gpg.program', GIT_CONFIG_VALUE_0: path.join(decoy, 'no-such-gpg'),
    GIT_CONFIG_PARAMETERS: "'gpg.program'='" + path.join(decoy, 'no-such-gpg') + "'",
  })));
}

/* K9 — a tag must point at a commit of this project. A signed tag of a
 * tree, a signed tag of the signed v-owner tag, and a signed tag of a commit
 * whose package.json names another project: all refused, nothing written. */
{
  signedTag('v-tree', OWNER, 'gpg', ['v-owner^{tree}']);
  refused('K9 signed tag of a tree', exportTag('v-tree', 'tree'), 'tag_invalid', ['"v-tree"', '"tree"', 'not a commit']);
  signedTag('v-nested', OWNER, 'gpg', ['v-owner']);
  refused('K9 signed tag of a tag', exportTag('v-nested', 'nested'), 'tag_invalid', ['"v-nested"', '"tag"', 'not a commit']);

  const base = git(['rev-parse', 'v-owner^{commit}']).stdout.trim();
  const pkgBlob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env: ENV, encoding: 'utf8',
    input: JSON.stringify({ name: 'other-tool', version: '0.0.1', releaseKey: OWNER }) + '\n' }).stdout.trim();
  const idx = path.join(H.freshDir('xkey-index-other'), 'index');
  const idxEnv = Object.assign({}, ENV, { GIT_INDEX_FILE: idx });
  git(['read-tree', base], idxEnv);
  git(['update-index', '--cacheinfo', '100644,' + pkgBlob + ',package.json'], idxEnv);
  const otherTree = git(['write-tree'], idxEnv).stdout.trim();
  const other = git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit-tree', otherTree, '-p', base, '-m', 'other']).stdout.trim();
  signedTag('v-other', OWNER, 'gpg', [other]);
  refused('K9 signed tag of another project\'s commit', exportTag('v-other', 'other'), 'tag_invalid',
    ['"v-other"', 'not a nanojira release', '"other-tool"']);
  const again = exportTag('v-owner', 'owner-after-k9');
  T.check('K9 the genuine v-owner still exports', again.status === 0 && again.skill === GENUINE_SKILL, again.status + ' ' + J(again.stderr));
}

/* K11 — the subject binds the tag too. A commit of a repository whose
 * package is also named nanojira, under a tag signed by the release key:
 * refused when its subject is not '<name> <tag>: '; exported when it is --
 * the documented limit (DECISIONS 241): the key keeps such a tag out, not
 * this check. */
{
  const base = git(['rev-parse', 'v-owner^{commit}']).stdout.trim();
  const tree = git(['rev-parse', 'v-owner^{tree}']).stdout.trim();
  const commitWith = (subject: string) =>
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit-tree', tree, '-p', base, '-m', subject]).stdout.trim();
  signedTag('v-foreign', OWNER, 'gpg', [commitWith('Release 1.0')]);
  refused('K11 foreign nanojira commit, subject "Release 1.0"', exportTag('v-foreign', 'foreign'), 'tag_invalid',
    ['"v-foreign"', '"Release 1.0"', '"nanojira v-foreign: "']);
  signedTag('v-misnamed', OWNER, 'gpg', [commitWith('nanojira v-owner: a subject for another tag')]);
  refused('K11 subject naming another tag', exportTag('v-misnamed', 'misnamed'), 'tag_invalid', ['"v-misnamed"', 'does not start with']);
  signedTag('v-lookalike', OWNER, 'gpg', [commitWith('nanojira v-lookalike: follows the pattern')]);
  const lookalike = exportTag('v-lookalike', 'lookalike');
  T.check('K11 documented limit: a foreign commit with the right name and subject exports', lookalike.status === 0 && lookalike.written,
    lookalike.status + ' ' + J(lookalike.stderr));
}

/* K12 — every real v* tag of this checkout passes resolveTag and
 * checkProject, so the binding refuses none of the releases. Not covered
 * where the checkout has no tags (a shallow or tagless clone). */
{
  const mod = await import(path.join(ROOT, 'tools', 'release-key.mts'));
  const tags = String(spawnSync('git', ['tag', '-l', 'v*'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean);
  if (tags.length === 0 || typeof mod.checkProject !== 'function') {
    T.notCovered('K12 every real v* tag passes checkProject', tags.length === 0 ? 'no v* tags in this checkout' : 'no checkProject');
  } else {
    const failing = tags.filter((tag) => {
      const resolved = mod.resolveTag(ROOT, tag);
      return !resolved.ok || !mod.checkProject(ROOT, tag, resolved.commit, 'nanojira').ok;
    });
    T.check('K12 every real v* tag (' + tags.length + ') passes resolveTag and checkProject', failing.length === 0, J(failing));
  }
}

/* K10 — gitEnv itself, and every git call in the tools that read a signed
 * tag goes through it with --no-replace-objects. */
{
  const mod = await import(path.join(ROOT, 'tools', 'release-key.mts'));
  const gitEnv = typeof mod.gitEnv === 'function' ? mod.gitEnv : () => ({});
  T.check('K10 release-key.mts exports gitEnv', typeof mod.gitEnv === 'function', typeof mod.gitEnv);
  const families: Record<string, string> = {
    GIT_DIR: 'x', GIT_WORK_TREE: 'x', GIT_COMMON_DIR: 'x', GIT_INDEX_FILE: 'x', GIT_OBJECT_DIRECTORY: 'x',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: 'x', GIT_NAMESPACE: 'x', GIT_CEILING_DIRECTORIES: 'x',
    GIT_DISCOVERY_ACROSS_FILESYSTEM: '1', GIT_REPLACE_REF_BASE: 'refs/x/', GIT_NO_REPLACE_OBJECTS: '0',
  };
  const config: Record<string, string> = { GIT_CONFIG_PARAMETERS: "'a.b'='c'", GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c', GIT_CONFIG_KEY_1: 'd.e', GIT_CONFIG_VALUE_1: 'f' };
  const kept = { GNUPGHOME: '/g', GIT_CONFIG_GLOBAL: '/c', GIT_CONFIG_NOSYSTEM: '1', GIT_SSH_COMMAND: 'ssh', PATH: '/bin' };
  const base = Object.assign({}, families, config, kept);
  T.eq('K10 gitEnv drops every redirecting and one-off config variable, sets GIT_NO_REPLACE_OBJECTS=1',
    JSON.stringify(gitEnv(base)), JSON.stringify(Object.assign({}, kept, { GIT_NO_REPLACE_OBJECTS: '1' })));
  T.eq('K10 gitEnv keepConfig keeps only the one-off config',
    JSON.stringify(gitEnv(base, { keepConfig: true })), JSON.stringify(Object.assign({}, config, kept, { GIT_NO_REPLACE_OBJECTS: '1' })));
  for (const tool of ['release-key.mts', 'export-skill.mts', 'release-verify.mts', 'release-preflight.mts', 'release.ts', 'refactor-harness/gate.ts']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', tool), 'utf8');
    const calls = src.match(/(?:spawnSync|execFileSync)\('git', \[[^\]]{0,40}/g) || [];
    const bare = calls.filter((c) => !c.includes('...GIT_GLOBAL_OPTIONS'));
    T.check('K10 tools/' + tool + ': every git call passes --no-replace-objects (' + calls.length + ')', calls.length > 0 && bare.length === 0, J(bare));
  }
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
