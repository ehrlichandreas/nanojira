// tools/release-key.mts -- the pinned release key, shared by
// tools/export-skill.mts and tools/release.ts (DECISIONS 226, TSK-040).
//
// `git tag -v` / `verify-commit` accept a good signature from ANY key in the
// verifier's keyring. The release key's primary fingerprint is therefore
// pinned in package.json's "releaseKey", and a release object counts as
// signed only with a VALIDSIG whose primary-key fingerprint is that pin.
//
// The pin comes from the package.json beside the calling script's own
// tools/ directory -- the checkout whose code is running -- never from the
// tag or commit being checked, which could carry a pin of its own choosing,
// and never from the current working directory's repository.
//
// A signature binds the tag OBJECT, not the ref that names it: a
// lightweight `git tag v9 v1`, or a ref written by hand, points a new name
// at an old, validly signed tag. So a tag is resolved exactly once
// (resolveTag): refs/tags/<tag>, no DWIM, must be a tag object whose own
// "tag" header names <tag>; every later git call uses that object id, never
// the name again. The tag object must point at a commit (`type commit`):
// a signed tag of a tree, or of another tag, is refused, so `<oid>^{commit}`
// never has to peel through more than the one signed object.
//
// Every git call here runs with gitEnv() and GIT_GLOBAL_OPTIONS (DECISIONS
// 240, ported from cli-kernel v1.0.0's tools/release-key.mts). Variables
// that make git use another repository, object store, index or namespace
// than the one `cwd` names, swap objects through replace refs
// (GIT_REPLACE_REF_BASE), or inject configuration (gpg.program, say) for
// this one process are dropped, so the repository checked is always the
// one asked for. Replace objects are switched off as well
// (GIT_NO_REPLACE_OBJECTS=1, and --no-replace-objects on every call): a
// refs/replace/<commit> ref would otherwise make `git show <commit>:<path>`
// read another, unsigned commit's bytes under the signed commit's id.
// GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM and .git/config are deliberately
// trusted: whoever can write them already runs code as the user.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REDIRECTING_GIT_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_REPLACE_REF_BASE', 'GIT_NO_REPLACE_OBJECTS',
];
const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/;

/** Global options for every git call: never follow a replace ref. */
const GIT_GLOBAL_OPTIONS: readonly string[] = ['--no-replace-objects'];

/**
 * `base` without the variables that redirect git, and with replace objects
 * off. One-off config (GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS) is
 * dropped too, unless `keepConfig`: tools/release.ts keeps it for
 * git-release-squash, which signs with the identity it carries (DECISIONS
 * 202, A), and nothing else.
 */
function gitEnv(base: NodeJS.ProcessEnv = process.env, opts: { keepConfig?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (REDIRECTING_GIT_ENV.includes(name) || (!opts.keepConfig && GIT_CONFIG_ENV.test(name))) continue;
    env[name] = value;
  }
  env.GIT_NO_REPLACE_OBJECTS = '1';
  return env;
}

type PinResult = { ok: true; pin: string } | { ok: false; error: 'release_key_invalid'; message: string };

/** package.json's "releaseKey" under `root`: a 40-hex primary fingerprint, upper-cased. */
function readReleaseKey(root: string): PinResult {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).releaseKey;
  } catch (e) {
    return { ok: false, error: 'release_key_invalid', message: `cannot read "releaseKey" from ${path.join(root, 'package.json')}: ${(e as Error).message}` };
  }
  if (typeof value !== 'string' || !/^[0-9A-Fa-f]{40}$/.test(value)) {
    return { ok: false, error: 'release_key_invalid', message: `package.json "releaseKey" must be the release key's 40-hex primary fingerprint, found ${JSON.stringify(value === undefined ? null : value)}` };
  }
  return { ok: true, pin: value.toUpperCase() };
}

/** A name as it appears in a message: JSON-quoted, so a newline in it stays on one line. */
function q(name: string): string {
  return JSON.stringify(name);
}

