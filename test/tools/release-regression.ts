/* TSK-003: regression test for tools/release.ts (TSK-002), exercising the
 * three behaviours its own task spec called out: refusal on a red test gate
 * (--apply only since DECISIONS 202 G; a dry run skips the gate), no-op
 * without --apply, and the message-prefix-duplication guard (the exact bug
 * Lead hit by hand) -- plus a fourth, found by Reviewer reviewing TSK-002:
 * `--message --apply` (forgetting the message text) silently flipped into
 * real apply mode, because `apply` was a separate `argv.includes('--apply')`
 * blind to whether that token was a real flag or the value `--message` just
 * consumed. Fixed by deriving `apply` from the same position-aware pass.
 *
 * The 4.1.0 release rehearsal (DECISIONS 202) added AC5-AC9: the release
 * name comes from package.json's "name", never from the checkout's
 * directory name; the test gate runs only with --apply; other local
 * branches are refused before anything runs (git-release-squash's
 * post-write verify walks every branch); and the GIT_CONFIG_* signing
 * identity release.ts is invoked with never reaches the test gate. AC9 runs
 * one real, signed --apply end to end and pins the resulting commit subject
 * and tag message. AC10: every value flag reaches git-release-squash as
 * --flag=value.
 *
 * TSK-040 step A (DECISIONS 226) pins the release key: package.json's
 * "releaseKey". AC11: after --apply, a release commit and tag signed by any
 * other key exit 1 naming both fingerprints; AC12: a pin that is not 40 hex
 * digits is refused before the gate.
 *
 * TSK-040 step B (DECISIONS 227) adds the preflight: before anything is
 * written, dry run included, release.ts refuses other branches or
 * worktrees, a dirty tree, a tag after the previous release, a version
 * that is not X.Y.Z everywhere, node_modules that do not match the lock,
 * a doc naming a commit the squash removes, and a stale bundle -- each
 * with its own code, all of them reported together (AC13).
 *
 * TSK-040 step C (DECISIONS 228) verifies the result: after --apply,
 * release.ts prints one "verify: <check>: OK|FAIL|SKIPPED" line per
 * section (AC9, AC11). AC14: --verify-only vX.Y.Z on a clone passes, and
 * fails the right section for an extra commit, a wrong date, a signature
 * made at the real time instead of the pinned one, an identity that is not
 * a user ID of the pinned key, two signature blocks, a
 * lightweight tag and an old tag moved on origin.
 *
 * Every case runs in a fixture repository built from scratch
 * (releaseRepo), never a clone of this one: a release candidate passes the
 * preflight only when it is release-ready, and this repo's own state
 * between releases never is. A fixture carries the four version places,
 * dist files embedding the version, a CHANGES heading, a stub bin/nanojira
 * and tools/bundle.ts, and its own node_modules with an
 * empty .package-lock.json and, as each case needs, the real
 * git-release-squash, a fake one that records its argv, or none. */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE = path.join(ROOT, 'tools', 'release.ts');
/* release.ts imports these: every copy of release.ts needs them beside it. */
const RELEASE_KEY = path.join(ROOT, 'tools', 'release-key.mts');
const RELEASE_PREFLIGHT = path.join(ROOT, 'tools', 'release-preflight.mts');
const RELEASE_VERIFY = path.join(ROOT, 'tools', 'release-verify.mts');
/* The post-squash "content" check exports the release with it. */
const EXPORT_SKILL = path.join(ROOT, 'tools', 'export-skill.mts');
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
/* package.json's "name", the same source release.ts takes it from -- never
 * path.basename(ROOT), which is "release-fixes" in a worktree and anything
 * at all in a scratch clone (DECISIONS 202, F). */
const NAME: string = ROOT_PKG.name;
const PKG_VERSION: string = ROOT_PKG.version;
/* The installed git-release-squash, by its real path: a fixture's own
 * node_modules/.bin links to it. */
const REAL_SQUASH = fs.realpathSync(path.join(ROOT, 'node_modules', '.bin', 'git-release-squash'));

/* No global or system git config reaches a case that could sign: a
 * regression must never be able to fall back on whatever identity the
 * machine's own ~/.gitconfig carries. */
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const FIXTURE_ID = {
  GIT_AUTHOR_NAME: 'tmp', GIT_AUTHOR_EMAIL: 'tmp@invalid',
  GIT_COMMITTER_NAME: 'tmp', GIT_COMMITTER_EMAIL: 'tmp@invalid',
};

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

/** The working tree's release.ts and release-key.mts, into `<dir>/tools/`. */
function installRelease(dir: string): void {
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(RELEASE, path.join(dir, 'tools', 'release.ts'));
  fs.copyFileSync(RELEASE_KEY, path.join(dir, 'tools', 'release-key.mts'));
  fs.copyFileSync(RELEASE_PREFLIGHT, path.join(dir, 'tools', 'release-preflight.mts'));
  fs.copyFileSync(RELEASE_VERIFY, path.join(dir, 'tools', 'release-verify.mts'));
  fs.copyFileSync(EXPORT_SKILL, path.join(dir, 'tools', 'export-skill.mts'));
}

