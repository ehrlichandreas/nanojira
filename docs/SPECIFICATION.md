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

**`dist/nj-mcp`** (§ 17 "MCP Interface") is a second, independent entry
point, built and shipped the same way: one committed file, built by
`npm run build` alongside `dist/nj`, byte-identical on a fresh build.
**It carries no dependency of any kind — not at runtime, and not at
build time either**: unlike `dist/nj` (whose build-time tooling, esbuild
and TypeScript, are themselves `devDependencies`), `nj-mcp`'s own MCP
protocol handling is hand-rolled, so there is nothing third-party to
bundle away in the first place. The official MCP SDK's **client** is a
`devDependency` used **only** by the test suite's conformance leg (§ 17),
never bundled into `dist/nj-mcp`, never required to build or run it —
the same "build tooling may use libraries the runtime may not" reading
this section already gives `esbuild`/`typescript`, applied here to a
dependency that is not even build tooling for the shipped artifact, only
for its tests.

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
    ├── claims/                claim sequences (§ 12 "Claims"), never committed
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

**`nj set --parent=<id>` reparents a task or subtask** (DECISIONS 176 A, §
9 "Rules") — the one way `nj` itself changes `parent` outside a hand edit.
Under `hierarchy`, the move is one `rename` (the element's own file for a
subtask; its whole folder, children included, for a task), the same
atomic-within-one-filesystem move `archive`/`doctor --fix` already use for
a subtree. Under `type` or `flat`, reparenting writes only the frontmatter
— the type never changes, so there is nowhere to move the file to. Besides
`--parent`, a file still moves only through `nj archive`, `nj doctor
--fix`, or by hand. Changing `layout` in the configuration is allowed at any time:
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
must be committed. The only uncommitted artifacts are the index (§ 13),
temp files (§ 12), and claim sequences (`.nanojira/claims/`, § 12 "Claims") —
local runtime state, not project memory: a claim coordinates processes
sharing one working tree, and a claim made in another clone cannot be
honoured without a server. `nj init` writes a `.gitignore` containing exactly
three patterns: `.nanojira/index.json`, `.nj-tmp-*` and `.nanojira/claims/`.
`.nanojira/ids/` is never ignored, by design.

### Status overview (`STATUS.md`)

A generated, read-only overview of the active backlog by status, so the state
is readable without `nj` — in an editor or a forge's web view.

- **Written** by `nj init` and after every successful write of `new`, `set`,
  `note`, `check`, `rm`, `archive`, `unarchive`, `claim`, `release` and
  `doctor --fix`, from a full scan, atomically (§ 12). **Never read** by
  `nj`: it is derived, never the truth.
- **A batch write (`--id=A,B,C`, § 9) regenerates it at most once, after
  every ID's write phase has finished** — never once per ID. If every ID in
  the batch failed, nothing was written and `STATUS.md` is not touched at
  all, the same "only after a successful write" rule as above.
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
  its exit code and prints `Warning: STATUS.md not updated (<reason>)` on
  stderr. Under `--json` the result object is unchanged — the warning is on
  stderr only; `doctor --fix` keeps the exit code its findings give, and the
  next `doctor` reports `backlog:status_stale`.
- **Problem elements** (DECISIONS 95): an element is listed under the status
  `list` shows for it — a `missing:status` element under the derived
  `statuses[0]`; a `file:unreadable` stub, having no status, under `?`. With
  no title the line is `- [<ID>](<path>)` with no trailing space. Both files
  of a `duplicate_id` are listed, ordered by path after the `list` order.
  The title needs no escaping: the link text is the ID, and IDs and folder
  names cannot contain `]`, `(` or `)`.
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
- Lexing, exactly: an optional UTF-8 BOM at the very start of the file is
  dropped (a BOM anywhere else is an ordinary character); a trailing `\r`
  counts as line-end whitespace (CRLF files work), but a `\r` not followed by
  `\n` is `invalid_njrc` (a classic-Mac file would otherwise read as one
  comment line and silently set nothing); a line splits at its
  **first** `=`, so the value may contain `=`; keys are case-sensitive
  (`Backlog` is unknown); a `#` after the first non-blank character is part
  of the value — only whole-line comments exist.
- A `.njrc` that exists but is not a readable regular file (a directory, a
  dangling symlink, no read permission) is `invalid_njrc` —
  `nj: invalid .njrc at <abs path>: <reason>`, no line number. A symlinked
  `.njrc` resolves a relative value against the directory where the link
  lies, not its target's. `~/.njrc` has no special role: it is read only
  when the home directory is on the search path, like any ancestor.
- **Ownership.** A `.njrc` the search reaches must be owned by the current
  user or by root; otherwise the command exits 1 with `invalid_njrc` and
  `nj: invalid .njrc at <abs path>: owned by uid <n>, not by you` — never
  silently skipped, never obeyed. For a symlinked `.njrc` both the link and
  its target must pass. Ownership is checked before the file is read, so it
  is reported ahead of every other `.njrc` fault. A file planted in a shared ancestor
  (`/tmp`) must not steer another user's `nj` (the precedent is git's
  `safe.directory`). `--backlog` and `NJ_BACKLOG` stop the search first and
  so bypass the check (DECISIONS 93). Ownership is checked on the open file
  descriptor (`lstat` for the link owner, then `open(O_RDONLY|O_NONBLOCK)`,
  `fstat`, read) rather than trusted from the pre-open `lstat` alone — the
  window between them is exactly what could let a swapped target slip past
  an `lstat`-only check.
- **`NJ_FAULT=njrc-swap`** (verification hook, not a feature) fires in that
  window — between the ownership `lstat` and the `open()` — and polls for
  `<dir containing the reached .njrc>/.nj-fault-go` (timeout 10 s), the same
  marker filename `before-compare` uses (§ 12), relative to the one path
  this hook already knows at the point it fires: no backlog is resolved
  yet, only the `.njrc` being checked is. **It is a pure pause, not a
  fault injector: whether released by the marker or by the 10 s timeout,
  `nj` always proceeds to `open()` next — there is no `fault:njrc-swap`
  code.** Proceeding means `open()`ing whatever is at the path *at that
  moment*, so a `.njrc` swapped in during the pause (even a same-user file
  naming a different backlog) is what gets checked and read — the path is
  re-resolved at `open()`, nothing is cached from the earlier `lstat`.
  **If `.njrc` has been removed outright by the time `open()` runs, it is
  treated as absent at that level**, the same as a directory with no
  `.njrc` at all: the search (above) continues to the next ancestor,
  resolving an outer `.njrc` or a `backlog/` folder, or ending in
  `no_backlog` — never a crash, and never a fall-back to the content the
  earlier `lstat` saw. For a symlinked `.njrc`, "removed outright" means the
  *link itself* is gone — a dangling symlink (the link still there, its
  target gone) is a different case and stays `invalid_njrc`, same as
  today's dangling-symlink rule above. It exists so the swap race is deterministically
  testable without timing luck. **A genuinely foreign-owned swap target is
  still a known gap in practice** (DECISIONS 98): a non-root test process
  cannot create one, but the hook itself does not care who owns the
  swapped-in file — the ownership check runs on it exactly as it would on
  any `.njrc` reached normally.
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
- `layout.folders`: only the four keys `epics`, `tasks`, `subtasks`,
  `archive` (any subset; a missing one is its default), each a folder name matching `[A-Za-z0-9][A-Za-z0-9_-]*`, pairwise
  distinct, none of the form `EPIC-<n>`, `TSK-<n>` or `SUB-<n>` (those are
  folder names under `hierarchy`). Under `hierarchy` and `flat` only
  `archive` is used; the other three are still validated.
- `layout.statusFile`: `true` or `false` (§ 4, `STATUS.md`).
- While the configuration is invalid (`config:invalid`), no placement is
  judged: `type:folder` and `layout:misplaced` are not reported, because the
  layout they would be judged against is unknown (DECISIONS 102).
- Changing `layout` is always allowed; it never invalidates the configuration.
  The elements then report their old places, and `nj doctor --fix` moves them
  (§ 4, § 14).
- An invalid configuration makes every command except `nj doctor` fail with
  exit 1 and a pointer to `nj doctor`; `doctor` reports the defect (exit 2).
- `claims.staleAfterHours` (§ 12 "Claims"): an optional top-level
  `"claims": {"staleAfterHours": <n>}` block, not written by `init`. A plain
  integer, hours. Default when the key or the whole `claims` block is
  absent: **24**. `0` disables `claim:stale` entirely, rather than meaning
  "stale after zero hours" — the same "a `false`-shaped value turns the
  feature off" reading `layout.statusFile: false` already gets. A
  non-integer or negative value makes the configuration invalid
  (`config:invalid`, § 7; commands other than `doctor` fail with
  `invalid_config`, § 9).
- **`problems.ignore`** (DECISIONS 165/166, § 7 "Acceptance quality warnings"
  has the full mechanism): an optional top-level `"problems": {"ignore":
  [...]}` block, not written by `init`. `ignore` is a list of problem codes
  (§ 7) to suppress from every place a code is reported. Default, when the
  key or the whole `problems` block is absent: the empty list — nothing is
  suppressed, exactly today's behaviour. Only a code whose § 7 Doctor
  severity is **warning** may be listed; a **known error**-severity code or
  any `incomplete:*` code (severity `—`) is still `invalid_config`, naming
  the offending code — that is misuse, not version skew, and it would mean
  a real defect, or the ready rule itself, could be silenced by
  configuration. A code that is **not in § 7's closed vocabulary at all**
  (a typo, a retired code, or a code a *future* revision defines that this
  build doesn't know yet) is instead the **warning** `config:unknown_code`
  (DECISIONS 166, amending 165) and is simply **skipped** — it contributes
  nothing to the ignore set, but every other, valid code listed alongside
  it still applies.
- **`minVersion`** (DECISIONS 166): an optional top-level `"minVersion":
  "X.Y.Z"` — three dot-separated non-negative integers, nothing else. If
  the running `nj`'s own version (the same value `--version` reports) is
  older than `minVersion`, comparing `(major, minor, patch)` as integer
  tuples component by component (`3.9.0` is older than `3.10.0` — numeric,
  never a string compare), **every** command — including `doctor`, which
  `invalid_config` otherwise exempts; there is nothing `doctor --fix` could
  repair about the running binary's own version — fails with a new code,
  `needs_newer_nj` — its hint (so it is visible under `--json` too, not
  only in the stderr message) names both the running version and
  `minVersion` — checked before any other configuration validation (so an old binary gets
  this one, specific, actionable reason rather than a confusing report
  about fields it may not recognise). `nj --version` and `nj <command>
  --help` are unaffected: neither resolves a backlog/config at all
  (`--version`) or ever fails on one (`--help`'s existing best-effort,
  silent resolution, § 9) — both pre-date this check structurally, not as
  a special case carved out for it. A `minVersion` that is not exactly
  three dot-separated non-negative integers is `invalid_config` — a bad
  *value* for a recognised key, the same category `layout.statusFile: not
  a boolean` already is, not a version-skew question at all.
- **Unknown keys are warnings, not errors** (DECISIONS 166, correcting
  165/163 D's own premise): an unknown **top-level** key (anything other
  than `schema`, `statuses`, `sections`, `layout`, `claims`, `problems`,
  `minVersion`) — and, as of this same revision, an unknown key **inside**
  `layout`, `layout.folders`, `claims` or `problems` too — no longer makes
  the configuration invalid. Every command still succeeds; `doctor`
  reports the warning `config:unknown_key`, naming the key, so a typo
  stays visible without stopping work. **The
  honest limit:** this only ever applies going forward, from the nj
  revision that understands it (3.7). A 3.6-or-older `nj` cannot
  retroactively learn the new, more lenient rule — it still fails
  strictly (`invalid_config`) on an unknown key inside a nested block
  (`layout`/`claims`), exactly as it always has. Only **top-level** keys
  were ever silently tolerated by old binaries (confirmed live against
  3.5.0 and 3.6.0: an unrecognised top-level key is accepted and ignored,
  not rejected) — which is why adding `problems`/`minVersion` today is
  safe on a machine that has not yet upgraded, while a *nested*-block
  addition would not be.

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
| `assignee` | string | empty | who (which agent) is on it; free text, no registry — **advisory**, unless the element is claimed (§ 12 "Claims"), where the claim sequence is the truth for exclusivity and `assignee` is its mirror |
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
— with exactly four sanctioned exceptions: the H1 synchronisation above,
`nj note` appending under `## Notes` (§ 10), `nj new`/`nj set` writing a
configured **section role** (`description`, `acceptance`) when one of the
section flags in § 9 is given, and `nj check` flipping one checkbox's
bracket content (§ 10a). Unknown sections are preserved.

Section matching is line-based and **not** fenced-code-aware: a
`## Description` line inside a fenced block is a section heading for reads and
writes alike, so a section write replaces that region and destroys the fence
content. Fence-aware matching is deliberately out of scope for round one —
**except for `nj check`** (§ 10a), which tracks fence state and never
matches a checkbox-shaped line inside one; that command's own section states
the one exception, this rule is otherwise unchanged.

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

### Problem codes — closed vocabulary (DECISIONS 163 E/F, 166)

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
| `claim:mismatch` | the element is `claimed N` but its `assignee` is not N — a crash between the append and the mirror write, a hand edit, or a claim's own rollback losing a race to a concurrent `archive`/`unarchive` (§ 12 "Claims") | warning | no |
| `claim:orphaned` | a claim directory for an element that is archived or does not exist (backlog-level when it does not exist) — not merely `done`: a done-but-still-live element can still legitimately be claimed | warning | — |
| `claim:stale` | the element is claimed and `now − _claim.since` exceeds `claims.staleAfterHours` (§ 5, § 12 "Claims") | warning | no |
| `title:h1_mismatch` | H1 ≠ `title` | warning | no |
| `incomplete:description` | description section absent/empty | — | yes |
| `incomplete:acceptance` | acceptance section absent/empty (task/subtask) | — | yes |
| `acceptance:no_checkbox` | acceptance section has content but no countable checkbox line (task/subtask) — nothing for `check` to tick | warning | no |
| `done:no_acceptance` | `status` is `done` and the acceptance section is absent/empty (task/subtask) | warning | no |
| `done:open_acceptance` | `status` is `done` and the acceptance section has at least one unticked countable checkbox (task/subtask) | warning | no |
| `active_refs_archived` | `depends_on` points into the archive (satisfied) | — | no |
| `id:no_tombstone` | element file has no tombstone (hand-created, or partial tombstone loss) | warning | no |
| `backlog:stray_tmp` | stray `.nj-tmp-*` file (crashed write), backlog-level | warning | — |
| `backlog:ids_missing` | `.nanojira/ids/` absent or empty while element files exist, backlog-level | error | — |
| `config:invalid` | `.nanojira/config.json` violates § 5 (backlog-level) | error | — |
| `backlog:legacy_layout` | v2 layout (`.nanojira.json`, `.ids/` at the top level), backlog-level | error | — |
| `backlog:unreadable_dir` | a directory below the backlog cannot be listed (permissions), backlog-level | error | — |
| `backlog:status_stale` | `STATUS.md` differs from a fresh rendering or is missing (§ 4), backlog-level | warning | — |
| `backlog:claims_unignored` | `.nanojira/claims/` exists and `.gitignore` has no line that is exactly `.nanojira/claims/`, backlog-level | warning | — |
| `config:unknown_key` | an unrecognised top-level config key, or an unrecognised key inside `layout`/`layout.folders`/`claims`/`problems`, backlog-level (DECISIONS 166) | warning | — |
| `config:unknown_code` | a code in `problems.ignore` outside § 7's closed vocabulary, backlog-level (DECISIONS 166) | warning | — |

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
(`id:no_tombstone`, `parent:orphaned`, `acceptance:no_checkbox`,
`done:no_acceptance`, `done:open_acceptance`). `doctor --json` problem objects carry
the field `severity` (the Doctor column value); `ok` is true exactly when no
`error` finding exists.

### Acceptance quality warnings (DECISIONS 163 E/F, 167, 176 B)

Found by an outside team (feedback/team-b-tests TSK-011: acceptance
text without `- [ ]` lines is silently untickable, and `doctor` says
nothing; feedback/team-a TSK-006: a `done` task/subtask with empty
acceptance criteria was never defined as "done", and `doctor` says
nothing about that either; feedback/team-c TSK-001: a `done`
task/subtask that still has an *unticked* box — content exists, it is
simply not finished — was likewise never flagged). All three become
visible, **never blocking**: nothing new is rejected, and no existing
backlog starts failing where it did not before — a backlog with many such
elements today keeps working exactly as it does now, just with warnings
added to `doctor`'s report.

- **E, `acceptance:no_checkbox`** (task/subtask, **live** elements only —
  see below): the acceptance section is present and has content
  (`incomplete:acceptance` does not also fire — the two are mutually
  exclusive, since this one requires content to exist at all), but
  scanning *that section's own span* (from its heading to the next
  `#`/`##` heading or the end of the body — `core/parse.ts`'s existing
  `sectionHeadingIndex`/`sectionEnd`) for a countable checkbox line (`nj
  check`'s own rule, § 10a: a list marker — `-`, `*`, `+`, or an ordered
  `N.`/`N)` — then one space, then `[ ]`/`[x]`/`[X]`; a fenced code
  block within the section, opened and closed the same way § 10a's own
  scan already skips one, is never counted) finds **zero**. A checkbox
  that exists elsewhere in the body (a different section) does not
  satisfy this — the warning is about *this* section's own content, not
  the file as a whole.
- **F, `done:no_acceptance`** (task/subtask, **live** elements only — see
  below): `status` is `done` and the acceptance section is absent or
  empty — the same condition `incomplete:acceptance` already names (and
  that code still fires too; the two axes are independent, same as every
  other pair of codes that can co-occur). Only `done` triggers this one
  — not blocking `--ready` to begin with, since `--ready` already
  requires the first configured status, `done` can never reach it
  regardless of this warning, so Blocks `--ready` = no is not a new
  leniency, just consistent with what was already true.
- **G, `done:open_acceptance`** (task/subtask, **live** elements only —
  see below, DECISIONS 176 B): `status` is `done` and the acceptance
  section (its own span, exactly as E scans it) contains **at least one**
  countable checkbox line (§ 10a's own definition, reused verbatim — the
  same list-marker-then-`[ ]`/`[x]`/`[X]` rule, fence-aware) that is
  **unticked** (`[ ]`). This requires at least one countable checkbox to
  exist at all, so it is mutually exclusive with E (which fires on
  *zero* countable checkboxes) by construction — neither condition can
  hold alongside the other, no carve-out needed to keep them apart. It is
  mutually exclusive with F the same way: F fires when the section is
  absent or empty, which leaves no checkbox line for G to find unticked.
  `acceptance:no_checkbox` not firing and `done:no_acceptance` not firing
  does not imply G fires instead — an element can be `done` with every
  checkbox ticked, the ordinary, warning-free case this whole family
  exists to leave alone.

**All three apply to live elements only** (DECISIONS 167, extended to G
by 176 B): an **archived** element never carries `acceptance:no_checkbox`,
`done:no_acceptance` or `done:open_acceptance`, whatever its acceptance
section holds. An archived element is history —
nobody can act on a warning about it, the same reason archived work is
read-only everywhere else (§ 9, § 11). `archive` already requires every
element in the subtree to be `done`, but never content-complete (§ 11),
so archiving an incomplete or open element was always possible; this
exemption just stops that archive from retroactively picking up a *new*
warning in the process — none of the three codes' own motivating reports
(team-b-tests TSK-011, team-a TSK-006, team-c TSK-001)
was ever about archived history, only live-backlog noise.

All three are shown by `doctor` (warning severity, so `doctor`'s exit code is
unaffected — 0 unless some other, unrelated error exists) and by `new`/
`set`/`note`/`check`'s own text feedback, the same place `incomplete:*`
already appears. `done:open_acceptance`'s own message, in both `doctor
--json`'s `message` field and this same text feedback, names the count —
unticked out of the section's own total countable checkboxes:

```
⚠ TSK-009 has acceptance criteria with no checkbox items — nothing for check to tick.
⚠ TSK-010 is done with no acceptance criteria.
⚠ TSK-011 is done with 1 of 3 acceptance boxes still unticked.
```

**`nj set` (and `nj claim`, for the same `--status=<last>` call D171 B
already covers) additionally report `done:open_acceptance` in their own
`--json` result** — not only inside `_problems`, which carries the bare
code same as every other result consumer, but with the count attached, the
same "elaborate a `_problems` code with more detail" precedent `rm`'s own
`dependents` field already set. **`open_acceptance?: {unticked, total}`**
(both plain counts of countable checkboxes in the section) is present
exactly when a write naming `--status=<last>` in that same call (whether
it is a genuine transition into the final status or a re-assertion of it,
the same condition D171 B's own `released?` uses) leaves the element
carrying `done:open_acceptance` — absent, not `null`, otherwise. A
refused `set --status=done` releases nothing and reports nothing here
either, for the same reason D171 B's own refusal case reports no
`released`: the refusal is decided, and the call exits, before any write
or count is attempted.

Counted, read-only, against the two outside teams' real backlogs before
this lands (so the Lead can warn them what to expect): team-a's 54
elements get 0 new E warnings and 5 new F warnings (`SUB-003`, `SUB-008`,
`SUB-014`, `SUB-017`, `TSK-005`); team-b-app-test's 960
elements get 10 new E warnings (`SUB-176`, `SUB-177`, `SUB-194`,
`SUB-195`, `SUB-196`, `SUB-198`, `TSK-028`, `TSK-029`, `TSK-030`,
`TSK-724`) and 287 new F warnings — most of that backlog's own `done`
elements track completion through tags and an external test-case
reference instead of a checklist, with `## Acceptance Criteria` left
empty by design. None of this changes `--ready`, `list`, or any count:
only `doctor`'s own report and `new`/`set`/`note`/`check`'s prose gain
these two warnings. `done:open_acceptance` (G) was added later (DECISIONS
176 B) and was not part of this read-only count; it is the same kind of
warning, counted the same way, against whichever backlogs ask for it.

### Warnings can be switched off per backlog: `problems.ignore` (DECISIONS 165, amended 166)

The read-only count above is exactly what motivated this: 287 warnings in
one `doctor` run is noise that buries real findings, for a team whose
`done` elements track completion through tags and an external test case
on purpose, acceptance left empty by design. `problems.ignore` (§ 5) is a
list of **warning**-severity codes (§ 7's own Doctor column) a backlog
chooses to never see reported, at all, again — a config-level opt-out,
not a one-off `--fix` or a flag on each call.

**What "suppressed everywhere" means, precisely:** once a code is listed,
it never appears in `doctor`'s findings (text or `--json`'s `problems`
array), never in any element's `_problems` (reads and write results
alike), never in `new`/`set`/`note`/`check`'s own text feedback, and
`doctor`'s own warning tally no longer counts it. A backlog-level code
(one with no single element behind it, e.g. `backlog:claims_unignored`)
is suppressed from `doctor`'s findings the same way — it was never in any
element's `_problems` to begin with, so the other three places are moot
for it. **`done:open_acceptance` listed in `ignore` also suppresses
`set`/`claim`'s own additive `open_acceptance?` field** (DECISIONS 176
B, above) — the field exists only to elaborate a `_problems` code that is
itself gone once ignored, so reporting the count anyway while hiding the
code it belongs to would be the one inconsistent case "suppressed
everywhere" could have, had this not been stated plainly.

**What it does *not* change: the readiness rule.** `--ready` (§ 9) keeps
evaluating the exact same underlying condition every element always had,
whether or not that condition's code is on the ignore list — ignoring
`unknown:status` (a warning, and one that *does* block `--ready`, § 7)
stops it being reported, but an element with a genuinely unrecognised
status is still excluded from `--ready`, exactly as before. Suppressing
the report is not excusing the defect; only `--json`/`doctor`'s *view* of
it changes, never the ready computation itself, `list`, or any count
driven by an error or `incomplete:*` code (neither of which can ever be
listed to begin with).

**Validity** (§ 5): only a code whose § 7 Doctor severity is **warning**
may appear in `ignore`. Today's full closed list of warning-severity
codes — the only ones ever eligible — is: `missing:status`,
`missing:created`, `missing:updated`, `id:derived`, `type:derived`,
`parent:orphaned`, `unknown:status`, `unknown:priority`,
`done:open_children`, `title:h1_mismatch`, `id:no_tombstone`,
`backlog:stray_tmp`, `claim:mismatch`, `claim:orphaned`, `claim:stale`,
`backlog:claims_unignored`, `acceptance:no_checkbox`,
`done:no_acceptance`, `done:open_acceptance`, `config:unknown_key`, and `config:unknown_code`
themselves (DECISIONS 166 — both are warnings, so both are eligible to
be silenced the same way any other warning is; nothing about being part
of this very mechanism exempts them). A **known error**-severity code, or any
`incomplete:*` code (severity `—`, and the one axis this feature must
never touch — § 7's own "never blocking" promise for E/F would mean
nothing if the thing one rung up, `incomplete:acceptance`, could be
silenced), is still `invalid_config`, naming the offending code — that
is misuse, not version skew, so it stays a hard failure. A code **not in
§ 7's closed vocabulary at all** (a typo, a retired code, or one a
*future* revision defines that this build doesn't know yet) is instead
the warning `config:unknown_code` (DECISIONS 166, amending the original
165 ruling above, which had this as `invalid_config` too) — `doctor`
reports it, naming the unrecognised code, and it is simply **skipped**:
it suppresses nothing, but every other, valid code in the same list
still does.

This also answers a piece of v3.5 dogfooding friction (`backlog:claims_
unignored` has no opt-out, even for a backlog deliberately tracking
claims in git on purpose): it is a warning-severity code, so it is
eligible for `problems.ignore` like any other.

