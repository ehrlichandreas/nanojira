# D169 verification — history rewrite (backlog removed, tags moved/re-signed, docs hashes remapped)

Verifier, 2026-10-07. Independent verification, assigned by the Lead.
Read-only on both the main repo and the backup except this report.
Work entirely in throwaway clones: `/tmp/verif-d169-main-mirror` and
`/tmp/verif-d169-work` (bare mirror + working clone of the rewritten
main repo), `/tmp/verif-d169-backup-mirror` (bare mirror of
`nanojira-backup-20261007`), `/tmp/verif-d169-combined` (a bare repo
with both histories fetched into separate `refs/old/*`/`refs/new/*`
namespaces, for cross-repo tree diffs and commit-map cross-checks). All
removed before writing this. The actual main repo and the backup were
never written to — confirmed `git status --short` clean in both before
and after. Read: DECISIONS 169 in full, `.git/filter-repo/commit-map`
(537 lines: 536 real mappings, 92 of them pruned-to-zero).

**VERDICT: pass**, with two items for the Lead to see directly rather
than take on faith: (1) I could not complete cryptographic signature
verification — the signing key isn't in this environment's keyring —
though every other property of the five signatures checks out; (2) the
backlog repo's `doctor` is not "clean apart from the TSK-040 warning"
as expected — it has 27 `acceptance:no_checkbox` warnings (TSK-040 is
simply the highest-numbered one), because our own backlog has no
`problems.ignore` configured yet.

## 1. No trace of `backlog/` in any commit of the main repo

```
cd /tmp/verif-d169-main-mirror
git rev-list --all --objects | awk '{print $2}' | grep -E "(^|/)backlog(/|$)"
```
Zero matches, across every ref (`--all`), not just the current branch.
The only incidental hits for the bare substring "backlog" are
`test/ac/ac-21-backlog-location.js` (a filename, not a path component
named `backlog`) — confirmed by anchoring the regex to full path
segments, not substrings.

## 2. Tree equality: every tag, and the pre-rewrite tip

Fetched both histories into one bare repo under `refs/old/*`/`refs/new/*`
and, for every one of the 24 tags plus the branch tip, confirmed three
things together: (a) the commit-map agrees the old and new commits are
the same rewritten identity, (b) `git diff <old> <new> -- . ':!backlog'`
is empty, and (c) no other files are involved. **All 24 tags: tree-equal
outside `backlog/`, commit-map confirms identity, zero diff.**

The branch tip needed one extra step. The *old* repo's actual `HEAD`
(`ae93432`, "EPIC-014: note team-b TSK-013 for v3.8") maps to
`0000…0` in the commit-map — at first glance a mismatch, but tracing it:
this commit **itself only touched `backlog/`** (confirmed via `git show
--name-only`), so it was correctly pruned, not lost. The new repo's
`HEAD^` (`e25b7a5`, "D168: v3.7 accepted; TSK-049..052 done") is
tree-identical to the old `HEAD` outside `backlog/` (diff: 0 lines) —
i.e. the last *rewritten* commit is exactly where the old history left
off, once its own trailing backlog-only commit is set aside. `HEAD`
itself (`c01af68`, the D169 commit) is then a genuinely new commit
layered on top, containing exactly what D169 describes and nothing
else: `.gitignore` gains `/backlog/`, and 42 docs/reports files have
their embedded commit hashes remapped (43 files, 546 insertions / 517
deletions — confirmed via `git diff --stat e25b7a5 c01af68`, every
touched file a doc, none of them the backlog or any source/test file).

**No diff outside `backlog/` was found anywhere in this check.**

## 3. Signed tags v3.3–v3.7

**Structural checks, all pass:** every one of the five tags carries a
signature (`git verify-tag` reports "Signature made …", not a bare
"BAD" or "no signature"); all five use the identical key fingerprint,
`664720F4F77263B4DAAA15231C22077AE075E1FF`, EDDSA. Checked against the
**backup's own, pre-rewrite** tags too, for comparison: the old
signatures were made at five different timestamps matching each
release's real acceptance date (v3.3: Oct 5 00:18; v3.4: Oct 5 12:51;
v3.5: Oct 6 01:06; v3.6: Oct 7 08:56; v3.7: Oct 7 13:21), while all five
**new** signatures share the exact same timestamp, Oct 7 18:44:23 —
consistent with "re-created and re-signed" as one batch operation during
the rewrite, using the same signing identity as the originals (not a
different, substituted key). Each tag's target commit matches the
commit-map's old→new mapping (§ 2 above already confirms this for every
tag, v3.3–v3.7 included).