function gitIn(dir: string, args: string[], env?: Record<string, string>) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
}

interface Run { status: number | null; stdout: string; stderr: string; error?: Error }

function runRelease(scriptPath: string, cwd: string, args: string[], env: Record<string, string>): Run {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
    timeout: 60000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function repoSnapshot(dir: string = ROOT): { head: string; tags: string } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const tags = spawnSync('git', ['show-ref', '--tags'], { cwd: dir, encoding: 'utf8' }).stdout;
  return { head, tags };
}

/* ---------------------------------------------------------------- */
/* The fixture: a release-ready repo built from scratch.            */
/* ---------------------------------------------------------------- */
type Squash = 'real' | 'fake' | 'none';
interface Fixture {
  dir: string;
  /** git in the fixture with its identity (and signing, if any); a failure is a fixture failure. */
  git: (args: string[]) => ReturnType<typeof gitIn>;
  /** Writes the four version places (and the stub launcher's answer), then commits everything. */
  bump: (version: string, message: string, releaseKey?: string) => void;
  /** Commits whatever is in the tree. */
  commit: (message: string) => void;
  argvFile: string;
  run: (args: string[], env?: Record<string, string>) => Run;
}

/**
 * A repo whose `v<prev>` release is tagged and whose next commit bumps
 * everything to `version`: package.json (with `releaseKey`), the lock's
 * root x2, SKILL.md's metadata.version and bin/nanojira --version (a stub
 * that prints it); tools/bundle.ts is a stub that fails only while
 * tools/bundle-stale exists. node_modules is the fixture's own, with an
 * empty .package-lock.json and, per `squash`, the real git-release-squash,
 * a fake that records its argv to `argvFile`, or none. With `sign`
 * (a GIT_CONFIG_* signing identity plus GNUPGHOME), commits and the tag are
 * signed. The repo sits one level down, as git-release-squash writes its
 * backup bundle beside it, and is not named after the package.
 */
function releaseRepo(label: string, opts: { squash: Squash; version?: string; prev?: string; sign?: Record<string, string>; releaseKey?: string }): Fixture {
  const version = opts.version || '0.0.2';
  const prev = opts.prev || '0.0.1';
  const releaseKey = opts.releaseKey || ROOT_PKG.releaseKey;
  const dir = path.join(H.freshDir(label), 'fixture-repo');
  fs.mkdirSync(dir, { recursive: true });
  const env = Object.assign({}, ISOLATED_GIT, FIXTURE_ID, opts.sign || {});
  const signFlag = opts.sign ? ['-S'] : [];
  const git = (args: string[]) => {
    const r = gitIn(dir, args, env);
    if (r.status !== 0) T.check(label + ' fixture: git ' + args.join(' '), false, r.stderr);
    return r;
  };
  const writeVersion = (v: string, key: string) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: NAME, version: v, type: 'module', releaseKey: key }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      name: NAME, version: v, lockfileVersion: 3, requires: true, packages: { '': { name: NAME, version: v } },
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ' + NAME + '\nmetadata:\n  version: "' + v + '"\n---\n\n# fixture\n');
    fs.writeFileSync(path.join(dir, 'bin', 'nanojira'), '#!/bin/sh\necho "' + NAME + ' ' + v + '"\n', { mode: 0o755 });
    // What export-skill ships, with the version where dist embeds it.
    for (const b of ['nanojira.mjs', 'nanojira-mcp.mjs']) fs.writeFileSync(path.join(dir, 'dist', b), 'var VERSION = "' + v + '";\n');
    fs.writeFileSync(path.join(dir, 'docs', 'CHANGES.md'), '# Changes\n\n## ' + v + '\n');
  };
  const commit = (message: string) => {
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', ...signFlag, '-m', message]);
  };

  git(['init', '-q', '-b', 'main']);
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'));
  installRelease(dir);
  fs.writeFileSync(path.join(dir, 'tools', 'bundle.ts'),
    "import fs from 'node:fs';\nprocess.exit(fs.existsSync(new URL('./bundle-stale', import.meta.url)) ? 1 : 0);\n");
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'fixture\n');
  fs.writeFileSync(path.join(dir, 'bin', 'nanojira-mcp'), '#!/bin/sh\n', { mode: 0o755 });
  for (const c of ['nanojira.cmd', 'nanojira-mcp.cmd']) fs.writeFileSync(path.join(dir, 'bin', c), '@echo off\r\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  writeVersion(prev, releaseKey);
  commit('base');
  git(['tag', opts.sign ? '-s' : '-a', 'v' + prev, '-m', NAME + ' v' + prev + '\n\nbase']);
  writeVersion(version, releaseKey);
  commit('bump to ' + version);

  const bin = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'),
    JSON.stringify({ name: NAME, lockfileVersion: 3, requires: true, packages: {} }) + '\n');
  const argvFile = path.join(H.freshDir(label + '-argv'), 'argv.txt');
  if (opts.squash === 'real') fs.symlinkSync(REAL_SQUASH, path.join(bin, 'git-release-squash'));
  if (opts.squash === 'fake') {
    fs.writeFileSync(path.join(bin, 'git-release-squash'),
      '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > ' + JSON.stringify(argvFile) + '\n', { mode: 0o755 });
  }
  return {
    dir, git, commit, argvFile,
    bump: (v, message, key = releaseKey) => { writeVersion(v, key); commit(message); },
    run: (args, extra) => runRelease(path.join(dir, 'tools', 'release.ts'), dir, args, Object.assign({}, ISOLATED_GIT, extra || {})),
  };
}

