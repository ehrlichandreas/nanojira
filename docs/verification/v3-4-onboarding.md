# V3.4 verification — `--version` + onboarding docs (`e13efd0`, D151)

Verifier, 2026-10-05. Independent verification, assigned by the Lead.
Work in `/tmp/verifier-v34` (detached worktree at `e13efd0` — note: the
task listed `33b5b60` alongside `e13efd0`, but `33b5b60` is actually an
*ancestor* of `e13efd0` in git history, not a later commit; `e13efd0` is
main's current tip and carries both the code and the docs, so it's the
one I verified against), `/tmp/verifier-v34-nested`/`-unclip` (for
`gate.js`/the byte-exact diff), `/tmp/verifier-v34-empty`/`-bare`/
`-install`/`-agent` (scratch, explicit paths). All removed before
writing this. Read: DECISIONS 151 in full, SPECIFICATION.md § 9
`--version`, § 17's `nj-mcp --version` paragraph and the updated
`initialize` bullet (`5e0c6f2`), AC-39 in full (`28817b8`/`d0c5f2c`),
the full `e13efd0` diff, GUIDE.md's new § 1 "Install", `docs/
AGENT-INSTRUCTIONS.md` in full.

**VERDICT: needs changes — one confirmed gap.** `nj --version` itself is
correct in every respect I could probe: single source, no runtime
`package.json` read, every combination rule enforced exactly as
specified, byte-exact help-text diff, AC-39 24/24. The docs (GUIDE
Install, AGENT-INSTRUCTIONS.md) are accurate and every command in both
is valid, confirmed live. **The one gap**: `nj-mcp --version` does not
enforce § 9/§ 17's combination rule — `nj-mcp --version --backlog=<x>`
and `nj-mcp --version --allow-destructive` both silently print the
version and exit 0 instead of `unknown_field`, confirmed live. AC-39
doesn't cover this leg for `nj-mcp` at all (only `nj`'s combinations are
tested, V6), so the gap wasn't caught by the suite either.

## 1. `nj --version`

**Single source, no runtime read — confirmed, not just read in the
diff.** `package.json`'s new `"version": "3.4.0"` is read once at build
time (`tools/bundle.js`'s `PKG_VERSION`, passed to esbuild's `define` as
`__NJ_VERSION__`); `src/core/version.ts` only `declare`s the ambient
identifier, no runtime `fs.readFileSync` anywhere. Copied `dist/nj`
*alone* into a bare directory with nothing else beside it (no
`package.json`, no `node_modules`):
```
$ node nj --version
nj 3.4.0
$ node nj --version --json
{"version":"3.4.0"}
```
Both still correct — proves the embedding, not merely implies it.

**Works outside any backlog, confirmed live**: ran `nj --version` and
`nj --version --json` in a freshly-created empty directory (no
`backlog/`, no `.njrc` anywhere above it, `NJ_BACKLOG` unset) — both
succeed, exit 0, no backlog-resolution error of any kind.

**Combination rules — every case the spec names, run live:**

| Call | Result |
|---|---|
| `nj --version` | `nj 3.4.0`, exit 0 |
| `nj --version --json` | `{"version":"3.4.0"}`, exit 0 |
| `nj --version --help` | `unknown_field`, exit 1 |
| `nj --version --backlog=x` | `unknown_field`, exit 1 |
| `nj list --version` | `unknown_field`, exit 1 |

All five match § 9/AC-39 exactly, including the two explicitly named in
the task (`--version --help`, a subcommand). The hint text
(`--version takes no other flag and names no command`) is consistent
across all the rejection cases.

**`nj --version=x`** (an edge case not explicitly named in the task or
spec, but worth a sanity check given the implementation's `pre.flags
.has('version')` check doesn't look at the flag's *value*): behaves the
same as bare `--version` — prints the version, ignoring the attached
`=x`. Not a spec violation (the spec only ever shows `--version` as a
bare flag, never `--version=<value>`, so there's no stated behaviour
this contradicts), just noting I checked it rather than assuming.

**`nj-mcp --version` — the version itself, correct:**
```
$ node dist/nj-mcp --version
nj-mcp 3.4.0
```
Same value `nj --version` reports, confirmed byte-identical (`3.4.0`
both sides). Checked the ordering claim directly in source
(`src/nj-mcp.ts`): the `--version` check is the very first thing
`main()` does, before `allowDestructive` is even read, before
`findBacklog` — "the only ordering change" is accurate.

**`nj-mcp`'s `server/discover` and `initialize` report the same
version — confirmed live, both eras:**
```
server/discover -> _meta["io.modelcontextprotocol/serverInfo"].version = "3.4.0"
initialize       -> serverInfo.version                                 = "3.4.0"
```
Matches `5e0c6f2`'s spec update and `d0c5f2c`'s AC-39 V5 leg exactly.

### Confirmed gap: `nj-mcp --version`'s combination rule is not enforced

§ 17: *"`nj-mcp --version` follows the same rule § 9 states for `nj
--version`"* — and § 9's rule is explicit: combined with anything beyond
`--json`, it's `unknown_field`. Live:

```
$ node dist/nj-mcp --version --backlog=/tmp
nj-mcp 3.4.0
(exit 0)

