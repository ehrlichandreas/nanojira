# nj — a guide for agents and humans

`nj` keeps a backlog of epics, tasks and subtasks as one Markdown file per
element, next to your code. This guide shows how to use it; the rules behind
every answer are in `docs/SPECIFICATION.md` (spec v3), and where this guide
and the spec differ, the spec wins.

**Upgrading an existing backlog?** `nj` refuses to touch a v2 backlog
(`.nanojira.json`/`.ids/` at the top level) until you run the one
`doctor --fix` that migrates it — see `docs/MIGRATION-v3.md`.

This describes spec v3's end state. Most examples below were run directly
against `dist/nj`; output is shown as it is printed, with the
machine-specific path shortened to `…`.

```sh
alias nj="$PWD/dist/nj"       # or: <runtime-node> dist/nj  (§ 3)
```

---

## 1. Start a backlog

```sh
$ nj init
Created backlog at …/proj/backlog
```

`init` creates `./backlog/` with the default configuration, a `README.md`, a
`.gitignore`, a `STATUS.md` and the empty type folders `epics/`, `tasks/`,
`subtasks/`, `archive/`; everything only `nj` needs — the configuration and
the tombstones — lives in one hidden folder, `.nanojira/`. Commit all of it:
tombstones (`.nanojira/ids/`) are what guarantee that an ID is never reused.

- Somewhere else: `nj init --backlog=../shared/backlog`, or with `NJ_BACKLOG`
  or a `.njrc` set (next section). `init` never looks for an existing
  `backlog/` folder upward — without a source it always means `./backlog`.
- `init` refuses with `exists` if anything is already at the target, even an
  empty directory.

## 2. Point nj at a backlog

Every command finds its backlog from the **first** of these that is set:

| Source | Relative paths resolve against |
|---|---|
| `--backlog=<path>` (every command) | the working directory |
| `NJ_BACKLOG=<path>` | the working directory |
| the upward search: in each directory from here to `/`, first a `.njrc` that sets `backlog`, then a `backlog/` folder | the `.njrc`'s own directory |

The **nearest directory wins**, and within one directory `.njrc` beats
`backlog/`. A `.njrc` in a repository root therefore redirects the whole
repository, while a project with its own `backlog/` deeper down keeps it.

```sh
$ cat repo/.njrc
# where this repo keeps its backlog
backlog = ../shared/backlog
$ cd repo/app/src && nj list --json | head -2
{
  "backlog": "…/shared/backlog",
```

**A chosen source is binding.** If it holds no backlog, `nj` stops — it
never falls back to a lower source, because silently reading the wrong
backlog is the worst thing it could do:

```sh
$ nj list --backlog=/nowhere
Error: no backlog at /nowhere (from --backlog)          # exit 1, invalid_backlog_flag
$ NJ_BACKLOG=/nowhere nj list --json          # JSON shown on one line
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
$ nj list
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
  your `nj`. `--backlog` and `NJ_BACKLOG` stop the search before any `.njrc`
  is read.
- A `.njrc` without `backlog` (only comments) sets nothing; the search goes
  on upward.

## 3. The daily loop (and `--json` for agents)

```sh
$ nj new --type=epic --title="Login" --description="Users can sign in."
EPIC-001 created → …/backlog/epics/EPIC-001.md
$ nj new --type=task --parent=EPIC-001 --title="Login route"
TSK-001 created → …/backlog/tasks/TSK-001.md
⚠ TSK-001 has no acceptance criteria. Add them before starting.
⚠ TSK-001 has no description. Add one before starting.
$ nj list --ready
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
$ nj set --id=TSK-001 --description="POST /login returns a session." \
         --acceptance=$'- [ ] 200 with a valid password\n- [ ] 401 otherwise'
$ nj set --id=TSK-001 --status=doing
TSK-001 → status=doing
$ nj note --id=TSK-001 "Route wired, tests pending"
TSK-001 note added
$ nj set --id=TSK-001 --status=done
TSK-001 → status=done
```

- `nj note` appends `- <time> <author>: <text>` under `## Notes`; the author
  is the element's `assignee`, else `?`.
