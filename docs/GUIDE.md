# nj — a guide for agents and humans

`nj` keeps a backlog of epics, tasks and subtasks as one Markdown file per
element, next to your code. This guide shows how to use it; the rules behind
every answer are in `docs/SPECIFICATION.md` (spec v3, through v3.7), and
where this guide and the spec differ, the spec wins.

**Upgrading an existing backlog?** `nj` refuses to touch a v2 backlog
(`.nanojira.json`/`.ids/` at the top level) until you run the one
`doctor --fix` that migrates it — see `docs/MIGRATION-v3.md`. Upgrading
from an earlier v3 release (this guide already describes the latest):
`docs/CHANGES.md`.

This describes spec v3.7's end state. Most examples below were run directly
against `dist/nj`; output is shown as it is printed, with the
machine-specific path shortened to `…`.

```sh
alias nj="$PWD/dist/nj"       # or: <runtime-node> dist/nj  (§ 4)
```

---

## 1. Install

`dist/nj` and `dist/nj-mcp` are each a single, self-contained file (no
runtime dependencies, § 3 of the spec) — there is nothing to `npm install`
on the machine that runs them.

- Put `dist/nj` on your `PATH`, either by copying it somewhere already on
  `PATH` or by symlinking it there (`ln -s /path/to/dist/nj /usr/local/bin/nj`,
  or wherever your `PATH` already reaches); `dist/nj-mcp` the same way if you
  also want it runnable by name. One install serves every project on the
  machine (§ 4, below) — nothing further to install per project.
