# V3.7 A/B/C/D verification — `rm --help`, `--add-tags`/`--remove-tags`, release docs (HEAD `a307ef6`, D163 A-D)

Verifier, 2026-10-07. Independent verification, assigned by the Lead.
Work in `/tmp/verif-v37ab` (worktree at HEAD `a307ef6`, built via `npm ci`
+ `tools/bundle.js`), `/tmp/verif-v37ab-nested` (nested, `test/` swapped
to `oracle-frozen-12`, for the replay). Both removed before writing this.
Read: DECISIONS 163 A-D in full, SPECIFICATION.md § 9 ("Rules",
"Failure codes — spec-named paths"), § 10a-adjacent `--add-tags`/
`--remove-tags` prose, § 15 item 48, GUIDE § 8's new section; the full
diffs of `8adba8f`/`64eb967` (spec+tests), `0a857fe` (the Oracle's own
B8 vacuous-check fix), `6f098f5` (C/D docs), `c4f52b6` (implementation);
`test/ac/ac-46-per-command-help.js` P7 and `test/ac/ac-48-tags-add-remove.js`
in full.

**VERDICT: pass** for A, B, C and D, with two findings for the Oracle:
one documentation defect (a contradictory sentence in SPECIFICATION.md's
own prose for the both-lists tag case) and one documentation gap (a
missing row in the new override-flag table). Neither is a code defect —
the implementation, AC-48, and the spec's own § 15 summary all agree
with each other; only one paragraph of § 9's detailed prose disagrees
with the other three.

## 1. `rm --help` (A)

