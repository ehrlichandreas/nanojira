# V3.1-B verification — `nj unarchive` (`cd33d3a`, § 11a, AC-26, TSK-031)

Verifier, 2026-10-03. I didn't write any of this code — independent review
assigned by the Lead (every v3.1 step gets independent verification before
acceptance; D113 additionally asks the Verifier to confirm the replay-diff
class independently, not just read the commit's own claim). Work ran in
three throwaway worktrees, none touching the main tree except to add this
file: `/tmp/verifier-v31b-unarchive` (detached at `cd33d3a`, for AC-26/
run-all/probes), `/tmp/verifier-v31b-nested/projects/nanojira` (a second
detached worktree, laid out `<tmp>/projects/nanojira` +
`<tmp>/runtime/darwin-arm64` → symlink to the real runtime, matching
`docs/verification/v3-preflight.md` A2's requirement for AC-15 to find a
runtime, so a direct `baseline.js verify` run wouldn't suppress its diff
listing behind a coverage gap), and `/tmp/verifier-v31b-probe` (scratch
backlogs for my own probes). All removed before writing this file. Runtime
Node v24.21.0. Read: § 11a (`b5790c2`), the touched § 4/§ 9/§ 12 lines,
DECISIONS 104 (75, 78–81), D113 (`17026d8`); `src/commands/cmd-unarchive.ts`,
the `cmd-doctor.ts`/`core/layout.ts`/`core/help.ts`/`nj.ts` diff;
`src/core/store.ts` (`planMove`/`runMove`, reused unchanged);
`test/ac/ac-26-unarchive.js`.

**VERDICT: accept.** AC-26 711/711, run-all and `gate.js
--step=cd33d3a --frozen=c4-baseline` both reproduce exactly. I independently
confirmed, byte-for-byte and not just from the gate's own summary, that the
replay's 6 differing calls are exactly the D113 class (the single added
help line) and nothing else. The helper move (`removeEmptiedIdFolders`,
`cmd-doctor.ts` → `core/layout.ts`) is a literal cut-and-paste — identical
body, same call site, same imports already present — and `doctor --fix`
step 3 still works correctly in my own probe. My own black-box probes
(merge with pre-existing strays on both sides, a non-element file riding
along a folder rename, a deeper split-heal, `--file` addressing, `exists`
against a file-vs-folder target, `STATUS.md`/`doctor` clean after the
round trip) found no deviation from § 11a. No finding to report.

## 1. AC-26, run-all, gate — reproduced exactly

- `node test/ac/ac-26-unarchive.js dist/nj`: **711/711**, exact.
- `node test/run-all.js dist/nj` (direct, my own un-nested worktree): 72/74
  pass, 0 failed, 2 cannot-run (`ac-15-no-dependencies.js` — a worktree-
  path-depth artifact, same as in my prior two reports, not a defect;
  `hardening-njrc-foreign-link.js` — needs root, pre-existing D98 gap).
- `node tools/refactor-harness/gate.js --step=cd33d3a --frozen=c4-baseline`
  (its own correctly-nested throwaway worktree): **oracle 73/74** (the one
  gap is the same root-needing suite), **replay exit 1 — CHANGED**, gate
  exit 1 ("every diff above must be a named class"). This matches D113's
  own statement exactly: a replay change is the *expected*, *accepted*
  outcome here (consistency with the spec's new command-list line wins
  over "0 diffs", per D88's precedent), gated on the Verifier reading the
  diff list and confirming it is nothing but that.

## 2. Independent confirmation of the D113 class — every differing call listed

I did not take the gate's "BEHAVIOUR CHANGED — 6 differing call(s)" summary
on faith. `gate.js`'s own diff printer clips each string to 400 characters,
which — for a ~1100-character help text — hid the actual difference behind
two identical-looking "was"/"now" prefixes. To see the real bytes, I built
a second, correctly-nested worktree (`/tmp/verifier-v31b-nested/projects/
nanojira`, `runtime/darwin-arm64` symlinked in beside it, exactly the shape
`v3-preflight.md` A2 requires for AC-15 to find a runtime — necessary
because `baseline.js verify`, run directly rather than through `gate.js`'s
own setup, hides its diff list entirely behind *any* coverage gap), checked
out `c4-baseline`'s `test/` into it (`git checkout c4-baseline -- test/`,
the same swap `gate.js` documents as its own step 2), and removed the 400-
char clip in my own copy of `tools/refactor-harness/baseline.js` (a
throwaway edit in a scratch worktree, never touching the repo or the
harness `tools/` isn't covered by this task's read-only restriction, which
names only `src/` and `test/`). Running `baseline.js verify --nj=dist/nj`
there reproduced the identical 6-call list, now in full:

