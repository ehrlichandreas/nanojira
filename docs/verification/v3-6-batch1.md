# V3.6 batch 1 verification — global flags, multi-line notes, `next`/assignee, leaf rule (`cd94258`, D158, AC-42..45)

Verifier, 2026-10-06. Independent verification, assigned by the Lead.
Work in `/tmp/verif-v36b1` (worktree at `cd94258`, built via `npm ci` +
`tools/bundle.js`), `/tmp/verif-v36b1-nested` (nested, `test/` swapped to
`oracle-frozen-12`, for the replay). Both removed before writing this.
Read: SPECIFICATION.md § 9 (global flags), § 10/§ 10a/§ 12c (multi-line
notes), § 12b (next/assignee), § 9 leaf rule, DECISIONS 158 (EV-6, EV-7,
PA-5, EV-4) in full, the full `cd94258` diff, `test/ac/ac-42-global-flags.js`,
`ac-43-multiline-notes.js`, `ac-44-next-assignee.js`, `ac-45-ready-leaf.js`
in full.

**VERDICT: pass.** All four mechanisms are implemented exactly as the
spec and AC files describe, confirmed by diff review, live reproduction,
and mutation testing. The byte-exact replay against `oracle-frozen-12`
shows exactly 195 differing calls (bare 102, `--json` 86, help 4,
`--help` 2, `--backlog=<SCRATCH>/store/bl` 1) — matching the Implementer's
reported tally exactly — and every one of them is confirmed to be either
the new leaf rule changing a `ready[]`/status-probe listing (189 calls,
all differing in `stdout` only, never exit code or `stderr`) or the HELP
text acquiring lines for commands/flags (`--version`, `log`, `next`)
that already existed in `cd94258` but postdate `oracle-frozen-12`'s
freeze point (6 calls). No call outside that classification was found.
One pre-existing test-coverage gap (not a defect in `cd94258`, carried
over from AC-42's own design) is noted below.

## 1. Diff review

**Global flags (EV-6).** `splitCommand` (`src/nj.ts:50-59`) scans `argv`
left to right; while a token starts with `--` and its name (stripped of
any `=value`) is in `GLOBAL_PREFIX_FLAGS = {backlog, json}`, the scan
continues; the first token that either doesn't start with `--` (the
command word) or is a `--` flag outside that set stops the scan. In the
command-word case, that token is excised from `argv` and the remainder
(global flags and everything after, in original relative order) is
reparsed as `rest`; in the stop-outside-the-set case, `cmd` is `null`
and `rest` is the *entire, unmodified* `argv` — so an invocation like
`nj --bogus list` is bare `nj` with its own (unrecognized) `--bogus`
flag, never partially-parsed into `list`. This matches AC-42 G1-G8
exactly, including repeated/mixed `--backlog`/`--json` (last one wins,
since `parseArgs` on `rest` just re-parses flags normally) and that no
command word is ever silently dropped. `--version` is checked against
the raw, pre-split `argv` (`nj.ts:70-79`) before `splitCommand` runs at
all, and only tolerates `--json` alongside it — confirmed unaffected by
EV-6's own flag-skipping, since `--version` is evaluated first.

**Multi-line notes (EV-7).** Confirmed via `ac-43` (read in full,
176 lines) that the write path normalises `\r\n`/`\r` to `\n`, writes
the first line inline and every subsequent line (including blank lines)
indented exactly two spaces; the read path (`noteLine`/`parseNotes`)
rejoins continuation lines, strips the two-space indent, and restores
blank lines as empty — exact round trip through `nj log --json`. `nj
check`'s scope is `## Acceptance` only, never `## Notes`, so a
checkbox-shaped continuation line is structurally unreachable regardless
of indentation (M5). A hand-added, non-two-space-indented,
non-note-starting line ends the continuation and is itself silently
skipped (M7) — confirmed in the parser, not merged into the note above.

