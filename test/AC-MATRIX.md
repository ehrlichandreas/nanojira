# Acceptance-criteria matrix

**Last full run: 39 / 39 passed, 0 failed, 0 cannot-run, 1 595 checks.**
Reproduce with `$NODE run-all.js /abs/path/to/nj`, where `$NODE` is the bundled
runtime
`/home/dev/workspace/portable/runtime/darwin-arm64/bin/node`
(bare `node` is not guaranteed to satisfy § 3's Node ≥ 24 requirement).
Two rows carry a standing caveat rather than a bare pass — AC-7's retry leg and
AC-15's network claim — and both say so in the Note column, because a green row
that hides a hole is worse than a red one.

The § 15 criteria were green *before* the § 9/§ 11/§ 14 contract tests below
existed, which is exactly why they were added: the suite passed while most of
the contracts pinned after the first repair were asserted by nothing. A green
AC row is not evidence that these contracts hold.

A second lesson is recorded in `AMBIGUITIES.md` 23: one of those contract tests
used an `either/or` where the spec had since decided, and stayed green while a
wrong-but-in-set code was emitted. Where the spec decides, accepting two values
is indistinguishable from accepting a bug.

One row per criterion of `SPECIFICATION.md` § 15, with the file that decides it.
Fill the verdict column when the implementation exists. Exactly one state per
row:

- **pass** — the test ran and every check passed
- **fail** — the test ran and at least one check failed
- **not covered** — the criterion could not be exercised in this run (state why)
- **spec ambiguous** — the criterion cannot be decided until `AMBIGUITIES.md`
  is ruled on (name the item)

`not covered` is a first-class result, not a soft pass. A run that reports
"19 pass" while three of them never executed anything is worse than a run that
says so.

| AC | Criterion | Test file | Verdict | Note |
|---|---|---|---|---|
| 1 | Basic run | `ac/ac-01-basic-run.js` | **pass** | |
| 2 | Golden files | `ac/ac-02-golden-files.js` | **pass** | depends on `AMBIGUITIES.md` 1–4 |
| 3 | Fault tolerance | `ac/ac-03-fault-tolerance.js` | **pass** | `parent:hierarchy` is two-sided — `AMBIGUITIES.md` 17 |
| 4 | Incompleteness | `ac/ac-04-incompleteness.js` | **pass** | |
| 5 | Empty sections | `ac/ac-05-empty-sections.js` | **pass** | section-boundary reading — `AMBIGUITIES.md` 16 |
| 6 | Rejection | `ac/ac-06-rejection.js` | **pass** | |
| 7 | Concurrency | `ac/ac-07-concurrency.js` → `stress/concurrency.js` | **pass** | **retry-abort leg: not covered** — not deterministically reachable (`AMBIGUITIES.md` 8); the 100-file/unique-ID/doctor-clean half passes |
| 8 | ID immortality | `ac/ac-08-id-immortality.js` | **pass** | |
| 9 | Atomicity | `ac/ac-09-atomicity.js` + `fault/nj-fault-points.js` | **pass** | |
| 10 | Dependencies | `ac/ac-10-dependencies.js` | **pass** | |
| 11 | Archive rules | `ac/ac-11-archive-rules.js` + `edge/rm-and-archive-refusals.js` | **pass** | `AMBIGUITIES.md` 7 |
| 12 | Discovery | `ac/ac-12-discovery.js` | **pass** | |
| 13 | JSON contract | `ac/ac-13-json-contract.js` | **pass** | `AMBIGUITIES.md` 11, 13 |
| 14 | Determinism | `ac/ac-14-determinism.js` | **pass** | `AMBIGUITIES.md` 12 |
| 15 | No dependencies | `ac/ac-15-no-dependencies.js` | **pass** | **partially covered** — "without network" is not observable without a sandbox (`AMBIGUITIES.md` 21) |
| 16 | Language | `ac/ac-16-language.js` | **pass** | `AMBIGUITIES.md` 10 |
| 17 | Configuration | `ac/ac-17-configuration.js` | **pass** | |
| 18 | Tombstone integrity | `ac/ac-18-tombstone-integrity.js` + `edge/tombstone-partial-loss.js` | **pass** | |
| 19 | Doctor axis | `ac/ac-19-doctor-axis.js` | **pass** | |
| 20 | Section writes | `ac/ac-20-section-writes.js` | **pass** | byte-level readings pinned by `DECISIONS.md` 68–74, not by `AMBIGUITIES.md` |

## Coverage beyond the criteria

These guard behaviour the criteria imply but do not state. They are counted
separately so a green AC row can never be mistaken for full coverage.

| Area | File | Verdict | Note |
|---|---|---|---|
| § 9 failure vocabulary | `edge/failure-vocabulary.js` | **pass** | 127 checks; every code now a quotation from § 9's normative condition→code table, no either/or; asserts no code outside the closed set is ever emitted (`AMBIGUITIES.md` 23) |
| § 9 unreadable-stub refusals | `edge/unreadable-stub-refusals.js` | **pass** | `rm --id`, `rm --cascade` and `archive` all refuse with `refused:unreadable` while any stub exists; nothing moves; non-vacuity controls included |
| § 14 `--fix` mtime keyed by path | `edge/fix-duplicate-mtimes.js` | **pass** | two files sharing an id, different mtimes, each keeps its own `created` |
| § 4 discovery message | `edge/discovery-message.js` | **pass** | `backlog/` without config names the file and points at `nj doctor`, never "no backlog found" |
| § 9 parent refusals | `edge/parent-refusals.js` | **pass** | archived parent → `refused:parent_archived`; unreadable stub parent → `refused:unreadable` |
| § 9 `rm` names dependents | `edge/rm-dependents.js` | **pass** | prose and `dependents[]`; the removal still succeeds |
| § 7/§ 12 write encoding | `edge/write-encoding.js` | **pass** | LF, no BOM, one trailing newline on every write path; CRLF+BOM input is rewritten clean |
| § 11 archive collision | `edge/archive-collision.js` | **pass** | regression test: an occupied target moves **nothing**, exit 1, `exists` |
| § 14 empty-value rule | `edge/empty-value-rule.js` | **pass** | empty *known* field = absent; empty *unknown* key preserved verbatim |
| § 14 `--fix` mtime snapshot | `edge/fix-mtime-snapshot.js` | **pass** | `created` = the ORIGINAL mtime, not the step-1 write time |
| `NJ_FAULT` injection points | `fault/nj-fault-points.js` | **pass** | distinguishes the two abort points |
| compare-before-write guard | `fault/nj-fault-before-compare.js` | **pass** | the § 12 `before-compare` race; rendezvous via `.nj-fault-go` |
| invalid `NJ_NOW` | `fault/nj-now-invalid.js` | **pass** | § 12 |
| duplicate-ID refusal + `--file` escape | `edge/duplicate-id-write-refusal.js` | **pass** | |
| `done` with open children | `edge/done-open-children.js` | **pass** | incl. `--force` does not bypass |
| `rm` / `archive` refusals | `edge/rm-and-archive-refusals.js` | **pass** | |
| partial tombstone loss | `edge/tombstone-partial-loss.js` | **pass** | the *warning*, not the error |
| acceptance-section shapes | `edge/acceptance-section-shapes.js` | **pass** | `AMBIGUITIES.md` (boundary) |
| frontmatter grammar | `edge/frontmatter-grammar.js` | **pass** | `AMBIGUITIES.md` 9 |

## Running the matrix

```sh
NODE=/home/dev/workspace/portable/runtime/darwin-arm64/bin/node
for f in ac/*.js fault/*.js edge/*.js stress/*.js; do
  $NODE "$f" "$NJ"
done
```

The exit code of each file is the verdict; the table is filled by hand from the
run, with `not covered` recorded wherever a conditional leg did not execute.
