# Edge cases

Where each requested edge case is decided. Some are best expressed as an
acceptance criterion and live in `../ac/`; this folder holds the ones that are
boundary probes rather than criteria. Both are listed here so nothing is
mistaken for uncovered.

| Edge case | Decided in |
|---|---|
| Duplicate ID — write refusal, both paths named, `--file` escape | `duplicate-id-write-refusal.mjs` |
| `done` on a parent with open children — refusal, `--force` does not bypass, `--allow-open-children` | `done-open-children.mjs` |
| Archive with an open subtree — refusal listing the open elements, no `--force` | `rm-and-archive-refusals.mjs` |
| `rm` with children — refusal naming the child, `--cascade`, tombstones remain | `rm-and-archive-refusals.mjs` |
| Tombstone integrity — total loss of `.ids/` | `../ac/ac-18-tombstone-integrity.mjs` |
| Tombstone integrity — **partial** loss (the warning, not the error) | `tombstone-partial-loss.mjs` |
| Empty / whitespace-only acceptance section | `../ac/ac-05-empty-sections.mjs` |
| Acceptance section boundary shapes (sub-heading, EOF, colon, case) | `acceptance-section-shapes.mjs` |
| Non-ASCII values survive byte-exact | `../ac/ac-16-language.mjs` |
| Frontmatter grammar — colon split, quoting, lists, BOM, CRLF, comments, bad lines | `frontmatter-grammar.mjs` |
| Unknown-field rejection verified by checksum | `../ac/ac-06-rejection.mjs`, `../ac/ac-02-golden-files.mjs` |
| Discovery from a nested subdir and from an unrelated dir (exit 1) | `../ac/ac-12-discovery.mjs` |
| `NJ_BACKLOG` override | `../ac/ac-12-discovery.mjs` |

## Contracts added after the first repair

These assert pins that arrived later. They live here rather than in `ac/`
because they are § 4/§ 7/§ 9/§ 11/§ 14 contracts, not § 15 criteria — and
because the § 15 suite was fully green while none of them was asserted, which
is the reason they exist.

| Contract | Decided in |
|---|---|
| § 9 closed failure vocabulary — normative condition→code table, shape on every path, no stray codes | `failure-vocabulary.mjs` |
| § 9 `rm`/`archive` refuse while any `file:unreadable` stub exists | `unreadable-stub-refusals.mjs` |
| § 14 `--fix` mtime snapshot keyed by path, not by id | `fix-duplicate-mtimes.mjs` |
| § 4 discovery message when `backlog/` exists without `.nanojira.json` | `discovery-message.mjs` |
| § 9 `nanojira new` refuses an archived or unreadable parent | `parent-refusals.mjs` |
| § 9 `rm` names its dependents | `rm-dependents.mjs` |
| § 7/§ 12 the *write* side of encoding — LF, no BOM, one trailing newline | `write-encoding.mjs` |
| § 11 archive target collision — nothing moves | `archive-collision.mjs` |
| § 14 empty known field vs empty unknown key | `empty-value-rule.mjs` |
| § 14 `--fix` snapshots mtimes before step 1 | `fix-mtime-snapshot.mjs` |
| § 4 `.njrc` ownership and the D96 odd files/lexing AC-21 lacks (FIFO, ELOOP, non-leading BOM, lone `\r`), § 14 `--fix` writes nothing while `config:invalid` holds, § 9 `io_error` incl. unsearchable ancestor (DECISIONS 93 F1/F3/F4, 96, 98) | `hardening-v3-1.mjs` |
| § 4 `.njrc` ownership: a foreign-owned symlink (needs root; otherwise CANNOT RUN) | `hardening-njrc-foreign-link.mjs` |
| the v3 coverage gaps, one section per clause ID of `../COVERAGE-v3.md` | `coverage-v3-gaps.mjs` |

## Why these are separate from the AC files

An acceptance criterion states an outcome; an edge case probes a boundary the
criterion does not pin. Keeping them apart means a boundary failure cannot be
mistaken for a criterion failure — and, more usefully, that a criterion can pass
while an edge case next to it fails, which is exactly the signal worth having.

Two of them exist because of a specific asymmetry:

- **`tombstone-partial-loss.mjs`** — AC-18 tests the *error* (`.ids/` gone, no
  elements left to prove the loss). The partial case is the opposite: a single
  missing tombstone is a **warning** that must not block `--ready`, because a
  hand-drafted element is legitimate work. Getting this wrong in the safe
  direction still costs: an agent whose work silently vanishes from the ready
  set will go looking in the wrong place.
- **`done-open-children.mjs`** — `--force` and `--allow-open-children` are two
  flags with two jobs. Letting `--force` imply the other is the natural
  shortcut, and § 9 forbids it in one sentence: "It never weakens the parent
  rule."