/** A throwaway signing key in its own GNUPGHOME, as GIT_CONFIG_* env (never a config file). */
function signingIdentity(label: string): { env: Record<string, string>; fpr: string } | null {
  const gnupg = H.freshDir(label + '-gnupg');
  fs.chmodSync(gnupg, 0o700);
  const gpgEnv = Object.assign({}, process.env, { GNUPGHOME: gnupg });
  const gen = spawnSync('gpg', ['--batch', '--passphrase', '', '--quick-gen-key', 'NJ Release Test <release@example.invalid>', 'ed25519', 'sign', '0'],
    { env: gpgEnv, encoding: 'utf8', timeout: 30000 });
  T.check(label + ' fixture: gpg --quick-gen-key (throwaway key)', gen.status === 0, gen.stderr);
  const list = spawnSync('gpg', ['--batch', '--list-secret-keys', '--with-colons'], { env: gpgEnv, encoding: 'utf8', timeout: 15000 });
  const m = /^fpr:::::::::([0-9A-F]{40}):/m.exec(list.stdout || '');
  T.check(label + ' fixture: parsed a fingerprint for the throwaway key', !!m, list.stdout);
  if (gen.status !== 0 || !m) return null;
  return {
    fpr: m[1],
    env: Object.assign({
      GNUPGHOME: gnupg,
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'NJ Release Test',
      GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'release@example.invalid',
      GIT_CONFIG_KEY_2: 'user.signingkey', GIT_CONFIG_VALUE_2: m[1],
    }, ISOLATED_GIT),
  };
}

/* ---------------------------------------------------------------- */
/* AC1: red test gate + --apply. No git-release-squash installed: if */
/* the gate ran AFTER the bin-resolution step instead of before it,  */
/* this would come back exit 2 ("not found"), not exit 1.            */
/* ---------------------------------------------------------------- */
{
  const f = releaseRepo('release-ac1', { squash: 'none' });
  const r = f.run(['0.0.2', '--message', 'red-apply test', '--apply'], { RELEASE_TEST_CMD: 'false' });
  T.eq('AC1 red test + --apply: exit 1, not 2', r.status, 1);
  T.contains('AC1: stderr names the gate refusal', r.stderr, 'did not pass');
}

/* ---------------------------------------------------------------- */
/* AC3: the prefix-duplication guard -- against the real repo, safe  */
/* because --apply is never given, and the check fires (a usage     */
/* error) before the preflight and the gate.                        */
/* ---------------------------------------------------------------- */
{
  const tag = 'v' + PKG_VERSION;
  const prefix = NAME + ' ' + tag + ': ';
  const r = runRelease(RELEASE, ROOT, [PKG_VERSION, '--message', prefix + 'some title'], { RELEASE_TEST_CMD: 'true' });
  T.eq('AC3 already-prefixed message: usage error, exit 2 (not 0, not 1)', r.status, 2);
  T.contains('AC3: stderr names the duplicate-prefix refusal', r.stderr, 'already starts with');
}

/* ---------------------------------------------------------------- */
/* AC2/AC5/AC6: a dry run with a bare title in a release-ready repo  */
/* not named after the package: exit 0, git-release-squash's own    */
/* plan prefixed with package.json's "name", the gate not run, and  */
/* nothing written -- in the fixture and in this repo.              */
/* ---------------------------------------------------------------- */
{
  const rootBefore = repoSnapshot(ROOT);
  const f = releaseRepo('release-ac2', { squash: 'real' });
  T.check('AC5 fixture: the repo\'s directory is NOT named after the package', path.basename(f.dir) !== NAME, f.dir);
  const gate = gateProbe('release-ac2-gate', 1);
  const before = repoSnapshot(f.dir);
  const r = f.run(['0.0.2', '--message', 'a bare safe title'], { RELEASE_TEST_CMD: gate.cmd });
  const after = repoSnapshot(f.dir);
  T.eq('AC2 dry run (correct bare title): exit 0', r.status, 0);
  T.contains('AC2/AC5: the dry-run plan is prefixed with package.json\'s "name"', r.stdout, NAME + ' v0.0.2: a bare safe title');
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
  installRelease(scratch);
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'no name', '--apply'], { RELEASE_TEST_CMD: 'true' });
  T.eq('AC5 package.json without "name": usage error, exit 2', r.status, 2);
  T.contains('AC5: stderr names package.json\'s "name"', r.stderr, '"name"');
}

