# V3.8 B/C verification — final status releases the claim; `show --json` single `entry` (`8cae662`, D171 B/C, § 12a, § 9, AC-50/51)

Verifier, 2026-10-07. Independent verification, assigned by the Lead.
Work in `/tmp/verif-v38bc` (worktree pinned at `8cae662`, built via `npm
ci` + `tools/bundle.js` — main itself moved on to V3.8-A's `--input`
implementation while this round ran, so the pin matters), `/tmp/verif-v38bc-nested`
(nested, `test/` swapped to `oracle-frozen-12`, for the replay). Both
removed before writing this. Read: DECISIONS 171 B/C in full, `§ 12a`
"Final status releases the claim", `§ 9`'s JSON-shapes table (the `show`
row), the full `c24e702` diff (spec + AC-50/AC-51), `8cae662`'s own
diff (implementation); `test/ac/ac-50-done-releases-claim.js` and
`ac-51-show-entry.js` in full (23 + 12 checks).

**VERDICT: pass.** Both mechanisms match spec exactly — confirmed by
diff review, extensive live reproduction (including two scenarios
AC-50 itself doesn't cover: a fault-injected rollback on the
`claim --status=<last>` double-append path, and a 20-way parallel
`set`/`claim` race), mutation testing (all three requested mutations
caught cleanly), and a byte-exact replay fully reconciled: 540 = 457
known (unchanged) + 83 new, every one of the 83 carrying `entry`
newly added to a `show` call, a new `.nanojira/claims/<id>/2` file, or
(in the frozen corpus actually exercised here) both — nothing left
over, and `released` itself never gets exercised by this particular
corpus for an incidental reason explained in § 5 below, not a gap in
the implementation.

## 1. Content acceptance criteria

Per the new convention, checked each content criterion individually
against what was actually confirmed, not just the process line:

**TSK-054** — "setting the last status via `set` or `claim --status`
releases the element's claim, whoever holds it" (§ 2 below); "the
result reports `released: <holder>`, only when a release happened"
(§ 2, AC-50 B1/B2); "a refused `done` (`children_open`) releases
nothing; a forced `done` does" (§ 2, AC-50 B3/B4, confirmed live); "a
failed write rolls the release back" (§ 3, live fault-injection,
*beyond* what AC-50 itself tests).

**TSK-055** — "`show --json` with exactly one element also carries
`entry`, identical to `entries[0]`" (§ 4, AC-51 C1/C2); "no `entry` for
several elements, and never on `list`/`find`" (§ 4, AC-51 C3/C4).

## 2. Diff review: `releaseUnconditional`/`undoRelease` (`core/claims.ts`)

`releaseUnconditional` reads the highest claims entry; if unclaimed,
terminates with `undefined` (no append at all — matches "unclaimed: no
release happens at all, not even an empty one," confirmed the claims
directory gains no new generation in this case). If claimed, it appends
`released` naming **whoever currently holds it** — there is no
comparison against any acting name anywhere in this function, matching
"unconditional… not `nj release`'s own ownership check" precisely.
`setsFinalStatus` (`cmd-set.ts`) and its twin in `cmd-claim.ts` both
compare against `ctx.cfg.statuses[ctx.cfg.statuses.length - 1]` — the
actual configured last status, never a hardcoded `'done'` — matching
"the last configured status" exactly. `cmd-next.ts` imports and reuses
`claimOne` from `cmd-claim.ts` directly (not a parallel reimplementation),
so `next --status=<last>` inherits the mechanism automatically, exactly
as spec claims.

**Ordering and rollback**: in both `cmd-set.ts`'s single-element and
batch paths, `releaseUnconditional` runs **before**
`guardedWriteCatchable`, and the `catch` block calls `undoRelease`
before re-throwing — matching "attempted first, optimistically… if the
guarded write fails, the release is always rolled back." `undoRelease`
re-reads the current generation fresh (never trusting the generation
`releaseUnconditional` itself returned) before rolling back — this
matters specifically for `claim --status=<last>`, where the claim's own
rollback is a **second**, separate append that can move the generation
on between `releaseUnconditional` returning and `undoRelease` running;
confirmed this is exactly what the code does, not merely commented as
intentional.

