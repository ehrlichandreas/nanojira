'use strict';

// Claims (§ 12 "Claims", § 12a): the append-only CAS sequence behind
// `nj claim` / `nj release`. Verified against docs/review/claim-model.mjs
// (variant P3) and docs/review/claim-protocol.md: no live pruning, rollback
// only if this invocation appended and restores the entry it read, ENOENT
// treated like EEXIST, the idempotent "already held" path re-asserts via a
// real CAS append, a landed steal is never rolled back.

import * as fs from 'fs';
import * as path from 'path';

const ROUNDS = 100; // same bound as ID allocation (§ 8)

interface Entry { gen: number; kind: 'claimed' | 'released'; name: string; time: string }

function claimsRootDir(backlog: string): string {
  return path.join(backlog, '.nanojira', 'claims');
}

function claimsDir(backlog: string, id: string): string {
  return path.join(claimsRootDir(backlog), id);
}

/** Every claim directory that exists on disk, whatever element (if any) it names. */
function allClaimDirs(backlog: string): { id: string; dir: string }[] {
  let names: string[];
  try { names = fs.readdirSync(claimsRootDir(backlog)); } catch { return []; }
  return names.filter((n) => !n.startsWith('.')).map((n) => ({ id: n, dir: claimsDir(backlog, n) }));
}

/**
 * The highest-generation entry, or null when unclaimed (no directory, no
 * numeric entry, or the highest one is `released`... no -- null here means
 * "nothing to report", callers that need to distinguish `released` from
 * "no entry at all" get the full Entry back). A name is a generation only
 * when it is `/^\d+$/` -- a `.nj-tmp-*` temp file never matches, and an
 * unrecognised third kind of file (AMBIGUITIES.md 84) is skipped, not
 * mistaken for one. Generations are compared numerically, never by
 * `readdir`'s lexicographic string order (10 sorts before 2, confirmed on
 * APFS, docs/review/claim-protocol.md § 2).
 */
function highestEntry(dir: string): Entry | null {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => b - a);
  for (const g of gens) {
    let raw: string;
    try { raw = fs.readFileSync(path.join(dir, String(g)), 'utf8'); } catch { continue; } // vanished: try the next
    const [kind, name, time] = raw.split('\n');
    if (kind !== 'claimed' && kind !== 'released') continue;
    return { gen: g, kind, name, time };
  }
  return null;
}

/**
 * Every generation, oldest first (`nj log`, § 12c) — the same filtering
 * `highestEntry` applies (numeric names only, a stored kind of `claimed` or
 * `released`), just every one of them instead of only the highest, and
 * ascending instead of descending: `log`'s merge classifies each entry by
 * comparing it with the one immediately before it, so it needs them in the
 * order they actually happened.
 */
function allEntriesAscending(backlog: string, id: string): Entry[] {
  const dir = claimsDir(backlog, id);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
  const entries: Entry[] = [];
  for (const g of gens) {
    let raw: string;
    try { raw = fs.readFileSync(path.join(dir, String(g)), 'utf8'); } catch { continue; } // vanished: skip it
    const [kind, name, time] = raw.split('\n');
    if (kind !== 'claimed' && kind !== 'released') continue;
    entries.push({ gen: g, kind, name, time });
  }
  return entries;
}

/** The current holder for display (`_claim`, § 9), or null when unclaimed. */
// A per-process cache, not per-call: one `nj` invocation targets exactly one
// backlog, and `.nanojira/claims/` — once it exists — is never removed by nj
// itself (only the per-element directories under it are, § 12a); staying
// `true` forever once observed is therefore always correct, never stale.
// Without this, `list --json` on a backlog with no claims at all paid one
// `readdirSync` per element just to learn "unclaimed" every time (measured:
// +14-16% on a 10 000-element fixture) for nothing the backlog actually has.
let rootExistsCache: { backlog: string; exists: boolean } | null = null;

function claimsRootExists(backlog: string): boolean {
  if (rootExistsCache && rootExistsCache.backlog === backlog) return rootExistsCache.exists;
  const exists = fs.existsSync(claimsRootDir(backlog));
  rootExistsCache = { backlog, exists };
  return exists;
}

function readClaim(backlog: string, id: string): { by: string; since: string } | null {
  if (!claimsRootExists(backlog)) return null;
  const h = highestEntry(claimsDir(backlog, id));
  return h && h.kind === 'claimed' ? { by: h.name, since: h.time } : null;
}

/**
 * `claim:stale` (§ 7, § 12 "Claims"): advisory only, reported by `list`,
 * `show` and `doctor` alike, never acted on. `staleAfterHours <= 0` (the
 * disabled default-off value, § 5) always answers false; otherwise strictly
 * exceeding the threshold is required ("exceeds", not ">=" — exactly at the
 * threshold is not yet stale).
 */
function isClaimStale(since: string, staleAfterHours: number, nowMs: number): boolean {
  if (staleAfterHours <= 0) return false;
  const ageHours = (nowMs - Date.parse(since)) / 3_600_000;
  return ageHours > staleAfterHours;
}

/**
 * One compare-and-swap attempt: write the entry whole into a temp file,
 * `fsync`, then `link()` it to generation `baseGen + 1`. `EEXIST` means a
 * racing transition already landed there; `ENOENT` means the temp file was
 * swept by a concurrent `doctor --fix` step 7, or the directory itself was
 * removed by a concurrent `archive`/`rm`/`unarchive` (§ 12) -- both are the
 * caller's to retry, not this function's.
 */
