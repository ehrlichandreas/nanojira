# Ambiguities in SPECIFICATION.md v2

Every passage below is **not mechanically testable as written**. They are
reported, not guessed at: where a test had to proceed anyway, the chosen reading
is stated and marked in the test source with an `// AMBIGUOUS:` comment, so a
ruling from the spec owner turns into a mechanical edit rather than a hunt.

Ordered by how much they cost if they stay open. Items 1–4 each change the
bytes of a golden fixture, i.e. they change what "correct" means for AC-2.

## Ruled since this was written

Items 1–4 were the four that decide golden bytes. All four are now settled: the
spec and the implementation agree with the reading taken here (§ 6, § 10,
§ 14), the goldens encode the settled bytes, and AC-2 is green.

| # | Ruling | Effect on the oracle |
|---|---|---|
| 1 | **Ruled: optional fields are written only when set.** § 6: "Optional fields are written into a file only when explicitly set; defaults are never materialised"; § 9: "`nj new` therefore omits `priority` unless given" (also `DECISIONS.md` #7) | Reading confirmed; goldens unchanged (`new-*.md`, `set-*.md` pass) |
| 2 | **Ruled by evidence:** the implementation reproduces the scaffold bytes the goldens pin | `new-epic/task/subtask.md` pass unchanged |
| 3 | **Ruled by evidence (§ 10 body rules + § 7 canonical order):** one blank line before `## Notes`; later notes appended directly below the first (also `DECISIONS.md` #15) | `note-*.md` pass unchanged |
| 4 | **Ruled and honoured: `--fix` refreshes `updated`.** § 14: "Each step that modifies a file refreshes that file's `updated`" | Reading confirmed by black-box evidence and implemented; `fix-*.md` encode the refreshed value and pass (AC-2 green) |

---

## 1. Which optional fields does `nj new` write?

**Unpinned.** § 7 says "Empty optional fields are omitted". § 6 lists `priority`
with default `normal` and says "Missing optional fields are not worth a warning
— that is the normal case". Whether `nj new` writes `priority: normal`
explicitly, or omits it and lets the default apply on read, is not stated.

**Why it matters.** It changes one line of *every* golden fixture and of every
file the tool creates. Two readings are defensible and they disagree on the
common case.

**Reading used by the oracle:** optional fields are written only when the caller
supplied them (or when a write explicitly set them). `nj new --type=epic
--title=X` therefore produces no `priority` line. This follows § 6's "missing
optional fields are the normal case"; the opposite reading follows the letter of
§ 7's "empty" and would write `priority: normal` always.

**Affects:** `golden/new-*.md`, `golden/set-*.md`, `ac-02`, `ac-13`, and the
AC-20 goldens (`golden/new-task-sections.md`, `golden/set-section-*.md`) —
none of them write `priority` either.

## 2. Exact scaffold bytes

**Unpinned.** § 9 fixes the *elements* of the scaffold (`# <title>`, then the
configured section headings as empty headings) but not the whitespace: how many
blank lines between the H1 and the first section, and whether the file ends with
a newline.

**Reading used by the oracle:** one blank line between blocks, and the file ends
with exactly one `\n`:

```
---
…frontmatter…
---

# <title>

## Description

## Acceptance Criteria
```

**Affects:** `golden/new-*.md` (the fixtures are the definition), `ac-02`, and
`golden/new-task-sections.md` (`ac-20`) for the scaffold half of that fixture
— the section-write byte rules layered on top (blank-line/insertion/EOF
shape) are pinned separately by `DECISIONS.md` 68–74, not by this item.

## 3. `nj note` placement details

**Unpinned.** § 10 says `## Notes` "is created at the end of the body if absent"
and gives the line format. It does not say whether a blank line separates the
new heading from the preceding body, nor what happens when the body does not end
with a newline.

**Reading used by the oracle:** one blank line before `## Notes`, and the note
line is appended with a trailing newline. A second note appends directly below
the first, with no blank line between them.

**Affects:** `golden/note-*.md`, `ac-02`.

## 4. Does `doctor --fix` refresh `updated`? — RULED

**Ruled: yes, and the implementation honours it.** § 14 states it directly:
"Each step that modifies a file refreshes that file's `updated` (§ 6, 'every
write')". The item was open only while § 14 said just to write
`created`/`updated` *when missing*; the added sentence settled it.

**Reading used by the oracle:** `--fix` refreshes `updated`. Confirmed as
settled, not merely preferred.

**Evidence (black-box, cold-start run 2026-09-21):** a `title:h1_mismatch`
fixture carrying `updated: 2026-01-01T00:00:00Z` was fixed under
`NJ_NOW=2026-01-01T19:30:00Z`; `nj doctor --fix` reported
`synchronised the H1 with title` and the file's `updated` became
`2026-01-01T19:30:00Z`. `golden/fix-h1.md` and `golden/fix-id-from-name.md`
encode the refreshed value (`updated: 2026-09-21T19:30:00Z`) and pass, so AC-2
is anchored to the settled rule.

**Affects:** `golden/fix-*.md`, `ac-02`.

## 5. Exit code of `doctor --fix` — RULED

**Ruled by § 14.** `doctor --fix` reports the findings it **acted on** — the
state *before* the repairs — while its **exit code reflects the state *after***
them: `0` when no `error` finding remains, `2` when one does; a surviving
**warning** alone stays `0`. § 9's "exit 2 is `nj doctor` only" therefore
describes the post-repair state, not a pre-repair snapshot.

**How the oracle handles it — RESOLVED.** The exit code used to be *tolerated*
rather than pinned (`T.exit(desc, r, [0, 2])` at every `--fix` call), because
the implementation's post-`--fix` code was still moving when the tests were
written. That is no longer the case. `edge/exit-doctor-fix.js` pins one value
per fixture across 16 scenarios, derived from § 14 alone, and all seven
tolerating call sites have since been tightened to a single § 14-derived value.
The tolerance is now impossible rather than merely discouraged: `T.exit` throws
when handed an array (see item 23).

**Affects (tolerance carriers):** `ac/ac-02-golden-files.js`,
`ac/ac-18-tombstone-integrity.js`, `edge/empty-value-rule.js`,
`edge/fix-duplicate-mtimes.js`, `edge/fix-mtime-snapshot.js`,
`edge/write-encoding.js`, and `edge/tombstone-partial-loss.js` (which does not
pin the exit code at all). The stale `ac-09` entry is removed: no `--fix` exit
tolerance lives there.

## 6. Is `nj new --parent=<archived id>` allowed?

**Unpinned.** § 9 requires `--parent` to "exist with the correct type". § 11
hides archived elements from `list`, `tree` and the short status. Whether an
archived element still counts as "existing" for a new child is not stated.

**Why it matters.** It decides whether a long-lived backlog can grow under an
already-archived epic, or whether the parent must be re-created.

**How the oracle handles it:** avoided entirely — `ac-08` creates a *second,
active* epic to parent the new task, so the test does not depend on the answer.

**Affects:** `ac-08` (by avoidance).

## 7. Is archiving a child while its parent stays active an `archive:split`?

**Unpinned.** § 7 defines the code as "part of a subtree in archive, part
outside". § 11's prose describes only the other direction: "a child outside the
archive while its parent is inside".

**How the oracle handles it:** `ac-08` archives whole subtrees only, so no test
depends on the reading. `edge/rm-and-archive-refusals` asserts `archive:split`
only in the direction § 11 states.

**Affects:** `ac-08` (by avoidance), `ac-11`.

## 8. The 100-retry abort is not deterministically reachable

**Unpinned by construction.** § 8 computes the allocation *start value* as the
highest number across `.ids/` and all element files, then probes upward with
`O_CREAT|O_EXCL`. Because the start value is the maximum, every number above it
is free unless a concurrent creator claims it first — so exhausting 100 retries
needs roughly 100 simultaneous claimants, which a test cannot schedule reliably.

**How the oracle handles it:** `stress/concurrency.js` runs a 300-wide pool and
asserts the abort's contract *if it occurs* (exit 1, the exact stderr line, no
double-claimed ID), and prints an explicit `NOT COVERED` note when it does not.
The assertion is real but conditional; AC-7's second half is therefore reported
in the matrix as `not covered` in most runs.

**Affects:** `ac-07`, `stress/concurrency.js`.

## 9. Unreadable frontmatter **line** — which code?

**Unpinned.** § 7 requires an unreadable line to be "reported as a problem (with
line number)" while the readable lines stay in use. The closed vocabulary's only
candidate is `frontmatter:unreadable`, defined as "frontmatter block cannot be
parsed" — a different condition. Whether a bad line inside an otherwise parsable
block uses that code or needs a new one is not stated.

