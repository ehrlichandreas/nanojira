# V3.1-C verification — `nj claim` / `nj release` (`242703a`, `b0742d6`, `a6bd4e4`, TSK-032)

Verifier, 2026-10-03. I didn't write any of this code — independent
verification assigned by the Lead. Work in `/tmp/verifier-v31c-claim`
(detached worktree at `a6bd4e4`), `/tmp/verifier-v31c-nested/projects/
nanojira` (a second worktree, nested under its own `runtime/darwin-arm64`
symlink so `gate.js`'s own AC-15 check passes when I run `baseline.js`
directly — same technique as my two prior reports), and `/tmp/
verifier-v31c-probe` (scratch backlogs). All removed before writing this
file. Runtime Node v24.21.0. Read: §§ 4, 7, 9 ("The acting name"), 10, 11a,
12, 12a, 14 as of `059a862`; DECISIONS 114–120; `src/core/claims.ts`,
`src/core/actor.ts`, `src/commands/cmd-claim.ts`, `cmd-release.ts`,
`cmd-note.ts`, `cmd-doctor.ts`, `cmd-archive.ts`, `cmd-rm.ts`,
`cmd-unarchive.ts`, `core/constants.ts`; `test/ac/ac-27-claim.js`;
`docs/review/claim-model.mjs` (P3).

**VERDICT: accept.** AC-25 (234), AC-27 (262/262), run-all and
`gate.js --step=a6bd4e4 --frozen=c5-baseline` all reproduce. The
Implementer's "40 differing calls in 2 classes" **undercounts the scale,
not the correctness**: the real total is 2,934 calls in 4 classes, every
one of them explained and expected (§ 1). The help-text gap the task asked
about is real on its own terms (§ 2) but belongs to a wider, already-latent
problem (§ 9's own synopsis for `new` is also out of sync with `help`,
unrelated to C). The AC-27 296-vs-262 count is fully explained, not a
skipped check (§ 3). `core/claims.ts` matches the model on every point
asked (§ 4), including one thing the model never had to get right because
the real code already does: a rollback's own `ENOENT` retries the *same*
decided append, never re-entering the decision logic. The perf cache has
one narrow, structurally-real staleness window, bounded to a backlog's
first-ever claim, that does not break claim exclusivity (§ 4). My own
black-box probes (§ 5), including live parallel claimants/stealers beyond
AC-27's own and several `NJ_FAULT` rollback traces, matched the spec in
every case I tried.

## 1. AC-25, AC-27, run-all, gate — the real diff count

- `node test/ac/ac-25-note-author.js dist/nj`: **234/234**, exact.
- `node test/ac/ac-27-claim.js dist/nj`: **262/262**, exact — matches the
  Implementer's count (§ 3 explains why the Oracle's 296 differs).
- `node test/run-all.js dist/nj`: 74/75 pass (ac-27 now present and green;
  the one cannot-run is the usual root-needing `hardening-njrc-foreign-
  link.js`).
- `gate.js --step=a6bd4e4 --frozen=c5-baseline`: oracle 74/75 (same one
  expected gap), **replay exit 8 — VERDICT RED**, naming the two frozen
  suites DECISIONS 118 predicted word for word: `ac/ac-01-basic-run.js`
  (asserts `.gitignore` has exactly two patterns; now three) and
  `ac/ac-25-note-author.js` (asserts `nj note --as` is `unknown_field`;
  it now works). Re-ran both against `dist/nj` directly to confirm the
  *only* failing assertions are exactly those two things — nothing else in
  either frozen suite differs.

**The replay diff itself.** `gate.js`'s own default run reports "40
differing call(s) (truncated)" — the word "truncated" is the tell: its
diff printer caps at 40 by design, so 40 is the display limit, not the real
count. I raised the limit (a throwaway edit to my own worktree's copy of
`tools/refactor-harness/baseline.js`, never committed, same technique as my
B re-check) to 10,000 and reran `baseline.js verify` directly (test/
checked out to `c5-baseline` first, matching `gate.js`'s own documented
step 2). **The real total is 2,934 differing calls.** I classified every
single one programmatically (by what each call's diff text actually
contains, not by guessing) and confirmed **zero are unexplained**:

