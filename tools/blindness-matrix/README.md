# Blindness matrix

Rescued from `/tmp` — the sixth tool this project nearly lost to a temp
directory. It is the only thing that measures whether the oracle would
*notice* a defect, as opposed to whether it currently passes.

## What it does

For each named mutant it copies `nj`, applies **one** textual change to a
single behaviour, injects a `__hit()` probe at the mutated site, and runs
every suite under `test/ac`, `test/fault` and `test/edge` against the copy.
The repo's own `nj` is never touched.

Each (mutant, suite) pair lands in one of three states:

| state | meaning |
|---|---|
| **BLIND** | the suite executed the mutated code (hits > 0) and still passed |
| **COVERING** | the suite executed the mutated code and failed |
| red without hit | the suite failed without reaching the mutation — usually a mutant side effect, not coverage |

The hit counter is what makes the verdict trustworthy: a suite that never
reaches the mutated line is not "covering" it, and without the probe those
two cases are indistinguishable.

## Usage

```sh
NODE=/…/runtime/darwin-arm64/bin/node
$NODE tools/blindness-matrix/run.js /abs/path/to/repo            # every mutant
$NODE tools/blindness-matrix/run.js /abs/path/to/repo doc-sum-warn
# before/after around a test/ change — same base nj, compared automatically:
$NODE tools/blindness-matrix/run.js $REPO --nj=/tmp/base-nj
$NODE tools/blindness-matrix/run.js $REPO --nj=/tmp/base-nj --compare=/tmp/blind/matrix-<digest8>-<nj8>.json
```

The result file names what it measured: `/tmp/blind/matrix-<testDigest8>-<njSha8>.json`,
with the full `testDigest` (same scope and folding as the refactor harness),
`njSha256`, node version and date in a `header`. Two runs are comparable only
when their `njSha256` agree — `--compare` refuses otherwise, with its own
message, because the mutants are textual edits of that one `nj` and a
different base is a different mutant set. Prefer `--nj=` pointing at the
baseline (`git show c1-baseline:nj > /tmp/base-nj`): the needles were written
against it, and the oracle is green on it.

Per-suite hit logs land under `/tmp/blind/hits/<mutant>/`. A new mutant is a
few lines in the `MUTANTS` table: `name → [needle, replacement, expectedNeedleCount]`.
The count is checked on build, so a mutant whose anchor drifted fails loudly
instead of silently testing nothing. Do not change `MUTANTS` between a before
and an after run — add to `PROBES` instead, which only run when named.

A `0 / 0` row (no hits anywhere) means the line was never executed under the
mutant's condition; the `probe-*-reached` entries hit unconditionally and tell
"never reached" apart from "reached, but never with the condition".

`--compare` calls a row REGRESSION only when a suite that was **covering**
before is not covering now. A suite that is blind now but never reached the
line before is listed as *newly exercised, blind*: the net did not loosen, a
hole became visible — usually because a new fixture finally drives the
condition and the assertion for that part is still missing.

## Why it exists

A 20-mutant sweep found the oracle was good at catching what goes **missing**
and blind to what gets **added**. The worst case was `doc-extra-warn-dirty` —
one spurious `title:h1_mismatch` WARNING appended whenever real findings
already exist:

| | blind | covering |
|---|---|---|
| before | 19 | 1 — and that one only because the mutant crashed on an element-less backlog, not because it saw the extra warning |
| after | 1 | 19 |

The cause was an assertion *form*, not a missing fixture: `found.includes(code)`
and `problems.some(p => p.code === …)` cannot see an extra item by
construction. The fix was `T.sameSet` plus `H.doctorSet()` in
`test/lib/harness.js`, with the expected set derived from § 7's Doctor column.

Run this before believing a green suite means a covered behaviour.
