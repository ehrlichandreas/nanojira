# D170 verification — commit-message cleanup (main, backlog/, feedback/)

Verifier, 2026-10-07. Independent verification, assigned by the Lead.
Read-only on all three live repos and the backup except this report —
confirmed `git status --short` clean in main, `backlog/`, and
`feedback/` before and after. Work entirely in throwaway bare mirrors
(`/tmp/verif-d170-{main,backlog,feedback}-mirror` for the new state,
`/tmp/verif-d170-backup-{main,backlog,feedback}-mirror` for
`nanojira-backup-20261007-pre-msgclean`, never written to) plus three
combined repos (`/tmp/verif-d170-combined-{main,backlog,feedback}`,
each with both histories fetched into separate `refs/old/*`/`refs/new/*`
namespaces) for cross-repo commit matching. All removed before writing
this. Read: DECISIONS 170 in full, `.git/filter-repo/commit-map`
(539 lines: 538 mappings, 92 pruned-to-zero — the same pruned set as
D169's, confirming this run re-derived the whole history from the
original pre-D169 state rather than patching the already-rewritten one).

**VERDICT: pass.** Every check comes back clean: zero assistant/vendor
mentions anywhere in any of the three repos' full history; every
commit's tree is unchanged (confirmed independently, not by trusting
the Lead's own count, though it matches exactly: 446/141/5); every
message is accounted for by trailer removal, correctly-propagated
embedded-hash remapping, or the one documented AGENTS.md
reword — zero unexplained differences across all 592 commits; all 24
tags point at the right mapped commits and verify with "Good signature"
(this round, unlike D169's, I had the right keyring); `run-all` and a
fresh `gate.js` run reproduce the exact same 457-call, six-class replay
tally as the D169/TSK-052 rounds, and — unlike my D169 report — this
time with zero unexpected gaps at all once I pointed `gate.js` at a
scratch root with `node_modules` reachable (the fix I'd already worked
out last round).

## 1. No "<assistant>"/"<vendor>" anywhere, any ref, all three repos

```
git log --all --format="%H%n%B%n---END---" | grep -ic "<assistant>\|<vendor>"
```
run separately against bare mirrors of main, `backlog/`, and
`feedback/` (which is itself one nested repo holding all three outside
teams' folders, confirmed via `find … -iname .git`, not three separate
repos despite the three subdirectories). **Zero matches in all three**,
`--all` so every ref (branches and all 24 tags) is covered, not just
the current tip.

## 2. Tree equality, matched 1:1 by tree + timestamps — independent of the Lead's count

For each repo, fetched both the new and the pre-cleanup-backup history
into one combined bare repo under separate ref namespaces, then paired
every old commit to a new one by the key `(tree, author-date,
committer-date)` — exact, not fuzzy: two commits sharing all three
values share the same tree content and were made at the same instant,
which a message-only rewrite preserves by construction and nothing else
plausibly would. Matching, independently:

| Repo | Old commits | New commits | Matched | Unmatched old | New-not-matched |
|---|---|---|---|---|---|
| main | 446 | 447 | **446** | 0 | 1 (`0c7f719`, the D170 commit itself — genuinely new, expected) |
| `backlog/` | 141 | 141 | **141** | 0 | 0 |
| `feedback/` | 5 | 5 | **5** | 0 | 0 |

**Exactly the Lead's own 446/141/5**, arrived at independently (tree +
timestamp pairing, not a count taken on trust). Every matched pair's
tree hash is identical by construction of the key — tree equality for
all 592 commits is therefore not a separate check layered on top, it's
already proven by the matching itself.

## 3. Message content: every one of the 592 pairs accounted for

For each matched pair, compared `git log -1 --format=%B` on both sides.
None were byte-identical (every commit in `main`'s original 446 carried
*something* that needed removing, directly or via a cascading hash
reference — see below), so every single one needed the deeper check:
strip any `Co-Authored-By: …` line from the old message, then
remap every embedded 7–40 character hex token found in what remains
using the *same* tree+timestamp pairing (i.e. if the old message names
another commit's short hash, look up that commit's own new hash the
same way), and compare the result to the new message.

- **`backlog/`: 141/141 explained this way**, **`feedback/`: 5/5** —
  zero remainder in either.
