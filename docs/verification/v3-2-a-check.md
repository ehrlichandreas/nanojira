# V3.2-A verification — `nj check` (`ea5a50f`, § 10a, AC-28, TSK-034)

Verifier, 2026-10-04. I didn't write any of this code — independent
verification assigned by the Lead. Work in `/tmp/verifier-v32a-check`
(detached worktree at `ea5a50f`), `/tmp/verifier-v32a-nested/projects/
nanojira` (nested under its own `runtime/darwin-arm64` symlink, for
`gate.js`'s own AC-15 check and a second, unclipped `baseline.js` run), and
`/tmp/verifier-v32a-probe` (scratch backlogs). All removed before writing
this file. Runtime Node v24.21.0. Read: § 10a as of `a86596c` (incl.
D128), the touched § 4/§ 7/§ 9/§ 12 lines; `src/commands/cmd-check.ts`,
`src/nj.ts`, `src/core/help.ts`; `test/ac/ac-28-check.js` (`e63c5c6`).

**VERDICT: accept.** AC-28 114/114, run-all and `gate.js --step=ea5a50f
--frozen=c6-baseline` all reproduce exactly — the 6-call tally is confirmed
byte-for-byte to be exactly the one inserted help line, nothing else. Every
one of my own black-box probes beyond AC-28 (14 scenarios: fence edge
cases, CRLF, marker spacing, trailing content, empty input, `## Notes`
re-entry, addressing refusals, fault injection) matched § 10a exactly, with
no deviation found. Reading AC-28 critically after the Implementer's own
3-bug fix pass (`e63c5c6`), I found no further latent bug — every
remaining check tests what its description claims.

## 1. AC-28, run-all, gate — the 6-call tally confirmed byte-for-byte

- `node test/ac/ac-28-check.js dist/nj`: **114/114**, exact.
- `node test/run-all.js dist/nj`: 74/76 pass, 0 failed, 2 cannot-run (the
  usual two expected gaps: `ac-15`'s worktree-path-depth artifact,
  `hardening-njrc-foreign-link.js`'s root requirement).
- `gate.js --step=ea5a50f --frozen=c6-baseline`: `BEHAVIOUR CHANGED — 6
  differing call(s): help 4, --help 2` (no `(truncated: …)` suffix — 6 is
  the true total, not a capped display), `replay: exit 1`, `oracle: passed
  75, failed 0, cannot run 1 (1 expected)`, `gate: exit 1, replay CHANGED,
  oracle green`.

**Confirmed byte-for-byte, not just by the tally.** Reran `baseline.js`
directly in a correctly-nested worktree (`test/` checked out to
`c6-baseline`, digest-confirmed matching) with my own throwaway,
never-committed clip removal (same technique as my B/C/D121 reports) to see
the full, unclipped diff text for all 6 calls (`#198`/`#199`/`#200`, the
`help` fixture's own three; `#5570`/`#5571`/`#5572`,
`oracle:edge/coverage-v3-gaps.js`'s own three — the exact same duplication
pattern I found and correctly counted in my V3.1-B and D121 reports).
**Every one of the 6 differs by exactly one inserted line** — `  nj check
--id=TSK-009 [--text=<substring> | --item=<n>] [--on | --off]
[--force]\n`, between the existing `note` and `show` lines — **and nothing
else differs anywhere in either string.**

**Help line vs § 9.** § 9's command list shows `check` as two lines
(`--text=<substring>` and `--item=<n>` variants, each `[--on | --off]
[--force]`); `help.ts`'s single combined line
(`[--text=<substring> | --item=<n>]`) uses the same `|`-choice notation
`set`'s own help line already uses for `--description`/
`--description-file` — consistent in style with the existing convention,
not a new shorthand. Content matches flag-for-flag.

## 2. My own black-box probes beyond AC-28

AC-28 is already thorough (114 checks: every marker type, `[X]` read as
ticked, nesting, four fence shapes including a shorter-fence-inside-a-
longer-one, `## Notes` exclusion, both addressing errors,
`ambiguous_target`, both no-op directions, the D128 default-ticks/both-
invalid rule, byte-exactness including a nested item, completeness
independence, all three refusals, `NJ_FAULT=before-rename`, and a real
`before-compare` race both with and without `--force`). I targeted the
specific edges the task named, beyond what's already covered:

- **Unclosed fence to EOF.** A countable checkbox, then an opened fence
  that never closes, containing several checkbox-shaped lines through to
  the end of the body: `--item` count stops at 1 (only the pre-fence box),
  every checkbox-shaped text inside the unclosed fence is `not_found`.
  Correct — the scanner's fence state simply never clears, which is the
  right behaviour for a body that's missing its closing fence.
- **Fence character mismatch** (opened with ` ``` `, a `~~~` line
  appears before the real close): does **not** close it — confirmed
  `not_found` for text between the backtick-open and the eventual
  backtick-close, even past the stray tilde line. **Longer closing fence**
  (opened with 3 backticks, closed with 4): also confirmed — content stays
  excluded until the close, and a checkbox right after the close is
  found normally. Both match § 10a's "closed only by a matching or longer
  fence of the same character" exactly.
- **A fence nested inside a list item** (an indented fence under a numbered
  item): correctly excludes its own content; the numbered item itself
  (`1. [ ]`) is correctly counted as its own checkbox.
- **4-space indented "code"** (no fence markers, just indentation):
  **not** excluded — `nj check` only tracks *fenced* code, never
  CommonMark's separate indented-code-block construct, and § 10a never
  claims otherwise ("fence-awareness... the one place... exists"; nothing
  about indentation-triggered code blocks). Confirmed as the correct,
  in-scope behaviour, not a gap.
- **CRLF input file.** Built a genuine CRLF-terminated element file by
  hand (verified via `xxd`, no stray `\n`-only lines). After `nj check`,
  the **entire** file is LF-only (confirmed via `xxd` again) — this is §
  7's existing, tool-wide "always written as LF... regardless of how
  [files] were read" rule, not something `check` does differently; aside
  from that universal normalisation, only the bracket content changed
  (`[ ]` → `[x]`), matching the byte-exactness rule in the only sense that
  applies to a CRLF-origin file.
- **Trailing content after `]`.** A line `- [ ] trailing text after
  bracket ]x` (a stray `]x` after the real closing bracket): `--text`
  matches on the content after the box as intended, and the write produces
  `- [x] trailing text after bracket ]x` — the trailing `]x` survives
  untouched, confirming "and nothing else on the line... not trailing
  content after the `]`" precisely.
- **Marker/bracket spacing.** `-[ ] no-space-after-marker` (zero spaces)
  and `-  [ ] two-space-after-marker` (two spaces): **neither** is
  recognised as a checkbox — both correctly `not_found`. This matches
  § 10a's literal text ("followed by **one space** and `[ ]`") precisely;
  worth noting plainly since a human editor using two spaces here (a
  plausible, common formatting habit) will silently get a line `nj check`
  never sees — not a defect, since the spec is explicit about exactly one
  space, but a real, easy-to-hit surprise worth being aware of.
- **A body with no checkboxes at all.** `--text=<anything>` → `not_found`;
  `--item=1` → `not_found` ("out of range (1..0)"). Both correct.
- **`--item=0`, negative, non-integer, decimal.** `--item=0`,
  `--item=-1`, `--item=abc`, `--item=1.5` — all four produce `not_found`
  via the same `!Number.isInteger(n) || n < 1 || n > boxes.length` guard.
  Consistent, single code for every "not a valid 1-based index" shape.
- **Empty `--text=`.** Resolves successfully when the body has exactly one
  countable checkbox (`''.includes('')` is always `true` in JS, so an
  empty substring matches every checkbox in scope — with one checkbox,
  that's an unambiguous match). Confirmed it actually ticks that box.
  **Worth a note, not a defect:** the project has a standing precedent
  (DECISIONS 119, for `--as`) that "an explicit flag given with nothing in
  it is a caller's mistake" (`invalid_value`), but § 10a never rules on an
  empty `--text=` the same way, and the implementation's "matches
  everything" reading is a reasonable, different interpretation — `--text`
  denotes a substring to search for, not an identity, so "empty substring
  matches everything" is mathematically unsurprising in a way "empty name"
  isn't. I'd leave it as implemented; flagging only so the inconsistency
  with the `--as` precedent is a recorded, deliberate choice rather than an
  oversight.
- **`## Notes` heading appearing twice, and a later section after Notes.**
  A body with: a box before `## Notes`, a box under the first `## Notes`,
  a box under a later `## Extra` section, and a box under a *second*
  `## Notes` heading. Results: before-Notes box counts; first-Notes box
  excluded; the later `## Extra` section's box **counts** (scope resumes
  once a non-Notes heading appears); the second `## Notes` heading's box is
  **excluded again**. All four match a correct per-line heading-state
  machine, confirming the scanner re-evaluates "am I in Notes" on every
  heading line rather than latching once.
