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
 * git-release-squash, a fake one that records its argv, or none.
 *
 * Speed (TSK-049): every spawn is asynchronous and the cases run as
 * concurrent legs (H.runLegs, checks flushed in this file's order). The
 * signed chain is the long pole, so it starts first: the throwaway key,
 * then AC4 and AC9 on it, their checks recorded and replayed at their
 * place in the order. Inside AC9 the released repo is copied twice, as it
 * stands after the 0.0.2 release: the AC14 clones take one copy as their
 * origin (--verify-only reads origin live), AC11 goes on in the other, and
 * the 0.0.3 release in the repo itself, all at the same time. At most
 * RELEASE_SLOTS release.ts processes run at once, the signed chain's
 * first. */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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

/* The checks a case makes. A leg's own context, or a recorder that keeps
 * them for a leg to replay (the signed chain starts before the legs). */
type Ctx = Pick<H.BufferedContext, 'check' | 'eq' | 'contains'>;
interface Recorder extends Ctx { replay(t: Ctx): void }
function recorder(): Recorder {
  const calls: Array<(t: Ctx) => void> = [];
  return {
    check: (desc, cond, detail) => { calls.push((t) => { t.check(desc, cond, detail); }); return !!cond; },
    eq: (desc, actual, expected) => { calls.push((t) => { t.eq(desc, actual, expected); }); return true; },
    contains: (desc, haystack, needle) => { calls.push((t) => { t.contains(desc, haystack, needle); }); return true; },
    replay: (t) => { for (const c of calls) c(t); },
  };
}

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

interface Run { status: number | null; stdout: string; stderr: string; error?: Error }

/** spawnSync's result, without blocking the other legs: utf8 output, an
 * optional stdin, and on `timeout` a SIGTERM and `error` set. */
function exec(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; input?: string; timeout?: number }): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let error: Error | undefined;
    let done = false;
    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    const timer = o.timeout ? setTimeout(() => { error = new Error('timed out after ' + o.timeout + ' ms'); child.kill('SIGTERM'); }, o.timeout) : null;
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => { error = e; if (child.pid === undefined) finish(null); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => { /* the child may exit before reading its input */ });
    child.stdin.end(o.input);
  });
}

function gitIn(dir: string, args: string[], env?: Record<string, string>, input?: string): Promise<Run> {
  return exec('git', args, { cwd: dir, env: Object.assign({}, process.env, env || {}), input });
}

/* At most RELEASE_SLOTS release.ts runs at once, each with its own git
 * (and gpg) children; an `urgent` run (the signed chain, the long pole) is
 * let in before every plain waiter. */
const RELEASE_SLOTS = 6;
const releaseSlots = H.makeSemaphore(RELEASE_SLOTS);
async function runRelease(scriptPath: string, cwd: string, args: string[], env: Record<string, string>, urgent?: boolean): Promise<Run> {
  await releaseSlots.acquire(urgent);
  try {
    return await exec(process.execPath, [scriptPath, ...args], {
      cwd,
      env: Object.assign({}, process.env, env),
      timeout: 60000,
    });
  } finally {
    releaseSlots.release();
  }
}

async function repoSnapshot(dir: string = ROOT): Promise<{ head: string; tags: string }> {
  const [head, tags] = await Promise.all([
    exec('git', ['rev-parse', 'HEAD'], { cwd: dir, env: process.env }),
    exec('git', ['show-ref', '--tags'], { cwd: dir, env: process.env }),
  ]);
  return { head: head.stdout.trim(), tags: tags.stdout };
}

/* ---------------------------------------------------------------- */
/* The fixture: a release-ready repo built from scratch.            */
/* ---------------------------------------------------------------- */
type Squash = 'real' | 'fake' | 'none';
interface Fixture {
  dir: string;
  /** git in the fixture with its identity (and signing, if any); a failure is a fixture failure. */
  git: (args: string[]) => Promise<Run>;
  /** Writes the four version places (and the stub launcher's answer), then commits everything. */
  bump: (version: string, message: string, releaseKey?: string) => Promise<void>;
  /** Commits whatever is in the tree. */
  commit: (message: string) => Promise<void>;
  argvFile: string;
  run: (args: string[], env?: Record<string, string>) => Promise<Run>;
  /** The repo as it stands now, copied beside a fresh directory: the same fixture from here on. */
  copy: (t: Ctx, label: string) => Fixture;
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
async function releaseRepo(t: Ctx, label: string, opts: { squash: Squash; version?: string; prev?: string; sign?: Record<string, string>; releaseKey?: string }): Promise<Fixture> {
  const version = opts.version || '0.0.2';
  const prev = opts.prev || '0.0.1';
  const releaseKey = opts.releaseKey || ROOT_PKG.releaseKey;
  const dir = path.join(H.freshDir(label), 'fixture-repo');
  fs.mkdirSync(dir, { recursive: true });
  const argvFile = path.join(H.freshDir(label + '-argv'), 'argv.txt');
  const f = fixtureAt(t, label, dir, { sign: opts.sign, releaseKey, argvFile });
  const { git, commit } = f;

  await git(['init', '-q', '-b', 'main']);
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
  f.writeVersion(prev, releaseKey);
  await commit('base');
  await git(['tag', opts.sign ? '-s' : '-a', 'v' + prev, '-m', NAME + ' v' + prev + '\n\nbase']);
  f.writeVersion(version, releaseKey);
  await commit('bump to ' + version);

  const bin = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'),
    JSON.stringify({ name: NAME, lockfileVersion: 3, requires: true, packages: {} }) + '\n');
  if (opts.squash === 'real') fs.symlinkSync(REAL_SQUASH, path.join(bin, 'git-release-squash'));
  if (opts.squash === 'fake') {
    fs.writeFileSync(path.join(bin, 'git-release-squash'),
      '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > ' + JSON.stringify(argvFile) + '\n', { mode: 0o755 });
  }
  return f;
}

