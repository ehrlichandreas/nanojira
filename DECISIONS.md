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

75. **The refactor step order, and why S4 never moves up.** The plan is option B
    plus S8, reviewed and approved by the verifier, with **no spec change**. The
    steps are: **S0** baseline harness (precondition — no step runs before it) ·
    **S1** `deriveGraph` into 8 passes · **S2** `deriveGraph` uses `childMap()`
    instead of its own children map (`nj:630-635`, a duplicate since round two) ·
    **S3** `loadElement` into 9 derivers · **S4** `doctorFix` into `fixCtx` plus 8
    step functions · **S5** extract `cmdNew` validation · **S6** extract `cmdSet`
    overrides · **S7** `JSON_MODE` into an `output` object · **S8** JSDoc and the
    header map.

    The order is **S0 → baseline recording → S6, S5 → S1 → S2 → S3 → S4 → S7 → S8**,
    and it is dependency, not taste. S6 and S5 are small and independent, so they
    prove the per-step gate cheaply before anything structural moves. **S4 is never
    pulled forward.** It is the largest hotspot and it met the weakest part of the
    oracle: seven sites accepted `[0, 2]` instead of § 14 s rule, and three defects
    landed in exactly those sites across three rounds. Those seven sites have since
    been pinned to a single § 14-derived value each and `T.exit` now refuses the
    array form outright — but S4 still runs after S1–S3, because its blast radius is
    largest and it should meet an oracle that three steps have already exercised.

    Per step, all of these must hold before the next one starts: `node --check`
    clean · replay against the S0 corpus reports zero diffs · the full oracle green
    (56 suites, 2239 checks as of `oracle-frozen`) · exit matrix unchanged ·
    performance within the 10k budget. A red step is **rolled back**, not patched — but
    **roll back to the last green step, not to the baseline.** The first version of
    this entry said `git checkout c1-baseline -- nj`; that is right only for the
    very first step. From S6 onward it would discard every green step already
    committed. The implementer hit exactly this during S5, where obeying the
    written rule would have thrown away a finished and verified S6. Take the commit
    of the last step that passed all five gates. A second limit of the same command:
    it restores `nj` only, so a step that also touched `tools/` or `test/` needs
    `git checkout <commit> -- .` instead.

    **Third limit, and it cost a near-miss.** `git checkout <ref> -- <path>` writes
    the **index** as well as the working tree. The recording procedure fetches the
    baseline `nj` that way, then restores the working tree from a saved diff — which
    touches the working tree only. The index is left holding the baseline. The git
    index is shared across every agent, so the next `git add` by anyone would have
    carried a `nj` that reverts S1 into a commit about something else. It was caught
    only because the implementer read `git status` before committing instead of
    committing blind. To fetch a version into the working tree use
    `git show <ref>:nj > nj`: same result, no index side effect. Reserve
    `git checkout <ref> -- <path>` for the rollback itself, where staging the
    restored file is what you want.

    **S3 says nine because someone counted.** The first version of this entry said
    eight, written while nobody had yet cut `loadElement` open. The natural seam
    yields nine; eight is reachable only by merging `deriveTitle` into `deriveBody`,
    and completeness has nothing to do with the title — that merge would be a number,
    not a reason. Treat the other counts in this list the same way: they are
    intentions from planning, and the measurement wins.

    Two constraints from that same map, because they are the kind that gets lost.
    Unlike `deriveGraph`, **the order of the derivers is load-bearing** — each reads
    `el.*` fields its predecessors wrote — and violating it does **not** crash: a
    `deriveParent` running before `deriveType` quietly yields `parent:orphaned`
    instead of `parent:hierarchy`. An order whose violation throws is harmless; one
    whose violation returns a different answer is a trap. And `el.assignee` is
    deliberately **not** normalised where `el.parent` is: a missing assignee becomes
    `''`, not `null`, and `cmdSet` relies on it to delete the field. Anyone tidying
    that inconsistency silently changes what `nj set --assignee=` does.

    Recorded here because until now this order lived only in `/tmp` and in a
    handover message. The one constraint most likely to be lost that way is the one
    that matters most: **S4 never moves up.**