- **`duplicate_id` with `--file`.** Two files sharing one `id`: `--id=`
  refuses `duplicate_id`; `--file=<path>` bypasses it and succeeds — the
  same escape hatch every other write command already has.
- **`NJ_FAULT=before-compare` with `--force`.** A real concurrent edit
  (written to the file while `check` is paused at the fault's go-marker
  poll) is correctly discarded: `--force` writes through, the box ends
  ticked and the concurrent text is gone — matching AC-28's own D9
  second block, reproduced independently against the live binary rather
  than only read from the suite.

No deviation from § 10a found in any of these 14 probes.

## 3. AC-28 read critically, after the Implementer's 3-bug fix pass

The task named three test bugs the Implementer found and fixed in
`e63c5c6` while bringing `check()`'s `--id`-prepending helper in line with
every call site (the helper only prepended `--id=TSK-001` for string args,
never for the array args every call site actually passes — `check` was
silently seeing `missing_argument` everywhere, masked while `nj check`
itself was still `unknown_command`). Fixing that surfaced two more: D1b's
loop wrongly asserted every item flips to `[x]` on `--on`, including item 8
("nested star UPPERCASE ticked"), which starts already-ticked and is
therefore correctly a no-op (D1 already asserts this same case correctly
two blocks later, which is presumably how the Implementer caught the
contradiction); and several D5/D5b/D6/D7/D9 blocks used `--text=dash
unticked` as a generic "give me some unticked box" target, not noticing
that string is *also* a substring of `nested dash unticked` — making those
blocks accidentally exercise `ambiguous_target` instead of the no-op/byte-
exactness/fault behaviour each one's own description claims. All three are
fixed correctly in the version I read (confirmed: `--text=plus unticked`
and `--text=nested star`/`UPPERCASE`, the replacement needles, each appear
exactly once in `MARKERS_BODY`, verified by inspection — no new collision
introduced by the fix).

