# nanojira — a guide for agents and humans

`nanojira` keeps a backlog of epics, tasks and subtasks as one Markdown file per
element, next to your code. This guide shows how to use it; the rules behind
every answer are in `docs/SPECIFICATION.md` (spec v3, current through
v3.9 — §§ 21–23 below), and where this guide and the spec differ, the
spec wins.

**Upgrading an existing backlog?** `nanojira` refuses to touch a v2 backlog
(`.nanojira.json`/`.ids/` at the top level) until you run the one
`doctor --fix` that migrates it — see `docs/MIGRATION-v3.md`. Upgrading
from an earlier v3 release (this guide already describes the latest):
`docs/CHANGES.md`.

This describes spec v3.9's end state. Most examples below were run directly
against `dist/nanojira.mjs`; output is shown as it is printed, with the
machine-specific path shortened to `…`.

```sh
alias nanojira="$PWD/dist/nanojira.mjs"       # or: <runtime-node> dist/nanojira.mjs  (§ 4)
```

---

## 1. Install

This repository **is** the skill folder (§ 18 of the spec) — `SKILL.md`,
`bin/` and `dist/` live at its root, committed, alongside `src/` and
`test/`. There is no separate, shared machine-wide install. A consuming
team vendors its own copy, exported from a signed tag:

```sh
$ node tools/export-skill.mts <signed-tag> <dest>
```

This reads `SKILL.md`, `bin/` and `dist/` from `<signed-tag>`'s own tree —
never the working tree, and nothing else (no `src/`, `test/`, `tools/` or
`package.json`) — and writes `<dest>/` as one atomic unit:

```
<dest>/
  SKILL.md
  bin/nanojira         bin/nanojira-mcp         (sh launchers)
  bin/nanojira.cmd     bin/nanojira-mcp.cmd     (Windows launchers)
  dist/nanojira.mjs    dist/nanojira-mcp.mjs    (the bundles)
```

**No symlinks anywhere in this folder, and none pointing into or out of
it.** To move or share it, `cp -R` the whole folder — it keeps working from
the copy, since nothing in it depends on where it sits. There is no
`VERSION` file: the version lives in `SKILL.md`'s own `metadata.version`
and in `nanojira --version`, both read from `package.json` at build time and
checked equal to it directly.

- Working directly in this repo (no export needed): run `bin/nanojira init`
  once (§ 2) to create a project's `backlog/`.