76. **A change to the measuring device is harmless only once the header and the
    code agree again.** The refactor harness stores a digest of the oracle tree
    in its recorded header and recomputes it on every `verify`; a mismatch
    aborts with code 6 ("stale baseline, not an nj regression").

    That guard is correct, and it is also a trap for whoever edits the harness.
    Twice within twenty minutes the same mistake was made from both sides — once
    by the lead, once by the implementer. Both times someone touched something
    the guard watches and declared in the same breath that it would not matter:
    "that can be ignored", "makes no foreign run red". Neither had checked what
    code 6 actually does. It **aborts**. A verifier was mid-way through an hour
    of mutation probes at the time; every one of those runs would have died for
    a reason that had nothing to do with `nj`.

    The rule that came out of it, in the implementer's wording: while header and
    code disagree, the tree is poisoned **for everyone else**, no matter how
    small the diff looks. Either finish the change and re-record, or park it —
    but do not leave the two out of step and call it harmless.

    The deeper failure is not the mismatch, it is the reflex of relativising a
    guard that has just fired. A protection explained away once is no protection
    the next time, and the next time it may be firing for a real reason. Remove
    the trigger, do not soften the warning.

    Scope note: the digest deliberately covers what determines test *behaviour*
    (`ac/ edge/ fault/ stress/ lib/ golden/` plus `run-all.js`, the driver that
    decides what is collected and how results are classified), not prose. An
    earlier version spanned all of `test/`, so editing a documentation file
    raised a false stale-baseline alarm — the same class of harm as a flaky
    gate. The scope is named in the header so it stays auditable.

77. **The pass order in `deriveGraph` is free — and the condition that makes it
    free is the thing to write down, not the order.** After S1, `deriveGraph` is
    a list of ten passes. Three mutants that reorder or duplicate passes
    (`indexChildren` pulled ahead of the cycle pass, `markDuplicateIds` moved
    back, `markParentCycles` run twice) pass **both** safety nets: oracle 56/56
    and replay unchanged.

    That is not a hole. The reordering genuinely changes nothing observable, and
    the reason is measurable: **every access to `problems` inside the passes is
    an `.add`, never a read** — ten occurrences, ten writes, zero reads. No pass
    consumes what another produced. Sets are unordered and `elementProblems` is
    sorted on output, so the accumulated result cannot depend on the order in
    which it accumulated.

    **Ruled: do not pin the order.** A corpus pin on an order that demonstrably
    has no effect would be a pin on a non-property. It would go red at the first
    legitimate reordering while nothing is broken — the false-alarm failure this
    project has already paid for twice (the flaky mkdtemp gate, the over-broad
    test digest). Pin properties, not accidents.

    **Pin the condition instead**, as a constraint on future passes rather than a
    description of today: *no pass may read another pass's `problems` set.* The
    day one does, the order becomes load-bearing — and nothing currently in
    place would notice. That sentence belongs in the comment at `deriveGraph`,
    where the next person to add a pass will read it.

    **That condition was one of three, and this entry named only the first.**
    Measured later with a mutant that runs `attachGraph` before every mark pass
    (scenario 0/94, corpus 0/1878, oracle 62/62 — against a control mutant the
    same setup catches 88/94): the order is free only while **(1)** no pass reads
    another pass's `problems` set, **(2)** no pass writes an element field other
    than `problems`, and **(3)** no mark pass reads `el.byId` or `el.children`.
    Break any of the three and some position becomes load-bearing — and the
    corpus scenario `attach-second-derive` provably does not tell you. The
    implementer found the gap while correcting a comment in `fixtures.js` that
    promised a third fault form nobody had measured; the same three conditions
    now stand there, next to the scenario they bound.

    The two index builds are a separate case and need no protection: their
    dependants (`markOpenChildren`, `attachGraph`) read `children`, so moving a
    build after its reader yields `undefined` and the run **crashes**. The
    dependency is enforced by failure, not by convention, which is why pulling
    `indexChildren` forward was harmless.

    If the invariant should later become mechanical rather than conventional —
    the way `T.exit` now refuses arrays instead of merely discouraging them —
    the trigger is a first violation, or a pass count beyond what one comment
    can police. A white-box check that greps for reads would work, but it buys
    nothing while the count of violations is zero.