Read the full, current 432-line suite line by line against this standard:
does the check's assertion match what its own description and comment
claim? I did not find a fourth bug. Specifically verified, beyond the
three the Implementer already found: every `--text=` needle used
elsewhere in the suite (`'nested star'`, `'UPPERCASE'`, `'unticked'`'s six
intended matches for `ambiguous_target`, `'dash ticked'`'s uniqueness
against `'dash unticked'`/`'nested dash unticked'`) is unambiguous for the
case it's used in; the D6 byte-exactness `want` construction (`before`
with the one bracket and the `updated` line both replaced) is a sound way
to assert "nothing else changed," not a weaker proxy for it; the D9
`before-compare` race's assertions check both directions (the parallel
edit survives without `--force`, is overridden with it) against the actual
resulting file content, not just the exit code.

## Consistency with the current spec

Checked § 7's byte-for-byte exceptions and its "not fenced-code-aware...
deliberately out of scope for round one" rule against § 10a's own claim to
be the sole exception: accurate, § 10a doesn't overreach into claiming
anything about section writes. Checked § 9's refusal-before-anything-
is-written precedent (`claim`/`check` both name the same two: archived,
unreadable-stub-for-this-element-only) — consistent. Checked the closed
code tables: `ambiguous_target` (added for § A in the v3.2 proposal round)
is used exactly as specified, no collision. `requireActive`/
`requireWritable`/`requireTargetFlagSyntax` are the same generic helpers
`claim`/`note`/`set` already use — `check` adds no new refusal-ordering
mechanism, consistent with the proposal's own framing that it "reuses
`set`'s machinery."

