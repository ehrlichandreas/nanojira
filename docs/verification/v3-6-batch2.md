# V3.6 batch 2 verification — per-command `--help`, did-you-mean, D160, release docs (`6837504`, D158 D, D160, AC-46/47)

Verifier, 2026-10-07. Independent verification, assigned by the Lead.
Work in `/tmp/verif-v36b2` (worktree at `6837504`, built via `npm ci` +
`tools/bundle.js`), `/tmp/verif-v36b2-nested` (nested, `test/` swapped to
`oracle-frozen-12`, for the replay), `/tmp/verif-v36b2-parallel` (scratch,
for the run-all concurrency check). All removed before writing this.
Read: SPECIFICATION.md § 9 "`--help` (per-command)" and "Did-you-mean" in
full, DECISIONS 158 D and 160 (+ addendum) in full, the full diffs of
`335a0df` (per-command help/did-you-mean), `628a618` (D160 tightening),
and `6837504` (release docs), `test/ac/ac-46-per-command-help.js` and
`ac-47-did-you-mean.js` in full, `docs/CHANGES.md` and the relevant
`docs/GUIDE.md` sections in full.

**VERDICT: pass.** Per-command `--help` and did-you-mean are implemented
exactly as spec/DECISIONS 158 D and 160 describe, confirmed by diff
review, live reproduction across every command, and mutation testing
(both mutations caught cleanly). The replay against `oracle-frozen-12`
reproduces exactly batch 1's 195 differing calls — zero hint-related
diffs, explained below, not a loss of coverage. Every `docs/CHANGES.md`
claim and the two amended GUIDE sections were run live against the
3.6.0 build and hold exactly as written. The reported `run-all` slowness
was reproduced in its component parts (three genuine, by-design ~10s
blocking waits in the fault-tolerance suites) but not as an actual hang
or as lock/marker contention between concurrent runs — explained below.
One minor, non-blocking observation: `nj rm --help` doesn't list `--id`/
`--cascade` as flag lines (unlike every other command with real flags),
because `rm` has no entry in `core/flag-table.ts` at all (deliberately,
since `rm` isn't exposed via MCP) and `commandHelp()` silently falls
back to synopsis-only for any command missing from that table — not
wrong (exit 0, the synopsis still names both flags literally), just the
one command where the fallback actually loses information.

## 1. Diff review

**Per-command `--help` (§ 9, EV-2).** `nj.ts`'s dispatch (`cmd === 'help'`
→ general `HELP`; `flags.has('help')` → `commandHelp(cmd, flags)` when
`cmd` is non-null, else general `HELP`) preserves `--help`/`help`'s
existing precedence — checked before the command switch, before any
flag validation — exactly as before; only the *destination* text changed
for a command word. `commandHelp` (`core/help.ts`) extracts a command's
synopsis via `synopsisFor`, a small state machine over `HELP`'s own text
(one source, confirmed: no second copy of any synopsis line exists
anywhere in the diff), then appends one line per flag from
`commandFields(command)` (`core/flag-table.ts`) — the same table
`nj-mcp`'s schemas read, confirmed by the diff touching only `help.ts`/
`nj.ts`, not `flag-table.ts` itself. A closed-vocabulary field
(`type`/`status`/`priority`) gets its allowed-values line from
`closedVocab`, which hard-codes `TYPES`/`PRIORITIES` (never configurable)
and resolves `status` via the exact `findBacklog`/`loadConfig` path every
other command uses, wrapped in a `try/catch` that falls back to
`DEFAULT_CONFIG.statuses` on *any* thrown failure — confirmed this
covers both "no backlog at all" (`findBacklog` throws) and "a backlog
whose config is invalid" (`loadConfig` returns `errors.length > 0`,
explicitly checked), matching "best-effort and silent, same discipline
`--version` has."

