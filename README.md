# nanojira — NanoJira

A local, file-based task tool for agents: Epics → Tasks → Subtasks, one
Markdown file per element, no database, no server, no runtime dependencies.
See `docs/SPECIFICATION.md` for the full spec.
How to use it: `docs/GUIDE.md` (install: `docs/GUIDE.md` § 1; upgrading a v2
backlog: `docs/MIGRATION-v3.md`; upgrading from the old `nj` CLI name:
`docs/MIGRATION-v4.md`). Wiring an agent up to it: copy-paste block
for a project's `AGENTS.md` in `docs/AGENT-INSTRUCTIONS.md`.
Upgrading from an earlier nanojira release: `docs/CHANGES.md`.

`dist/nanojira.mjs` (the CLI) and `dist/nanojira-mcp.mjs` (an MCP server exposing the same
commands as tools over stdio, § 17) implement spec v3 (`docs/SPECIFICATION.md`;
current version: see `package.json` / `docs/CHANGES.md`): backlog
location via `--backlog`, `NJ_BACKLOG` or
`.njrc`, accepted before the command word as well as after; configurable
layout (`type`, `hierarchy`, `flat`, folder names); a generated `STATUS.md`
(switchable off per backlog, `layout.statusFile: false`, for several
agents sharing one working tree); internal files in `.nanojira/`; claims,
`nanojira check`, `nanojira find`, batch writes (`--id=A,B,C`), `nanojira --version`, `nanojira
next` (claim the top `--ready` leaf in one call, respecting an existing
`assignee`, § 12b), `nanojira log` (derive-only change history, § 12c) and `nanojira
set --add-tags`/`--remove-tags` (incremental tag edits, batch-aware). `nanojira
<command> --help` (including `nanojira rm --help`) shows that command's own
flags and allowed values, and an invalid `--type`/`--status`/`--priority`
names the nearest valid one ("did you mean?") when there is one. Three new,
never-blocking `doctor` warnings flag acceptance-criteria quality, each
switchable off per backlog via `"problems": {"ignore": [...]}`; an
unrecognised config key is a warning too, not a hard failure, and an
optional `"minVersion"` fails every command with a clear message on an
`nanojira` too old to honour the rest of this paragraph. **v3.8**: `nanojira new`/
`nanojira set --input=<file|->` take a JSON plan (object, or for `new` an
array with `children` nesting) instead of field flags — a whole epic →
tasks → subtasks tree in one call, cross-references via `ref`/`depends_on`
resolved before any write, `--dry-run` to preview one, `acceptance` as a
JSON array of checkbox lines; a write that reaches the last configured
status now releases the element's existing claim in the same call
(`released: "<holder>"`); `nanojira show --json` on a single element carries an
additive `entry` identical to `entries[0]`. **v3.9**: `nanojira set
--parent=<id>` reparents a task or subtask in place — id, body, notes and
claim log unchanged, the same validation `new --parent` already uses
(missing/wrong-type/archived/epic), the file (or whole folder, under
`hierarchy`) moving with it in the same write; and a third
acceptance-quality warning, `done:open_acceptance`, for a `done` element
with at least one acceptance box still unticked, naming the count
wherever the other two already appear. See `docs/GUIDE.md` §§ on
"Creating a whole plan with `--input`", "Reparenting" and
"Acceptance-quality warnings", and `docs/CHANGES.md` 3.8.0/3.9.0 for the
how-to and the full write-up. A v2 backlog is migrated once with `nanojira
doctor --fix` (`docs/MIGRATION-v3.md`). Decisions behind it:
`docs/DECISIONS.md` 86–177; independent verification reports:
`docs/verification/`.

## Layout

```
SKILL.md              the skill, at the repo root (§ 18) — this repo IS the skill folder
bin/nanojira          generated launcher (sh), checked into git
bin/nanojira-mcp      generated launcher (sh), checked into git
bin/nanojira.cmd      generated launcher (Windows), checked into git
bin/nanojira-mcp.cmd  generated launcher (Windows), checked into git
src/nanojira.ts       entry point: the CLI (real ES module)
src/nanojira-mcp.ts   entry point: the MCP server (§ 17), stdio
src/commands/         one module per verb (cmd-*.ts)
src/core/             shared modules (args, config, load, output, claims, batch,
                      actor, flag-table, input, …)
dist/nanojira.mjs     built, single-file artefact (ESM) — what ships, checked into git
dist/nanojira-mcp.mjs built, single-file artefact (ESM) — the MCP server, checked into git
docs/                 SPECIFICATION.md, ARCHITECTURE.md, DECISIONS.md
test/                 black-box oracle against the CLI and the MCP server
tools/                build (incl. bin/'s wrapper.sh/wrapper.cmd templates), perf,
                      export, and refactor-safety tooling
```

`docs/ARCHITECTURE.md` has the module map and build graph in detail. A
consuming team that does not work in this repo directly exports a
self-contained copy of just `SKILL.md`, `bin/` and `dist/` from a signed
tag (`node tools/export-skill.mts <tag> <dest>`) and copies that folder
wherever it is needed; see `docs/SPECIFICATION.md` § 18 and
`docs/GUIDE.md` § 1.

## Commands

```sh
npm run build        # write dist/nanojira.mjs and dist/nanojira-mcp.mjs from src/
npm run build:check  # verify both are byte-identical to a fresh build
npm run typecheck     # tsc --noEmit, strict, over src/**/*.ts
npm test              # build:check + the oracle (test/) against dist/nanojira.mjs (and dist/nanojira-mcp.mjs)
npm run perf          # build:check + performance gate (SPECIFICATION.md § 13)
```
