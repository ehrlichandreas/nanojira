/* TSK-003: regression test for tools/release.ts (TSK-002), exercising the
 * three behaviours its own task spec called out: refusal on a red test gate
 * (--apply only since DECISIONS 202 G; a dry run skips the gate), no-op
 * without --apply, and the
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
 * the version-match guard needs anyway.
 *
 * The 4.1.0 release rehearsal (DECISIONS 202) added five more, AC5-AC9:
 * the release name comes from package.json's "name", never from the
 * checkout's directory name (a clone or worktree called anything else got a
 * wrong subject prefix); the test gate runs only with --apply (a dry run
 * costs no 20-minute suite); other local branches make --apply refuse
 * before anything runs (git-release-squash's post-write verify walks every
 * branch, so an unsigned WIP branch turned it red only AFTER the refs were
 * rewritten), and only warn in a dry run; and the GIT_CONFIG_* signing
 * identity release.ts is invoked with never reaches the test gate (it
 * outranked every test fixture's own repo-local user.signingkey, and
 * ac-56's fixture tags came out unsignable). AC9 runs one real, signed
 * --apply end to end in a fixture repo built from scratch -- every commit
 * signed by a throwaway key, so git-release-squash's own verify can pass --
 * and pins the resulting commit subject and tag message. */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE = path.join(ROOT, 'tools', 'release.ts');
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
/* package.json's "name", the same source release.ts takes it from -- never
 * path.basename(ROOT), which is "release-fixes" in a worktree and anything
 * at all in a scratch clone (DECISIONS 202, F). */
const NAME: string = ROOT_PKG.name;
const PKG_VERSION: string = ROOT_PKG.version;

/* No global or system git config reaches a case that could sign: a
 * regression must never be able to fall back on whatever identity the
 * machine's own ~/.gitconfig carries. */
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

/* A RELEASE_TEST_CMD that records that it ran -- and which GIT_CONFIG_*
 * one-off config variables it could see -- in a marker file outside any
 * repo, then exits with `exitCode`, or with 1 when it saw any (so a leak
 * turns the gate red on its own, not only in an assertion). */
function gateProbe(label: string, exitCode: number): { cmd: string; marker: string } {
  const dir = H.freshDir(label);
  const marker = path.join(dir, 'gate-ran.json');
  const script = path.join(dir, 'gate.mjs');
  fs.writeFileSync(script,
    "import fs from 'node:fs';\n" +
    "const leaked = Object.keys(process.env).filter((k) => /^GIT_CONFIG_(?:COUNT|KEY_\\d+|VALUE_\\d+|PARAMETERS)$/.test(k)).sort();\n" +
    'fs.writeFileSync(' + JSON.stringify(marker) + ', JSON.stringify({ leaked }));\n' +
    'process.exit(leaked.length > 0 ? 1 : ' + exitCode + ');\n');
  return { cmd: JSON.stringify(process.execPath) + ' ' + JSON.stringify(script), marker };
}

function gitIn(dir: string, args: string[], env?: Record<string, string>) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
}

/* git-release-squash has nothing to squash when HEAD is itself a release
 * tag (main right after a release): a dry run exits 1 before it prints a
 * plan, and an --apply would stop there too, hiding whether it was refused
 * first. A scratch clone whose HEAD is tagged therefore gets one empty
 * commit on top -- fixed date, throwaway identity, unsigned, in the clone
 * only -- so every leg runs the same either way. ISOLATED_GIT keeps the
 * machine's global and system config out of it: --no-verify skips only
 * the pre-commit and commit-msg hooks, and a global core.hooksPath
 * would still run post-commit. */
const UNTAG_ENV = Object.assign({
  GIT_AUTHOR_NAME: 'tmp', GIT_AUTHOR_EMAIL: 'tmp@invalid', GIT_AUTHOR_DATE: '2026-01-03T12:00:00Z',
  GIT_COMMITTER_NAME: 'tmp', GIT_COMMITTER_EMAIL: 'tmp@invalid', GIT_COMMITTER_DATE: '2026-01-03T12:00:00Z',
}, ISOLATED_GIT);
function untagHead(label: string, dir: string): void {
  const tagsAtHead = () => gitIn(dir, ['tag', '--points-at', 'HEAD']).stdout.trim();
  let detail = '';
  if (tagsAtHead() !== '') {
    const c = gitIn(dir, ['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '--no-verify',
      '-m', 'release-regression: HEAD was a release tag'], UNTAG_ENV);
    detail = c.stderr;
  }
  T.check(label + ' fixture: the clone\'s HEAD carries no tag (git-release-squash has a commit to squash)',
    tagsAtHead() === '', detail || tagsAtHead());
}

