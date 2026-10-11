# nanojira — NanoJira

A local, file-based task tool for agents: Epics → Tasks → Subtasks, one
Markdown file per element, no database, no server, no runtime dependencies.

`dist/nanojira.mjs` is the CLI; `dist/nanojira-mcp.mjs` is an MCP server
exposing the same commands as tools over stdio (§ 17). Both implement spec
v3 — see `docs/SPECIFICATION.md` for the full spec, and `package.json` /
`docs/CHANGES.md` for the current version.

## Documentation

- **Using it:** `docs/GUIDE.md` (installing: § 1)
- **Wiring an agent up to it:** the copy-paste block for a project's
  `AGENTS.md`, in `docs/AGENT-INSTRUCTIONS.md`
- **Upgrading a v2 backlog:** one-time, via `nanojira doctor --fix` — see
  `docs/MIGRATION-v3.md`
- **Upgrading from the old `nj` CLI name:** `docs/MIGRATION-v4.md`
- **Upgrading from an earlier nanojira release:** `docs/CHANGES.md`
- **Why things are the way they are:** `docs/DECISIONS.md` (entries
  86–177); independent verification reports in `docs/verification/`

## Quick start

```sh
$ bin/nanojira init
Created backlog at …/proj/backlog
  epics/ tasks/ subtasks/ archive/ .nanojira/
  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md
```

(Or set up an alias so plain `nanojira` works — see `docs/GUIDE.md` § 1.)
From there, `docs/GUIDE.md` covers creating epics/tasks/subtasks, claiming
work, and every command's flags.

## Features

- **Backlog location:** `--backlog`, `NJ_BACKLOG`, or `.njrc` — accepted
  before the command word as well as after.
- **Configurable layout:** `type`, `hierarchy`, or `flat`, with custom
  folder names.
- **Generated `STATUS.md`:** switchable off per backlog
  (`layout.statusFile: false`) for several agents sharing one working tree.
- **Internal files** live in `.nanojira/`.
- **Claims, `nanojira check`, `nanojira find`, batch writes**
  (`--id=A,B,C`), and `nanojira --version`.
- **`nanojira next`:** claims the top `--ready` leaf in one call,
  respecting an existing `assignee` (§ 12b).
- **`nanojira log`:** derive-only change history (§ 12c).
- **`nanojira set --add-tags`/`--remove-tags`:** incremental, batch-aware
  tag edits.
- **Per-command help:** `nanojira <command> --help` (including `nanojira
  rm --help`) shows that command's own flags and allowed values.
- **"Did you mean?":** an invalid `--type`/`--status`/`--priority` names
  the nearest valid one, when there is one.
- **Acceptance-quality warnings:** three never-blocking `doctor` warnings,
  each switchable off per backlog via `"problems": {"ignore": [...]}`.
- **Config validation:** an unrecognised config key is a warning, not a
  hard failure; an optional `"minVersion"` fails every command with a
  clear message when `nanojira` is older than the configured minimum.

### v3.8 — plan a whole tree in one call

`nanojira new`/`set --input=<file|->` take a JSON plan (an object, or for
`new` an array with `children` nesting) instead of field flags:

- A whole epic → tasks → subtasks tree in one call.
- Cross-references via `ref`/`depends_on`, resolved before any write.
- `--dry-run` to preview.
- `acceptance` as a JSON array of checkbox lines.
- A write that reaches the last configured status now releases the
  element's existing claim in the same call (`released: "<holder>"`).
- `nanojira show --json` on a single element carries an additive `entry`,
  identical to `entries[0]`.

### v3.9 — reparenting

`nanojira set --parent=<id>` reparents a task or subtask in place: id,
body, notes and claim log are unchanged, using the same validation `new
--parent` already uses (missing/wrong-type/archived/epic). The file (or
whole folder, under `hierarchy`) moves with it in the same write.

A third acceptance-quality warning, `done:open_acceptance`, fires for a
`done` element with at least one unticked acceptance box, naming the
count wherever the other two warnings already do.

See `docs/GUIDE.md` §§ "Creating a whole plan with `--input`",
"Reparenting" and "Acceptance-quality warnings" for the how-to, and
`docs/CHANGES.md` 3.8.0/3.9.0 for the full write-up.

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

## Development

Building and testing this repo (not to be confused with `nanojira`'s own
CLI commands, above):

```sh
npm run build        # write dist/nanojira.mjs and dist/nanojira-mcp.mjs from src/
npm run build:check  # verify both are byte-identical to a fresh build
npm run typecheck     # tsc --noEmit, strict, over src/**/*.ts
npm test              # build:check + the oracle (test/) against dist/nanojira.mjs (and dist/nanojira-mcp.mjs)
npm run perf          # build:check + performance gate (SPECIFICATION.md § 13)
```