| # | label | argv | differs in |
|---|---|---|---|
| 198 | `help` | `nj help` | `stdout` |
| 199 | `help-json` | `nj help --json` | `stdout` |
| 200 | `flag-help` | `nj --help` | `stdout` |
| 4086 | `oracle:edge/coverage-v3-gaps.js` | `nj help` | `stdout` |
| 4087 | `oracle:edge/coverage-v3-gaps.js` | `nj --help` | `stdout` |
| 4088 | `oracle:edge/coverage-v3-gaps.js` | `nj help --json` | `stdout` |

**Exactly six, exactly these six, exactly `stdout` on each.** Diffing the
full, unclipped `was`/`now` strings by hand: every one of the six is
byte-identical except for one inserted line, `  nj unarchive --id=EPIC-001
\n`, appearing between the existing `  nj archive --id=EPIC-001` and
`  nj doctor [--fix]` lines — precisely `core/help.ts`'s one-line diff
(confirmed against `git show cd33d3a -- src/core/help.ts`). Nothing else in
either string differs: not whitespace, not another command's line, not the
exit-code or `--json`-shape prose at the end. `baseline: 4829 calls ...
current: 4829 calls ... compared: 4318 calls (511 excluded ...)` — same
call count both sides, confirming no call was added, dropped, or reordered
by this commit; only its own content changed, on the two or three call
sites (the one-off `help`-fixture, repeated identically by the `help`/
`--help`/`--json` variants, and `coverage-v3-gaps.js`'s own copy) that
print it.

## 3. The helper move does not change `doctor`'s behaviour

`git diff` of `cmd-doctor.ts`→`core/layout.ts` for `removeEmptiedIdFolders`
is a pure relocation: identical function body (the `ID_FOLDER`-filtered,
non-recursive `rmdirSync` walk, DECISIONS 92's own rule, word for word down
to its comment), same two call sites (`cmd-doctor.ts`'s step 3 fix, now
importing it; `cmd-unarchive.ts`'s new call), and `core/layout.ts` already
imported both `fs` and `path`, so nothing about the move's own mechanics
changed either. I additionally ran `doctor --fix` myself against a manually
misplaced hierarchy folder (moved a task's owned folder to an unrelated
path, then `doctor --fix`): it reported `layout:misplaced`, planned and
performed the move (`"moved TSK-001 with its folder → EPIC-001/TSK-001/"`),
and left the backlog clean on a second `doctor` run — the non-ID-named
container folder I'd moved it into was correctly left behind (not ID-
shaped, so outside what `removeEmptiedIdFolders` ever touches), exactly as
the function's own comment says. No regression from the move.

## 4. My own black-box probes beyond AC-26

AC-26 is unusually thorough (711 checks: all three groups × renamed
folders, the layout-switch matrix, hierarchy merge via D90/94, the split-
heal rule, every refusal and the precedence between them including two
joint orderings, `exists` for both a file-at-folder and folder-at-file
target, all three `NJ_FAULT` hooks (`before-compare` with and without a
racing parallel edit, `before-rename`, `after-tmp-write`), a crashed-
then-completed unarchive, `--id`/`--file`/bare/unknown-id, and the § 9
read-only amendment). My own probes targeted scenarios adjacent to, but not
literally inside, that file:

- **A non-element file riding along a folder rename.** Put a stray
  `README-mine.txt` and an `attachments/` subfolder with a file in it
  directly inside an archived epic's own folder (not a foreign *element*
  file — AC-26 line 460 already covers that case, which correctly refuses
  `misplaced`), then unarchived. The whole folder, stray content included,
  moved as the single `rename` § 11a describes — correct and symmetric
  with `archive`'s own "the subtree's folder moves as a whole" rule (§ 11);
  not a defect, since the "foreign element" check in `cmd-unarchive.ts`
  deliberately only looks for other *elements* (`ctx.elements.filter(...)`)
  sharing the folder, not arbitrary bystander files, which both `archive`
  and `unarchive` have always carried along wholesale.