`core/flag-table.ts` gained `rm: { fields: [str('id'), str('file'),
bool('cascade')] }` — the only change needed, since `commandHelp()`
already renders a per-flag detail block generically from whatever table
entry exists. Confirmed live: `nj rm --help` now prints its synopsis
plus `--id` / `--file` / `--cascade` each on their own line, exit 0.
Confirmed `rm` remains absent from `nj-mcp`'s `TOOL_NAMES` (`src/nj-mcp.ts`)
— the two gates (CLI help's flag-table lookup vs. MCP tool exposure) are
independent, exactly as the task description says, and this change
touches only the first. `test/ac/ac-46-per-command-help.js` P7 (added
this round, 4 of 35 checks were red before the fix) passes in full
(35/35) — it specifically checks for a real, blank-line-separated
flag-detail block, not merely the words already present in `rm`'s own
synopsis line, so it couldn't have passed by coincidence against the
unfixed build.

## 2. `set --add-tags` / `--remove-tags` (B)

**Diff review.** `applyTagsEdits` (`cmd-set.ts`) does exactly "remove,
then add": `current.filter(t => !remove.includes(t))` first, then an
`includes` guard while appending each `add` entry — so a tag named in
both lists is removed from its old position and, since it's no longer
in `kept` at that point, genuinely re-appended at the end; a repeat
within `--add-tags` itself is caught by the same guard on its second
occurrence. `validateTagsCombination` rejects any call naming `--tags`
alongside either incremental flag, called from both `validateFieldValues`
(the batch-wide preflight) and `collectSetOverrides` (the per-element
path) — confirmed both call sites exist, so batch writes get the same
rejection before any ID is touched. `add-tags`/`remove-tags` are plain
entries in `set`'s `flag-table.ts` row, so `nj-mcp`'s schema and the
CLI's own `checkFlags` both pick them up for free from the one table —
confirmed no separate schema-generation code was touched. Each tag is
validated through the same `parseListFlag` `--tags` already uses
(comma-split, trim, reject items containing `]`) — one function, not a
parallel implementation.

**Live reproduction**, CLI and MCP:
- `set --remove-tags=a --add-tags=a,d` on `a,b,c` → `b,c,a,d` (the
  both-lists case, moved to the end) — confirmed via direct CLI call
  and independently via a real `nj-mcp` `tools/call` round-trip
  (`initialize` → `notifications/initialized` → `tools/call`), result
  `tags: ["b","c","a","d"]`, matching the CLI exactly.
- `nj-mcp`'s `tools/list` for `set` carries `add-tags`/`remove-tags` as
  two plain string fields.
- `--tags=x` combined with `--add-tags`/`--remove-tags`/both: all three
  combinations are `invalid_value`, nothing written (confirmed via a
  follow-up `show` reading back the untouched original tags).

**Mutation testing**, both caught cleanly by `test/ac/ac-48-tags-add-remove.js`
(38 checks) run directly against the mutated, rebuilt `dist/nj`:
- **Swapped order** (add-then-remove): only B6 fails (`b,c,a,d` expected,
  `b,c,d` got — the tag added before removal gets removed right back
  out), confirming B6 is the one case that actually pins the order.
- **Allowed `--tags=` to combine**: all three B8 sub-cases fail (wrong
  exit code, missing `invalid_value`, and a follow-up `show` proving the
  mutated build actually wrote `--tags=x`'s value instead of refusing).

`suggest.ts`/`cmd-set.ts` restored afterward; `tools/bundle.js --check`
confirms `dist/nj`/`dist/nj-mcp` byte-identical to a fresh, unmutated
build.

**Finding (documentation, not code): SPECIFICATION.md's own prose
contradicts the pinned AC-48 B6 behaviour, the implementation, and the
spec's own § 15 summary.** § 9's detailed description of
`--add-tags`/`--remove-tags` says: "adding one already present,
including one just re-added after appearing in both `--remove-tags` and
`--add-tags`, is a no-op for that tag: it is not duplicated, and does
not move." Read against the algorithm the same paragraph pins
("remove, then add… appended to what remains — but only if it is not
already present *there*"), a tag named in both lists is **not** already
present in "what remains" (it was just removed), so by the very rule
this sentence is glossing, it genuinely gets re-appended at the end —
which is exactly B6's pinned behaviour (`b,c,a,d`, "a moved to the end,
not left at the front") and exactly what `applyTagsEdits` does. § 15
item 48's own summary of the same feature doesn't make this claim at
all ("Adding a present tag… is a no-op", silent on the both-lists case).
This one parenthetical in § 9 appears to be a leftover from an earlier
draft of the rule and should be corrected or removed — it currently
tells a reader the opposite of what AC-48 B6 (and the code) actually
do.

## 3. Replay vs `oracle-frozen-12`, with `--diff-out`

Nested worktree at HEAD, `test/` swapped to `oracle-frozen-12`, digest
confirmed matching. Run with the same clean `TMPDIR` prior rounds used:

```
baseline: 7086 calls, nj sha256 4444cd04fd23...
current : 7086 calls, current code sha256 (nj, 1 files) 08256f99...
compared: 6463 calls (623 excluded as nondeterministic by design — concurrency)

RED VERDICTS (2):
  oracle suite failed: edge/doctor-fix-surface.js
  scratch verify.js: ✗ SEVERITY = § 7's problem codes with their Doctor levels (...)

BEHAVIOUR CHANGED — 217 differing call(s): (bare) 102, --json 86, set 22, help 4, --help 2, --backlog=<SCRATCH>/store/bl 1
```

**217 = 195 (batch 1/2's own tally, unchanged) + 22 new**, exactly
matching the Implementer's report. Confirmed via `grep -nE "^  #[0-9]+
\[.*\] nj set\b"` on the uncapped `--diff-out` file: exactly 22 matches,
and every one of them differs *only* in the `Known fields:` list (hint
and/or `--json`'s `hint` field) gaining `, add-tags, remove-tags` at the
end — spot-checked in full (`#275`, `#284`, `#293`, `#302`, …) and
confirmed none differs in exit code or in any other field. No other
category changed from batch 2's own reported breakdown (bare 102,
`--json` 86, help 4, `--help` 2, the one `--backlog=<SCRATCH>/store/bl`
call) — all of those remain the leaf-rule/help-text classes already
explained in the batch 1/2 reports.

`edge/doctor-fix-surface.js` is the same pre-existing, already-explained
stale fixture from prior rounds — nothing new.

**The second RED verdict, `scratch verify.js`'s `SEVERITY` check, is
also pre-existing and out of this task's scope, confirmed by tracing it,
not assumed.** Re-ran `verify.js` directly (`node
tools/refactor-harness/scratch/verify.js "$(pwd)/dist/nj"`, absolute
path required — it spawns `nj` from fixture directories with varying
`cwd`): `36 declared, 40 in § 7… missing: acceptance:no_checkbox,
done:no_acceptance`. Both codes were added to § 7's table in commit
`6f12ca1` ("D165: problems.ignore") as part of the **next** round
(DECISIONS 163 E/F, the acceptance-quality warnings) — confirmed absent
from `src/` entirely (`grep` for either string returns nothing) and
confirmed `test/ac/ac-49-acceptance-quality.js` (which exercises them)
is itself a pre-written red test for that same not-yet-landed work
("promoted: commit `<pending>`"). `verify.js`'s own `PENDING` allowlist
already has a precedent for exactly this situation — it already lists
`backlog:status_stale` (V3-3) and `backlog:legacy_layout` (V3-4) as
spec'd-ahead-of-code — but hasn't yet been updated for E/F's two new
codes. Not a regression from A/B/C/D, and not this task's work to fix;
worth a one-line addition to `PENDING` whenever E/F lands (or now, if
convenient for the Oracle).

## 4. `docs/CHANGES`-equivalent checks: GUIDE § 8 and the override-flag table (C/D)

**C — `layout.statusFile: false` for shared trees.** Live-verified on a
fresh backlog: flipped `statusFile` to `false` in `.nanojira/config.json`
(merged into the existing `layout` block, as the GUIDE's own snippet
shows), then made a further write (`nj new --type=task …`). `STATUS.md`'s
contents were byte-identical before and after — confirmed by a direct
string comparison, not just "looks the same". `nj doctor` reported `0
warnings` even though `STATUS.md` was now objectively stale relative to
the backlog's real state (no `backlog:status_stale`) — matching "doctor
does not check `STATUS.md` at all" exactly. Both replacement views work
as described: bare `nj` (counts + "Ready to work") and `nj list --json`
(every element, filterable) — neither one touched any file.

**D — the override-flag column.** Grepped every `fail('refused:…', …)`
call site across `src/` (19 found) and every `flags.has('force'
|'cascade'|'steal'|'allow-open-children')` check (4 found, one per real
override), cross-checked each against its row in the new table:
- **The 4 real overrides are correctly placed**: `changed_in_parallel`
  (set/note/check only) → `--force`; `refused:children_open` →
  `--allow-open-children`; `refused:has_children` (rm) → `--cascade`;
  `claim`'s `refused:claimed` → `--steal=<holder>`.
- **No override is claimed that doesn't exist**: spot-checked
  `archive`/`unarchive` (their own `STABLE_HINT` text says "takes no
  `--force`" — confirmed no `force` check anywhere in either file,
  table says `—`), and `claim`'s own `changed_in_parallel` (the
  100-round-exhaustion path, a *different* row from `has_children`'s
  — confirmed no `force` check there either, table says `—`).
- **One row is missing** (finding, not a code defect):
  `refused:unreadable_dir` (`core/context.ts`'s `requireNoUnreadableDirs`,
  called from `rm`, `archive`, and `set --status=done`) has no row in
  either the new override-flag table *or* the pre-existing "Failure
  codes — closed vocabulary" enumeration (`refused:<reason> reason ∈
  unreadable | archived | …` never lists `unreadable_dir`), even though
  it's live, reachable code dating to v3.2 (DECISIONS 106 F4, "additive"),
  tested in `test/edge/v3-2-regressions.js` and others. It has no
  override (confirmed: no flag check in `requireNoUnreadableDirs`), so
  the correct row would simply read `—`, same as plain `refused:unreadable`
  — this is a gap in the table's coverage, not a missing feature, but it
  means D's own claim ("found by grepping every … call site") missed
  one call site. Worth a one-line addition.

`docs/AGENT-INSTRUCTIONS.md` confirmed pointing at the "Override flag"
column by name. Confirmed via `git show --stat 6f098f5` that C/D touch
only `docs/GUIDE.md`, `docs/SPECIFICATION.md`, `docs/AGENT-INSTRUCTIONS.md`
— no `src/`/`dist/` changes, so the `--json` shape claim ("unchanged")
holds trivially.

## 5. Sanity suite (`run-all.js`)

94 suites: **91 passed, 1 failed, 2 cannot-run** (the usual
environment-conditional pair). The one failure,
`ac/ac-49-acceptance-quality.js`, is the same not-yet-landed D163 E/F
work identified in § 3 above — out of this task's scope, not a
regression from A/B/C/D.
