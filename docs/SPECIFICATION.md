# NanoJira — Specification v3

A local, file-based task tool for agents. No database, no server, no
dependencies. Epics → Tasks → Subtasks, one Markdown file per element.

Status: **v3 draft, 2026-09-24 — released for implementation 2026-09-28
(DECISIONS 87), not yet implemented.**
v2 was approved by the user on 2026-09-23 and is what `dist/nj` implements.
v3 adds a configurable backlog location (`--backlog`, `.njrc`), a configurable
layout (groupings, folder names), the generated `STATUS.md` and the
`.nanojira/` folder for internal files — DECISIONS 86, which also fixes the
implementation order. Changes since are recorded in `docs/DECISIONS.md`.

---

## 1. Purpose and Scope

**What it is for.** An agent should be able to tell what is to be done and
what success looks like — without Jira, without a database, without a UI.
Everything lives as readable text inside the project and travels with git.

**What it is not.** Not a replacement for a multi-user project tool. No
sprints, no story points, no time tracking, no reports, no permissions, no
synchronisation.

---

## 2. Language Policy

**The tool is English. The data is multi-lingual.**

| Layer | Language |
|---|---|
| Field names (`id`, `parent`, `depends_on`, …) | English, fixed |
| Status values, section headings | English by default, configurable (§ 5) |
| CLI messages, error texts, help | English |
| Exit codes | language-free |
| **Values: `title`, body text, `assignee`, `tags`** | **any language, any script** |

Values are stored byte-exact UTF-8 and are never transliterated or translated.
A backlog may hold German titles next to Japanese descriptions; the tool does
not care. The **only** value the tool normalises on write is `title`
(single-line, trimmed — § 7); that exception is carved out here deliberately.

`done` is the terminal status and **cannot be renamed or moved** within the
status list, because `--ready` and `depends_on` resolution depend on it. The
status list's **first entry** is the initial state and the meaning of
"ready" (§ 5) — it, too, is load-bearing, but renaming it is explicitly
allowed; only its *position* matters.

---

## 3. Runtime