/* ---------------------------------------------------------------- */
/* AC12: a "releaseKey" that is not 40 hex digits is refused before */
/* the gate (and before git-release-squash), dry run or --apply.    */
/* ---------------------------------------------------------------- */
{
  const scratch = H.freshDir('release-ac12');
  gitIn(scratch, ['init', '-q']);
  installRelease(scratch);
  fs.writeFileSync(path.join(scratch, 'package.json'),
    JSON.stringify({ name: 'nanojira', version: '9.9.9', type: 'module', releaseKey: 'BEEEE63B' }));
  const gate = gateProbe('release-ac12-gate', 0);
  const r = runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
    ['9.9.9', '--message', 'bad pin', '--apply'], { RELEASE_TEST_CMD: gate.cmd });
  T.eq('AC12 releaseKey not 40 hex: refused, exit 1', r.status, 1);
  T.check('AC12: stderr names release_key_invalid and the value', r.stderr.includes('release_key_invalid') && r.stderr.includes('BEEEE63B'), r.stderr);
  T.check('AC12: refused before the test gate ran', !fs.existsSync(gate.marker), gate.marker);
}

/* ---------------------------------------------------------------- */
/* AC7 (E): other local branches -- refused, naming them, before     */
/* the gate or git-release-squash runs, in a dry run too (DECISIONS  */
/* 227; until 4.4.0 a dry run only warned).                          */
/* ---------------------------------------------------------------- */
{
  const f = releaseRepo('release-ac7', { squash: 'fake' });
  f.git(['branch', 'wip-unsigned-a']);
  f.git(['branch', 'wip-unsigned-b']);
  const dry = f.run(['0.0.2', '--message', 'branch check'], { RELEASE_TEST_CMD: 'true' });
  T.eq('AC7 other branches, dry run: refused, exit 1', dry.status, 1);
  T.check('AC7: other_branches names both branches', /other_branches: .*wip-unsigned-a.*wip-unsigned-b/.test(dry.stderr), dry.stderr);
  T.check('AC7: the dry run never reached git-release-squash', !fs.existsSync(f.argvFile), f.argvFile);

  const applyGate = gateProbe('release-ac7-applygate', 1);
  const before = repoSnapshot(f.dir);
  const app = f.run(['0.0.2', '--message', 'branch check', '--apply'], { RELEASE_TEST_CMD: applyGate.cmd });
  const after = repoSnapshot(f.dir);
  T.eq('AC7 other branches + --apply: refused, exit 1', app.status, 1);
  T.contains('AC7: --apply names other_branches', app.stderr, 'other_branches');
  T.check('AC7: refused before the test gate ran', !fs.existsSync(applyGate.marker), applyGate.marker);
  T.eq('AC7: HEAD unchanged', after.head, before.head);
  T.eq('AC7: no tag ref created or changed', after.tags, before.tags);
}

/* ---------------------------------------------------------------- */
/* AC8 (A): the GIT_CONFIG_* identity release.ts is invoked with     */
/* never reaches the test gate. No git-release-squash installed: a  */
/* clean gate passes and the run stops at "not found" (exit 2); a   */
/* leaking one would make the probe exit 1 ("refused").             */
/* ---------------------------------------------------------------- */
{
  const f = releaseRepo('release-ac8', { squash: 'none' });
  const gate = gateProbe('release-ac8-gate', 0);
  const r = f.run(['0.0.2', '--message', 'env scrub', '--apply'], {
    RELEASE_TEST_CMD: gate.cmd,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.signingkey', GIT_CONFIG_VALUE_0: '0000000000000000000000000000000000000000',
    GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'leak probe',
    GIT_CONFIG_PARAMETERS: "'user.email'='leak@example.invalid'",
  });
  let seen: { leaked: string[] } | null = null;
  try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }
  T.check('AC8: the gate ran under --apply', seen !== null, gate.marker + '\n' + r.stderr);
  T.eq('AC8: the gate saw no GIT_CONFIG_* variable', JSON.stringify(seen && seen.leaked), '[]');
  T.eq('AC8: past the gate, stopped only by the missing git-release-squash (exit 2)', r.status, 2);
}

