#!/usr/bin/env node
'use strict';

// TSK-002: a manual, non-hooked wrapper around git-release-squash
// (git-history-tools), formalising what Lead was doing by hand for every
// release so far (DECISIONS 190-194).
//
//   node tools/release.ts <version> --message <text> [--apply]
//   node tools/release.ts <version> --message-file <file> [--apply]
//   node tools/release.ts --verify-only vX.Y.Z
//
// Dry-run by default -- prints git-release-squash's own `tail --tag` plan
// and writes nothing; --apply is required to actually squash and tag.
// --apply gates on a green `npm test` first; a dry run skips the gate and
// says so (DECISIONS 202, G): the suite takes ~20 minutes, and running it
// twice per release bought nothing -- the dry run writes nothing either way.
// The step-by-step release procedure is docs/RELEASING.md.
//
// Before the gate and before anything is written, dry run included, the
// preflight (tools/release-preflight.mts, DECISIONS 227) refuses other
// local branches or worktrees -- git-release-squash's post-write verify
// runs `verify-commit` on every commit of every branch, so one unsigned
// WIP branch turned it red only AFTER main and the tag had already been
// rewritten (DECISIONS 202, E) -- a dirty tree, a tag after the previous
// release, a version that is not X.Y.Z everywhere, node_modules that are
// not the lock, a doc naming a squashed commit and a stale bundle, all
// reported at once, each with its own code.
//
// <name> is package.json's own "name" ("nanojira"), passed to
// git-release-squash explicitly as --name -- never the checkout's directory
// name, git-release-squash's own fallback, which is "release-fixes" in a
// worktree and anything at all in a scratch clone (DECISIONS 202, F). Its
// `tail --tag` builds the
// release commit's subject as "<name> <tag>: <title>", where <title> is the
// FIRST LINE of --message/--message-file -- the prefix is added once, by
// git-release-squash, not by this script. This is the exact bug Lead hit by
// hand: typing the already-composed subject (as it reads back in `git log`,
// e.g. "nanojira v3.12.2: ...") into --message gets the prefix added AGAIN
// ("nanojira v3.12.2: nanojira v3.12.2: ..."). This script refuses outright
// if the given message's first line already starts with that exact prefix.
//
// The tag message is the --message text (or --message-file's contents),
// verbatim -- git-release-squash writes it as given; only the commit
// subject gets the "<name> <tag>: " prefix.
//
// Signing identity is deliberately this script's business to NOT configure:
// it never writes to any git config, global or local, and never sets one
// itself. Supply user.name/user.email/user.signingkey as one-off
// GIT_CONFIG_* env vars on the invocation itself (or have them already set
// in the repo's own local git config, D1's rule for git-release-squash) --
// this script passes process.env through to git-release-squash unchanged
// either way. The TEST GATE gets the same environment minus every
// GIT_CONFIG_COUNT/KEY_<n>/VALUE_<n>/PARAMETERS variable (DECISIONS 202,
// A): one-off env config outranks a repo's own local config, so inherited,
// the signing identity overrode every test fixture's own user.signingkey
// (ac-56's fixture tags came out unsignable and the gate went red).
//
// After a successful --apply, and alone with --verify-only vX.Y.Z (after
// the push; read-only, no preflight, no gate), it verifies the release in
// seven sections (tools/release-verify.mts, DECISIONS 228), one
// `verify: <check>: OK|FAIL <why>|SKIPPED (<why>)` line each, exit 1 on
// any FAIL; --verify-only also requires origin's main and tag to be this
// repo's.
//
// The release key is pinned (DECISIONS 226): package.json's "releaseKey"
// must be a 40-hex primary fingerprint, checked before the branch check
// and the test gate. After --apply the new release commit and tag must
// both carry a VALIDSIG from exactly that key (tools/release-key.mts) --
// git-release-squash's own `verify: signatures` accepts any key in the
// keyring. A mismatch is a FAIL verify line naming the expected and the
// found fingerprint; the branch and the tag are already rewritten by then,
// so it is a rollback (docs/RELEASING.md), never a push.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readReleaseKey } from './release-key.mts';
import { preflight } from './release-preflight.mts';
import { verifyRelease, formatLine } from './release-verify.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Overridable only so TSK-003's regression test can exercise the red-test
// refusal (and the green path) without needing this repo's own, genuinely
// slow, test suite to cooperate. There is no legitimate reason to override
// this for a real release.
const TEST_CMD = process.env.RELEASE_TEST_CMD || 'npm test';

function usageError(msg: string): never {
  process.stderr.write('release: ' + msg + '\n');
  process.exit(2);
}

function refuse(msg: string): never {
  process.stderr.write('release: refused: ' + msg + '\n');
  process.exit(1);
}

const argv = process.argv.slice(2);