| | |
|---|---|
| Language | Node.js ≥ 24, from `workspace/portable/runtime/<platform>/bin/node` |
| Dependencies | **none** at runtime — no external service, `dist/nj` runs as one file without `node_modules` and without network; build-time tooling may declare `devDependencies` |
| Platforms | `darwin-arm64`, `linux-x64` (the portable tool tree's platforms) |
| Entry point | one executable script, `dist/nj` (shebang `#!/usr/bin/env node`; where `PATH` may lack Node ≥ 24, invoke as `<runtime-node> dist/nj`) |

What ships is `dist/nj`, a single file. It is built by `npm run build`
from the sources — the entry `src/nj.ts` and the modules in `src/commands/`
and `src/core/` — and it is committed: a fresh build must be byte-identical
to the committed file (`npm run build:check`), so a stale bundle fails at
once. Whoever changes anything under `src/` rebuilds and commits `dist/nj` in
the same commit. The oracle and the recorded corpus run against `dist/nj`,
and against the sources, which behave identically. The root `package.json`
carries metadata, `bin`, the `build` and `test` scripts, and
`devDependencies` for build-time tooling (TypeScript, esbuild); it carries no
runtime `dependencies` and no `type` field — a root `"type": "module"` would
make Node load every oracle suite as an ES module and break it. Everything
under `src/`, entry included, is a real TypeScript ES module
(`import`/`export`); a single `src/package.json` declares `"type": "module"`
for that whole subtree and is not part of `dist/nj`.

"Dependencies: none" names what `nj` depends on to run — not on Jira, not on
any other external service, and not on a package fetched at runtime. It was
misread once as "no npm packages at all" and tightened on that misreading
(`dist/nj` briefly required no dependency "at build time" either); that
reading is withdrawn (DECISIONS 83). Development tooling choosing its own
libraries — a bundler, a type checker — does not compromise what round one
actually promises: a single shipped file, no `node_modules`, no network, at
the moment an agent runs `nj`.

Python is ruled out: the tool tree ships Node for both platforms and only
macOS system Python.

---

## 4. Storage and Layout

```
<backlog>/                     default location: <project>/backlog/ (below)
├── README.md                  written by init; format notes for humans
├── STATUS.md                  generated overview by status (below)
├── .gitignore                 written by init; ignores the index and temp files
├── epics/                     EPIC-001.md …   ┐ group "type" (default);
├── tasks/                     TSK-001.md …    │ folder names configurable (§ 5)
├── subtasks/                  SUB-001.md …    ┘
├── archive/                   archived elements (§ 11); name configurable
└── .nanojira/                 everything only nj itself needs
    ├── config.json            configuration (§ 5)
    ├── ids/                   ID tombstones (§ 8)
    └── index.json             search index — round two (§ 13), never committed
```

**Content and bookkeeping are separated.** The top level of a backlog shows
the elements and the two human-facing files; everything that exists only for
`nj` — configuration, tombstones, the future index — lives in one hidden
folder, `.nanojira/`. The v2 layout (`.nanojira.json` and `.ids/` at the top
level) is a **legacy layout**: every command except `nj doctor` refuses it
with `legacy_layout` and points at `nj doctor --fix`, which migrates it (§ 14).

**One file per element; the grouping is configurable** (`layout.group`, § 5):

- **`type`** (default) — one folder per type, as drawn above. The type is
  immutable, so this placement can never become wrong through `nj`.
- **`hierarchy`** — the tree becomes the folder structure. An epic and a task
  each get a folder named after their ID that holds their own file; a subtask
  is a file in its task's folder:

  ```
  <backlog>/EPIC-001/EPIC-001.md
  <backlog>/EPIC-001/TSK-003/TSK-003.md
  <backlog>/EPIC-001/TSK-003/SUB-007.md
  ```

- **`flat`** — every element file directly in `<backlog>/`.

**The frontmatter is the truth, the location is derived from it** — from
`type` under `type`, from the `parent` chain under `hierarchy`. `nj` never
infers `type` or `parent` from where a file lies. It finds element files
wherever they lie: every `*.md` below the backlog except `README.md`,
`STATUS.md` and anything under `.nanojira/` is an element file, and it is
archived exactly when it lies below the archive folder. A file whose location
disagrees with the layout carries `type:folder` (group `type`) or
`layout:misplaced` (groups `hierarchy` and `flat`); it still loads and every
command still works on it. `nj doctor --fix` moves it (§ 14).

`nj` never changes `parent` (`nj set` has no `--parent`), so under
`hierarchy` a file moves only through `nj archive`, `nj doctor --fix`, or by
hand. Changing `layout` in the configuration is allowed at any time:
afterwards every element reports its old place, and one `nj doctor --fix`
moves the backlog into the new layout. The same step migrates a legacy
backlog. Grouping by type stays the default because it is the only grouping
no edit can invalidate; `hierarchy` freezes one view — the tree — into the
filesystem, which is worth it only where people browse the backlog without
`nj`.

A backlog is **self-contained** — moving the folder is enough. A `.njrc`
pointing at it (below) is outside the backlog and has to follow.

**Versioned state.** `.nanojira/config.json`, `.nanojira/ids/`, `README.md`,
`STATUS.md` and every element file are versioned — they travel with git and
must be committed. The only uncommitted artifacts are the index (§ 13) and
temp files (§ 12). `nj init` writes a `.gitignore` containing exactly two
patterns: `.nanojira/index.json` and `.nj-tmp-*`. `.nanojira/ids/` is never
ignored, by design.

### Status overview (`STATUS.md`)

A generated, read-only overview of the active backlog by status, so the state
is readable without `nj` — in an editor or a forge's web view.

- **Written** by `nj init` and after every successful write of `new`, `set`,
  `note`, `rm`, `archive` and `doctor --fix`, from a full scan, atomically
  (§ 12). **Never read** by `nj`: it is derived, never the truth.
- **Format** (normative, byte-exact; a golden fixture pins it):

  ```
  # Status

  ## todo (2)

  - [TSK-002](tasks/TSK-002.md) Not-covered-Blindstellen schliessen
  - [TSK-007](tasks/TSK-007.md) Parser haerten

  ## doing (0)

  ## done (1)

  - [EPIC-001](epics/EPIC-001.md) Verhaltensvertrag
  ```

  One `## <status> (<count>)` section per configured status, in configuration
  order, each present even when empty. Elements whose status is not configured
  follow in a last section `## ? (<count>)`, present only when non-empty.
  Within a section: `list` order (priority descending, id ascending, § 9).
  The link is the file path relative to the backlog, with `/` separators; the
  title is written as stored. Archived elements are not listed. Every line
  ends in `\n`, sections are separated by one empty line, the file ends in
  exactly one `\n`.
- **Staleness is tolerated, never hidden.** Two writers racing each regenerate
  it; the last rename wins and may be one write behind. Hand edits and git
  merges can leave it stale or conflicted. `nj doctor` compares it with a
  fresh rendering and reports `backlog:status_stale` (warning); `doctor --fix`
  regenerates it — which also resolves a merge conflict in it.
- **A failed overview never fails the write.** The element write is the
  operation; if `STATUS.md` cannot be written afterwards, the command keeps
  its exit code and prints `nj: warning: STATUS.md not updated (<reason>)` on
  stderr.
- `layout.statusFile: false` (§ 5) switches it off: nothing is written and
  `doctor` does not check it. An existing file is then left alone.
- **Cost:** one full scan per write — ≈200 ms at 10 000 elements (§ 13). The
  § 13 index trigger applies to writes as well once this lands.

### `nj init`

Creates the layout above with default configuration, the README, `STATUS.md`
and the `.gitignore`, at the location given by `--backlog`, `NJ_BACKLOG` or
the nearest `.njrc` (rules below, in that order); without any of them at
`./backlog`. The upward search for an existing `backlog/` is **not** used by
`init`. Refuses with `exists` if anything already exists at the target.

### Backlog location

Commands that need a backlog take its location from the **first** of these
sources that is set:

1. **`--backlog=<path>`** — accepted by every command (§ 9); relative to the
   working directory.
2. **`NJ_BACKLOG=<path>`** — relative to the working directory.
3. **The upward search.** Starting at the working directory and moving to the
   parent directory until the filesystem root, look in each directory for
   a. a `.njrc` that sets `backlog` — use its value; a relative value resolves
      against the directory containing that `.njrc`;
   b. a `backlog/` folder — use it.
   The **nearest** directory wins; within one directory `.njrc` wins over
   `backlog/`. So a `.njrc` in a repository root redirects the whole
   repository, while a project that has its own `backlog/` deeper down keeps
   it.
4. **Nothing found: exit 1, `no_backlog`, hard error.** Never fall back to a
   relative path, never operate on an empty backlog, never auto-create
   outside `nj init`.

**A chosen source is binding.** When the source picked by these rules does
not hold a backlog, the command exits 1 with an error that names the path and
the source, and never falls through to a lower source:

```
nj: no backlog at /abs/path (from --backlog)            invalid_backlog_flag
nj: no backlog at /abs/path (from NJ_BACKLOG)           invalid_backlog_env
nj: no backlog at /abs/path (from /abs/dir/.njrc)       invalid_backlog_njrc
```

"Holds a backlog" means `.nanojira/config.json` exists there. A folder with
`.nanojira/` but without `config.json`, or a `backlog/` found by the search
with neither, is `backlog_without_config` — the error says exactly that and
points at `nj doctor` (which tolerates the missing file and reports
`config:invalid`), never a plain "no backlog found". A folder with the legacy
`.nanojira.json` at its top level is `legacy_layout`, pointing at
`nj doctor --fix`.

Silently reporting "0 entries" from the wrong directory would be the worst
failure mode of a tool whose job is telling an agent what to do.

### `.njrc`

A project-level file, meant to be committed with the project, so relative
paths travel with the repository:

```
# NanoJira — where this project's backlog lives
backlog = ../shared/backlog
```

- One `key = value` per line. Whitespace around `=` and at both line ends is
  ignored; empty lines and lines whose first non-blank character is `#` are
  ignored. The value is literal — no quotes, no variables — except that a
  leading `~/` expands to the user's home directory.
- Lexing, exactly: an optional UTF-8 BOM at the start is dropped; a trailing
  `\r` counts as line-end whitespace (CRLF files work); a line splits at its
  **first** `=`, so the value may contain `=`; keys are case-sensitive
  (`Backlog` is unknown); a `#` after the first non-blank character is part
  of the value — only whole-line comments exist.
- A `.njrc` that exists but is not a readable regular file (a directory, a
  dangling symlink, no read permission) is `invalid_njrc` —
  `nj: invalid .njrc at <abs path>: <reason>`, no line number. A symlinked
  `.njrc` resolves a relative value against the directory where the link
  lies, not its target's. `~/.njrc` has no special role: it is read only
  when the home directory is on the search path, like any ancestor.
- Known keys: `backlog`. A `.njrc` without `backlog` (e.g. only comments) does
  not set a location; the search continues upward.
- An unknown key, a line without `=`, an empty value or a repeated key: exit
  1 with `invalid_njrc` and `nj: invalid .njrc at <abs path>: line <n>:
  <reason>` — strict for the same reason unknown flags are (§ 9). Only a
  `.njrc` the search actually reaches is parsed; a search stopped by
  `--backlog` or `NJ_BACKLOG` never reads one.

---

## 5. Configuration

`<backlog>/.nanojira/config.json` — as written by `nj init`:

```json
{
  "schema": 1,
  "statuses": ["todo", "doing", "blocked", "review", "done"],
  "sections": {
    "description": ["Description"],
    "acceptance": ["Acceptance Criteria"]
  },
  "layout": {
    "group": "type",
    "folders": {
      "epics": "epics",
      "tasks": "tasks",
      "subtasks": "subtasks",
      "archive": "archive"
    },
    "statusFile": true
  }
}
```

`init` writes the `layout` block out in full, so the defaults are visible
where they are changed. Every part of it is optional: a missing `layout`, or a
missing key inside it, means the default shown here — a migrated v2
configuration without `layout` is valid as it is.

Rules:

- `statuses`: non-empty, at least two entries, unique, each matching
  `[a-z_]+`. The **last** entry must be `done`; the **first** entry is the
  initial state and the meaning of "ready" (§ 9). Renaming entries is allowed;
  reordering is not (positions are load-bearing).
- `sections`: maps a role to a list of heading names. Headings are matched
  case-insensitively (§ 7). The lists exist so a backlog can rename its
  headings (`["Akzeptanzkriterien", "Acceptance Criteria"]`) without breaking
  the completeness check.
- `layout.group`: `type`, `hierarchy` or `flat` (§ 4).
- `layout.folders`: exactly the four keys `epics`, `tasks`, `subtasks`,
  `archive`, each a folder name matching `[A-Za-z0-9][A-Za-z0-9_-]*`, pairwise
  distinct, none of the form `EPIC-<n>`, `TSK-<n>` or `SUB-<n>` (those are
  folder names under `hierarchy`). Under `hierarchy` and `flat` only
  `archive` is used; the other three are still validated.
- `layout.statusFile`: `true` or `false` (§ 4, `STATUS.md`).
- An unknown key inside `layout` or `layout.folders` is invalid — a typo must
  not silently fall back to a default.
- Changing `layout` is always allowed; it never invalidates the configuration.
  The elements then report their old places, and `nj doctor --fix` moves them
  (§ 4, § 14).
- An invalid configuration makes every command except `nj doctor` fail with
  exit 1 and a pointer to `nj doctor`; `doctor` reports the defect (exit 2).

---

## 6. Data Model

### Required fields

| Field | Type | Rule |
|---|---|---|
| `id` | string | `EPIC-NNN`, `TSK-NNN`, `SUB-NNN` |
| `type` | enum | `epic` \| `task` \| `subtask`, must match the ID prefix |
| `parent` | ID | required for `task` and `subtask`, forbidden for `epic` |
| `title` | string | single line, non-empty |
| `status` | enum | from the configuration (§ 5), defaults to `statuses[0]` |
| `created` | timestamp | ISO-8601 UTC with `Z`, set on creation |
| `updated` | timestamp | ISO-8601 UTC with `Z`, refreshed on every write |

Timestamps are UTC because the backlog travels via git across time zones;
offset-less local times would be ambiguous. Format: `2026-09-21T18:02:44Z`.

**The hierarchy is strictly three levels.** Epic without parent, task under
epic, subtask under task. `nj new` rejects deeper nesting and wrong parent
types; `nj doctor` reports violations. `id` and `type` are **immutable** after
creation.

### Optional fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `priority` | enum | `normal` | `low` \| `normal` \| `high` \| `urgent` |
| `assignee` | string | empty | who (which agent) is on it; free text, no registry |
| `tags` | list | empty | filter dimension |
| `depends_on` | list of IDs | empty | dependencies, enables `--ready` |
| `archived` | timestamp | absent | set by `nj archive` (§ 11), tool-written only |

Missing optional fields are **not** worth a warning — that is the normal
case. Optional fields are written into a file only when explicitly set;
defaults are never materialised. `nj new` therefore omits `priority` unless
given.

### Deliberately excluded

`estimate`/story points, `sprint`/`milestone`, `due`, `order`, comments,
attachments, history. All of them can be added later without breaking
anything: the parser preserves unknown fields (§ 7), so a later field is an
additive change.

---

## 7. File Format

```markdown
---
id: TSK-007
type: task
parent: EPIC-001
title: Backend API Endpoints
status: doing
priority: high
assignee: coder-agent
tags: [backend, auth]
depends_on: [TSK-003]
created: 2026-09-21T17:30:12Z
updated: 2026-09-21T18:02:44Z
---

# Backend API Endpoints

## Description
Create `/login` and `/register` including error handling.

## Acceptance Criteria
- [ ] Password at least 8 characters
- [ ] Error responses carry a code, not free text
```

### Frontmatter grammar

- Enclosed by a `---` line at the start of the file and the next `---`.
- One `key: value` line per field. Split at the **first** `:`; one leading
  space is stripped from the value. `title: Login: Errors` yields
  `Login: Errors`.
- Keys: `[A-Za-z_][A-Za-z0-9_]*`.
- Values: a string, or `[a, b]` for lists. A value is written quoted (`"…"`)
  when it is empty or starts with `[` or `"`; inside quotes, `\"` and `\\`
  are recognised.
- **List items:** an unquoted item is any run of characters except `,` and
  `]`, trimmed of surrounding whitespace. A quoted item may contain `,` and
  `]`. The CLI rejects items containing `,` or `]` in `--tags`/`--depends-on`
  (documented limitation; such values can still be written to files by hand
  and round-trip through the parser).
- Lines whose first character is `#` are comments.
- UTF-8 BOM is stripped, `\r\n` is treated as `\n`. Files are always
  **written** as LF without BOM, regardless of how they were read.
- **Unreadable lines do not break the file.** They are reported as a problem
  (with line number) and the readable lines stay in use. The element remains
  visible.

### Title

`title` in the frontmatter is the **truth**. It is additionally mirrored as
`# H1` in the body — for humans. On every title change, `nj` rewrites the H1.
An existing H1 as the first non-empty body line is synchronised; if there is
none, none is inserted. `nj doctor` reports drift.

Titles are normalised on write: line breaks become spaces, leading and
trailing whitespace is dropped. This is the single exception to § 2's
byte-exact rule.

### Body

The body belongs to the user. `nj` writes it back **byte-for-byte unchanged**
— with exactly three sanctioned exceptions: the H1 synchronisation above,
`nj note` appending under `## Notes` (§ 10), and `nj new`/`nj set` writing a
configured **section role** (`description`, `acceptance`) when one of the
section flags in § 9 is given. Unknown sections are preserved.

Section matching is line-based and **not** fenced-code-aware: a
`## Description` line inside a fenced block is a section heading for reads and
writes alike, so a section write replaces that region and destroys the fence
content. Fence-aware matching is deliberately out of scope for round one.

### Completeness (derived, never stored)

Three levels, derived on every read. There is no stored `complete` field — it
would drift.

| Level | Condition |
|---|---|
| **Error** | at least one code with Doctor = `error` (§ problem codes below) |
| **Incomplete** | a `task` or `subtask` whose `## Description` section is absent or empty, or whose acceptance section is absent or empty; or an `epic` whose `## Description` section is absent or empty |
| **Complete** | none of the above |

A section counts as present only if it exists **and** contains at least one
non-empty line below the heading (a heading followed by nothing does not
count — an empty `## Acceptance Criteria` would let an agent look complete
while having zero criteria). Headings are level-2 (`## `), matched
case-insensitively against the configured names; a trailing `:` is tolerated.

Epics are exempt from the acceptance requirement: an epic's acceptance is the
union of its children's.

### Problem codes — closed vocabulary

`_problems` (§ 9) carries codes from this closed table. **Adding a code is
additive; renaming or redefining one is forbidden.** Each code maps to the
condition that produces it:

| Code | Produced by | Doctor | Blocks `--ready` |
|---|---|---|---|
| `frontmatter:unreadable` | frontmatter block cannot be parsed | error | yes |
| `file:unreadable` | element file cannot be read at all (dangling symlink, permissions) | error | yes |
| `duplicate_id` | two files carry the same `id` | error | yes |
| `missing:title` | `title` absent or empty | error | yes |
| `missing:status` | `status` absent — defaulted to `statuses[0]` | warning | no |
| `missing:created` / `missing:updated` | timestamp absent — taken from file mtime | warning | no |
| `id:derived` | `id` absent — derived from file name | warning | no |
| `id:mismatch` | `id` ≠ file name | error | yes |
| `type:derived` | `type` absent — derived from ID prefix | warning | no |
| `type:folder` | file lies in the wrong type folder (group `type`) | error | yes |
| `layout:misplaced` | file does not lie where group `hierarchy` or `flat` puts it (§ 4) | error | yes |
| `parent:orphaned` | `parent` absent on task/subtask | warning | no |
| `parent:dangling` | `parent` points at nothing | error | yes |
| `parent:cycle` | `parent` graph contains a cycle | error | yes |
| `parent:hierarchy` | three-level structure violated | error | yes |
| `depends_on:dangling` | `depends_on` points at nothing | error | yes |
| `depends_on:cycle` | `depends_on` graph contains a cycle | error | yes |
| `unknown:status` | `status` not in the configured list | warning | yes |
| `unknown:priority` | `priority` not in the configured values | warning | no |
| `done:open_children` | `done` set while children are not `done` | warning | yes |
| `archive:not_done` | archived element is not `done` | error | yes |
| `archive:split` | part of a subtree in archive, part outside | error | yes |
| `title:h1_mismatch` | H1 ≠ `title` | warning | no |
| `incomplete:description` | description section absent/empty | — | yes |
| `incomplete:acceptance` | acceptance section absent/empty (task/subtask) | — | yes |
| `active_refs_archived` | `depends_on` points into the archive (satisfied) | — | no |
| `id:no_tombstone` | element file has no tombstone (hand-created, or partial tombstone loss) | warning | no |
| `backlog:stray_tmp` | stray `.nj-tmp-*` file (crashed write), backlog-level | warning | — |
| `backlog:ids_missing` | `.nanojira/ids/` absent or empty while element files exist, backlog-level | error | — |
| `config:invalid` | `.nanojira/config.json` violates § 5 (backlog-level) | error | — |
| `backlog:legacy_layout` | v2 layout (`.nanojira.json`, `.ids/` at the top level), backlog-level | error | — |
| `backlog:status_stale` | `STATUS.md` differs from a fresh rendering or is missing (§ 4), backlog-level | warning | — |

The two axes are independent: **Doctor** says whether a code is a doctor
finding, **Blocks `--ready`** says whether it keeps an element out of the
ready set. `doctor` reports every code whose Doctor column is `error` or
`warning`; it exits 2 exactly when at least one `error` finding exists —
warnings are reported but exit 0. Codes marked `—` are workflow state, never
doctor findings: they surface in `list`, `_problems` and write feedback only.
Completeness levels: **Error** ⇔ at least one code with Doctor = `error`;
**Incomplete** ⇔ an `incomplete:*` code is present and no Error. Consistency
invariant: for element-level codes, Doctor = `error` implies Blocks = `yes`
— an element with an error finding is never Complete, hence never ready, and
the columns must not disagree. A code can block `--ready` without being a
finding (`incomplete:*`) and a warning finding need not block `--ready`
(`id:no_tombstone`, `parent:orphaned`). `doctor --json` problem objects carry
the field `severity` (the Doctor column value); `ok` is true exactly when no
`error` finding exists.

### Canonical key order

On write: `id`, `type`, `parent`, `title`, `status`, `priority`, `assignee`,
`tags`, `depends_on`, `created`, `updated`, `archived` — then unknown keys in
their original order. Empty optional fields are omitted. The serializer is
**normative** (§ 15, AC-2): golden fixture files pin its output.

---

## 8. Identifiers

Per type, sequential, zero-padded to three digits: `EPIC-001`, `TSK-001`,
`SUB-001`. Past 999 the number naturally grows.

**IDs are never reused — provided `.nanojira/ids/` is preserved** (`.ids/`
below, for short). Allocation is
decoupled from the element files: the true allocator is an empty **tombstone
file** `<backlog>/.nanojira/ids/TSK-007`, created with `O_CREAT|O_EXCL`. `O_CREAT|O_EXCL`
is the **sole** claiming authority: the allocator computes only a **start
value** — the highest number found across `.ids/` *and* all element files
(active and archive) — and probes upward from there with `O_CREAT|O_EXCL`
(bounded at 100 retries, then exit 1 with the stderr line
`nj: id allocation failed after 100 retries (<TYPE>)`). `nj archive` and
`nj rm` leave tombstones in place — the ID stays claimed forever, so no
`parent`, `depends_on`, git history or agent transcript can ever be repointed
by a recycled ID. A hand-placed element with a high number raises the start
value above it and leaves gaps — never-reuse outranks dense numbering, by
design.

An element file without a tombstone is a **WARNING** (`id:no_tombstone`): the
same observable state can also be produced by partial tombstone loss, so it
must surface — but a hand-drafted element is legitimate work and stays
eligible for `--ready`. A missing or empty `.ids/` while element files exist
is `backlog:ids_missing`, an ERROR. `doctor --fix` creates tombstones for
every ID found in element files (active and archive) — unambiguous
restoration. Tombstones for already-deleted IDs cannot be recovered; `--fix`
reports that the never-reuse guarantee is void for those numbers. Residual
risk, disclosed: a lost `.ids/` can still recycle the numbers of elements
deleted with `nj rm`, if their tombstones were lost with it — live and
archived elements are always protected by the file-scan start value. A
tombstone without an element is normal (deleted or archived).

---

## 9. Interface

### Principle

**Writes are field maps.** Every field is a `--name=value`, and the names are
**the same as in the frontmatter**. One vocabulary in three places: command
line, file, JSON output. The agent translates nothing.

### Commands (round one)

```
nj                                     short status: counts, top ready, problems
nj init                                create backlog layout (§ 4)
nj <any command> --backlog=<path>      use this backlog (§ 4, Backlog location)
nj new   --type=task --parent=EPIC-001 --title="…"
         [--priority=…] [--tags=a,b] [--assignee=…] [--depends-on=…]
         [--description=… | --description-file=…]
         [--acceptance=…  | --acceptance-file=…]
nj set   --id=TSK-009 [--title=…] [--status=…] [--priority=…]
         [--tags=…] [--assignee=…] [--depends-on=…]
         [--description=… | --description-file=…]
         [--acceptance=…  | --acceptance-file=…]
         [--force] [--allow-open-children]
nj note  --id=TSK-009 "text" (§ 10)
nj show  --id=TSK-009 [--json]
nj list  [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
         [--ready] [--all] [--json]
nj tree  [--id=EPIC-001] [--all] [--json]
nj rm    --id=TSK-009 [--cascade]
nj archive --id=EPIC-001 (§ 11)
nj doctor [--fix] [--json]
```

All commands accept `--json`; reads *and* writes (§ below). All commands
accept `--backlog=<path>` as well, and it appears in every command's list of
known flags; `--backlog` without a value is `missing_value`.

### Rules

- **Verb as a subcommand**, not as a flag: `nj set`, not `nj --set`.
- **Addressing is only by `--id`** — exact, case-sensitive. Titles are labels,
  not addresses, and carry no uniqueness requirement. References (in files and
  in `--parent`/`--depends-on`) are matched exactly; `doctor` reports anything
  that points nowhere.
- **Duplicate IDs:** reads show both entries, marked `duplicate_id`. Writes
  refuse, naming the code `duplicate_id`, both absolute file paths and the
  exact manual repair step. Escape hatch: any write command accepts
  `--file=<path>` (absolute, or relative to the backlog) **instead of**
  `--id` to address one file unambiguously.
- `--depends-on` and `--depends_on` are both accepted and normalised to the
  schema field.
- Control flags (`--json`, `--force`, `--fix`, `--cascade`, `--ready`,
  `--all`, `--allow-open-children`) are not schema fields; they are hard-wired
  in the tool. Unknown field flags are **rejected** — nothing is written —
  and the known fields are listed. A control flag that the addressed command
  does not take is rejected the same way, as `unknown_field` (e.g. `nj archive
  --force`, § 12).
- List fields are set, not appended: `--tags=a,b` replaces the list.
  `--tags=` empties it. `--tags=` / `--depends-on=` reject items containing
  `,` or `]` with a clear error.
- `nj new` validates: `--parent` required for task/subtask and must exist with
  the correct type (task→epic, subtask→task); forbidden for epics. The parent
  must be **active** — an archived parent is refused, since a fresh child of
  an archived parent would instantly carry `archive:split`. An **unreadable
  stub** (`file:unreadable`) is refused as a parent for the same reason: its
  type cannot be verified, and § 6 forbids inventing facts about it.
  `--depends-on` targets must exist. `--priority` and `--status` are validated
  against the config.
- `nj new` scaffolds the body: `# <title>` plus the configured section
  headings as **empty** headings (`## Description`, and for task/subtask also
  `## Acceptance Criteria`). Empty headings count as absent for completeness
  (§ 7), so the gate stays sharp — but humans and agents see at once what is
  missing. The exact scaffold bytes are pinned (epic variant; task and
  subtask add a blank line plus `## Acceptance Criteria` before the final
  newline):

  ```
  # <title>

  ## Description
  ```

  The frontmatter block is followed by exactly one blank line before the H1,
  and the file ends with exactly one trailing newline. The scaffolded file is
  pinned by a golden fixture (AC-2).
- **Section writes — `--description`, `--acceptance` (roles from § 5).** Both
  `nj new` and `nj set` accept the configured section roles as write fields.
  The flag names the **role**, not the heading; the heading written is the
  first name configured for that role, matched case-insensitively on read. The
  flags are accepted for every type; the completeness rules (§ 7) are
  unchanged. Value sources per role, mutually exclusive:
  `--description=<text>` writes the text as given (embedded newlines allowed),
  `--description-file=<path>` reads the file as UTF-8, and
  `--description-file=-` reads stdin. Supplying both value forms for one role,
  or `-` for both roles in one invocation, is rejected (`invalid_value`) with
  nothing written. `--description=` (empty) empties the section; a section
  write **replaces**, it never appends.
  The content is normalised to LF, without BOM, trailing newlines stripped.
  The region between the heading and the next level-2 heading (or the end of
  the body) becomes exactly: the content (empty ⇒ nothing) followed by one
  blank line — content sits directly under its heading with one blank line
  before the next section, exactly as the § 7 example shows. If the section is
  absent it is **inserted** in canonical role order (`description`, then
  `acceptance`): `description` after the H1 block (or at the start of the body
  when there is no H1, after any leading blank lines), `acceptance` before `## Notes` when present, else after
  `description`, else at the end. Everything else — unknown sections and
  `## Notes` included — stays byte-for-byte unchanged. `changed` names the
  role; `updated` is refreshed; § 12's atomic write and compare-before-write
  apply. If several headings match one role, the **first** match wins. A
  `--<role>-file` path that cannot be read is `not_found`, matching `--file`.
  When the written section is the last block in the file, the separating blank
  line and the file's single trailing newline are the **same** newline: the
  file ends with exactly one newline after the content and never gains a
  trailing blank line — that keeps AC-2's scaffold bytes and the § 7 example
  consistent. A relative `--<role>-file` resolves against the **working
  directory** (`--file`, by contrast, resolves against the backlog). Content is
  written as given; a level-2 heading inside the content is indistinguishable
  from a section boundary on the next read, so callers must not embed one.
- `nj set --status=done` on an element with children not `done` is **refused**
  unless `--allow-open-children`; forcing it produces `done:open_children`.
  `--force` has exactly one meaning: overwrite a parallel change (§ 12). It
  never weakens the parent rule.
- `nj rm` refuses while child elements exist and names them. `--cascade`
  deletes the subtree. Tombstones remain either way. If other elements
  `depends_on` the removed element, `rm` names them as a warning
  (`depends_on:dangling` will follow). A mode that leaves orphaned elements
  does not exist.
- **`rm` and `archive` refuse (`refused:unreadable`) while any
  `file:unreadable` element exists anywhere in the backlog.** A stub carries
  no readable `parent` (it has none to read), so the subtree of any element
  cannot be determined while a stub exists — a cascade could orphan it, an
  archive could split it. Refusing is the only answer that honours "a mode
  that leaves orphaned elements does not exist". The error names the stub
  paths and says how to resolve them; single `rm` is covered by the same rule
  for the same reason. The guard is a property of the **backlog**, not of the
  addressed element, so it is evaluated **before the target is resolved**:
  while a stub exists, even a `--id` that names nothing yields
  `refused:unreadable`, not `not_found`. Reads (`list`, `tree`, `show`,
  `doctor`) stay open so the stub remains findable.
- Archived elements are **read-only** in round one: `set`, `note`, `rm` and
  `archive` refuse them (until `nj unarchive` exists); reads and `--all`
  keep working.
- `list` filters are validated: `--status` against the configured statuses,
  `--parent` against existence — a typo'd filter is an error (exit 1), never a
  silently empty result.
- **Sort order** of `list`, `tree` and bare `nj` is deterministic: priority
  weight descending (`urgent` 4, `high` 3, `normal` 2, `low` 1, missing 2),
  then `id` ascending. Never filesystem order.

### `--ready`

An element is ready when **all** hold:

1. `status` equals `statuses[0]` (the configured initial state),
2. every `depends_on` target is `done` and carries no `done:open_children` —
   a target in the archive counts as satisfied (`active_refs_archived`,
   informational),
3. no problem code that blocks `--ready` (table in § 7),
4. the element is complete per § 7.

Ancestor status does not affect `--ready` — only explicit `depends_on` edges
do; broken references are caught by the code table instead.

```
$ nj list --ready
Ready to work:
  TSK-007  Login route

Complete first:
  TSK-009  Registration      incomplete:acceptance
```

`list --ready` combines with the other filters (`--tag`, `--assignee`, …).
`--all` includes archived elements; otherwise they are hidden from `list`,
`tree` and the short status.

### JSON interface

Reads:

```json
{
  "backlog": "/path/backlog",
  "counts": { "total": 47, "errors": 1, "incomplete": 3 },
  "entries": [
    { "id": "TSK-009", "type": "task", "parent": "EPIC-001",
      "title": "Registration", "status": "todo",
      "created": "…", "updated": "…",
      "_problems": ["incomplete:acceptance"] }
  ]
}
```

Writes return one result object:

```json
{ "ok": true, "id": "TSK-009", "changed": ["status"],
  "entry": { "…": "…" }, "_problems": ["incomplete:acceptance"] }
```

`_problems` is always present — empty when nothing is pending, codes only
from the closed table (§ 7). Agents branch on codes, never on prose.

### JSON shapes per command

| Command | JSON shape |
|---|---|
| `list`, `show` | `{backlog, counts, entries: [{…, _problems}]}` |
| `new`, `set`, `note`, `rm` | `{ok, id, changed: […], entry: {…, _problems}, _problems}` — the top-level `_problems` mirrors `entry._problems`; `rm` additionally carries `dependents: […]` — the elements whose `depends_on` names the removed one, empty when there are none; for `nj new`/`nj set`, `changed` also names the section roles written (`description`, `acceptance`) |
| `archive`, `rm --cascade` | `{ok, ids: […], changed: ["archived" \| "deleted"], entries: […], _problems: […]}` — for `rm --cascade` the top-level `_problems` is `[]`: the elements are gone, so their problems are too. `archive` emits the union, because archived elements still exist and can still carry findings. **`rm --cascade` additionally carries `dependents: […]`**, the remaining elements whose `depends_on` names a removed one — archived elements included, since they carry `depends_on:dangling` too and the agent must know it; `archive` does **not** — a `depends_on` pointing into the archive is satisfied by definition (§ 11), so there is nothing to warn about and nothing an agent must act on. |
| `tree` | `{backlog, counts, entries: […]}` — **flat**, each entry carries `parent`; depth-first order conveys the tree |
| `doctor` | `{backlog, ok, problems: [{code, severity, element?, file?, line?, message}]}` — `severity` ∈ `error`\|`warning` (the Doctor column value; `—` codes never appear as findings); element-level findings carry `element`, backlog-level ones do not |
| bare `nj` | `{backlog, counts, ready: [entries ≤ 5], incomplete: [entries ≤ 5]}` |

Every entry object always carries `_problems`; the codes come only from the
closed table (§ 7). With `--json`, **every** exit path writes JSON to stdout:
on failure, `{ok: false, error: "<code>", hint: "…"}` (hint optional) with
exit 1. The prose error text **additionally** goes to stderr — that clause
constrains the JSON stream, not the stderr stream, so a non-JSON caller sees
exactly what it saw before.

### Failure codes — closed vocabulary

`error` carries a code from this closed set, and the additive-only rule of
§ 7 applies to it in the same way: adding a code is additive, renaming or
redefining one is forbidden. This is a **different axis** from the § 7
problem codes: those describe element state, these describe command outcomes.
`duplicate_id` is the one deliberate overlap, because there the element state
*is* the cause.

```
no_backlog            backlog_without_config   invalid_config
invalid_env           invalid_backlog_env      unknown_field
invalid_backlog_flag  invalid_backlog_njrc     invalid_njrc
legacy_layout
unknown_command       missing_argument         missing_value
invalid_value         invalid_target           not_found
duplicate_id          exists                   changed_in_parallel
id_allocation_failed  internal_error
refused:<reason>      reason ∈ unreadable | archived | children_open |
                               has_children | not_done | parent_archived |
                               misplaced
fault:<hook>          hook ∈ before-compare | after-tmp-write | before-rename
```

`--json` is defined for the command set of this section. `nj help` is not one
of them, so its output is prose regardless of flags.

### Failure codes — spec-named paths

Where a passage of this specification names a failure condition, it also names
its code. These mappings are normative:

| Condition | Code | Stated in |
|---|---|---|
| no backlog found by the location rules | `no_backlog` | § 4 |
| `--backlog` names a place without a backlog | `invalid_backlog_flag` | § 4 |
| `NJ_BACKLOG` names a place without a backlog | `invalid_backlog_env` | § 4 |
| a `.njrc` names a place without a backlog | `invalid_backlog_njrc` | § 4 |
| a reached `.njrc` violates its format | `invalid_njrc` | § 4 |
| backlog found but `.nanojira/config.json` is missing | `backlog_without_config` | § 4 |
| backlog in the v2 layout (any command except `doctor`) | `legacy_layout` | § 4 |
| `.nanojira/config.json` violates § 5 | `invalid_config` | § 5 |
| unknown field flag | `unknown_field` | § 9 |
| unknown subcommand | `unknown_command` | § 9 |
| a required flag or its value is missing | `missing_argument` / `missing_value` | § 9 |
| a value fails validation (`--status`, `--priority`, `--type`) | `invalid_value` | § 9 |
| `--parent` names an element of the **wrong type** | `invalid_target` | § 9 |
| `--id` and `--file` given together | `invalid_target` | § 9 |
| `--parent` on an `epic`, which may have none | `invalid_value` | § 9 |
| `--parent`, `--depends-on` or `--file` names nothing | `not_found` | § 9 |
| a `--description-file` / `--acceptance-file` path cannot be read | `not_found` | § 9 |
| two files carry the same `id` | `duplicate_id` | § 9 |
| `init` target already exists (even an empty directory) | `exists` | § 4 |
| an `archive` target path is occupied | `exists` | § 11 |
| the file changed between read and write | `changed_in_parallel` | § 12 |
| an archived element is written or removed | `refused:archived` | § 9 |
| an unreadable stub is written, or used as `--parent` | `refused:unreadable` | § 6, § 9 |
| `done` on a parent whose children are open (without the flag) | `refused:children_open` | § 9 |
| `rm` while child elements exist | `refused:has_children` | § 9 |
| `archive` with an unfinished subtree | `refused:not_done` | § 11 |
| an archived element as `--parent` | `refused:parent_archived` | § 9 |
| `archive` under `hierarchy` on a subtree not lying in its own folder | `refused:misplaced` | § 11 |
| an `NJ_FAULT` hook fires | `fault:<hook>` | § 12 |

Codes of the closed set that no passage above names — `invalid_env`,
`id_allocation_failed`, `internal_error` — are
**reserved**: the implementation may emit them from its own error paths, but
only from the set. A later revision may pin them.

### Feedback after writes

Human output after a write repeats the element's open problems in the same
block:

```
$ nj set --id=TSK-009 --status=doing
TSK-009 → doing
⚠ TSK-009 has no acceptance criteria. Add them before starting.
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success — including reads that merely *report* data problems via `_problems` |
| `1` | command failed — nothing or only partially written; hard errors (no backlog found, unknown field, refusal, retries exhausted) |
| `2` | `nj doctor` only: at least one `error` finding |

---

## 10. `nj note`

`nj note --id=TSK-007 "Parser splits at the first colon"` appends a dated,
signed line to the body:

```markdown
## Notes
- 2026-09-21T18:02:44Z coder-agent: Parser splits at the first colon
```

Rules:

- `## Notes` is created at the end of the body if absent (a sanctioned
  exception to the byte-for-byte rule, alongside the H1). It is separated
  from the preceding body by exactly one blank line; if the body already ends
  in a blank line, none is added.
