# V3.1-A verification — `NJ_AUTHOR` signs `nj note` (`d14c2cc`, TSK-030)

Verifier, 2026-10-03. I didn't write any of this code — it is assigned by
the Lead for independent review (DECISIONS 110: "C is promoted only after
an independent review of its concurrency protocol passes"; A has no
concurrency protocol, but every step gets independent verification before
acceptance). Work ran in `/tmp/verifier-nj-author` (a detached worktree at
`d14c2cc`) plus a throwaway scratch backlog at `/tmp/verifier-nj-author-probe`;
the main tree was never switched or written except to add this file. Runtime
Node v24.21.0. Read: `docs/SPECIFICATION.md` § 9, § 10, the failure-code
tables; `src/commands/cmd-note.ts`, `src/core/args.ts`, `src/core/context.ts`;
`test/ac/ac-25-note-author.js`; DECISIONS 104/110 and the promotion-scope
addendum ("until C is promoted, `nj note --as` is `unknown_field`").

**VERDICT: accept with notes** (original pass; the one finding below is
closed as of the D111 delta at the end of this file — see that section for
the current overall status). The implementation matches § 10 exactly on
every dimension AC-25 and my own probes exercise: trimming (spaces/tabs
only, Unicode spaces literal), single-line and `:`-free validation, empty-is-
unset, `assignee` is never read or written by `NJ_AUTHOR`, other writes and
all reads ignore it, and the four precedence buckets the commit describes
(`unknown_field` → `missing_argument`/`missing_value` for text and `--id`/
`--file` → `invalid_env` → `not_found`/`duplicate_id` → `refused:*`) hold in
every case AC-25 checks and in every case I tried beyond it. **One finding,
low severity, not blocking:** `invalid_target` (`--id` and `--file` given
together) is not covered by the early `requireTargetFlagSyntax()` carve-out,
so when both flags are given *and* `NJ_AUTHOR` is invalid, the result is
`invalid_env`, not `invalid_target` — whereas the sibling case ("neither
flag given") correctly surfaces as `missing_argument` ahead of `invalid_env`.
§ 10's own precedence prose doesn't place `invalid_target` in any of its
three named buckets, so this isn't a contradicted claim, but it is an
inconsistency between two outwardly-parallel checks, and no suite (AC-25 or
otherwise) exercises it. I did not find a byte, a code, or an ordering that
contradicts anything § 10 or § 9 states outright.

## Claims, reproduced

| Claim | Reproduced |
|---|---|
| AC-25 213/213 | ✓ exact — `node test/ac/ac-25-note-author.js dist/nj` |
| run-all 72/73 pass, 0 failed, 1 expected cannot-run | ✓ exact (ran directly: 71/73 + ac-15 cannot-run too, because my worktree isn't nested 4 levels under a runtime dir per v3-preflight.md A2 — purely a path-depth artifact of where I put the worktree, not of the commit; `gate.js`'s own throwaway worktree, built at the required depth, reproduced the commit's exact 72/73 + 1) |
| `gate.js --step=d14c2cc --frozen=c4-baseline` | ✓ exit 0: replay unchanged, oracle 72/73 (1 expected gap, `hardening-njrc-foreign-link.js`, needs root), gate exit 0 |
| `dist/nj` matches `src/commands/cmd-note.ts` | ✓ `git show d14c2cc -- dist/nj` is the same control flow, 1:1, esbuild-mechanical (no behavioural drift between the TS and the bundle) |

## § 10 requirements checked one by one

- **Empty counts as unset.** `NJ_AUTHOR=''` with an assignee signs the
  assignee; without one, `?` (AC-25 N2). Confirmed: the code's own guard is
  `authorEnv !== undefined && authorEnv !== ''`, so empty never reaches
  `validAuthor`.
- **Trimming is spaces/tabs only.** `validAuthor` strips `^[ \t]+`/`[ \t]+$`
  only. I probed a mixed `"  \t name \t  "` value directly against the
  built binary: signed line reads `name` (leading/trailing space+tab gone,
  inner single space kept). NBSP (` `) and em-space (` `) survive
  trimming, matching AC-25's DECISIONS-104 cases and `isWhitespace`-style
  surprises Unicode could otherwise introduce.
- **Single line, no `:`.** `/[\n\r]/` test after trimming catches leading,
  trailing, and inner `\n`/`\r`, including the CRLF-then-spaces case (CRLF
  survives trim because only space/tab classes are stripped, so the `\r`
  remains and still triggers the multi-line rejection) — AC-25's twelve N4
  cases all reproduce, and `invalid_env`'s message echoes the raw
  (untrimmed) value as the commit intends.
- **Never touches `assignee`.** Checked both directions: `note` under a
  valid `NJ_AUTHOR` leaves `assignee:` frontmatter untouched (AC-25 N1, and
  my own probe against `--assignee=bob` under `set` shows `set` still wins
  that field); `note`'s only write is `body`, confirmed via `--json`'s
  `changed: ["body"]` in every one of my probes.
- **Precedence.** `checkFlags` (unknown_field) → `requireTargetFlagSyntax`
  (`missing_argument` when neither `--id` nor `--file` is given;
  `missing_value` transitively via `flagString` if either is given bare) →
  text-empty (`missing_argument`) → `NJ_AUTHOR` (`invalid_env`) →
  `resolveTarget` (`not_found`, `duplicate_id`, and — see the finding below
  — `invalid_target`) → `requireActive` (`refused:archived`). I reproduced
  AC-25's four N7 cases plus the archived-element case, and additionally
  checked `not_found` via `--file`, and `duplicate_id` via two files
  carrying the same `id` in frontmatter: both lose to an invalid
  `NJ_AUTHOR`, exactly as `not_found`/`duplicate_id` losing via `--id` does
  in AC-25.
- **Other writes ignore it; reads never fail on it.** AC-25 N4's per-case
  loop already checks `list`/`list --ready`/`list --all`/`show`/`tree`/
  `doctor` byte-for-byte against the no-`NJ_AUTHOR` control, and N5 checks
  `set`/`new` byte-for-byte. I additionally ran `set --status=doing` and
  bare `list` under an invalid `NJ_AUTHOR` directly against the binary:
  both exit 0, unaffected.
- **`--as` does not exist yet.** AC-25 N6 and DECISIONS 110's promotion-scope
  addendum agree: `nj note --as=reviewer` is `unknown_field`. Confirmed
  directly; `--as` appears nowhere in `cmd-note.ts`'s allowed-fields set.

## The one finding — `invalid_target` vs. `invalid_env`

§ 10 states precedence as three buckets in order: argument parsing
(`unknown_field`, `missing_argument`, `missing_value`), then `NJ_AUTHOR`
(`invalid_env`), then target resolution (`not_found`, `duplicate_id`). It
does not say which bucket `invalid_target` (`--id` and `--file` given
together, § 9's own table) belongs to. The implementation's two `--id`/
`--file` checks are asymmetric: `requireTargetFlagSyntax()` (run early,
ahead of `NJ_AUTHOR`) catches only "neither given" (`missing_argument`);
"both given" (`invalid_target`) is caught later, inside `resolveTarget()`,
which runs *after* the `NJ_AUTHOR` check. I confirmed this against the
binary:

```
$ NJ_AUTHOR='bad:name' nj note --id=TSK-001 --file=TSK-001.md "hi" --json
{"ok":false,"error":"invalid_env"}        # NJ_AUTHOR wins
$ nj note --id=TSK-001 --file=TSK-001.md "hi" --json        # control
{"ok":false,"error":"invalid_target"}
```

This is a real, reachable code path — not a theoretical gap — and it isn't
exercised by AC-25 (its N7 precedence block has four cases: unknown flag,
missing `--id`, `--id` with no value, invalid name vs. unknown target; none
try "both `--id` and `--file`"). Whether `invalid_target` *should* behave
like its sibling `missing_argument` (win, as "argument parsing") or like
`not_found`/`duplicate_id` (lose, as "target resolution") isn't settled by
§ 10's prose either way, so I'm not calling this a contradicted claim — but
the implementation currently treats two checks that read as parallel
("`--id`/`--file` syntax") inconsistently with each other, and that
inconsistency has no test pinning it in either direction. I'd either
extend `requireTargetFlagSyntax()` to also catch "both given" (making it
symmetric with "neither given", and with `missing_value`), or add one line
to § 10 saying explicitly that `invalid_target` sits in the target-
resolution bucket (if that's the intended reading) — and either way, add
an AC-25 case for it so the behaviour stays pinned.

## What I did not re-check

Everything about `## Notes` heading placement, blank-line discipline,
multi-note ordering, and the body/`updated`/atomic-write mechanics is
unchanged v3 behaviour (§ 10's rules predate this commit; `cmd-note.ts`'s
diff touches only the signer and the two new functions). AC-17/18/21-24 and
the rest of the oracle cover that ground already and are unaffected here
(confirmed green above); I did not re-derive it independently since it is
not what `d14c2cc` changed.

## Scope not yet promoted

§ 0's acting-name precedence (`--as` > `NJ_AUTHOR` > none) is proposal-only
until `C` (`claim`/`release`) is promoted; this commit correctly implements
only the `NJ_AUTHOR`-alone case and AC-25/DECISIONS 110 agree `--as` must
stay `unknown_field` until then. Nothing in `d14c2cc` anticipates or
hard-codes a future `--as` in a way that would need undoing later — the
signer logic is `author !== null ? author : assignee-or-?`, with no `--as`
branch to retrofit around.

## D111 delta — `invalid_target` ranked with argument parsing (`88fb382`, `77a8ac2`)

Checked in a fresh worktree at `77a8ac2` (`/tmp/verifier-nj-author-d111`),
plus a throwaway scratch backlog (`/tmp/verifier-nj-author-d111-probe`);
the `d14c2cc` worktree and probe dir from the first pass were removed
first. **VERDICT: accept — the finding is closed, A can be accepted.**

- `docs/SPECIFICATION.md` § 10 (`88fb382`) now names `invalid_target`
  ("`--id` and `--file` given together") inside the argument-parsing
  bucket, ranked with "neither given," and states that the wrong-type-
  `--parent` reading of `invalid_target` doesn't apply to `note` (no
  `--parent` flag exists on it) — this reads unambiguously now; nothing
  else in § 10 changed.
- `src/commands/cmd-note.ts` (`77a8ac2`): `requireTargetFlagSyntax()` gained
  one line, `if (file !== undefined && id !== undefined) fail('invalid_target', ...)`,
  ahead of the existing "neither given" check and the `NJ_AUTHOR` check
  below it. `git diff d14c2cc 77a8ac2 -- dist/nj src/` is exactly that one
  line (plus its mirror in `dist/nj` and an updated comment) — confirmed
  directly; nothing else in the command changed.
- **The finding's own repro, re-run against `77a8ac2`'s `dist/nj`:**
  `NJ_AUTHOR='bad:name' nj note --id=TSK-001 --file=TSK-001.md "hi" --json`
  now returns `{"ok":false,"error":"invalid_target"}` (was `invalid_env`),
  exit 1, nothing written. A **valid** `NJ_AUTHOR` under the same `--id`/
  `--file` conflict also still returns `invalid_target` (the conflict
  isn't let through either way), matching AC-25's two new N7 cases.
- **Siblings re-checked, all unchanged:** "neither `--id` nor `--file`
  given" + invalid `NJ_AUTHOR` → still `missing_argument`; `--id` with no
  value + invalid `NJ_AUTHOR` → still `missing_value`; `not_found` (via a
  nonexistent `--file`) + invalid `NJ_AUTHOR` → still `invalid_env`
  (target resolution still loses to `NJ_AUTHOR`, as before);
  `duplicate_id` (two files sharing an `id`) + invalid `NJ_AUTHOR` → still
  `invalid_env`. None of these four orderings moved.
- **AC-25: 219/219** (the two new N7 cases plus the original 213). **Full
  oracle:** `node test/run-all.js dist/nj` directly: 71/73 pass, 0 failed,
  2 cannot-run (the usual `hardening-njrc-foreign-link.js` root gap, plus
  `ac-15-no-dependencies.js` — a path-depth artifact of my worktree not
  being nested where v3-preflight.md A2 expects the runtime, same as in
  the first pass, not a defect). `node tools/refactor-harness/gate.js
  --step=77a8ac2 --frozen=c4-baseline`, which builds its own correctly-
  nested worktree: **exit 0** — replay unchanged, oracle 72/73 (the one
  expected gap), gate green. Both runs show `ac-25-note-author.js (219
  checks)`.