$ node dist/nj-mcp --version --allow-destructive
nj-mcp 3.4.0
(exit 0)
```

Both should be `unknown_field` per the spec text above; instead both
silently succeed, printing the version and ignoring the extra flag
entirely. Root cause, read in `src/nj-mcp.ts`: the version check is
```js
if (argv.flags.has('version')) {
  process.stdout.write(`nj-mcp ${VERSION}\n`);
  process.exit(0);
}
```
— it only checks *presence* of `version`, never that it's the *only*
flag present, unlike `nj.ts`'s own version check (which explicitly
builds `onlyVersionAndJson` and checks `positional.length === 0` before
accepting). This isn't a new carelessness specific to `--version`:
`nj-mcp`'s startup flag parsing was already generally permissive before
this round (confirmed: `nj-mcp --totally-bogus-flag` is silently
accepted too, proceeding straight to backlog resolution rather than
rejecting the unknown flag) — `nj-mcp` has never had the kind of
blanket unknown-flag validation `nj.ts`'s `checkFlags` gives the CLI.
But the spec specifically and explicitly calls for `--version` to be an
exception to that general leniency, and the implementation doesn't
carve one out.

**Not caught by AC-39**: read `test/ac/ac-39-version.js` in full — V6
("combinations: only --json combines with --version; anything else...")
only drives `nj` (the CLI binary), never `nj-mcp`. V4 only checks bare
`nj-mcp --version`; V5 only checks the MCP-protocol version fields. No
leg exercises `nj-mcp --version` combined with another flag. AC-39's
reported 24/24 (confirmed, ran it myself) is accurate for what it
covers — it just doesn't cover this.

**Recommend**: give `nj-mcp`'s version check the same exclusivity test
`nj.ts` already has (e.g. `argv.flags.size === 1 && argv.flags.has
('version')`, or `=== 2` allowing `json` too if `nj-mcp --version --json`
is meant to work the same textual way it currently does — worth
confirming that specific combination's intended shape while fixing
this, since right now `nj-mcp --version --json` also just prints the
plain-text line, not a JSON form, and nothing in § 17 says whether
`nj-mcp --version --json` should behave like `nj --version --json`'s
`{"version": ...}` shape or isn't a combination `nj-mcp` supports at
all), and add the equivalent of AC-39's V6 leg for `nj-mcp`.

## 2. Gate replay

`gate.js --step=e13efd0 --frozen=c7-baseline`:
```
replay: exit 1
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
oracle: passed 82, failed 0, cannot run 2 (1 expected: hardening-njrc-foreign-link.js)
        GAP (not in expected-gaps.js): ac-32-mcp-sdk.js