**`nj-mcp`**: no `set`/`claim`/`next` code was touched for this round
(confirmed via `git show --stat 8cae662` — only `core/claims.ts`,
`cmd-set.ts`, `cmd-claim.ts`, `core/derive.ts` for `entry`/`entryJson`,
`cmd-show.ts`); every MCP tool spawns `dist/nj --json` and returns its
output verbatim, so `released` surfaces automatically — confirmed live
in § 3.

## 3. Live reproduction — including two scenarios beyond AC-50's own coverage

- `set --status=done` on a claimed element: `released: "alice"`, `nj
  log` shows `claimed by alice` then `released by alice` at the same
  timestamp, in that order, via the existing generic `allEntriesAscending`
  path in `cmd-log.ts` (no `log`-specific code needed — it already reads
  every claims generation, so a new `released` generation shows up for
  free).
- `claim --status=done`: `released: "alice"`, `claim: null` in the same
  result, `nj log` shows the chained pair (`claimed`, `released`) —
  matches B5 exactly.
- **Rollback under `NJ_FAULT=after-tmp-write` on `set --status=done`**
  (not in AC-50): the write aborts (`fault:after-tmp-write`), and the
  claim is restored — `_claim` shows `{by: "alice", ...}` again, and
  `nj log` shows a **fourth** entry (`claimed by alice` again, a new
  generation, not an in-place revert) — confirms "the generations must
  stay consistent" holds under the append-only model even on rollback.
