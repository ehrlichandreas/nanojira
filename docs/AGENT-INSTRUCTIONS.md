# nj — agent instructions

Copy the block below into the project's `AGENTS.md`. Full rules:
`docs/GUIDE.md`, `docs/SPECIFICATION.md`.

```md
## Task tracking (nj)

This project tracks work with `nj` (NanoJira) — a backlog of epics, tasks
and subtasks, one Markdown file per element, committed alongside the code.

- Always add `--json` and branch on the result, never on prose:
  `nj list --json`, `nj show --id=<id> --json`.
- Read before you write: `nj show --id=<id> --json` to see the current
  state, then `nj set --id=<id> --status=... [--title=... --priority=...
  --tags=... --assignee=... --depends-on=... --description=...
  --acceptance=...]` to change only the fields you intend to.
- Before starting an element: `nj claim --id=<id> --as=<your-name>`
  (optionally `--status=doing` in the same call). When you're done, mark it
  `nj set --id=<id> --status=done`; if you're stopping without finishing,
  give the claim up with `nj release --id=<id> --as=<your-name>` so
  someone else can claim it.
- Never hand-edit files under `backlog/` — always go through `nj`.
- Tick acceptance criteria with `nj check --id=<id> --text="<substring>"`,
  never by editing the checkbox text yourself.
- Sign notes with `nj note --id=<id> "..." --as=<your-name>`.
- On failure, `{"ok": false, "error": "<code>", ...}` — branch on `error`,
  not on the hint text. Element-level issues arrive per entry in
  `_problems` the same way.
```