- **`main`: 445/446 explained by trailer-removal + hash-remap; the one
  remaining pair is exactly the documented reword**:
  ```
  old: "...a short, spec-checked copy-paste block for a project's
        AGENTS.md. README links both."
  new: "...a short, spec-checked copy-paste block for a project's
        agent-instructions file (AGENTS.md etc.). README links both."
  ```
  (commit `33b5b60`, "GUIDE Install section + docs/AGENT-INSTRUCTIONS.md
  (TSK-040)") — the one message D170 names as reworded, confirmed to be
  the *only* content change beyond trailer/hash mechanics anywhere in
  any of the 592 commits.

**The embedded-hash-remap check matters, not just the trailer strip**:
a plain "strip the trailer line and compare" leaves 146 apparent
mismatches in `main` alone, because many commit messages quote *other*
commits' short hashes in their own prose (e.g. "Record c6-baseline …
against `1df6456`'s dist/nj"), and those embedded hashes get rewritten
too, by `git filter-repo`'s own standard message-hash-rewriting, same as
D169 showed on a smaller scale. Confirmed this is exactly what's
happening and not a different problem, by remapping each embedded hash
through the same tree+timestamp pairing before comparing — which
collapses all 146 down to the single genuine reword above. This is a
second, independent confirmation that the commit-map is self-consistent
(the mapping implied by matching trees/timestamps agrees with what
`git filter-repo` actually wrote into the message bodies), not merely
something I assumed.

## 4. Tags: same 24 names, correct mapped targets, verified signatures

`git tag | sort` identical between old and new main (24 names, byte for
byte). Dereferenced every tag in both the old and new ref namespaces of
the combined repo and confirmed, for all 24, that the new target's
`(tree, author-date, committer-date)` matches the old target's exactly
— i.e. every tag was re-pointed at the correctly-mapped commit, not
merely re-created with the same name pointing somewhere incidentally
similar.

**Signatures, this time fully verified** (`GNUPGHOME=/home/dev/.gnupg`,
the keyring the Lead pointed at after D169's report flagged the gap):

```
v3.3: Good signature from "Andreas Ehrlich <dev@example.com>" [ultimate]
v3.4: Good signature from "Andreas Ehrlich <dev@example.com>" [ultimate]
v3.5: Good signature from "Andreas Ehrlich <dev@example.com>" [ultimate]
v3.6: Good signature from "Andreas Ehrlich <dev@example.com>" [ultimate]
v3.7: Good signature from "Andreas Ehrlich <dev@example.com>" [ultimate]
```
All five using key `664720F4F77263B4DAAA15231C22077AE075E1FF`, all five
signed at the same instant (Wed Oct 7 20:15:15–16 2026 CEST) — a later,
distinct batch from D169's own re-signing (Oct 7 18:44:23), consistent
with this being a genuinely separate signing operation, not a leftover.

## 5. `run-all` and `gate.js`: the 457-call tally, unchanged

Fresh clone, `npm ci` + `node tools/bundle.js`:

- **`node test/run-all.js dist/nj`**: **92/94 passed, 0 failed, 2
  cannot-run** (the usual environment-conditional pair). Clean.
- **`node tools/refactor-harness/gate.js --step=HEAD --frozen=oracle-frozen-12 --diff-out=…`**,
  run once, with `NJ_TEST_ROOT` (not `TMPDIR` — confirmed from reading
  `lib/record.js`'s `CANONICAL_TMP_ROOT` in the D169 round, which
  `gate.js` actually consults) pointed at a scratch directory nested
  under this same `npm ci`'d clone, specifically so the one suite that
  needs a real npm dependency (`ac-32-mcp-sdk.js`) can find
  `node_modules` by Node's normal upward resolution from inside the
  gate's own throwaway worktree:

  ```
  BEHAVIOUR CHANGED — 457 differing call(s): (bare) 104, --json 86, set 85,
    doctor 54, list 48, tree 44, show 5, new 5, help 4, note 4, rm 3,
    --help 2, find 2, check 2, archive 2, unarchive 2, claim 2, release 2,
    --backlog=<SCRATCH>/store/bl 1
  RED VERDICTS (3): ac/ac-17-configuration.js, ac/ac-29-stale-claims.js,
    edge/doctor-fix-surface.js
  oracle: passed 93, failed 0, cannot run 1 (1 expected)
  gate: exit 8, VERDICT RED
  ```

  **Exactly 457 calls, the exact same per-command breakdown as both the
  TSK-052 and D169 rounds.** `dist/nj`'s own sha256 in this run
  (`8c5c51c0…`) is byte-identical to the one recorded in the D169
  report — expected and a useful independent confirmation in its own
  right: the compiled binary's content never changed between D169 and
  D170, only commit messages did, so hashing the same bytes gives the
  same hash. Reconciled all 457 by content, the same programmatic
  classification as the prior two rounds: leaf rule (171), the E/F
  warnings (217), `config:unknown_key` in `ac-17`/`ac-29`'s own fixtures
  (40), the batch 1/2 `set` "Known fields" hint (22), HELP text (6), the
  one `--backlog=<SCRATCH>/store/bl` call (1) — **171+217+40+22+6+1 =
  457, zero unclassified.** The three RED verdicts are the same three,
  already-explained, pre-existing frozen-corpus staleness from every
  prior round — nothing new.

  **No unexpected gaps this run** — a genuine improvement over the D169
  round's own report, where `ac-32-mcp-sdk.js` showed `CANNOT RUN`
  because I had pointed the (wrong) `TMPDIR` variable at a clean root
  with no `node_modules` reachable. Having already diagnosed that
  mechanism last time, I used `NJ_TEST_ROOT` nested under the real
  clone this round, and the gap disappeared (`ac-32-mcp-sdk.js` 7/7
  checks, PASS) — confirming it really was the tooling artifact
  identified then, not something the Lead needed to act on.

## 6. D162's feedback-repo references, and 10 spot-checked hashes

**D162's embedded commit references, now resolving in the post-D170
repos**: D162 names `a4b671a` (feedback's first commit) and `46b7475`
(the main-repo commit that starts ignoring `feedback/`). Both resolve
directly in the new `feedback/` and `main` mirrors respectively.
Traced the full chain to be sure this isn't a coincidence: the
**pre-cleanup backup's own copy** of D162 named `81e62b7` and `844f10b`
instead (confirmed by reading the backup's `docs/DECISIONS.md` at that
exact passage) — and applying the same tree+timestamp pairing from § 2
confirms `81e62b7 → a4b671a` in `feedback/` and `844f10b → 46b7475` in
`main`, exactly the values now in the live doc. The remap is correct
end to end, not just superficially plausible.

**10 further hashes, spot-checked** (chosen across `DECISIONS.md` and
several different verification reports, not just the D162 pair above):
every one resolves to a real commit whose subject matches how it's
used in context — e.g. `242703a` (cited in `v3-1-c-claim.md`'s own
title as the `nj claim`/`nj release` commit) resolves to exactly "V3.1-C:
nj claim / nj release (§ 9 acting name, § 12 Claims, § 12a, TSK-032)";
`0a857fe` (cited in `v3-7-ab.md` as "the Oracle's own [B8] fix")
resolves to "Fix vacuous check in AC-48 B8: show --json is the list
shape"; `1be5bf9` (cited in my own `v3-7-tsk052.md`, itself originally
written against the hash `36eb412` two rewrites ago) now resolves to
"V3.7-E/F (TSK-052): acceptance quality warnings". All ten: correct,
specific, no vague "resolves to *something*" shortcut.

**The full hash census, for completeness**: scanned all 135
backtick-quoted hex tokens across `DECISIONS.md` and every
`docs/verification/*.md` file; 121 resolve directly in the new main
repo; the 14 that don't are fully explained — the same 7 D169-pruned,
backlog-only references (`2ca5c9f`, `4afc759`, `5b666a0`, `5e1fe80`,
`62777f9`, `678a89b`, `efd4b69`), the same 5 test-corpus content digests
that were never commit hashes to begin with (`28d4dbdb`, `4ede7689`,
`66891340`, `c866d2b2`, `d696062c`), and 2 more from my *own* D169
report's prose, which deliberately quotes pre-rewrite hash values
(`0e9b83f`, `ae93432`) the same way the 7 pruned references do, for the
same reason (illustrating what the old history looked like) — correctly
left untouched by the remap, consistent with D169's own stated policy
that historical illustrations keep their old value. Zero genuine
mismatches across all 135.