/* ---------------------------------------------------------------- */
/* AC13 (DECISIONS 227): the preflight. Each defect alone, in a dry  */
/* run: exit 1, its own code, git-release-squash never reached. Then */
/* two defects at once: both reported in one run.                   */
/* ---------------------------------------------------------------- */
function refusedWith(what: string, f: Fixture, code: string, names: string[] = []): Run {
  const r = f.run(['0.0.2', '--message', 'preflight'], { RELEASE_TEST_CMD: 'true' });
  const line = r.stderr.split('\n').find((l) => l.startsWith('release: refused: ' + code + ': ')) || '';
  T.eq('AC13 ' + what + ': exit 1', r.status, 1);
  T.check('AC13 ' + what + ': one line "release: refused: ' + code + ': …"' + (names.length ? ' naming ' + names.join(', ') : ''),
    line !== '' && names.every((n) => line.includes(n)), r.stderr);
  T.check('AC13 ' + what + ': git-release-squash never ran', !fs.existsSync(f.argvFile), r.stdout);
  return r;
}
{
  const f = releaseRepo('release-ac13-worktree', { squash: 'fake' });
  const wt = path.join(path.dirname(f.dir), 'other-worktree');
  f.git(['worktree', 'add', '-q', '--detach', wt]);
  refusedWith('another worktree', f, 'other_worktrees', [wt]);
}
{
  const f = releaseRepo('release-ac13-dirty', { squash: 'fake' });
  fs.writeFileSync(path.join(f.dir, 'stray.txt'), 'untracked\n');
  refusedWith('a dirty tree', f, 'dirty_tree', ['stray.txt']);
}
{
  const f = releaseRepo('release-ac13-tag', { squash: 'fake' });
  f.git(['tag', 'bookmark']);
  refusedWith('a tag after the previous release', f, 'tag_after_release', ['bookmark', 'v0.0.1']);
}
{
  // R2: vPREV is the newest exact vX.Y.Z; an rc tag after it is a tag
  // after the release, not the release itself.
  const f = releaseRepo('release-ac13-rc', { squash: 'fake' });
  f.git(['tag', '-a', 'v0.0.2-rc1', '-m', 'rc']);
  refusedWith('an rc tag after the previous release', f, 'tag_after_release', ['v0.0.2-rc1', 'v0.0.1']);
}
{
  const f = releaseRepo('release-ac13-version', { squash: 'fake' });
  fs.writeFileSync(path.join(f.dir, 'SKILL.md'), '---\nname: nanojira\nmetadata:\n  version: "0.0.1"\n---\n');
  f.commit('SKILL.md left behind');
  refusedWith('SKILL.md at another version', f, 'version_mismatch', ['SKILL.md', '0.0.1']);
}
{
  const f = releaseRepo('release-ac13-lock', { squash: 'fake' });
  const lockFile = path.join(f.dir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.packages['node_modules/dep'] = { version: '1.0.0', resolved: 'git+ssh://example.invalid/dep.git#aaaaaaa' };
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  f.commit('lock a dependency');
  // Installed: the same version from another commit -- the version alone proves nothing.
  fs.writeFileSync(path.join(f.dir, 'node_modules', '.package-lock.json'), JSON.stringify({
    packages: { 'node_modules/dep': { version: '1.0.0', resolved: 'git+ssh://example.invalid/dep.git#bbbbbbb' } },
  }) + '\n');
  refusedWith('node_modules resolved from another commit', f, 'node_modules_mismatch', ['node_modules/dep']);
}
{
  const f = releaseRepo('release-ac13-docsha', { squash: 'fake' });
  const squashed = f.git(['rev-parse', '--short=9', 'HEAD']).stdout.trim();
  const released = f.git(['rev-parse', '--short=9', 'v0.0.1^{commit}']).stdout.trim();
  fs.writeFileSync(path.join(f.dir, 'docs', 'CHANGES.md'),
    '# Changes\n\n- fixed in ' + squashed + '\n- since ' + released + ', a released commit\n');
  f.commit('changes');
  const r = refusedWith('a doc naming a squashed commit', f, 'doc_names_squashed_commit', ['docs/CHANGES.md', squashed]);
  T.check('AC13 a released commit\'s sha is not a finding', !r.stderr.includes(released), r.stderr);
}
{
  // R1: the cut flow cherry-picks work-branch commits, so docs name shas
  // that are in no release and not in vPREV..HEAD either (an object
  // fetched from the work clone). Upper case counts too.
  const f = releaseRepo('release-ac13-docsha-outside', { squash: 'fake' });
  const outside = f.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'work-branch commit']).stdout.trim();
  fs.writeFileSync(path.join(f.dir, 'docs', 'CHANGES.md'), '# Changes\n\n- red against ' + outside.slice(0, 9).toUpperCase() + '\n');
  f.commit('changes');
  refusedWith('a doc naming an unreleased commit outside HEAD', f, 'doc_names_squashed_commit', ['docs/CHANGES.md', outside.slice(0, 9).toUpperCase()]);
}
{
  const f = releaseRepo('release-ac13-bundle', { squash: 'fake' });
  fs.writeFileSync(path.join(f.dir, 'tools', 'bundle-stale'), '');
  f.commit('stale bundle');
  refusedWith('bundle --check failing', f, 'bundle_stale');
}
{
  const f = releaseRepo('release-ac13-two', { squash: 'fake' });
  f.git(['tag', 'bookmark']);
  fs.writeFileSync(path.join(f.dir, 'stray.txt'), 'untracked\n');
  const r = refusedWith('two defects', f, 'dirty_tree');
  T.contains('AC13 two defects: both reported in one run', r.stderr, 'release: refused: tag_after_release: ');
}

