'use strict';

// Claims (§ 12 "Claims", § 12a): the append-only CAS sequence behind
// `nanojira claim` / `nanojira release`. Verified against docs/review/claim-model.mjs
// (variant P3) and docs/review/claim-protocol.md: no live pruning, rollback
// only if this invocation appended and restores the entry it read, ENOENT
// treated like EEXIST, the idempotent "already held" path re-asserts via a
// real CAS append, a landed steal is never rolled back.

import * as fs from 'fs';
import * as path from 'path';
import { idShaped, requireIdShaped } from './id-shape.ts';
import { internalSymlink, requireNoInternalSymlink } from './internal-path.ts';
import { readRegularFile, TEXT_FILE_CAP } from './regular-file.ts';

const ROUNDS = 100; // same bound as ID allocation (§ 8)

interface Entry { gen: number; kind: 'claimed' | 'released'; name: string; time: string }

function claimsRootDir(backlog: string): string {
  return path.join(backlog, '.nanojira', 'claims');
}

// An id becomes a path only when it has the § 6 shape (DECISIONS 215): a
// malformed id (`../../x`, `..`) can never hold a claim, so every reader
// below answers "unclaimed" for it without touching the disk, every remover
// is a no-op, and a transition — the first write `claim`/`release` make —
// is refused (`refused:invalid_id`) before anything is created.
function claimsDir(backlog: string, id: string): string {
  requireIdShaped([id], 'claiming or releasing');
  return path.join(claimsRootDir(backlog), id);
}

/**
 * Every claim directory that exists on disk, whatever element (if any) it
 * names — never one behind a symlink: a linked claims root lists nothing, a
 * linked entry is left out (`claimSymlinks` names both for `doctor`).
 */
function allClaimDirs(backlog: string): { id: string; dir: string }[] {
  const root = claimsRootDir(backlog);
  if (internalSymlink(root) !== null) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  // A `readdir` name is one path component already (never `.`/`..`, and
  // dot-names are skipped), so it is joined as it is, shaped or not —
  // `doctor` reports and removes an orphaned directory whatever its name.
  return entries.filter((e) => !e.name.startsWith('.') && !e.isSymbolicLink())
    .map((e) => ({ id: e.name, dir: path.join(root, e.name) }));
}

/**
 * The symlinks claims are never read or written through: the claims root (or
 * `.nanojira`) itself, else each linked claim directory, and each linked
 * claim entry inside a real one.
 */
function claimSymlinks(backlog: string): string[] {
  const root = claimsRootDir(backlog);
  const link = internalSymlink(root);
  if (link !== null) return [link];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const links = entries.filter((e) => !e.name.startsWith('.') && e.isSymbolicLink()).map((e) => path.join(root, e.name));
  for (const { dir } of allClaimDirs(backlog)) {
    const entry = linkedEntry(dir);
    if (entry !== null) links.push(entry);
  }
  return links.sort();
}

/** The first claim entry (a numeric name) in `dir` that is a symlink, or null. */
function linkedEntry(dir: string): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const e = entries.find((x) => /^\d+$/.test(x.name) && x.isSymbolicLink());
  return e ? path.join(dir, e.name) : null;
}

/** Refuses (`refused:symlink`) before anything is written when one of `ids`' claim directories lies behind a symlink. */
function requireRealClaimDirs(backlog: string, ids: string[], verb: string): void {
  for (const id of ids) if (idShaped(id)) requireNoInternalSymlink(claimsDir(backlog, id), verb);
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
// A claim entry is read only if it is a regular file, not a symlink, and at
// most TEXT_FILE_CAP bytes: a FIFO there would block every read of the claim
// (DECISIONS 215). Anything else is skipped like a vanished entry.
function readEntry(file: string): string {
  return readRegularFile(file, TEXT_FILE_CAP, { noFollow: true });
}

function highestEntry(dir: string): Entry | null {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => b - a);
  for (const g of gens) {
    let raw: string;
    try { raw = readEntry(path.join(dir, String(g))); } catch { continue; } // vanished: try the next
    const [kind, name, time] = raw.split('\n');
    if (kind !== 'claimed' && kind !== 'released') continue;
    return { gen: g, kind, name, time };
  }
  return null;
}