- Per project: run `nj init` once (§ 2) to create that project's `backlog/`.
- Per project, if the project uses `nj-mcp`: add one `nj-mcp` entry to that
  project's MCP client config, pointed at that project with its own
  `--backlog=` (§ 4, below, and § 19's client-config shape) — never a single
  shared entry meant to serve several projects.
- Verify the install with `nj --version`, which prints `nj <version>` and
  exits 0 from anywhere, without needing a backlog (§ 9 of the spec).
- **No `node` on `PATH`?** `dist/nj`'s shebang (`#!/usr/bin/env node`)
  needs `node` resolvable there to run as `nj` directly. If an agent's
  environment doesn't put `node` on `PATH` but does have one available at
  a known path, run `dist/nj` with it explicitly instead of relying on
  the shebang: `node /path/to/dist/nj --version` (and the same for
  `dist/nj-mcp`, in whatever launches it) — `dist/nj` is a plain Node
  script underneath, so this always works, symlinked onto `PATH` or not.

## 2. Start a backlog

```sh
$ nj init
Created backlog at …/proj/backlog
  epics/ tasks/ subtasks/ archive/ .nanojira/
  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md
```

`init` creates `./backlog/` with the default configuration, a `README.md`, a
`.gitignore`, a `STATUS.md` and the empty type folders `epics/`, `tasks/`,
`subtasks/`, `archive/`; everything only `nj` needs — the configuration and
the tombstones — lives in one hidden folder, `.nanojira/`. Commit all of
the **files**: tombstones (`.nanojira/ids/`) are what guarantee that an ID
is never reused. **The empty type folders themselves need not be
committed** — git does not track empty directories at all, so a clean
checkout of a freshly-`init`ed backlog simply will not have them; this is
fine, not a defect, because `nj` creates whichever folder it needs the
first time something goes into it (`epics/` on the first epic, `archive/`
on the first archive, and so on) and never treats a missing empty type
folder as a problem (`nj doctor` stays clean either way).

- Somewhere else: `nj init --backlog=../shared/backlog`, or with `NJ_BACKLOG`
  or a `.njrc` set (next section). `init` never looks for an existing
  `backlog/` folder upward — without a source it always means `./backlog`.
- `init` refuses with `exists` if anything is already at the target, even an
  empty directory.

## 3. Point nj at a backlog

Every command finds its backlog from the **first** of these that is set:

| Source | Relative paths resolve against |
|---|---|
| `--backlog=<path>` (every command) | the working directory |
| `NJ_BACKLOG=<path>` | the working directory |
| the upward search: in each directory from here to `/`, first a `.njrc` that sets `backlog`, then a `backlog/` folder | the `.njrc`'s own directory |

The **nearest directory wins**, and within one directory `.njrc` beats
`backlog/`. A `.njrc` in a repository root therefore redirects the whole
repository, while a project with its own `backlog/` deeper down keeps it.
This is deliberate, not incidental: running `nj` from **anywhere** that
genuinely has no backlog of its own and no `--backlog`/`NJ_BACKLOG`
override — including a scratch or temporary directory — will find an
unrelated `backlog/` sitting in one of its ancestors if one happens to be
there (another project's, say); give an explicit `--backlog`/`NJ_BACKLOG`
whenever that ambiguity matters, rather than relying on "no backlog
nearby" being true of a path you don't control.

**`--backlog`/`--json` also work before the command word**, not just after
— either order, either place, repeated or mixed:

```sh
$ nj --backlog=../shared/backlog list --json | head -2
{
  "backlog": "…/shared/backlog",
```

runs `list` exactly as `nj list --backlog=../shared/backlog` would; a flag
other than these two ahead of the command word (even one valid for the
command that follows, like `nj --status=doing set --id=TSK-001`) is
`unknown_field` against the bare invocation instead — the command word is
never silently dropped or reached past.

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

## 4. Many projects on one machine

One `nj` install serves every project on the machine — there is nothing
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

**`nj-mcp`, differently: one server process is fixed to one backlog for its
whole life**, resolved once at startup (§ 19 below, § 17 of the spec) —
there is no per-call backlog switch. With several projects, configure one
`nj-mcp` entry **per project** (each with its own `--backlog=`, or each
started with that project as its working directory), not one shared entry
meant to serve all of them: a single `nj-mcp` process can only ever answer
for the one backlog it started with.

## 5. The daily loop (and `--json` for agents)

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
TSK-001 → description=(body section), acceptance=(body section)
$ nj set --id=TSK-001 --status=doing
TSK-001 → status=doing
$ nj note --id=TSK-001 "Route wired, tests pending"
TSK-001 note added
$ nj set --id=TSK-001 --status=done
TSK-001 → status=done
```

- `nj note` appends `- <time> <author>: <text>` under `## Notes`; the author
  is the element's `assignee`, else `?`. A multi-line `<text>` is kept, not
  flattened: every line after the first is indented two spaces under the
  `- <time> <author>:` line (a Markdown list continuation), and `nj log`
  reads it back out the same way it went in:

  ```sh
  $ nj note --id=TSK-001 "$(printf 'First line\nSecond line')"
  $ tail -3 backlog/tasks/TSK-001.md
  ## Notes
  - 2026-10-06T21:16:23Z alice: First line
    Second line
  ```
- `nj set --status=done` on a parent with open children is refused
  (`refused:children_open`); `--allow-open-children` forces it and leaves a
  `done:open_children` warning. `--force` means only one thing: overwrite a
  parallel change.
- Fields are the frontmatter names: `--title --status --priority --tags
  --assignee --depends-on`. An unknown flag is rejected and nothing is
  written — `--statuss=done` does not "almost work".
- **`--tags=` replaces the whole list** — easy to lose one by hand if you
  only meant to change one. `nj set --add-tags=<list>` /
  `--remove-tags=<list>` edit it incrementally instead: remove takes
  effect first, then add appends anything not already present.

  ```sh
  $ nj set --id=EPIC-001 --remove-tags=waiting:user --add-tags=blocked:review
  EPIC-001 → tags=repo:app-test,blocked:review
  ```

  Adding a tag already there, or removing one that isn't, is a no-op for
  that tag, not an error. Combined with `--tags=` in the same call is
  rejected — pick one or the other. Works in batch (`--id=A,B,C`) too,
  each ID's own tags read and changed independently.
- Reads: bare `nj` (short status), `nj list [--status --type --tag --parent
  --assignee --ready --all]`, `nj tree`, `nj show --id=…`, `nj find "<text>"`
  (§ 17 below).

**Don't guess which `--type`/`--status`/`--priority` values are allowed —
ask.** `nj <command> --help` prints that command's own flags, including the
allowed values for each (the backlog's own configured `statuses` when one
resolves, else the defaults):

```sh
$ nj set --help
  nj set   --id=TSK-009 [--title=…] [--status=…] [--priority=…]
           [--tags=…] [--assignee=…] [--depends-on=…] [--force] [--allow-open-children]
           [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]

  --id
  --file
  --title
  --status=<value>   allowed: todo, doing, blocked, review, done
  --priority=<value>   allowed: low, normal, high, urgent
  …
```

and a typo'd value — one close enough to exactly one allowed value —
names it in the hint, never silently, never as an accepted alias:

```sh
$ nj set --id=EPIC-001 --priority=hgih --json
{
  "ok": false,
  "error": "invalid_value",
  "hint": "did you mean 'high'? Known priorities: low, normal, high, urgent"
}
```

**For agents: add `--json` to every call.** Reads return `{backlog, counts,
entries}` — `nj show --json` on a single id additionally carries `entry`,
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

## 8. `STATUS.md`

A generated overview of the active backlog by status, readable in an editor
or a forge without `nj` — here for a backlog configured with the statuses
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
to change). Verified live: with it off, `nj doctor` does not check
`STATUS.md` at all (no `backlog:status_stale`, clean either way) and
`STATUS.md` itself, if one already existed from before the flag was
flipped, is simply left wherever it was — `nj` never touches it again.
Nothing else about the backlog changes: IDs, claims and every element's
own file are exactly as they'd be with the file on.

The same overview `STATUS.md` gave for free still has two `nj` equivalents,
neither of which writes anything:

```sh
$ nj                 # bare: counts, top 5 ready, same "Ready to work" as always
$ nj list --json     # every element, filterable the same way STATUS.md's
                      # sections group them (--status, --type, --tag, …)
```

A forge or an editor browsing the repo directly loses the generated
Markdown view, but every agent (and `nj doctor`) already gets the same
information from `nj`/`nj list` on demand, without the merge noise.

## 9. Archive

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

## 10. `doctor` and `doctor --fix`

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

**Too many warnings in `doctor`'s report?** `"problems": {"ignore":
[...]}` in `.nanojira/config.json` lists warning-level codes (§ 7 of the
spec has the full list) to stop seeing reported — in `doctor`, in
`_problems`, and in `new`/`set`/`note`/`check`'s own text feedback —
without touching the underlying condition itself (an ignored
`unknown:status`, for example, still keeps its element out of
`--ready`; only the reporting goes quiet). An **unrecognised** key or
code anywhere in the configuration (`problems` included) is itself just
another warning (`config:unknown_key`/`config:unknown_code`), never a
hard failure — a typo stays visible without stopping work.

**No rollout order needed for this one:** an `nj` older than 3.7 already
silently ignores an unrecognised *top-level* config key (confirmed
directly against 3.5.0 and 3.6.0), so adding `"problems"` or
`"minVersion"` (below) today is safe even while some machines haven't
upgraded yet — they simply won't act on either key until they do.

**`"minVersion": "X.Y.Z"`** makes every command, including `doctor`,
fail with `needs_newer_nj` (naming both the running and required
versions) when this `nj` is older than that — `nj --version` and `nj
<command> --help` still work regardless, since neither depends on the
backlog's configuration the way every other command does.

## 11. Who's acting: `NJ_AUTHOR` and `--as`

`nj note`, `nj claim` and `nj release` need to know who is acting. In order:
an explicit `--as=<name>` where the command has one, else `NJ_AUTHOR=<name>`
from the environment, else none. A name must be non-empty after trimming
leading/trailing spaces and tabs, a single line, and contain no `:`.

```sh
$ NJ_AUTHOR=alice nj note --id=TSK-001 "wired the route"
$ nj claim --id=TSK-001 --as=bob
```

An invalid name is a hard error on a command that needs one, nothing
written — `invalid_env` for `NJ_AUTHOR`, `invalid_value` for `--as` (which
outranks a malformed `NJ_AUTHOR`). Names are labels, not identities: there
is no registry, no authentication; two callers using the same name are the
same actor.

## 12. `nj unarchive`

Moves an archived element — and its archived subtree — back to where it
would live today, byte-identical except `updated` and a removed
`archived:` field:

```sh
$ nj unarchive --id=EPIC-001
EPIC-001 unarchived → …/backlog/epics/EPIC-001.md
TSK-001 unarchived → …/backlog/tasks/TSK-001.md
```

Refuses `refused:not_archived` if it isn't archived, `refused:parent_archived`
under an archived parent, `refused:misplaced` if its hierarchy chain can't
be resolved first — `nj doctor --fix`, same pointer `archive`'s own
refusals give.

## 13. `nj claim` / `nj release`

One acting name at a time can hold an element. A claim is exclusive only
against another claim — never against a read or any other write:

```sh
$ nj claim --id=TSK-001 --as=alice
TSK-001 claimed by alice
$ nj claim --id=TSK-001 --as=bob
Error: TSK-001 is already claimed by alice — refused          # exit 1, refused:claimed
use --steal=<holder> to take it over
$ nj claim --id=TSK-001 --as=bob --steal=alice
TSK-001 claimed by bob
$ nj release --id=TSK-001 --as=bob
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
  Nothing is ever auto-released or auto-stolen — it's a signal for a human
  or agent to act on with `--steal`, never something `nj` acts on itself.