---

## D129 delta (`2f2b9cd`, `39e6bb4`, `1a93eba`)

Verifier, 2026-10-04. Worktrees `/tmp/verifier-d129-check` (plain) and
`/tmp/verifier-d129-nested/projects/nanojira` (nested under its own
`runtime/darwin-arm64` symlink, for `gate.js`'s own AC-15 check), both
detached at `1a93eba`; both removed before writing this. **VERDICT: ready
to accept — V3.2-A is accepted.**

**The code delta is exactly what D129 describes, nothing more.**
`git diff ea5a50f..1a93eba -- src/ dist/`: one file,
`src/commands/cmd-check.ts`, +3 lines (plus its `dist/nj` mirror, +1 line)
— a single new guard, `if (text === '') fail('invalid_value', '--text
must not be empty')`, inserted between the existing both-given/neither-
given checks and the `--on`/`--off` conflict check. No trimming anywhere
near it — the guard is a literal `===` against the empty string, so a
whitespace-only `--text` (e.g. a single space) never reaches it and is
matched as an ordinary substring, exactly as D129 specifies.

**§ 10a (`2f2b9cd`)** states the rule in both places it needs to be: the
`--text=<substring>` bullet itself ("the literally empty string is
`invalid_value`... **No trimming**: a whitespace-only `--text` is not
empty and stays a plain substring, matched as given") and AC-28's own
criterion text, reworded to match. Consistent with D119's `--as=`
precedent, cited by name.

**AC-28 (`39e6bb4`): 128/128**, exact — confirmed directly
(`node test/ac/ac-28-check.js dist/nj`) and via `run-all`/the gate's oracle
leg below. The two new D4 cases are well-constructed: the empty-`--text=`
case uses a **single-checkbox** body specifically so the "would silently
tick the only candidate" risk D129 names is the actual scenario under
test, not a generic empty-input check; the whitespace-only case reuses
`MARKERS_BODY` (several checkboxes, each containing a space) specifically
so a single space matches **more than one**, landing on
`ambiguous_target` rather than `invalid_value` — proving the implementation
used the space as a real substring instead of silently treating it as
empty. Both mechanisms are the right test for the claim, not just a
plausible-looking assertion.

**Live confirmation, beyond re-running the suite.** Built a single-
checkbox backlog myself: `--text=` → `invalid_value`, `"--text must not be
empty"`, the checkbox byte-unchanged. `--text=" "` on that same
single-checkbox backlog (where a lone space is **not** ambiguous, since
there's only one line to match) ticks the one box — confirming the
no-trimming rule positively, not just by absence of `invalid_value`.
Checked precedence against the other two argument-shape errors: empty
`--text=` combined with both `--on`/`--off` given, and combined with
`--item` also given, both still resolve to `invalid_value` (the same
code either guard would produce) — no observable ambiguity, since
`--text`+`--item`-together is checked first and already produces
`invalid_value` before the empty-string guard is reached, and the
empty-string guard in turn precedes the `--on`/`--off` conflict check;
every order along this path lands on the one code a caller would expect
regardless of which check "wins."

**`gate.js --step=1a93eba --frozen=c6-baseline`: still exactly the same 6
calls.** `BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2` —
byte-identical in composition to `ea5a50f`'s own result, which makes sense:
D129 only adds a new validation branch inside `cmdCheck`, never touches
`help.ts`, so the replay's only differing calls remain the help-text
class from V3.2-A's own promotion. `oracle: passed 75, failed 0, cannot
run 1 (1 expected)` (AC-28 now contributing 128 checks, not 114), `gate:
exit 1, replay CHANGED, oracle green` — same shape as before, correctly
unaffected by this delta.

### Conclusion

The delta is a single, narrowly-targeted guard exactly where D129 says it
should be, the spec text states both the rule and its no-trimming
exception in the two places that need it, AC-28's two new cases test the
actual risk (not a generic placeholder), and the replay/gate are
unaffected beyond what's expected. **Ready to accept.**
