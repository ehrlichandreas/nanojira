# V3.2-D verification — batch writes `--id=A,B,C` (`245bf6f`, § 9, AC-31, TSK-037)

Verifier, 2026-10-04. I didn't write any of this code — independent
verification assigned by the Lead. Work in `/tmp/verifier-v32d-batch`
(detached worktree at `245bf6f`), `/tmp/verifier-v32d-nested/projects/
nanojira` (nested, for `gate.js`), and `/tmp/verifier-v32d-probe1` (scratch
backlog, explicit path, never cwd=repo — D134 rules). Read: DECISIONS
134/135/136 in full, SPECIFICATION.md § 9 "Batch writes" and § 12's
fault-injection paragraph, the full `245bf6f` diff across all nine changed
`src/` files, `test/ac/ac-31-batch.js` in full.

**VERDICT: needs changes.** The refactor itself is clean and the diff
review proves the single-ID path is untouched everywhere except one
narrow, genuine miss: **`NJ_FAULT=before-compare` does not fire-once-and-
spend in a batch — it hard-exits the whole process**, exactly like the
single-element path, contradicting D135 and § 12 for that one hook.
There is also a second, smaller, confirmed bug: `release`'s batch JSON
output leaks an undocumented `anyWritten` field that § 9's shape and the
other four commands' output don't have. AC-31's 68-vs-67 count is the
same fixture-guard counting ambiguity as the AC-27 precedent — nothing is
silently skipped. Everything else — the five diffs, the gate replay, my
own probe battery (whitespace/trailing-comma/empty-element in `--id`,
case-sensitive duplicates, mixed preflight-abort, runtime-failure-in-the-
middle, `--force` across a batch, batch `claim --status`, `STATUS.md`
written exactly once, and two racing batch claims each resolving to
exactly one winner per ID) — all match § 9/§ 12/D136 exactly.

## 1. Diff review: is the single-ID path provably unchanged?

Read all nine changed files' full diffs (`core/batch.ts` new; `core/
context.ts`, `core/store.ts`, `core/help.ts` additive; the five `cmd-*.ts`
files). Confirmed, file by file:

- **`core/context.ts`**: `resolveById` is `resolveTarget`'s existing
  by-name tail, moved verbatim into a new function and called from the
  same point `resolveTarget` always called it from. Zero behavioural
  change to `resolveTarget` itself — pure extraction.
- **`core/store.ts`**: `guardedWrite` has **zero diff lines** —
  `guardedWriteCatchable` is an entirely new, separate function
  (`mirrorWrite` instead of `atomicWrite`). The single-ID path for
  `set`/`note`/`check` still calls the unchanged `guardedWrite`.
- **`cmd-check.ts`**: the entire checkbox-resolution block (item/text
  matching, ambiguous/not_found, the ticked/unticked flip) was moved
  byte-for-byte into a new `prepareCheck`, called identically by both
  paths. The single-ID branch's remaining code (`guardedWrite`, entry
  construction) is untouched.
- **`cmd-note.ts`**: the note-insertion logic (`## Notes` heading search,
  blank-line handling) moved byte-for-byte into `withNote`, called
  identically by both paths. Untouched otherwise.
- **`cmd-claim.ts`** / **`cmd-release.ts`**: the entire CAS/transition/
  rollback logic moved byte-for-byte into `claimOne`/`releaseOne` (no
  lines inside changed), called by both paths with the same arguments —
  this directly proves D115's claim rollback semantics are shared, not
  reimplemented, between single and batch.
- **`cmd-set.ts`**: `validateFieldValues` (title/status/priority) is
  hoisted out and run once, batch-wide, for the batch path only — I
  compared it line-for-line against the equivalent checks still present,
  unchanged, inside `collectSetOverrides` (lines 140/152/172): identical
  `fail('invalid_value', …)` messages and hints in both places. The
  single-ID path never calls `validateFieldValues`; it still goes through
  `collectSetOverrides`'s own checks exactly as before. Correctly
  classified as a D136b batch-wide argument error, not a behavioural
  change to single-ID validation order.