- **History.** These claim events feed into `nj log` (§ 15, below).
- **A write that reaches the last configured status releases the claim
  on its own** — `nj set --status=done`, `nj claim --status=done`, `nj
  next --status=done` alike, whoever holds it, in the same call:

  ```sh
  $ nj claim --id=TSK-001 --as=alice
  TSK-001 claimed by alice
  $ nj set --id=TSK-001 --status=done --json
  { "ok": true, "id": "TSK-001", "changed": ["status"], "...": "...",
    "released": "alice" }
  ```

  No more separate `nj release` after finishing — `released` is simply
  absent from the result when nothing was claimed. A write refused for
  another reason (`refused:children_open` without
  `--allow-open-children`, for one) releases nothing; the claim survives.

## 14. `nj next`

`list --ready` then `claim` by hand leaves a gap: two callers can read the
same top candidate before either claims it. `nj next` closes it — one
call picks the highest-ranked `--ready` element and claims it:

```sh
$ nj next --as=alice --status=doing
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
  agent with `nj set --id=<id> --assignee=<name>`, and only that name's
  own `next` (or an explicit `nj claim --id=<id> --as=<name>`) will pick
  it up. This is also the answer to "an author shouldn't review their
  own work": assign the review task to the reviewer, not the author, and
  `next` keeps it out of the author's hands on its own.
- **Leaf work only.** A container with an open child (neither `done` nor
  archived) is never a candidate — its child is, instead:

  ```sh
  $ nj next --as=alice
  TSK-001 claimed by alice
  ```

  (claimed the one open task under `EPIC-001`, not the epic itself — an
  epic is only ever picked once it has no open child left: no children
  at all, or every one of them `done`/archived.)
- **Nothing to claim** is `none_ready`, exit 1 — a normal outcome, not a
  bug:

  ```sh
  $ nj next --as=carol --json
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