78. **"Red means roll back" is only true for exit 1. Every other non-zero code
    says the measurement did not happen.** Decision 75 fixed the per-step gate
    and the rule that a red step is rolled back rather than patched. That rule
    was written when the harness had one failure mode. It now has several, and
    the difference matters more than the colour:

    | Code | Meaning | What to do |
    |---|---|---|
    | 0 | behaviour unchanged | continue |
    | **1** | **behaviour changed** | **roll back to the last green step** |
    | 2 | invocation error | fix the call |
    | 4 | coverage gap — a probe contributed nothing | fix the probe, do not trust the run |
    | 5 | oracle red while recording | fix the oracle first |
    | 6 | stale baseline — tree digest ≠ header | re-record or revert the tree edit |
    | 7 | header and corpus do not belong together | re-record; says nothing about `nj` |

    Only **1** is a statement about the code under test. Codes 4, 6 and 7 are
    statements about the *instrument*, and rolling back a step because of them
    would discard good work for a reason that has nothing to do with it. That is
    not hypothetical: a verifier's control run against **unmodified** `nj` came
    back red — two runs had collided on a shared scratch path, and the diff was
    indistinguishable from a real regression. Whoever followed the rule as
    written would have thrown away a clean step.

    Hence the design principle the implementer applied when closing that hole:
    **a collision must never carry the form of a finding.** Where exclusion was
    possible it was taken (scratch root and raw corpus are now per-run unique);
    where two writers can still meet, the mismatch is *detected* and reported
    under its own code rather than prevented by a lock. A lock brings stale
    locks after a crash — the failure shape `nj`'s own § 12 rejects, and the
    tooling should not adopt what the tool forbids.

    **Granularity limit, measured after this entry was written.** Code 4 fires
    when a *corpus part* cannot run — a whole probe or suite. A mutation that
    breaks only some calls within a part still lands in code 1 with content
    diffs. The separation between "statement about the instrument" and
    "statement about the code under test" therefore works at part granularity,
    not per call. Do not read a code 1 as proof that the instrument was healthy
    for every call it made.

    Second-order note, because it was nearly the cost of the fix: per-run unique
    roots leave a garbage pile unless each mode removes its scratch at the end.
    `HARNESS_KEEP=1` preserves it for forensics. A fix that creates a new problem
    while solving the old one is not finished.

79. **The oracle is good at catching what is missing and blind to what is
    added — because its assertions test inclusion, not equality.** A systematic
    audit (20 single-part mutants × every suite, each mutant logging a hit only
    when it actually changed bytes) turned one earlier finding into a structural
    one.

    The earlier finding: a mutant that produced an extra, wrong WARNING slipped
    past `ac-11`, the suite that runs the very call. The audit shows `ac-11` was
    not special. **A spurious finding next to genuine findings is invisible to
    all nineteen suites that produce findings — nobody in the oracle covers it.**
    On a clean backlog five suites catch it, via `problems.length === 0`. The
    moment one real finding exists, an additional misclassification is invisible
    to the entire oracle.

    The cause is a shape of assertion, not a missing fixture:
    `found.includes(code)` asks whether something is present. Such a check
    cannot, by construction, see something extra. The same shape recurs
    throughout: `typeof x === 'number'` is true of the wrong number too; "the
    code is in the vocabulary" is true of the wrong valid code too. The contract
    suite `ac-13` checks the *form* of the JSON and not its *content*, and is
    therefore blind to `counts.incomplete`, `counts.errors`, `counts.total` and
    to an extra-but-valid code in `_problems`.

    Further parts that **no** suite covers: `counts.incomplete` (15 blind), the
    warning counter and the entry counter in `doctor`'s summary line, and
    `notes[]` in `doctor --fix --json`. And parts carried by exactly one suite:
    the write-feedback hint lines of AC-4 rest on `ac-04` alone, with 23 suites
    blind to them.

    **Remedy, one pattern for most of it:** assert set equality over
    `code:severity`, derived from § 7's Doctor column and the fixture, instead of
    membership; pin `doctor`'s summary line as the exact string § 14 prescribes;
    check `counts` as values rather than types.

    **The general lesson is worth more than the fix.** An assertion that asks
    "is the expected thing there?" passes a run that also produced something
    unexpected. For a refactor gate that is the wrong question: the contract is
    *exactly this and nothing else*. Where the spec fixes a set, assert the set.