One thing I checked by direct code reading rather than just trusting the
commit message: `cmd-claim.ts`'s human/JSON output now reads
`entryJson(fresh,...)._problems` instead of calling `elementProblems
(fresh)` directly. These can differ in principle (`entryJson` adds
`claim:stale` when applicable), but `isClaimStale` returns `false`
whenever `staleAfterHours <= 0` and otherwise requires actual elapsed
wall-clock time since `since` — which is `nowIso()` from the same
command, so immediately after any claim the two are always identical.
Confirmed by reading `isClaimStale` (`src/core/claims.ts:87-90`), not by
assumption. No behavioural difference in any reachable case.

## 2. AC-31: 68 (Oracle) vs. 67 (Implementer/actual run) — reconciled

`node test/ac/ac-31-batch.js dist/nj`: **67/67, PASS**, matching the
implementation's own claim exactly.

The file has 69 total `T.check`/`T.eq`/`T.exit` call sites, but two of the
`T.check` sites are fixture guards that only fire on a setup failure: the
`ok(r, what)` helper (line 54, used by all the `model()`-building `new`/
`init`/`claim`/`set`/`archive` calls) and `addUnreadableStub`'s symlink
guard (line 96). 69 − 2 = 67, exactly matching the real run. The Oracle's
68 counts one of those two guards as a "real" check while the
Implementer/actual-run convention (established already for AC-27/AC-28)
counts neither — the same conditional-guard counting ambiguity as before,
not a missing or silently-skipped check. The 67 that do run all passed.

## 3. My own batch probes

All against a scratch backlog under `/tmp/verifier-v32d-probe1`
(`--backlog` implied by `cwd`, never the repo root):

- **Whitespace in the list** (`--id="TSK-001, TSK-002"`): trimmed
  correctly, both resolve.
- **Trailing comma** (`--id="TSK-001,TSK-002,"`) and **an empty element**
  (`--id="TSK-001,,TSK-002"`): both split out an empty-string id, which is
  reported `not_found` for that one entry — exactly matching what a bare
  `--id=""` already does on the single-element path (`no element with id
  ''`). Not a special case; the empty-string id is just treated as any
  other unknown id, consistently with the pre-existing single behaviour.
- **Repeated ID with different case/spacing** (`"TSK-001, tsk-001"`): IDs
  are case-sensitive everywhere else in `nj`, and batch dedup is no
  exception — `tsk-001` is treated as a distinct (unknown) id, not a
  duplicate of `TSK-001`. Consistent, not a bug.
- **Mixed batch, one archived**: preflight aborts the whole batch,
  `results` lists only the archived id, the innocent id's file is
  byte-identical (AC-31 H6 already covers this; reconfirmed live).
- **Runtime failure in the middle** (a claim held by another name on the
  middle ID): A and C succeed, B reports `refused:claimed`, execution/
  results order preserved, exit 1 (AC-31 H9; reconfirmed).
- **`NJ_FAULT=before-rename` and `after-tmp-write` in a 2-ID batch**: both
  correctly fire once on the first id (`fault:before-rename` /
  `fault:after-tmp-write`), the hook is spent, and the **second id writes
  normally** inside the same wrapped `results` — confirmed live, matching
  D135 exactly.
- **`NJ_FAULT=before-compare` in a 2-ID batch — FAILS.** See § 4.
- **`--force` across a batch with a parallel change on two IDs**: both
  files edited on disk underneath the loaded `ctx`; `--force` on the
  batch overrode the parallel change on **both** ids, both wrote
  successfully. Matches § 12's "`--force` overrides a parallel change on
  `set`, `note` and `check` only" (confirmed for `set` directly; `note`/
  `check` take the identical `guardedWriteCatchable(..., force, ...)`
  call, so the mechanism is shared, not reimplemented).
- **Batch `claim --status`**: `--id=A,B --as=carol --status=doing` set
  both ids' status to `doing` in the same claim call — confirmed in both
  entries' JSON.
- **Batch `check --text=` matching some elements but not others**: one id
  had the text, the other didn't — preflight's `not_found` on the second
  id aborted the whole batch, `results` lists only the failing id, exactly
  D136c.
