# v3 coverage map

Every normative sentence that spec v3 added or changed (`docs/SPECIFICATION.md`,
3276eeb → HEAD: § 4, § 5, § 7, § 8, § 9, § 11, § 12, § 14, § 15 AC-17/18/21–24),
plus every ruling bullet of DECISIONS 88–101, mapped to the check(s) that
assert it. Owner: Oracle-B. Produced for the lead's coverage audit
(2026-09-28).

**How it was made.** Each check label here is quoted exactly as it ran: every
suite of the committed `test/` was run against c3-baseline (`a10b671`) with a
preload that logs every `T.check` label, pass or fail (5 375 distinct
labels). Clauses were then matched to labels by reading the test source around
each label, not by keyword. A label that fails today is still coverage: the
suites are written before their step lands.

**Status values.**
- `COVERED`: some check asserts the clause.
- `PARTIAL`: some parts are asserted; the missing part is named.
- `UNTESTED`: nothing asserts it.
- `COVERED (gap closed)`: was PARTIAL/UNTESTED; the check that closes it is
  named.
- `testable: no` means untestable black-box, and the reason is given.

`stress/` checks run in a child process and are quoted from source, marked
"(source)".

## Summary

| | Clauses |
|---|---|
| total | 145 |
| covered by existing checks | 111 |
| gaps, testable | 29 (closed so far: 29) |
| gaps, not testable black-box | 5 |

How the 29 gaps were closed: 22 by `edge/coverage-v3-gaps.js`, 1 in `ac/ac-24-legacy-migration.js`, 4 by the Oracle in its V3-3 batch (5e22caa, f847d11), and 2 by the V3-4 test batch (`/tmp/nj-v34-batch.patch`), which is prepared but not yet committed; they are open until it lands.

**Not testable:** S03, B17, R13, A07, Z01 (reasons in the rows).

## Clauses

### § 4 layout

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| L01 | init creates the v3 tree: README.md, STATUS.md, .gitignore, epics/ tasks/ subtasks/ archive/, .nanojira/config.json, .nanojira/ids/ | COVERED | ac-01-basic-run.js: "init creates backlog/README.md"; ac-01-basic-run.js: "init creates backlog/.ids/"; ac-23-status-overview.js: "C1 after init, STATUS.md lists every configured status, empty (golden/status-init.md)" |
| L02 | legacy layout (.nanojira.json/.ids/ top level): every command except doctor refuses with legacy_layout and points at `nj doctor --fix` | COVERED | ac-24-legacy-migration.js: "L1 set on a v2 backlog (search) --json: error is legacy_layout"; ac-24-legacy-migration.js: "L1 set on a v2 backlog (search): stderr points at `nj doctor --fix` (§ 4)" |
| L03 | group `type` (default): one folder per type | COVERED | ac-22-layout.js: "B1 [type, no layout block (v2 behaviour)] new puts epic, task and subtask at their places"; ac-22-layout.js: "B1 [type, renamed folders] archive moves the subtree to its archive places (§ 11)" |
| L04 | group `hierarchy`: epic and task get a folder named after their ID holding their own file; subtask is a file in its task's folder | COVERED | ac-22-layout.js: "B1 [hierarchy] new puts epic, task and subtask at their places"; ac-22-layout.js: "B5 [hierarchy, task without parent] fixture: at the top of the tree" |
| L05 | group `flat`: every element file directly in <backlog>/ | COVERED | ac-22-layout.js: "B1 [flat] new puts epic, task and subtask at their places" |
| L06 | nj never infers type or parent from where a file lies | COVERED | ac-22-layout.js: "B4 [hierarchy, hand-edited parent] TSK-002 reports the new parent"; ac-22-layout.js: "B6 [type, v2, undeterminable type] the file is read and carries type:folder" |
| L07 | element files are every *.md below the backlog except README.md, STATUS.md, anything under .nanojira/ | COVERED | ac-22-layout.js: "B6 [type] a *.md in a stray subfolder is read as an element"; ac-22-layout.js: "B6 [exclusions] a *.md under .nanojira/ is not an element"; ac-23-status-overview.js: "C2 STATUS.md is never read as an element (§ 4)" |
| L08 | an element is archived exactly when it lies below the archive folder | COVERED | ac-22-layout.js: "B6 [archived by location] a file below archive/ is hidden from list"; ac-22-layout.js: "B6 [archived: at an active place] it is active — listed without --all" |
| L09 | misplaced file carries type:folder (group type) / layout:misplaced (hierarchy, flat) | COVERED | ac-22-layout.js: "B3 [type, v2: task in the subtasks folder] reports type:folder"; ac-22-layout.js: "B3 [type → flat] TSK-001 (moved by the change) reports layout:misplaced"; ac-22-layout.js: "B4 [hierarchy, hand-edited parent] TSK-002 reports layout:misplaced" |
| L10 | a misplaced file still loads and every command still works on it | COVERED (gap closed) | ac-22-layout.js: "B3 [type → hierarchy] show keeps working"; ac-22-layout.js: "B3 [type → hierarchy] set keeps working"; ac-22-layout.js: "B3 [type → hierarchy] tree keeps working"; coverage-v3-gaps.js: "L10 [type, hand-moved] archive: both files are in the archive folder"; coverage-v3-gaps.js: "L10 [type, hand-moved] rm --cascade: no element file is left"; coverage-v3-gaps.js: "L10/W01 [flat after a group change] rm removed its file" |
| L11 | `nj set` has no --parent (unknown_field) | COVERED (gap closed) | coverage-v3-gaps.js: "L11 set --parent: unknown_field"; coverage-v3-gaps.js: "L11 set --parent: the file is unchanged" |
| L12 | changing layout is allowed any time; afterwards every element (whose place changes, D97 61) reports its old place; one doctor --fix moves the backlog into the new layout | COVERED | ac-22-layout.js: "B3 [type → hierarchy] TSK-001 (moved by the change) reports layout:misplaced"; ac-22-layout.js: "B3 [type → hierarchy] one doctor --fix: exit 0"; ac-22-layout.js: "B3 [type → hierarchy] --fix moved everything to the new layout" |
| L13 | .gitignore written by init contains exactly .nanojira/index.json and .nj-tmp-* | COVERED | ac-01-basic-run.js: "gitignore ignores exactly the two patterns" |
| L14 | .nanojira/ids/ is never ignored | COVERED | ac-01-basic-run.js: ".ids/ is never ignored" |

