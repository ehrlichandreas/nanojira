# Docs check — README.md, GUIDE.md, ARCHITECTURE.md vs. behaviour (`8b6bd81`/`aeceb10`)

Verifier, 2026-10-04. Proportionate docs check, read-only, assigned by
the Lead. Work in `/tmp/verifier-docs` (detached worktree at `aeceb10`)
and `/tmp/verifier-docs-probe`/`-probe2` (scratch backlogs). All removed
before writing this. Ran every command example GUIDE.md shows for the
sections new since v3 (§ 3, § 10–§ 16) against `dist/nj`/`dist/nj-mcp`
directly, byte for byte against the shown output; spot-checked
ARCHITECTURE.md's import counts mechanically against `src/`; ran
`npm test` for real (installed the build/test devDependencies myself,
network was available) to check README's own commands section.

**VERDICT: needs changes — ten mismatches found, none behavioral (`nj`
itself does what the spec says; these are all documentation-side
drift), listed below for the Oracle. Fixing nothing myself per the
task.**

## GUIDE.md

1. **`GUIDE.md:25-27`, § 1 (`nj init`)** — shown output is one line
   (`Created backlog at …/proj/backlog`); actual output has two more
   lines listing what was created (`epics/ tasks/ ...` and the file
   list). Not wrong, just incomplete — a reader comparing their own
   output to the guide's single line could wonder if something extra
   printed is a problem.

2. **`GUIDE.md:153-155`, § 4** — the first `nj set --id=TSK-001
   --description=... --acceptance=...` call shows no output line at all
   (the next two `set`/`note` calls in the same block correctly show
   theirs). Actual: `TSK-001 → description=(body section),
   acceptance=(body section)`. Inconsistent treatment within the same
   example block, not just an omission — the other three calls right
   below it do show their output.

3. **`GUIDE.md:360-363`, § 11 (`nj unarchive`)** — shows one line
   (`EPIC-001 unarchived → …`); actual, like `archive` in § 8 (which
   *does* correctly show both lines), produces a second line for the
   child: `TSK-001 unarchived → …/backlog/tasks/TSK-001.md`. § 8's own
   archive example gets this right for the identical subtree-move
   behaviour; § 11 doesn't carry the same care over to unarchive.

4. **`GUIDE.md:379`, § 12 (claim conflict)** — shown: `Error: TSK-001 is
   claimed by alice`. Actual, two lines:
   ```
   Error: TSK-001 is already claimed by alice — refused
   use --steal=<holder> to take it over
   ```
   Both the wording (`is claimed by` vs. the real `is already claimed
   by ... — refused`) and the entire second line (the `--steal` hint)
   are missing from the guide.

5. **`GUIDE.md:381`, § 12 (steal)** — shown: `TSK-001 claimed by bob
   (stolen from alice)`. Actual: `TSK-001 claimed by bob` — **no
   "(stolen from alice)" text is printed at all.** This is the most
   substantive finding in this file: the guide describes human-readable
   confirmation text that the command does not produce, for the one
   command (`--steal`) where that information would matter most to a
   human reading a terminal.

6. **`GUIDE.md:383`, § 12 (release)** — shown: `TSK-001 released`.
   Actual: `TSK-001 released by bob` — the guide's text is missing
   "by bob".

7. **`GUIDE.md:403-404`, § 13 (`nj check`)** — shown: `TSK-001: checked
   "- [x] 200 with a valid password"`. Actual: `TSK-001 checked` — no
   colon, no quoted checkbox text at all. The guide shows a
   considerably more detailed confirmation than the command actually
   prints.

