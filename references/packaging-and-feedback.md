# nanojira — packaging and feedback

Loaded on demand from `SKILL.md`; rarely needed during daily use.

## What this folder is

A self-contained, vendored copy of one accepted nanojira release — `dist/nanojira.mjs` and
`dist/nanojira-mcp.mjs`, plus the `bin/` wrappers — built by
`node tools/export-skill.mts <tag> <dest>` from the NanoJira project's own signed git tag.

**This folder contains no symlinks, anywhere.** To move or share it, `cp -R` the whole folder —
never symlink into it, and never symlink one file out of it (`bin/nanojira` in particular): the
wrapper resolves its own location with a plain `dirname "$0"` and does not follow a link.

## When nanojira does not fit

- **An existing issue tracker** (Jira, GitHub Issues, Linear, a team's own ticket system):
  nanojira is not a client for any of those and does not sync with them. Use the tracker's own
  tool or API.
- **Concurrent access from many unrelated processes at scale, or a remote team without shared
  filesystem access**: nanojira is a local, file-based tool for one backlog directory; it is not
  a server and has no remote mode.

## Problems with nanojira itself

Report a bug or a gap in nanojira's own behaviour to the NanoJira project's feedback backlog, not
into this repo's own tracker and not by patching the vendored files:
`sh <skill>/bin/nanojira --version` names the exact release; include it, the command run, the
actual result and the expected one in the report, per the NanoJira project's own feedback
process.