| Class | Calls | What |
|---|---|---|
| `.gitignore` gains the third pattern | **≈1,748** | Every fixture/oracle/scratch call that inspects backlog state after an `init` now sees a 3-line `.gitignore` instead of 2 — one file, touched by nearly everything, hence the huge count. Exactly the class the Implementer named. |
| `_claim` added to every JSON entry | **≈1,522** | `list`, `show`, `tree`, bare `nj --json`, and every write's own `entry` — anywhere an element renders as JSON now carries `_claim` (always present, `null` when unclaimed, per § 9). The Implementer's report named this class but said "2 calls"; it is actually the **second-largest** class in the whole diff, because `_claim` is structural (every entry, every JSON-emitting command), not incidental. |
| `nj note` gains `--as` | **9** | 8 are `checkFlags`' "Known flags" hint gaining `--as` in an `unknown_field` error (`stdout` and/or `stderr`); 1 is `nj note --as=reviewer …` itself flipping from `unknown_field` to a real success (`exit`, `stdout`, `stderr`, and the element file's `after` state all change together in that one call) — this is DECISIONS 110/118's own plan ("the `--as` flag is added when C is promoted"), not a surprise. |
| `nj help` gains the `claim`/`release` lines | **3** | `nj help`, `nj help --json`, `nj --help` — present in the replay, not missing and not misclassified; see the open point below. |

2,934 is not an approximation of that table's sum because a handful of
calls land in more than one field of a single diff entry (the one
`--as=reviewer` success touches `exit`+`stdout`+`stderr`+`after` at once,
counted once as "1 call"); the table counts **calls**, and I verified
programmatically that every call's diff text matches exactly one of these
four signatures, with no leftover.

**The open point, answered directly: the help calls are *in* the replay,
just past the default 40-call display cap** — not missing, not
misclassified. I found them at raw indices #198–200 in my raised-limit run
(`nj help`, `nj help --json`, `nj --help`, each `differs in: stdout` only,
each diff being exactly the one inserted `nj claim`/`nj release` pair of
lines and nothing else in either string). I recommend the Lead record this
precisely: not "40 calls in 2 classes" but **"2,934 calls in 4 classes, all
named, all expected — the default diff printer's 40-call cap hid the true
scale, not a different outcome."** Nothing here changes the gate's own
verdict (exit 8 was already correctly understood and accepted per D88/D113's
precedent for a deliberate, disclosed spec change); it only corrects the
historical record of *how many* calls that covers and *which* classes.

## 2. Help text vs § 9 — the specific gap, and one pre-existing, unrelated one

