# NanoJira verification oracle

The oracle for round one, derived **only** from `SPECIFICATION.md` v2. It was
written before the implementation exists, on purpose: a suite authored after the
code tests what the code does, not what the spec says.

Nothing here reads, imports or runs implementation source. Every test drives
`nanojira` as a black box through `spawnSync` and asserts only on observable
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
NJ=/path/to/nanojira          # absolute, or resolved against your shell's cwd

# the whole oracle, with a summary
$NODE run-all.ts "$NJ"

# one test
$NODE ac/ac-01-basic-run.ts "$NJ"
```

`ac/ac-15-no-dependencies.ts` needs the runtime Node itself, not just any
Node: it takes `NJ_NODE` when set, otherwise the first
`runtime/<platform>/bin/node` or `portable/runtime/<platform>/bin/node` found
walking up from the project directory, and reports `CANNOT RUN` when there is
none.

Run these commands from this directory (`test/`): `run-all.ts` and the test
folders are addressed relative to it. From the project root the same invocation
is `$NODE test/run-all.ts "$NJ"`, and a relative `$NJ` then resolves against the
project root, not `test/`.

The path is resolved to an absolute one when the harness loads, because tests
run `nanojira` with a scratch directory as its cwd — a relative path handed to a
child would be re-resolved against that scratch directory and every test would
report `CANNOT RUN`, blaming the suite for a missing argument.

`run-all.ts` runs the suite — every file under `ac/`, `fault/`, `edge/` and
`tools/` — prints each result and then a summary that separates *failed* from
*could not run* — those mean different things, and collapsing them would hide a
missing prerequisite behind a green-ish number. One result line is the
delegated pair: `ac/ac-07-concurrency.ts` is executed as `stress/concurrency.ts`
(that is the `concurrency.ts` line, reported in AC-7's slot), so there is one
fewer result line than test-bearing files. Nothing is skipped.

Each test prints `PASS <file> (n checks)` and exits 0, or `FAIL <file> — k of n
checks failed` with one line per failure and exits 1. Zero dependencies — the
same constraint the product is under, so the oracle runs on the same runtime.

### Parallel runs, `@serial` and `@slow`

`run-all.ts` runs test files concurrently (DECISIONS 199): `--jobs=<n>`, else
`NJ_TEST_JOBS`, else `min(os.availableParallelism(), 8)`. Anything else is a
usage error (exit 2).

```sh
$NODE run-all.ts "$NJ"              # pooled, default width
$NODE run-all.ts --jobs=1 "$NJ"     # the strictly serial run, as before
NJ_TEST_JOBS=4 $NODE run-all.ts "$NJ"
```

- Each file's stdout+stderr is buffered and printed as **one block**, never
  interleaved, in collected order: a block is printed as soon as every
  earlier file in the pool has finished.
- Files marked `@serial` are held back and run **alone, one at a time, after
  the pool has drained**, in collected order. Their blocks therefore come
  last. The summary lists `failed`/`cannot run` in collected order whatever
  order files finished in, so it reads the same as a serial run's.
- `--jobs=1` ignores the marker and is byte-for-byte the old serial loop:
  same order, same output, same exit code.
- Passed / failed / cannot-run are classified exactly as before. A file
  killed by the 600 s per-file timeout, or by passing the 64 MiB output cap,
  counts as failed in either mode.

**The marker.** A file is `@serial` when a comment line in its header —
before the first `import` — starts with `@serial`, followed by a one-line
reason:

```ts
/* @serial: stress/concurrency.ts bursts 300 nj processes at once */
/* AC-7 — ... the usual header ... */
import ...
```

Mark a file `@serial` when the pool could change its verdict or another
file's verdict. That means it:

- races a fixed sleep or a wall-clock bound against a child process,
- asserts on elapsed time, or
- loads the machine hard enough to push a neighbour past such a bound.

Prefer a fix where one exists. Each of these is a fix, not a reason to
mark a file:

- a generous timeout around a fixed hook wait;
- an elapsed-time window that only needs widening;
- a rendezvous instead of a sleep.

Use the marker only when the race itself cannot be removed from the test
side.

The `NJ_FAULT=before-compare` legs used to be the usual case. They slept
1 s and assumed nj had reached the hold by then; a late nj on a loaded
machine missed the planted change. They now use `H.faultReady()`
(DECISIONS 201), which needs no marker:

```ts
const ready = H.faultReady('label');                    // env + a ready file in a fresh dir
const done = startNj([...], { env: ready.env });        // NJ_FAULT=before-compare, NJ_FAULT_READY=<file>
T.check('nj reached the hold', await ready.wait(done), ready.file);
// ... plant the parallel change, then write <backlog>/.nj-fault-go
```

nj writes `NJ_FAULT_READY` once its first read is done and it starts
holding (spec § 12). Never go back to a fixed sleep there.

**`@slow`.** Same header syntax: `/* @slow: <why> */`. In the pool, `@slow`
files are dispatched first, so a long file does not start late and become
the last one running. Only the start order changes; output order and
verdicts do not, and `--jobs=1` ignores the marker.

Mark roughly the `--jobs` longest pooled files. To find them, set
`NJ_TEST_TIMES=<file>`: `run-all.ts` writes every file's wall time there
(TSV, slowest first, with its phase and start offset). Stdout is
unchanged. Re-check the list when a file's runtime changes a lot.

Every file must also stay **isolated**:

- write only under `H.freshDir()`/`H.mkBacklog()` (mkdtemp) or another
  mkdtemp dir, never inside the repo tree, `node_modules` or a fixed path;
- pin `HOME` to a fresh dir when the code under test reads it;
- never list a shared directory such as `/tmp` and compare counts.

Reading repo files, or cloning the repo into a fresh dir, is fine.

Set `NJ_KEEP=1` to keep the scratch directories for inspection; otherwise each
test cleans up after itself.

**Until `nanojira` exists, every test fails** with `FAIL <file> — CANNOT RUN`. That is
the correct signal: the oracle is complete and the implementation is not. It is
not a broken suite. The abort happens on the first attempt to drive `nanojira`, so no
test ever fails with an unrelated `ENOENT` about a file that was never created.

## Layout

| Path | What it is |
|---|---|
| `lib/harness.ts` | The shared contract: process runner, fixture builders, assertions |
| `golden/` | Byte-exact expected file content, one fixture per write path |
| `golden/MANIFEST.sha256` | Frozen hashes — see "Freezing" below |
| `ac/ac-NN-*.ts` | One executable test per acceptance criterion, AC-1 … AC-28 (AC-21–27 are derived from spec v3/v3.1, AC-28 from spec v3.2, each written ahead of its step) |
| `proposed/` | Empty for now: proposal-v3.1 suites written ahead of spec acceptance live here until promoted into `ac/`; excluded from `run-all.ts` discovery. Holds the still-unpromoted § C (`nanojira claim`) suite once it exists |
| `fault/` | `NJ_FAULT` and `NJ_NOW` verification hooks (§ 12) |
| `stress/` | The 20-wide concurrency run that AC-7 needs |
| `edge/` | Boundary cases the ACs name but do not fully pin |
| `AMBIGUITIES.md` | Spec passages that are **not** mechanically testable |
| `AC-MATRIX.md` | The per-criterion verdict table, `pass`/`fail`/`not covered`/`spec ambiguous` |

## Conventions

**Fixtures are hand-built, not produced by `nanojira`.** Tests that check how the
parser reacts to malformed input use `H.mkBacklog({files})` and `H.element()` to
write the bytes themselves. Building a fixture with `nanojira init` would make the test
depend on the code path it is meant to verify.

**The clock is pinned.** Every run sets `NJ_NOW=2026-09-21T18:00:00Z`;
subsequent writes use `H.LATER_NOW`. That is what makes byte-exact comparison
possible without normalisation — and normalising timestamps in the verifier would
silently hide exactly the serializer defects AC-2 exists to catch.

**Ambiguity is declared, never smoothed over.** Where the spec does not pin a
behaviour, the test carries an `// AMBIGUOUS:` comment naming what is unpinned,
and the reading it took. No test asserts a value nobody decided.

