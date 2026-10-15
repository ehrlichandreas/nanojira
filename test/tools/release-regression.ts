/* TSK-003: regression test for tools/release.ts (TSK-002), exercising the
 * three behaviours its own task spec called out: refusal on a red test gate
 * (dry-run and --apply alike), no-op without --apply, and the
 * message-prefix-duplication guard (the exact bug Lead hit by hand) -- plus
 * a fourth, found by Reviewer reviewing TSK-002: `--message --apply`
 * (forgetting the message text) silently flipped into real apply mode,
 * because `apply` was a separate `argv.includes('--apply')` blind to
 * whether that token was a real flag or the value `--message` just
 * consumed. Fixed by deriving `apply` from the same position-aware pass.
 *
 * tools/release.ts always operates on THIS repo: its ROOT is
 * `path.resolve(__dirname, '..')`, relative to the script's own location --
 * it takes no --repo of its own. Every case below that passes --apply runs
 * against an ISOLATED SCRATCH COPY, never this checkout, even though
 * reading tools/release.ts's own control flow shows the red-test gate runs
 * strictly before it ever builds or spawns the git-release-squash
 * invocation (arg validation, then the version-match check, then the
 * prefix check, then the test gate, only then squashArgs/spawnSync) -- a
 * regression test for "never writes when it shouldn't" should not have to
 * trust that reading holds, least of all against the real repo. Every case
 * that never passes --apply is safe to run directly here regardless, and
 * does, because the real package.json's current version is exactly what
 * the version-match guard needs anyway. */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE = path.join(ROOT, 'tools', 'release.ts');
const NAME = path.basename(ROOT);
const PKG_VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

interface Run { status: number | null; stdout: string; stderr: string; }

function runRelease(scriptPath: string, cwd: string, args: string[], env: Record<string, string>): Run {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
    timeout: 30000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function repoSnapshot(): { head: string; tags: string } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const tags = spawnSync('git', ['show-ref', '--tags'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  return { head, tags };
}

/* ---------------------------------------------------------------- */
/* 1. Red test gate + --apply -- isolated scratch copy, no git repo */
/* and no node_modules present at all. If the gate ran AFTER the    */
/* bin-resolution step instead of before it, this would come back   */
/* exit 2 ("git-release-squash not found"), not exit 1 -- the       */
/* absence of git-release-squash here is what makes that            */
/* distinction possible without ever touching a real repo.          */
/* ---------------------------------------------------------------- */
{
  const scratch = H.freshDir('release-redapply');
  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'scratch red-apply test', '--apply'],
    { RELEASE_TEST_CMD: 'false' });
  T.eq('AC1 red test + --apply (isolated scratch, no git-release-squash present): exit 1, not 2', r.status, 1);
  T.contains('AC1: stderr names the refusal', r.stderr, 'refused');
}

/* ---------------------------------------------------------------- */
/* 2. Red test gate, dry-run leg -- against the real repo, safe     */
/* because --apply is never given.                                  */
/* ---------------------------------------------------------------- */
{
  const r = runRelease(RELEASE, ROOT, [PKG_VERSION, '--message', 'a bare safe title'],
    { RELEASE_TEST_CMD: 'false' });
  T.eq('AC1 red test, dry-run leg: exit 1', r.status, 1);
  T.contains('AC1: stderr names the refusal', r.stderr, 'refused');
}

/* ---------------------------------------------------------------- */
/* 3. The prefix-duplication guard -- against the real repo, safe   */
/* because --apply is never given, and the check fires (by          */
/* construction) before the test gate even runs: RELEASE_TEST_CMD   */
/* is green here on purpose, so a regression that let this through  */
/* would show up as a wrongly-composed SUCCESS, not be masked by an */
/* unrelated red-test refusal.                                      */
/* ---------------------------------------------------------------- */
{
  const tag = 'v' + PKG_VERSION;
  const prefix = NAME + ' ' + tag + ': ';
  const alreadyPrefixed = prefix + 'some title';
  const r = runRelease(RELEASE, ROOT, [PKG_VERSION, '--message', alreadyPrefixed],
    { RELEASE_TEST_CMD: 'true' });
  T.eq('AC3 already-prefixed message: usage error, exit 2 (not 0, not 1)', r.status, 2);
  T.contains('AC3: stderr names the duplicate-prefix refusal', r.stderr, 'already starts with');
}

/* ---------------------------------------------------------------- */
/* 4. Dry run with a correct, bare title -- against the real repo,  */
/* safe because --apply is never given. Confirms both halves of     */
/* AC2 at once: it succeeds (the prefix guard does NOT also reject  */
/* a correctly bare title) and it writes nothing (HEAD and every    */
/* tag ref are byte-identical before and after).                    */
/* ---------------------------------------------------------------- */
{
  const before = repoSnapshot();
  const r = runRelease(RELEASE, ROOT, [PKG_VERSION, '--message', 'a bare safe title'],
    { RELEASE_TEST_CMD: 'true' });
  const after = repoSnapshot();
  T.eq('AC2 dry run (correct bare title): exit 0', r.status, 0);
  T.contains('AC2: stdout carries git-release-squash\'s own dry-run plan', r.stdout, NAME + ' ' + 'v' + PKG_VERSION + ': a bare safe title');
  T.contains('AC2: stdout says dry run, no ref changed', r.stdout, 'dry run');
  T.eq('AC2: HEAD unchanged after a dry run', after.head, before.head);
  T.eq('AC2: no tag ref created or changed by a dry run', after.tags, before.tags);
}

