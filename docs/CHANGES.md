# Changes

User-facing changes only — not an engineering changelog. Full rules are in
`docs/SPECIFICATION.md`; `docs/GUIDE.md` is the how-to. Feedback ids in
parentheses are from each team's own backlog (`nj --backlog=feedback/<team>
show --id=<id>`), not ours.

## 3.12.0

Packaging changes only — no command, flag or output behaviour changed.

- **This repository is now the skill folder itself.** `SKILL.md`, `bin/`
  and `dist/` live at the repo root, committed — not assembled only at
  export time as in 3.11.0. `bin/nj`/`bin/nj-mcp` (and their `.cmd`
  siblings) are generated from a single template, checked the same way
  `dist/*.mjs` already is.

- **`VERSION` is gone.** The version lives in exactly two places:
  `SKILL.md`'s own `metadata.version`, and `nj --version`. The exported
  folder is now simply `SKILL.md` + `bin/` + `dist/` of the tag —
  nothing else, and nothing to assemble beyond a plain copy.

- **Migrating from 3.11.0:** drop any check or script that reads a
  `VERSION` file out of an exported folder — read `SKILL.md`'s
  `metadata.version` instead (or `nj --version`, which always agrees
  with it). Re-export to pick up the new, smaller folder shape; nothing
  else about invoking `bin/nj`/`bin/nj-mcp` changed.

## 3.11.0

Packaging changes only — no command, flag or output behaviour changed.

- **`nj` ships as a self-contained skill folder**, not a shared install. A
  consuming team vendors its own copy with:

  ```sh
  $ node tools/export-skill.mts <tag> <dest>
  ```

  which reads every file only from `<tag>`'s own signed, verified commit —
  never from the working tree, however it is currently checked out. Copy
  the resulting folder (`cp -R`) wherever it is needed; never symlink into
  it or out of it — nothing inside is, or should be treated as, a link.

- **It runs through `bin/nj` or `bin/nj-mcp`** (a plain `sh` script, plus a
  `.cmd` for Windows). `NJ_NODE` picks a specific `node` if more than one is
  on `PATH`; the minimum supported version is Node 24; an inherited
  `NODE_OPTIONS` is unset before `node` ever starts, so it cannot load
  foreign code into the tool. Any startup failure (no `node`, `node` too
  old, a missing bundle) exits 127 with exactly one line on stderr naming
  the cause — never a stack trace, never partial output.

- **The bundles are ESM**: `dist/nj.mjs` and `dist/nj-mcp.mjs`, both in
  this repo and in every exported folder. The repo's earlier extensionless
  `dist/nj`/`dist/nj-mcp` and the release's `nj.cjs`/`nj-mcp.cjs` are both
  gone.

- **The shared workspace install is retired.** `workspace/bin/nanojira/`
  and `tools/release-local.sh` no longer exist; there is no common place
  to install `nj` into, and no "`current` always points at the latest
  version" convention to rely on.

- **Migrating:** replace a vendored `nj.cjs`/`nj-mcp.cjs` (or a
  `bin/nanojira/current/nj` wrapper) with a freshly exported folder, and
  call `sh <skill>/bin/nj` (or `bin/nj-mcp`) in its place.

## 3.10.0

Two small gaps closed, both found live: a holder loop an outside team
shouldn't have needed, and the last place a wrong article could still
show up.

- **`nj doctor --fix` releases every claim still held on a final-status
  element** — live or archived, whoever holds it — the same unconditional
  release `set`/`claim --status=<last>` already perform in one write,
  applied in bulk. The claim log gets the identical entry a normal
  release writes (`released`, the holder, the next generation); the
  element's own file is never touched either way:

  ```sh
  $ nj doctor
  backlog/: 2 entries, 0 errors, 1 warning

  WARNING TSK-001: claimed by 'alice' since 2026-01-01T00:00:00Z, past the
  24h staleness threshold
  $ nj doctor --fix
  FIXED   TSK-001: released alice

  backlog/: 2 entries, 0 errors, 0 warnings remaining
  ```

  An archived final-status element with a leftover claim directory is
  named in the fix the same way, holder included, even though the
  existing orphan cleanup usually already empties the directory by the
  time this step runs. Claims on anything not yet in the final status
  are left exactly as they are, stale or not — only finality releases a
  claim, never staleness by itself — and plain `doctor` (no `--fix`)
  still only reports, never writes. A second `--fix` releases nothing,
  since there is nothing left to release. **This replaces the
  one-holder-at-a-time `release --as=<holder>` loop** that was previously
  the only way to clear a backlog's worth of claims left over from before
  this existed. (team-a, 32 `claim:stale` warnings found on a single
  backlog move)

- **The `--input` plan-nesting rejection message's last hardcoded
  article** is fixed: a subtask nested directly under an epic now reads
  "an epic cannot have a subtask child", not "a epic cannot have a
  subtask child" — the one call site DECISIONS 180's article-helper pass
  had missed.

## 3.9.0

Reorganising a backlog without losing an element's history, and a warning
for a `done` item whose acceptance boxes were never finished ticking —
both found live by outside teams.

- **`nj set --parent=<id>` reparents a task or subtask.** The id, the body
  (description, acceptance, any unknown sections) and the claim log all
  stay exactly as they were — a claim is keyed by the element's id, never
  by its file path, so moving it never disturbs one. The type never
  changes: a task moves under a different epic, a subtask under a
  different task; converting a subtask to a task (or back) is out of
  scope, and still needs a hand edit. A real run, moving a task to a
  sibling epic:

  ```sh
  $ nj set --id=TSK-001 --parent=EPIC-002 --json
  { "ok": true, "id": "TSK-001", "changed": ["parent"],
    "entry": { "id": "TSK-001", "parent": "EPIC-002", "...": "..." },
    "_problems": [] }
  ```

  Under `layout.group: hierarchy`, the move takes the file with it — the
  subtask's own file, or the whole folder (children included) for a task
  — in the same write that changes `parent`; under `type` or `flat` only
  the frontmatter changes, since placement there never depended on
  `parent` to begin with. `--input set` accepts `parent` as one more
  settable field.

  The new parent must exist, be live (not archived) and be the right
  type — the error codes mirror `new`'s own `--parent` validation
  exactly, not a new vocabulary: a missing parent is `not_found`, a
  wrong-type parent is `invalid_target`, an archived parent is
  `refused:parent_archived`, and `--parent` given to an epic at all
  (which never has one) is `invalid_value`. Nothing is written in any of
  these cases:

  ```sh
  $ nj set --id=TSK-001 --parent=TSK-002       # a task given a task, not an epic
  Error: parent 'TSK-002' is a task, but a task needs an epic
  $ nj set --id=TSK-001 --parent=EPIC-999      # does not exist
  Error: parent 'EPIC-999' does not exist
  $ nj set --id=TSK-001 --parent=EPIC-003      # archived
  Error: parent 'EPIC-003' is archived — refusing to move a child under it
  $ nj set --id=EPIC-001 --parent=EPIC-002     # an epic has no parent at all
  Error: epics must not have a --parent
  ```

  There is no separate `nj undo` to restore a mistaken move — `nj set
  --parent=<old>` is an ordinary reparent like any other, and restores
  the previous state exactly: same file location, same frontmatter apart
  from `updated`. (team-b-tests TSK-014)

- **Warning `done:open_acceptance`** for a live task/subtask that reaches
  the final status with at least one unticked `- [ ]` line still under
  its Acceptance Criteria section — a gap none of the existing acceptance
  warnings caught, since `acceptance:no_checkbox` only fires on *zero*
  checkboxes and `done:no_acceptance` only on an absent/empty section. It
  never blocks, never rejects a write, never changes `--ready`/`list`/any
  count — the same non-blocking contract as those two. Shown by `doctor`
  and by `set`'s (and `claim`'s) own text feedback, naming the count:

  ```sh
  $ nj set --id=TSK-001 --status=done
  TSK-001 → status=done
  ⚠ TSK-001 is done with 2 of 3 acceptance boxes still unticked.
  $ nj doctor
  ./: 2 entries, 0 errors, 1 warning

  WARNING TSK-001: done with 2 of 3 acceptance boxes still unticked
  ```

  `set`'s (and `claim`'s) own `--json` result additionally carries the
  count directly, alongside the bare code in `_problems`:

  ```json
  { "ok": true, "id": "TSK-002", "changed": ["status"], "...": "...",
    "_problems": ["done:open_acceptance"],
    "open_acceptance": { "unticked": 1, "total": 1 } }
  ```

  An archived element never carries it, same as the other two acceptance
  warnings — nobody can act on a warning about history. (team-c
  TSK-001)

  **Upgrading may surface a flood of this new warning on old `done`
  elements** whose boxes were simply never ticked back when nothing
  checked for it. Three ways to quiet it, same as the existing two
  acceptance warnings: tick the boxes (`nj check`), archive the finished
  epics so their descendants become archived too (`nj archive`), or list
  the code once to stop seeing it everywhere: `"problems": {"ignore":
  ["done:open_acceptance"]}`. None of these change `--ready`, `list`'s
  counts, or anything else — only the reporting. Our own backlog hit 18
  warnings on old `done` tasks the first time we ran `doctor` after this
  landed; we archived EPIC-001 through EPIC-005 (all long finished) and
  were back to zero.

- **Packaging:** from this release, the shared workspace install
  (`tools/release-local.sh`) has no symlinks. Each version directory ships
  the bundles as `nj.cjs`/`nj-mcp.cjs`. They are CommonJS: an extensionless
  file takes its module type from the nearest `package.json` and breaks
  with `require is not defined in ES module scope` under a
  `"type": "module"` scope. Next to them sit plain `sh` wrappers
  `nj`/`nj-mcp` and `.cmd` wrappers for Windows. `current/` is a real
  directory. `current/nj` and `current/nj-mcp` are copies of the bundles
  themselves, so both `current/nj …` and `node …/current/nj …` work exactly
  as before. Its `.cmd` files call into the current version. Anyone copying
  the binary into an ESM project should copy `<version>/nj.cjs`, as
  Team B already does. (DECISIONS 178, 179, 181)

## 3.8.0

JSON input for building a whole plan in one call, two gaps closed in
`done`/`show`, reviewed against real plans by both outside leads:

- **`nj new --input=<file|->` takes a JSON plan**: an object, or an array
  of objects, each of which may nest its own `children` (parent implied by
  the nesting, never given alongside it). `nj set --input=` takes exactly
  one object — the field map `set` already accepts, just sourced from JSON
  instead of flags; addressing (`--id=`/`--file=`) stays on the CLI either
  way. A real run, an epic with one task and an implementation + review
  subtask, the review `depends_on` its own implementation via `ref`:

  ```json
  { "type": "epic", "title": "Login", "description": "Users can sign in.",
    "children": [
      { "type": "task", "title": "Login route",
        "description": "POST /login returns a session.",
        "acceptance": ["200 with a valid password", "401 otherwise"],
        "children": [
          { "type": "subtask", "ref": "@impl", "title": "Implement POST /login",
            "description": "Wire the route to the session store.",
            "acceptance": ["Route registered", "Session cookie set on success"] },
          { "type": "subtask", "title": "Review: POST /login", "assignee": "bob",
            "depends_on": ["@impl"],
            "description": "Review the implementation above.",
            "acceptance": ["Code reviewed", "Tests reviewed"] }
        ] }
    ] }
  ```

  `nj new --input=plan.json --json` (`ids`/`entries` in write order,
  `refs` mapping every `@name` to the real id it resolved to):

  ```json
  { "ok": true,
    "ids": ["EPIC-001", "TSK-001", "SUB-001", "SUB-002"],
    "entries": [ "...", "...", "...",
      { "id": "SUB-002", "type": "subtask", "parent": "TSK-001",
        "title": "Review: POST /login", "assignee": "bob",
        "depends_on": ["SUB-001"], "...": "..." } ],
    "refs": { "@impl": "SUB-001" },
    "_problems": [] }
  ```

  `acceptance` may be a JSON array of strings, in either command — each
  element becomes one `- [ ] …` line, so content supplied this way can
  never accidentally trigger `acceptance:no_checkbox` (team-b-tests
  TSK-011's own motivation). `--dry-run` (`new --input=` only) runs full
  validation and writes nothing, reporting the would-be shape — no `id`,
  `file`, or `refs`, since none of it exists yet.

- **A `depends_on` ref must be declared *earlier* in the plan** — a
  forward reference, or an object referencing itself, is `invalid_value`
  before anything is written. Found live: a plan whose "Review" node named
  `depends_on: ["@impl"]` while `@impl` was declared *later* passed an
  earlier build's validation and silently wrote `depends_on:
  ["undefined"]`. The failure names the *referencing* object and hints to
  move the referenced one earlier:

  ```json
  { "ok": false, "error": "invalid_value",
    "hint": "move the object that declares this ref earlier in the plan, before this one",
    "failed_at": "[0]" }
  ```

  `parent` is never ref-aware either — give it a real, already-existing
  id, or nest the child under its new parent's own `children` instead.

- **A mid-plan failure names what happened so far.** On top of the usual
  `{ok, error, hint}`, a failure partway through a plan additionally
  carries `created` (every id actually written, in write order) and
  `refs` (every `ref` resolved before the failure) — absent, not empty,
  when the plan failed validation and nothing was attempted at all.
  `failed_at` — the one object at fault, either its own `ref` or a JSON
  path like `[0].children[1]` — is the one documented exception to every
  other failure shape in this spec, on both a validation failure and a
  mid-plan write failure.

- **A write that reaches the last configured status releases the claim**,
  whoever holds it, in the same call — `nj set --status=done`, `nj claim
  --status=done`, `nj next --status=done` alike:

  ```json
  { "ok": true, "id": "TSK-001", "changed": ["status"], "...": "...",
    "released": "alice" }
  ```

  Closes a real gap an outside team found: `claim:stale` turned up a
  dozen stale claims, most of them on elements already `done` — claimed,
  finished, never released, because release was a separate step agents
  forgot. There is no more need for a follow-up `nj release` after a
  final-status write; `released` is simply absent when nothing was
  claimed. A write refused for another reason (`refused:children_open`
  without `--allow-open-children`, for one) releases nothing — the claim
  survives exactly as before. (team-b-tests TSK-013)

- **`nj show --json` on a single element now carries `entry`**, identical
  to `entries[0]` — the one place `show --json`'s existing `{backlog,
  counts, entries}` shape differs from a bare object, which bit two of
  our own AC scripts before (reading `entry.tags` off `undefined`,
  silently comparing nothing). Present exactly when `entries` has one
  element; absent for a `duplicate_id` target (two entries) and never on
  `list`/`find`, which keep their existing shape unchanged.

Both outside leads reviewed the `--input` draft against real plans of
their own before any of the above shipped — the `@`-prefix rule for
`ref`s, the `refs` map, `failed_at`, `--dry-run` and `acceptance` as an
array all came out of that round. (team-a, team-b-tests)

## 3.7.0

Fixes and discoverability, in response to a second round of feedback from
the first two outside teams:

- **`nj rm --help` now shows its own flag lines** (`--id`, `--file`,
  `--cascade`), the same as every other command — it used to show only
  the synopsis line. Closes the known gap noted in 3.6.0 below.

- **`nj set --add-tags=<list>` / `--remove-tags=<list>`**: an incremental
  alternative to `--tags=`, which always replaced the whole list.
  `--remove-tags` takes effect first, then `--add-tags` appends anything
  named there not already present; adding a tag already there, or
  removing one that isn't, is a no-op, not an error. Combined with
  `--tags=` in the same call is rejected — pick one or the other. Also
  works in batch (`--id=A,B,C`) and over `nj-mcp`'s `set` tool.
  (team-b-tests TSK-008)

- **`layout.statusFile: false` for several agents in one working tree.**
  `STATUS.md` is rewritten after every write, which collides across
  agents committing from the same tree even when their real work doesn't
  overlap. Setting `layout.statusFile: false` in `.nanojira/config.json`
  turns it off — `doctor` stops checking it, and an existing file is left
  alone. The same overview is still available without it: bare `nj`
  (counts, top ready) and `nj list --json`. See `docs/GUIDE.md` § 8 for
  the full write-up. (team-b-tests TSK-009)

- **Failure codes that have an override flag now say so in the spec.**
  `docs/SPECIFICATION.md` § 9's failure-code table gained a closed
  "Override flag" column — `--allow-open-children`, `--force`,
  `--cascade`, `--steal=<holder>` are the only four that exist; everything
  else needs the underlying condition fixed, not a flag. No change to the
  `--json` shape — the hint already carried this in prose; the table is
  now a lookup instead of a re-read every time. (team-b-tests
  TSK-010)

- **Two new warnings about acceptance-criteria quality**, shown by
  `doctor` and in `new`/`set`/`note`/`check`'s own text feedback — never
  blocking, never rejecting a write, never changing `--ready`/`list`/any
  count:
  - a task/subtask's acceptance section has text but no `- [ ]` checkbox
    line, so `nj check` has nothing to tick (team-b-tests TSK-011);
  - a `done` task/subtask has an empty or absent acceptance section — it
    was never defined what "done" means for it (team-a TSK-006).

  Both are **live elements only** — an archived element never gets
  either warning, since nobody can act on one about history.

  **If either warning is noise for your backlog** — for example, if your
  `done` elements track completion some other way (tags, an external
  test case) and leaving acceptance criteria empty is deliberate — list
  the code in a new, optional config block to stop seeing it reported,
  everywhere it would otherwise appear:
  ```json
  "problems": {"ignore": ["done:no_acceptance"]}
  ```
  Any warning-severity code from `docs/SPECIFICATION.md` § 7 can be
  listed this way; an error code or an `incomplete:*` code cannot
  (rejected, so a real defect or the readiness rule itself can never be
  silenced by configuration).

- **Config forward compatibility.** Before 3.7, a config key written for
  a newer `nj` made every command on an older one fail outright
  (`invalid_config`) — a trap for rollback and mixed-version machines.
  From 3.7: an unrecognised config key — top level, or inside `layout`/
  `layout.folders`/`claims`/`problems` — is a warning (`doctor` reports
  it), not a hard failure; every command still works. **No special
  rollout order needed for the two new keys above:** an `nj` older than
  3.7 already silently ignores an unrecognised *top-level* key (confirmed
  directly against 3.5.0 and 3.6.0), so `"problems"` is safe to set today
  even while some machines haven't upgraded yet — they simply won't act
  on it until they do. An unrecognised key *inside* a nested block
  (`layout`/`claims`) was a hard failure before 3.7 and is this same
  warning from 3.7 on. (team-b-tests TSK-012)

- **Optional `"minVersion": "X.Y.Z"`** in `.nanojira/config.json`: if the
  running `nj` is older, every command fails with a clear `needs_newer_nj`
  error naming both versions, instead of a confusing `invalid_config`. Set
  it once your own team has standardised on 3.7 or later — an `nj` that
  predates this feature doesn't know to honour it, the same "ignored
  until the fleet catches up" story as `problems`, above.

## 3.6.0

Fixes, in response to feedback from the first two outside teams running nj:

- **`--backlog`/`--json` before the command word now work.**
  `nj --backlog=<path> list` used to silently drop `list` and run the bare
  status instead; `nj --backlog=<path> show --id=X` used to fail with a
  misleading `unknown field '--id'`. Both now run the command, exactly as
  if `--backlog`/`--json` had been placed after it. **Habit to change:** if
  you were putting the command word first to work around this, you no
  longer need to — either order works now. A flag other than
  `--backlog`/`--json` placed before the command word is still an error
  (`unknown_field`), even one that command would otherwise accept — it is
  never silently applied to the command that follows.
  (team-b-tests TSK-006)

- **`nj note` keeps a multi-line note, instead of flattening it to one
  line.** A note's text can now have line breaks; every line after the
  first is written indented two spaces under the note's own line, and
  `nj log` reads it back out the same way. No change needed on your side
  unless you were working around the old flattening. (team-b-tests
  TSK-007)

- **`nj next` no longer hands out an element assigned to someone else.**
  An element with `assignee` set to a name other than the one calling
  `next` is skipped; only an unassigned element, or one already assigned
  to the caller, is a candidate. **Habit to change:** if you were relying
  on `next` to pick up Lead-assigned or otherwise pre-assigned work
  regardless of who it names, call it as that name instead: `nj next
  --as=<name> --assignee=<name>`. This is also how to keep an author from
  picking up their own review: assign the review to the reviewer
  (`nj set --id=<id> --assignee=<reviewer>`), and only the reviewer's own
  `next` (or an explicit `claim`) will take it. (team-a TSK-005,
  TSK-004)

- **The short status's "Ready to work" list no longer shows a container
  with an open child.** `nj` (no command) used to list an epic there even
  while one of its tasks was still open; now only the open child itself
  (or, once every child is done/archived, the container) appears. `nj
  list --ready` is unaffected — it stays a plain readiness filter, with no
  such rule applied. (team-b-tests TSK-004)

- **`nj <command> --help` now prints that command's own flags and allowed
  values**, instead of the general help. `--type`'s and `--priority`'s
  allowed values are always shown (`epic, task, subtask` /
  `low, normal, high, urgent`); `--status`'s come from the backlog's own
  configured statuses when one resolves, else the defaults — so there is
  no need to go spelunking in a spec to find out what a flag accepts.
  (team-b-tests TSK-002, TSK-003)

- **An invalid `--type`/`--status`/`--priority` value now suggests the
  nearest valid one**, when there is exactly one close enough —
  `did you mean 'normal'?` for `--priority=medium`, for example. The value
  is still rejected exactly as before (`invalid_value`); only the hint
  changed, and no alias is ever accepted in its place. (team-a
  TSK-001)

- **Docs only, no behaviour change:** `docs/GUIDE.md` now says the empty
  `epics/`/`tasks/`/`subtasks/`/`archive/` directories `nj init` creates
  need not be committed — git doesn't track empty directories, and `nj`
  recreates whichever one it needs the first time something goes into it
  (team-b-tests TSK-001); and § 1 now shows starting `nj` with an
  explicit `node /path/to/dist/nj …` for an environment where `node` isn't
  on `PATH` by the name `nj` expects (team-a TSK-003).

Distribution (team-b-tests TSK-005): accepted releases are now
installed locally under `workspace/bin/nanojira/<version>/`, and `current`
points at the latest one. Point your wrapper at `bin/nanojira/current/nj`,
never at `nanojira/dist/nj`. A remote or package to fetch from is still
open.

Known gap: `nj rm --help` shows only the synopsis line, not the per-flag
lines (`--id`, `--cascade`). That is planned for 3.7.

## 3.5.0 (for context)

- `nj next`: claims the top `--ready` candidate in one call, instead of
  `list --ready` then `claim` by hand (which left a gap where two callers
  could read the same candidate before either claimed it).
- `nj log --id=<id>`: an element's change history — when it was created,
  every claim/release, and its notes, merged into one timeline. Does not
  show field-level changes (`status`, `priority`, …) — leave a note for
  those, or use `git log -p` on the element's file for a git-backed
  backlog.
- `nj --version` / `nj-mcp --version`: prints the version and exits,
  without needing a backlog.