- Per project, if the project uses `nanojira-mcp`: add one `nanojira-mcp` entry to
  that project's MCP client config, pointed at `<dest>/bin/nanojira-mcp` (or
  this repo's own `bin/nanojira-mcp`) with that project's own `--backlog=`
  (§ 4, below, and § 19's client-config shape) — never a single shared
  entry meant to serve several projects.
- Verify with `bin/nanojira --version` (or `<dest>/bin/nanojira --version` after an
  export), which prints `nanojira <version>` and exits 0 from anywhere, without
  needing a backlog (§ 9 of the spec).
- `NJ_NODE` picks a specific `node` binary when more than one is on `PATH`.
  The minimum supported version is Node 24; an inherited `NODE_OPTIONS` is
  unset before `node` starts. Any startup failure (`node` missing, `node`
  too old, a missing bundle) exits 127 with exactly one line on stderr
  naming the cause — never a stack trace.
- **Migrating off an earlier release?** Replace a vendored
  `nj.cjs`/`nj-mcp.cjs`, a `bin/nanojira/current/nj` wrapper, or a v3.11
  export that still has a `VERSION` file, with a freshly exported folder,
  and call `<dest>/bin/nanojira` in its place — `docs/CHANGES.md` 3.12.0.

## 2. Start a backlog

```sh
$ nanojira init
Created backlog at …/proj/backlog
  epics/ tasks/ subtasks/ archive/ .nanojira/
  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md
```

`init` creates `./backlog/` with the default configuration, a `README.md`, a
`.gitignore`, a `STATUS.md` and the empty type folders `epics/`, `tasks/`,
`subtasks/`, `archive/`; everything only `nanojira` needs — the configuration and
the tombstones — lives in one hidden folder, `.nanojira/`. Commit all of
the **files**: tombstones (`.nanojira/ids/`) are what guarantee that an ID
is never reused. **The empty type folders themselves need not be
committed** — git does not track empty directories at all, so a clean
checkout of a freshly-`init`ed backlog simply will not have them; this is
fine, not a defect, because `nanojira` creates whichever folder it needs the
first time something goes into it (`epics/` on the first epic, `archive/`
on the first archive, and so on) and never treats a missing empty type
folder as a problem (`nanojira doctor` stays clean either way).

- Somewhere else: `nanojira init --backlog=../shared/backlog`, or with `NJ_BACKLOG`
  or a `.njrc` set (next section). `init` never looks for an existing
  `backlog/` folder upward — without a source it always means `./backlog`.
- `init` refuses with `exists` if anything is already at the target, even an
  empty directory.

## 3. Point nanojira at a backlog

Every command finds its backlog from the **first** of these that is set:

| Source | Relative paths resolve against |
|---|---|
| `--backlog=<path>` (every command) | the working directory |
| `NJ_BACKLOG=<path>` | the working directory |
| the upward search: in each directory from here to `/`, first a `.njrc` that sets `backlog`, then a `backlog/` folder | the `.njrc`'s own directory |

The **nearest directory wins**, and within one directory `.njrc` beats
`backlog/`. A `.njrc` in a repository root therefore redirects the whole
repository, while a project with its own `backlog/` deeper down keeps it.
This is deliberate, not incidental: running `nanojira` from **anywhere** that
genuinely has no backlog of its own and no `--backlog`/`NJ_BACKLOG`
override — including a scratch or temporary directory — will find an
unrelated `backlog/` sitting in one of its ancestors if one happens to be
there (another project's, say); give an explicit `--backlog`/`NJ_BACKLOG`
whenever that ambiguity matters, rather than relying on "no backlog
nearby" being true of a path you don't control.

**`--backlog`/`--json` also work before the command word**, not just after
— either order, either place, repeated or mixed:

```sh
$ nanojira --backlog=../shared/backlog list --json | head -2
{
  "backlog": "…/shared/backlog",
```

runs `list` exactly as `nanojira list --backlog=../shared/backlog` would; a flag
other than these two ahead of the command word (even one valid for the
command that follows, like `nanojira --status=doing set --id=TSK-001`) is
`unknown_field` against the bare invocation instead — the command word is
never silently dropped or reached past.

```sh
$ cat repo/.njrc
# where this repo keeps its backlog
backlog = ../shared/backlog
$ cd repo/app/src && nanojira list --json | head -2
{
  "backlog": "…/shared/backlog",
```

**A chosen source is binding.** If it holds no backlog, `nanojira` stops — it
never falls back to a lower source, because silently reading the wrong
backlog is the worst thing it could do:

```sh
$ nanojira list --backlog=/nowhere
Error: no backlog at /nowhere (from --backlog)          # exit 1, invalid_backlog_flag
$ NJ_BACKLOG=/nowhere nanojira list --json          # JSON shown on one line
Error: no backlog at /nowhere (from NJ_BACKLOG)
{ "ok": false, "error": "invalid_backlog_env" }
```

A `.njrc` pointing at nothing is `invalid_backlog_njrc` and names the `.njrc`.
No source at all is `no_backlog` — never an empty list.

**`.njrc` is strict**, like unknown flags:

```sh
$ cat .njrc
backlog = ../shared/backlog
backlogs = x
$ nanojira list
Error: invalid .njrc at …/repo/.njrc: line 2: unknown key 'backlogs'
```

- One `key = value` per line; `#` starts a comment only at the start of a
  line; the only key is `backlog`. The value is literal — no quotes, no
  variables — except a leading `~/`, which is your home directory (only
  here; `--backlog` and `NJ_BACKLOG` take `~` literally, your shell expands
  it). The line splits at its first `=`; CRLF files work; a stray `\r`
  elsewhere is an error.
- An unknown key, a line without `=`, an empty value, a repeated key, or a
  `.njrc` that is not a readable file: `invalid_njrc` — with the line number
  where there is one.
- **Ownership:** a `.njrc` the search reaches must belong to you or to root
  (for a symlink: the link *and* its target); otherwise `invalid_njrc`,
  naming the uid and suggesting `--backlog`/`NJ_BACKLOG` or changing the
  owner — so a file planted in a shared directory like `/tmp` cannot steer
  your `nanojira`. `--backlog` and `NJ_BACKLOG` stop the search before any `.njrc`
  is read.
- A `.njrc` without `backlog` (only comments) sets nothing; the search goes
  on upward.

## 4. Many projects on one machine

One `nanojira` install serves every project on the machine — there is nothing
project-specific to install per project. What's project-specific is the
**backlog**: each project resolves its own, by the same search as above
(§ 3) — `--backlog`, then `NJ_BACKLOG`, then the nearest `.njrc` or
`backlog/` folder upward from the current directory. Two projects never
share state unless they're pointed at the same backlog on purpose: claims,
IDs (the tombstones in `.nanojira/ids/`) and `STATUS.md` are all per
backlog, not global to the machine.

A `.njrc` can point at a backlog anywhere — outside the project, or shared
by several projects on purpose — the same way `repo/.njrc` redirecting to
`../shared/backlog` already works in § 3's example.

**`nanojira-mcp`, differently: one server process is fixed to one backlog for its
whole life**, resolved once at startup (§ 19 below, § 17 of the spec) —
there is no per-call backlog switch. With several projects, configure one
`nanojira-mcp` entry **per project** (each with its own `--backlog=`, or each
started with that project as its working directory), not one shared entry
meant to serve all of them: a single `nanojira-mcp` process can only ever answer
for the one backlog it started with.

## 5. The daily loop (and `--json` for agents)

```sh
$ nanojira new --type=epic --title="Login" --description="Users can sign in."
EPIC-001 created → …/backlog/epics/EPIC-001.md
$ nanojira new --type=task --parent=EPIC-001 --title="Login route"
TSK-001 created → …/backlog/tasks/TSK-001.md
⚠ TSK-001 has no acceptance criteria. Add them before starting.
⚠ TSK-001 has no description. Add one before starting.
$ nanojira list --ready
Ready to work:
  EPIC-001  Login

Complete first:
  TSK-001  Login route      incomplete:acceptance incomplete:description
```

An element is **ready** when its status is the first configured one (`todo`),
every `depends_on` target is done (archived counts as done), it has no
blocking problem, and it is complete: a non-empty `## Description`, and for
tasks and subtasks a non-empty `## Acceptance Criteria`. A heading with
nothing under it counts as missing — on purpose.

```sh
$ nanojira set --id=TSK-001 --description="POST /login returns a session." \
         --acceptance=$'- [ ] 200 with a valid password\n- [ ] 401 otherwise'
TSK-001 → description=(body section), acceptance=(body section)
$ nanojira set --id=TSK-001 --status=doing
TSK-001 → status=doing
$ nanojira note --id=TSK-001 "Route wired, tests pending"
TSK-001 note added
$ nanojira set --id=TSK-001 --status=done
TSK-001 → status=done
```

- `nanojira note` appends `- <time> <author>: <text>` under `## Notes`; the author
  is the element's `assignee`, else `?`. The text can be positional (as
  above), `--text=<t>`, or `--text-file=<path|->` (a file, or `-` for
  stdin) — exactly one of the three, mirroring `--description`/
  `--description-file`'s own shape. A multi-line `<text>`, from any of the
  three, is kept, not flattened: every line after the first is indented
  two spaces under the `- <time> <author>:` line (a Markdown list
  continuation), and `nanojira log` reads it back out the same way it went in:

  ```sh
  $ nanojira note --id=TSK-001 "$(printf 'First line\nSecond line')"
  $ tail -3 backlog/tasks/TSK-001.md
  ## Notes
  - 2026-10-06T21:16:23Z alice: First line
    Second line
  ```
- `nanojira set --status=done` on a parent with open children is refused
  (`refused:children_open`); `--allow-open-children` forces it and leaves a
  `done:open_children` warning. `--force` means only one thing: overwrite a
  parallel change.
- Fields are the frontmatter names: `--title --status --priority --tags
  --assignee --depends-on`. An unknown flag is rejected and nothing is
  written — `--statuss=done` does not "almost work".
- **`--tags=` replaces the whole list** — easy to lose one by hand if you
  only meant to change one. `nanojira set --add-tags=<list>` /
  `--remove-tags=<list>` edit it incrementally instead: remove takes
  effect first, then add appends anything not already present.

  ```sh
  $ nanojira set --id=EPIC-001 --remove-tags=waiting:user --add-tags=blocked:review
  EPIC-001 → tags=repo:app-test,blocked:review
  ```

  Adding a tag already there, or removing one that isn't, is a no-op for
  that tag, not an error. Combined with `--tags=` in the same call is
  rejected — pick one or the other. Works in batch (`--id=A,B,C`) too,
  each ID's own tags read and changed independently.
- Reads: bare `nanojira` (short status), `nanojira list [--status --type --tag --parent
  --assignee --ready --all]`, `nanojira tree`, `nanojira show --id=…`, `nanojira find "<text>"`
  (§ 17 below).

**Don't guess which flags a command takes, or which `--type`/`--status`/
`--priority` values are allowed — ask.** `nanojira <command> --help` prints
every flag that command accepts, control flags (`--json`, `--dry-run`,
`--force`, …) included, each with a one-line description and, for the
closed vocabularies, the allowed values (the backlog's own configured
`statuses` when one resolves, else the defaults). A flag it does not list
is `unknown_field` on that command:

```sh
$ nanojira set --help
  nanojira set --id=TSK-009 [--title=…] [--status=…] [--priority=…]
               [--tags=…] [--assignee=…] [--depends-on=…] [--force] [--allow-open-children]
               [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]

  --id=<id>                     the element to act on; A,B,C applies the same write to each
  --file=<path>                 address one file of a duplicated ID, instead of --id
  --title=<text>                the title
  --parent=<id>                 move the element under this parent
  --status=<value>              the status to set; allowed: todo, doing, blocked, review, done
  --priority=<value>            the priority; allowed: low, normal, high, urgent
  …
  --json                        print the result as JSON
  --force                       overwrite a parallel change
  …
  --dry-run                     run against a scratch copy; nothing is written
```

and a typo'd value — one close enough to exactly one allowed value —
names it in the hint, never silently, never as an accepted alias:

```sh
$ nanojira set --id=EPIC-001 --priority=hgih --json
{
  "ok": false,
  "error": "invalid_value",
  "hint": "did you mean 'high'? Known priorities: low, normal, high, urgent"
}
```

**For agents: add `--json` to every call.** Reads return `{backlog, counts,
entries}` — `nanojira show --json` on a single id additionally carries `entry`,
identical to `entries[0]`, so a script resolving exactly one element can
read `.entry` directly instead of indexing into `entries`; it's absent for
a `duplicate_id` target (two entries) and never appears on `list`/`find`.
Writes return `{ok, id, changed, entry, _problems}`, and **every** failure
returns `{"ok": false, "error": "<code>", "hint": "…"}` on stdout with exit 1
(the prose goes to stderr as well). Branch on `error` and on the codes in
`_problems`, never on prose. Exit codes: `0` success, `1` failed, `2` only
from `doctor`: at least one error finding.

## 6. Descriptions and acceptance criteria

`--description` and `--acceptance` write the configured sections of the body
on `nanojira new` and `nanojira set`, each in one of three forms:

```sh
nanojira set --id=TSK-002 --description="One paragraph."          # inline, newlines allowed
nanojira set --id=TSK-002 --acceptance-file=criteria.md           # a file, relative to the working directory
printf 'Line one\nLine two\n' | nanojira set --id=TSK-002 --description-file=-   # stdin
```

- A section write **replaces** the section; `--description=` empties it. The
  heading written is the first name configured for the role (`## Description`,
  `## Acceptance Criteria`); a missing section is inserted in order.
- Both forms for one role, or `-` for both roles, is `invalid_value`, nothing
  written. An unreadable `-file` is `not_found`.
- Everything else in the body — your own sections, `## Notes` — stays byte
  for byte. Don't put a `## ` heading inside the content: it would read as
  the next section.

## 7. Layouts

Where element files lie is configurable in the configuration's `layout`
block (`.nanojira/config.json`, written by `init` in full):

| `group` | Files | Archive |
|---|---|---|
| `type` (default) | `epics/EPIC-001.md`, `tasks/TSK-003.md`, `subtasks/SUB-007.md` | `archive/<id>.md` |
| `hierarchy` | `EPIC-001/EPIC-001.md`, `EPIC-001/TSK-003/TSK-003.md`, `EPIC-001/TSK-003/SUB-007.md` | the same nesting below `archive/` |
| `flat` | every file directly in the backlog | `archive/<id>.md` |

`layout.folders` renames `epics`, `tasks`, `subtasks`, `archive` — any subset;
names match `[A-Za-z0-9][A-Za-z0-9_-]*`, differ from each other ignoring
case, are not ID-shaped (`TSK-12`) and not `backlog`. An unknown key or a bad
name makes every command except `doctor` fail, pointing at `nanojira doctor`.

**Changing the layout is always allowed.** Edit `layout`, then:

```sh
$ nanojira doctor
backlog/: 3 entries, 3 errors, 0 warnings

ERROR   EPIC-001: file lies in 'epics/', not where the layout puts it
ERROR   SUB-001: file lies in 'subtasks/', not where the layout puts it
ERROR   TSK-001: file lies in 'tasks/', not where the layout puts it
$ nanojira doctor --fix
FIXED   moved EPIC-001 → EPIC-001/
FIXED   moved TSK-001 → EPIC-001/TSK-001/
FIXED   moved SUB-001 → EPIC-001/TSK-001/

backlog/: 3 entries, 0 errors, 0 warnings remaining
```

- Between the edit and `--fix` every command keeps working; misplaced files
  carry `layout:misplaced` (`type:folder` under group `type`). Writes such as
  `set` and `note` update a misplaced file where it lies — only `archive`,
  `doctor --fix` and you move files.
- The moves never change a file's bytes. The frontmatter is the truth
  (`type`, `parent`); the location is derived from it. Under `hierarchy`, a
  hand-edited `parent` makes the file misplaced and `--fix` moves it.
- An element whose `parent` chain does not resolve is reported and never
  moved. A task without `parent` lives at the top of the tree.
- `nanojira` reads every `*.md` below the backlog except the top-level `README.md`
  and `STATUS.md` and anything in a directory starting with `.` — a stray
  Markdown file elsewhere is read as an element and reported.

## 8. `STATUS.md`

A generated overview of the active backlog by status, readable in an editor
or a forge without `nanojira` — here for a backlog configured with the statuses
`todo`, `doing`, `done` (§ 5's example):

```
# Status

## todo (2)

- [TSK-002](tasks/TSK-002.md) Not-covered-Blindstellen schliessen
- [TSK-007](tasks/TSK-007.md) Parser haerten

## doing (0)

## done (1)

- [EPIC-001](epics/EPIC-001.md) Verhaltensvertrag
```

- Rewritten by `init` and after every successful `new`, `set`, `note`, `rm`,
  `archive` and `doctor --fix`; never read by `nanojira`. Commit it.
- One section per configured status, in order, even when empty; unknown
  statuses under `## ? (n)`; `list` order within; archived elements left out.
- Stale after a hand edit, a merge or a race: `nanojira doctor` reports
  `backlog:status_stale` (a warning, exit 0) and `nanojira doctor --fix` rewrites
  it — which also resolves a merge conflict in it.
- A link is the real on-disk path, casing included: renaming a folder (even
  only in case, `tasks/` → `Tasks/`) makes the stored links stale even
  though nothing else is wrong, and `doctor --fix` rewrites just that file.
- If it cannot be written, the command still succeeds and prints
  `Warning: STATUS.md not updated (<reason>)` on stderr.
- `layout.statusFile: false` turns it off; an existing file is then left
  alone.

**Several agents committing from one working tree?** (DECISIONS 163 C)
`STATUS.md` is rewritten after every successful write — in a tree shared by
several agents, each one's commit carries a `STATUS.md` change too, and
partial `git add`/staging across agents collides on that one file even
when their actual work doesn't overlap at all. Turning it off is one line
in `.nanojira/config.json`:

```json
{
  "layout": { "statusFile": false }
}
```

(merge with whatever else `layout` already has — only `statusFile` needs
to change). Verified live: with it off, `nanojira doctor` does not check
`STATUS.md` at all (no `backlog:status_stale`, clean either way) and
`STATUS.md` itself, if one already existed from before the flag was
flipped, is simply left wherever it was — `nanojira` never touches it again.
Nothing else about the backlog changes: IDs, claims and every element's
own file are exactly as they'd be with the file on.

The same overview `STATUS.md` gave for free still has two `nanojira` equivalents,
neither of which writes anything:

```sh
$ nanojira                 # bare: counts, top 5 ready, same "Ready to work" as always
$ nanojira list --json     # every element, filterable the same way STATUS.md's
                      # sections group them (--status, --type, --tag, …)
```

A forge or an editor browsing the repo directly loses the generated
Markdown view, but every agent (and `nanojira doctor`) already gets the same
information from `nanojira`/`nanojira list` on demand, without the merge noise.

## 9. Archive

```sh
$ nanojira archive --id=EPIC-001
EPIC-001 archived → …/backlog/archive/EPIC-001.md
TSK-001 archived → …/backlog/archive/TSK-001.md
```

- Moves an element and its whole subtree into the archive folder and stamps
  `archived:`. Every element in the subtree must be `done`
  (`refused:not_done` lists the open ones); there is no `--force`.
- All targets are checked before the first move — an occupied one is
  `exists`, and nothing moves.
- Archived elements are hidden from `list`, `tree` and bare `nanojira`; `--all`
  shows them. They are read-only: `set`, `note`, `rm` and `archive` refuse
  with `refused:archived`. A `depends_on` pointing into the archive is
  satisfied.
- Under `hierarchy` the subtree's folder moves as a whole and merges into
  archive folders left by earlier archives; a subtree that does not lie in
  its own folder is `refused:misplaced` — run `nanojira doctor --fix` first.
- `archive`, `rm` and `set --status=done` all refuse with
  `refused:unreadable_dir` while an unreadable directory lies anywhere in
  the backlog — files inside it aren't seen, so a subtree or an open-children
  check can't be trusted. Fix the permissions (`nanojira doctor` names the
  directory) and retry.

## 10. `doctor` and `doctor --fix`

`nanojira doctor` checks the configuration, every element against the problem
table (§ 7 of the spec), duplicate IDs, misplaced files, tombstones, stray
temp files, the archive rules, unreadable directories and `STATUS.md`. Exit
`2` when at least one **error** exists; warnings are printed but exit `0`.

`nanojira doctor --fix` repairs only what is unambiguous, in this order: migrate a
v2 layout; write a missing `id` from the file name and a missing `type`
from the ID prefix; rename a file to match its `id` when the name is free;
move files to their layout place; restore missing tombstones; fill a
missing `status`, `created`, `updated`; pull the H1 up from `title`; remove
stray temp files; rewrite `STATUS.md`. It reports what it did and what
remains, and its exit code is the state **after** the repairs — no second
`doctor` needed.

It **never**: guesses a status, resolves a duplicate ID, invents a parent,
rewrites your body text, overwrites an existing value even an invalid one,
or writes into (or burns a tombstone for) a file whose name isn't
ID-shaped (`EPIC-NNN.md`/`TSK-NNN.md`/`SUB-NNN.md`) — a stray `*.md` is
reported, never repaired. While the configuration is invalid it writes
nothing at all — so a mistyped `--backlog` cannot scatter tombstones into
the wrong directory.

**Too many warnings in `doctor`'s report?** `"problems": {"ignore":
[...]}` in `.nanojira/config.json` lists warning-level codes (§ 7 of the
spec has the full list) to stop seeing reported — in `doctor`, in
`_problems`, and in `new`/`set`/`note`/`check`'s own text feedback —
without touching the underlying condition itself (an ignored
`unknown:status`, for example, still keeps its element out of
`--ready`; only the reporting goes quiet). An **unrecognised** key or
code anywhere in the configuration (`problems` included) is itself just
another warning (`config:unknown_key`/`config:unknown_code`), never a
hard failure — a typo stays visible without stopping work. Any *known*
code that is not warning-severity in § 7 of the spec is refused instead:
until it is removed, every command but `doctor` fails with
`invalid_config`, and `doctor` reports the configuration as invalid.

**No rollout order needed for this one:** a `nanojira` older than 3.7 already
silently ignores an unrecognised *top-level* config key (confirmed
directly against 3.5.0 and 3.6.0), so adding `"problems"` or
`"minVersion"` (below) today is safe even while some machines haven't
upgraded yet — they simply won't act on either key until they do.

**`"minVersion": "X.Y.Z"`** makes every command, including `doctor`,
fail with `needs_newer_nj` (naming both the running and required
versions) when this `nanojira` is older than that — `nanojira --version` and `nanojira
<command> --help` still work regardless, since neither depends on the
backlog's configuration the way every other command does.

## 11. Who's acting: `NJ_AUTHOR` and `--as`

`nanojira note`, `nanojira claim` and `nanojira release` need to know who is acting. In order:
an explicit `--as=<name>` where the command has one, else `NJ_AUTHOR=<name>`
from the environment, else none. A name must be non-empty after trimming
leading/trailing spaces and tabs, a single line, and contain no `:`.

```sh
$ NJ_AUTHOR=alice nanojira note --id=TSK-001 "wired the route"
$ nanojira claim --id=TSK-001 --as=bob
```

An invalid name is a hard error on a command that needs one, nothing
written — `invalid_env` for `NJ_AUTHOR`, `invalid_value` for `--as` (which
outranks a malformed `NJ_AUTHOR`). Names are labels, not identities: there
is no registry, no authentication; two callers using the same name are the
same actor.

## 12. `nanojira unarchive`

Moves an archived element — and its archived subtree — back to where it
would live today, byte-identical except `updated` and a removed
`archived:` field:

```sh
$ nanojira unarchive --id=EPIC-001
EPIC-001 unarchived → …/backlog/epics/EPIC-001.md
TSK-001 unarchived → …/backlog/tasks/TSK-001.md
```

Refuses `refused:not_archived` if it isn't archived, `refused:parent_archived`
under an archived parent, `refused:misplaced` if its hierarchy chain can't
be resolved first — `nanojira doctor --fix`, same pointer `archive`'s own
refusals give.

## 13. `nanojira claim` / `nanojira release`

One acting name at a time can hold an element. A claim is exclusive only
against another claim — never against a read or any other write:

```sh
$ nanojira claim --id=TSK-001 --as=alice
TSK-001 claimed by alice
$ nanojira claim --id=TSK-001 --as=bob
Error: TSK-001 is already claimed by alice — refused          # exit 1, refused:claimed
use --steal=<holder> to take it over
$ nanojira claim --id=TSK-001 --as=bob --steal=alice
TSK-001 claimed by bob
$ nanojira release --id=TSK-001 --as=bob
TSK-001 released by bob
```

The human line after a `--steal` does **not** name who it was stolen
from — that's `stolen_from` in the `--json` result only (§ 9's JSON
shapes table). A human watching the terminal sees only that the claim
changed hands, not to whom it previously belonged.

- `set`, `note`, `archive` and `doctor --fix` work on a claimed element
  exactly as on an unclaimed one — only a competing `claim` is blocked. A
  claim changes `list --ready`: an element claimed by another acting name is
  hidden from *your* `--ready`; one claimed by you, or unclaimed, is not.
- **Stale claims.** `claims.staleAfterHours` in `.nanojira/config.json`
  (default **24**, hours; `0` disables it) turns into an advisory
  `claim:stale` warning on every read once a claim is older than that.
  Nothing is ever auto-released or auto-stolen on a plain read — it's a
  signal for a human or agent to act on with `--steal`, except for the
  bulk cleanup `doctor --fix` performs below, which is explicit, not
  automatic on every read.
- **History.** These claim events feed into `nanojira log` (§ 15, below).
- **A write that reaches the last configured status releases the claim
  on its own** — `nanojira set --status=done`, `nanojira claim --status=done`, `nanojira
  next --status=done` alike, whoever holds it, in the same call:

  ```sh
  $ nanojira claim --id=TSK-001 --as=alice
  TSK-001 claimed by alice
  $ nanojira set --id=TSK-001 --status=done --json
  { "ok": true, "id": "TSK-001", "changed": ["status"], "...": "...",
    "released": "alice" }
  ```

  No more separate `nanojira release` after finishing — `released` is simply
  absent from the result when nothing was claimed. A write refused for
  another reason (`refused:children_open` without
  `--allow-open-children`, for one) releases nothing; the claim survives.
- **Old claims on already-`done` items** — left over from before the
  above existed, or from any other path that reached the final status
  without going through `nanojira` — are cleaned up in bulk with `nanojira doctor
  --fix`, live or archived, whoever holds them. This replaces posing as
  each holder in turn with `release --as=<holder>`:

  ```sh
  $ nanojira doctor
  backlog/: 2 entries, 0 errors, 1 warning

  WARNING TSK-001: claimed by 'alice' since 2026-01-01T00:00:00Z, past the
  24h staleness threshold
  $ nanojira doctor --fix
  FIXED   TSK-001: released alice
  ```

  Claims on anything not yet in the final status are left alone, stale or
  not — see § 10 for the rest of `--fix`.

## 14. `nanojira next`

`list --ready` then `claim` by hand leaves a gap: two callers can read the
same top candidate before either claims it. `nanojira next` closes it — one
call picks the highest-ranked `--ready` element and claims it:

```sh
$ nanojira next --as=alice --status=doing
TSK-001 claimed by alice (status: doing)
```

- **Ranking** is `list --ready`'s own order (priority, then `id`) —
  `next` just claims the top of it instead of printing it.
- **`--status=<s>`** claims and sets status in the same write, exactly
  as `claim --status=` does; omit it and status is left alone.
- **Filters** are `list`'s own: `--type`, `--tag`, `--parent`,
  `--assignee` — narrow which candidates `next` will even consider.
- **Respects an existing `assignee` by default.** An element already
  assigned to someone else is never a candidate — `next` never hands out
  work a human or a prior `claim`/`next` explicitly gave to a specific
  name. Assign a review (or anything else) to a particular person or
  agent with `nanojira set --id=<id> --assignee=<name>`, and only that name's
  own `next` (or an explicit `nanojira claim --id=<id> --as=<name>`) will pick
  it up. This is also the answer to "an author shouldn't review their
  own work": assign the review task to the reviewer, not the author, and
  `next` keeps it out of the author's hands on its own.
- **Leaf work only.** A container with an open child (neither `done` nor
  archived) is never a candidate — its child is, instead:

  ```sh
  $ nanojira next --as=alice
  TSK-001 claimed by alice
  ```

  (claimed the one open task under `EPIC-001`, not the epic itself — an
  epic is only ever picked once it has no open child left: no children
  at all, or every one of them `done`/archived.)
- **Nothing to claim** is `none_ready`, exit 1 — a normal outcome, not a
  bug:

  ```sh
  $ nanojira next --as=carol --json
  {
    "ok": false,
    "error": "none_ready"
  }
  ```
- **`skipped`** (in the `--json` result) names any id that lost a race
  for a higher-ranked candidate before this one succeeded — empty when
  nothing was raced away. From a real run where two calls landed at the
  same instant (the `entry` field, unrelated to this, is cut below for
  length):

  ```json
  {
    "ok": true,
    "id": "TSK-002",
    "claim": { "by": "bob", "since": "2026-10-05T22:43:12Z" },
    "skipped": ["TSK-001"]
  }
  ```

  (`bob` lost the race for `TSK-001` — someone else claimed it a moment
  earlier — and `next` moved on to `TSK-002` instead of giving up.)

**`next` is pull, never push.** `nanojira` is a local, file-based CLI with
no daemon and no network; an optional `NJ_ON_CHANGE` hook (env only, § 30)
can push changes outward, but it fires on a write, never on readiness. It
cannot notify or wake anyone on its own when an element becomes `--ready`
or a dependency clears; nothing happens until something calls
`next`/`claim` and asks. Whatever "wake
someone when X is ready" a team wants — a teammate polling `next` on an
interval, a message when a dependency is satisfied, a scheduled check-in
— has to come from that team's own orchestration layer (messages, a task
board, a cron job), not from `nanojira` itself. That's deliberate, not a
gap to fill.

## 15. `nanojira log`

The change history of one element — what already exists, merged into one
timeline: when it was created, every claim/re-claim/steal/release, and
its notes.

```sh
$ nanojira log --id=TSK-001
2026-10-05T22:43:37Z created
2026-10-05T22:43:38Z claimed by alice
2026-10-05T22:43:40Z alice: Parser splits at the first colon
2026-10-05T22:43:41Z released by alice
```

```sh
$ nanojira log --id=TSK-001 --json
{
  "ok": true,
  "id": "TSK-001",
  "events": [
    { "at": "2026-10-05T22:43:37Z", "kind": "created" },
    { "at": "2026-10-05T22:43:38Z", "kind": "claimed", "actor": "alice" },
    { "at": "2026-10-05T22:43:40Z", "kind": "note", "actor": "alice",
      "text": "Parser splits at the first colon" },
    { "at": "2026-10-05T22:43:41Z", "kind": "released", "actor": "alice" }
  ]
}
```

**Two plain limits**, both worth knowing before you rely on it:

- **No field-level history.** A `set --status=... --priority=...` leaves
  no trace — `log` only ever shows `created`, claims and notes, nothing
  else, even right after a field changes:

  ```sh
  $ nanojira set --id=TSK-001 --status=doing --priority=high
  $ nanojira log --id=TSK-001
  2026-10-05T22:43:37Z created
  2026-10-05T22:43:38Z claimed by alice
  2026-10-05T22:43:40Z alice: Parser splits at the first colon
  2026-10-05T22:43:41Z released by alice
  ```

  (identical to the run above — the `set` changed nothing `log` can see.
  Leave a `nanojira note` if a field change is worth remembering later.)
- **Claim history is local, and archiving erases it outright.**
  `.nanojira/claims/` is git-ignored (one of the lines `nanojira init` writes
  into `.gitignore`, § 2 above; spec § 12a), so a fresh
  clone shows `created` and notes only — the claims happened, but their
  record never left the machine that made them. `archive` goes further:
  it deletes `.nanojira/claims/<id>/` as part of the move, so `log`
  loses the claim events even on the machine that made them:

  ```sh
  $ nanojira archive --id=TSK-001
  $ nanojira log --id=TSK-001
  2026-10-05T22:43:37Z created
  2026-10-05T22:43:40Z alice: Parser splits at the first colon
  ```

  (the `claimed`/`released` pair is gone; `created` and the note
  survive.)

For a git-backed backlog, `git log -p -- backlog/tasks/TSK-001.md` is the
manual complement for the one thing `log` doesn't show: field-level diffs,
at the cost of only seeing whatever was actually committed, in whatever
granularity your commits happen to have.

## 16. `nanojira check`

Ticks or unticks one Markdown checkbox in the body, without touching
anything else:

```sh
$ nanojira check --id=TSK-001 --text="200 with a valid password" --on
TSK-001 checked
```

- Address it by `--text=<substring>` (the common case) or `--item=<n>`
  (1-based, document order) — exactly one of the two. With neither `--on`
  nor `--off`, the command ticks (`--on` is the default); both together is
  `invalid_value`.
- A checkbox inside a fenced code block, or under `## Notes`, is never
  matched. `--text` naming zero countable checkboxes is `not_found`; two or
  more is `ambiguous_target`.

