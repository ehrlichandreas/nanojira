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

**How the oracle handles it:** the exit code is currently *tolerated* rather
than pinned — `T.exit(desc, r, [0, 2])` at every `--fix` call — because the
implementation's post-`--fix` code was still moving when the tests were
written. The real assertion is made on the resulting files. **The exact codes
are not yet pinned in the tests; tightening the tolerance to § 14's rule is a
follow-up task.**

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

## Not an ambiguity, recorded because it looks like one

- **`archive:not_done` severity.** § 11's prose used to say "warning" while the
  table said the code blocks `--ready`. v2 resolved this: the code is `error`
  because the invariant "archived ⇒ done" carries `depends_on` satisfaction into
  the archive. The oracle asserts `error`.
- **`incomplete:*` as a doctor finding.** v2 settled it: Doctor column `—`,
  never a finding, `Blocks --ready` still `yes`. The oracle asserts both halves
  separately, which is the point of AC-19.