**`next`/assignee (PA-5).** Confirmed the candidate filter in
`cmdNext` excludes any `--ready` leaf whose `assignee` is set and does
not byte-exactly equal the acting name (not even listed in `skipped`,
since it was never a candidate) — this is the same mechanism that
already excludes an element claimed by someone else. `--assignee=`
(empty) narrows to unassigned-only; `--assignee=<name>` narrows to
candidates already assigned to that name; combined with the
acting-name default, `--assignee=<anyone else>` is structurally
unsatisfiable unless the two names coincide, always yielding
`none_ready`. `list --ready` itself is untouched — it still surfaces
an element assigned to someone else; only `next`'s own candidate
filter changed. AC-44 A8 is exactly the team-a scenario quoted in
the task: an author's `next` never picks up a review explicitly
assigned to the reviewer, and the reviewer's own `next` does.

**Bare-`nj`/leaf rule (EV-4).** Confirmed `hasOpenChild(e)` (a child
that is neither `done` nor archived) now excludes a container element
from both `list --ready` and the bare/`--json` status probe's `ready[]`
— already established and unchanged from pre-compaction review of
`cmd-list.ts`/`cmd-status.ts`. AC-45 R1-R5 (read in full, 128 lines)
confirm the childless/done-child/archived-child/open-child matrix
exactly.

No defects found in any of the four mechanisms by diff review.

## 2. Live reproduction

Exercised, pre-compaction: `nj --backlog=X <every command>` for both
global-flag positions and both orders/repeats; unknown flags before the
command word (confirmed the whole bare-`nj` fallback, not partial
reparsing); `--version` combined with another flag and with a bare word
(both `unknown_field`); multi-line notes via `check`, `find`, `log`
(human and `--json`) including CRLF, lone CR, blank lines, and a note
written by a 3.5.0 build sitting next to one written by this build in
the same file (3.5.0's single-line notes parse unchanged; the 3.6
multi-line note round-trips); the team-a author/reviewer `next`
scenario and `--assignee` combined with the default filter; `list
--ready` confirmed byte-identical to the immediately-preceding commit
for backlogs with no open-child containers (the leaf rule only changes
output when such a container exists).

## 3. Mutation testing

Four mutations applied against the AC-42..45 suites (pre-compaction):
three were caught immediately (wrong exit code or wrong JSON shape).
One discrimination gap was found and is **not a product defect**:
AC-42 G5 uses a `--bogus` flag before the command word to exercise "an
unrecognized global-prefix-position flag stops the scan"; mutating
`splitCommand` so the scan never stops on an unrecognized flag (i.e.
treats `--bogus` as transparently skippable, same as `--backlog`/
`--json`) still produces `unknown_field`/exit 1 against this particular
fixture, by coincidence of the specific flags chosen after `--bogus` in
that fixture, not because the test actually checks that the scan
stopped where it should have. This is a test-coverage gap in G5's own
assertions, worth a follow-up AC addition, but does not indicate a
defect in `cd94258`'s `splitCommand`, which was independently confirmed
correct by the diff review in § 1 and by targeted live repro in § 2.

## 4. Sanity suite run (`run-all.js`) — 4 failures investigated, 0 are defects in `cd94258`

A full `run-all.js` run in `/tmp/verif-v36b1` (cd94258) showed 86/92
passed, 4 failed, 2 cannot-run (the usual environment-conditional
suites). Each failure was individually traced via `git log`/`git
merge-base` rather than assumed benign:

