---
name: nj
description: "A local, file-based task tool for agents: read, claim, update, close and note backlog elements (epics/tasks/subtasks) under a plain-Markdown backlog/ folder, no server or database. Use whenever an agent needs to track its own work, pick up the next ready item, or report on backlog state. Not for a team's existing issue tracker (Jira, GitHub Issues, Linear, ...) - nj is its own, separate backlog; do not point it at one of those."
license: MIT
metadata:
  version: "3.12.2"
---

# nj (NanoJira)

A local, file-based task tool: every element (epic, task or subtask) is one Markdown file under
`backlog/`, with no server, no database and no network call. This skill is a self-contained,
vendored copy of one accepted nj release — `dist/nj.mjs` and `dist/nj-mcp.mjs` — built by
`node tools/export-skill.mts <tag> <dest>` from the NanoJira project's own signed git tag.

**This folder contains no symlinks, anywhere.** To move or share it, `cp -R` the whole folder —
never symlink into it, and never symlink one file out of it (`bin/nj` in particular): the wrapper
resolves its own location with a plain `dirname "$0"` and does not follow a link.

## When this skill fits — and when not

- **Tracking an agent's own work against a local backlog**: creating tasks/subtasks, claiming
  and releasing them, moving them through a status list, leaving notes, checking acceptance
  criteria. This is what nj is for.
- **An existing issue tracker** (Jira, GitHub Issues, Linear, a team's own ticket system): nj is
  not a client for any of those and does not sync with them. Use the tracker's own tool or API.
- **Anything needing concurrent access from many unrelated processes at scale, or a remote team
  without shared filesystem access**: nj is a local, file-based tool for one backlog directory;
  it is not a server and has no remote mode.

## Usage

`sh <skill>/bin/nj <command> [flags]` (relative to this skill's own folder; `<skill>/bin/nj-mcp`
for the MCP server variant). Needs only Node.js ≥ 24 — no other dependency, no `node_modules`.
Works from any directory; `--backlog=<path>` points it at a specific backlog, otherwise it
searches upward from the current directory for one (`NJ_BACKLOG`, then the nearest `.njrc`, then
a `backlog/` folder).

**Always pass `--json` and branch on the parsed result, never on the human-readable prose** — the
prose is free to change; the JSON shape is the stable contract:

```
sh <skill>/bin/nj list --json
sh <skill>/bin/nj show --id=<id> --json
```

### The daily loop

- **Pick up the next piece of work**: `sh <skill>/bin/nj next --as=<name> --status=<doing-like
  status> --json` — claims the highest-priority ready item in the same call, so two agents never
  grab the same one. `{"ok": false, "error": "none_ready"}` is a normal outcome (nothing is
  ready), not a failure to react to with retries.
- **Claim a specific, already-known element** instead: `sh <skill>/bin/nj claim --id=<id>
  --as=<name>`.
- **Read before writing**: `sh <skill>/bin/nj show --id=<id> --json`, then `sh <skill>/bin/nj set
  --id=<id> --status=... [--title=... --priority=... --tags=... --assignee=...
  --depends-on=... --description=... --acceptance=...]` — set only the fields actually meant to
  change.
- **Finish or step away**: `sh <skill>/bin/nj set --id=<id> --status=<final status>` finishing
  releases the claim automatically in the same write; to step away without finishing, `sh
  <skill>/bin/nj release --id=<id> --as=<name>` instead.
- **Tick acceptance criteria** with `sh <skill>/bin/nj check --id=<id> --text="<substring>"` —
  never by hand-editing the checkbox text.
- **Sign actions** with `--as=<name>` on `claim`, `release`, `next` and `note`.
- **History**: `sh <skill>/bin/nj log --id=<id> --json` — creation, every claim/release, every
  note, in order. Field changes (status, priority, ...) are not logged this way; a note is the
  way to record the reason behind one.

### Rules for an agent using nj

1. The backlog is the only task list for whatever work this skill is scoped to — do not keep a
   second, parallel list elsewhere once nj is in use for it.
2. Never hand-edit a file under `backlog/`. Every change goes through a command, so the claim
   log, acceptance checks and file format all stay consistent.
3. Branch on `error` (a stable code), never on hint or prose text, which may change between
   releases.
4. Run `sh <skill>/bin/nj doctor` before treating a batch of backlog changes as finished; it
   reports structural problems (`_problems`, warnings, errors) across the whole backlog without
   changing anything.
5. On success, exit is always `0` — including a read that merely *reports* a data problem via
   `_problems`. A command that failed outright (nothing or only partially written) exits `1`; `nj
   doctor` alone also uses `2` for at least one `error`-level finding. Full vocabulary, exit codes
   and JSON shapes: `sh <skill>/bin/nj --help`, `sh <skill>/bin/nj <command> --help`.

## Problems with nj itself

Report a bug or a gap in nj's own behaviour to the NanoJira project's feedback backlog, not into
this repo's own tracker and not by patching the vendored files: `sh <skill>/bin/nj --version` names
the exact release; include it, the command run, the actual result and the expected one in the
report, per the NanoJira project's own feedback process.