## 17. `nanojira find`

Full-text search over title, body and notes:

```sh
$ nanojira find "rate limiting"
  TSK-002  todo     Rate-limit the login route  incomplete:acceptance
    We need rate limiting here.
```

Each hit's line carries its status and `_problems` codes, like `list`'s
own output; underneath, one line of context — the first line of the body
containing the match, the way `grep` shows the matching line, not the
whole file.

Case-insensitive by default — `String.prototype.toLowerCase()`'s plain
lowercase mapping, not full Unicode case folding, so e.g. `ß`/`SS` don't
match each other; `--case-sensitive` for an exact match. Combines with
`list`'s other filters (`--status`, `--type`, `--tag`, `--parent`,
`--assignee`) as an AND; `--all` includes the archive. The literal empty
string is `invalid_value`.

## 18. Batch writes: `--id=A,B,C`

`set`, `note`, `check`, `claim` and `release` take a comma-separated `--id`
to apply the same field map or action to several elements in one call:

```sh
$ nanojira set --id=TSK-001,TSK-002,TSK-003 --status=done --json
```

Every named ID is resolved and validated **before** anything is written —
an unknown ID, a repeated one, or a refusal a single call would already
give aborts the whole batch, nothing written for any ID. Past that point
each ID writes independently: one ID's bad luck (a parallel edit, a
competing claim) never stops the others. The result is `{ok, results:
[{id, ok, …}]}` instead of one write's usual shape; a single `--id=A` (no
comma) is unaffected. `--fields`/`--quiet` (§ 25) narrow each successful
member of `results` the same way they narrow a single write's result.

