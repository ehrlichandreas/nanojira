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

    **Addendum, 2026-09-23 — confirmed by the user: nj's own code stays ours,
    completely.** Asked whether parts should move to libraries, the lead checked
    the best candidate, `node:util.parseArgs` for `src/core/args.ts`: the
    replaceable loop is 15 lines, the other ~90 are spec-pinned validation and
    messages (`unknown_field`, `missing_value`, "Nothing written.") no library
    provides, and `util.parseArgs` reads `--` differently (everything after it is
    positional; ours skips it and keeps parsing flags). No gain, a behaviour risk.
    The user decided: no runtime libraries in `nj`. Build tooling (TypeScript,
    esbuild) is unaffected.

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

86. **Specification v3: backlog location and layout become configurable —
    written down, not implemented.** Requested by the user on 2026-09-24: the
    backlog path settable by parameter, environment variable or a config file
    "like .bashrc", a better-structured and configurable folder layout, and
    defaults for all of it. The user decided in two rounds of questions:

        location   --backlog > NJ_BACKLOG > upward search, where each
                   directory offers .njrc first, then backlog/ -- a project
                   file ./.njrc searched upward, not ~/.njrc
        grouping   configurable: type (default) | hierarchy | flat, plus
                   configurable folder names
        status     not as folders: a generated overview file, STATUS.md
        internals  moved into one hidden folder .nanojira/

    Then: "schreibe einfach alle md files passend runter" — no token budget
    left for implementation. v3 therefore exists as text only;
    `dist/nj` still implements v2, and the spec header says so.

    **Decided by the lead, open to the user's veto:**

    - *Nearest wins* in the upward search, `.njrc` before `backlog/` within a
      directory — the way git finds `.git`; a repository-root `.njrc` never
      overrides a project's own deeper `backlog/`.
    - *A chosen source is binding.* A `--backlog`, `NJ_BACKLOG` or `.njrc`
      that points at nothing is a hard error naming the source, never a fall
      through — the § 4 rule against silently reading the wrong backlog,
      applied to the new sources.
    - *`.njrc` is strict* (unknown key, missing `=`, repeated key → exit 1),
      for the same reason unknown flags are.
    - *The frontmatter stays the truth under every grouping;* the location is
      derived. `nj` has no `--parent`, so under `hierarchy` files move only
      through `archive`, `doctor --fix` or by hand. Changing the grouping and
      migrating a v2 backlog are the same operation: `doctor` reports the
      old places, `doctor --fix` moves.
    - *Elements are found wherever they lie* (every `*.md` below the backlog
      except `README.md`, `STATUS.md`, `.nanojira/`). Needed so a layout
      change never breaks the commands between editing the config and
      running `--fix`. Consequence, accepted: a stray `*.md` anywhere in the
      backlog is now read as an element and reported, where v2 read only the
      type folders.
    - *`STATUS.md` is committed*, so a forge shows it; it can therefore
      conflict in merges and go stale in races. Tolerated and surfaced
      (`backlog:status_stale`, warning), repaired by `doctor --fix`; a failed
      overview never fails the write. It costs one full scan per write.
    - *The additive-only rule of § 7 holds:* `type:folder` keeps its exact
      meaning for group `type`; the other groupings get the new code
      `layout:misplaced` instead of a renamed one. New failure codes:
      `invalid_backlog_flag`, `invalid_backlog_njrc`, `invalid_njrc`,
      `legacy_layout`.
    - *Legacy backlogs are refused, not read.* Reading both layouts forever
      would double every path in the code; one `doctor --fix` migrates.

    **Implementation order, each step behind the previous one** — ordered so
    the corpus replay keeps proving "nothing else changed" as long as
    possible:

        V3-1  location sources (--backlog, .njrc, binding errors, init)
              purely additive: replay 0 diffs + new AC-21 suite
        V3-2  layout block: folder names, groups hierarchy/flat, recursive
              element scan, layout:misplaced, doctor --fix moves
              default "type" is v2 behaviour: replay 0 diffs + AC-22 --
              except calls where the corpus has a *.md outside the type
              folders; each such diff must be exactly that, and is named
        V3-3  STATUS.md -- intended behaviour change: AC-23, new golden,
              re-record under a new c-baseline (DECISIONS 85)
        V3-4  .nanojira/ + legacy migration -- intended, breaks v2 paths:
              AC-24; ~20 test files name .nanojira.json or .ids/ and must
              follow in one test batch; re-record, new c-baseline; our own
              backlog/ is migrated with the released doctor --fix

    Each step: tests first, written from the spec by someone other than the
    implementer; author ≠ verifier; the gate of DECISIONS 84 plus perf. The
    user approves v3 before V3-1 starts.

87. **v3 is released for implementation — by the lead, on the user's
    mandate, open to the user's veto.** On 2026-09-28 the user handed the
    project to a team lead with "Verbessere nanojira soweit es geht" and
    permission to staff the team. DECISIONS 86 requires the user's approval
    of v3 before V3-1; the lead reads that mandate as the approval and says
    so here rather than letting it pass silently. The spec text is unchanged
    by this entry. Roles per 86: an oracle author writes AC-21..24 from the
    spec only, a separate implementer builds V3-1..4, a third agent verifies
    each step; author ≠ implementer ≠ verifier.

88. **V3-1 readings of § 4, settled by the lead before the suite and the
    code meet.** Raised by the implementer on 2026-09-28:

    - *"Holds a backlog" in V3-1 means `.nanojira.json` exists.* v3 says
      `.nanojira/config.json`, which only arrives with V3-4; until then the
      v2 file is the marker. A `--backlog`, `NJ_BACKLOG` or `.njrc` target
      that is not a directory, or a directory without the marker, is
      `invalid_backlog_{flag,env,njrc}`. `backlog_without_config` stays for a
      `backlog/` reached by the search (and, from V3-4, a `.nanojira/`
      without `config.json`). `doctor`, lenient as before, accepts any
      existing directory from any source.
    - *All three binding errors use one form*, § 4's
      `no backlog at <abs> (from <source>)`, and one code each — including
      `NJ_BACKLOG` naming a non-directory, which v2 reported in its own
      words. Consistency with the normative table wins over "0 diffs": the
      replay diffs this causes are intended, and must be exactly those calls.
      § 9's reserved list no longer names `invalid_backlog_env`, which the
      table pins — the two contradicted each other.
    - *The prefix stays the implementation's `Error: `.* § 4's `nj: ` lines
      are illustrative of the message, not of the prefix.
    - *Nearest wins strictly:* the nearest `backlog/` ends the search even
      without a config and yields `backlog_without_config`; v2 skipped it and
      kept climbing. That is what § 4 says; any replay diff must be exactly
      a nested config-less `backlog/`.
    - *`--backlog` is listed in every "Known flags:" line*, because § 9 says it
      appears in every command's list of known flags; the "Known fields:"
      line of `set`/`new` lists schema fields only and stays unchanged. The
      replay diffs are that one class (~13 `unknown_field` calls), named.
    - *`nj help` gains one `--backlog` line*, from § 9's command list — a
      fourth named replay diff class (`help`, `help --json`, `--help`).

89. **AC-21 ambiguities 50–53, 55 ruled by the lead** (test/AMBIGUITIES.md):

    - *50* A repeated `.njrc` key reports the line of the repetition.
    - *51* An empty key (` = x`) is an unknown key.
    - *52* `init` reads § 4 literally: it consults `--backlog`, `NJ_BACKLOG`
      and the nearest `.njrc`, and never looks at `backlog/` folders — also
      not at a nearer one between the working directory and that `.njrc`.
      "The upward search for an existing `backlog/` is not used by `init`"
      is the whole rule; bending it for one case would make `init`'s target
      depend on unrelated folders.
    - *53* `--backlog=` with an empty value is `missing_value`, like a bare
      `--backlog`. `NJ_BACKLOG=` (empty) counts as unset — v2 behaviour,
      kept. `~/` is expanded only inside `.njrc`; `--backlog` and
      `NJ_BACKLOG` are literal (the shell expands `~` before `nj` sees it).
    - *55* An existing empty directory is "anything exists": `init` refuses
      with `exists` — v2 behaviour, kept.

90. **Pre-flight findings ruled by the lead** (docs/verification/v3-preflight.md,
    Verifier, 2026-09-28):

    - *Gate procedure for a step that adds a suite (B1).* The recorded
      corpus pins the test digest, and a new suite makes the recording
      source red, so neither "verify against HEAD test/" nor "re-record
      against c2" can run. Procedure: in a throwaway worktree at the step's
      commit, `git checkout <last oracle-frozen tag> -- test/`, replay
      with `--nj=<step's dist/nj>`; run HEAD's `test/` separately with
      `run-all.js`. After acceptance the step becomes the next c-baseline
      and is recorded with the new `test/` under a new `oracle-frozen` tag.
    - *The harness must gate on verdicts (B2).* `verify` exiting 0 with a red
      oracle suite, and `scratch/verify.js` always exiting 0, turn the
      instrument into something that has to be read by hand. Fixed as
      tooling work, separate from product and suite. `scratch/verify.js`'s
      pin "NJ_BACKLOG at a config-less dir → backlog_without_config" follows
      DECISIONS 88: it is `invalid_backlog_env` now, a fifth named change
      with 0 corpus calls.
    - *Closed-vocabulary suites (B3)* gain the v3 codes with the V3-4 test
      batch, or earlier if a step emits them from a path those suites probe.
    - *`.njrc` lexing and odd files* — pinned in § 4: BOM dropped, CRLF
      tolerated, split at the first `=`, keys case-sensitive, `#` only as
      whole-line comment; a `.njrc` that is not a readable regular file is
      `invalid_njrc` without a line number; a symlinked `.njrc` resolves
      against the link's directory; `~/.njrc` is an ordinary ancestor.
    - *`init` → `exists`* added to § 9's table; AC-21's binding-error clause
      excepts `init`.
    - *Hierarchy archive dead end.* Archiving a child first creates
      `archive/EPIC-001/` as an empty ancestor; the epic's own one-rename
      archive would then hit `exists` forever. Ruled: such an ancestor folder
      is a merge target, not an occupied path — the subtree's entries move
      in one `rename` each, the emptied source is removed; only an element
      file, or a folder holding one, occupies a target. The loss of the
      single-rename atomicity in this one case is disclosed in § 12
      (`archive:split` after a crash, reported by `doctor`).
    - *Perf is not gateable today.* The machine runs on battery in Low Power
      Mode; even the build DECISIONS 84 measured at 206 ms now takes ~390 ms.
      Until a quiet run on mains power, the perf gate is an interleaved A/B
      against the previous accepted `dist/nj`: "no regression". The absolute
      § 13 numbers are re-measured once, before EPIC-006 closes.

91. **V3-2 pre-flight points B11–B17 ruled by the lead**
    (docs/verification/v3-preflight.md):

    - *B11 Scan bounds.* The element scan never follows a directory
      symlink and never descends into a directory whose name starts with
      `.` (this covers `.nanojira/`, `.git`, `.obsidian`). A symlinked
      *file* is read like a file. The suffix `.md` is case-sensitive.
      `node_modules` has no special role.
    - *B12* The `README.md`/`STATUS.md` exclusions hold at the backlog's top
      level only; a `README.md` anywhere deeper is an element file and is
      reported.
    - *B13* `backlog` is forbidden as a `layout.folders` value
      (case-insensitively): it would capture discovery from inside the
      backlog. `invalid_config`.
    - *B14* "Pairwise distinct" and the "not shaped like an ID" check on
      folder names compare case-insensitively: APFS and NTFS are
      case-insensitive by default.
    - *B15* Under `hierarchy` a task or subtask without `parent` has a
      computable place — the top of the tree (`<backlog>/TSK-n/TSK-n.md`,
      `<backlog>/SUB-n.md`) — and is judged like any other element. An
      element whose place cannot be computed (`parent:dangling`,
      `parent:cycle`, or an ancestor with either) gets **no** layout code
      and is never moved; its own error already reports it. So
      `parent:orphaned` stays a non-blocking warning.
    - *B16 Archive order under `hierarchy`* is the v2 order: every file's
      `archived:`/`updated` is written in place first (guarded, as today),
      then the move — one `rename`, or the merge `rename`s of DECISIONS 90.
      `NJ_FAULT=before-rename` fires before the first `rename`. A crash in
      between leaves exactly the state a v2 crash leaves; no new code.
    - *B17* The typed deriver chain and the `FixCtx` step chain grow with
      V3-2; the four D84 counter-probes are re-run after it and must still
      be compile errors.

