#!/usr/bin/env node
// tools/export-skill.mts -- builds the exported skill folder (§ 18
// "Packaging: the exported skill folder", DECISIONS 185 + addenda 5f6529e,
// 9b3d0de, 3).
//
//   node tools/export-skill.mts <tag> <dest>
//
// TypeScript, run directly: Node >= 22.18 strips types, and this file is
// erasable-syntax-only like every other source here (tsconfig's own
// erasableSyntaxOnly, which now includes tools/**/*.mts). No build step.
// `.mts`, not `.ts` (addendum 3): with `.ts`, node has to guess the module
// type from the source and prints a MODULE_TYPELESS_PACKAGE_JSON warning on
// every run; adding "type":"module" to the repo instead would break the
// CommonJS tools/ and test/ scripts. `.mts` is unambiguously ESM without
// either cost.
//
// Resolves the git repository from the CURRENT WORKING DIRECTORY
// (`git rev-parse --show-toplevel`), never from this script's own path --
// any repo laid out like this one works, which is what makes this testable
// against a throwaway fixture repo without touching this project's own
// history. Every shipped file is read from <tag>'s own tree (`git show
// <tag>:<path>`), never from the working tree, which may be dirty or on a
// different commit entirely. git is called only via execFileSync, never
// through a shell.
//
// Steps (exactly the order the spec gives):
//   1. verify <tag> with `git tag -v` -- refuses a non-existent, unsigned or
//      merely-annotated tag, touching <dest> not at all;
//   2. read every shipped file from the tag's tree;
//   3. build the folder at a temporary path beside <dest>, in the same
//      parent directory (so the final step is a same-filesystem rename);
//   4. refuse a foreign <dest> (exists, but holds no VERSION file) --
//      untouched; replace an existing valid export (has one) wholesale.
//
// No symlinks anywhere in the written folder -- every file below is a
// plain `fs.writeFileSync`, never `fs.symlinkSync`.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function fail(msg: string): never {
  process.stderr.write(`export-skill: ${msg}\n`);
  process.exit(2);
}

function git(args: string[], cwd: string): Buffer {
  return execFileSync('git', args, { cwd });
}

// One template, parameterised only by its own filename (`basename "$0"`) --
// `bin/nj` and `bin/nj-mcp` are byte-identical copies of this same content
// (§ 18 "The wrapper"). It resolves its own directory with a plain
// `dirname "$0"`, CDPATH-safe, and never follows a symlink -- there is none
// in this folder to follow; a caller wanting to move the folder copies it
// (`cp -R`) instead.
const WRAPPER_SH = `#!/bin/sh
# nj / nj-mcp launcher (DECISIONS 185, § 18). Written by
# tools/export-skill.mts -- re-export to update, do not hand-edit.
name=$(basename -- "$0")
dir=$(CDPATH='' cd -P -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd -P) || {
  echo "$name: cannot resolve the directory of $0" >&2
  exit 127
}
node=\${NJ_NODE:-node}
if ! command -v "$node" >/dev/null 2>&1; then
  echo "$name: node not found (looked for '$node')" >&2
  exit 127
fi
version=$("$node" --version 2>/dev/null)
major=$(printf '%s' "$version" | sed -n 's/^v\\([0-9][0-9]*\\)\\..*/\\1/p')
if [ -z "$major" ] || [ "$major" -lt 24 ] 2>/dev/null; then
  echo "$name: node too old (requires Node.js >= 24)" >&2
  exit 127
fi
unset NODE_OPTIONS
entry="$dir/../dist/$name.mjs"
if [ ! -f "$entry" ]; then
  echo "$name: $entry not found" >&2
  exit 127
fi
exec "$node" "$entry" "$@"
`;

// Windows equivalent, to the extent cmd.exe allows (§ 18): same NJ_NODE /
// PATH lookup, same dist/<name>.mjs entry, same exit 127 on any failure to
// start.
const WRAPPER_CMD = `@echo off
setlocal EnableDelayedExpansion
set "NODE_BIN=%NJ_NODE%"
if "%NODE_BIN%"=="" set "NODE_BIN=node"
where "%NODE_BIN%" >nul 2>nul
if errorlevel 1 (
  echo %~n0: node not found ^(looked for '%NODE_BIN%'^) 1>&2
  exit /b 127
)
set "NODE_VER="
for /f "usebackq delims=" %%v in (\`"%NODE_BIN%" --version 2^>nul\`) do set "NODE_VER=%%v"
set "MAJOR="
for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set "MAJOR=%%m"
if "!MAJOR!"=="" (
  echo %~n0: node too old ^(requires Node.js ^>= 24^) 1>&2
  exit /b 127
)
if !MAJOR! lss 24 (
  echo %~n0: node too old ^(requires Node.js ^>= 24^) 1>&2
  exit /b 127
)
set "NODE_OPTIONS="
set "ENTRY=%~dp0..\\dist\\%~n0.mjs"
if not exist "%ENTRY%" (
  echo %~n0: %ENTRY% not found 1>&2
  exit /b 127
)
"%NODE_BIN%" "%ENTRY%" %*
exit /b %ERRORLEVEL%
`;