/** The fixture's operations on the repo at `dir`. */
function fixtureAt(t: Ctx, label: string, dir: string, o: { sign?: Record<string, string>; releaseKey: string; argvFile: string }): Fixture & { writeVersion: (v: string, key: string) => void } {
  const env = Object.assign({}, ISOLATED_GIT, FIXTURE_ID, o.sign || {});
  const signFlag = o.sign ? ['-S'] : [];
  const git = async (args: string[]) => {
    const r = await gitIn(dir, args, env);
    if (r.status !== 0) t.check(label + ' fixture: git ' + args.join(' '), false, r.stderr);
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
  const commit = async (message: string) => {
    await git(['add', '-A']);
    await git(['commit', '-q', '--allow-empty', ...signFlag, '-m', message]);
  };
  return {
    dir, git, commit, writeVersion, argvFile: o.argvFile,
    bump: async (v, message, key = o.releaseKey) => { writeVersion(v, key); await commit(message); },
    run: (args, extra) => runRelease(path.join(dir, 'tools', 'release.ts'), dir, args, Object.assign({}, ISOLATED_GIT, extra || {}), !!o.sign),
    copy: (t2, label2) => {
      const to = path.join(H.freshDir(label2), 'fixture-repo');
      fs.cpSync(dir, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      return fixtureAt(t2, label2, to, o);
    },
  };
}

/** A throwaway signing key in its own GNUPGHOME, as GIT_CONFIG_* env (never a config file). */
type Signer = { env: Record<string, string>; fpr: string };
async function signingIdentity(t: Ctx, label: string): Promise<Signer | null> {
  const gnupg = H.freshDir(label + '-gnupg');
  fs.chmodSync(gnupg, 0o700);
  const gpgEnv = Object.assign({}, process.env, { GNUPGHOME: gnupg });
  const gen = await exec('gpg', ['--batch', '--passphrase', '', '--quick-gen-key', 'NJ Release Test <release@example.invalid>', 'ed25519', 'sign', '0'],
    { cwd: gnupg, env: gpgEnv, timeout: 30000 });
  t.check(label + ' fixture: gpg --quick-gen-key (throwaway key)', gen.status === 0, gen.stderr);
  const list = await exec('gpg', ['--batch', '--list-secret-keys', '--with-colons'], { cwd: gnupg, env: gpgEnv, timeout: 15000 });
  const m = /^fpr:::::::::([0-9A-F]{40}):/m.exec(list.stdout || '');
  t.check(label + ' fixture: parsed a fingerprint for the throwaway key', !!m, list.stdout);
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
/* AC4: the fat-finger Reviewer found, in both the --message and the */
/* --message-file form: the text/path was forgotten, so --apply      */
/* itself gets consumed as the OTHER flag's value. A signed,         */
/* release-ready fixture with the real git-release-squash, so a      */
/* regression would actually write a signed commit and tag.          */
/* ---------------------------------------------------------------- */
async function assertFatFingerIsSafe(t: Ctx, SIGNER: Signer | null, label: string, fatFingerArgs: string[]): Promise<void> {
  if (!SIGNER) return;
  const f = await releaseRepo(t, label.replace(/\W+/g, '-'), { squash: 'real', sign: SIGNER.env, releaseKey: SIGNER.fpr });
  const before = await repoSnapshot(f.dir);
  const r = await f.run(['0.0.2', ...fatFingerArgs], Object.assign({ RELEASE_TEST_CMD: 'true' }, SIGNER.env));
  const after = await repoSnapshot(f.dir);
  t.eq(label + ': HEAD unchanged -- no real commit was made', after.head, before.head);
  t.eq(label + ': no new tag was created', after.tags, before.tags);
  t.check(label + ': ran without a spawn error', r.error === undefined, r.error);
}

/* ---------------------------------------------------------------- */
/* AC9: one real, signed --apply, end to end. Pins: exit 0 with every */
/* verify line OK, the release key's two included; the gate ran and  */
/* saw no GIT_CONFIG_* (A) although the signing identity arrives      */
/* exactly that way; the commit subject is "<name> v<version>:        */
/* <title>" (F); and the tag message is the --message text, or        */
/* --message-file's contents, verbatim (H; see docs/RELEASING.md).    */
/* AC11 then pins another key: the squash succeeds, release.ts's own  */
/* check exits 1 naming both fingerprints.                           */
/* Returns the recorders in check order: the 0.0.2 release, the AC14 */
/* clones one by one, the repo's own checks and 0.0.3, then AC11.     */
/* ---------------------------------------------------------------- */
async function signedRelease(SIGNER: Signer): Promise<Recorder[]> {
  const fpr = SIGNER.fpr;
  const signEnv = SIGNER.env;
  const t = recorder();
  const f = await releaseRepo(t, 'release-ac9', { squash: 'real', sign: signEnv, releaseKey: fpr });
  await f.commit('fix: something else');
  const repo = f.dir;

  const gate = gateProbe('release-ac9-gate', 0);
  const r = await f.run(['0.0.2', '--message', 'a bare title', '--apply'], Object.assign({ RELEASE_TEST_CMD: gate.cmd }, signEnv));
  let seen: { leaked: string[] } | null = null;
  try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }

  t.check('AC9 signed --apply end to end: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
  t.check('AC9: the gate ran', seen !== null, gate.marker);
  t.eq('AC9/A: the gate saw no GIT_CONFIG_* although signing used them', JSON.stringify(seen && seen.leaked), '[]');
  t.contains('AC9: verify: tree delta OK', r.stdout, 'verify: tree delta: OK');
  t.contains('AC9: verify: signatures OK', r.stdout, 'verify: signatures: OK');
  for (const check of ['squash', 'release commit', 'release tag', 'content', 'refs', 'history signatures']) {
    t.check('AC9/AC14: verify: ' + check + ': OK', r.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': OK')), r.stdout);
  }
  t.contains('AC14: no origin is SKIPPED, not FAIL', r.stdout, 'verify: old tags vs origin: SKIPPED (origin unreachable)');

  // AC14 --verify-only, after the push: a clone of the released repo has
  // it as origin, main and the tag included. Each forged clone fails its
  // own section. The released repo as it stands now is that origin: a
  // byte copy, so the releases below can go on in the repo meanwhile.
  const released = f.copy(t, 'release-ac14-origin').dir;
  // AC11 (below) goes on from a second copy, beside the 0.0.3 release.
  const w = recorder();
  const pinned = f.copy(w, 'release-ac11');
  type Git = (args: string[], input?: string) => Promise<string>;
  const verifyOnly = async (t: Ctx, label: string, forge: (git: Git, clone: string) => Promise<void>) => {
    const clone = path.join(H.freshDir('release-ac14-' + label), 'clone');
    await gitIn(path.dirname(clone), ['clone', '-q', released, clone], signEnv);
    const git = async (args: string[], input?: string) => {
      const x = await exec('git', args, { cwd: clone, input, env: Object.assign({}, process.env, signEnv, FIXTURE_ID) });
      if (x.status !== 0) t.check('AC14 ' + label + ' fixture: git ' + args.join(' '), false, x.stderr);
      return String(x.stdout).trim();
    };
    await forge(git, clone);
    return runRelease(path.join(clone, 'tools', 'release.ts'), clone, ['--verify-only', 'v0.0.2'], signEnv);
  };
  const failsIn = (t: Ctx, label: string, check: string, v: Run) => {
    t.eq('AC14 ' + label + ': exit 1', v.status, 1);
    t.check('AC14 ' + label + ': verify: ' + check + ': FAIL', v.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': FAIL')), v.stdout + v.stderr);
  };
  // Commit and tag rebuilt with the same dates, tree, parent and
  // messages and signed again by the pinned key: now (the real time), or
  // through a gpg wrapper at the pinned time, optionally under another
  // identity.
  const reSign = (t: Ctx, label: string, o: { ident?: [string, string]; pinned?: boolean }) => verifyOnly(t, label, async (git, clone) => {
    const [name, email, date] = (await git(['log', '-1', '--format=%an%x00%ae%x00%ad', '--date=raw', 'v0.0.2^{commit}'])).split('\0');
    const [n, e] = o.ident || [name, email];
    // '@': git reads a bare epoch this small as an ambiguous date.
    const env: Record<string, string> = Object.assign({}, signEnv, { GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_AUTHOR_DATE: '@' + date,
      GIT_COMMITTER_NAME: n, GIT_COMMITTER_EMAIL: e, GIT_COMMITTER_DATE: '@' + date });
    if (o.pinned) {
      const keys = await exec('gpg', ['--batch', '--with-colons', '--list-keys', '--', SIGNER.fpr],
        { cwd: clone, env: Object.assign({}, process.env, { GNUPGHOME: signEnv.GNUPGHOME }) });
      const created = Number((/^pub:(?:[^:]*:){4}(\d+):/m.exec(keys.stdout || '') || [])[1]);
      const wrapper = path.join(path.dirname(clone), 'gpg-pinned.sh');
      fs.writeFileSync(wrapper, '#!/bin/sh\nexec gpg --faked-system-time ' + (created + 60) + '! "$@"\n', { mode: 0o755 });
      Object.assign(env, { GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_3: 'gpg.program', GIT_CONFIG_VALUE_3: wrapper });
    }
    const ct = await gitIn(clone, ['commit-tree', '-S', 'v0.0.2^{tree}', '-p', 'v0.0.1^{commit}', '-m', 'nanojira v0.0.2: a bare title'], env);
    t.eq('AC14 ' + label + ' fixture: commit re-signed', ct.status + ' ' + ct.stderr, '0 ');
    const forged = ct.stdout.trim();
    await git(['update-ref', 'refs/heads/main', forged]);
    t.eq('AC14 ' + label + ' fixture: tag re-signed', (await gitIn(clone, ['tag', '-f', '-s', 'v0.0.2', forged, '-m', 'a bare title'], env)).status, 0);
  });
  /** Both sections FAIL, each naming only `why`. */
  const failsOnlyFor = (t: Ctx, label: string, why: string, v: Run) => {
    for (const check of ['release commit', 'release tag']) {
      failsIn(t, label, check, v);
      t.check('AC14 ' + label + ': verify: ' + check + ': FAIL names only ' + JSON.stringify(why),
        v.stdout.split('\n').some((l) => l.startsWith('verify: ' + check + ': FAIL ') && l.includes(why) && !l.includes(';')), v.stdout);
    }
  };
  const ac14: Array<(t: Ctx) => Promise<void>> = [
    async (t) => {
      const clean = await verifyOnly(t, 'clean', async () => {});
      t.check('AC14 --verify-only on the pushed release: exit 0, every line OK', clean.status === 0 && !/: (FAIL|SKIPPED)/.test(clean.stdout), clean.stdout + clean.stderr);
      t.contains('AC14 --verify-only: origin == local', clean.stdout, 'verify: origin == local: OK');
    },
    async (t) => failsIn(t, 'an extra commit', 'squash', await verifyOnly(t, 'extra', async (git) => {
      await git(['commit', '-q', '-S', '--allow-empty', '-m', 'extra']);
      await git(['tag', '-f', '-s', 'v0.0.2', '-m', 'a bare title']);
    })),
    async (t) => failsIn(t, 'a wrong date', 'release commit', await verifyOnly(t, 'date', async (git) => {
      // Same tree, parent and subject, signed, but dated now.
      const forged = await git(['commit-tree', '-S', 'v0.0.2^{tree}', '-p', 'v0.0.1^{commit}', '-m', 'nanojira v0.0.2: a bare title']);
      await git(['update-ref', 'refs/heads/main', forged]);
      await git(['tag', '-f', '-s', 'v0.0.2', forged, '-m', 'a bare title']);
    })),
    // This leg's precondition is "the real signing clock lands somewhere
    // other than the DECISIONS 190 pin (key creation + 60 s)": it signs
    // at whatever `gpg` sees as now, with no faked-time wrapper, and the
    // leg expects verify to FAIL on the mismatch. Under load, if exactly
    // 60 s (to the second) pass between the fixture key's own keygen and
    // this re-sign, the real clock lands ON the pin by chance and verify
    // reports OK -- not a finding about verify, the precondition itself
    // didn't hold for that try. Each try signs fresh (a new real `now`),
    // so retried up to 3 times through a throwaway recorder; only the
    // accepted try's housekeeping checks are replayed onto `t` (Lead-found,
    // base-2 load ~33, also reproducible on 4a8fa5d).
    async (t) => {
      const MAX_TRIES = 3;
      let v!: Run, rec!: Recorder;
      const history: string[] = [];
      for (let tries = 0; tries < MAX_TRIES; tries++) {
        rec = recorder();
        v = await reSign(rec, 'sigtime', {});
        const coincided = v.status === 0 && !/: (FAIL|SKIPPED)/.test(v.stdout);
        history.push('try ' + tries + ': ' + (coincided ? 'coincided with the pin by chance (exit 0, all OK)' : 'differed from the pin, as the leg means to test'));
        if (!coincided) break;
      }
      rec.replay(t);
      if (v.status === 0 && !/: (FAIL|SKIPPED)/.test(v.stdout)) {
        t.check('AC14 sigtime: the real signature time kept landing on the pin after ' + MAX_TRIES + ' tries', false, history.join(' | '));
      }
      await failsOnlyFor(t, 'a real signature time', 'signature time ', v);
    },
    // Signed by the pin at the pinned time, but not as the key's owner.
    async (t) => failsOnlyFor(t, 'another identity', 'is not a user ID of the release key',
      await reSign(t, 'ident', { ident: ['Implementer (WIP)', 'implementer-wip@localhost'], pinned: true })),
    async (t) => failsIn(t, 'two signature blocks', 'release tag', await verifyOnly(t, 'twosig', async (git) => {
      const body = await git(['cat-file', 'tag', 'v0.0.2']) + '\n';
      const block = body.slice(body.indexOf('-----BEGIN PGP SIGNATURE-----'));
      await git(['update-ref', 'refs/tags/v0.0.2', await git(['mktag'], body + block)]);
    })),
    async (t) => failsIn(t, 'a lightweight tag', 'release tag', await verifyOnly(t, 'light', async (git) => {
      await git(['tag', '-f', 'v0.0.2', 'v0.0.2^{commit}']);
    })),
    async (t) => failsIn(t, 'an old tag moved on origin', 'old tags vs origin', await verifyOnly(t, 'moved', async (git, clone) => {
      const bare = path.join(path.dirname(clone), 'origin.git');
      await gitIn(path.dirname(clone), ['clone', '-q', '--bare', released, bare], signEnv);
      await gitIn(bare, ['tag', '-f', 'v0.0.1', 'v0.0.2^{commit}'], signEnv);
      await git(['remote', 'set-url', 'origin', bare]);
    })),
  ];
  const ac14Recs = ac14.map(() => recorder());
  const ac14Done = Promise.all(ac14.map((leg, i) => leg(ac14Recs[i])));

  const u = recorder();
  const later = (async () => {
    u.eq('AC9/F: commit subject is "<package name> v<version>: <title>"',
      (await gitIn(repo, ['log', '-1', '--format=%s'], signEnv)).stdout.trim(), 'nanojira v0.0.2: a bare title');
    u.eq('AC9: the two commits since v0.0.1 became one',
      (await gitIn(repo, ['rev-list', '--count', 'v0.0.1..HEAD'], signEnv)).stdout.trim(), '1');
    u.eq('AC9: v0.0.2 points at HEAD',
      (await gitIn(repo, ['rev-parse', 'v0.0.2^{commit}'], signEnv)).stdout.trim(),
      (await gitIn(repo, ['rev-parse', 'HEAD'], signEnv)).stdout.trim());
    u.eq('AC9: v0.0.2 is an annotated tag', (await gitIn(repo, ['cat-file', '-t', 'v0.0.2'], signEnv)).stdout.trim(), 'tag');
    u.eq('AC9/H: the tag message is the --message text, verbatim (current form)',
      (await gitIn(repo, ['tag', '-l', '--format=%(contents:subject)|%(contents:body)', 'v0.0.2'], signEnv)).stdout.trim(),
      'a bare title|');
    u.eq('AC9: git tag -v v0.0.2 verifies', (await gitIn(repo, ['tag', '-v', 'v0.0.2'], signEnv)).status, 0);

    // The documented way to give a release a body (docs/RELEASING.md):
    // --message-file. Its first line is the title -- the commit subject's
    // "<title>" and the tag message's first line alike -- and the rest is
    // the tag body, verbatim: the v3.12.2 "<title>\n\n<body>" form.
    await f.bump('0.0.3', 'feat: third');
    const msgFile = path.join(H.freshDir('release-ac9-msg'), 'message.txt');
    fs.writeFileSync(msgFile, 'a titled release\n\n- first point\n- second point\n');
    const gate3 = gateProbe('release-ac9-gate3', 0);
    const r3 = await f.run(['0.0.3', '--message-file', msgFile, '--apply'], Object.assign({ RELEASE_TEST_CMD: gate3.cmd }, signEnv));
    u.check('AC9 --message-file --apply: exit 0', r3.status === 0, 'exit ' + r3.status + '\n' + r3.stderr + r3.stdout);
    u.eq('AC9/H --message-file: commit subject is "<name> v<version>: <first line>"',
      (await gitIn(repo, ['log', '-1', '--format=%s', 'v0.0.3'], signEnv)).stdout.trim(), 'nanojira v0.0.3: a titled release');
    u.eq('AC9/H --message-file: tag message is "<title>\\n\\n<body>", the file verbatim',
      (await gitIn(repo, ['tag', '-l', '--format=%(contents:subject)|%(contents:body)', 'v0.0.3'], signEnv)).stdout.trim(),
      'a titled release|- first point\n- second point');
    u.eq('AC9: git tag -v v0.0.3 verifies', (await gitIn(repo, ['tag', '-v', 'v0.0.3'], signEnv)).status, 0);
  })();

  // AC11: the same signing key, but package.json pins another one. The
  // squash itself succeeds (git-release-squash accepts any key in the
  // keyring); release.ts's own check then exits 1, naming both. On the
  // copy of the repo as released at 0.0.2 (no rule ties 0.0.4 to 0.0.3).
  const ac11 = (async () => {
    const OTHER = 'A'.repeat(40);
    await pinned.bump('0.0.4', 'feat: fourth', OTHER);
    const gate4 = gateProbe('release-ac11-gate', 0);
    const r4 = await pinned.run(['0.0.4', '--message', 'pinned elsewhere', '--apply'], Object.assign({ RELEASE_TEST_CMD: gate4.cmd }, signEnv));
    w.eq('AC11 signed by a key other than the pin: exit 1', r4.status, 1);
    for (const check of ['release commit', 'release tag']) {
      w.check(`AC11: verify: ${check}: FAIL names release_key_mismatch, the pin and the signer`,
        r4.stdout.split('\n').some((l) => l.startsWith(`verify: ${check}: FAIL `) && l.includes('release_key_mismatch') && l.includes(OTHER) && l.includes(fpr)), r4.stdout);
    }
  })();
  await Promise.all([ac14Done, later, ac11]);
  return [t, ...ac14Recs, u, w];
}