- Line format: `- <ISO-8601 UTC> <author>: <text>`. `<author>` is the
  element's `assignee` if set, else `?`. Consecutive notes are consecutive
  lines directly below the heading — no blank lines between them.
- A note **does not** satisfy the `## Description` requirement. Its write
  result reports `changed: ["body"]`.
- `updated` is refreshed; the atomic write and compare-before-write rules
  (§ 12) apply.

Notes are how decisions, findings and verification reports get captured in
the backlog — the body is the project memory, `nj note` is its sanctioned
writer.

---

## 11. `nj archive`

`nj archive --id=EPIC-001` moves the element and its **entire subtree** into
the archive folder (`layout.folders.archive`, default `archive/`):

- groups `type` and `flat`: flat, every file directly in the archive folder
  (IDs are unique and never reused, so no collisions are possible);
- group `hierarchy`: the archive mirrors the active nesting — the subtree's
  folder moves as a whole, with **one** `rename`, to the same relative place
  below the archive folder (`archive/EPIC-001/TSK-003/`); missing ancestor
  folders there are created first and hold no element file of their own.
  When the target folder already exists as such an ancestor — left by an
  earlier archive of a descendant — it is not "occupied": the subtree's
  entries move into it, one `rename` per entry, and the emptied source
  folder is removed. A target is occupied only where an element file or a
  folder holding one would be overwritten (DECISIONS 90).

