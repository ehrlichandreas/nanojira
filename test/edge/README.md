# Edge cases

Where each requested edge case is decided. Some are best expressed as an
acceptance criterion and live in `../ac/`; this folder holds the ones that are
boundary probes rather than criteria. Both are listed here so nothing is
mistaken for uncovered.

| Edge case | Decided in |
|---|---|
| Duplicate ID — write refusal, both paths named, `--file` escape | `duplicate-id-write-refusal.js` |
| `done` on a parent with open children — refusal, `--force` does not bypass, `--allow-open-children` | `done-open-children.js` |
| Archive with an open subtree — refusal listing the open elements, no `--force` | `rm-and-archive-refusals.js` |
| `rm` with children — refusal naming the child, `--cascade`, tombstones remain | `rm-and-archive-refusals.js` |
| Tombstone integrity — total loss of `.ids/` | `../ac/ac-18-tombstone-integrity.js` |
| Tombstone integrity — **partial** loss (the warning, not the error) | `tombstone-partial-loss.js` |
| Empty / whitespace-only acceptance section | `../ac/ac-05-empty-sections.js` |
| Acceptance section boundary shapes (sub-heading, EOF, colon, case) | `acceptance-section-shapes.js` |
| Non-ASCII values survive byte-exact | `../ac/ac-16-language.js` |
| Frontmatter grammar — colon split, quoting, lists, BOM, CRLF, comments, bad lines | `frontmatter-grammar.js` |
| Unknown-field rejection verified by checksum | `../ac/ac-06-rejection.js`, `../ac/ac-02-golden-files.js` |
| Discovery from a nested subdir and from an unrelated dir (exit 1) | `../ac/ac-12-discovery.js` |
| `NJ_BACKLOG` override | `../ac/ac-12-discovery.js` |

## Contracts added after the first repair

These assert pins that arrived later. They live here rather than in `ac/`
because they are § 4/§ 7/§ 9/§ 11/§ 14 contracts, not § 15 criteria — and
because the § 15 suite was fully green while none of them was asserted, which
is the reason they exist.

| Contract | Decided in |
|---|---|
| § 9 closed failure vocabulary — normative condition→code table, shape on every path, no stray codes | `failure-vocabulary.js` |
| § 9 `rm`/`archive` refuse while any `file:unreadable` stub exists | `unreadable-stub-refusals.js` |
| § 14 `--fix` mtime snapshot keyed by path, not by id | `fix-duplicate-mtimes.js` |
| § 4 discovery message when `backlog/` exists without `.nanojira.json` | `discovery-message.js` |
| § 9 `nj new` refuses an archived or unreadable parent | `parent-refusals.js` |
| § 9 `rm` names its dependents | `rm-dependents.js` |
| § 7/§ 12 the *write* side of encoding — LF, no BOM, one trailing newline | `write-encoding.js` |
| § 11 archive target collision — nothing moves | `archive-collision.js` |
| § 14 empty known field vs empty unknown key | `empty-value-rule.js` |
| § 14 `--fix` snapshots mtimes before step 1 | `fix-mtime-snapshot.js` |

## Why these are separate from the AC files

An acceptance criterion states an outcome; an edge case probes a boundary the
criterion does not pin. Keeping them apart means a boundary failure cannot be
mistaken for a criterion failure — and, more usefully, that a criterion can pass
while an edge case next to it fails, which is exactly the signal worth having.

Two of them exist because of a specific asymmetry:

- **`tombstone-partial-loss.js`** — AC-18 tests the *error* (`.ids/` gone, no
  elements left to prove the loss). The partial case is the opposite: a single
  missing tombstone is a **warning** that must not block `--ready`, because a
  hand-drafted element is legitimate work. Getting this wrong in the safe
  direction still costs: an agent whose work silently vanishes from the ready
  set will go looking in the wrong place.
- **`done-open-children.js`** — `--force` and `--allow-open-children` are two
  flags with two jobs. Letting `--force` imply the other is the natural
  shortcut, and § 9 forbids it in one sentence: "It never weakens the parent
  rule."
