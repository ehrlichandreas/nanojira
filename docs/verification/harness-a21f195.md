# Harness audit — `aee6539` (D127/D138 follow-up: per-backlog replay exclusion)

Verifier, 2026-10-04. Independent audit of the instrument change itself
(not a feature), assigned by the Lead. Work in `/tmp/verifier-aee6539`
(detached worktree at `aee6539`). Removed before writing this. Read:
`tools/refactor-harness/{baseline.js, nj-shim, lib/record.js}`'s full
diff, both corpora decompressed and diffed directly, `gate.js` run twice.

**VERDICT: sound mechanism, correctly re-recorded corpus — but `c6-baseline`
is now a stale anchor and a new tag is needed before further v3.2 work is
gated.** Label recovery is robust for every real label in the corpus
(including multi-hyphen, numeric-suffixed labels), but is **not** robust
against other harness-internal directory names sharing the same `nj-
<word>-<6chars>` convention (confirmed, currently harmless). The exclusion
set is exactly the 3 C5 prefixes, 112 calls, nothing else added or
dropped by accident. The re-recorded corpus is byte-identical to c6's
apart from `backlogLabel` and the two expected nondeterministic windows.
Gate stability: **gate.js always reads the harness paired with whichever
commit it runs from** (never a stale/mismatched pairing) — but because
`c6-baseline` (1c7a0a3) predates batch writes and everything since, gating
`aee6539` against it now surfaces 45 real, previously-hidden differing
calls, confirmed identical across two independent runs (fully
deterministic, not flaky).

## 1. The mechanism

**`backlogLabel(cwd)`** (`lib/record.js`): scans `cwd`'s path segments
from the deepest upward, returning the first one matching `/^nj-(.+)-
[A-Za-z0-9]{6}$/`.

- **Robust for real labels, confirmed against the actual corpus.** Every
  one of the 42 distinct `backlogLabel` values recorded for
  `ac-27-claim.js`'s 436 calls (listed exhaustively, checked
  programmatically) is exactly what `H.freshDir()` was called with,
  including multi-hyphen labels (`ac27-c5-release-steal-1` through `-8`)
  and ones with embedded digits — greedy regex backtracking always finds
  the true trailing 6-char random suffix first, since it's anchored at
  the string's end and there is only one valid split point. No label was
  ever null, truncated, or mis-split.