- `nj set --status=done` on a parent with open children is refused
  (`refused:children_open`); `--allow-open-children` forces it and leaves a
  `done:open_children` warning. `--force` means only one thing: overwrite a
  parallel change.
- Fields are the frontmatter names: `--title --status --priority --tags
  --assignee --depends-on`. An unknown flag is rejected and nothing is
  written — `--statuss=done` does not "almost work".
- Reads: bare `nj` (short status), `nj list [--status --type --tag --parent
  --assignee --ready --all]`, `nj tree`, `nj show --id=…`.

**For agents: add `--json` to every call.** Reads return `{backlog, counts,
entries}`, writes `{ok, id, changed, entry, _problems}`, and **every** failure
returns `{"ok": false, "error": "<code>", "hint": "…"}` on stdout with exit 1
(the prose goes to stderr as well). Branch on `error` and on the codes in
`_problems`, never on prose. Exit codes: `0` success, `1` failed, `2` only
from `doctor`: at least one error finding.

## 4. Descriptions and acceptance criteria

`--description` and `--acceptance` write the configured sections of the body
on `nj new` and `nj set`, each in one of three forms:

```sh
nj set --id=TSK-002 --description="One paragraph."          # inline, newlines allowed
nj set --id=TSK-002 --acceptance-file=criteria.md           # a file, relative to the working directory
printf 'Line one\nLine two\n' | nj set --id=TSK-002 --description-file=-   # stdin
```

- A section write **replaces** the section; `--description=` empties it. The
  heading written is the first name configured for the role (`## Description`,
  `## Acceptance Criteria`); a missing section is inserted in order.
- Both forms for one role, or `-` for both roles, is `invalid_value`, nothing
  written. An unreadable `-file` is `not_found`.
- Everything else in the body — your own sections, `## Notes` — stays byte
  for byte. Don't put a `## ` heading inside the content: it would read as
  the next section.

## 5. Layouts

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
name makes every command except `doctor` fail, pointing at `nj doctor`.

**Changing the layout is always allowed.** Edit `layout`, then:

```sh
$ nj doctor
backlog/: 3 entries, 3 errors, 0 warnings

ERROR   EPIC-001: file lies in 'epics/', not where the layout puts it
ERROR   SUB-001: file lies in 'subtasks/', not where the layout puts it
ERROR   TSK-001: file lies in 'tasks/', not where the layout puts it
$ nj doctor --fix
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
- `nj` reads every `*.md` below the backlog except the top-level `README.md`
  and `STATUS.md` and anything in a directory starting with `.` — a stray
  Markdown file elsewhere is read as an element and reported.

## 6. `STATUS.md`

A generated overview of the active backlog by status, readable in an editor
or a forge without `nj` — here for a backlog configured with the statuses
`todo`, `doing`, `done` (§ 4's example):

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
  `archive` and `doctor --fix`; never read by `nj`. Commit it.
- One section per configured status, in order, even when empty; unknown
  statuses under `## ? (n)`; `list` order within; archived elements left out.
- Stale after a hand edit, a merge or a race: `nj doctor` reports
  `backlog:status_stale` (a warning, exit 0) and `nj doctor --fix` rewrites
  it — which also resolves a merge conflict in it.
- A link is the real on-disk path, casing included: renaming a folder (even
  only in case, `tasks/` → `Tasks/`) makes the stored links stale even
  though nothing else is wrong, and `doctor --fix` rewrites just that file.
- If it cannot be written, the command still succeeds and prints
  `Warning: STATUS.md not updated (<reason>)` on stderr.
- `layout.statusFile: false` turns it off; an existing file is then left
  alone.

## 7. Archive

```sh
$ nj archive --id=EPIC-001
EPIC-001 archived → …/backlog/archive/EPIC-001.md
TSK-001 archived → …/backlog/archive/TSK-001.md
```