type TagResult = { ok: true; oid: string; commit: string } | { ok: false; error: 'tag_invalid'; message: string };

/**
 * refs/tags/<tag> resolved once: an annotated tag object that names <tag>
 * itself and points at a commit, returned as `commit`.
 */
function resolveTag(repo: string, tag: string, env: NodeJS.ProcessEnv = gitEnv()): TagResult {
  const git = (args: string[]) => spawnSync('git', [...GIT_GLOBAL_OPTIONS, ...args], { cwd: repo, env, encoding: 'utf8' });
  const ref = git(['rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/tags/' + tag]);
  const oid = String(ref.stdout || '').trim();
  if (ref.status !== 0 || !/^[0-9a-f]{40,64}$/.test(oid)) {
    return { ok: false, error: 'tag_invalid', message: `no tag ${q(tag)} (${q('refs/tags/' + tag)} does not exist)` };
  }
  if (String(git(['cat-file', '-t', oid]).stdout || '').trim() !== 'tag') {
    return { ok: false, error: 'tag_invalid', message: `tag ${q(tag)} is not an annotated tag object (a lightweight tag carries no signature)` };
  }
  const header = String(git(['cat-file', 'tag', oid]).stdout || '').split('\n\n')[0];
  const named = (/^tag (.*)$/m.exec(header) || [])[1];
  if (named !== tag) {
    return { ok: false, error: 'tag_invalid', message: `tag object names ${q(named === undefined ? '' : named)}, not ${q(tag)} (${q('refs/tags/' + tag)} points at another tag's object)` };
  }
  const type = (/^type (.*)$/m.exec(header) || [])[1];
  const commit = (/^object ([0-9a-f]{40,64})$/m.exec(header) || [])[1];
  if (type !== 'commit' || commit === undefined) {
    return { ok: false, error: 'tag_invalid', message: `tag ${q(tag)} points at a ${q(type === undefined ? 'unknown object' : type)}, not a commit` };
  }
  return { ok: true, oid, commit };
}

type SignerResult = { ok: true; found: string; created: string[] } | { ok: false; error: 'release_key_mismatch'; message: string };

// Status lines that make a signature unacceptable even next to a VALIDSIG:
// a bad or unverifiable signature, an expired signature, a signature by an
// expired or revoked key.
const REFUSED_STATUS: Record<string, string> = {
  BADSIG: 'bad signature', ERRSIG: 'signature not checkable', EXPSIG: 'expired signature',
  EXPKEYSIG: 'expired key', REVKEYSIG: 'revoked key', KEYREVOKED: 'revoked key',
};

/** Whether the tag or commit object carries a signature at all. */
function hasSignatureBlock(repo: string, kind: 'tag' | 'commit', oid: string, env: NodeJS.ProcessEnv): boolean {
  const body = String(spawnSync('git', [...GIT_GLOBAL_OPTIONS, 'cat-file', kind, oid], { cwd: repo, env, encoding: 'utf8' }).stdout || '');
  return kind === 'tag' ? /^-----BEGIN [A-Z ]*(SIGNATURE|SIGNED MESSAGE)-----$/m.test(body)
    : /^gpgsig(-sha256)? /m.test(body.split('\n\n')[0]);
}

/**
 * Checks `oid` (a tag object from resolveTag, or a commit id) in `repo`
 * with `git verify-tag --raw` or `git verify-commit --raw`: it must carry a
 * GOODSIG and VALIDSIGs whose primary-key fingerprint (VALIDSIG's last
 * field) all equal `pin`, and no status from REFUSED_STATUS. `label` is
 * the name the messages use. `created` is the signatures' creation times
 * (VALIDSIG's third field, seconds since the epoch).
 */