- **Not robust against other harness-internal dir patterns — confirmed,
  currently harmless.** `backlogLabel()` doesn't stop at the basename; it
  walks every ancestor. Direct test:
  ```
  backlogLabel('/tmp/nj-gate-Ow6gau/projects/nanojira')        -> 'gate'   (should be null)
  backlogLabel('/tmp/nj-gate-Ow6gau/projects/nanojira/backlog') -> 'gate'   (should be null)
  ```
  `gate.js`'s own throwaway worktree root (`fs.mkdtempSync(os.tmpdir(),
  'nj-gate-')`) matches the exact same naming convention `H.freshDir`
  uses. Any `nj` invocation whose cwd is nested under one of these
  (rather than under a genuine `H.freshDir()` scratch backlog) would
  silently recover `backlogLabel: 'gate'` from the ancestor, instead of
  `null`. **Currently harmless**: `isConcurrentProbe` gates on `rec.label
  === 'oracle:ac/ac-27-claim.js'` first, and `'gate'` isn't one of the
  three configured prefixes, so this never changes any exclusion
  decision today — and I confirmed empirically that no record in the
  actual corpus has this problem (every `ac-27-claim.js` call's cwd truly
  is a `freshDir`, so the deepest segment always matches first,
  correctly, before any ancestor is even consulted). It's a latent
  fragility worth closing rather than an active bug: a future suite added
  to `CONCURRENT_BACKLOG_PREFIXES`, or any future caller of
  `backlogLabel()` outside `isConcurrentProbe`'s current guard, could
  silently misclassify. **Recommend**: check only the basename (or cap
  the walk at 1-2 ancestors) rather than walking to the repo root.
- **Exactly the 3 C5 backlogs excluded, nothing else.** Decompressed the
  corpus and counted directly: `ac27-c5-claim` (25) + `ac27-c5-steal`
  (15) + `ac27-c5-release-steal-1..8` (9×8=72) = **112**, matching the
  commit message exactly. None of the other 34 `ac27-c*` labels start
  with any of the three configured prefixes (checked all 42 distinct
  labels programmatically — no false positives). Total excluded calls
  computed independently from the raw corpus, reproducing
  `isConcurrentProbe` exactly: **623** (`ac-07-concurrency.js` 505 +
  `tombstone-partial-loss.js` 6 + `ac-27-claim.js` 112) — matches the
  commit's "947 → 623" claim exactly (947 − 324 recovered = 623). `gate.js`
  itself reports the identical 623 (§ 3 below) — the standalone
  computation and the real tool agree.

## 2. The re-recorded corpus: diffed against c6's directly

Decompressed both `corpus.ndjson.gz` files (c6-baseline's and aee6539's,
6313 records each) and diffed every field of every record, excluding
`backlogLabel` (new) and `cwdHash` (expected to differ record-for-record
— it's `sha256(cwd)`, and the two recordings used different mkdtemp
paths; the comment in the code already says the driver turns it into a
per-run ordinal rather than comparing it directly).

- **Genuinely explained diffs** (expected, both already-known
  nondeterministic windows): AC-7's concurrency fixture (indices ~2031-
  2034: differing `argv`/`stdout`/`after` — which of 300 racing `nj new`
  calls got which TSK-id, inherently random) and AC-27's C5 block
  (indices ~5243-5269: differing `stderr`/`exit` — which racing claim/
  steal process won, also inherently random). Both fall inside
  `isConcurrentProbe`'s exclusion on **both** sides of the diff.
- **11 further "diffs" in `after`, all resolved**: five oracle calls
  (`encoding-json-key-order.js`, `exit-doctor-fix.js` ×2, `write-
  encoding.js`, `scratch:r4.js`) show a different raw `sha` for one file
  after `doctor --fix`, but in every case the paired `nsha` (normalised
  content hash) is **identical**. `header.json`'s own note says exactly
  this: *"Comparison key excludes per-file raw sha; nsha (normalised
  content) is normative."* Confirmed this is pre-existing, recording-
  session-specific raw-byte noise (not something `aee6539` introduced),
  not a real content difference.
- **Nothing else differs anywhere** in all 6313 records, field by field,
  beyond `backlogLabel`, `cwdHash`, and the two items above. The
  re-recording reproduces c6 faithfully.
- `njSha256` (`37a7ece6...`) and `testDigest` (`67731e53...`) are
  identical between the two `header.json`s — confirmed by design, not
  coincidence: the commit message states the re-recording was done "in a
  throwaway worktree at that same commit" (1c7a0a3), i.e. against the
  *same* pinned old `dist/nj` and the *same* pinned old `test/`, not
  against `aee6539`'s own (much later) `test/`/`dist/nj`. `aee6539`
  itself touches none of `src/`/`dist/nj`/`test/` — confirmed via `git
  show aee6539 --stat` (5 files, all under `tools/refactor-harness/`).

## 3. Gate stability — the central question

**How `gate.js` picks its corpus**: confirmed by reading the code
(`gate.js:328-333`), not by inference — `tools/refactor-harness/` (code
*and* `baseline/corpus.ndjson.gz` together, as one directory) is copied
via `fs.cpSync(HERE, harnessDst, ...)` from wherever `gate.js` itself is
currently running from (by default; `--harness=<rev>` instead checks out
that revision's harness+corpus pair). **`--frozen=<tag>` only supplies
`test/`** (`gate.js:244`) — it never selects which `corpus.ndjson.gz` is
loaded. So: **there is no scenario, through gate.js's normal operation,
where new baseline.js code pairs with the old (pre-backlogLabel) corpus,
or vice versa** — harness code and its corpus are always copied as one
unit. Running `gate.js` from any commit at or after `aee6539` always uses
the new corpus and the new, narrower exclusion; running it from before
`aee6539` (or with `--harness=<a pre-aee6539 rev>`) always uses the old
corpus and the old, whole-suite exclusion — each internally consistent,
never mixed.

**What actually happened when I ran `gate.js --step=aee6539
--frozen=c6-baseline` (twice, full output below)**: the replay's "now"
side runs `aee6539`'s own `dist/nj` (sha `8e338c0b...` — confirmed
identical to `415e43d`'s and `5e0d8e6`'s; `aee6539` touches no source) against
`c6-baseline`'s frozen `test/`. The corpus's "was" side was recorded with
`1c7a0a3`'s **old** `dist/nj` (sha `37a7ece6...`, confirmed via `git show
1c7a0a3:dist/nj | shasum`) — a materially different binary: `1c7a0a3`
predates batch writes (`245bf6f`) entirely (confirmed: `test/ac/ac-31-
batch.js` does not exist at `1c7a0a3`; 66 commits separate the two).

Both runs, independently, reported **identically**:
```
baseline: 6313 calls, nj sha256 37a7ece6...
current : 6313 calls, current code sha256 ... d6ea930a...
compared: 5690 calls (623 excluded as nondeterministic by design — concurrency)
BEHAVIOUR CHANGED — 45 differing call(s): claim 37, help 4, --help 2, release 2
```
(Oracle run-all also matched exactly between the two runs: 77 passed, 2
failed — `ac-24-legacy-migration.js` and `edge/hardening-njrc-swap.js`,
both **pre-existing**, unrelated to this audit's scope: traced to the
in-progress V3.2-E njrc-swap/stray-`.ids/`-cleanup work landed on `main`
*after* `aee6539` chronologically on the same day — commits `f9e1e6b`
through `e5de3f2`, several explicitly titled "revert" — nothing to do
with the harness change under review here. Confirmed these are at `main`
regardless of `aee6539`, by running `ac-24-legacy-migration.js` directly.)

**The 623-excluded count is exactly what I computed independently in § 1
— confirmed by the real tool, not just my own script.** The 45 differing
calls are **fully explained and exactly reproduced across two independent
runs — deterministic, not flaky**: `help`/`--help` are the already-
accepted doc-text growth (6 calls, byte-confirmed in my D137 delta
report); **`claim` (37) and `release` (2) are newly, correctly surfaced**
by `aee6539`'s own fix — these are plain, non-C5, deterministic claim/
release calls whose JSON key order changed (`{id, ok, ...}` now, `{ok,
id, ...}` before — confirmed in my own V3.2-D diff review: `cmd-claim.ts`
and `cmd-release.ts`'s single-ID JSON construction became
`Object.assign({id: el.id}, single)`, putting `id` first). **This
divergence from `c6-baseline` genuinely existed since `245bf6f`/`415e43d`,
but was invisible before `aee6539`**, because the old whole-suite
`CONCURRENT_SUITES` exclusion dropped *all* 436 of `ac-27-claim.js`'s
calls (including these 37+2 ordinary, deterministic ones) from the strict
comparison. `aee6539` doing its job correctly (recovering 324 calls into
the strict compare) is *why* this is visible now — not a defect in
`aee6539`, but exactly the kind of accumulated drift a stale frozen
baseline will always eventually surface once the exclusion is tightened.

**So: does `gate.js` ever read the old corpus when it shouldn't, making
C5 "unexcluded" and the gate flaky?** No — confirmed by code reading and
by two live, identical runs. The risk is different from (and larger than)
what "unexcluded C5" would suggest: **`c6-baseline` itself is now a
66-commit-stale reference point**, from before batch writes existed at
all, so *any* gate run against it (regardless of this harness fix) will
report a non-trivial, real, deterministic diff list once a command's
output has genuinely changed since then — which several already have.
This isn't instability; it's `c6-baseline` having outlived its usefulness
as a "nothing unexpected happened" checkpoint.

## Recommendation: yes, a new tag is needed

**Cut a new frozen tag (e.g. `c6b-baseline`) at or after `aee6539`**,
with a corpus re-recorded against the *current* `dist/nj` and `test/` (not
1c7a0a3's), before gating any further v3.2 work. Reasons:

1. `c6-baseline`'s own corpus is pinned to a binary from before batch
   writes; every gate run against it will keep reporting the
   claim/release key-reorder (and help-text growth) as "changed" forever,
   forcing whoever reads gate output to re-litigate already-accepted
   history on every single run — the opposite of what a frozen checkpoint
   is for.
2. `aee6539`'s own fix (recovering 324 calls into the strict comparison)
   only pays off going forward if the *next* frozen point already has
   those 324 calls correctly in scope from the start, rather than
   re-discovering the same backlog of already-known diffs every time.
3. Not urgent for `aee6539` itself (which is harness-only and doesn't
   need its own gate in the normal sense), but blocking for the *next*
   real feature step: gating it against `c6-baseline` would mix that
   step's own, new diffs in with these 45 already-known, already-
   explained ones, making "every diff above must be a named class"
   materially harder to audit at a glance.

Minor, independent of the tag decision: tighten `backlogLabel()` to stop
at the basename (§ 1) — low priority, currently inert, but cheap to fix
before it's ever load-bearing for a second suite.