## 15. `nj log`

The change history of one element — what already exists, merged into one
timeline: when it was created, every claim/re-claim/steal/release, and
its notes.

```sh
$ nj log --id=TSK-001
2026-10-05T22:43:37Z created
2026-10-05T22:43:38Z claimed by alice
2026-10-05T22:43:40Z alice: Parser splits at the first colon
2026-10-05T22:43:41Z released by alice
```

```sh
$ nj log --id=TSK-001 --json
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
  $ nj set --id=TSK-001 --status=doing --priority=high
  $ nj log --id=TSK-001
  2026-10-05T22:43:37Z created
  2026-10-05T22:43:38Z claimed by alice
  2026-10-05T22:43:40Z alice: Parser splits at the first colon
  2026-10-05T22:43:41Z released by alice
  ```

  (identical to the run above — the `set` changed nothing `log` can see.
  Leave a `nj note` if a field change is worth remembering later.)
- **Claim history is local, and archiving erases it outright.**
  `.nanojira/claims/` is git-ignored (one of the lines `nj init` writes
  into `.gitignore`, § 2 above; spec § 12a), so a fresh
  clone shows `created` and notes only — the claims happened, but their
  record never left the machine that made them. `archive` goes further:
  it deletes `.nanojira/claims/<id>/` as part of the move, so `log`
  loses the claim events even on the machine that made them:

  ```sh
  $ nj archive --id=TSK-001
  $ nj log --id=TSK-001
  2026-10-05T22:43:37Z created
  2026-10-05T22:43:40Z alice: Parser splits at the first colon
  ```

  (the `claimed`/`released` pair is gone; `created` and the note
  survive.)

For a git-backed backlog, `git log -p -- backlog/tasks/TSK-001.md` is the
manual complement for the one thing `log` doesn't show: field-level diffs,
at the cost of only seeing whatever was actually committed, in whatever
granularity your commits happen to have.

## 16. `nj check`

Ticks or unticks one Markdown checkbox in the body, without touching
anything else:

```sh
$ nj check --id=TSK-001 --text="200 with a valid password" --on
TSK-001 checked
```

- Address it by `--text=<substring>` (the common case) or `--item=<n>`
  (1-based, document order) — exactly one of the two. With neither `--on`
  nor `--off`, the command ticks (`--on` is the default); both together is
  `invalid_value`.
- A checkbox inside a fenced code block, or under `## Notes`, is never
  matched. `--text` naming zero countable checkboxes is `not_found`; two or
  more is `ambiguous_target`.

## 17. `nj find`

Full-text search over title, body and notes:

```sh
$ nj find "rate limiting"
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
$ nj set --id=TSK-001,TSK-002,TSK-003 --status=done --json
```