/* ---------------------------------------------------------------- */
/* AC4: the fat-finger Reviewer found, in both the --message and the */
/* --message-file form: the text/path was forgotten, so --apply      */
/* itself gets consumed as the OTHER flag's value. A signed,         */
/* release-ready fixture with the real git-release-squash, so a      */
/* regression would actually write a signed commit and tag.          */
/* ---------------------------------------------------------------- */
const SIGNER = signingIdentity('release-signer');
function assertFatFingerIsSafe(label: string, fatFingerArgs: string[]): void {
  if (!SIGNER) return;
  const f = releaseRepo(label.replace(/\W+/g, '-'), { squash: 'real', sign: SIGNER.env, releaseKey: SIGNER.fpr });
  const before = repoSnapshot(f.dir);
  const r = f.run(['0.0.2', ...fatFingerArgs], Object.assign({ RELEASE_TEST_CMD: 'true' }, SIGNER.env));
  const after = repoSnapshot(f.dir);
  T.eq(label + ': HEAD unchanged -- no real commit was made', after.head, before.head);
  T.eq(label + ': no new tag was created', after.tags, before.tags);
  T.check(label + ': ran without a spawn error', r.error === undefined, r.error);
}
assertFatFingerIsSafe('AC4 fat-finger (--message --apply)', ['--message', '--apply']);
assertFatFingerIsSafe('AC4 fat-finger (--message-file --apply)', ['--message-file', '--apply']);

