// Shared recording primitives for the S0 baseline harness.
//
// The oracle in test/ verifies SPEC CONFORMANCE. It does not verify that a
// revision behaves byte-for-byte like the previous one — a refactor can stay
// spec-clean and still change output bytes, `_problems` order, or the order of
// `--fix` actions. This library records the observable surface so those
// changes become visible.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// The same canonical root test/lib/harness.mjs's H.TMP_ROOT computes
// (duplicated rather than shared across tools/ and test/ — the same
// established split FIXED_NOW/LATER_NOW already has, below): realpath'd,
// NJ_TEST_ROOT if set, else /tmp. gate.ts's throwaway worktree and
// baseline.ts's own SCRATCH/corpus files now live under exactly this, so
// it is the one root every call in a gate run actually sits under —
// included explicitly rather than trusted to arise from os.tmpdir() alone.
export const CANONICAL_TMP_ROOT = fs.realpathSync(process.env.NJ_TEST_ROOT || '/tmp');

// Every spelling of "the scratch area" this platform uses. On macOS
// os.tmpdir() is /var/folders/<x>/<y>/T — which is where the oracle's mkdtemp
// used to land before it moved to the canonical root above; os.tmpdir()'s
// own spelling is kept here too, in case anything else on the machine still
// uses it. Longest first, so the specific prefix wins.
const TMP_ROOTS = Array.from(new Set([
  CANONICAL_TMP_ROOT,
  (os.tmpdir() || '/tmp').replace(/\/+$/, ''),
  (os.tmpdir() || '/tmp').replace(/\/+$/, '').replace(/^\/private/, ''),
  '/tmp',
  '/var/tmp',
].filter(Boolean))).sort((a, b) => b.length - a.length);