**How the oracle handles it:** the test asserts the observable contract (element
stays visible, readable lines still in use, *some* problem reported, line number
present) without pinning the code.

**Affects:** `edge/frontmatter-grammar.js`.

## 10. Unicode normalisation of `title` on write

**Unpinned.** § 7 normalises titles: line breaks become spaces, leading and
trailing whitespace is dropped. Whether Unicode normalisation also happens is
not stated — and on macOS it matters, because HFS+/APFS can hand back decomposed
(NDF) forms while the input was composed (NFC). § 2's byte-exact promise sits
next to a normalisation exception whose boundary is undefined here.

**Affects:** `ac-16` (non-ASCII values), any golden containing non-ASCII.

## 11. `counts.errors` / `counts.incomplete` semantics

**Unpinned.** § 9's read shape has `counts: {total, errors, incomplete}`.
Whether `errors` counts *elements* at Error level or *findings*, and whether an
element can be counted in both buckets, is not stated.

**Affects:** `ac-13`.

## 12. `tree` ordering when it disagrees with the sort rule

**Unpinned.** § 9 fixes the JSON shape as flat with depth-first order conveying
the tree, and separately fixes sort order as priority-desc then id-asc. Which
wins *within a level* of the tree is not stated.

**Affects:** `ac-14`.