/* A scratch clone of this repo with the working tree's own release.ts
 * copied over the committed one and node_modules symlinked in (so
 * git-release-squash is genuinely installed), its package.json version
 * rewritten -- uncommitted -- to a version no tag carries yet. */
function scratchClone(label: string): { dir: string; version: string } {
  const dir = H.freshDir(label);
  const clone = spawnSync('git', ['clone', '--quiet', ROOT, dir], { encoding: 'utf8', timeout: 60000 });
  T.check(label + ' fixture: git clone of this repo into a scratch dir', clone.status === 0, clone.stderr);
  untagHead(label, dir);
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(dir, 'tools', 'release.ts'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const version = pickUntaggedVersion(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(Object.assign({}, ROOT_PKG, { version })));
  return { dir, version };
}

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

function repoSnapshot(dir: string = ROOT): { head: string; tags: string } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const tags = spawnSync('git', ['show-ref', '--tags'], { cwd: dir, encoding: 'utf8' }).stdout;
  return { head, tags };
}

/* Re-verifies against the clone's OWN tags rather than assuming none
 * collide -- the clone inherits every tag ROOT has (git clone copies
 * refs/tags), so this is the same "don't trust that reading holds" stance
 * as the rest of this file, applied to the version string itself. */
function pickUntaggedVersion(repoDir: string): string {
  for (let i = 0; i < 20; i++) {
    const candidate = '0.0.0-regression-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const exists = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/tags/v' + candidate],
      { cwd: repoDir, encoding: 'utf8' }).status === 0;
    if (!exists) return candidate;
  }
  throw new Error('release-regression: could not find an untagged version for AC2 after 20 attempts');
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
  // An empty `git init` (no commit, no branch yet): enough for the
  // other-branches check (AC7), which runs before the gate, to find none.
  gitIn(scratch, ['init', '-q']);
  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'nanojira', version: '9.9.9', type: 'module' }));
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'scratch red-apply test', '--apply'],
    { RELEASE_TEST_CMD: 'false' });
  T.eq('AC1 red test + --apply (isolated scratch, no git-release-squash present): exit 1, not 2', r.status, 1);
  T.contains('AC1: stderr names the refusal', r.stderr, 'refused');
}

