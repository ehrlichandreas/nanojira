# nj — agent instructions

Copy the block below into the project's `AGENTS.md`. Full rules:
`docs/GUIDE.md`, `docs/SPECIFICATION.md`.

```md
## Task tracking (nj)

This project tracks work with `nj` (NanoJira) — a backlog of epics, tasks
and subtasks, one Markdown file per element, committed alongside the code.

- Always add `--json` and branch on the result, never on prose:
  `nj list --json`, `nj show --id=<id> --json`.
- To pick up the next piece of work yourself: `nj next --as=<your-name>
  --status=doing --json` — picks the highest-priority ready item and
  claims it in one call, so two agents never pick the same one. If
  nothing is ready, it reports `none_ready`; that's a normal outcome; ask
  for more work or stop. Reach for `nj claim --id=<id> --as=<your-name>`
  instead when you already know which specific element you want (someone
  pointed you at it, or you're resuming your own earlier claim).
- Read before you write: `nj show --id=<id> --json` to see the current
  state, then `nj set --id=<id> --status=... [--title=... --priority=...
  --tags=... --assignee=... --depends-on=... --description=...
  --acceptance=...]` to change only the fields you intend to.
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
  `_problems` the same way.
```
