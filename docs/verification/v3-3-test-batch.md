# V3-3 test batch audit — weakened assertions? (`5f73e93`, `cc3f35e`, `7dee4a7`, plus `90a0c7d`)

Verifier, 2026-09-28.
- **Scope:** every hunk of `git diff 8736bf0..7dee4a7 -- test/`, i.e. ten
  files, among them `test/lib/harness.js`.
- **Added:** `90a0c7d`, which edits the two batch suites
  `archive-rm-byte-identity` and `exit-doctor-fix` again after the named
  commits.
- **Rulings used:** DECISIONS 91 (scan bounds) and DECISIONS 100 (batch
  strategy and `STATUS.md` edge rules).

**VERDICT: no assertion was weakened beyond what DECISIONS 100 allows.**
- Every edited existing suite is as strict as before or stricter.
- The two deliberate relaxations are as narrow as D100 permits, with one
  cosmetic breadth nit (T2).
- `H.statusFor` is an independent, spec-derived re-implementation that
  follows D91 point by point.
- The before/after table reproduces the Oracle's neutrality claim: the only
  differences are the 10 new checks.

**One real finding (T1):** D100's clause "`fixed[]` names the regeneration
when an earlier step's move or rename made `STATUS.md` stale" has no check
that fails when it's violated. `COVERAGE-v3.md` S22 marks it COVERED. That's
a coverage gap for V3-3, not a loosening of anything existing.

## Hunk by hunk

| File | Change | Judgement |
|---|---|---|
| `ac/ac-13-json-contract.js` | the closed `TABLE` gains `layout:misplaced`, `backlog:unreadable_dir`, `backlog:legacy_layout`, `backlog:status_stale` | Required by D100 and § 7. `TABLE` is used only as the membership set (`SEEN − TABLE` must be empty, line 489); no count assertion changed. Effect, intended: a pre-v3 build that emitted one of these codes is no longer flagged by *this* suite (mutant m3: 3 → 2 failures). |
| `ac/ac-14-determinism.js` | +1 block, +2 checks: an unknown priority sorts with weight 2 (D100 70) | stricter |
| `ac/ac-22-layout.js` | `mkLayoutBacklog` writes a fresh overview; `mdFiles` excludes `STATUS.md` **at the top level only** (`r !== 'STATUS.md'` on the relative path; a nested `x/STATUS.md` still counts, as D91 B12 wants); `H.writeStatus` before the pinned "only `<code>` findings" doctor set of each migration, and in the chmod-000 case | Neutral: the pinned sets stay exact. **But see T1:** `7dee4a7` replaced the expectation "after a layout change the overview is stale (`backlog:status_stale` in the set)" with a refresh, and no other suite took that expectation over. |
| `ac/ac-23-status-overview.js` | the local `renderStatus` moves to `H.renderStatus` (logic identical; default statuses from `DEFAULT_CONFIG` = the same five); new C0 checks `H.statusFor` against the C3/C4 goldens; new C3b (unknown priority, lines spelled out, not rendered) | stricter; nothing removed except the renderer's local copy and the "Not asserted" note |
| `edge/archive-rm-byte-identity.js` | `checksumAll` skips `r === 'STATUS.md'` | **Relaxation 1**, exactly as narrow as D100: only the top-level file (the relative path must equal `STATUS.md`), skipped before the stat. Every other file, a nested `STATUS.md` included, is still hashed, so a stray or extra file anywhere is still caught (mutant m1, below). |
| `edge/fix-duplicate-mtimes.js`, `edge/unreadable-stub-refusals.js` | `H.writeStatus(d)` after the hand edits, before the pinned doctor set | neutral: the sets stay exact; a wrong renderer can only make them fail, never pass (mutants m2/m3 caught before and after) |
| `stress/concurrency.js` | "problems[] is empty" → "every problem is `backlog:status_stale` with severity `warning`" | **Relaxation 2**, as D100 rules ("no error finding; `status_stale` the one tolerated warning"); `doctor` exit 0 and `ok=true` are still asserted separately. Nit T2: it tolerates *any number* of `status_stale` entries, where a backlog-level code can appear only once. |
| `lib/harness.js` | `renderStatus`, `statusFields`, `statusFor`, `writeStatus`; `mkBacklog` writes a fresh `STATUS.md` into every fixture | see the next section; T3 |
| `90a0c7d` `archive-rm-byte-identity` | walk, archived-file reads and list reads made null-safe | Strict: a missing file becomes `'<file missing>'` and an unreadable one `'<unreadable>'`, so both *fail* the comparison instead of throwing. |
| `90a0c7d` `exit-doctor-fix` | `fixed[]` count = the expected steps + 1 iff `STATUS.md`'s bytes changed; one biconditional check per scenario | Exact for every non-overview step, as before. For step 9 it is **one-sided** (T1). |