/* ---------------------------------------------------------------- */
/* AC9: one real, signed --apply, end to end. Pins: exit 0 with every */
/* verify line OK, the release key's two included; the gate ran and  */
/* saw no GIT_CONFIG_* (A) although the signing identity arrives      */
/* exactly that way; the commit subject is "<name> v<version>:        */
/* <title>" (F); and the tag message is the --message text, or        */
/* --message-file's contents, verbatim (H; see docs/RELEASING.md).    */
/* AC11 then pins another key: the squash succeeds, release.ts's own  */
/* check exits 1 naming both fingerprints.                           */
/* ---------------------------------------------------------------- */
if (SIGNER) {
  const fpr = SIGNER.fpr;
  const signEnv = SIGNER.env;
  const f = releaseRepo('release-ac9', { squash: 'real', sign: signEnv, releaseKey: fpr });
  f.commit('fix: something else');
  const repo = f.dir;

  const gate = gateProbe('release-ac9-gate', 0);
  const r = f.run(['0.0.2', '--message', 'a bare title', '--apply'], Object.assign({ RELEASE_TEST_CMD: gate.cmd }, signEnv));
  let seen: { leaked: string[] } | null = null;
  try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }

  T.check('AC9 signed --apply end to end: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
  T.check('AC9: the gate ran', seen !== null, gate.marker);
  T.eq('AC9/A: the gate saw no GIT_CONFIG_* although signing used them', JSON.stringify(seen && seen.leaked), '[]');
  T.contains('AC9: verify: tree delta OK', r.stdout, 'verify: tree delta: OK');
  T.contains('AC9: verify: signatures OK', r.stdout, 'verify: signatures: OK');
  for (const check of ['squash', 'release commit', 'release tag', 'content', 'refs', 'history signatures']) {
    T.check('AC9/AC14: verify: ' + check + ': OK', r.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': OK')), r.stdout);
  }
  T.contains('AC14: no origin is SKIPPED, not FAIL', r.stdout, 'verify: old tags vs origin: SKIPPED (origin unreachable)');

  // AC14 --verify-only, after the push: a clone of the released repo has
  // it as origin, main and the tag included. Each forged clone fails its
  // own section.
  const verifyOnly = (label: string, forge: (git: (args: string[], input?: string) => string, clone: string) => void) => {
    const clone = path.join(H.freshDir('release-ac14-' + label), 'clone');
    gitIn(path.dirname(clone), ['clone', '-q', repo, clone], signEnv);
    const git = (args: string[], input?: string) => {
      const x = spawnSync('git', args, { cwd: clone, encoding: 'utf8', input, env: Object.assign({}, process.env, signEnv, FIXTURE_ID) });
      if (x.status !== 0) T.check('AC14 ' + label + ' fixture: git ' + args.join(' '), false, x.stderr);
      return String(x.stdout).trim();
    };
    forge(git, clone);
    return runRelease(path.join(clone, 'tools', 'release.ts'), clone, ['--verify-only', 'v0.0.2'], signEnv);
  };
  const failsIn = (label: string, check: string, v: Run) => {
    T.eq('AC14 ' + label + ': exit 1', v.status, 1);
    T.check('AC14 ' + label + ': verify: ' + check + ': FAIL', v.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': FAIL')), v.stdout + v.stderr);
  };
  const clean = verifyOnly('clean', () => {});
  T.check('AC14 --verify-only on the pushed release: exit 0, every line OK', clean.status === 0 && !/: (FAIL|SKIPPED)/.test(clean.stdout), clean.stdout + clean.stderr);
  T.contains('AC14 --verify-only: origin == local', clean.stdout, 'verify: origin == local: OK');
  failsIn('an extra commit', 'squash', verifyOnly('extra', (git) => {
    git(['commit', '-q', '-S', '--allow-empty', '-m', 'extra']);
    git(['tag', '-f', '-s', 'v0.0.2', '-m', 'a bare title']);
  }));
  failsIn('a wrong date', 'release commit', verifyOnly('date', (git) => {
    // Same tree, parent and subject, signed, but dated now.
    const forged = git(['commit-tree', '-S', 'v0.0.2^{tree}', '-p', 'v0.0.1^{commit}', '-m', 'nanojira v0.0.2: a bare title']);
    git(['update-ref', 'refs/heads/main', forged]);
    git(['tag', '-f', '-s', 'v0.0.2', forged, '-m', 'a bare title']);
  }));
  // Commit and tag rebuilt with the same dates, tree, parent and
  // messages and signed again by the pinned key: now (the real time), or
  // through a gpg wrapper at the pinned time, optionally under another
  // identity.
  const reSign = (label: string, o: { ident?: [string, string]; pinned?: boolean }) => verifyOnly(label, (git, clone) => {
    const [name, email, date] = git(['log', '-1', '--format=%an%x00%ae%x00%ad', '--date=raw', 'v0.0.2^{commit}']).split('\0');
    const [n, e] = o.ident || [name, email];
    // '@': git reads a bare epoch this small as an ambiguous date.
    const env: Record<string, string> = Object.assign({}, signEnv, { GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_AUTHOR_DATE: '@' + date,
      GIT_COMMITTER_NAME: n, GIT_COMMITTER_EMAIL: e, GIT_COMMITTER_DATE: '@' + date });
    if (o.pinned) {
      const keys = spawnSync('gpg', ['--batch', '--with-colons', '--list-keys', '--', SIGNER.fpr],
        { env: Object.assign({}, process.env, { GNUPGHOME: signEnv.GNUPGHOME }), encoding: 'utf8' });
      const created = Number((/^pub:(?:[^:]*:){4}(\d+):/m.exec(keys.stdout || '') || [])[1]);
      const wrapper = path.join(path.dirname(clone), 'gpg-pinned.sh');
      fs.writeFileSync(wrapper, '#!/bin/sh\nexec gpg --faked-system-time ' + (created + 60) + '! "$@"\n', { mode: 0o755 });
      Object.assign(env, { GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_3: 'gpg.program', GIT_CONFIG_VALUE_3: wrapper });
    }
    const ct = gitIn(clone, ['commit-tree', '-S', 'v0.0.2^{tree}', '-p', 'v0.0.1^{commit}', '-m', 'nanojira v0.0.2: a bare title'], env);
    T.eq('AC14 ' + label + ' fixture: commit re-signed', ct.status + ' ' + ct.stderr, '0 ');
    const forged = ct.stdout.trim();
    git(['update-ref', 'refs/heads/main', forged]);
    T.eq('AC14 ' + label + ' fixture: tag re-signed', gitIn(clone, ['tag', '-f', '-s', 'v0.0.2', forged, '-m', 'a bare title'], env).status, 0);
  });
  /** Both sections FAIL, each naming only `why`. */
  const failsOnlyFor = (label: string, why: string, v: Run) => {
    for (const check of ['release commit', 'release tag']) {
      failsIn(label, check, v);
      T.check('AC14 ' + label + ': verify: ' + check + ': FAIL names only ' + JSON.stringify(why),
        v.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': FAIL ') && l.includes(why) && !l.includes(';')), v.stdout);
    }
  };
  failsOnlyFor('a real signature time', 'signature time ', reSign('sigtime', {}));
  // Signed by the pin at the pinned time, but not as the key's owner.
  failsOnlyFor('another identity', 'is not a user ID of the release key',
    reSign('ident', { ident: ['Implementer (WIP)', 'implementer-wip@localhost'], pinned: true }));
  failsIn('two signature blocks', 'release tag', verifyOnly('twosig', (git) => {
    const body = git(['cat-file', 'tag', 'v0.0.2']) + '\n';
    const block = body.slice(body.indexOf('-----BEGIN PGP SIGNATURE-----'));
    git(['update-ref', 'refs/tags/v0.0.2', git(['mktag'], body + block)]);
  }));
  failsIn('a lightweight tag', 'release tag', verifyOnly('light', (git) => {
    git(['tag', '-f', 'v0.0.2', 'v0.0.2^{commit}']);
  }));
  failsIn('an old tag moved on origin', 'old tags vs origin', verifyOnly('moved', (git, clone) => {
    const bare = path.join(path.dirname(clone), 'origin.git');
    gitIn(path.dirname(clone), ['clone', '-q', '--bare', repo, bare], signEnv);
    gitIn(bare, ['tag', '-f', 'v0.0.1', 'v0.0.2^{commit}'], signEnv);
    git(['remote', 'set-url', 'origin', bare]);
  }));
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
  f.bump('0.0.3', 'feat: third');
  const msgFile = path.join(H.freshDir('release-ac9-msg'), 'message.txt');
  fs.writeFileSync(msgFile, 'a titled release\n\n- first point\n- second point\n');
  const gate3 = gateProbe('release-ac9-gate3', 0);
  const r3 = f.run(['0.0.3', '--message-file', msgFile, '--apply'], Object.assign({ RELEASE_TEST_CMD: gate3.cmd }, signEnv));
  T.check('AC9 --message-file --apply: exit 0', r3.status === 0, 'exit ' + r3.status + '\n' + r3.stderr + r3.stdout);
  T.eq('AC9/H --message-file: commit subject is "<name> v<version>: <first line>"',
    gitIn(repo, ['log', '-1', '--format=%s', 'v0.0.3'], signEnv).stdout.trim(), 'nanojira v0.0.3: a titled release');
  T.eq('AC9/H --message-file: tag message is "<title>\\n\\n<body>", the file verbatim',
    gitIn(repo, ['tag', '-l', '--format=%(contents:subject)|%(contents:body)', 'v0.0.3'], signEnv).stdout.trim(),
    'a titled release|- first point\n- second point');
  T.eq('AC9: git tag -v v0.0.3 verifies', gitIn(repo, ['tag', '-v', 'v0.0.3'], signEnv).status, 0);

  // AC11: the same signing key, but package.json pins another one. The
  // squash itself succeeds (git-release-squash accepts any key in the
  // keyring); release.ts's own check then exits 1, naming both.
  const OTHER = 'A'.repeat(40);
  f.bump('0.0.4', 'feat: fourth', OTHER);
  const gate4 = gateProbe('release-ac11-gate', 0);
  const r4 = f.run(['0.0.4', '--message', 'pinned elsewhere', '--apply'], Object.assign({ RELEASE_TEST_CMD: gate4.cmd }, signEnv));
  T.eq('AC11 signed by a key other than the pin: exit 1', r4.status, 1);
  for (const check of ['release commit', 'release tag']) {
    T.check(`AC11: verify: ${check}: FAIL names release_key_mismatch, the pin and the signer`,
      r4.stdout.split('\n').some((l) => l.startsWith(`verify: ${check}: FAIL `) && l.includes('release_key_mismatch') && l.includes(OTHER) && l.includes(fpr)), r4.stdout);
  }
}

