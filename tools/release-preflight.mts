// tools/release-preflight.mts -- what tools/release.ts checks before it
// writes anything, dry run included (DECISIONS 227, TSK-040 step B). Until
// 4.4.0 these were copy-paste shell in docs/RELEASING.md § 0 and a team
// script; a release cut without them shipped docs naming squashed commits
// (v4.1.1) and was cut with whatever git-release-squash happened to be
// installed.
//
// Every check runs, cheapest first, and every problem is returned: one
// run names everything to fix. Each has its own stable code.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Problem { code: string; message: string; hint: string }

// A release tag is exactly vX.Y.Z: an rc or any other tag is not one.
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

// The files a release ships or documents itself with: a sha in them must
// still exist after the squash.
const DOC_PATHS = ['docs', 'SKILL.md', 'README.md', 'references'];

function preflight(root: string, name: string, version: string): Problem[] {
  const git = (args: string[], input?: string) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  const lines = (s: string | null) => String(s || '').split('\n').filter((l) => l !== '');
  const problems: Problem[] = [];

  // Other branches: git-release-squash's post-write verify checks every
  // commit of every branch, AFTER main and the tag are rewritten.
  const current = git(['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim();
  const branches = lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout).filter((b) => b !== current);
  if (branches.length > 0) {
    problems.push({ code: 'other_branches', message: `local branch(es) other than the checked-out one: ${branches.join(', ')}`,
      hint: 'git-release-squash verifies every commit on every branch after rewriting the refs: merge or delete them (git branch -D <branch>)' });
  }
  const worktrees = lines(git(['worktree', 'list', '--porcelain']).stdout)
    .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length)).slice(1);
  if (worktrees.length > 0) {
    problems.push({ code: 'other_worktrees', message: `other worktree(s): ${worktrees.join(', ')}`,
      hint: 'each one keeps a branch or HEAD of its own: git worktree remove <path>' });
  }

  const dirty = lines(git(['status', '--porcelain', '--untracked-files=normal']).stdout).map((l) => l.trim());
  if (dirty.length > 0) {
    problems.push({ code: 'dirty_tree', message: `the working tree is not clean: ${dirty.slice(0, 5).join('; ')}${dirty.length > 5 ? `; … (${dirty.length})` : ''}`,
      hint: 'the release is cut from HEAD: commit or remove these first' });
  }

  // The previous release: the newest exact vX.Y.Z in HEAD's history, by
  // version. A first release has none, and no tag to compare against.
  const releaseTags = lines(git(['tag', '--list', 'v*', '--sort=-v:refname']).stdout).filter((t) => RELEASE_TAG.test(t));
  const merged = new Set(lines(git(['tag', '--merged', 'HEAD', '--list', 'v*']).stdout));
  const prev = releaseTags.find((t) => merged.has(t));
  const prevCommit = prev === undefined ? '' : git(['rev-parse', '--verify', '--quiet', `refs/tags/${prev}^{commit}`]).stdout.trim();
  if (prevCommit !== '') {
    // tail squashes the commits after the newest TAGGED commit: any tag
    // after vPREV, of any name or kind (an rc included), silently shrinks
    // the release.
    const after = lines(git(['for-each-ref', '--merged', 'HEAD', '--contains', prevCommit,
      '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags']).stdout)
      .map((l) => l.split(' ')).filter(([, obj, peeled]) => (peeled || obj) !== prevCommit).map(([tag]) => tag);
    if (after.length > 0) {
      problems.push({ code: 'tag_after_release', message: `tag(s) on commits after ${prev}: ${after.join(', ')}`,
        hint: `git-release-squash squashes only the commits after the newest tagged one: delete them (git tag -d <tag>)` });
    }
  }

  const found: string[] = [];
  const readJson = (rel: string): any => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
  const lock = readJson('package-lock.json');
  const lockRoot = lock && lock.packages && lock.packages[''];
  if (!lock || lock.version !== version) found.push(`package-lock.json "version" ${lock ? JSON.stringify(lock.version) : 'missing'}`);
  if (!lockRoot || lockRoot.version !== version) found.push(`package-lock.json packages[""].version ${lockRoot ? JSON.stringify(lockRoot.version) : 'missing'}`);
  let skill: string | null = null;
  try { skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8'); } catch { /* reported below */ }
  const skillVersion = skill === null ? undefined : (/^\s*version:\s*"([^"]*)"/m.exec(skill) || [])[1];
  if (skillVersion !== version) found.push(`SKILL.md metadata.version ${skillVersion === undefined ? 'missing' : JSON.stringify(skillVersion)}`);
  const launcher = spawnSync('sh', [path.join(root, 'bin', name), '--version'], { cwd: root, encoding: 'utf8' });
  const said = String(launcher.stdout || '').trim();
  if (launcher.status !== 0 || said !== `${name} ${version}`) found.push(`bin/${name} --version ${JSON.stringify(said)} (exit ${launcher.status})`);
  if (found.length > 0) {
    problems.push({ code: 'version_mismatch', message: `not ${version} everywhere: ${found.join(', ')}`,
      hint: 'bump package.json, the lock\'s root x2 and SKILL.md, then rebuild (docs/RELEASING.md § 1)' });
  }

  // node_modules is what release.ts runs git-release-squash from: it must
  // be the lock, the resolved source included -- two commits can carry the
  // same version number.
  const installed = readJson(path.join('node_modules', '.package-lock.json'));
  if (!installed || !installed.packages) {
    problems.push({ code: 'node_modules_mismatch', message: 'no node_modules/.package-lock.json', hint: 'npm ci' });
  } else if (lock && lock.packages) {
    const inst = installed.packages;
    // An optional package for another platform (esbuild's @esbuild/*) is rightly absent.
    const keys = Object.keys(lock.packages).filter((k) => k !== '' && (inst[k] || !lock.packages[k].optional));
    const bad = keys.filter((k) => !inst[k] || inst[k].version !== lock.packages[k].version
      || (inst[k].resolved || '') !== (lock.packages[k].resolved || ''));
    if (bad.length > 0) {
      problems.push({ code: 'node_modules_mismatch',
        message: `installed packages differ from package-lock.json (version or resolved): ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? `, … (${bad.length})` : ''}`,
        hint: 'npm ci (while nothing else runs on a shared node_modules)' });
    }
  }

  // A doc line added since vPREV (since the empty tree for a first
  // release) that names a commit contained in no release points nowhere
  // once the release is out: the squash replaces this release's commits,
  // and a cut from cherry-picks names work-branch commits that never reach
  // main at all. A hex word that resolves to no commit is no finding.
  {
    const base = prevCommit !== '' ? prevCommit : git(['hash-object', '-t', 'tree', '--stdin'], '').stdout.trim();
    const released = new Set(releaseTags.length === 0 ? []
      : lines(git(['rev-list', ...releaseTags.map((t) => `refs/tags/${t}`)]).stdout));
    const named = new Map<string, Set<string>>();
    let file = '';
    for (const l of lines(git(['diff', '-U0', '--no-color', '--no-ext-diff', base, 'HEAD', '--', ...DOC_PATHS]).stdout)) {
      if (l.startsWith('+++ ')) { file = l.replace(/^\+\+\+ (b\/)?/, ''); continue; }
      if (!l.startsWith('+')) continue;
      for (const sha of l.match(/\b[0-9a-f]{7,40}\b/gi) || []) {
        if (!named.has(sha)) named.set(sha, new Set());
        (named.get(sha) as Set<string>).add(file);
      }
    }
    const shas = [...named.keys()];
    const resolved = shas.length === 0 ? []
      : lines(git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], shas.map((s) => `${s.toLowerCase()}^{commit}`).join('\n') + '\n').stdout);
    const hits = shas.filter((s, i) => {
      const [oid, type] = (resolved[i] || '').split(' ');
      return type === 'commit' && !released.has(oid);
    });
    if (hits.length > 0) {
      problems.push({ code: 'doc_names_squashed_commit',
        message: hits.map((s) => `${[...(named.get(s) as Set<string>)].join(', ')} names ${s}, a commit in no release`).join('; '),
        hint: 'that commit will not exist once the release is out: name the release instead (vX.Y.Z), or no commit at all' });
    }
  }

  const bundle = spawnSync(process.execPath, [path.join('tools', 'bundle.ts'), '--check'], { cwd: root, encoding: 'utf8' });
  if (bundle.status !== 0) {
    problems.push({ code: 'bundle_stale', message: `node tools/bundle.ts --check failed (exit ${bundle.status})`,
      hint: 'dist/ or bin/ does not match the source: node tools/bundle.ts, then commit' });
  }
  return problems;
}

export { preflight };
export type { Problem };