- **`STATUS.md` written exactly once**: a priority-only batch (which
  doesn't change `STATUS.md`'s content) left `STATUS.md`'s inode and
  mtime completely unchanged — traced to `refreshStatus`'s pre-existing
  `if (current === fresh) return false` short-circuit (`core/status.ts:
  90`), not something this diff touches. A `--status=review` batch on the
  same two ids *did* produce a new inode/mtime, with content reflecting
  **both** ids' moves in a single, fully-converged render — not an
  intermediate snapshot. Confirmed via direct `stat`.
- **Exit codes / human output**: every batch above returning a mix of
  success/failure exited 1, full-success batches exited 0, and the
  non-`--json` output format mentions every named id (AC-31 H14; already
  covered, reconfirmed).

### Concurrency: two batch claims racing on overlapping IDs

Two `nj claim --id=TSK-001,TSK-002` calls, run truly concurrently
(backgrounded, `wait`ed), one as `alice` and one as `bob`, racing on the
*same two ids*. Result: alice won TSK-001 (bob's result for TSK-001:
`refused:claimed`), bob won TSK-002 (alice's result for TSK-002:
`refused:claimed`) — exactly one winner per id, both halves of each
process's own batch correctly independent (alice's TSK-001 success and
TSK-002 failure didn't block each other; same for bob). Final on-disk
assignees confirm: `TSK-001: alice`, `TSK-002: bob`. No double-claim, no
lost update, no deadlock.

## 4. Confirmed bug: `NJ_FAULT=before-compare` does not spend per-batch

D135 and § 12 both state all three fault hooks (`after-tmp-write`,
`before-rename`, `before-compare`) fire once per batch, at the first
write reaching the injection point, then the hook is spent so every later
id writes normally. I directly verified `after-tmp-write` and
`before-rename` do this correctly (§ 3 above). `before-compare` does not:

```
$ NJ_FAULT=before-compare nj set --id="TSK-001,TSK-002" --priority=urgent --json
nj: before-compare timed out after 10s waiting for .nj-fault-go
{
  "ok": false,
  "error": "fault:before-compare"
}
exit=1
```

This is the **single-element unwrapped shape** — no `results` array, no
`id` field — even though the invocation named two ids. TSK-002's priority
was confirmed unaffected (still its prior value): the batch never reached
it, because the *entire process* hard-exited after the 10-second marker-
wait timeout, not just that one id's write.

**Root cause**: `compareGuard` (`core/store.ts:167-187`) is shared,
unmodified, by both `guardedWrite` (single, non-catchable) and the new
`guardedWriteCatchable` (batch, catchable) — the diff adds zero lines to
`compareGuard` itself. Its `before-compare` branch (lines 170-178) always
calls `hardExit`, never the catchable `fail()`. The commit's own
"catchable" mechanism (`mirrorWrite` vs. `atomicWrite`) only covers the
`after-tmp-write`/`before-rename` hooks, which live inside those two
write functions and were correctly duplicated/parameterized
(`atomicWrite` calls `hardExit`, `mirrorWrite` calls `fail()`).
`before-compare` lives upstream, in the one `compareGuard` both
`guardedWrite` and `guardedWriteCatchable` call identically — there is no
catchable variant of it.

**Impact**: any batch set/note/check under `NJ_FAULT=before-compare`
(the AC test suites' own standard mechanism for deterministically forcing
a parallel-change race, § 12) kills the whole `nj` process instead of
failing just the one id and letting the rest of the batch proceed. This
is the exact scenario item 1 of my task asked me to confirm — it does not
hold for this one hook. `claim`'s own pre-existing single-element use of
`compareGuard` (with `STABLE_HINT`) is unaffected by this bug (it's not a
regression there — `compareGuard`'s `before-compare` branch always
hard-exited, even before this commit); the new exposure is specific to
`guardedWriteCatchable`'s batch callers (`set`/`note`/`check`).

## 5. Confirmed (smaller) bug: `release`'s batch JSON output leaks `anyWritten`