## 19. `nanojira-mcp` — the MCP wrapper

`dist/nanojira-mcp.mjs` is a second binary, built alongside `dist/nanojira.mjs`, that
exposes the same commands as MCP tools over stdio instead of a CLI an agent
has to shell out to and parse `--json` from:

```sh
$ dist/nanojira-mcp.mjs --backlog=./backlog [--allow-destructive]
```

In an exported skill folder (§ 1, § 18 of the spec), start it through the
wrapper instead, which resolves `node` and the bundle for you:

```sh
$ <dest>/bin/nanojira-mcp --backlog=./backlog [--allow-destructive]
```

- Resolves its backlog once at startup, the same rules as the CLI
  (`--backlog`, `NJ_BACKLOG`, `.njrc`), and serves only that one backlog.
- Every tool's result **is** exactly the JSON `dist/nanojira.mjs --json` would
  return for the equivalent CLI call — nothing to learn beyond the contract
  above.
- Tools: `list`, `show`, `find`, `tree`, `new`, `set`, `note`, `check`,
  `claim`, `release`, `archive`, `unarchive`, `doctor`. **`rm` is never
  offered.** `archive`/`unarchive` are offered ungated (both reversible);
  `doctor --fix` only exists as a tool when the server was started with
  `--allow-destructive`.
