# nj — agent instructions

Copy the block below into the project's `AGENTS.md`. Full rules:
`docs/GUIDE.md`, `docs/SPECIFICATION.md`.

```md
## Task tracking (nj)

This project tracks work with `nj` (NanoJira) — a backlog of epics, tasks
and subtasks, one Markdown file per element, committed alongside the code.

- Always add `--json` and branch on the result, never on prose:
  `nj list --json`, `nj show --id=<id> --json`.
- Unsure what values `--type`/`--status`/`--priority` accept? `nj <command>
  --help` (e.g. `nj set --help`) prints that command's own flags and the
  allowed values for each — never guess, and don't rely on a stale list in
  a doc or a prior response.
- To pick up the next piece of work yourself: `nj next --as=<your-name>
  --status=doing --json` — picks the highest-priority ready item and
  claims it in one call, so two agents never pick the same one. If
  nothing is ready, it reports `none_ready`; that's a normal outcome; ask
  for more work or stop. Reach for `nj claim --id=<id> --as=<your-name>`
  instead when you already know which specific element you want (someone
  pointed you at it, or you're resuming your own earlier claim). `next`
  never hands out an element already assigned to someone else — assign a
  review to the reviewer (`nj set --id=<id> --assignee=<reviewer-name>`),
  never to the author of the thing being reviewed, so `next` keeps it out
  of the author's own hands automatically.
- Read before you write: `nj show --id=<id> --json` to see the current
  state, then `nj set --id=<id> --status=... [--title=... --priority=...
  --tags=... --assignee=... --depends-on=... --description=...
  --acceptance=...]` to change only the fields you intend to.
- To change *just one* tag without re-listing every other one: `nj set
  --id=<id> --add-tags=<a,b>` / `--remove-tags=<c,d>` instead of
  `--tags=`, which replaces the whole list. Never combine `--tags=` with
  either in the same call (rejected) — pick one or the other.
- When you're done with a claimed element, mark it `nj set --id=<id>
  --status=done`; if you're stopping without finishing, give the claim up
  with `nj release --id=<id> --as=<your-name>` so someone else can claim
  it.
- Never hand-edit files under `backlog/` — always go through `nj`.
- Tick acceptance criteria with `nj check --id=<id> --text="<substring>"`,
  never by editing the checkbox text yourself.
- Sign notes with `nj note --id=<id> "..." --as=<your-name>`.
- Picking up someone else's work, or just confused about an element?
  `nj log --id=<id> --json` shows what happened to it: when it was
  created, every claim/release (if made on this machine — that history
  doesn't travel with a clone), and its notes, in order. It does not show
  field changes like `status` or `priority` — leave a note for those.
- On failure, `{"ok": false, "error": "<code>", ...}` — branch on `error`,
  not on the hint text. Element-level issues arrive per entry in
  `_problems` the same way. A `refused:*` code that has a flag to make
  the **same** call succeed anyway (`--allow-open-children`, `--force`,
  `--cascade`, `--steal=<holder>`) is named in
  `docs/SPECIFICATION.md` § 9 "Failure codes — spec-named paths"'s own
  "Override flag" column — branch on the code, not on the hint text, but
  that table is the lookup for which flag to add, not the hint.
```