**Re-counted, read-only, with `done:no_acceptance` ignored** (so the Lead
can share the effect before suggesting it): team-b-app-
test's 287 `done:no_acceptance` warnings drop to 0; its 10
`acceptance:no_checkbox` warnings are unaffected (not on their list) —
confirming the feature removes exactly the noise it targets and nothing
else. team-a's own 5 `done:no_acceptance` warnings would likewise
drop to 0 if they chose to ignore it too (their own call, not suggested
here).

### Config forward compatibility (DECISIONS 166)

Today, an older `nj` fails **every** command with `invalid_config` on a
key written for a newer one — the correction this round itself is built
on: the Lead assumed old `nj` already rejected an unknown top-level key
outright and had not checked; the Oracle found, and the Lead confirmed
live against 3.5.0 and 3.6.0, that it is **silently ignored** instead.
From 3.7 this becomes a visible warning rather than silence, so a typo
stays discoverable without anything stopping working — see § 5's own
"Unknown keys are warnings, not errors" and `minVersion` rules for the
exact behaviour and codes (`config:unknown_key`, `config:unknown_code`,
`needs_newer_nj`), and the honest limit stated there: this relaxation is
only ever as forward-reaching as the `nj` revision running it. A
3.6-or-older `nj` reading a 3.7-written config still fails strictly on
an unknown key inside a nested block — nothing retroactive changes that.
`problems`/`minVersion` are new **top-level** keys, which is exactly the
shape old binaries already tolerate silently, so adding either to a
config read by a mixed-version fleet is safe; a hypothetical new
*nested*-block key would not be, until every machine is on 3.7+.

### Canonical key order

On write: `id`, `type`, `parent`, `title`, `status`, `priority`, `assignee`,
`tags`, `depends_on`, `created`, `updated`, `archived` — then unknown keys in
their original order. Empty optional fields are omitted. The serializer is
**normative** (§ 15, AC-2): golden fixture files pin its output.

---

## 8. Identifiers

Per type, sequential, zero-padded to three digits: `EPIC-001`, `TSK-001`,
`SUB-001`. Past 999 the number naturally grows.

**IDs are never reused — provided `.nanojira/ids/` is preserved** (`ids/`
below, for short; `.ids/` always means the legacy top-level folder). Allocation is
decoupled from the element files: the true allocator is an empty **tombstone
file** `<backlog>/.nanojira/ids/TSK-007`, created with `O_CREAT|O_EXCL`. `O_CREAT|O_EXCL`
is the **sole** claiming authority: the allocator computes only a **start
value** — the highest number found across `ids/` *and* all element files
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
eligible for `--ready`. A missing or empty `ids/` while element files exist
is `backlog:ids_missing`, an ERROR. `doctor --fix` creates tombstones for
every ID found in element files (active and archive) — unambiguous
restoration. Tombstones for already-deleted IDs cannot be recovered; `--fix`
reports that the never-reuse guarantee is void for those numbers. Residual
risk, disclosed: a lost `ids/` can still recycle the numbers of elements
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
nj --version                           print the version and exit (§ 9, below)
nj                                     short status: counts, top ready, problems
nj init                                create backlog layout (§ 4)
nj <any command> --backlog=<path>      use this backlog (§ 4, Backlog location)
nj new   --type=task --parent=EPIC-001 --title="…"
         [--status=…] [--priority=…] [--tags=a,b] [--assignee=…] [--depends-on=…]
         [--description=… | --description-file=…]
         [--acceptance=…  | --acceptance-file=…]
nj set   --id=TSK-009 [--title=…] [--status=…] [--priority=…]
         [--tags=…] [--assignee=…] [--depends-on=…]
         [--description=… | --description-file=…]
         [--acceptance=…  | --acceptance-file=…]
         [--force] [--allow-open-children]