### § 4 STATUS.md

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| S01 | STATUS.md written by nj init | COVERED | ac-23-status-overview.js: "C1 after init, STATUS.md lists every configured status, empty (golden/status-init.md)" |
| S02 | STATUS.md rewritten after every successful new, set, note, rm, archive, doctor --fix | COVERED | ac-23-status-overview.js: "C2 after rm, STATUS.md matches the state"; ac-23-status-overview.js: "C4 STATUS.md with problem elements (golden/status-problems.md)"; ac-23-status-overview.js: "C5 [deleted] doctor --fix restores it byte-identically" |
| S03 | written atomically (temp, fsync, rename; § 12) — no temp left behind | PARTIAL | ac-23-status-overview.js: "C2 no temp file is left in the backlog root (atomic write, § 12)" \| missing: an interrupted overview write leaves old-or-new bytes \| testable: no (no NJ_FAULT hook targets the overview write; § 12 lists three points, none for STATUS.md) |
| S04 | never read by nj (a hand-edited STATUS.md changes no command's output) | COVERED (gap closed) | ac-23-status-overview.js: "C2 STATUS.md is never read as an element (§ 4)"; coverage-v3-gaps.js: "S04 a hand-edited STATUS.md changes no read command's output (human and --json)"; coverage-v3-gaps.js: "S04 reads leave the hand-edited STATUS.md alone" |
| S05 | one `## <status> (<count>)` section per configured status, in config order, present even when empty | COVERED | ac-23-status-overview.js: "C1 after init, STATUS.md lists every configured status, empty (golden/status-init.md)"; ac-23-status-overview.js: "C0 renderer = golden status-init.md" |
| S06 | unconfigured statuses in a last `## ? (<count>)` section, only when non-empty | COVERED | ac-23-status-overview.js: "C3 [type] STATUS.md (golden/status-group-type.md)" |
| S07 | within a section: list order (priority desc, id asc); unknown priority sorts with default weight (D100 70) | COVERED (gap closed) | ac-23-status-overview.js: "C3 [type] STATUS.md (golden/status-group-type.md)"; ac-23-status-overview.js: "C2 after set --status=done (golden/status-sequence-done.md)"; ac-23-status-overview.js C3b (Oracle, 5e22caa); list order for an unknown priority: ac-23-status-overview.js block AC-14 (Oracle) |
| S08 | link = path relative to backlog with / separators; title as stored | COVERED | ac-23-status-overview.js: "C3 [hierarchy] STATUS.md (golden/status-group-hierarchy.md)"; ac-23-status-overview.js: "C3 [renamed] STATUS.md (golden/status-group-renamed.md)" |
| S09 | archived elements not listed | COVERED | ac-23-status-overview.js: "C2 after archive — archived elements are left out (golden/status-sequence-archived.md)" |
| S10 | every line ends \n, one empty line between sections, file ends in exactly one \n | COVERED | ac-23-status-overview.js: "C1 after init, STATUS.md lists every configured status, empty (golden/status-init.md)"; ac-23-status-overview.js: "C0 renderer = golden status-problems.md" |
| S11 | doctor compares with fresh rendering: backlog:status_stale (warning, exit 0) for hand-edited or missing file; --fix regenerates (incl. merge conflict) | COVERED | ac-23-status-overview.js: "C5 [hand-edited] doctor reports exactly backlog:status_stale"; ac-23-status-overview.js: "C5 [deleted] doctor: exit 0 — a warning"; ac-23-status-overview.js: "C5 [merge-conflicted] doctor --fix restores it byte-identically" |
| S12 | failed overview never fails the write: exit code kept, stderr `Warning: STATUS.md not updated (<reason>)` (D99) | COVERED | ac-23-status-overview.js: "C7 [STATUS.md is a non-empty directory] set: the exit code is unchanged (0)"; ac-23-status-overview.js: "C7 [the backlog root is read-only] new: stderr carries "Warning: STATUS.md not updated (<reason>)"" |
| S13 | under --json the result object is unchanged when the overview fails (D95 B19) | COVERED | ac-23-status-overview.js: "C7 [STATUS.md is a non-empty directory] set: the --json result is unchanged" |
| S14 | doctor --fix keeps the exit code its findings give when the overview fails (D95 B19) | COVERED (gap closed) | ac-23-status-overview.js: "C7 [STATUS.md is a non-empty directory] doctor --fix: exit 0 — its only finding is a warning"; coverage-v3-gaps.js: "S14 doctor --fix with a surviving error and an unwritable STATUS.md: exit 2"; coverage-v3-gaps.js: "S14 … and it prints the § 4 warning" |
| S15 | the next doctor reports backlog:status_stale after a failed overview | COVERED | ac-23-status-overview.js: "C7 [STATUS.md is a non-empty directory] the next doctor reports backlog:status_stale" |
| S16 | problem elements: missing:status under statuses[0]; file:unreadable stub under `?` (D95 B18) | COVERED | ac-23-status-overview.js: "C4 STATUS.md with problem elements (golden/status-problems.md)" |
| S17 | no title → `- [<ID>](<path>)` with no trailing space | COVERED | ac-23-status-overview.js: "C4 STATUS.md with problem elements (golden/status-problems.md)" |
| S18 | both files of a duplicate_id listed, ordered by path after list order | COVERED | ac-23-status-overview.js: "C4 STATUS.md with problem elements (golden/status-problems.md)" |
| S19 | statusFile:false: nothing written, doctor does not check, an existing file is left alone | COVERED | ac-23-status-overview.js: "C6 statusFile false: new creates no STATUS.md"; ac-23-status-overview.js: "C6 statusFile false: doctor does not check an existing, stale STATUS.md"; ac-23-status-overview.js: "C6 statusFile false: set leaves an existing STATUS.md alone" |
| S20 | concurrency: after the AC-7 run no error finding; status_stale is the one tolerated warning (D100) | COVERED (gap closed) | concurrency.js: "doctor --json ok=true" (source); stress/concurrency.js: every finding after the AC-7 run is backlog:status_stale:warning (Oracle, 5e22caa) |
| S21 | no overview check (and no STATUS.md write) while config:invalid holds (D100) | COVERED | ac-17-configuration.js: "--fix on an invalid config writes nothing (invalid statuses)"; exit-doctor-fix.js: "invalid config survives (error, exit 2) — findings after --fix are exactly § 7's remaining set" |
| S22 | doctor --fix reports the regeneration in fixed[] only when the file was stale or missing (D100) | COVERED | exit-doctor-fix.js: one biconditional fixed[]/STATUS.md check per scenario (Oracle, f847d11; D100 as amended in e242c60); Verifier finding T1 (docs/verification/v3-3-test-batch.md): that check derives its expectation from the observed bytes and has no failing leg for a nj that moves/renames a file but skips regenerating STATUS.md — closed by ac-23-status-overview.js C8 (Oracle, fdb1f1e), which asserts the OUTCOME directly: after --fix, STATUS.md equals H.statusFor with the NEW paths, fixed[] ends with the STATUS.md entry, and the next doctor has no status_stale, for a step-2 rename, a step-3 move, and a layout change + --fix |

### § 4 init

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| I01 | init targets --backlog, NJ_BACKLOG, nearest .njrc in that order; without any, ./backlog | COVERED | ac-21-backlog-location.js: "A9 init --backlog over NJ_BACKLOG: the target now holds a backlog"; ac-21-backlog-location.js: "A9 init NJ_BACKLOG over .njrc: the target now holds a backlog"; ac-21-backlog-location.js: "A9 init without any source creates ./backlog: the target now holds a backlog" |
| I02 | init never uses the upward backlog/ search, not even a nearer backlog/ (D89 52) | COVERED | ac-21-backlog-location.js: "A9 init ignores a backlog/ further up and creates ./backlog: the target now holds a backlog"; ac-21-backlog-location.js: "A9 init uses the nearest .njrc even past a nearer backlog/: the target now holds a backlog" |
| I03 | init refuses with exists if anything exists at the target, even an empty dir (D89 55); a v2 backlog too (D101 72) | COVERED | ac-21-backlog-location.js: "A9 init --backlog at an existing empty directory: exists"; ac-21-backlog-location.js: "A9 init --backlog at an existing backlog: exists"; ac-24-legacy-migration.js: "L1 init where a v2 backlog is --json: error is exists (DECISIONS 101)" |

### § 4 location

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| B01 | --backlog accepted by every command, relative to cwd | COVERED | ac-21-backlog-location.js: "A1 relative --backlog resolves against the working directory: reads the backlog holding TSK-001"; ac-21-backlog-location.js: "A1 new --backlog: accepted, not unknown_field (§ 9, DECISIONS 88)" |
| B02 | NJ_BACKLOG relative to cwd | COVERED | ac-21-backlog-location.js: "A2 NJ_BACKLOG relative resolves against the working directory: reads the backlog holding TSK-002" |
| B03 | upward search to / : in each dir a .njrc that sets backlog, then backlog/ | COVERED | ac-21-backlog-location.js: "A3 .njrc in an ancestor, relative value against the .njrc's own directory: reads the backlog holding TSK-004"; ac-21-backlog-location.js: "AC-12 list from a nested subdirectory finds the backlog (walk upward)" |
| B04 | relative .njrc value resolves against the .njrc's directory | COVERED | ac-21-backlog-location.js: "A3 .njrc in an ancestor, relative value against the .njrc's own directory: reads the backlog holding TSK-004" |
| B05 | nearest directory wins; .njrc beats backlog/ in the same directory | COVERED | ac-21-backlog-location.js: "A5 the nearer of two .njrc wins: reads the backlog holding TSK-022"; ac-21-backlog-location.js: "A5 .njrc beats backlog/ in the same ancestor directory: reads the backlog holding TSK-021" |
| B06 | nothing found: exit 1 no_backlog | COVERED | discovery-message.js: "the absent case is reported as no_backlog"; ac-21-backlog-location.js: "AC-12 list from an unrelated directory is a hard error (exit 1)", "AC-12 the hard error from an unrelated directory is no_backlog (§ 9)" |
| B07 | a chosen source is binding: exit 1, `no backlog at <abs> (from <source>)`, invalid_backlog_flag/env/njrc, never falls through | COVERED | ac-21-backlog-location.js: "A6 --backlog at a missing path (env and search would succeed) --json: error is invalid_backlog_flag"; ac-21-backlog-location.js: "A6 .njrc in an ancestor at nothing (a backlog/ further up would succeed) --json: error is invalid_backlo…" |
| B08 | "holds a backlog" = .nanojira/config.json exists (target a regular file / dir without marker → invalid_backlog_*, D88) | COVERED | ac-21-backlog-location.js: "A6 --backlog at a regular file --json: error is invalid_backlog_flag"; ac-21-backlog-location.js: "A6 NJ_BACKLOG at an existing empty directory --json: error is invalid_backlog_env" |
| B09 | .nanojira/ without config.json, or a search-found backlog/ with neither → backlog_without_config, says so, points at nj doctor | COVERED (gap closed) | discovery-message.js: "the config-less backlog is reported as backlog_without_config"; discovery-message.js: "the error points at nj doctor"; coverage-v3-gaps.js: "B09 .nanojira/ without config.json via the search: backlog_without_config"; coverage-v3-gaps.js: "B09 .nanojira/ without config.json via --backlog: backlog_without_config"; coverage-v3-gaps.js: "B09 … the error points at nj doctor" |
| B10 | legacy .nanojira.json → legacy_layout pointing at doctor --fix, from every source (D101 71) | COVERED | ac-24-legacy-migration.js: "L1 list --backlog=<v2 backlog> --json: error is legacy_layout"; ac-24-legacy-migration.js: "L1 NJ_BACKLOG=<v2 backlog> list --json: error is legacy_layout" |
| B11 | prose prefix is `Error: ` (D88) | COVERED (gap closed) | ac-21-backlog-location.js: "A6 --backlog at a regular file: stderr carries "Error: no backlog at <abs path> (from <source>)" (§ 4, DECIS…"; coverage-v3-gaps.js: "B11 no_backlog: the prose starts with "Error: ""; coverage-v3-gaps.js: "B11 legacy_layout: the prose starts with "Error: ""; coverage-v3-gaps.js: "B11 io_error: the prose starts with "Error: "" |
| B12 | nearest wins strictly: a config-less nearest backlog/ ends the search → backlog_without_config (D88) | COVERED | ac-21-backlog-location.js: "A5 a nearer config-less backlog/ over a valid backlog/ further up: backlog_without_config" |
| B13 | --backlog appears in every "Known flags:" line; not in new/set "Known fields:" (D88) | COVERED (gap closed) | ac-21-backlog-location.js: "A1 nj list: --backlog is in its list of known flags (§ 9)"; ac-21-backlog-location.js: "A1 bare nj: --backlog is in its list of known flags (§ 9)"; coverage-v3-gaps.js: "B13 new: the "Known fields:" line does not list --backlog"; coverage-v3-gaps.js: "B13 set: the "Known fields:" line does not list --backlog" |
| B14 | nj help gains one --backlog line (D88, § 9 command list) | COVERED (gap closed) | coverage-v3-gaps.js: "B14 nj help: exactly one line names --backlog"; coverage-v3-gaps.js: "B14 nj --help: exactly one line names --backlog" |
| B15 | --backlog= empty → missing_value; NJ_BACKLOG= empty counts as unset; ~/ expanded only inside .njrc (D89 53) | COVERED | ac-21-backlog-location.js: "A1 --backlog= (empty): missing_value, not the backlog/ beside it"; ac-21-backlog-location.js: "A2 empty NJ_BACKLOG counts as unset: the search finds backlog/: reads the backlog holding TSK-093"; ac-21-backlog-location.js: "A1 --backlog=~/… is literal, relative to the working directory: reads the backlog holding TSK-091" |
| B16 | doctor accepts any existing directory from any source (D88) | COVERED | hardening-v3-1.js: "F3 doctor --fix --backlog=<project dir>: plain doctor exit 2"; hardening-v3-1.js: "F3 NJ_BACKLOG=<project dir> doctor --fix: plain doctor exit 2" |
| B17 | a repeated --backlog: last wins; relative --backlog vs physical cwd (D93 F6/F7: kept, not pinned) | UNTESTED | D93 F6/F7: v2 behaviour "kept, not pinned" — the suite asserts no unpinned value \| testable: no (by ruling) |

### § 4 .njrc

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| R01 | one key = value per line; whitespace around = and at line ends ignored | COVERED | ac-21-backlog-location.js: "A3 .njrc whitespace, blank and comment lines are ignored: reads the backlog holding TSK-008" |
| R02 | empty lines and whole-line # comments ignored | COVERED | ac-21-backlog-location.js: "A8 comment-only .njrc: the search continues upward: reads the backlog holding TSK-051" |
| R03 | value literal (no quotes/variables); leading ~/ expands to home | COVERED (gap closed) | ac-21-backlog-location.js: "A3 .njrc value is literal — quotes are not stripped: reads the backlog holding TSK-007"; ac-21-backlog-location.js: "A3 .njrc value with leading ~/ expands to the home directory: reads the backlog holding TSK-006"; coverage-v3-gaps.js: "R03 "$HOME/bl" is a literal folder name, not the home directory"; coverage-v3-gaps.js: "R03 "${VAR}/bl" is literal"; coverage-v3-gaps.js: "R03 a "~/" that is not leading is literal" |
| R04 | UTF-8 BOM at the very start dropped; a BOM anywhere else is ordinary (D96) | COVERED | ac-21-backlog-location.js: "A7b a UTF-8 BOM at the start is dropped: reads the backlog holding TSK-071"; hardening-v3-1.js: "D96 a BOM at the start of line 2: the key "﻿backlog" is unknown --json: error is invalid_njrc" |
| R05 | trailing \r is line-end whitespace (CRLF works); a \r not followed by \n → invalid_njrc, also as last byte, line = line holding it, counted by \n (D96, D98) | COVERED | ac-21-backlog-location.js: "A7b CRLF line ends work: reads the backlog holding TSK-072"; hardening-v3-1.js: "D98 a "\r" as the last byte of the file --json: error is invalid_njrc"; hardening-v3-1.js: "D98 a lone "\r" on line 3 (lines counted by "\n"): the line number" (runs once the message form matches) |
| R06 | a line splits at its first = | COVERED | ac-21-backlog-location.js: "A7b a line splits at its first "=" — the value may contain "=": reads the backlog holding TSK-073" |
| R07 | keys are case-sensitive | COVERED | ac-21-backlog-location.js: "A7b keys are case-sensitive: Backlog is an unknown key --json: error is invalid_njrc" |
| R08 | # after the first non-blank char is part of the value | COVERED | ac-21-backlog-location.js: "A7b an inline "#" is part of the value: reads the backlog holding TSK-074" |
| R09 | not a readable regular file (directory, dangling symlink, no read permission, FIFO, ELOOP with own reason) → invalid_njrc, no line number (D90, D96) | COVERED | ac-21-backlog-location.js: "A7b a .njrc that is a dangling symlink: no line number"; hardening-v3-1.js: "D96 a FIFO .njrc --json: error is invalid_njrc"; hardening-v3-1.js: "D96 a .njrc symlinked to itself: the reason names the loop (ELOOP / symlink loop / too many levels of…" |
| R10 | symlinked .njrc resolves a relative value against the link's directory | COVERED | ac-21-backlog-location.js: "A7b a symlinked .njrc resolves against the link's directory: reads the backlog holding TSK-079" |
| R11 | ~/.njrc has no special role: read only when home is on the search path | COVERED | ac-21-backlog-location.js: "A3 a ~/.njrc outside the search path is not read: no_backlog"; ac-21-backlog-location.js: "A7b ~/.njrc is read like any ancestor when HOME is on the search path: reads the backlog holding TSK-080" |
| R12 | ownership: reached .njrc must be owned by user or root, else invalid_njrc `owned by uid <n>, not by you`, never skipped/obeyed (D93 F1) | COVERED | hardening-v3-1.js: "F1 list, foreign .njrc in the cwd: stderr carries "Error: invalid .njrc at <abs path>: owned by uid <n>, not …"; hardening-v3-1.js: "F1 the search does not fall through to the outer backlog"; hardening-v3-1.js: "F1 root-owned .njrc: list exit 0" |
| R13 | symlinked .njrc: link and target must both pass (D98 63) | PARTIAL | hardening-v3-1.js: "D98 my symlink → a foreign-owned file, list --json: error is invalid_njrc"; hardening-v3-1.js: "D98 my symlink → a foreign-owned directory (ownership before "not a regular file"), list --json: error…" \| missing: a foreign-owned symlink → own target — in hardening-njrc-foreign-link.js, CANNOT RUN here \| testable: no (needs root, or a foreign symlink and a non-following link(2)) |
| R14 | ownership checked before reading, ahead of every other fault (D98 65) | COVERED | hardening-v3-1.js: "D98 a foreign-owned AND malformed .njrc: the ownership message, not "line <n>": no "line <n>:" in the message"; hardening-v3-1.js: "D98 a foreign-owned AND unreadable .njrc: the ownership message, not a read error: stderr carries "Err…" |
| R15 | --backlog / NJ_BACKLOG stop the search first and bypass the ownership check | COVERED | hardening-v3-1.js: "F1 --backlog bypasses the check: reads the flagged backlog"; hardening-v3-1.js: "F1 NJ_BACKLOG bypasses the check: reads that backlog" |
| R16 | known key backlog; a .njrc without backlog lets the search continue | COVERED | ac-21-backlog-location.js: "A8 .njrc without backlog beside backlog/: backlog/ is used: reads the backlog holding TSK-052"; ac-21-backlog-location.js: "A8 empty .njrc: the search continues upward: reads the backlog holding TSK-051" |
| R17 | unknown key, line without =, empty value, repeated key → invalid_njrc `line <n>: <reason>` | COVERED | ac-21-backlog-location.js: "A7 .njrc unknown key (in cwd): the line number"; ac-21-backlog-location.js: "A7 .njrc line without "=" (in cwd): the line number"; ac-21-backlog-location.js: "A7 .njrc empty value (in cwd): the line number" |
| R18 | repeated key reports the repetition's line; empty key is an unknown key (D89 50, 51) | COVERED | ac-21-backlog-location.js: "A7 .njrc repeated key (in cwd): the line number"; ac-21-backlog-location.js: "A7 .njrc empty key (in cwd): the line number" |
| R19 | only a reached .njrc is parsed; --backlog/NJ_BACKLOG searches never read one | COVERED | ac-21-backlog-location.js: "A7 NJ_BACKLOG stops the search: a malformed .njrc in cwd is never read: reads the backlog holding TSK-041"; ac-21-backlog-location.js: "A7 --backlog stops the search: a malformed .njrc in cwd is never read: reads the backlog holding TSK-041" |

### § 5 configuration

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| C01 | configuration at .nanojira/config.json; init writes the full layout block (D92 Q1) | COVERED (gap closed) | ac-01-basic-run.js: "init creates backlog/.nanojira.json"; V3-4 batch (/tmp/nj-v34-batch.patch, not yet committed): ac-01 "config carries the full § 5 layout block"; lands with V3-4 (DECISIONS 92 Q1) |
| C02 | layout optional; missing layout or key = default; a config without layout behaves exactly like the defaults (AC-17) | COVERED | ac-17-configuration.js: "layout: list answers the same with and without the default layout block"; ac-17-configuration.js: "layout: a valid layout block is accepted by list (empty layout block)" |
| C03 | layout.group ∈ type \| hierarchy \| flat | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (group is not type, hierarchy or flat)" |
| C04 | layout.folders: only the four keys, any subset, missing one = default (D97 56) | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (unknown key inside layout.folders)"; ac-17-configuration.js: "layout: a valid layout block is accepted by list (a folders subset (archive only))"; ac-22-layout.js: "B1 [type, folders subset (tasks only)] new puts epic, task and subtask at their places" |
| C05 | folder name matches [A-Za-z0-9][A-Za-z0-9_-]* | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (folder name with a space)"; ac-17-configuration.js: "layout: list fails with exit 1 (folder name starting with a dash)"; ac-17-configuration.js: "layout: list fails with exit 1 (folder name with a path separator)" |
| C06 | folder names pairwise distinct (effective names, case-insensitive; D91 B14, D97) | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (duplicate folder names)"; ac-17-configuration.js: "layout: list fails with exit 1 (duplicate folder names differing only in case)"; ac-17-configuration.js: "layout: list fails with exit 1 (a folders subset colliding with a default name)" |
| C07 | no folder name of the form EPIC-<n>/TSK-<n>/SUB-<n> (case-insensitive, D91 B14) | COVERED (gap closed) | ac-17-configuration.js: "layout: list fails with exit 1 (folder name of the form TSK-<n>)"; ac-17-configuration.js: "layout: list fails with exit 1 (folder name of the form EPIC-<n>)"; coverage-v3-gaps.js: "C07 a folder name of the form SUB-<n>: invalid_config"; coverage-v3-gaps.js: "C07 a folder name of the form sub-<n> in lower case: invalid_config" |
| C08 | `backlog` forbidden as a folder name, case-insensitive (D91 B13) | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (folder name backlog)"; ac-17-configuration.js: "layout: list fails with exit 1 (folder name Backlog (case-insensitive))" |
| C09 | under hierarchy/flat only archive is used, the other three still validated | COVERED (gap closed) | ac-17-configuration.js: "layout: list fails with exit 1 (invalid folder name under flat (still validated))"; coverage-v3-gaps.js: "C09 [flat, renamed epics/tasks/subtasks] new puts every element at its flat place"; coverage-v3-gaps.js: "C09 [hierarchy, renamed epics/tasks/subtasks] new puts every element at its hierarchy place"; coverage-v3-gaps.js: "C09 [hierarchy, renamed epics/tasks/subtasks] no renamed type folder is created" |
| C10 | layout.statusFile true\|false (validated from V3-2, D92 Q1) | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (statusFile is not a boolean)"; ac-17-configuration.js: "layout: a valid layout block is accepted by list (statusFile false)" |
| C11 | an unknown key inside layout or layout.folders is invalid | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (unknown key inside layout)"; ac-17-configuration.js: "layout: list fails with exit 1 (unknown key inside layout.folders)" |
| C12 | changing layout never invalidates the configuration | COVERED | ac-22-layout.js: "B3 [type → hierarchy] list --all after the change: exit 0"; ac-22-layout.js: "B3 [type → hierarchy] doctor before --fix: only layout:misplaced findings" |
| C13 | invalid config: every command except doctor exit 1 pointing at doctor; doctor reports it, exit 2 | COVERED | ac-17-configuration.js: "list fails with exit 1 on an invalid config (done is not the last status)"; ac-17-configuration.js: "list points at nj doctor (done is not the last status)"; ac-17-configuration.js: "doctor exits 2 on an invalid config (done is not the last status)" |

### § 7 problem codes

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| P01 | type:folder only for group type (error, blocks ready) | COVERED | ac-03-fault-tolerance.js: "type:folder — doctor reports the code with the right severity"; ac-22-layout.js: "B3 [type → hierarchy] TSK-001 does not report type:folder (§ 7: one code per group)" |
| P02 | layout:misplaced for hierarchy/flat (error, blocks ready yes) | COVERED (gap closed) | ac-22-layout.js: "B3 [type → flat] doctor before --fix: only layout:misplaced findings"; ac-22-layout.js: "B3 [hierarchy → type] TSK-001 does not report layout:misplaced (§ 7: one code per group)"; coverage-v3-gaps.js: "P02 layout:misplaced keeps it out of --ready (§ 7: blocks --ready)" |
| P03 | backlog:ids_missing refers to .nanojira/ids/ | COVERED (gap closed) | ac-18-tombstone-integrity.js: "backlog:ids_missing has severity error"; V3-4 batch (/tmp/nj-v34-batch.patch, not yet committed): ac-18 deletes H.IDS_REL = .nanojira/ids |
| P04 | backlog:legacy_layout error, backlog-level | COVERED | ac-24-legacy-migration.js: "L2 doctor: backlog:legacy_layout (error) — and nothing but the missing STATUS.md"; ac-24-legacy-migration.js: "L2 backlog:legacy_layout is backlog-level: no element (§ 9)" |
| P05 | backlog:unreadable_dir: a directory below the backlog cannot be listed, error, backlog-level (D93 F9) | COVERED | ac-22-layout.js: "B6 [unreadable directory] doctor reports exactly backlog:unreadable_dir"; ac-22-layout.js: "B6 [unreadable directory] the finding is backlog-level (no element)" |
| P06 | backlog:status_stale warning, backlog-level | COVERED | ac-23-status-overview.js: "C5 [hand-edited] backlog:status_stale is backlog-level (no element)" |
| P07 | ac-13's closed code table gains every v3 code (D100) | COVERED (gap closed) | ac-13-json-contract.js TABLE holds exactly the 34 codes of § 7 (Oracle, 5e22caa) |
| P08 | type:folder for an undeterminable type stays in every group (D92 minor) | COVERED | ac-22-layout.js: "B6 [flat, undeterminable type] the file is read and carries type:folder"; ac-22-layout.js: "B6 [hierarchy, undeterminable type] the file is read and carries type:folder" |

### § 8 identifiers

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| T01 | tombstones at <backlog>/.nanojira/ids/<ID> | COVERED | ac-24-legacy-migration.js: "L3 search: new tombstones land in .nanojira/ids/"; ac-24-legacy-migration.js: "L3 search: and .ids/ is not recreated" |
| T02 | start value = highest number across ids/ and all element files, active and archive (wherever they lie, any layout) | COVERED (gap closed) | ac-24-legacy-migration.js: "L3 search: the next task is above every existing number (tombstones included)"; ac-18-tombstone-integrity.js: "new ID allocates above every existing element number"; coverage-v3-gaps.js: "T02 [flat] a new task allocates above an untombstoned TSK-007"; coverage-v3-gaps.js: "T02 [hierarchy] a new task allocates above an untombstoned TSK-005 in its folder"; coverage-v3-gaps.js: "T02 [hierarchy] a new epic allocates above an untombstoned archived EPIC-009" |

### § 9 interface

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| F01 | closed vocabulary adds io_error, invalid_backlog_flag, invalid_backlog_njrc, invalid_njrc, legacy_layout, refused:misplaced; nothing outside it | COVERED (gap closed) | ac-21-backlog-location.js: "A6 --backlog at a regular file --json: error is invalid_backlog_flag"; hardening-v3-1.js: "D96 list with an unsearchable ancestor of the cwd --json: error is io_error"; coverage-v3-gaps.js: "F01 every failure path in this file carries an error code from the v3 closed set (§ 9)" |
| F02 | spec-named rows: init target exists → exists; io_error for init into read-only/non-dir parent and deleted cwd (+ unsearchable ancestor D96); one line naming path and OS reason, never a stack (D93 F4, D98 64/66) | COVERED | hardening-v3-1.js: "F4 init --backlog=<read-only dir>/bl: the line names the path"; hardening-v3-1.js: "F4 NJ_BACKLOG=<regular file>/sub init --json: error is io_error"; hardening-v3-1.js: "F4 init in a deleted cwd --json: error is io_error" |
| F03 | invalid_backlog_env is pinned, not reserved | COVERED | ac-21-backlog-location.js: "A6 NJ_BACKLOG at a regular file --json: error is invalid_backlog_env" |

### § 11 archive

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| A01 | archive folder = layout.folders.archive | COVERED | ac-22-layout.js: "B1 [hierarchy, renamed archive] archive moves the subtree to its archive places (§ 11)"; ac-22-layout.js: "B1 [flat, renamed archive] archive moves the subtree to its archive places (§ 11)" |
| A02 | groups type/flat: flat in the archive folder | COVERED | ac-22-layout.js: "B1 [flat] archive moves the subtree to its archive places (§ 11)"; ac-11-archive-rules.js: "EPIC-001.md is now in the flat archive folder" |
| A03 | hierarchy: archive mirrors nesting; subtree folder moves with one rename; missing ancestor folders created, holding no element file | COVERED | ac-22-layout.js: "B1 [hierarchy] the task folder moved with one rename — its other content came along (§ 11, § 12)"; ac-22-layout.js: "B1 [hierarchy] the created ancestor archive folder holds no element file of its own (§ 11)" |
| A04 | an existing target folder is merged into, recursively; emptied sources removed with rmdir (D90, D94) | COVERED | ac-22-layout.js: "B1 [hierarchy merge, archive archive] then its task: exit 0 — merged one level down (D94)"; ac-22-layout.js: "B1 [hierarchy merge, archive archive] the emptied source folder is removed" |
| A05 | occupied only where a file meets a file target, or file meets folder → exists, nothing moves; all targets verified before the first move (D94) | COVERED | ac-22-layout.js: "B1 [hierarchy merge conflict]: exists"; archive-collision.js: "nothing moved: every element file is byte-identical" |
| A06 | refused:misplaced under hierarchy when the subtree does not lie in its own folder (whole subtree, no foreign element file) (D92 Q4) | COVERED | ac-22-layout.js: "B1 [hierarchy refused:misplaced, a subtree member lies outside the folder] --json: refused:misplaced"; ac-22-layout.js: "B1 [hierarchy refused:misplaced, a foreign element file lies inside the folder] --json: refused:misplaced" |
| A07 | hierarchy archive order: archived:/updated written in place first, then the move; NJ_FAULT=before-rename fires before the first rename (D91 B16) | PARTIAL | ac-22-layout.js: "B1 [hierarchy archive, NJ_FAULT=before-rename]: nothing moved" \| missing: the order (archived:/updated written in place before the move) \| testable: no (before-rename fires before the first rename, which is the first in-place write's own rename; no hook sits between the writes and the move) |

### § 12 concurrency

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| K01 | hierarchy: nj new creates the element's folder; an existing folder is reused | COVERED | ac-22-layout.js: "B1 [hierarchy] new reused the existing EPIC-003/ folder" |
| K02 | nj rm removes the file, then its folder only if empty | COVERED | ac-22-layout.js: "B1 [hierarchy] rm task removes its folder once empty (§ 12)"; ac-22-layout.js: "B1 [hierarchy] rm subtask keeps the task folder, which still holds TSK-006.md" |
| K03 | rm --cascade removes children first, each folder once empty, never recursively deletes foreign content | COVERED | ac-22-layout.js: "B1 [hierarchy] rm --cascade removes each emptied folder (§ 12)"; ac-22-layout.js: "B1 [hierarchy] rm --cascade never deletes what else a folder holds (§ 12)" |
| K04 | moving a subtree (archive, --fix) is one rename of its top folder | COVERED | ac-22-layout.js: "B1 [hierarchy] the task folder moved with one rename — its other content came along (§ 11, § 12)"; ac-22-layout.js: "B4 [hierarchy, hand-edited parent] the task folder moved with its top folder — other content came along (§ 14 step 3)" |
| K05 | NJ_FAULT has three injection points (D95 B23) | COVERED | ac-09-atomicity.js: "NJ_FAULT=after-tmp-write exits 1"; ac-09-atomicity.js: "NJ_FAULT=before-rename exits 1"; nj-fault-before-compare.js: "the code is fault:before-compare" |
| K06 | limit: an interrupted hierarchy merge leaves archive:split, reported by doctor | COVERED (gap closed) | ac-03-fault-tolerance.js: "archive:split — the split is reported"; coverage-v3-gaps.js: "K06 a half-merged hierarchy archive is reported as archive:split" |

### § 14 doctor

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| D01 | doctor is the one command that runs on a legacy backlog, reading .nanojira.json/.ids/ from the v2 places, running every other check (D101 74) | COVERED | ac-24-legacy-migration.js: "L2 doctor reads .nanojira.json and .ids/: `review` is unknown to the v2 statuses, TSK-005 has no tombstone"; ac-24-legacy-migration.js: "L2 doctor on a v2 backlog: exit 2" |
| D02 | doctor reports type:folder / layout:misplaced | COVERED | ac-22-layout.js: "B3 [type → renamed type folders] doctor before --fix: only type:folder findings"; ac-22-layout.js: "B3 [type → flat] doctor before --fix: only layout:misplaced findings" |
| D03 | --fix writes nothing while config:invalid holds (D93 F3) — also no note (D98) | COVERED | hardening-v3-1.js: "F3 doctor --fix --backlog=<project dir> --json: writes NOTHING — full tree identical before/after"; ac-17-configuration.js: "--fix on an invalid config writes nothing (invalid statuses)"; exit-doctor-fix.js: "invalid config survives (error, exit 2) — notes[] holds exactly 0 note(s)" |
| D04 | --fix writes nothing while legacy_layout with ambiguous step 0 holds; exit 2 (D95 B21) | COVERED | ac-24-legacy-migration.js: "L4 both places of both present: doctor --fix exit 2 (DECISIONS 95 B21)"; ac-24-legacy-migration.js: "L4 both places of both present: fixed[] is empty — no step wrote anything (§ 14, DECISIONS 93)" |
| D05 | step 0: .nanojira/ created, config and ids moved by rename, content unchanged | COVERED (gap closed) | ac-24-legacy-migration.js: "L3 search: .nanojira/config.json holds the v2 configuration byte for byte"; ac-24-legacy-migration.js: "L3 search: every tombstone keeps its content"; ac-24-legacy-migration.js: "L3 search: the configuration was moved by rename (same inode and mtime)"; "L3 search: .ids/ was moved by one rename (the folder keeps its inode)"; "L3 search: every tombstone keeps its inode and mtime (moved, not rewritten)" |
| D06 | step 0: .nanojira-index.json deleted if present | COVERED | ac-24-legacy-migration.js: "L3 search: .nanojira-index.json is deleted" |
| D07 | step 0: .gitignore line replaced only when verbatim (trailing \r ignored, ending kept, D101); else left alone and a note (absent file too) | COVERED | ac-24-legacy-migration.js: "L3 a mixed-ending .gitignore: only that line, its CRLF kept: .gitignore"; ac-24-legacy-migration.js: "L3 .gitignore without the line: a note says .gitignore was left alone (§ 14)"; ac-24-legacy-migration.js: "L3 no .gitignore at all (not created): a note says .gitignore was left alone (§ 14)" |
| D08 | step 0: both v2 and v3 places → nothing moved, reported, never merged | COVERED | ac-24-legacy-migration.js: "L4 .ids/ and .nanojira/ids/ both present: nothing moved, merged or written — the whole tree identical"; ac-24-legacy-migration.js: "L4 .ids/ and .nanojira/ids/ both present: backlog:legacy_layout still reported as an error" |
| D09 | step 3 under type only when id prefix and type agree | COVERED | doctor-fix-surface.js: "prefix/type disagree — the file was not moved"; doctor-fix-surface.js: "prefix/type disagree — the note names the element" |
| D10 | step 3 under hierarchy only when the parent chain resolves; subtree moves with its top folder, top-down | COVERED | ac-22-layout.js: "B5 [hierarchy, unresolvable chain] --fix moved nothing"; ac-22-layout.js: "B4 [hierarchy, hand-edited parent] --fix moved the subtree under EPIC-002" |
| D11 | step 3: every target must be free, else reported and stays (a dir or non-.md file at the target, D97) | COVERED | ac-22-layout.js: "B3 [type, target not free: a directory named like the file] the element stays where it was, unchanged"; ac-22-layout.js: "B3 [hierarchy, target not free: a file where the folder must go] the epic stays where it was, unchanged" |
| D12 | step 3: missing target folders are created (D97 60) | COVERED | ac-22-layout.js: "B3 [type → renamed type folders] --fix moved everything to the new layout"; ac-22-layout.js: "B3 [type → hierarchy] --fix moved everything to the new layout" |
| D13 | step 3: a file lying where it belongs is never touched | COVERED | fix-mtime-snapshot.js: "a file with nothing to repair is left untouched"; ac-22-layout.js: "B3 [type → renamed type folders] EPIC-002 is byte-identical after the move" |
| D14 | step 3 removes emptied hierarchy folders (ID-shaped names only) with rmdir, never recursive (D92) | COVERED (gap closed) | ac-22-layout.js: "B3 [hierarchy → type] the emptied hierarchy folders are removed"; coverage-v3-gaps.js: "D14 [hierarchy → type] an empty non-ID folder is kept (only ID-shaped folders are removed)"; coverage-v3-gaps.js: "D14 [hierarchy → type] an ID-shaped folder still holding foreign content survives with it" |
| D15 | --fix never archives or un-archives; archived: decides only the target (D92 Q2) | COVERED (gap closed) | ac-22-layout.js: "B3 [type, archive → shelf, file without archived:] --fix moved it to its active place, not into shelf/"; coverage-v3-gaps.js: "D15 a file below the archive folder without archived: stays archived"; coverage-v3-gaps.js: "D15 a hand-written archived: at an active place stays active" |
| D16 | step 9: STATUS.md regenerated last (reflects every repair) | COVERED (gap closed) | ac-23-status-overview.js: "C5 [deleted] doctor --fix restores it byte-identically"; coverage-v3-gaps.js: "D16 STATUS.md lists it under statuses[0] at its repaired path"; coverage-v3-gaps.js: "D16 the next doctor finds STATUS.md current (no backlog:status_stale)" |
| D17 | unresolvable chain (parent:dangling/cycle/ancestor) gets no layout code and is never moved; parentless task/subtask at the top of the tree; parent:orphaned stays a warning (D91 B15) | COVERED (gap closed) | ac-22-layout.js: "B5 [hierarchy, unresolvable chain] TSK-007 carries no layout code — its place cannot be computed"; ac-22-layout.js: "B5 [hierarchy, task without parent] at its place: doctor exits 0 (parent:orphaned is a warning)"; coverage-v3-gaps.js: "D17 TSK-001 in a parent cycle carries no layout code"; coverage-v3-gaps.js: "D17 --fix moves neither member of the cycle" |

### scan (D91 B11/B12)

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| N01 | the scan never follows a directory symlink | COVERED | ac-22-layout.js: "B6 [exclusions] a directory symlink is never followed (B11)"; ac-22-layout.js: "B6 [exclusions] a symlink loop neither hangs nor crashes (B11): list exits 0" |
| N02 | never descends into a dot-directory (.nanojira/, .git, .obsidian) | COVERED | ac-22-layout.js: "B6 [exclusions] a *.md under .nanojira/ is not an element"; ac-22-layout.js: "B6 [exclusions] a *.md under another dot-directory is not an element (B11)" |
| N03 | a symlinked file is read like a file | COVERED | ac-22-layout.js: "B6 [file symlink] a symlinked element file is read" |
| N04 | the .md suffix is case-sensitive | COVERED | ac-22-layout.js: "B6 [exclusions] the suffix is case-sensitive: *.MD is not an element (B11)" |
| N05 | node_modules has no special role | COVERED (gap closed) | coverage-v3-gaps.js: "N05 an element file under node_modules/ is read (no special role)"; coverage-v3-gaps.js: "N05 --fix moves it to tasks/" |
| N06 | README.md/STATUS.md excluded at the top level only; deeper README.md is an element file and is reported | COVERED (gap closed) | ac-22-layout.js: "B6 [README.md below the top level] a finding names epics/README.md"; coverage-v3-gaps.js: "N06 … and a finding names tasks/STATUS.md" |

### writes on misplaced files (D97 62)

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| W01 | set/note on a misplaced file write it where it lies, in every group | COVERED (gap closed) | ac-22-layout.js: "B3 [type → hierarchy] set writes in place — only archive, doctor --fix or a hand move relocate (§ 4)"; coverage-v3-gaps.js: "L10/W01 [hierarchy after a group change] the note lands in the file where it lies"; coverage-v3-gaps.js: "L10/W01 [flat after a group change] the new status lands in the file where it lies"; coverage-v3-gaps.js: "L10/W01 [type, hand-moved] the writes did not relocate it (only archive, --fix or the user move files)" |

### AC-level

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| X17 | AC-17 as extended (unknown layout key, invalid/duplicate folder name, no layout = defaults) | COVERED | ac-17-configuration.js: "layout: list fails with exit 1 (unknown key inside layout)"; ac-17-configuration.js: "layout: list fails with exit 1 (duplicate folder names)"; ac-17-configuration.js: "layout: list answers the same with and without the default layout block" |
| X18 | AC-18 with .nanojira/ids/ | COVERED | ac-18-tombstone-integrity.js: "the findings after losing .ids/ are exactly § 7's set"; ac-18-tombstone-integrity.js: "--fix reports the unrecoverable IDs"; ac-18-tombstone-integrity.js: "new ID allocates above every existing element number" |
| X21 | AC-21 as a whole | COVERED | ac-21-backlog-location.js: "A4 flag over environment: reads the backlog holding TSK-011"; ac-21-backlog-location.js: "A6 NJ_BACKLOG at a missing path (.njrc and backlog/ in cwd would succeed): the error names the source (NJ_BACKLOG)"; ac-21-backlog-location.js: "A7 .njrc repeated key (in cwd): the line number" |
| X22 | AC-22: same answers in every group for list/tree/show/--json apart from paths; byte-identical after moves | COVERED | ac-22-layout.js: "B2 list --json: same answer in hierarchy as in type, no layout block (paths masked)"; ac-22-layout.js: "B3 [type → hierarchy] TSK-001 is byte-identical after the move" |
| X23 | AC-23 golden per state after init and every write | COVERED | ac-23-status-overview.js: "C2 after set --status=done (golden/status-sequence-done.md)"; ac-23-status-overview.js: "C2 after archive — archived elements are left out (golden/status-sequence-archived.md)" |
| X24 | AC-24 as a whole | COVERED | ac-24-legacy-migration.js: "L1 rm on a v2 backlog (search): changes nothing — the whole tree identical before/after (AC-24)"; ac-24-legacy-migration.js: "L3 search: every element file (and README.md) is byte-identical"; ac-24-legacy-migration.js: "L4 both places of both present: nothing moved, merged or written — the whole tree identical" |

### not oracle-testable by nature (tooling, process, perf)

| # | Clause | Status | Asserted by (suite: check label) / reason |
|---|---|---|---|
| Z01 | D88 replay diff classes; D90 B1 gate procedure, B2 harness verdicts; D90/D93 perf gate; D91 B17 type probes; D95 B20 perf; D95 B22 naming; D100 batch strategy and process rule | UNTESTED | tooling, process and perf rulings (replay classes, gate procedure, harness verdicts, perf gates, compile-time type probes, naming, batch strategy) — not a behaviour of nj \| testable: no |