/* The signed chain, started before the legs: it is the long pole. Each
 * part's checks are replayed by its leg below, at its place in the order. */
const signer = recorder();
const SIGNER_P = signingIdentity(signer, 'release-signer');
function startSigned(run: (s: Signer | null) => Promise<Recorder[]>): Promise<Recorder[]> {
  const p = SIGNER_P.then(run);
  p.catch(() => { /* rethrown in the leg that awaits it */ });
  return p;
}
const AC4_MESSAGE = startSigned(async (s) => { const t = recorder(); await assertFatFingerIsSafe(t, s, 'AC4 fat-finger (--message --apply)', ['--message', '--apply']); return [t]; });
const AC4_FILE = startSigned(async (s) => { const t = recorder(); await assertFatFingerIsSafe(t, s, 'AC4 fat-finger (--message-file --apply)', ['--message-file', '--apply']); return [t]; });
const AC9 = startSigned(async (s) => s ? signedRelease(s) : []);
const replay = (p: Promise<Recorder[]>) => async (t: H.BufferedContext) => { for (const r of await p) r.replay(t); };

/* ---------------------------------------------------------------- */
/* AC13 (DECISIONS 227): the preflight. Each defect alone, in a dry  */
/* run: exit 1, its own code, git-release-squash never reached. Then */
/* two defects at once: both reported in one run.                   */
/* ---------------------------------------------------------------- */
async function refusedWith(t: Ctx, what: string, f: Fixture, code: string, names: string[] = []): Promise<Run> {
  const r = await f.run(['0.0.2', '--message', 'preflight'], { RELEASE_TEST_CMD: 'true' });
  const line = r.stderr.split('\n').find((l) => l.startsWith('release: refused: ' + code + ': ')) || '';
  t.eq('AC13 ' + what + ': exit 1', r.status, 1);
  t.check('AC13 ' + what + ': one line "release: refused: ' + code + ': …"' + (names.length ? ' naming ' + names.join(', ') : ''),
    line !== '' && names.every((n) => line.includes(n)), r.stderr);
  t.check('AC13 ' + what + ': git-release-squash never ran', !fs.existsSync(f.argvFile), r.stdout);
  return r;
}

