# Review: `nj claim`/`nj release` protocol (proposal § C)

Verifier, 2026-10-03. I wrote none of this proposal and none of
`claim-model.mjs`'s original three variants (P0–P2, by a removed
teammate); I read `docs/SPECIFICATION.md` § 8/§ 12 and
`docs/proposals/v3.1.md` § C (commit `5d1c83d`) independently, ran and
extended the model, and reached my own conclusions below. No `src/` or
`test/` files were touched. Work happened in `/tmp/verifier-claim-apfs-*`
(APFS fact-checks only — the protocol review itself needed no fixture
files).

## Verdict: **sound with fixes**

The core mechanism — an append-only sequence of immutable entries, CAS'd
into existence with `link()`, "the highest entry is the state" — is the
right primitive, and the proposal's own "Why a sequence" rejection of a
single-token file and a move-aside design is correct (I re-derived both
failure modes independently below, § 4). But the proposal **as written**
fails basic safety properties in 10 of 12 adversarial scenarios I built
(§ 1) — not in the CAS primitive itself, but in three auxiliary pieces
bolted onto it: live pruning in `--fix`, a rollback that doesn't check
whether it has anything to undo, and the idempotent "already held" read
path. Two of those are each a one-line-of-reasoning fix that the model
already confirms; the third needed a real design decision, which I made
and verified (§ 1.4). With all three applied, every invariant holds across
every scenario I built, with one remaining low-severity, informational
oddity I did not try to eliminate (§ 1.5) — I'd ship with it, documented.

## 1. Exhaustive interleaving check

### Method

`docs/review/claim-model.mjs` (left unfinished, extended by me — see
diff summary at the end) explores every reachable interleaving of small
actor sets against one claim directory, modelling every filesystem call as
one atomic step and `readdir` as two (begin/end), returning any state
consistent with the **POSIX** guarantee (not APFS's stronger, unspecified
one — the right conservative choice, confirmed in § 2). A ghost log keeps
every entry ever linked, with the entry its writer read, so a pruned entry
stays checkable. 12 scenarios (3–12 actors×ops, crashes at arbitrary
points, mirror-write faults, live pruning, orphan removal, archive, stray
temp files racing a live claimant); `ROUNDS=3` instead of the proposal's
100 — sufficient to exhaust every retry path these scenarios can reach,
since the model always has the ground move out from under a stale read
within 2 rounds at most.

Three variants existed before I started:

- **P0** — the proposal exactly as written.
- **P1** — the fixes I independently arrived at for the first two root
  causes (below), before noticing the model already names the same four
  changes in its own header comment: no live pruning, no post-check,
  rollback restores the *previous* entry and only runs if this invocation
  actually appended something, `link` `ENOENT` is a retry round, `doctor`
  removes claim directories only of archived/removed elements (not merely
  `done` ones).
- **P2** — P1 plus "a landed steal is final" (a stealer's own mirror
  failure is reported, not undone, once its `claimed` entry is on the
  chain).

I added a fourth:

- **P3** — P2 plus `idemReasserts`: the "already held" `claim` path (with
  or without `--status`) performs one real CAS append instead of trusting
  the directory read. This is my own fix for the one gap P1/P2 leave open
  (§ 1.4); it is **not** in the original model.

### Invariants checked

`I1` at most one actor believes it holds the claim · `I3`/`I3x` a failed
steal/claim/release leaves the holder as it was · `I4` the highest entry
names the last successful transition · `I5` a bounded loop never fails
silently (`ENOENT` is the specific way this broke) · `I6` a crash leaves
the old or new state plus at worst a stray temp file. (`I2`, "pruning
loses no success", turned out to be subsumed by `I4` once pruning is
restricted to dead directories — see § 1.2 — so it never fires on its own
in any variant; I kept the numbering from the task for traceability.)

### Results

| Scenario | What | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| S1 three plain claimants, crashes | hold | hold | hold | hold |
| S2 holder releases while two steal, crashes | **I3 I3x** | hold | hold | hold |
| S3 right/wrong-holder steals, crashes | **I3** | **I3** | hold | hold |
| S4 mirror faults racing a stealer+claimant | **I3** | hold | hold | hold |
| S5 holder re-claims with `--status`, write fails | **I1-samename I3x** | hold | hold | hold |
| S6 live pruning racing claim/release/claim | **I3x I4** | hold | hold | hold |
| S7 claim on a done element, orphan removal | **I3 I3x I4 I5** | hold | hold | hold |
| S8 `--fix` step 7 removes a live temp file | **I5** | hold | hold | hold |
| S9 archive racing a claimant+stealer | **I3 I5** | hold | hold | hold |
| S10 victim's mirror write racing its stealer's | **I3** | hold | hold | hold |
| S11 release racing a steal, then a claimant, crashes | **I3 I3x** | hold | hold | hold |
| S12 two processes, same name, one rolls back | **I1-samename I3 I3x** | **I1-samename** | **I1-samename** | **I3x** (info-level, see § 1.5) |