- Moves an element and its whole subtree into the archive folder and stamps
  `archived:`. Every element in the subtree must be `done`
  (`refused:not_done` lists the open ones); there is no `--force`.
- All targets are checked before the first move — an occupied one is
  `exists`, and nothing moves.
- Archived elements are hidden from `list`, `tree` and bare `nj`; `--all`
  shows them. They are read-only: `set`, `note`, `rm` and `archive` refuse
  with `refused:archived`. A `depends_on` pointing into the archive is
  satisfied.
- Under `hierarchy` the subtree's folder moves as a whole and merges into
  archive folders left by earlier archives; a subtree that does not lie in
  its own folder is `refused:misplaced` — run `nj doctor --fix` first.
- `archive`, `rm` and `set --status=done` all refuse with
  `refused:unreadable_dir` while an unreadable directory lies anywhere in
  the backlog — files inside it aren't seen, so a subtree or an open-children
  check can't be trusted. Fix the permissions (`nj doctor` names the
  directory) and retry.

## 8. `doctor` and `doctor --fix`

`nj doctor` checks the configuration, every element against the problem
table (§ 7 of the spec), duplicate IDs, misplaced files, tombstones, stray
temp files, the archive rules, unreadable directories and `STATUS.md`. Exit
`2` when at least one **error** exists; warnings are printed but exit `0`.

`nj doctor --fix` repairs only what is unambiguous, in this order: migrate a
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

## 9. Failure codes an agent should handle

With `--json`, `error` is one of a closed set. The ones an agent meets:

| `error` | Meaning | What to do |
|---|---|---|
| `no_backlog` | no source found a backlog | `nj init`, or set `--backlog` / `NJ_BACKLOG` / `.njrc` |
| `invalid_backlog_flag` / `_env` / `_njrc` | that source points at no backlog | fix that source — `nj` does not fall back |
| `invalid_njrc` | a reached `.njrc` is malformed or not yours | fix the named line or file |
| `backlog_without_config` | a `backlog/` was found without its configuration | `nj doctor` |
| `invalid_config` | the configuration violates § 5 | `nj doctor` names the defect |
| `legacy_layout` | a v2 backlog | `nj doctor --fix` migrates it (`docs/MIGRATION-v3.md`) |
| `unknown_field`, `unknown_command` | a typo | the hint lists the known flags |
| `missing_argument`, `missing_value`, `invalid_value`, `invalid_target` | the call itself is wrong | fix the call |
| `not_found` | the `--id`, `--parent`, `--depends-on` or `--file` names nothing | check the ID |
| `duplicate_id` | two files carry this ID | address one with `--file=<path>`, fix by hand |
| `changed_in_parallel` | the file changed between read and write | re-read and retry; `--force` on `set`/`note` only if you mean to overwrite |
| `refused:children_open` | `done` on a parent with open children | finish the children, or `--allow-open-children` |
| `refused:has_children` | `rm` of an element with children | `--cascade`, or remove the children first |
| `refused:not_done` | `archive` of an unfinished subtree | finish it first |
| `refused:archived`, `refused:parent_archived` | writing, or adding a child to, an archived element | archived work is read-only |
| `refused:unreadable` | an unreadable file exists (`rm`, `archive`, as `--parent`) | fix or remove the file `nj doctor` names |
| `refused:misplaced` | a hierarchy archive of a subtree outside its folder | `nj doctor --fix` |
| `refused:unreadable_dir` | an unreadable directory hides part of the backlog | fix its permissions, then `nj doctor` |
| `exists` | `init` target occupied, or an archive target occupied | choose another target, or clear it |
| `io_error` | a filesystem call on a named path failed | read the message; nothing was half-written |
| `id_allocation_failed` | 100 ID retries exhausted under contention | retry |

Element problems arrive in `_problems` on every entry — branch on the codes
(`incomplete:acceptance`, `depends_on:dangling`, `layout:misplaced`, …); the
full closed table is § 7 of the spec.
