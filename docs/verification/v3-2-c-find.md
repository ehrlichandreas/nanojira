# V3.2-C verification — `nj find` (`3c09b79`, § 9a, AC-30, TSK-036)

Verifier, 2026-10-04. I didn't write any of this code — independent
verification assigned by the Lead. Work in `/tmp/verifier-v32c-find`
(detached worktree at `3c09b79`), `/tmp/verifier-v32c-nested/projects/
nanojira` (nested under its own `runtime/darwin-arm64` symlink, for
`gate.js`'s own AC-15 check and a second, unclipped `baseline.js` run), and
`/tmp/verifier-v32c-probe` (scratch backlogs). All removed before writing
this file. Runtime Node v24.21.0. Read: § 9a as of `95bc3f2` (incl. D132),
the § 9 command-list/JSON-shape rows; `src/commands/cmd-find.ts`,
`cmd-list.ts`'s diff, `src/nj.ts`, `src/core/help.ts`; `test/ac/ac-30-find.js`
(`99cf76e`).

**VERDICT: accept.** AC-30 34/34, run-all and `gate.js --step=3c09b79
--frozen=c6-baseline` all reproduce exactly — the 6-call tally confirmed
byte-for-byte to be exactly two cumulative help lines (`check`'s, already
accepted in V3.2-A, plus `find`'s, new here), nothing else. `list`'s own
behaviour is **provably** unaffected by the `applyFilters` export: the
function body has zero diff lines, only its export visibility changed. My
own 15 black-box probes beyond AC-30 all matched § 9a exactly, including
every named Unicode edge case already covered live and several the suite
doesn't reach (multi-line queries, literal regex metacharacters, an
unreadable stub, the human-output context line's two code paths). A direct
A/B timing comparison at 10,000 elements confirms `find ≈ list`, not a new
read.

## 1. AC-30, run-all, gate — the 6-call tally confirmed byte-for-byte

- `node test/ac/ac-30-find.js dist/nj`: **34/34**, exact.
- `node test/run-all.js dist/nj`: 76/78 pass, 0 failed, 2 cannot-run (the
  usual two expected gaps).
- `gate.js --step=3c09b79 --frozen=c6-baseline`: `BEHAVIOUR CHANGED — 6
  differing call(s): help 4, --help 2`, `replay: exit 1`, `oracle: passed
  77, failed 0, cannot run 1 (1 expected)`, `gate: exit 1, replay CHANGED,
  oracle green`.

**Confirmed byte-for-byte**, via an unclipped `baseline.js` rerun (nested
worktree, `test/` at `c6-baseline`, digest-confirmed; throwaway clip
removal, never committed, same technique as every prior report): the
"was" (`c6-baseline`) help text carries neither a `check` nor a `find`
line; the "now" (`3c09b79`) text carries **both** — `check`'s (already
accepted, unrelated to this round) and the new `nj find "<text>"
[--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--all]
[--case-sensitive]` line — and nothing else differs anywhere in either
~1,100-character string, across all 6 calls (the `help` fixture's own
three, `oracle:edge/coverage-v3-gaps.js`'s own three — the same
duplication pattern already confirmed in V3.1-B/D121/V3.2-A/D129).

**`cmd-list.ts`'s diff proves, not just suggests, that `list` is
unaffected.** The entire change is one export-list line
(`export { cmdList, applyFilters };`) plus a comment above the function —
**zero lines inside `applyFilters`'s own body changed.** This isn't "ran
the tests and they still pass" confidence; the function `list` calls is
textually identical before and after, so there is no behaviour left to
regress.

**Help line vs § 9.** § 9's own command-list entry for `find` is
`nj find "<text>" [--status=…] [--type=…] [--tag=…] [--parent=…]
[--assignee=…] [--all] [--case-sensitive] [--json]`; `help.ts`'s line
omits `[--json]` — but so does every other command's help line
(`list`/`show`/`tree` all omit it too, covered by the blanket "every
command accepts `--json`" sentence at the end of the help text). Not a
new inconsistency, the established convention.

## 2. My own black-box probes beyond AC-30

AC-30 is already thorough for the behaviours § 9a states explicitly (title/
body/notes fields, case-folding including the three named `toLowerCase()`
edge cases — Ä/ä, ß-vs-SS, İ — substring-not-word-boundary matching,
`--all`, AND-combined filters, the empty-query `invalid_value`, the output
shape/no-`_match`/sort order, empty results, basic human output). I
targeted what it doesn't reach:

- **Multi-line query.** A shell-supplied argument containing a literal
  `\n` (`nj find "$(printf 'line one\nline two')"`) correctly matched an
  element whose body contains that exact two-line sequence — plain,
  unremarkable substring matching; no special-casing needed or present.
- **Regex metacharacters treated literally.** `.`, `*`, `[`, `]`, `(`,
  `)` in the query (`".*"`, `"[brackets]"`, `"(test)"`) each matched only
  because the exact literal characters appear in the fixture's title/body
  — confirmed by code reading too (`fold(e.title).includes(needle)`, a
  plain `String.prototype.includes`, no `RegExp` constructed anywhere in
  `cmd-find.ts`).
- **An invalid filter value, as `list`.** `--status=bogus` and
  `--type=bogus` both produce `invalid_value` with the same "Known
  statuses/types: …" hint `list` itself gives — expected, since `find`
  calls `list`'s own unmodified `applyFilters`.
- **No positional argument vs. an empty one.** No argument at all:
  `missing_argument` ("nj find needs the search text as an argument").
  A literal empty string: `invalid_value` (AC-30's own G7). Both
  confirmed live, distinct codes for the two distinct conditions.
- **Two positional arguments.** `nj find needle extra` joins them with a
  space (`"needle extra"`, the same convention `nj note`'s own text
  argument already uses) — confirmed it searches for the joined phrase,
  not either word alone (a fixture containing only `"needle"` alone
  correctly did not match `"needle extra"`).
- **An unreadable stub in the backlog.** `find` stays a read and
  completes normally in a backlog carrying a `file:unreadable` stub
  (confirmed via `doctor` reporting the stub separately) — matching § 9's
  "reads... stay open so the stub remains findable" rule, the same as
  `list`.
- **The human-output context line's two code paths.** A body line longer
  than `CONTEXT_MAX` (100) truncates with a trailing `…`, confirmed at the
  exact boundary. The **title-only-match fallback**: AC-30 doesn't
  actually exercise this path, because `nj new`'s scaffolded H1 always
  duplicates the title into the body's first line, so a title match is
  *also* always a body match in practice. I constructed the genuine case
  by hand-removing an element's H1 line (title present in frontmatter,
  absent from the body entirely): the context line correctly fell back to
  printing the bare title, exactly as `matchContext`'s own fallback branch
  intends.

No deviation from § 9a found in any of these.

## 3. Performance: `find ≈ list`, confirmed by direct measurement

`tools/perf.js` itself refused to run (correctly) — this machine is not
quiet right now (other teams' processes at 400%+ CPU), and the script's
own guard aborts rather than blame machine load on `nj`. Rather than skip
the check, I built the same 10,000-element fixture `perf.js` itself builds
(100 epics + 9,900 tasks, identical shape, reusing its own `buildBacklog`
logic directly since requiring the script runs its gated `main()`
immediately) and timed four commands myself, 5 rounds each, under the
**same** load conditions for all four — a relative comparison remains
meaningful even when the absolute numbers aren't comfort-bar-certified
(that absolute measurement is E.3/TSK-033's own, separately-tracked gap,
not something this feature owes):

| Command | median | max |
|---|---|---|
| `list` | 246.0 ms | 248.8 ms |
| `list --json` | 242.0 ms | 246.6 ms |
| `find` (no match, full scan) | 240.2 ms | 250.4 ms |
| `find` (one match, `--json`) | 225.4 ms | 244.0 ms |

All four land within a ~20 ms band of each other. `find` does not cost
measurably more than `list` at 10,000 elements — confirming § 9a's claim
("adds one substring scan over text `nj` has already loaded, not a new
read") directly, not just by re-reading the diff.

## Consistency with the current spec

Checked § 9a's own claims against the code line by line: the "AND, not
OR" filter-combination claim is structurally guaranteed (`find` calls the
identical `applyFilters` `list` uses, then narrows further by the text
predicate — there is no code path that could produce an OR). The "No
`_match` field" claim and the exact output shape were confirmed both by
AC-30's own G8 and by direct inspection of `cmd-find.ts`'s JSON
construction, which is a bare `entryJson`/`countsOf` call with nothing
appended. Checked § 13's claim that `find` shares the scan path (§ 1 above
confirms `loadElement` already reads every body unconditionally, as
established in my V3.1-C report) against the direct timing measurement
in § 3 — consistent, not just asserted.