States explored: 4.9M across P0–P2 (the original run), another 0.5M for
P3. State counts and exact step traces for every cell are reproducible
with `node docs/review/claim-model.mjs <Sid> <Pn> --trace <tag>`.

### 1.1 — The proposal as written is unsafe (P0 fails almost everywhere)

I traced the two smallest, fully hand-verifiable failures:

**S8 (54 states, `I5`).** A claims its element: writes its temp entry, has
not yet `link()`'d it. `doctor --fix` step 7 runs concurrently, sees the
temp file (indistinguishable from a genuinely abandoned one — `doctor`'s
existing `strayTmpFiles()` in `cmd-doctor.ts` has no age heuristic, it
matches `.nj-tmp-*` unconditionally, and this is true for *every* atomic
write in the tool today, not just claims), deletes it. A's `link()` then
fails with `ENOENT` — a case the proposal's retry loop never names ("on
`EEXIST` … re-read and decide again" says nothing about `ENOENT`).
**This is a pre-existing v3 race** (`atomicWrite` in `src/core/store.ts`
has the identical unguarded `fs.renameSync(tmp, target)` after the same
kind of temp-file write), made far more likely to actually bite by claims:
every round of the 100-round CAS retry loop opens a fresh temp-write
window, where an ordinary element write opens exactly one.

**S9 (54120 states, `I3`/`I5`).** B plain-claims an unclaimed, `done`
element. `archive` runs concurrently: it reads the claims directory,
unlinks the one entry, `rmdir`s the directory. Meanwhile A's own claim
attempt — started earlier, reading an empty directory under the same
POSIX staleness allowance `readdir` grants everywhere else in this model —
reaches its own `TMP` step to find the directory gone: `ENOENT`, same
unhandled class as S8, this time from `archive`'s cleanup instead of
`doctor`'s.

Every other P0 failure (S2–S7, S10–S12) traces to one of exactly three
causes, confirmed by which variant removes it:

### 1.2 — Root cause 1: live pruning (closed by P1, "no live pruning")

§ C's `doctor --fix` step 7a prunes "every live claim directory to its
highest entry" while the element may still be actively claimed. S6 (2.1M
states, `I3x I4`) shows why: pruning races a `claim`/`release`/`claim`
sequence and a fourth claimant; an in-flight reader's **post-check**
(listing the directory again after its own `link()` to confirm nothing
higher landed) can itself be fooled by a prune that removes the very entry
it just created evidence against, or a reader can be told "you're stale,
re-read" by a prune event that isn't really a competing transition at all.
**The fix the model encodes, and I agree with:** never prune a directory
while the element could still be claimed. Prune only when the directory is
about to disappear entirely — on `archive`/`rm`, or on `doctor --fix`
removing a directory it has confirmed is orphaned (gone, or truly
unclaimed with nothing live referencing it). This also removes the
**post-check** entirely (no live pruning competitor to detect, so nothing
to re-verify against) — the model's P1 also drops `postCheck`, and I
confirmed by hand that with pruning gone, the post-check never catches
anything a straightforward `link()` success/`EEXIST` hasn't already told
the caller.

### 1.3 — Root cause 2: an unconditional rollback (closed by P1, "rollback only if appended, and restores the previous entry")

§ C's rollback rule says "rolled back by appending `released N` after N's
own entry" — but the **idempotent-with-`--status`** path (`claimed N` by
the caller itself, re-confirming with a status change) never appends an
entry for *this* invocation; it only re-reads and then writes the mirror.
P0's rollback logic doesn't check that: on a mirror-write failure it
always tries to append a `released` entry **after whatever it read**,
even when it created nothing. S5 (541 states) shows the concrete harm:
A's idempotent status-reclaim fails its mirror write and erroneously
releases A's own, separate, already-successful claim from a *prior*
transition — a live claim destroyed by a no-op's failure. **Fix:** only
roll back if this invocation's own `link()` succeeded; and when it did,
restore the entry the invocation *read* (not a bare `released`) — so a
rolled-back **steal** correctly restores the original holder, not just
"nobody", which P0's `rollbackRestores:false` gets wrong for exactly that
case (S3, S11).

### 1.4 — Root cause 3: the idempotent "already held" read has no freshness guarantee (NOT closed by P1 or P2 — my own fix, P3)