## 13. `changed` and `updated` for a write that changes nothing

**Unpinned.** If `nj set --status=todo` is run on an element already `todo`,
§ 12's compare-before-write still sees an identical file, but § 6 says `updated`
is refreshed on every write. Whether such a call is a no-op (empty `changed`,
`updated` untouched) or a write (empty `changed`, `updated` bumped) is not
stated.

**Affects:** `ac-13`.

## 14. `--file=` together with `--id=`

**Unpinned.** § 9 introduces `--file` as an alternative "instead of" `--id`.
Whether supplying both is an error, or which one wins, is not stated.

**Affects:** `edge/duplicate-id-write-refusal.js` (avoided — the test never
passes both).

## 15. What kind of `NJ_NOW` value is "invalid"?

**Unpinned.** § 12: "an invalid value exits 1". Two cases sit on the boundary:

- `NJ_NOW=''` — set but empty. Whether that is invalid, or means "unset, use
  the real clock", is not stated. Guessing wrong in the second direction is
  the dangerous one: a silent fallback to the real clock makes every golden
  test fail intermittently instead of failing loudly once.
- `NJ_NOW='2026-13-45T99:99:99Z'` — shape-valid, semantically impossible. A
  regex validator accepts it; only a calendar check rejects it.

**How the oracle handles it:** both are excluded from the must-fail list in
`fault/nj-now-invalid.js`, which asserts only unambiguous format violations
(no `T`, no `Z`, an offset instead of UTC, a bare date, a non-date).

**Affects:** `fault/nj-now-invalid.js`.

## 16. Where does a section end?

**Unpinned.** § 7: "A section counts as present only if it exists and contains
at least one non-empty line below the heading". Read literally, *any* non-empty
line below the heading counts — including a line that belongs to the next
`##` section. Read as a section, the next level-2 heading ends it.

The two readings disagree on a shape an agent will produce in practice:

```markdown
## Acceptance Criteria

## Notes
- a decision was recorded here
```

**Why it matters.** Literally, this element is complete and appears under
`--ready` with zero acceptance criteria — the exact failure the rule exists to
prevent.

**Reading used by the oracle:** section-scoped — a section ends at the next
level-2 heading, so the above counts as `incomplete:acceptance`. The intent is
unmistakable, but the wording does not say it.

**Affects:** `ac/ac-05-empty-sections.js` (probe `TSK-006`).

## 17. A two-sided hierarchy violation — which side carries the code?

**Unpinned.** A subtask whose parent is an epic violates § 6's three-level rule.
The violation is visible from both ends: the subtask has a wrong-typed parent,
and the epic has a wrong-typed child. § 7 defines `parent:hierarchy` as "three-
level structure violated" without saying whether one side, the other, or both
carry the code.

**Why it matters.** The test structure "exactly one element is malformed, the
rest stay clean" cannot hold if both sides are flagged — and both behaviours are
defensible.

**How the oracle handles it:** `ac/ac-03-fault-tolerance.js` asserts that the
code appears, and that the *violating* element carries it; the "exactly one
malformed entry" invariant is relaxed for this case rather than asserted.

**Affects:** `ac/ac-03-fault-tolerance.js`.