80. **A freeze is something you confirm, not something you announce — and then
    you measure it.** Recording a baseline reads the whole oracle tree. If a file
    is saved while that read is in flight, the corpus captures a state that never
    existed as a whole, and the digest in its header describes a tree nobody can
    reproduce.

    This was learned the expensive way. The lead announced a twenty-minute hold
    on writes to `test/` and started the recording. Both writers had work already
    in flight; one read the message only after saving, and said so unprompted.
    The measurements afterwards:

        recorded digest   c1486f9e
        tree just after   27c9f9c9
        +20 s             7625f2ab
        +20 s             66891340

    The tree moved in bursts during and after the run. The recording was not
    wrong — 3317 calls, oracle 61/61 — it was merely **early**, and described a
    moment no one wanted to freeze. It had to be discarded and repeated.

    **The rule that follows has two halves, and the second is the one that was
    missing.** An announcement is not an agreement: messages cross, and an agent
    mid-edit has already written by the time it reads. So (a) collect an explicit
    acknowledgement from every writer that they have stopped, and only then
    (b) **measure quiescence yourself** — sample the digest twice, separated in
    time, and require both to match before recording. A confirmation says what
    an agent believes; the two samples say what the filesystem did.

    The same lead had spent the day insisting that reports be re-measured rather
    than believed, and then trusted his own announcement without measuring it.
    Saying a thing is so does not make it so, and that applies to one's own
    instructions first.

    Practical corollary: while any batch of oracle work is open, do not open a
    recording window for it piecemeal. **One window per batch, after the batch is
    closed** — otherwise the window chases a moving target and each attempt costs
    a full recording.

    **Third half, found after the above was written: measured is not durable.**
    The second attempt was confirmed by all seven writers and measured five times
    over seven minutes — and still froze the wrong thing. The digest `66891340`
    described the **working tree**. `HEAD:test/` was a different tree (`d696062c`,
    56 suites); the recorded one was HEAD plus five untracked suites plus
    uncommitted edits to thirteen files. A `git stash` by anyone would have flipped
    the digest and aborted every replay in the team with code 6, and nobody would
    have looked for the cause in a colleague's working tree. Worse, the corpus was
    reproducible from no commit at all, which means the reference point was not one.
    Found by a teammate preparing an unrelated measurement, not by any of the five
    samples — five correct measurements of the wrong thing. **Commit the tree and
    tag it before recording against it**; `oracle-frozen-2` is that tag for this
    corpus. Confirmed · measured · *recorded*.

    One more command trap, same family as the index one in entry 75 and caught by
    the same teammate two hours after that rule was issued — in a tag message
    written by the lead who issued it. `git checkout <ref> -- <dir>` stages the
    directory too, and `git show <ref>:<path> >` cannot restore a directory at all.
    The index-neutral form for a tree is
    `git restore --source=<ref> --worktree -- <dir>`; without `--staged` the index
    is untouched. Verified in a throwaway repo rather than assumed:

        git checkout HEAD~1 -- d                     worktree v1  index v1  staged [d/f]
        git restore --source=HEAD~1 --worktree -- d  worktree v1  index v2  staged []

81. **A right decision can rest on a wrong reason, and the wrong reason is the
    part that gets quoted later.** S2 carried a constraint: do not memoise
    `childMap` across `deriveGraph`'s five calls. The constraint is correct. The
    justification recorded in its commit message is not — and it took an
    independent round to notice, because nothing about the result looked wrong.

    The commit says memoising "would have broken `markOpenChildren` and
    `attachGraph` on the second graph — the class the corpus scenario
    `attach-second-derive` catches". Built as a two-line mutant, it breaks
    nothing: replay reports 0 diffs over 2806 compared calls, the oracle 61/61,
    and fourteen targeted differential probes (seven shapes × prose/json, each
    followed by `doctor --json` and `list --all --json`) are byte-identical.

    The verifier did the thing that makes this usable: before reporting a gap, he
    asked which of two categories it was — **(i) provably equivalent** or
    **(ii) observable but uncaught** — instead of concluding "the net has a hole"
    from a green replay. It is (i), and there are three independent structural
    reasons. `attachGraph`'s post-write output is read by nobody; both readers run
    on the first graph. `markOpenChildren` on graph two only touches the written
    element's `_problems`, and `cmdSet` cannot move an element: `SETTABLE_FIELDS`
    (`nj:27`) contains no `parent`. And `cmdRm` does not call `deriveGraph` after
    writing at all — the four post-write sites are `1371` new, `1402` set, `1547`
    note, `1814` archive.

    So: keep the constraint, and **replace** the justification rather than dropping
    it — the verifier's third option, and better than the two I offered him. A rule
    with no reason gets deleted by the next person who looks for one. The reason
    that holds is narrower and states its own expiry:

    > The memo would be harmless **today, and only because round one has no verb
    > that moves parentage.** `set` takes no `--parent` (`SETTABLE_FIELDS`,
    > `nj:27`), `doctor --fix` never touches `parent` (§ 14 forbids inventing
    > parents outright), `rm` does not re-derive after writing, and `archive`
    > cannot differ because archiving presupposes the whole subtree is `done`.
    > These are **properties of round one, not guarantees of the spec.** The moment
    > a verb can move an element — a `set --parent`, an `unarchive`, a re-parenting
    > in `--fix` — the memo becomes a real bug, and **no net reports it.**

    That also answers the cost question: **do not build a fixture.** None can be
    written today, because no command can produce the triggering state. Hang the
    trigger on the rule instead, so the step that introduces `--parent` must bring
    the fixture with it.

    And what `attach-second-derive` *does* catch, so nobody writes it off: "a pass
    computes and does not write back" (oracle 53/56 red) and "the second call works
    on copies" (oracle green, replay red — the valuable one). Three different
    faults; the constraint cited the wrong one. Anyone who later says "the corpus
    covers this" is citing a scenario that does not measure what they think it
    measures. That is the same failure as a header
    comment claiming the spec leaves something open when § 9 decides it, or a
    backlog note naming a superseded digest method: **documentation that is wrong
    about itself while the code is right.** It is worse than a wrong result,
    because it survives every test.

    Stated limit, his: absence of a difference is weaker evidence than its
    demonstration. Seven shapes are not a proof. If someone finds a shape where a
    parent-child relation moves across a write *and* is reported, this verdict
    flips.