**A leg that cannot run here is `not covered`, not failed (DECISIONS 203).**
Some legs need a prerequisite this environment cannot supply — root, a
genuinely foreign-owned file, a case-folding filesystem, a macOS-only path
— and that absence is a gap in this run's coverage, not a product defect.
Call `T.notCovered(desc, reason)` instead of asserting; it is counted
alongside real checks and listed by name in the summary, but it can never by
itself turn a file red. A file whose only red legs are not-covered ones, with
every real assertion passing, reports `PASS` with the gaps named underneath —
honest both ways: a release gate that is red because of an environment this
machine cannot build is exactly as misleading as one that is quietly green
over a real defect. This is a different thing from the whole-file `CANNOT RUN`
above the table in "Contexts the suite must survive": that is the
implementation itself being absent, which must stay a hard failure, not a
per-leg environment gap.

## Contexts the suite must survive

A test that dies with a stack trace reports nothing, so these four are worth
checking whenever a test is added — the first two were found by exactly this
check after the suite looked finished.

| Context | Expected behaviour | Observed (cold-start run, 2026-09-21) |
|---|---|---|
| No `nanojira` at all | `FAIL — CANNOT RUN` on the first call; never an `ENOENT` about a file `nanojira` was meant to create | every suite `CANNOT RUN`, 0 `ENOENT`, no stack frames |
| A stub `nanojira` **script** (a Node file that runs and does nothing) | every test fails **on an assertion**, never on an unguarded `readdirSync`/`readFileSync` | every suite fails on an assertion, no stack frames |
| A partially built `nanojira` (e.g. `init` only) | same as the stub — this is the realistic case while the implementation is being written | every suite fails on an assertion, no stack frames |
| The real `nanojira` | all suites pass | all suites pass, exit 0 |

All four contexts have been run. The partially built case — previously listed as
not covered — is now measured and behaves as the table says. A shell-script stub
does **not** count as "a stub `nanojira` script": the harness runs `nanojira` with Node, so
a non-JS file produces loader stack frames that are echoed inside the failure
messages. Use a Node file.

Hence `H.lsOrEmpty()` and `H.readOrNull()`: read helpers that return `[]` / `null`
instead of throwing, so a missing directory surfaces as a failed check with a
message rather than as a crash. Fixtures built with `H.mkBacklog()` are safe by
construction; only directories that `nanojira` itself was supposed to create need the
guarded helpers.

## Freezing

`golden/` was authored from the spec's normative rules, not generated from an
implementation. Once `nanojira` exists, the fixtures must be **verified against** the
implementation, never regenerated from it: a fixture regenerated from the code
can no longer fail, which is the whole point of having it.

`golden/MANIFEST.sha256` pins the current bytes. Any change to a golden file is a
change to the definition of correct and needs a logged reason — the manifest is
what makes that visible.
