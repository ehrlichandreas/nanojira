# V3.5-B verification — `nj log` (`4eab453`, § 12c, D155, AC-41)

Verifier, 2026-10-06. Independent verification, assigned by the Lead.
Work in `/tmp/verif-log` (worktree at `4eab453`, built via `npm ci` +
`tools/bundle.js`), `/tmp/verif-log-nested` (nested, for the replay),
`/tmp/verif-log-probe` (scratch, explicit paths). All removed before
writing this. Read: SPECIFICATION.md § 12c in full, DECISIONS 155 in
full, the full `4eab453` diff (`cmd-log.ts`/`claims.ts`/`parse.ts`/
`flag-table.ts`/`help.ts`/`nj.ts`/`nj-mcp.ts`), `test/ac/ac-41-log.js`
in full. Also ran `log` read-only against the real project backlog
(TSK-041/TSK-042, see § 5).

**VERDICT: pass.** Every mechanism § 12c specifies is implemented
exactly as written, confirmed by diff review and live reproduction,
including tricky note text (embedded colons, a timestamp-shaped
substring, Unicode/emoji) and a genuinely mixed history read straight
off this project's own backlog. AC-41 (39/39) is confirmed to
discriminate three distinct classes of bug by mutation (the tie-break
order, steal/reassert misclassification, dropped notes). `log` is
confirmed to write nothing at all — byte-identical mtimes and hashes
before/after, no stray `.nj-tmp-*` files. The replay against
`c7`/`oracle-frozen-12` shows exactly the 6 help-class calls,
byte-confirmed. One finding, not a defect: a hand-edited note line that
doesn't match the `- <ISO-8601> <author>: <text>` shape is silently
skipped — reasonable, consistent with how this codebase already treats
other malformed hand-edits, but § 12c's own text never states this
explicitly (it only describes which lines *do* become events).

## 1. Diff review against § 12c

**Event classification — confirmed by direct code reading, not by
re-deriving the logic myself.** `claimEvents` (`cmd-log.ts`) classifies
each generation against the one immediately before it:
```js
const kind: EventKind = e.kind === 'released' ? 'released'
  : prev === null || prev.kind === 'released' ? 'claimed'
    : prev.name === e.name ? 'reasserted' : 'stolen';
```
This is a direct, line-for-line transcription of § 12c's own four
bullets (`released` → `released`; `claimed` with no earlier generation
or a `released` one before it → `claimed`; same name claiming again →
`reasserted`; a different name landing → `stolen`). The "previous
holder is not repeated as a field" rule is also confirmed structurally:
the pushed event's own `actor` is `e.name` (the new/current holder)
only — nothing stores the prior name anywhere in the event object; it's
only recoverable from the *previous* event in the merged list, exactly
as specified.

**Generations read ascending, same filtering `highestEntry` already
applies** — `allEntriesAscending` (new in `claims.ts`) filters to
numeric-named files only (`/^\d+$/`), sorted ascending, silently
skipping any entry whose stored `kind` isn't `claimed`/`released` —
matching "non-numeric entries, stray temp files included, are not
generations and are ignored here too," confirmed by reading the exact
same numeric-filename filter `highestEntry` uses just above it in the
same file.

**Ordering and tie-break** — `cmd-log.ts` builds one flat list
(`created` first, then `claimEvents(...)` in generation order, then
`parseNotes(...)` in document order), tags each with a numeric
`_source` (0/1/2), then does one `Array.prototype.sort` on `(at, then
_source)`. Node's `sort` has been spec-guaranteed stable since ES2019
(and has been in V8 since well before the Node ≥ 24 floor this project
requires), so within one source — multiple claim generations or
multiple notes sharing an exact timestamp — the original (generation/
document) order survives the sort untouched, exactly as § 12c's
"within one source, insertion order is already the merge order"
comment states. Confirmed live in § 2 below, not just read.

**Text + JSON shape** — `{ok: true, id, events: [{at, kind, actor?,
text?}]}`, confirmed against AC-41's own L1 (exact object-literal
equality per event) and my own live JSON output (§ 2). Human output:
`formatEvent` reuses `created`/`<verb> by <actor>`/`<author>: <text>`
exactly as § 12c's own example block shows, including hyphenating only
the *human* verb (`reasserted` → `re-asserted`) while the JSON `kind`
field stays un-hyphenated — confirmed these never cross-contaminate
(the hyphenation only happens inside `formatEvent`, never touching the
`merged` array JSON output reads from).