## `H.statusFor`: independent, and faithful to D91

- It imports nothing from `src/` or `dist/`. The renderer comes from § 4's
  format and is pinned against hand-written goldens (C0).
- The frontmatter reader (`statusFields`) is a minimal § 7 reading:
  - `---` first, split at the first `:`, one leading space stripped;
  - `#` lines skipped, quotes unescaped, an empty known value treated as
    absent.
- Scan against D91:

  | D91 rule | `statusFor` |
  |---|---|
  | never follows a directory symlink (B11) | ✓ `isSymbolicLink && isDirectory` → skipped |
  | never descends into a dot-directory (B11) | ✓ covers `.nanojira`, `.ids`, `.git`; dot-*files* are read, as B11 speaks only of directories |
  | a symlinked file is read like a file | ✓ |
  | `.md` is case-sensitive | ✓ |
  | `README.md`/`STATUS.md` excluded at the top level only (B12) | ✓ |

- It also leaves archived files out (below `layout.folders.archive`), lists
  an unreadable file as a stub under `?` (D95 B18), sorts a missing or
  unknown priority with weight 2, and treats a missing title as `- [ID](path)`.
- Divergences can only cause false reds, never false greens:
  - title trimming (only one leading space is stripped);
  - a `frontmatter:unreadable` element's status;
  - no rendering when the status list is missing, but rendering for other
    invalid configs (T3).

  A divergent fixture overview surfaces as `backlog:status_stale` under
  V3-3, in pinned sets that don't allow it.

## Mutation check

`c3-baseline:dist/nj` (`1e85263`) and three mutants, each suite run in its
pre-batch (`8736bf0`) and post-batch (`7dee4a7`) version (`FAILn/m` = failed
checks/total):

| Suite | c3 | m1: `rm` leaves `<id>.removed` beside each removed file | m2: `doctor` emits an extra `backlog:stray_tmp` warning | m3: `doctor` emits an extra `backlog:status_stale` warning |
|---|---|---|---|---|
| edge/archive-rm-byte-identity | PASS → PASS | **FAIL 2/59 → FAIL 2/59** | PASS → PASS | PASS → PASS |
| stress/concurrency | PASS → PASS | PASS → PASS | **FAIL 1/12 → FAIL 1/12** | FAIL 1/12 → PASS *(relaxation 2, by D100)* |
| edge/fix-duplicate-mtimes | PASS → PASS | PASS → PASS | **FAIL 2/11 → FAIL 2/11** | **FAIL 2/11 → FAIL 2/11** |
| edge/unreadable-stub-refusals | PASS → PASS | PASS → PASS | **FAIL 3/33 → FAIL 3/33** | **FAIL 3/33 → FAIL 3/33** |
| ac/ac-13-json-contract | PASS → PASS | PASS → PASS | FAIL 2/202 → FAIL 2/202 | FAIL 3/202 → FAIL 2/202 *(the code is now legal)* |
| ac/ac-14-determinism | PASS → PASS | PASS → PASS | PASS → PASS | PASS → PASS |

Every defect the pre-batch suites caught is still caught after the batch,
with one exception: the extra `status_stale` in `stress/concurrency`, which
is precisely D100's tolerance. That tolerance is confined to the one suite:
`fix-duplicate-mtimes` and `unreadable-stub-refusals` still catch the same
mutant.

## Before/after table (whole oracle, own worktrees)

`node test/run-all.js <nj>`, `NJ_NODE` = runtime Node:

| nj | test/ | passed / failed / cannot run | non-green suites (failed/total checks) |
|---|---|---|---|
| c3 `1e85263` | pre `8736bf0` | 64 / 5 / 1 | ac-17 399/579, ac-22 374/775, ac-23 44/162, ac-24 240/448, hardening-v3-1 229/578; hardening-njrc-foreign-link CANNOT RUN |
| c3 `1e85263` | post `7dee4a7` | 64 / 5 / 1 | the same, except **ac-23 45/170** |
| V3-2 `76db3b2` | pre | 66 / 3 / 1 | ac-23 41/162, ac-24 240/448, hardening-v3-1 214/578; foreign-link CANNOT RUN |
| V3-2 `76db3b2` | post | 66 / 3 / 1 | the same, except **ac-23 42/170** |