const SCRATCH_RES = TMP_ROOTS.map((t) =>
  new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[A-Za-z0-9._-]+', 'g'));

// The oracle pins this (test/lib/harness.mjs). The shim defaults to it so that
// any caller which forgot NJ_NOW still produces deterministic timestamps.
export const FIXED_NOW = '2026-09-21T18:00:00Z';
export const LATER_NOW = '2026-09-21T19:30:00Z';

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

export function sha256(buf: string | Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export interface NormalizeCtx {
  projectRoot?: string;
  home?: string;
  fixtureRoot?: string;
}

/**
 * Collapse everything that legitimately varies between two runs of the same
 * corpus. What is NOT collapsed is the behaviour under test.
 *
 * - scratch roots: the oracle uses mkdtemp, so every run has new absolute
 *   paths; they appear in JSON `file`, in duplicate_id messages and in rm
 *   output. macOS resolves /tmp to /private/tmp, so fold that first.
 * - `.nj-tmp-<pid>-<rand>`: pid and Math.random by construction (§ 12).
 * - timestamps that are not one of the pinned clock values: those come from
 *   file mtimes (`doctor --fix` derives `created` from them), which move with
 *   the wall clock unless every fixture got utimes. Keeping the pinned values
 *   visible is deliberate — it proves the NJ_NOW plumbing still works.
 */
/* Node's ESM loader realpaths the entry script's own path while resolving
 * it (unless --preserve-symlinks-main is given) — so nj-shim's own
 * `import.meta.dirname` (what ctx.projectRoot is built from) comes back
 * resolved even when gate.ts/baseline.ts computed their OWN root
 * (ROOT/SCRATCH, used for argv/cwd) from the unresolved form of the same
 * path. The two ends of one exact-match comparison then disagree on
 * "/private/tmp" vs "/tmp" — not a missing case, a comparison where each
 * side was stripped (or not) independently. Applying the same strip to
 * the CONTEXT value itself, not just to the text, is what makes the
 * comparison agree regardless of which side the realpath happened on. */
function stripPrivate(p: string | undefined): string | undefined {
  return typeof p === 'string' ? p.split('/private/tmp/').join('/tmp/').split('/private/var/').join('/var/') : p;
}

export function normalize(text: unknown, ctx?: NormalizeCtx): unknown {
  if (typeof text !== 'string') return text;
  let s = text;
  const c = ctx || {};

  s = s.split('/private/tmp/').join('/tmp/');
  s = s.split('/private/var/').join('/var/');

  const projectRoot = stripPrivate(c.projectRoot);
  const home = stripPrivate(c.home);
  const fixtureRoot = stripPrivate(c.fixtureRoot);

  if (projectRoot) s = s.split(projectRoot).join('<PROJ>');
  if (home) s = s.split(home).join('<HOME>');

  // The fixture root gets its OWN token, and it gets it FIRST. Our fixture
  // directories are deliberately named and live at a fixed path; foreign
  // mkdtemp directories are random and live under a tmp root. After both
  // collapse to <SCRATCH> they are indistinguishable, and any rule that then
  // strips a random-looking tail also eats `fault-before-rename`. Marking our
  // own root apart is what lets the mkdtemp rule below be bound to context.
  if (fixtureRoot) s = s.split(fixtureRoot).join('<FIXTURES>');

  // Any first-level directory under a tmp root is scratch, whoever made it.
  for (const re of SCRATCH_RES) s = s.replace(re, '<SCRATCH>');
  // macOS per-user tmp, spelled generically so a baseline stays comparable
  // across users and machines, not just across runs of one login session.
  s = s.replace(/\/var\/folders\/[^/\s]+\/[^/\s]+\/T\/[A-Za-z0-9._-]+/g, '<SCRATCH>');

  s = s.replace(/\.nj-tmp-\d+-[a-z0-9]+/g, '.nj-tmp-<PID>-<RAND>');

  // mkdtemp nested inside an already-collapsed scratch root, e.g.
  // <SCRATCH>/r4-codes-5hRjDl or <SCRATCH>/r8-sreibx. Bound to CONTEXT, not to
  // the character set: a segment directly under <SCRATCH> whose tail after a
  // `-` is exactly six alphanumerics is a mkdtemp result, whatever its case.
  //
  // The earlier rule asked whether the tail looked random (not purely
  // lowercase). That was wrong in both directions: `sreibx` is a real mkdtemp
  // tail and reads as a word, so the gate went red at random, and a deliberate
  // name that happened to contain a digit would have been eaten. Our own
  // fixtures sit under <FIXTURES> and are never touched by this line.
  // The prefix is GREEDY and the tail is anchored to the end of the path
  // segment. A lazy prefix matched an earlier six-character component instead
  // and left the real tail standing (`r4-<RAND>-mFeHhb`), which put the flake
  // straight back. mkdtemp appends its randomness last, so that is where to
  // look for it.
  // The closing lookahead is `not alphanumeric`, not a list of delimiters. An
  // earlier version accepted only `/`, whitespace and quotes, so a segment
  // followed by `:`, `)`, `,` or `.` stayed raw. Unreachable today — nj prints
  // scratch paths as `…/backlog` or quoted — but "unreachable today" is the
  // kind of assumption a refactor overturns.
  //
  // Convention, checked against every script in scratch/: a mkdtemp prefix ends
  // with `-`. A prefix without one is not recognised, and the run goes red
  // rather than quiet.
  s = s.replace(/<SCRATCH>\/([^/\s"'`\\]*)-([A-Za-z0-9]{6})(?![A-Za-z0-9])/g, '<SCRATCH>/$1-<RAND>');

  s = s.replace(ISO_RE, (m) => (m === FIXED_NOW || m === LATER_NOW ? m : '<TS>'));

  return s;
}

/**
 * nj's own discovery rule (§ 4), so the shim snapshots the same backlog.
 * A backlog holds either the v3 config (.nanojira/config.json) or, for a
 * legacy-layout fixture, the v2 one (.nanojira.json) — either counts.
 */
export function findBacklog(cwd: string, env?: Record<string, string | undefined>): string | null {
  if (env && env.NJ_BACKLOG) return env.NJ_BACKLOG;
  let dir = cwd;
  for (;;) {
    const b = path.join(dir, 'backlog');
    if (fs.existsSync(path.join(b, '.nanojira', 'config.json')) || fs.existsSync(path.join(b, '.nanojira.json'))) {
      return b;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export interface WalkEntry {
  abs: string;
  rel: string;
}

export function walk(dir: string, base: string, out: WalkEntry[]): WalkEntry[] {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  const sorted = names.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of sorted) {
    const abs = path.join(dir, d.name);
    const rel = base ? base + '/' + d.name : d.name;
    if (d.isDirectory()) walk(abs, rel, out);
    else out.push({ abs, rel });
  }
  return out;
}

export interface BacklogSnapshot {
  files: Record<string, { sha: string; nsha: string }>;
  ids: string[] | null;
  stray: number;
}

/**
 * Everything about the backlog that a refactor must not change: the bytes of
 * every file, the tombstone listing (§ 8 — a refactor that moved allocation
 * before validation would burn IDs silently) and the number of stray temp
 * files (§ 12).
 *
 * Two hashes per file: `sha` over the raw bytes, and `nsha` over the
 * normalised text. `nsha` is the comparison key, because a file whose
 * `created` was derived from an unpinned mtime differs every run while being
 * perfectly correct.
 */
export function snapshotBacklog(backlog: string | null, ctx?: NormalizeCtx): BacklogSnapshot | null {
  if (!backlog || !fs.existsSync(backlog)) return null;
  const files: Record<string, { sha: string; nsha: string }> = {};
  let stray = 0;
  for (const f of walk(backlog, '', [])) {
    if (path.basename(f.rel).startsWith('.nj-tmp-')) {
      stray++;
      continue; // the name carries pid+rand; the count is the observable fact
    }
    let buf;
    try {
      buf = fs.readFileSync(f.abs);
    } catch {
      files[f.rel] = { sha: '<unreadable>', nsha: '<unreadable>' };
      continue;
    }
    const raw = sha256(buf);
    let nsha = raw;
    const asText = buf.toString('utf8');
    if (Buffer.from(asText, 'utf8').equals(buf)) nsha = sha256(normalize(asText, ctx) as string);
    files[f.rel] = { sha: raw, nsha };
  }
  let ids: string[] | null = [];
  const idsDir = fs.existsSync(path.join(backlog, '.nanojira.json'))
    ? path.join(backlog, '.ids')
    : path.join(backlog, '.nanojira', 'ids');
  try { ids = fs.readdirSync(idsDir).sort(); } catch { ids = null; }
  return { files, ids, stray };
}

/**
 * The scratch-backlog label a cwd was made under, or null. `H.freshDir(label)`
 * (test/lib/harness.mjs) names its mkdtemp dir `nj-<label>-<6 random chars>`;
 * this recovers `<label>` without the random tail, so the harness can group
 * calls by WHICH scenario they belong to, not just by directory identity
 * (`cwdHash`, which is a one-way hash and cannot be prefix-matched).
 *
 * The cwd's OWN basename only -- never an ancestor. A call made from a
 * subdirectory of the scratch dir (e.g. njrc-swap's `proj/work`) does not
 * match here and correctly returns null; walking up to find a match would
 * also catch gate.ts's own throwaway worktree root (`nj-gate-<rand>`,
 * the same naming convention), tainting that call under the spurious label
 * "gate".
 */
export function backlogLabel(cwd: string): string | null {
  const m = /^nj-(.+)-[A-Za-z0-9]{6}$/.exec(path.basename(cwd));
  return m ? m[1] : null;
}

/** Fixed mtimes on every fixture, so mtime-derived output stops moving. */
export const FIXED_MTIME = new Date('2020-01-02T03:04:05Z');
export function pinMtimes(dir: string, when?: Date): void {
  const t = when || FIXED_MTIME;
  for (const f of walk(dir, '', [])) {
    try { fs.utimesSync(f.abs, t, t); } catch { /* unreadable stub, fine */ }
  }
  try { fs.utimesSync(dir, t, t); } catch { /* ignore */ }
}