**What I could not complete:** full cryptographic "Good signature"
verification needs the public key for `664720F4…`, and it is not in
this environment's GPG keyring (`gpg: Can't check signature: No public
key`, both for the new tags and, identically, for the backup's old
ones — so this is a keyring gap in my environment, not something
specific to the rewrite). I can confirm the signatures are internally
consistent (same key throughout, correct target commits) but not that
the key itself is the Lead's genuine one, since I have no independent
copy of the public key to check against. If this matters for the
record, the Lead (or whoever holds the private key) can confirm the
fingerprint directly, or share the public key so a future round can
close this out with an actual "Good signature" line.

**`dist/nj` vs. the installed releases:** `v3.5`, `v3.6`, and `v3.7`'s
`dist/nj` are each byte-identical to `workspace/bin/nanojira/<ver>/nj`
(`diff -q`, confirmed for all three). `v3.3`/`v3.4` have no installed
binary to compare against — expected, not a gap: per DECISIONS 159,
local installs only started from `3.5.0` (`v3.5`).

## 4. The harness after the rewrite: `run-all` and `gate.js`

Ran both in a fresh clone (`/tmp/verif-d169-work`, `npm ci` + `node
tools/bundle.js`), independently:

- **`node test/run-all.js dist/nj`**: **92/94 passed, 0 failed, 2
  cannot-run** (the two usual environment-conditional suites —
  `ac/ac-15-no-dependencies.js`, `edge/hardening-njrc-foreign-link.js`).
  Clean.
- **`node tools/refactor-harness/gate.js --step=HEAD --frozen=oracle-frozen-12 --diff-out=…`**,
  run **twice**, independently, to confirm reproducibility:

  ```
  replay: exit 8
  BEHAVIOUR CHANGED — 457 differing call(s): (bare) 104, --json 86, set 85,
    doctor 54, list 48, tree 44, show 5, new 5, help 4, note 4, rm 3,
    --help 2, find 2, check 2, archive 2, unarchive 2, claim 2, release 2,
    --backlog=<SCRATCH>/store/bl 1
  RED VERDICTS (3): ac/ac-17-configuration.js, ac/ac-29-stale-claims.js,
    edge/doctor-fix-surface.js
  gate: exit 8, VERDICT RED
  ```

  **Both runs produced exactly 457 differing calls, byte-identical in
  total and in the per-command breakdown.** Reconciled by content (not
  label) exactly as the TSK-052 report did, against the same uncapped
  `--diff-out` file, programmatically classifying all 457 blocks: leaf
  rule (171), the E/F acceptance warnings (217), `config:unknown_key`
  replacing a stale `invalid_config` in `ac-17`'s/`ac-29`'s own fixtures
  (40), the batch 1/2 `set` "Known fields" hint (22), HELP text (6), the
  one named `--backlog=<SCRATCH>/store/bl` call (1) — **171+217+40+22+6+1
  = 457, zero left unclassified**, identical to TSK-052's own
  reconciliation. The three RED verdicts are the same three already
  explained in that report (stale pre-D166/pre-leaf-rule fixtures in the
  frozen `oracle-frozen-12` corpus) — nothing new, nothing attributable
  to the rewrite. **The history rewrite changed no runtime behaviour at
  all**: same tally, same classes, same counts, down to the call.

  **One gap worth naming, confirmed unrelated to the rewrite**: both gate
  runs additionally reported `ac/ac-32-mcp-sdk.js` as `CANNOT RUN`
  ("`require('@modelcontextprotocol/sdk')` failed … is not installed in
  this tree"), which is not in `expected-gaps.js`. Traced it: `gate.js`
  builds its own throwaway worktree under a scratch root with no
  `node_modules` of its own (confirmed in the source —
  `CANONICAL_TMP_ROOT`/`NJ_TEST_ROOT`, not `TMPDIR`, controls this, and
  I initially set the wrong variable), and `ac-32-mcp-sdk.js` is the one
  suite that needs the real npm package rather than the self-contained
  `dist/nj`. Re-ran a second time with `NJ_TEST_ROOT` pointed at a
  directory nested under my own `npm ci`'d clone — the gap persisted
  identically, confirming it is a structural property of `gate.js`'s
  worktree isolation combined with this one suite's real dependency, not
  something introduced by D169 or fixable by an env var on my end. The
  suite's own message is accurate and self-diagnosing ("Not a defect …
  `npm install --save-dev @modelcontextprotocol/sdk` to cover it").
  Everything else in both runs was identical and green.

## 5. Spot-check: hash remap in DECISIONS and verification reports

Scanned every backtick-quoted hex token (7–40 chars) in `docs/DECISIONS.md`
and every `docs/verification/*.md` file: **128 found.** Checked each:

- **5 are not commit hashes at all** — test-corpus content digests
  (e.g. `4ede7689`, `66891340`, `28d4dbdb`) quoted in old replay reports
  (`v3-1.md`, `v3-preflight.md`, `gate-instrument.md`, DECISIONS'
  own harness-history entries) — confirmed by context, excluded from
  the count below (false positives from a plain hex-pattern scan, not a
  finding).
- **113 resolve directly in the new repo**, each with a commit subject
  matching the backup's commit for the old hash the commit-map maps to
  it from.
- **5 initially looked like mismatches, but are not**: their commit
  *subjects* differ between old and new — but only because the subject
  itself **names another commit hash**, and that embedded hash was
  *also* correctly remapped by `git filter-repo`'s own message-rewriting
  (not my doc-remap script's doing). Verified each one directly against
  the commit-map, e.g. `ead3a32`'s new subject reads "…against
  `bec5248`'s dist/nj" where the old subject read "…against `0e9b83f`'s
  dist/nj" — and `0e9b83f → bec5248` is exactly the commit-map's own
  entry. Checked all five this way (`a1d33e0`, `9277ea6`, `1c7a0a3`,
  `b430f30`, plus the one above): every embedded hash matches its
  commit-map mapping exactly. This is additional, independent evidence
  the remap is consistent — not a separate pass I had to trust, but the
  same map applied twice (once to my doc files, once by filter-repo to
  commit messages) and agreeing.
- **The 7 documented pruned references** (`2ca5c9f`, `4afc759`,
  `5b666a0`, `5e1fe80`, `62777f9`, `678a89b`, `efd4b69`): confirmed all
  seven are referenced in current docs with their **old** hash (as
  stated), confirmed all seven **fail to resolve** in the new repo and
  **do resolve** in the backup, and confirmed via `git show --name-only`
  on each in the backup that **every file each commit touches is under
  `backlog/`** — zero non-backlog files in any of the seven (file counts
  per commit: 1, 2, 2, 2, 1, 43, 1 — `678a89b`'s 43 files are all under
  `backlog/`, confirmed, not assumed).

**Zero genuine mismatches found** across all 128 scanned references.

## 6. The backlog repository

- **Commit count**: `git -C backlog log --oneline | wc -l` → **140**,
  matching D169 exactly.
- **Content**: `diff -rq --exclude=.git backlog nanojira-backup-20261007/backlog`
  → **empty** (identical).
- **`nj doctor --backlog=backlog`**: `ok: true` (no errors), but **not**
  "clean apart from the TSK-040 warning" as the task description
  expected — it reports **27** `acceptance:no_checkbox` warnings, one
  each on SUB-004, SUB-005, and TSK-016 through TSK-040. TSK-040 is
  simply the highest-numbered task among them, not a special or unique
  case. This is correct `nj` behaviour, not a bug: our own backlog's
  `.nanojira/config.json` has no `problems` key at all, so every v3.7
  E/F warning our own history of prose-only-acceptance tasks qualifies
  for is shown, same as team-b-tests' 287/10 before they added
  `problems.ignore`. Worth a decision, not a fix: either add
  `"problems": {"ignore": ["acceptance:no_checkbox"]}` to our own
  config (the same opt-out we built for them) or leave it as an honest
  backlog of historical debt — either way, the expectation in this
  task's own description should be corrected for next time.