nj note  --id=TSK-009 "text" [--as=<name>] (§ 10)
nj check --id=TSK-009 --text=<substring> [--on | --off] [--force] (§ 10a)
nj check --id=TSK-009 --item=<n>         [--on | --off] [--force] (§ 10a)
nj show  --id=TSK-009 [--json]
nj list  [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
         [--ready] [--all] [--json]
nj find  "<text>" [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
         [--all] [--case-sensitive] [--json] (§ 9a)
nj tree  [--id=EPIC-001] [--all] [--json]
nj rm    --id=TSK-009 [--cascade]
nj archive --id=EPIC-001 (§ 11)
nj unarchive --id=EPIC-001 (§ 11a)
nj claim   --id=TSK-007 [--as=<name>] [--status=<s>] [--steal=<holder>] (§ 12 "Claims")
nj release --id=TSK-007 [--as=<name>] (§ 12 "Claims")
nj next    [--as=<name>] [--status=<s>] [--type=…] [--tag=…] [--parent=…]
           [--assignee=…] [--json] (§ 12b)
nj log     --id=TSK-009 [--json] (§ 12c)
nj doctor [--fix] [--json]
```

All commands accept `--json`; reads *and* writes (§ below). All commands
accept `--backlog=<path>` as well, and it appears in every command's list of
known flags; `--backlog` without a value is `missing_value`.

`set`, `note`, `check`, `claim` and `release` additionally accept
`--id=A,B,C` (two or more comma-separated IDs) in place of a single `--id`
— see "Batch writes" below.

### `--version`

`nj --version` prints `nj <version>` and exits 0; with `--json`, it
prints `{"version": "<version>"}` instead — the only two forms. It
resolves no backlog and reads no file other than its own, so it works
anywhere, including a directory with no backlog and no `.njrc` anywhere
above it. `nj version` (a subcommand) is not added; `--version` is a flag
only, checked before a command is even dispatched — ahead of the backlog
resolution every other command (including bare `nj`) performs.

**There is exactly one version source**: the `"version"` field in
`package.json` (`3.4.0` as of this round), embedded at build time into
`dist/nj` and `dist/nj-mcp` alike, so the two binaries can never report
different versions of themselves from drifting independently.

`--version` combined with anything beyond `--json` — another flag (`--
help`, `--backlog=…`, …) or an explicit subcommand (`nj list --version`)
— is `unknown_field`, exactly the same code and the same reason a typo'd
flag already is: `--version` is not a known flag for whatever command
context applies once something else is present (the subcommand named, or
the implicit bare command when none is). It is not a special case that
tolerates being combined with anything; it recognises only itself and
`--json`, nothing more.

`nj help` lists `--version` in its command summary.

### `--help` (per-command, DECISIONS 158 EV-2/EV-3, 163 A)

`nj <command> --help` prints **that command's own** synopsis and flags —
not the general help every command used to fall back to. `nj help` and
bare `--help` (no command word before it) are unchanged: the same general
command list as always. The precedence `--help`/`help` already has —
checked before anything else, regardless of what other flags are present,
never failing on an unknown or malformed flag alongside it — is
unaffected; it now resolves to a **per-command** text when a command word
is present, the general one otherwise.

A command's own `--help` text has, in order:

1. Its synopsis line(s), exactly as `nj help`'s own command list already
   shows them (§ 9 "Commands (round one)") — one `--help` source, not a
   second copy to keep in sync.
2. One line per flag the command accepts, from the same per-command flag
   table `nj-mcp`'s own tool schemas already read (`core/flag-table.ts`,
   § 17) — so this, `nj-mcp`'s schemas, and the CLI's own flag validation
   can never drift apart from each other. A flag with a **closed
   vocabulary** (`--type`, `--status`, `--priority`) names its allowed
   values on the same line; any other flag is marked free-form, nothing
   invented about it.

`nj rm --help` gets these same per-flag lines (`--id`, `--file`,
`--cascade`) too (DECISIONS 163 A) — it had none before this, not because
anything about `rm` itself is different, but because `rm` is never
exposed as an `nj-mcp` tool at all (§ 17: `rm` is omitted from the tool
list unconditionally, not merely gated), so its flags had never been
added to the shared table either. That gate on *exposure* is separate
from this one on *documentation*: `rm`'s own table entry answers only
`nj rm --help`'s question, same as any other command's, and changes
nothing about which tools `nj-mcp` offers.

**Allowed values shown:** `--type` is always `epic | task | subtask`;
`--priority` is always `low | normal | high | urgent` — neither is
configurable, so these never vary by backlog. `--status` shows the
**current backlog's configured `statuses`** (§ 5) when one resolves
cleanly (a valid config found by the usual search, § 4); otherwise — no
backlog at all, or one whose configuration is invalid or unreadable — it
falls back to the **default** list (`todo, doing, blocked, review, done`,
§ 5's own `DEFAULT_CONFIG`). Resolving a backlog for this purpose is
**best-effort and silent**: `--help` itself never fails and never reports
`no_backlog`/`invalid_config` the way every other command would — the
same "works anywhere" discipline `--version` already has (§ 9
"`--version`"); an agent asking what `--status` accepts should get an
answer even from an empty directory, the defaults standing in for "no
backlog resolved."

`--json` has no meaning combined with `--help`, on any command: output is
prose regardless, the same rule `nj help` itself already has (§ 9
"Failure codes — closed vocabulary": "`--json` is defined for the command
set of this section. `nj help` is not one of them").

### Did-you-mean (DECISIONS 158 EV-3, 160)

An invalid `--type`/`--status`/`--priority` value stays `invalid_value`,
unchanged — the vocabulary is exactly as closed as before, and no alias is
ever *accepted* as a value. Only the **hint** (never the message) gains a
suggestion when exactly one is unambiguous, checked in this order:

1. **A tiny, fixed synonym table** — today exactly one entry,
   `priority`'s `medium → normal` — checked first, verbatim, regardless
   of edit distance (`medium` is six edits from `normal`; a distance rule
   alone would never catch it, which is the table's whole reason to
   exist).
2. Otherwise, the **optimal-string-alignment (OSA) distance** from the
   given value to every allowed value (the backlog's configured
   `statuses` for `--status`, the fixed lists for `--type`/`--priority`),
   case-sensitive like every other exact-string comparison in this
   document. OSA is Levenshtein (insert/delete/substitute, each cost 1)
   plus an adjacent transposition, also cost 1, not two substitutions
   (DECISIONS 160 addendum) — a swapped pair of letters is the most
   common typo, and plain Levenshtein would otherwise put `hgih` two
   edits from `high` instead of one. The threshold depends on the given
   value's own length (DECISIONS 160): **≤ 1** when it has **≤ 4
   characters**, **≤ 2** otherwise — for a short word, distance 2
   replaces half of it, which is noise rather than a hint (`--status=nope`,
   4 characters, is distance 2 from `done` — no transposition shortens
   it — and gets no suggestion; `--status=don`, 3 characters, is distance
   1 from `done` and does; `--priority=hgih`, 4 characters, is distance 1
   from `high` via the `gi`/`ih` transposition and still does too). If
   the single smallest distance across all allowed values is at or under
   that threshold and reached by **exactly one** of them, that value is
   suggested. A tie at the minimum distance, or every distance over the
   threshold, suggests nothing — guessing wrong is worse than not
   guessing (§ 14's own "never guess" discipline, applied to a hint
   instead of a repair).

When a suggestion exists, the hint gains a leading sentence: `did you mean
'<value>'?`, followed by the existing `Known <fields>: …` list, unchanged
in content and order. The message itself (`unknown <field> '<value>'`) is
never touched, so anything already matching it by substring still does.
`medium` for `--priority` therefore becomes:

```
Error: unknown priority 'medium'
did you mean 'normal'? Known priorities: low, normal, high, urgent
```

### The acting name

Two commands need to know **who is acting**: `nj note` (§ 10, who signs) and
`nj claim`/`nj release` (§ 12 "Claims", who claims). Both resolve it the same
way, in this order:

1. an explicit `--as=<name>` flag, on the commands that have one;
2. `NJ_AUTHOR=<name>` from the environment;
3. none.

An empty `NJ_AUTHOR` counts as **unset** — the same rule as an empty
`NJ_BACKLOG` (DECISIONS 89). This does **not** extend to `--as`: an empty
`--as=` is not unset, it is an invalid name (`invalid_value`, DECISIONS 119)
— an explicit flag given with nothing in it is a caller's mistake, the same
as a whitespace-only or multi-line one; only an empty environment variable
gets the "unset" reading. A name — from either source — is valid when,
after dropping leading and trailing whitespace, it is non-empty, is a single
line, and contains no `:`; only spaces and tabs are trimmed, any `\n` or `\r`
left (trailing included) makes it multi-line, and Unicode spaces are literal,
not trimmed. The trimmed value is used. The colon is excluded because `nj
note`'s line format (§ 10) is `- <timestamp> <author>: <text>`: a name with a
colon would make the author/text boundary unreadable.

An invalid name is a hard error, nothing written: `NJ_AUTHOR` → exit 1,
`invalid_env`; `--as` → exit 1, `invalid_value`. A valid `--as` outranks the
environment, so a malformed `NJ_AUTHOR` does not fail a command that was
given one. Reads never fail on it: `list --ready` (condition 5, § 12
"Claims") treats an invalid or absent acting name as no name. Whether the
**absence** of any acting name is itself an error depends on the command:
`nj note` falls back to `assignee`, else `?` (§ 10); `nj claim`/`nj release`
require one (`missing_argument`, § 12 "Claims").

Names are labels, not identities: there is no registry, no authentication,
and two agents that choose the same name are the same actor — the same trust
model `assignee` has (§ 6).

### Rules

- **Verb as a subcommand**, not as a flag: `nj set`, not `nj --set`.
- **`--backlog` and `--json` may precede the command word** (DECISIONS
  158, EV-6) — `nj --backlog=<path> list`, `nj --json list
  --backlog=<path>`, or any mix of the two in either order, any number of
  times (the last occurrence of a repeated one wins, the same as anywhere
  else a flag repeats). These are the **only** two flags this applies to:
  the search for the command word skips past a leading run of exactly
  `--backlog[=…]`/`--json` and stops at the first token that either does
  not start with `--` (that token is the command) or does (anything
  else — including a flag that would be perfectly valid for whatever
  command follows, such as `--status=doing` ahead of `set`). In the
  second case no reordering happens: the entire input, unchanged, is
  parsed as the **bare** (no-command) invocation's own flags, and that
  flag is `unknown_field` against the bare command's known flags
  (`--backlog`, `--json`) — a clear error, never a silent fallback to a
  different command. Once a command word **is** found this way, it is
  removed from the stream and everything else — `--backlog`/`--json`
  wherever they actually sat, plus the command's own flags and
  positionals — is parsed together, in original order, as that command's
  own arguments; the command word itself is never silently dropped (the
  bug this closes: `nj --backlog=X list` used to run the bare, no-command
  status instead of `list`, and `nj --backlog=X show --id=…` used to fail
  `unknown_field` for `--id` against the bare command, never reaching
  `show` at all). `--version`'s own exclusivity (§ 9 "`--version`",
  DECISIONS 151/152) is checked first, against the complete, unmodified
  argument list, and is untouched by this rule: `--version` combined with
  `--backlog` in either order is still `unknown_field` for `--version`,
  never a backlog-scoped version query. `help`/`--help` keep their own
  existing precedence (recognised regardless of where `--help` sits,
  unconditionally printing the general help) and are not changed by this
  rule either — a per-command `--help` is separate, later work, not part
  of this rule, and `nj --backlog=X help`/`nj --backlog=X --help` both
  still just print the general help today, backlog unused.
- **Addressing is only by `--id`** — exact, case-sensitive. Titles are labels,
  not addresses, and carry no uniqueness requirement. References (in files and
  in `--parent`/`--depends-on`) are matched exactly; `doctor` reports anything
  that points nowhere.
- **Duplicate IDs:** reads show both entries, marked `duplicate_id` — and
  `nj show --json`'s own additive `entry` (DECISIONS 171 C, § 9
  "JSON shapes per command") is exactly the one case where it is absent:
  two entries, not one. Writes
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
- **`nj set --add-tags=<list>` / `--remove-tags=<list>`** (DECISIONS 163 B):
  an incremental alternative to replacing the whole `tags` list, for
  `set` only (`new` has no existing list to add to or remove from).
  Each is comma-separated and validated **per item**, exactly like
  `--tags` (an item containing `,` or `]` is `invalid_value`). Either or
  both may be given in one call, and both may be combined with batch
  writes (`--id=A,B,C`, § 9 "Batch writes") — each ID's own current
  `tags` is read and changed independently, never a shared list across
  IDs. **Combined with `--tags=` in the same call — in any combination,
  regardless of whether that would otherwise be a no-op — is
  `invalid_value`, nothing written**: replacing the whole list and
  changing it incrementally are two different intentions, and mixing
  them is never assumed to mean one or the other.

  The resulting list, pinned: **remove, then add.** First, every tag
  named in `--remove-tags` is removed from wherever it sits in the
  current list (removing one that is not present is a no-op for that
  tag, not an error — the end state, "this tag is absent," is already
  true). Then, every tag named in `--add-tags`, in the order given, is
  appended to what remains — but only if it is not already present
  there (adding one already present is a no-op for that tag: it is not
  duplicated, and does not move). A tag named in **both**
  `--remove-tags` and `--add-tags` is a different case, already covered
  by "remove, then add" above, not this no-op rule: it is removed from
  its old position in the first phase, so by the time the second phase
  checks whether it is "already present there", it is not — it is
  re-added fresh, landing at the end with every other newly added tag,
  not left in its original spot. A tag that appears more than once
  within `--add-tags` itself is likewise only ever added once. The
  existing tags that were not removed **keep their original relative
  order**; every newly added tag lands after all of them, in
  `--add-tags`'s own order. If the result is identical, element by
  element and in the same order, to the tags the element already had
  (every removal and addition turned out to be a no-op), `tags` is not
  reported in `changed` — the same "no actual change, nothing to
  report" rule `--tags=` itself already follows.
- `nj-mcp`'s `set` tool schema carries `add-tags` and `remove-tags` as two
  more input fields (§ 17), the same hyphenated-name convention
  `case-sensitive`/`allow-open-children` already use for a flag that is
  not itself an `Element` schema field (unlike `depends-on`, which is
  normalised to the real field name `depends_on` because one already
  exists).
- `nj new` validates: `--parent` required for task/subtask and must exist with
  the correct type (task→epic, subtask→task); forbidden for epics. The parent
  must be **active** — an archived parent is refused, since a fresh child of
  an archived parent would instantly carry `archive:split`. An **unreadable
  stub** (`file:unreadable`) is refused as a parent for the same reason: its
  type cannot be verified, and § 6 forbids inventing facts about it.
  `--depends-on` targets must exist. `--priority` and `--status` are validated
  against the config.
- **`nj set --parent=<id>` reparents a task or subtask** (DECISIONS 176
  A, 177, feedback/team-b-tests TSK-014). The id, the body (description,
  acceptance, any unknown sections) and the claim log are all kept
  unchanged — a claim is keyed by **id** (§ 12 "Claims"), never by path,
  so reparenting never disturbs it. The type never changes: a task moves
  under a different epic, a subtask under a different task; moving a
  subtask under a task's own sibling epic, or converting a subtask to a
  task (or back), is out of scope and not what this flag does. The error
  codes **mirror `new`'s own `--parent` validation exactly** (DECISIONS
  177 — D176's original "uniform `invalid_value`" ruling was a mistake,
  corrected before implementation): a missing new parent is `not_found`;
  a wrong-type new parent (task↦epic, subtask↦task, the same direction
  `new` already requires) is `invalid_target`; an archived new parent is
  `refused:parent_archived`; `--parent` given to `set` on an **epic** at
  all is `invalid_value`, the same "forbidden for epics" code `new`'s own
  `--parent` already uses. Nothing is written in any of these cases. An
  **unreadable stub** as the new parent is refused the same way `new`
  already refuses one (`file:unreadable`, its type unverifiable).
  `nj set --parent=<old>` (moving an element back to its previous parent)
  is an ordinary reparent like any other and **restores the previous
  state**: the file sits back at its old location, and the frontmatter is
  identical to before apart from `updated` — there is no separate `nj
  undo` command (DECISIONS 177 corrects D176's mistaken mention of one;
  `undoRelease` in `core/claims.ts` is only the internal rollback of a
  failed `set`, never a user-facing command). Under
  `hierarchy` the file (subtask) or whole folder (task, children
  included) relocates to sit under the new parent, exactly as
  `archive`/`doctor --fix` already relocate a subtree (§ 4, § 12); under
  `type`/`flat` only the frontmatter changes, since placement there
  never depended on `parent` to begin with. **The frontmatter write and
  the relocation are one operation, not two:** on success, the file (or
  folder) sits at its new location carrying its new `parent`; on any
  failure partway through, the backlog is left exactly as it read before
  the call — same `parent`, same location, nothing written, no
  half-moved element — the same guarded-write, nothing-or-everything
  guarantee every other write in this spec already gives (§ 12).
  `--input set` accepts `parent` as one more of
  `set`'s own settable fields, same as every other flag (§ 9 "`--input`").
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
- Archived elements are **read-only**: `set`, `note`, `rm` and `archive`
  refuse them; `nj unarchive` (§ 11a) is the one write that accepts an
  archived element. Reads and `--all` keep working.
- **A claim is exclusive only against another claim** (§ 12 "Claims"): it
  never blocks a read or any other write — `set`, `note`, `rm`, `archive`,
  `doctor --fix` work on a claimed element exactly as on an unclaimed one.
  It blocks only a competing `nj claim`, and hides the element from another
  acting name's `--ready` (below).
- `list` filters are validated: `--status` against the configured statuses,
  `--parent` against existence — a typo'd filter is an error (exit 1), never a
  silently empty result.
- **Sort order** of `list`, `tree` and bare `nj` is deterministic: priority
  weight descending (`urgent` 4, `high` 3, `normal` 2, `low` 1, missing 2),
  then `id` ascending. Never filesystem order.

### Batch writes (`--id=A,B,C`)

`set`, `note`, `check` (§ 10a), `claim` and `release` (§ 12 "Claims") accept
`--id=A,B,C` — two or more comma-separated IDs — applying the same field map
or action to every one. **Not** `rm`, `archive`, `unarchive`: those already
have their own multi-element semantics built around one addressed root
(`rm --cascade`, `archive`'s subtree, § 11a's archived-subtree gathering),
where `--id=A,B,C` would mean "N independent subtree operations", no better
than N invocations. A single `--id=A` (no comma) is unaffected and keeps
today's unwrapped write-result shape exactly — the wrapper below applies
only once there is more than one ID.

**Preflight: every ID is resolved and validated before anything is
written.** One pass over the backlog checks every ID in the batch. Preflight
conditions fall into two kinds, reported differently (Output, below):

- **Batch-wide argument errors** — conditions that are properties of the
  *invocation*, not of any one ID: `unknown_field`, `missing_argument`,
  `missing_value`, an invalid field value (`invalid_value`); a missing or
  invalid acting name for `claim`/`release` (`missing_argument`,
  `invalid_env`, `invalid_value`, § 9 "The acting name"); `--id=A,B,C`
  together with `--file` (`invalid_target` — the same reading as
  `--id`+`--file` for one element: `--file` addresses exactly one element
  unambiguously, the opposite of what a batch solves); and **`--id=A,A`
  — the same ID named twice, checked after trimming whitespace —
  `invalid_value`**, since "resolved and validated" already implies every
  named ID is distinct.
- **Per-ID preflight failures** — conditions that are properties of one
  named ID, evaluated the same way the command already evaluates them for a
  single element, just once per ID up front: addressing (`not_found`,
  `duplicate_id` without `--file`; for `check`, its `--text`/`--item`
  resolving to exactly one countable checkbox, § 10a's
  `not_found`/`ambiguous_target`) and each command's own
  refusal-before-anything-is-written conditions (`refused:archived`,
  `refused:unreadable`).

**Any preflight failure, of either kind, aborts the whole batch: nothing is
written for any ID**, and `STATUS.md` (§ 4) is not regenerated. The two
kinds differ only in how the failure is *reported* (Output, below) — both
abort identically.

**Runtime failures do not stop the others.** Once preflight passes for
every ID, **the IDs are written in the order `--id` named them** —
execution order, not just the results order below — and each one writes
independently through that command's own existing
live-state mechanism (compare-before-write, § 12; `nj claim`'s
read-decide-`link()` loop, § 12a) exactly as a single invocation would.
Anything that mechanism can produce because the backlog moved between
preflight and this ID's turn to write is specific to that one ID —
`changed_in_parallel`, `refused:claimed`, a `fault:<hook>`, an `io_error` —
and is reported for that ID without aborting or skipping the rest: a batch
is not a transaction across its members, only within each one.
**`NJ_FAULT` (§ 12, verification hook) fires once per batch**, at the first
write, in execution order, that reaches its injection point — that ID fails
with `fault:<hook>` and the hook is then spent, so every later ID writes
normally. `--force`
applies to the whole batch, overriding a parallel change on every ID it
would otherwise have hit (§ 9, `--force`'s one meaning). Exit code: `1` if
any ID failed, preflight or runtime; `0` only if every ID succeeded — the
same binary the rest of this section uses, no third "partially succeeded"
code.

**Output — three forms, depending on where the batch stood when it stopped:**

**1. A batch-wide argument error** (above) never reaches `results` at all —
it is reported in § 9's ordinary generic single-write failure shape,
`{ok: false, error: "<code>", hint: "…"}` (`hint` optional), exactly as a
malformed single invocation is today. This is deliberate: these conditions
are properties of the invocation, not of any named ID, so there is nothing
to list per ID.

**2. A per-ID preflight abort** uses the wrapper, but `results` names
**only the ID(s) that failed preflight, in the order `--id` named them** —
an ID that would have gone on to succeed is not listed at all, since
nothing was attempted for it:

```json
{
  "ok": false,
  "results": [
    { "id": "TSK-002", "ok": false, "error": "refused:archived" }
  ]
}
```

(Given `--id=TSK-001,TSK-002,TSK-003` with only `TSK-002` archived,
`results` has exactly this one entry — not three.)

**3. Once preflight passes for every ID**, `results` names **every** ID, in
the order `--id` named them, succeeded or not:

```json
{
  "ok": false,
  "results": [
    { "id": "TSK-001", "ok": true, "changed": ["status"],
      "entry": { "…": "…" }, "_problems": [] },
    { "id": "TSK-002", "ok": false, "error": "refused:claimed",
      "hint": "use --steal=<holder>" }
  ]
}
```

(The example's failure is a *runtime* one — `refused:claimed` — which can
only appear once every ID has cleared preflight; a batch that aborted at
preflight never reaches this form.)

In both wrapper forms (2 and 3):

- **Top level:** exactly `{ok, results}`. `ok` is `true` iff every
  `results[i].ok` is `true` — it mirrors the exit code; nothing else is
  added at the top level (no batch-wide `_problems`, each result already
  carries its own).
- **Each entry whose write succeeded** is exactly that command's own
  single-element write-result shape (§ 9's JSON-shapes table / § 12a's
  `claim`/`release` row) plus the leading `id` key.
- **Each entry whose write failed** (preflight or runtime — no new codes,
  only a difference in *when* the failure was found and in which IDs
  `results` lists, form 2 vs. form 3) is `{id, ok: false, error: "<code>",
  hint: "…"}` — `hint` optional, exactly as in § 9's generic single-write
  failure shape.
- This is a genuinely new top-level shape, not an overload of the
  single-write one: a single `nj set --id=TSK-001` continues to produce
  exactly what it produces today, since that path never produces a
  `results` array.

`STATUS.md` (§ 4) is regenerated **at most once, after every ID's write
phase has finished** — never once per ID — and only if at least one ID was
actually written.

### `--input` — JSON plans for `new`/`set` (DECISIONS 171 A, 172, 173)

> Amended after both outside leads reviewed the original draft (ecea716)
> against real plans of their own (DECISIONS 172). Settled, not a
> proposal.

`nj new --input=<file|->` and `nj set --input=<file|->` take a JSON
**object** — or, for `new` only, an **array** of objects — whose keys are
exactly that command's own flag names (the same per-command flag table
`nj-mcp`'s tool schemas already read, § 17; `nj <command> --help`, § 9,
lists them). A list-valued field (`tags`, `depends_on`) is a JSON array of
strings, not a comma-joined string; a multi-line value (`description`,
`acceptance`) is a plain JSON string, embedded newlines and all — no
CLI-specific comma-splitting or quoting rules apply once a value is inside
this JSON. An unknown key — anything not one of the command's own fields,
and not `children`/`ref` below — is `unknown_field`, the same as an
unknown `--flag` today.

**Mutually exclusive with field flags.** `nj new --input=- --title=X` is
rejected (`invalid_value`, nothing written): `--input` and the field flags
are two different sources for the same values, and mixing them is never
assumed to mean one or the other — the same discipline `--tags=` combined
with `--add-tags=`/`--remove-tags=` already has (§ 9, DECISIONS 163 B).
Control flags are unaffected and compose normally: `--backlog`/`--json`
for both commands, `--force`/`--allow-open-children` for `set`. (Neither
`new` nor `set` has an `--as` flag today, so there is nothing to carve out
there specifically — if that ever changes, it composes with `--input` the
same as any other control flag, untouched by this section.)

**`--input=-` reads stdin; `--input=<path>` reads a file**, relative to
the working directory — the same convention `--description-file`/
`--acceptance-file` already have (§ 9). An unreadable path is `not_found`,
matching `--<role>-file`. Text that does not parse as JSON, or that parses
to something other than an object (or, for `new`, an array of objects), is
`invalid_value`. If `--input` itself consumed stdin, a `description-file`/
`acceptance-file` value of `-` **inside** that JSON is also `invalid_value`
— the same single-consumption conflict § 9's own section-write rules
already name for two roles both reading stdin in one call, just reached
through JSON instead of two flags.

**`set --input=` takes exactly one object — never an array.** The object's
keys are `set`'s own settable fields only (`title`, `status`, `priority`,
`assignee`, `tags`, `depends_on`, `parent` (DECISIONS 176 A),
`description`(`-file`), `acceptance`(`-file`), `add-tags`,
`remove-tags`) — **not** `id`/`file`:
addressing stays exactly where it is today, on the CLI (`--id=<id>`,
`--file=<path>`, or the existing `--id=A,B,C` batch, § 9 "Batch writes"),
unchanged. `--input` only ever supplies the field map; it composes with
`--id=A,B,C` exactly the way field flags already do — the same parsed
object is applied to every named ID. **Decision, and why:** an array of
self-addressing objects (each carrying its own `id`, updating several
*different* elements with *different* field values in one call) was the
other option and is deliberately **not** supported this round. It would be
a second, more powerful batch mechanism existing alongside
`--id=A,B,C` — a different problem (heterogeneous batch updates) nobody
has asked for — and it would need its own failure-reporting shape
distinct from both today's batch wrapper and `new`'s plan shape below.
`set` stays a single-target command, exactly as every other rule in this
spec already assumes; only its one field map now has a second source.

**`new --input=` additionally accepts a plan: an array of objects, and
nesting via `children`.** An array is a flat list of top-level elements —
no implied relationship between them, though each may carry its own
`children`. Inside an object, `children` is an array of objects in the
same shape (type/title/.../`children`/`ref`), but with `parent` **implied
by the nesting** rather than given: a `children` entry that also gives an
explicit `parent` conflicts with its own position in the plan
(`invalid_value`). The three-level hierarchy (§ 6) is enforced exactly as
it already is for a single `new`: an epic's `children` must each be
`type: "task"`; a task's `children` must each be `type: "subtask"`; a
subtask may not have `children` at all (`invalid_target`, the same code
an explicitly wrong `--parent` type already gets). Every other `new` rule
is unchanged per node: `description` required for completeness-tracking
purposes exactly as today (absence is not rejected, only incomplete, § 7),
`--acceptance` likewise for task/subtask, `priority`/`status` validated
against the config, a `parent` (explicit at the top level, or implied
inside `children`) must be active and not an unreadable stub.

**`parent` is never `ref`-aware** (DECISIONS 173, the second gap found
alongside the forward-ref one above): unlike `depends_on`, `parent` names
a real, already-existing element only — an explicit `"parent": "@x"` is
`invalid_value`, not a lookup against this plan's declared `ref`s and not
`not_found` either, since the `@`-prefix is reserved syntax (the same
"decorated value" family as the rules above), not a shape that happens
not to resolve. A new element's parent being *another new element in the
same plan* is expressed by nesting it under that element's own `children`
— there is no second way to say the same thing through `parent`+`ref`
together, so none is offered.

**`ref` — a local name for a same-plan sibling, resolved before any
write.** `depends_on` may name either a real, already-existing ID (checked
the normal way, `not_found` if it does not resolve) or a `ref` string
declared on some **other** object **earlier in the plan's write order**
(DECISIONS 173 — see "must be declared earlier" below) — resolved to
that object's real, newly-assigned ID once IDs are allocated. A `ref` is
call-scoped only: it is never written to any file.

**A ref always starts with `@`; a real id never does — one shape rule,
no shadowing to reason about** (DECISIONS 172, amending the original
draft: both outside leads named the draft's "a ref shadows a real id"
rule a silent wrong-dependency trap, and it is dropped entirely in favour
of this one).

- `ref`'s own value must start with `@` (`"ref": "@t1-impl"`) — given
  without one, `invalid_value`.
- A `depends_on` entry starting with `@` is looked up **only** among this
  plan's declared `ref`s — `not_found` if none matches, the same code an
  unresolvable real id already gets.
- A `depends_on` entry **not** starting with `@` is looked up **only**
  among the backlog's real, existing ids — exactly as today, `not_found`
  if unresolvable. It is never checked against this plan's `ref`s, and
  never needs to be: real ids are never `@`-shaped to begin with.
- A `depends_on` entry (or a `ref` value) whose text, after stripping one
  leading `@`, matches the real-id shape (`EPIC-NNN`/`TSK-NNN`/`SUB-NNN`)
  is `invalid_value` regardless of whether that id exists — a decorated
  real id is always a mistake, never a legitimate ref name, so this is a
  pure shape check, not a collision check against the backlog's actual
  contents (which is exactly what made the draft's shadowing rule a
  trap: it depended on what else existed).
- Two objects in the same plan declaring the same `ref` string is
  `invalid_value` (ambiguous).
- **A `depends_on` entry `@x` must refer to a `ref` declared EARLIER in
  the plan's depth-first pre-order — the same order writes and id
  assignment already follow, below** (DECISIONS 173, found live: a
  plan whose "Review" node named `depends_on: ["@impl"]` while `@impl`
  was declared *later* passed validation, wrote everything, and stored
  `depends_on: ["undefined"]` — a silent wrong dependency, exactly what
  the `@`-prefix rule above was supposed to rule out). A **forward**
  reference — `@x` naming a `ref` that exists in the plan but is
  declared at or after the referencing object's own position — is
  `invalid_value`, `failed_at` naming the **referencing** object, with a
  hint that says to move the referenced object earlier in the plan. A
  **self-reference** (an object's own `ref`, in its own `depends_on`) is
  the same case stated at its boundary: "declared earlier" never
  includes "declared here", so it needs no separate rule, only a named
  example of this one. This is why a `ref` cannot be resolved purely by
  existing somewhere in the plan, the way the earlier draft had it: an
  id is allocated at write time, in write order (below), so a `ref` only
  ever *has* a real id to resolve to once its own object has already
  been written — reserving ids for the whole plan up front, so a forward
  reference could resolve too, was considered and rejected as needless
  complexity for what "validated before the first write" already rules
  out more simply by just being strict about order.

**The whole plan is validated before the first write.** One pass checks
every object — real fields against the command's own rules, `children`
against the hierarchy, every `depends_on` against the union of "exists in
the backlog already" and "is some object's declared `ref`, earlier in
write order, in this same plan" — exactly the same "resolved and
validated before anything is written" discipline `--id=A,B,C` batches
already have (§ 9 "Batch writes"),
extended from "one shared field map, many known IDs" to "many different
objects, most not allocated an ID yet." Nothing this pass can determine
from the already-loaded backlog is deferred to write time; a write can
still fail for a reason no preflight could know in advance (a concurrent
write landing the same instant, an exhausted ID-allocation retry, a
filesystem error) — see "Failure mid-plan" below for exactly that case.

**Write order is depth-first, pre-order — array order at every level,
parent before its own `children`.** For an array input, that is simply
each top-level object in the order given, each one's own `children`
(recursively) immediately following it before the next top-level object.
A single object with no `children` is the trivial one-element case of the
same order. **ID assignment follows the same order**: each object's ID is
allocated at the moment it is written (the same tombstone-claiming
mechanism a single `nj new` already uses, never reserved in advance), so
"ID order" and "write order" are one and the same fact stated twice, not
two separate rules to keep in sync.

**Failure mid-plan: the call stops, nothing already written is undone, and
the result names what *was* created.** A plan's objects are not
independent the way a `--id=A,B,C` batch's named IDs are — a later object
may be a `children` entry of an earlier one, or `depends_on` an earlier
one's `ref` — so a failure partway through cannot simply skip the one
object and continue (DECISIONS 136b's "a batch member's bad luck never
stops the others" does not apply here: the remaining objects' own
validity may depend on the one that just failed). The failed object's own
write never happened; every object before it in write order already did,
and stays written — there is no transaction across a whole plan, the same
"no rollback" property every other multi-file nj operation already has.
The JSON failure result is § 9's ordinary single-write failure shape,
`{ok: false, error: "<code>", hint: "…"}`, **plus** two additive fields
(DECISIONS 172): `created` — the IDs actually written, in write order —
whenever at least one object was written before the failure, and `refs` —
the `ref` names resolved so far, mapped to their real ids, the same shape
"Success", below, always carries:

```json
{ "ok": false, "error": "io_error", "hint": "…",
  "created": ["EPIC-001", "TSK-001", "SUB-001"],
  "refs": { "@t1-impl": "SUB-001" } }
```

`created`/`refs` are both **absent** (not empty) when the plan failed
*validation* and nothing was attempted at all — a caller checking only
`ok`/`error` sees nothing new; a caller that also wants "how far did it
get" reads them when present. Both are additive onto the existing failure
shape, not a new one.

**`refs` lists exactly the written elements that declared a ref — never
the failing element's own, even when it declared one** (DECISIONS 174,
the same class of silent-wrong-answer bug D173 fixed: a `ref` in `refs`
pointing at an id nothing was ever written to is exactly as misleading as
a forward reference silently resolving to `undefined`). The example
above is written exactly this way on purpose: `SUB-001` is both in
`created` and the one `refs` entry, because `@t1-impl`'s own object is
what succeeded; had `SUB-001`'s write itself been the failure, `refs`
would be `{}` and `failed_at` would name `@t1-impl` instead — `refs` and
`created` agree on which elements exist, always, the one declaring a ref
included in `refs` if and only if its own id is also in `created`.

**`failed_at` — which object the failure was about** (DECISIONS 172),
on **both** a mid-plan write failure and a validation failure (the one
case above where `created`/`refs` are absent — `failed_at` is not: a
validation failure still names what it was validating). Its value is
that object's own `ref`, if it declared one, else its position in the
plan as a JSON path from the root — `[0]` for the first top-level object,
`[0].children[1]` for the second child of the first top-level object, and
so on, matching the plan's own literal array/`children` structure. **The
top level is always addressed as a 0-indexed array for this purpose**,
`[0]` being the (and only) top-level object even when the input was a
single JSON object rather than literally wrapped in `[...]` — the single
case is simply the one-element trivial case of the same numbering, the
same way it already is for write order and ID order, above:

```json
{ "ok": false, "error": "invalid_target", "hint": "…",
  "failed_at": "[0].children[1]" }
```

```json
{ "ok": false, "error": "io_error", "hint": "…",
  "created": ["EPIC-001", "TSK-001"], "refs": {},
  "failed_at": "@t1-impl" }
```

**This is a deliberate, `--input`-scoped exception to the rule every
other failure shape in this spec follows** — `{ok: false, error, hint}`
and nothing else, stated explicitly and repeatedly throughout § 9. A
plan can be large and deeply nested; naming the one object at fault,
rather than leaving a caller to infer it from `error`/`hint` prose alone,
is worth breaking that otherwise-universal rule for, and both outside
leads asked for it independently. No other command's failure shape
gains any field from this.

**A crash is not a failure this mechanism can report on** (DECISIONS
174, found adversarially by the Verifier: an `NJ_FAULT` hook mid-plan
exits via the same `hardExit` a single `new` already uses, which prints
`{ok: false, error: "fault:<hook>"}` and calls `process.exit` directly —
there is no JS exception to catch, and so no `created`/`refs`/`failed_at`
to attach, the same as a real process or machine crash at that instant.
`failed_at`'s promise is about a write failure the process survives to
report on; a crash is answered the way every other crash in this spec
already is, by reading the backlog afterward — `nj doctor`/`nj list`
show exactly what was written, the same as after a crash mid-archive or
mid-cascade (§ 12).

**Success — two shapes, depending on whether more than one object could
ever result.** A **single object, no `children`** (the common, one-element
case — including a `set --input=` call, which is always single-object)
keeps today's exact single-write success shape: `{ok: true, id, changed,
entry, _problems}`, unchanged. An **array, or an object with `children`**
— anything that could create more than one element — uses a plural shape,
all IDs created by the whole plan, in write order:

```json
{ "ok": true, "ids": ["EPIC-001", "TSK-001", "SUB-001", "SUB-002"],
  "entries": [ { "...": "..." }, { "...": "..." }, { "...": "..." }, { "...": "..." } ],
  "refs": { "@t1-impl": "SUB-001" },
  "_problems": [] }
```

**`refs`** (DECISIONS 172) maps every `ref` declared anywhere in the plan
to the real id it resolved to — present, possibly `{}`, in the plural
shape only; the singular, single-object shape never carries it, since a
`ref` on a solitary object (nothing else in the same call to reference
it) has no plan-scoped meaning and the singular shape is otherwise
unchanged on purpose. `entries[i]` is exactly that object's own single-write entry shape
(including its **own** `_problems`); the top-level `_problems` is always
`[]`, present only for structural parity with the single-object shape and
every other JSON result in this spec — the same reason `rm --cascade`'s
own top-level `_problems` is always `[]` too (§ 9's JSON-shapes table).
There is no top-level `changed`: unlike `rm --cascade` (one action,
`"deleted"`, identical for every victim), each created object has its
**own** `changed` set (which fields it was given), and those genuinely
differ object to object — a single fixed value here would claim a
uniformity that is not real.

**A realistic plan**, an epic with two tasks, each with an implementation
subtask and a review subtask assigned to a reviewer, the review
`depends_on` its own implementation subtask via `ref`:

```json
{
  "type": "epic", "title": "Login",
  "description": "Users can sign in.",
  "children": [
    {
      "type": "task", "title": "Login route",
      "description": "POST /login returns a session.",
      "acceptance": "- [ ] 200 with a valid password\n- [ ] 401 otherwise",
      "children": [
        { "type": "subtask", "ref": "@t1-impl", "title": "Implement POST /login",
          "description": "Wire the route to the session store.",
          "acceptance": "- [ ] Route registered\n- [ ] Session cookie set on success" },
        { "type": "subtask", "title": "Review: POST /login", "assignee": "bob",
          "depends_on": ["@t1-impl"],
          "description": "Review the implementation above.",
          "acceptance": "- [ ] Code reviewed\n- [ ] Tests reviewed" }
      ]
    },
    {
      "type": "task", "title": "Logout route",
      "description": "POST /logout clears the session.",
      "acceptance": "- [ ] 200 and the session cookie is cleared",
      "children": [
        { "type": "subtask", "ref": "@t2-impl", "title": "Implement POST /logout",
          "description": "Clear the session store entry and the cookie.",
          "acceptance": "- [ ] Route registered\n- [ ] Cookie cleared" },
        { "type": "subtask", "title": "Review: POST /logout", "assignee": "bob",
          "depends_on": ["@t2-impl"],
          "description": "Review the implementation above.",
          "acceptance": "- [ ] Code reviewed\n- [ ] Tests reviewed" }
      ]
    }
  ]
}
```

`nj new --input=plan.json --json` (a single object with `children`, so the
plural shape applies) — IDs in write order (epic, then each task
immediately followed by its own two subtasks):

```json
{
  "ok": true,
  "ids": ["EPIC-001", "TSK-001", "SUB-001", "SUB-002", "TSK-002", "SUB-003", "SUB-004"],
  "entries": [
    { "id": "EPIC-001", "type": "epic", "title": "Login", "status": "todo",
      "priority": "normal", "tags": [], "depends_on": [],
      "created": "2026-10-07T19:00:00Z", "updated": "2026-10-07T19:00:00Z",
      "file": "…/backlog/epics/EPIC-001.md", "_problems": [], "_claim": null },
    { "id": "TSK-001", "type": "task", "parent": "EPIC-001", "title": "Login route",
      "status": "todo", "priority": "normal", "tags": [], "depends_on": [],
      "created": "2026-10-07T19:00:00Z", "updated": "2026-10-07T19:00:00Z",
      "file": "…/backlog/tasks/TSK-001.md", "_problems": [], "_claim": null },
    { "id": "SUB-001", "type": "subtask", "parent": "TSK-001",
      "title": "Implement POST /login", "status": "todo", "priority": "normal",
      "tags": [], "depends_on": [], "created": "2026-10-07T19:00:00Z",
      "updated": "2026-10-07T19:00:00Z", "file": "…/backlog/subtasks/SUB-001.md",
      "_problems": [], "_claim": null },
    { "id": "SUB-002", "type": "subtask", "parent": "TSK-001",
      "title": "Review: POST /login", "status": "todo", "priority": "normal",
      "assignee": "bob", "tags": [], "depends_on": ["SUB-001"],
      "created": "2026-10-07T19:00:00Z", "updated": "2026-10-07T19:00:00Z",
      "file": "…/backlog/subtasks/SUB-002.md", "_problems": [], "_claim": null },
    { "id": "TSK-002", "type": "task", "parent": "EPIC-001", "title": "Logout route",
      "status": "todo", "priority": "normal", "tags": [], "depends_on": [],
      "created": "2026-10-07T19:00:00Z", "updated": "2026-10-07T19:00:00Z",
      "file": "…/backlog/tasks/TSK-002.md", "_problems": [], "_claim": null },
    { "id": "SUB-003", "type": "subtask", "parent": "TSK-002",
      "title": "Implement POST /logout", "status": "todo", "priority": "normal",
      "tags": [], "depends_on": [], "created": "2026-10-07T19:00:00Z",
      "updated": "2026-10-07T19:00:00Z", "file": "…/backlog/subtasks/SUB-003.md",
      "_problems": [], "_claim": null },
    { "id": "SUB-004", "type": "subtask", "parent": "TSK-002",
      "title": "Review: POST /logout", "status": "todo", "priority": "normal",
      "assignee": "bob", "tags": [], "depends_on": ["SUB-003"],
      "created": "2026-10-07T19:00:00Z", "updated": "2026-10-07T19:00:00Z",
      "file": "…/backlog/subtasks/SUB-004.md", "_problems": [], "_claim": null }
  ],
  "refs": { "@t1-impl": "SUB-001", "@t2-impl": "SUB-003" },
  "_problems": []
}
```

(`SUB-002`'s `depends_on` resolved from `["@t1-impl"]` in the input to
`["SUB-001"]` in the result — the `ref` is call-scoped and never appears
in the written file or this output; only the real ID does, and the
`refs` map is the one place both the `@`-name and the real id appear
together. Every `_problems` is empty here since every object was given
both required
sections in full — a plan that omitted one would show `incomplete:*`
per entry exactly as a single `new` would.)

**`acceptance` may be a JSON array of strings, in either command**
(DECISIONS 172, team-b-tests TSK-011's own motivation): each string
becomes one `- [ ] …` checkbox line, in array order —
`["200 with a valid password", "401 otherwise"]` writes exactly the two
lines the hand-written `"- [ ] 200 with a valid password\n- [ ] 401
otherwise"` already would. A plain string is unchanged: written as-is,
no checkbox syntax invented for it. This is why the array form exists at
all: a checkbox is the one thing `acceptance:no_checkbox` (§ 7, DECISIONS
163 E) checks for, so content supplied this way can never accidentally
trigger it — each array element is a checkbox line by construction, not
by the caller remembering `- [ ] ` syntax. An **empty array** (`[]`)
writes an empty section — the same end state `--acceptance=` (empty
string) already has today, so a task/subtask given `"acceptance": []`
still shows `incomplete:acceptance` exactly as an empty string would;
there is nothing special about reaching emptiness through an empty
array rather than an empty string. `description` has no array form:
there is no "one checkbox per array element" reading for it, and
neither outside team asked for one.

**`--dry-run` for `new --input=`** (DECISIONS 172, asked for by both
outside leads independently): runs the **full** validation pass — every
rule above, including every `ref`/`depends_on`/hierarchy check — and
writes **nothing**: no file, no tombstone, no ID ever allocated. On
success:

```json
{ "ok": true, "dry_run": true,
  "entries": [
    { "type": "epic", "title": "Login", "tags": [], "depends_on": [], "_problems": ["incomplete:description"] },
    { "type": "task", "parent": "[0]", "title": "Login route", "tags": [], "depends_on": [], "_problems": [] }
  ] }
```

Each `entries[i]` carries exactly the fields that object was given (the
same "defaults never materialised" discipline § 6 already has for a real
write) plus its **resolved** `parent` — a `children` entry's implied
parent is shown as the **JSON path** of the parent object in the plan
(`"[0]"` above: the first top-level object), since there is no real id
yet for it to name — and its own `_problems`, computed from the given
fields alone exactly as a real write's entry would carry them
(`incomplete:description`/`incomplete:acceptance`/
`acceptance:no_checkbox`, as applicable), so a dry run answers "would
this be complete" as well as "would this be valid". **What a dry run
never carries, because none of it exists yet:** `id`, `file`, `created`,
`updated`, `_claim`, `ids`, `refs` — a `ref` stays exactly the `@`-name
it was given in `depends_on`, never resolved to anything, since nothing
was assigned an id to resolve it to. A dry run that fails validation
uses the ordinary failure shape (`{ok: false, error, hint, failed_at}`,
above) exactly as a real attempt would — only a **successful**
validation looks different (`dry_run: true`, no write).

`--dry-run` requires `--input`: given to `new` without it (field flags
only, or no flags at all), it is `invalid_value` — there is no
"validate only" reading for a plain `--title=…`/`--type=…` call, since
nothing about that call is deferred or batched the way a plan's
validate-then-write split is; `--dry-run` only has meaning as a question
about a plan that has not run yet. `set` does not accept `--dry-run` at
all (`unknown_field`) — `set` has no plan form (above) for a dry run to
preview.

### `--ready`

An element is ready when **all** hold:

1. `status` equals `statuses[0]` (the configured initial state),
2. every `depends_on` target is `done` and carries no `done:open_children` —
   a target in the archive counts as satisfied (`active_refs_archived`,
   informational),
3. no problem code that blocks `--ready` (table in § 7),
4. the element is complete per § 7,
5. the element is unclaimed, or claimed by the acting name (§ 12 "Claims").

Ancestor status does not affect `--ready` — only explicit `depends_on` edges
do; broken references are caught by the code table instead. So
`NJ_AUTHOR=agent-7 nj list --ready` shows what agent-7 may take or already
holds, and never an element another acting name has claimed; a backlog
without claims answers exactly as before condition 5 existed.

**Bare `nj`'s own "Ready to work" section additionally excludes a
container** (DECISIONS 158, EV-4): an element that is `--ready` by the
five conditions above but has at least one **open child** (neither `done`
nor archived) is left out of bare `nj`'s list, the same leaf-work rule
`next` applies to its own candidates (§ 12b, DECISIONS 156) — reused here,
not reimplemented. `list --ready` itself is **unchanged**: it stays a pure
readiness filter over exactly the five conditions, container or not, so
`nj list --ready` and bare `nj`'s "Ready to work" can now name different
sets for the same backlog on purpose — bare `nj` is answering "what could
I hand out right now", `list --ready` is answering "what satisfies
`--ready`'s own definition". This is a new, accepted replay class: a
bare-status call on a backlog containing a container whose children are
all non-leaf-ready differs from a pre-v3.6 baseline by construction, the
same deliberate, named exception the replay gate already carries for
help-text differences (DECISIONS 151/152/154/155/156).

```
$ nj list --ready
Ready to work:
  TSK-007  Login route

Complete first:
  TSK-009  Registration      incomplete:acceptance
```

`list --ready` combines with the other filters (`--tag`, `--assignee`, …).
`--all` includes archived elements; otherwise they are hidden from `list`,
`tree` and the short status. Claims affect `--ready` only: `list` without
`--ready`, `tree`, `show` and `doctor`'s exit code are unaffected by a claim
one way or the other.

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
      "_problems": ["incomplete:acceptance"], "_claim": null }
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
`_claim` is likewise always present on every entry — derived the same way,
never stored in the element file: `{"by": "<name>", "since": "<ISO-8601>"}`
when claimed, `null` when not (§ 12 "Claims").