- **Precondition:** the element and every descendant are `done`. Otherwise the
  command refuses and lists the open elements. There is no `--force`: finish
  first, then archive.
- **All move targets are verified before the first move.** If any target path
  already exists in the archive, the command aborts with `exists` and moves
  **nothing**. A partially executed archive is forbidden — it would leave the
  backlog with an archived parent and a live child (`archive:split`,
  `duplicate_id`) and no clean recovery.
- The tool adds `archived: <ISO-8601 UTC>` to the frontmatter of every moved
  element and refreshes `updated`.
- **References survive:** a `depends_on` pointing at an archived element is
  satisfied by definition (archived ⇒ done). This is `active_refs_archived`,
  an informational notice — archiving is *not* refused while references exist,
  because a long-lived foreign reference must never deadlock archival.
- `list`, `tree` and the short status hide archived elements; `--all`
  includes them, and archived entries carry their `archived` timestamp.
- `nj doctor` validates the archive: `archive:not_done` (error — the
  invariant "archived ⇒ done" carries `depends_on` satisfaction into the
  archive), and `archive:split` — a child outside the archive while its
  parent is inside (error, produced by manual file moves).
- Un-archiving (`nj unarchive`) is round two.

git remains the fine-grained history; the archive is the coarse shelf for
finished work, keeping the working set small.