- **Rollback on `claim --status=done` specifically** (the harder case
  the spec calls out by name — two chained appends, not one): under the
  same fault, the final state correctly returns to **fully unclaimed**
  (the pre-call state), via **two** separate rollback appends —
  `undoRelease` undoes the release (re-asserting `claimed alice`), then
  `claimOne`'s own rollback (since this was a brand-new claim, not a
  re-assertion of a pre-existing one) undoes the claim itself
  (`released alice`) — `nj log` shows all four entries
  (`claimed`/`released`/`claimed`/`released`) and the final `_claim` is
  `null`, exactly matching the state before the call started. This is
  the specific double-rollback interplay § 12a's own prose describes
  ("a rollback that meets a newer generation abandons… the newer holder
  is the holder") and it behaves correctly under an actual fault
  injection, not just by inspection.
- **MCP**: a real `tools/call` round-trip (`initialize` →
  `notifications/initialized` → `tools/call` for `set`) on a claimed
  element reaching `done` returns `released: "alice"` in both the text
  content and `structuredContent` — confirmed live, not assumed from
  "no code change was needed."
- **A 20-way parallel race** (not in AC-50): ran `set --status=done`
  and `claim --as=bob` simultaneously against the same 20 pre-claimed
  elements. Outcomes: 15/20 `claim` correctly refused
  (`refused:claimed`, naming alice — it read before the release landed);
  2/20 both succeeded (claim landed after the release, element ends
  `done`+claimed by bob); **3/20 produced a `changed_in_parallel` on the
  `claim` side** — traced this to `compareGuard`'s own, pre-existing
  retry-exhaustion on the **element file** itself (the hint text is
  literally `STABLE_HINT`, `cmd-claim.ts`'s own string for this exact
  case), under file-write contention from the simultaneous `set` call —
  **not** the claims-CAS loop's 100-round bound. One of these three
  (`TSK-017`) is a genuinely interesting compound case: the claims-CAS
  append for `claimed bob` **succeeded**, but the subsequent element-file
  mirror write then failed under contention, and `claimOne`'s own
  rollback correctly reverted the claims-side append too (`released
  bob`, a fifth log entry) — the caller's `changed_in_parallel` result
  and the final `_claim: null` are fully consistent with each other.
  `nj doctor` across all 20 elements afterward: `ok: true`, **zero**
  findings — no `claim:mismatch`, `claim:orphaned`, or anything else.
  This is a real, non-trivial stress case beyond what AC-50 constructs,
  and the rollback discipline held under it.

## 4. Diff review and live reproduction: `show --json`'s `entry` (`cmd-show.ts`)

`cmdShow`'s JSON branch: `entries.length === 1 ? { entry: entries[0] }
: {}` — one ternary, additive, `entry` is literally the same object
reference as `entries[0]` (not a re-derived copy), so there is no risk
of the two drifting apart from each other now or after a future change.
Confirmed `list`/`find`/`tree` were not touched at all (`grep -n
"entry:"` across all three returns nothing). Live: `show --id=<single>`
and `show --file=<path>` both carry `entry`; a hand-created
`duplicate_id` pair (`entries.length === 2`) carries **no** `entry` key
at all (`'entry' in r.json` is `false`, not `entry: undefined`); `list`
and `find` resolving to exactly one element still carry no `entry` —
confirmed AC-51's own C4 leg live, independently.

## 5. Mutation testing — all three requested mutations, caught cleanly

- **Release only a specific name's claim** (not "whoever holds it"):
  changed `releaseUnconditional`'s decision to require `held === 'bob'`
  — AC-50 B1, B4, B5, B6, B7 all fail (every one of them was claimed by
  `alice`, never released under the mutation). This is the one spec
  property (`set` has no actor at all, so this is the only way to prove
  "unconditional" is really unconditional) and it's exercised by every
  AC-50 leg that claims as `alice`.
- **Release even on a refusal**: moved the `releaseUnconditional` call
  in `cmd-set.ts`'s single-element path to *before*
  `collectSetOverrides` (i.e. before the `children_open` check can
  refuse). AC-50 B3 — the exact case this targets — fails cleanly
  (claim released despite the refusal); B1/B4/B8 also fail as a side
  effect of the cruder mutation (releasing unconditionally regardless
  of final-status, not only on refusal), which doesn't weaken the
  result — B3 alone is sufficient proof the test discriminates this
  case.
- **`entry` on `list`**: added the same `entries.length === 1 ? {
  entry: entries[0] } : {}` ternary to `cmd-list.ts`'s JSON branch.
  AC-51 C4 — the exact leg for this — fails cleanly, nothing else
  affected.

`src/core/claims.ts`, `src/commands/cmd-set.ts`, `src/commands/cmd-list.ts`
all restored after each mutation; `tools/bundle.js --check` confirms
`dist/nj`/`dist/nj-mcp` byte-identical to a fresh, unmutated build.

## 6. Replay vs `oracle-frozen-12` — 540 = 457 + 83, fully reconciled

Nested worktree pinned at `8cae662`, `test/` swapped to
`oracle-frozen-12`, digest confirmed matching. First attempt used
`NJ_TEST_ROOT` nested *inside* the same git worktree being replayed (the
fix the task suggested, intended for `ac-32-mcp-sdk.js`) and produced a
spurious **6463**-call "BEHAVIOUR CHANGED" — traced this immediately: it
wasn't a real regression, it was my own setup mistake. Nesting the
scratch root inside the worktree's own tree broke the `<SCRATCH>`
placeholder normalisation used to compare fixture paths against the
frozen baseline (every path-bearing call differed only in its scratch
directory's text, not in any real behaviour). Confirmed the fix:
`ac-32-mcp-sdk.js` only needed `node_modules` reachable at all, and the
nested worktree already has its own, real `node_modules` from its own
`npm ci` — so `NJ_TEST_ROOT` wasn't needed here in the first place (it
matters for `gate.js`'s *own*, separately-created, dependency-free
throwaway worktree, not for a replay run directly inside an already-`npm
ci`'d clone). Re-ran with plain `TMPDIR` pointed at the same clean root
every prior round used:

```
baseline: 7086 calls, nj sha256 4444cd04fd23...
current : 7086 calls, current code sha256 (nj, 1 files) 7739e847...
compared: 6463 calls (623 excluded as nondeterministic by design — concurrency)

RED VERDICTS (3): ac/ac-17-configuration.js, ac/ac-29-stale-claims.js, edge/doctor-fix-surface.js
BEHAVIOUR CHANGED — 540 differing call(s): (bare) 104, set 88, --json 86, show 84, doctor 55,
  list 48, tree 44, new 5, help 4, note 4, rm 3, --help 2, find 2, check 2, archive 2,
  unarchive 2, claim 2, release 2, --backlog=<SCRATCH>/store/bl 1
```

**Exactly 540**, matching the Implementer's report. The three RED
verdicts are the same three, already-explained, pre-existing
frozen-corpus staleness from every prior round (D166's `config:unknown_key`
leniency and the leaf rule, both predating v3.8) — nothing new.

**Reconciled all 540 by content**, not by the per-command label above
(which mixes causes under one command name): parsed every block in the
uncapped `--diff-out` file and classified each by what actually
changed, confirming membership by direct string inspection of `was`/`now`,
not just a label:

| Class | Count | What it is |
|---|---|---|
| Leaf rule (container w/ open child dropping from `ready[]`) | 171 | unchanged from every prior round |
| HELP text (`--version`/`log`/`next` lines) | 6 | unchanged |
| The named `--backlog=<SCRATCH>/store/bl` leaf-rule call | 1 | unchanged (3 *more* calls under the same backlog flag are new — see below) |
| The batch-1/2 `set` "Known fields" hint (`add-tags`, `remove-tags`) | 22 | unchanged |
| `config:unknown_key` replacing a stale `invalid_config` (`ac-17`/`ac-29`'s own fixtures) | 40 | unchanged |
| The v3.7 E/F acceptance-quality warnings appearing in `_problems`/doctor/write feedback | ~215 | unchanged (a couple of these calls *also* gained `entry`, see below) |
| **`entry` newly added to a `show` call** (the C change) | **78**, plus 3 more under the `--backlog=<SCRATCH>/store/bl` flag = **81** | every one confirmed by direct `was`/`now` comparison: no `"entry":` key in `was`, present in `now`, and the command is `show` |
| **A new `.nanojira/claims/<id>/2` file appearing** (the B change, file-level) | **4** | all four from `ac/ac-27-claim.js`'s own `set --id=TSK-001 --status=done` (and the one `doctor --fix --json` that reads the same backlog afterward) — `differs in: after`, a brand-new claims generation file, no `released` in `stdout` because these particular calls never use `--json` |

**Total: 540, zero left unclassified.** `released` itself never appears
anywhere in the 6463-call uncapped diff output (`grep -c released` →
`0`) — traced why, not just noted: the frozen corpus (both
`oracle-frozen-12`'s own AC suites and `baseline.js`'s ad-hoc fixture
scripts) simply never happens to combine "claim an element" with
"reach the final status **via `--json`**" in the same scenario —
`ac-27-claim.js`'s own claim-then-done fixture exists (hence the 4
claims-file diffs above) but only exercises it in prose mode, where
`released` is never printed to begin with (confirmed: `writeFeedback`'s
template has no release-related line — the spec's additive-field
promise is specifically about the JSON result, and prose output was
never required to mention it). This is a property of what this
particular frozen corpus happens to construct, not a gap in B's own
implementation, which §§ 2-3 above already confirm directly, live,
independent of the replay corpus's own coverage.

## 7. Sanity suite (`run-all.js`)

94→97 suites now (AC-52 added since the last round): **94 passed, 1
failed, 2 cannot-run**. The one failure, `ac/ac-52-input-plans.js` (35
of 59 red), is V3.8-A (`--input`) — out of this task's scope entirely;
confirmed its own commit (`7df47b5`, landed *before* `8cae662`, so
already present in my pinned worktree) states plainly in its own
message that "35 red today (--input does not exist at all yet)" — the
implementation lands separately (the Implementer's own parallel work,
confirmed still in progress as of this writing). Not a regression from
B/C. The two cannot-runs are the usual environment-conditional pair.