/* ---------------------------------------------------------------- */
/* AC10: every value flag reaches git-release-squash as --flag=value. */
/* From git-history-tools v0.4.0 on (its D17), a space-separated      */
/* value that starts with `--` is "missing value for --flag", so      */
/* `--message --x` would refuse a title starting with `--`. The fake  */
/* git-release-squash records its argv, one per line, so the exact    */
/* contract is checked whichever ght version is installed.            */
/* ---------------------------------------------------------------- */
{
  const f = releaseRepo('release-argv', { squash: 'fake' });
  const argvOf = () => fs.existsSync(f.argvFile) ? fs.readFileSync(f.argvFile, 'utf8').split('\n').slice(0, -1) : [];
  const title = '--leading dashes title';
  const r = f.run(['0.0.2', '--message', title], { RELEASE_TEST_CMD: 'false' });
  T.check('AC10 --message dry run: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
  T.eq('AC10 --message: git-release-squash gets every value flag as --flag=value (a title starting with -- included)',
    JSON.stringify(argvOf()), JSON.stringify(['tail', f.dir, '--name=' + NAME, '--tag=v0.0.2', '--message=' + title]));

  const msgFile = path.join(H.freshDir('release-argv-msgfile'), 'msg.txt');
  fs.writeFileSync(msgFile, 'a file title\n\nbody\n');
  const r2 = f.run(['0.0.2', '--message-file', msgFile], { RELEASE_TEST_CMD: 'false' });
  T.check('AC10 --message-file dry run: exit 0', r2.status === 0, 'exit ' + r2.status + '\n' + r2.stderr + r2.stdout);
  T.eq('AC10 --message-file: git-release-squash gets --message-file=<path>',
    JSON.stringify(argvOf()), JSON.stringify(['tail', f.dir, '--name=' + NAME, '--tag=v0.0.2', '--message-file=' + msgFile]));
}

T.finish();
