---
name: nanojira
description: "A local, file-based task tool for agents: read, claim, update, close and note backlog elements (epics/tasks/subtasks) under a plain-Markdown backlog/ folder, no server or database. Use whenever an agent needs to track its own work, pick up the next ready item, or report on backlog state. Not for a team's existing issue tracker (Jira, GitHub Issues, Linear, ...) - nanojira is its own, separate backlog; do not point it at one of those."
license: MIT
metadata:
  version: "4.6.0"
---

# nanojira (NanoJira)

Every element (epic, task, subtask) is one Markdown file under `backlog/` — no server, no
database, no network. Not a client for Jira/GitHub Issues/Linear, and no remote mode.
Packaging (no symlinks — copy with `cp -R`) and reporting bugs in nanojira itself:
`references/packaging-and-feedback.md`. Full guide and spec, at this release's tag:
`references/full-docs.md`.

## Usage

`sh <skill>/bin/nanojira <command> [flags]` (`<skill>/bin/nanojira-mcp` for MCP). Needs only
Node.js ≥ 24. Backlog: `--backlog=<path>`, else `NJ_BACKLOG`, else the nearest `.njrc` or
`backlog/` upward from the current directory. Below, `nanojira` stands for `sh <skill>/bin/nanojira`.

**Always pass `--json` and branch on the parsed result, never on prose** — the JSON shape is
the stable contract: `nanojira list --json`, `nanojira show --id=<id> --json`.

### The daily loop

- **Next work**: `nanojira next` claims the element it picks, the top ready one (only looking:
  `list --ready`, `next --dry-run`). Add `--as=<name> --status=<doing-like status> --json`.
  `none_ready` is normal, not a failure to retry.
- **A specific element**: `nanojira claim --id=<id> --as=<name>`.
- **Read before writing**: `show --id=<id> --json`, then `set --id=<id> --status=...
  [--title= --priority= --tags= --assignee= --depends-on= --description= --acceptance=]` —
  only the fields meant to change.
- **Fewer tokens**: `--quiet` (`{ok, id}` plus any `_problems`) or `--fields=a,b` on
  `new`/`set`/`note`/`check`/`claim`/`release`/`next`; `--fields` on `list`/`find`/`show`.
- **Probe first**: `--dry-run` on any write (`doctor --fix` too) returns the real result plus
  `changes` (every file it would touch) and writes nothing; ids it shows are not reserved.
- **Finish**: `set --id=<id> --status=<final status>` releases the claim in the same write;
  to step away unfinished, `release --id=<id> --as=<name> --status=<first status>` puts it
  back (and clears your own assignee) in the same call.
- **Acceptance**: tick with `check --id=<id> --text="<substring>"`, never by hand.
- **Notes**: `note --id=<id> --text="..."` (or `--text-file=<path|->`);
  `show --id=<id> --notes=last:N` prints only the newest `N`.
- **Sign** `claim`, `release`, `next` and `note` with `--as=<name>`.
- **History**: `log --id=<id> --json` (`--last=N`: newest `N`) — creation, claims/releases,
  notes. Field changes are not logged; leave a note with the reason.
- **Outside board**: `NJ_ON_CHANGE=<cmd>` in the environment (never in config) runs `<cmd>`
  after every successful write, to keep an external tracker in sync.
- **Noisy warnings?** `"problems": {"ignore": [<codes>]}` in `.nanojira/config.json` silences
  warning-level `_problems` codes (e.g. `done:open_acceptance`) without changing the data.

### Rules for an agent using nanojira

1. The backlog is the only task list for its scope — no second, parallel list elsewhere.
2. Never hand-edit a file under `backlog/`; every change goes through a command.
3. Branch on `error` (a stable code), never on hint or prose text.
4. Run `nanojira doctor` before treating a batch of changes as finished; it reports
   structural problems across the whole backlog without changing anything.
5. Exit `0` on success, including a read that only *reports* `_problems`; `1` when a command
   failed; `doctor` also uses `2` for an `error`-level finding. Full vocabulary, exit codes
   and JSON shapes: `nanojira --help`, `nanojira <command> --help`.
