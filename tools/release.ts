#!/usr/bin/env node
'use strict';

// TSK-002: a manual, non-hooked wrapper around git-release-squash
// (git-history-tools), formalising what Lead was doing by hand for every
// release so far (DECISIONS 190-194).
//
//   node tools/release.ts <version> --message <text> [--apply]
//   node tools/release.ts <version> --message-file <file> [--apply]
//
// Dry-run by default -- prints git-release-squash's own `tail --tag` plan
// and writes nothing; --apply is required to actually squash and tag.
// Gates on a green `npm test` first, for either mode: a release is not even
// worth planning against a red tree.
//
// <name> is this repo's own directory name ("nanojira"), the same default
// git-release-squash itself falls back to. Its `tail --tag` builds the
// release commit's subject as "<name> <tag>: <title>", where <title> is the
// FIRST LINE of --message/--message-file -- the prefix is added once, by
// git-release-squash, not by this script. This is the exact bug Lead hit by
// hand: typing the already-composed subject (as it reads back in `git log`,
// e.g. "nanojira v3.12.2: ...") into --message gets the prefix added AGAIN
// ("nanojira v3.12.2: nanojira v3.12.2: ..."). This script refuses outright
// if the given message's first line already starts with that exact prefix.
//
// Signing identity is deliberately this script's business to NOT configure:
// it never writes to any git config, global or local, and never sets one
// itself. Supply user.name/user.email/user.signingkey as one-off
// GIT_CONFIG_* env vars on the invocation itself (or have them already set
// in the repo's own local git config, D1's rule for git-release-squash) --
// this script passes process.env through to the child process unchanged
// either way.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NAME = path.basename(ROOT);

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
if (pkg.version !== version) {
  usageError(`package.json's version is '${pkg.version}', not '${version}' -- bump it first, this script never edits it`);
}

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

// A release is not worth planning, let alone writing, against a red tree.
const testResult = spawnSync(TEST_CMD, { cwd: ROOT, shell: true, stdio: 'inherit' });
if (testResult.status !== 0) {
  refuse(`'${TEST_CMD}' did not pass (exit ${testResult.status}) -- fix the tree before releasing`);
}

const bin = path.join(ROOT, 'node_modules', '.bin', 'git-release-squash');
if (!fs.existsSync(bin)) usageError(`git-release-squash not found at ${bin} -- npm install first`);

const squashArgs = ['tail', ROOT, '--tag', tag]
  .concat(message !== undefined ? ['--message', message] : ['--message-file', messageFile as string])
  .concat(apply ? ['--apply'] : []);

const r = spawnSync(bin, squashArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