**Did-you-mean (§ 9, EV-3; DECISIONS 160 + addendum).** `core/suggest.ts`
centralises the synonym table (checked first, verbatim — confirmed only
`medium→normal` exists, exactly as documented) and `osaDistance`, a
standard optimal-string-alignment DP: Levenshtein's three operations
plus one extra transition (`v = Math.min(v, d[i-2][j-2]+1)`) guarded by
`a[i-1]===b[j-2] && a[i-2]===b[j-1]` — the adjacent-transposition check,
confirmed present and reached only for `i>1 && j>1` (never indexes
negative). `suggestValue`'s threshold is `value.length <= 4 ? 1 : 2`,
applied to the *minimum* distance across all allowed values, and only
returned when exactly one value attains it (`best.length === 1`) — a
tie or an over-threshold minimum both correctly return `null`. Verified
independently in Node (not just read) that `osaDistance` reproduces
every DECISIONS 160 example exactly: `hgih`/`high`=1, `tsak`/`task`=1,
`nope`/`done`=2, `don`/`done`=1, `urgnet`/`urgent`=1, `nrmal`/`normal`=1,
`hgh`/`high`=1. `valueHint` is wired into every `invalid_value` call
site that validates a closed-vocab field: `cmd-new.ts` (type/status/
priority), `cmd-set.ts` (status/priority, both the create- and
update-shaped validation blocks), `cmd-claim.ts` and `cmd-next.ts`
(status), and `cmd-list.ts`'s `applyFilters` (status/type) — which
`cmd-find.ts` reuses directly (`import { applyFilters } from
'./cmd-list.ts'`), so `find`'s own status/type filters get the same hint
with no separate implementation. No call site was found that validates
one of these three fields without going through `valueHint`.

## 2. Live reproduction

**Per-command `--help`, every command.** Ran `<command> --help` for
every command in `nj.ts`'s switch (`init, new, set, note, check, show,
log, list, find, tree, rm, archive, unarchive, claim, release, next,
doctor`) against a real backlog. Every one exits 0 and prints its own
synopsis; every command with fields in `flag-table.ts` lists them one
per line, closed-vocab ones with `allowed: …`; `init` and `rm` (absent
from `flag-table.ts`) print synopsis-only (§ 4 above). Confirmed `
--status`'s allowed values come from a **custom, valid** config
(`nj set --help` against a backlog configured with
`backlog, in_progress, in_review, done` showed exactly those four, none
of the defaults) and fall back to the **default** list both for an
**invalid** config (hyphenated statuses / last entry not `done`) and
for **no backlog at all** (empty directory) — both exit 0, never
`no_backlog`/`invalid_config`. `--json` confirmed to make no difference
to `--help`'s own output on any command (prose both ways, identical
bytes). Confirmed the interplay cases explicitly: `nj --backlog=X list
--help` (global flag before the word, `--help` after) resolves the
backlog's own config for the listing; `nj --json --help list` (an
unrecognized-for-prefix-position `--help` before the command word) stops
`splitCommand`'s scan before `list` is ever reached, so this is the
**bare** invocation with `--help` present — general `HELP`, by the same
EV-6 "nothing reordered" rule batch 1 established, not `list`'s own text;
`nj --version --help` is `unknown_field` (`--version`'s own exclusivity,
checked first, is untouched by any of this).

**Did-you-mean, every invalid_value path.** `nj find "x" --status=don`,
`nj list --type=tsak`, `nj next --as=alice --status=don` (after supplying
`--as`, since `next` validates the actor before the status) all produced
the correct hint through the shared `applyFilters` path. `nj set
--priority=medium` reproduced the exact spec example byte-for-byte
(`did you mean 'normal'? Known priorities: low, normal, high, urgent`).

## 3. Mutation testing (AC-47)

Two mutations applied to `core/suggest.ts`, one at a time, rebuilt, and
run against `test/ac/ac-47-did-you-mean.js` directly (`node
test/ac/ac-47-did-you-mean.js dist/nj`):

- **Levenshtein instead of OSA** (removed the transposition clause):
  caught cleanly — D2 (`hgih`→`high`) and D3 (`tsak`→`task`) both fail,
  since plain Levenshtein puts both at distance 2, over the 4-character
  threshold of 1.
- **No length-dependent threshold** (flat `threshold = 2`): caught
  cleanly — D7 (`nope`, the exact DECISIONS 160 motivating case) fails,
  since `nope`→`done` (distance 2) is now wrongly hinted again under the
  old flat rule.

`suggest.ts` restored afterward; `tools/bundle.js --check` confirms
`dist/nj`/`dist/nj-mcp` byte-identical to a fresh build of the
unmutated source.

## 4. Replay vs `oracle-frozen-12`, with `--diff-out`

The Oracle's harness fix landed before this round: `baseline.js verify`
now has a native, committed `--diff-out=<file>` that writes every diff
unclipped, uncapped — no local, throwaway harness edit was needed this
time (batch 1 required one; it was never committed, per that round's
own report).

Nested worktree at `6837504`, `test/` swapped to `oracle-frozen-12`,
digest confirmed matching. Run with `TMPDIR` pointed at the same
dedicated clean directory batch 1 used (no `backlog/` in its ancestor
chain):

```
baseline: 7086 calls, nj sha256 4444cd04fd23...
current : 7086 calls, current code sha256 (nj, 1 files) da9fe1b3...
compared: 6463 calls (623 excluded as nondeterministic by design — concurrency)