await H.runLegs([
  /* ---------------------------------------------------------------- */
  /* AC1: red test gate + --apply. No git-release-squash installed: if */
  /* the gate ran AFTER the bin-resolution step instead of before it,  */
  /* this would come back exit 2 ("not found"), not exit 1.            */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const f = await releaseRepo(t, 'release-ac1', { squash: 'none' });
    const r = await f.run(['0.0.2', '--message', 'red-apply test', '--apply'], { RELEASE_TEST_CMD: 'false' });
    t.eq('AC1 red test + --apply: exit 1, not 2', r.status, 1);
    t.contains('AC1: stderr names the gate refusal', r.stderr, 'did not pass');
  },

  /* ---------------------------------------------------------------- */
  /* AC3: the prefix-duplication guard -- against the real repo, safe  */
  /* because --apply is never given, and the check fires (a usage     */
  /* error) before the preflight and the gate.                        */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const tag = 'v' + PKG_VERSION;
    const prefix = NAME + ' ' + tag + ': ';
    const r = await runRelease(RELEASE, ROOT, [PKG_VERSION, '--message', prefix + 'some title'], { RELEASE_TEST_CMD: 'true' });
    t.eq('AC3 already-prefixed message: usage error, exit 2 (not 0, not 1)', r.status, 2);
    t.contains('AC3: stderr names the duplicate-prefix refusal', r.stderr, 'already starts with');
  },

  /* ---------------------------------------------------------------- */
  /* AC2/AC5/AC6: a dry run with a bare title in a release-ready repo  */
  /* not named after the package: exit 0, git-release-squash's own    */
  /* plan prefixed with package.json's "name", the gate not run, and  */
  /* nothing written -- in the fixture and in this repo.              */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const rootBefore = await repoSnapshot(ROOT);
    const f = await releaseRepo(t, 'release-ac2', { squash: 'real' });
    t.check('AC5 fixture: the repo\'s directory is NOT named after the package', path.basename(f.dir) !== NAME, f.dir);
    const gate = gateProbe('release-ac2-gate', 1);
    const before = await repoSnapshot(f.dir);
    const r = await f.run(['0.0.2', '--message', 'a bare safe title'], { RELEASE_TEST_CMD: gate.cmd });
    const after = await repoSnapshot(f.dir);
    t.eq('AC2 dry run (correct bare title): exit 0', r.status, 0);
    t.contains('AC2/AC5: the dry-run plan is prefixed with package.json\'s "name"', r.stdout, NAME + ' v0.0.2: a bare safe title');
    t.check('AC6: a dry run never runs the test gate', !fs.existsSync(gate.marker), gate.marker);
    t.contains('AC6: a dry run says the gate runs with --apply', r.stdout + r.stderr, 'test gate runs with --apply');
    t.contains('AC2: stdout says dry run, no ref changed', r.stdout, 'dry run');
    t.eq('AC2: HEAD unchanged after a dry run', after.head, before.head);
    t.eq('AC2: no tag ref created or changed by a dry run', after.tags, before.tags);
    const rootAfter = await repoSnapshot(ROOT);
    t.eq('AC2: the real repo\'s HEAD is untouched throughout', rootAfter.head, rootBefore.head);
    t.eq('AC2: the real repo\'s tags are untouched throughout', rootAfter.tags, rootBefore.tags);
  },

  /* ---------------------------------------------------------------- */
  /* AC5 (F): package.json without a "name" is a usage error, not a   */
  /* silent fallback to the directory name.                           */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const scratch = H.freshDir('release-noname');
    await gitIn(scratch, ['init', '-q']);
    installRelease(scratch);
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
    const r = await runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
      ['9.9.9', '--message', 'no name', '--apply'], { RELEASE_TEST_CMD: 'true' });
    t.eq('AC5 package.json without "name": usage error, exit 2', r.status, 2);
    t.contains('AC5: stderr names package.json\'s "name"', r.stderr, '"name"');
  },

  /* ---------------------------------------------------------------- */
  /* AC12: a "releaseKey" that is not 40 hex digits is refused before */
  /* the gate (and before git-release-squash), dry run or --apply.    */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const scratch = H.freshDir('release-ac12');
    await gitIn(scratch, ['init', '-q']);
    installRelease(scratch);
    fs.writeFileSync(path.join(scratch, 'package.json'),
      JSON.stringify({ name: 'nanojira', version: '9.9.9', type: 'module', releaseKey: 'BEEEE63B' }));
    const gate = gateProbe('release-ac12-gate', 0);
    const r = await runRelease(path.join(scratch, 'tools', 'release.ts'), scratch,
      ['9.9.9', '--message', 'bad pin', '--apply'], { RELEASE_TEST_CMD: gate.cmd });
    t.eq('AC12 releaseKey not 40 hex: refused, exit 1', r.status, 1);
    t.check('AC12: stderr names release_key_invalid and the value', r.stderr.includes('release_key_invalid') && r.stderr.includes('BEEEE63B'), r.stderr);
    t.check('AC12: refused before the test gate ran', !fs.existsSync(gate.marker), gate.marker);
  },

  /* ---------------------------------------------------------------- */
  /* AC7 (E): other local branches -- refused, naming them, before     */
  /* the gate or git-release-squash runs, in a dry run too (DECISIONS  */
  /* 227; until 4.4.0 a dry run only warned).                          */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const f = await releaseRepo(t, 'release-ac7', { squash: 'fake' });
    await f.git(['branch', 'wip-unsigned-a']);
    await f.git(['branch', 'wip-unsigned-b']);
    const dry = await f.run(['0.0.2', '--message', 'branch check'], { RELEASE_TEST_CMD: 'true' });
    t.eq('AC7 other branches, dry run: refused, exit 1', dry.status, 1);
    t.check('AC7: other_branches names both branches', /other_branches: .*wip-unsigned-a.*wip-unsigned-b/.test(dry.stderr), dry.stderr);
    t.check('AC7: the dry run never reached git-release-squash', !fs.existsSync(f.argvFile), f.argvFile);

    const applyGate = gateProbe('release-ac7-applygate', 1);
    const before = await repoSnapshot(f.dir);
    const app = await f.run(['0.0.2', '--message', 'branch check', '--apply'], { RELEASE_TEST_CMD: applyGate.cmd });
    const after = await repoSnapshot(f.dir);
    t.eq('AC7 other branches + --apply: refused, exit 1', app.status, 1);
    t.contains('AC7: --apply names other_branches', app.stderr, 'other_branches');
    t.check('AC7: refused before the test gate ran', !fs.existsSync(applyGate.marker), applyGate.marker);
    t.eq('AC7: HEAD unchanged', after.head, before.head);
    t.eq('AC7: no tag ref created or changed', after.tags, before.tags);
  },

  /* ---------------------------------------------------------------- */
  /* AC8 (A): the GIT_CONFIG_* identity release.ts is invoked with     */
  /* never reaches the test gate. No git-release-squash installed: a  */
  /* clean gate passes and the run stops at "not found" (exit 2); a   */
  /* leaking one would make the probe exit 1 ("refused").             */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const f = await releaseRepo(t, 'release-ac8', { squash: 'none' });
    const gate = gateProbe('release-ac8-gate', 0);
    const r = await f.run(['0.0.2', '--message', 'env scrub', '--apply'], {
      RELEASE_TEST_CMD: gate.cmd,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.signingkey', GIT_CONFIG_VALUE_0: '0000000000000000000000000000000000000000',
      GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'leak probe',
      GIT_CONFIG_PARAMETERS: "'user.email'='leak@example.invalid'",
    });
    let seen: { leaked: string[] } | null = null;
    try { seen = JSON.parse(fs.readFileSync(gate.marker, 'utf8')); } catch (e) { /* reported below */ }
    t.check('AC8: the gate ran under --apply', seen !== null, gate.marker + '\n' + r.stderr);
    t.eq('AC8: the gate saw no GIT_CONFIG_* variable', JSON.stringify(seen && seen.leaked), '[]');
    t.eq('AC8: past the gate, stopped only by the missing git-release-squash (exit 2)', r.status, 2);
  },

  /* AC13, one leg per defect (refusedWith above). */
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-worktree', { squash: 'fake' });
    const wt = path.join(path.dirname(f.dir), 'other-worktree');
    await f.git(['worktree', 'add', '-q', '--detach', wt]);
    await refusedWith(t, 'another worktree', f, 'other_worktrees', [wt]);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-dirty', { squash: 'fake' });
    fs.writeFileSync(path.join(f.dir, 'stray.txt'), 'untracked\n');
    await refusedWith(t, 'a dirty tree', f, 'dirty_tree', ['stray.txt']);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-tag', { squash: 'fake' });
    await f.git(['tag', 'bookmark']);
    await refusedWith(t, 'a tag after the previous release', f, 'tag_after_release', ['bookmark', 'v0.0.1']);
  },
  async (t) => {
    // R2: vPREV is the newest exact vX.Y.Z; an rc tag after it is a tag
    // after the release, not the release itself.
    const f = await releaseRepo(t, 'release-ac13-rc', { squash: 'fake' });
    await f.git(['tag', '-a', 'v0.0.2-rc1', '-m', 'rc']);
    await refusedWith(t, 'an rc tag after the previous release', f, 'tag_after_release', ['v0.0.2-rc1', 'v0.0.1']);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-version', { squash: 'fake' });
    fs.writeFileSync(path.join(f.dir, 'SKILL.md'), '---\nname: nanojira\nmetadata:\n  version: "0.0.1"\n---\n');
    await f.commit('SKILL.md left behind');
    await refusedWith(t, 'SKILL.md at another version', f, 'version_mismatch', ['SKILL.md', '0.0.1']);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-lock', { squash: 'fake' });
    const lockFile = path.join(f.dir, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.packages['node_modules/dep'] = { version: '1.0.0', resolved: 'git+ssh://example.invalid/dep.git#aaaaaaa' };
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
    await f.commit('lock a dependency');
    // Installed: the same version from another commit -- the version alone proves nothing.
    fs.writeFileSync(path.join(f.dir, 'node_modules', '.package-lock.json'), JSON.stringify({
      packages: { 'node_modules/dep': { version: '1.0.0', resolved: 'git+ssh://example.invalid/dep.git#bbbbbbb' } },
    }) + '\n');
    await refusedWith(t, 'node_modules resolved from another commit', f, 'node_modules_mismatch', ['node_modules/dep']);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-docsha', { squash: 'fake' });
    const squashed = (await f.git(['rev-parse', '--short=9', 'HEAD'])).stdout.trim();
    const released = (await f.git(['rev-parse', '--short=9', 'v0.0.1^{commit}'])).stdout.trim();
    fs.writeFileSync(path.join(f.dir, 'docs', 'CHANGES.md'),
      '# Changes\n\n- fixed in ' + squashed + '\n- since ' + released + ', a released commit\n');
    await f.commit('changes');
    const r = await refusedWith(t, 'a doc naming a squashed commit', f, 'doc_names_squashed_commit', ['docs/CHANGES.md', squashed]);
    t.check('AC13 a released commit\'s sha is not a finding', !r.stderr.includes(released), r.stderr);
  },
  async (t) => {
    // R1: the cut flow cherry-picks work-branch commits, so docs name shas
    // that are in no release and not in vPREV..HEAD either (an object
    // fetched from the work clone). Upper case counts too.
    const f = await releaseRepo(t, 'release-ac13-docsha-outside', { squash: 'fake' });
    const outside = (await f.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'work-branch commit'])).stdout.trim();
    fs.writeFileSync(path.join(f.dir, 'docs', 'CHANGES.md'), '# Changes\n\n- red against ' + outside.slice(0, 9).toUpperCase() + '\n');
    await f.commit('changes');
    await refusedWith(t, 'a doc naming an unreleased commit outside HEAD', f, 'doc_names_squashed_commit', ['docs/CHANGES.md', outside.slice(0, 9).toUpperCase()]);
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-bundle', { squash: 'fake' });
    fs.writeFileSync(path.join(f.dir, 'tools', 'bundle-stale'), '');
    await f.commit('stale bundle');
    await refusedWith(t, 'bundle --check failing', f, 'bundle_stale');
  },
  async (t) => {
    const f = await releaseRepo(t, 'release-ac13-two', { squash: 'fake' });
    await f.git(['tag', 'bookmark']);
    fs.writeFileSync(path.join(f.dir, 'stray.txt'), 'untracked\n');
    const r = await refusedWith(t, 'two defects', f, 'dirty_tree');
    t.contains('AC13 two defects: both reported in one run', r.stderr, 'release: refused: tag_after_release: ');
  },

  /* AC4 and AC9/AC14/AC11 (started above), then the key's own checks first. */
  async (t) => { await SIGNER_P; signer.replay(t); },
  replay(AC4_MESSAGE),
  replay(AC4_FILE),
  replay(AC9),

  /* ---------------------------------------------------------------- */
  /* AC10: every value flag reaches git-release-squash as --flag=value. */
  /* From git-history-tools v0.4.0 on (its D17), a space-separated      */
  /* value that starts with `--` is "missing value for --flag", so      */
  /* `--message --x` would refuse a title starting with `--`. The fake  */
  /* git-release-squash records its argv, one per line, so the exact    */
  /* contract is checked whichever ght version is installed.            */
  /* ---------------------------------------------------------------- */
  async (t) => {
    const f = await releaseRepo(t, 'release-argv', { squash: 'fake' });
    const argvOf = () => fs.existsSync(f.argvFile) ? fs.readFileSync(f.argvFile, 'utf8').split('\n').slice(0, -1) : [];
    const title = '--leading dashes title';
    const r = await f.run(['0.0.2', '--message', title], { RELEASE_TEST_CMD: 'false' });
    t.check('AC10 --message dry run: exit 0', r.status === 0, 'exit ' + r.status + '\n' + r.stderr + r.stdout);
    t.eq('AC10 --message: git-release-squash gets every value flag as --flag=value (a title starting with -- included)',
      JSON.stringify(argvOf()), JSON.stringify(['tail', f.dir, '--name=' + NAME, '--tag=v0.0.2', '--message=' + title]));

    const msgFile = path.join(H.freshDir('release-argv-msgfile'), 'msg.txt');
    fs.writeFileSync(msgFile, 'a file title\n\nbody\n');
    const r2 = await f.run(['0.0.2', '--message-file', msgFile], { RELEASE_TEST_CMD: 'false' });
    t.check('AC10 --message-file dry run: exit 0', r2.status === 0, 'exit ' + r2.status + '\n' + r2.stderr + r2.stdout);
    t.eq('AC10 --message-file: git-release-squash gets --message-file=<path>',
      JSON.stringify(argvOf()), JSON.stringify(['tail', f.dir, '--name=' + NAME, '--tag=v0.0.2', '--message-file=' + msgFile]));
  },
], { concurrency: 8 });

T.finish();