Every named ID is resolved and validated **before** anything is written —
an unknown ID, a repeated one, or a refusal a single call would already
give aborts the whole batch, nothing written for any ID. Past that point
each ID writes independently: one ID's bad luck (a parallel edit, a
competing claim) never stops the others. The result is `{ok, results:
[{id, ok, …}]}` instead of one write's usual shape; a single `--id=A` (no
comma) is unaffected.

## 19. `nj-mcp` — the MCP wrapper

`dist/nj-mcp` is a second binary, built alongside `dist/nj`, that exposes
the same commands as MCP tools over stdio instead of a CLI an agent has to
shell out to and parse `--json` from:

```sh
$ dist/nj-mcp --backlog=./backlog [--allow-destructive]
```

- Resolves its backlog once at startup, the same rules as the CLI
  (`--backlog`, `NJ_BACKLOG`, `.njrc`), and serves only that one backlog.
- Every tool's result **is** exactly the JSON `dist/nj --json` would return
  for the equivalent CLI call — nothing to learn beyond the contract above.
- Tools: `list`, `show`, `find`, `tree`, `new`, `set`, `note`, `check`,
  `claim`, `release`, `archive`, `unarchive`, `doctor`. **`rm` is never
  offered.** `archive`/`unarchive` are offered ungated (both reversible);
  `doctor --fix` only exists as a tool when the server was started with
  `--allow-destructive`.
- A minimal client config — the shape only; where this goes is your MCP
  client's own concern, not `nj`'s:
  ```json
  { "command": "node", "args": ["/path/to/dist/nj-mcp", "--backlog=/path/to/backlog"] }
  ```

## 20. Failure codes an agent should handle

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
| `ambiguous_target` | `check --text` matches two or more checkboxes | narrow the text, or use `--item=<n>` |
| `invalid_env` | `NJ_AUTHOR` is not a valid acting name | fix it, or use `--as` instead |
| `not_found` | the `--id`, `--parent`, `--depends-on` or `--file` names nothing | check the ID |
| `duplicate_id` | two files carry this ID | address one with `--file=<path>`, fix by hand |
| `changed_in_parallel` | the file changed between read and write | re-read and retry; `--force` on `set`/`note`/`check` only if you mean to overwrite |
| `refused:children_open` | `done` on a parent with open children | finish the children, or `--allow-open-children` |
| `refused:has_children` | `rm` of an element with children | `--cascade`, or remove the children first |
| `refused:not_done` | `archive` of an unfinished subtree | finish it first |
| `refused:claimed` | `claim`/`release` where another acting name holds it | `--steal=<holder>` if that's intended |
| `refused:not_archived` | `unarchive` of something that isn't archived | nothing to do |
| `refused:archived`, `refused:parent_archived` | writing, or adding a child to, an archived element | archived work is read-only |
| `refused:unreadable` | an unreadable file exists (`rm`, `archive`, as `--parent`) | fix or remove the file `nj doctor` names |
| `refused:misplaced` | a hierarchy archive of a subtree outside its folder | `nj doctor --fix` |
| `refused:unreadable_dir` | an unreadable directory hides part of the backlog | fix its permissions, then `nj doctor` |
| `exists` | `init` target occupied, or an archive target occupied | choose another target, or clear it |
| `io_error` | a filesystem call on a named path failed | read the message; nothing was half-written |
| `id_allocation_failed` | 100 ID retries exhausted under contention | retry |

Element problems arrive in `_problems` on every entry — branch on the codes
(`incomplete:acceptance`, `depends_on:dangling`, `layout:misplaced`,
`claim:stale`, `claim:mismatch`, `claim:orphaned`, …); the full closed
table is § 7 of the spec.

## 21. Creating a whole plan with `--input`

Field flags build one element per call. For an epic with several tasks
and subtasks, cross-referencing each other via `depends_on`, `nj new
--input=<file|->` takes the whole thing as one JSON plan instead — an
object, or an array of objects, each of which may nest its own `children`
(the parent is implied by the nesting, never given alongside it). `nj set
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
$ nj new --input=plan.json --json
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
$ nj new --input=- --json <<'EOF'
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
- **`--dry-run`** (`new --input=` only): runs the full validation pass and
  writes nothing — no id, no file, no `refs`, a `children` entry's implied
  parent shown as a JSON path (`"[0]"`) instead of a real id, since none
  was ever assigned. Use it to check a plan before committing to it:

  ```sh
  $ nj new --input=plan.json --dry-run --json
  { "ok": true, "dry_run": true,
    "entries": [
      { "type": "epic", "title": "Login", "_problems": [] },
      { "type": "task", "parent": "[0]", "title": "Login route", "_problems": [] }
    ] }
  ```

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