---

## 12. Concurrency

No lock file. A lock left behind by a crash would be the classic reason a tool
eventually "hangs" — exactly the complexity that was ruled out. Mechanisms:

**ID allocation by exclusive creation** — tombstones, § 8.

**Atomic writes.** Never write into the target file. Instead: a temporary file
`.nj-tmp-<pid>-<rand>` in the same folder, `fsync`, then `rename`. `rename`
within one filesystem is atomic: a reader sees either the old **or** the new
complete file, never half of one. That is why reading never needs to lock.

`STATUS.md` (§ 4) is written the same way: temp file, `fsync`, `rename`.

**Folders under `hierarchy`.** `nj new` creates the element's folder (epic,
task) with `mkdir` before writing the file into it; a folder that already
exists is reused. `nj rm` removes the element's file and then its folder,
only if the folder is then empty; `rm --cascade` removes the subtree's files
children-first and each folder once empty — never a recursive delete of
whatever else a folder holds. Moving a subtree (`archive`, `doctor --fix`) is
**one `rename` of its top folder**, atomic within one filesystem.

**Compare before writing.** On `nj set`, `nj note` and `nj archive`: read the
file, remember the content, re-read immediately before writing and compare
**byte for byte**. A difference aborts with "changed in parallel, please run
again". The comparison runs over the full content, not over `updated` —
second-level timestamps would be too coarse for two writes within the same
second. `archive` routes its comparison through the same guarded path as the
other two, so `NJ_FAULT=before-compare` covers it.

