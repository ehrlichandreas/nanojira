# nj — NanoJira

A local, file-based task tool for agents: Epics → Tasks → Subtasks, one
Markdown file per element, no database, no server, no runtime dependencies.
See `docs/SPECIFICATION.md` for the full spec.
How to use it: `docs/GUIDE.md` (install: `docs/GUIDE.md` § 1; upgrading a v2
backlog: `docs/MIGRATION-v3.md`). Wiring an agent up to it: copy-paste block
for a project's `AGENTS.md` in `docs/AGENT-INSTRUCTIONS.md`.

`dist/nj` (the CLI) and `dist/nj-mcp` (an MCP server exposing the same
commands as tools over stdio, § 17) implement spec v3 through **v3.5**
(`docs/SPECIFICATION.md`): backlog location via `--backlog`, `NJ_BACKLOG` or
`.njrc`; configurable layout (`type`, `hierarchy`, `flat`, folder names); a
generated `STATUS.md`; internal files in `.nanojira/`; claims, `nj check`,
`nj find`, batch writes (`--id=A,B,C`), `nj --version`, `nj next` (claim the
top `--ready` leaf in one call, § 12b) and `nj log` (derive-only change
history, § 12c). A v2 backlog is migrated once with `nj doctor --fix`
(`docs/MIGRATION-v3.md`). Decisions behind it: `docs/DECISIONS.md` 86–156;
independent verification reports: `docs/verification/`.

## Layout

```
src/nj.ts       entry point: the CLI (real ES module)
src/nj-mcp.ts   entry point: the MCP server (§ 17), stdio
src/commands/   one module per verb (cmd-*.ts)
src/core/       shared modules (args, config, load, output, claims, batch,
                actor, flag-table, …)
dist/nj         built, single-file artefact — what ships, checked into git
dist/nj-mcp     built, single-file artefact — the MCP server, checked into git
docs/           SPECIFICATION.md, ARCHITECTURE.md, DECISIONS.md
test/           black-box oracle against the CLI and the MCP server
tools/          build, perf, and refactor-safety tooling
```

`docs/ARCHITECTURE.md` has the module map and build graph in detail.

## Commands

```sh
npm run build        # write dist/nj and dist/nj-mcp from src/
npm run build:check  # verify both are byte-identical to a fresh build
npm run typecheck     # tsc --noEmit, strict, over src/**/*.ts
npm test              # build:check + the oracle (test/) against dist/nj (and dist/nj-mcp)
npm run perf          # build:check + performance gate (SPECIFICATION.md § 13)
```