8. **`GUIDE.md:420`, § 14 (`nj find`)** — shown: a bare `TSK-003
   Rate-limit the login route` line, nothing else. Actual (confirmed
   with a fixture built to match the example's own search term):
   ```
     TSK-002  todo     Rate-limit the login route  incomplete:acceptance
       We need rate limiting here.
   ```
   indentation, the status, every `_problems` code, and a context line
   from the matching body text are all present in the real output and
   entirely absent from the guide's example — this is the same
   human-output shape I already confirmed for `find` in the V3.2-C
   verification round (context line, problem codes), just not reflected
   back into this guide when that feature landed.

**Checked and found accurate, not listed as findings:** § 2 (backlog
search order, error text, `.njrc` strictness — all confirmed live); § 3
"Many projects on one machine" (matches § 4/§ 17 exactly, confirmed
against the same confinement behaviour I verified live in the V3.3
task); § 6 layout/doctor --fix example (byte-exact); § 7 `STATUS.md`
shape; § 9 doctor; § 10 `NJ_AUTHOR`/`--as` (both silent-on-success lines
are genuinely silent, confirmed); § 15 batch writes (the one `--json`
example shows no output, same as other `--json` examples elsewhere in
the guide that are explicitly abbreviated, e.g. § 2's `| head -2` — not
flagged, consistent convention); § 16 `nj-mcp` startup and the client-config
example — **both independently confirmed live**: `dist/nj-mcp
--backlog=./backlog` starts and answers `initialize`; the exact shape
shown in the JSON client-config block (`node /path/to/dist/nj-mcp
--backlog=/path/to/backlog`) is directly startable and answers both
`server/discover` and `initialize` correctly; the tool list shown
(13 names, `rm` absent, `doctor --fix` gated) matches live `tools/list`
output exactly, confirmed in an earlier round, re-confirmed here against
this exact text.

## ARCHITECTURE.md

9. **`ARCHITECTURE.md:177`** — "**`test/`, 62 files** derived only from
   `SPECIFICATION.md`". Actual count: **84** files
   (`test/ac` 34 + `test/edge` 43 + `test/fault` 6 + `test/stress` 1 —
   confirmed by direct `find`). Stale by a wide margin, not an
   off-by-one — this line isn't covered by `aeceb10`'s own "mechanical
   recount," which its commit message scopes to § 2's import-count
   table specifically, not this separate prose figure in § 5.

10. **`ARCHITECTURE.md:184`** — "the frozen **`c1-baseline`** tag".
    `git tag -l 'c*-baseline'` shows `c1-baseline` through `c7-baseline`
    all exist; **`c7-baseline`** is the current one (recorded after
    v3.2's acceptance, per D130/this session's own verification work).
    `c1-baseline` is the oldest, long-superseded tag — this reference is
    stale.

**Spot-checked § 2's "imported by" counts mechanically, matching the
exact method `aeceb10`'s own commit message describes** (grepping every
`from '....ts'` import line under `src/`, deduplicated per file): picked
four rows spanning different layers —

| Module | Doc's claim | My recount | Match |
|---|---|---|---|
| `core/constants.ts` | 14 modules (named list) | 14 | yes, exact set |
| `core/output.ts` | 24 modules | 24 | yes, exact set |
| `core/flag-table.ts` | `nj-mcp.ts` + 13 `cmd-*` (excl. init/rm/status) | 14 total, same 13 `cmd-*` excluded set | yes |
| `core/derive.ts` | 17 modules (context, output, status + 14×`cmd-*`) | 17, same breakdown | yes |

All four match exactly, both in total count and in the specific named
modules — the "mechanical recount" claim for § 2 holds up under an
independent recount, not just on the page's own say-so. This makes
findings 9–10 more notable by contrast: the recount was real and
careful for § 2, but didn't reach § 5's older prose figures in the same
file.

## README.md

Checked every concrete, checkable claim:

- **DECISIONS range "86–148"**: `docs/DECISIONS.md`'s highest numbered
  entry is 148 — matches exactly.
- **`npm test` "the oracle (`test/`) against `dist/nj` (and
  `dist/nj-mcp`)"**: ran it for real (`npm install --no-save` first,
  network was available in this session) — `81/83 passed, 0 failed, 2
  cannot-run` (the two usual environment gaps), confirmed the MCP
  suites (`ac-32-mcp*`, `ac-38-*`) are included via `test/lib/
  harness.js`'s auto-derived `NJ_MCP` (sibling of whatever `NJ` path is
  given) — accurate.
- **Layout block** (`src/nj.ts`/`src/nj-mcp.ts`/`src/commands/`/
  `src/core/`/`dist/nj`/`dist/nj-mcp`/`docs/`/`test/`/`tools/`): every
  named path exists and matches its one-line description.
- **`docs/MIGRATION-v3.md`, `docs/verification/`**: both exist, both
  contain what the surrounding sentence implies.

No mismatch found in README.md.

