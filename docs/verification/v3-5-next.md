# V3.5-A verification — `nj next` (`596172c`, § 12b, D154/D156, AC-40)

Verifier, 2026-10-05. Independent verification, assigned by the Lead.
Work in `/tmp/verif-next` (worktree at `596172c`, built via `npm ci` +
`tools/bundle.js`), `/tmp/verif-next-old` (detached at `c6d428b`, the
immediately-preceding commit, for the byte-identity check), `/tmp/
verif-next-nested` (nested, for the replay), `/tmp/verif-next-race`
(scratch, the large concurrency repro). All removed before writing
this. Read: SPECIFICATION.md § 12b in full (as amended by D156),
DECISIONS 154/156 in full, the full `596172c` diff
(`cmd-next.ts`/`cmd-claim.ts`/`cmd-list.ts`/`flag-table.ts`/
`help.ts`/`nj.ts`/`nj-mcp.ts`), `test/ac/ac-40-next.js` in full.

**VERDICT: pass.** Every mechanism § 12b specifies is implemented
exactly as written, confirmed both by diff review and by live
reproduction, including a 20-process/8-element race run three times
over with consecutive claim generations and zero double-claims. AC-40
(88/88) is confirmed to genuinely discriminate two classes of bug by
mutation (removing the leaf filter; letting any failure, not just
`refused:claimed`, advance) — not merely to pass. `list --ready` and
bare `nj` are confirmed byte-identical to the immediately-preceding
commit. The replay against `c7`/`oracle-frozen-12` shows exactly the 6
help-class calls, byte-confirmed. One minor, non-blocking observation:
AC-40's "any other failure surfaces immediately" rule is exercised by
only one case (fault injection); the other failure types § 12b
enumerates (`refused:unreadable`, `refused:archived`, `duplicate_id`,
`io_error`) aren't independently exercised mid-loop, though the code
path is structurally the same for all of them (nothing inside the
try/catch is specific to the fault case).

## 1. Diff review against § 12b

**Candidates = `--ready` ∩ filters ∩ leaf rule, in `list`'s own order —
confirmed by construction, not re-derived.** `cmd-next.ts` calls
`applyFilters(ctx.elements, filterFlags, ctx.cfg)` — the *exact*,
unmodified function `list`/`find` already use (the diff to
`cmd-list.ts` is a one-line export addition, zero lines changed inside
`applyFilters`'s or `cmdList`'s own bodies). `applyFilters` itself ends
in `.sort(compareElements)`, so the candidate list already carries
`list`'s own priority-desc/id-asc order before `next` does anything
else. On top of that, `next` applies the same `isReady`/
`availableToActor` predicates `cmdList`'s own `--ready` branch uses
(same functions, same arguments, `availableToActor` newly exported but
textually unchanged), then the new `!hasOpenChild(e)` filter last.

**`--status` validated once, up front, independent of which candidate
succeeds** — confirmed: the `ctx.cfg.statuses.includes(status)` check
runs immediately after `context(flags)`, before `filterFlags` is even
built, let alone before any candidate is resolved. Live-confirmed in
§ 2 below (N5-equivalent) with a bad `--status` against a backlog with
no ready candidates at all.

**Only `refused:claimed` advances; everything else surfaces** —
confirmed structurally: the loop's `try`/`catch` only special-cases
`e.code === 'refused:claimed'` (push to `skipped`, `continue`);
everything else is re-thrown, propagating out of `cmdNext` entirely.
Just as important, `resolveById`/`requireWritable`/`requireActive` are
called *outside* that `try` block — so a candidate that's become
`refused:archived`/`refused:unreadable` since the snapshot was read
(a genuine TOCTOU window, not a false positive) also fails immediately,
never silently skipped, exactly as § 12b step 3 requires.

**`none_ready` on an exhausted list, `skipped[]` in attempt order,
always present** — confirmed: `skipped` accumulates in loop order and
is passed through to the JSON result via `Object.assign({ok, id},
single, {skipped})`; on exhaustion, `fail('none_ready', ..., hint)` is
the function's only remaining path.

