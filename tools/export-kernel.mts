#!/usr/bin/env node
// tools/export-kernel.mts -- exports the project-neutral CLI kernel
// (src/core/kernel.ts, DECISIONS 231) from a signed release tag, as one
// mechanical step instead of a by-hand port (TSK-057, feedback from the
// nanoadr team: they ported src/core/args.ts/suggest.ts by hand twice and
// want kernel.ts pulled as a dependency update instead).
//
//   node tools/export-kernel.mts <tag> <dest-file>
//   node tools/export-kernel.mts --check <dest-file>
//
// `.mts`, not `.ts`, for the same reason as tools/export-skill.mts: Node
// >= 22.18 strips types and treats `.mts` as unambiguously ESM, no
// MODULE_TYPELESS_PACKAGE_JSON warning, no "type":"module" needed in this
// CommonJS-by-default repo.
//
// Export mode verifies <tag> against the pinned release key exactly as
// tools/export-skill.mts does (same tools/release-key.mts helpers, never a
// weaker check): a VALIDSIG from package.json's "releaseKey", refusing a
// non-existent, unsigned, or merely-annotated tag, one signed by any other
// key, or one whose pinned key has expired or been revoked. Only then does
// it read `src/core/kernel.ts` from the tag's own tree (never the working
// tree) and write <dest-file>: one header comment line naming the tag, the
// tag object's own commit id, and the sha256 of the tag's kernel.ts, then
// that file's bytes, byte for byte, unchanged. nanoadr consumes plain .ts
// source directly (Node strip-types, their own bundling), so no .mjs; the
// header is an inline provenance line, not a side file, per their request.
//
// <dest-file> is refused when it exists and is a symlink, or exists and is
// not a regular file -- the same "never write through a symlink, regular
// files only" discipline the rest of this project applies to every write
// (DECISIONS 215 and v4.2.0's "no writes through symlinks"), here checked
// with `fs.lstatSync` before anything is read from the tag.
//
// Check mode takes no tag and touches no git state at all: it re-reads
// <dest-file>'s own header line, recomputes the sha256 of everything after
// it, and reports whether that still matches the recorded hash -- so a
// consumer can tell their own local edit from a real update, offline.

import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseKey, resolveTag, checkSigner } from './release-key.mts';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HEADER_RE = /^\/\/ nanojira kernel (\S+) commit ([0-9a-f]{40}) sha256 ([0-9a-f]{64})\n/;

function fail(msg: string): never {
  process.stderr.write(`export-kernel: ${msg}\n`);
  process.exit(2);
}

function git(args: string[], cwd: string): Buffer {
  return execFileSync('git', args, { cwd });
}

/** Refuses a symlinked or non-regular-file <dest-file>; a destination that
 * does not exist yet is fine either way (it will be created fresh). */
function checkDestSafety(destAbs: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(destAbs);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fail(`refusing to write '${destAbs}': it is a symlink`);
  if (!st.isFile()) fail(`refusing to write '${destAbs}': it exists and is not a regular file`);
}

function runExport(tag: string, dest: string): void {
  let repo: string;
  try {
    repo = git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').trim();
  } catch (e) {
    fail(`not inside a git checkout (${(e as Error).message})`);
  }

  const pin = readReleaseKey(SCRIPT_ROOT);
  if (!pin.ok) fail(`${pin.error}: ${pin.message}`);
  const resolved = resolveTag(repo, tag);
  if (!resolved.ok) fail(`${resolved.error}: ${resolved.message}`);
  const oid = resolved.oid;
  const signer = checkSigner(repo, 'tag', oid, tag, pin.pin);
  if (!signer.ok) fail(`${signer.error}: ${signer.message}`);

  // The tag object's own "object" header names the commit it points at --
  // the one the header line records, distinct from the tag object's own id.
  const tagHeader = git(['cat-file', 'tag', oid], repo).toString('utf8').split('\n\n')[0];
  const commit = (/^object ([0-9a-f]{40})$/m.exec(tagHeader) || [])[1];
  if (!commit) fail(`tag '${tag}' (object ${oid}) has no "object" header naming a commit`);

  let kernel: Buffer;
  try {
    kernel = git(['show', `${commit}:src/core/kernel.ts`], repo);
  } catch (e) {
    fail(`commit '${commit}' (tag '${tag}') has no 'src/core/kernel.ts' (${(e as Error).message})`);
  }

  const destAbs = path.resolve(dest);
  checkDestSafety(destAbs);

  const sha256 = crypto.createHash('sha256').update(kernel).digest('hex');
  const header = Buffer.from(`// nanojira kernel ${tag} commit ${commit} sha256 ${sha256}\n`, 'utf8');
  const out = Buffer.concat([header, kernel]);

  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const tmp = `${destAbs}.export-kernel-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, destAbs);

  process.stdout.write(`export-kernel: wrote ${destAbs} (${tag}, commit ${commit}, sha256 ${sha256})\n`);
}

function runCheck(dest: string): void {
  const destAbs = path.resolve(dest);
  let content: Buffer;
  try {
    content = fs.readFileSync(destAbs);
  } catch (e) {
    process.stderr.write(`export-kernel --check: cannot read '${destAbs}' (${(e as Error).message})\n`);
    process.exit(1);
  }
  const text = content.toString('utf8');
  const m = HEADER_RE.exec(text);
  if (!m) {
    process.stderr.write(`export-kernel --check: '${destAbs}' has no "// nanojira kernel <tag> commit <sha> sha256 <hex>" header on its first line\n`);
    process.exit(1);
  }
  const [, tag, commit, recorded] = m;
  const body = content.subarray(Buffer.byteLength(m[0], 'utf8'));
  const actual = crypto.createHash('sha256').update(body).digest('hex');
  if (actual !== recorded) {
    process.stderr.write(`export-kernel --check: '${destAbs}' no longer matches its header (${tag}, commit ${commit}): recorded sha256 ${recorded}, body is now ${actual}\n`);
    process.exit(1);
  }
  process.stdout.write(`export-kernel --check: '${destAbs}' matches its header (${tag}, commit ${commit}, sha256 ${recorded})\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const dest = args[1];
    if (!dest || args.length !== 2) fail('usage: node tools/export-kernel.mts --check <dest-file>');
    runCheck(dest);
    return;
  }
  const [tag, dest] = args;
  if (!tag || !dest || args.length !== 2) fail('usage: node tools/export-kernel.mts <tag> <dest-file>');
  runExport(tag, dest);
}

main();