## Summary for the Oracle

Ten mismatches, all doc-side (nothing behavioral — every command itself
does exactly what SPECIFICATION.md says, confirmed live in every case):

| # | File:line | What's wrong |
|---|---|---|
| 1 | GUIDE.md:25-27 | `init` output shown incomplete (2 lines missing) |
| 2 | GUIDE.md:153-155 | one `set` call's output silently omitted, inconsistent with its neighbours |
| 3 | GUIDE.md:360-363 | `unarchive` output missing the child's line |
| 4 | GUIDE.md:379 | claim-conflict error text wrong, hint line missing |
| 5 | GUIDE.md:381 | steal output missing "(stolen from alice)" entirely |
| 6 | GUIDE.md:383 | release output missing "by bob" |
| 7 | GUIDE.md:403-404 | `check` output shown is not what the command prints |
| 8 | GUIDE.md:420 | `find` output missing status/problem codes/context line |
| 9 | ARCHITECTURE.md:177 | "62 files" stale, actual 84 |
| 10 | ARCHITECTURE.md:184 | "`c1-baseline`" stale, current tag is `c7-baseline` |

README.md: no mismatch found. ARCHITECTURE.md § 2's import-count table:
spot-checked 4 rows, all exact — the recount claim holds.

## Re-check — `b430f30`

Verifier, 2026-10-04. Same scope, read-only, assigned by the Lead:
re-check only the ten points above against `b430f30`. Work in `/tmp/
verifier-docs2` (detached worktree) and `/tmp/verifier-docs2-probe`
(scratch backlog, `NJ_NOW` pinned to the same two fixed timestamps the
oracle fixtures use, `2026-09-21T18:00:00Z`/`...19:30:00Z`). Both
removed before writing this.

**VERDICT: all 10 fixed, byte for byte. Accept.** Re-ran every example
in sequence, in one continuous scratch backlog mirroring the guide's own
narrative (same titles, same order), and diffed each command's actual
stdout against the new GUIDE.md/ARCHITECTURE.md text directly:

| # | Re-run result |
|---|---|
| 1 | `nj init` — the two added lines (`epics/ tasks/ ...` / `.nanojira/config.json ...`) match exactly. |
| 2 | The `set --description=...--acceptance=...` call now prints `TSK-001 → description=(body section), acceptance=(body section)` — matches the added line exactly. |
| 3 | `nj unarchive --id=EPIC-001` prints both lines, `EPIC-001 unarchived → …` and `TSK-001 unarchived → …` — matches exactly. |
| 4 | The claim conflict: `Error: TSK-001 is already claimed by alice — refused` + `use --steal=<holder> to take it over` — matches exactly, both lines. |
| 5 | `--steal` now shows `TSK-001 claimed by bob` with no holder name — matches exactly. Confirmed the new explanatory sentence ("does not name who it was stolen from... that's `stolen_from` in the `--json` result only") against a `--json` call in the same sequence: `stolen_from: "alice"` is indeed present there and nowhere in the human line — the added sentence is itself accurate, not just the example. |
| 6 | `release --as=bob` prints `TSK-001 released by bob` — matches exactly. |
| 7 | `check --on` prints `TSK-001 checked` — matches exactly. |
| 8 | `find "rate limiting"` — built the exact fixture the new example implies (a task titled "Rate-limit the login route" with body text "We need rate limiting here.") and got `  TSK-002  todo     Rate-limit the login route  incomplete:acceptance` plus the context line `    We need rate limiting here.` — matches exactly, including the two-space indent and the single trailing `_problems` code. |
| 9 | `find test/ac test/edge test/fault test/stress -name "*.js" \| wc -l` → **84**, split exactly `34`/`43`/`6`/`1` as the new text states. |
| 10 | `git tag -l 'c*-baseline' --sort=-creatordate` → `c7-baseline` is current — matches the corrected citation. |

No new mismatches introduced by the fix (checked the full diff, not
just the ten changed spots in isolation — e.g. confirmed the new
`--steal` explanatory sentence doesn't contradict § 9's own `--json`
shape table, and the `find` example's added sentence about the context
line matches what `find`'s own body-scan logic actually does, both
already independently verified in the V3.2-C round). All ten points in
`docs-v3-3.md`'s original table are closed.
