# Changes

User-facing changes only — not an engineering changelog. Full rules are in
`docs/SPECIFICATION.md`; `docs/GUIDE.md` is the how-to. Feedback ids in
parentheses are from each team's own backlog (`nj --backlog=feedback/<team>
show --id=<id>`), not ours.

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