**Addressing** — `resolveTarget(ctx, flags, true)`: the same `true`
("for write") that makes every *write* command treat a duplicate `--id`
as `duplicate_id` rather than silently picking the first match is reused
here verbatim, even though `log` never writes — exactly § 12c's own
framing ("the first read to behave like a write for addressing purposes
only"). `--file` and the `--id`+`--file` `invalid_target` collision are
the same, unmodified `resolveTarget` logic every write already has;
nothing `log`-specific was added for either.

**`refused:unreadable`** — a new `requireReadableForLog` checks both
`file:unreadable` and `frontmatter:unreadable`, giving a distinct hint
for each, worded for a read ("refusing to log") rather than a write.
§ 12c's own text only mentions the `file:unreadable` case by name, but
`frontmatter:unreadable` is the sibling problem code for a file that
opens but doesn't parse — treating it the same way is consistent with
the stated reasoning ("there is no `created` to read" applies equally
to both causes), not an unstated special case.

**No writes** — confirmed by reading the whole command: `cmdLog` never
imports or calls anything from `core/store.ts` (no `guardedWrite`, no
`atomicWrite`, no `refreshStatus`) — there is no code path in the file
capable of writing. Confirmed live in § 2.

## 2. Live reproduction

**A mixed history**: claim → re-assert → steal → note → release, five
distinct timestamps, built by hand in `/tmp/verif-log-probe`:
```
$ nj log --id=TSK-001
2026-10-05T18:00:00Z created
2026-10-05T18:05:00Z claimed by alice
2026-10-05T18:10:00Z alice: wired the route
2026-10-05T18:15:00Z stolen by bob
2026-10-05T18:20:00Z released by bob
```
— and the `--json` form matches § 12c's shape exactly, `kind: "stolen"`
for the steal event with no "previous holder" field anywhere on it.

**Notes with tricky text** — appended three more notes to the same
element and read them back via `--json`:
```
{"actor":"carol","text":"fixed: the bug at 2099-01-01T00:00:00Z: see commit abc:def"}
{"actor":"dave","text":"ünïcödé: 日本語 emoji 🎉 test"}
```
Both parse correctly: carol's text has **three more colons** after the
author-boundary one, and one of them is embedded inside a string that
itself *looks like* an ISO-8601 timestamp — `parseNotes`'s "first `: `
after the author" rule correctly ignores all of that and only uses the
very first occurrence as the boundary. Dave's text is pure Unicode
(diacritics, CJK, an emoji) and round-trips byte-correct through JSON.

**Hand-edited notes that don't match the line format — confirmed, and
confirmed the spec doesn't say what should happen.** Appended four
deliberately malformed lines under the same `## Notes` heading (no
timestamp/colon at all; a timestamp with no `: ` after the author; a
bare non-bullet line; a bullet with no space before the colon). Result:
**all four silently produce no event** — `nj log`'s note-derived events
are exactly the three well-formed ones from before, nothing else, no
error, no warning, `nj doctor` still reports `0 errors, 0 warnings`.
Checked § 12c's text specifically for this case: it describes *only*
what a matching line becomes ("each `- <ISO-8601> <author>: <text>`
line becomes one event") — it never states what happens to a
non-matching line. The implementation's choice (silent skip) is
reasonable and consistent with how this codebase already treats other
hand-edited irregularities (e.g. a stray non-ID-shaped file, per § 9),
but it's an implementation decision the spec text doesn't actually make
explicit. Not a defect; flagging because the task asked directly
whether the spec says so, and it doesn't.

**Archived/unarchived elements**: covered thoroughly by AC-41's own L6
(archive deletes the claims directory, `log` on the archived element
shows only `created` + notes) — read and re-confirmed the fixture
construction is genuine (claim, note, release, `set --status=done`,
then `archive`, with a direct filesystem check that
`.nanojira/claims/<id>/` is actually gone before calling `log`).

**A duplicate id with `--file`**: AC-41's own L4 covers both the
`--id`-alone-on-a-duplicate (`duplicate_id`) and `--file` disambiguation
cases, plus the `--id`+`--file` together (`invalid_target`) case
separately — read and consider this complete; didn't feel a need to
rebuild it live given the straightforward, already-exercised addressing
logic (§ 1 above already confirms this is the *same* `resolveTarget`
every write uses, not new code).

**`nj-mcp log`**, via a raw JSON-RPC call (not the test harness's own
driver): `tools/call` with `{name: "log", arguments: {id: "TSK-001"}}`
against the tricky-text fixture returns `structuredContent` containing
the full 7-note-and-claim-event history, Unicode included, byte-correct
— confirms the "free" `nj-mcp` tool wiring described in the commit
message holds for `log`'s actual richer payload shape, not just a
trivial case.

## 3. Mutation testing — does AC-41 actually discriminate?

**Mutation 1 — swap the tie-break** (`SOURCE_CREATED`/`SOURCE_NOTE`
constants swapped, `0`↔`2`). Rebuilt, re-ran AC-41:
```
FAIL ac-41-log.js — 1 of 39 checks failed
  ✗ L2 all four events share T0, tie-broken created < claim < notes (doc order)
```
Exactly the one test built specifically to catch this, nothing else —
precise discrimination.

**Mutation 2 — misclassify `stolen` (and `reasserted`) as a plain
`claimed`** (the ternary's last two branches collapsed to always
`'claimed'`). Rebuilt, re-ran:
```
FAIL ac-41-log.js — 2 of 39 checks failed
  ✗ L1 event 3: reasserted by alice at T2
  ✗ L1 event 4: stolen by bob at T3
```
Both affected events caught, nothing else.

**Mutation 3 — drop notes entirely** (the `parseNotes` loop commented
out). Rebuilt, re-ran:
```
FAIL ac-41-log.js — 7 of 39 checks failed
  ✗ L1 exactly 6 events ... / L1 event 5: note ... / L1 event 6: released ...
  ✗ L2 ... tie-broken ... / L2 the two notes keep their own document order
  ✗ L6 claim/release events are gone; only created and the note remain
  ✗ L7 only created and the note remain, as a fresh clone would see
```
Wide, correctly-scoped discrimination (every case that depends on a
note surviving fails; nothing that doesn't depend on notes is
affected).

Restored `cmd-log.ts` to the original and rebuilt after each mutation;
confirmed `bundle --check`/`git status` clean and AC-41 back to 39/39
before moving on.

## 4. Replay vs. `c7-baseline`/`oracle-frozen-12`

Used the established direct-`baseline.js` technique (nested worktree,
`test/` swapped to `oracle-frozen-12`, digest-confirmed match before
running):
```
baseline: 7086 calls, nj sha256 4444cd04...
current : 7086 calls, current code sha256 ...b24e3f8f...
compared: 6463 calls (623 excluded as nondeterministic by design)
BEHAVIOUR CHANGED — 6 differing call(s): help 4, --help 2
```
Exactly the 6-call help-class tally. **Confirmed byte-exact** via the
unclipped-`baseline.js` technique (throwaway clip/limit removal, never
committed): extracted the full ordered command list from both the
"was" and "now" help text of all 6 calls. "was" has every command
through `release`/`doctor`, no `next`, no `log`. "now" has the
identical list with exactly two insertions in the correct positions —
`nj --version` (already accepted, v3.4) right at the top, and `nj log
--id=TSK-009` immediately after `nj show`, plus `nj next [...]`
immediately before `nj doctor` (the already-accepted v3.5-A addition,
unaffected by this commit) — nothing else differs anywhere in either
~1,500-character string.

`test/run-all.js` against this same frozen-`test/` snapshot (predates
`ac-41-log.js`, so it isn't in this count): **79/80 pass, 0 failed, 1
expected cannot-run** (`hardening-njrc-foreign-link.js`, the usual
root-only gap). Confirmed separately, against the *current* `test/`,
that `ac-41-log.js` itself is **39/39** (§ 1-3 above).

## 5. `log` against the real project backlog, read-only

Ran `nj log --id=TSK-041` and `--id=TSK-042` directly against this
project's own backlog (no `--backlog` override needed; read-only, no
writes performed). Both produce a complete, correctly-ordered,
plausible history spanning this exact verification round — claim/
release pairs for Oracle, Implementer and myself, interleaved with
notes, in the right order. One detail worth calling out as organic
(not constructed) confirmation of the tie-break rule: TSK-041's history
has a `released by Oracle` event and an `Oracle: AC-40 test code
written...` note **sharing the exact same timestamp**
(`2026-10-05T19:20:30Z`), and `log` correctly orders the release event
*before* the note — claim-derived events sort before notes at an exact
tie, exactly as § 12c specifies, demonstrated here on real data, not a
synthetic fixture built to force the case.

## Summary

`nj log` is implemented exactly to § 12c's letter, confirmed by diff
review (event classification, ordering/tie-break, shape, addressing,
the unreadable-stub refusal, and the total absence of any write path),
live reproduction (a mixed history, tricky note text, hand-edited
malformed notes, `nj-mcp`), mutation-tested discrimination of the test
suite across three distinct bug classes, a byte-exact replay, and a
direct read against this project's own real history. One documentation
observation (not a defect) on the spec's silence about malformed note
lines. **Pass.**
