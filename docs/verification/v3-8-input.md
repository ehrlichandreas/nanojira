# V3.8-A verification — `--input` JSON plans for `new`/`set` (`5df0f24`, D171 A, D172, D173, § 9, AC-52)

Verifier, 2026-10-07. Independent, **adversarial** verification, assigned
by the Lead — the brief named a real bug the Implementer's own 59-test
suite missed (a forward `@ref` silently wrote `depends_on: ["undefined"]`)
and asked me to look for more of that class. Work in `/tmp/verif-v38in`
(worktree at `5df0f24`, built via `npm ci` + `tools/bundle.js`),
`/tmp/verif-v38in-nested` (nested, `test/` swapped to `oracle-frozen-12`,
for the replay). Both removed before writing this. Read: DECISIONS 171
A, 172, 173 in full; the `--input` section of `docs/SPECIFICATION.md`
§ 9 in full (lines 1441-1770+); the full diffs of `d50b3fa` and
`5df0f24`; `test/ac/ac-52-input-plans.js` in full (82 checks); TSK-053's
own backlog notes, including both outside leads' real plan reviews.

**VERDICT: pass for everything AC-52 covers, with two found-and-confirmed
gaps in the `failed_at`/`created`/`refs` failure-shape discipline** — the
same general class of bug D173 fixed, not reopening it, but adjacent to
it: a fault-hook abort during a plan write, and a structural plan-shape
error (a non-object element, a non-array `children`), both bypass the
plan's own failure-enrichment path and surface as a bare `{ok, error}`
with no `failed_at` at all — contradicting § 9's explicit "on **both** a
mid-plan write failure and a validation failure." Confirmed live, not
inferred from reading. Every other adversarial probe (odd JSON, type
confusion, concurrency, `--dry-run`, `set --input`, both outside leads'
real plans) came back clean.

## 1. Content acceptance criteria

Re-ticked "the whole plan is validated before the first write; nothing
is written if any element is invalid, and `failed_at` names the
element" — confirmed holds for every **field-validation** failure
(type/title/parent/status/priority/tags/`ref`/`depends_on` shape and
ordering — all of `validatePlanNode`'s own checks), live, not merely
because AC-52 passes. **Does not hold, and I am flagging it rather than
quietly ticking around it**, for the two gaps in § 3 below — both are
failures that occur before or during the write phase and, in the fault
case specifically, is a **write** failure that still fails to carry
`failed_at`, unlike every other write failure in the same code path.
Per the standing instruction not to tick a content criterion I haven't
actually exercised against edge cases: I am ticking the **other**
content criteria below (each independently verified, live), but leaving
a note on this one specifically — see § 6 — since "nothing is written
if any element is invalid" is itself still true (confirmed: zero files
written in every failure case I tried, including both gaps), it's
specifically the "`failed_at` names the element" half of this criterion
that has two counterexamples.

All other content criteria confirmed live: the plan-with-children
single-call creation (§ 2); `@ref` resolution and the `invalid_value`
shape rules (§ 2, § 4); the mid-plan failure shape with `created`/
`refs`/`failed_at` (§ 2, § 3 — correct for every `Fail`-thrown failure,
the gap is specifically non-`Fail` and pre-loop paths); the success
shape (§ 2); `--dry-run` (§ 5); `acceptance` as an array (§ 2); `set
--input` (§ 5).

## 2. Diff review and live reproduction — the parts that hold

- **One call, a whole plan**: `flattenPlan` walks the array/`children`
  nesting into pre-order `FlatNode`s, each carrying its own JSON-path
  `path` (always `[0]`-anchored, even for a single object — confirmed:
  a single-object `--input` reports `failed_at: "[0]"` on a validation
  failure). **ID assignment and write order are the same fact**: the
  write loop walks `flat` in the identical order `flattenPlan` produced
  it, and a parent is always pushed into `flat` before any of its
  `children` (the recursive call happens *after* `out.push`) — so
  `realIdByIndex[v.parentIndex]` is always already populated by the
  time an implied-parent child is written. Confirmed structurally, and
  live with a 3-level epic→task→subtask plan (both outside leads'
  shapes, § 4).