### JSON shapes per command

| Command | JSON shape |
|---|---|
| `list`, `show`, `find` | `{backlog, counts, entries: [{…, _problems}]}` — `find`'s shape is identical to `list`'s, no `_match` field (§ 9a); **`show` additionally carries `entry: {…, _problems}`** (DECISIONS 171 C), identical to `entries[0]`, exactly when `entries` has **exactly one** element — never when it has several (a `duplicate_id` target, `entries.length > 1`) or, hypothetically, none; `list`/`find` never carry it, since returning many entries is their own point |
| `new`, `set`, `note`, `check`, `rm` | `{ok, id, changed: […], entry: {…, _problems}, _problems}` — the top-level `_problems` mirrors `entry._problems`; `rm` additionally carries `dependents: […]` — the elements whose `depends_on` names the removed one, empty when there are none; for `nj new`/`nj set`, `changed` also names the section roles written (`description`, `acceptance`); for `nj check`, `changed` is `["body"]` or `[]` (a no-op); **`nj set` additionally carries `released?: "<holder>"`** (DECISIONS 171 B) when a write setting `status` to the last configured status released an existing claim — absent, not `null`, when there was no claim to release; **and `open_acceptance?: {unticked, total}`** (DECISIONS 176 B) when that same write leaves the element carrying `done:open_acceptance` — absent otherwise |
| `archive`, `unarchive`, `rm --cascade` | `{ok, ids: […], changed: ["archived" \| "unarchived" \| "deleted"], entries: […], _problems: […]}` — for `rm --cascade` the top-level `_problems` is `[]`: the elements are gone, so their problems are too. `archive` and `unarchive` emit the union, because the elements still exist and can still carry findings. **`rm --cascade` additionally carries `dependents: […]`**, the remaining elements whose `depends_on` names a removed one — archived elements included, since they carry `depends_on:dangling` too and the agent must know it; `archive` and `unarchive` do **not** — a `depends_on` pointing into the archive is satisfied by definition (§ 11), so there is nothing to warn about and nothing an agent must act on. |
| `claim`, `release` | `{ok, id, changed: […], entry: {…, _problems, _claim}, _problems, claim: {by, since}\|null, stolen_from?, previous_assignee?, released?}` (§ 12 "Claims") — the write-result shape plus `claim`, the element's claim state after the call; `stolen_from` names the previous holder after a `--steal`; `previous_assignee` when the claim overwrote a different `assignee`; `changed` names `assignee` and `status` when written, a `release` reports `changed: ["claim"]`; **`released?: "<holder>"`** (DECISIONS 171 B) on `claim` only, when `--status=<last>` released the very claim this same call just made — absent, not `null`, otherwise; `release` never carries it (a plain release is already reported via `claim: null`); **`open_acceptance?: {unticked, total}`** (DECISIONS 176 B) on `claim` only, same condition as `set`'s own — `release` never carries it, since `release` never writes `status` |
| `tree` | `{backlog, counts, entries: […]}` — **flat**, each entry carries `parent`; depth-first order conveys the tree |
| `doctor` | `{backlog, ok, problems: [{code, severity, element?, file?, line?, message}]}` — `severity` ∈ `error`\|`warning` (the Doctor column value; `—` codes never appear as findings); element-level findings carry `element`, backlog-level ones do not |
| bare `nj` | `{backlog, counts, ready: [entries ≤ 5], incomplete: [entries ≤ 5]}` |
| `set`, `note`, `check`, `claim`, `release` with `--id=A,B,C` (two or more IDs) | `{ok, results: [{id, ok, …}]}` — the "Batch writes" wrapper (§ 9 above): `results` names every ID once preflight passes for all of them, or only the ID(s) that failed preflight if it did not; a batch-wide argument error (`unknown_field`, a repeated ID, …) instead uses this table's generic single-write failure shape, no `results` at all; a single `--id=A` is unaffected and keeps the unwrapped success shape on this table's earlier row |

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
io_error               needs_newer_nj
invalid_env           invalid_backlog_env      unknown_field
invalid_backlog_flag  invalid_backlog_njrc     invalid_njrc
legacy_layout
unknown_command       missing_argument         missing_value
invalid_value         invalid_target           not_found
duplicate_id          exists                   changed_in_parallel
id_allocation_failed  internal_error           ambiguous_target
none_ready
refused:<reason>      reason ∈ unreadable | unreadable_dir | archived | children_open |
                               has_children | not_done | parent_archived |
                               misplaced | not_archived | claimed
fault:<hook>          hook ∈ before-compare | after-tmp-write | before-rename
```

`--json` is defined for the command set of this section. `nj help` is not one
of them, so its output is prose regardless of flags.

### Failure codes — spec-named paths (DECISIONS 163 D)

Where a passage of this specification names a failure condition, it also names
its code. These mappings are normative.

**Override flag** (DECISIONS 163 D): a flag that, added to the **same**
call, makes it succeed anyway — derived from each refusal's own code, not
recalled from memory, found by grepping every `fail('refused:…', …)` and
`compareGuard`/`guardedWrite` call site for a flag it checks before
failing. `—` means no such flag exists: the condition must actually change
(fix the config, finish the children, wait out the race) or a different
command must run first (`nj doctor --fix`) — the hint text may still point
there, but that is not the **same** call succeeding anyway, which is what
this column is reserved for. This is docs only — the `--json` shape is
unchanged; the hint already carried this information in prose, this column
just makes it a lookup instead of a re-read of the hint every time:

| Condition | Code | Stated in | Override flag |
|---|---|---|---|
| no backlog found by the location rules | `no_backlog` | § 4 | — |
| `--backlog` names a place without a backlog | `invalid_backlog_flag` | § 4 | — |
| `NJ_BACKLOG` names a place without a backlog | `invalid_backlog_env` | § 4 | — |
| a `.njrc` names a place without a backlog | `invalid_backlog_njrc` | § 4 | — |
| a reached `.njrc` violates its format | `invalid_njrc` | § 4 | — |
| backlog found but `.nanojira/config.json` is missing | `backlog_without_config` | § 4 | — |
| backlog in the v2 layout (any command except `doctor`) | `legacy_layout` | § 4 | — |
| `.nanojira/config.json` violates § 5 | `invalid_config` | § 5 | — |
| the running `nj` is older than `minVersion` | `needs_newer_nj` | § 5 "`minVersion`" | — (upgrade `nj`; nothing on the same call changes this) |
| unknown field flag | `unknown_field` | § 9 | — |
| a flag other than `--backlog`/`--json` precedes the command word | `unknown_field` | § 9 "Rules" | — |
| `--version` combined with another flag or an explicit subcommand | `unknown_field` | § 9 | — |
| unknown subcommand | `unknown_command` | § 9 | — |
| a required flag or its value is missing | `missing_argument` / `missing_value` | § 9 | — |
| a value fails validation (`--status`, `--priority`, `--type`) | `invalid_value` | § 9 | — |
| `--parent` names an element of the **wrong type** | `invalid_target` | § 9 | — |
| `--id` and `--file` given together | `invalid_target` | § 9 | — |
| `--parent` on an `epic`, which may have none | `invalid_value` | § 9 | — |
| `--parent`, `--depends-on` or `--file` names nothing | `not_found` | § 9 | — |
| `set --parent` names nothing | `not_found` | § 9, DECISIONS 177 | — |
| `set --parent` names the **wrong type** | `invalid_target` | § 9, DECISIONS 177 | — |
| `set --parent` names an archived element | `refused:parent_archived` | § 9, DECISIONS 177 | — |
| `set --parent` is given to an `epic` | `invalid_value` | § 9, DECISIONS 177 | — |
| a `--description-file` / `--acceptance-file` path cannot be read | `not_found` | § 9 | — |
| two files carry the same `id` | `duplicate_id` | § 9 | — (address one file directly with `--file=<path>` instead) |
| `init` target already exists (even an empty directory) | `exists` | § 4 | — |
| a filesystem call on a named target fails (`init` into a read-only or non-directory parent; a deleted working directory) | `io_error` | § 9 | — |
| an `archive` target path is occupied | `exists` | § 11 | — |
| `set`/`note`/`check`: the file changed between read and write | `changed_in_parallel` | § 12 | `--force` |
| an archived element is written or removed | `refused:archived` | § 9 | — |
| an unreadable stub is written, or used as `--parent` | `refused:unreadable` | § 6, § 9 | — |
| `rm`, `archive` or `set --status=done` while an unreadable directory exists anywhere in the backlog | `refused:unreadable_dir` | § 9, DECISIONS 106 F4 | — (fix the directory's permissions, then retry) |
| `done` on a parent whose children are open | `refused:children_open` | § 9 | `--allow-open-children` |
| `rm` while child elements exist | `refused:has_children` | § 9 | `--cascade` |
| `archive` with an unfinished subtree | `refused:not_done` | § 11 | — (`archive` takes no `--force`) |
| an archived element as `--parent` | `refused:parent_archived` | § 9 | — |
| `archive` under `hierarchy` on a subtree not lying in its own folder | `refused:misplaced` | § 11 | — (`nj doctor --fix`, a separate call) |
| `unarchive` on an element that is not archived | `refused:not_archived` | § 11a | — |
| `unarchive` under an archived parent | `refused:parent_archived` | § 11a | — |
| `unarchive` while an unreadable stub exists | `refused:unreadable` | § 11a, § 9 | — |
| `unarchive` of a subtree not lying in its own folder, or with an unresolvable `parent` chain (`hierarchy`) | `refused:misplaced` | § 11a | — (`nj doctor --fix`, a separate call) |
| an `unarchive` target path is occupied | `exists` | § 11a | — |
| an `NJ_FAULT` hook fires | `fault:<hook>` | § 12 | — (test-only, not a real refusal) |
| `NJ_AUTHOR` is not a valid name, on a command that uses it | `invalid_env` | § 9 | — (use `--as` instead) |
| `--as` is not a valid name | `invalid_value` | § 9 | — |
| `claim` or `release` without an acting name | `missing_argument` | § 9 | — |
| `claim` where another name holds the claim | `refused:claimed` | § 12 Claims | `--steal=<holder>` |
| `release` where another name holds the claim | `refused:claimed` | § 12 Claims | — (only the holder may release it) |
| `claim` on an archived element | `refused:archived` | § 9 | — |
| `claim` on an unreadable stub | `refused:unreadable` | § 12 Claims | — |
| the claim decision loop exhausts its 100 rounds | `changed_in_parallel` | § 12 Claims | — |
| `next` without an acting name | `missing_argument` | § 12b | — |
| `next`'s candidate list is exhausted — none `--ready`, or every candidate lost its race | `none_ready` | § 12b | — |
| `log --id` names a duplicate id, without `--file` | `duplicate_id` | § 12c | — (address one file directly with `--file=<path>` instead) |
| `log --id` names nothing | `not_found` | § 12c | — |
| `log` on an unreadable stub | `refused:unreadable` | § 12c | — |
| `check` on an archived element | `refused:archived` | § 9 | — |
| `check` on an unreadable stub | `refused:unreadable` | § 10a | — |
| `check --text`/`--item` matches no countable checkbox, or `--item` is out of range | `not_found` | § 10a | — |
| `check --text` matches two or more countable checkboxes | `ambiguous_target` | § 10a | — (narrow `--text`, or use `--item=<n>` instead) |
| `find` with the literal empty string as `<text>` | `invalid_value` | § 9a | — |
| `--id=A,B,C` together with `--file` | `invalid_target` | § 9 "Batch writes" | — |
| `--id=A,A` — the same ID named twice in a batch, after trimming | `invalid_value` | § 9 "Batch writes" | — |

Codes of the closed set that no passage above names —
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

This already answers DECISIONS 158 PA-2 ("`new`/`set` text output says
when the element is not `--ready` and why"): every open `incomplete:*`
code (and any other open problem) is already named in prose here, on
`new` exactly as on `set` — no new field, no new behaviour; `_problems`
in the JSON result already carries the same codes (§ 9 "JSON shapes per
command"). PA-2's own suggested new JSON field (`not_ready_reason`) is
deliberately not added: it would be a second name for exactly what
`_problems` already is.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success — including reads that merely *report* data problems via `_problems` |
| `1` | command failed — nothing or only partially written; hard errors (no backlog found, unknown field, refusal, retries exhausted) |
| `2` | `nj doctor` only: at least one `error` finding |

---

## 9a. `nj find`

```
nj find "<text>" [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
                  [--all] [--case-sensitive] [--json]
```

A read, like `list`, over the same already-loaded element data, with one more
predicate: a text match. No `--id`/`--file` — it searches, it does not
address one element. Combines with every `list` filter already in § 9
(`--status`, `--type`, `--tag`, `--parent`, `--assignee`) the same way they
combine with each other on `list` — AND, not OR. `--all` includes the
archive (§ 11), same meaning as everywhere else it appears.

**Fields: title, body and notes.** The body already includes `## Notes` as
one block (§ 7), so this is one read, not three. This is a *read* matching
past decisions, not a *write* touching them — § 10a's `## Notes` exclusion
is about writes, and does not apply here.

**Match kind:** plain substring — not a regex, not a word-boundary match —
consistent with `check --text` (§ 10a).

**Case-insensitive by default**, `--case-sensitive` opts into exact-case
matching. The comparison applies `String.prototype.toLowerCase()` —
JavaScript's locale-independent **lowercase mapping**, not full Unicode case
folding — to both the needle and the haystack before comparing, never
`toLocaleLowerCase()`. This is `toLowerCase()`'s actual, narrower mapping,
not a folding that would make every case-insensitive equivalent of a
character match: `"ß"` does not match `"SS"` (`toLowerCase()` leaves `ß` as
`ß`, it has no special-casing rule the way `toUpperCase()` does), and `"İ"`
(U+0130) lowercases to `"i"` followed by a combining dot above (`"i̇"`, two
code points), not to a plain `"i"` — so a plain ASCII `"i"` query does not
match a title containing `"İ"`. `toLowerCase()` is locale-independent (the
same bytes map the same way regardless of the host's configured locale),
matching this project's existing determinism discipline (`NJ_NOW` pinning,
§ 12; no hidden environment dependence); `toLocaleLowerCase()` would make a
search's results depend on an environment variable `nj` does not otherwise
read anywhere, for any other command. `<text>` given as the literal empty
string is `invalid_value`, nothing searched — the same "an explicit flag or
argument given empty is a caller's mistake" reading `--as=` (DECISIONS 119)
and `check --text=` (DECISIONS 129) already get.

**Output:** the same read shape as `list` (§ 9 JSON interface): `{backlog,
counts, entries: [{…, _problems, _claim}]}`, filtered to matching entries, in
`list`'s sort order (§ 9: priority descending, then `id` ascending) —
relevance ranking is out of scope, the same way `list --ready`'s order is
the backlog's order, not a ranked one. No `_match` field: the JSON shape is
exactly `list`'s, nothing added. A search matching nothing returns `entries:
[]`, exit 0 — a read never fails on "no results", the same as an empty `list
--status=doing`. Human output adds one line of match context per hit — the
first line of the body containing the match, truncated — the way `grep`
shows the matching line, not the whole file; this is prose, not a JSON
contract.

Reuses the existing full-scan read path (§ 13): bodies are already parsed
for completeness/title/section checks, so `nj find` adds one substring scan
over text `nj` has already loaded, not a new read.

---

## 10. `nj note`

`nj note --id=TSK-007 "Parser splits at the first colon"` appends a dated,
signed line to the body:

```markdown
## Notes
- 2026-09-21T18:02:44Z coder-agent: Parser splits at the first colon
```

**The acting name signs the note** (§ 9 "The acting name"): `--as=<name>` or
`NJ_AUTHOR=<name>` overrides who signs; `--as` outranks `NJ_AUTHOR` when both
are given. An empty `NJ_AUTHOR` counts as **unset** — the same rule as an
empty `NJ_BACKLOG` (DECISIONS 89). A name is valid when, after dropping
leading and trailing whitespace, it is non-empty, is a single line, and
contains no `:`; only spaces and tabs are trimmed, any `\n` or `\r` left
(trailing included) makes it multi-line, and Unicode spaces are literal, not
trimmed. The colon is excluded because a note line is
`- <timestamp> <author>: <text>`: a name with a colon would make the
author/text boundary unreadable for humans and for any tool that parses
notes. The trimmed value is used. The acting name is a label, not an
identity: there is no registry, no authentication, and two agents that
choose the same name are the same author — the same trust model `assignee`
has today (§ 6).

Rules:

- `## Notes` is created at the end of the body if absent (a sanctioned
  exception to the byte-for-byte rule, alongside the H1). It is separated
  from the preceding body by exactly one blank line; if the body already ends
  in a blank line, none is added.
- Line format: `- <ISO-8601 UTC> <author>: <text>`. `<author>` is the acting
  name (`--as`, else `NJ_AUTHOR`; § 9), trimmed, if set and valid; else the
  element's `assignee` if set; else `?`. Consecutive notes are consecutive
  lines directly below the heading — no blank line between **two different**
  notes (a blank line *within* one note's own text is a different thing,
  below).
- An invalid acting name makes `nj note` exit 1 — `invalid_env` for
  `NJ_AUTHOR`, `invalid_value` for `--as` — and writes nothing. Other writes
  (`new`, `set`, …) do not use the acting name and ignore it; reads never
  fail on it. Precedence: argument parsing (`unknown_field`,
  `missing_argument`, `missing_value`, and `invalid_target` for `--id` and
  `--file` given together — both given ranks with argument parsing, like
  neither given) is checked first, then the acting name (`invalid_env` for
  `NJ_AUTHOR`, `invalid_value` for `--as`), then target resolution
  (`not_found`, `duplicate_id`), then refusals (e.g. `refused:archived`).
  The wrong-type-`--parent` reading of `invalid_target` does not apply here:
  `nj note` takes no `--parent`.
- The acting name changes only the note line. It never sets or changes
  `assignee`.
- A note **does not** satisfy the `## Description` requirement. Its write
  result reports `changed: ["body"]`.
- `updated` is refreshed; the atomic write and compare-before-write rules
  (§ 12) apply.

### Multi-line text (DECISIONS 158, EV-7)

A note's text is **not** flattened to one line. `\r\n` and a lone `\r` in
the given text are normalised to `\n` first (the same normalisation every
other write path in this document already applies, § 7); the overall text
is then trimmed, exactly as today (no leading/trailing blank lines). What
remains is split on `\n`:

- The **first** line becomes `<text>` on the `- <ISO-8601 UTC> <author>:
  <text>` line itself, exactly as a single-line note always has.
- **Every following line** — blank or not — is written on its own line,
  immediately below, indented by exactly **two spaces** (the width of the
  `- ` marker): a genuine Markdown list continuation, so the whole note
  renders as one list item in any viewer, not a separate paragraph or a
  new list item. A blank line in the middle of the text is still written
  indented (two spaces, nothing else) rather than truly empty — the
  deliberate exception to this project's usual "no trailing whitespace"
  rule, because it is exactly what tells the reader (and `nj log`,
  below) that the blank line belongs to *this* note's continuation and
  is not the blank line that would otherwise mark the end of `## Notes`.
  No other line hygiene is applied: a continuation line's own content is
  written as given (after the `\r`/`\r\n` normalisation above), not
  re-trimmed.

```markdown
## Notes
- 2026-10-06T18:00:00Z tracker: Line one
  Line two
  
  Line four, after a blank line
```

**Reading it back** (`parseNotes`, used by `nj find` and `nj log`): after a
line matching `- <ISO-8601> <author>: <text>`, every immediately following
line that is **either** completely empty **or** starts with exactly two
spaces is a continuation of that same note, consumed until a line that is
neither (a fresh, unindented note line; a heading; anything else) ends it.
Continuation lines are rejoined with `\n`, in order, the two-space prefix
stripped where present (a genuinely empty line stays empty) — reconstructing
the exact text that was written. Because a continuation line is always
either indented or empty, it can **never** be read as a fresh note (which
must start at column 0 with `- `) or as a checkbox (`nj check`'s own scope
already excludes `## Notes` entirely, § 10a, independent of indentation) —
a continuation line that happens to read `- [ ] like a checkbox` is just
more of the previous note's text, indented, nothing else. A line that is
hand-added directly below a note and is neither empty nor two-space-indented
is read as ending that note's continuation, the same "trust the shape,
don't guess" rule a line that matches neither pattern anywhere else in
`## Notes` already gets (v3.5, DECISIONS 155) — so a stray hand edit there
is silently excluded from the note it was meant to extend, not merged into
it and not an error.

**No new size limit.** A note's text, single-line or multi-line, has no
length or line-count cap — the same as `--description`/`--description-file`
already have none.

