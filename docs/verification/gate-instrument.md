# Gate instrument audit — Toolsmith commits `e0ead0c`, `02e977d`

Verifier, 2026-09-28. Scope:
- `tools/refactor-harness/gate.js`
- `baseline.js verify`'s exit 8 and its 8 > 4 > 1 precedence
- `scratch/verify.js` exiting 1 on ✗
- `tools/perf.js`'s power check and `--ab`

Checked against the commits, the harness README, and DECISIONS 85/90/93.
`tools/` was not edited. Mutations were made only in throwaway worktrees and
in copies of `dist/nj`.

**VERDICT: trustworthy with findings.**
- The gating logic does what it claims in every case I built, including the
  one that matters most: a red suite hidden behind named diffs gives exit 8,
  not 1.
- The replayed `test/` is exactly the tag's.
- The tree it runs from is never written.
- Two holes need fixing before the instrument alone can be trusted:
  - a `verify.js` ✗ with exit status 0 passes as green (I1);
  - cleanup isn't robust: children outlive the gate, and a crash or SIGHUP
    leaks the worktree (I2, I3).
- The A/B tolerance sits inside today's measured noise (I4).

## Setup

- **Audit worktree** `/tmp/nj-audit` at `efd4b69` (the harness at `02e977d`
  plus later non-tools commits). Every unmodified gate ran from there.
- **Why not the main tree:** it carried the Implementer's uncommitted work,
  and other agents were writing to it, so nothing that happens to it can be
  attributed to the gate.
- **Fingerprint** of the audit worktree, taken before the first run and after
  the last: sha256 over every file, over `git status --porcelain=v2
  --untracked-files=all`, over the worktree's index file, and `HEAD`.
- **Mutants:** copies of `e5e5e3b:dist/nj` (`/tmp/nj-audit-mut/`). Harness
  mutations lived in separate worktrees `/tmp/nj-audit-{e,g,h}`, where the gate
  correctly printed "harness from efd4b69 + uncommitted changes".
- **Runtime:** Node v24.21.0.
- **Conditions:** Low Power Mode on, power on battery and later on AC, other
  agents' gates and records running at the same time.

## 1. Main tree and index; cleanup

