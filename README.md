# nj — NanoJira

A local, file-based task tool for agents: Epics → Tasks → Subtasks, one
Markdown file per element, no database, no server, no runtime dependencies.
See `docs/SPECIFICATION.md` for the full spec.

## Layout

```
src/nj.ts       entry point (CommonJS)
src/commands/   one module per verb (cmd-*.ts)
src/core/       shared modules (args, config, load, output, …)
dist/nj         built, single-file artefact — what ships, checked into git
docs/           SPECIFICATION.md, ARCHITECTURE.md, DECISIONS.md
test/           black-box oracle against the CLI
tools/          build, perf, and refactor-safety tooling
```

`docs/ARCHITECTURE.md` has the module map and build graph in detail.

## Commands

```sh
npm run build        # write dist/nj from src/
npm run build:check  # verify dist/nj is byte-identical to a fresh build
npm run typecheck     # tsc --noEmit, strict, over src/**/*.ts
npm test              # build:check + the oracle (test/) against dist/nj
npm run perf          # build:check + performance gate (SPECIFICATION.md § 13)
```
