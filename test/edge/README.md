# Edge cases

Where each requested edge case is decided. Some are best expressed as an
acceptance criterion and live in `../ac/`; this folder holds the ones that are
boundary probes rather than criteria. Both are listed here so nothing is
mistaken for uncovered.

| Edge case | Decided in |
|---|---|
| Duplicate ID — write refusal, both paths named, `--file` escape | `duplicate-id-write-refusal.ts` |
| `done` on a parent with open children — refusal, `--force` does not bypass, `--allow-open-children` | `done-open-children.ts` |
| Archive with an open subtree — refusal listing the open elements, no `--force` | `rm-and-archive-refusals.ts` |
| `rm` with children — refusal naming the child, `--cascade`, tombstones remain | `rm-and-archive-refusals.ts` |
| Tombstone integrity — total loss of `.ids/` | `../ac/ac-18-tombstone-integrity.ts` |
| Tombstone integrity — **partial** loss (the warning, not the error) | `tombstone-partial-loss.ts` |
| Empty / whitespace-only acceptance section | `../ac/ac-05-empty-sections.ts` |
| Acceptance section boundary shapes (sub-heading, EOF, colon, case) | `acceptance-section-shapes.ts` |
| Non-ASCII values survive byte-exact | `../ac/ac-16-language.ts` |
| Frontmatter grammar — colon split, quoting, lists, BOM, CRLF, comments, bad lines | `frontmatter-grammar.ts` |
| Unknown-field rejection verified by checksum | `../ac/ac-06-rejection.ts`, `../ac/ac-02-golden-files.ts` |
| Discovery from a nested subdir and from an unrelated dir (exit 1) | `../ac/ac-12-discovery.ts` |
| `NJ_BACKLOG` override | `../ac/ac-12-discovery.ts` |

## Contracts added after the first repair

These assert pins that arrived later. They live here rather than in `ac/`
because they are § 4/§ 7/§ 9/§ 11/§ 14 contracts, not § 15 criteria — and
because the § 15 suite was fully green while none of them was asserted, which
is the reason they exist.