## 18. Where does the unreadable-line line number surface?

**Unpinned.** § 7 requires an unreadable frontmatter line to be reported "with
line number". § 9's `doctor` shape has a `line` field, but its placement is
per-finding and the read shapes (`list`/`show`) carry only codes. Whether the
line number appears only in `doctor --json` or also in `list` output is not
stated.

**How the oracle handles it:** the assertion looks for the line number in
`doctor --json`, where § 9 puts it.

**Affects:** `edge/frontmatter-grammar.js`.

## 19. Does `nj init` create the index file?

**Unpinned.** § 4's layout lists `.nanojira-index.json`, but § 13 says round one
ships without an index and the file is "a local cache, never the truth" whose
absence costs one rebuild. Whether `nj init` creates it, creates it empty, or
leaves it absent is not stated.

**How the oracle handles it:** by avoidance — `ac/ac-01-basic-run.js` asserts
neither its presence nor its absence, so the test does not depend on the answer.

**Affects:** `ac/ac-01-basic-run.js`.

## 20. The exact bytes of the generated `.gitignore`

**Unpinned.** § 4 pins the two *patterns* (`.nanojira-index.json` and
`.nj-tmp-*`) but not their order, nor the trailing newline, nor whether a header
comment is written.

**How the oracle handles it:** the patterns are compared as the set of
non-empty lines, which is the part § 4 actually fixes.

**Affects:** `ac/ac-01-basic-run.js`.

## 21. "Without network" is not observable from inside the suite

**Unpinned in practice.** AC-15 requires that `nj` runs "without network". No
test can demonstrate that from the outside without a sandbox: an implementation
that opened a socket only on an unused code path would pass every assertion the
suite can make.

**How the oracle handles it:** the criterion is verified *indirectly* — the
script runs under the runtime Node from `runtime/`, with `NODE_PATH` emptied,
with no `node_modules` anywhere under the project, and with no non-builtin
module resolvable. `ac/ac-15-no-dependencies.js` states this in its header
rather than asserting something it cannot observe. **AC-15 is therefore reported
as partially covered in the matrix, not as a pass.**

**Affects:** `ac/ac-15-no-dependencies.js`.

## 22. The closed vocabulary is 30 codes, not 29 and not 27

**Not ambiguous, but a counting trap, and it has now caught three different
counts.** § 7's table has **29 rows** and **30 distinct codes**:

- the `missing:created` / `missing:updated` row names **two** codes, so rows ≠ codes;
- `duplicate_id` and `active_refs_archived` carry no `:` or `.`, so a count that
  pattern-matches on a separator reports **28** — the count this file previously
  recorded, and the one two tests embedded;
- counting rows reports **29**, which is what a brief to this task said.

`file:unreadable` and `unknown:priority` were added in the latest revision.

**Why it matters.** Three places need the *full* list — a vocabulary-membership
assertion, the `—`-never-a-finding check, and any future "is this code known"
guard. An off-by-one there silently accepts an unknown code or rejects a valid
one. It also means the count must be derived from the spec, never from memory.

**Affects:** `ac/ac-13-json-contract.js` (embeds all 30), `ac/ac-03-fault-tolerance.js`.

## 23. § 9's failure vocabulary — RESOLVED, and how the oracle got it wrong

**Resolved.** § 9 now carries a **normative condition→code table**, so paths and
codes are mapped and nothing here is inferred any more.

**What this item used to say, and why the history is kept.** It recorded that
§ 9 gave the closed set but no mapping, so the codes were inferred from their
names. To stay honest about that, the vocabulary test accepted *either*
`invalid_value` or `invalid_target` for a wrong-typed `--parent`.

That was the wrong response to the ambiguity, and it failed silently: the table
settled the question as `invalid_target`, the implementation emitted
`invalid_value` — also inside the closed set — and the either/or assertion
stayed green while the spec was violated. A test that accepts any in-set code
cannot tell a correct implementation from a wrong one.

**The rule this leaves behind.** An either/or is only honest where the spec
genuinely leaves the choice open. Where the spec decides, accepting two values
is indistinguishable from accepting a bug — and relaxing an assertion instead of
chasing the mapping is exactly how a vocabulary test decays into a shape test.
The array form was **removed** from the helper rather than left unused, so it
cannot be switched on quietly again.