- A minimal client config — the shape only; where this goes is your MCP
  client's own concern, not `nanojira`'s:
  ```json
  { "command": "sh", "args": ["/path/to/<skill>/bin/nanojira-mcp", "--backlog=/path/to/backlog"] }
  ```

## 20. Failure codes an agent should handle

With `--json`, `error` is one of a closed set. The ones an agent meets:

| `error` | Meaning | What to do |
|---|---|---|
| `no_backlog` | no source found a backlog | `nanojira init`, or set `--backlog` / `NJ_BACKLOG` / `.njrc` |
| `invalid_backlog_flag` / `_env` / `_njrc` | that source points at no backlog | fix that source — `nanojira` does not fall back |
| `invalid_njrc` | a reached `.njrc` is malformed or not yours | fix the named line or file |
| `backlog_without_config` | a `backlog/` was found without its configuration | `nanojira doctor` |
| `invalid_config` | the configuration violates § 5 | `nanojira doctor` names the defect |
| `legacy_layout` | a v2 backlog | `nanojira doctor --fix` migrates it (`docs/MIGRATION-v3.md`) |
| `unknown_field`, `unknown_command` | a typo | the hint lists the known flags |
| `missing_argument`, `missing_value`, `invalid_value`, `invalid_target` | the call itself is wrong | fix the call |
| `ambiguous_target` | `check --text` matches two or more checkboxes | narrow the text, or use `--item=<n>` |
| `invalid_env` | `NJ_AUTHOR`, `NJ_NOW` or `NJ_ON_CHANGE_TIMEOUT` holds an invalid value; the hint names which | fix or unset it; for `NJ_AUTHOR`, `--as` works too |
| `not_found` | the `--id`, `--parent`, `--depends-on` or `--file` names nothing | check the ID |
| `duplicate_id` | two files carry this ID | address one with `--file=<path>`, fix by hand |
| `changed_in_parallel` | the file changed between read and write | re-read and retry; `--force` on `set`/`note`/`check` only if you mean to overwrite |
| `refused:children_open` | `done` on a parent with open children | finish the children, or `--allow-open-children` |
| `refused:has_children` | `rm` of an element with children | `--cascade`, or remove the children first |
| `refused:not_done` | `archive` of an unfinished subtree | finish it first |
| `refused:claimed` | `claim`/`release` where another acting name holds it | `--steal=<holder>` if that's intended |
| `refused:not_archived` | `unarchive` of something that isn't archived | nothing to do |
| `refused:archived`, `refused:parent_archived` | writing, or adding a child to, an archived element | archived work is read-only |
| `refused:unreadable` | an unreadable file exists (`rm`, `archive`, as `--parent`) | fix or remove the file `nanojira doctor` names |
| `refused:misplaced` | a hierarchy archive of a subtree outside its folder | `nanojira doctor --fix` |
| `refused:unreadable_dir` | an unreadable directory hides part of the backlog | fix its permissions, then `nanojira doctor` |
| `exists` | `init` target occupied, or an archive target occupied | choose another target, or clear it |
| `io_error` | a filesystem call on a named path failed | read the message; nothing was half-written |
| `id_allocation_failed` | 100 ID retries exhausted under contention | retry |

Element problems arrive in `_problems` on every entry — branch on the codes
(`incomplete:acceptance`, `depends_on:dangling`, `layout:misplaced`,
`claim:stale`, `claim:mismatch`, `claim:orphaned`, …); the full closed
table is § 7 of the spec.