**Unaffected by this:** `--as`/`NJ_AUTHOR` validation (§ 9 "The acting
name") — a multi-line acting name is still `invalid_value`/`invalid_env`,
unrelated to the note *text*'s own newlines. `nj find`'s substring match
(§ 9a) already treats the whole body, notes included, as one block of text;
a continuation line's two-space indent is just more of that text, nothing
special-cased. `nj doctor` does not parse note structure at all and is
unaffected.

Notes are how decisions, findings and verification reports get captured in
the backlog — the body is the project memory, `nj note` is its sanctioned
writer.

---

## 10a. `nj check`

`nj check` flips one Markdown checkbox in the body — the dedicated, guarded
writer for exactly this one edit, so ticking a box no longer means a hand
edit or a full `--acceptance=<text>` rewrite of a section to change one line.

```
nj check --id=TSK-009 --text=<substring> [--on | --off] [--force] [--json]
nj check --id=TSK-009 --item=<n>         [--on | --off] [--force] [--json]
```

(`--file=<path>` instead of `--id`, and `--backlog`, as for every write.)

**`--on`/`--off` are both optional, never both given.** With neither, the
command **ticks** — `--on` is the default, since ticking is the command's
name and its common case. `--on` together with `--off` is `invalid_value`,
nothing written — the same contradictory-flags treatment `--text` with
`--item` gets (below).

**What counts as a checkbox.** After optional leading whitespace
(indentation — nested list items count the same as top-level ones), a line
is a checkbox when it starts with one of the list markers `-`, `*`, `+`, or
an ordered marker `<digits>.` or `<digits>)` (e.g. `1.`, `1)`), followed by
one space and `[ ]`, `[x]` or `[X]`. **Reading:** `[x]` and `[X]` both count
as **ticked**; only `[ ]` counts as **unticked**. **Writing:** `--on`
always writes `[x]` (lowercase); `--off` always writes `[ ]` — regardless
of which of `[x]`/`[X]` was read, a write never produces `[X]`.

**Scope.** Every section is scanned except `## Notes` (§ 10: an
append-only audit trail of past decisions — re-ticking history there would
read as editing the record, not doing the work). `nj check` tracks fence
state (` ``` ` and `~~~`, either of length 3 or more, matched at the start
of a line after optional leading whitespace, closed only by a matching or
longer fence of the same character) line by line and never counts or
matches a checkbox-shaped line while inside one. **This is the one place in
the spec where fence-awareness exists** (§ 7: section matching is
otherwise, and remains, line-based and not fenced-code-aware).

**Addressing.** Exactly one of `--text`/`--item` is required — neither
given is `missing_argument`, both given is `invalid_value`.

- `--text=<substring>` — the **countable** checkbox (in scope, per above)
  whose line, with the list marker and the `[ ]`/`[x]`/`[X]` box stripped,
  contains `<substring>` (a plain substring match, not a regex). **The
  literally empty string is `invalid_value`, nothing written** — it matches
  every checkbox, so with exactly one in scope it would silently tick the
  wrong thing for the wrong reason (an unexpanded variable), the same
  "an explicit flag given with nothing in it is a caller's mistake" reading
  `--as=` already gets (§ 9). **No trimming:** a whitespace-only `--text` is
  not empty and stays a plain substring, matched as given.
- `--item=<n>` — the *n*-th countable checkbox, 1-based, in document order
  (top to bottom, depth-first through nested lists).

`--text` matching no countable checkbox, or `--item` out of range (< 1 or
> the count), is `not_found` — the same code `--parent`/`--depends-on`/
`--file` already reuse for "names nothing" (§ 9). `--text` matching two or
more countable checkboxes is `ambiguous_target` (§ 9) — ambiguity is
reported, never guessed at (§ 14). `--item` can never be ambiguous: an
index names at most one line.

Rules:

- Refused before anything is written: an archived element
  (`refused:archived`); `--id`/`--file` together (`invalid_target`, § 9); X
  itself an unreadable stub (`refused:unreadable`, this element only — a
  check reserves and edits one element and moves nothing, so § 9's
  backlog-wide stub guard for `rm`/`archive` does not apply).
- A no-op is not refused: `--on` on an already-ticked box, or `--off` on an
  already-empty one, exits 0 and writes nothing (`changed: []`).
- The write flips exactly the bracket content (per "What counts as a
  checkbox", above) and nothing else on the line — not the line's leading
  whitespace or list marker, not trailing content after the `]`. `updated`
  is refreshed; the atomic write and compare-before-write rules (§ 12)
  apply, with `--force` available as for `set`/`note`.
- Ticking or unticking does not itself satisfy or un-satisfy completeness
  (§ 7): checkbox state and section completeness are independent.
- `changed: ["body"]` on a write, `[]` on a no-op — the same marker `nj
  note` uses, since a checkbox flip is a body edit, not a section-role
  write.

**Output.** `{ok, id, changed: ["body"] | [], entry: {…, _problems},
_problems}` — the § 9 write-result shape, nothing new.

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
  When the target folder already exists — left by an earlier archive of a
  descendant — it is merged into, recursively: one `rename` per entry,
  descending wherever an entry's target is itself an existing folder;
  emptied source folders are removed with `rmdir`. A target is occupied
  only where a **file** already exists at a file's target path, or a file
  meets a folder; then `exists`, and nothing moves (DECISIONS 90, 94).
  `doctor --fix` step 3 plans its moves the same way.

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
- Un-archiving is `nj unarchive` (§ 11a).

git remains the fine-grained history; the archive is the coarse shelf for
finished work, keeping the working set small.

---

## 11a. `nj unarchive`

`nj unarchive --id=EPIC-001` (or `--file=<path>`, § 9) moves the archived
element and its **archived subtree** — every descendant of it that lies below
the archive folder — back to their active places. It is in every respect the
inverse of `nj archive`. No `--force` (§ 12: `--force` has one meaning, and
bulk moves do not take it).

- **Gathering:** the subtree is found from the archive by the element's
  `id`/`parent` chain, wherever its files lie there — not assumed to mirror
  the archive's folder shape.
- **Placement** follows the configured layout (§ 4) at the time of the
  command, not the layout at archive time; the archive's shape only decides
  whether one folder `rename` is possible:
  - groups `type` and `flat`: each file moves to its active place — the
    folder of its type (`type`), or the backlog's top level (`flat`);
  - group `hierarchy`: when the archived folder already mirrors the target
    shape, the subtree's folder moves back as a whole, one `rename`, to the
    same relative place outside the archive folder (`archive/EPIC-001/
    TSK-003/` → `EPIC-001/TSK-003/`); otherwise files move one by one. Where
    the target folder already exists — the parent's folder, always present
    because the parent is active — it is merged into by the rules of § 11
    (DECISIONS 90, 94): one `rename` per entry, descending into existing
    folders, emptied source folders removed with `rmdir`, never a recursive
    delete.
  - Ancestor folders left empty in the archive by the move are removed with
    `rmdir` (names of ID shape only, as `doctor --fix` step 3 does).
- A descendant of the element that already lies outside the archive
  (`archive:split`) is **not a refusal in any group**: it is left untouched,
  since it already sits at its active place. Unarchiving the parent heals the
  split; under `hierarchy` the parent's folder merges into the existing
  active one, by the same rule as above (DECISIONS 90, 94).
- **Frontmatter:** the `archived` key is removed from every moved element and
  `updated` is refreshed. Nothing else changes — `status` stays what it was
  (`done`, by § 11's precondition). Reopening is a separate, explicit
  `nj set --status=…`.
- **Order and atomicity**, as `archive` (DECISIONS 91 B16): every file's
  frontmatter is rewritten in place first, through the guarded write of § 12
  (compare before write, no `--force`; `NJ_FAULT=before-compare` fires once
  per file write, in top-down order), then the moves happen. A crash between
  the two leaves files below the archive folder without `archived:` —
  archived by location (§ 4, DECISIONS 92 Q2), no finding; a second
  `nj unarchive` completes it. `NJ_FAULT=before-rename` fires before the
  first `rename`.
- **All move targets are verified before the first write.** A target is
  occupied only where a file already exists at a file's target path, or a
  file meets a folder (§ 11's rule); then `exists`, and nothing is written or
  moved.

**Refusals** — checked in this order, each refuses and writes nothing:

1. Any `file:unreadable` stub exists anywhere in the backlog:
   `refused:unreadable` — § 9's rule for `rm` and `archive`, for the same
   reason (the subtree cannot be determined), evaluated before the target is
   resolved.
2. The named element is not archived (it lies outside the archive folder):
   `refused:not_archived`.
3. The element has a `parent` that is itself archived: `refused:parent_archived`.
   The result would be an active child under an archived parent —
   `archive:split`. Unarchive the parent instead; its archived subtree comes
   with it.
4. **Under `hierarchy` only** — placement under `type`/`flat` does not depend
   on the `parent` chain: the element or a still-archived member of its
   subtree does not lie in the element's archived folder, or a foreign
   element file does (moving the folder would carry it along), or the
   element's `parent` chain does not resolve (`parent:dangling`, `parent:cycle`,
   or an ancestor with either — the active place cannot be computed,
   DECISIONS 91 B15): `refused:misplaced`, pointing at `nj doctor --fix`.
5. A move target is occupied (above): `exists`.

Descendants of the element that are *not* archived are untouched; they
already lie at their active places.

**Claims (§ 12 "Claims").** Once every refusal above has cleared — the
element is confirmed archived, among other things — and before the first
move, `nj unarchive` removes the element's claim directory wholesale, the
same removal `archive`/`rm` use: normally none exists, since `archive`
already removed it; this only ever fires on a `claim:orphaned` straggler a
partially-cleaned archive left behind. A straggler's own in-flight claim
`link()`, racing this removal, may still land: the directory is then left
non-empty, exactly as `archive`'s own cleanup already tolerates
(`claim:orphaned` if unclaimed-looking, `claim:mismatch` if its mirror write
also raced the version bump `archive`/`unarchive` themselves make) —
`doctor` reports it, never auto-resolves it, same as always. So the
unarchived element starts unclaimed unless a straggler's append raced the
removal, the same residual case `archive`'s own cleanup already discloses.

**Output.** Same shape as `archive` (§ 9 table): `{ok, ids: […], changed:
["unarchived"], entries: […], _problems: […]}` — `ids` top-down in pre-order
(depth-first, as `tree` prints: EPIC-001, TSK-001, SUB-001, TSK-002), siblings
by `id` ascending; `entries` the moved elements in their new state. Human
output mirrors `archive`'s. `STATUS.md` is regenerated (§ 4).

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

**Compare before writing.** On `nj set`, `nj note`, `nj check`, `nj archive`
and `nj unarchive`: read the file, remember the content, re-read immediately
before writing and compare **byte for byte**. A difference aborts with
"changed in parallel, please run again". The comparison runs over the full
content, not over `updated` — second-level timestamps would be too coarse for
two writes within the same second. `archive` and `unarchive` route their
comparison through the same guarded path as the other two, so
`NJ_FAULT=before-compare` covers them.

`--force` overrides a parallel change on **`set`, `note` and `check`
only**. **`archive` and `unarchive` have no override**, and that is
deliberate: § 11's and § 11a's "no `--force`" governs, a bulk move must
never silently overwrite a parallel edit, and `--force` must not acquire a
second meaning — the same reason the parent rule got its own flag
(`--allow-open-children`). A parallel change during `archive` or
`unarchive` aborts the run; the caller retries once the backlog is stable.

**Batch writes (`--id=A,B,C`, § 9 "Batch writes") introduce no new
mechanism.** Each ID in a batch goes through exactly the same
compare-before-write (above) or `nj claim`'s read-decide-`link()` loop
(§ 12a) a single invocation would; atomicity is still per-ID, never across
the batch — a batch is N uses of the existing mechanism, reported together.

**Fault injection (verification hook, not a feature).** `NJ_FAULT` accepts three
distinct injection points, each exiting with code 1 and leaving the target
file untouched:

- `after-tmp-write` — abort immediately after the temp file has been written,
  before `fsync`
- `before-rename` — abort after `fsync`, immediately before `rename`
- `before-compare` — after the first read and before the compare re-read,
  poll for `<backlog>/.nj-fault-go` (timeout 10 s, then exit 1). The test
  changes the target file, then creates the marker: expect exit 1 with
  "changed in parallel", or exit 0 with `--force` where the command takes it
  (`set`, `note`, `check` — not `archive` or `unarchive`)

It exists so that criterion AC-9 is testable. The abandoned temp file is
reported by `nj doctor` (`backlog:stray_tmp`) and removed by `doctor --fix`.
A single command is unchanged by batch writes existing. **Within a batch
(`--id=A,B,C`, § 9 "Batch writes"), `NJ_FAULT` fires once**: at the first
write, in execution order, that reaches the injection point. That ID fails
with `fault:<hook>` and its file is left untouched, exactly as a single
command's would; the hook is then spent, and every later ID in the batch
writes normally.

**Clock pinning (verification hook, not a feature).** `NJ_NOW=<ISO-8601 UTC>`
fixes the clock: if set, every timestamp the tool writes (`created`,
`updated`, `archived`, `nj note` lines) uses exactly this value; an invalid
value exits 1. It exists so that AC-2's byte-exact golden comparison needs no
normalisation — normalising timestamps in the verifier would silently hide
serializer defects (wrong format, missing `Z`).

**Claims.** The exclusivity mechanism behind `nj claim`/`nj release`
(§ 12a). **The claim of an element is an append-only sequence of immutable
entries**, one directory per element:

```
<backlog>/.nanojira/claims/<ID>/1
<backlog>/.nanojira/claims/<ID>/2
…
```

Each entry is a file named by its **generation**, a positive decimal
integer, with exactly this content:

```
claimed\n<name>\n<ISO-8601 UTC>\n          (or)          released\n<name>\n<ISO-8601 UTC>\n
```

— the transition, the acting name that made it (§ 9), and its time
(`NJ_NOW` applies, above). **The claim state is the entry with the highest
generation**: `claimed <N>` means N holds the claim; `released`, no entry, or
no directory means the element is unclaimed.

**Every change of claim state is one compare-and-swap:** a process that has
read the state at generation *g* writes the new entry completely into a temp
file in the same directory (`.nj-tmp-<pid>-<rand>`, `fsync`, above), then
`link()`s it to the name *g+1* and removes the temp file. The first
transition creates the element's directory with `mkdir`; an existing one is
reused. `link` fails with `EEXIST` when *g+1* exists, so of any number of
processes that read generation *g*, **exactly one** creates *g+1*; every
other one learns that the state moved on, re-reads, and decides again. This
is the mechanism § 8 already trusts — exclusive creation, atomic on a local
filesystem, no lock — used as a compare-and-swap instead of a counter.
Entries are written whole before they get their name, so a reader never sees
a half-written entry.

`link` can also fail with **`ENOENT`**: the temp file was removed out from
under it (a concurrent `doctor --fix` step 7 sweeping stray temp files — it
has no way to tell a claim's in-flight temp file from a genuinely abandoned
one, the same unguarded window every atomic write in the tool already has),
or the claim directory itself is gone (a concurrent `archive`/`rm`/
`unarchive`). Both are treated exactly like `EEXIST`: **a retry round** —
re-read (a missing directory reads as unclaimed; `mkdir` recreates it on the
next attempt) and decide again, bounded by the same 100-round limit as ID
allocation (§ 8); exhausting it exits 1 with `changed_in_parallel`.

Two rules make the sequence safe: **nothing is moved or deleted while the
element is live** — claim, steal, release and rollback only *append*, so
there is no moment in which the claim path is empty and a competitor could
slip in; and **generations never restart while the element is live** — the
highest entry is never deleted while the element is active, so a new
transition is always *max+1*, and a process acting on a stale read always
meets `EEXIST`, `ENOENT` (above), or a higher entry on its next read.
`doctor --fix` never prunes a live claim's entries (§ 14) — that is what
keeps the first rule true; `archive`/`rm`/`unarchive` remove the directory
entirely (above, and § 11a), never partially. A successful `link()` is
sufficient on its own; nothing is re-checked afterward.

The frontmatter mirrors the claim for humans and for git: a successful claim
writes `assignee: <name>` through the guarded write above. **The claim
sequence is the truth for exclusivity; `assignee` is its mirror** (§ 6).
Claims are local runtime state and are not committed (§ 4).

**Stale claims (`claim:stale`, § 7) are advisory only.** `claim:stale`
appears in the `_problems` of every entry `nj` returns — `list`, `show`,
`tree`, bare `nj`, and the write results of `set`, `note` and the rest —
exactly as `claim:mismatch`/`claim:orphaned` already do. It is reported
when a claimed element's `now − _claim.since` exceeds
`claims.staleAfterHours` (§ 5, default 24, `0` disables it) — `now` is
`NJ_NOW` when set, real wall-clock time otherwise, the same clock-pinning
discipline every other timestamp-sensitive behaviour in this section
already has. This changes nothing about § 12's opening principle:
`claim:stale` never auto-releases, never auto-steals, and `--ready`
condition 5 (§ 9) is unaffected by staleness in either direction — a stale
claim still hides the element from every other acting name's `--ready`,
exactly as a fresh one does. It is the same kind of signal reported, acted
on by a human or agent choosing to `--steal`, never acted on by `nj`
itself.

### Limits, disclosed

- `O_CREAT|O_EXCL` and `rename` are only guaranteed on **local** filesystems.
  On NFS or SMB the guarantee weakens. The requirement is "local"; the
  limitation is documented, not concealed.
- Windows is not a target platform. `rename` over an existing file behaves
  differently there.
- Same element in the same millisecond: a residual window, overridable with
  `--force` on `set` and `note` — `archive` and `unarchive` have no override
  (§ 12).
- Under `hierarchy`, an archive that merges into an existing archive folder
  (§ 11), or an unarchive that merges into an existing active folder (§ 11a),
  takes several `rename`s. A crash between them leaves part of the subtree in
  the archive and part outside it: `archive:split`, reported by `doctor` —
  the same state a manual move produces, in either direction.
- Tombstones and the directory entry are not `fsync`'d: they survive a
  process crash, but a machine crash within the write window may lose one —
  the allocator's file-scan start value and `doctor --fix` restore the
  recoverable part (§ 8).
- Claims are exclusive among processes on **one** local filesystem — the
  agents sharing a working tree, the case NanoJira is built for. Two clones
  on two machines each accept a claim for the same element; the second push
  then conflicts on `assignee` in git, which is where cross-machine
  coordination belongs. `link()` is part of the "local filesystem" guarantee
  above, like `O_CREAT|O_EXCL` and `rename`.
- A claim guarantees nobody else *claims*; it does not stop an agent that
  ignores claims from writing (§ 12a). That is deliberate: the alternative
  is a lock.
- The claim sequence grows by one entry per transition until `doctor --fix`
  removes the whole directory once the element is archived or gone (§ 14) —
  a few bytes per claim, bounded by the number of claims made.
- **A same-named re-assertion that loses a race leaves one doomed entry in
  the history, briefly** (DECISIONS 114/115): if a re-assertion's own mirror
  write fails just as a separate, successful re-assertion or steal under the
  same name lands ahead of it, the chain still shows the failed attempt's
  entry until the newer one supersedes it — its own rollback, which restores
  `claimed N` rather than releasing it, typically meets that newer
  generation and is abandoned, since there is nothing left for it to usefully
  restore. No process's belief about who currently holds the claim is ever
  wrong — this is a pure audit-trail oddity in the *history*, not the
  *state* — and it is disclosed here rather than fixed: closing it would
  mean giving rollback special knowledge that a same-named entry doesn't
  count as "someone else moved on", which reopens exactly the trust question
  above already settles the other way.
- **A read caches, per process, whether `.nanojira/claims/` exists —
  a narrow, one-time staleness window.** If a backlog's very first claim
  ever lands while a `list`/`tree`/bare-`nj`/`show` is already in progress,
  that one read may report `_claim: null` for elements it checks after the
  moment the claim landed, and may count one of them as ready that no
  longer is. Claim exclusivity itself is unaffected — only `_claim`'s
  display and `--ready`'s filter read this cache, never the claim
  mechanism — and the next read is correct: the window exists once per
  backlog, for the very first claim only.

---

## 12a. `nj claim` / `nj release`

```
nj claim   --id=TSK-007 [--as=<name>] [--status=<s>] [--steal=<holder>] [--json]
nj release --id=TSK-007 [--as=<name>] [--json]
```

(`--file=<path>` instead of `--id`, and `--backlog`, as for every write.)
`release` is its own verb: § 9's "verb as a subcommand, not as a flag". The
mechanism is § 12 "Claims"; this section is the interface built on it.

**`nj claim`** — with the acting name N (§ 9; none → exit 1,
`missing_argument`):

1. Refused before anything is written: an archived element
   (`refused:archived`); X itself an unreadable stub (`refused:unreadable` —
   only the addressed element: a claim reserves one element and moves
   nothing, so § 9's backlog-wide stub guard for `rm`/`archive` does not
   apply); a duplicate id without `--file` (`duplicate_id`); an invalid
   `--status` (`invalid_value`).
2. Read the state at generation *g* and decide:
   - unclaimed → append *g+1* `claimed N`;
   - `claimed N` → N holds it already: **re-assert** by appending *g+1*
     `claimed N` again — one real compare-and-swap, the same as every other
     transition, not a bare read; this grows the sequence by one entry even
     though the holder does not change — `changed` is empty unless
     `--status` changes the status;
   - `claimed H`, H ≠ N → exit 1, **`refused:claimed`**, naming H and the
     claim time — unless `--steal=H` (below).
   On `EEXIST` or `ENOENT` (§ 12) re-read and decide again: a racing
   claimant that won is now the holder, and N gets `refused:claimed`.
3. Write `assignee: N` (and `status`, when `--status` is given) in one
   guarded write (§ 12). If that write fails (`changed_in_parallel`, a fault
   hook, any I/O error), the **rollback restores what this invocation
   read** — it is not always a bare `released N`:
   - **A plain claim** read `unclaimed`, so its rollback appends
     `released N`.
   - **A re-assertion** read its own prior `claimed N`, so its rollback
     restores `claimed N` — a failed mirror write on a re-assertion must
     not give up a claim N already held before the command ran; in effect,
     a re-assertion's rollback has nothing to undo.
   - Either way, if the rollback append itself meets a higher generation
     (`EEXIST` — a stealer took the claim in between), it is abandoned: the
     newer holder is the holder.
   - **A steal is never rolled back.** Once a steal's own `link()` has
     succeeded it is final: a mirror-write failure afterward is reported as
     `claim:mismatch` (§ 7) and N remains the holder on the chain, rather
     than guessing whether some later transition has already relied on the
     steal having landed.
   The command exits 1 with the write's code either way. A plain claim
   either holds with its mirror, or is released again; a re-assertion
   either holds with its mirror, or keeps holding without it; a steal
   either holds with its mirror, or holds without it; a crash between any
   append and its write likewise leaves `claimed N` without the mirror —
   `claim:mismatch`.

`--status=<s>` lets an agent claim and start in one write
(`nj claim --id=TSK-007 --status=doing`), validated as for `nj set`
(`invalid_value`; the parent rule of § 9 applies unchanged).

**Stealing.** `--steal=H` takes over a claim held by H — the only way to
recover from a crashed claimant, and deliberately explicit: the stealer must
name the holder it replaces. With the state read at *g*:

- `claimed H` → append *g+1* `claimed N`. On `EEXIST` or `ENOENT`, re-read:
  whatever landed first (another stealer, H's own release, a claimant after
  that release) is decided again from the new state — a steal from H
  succeeds only while H is still the holder.
- `claimed X`, X ≠ H → `refused:claimed`, naming X. Nothing is appended: a
  steal that names the wrong holder changes nothing, and in particular
  cannot disturb X's claim.
- unclaimed → a plain claim of N.

So of any number of concurrent steals and claims **exactly one** changes the
holder, and every other one exits `refused:claimed` naming the holder it
lost to. The result names the previous holder (`stolen_from`). A concurrent
`release` of the same claim is not one of these (DECISIONS 120): if it lands
first, the steal's retry reads `unclaimed` and becomes a plain claim (the
third bullet above), so both exit 0; if the steal lands first, the release
reads a different holder and exits 1 with `refused:claimed` naming the
stealer. Either way the stealer ends up holding it.

**`nj release`** — the holder gives the claim up. With the state read at
*g*: `claimed N` → append *g+1* `released N`; on `EEXIST` or `ENOENT`
re-read — if a stealer got there first, `refused:claimed` naming the new
holder, since N no longer has anything to release. `claimed H`, H ≠ N →
`refused:claimed` naming H (a release of someone else's claim is a steal
and must say so). Unclaimed → exit 0, nothing to do. `assignee` is **left as
it is** — it records who worked on the element; clearing it is an explicit
`nj set --assignee=`.

**Final status releases the claim** (DECISIONS 171 B,
feedback/team-b-tests TSK-013: ten of twelve stale claims found by
`claim:stale` were on elements already `done`, claimed and never
released). Whenever a write sets `status` to the **last configured
status** (§ 5 already requires this to be literally `done`, not merely a
default) — via `nj set --status=<last>`, `nj claim --status=<last>`, or
`nj next --status=<last>` (§ 12b, which reuses this same mechanism) — the
element's claim, if it has one, is released **in the same call**, and the
result reports it additively: `released: "<holder>"`.

- **Whose claim it releases: whoever holds it, even if that is not the
  acting name.** This is not `nj release`'s own rule (which refuses
  `refused:claimed` unless the acting name is the holder, above) — it is
  an administrative side effect of the element reaching `done`, not an
  act of giving up one's own claim, so it is unconditional on who is
  running the command. If alice runs `nj set --id=X --status=done` on an
  element bob holds, bob's claim is released, not refused.
- **`nj claim --status=<last>` releases the claim it just acquired, in
  the same call.** This looks redundant but is the consistent reading of
  "done releases the claim": the claims sequence gains two entries for
  this one invocation (`claimed N`, then `released N`, both at the same
  timestamp) — `nj log` then shows both, because both genuinely
  happened, in that order, rather than silently collapsing them into
  nothing. The same applies to `nj next --status=<last>` (§ 12b), which
  claims via this same path.
- **Unconditional means no ownership check and no "steal" concept** —
  there is nothing to contest, so there is no `refused:claimed` case for
  this release. If a *different* name holds the claim at the moment this
  transition actually lands (it raced a concurrent claim or steal since
  this call started), the **current** holder at that moment is who gets
  released — the same "decide fresh every round against the freshly read
  state, never a bare read trusted across rounds" discipline every other
  claims transition already has (§ 12).
- **Unclaimed: no release happens at all — not even an empty one.** The
  claims sequence gains no new entry, and the result carries no
  `released` key (absent, not `null`) — the same "present only when it
  happened" shape discipline `claim`'s own `stolen_from`/
  `previous_assignee` already use (§ 9 "JSON shapes per command").
- **A refused `set --status=done` (`refused:children_open`, without
  `--allow-open-children`) releases nothing.** The refusal is checked —
  exactly as it already is today — *before* any write and before this
  new release transition is even attempted; nothing happens to the
  element or its claim either way. A **forced** `done`
  (`--allow-open-children`, which still writes `done:open_children` as a
  warning, § 7) is a write that proceeds, so it releases the claim the
  same as any other successful final-status write.
- **The rollback interplay with the guarded write.** The claims-sequence
  release is attempted **first** (optimistically), then the element's own
  guarded write (status, and any other fields given in the same call)
  happens **second** — the same order `nj claim`'s own claim-then-mirror-
  write already has (§ 12a step 3, above). If the guarded write fails
  (`changed_in_parallel`, a fault hook, any I/O error), the release is
  **always rolled back** — re-asserting `claimed <holder>` for whoever it
  released — with no exception for a landed steal the way a plain
  claim's own rollback has one (there is no steal here to begin with: an
  unconditional release is never itself racing another claimant for the
  *right* to the entry, only for *which* holder is current when it
  lands). The command then exits with the write's own failure code,
  exactly as it would without this feature — the release is invisible to
  a caller that never reads `released`, on both the success and the
  rollback path.
- **Batch (`--id=A,B,C`).** Applies per ID, independently, exactly like
  every other per-ID effect a batch already has (§ 9 "Batch writes") — no
  batch-wide behaviour beyond what the existing wrapper already does.
- **`nj-mcp`'s `set`/`claim`/`next` tools.** No MCP-side change at all:
  each tool call spawns `dist/nj --json` as a child process and returns
  its output verbatim (§ 17), so `released` surfaces there automatically,
  the same way every other additive JSON field in this spec always has.
- **`nj doctor --fix` performs the same unconditional release in bulk**
  (DECISIONS 182 A, § 14 step 7b) for any element that reached the final
  status **before** this release existed, or through any other path that
  left a claim behind — the gap feedback/team-a found as 32
  `claim:stale` warnings on pre-v3.8 `done` elements. Same mechanism,
  same claim-log entry (`released N` at the next generation), same
  "whoever holds it" unconditionality; the only difference is *when* it
  runs (a `--fix` sweep instead of inside one write) and that it also
  reaches already-**archived** final-status elements, which this section
  never touches (one write, one still-live element).

**Visibility.** `list` and `show` mark a claimed element with its holder via
`_claim` (§ 9); a reader lists the directory and reads the highest entry.

**Git (`.gitignore`, amends § 4 and § 14).** `nj init` writes a third
pattern, `.nanojira/claims/`, after the two of § 4 (one byte change to
existing `init` output). An existing backlog gains it through `doctor`:

- `doctor` reports **`backlog:claims_unignored`** (§ 7) when
  `.nanojira/claims/` exists and `.gitignore` has no line that is exactly
  `.nanojira/claims/`. A backlog that never claimed anything carries no
  finding, so v3 backlogs stay clean.
- `doctor --fix` then **appends** the line to an existing `.gitignore`, with
  the discipline of step 0 (§ 14): the line is added exactly once, verbatim,
  after a final newline if the file lacks one, in the file's own line
  ending (CRLF kept, DECISIONS 101) — for a file with **mixed** line
  endings, the last line's ending, or `LF` if the file is empty or its last
  line has none. Without a `.gitignore`, `--fix` creates none and says so in
  a note — it is the user's file, and its absence may be deliberate.

**Doctor (§ 14).** `doctor --fix` removes claim directories only for
elements that are archived or gone (§ 7 `claim:orphaned`) — not merely
`done`, since a done-but-still-live element can still legitimately be
claimed — and never touches a live claim's entries: no pruning while the
element could still be claimed. It never resolves a `claim:mismatch` (§ 7)
either — which of the claim and `assignee` is right is exactly the kind of
question § 14 forbids guessing. `nj archive` and `nj rm` remove the claim
directories of the elements they move or delete (entries, then `rmdir`; a
directory that is not empty afterwards — a stale process appended in
between — is left for `doctor` as `claim:orphaned`); `nj unarchive` does
the same, while the element is still archived (§ 11a).

**Output.** `claim` and `release` return the shape of § 9's JSON-shapes
table.

### Limits, disclosed

See § 12 "Limits, disclosed" — claims share that section's limits (one
local filesystem, no lock against a non-claiming writer, sequence growth
until cleanup, the same-named re-assertion audit-trail residual).

---

## 12b. `nj next`

```
nj next  [--as=<name>] [--status=<s>] [--type=…] [--tag=…] [--parent=…]
         [--assignee=…] [--json]
```

One call that picks the highest-ranked `--ready` element and claims it —
closing the gap between a separate `list --ready` and `claim`, where two
callers can read the same top candidate before either claims it
(DECISIONS 154).

**Candidates** are the `--ready` set (§ 9 "`--ready`") for the given
acting name, in `list`'s own order: priority descending, then `id`
ascending — the same order `list --ready` and bare `nj` already print
their top-ready elements in — **narrowed to leaf work** (DECISIONS 156):
a `--ready` element with at least one **open child** (a child that is
neither `done` nor archived) is **not a candidate**, whatever the
filters, including `--type=epic`. Its open children are themselves
`--ready` (or not) independently, and are candidates on their own
merits. An epic with **no** children, or whose children are **all**
`done` or archived, stays a candidate — closing it is real work `next`
may still hand out. This rule is specific to `next`: `list --ready` and
bare `nj` are **unchanged**, so a container can still appear there as
"ready to work" exactly as before (tracked for later on TSK-043, not
changed now) — only `next`'s own candidate set excludes it. The filters
are `list`'s own: `--type`, `--tag`, `--parent`, and **`--assignee`** —
included for the same reason `list --ready --assignee=…` already exists:
a backlog that pre-partitions work by `assignee` (a plain field, not a
claim) can ask `next` to pick only from one slice, without that
pre-partitioning having to be encoded as claims. Condition 5 of
`--ready` already means an element the acting name **currently holds**
is itself ready — so it is a legitimate candidate (once the leaf-work
rule above also passes), and claiming it is the ordinary re-assertion
`claim` itself defines (§ 12a step 2), not a race.

**Respects an existing `assignee` — on by default, not an option**
(DECISIONS 158, PA-5): a `--ready`, leaf element whose `assignee` names
someone **other than** the acting name is **not a candidate** either. An
`assignee` is a statement of intent (§ 6) — set by a human, by `--assignee`
on `new`/`set`, or by a prior `claim`/`next` — and `next` silently handing
that element to a different name regardless would overrule it without
telling anyone; refusing to consider it at all is the only safe default.
A candidate therefore needs `assignee` to be **empty, or exactly equal to
the acting name** — compared byte-for-byte, the same exact-string
equality every other identity comparison in this document already uses
(ids, tags, acting names themselves — no case-folding, no trimming beyond
what the acting name's own resolution already did, § 9): `Alice` and
`alice` are different assignees, and an `assignee` with incidental
leading/trailing whitespace from a hand edit matches nothing until it is
cleaned up. This interacts with the **`--assignee=<v>`** filter above,
which is unchanged in what it does (narrows candidates to exactly
`assignee == <v>`) but now composes with the default: `--assignee=` (the
empty string) narrows to unassigned candidates only, excluding ones
already assigned to the acting name itself; `--assignee=<the acting
name>` narrows to candidates already assigned to the acting name,
excluding unassigned ones; `--assignee=<anyone else>` can never match
anything (it demands `assignee == <v>` while the default demands
`assignee` is empty or the acting name) and reaches **`none_ready`**
every time — not a special case, just what the two conditions intersect
to. `list --ready` is **unchanged**: this is a `next`-only narrowing, the
same way the leaf-work rule above is.

**The acting name is required.** Omit it and the call fails
`missing_argument` — the same rule `claim`/`release` already have (§ 9
"The acting name"); "the next ready element" means nothing without
someone to claim it for.

**`--status=<s>`** behaves exactly as on `claim` (§ 12a): optional,
validated the same way (`invalid_value`, checked once, before any
candidate is resolved — it does not depend on which one succeeds); when
given, it is written in the same guarded write as the claim; omitted, the
claimed element's status is untouched (and stays `statuses[0]`, since
every candidate is `--ready`). **`--status=<last>`** (DECISIONS 171 B)
therefore applies here too, since `next` claims via the same path `claim`
does: the claim this call just made is released again, in the same call
— unusual (nothing was ever worked on between claiming and finishing),
but the consistent reading of "the last status releases the claim,"
exactly as `claim --status=<last>` already is, above.

**Mechanism.** `next` reads the candidate list exactly once, then
attempts `claim --id=<candidate> --as=<name> [--status=<s>]` against each
candidate in order:

1. **Success** → `next` succeeds with that element. Done.
2. **`refused:claimed`** (another acting name won the race for this
   candidate since the list was read) → that id is recorded as skipped,
   and `next` moves to the next candidate.
3. **Any other claim failure** (`refused:unreadable`, `refused:archived`,
   `duplicate_id`, `invalid_value`, `io_error`, `changed_in_parallel` past
   the retry budget, `fault:<hook>`) → `next` fails immediately with that
   same code, rather than trying another candidate. These are not races:
   `--ready` does not let an archived or unreadable element through in
   the first place, so meeting one of these here means the backlog
   changed in a way `refused:claimed` does not cover, or is already in a
   state `nj doctor` should be run against — `next` surfaces that rather
   than silently skipping past it.
4. **The candidate list is exhausted** — every candidate lost its race,
   or there were none to begin with — → **`none_ready`**, exit 1 (new
   closed-vocabulary code, § 9).

`next` never re-scans the backlog mid-loop: the candidate list is one
snapshot, read once. A dependency that becomes ready *during* the loop (a
sibling finishing concurrently) is not picked up by this call; the next
call to `next` sees it.

**JSON shape.** Success is `claim`'s own shape (§ 9 "JSON shapes per
command"), with one addition: **`skipped`** — the ids that lost their
race before the one that succeeded, in attempt order; always present,
`[]` when none were skipped. Failure, including `none_ready`, stays the
generic `{ok: false, error, hint?}` — no extra field there, the same
discipline every other failure in this document holds (§ 9); the hint
text for `none_ready` may say how many candidates were tried.

Human output is one line on success — the claimed element's id and title,
the same line `claim` itself prints — or the `none_ready` message on
stderr.

**Not applicable:** `--id=A,B,C` (batch writes, § 9) and `--file` — `next`
picks its own target; there is nothing for either to name.

**Rollback** is exactly `claim`'s own (§ 12a step 3): the mirror write
for whichever candidate succeeded rolls back the same way a plain
`claim`'s would, by the same rules. Candidates that only ever lost a race
were never written to by this call, so there is nothing of theirs to
roll back.

---

## 12c. `nj log`

```
nj log  --id=TSK-007 [--json]
nj log  --file=<path> [--json]
```

The change history of one element: who did what and when, derived
**entirely** from data this specification already requires `nj` to keep
— `created`, the claim generations (`.nanojira/claims/<id>/`, § 12), and
the body's dated, signed notes (§ 10). **There are no new writes**: no
write command's output or the bytes it touches change because `log`
exists, so § 12's atomicity rules, § 13's cost and the replay gate are
all unaffected by this section (DECISIONS 155).

**This derivation has two plain limits, stated here because they are
easy to miss:**

1. **No field-level history.** A `set --status=doing`, a priority
   change, a retitling — none of these leave a trace `log` can show;
   only `created`, claims and notes do. An agent that wants a durable
   record of *why* a field changed should leave one with `nj note`.
2. **Claim history is local to the working copy.** `nj init` writes
   `.nanojira/claims/` into `.gitignore` (§ 12a) — it is never committed.
   A fresh clone, or any machine that has not itself run `nj claim` on
   this copy, shows **notes and `created` only**: the claim events
   happened, but their record did not travel with the repository.
   Archiving an element compounds this a different way: `archive`
   deletes `.nanojira/claims/<id>/` outright (§ 12a) as part of the move,
   so `log` on an archived element shows no claim events even on the
   machine that made them — not a locality limit this time, but the
   same underlying fact (claims are not part of the committed record)
   reaching a different conclusion.

**Candidates for merging**, each read in its own natural order:

- **`created`** — exactly one event, timestamped at the element's own
  `created` field. No actor: nothing signs a creation today.
- **Claim generations**, read in numeric order (the same discipline
  claim's own highest-generation lookup already requires, § 12 "Claims"
  — non-numeric entries, stray temp files included, are not generations
  and are ignored here too). Each generation's stored line is `claimed`
  or `released` (§ 12), classified into one of four event kinds by
  comparing it with the generation immediately before it:
  - `released` → kind **`released`**, actor the stored name.
  - `claimed`, with no earlier generation, or the earlier one `released`
    → kind **`claimed`** (a plain claim).
  - `claimed`, the earlier one also `claimed` by the **same** name → kind
    **`reasserted`**.
  - `claimed`, the earlier one `claimed` by a **different** name → kind
    **`stolen`** (the only way this shape arises is `--steal`, § 12a); the
    previous holder is not repeated as a field — it is the actor of the
    event immediately before this one in the merged list.
- **Notes**, read in document order (§ 10): each `- <ISO-8601> <author>:
  <text>` line becomes one event, kind **`note`**, actor the author,
  text everything after the first `: ` following the author — **plus any
  continuation lines** (§ 10 "Multi-line text", DECISIONS 158), rejoined
  with `\n` in the same `text` field, so a multi-line note's JSON `text` is
  byte-identical to what was written, continuation indent stripped. A line
  under `## Notes` that does **not** match a fresh note line, is not a
  continuation of the one before it, and is not itself text already
  claimed by a continuation — a genuine hand edit, most often — is
  **silently skipped**, not an error and not a degraded event: the same
  tolerance this specification already has elsewhere for a hand-edited body
  that doesn't match a parsing rule it depends on.

**Merging.** Every event from every source above is merged into one list
by `at` ascending. **Tie-break**, for two events sharing the exact same
timestamp (a fixed `NJ_NOW` makes this routine, not rare): `created`
first, then claim-derived events in generation order, then notes in
document order — a fixed source precedence, not alphabetical and not by
kind, so the merge is deterministic from the same bytes every time.

**JSON shape**: `{ok: true, id, events: [{at, kind, actor?, text?}]}`.
`kind` is one of `created | claimed | reasserted | stolen | released |
note` — a closed vocabulary scoped to this one field, the same way § 7's
problem codes are their own closed vocabulary distinct from § 9's
failure codes. `actor` is absent only for `created`; `text` is present
only for `note`. Events are always in the merged order above — `log`
does not accept a sort flag.

**Human output** is one line per event, in the same merged order:

```
$ nj log --id=TSK-007
2026-09-21T18:00:00Z created
2026-09-21T18:05:00Z claimed by alice
2026-09-21T18:10:00Z alice: wired the route
2026-09-21T18:20:00Z released by alice
```

A note line reuses its own `<author>: <text>` shape; a claim-derived
line reads `<verb> by <actor>` — `claimed`, `re-asserted`, `stolen` or
`released`. A **multi-line** note's event is the one exception to "one
line per event": its first line is `<time> <author>: <first line of
text>`, exactly as above, and each further line of the text is printed
on its own following line, indented the same two spaces the file itself
stores (§ 10) — full fidelity, never truncated, never joined back into
one line.

**Addressing.** `log` is a read — no acting name, no `--all` (there is
nothing to filter; it addresses exactly one element) — but it is a
read that must resolve to **exactly one** file, the same reason every
*write* command accepts `--file`: unlike `list`/`show`, which answer a
duplicate `id` by showing both entries marked `duplicate_id`, `log`
cannot show two merged histories under one `id` and call it one answer.
So `log` is the first read to behave like a write for addressing
purposes only: `--id` naming a duplicate is `duplicate_id` (nothing is
written, because `log` never writes anything); `--file=<path>` (absolute,
or relative to the backlog) disambiguates, exactly as it does for a
write; `--id` and `--file` together is `invalid_target`; `--id` naming
nothing at all is `not_found`, matching `show`'s own unknown-`--id`
behaviour.

**Archived elements.** `log` reads an archived element exactly as `show`
does — archived is a write-time restriction (§ 9), never a read-time
one, so there is no special case here beyond the claims-are-gone
consequence already stated above.

An element addressed directly by `log` that `show` would mark
`file:unreadable` **or** `frontmatter:unreadable` (§ 7 — a file that
cannot be opened, or one that opens but doesn't parse) is
`refused:unreadable` either way: unlike `show`, which tolerates one such
entry among many (reporting the problem in `_problems`, exit 0), `log`
has nothing to derive a history from without reading the element itself
(there is no `created` to read) in either case, so it cannot degrade the
way `show`'s per-entry shape can; this is the same code `claim` already
uses for the identical reason (§ 12a).

`nj help` lists `log`.

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
is now in line with the scan path, not a separate case. **Re-measured on a
genuinely quiet machine as of v3.3** (DECISIONS 150, `90cef67`; Node
24.21.0, darwin-arm64, 10 000 elements, median/max of 5 runs) — `list`
185/220 ms, `list --json` 186/187 ms, `tree` 189/192 ms, `doctor`
188/191 ms, and the writes `new` 230/237 ms, `set --title` 221/223 ms,
`note` 215/218 ms — all inside the comfort bar above. These supersede the
earlier "quiet machine" figures this paragraph previously gave (`npm run
perf`, TSK-003: `list` 188/211 ms, `list --json` 188/192 ms, `tree`
192/194 ms, `doctor` 195/204 ms), which were not from a run confirmed quiet
in the same sense. The 12 000–15 000 trigger below now applies to `tree`
as well.

**Writes, with `STATUS.md` (V3-3, DECISIONS 103).** Every successful write
regenerates the overview from a full scan: every folder is listed and every
element file stat'ed, and only files whose `ctime` is newer than the
command's load start minus 2 s are re-read — the rest reuse what the command
already loaded. A literal re-read of every file was measured first and cost
one read-scan per write (+70 %: `new` 441 → 712 ms); the `ctime` scan costs
about a sixth of that. Measured with `tools/perf.js --ab` (10 000 elements,
15 interleaved rounds, paired), against the pre-`STATUS.md` build `ccbc951`,
on a machine in Low Power Mode with other agents running (10 of 30 rounds
started under foreign CPU load; absolute numbers are therefore not comfort-bar
numbers, the paired deltas are):

| write | before (median/max) | with `STATUS.md` (median/max) | paired delta |
|---|---|---|---|
| `new` | 460 / 799 ms | 519 / 881 ms | +14.1 % |
| `set --title` | 445 / 811 ms | 502 / 2841 ms | +12.7 % |
| `note` | 442 / 611 ms | 498 / 866 ms | +12.6 % |

Reads are unchanged (paired −1.0 … +3.6 %). A write therefore costs about one
extra `stat` scan (≈ 55 ms here at 10 000 elements). With `layout.statusFile:
false` there is none. This table's own absolute numbers stay as they are,
under-load artifacts kept only for the **relative** cost they establish —
they are not superseded by the quiet-machine write figures above, which
answer a different question (the absolute comfort-bar check) than this
table does (the relative cost `STATUS.md` adds).

The index is therefore still deferred, with a measured trigger: implement it
when backlogs approach ~12 000–15 000 elements, or ~9 000 if `list --json` is
routinely on the agent's hot path. Round one ships without it; the design is
fixed now so it can land later without touching the data model.

`nj find` (§ 9a) shares this same scan path: bodies are already parsed for
completeness/title/section checks, so `find` adds one substring scan over
text already loaded, not a new read. It does not change when the trigger
above is crossed — the same O(n) scan every other command already does.

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
a missing or empty `ids/` while elements exist (`backlog:ids_missing`);
element files without tombstones (`id:no_tombstone`); stray `.nj-tmp-*`
files, including inside `.nanojira/claims/` (`backlog:stray_tmp`, § 12
"Claims"); archive rules (§ 11); claim directories that are mismatched,
orphaned or stale (`claim:mismatch`, `claim:orphaned`, `claim:stale`, § 12
"Claims") and a `.gitignore` missing the claims line
(`backlog:claims_unignored`); `STATUS.md` against a
fresh rendering (`backlog:status_stale`, only with `statusFile: true`). The
summary line splits the
counts — `backlog/: 47 entries, 2 errors, 1 warning` — and the exit code is 2
exactly when at least one `error` finding exists; warnings are reported but
exit 0.

### `--fix`

Repairs **unambiguous** cases only. **While `config:invalid` (or
`backlog:legacy_layout` with an ambiguous step 0) holds, `--fix` writes
nothing** except step 0 itself: a directory that is not a valid backlog —
reached by a mistyped `--backlog` or `NJ_BACKLOG` — must not receive
tombstones, moves or rewrites (DECISIONS 93). Steps run **in this order** — the
tombstone backfill claims the **frontmatter** `id`, so it must run after the
rename, or it would claim the wrong number while the right one stays
unprotected:

0. migrate a legacy layout: create `.nanojira/`, move `.nanojira.json` to
   `.nanojira/config.json` and `.ids/` to `.nanojira/ids/` (each one
   `rename`; the configuration content is not rewritten), delete the v2
   index file `.nanojira-index.json` if present, and replace the pattern
   `.nanojira-index.json` in `.gitignore` by `.nanojira/index.json` — only
   when that line is present verbatim; otherwise `.gitignore` is left alone
   and a note says so. `README.md` is replaced by the v3 text only when it
   is byte-identical to the text a v2 `nj init` wrote; otherwise it is left
   alone and a note says so. If both the v2 and the v3 location of the
   configuration or of the tombstones exist, nothing is moved — ambiguous,
   reported, never merged.

   **A backlog that is already v3** (not `backlog:legacy_layout`) can still
   carry a stray top-level `.ids/` — the half of a crash between step 0's
   two renames that left `.ids/` → `.nanojira/ids/` incomplete while
   `.nanojira.json` → `.nanojira/config.json` finished (DECISIONS 108 G1,
   harmless: it only doubles never-reuse, § 8). Step 0 also removes this
   stray `.ids/`, but **only when every tombstone name in it is already
   present in `.nanojira/ids/`** — never discard a tombstone that exists
   nowhere else, since "never reuse" (§ 8) is the one invariant `--fix`
   cannot compromise on. A `.ids/` holding a tombstone not mirrored in
   `.nanojira/ids/` is left alone entirely. This is a `--fix` note only, no
   new problem code: the leftover is harmless one-time migration residue,
   not a current defect for `doctor` to name
1. write the `id` from the file name, and the `type` from the ID prefix, when
   missing
2. rename the file to match the `id` when frontmatter and file name disagree
   and the target is free
3. move a file to its layout place (`type:folder`, `layout:misplaced`) —
   under `type` only when `id` prefix and `type` agree (frontmatter > prefix >
   folder precedence; the folder loses); under `hierarchy` only when the
   whole `parent` chain resolves without `parent:*` problems, and a subtree
   moves with its top folder in one `rename`, top-down; every target must be
   free, otherwise that element is reported and stays; missing target
   folders are created. A file lying where it belongs is never touched
4. create missing tombstones for every ID found in element files
   (`id:no_tombstone`, `backlog:ids_missing`; tombstones for deleted IDs are
   unrecoverable and reported as such)
5. write `status` from `statuses[0]`, and `created`/`updated` when missing —
   `created` from the file mtime, `updated` = now (this step is a write)
6. pull the H1 up from `title`
7. remove stray `.nj-tmp-*` files (now covers `.nanojira/claims/` too, § 12
   "Claims")
7a. remove the claim directories of orphaned claims — archived or gone,
    never merely `done` (§ 7 `claim:orphaned`) — and append the
    `.nanojira/claims/` line to `.gitignore` if missing (§ 12a). Never
    touches a live claim's entries: no pruning while the element could
    still be claimed. Never resolves a `claim:mismatch` (§ 7) — which of the
    claim and `assignee` is right is exactly the kind of question this
    section forbids guessing. **Staleness alone is never a reason to
    release or steal a claim** — `claim:stale` (§ 7) is reported, not
    repaired, by this step or any other; step 7b below releases on
    **finality of status**, never on age
7b. **release every claim still held on an element in the final status**
    (live or archived), whoever holds it — the same unconditional release
    `set`/`claim --status=<last>` already perform inside one write (§ 12a
    "Final status releases the claim", DECISIONS 182 A), applied here in
    bulk to elements that reached that status through some other path and
    were left claimed (most commonly: `done` before that release existed,
    feedback/team-a). One `released <holder>` entry appended at the
    next generation per element, the same claim-log mechanism and shape;
    the element's own file is never touched (a release never touches the
    file, § 12a). Claims on elements **not** in the final status are left
    exactly as they are, stale or not — only `--release`'d by this step
    when the status itself is final. Runs after 7a: an archived
    final-status element's claim directory is typically already gone by
    this point (7a's orphan rule covers any archived element, regardless
    of status), so 7b's practical effect is almost always on **live**
    final-status elements; it is specified for both to match the
    unconditional rule it mirrors exactly, and to cover the window where
    archiving and finality do not coincide in whatever order a backlog's
    history happens to produce. Idempotent: a second `--fix` finds no
    claim left to release and reports nothing for this step
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
that uses `--fix` as a gate therefore needs no second `doctor` run. Step 7b's
releases are named the same way every other step's action already is — one
`fixed[]` line per element, naming the id and the holder it released — since
`claim:stale`/nothing-to-report is no longer true for it after the release,
`problems[]` reflects that too.

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
25. **Note author.** With `NJ_AUTHOR` set, `nj note` signs with it — whether
    or not the element has an `assignee` — and the note line is otherwise
    byte-identical to § 10's; the value is trimmed. Unset or empty, the
    signer is the `assignee`, else `?`, exactly as before. A value that is
    whitespace-only, multi-line or contains `:` exits 1 with `invalid_env`
    and leaves the file byte-identical, while `list`/`show`/`set` under the
    same environment behave as without it. `NJ_AUTHOR` never changes
    `assignee`.

26. **Unarchive.** For each group (`type`, `hierarchy`, `flat`) and for
    renamed folders: `archive` followed by `unarchive` of the same element
    returns every file of the subtree to the path it had before the archive,
    byte-identical except for `updated`; the `archived` key is gone; `list`
    shows the elements again without `--all`; `STATUS.md` lists them; a
    following `doctor` is clean. Under `hierarchy`, unarchiving an epic whose
    child task was archived separately earlier brings both back (merge), and
    unarchiving a task under an active epic moves only the task's folder.
    Changing `group` between `archive` and `unarchive` places the files by
    the new layout. `refused:not_archived`, `refused:parent_archived`,
    `refused:unreadable`, `refused:misplaced` and `exists` each exit 1 and
    change no byte of the backlog. With `NJ_FAULT=before-compare` a parallel
    edit aborts with `changed_in_parallel`; with `NJ_FAULT=before-rename`
    nothing has moved and every file is its previous revision.

27. **Claims.** Twenty processes run `nj claim --id=TSK-001` in parallel,
    each with its own acting name: exactly one exits 0; the other nineteen
    exit 1 with `refused:claimed` naming the winner; the element is claimed
    by the winner and its `assignee` is the winner's name; `doctor` is clean
    but for `backlog:claims_unignored` where the fixture's `.gitignore`
    lacks the line. A claim by the holder again is exit 0, re-asserting with
    one more `claimed` entry — `changed` is empty unless `--status` changes
    the status. `release` by another name is `refused:claimed`; by the
    holder it releases the claim and keeps `assignee`. **Steal race:** ten
    concurrent `--steal=<holder>` have exactly one winner, and **no claim is
    lost** — the final holder is the one process that reported success, the
    claim sequence holds exactly one `claimed` entry per successful claim or
    steal and nothing between them, and a steal naming the wrong holder, run
    concurrently with the others, changes nothing. A landed steal whose own
    `assignee` write then fails is reported as `claim:mismatch`, not rolled
    back — the steal stands. `release` racing a steal of the same claim:
    the steal always exits 0; the release exits 0 (if it lands first, the
    steal's retry finds it unclaimed and becomes a plain claim) or
    `refused:claimed` naming the stealer (if the steal lands first) — either
    way the stealer ends up holding it, with `assignee` agreeing and no
    `claim:mismatch`. `NJ_AUTHOR=b nj list --ready` omits an
    element claimed by `a` and lists one claimed by `b`; a backlog without
    claims answers `--ready` exactly as before condition 5 existed. A
    claimed element can still be `set`, `note`d, archived and removed by
    anyone, and `archive`/`rm` remove its claim. A plain claim whose
    `assignee` write fails (`NJ_FAULT=before-rename`) is rolled back and
    ends `released`; a re-assertion whose `assignee` write fails instead
    keeps its claim — its rollback restores `claimed N`, the entry it read,
    not a release. A done-but-live element keeps its claim through
    `doctor --fix` (only archived or gone elements are `claim:orphaned`); a
    stray temp file in the claims tree is `backlog:stray_tmp`, removed by
    `doctor --fix`. `nj unarchive` of an element with a leftover orphaned
    claim directory removes it wholesale, the same as `archive`/`rm`, before
    the first move: the unarchived element starts unclaimed unless a
    straggler's append raced the removal. `nj init` writes
    `.nanojira/claims/` into `.gitignore`; on an existing backlog with
    claims, `doctor --fix` appends it once, keeping CRLF, and never creates
    a missing `.gitignore`. `claim` without a name is `missing_argument`; on
    an archived element, `refused:archived`. `--as` outranks `NJ_AUTHOR`; an
    invalid `--as` is `invalid_value`, an invalid `NJ_AUTHOR` is
    `invalid_env`, on `claim`, `release` and `note` alike.

28. **Check.** A checkbox is any `-`/`*`/`+`/`<digits>.`/`<digits>)`-marked
    list item, at any indentation, followed by `[ ]`, `[x]` or `[X]`; `[x]`
    and `[X]` both count as ticked on read, only `[ ]` as unticked, and a
    write always produces `[x]` (`--on`) or `[ ]` (`--off`), never `[X]`.
    `nj check --id=TSK-007 --text=<substring>` and `--item=<n>` each
    address the same checkbox when there is exactly one countable match;
    `--on` an unticked box and `--off` a ticked one each flip exactly that
    line's bracket content and nothing else, byte-for-byte, with `updated`
    refreshed; `--on` already-on and `--off` already-off each exit 0 with
    `changed: []` and change no byte. With **neither** `--on` nor `--off`,
    the command ticks, exactly as `--on` would; `--on` **with** `--off` is
    `invalid_value`, exit 1, changing nothing. A checkbox inside `## Notes`, or
    inside a fenced code block (` ``` ` or `~~~`, nested or indented), is
    never counted or matched — neither addresses it and neither index
    includes it. `--text` matching no countable checkbox, or `--item` out
    of range, is `not_found`; `--text` matching two or more is
    `ambiguous_target`; a literally empty `--text=` is `invalid_value`,
    changing nothing, even where exactly one checkbox exists — not trimmed,
    so a whitespace-only `--text` is a plain substring, not empty. `check`
    on an archived element is
    `refused:archived`, on an unreadable stub `refused:unreadable`, and
    `--id`+`--file` together is `invalid_target`, each exiting 1 and
    changing nothing. `NJ_FAULT=before-rename` leaves the file at its
    previous revision; a parallel edit aborts with `changed_in_parallel`
    unless `--force`.

29. **Stale claims.** An element claimed more than `claims.staleAfterHours`
    (default 24) ago reports `claim:stale` (warning, never blocks
    `--ready`) on every read (`list`, `show`, `doctor`); one claimed less
    than the threshold ago does not. "Ago" is measured against `NJ_NOW`
    when set, real wall-clock time otherwise. `doctor --fix` leaves
    `claim:stale` untouched — no auto-release, no auto-steal, the claim and
    its `assignee` mirror are unchanged byte-for-byte, and the exit code
    reflects only that one warning remaining (0, since a warning never
    raises it). `claims.staleAfterHours: 0` turns the finding off entirely,
    even for a claim far older than the un-configured default; a negative
    or non-integer value, or an unknown key inside `claims`, is
    `config:invalid`. A backlog with no `claims` config key behaves exactly
    as the 24-hour default. `--ready` condition 5 (§ 9) is unaffected by
    staleness in either direction; `_claim`'s shape is unchanged.

30. **Find.** `nj find "<text>"` returns every element whose title or body
    (including `## Notes`) contains `<text>` as a substring, case-insensitive
    by default (`String.prototype.toLowerCase()`'s lowercase mapping on both
    sides, not full Unicode case folding) and exact with
    `--case-sensitive`; combines with `--status`/`--type`/`--tag`/
    `--parent`/`--assignee` as an AND; archived elements are excluded
    without `--all` and included with it, same as `list`. The JSON shape
    matches `list`'s read shape exactly, no `_match` field. A search
    matching nothing returns `entries: []`, exit 0 (a read never fails on
    "no results" — same as an empty `list --status=doing`). `<text>` given
    as the literal empty string is `invalid_value`.

31. **Batch writes.** `--id=A,B,C` on `set`, `note`, `check`, `claim` or
    `release` applies the same field map or action to all named IDs,
    written in the order `--id` named them. A **batch-wide argument error**
    (unknown field, missing/invalid value, a missing or invalid acting
    name, `--id=A,B,C` with `--file` — `invalid_target` — or a repeated ID
    after trimming — `invalid_value`) is reported in the ordinary
    single-write failure shape, `{ok: false, error, hint?}`, no `results`
    at all. A **per-ID preflight failure** (unknown ID, ambiguous `check`
    target, an archived element, an unreadable stub) aborts the whole
    batch — nothing is written for any ID, and `STATUS.md` is not
    regenerated — and uses the wrapper shape with `results` naming **only**
    the failing ID(s), in `--id`'s order; an ID that would have succeeded
    is absent, not listed. Once preflight passes for every ID, each one
    writes independently: a `--force`-less parallel edit on one ID during
    the write phase fails only that ID with `changed_in_parallel`, a
    competing claim is `refused:claimed` only for that ID, `NJ_FAULT`
    fires once — at the first ID in execution order to reach its
    injection point, which fails with `fault:<hook>` and keeps its
    previous revision while the hook is spent for every later ID — and
    every other ID still succeeds; `results` here names **every** ID, in
    `--id`'s order; `STATUS.md` is regenerated once, after every ID's
    write phase has finished, provided at least one ID was actually
    written. Exit 0 only when every ID succeeded, 1 otherwise. Each
    `results` entry is the single-write § 9/§ 12a shape for its command
    plus `id` when it succeeded, or `{id, ok: false, error, hint?}` when it
    failed. A single `--id=A` (no comma) is unaffected and keeps today's
    unwrapped shape.

32. **MCP tool surface.** `nj-mcp`'s `tools/list` names exactly `list`,
    `show`, `find`, `tree`, `new`, `set`, `note`, `check`, `claim`,
    `release`, `next`, `log`, `archive`, `unarchive`, `doctor`; `rm` is
    never present; `doctor --fix` is present only when the server was
    launched with `--allow-destructive`, absent otherwise.
33. **Result fidelity.** For every exposed tool, a `tools/call` result's
    content is byte-identical to `dist/nj --json`'s own output for the
    equivalent CLI invocation against the same fixture — success and
    failure alike, including `isError` reflecting exit 1/2 and the
    untouched `{ok, error, hint?}` body on failure.
34. **Backlog resolution and confinement.** `nj-mcp` resolves its backlog
    at startup by the same rules as the CLI (§ 4), serves only that
    backlog for its whole life, and takes no per-call backlog override.
    Every spawned `dist/nj` child is given `--backlog=<that resolved
    path>` explicitly. No generated tool schema names a `backlog` field.
35. **Batch and acting-name parity.** A tool call with a comma-joined `id`
    produces the same `{ok, results}` wrapper a CLI batch write would; an
    `as` parameter on `note`/`claim`/`release`/`next` outranks the
    server's own `NJ_AUTHOR`, validated exactly as `--as` is (DECISIONS
    119), exactly as `--as` outranks it on the CLI.