**Still unpinned, by the spec's own statement.** `invalid_env`,
`invalid_backlog_env`, `id_allocation_failed` and `internal_error` are
**reserved**: § 9 says the implementation may emit them from its own error
paths, and that no passage names them. The test therefore asserts only that they
are inside the closed set — the strongest claim available.

**Affects:** `edge/failure-vocabulary.js`. (The file lives here, not at
`ac/ac-20-failure-vocabulary.js` as this item previously said: it is a § 9
contract, not one of § 15's nineteen criteria, and an `ac-20-*` name would
claim a criterion that does not exist.)

## 24. "Preserved verbatim" vs "written quoted when empty"

**Unpinned — a tension between two sections.** § 14 says an empty value on an
**unknown** key "is a value and is preserved verbatim (§ 7, `custom: ""`)".
§ 7 says a value "is written quoted (`"…"`) when it is empty". For a
hand-written `custom:` with nothing after the colon, the two rules disagree on
the bytes that survive a write cycle: `custom:` or `custom: ""`.

**Reading used by the oracle:** § 7's serializer rule wins (it is the rule for
writing, and § 14's own example is the quoted form), and "verbatim" is read as
"not dropped" rather than "byte-identical spacing". The test asserts the key
and its emptiness survive, not the exact spacing.

A related one, same family: § 7 says the body is written back byte-for-byte,
while the same section requires files to be written LF regardless of how they
were read. A body that arrived with CRLF sits between the two; the oracle
applies the LF rule to the whole file.

**Affects:** `edge/empty-value-rule.js`, `edge/write-encoding.js`.

---

## 25. Which element(s) carry `depends_on:cycle`?