- **The same stray-file question under a per-entry merge**, not a whole-
  folder rename: pre-created an active `EPIC-001/TSK-001/` folder holding
  an unrelated `orphan-note.txt`, and put a second stray file inside the
  *archived* `TSK-001` folder alongside its element file. Unarchiving
  merged per-entry (`planMove`'s recursive `visit`, shared unchanged with
  `archive`): the pre-existing file stayed put, the stray from the archive
  side moved in next to it, the element file moved to its correct name,
  and the (now empty) archive-side `TSK-001` folder plus its emptied parent
  were `rmdir`'d away — confirming "never a recursive delete" empirically,
  not just by reading `runMove`'s `rmdirSync` (which simply fails, caught
  and ignored, on anything non-empty).
- **A deeper split-heal.** Archived an epic with two child tasks, then
  manually moved one child's *owned folder* back to active (simulating
  `archive:split` on a hierarchy folder, not just a loose file) and
  stripped its `archived:` key. `doctor` correctly reported `archive:split`
  on that one task only. Unarchiving the epic moved only the still-
  archived sibling task (the `ids` result correctly omitted the already-
  active one), merged the epic's own folder into the pre-existing active
  `EPIC-001/` (which already held the split-off sibling), and left `doctor`
  clean afterward.
- **`--file` addressing** against the archived file's real path: resolved
  and unarchived correctly, same output shape as `--id`.
- **`exists`, file-vs-folder, under `type`**: pre-created an empty
  directory at the exact target file path before unarchiving; refused
  `exists` with "nothing was moved", confirmed nothing had in fact moved
  (the archive copy and the blocking directory were both still there
  afterward).
- **`STATUS.md` and `doctor`** after a normal round trip: `STATUS.md`
  correctly lists the unarchived element back under its status heading;
  `doctor --json` returns `{"ok":true,"problems":[]}`.

None of these surfaced a deviation from § 11a, from DECISIONS 104's rulings
(75/78–81), or from `archive`'s own established behaviour that `unarchive`
is built to mirror.

## 5. What I relied on AC-26 for, not re-derived

The three `NJ_FAULT` hook points (`before-compare` alone and racing a
parallel edit, `before-rename`, `after-tmp-write`), the crashed/resumed
unarchive, the full refusal-precedence matrix (`unreadable` →
`not_archived` → `parent_archived` → `misplaced` → `exists`, including both
of AC-26's two-condition cases), and the layout-switch matrix (all six
combinations named in DECISIONS 104 (75)) are exercised exhaustively there
and I did not find it productive to re-run them by hand beyond spot-
checking a few (the merge-with-strays and split-heal cases above extend
rather than duplicate that coverage). I did verify structurally — by
reading, not just trusting the AC-26 comment — that `requireNoStubs(ctx,
'unarchive')` runs unconditionally before `resolveTarget`, so "unreadable
wins over everything" is a code-level guarantee independent of which
target or combination of refusal conditions AC-26's own fixtures happen to
construct.