gate  : exit 4, coverage gap: something could not run, nothing is proven
```

**Confirmed, exactly as the task described**: the gate's exit 4 comes
only from `ac-32-mcp-sdk.js` reporting `CANNOT RUN` inside the gate's
own throwaway worktree (no `node_modules` there — the same, already-
established, offline-safe gap every prior v3.3 gate run has shown; not
a new defect, not related to `--version`) plus the one pre-existing
expected gap. No other suite failed or was newly red.

**The 6 differing calls, confirmed byte-exact** via the established
unclipped-`baseline.js` technique (nested worktree, `test/` swapped to
`c7-baseline`, digest-confirmed match, throwaway clip/limit removal,
never committed): across all 6 calls (the `help`/`help --json`/`--help`
fixture trio, duplicated by `oracle:edge/coverage-v3-gaps.js`), the
**only** difference in the full ~1,300-character help string is the one
new line, `  nj --version                           print the version
and exit`, inserted at the very top of the command summary. Nothing
else differs anywhere.

## 3. GUIDE.md's new "Install" section — followed literally

Set up a temporary `PATH` sandbox (`/tmp/verifier-v34-install/bin`),
symlinked both binaries exactly as the section's own example command
shows (`ln -s /path/to/dist/nj ...`), and followed every bullet in
order:

1. Both `nj` and `nj-mcp` resolve via `which` once on `PATH` — confirmed.
2. `nj init` (by bare name, via `PATH`, in a fresh project directory) —
   creates the backlog, same output as every other round this session.
3. An `nj-mcp` client-config entry using the **bare command name**
   (`"command": "nj-mcp"`, exactly the shape an MCP client config would
   use once it's on `PATH`) — spawned it via that exact shape and
   confirmed it starts and answers `initialize` correctly, reporting
   `serverInfo.version: "3.4.0"`.
4. `nj --version` — confirmed as the section's own suggested verification
   step, already covered in § 1 above.

Everything in this section works exactly as written. No mismatch found.

## 4. `docs/AGENT-INSTRUCTIONS.md` — read critically, every command run

Ran every command the copy-paste block shows, in sequence, against a
fresh backlog: `list --json`, `show --id=... --json`, `set` with the
full named field list (`--title --status --priority --tags --assignee
--depends-on --description --acceptance`), `claim --as --status=doing`
in one call, `set --status=done`, `release --as`, `check --text`, `note
"..." --as`, and a deliberately-failing `set` against a nonexistent ID
to confirm the failure shape. **All valid, all behave exactly as the
block implies**:

- `claim --id=... --as=alice --status=doing` → `TSK-001 claimed by
  alice (status: doing)` — confirms the "optionally `--status=doing` in
  the same call" parenthetical is real, not aspirational.
- The failure shape: `nj set --id=TSK-999 ... --json` → `{"ok": false,
  "error": "not_found"}` — matches `{"ok": false, "error": "<code>",
  ...}` exactly, confirming "branch on `error`, not on the hint text" is
  sound advice (the hint text, when present, is a separate field, never
  needed to determine the outcome).
- `check --id=... --text="<substring>"` with neither `--on` nor `--off`
  ticks by default (confirmed: the box went from `[ ]` to `[x]`) —
  consistent with GUIDE's own § 15 "`--on` is the default" and with the
  instructions never needing to mention `--on` explicitly.

**Consistency with the spec's principles, checked against the actual
text, not assumed**: "Always add `--json`... branch on the result, never
on prose" matches § 9's own closed-code-table philosophy exactly (the
same phrase appears in GUIDE's own § 4). "Read before you write" is
sound practice given § 12's compare-before-write (a stale read would
simply surface as `changed_in_parallel` on write, so reading first is
advisory, not load-bearing, but not misleading either). "Claim before
work... release or done after" matches § 12/§ 12a's documented
lifecycle. "Never hand-edit files under `backlog/`" is accurate and
important — `STATUS.md`, tombstones and claims all depend on going
through `nj`. "`nj check`... never by editing the checkbox text
yourself" is accurate. "codes are the contract and prose is not" is
restated accurately in the block's own closing bullet.

**Nothing found misleading. One soft, non-blocking observation**: the
block is deliberately short (by design, per D151: "a copy-paste block")
and omits batch writes, `find`, and `archive`/`unarchive` entirely —
reasonable for a minimal onboarding block that links `GUIDE.md`/
`SPECIFICATION.md` for anything beyond the daily loop it covers; not
flagging this as a gap since the intended scope is explicitly narrow.

## Summary

Three of four areas are clean: `nj --version` itself, the gate replay,
and both doc files (Install section and AGENT-INSTRUCTIONS.md) all
check out exactly against live behaviour. The one real finding is
`nj-mcp --version`'s missing combination-rule enforcement — a genuine,
confirmed spec deviation (not just an undertested area; the actual
behaviour is wrong), with a gap in AC-39's own coverage for the same
leg. Recommend fixing `nj-mcp`'s version check to require exclusivity
the same way `nj.ts` already does, adding the equivalent AC-39 leg, and
clarifying `nj-mcp --version --json`'s intended shape while at it.

## D152 delta — `e1e9992` (spec), `483d25b` (tests), `518583d` (nj-mcp)

Verifier, 2026-10-05. Same scope, read-only, assigned by the Lead:
check only the D152 delta. Work in `/tmp/verifier-d152` (detached
worktree at `518583d`), `/tmp/verifier-d152-old` (detached at `e13efd0`,
the pre-fix build, for the discrimination check), `/tmp/
verifier-d152-nested` (for `gate.js`), `/tmp/verifier-d152-probe`
(scratch backlog). All removed before writing this.

**VERDICT: accept. v3.4 is complete.** The fix closes the gap exactly,
confirmed live against every case the original finding and the task
named; AC-39's new legs genuinely discriminate (27/59 checks fail
against the pre-fix binary, all and only the new V7 leg — V8 stays
green there, confirming the new tests aren't failing for unrelated
reasons); the diff is scoped to exactly `nj-mcp.ts`/its `dist`; AC-39 is
59/59, AC-32/38 still green, and the gate replay against `c7-baseline`
shows the same 6 help calls as every v3.4 round so far.

**(1) The exact repro and every named variant, re-run live:**

| Call | Result |
|---|---|
| `nj-mcp --version --backlog=/tmp` | `nj-mcp: --version takes no other argument (got '--backlog'). Known: --backlog, --allow-destructive, --version`, exit 1, empty stdout |
| `nj-mcp --version --allow-destructive` | same shape, names `--allow-destructive`, exit 1, empty stdout |
| `nj-mcp --totally-bogus-flag` | `nj-mcp: unknown argument '--totally-bogus-flag'. Known: ...`, exit 1, empty stdout |
| `nj-mcp --allow-destrutive` (the typo) | `nj-mcp: unknown argument '--allow-destrutive'. Known: ...`, exit 1, empty stdout |
| `nj-mcp foo` (stray positional) | `nj-mcp: unknown argument 'foo'. Known: ...`, exit 1, empty stdout |

All five: exit 1, exactly one stderr line naming the offending argument
and the known ones, confirmed `0` bytes on stdout in each case (piped
and counted directly, not inferred from the absence of visible output).

**A sixth case beyond the task's own list, found in the diff and
confirmed live**: `nj-mcp --version --json` — since `nj-mcp` has no
`--json` at all, this is rejected as `unknown argument '--json'`
(not via the `--version takes no other argument` message, since
`--json` never reaches the known-flags set to begin with) — still
correctly an error either way, and this resolves the one ambiguity my
original report flagged (what `--version --json` should do for
`nj-mcp`): it's simply never a recognized combination, full stop.

**Valid starts, unchanged, confirmed via live stdio round trips:**
- bare `nj-mcp` → `initialize` answers correctly (`serverInfo.version:
  "3.4.0"`).
- `nj-mcp --backlog=<path>` → `server/discover` answers correctly.
- `nj-mcp --backlog=<path> --allow-destructive` → `tools/list` shows
  `doctor`'s `fix` field present, confirming the gate flag still works
  through the new strict parsing, not just that *a* tool list comes
  back.

**(2) AC-39's new legs genuinely discriminate — checked by running them
against the pre-fix binary myself, not trusting the Oracle's own
claim.** Built a second worktree at `e13efd0` (before D152) and ran
`518583d`'s own `test/ac/ac-39-version.js` against *that* binary:

```
FAIL ac-39-version.js — 27 of 59 checks failed
```

All 27 failures are V7 (the new strict-validation checks) — confirmed
by grep, zero V8 failures and zero failures outside V7. This matters
specifically because the task flagged it: the Oracle had only ever run
these new checks against the already-patched build, so there was no
independent confirmation they'd actually go red on the bug they're
meant to catch, as opposed to passing vacuously regardless of the
implementation. They don't pass vacuously — confirmed directly.

**(3) Diff scope, AC-39/32/38, and the gate — all confirmed:**

- `git show 518583d --stat`: `dist/nj-mcp` and `src/nj-mcp.ts` only —
  nothing else touched.
- `node test/ac/ac-39-version.js dist/nj`: **59/59**.
- `node test/ac/ac-32-mcp.js dist/nj`: **36/36**; `node test/ac/
  ac-38-mcp-no-dependencies.js dist/nj`: **11/11**.
- `gate.js --step=518583d --frozen=c7-baseline`: `replay: exit 1`,
  `BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2` (the same
  tally as every v3.4 round — the CLI's own `nj` binary is untouched by
  this commit, confirmed by the identical `nj sha256` in both this run's
  and the previous round's gate output), `oracle: passed 82, failed 0,
  cannot run 2` — the same two already-expected gaps
  (`hardening-njrc-foreign-link.js`, and `ac-32-mcp-sdk.js` for the same
  offline-`node_modules` reason as every prior round), `gate: exit 4,
  coverage gap` for that same reason, nothing new.

### D152 delta verdict

**Accept. v3.4 is complete.** The gap from the original review is
fixed, confirmed live against the exact repro and every adjacent case;
the new tests are confirmed to actually discriminate, not just report
green; nothing else in scope regressed. Nothing outstanding.