function checkSigner(repo: string, kind: 'tag' | 'commit', oid: string, label: string, pin: string, env: NodeJS.ProcessEnv = gitEnv()): SignerResult {
  const r = spawnSync('git', [...GIT_GLOBAL_OPTIONS, kind === 'tag' ? 'verify-tag' : 'verify-commit', '--raw', oid],
    { cwd: repo, env, encoding: 'utf8' });
  const status = String(r.stderr || '').split('\n')
    .filter((l) => l.startsWith('[GNUPG:] '))
    .map((l) => l.slice('[GNUPG:] '.length).split(' '));
  const signers = status.filter((s) => s[0] === 'VALIDSIG').map((s) => (s[10] || s[1] || '').toUpperCase());
  const problems = [...new Set(status.map((s) => REFUSED_STATUS[s[0]]).filter(Boolean))];
  const found = signers.length > 0 ? [...new Set(signers)].join(', ') : 'none';
  const good = status.some((s) => s[0] === 'GOODSIG');
  if (r.status === 0 && good && signers.length > 0 && signers.every((f) => f === pin) && problems.length === 0) {
    return { ok: true, found, created: [...new Set(status.filter((s) => s[0] === 'VALIDSIG').map((s) => s[3] || ''))] };
  }
  // The reason is ours, never git's or gpg's own text. NO_PUBKEY comes
  // first: gpg pairs it with ERRSIG, and a release key missing from the
  // keyring is the common case. No status at all is "no signature" only
  // when the object has no signature block; otherwise gpg did not run
  // (a missing gpg.program) or said nothing.
  const why = status.some((s) => s[0] === 'NO_PUBKEY') ? 'signing key not in the keyring'
    : problems.length > 0 ? problems.join(', ')
    : signers.length > 0 ? 'signed by another key'
    : status.length > 0 ? 'no valid signature'
    : hasSignatureBlock(repo, kind, oid, env) ? `gpg printed no status (git exit ${r.status === null ? 'by signal' : r.status})`
    : 'no signature';
  return {
    ok: false, error: 'release_key_mismatch',
    message: `${kind} ${q(label)} is not signed by the release key: expected ${pin}, found ${found} (${why})`,
  };
}

type ProjectResult = { ok: true } | { ok: false; error: 'tag_invalid'; message: string };

/**
 * The project binding: `commit`'s own package.json is named `name` (the
 * running checkout's package.json name), and its subject starts with
 * `<name> <tag>: `, as every release commit's does (git-release-squash
 * writes it; release-verify checks the whole subject). Release tag messages
 * are the bare title (`git tag -n1`), so the tag message cannot carry the
 * binding. The limit: another repository whose package is named `name`,
 * with a commit whose subject follows the pattern, under a tag signed by
 * the same key, still passes; the key, not this check, is what keeps it
 * out (DECISIONS 241).
 */
function checkProject(repo: string, tag: string, commit: string, name: string, env: NodeJS.ProcessEnv = gitEnv()): ProjectResult {
  const r = spawnSync('git', [...GIT_GLOBAL_OPTIONS, 'show', `${commit}:package.json`], { cwd: repo, env, encoding: 'utf8' });
  let found: unknown;
  try { found = r.status === 0 ? JSON.parse(String(r.stdout)).name : undefined; } catch { found = undefined; }
  if (found !== name) {
    return { ok: false, error: 'tag_invalid', message: `tag ${q(tag)} (commit ${commit}) is not a ${name} release: package.json name is ${J(found)}` };
  }
  const subject = String(spawnSync('git', [...GIT_GLOBAL_OPTIONS, 'show', '-s', '--format=%s', commit],
    { cwd: repo, env, encoding: 'utf8' }).stdout || '').replace(/\n$/, '');
  const prefix = `${name} ${tag}: `;
  if (subject.startsWith(prefix)) return { ok: true };
  return { ok: false, error: 'tag_invalid', message: `tag ${q(tag)} (commit ${commit}) is not a ${name} release: its subject ${J(subject)} does not start with ${J(prefix)}` };
}

function J(x: unknown): string {
  return JSON.stringify(x === undefined ? null : x);
}

export { GIT_GLOBAL_OPTIONS, gitEnv, readReleaseKey, resolveTag, checkSigner, checkProject };