## 21. Creating a whole plan with `--input`

Field flags build one element per call. For an epic with several tasks
and subtasks, cross-referencing each other via `depends_on`, `nanojira new
--input=<file|->` takes the whole thing as one JSON plan instead — an
object, or an array of objects, each of which may nest its own `children`
(the parent is implied by the nesting, never given alongside it). `nanojira set
--input=` takes the same field map `set` already accepts via flags, just
sourced from JSON — addressing (`--id=`/`--file=`) stays on the CLI either
way, so there's no plan form for `set`.

**A real run** — an epic, one task, an implementation subtask and a
review that `depends_on` it via `ref` (a call-scoped local name, never
written to any file):

```sh
$ cat plan.json
{
  "type": "epic", "title": "Login", "description": "Users can sign in.",
  "children": [
    { "type": "task", "title": "Login route",
      "description": "POST /login returns a session.",
      "acceptance": ["200 with a valid password", "401 otherwise"],
      "children": [
        { "type": "subtask", "ref": "@impl", "title": "Implement POST /login",
          "description": "Wire the route to the session store.",
          "acceptance": ["Route registered", "Session cookie set on success"] },
        { "type": "subtask", "title": "Review: POST /login", "assignee": "bob",
          "depends_on": ["@impl"],
          "description": "Review the implementation above.",
          "acceptance": ["Code reviewed", "Tests reviewed"] }
      ] }
  ] }
$ nanojira new --input=plan.json --json
{
  "ok": true,
  "ids": ["EPIC-001", "TSK-001", "SUB-001", "SUB-002"],
  "entries": [ "...", "...", "...",
    { "id": "SUB-002", "parent": "TSK-001", "title": "Review: POST /login",
      "assignee": "bob", "depends_on": ["SUB-001"], "...": "..." } ],
  "refs": { "@impl": "SUB-001" },
  "_problems": []
}
```

Piping a heredoc through stdin works the same way and avoids a stray
`plan.json` in the working tree:

```sh
$ nanojira new --input=- --json <<'EOF'
{ "type": "subtask", "parent": "TSK-001", "title": "Hotfix",
  "description": "D.", "acceptance": ["Covered by a regression test"] }
EOF
```

- **`ref`/`depends_on`**: `ref` always starts with `@`; a `depends_on`
  entry starting with `@` resolves only against this plan's own `ref`s
  (`not_found` if none matches), one that doesn't resolves only against
  real, already-existing ids, exactly as it does today. A ref must be
  **declared earlier** in the plan than wherever it's used — the same
  depth-first, pre-order sequence the plan is written in. A forward
  reference, or an object referencing itself, is `invalid_value`, the
  failure naming the *referencing* object and hinting to move the
  referenced one earlier. `parent` is never ref-aware: a new element's
  parent being *another new element in the same plan* is said through
  `children` nesting, not through `parent` plus a `ref`.
- **`acceptance` as a JSON array** (either command): each string becomes
  one `- [ ] …` line, in order — content supplied this way can never
  accidentally trigger `acceptance:no_checkbox`. A plain string still
  works unchanged.
- **`--dry-run`**: check a plan before committing to it. Nothing is
  written; you get the plan's real result (would-be ids included) plus
  the files it would create — see § 28.

**Recovering from a mid-plan failure.** A failure's JSON always carries
`failed_at` — the one object at fault, named by its own `ref` if it
declared one, else a JSON path like `[0].children[1]` (the top level is
always 0-indexed, even for a single bare object). If the plan failed
*validation*, nothing was written at all (`created`/`refs` both absent);
if an object further in failed to *write* (a concurrent change, a
filesystem error), `created` lists every id actually written so far, in
order, and `refs` lists every `ref` resolved by then — nothing before the
failure point is rolled back, there is no transaction across a whole
plan:

```json
{ "ok": false, "error": "invalid_value",
  "hint": "move the object that declares this ref earlier in the plan, before this one",
  "failed_at": "[0]" }
```

To retry after a mid-plan write failure: fix the one object `failed_at`
names, drop everything `created` already lists from the plan (those
elements exist now — re-running the same plan unmodified would create
duplicates, not pick up where it left off), and re-run with what remains,
using `refs` to recover which real id each already-written `ref` resolved
to if a dropped element is still depended on by one that's left.

## 22. Reparenting: `nanojira set --parent`

`nanojira set --id=<id> --parent=<new-parent-id>` moves a task under a different
epic, or a subtask under a different task — the id, the body (description,
acceptance, notes) and the claim log all come along unchanged; a claim is
keyed by id, never by file path. The type never changes: there's no flag
that turns a task into a subtask or back.

```sh
$ nanojira set --id=TSK-001 --parent=EPIC-002 --json
{ "ok": true, "id": "TSK-001", "changed": ["parent"],
  "entry": { "id": "TSK-001", "parent": "EPIC-002", "...": "..." },
  "_problems": [] }
```

Under `layout.group: hierarchy` (§ 7) the file moves with it — the
subtask's own file, or the whole folder including every descendant file,
for a task — in the same write that changes `parent`; under `type` or
`flat` only the frontmatter changes, exactly as any other `set` does.
There's no separate step and no window where the old and new locations
could disagree.

The new parent must exist, be live and be the right type (an epic for a
task, a task for a subtask) — not a new vocabulary, the same codes `new
--parent` already uses:

```sh
$ nanojira set --id=TSK-001 --parent=TSK-002       # wrong type: a task needs an epic
Error: parent 'TSK-002' is a task, but a task needs an epic          # invalid_target
$ nanojira set --id=TSK-001 --parent=EPIC-999      # does not exist
Error: parent 'EPIC-999' does not exist                              # not_found
$ nanojira set --id=TSK-001 --parent=EPIC-003      # archived
Error: parent 'EPIC-003' is archived — refusing to move a child under it  # refused:parent_archived
a fresh child of an archived parent would immediately carry archive:split
$ nanojira set --id=EPIC-001 --parent=EPIC-002     # an epic never has a parent
Error: epics must not have a --parent                                # invalid_value
```

Nothing is written in any of the four cases above. To undo a reparent,
there's no separate command — `nanojira set --parent=<old>` moves it right back
and restores the previous state exactly (same file location, same
frontmatter apart from `updated`), same as moving it anywhere else.
`--input set` accepts `parent` as one more field in its JSON object (§ 21).

## 23. Acceptance-quality warnings

Three warnings watch a task/subtask's Acceptance Criteria section, shown
by `doctor` and in `new`/`set`/`note`/`check`'s own text feedback — never
blocking, never rejecting a write, never changing `--ready`/`list`/any
count, and never shown for an archived element (nobody can act on a
warning about history):

- `acceptance:no_checkbox` — the section has text but no `- [ ]` line, so
  `nanojira check` has nothing to tick.
- `done:no_acceptance` — a `done` element's section is absent or empty.
- `done:open_acceptance` — a `done` element's section has at least one
  checkbox still unticked:

  ```sh
  $ nanojira set --id=TSK-001 --status=done
  TSK-001 → status=done
  ⚠ TSK-001 is done with 2 of 3 acceptance boxes still unticked.
  $ nanojira doctor
  ./: 2 entries, 0 errors, 1 warning

  WARNING TSK-001: done with 2 of 3 acceptance boxes still unticked
  ```

  `set`'s (and `claim`'s) own `--json` result carries the same count
  directly, for whichever call left the element in the final status:

  ```json
  { "ok": true, "id": "TSK-002", "changed": ["status"], "...": "...",
    "_problems": ["done:open_acceptance"],
    "open_acceptance": { "unticked": 1, "total": 1 } }
  ```

These three can never fire on the same element at once: each needs a
different checkbox count to be true (zero, none-at-all, or at-least-one-
unticked).

**If upgrading surfaces a flood of these on old `done` elements** that
simply predate the check — tick the boxes, archive the finished epics
(their descendants archive with them, § 9), or silence a code everywhere
it would otherwise appear:

```json
"problems": {"ignore": ["done:open_acceptance"]}
```

Any warning-severity code from `docs/SPECIFICATION.md` § 7 can be listed
this way (§ 10 above); any other code in § 7 cannot (the configuration is
then invalid).

## 24. Tags: `TAGS.md`, `nanojira tags`, and healing drift