// --verify-only vX.Y.Z: only as the first argument, so a value consumed by
// --message can never turn into it.
if (argv[0] === '--verify-only') {
  const tag = argv[1];
  if (argv.length !== 2 || tag === undefined || !/^v\d+\.\d+\.\d+$/.test(tag)) usageError('usage: release.ts --verify-only vX.Y.Z');
  let name: unknown;
  try { name = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name; } catch { /* reported next */ }
  if (typeof name !== 'string' || name === '') usageError('package.json has no "name"');
  const key = readReleaseKey(ROOT);
  if (!key.ok) refuse(`${key.error}: ${key.message}`);
  const lines = verifyRelease(ROOT, { name, tag, pin: key.pin, requirePushed: true });
  for (const l of lines) process.stdout.write(formatLine(l) + '\n');
  process.exit(lines.some((l) => l.status === 'FAIL') ? 1 : 0);
}
const positional: string[] = [];
let message: string | undefined;
let messageFile: string | undefined;
// `apply` is set only here, in the same position-aware pass that consumes
// --message/--message-file's own value -- not by a separate `argv.includes
// ('--apply')` over the raw array. A blanket scan can't tell a real --apply
// token from the literal string "--apply" sitting one slot later because
// --message's own value was never supplied (`--message --apply`): the
// blanket form flips into real --apply mode on that fat-finger; this form
// cannot, because the token at that position was already consumed as
// --message's value and is never looked at again as a flag.
let apply = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply') { apply = true; continue; }
  if (a === '--message') { message = argv[++i]; continue; }
  if (a === '--message-file') { messageFile = argv[++i]; continue; }
  if (a.startsWith('--')) usageError(`unknown flag '${a}'`);
  positional.push(a);
}

const version = positional[0];
if (!version) usageError('missing <version>');
if (positional.length > 1) usageError(`unexpected argument '${positional[1]}'`);
if (message === undefined && messageFile === undefined) usageError('--message or --message-file is required');
if (message !== undefined && messageFile !== undefined) usageError('--message and --message-file are mutually exclusive');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (typeof pkg.name !== 'string' || pkg.name === '') {
  usageError(`package.json has no "name" -- it names the release ("<name> v<version>: <title>")`);
}
const NAME: string = pkg.name;
if (pkg.version !== version) {
  usageError(`package.json's version is '${pkg.version}', not '${version}' -- bump it first, this script never edits it`);
}

const releaseKey = readReleaseKey(ROOT);
if (!releaseKey.ok) refuse(`${releaseKey.error}: ${releaseKey.message}`);
const PIN = releaseKey.pin;

const tag = 'v' + version;
const prefix = NAME + ' ' + tag + ': ';
let titleSource: string;
if (message !== undefined) {
  titleSource = message;
} else {
  // A plain fs.readFileSync here would let an uncaught ENOENT escape as a
  // raw stack trace -- including for the exact `--message-file --apply`
  // fat-finger (forgetting the file path makes "--apply" itself get
  // consumed as the file path): still safe (the crash happens before the
  // test gate or git-release-squash is ever reached), but a clean usage
  // error is a better outcome than an unhandled exception either way.
  try {
    titleSource = fs.readFileSync(messageFile as string, 'utf8');
  } catch (e) {
    usageError(`cannot read --message-file '${messageFile}': ${(e as Error).message}`);
  }
}
const firstLine = titleSource.split('\n')[0];
if (firstLine.startsWith(prefix)) {
  usageError(
    `the message's first line already starts with '${prefix}' -- git-release-squash adds this prefix itself ` +
    `from the first line of --message/--message-file; pass just the title ('${firstLine.slice(prefix.length)}'), ` +
    `not the already-composed subject, or it will be duplicated`
  );
}

// The preflight (DECISIONS 227, tools/release-preflight.mts): other
// branches or worktrees, a dirty tree, a tag after the previous release,
// the version everywhere, node_modules == the lock, docs naming squashed
// commits, bundle --check. Every problem at once, before the gate and
// before git-release-squash, dry run included.
const problems = preflight(ROOT, NAME, version);
if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`release: refused: ${p.code}: ${p.message} -- ${p.hint}\n`);
  process.exit(1);
}

// One-off git config from the environment (DECISIONS 202, A): kept for
// git-release-squash, which signs with it, but never handed to the gate.
const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/;
function withoutGitConfigEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !GIT_CONFIG_ENV.test(k)));
}

// A release is not worth writing against a red tree. A dry run writes
// nothing, so it skips the ~20-minute gate rather than run it twice.
if (apply) {
  const testResult = spawnSync(TEST_CMD, { cwd: ROOT, shell: true, stdio: 'inherit', env: withoutGitConfigEnv(process.env) });
  if (testResult.status !== 0) {
    refuse(`'${TEST_CMD}' did not pass (exit ${testResult.status}) -- fix the tree before releasing`);
  }
} else {
  process.stdout.write(`release: dry run -- test gate runs with --apply ('${TEST_CMD}'), skipped now\n`);
}

const bin = path.join(ROOT, 'node_modules', '.bin', 'git-release-squash');
if (!fs.existsSync(bin)) usageError(`git-release-squash not found at ${bin} -- npm install first`);

// Every value flag as --flag=value: from git-history-tools v0.4.0 on (its
// D17), a space-separated value starting with `--` is "missing value", so
// `--message --x` would refuse a title that starts with `--`.
const squashArgs = ['tail', ROOT, '--name=' + NAME, '--tag=' + tag]
  .concat(message !== undefined ? ['--message=' + message] : ['--message-file=' + (messageFile as string)])
  .concat(apply ? ['--apply'] : []);

const pre = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const r = spawnSync(bin, squashArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
if (r.status !== 0 || !apply) process.exit(r.status === null ? 1 : r.status);

// The release git-release-squash just wrote, in seven sections
// (tools/release-verify.mts): its own verify accepts any key and checks
// neither dates, content nor origin.
const verified = verifyRelease(ROOT, { name: NAME, tag, pin: PIN, pre, requirePushed: false });
for (const l of verified) process.stdout.write(formatLine(l) + '\n');
if (verified.some((l) => l.status === 'FAIL')) {
  process.stderr.write(`release: verify FAILED -- the branch and ${tag} are already rewritten: roll back (docs/RELEASING.md), do not push\n`);
  process.exit(1);
}