36. **CLI behaviour is unchanged by moving its parser onto the shared
    flag table § 17's schemas are also generated from.** Replayed against
    `c7-baseline`, the CLI produces byte-identical output, call for call,
    before and after the move — proven by the existing replay gate, not
    a new mechanism.
37. **Dual-era protocol handshake.** `server/discover` returns a
    `DiscoverResult` naming `supportedVersions: ["2026-07-28",
    "2025-11-25"]` and `capabilities: {tools: {}}`; `initialize`'s
    response declares `2025-11-25` and the same `capabilities` object. A
    request on the modern path naming an unsupported version gets
    `UnsupportedProtocolVersionError` (`-32022`) listing both supported
    versions. A malformed `tools/call` argument (fails the tool's own
    schema) is rejected `-32602` before any `dist/nj` child is spawned; a
    schema-valid call the CLI itself then rejects surfaces as a tool
    result, `isError: true`, the unmodified `{ok, error, hint?}` body
    (never `-32602`). An unknown method, in either era, is `-32601`.
38. **`dist/nj-mcp` ships with zero runtime dependencies, mirroring
    AC-15.** Copied alone into a bare directory with no `node_modules`,
    `dist/nj-mcp` starts and completes both an `initialize`/`tools/list`
    round trip (legacy) and a `server/discover`/`tools/list` round trip
    (modern).