**`--id`/`--file` rejected** — confirmed structurally: the new
`flag-table.ts` entry for `next` has no `id`/`file` fields at all
(`[str('as'), str('status'), str('type'), str('tag'), str('parent'),
str('assignee')]`), and `checkFlags(flags, cliFieldNames('next'), ...)`
means either flag is simply not in the allowed set — `unknown_field`
by the same generic mechanism every other unrecognized flag already
gets, not a special case written for `next`.

**Rollback is inherited, not reimplemented** — confirmed: `cmd-next.ts`
calls `claimOne` (exported, unmodified, from `cmd-claim.ts`) for the
actual claim attempt; the function doing the mirror write and its
rollback is textually the same one `nj claim` itself calls. There is no
second rollback implementation to audit separately.

## 2. Live reproduction

**A real race, 20 processes over 8 elements, three full rounds.** Built
a fixture (`/tmp/verif-next-race`, one epic, 8 ready tasks) and a
driver spawning 20 real `node dist/nj next --json` child processes per
round, each with a distinct `NJ_AUTHOR`, releasing everything between
rounds:

```
round 1: 8 winners, 12 losers (none_ready), distinct ids: 8
round 2: 8 winners, 12 losers (none_ready), distinct ids: 8
round 3: 8 winners, 12 losers (none_ready), distinct ids: 8
=== claim generation consistency check ===
TSK-001 generations: [1,2,3,4,5,6] OK consecutive from 1
... (TSK-002 through TSK-008, identical)
```

Every round: exactly 8 winners (one per element, confirmed distinct IDs
every time — no double-claim across 60 total process launches), every
loser correctly `none_ready` (not a stray error shape), and every
element's claim generation sequence is a clean, gapless 1-6 across the
3 claim+release rounds — no skipped numbers, no duplicates, confirming
the underlying CAS holds under this load exactly as it does for plain
`claim`. `nj doctor` on the final state: `0 errors, 0 warnings`.

**Re-assertion**: released then re-claimed by the same name with
nothing else ready — `changed: []`, `skipped: []`, exit 0, confirmed
live (mirrors AC-40's own N4, re-confirmed independently).

**D156 leaf cases**: AC-40's own N10 block (5 sub-cases: open-task
skips the epic even under `--type=epic`; a childless epic is picked; an
epic whose only child is `done` is picked; an archived child doesn't
count as open; the same rule one level down, task-with-open-subtask)
all pass (confirmed within the 88/88 run, read each case's fixture and
assertion individually — none is vacuous, each constructs the specific
tree shape it claims to test).

