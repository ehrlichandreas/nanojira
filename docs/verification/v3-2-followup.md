# V3-2/TSK-029 follow-up verification (`e81edbe` + `cc99746`)

Verifier, 2026-09-29/30. I didn't write any of this code (DECISIONS 86/87).
Work ran in a throwaway worktree `/tmp/verifier-v32f` (checked out at
`cc99746`); the main tree was never switched or written except to add this
file. Runtime Node v24.21.0. Rulings read: D102, D105, D106; findings
covered: `docs/verification/v3-2.md` F1–F10, `docs/verification/tsk-029.md`
T1–T4.

**VERDICT: pass with one blocking finding.** Every claim reproduces exactly,
F2–F10 and D102 are all confirmed fixed by direct adversarial repro, and the
replay classifies cleanly into V3-3's existing four classes with zero new
category. But **T1 is not fully closed** — the `.njrc` ownership check still
has a TOCTOU window for the common case (a plain file, not a symlink), and I
reproduced the bypass twice, independently, on this exact build. **I'd hold
c4-baseline until that's fixed** — everything else here is solid enough to
build on, but recording this specific gap into a baseline means the next
replay stops being able to tell "the known gap" from "a new one" in this
code path.

## Claims, reproduced

| Claim | Reproduced |
|---|---|
| typecheck 0, build:check | ✓ exit 0 / byte-identical, at `cc99746` |
| hardening-v3-1 628/628 | ✓ exact |
| ac-17 680/680 | ✓ exact (D102's suppression confirmed working — see below) |
| v3-2-regressions 166/166 | ✓ exact (the fixup's own claim; `e81edbe` alone was 165/166, the one gap the Oracle's own mtime-counting helper, closed by `cc99746`) |
| run-all: no green→red | ✓. Totals: `42967cb` (pre) 67/6/1 → `cc99746` (post) **69/4/1** (74 total). `ac-17` and `v3-2-regressions` went red→green. The remaining reds — `ac-24` (313/561), `ac-25` (71/213), `ac-26` (407/702), `coverage-v3-gaps` (8/119), `hardening-njrc-foreign-link` (CANNOT RUN) — have **identical failure counts, check for check**, to what I measured independently for `42967cb` in the V3-3 round: confirms V3-4 scope, untouched by this commit. |
| gate vs oracle-frozen-8: V3-3's 4 classes minus ~1 call, name any new class | **Exactly V3-3's 4 classes, same total (1892), zero new class.** See "Replay classification" below. The "minus 1" in the Implementer's framing referred to `e81edbe` alone (1893, one extra diff from the F5 filename-vs-identity bug) — `cc99746`'s fixup brings it back to exactly `42967cb`'s 1892, not 1891. |
| gate exit code | **8, VERDICT RED** — the same 16 frozen suites named in the V3-3 round (`ac-03`, `ac-09`, `ac-11`, `ac-13`, `ac-18`, `ac-19`, `archive-rm-byte-identity`, `cycle-parent-archived`, `cycle-parent-shapes`, `exit-doctor-fix`, `exit-fault-vocabulary`, `fix-duplicate-mtimes`, `order-doctor-problems-severity`, `state-cycle-all-members`, `tombstone-partial-loss`, `unreadable-stub-refusals`), unchanged. This is DECISIONS 107's accepted gate shape for a behaviour-changing step — the step's own `test/` run (above) is what actually gates. |
| perf `--gate=reads` vs `42967cb` | **Inconclusive, machine too loud to mean anything.** On battery, CPU load 500–860% from other work on the machine (including a 400%-CPU foreign process), A/A control itself hit 19.3% (above the tool's own 10% tolerance) and it said so plainly: `this session is too noisy for a green to mean much`. The measured numbers (reads −10.6%..+16.5%, mostly noise-sized) don't contradict the Implementer's claim of +0.5%..+2.4%, but I can't confirm it. Worth a quiet re-run before c4, not blocking on its own. |

## Replay classification — independently verified, zero unclassified

Same method as the V3-3 round: `gate.js`'s own diff output truncates at 40
entries and clips strings at 400 chars, so I raised both limits in my own
worktree copy of `baseline.js` (not the repo's `tools/`) and re-ran
`verify` with `test/` pinned to `oracle-frozen-8` (`git checkout
oracle-frozen-8 -- test`, confirmed `git diff --quiet` clean first).

- **Total: 1892, exact match.**
- Classified every block against the same four literal rules as the V3-3
  round (STATUS.md is the only file in `after`; `nj init`'s own diff;
  `status_stale`/"STATUS.md is missing or differs..." in stdout;
  "regenerated STATUS.md" in stdout): **1547 / 42 / 254 / 48**, identical to
  what I measured for `42967cb` down to the number. **Zero diffs fell
  outside these four mechanisms.**
- None of this commit's new behaviours (symlinked layout folders,
  case-insensitive matching, `refused:unreadable_dir`, the F5/F10/F6 guards)
  produced a single corpus diff — the frozen fixtures simply don't contain a
  case-mismatched or symlinked layout folder, so there's nothing for a fifth
  class to be.

## Adversarial checks

### T1 re-test — NOT fully fixed (see Finding below)

The FIFO/hang half of T1 is genuinely closed: swapping a FIFO into `.njrc`
mid-race over 200 runs produced **zero hangs** (`O_NONBLOCK` works). The
ownership half is **not** closed for the non-symlink case — see the finding.

### T2 — archive onto a file (hierarchy, blocked merge target)

```
archive onto a file: exit 1 exists | "Error: …/archive/EPIC-001 already
  exists — refusing to overwrite; nothing was moved"
nothing stamped (EPIC-001.md unchanged): true
EPIC-001 folder still exists (nothing moved): true
blocker file untouched: true
```
Exactly as claimed: `exists`, before any write, nothing stamped.

### F4 — `refused:unreadable_dir`

`archive`, `rm`, and `set --status=done` on a backlog with an unrelated
`chmod 000` directory elsewhere all refuse:
```
archive: doctor reports backlog:unreadable_dir: true | exit 1 refused:unreadable_dir
rm:      doctor reports backlog:unreadable_dir: true | exit 1 refused:unreadable_dir
set-done: doctor reports backlog:unreadable_dir: true | exit 1 refused:unreadable_dir
```
Confirmed.

### F5 — `--fix` leaves a non-ID `.md` alone

A hand-written `backlog/epics/meeting-notes.md` (no frontmatter) survives
`doctor --fix` byte-identical, and no tombstone is burned for it:
```
fix result fixed[]: ["regenerated STATUS.md"]
meeting-notes.md byte-identical: true
.ids before/after: ["EPIC-001"] ["EPIC-001"]
```
Confirmed, including the `cc99746` fixup's own distinction (identity vs.
current filename) — not separately re-tested with a misnamed-but-real
element since the fixup's own commit message already demonstrates it via
the replay (`fixcombo-fix` now matches baseline exactly).

### F6 — mixed `archived:` subtree, folder-move guard

First attempt (misnaming the whole epic folder) accidentally bypassed the
guard at the epic level by breaking `ownFolder` recognition — not a defect,
just my fixture; redone cleanly by *nesting* the correctly-named `EPIC-001/`
folder one level deeper (`backlog/wrapper/EPIC-001/…`) so `ownFolder` still
recognises it, with a subtask inside marked `archived:` by hand while its
parents aren't:

```
doctor before --fix: ["layout:misplaced@EPIC-001","layout:misplaced@SUB-001",
                       "layout:misplaced@TSK-001","backlog:status_stale@"]
fix result: ["moved SUB-001 → archive/EPIC-001/TSK-001/","regenerated STATUS.md"]
fix notes: ["EPIC-001: its folder holds elements that disagree on archived: —
             not moved, resolve by hand",
            "TSK-001: its folder holds elements that disagree on archived: —
             not moved, resolve by hand"]
EPIC-001 folder still nested under wrapper/ (refused, not moved): true
No EPIC-001/ created at top level (nothing moved): true
```

Both the epic's and the task's folder moves are correctly refused — moving
either would have carried the disagreeing subtask along. The subtask itself
still moves on its own (subtasks are always single-file moves, never
folder-carried, so this is independent of the guard and correct).

### Symlinked layout folders (F1) and dangling case

A `tasks/` replaced by a symlink to an external directory: `new` writes
through it, `list`/`doctor` see the element, doctor is clean, and the file
really lands at the external physical location — matches "followed when
configured, at the top level only" exactly. A **dangling** symlink in the
archive-folder role reports `backlog:unreadable_dir`, not silence.

### APFS case (F2)

Archive `EPIC-001`, rename `archive/` → `Archive/` on disk (case-only):
`list --all` still shows it archived, `doctor` is clean, `--fix` is a
genuine no-op (`fixed: []`) — the original Verifier-B regression this was
built to close.

## Finding

### T1 — HIGH, security: the `.njrc` ownership check still has a TOCTOU window for a plain (non-symlink) file

**The fix closed the wrong half of the gap.** `readNjrc` now reads through
one file descriptor, but the ownership check is only *re-verified* via that
descriptor when the entry is a symlink:

```ts
function readNjrc(file: string): string | null {
  let link;
  try { link = fs.lstatSync(file); } catch { return null; }
  const bad = (reason, hint) => fail('invalid_njrc', …);
  checkOwner(link.uid, bad);                    // <-- by PATH, before open()
  let fd;
  try { fd = fs.openSync(file, O_RDONLY | O_NONBLOCK); }   // <-- by PATH too
  catch (e) { … }
  try {
    const st = fs.fstatSync(fd);                // safe: via the open fd
    if (link.isSymbolicLink()) checkOwner(st.uid, bad);   // <-- GATED on symlink
    …
    raw = fs.readFileSync(fd, 'utf8');           // reads whatever `fd` is
  } finally { fs.closeSync(fd); }
}
```

For a **plain file** (the overwhelmingly common case — no symlink involved
at all), `link.isSymbolicLink()` is false, so the `fd`-based re-check on
line 220 never runs. The *only* ownership check that ever executes is
`checkOwner(link.uid, bad)` on line 202 — taken from an `lstat` **by path**,
before the subsequent `open` **by path**. If the file at that path is
swapped between those two syscalls, `open()` opens whatever is there *now*,
not what `lstat` examined, and nothing re-checks it. The fd-based
protection added for TSK-029 T1 only ever covers the symlink-vs-target
case; the plain-file case races exactly as it did before the fix, just
through a narrower window (two adjacent syscalls instead of three spread
further apart).

**Reproduced twice, independently, on `cc99746:dist/nj`.** Same method as
the original T1 finding: a root-owned decoy (`/etc/hosts`, hardlinked, so
anyone can place a copy of it) and a foreign-owned payload
(`/Library/Preferences/com.apple.AssetCache.plist`, uid 235, hardlinked)
swapped atomically into `.njrc`'s path while `nj list` runs repeatedly:

```sh
# background: alternately rename the decoy and the payload into w/.njrc
# foreground: nj list, 300 times, from cwd w/
```

Run 1 (300 iterations): 3 reads of the payload's content after the check
had passed. Run 2 (300 iterations, independent pool/process): 2 more. Both
show the exact same symptom as the original finding — `line 1: unknown key
'<?xml version'`, i.e. the attacker's file was parsed as `.njrc`, not
refused. The FIFO-hang half of T1 (also tested in both races) never
reproduced — that part is genuinely fixed.

**What this means in practice:** the whole point of F1/T1 was to stop a
`.njrc` planted in a shared, world-writable ancestor (`/tmp`, a shared NFS
mount) from steering another user's `nj`. An agent — which is the normal
caller here — runs `nj` very frequently; at a sustained ~1% hit rate per
invocation, an attacker who can write to a shared ancestor and race the
swap doesn't need to be fast, just patient. This is the identical class of
attack DECISIONS 93 F1 was meant to close, not a new scenario.

**Fix:** make the fd-based re-check unconditional, not gated on
`isSymbolicLink()`. The *bytes read* always come from `fd`, so the
ownership that matters is always `fstat(fd).uid`, symlink or not; the
earlier `checkOwner(link.uid, bad)` right after `lstat` is fine to keep as
a cheap *early* rejection (saves the `open()` for the common "obviously
wrong owner" case) but must never be the *only* check — it has to be
followed by `checkOwner(st.uid, bad)` unconditionally, every time, using
the fd's own `fstat`. One-line change (drop the `if (link.isSymbolicLink())`
guard around the second `checkOwner` call), and the existing T1 race test
(swap pool, both halves) should go into the suite as a permanent regression
check — it currently isn't one; D106's `v3-2-regressions.js`/
`hardening-v3-1.js` don't attempt a real race, only the single-shot decoy
and single-shot payload cases, which both pass today and would keep passing
even with this gap open.

## Recording c4-baseline

Everything **except T1** is solid: numbers all reproduce, F2–F10/D102 hold
under direct adversarial repro, the replay is clean with zero unexplained
diffs. My recommendation: **fix T1 first, verify the one-line change, then
record c4** at that revision rather than at `cc99746`. The fix is small and
well-understood; recording now would bake a known, exploitable security gap
into the reference baseline that every future replay compares against,
making it harder (not easier) to tell "still the known gap" from "a new
regression in this exact code path" later.

## Cleanup

Worktree `/tmp/verifier-v32f` removed. Probe scripts, race harnesses and
dist copies stay under `/tmp/verifier-v32f-probes/` and
`/tmp/verifier-v32f-dist*`.