- **`ac/ac-46-per-command-help.js`**, **`ac/ac-47-did-you-mean.js`** —
  both exercise per-command `--help`/did-you-mean, a feature added in
  commit `6d9964e` ("TSK-047: per-command --help, allowed values,
  did-you-mean"), which does not exist yet in `cd94258`. Confirmed via
  `git merge-base --is-ancestor cd94258 6d9964e` → true: `cd94258`
  chronologically precedes `6d9964e`. These are pre-written red tests
  for a not-yet-landed feature, per this project's own convention
  ("written before the fix lands"), not a regression in `cd94258`.
- **`edge/doctor-fix-surface.js`** — its fixture's `ready[]` assertion
  predates the leaf rule (it expected `EPIC-001` in `ready[]` despite
  `EPIC-001` having an open child, `TSK-009`). Confirmed stale, and
  confirmed already fixed downstream by commit `148697c` ("Fix AC-40
  N3 (stale vs PA-5) + make test fixtures immune to an ancestor
  backlog") via `git log --oneline cd94258..62777f9 -- test/edge/
  doctor-fix-surface.js`.
- **`ac/ac-40-next.js` (N3)** — asserted `--assignee=carol` with
  `--as=alice` would still hand out an element pre-assigned to carol
  (pre-PA-5 behaviour). Under PA-5 this is structurally `none_ready`
  (§ 1 above). Also already fixed by the same `148697c` commit.

All four are accounted for; none is evidence of a defect introduced by
`cd94258` itself. This is included here as due-diligence evidence, not
as a finding against the commit.

## 5. Replay vs `oracle-frozen-12`

Nested worktree at `cd94258`, `test/` swapped to the `oracle-frozen-12`
tag, digest confirmed matching current/pinned before running `verify`.
Run with `TMPDIR` pointed at a dedicated clean directory with no
`backlog/` anywhere in its ancestor chain (the default `$TMPDIR` on
this machine has a real `backlog/` as an ancestor, which corrupts
`findBacklog`'s upward search — unrelated to `cd94258`, a harness/
environment issue the Oracle is fixing separately; not committed here).

```
baseline: 7086 calls, nj sha256 4444cd04fd23...
current : 7086 calls, current code sha256 (nj, 1 files) 786e8bc9...
compared: 6463 calls (623 excluded as nondeterministic by design — concurrency)

RED VERDICTS (1):
  oracle suite failed: edge/doctor-fix-surface.js   (§ 4 above — pre-existing, already fixed downstream)

BEHAVIOUR CHANGED — 195 differing call(s): (bare) 102, --json 86, help 4, --help 2, --backlog=<SCRATCH>/store/bl 1
```

This matches the Implementer's reported tally exactly (195 total, same
per-class breakdown). All 195 entries were inspected (detail cap raised
locally and uncommitted in this worktree's own `baseline.js`, per the
task's instructions — never committed, since the Oracle is fixing the
harness's default cap separately):

- **189 bare/`--json` calls** — every one differs in `stdout` only
  (confirmed via `grep -c "differs in: stdout"` = 195 = the full count;
  no call differs in exit code or `stderr`). Each diff is the `ready[]`
  (or human `Ready to work:`) listing losing exactly the container
  element(s) that have an open child, consistent with the leaf rule —
  e.g. `#177`/`#178` (`set-acc:prose>probe:status`): `TSK-001` drops out
  of `Ready to work:` once a `SUB`-child under it is incomplete;
  `#3522`-`#3525` (`ac-22-layout.js`): `EPIC-001` and `TSK-001` (both
  containers with an open descendant) drop out, leaving only the true
  leaf `SUB-001`.
- **The named `--backlog=<SCRATCH>/store/bl --json` call** (`#3241`,
  from `ac-21-backlog-location.js`): `EPIC-001` drops out of `ready[]`,
  leaving only `TSK-001` — the same leaf rule, confirmed by inspecting
  the full JSON diff (identical in every field except the missing
  `EPIC-001` entry).
- **6 help calls** (`nj help`, `nj help --json`, `nj --help`, each
  appearing twice across two fixtures): the HELP text in `cd94258`
  includes a `--version` line and `nj log`/`nj next` usage lines that
  `oracle-frozen-12`'s frozen baseline (predating those features) does
  not have. These features (`--version`, `log`, `next`) already exist
  in `cd94258` — landed in earlier, already-verified batches — so this
  is expected baseline drift in the HELP text, not something `cd94258`
  changed about help itself.

Every one of the 195 differing calls is accounted for by the leaf rule
or by already-landed-and-verified HELP content; none indicates a
regression introduced by `cd94258`.

## 6. Dogfooding

TSK-044, TSK-045, TSK-046 claimed as a batch (`--as=Verifier`),
completion notes added, "verification" acceptance criterion checked,
released. Friction (the AC-42 G5 discrimination gap, § 3) logged on
TSK-043 as instructed.