39. **`--version`.** `nj --version` prints `nj <version>` and exits 0,
    with no backlog resolved and no file read but `nj`'s own — confirmed
    by running it in an empty directory with no `.njrc` anywhere above
    it and `NJ_BACKLOG` unset. `nj --version --json` prints exactly
    `{"version": "<version>"}`. `nj-mcp --version` behaves identically
    for `nj-mcp`, and reports the same version `nj --version` does — the
    one `package.json` source embedded into both at build time; the same
    value is what `nj-mcp`'s `server/discover`/`initialize` responses
    declare as `serverInfo`'s version. `--version` combined with any
    other flag or an explicit subcommand is `unknown_field`.
40. **`nj next`.** Given `N` **leaf** `--ready` elements and `M`
    concurrent `nj next --as=<distinct name each>` calls with `M <= N`,
    every call exits 0 and claims a distinct element; with `M > N`,
    exactly `N` calls succeed and the rest exit 1 `none_ready`. A single
    `nj next --as=a` claims the highest-priority, lowest-`id` `--ready`
    element among the leaves — the same order `list --ready`/bare `nj`
    print, narrowed to exclude any `--ready` element with an open child
    (DECISIONS 156): an epic with an open task is skipped in favour of
    that task (or whatever else qualifies); a childless epic, and an
    epic whose children are all `done` or archived, remain candidates;
    an archived child never counts as open; the same holds for a task
    with an open subtask. `--type`, `--tag`, `--parent` and `--assignee`
    narrow the candidate set exactly as they narrow `list --ready`'s,
    applied after the leaf-work rule, including `--type=epic`. An
    element already claimed by the acting name is itself `--ready`
    (§ 9 condition 5) and a valid, re-assertable candidate — `next
    --as=a` on a backlog where `a` already holds the top candidate
    re-asserts it, exit 0, `changed` empty unless `--status` changes
    the status. `--status=<s>` claims and sets status in the one write,
    exactly as on `claim`; omitted, status is untouched. No acting name
    is `missing_argument`. Nothing `--ready` at all, or every candidate
    losing its race, is `none_ready`, exit 1, `{ok: false, error,
    hint?}` — no extra field. A successful claim's
    result is `claim`'s own shape plus `skipped`, the ids raced away
    before it, in attempt order, always present (`[]` when none). An
    element that becomes unreadable, archived, or turns out to be a
    `duplicate_id` after being read as `--ready` but before `next`
    reaches it is surfaced as that failure, not silently skipped — only
    `refused:claimed` advances to the next candidate. `--id=A,B,C` and
    `--file` are not accepted. A failed mirror write on the winning claim
    rolls back exactly as a plain `claim`'s would (§ 12a).
41. **`nj log`.** For an element with a `created` timestamp, N claim
    generations and M notes, `nj log --id=…` returns exactly N+M+1
    events merged by `at` ascending, each `kind` one of `created |
    claimed | reasserted | stolen | released | note`: a plain claim
    after `unclaimed`/`released` is `claimed`; the same name claiming
    again is `reasserted`; a different name landing via `--steal` is
    `stolen`; `release` is `released`; each note line is one `note`
    event with its own actor and text. No write command's output or
    bytes change — replayed against a pre-`log` baseline, nothing
    differs. Two events sharing one timestamp (a fixed `NJ_NOW`) sort
    `created`, then claims in generation order, then notes in document
    order, every time. `--id` naming a duplicate is `duplicate_id`;
    `--file=<path>` disambiguates it, the same as a write's escape
    hatch, even though `log` writes nothing; `--id` naming nothing is
    `not_found`, matching `show`. `log` reads an archived element same
    as `show` does; its claim events are gone because `archive` already
    deletes the claims directory, leaving only `created` and notes. A
    fresh clone with no local claims shows `created` and notes only,
    never claim events, because `.nanojira/claims/` is git-ignored
    (§ 12a) — a field-level change (`status`, `priority`, …) is not
    shown at all, by design, and the spec states both limits plainly.
    An unreadable stub addressed directly is `refused:unreadable`.
42. **Global flags before the command word.** `nj --backlog=<path> list`
    and `nj --json list --backlog=<path>` both run `list`, byte-identical
    to the same call with `--backlog`/`--json` placed after `list`; so
    does any other order or repetition of just those two flags ahead of
    the command word. `nj --backlog=<path> show --id=X` runs `show
    --id=X` against that backlog, not `unknown_field` for `--id`. A flag
    other than `--backlog`/`--json` ahead of the command word — including
    one valid for the command that follows, e.g. `nj --status=doing set
    --id=X` — is `unknown_field` against the bare command's own known
    flags (`--backlog`, `--json`), the whole input parsed as the bare
    invocation; the command word that followed is never run and never
    silently substituted for. `nj --backlog=X` alone (every token a
    recognised global flag) is bare `nj` against that backlog, unchanged.
    `nj --version --backlog=X` and `nj --backlog=X --version` are each
    still `unknown_field` for `--version` (DECISIONS 151/152), in either
    order.
43. **Multi-line notes.** `nj note --id=X "$(printf 'one\ntwo\n\nfour')"`
    writes `- <ts> <author>: one` followed by three more lines —
    `  two`, a line that is exactly two spaces, and `  four` — each
    indented exactly two spaces; `\r\n` and lone `\r` in the given text
    normalise to `\n` first, the same as every other write path. `nj log
    --id=X --json`'s matching event's `text` is exactly `"one\ntwo\n\nfour"`
    — continuation lines rejoined, indent stripped, the blank line
    restored empty; its human line prints `one`, then `two`, a blank
    line, then `four`, each of the continuation lines indented the same
    two spaces the file stores. `nj check` never matches a checkbox-shaped
    continuation line (`## Notes` is out of its scope entirely, § 10a,
    independent of indentation); `nj find` still matches a substring
    anywhere in the note's text, continuation lines included, as plain
    body text. A hand-added line directly below a note that is neither
    empty nor two-space-indented ends that note's continuation and is
    itself silently skipped if it doesn't start a fresh note (DECISIONS
    155), never merged into the note above it. `--as`/`NJ_AUTHOR` reject
    a multi-line acting name exactly as before — unaffected by any of
    this, since it governs the name, not the note text.
44. **`nj next` respects an existing `assignee`.** A `--ready`, leaf
    element with `assignee` set to a name other than the acting name is
    never a candidate: given TSK-001 (`assignee: bob`) and TSK-002
    (unassigned), both otherwise equally ranked, `nj next --as=alice`
    claims TSK-002, skipping TSK-001 entirely (not even in `skipped`,
    since it was never a candidate to begin with — the same way an
    element claimed by someone else never appears as a `next` candidate
    either). `nj next --as=bob` (matching TSK-001's own `assignee`)
    claims TSK-001. The comparison is exact, byte-for-byte — `Bob` does
    not match `bob`, and an `assignee` with incidental whitespace matches
    nothing. `--assignee=` (empty) narrows to unassigned candidates only;
    `--assignee=<the acting name>` narrows to candidates already assigned
    to the acting name; `--assignee=<anyone else>` always yields
    `none_ready` (the filter and the default can never both be satisfied
    by the same candidate unless the two names are the same). `list
    --ready` is unchanged by any of this — confirmed by a fixture where
    `list --ready` still shows an element assigned to someone else, while
    `next --as=<a different name>` does not offer it.
45. **Bare `nj`'s "Ready to work" applies the leaf rule, `list --ready`
    does not.** Given an epic whose only child is open (not `done`, not
    archived) and otherwise `--ready`, bare `nj` omits the epic from
    "Ready to work" (the child appears instead, if it is itself `--ready`)
    while `nj list --ready` still names the epic — the same backlog,
    two different, both-correct answers, confirmed in one fixture rather
    than inferred. An epic with no children, or whose children are all
    `done`/archived, appears in both. This is the named, accepted replay
    class DECISIONS 158 records: a bare-status call on a backlog
    containing such a container differs from a pre-v3.6 baseline by
    construction.
46. **Per-command `--help`.** `nj new --help` prints `new`'s own synopsis
    and flags, not the general command list; `nj --help`/`nj help` (no
    command word) are unchanged. `--type`'s and `--priority`'s allowed
    values are always `epic|task|subtask` and `low|normal|high|urgent`;
    `--status`'s are the resolved backlog's own configured `statuses`
    when one resolves cleanly, else the default list — confirmed by one
    fixture with a non-default `statuses` list showing those exact
    values in `nj set --help`, and one with no backlog at all (an empty
    directory) still succeeding with the defaults, never `no_backlog`.
    `--json` makes no difference to `--help`'s output, on any command.
    This already answers PA-2 too: `new`/`set`'s existing prose already
    names every open `incomplete:*` code after a write, unchanged by
    this round (confirmed, not assumed). `nj rm --help` (DECISIONS 163 A)
    gets the same per-flag lines (`--id`, `--file`, `--cascade`) — it had
    none before, only because `rm` is never an `nj-mcp` tool and so had
    never been added to the shared flag table; that table entry answers
    only this question, and does not make `rm` an `nj-mcp` tool.
47. **Did-you-mean.** `--priority=medium` is still `invalid_value`, its
    hint now `did you mean 'normal'? Known priorities: …` (the fixed
    synonym, checked first). A `--status`/`--type`/`--priority` value
    within the length-dependent threshold (OSA distance ≤ 1 for a ≤
    4-character value, ≤ 2 otherwise — DECISIONS 160; OSA counts an
    adjacent transposition as one edit, so `hgih`→`high` and `tsak`→
    `task` are distance 1, not 2) of exactly one allowed value gets the
    same treatment; a value equidistant from two allowed values, or
    further than the threshold from all of them, gets the unchanged hint
    with no suggestion — confirmed with a constructed tie case, not
    merely a documented intention. `--status=nope` (4 characters,
    distance 2 from `done` — no transposition applies) gets no
    suggestion, where the old flat ≤ 2 rule would have hinted one. No
    alias is ever accepted
    as the value itself: `nj set --priority=medium` still fails, exactly
    as before.
48. **`nj set --add-tags` / `--remove-tags`.** An incremental alternative
    to `--tags=`, for `set` only: `--remove-tags` takes effect first,
    then `--add-tags` appends anything named there not already present,
    in its own order, after whatever tags were not removed (their
    relative order kept). Adding a present tag, or removing an absent
    one, is a no-op for that tag, not an error. Combined with `--tags=`
    in the same call is `invalid_value`, nothing written, in every
    combination. Both work in batch (`--id=A,B,C`), each ID's own `tags`
    read and changed independently. Each tag is validated the same as
    `--tags`'s own items. `nj-mcp`'s `set` tool schema gains both fields.
49. **Acceptance quality warnings.** Two new, never-blocking problem codes
    (task/subtask, **live** elements only — DECISIONS 167): `acceptance:
    no_checkbox` when the acceptance section has content but zero
    countable checkbox lines within its own span; `done:no_acceptance`
    when `status` is `done` and the acceptance section is absent/empty
    (alongside `incomplete:acceptance`, which still fires too —
    independent axes). An **archived** element never carries either
    code, whatever its acceptance holds — an archived element is
    history, and nobody can act on a warning about it. Both are
    `doctor` warnings (exit code unaffected) and appear in
    `new`/`set`/`note`/`check`'s own text feedback, the same place
    `incomplete:*` already does. Neither changes `--ready`, `list`, or
    any count — confirmed against the two outside teams' real backlogs
    (read-only, re-confirmed with the archived exemption applied —
    neither backlog actually has any archived elements today, so the
    counts are unchanged): 0/5 new E/F warnings for team-a's 54
    elements, 10/287 for team-b-app-test's 960, with no
    existing behaviour changed for either.
50. **`problems.ignore`.** An optional `"problems": {"ignore": [...]}`
    config block lists warning-severity codes (§ 7) to suppress from
    `doctor`, `_problems`, write feedback and `doctor`'s own warning
    tally — everywhere a code is reported, but never the readiness
    computation itself: an ignored `unknown:status` still keeps its
    element out of `--ready`, only the reporting goes quiet. A known
    error code, or an `incomplete:*` code, is `invalid_config`; a code
    outside § 7's closed vocabulary is instead the warning
    `config:unknown_code` and is skipped (DECISIONS 166 amends this one
    sub-case). Default (key or block absent): empty, nothing suppressed.
    Answers v3.5's own `backlog:claims_unignored` friction (a warning, so
    eligible). Re-counted with `done:no_acceptance` ignored:
    team-b-app-test's 287 drop to 0, its 10
    `acceptance:no_checkbox` unaffected.
51. **Config forward compatibility.** An unrecognised top-level config
    key, or one inside `layout`/`layout.folders`/`claims`/`problems`, is
    now the warning `config:unknown_key` (`doctor` reports it, naming the
    key) instead of `invalid_config` — every command still succeeds. The
    correction behind this: an older `nj` was assumed to reject an
    unrecognised top-level key; confirmed live (3.5.0, 3.6.0) that it is
    silently ignored instead, so `problems`/the new `minVersion` key are
    both safe additions for a fleet not yet fully upgraded — a *nested*
    unknown key stays a hard failure on any `nj` older than this
    revision, since an already-shipped binary cannot retroactively learn
    the new rule. `minVersion: "X.Y.Z"` (three dot-separated integers; a
    different shape is `invalid_config`) makes every command, including
    `doctor`, fail with `needs_newer_nj` (naming both versions) when the
    running `nj` compares older, checked before any other validation;
    `--version` and `--help` are unaffected, structurally, not as a
    special case (neither resolves/depends on config the way every other
    command does).
52. **Final status releases the claim.** A write that sets `status` to
    the last configured status (always `done`, § 5) via `nj set`,
    `nj claim --status=<last>`, or `nj next --status=<last>` releases the
    element's existing claim, whoever holds it, in the same call —
    reported additively as `released: "<holder>"`, absent when there was
    none to release. Unconditional: not `nj release`'s own ownership
    check, since this is a side effect of reaching `done`, not an act of
    giving a claim up. A refused `set --status=done` (`children_open`,
    without `--allow-open-children`) releases nothing; a forced one does.
    The release is attempted before the guarded write and rolled back if
    that write fails, the same order and rollback discipline `nj claim`'s
    own mirror write already has.
53. **`show --json` carries `entry`.** Additive: identical to
    `entries[0]`, present exactly when `entries` has one element — never
    for a `duplicate_id` target (two entries) or, in principle, none.
    `list`/`find` never carry it.