function appendEntry(dir: string, baseGen: number, kind: 'claimed' | 'released', name: string, time: string): 'ok' | 'eexist' | 'enoent' {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const content = `${kind}\n${name}\n${time}\n`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  try {
    fs.linkSync(tmp, path.join(dir, String(baseGen + 1)));
  } catch (e: any) {
    try { fs.unlinkSync(tmp); } catch { /* a concurrent sweep already removed it */ }
    if (e.code === 'EEXIST') return 'eexist';
    if (e.code === 'ENOENT') return 'enoent';
    throw e;
  }
  try { fs.unlinkSync(tmp); } catch { /* best-effort; a leftover is backlog:stray_tmp */ }
  return 'ok';
}

type Decision =
  | { append: { kind: 'claimed' | 'released'; name: string } }
  | { terminal: true; holder?: string };

interface TransitionOk { ok: true; gen: number; base: Entry | null }
interface TransitionFail { ok: false; terminal: 'refused' | 'noop' | 'changed_in_parallel'; holder?: string }

/**
 * The shared "read highest, decide, append-with-retry" loop behind claim,
 * steal and release (§ 12 "Claims"). `decide` runs fresh every round against
 * the freshly read state, so a racing transition is always seen before this
 * round's decision is made -- never a bare read trusted across rounds.
 * `EEXIST`/`ENOENT` both mean the state moved on: re-read and decide again,
 * bounded by the same 100-round limit as ID allocation.
 */
function transition(backlog: string, id: string, time: string, decide: (highest: Entry | null) => Decision): TransitionOk | TransitionFail {
  const dir = claimsDir(backlog, id);
  for (let round = 0; round < ROUNDS; round++) {
    const h = highestEntry(dir);
    const d = decide(h);
    if ('terminal' in d) return { ok: false, terminal: d.holder ? 'refused' : 'noop', holder: d.holder };
    const baseGen = h ? h.gen : 0;
    const r = appendEntry(dir, baseGen, d.append.kind, d.append.name, time);
    if (r === 'ok') return { ok: true, gen: baseGen + 1, base: h };
    // eexist/enoent: loop again
  }
  return { ok: false, terminal: 'changed_in_parallel' };
}

/**
 * A rollback after a failed mirror write (§ 12a): retries its OWN
 * already-decided append, never re-deciding what to write -- a rollback
 * that meets a newer generation (`EEXIST`) abandons at once, since the
 * newer holder is the holder; `ENOENT` (its temp file swept, or the
 * directory removed) re-reads just the current generation and retries the
 * same append.
 */
function rollback(backlog: string, id: string, fromGen: number, kind: 'claimed' | 'released', name: string, time: string): void {
  const dir = claimsDir(backlog, id);
  let gen = fromGen;
  for (let round = 0; round < ROUNDS; round++) {
    const r = appendEntry(dir, gen, kind, name, time);
    if (r === 'ok' || r === 'eexist') return;
    const h = highestEntry(dir);
    gen = h ? h.gen : 0;
  }
}

/**
 * `archive`/`rm`/`unarchive` remove a claim directory wholesale (§ 12a):
 * every entry it saw in one `readdir`, then `rmdir`. A straggler's append
 * racing this (landing after the `readdir`, before the matching `unlink`)
 * is not retried for -- the directory is then left non-empty, same as a
 * stray temp file left by step 7's sweep, for `doctor` to report as
 * `claim:orphaned` (§ 7, § 12a).
 */
function removeClaimDirWholesale(backlog: string, id: string): void {
  const dir = claimsDir(backlog, id);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (/^\d+$/.test(n)) { try { fs.unlinkSync(path.join(dir, n)); } catch { /* already gone */ } }
  }
  try { fs.rmdirSync(dir); } catch { /* not empty: left for doctor */ }
}

/**
 * Final status releases the claim (§ 12a, DECISIONS 171 B): whoever
 * currently holds the claim, unconditionally -- not `nj release`'s own
 * ownership check. Used by a write that sets `status` to the last
 * configured status, whether that write is `set`'s own or the mirror write
 * `claim`/`next --status=<last>` just made for itself. Unclaimed is a
 * harmless no-op (`undefined`), not an error.
 */
function releaseUnconditional(backlog: string, id: string, time: string): { gen: number; holder: string } | undefined {
  const decide = (h: Entry | null) => {
    const held = h && h.kind === 'claimed' ? h.name : null;
    if (held === null) return { terminal: true as const }; // unclaimed: nothing to release
    return { append: { kind: 'released' as const, name: held } };
  };
  const t = transition(backlog, id, time, decide);
  return t.ok ? { gen: t.gen, holder: (t.base as Entry).name } : undefined;
}

/**
 * Undoes `releaseUnconditional` after a failed guarded write (§ 12a): the
 * generation to retry from is always re-read fresh, never the one
 * `releaseUnconditional` itself returned -- `claim --status=<last>` chains
 * a `claimed` append and a `released` append in the same call, so by the
 * time a rollback runs here the claim's own rollback (a second, separate
 * append) may already have moved the generation on. `rollback` itself
 * still abandons on EEXIST (a still-newer holder is the holder), same as
 * every other rollback in this module.
 */
function undoRelease(backlog: string, id: string, holder: string, time: string): void {
  const dir = claimsDir(backlog, id);
  const h = highestEntry(dir);
  rollback(backlog, id, h ? h.gen : 0, 'claimed', holder, time);
}

export { claimsRootDir, claimsDir, allClaimDirs, highestEntry, allEntriesAscending, readClaim, isClaimStale, transition, rollback, removeClaimDirWholesale, releaseUnconditional, undoRelease };
export type { Entry };