`tags` is free-form text (§ 5) — nothing stops `backend`, `back-end` and
`Backend` from all being in use at once, each looking unrelated to `list
--tag=`. `TAGS.md` gives that drift "one place to look," generated the same
way `STATUS.md` is (§ 8): every tag currently in use across every element,
with how many elements carry it, sorted —

```
# Tags

- `backend` (3)
- `bug` (7)
- `urgent` (1)
```

- Rewritten after every successful write that could touch `tags` (§ 8's
  own list of write commands, unchanged); stale after a hand edit, and
  `nanojira doctor --fix` regenerates it the same way it does `STATUS.md`
  (`backlog:tags_stale`, a warning).
- `layout.tagsFile: false` turns it off, same as `layout.statusFile: false`
  — an existing file is then left alone, and `doctor` stops checking it.
- `nanojira tags [--json]` answers the same question on demand, without
  depending on the generated file at all (it reads straight from the
  elements, the same way `nanojira list --json` does not need `STATUS.md`):

```sh
$ nanojira tags
backend (3)
bug (7)
urgent (1)
$ nanojira tags --json
{"ok": true, "tags": [{"name": "backend", "count": 3}, {"name": "bug", "count": 7}, {"name": "urgent", "count": 1}]}
```

**Introducing a tag that looks like a drifted spelling of one already in
use** — `back-end` when `backend` already exists, `Bug` when `bug`
already exists — prints a non-blocking warning to stderr from `new` or
`set --tags=`/`--add-tags=`. It never changes the exit code, never blocks
the write, and never appears in `--json` output; it is a nudge, not a
rule — there is deliberately no closed tag vocabulary to enforce.

**Healing a tag that already drifted** has no dedicated rename command —
renaming a tag is rare enough, and the two primitives already needed for
anything else compose into it directly: find every carrier of the old
spelling, then flip each one over in a single batch write.

```sh
$ nanojira list --tag=back-end --json                # every carrier of the old spelling
$ nanojira set --id=TSK-003,TSK-011,TSK-014 --add-tags=backend --remove-tags=back-end
```

(`--id=` takes a comma-separated list — § 18 "Batch writes" — so every
carrier is fixed in one call, each one's own other tags left untouched;
`--remove-tags`/`--add-tags` edit the list incrementally, § 5 above, so
nothing else about any of those elements' tags needs to be re-specified by
hand.) `nanojira doctor --fix` (or the next successful write to any element)
regenerates `TAGS.md` to match once the carriers are fixed.

## 25. Shrinking write results: `--fields` / `--quiet`

`new`, `set`, `note`, `check`, `claim` and `release` return the whole
`entry` (~600 bytes) on every `--json` call. If you only need to confirm
the write happened, or only need a couple of fields back, `--quiet` and
`--fields=` shrink the result — without falling back to piping it through
`head`/`grep`, which is a parsing gamble the stable JSON contract exists
to avoid.

```sh
$ nanojira set --id=TSK-009 --status=doing --quiet --json
{"ok": true, "id": "TSK-009"}

$ nanojira set --id=TSK-009 --status=done --quiet --json
{"ok": true, "id": "TSK-009", "_problems": ["done:open_acceptance"]}

$ nanojira set --id=TSK-009 --priority=high --fields=id,priority --json
{"ok": true, "id": "TSK-009", "changed": ["priority"],
 "entry": {"id": "TSK-009", "priority": "high"}, "_problems": []}
```

- **`--quiet`** is always `{ok, id}`, plus `_problems` whenever it is
  non-empty — a warning like `done:open_acceptance` is never silently
  dropped by asking for less. Everything else (`entry`, `changed`,
  `claim` and its siblings on `claim`/`release`) is gone; don't pass
  `--quiet` on `claim` if you need the claim state back.
- **`--fields=<a,b,...>`** keeps `entry` (only), cut down to the names
  you gave, in the order you gave them. The names are `nanojira show`'s own
  entry fields (`id, type, parent, title, status, priority, assignee,
  tags, depends_on, created, updated, archived, file, _problems,
  _claim`); a typo is rejected the same way an unknown `--status` is,
  with a did-you-mean when one is close, and nothing is written.
  `changed`/`claim`/etc. at the top level are untouched either way —
  `--fields` only ever narrows `entry`.
- Both require `--json` (there is nothing to narrow in the plain text
  output) and are mutually exclusive with each other and with `--input`.
- On a batch (`--id=A,B,C`, § 18), both apply to each **successful**
  member of `results` the same way; a failed member keeps its full
  `{id, ok: false, error, hint?}` regardless — errors are never shrunk.

## 26. Umbrella tickets: make the parts children

An umbrella ticket ("ship the login flow") that is only *done* once its
parts are done should be the **parent** of those parts, not a sibling
that mentions them. Then nanojira itself refuses to close it early:

```sh
$ nanojira set --id=TSK-040 --status=done --json
{"ok": false, "error": "refused:children_open",
 "hint": "finish them first, or pass --allow-open-children"}
```

`set --status=done` on an element whose children are not all done is
refused with `refused:children_open`. Only an explicit
`--allow-open-children` forces it, and that leaves a `done:open_children`
warning behind for `doctor` to keep reporting. Separate tasks that merely
reference each other get no such protection: a worker can mark the
umbrella done while its flows are still open, and nothing notices.

- **Umbrella is a task** → its parts are subtasks:
  `nanojira new --type=subtask --parent=TSK-040 --title="..."`.
- **Umbrella spans several tasks** → make it an epic and put the tasks
  under it.
- **Parts already exist as separate tasks?** Tasks can only sit under an
  epic, and an element's type never changes, so the umbrella has to be
  an epic: create one (or use an existing one) and move the tasks under
  it in place with `nanojira set --id=<task> --parent=<epic>` (§ 22) — id,
  notes and claim carry over. Never `rm` and recreate.