/* ---------------------------------------------------------------- */
/* 2. (was: red test gate, dry-run leg.) The gate no longer runs in */
/* a dry run at all -- see AC6, inside section 4's clone.           */
/* ---------------------------------------------------------------- */

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
/* 4. Dry run with a correct, bare title -- ISOLATED CLONE, never    */
/* this checkout, same reasoning as section 5 below. Running this    */
/* directly against ROOT with PKG_VERSION (as this case used to)     */
/* makes it depend on whether v<PKG_VERSION> happens to be tagged    */
/* already -- true right after every real release, since the        */
/* version isn't bumped until the next one, which made this AC's     */
/* pass/fail a function of repo state rather than of release.ts's    */
/* own behaviour. A clone starts out with every tag ROOT has (git    */
/* clone copies refs/tags), so pickUntaggedVersion() picks a fresh   */
/* version per run instead of reusing PKG_VERSION, and re-checks it  */
/* against the clone's own tags rather than assuming none collide.   */
/* The clone's package.json is rewritten in place, never committed:  */
/* release.ts only reads that file off disk (it never diffs it       */
/* against git), and a dry run never reaches cmdTail's isDirty()     */
/* gate either -- that only runs on the --apply branch -- so a       */
/* dirty-but-uncommitted version bump is sufficient here. Confirms   */
/* both halves of AC2 at once: the dry run succeeds (the prefix      */
/* guard does NOT also reject a correctly bare title) and it writes  */
/* nothing -- checked on the clone (HEAD/tags byte-identical before  */
/* and after) AND, the guarantee this rewrite must not lose, on the  */
/* real repo too (HEAD/tags byte-identical across the whole case).   */
/* ---------------------------------------------------------------- */
{
  const rootBefore = repoSnapshot(ROOT);

  const scratch = H.freshDir('release-ac2');
  const clone = spawnSync('git', ['clone', '--quiet', ROOT, scratch], { encoding: 'utf8', timeout: 60000 });
  T.check('AC2 fixture: git clone of this repo into a scratch dir', clone.status === 0, clone.stderr);
  untagHead('AC2', scratch);

  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  // Same reasoning as the fat-finger fixture below: symlinked, not copied,
  // so git-release-squash is genuinely installed, reached after the
  // version-match/prefix/test-gate logic this case actually exercises.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'));

  const version = pickUntaggedVersion(scratch);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify(Object.assign({}, pkg, { version })));
  T.check('AC5 fixture: the clone\'s directory is NOT named after the package',
    path.basename(scratch) !== NAME, path.basename(scratch));

  // A gate that would fail (exit 1) and leaves a marker if it ran at all:
  // a dry run must neither run it nor be refused by it (AC6).
  const gate = gateProbe('release-ac2-gate', 1);
  const before = repoSnapshot(scratch);
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    [version, '--message', 'a bare safe title'], { RELEASE_TEST_CMD: gate.cmd });
  const after = repoSnapshot(scratch);

  T.eq('AC2 dry run (correct bare title): exit 0', r.status, 0);
  T.contains('AC2/AC5: stdout carries git-release-squash\'s own dry-run plan, prefixed with package.json\'s "name"',
    r.stdout, NAME + ' v' + version + ': a bare safe title');
  T.check('AC6: a dry run never runs the test gate', !fs.existsSync(gate.marker), gate.marker);
  T.contains('AC6: a dry run says the gate runs with --apply', r.stdout + r.stderr, 'test gate runs with --apply');
  T.contains('AC2: stdout says dry run, no ref changed', r.stdout, 'dry run');
  T.eq('AC2: HEAD unchanged after a dry run', after.head, before.head);
  T.eq('AC2: no tag ref created or changed by a dry run', after.tags, before.tags);

  const rootAfter = repoSnapshot(ROOT);
  T.eq('AC2: the real repo\'s HEAD is untouched throughout', rootAfter.head, rootBefore.head);
  T.eq('AC2: the real repo\'s tags are untouched throughout', rootAfter.tags, rootBefore.tags);
}

/* ---------------------------------------------------------------- */
/* AC5 (F): package.json without a "name" is a usage error, not a   */
/* silent fallback to the directory name.                           */
/* ---------------------------------------------------------------- */
{
  const scratch = H.freshDir('release-noname');
  gitIn(scratch, ['init', '-q']);
  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'no name', '--apply'], { RELEASE_TEST_CMD: 'true' });
  T.eq('AC5 package.json without "name": usage error, exit 2', r.status, 2);
  T.contains('AC5: stderr names package.json\'s "name"', r.stderr, '"name"');
}

/* ---------------------------------------------------------------- */
/* AC7 (E): other local branches. A dry run warns and names them;   */
/* --apply refuses before the gate or git-release-squash ever runs, */
/* writing nothing. The gate here exits 1 too, so even a regression */
/* that dropped the refusal could never reach a signing step.       */
/* ---------------------------------------------------------------- */
{
  const { dir, version } = scratchClone('release-ac7');
  gitIn(dir, ['branch', 'wip-unsigned-a']);
  gitIn(dir, ['branch', 'wip-unsigned-b']);
  const gnupg = H.freshDir('release-ac7-gnupg');
  const env = Object.assign({ GNUPGHOME: gnupg }, ISOLATED_GIT);

  const dryGate = gateProbe('release-ac7-drygate', 1);
  const dry = runRelease(path.join(dir, 'tools', 'release.ts'), dir,
    [version, '--message', 'branch check'], Object.assign({ RELEASE_TEST_CMD: dryGate.cmd }, env));
  T.eq('AC7 other branches, dry run: still exit 0 (a warning, not a refusal)', dry.status, 0);
  T.contains('AC7: the dry run warns', dry.stderr, 'warning');
  T.contains('AC7: the dry run names the first other branch', dry.stderr, 'wip-unsigned-a');
  T.contains('AC7: the dry run names the second other branch', dry.stderr, 'wip-unsigned-b');

  const applyGate = gateProbe('release-ac7-applygate', 1);
  const before = repoSnapshot(dir);
  const app = runRelease(path.join(dir, 'tools', 'release.ts'), dir,
    [version, '--message', 'branch check', '--apply'], Object.assign({ RELEASE_TEST_CMD: applyGate.cmd }, env));
  const after = repoSnapshot(dir);
  T.eq('AC7 other branches + --apply: refused, exit 1', app.status, 1);
  T.contains('AC7: stderr says refused', app.stderr, 'refused');
  T.contains('AC7: the refusal names the first other branch', app.stderr, 'wip-unsigned-a');
  T.contains('AC7: the refusal names the second other branch', app.stderr, 'wip-unsigned-b');
  T.check('AC7: refused before the test gate ran', !fs.existsSync(applyGate.marker), applyGate.marker);
  T.eq('AC7: HEAD unchanged', after.head, before.head);
  T.eq('AC7: no tag ref created or changed', after.tags, before.tags);
}