/**
 * Every generation, oldest first (`nanojira log`, § 12c) — the same filtering
 * `highestEntry` applies (numeric names only, a stored kind of `claimed` or
 * `released`), just every one of them instead of only the highest, and
 * ascending instead of descending: `log`'s merge classifies each entry by
 * comparing it with the one immediately before it, so it needs them in the
 * order they actually happened.
 */
function allEntriesAscending(backlog: string, id: string): Entry[] {
  if (!idShaped(id)) return [];
  const dir = claimsDir(backlog, id);
  if (internalSymlink(dir) !== null) return [];
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const gens = names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
  const entries: Entry[] = [];
  for (const g of gens) {
    let raw: string;
    try { raw = readEntry(path.join(dir, String(g))); } catch { continue; } // vanished: skip it
    const [kind, name, time] = raw.split('\n');
    if (kind !== 'claimed' && kind !== 'released') continue;
    entries.push({ gen: g, kind, name, time });
  }
  return entries;
}

/**
 * The link that makes `id`'s own claim state unknowable — its claim
 * directory, or a claim entry inside it, is a symlink — or null. Element-level
 * `claim:symlink` (§ 7): shown in the element's `_problems` and keeping it out
 * of `--ready`, so `next` passes it by instead of stopping there. A linked
 * claims root or `.nanojira/` is backlog-level and not answered here.
 */
function elementClaimLink(backlog: string, id: string): string | null {
  if (!claimsRootExists(backlog) || !idShaped(id)) return null;
  const dir = claimsDir(backlog, id);
  const link = internalSymlink(dir);
  if (link !== null) return link === dir ? link : null;
  return linkedEntry(dir);
}

