# nanojira — where the full documentation lives

Loaded on demand from `SKILL.md`. This folder ships only the CLI and `SKILL.md`; the full
documentation stays in the NanoJira repository, at the tag of the release you have:

- **Guide** (how-to, one section per feature):
  `https://github.com/ehrlichandreas/nanojira/blob/v<version>/docs/GUIDE.md`
- **Specification** (the normative rules: every flag, JSON shape, failure code and exit code):
  `https://github.com/ehrlichandreas/nanojira/blob/v<version>/docs/SPECIFICATION.md`
- **Changes per release**:
  `https://github.com/ehrlichandreas/nanojira/blob/v<version>/docs/CHANGES.md`

`<version>` is `metadata.version` in this folder's `SKILL.md` (also printed by
`nanojira --version`), so the links always match the code you run — never read `main` for a
vendored copy. Offline, `nanojira --help` and `nanojira <command> --help` list every flag and
its allowed values.

## Guide sections

- § 1 — Install
- § 2 — Start a backlog
- § 3 — Point nanojira at a backlog
- § 4 — Many projects on one machine
- § 5 — The daily loop (and `--json` for agents)
- § 6 — Descriptions and acceptance criteria
- § 7 — Layouts
- § 8 — `STATUS.md`
- § 9 — Archive
- § 10 — `doctor` and `doctor --fix`
- § 11 — Who's acting: `NJ_AUTHOR` and `--as`
- § 12 — `nanojira unarchive`
- § 13 — `nanojira claim` / `nanojira release`
- § 14 — `nanojira next`
- § 15 — `nanojira log`
- § 16 — `nanojira check`
- § 17 — `nanojira find`
- § 18 — Batch writes: `--id=A,B,C`
- § 19 — `nanojira-mcp` — the MCP wrapper
- § 20 — Failure codes an agent should handle
- § 21 — Creating a whole plan with `--input`
- § 22 — Reparenting: `nanojira set --parent`
- § 23 — Acceptance-quality warnings
- § 24 — Tags: `TAGS.md`, `nanojira tags`, and healing drift
- § 25 — Shrinking write results: `--fields` / `--quiet`
- § 26 — Umbrella tickets: make the parts children
- § 27 — Fewer notes, fewer events: `show --notes=` / `log --last=`
- § 28 — Probe before you apply: `--dry-run`
- § 29 — `NJ_NOW` — a deterministic clock (verification/testing only)
- § 30 — `NJ_ON_CHANGE` — push changes to an outside board