This is the one the original model's variants never attempted a fix for.
S12 — two processes sharing the identity `A`, one doing a plain claim,
the other doing a `--status` reclaim that then has its mirror write fail,
racing a stealer — shows it cleanly at `I1-samename`:

```
B steals from A           (begins; reads nothing yet)
A#1 claims               -> gen 1 "claimed A"       (A#1's own transition)
B's steal retries, reads gen 1, decides to steal, begins its own append
A#1's mirror write FAILS; A#1 starts its rollback (append "released A")
A#0 claims               -> READS gen 1 ONLY (its readdir began before
                             gen 1 even existed; POSIX permits this stale
                             snapshot) -> sees "claimed A" == its own name
                          -> takes the FAST PATH: no write, straight to
                             success, believing it holds gen 1
A#1's rollback lands     -> gen 2 "released A"
B's steal lands          -> gen 3 "claimed B"
END: B holds it. A#0 believes it holds gen 1 — stale, released two
     transitions ago, then given to someone else entirely.
```

**The defect is structural, not timing-specific:** § C's rule 2
("`claimed N` → N holds it already: exit 0, idempotent, nothing
appended") is satisfied by a bare directory *read*, with no write and
therefore no CAS check at all — every *other* transition in the protocol
gets its freshness confirmed by `link()`'s `EEXIST`/success outcome; this
one path alone just trusts whatever it saw. Because § 0's trust model
explicitly treats same-named processes as one claimant ("two agents that
choose the same name are the same claimant" — a deliberately supported
pattern, e.g. a pool of fungible workers under one shared identity, not a
misuse the design can shrug off), this is a reachable production
scenario, not a modelling artefact.

**My fix (variant P3, `idemReasserts`):** the "already held" path, with or
without `--status`, always performs one real CAS append — re-asserting
`claimed N` at `max+1` — instead of the silent fast path. I implemented
this in the model (both branches; see the diff at the end) and re-ran all
12 scenarios: **`I1`-family violations are gone everywhere, including
S12.** Confirmed states: S12 goes from 33,074 states (`I1-samename`
still present after a first, incomplete attempt that only fixed the
non-`--status` branch — recorded as a mistake I made and corrected, not a
second bug) to a clean run with no `I1` violation at all.

**The cost, named plainly:** this contradicts § C's stated efficiency
property ("idempotent, nothing appended") — every re-confirming `claim`
now grows the sequence by one entry, same as every other transition. I
recommend taking that cost: the "nothing appended" promise was only ever
true for a *single* process confirming its own just-made claim, and the
proposal's own trust model doesn't actually limit the protocol to that
case. If the team prefers to keep the fast path, the alternative is to
**narrow the promise explicitly** — document that the idempotent read is
guaranteed fresh only immediately after the same process's own successful
`link()`, and is otherwise advisory — which is a real behaviour change
from what § C currently claims, not a free simplification.

### 1.5 — One remaining, informational-only finding under P3 (S12, `I3x`)

With `idemReasserts`, S12 still flags `I3x`: A#1's own `claim` ends in
`write_failed` (correct — its mirror write really did fail), but by the
time its rollback attempt runs, A#0's *separate*, successful re-assertion
has already landed a newer `claimed A` entry; A#1's rollback correctly
gives up per § C's own rule ("if the rollback meets a higher generation …
it leaves it: the newer holder is the holder"). The chain therefore still
shows A#1's doomed entry, briefly, before A#0's and then B's steal
supersede it. No invariant about *who believes what* (`I1`) is violated —
every process's belief tracks the actual chain correctly throughout; this
is purely that the claim *history* contains an entry whose own author
reported failure, left there by design once a same-named sibling moved
the state forward before the failed author's rollback could run. I did
not build a fourth variant to eliminate this: closing it would mean either
(a) giving the rollback special knowledge of "a newer entry with my own
name doesn't count as having-moved-on", which re-opens exactly the kind
of same-name trust question § 0 already settles the other way, or (b) not
worth the complexity for a pure audit-trail nicety. I'd accept this as
documented behaviour, not fix it.

## 2. APFS facts, checked locally (darwin-arm64, this machine's root volume)

```
link() onto an existing name:        throws EEXIST, target file unaffected
hard link, not a copy:               same (dev, ino); nlink=2; a write
                                      through either name is visible
                                      through the other (confirmed)
readdirSync() order:                 lexicographic string order
                                      ("1","10","100","1000","2","3",…) —
                                      NOT numeric. An implementation MUST
                                      parse each entry name as an integer
                                      and compare numerically to find
                                      "the highest generation"; it must
                                      never rely on directory listing order.
.nj-tmp-<pid>-<rand> vs a generation: /^\d+$/ does not match the temp
                                      pattern — trivially, reliably
                                      distinguishable when scanning a
                                      claim directory's entries.
Number(<generation>):                safe for any realistic count — JS's
                                      2^53 integer ceiling is far beyond
                                      what "a few bytes per transition,
                                      bounded by claims made" (§ C) could
                                      ever reach; no width/padding is
                                      needed or implied by the proposal
                                      ("a positive decimal integer"), unlike
                                      § 8's zero-padded IDs.
Directory fsync (open+fsyncSync):    succeeds without error on APFS.
```

The proposal's own fsync usage (the **temp file's** fd, via `fsync` before
`link()`) matches `atomicWrite`'s existing convention exactly — it does
not fsync the directory itself, consistent with § 8's already-disclosed
limit for tombstones ("the directory entry [is] not `fsync`'d … a machine
crash within the write window may lose one"); claims inherit that same,
already-accepted risk, not a new one.

## 3. Interplay

- **Assignee mirror.** I checked whether the *existing* compare-before-write
  mechanism (§ 12's `compareGuard`) could have served as the claim's
  primitive instead of a new one, to test whether the sequence is
  over-engineering. It cannot: `compareGuard` re-reads and compares just
  before `rename()`, but `rename()` itself never fails on a content
  mismatch — it silently overwrites ("the last rename wins", exactly as
  `STATUS.md`'s own concurrency note already states). Two processes that
  both pass their own compare check before either writes will both
  `rename()`, and one's content is silently lost with **no error to
  either caller** — the identical "two winners" failure mode the
  proposal's own "Why a sequence" section demonstrates for read-then-unlink.
  `--force`'s *existence* for `set`/`note` is itself evidence the team
  already knows this: it's an escape hatch for a detected conflict, not a
  guarantee against an undetected one. This confirms claims genuinely
  need a stronger primitve than what the tool already had; the complexity
  is not invented for its own sake.
- **archive/rm.** Covered in model terms by S9 (§ 1.1); the proposal's own
  rule ("entries, then `rmdir`; a directory that is not empty afterwards
  … is left for `doctor` as `claim:orphaned`") is correct in spirit and
  becomes safe once root cause 3 (§ 1.1, `ENOENT` handling) is fixed —
  `archive`/`rm`'s cleanup racing a brand-new claim attempt just makes
  that claim attempt retry (treating the vanished directory like any
  other "state moved on" signal) rather than crash.
- **`--ready` condition 5.** Purely additive, no concurrency hazard of its
  own: `list --ready` reads `_claim` the same way it reads `_problems`,
  derived fresh from the current highest entry on each call. A backlog
  without claims is unaffected, as claimed.
- **`.gitignore`.** The algorithm ("added exactly once, verbatim, after a
  final newline if the file lacks one, in the file's own line ending")
  is analogous to, but not literally, the existing step-0 discipline I
  verified extensively in the V3-4 round (`docs/verification/v3-4.md`):
  that one *replaces* one matched line and so can copy *that line's own*
  ending; an *append* has no matched line to copy from. **One genuine
  under-specification:** for a file with mixed CRLF/LF endings, "the
  file's own line ending" doesn't name a single answer. Recommend: use
  the ending of the file's last line (or LF if the file is empty, or its
  last line has none) — cheap to implement, and matches what a human
  editor would typically do by habit.

## 4. Is it over-engineered?

**No, not at its core.** § 3 above is the direct answer: the existing,
simpler compare-before-write mechanism cannot provide what claims need
(a true CAS with a visible failure on conflict), so *some* new primitive
is required, and the proposal picks the one the codebase already
trusts — exclusive creation (`§ 8`'s tombstones use the identical pattern)
— applied as a sequence CAS instead of a single-shot allocator. The
"Why a sequence" section's two rejected alternatives are real, not
straw men: I independently re-derived the single-token-file gap (no CAS on
change) and the move-aside gap (an empty window a plain claimant can slip
into) while reasoning about § 3's "is there a simpler equivalent"
question, before re-reading that § 3's text already makes the same case.

**What *is* over-engineered, and should come out, not be patched:** live
pruning in `--fix` (§ 1.2) — removing it is a **net simplification** that
also happens to close two of the twelve scenarios' violations outright.
The post-check (§ 1.2) exists only to defend against live pruning; once
pruning is gone, so is the need for it — another simplification, not a
new mechanism. Net effect of the fixes in § 1.2–1.4: the corrected
protocol is **simpler** than the one proposed (fewer special cases in
`doctor --fix`, fewer checks after `link()`), while being *more* uniform
(every "I already have this" claim now goes through the same one CAS path
as every other transition, rather than carving out a no-write exception).
That is a good sign for a design under review — the fix is not "add more
machinery", it's "remove the one piece that was trying to be clever
(live pruning) and stop giving one code path a shortcut the others don't
get."

## 5. Summary of required changes before promotion

1. **Remove live pruning from `doctor --fix` step 7a.** Prune only
   directories about to be removed wholesale (archived/removed/orphaned),
   never a directory that could still represent a live claim. Drop the
   post-check with it.
2. **Rollback only if this invocation's own `link()` succeeded**, and
   restore the entry it read (not a bare `released`) — so a rolled-back
   steal restores the true previous holder.
3. **Treat `link()`'s `ENOENT`** (temp file or directory vanished — from a
   concurrent `doctor --fix` step 7, or from `archive`/`rm` removing the
   directory) **as a retry round**, bounded by the same 100-round limit as
   `EEXIST`. Name this explicitly in § C; the proposal currently only
   discusses `EEXIST`.
4. **The idempotent "already held" `claim` path must re-assert via one
   real CAS append**, with or without `--status` — not a bare read. This
   is a deliberate choice to accept sequence growth on every re-confirming
   claim, in exchange for closing the one gap (§ 1.4) that a shared-identity
   multi-process deployment can actually hit. If the team instead wants to
   keep the current fast path, § C's "idempotent, nothing appended" claim
   must be narrowed in the spec text to "guaranteed only immediately after
   this process's own successful claim", a real change in what the feature
   promises.
5. **A landed steal's own mirror failure is reported, not undone**
   (`stealFinal`, confirmed closing S3 beyond what fix 2 alone reaches).
6. **`doctor --fix` removes claim directories only for elements that are
   archived or gone** — not merely `done` (S7's `orphanDone` difference);
   a `done`-but-still-live element can still legitimately be claimed (the
   proposal itself allows claiming an incomplete or already-complete
   element, P-5), so `done` alone must not trigger removal.
7. **§ C's `.gitignore` append rule should name the fallback for a file
   with mixed line endings** (§ 3): use the last line's ending, or `LF`
   if none.

With 1–5 applied (verified: `node docs/review/claim-model.mjs P3` — every
scenario holds `I1`-`I6` except the informational `I3x` of § 1.5), I'd
call the protocol sound and ready for promotion.

## Diff summary: `claim-model.mjs`

Added variant `P3` (`idemReasserts`) and the one branch that implements
it in `steps()` — the "already held" `claim` path appends a fresh
`claimed N` instead of trusting the read, regardless of `--status`. No
other line changed; P0–P2 behave exactly as left. Commit message on the
model file documents the fix and the one correction I made to my own
first attempt (only the non-`--status` branch, which left S12 partially
open) before the version committed here.

---

## Re-check of revised § C (`59a3a9a`, `2689db8`) against DECISIONS 114/115

Verifier, 2026-10-03. I wrote none of this revision — the Oracle folded my
§ 5 into proposal § C (DECISIONS 114) and then corrected one point and
ruled P-6 (DECISIONS 115); I independently re-check both against the model
before promotion, per DECISIONS 110/114's own requirement. Work in
`/tmp/verifier-c-recheck2` (detached worktree at the Oracle's revision);
nothing in `src/`/`test/` touched.

**VERDICT: ready to promote.** All seven § 5 fixes are implemented exactly
as intended (§ A below; one wording subtlety noted, not a deviation). D115
point 1 needed no new model variant — it was already the model's existing
behaviour, confirmed by code reading and by every scenario being unaffected
(§ B.1). D115 point 2 (P-6) is modelled as a new scenario, S13, run against
the unmodified P3 (§ B.2): it does not violate `I1` (no actor ever believes
a false thing) in any explored state, but it does reach two of the
existing invariants (`I3x`, `I4`) — not a new safety hole, but the model's
first chance to *observe* an outcome (`claim:mismatch`) that the proposal
already names and already accepts, because unarchive is the first operation
that turns invariant-checking back on after an archive. One genuine
text-precision gap, § C below: a sentence about a straggler being "refused
the same way" during unarchive's cleanup is not actually supported by the
rest of the algorithm as written. Found and fixed one bug of my own in the
model (not a proposal defect), disclosed in § D.

### A. Do the seven § 5 fixes match what I meant?

Checked each against the current (`2689db8`) text of § C, quoting the
operative sentence:

1. **No live pruning, drop the post-check.** "`doctor --fix`... It never
   touches a live claim's entries: no pruning while the element could still
   be claimed... the earlier 'prune every live claim directory to its
   highest entry' step is dropped entirely, not narrowed." / "A successful
   `link()` is sufficient on its own; nothing is re-checked afterward...
   [the post-check] is dropped with it." Exact match.
2. **Rollback only if appended, restores the entry read.** The text now
   splits this by what was read — "a plain claim... rollback appends
   `released N`"; "a re-assertion... rollback restores `claimed N`" — and a
   steal is *never* rolled back (fix 5, below). My original fix 2 said "so
   a rolled-back steal restores the true previous holder"; the final text
   has no such clause, because fix 5 supersedes it for steals specifically
   (fix 5's own text says "beyond what fix 2 alone reaches") — not a
   deviation, since that was always the intended relationship between the
   two fixes, but worth being explicit that fix 2's "restore what was read"
   principle now applies only to claims/re-assertions in the final text,
   steals having their own, stronger rule. The claimed-N-not-released-N
   refinement (D115 point 1) is a correct instance of fix 2's own
   principle, not a new rule — see § B.1.
3. **`ENOENT` is a retry round, same 100-round bound.** "Both are treated
   exactly like `EEXIST`: a retry round... bounded by the same 100-round
   limit." Exact match.
4. **Idempotent re-assert via one real CAS append.** "`claimed N` → N holds
   it already: re-assert by appending *g+1* `claimed N` again — one real
   compare-and-swap, the same as every other transition... this grows the
   sequence by one entry even though the holder does not change." Exact
   match, including naming the dropped efficiency promise.
5. **A landed steal's mirror failure is reported, not undone.** "A steal is
   never rolled back. Once a steal's own `link()` has succeeded it is
   final... a mirror-write failure afterward is reported as
   `claim:mismatch`." Exact match.
6. **`doctor --fix` removes claim dirs only for archived/gone, never merely
   `done`.** "`claim:orphaned`... archived or does not exist... **not**
   merely `done`: a done-but-still-live element can still legitimately be
   claimed." Exact match.
7. **`.gitignore` mixed-line-ending fallback.** "for a file with **mixed**
   line endings, the last line's ending, or `LF` if the file is empty or
   its last line has none." Exact match — and a correct, slightly broader
   extension of what I asked for (I didn't separately call out "a last
   line with no ending of its own", but it's the obviously-right reading of
   "the last line's ending" when that line happens to be an unterminated
   final line).

### B. Modelling the two D115 points

#### B.1 — Point 1 (re-assertion rollback restores `claimed N`): no new variant needed

`mirrorFailed()` in the model has always worked this way, since before my
own involvement (P1 introduced `rollbackRestores`): `b.pre` is captured once,
in `RDC`, as the entry the invocation actually read, *before* branching on
what kind of transition to make. For the idempotent-reassert path (`held
=== name`), that entry is `{kind:'claimed', name}` — the invocation's own
prior claim. `mirrorFailed`'s rollback branch, unchanged by anything D115
asked for, is:

```js
if (V.rollbackRestores && b.pre && b.pre.kind === 'claimed')
  Object.assign(b, { nk: 'claimed', nn: b.pre.name, nt: null });
else
  Object.assign(b, { nk: 'released', nn: name, nt: null });
```

For a re-assertion, `b.pre.name === name` (the invocation's own name), so
this already appends `claimed N` on rollback — exactly D115 point 1,
without a single line changed. I confirmed this by re-running the full
suite (`P3`, unmodified): every scenario's state count and verdict is
byte-identical to my first report's table (S1–S11 hold, S12 shows only the
already-disclosed `I3x`) — nothing shifted, because there was nothing to
shift. **D115 point 1 is already correctly modelled; the text's correction
of `59a3a9a`'s mistaken "released N" was a correction to the *prose*, not
to anything the model (or, by the same reasoning, a straightforward
implementation of it) would have gotten wrong.**

#### B.2 — Point 2 (P-6, unarchive removes a leftover claim dir): new scenario S13

No existing variant models `unarchive` at all (it postdates the original
three). I added:

- An `unarchive` op: only acts while `elem.gone`; wholesale removal
  identical to `archive`'s/`orphans`' own cleanup (readdir, unlink every
  entry the snapshot saw, `rmdir`), then the move completes (`gone` clears)
  regardless of whether the directory ended up empty — matching the text,
  which never says the move blocks on a leftover, the same way `archive`'s
  own cleanup doesn't block on one either.
- Belief-clearing when `archive` sets `gone`: every alive actor's `bel` is
  cleared at that instant. Without this, a belief formed *before* an
  archive — stale by design, since "archive/rm remove its claim" — would
  surface as a spurious `I4` the first time an `unarchive` turns checking
  back on (checking is unconditionally skipped while `gone`, so this
  problem is invisible in every existing archive-only scenario, which
  never un-sets `gone`). I confirmed this change is inert for every
  existing scenario (re-ran `S9`, the one other archive-racing scenario:
  identical state count and verdict, `I1`-`I6` hold).
- `S13`: `A` claims; `D` archives (requires `done`, as `S7`/`S9` already
  do); `C` claims — the one kind of actor that can race *either* cleanup,
  since it starts (passes the one-time `refused:archived` gate) before `D`
  archives, and its CAS retry loop never re-checks `gone`; `U` unarchives.
- An informational tag, `unarchive-leftover`, set when `unarchive`'s own
  cleanup finishes with the directory still non-empty (a straggler's append
  raced it) — mirrors `mismatch-no-crash`/`phantom` in spirit: observational,
  not a safety check.

Run against unmodified `P3`: `VIOLATES I3x I4` (plus the info tags
`mismatch-no-crash`, `phantom`, `unarchive-leftover`). **Before reporting
this, I traced it by hand and found it was partly my own model's bug, not
a proposal defect: I fixed it before reporting the result below** — see
§ D. With the fix, the finding reproduces at the same scale (652,451
states) and the same two invariants. I traced both by hand:

- **`I3x`.** `C` claims successfully (`claimed C`), lands its mirror
  (`assignee: C`). `D` archives (`gone=true`, `C`'s now-stale belief
  cleared). `U`'s unarchive and `D`'s own cleanup race each other's
  `readdir`s against `A`'s claim, which started *before* the archive and
  is still mid-retry: `A` lands a fresh `claimed A` at the recycled
  generation 1 (the directory having been emptied and recreated between
  the two cleanups). `A`'s own mirror write then loses to a version bump —
  *not* an injected fault; `archive` and `unarchive` are themselves
  ordinary writes to the element and bump its version, so **any** claim
  racing either one naturally fails its compare-before-write and rolls
  back. `A`'s rollback (append `released A`, correctly decided — its own
  `b.pre` was `null`, read before its append, so this is the *plain-claim*
  rollback rule, not point 1's) lands at generation 2. `D`'s own cleanup
  readdir, mid-flight since before any of this, takes a POSIX-legal stale
  snapshot that catches generation 2 (the rollback) but misses generation 1
  (`A`'s original, now-orphaned entry) — and unlinks only what it saw. The
  rollback is gone; the original mis-landed claim survives. Net: `A`
  reports `write_failed` (correctly — it never holds a false belief, `I1`
  is never touched), but its entry is the one left on the chain, which is
  now on an **active** (unarchived) element with `assignee: C` —
  `claim:mismatch`, already named and already accepted by the proposal,
  just reached by racing `archive`+`unarchive` instead of a crash.
- **`I4`.** The milder cousin of the same mechanism: `C`'s own successful
  claim gets wholesale-removed by `unarchive`'s cleanup (legitimately —
  `C`'s belief was already cleared at archive time), so the model's
  "every reported success stays on the chain" check trips on a `success`
  that archiving was always *supposed* to retire. This exact thing happens
  in every archive-only scenario too (`S2`, `S9`, …) — it just never
  surfaces there, because `gone` never clears again to re-enable checking.
  `unarchive` is the first operation to turn the lights back on.

**Neither is a new safety hole.** No actor, anywhere in the 652,451
explored states, ever believes it holds a claim it does not
(`I1` never fires). What both findings show is that `claim:mismatch` — a
state the proposal already discloses and already tells `doctor` never to
auto-resolve — has a path to it that isn't a crash: a claim racing
`archive` (even just the normal version-bump, no injected fault) can roll
back correctly and still lose its own rollback to the same kind of
readdir-staleness `archive`'s and `unarchive`'s cleanups are already
allowed to have. This was always true of `archive` alone; `unarchive` is
just the first thing that can make it *visible* on a live element again
instead of staying forever inert on an archived one. I recommend **one**
textual addition, not a mechanism change: name this as a second path to
`claim:mismatch` (today's text only names a crash). See § C.

### C. Precision gaps for test-writing

1. **"A straggler... is refused the same way" overstates what the
   algorithm actually does.** `2689db8`'s unarchive paragraph: "A
   straggler's own in-flight `link()`, racing this removal, meets `ENOENT`
   (above), retries, re-reads the now-archived element, and is refused the
   same way." But `refused:archived` is listed as step 1 of `claim` — "
   refused before anything is written" — a one-time precondition, not
   something the `EEXIST`/`ENOENT` retry loop re-checks (the loop only
   re-reads the *claim directory*, never re-resolves whether the element
   itself is still archived). My model confirms a straggler's retry can
   legitimately land a fresh entry during the archived window; S13 traces
   exactly this. The outcome is not wrong — it is the already-disclosed
   `claim:orphaned`/`claim:mismatch` family, same as `archive`'s own
   cleanup already tolerates — but the sentence should say that, not
   "refused the same way", which implies a check that doesn't exist.
   Suggested replacement: "A straggler's own in-flight `link()`, racing
   this removal, may still land: the directory is then left non-empty,
   exactly as `archive`'s own cleanup already tolerates (`claim:orphaned`
   if unclaimed-looking, `claim:mismatch` if its mirror write also raced a
   version bump from the archive/unarchive itself) — `doctor` reports it,
   never auto-resolves it, same as always."
2. **"Always starts unclaimed" is a best-effort, not an atomic, guarantee.**
   Both the unarchive paragraph and the Limits bullet state this as a flat
   fact. Given (1), it is only as true as `archive`'s own "a directory that
   is not empty afterwards... is left for `doctor`" disclaimer already is.
   Suggested: soften to "...so the unarchived element starts unclaimed
   unless a straggler's append raced the removal, the same residual case
   `archive`'s own cleanup already discloses."
3. **`claim:mismatch`'s stated cause list is incomplete.** Currently named
   only for "a crash between the append and the mirror write." § B.2 shows
   a second, non-crash path (a claim's rollback itself raced out by a
   concurrent `archive`/`unarchive` sweep). Worth one clause naming it, so
   a future reader of `doctor`'s output isn't surprised to see
   `claim:mismatch` immediately after an `unarchive` with no crash anywhere
   in the log.
4. **Where exactly does the claim-dir removal sit in § 11a's own refusal
   order?** The text says "before the first move, while the element is
   still archived" but doesn't say *after which of § 11a's own checks*
   (`unreadable` → `not_archived` → `parent_archived` → `misplaced` →
   `exists`). The only sensible reading is: after all of them (unarchive
   must have already decided to proceed — in particular, already confirmed
   the element *is* archived — before removing a directory whose whole
   rationale is "this element is archived"), but the text doesn't say so
   explicitly. Worth one clause when § 11a gains this line on promotion.

None of these four are ambiguous enough to block promotion of § C itself —
they're precision gaps in prose that describes an *already-correct*
mechanism, not gaps in the mechanism. I'd fix the wording in the same pass
that promotes § C (or the § 11a line it adds), not hold up promotion for
it.

### D. Consistency with the current spec

Checked `.nanojira/claims/<ID>/<generation>` against the promoted § 4
layout (`.nanojira/` root, sibling to `config.json`/`ids/`): consistent, no
collision with anything § 4 already names. Checked against § 11a as
promoted (`docs/verification/v3-1-b-unarchive.md`, accepted): § 11a's own
refusal order and "Touches" list already anticipate this (§ 11a's own text
says nothing about claims yet, correctly deferred to C's promotion, per
`59a3a9a`'s own Touches entry, "§ 11a gains one line on C's promotion").
No inconsistency found.

### E. One bug in the model, found and fixed before reporting the above

The `enoent()` helper's retry path (`V.enoent === 'retry'`) unconditionally
re-entered `RD0`→`RDC` — the full "decide which transition to make" logic —
on any `ENOENT`, including one hit *during a rollback's own retry*. This
silently discarded the rollback's already-decided restore action (`b.nk`/
`b.nn`) and let `RDC` re-decide from scratch based on whatever it currently
saw, mis-tagging the result as a rollback (`rb: true`) regardless. This
produced a **false** `I3x`/`I4` finding on my first `S13` run, structurally
unrelated to anything `archive`/`unarchive` actually do: it was purely an
artifact of two different retry reasons (the main decision loop's, and a
rollback's) sharing one re-entry point. The fix mirrors the existing,
already-correct handling on the `EEXIST` side of `LINK` (`if (b.rb) return
finish(n, b, 'write_failed')` — a rollback that loses a race abandons,
it never re-decides): on `ENOENT`, a rollback now re-reads just the current
generation (`RBRD0`/`RBRD1`, new) and retries its *same* already-decided
append, never re-entering `RDC`. Re-running every existing scenario (`S1`–
`S12`) against `P3` after the fix reproduces my first report's table
exactly, byte-for-byte on every state count — confirming the fix changes
nothing reachable by the original twelve scenarios (none of them had a
rollback racing an `ENOENT` of its own), and S13's finding above is what
survives with the fix in place, not an artifact of the bug it replaced.