| Check | Result |
|---|---|
| Fingerprint of the tree the gate runs from, before vs after 2 full gates, (a) (b) (c) (d), a `--keep` run, SIGINT, SIGHUP and a crash | **unchanged**: files, status (0 lines), index, HEAD |
| `--keep` | worktree and `gate.log` stay, registered in `git worktree list`; afterwards the worktree holds the step's `test/` and the running harness (4 status lines: README, baseline.js, verify.js, gate.js); `runtime/darwin-arm64` → the real runtime |
| normal end, and every exit code 1/4/6/8 | worktree and temp root removed, not registered |
| **SIGINT** to `gate.js` mid-replay (as a parent's timeout would send it; SIGTERM uses the same handler) | worktree and root removed, **but the replay child keeps running** (I2) |
| **SIGHUP** | no handler: **worktree and root stay, still registered; the child keeps running** (I3) |
| **crash of gate.js** mid-replay (forced without touching `tools/`: `gate.log` replaced by a directory, so the `appendFileSync` in the output handler throws EISDIR) | uncaught, **no cleanup: worktree left, registered, 2 processes still running on it** (I3) |

## 2. Verdict gating, mutation-tested

Every row is one full `gate.js --step=e5e5e3b --frozen=oracle-frozen-7` run.
Unless stated otherwise, the 19 named V3-1 diffs are present in each, which
also tests that exit 1 can't mask a red.

| Case | Mutation | Expected | Gate result |
|---|---|---|---|
| reference (task item 5) | none | 1, the 19 named diffs | **exit 1**; 19 diffs, the list *and every diff body* identical to my own `e5e5e3b` replay (`v3-1.md`); replay oracle 64/64 (the frozen AC-15 finds the runtime through the `projects/` layout), run-all 65/65, `verify.js` 123/123 |
| (a) red verdict-only suite | `nj`: `err.code === "EPIPE"` → `"EPIPE_DISABLED"` | 8 | **exit 8**: RED VERDICTS lists `edge/stdout-epipe.js`, **the 19 diffs still printed**, run-all failed 1. 8 wins over 1 ✓ |
| (b) one byte in a recorded stdout | `nj`: `(empty backlog)` → `(empty Backlog)` (1 byte; in 16 corpus calls, asserted by no suite) | 1, exactly that diff | **exit 1, 35 diffs = the 19 + 16 new.** Each of the 16 differs only in stdout, and only by that byte (checked mechanically on the diff bodies). No other change. |
| (c) nj crashes on one command | `nj`: `tree --json` throws a TypeError → `internal_error` | 4 or 8 | **exit 8**: 5 replay suites + 6 run-all suites red; **also 2 coverage gaps in the same run** (`r3.js`, and `verify.js` crashing on it), so 8 wins over 4 ✓ |
| (d) test/ digest mismatch | `--frozen=oracle-frozen-6` | 6 before the long replay | **exit 6**. The replay aborts right after starting ("recorded 4ede7689 / current 58c2f019"), before any fixture. The gate then still runs run-all (91 s in total, I5). A "not the newest frozen tag" note is printed. |
| (e) `verify.js` ✗ | harness worktree: one `ok(…, false)` before the summary | 8 | **exit 8**; RED VERDICTS names `scratch verify.js: ✗ AUDIT mutation e …` |
| (g) `verify.js` ✗ but exit 0 | same ✗, plus `process.exitCode = 0` | 8 (a printed "1 failed" is a verdict) | **exit 1**: listed under "ran and passed, but NOT byte-recorded" as `123/124 checks`. **The hole, I1.** |
| (h) `verify.js` crashes before its summary | `throw` before the summary line | 4 | **exit 4** ("exited 1 without its summary line") ✓ |

The precedence 8 > 4 > 1 holds: (a) shows 8 over 1, (c) shows 8 over 4.
`gate.js`'s own combination matches the README: 8 if the replay says 8 or
run-all fails; else 4 on any gap; else the replay's code.

## 3. Frozen `test/` is byte-identical to the tag

I recreated `useTests()` in a scratch worktree at `e5e5e3b`. The file list is
compared by path, mode and `git hash-object` blob against
`git ls-tree -r <tag> -- test`:

| Procedure | Result |
|---|---|
| `git checkout oracle-frozen-7 -- test` alone (the old way) | **differs**: `test/ac/ac-21-backlog-location.js` survives |
| `gate.js`'s way: `rm -rf test`, checkout, `git diff --quiet` | **identical**, 92 files |
| back to the step (`e5e5e3b`) | **identical**, 93 files |

The self-check `git diff --quiet <rev> -- test` does **not** notice an
untracked extra file (checked: exit 0 with `test/ac/zz-extra.js` added). The
result is correct only because `rm -rf` runs first. The README's "Geprüft:"
overstates that check (I6).

## 4. `perf.js`

- **Interleaving is real.** A and B were logging shims that record each call
  and then `require` the real `nj`. The logged order for 3 rounds was
  `A:init`, then round 1 `A,B` per command, round 2 `B,A`, round 3 `A,B`,
  exactly as documented. With an odd round count, A goes first once more than
  B (4:3 by default), which is negligible for medians.
- **The tolerance applies to the medians of B vs A per command**, one-sided,
  `pct > 10`. The max is printed, not gated. As documented.
- **The power check doesn't block `--ab`:** it ran under Low Power Mode and
  reported "Low Power Mode is on … the A/B comparison still holds", exit 0.
- **Absolute mode refuses under Low Power Mode:** exit 3,
  `perf: not a quiet machine (power): Low Power Mode is on …`. That was on AC
  power, so the LPM check alone triggered it. With `pmset` not on `PATH` it
  also refuses (exit 3, "cannot read the power state"), i.e. it fails
  closed ✓.

## Findings

**I1 — medium: a `verify.js` ✗ counts as a pass when the probe's exit status is 0.**

- `baseline.js` turns a ✗ red only when `verdict && K > 0 && status === 1`.
  With `K > 0` and status 0 it falls through to `notRecorded`, "ran and
  passed", and the gate returns the accepting exit 1 (mutation g).
- Today only `process.exitCode = bad === 0 ? 0 : 1` in `verify.js` prevents
  this. Any later `process.exit(0)`, an async handler that resets
  `exitCode`, or a revert of that one line brings back the pre-D90 state
  silently.
- The summary line already *is* the contract. **Fix:** `K > 0` → red,
  whatever the status. A status 0 with a missing summary stays a gap.

**I2 — medium: `gate.js` doesn't stop its children.**

- The SIGINT/SIGTERM handler removes the worktree and exits. The running
  `baseline.js` (and its `nj` calls) is not killed: it's reparented to init
  and keeps running with a deleted cwd, its `nj-s0-scratch-<pid>` alive.
- In my run it died about a minute later, most likely on EPIPE writing to the
  dead parent's pipe. Until then it keeps spawning `nj`, which loads a machine
  on which perf is judged.
- **Fix:** `spawn(…, { detached: true })` and `process.kill(-child.pid)` in
  `cleanup()`; or forward the signal and wait for `close` before removing
  the worktree.

**I3 — medium: no cleanup on SIGHUP, SIGKILL or a crash of `gate.js` itself.**

- Demonstrated for SIGHUP and for an exception inside the output handler.
  Worktree and temp root stay, stay registered in `git worktree list`, and
  the child keeps running.
- Earlier today there were several `nj-gate-*` worktrees at `e5e5e3b` of
  unclear origin, and after killed runs two `nj-s0-scratch-<pid>`
  directories were left whose owning process no longer existed.
  `baseline.js` removes its scratch only on a normal end.
- **Fix:**
  - handle SIGHUP;
  - wrap the `data` handlers;
  - run `cleanup` from `process.on('exit')` as well;
  - at start, report or prune `nj-gate-*` roots whose recorded owner pid is
    dead (write the pid into the root). SIGKILL can't be handled; only the
    start-up prune covers it.

**I4 — medium: the A/B tolerance of 10% is inside the noise measured today.**

- The comment calibrates it on "up to 5.6%" (one pre-flight run). Later
  interleaved runs of builds with no perf-relevant change, in
  `docs/verification/v3-1.md`, went beyond it:
  - v2 vs `e5e5e3b`, 9 rounds: `tree` **+11.1%**. The very next 11-round
    run showed −0.7% for the same pair.
  - v2 vs `a10b671`: `list` −13%.
  - In this audit, v2 vs `a10b671`, 3 rounds: `doctor` +8.5%.
- So a real no-regression step can go REGRESSION on noise alone, and per the
  README a red means "roll back".
- **Fix, any one of:**
  - gate on the median of *paired per-round* ratios (A and B run
    back-to-back within a round, which cancels drift) instead of the ratio
    of medians;
  - run an A/A control in the same session and gate on B's deviation beyond
    A/A's;
  - require a REGRESSION to reproduce once before it counts.

**I5 — low.** After the replay's exit 6/7 (stale instrument), `gate.js` still
runs run-all, 90 s that can't change the outcome unless it's red. Stopping
early would be cleaner. Keeping the run is also defensible: it shows whether
the step is otherwise green.

**I6 — low.** `useTests()`'s check `git diff --quiet <rev> -- test` ignores
untracked files. The result is right only because of the preceding `rm -rf`
(§ 3). A check that would catch it: `git status --porcelain -- test` empty,
or the `ls-tree` comparison above.

**I7 — low.** The CPU quiet check fails *open*. If `ps` can't be spawned,
`foreignCpuLoad()` returns no rows, which reads as "quiet". The power check
fails closed. The load check should do the same. Separately, `pmset`/`ps`
resolve through `PATH`; `/usr/bin/…` would be more robust.

**I8 — low, becomes relevant at V3-4.**
- `--ab` builds the fixture with A's `init` and then hand-writes v2-layout
  files (`epics/`, `tasks/`, `.ids/`).
- Once B is V3-4, which refuses a legacy layout with `legacy_layout`, B can't
  read A's fixture. `timeOnce` then exits 2 on B's non-zero exit.
- The A/B for V3-4 needs a per-side fixture (or a migrated copy for B).
- The same applies to `doctor`'s exit 2 if a fixture ever carries an error.

**I9 — info.** A red oracle masks a stale replay: replay 6 + run-all red →
gate 8. That's acceptable, since red is red, and the replay line still says 6.

## Addendum — `c252ab5` (AC-15 verdict-only), `dd35227`, the c3 recording

Run from a fresh audit worktree at `a1d33e0` (harness = HEAD). Its
fingerprint was unchanged afterwards.

**`c252ab5` can't mask a real AC-15 failure.**

- *Which `nj` is judged.* The verdict-only path runs the suite **directly
  against the real `nj`** (`spawnSync(node, [suite, NJ_ABS])`), not through
  the shim.
- *How it's classified.* Exactly like `run-all.js`: a first line with
  `— CANNOT RUN` is a gap, exit 0 passes, anything else is red.
- *Where `— CANNOT RUN` can come from.* Only two places:
  `abortNoImplementation` (no `nj` at all) and AC-15's own "no runtime Node
  found" (shown with `NJ_NODE=/nonexistent`). A failing check always prints
  `FAIL … — n of m checks failed`, which is red.
- *Live proof.* Mutant `nj-f-notalone` is `a10b671:dist/nj` with one line
  that throws unless `../package.json` exists beside it. It runs in place,
  so every shim-recorded call is unchanged, but it can't run as a lone copy,
  which is exactly AC-15's property.
  `gate.js --step=a10b671 --frozen=oracle-frozen-8 --nj=nj-f-notalone` →
  **replay 0 diffs / 3075 compared, exit 8**, RED VERDICTS
  `ac/ac-15-no-dependencies.js`. run-all also fails AC-15 (4 of 22), and the
  gate exits **8**. Without the verdict gate this would have been a clean 0.
- *Where a gap can still hide something.* Inside `gate.js`, `NJ_NODE` is
  always set (`process.env.NJ_NODE || NODE`), so AC-15 can only say CANNOT
  RUN there if that Node doesn't exist.

**The c3 recording (`9277ea6`) is consistent**, checked against git
independently:

| Header field | Value | Independent value |
|---|---|---|
| `njSha256` | `e5138d56…` | sha256 of `c3-baseline:dist/nj` (= `a10b671`) ✓ |
| `testDigest` | `c582855a…` | digest of `oracle-frozen-8:test/` (= `5a43aeb`) ✓ |
| `oracleSuites` | 65 | exactly the `ac/`, `fault/`, `edge/` suites of `oracle-frozen-8` ✓ |
| `corpusSha256` | `fb0a4e88…` | sha256 of the committed `corpus.ndjson.gz` ✓ |
| `calls` | 3586 | lines in the corpus ✓ |
| parts | oracle 65/65, cannot run 0; AC-15, det-id-retry, stdout-epipe and verify.js (123/123) under `notRecorded` | consistent with `c252ab5` |

**Determinism of the new corpus:** a self-replay,
`gate.js --step=a10b671 --frozen=oracle-frozen-8`, gives **0 diffs / 3075
compared, gate exit 0**. run-all 65/65, AC-15 22 checks.

**`dd35227`** (a `--frozen` that doesn't fit the corpus):
- `--step=a10b671 --frozen=oracle-frozen-7` → **exit 2 after 1 s**, "does
  not belong to this harness's corpus … Use --frozen=oracle-frozen-8", with
  the worktree cleaned up. This replaces my pre-`dd35227` case (d) result
  of exit 6: the harness now catches a wrong call before the replay, and
  exit 6 is left for a genuinely stale corpus.
- Consequence, worth a line in the README: since the harness copy carries
  the *current* corpus, an old gate (V3-1 against `oracle-frozen-7`/c2) can
  only be re-run by running `gate.js` from a harness checkout that still
  carries the c2 corpus. The comment "A gate against anything but the newest
  frozen oracle is legal (re-running an old gate)" at the top of `gate.js` no
  longer holds as written.

## Addendum — `659f2bd`: `hardening-v3-1.js` verdict-only, `ac-15`'s gap documented

Verified in a throwaway worktree at `659f2bd`.

**hardening-v3-1.js joining `VERDICT_ONLY_SUITES` cannot mask a real failure.**
Mutated `dist/nj` globally: `io_error` → `io_errorX` (two occurrences). Run
directly (`node test/edge/hardening-v3-1.js <mutant>`): **17 of 637 checks
fail** — a genuine, meaningful regression, not a trivial mutant. Through
`gate.js --nj=<mutant>`: **exit 8**, confirmed twice independently.

**`ac-15`'s gap is correctly scoped, and (more importantly) is dead code when run through `gate.js`.** `EXPECTED_GAPS` is matched purely by suite
name, consulted *only* inside the `/— CANNOT RUN/` branch — a genuine
assertion failure from `ac-15` (not a "no runtime" skip) falls straight to
`else { failed++; failedNames.push(s); }` regardless of whether the suite
is listed, so it would still redden the gate. In practice `ac-15` has only
one `console.log(... '— CANNOT RUN')` call in the whole file, so "matched
by name only" carries no real risk here.

More to the point: **`gate.js`'s own `tee()` already sets
`NJ_NODE: process.env.NJ_NODE || NODE`** (`NODE = process.execPath`) for
every child it spawns, including both the replay and the step's own
`run-all.js`. Since `ac-15`'s `findRuntime()` honours `NJ_NODE` as an
unconditional override the moment it's set (no path-pattern check, just
`fs.existsSync`), `ac-15` running *through `gate.js`* always finds a valid
Node and never hits "CANNOT RUN" at all — confirmed empirically: it shows
plain `PASS ac-15-no-dependencies.js (22 checks)` in every `gate.js` run
across this round and the V3-4 round, never once appearing under "expected
gaps". The gap only bites `baseline.js`/`run-all.js` run **standalone**,
without `NJ_NODE` set by the caller — which is how the Implementer's own
environment evidently invokes it, and how several of my own manual checks
this session did too.

**So: yes, `baseline.js` should set `NJ_NODE` itself**, mirroring exactly
what `gate.js` already does
(`env.NJ_NODE = env.NJ_NODE || process.execPath` before spawning an oracle
suite). That would make `ac-15` a real, always-passing check from
`baseline.js` too, and the `expected-gaps.js` entry would stop being needed
for this specific cause (worth keeping the entry itself as a documented
fallback, in case `ac-15` ever fails to find a runtime for some other
reason — the mechanism costs nothing when it never fires).

**A separate, pre-existing instrument oddity, found while checking this — not caused by `659f2bd`.** `gate.js`'s own `run-all.js` step (not the
replay) never printed a final "passed/failed" summary in any of my runs
this session, including a **clean, unmutated `b34666e` run from the earlier
V3-4 round** (`oracle: no summary, exit 1`). All three runs I have logs for
(one clean, two with the `io_error` mutant) cut off `run-all.js`'s output
at the **same logical point** — mid-check inside `ac-26-unarchive.js`
(`"...## D` — plausibly a timing/worktree-environment issue specific to how
`gate.js` spawns `run-all.js`, since the identical suite run **directly**
(no `gate.js`) completes normally and correctly reports `hardening-v3-1.js`
17/637. I did not have budget in this round to root-cause it further.

**Does this mask anything here? No — this time.** `gate.js`'s exit code
(8) is driven by the replay's own red verdict (all 61 frozen suites, by
construction, per DECISIONS 107), which fires regardless of whether
`run-all.js` finishes. But the precedence only works out *because* the
replay happens to always be red for a V3-4-era step. For a future
suite-adding step whose replay is clean, this same truncation would mean
`gate.js` has to fall back to a `run-all.js` summary that never arrives —
worth the Toolsmith's attention as a follow-up, separate from `659f2bd`'s
own scope, which is otherwise sound.

## What was not tested

- **SIGKILL**: not handleable by design; it's covered only by the start-up
  prune proposed in I3.
- **SIGTERM** separately: same handler as SIGINT, so the same result is
  expected (I2).
- **Linux**: `perf.js` claims nothing about power there, and the gate's
  runtime-layout detection is platform-agnostic.

## Cleanup

My worktrees (`/tmp/nj-audit`, `-e`, `-g`, `-h`, the scratch one for § 3, the
kept `--keep` one, and those leaked by the SIGHUP and crash tests) are
removed, along with the processes I started. Mutants, logs and probe scripts
stay in `/tmp/nj-audit-mut/`. Worktrees and processes of other agents were
not touched.