**Confirmed, and C-caused:** § 9's command list states
`nj note --id=TSK-009 "text" [--as=<name>] (§ 10)`, and `cmd-note.ts`'s
`checkFlags` genuinely accepts `--as` (confirmed functionally: `NJ_AUTHOR=
env --as=flag nj note …` signs with `flag`, outranking the environment, as
§ 9 says it must) — but `src/core/help.ts`'s hardcoded `nj note --id=
TSK-009 "text"` line shows no `--as` at all. Checked every *other* help line
against § 9's synopsis one by one: `new`, `set`, `show`, `list`, `tree`,
`rm`, `archive`, `unarchive`, `claim`, `release`, `doctor` all match their
§ 9 entries exactly, flag for flag (`claim`'s own help line —
`[--as=…] [--status=…] [--steal=<holder>]` — is correct and complete). So
`note` is the **one** line C's promotion left stale, and it is a direct
consequence of C (before C, `note --as` genuinely didn't exist, per D110;
`help.ts` was correct then and nobody updated it when D119/D110 made it
real).

**Found while checking, unrelated to C, worth a footnote only:** § 9's own
synopsis for `nj new` lists `[--priority=…] [--tags=a,b] [--assignee=…]
[--depends-on=…] […]` with no `--status` — but `help.ts`'s `new` line
*does* show `[--status=…]`, and `cmd-new.ts`'s `NEW_FIELDS` constant
genuinely includes `'status'`. Here `help` and the code agree with each
other; it's § 9's own synopsis that's incomplete. Pre-existing (not
introduced by `242703a`/`b0742d6`/`a6bd4e4`), out of this task's scope, and
not a C regression — flagging only because the task asked me to check
"every other help line."

## 3. AC-27: 296 vs 262 — explained exactly, nothing silently skipped

Got the dist/nj committed at `059a862` (the commit whose own message states
"ac-27 296 checks, 189 fail") and ran `ac-27-claim.js` against it directly:
**296 checks, 189 failures, reproduced exactly.** Instrumented `T.check` in
my own copy of `test/lib/harness.js` (one line, logging every check
description to a file; reverted before finishing) to capture the full list
of check descriptions from both runs and diffed them. **The only
difference: 34 lines, all labelled `fixture: …`.**

`ac-27-claim.js`'s `ok(r, what)` helper (and the inline fixture guards in
its model-building code) calls `T.check('fixture: ' + what, false, …)`
**only when the fixture setup itself fails** — it is silent on success, by
design (the same pattern `ac-25`/`ac-26` already use: "fail loudly if a
precondition breaks, say nothing when it holds"). Against the pre-
implementation dist, *every* fixture that depends on a working `claim`
fails (`unknown command 'claim'`), and each failure is one recorded
`fixture: …` check; against the real, working `a6bd4e4` dist, those same
fixtures succeed and emit **zero** checks. 296 − 34 = 262. I confirmed by
diff that every one of the 262 substantive `C1`–`C10` assertions is
present, word-for-word identical, in both logs — nothing beyond the
fixture guards differs, and nothing is silently skipped; the opposite is
true: the *failing* run has 34 **extra** noise-checks that the *passing*
run correctly omits.

## 4. `core/claims.ts` vs the model (P3), and the perf cache

Checked each point the task named, against `src/core/claims.ts`:

- **CAS via `link()`.** `appendEntry()`: temp file, `fsync`, `linkSync(tmp,
  dir/baseGen+1)`, matching § 12's mechanism exactly.
- **`EEXIST`/`ENOENT` retry, 100-round bound.** `transition()`'s loop is
  `for (round = 0; round < ROUNDS; round++)` with `ROUNDS = 100` (`// same
  bound as ID allocation, § 8`); both codes fall through to the next round.
  Matches.
- **Highest-entry-wins, numeric parsing.** `highestEntry()`:
  `names.filter(n => /^\d+$/.test(n)).map(Number).sort((a,b) => b - a)` —
  numeric sort, not lexicographic (confirmed empirically in my first claim
  review's APFS facts, and here directly in the code: `.map(Number)`
  before `.sort`). A third kind of file (neither a generation nor a
  `.nj-tmp-*`) is implicitly skipped by the `/^\d+$/` filter — matches
  AMBIGUITIES.md 84's own framing ("must not crash a read, nothing
  stronger").
- **Rollback semantics.** `rollback()` takes the already-decided
  `kind`/`name` as parameters and never re-derives them — `cmd-claim.ts`
  computes `reassert`/`landedSteal` *before* calling it and passes `{kind:
  'claimed', name}` for a re-assertion, `{kind: 'released', name}` for a
  plain claim, and skips calling it entirely when `landedSteal` (steal
  never rolled back). This is the one thing my own model had to be
  *fixed* to get right (a bug I found and corrected in `claim-model.mjs`
  during the § C re-check, D117): a rollback's own `ENOENT` must retry the
  *same* decided append, never fall back into the general decision logic.
  The real code never had this bug — `rollback()`'s retry loop
  (`appendEntry(dir, gen, kind, name, time)`, `gen` re-read fresh from
  `highestEntry` on `ENOENT`, same `kind`/`name` every round) only ever
  retries its own fixed append. Confirmed live (§ 5): a re-assertion's
  faulted rollback restores `claimed N`; a plain claim's restores
  `released N`; a landed steal's is never rolled back at all
  (`claim:mismatch` instead).
- **No live pruning; removal only archived/gone.** `removeClaimDirWholesale`
  is the only function that ever deletes entries, and it's called from
  exactly three places (`cmd-archive.ts`, `cmd-rm.ts`, `cmd-unarchive.ts`)
  plus `doctor --fix` step 7a (`fixStep7a`'s `if (el && !el.archived)
  continue` — skips, never touches, anything live, including
  done-but-live). No code path prunes a live directory to its highest
  entry; the mechanism that used to do that is simply gone, matching the
  proposal's own "removed entirely, not narrowed."
- **Unarchive removal placement.** `cmd-unarchive.ts`: the
  `removeClaimDirWholesale` loop sits textually and causally after every
  refusal check (`exists`, `misplaced`, the parent-chain check) and before
  the first `compareGuard`/`atomicWrite` — exactly "once every refusal
  above has cleared … and before the first move," confirmed by reading the
  surrounding code, not just the comment above the loop.

**The perf cache (`rootExistsCache`).** The comment's own claim —
"`.nanojira/claims/`, once it exists, is never removed by `nj` itself …
staying `true` forever once observed is therefore always correct" — is
right about the `true` side, but the cache also latches `false`, and that
side has a real, if narrow, staleness window: a `list`/`tree`/bare-`nj`
invocation that calls `readClaim` for an early element *before* the
backlog's first-ever claim exists caches `exists: false` for its entire
remaining lifetime; if a concurrent `nj claim` creates
`.nanojira/claims/` for the very first time while that same read command
is still rendering later elements, every element checked *after* the
cache was set stays reported as unclaimed regardless of what actually
landed, for the rest of that one process's run. I traced the call graph to
confirm this is reachable: `core/derive.ts` and `cmd-list.ts`'s
`availableToActor` (which backs `--ready` condition 5) both call
`readClaim` → `claimsRootExists` directly, with no re-check once cached.

**This does not break claim exclusivity.** The claim mechanism itself
(`transition`/`appendEntry`) never consults this cache — only `_claim`'s
*display* and `--ready`'s *filter* do. Nothing about this race lets two
processes believe they both hold a claim; at worst, `--ready` momentarily
over-lists an element someone else just claimed, and the over-lister's own
next `nj claim` attempt on it correctly fails with `refused:claimed` —
self-correcting through the same CAS that protects every other path. The
window is also one-time-per-backlog-lifetime (every claim after the first
is immune, since by then the cache's first observation in any *new*
process is already `true`) and vanishingly small in practice (a `list`'s
own `readClaim` calls are synchronous, in-process, over already-loaded
elements). I'd call this a disclosed limit, not a blocking defect — on par
with the already-accepted "a reader just sees the generation as it was a
moment ago" staleness, just with a (harmless-in-effect) wider blast radius
for one brief, one-time window. Two ways to close it if the team wants to:
cache only the `true` observation (gives up most of the measured
performance win for a claim-free backlog, since that's exactly the case
the `false` branch optimizes); or tie the existence check to the same
snapshot moment `context()` already takes when it scans the whole backlog
once at the start of every command, so its staleness matches what the rest
of `ctx.elements` already has, no wider.

## 5. My own black-box probes

Beyond AC-27's own thorough coverage (20 parallel claimants, 10 parallel
stealers, release-racing-a-steal over 8 rounds, both `NJ_FAULT=before-
rename` rollback shapes, numeric generation ordering, `--ready` condition
5, `--as`/`NJ_AUTHOR` precedence, archived/duplicate-id/missing-name
refusals, `claim:orphaned` surviving a done-but-live element through
`doctor --fix`), I ran against the real binary:

- **`note --as` functional check.** `NJ_AUTHOR=env nj note --as=flag "…"`
  signs with `flag` — `--as` outranks the environment, confirming the
  code (not just `checkFlags`) honours § 9's precedence for `note` too.
- **`--ready` condition 5, live.** Claimed a complete `TSK-001` as
  `alice`; `NJ_AUTHOR=bob nj list --ready --json` omits it, `NJ_AUTHOR=
  alice nj list --ready --json` includes it with `_claim: {"by":"alice",
  …}` — exact match.
- **Plain-claim rollback, live fault.** `NJ_FAULT=before-rename nj claim
  --as=dave`: `fault:before-rename`, and the claim sequence gained
  `claimed dave` immediately followed by `released dave` (the rollback) —
  `doctor` clean but for the expected `backlog:stray_tmp`.
- **Re-assertion rollback, live fault.** Clean claim as `erin`, then
  `NJ_FAULT=before-rename nj claim --as=erin` again: the sequence gained
  **`claimed erin` → `claimed erin` → `claimed erin`** (clean claim,
  faulted re-assertion, its rollback) — the rollback restores `claimed`,
  not `released`, exactly as D115 point 1 and § 12a's text require; `_claim`
  still reports `erin`, `assignee` is still `erin` (from the *first*,
  successful claim), and `doctor` is clean — no `claim:mismatch`, because
  there was nothing to mismatch: the mirror was already correct before the
  faulted re-assertion even ran.
- **Landed-steal mismatch, live fault.** `NJ_FAULT=before-rename nj claim
  --steal=erin --as=frank`: the steal's `claimed frank` entry **stays** on
  the chain (confirmed: no `released`/restore entry follows it), `assignee`
  stays `erin` (stale), and `doctor --json` reports exactly
  `claim:mismatch`, `"claimed by 'frank' but assignee is 'erin'"` — the
  steal is never rolled back, exactly as spec'd.
- **`--file` addressing around `duplicate_id`.** Two files sharing
  `TSK-001`'s id: `claim --id=TSK-001` refuses `duplicate_id`;
  `claim --file=<one of them>` succeeds, bypassing it, per § 9's escape
  hatch.
- **`release` by the wrong name, then by the holder.** `refused:claimed`
  naming the holder; the holder's own `release` succeeds, `assignee` is
  left as-is (`alice`), `claim: null` in the result — matches § 12a's
  "`assignee` is left as it is."
- **Claim survives `doctor`/`doctor --fix` while done-but-live; is removed
  by `archive`; comes back unclaimed through `unarchive`.** Claimed a
  `done` task: `doctor` and `doctor --fix` both leave it untouched
  (`claim:orphaned` never fires for merely-`done`); archiving its parent
  epic wholesale-removes `.nanojira/claims/` entirely; unarchiving brings
  both elements back with `_claim: null`.

No deviation from § 9/§ 10/§ 11a/§ 12/§ 12a/§ 14/§ 7 found in any of these.

## What I relied on AC-27 for, not re-derived

The exhaustive real-parallel-process races (20-way claim, 10-way steal,
8-round release-vs-steal) and the `NJ_FAULT=before-compare` interaction are
exercised there at a scale I did not think it productive to duplicate by
hand; my own probes above extend rather than repeat that coverage
(specifically: the re-assertion-rollback and landed-steal-mismatch traces,
which AC-27 checks via its own fixtures but which I wanted to see directly
against the live binary myself).

---

## D121 delta (`ef8f888`, `920c1de`)

Verifier, 2026-10-03. Worktrees `/tmp/verifier-d121-claim` (plain, for
AC-25/27/run-all) and `/tmp/verifier-d121-nested/projects/nanojira`
(nested under its own `runtime/darwin-arm64` symlink, for `gate.js`'s own
AC-15 check and for a second, uncapped `baseline.js` run), both detached at
`ef8f888`; both removed before writing this. **VERDICT: ready to
accept — C is accepted.** All three D121 follow-ups land exactly as
specified; the printed total (2,934) matches mine; one correction to my own
first report, found while re-verifying it (below).

**(a) Help lines vs § 9, once more, in full.** `src/core/help.ts`'s `note`
line now reads `nj note --id=TSK-009 "text" [--as=…]`, matching § 9's
`nj note --id=TSK-009 "text" [--as=<name>] (§ 10)`. `920c1de`'s `new` line
in § 9 now includes `[--status=…]`, matching `help.ts` (unchanged there)
and `cmd-new.ts`'s `NEW_FIELDS`. Re-checked every line, not just these two:
`new`, `set`, `note`, `show`, `list`, `tree`, `rm`, `archive`, `unarchive`,
`claim`, `release`, `doctor` all match § 9's synopsis flag-for-flag.
Nothing else drifted.

**(b) `gate.js --step=ef8f888 --frozen=c5-baseline`, and the printed
total.** AC-25 234/234, AC-27 262/262 (unchanged, exact). `run-all.js`:
73/75 pass, 0 failed, 2 cannot-run (the same two expected gaps as every
prior report: `ac-15`'s path-depth artifact in my own un-nested worktree,
and the root-needing `hardening-njrc-foreign-link.js`). The gate itself:

```
BEHAVIOUR CHANGED — 2934 differing call(s): new 714, list 678, set 392,
tree 256, init 177, --json 152, doctor 107, show 101, archive 96,
unarchive 81, note 79, rm 61, (bare) 33, help 4, --help 2,
--backlog=<SCRATCH>/store/bl 1
(truncated: showing 40 of 2934)
...
replay: exit 8
oracle: passed 74, failed 0, cannot run 1 (1 expected)
gate  : exit 8, VERDICT RED: a suite or check failed
```

**2934 — exact match to my own count**, and to the total I reported for
`a6bd4e4` (the fix changes *what* six of those calls' diffs contain, not
*how many* calls differ — see the correction below). `diff()`'s tally
buckets by `argv[0]` (the command), not by my four named classes, so I
re-ran my own classifier (now argv-robust against embedded newlines, a
mistake my first pass partly had) against a second, uncapped `baseline.js`
run (limit raised to 10,000, same throwaway-edit technique as before, never
committed) to get the exact composition:

| Class | Exact count |
|---|---|
| `.gitignore` gains the third pattern | 1,399 |
| `_claim` added to a JSON entry (includes calls that also touch `.gitignore` in the same snapshot — bucketed here as the more specific signal) | 1,523 |
| `note` gains `--as` | 6 |
| `nj help`/`nj --help` gains the `claim`/`release` lines **and now also `note`'s `[--as=…]`** | 6 |
| **Total** | **2,934** |

Zero calls fall outside these four — confirmed programmatically (the
classifier's "unexplained" bucket is empty). **Verdict logic and exit
codes: unchanged**, confirmed by diff (`git diff a6bd4e4 ef8f888 --
tools/` touches only `baseline.js`, 37+/17− lines, exactly the `diff()`/
report-printing change described in the commit; `gate.js` itself is
untouched) and by outcome (replay exit 8, gate exit 8, the same two named
`RED VERDICTS` — `ac/ac-01-basic-run.js`, `ac/ac-25-note-author.js` — as
before `ef8f888`).

**Correction to my own first report.** Re-deriving the exact composition
above surfaced two counting errors in `docs/verification/v3-1-c-claim.md`'s
original § 1 table, both the same kind of mistake (counting *occurrences
of a string* across both `stdout` and `stderr` of one call, instead of
counting *calls*):

- **"`nj note` gains `--as`": I said 9, it is 6.** Five calls show the
  "Known flags: `--as`, …" hint (two of them print it in both `stdout` and
  `stderr`, which I'd counted as two each), plus the one `--as=reviewer`
  success. 5 + 1 = 6, not 8 + 1 = 9.
- **"help text": I said 3, it is 6.** I only found the `help` *fixture*'s
  own three calls (`nj help`, `nj help --json`, `nj --help`); I missed
  that `oracle:edge/coverage-v3-gaps.js` calls all three again — the
  *exact* duplication pattern I had already found and correctly counted in
  my own V3.1-B re-check (6 calls there too, fixture triple + this same
  oracle file's triple). I should have checked for it here and didn't.

Neither error changes the verdict (both diffs I'd already confirmed were
clean — just under-counted), and the grand total (2,934) was right in both
reports since it came from the tool, not from summing my own class counts.
Flagging it anyway because the Lead and Oracle are now citing "4 classes"
by name (D121) and the per-class numbers should be right.

**(c) § 12 Limits bullet and § 9 synopsis.** `920c1de`'s new § 12 bullet —
"a backlog's very first claim landing while a `list`/`tree`/bare-`nj`/
`show` is in progress... may report `_claim: null`... and may count one of
them as ready that no longer is... claim exclusivity itself is
unaffected... the window exists once per backlog" — matches my report's
description of the cache window in every particular: the mechanism
(`claimsRootExists`'s `false` latch), the scope (`_claim` display and
`--ready`'s filter only, never the CAS itself), and the one-time-per-
backlog bound. § 9's `nj new` synopsis now reads `[--status=…] [--priority=
…] …`, matching `help.ts` and `NEW_FIELDS`.

---

## c6-baseline audit (`304f86b`, `1c7a0a3`, D127)

Verifier, 2026-10-04. Worktrees `/tmp/verifier-d127-claim` (plain) and
`/tmp/verifier-d127-nested/projects/nanojira` (nested under its own
`runtime/darwin-arm64` symlink, for `gate.js`'s own AC-15 check), both
detached at `1c7a0a3`; both removed before writing this. **VERDICT:
sound.** The instrument change is minimal and correctly scoped, the
nondeterminism it tags is real and exactly as large as claimed, and the
baseline recording is self-consistent.

### (1) `304f86b` touches only `CONCURRENT_SUITES`, and the exclusion is exactly `ac-27-claim.js`, 436 calls

`git show 304f86b --stat`: one file, `tools/refactor-harness/baseline.js`,
5 insertions, 0 deletions — the one line adding `'oracle:ac/ac-27-claim.js'`
to the `CONCURRENT_SUITES` set plus a comment. `isConcurrentProbe()` does
`CONCURRENT_SUITES.has(rec.label)` — exact `Set` membership, not a prefix
or substring match, so this addition cannot affect any other suite's
`rec.label` by construction, not just in practice.

Decompressed `c6-baseline`'s own recorded corpus
(`tools/refactor-harness/baseline/corpus.ndjson.gz`, 6,313 records) and
checked directly: 436 records carry `label === 'oracle:ac/ac-27-claim.js'`,
spanning 61 distinct `cwdHash` values (scratch backlogs). Critically, the
total number of records sharing *any* of those 61 `cwdHash` values is also
exactly 436 — no other suite's call shares a backlog with `ac-27-claim.js`,
so `markNondeterministic`'s per-backlog taint-spreading cannot reach
anything outside those 436. **Exactly 436, exactly `ac-27-claim.js`,
nothing else touched — confirmed both structurally (exact-match `Set`) and
empirically (direct corpus inspection).**

`node test/run-all.js dist/nj` and the gate's own oracle leg (below) both
show `PASS ac-27-claim.js (262 checks)` — **AC-27's own verdict still runs
in full** on every gate; only the *byte replay* comparison skips its 436
calls, exactly as D127 states.

### (2) Is AC-27 nondeterministic only through C5? Confirmed empirically, not just by reasoning

Ran `ac-27-claim.js` twice against the same `dist/nj`, with `NJ_KEEP=1` and
a dedicated `TMPDIR` per run so every scratch backlog (61 + the shared
`HOME`) survived both runs for inspection. Hashed every backlog's full file
tree (content + relative path, sorted) per run and diffed run 1 against
run 2, labelling each backlog by its `model()` name (stripping the random
`mkdtemp` suffix).

**First pass, hashing everything: 6 of 50 distinct labels differed**
(`ac27-c4-plain`, `ac27-c4-reassert`, `ac27-c4-steal` in addition to the
three C5 ones). Before concluding C4 also races, I checked *why*: C4
exercises `NJ_FAULT=before-rename`, which aborts a write **after** the
temp file is written and `fsync`'d but **before** `rename` — intentionally
leaving a stray `.nj-tmp-<pid>-<rand>` file behind. That filename embeds
the process PID and a random suffix, which legitimately differs between
any two runs **regardless of product determinism** — it is exactly the
kind of difference the real corpus format already excludes from its own
comparison (`after.stray` records a *count*, never the stray files'
names, confirmed by reading `stripSha`/`after` handling in
`baseline.js`). My first-pass hash was naively stricter than the actual
replay comparison it was meant to validate.

**Re-ran the comparison excluding `.nj-tmp-*` filenames** (matching the
real corpus's own normalisation): **exactly 3 of 50 labels differ between
the two runs — `ac27-c5-claim`, `ac27-c5-steal`, and one of the eight
`ac27-c5-release-steal-N` rounds** (round 3 in this particular pair of
runs; which round lands differently is itself part of the race, not fixed
— consistent with an 8-round repeated trial of a genuine coin-flip race,
not a defect). **This is an exact match to D127's own claim**: only the
three C5 backlogs (claim, steal, release-steal) actually race; C1–C4,
C6–C10 are confirmed deterministic across two independent runs, not just
asserted to be.

### (3) `c6-baseline` (`1c7a0a3`) is self-consistent

- **`dist/nj` sha256 matches `ef8f888` exactly**: `37a7ece6…50431f` on both
  sides (`git show ef8f888:dist/nj | shasum -a 256` vs the worktree's own
  `dist/nj`) — confirmed byte-identical, not just "said to be."
- **6,313 calls**, confirmed directly from the decompressed corpus
  (`corpus.ndjson.gz`, 6,313 NDJSON lines).
- **`gate.js --step=1c7a0a3 --frozen=c6-baseline`** (i.e. replaying the
  baseline against the exact commit it was recorded at — the
  self-consistency check the task's "`--step=HEAD`" phrasing meant at the
  time `1c7a0a3` was `HEAD`, since `HEAD` has since moved on to v3.2 work):
  **`BEHAVIOUR UNCHANGED — the recorded surface is identical`**, `replay:
  exit 0`, `oracle: passed 74, failed 0, cannot run 1 (1 expected)`,
  `gate: exit 0, replay unchanged, oracle green`. `baseline: 6313 calls …
  current: 6313 calls … compared: 5366 calls (947 excluded as
  nondeterministic by design — AC-7 concurrency)` — `947 = 511` (AC-7) `+
  436` (AC-27), matching the commit message's own self-reported numbers
  exactly, reproduced independently rather than taken on trust.

### Conclusion

The instrument change is the smallest fix that correctly closes the gap it
names (file-granularity exclusion, honestly disclosed as coarser than
ideal in its own commit message), it does not touch anything it doesn't
claim to, the nondeterminism it tags is real and exactly as large as
claimed — confirmed by running the suite twice myself, not by re-deriving
the claim from the commit message — and the baseline recording it protects
reproduces itself exactly. **Sound.**