/* ---------------------------------------------------------------- */
/* AC8 (A): the GIT_CONFIG_* identity release.ts is invoked with     */
/* never reaches the test gate. Isolated scratch with no            */
/* git-release-squash installed: a clean gate passes and the run    */
/* stops at "not found" (exit 2); a leaking one would make the probe */
/* exit 1 ("refused").                                              */
/* ---------------------------------------------------------------- */
{
  const scratch = H.freshDir('release-ac8');
  gitIn(scratch, ['init', '-q']);
  fs.mkdirSync(path.join(scratch, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(scratch, 'tools', 'release.ts'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'nanojira', version: '9.9.9', type: 'module' }));
  const gate = gateProbe('release-ac8-gate', 0);
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'env scrub', '--apply'], Object.assign({
      RELEASE_TEST_CMD: gate.cmd,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.signingkey', GIT_CONFIG_VALUE_0: '0000000000000000000000000000000000000000',
      GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'leak probe',
      GIT_CONFIG_PARAMETERS: "'user.email'='leak@example.invalid'",
    }, ISOLATED_GIT));
  let seen: { leaked: string[] } | null = null;
  try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }
  T.check('AC8: the gate ran under --apply', seen !== null, gate.marker);
  T.eq('AC8: the gate saw no GIT_CONFIG_* variable', JSON.stringify(seen && seen.leaked), '[]');
  T.eq('AC8: past the gate, stopped only by the missing git-release-squash (exit 2)', r.status, 2);
}