- Per suite and per failing check name, pre and post are identical on both
  builds except for one new failing check: `ac-23 C3b`. It fails because
  neither build writes `STATUS.md`, and `ac-23` is V3-3's own, already-red
  suite.
- New checks: ac-23 +8, ac-14 +2 (23 → 25, passing on both) = **10**, as the
  Oracle claimed.
- ac-22 775/775, ac-13 202/202, archive-rm-byte-identity 59, fix-duplicate-mtimes
  11 and unreadable-stub-refusals 33 pass on V3-2 before and after.

## Findings

**T1 — medium (coverage for V3-3): "made stale by an earlier step's move or rename" has no failing check.**

- **What D100 rules.** Step 9 is in `fixed[]` exactly when it changes
  `STATUS.md`: missing, stale before `--fix`, *or made stale by an earlier
  step's move or rename*.
- **Why the check can't fail.** `exit-doctor-fix.js` (90a0c7d) derives its
  expectation from the observed bytes. So a V3-3 whose `--fix` moves a file
  and **forgets to regenerate** passes every check: the bytes don't change,
  `fixed[]` correctly doesn't name the file, and the only later check is
  `doctor`'s exit code, which a `status_stale` warning doesn't change.
- **Nothing else covers it.** AC-23 C5 covers hand-edited, deleted and
  conflicted overviews, but no move. `7dee4a7` removed the one
  layout-change-makes-it-stale expectation from `ac-22`. Nothing in
  `coverage-v3-gaps.js` covers it.
- **Demonstrated** against `c3-baseline`, which behaves exactly like "V3-3
  minus step 9" here:
  - A hand-built backlog with `epics/TSK-001.md` gets a fresh overview from
    `mkBacklog`.
  - `doctor --fix` → `fixed: ["moved TSK-001 → tasks/"]`, `STATUS.md`
    unchanged. A fresh rendering links `tasks/TSK-001.md`; the file still
    says `epics/TSK-001.md`.
  - `exit-doctor-fix.js` at HEAD against that build: **PASS, 324 checks**.
- **Fix (in AC-23, where red before V3-3 is fine):** one case per move kind
  (step 2 rename, step 3 type/hierarchy move, a layout change).
  - After `--fix`, `STATUS.md` equals the golden or `H.statusFor` output
    with the new paths.
  - `fixed[]`'s last entry names `STATUS.md`.
  - A following `doctor` has no `backlog:status_stale`.

  `COVERAGE-v3.md` S22 should be PARTIAL until then.

**T2 — low: `stress/concurrency` tolerates any number of `backlog:status_stale` entries.**
It's a backlog-level code, so at most one should appear. `every(…)` would
also accept duplicates, which would be a doctor bug. Add
`problems.length <= 1`.

**T3 — low: the harness writes an overview into fixtures whose config is invalid.**
- `statusFor` returns null only when the status list is missing or empty, or
  when `statusFile: false`. For an invalid but parseable config (last status
  not `done`, verified: `mkBacklog` then writes `STATUS.md`), it renders
  anyway.
- `nj` never writes one while `config:invalid` holds (D100). The doc comment
  of `statusFor` promises the same.
- Consequence: no AC-17 or config-invalid fixture can detect `nj` *creating*
  an overview while `config:invalid`, only modifying one. No suite asserts
  the creation case today (grep).
- Fix: `statusFor` should return null whenever the configuration would be
  `config:invalid`. At least the statuses rule (≥ 2, unique, `[a-z_]+`, last
  `done`) is cheap to mirror.

**T4 — info.**
- `ac-13`'s wider table, and `ac-22`'s refresh before the migration doctor
  sets, are intended and ruled; they're listed so the next reader doesn't
  re-flag them.
- `mdFiles`' and `checksumAll`'s exclusions are top-level only, as D91 B12
  requires.

## Cleanup

The worktrees for `8736bf0`, `7dee4a7` and HEAD are removed. The mutants
(`/tmp/nj-audit-mut/nj-m1-rm-extra`, `nj-m2-doctor-warn`,
`nj-m3-doctor-stale`), the matrix script and the logs stay in
`/tmp/nj-audit-mut/`.