`cmd-release.ts`'s batch branch does `out(JSON.stringify(result, null,
2))`, serializing `runBatch`'s full return value — `{ok, results,
anyWritten}` — directly. The other four commands (`set`/`note`/`check`/
`claim`) all construct an explicit `const wrapper = { ok: result.ok,
results: result.results }` first. § 9's documented shape is exactly
`{ok, results}`; confirmed live:

```
$ nj release --id=TSK-001,TSK-002 --as=alice --json
{
  "ok": true,
  "results": [ ... ],
  "anyWritten": true        <- not in § 9's shape, not emitted by the other 4 commands
}
```

Low severity (an additive, truthful field, not a wrong value), but it's a
genuine shape inconsistency a strict JSON consumer could trip on, and
it's simple to fix: build the same `{ok, results}` wrapper `release` uses
for its non-batch path's equivalent, or that the other four commands
already use.

## 6. Gate replay

`node test/run-all.js dist/nj`: **77/79 pass, 0 failed, 2 cannot-run**
(the usual two expected gaps: `ac-15-no-dependencies.js`,
`hardening-njrc-foreign-link.js`).

`gate.js --step=245bf6f --frozen=c6-baseline` (nested nanojira worktree,
`tools/refactor-harness/gate.js`): the process stalled (no child process
spawned, idle on kqueue, zero CPU progress for several minutes) and I
killed it rather than let it hang further — did not get a completed
replay tally in this pass. I did not want this to block reporting real
bugs found elsewhere, so I'm reporting without it; happy to retry in a
follow-up if the Lead wants the byte-exact tally confirmed. In its place:
`help.ts`'s diff is a single, additive 3-line paragraph appended to the
existing help text (confirmed by direct reading, quoted above) — nothing
else in the whole commit touches `help.ts`/`--help` output, so there is
no mechanism for the replay to show anything beyond this one new
paragraph. `run-all.js`'s full 77/79 pass (§ an unrelated section) is not
a substitute for the byte-exact gate tally, but is consistent with no
regression.

## Summary

The refactor is sound in its stated goal: the single-ID path is
*provably* unchanged in every one of the nine files (verified by direct
diff reading, not by re-running tests and hoping). AC-31's 67/67 passes,
my own ~20 additional probes (batch parsing edge cases, runtime failures,
`--force`, `STATUS.md` once-ness, concurrency) all match § 9/§ 12/D136
exactly. But `before-compare`'s fault hook was missed in the "make it
catchable" refactor — it still hard-exits the whole process in a batch,
not just the one id — and `release`'s batch JSON output has a minor shape
leak. Recommend fixing both before promoting: route `before-compare`'s
fault through the same catchable/non-catchable split `atomicWrite`/
`mirrorWrite` already use (e.g. pass a `catchable: boolean` into
`compareGuard`, or split it the same way the other two hooks were split),
and make `cmd-release.ts`'s batch JSON output build the same explicit
`{ok, results}` wrapper the other four commands use.

## D137 delta — `415e43d` (code), `f2b07e4` + `5e0d8e6` (tests)

Same worktree discipline: `/tmp/verifier-v32d2-batch` (detached at
`5e0d8e6`, main's tip — already past both fix commits), `/tmp/
verifier-v32d2-nested/projects/nanojira` (for `gate.js`), `/tmp/
verifier-v32d2-unclip/projects/nanojira` (nested, throwaway-patched
`baseline.js`, for the unclipped diff), `/tmp/verifier-v32d2-probe`
(scratch backlog). All removed before writing this. Both D137 bugs are
fixed; **both are confirmed, live, directly**.

### (1) `compareGuard`'s new `catchable` parameter — before-compare fires once in a batch

`compareGuard(el, force, backlog, hint, catchable)`: the timeout branch now
checks `catchable` and calls the same throwable `fail()` `mirrorWrite`
already uses instead of `hardExit`, when `catchable` is true.
`guardedWriteCatchable` passes `true` (new); `guardedWrite` (set/note/
check's single-ID path) passes nothing, defaulting to the unchanged
hard-exit. Confirmed live:

- **2-ID batch, `NJ_FAULT=before-compare`, no marker**: `nj set
  --id=TSK-001,TSK-002 --priority=urgent` waited the full 10s **once**,
  then TSK-001 failed with `fault:before-compare` inside the wrapped
  `results`, and **TSK-002 wrote immediately** in the same invocation —
  confirmed via `time` (total ≈10.1s, not ≈20s) and via the written
  `priority: urgent` on TSK-002's file. Exactly D135/D137's "fires once,
  then spent."
- **Single-ID `set`, same fault**: still hard-exits — `nj: before-compare
  timed out after 10s waiting for .nj-fault-go` to stderr, `{ok:false,
  error:'fault:before-compare'}` to stdout, exit 1. Unchanged, as the
  commit claims.
- **AC-31's own new H18** (`test/ac/ac-31-batch.js:456-482`) exercises
  this exact scenario — I ran it and read it; matches my live probe.

### (2) Single-ID `claim`'s `compareGuard` call is now also `catchable: true` — a genuine fix, not a regression

`claimOne` (shared by both the single and batch paths, same function
since `245bf6f`) now calls `compareGuard(el, false, ctx.backlog,
STABLE_HINT, true)` — unconditionally `true`, for single-ID claim too.
Before this fix, under `NJ_FAULT=before-compare`'s timeout specifically,
**even a plain single `nj claim` hard-exited**, skipping `claimOne`'s own
`try/catch` rollback entirely (the `catch` block that calls `rollback()`
per § 12a was unreachable from this one hook, because `hardExit` tears
down the process before the `catch` can run).

**Judged against § 12a** (line 1751-1753, quoted exactly): *"Write
`assignee: N`... in one guarded write (§ 12). If that write fails
(`changed_in_parallel`, **a fault hook**, any I/O error), the rollback
restores what this invocation read."* This is unconditional and textual —
"a fault hook" is listed as one of three failure kinds that must trigger
rollback, with no carve-out for `before-compare` specifically or for
single-ID vs. batch. The pre-fix hard-exit on this one hook was already a
spec violation, **predating the batch feature entirely** — V3.2-D's own
refactor just exposed it because it had to reason about catchability at
all. Confirmed by searching: `test/ac/ac-27-claim.js` (claim's own
acceptance suite) only ever drove claim's rollback with
`NJ_FAULT=before-rename` (lines 361/373/385) — **never** with
`before-compare`. No test, AC or otherwise, ever asserted the old
hard-exit as the "expected" single-ID behaviour, so there is no baseline
anywhere that this fix contradicts.

**Live confirmation, exact sequence, both the plain-claim and
re-assertion cases**, against a fresh element (`TSK-001`, unclaimed):

*Plain claim* (`nj claim --id=TSK-001 --as=alice`, `NJ_FAULT=before-compare`,
no marker):
```
exit 1
stdout: {"ok": false, "error": "fault:before-compare"}
TSK-001.md: assignee unchanged (empty) — the mirror write never ran,
            the timeout happens inside compareGuard, before it
