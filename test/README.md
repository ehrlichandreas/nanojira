# NanoJira verification oracle

The oracle for round one, derived **only** from `SPECIFICATION.md` v2. It was
written before the implementation exists, on purpose: a suite authored after the
code tests what the code does, not what the spec says.

Nothing here reads, imports or runs implementation source. Every test drives
`nj` as a black box through `spawnSync` and asserts only on observable
behaviour: exit code, stdout, stderr, and the bytes of the files left behind.

## Which spec revision this targets

Derived from the 781-line revision of `SPECIFICATION.md` (18:22). The oracle
has since been reconciled against the **revision of 2026-09-21**: the
sections it is most tightly coupled to — § 7's problem-code
table (29 rows / 30 distinct codes, including the added `file:unreadable` and
`unknown:priority`), § 9's commands, JSON shapes, the two failure-code
subsections ("Failure codes — closed vocabulary", "Failure codes — spec-named
paths") and the section-write rule, § 10's note placement, § 12's hooks, § 14's
`--fix` ordering / refresh / reporting rules, and AC-2, AC-7 and AC-20 as quoted
above — were re-checked against it. **Re-diff before trusting a green run after any further spec edit**: the
golden fixtures encode § 7's canonical order and § 9's scaffold, so a serializer
change is a change to the definition of correct, not a bug in the suite.

## Running

```sh
NODE=/home/dev/workspace/portable/runtime/darwin-arm64/bin/node
NJ=/path/to/nj          # absolute, or resolved against your shell's cwd

# the whole oracle, with a summary
$NODE run-all.js "$NJ"

# one test
$NODE ac/ac-01-basic-run.js "$NJ"
```

`ac/ac-15-no-dependencies.js` needs the runtime Node itself, not just any
Node: it takes `NJ_NODE` when set, otherwise the first
`runtime/<platform>/bin/node` or `portable/runtime/<platform>/bin/node` found
walking up from the project directory, and reports `CANNOT RUN` when there is
none.

Run these commands from this directory (`test/`): `run-all.js` and the test
folders are addressed relative to it. From the project root the same invocation
is `$NODE test/run-all.js "$NJ"`, and a relative `$NJ` then resolves against the
project root, not `test/`.

The path is resolved to an absolute one when the harness loads, because tests
run `nj` with a scratch directory as its cwd — a relative path handed to a
child would be re-resolved against that scratch directory and every test would
report `CANNOT RUN`, blaming the suite for a missing argument.

`run-all.js` runs the suite — every file under `ac/`, `fault/`, `edge/` and
`stress/` — prints each result and then a summary that separates *failed* from
*could not run* — those mean different things, and collapsing them would hide a
missing prerequisite behind a green-ish number. One result line is the
delegated pair: `ac/ac-07-concurrency.js` is executed as `stress/concurrency.js`
(that is the `concurrency.js` line, reported in AC-7's slot), so there is one
fewer result line than test-bearing files. Nothing is skipped.

Each test prints `PASS <file> (n checks)` and exits 0, or `FAIL <file> — k of n
checks failed` with one line per failure and exits 1. Zero dependencies — the
same constraint the product is under, so the oracle runs on the same runtime.

Set `NJ_KEEP=1` to keep the scratch directories for inspection; otherwise each
test cleans up after itself.

**Until `nj` exists, every test fails** with `FAIL <file> — CANNOT RUN`. That is
the correct signal: the oracle is complete and the implementation is not. It is
not a broken suite. The abort happens on the first attempt to drive `nj`, so no
test ever fails with an unrelated `ENOENT` about a file that was never created.

## Layout

| Path | What it is |
|---|---|
| `lib/harness.js` | The shared contract: process runner, fixture builders, assertions |
| `golden/` | Byte-exact expected file content, one fixture per write path |
| `golden/MANIFEST.sha256` | Frozen hashes — see "Freezing" below |
| `ac/ac-NN-*.js` | One executable test per acceptance criterion, AC-1 … AC-26 (AC-21–26 are derived from spec v3/v3.1, written ahead of each step) |
| `proposed/` | Empty for now: proposal-v3.1 suites written ahead of spec acceptance live here until promoted into `ac/`; excluded from `run-all.js` discovery. Holds the still-unpromoted § C (`nj claim`) suite once it exists |
| `fault/` | `NJ_FAULT` and `NJ_NOW` verification hooks (§ 12) |
| `stress/` | The 20-wide concurrency run that AC-7 needs |
| `edge/` | Boundary cases the ACs name but do not fully pin |
| `AMBIGUITIES.md` | Spec passages that are **not** mechanically testable |
| `AC-MATRIX.md` | The per-criterion verdict table, `pass`/`fail`/`not covered`/`spec ambiguous` |

## Conventions

**Fixtures are hand-built, not produced by `nj`.** Tests that check how the
parser reacts to malformed input use `H.mkBacklog({files})` and `H.element()` to
write the bytes themselves. Building a fixture with `nj init` would make the test
depend on the code path it is meant to verify.

**The clock is pinned.** Every run sets `NJ_NOW=2026-09-21T18:00:00Z`;
subsequent writes use `H.LATER_NOW`. That is what makes byte-exact comparison
possible without normalisation — and normalising timestamps in the verifier would
silently hide exactly the serializer defects AC-2 exists to catch.

**Ambiguity is declared, never smoothed over.** Where the spec does not pin a
behaviour, the test carries an `// AMBIGUOUS:` comment naming what is unpinned,
and the reading it took. No test asserts a value nobody decided.

## Contexts the suite must survive

A test that dies with a stack trace reports nothing, so these four are worth
checking whenever a test is added — the first two were found by exactly this
check after the suite looked finished.

| Context | Expected behaviour | Observed (cold-start run, 2026-09-21) |
|---|---|---|
| No `nj` at all | `FAIL — CANNOT RUN` on the first call; never an `ENOENT` about a file `nj` was meant to create | every suite `CANNOT RUN`, 0 `ENOENT`, no stack frames |
| A stub `nj` **script** (a Node file that runs and does nothing) | every test fails **on an assertion**, never on an unguarded `readdirSync`/`readFileSync` | every suite fails on an assertion, no stack frames |
| A partially built `nj` (e.g. `init` only) | same as the stub — this is the realistic case while the implementation is being written | every suite fails on an assertion, no stack frames |
| The real `nj` | all suites pass | all suites pass, exit 0 |

All four contexts have been run. The partially built case — previously listed as
not covered — is now measured and behaves as the table says. A shell-script stub
does **not** count as "a stub `nj` script": the harness runs `nj` with Node, so
a non-JS file produces loader stack frames that are echoed inside the failure
messages. Use a Node file.

Hence `H.lsOrEmpty()` and `H.readOrNull()`: read helpers that return `[]` / `null`
instead of throwing, so a missing directory surfaces as a failed check with a
message rather than as a crash. Fixtures built with `H.mkBacklog()` are safe by
construction; only directories that `nj` itself was supposed to create need the
guarded helpers.

## Freezing

`golden/` was authored from the spec's normative rules, not generated from an
implementation. Once `nj` exists, the fixtures must be **verified against** the
implementation, never regenerated from it: a fixture regenerated from the code
can no longer fail, which is the whole point of having it.

`golden/MANIFEST.sha256` pins the current bytes. Any change to a golden file is a
change to the definition of correct and needs a logged reason — the manifest is
what makes that visible.