82. **The step order in 75 is replaced: the module split comes first, and the
    reason is the user's, not a technical one.** After S1 and S2, `nj` had grown
    from 2094 to 2210 lines and was still one file. The user asked three times
    for the split along `main()`'s `switch`. 75 had put it last, behind two
    preconditions — "no function over 40 lines" and "S7 first". Neither holds:
    moving a 181-line `doctorFix` into its own module changes nothing about it,
    and decomposing it there is easier than in a 2200-line file. `JSON_MODE`, the
    only mutable top-level binding, became an `output` object as part of the
    split. S7 is therefore done and drops out.

    New order, each step behind the previous one:

        TSK-015 A  shared code to lib/, JSON_MODE -> output   done, 342aa89
        TSK-015 B  commands to lib/cmd-*.js, nj a thin entry
        TSK-019    zero-dependency bundler -> dist/nj, package.json without
                   dependencies (bin, test, build); replay against dist/nj too
        S3         loadElement into 9 derivers, inside lib/load.js
        TSK-017    test block before S4 -- lands in ONE batch, then re-record
                   and tag oracle-frozen-4
        S4         doctorFix into fixCtx + step functions -- still never earlier
        S8         JSDoc, module map, architecture note
        TSK-013    final gate
        after      TSK-018 (EPIPE) and any move to ESM/.mjs: both change
                   behaviour or its surface and do not belong inside a
                   behaviour-preserving refactor

    Unchanged: the five gates per step, author ≠ verifier before the next step
    is released, red means roll back to the last green commit. The bundle adds
    one gate from TSK-019 on: the replay must also be 0 diffs against `dist/nj`,
    because that is what ships. A faulty build tool is worse than a faulty meter
    -- its error goes into the product -- so the bundler gets its own
    verification round.

    Test work is batched: every change under `test/` forces a re-record, so
    oracle work for S4 is prepared outside `test/` and lands once.

    The order lives in the backlog as `depends_on`, so `nj list --ready` names
    the next step. That is the authoritative plan; this entry records why.