/* ---------------------------------------------------------------- */
/* AC9: one real, signed --apply, end to end, in a fixture repo     */
/* built from scratch (never a clone of this one: its commits are   */
/* signed by the project's own key, which this throwaway keyring    */
/* cannot verify, so git-release-squash's post-write verify would   */
/* fail for a reason that has nothing to do with release.ts). The   */
/* fixture directory is deliberately not named after the package.   */
/* Pins: exit 0 with every verify line OK; the gate ran, saw no     */
/* GIT_CONFIG_* (A) although the signing identity arrives exactly    */
/* that way; the commit subject is "<name> v<version>: <title>" (F); */
/* and the tag message is the --message text, or --message-file's  */
/* contents, verbatim -- "<title>[\n\n<body>]", the v3.12.2 form    */
/* (H; see docs/RELEASING.md).                                      */
/* ---------------------------------------------------------------- */
{
  const gnupg = H.freshDir('release-ac9-gnupg');
  fs.chmodSync(gnupg, 0o700);
  const batch = path.join(gnupg, 'batch.txt');
  fs.writeFileSync(batch,
    '%no-protection\nKey-Type: eddsa\nKey-Curve: ed25519\n' +
    'Name-Real: NJ Release AC9 Test\nName-Email: release-ac9@example.invalid\n' +
    'Expire-Date: 0\n%commit\n');
  const gen = spawnSync('gpg', ['--batch', '--gen-key', batch],
    { env: Object.assign({}, process.env, { GNUPGHOME: gnupg }), encoding: 'utf8', timeout: 30000 });
  T.check('AC9 fixture: gpg --batch --gen-key (throwaway key)', gen.status === 0, gen.stderr);
  const list = spawnSync('gpg', ['--batch', '--list-secret-keys', '--with-colons'],
    { env: Object.assign({}, process.env, { GNUPGHOME: gnupg }), encoding: 'utf8', timeout: 15000 });
  const fprMatch = /^fpr:::::::::([0-9A-F]+):/m.exec(list.stdout || '');
  const fpr = fprMatch ? fprMatch[1] : null;
  T.check('AC9 fixture: parsed a fingerprint for the throwaway key', !!fpr, list.stdout);

  if (gen.status === 0 && fpr) {
    const signEnv: Record<string, string> = Object.assign({
      GNUPGHOME: gnupg,
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'NJ Release AC9 Test',
      GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'release-ac9@example.invalid',
      GIT_CONFIG_KEY_2: 'user.signingkey', GIT_CONFIG_VALUE_2: fpr,
    }, ISOLATED_GIT);
    // Nested one level down: git-release-squash writes its backup bundle
    // beside the repo directory, so it lands inside this fresh dir too.
    const repo = path.join(H.freshDir('release-ac9'), 'fixture-repo');
    fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
    const g = (args: string[]) => {
      const r = gitIn(repo, args, signEnv);
      if (r.status !== 0) T.check('AC9 fixture: git ' + args.join(' '), false, r.stderr);
      return r;
    };
    g(['init', '-q', '-b', 'main']);
    fs.copyFileSync(RELEASE, path.join(repo, 'tools', 'release.ts'));
    fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(repo, '.gitignore'));
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nanojira', version: '0.0.1', type: 'module' }) + '\n');
    g(['add', '.gitignore', 'package.json', 'tools/release.ts']);
    g(['commit', '-q', '-S', '-m', 'base']);
    g(['tag', '-s', 'v0.0.1', '-m', 'nanojira v0.0.1\n\nbase']);
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nanojira', version: '0.0.2', type: 'module' }) + '\n');
    g(['commit', '-q', '-S', '-a', '-m', 'feat: something new']);
    g(['commit', '-q', '-S', '--allow-empty', '-m', 'fix: something else']);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(repo, 'node_modules'));

    const gate = gateProbe('release-ac9-gate', 0);
    const r = runRelease(path.join(repo, 'tools', 'release.ts'), repo,
      ['0.0.2', '--message', 'a bare title', '--apply'], Object.assign({ RELEASE_TEST_CMD: gate.cmd }, signEnv));
    let seen: { leaked: string[] } | null = null;
    try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }

    T.check('AC9 signed --apply end to end: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
    T.check('AC9: the gate ran', seen !== null, gate.marker);
    T.eq('AC9/A: the gate saw no GIT_CONFIG_* although signing used them', JSON.stringify(seen && seen.leaked), '[]');
    T.contains('AC9: verify: tree delta OK', r.stdout, 'verify: tree delta: OK');
    T.contains('AC9: verify: signatures OK', r.stdout, 'verify: signatures: OK');
    T.eq('AC9/F: commit subject is "<package name> v<version>: <title>"',
      gitIn(repo, ['log', '-1', '--format=%s'], signEnv).stdout.trim(), 'nanojira v0.0.2: a bare title');
    T.eq('AC9: the two commits since v0.0.1 became one',
      gitIn(repo, ['rev-list', '--count', 'v0.0.1..HEAD'], signEnv).stdout.trim(), '1');
    T.eq('AC9: v0.0.2 points at HEAD',
      gitIn(repo, ['rev-parse', 'v0.0.2^{commit}'], signEnv).stdout.trim(),
      gitIn(repo, ['rev-parse', 'HEAD'], signEnv).stdout.trim());
    T.eq('AC9: v0.0.2 is an annotated tag', gitIn(repo, ['cat-file', '-t', 'v0.0.2'], signEnv).stdout.trim(), 'tag');
    T.eq('AC9/H: the tag message is the --message text, verbatim (current form)',
      gitIn(repo, ['tag', '-l', '--format=%(contents:subject)|%(contents:body)', 'v0.0.2'], signEnv).stdout.trim(),
      'a bare title|');
    T.eq('AC9: git tag -v v0.0.2 verifies', gitIn(repo, ['tag', '-v', 'v0.0.2'], signEnv).status, 0);

    // The documented way to give a release a body (docs/RELEASING.md):
    // --message-file. Its first line is the title -- the commit subject's
    // "<title>" and the tag message's first line alike -- and the rest is
    // the tag body, verbatim: the v3.12.2 "<title>\n\n<body>" form.
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nanojira', version: '0.0.3', type: 'module' }) + '\n');
    g(['commit', '-q', '-S', '-a', '-m', 'feat: third']);
    const msgFile = path.join(H.freshDir('release-ac9-msg'), 'message.txt');
    fs.writeFileSync(msgFile, 'a titled release\n\n- first point\n- second point\n');
    const gate3 = gateProbe('release-ac9-gate3', 0);
    const r3 = runRelease(path.join(repo, 'tools', 'release.ts'), repo,
      ['0.0.3', '--message-file', msgFile, '--apply'], Object.assign({ RELEASE_TEST_CMD: gate3.cmd }, signEnv));
    T.check('AC9 --message-file --apply: exit 0', r3.status === 0, 'exit ' + r3.status + '\n' + r3.stderr + r3.stdout);
    T.eq('AC9/H --message-file: commit subject is "<name> v<version>: <first line>"',
      gitIn(repo, ['log', '-1', '--format=%s', 'v0.0.3'], signEnv).stdout.trim(), 'nanojira v0.0.3: a titled release');
    T.eq('AC9/H --message-file: tag message is "<title>\\n\\n<body>", the file verbatim',
      gitIn(repo, ['tag', '-l', '--format=%(contents:subject)|%(contents:body)', 'v0.0.3'], signEnv).stdout.trim(),
      'a titled release|- first point\n- second point');
    T.eq('AC9: git tag -v v0.0.3 verifies', gitIn(repo, ['tag', '-v', 'v0.0.3'], signEnv).status, 0);
  }
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
  untagHead(label, scratch);
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