RED VERDICTS (1):
  oracle suite failed: edge/doctor-fix-surface.js

BEHAVIOUR CHANGED — 195 differing call(s): (bare) 102, --json 86, help 4, --help 2, --backlog=<SCRATCH>/store/bl 1
```

**Identical tally to batch 1** (same 195, same per-class breakdown) —
confirmed by diffing the two `--diff-out` files: same call indices, same
labels, same before/after content throughout. `edge/doctor-fix-surface.js`
is the same pre-existing, already-explained stale fixture from batch 1's
report (§ 4 there); nothing new.

**Why zero hint diffs, though 335a0df had 12 (the task's own question).**
Searched the full `oracle-frozen-12` corpus (`grep -rnoE -- "--priority=
[a-zA-Z]+|--status=[a-zA-Z]+|--type=[a-zA-Z]+"`) for every closed-vocab
value used anywhere in it: the only ones that aren't themselves valid
are `badtype`, `bogus`, `nonexistent`, `nonsense`, `nope`, `not` — and
computing `osaDistance` for each against every allowed value (done in
Node, not assumed) shows only `nope` and `not` come within shouting
distance of anything, and both sit **over** the new ≤4-character
threshold of 1 against every field (`nope`→`done` = 2, `nope`→any
priority ≥ 3, `not`→`low` = 2, `not`→`done` = 3). `test/edge/
exit-fault-vocabulary.js` is the corpus's own source of this: `{ name:
'invalid value', args: ['set', '--id=TSK-001', '--priority=nope', …] }`
and `{ name: 'invalid list filter', args: ['list', '--status=nope', …]
}` — this is literally the DECISIONS 160 motivating example, frozen
into the corpus from before the tightening. At `335a0df` (flat ≤2 rule,
plain Levenshtein), `nope`→`done` at distance 2 **was** hinted, which is
exactly the noise DECISIONS 160 exists to remove — producing a diff
against `oracle-frozen-12`'s pre-hint-feature plain message. At
`628a618`/`6837504` (length-dependent ≤1 for `nope`'s 4 characters), that
same call now gets **no** hint, reverting its output to byte-identical
with the original baseline — hence zero diff, not a lost feature.
Confirmed directly: `grep -c "did you mean" /tmp/replay-v36b2-diffout.txt`
→ `0`, and `grep -c nope` on the same file → `0` (the `nope` calls don't
even appear as differing calls at all, because their output is
unchanged start to finish). No corpus value sits within the current
threshold of any allowed value, so there is no hint the current build
is failing to produce — the disappearance is the tightening working
exactly as intended on the one case the corpus happens to contain.

## 5. `docs/CHANGES.md` — every claim run live against the 3.6.0 build

Every example and claim in the 3.6.0 section was executed, not just
read:

- Global flags before the command (`nj --backlog=X list`, `nj
  --backlog=X show --id=EPIC-001`) both run the command; a non-`--backlog`/
  `--json` flag before the word (`nj --status=todo list --backlog=X
  --json`) is `unknown_field` — confirmed byte-for-byte.
- Multi-line note round-trip (`nj note` with an embedded `\n`, `nj log`
  reading it back indented) — confirmed.
- The reviewer trick (`nj set --assignee=reviewer` then `nj next
  --as=reviewer --assignee=reviewer` claims it; `nj next --as=author`
  alone gets `none_ready`) — confirmed on a fresh fixture.
- The leaf rule: bare `nj` hides a container with an open child; `nj
  list --ready` still shows both — confirmed on the same fixture.
- `nj <command> --help` and the did-you-mean example (`--priority=medium`
  → `did you mean 'normal'?`) — confirmed (§§ 1-3 above).
- The GUIDE-only claims (§ 6, below).

`docs/CHANGES.md` is accurate throughout; no claim required correction.

## 6. GUIDE § 1/§ 2 — checked live

- **§ 2, empty type folders:** created a fresh backlog, removed `epics/`
  and `archive/` by hand (`rmdir`). `nj doctor` stayed clean (`0 entries,
  0 errors, 0 warnings`, exit 0) — the missing folders are not a finding.
  `nj new --type=epic …` recreated `epics/` on the spot. Matches "`nj`
  creates whichever folder it needs the first time something goes into
  it… and never treats a missing empty type folder as a problem"
  exactly.
- **§ 1, explicit node:** `node /tmp/verif-v36b2/dist/nj --version`
  (no reliance on the shebang or `PATH`) printed `nj 3.6.0` — confirmed
  the exact invocation GUIDE § 1 shows works.
- `nj init`'s own sample output in GUIDE § 2 (`Created backlog at …`,
  the file/folder listing) reproduced byte-for-byte against a live
  `nj init` run.

## 7. The `run-all` slowness (not reproduced as a hang or as contention)

Ran `test/run-all.js` alone, then two full `test/run-all.js` instances
concurrently (separate worktrees, `/tmp/verif-v36b2` and
`/tmp/verif-v36b2-parallel`, both on the default, shared `TMPDIR`/`/tmp`
root — the "sharing a root" scenario the task asked about). Watched the
full process tree throughout (`ps -o pid,stat,%cpu,etime,command`),
not just top-level CPU. Both instances finished cleanly in the same run
(**90/92 passed, 0 failed, 2 cannot-run** — the usual environment-
conditional pair), progressing in lockstep through the same suites at
nearly the same elapsed time, with no stall, no error, and no sign of
one run's fixtures interfering with the other's.

**No lock or marker contention is architecturally possible**: every
fixture directory comes from `fs.mkdtempSync` (`test/lib/harness.js`'s
`freshDir`/`mkBacklog`), which guarantees a unique, non-colliding path
per call regardless of how many `run-all` processes are active —
confirmed by reading the function, not assumed. Two concurrent runs
therefore never share a `.nj-fault-go` marker path or a backlog
directory.

What *does* produce exactly the symptom described — "~0 CPU for
minutes, while other runs were active" — is real, by design, and found
in three separate places in the fault-tolerance suites, each blocking
the test's own child `nj` process (not `run-all` itself) for close to
10 seconds with near-zero CPU while it busy-polls a marker file every
50ms (`core/config.ts`'s `njrcSwapFaultHook`, `core/store.ts`'s
`before-compare` guard):

- `test/edge/hardening-njrc-swap.js` S2 — "released by the ~10s TIMEOUT
  (no marker ever created)": the test's own comment says the call
  "resolves only once nj's own ~10s timeout elapses."
- `test/fault/fault-hook-json.js` — `NJ_FAULT=before-compare --json`,
  asserted to take "~10s timeout."
- `test/fault/nj-fault-before-compare.js`'s T2 — asserts
  `elapsed >= 9000 && elapsed < 20000`.

These three alone account for roughly 30 seconds of intentional,
near-0%-CPU wait time built into a single `run-all` pass, independent of
any concurrency; under real competing CPU load (another `run-all`, or
anything else busy on the machine), the 50ms poll ticks these faults
rely on can simply get scheduled less promptly by the OS, stretching
the *wall-clock* length of an already-near-0%-CPU wait — which would
look, from outside, exactly like "a fault test hanging for minutes,"
without anything being stuck. Given fixture-path uniqueness rules out
contention as a mechanism and both a solo and a two-way-parallel run
completed correctly here, the likeliest explanation for what the Oracle
saw is scheduling pressure stretching one or more of these three
already-intentional waits, not a lock, a deadlock, or a genuine hang.
Nothing in this round reproduces an actual indefinite stall.

## 8. The one gap: `nj rm --help`

`rm` has no entry in `core/flag-table.ts` — deliberate, per that file's
own comment ("`rm`, is not exposed at all [via MCP]"), and `cmd-rm.ts`
validates its own flags inline (`checkFlags(flags, [], new
Set(['json', 'cascade', 'id', 'file']), true)`) rather than through the
table. `commandHelp()` falls back silently to synopsis-only
(`try { fields = commandFields(command)… } catch { return
synopsis.join('\n') + '\n'; }`) for any command missing from the table
— `init` hits the same fallback, but `init` genuinely has no fields
beyond the global `--backlog`, so nothing is lost there. `rm` does have
real, documented flags (`--id`, `--cascade`), and its own synopsis line
already names both literally, so `nj rm --help` is not wrong (exit 0,
not the general help, not a crash) — it simply doesn't get the "one line
per flag" treatment every other command with fields gets. Not blocking:
AC-46 doesn't test `rm` at all, and the information is still present in
the synopsis line itself. Worth a follow-up (either give `rm` a
flag-table entry restricted to CLI-only use, or have `commandHelp`
fall back to a command's own `checkFlags` allow-set when the shared
table has no entry for it).
