# nanojira — agent instructions

Copy the block below into the project's `AGENTS.md`. Full rules:
`docs/GUIDE.md`, `docs/SPECIFICATION.md`.

```md
## Task tracking (nanojira)

This project tracks work with `nanojira` (NanoJira) — a backlog of epics, tasks
and subtasks, one Markdown file per element, committed alongside the code.

- Always add `--json` and branch on the result, never on prose:
  `nanojira list --json`, `nanojira show --id=<id> --json`.
- Unsure what values `--type`/`--status`/`--priority` accept? `nanojira <command>
  --help` (e.g. `nanojira set --help`) prints that command's own flags and the
  allowed values for each — never guess, and don't rely on a stale list in
  a doc or a prior response.
- To pick up the next piece of work yourself: `nanojira next --as=<your-name>
  --status=doing --json` — picks the highest-priority ready item and
  claims it in one call, so two agents never pick the same one. If
  nothing is ready, it reports `none_ready`; that's a normal outcome; ask
  for more work or stop. Reach for `nanojira claim --id=<id> --as=<your-name>`
  instead when you already know which specific element you want (someone
  pointed you at it, or you're resuming your own earlier claim). `next`
  never hands out an element already assigned to someone else — assign a
  review to the reviewer (`nanojira set --id=<id> --assignee=<reviewer-name>`),
  never to the author of the thing being reviewed, so `next` keeps it out
  of the author's own hands automatically.
- Read before you write: `nanojira show --id=<id> --json` to see the current
  state (resolving exactly one id? read `.entry` off the result directly
  — identical to `entries[0]`, absent only for a `duplicate_id` target),
  then `nanojira set --id=<id> --status=... [--title=... --priority=...
  --tags=... --assignee=... --depends-on=... --description=...
  --acceptance=...]` to change only the fields you intend to.
- Anything multi-line, or more than one field flag's worth of structure —
  a description with embedded newlines, a whole epic/task/subtask tree —
  reach for `--input=-` with a heredoc instead of threading it through
  field flags: `nanojira new --input=- --json <<'EOF' ... EOF`. `new --input=`
  additionally takes a whole plan (an object, or an array, with `children`
  nesting — parent implied by the nesting) in one call; `set --input=`
  takes the same field map as its own flags, just as JSON. `acceptance`
  may be a JSON array of strings there (and only there) — each one
  becomes a `- [ ] …` line, so you never have to remember the checkbox
  syntax by hand. A `depends_on` entry starting with `@` resolves against
  a `ref` declared *earlier* in the same plan; a forward reference is
  rejected, not silently wrong. `docs/GUIDE.md` § 21 has a full worked
  example and how to recover from a mid-plan failure.
- To change *just one* tag without re-listing every other one: `nanojira set
  --id=<id> --add-tags=<a,b>` / `--remove-tags=<c,d>` instead of
  `--tags=`, which replaces the whole list. Never combine `--tags=` with
  either in the same call (rejected) — pick one or the other.
- When you're done with a claimed element, mark it `nanojira set --id=<id>
  --status=done` (or `nanojira claim --id=<id> --as=<your-name>
  --status=done` in one call) — reaching the last configured status
  releases your own claim automatically, reported as `released:
  "<your-name>"`; there's no separate `nanojira release` to remember afterward.
  If you're stopping *without* finishing, release explicitly instead:
  `nanojira release --id=<id> --as=<your-name>`, so someone else can claim it.
- Running nanojira alongside an external coordination system (a team/chat
  board, ticket tracker, anything outside nanojira itself)? Update nanojira
  first — status, acceptance, notes — and only report completion on the
  external system afterward, never the other way around. nanojira has no
  daemon and no network (`next` is pull-only — docs/GUIDE.md § 14); an
  optional `NJ_ON_CHANGE` hook (env only — docs/GUIDE.md § 30) can push
  changes outward, but unless your environment sets one, nothing keeps it
  in sync with an external system automatically, so if the external side
  is marked done first, nanojira can only stay stale until someone
  remembers to go back and fix it by hand.
- Never hand-edit files under `backlog/` — always go through `nanojira`.
- Tick acceptance criteria with `nanojira check --id=<id> --text="<substring>"`,
  never by editing the checkbox text yourself — and tick every box
  *before* setting `--status=done`, not after: a `done` task/subtask with
  an unticked box draws the `done:open_acceptance` warning (never
  blocking, but `nanojira doctor` will flag it, and someone will ask).
- Reorganising the backlog? `nanojira set --id=<id> --parent=<new-parent-id>`
  moves a task under a different epic (or a subtask under a different
  task) in place — id, body, notes and claim all carry over unchanged.
  Never `nanojira rm` and recreate just to change where something sits; that
  loses the id, the history and any claim on it. The new parent must
  already exist, be live and be the right type, same as `new --parent`.
- Sign notes with `nanojira note --id=<id> "..." --as=<your-name>` — or
  `--text="..."` / `--text-file=<path|->` instead of the positional
  argument, same content, same validation; exactly one of the three.
- Only need to confirm a write happened, or just a couple of fields back?
  `new`/`set`/`note`/`check`/`claim`/`release --json` accept `--quiet`
  (`{ok, id}`, plus `_problems` when one is open) and
  `--fields=<a,b,...>` (keeps `entry` only, cut down to those names, in
  that order) instead of the full ~600-byte result — cheaper than piping
  through `head`/`grep`, which risks silently parsing the wrong thing.
  Both require `--json`, are mutually exclusive with each other and with
  `--input`, and apply the same way to each successful member of a batch
  `--id=A,B,C` result; a failed member is never shrunk.
- A ticket with 20+ notes? Don't grep the `.md` file for the latest one —
  `nanojira show --id=<id> --notes=last:1` (or `last:N`, or `none` to hide
  them entirely) and `nanojira log --id=<id> --last=N` both narrow to the
  newest `N` instead, with `--json` adding `notes_total`/`events_total` so
  you still know how much you aren't seeing. Leaving either flag off is
  the unchanged default (everything).
- Need to see what a write would do before doing it? Add `--dry-run` to
  any write command (`new`, `set`, `note`, `check`, `claim`, `release`,
  `next`, `archive`, `unarchive`, `rm`, `init`, `doctor --fix`): nothing is
  written, the result is the real call's own (same `error` code on a
  refusal) plus `"dry_run": true` and `"changes"`, the files it would
  create/modify/delete with their full contents. An id it shows is not
  reserved, so read the id off the real call's result.
- Picking up someone else's work, or just confused about an element?
  `nanojira log --id=<id> --json` shows what happened to it: when it was
  created, every claim/release (if made on this machine — that history
  doesn't travel with a clone), and its notes, in order. It does not show
  field changes like `status` or `priority` — leave a note for those.
- On failure, `{"ok": false, "error": "<code>", ...}` — branch on `error`,
  not on the hint text. Element-level issues arrive per entry in
  `_problems` the same way. A `refused:*` code that has a flag to make
  the **same** call succeed anyway (`--allow-open-children`, `--force`,
  `--cascade`, `--steal=<holder>`) is named in
  `docs/SPECIFICATION.md` § 9 "Failure codes — spec-named paths"'s own
  "Override flag" column — branch on the code, not on the hint text, but
  that table is the lookup for which flag to add, not the hint.
```