**Unpinned.** § 7 defines the code over a whole-graph predicate ("the
`depends_on` graph contains a cycle"), not a per-element condition, so it does
not by itself say which element(s) a finding attaches to. Three readings are
live: **(a) member** — only elements literally on a cycle; **(b) reaches** —
(a) plus any element whose `depends_on` chain leads into a cycle without being
part of it; **(c) every element** — the graph predicate applied
backlog-globally, with no per-element distinction at all.

Structurally the same open question as item 17 (`parent:hierarchy`, which side
carries the code), where the oracle already chose to assert only "the code
appears" rather than pin a side. Pinning here while loosening there would be
inconsistent with the project's own practice.

**Observed (not authoritative — not a basis for the oracle's assertions):** the
current `nj` implements **(b)**. An element that merely depends on a cycle
member carries the code too, although it is not itself part of any cycle.

**How the oracle handles it:** `edge/state-cycle-all-members.js` asserts only
what holds under all three readings — every actual cycle member carries the
code, and a dependency-free control does not — and carries a "reacher" fixture
element with **no assertion on it**, ready for whichever of (a)/(b) is ruled.

**Affects:** `edge/state-cycle-all-members.js`.

## 26. "bounded at 100 retries" — counts probes, or retries after a first attempt?

**Ruled, but NOT compelled by the text.** § 8 says the allocator probes upward
"bounded at 100 retries, then exit 1 with the stderr line `nj: id allocation
failed after 100 retries (<TYPE>)`". Read literally, "retry" can exclude the
first attempt (1 + 100 = 101 probes) or include it (100 probes in total).

**Decision (Lead).** At most **100 exclusive probes in total**.

**Honest provenance of this ruling — read this before citing it.** It was first
justified as a necessary consequence of the mandated error line: a program that
prints "failed after 100 retries" after 101 probes would contradict its own
output. **That argument does not hold**, and a verifier said so: if the first
attempt is "the attempt" and the following 100 are the "retries", the sentence
stays literally true at 101 probes. § 8 does not decide between the two, and
`DECISIONS.md` 30 only governs the case of `<TYPE>`.

So this is a **choice**, recorded as one. It is not derived, and it must not be
cited as something the spec says. It stands because it is coherent, because the
oracle implements it consistently, and because leaving the bound unpinned would
leave the abort leg untestable.

**Affects:** `fault/det-id-retry.js` (99 collisions → success at start+100;
100 collisions → abort), `stress/concurrency.js` (unchanged).

## 27. What does `changed` name, and in which order?

**Ruled.** § 9 (Z. 965) says only "`changed` lists exactly the fields that
changed", which leaves open whether mandatory fields count as "changed" on a
first write, and says nothing about order.

**Decision (Lead), membership:** on `nj new`, `changed` names **all written
frontmatter fields except `created`/`updated`**, not just the optional flags
that were passed.

*Corrected once.* The first wording was "all written fields", which a verifier
showed to be literally wrong: `created` and `updated` are always written and
named by no one. The exclusion is part of the ruling, not a detail.

**Decision (Lead), order:** § 7 canonical key order for frontmatter fields,
then section roles in the canonical role order (`description`, then
`acceptance`).

**Reasoning (spec-internal):** § 9 (Z. 591) requires `changed` to *additionally*
name the section roles written for `new`/`set` — it is therefore designed as a
complete account of what was written, not as a list of the flags given. § 9
(Z. 391) sets "one vocabulary in three places", so the JSON write result follows
the order the spec already fixes for the file.

**Not a valid justification for this, and rejected during review:** `DECISIONS.md`
19. It states the same thing, but it is an implementer document and therefore
carries `nj`'s provenance, not the spec's.

**Affects:** `edge/encoding-changed-order.js`.

## 28. The JSON entry object carries more shape than § 9 documents

**Unpinned, and wider than an ordering question.** § 9 fixes the top-level key
order of each shape verbatim, but not the key order *inside* an entry object.
Cross-verified measurement of the actual sequence:

    id, type, [parent], title, status, priority, [assignee], tags,
    depends_on, created, updated, [archived], file, _problems

`priority`, `tags` and `depends_on` appear **always**, materialised with their
defaults; `assignee`, `parent` and `archived` only when set; `file` always.

§ 9 does not cover this: its example shows no `priority`/`tags`/`depends_on`
and no `file`, and the table abbreviates to `{…, _problems}`. Only `file` is
covered, by `DECISIONS.md` 39. § 6's "defaults are never materialised" governs
**files, not JSON**, so it does not settle it either.

**Why this matters more than it looks:** undocumented shape is shape a refactor
can change silently. Nothing in the spec would be violated, and nothing would
go red. This is a candidate for a § 9 sentence, not just an oracle reading.

**Reading used by the oracle:** § 7 canonical order, `_problems` last — every
JSON example in § 9 shows `_problems` last, which is a textual pattern rather
than a guess.

**Affects:** `edge/encoding-json-key-order.js`.

## 29. `doctor --fix`'s `fixed[]` report order

**Unpinned.** § 14 pins the order in which the repair steps **run** (the
numbered list 1–8), but not the order in which `--json`'s `fixed[]` array
**reports** them.

**Reading used by the oracle:** the same order as execution — "reports the
actions it took" reads most naturally as "in the order it took them".

**Affects:** `edge/encoding-json-key-order.js`.

## 30. Which `## Notes` does "before `## Notes`" mean when there are two?

**Unpinned.** § 9 says a written `acceptance` section goes "before `## Notes`
when present" — in the **singular**. § 9's "if several headings match one role,
the first match wins" governs *role* headings (`description`, `acceptance`), so
it does not literally settle a body that carries two `## Notes` headings.

**Not pinned by the oracle, deliberately.** A mutant that inserts before the
*last* `## Notes` instead of the first passes the whole suite today. That is a
real blind spot, and it is recorded rather than closed, for the same reason the
five precedence pins were loosened (items 31–35): the oracle pins what the
spec decides. What `nj` does beyond that is caught by the S0 corpus, which
compares recorded bytes across refactor steps — so a silent change here goes
red there without the oracle having to elevate an undecided reading into a
contract.

**Cheap fix if the spec owner rules:** § 9 gains the word "first" ("before the
first `## Notes`"), and a double-`## Notes` fixture becomes assertable.

**Affects:** `ac/ac-20-section-writes.js` (not asserted),
`edge/state-note-appears-once.js` (not asserted).

**And `nj` does not agree with itself here.** The two code paths that look for
the heading choose opposite ends: `sectionHeadingIndex` returns on its **first**
match, while the note-appending path assigns in a loop with no `break` and so
keeps the **last**. Given two hand-placed `## Notes` headings, `nj note` appends
under the second while `set --acceptance` writes before the first. The header of
`edge/state-note-appears-once.js` claims the two paths share one notion of "the
one `## Notes` heading" — they do not.

This is not reachable through the CLI, whose uniqueness invariant holds for
files it creates, but § 7 makes the body the user's property and a hand edit
reaches it. Whichever way the spec rules, one of the two paths becomes a bug —
worth knowing before a refactor touches either.

### Fixture-design note, recorded so the recipe is not miscopied

The § 9 clause "acceptance is inserted before `## Notes` when present" is only
observable when a body puts a foreign section **between** `## Description` and
`## Notes`. Verified across six body forms:

| Body form | Separates "before Notes" from "after Description"? |
|---|---|
| Description → Notes | **no — blind** (rule and fallback hit the same index) |
| Description → Other → Notes | **yes** |
| Description → Notes → Other | **no — blind** (a trailing section does not help) |
| Notes only, no Description | yes |
| Notes before Description | yes |
| two `## Notes` | only for the "which Notes" question (item 30) |

The third row is the trap: putting the unknown section at the *end* looks like
the same fixture and tests nothing. The blind form existed twice in the oracle
(`ac/ac-20-section-writes.js` and `edge/state-note-appears-once.js`); both were
corrected by inserting the foreign section in the middle, and both now fail
against the mutant that disables the Notes branch.

## 31–35. Five error-precedence collisions — RULED UNPINNED

Five places where two or more conditions hold at once and § 9/§ 11 name a code
for each but never order them. All five are **ruled unpinned**: the oracle
asserts the envelope (exit 1, `error` is a string, and the whole backlog stays
byte-identical) and does not pin which code wins.

**The shared reasoning, stated once.** The oracle pins what the spec decides.
What `nj` does *beyond* that is covered by the S0 corpus — ~2900 recorded
invocations compared byte-for-byte at every refactor step — so a silent change
in which error wins goes red there, without the oracle having to elevate an
undecided reading into a contract. Pinning them would make a legitimate
reordering of internal checks produce red tests on correct behaviour from S1
onward, and false alarms of that kind are how a team learns to click past red
lines. Consistent with item 17 (`parent:hierarchy`), where the oracle already
loosens rather than pins.

In every case the **single-fault neighbours stay pinned** — they are what makes
the loosened case legible as a collision in the first place.

| # | Collision | Codes in play | Oracle |
|---|---|---|---|
| 31 | `nj archive --force` on an unfinished subtree | `unknown_field` / `refused:not_done` | `exit-precedence.js` §4 (`af1`); control without `--force` stays pinned |
| 32 | `nj archive --force` on a non-existent id | `unknown_field` / `not_found` | §4 (`af3`) |
| 33 | `--id` and `--file` together, both naming nothing | `invalid_target` / `not_found` | §5 (`if2`); the two-valid-references case stays pinned |
| 34 | Both value forms for one role, with an unreadable path | `invalid_value` / `not_found` | §6 (`r1`); unreadable path alone stays `not_found` |
| 35 | Unfinished subtree archived onto an occupied target | `refused:not_done` / `exists` / `duplicate_id` | §7; what §11 *does* decide is asserted — the command fails and moves **nothing** ("a partially executed archive is forbidden"), carried by a whole-backlog checksum |

**A rejected argument, recorded so it is not re-derived.** For item 34 it was
argued that "with nothing written" makes the form error a pre-execution check
and therefore orders it first. It does not: § 9 gives the unreadable-path case
`not_found` while that path, too, writes nothing. "Nothing written" separates
neither check from the other and orders nothing. The retraction is also carried
in the test source at the site.

**An observation that cuts against a general rule.** § 9 orders exactly one
comparable case explicitly — the stub guard is "evaluated **before the target is
resolved**: even a `--id` that names nothing yields `refused:unreadable`, not
`not_found`". That the spec becomes explicit there and stays silent here argues
against, not for, a general "arguments before resolution" principle.

## Not an ambiguity, recorded because it looks like one

- **`archive:not_done` severity.** § 11's prose used to say "warning" while the
  table said the code blocks `--ready`. v2 resolved this: the code is `error`
  because the invariant "archived ⇒ done" carries `depends_on` satisfaction into
  the archive. The oracle asserts `error`.
- **`incomplete:*` as a doctor finding.** v2 settled it: Doctor column `—`,
  never a finding, `Blocks --ready` still `yes`. The oracle asserts both halves
  separately, which is the point of AC-19.
- **`show --json`'s shape.** § 9's JSON-shapes table says `| list, show |
  {backlog, counts, entries: [{…, _problems}]} |` — `show` shares `list`'s read
  shape, a single-element `entries` array, and has **no** singular `entry` field
  (that belongs to the write commands). Recorded because it is an inviting
  misreading: two separate test files assumed `entry` and produced `undefined`
  rather than a clear failure, which cost a round of diagnosis.