/* ---------------------------------------------------------------- */
/* 5. The fat-finger Reviewer found, in both the --message and the  */
/* --message-file form: the text/path was forgotten, so --apply     */
/* itself gets consumed as the OTHER flag's value. Needs a REAL     */
/* git repo with REAL signing configured to mean anything -- a      */
/* repo-less fixture would refuse earlier for an unrelated reason   */
/* (not a git repo) regardless of whether `apply` came out true or  */
/* false, proving nothing about this bug specifically. A throwaway  */
/* GPG identity supplied purely via GIT_CONFIG_* env vars (never a  */
/* config file) lets this run to the same depth Reviewer's own      */
/* reproduction did. Isolated clone, never this checkout: if the    */
/* fix regressed, this is the case that would actually write a      */
/* real signed commit+tag.                                          */
/* ---------------------------------------------------------------- */
function assertFatFingerIsSafe(label: string, fatFingerArgs: string[]): void {
  const gnupgHome = H.freshDir('release-fatfinger-gnupg');
  fs.chmodSync(gnupgHome, 0o700);
  const batch = path.join(gnupgHome, 'batch.txt');
  fs.writeFileSync(batch,
    '%no-protection\nKey-Type: eddsa\nKey-Curve: ed25519\n' +
    'Name-Real: NJ Release Fatfinger Test\nName-Email: release-fatfinger@example.invalid\n' +
    'Expire-Date: 0\n%commit\n');
  const gen = spawnSync('gpg', ['--batch', '--gen-key', batch],
    { env: Object.assign({}, process.env, { GNUPGHOME: gnupgHome }), encoding: 'utf8', timeout: 30000 });
  T.check(label + ' fixture: gpg --batch --gen-key (throwaway key)', gen.status === 0, gen.stderr);
  const list = spawnSync('gpg', ['--batch', '--list-secret-keys', '--with-colons'],
    { env: Object.assign({}, process.env, { GNUPGHOME: gnupgHome }), encoding: 'utf8', timeout: 15000 });
  const fprMatch = /^fpr:::::::::([0-9A-F]+):/m.exec(list.stdout || '');
  const fpr = fprMatch ? fprMatch[1] : null;
  T.check(label + ' fixture: parsed a fingerprint for the throwaway key', !!fpr, list.stdout);
  if (gen.status !== 0 || !fpr) return;

  const scratch = H.freshDir('release-fatfinger-repo');
  const clone = spawnSync('git', ['clone', '--quiet', ROOT, scratch], { encoding: 'utf8', timeout: 60000 });
  T.check(label + ' fixture: git clone of this repo into a scratch dir', clone.status === 0, clone.stderr);
  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  // Without this, release.ts's own node_modules/.bin/git-release-squash
  // existence check (which runs AFTER the apply/test-gate logic this case
  // exists to exercise) refuses first with an unrelated "not found" --
  // masking the exact bug this case is for regardless of whether `apply`
  // came out true or false. Symlinked, not copied: git-release-squash is
  // genuinely installed once in this repo's own node_modules.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'));

  const scratchEnv = Object.assign({}, process.env, {
    GNUPGHOME: gnupgHome,
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'NJ Release Fatfinger Test',
    GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'release-fatfinger@example.invalid',
    GIT_CONFIG_KEY_2: 'user.signingkey', GIT_CONFIG_VALUE_2: fpr,
    GIT_CONFIG_KEY_3: 'tag.gpgsign', GIT_CONFIG_VALUE_3: 'true',
    RELEASE_TEST_CMD: 'true',
  });
  const beforeHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).stdout.trim();
  const beforeTags = spawnSync('git', ['tag', '-l'], { cwd: scratch, encoding: 'utf8' }).stdout;

  const r = spawnSync(process.execPath,
    [path.join(scratch, 'tools', 'release.ts'), PKG_VERSION, ...fatFingerArgs],
    { cwd: scratch, encoding: 'utf8', env: scratchEnv, timeout: 30000 });

  const afterHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).stdout.trim();
  const afterTags = spawnSync('git', ['tag', '-l'], { cwd: scratch, encoding: 'utf8' }).stdout;

  T.eq(label + ': HEAD unchanged -- no real commit was made', afterHead, beforeHead);
  T.eq(label + ': no new tag was created', afterTags, beforeTags);
  T.check(label + ': ran without a spawn error', r.error === undefined, r.error);
}

assertFatFingerIsSafe('AC4 fat-finger (--message --apply)', ['--message', '--apply']);
assertFatFingerIsSafe('AC4 fat-finger (--message-file --apply)', ['--message-file', '--apply']);

T.finish();
