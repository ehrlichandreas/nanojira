# Migrating a backlog from v2 to v3

For anyone with an existing NanoJira backlog. The rules are § 4 "Storage and
Layout" and § 14 step 0 of `docs/SPECIFICATION.md`, with DECISIONS 93, 95,
101 and 102; this page says what they mean for you.

One command migrates a v2 backlog — and until you run it, `nanojira` refuses to
work on the old layout rather than guess.

## What changes

A v2 backlog keeps its bookkeeping at the top level. v3 moves everything only
`nanojira` needs into one hidden folder, so the top level shows just your elements
and the two human-facing files:

| v2 | v3 |
|---|---|
| `backlog/.nanojira.json` | `backlog/.nanojira/config.json` — same bytes |
| `backlog/.ids/` | `backlog/.nanojira/ids/` — same tombstones |
| `backlog/.nanojira-index.json` (a cache, if present) | deleted; the future index lives at `.nanojira/index.json` |
| `.gitignore` line `.nanojira-index.json` | `.nanojira/index.json` (rules below) |

Element files do not move and do not change: a v2 backlog is grouped by type,
and `type` is v3's default layout. Everything else v3 adds — `STATUS.md`, the
`layout` block — follows from defaults; nothing has to be written for them.

## Before you migrate: `legacy_layout`

On a v2 backlog, **every command except `nanojira doctor` exits 1 with
`legacy_layout`** and changes nothing, pointing at `nanojira doctor --fix`. That
holds however the backlog is reached — the upward search, `--backlog`,
`NJ_BACKLOG` or a `.njrc` (DECISIONS 101): the backlog is there, only old.
`nanojira init` at a v2 backlog is `exists`, like any occupied target.

`nanojira doctor` runs, reads the configuration and tombstones from their v2
places, and reports `backlog:legacy_layout` as an error (exit 2) together
with every other finding.

## The migration: one `nanojira doctor --fix`

```sh
cd <your project>
nanojira doctor            # expect backlog:legacy_layout, exit 2
nanojira doctor --fix      # step 0 migrates, then the usual repairs run
nanojira doctor            # expect a clean report
```

Step 0 of `--fix`, exactly:

1. create `.nanojira/`;
2. move `.nanojira.json` to `.nanojira/config.json` and `.ids/` to
   `.nanojira/ids/` — one `rename` each; the configuration's content is not
   rewritten;
3. delete `.nanojira-index.json` if present;
4. in `.gitignore`, replace the line `.nanojira-index.json` by
   `.nanojira/index.json` — **only when that line is present verbatim**. A
   trailing `\r` does not count against "verbatim", and the replaced line
   keeps its line ending (CRLF stays CRLF). Anything else about the file —
   the line missing, reworded, commented — leaves `.gitignore` untouched,
   and a note says so. A missing `.gitignore` is not created; a note says so
   too;
5. replace `README.md` by the v3 text, but **only when it is byte-identical**
   to the text a v2 `nanojira init` wrote — your own edits are never overwritten; a
   README that differs is left exactly as it is, and a note says so (see the
   appendix).

The remaining `--fix` steps then run as always (§ 14), including writing
`STATUS.md`. The exit code is the state after the repairs: `0` when no error
remains.

## When both places exist: nothing moves

If the backlog has the v2 **and** the v3 place of the configuration, or of
the tombstones, the migration is ambiguous. `--fix` then moves nothing,
merges nothing, and — by the rule that `--fix` writes nothing while the
backlog is not a valid v3 backlog (DECISIONS 93, 95 B21) — runs no later step
either. `backlog:legacy_layout` stays an error, exit 2, and the report names
both places.

An **empty** `.nanojira/` folder does not count as the v3 place; ambiguity
needs a v3 configuration or v3 tombstones (DECISIONS 101).

To resolve it, decide by hand which copy is right — usually the one git
history shows as newer — remove the other, and run `nanojira doctor --fix` again.
Never merge tombstone folders by deleting files: a tombstone is what keeps an
ID from being reused.

## What is never touched

- the bytes of every element file, active and archived;
- the configuration's content (it is moved, not rewritten — a v2
  configuration without `layout` is valid v3 and means the defaults);