| Contract | Decided in |
|---|---|
| § 9 closed failure vocabulary — normative condition→code table, shape on every path, no stray codes | `failure-vocabulary.ts` |
| § 9 `rm`/`archive` refuse while any `file:unreadable` stub exists | `unreadable-stub-refusals.ts` |
| § 14 `--fix` mtime snapshot keyed by path, not by id | `fix-duplicate-mtimes.ts` |
| § 4 discovery message when `backlog/` exists without `.nanojira.json` | `discovery-message.ts` |
| § 9 `nanojira new` refuses an archived or unreadable parent | `parent-refusals.ts` |
| § 9 `rm` names its dependents | `rm-dependents.ts` |
| § 7/§ 12 the *write* side of encoding — LF, no BOM, one trailing newline | `write-encoding.ts` |
| § 11 archive target collision — nothing moves | `archive-collision.ts` |
| § 14 empty known field vs empty unknown key | `empty-value-rule.ts` |
| § 14 `--fix` snapshots mtimes before step 1 | `fix-mtime-snapshot.ts` |
| § 4 `.njrc` ownership and the D96 odd files/lexing AC-21 lacks (FIFO, ELOOP, non-leading BOM, lone `\r`), § 14 `--fix` writes nothing while `config:invalid` holds, § 9 `io_error` incl. unsearchable ancestor (DECISIONS 93 F1/F3/F4, 96, 98) | `hardening-v3-1.ts` |
| § 4 `.njrc` ownership: a foreign-owned symlink (needs root; otherwise CANNOT RUN) | `hardening-njrc-foreign-link.ts` |
| the v3 coverage gaps, one section per clause ID of `../COVERAGE-v3.md` | `coverage-v3-gaps.ts` |
| § 5 `problems.ignore`: every example in the shipped docs (SKILL.md, references/, README, GUIDE, AGENT-INSTRUCTIONS) is a code nanojira accepts (4.1.0's SKILL.md named `incomplete:acceptance`) | `docs-ignore-examples.ts` |
| docs drift guard: every MCP tool list in GUIDE/SPEC equals the real `tools/list`, documented `init` transcripts equal a real `init`, versions named in SPEC `--version`/GUIDE intro equal `package.json`, the ARCHITECTURE module map covers `src/core/`, SPEC § 9 closed set equals the codes `src/` emits, the archived hint names `nanojira unarchive` (TSK-039) | `docs-drift.ts` |
| § 7 closed severity vocabulary — every table row through `problems.ignore`, the stale warnings really suppressed, every code literal in `src/` has a row, the closed warning list matches the table (DECISIONS 211) | `severity-vocabulary.ts` |
| § 17 `nanojira-mcp` hardening — flag-like note/find text stays text, no `*-file` schema fields, child stdin not connected, per-call timeout, non-object JSON lines, stdin EOF with a call in flight, UTF-8 across chunks, the error message in error results (DECISIONS 214) | `hardening-mcp.ts` |
| § 9 `set --input=-` reads stdin once: a `<role>-file` of `-` inside the JSON is `invalid_value`, as in `new` (TSK-034 F1) | `set-input-stdin-once.ts` |
| § 9 failure table: `new` into a layout folder linked to a file or to nothing is a one-line `io_error` naming the folder, not `internal_error` with a stack; real call, dry run and plan form (DECISIONS 218) | `layout-link-broken.ts` |
| § 9 a flag that takes no value refuses one (`--cascade=false`, `--json=1`), on every command, cross-checked against `--help` (TSK-034 F3) | `boolean-flag-values.ts` |
| § 9 `--` ends option parsing; a flag repeated with a different value is `invalid_value`, an identical repeat is accepted; `--help` twice still prints help; a positional on a command other than note/find is `unexpected_argument` (TSK-034 F11) | `args-end-of-options-and-repeats.ts` |
| § 6 an element id never becomes a path unchecked: a frontmatter `id` outside the § 6 shape is `refused:invalid_id` wherever it would be joined into a path (claims, `doctor --fix` renames, `hierarchy` folders), and a FIFO or device element file is a stub (DECISIONS 215) | `id-path-escape.ts` |
| § 9 `refused:too_large`: no write, single or batch, makes an element file larger than the 1 MiB read cap; one at the cap goes through (DECISIONS 215) | `element-size-cap.ts` |
| § 8 / § 12 Claims: nothing is written, deleted or listed through a symlinked `.nanojira/`, `ids/`, `claims/`, claim directory or claim entry (`refused:symlink`, `claim:symlink`) (DECISIONS 215) | `internal-symlinks.ts` |
| § 8 / § 12 Claims: a link made inside the bookkeeping while a write holds at `NJ_FAULT=before-compare`, `claim-append` or `claim-aside` is still never written or deleted through (DECISIONS 215) | `internal-symlink-races.ts` |
| § 7 `file:unreadable`: a FIFO at STATUS.md, TAGS.md, `config.json`, a claim entry, README.md or `.gitignore` never hangs a command; each caller keeps its answer for an unreadable file (DECISIONS 215) | `non-regular-reads.ts` |

## Why these are separate from the AC files

An acceptance criterion states an outcome; an edge case probes a boundary the
criterion does not pin. Keeping them apart means a boundary failure cannot be
mistaken for a criterion failure — and, more usefully, that a criterion can pass
while an edge case next to it fails, which is exactly the signal worth having.

Two of them exist because of a specific asymmetry:

- **`tombstone-partial-loss.ts`** — AC-18 tests the *error* (`.ids/` gone, no
  elements left to prove the loss). The partial case is the opposite: a single
  missing tombstone is a **warning** that must not block `--ready`, because a
  hand-drafted element is legitimate work. Getting this wrong in the safe
  direction still costs: an agent whose work silently vanishes from the ready
  set will go looking in the wrong place.
- **`done-open-children.ts`** — `--force` and `--allow-open-children` are two
  flags with two jobs. Letting `--force` imply the other is the natural
  shortcut, and § 9 forbids it in one sentence: "It never weakens the parent
  rule."