/** The current holder for display (`_claim`, § 9), or null when unclaimed. */
// A per-process cache, not per-call: one `nanojira` invocation targets exactly one
// backlog, and `.nanojira/claims/` — once it exists — is never removed by nanojira
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
  if (!claimsRootExists(backlog) || !idShaped(id)) return null;
  const dir = claimsDir(backlog, id);
  if (internalSymlink(dir) !== null) return null;
  const h = highestEntry(dir);
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
// `symlink`: the directory, or one above it, is a link now — checked
// without the cache right before the first write and again right before the
// `link()` that publishes the entry, since it may have been swapped for one
// after the caller's own check (DECISIONS 215).
// A directory gone between the mkdir and the temp file's open is the same
// "directory vanished" case the `link()` below already retries ('enoent'),
// never an internal_error (DECISIONS 215).
function appendEntry(dir: string, baseGen: number, kind: 'claimed' | 'released', name: string, time: string): 'ok' | 'eexist' | 'enoent' | 'symlink' {
  if (internalSymlink(dir, true) !== null) return 'symlink';
  claimFaultPause('claim-mkdir', dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e: any) {
    if (e.code === 'ENOENT') return 'enoent'; // a parent gone, or linked to nowhere, meanwhile: re-check
    throw e;
  }
  claimFaultPause('claim-append', dir);
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const content = `${kind}\n${name}\n${time}\n`;
  let fd: number;
  try {
    fd = fs.openSync(tmp, 'wx');
  } catch (e: any) {
    if (e.code === 'ENOENT') return 'enoent';
    throw e;
  }
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (internalSymlink(dir, true) !== null) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    return 'symlink';
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
/**
 * The refusals `transition` makes before its first write — `refused:invalid_id`
 * for a malformed id, `refused:symlink` for a linked claim directory — on
 * their own, for a batch's preflight (§ 9 "Batch writes"): one ID refused
 * there leaves every other ID of the batch unwritten.
 */
function requireTransitionable(backlog: string, id: string): string {
  const dir = claimsDir(backlog, id);
  requireNoInternalSymlink(dir, 'claiming or releasing');
  // A linked entry is never read, so the next generation would collide with
  // it on every round (changed_in_parallel): refused as what it is.
  const entry = linkedEntry(dir);
  if (entry !== null) requireNoInternalSymlink(entry, 'claiming or releasing');
  return dir;
}

function transition(backlog: string, id: string, time: string, decide: (highest: Entry | null) => Decision): TransitionOk | TransitionFail {
  const dir = requireTransitionable(backlog, id);
  for (let round = 0; round < ROUNDS; round++) {
    const h = highestEntry(dir);
    const d = decide(h);
    if ('terminal' in d) return { ok: false, terminal: d.holder ? 'refused' : 'noop', holder: d.holder };
    const baseGen = h ? h.gen : 0;
    const r = appendEntry(dir, baseGen, d.append.kind, d.append.name, time);
    if (r === 'symlink') requireNoInternalSymlink(dir, 'claiming or releasing', true);
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
    if (r === 'ok' || r === 'eexist' || r === 'symlink') return; // never rolled back through a link
    const h = highestEntry(dir);
    gen = h ? h.gen : 0;
  }
}

/**
 * `archive`/`rm`/`unarchive` remove a claim directory wholesale (§ 12a):
 * renamed aside, every generation in it unlinked, then `rmdir`
 * (`removeClaimDirAt`). A straggler's append racing this is not retried
 * for -- it lands in the aside directory, which then goes back under its
 * own name, or recreates the directory under that name; either way a
 * non-empty claim directory is left, same as a stray temp file left by
 * step 7's sweep, for `doctor` to report as `claim:orphaned` (§ 7, § 12a).
 */
function removeClaimDirWholesale(backlog: string, id: string): void {
  if (!idShaped(id)) return;
  removeClaimDirAt(claimsDir(backlog, id));
}

/**
 * The removal itself, for a directory `allClaimDirs` listed (`doctor --fix`
 * step 7a). Never through a link (DECISIONS 215): the directory may have been
 * swapped for one since the command's own check, and an lstat before each
 * unlink still leaves a window between the two. So the directory is first
 * renamed aside to a random name in the same parent — `rename` moves a link
 * itself, never its target — and only the aside name is checked and emptied.
 * An aside that turns out to be a link is renamed back, untouched. An aside
 * that cannot be emptied (an entry that is not a generation, a straggler's
 * append) goes back under its own name for `doctor` to report, when that
 * name is still free. Returns null, or the path of a link it left alone:
 * the claim directory's own name, or the aside name when the rename back
 * found that name taken again.
 */
function removeClaimDirAt(dir: string): string | null {
  const link = internalSymlink(dir, true);
  if (link !== null) return link;
  const aside = path.join(path.dirname(dir), `.nj-rm-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  try { fs.renameSync(dir, aside); } catch { return null; } // already gone
  claimFaultPause('claim-aside', dir);
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(aside); } catch { /* vanished */ }
  if (st === null) return null;
  if (!st.isDirectory() || internalSymlink(aside, true) !== null) {
    try { fs.renameSync(aside, dir); } catch { return aside; } // the name is taken again: the link stays aside
    return dir;
  }
  let names: string[] = [];
  try { names = fs.readdirSync(aside); } catch { /* vanished */ }
  for (const n of names) {
    if (/^\d+$/.test(n)) { try { fs.unlinkSync(path.join(aside, n)); } catch { /* already gone */ } }
  }
  try { fs.rmdirSync(aside); } catch {
    if (!fs.existsSync(dir)) { try { fs.renameSync(aside, dir); } catch { /* left aside */ } }
  }
  return null;
}

/**
 * The `.nj-rm-*` asides in the claims root: what a removal leaves when it is
 * killed after its rename aside, or when its rename back fails (DECISIONS
 * 215). Never listed through a linked claims root.
 */
function claimAsides(backlog: string): string[] {
  const root = claimsRootDir(backlog);
  if (internalSymlink(root) !== null) return [];
  let names: string[];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.filter((n) => n.startsWith('.nj-rm-')).sort().map((n) => path.join(root, n));
}

/**
 * `doctor --fix` for one of `claimAsides`. A link is unlinked itself, never
 * followed ('unlinked'). A directory is renamed aside once more, to a fresh
 * name, and only that name is emptied, as `removeClaimDirAt` does: its
 * generations and temp files are unlinked and it is removed ('removed'). One
 * that holds anything else, or is neither, is left as it was ('kept'); with
 * the claims root or `.nanojira/` found linked, nothing more is done
 * ('linked_root'). `at` is where the entry is left: the fresh name, when it
 * could not be put back.
 */
function removeLeftoverAside(aside: string): { done: 'removed' | 'unlinked' | 'kept' | 'linked_root'; at: string } {
  let st: fs.Stats;
  try { st = fs.lstatSync(aside); } catch { return { done: 'removed', at: aside }; } // already gone
  // `claimAsides` checked the claims root through the cache: fresh here,
  // right before the first write, and again after the rename below.
  if (internalSymlink(path.dirname(aside), true) !== null) return { done: 'linked_root', at: aside };
  if (st.isSymbolicLink()) {
    try { fs.unlinkSync(aside); return { done: 'unlinked', at: aside }; } catch { return { done: 'kept', at: aside }; }
  }
  if (!st.isDirectory()) return { done: 'kept', at: aside };
  const fresh = path.join(path.dirname(aside), `.nj-rm-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  try { fs.renameSync(aside, fresh); } catch { return { done: 'kept', at: aside }; }
  claimFaultPause('claim-aside', fresh);
  let st2: fs.Stats;
  try { st2 = fs.lstatSync(fresh); } catch { return { done: 'removed', at: aside }; }
  // A linked claims root (or `.nanojira/`) means the fresh name is no longer
  // ours: left as it is, not even renamed back through the link.
  if (internalSymlink(path.dirname(fresh), true) !== null) return { done: 'linked_root', at: fresh };
  if (st2.isSymbolicLink()) {
    try { fs.unlinkSync(fresh); return { done: 'unlinked', at: aside }; } catch { return { done: 'kept', at: fresh }; }
  }
  const putBack = (): { done: 'kept'; at: string } => {
    if (!fs.existsSync(aside)) { try { fs.renameSync(fresh, aside); return { done: 'kept', at: aside }; } catch { /* left under the fresh name */ } }
    return { done: 'kept', at: fresh };
  };
  if (!st2.isDirectory()) return putBack();
  let names: string[];
  try { names = fs.readdirSync(fresh); } catch { return putBack(); }
  if (names.some((n) => !/^\d+$/.test(n) && !n.startsWith('.nj-tmp-'))) return putBack();
  for (const n of names) { try { fs.unlinkSync(path.join(fresh, n)); } catch { /* already gone, or a directory: rmdir fails below */ } }
  try { fs.rmdirSync(fresh); } catch { return putBack(); }
  return { done: 'removed', at: aside };
}

// NJ_FAULT=claim-mkdir / claim-append / claim-aside (verification hooks,
// § 12, like `njrc-swap`): a pure pause right before or right after a claim
// directory's mkdir, or right after a rename aside (the removal's, or
// `removeLeftoverAside`'s), so a test can swap the directory there
// deterministically. Writes NJ_FAULT_READY when set, then polls for
// `<backlog>/.nj-fault-go` (timeout 10 s) and always proceeds — there is no
// fault code. `dir` is `<backlog>/.nanojira/claims/<id>`.
function claimFaultPause(hook: string, dir: string): void {
  if (process.env.NJ_FAULT !== hook) return;
  const ready = process.env.NJ_FAULT_READY;
  if (ready) { try { fs.writeFileSync(ready, hook + '\n'); } catch { /* the test sees no hold */ } }
  const marker = path.join(dir, '..', '..', '..', '.nj-fault-go');
  // 200 waits of 50 ms: the 10 s timeout without a raw clock read (§ 12 `NJ_NOW`, AC-62).
  for (let i = 0; i < 200 && !fs.existsSync(marker); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}

/**
 * Final status releases the claim (§ 12a, DECISIONS 171 B): whoever
 * currently holds the claim, unconditionally -- not `nanojira release`'s own
 * ownership check. Used by a write that sets `status` to the last
 * configured status, whether that write is `set`'s own or the mirror write
 * `claim`/`next --status=<last>` just made for itself. Unclaimed is a
 * harmless no-op (`undefined`), not an error.
 */
function releaseUnconditional(backlog: string, id: string, time: string): { gen: number; holder: string } | undefined {
  if (!idShaped(id)) return undefined; // never claimable, so never claimed
  // Behind a symlink nothing is read, so nothing is held (DECISIONS 215).
  const dir = claimsDir(backlog, id);
  if (internalSymlink(dir) !== null || linkedEntry(dir) !== null) return undefined;
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
  if (!idShaped(id) || internalSymlink(claimsDir(backlog, id)) !== null) return;
  const dir = claimsDir(backlog, id);
  const h = highestEntry(dir);
  rollback(backlog, id, h ? h.gen : 0, 'claimed', holder, time);
}

export { claimsRootDir, claimsDir, allClaimDirs, claimSymlinks, requireRealClaimDirs, highestEntry, allEntriesAscending, readClaim, isClaimStale, elementClaimLink, requireTransitionable, transition, rollback, removeClaimDirWholesale, removeClaimDirAt, claimAsides, removeLeftoverAside, releaseUnconditional, undoRelease };
export type { Entry };