`--force` overrides a parallel change on **`set` and `note` only**.
**`archive` has no override**, and that is deliberate: § 11's "no `--force`"
governs, a bulk move must never silently overwrite a parallel edit, and
`--force` must not acquire a second meaning — the same reason the parent rule
got its own flag (`--allow-open-children`). A parallel change during `archive`
aborts the run; the caller retries once the backlog is stable.

**Fault injection (verification hook, not a feature).** `NJ_FAULT` accepts two
distinct injection points, both exiting with code 1 and leaving the target
file untouched:

- `after-tmp-write` — abort immediately after the temp file has been written,
  before `fsync`
- `before-rename` — abort after `fsync`, immediately before `rename`
- `before-compare` — after the first read and before the compare re-read,
  poll for `<backlog>/.nj-fault-go` (timeout 10 s, then exit 1). The test
  changes the target file, then creates the marker: expect exit 1 with
  "changed in parallel", or exit 0 with `--force` where the command takes it
  (`set`, `note` — not `archive`)

It exists so that criterion AC-9 is testable. The abandoned temp file is
reported by `nj doctor` (`backlog:stray_tmp`) and removed by `doctor --fix`.

**Clock pinning (verification hook, not a feature).** `NJ_NOW=<ISO-8601 UTC>`
fixes the clock: if set, every timestamp the tool writes (`created`,
`updated`, `archived`, `nj note` lines) uses exactly this value; an invalid
value exits 1. It exists so that AC-2's byte-exact golden comparison needs no
normalisation — normalising timestamps in the verifier would silently hide
serializer defects (wrong format, missing `Z`).

