# Changes

User-facing changes only — not an engineering changelog. Full rules are in
`docs/SPECIFICATION.md`; `docs/GUIDE.md` is the how-to. Feedback ids in
parentheses are from each team's own backlog (`nj --backlog=feedback/<team>
show --id=<id>`), not ours.

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