/* ---------------------------------------------------------------- */
/* 6. Every value flag reaches git-release-squash as --flag=value.  */
/* From git-history-tools v0.4.0 on (its D17), a space-separated    */
/* value that starts with `--` is "missing value for --flag", so    */
/* `--message --x` would refuse a title starting with `--`. A fake  */
/* git-release-squash records its argv, one per line, so the exact  */
/* contract is checked whichever ght version is installed.          */
/* ---------------------------------------------------------------- */
function argvProbe(label: string): { dir: string; version: string; argvFile: string } {
  const dir = H.freshDir(label);
  const clone = spawnSync('git', ['clone', '--quiet', ROOT, dir], { encoding: 'utf8', timeout: 60000 });
  T.check(label + ' fixture: git clone of this repo into a scratch dir', clone.status === 0, clone.stderr);
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(dir, 'tools', 'release.ts'));
  const argvFile = path.join(H.freshDir(label + '-argv'), 'argv.txt');
  const binDir = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'git-release-squash'),
    '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > ' + JSON.stringify(argvFile) + '\n', { mode: 0o755 });
  const version = pickUntaggedVersion(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(Object.assign({}, ROOT_PKG, { version })));
  return { dir, version, argvFile };
}

{
  const p = argvProbe('release-argv-message');
  const title = '--leading dashes title';
  const r = runRelease(path.join(p.dir, 'tools', 'release.ts'), p.dir,
    [p.version, '--message', title], { RELEASE_TEST_CMD: 'false' });
  T.check('AC10 --message dry run: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
  const argv = fs.existsSync(p.argvFile) ? fs.readFileSync(p.argvFile, 'utf8').split('\n').slice(0, -1) : [];
  T.eq('AC10 --message: git-release-squash gets every value flag as --flag=value (a title starting with -- included)',
    JSON.stringify(argv),
    JSON.stringify(['tail', p.dir, '--name=' + NAME, '--tag=v' + p.version, '--message=' + title]));
}

{
  const p = argvProbe('release-argv-message-file');
  const msgFile = path.join(H.freshDir('release-argv-msgfile'), 'msg.txt');
  fs.writeFileSync(msgFile, 'a file title\n\nbody\n');
  const r = runRelease(path.join(p.dir, 'tools', 'release.ts'), p.dir,
    [p.version, '--message-file', msgFile], { RELEASE_TEST_CMD: 'false' });
  T.check('AC10 --message-file dry run: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
  const argv = fs.existsSync(p.argvFile) ? fs.readFileSync(p.argvFile, 'utf8').split('\n').slice(0, -1) : [];
  T.eq('AC10 --message-file: git-release-squash gets --message-file=<path>',
    JSON.stringify(argv),
    JSON.stringify(['tail', p.dir, '--name=' + NAME, '--tag=v' + p.version, '--message-file=' + msgFile]));
}

T.finish();