- the tombstones' names and content;
- every `.gitignore` line other than the one pattern above;
- `README.md`, **unless** it is still byte-identical to what a v2 `nanojira init`
  wrote — see the appendix;
- anything outside the backlog, including your `.njrc` files — a `.njrc`
  points at the backlog folder, which stays where it is.

## What to commit afterwards

```sh
git add -A backlog .gitignore      # wherever your .gitignore lives
git status                         # review before committing
git commit -m "Migrate the backlog to the NanoJira v3 layout"
```

Expect git to show:

- `backlog/.nanojira.json` → `backlog/.nanojira/config.json` and
  `backlog/.ids/*` → `backlog/.nanojira/ids/*` as **renames** with unchanged
  content;
- the one changed `.gitignore` line, if it was there verbatim;
- `README.md` rewritten to the v3 text, if you never edited it — otherwise
  no change to it at all;
- a new `backlog/STATUS.md`;
- no change to any element file. If git shows one, stop and look: the
  migration does not write element files, so the change came from somewhere
  else.

`.nanojira-index.json` was never committed (it was ignored), so its deletion
does not appear.

**Everyone on the team moves together.** A v2 `nanojira` does not know
`.nanojira/`: after the migration it finds `backlog/` without its
configuration and stops with `backlog_without_config`; a v3 `nanojira` refuses the
v2 layout. Upgrade `nanojira` everywhere, then migrate once and push.

## Using the new layouts afterwards

Migration keeps grouping by type. To use `hierarchy` or `flat`, or to rename
folders, add a `layout` block to `.nanojira/config.json` and run
`nanojira doctor --fix` once more; see `docs/GUIDE.md` § 5.

---

## Appendix — the `README.md` that `nanojira init` writes

**Question raised by the Oracle, RULED by the lead (DECISIONS 102).** The
README that `nanojira init` wrote under v2 (the same text as this repository's
`backlog/README.md` before v3) described v2 only — `.ids/`,
`.nanojira-index.json`, type folders only, no `STATUS.md`. The text was never
spec-defined: § 4 names the file and nothing more ("written by init; format
notes for humans"), no golden fixture pins it, and AC-1 only checked that it
exists and is non-empty.

**Ruled:**

- `nanojira init` now writes the v3 text under v3 — a fact pinned by test, not a
  byte-exact golden: it names `.nanojira/` and does not name the v2 places.
  The exact wording may still change; what it must say does not.
- § 14 step 0 amends migration to match: `README.md` is replaced by the v3
  text **only when it is byte-identical** to the text a v2 `nanojira init` wrote —
  the migration above's step 5. An edited README is always left alone, with
  a note, never guessed at.

**Illustrative v3 text** — accurate for v3 with defaults, and deliberately
free of details that a configuration can change; the shipped wording may
differ in phrasing while stating the same facts:

```markdown
# Backlog

This folder is a NanoJira backlog: one Markdown file per element (epics,
tasks, subtasks). Where the files lie is set by `layout` in
`.nanojira/config.json` — by default one folder per type (`epics/`,
`tasks/`, `subtasks/`), with finished work in `archive/`.

Every file has a frontmatter block between `---` lines and a free Markdown
body. The frontmatter is the truth; the body belongs to you, except for the
`# H1` (mirrors `title`), the `## Notes` section written by `nanojira note`, and
the sections `nanojira new`/`nanojira set` write when asked to.

An element is *ready to work* when its status is the first configured status,
all `depends_on` targets are done, it carries no error, and it has a
non-empty `## Description` (plus `## Acceptance Criteria` for tasks and
subtasks). A heading with nothing under it counts as absent — that is
deliberate.

`STATUS.md` is a generated overview by status. Do not edit it; `nanojira` rewrites
it after every change, and `nanojira doctor --fix` repairs it.

`.nanojira/` holds what only `nanojira` needs: the configuration and `ids/`, one
empty tombstone file per allocated ID. Both are versioned and must be
committed — the tombstones are what guarantee IDs are never reused. Do not
delete them. Only `.nanojira/index.json` (a cache) and temporary files are
ignored.

Useful commands: `nanojira`, `nanojira list --ready`, `nanojira show --id=…`,
`nanojira new --type=task --parent=EPIC-001 --title="…"`, `nanojira doctor`.
```