- **`@ref` resolution, `D172`/`D173` rules**: `ref` must start with
  `@` and must not decorate a real-id shape (`REAL_ID_SHAPE` tested
  against the stripped value); a `depends_on` entry is looked up in
  `anyRefIndex` (exists anywhere in the plan) **and** `declaredSoFar`
  (exists *earlier*, grown strictly after each node's own checks
  finish) — confirmed live: forward ref, self-ref, and backward ref
  each behave exactly per spec (§ 4). Mixing a real existing id and a
  `@ref` in the same `depends_on` array resolves each independently and
  correctly (confirmed live, not an AC-52 leg).
- **`parent` is never `ref`-aware**: an explicit `"parent": "@x"` is
  rejected outright (`invalid_value`) before ever reaching a `ref`
  lookup — confirmed in the code and live.
- **The write-phase assertion** (`5df0f24`'s own fix): `throw new
  Error(...)` if a resolved `@ref`'s real id is somehow still
  `undefined` at write time. Confirmed this is a genuine, *reachable*
  safety net, not decorative: mutating away the D173 order check (§ 5)
  makes this assertion actually fire, surfacing as `internal_error` —
  proof the two layers are independent, not one silently relying on the
  other's absence.
- **Success/failure shapes**: singular vs. plural success shapes
  (`entry` vs. `ids`/`entries`/`refs`) match § 9 exactly, confirmed for
  both a lone object and a `children`-bearing one; `refs` is present
  (possibly `{}`) only in the plural shape, confirmed absent on a
  singular success.
- **Concurrent `nj new` during a plan write — IDs stay unique**: ran a
  31-node plan (1 epic + 30 tasks) simultaneously with 10 independent
  `nj new` calls (same backlog). Result: 41 elements, **zero duplicate
  IDs**, `nj doctor` reports `ok: true`, zero findings. The tombstone
  `O_CREAT|O_EXCL` allocator (unchanged, reused as-is per plan node)
  gives the same cross-process safety a single `nj new` already has.
- **`--dry-run` writes nothing, verified by file listing and mtimes,
  not just exit code**: recorded every file's path and mtime in a fresh
  backlog, ran a 3-node `--dry-run` plan, re-recorded — **byte-identical
  listing and mtimes**, confirming not even `.nanojira/ids/` was
  created (the dry-run branch returns before the write loop's first
  `allocateId` call, so no tombstone is burned either).
- **`set --input`**: mutually exclusive with field flags
  (`--input=- --status=doing` together → `invalid_value`, confirmed
  live); composes with `--id=A,B,C` batch (confirmed, one shared field
  map applied per ID independently); an array given to `set --input`
  is rejected outright (`set --input= takes exactly one object… set has
  no plan form`) — `new`'s own plan form is not silently accepted here.
- **Odd JSON, broad sweep**: a non-string title (a number) →
  `missing_argument` naming the exact node; a non-string `assignee`; a
  `tags` array containing a non-string item; duplicate JSON keys
  (`JSON.parse`'s own last-key-wins, confirmed the *written file*
  reflects the last value, not a merge or an error — standard, not
  nj-specific); a 100 000-character description plus a Japanese/emoji
  title — all succeed correctly, confirmed by reading the written file
  back; a `ref` with incidental trailing whitespace (`"@impl "`) does
  **not** match a `depends_on` of `"@impl"` (strict string comparison,
  correctly `not_found`, no silent trim).
- **Children on a subtask, explicit-parent+nesting conflict**: both
  rejected (`invalid_target` / `invalid_value` respectively), each
  carrying a correct `failed_at` (these come from `validatePlanNode`,
  which *is* properly wrapped — see § 3 for the contrast). A subtask
  given `"children": []` (an empty array, not absent) is **also**
  rejected the same way — `hadChildren` is computed from `!== undefined`,
  so an explicitly-empty `children` still counts as "has children." Not
  a bug (the conservative, safe reading), but worth knowing if anyone
  expects `"children": []` to be silently tolerated as a no-op.

## 3. The two `failed_at` gaps — found adversarially, confirmed live

**Gap A — a fault-hook abort during a plan write never carries
`failed_at` (or `created`/`refs`)**, even though it is squarely a
"mid-plan write failure" in spec's own words. `atomicWrite`
(`core/store.ts`) checks `NJ_FAULT` and, on a match, calls `hardExit()`
— which writes `{ok: false, error: code}` directly and calls
`process.exit(1)`. This bypasses `cmdNewInput`'s own `try/catch`
entirely (there is no JS exception to catch — the process is already
exiting), so `emitPlanFailure`'s enrichment (`created`, `refs`,
`failed_at`) never runs:

```
$ NJ_FAULT=after-tmp-write nj new --input=plan.json --json
nj: aborted at fault injection point after-tmp-write
{
  "ok": false,
  "error": "fault:after-tmp-write"
}
```

No `failed_at` — contradicting "`failed_at`… on **both** a mid-plan
write failure and a validation failure" (§ 9) and the closed-vocabulary
table's own `fault:<hook>` row, which doesn't carve out an exception for
`--input`'s additive field the way D163 D's override-flag column
explicitly does for other things. (`NJ_FAULT` doesn't "spend" itself
after one firing the way `batch.ts`'s own version does — confirmed by
reading `core/store.ts`'s `atomicWrite` — so every node's write in a
plan would hit the same fault; I could not construct a case where node
2+ specifically fails this way without node 1 already failing first,
but the **first** node of a plan is still unambiguously "a mid-plan
write failure," not a validation failure, so the missing `failed_at`
is a real gap regardless of which node it is.)

**Gap B — a structural plan-shape failure (`flattenPlan`'s own checks)
never carries `failed_at` either**, for a different, independent
reason: `flattenPlan(topArray, '', null, flat)` is called directly in
`cmdNewInput`, **outside** any `try/catch` — its `fail()` calls (a
non-object array element, `null`, or a non-array `children`) propagate
all the way to the top-level handler in `nj.ts`, which has no idea
`--input` was involved:

```
$ echo '[{"type":"epic","title":"E","description":"D."}, 42]' | nj new --input=- --json
Error: plan element at [1] must be a JSON object
{
  "ok": false,
  "error": "invalid_value"
}
```

Contrast this with the *next* line of defense, `validatePlanNode`'s own
checks (type/title/parent/etc.), which run inside the `try/catch` at
lines 502-511 and correctly produce `failed_at` every time — confirmed
live for a bad type, title, parent conflict, and the children-on-a-
subtask case. The gap is specifically the pre-loop structural pass in
`flattenPlan`, not the per-field validation that follows it. Reproduced
for all three of `flattenPlan`'s own `fail()` call sites (non-object
element, `null` element, non-array `children`).

**Both gaps leave the failure shape genuinely ambiguous to a caller
that relies on `failed_at`** (exactly the field both outside leads
asked for specifically so they would not have to "infer it from
`error`/`hint` prose alone," per § 9's own wording) — for a large,
deeply nested plan, "something near the top failed because it isn't an
object" with no path at all is a regression from the promise the rest
of the mechanism delivers on everywhere else. Neither gap writes
anything it shouldn't (confirmed: zero files in both cases, so the
"validated before the first write" / "nothing written" half of the
spec's promise holds even here) — the gap is narrowly about the missing
locator field, not data safety.

## 4. Both outside leads' real plans, built live

**team-a's plan shape (D1)** — a top-level **object** with an
**explicit** parent (an existing task), both with and without its own
`children`:

```
$ echo '{"type":"subtask","parent":"TSK-001","ref":"@impl", …}' | nj new --input=- --json
{"ok": true, "id": "SUB-001", "entry": {"parent": "TSK-001", …}, …}

$ echo '{"type":"task","parent":"EPIC-001","children":[…2 subtasks…]}' | nj new --input=- --json
{"ok": true, "ids": ["TSK-002","SUB-002","SUB-003"], "refs": {}, …}
```

Both ran exactly as team-a's own review of the draft described —
new work correctly nested under an *existing* epic/task, not a freshly
created one.

**team-b's plan shape (D2)** — an **array** of two top-level
subtasks sharing the same existing parent, the review `depends_on` its
own impl via `ref`, `acceptance` given as a JSON array:

```
$ echo '[{"type":"subtask","parent":"TSK-001","ref":"@impl","acceptance":["Route registered","Tests pass"]},
         {"type":"subtask","parent":"TSK-001","assignee":"bob","depends_on":["@impl"],"acceptance":["Code reviewed"]}]' \
  | nj new --input=- --json
{
  "ok": true, "ids": ["SUB-001", "SUB-002"],
  "entries": [ {"depends_on": []}, {"assignee": "bob", "depends_on": ["SUB-001"]} ],
  "refs": {"@impl": "SUB-001"}
}
```

Confirmed the written file for `SUB-001` renders the `acceptance` array
as two real `- [ ] …` checkbox lines (read the file back directly, not
just the JSON echo) — `acceptance:no_checkbox` cannot occur through
this path, exactly as D172 item 6 promises.

## 5. Mutation testing

- **Removing the D173 order check** (`declaredSoFar.has(d)` →
  unconditionally false): AC-52's B7 (self-reference) and B8 (forward
  reference across subtrees) both fail cleanly — and B8's failure mode
  under the mutation is itself informative: it surfaces as
  `internal_error`, meaning the *other* safety net (the write-phase
  assertion) caught what the order check would have — independent,
  overlapping protection, not one silently depending on the other.
- **Removing the write-phase assert** (the `throw new Error(...)` →
  silently returning the string `'undefined'`, reverting to the
  original D173 bug's exact symptom), **with the order check left
  intact**: AC-52 still passes **82/82**. This is expected, not a
  coverage gap to fix: with the order check in place, the code path the
  assertion guards is unreachable through any input the validator
  allows — the assertion is deliberate defense-in-depth for an
  invariant the validator should already guarantee, and the mutation
  above (removing the order check instead) is precisely the
  demonstration that it still catches a real violation when the first
  layer fails. Restored; `tools/bundle.js --check` confirms byte-
  identical after both mutations.

## 6. Sanity suite and replay

- **`run-all.js`**: **95/97 passed, 0 failed, 2 cannot-run** (the usual
  environment-conditional pair). Clean.
- **Replay vs `oracle-frozen-12`**: `TMPDIR` pointed at the same clean
  root every round since D169 has used (not `NJ_TEST_ROOT` — that
  lesson from the TSK-054/055 round doesn't apply here since no
  throwaway, dependency-free worktree is involved this time):

  ```
  RED VERDICTS (3): ac/ac-17-configuration.js, ac/ac-29-stale-claims.js, edge/doctor-fix-surface.js
  BEHAVIOUR CHANGED — 540 differing call(s): (bare) 104, set 88, --json 86, show 84, doctor 55,
    list 48, tree 44, new 5, help 4, note 4, rm 3, --help 2, find 2, check 2, archive 2,
    unarchive 2, claim 2, release 2, --backlog=<SCRATCH>/store/bl 1
  ```

  **Exactly 540, the identical per-command breakdown as the TSK-054/055
  round** — confirming `--input` introduces zero new replay divergence,
  matching D171 A's own "the new classes allowed are help text, the
  additive `released`/`entry` fields, and nothing else" and the
  Implementer's own claim ("gate replay unchanged at the same 540 calls
  byte-for-byte"). The three RED verdicts are the same three,
  already-explained, pre-existing staleness from every prior round.

## 7. What this means for the content criterion

Both gaps are narrow (a missing locator field on two specific,
uncommon failure classes — a fault injection, and a plan whose shape is
malformed before any field is even looked at) and neither compromises
the "nothing written on failure" guarantee. They are real, though, and
match the exact pattern the Lead asked me to hunt for: a path through
this feature that the 82-check suite's own construction doesn't reach,
where the code *looks* like it upholds a promise (every failure gets a
`failed_at`) but two call sites don't go through the mechanism that
makes that true. Recommend: either wrap `flattenPlan`'s own `fail()`
calls through the same `emitPlanFailure` path `validatePlanNode`'s
checks already use (straightforward — `flattenPlan`'s own caller already
knows the top-level array/object it started from), and decide
deliberately whether a fault-hook abort during `--input` should also
carry `failed_at` (naming whichever node's write was in flight) or
whether `--input`'s own spec gets an explicit, stated exception for the
fault-hook case the way the override-flag column already has one for
`fault:<hook>` generally.