function main(): void {
  const [, , tag, dest] = process.argv;
  if (!tag || !dest) fail('usage: node tools/export-skill.mts <tag> <dest>');

  let repo: string;
  try {
    repo = git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').trim();
  } catch (e) {
    fail(`not inside a git checkout (${(e as Error).message})`);
  }

  // Step 1: the tag must exist and be a valid SIGNED tag object -- `git
  // tag -v` itself refuses a non-existent tag, a lightweight one, or an
  // annotated-but-unsigned one, and (via gpg) one whose signature cannot be
  // verified. Nothing below this point has touched <dest> yet.
  try {
    execFileSync('git', ['tag', '-v', tag], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e: any) {
    const stderrText = e && e.stderr ? String(e.stderr) : '';
    const reason = stderrText.trim().split('\n').filter(Boolean).pop() || (e as Error).message;
    fail(`tag '${tag}' is not a valid signed tag: ${reason}`);
  }

  // Step 2: read every shipped file from the tag's own tree, never the
  // working tree.
  function show(relPath: string): Buffer {
    try {
      return git(['show', `${tag}:${relPath}`], repo);
    } catch (e) {
      fail(`tag '${tag}' has no '${relPath}' (${(e as Error).message})`);
    }
  }
  const pkgRaw = show('package.json');
  let version: string;
  try {
    const parsed = JSON.parse(pkgRaw.toString('utf8'));
    if (typeof parsed.version !== 'string' || !parsed.version) throw new Error('no "version" string');
    version = parsed.version;
  } catch (e) {
    fail(`tag '${tag}': package.json's "version" is unusable (${(e as Error).message})`);
    return;
  }
  const skillMd = show('skill/SKILL.md');
  const distNj = show('dist/nj.mjs');
  const distNjMcp = show('dist/nj-mcp.mjs');

  // Step 4a (checked before any writing): a <dest> that already exists is
  // only replaced when it is itself a previous export of this same tool
  // (holds a VERSION file) -- anything else is refused, untouched.
  const destAbs = path.resolve(dest);
  if (fs.existsSync(destAbs)) {
    let isOwnExport = false;
    try { isOwnExport = fs.statSync(path.join(destAbs, 'VERSION')).isFile(); } catch { /* not ours */ }
    if (!isOwnExport) fail(`refusing to replace '${destAbs}': it exists and has no VERSION file`);
  }

  // Step 3: build at a temporary path beside <dest>, same parent directory
  // (so the final step below is a same-filesystem rename) -- there is never
  // a half-written <dest>.
  const destParent = path.dirname(destAbs);
  fs.mkdirSync(destParent, { recursive: true });
  const tmp = path.join(destParent, `.export-skill-${path.basename(destAbs)}-${process.pid}-${Date.now()}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });

    const write = (relPath: string, content: Buffer | string, mode: number) => {
      const p = path.join(tmp, relPath);
      fs.writeFileSync(p, content);
      fs.chmodSync(p, mode);
    };
    write('SKILL.md', skillMd, 0o644);
    write('VERSION', version + '\n', 0o644);
    write('dist/nj.mjs', distNj, 0o755);
    write('dist/nj-mcp.mjs', distNjMcp, 0o755);
    write('bin/nj', WRAPPER_SH, 0o755);
    write('bin/nj-mcp', WRAPPER_SH, 0o755);
    write('bin/nj.cmd', WRAPPER_CMD, 0o644);
    write('bin/nj-mcp.cmd', WRAPPER_CMD, 0o644);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fail(`building the export failed: ${(e as Error).message}`);
  }

  // Step 4b: an existing valid export is replaced wholesale -- removed,
  // then the freshly built folder renamed into place. No file from the
  // previous version survives into the new one.
  try {
    if (fs.existsSync(destAbs)) fs.rmSync(destAbs, { recursive: true, force: true });
    fs.renameSync(tmp, destAbs);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fail(`replacing '${destAbs}' failed: ${(e as Error).message}`);
  }

  process.stdout.write(`export-skill: wrote ${destAbs} (nj ${version}, from ${tag})\n`);
}

main();
