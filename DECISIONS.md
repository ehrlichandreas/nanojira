# DECISIONS — nj round one

Every decision the implementation had to take that SPECIFICATION.md v2 does not
state outright. One line each, with the spec reference that constrains it.
Written for adversarial review: if a line reads like a guess, challenge it.

## Parser and serializer

1. **Unreadable frontmatter *lines* use `frontmatter:unreadable`** — § 7 demands a
   per-line problem with a line number but the closed table has no separate code,
   and § 7's table forbids inventing one; the whole-block and per-line conditions
   share the code, the line number rides in the finding's `line` field (§ 9).
2. **Duplicate frontmatter keys** keep the first occurrence and report
   `frontmatter:unreadable` on the later line — § 7 grammar is "one `key: value`
   line per field", so the second is not a readable line.
3. **A quoted or bracketed value with trailing characters is unreadable**
   (`title: "a" x`) rather than silently reinterpreted — § 7 "nothing is guessed at"
   (§ 14).
4. **A list field holding a plain scalar is coerced to a one-item list**
   (`tags: backend` → `["backend"]`, empty → `[]`) — § 7 says values are "a string,
   or `[a, b]` for lists"; coercion keeps a hand-written file usable (§ 6 "unreadable
   lines do not break the file") and it re-serializes canonically.
5. **List items are quoted on write when empty, containing `,` or `]`, starting
   with `"`, or carrying edge whitespace** — § 7 fixes the *reading* rule for items
   but not the writing rule; this is the minimal set that round-trips.
6. **Newlines in any scalar value collapse to spaces on write** — § 7's format is
   line-based, so a multi-line value would corrupt the block. Only `title` is
   additionally trimmed (§ 2, § 7).
7. **`priority` is omitted when not explicitly set**; the `normal` default is applied
   on read — § 6 "missing optional fields are not worth a warning", § 7 "empty
   optional fields are omitted".