83. **"Dependencies: none" meant no external services — we read it as no
    libraries, and tightened it further on that misreading.** The user, who
    wrote the requirement in the brainstorming phase, clarified: NanoJira must
    not depend on Jira or any other external service. It never meant "no npm
    packages". The team read § 3 literally, built its own bundler, test harness
    and parsers, and on the day of the bundle step even added "at run time
    **and** at build time" to § 3. That addition is withdrawn.

    What stands: the shipped `dist/nj` is one self-contained file that runs on
    the portable Node without `node_modules` and without network. What changes:
    development tools may be `devDependencies`. The user chose TypeScript,
    introduced gradually, and esbuild in place of `tools/build.js`.

    Order after S3, each behind the previous one:

        TSK-017  test block, now also: § 3 corrected to "no external
                 services", AC-15 asserting that dist/nj runs without
                 node_modules instead of forbidding node_modules in the
                 project -- must land BEFORE any npm install, or the first
                 install turns the oracle red. Re-record, oracle-frozen-4.
        TSK-021  toolchain: esbuild replaces tools/build.js, tsc type-checks
                 (checkJs, noEmit); replay 0 diffs against the new dist/nj
        TSK-022  JSDoc types until tsc is clean -- replaces TSK-010
        TSK-023  modules to .ts, one by one; the instruments that read
                 source text (verify.js SEVERITY, codeSha, the blindness
                 matrix) follow in the same step, as they had to for the split
        S4       with compiler help across every seam

    Runtime libraries stay out of `nj` itself: its output is pinned byte for
    byte by the spec and the corpus, and a YAML or argument-parsing library
    would accept or print differently. That is a behaviour change, not a
    simplification.

84. **Endgate passed — the refactor is complete, measured against where it
    started.** Independent run by the verifier on HEAD `2ca5c9f`, reference
    point `oracle-frozen-5` (corpus 3452 calls recorded against baseline
    `c866d2b2`, test digest `28d4dbdb`).

        behaviour  replay 0 diffs / 2941 compared, against nj AND dist/nj;
                   exit codes are a compared field, so all 2941 match c1-baseline
                   oracle 62/62, 2544 checks, against both
        artefact   build:check byte-identical; dist/nj alone in an empty
                   directory, no node_modules, network blocked: exit 0, stderr 0
        types      tsc strict 0 errors; four counter-probes are compile errors:
                   cross-module call (TS2554), parent = '' (TS2322),
                   deriver order (TS2345), doctorFix step order (TS2345)
        perf § 13  dist/nj, quiet machine, 10k: list 206/208, list --json
                   206/208, tree 216/222, doctor 215/216 ms (median/max)

    From one 2094-line file to a 64-line entry, 22 TypeScript modules and one
    shipped `dist/nj`; `loadElement` 110 → 31 lines, `doctorFix` 152 → 31, with
    the order of both enforced by the compiler instead of by comments.

    Not proven, stated so: **linux-x64 never ran** (SUB-001, no way to execute
    that binary on darwin-arm64); "without network" is shown only indirectly;
    the blindness matrix has a true regression comparison for 3 of its
    mutants — for the other 17 the endgate run is the first full baseline,
    kept as `scoping/artifacts/matrix-28d4dbdb-6bcd1056.json` so the next
    change has something to compare against.

    Recorded one commit late: `78930cf` carries this entry's title but was
    committed while the edit adding it had been blocked — a commit message
    describing something that was not in the commit. Caught by checking the
    commit's contents instead of its message.

85. **The corpus reference moves after the first intended behaviour change —
    to the last accepted revision, never to the tree under test.** Until DECISIONS
    84 the corpus answered one question: does the refactored `nj` behave exactly
    like `c1-baseline`? TSK-018 is the first change that is *supposed* to differ:
    `nj list | head -1` no longer crashes with a stack trace. Its suite
    `stdout-epipe.js` deliberately proves `c1-baseline` wrong, so recording
    against `c1-baseline` now aborts — the harness refuses to record from a red
    revision, correctly.

    Two ways out were rejected. Leaving the suite out of the recording would make
    a red run look green, the one thing the instrument exists to prevent.
    Recording against the working tree would make the corpus prove only that `nj`
    equals itself.

    **Rule:** after a behaviour change has passed its own gate and an independent
    round, that revision becomes the new recording source, under its own tag.
    `c2-baseline` = `5ea3701` (EPIPE fix, verified by Verifier II). `c1-baseline`
    stays as the historical reference: DECISIONS 84 proves the refactor
    equivalent to it, and that proof does not move.

    **The source is `dist/nj`, not `nj`.** Since the split, the entry `nj` is 64
    lines that load `lib/`; its hash does not identify the code. `dist/nj` is one
    file that contains everything and is what ships, so its hash in the header
    names exactly what was recorded. Record with `--nj=` pointing at a copy of
    `c2-baseline:dist/nj` — the working tree is never swapped.

    **`stdout-epipe.js` is verdict-only**, like the preload-instrumented suites:
    how much output reaches the pipe before the reader closes depends on timing,
    so its calls cannot be byte-recorded. Its verdict still gates.

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
