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

        TSK-015 A  shared code to lib/, JSON_MODE -> output   done, c379170
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

    Recorded one commit late: `e46475e` carries this entry's title but was
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
    `c2-baseline` = `36dd9dc` (EPIPE fix, verified by Verifier II). `c1-baseline`
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
    Verifier, commit 1a74759). Verdict *pass with findings*: every number
    reproduced, the 19 replay diffs are exactly classes (a) (b) (d), and
    `scratch/verify.js`'s one extra ✗ is class (e) of DECISIONS 90. Perf:
    no regression against v2 in an interleaved A/B; absolute gate pending
    (DECISIONS 90). **c3-baseline = `a10b671`** (V3-1 plus its D90 follow-up,
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

96. **V3-1 delta `a10b671` verified** (docs/verification/v3-1.md, 8a38074):
    pass with findings; replay identical to `e5e5e3b`'s 19 named diffs; the
    FIFO `.njrc` that hung `e5e5e3b` is refused (F10). The remaining nits go
    to TSK-029: a self-linking `.njrc` (ELOOP) is reported with its own
    reason, not as "dangling"; a BOM counts only at the very start; a lone
    `\r` is `invalid_njrc` (§ 4 amended); an unsearchable ancestor of the
    cwd is `io_error` (F4 class). AC-21 covers the D90 cases since `28301b0`
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
     Oracle's AC-23 impact list, f0fdfa0):

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

101. **AC-24 ambiguities 71–74 ruled** (Oracle-B, 90966c5):
     *71* a v2 backlog reached through any source — search, `--backlog`,
     `NJ_BACKLOG`, `.njrc` — is `legacy_layout`: the backlog is there, only
     old. *72* `init` at a v2 backlog is `exists`, like any occupied target.
     *73* an empty `.nanojira/` is not "both present"; the ambiguity needs a
     v3 configuration or v3 tombstones. *74* an absent `.gitignore` is
     "otherwise": not created, a note says so; `doctor` on a legacy backlog
     runs every other check against the v2 places. The verbatim-line match
     ignores a trailing `\r`, and the replacement keeps the line's ending.

102. **The backlog README and placement under an invalid config** (the
     Oracle, while writing docs/GUIDE.md and docs/MIGRATION-v3.md, 9f4e331):

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
     db0b6ae; to be folded into docs/proposals/v3.1.md):

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
     them** (interim report on `448b7a8`):

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

107. **V3-3 accepted** (docs/verification/v3-3.md, 931f6ba: pass with
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

108. **V3-4 accepted** (docs/verification/v3-4.md, 0958c9c: pass). The
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
     (docs/verification/). `c4-baseline` = `oracle-frozen-9` = `ead3a32`:
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
     v3-1-a-nj-author.md, 8d96cce). Finding: `--id` together with `--file`
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
     8d96cce accept with notes; D111 delta 55eae0b accept). Gate at 77a8ac2:
     exit 0, replay unchanged, oracle 72/73 (the one gap is D98's root
     requirement). TSK-030 done. B (`nj unarchive`, TSK-031) starts:
     the Oracle promotes proposal § B into the spec first, with D104's
     rulings 75–83 as amended.

113. **V3.1-B replay diffs: one named class.** At e1f8ce7 the replay
     against c4-baseline differs in `nj help`, `nj --help` and `nj help
     --json` only (6 calls): the added `nj unarchive` line from § 9's
     command list. As in D88, consistency with the spec wins over "0 diffs";
     the replay is accepted only if the diffs are exactly that class, which
     the Verifier confirms independently. Gate otherwise green (oracle 73/74,
     the gap is D98), perf `--ab` vs 77a8ac2 within bounds. A stale AC-26
     case (ac26-mis-out, pre-amendment 82) was flipped by the Oracle in
     17e220e by applying 82; that was not a new ruling. *After B is
     accepted:* the replay baseline is re-recorded at the accepted commit
     and tagged `c5-baseline`, so C is gated against v3.1-B behaviour and
     not against the old help text.

114. **Claim-protocol review adopted** (docs/review/claim-protocol.md,
     5f4aebe: "sound with fixes"). All seven changes of its § 5 are taken
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

115. **Proposal § C (cc4bd64): two rulings.**
     - *Rollback restores what was read (D114 point 2, as the review
       states).* A plain claim read `unclaimed`/`released`, so its rollback
       appends `released N`. A re-assertion read its own `claimed N`, so
       its rollback restores `claimed N`: a failed mirror write must not
       give up a claim N held before the command ran. In effect a
       re-assertion has nothing to roll back. A steal is never rolled back
       (point 5). cc4bd64's "re-assertion is rolled back with `released N`"
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
     3a62430: accept). The replay diffs were confirmed byte for byte to be
     exactly D113's class: 6 calls, the one inserted help line, 4829 calls
     on both sides. The helper move into core/layout.ts is a pure
     relocation. TSK-031 done. *Next, in parallel because they share no
     files:* the Implementer re-records the replay baseline at the accepted
     behaviour and tags it `c5-baseline` (D113); the Verifier re-checks the
     revised proposal § C (99652e8) against the model before C is promoted
     (D114/D115).

117. **Proposal § C cleared for promotion** (docs/review/claim-protocol.md,
     "Re-check of revised § C", 000a969: ready to promote). All seven
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
     the flipped AC-25 N6 (`--as`, 236 checks) are at 88c9bf4, red against
     the current dist/nj as expected. AMBIGUITIES 84 (a third kind of file
     in a claims directory: asserted only as "must not crash a read") and 85
     (the unarchive straggler race: no hook to force it) are accepted as
     recorded gaps, not ruled further now. *Stale tests:* ac-01 asserts
     init's `.gitignore` has exactly two patterns, which b2d3f01 made
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
     (docs/verification/v3-1-c-claim.md, b03816e). core/claims.ts matches
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

123. **v3.2 proposal (2b153c7): open questions ruled by the lead.** The
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
     (docs/verification/v3-1-c-claim.md: b03816e accept; D121 delta 776b8a5
     accept). Replay against c5-baseline: 2,934 differing calls, exactly
     D121's four classes. The Verifier re-derived the counts in the delta
     and corrected two miscounts in its own first report: `.gitignore`
     third pattern 1,399, `_claim` 1,523, `note --as` 6, help 6. gate.js
     now prints the true total and a per-command tally. TSK-032 done.
     *v3.1 is functionally complete*; only TSK-033 (the quiet-machine perf
     measurement, folded into v3.2 E3 by D122) remains. *Next, in parallel
     because they share no files:* the Implementer records `c6-baseline` /
     `oracle-frozen-11` at the accepted state, and the Verifier reviews the
     ruled v3.2 proposal (074d309).

125. **v3.2 proposal review adopted** (docs/review/v3.2-proposal.md,
     1637b66: "needs changes", text only). Rulings:
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

126. **v3.2 proposal final (ab11e55); promotion starts with A.** The lead
     checked the text diff of the D125 fixes. One supersession: `nj check`
     uses `--on`/`--off` as the proposal writes them; D125's "`--uncheck`"
     wording is replaced, because the pair is symmetric and explicit.
     Backlog: EPIC-008 with TSK-034 (A) … TSK-038 (E). TSK-033 (perf) stays
     under EPIC-007, which closes when it is measured. Order: A → B → C → D
     → E, each spec → tests → implementation → verification → acceptance.

127. **AC-27 joins the replay's concurrent-suite allowlist (304f86b), at
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
     The Verifier audits 304f86b together with the c6 recording.

128. **`nj check` without `--on`/`--off` ticks; both given is
     `invalid_value`.** § 10a (e33c938) shows `[--on | --off]` as optional
     but does not say what neither flag means. Ticking is the command's
     name and its common case, so the default is `--on`. Both flags together
     are contradictory and are `invalid_value`, the same treatment as
     `--text` with `--item`. The Oracle adds one sentence to § 10a and the
     matching AC-28 cases. Unrelated sweep, also for the Oracle: the
     "every command" COMMANDS arrays in ac-17 and ac-24 lack `unarchive`,
     `claim`, `release` (since v3.1) and now `check`. They are completed so
     that the cross-cutting checks (`--backlog`, legacy migration) cover
     every command.

129. **V3.2-A verified (ae72808: accept); one delta: an empty `--text=` is
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
     (docs/verification/v3-2-a-check.md: ae72808 accept; D129 delta
     ae14501 accept). Replay against c6-baseline: 6 calls, all the
     inserted `nj check` help line (class *help*). TSK-034 done; B (stale
     claims, TSK-035) starts. *Baseline cadence for v3.2:* no
     re-recording after each feature. The gate's tally (D121) keeps the
     accumulating classes legible; each acceptance names its classes here;
     `c7-baseline` is recorded once, after v3.2 E is accepted.

131. **V3.2-B accepted** (docs/verification/v3-2-b-stale-claims.md,
     ae2452b: accept). Stale claims: `claims.staleAfterHours`,
     `claim:stale`; AC-29 43/43. The replay against c6-baseline is still
     exactly the 6 help calls from A, confirmed unclipped over the whole
     corpus, so the `_claim`/`_problems` key-order fix (fd4444c) is
     complete. *One text ruling:* `claim:stale` appears in the
     `_problems` of every entry `nj` returns (`list`, `show`, `tree`,
     bare `nj`, and the write results of `set`, `note`, …), exactly as
     `claim:mismatch`/`claim:orphaned` already do. The code stays; § 12's
     "doctor, list and show" is broadened, and AC-29 gains a case on a
     write result and on `tree`. That is a spec/test-only delta, so no
     re-verification of code is needed. TSK-035 done; C (`nj find`,
     TSK-036) starts.