### Limits, disclosed

- `O_CREAT|O_EXCL` and `rename` are only guaranteed on **local** filesystems.
  On NFS or SMB the guarantee weakens. The requirement is "local"; the
  limitation is documented, not concealed.
- Windows is not a target platform. `rename` over an existing file behaves
  differently there.
- Same element in the same millisecond: a residual window, overridable with
  `--force` on `set` and `note` — `archive` has no override (§ 12).
- Under `hierarchy`, an archive that merges into an existing archive folder
  (§ 11) takes several `rename`s. A crash between them leaves part of the
  subtree live under an archived parent: `archive:split`, reported by
  `doctor` — the same state a manual move produces.
- Tombstones and the directory entry are not `fsync`'d: they survive a
  process crash, but a machine crash within the write window may lose one —
  the allocator's file-scan start value and `doctor --fix` restore the
  recoverable part (§ 8).

---

## 13. Search Index (design now, implementation round two)

**Measured, not estimated** (darwin-arm64, local APFS SSD, Node 24.21.0,
end-to-end wall clock including ~21 ms process startup, median of 5):

| elements | scan commands | `tree` |
|---|---|---|
| 100 | ~24 ms | ~24 ms |
| 1 000 | 40–50 ms | 50 ms |
| 5 000 | 115–140 ms | 289 ms |
| 10 000 | 200–227 ms (`list --json` 272 ms) | 971 ms (pre-fix, see below) |

Marginal cost is ≈20 ms per 1 000 elements for the scan path, so the
comfort bar (median ≤ 250 ms, worst ≤ 500 ms) is crossed at roughly
12 000–15 000 elements. Traversal **was** O(n²): `tree` recomputed the child
list per node, and `descendants()` — used by `rm --cascade` and `archive` —
shared the pattern. That was fixed with a prebuilt children map
(`childMap`, DECISIONS 81) instead of building the index for it, and `tree`
is now in line with the scan path, not a separate case: `npm run perf`
(TSK-003), 10 000 elements, quiet machine — `list` 188/211 ms, `list --json`
188/192 ms, `tree` 192/194 ms, `doctor` 195/204 ms (median/max), all inside
the comfort bar above. The 12 000–15 000 trigger below now applies to `tree`
as well.

The index is therefore still deferred, with a measured trigger: implement it
when backlogs approach ~12 000–15 000 elements, or ~9 000 if `list --json` is
routinely on the agent's hot path. Round one ships without it; the design is
fixed now so it can land later without touching the data model.

- **Location:** `<backlog>/.nanojira/index.json`, listed in `nj init`'s
  `.gitignore` as uncommitted — a local cache, never a versioned artifact.
  This keeps it out of git merge conflicts, the failure mode that argues
  against committing derived state.
- **It is a cache, never the truth.** Any command may ignore it; deleting it
  costs one full rebuild. It maps ID → `{file, mtime, size, parsed fields,
  problems}` and carries its own `schema` version; on mismatch it is rebuilt
  silently.
- **Writers never touch it.** `new`/`set`/`note`/`rm`/`archive` do not update
  the index. Readers validate entries against `mtime`/`size` (cheap `stat`)
  and re-parse only stale entries; new files appear via the directory listing.
  The index is thereby **out of the concurrency picture entirely** — no shared
  mutable state, the "no database" property is preserved.
- `nj doctor --fix` rebuilds it.

---

## 14. `nj doctor`

```
$ nj doctor
backlog/: 47 entries, 2 errors, 1 warning

ERROR   TSK-104.md: frontmatter unreadable (line 1: no '---')
ERROR   EPIC-002 + EPIC-007: duplicate ID
WARNING TSK-101: unknown status 'blocked-on-review'
```

Checked: the legacy layout (`backlog:legacy_layout` — `doctor` is the one
command that runs on a legacy backlog, reading `.nanojira.json` and `.ids/`
from their v2 places); configuration validity (§ 5); every condition whose
Doctor column is not `—` (table in § 7); unreadable frontmatter lines;
duplicate IDs; files outside their layout place (`type:folder`,
`layout:misplaced`);
a missing or empty `.ids/` while elements exist (`backlog:ids_missing`);
element files without tombstones (`id:no_tombstone`); stray `.nj-tmp-*` files
(`backlog:stray_tmp`); archive rules (§ 11); `STATUS.md` against a fresh
rendering (`backlog:status_stale`, only with `statusFile: true`). The summary
line splits the
counts — `backlog/: 47 entries, 2 errors, 1 warning` — and the exit code is 2
exactly when at least one `error` finding exists; warnings are reported but
exit 0.

### `--fix`

Repairs **unambiguous** cases only. Steps run **in this order** — the
tombstone backfill claims the **frontmatter** `id`, so it must run after the
rename, or it would claim the wrong number while the right one stays
unprotected:

0. migrate a legacy layout: create `.nanojira/`, move `.nanojira.json` to
   `.nanojira/config.json` and `.ids/` to `.nanojira/ids/` (each one
   `rename`; the configuration content is not rewritten), delete the v2
   index file `.nanojira-index.json` if present, and replace the pattern
   `.nanojira-index.json` in `.gitignore` by `.nanojira/index.json` — only
   when that line is present verbatim; otherwise `.gitignore` is left alone
   and a note says so. If both the v2 and the v3 location of the
   configuration or of the tombstones exist, nothing is moved — ambiguous,
   reported, never merged
1. write the `id` from the file name, and the `type` from the ID prefix, when
   missing
2. rename the file to match the `id` when frontmatter and file name disagree
   and the target is free
3. move a file to its layout place (`type:folder`, `layout:misplaced`) —
   under `type` only when `id` prefix and `type` agree (frontmatter > prefix >
   folder precedence; the folder loses); under `hierarchy` only when the
   whole `parent` chain resolves without `parent:*` problems, and a subtree
   moves with its top folder in one `rename`, top-down; every target must be
   free, otherwise that element is reported and stays
4. create missing tombstones for every ID found in element files
   (`id:no_tombstone`, `backlog:ids_missing`; tombstones for deleted IDs are
   unrecoverable and reported as such)
5. write `status` from `statuses[0]`, and `created`/`updated` when missing —
   `created` from the file mtime, `updated` = now (this step is a write)
6. pull the H1 up from `title`
7. remove stray `.nj-tmp-*` files
8. rebuild the index (round two)
9. regenerate `STATUS.md` (with `statusFile: true`) — last, so it reflects
   every repair above; a merge conflict in it is thereby resolved

Each step that modifies a file refreshes that file's `updated` (§ 6, "every
write"); steps that find nothing to do leave the file untouched. Original file
mtimes are snapshotted **before step 1**, so step 5 still sees the true mtime
even when step 1 already rewrote the file. The mtime map is keyed by **path**,
not by ID, and is re-keyed across the renames of steps 2 and 3 — two files
sharing an ID carry different mtimes and must each get their own `created`.

**Reporting and exit code.** `doctor --fix` reports the **actions it took**
plus the findings that **remain** — with `--json` as `fixed[]`, `notes[]` and
`problems[]`, the last reflecting the state *after* the repairs — while its
**exit code reflects the state *after*** them: 0 when no error remains, 2
when one does. A warning that survives does not raise the exit code. An agent
that uses `--fix` as a gate therefore needs no second `doctor` run.

For **known** fields (the ones § 6 defines), an empty value counts as absent:
`status:` is reported as `missing:status` and `--fix` may fill it. For
**unknown** keys, an empty value is a value and is preserved verbatim
(§ 7, `custom: ""`).

