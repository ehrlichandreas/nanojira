# Migrating from the `nj` CLI (v3) to `nanojira` (v4)

For anyone invoking the CLI directly, scripting around it, or wiring an agent
up to it. This is a **naming change only**: the binary you run is renamed
from `nj`/`nj-mcp` to `nanojira`/`nanojira-mcp`. No backlog file, no config
key, no JSON shape, no exit code and no flag changed — nothing under
`backlog/` needs touching, and `nanojira doctor` reports nothing new on a
backlog that was clean under v3.

## What changes

| v3 | v4 |
|---|---|
| `bin/nj` | `bin/nanojira` |
| `bin/nj-mcp` | `bin/nanojira-mcp` |
| `bin/nj.cmd` | `bin/nanojira.cmd` |
| `bin/nj-mcp.cmd` | `bin/nanojira-mcp.cmd` |
| `dist/nj.mjs` | `dist/nanojira.mjs` |
| `dist/nj-mcp.mjs` | `dist/nanojira-mcp.mjs` |
| `package.json` `"bin"` keys `nj`/`nj-mcp` | `nanojira`/`nanojira-mcp` |
| printed banner `nj <version>` / `nj-mcp <version>` | `nanojira <version>` / `nanojira-mcp <version>` |
| MCP `serverInfo.name` `nj-mcp` | `nanojira-mcp` |
| error hints naming the command (e.g. `` run `nj doctor` ``) | `` run `nanojira doctor` `` |

Everything else — commands, flags, `--json` shapes, exit codes, the
`.nanojira/` layout, `NJ_BACKLOG`/`.njrc` resolution, claims, the MCP tool
surface — is unchanged from v3.

## What you need to update

- **A vendored skill folder.** Re-export it: `node tools/export-skill.mts
  <tag> <dest>` against a v4 signed tag, then re-copy wherever it's used
  (`cp -R`). The old folder's `bin/nj`/`bin/nj-mcp` keep working as long as
  you keep it, but a fresh export is always the v4 names — there is no
  mixed-name export.
- **Any alias or script** that hardcodes `nj`/`nj-mcp` (an `alias
  nj=".../dist/nj.mjs"`, a CI step, a Makefile target): rename the target to
  `nanojira`/`nanojira-mcp`, or re-point the alias at the new path.
- **An MCP client config** naming `nj-mcp` as the server command: update it
  to `nanojira-mcp` (same args, same `--backlog=`).
- **A project's `AGENTS.md`** carrying the copy-paste block from
  `docs/AGENT-INSTRUCTIONS.md`: replace it with the v4 version — every
  example in it now says `nanojira`.
- **A fork or a local checkout that still builds from source**: `npm run
  build` regenerates `dist/*.mjs` and `bin/*` under the new names from
  `package.json`'s `bin` field; there is nothing to hand-edit.

## What does not change

- The backlog layout, `.nanojira/config.json`, claims, IDs, `STATUS.md` —
  byte-for-byte the same as v3 wrote them.
- `NJ_BACKLOG`, `NJ_AUTHOR`, `NJ_NODE`, `NJ_NOW`, `NJ_FAULT` and `.njrc` —
  none of these environment variables or the config marker filename
  changed; only the command you invoke did.
- Every command, flag, JSON field, failure code and exit code from v3.

**Everyone on the team moves together**, the same as any binary rename: an
agent or script still invoking the old `nj`/`nj-mcp` paths from a pre-v4
export keeps working against that export (nothing there was deleted out
from under it), but a fresh v4 export only ever produces the new names —
there is no dual-name release.