**`nj-mcp next` via a raw JSON-RPC call, `as` defaulting from
`NJ_AUTHOR`** — this is the one case AC-40's own N12 doesn't cover (its
two MCP cases pass `as` explicitly, or omit it expecting failure since
the *test's* own env has no `NJ_AUTHOR` either). Built a scratch case
with `NJ_AUTHOR=dave` in the **server's** environment only, no `as` in
the tool call:
```
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next","arguments":{}}}
-> {"result":{..."structuredContent":{"ok":true,"id":"TSK-001",...,
     "entry":{...,"assignee":"dave",...},"claim":{"by":"dave",...},
     "previous_assignee":"carol","skipped":[]},"isError":false}}
```
Confirmed: claimed as `dave`, taken over from `carol` (correctly a
re-claim since the element had been released), matching the commit
message's claim that `next` gets `NJ_AUTHOR` fallback "for free" from
the same generic machinery `claim`/`release`/`note` already use — no
special-casing needed, none found.

## 3. Mutation testing — does AC-40 actually discriminate?

**Mutation 1: remove the leaf filter** (`&& !hasOpenChild(e)` deleted
from the candidate filter chain). Rebuilt, re-ran AC-40:
```
FAIL ac-40-next.js — 15 of 88 checks failed
```
Failures span N1, N4, N5, N9, N10, N11 — not narrowly scoped to the
dedicated leaf-rule cases, because nearly every fixture in this file
places an epic (lower id, same/higher priority) alongside the task it
actually means to test, so removing the filter makes `next` grab the
epic almost everywhere. Strong, wide discrimination.

**Mutation 2: let any `Fail` advance, not just `refused:claimed`**
(the `e.code === 'refused:claimed'` condition widened to just
`e instanceof Fail`). Rebuilt, re-ran AC-40:
```
FAIL ac-40-next.js — 1 of 88 checks failed
  ✗ N9 mirror write fails: fault:before-rename
```
Confirmed this mutation is caught, but only by N9 (the fault-injection
rollback case) — the only AC-40 case that constructs a genuine mid-loop
failure of a kind *other* than `refused:claimed`. The other failure
types § 12b's step 3 explicitly enumerates (`refused:unreadable`,
`refused:archived`, `duplicate_id`, `io_error`) have no independent
mid-loop case in AC-40 that would also catch this same mutation — they
are harder to construct deterministically without fault injection
(each needs the backlog to change *between* the candidate-list read and
that specific candidate's claim attempt), which is presumably why only
the fault-hook case exists. **Not a confirmed defect** — the code path
inside the loop body is structurally identical for all of these failure
kinds (nothing in the `try`/`catch` is specific to `fault:<hook>`), so
there's no reason to expect the other kinds behave differently — but
the test suite's *discriminating power* for this specific rule rests on
one case, not several. Flagging for awareness, not blocking the
verdict.

Restored `cmd-next.ts` to the original and rebuilt after each mutation;
confirmed `git status`/`bundle --check` clean before moving on.

## 4. Replay vs. `c7-baseline`/`oracle-frozen-12`

`gate.js` itself stalled twice in a row in this session for reasons
unrelated to `nj next` (see the friction note left on TSK-043) — worked
around with the established direct-`baseline.js` technique instead
(nested worktree, `test/` swapped to `oracle-frozen-12`, digest-
confirmed match before running):

```
baseline: 7086 calls, nj sha256 4444cd04...
current : 7086 calls, current code sha256 ...b0fac741...
compared: 6463 calls (623 excluded as nondeterministic by design)
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
```

Exactly the 6-call help-class tally every prior v3.x round has shown.
**Confirmed byte-exact** via the unclipped-`baseline.js` technique
(throwaway clip/limit removal, never committed): across all 6 calls,
the "was" and "now" strings differ in **exactly one additional line**
beyond what was already accepted (the `--version` line from v3.4) —
the new `  nj next    [--as=…] [--status=…] [--type=…] [--tag=…]
[--parent=…] [--assignee=…]` line, inserted between `release` and
`doctor`, nothing else differing anywhere in either ~1,400-character
string.

`test/run-all.js` against this same frozen-`test/` snapshot (which
predates `ac-40-next.js`'s own existence, so it isn't in this count):
**79/80 pass, 0 failed, 1 expected cannot-run**
(`hardening-njrc-foreign-link.js`, the usual root-only gap). Confirmed
separately, against the *current* `test/`, that `ac-40-next.js` itself
is **88/88** (§ 1-3 above).

## 5. `list --ready` and bare `nj` — byte-unchanged

**Confirmed by construction**: `git diff c6d428b 596172c -- src/
commands/cmd-list.ts` is a one-line export-list addition
(`availableToActor`); `src/core/derive.ts` has no diff at all.

**Confirmed empirically, in the one fixture shape that would actually
exercise the difference D156 says stays unchanged** (an epic with its
own open task — exactly the case `next` now treats specially but
`list`/bare `nj` must not): built the identical fixture against both
the immediately-preceding commit (`c6d428b`) and `596172c`, diffed
`list --ready --json`, `list --ready` (human), and bare `nj`:
```
JSON: IDENTICAL
human list --ready: IDENTICAL
bare nj: IDENTICAL
```
The epic appears in "Ready to work" on both builds, unchanged — exactly
D156's stated scope (`list --ready`/bare `nj` unaffected, tracked on
TSK-043 for later, not changed now).

## Summary

`nj next` is implemented exactly to § 12b/D156's letter, confirmed by
diff review, live single- and multi-process reproduction at a real
concurrency scale, mutation-tested discrimination of the test suite,
byte-exact replay, and byte-exact non-regression of the two surfaces
the ruling explicitly says must stay untouched. One coverage note (not
a defect) on AC-40's mid-loop-failure discrimination resting on a
single case. **Pass.**