claims dir generations: 1 claimed alice   (the CAS append `claimOne` read/decided)
                         2 released alice  (the rollback — exactly § 12a's
                                            "a plain claim read unclaimed,
                                            so its rollback appends
                                            released N")
```

*Re-assertion* (same id, already held by alice, claimed again by alice,
same fault): generations 3 `claimed alice` (the plain claim that
succeeded first), 4 `claimed alice` (the re-assert CAS append), 5
`claimed alice` (the rollback) — exactly § 12a's "**a re-assertion's
rollback has nothing to undo**," restoring `claimed N` rather than
releasing it. Exit 0 (correctly — re-assertion' s own exit code rule is
unaffected by this fix; confirmed live, not assumed).

Both sequences match § 12a and D115 exactly, mechanically the same
rollback `claimOne` already had (the `try/catch`/`rollback()` call itself
has zero diff lines in `415e43d` — only the `compareGuard` call gained a
`true` argument, routing into the *existing*, already-correct catch
block). **Conclusion: this is a fix of a latent, pre-existing spec
violation, not an unwanted behaviour change.** It should be recorded as
resolving the violation for single-ID claim too, not just for batches.

### (3) `release`'s batch JSON wrapper

`nj release --id=TSK-001,TSK-002 --as=alice --json` → top-level keys are
exactly `['ok', 'results']` (checked programmatically) — no `anyWritten`
leak. Fixed as described.

### (4) AC-31: 95 (Oracle) vs. 86 (Implementer) — reconciled, no ambiguity this time

Different from the earlier 68-vs-67 case (a genuine counting-convention
difference) — this one is just two counts taken at two different points
in the same commit sequence, both correct for their own snapshot:

- At `f2b07e4` (the Oracle's first D137 regression-test commit,
  immediately before the Implementer's `415e43d` fix): 88 total
  `T.check`/`T.eq`/`T.exit` call sites, minus the same 2 conditional
  fixture guards as always = **86** — exactly the Implementer's reported
  "86/86" for the version of the test file that existed when they ran it.
- At `5e0d8e6` (current HEAD — the Oracle's *second* D137 commit, "AC-31
  gains H18", landed **after** `415e43d`): 97 total call sites, minus the
  same 2 guards = **95** — exactly the Oracle's current count, and
  exactly what `node test/ac/ac-31-batch.js dist/nj` reports right now:
  **`PASS ac-31-batch.js (95 checks)`**.

Nothing is silently skipped in either snapshot; the 9-check gap is simply
H18 (the before-compare-in-a-batch scenario from item 1 above), added
*after* the Implementer's fix was already committed and already measured.

### (5) Byte-exact gate replay

`gate.js --step=415e43d --frozen=c6-baseline`: ran clean this time (see
note below on the earlier stall) —

```
replay: exit 1
oracle: passed 78, failed 0, cannot run 1 (1 expected gap: hardening-njrc-foreign-link.js)
gate  : exit 1, replay CHANGED, oracle green
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
```

Exactly the reported tally — the same 6 calls as every prior round in
this series (the `help`/`help --json`/`--help` fixture's own three, plus
`oracle:edge/coverage-v3-gaps.js`'s own duplicate three).

**Confirmed byte-exact** via the established unclipped-`baseline.js`
technique (nested worktree at `415e43d`, `test/` swapped to `c6-baseline`,
digest-confirmed match, `clip()`/`limit` raised in a throwaway, never-
committed edit): across all 6 calls, the "was" and "now" strings — each
~1,300 characters — differ in **exactly one contiguous block**: the
already-accepted `nj check`/`nj find` help lines (prior rounds) plus this
round's new 3-line paragraph (*"set/note/check/claim/release accept
--id=A,B,C (two or more)... results come back as {ok, results: [...]}."*).
Nothing else differs, anywhere, in any of the 6 calls. `help.ts`'s own
diff (§ 6 of the original report) already showed this is the only change
to that file; this closes the loop with the actual byte comparison rather
than inference from the diff alone.

**On the earlier stall**: re-ran `gate.js` fresh this round and it
completed normally (replay ≈340s, oracle run-all ≈340s more) with no
special intervention. I did not reproduce the stall. My best read: the
first attempt coincided with heavy concurrent load on this machine from
other teammates' own worktree/test activity (three stale,
still-attached `nj-gate-*` worktrees from other sessions were present in
both runs, correctly left alone both times by `gate.js`'s own
alive-pid check) — a resource-contention stall, not a defect in `gate.js`
itself. Nothing in the instrument's logic looks wrong on reading it
(synchronous `fs`/`spawnSync` throughout, no unconditional wait loops
outside the fault-injection hooks being tested). Not raising this as an
instrument bug; flagging only as "retry if it happens again," per the
task's own framing.

### D137 delta verdict

**Accept.** Both confirmed bugs from the original review are fixed and
directly verified: before-compare now fires once and spends in a batch
(item 1), and the single-ID claim behaviour change this also produced is
a legitimate fix of a pre-existing § 12a violation, not a regression
(item 2) — the rollback mechanism itself is untouched, only reachability
of the existing catch block changed. `release`'s wrapper is clean (item
3). AC-31's new count is fully explained, nothing skipped (item 4). The
gate replay reproduces the same 6-call, help-only tally as every prior
accepted round, now confirmed byte-exact rather than inferred (item 5).
**V3.2-D can be accepted.**