**Never** automatically: guess status values, resolve duplicate IDs, invent
parents, rewrite the body, or overwrite an existing value — even an invalid
one; invalid existing values are reported, not repaired. Ambiguity is
reported, not guessed at.

---

## 15. Acceptance Criteria

1. **Basic run.** `nj init` creates the full layout; `nj new` for epic, task,
   subtask; `list`, `show`, `set`, `note`, `tree`, `rm`, `archive`, `doctor`
   and bare `nj` all work end-to-end.
2. **Golden files.** After any number of `set`/`note` cycles, each file is
   byte-identical to the golden fixture produced by the normative serializer
   (fixtures are generated under a fixed `NJ_NOW`, § 12); unknown fields and
   unknown body sections are unchanged.
3. **Fault tolerance.** The § 7 table is played through file by file: every
   variant loads, carries the exact code from the closed vocabulary, and the
   rest of the backlog keeps working.
4. **Incompleteness.** A task without description or acceptance criteria is
   excluded from `--ready`, marked in `list`, carries the code in
   `_problems`, and every write on it emits the hint. Epics need only a
   description.
5. **Empty sections.** An empty or whitespace-only `## Acceptance Criteria`
   counts as incomplete; a heading followed by nothing never counts as
   present.
6. **Rejection.** `--statuss=done` and other unknown field flags are rejected;
   the file is unchanged (verified by checksum).
7. **Concurrency.** `seq 1 100 | xargs -P 20 -I{} nj new --type=task
   --parent=EPIC-001 --title="Parallel {}"` yields 100 files, 100 unique IDs,
   `nj doctor` clean; the "retries exhausted" abort has exit 1 and a defined
   stderr form.
8. **ID immortality.** Archive 50 elements and delete 10; create one of the
   same type; the new ID is 51 (or the next free number above every tombstone).
9. **Atomicity.** With `NJ_FAULT=after-tmp-write` and `NJ_FAULT=before-rename`
   the previous revision is intact, no half file exists, exit is 1, and
   `doctor --fix` removes the temp file.
10. **Dependencies.** `--ready` honours `depends_on` — including satisfied
    references into the archive; cycles are detected and do not spin into an
    endless loop.
11. **Archive rules.** Archiving a subtree with open elements refuses and
    names them; archived elements vanish from `list` and appear with `--all`;
    `archive:split` and `archive:not_done` are caught by `doctor`.
12. **Discovery.** `list` from a nested subdirectory finds the backlog;
    from an unrelated directory it exits 1 with a hard error (never a silent
    empty result); `NJ_BACKLOG` is honoured. (Extended by AC-21.)
13. **JSON contract.** Every command supports `--json`; read shapes and the
    write result shape match § 9; `_problems` contains only closed-vocabulary
    codes; `changed` lists exactly the fields that changed.
14. **Determinism.** `list`/`tree` ordering is priority-desc, id-asc, stable
    across platforms and calls.
15. **No dependencies.** `nj` runs on the Node from `runtime/`, without
    `node_modules`, without network.
16. **Language.** Non-ASCII values (umlauts, CJK, emoji) survive every write
    cycle byte-exact — except the documented `title` normalisation — and
    English output is produced regardless of the values' language.
17. **Configuration.** An invalid `.nanojira/config.json` (bad statuses,
    `done` not last, an unknown `layout` key, an invalid or duplicate folder
    name) makes commands fail with exit 1 pointing at `doctor`, and `doctor`
    reports it with exit 2. A configuration without `layout` is valid and
    behaves exactly like the defaults.
18. **Tombstone integrity.** Deleting `.nanojira/ids/` and running `doctor`
    yields `backlog:ids_missing` as ERROR with exit 2 — never a clean pass;
    `doctor --fix` restores tombstones for all surviving element IDs and
    reports that tombstones for deleted IDs are unrecoverable; a subsequent
    `nj new` allocates above every existing element number.
19. **Doctor axis.** A backlog of freshly created elements yields `doctor`
    exit 0 with an empty `problems[]`; elements carrying only `incomplete:*`
    produce no doctor finding (they surface in `list`/`_problems` only); a
    hand-written unknown status produces a WARNING finding — printed, but
    exit 0; a duplicate ID produces exit 2.
20. **Section writes.** `nj new`/`nj set` accept `--description`/`--acceptance`
    (inline, `--…-file=<path>`, or `-` for stdin) and write the configured
    section, so a CLI-created element becomes complete and appears in
    `--ready`. Replacing and emptying follow § 9's byte rule; unknown sections
    and `## Notes` stay untouched; `updated` is refreshed; supplying both value
    forms for one role (or `-` for both roles) is rejected with nothing
    written. Without the section flags, `nj new`'s scaffold stays
    byte-identical to the AC-2 fixture.
21. **Backlog location.** Each source works alone: `--backlog` (on every
    command, including `init`), `NJ_BACKLOG`, a `.njrc` in the working
    directory and in an ancestor (relative value against the `.njrc`'s own
    directory, `~/` expanded). The order holds pairwise: flag over
    environment over search; within the search the nearest directory wins
    and `.njrc` beats `backlog/` in the same directory. A chosen source that
    holds no backlog exits 1 with its own code and names the source — even
    when a lower source would have found one (except for `init`, which
    creates the backlog there). Every `.njrc` format violation
    exits 1 with `invalid_njrc` and the line number; a `.njrc` without
    `backlog` lets the search continue. Without any source `init` creates
    `./backlog`.
22. **Layout.** For each group (`type`, `hierarchy`, `flat`) and for renamed
    folders: `new`, `archive`, `rm` and `rm --cascade` put and remove files
    exactly where § 4, § 11 and § 12 say; `list`, `tree`, `show` and `--json`
    give the same answers in every group, apart from file paths. Changing
    `group` or a folder name on a populated backlog: every element reports
    `type:folder` or `layout:misplaced`, commands keep working, one
    `doctor --fix` moves everything, a following `doctor` is clean, and every
    element file is byte-identical to before the move. Under `hierarchy` a
    hand-edited `parent` makes the file `layout:misplaced`, and `--fix` moves
    it; an unresolvable `parent` chain is reported and never moved.
23. **Status overview.** After `init` and after every write command,
    `STATUS.md` is byte-identical to the golden fixture of § 4 for that
    state — including empty statuses, the `?` section and archived elements
    left out. A hand-edited or deleted `STATUS.md` is `backlog:status_stale`
    (warning, exit 0) and `doctor --fix` restores it. With `statusFile: false`
    no command creates or checks it. An unwritable `STATUS.md` leaves the
    write's exit code unchanged and prints the § 4 warning.
24. **Legacy migration.** On a v2 backlog every command except `doctor` exits
    1 with `legacy_layout` and changes nothing; `doctor` reports
    `backlog:legacy_layout` (exit 2); `doctor --fix` migrates it. Afterwards
    the configuration and every tombstone are at their v3 places with
    unchanged content, every element file is byte-identical, `doctor` is
    clean, and the next `nj new` allocates above every existing number. With
    both v2 and v3 places present, `--fix` moves nothing and reports it.

---

## 16. Not in Round One

Terminal board (`nj board`), Obsidian Dataview snippet, import/export of
foreign backlogs, full-text search over the body, attachments, the search
index's implementation (§ 13), batch writes (`--id=A,B,C`), `nj claim`
(exclusive claiming; `assignee` is advisory in round one), `nj check`
(checkbox ticking in the body), `nj unarchive`, an MCP wrapper, Windows,
`NJ_AUTHOR` override for `nj note` signing (notes currently sign with the
element's `assignee`).

A language migration (Go as the candidate; Rust considered and set aside) is
deliberately deferred: round one ships on Node to gather real experience. The
oracle in `test/` is black-box (CLI + exit codes only), so a later rewrite
would keep the entire test suite; only § 3 would change. Revisit only with
measured problems, not on principle.

All of them can be added later without rework: the parser preserves the
unknown, the problem vocabulary only grows, and the data model is additively
extensible.
