# V3.2-E verification — njrc-swap + stray `.ids/` (`2c6fa33`) + D141 fixes (`56d86bd`, `f30c2a3`)

Verifier, 2026-10-04. Independent verification, assigned by the Lead.
Work in `/tmp/verifier-v32e` (detached at `f30c2a3`), `/tmp/verifier-v32e-
nested/projects/nanojira` (for `gate.js`), `/tmp/verifier-v32e-unclip/
projects/nanojira` (nested, throwaway-patched `baseline.js`, for the
byte-exact diff), `/tmp/verifier-v32e-probe` (scratch, explicit paths,
D134). All removed before writing this. Read: SPECIFICATION.md § 4
(`.njrc`/`NJ_FAULT=njrc-swap`) and § 14 step 0 as of `8a9915c`, D139/D140/
D141 in full, `docs/review/v3.2-proposal.md`'s E.1/E.2 reasoning,
`2c6fa33`'s/`56d86bd`'s/`f30c2a3`'s full diffs, `test/edge/hardening-
njrc-swap.js`.

**VERDICT: accept, one confirmed gap worth a decision.** D141's two fixes
are both done correctly and confirmed live: the gate tally is now exactly
the 6-call help class, byte-confirmed, no `claim`/`release` diff remains;
`backlogLabel()` is basename-only, confirmed no `'gate'` label anywhere
in the re-recorded corpus (same 6313 calls, 623 excluded). E.1's
njrc-swap hook and E.2's stray-`.ids/` cleanup both match the spec and
the proposal review's reasoning exactly, including E.2's "no live writer
to race against, by construction" claim (confirmed directly in source:
`idsDir` only ever resolves to the legacy path when `legacy` is true).
**One real, if narrow, gap**: E.1's regular-file-vs-symlink ENOENT
distinguishing logic misclassifies a *symlinked* `.njrc` that is removed
outright during the race window as a dangling-symlink fault, when § 4's
general "removed outright → absent, search continues" rule says it
should fall through like any other removal. Confirmed live, not just by
reading the diff.

## 1. V3.2-E.1 — `njrc-swap` (§ 4, D139/D140)

**The hook itself matches spec exactly.** `njrcSwapFaultHook` (`config.ts`)
fires between the ownership `lstat` and `open()`, polls `<dir>/.nj-fault-
go` with a 10s timeout, and unconditionally returns either way (no
`fault:njrc-swap` code) — confirmed by reading the function: there is no
code path in it that can abort the caller.

**Live confirmations**, scratch backlog under `/tmp/verifier-v32e-probe`:

- **Same-user swap**: `.njrc`'s content changed during the pause (to name
  a different, same-user backlog) → the swapped-in backlog is what
  `open()` reads and uses — confirmed, matches `hardening-njrc-swap.js`'s
  own 35/35.
- **`.njrc` (a regular file) removed outright during the pause** → `nj`
  falls through to the next ancestor's `.njrc`/`backlog/`, exactly as if
  nothing had been there — confirmed live (two-level backlog setup,
  outer `.njrc` correctly picked up after the inner one vanished mid-race).
- **No marker** → proceeds after the 10s timeout (observed directly via
  `time`).
- **Classic dangling symlink, no race**: still correctly `invalid_njrc:
  dangling symlink` — no regression there.

**Confirmed gap: a symlinked `.njrc` removed outright during the race is
misclassified as a dangling-symlink fault, not "absent."** The
implementation distinguishes the two ENOENT causes by `link.
isSymbolicLink()` from the *original* `lstat` (before the hook fires):
if the original `.njrc` was a symlink, any later ENOENT at `open()` is
reported as `invalid_njrc: it is a dangling symlink`; only an originally
plain *regular* file gets the new "absent, continue search" treatment.
But `lstat`-was-a-symlink doesn't distinguish "the symlink's target
vanished" (a genuine dangling symlink) from "the symlink itself was
unlinked during the pause" (removed outright, same as the regular-file
case) — both produce ENOENT at `open()`, and the current code treats
both as a fault. Reproduced live:

```
$ ln -s ./real_njrc_content .njrc   # a VALID symlink, resolves fine normally
$ NJ_FAULT=njrc-swap nj list --json &
$ sleep 1.5; rm .njrc; touch .nj-fault-go   # unlink the symlink itself, no swap
$ wait
{"ok": false, "error": "invalid_njrc"}
stderr: Error: invalid .njrc at .../.njrc: it is a dangling symlink
```

Per § 4's own general text — *"If `.njrc` has been removed outright by
the time `open()` runs, it is treated as absent at that level... never a
crash, and never a fall-back to the content the earlier `lstat` saw"* —
this doesn't carve out an exception for symlinks; "removed outright"
should mean absent regardless of what kind of file it was. `test/edge/
hardening-njrc-swap.js` doesn't exercise this combination (confirmed:
no `isSymbolicLink`/`symlink` reference in the file beyond an unrelated
comment about the root-only foreign-symlink leg), so the gap isn't
covered by the suite's 35/35 either.

This is narrow — only reachable inside the race window the fault hook
is specifically built to test, not a normal-operation defect — but it is
a real deviation worth a ruling: either (a) accept the current behaviour
as a deliberate, narrower reading ("removed outright" means "no longer a
symlink pointing anywhere," distinguishing "symlink unlinked" from
"symlink target gone" is out of scope), or (b) fix it to also treat an
outright-unlinked symlink as absent (would need a second check at the
ENOENT point — e.g., an `lstat` retry on the same path to see if the
link itself still exists before deciding — since `isSymbolicLink()` from
the *original* lstat alone can't distinguish the two causes).

## 2. V3.2-E.2 — stray `.ids/` cleanup (§ 14 step 0, DECISIONS 108 G1)

`fixStrayIds` (`cmd-doctor.ts`) matches the spec exactly: no-op if the
stray dir doesn't exist; bails (leaves alone, no partial removal) the
instant any one stray tombstone isn't already mirrored in `.nanojira/
ids/`; otherwise removes the whole stray dir and pushes a **note only**
(`fc.notes`, confirmed — not `fc.actions`, no new problem code). Wired
into `doctorFix`'s `else` branch (i.e. only when the backlog is *not*
`legacy`) — confirmed this is exactly where the task said it should run.

**The proposal review's concurrent-allocator safety claim, confirmed
directly in source, not just by the review's own reasoning.** The
review argued "on an already-v3 backlog, no live code path ever reads or
writes the legacy `.ids/` location at all." Checked every reference to
`LEGACY_IDS_REL` in `src/`: the only place it's used to compute an
*active* allocation path is `context.ts:34`'s `const idsDir =
path.join(backlog, legacy ? LEGACY_IDS_REL : V3_IDS_REL)` — which only
takes the legacy branch when `legacy` is true, i.e. exactly the
`backlog:legacy_layout` case `fixStrayIds` is gated to *never* run
against. On a backlog `fixStrayIds` actually touches (already v3), this
expression always resolves to `V3_IDS_REL` — there is no live writer to
the stray `.ids/` to race against, by construction, confirmed in the
one place that decision is made, not inferred. The monotonic-tombstone-
set argument (a stale read of `.nanojira/ids/` can only under-count
mirrored names, never over-count, so any raciness in the check itself
is safe-conservative) is a property of `readTombstones` simply listing
filenames with no deletion path anywhere in the codebase — confirmed no
code ever removes a file from `.nanojira/ids/` (grepped for any `rm`/
`unlink` under that path; none).

`ac-24-legacy-migration.js`'s G1 (new stray-`.ids/` cases) and `ac-27-
claim.js`'s C4: both run clean (719 and 273 checks respectively).

## 3. D141 — key-order fix and `backlogLabel` basename-only

**`56d86bd` (claim/release key order), confirmed live.** `Object.assign
({ok: (single as any).ok, id: el.id}, single)` pre-seeds both `ok` and
`id` in the target so `Object.assign` keeps them at their *target*
position (it only appends genuinely new source keys) — same fix shape as
`d54322b`'s `_problems`/`_claim` reorder. Live:
```
$ nj claim --id=TSK-001 --as=alice --json | head -3
{
  "ok": true,
  "id": "TSK-001",
$ nj release --id=TSK-001 --as=alice --json | head -3
{
  "ok": true,
  "id": "TSK-001",
```
`ok` first, matching `rm`/`set`/`note`/`check`'s established convention.

**`f30c2a3` (`backlogLabel` basename-only), confirmed both in the diff
and empirically.** The walk-every-ancestor loop is replaced by a single
`path.basename(cwd)` check — a strict narrowing, so it cannot introduce a
new false *positive* (fewer paths checked, same regex), only risks a new
false *negative* if some real call's cwd were a non-basename ancestor
match. Decompressed the re-recorded corpus: **6313 calls** (unchanged),
**no `'gate'` label anywhere** (the exact false positive my own `a21f195`
audit found is now gone), and the same **623 excluded** as before,
confirming — as the commit message claims — the fix changed no real
`backlogLabel` value, only removed the latent ancestor-walk risk.

## 4. The gate — exactly the help class, byte-confirmed

`gate.js --step=f30c2a3 --frozen=oracle-frozen-11` (which resolves to the
same commit, `978c7a8`, as `c6-baseline` — still the pre-batch-writes
baseline, deliberately, per this task):

```
baseline: 6313 calls, nj sha256 37a7ece6...
current : 6313 calls, current code sha256 ... c427e324...
compared: 5690 calls (623 excluded as nondeterministic by design — concurrency)
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
oracle: passed 79, failed 0, cannot run 1 (1 expected: hardening-njrc-foreign-link.js)
gate  : exit 1, replay CHANGED, oracle green
```

The 6 differing calls are the same 3+3 as every prior round (`help`,
`help --json`, `--help`'s own fixture trio, duplicated by `oracle:edge/
coverage-v3-gaps.js`). **Confirmed byte-exact** via the established
unclipped-`baseline.js` technique (nested worktree, `test/` swapped to
`oracle-frozen-11`, digest-confirmed match, throwaway clip/limit removal,
never committed): across all 6 calls, the only difference is the
already-accepted `check`/`find` help lines plus the `--id=A,B,C` batch-
writes paragraph — **no `claim`/`release` key-order diff anywhere**. D141
is done: the tally is exactly the help class, nothing else.

`run-all.js`: 79/80 pass, 0 failed, 1 expected cannot-run (`hardening-
njrc-foreign-link.js` — needs root/a foreign-owned symlink, unavailable
on this machine, the usual gap). No regressions anywhere in the full
suite, including `ac-31-batch.js` at its current 95/95.

## Summary

E.1 and E.2 both match spec and the proposal review's own safety
reasoning, the latter now confirmed directly in source rather than taken
on the review's word. D141's two fixes are both complete and verified
live: the gate shows only the help class, byte-confirmed, and
`backlogLabel` no longer produces the `'gate'` false positive. The one
open item is the symlink-removed-outright misclassification in E.1 (§ 1)
— narrow, race-window-only, not caught by the existing suite — which
needs a ruling (accept as a narrower reading of "removed outright," or
fix with a second lstat at the ENOENT point) before `c7-baseline` is cut,
so the new frozen point doesn't inherit an open question.

## D142 delta — `86952ba` (spec), `28efe2f` (tests), `c8eeac3` (code)

Same worktree discipline: `/tmp/verifier-d142` (detached at `c8eeac3`),
`/tmp/verifier-d142-nested/projects/nanojira` (for `gate.js`), `/tmp/
verifier-d142-probe` (scratch, explicit paths). All removed before
writing this. This closes the one open item from § 1 above.

**The fix**: `readNjrc`'s `ENOENT` branch now re-`lstat`s the path at the
moment of the failure, instead of trusting the pre-pause `lstat` taken
before the hook fired. If the fresh `lstat` also fails (nothing there at
all) or finds a non-symlink, it's absent — § 4's search continues. Only
if the fresh `lstat` finds a *symlink still there* (target missing) does
it stay `invalid_njrc`. Confirmed `c8eeac3` itself touches only `src/
core/config.ts` (+`dist/nj`) — nothing else, exactly `readNjrc`'s `ENOENT`
branch, as the task described (the earlier `56d86bd` claim/release fix is
a different, already-verified commit in the same range, not part of this
delta).

**Re-ran my own exact repro from `0785c14`**, live, scratch backlog under
`/tmp/verifier-d142-probe`:

- **Symlinked `.njrc`, the link itself unlinked during the pause** (my
  original finding): now falls through to the outer `.njrc` — `nj list
  --json` exits 0, returns the *outer* backlog's contents, no
  `invalid_njrc` anywhere. Fixed, confirmed live.
- **Symlinked `.njrc`, link stays, *target* removed during the pause**:
  still `invalid_njrc: it is a dangling symlink`, exit 1 — the genuine
  dangling-symlink case is correctly preserved, not accidentally
  swallowed by the fix.
- **Classic dangling symlink, no race at all**: still `invalid_njrc: it
  is a dangling symlink` — no regression.

All three match exactly what the task asked me to re-confirm, and all
three match `86952ba`'s spec clarification ("for a symlinked `.njrc`,
‘removed outright' means the *link itself* is gone... a dangling symlink
... is a different case and stays `invalid_njrc`") word for word.

**`test/edge/hardening-njrc-swap.js`: 50/50**, up from 35 — the new S4
("symlink .njrc, LINK removed, outer .njrc found") and S5 ("symlink
.njrc, TARGET removed → dangling, invalid_njrc") cases are exactly the
two legs I just re-confirmed by hand, now covered by the suite itself.

**`gate.js --step=c8eeac3 --frozen=oracle-frozen-11`**:
```
baseline: 6313 calls, nj sha256 37a7ece6...
current : 6313 calls, current code sha256 ... 83dc6b5e...
compared: 5690 calls (623 excluded as nondeterministic by design — concurrency)
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
oracle: passed 79, failed 0, cannot run 1 (1 expected: hardening-njrc-foreign-link.js)
gate  : exit 1, replay CHANGED, oracle green
```
Exactly the help class, nothing else — the `readNjrc` fix touches no
recorded call's observable output (every corpus call's `.njrc` reaches
`open()` normally; none hits this ENOENT path), so no new diff was
expected and none appeared.

### D142 delta verdict

**Accept. V3.2-E is complete.** The one open item from the original
review is fixed, confirmed live against the exact repro that found it,
with no regression on the two cases that must keep faulting (target-only
removal, and a static dangling symlink). The suite now covers both legs
explicitly (S4/S5, 50/50). The gate shows only the help class. Nothing
else outstanding before `c7-baseline`.