132. **`nj find` spec (90425a0) reviewed: two notes.** (a) The Oracle
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
     independent verification (docs/verification/v3-2-c-find.md, 3c8a649:
     accept). Replay: the same 6 help calls (check and find lines), and
     `list` is provably unchanged (only applyFilters' export). `find` costs
     the same as `list` at 10k elements. TSK-036 done.
     *Incident:* the Verifier found the repo's own backlog/ (106 files,
     incl. .nanojira) deleted from disk, uncommitted. The lead restored it
     from git (`git checkout -- backlog`; doctor clean, 51 entries,
     nothing lost: the last backlog commit was 053f1fb and nothing wrote
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

136. **Batch writes (d1989ec): execution order and preflight output.**
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

137. **V3.2-D verified: needs changes (a33cab7).** The single-ID paths are
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
     (docs/verification/v3-2-d-batch.md: a33cab7 needs changes; b5d010e
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
     after `open()` (98c5919). D139 stands: the hook sits **between the
     path-level lstat and `open()`**, as f9e1e6b had it, because only there
     does a swap test the fd-based ownership check. After `open()` a swap is
     inert by POSIX and proves nothing. Kept from 98c5919: the hook is a
     **pure pause**. After the marker *or* the 10 s timeout, `nj` proceeds;
     it never aborts, so there is **no `fault:njrc-swap` code** (f9e1e6b
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

141. **Harness aee6539 sound; it surfaced 39 hidden claim/release diffs;
     D138's replay claim was incomplete.** The audit
     (docs/verification/harness-aee6539.md, 85fce91) confirms exactly the
     112 C5 calls are excluded and the gate is deterministic. gate.js pairs
     harness code with its own corpus, so the old tag is no mix risk. With
     AC-27's ordinary calls back in the byte replay, 39 `claim`/`release`
     calls differ from c6: the JSON key order of their single-ID output
     changed in the batch refactor (245bf6f/415e43d). The old whole-suite
     exclusion hid it. **D138's "replay: the 6 help calls" was therefore
     incomplete**, and this entry corrects it. *Ruling:* the key-order
     change was unintended. As in V3.2-B (fd4444c), the original order is
     restored, so single-ID `claim`/`release` output is byte-identical to
     c6. The Implementer does this as its own commit after the E work, and
     the gate tally must then show only the help class (plus whatever E
     itself names). Also: backlogLabel() should consider only the
     command's own cwd basename, not ancestors (a nested nj-gate-* root
     yields a spurious 'gate'); this is harmless today, so it is fixed with
     the same pass. `c7-baseline` is recorded after E's acceptance, as
     planned (D130).

142. **V3.2-E + D141 verified (6c65a50: accept); one narrow E.1 gap is
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
     replay exclusion per scratch backlog (aee6539/dd3ddd2, D127/D141) and
     the AC-27 before-compare rollback case pass verification
     (docs/verification/v3-2-e-gaps.md: 6c65a50 accept; D142 delta 083c33a
     accept). The gate at 63efa0f against oracle-frozen-11 shows exactly the
     6 help calls (check, find and batch lines), byte-confirmed; there are
     no other replay diffs since D141. TSK-038 and EPIC-008 are done.
     *v3.2 summary:* `nj check` (D130), stale claims (D131), `nj find`
     (D133), batch writes (D138), gaps (this entry). *Still open:* TSK-033,
     the absolute § 13 perf measurement on a quiet machine (the machine has
     been under foreign load: another process at 500 % CPU). *Next:*
     the Implementer records `c7-baseline` / `oracle-frozen-12` at the
     accepted state; then v3.3 (MCP wrapper, D122) starts with a proposal.

144. **v3.3 proposal (f8a08db): open questions ruled.**
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

145. **v3.3 proposal review adopted (bb7bd86: needs changes).** *Protocol
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

146. **v3.3 proposal final (ade4541); promotion into § 17 starts.** The
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

147. **§ 17 and AC-32..38 in place (741e897, e3e719b); the SDK client
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
     e9ad1a2: accept). AC-36 holds: the shared flag table (edf4032) leaves
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
     ARCHITECTURE describe v3.1–v3.3 and nj-mcp (8b6bd81, aeceb10, b430f30),
     including a "Many projects on one machine" section: one install serves
     every project; each project resolves its own backlog (§ 4); one
     nj-mcp server per project (§ 17). Every GUIDE example is now pasted
     from a real run (NJ_NOW pinned). The Verifier found 10 doc-side
     mismatches and no behavioural defect (a8b3911); all 10 are fixed and
     re-checked byte for byte (ed88d34). Still open: TSK-033 (quiet-machine
     perf) and, for the user to decide, a release tag or push.

150. **TSK-033 measured: the § 13 comfort bar holds at v3.3.** On a quiet
     machine (AC power, no Low Power Mode, foreign load below perf.js's
     bar; load average 1.7), `node tools/perf.js` at 90cef67 with 10,000
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

152. **V3.4 verified with one gap (1bc6e12): nj-mcp's startup arguments
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
     (docs/verification/v3-4-onboarding.md: 1bc6e12; D152 delta 3c423a6).
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
     `nj next` (§ 12b, AC-40 text, 82aed8d) is reviewed and accepted as
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
     features pass verification: docs/verification/v3-5-next.md (eb82d1b:
     20 processes × 8 elements × 3 rounds, exactly one winner per element;
     list/bare nj byte-unchanged) and v3-5-log.md (914b1df: never writes;
     tricky note text; the mutation tests discriminate). The AC-40 coverage
     gap the Verifier found (only 1/88 checks catches "any failure
     advances") is closed by N13 (37cb532, 95 checks). Docs (912c8c3) cover
     § 12c clarifications, GUIDE § 14/15, AGENT-INSTRUCTIONS (pick work with
     `nj next`) and README/ARCHITECTURE. Version 3.5.0 (e79be37). The Lead
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
     verification in docs/verification/v3-6-batch1.md (95709cf). Batch 2
     (per-command help, did-you-mean with OSA + length threshold, release
     docs) passed in v3-6-batch2.md (dc288a0). The Lead re-ran AC-32/39/40
     and 42–47: all pass; build:check is byte-identical; `nj --version` gives
     3.6.0. Replay vs oracle-frozen-12: 195 differing calls, all of them
     either the D158 leaf rule or help text; no did-you-mean diffs, because
     the corpus's only near-miss ("nope") is below the D160 threshold.
     The run-all "hang" was not reproduced. It is about 30 s of deliberate
     waits in three fault suites. Fixed along the way:
     - the test and harness fixture root is no longer os.tmpdir(), which
       had a foreign backlog as an ancestor (34c7db3, ff8a1fb);
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
     inside the folder, branch main, first commit a4b671a). The nanojira
     repo keeps ignoring it (46b7475), so no feedback commit enters the
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
     block. The replay caught it, no AC did, and cad3d25 now pins init's
     config byte-exact. Also fixed: three stale failure-vocabulary lists in
     test/edge, and the § 9 tags prose.
     Known limit (Verifier): "ignored codes never affect readiness" holds
     but cannot be proven by a test today, because both eligible
     ready-blocking codes are confounded by the status check.
     Dogfooding: the show-shape trap (`entries[0]` vs `entry`) bit an AC
     author a second time, a candidate for later. Claims are held after the
     spec phase, so the next phase must steal them.
     TSK-049..052 and EPIC-015 are done; tag `v3.7`; `current` → 3.7.0.

169. **The backlog moved into its own repository; main history rewritten
     without it** (2026-10-07, user: "Variante A"). Steps:
     1. Backup: a full copy in workspace/nanojira-backup-20261007/ plus
        nanojira-backup-20261007.bundle.
     2. `git filter-repo --subdirectory-filter backlog` on a clone gave the
        new backlog repository, 140 commits of its own history. It lives at
        `nanojira/backlog/`, a nested repository like `feedback/` (D162).
        The path is unchanged, so `nj` still finds it and nothing changes
        for the team. Local, ignored files (claims) were copied over, and
        the content is identical to the backup.
     3. `git filter-repo --path backlog --invert-paths` on the main repo.
        Its 536 commits became 444; the 92 that only touched the backlog are
        gone. Every hash changed. All 24 tags were rewritten to the new
        commits. The signed release tags v3.3–v3.7 were re-created and
        re-signed on their mapped commits.
     4. `/backlog/` is git-ignored in the main repo.
     5. Commit hashes in the current docs, verification reports and test
        notes were remapped old→new (658 references in 42 files) from
        filter-repo's commit map. Hashes in filenames
        (e.g. harness-a21f195.md) and historical commit messages keep the
        old value, except where filter-repo itself rewrote message hashes.
        Seven references point to removed backlog-only commits and keep
        their old hash: 2ca5c9f, 4afc759, 5b666a0, 5e1fe80, 62777f9,
        678a89b, efd4b69. The backup resolves them.
     From now on, backlog changes are committed in `backlog/` (its own git),
     and code, spec and docs in the main repo. This also ends the
     "dogfooding commits mixed into development history" noise.

170. **No assistant mention in commit messages; old messages cleaned** (2026-10-07,
     user: "In den Commit Messages soll der Assistent nicht vorkommen" … "alte
     commits bereinigen"). Standing rule for every repo: no
     `Co-Authored-By: …` trailer and no other mention. Cleanup:
     - a backup in workspace/nanojira-backup-20261007-pre-msgclean;
     - `git filter-repo --message-callback` on the main repo (446 commits),
       backlog/ (141) and feedback/ (5). It removed every assistant
       co-author trailer and reworded the one message that named
       AGENTS.md;
     - all trees are unchanged: every commit maps 1:1 by tree and
       timestamps;
     - tags v3.3–v3.7 re-signed on their mapped commits;
     - hashes in the current docs remapped again: 670 references in 43
       files, main and feedback commits.
     The D169 list of pruned pre-D169 hashes keeps its values, which
     resolve in nanojira-backup-20261007.

171. **v3.8: JSON input, done releases the claim, show's single entry**
     (2026-10-07, user: "setze alles um, wie du es für richtig hältst").
     - **A, JSON input (EPIC-014, both outside teams).**
       - `nj new --input=<file|->` and `nj set --input=<file|->` take a JSON
         object whose keys are exactly the command's flag names (the same
         flag table nj-mcp's schemas use). Lists are arrays; unknown keys
         are `unknown_field`.
       - `--input` and field flags are mutually exclusive; global flags
         (`--backlog`, `--json`) and `--as` stay allowed.
       - `new` also accepts an array, and an element may carry `children:
         [...]`, so a whole plan (epic → tasks → subtasks, review subtasks
         included) is one call. Children get their parent from the
         nesting; `depends_on` may refer to a sibling created in the same
         call through a local `ref` name.
       - The whole plan is validated before the first write. Writes then
         happen in plan order. A write failure stops the call and reports
         the ids already created; there is no silent partial success.
       - The Oracle pins the exact shape. The draft goes to both outside
         leads before tests are written.
     - **B, done releases the claim** (team-b-tests TSK-013; our own
       team showed the same pattern). Setting the final status (the last
       configured one, `done` by default) via `set` or `claim --status`
       releases the element's current claim in the same call, and the
       result reports it (`released: <holder>`, additive).
     - **C, `show --json` with one `--id`** additionally carries `entry`
       (the same object as `entries[0]`). It is additive and removes the
       list-shape trap that bit our own AC authors twice (D157, D168).
     Shelved: EPIC-013 (inbox). Kept for now: the two history backups in
     workspace/, which are cheap and deleted only on the user's word.
     Distribution via a remote still needs the user. Replay: the new
     classes allowed are help text, the additive `released`/`entry`
     fields, and nothing else.

172. **The --input draft is amended after review by both outside leads**
     (2026-10-07). Both checked it against real plans of their own, and the
     shape carries their work. Rulings:
     1. **No plan form for `set`.** Neither team needs one; `--id=A,B,C`
        plus one object covers it.
     2. **A ref must start with `@`**, both in `ref` and in `depends_on`.
        A ref without `@`, or a real id with `@`, is `invalid_value`. The
        draft's "a ref shadows a real id" rule is dropped: both leads named
        it a silent wrong-dependency trap.
     3. **The result carries `refs`** (`{"@impl": "SUB-047"}`) on success
        and, next to `created`, on a mid-plan failure.
     4. **Failure locator:** a mid-plan write failure and a validation
        failure both name the object at fault. The `failed_at` value is its
        ref if it has one, else its JSON path in the plan (e.g.
        `[0].children[1]`). This is the one additive field on an error
        result, scoped to `--input`; the Oracle words the exception to the
        no-extra-fields rule explicitly.
     5. **`--dry-run` for `new --input`:** runs the full validation, writes
        nothing, and returns the would-be shape without ids. Asked for by
        both.
     6. **`acceptance` may be a JSON array of strings** in `--input`. Each
        string becomes one `- [ ] …` line, so the acceptance:no_checkbox
        trap (D163 E) cannot happen through --input. A plain string stays
        as-is. Team B asked for it; it fits their TSK-011.
     The Oracle finalises the section (dropping the DRAFT marker), then
     writes the AC; the usual process follows.

173. **--input: a forward @ref is rejected at validation.** The Lead
     tried it live at d50b3fa: a plan whose "Review" task names
     `depends_on: ["@impl"]` while `@impl` is declared LATER in the plan
     passed validation, wrote everything, and stored `depends_on:
     ["undefined"]` (`depends_on:dangling`), with exit 0 and ok:true. That
     is a silent wrong dependency, exactly what D172 set out to prevent;
     AC-52 had no leg for it. Ruling: a `depends_on` entry `@x` must refer
     to a ref declared EARLIER in the plan's depth-first pre-order (the
     write order). Otherwise the call fails `invalid_value` before any
     write, with `failed_at` naming the referencing element and a hint
     that tells the caller to move the referenced element earlier. This
     is simpler than reserving ids up front and keeps "validated before
     the first write" true. The Oracle adds § 9 wording and AC-52 legs
     (forward ref rejected and nothing written; a backward ref still
     works; a ref to itself is rejected). The Implementer fixes the
     validator.

174. **--input failed_at gaps from the Verifier (v3-8-input.md).**
     1. *A fault-hook abort mid-plan* (`NJ_FAULT=after-tmp-write`) exits via
        hardExit with no `created`/`refs`/`failed_at`. Ruling: not a
        defect. Those hooks simulate a crash, and a killed process cannot
        report anything; the spec's promise is about write failures the
        process survives. The Verifier must instead prove the promise on
        a REAL catchable failure, e.g. a read-only `tasks/` or `subtasks/`
        directory so a later plan element fails with io_error after
        earlier ones were written. The Oracle adds that leg to AC-52.
        § 9 states the crash case plainly: after a crash, `nj doctor` and
        `nj list` show what was written.
     2. *Structural plan errors* (a non-object array member, null, a
        non-array `children`) are raised in flattenPlan outside the
        failed_at wrapper, so they have no locator. Ruling: a real gap,
        fixed. Every validation failure carries `failed_at`, which for
        these is always the JSON path. The Oracle adds legs; the
        Implementer moves the structural checks under the same wrapper.
     The two unticked TSK-053 criteria stay unticked until the delta is
     verified.

175. **v3.8 accepted** (2026-10-09). The Verifier's delta check of the
     D174 fix (692f3ef, docs/verification/v3-8-d174.md) passed: structural
     errors carry their JSON path in `failed_at`, a real read-only write
     failure mid-plan reports `internal_error` with `created`, `refs` and
     `failed_at`, `refs` lists only written elements, and the D173 assert
     still crashes loudly. Mutation tests confirm that the AC legs bite.
     The Lead spot-checked AC-39/50/51/52 and AC-32 (with `NJ_TEST_ROOT`),
     plus build:check. The gate stays at 540 differing calls in the
     accepted classes. The gate's ac-32-mcp-sdk CANNOT RUN without
     `NJ_TEST_ROOT` is the known environment gap, not a regression.
     TSK-053..055 and EPIC-014 are done. v3.8 is tagged and installed
     with tools/release-local.sh.

176. **v3.9 scope: reparent and done with open boxes** (2026-10-09). Both
     items come from outside-team feedback and were reproduced live on
     3.8.0.
     A. **`nj set --parent=<id>`** (team-b TSK-014). Moves an element
        under another parent. The id, the body, the notes and the claim
        log are kept. The type does not change: a task moves under another
        epic, a subtask under another task. A subtask↔task conversion would
        change the id prefix and is out of scope. The new parent must
        exist, be live (not archived) and be of the right type. Otherwise
        `invalid_value`. Epics take no `--parent`. `--input` accepts
        `parent` in `set`. `nj undo` restores the old parent. If the layout
        places files by parent, the file moves with it. The Oracle
        specifies the exact behaviour.
     B. **Warning `done:open_acceptance`** (team-c TSK-001). A live
        element in a final status that still has an unticked `- [ ]` line
        under `## Acceptance Criteria` gets a doctor warning, and `set` to a
        final status reports the same warning in its result. It does not
        block, and `problems.ignore` can silence it, as with
        `done:no_acceptance` (D163/D167). The `--json` result names the
        count (e.g. "1 of 3 unticked").
     Process as usual: Oracle spec + AC (red), Implementer, Verifier, Lead
     acceptance.

177. **D176 corrections before implementation** (2026-10-09).
     1. **There is no `nj undo` command.** D176's "nj undo restores the old
        parent" was a Lead error, and so was "undo restores the claim" in
        the answer note on team-b TSK-013. `undoRelease` is only the
        internal rollback of a failed `set`. Ruling: there is no undo
        criterion. Instead, `nj set --parent=<old>` moves the element back
        and restores the previous state (same file location, same
        frontmatter apart from `updated`). A correction note goes to
        TSK-013.
     2. **The error codes for `set --parent` mirror `new --parent`.** No
        uniform `invalid_value`: agents already handle the codes `new`
        uses for the same conditions. Missing parent → `not_found`, wrong
        parent type → `invalid_target`, archived parent →
        `refused:parent_archived`, `--parent` on an epic →
        `invalid_value` (as `new` does). Nothing is written in any of
        these cases. The Oracle adjusts § 9 and AC-53.

178. **Releases ship `nj.cjs`, with `nj` as a symlink to it** (2026-10-09,
     from a user question). The bundle is CommonJS (`format: 'cjs'`). For
     a file without an extension, Node picks the module type from the
     nearest package.json. Checked live on Node 24: `dist/nj` under a
     `"type": "module"` scope fails with `require is not defined in ES
     module scope`. That is why Team B stores it as `nj.cjs`. An ESM
     bundle would only reverse the problem. Ruling: from v3.9,
     tools/release-local.sh installs `nj.cjs` and `nj-mcp.cjs` plus the
     symlinks `nj -> nj.cjs` and `nj-mcp -> nj-mcp.cjs`. Node takes the
     module type from the target's extension, so `current/nj` works under
     any package scope (tested live). nj-mcp finds `nj` next to itself as
     before. `dist/` in the repo stays as it is. Releases already
     installed are immutable and stay unchanged.

179. **No symlinks in releases: wrapper scripts instead (replaces D178's
     symlinks)** (2026-10-09, user ruling). A release directory holds:
     - `nj.cjs` and `nj-mcp.cjs`, the CommonJS bundles (D178's reason
       stands);
     - `nj` and `nj-mcp`, POSIX sh wrappers:
       `exec node "$(dirname "$0")/nj.cjs" "$@"`;
     - `nj.cmd` and `nj-mcp.cmd` for Windows cmd/PowerShell:
       `@node "%~dp0nj.cjs" %*`.
     **`current` becomes a real directory of wrappers** instead of a
     symlink. It holds the same four names, and each one calls into
     `../<version>/`. A release rewrites each file via a temp file plus an
     atomic rename. `current/nj` keeps its path, so the teams change
     nothing.
     **nj-mcp finds its sibling by its own extension.** If it runs as
     `nj-mcp.cjs`, it spawns `nj.cjs` next to itself, otherwise `nj`
     (dist/). A shell wrapper is never fed to `node`. This is the only code
     change; the Oracle adds an AC leg (nj-mcp.cjs next to an sh-wrapper
     `nj` must still answer a tool call).

180. **v3.9 accepted** (2026-10-09). The Verifier passed the main check
     (docs/verification/v3-9.md) and the final delta (§ 11): set --parent
     incl. whole-folder moves and the compare-before-write guard,
     done:open_acceptance with exact counts, D179 release wrappers live
     under a `"type":"module"` scope incl. an nj-mcp tool call through the
     wrapper chain, and the article fixes. Mutation tests bite. Gate:
     1055 differing calls = the 540 accepted for v3.8 (22 now carry
     `parent` in the known-fields hint) + 496 done:open_acceptance + 19
     pure "a epic" → "an epic" wording changes. The Lead spot-checked
     AC-32/39/52/53/54 and build:check. Known cosmetic gap, deferred: the
     --input plan-nesting message still says "a epic cannot have a subtask
     child" (cmd-new.ts). TSK-056/057 and EPIC-016 are done. v3.9 is
     tagged and installed with the D179 wrapper layout; the first such
     install turns `current` from a symlink into a directory.

181. **current/nj is the bundle itself, not a wrapper (corrects D179)**
     (2026-10-09). The first real D179 install broke team-a at once.
     Their wrapper workspace/bin/nj runs `<their bundled node>
     .../current/nj`, which is exactly the interface D159 told teams to
     use, and `node` cannot parse an sh wrapper. The Lead caught it right
     after installing and fixed it in place within minutes: current/nj and
     current/nj-mcp were replaced with copies of 3.9.0's nj.cjs and
     nj-mcp.cjs, and `workspace/bin/nj --version` gives 3.9.0 again. The
     MCP path through `node current/nj-mcp` was tested too. Ruling:
     - `current/nj` and `current/nj-mcp` are plain copies of the bundles,
       written via a temp file plus an atomic rename. Nothing is a symlink
       (the user's rule holds). They run directly (shebang) and through
       any caller's own `node`. There is no package.json above
       bin/nanojira (checked), so the extensionless CommonJS file is safe
       there. The ESM-scope problem only hits people who copy the file
       elsewhere; they copy `<ver>/nj.cjs`.
     - `current/*.cmd` call into `../<ver>/`.
     - The version directories keep the D179 layout (`.cjs` + sh/.cmd
       wrappers).
     Lesson: a change to the install layout must be checked against every
     known consumer's real wrapper before the install, not only against
     our own calls. The 3.9.0 release directory's CHANGES.md copy still
     describes `current/` as wrappers. Releases are immutable, so
     docs/CHANGES.md in the repo carries the correction.

182. **v3.10 scope: doctor --fix releases claims on finished elements; the
     last "a epic"** (2026-10-09). team-a's backlog move turned up
     32 claim:stale warnings, all on elements set to done before 3.8. Only
     the holder could release them, so their cleanup loop had to pose as
     each holder (`release --as=<holder>`). A claim on a finished element
     serves no purpose: v3.8 already releases it on the transition to the
     final status.
     A. **`nj doctor --fix` releases every claim held on an element in the
        final status**, live or archived, whoever holds it. This is the
        same unconditional release as v3.8 B, recorded the same way in the
        claim log. Claims on unfinished elements are never touched by
        --fix, stale or not; for those, the holder or `--steal` still
        decides. Plain `doctor` without --fix keeps reporting them as
        before. The report names what was released. The Oracle specifies
        the exact output and the claim-log entry.
     B. **The --input plan-nesting message** ("a epic cannot have a subtask
        child") goes through the same article helper as the rest
        (D180 known gap).

183. **v3.10 accepted** (2026-10-09). Verifier PASS (docs/verification/
     v3-10.md):
     - doctor --fix releases claims on final-status elements, live and
       archived, any holder, through v3.8 B's releaseUnconditional;
     - unfinished claims are untouched;
     - plain doctor writes nothing, and --fix is idempotent;
     - a claim taken between scan and fix is released from its current
       holder, never a stale one (transition() re-reads every CAS round);
     - "TSK-404: released nobody" in the gate is a fixture's literal
       holder name, not a sentinel;
     - mutation tests bite.
     Gate: 1057 = 1055 + 2 holder-naming lines in ac-27's --fix fixtures.
     3.10.0 is the first two-digit minor version. minVersion compares
     numeric tuples, which the Lead checked live: 3.7.0/3.9.0/3.10.0 pass,
     3.11.0/4.0.0 give needs_newer_nj. AC-39 pins with exact equality only.
     Per the D181 lesson, the consumer paths were run against a scratch
     install before the real one, and team-a's workspace/bin/nj right
     after it. TSK-058/059 and EPIC-017 are done.

184. **Whole history re-signed** (2026-10-09, user decision). Commits made
     before 2026-10-09 were unsigned and carried host-derived emails
     (…@host2.example, …@host.example, …@host.local,
     …@example.com). The user asked for every commit to be signed with key
     E87870613F0E8704 and ehrlich.andreas@googlemail.com. All three repos
     (main 498, backlog 176, feedback 9 commits) were rewritten in place:
     - each commit re-signed, with author and committer email set to the
       googlemail address;
     - trees, names, dates and message text are unchanged, except that
       abbreviated hashes in commit messages now point to the new commits;
     - annotated tags were re-created with the same message and date and
       signed with the new key; lightweight tags were moved.
     Old hashes in file contents (this file, docs/verification/, backlog and
     feedback notes) were not touched; docs/history-resign-20261009.map
     resolves them. The pre-rewrite state is kept in
     ../nanojira-backup-20261009-pre-resign/ (bundles and .git copies).
     Consequences: tags v3.3–v3.10 are now different tag objects. The
     released files under bin/nanojira are byte-identical because the trees
     are unchanged.

185. **v3.11 scope: nj ships as a skill folder; no shared install
     directory** (2026-10-09, user: "deine ideen gefallen mir. aber
     workspace/bin/ wird heute gelöscht werden"). workspace/bin/ (with
     bin/nanojira/ and team-a's bin/nj) is removed today. D159's shared
     install ends: there is no common place to install into, and teams
     copy (vendor) nj into their own repos. Team B already does this.
     The model is taken from agent-skills (git-merge-branches with
     write-node-skills): the delivered unit is one self-contained folder.
     - **The folder.** `node tools/export-skill.mts <tag> <dest>` builds it
       **from the signed tag**, never from the working tree:
       - it first checks the tag with `git tag -v` and refuses an unsigned
         or bad tag;
       - it writes
         `<dest>/{SKILL.md, VERSION, bin/nj, bin/nj-mcp, bin/nj.cmd,
         bin/nj-mcp.cmd, dist/nj.mjs, dist/nj-mcp.mjs}`;
       - it builds next to the destination and then renames, so there is no
         half-written folder; an existing <dest> is replaced only if it
         holds a VERSION file (so it never overwrites a foreign directory);
       - the exported folder contains no symlinks.
     - **The bundle stays CommonJS with the .cjs extension.** Like .mjs,
       .cjs is unambiguous under any package.json, and it needs no ESM port
       (nj-mcp's sibling lookup, __dirname). In the repo, dist/nj and
       dist/nj-mcp stay as they are: the gate and the suites run them.
     - **Robust sh wrapper.** It is one template for both binaries, in the
       style of the agent-skills wrapper:
       - it finds dist/ from its own path (`dirname "$0"`) and is
         CDPATH-safe; it does not resolve symlinks, because there are none:
         nj is copied, never linked (user, 2026-10-09: "keine symlinks");
       - `NJ_NODE` picks a node binary, otherwise node from PATH;
       - it checks that node exists and is at least the minimum version;
       - it unsets NODE_OPTIONS;
       - if it cannot start, it exits 127 with one stderr line naming the
         cause;
       - `.cmd` wrappers do the same where cmd allows it (NJ_NODE, or node
         from PATH).
     - **SKILL.md is short and English:** when to use nj and when not, how
       to call it (`sh <skill>/bin/nj …`, always `--json`), the rules for
       agents, the exit codes, and where to report problems. Details stay
       in GUIDE/`--help`. The frontmatter has name, description (≤ 1024
       chars), license and metadata.version; the version must equal
       package.json, and a check enforces it.
     - **Tests.** A new AC exports into a scratch directory and runs the
       folder only through its wrappers:
       - from another cwd, with NJ_NODE, and from a copy of the folder
         moved to a new place;
       - an export that contains no symlink anywhere (`find -type l` is
         empty);
       - with node missing or too old (expect 127);
       - under a package.json with "type":"module" above the folder;
       - nj-mcp finding its sibling;
       - VERSION equal to `nj --version`;
       - refusals for a bad tag, an unsigned tag, and a <dest> without
         VERSION.

       This closes the gap that let D179 through: nothing has tested the
       delivered layout before.
     - **Retired.** tools/release-local.sh and the bin/nanojira README;
       both stay in git history only.
     - **Consumers.** team-a and team-c called workspace/bin/nj
       and must vendor before the removal. Until v3.11 they use a copy of
       3.10.0/nj.cjs; team-a was told today. Team B replaces its
       hand-made skills/nj with the exported folder when it chooses to.
     Addendum (user: "wieso nicht mit typescript ersetzen?"): the export
     tool is TypeScript, run as `node tools/export-skill.mts`. It needs no
     build step: node ≥ 22.18 strips types, and the repo already enforces
     erasableSyntaxOnly. tsconfig includes tools/**/*.mts so it is type
     checked. Why TypeScript:
     - it runs on Windows too (team-c), so no sh is needed to export;
     - it is the repo's language, with typecheck;
     - no shell quoting traps;
     - the AC can drive it like any other tool.
     It calls git (`tag -v`, `show`) through execFileSync without a shell.
     Only the two launchers that must start node stay sh and .cmd:
     bin/nj and bin/nj-mcp in the exported folder.
     Addendum 2 (user: "macht es sinn nach *.mjs zu kompilieren? alle
     unseren sonstigen skills werden doch dahin kompiliert"): yes. The
     bundle becomes ESM, written as dist/nj.mjs and dist/nj-mcp.mjs in the
     repo and in the exported folder. This replaces the "stays CommonJS
     with .cjs" point above.
     - **Why.** It matches the agent-skills Node skills (esbuild,
       dist/<name>.mjs, only node:* imports). Like .cjs, .mjs is unambiguous
       under any package.json. The layout changes for consumers in v3.11
       anyway, so the file name changes only once.
     - **Feasible.** src/ has no __dirname, __filename, require or
       module.exports, and nj-mcp uses no SDK.
     - **Changes:**
       - tools/bundle.js switches to format esm and writes .mjs;
       - the build also rejects any import other than node:* built-ins;
       - nj-mcp's sibling lookup becomes nj-mcp.mjs → nj.mjs;
       - test/run-all.js, the harness and the gate take the new path;
       - consumers move from nj.cjs to the exported folder's bin/nj.
     The extensionless dist/nj and dist/nj-mcp go away. Old tags keep
     their dist/nj, so the gate's frozen oracle replays keep working
     through --nj=<path>.
     Addendum 3: the file is tools/export-skill.mts. With .ts, node
     guessed the module type and printed a MODULE_TYPELESS_PACKAGE_JSON
     warning on every run. Adding "type":"module" to the repo would break
     the CommonJS tools/ and test/ scripts. The .mts extension makes it
     ESM without that.

186. **v3.11 accepted** (2026-10-09). Verifier PASS (docs/verification/
     v3-11.md, 14d4e9a):
     - export-skill.mts reads only from the tag, checks it with
       `git tag -v`, builds atomically and refuses a foreign dest;
     - no symlinks anywhere;
     - the wrappers honour NJ_NODE, the Node 24 floor and the NODE_OPTIONS
       unset, and print the § 18 stderr lines with exit 127;
     - nj-mcp fails fast when nj.mjs is missing.
     Mutation tests found three real gaps in AC-56: working tree vs tag,
     NODE_OPTIONS, and the version floor. They were closed in 9dbaddb, so
     all four mutations are now caught. A wording drift in the
     missing-node line was closed in c068edf and fff9fc0. The gate shows
     1057 calls with the same per-tag breakdown as v3.10, so the ESM switch
     changed no observable behaviour. The 8 frozen-suite FAILs are the list
     known since 886dd6a; a fresh frozen tag is due as follow-up.
     Lead checks against signed tag v3.11:
     - the export holds the 8 expected files and no links, and VERSION is
       3.11.0;
     - team-a style: their node through NJ_NODE on a copy of
       team-a-backlog gives list 70 entries and a clean doctor;
     - Team B style: `sh skills/nj/bin/nj` from the root of a copy of
       their repo gives list 500 entries and a clean doctor, and nj-mcp
       initialize answers;
     - NJ_NODE=/nonexistent gives exit 127 with the § 18 line;
     - GUIDE § 1 and CHANGES 3.11.0 match this behaviour.
     A process slip: TSK-060/061 were created with prose acceptance (no
     checkboxes); fixed in backlog c39dcce. nj accepted the prose without
     a hint, which is a candidate for a later version.

187. **v3.12 scope: the repo itself is the skill folder, built like
     agent-skills' Node skills** (2026-10-09, user: "Willst du dich nicht
     stärker an skills/write-node-skills und skills/git-merge-branches
     orientieren? bin/ fehlt zum Beispiel?"). v3.11 assembled the skill
     folder only at export time, so the launchers existed only inside
     exports and the suites ran dist/ directly. Following
     write-node-skills/git-merge-branches:
     - **Layout at the repo root:** SKILL.md (moved from skill/), bin/,
       dist/, src/, test/. bin/ and dist/ are committed build output.
     - **bin/ is generated.** tools/bundle.js renders bin/nj, bin/nj-mcp,
       bin/nj.cmd and bin/nj-mcp.cmd from template files tools/wrapper.sh
       and tools/wrapper.cmd. These are real files, so they can be read
       and diffed; v3.11 kept them as strings in export-skill.mts. Each
       generated file carries a "Generated by tools/bundle.js – do not
       edit" header. `bundle.js --check` fails when bin/ or dist/ differ
       from a fresh build.
     - **The build checks SKILL.md** the way write-node-skills' build.mjs
       does: name, description ≤ 1024 characters, license, and
       metadata.version equal to package.json. package.json gains
       `"engines": {"node": ">=24"}`.
     - **Tests use the real entry point.** test/run-all.js defaults to
       bin/nj, and the harness executes the given path itself instead of
       `node <path>`, so every suite goes through the launcher users call.
       The gate keeps supporting dist/nj.mjs and the old dist/nj for frozen
       steps.
     - **No VERSION file.** The version lives in SKILL.md
       metadata.version, as in agent-skills, and in `nj --version`.
     - **The export shrinks.** `node tools/export-skill.mts <tag> <dest>`
       keeps the signed-tag check, the atomic rename and the foreign-dest
       refusal, but now only copies SKILL.md, bin/ and dist/ from the tag
       tree. It contains no wrapper templates of its own.
     - **Deliberate deviations from agent-skills:**
       - the launcher does not resolve symlinks (user rule: no symlinks);
       - minimum node 24 (§ 3), not 20;
       - test/ stays the existing harness rather than node:test;
       - the nj CLI's JSON contract stays as it is (no RESULT: line).
     - **Not in scope, user's call:** moving nj into agent-skills as
       skills/nj built by write-node-skills itself, and an
       `--install-wrapper` like the agent-skills tools (a marker-line sh
       file instead of a PATH symlink).
     Addendum (Lead, after the first full run through bin/nj): two suites
     test nj's internals in a way the launcher deliberately rules out.
     Both run against the bundle (the dist/nj.mjs next to the bin/ under
     test); the launcher is not loosened.
     - **fault/det-id-retry.js** preloads a shim through
       NODE_OPTIONS=--require, and the launcher unsets NODE_OPTIONS on
       purpose (§ 18, AC-56 W15).
     - **D96 "unsearchable ancestor of the cwd"** (edge/hardening-v3-1.js)
       expects exactly one stderr line. Through bin/nj, /bin/sh itself
       prints "shell-init: error retrieving current directory …" before
       the script runs. No script content can prevent that line.
     The one-line rule (F4) is a contract of nj itself. § 18 states the
     limitation: through the sh launcher, the shell may add its own
     startup line in that pathological cwd case, and nj's own line stays
     the last line with nj's exit code. The D96 suite gets an extra
     bin/nj leg that asserts exactly that.

188. **v3.12 accepted** (2026-10-09). Verifier PASS (docs/verification/
     v3-12.md, 1a609eb). The repo is now the skill folder:
     - SKILL.md at the root;
     - bin/ is rendered by tools/bundle.js from tools/wrapper.sh and
       tools/wrapper.cmd, carries a header and is committed;
     - `bundle --check` covers dist/, bin/ and the SKILL.md frontmatter and
       version;
     - the export copies SKILL.md, bin/ and dist/ from the signed tag;
     - there is no VERSION file;
     - package.json declares engines node >= 24;
     - the suites run through bin/nj.
     The Verifier's four mutations were all caught: no bin/ render, no
     SKILL.md check, export from the working tree or with an extra file,
     and the harness secretly using node again. Running through bin/
     brought out three MCP suites that had copied nj-mcp without dist/;
     they now copy the shipped unit (1c3609b). It also showed two internals
     suites that cannot run through the sh launcher; per the D187 addendum
     they run against the bundle. AC-56 X2 reports CANNOT RUN without
     esbuild (d96e041). run-all gives 99/101 through bin/nj and
     dist/nj.mjs, with the 2 known gaps. The gate shows 1057 calls with the
     v3.11 breakdown, unchanged.
     Lead checks against signed tag v3.12:
     - the export holds 7 files, no links, and is byte-identical to
       `git archive v3.12 SKILL.md bin dist`;
     - bundle --check is clean;
     - team-a's node on their backlog copy gives a clean doctor;
     - the Team B copy with skills/nj replaced by the export gives
       list 500 entries and a clean doctor;
     - NJ_NODE=/nope gives exit 127 with the § 18 line;
     - our own backlog through `sh bin/nj` gives a clean doctor.

189. **Refactor-harness scratch probes clean up after themselves**
     (2026-10-09). The white-box probes in tools/refactor-harness/scratch/
     (bc, r3bc, r4, r4bc, r5, r6, r6bc, r8, …) create
     `<SCRATCH_BASE>/<label>-XXXXXX/backlog` fixtures with mkdtempSync and
     never remove them. About 320 had piled up in /tmp by today. From now
     on:
     - every probe removes the directories it created when it exits,
       including on failure and on an uncaught exception;
     - it removes only paths it created itself, never anything else under
       SCRATCH_BASE;
     - fixture contents, probe output and the closing verdict line stay
       byte-identical, so the baseline and the gate are unchanged;
     - a test shows that a probe run leaves no new entries under a fresh
       HARNESS_SCRATCH_BASE.
     This is tooling only: no nj behaviour, no version bump, no tag.

190. **History squashed to tagged commits only** (2026-10-09, user
     request, modelled on ehrlichandreas/bosun: one signed commit per tag,
     subject `nanojira <tag>: <title>`).
     - main is rewritten so that every remaining commit carries at least
       one tag. The 536 commits become 26: the 25 distinct tagged commits
       plus v3.12.1.
     - Each new commit keeps the exact tree of its tagged commit. The
       gate, the baseline and the export only use tag names, so they work
       unchanged.
     - Every tag keeps its name, type and message. Annotated tags are
       re-signed with the original tagger date; lightweight tags stay
       lightweight.
     - The commits after v3.12 (D188, D189) need a tag of their own. That
       tag is **v3.12.1**: a patch release with tooling only (the D189
       scratch-probe cleanup) and no change in nj's behaviour. It
       overrides "no version bump, no tag" in D189.
     - docs/history-squash-20261009.map maps every old commit to the tag
       of the squashed commit that now contains it (`<old-sha> <tag>`).
       Tag names are stable, while new hashes would change with every
       further rewrite. Old hashes quoted in DECISIONS, CHANGES and
       docs/verification resolve through this map, and older ones first
       through docs/history-resign-20261009.map.
     - backlog/ and feedback/ have no tags and stay untouched.
     - A `git bundle --all` of the pre-squash state goes outside the repo
       before the rewrite.
     - **Addendum (user request): anonymous time, as in bosun.** Commit i
       (1-based, oldest first) and its tags get `1970-01-(i+1) 12:00:00
       +0000` as author, committer and tagger date. The GPG signature time
       cannot predate the key, so it is pinned to the key's creation time
       plus 60 s (`gpg --faked-system-time`). It carries no work time.
       From now on every release tag squashes its untagged tail the same
       way, so main only ever holds tagged commits with anonymous time.

191. **v3.12.1 accepted** (2026-10-09). The Verifier gives PASS in
     docs/verification/d189.md (base, addendum 1 for the signal
     follow-up, addendum 2 for the bump and LICENSE).
     - D189: every scratch probe removes its own fixtures, on exit, on an
       uncaught exception and on SIGHUP/SIGINT/SIGTERM. SIGKILL is the
       documented limit.
     - Gate on f7f9f65: replay 1057 calls with the 8 known diffs; oracle
       phase 100/102 with the 2 known cannot-run; scratch-cleanup 32/32.
     - The bump to 3.12.1 changes version strings only. LICENSE (MIT)
       was added at the user's request; it is not yet in the export.
     Lead checks on the tagged tree:
     - bundle --check is clean;
     - `sh bin/nj --version` gives 3.12.1;
     - our own backlog gives a clean doctor (87 entries);
     - NJ_NODE=/nope gives exit 127 with the § 18 line;
     - AC-39 and scratch-cleanup are green.
     The history is then squashed per D190; docs/history-squash-20261009.map
     is in this commit.

192. **History cleaned before going public** (2026-10-10, user request).
     Before the first push to the public GitHub repo, every blob of all 26
     commits went through an ordered list of literal replacements:
     - local paths, a work address, names of other teams and their repos,
       machine names and tool/vendor names became neutral placeholders;
     - the fixture assignee was renamed to `coder-agent`.
     The list itself stays outside the repo on purpose. The c7 refactor
     baseline was re-recorded on the cleaned tree, because file hashes in
     the corpus change with the renamed fixture. The gate result stayed
     identical (1057 calls, the 8 known suites). The c1–c6 corpora were
     only text-replaced, so their per-file `nsha` values are stale; only c7
     is used for replay.
     - The owner's identity (name, public email, signing key) stays real,
       at the user's choice.
     - LICENSE (MIT) has been in every commit since the first one.
     - Hashes changed again. Tag names stay the stable reference.

193. **v3.12.2: test-harness cleanup, LICENSE in the export, releases via
     git-history-tools** (2026-10-10).
     - e54884c: test/lib/harness.js removes its fixtures on exit and on
       SIGHUP/SIGINT/SIGTERM, not only from T.finish(). Before, a crash or
       a kill left fixture dirs behind (20 found). The Verifier gave PASS:
       mutation, signal legs, and a run-all of 100/102 with the 2 known
       env cannot-runs.
     - The export also copies LICENSE, because consumers vendor the
       exported folder and need the licence text with it.
     - Tooling patch: no change to nj behaviour. Version 3.12.2.
     - From now on the release squash is done with
       ehrlichandreas/git-history-tools (`ght-squash tail --tag`), which
       replaces the Lead's private scripts. The date rule (1-based, root =
       1970-01-02) and the pinned signature time are unchanged.

194. **v3.12.2 accepted** (2026-10-10). The Verifier gives PASS in
     docs/verification/v3-12-2.md.
     - The bump changes version strings only.
     - The export writes LICENSE as a regular 0644 file, byte-identical to
       the repo's. A mutation that drops the copy turns AC-56 red.
     - Gate on 881ee05: replay 1057 calls with the 8 known suites; oracle
       phase 100/102 with the 2 known env cannot-runs.
     The Lead ran a leak scan with the D192 term list, kept outside the
     repo. Its only hit was a pattern list in the verification note, which
     is now worded abstractly. All other hits are known placeholders,
     synthetic test data or registry URLs.
     The release is squashed with `ght-squash tail --tag=v3.12.2`.

195. **SKILL.md slimmed; rarely needed text moves to `references/`; GUIDE
     gains umbrella tickets** (2026-10-18, scans feedback TSK-009, TSK-010,
     TSK-012).
     - SKILL.md is loaded on every use. At 90 lines / 5.6 KB (~1400
       tokens) it cost every call; scans asked for about 1000 tokens. It
       is now 55 lines / 3.4 KB. The daily loop and the rules stay; the
       packaging details, the no-symlink rationale, "when it does not
       fit" and the bug-report process move verbatim to
       `references/packaging-and-feedback.md`, which SKILL.md names.
     - `tools/export-skill.mts` ships `references/*.md` from the tag's
       tree (spec § 18). AC-56 checks the exported set is byte-identical
       to the repo's and that SKILL.md names every file; a mutation that
       drops one file turns it red.
     - SKILL.md mentions `--quiet`/`--fields`, `note --text=` and the
       `"problems": {"ignore": [...]}` list (TSK-010: scans agents treated
       `incomplete:acceptance` on every write as noise because they never
       found the ignore list).
     - GUIDE § 26 shows umbrella tickets as parents, so the existing
       `refused:children_open` guard stops an umbrella from being closed
       while its parts are open (TSK-012). No code change.

196. **`show --notes=none|all|last:N` and `log --last=N`** (2026-10-18,
     feedback/scans-team TSK-005). A long-running ticket collects 20+
     notes; agents were grepping the `.md` file directly for the latest
     one or two, bypassing the tool the same way TSK-004's agents piped
     write results through `head`/`grep` (§ 9 "`--fields` / `--quiet`").
     `show` and `log` gained a matching pair of flags instead (§ 9
     "`--notes` / `--last`", § 12c):
     - `show --notes=none|all|last:N` narrows how many notes the body
       shows; `all` (omitted or given explicitly) shows every note.
       `none`/`last:N` replace the `## Notes` section's *displayed*
       content (never the file — `show` never writes) with a
       placeholder line naming how many notes are hidden, followed by
       the kept notes, re-rendered byte-identical to their stored form.
     - In `--json`, giving `--notes` **at all** — `all` included — adds
       `notes`/`notes_total` to `entry`; omitting the flag entirely keeps
       the shape exactly as it was before this round. That is the one
       deliberate difference between the omitted default and
       `--notes=all` given explicitly: both show the same notes, but
       only the latter also hands back `notes_total`.
     - `log --last=N` keeps the last `N` events of the already-merged
       list, any kind at once (not per kind), and adds `events_total` —
       the real, unfiltered count — the same additive-only-when-given
       rule.
     - Both validate `N` as a positive integer *before* the target even
       resolves — a bad value wins over an unresolved `--id`, the same
       "a bad value first" ordering every other flag-value check in this
       project already has. `show --notes=` additionally gets a
       did-you-mean against `none`/`all`/`last:N`, reusing
       `core/suggest.ts`'s existing OSA-distance machinery with no new
       synonym table, the same way `--fields` already does for its own
       closed vocabulary.
     - On a `duplicate_id` target, `--notes=` narrows each file's own
       entry independently — one file's note count never affects
       another's.
     New test: `test/ac/ac-60-show-notes-last.ts`.

197. **`--dry-run` on every write command** (2026-10-18, scans TSK-007).
     The scans team must probe every tool before applying it. The flag
     and its shapes are pinned in § 9 "`--dry-run`", because scans will
     copy them verbatim into a second codebase.
     - **Design: a scratch copy, not a recording write layer.** The
       obvious design is a write layer that records instead of writing.
       It was rejected for two reasons:
       - A call reads back what it wrote. The `STATUS.md`/`TAGS.md`
         refresh rescans the tree. A plan allocates ID after ID.
         `archive` plans its moves against folders it created.
         `doctor --fix` reloads its context between ten steps. A
         recording layer would need a read overlay as well, covering every
         `fs` call in `load.ts`, `layout.ts`, `claims.ts`, `config.ts` and
         `cmd-doctor.ts`, or its results would drift from the real call's.
       - Its no-write guarantee holds only while every writer goes
         through the switch. A raw `fs` call added later writes for real
         without any error.
       Instead, `context()` (and `init`) hand the command a copy of the
       backlog in `$TMPDIR`, and the unchanged command runs against it.
       Fidelity holds by construction: results, refusals, IDs and
       `STATUS.md` are the real code's own output. The guarantee is
       structural: no command code ever sees the real path. A future
       writer would have to rebuild that path on purpose to escape.
       `changes` is the difference between the two trees. stdout is held
       back until the copy has been compared; then the copy's path is
       mapped back to the real one, and `dry_run`/`changes` are appended.
       Cost: one copy per dry run, linear in the backlog's size. That is
       acceptable for an explicit probe; normal calls pay nothing.
     - **Full contents, not a unified diff.** Two diff implementations
       can produce different hunks for the same change, so a second
       codebase could never match a diff byte for byte. `{path, kind, op,
       before, after}` with complete text is canonical, and a caller can
       apply it directly.
     - **Every write command, including `init` and `doctor --fix`.** The
       copy makes both cost nothing extra. Read commands reject the flag
       as `unknown_field`, like any flag they do not take. Plain `doctor`
       rejects it as `invalid_value`, because a dry run of a command that
       never writes would be the silent no-op the task forbids.
       `--dry-run=<value>` is `invalid_value`: `--dry-run=false` must not
       quietly mean a dry run. `checkFlags` grants the flag to every
       `isWrite` command, so a new write command gets it automatically.
       `init` and `doctor` list it themselves.
     - **`--quiet`/`--fields` compose; `dry_run`/`changes` are never
       trimmed.** The two flags trim the real result. The dry-run keys
       are appended afterwards, because a probe without its answer would
       be useless.
     - **IDs are reported, never reserved.** They are allocated in the
       copy. The spec says the real call may get different ones.
     - **Not an MCP field.** It is a control flag, as `--quiet`/`--fields`
       are today. Exposing it in `nanojira-mcp` is a separate decision.
     - **Supersedes D172 item 5.** `new --input= --dry-run` returned its
       own id-less shape (`{ok, dry_run, entries}`, implied parents as
       JSON paths), refused `--dry-run` without `--input`, and `set`
       rejected the flag. All three are gone. A plan's dry run now returns
       the plan's real result with would-be IDs. ac-52's F legs were
       rewritten to match. This changes the output for anyone parsing the
       old shape, which is why it is recorded here.
     - **Tests (ac-61, 353 checks).** Every supported command runs twice
       on identical fixtures: once as a dry run, once for real. The test
       asserts:
       - the dry-run backlog is byte-identical: file list, and for every
         path its kind, mode, size, mtime and bytes, directories included;
       - exit code, stderr and JSON equal the real call's;
       - `changes` equals the real call's actual effect, derived
         independently from the two trees;
       - no scratch copy is left in `$TMPDIR`.
       Mutation-tested: each of these makes ac-61 fail (M1–M11 in the
       TSK-007 report):
       - bypassing the copy in `context()`, in a second `context()` call
         (doctor's reload), or in `init`;
       - letting one writer (`STATUS.md` refresh, tombstone allocation,
         claim append, element write) write through to the real path;
       - leaving the copy behind;
       - an always-empty `changes`;
       - not mapping `--file`;
       - a copy that does not keep mtimes (`doctor --fix` fills a missing
         `created`/`updated` from the mtime).

198. **TSK-008: `NJ_NOW` audit — one clock module, everything else named
     explicitly** (2026-10-18).
     - `NJ_NOW` (§ 12, D125/D130) already existed and was already the sole
       path for every WRITTEN timestamp — `core/store.ts`'s `nowIso()`/
       `nowMs()`, used by every command that writes `created`, `updated`,
       `archived` or a claim entry. This round is an audit, not a new
       feature: every `Date.now()`/`new Date(` in `src/` was found and
       classified, not just the ones already known about.
     - Two real-clock reads outside `core/store.ts` are correct as-is and
       stay on the wall clock: `core/config.ts`'s `njrcSwapFaultHook`
       (an `NJ_FAULT=njrc-swap` poll deadline — bounds a wait, writes
       nothing) and `core/context.ts`'s `loadedAt` (STATUS.md's own
       ctime-margin bound, DECISIONS 103 — compared only against a real
       filesystem `ctime`, which `NJ_NOW` cannot touch). Pinning either to
       `NJ_NOW` would be wrong, not merely unnecessary.
     - New: `test/ac/ac-62-nj-now.ts`. Leg 1 runs a full command sequence
       (init/new/set/note/claim/check/release/archive) twice from scratch
       under the same `NJ_NOW` and asserts the two backlog trees are
       byte-identical. Leg 2 is a static guard over `src/`: an exact,
       named count of every raw `Date.now()`/`new Date(` outside
       `core/store.ts` — a new one anywhere, or an old one's count
       drifting either direction, fails loudly instead of blending in.
       Mutation-tested both ways: a raw-clock bypass added to a command
       file is caught by the guard even though the two runs still happen
       to land in the same real second; a real-clock bypass planted
       inside `store.ts` itself (so the guard can't see it) is caught by
       leg 1 instead, landing in different real seconds and diverging in
       `archive/*.md`'s `archived:` stamp.
     - `docs/GUIDE.md` § 29 and a `help.ts` line document `NJ_NOW`
       explicitly as a verification/testing hook, not a feature for daily
       use — consistent with how § 12 of the spec already framed it.
     - Worktree `nanojira-wt/tsk008-nj-now`; no change to `src/core/claims.ts`'s
       staleness arithmetic, the ids allocator's retry loop, or sort-by-`updated`
       ordering — none of them read the clock in a way this round needed to touch.

199. **`test/run-all.ts` runs test files in a worker pool; `@serial` marks
     the ones that must run alone** (2026-10-18).
     - Why: the oracle ran its 107 files strictly one after another. A
       full run took 17:44 on a 12-core machine, and several agents kept
       waiting on it.
     - `--jobs=<n>`, else `NJ_TEST_JOBS`, else
       `min(os.availableParallelism(), 8)`. A bad value is exit 2. The
       argv contract (`NJ` env or the first non-`--jobs=` argument), the
       summary, the exit code and the passed / failed / cannot-run rule
       are unchanged.
     - `--jobs=1` is the old loop, byte for byte. This was checked against
       main's runner with stub suites, including a timed-out one.
     - Output: each file's stdout+stderr is buffered and printed as one
       block, in collected order, as soon as every earlier file in the
       pool is done. Pooled files use async `spawn` with `spawnSync`'s
       observable contract: stdin closed, stdout then stderr, SIGTERM and
       a null status on the 600 s timeout or past the 64 MiB cap. Which
       phase ran a file therefore cannot change its verdict.
     - `@serial`: a comment line in a file's header, before the first
       `import`, starting with `@serial: <reason>`. Such files run after
       the pool has drained, alone, in collected order, through the same
       `spawnSync` as `--jobs=1`. The marker lives in the file, not in a
       list in the runner. `test/README.md` documents the marker and the
       isolation rules.
     - Nine files are marked:
       - Seven race a fixed 1 s sleep against nj reaching the
         `NJ_FAULT=before-compare` hold: ac-26, ac-28, ac-31, ac-40,
         `fault/nj-fault-before-compare`, `edge/archive-ac20-write-paths`
         and `edge/failure-vocabulary`. The hook gives no "ready" signal,
         so a test cannot know nj has reached it. Under load nj arrives
         late, reads the already-planted change and exits 0, a false red.
       - ac-07 (`stress/concurrency.ts`) starts 300 nj processes at once
         and starves its neighbours.
       - `edge/hardening-v3-1` runs a busy-loop swapper beside 500 nj
         runs, each with a 5 s hang limit.
     - Fixed instead of marked: a timeout too tight around a fixed hook
       wait, or an elapsed-time window too narrow:
       - ac-27 C4: 15 → 30 s around the 10 s hold.
       - `fault/fault-hook-json`: 15 → 30 s.
       - ac-32-mcp M12b: 5 → 15 s, which also covers the MCP server's
         cold boot.
       - `edge/hardening-njrc-swap` S2: upper bound 16 → 19 s, still
         below a doubled wait.
       - `edge/refactor-harness-scratch-cleanup`: 120 → 300 s per probe.
     - Isolation audit of every collected file plus `stress/`: no file
       writes into the repo, `node_modules` or a fixed path. None lists
       `/tmp`, uses a port or touches global git config or the real
       `$HOME`. Fixtures come from mkdtemp or clones, and `HOME` is pinned
       wherever it is read. `tools/release-regression`'s two runs with
       cwd in the repo exit before writing.
     - Measured on 12 cores, with other agents keeping the load average
       at 4–10:
       - Serial: main's runner took 17:44; `--jobs=1` with the new runner
         took 18:16.
       - Pooled at 8 jobs: four runs of 8:27, 8:25, 7:36 and 7:48, about
         2.2× faster. Each run is roughly 4:20 of pool plus 4:00 of
         serial tail.
       - All four pooled runs and the `--jobs=1` run gave the same
         passed / failed / cannot-run sets as the baseline: 103 / 2 / 2.
         The two failures are `edge/hardening-v3-1` and
         `edge/v3-2-regressions`; the two cannot-runs are ac-15 and
         `edge/hardening-njrc-foreign-link`.
       - Classification check, in a scratch copy: a failing check planted
         in ac-05 (pooled) and in `edge/failure-vocabulary` (serial)
         turned both into "failed". Each output block stayed intact and in
         its collected place.
     - Follow-up, not done here: the serial tail is about half of a pooled
       run. If the `before-compare` hook wrote a ready marker before it
       starts polling (a § 12 change), the seven racing files could wait
       for that marker instead of sleeping 1 s and join the pool.
       Only ac-07 and hardening-v3-1 would stay serial.
     - Worktree `nanojira-wt/test-parallel`.

200. **TSK-011: `NJ_ON_CHANGE`, an environment-only change hook** (2026-10-18,
     scans feedback TSK-011; owner decision).
     - The problem: scans keeps nanojira and an outside board, and the two
       drifted (done here, in progress there). They proposed `--on-change=`
       or a config hook.
     - **Owner decision (binding): environment only.** `NJ_ON_CHANGE=<cmd>`
       is the sole way to arm it — no flag, no `.nanojira/config.json` key,
       no `.njrc` entry, nothing in the backlog. A hook read from the
       backlog would make every cloned or foreign backlog able to run code
       on the machine of whoever runs `nanojira list` in it; the
       environment belongs to the caller, so the value is trusted exactly
       as much as `PATH`. A hook-like key in config stays an ordinary
       `config:unknown_key` warning and is never executed (AC-63 I).
       `core/on-change.ts` imports neither config nor fs (AC-63 J guards
       that statically). No network inside nanojira: the hook does the
       pushing.
     - **Fires** after every successful write, once per invocation: `init`,
       `new` (flags or `--input`), `set`, `note`, `check`, `claim`,
       `release`, `next` (when it claims), `archive`, `unarchive`, `rm`
       (and `--cascade`), `doctor --fix` (only when `fixed` is non-empty).
       Found by grepping every command for a file write, not from memory;
       reads write nothing (STATUS.md/TAGS.md are only refreshed by
       writers). No-op results (`changed: []`) fire too: they are
       successful write calls, and "fires on every `ok: true` result" is
       easier to rely on than a second notion of "really changed"; the
       hook can look at `changed`.
     - **Partial success fires.** A batch with a runtime failure, or a
       `new --input` plan that stopped part way (D174), has written
       something, so the hook fires with that very result (`ok: false`
       at the top) and `NJ_HOOK_IDS` names only what was written. Not
       firing would leave exactly the drift this exists to prevent. A
       batch preflight abort, a plan that fails validation or its first
       write, and every `fail(...)` path wrote nothing and never fire.
     - **Never fires** on a read, a refusal, `--dry-run`, or inside a hook.
       `--dry-run` (TSK-007, D197) runs the real writer against a scratch
       copy, so a writer under a dry run DOES reach `recordChange` — with
       the copy's path, which is gone before a hook could start. Two
       independent guards: `beginOnChange` never arms when the raw flags
       carry `--dry-run` (the only way `checkFlags` arms a dry run), and
       `recordChange` drops anything while `isDryRun()`. AC-63 K runs a
       real dry run of every writer, prose and JSON, plus dry runs that end
       in a refusal: no call, real tree unchanged, stdout/stderr identical
       to the same dry run without a hook. Because the guards are
       redundant, removing one alone is invisible to K (verified: a bundle
       mutant of either alone passes K); each is pinned by a static check
       in AC-63 J (each source mutant turns J red), and the bundle mutant
       removing both turns K red (32 checks: the hook fires against the
       vanished scratch copy and warns on stderr).
     - **Shape.** `/bin/sh -c "$NJ_ON_CHANGE"`, cwd = backlog root; stdin =
       the full `--json` result as `--json` prints it, never trimmed by
       `--quiet`/`--fields`, whatever the caller passed. One call per
       invocation, a batch passes its whole `{ok, results}`: the hook sees
       exactly what a `--json` caller sees, and one call per element would
       have needed a second, invented per-element shape. Env adds
       `NJ_HOOK_COMMAND`, `NJ_HOOK_IDS`, `NJ_BACKLOG` (absolute), and
       removes `NJ_ON_CHANGE`/`NJ_ON_CHANGE_TIMEOUT`.
     - **Implementation: one result, built once.** Every writer now builds
       its full result object unconditionally, records it with
       `recordChange()`, and prints that same object for `--json` — so the
       hook's stdin and `--json` stdout cannot drift apart (AC-63 A
       compares them byte for byte for every writer). Where only a
       `buildWriteResult` call existed under `if (json)`, the record call
       passes a thunk, built only when the hook is armed. `main()` arms the
       hook before dispatch; the top level fires it only if `main()`
       returned — a thrown failure never reaches it.
     - **Timing.** The hook runs after the command returned: every write,
       claim generation, `STATUS.md`/`TAGS.md` refresh and the stdout result
       are done, so nothing is locked and the backlog is consistent (AC-63
       G runs `show`/`doctor` from inside a hook). nanojira waits for it,
       so when nanojira returns the hook is done.
     - **Failure: warning on stderr, exit code and stdout unchanged.** The
       write did succeed; turning a hook failure into exit 1 would tell an
       agent its write failed and invite a retry of something already
       done. The hook's stdout and stderr both go to nanojira's stderr, so
       a `--json` caller always gets one parseable document. Nothing is
       ever undone or retried because of a hook.
     - **Recursion guard: both mechanisms.** `NJ_ON_CHANGE` is removed from
       the hook's environment, and a nanojira that sees `NJ_HOOK_COMMAND`
       never fires, so even a hook that re-exports `NJ_ON_CHANGE` before
       calling `nanojira note` cannot loop (AC-63 G, both variants).
     - **Timeout.** `NJ_ON_CHANGE_TIMEOUT`, whole seconds 1–86400, default
       10 (86400 keeps `setTimeout` well inside its 2^31 ms limit). The
       hook runs detached as its own process-group leader and the timeout
       sends SIGKILL to the whole group, so a grandchild (`sleep 60 &
       wait`) dies too — otherwise it would hold the caller's stderr pipe
       open long after nanojira returned. An invalid value is
       `invalid_env` before anything is written, the NJ_NOW discipline,
       but only when the hook would be armed: with no hook, nothing reads
       the variable and output stays byte-identical. SIGINT/SIGTERM/SIGHUP
       to nanojira while it waits kill the group first.
     - The test harness (`runPath`) now strips `NJ_ON_CHANGE`,
       `NJ_ON_CHANGE_TIMEOUT`, `NJ_HOOK_COMMAND` and `NJ_HOOK_IDS` from the
       environment it inherits: a suite run from a shell that has a real
       hook must not push fixtures to a real board, and one run from
       inside a hook must not have every hook test silently disarmed.
     - New: `test/ac/ac-63-on-change-hook.ts` (550 checks with the K
       dry-run leg), marked `@serial` (D199): leg F asserts elapsed time
       around a 1 s hook timeout. RED against the
       pre-change bundle (66 of 212 checks failed; it then crashed reading
       a capture file, now fixed to report). Ten mutants, all killed:
       `doctor --fix` with no fix firing, batch preflight abort firing, a
       plan's validation/first-write failure firing, firing after a thrown
       failure, hook stdout routed to stdout, hook failure setting exit 1,
       kill without the process group, no `NJ_HOOK_COMMAND` guard, a bad
       timeout falling back to the default, compact JSON on stdin.
     - Docs: SPECIFICATION § 9 "`NJ_ON_CHANGE`" (plus a failure-code row and
       § 3's "no network" line), GUIDE § 30, a `help.ts` env line;
       AGENT-INSTRUCTIONS and GUIDE § 14 no longer say "no hooks": no
       daemon, no network; an optional env-only hook can push outward.

201. **`NJ_FAULT_READY` for the `before-compare` hook; the racing suites
     join the pool; `@slow` starts the longest files first** (2026-10-18,
     the D199 follow-ups).
     - Why: after D199, the serial tail (about 4 of a pooled run's 8
       minutes) was mostly seven files that slept 1 s and assumed nj had
       reached the `before-compare` hold by then. Nothing in the hook said
       so.
     - `src/core/store.ts` `compareGuard`: if `NJ_FAULT_READY=<path>` is
       set, the hook writes `<path>` (the held element's ID and a newline)
       before it starts polling, and so before the 10 s starts. If that
       write fails, the command exits 1 with `fault:before-compare`, as on
       the timeout.
     - Without the variable nothing changes: the read happens only inside
       the existing `NJ_FAULT === 'before-compare'` branch. Spec § 12
       says so. It is still a verification hook, not a feature.
     - Why a file and not a stderr line: a stderr line would change the
       output of every existing `before-compare` run, the opposite of
       opt-in. Why the file sits outside the backlog: tests snapshot the
       backlog tree byte for byte. `H.faultReady()` creates the file in a
       fresh directory.
     - `H.faultReady(label)` returns `{ env, file, wait(done) }`. `wait`
       polls every 10 ms. It returns false if the child exits first or 30 s
       pass, so a broken hook fails a named check instead of hanging. The
       seven files now use it instead of `sleep(1000)` and lose `@serial`:
       ac-26 (2 legs), ac-28 (2), ac-31 H17, ac-40 N13,
       `fault/nj-fault-before-compare` (2), `edge/archive-ac20-write-paths`
       and `edge/failure-vocabulary`.
     - `fault/nj-fault-before-compare` also pins the new contract: the
       ready file holds the ID, and an unwritable `NJ_FAULT_READY` exits 1
       with `fault:before-compare` at once, without the 10 s poll.
     - ac-31 H18's elapsed bound goes from 16 to 19 s. It includes nj's own
       start, and 19 s is still short of a doubled wait. Only ac-07 (a
       300-process burst) and `edge/hardening-v3-1` (a busy-loop swapper)
       stay `@serial`.
     - Mutation checks:
       - main's `nj-fault-before-compare` (1 s sleep) against an nj that
         starts 2.5 s late, which is what load looks like: 5 of 10 checks
         fail ("expected exit 1, got 0"). The new version passes against
         the same nj.
       - A mutant bundle that writes the ready file at process start,
         before its first read, then pauses 1.5 s: the new test goes red,
         5 of 17 checks.
       - The same early marker without the pause is not reliably caught.
         The real first read follows within milliseconds, faster than the
         10 ms poll. This bounds what the test can see; it is not a gap in
         the hook.
     - `@slow` (`test/run-all.ts`): same header syntax as `@serial`. Marked
       files are dispatched first within the pool. Print order, verdicts
       and `--jobs=1` are unchanged.
       - Marked: ac-26, ac-27, ac-17, ac-25, ac-22 and
         `edge/refactor-harness-scratch-cleanup`, each 60–140 s pooled.
         Before this, the pool's last file was always refactor-harness:
         collected late, started at about 140 s.
       - `NJ_TEST_TIMES=<file>` writes every file's wall time (TSV, slowest
         first) so the list can be re-measured. Stdout is unchanged.
       - Rejected: a committed timings file. It is a second artefact that
         goes stale silently, and it does not live in the test file like
         `@serial` does.
     - Measured at 8 jobs on 12 cores. Several other worktrees were running
       their own suites at the same time, so the load average was 8–27.
       - D199's runner on this tree: about 8 min.
       - With the ready marker and no `@slow`: 4:47 (pool 240 s, serial
         tail 47 s).
       - With `@slow`: 4:23 at load 16, 4:44 at load 12–14, and 6:54 at
         load 22.
       - All four runs gave 105 passed / 2 failed / 2 cannot-run, the same
         as main's baseline. The failures are `edge/hardening-v3-1` and
         `edge/v3-2-regressions`; the cannot-runs are ac-15 and
         `edge/hardening-njrc-foreign-link`. Each log has 109 whole blocks.
       - In the slowest run, ac-26 alone ran 275 s from t=0 and was the
         whole critical path. No dispatch order beats that; splitting
         ac-26 is the next lever if one is wanted.
     - ac-63 (D200, merged meanwhile) loses `@serial` and gets `@slow`.
       Its leg F times a 1 s `NJ_ON_CHANGE_TIMEOUT` against a hook that
       sleeps 60 s. The lower bound (≥ 0.9 s) only gets safer under load;
       the upper bound goes from 15 to 19 s, because nj's start counts
       too. It needs no ready marker. At 130–210 s it was the largest
       item in the serial tail.
     - Worktree `nanojira-wt/test-speed-2`.

202. **Release tooling fixes from the 4.1.0 release rehearsal** (2026-10-18,
     Lead decisions on the rehearsal report; snags A, B, D–J).
     - The rehearsal (a scratch clone, a throwaway signing key, never the
       real repo) ran `tools/release.ts` for 4.1.0 end to end and found the
       gate could not go green and `--apply` could fail after writing.
       Snag C (hardening-v3-1 / v3-2-regressions needing root or a
       case-folding filesystem) is handled separately.
     - **A. The signing identity never reaches the test gate.** release.ts
       is invoked with `GIT_CONFIG_COUNT/KEY_<n>/VALUE_<n>` (its own
       recipe); env config outranks a repo's local config, so inherited by
       `npm test` it overrode ac-56's fixture `user.signingkey` and the file
       crashed. release.ts now strips those (and `GIT_CONFIG_PARAMETERS`,
       what `git -c` exports) from the gate's environment, keeping them for
       git-release-squash; the harness deletes the same variables from
       `process.env` at load, so every git any test spawns sees only its
       fixture's own config.
     - **B. ac-15's lone copy is the bundle.** Under `npm test` the
       nanojira under test is `bin/nanojira` (D187), an sh launcher that
       `node <copy>` cannot run. ac-15 now copies `H.NJ_BUNDLE`, the
       `dist/*.mjs` the launcher runs; the launcher is ac-56's.
     - **D. ac-15 falls back to the running Node.** With no `NJ_NODE` and no
       portable `runtime/` above the checkout (any clone outside the
       workspace, the real repo included), it reported CANNOT RUN; it now
       uses `process.execPath` when that is Node >= 24. An explicit
       `NJ_NODE` that does not exist is still CANNOT RUN, never swapped.
     - **E. Other local branches: `--apply` refuses, a dry run warns**, both
       naming them, before the gate. git-release-squash's post-write verify
       runs `verify-commit` on every commit of every branch, so an unsigned
       WIP branch made it fail only after `main` and the tag were rewritten.
       "Other" means other than the checked-out branch; an unborn repo has
       none. The verify itself stays git-history-tools' business (off
       limits while it is being changed); rollback is in RELEASING.md.
     - **F. The release name is `package.json`'s `name`**, passed to
       git-release-squash as `--name` — not the directory's basename (its
       fallback), which gave a worktree or scratch clone a wrong subject
       prefix. A missing or empty `name` is a usage error.
     - **G. The test gate runs only with `--apply`.** A dry run writes
       nothing; running the ~20-minute suite twice per release bought
       nothing. It prints `test gate runs with --apply`.
     - **H. Tag form: `<title>[\n\n<body>]`, the v3.12.2 form.** The
       requested `nanojira vX.Y.Z\n\n<message>` (v4.0.0's hand-made form)
       is not expressible: git-release-squash takes the commit subject's
       title from the first line of the very text it writes as the tag
       message. Re-tagging after the squash would bypass its signer and
       verify; a separate tag-message option in git-history-tools is a
       possible follow-up. `--message-file` gives a body; AC9 pins both
       forms.
     - **I.** `docs/RELEASING.md`: the procedure (four bump points, both
       `package-lock.json` root entries and ac-39 included; bundle;
       CHANGES; message; dry run; `--apply`; verify; export; push only
       with the owner's go; rollback via reflog or the backup bundle),
       linked from README and ARCHITECTURE § 1.
     - **J.** `.gitignore`: `/node_modules`, not `/node_modules/`. The
       trailing slash matched only a directory, never the node_modules
       symlink every worktree and scratch clone carries.
     - Tests: `test/tools/release-regression.ts` AC5–AC9 (61 checks; AC9
       runs two real, signed `--apply` releases in a fixture repo built from
       scratch, with a throwaway key and `GIT_CONFIG_GLOBAL=/dev/null`) and
       the new `test/tools/release-gate-env.ts` (ac-56 under leaked
       `GIT_CONFIG_*`, ac-15 against the launcher and without `NJ_NODE`, the
       `.gitignore` symlink match). All RED before the change. Nine mutants,
       all killed: gate env unscrubbed, `PARAMETERS` not scrubbed, harness
       scrub removed, `--apply` not refused on other branches, branches
       never seen, name from basename, no `--name` passed, no `name` check,
       gate run in the dry run.

203. **A leg the environment cannot build is `not covered`, not failed; the
     release gate must not stay red over a missing prerequisite** (2026-10-18,
     triage of `edge/hardening-v3-1` and `edge/v3-2-regressions`, the two
     files D199 already named as the baseline's permanent failures).
     - Why: both files have been red "forever" in this sandbox (uid 1000, no
       root, a case-sensitive filesystem, no macOS-only paths), and
       `tools/release-regression` refuses whenever `npm test` is not green.
       4.1.0 is the first release meant to go through that gate for real, so
       "always red here" had to stop meaning "the gate can never honestly
       pass."
     - Classified every one of the 22 + 3 failing checks into three buckets:
       - **Environment prerequisite missing** (6 in hardening-v3-1: F1 × 2,
         D98 × 3, T1-follow-up; 3 in v3-2-regressions: R2, R9, R10). Each
         leg's own setup code already detects this and names the missing
         thing (root, a genuinely foreign-owned file, a case-folding
         filesystem) — it was simply recorded as a failed check, with
         `CANNOT RUN:` as the only signal that it was not a real one.
       - **A test bug** (1, hardening-v3-1's D96 bin/nj `init` leg):
         compares the LAST stderr line against two *independent*
         `H.freshDir()` roots. For `list`/`doctor`/bare `nj` the compared
         line never names a path, so it happened to match; `init`'s
         `io_error` names the absolute backlog path it failed to create,
         which embeds each root's own random mkdtemp suffix — two
         genuinely-correct runs can never produce byte-equal lines. Fixed by
         stripping each side's own root out of its line before comparing.
       - **A real product bug** (15, hardening-v3-1's D96 "unsearchable
         ancestor of the cwd" legs — reported, not fixed, src untouched).
         Repro: lock an ancestor directory (`chmod 000`) and run `list` /
         bare `nj` / `doctor` with the cwd below it. Expected (DECISIONS 93
         F4): exit 1, exactly one stderr line giving the OS reason, `io_error`
         under `--json`. Actual: two lines — the generic "no backlog found
         … run `nanojira init`" message — and `no_backlog` under `--json`.
         Root cause: `findBacklog`'s upward walk (`src/core/config.ts`) calls
         `isDir()` and, through `njrcLocation` → `readNjrc`, `fs.lstatSync`/
         `fs.statSync` on each candidate, and both `isDir` (`catch { return
         false }`) and `readNjrc`'s initial `lstatSync` (`catch { return null
         }`) treat EVERY error alike — ENOENT (truly absent, keep walking)
         and EACCES (a real permission fault on an ancestor, DECISIONS 93 F4)
         both read as "not here, keep going," so the walk reaches the top
         and reports the generic `no_backlog` instead of surfacing the
         permission error it actually hit.
     - **Harness**: `T.notCovered(desc, reason)` (`test/lib/harness.ts`).
       Counted alongside real checks (`_checks`), listed by name with its
       reason in `finish()`'s summary either way, but never itself makes
       `_failures` non-empty — a file whose only red legs are not-covered
       ones now reports `PASS <name> (<n> checks, <m> not covered)` with the
       gaps named underneath, exit 0. A real failing assertion in the same
       file still reports `FAIL`, not-covered legs listed separately
       underneath — proven with a planted failing check beside a planted
       not-covered leg in a scratch probe. Deliberately distinct from
       `T.exit`'s existing `result.missing` → `CANNOT RUN:` path: that one
       means the implementation itself is absent and must stay a hard
       failure, never downgraded to not-covered. `run-all.ts` needed no
       change: its `classify()` already reads a file's exit code and first
       line, and a not-covered-only file's first line is `PASS …`, not
       `— CANNOT RUN`, so it already lands in the `passed` bucket.
     - Both suites' own `cannotRun()` helpers (and v3-2-regressions' one
       inline R9 call) now delegate to `T.notCovered` instead of
       `T.check(desc, false, 'CANNOT RUN: ' + reason)` — one-line change
       each, every existing call site inherits the new behaviour.
     - Result in this sandbox: `v3-2-regressions.ts` — PASS (105 checks, 3
       not covered). `hardening-v3-1.ts` — FAIL, 15 of 481 checks failed, 6
       not covered; all 15 are the one `findBacklog` defect above, reported
       to Lead, src untouched pending a decision.
     - Worktree `nanojira-wt/baseline-triage`.
     - Addendum (2026-10-18, the 4.1.0 release gate): `edge/hardening-njrc-
       foreign-link` still exited the whole file with `— CANNOT RUN` when
       it found neither root nor a foreign-owned symlink, which `run-all`
       counts against the gate (cannot run 1 / 112, exit 1, 0 failed). Its
       `cannotRun()` now records one `T.notCovered` leg naming the missing
       prerequisite and calls `T.finish()`: `PASS (1 checks, 1 not
       covered)`. `run-all`'s whole-file `— CANNOT RUN` rule is unchanged,
       so a missing implementation still blocks. Mutation: a planted
       failing check before the prerequisite probe turns the file `FAIL`,
       exit 1, with the not-covered leg listed under it. The real leg
       (root, or a hard-linkable foreign symlink) did not run here; its
       code is unchanged.

204. **The upward search tells "nothing here" from "could not look"**
     (2026-10-18; completes DECISIONS 93 F4; found by the D203 triage).
     - The bug: with the cwd below an ancestor at mode 000 (non-root),
       `list`, bare `nanojira` and `doctor` printed two lines ("no backlog
       found" + the `nanojira init` hint) and `no_backlog` under `--json`,
       where D93 F4 ruled one line, the OS reason, `io_error`. On Linux
       `getcwd()` still succeeds there, so `workingDir()` never saw the
       problem; the search then probed `<dir>/.njrc` (`readNjrc`'s `lstat`)
       and `<dir>/backlog` (`isDir`'s `stat`), and both caught EVERY error
       as "absent". EACCES looked like "not here", the walk went on up past
       the locked directory and reported "nothing found". The D96 legs of
       `edge/hardening-v3-1` (15 checks) were the last red ones once D203
       had sorted out the environment-only legs.
     - The rule (§ 4 "Backlog location"): only ENOENT and ENOTDIR mean "not
       here, keep walking". Anything else is `io_error`, one stderr line,
       `cannot search <dir> for a backlog: <OS reason>`, no hint (a hint
       would be the second line D93 F4 forbids). `<dir>` is the directory
       whose entry could not be examined; the OS reason carries the exact
       path probed. Reporting `no_backlog` claims an answer the search
       never got, and walking past the failure could select a different,
       wrong backlog higher up — § 4's own "worst failure mode".
     - Scope, deliberately narrow: two new helpers in `core/config.ts`,
       `searchMiss()` and `searchIsDir()`, used only by the walk —
       `findBacklog`'s `backlog/` probe and `readNjrc`'s first `lstat`
       (`readNjrc` is reached only through `njrcLocation`, i.e. only from
       the two walks). `isDir()` is unchanged for its other caller,
       `claim()` (an explicit `--backlog`/`NJ_BACKLOG`/`.njrc` target keeps
       its `invalid_backlog_*` answer). `holdsBacklog()`'s `existsSync`
       checks inside an already-found `backlog/` are unchanged, as is
       `readNjrc`'s post-open fresh `lstat` (the D142 swap race), which
       still treats a vanished entry as absent.
     - Decided, each pinned by `test/edge/discovery-search-errors.ts`:
       - `--backlog`/`NJ_BACKLOG` skip the walk, so an unsearchable
         ancestor of the cwd does not matter then (S1).
       - The walk stops at the first `.njrc`/`backlog/`: nothing above is
         probed. A failing probe ABOVE a found backlog can therefore never
         surface (S4: a `backlog` symlink loop one level above a real
         backlog). Note the inverse is unavoidable: an unsearchable
         ancestor makes the very first probe at the cwd fail, because every
         path below it needs search permission on it — so the cwd's own
         backlog is not reachable by the search either, and naming it
         explicitly is the way out (the table's hint).
       - A `backlog` symlink loop (ELOOP) on the walk is now `io_error`
         where it used to be skipped silently (S3); a dangling `backlog`
         symlink is ENOENT and still skipped (S5). A `backlog` symlink whose
         target path crosses a directory the user may not search is
         `io_error` too: the search cannot tell whether it is a backlog.
       - `init`: its own walk looks only for a `.njrc` and shares
         `readNjrc`, so it follows the same rule. Under a locked ancestor it
         now fails at the `.njrc` probe (`cannot search <cwd> for a
         backlog: EACCES …`) instead of one step later at `mkdir`
         (`cannot create the backlog at …`) — still exit 1, one line,
         `io_error`; the D96 init legs assert exactly that and stay green.
         Continuing past an unreadable `.njrc` position to create
         `./backlog` would have been the same wrong answer as above.
     - Tests: hardening-v3-1 goes from 15 failed to green (481 checks, 6
       not covered per D203). Mutation: restoring "every error is absent"
       inside `searchMiss` turns exactly those 15 red again (run through a
       copied `bin/nanojira` so the bin-launcher legs count too) and 9 of
       the 19 checks in discovery-search-errors; the pre-fix bundle gives
       the same counts.

205. **`--help` lists every flag the command accepts** (2026-10-18; amends
     DECISIONS 158 EV-2 and 163 A; found by the v4.1.0 acceptance
     pre-check, finding 3).
     - The bug: `commandHelp` listed `core/flag-table.ts`'s fields only.
       That table deliberately leaves out the control flags (it is also
       `nanojira-mcp`'s schema source, § 17), so `set --help` showed no
       `--json`/`--dry-run`/`--force`/`--allow-open-children`/`--input`/
       `--quiet`/`--fields`, `note --help` no `--text`/`--text-file`/
       `--force`, and no command showed `--backlog`. It also printed the
       internal name `--depends_on`; § 9 documents `--depends-on`.
     - The rule (§ 9 "`--help` (per-command)"): a command's `--help` lists
       every flag its parser accepts — no more, no less — each with a
       one-line description and `=<value>` when it takes one; closed
       vocabularies keep their `allowed:` values. A flag accepted in two
       spellings is shown in the documented one. `--help`/`--version` are
       not listed (both are answered before any command runs).
     - One source, not two lists: the per-command control lists that sat
       in each `cmd-*`'s own `checkFlags(...)` call moved into
       `core/cli-flags.ts` (`CLI_SPEC`, split into `fields`/`controls`
       exactly as each call site had them, so every "Known fields:"/"Known
       flags:" hint is byte-identical — verified against bfd25ed for all
       19 commands, text and `--json`). Every command now calls
       `checkCommandFlags(flags, '<command>')`; `commandHelp` reads
       `acceptedFlagNames(command)` from the same entry. The `--backlog`/
       `--dry-run` grants moved into `args.ts`'s `allowedControlSet`, used
       by both `checkFlags` and `acceptedFlagNames`. The alias moved into
       `args.ts`'s `FLAG_ALIASES` (a `Map`: a plain-object lookup would let
       `--constructor` resolve to a prototype key), and `displayFlagName`
       reverses it for `--help`.
       `core/flag-table.ts` and the MCP schemas are unchanged.
     - Descriptions live next to the table (`flagDoc`: a default per flag,
       a per-command override where the meaning differs — `--status` is a
       filter on `list`, a write on `set`/`claim`/`next`). A flag without
       one still gets its line (`--help` never fails), but AC-64 D is red.
     - Commands without a flag-table entry (`init`, `tags`) now list their
       flags too. Bare `nanojira --help` stays the general help.
     - Tests: new `test/ac/ac-64-help-lists-every-flag.ts` probes each of
       43 candidate flags alone against every command (19, bare
       `nanojira` included) and asserts: A accepted ⊆ shown, B shown ⊆
       accepted, C the accepted set equals a pinned per-command oracle
       (pinned from the bfd25ed build by the same probe), D a description
       on every line, E `--depends-on` shown, `--depends_on` never; Z
       calibrates the probe. ac-46 P7 now asserts rm's control flags ARE
       listed (it asserted the opposite). Mutation, each red: dropping
       `--quiet` from `note` in `CLI_SPEC` (C), help filtering out
       `--force` (A), showing the internal spelling (A, E), dropping
       `--quiet`'s description (D), help showing a `--force` that
       `archive` rejects (B), help dropping the `--backlog`/`--dry-run`
       grants (A).

206. **The exported skill folder names the 4.1 features and points at the
     full docs** (2026-10-18, Lead task from Implementer3's 4.1.0
     acceptance pre-check).
     - The gap: an exported folder ships `SKILL.md`, `references/`, `bin/`,
       `dist/` and `LICENSE` — no GUIDE, no SPECIFICATION — and `SKILL.md`
       mentioned none of `--dry-run` (scans TSK-007), `show --notes=` /
       `log --last=` (TSK-005) or `NJ_ON_CHANGE` (TSK-011). A vendored
       agent could not discover them, nor find the docs that explain them.
     - **`SKILL.md`: one line each**, folded into the daily loop:
       `--dry-run` as "probe first", `--notes=last:N` on the Notes line,
       `--last=N` on the History line, and `NJ_ON_CHANGE` as "outside
       board", stating environment-only, never config (D200). It grows from
       55 to 61 lines and 3410 to 3914 characters (~700–980 tokens by the
       usual words×1.3 and characters/4 estimates).
     - **`references/full-docs.md`, pointers only.** It gives the GUIDE,
       SPECIFICATION and CHANGES URLs as
       `https://github.com/ehrlichandreas/nanojira/blob/v<version>/docs/…`,
       with `<version>` being `SKILL.md`'s `metadata.version`. A template,
       not a literal tag: a literal would be a fifth version bump point
       (RELEASING § 1), and a pin to `main` would describe code the vendored
       copy does not run. Then a map of every GUIDE section (`§ N — <title>`)
       so an agent can jump to the right one. The docs are not copied: the
       SPECIFICATION alone is ~5000 lines, and a copy in every export would
       drift from nothing and be loaded by nobody.
     - Tests: ac-56 W17 (47 checks; before the change, the 15 that could
       run included 11 failures):
       - `SKILL.md` names the four flags/variables, says `NJ_ON_CHANGE` is
         environment-only, stays at or below 4000 characters as a hard proxy
         for the token budget, and points at the new file.
       - The export ships it, with both tag-pinned URLs and no `main` link.
       - Every mapped `§ N — <title>` is still a `## N. <title>` heading of
         `docs/GUIDE.md`, so renumbering or retitling a section turns the
         suite red instead of leaving a dead pointer.
       - No `references/*.md` is longer than 80 lines or carries the GUIDE's
         or SPECIFICATION's title line.
       W1 already compares the exported `references/` with the repo's own
       list dynamically, so it needed no change.

207. **An invalid `NJ_NOW` is refused at dispatch, not at the first
     clock read** (2026-10-18, found by Implementer3).
     - The defect: `nowIso()` validated `NJ_NOW` lazily, when a command
       first asked for the time. Reads normally never do; only the
       `claim:stale` arithmetic does, and it runs while the context loads.
       So `NJ_NOW=bogus nanojira list` exited 0 on a backlog without
       claims and 1 (`invalid_env`) on the same backlog once one element
       was claimed. The same call's verdict depended on backlog content.
     - Worse, found by the mutation check below: a late check is not
       always "nothing written". `new` allocates its ID (writes the
       tombstone) before it stamps `created`. Under a bogus `NJ_NOW` it
       burned `EPIC-001`, then refused. § 9 says a failed write leaves
       nothing behind.
     - Fix (`src/core/store.ts` `checkClockEnv()`, called from
       `src/nanojira.ts` `main()`): the validation `nowIso()` already did
       now also runs once at dispatch. It runs after `--version`, `help`
       and `--help`, and before `beginOnChange()` and the command switch.
       `nowIso()` keeps its own check (the same function), so nothing can
       reach a timestamp unvalidated.
     - The rule is unchanged: empty means unset, otherwise exactly
       `YYYY-MM-DDTHH:MM:SSZ` and a real instant. So is the message.
     - Precedence: it runs before argument checks, backlog resolution and
       the `NJ_ON_CHANGE_TIMEOUT` check (D200), so with both variables bad,
       `NJ_NOW` wins. Even an unknown command word answers `invalid_env`.
       A broken clock pin is a broken environment; no answer computed
       under it can be trusted, the same reasoning that put D200's timeout
       check at dispatch.
     - Why `--version`, `--help` and `help` are exempt: they already sit
       above every other check (§ 9: help "never fails"; `--version`
       resolves no backlog). They read no clock and no backlog, and they
       are what someone reaches for to diagnose a broken environment.
       Refusing them would make a wrong `NJ_NOW` harder to fix and would
       change nothing they print.
     - Not changed: `nanojira-mcp` does not validate `NJ_NOW` itself. Each
       tool call spawns the CLI, which now answers `invalid_env` per call.
     - Tests: ac-62 gets leg 3. Two invalid values (`bogus`, and one
       missing its `Z`) are tried against:
       - `list` on an empty backlog;
       - list / show / doctor / `set --dry-run` / bare / `new`, on an
         unclaimed twin and on a claimed twin.

       Every case must exit 1 with `invalid_env`, write exactly one stderr
       line naming `NJ_NOW`, and leave the backlog snapshot byte-identical.
       Also checked: `--version`, `--help`, `help` and `list --help` still
       exit 0; a valid `NJ_NOW` gives exit 0 on every case.
     - Mutation: a bundle with the dispatch call removed (lazy again) fails
       34 of 157 checks. That covers every unclaimed read, list on the empty
       backlog, and `new`'s "nothing written" on both twins.

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