92. **V3-2 questions Q1–Q4 of the implementer, ruled by the lead:**

    - *Q1* `init` keeps writing the v2 `.nanojira.json` byte-identical in
      V3-2; the full `layout` block is written from V3-4, when the config
      moves. A config without `layout` is the defaults (§ 5).
      `layout.statusFile` is validated from V3-2, effective from V3-3.
    - *Q2 Renaming the archive folder.* Archived-ness stays location-based
      (§ 4). `archived:` in the frontmatter decides only the **target** of a
      move, never by itself that a file is misplaced: a file that is
      already misplaced (e.g. below the old archive folder after a rename)
      and carries `archived:` belongs below the archive folder, and
      `--fix` moves it there; without `archived:` it belongs to its active
      place. A file lying at a valid active place with a hand-written
      `archived:` gets no finding — v2 behaviour. So `doctor --fix` never
      un-archives an element and never archives one.
    - *Q3* As DECISIONS 91 B11/B12.
    - *Q4 Archive precondition under `hierarchy`.* An epic or task moves as
      its folder, a subtask as its file. The element must lie in its own
      folder with its whole subtree inside it and no foreign element file in
      it; otherwise `archive` refuses, moves nothing, and points at
      `nj doctor --fix`: new code `refused:misplaced` (additive, § 9). The
      merge rule of DECISIONS 90 applies to the target.
    - *Minor, accepted as proposed:* an unresolvable chain gets no layout
      code (as 91 B15); `type:folder` for an undeterminable type stays in
      every group; `--fix` step 3 removes emptied hierarchy folders (names of
      ID shape only) with `rmdir`, never recursively.

93. **V3-1 accepted; its verification findings ruled** (docs/verification/v3-1.md,
    Verifier, commit d55db2d). Verdict *pass with findings*: every number
    reproduced, the 19 replay diffs are exactly classes (a) (b) (d), and
    `scratch/verify.js`'s one extra ✗ is class (e) of DECISIONS 90. Perf:
    no regression against v2 in an interleaved A/B; absolute gate pending
    (DECISIONS 90). **c3-baseline = `1e85263`** (V3-1 plus its D90 follow-up,
    whose dangling-symlink fix the Verifier confirmed as F2).

    - *F1 A planted `.njrc` steers other users* (`/tmp/.njrc` with
      `backlog = ~/x` makes a victim's `nj init` create a backlog in their
      HOME). Ruled: a reached `.njrc` must be owned by the current user or
      root, else `invalid_njrc` — hard, like every other `.njrc` fault (§ 4).
      A planted `backlog/` folder is not covered: it can only steer reads
      and writes into the planter's own folder, as in v2.
    - *F3 `doctor --fix` on a non-backlog* (`--backlog=.` one level too high)
      wrote tombstones into a project directory. Ruled: `--fix` writes
      nothing while `config:invalid` holds (§ 14).
    - *F4 Stack traces on filesystem failures* (`init` into a read-only or
      non-directory parent, deleted cwd). Ruled: new failure code
      `io_error` (additive), one line naming the path and the OS reason,
      never a stack.
    - *F9 An unreadable folder is silently skipped* (`chmod 000 tasks/` →
      `list` succeeds, `doctor` clean). Ruled: new backlog-level problem
      code `backlog:unreadable_dir`, error — with V3-2, which rewrites the
      scan anyway.
    - *F6* (a repeated flag: the last wins) and *F7* (a relative `--backlog`
      resolves against the physical cwd) are v2 behaviour, kept, not pinned.

94. **The hierarchy archive merge is recursive** (implementer, accepted).
    DECISIONS 90 read literally still dead-ends one level down: archive
    SUB-007 → `archive/EPIC-001/TSK-003/SUB-007.md`; archiving TSK-003 then
    finds its target folder holding an element file. The merge descends:
    existing folders are merged into, only a file at a file's target path
    (or a file/folder mismatch) is a conflict, all targets are verified
    before the first move, nothing is ever overwritten. `--fix` step 3 uses
    the same planner. § 11 updated.

95. **V3-3/V3-4 pre-flight points B18–B23 ruled by the lead:**

    - *B18 `STATUS.md` for problem elements* — pinned in § 4: listed under
      the status `list` shows (derived `statuses[0]` for `missing:status`;
      `?` for an unreadable stub); no title → `- [ID](path)`; both
      `duplicate_id` files, by path; no escaping needed (the link text is the
      ID).
    - *B19* A failed overview leaves the `--json` result unchanged (stderr
      warning only); `doctor --fix` keeps the exit code of its findings.
    - *B20* Write commands get a perf measurement with V3-3 (TSK-027 already
      requires it); the Toolsmith adds it to `tools/perf.js`.
    - *B21* The ambiguous step 0 (v2 and v3 places both present) moves
      nothing, and by § 14's DECISIONS 93 rule no later step writes either;
      `backlog:legacy_layout` stays an error, exit 2.
    - *B22* § 8 now writes `ids/` for `.nanojira/ids/`; `.ids/` always means
      the legacy folder.
    - *B23* § 12 says three injection points, as it lists.

96. **V3-1 delta `1e85263` verified** (docs/verification/v3-1.md, 893caba):
    pass with findings; replay identical to `d517837`'s 19 named diffs; the
    FIFO `.njrc` that hung `d517837` is refused (F10). The remaining nits go
    to TSK-029: a self-linking `.njrc` (ELOOP) is reported with its own
    reason, not as "dangling"; a BOM counts only at the very start; a lone
    `\r` is `invalid_njrc` (§ 4 amended); an unsearchable ancestor of the
    cwd is `io_error` (F4 class). AC-21 covers the D90 cases since `62be2a6`
    (the Oracle, 499 checks); TSK-029's suite adds only the D96 nits.

97. **AC-22 ambiguities 56, 60–62 ruled by the lead:**

    - *56* `layout.folders` may hold any subset of its four keys; a missing
      key is its default, and distinctness is checked on the effective
      names. "Exactly the four keys" in § 5 meant "no other keys" — reworded.
    - *60* `doctor --fix` step 3 creates missing target folders (§ 14).
    - *61* "Every element reports its old place" means every element whose
      place changes; an element already where the new layout puts it
      carries no code.
    - *62* `set`/`note` write a misplaced file where it lies, in every
      group; only `archive`, `doctor --fix` and the user move files.
    - Step 3's "target not free" is testable without a duplicate id: a
      directory, or a non-`.md` file, at the target path.

98. **Hardening ambiguities 63–66 ruled** (Oracle-B, test/AMBIGUITIES.md):
    *63* a symlinked `.njrc` passes only if link **and** target are owned by
    the user or root — the planter may control either. *65* ownership is
    checked first, before the file is read; a foreign file is never parsed.
    *64* and *66*: the suite's readings are accepted as written (deleted cwd:
    one line, `io_error`, path not required; `ENOTDIR`: the line names the
    failing component or the target). § 4 amended for 63/65.
    *67* A lone `\r` as the file's last byte is invalid too — it is not
    followed by `\n`. *68* Its line number is the line holding the `\r`,
    lines counted by `\n`.
    *F3 and notes:* `--fix` on an invalid configuration adds **no** note;
    `config:invalid` already says why nothing was written, and
    `edge/exit-doctor-fix.js` pins `notes[]` empty — that contract holds.

99. **The `STATUS.md` warning reads `Warning: STATUS.md not updated
    (<reason>)`, on stderr** — the stderr counterpart of DECISIONS 88's
    `Error: ` prefix; § 4 now spells it so. The existing `⚠` hints on
    stdout (rm dependents, incompleteness) are write feedback, a different
    channel, and stay as they are.