8. **An invalid `type` value is reported, never repaired.** The effective type falls
   back to the ID prefix and the element carries `type:derived` (the closed table has
   no code for an invalid type value, and the observable condition is exactly "the
   type had to be derived"). `doctor --fix` writes `type` **only when the key is
   absent** — § 14's "never overwrite an existing value, even an invalid one".
   *Corrected after verification finding m4: the earlier wording said the value was
   "treated as absent", which invited `--fix` to overwrite it.*
9. **Frontmatter `type` contradicting the ID prefix surfaces as `type:folder`** —
   § 14 step 3 sets the precedence frontmatter > prefix > folder, so the effective
   type is the frontmatter's and the file is then in the wrong folder; `--fix`
   refuses to move it because prefix and type disagree. No new code needed.
10. **An ID with no recognised prefix, in a folder that cannot supply a type,
    yields `type:folder`** — the element cannot be placed; § 7 has no `id:invalid`
    code and the vocabulary is closed.

## Body

11. **A section ends at the next `#` or `##` heading; `###`+ counts as content** —
    § 7 requires "at least one non-empty line below the heading" but does not bound
    the section; a subsection is content, a sibling heading is not.
12. **If several headings match one role, the section counts as present when *any*
    of them has content** — § 7 names the role, not an occurrence.
13. **`nj new` scaffolds with `sections.<role>[0]`** — § 9 says "the configured
    section headings"; the first entry is the backlog's own preferred spelling (§ 5).
14. **The H1 is rewritten only when `title` actually changes** (and by
    `doctor --fix`) — § 7 "on every title change"; a `set --status=…` therefore
    leaves a drifting H1 alone, which `title:h1_mismatch` reports instead.
15. **`nj note` appends after the last non-empty line of an existing `## Notes`
    section**, or creates `## Notes` at the end of the body — § 10 fixes the line
    format and the creation rule but not the insertion point.
16. ~~`nj note` reports `changed: ["body"]`.~~ **Now pinned in § 10** — no longer a
    decision. Retained as a number so earlier review references still resolve.

## Commands

17. **`nj set` with no effective change writes nothing** — `changed: []`, `updated`
    is not bumped, the file stays byte-identical. Protects AC-2 and avoids a
    pointless write; § 9 "`changed` lists exactly the fields that changed".
18. **`nj new` accepts `--status`** — the § 9 synopsis omits it but the same section
    states "`--priority` and `--status` are validated against the config"; default
    stays `statuses[0]` (§ 6).
19. **`nj new` reports `changed` as the frontmatter fields written**, minus
    `created`/`updated` — consistent with decision 16.
20. **Writes are refused on any element with an unreadable file or *any* unreadable
    frontmatter line** (`file:unreadable`, `frontmatter:unreadable`) — such a file
    cannot be round-tripped without dropping the lines that failed to parse, which
    § 6 promises never to do. This refusal holds **inside `doctor --fix` too** (see
    decision 44). All other error-level codes still allow writes, so `set --title=…` can
    repair a `missing:title`. *Corrected after verification finding C3: the earlier
    wording implied only a whole-block parse failure.*
21. **`nj rm` names inbound dependents as a warning** and still deletes — § 9's pin.
    It does not refuse: the child rule is the only hard gate, and the resulting
    `depends_on:dangling` is `doctor`'s to report. *Corrected after verification
    finding m7: the earlier decision stayed silent about dependents.*
22. **`nj archive` refuses when the target archive path is occupied** — § 11 argues
    collisions are impossible; if one appears anyway, refusing beats overwriting.
23. **Archived children count as done for `done:open_children`** — § 11 states the
    invariant "archived ⇒ done" and `archive:not_done` enforces it.
24. **`archive:split` is reported on the child** (the element outside the archive
    whose parent is inside) — § 7 defines the condition, not its carrier; the child
    is the movable party.
25. **Archived-ness is decided by the `archive/` folder, not the `archived` field** —
    § 11 moves files; the field is the tool-written timestamp (§ 6).
26. **`counts` always describes the backlog scope** (archived included only with
    `--all`), never the filtered result — § 9's example shows `total: 47` beside a
    single filtered entry.
27. **`nj list --ready`'s "Complete first" block lists elements in the initial
    status that are incomplete** — § 9's example shows exactly that pairing.
28. **Epics can be ready** — § 9's ready rules make no type exception and AC-4 says
    "epics need only a description".
29. **`--tags=`/`--depends-on=` reject items containing `]`; `,` is the separator
    and thus unreachable** — § 9 requires rejecting both; the separator makes the
    comma case structurally impossible rather than diagnosable.

## Identifiers, config, discovery

30. **The retry-exhausted stderr line uses the ID prefix**: `nj: id allocation failed
    after 100 retries (TSK)` — § 8 writes `(<TYPE>)` in upper case, which matches the
    prefix, and the prefix is the namespace that actually ran out.
31. **`nj new` keeps the tombstone when the element write then fails** (e.g. under
    `NJ_FAULT`) — § 8: the tombstone is the claiming authority and never-reuse
    outranks dense numbering.
32. **A missing `.nanojira.json` is `config:invalid`** for `doctor` and a hard exit 1
    for everything else — § 5 makes an invalid config fail that way and § 4 makes the
    file the marker of a backlog; v1's "defaults apply if absent" is gone from v2.
33. **`schema` must be `1` when present, and may be absent** — § 5 pins the shape
    without stating the check.
34. **`doctor` uses a lenient discovery** that accepts a `backlog/` folder without a
    config — otherwise § 5's `config:invalid` would be unreachable, since § 4's
    discovery keys on `backlog/.nanojira.json`.
35. **`NJ_BACKLOG` must point at an existing directory containing the config**
    (lenient for `doctor`) — § 4 "never operate on an empty backlog".
36. **"`id` ascending" sorts by prefix, then numerically** — § 9; plain string order
    would put `TSK-1000` before `TSK-999`, which § 8 explicitly allows to occur.

## Output and runtime

37. **Human `doctor` output stays prose without codes**, matching § 14's example
    verbatim; `list` shows codes, matching § 9's `--ready` example verbatim. Codes are
    always available via `--json` (§ 9).
38. **The `doctor` summary prints the backlog path relative to the working
    directory** — reproduces § 14's `backlog/: 47 entries, 2 errors, 1 warning`
    exactly when run from the project root.
39. **Entry objects carry an extra `file` field** — § 9 fixes the shape but `--file`
    (§ 9, duplicate-ID escape hatch) is unusable without the path. Additive only.
40. ~~Shebang is `#!/usr/bin/env node`.~~ **Now pinned in § 3** — no longer a
    decision. Retained as a number so earlier review references still resolve.
41. **CommonJS, no `package.json`** — an extensionless executable is CommonJS by
    default; adding a manifest would invite a dependency (§ 3).
42. **`after-tmp-write` closes the file descriptor before exiting** — § 12 says
    "before `fsync`"; closing is unavoidable on exit and the observable contract
    (temp file present, target untouched, exit 1) holds.
43. **`doctor --fix` reloads the backlog between every numbered step** — § 14 makes
    the order load-bearing, so each step must see the previous step's result.
44. **`doctor --fix` skips a file carrying `file:unreadable` or *any*
    `frontmatter:unreadable` line, and reports it as a NOTE** — every repair step
    re-renders the file from its parsed fields, so touching such a file would
    silently delete the lines that failed to parse. § 14 "ambiguity is reported, not
    guessed at"; § 7 "no information may vanish silently". *Corrected after
    verification finding C3, which showed the old `parsed` flag was true for a block
    that opened and closed correctly but contained a broken line — so `--fix` did
    rewrite it and did lose data.*
45. **`--fix` step 8 (index rebuild) is a deliberate no-op** — § 13 defers the index
    to round two.

## Added while fixing the verification findings

46. **An unreadable file becomes a stub element carrying only `file:unreadable`.** No
    content-derived code is invented for it — no `missing:title`, no `incomplete:*`,
    no parent or dependency checks — because nothing about its content is known.
    `duplicate_id` and `id:no_tombstone` still apply: both derive from the file name,
    which *is* known. The element stays visible in `list` and `tree` (§ 7).
47. **`file:unreadable` findings carry no line number**; `frontmatter:unreadable`
    findings carry one per broken line. Both share the per-detail reporting path, so
    `doctor --json` shape stays uniform (§ 9).
48. **`--file` comparison goes through `fs.realpathSync.native` on both sides**; when
    that throws, the fallback resolves the *parent directory* and re-appends the base
    name. *Corrected after round-two verification: the old fallback was
    `path.resolve(p)`, which made this decision false in its own example — for a
    dangling symlink realpath throws on both sides, and `path.resolve(<user path>)`
    never equals the scanned path under the real backlog directory, so
    `--file=<dangling symlink>` returned `not_found` instead of reaching the stub of
    decision 46. Resolving only the parent lets both paths meet at the same real
    location.*
49. **`rm --cascade` refuses when the subtree contains archived elements** — § 9
    makes archived elements read-only, and a cascade must not become the back door
    that deletes them.
50. **The CLI failure vocabulary is a small token set**, not the § 7 problem codes:
    `no_backlog`, `backlog_without_config`, `invalid_config`, `invalid_env`,
    `invalid_backlog_env`, `unknown_field`, `unknown_command`, `missing_argument`,
    `missing_value`, `invalid_value`, `invalid_target`, `not_found`, `duplicate_id`,
    `exists`, `changed_in_parallel`, `id_allocation_failed`, `internal_error`,
    `refused:*` (`unreadable`, `archived`, `children_open`, `has_children`,
    `not_done`, `parent_archived`) and `fault:*`. § 9 pins `{ok:false, error:"<code>",
    hint?}` but defines no vocabulary; the § 7 table is about element state, not
    command outcomes, so reusing it would have been a category error. `duplicate_id`
    is the one deliberate overlap, because there the element state *is* the cause.
51. **The `--json` failure object goes to stdout while the prose goes to stderr**,
    both on the same run — § 9 says "prose error text goes to stderr only", which
    constrains the JSON, not the stderr stream. A non-JSON caller sees exactly what
    it saw before.
52. **`before-compare` polls every 50 ms via `Atomics.wait`** on a throwaway
    `SharedArrayBuffer` — the only dependency-free synchronous sleep in Node. The
    hook fires *before* the `--force` branch, so `--force` still waits for the
    marker and then writes through, which is what § 12's expected outcome requires.
53. **`.nj-fault-go` is left in place for the test to clean up** and is deliberately
    not matched by `backlog:stray_tmp`, whose pattern is `.nj-tmp-*` (§ 7).
54. **Elements unreachable from any root are emitted as extra roots in `tree`.** A
    parent cycle makes every member unreachable; hiding them would be the silent
    failure § 4 argues against. `tree --id=<x>` keeps the single-root behaviour, as
    the caller named the root explicitly.
55. **`show --file=<path>` shows exactly that file even when the ID is duplicated**,
    while `show --id=<x>` shows every file claiming the ID. `--file` exists precisely
    to disambiguate, so honouring it as a narrowing filter is the point (§ 9).
56. **`list --tag` and `--assignee` are not validated**, unlike `--status` and
    `--parent`. § 9 pins validation for those two only, and tags and assignees are
    free text with no registry (§ 6) — there is nothing to validate against.

## Added while fixing the round-two verification findings

57. **`nj archive` verifies every move target before the first move.** The `exists`
    check used to sit inside the move loop, so a collision on the second element left
    the first one already archived — an archived parent with a live child, i.e.
    `archive:split` plus `duplicate_id`, and a retry that dead-ends on the duplicate.
    § 11 now pins the all-or-nothing rule; the compare-before-write pass runs over the
    whole subtree before any move too, for the same reason.
58. **Traversal uses one prebuilt parent→children map per command** instead of
    re-scanning the element list per node. `tree` and `descendants()` (`rm --cascade`,
    `archive`) were O(n²): 971 ms at 10 000 elements, 188 ms after the fix, in line
    with `list` at 177 ms (§ 13, which names this as the fix and keeps the index
    deferred). The map preserves scan order, so the unsorted callers keep their exact
    previous output; `tree` sorts each bucket once with `compareElements`.
59. **`doctor --fix` snapshots every file's mtime before step 1, keyed by path.** Step 5
    derives `created` from the mtime, but step 1 is itself a write — a file missing both
    `type` and `created` used to end up with the step-1 write time as its `created`,
    losing the original. § 14 now pins the snapshot. *Corrected after round-three
    verification: the key was the ID, so two files carrying the same duplicated ID
    collided and the second one's mtime won for both — `TSK-005.md` (2020) and
    `TSK-005-copy.md` (2019) both came out as 2019. The key is the path, and the renames
    in steps 2 and 3 go through a helper that carries the entry over to the new path.*
60. **For known fields an empty value counts as absent; for unknown keys it is a
    value.** `status:` with nothing after the colon used to be a permanent dead end —
    reported as `missing:status` forever, never written by `--fix` because the key was
    technically present, and never explained by a NOTE. `--fix` now fills it, while
    `custom:` keeps its empty value verbatim (§ 14, and decisions 5 / 44 still hold for
    unknown keys).
61. **`nj new` refuses an unreadable stub as `--parent`**, with `refused:unreadable` —
    the same reason as an archived parent: the stub's type cannot be verified and § 6
    forbids inventing facts about it. Checked immediately after existence, before the
    type check, since a folder- or prefix-derived type would otherwise let it pass.
62. **`rm --cascade` emits a top-level `_problems: []` while `archive` emits the
    union.** The asymmetry is deliberate and § 9 now states it: deleted elements are
    gone, so their problems are gone with them; archived elements still exist and can
    still carry findings.
63. **`nj help` stays prose regardless of `--json`.** § 9 defines `--json` for the
    command set of that section, and `help` is not one of them.

## Added while fixing the round-three verification findings

64. **A wrong-type `--parent` is `invalid_target`, not `invalid_value`.** § 9's
    condition→code table pins it: the flag names an element that exists and is spelled
    correctly, so the defect is the target, not the value. `invalid_value` stays with
    `--status`, `--priority` and `--type`, where a literal fails validation; a
    `--parent` naming nothing at all stays `not_found`. The oracle accepted either
    code, so this was green while the spec was violated — worth recording as a case
    where the test suite was the weaker authority.
65. **`rm` and `archive` refuse while *any* `file:unreadable` element exists anywhere
    in the backlog**, not merely in the addressed subtree. A stub carries `parent: null`
    (decision 46) because it has no readable parent to carry — so it belongs to no
    subtree that can be computed, and a cascade would silently orphan it
    (`parent:dangling`) while an archive would silently split it (`archive:split`).
    Since the stub's real parent is exactly the unknowable part, "is it in this
    subtree?" has no answer, and a backlog-wide refusal is the only check that cannot
    be wrong. § 9 pins it, including for a single `rm`. Reads are untouched: `list`,
    `tree`, `show` and `doctor` keep working, which is what makes the stub findable.
66. **The refusal names every stub by ID and absolute path**, and the hint says to make
    the files readable or move them out of the backlog, then re-run `doctor`. A refusal
    an agent cannot act on would just relocate the dead end (§ 4's argument against
    silent failure).
67. **`changed_in_parallel`'s hint is caller-specific.** `set` and `note` point at
    `--force`; `archive` says "retry once the backlog is stable — archive takes no
    --force", because § 9 gives `archive` no `--force` and it is rejected there as
    `unknown_field`. Naming a flag the command refuses would be a hint that cannot be
    followed.

## Added while implementing the section-write path (§ 9, AC-20)

68. **A section write targets the *first* heading matching the role.** § 9 says the flag
    names the role and the heading written is the role's first configured name, but not
    which heading to overwrite when a body carries two that match. The first wins;
    a second one is left byte-for-byte alone and keeps counting for completeness
    (decision 12), so "several headings match one role" stays a read-side rule only.
69. **The region becomes the content plus one trailing empty line — one rule for both
    positions.** Mid-body that empty line is the blank separator before the next
    section; at the end of the body the same trailing element *is* the file's single
    closing newline. Writing it as one rule is what makes § 9's "followed by one blank
    line" and § 9's "the file ends with exactly one trailing newline" both true at once,
    and makes emptying a section return it exactly to its scaffold shape.
70. **With no H1, `description` is inserted after the body's leading blank line, not at
    index 0.** That blank line is structure, not content — § 9 pins "the frontmatter
    block is followed by exactly one blank line" — so "at the start of the body" cannot
    mean "before it". Inserting at index 0 would glue the heading to the closing `---`.
71. **Section flags are read and validated before `nj new` allocates an ID**, so a
    rejected invocation burns no tombstone (§ 8, decision 31). For the same reason all
    four flags are validated *before the first read*: a `-`-for-both-roles rejection
    must not have drained stdin already, which is what § 9's "nothing written" is worth
    in practice.
72. **An unreadable `--<role>-file` is `not_found`.** § 9 pins no code for it; the
    closed set's `not_found` covers "names nothing", which is the same failure the
    `--file` flag reports, and the vocabulary is closed so inventing one is barred.
73. **`nj new` lists a supplied role in `changed`; `nj set` lists it only when the bytes
    actually changed.** That mirrors the existing split — `new` reports what it wrote,
    `set` reports what differed (decision 17) — so `set --description=<identical text>`
    is `changed: []` and writes nothing, `updated` included.
74. **`set`'s human line prints `description=(body section)`.** The value can be many
    lines; echoing it into a one-line summary would be noise, and the ⚠ completeness
    hints below it already report whether the section now counts as present.

## Known gaps, stated plainly

- ~~Compare-before-write is not covered by my self-check.~~ **Closed.** § 12 now
  provides `NJ_FAULT=before-compare`; the guard is verified for both outcomes
  (refusal without `--force`, write-through with it) and for the 10 s timeout.
- **`.ids/` tombstones are created but never fsync'd** — now disclosed in § 12 as
  well. An `O_CREAT|O_EXCL` tombstone survives a process crash, not a machine crash.
- ~~**`nj archive` uses its own inline compare-before-write**, not `guardedWrite`, so
  it does not honour `NJ_FAULT=before-compare`.~~ **Closed.** § 12 now names `set`,
  `note` *and* `archive`. The compare and the marker wait moved into a shared
  `compareGuard`, which `guardedWrite` and `archive` both call; `archive` still writes
  to the new path and unlinks the old one, it just no longer duplicates the guard.
- **The `nj note` author is the element's `assignee`, else `?`** — § 10 as written;
  `NJ_AUTHOR` is listed under § 16 as round two.