54. **`--input` — JSON plans for `new`/`set`.** `--input=<file|->` takes a
    JSON object (keys = exactly the command's own flag names) — or, for
    `new` only, an array, and `children` nesting with `parent` implied.
    Mutually exclusive with field flags. `set` never takes an array: one
    object, addressing stays on the CLI. A `ref` (always `@`-prefixed; a
    bare name or a decorated real id is `invalid_value`) lets `depends_on`
    target a same-plan sibling **declared earlier in write order** — a
    forward or self reference is `invalid_value`, `failed_at` naming the
    referencing object (DECISIONS 173); `parent` is never `ref`-aware
    (`"parent": "@x"` is `invalid_value`, use `children` nesting instead).
    The whole plan validates before the first write; write order and id
    order are both depth-first pre-order. A mid-plan failure names `created`, `refs`
    resolved so far, and `failed_at` (a `ref` or a JSON path) — the one
    documented exception to every other failure shape's `{ok, error,
    hint}`. Success is the existing single shape for one object, a new
    `{ok, ids, entries, refs}` otherwise. `acceptance` may be a JSON array
    of strings, one `- [ ] …` line each, so `acceptance:no_checkbox`
    cannot happen through `--input`. `--dry-run` (`new` only, requires
    `--input`) validates and reports the would-be shape, writing nothing.
55. **`nj set --parent=<id>` reparents a task or subtask.** The id, body
    and claim log (keyed by id, § 12 "Claims") are unchanged; the type
    never changes. The new parent must exist, be live and be the correct
    type — the error codes **mirror `new`'s own `--parent` validation**:
    missing is `not_found`, wrong-type is `invalid_target`, archived is
    `refused:parent_archived`, given to an epic at all is `invalid_value`
    (DECISIONS 177, correcting D176's original "uniform `invalid_value`"
    ruling); nothing is written in any of these cases. `nj
    set --parent=<old>` restores the previous state exactly — same file
    location, same frontmatter apart from `updated` — there is no
    separate `nj undo` command (DECISIONS 177 corrects D176's mistaken
    mention of one). Under `hierarchy` the file (subtask) or whole folder
    (task) relocates to the new parent in the same write that changes
    `parent`; under `type`/`flat` only the frontmatter changes. `--input
    set` accepts `parent` as one more settable field.
56. **`done:open_acceptance` (G).** A third, never-blocking acceptance
    warning (DECISIONS 176 B, feedback/team-c TSK-001): a live
    task/subtask that is `done` with at least one unticked countable
    checkbox in its Acceptance Criteria section. Mutually exclusive with
    `acceptance:no_checkbox` (E, zero checkboxes) and `done:no_acceptance`
    (F, section absent/empty) by construction — each requires a
    different checkbox count to exist. Archived elements never carry it,
    same as E/F. `doctor` and `new`/`set`/`note`/`check`'s own prose name
    the count (`"1 of 3 acceptance boxes still unticked"`); `set`/`claim`
    additionally carry it in their own `--json` result as
    `open_acceptance?: {unticked, total}`, present exactly when a write
    naming `--status=<last>` in that call leaves it on the element, the
    same "elaborate a `_problems` code" precedent `rm`'s own `dependents`
    field already set. `problems.ignore` silences the code **and** this
    additive field together.
57. **`nj doctor --fix` releases every claim on a final-status element**
    (DECISIONS 182 A, feedback/team-a: 32 `claim:stale` elements,
    pre-v3.8 `done`, forced to release-as-each-holder by hand). Step 7b
    (§ 14) — live or archived, whoever holds it: the same unconditional
    release `set`/`claim --status=<last>` already perform in one call
    (item 52 above, § 12a), applied in bulk for elements that reached the
    final status some other way and were left claimed. Same claim-log
    entry (`released <holder>`, next generation), the element's own file
    untouched either way. Claims on elements **not** in the final status
    are never touched by `--fix` — stale or not, the holder or `--steal`
    still decides. Plain `doctor` (no `--fix`) is unaffected: it keeps
    reporting `claim:stale`/`claim:mismatch`/`claim:orphaned` exactly as
    before, never releases anything itself. Named in `fixed[]`, one line
    per element, naming the id and the released holder. Idempotent: a
    second `--fix` releases nothing (nothing left to release).
58. **The repo is the skill folder** (DECISIONS 185, 187, § 18).
    `SKILL.md` (at the repo root, moved from `skill/`), `bin/`
    (`bin/{nj,nj-mcp}`, `bin/{nj,nj-mcp}.cmd`) and `dist/`
    (`dist/{nj,nj-mcp}.mjs`) are committed build output, alongside
    `src/` and `test/` — there is no `VERSION` file; the version lives
    in `SKILL.md`'s `metadata.version` and `nj --version`, checked
    equal to `package.json`'s own `version` directly. `bin/{nj,nj-mcp}`
    and `bin/{nj,nj-mcp}.cmd` are rendered by `tools/bundle.js` from
    `tools/wrapper.sh`/`tools/wrapper.cmd`, each carrying a "Generated
    by `tools/bundle.js` — do not edit" header; `bundle.js --check`
    fails if any of the four differs from a fresh render, or if
    `SKILL.md`'s frontmatter is missing a required field, its
    `description` exceeds 1024 characters, or its `metadata.version`
    disagrees with `package.json`. No symlinks anywhere, so the whole
    tree (or an exported folder, below) may be `cp -R`'d elsewhere and
    keeps working from the copy. Each `bin/` wrapper resolves its own
    location with a plain `dirname "$0"`, never following a symlink,
    honours `NJ_NODE`, requires Node.js ≥ 24, unsets `NODE_OPTIONS`, and
    on any startup failure exits 127 with exactly one stderr line,
    prefixed `nj:`/`nj-mcp:`, naming the cause in words ("node not
    found", or "node too old (requires Node.js >= 24)"). The bundle is
    ESM (addendum 9b3d0de: `dist/nj.mjs`/`dist/nj-mcp.mjs`, replacing
    the earlier extensionless CommonJS entirely; the build rejects any
    import but `node:*` built-ins). `nj-mcp` still finds its
    `dist/nj.mjs` sibling under this layout, unaffected by an ambient
    `"type": "module"` wherever `bin/` sits. `node
    tools/export-skill.mts <tag> <dest>` (TypeScript, run directly — no
    build step, no shell; git invoked via `execFileSync`) now only
    copies `SKILL.md`, `bin/` and `dist/` from `<tag>`'s own tree
    (never the working tree, never `src/`/`test/`/`tools/`), after
    verifying `<tag>` with `git tag -v` (refusing an unsigned or
    non-existent tag); builds beside `<dest>` and renames atomically
    into place; refuses to replace a `<dest>` that lacks its own valid
    `SKILL.md`.

---

## 16. Not in Round One

Terminal board (`nj board`), Obsidian Dataview snippet, import/export of
foreign backlogs, attachments, the search index's implementation (§ 13),
Windows.

A language migration (Go as the candidate; Rust considered and set aside) is
deliberately deferred: round one ships on Node to gather real experience. The
oracle in `test/` is black-box (CLI + exit codes only), so a later rewrite
would keep the entire test suite; only § 3 would change. Revisit only with
measured problems, not on principle.

All of them can be added later without rework: the parser preserves the
unknown, the problem vocabulary only grows, and the data model is additively
extensible.

---

## 17. MCP Interface

`dist/nj-mcp` is a second, separate entry point (§ 3) that exposes `nj`'s
existing commands as MCP tools over stdio, for an MCP-speaking agent that
would otherwise shell out to `dist/nj` and parse `--json` by hand. It
consumes the CLI's own contract (§ 9); it does not extend it. No existing
command, flag, JSON shape or exit code changes meaning anywhere in this
document.

### Shape and backlog confinement

```
dist/nj-mcp [--backlog=<path>] [--allow-destructive]
dist/nj-mcp --version
```

**`nj-mcp --version`** follows the same rule § 9 states for `nj
--version`: prints `nj-mcp <version>`, exit 0, no backlog resolved, works
anywhere, and the version is the identical `package.json` value `nj
--version` reports — the two binaries never drift apart because both
embed the same one source at build time. The `serverInfo`/`initialize`
version this server declares over MCP (below) is the same value again,
not a separately maintained string.

**Startup arguments are validated strictly, before any protocol traffic**
(D152): the known ones are `--backlog=<path>`, `--allow-destructive` and
`--version`. Anything else — an unknown flag, a typo'd one
(`--allow-destrutive`) — or `--version` together with any other argument
at all (`nj-mcp` has no `--json` to pair it with, so even that combination
is rejected) is an error: exit 1, exactly one line on stderr naming the
offending argument and the known ones, nothing on stdout. This is the same
"a typo must not pass" discipline `nj`'s own argument parsing already
holds (§ 9) — `nj-mcp` silently ignoring an unknown or misspelled startup
flag would otherwise start in a state the caller never asked for (e.g.
without `--allow-destructive` despite typing it).

`nj-mcp` resolves its backlog exactly once, at startup, by the same rules
as every command (§ 4: `--backlog`, then `NJ_BACKLOG`, then the nearest
`.njrc`, then a `backlog/` folder, searched upward from the process's
cwd) and serves **that one backlog** for the life of the process. There
is no per-call backlog override on any tool.

Confinement is mechanical, not incidental: **every `dist/nj` child
`nj-mcp` spawns is given `--backlog=<the server's own resolved path>`
explicitly** — the one flag that already stops § 4's search before it
starts — rather than inheriting `nj-mcp`'s cwd/environment and
re-running that search itself. A child that re-resolved from scratch
could in principle land on a different backlog than the one `nj-mcp`
itself resolved, if anything in the search path changed in between; the
explicit flag removes that possibility entirely.

The MCP client spawns `nj-mcp` as a child process and communicates over
newline-delimited JSON-RPC on stdin/stdout, per the MCP stdio transport.
stdout carries protocol frames only — never human prose, never a startup
banner — the same purity § 9 already holds for `--json`'s stdout.

### Protocol: a dual-era server

`nj-mcp` speaks both eras the MCP specification defines, pinned to one
named revision on each side:

- **Modern** (`2026-07-28`): every request declares its protocol version
  in its own `_meta`; there is no session-wide handshake.
- **Legacy** (`2025-11-25`): the `initialize` handshake establishes the
  session once, scoped to the stdio process.

Era detection needs no separate step: a request (`server/discover`,
`tools/list`, `tools/call`) whose `_meta` carries
`io.modelcontextprotocol/protocolVersion` is modern; a literal
`initialize` request (no such `_meta` key) is legacy. A single running
`nj-mcp` process may answer requests of either shape across its
lifetime.

**Methods, in total:** `server/discover`, `initialize`, `tools/list`,
`tools/call`. Nothing else — no `resources/*`, `prompts/*`,
`completion/*`, `logging/*`.

- **`server/discover`** (mandatory on the modern/dual-era side) returns
  `{resultType: "complete", supportedVersions: ["2026-07-28",
  "2025-11-25"], capabilities: {tools: {}}, _meta:
  {"io.modelcontextprotocol/serverInfo": {name: "nj-mcp", version:
  "<nj-mcp's own version>"}}}`. This is what lets a dual-era client's own
  stdio backward-compatibility probe succeed against `nj-mcp` directly,
  rather than falling through an unknown-method error.
- **`initialize`** (legacy) responds declaring `2025-11-25`, the same
  `capabilities: {tools: {}}` object, and `serverInfo: {name: "nj-mcp",
  version: "<nj-mcp's own version>"}` — the identical field
  `server/discover` carries in its own `_meta`, same value, same source
  (§ 17 "Shape and backlog confinement" above). A version mismatch on the
  protocol revision is the client's decision: it sees the declared
  revision and disconnects if it cannot work with it; `nj-mcp` does not
  special-case a mismatch.
- **An unsupported version on the modern path** (a request whose `_meta`
  names a version other than `2026-07-28`) gets
  `UnsupportedProtocolVersionError`, JSON-RPC code **`-32022`**, `data:
  {supported: ["2026-07-28", "2025-11-25"], requested: "<the
  requested value>"}`.
- **Legacy notifications**, accepted and never answered:
  `notifications/initialized` (post-handshake, fire-and-forget; `nj-mcp`
  holds no session state that depends on it, since every tool call is
  already a fresh `dist/nj` process) and `notifications/cancelled`
  (a no-op — the spawned child is not killed mid-call; cancelling a
  write mid-flight is exactly the half-done state § 12's
  compare-before-write exists to prevent).
- **An unknown method, in either era** (anything outside the four named
  above), or a malformed JSON-RPC envelope, gets the standard JSON-RPC
  error: `-32601` ("Method not found") for an unknown method,
  `-32700`/`-32600` for a parse/invalid-request failure.
- **`-32602` (Invalid params) vs. a tool result with `isError`.** A
  `tools/call` whose `arguments` fail the tool's own declared JSON
  Schema (a required field missing, the wrong type) is rejected
  `-32602`, **before any `dist/nj` child is spawned** — this is
  structural malformation of the call itself, answered at the same
  protocol level `-32700`/`-32600` already answer for the envelope one
  level up. A call whose `arguments` **pass** schema validation but
  whose content the CLI itself then rejects (`invalid_value`,
  `refused:archived`, `not_found`, …) is never a protocol-level error —
  it is a normal tool result, `isError: true`, below.

### Tool surface

`tools/list` names exactly: `list`, `show`, `find`, `tree`, `new`, `set`,
`note`, `check`, `claim`, `release`, `next`, `log`, `archive`,
`unarchive`, `doctor`.

- **`rm` (including `--cascade`) is never present** — omitted
  unconditionally, not merely gated: a cascading, hard-to-undo-by-
  inspection deletion is not the kind of operation a tool call should
  reach for without the visible, deliberate CLI step a human can see in
  a terminal.
- **`archive`/`unarchive` are present, ungated**: both are reversible
  (§ 11a exists precisely because an archive is not a one-way door).
- **`doctor --fix` is present only when `nj-mcp` was launched with
  `--allow-destructive`**, absent from `tools/list` otherwise — the gate
  is schema-level: with the flag off, there is no schema entry a client
  could even construct a call against. The flag is a launch-time
  decision the operator's MCP client configuration makes; no tool call
  can toggle it.

**Input schemas** are generated from the same per-command flag table
`dist/nj`'s own argument parser validates against (§ 9) — the per-command
table only, never the separate table of global controls (`--backlog`,
`--json`, and the rest of § 9's control-flag list) a command's own flags
are checked against. **No generated tool schema names a `backlog`
field.** `--file`, where a command already has one, remains in that
tool's schema unchanged — it is already confined to the backlog by the
same addressing rule that confines it on the CLI (§ 9: `--file` resolves
only against already-scanned elements, never an arbitrary path).

**The acting name.** `note`, `claim`, `release` and `next` each take an
`as` input, defaulting to the server's own `NJ_AUTHOR` (from the
launching environment) when omitted — the same `--as`-outranks-`NJ_AUTHOR`
precedence § 9 "The acting name" already has, exposed per call instead
of per process. `as` is validated exactly as `--as` is (DECISIONS 119):
an invalid value is `invalid_value`, nothing written.

**Batch writes.** `--id=A,B,C` is a single string-typed `id` input,
accepting a comma-joined list exactly as the CLI does, never a JSON
array. The result shape is `{ok, results: […]}` exactly as a CLI batch
write already returns (§ 9 "Batch writes").

### Results and errors

A tool call's result **is** the object `dist/nj --json` already returns
for the equivalent CLI invocation, placed in the MCP result's
`structuredContent` field, with a JSON-stringified text block as the
accompanying human-readable fallback. Nothing is renamed, nothing is
re-shaped.

A command failure (`refused:claimed`, `invalid_value`, …) is an MCP tool
error, `isError: true`, carrying the **same** `{ok: false, error,
hint?}` body as content — the code is never lost, never folded into a
generic protocol-level message.

### Architecture

**One `dist/nj` process per tool call.** A tool call becomes exactly the
argument list the equivalent CLI invocation would have, plus the
explicit `--backlog` above, run as a child process with `--json`; its
parsed stdout becomes the tool result. This buys zero duplicated logic
(the result *is* `dist/nj --json`'s own output, because it is the same
binary), zero new concurrency model (every call goes through § 12's
compare-before-write and § 12a's claim CAS exactly as any other
concurrent CLI invocation already does), and contract fidelity by
construction. The per-call overhead this adds over a direct CLI
invocation is budgeted at p50 ≤ 50 ms, measured against `dist/nj
--json`'s own wall-clock time for the identical invocation.

**A missing sibling** (DECISIONS 185 addendum 9b3d0de: `nj-mcp.mjs`
looks for `nj.mjs` next to itself, unconditionally — no extension
detection, D179's own matching rule retired along with the extensionless
build it existed for) fails **fast, as a JSON-RPC protocol-level error**
on the specific `tools/call` that needed it (`-32603 Internal error`,
naming node's own "cannot find module" text), never a hang and never a
crash of the server process itself: node starting with a missing entry
point is not a spawn-level failure (the `node` binary itself still
exists and starts) but an ordinary non-zero exit with nothing on stdout,
handled by the same path an `nj` child's any other unparseable-stdout
exit already takes. The server keeps running and answers later calls
normally — only the one call that needed the missing sibling fails.

### What is out of scope

MCP resources and prompts (only tools); any transport but stdio (no
HTTP/SSE — this project's trust model, § 6's "names are labels, not
identities" and § 9's "no registry, no authentication," was never built
for a network-reachable, multi-tenant transport); authentication (the
process that spawns `nj-mcp` is the trust boundary, exactly as it already
is for the plain CLI).

## 18. Packaging: the repo is the skill folder

(v3.12, DECISIONS 187, following `agent-skills`' own Node-skill
convention, `write-node-skills`/`git-merge-branches`.) v3.11 (DECISIONS
185, addenda 5f6529e, 9b3d0de, 85434d9) assembled a skill folder only at
*export* time, from a committed `skill/SKILL.md` plus wrapper templates
that existed only as strings inside `export-skill.mts`. From v3.12 the
repository root **is** the skill folder: `SKILL.md`, `bin/`, `dist/` live
there directly, alongside `src/` and `test/`, and `bin/`/`dist/` are
committed build output, generated and checked exactly like the rest of
the build. Exporting an accepted release is now a **shrink**, not an
assembly: `node tools/export-skill.mts <tag> <dest>` copies `SKILL.md`,
`bin/` and `dist/` straight out of `<tag>`'s own tree, verbatim, and
contains no wrapper template of its own any more.

### The layout, at the repo root

```
SKILL.md
bin/nj
bin/nj-mcp
bin/nj.cmd
bin/nj-mcp.cmd
dist/nj.mjs
dist/nj-mcp.mjs
src/…
test/…
tools/…
```

**No symlinks anywhere in the tree, ever** — not written by the build,
and the wrapper itself never follows one into existence either (see
below). There is **no `VERSION` file**: the version lives in exactly two
places, `SKILL.md`'s own `metadata.version` and `nj --version`'s output
(both read from `package.json`'s `version`, § 9), and they are checked
equal directly. `bin/*` and `dist/*.mjs` are committed, generated files —
not hand-written, not per-export artefacts — so a diff against them is a
real diff, not an opaque binary swap.

### `bin/` is generated, not hand-written

`tools/bundle.js` renders `bin/nj`, `bin/nj-mcp`, `bin/nj.cmd` and
`bin/nj-mcp.cmd` from two template files, `tools/wrapper.sh` and
`tools/wrapper.cmd` — one template each, parameterised only by the
generated file's own name (so `bin/nj` and `bin/nj-mcp` share identical
logic, and so do the two `.cmd` siblings). Every generated file carries a
header naming its own origin — **"Generated by `tools/bundle.js` — do
not edit."** — the same discipline `export-skill.mts`'s DECISIONS 185
wrapper strings could not offer, since a string embedded in a `.mts` file
cannot itself be diffed or hand-edited by mistake the way a committed
`bin/nj` now can be (and now is checked for, below). `tools/bundle.js
--check` fails if any of the four generated files differs from a fresh
render of its template, or is not executable where it must be (`bin/nj`,
`bin/nj-mcp`) — catching a hand-edit to a generated file the same way it
already catches a stale `dist/*.mjs`.

### The build also checks `SKILL.md`

Matching `write-node-skills/scripts/build.mjs`'s own rule for every Node
skill under `agent-skills`: `tools/bundle.js` (plain, not only
`--check`) fails the build if `SKILL.md`'s frontmatter is missing `name`,
`description`, `license` or `metadata.version`; if `description` is over
1024 characters (the field a skill-discovery system reads without
opening the file); or if `metadata.version` does not equal
`package.json`'s own `version` string, compared directly, never "close"
or "compatible" — a skill whose own declared version disagreed with the
binary inside it would be self-contradictory. `package.json` carries
`"engines": {"node": ">=24"}`, the same floor the wrapper enforces below,
stated where tooling already looks for it.

### The export shrinks: a copy, not an assembly

`export-skill.mts` resolves the git repository from its **current
working directory** (`git rev-parse --show-toplevel`, not from the
script's own path) — any repo laid out like this one works, which is
what makes the tool testable against a throwaway fixture repo without
touching this project's own history. Given `<tag>`:

1. **Verify the tag** with `git tag -v <tag>`. A tag that does not exist,
   or exists but is not a valid signed tag object (lightweight, or
   annotated but unsigned), fails this step — exits non-zero, one
   stderr line naming the tag and git's own reason, and touches `<dest>`
   not at all.
2. **Read `SKILL.md`, `bin/` and `dist/` from the tag's tree** (`git show
   <tag>:<path>`), never from the working tree — a dirty or
   out-of-sync checkout must not change what gets exported, and must
   not need to. Nothing else is copied: no `src/`, no `test/`, no
   `tools/`, no `package.json` — the exported folder is exactly
   `SKILL.md` + `bin/` + `dist/`, the same three things the repo itself
   now carries at its root.
3. **Build atomically.** Write the folder at a temporary path beside
   `<dest>` (same parent directory, so the final step is a same-
   filesystem rename) and rename it into place as the last step — there
   is never a half-written `<dest>`.
4. **Refuse a foreign `<dest>`.** If `<dest>` already exists, it is only
   replaced when it itself contains a `SKILL.md` file whose frontmatter
   parses (i.e. it is already an export of this same tool — there being
   no `VERSION` file any more to check instead) — anything else (an
   unrelated directory happening to sit at that path) is refused
   untouched, exit non-zero, one stderr line. An existing valid export
   is replaced wholesale, not merged: no file from a previous version's
   folder survives into the new one.

### The wrapper (`bin/nj`, `bin/nj-mcp`)

One template, parameterised only by its own filename (so both binaries
share identical logic):

- it resolves its own location via a plain `dirname "$0"` and is
  `CDPATH`-safe — **it does not follow symlinks**: since neither the
  repo nor an exported folder ever contains one (above), there is
  nothing to resolve, and a caller who does place a symlink elsewhere
  pointing in at `bin/nj` is outside this contract (`cp -R` the folder
  instead, which does keep working, unlike a symlink to one file
  inside it);
- `NJ_NODE`, if set, names the node binary to run; otherwise `node` from
  `PATH`;
- it confirms that binary exists (`command -v`) and runs `<node>
  --version`, parsing the major version number out of the printed
  `vX.Y.Z` string — a plain text check, no JS evaluated inside the
  probe — refusing anything below **Node.js 24** (§ 3 — the one
  runtime floor this project already states; unaffected by
  `workspace/bin/`'s removal, since it was never *where* the floor came
  from) the same way a missing binary is refused;
- it **unsets `NODE_OPTIONS`** before exec'ing node, so a caller's own
  `NODE_OPTIONS` (e.g. `--require`) cannot load foreign code into the
  tool;
- on any of the above failing, it **exits 127 with exactly one line on
  stderr**, prefixed `nj:` (`bin/nj`) or `nj-mcp:` (`bin/nj-mcp`) — the
  same `<name>: <reason>` convention `nj`'s own CLI already uses (§ 4,
  § 17) — naming the cause in words, not only by exit code:
  - the binary not existing: `` `<name>: node not found (looked for
    '<NJ_NODE or "node">')` ``;
  - a binary that exists but fails the version check: `` `<name>: node
    too old (requires Node.js >= 24)` ``;
  - the (in principle, though every shipped export has it) missing
    `../dist/<name>.mjs` entry: names that path directly.

  Nothing else is written anywhere;
- otherwise it execs `node <dir>/../dist/<name>.mjs "$@"`, where `<dir>`
  is wherever `bin/` itself resolved to — the repo root or an exported
  folder's root, identically — the sibling lookup an invoked `nj-mcp`
  itself performs internally (its own extension-matching rule, unchanged
  in spirit from D179, now matching `.mjs`) still resolves `dist/nj.mjs`
  correctly, since both `.mjs` bundles ship side by side in the same
  `dist/` directory regardless of where `bin/` sits.
- `bin/nj.cmd`/`bin/nj-mcp.cmd` provide the same behaviour for Windows'
  `cmd.exe`, to the extent its own scripting lets them: `NJ_NODE` or
  `node` from `PATH`, the same `dist/<name>.mjs` entry, the same exit
  127 on failure to start.

An ambient `package.json` with `"type": "module"` (or no `type` at all,
which defaults to CommonJS) wherever `bin/` sits — the repo root's own
`package.json` included — has no effect on any of this: `dist/*.mjs`'s
extension already fixes its module type as ESM unambiguously regardless
of any ambient `type` field, exactly as `.cjs` previously fixed it as
CommonJS unambiguously (D178/D179) — and the wrapper never asks node to
resolve an extensionless file either way.

A known limitation, not a defect: `bin/nj`/`bin/nj-mcp` is itself a
POSIX shell script, so invoking it from a working directory whose own
`getcwd()` fails (e.g. an ancestor directory that is unsearchable, or a
cwd removed out from under the process) makes `/bin/sh`'s own startup
print its own, unrelated line to stderr (typically along the lines of
`sh: shell-init: error retrieving current directory: ...`) *before* the
wrapper's exec'd `node <dist/<name>.mjs>` ever runs — invoking
`dist/<name>.mjs` directly (via `node`, skipping the shell entirely)
does not have this line, since node itself never prints it. Either way
the exit code and nj's own stderr line (always the *last* line) are
unaffected; only the "exactly one stderr line" shape some of this
specification's own hardening checks describe is, in this one
cwd-is-gone class of case, true of `dist/<name>.mjs` run directly but
not guaranteed of `bin/<name>` (D187 addendum, 81cd90a).

### The bundle is ESM, built only from `node:*` built-ins

(Addendum 9b3d0de.) `tools/bundle.js` writes `dist/nj.mjs` and
`dist/nj-mcp.mjs` — in the repo, not only in an export — replacing the
earlier extensionless CommonJS `dist/nj`/`dist/nj-mcp` entirely, old
tags' own `dist/nj` included (a frozen oracle replay against an old tag
keeps working by naming that tag's own `dist/nj` explicitly via
`--nj=<path>`; nothing about replaying an old tag changes). This
matches the convention the other `agent-skills` Node skills
already use (`dist/<name>.mjs`, esbuild, `node:*` imports only) and is
feasible because nothing under `src/` uses `__dirname`, `__filename`,
`require` or `module.exports`, and `nj-mcp` depends on no SDK that
would need a CommonJS-only import. The build step itself additionally
rejects (fails the build) any import other than a `node:*` built-in —
nothing from `node_modules` ships in the bundle, enforced at build
time, not merely by convention.

### `SKILL.md`

Lives at the repo root (moved from `skill/SKILL.md`, v3.11), the
committed source the export copies verbatim (never generated, never
edited post-export) — checked by `tools/bundle.js` itself (above), not
only by the AC. Frontmatter: `name`, `description` (≤ 1024 characters —
the field a skill-discovery system reads without opening the file),
`license`, `metadata.version`. **`metadata.version` must equal
`package.json`'s own `version`** — checked directly (not merely "close"
or "compatible"), since `nj --version` carries that exact same string
and a skill whose own declared version disagreed with the binary inside
it would be self-contradictory (there being no separate `VERSION` file
any more to also agree with). Body: when to use `nj` and when not to,
how to invoke it (`sh <skill>/bin/nj …`, always with `--json`), the
rules an agent follows while using it, the exit/error-code vocabulary
(§ 9), and where to report a problem with `nj` itself (the project's
own feedback mechanism, not this consuming repo's own tracker). It stays
generic — no repo-specific tags, workflows or conventions; a consuming
team's own house rules belong in their own AGENTS.md or equivalent, same
as Team B's current hand-written skill already separates its
nj-specific usage notes from its repo-specific always-on rules.