100. **V3-3 test batch and `STATUS.md` edge rules, ruled by the lead** (the
     Oracle's AC-23 impact list, 4956aea):

     - *Batch strategy.* The shared harness gets one renderer, and
       `H.mkBacklog` writes a fresh `STATUS.md` into every hand-built
       fixture; whole-backlog snapshots leave `STATUS.md` out of the
       compared set only where the suite is about something else. Since
       v2 and V3-2 never read a top-level `STATUS.md`, the batch is neutral
       for them and lands **before** V3-3, so V3-3 meets an adapted suite.
     - *No overview check while `config:invalid` holds* — without a valid
       status list there is nothing to render; `--fix` writes nothing then
       (DECISIONS 93), `STATUS.md` included.
     - *`doctor --fix` reports the regeneration in `fixed[]` exactly when
       step 9 changes the file's bytes* — missing, stale before `--fix`, or
       made stale by an earlier step's move or rename. `fixed[]` lists what
       `--fix` wrote; a regeneration that changes nothing is not a repair
       and leaves the file untouched (§ 14).
     - *Concurrency.* A racing writer may leave `STATUS.md` one write behind
       (§ 4); after the AC-7 run `doctor` must have no **error** finding, and
       `backlog:status_stale` is the one tolerated warning.
     - *70* An unknown `priority` value sorts with the weight of the default
       priority — measured v2 behaviour, kept; the same order applies in
       `STATUS.md`.
     - The closed code table of `ac-13` gains every v3 code
       (`layout:misplaced`, `backlog:unreadable_dir`,
       `backlog:legacy_layout`, `backlog:status_stale`).
     - Shared `.md` files under `test/` are committed right after each edit;
       two authors never leave uncommitted edits in the same file.

101. **AC-24 ambiguities 71–74 ruled** (Oracle-B, a57f98f):
     *71* a v2 backlog reached through any source — search, `--backlog`,
     `NJ_BACKLOG`, `.njrc` — is `legacy_layout`: the backlog is there, only
     old. *72* `init` at a v2 backlog is `exists`, like any occupied target.
     *73* an empty `.nanojira/` is not "both present"; the ambiguity needs a
     v3 configuration or v3 tombstones. *74* an absent `.gitignore` is
     "otherwise": not created, a note says so; `doctor` on a legacy backlog
     runs every other check against the v2 places. The verbatim-line match
     ignores a trailing `\r`, and the replacement keeps the line's ending.

102. **The backlog README and placement under an invalid config** (the
     Oracle, while writing docs/GUIDE.md and docs/MIGRATION-v3.md, abd9b35):

     - *README.md written by `init`* is not spec-pinned, but the corpus
       hashes it. Its text changes to the v3 wording with V3-4, as one named
       replay class of V3-4's re-record. The spec keeps pinning facts, not
       bytes. § 14 step 0 replaces a migrated backlog's `README.md` only when
       it is byte-identical to the v2 `init` text; otherwise it is left alone
       with a note. The draft text is in docs/MIGRATION-v3.md's appendix.
     - *No placement judgement while `config:invalid` holds.* With a
       forbidden folder name, `doctor` reported `config:invalid` *and* a
       `type:folder` for every file, judged against the default folders —
       noise that points at the wrong repair. Suppressed, like
       `backlog:status_stale` in DECISIONS 100 (§ 5 amended). A V3-2
       follow-up, tested before the fix.

103. **`STATUS.md` refresh: a full scan, not a full re-read** (implementer,
     V3-3). Measured on 10k files in Low Power Mode: readdir 18 ms, stat 30
     ms, reading every file 245 ms; the literal re-read made every write
     +70 % (new 441 → 712 ms). Ruled: after a write, the overview is rendered
     from a scan that lists every folder and stats every file, and re-reads
     only files whose `ctime` is newer than the command's load start minus
     2 s; every other file reuses the element the command already loaded.
     `ctime` cannot be set by `utimes` and is bumped by every write, rename
     and racing writer, so the result equals a full re-read — racing writers'
     changes are still picked up — at about one-sixth of the cost. It stays
     "one full scan per write" in the sense of § 4. The write cost is
     measured and written into § 13 with V3-3; the A/B gate for V3-3 is
     reads-only (`--gate=reads`), writes are reported.

104. **v3.1 proposal ambiguities 75–81 ruled** (Oracle-B, AC-25/AC-26 at
     625b373; to be folded into docs/proposals/v3.1.md):

     - *75 Unarchive after a layout change: the current layout wins.* The
       subtree is gathered from the archive by its `id`/`parent` chain,
       wherever its files lie there, and placed by the current layout. The
       archive's shape only decides whether one folder `rename` is possible;
       otherwise files move one by one. `refused:misplaced` is kept for a
       foreign element inside the subtree's archived folder (moving the folder
       would carry it). *Amended (82):* a member of the subtree lying
       outside the archive (the `archive:split` state) is no refusal in any
       group — § 11a leaves non-archived descendants untouched, and
       unarchiving the parent heals the split; under `hierarchy` the parent's
       folder merges into the existing active one (DECISIONS 90/94).
     - *76 `NJ_AUTHOR` whitespace:* only spaces and tabs are trimmed (as in
       TSK-029's `.njrc` trim); any `\n` or `\r` left, trailing included, is
       multi-line → `invalid_env`. Unicode spaces are literal.
     - *77 Precedence:* argument parsing (`unknown_field`, `missing_argument`,
       `missing_value`) → the acting name (`invalid_env` / `invalid_value`)
       → target resolution (`not_found`, `duplicate_id`) → refusals.
     - *78 `before-compare` on a multi-file unarchive* fires once per file
       write, in top-down order. On abort, the earlier files carry their
       in-place write and nothing has moved — the crashed-unarchive state of
       U6, completed by a second `unarchive`.
     - *79* Result `ids` are top-down in pre-order (depth-first, as `tree`
       prints: EPIC-001, TSK-001, SUB-001, TSK-002); siblings by id
       ascending (83).
     - *80* `refused:misplaced` for an unresolvable chain applies under
       `hierarchy` only; under `type`/`flat` placement does not depend on the
       chain.
     - *81 Refusal precedence:* `refused:unreadable` → `refused:not_archived`
       → `refused:parent_archived` → `refused:misplaced` → `exists` (target
       verification last, as in `archive`).

105. **V3-2 regressions found by Verifier-B, ruled before V3-3 builds on
     them** (interim report on `76db3b2`):

     - *A configured folder that is a directory symlink is followed.*
       `tasks -> ../shared` was silently dropped: `list` showed 0 tasks,
       `doctor` was clean, and `nj new` wrote an element that then vanished
       from `list` — data a user cannot see is the worst failure of § 4. v2
       followed such links. Ruled: the configured layout folders at the
       backlog's top level (`epics`, `tasks`, `subtasks`, `archive`) are
       followed when they are symlinks to directories, as in v2; DECISIONS 91
       B11's "never follow a directory symlink" holds for every directory
       *below* them and for any other directory. A symlinked layout folder
       that points at nothing is `backlog:unreadable_dir`.
     - *Folder-name matching is case-insensitive.* On APFS,
       `folders.tasks: "Tasks"` (or a v2 backlog whose folder is `Tasks/` on
       disk) gave every task a permanent `type:folder` that `--fix` could not
       clear, and an `Archive/` folder un-archived its elements. DECISIONS 91
       B14 already makes configured names distinct case-insensitively, so
       matching a path segment against a configured folder name — for
       placement and for archived-ness — is case-insensitive and
       unambiguous. A move whose target is the same file as its source
       (same device and inode) is no move: the element is in place.
     - *`doctor --fix` must never crash in step 3.* A misplaced ID folder
       holding another misplaced ID folder of the same type ended in
       `internal_error` with a stack mid-run. The planner must handle
       nested misplaced folders; a case it cannot plan is reported and left
       alone.

     All three are a V3-2 follow-up, tested before the fix, done right after
     V3-3 together with DECISIONS 102.

106. **Remaining V3-2 and TSK-029 findings, ruled together to finish v3**
     (docs/verification/v3-2.md F4–F10, docs/verification/tsk-029.md T1–T4;
     the user asked to finish quickly, 2026-09-29):

     - *F4* `archive`, `rm` and `set --status=done` refuse with the new code
       `refused:unreadable_dir` (additive) while an unreadable directory lies
       inside the folder they move, delete or judge. `list` and bare `nj`
       count backlog-level errors in their summary line.
     - *F5* `doctor --fix` steps 1, 4 and 5 write only files whose name has
       the § 8 ID shape; any other `*.md` is reported, never written, and
       burns no tombstone.
     - *F6* Under `hierarchy`, step 3 does not move a folder whose subtree
       disagrees on `archived:`; it notes it and moves nothing.
     - *TSK-029 T1* The `.njrc` ownership check and the read use one file
       descriptor: `lstat` for the link owner, then `open(O_RDONLY|O_NONBLOCK)`,
       `fstat` for owner and regular-file, read from that descriptor — no
       swap window, no FIFO hang.
     - *TSK-029 T2* The move planner reports a file/folder mismatch at an
       archive target as `exists` before the first write, so no file is left
       stamped. The top-level net maps a system error to `io_error` only for
       filesystem calls on a named target; anything else stays
       `internal_error`.
     - *T3* Non-printable characters in `.njrc`-derived paths and keys are
       shown escaped in messages. *T4* The ownership error adds "use
       --backlog or NJ_BACKLOG, or change the owner".
     - *F7–F10* (stack traces in move paths, scan hazards, `new` overwriting a
       hand-written `.MD`): fixed where the same code is touched; F10 —
       `new` never overwrites an existing file, case-insensitively.

107. **V3-3 accepted** (docs/verification/v3-3.md, bc062c0: pass with
     findings). All 1892 replay diffs against `oracle-frozen-8` fall into the
     four named classes (STATUS.md appears, `init` prose names it,
     `status_stale` on fixtures without one, `fixed[]` regeneration);
     nothing else differs. *Gate rule for a behaviour-changing step (F1):*
     the frozen suites that pinned the old behaviour are red by
     construction, so `gate.js` exit 8 is expected; conformance is judged
     from the classified byte diff plus the step's own `test/` run, and the
     commit message states the gate's exit code and names the red frozen
     suites. *Baseline:* no separate c4 for V3-3 — the V3-2/TSK-029
     follow-up (DECISIONS 102/105/106) changes behaviour again right after;
     c4-baseline is recorded once, on the accepted follow-up. F2 (the
     case-insensitivity bug now visible in `STATUS.md`) is fixed by that
     follow-up.

108. **V3-4 accepted** (docs/verification/v3-4.md, 4f025ae: pass). The
     `.njrc` swap race (TSK-029 T1) is closed: 0 bypasses in 800 runs, 0
     FIFO hangs in 200. All 2987 replay diffs against `oracle-frozen-8`
     trace to the v2-era corpus tooling (fixtures writing v2 backlogs,
     `record.js` snapshotting v2 paths, 27 wording diffs); none hides a
     product diff. The project's own backlog migrated with zero element
     files touched and the tombstones byte-identical.
     *G2, fixed before c4:* a crash after step 0's renames but before its
     `.gitignore`/README fix-ups left them undone forever, because step 0
     only runs on a legacy backlog. The `.gitignore` and README fix-ups
     now run on every `--fix` (both are no-ops when nothing matches).
     *G1, accepted as a known gap:* a crash between the two renames leaves
     a stray `.ids/` with the original tombstones; harmless (it only
     doubles never-reuse), not cleaned up.
     *Not testable black-box, deferred:* a deterministic hook for the
     `.njrc` swap race; the suite's timing-based leg rarely lands a hit
     when `nj` runs under a Node parent.

109. **v3 closed.** EPIC-006 and TSK-025..029 are done; each step was
     tested first, implemented, and verified independently
     (docs/verification/). `c4-baseline` = `oracle-frozen-9` = `b9ed8c6`:
     4829 recorded calls, self-replay unchanged. The suites for the v3.1
     proposal (`NJ_AUTHOR`, `unarchive`) live in `test/proposed/` and are
     not gated until v3.1 is promoted. `hardening-v3-1` is verdict-only
     under the recording shim (the shim cannot run in an unreachable cwd);
     `baseline.js` passes `NJ_NODE`, so AC-15 is a real check again. Gate
     at HEAD: replay unchanged, oracle 71/72, one expected gap (a
     foreign-owned symlink needs root), exit 0.
     *Open, stated plainly:* the absolute § 13 perf bars were never
     re-measured on a quiet machine (A/B against each previous step showed
     no regression); a deterministic hook for the `.njrc` swap race; the
     stray `.ids/` after a crash between step 0's renames (G1); v3.1 itself.

110. **v3.1 released by the user** (2026-10-03: "gut, mache das. arbeite
     aber diesmal vorsichtiger"), scope as proposed in docs/proposals/v3.1.md:
     A `NJ_AUTHOR` (with § 0 acting name), B `nj unarchive`, C `nj claim` /
     `nj release`, plus a quiet-machine § 13 perf measurement. *How, more
     carefully than v3:* one feature at a time, in the order A → B → C;
     each is promoted into SPECIFICATION.md before any code, tested,
     implemented, verified, and accepted before the next starts; only one
     agent writes `src/` at a time; C is promoted only after an independent
     review of its concurrency protocol passes. No new teammates. Every
     ruling is recorded here before it is acted on.
     *Promotion scope:* the spec names only what exists. § 0 enters with
     `NJ_AUTHOR` as the sole source of the acting name; the `--as` flag is
     added when C (`claim`/`release`) is promoted. Until then `nj note
     --as` is `unknown_field`, as AC-25 already asserts.

111. **V3.1-A verified: accept with one follow-up** (docs/verification/
     v3-1-a-nj-author.md, 6391d26). Finding: `--id` together with `--file`
     (`invalid_target`) is checked inside target resolution, after
     `NJ_AUTHOR`, while its sibling "neither given" (`missing_argument`) is
     checked before it. *Ruling:* "both given" is argument parsing, like
     "neither given". § 10's precedence names it in the first bucket, so
     an invalid `NJ_AUTHOR` loses to it. Order: the Oracle amends § 10 and
     adds an AC-25 case; then the Implementer makes the early target-flag
     check catch both cases; then the Verifier checks the delta. A is
     accepted (TSK-030 done) once that delta passes.

112. **V3.1-A accepted.** `NJ_AUTHOR` (§ 0, § 9, § 10, AC-25) passes
     independent verification (docs/verification/v3-1-a-nj-author.md:
     6391d26 accept with notes; D111 delta b6fc1d9 accept). Gate at f7e91ad:
     exit 0, replay unchanged, oracle 72/73 (the one gap is D98's root
     requirement). TSK-030 done. B (`nj unarchive`, TSK-031) starts:
     the Oracle promotes proposal § B into the spec first, with D104's
     rulings 75–83 as amended.

113. **V3.1-B replay diffs: one named class.** At cd33d3a the replay
     against c4-baseline differs in `nj help`, `nj --help` and `nj help
     --json` only (6 calls): the added `nj unarchive` line from § 9's
     command list. As in D88, consistency with the spec wins over "0 diffs";
     the replay is accepted only if the diffs are exactly that class, which
     the Verifier confirms independently. Gate otherwise green (oracle 73/74,
     the gap is D98), perf `--ab` vs f7e91ad within bounds. A stale AC-26
     case (ac26-mis-out, pre-amendment 82) was flipped by the Oracle in
     d8507d2 by applying 82; that was not a new ruling. *After B is
     accepted:* the replay baseline is re-recorded at the accepted commit
     and tagged `c5-baseline`, so C is gated against v3.1-B behaviour and
     not against the old help text.

114. **Claim-protocol review adopted** (docs/review/claim-protocol.md,
     e10be45: "sound with fixes"). All seven changes of its § 5 are taken
     into proposal § C before promotion: (1) no live pruning in `doctor
     --fix` step 7a, so the post-check goes too; (2) roll back only after an
     own successful `link()`, and restore the entry read; (3) `ENOENT` on
     `link()` is a retry round, under the same 100-round bound as `EEXIST`;
     (4) the "already held" `claim` path re-asserts with one real CAS
     append, with or without `--status` (variant P3); (5) a landed steal's
     own mirror failure is reported, not undone; (6) claim directories are
     removed only for archived or gone elements, never merely `done`;
     (7) mixed line endings in `.gitignore`: append with the last line's
     ending, else `LF`. *On (4):* this drops the promise "idempotent,
     nothing appended". Put to the user 2026-10-03 with a stated default;
     no objection; the user said to continue autonomously. The residual
     audit-trail oddity (I3x, review § 1.5) is disclosed as a limit, not
     fixed. *Order unchanged (D110):* the Oracle revises the proposal now
     (a document only, no spec, no src); promotion into SPECIFICATION.md
     waits until B is accepted, and the Verifier re-checks the revised § C
     against the model (P3) before promotion.

115. **Proposal § C (59a3a9a): two rulings.**
     - *Rollback restores what was read (D114 point 2, as the review
       states).* A plain claim read `unclaimed`/`released`, so its rollback
       appends `released N`. A re-assertion read its own `claimed N`, so
       its rollback restores `claimed N`: a failed mirror write must not
       give up a claim N held before the command ran. In effect a
       re-assertion has nothing to roll back. A steal is never rolled back
       (point 5). 59a3a9a's "re-assertion is rolled back with `released N`"
       is corrected.
     - *P-6: `nj unarchive` removes a leftover claim directory*, through
       the same wholesale removal that `archive`/`rm` use, so an unarchived
       element always starts unclaimed. Removal happens while the element is
       still archived, before the first move; no legitimate claimant can be
       active then because `claim` refuses archived elements. A straggler's
       `link()` meeting `ENOENT` retries, re-reads, and is refused (point 3).
       It never inherits a pre-archive claim.
     The Verifier re-checks the revised § C against the model (P3, plus
     these two points) before promotion.

116. **V3.1-B accepted.** `nj unarchive` (§ 11a, AC-26 711/711) passes
     independent verification (docs/verification/v3-1-b-unarchive.md,
     49b8670: accept). The replay diffs were confirmed byte for byte to be
     exactly D113's class: 6 calls, the one inserted help line, 4829 calls
     on both sides. The helper move into core/layout.ts is a pure
     relocation. TSK-031 done. *Next, in parallel because they share no
     files:* the Implementer re-records the replay baseline at the accepted
     behaviour and tags it `c5-baseline` (D113); the Verifier re-checks the
     revised proposal § C (2689db8) against the model before C is promoted
     (D114/D115).

117. **Proposal § C cleared for promotion** (docs/review/claim-protocol.md,
     "Re-check of revised § C", f4179d1: ready to promote). All seven
     D114 fixes are in place as intended. D115's rollback rule is already
     covered by model variant P3. P-6 was modelled as scenario S13 (652,451
     states): I1 never fires; the I3x/I4 hits trace to the already-disclosed
     `claim:mismatch`, reached by a non-crash path. *Promotion now* (D110:
     B accepted, review passed): the Oracle promotes § C into
     SPECIFICATION.md, with `--as` added to § 0 as D110 foresaw, and folds
     in the re-check's four wording fixes: the straggler-retry sentence;
     "starts unclaimed" stated as best-effort, like archive's limit;
     `claim:mismatch` causes including the non-crash path; and where the
     claim-dir removal sits in § 11a's order. Tests (AC-27) follow from
     the promoted text.

118. **C tests in place; implementation starts.** AC-27 (227 checks) and
     the flipped AC-25 N6 (`--as`, 236 checks) are at 20eed2a, red against
     the current dist/nj as expected. AMBIGUITIES 84 (a third kind of file
     in a claims directory: asserted only as "must not crash a read") and 85
     (the unarchive straggler race: no hook to force it) are accepted as
     recorded gaps, not ruled further now. *Stale tests:* ac-01 asserts
     init's `.gitignore` has exactly two patterns, which b7ffad6 made
     three. The Oracle fixes it and sweeps the suites for other assertions
     that C's promotion makes stale: help text, "Known flags" lines for
     `note`, init output, `--ready`, JSON shapes. That sweep touches only
     test/, so it runs in parallel with the Implementer's src/ work. *Gate:*
     against c5-baseline / oracle-frozen-10, the replay and the frozen
     suites will differ where the spec changed (at least the help lines,
     init's third `.gitignore` pattern, and note's `--as`). The
     Implementer lists every differing call, and the lead names the classes
     here before acceptance, as in D88/D113.

119. **An empty `--as=` is `invalid_value`, not unset.** The Implementer
     found that AC-25 N6 contradicts itself: one loop expects `--as=` →
     `invalid_value`, the next block expects `--as=` → unset, exit 0.
     § 9 "The acting name" decides it: "an empty `NJ_AUTHOR` counts as
     unset" is stated for the environment variable only, and "a name, from
     either source, is valid when … it is non-empty". An empty environment
     variable is a common shell artefact; an explicit flag with no name is
     a caller's mistake and fails loudly. The Oracle drops the contradicting
     block (or flips it to `invalid_value`) and adds one clarifying
     sentence to § 9; the Implementer changes `--as=` handling to match.
     This holds for `note`, `claim` and `release` alike.

120. **Release racing a steal: both may succeed; the stealer always ends
     up holding.** AC-27 C5 asserts that exactly one of a concurrent
     `release` (by holder H) and `claim --steal=H` succeeds. § 12a says
     otherwise. If the release lands first, the steal's retry reads
     `unclaimed` and becomes a plain claim (Stealing, bullet 3), so both
     exit 0. If the steal lands first, the release reads `claimed N` ≠ H
     and is `refused:claimed` naming N. The model shows no violation for
     this race (S2/S11 under P3). *Invariant to test instead:* the steal
     exits 0; the release exits 0 or `refused:claimed` naming the
     stealer; afterwards the stealer holds the claim and the mirror agrees.
     § 12a's "of any number of concurrent steals and claims exactly one
     changes the holder" is about claims and steals among themselves; the
     Oracle adds that a concurrent release is not one of them.

121. **V3.1-C verified: accept, with three follow-ups before acceptance**
     (docs/verification/v3-1-c-claim.md, 4393780). core/claims.ts matches
     model P3 on every point; live `NJ_FAULT` rollbacks match § 12a; the
     AC-27 count gap (296 against the old dist vs 262) is 34 fixture guards
     that fire only on a failed precondition, so no check is skipped.
     *Replay classes against c5-baseline*, all four named and confirmed
     call by call (2,934 calls): (1) init's third `.gitignore` pattern
     (~1,748), (2) `_claim` in every JSON entry (~1,522), (3) `note`
     gaining `--as` (9), (4) the help text gaining the claim/release lines
     (3). The Implementer's report said 40 calls in two classes because
     gate.js truncates its diff list at 40 without giving the total. That
     was not dishonest, but it is a gap in the instrument.
     *Follow-ups:* (a) `nj help` shows no `[--as=…]` on `note`, while § 9
     lists it (help mirrors § 9, D88): the Implementer fixes it. (b)
     gate.js must always print the total number of differing calls and a
     per-command tally, even when it truncates the listing: the Implementer
     fixes it. (c) The per-process cache "does .nanojira/claims/ exist" has
     a narrow staleness window: a backlog's first-ever claim racing a read
     can make that one read's `--ready`/`_claim` momentarily stale. Claim
     exclusivity is unaffected. The Oracle discloses it under § 12 Limits.
     Also, unrelated to C: § 9's synopsis of `nj new` omits `--status`,
     which help and code have. The Oracle fixes that typo. C is accepted
     once the Verifier has checked the (a)/(b) delta; then the replay
     baseline is re-recorded as `c6-baseline` at the accepted state.

122. **v3.2 and v3.3 released by the user** (2026-10-03, "setzt alle eure
     vorschläge um"), following the lead's list of ideas. *v3.2:*
     (1) `nj check`, ticking a checkbox in an element's body;
     (2) stale claims made visible: claim age in `list`/`show`, and a
     `doctor` warning for old claims;
     (3) `nj find`, full-text search including the body;
     (4) batch writes, `--id=A,B,C`;
     (6) known gaps closed: a deterministic hook for the `.njrc` swap race,
     `doctor --fix` cleanup of a stray `.ids/` left by a crash in step 0
     (G1), and the absolute § 13 perf measurement on a quiet machine.
     *v3.3:* (5) an MCP wrapper, as its own project after v3.2, with its own
     proposal. *How:* exactly as D110. First finish v3.1 (C accepted,
     `c6-baseline`). Then a written proposal (docs/proposals/v3.2.md) with
     open questions put to the lead, and an independent review of it. Then
     one feature at a time: spec → tests → implementation → verification →
     acceptance. Only one agent writes `src/`. Same three teammates, no new
     ones. Drafting the proposal may start now, because it is a document only.

123. **v3.2 proposal (5fe6af5): open questions ruled by the lead.** The
     Oracle's recommendations are taken, with these precisions:
     - *A `nj check`:* addressing by `--text` (primary, a substring match on
       the item text) and `--item=<n>` (1-based among the countable
       checkboxes). Zero matches or several are distinct, named errors.
       Exactly one of the two flags is required. `## Notes` is excluded.
       Fence-aware matching (a checkbox inside a fence never counts) is a
       deliberate, stated exception to § 7. It is a guarded write; `--force`
       extends to `check` like `set`/`note`.
     - *B stale claims:* no new `_claim` field, because the claim time it
       already carries is enough and age is computed by the reader.
       `doctor` warns (`claim:stale`, severity warning) above
       `staleAfterHours` in .nanojira/config.json: default 24, unit hours, 0
       disables the warning. `--ready` is unchanged, and nothing is ever
       auto-stolen.
     - *C `nj find`:* title, body and notes are searched; case-insensitive
       (the spec states which folding, e.g. `toLowerCase`); substring match;
       `--all` includes the archive; list's filters combine; output shape as
       `list`, no `_match` field this round.
     - *D batch writes:* `--id=A,B,C` for `set`, `note`, `check`, `claim`,
       `release` only. Every ID is resolved and validated before anything is
       written: an unknown ID or invalid input aborts the whole batch with
       nothing written. Per-ID runtime failures (`changed_in_parallel`,
       `refused:claimed`, …) do not stop the others. Exit 1 if any ID failed;
       the JSON reports a result per ID. The spec pins the wrapper shape and
       field names exactly.
     - *E gaps:* the `.njrc` hook's go-marker placement as the Oracle leans
       (§ 4, beside the `.njrc` rule), and the spec says where the marker
       lives before a backlog is resolved. The stray `.ids/` cleanup is a
       `--fix` note only, with no new finding. E3 (perf) is scheduling, run
       by the lead on a quiet machine.
     The Oracle folds these rulings into the proposal; then the Verifier
     reviews it independently (D122) before any promotion.

124. **V3.1-C accepted.** `nj claim` / `nj release` (§ 9 acting name,
     § 12 Claims, § 12a; AC-25, AC-27) passes independent verification
     (docs/verification/v3-1-c-claim.md: 4393780 accept; D121 delta b697762
     accept). Replay against c5-baseline: 2,934 differing calls, exactly
     D121's four classes. The Verifier re-derived the counts in the delta
     and corrected two miscounts in its own first report: `.gitignore`
     third pattern 1,399, `_claim` 1,523, `note --as` 6, help 6. gate.js
     now prints the true total and a per-command tally. TSK-032 done.
     *v3.1 is functionally complete*; only TSK-033 (the quiet-machine perf
     measurement, folded into v3.2 E3 by D122) remains. *Next, in parallel
     because they share no files:* the Implementer records `c6-baseline` /
     `oracle-frozen-11` at the accepted state, and the Verifier reviews the
     ruled v3.2 proposal (aa6ee56).

125. **v3.2 proposal review adopted** (docs/review/v3.2-proposal.md,
     717fd84: "needs changes", text only). Rulings:
     - *D's example* uses a genuine runtime failure (`refused:claimed`),
       not `refused:archived`, which is preflight and aborts the whole batch.
     - *STATUS.md* is regenerated **once**, after the whole batch, and only
       if at least one ID was written.
     - *A repeated ID* (`--id=A,A`, also after trimming) is an argument
       error in preflight: `invalid_value`, nothing written.
     - *Per-ID failure entries* carry the same fields a single-element
       failure carries, including `hint`.
     - *Claim age* is computed against `NJ_NOW` when it is set, like every
       other time-dependent behaviour, so AC-29 is deterministic.
     - *An unknown key in the `claims` config block* follows § 5's
       precedent for the `layout` block.
     - *Checkbox markers* are stated normatively, not by example: list
       markers `-`, `*`, `+`, `1.`, `1)`; nested (indented) items count; a
       box reads `[ ]`, `[x]` or `[X]`; `check` writes `[x]` and `--uncheck`
       writes `[ ]`.
     - *A zero-match `nj check` stays `not_found`* (the reviewer's
       recommendation). `nj` already reuses `not_found` beyond missing
       elements, and the message names what was not found; the lead's
       concern is answered by that precedent.
     The Oracle folds these into the proposal. The lead checks the text
     diff; no second review round is needed for text-only fixes. Then
     promotion starts with A (`nj check`).

126. **v3.2 proposal final (cd6da2f); promotion starts with A.** The lead
     checked the text diff of the D125 fixes. One supersession: `nj check`
     uses `--on`/`--off` as the proposal writes them; D125's "`--uncheck`"
     wording is replaced, because the pair is symmetric and explicit.
     Backlog: EPIC-008 with TSK-034 (A) … TSK-038 (E). TSK-033 (perf) stays
     under EPIC-007, which closes when it is measured. Order: A → B → C → D
     → E, each spec → tests → implementation → verification → acceptance.

127. **AC-27 joins the replay's concurrent-suite allowlist (92db73d), at
     file granularity, for now.** Recording `c6-baseline` showed that
     AC-27's C5 races (real parallel processes) are nondeterministic by
     design, like AC-7. baseline.js can exclude only whole suites, because
     its label is per file, so 436 of 6,313 calls (6.9 %, 61 scratch
     backlogs) leave the byte replay. Only 3 of those backlogs
     (ac27-c5-claim, -steal, -release-steal) actually race; the other 58 are
     deterministic and lose replay coverage only through the granularity.
     AC-27's verdict still runs in every gate. *Accepted as a stated gap.*
     *Follow-up in v3.2 E (TSK-038):* exclude by scratch backlog (or
     scenario label) so that only the three C5 backlogs leave the replay.
     The Verifier audits 92db73d together with the c6 recording.

128. **`nj check` without `--on`/`--off` ticks; both given is
     `invalid_value`.** § 10a (2130cbe) shows `[--on | --off]` as optional
     but does not say what neither flag means. Ticking is the command's
     name and its common case, so the default is `--on`. Both flags together
     are contradictory and are `invalid_value`, the same treatment as
     `--text` with `--item`. The Oracle adds one sentence to § 10a and the
     matching AC-28 cases. Unrelated sweep, also for the Oracle: the
     "every command" COMMANDS arrays in ac-17 and ac-24 lack `unarchive`,
     `claim`, `release` (since v3.1) and now `check`. They are completed so
     that the cross-cutting checks (`--backlog`, legacy migration) cover
     every command.

129. **V3.2-A verified (26d1703: accept); one delta: an empty `--text=` is
     `invalid_value`.** The Verifier recorded that an empty `--text=`
     matches every checkbox and so silently ticks the only one when there
     is exactly one. An empty variable expanded by an agent would tick
     something unintended. As with `--as=` (D119), an explicit flag with an
     empty value is a caller's mistake and fails loudly: `--text=` with the
     literally empty string → `invalid_value`, nothing written. **No
     trimming:** a whitespace-only `--text` stays a plain substring. The Oracle adds the sentence to § 10a and the AC-28
     case; the Implementer changes cmd-check.ts; the Verifier checks the
     delta. Then A is accepted.

130. **V3.2-A accepted.** `nj check` (§ 10a incl. D128/D129; AC-28,
     128 checks) passes independent verification
     (docs/verification/v3-2-a-check.md: 26d1703 accept; D129 delta
     7c328d1 accept). Replay against c6-baseline: 6 calls, all the
     inserted `nj check` help line (class *help*). TSK-034 done; B (stale
     claims, TSK-035) starts. *Baseline cadence for v3.2:* no
     re-recording after each feature. The gate's tally (D121) keeps the
     accumulating classes legible; each acceptance names its classes here;
     `c7-baseline` is recorded once, after v3.2 E is accepted.

131. **V3.2-B accepted** (docs/verification/v3-2-b-stale-claims.md,
     b9e83f2: accept). Stale claims: `claims.staleAfterHours`,
     `claim:stale`; AC-29 43/43. The replay against c6-baseline is still
     exactly the 6 help calls from A, confirmed unclipped over the whole
     corpus, so the `_claim`/`_problems` key-order fix (d54322b) is
     complete. *One text ruling:* `claim:stale` appears in the
     `_problems` of every entry `nj` returns (`list`, `show`, `tree`,
     bare `nj`, and the write results of `set`, `note`, …), exactly as
     `claim:mismatch`/`claim:orphaned` already do. The code stays; § 12's
     "doctor, list and show" is broadened, and AC-29 gains a case on a
     write result and on `tree`. That is a spec/test-only delta, so no
     re-verification of code is needed. TSK-035 done; C (`nj find`,
     TSK-036) starts.

132. **`nj find` spec (1e4f062) reviewed: two notes.** (a) The Oracle
     added `--case-sensitive`, which D123 did not name. It is accepted: it
     is small, it opts out of the default rather than changing it, and
     agents searching for identifiers need it. (b) § 9a calls
     `toLowerCase()` "Unicode simple case folding", which it is not: it is
     the locale-independent lowercase mapping (`ß` stays `ß`, `İ` becomes
     `i̇`, no full folding). The text is corrected to say exactly that,
     with no behaviour change, and AC-30's Unicode cases must assert what
     `toLowerCase()` actually does. The § 9a placement (its own section,
     like § 10a) is fine. The Implementer starts in parallel, because the
     correction changes no behaviour.

133. **V3.2-C accepted; D paused until the backlog deletion is
     explained.** `nj find` (§ 9a incl. D132; AC-30 34/34) passes
     independent verification (docs/verification/v3-2-c-find.md, c615a6d:
     accept). Replay: the same 6 help calls (check and find lines), and
     `list` is provably unchanged (only applyFilters' export). `find` costs
     the same as `list` at 10k elements. TSK-036 done.
     *Incident:* the Verifier found the repo's own backlog/ (106 files,
     incl. .nanojira) deleted from disk, uncommitted. The lead restored it
     from git (`git checkout -- backlog`; doctor clean, 51 entries,
     nothing lost: the last backlog commit was 6e6d1fc and nothing wrote
     to the backlog after it). The cause is unknown. Until it is found,
     nobody runs `nj` or tests with cwd inside the repo, and D (batch
     writes) does not start. The Verifier does read-only forensics
     (docs/review/backlog-deletion.md).

134. **Backlog deletion explained; D resumes.** The Implementer reported
     the cause: while building a 10k-element timing fixture for V3.2-C, a
     bare `nj init` (no `--backlog=`) ran with cwd = repo root. `nj`
     correctly refused ("…/backlog already exists"). The message was
     misread as a stray directory, and the next command was
     `rm -rf ./backlog` in the repo root. This was an operator error, not a
     product defect; `nj init` behaved as specified. Restored from git
     (D133); nothing lost. *Standing rules for every teammate, effective
     now:* (1) never `rm -rf` (or `rm -r`, `git clean`, a bulk `mv`) any
     path inside the repo; only paths under your own /tmp/<role>-*
     directory. (2) Fixtures and probes always take an explicit
     `--backlog=<path under /tmp>` or run with cwd under /tmp, never cwd =
     repo. (3) An unexpected "already exists" or any refusal about a path
     you did not mean to target is a stop signal: report it, don't act
     around it. (4) Before deleting anything, look at what it is (`ls`,
     `git status`). The forensic task is withdrawn as unneeded. D
     (batch writes, TSK-037) starts.

135. **`NJ_FAULT` in a batch fires once.** `NJ_FAULT` is process-wide, not
     addressed to an ID. In a batch (`--id=A,B,C`) the hook fires at the
     first write that reaches its injection point, in execution order;
     that ID's result is a failure with `fault:<hook>`, its file stays at
     its previous revision, and the hook is then spent, so later IDs
     complete normally. This keeps AC-31's "one runtime failure does not
     stop the others" deterministic and testable. A single-ID command is
     unchanged: one write, one firing, exit 1 (§ 12).
     `before-compare`'s marker wait applies to that one firing only.

136. **Batch writes (01622e7): execution order and preflight output.**
     (a) IDs are written in the order `--id` names them; `results` has the
     same order (D135 relies on it). (b) *Batch-wide argument errors* are
     not about one ID, so they use § 9's generic single-failure shape
     `{ok: false, error, hint?}`, unwrapped: `unknown_field`,
     `missing_argument`, `missing_value`, an invalid flag value, an invalid
     acting name, `--id=A,B` with `--file` (`invalid_target`), and a
     repeated ID (`invalid_value`). (c) *Per-ID preflight failures*
     (`not_found`, `duplicate_id`, `refused:archived`,
     `refused:unreadable`, `check`'s `not_found`/`ambiguous_target`) use the
     wrapper. On such an abort `results` lists **only the IDs that failed
     preflight**, in named order, each with its code. The IDs that passed
     are absent, and `ok: false` plus the absence say that nothing was
     written. No new code (e.g. "not_attempted") is introduced. The Oracle
     adds (a)–(c) to the batch section together with D135 and the
     matching AC-31 cases.

137. **V3.2-D verified: needs changes (80b0971).** The single-ID paths are
     provably unchanged; AC-31's 67 vs 68 is a setup guard that fires only
     on failure. Two bugs: (1) `NJ_FAULT=before-compare` in a batch still
     hard-exits the process, because compareGuard's before-compare branch
     always calls hardExit, so D135 is violated for that hook (the other
     two hooks are correct); (2) `release`'s batch JSON leaks the internal
     `anyWritten` field. Both escaped AC-31, which tests D135 only with
     `before-rename` and does not pin `release`'s batch keys. *Fix:* the
     Implementer routes before-compare through the same
     catchable/non-catchable split as atomicWrite/mirrorWrite, and builds
     `release`'s wrapper like the other four. The Oracle adds AC-31 cases
     for before-compare in a batch (with the marker) and for every batch
     command's top-level keys being exactly `{ok, results}`. The Verifier
     then checks the delta and also completes the byte-exact gate replay,
     which stalled in the first run.

138. **V3.2-D accepted.** Batch writes (§ 9 incl. D135/D136; AC-31, 95
     checks) pass independent verification after the D137 fixes
     (docs/verification/v3-2-d-batch.md: 80b0971 needs changes; a249051
     accept). Replay against c6-baseline, confirmed unclipped: the 6 help
     calls, differing only in the accepted check/find lines and the new
     batch paragraph. *Recorded fix on a single-ID path:* single `nj claim`
     under `NJ_FAULT=before-compare` (timeout) now goes through § 12a's
     rollback (plain claim → `released N`; re-assertion keeps `claimed N`)
     instead of hard-exiting. § 12a requires the rollback for "a fault
     hook" without exception; the old hard exit was a latent violation that
     no test asserted (AC-27 drove the rollback only with before-rename).
     AC-27 gains that case in E. TSK-037 done; E (TSK-038) starts: the
     `.njrc` swap-race hook, stray `.ids/` cleanup, replay exclusion per
     scratch backlog (D127), the AC-27 before-compare rollback case, and
     the quiet-machine perf measurement (lead).

139. **`njrc-swap` fires before `open()`, as § 4 says; the lead's
     message was wrong.** The swap race of TSK-029 was: check the path
     (lstat), then open the path, so a swap in between opens a file that was
     never checked. The fix opens first and checks ownership on the fd. The
     hook therefore sits between the path-level lstat and `open()`, which is
     exactly where the old race was. A swap during the pause makes `open()`
     open the new file, and the fd-based check must then judge that new
     file. Root leg (unchanged, root-only): a swap to a foreign-owned link
     → refused, naming the post-swap uid. *Non-root leg:* a swap to a file
     of the same user that names a different backlog → `nj` uses the
     swapped-in content, and check and read come from the same opened file,
     with no mix of old check and new content. Also covered: a swap to
     nothing (`.njrc` removed during the pause) gives a clean error, not a
     crash or a fallback to the old content; and no marker gives a timeout
     per § 12. The Oracle writes the non-root leg against this ordering;
     § 4's wording stays.

140. **njrc-swap, final (crossed messages resolved).** The Oracle acted on
     the lead's earlier, wrong message before D139 arrived and moved the hook
     after `open()` (5633007). D139 stands: the hook sits **between the
     path-level lstat and `open()`**, as 625e083 had it, because only there
     does a swap test the fd-based ownership check. After `open()` a swap is
     inert by POSIX and proves nothing. Kept from 5633007: the hook is a
     **pure pause**. After the marker *or* the 10 s timeout, `nj` proceeds;
     it never aborts, so there is **no `fault:njrc-swap` code** (625e083
     listed one, which contradicted its own "proceeds"). *Expected
     outcomes:* a same-user swap to a file naming another backlog → `nj`
     uses the **swapped-in** backlog (check and read from the one opened
     fd); a foreign-owned swap target → refused, naming the post-swap uid
     (root-only, D98); `.njrc` removed during the pause → treated as
     absent at that level, so § 4's search continues upward exactly as if
     it had never been there (no stale-lstat trust, no crash); no marker →
     proceeds after 10 s. The Oracle restores § 4 to the pre-open placement
     (keeping the code removal) and flips the non-root suite's assertions
     to the swapped-in backlog. The Implementer implements this.

141. **Harness a21f195 sound; it surfaced 39 hidden claim/release diffs;
     D138's replay claim was incomplete.** The audit
     (docs/verification/harness-a21f195.md, 148296b) confirms exactly the
     112 C5 calls are excluded and the gate is deterministic. gate.js pairs
     harness code with its own corpus, so the old tag is no mix risk. With
     AC-27's ordinary calls back in the byte replay, 39 `claim`/`release`
     calls differ from c6: the JSON key order of their single-ID output
     changed in the batch refactor (05e8bfa/aa4a4df). The old whole-suite
     exclusion hid it. **D138's "replay: the 6 help calls" was therefore
     incomplete**, and this entry corrects it. *Ruling:* the key-order
     change was unintended. As in V3.2-B (d54322b), the original order is
     restored, so single-ID `claim`/`release` output is byte-identical to
     c6. The Implementer does this as its own commit after the E work, and
     the gate tally must then show only the help class (plus whatever E
     itself names). Also: backlogLabel() should consider only the
     command's own cwd basename, not ancestors (a nested nj-gate-* root
     yields a spurious 'gate'); this is harmless today, so it is fixed with
     the same pass. `c7-baseline` is recorded after E's acceptance, as
     planned (D130).

142. **V3.2-E + D141 verified (0785c14: accept); one narrow E.1 gap is
     fixed before acceptance.** D141 is done: the single-ID claim/release
     key order is restored, backlogLabel is basename-only, and the gate
     against oracle-frozen-11 shows exactly the 6 help calls, byte-confirmed.
     *Gap:* a **symlinked** `.njrc` whose link is itself unlinked during the
     njrc-swap pause is reported as `invalid_njrc` ("dangling symlink"),
     because the ENOENT cause is judged from the original lstat alone.
     D140's rule ("removed outright → absent, search continues") applies
     to the link as much as to a regular file. *Fix:* at ENOENT, lstat the
     path again. If nothing is there, the entry was removed: absent,
     continue upward. If a symlink is still there, its target is missing:
     a genuine dangling link, `invalid_njrc` as before. The Oracle adds S4
     (symlinked `.njrc` unlinked in the pause → search continues) and S5
     (symlink present, target removed in the pause → `invalid_njrc`); the
     Implementer applies the fix; the Verifier checks the delta. Then E is
     accepted and `c7-baseline` is recorded.

143. **V3.2-E accepted; v3.2 functionally complete.** The njrc-swap hook
     (§ 4, D139/D140/D142), the stray `.ids/` cleanup (§ 14 step 0), the
     replay exclusion per scratch backlog (a21f195/f30c2a3, D127/D141) and
     the AC-27 before-compare rollback case pass verification
     (docs/verification/v3-2-e-gaps.md: 0785c14 accept; D142 delta 3cfab34
     accept). The gate at c8eeac3 against oracle-frozen-11 shows exactly the
     6 help calls (check, find and batch lines), byte-confirmed; there are
     no other replay diffs since D141. TSK-038 and EPIC-008 are done.
     *v3.2 summary:* `nj check` (D130), stale claims (D131), `nj find`
     (D133), batch writes (D138), gaps (this entry). *Still open:* TSK-033,
     the absolute § 13 perf measurement on a quiet machine (the machine has
     been under foreign load: another process at 500 % CPU). *Next:*
     the Implementer records `c7-baseline` / `oracle-frozen-12` at the
     accepted state; then v3.3 (MCP wrapper, D122) starts with a proposal.

144. **v3.3 proposal (0fba429): open questions ruled.**
     - *A-1:* one backlog per server process, resolved once at startup by
       the existing rules (`--backlog`, `NJ_BACKLOG`, `.njrc`).
     - *B-1, deviating from the recommendation:* **hand-roll** the small
       stdio JSON-RPC/MCP subset (initialize, tools/list, tools/call, the
       required notifications), pinned to one stated protocol version. nj's
       defining property is a single bundled file with no runtime
       dependencies; the SDK would add a dependency tree for a few hundred
       lines of protocol. Compatibility risk is answered by tests: the
       oracle drives `dist/nj-mcp` with the official MCP SDK **client**,
       added as a devDependency for tests only and never shipped. *B-2*
       then reduces to the wrapper's own size and cold start; measure and
       report.
     - *C-1:* tools are list, show, find, tree, new, set, note, check,
       claim, release, archive, unarchive, doctor. `rm` (incl. `--cascade`)
       is **omitted** in v3.3. `archive`/`unarchive` are offered: they are
       reversible. `doctor --fix` exists only when the server was started
       with the safety flag (E-1).
     - *C-2:* MCP input schemas are generated from a flag table shared with
       the CLI parser. Moving the CLI onto that table must keep CLI
       behaviour byte-identical, and the replay gate against c7 proves it.
     - *C-3:* a failure is a tool result with `isError: true` and the
       unmodified `{ok, error, hint?}` body; the code is never lost.
     - *C-4:* the acting name is a per-call `as` parameter, defaulting to
       the server's `NJ_AUTHOR`, with the same validation as `--as` (D119).
     - *D-1:* process-per-call: the server spawns `dist/nj --json` for each
       tool call, so there is no duplicated logic and § 12 holds by
       construction. *D-2:* measure; the budget is the per-call overhead
       over a direct CLI call (p50) ≤ 50 ms.
     - *E-1:* a single `--allow-destructive` start flag, which today gates
       only `doctor --fix`.
     - *Section:* "§ 17. MCP Interface".
     The Oracle folds these into the proposal; then the Verifier reviews
     it before promotion (D122).

145. **v3.3 proposal review adopted (13c0a02: needs changes).** *Protocol
     era:* the Verifier fetched the published MCP spec (revision
     2026-07-28). Requests now carry their protocol version in per-request
     `_meta`, `server/discover` is mandatory, and the spec names
     modern/legacy/dual-era tiers; a modern-only client against a
     legacy-only server "fails". *Ruling:* `nj-mcp` is a **dual-era**
     server. It answers `server/discover` and honours the per-request
     version (modern), and keeps the `initialize` handshake (legacy),
     each pinned to one named revision. That costs a little more protocol
     code but does not shut out clients as they move to the modern era.
     The SDK-client tests exercise both paths. *Also adopted:* (a) the
     schema generator reads only per-command flags, never the global
     `--backlog`, and an AC asserts that no tool schema has a backlog
     field; (b) every spawned child gets `--backlog=<the server's
     resolved path>` explicitly, so confinement is mechanical; (c) an
     AC-15-style test runs `dist/nj-mcp` copied alone with no node_modules;
     (d) the proposal states how argument/schema validation failures are
     reported (`-32602` vs a tool result with `isError`) and what
     capabilities the server declares. The Oracle folds these in; the
     lead checks the diff; then promotion into § 17.

146. **v3.3 proposal final (f7ce0c7); promotion into § 17 starts.** The
     lead checked the D145 diff: the dual-era server actually implements
     `server/discover` (a `DiscoverResult` with supportedVersions
     2026-07-28 and 2025-11-25, capabilities `{tools: {}}`), keeps legacy
     `initialize` pinned to 2025-11-25, answers an unsupported modern
     version with `-32022`, uses `-32602` only for schema-shape failures
     before any child spawns, and makes a CLI rejection a tool result with
     `isError`. Backlog confinement is explicit, and AC-34/37/38 cover it.
     One consistency point for the promotion: § B's "zero dependencies,
     even at build time" must not contradict D144's test-only
     devDependency on the official SDK **client**; the spec states both
     precisely. Backlog: EPIC-009 / TSK-039. Order: § 17 + AC-32..38
     (Oracle) → implementation (Implementer) → verification (Verifier) →
     acceptance.

147. **§ 17 and AC-32..38 in place (05485ae, b749c6c); the SDK client
     may be installed as a pinned devDependency.** Per D144, the official
     `@modelcontextprotocol/sdk` serves only the conformance test
     (ac-32-mcp-sdk.js). It is installed with an **exact** version (no
     caret), recorded in package.json and package-lock.json in **its own
     commit**, with the version and the lockfile integrity named in the
     commit message. `node_modules` stays ignored. It is never imported by
     src/ or bundled into dist/nj or dist/nj-mcp; AC-38 (nj-mcp copied
     alone) and a bundle check prove that. The oracle stays runnable
     offline: without the package, ac-32-mcp-sdk.js reports CANNOT RUN
     and is not a failure, like the root gaps. The Oracle installs it;
     then the Implementer builds `dist/nj-mcp`.

148. **V3.3 accepted: `nj-mcp` ships.** § 17 MCP Interface (AC-32..38)
     passes independent verification (docs/verification/v3-3-mcp.md,
     26ab9b0: accept). AC-36 holds: the shared flag table (8995a5d) leaves
     the CLI byte-identical against c7-baseline, including the "Known
     fields"/"Known flags" hints. The dual-era protocol, `-32022`, and
     `-32602` before any spawn were confirmed. stdout stays pure even with
     a crashing child. Confinement holds against a decoy `NJ_BACKLOG`, a
     `backlog` argument, argv-shaped values and `--file` into another
     backlog. Pipelined calls are matched by id; stdin EOF kills in-flight
     children. `rm` is absent and `doctor` fix is schema-gated by
     `--allow-destructive`. No `@modelcontextprotocol` code is in either
     bundle, even with the SDK installed (bundle byte-identical).
     dist/nj-mcp is 17.5 KB, cold start p50 about 19–21 ms, per-call
     overhead in single-digit ms (budget 50 ms). The ac-32-mcp-sdk leg is
     CANNOT RUN inside gate worktrees without network (by design, D147).
     TSK-039 and EPIC-009 are done. *State of the released scope (D110,
     D122):* v3.1, v3.2 and v3.3 are complete and verified. *Still open:*
     TSK-033, the absolute § 13 perf measurement on a quiet machine
     (blocked by foreign load, another process, which the lead does not
     stop).

149. **User docs brought to v3.3 and verified.** README, GUIDE and
     ARCHITECTURE describe v3.1–v3.3 and nj-mcp (ea2c5c8, de65c3f, a4a6c96),
     including a "Many projects on one machine" section: one install serves
     every project; each project resolves its own backlog (§ 4); one
     nj-mcp server per project (§ 17). Every GUIDE example is now pasted
     from a real run (NJ_NOW pinned). The Verifier found 10 doc-side
     mismatches and no behavioural defect (0689f98); all 10 are fixed and
     re-checked byte for byte (7a85a43). Still open: TSK-033 (quiet-machine
     perf) and, for the user to decide, a release tag or push.

150. **TSK-033 measured: the § 13 comfort bar holds at v3.3.** On a quiet
     machine (AC power, no Low Power Mode, foreign load below perf.js's
     bar; load average 1.7), `node tools/perf.js` at 075dbb1 with 10,000
     elements, 5 runs each, median/max: `list` 185/220 ms, `list --json`
     186/187, `tree` 189/192, `doctor` 188/191; all within median ≤ 250 /
     max ≤ 500. Writes (reported, no bar): `new` 230/237, `set --title`
     221/223, `note` 215/218. These match the pre-v3 figures (about 190 ms),
     so v3–v3.3 added no measurable read cost, consistent with every
     per-step `--ab` check. TSK-033 and EPIC-007 are done. The Oracle
     updates § 13's measured figures to these, naming commit and
     conditions. **The released scope (D110, D122) is now complete without
     open items**; publishing (tag/push) is the user's call.

151. **v3.4 released by the user: onboarding** (2026-10-05, "Dann sollten
     wir die Lücken schließen"; minimum Node version and distribution
     explicitly out of scope). Three items, small enough to rule directly
     without a separate proposal:
     - *`--version`:* `nj --version` and `nj-mcp --version` print
       `nj <version>` / `nj-mcp <version>` and exit 0. With `--json`, `nj`
       prints `{"version": "<version>"}`. Neither resolves a backlog or reads
       any file other than its own, so both work anywhere. `nj version` is
       not added. There is one version source: a `"version"` field in
       package.json (set to `3.4.0`), embedded at build time into both
       bundles. nj-mcp's serverInfo/initialize version uses the same value
       (today a hard-coded '1.0.0'). `--version` combined with any command
       or other flag is `unknown_field`/argument error per the existing
       rules; the Oracle states which.
     - *Install section* in GUIDE: copy or symlink `dist/nj` and
       `dist/nj-mcp` into a directory on PATH (they are self-contained);
       per project `nj init`; per project an nj-mcp entry (link to § 3 "Many
       projects"). Verify with `nj --version`.
     - *Agent-instructions template* `docs/AGENT-INSTRUCTIONS.md`: a
       copy-paste block for a project's AGENTS.md. Always
       `--json`; read before write; `nj claim` before working,
       `nj release` or `done` after; never edit backlog files by hand;
       `nj check` for checkboxes; `nj note --as` to sign; codes are the
       contract and prose is not. Strictly consistent with the spec.
     Process: Oracle (spec § 9 `--version` + AC-39, then docs) →
     Implementer → Verifier → acceptance; replay against c7 must show only
     the help class (if help mentions `--version`). Backlog: EPIC-010 /
     TSK-040.

152. **V3.4 verified with one gap (e5758d8): nj-mcp's startup arguments
     become strict.** `nj --version`, the install section and
     AGENT-INSTRUCTIONS.md pass (followed literally in a PATH sandbox; every
     template command runs). The gap: `nj-mcp --version` does not enforce
     § 9/§ 17's exclusivity (`--version --backlog=x` prints the version),
     because nj-mcp's startup parser silently ignores anything it does not
     know, typos included (`--allow-destrutive` would quietly start without
     the flag). *Ruling:* nj-mcp's startup arguments are validated before
     any protocol traffic. Known: `--backlog=<path>`, `--allow-destructive`,
     `--version`. Anything else, or `--version` with any other argument
     (nj-mcp has no `--json`), is an error: exit 1 and one line on stderr
     naming the offending argument and the known ones, with nothing on
     stdout. That matches nj's "a typo must not pass" rule. The Oracle
     updates § 17 and adds an nj-mcp combination and unknown-flag leg to
     AC-39; the Implementer applies it; the Verifier checks the delta.

153. **v3.4 accepted: onboarding complete.** `nj --version` /
     `nj-mcp --version` (single source package.json 3.4.0, embedded at
     build; nj-mcp serverInfo in both eras), strict nj-mcp startup
     arguments (D152), the GUIDE install section and
     docs/AGENT-INSTRUCTIONS.md all pass verification
     (docs/verification/v3-4-onboarding.md: e5758d8; D152 delta 1f8b16d).
     The install section was followed literally in a PATH sandbox, and
     every template command was run. AC-39 59/59, and its new legs
     discriminate (27 red against the pre-fix build). The replay against
     c7-baseline differs only in the 6 help calls (the --version line).
     TSK-040 and EPIC-010 are done; tag `v3.4`. Out of scope by the user's
     decision: a minimum Node version, and distribution (no remote).

154. **v3.5 released by the user: `nj next` and `nj log`, plus dogfooding**
     (2026-10-05, "Gut. Arbeitet autonom an der Lösung. Ihr dürft nanojira
     selbst nutzen …"). The Lead proposed three items. The third, "detect
     orphaned claims", already exists: `claim:stale` since v3.2 (D131),
     advisory by design, with no auto-release (§ 12). It is withdrawn, so no
     work is done on it. Scope:
     - *`nj next`:* one call that picks the highest-ranked `--ready`
       element (the ranking `nj` and `list --ready` already use), honouring
       the `list` filters, and claims it with the acting name. If it loses a
       race (`refused:claimed`), it moves on to the next candidate. If none
       is left, it fails with a closed-vocabulary code. `--status` is as in
       `claim`. There is also an nj-mcp tool `next`. This removes the
       list→claim gap where two agents pick the same element.
     - *`nj log --id=…`:* the change history of one element: who did what
       and when. Data that already exists is reused where possible: the
       claim generations under `.nanojira/claims/` and the dated, signed
       notes. Whether a new journal is needed for field changes
       (status/assignee/…) is a design choice. The Oracle proposes the
       options with their cost (write path, the replay gate, git noise)
       before writing tests, and the Lead rules.
     - *Dogfooding:* the team coordinates v3.5 in the project's own backlog
       through `dist/nj` (claim, note `--as`, check, set status), with
       EPIC-011. Friction is recorded as notes on a dedicated task, which
       feeds later improvements.
     Process as usual: Oracle (spec + AC) → Implementer → Verifier →
     acceptance. Replay against c7: only help-class differences are
     allowed.

155. **`nj log` ruled: derive-only (option a); claims stay git-ignored.**
     The Oracle's options proposal (2026-10-05) compared three designs:
     (a) derive from what exists; (b) an append-only journal per element;
     (c) the git log of the element file. Ruling: **(a)**. `nj log` shows
     `created`, the claim generations (claim/re-assert/steal/release:
     actor and time) and the dated, signed notes, merged in time order.
     There are no new writes, so the write path, § 13 and the replay gate
     are unaffected.
     It does **not** show field-level history (status/priority changes),
     and the spec says so plainly; agents who want a trail leave a note.
     (b) is deferred until a concrete need appears; if it ever comes, it is
     per-element, never a shared file. (c) stays a manual technique
     (`git log -p -- <file>`), mentioned in the GUIDE, not built into nj
     (§ 3: no git dependency).
     Correction during dogfooding: the Oracle committed this backlog's
     `.nanojira/claims/` to git, believing the Lead wanted it tracked for
     `nj log`. The Lead never said that, and § 12a requires the
     `.nanojira/claims/` ignore line. The Lead ran `doctor --fix`, which
     appended the line, and untracked the two TSK-041 generations with
     `git rm --cached` (the files stay on disk). Consequence for (a): claim
     history is local to the working copy; a fresh clone shows notes and
     `created` only. `nj log` states this.
     `nj next` (§ 12b, AC-40 text, 1406a40) is reviewed and accepted as
     written. One gap: the commit contains no AC-40 test code. The Oracle
     adds it before the Implementer starts.

156. **`nj next` takes leaf work only.** The Implementer found that an
     epic and its own open task tie on priority, and the `id` tie-break
     puts the epic first, so `next` would claim the container
     (pre-existing `list --ready` order, first exposed by AC-40 N1).
     Ruling: a `--ready` element that has at least one **open child** (a
     child that is neither `done` nor archived) is **not a `next`
     candidate**; its children are. This applies whatever the filters,
     including `--type=epic`. An epic without children, or with all of
     them done, stays a candidate, because closing it is real work. `list
     --ready` and bare `nj` are **unchanged**, so neither the replay nor
     existing ACs move. That bare `nj` lists a container among "ready to
     work" is noted on TSK-043 as a candidate for later and is not changed
     now. The Oracle amends § 12b and adds AC-40 legs: an epic with an open
     task is skipped; a childless epic is picked; an epic whose children
     are all done is picked; an archived child does not count as open.

157. **v3.5 accepted: `nj next`, `nj log`; dogfooding findings.** Both
     features pass verification: docs/verification/v3-5-next.md (c0ce838:
     20 processes × 8 elements × 3 rounds, exactly one winner per element;
     list/bare nj byte-unchanged) and v3-5-log.md (378a25d: never writes;
     tricky note text; the mutation tests discriminate). The AC-40 coverage
     gap the Verifier found (only 1/88 checks catches "any failure
     advances") is closed by N13 (ba3ec74, 95 checks). Docs (60915b2) cover
     § 12c clarifications, GUIDE § 14/15, AGENT-INSTRUCTIONS (pick work with
     `nj next`) and README/ARCHITECTURE. Version 3.5.0 (e616b2c). The Lead
     re-ran AC-32/39/40/41: all pass; build:check is byte-identical; the
     replay against c7 differs only in the 6 help calls. TSK-041..043 and
     EPIC-011 are done; tag `v3.5`.
     **Dogfooding.** The whole round was coordinated through `dist/nj` on
     this backlog (claim/note/check/release per role; `nj log --id=TSK-041`
     now shows all 15 steps). Findings, candidates for later releases (none
     ruled yet):
     - *Bare `nj` lists containers as "ready to work"* (an epic next to its
       own open task). `next` avoids this (D156); `list --ready` and bare
       `nj` do not.
     - *`claims_unignored` has no opt-out.* Withdrawn as a need: tracking
       claims was a misunderstanding (D155), and the warning did its job.
     - *`show --json` always returns the list shape* (`entries[0]`). This is
       correct per spec, but scripts trip over it.
     - *Batch text output is terse:* `set --id=A,B --status=done` prints
       `A → status` without the value; the single form prints
       `status=done`.
     - *Notes repeat the author:* `nj note` adds the signature, so a habit of
       writing "Lead: …" by hand duplicates it.
     - *Own checkboxes are forgotten:* the Lead left "design ruled" unticked
       until acceptance, which `nj log` made visible. A check item cannot be
       tied to an owner.
     - *Process:* a "same as X" rule must be checked against X's real
       behaviour, not a paraphrase (the Oracle's note on `show`);
       long-running gates look stuck because the parent is idle (check the
       process tree first).
     - *Team tooling:* messages sent to a busy teammate arrive late but do
       arrive. A duplicate task was avoidable.
     - *Correction to D155:* the untracking of `.nanojira/claims/` never
       landed. `git commit -- <path>` takes the path from the working tree,
       so the files on disk were re-added. Fixed in 5e1fe80 with a plain
       commit of the staged removal.

158. **v3.6: feedback from the first two outside teams** (2026-10-06,
     feedback/team-b-tests EV-1..7 and feedback/team-a PA-1..5,
     both on nj 3.5.0; the user: "Andere Teams verwenden nun nanojira …").
     Triage by the Lead:
     - **A: bugs, fixed.**
       - *EV-6:* a global flag before the command word (`nj --backlog=X
         list`) silently drops the command: `list` falls back to the bare
         status, and `show` fails with a misleading `unknown field`. Global
         flags (`--backlog`, `--json`) are accepted before the command word
         and the command runs. An unknown word is never swallowed.
       - *EV-7:* `nj note` flattens a multi-line text into one line without
         saying so. Multi-line notes are kept: continuation lines are
         indented under the `- <time> <author>:` line (a Markdown list
         continuation, readable in any viewer). `nj log`/parseNotes and the
         note-related rules are updated to match. The Oracle pins the
         details: CRLF, blank lines, trailing newlines, size.
     - **B: `nj next` and assignment.**
       - *PA-5:* `next` must not hand out an element whose `assignee` names
         someone else. This is the default, not an option: an explicit
         assignment is a statement of intent, and handing it to another
         agent overrides it silently. Candidates are therefore unassigned
         or assigned to the acting name.
       - *PA-4:* "an author gets their own review". No new exclusion field
         for now: with PA-5 fixed, assigning the review to the reviewer is
         the reliable way. GUIDE and AGENT-INSTRUCTIONS say so. To be
         revisited if teams still hit it.
     - **C: ready list.** *EV-4 / D157:* bare `nj` "Ready to work" applies
       the D156 leaf rule (no element with an open child). `list --ready`
       stays a pure readiness filter. A new, accepted replay class:
       bare-status calls on backlogs with containers.
     - **D: discoverability.**
       - *EV-2:* `nj <command> --help` prints that command's synopsis,
         flags and allowed values.
       - *EV-3 / PA-1:* the allowed `--type`/`--status`/`--priority` values
         (from the backlog's config when there is one, else the defaults)
         appear in the help, and an invalid value names the nearest valid
         one ("did you mean 'normal'?" for `medium`). There are no aliases;
         the vocabulary stays closed.
       - *PA-2:* `new`/`set` text output says when the element is not
         `--ready` and why (the `incomplete:*` codes). JSON already carries
         `_problems`.
     - **E: docs only.**
       - *EV-1:* GUIDE § 2 states that the empty directories need not be
         committed; nj recreates them.
       - *PA-3:* GUIDE § 1 adds starting nj with an explicit node (`node
         /path/dist/nj …`).
     - **Open, for the user:** *EV-5*, distribution (a remote or package to
       fetch `dist/nj` from). The user deprioritised distribution (D151),
       and it needs a remote only the user can provide.
     Process as usual. Answers go back as notes in the teams' own feedback
     backlogs when v3.6 is accepted.

159. **Local releases for other teams** (2026-10-06, user: "Ja. Einige dich
     dazu auch mit den anderen Teams."). The Team B and team-a
     teams ran `nanojira/dist/nj` straight from our working tree, so every
     in-progress build was live for them. From now on accepted, tagged
     releases are installed with `tools/release-local.sh <tag>` into
     `workspace/bin/nanojira/<version>/` (never changed after install) with a
     `current` symlink. The other teams point their wrappers at
     `…/bin/nanojira/current/nj`; they own their wrappers, and we only
     propose the change. 3.5.0 is installed from tag v3.5. `current` moves
     only on acceptance plus tag. Arrangement with the other leads is in
     progress.

160. **Did-you-mean tightened.** The replay showed `set --status=nope`
     hinting "did you mean 'done'?". That is edit distance 2, so it is
     correct under the § 9 rule, but it is noise: for short words, distance 2
     replaces half the word. New threshold: distance ≤ 1 when the input
     has ≤ 4 characters, ≤ 2 otherwise. Ties still mean no suggestion, and
     the synonym table (medium→normal) is unchanged. Examples: "urgnet"→urgent,
     "hgh"→high, "nrmal"→normal, "nope"→no suggestion.
     Addendum: distance is the optimal-string-alignment distance (an
     adjacent transposition counts 1), because swapped letters are the most
     common typo. "hgih"→high and "tsak"→task stay hinted at distance 1, and
     "nope"→done stays at 2, so no hint. The Oracle amends § 9 + AC-47 (legs for "nope" and a
     4-character distance-1 case); then the Implementer applies it.

161. **v3.6 accepted: outside-team feedback.** Batch 1 (global flags,
     multi-line notes, `next` respects assignee, bare-nj leaf rule) passed
     verification in docs/verification/v3-6-batch1.md (6430dc3). Batch 2
     (per-command help, did-you-mean with OSA + length threshold, release
     docs) passed in v3-6-batch2.md (1521a78). The Lead re-ran AC-32/39/40
     and 42–47: all pass; build:check is byte-identical; `nj --version` gives
     3.6.0. Replay vs oracle-frozen-12: 195 differing calls, all of them
     either the D158 leaf rule or help text; no did-you-mean diffs, because
     the corpus's only near-miss ("nope") is below the D160 threshold.
     The run-all "hang" was not reproduced. It is about 30 s of deliberate
     waits in three fault suites. Fixed along the way:
     - the test and harness fixture root is no longer os.tmpdir(), which
       had a foreign backlog as an ancestor (148697c, c5c33a8);
     - stale fixtures (AC-40 N3, doctor-fix-surface, AC-46 P3);
     - the AC-42 G5 gap.
     Known, for v3.7: `nj rm --help` lacks flag lines (rm has no
     flag-table entry). Also for v3.7, from the outside teams:
     team-b-tests TSK-008 (`--tags` add/remove), TSK-009 (STATUS.md
     merge noise), TSK-010 (name the override flag in the JSON error).
     TSK-044..048 and EPIC-012 are done; tag `v3.6`. Installed with
     tools/release-local.sh; `current` → 3.6.0. Both teams are notified, and
     the answers are noted in their feedback backlogs.

162. **Feedback is versioned in its own repository** (2026-10-07, user: "Das
     gefällt mir"). `feedback/` is now its own git repository (`git init`
     inside the folder, branch main, first commit 81e62b7). The nanojira
     repo keeps ignoring it (06eadd7), so no feedback commit enters the
     development history, and the teams' path is unchanged. The claims of
     each feedback backlog stay ignored through that backlog's own
     `.gitignore`. The NanoJira Lead commits new items and answer notes at
     each triage. This corrects the Lead's earlier reply to team-a
     ("we don't version it"). New since D161: team-b-tests TSK-011
     (acceptance text without checkboxes can never be ticked, and doctor is
     silent) and team-a TSK-006 (done allowed with empty acceptance).
     Both are queued for v3.7 together with TSK-008..010 and the `rm --help`
     gap.

163. **v3.7: second feedback round** (2026-10-07; the user: "mach das so, wie
     du es für richtig hältst"). Triage by the Lead:
     - **A:** `nj rm --help` gets per-flag lines, like every other command
       (rm has no flag-table entry because it is not MCP-exposed, so help
       needs its own source for rm's flags). Found by the Verifier, D161.
     - **B:** `set --add-tags=a,b` / `--remove-tags=c` (also in batch).
       Adding a present tag or removing an absent one is a no-op. These
       flags combined with `--tags=` are `invalid_value`. nj-mcp `set` gets
       both. (team-b-tests TSK-008)
     - **C:** STATUS.md merge noise is docs only. `layout.statusFile: false`
       already switches the file off (§ 4/§ 5). GUIDE gets a section for
       several agents in one tree, recommending it, plus how to get the same
       overview from `nj`. (team-b-tests TSK-009)
     - **D:** the override flag is docs only. The `--json` hint already
       names `--allow-open-children`, but codes are the contract and prose
       is not. So § 9's failure-code table gains a closed column "override
       flag" for every refusal that has one (children_open →
       --allow-open-children, the compare-before-write refusals → --force,
       …), and AGENT-INSTRUCTIONS points to it. The JSON shape is unchanged.
       (team-b-tests TSK-010)
     - **E/F:** acceptance quality becomes visible, never blocking. Two new
       warning codes, shown by `doctor` and in new/set output (text +
       `_problems`). A task/subtask whose acceptance section has text but
       no checkbox item cannot be ticked (`check` has nothing to tick).
       A `done` task/subtask with an empty or absent acceptance section was
       never defined as done. The Oracle names the codes in the closed
       vocabulary. Nothing is rejected or rewritten: existing backlogs
       must not start failing. (team-b-tests TSK-011, team-a
       TSK-006)
     Out of scope for v3.7: addressed notes + inbox (EPIC-013) and JSON
     input (EPIC-014), both planned after v3.7, asking the other leads
     first; distribution via a remote. Process as usual. Replay: new
     classes allowed only for help text and the new warnings.

164. **After v3.7: JSON input yes, inbox shelved.** Both outside leads
     answered the needs check (2026-10-07):
     - *Addressed notes + inbox (EPIC-013):* both said "rather no" or "don't
       care". Hand-offs must wake the receiver, and only team messages
       do that. An nj inbox nobody is woken by would be a second channel to
       watch. Shelved (status blocked).
     - *JSON input (EPIC-014):* both need it, daily. Their errors come from
       shell quoting of multi-line acceptance, backslash titles and zsh
       loops, not from nj. Both want one `new` call for a whole plan (task +
       subtasks + review subtask). It is v3.8, next after v3.7. Design
       constraint: elements in one array must be able to name a parent that
       is created in the same call, so nesting (`children: [...]`) or local
       references are required. The spec pins one of them, and also what
       happens on a failure mid-plan.

165. **Warnings can be switched off per backlog.** The Oracle's read-only
     count for the D163 E/F codes: team-a would get 0 + 5 warnings,
     but team-b-tests would get 10 `acceptance:no_checkbox` and 287
     `done:no_acceptance`. Most of their done elements track completion via
     tags and an external test case, with the acceptance section empty on
     purpose. 287 warnings in `doctor` is noise that hides real findings.
     Ruling: a new optional config key `problems.ignore`, a list of
     **warning** codes. Codes listed there are suppressed everywhere:
     doctor, `_problems`, write feedback and counts. Error codes and
     `incomplete:*` cannot be listed (`invalid_config`), so the ready rule
     and real defects stay visible. The default is empty, so both new codes
     are on. The Lead tells team-b before the release and suggests
     `"problems": {"ignore": ["done:no_acceptance"]}` if the empty
     acceptance is deliberate for them. This also answers the v3.5 friction
     "claims_unignored has no opt-out" (D157). The Oracle adds § 5 + § 7
     wording and an AC. The Implementer builds it with E/F.

166. **Config forward compatibility, from 3.7** (team-b-tests TSK-012,
     2026-10-07). Today an older nj fails every command with
     `invalid_config` on a key written for a newer one. That makes the
     rollback and mixed-version machines a trap. Ruling, all part of 3.7:
     1. An unknown top-level config key is a **warning**
        (`config:unknown_key`, reported by doctor) instead of an error, so
        typos stay visible but nothing stops working.
     2. An unknown code in `problems.ignore` is a warning
        (`config:unknown_code`) and is skipped. A *known* error or
        `incomplete:*` code listed there stays `invalid_config`, because
        that is misuse, not version skew. This amends D165.
     3. An optional `"minVersion": "3.7.0"`. If the running nj is older, it
        fails every command with a clear new code (`needs_newer_nj`, naming
        both versions) instead of a bare invalid_config.
     **Correction (same day):** the premise was wrong. The Lead claimed
     that older nj rejects unknown top-level keys and did not check it. The
     Oracle found, and the Lead confirmed live with 3.5.0 and 3.6.0, that
     unknown TOP-LEVEL keys are silently ignored today. Only the nested
     blocks (`layout`, `claims`) have closed key sets. So `problems` and
     `minVersion` are harmless to 3.5/3.6, and rollback is safe. What 3.7
     changes for top-level keys: silent becomes a visible warning (point 1),
     and minVersion is honoured from 3.7 on. Unknown keys INSIDE a nested
     block also become warnings, for the same reason.
     The Oracle specs it with D165; the Implementer builds it with E/F.

167. **The E/F warnings skip archived elements.** The Implementer found that
     `done:no_acceptance` also fires on archived elements (ac-13's fixture
     archives done items that have empty acceptance). An archived element is
     history; nobody can act on a warning about its acceptance. Ruling: both
     `acceptance:no_checkbox` and `done:no_acceptance` apply to live
     elements only. The Oracle amends § 7, ac-13 and AC-49 (one leg for an
     archived done element with empty acceptance: no warning). Also stale:
     ac-17's PLACEMENT case "flat, then an unknown layout key" used an
     unknown key as its stand-in for an invalid config, which is no longer
     invalid after D166. It must use a genuinely invalid value instead.

168. **v3.7 accepted: second feedback round.** Passed verification:
     - A–D (rm --help, --add-tags/--remove-tags, statusFile docs,
       override-flag table): v3-7-ab.md;
     - E/F warnings, problems.ignore, config forward compatibility and the
       archived exemption: v3-7-tsk052.md.
     All 457 replay diffs vs oracle-frozen-12 fall into six accepted
     classes: leaf rule 171, new warnings 217, config:unknown_key 40, set
     hint 22, help 6, scratch call 1. The Lead re-ran AC-01/13/17/29/32/39/
     40/46/48/49: all pass; build:check is byte-identical; `nj --version`
     gives 3.7.0. Fixed along the way: `nj init` briefly wrote a `problems`
     block. The replay caught it, no AC did, and fcbb3b0 now pins init's
     config byte-exact. Also fixed: three stale failure-vocabulary lists in
     test/edge, and the § 9 tags prose.
     Known limit (Verifier): "ignored codes never affect readiness" holds
     but cannot be proven by a test today, because both eligible
     ready-blocking codes are confounded by the status check.
     Dogfooding: the show-shape trap (`entries[0]` vs `entry`) bit an AC
     author a second time, a candidate for later. Claims are held after the
     spec phase, so the next phase must steal them.
     TSK-049..052 and EPIC-015 are done; tag `v3.7`; `current` → 3.7.0.

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
- ~~**The `nj note` author is the element's `assignee`, else `?`**~~ **Closed.**
  § 10 now has `NJ_AUTHOR` (v3.1-A, D110/D111).