- `depends_on` is the wrong tool for this: it orders work ("start B after
  A is done"), it does not stop anyone from closing the umbrella.

## 27. Fewer notes, fewer events: `show --notes=` / `log --last=`

A long-running ticket can collect 20+ notes; most of the time you only
want the newest one or two, not the whole history, and grepping the
`.md` file directly to get them bypasses the tool the same way piping a
write result through `head`/`grep` does (§ 25).

```sh
$ nanojira show --id=TSK-009 --notes=last:1
...
## Notes
(3 earlier notes hidden — pass --notes=all to see them)
- 2026-09-21T19:30:00Z alice: wired the route

$ nanojira show --id=TSK-009 --notes=last:1 --json
{"...": "...", "entry": {"...": "...",
 "notes": [{"at": "2026-09-21T19:30:00Z", "actor": "alice", "text": "wired the route"}],
 "notes_total": 4}}

$ nanojira log --id=TSK-009 --last=1 --json
{"ok": true, "id": "TSK-009",
 "events": [{"at": "2026-09-21T19:30:00Z", "kind": "note", "actor": "alice", "text": "wired the route"}],
 "events_total": 5}
```

- **`show --notes=none|all|last:N`** controls how many notes the body
  shows. `all` is the untouched default — leave the flag off entirely and
  nothing changes. `none` hides every note behind a one-line placeholder
  naming how many there are; `last:N` keeps only the `N` most recent,
  with a placeholder naming how many earlier ones are hidden (no
  placeholder at all when `N` is at or above the real count — there is
  nothing to hide). Unlike `--fields`/`--quiet`, `--notes` has a plain-text
  meaning and works with or without `--json`.
- In `--json`, giving `--notes` **at all** — `all` included — adds `notes`
  (the visible notes, same `{at, actor, text}` shape `log`'s own events
  use) and `notes_total` (the real, un-narrowed count) to `entry`.
  Leaving `--notes` off adds neither key; that is the one difference
  between the omitted default and `--notes=all` given explicitly, since
  both show the same notes.
- An unknown `--notes` value, or `last:N` with `N` not a positive integer,
  is `invalid_value` (with a did-you-mean against `none`/`all`/`last:N`
  when one fits) — checked before the target even resolves.
- On a `duplicate_id` target (two files sharing one `id`), `--notes=`
  narrows each file's own notes independently.
- **`log --last=N`** keeps the last `N` events of any kind (created,
  claimed/released/reasserted/stolen, note) from the already-merged,
  already-ordered list `log` builds — not per kind, across all of them —
  and adds `events_total`, the real count, the same additive-only-when-
  given rule `--notes` has. Leaving `--last` off is the untouched default.

## 28. Probe before you apply: `--dry-run`

Every command that writes — `init`, `new`, `set`, `note`, `check`,
`claim`, `release`, `next`, `archive`, `unarchive`, `rm`, `doctor --fix`
— takes `--dry-run`. The call runs in full against a scratch copy of the
backlog, and nothing in the real backlog is written: no file, no
tombstone, no claim, no `STATUS.md`. You get back exactly what the real
call would print, plus what it would change:

```sh
$ nanojira archive --id=EPIC-002 --dry-run --json
{ "ok": true, "ids": ["EPIC-002", "TSK-003"], "changed": ["archived"], …,
  "dry_run": true,
  "changes": [
    { "path": "STATUS.md", "kind": "file", "op": "modify", "before": "…", "after": "…" },
    { "path": "archive/EPIC-002.md", "kind": "file", "op": "create", "before": null, "after": "…" },
    …
    { "path": "epics/EPIC-002.md", "kind": "file", "op": "delete", "before": "…", "after": null },
    …
  ] }
```

The recipe:

1. Run the command with `--dry-run --json`.
2. Branch on `ok`/`error` exactly as for the real call — a dry run
   refuses with the same code (`refused:claimed`, `not_found`, …) and
   the same exit code.
3. If you like what `changes` shows, run the same command again without
   `--dry-run`.

Things to know:

- `changes` lists each path with its **full** content before and after
  (`null` where it doesn't exist), sorted by path. A move is a `delete`
  plus a `create`. A refused call has `changes: []`.
- An id the dry run shows (`new`, a plan, `next`'s pick) is **not
  reserved**. The real call gets the same one unless something else
  allocated in between, so read the id off the real call's result.
- `--quiet`/`--fields` trim the would-be result as usual; `dry_run` and
  `changes` are always kept.
- Without `--json`, you get the real call's prose plus a summary:
  `Dry run: nothing written. The real call would change 2 paths:`
  followed by one `  modify  tasks/TSK-009.md`-style line per path.
  It stays paths-only on purpose: two diff tools can show the same change
  differently, so a diff is not a stable output. To see what would change
  inside one file, save the JSON and diff that path's `before` and
  `after` (bash; `jq` is optional, `node` does the same):

  ```sh
  dry=$(mktemp)
  nanojira set --id=TSK-009 --status=doing --dry-run --json > "$dry"
  jq -r '.changes[].path' "$dry"          # the paths it would touch
  f=tasks/TSK-009.md
  side() { jq -j --arg f "$f" ".changes[]|select(.path==\$f)|.$1 // \"\"" "$dry"; }
  diff -u <(side before) <(side after)
  rm "$dry"
  ```

  Without `jq`, define `side` with `node` instead (and skip the `jq -r`
  listing line):

  ```sh
  side() { node -e 'const [p, f, k] = process.argv.slice(1);
    const c = JSON.parse(require("fs").readFileSync(p, "utf8"))
      .changes.find((c) => c.path === f);
    process.stdout.write((c && c[k]) || "")' "$dry" "$f" "$1"; }
  ```
- Read-only commands (`list`, `show`, …) reject `--dry-run` as
  `unknown_field`; plain `doctor` rejects it as `invalid_value`, since
  only `doctor --fix` writes.
- A dry run never fires an `NJ_ON_CHANGE` hook (§ 30): only the real
  call pushes anything outward.

## 29. `NJ_NOW` — a deterministic clock (verification/testing only)

`NJ_NOW=<ISO-8601 UTC>` pins the clock: every timestamp `nanojira` writes
(`created`, `updated`, `archived`, a `nanojira note` line's own time, a claim's
`since`) uses exactly this value instead of the real wall clock, for as long
as it is set.

```sh
$ NJ_NOW=2026-01-02T03:04:05Z nanojira new --type=epic --title=Auth
$ grep created backlog/epics/EPIC-001.md
created: 2026-01-02T03:04:05Z
```

This is not a feature for day-to-day use — it exists so that a scripted
test can run the same sequence of commands twice and get byte-identical
output, which a test comparing against a golden fixture (or against a
second run of itself) needs and the real wall clock can never give it.
Leave it unset for normal work.

- The value must match `YYYY-MM-DDTHH:MM:SSZ` exactly (UTC, no fractional
  seconds, no other offset) — anything else is `invalid_env`, refused
  before anything is written, never a silent fall-back to the real clock.
- A handful of clock reads are deliberately exempt and always use the real
  wall clock regardless of `NJ_NOW`: internal timeouts on a test-only fault
  hook (`NJ_FAULT`'s own rendezvous waits), and the internal bound used to
  decide whether a file's own filesystem `ctime` predates the current
  command (`STATUS.md`'s refresh) — neither is a timestamp `nanojira` ever
  writes, so pinning either would either make a wait un-timeoutable or
  compare a real filesystem clock against a fake one.
- `claims.staleAfterHours`/`claim:stale` (§ 13) measures age against
  `NJ_NOW` too, so a claim's staleness is exactly as reproducible as
  everything else.

## 30. `NJ_ON_CHANGE` — push changes to an outside board

Keeping nanojira and some other board (a team task board, a ticket
tracker) side by side means double bookkeeping, and the two drift: a
ticket is `done` here and still "in progress" there. `NJ_ON_CHANGE` lets
your own environment push every nanojira write outward. nanojira itself
still has no daemon and opens no network connection — your command does
the pushing.

```sh
$ export NJ_ON_CHANGE='./tools/push-to-board.sh'
$ nanojira set --id=TSK-009 --status=done
TSK-009 → status=done
```

After that `set` succeeded, nanojira ran
`/bin/sh -c './tools/push-to-board.sh'` in the backlog root, with:

- **stdin**: the full `--json` result of the write — exactly what
  `nanojira set --id=TSK-009 --status=done --json` would have printed
  (never trimmed by `--quiet`/`--fields`, whether or not you passed
  `--json` yourself);
- `NJ_HOOK_COMMAND=set`, `NJ_HOOK_IDS=TSK-009` (comma-separated when a
  write touches several, empty for `init` and `doctor --fix`), and
  `NJ_BACKLOG=<absolute backlog path>`.

A minimal hook that mirrors status changes:

```sh
#!/bin/sh
# tools/push-to-board.sh — runs inside the backlog root.
# The --json result is on stdin if you want it; this one only needs the ids.
for id in $(echo "$NJ_HOOK_IDS" | tr ',' ' '); do
  status=$(nanojira show --id="$id" --json | jq -r '.entry.status')
  board-cli update "$id" --status="$status"
done
```

What to rely on:

- **Only the environment arms it.** There is no config key for it and
  never will be: a hook stored in the backlog would run code from every
  backlog you clone. A hook-like key someone put into
  `.nanojira/config.json` is ignored (`nanojira doctor` warns about it as
  `config:unknown_key`).
- **It fires after every successful write** — `init`, `new`, `set`,
  `note`, `check`, `claim`, `release`, `next` (when it claims),
  `archive`, `unarchive`, `rm`, `doctor --fix` (when it fixed
  something) — once per call, a batch (`--id=A,B,C`) included: one call
  with the whole batch result. A no-op `set`/`check`/`release` fires too;
  check `changed` if you only care about real changes.
- **It never fires** after a refusal or error, after a read, after a
  `--dry-run`, or from inside a hook.
- **The backlog is already consistent** when the hook starts: the files,
  claims and `STATUS.md` are final, so `nanojira show`/`list` inside the
  hook see the new state.
- **A hook may call nanojira itself** (`nanojira note …`): inside the
  hook `NJ_ON_CHANGE` is unset and `NJ_HOOK_COMMAND` is set, and nanojira
  never fires from inside a hook, so it cannot loop.
- **A failing hook changes nothing.** Non-zero exit, a typo'd command, a
  hang: the write already happened and stays; nanojira's exit code and
  stdout are exactly what they would have been without the hook. You get
  one `Warning: NJ_ON_CHANGE hook …` line on stderr.
- **Its output goes to stderr**, never stdout, so `--json` callers still
  get clean JSON.
- **It is bounded.** nanojira waits for it, at most
  `NJ_ON_CHANGE_TIMEOUT` seconds (default `10`, whole seconds 1–86400),
  then kills it and everything it started. An invalid value is refused
  (`invalid_env`) before anything is written.
- **Order across processes is not guaranteed.** Two agents writing at
  the same time each run their own hook, possibly concurrently. If order
  matters, re-read the element in the hook (as above) instead of trusting
  the order the calls arrive in.

The value is run by `sh` exactly as given, so treat it like anything else
in your environment (`PATH`, aliases): whoever can set it can run
commands as you. The exact rules are in the specification, § 9
"`NJ_ON_CHANGE`".
