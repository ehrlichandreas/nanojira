# Releasing nanojira

The maintainer's procedure for cutting `vX.Y.Z`, from a clean `main` to an
exported skill folder. `tools/release.ts` wraps git-release-squash
(git-history-tools); why it behaves the way it does is DECISIONS 190–194,
202 and 208. Nothing here pushes: **pushing is the owner's call, never part
of a release.**

## 0. Before you start

Everything that ships has landed on `main`. Run `npm ci` in the release
checkout (if other clones or worktrees symlink this `node_modules`, only
while nothing runs there).

`release.ts` checks the rest itself, before it writes anything, in a dry
run too (DECISIONS 227). Each problem is one line,
`release: refused: <code>: <what> -- <hint>`, all of them in one run, exit 1:

| Code | Refused when |
|---|---|
| `other_branches` | a local branch other than the checked-out one exists: git-release-squash verifies every commit on every branch *after* it has rewritten `main` (§ 4), so one unsigned WIP branch turns that verify red when it is too late to stop |
| `other_worktrees` | `git worktree list` shows more than this checkout |
| `dirty_tree` | `git status --porcelain` is not empty, untracked files included |
| `tag_after_release` | any tag, of any name or kind (an rc included), sits on a commit after the previous release `vPREV`, the newest exact `vX.Y.Z` in HEAD's history: `tail` squashes the commits after the newest *tagged* commit, so a helper tag silently shrinks the release |
| `version_mismatch` | `package.json`, the lock's root x2, `SKILL.md`'s `metadata.version` and `bin/nanojira --version` do not all say X.Y.Z (§ 1) |
| `node_modules_mismatch` | an installed package's version or `resolved` source differs from `package-lock.json`: the release is cut with the installed git-release-squash, and two commits can both call themselves `0.3.1` |
| `doc_names_squashed_commit` | a line added to `docs/`, `SKILL.md`, `README.md` or `references/` since `vPREV` names a commit (7 to 40 hex digits, either case) contained in no release tag: the squash removes this release's commits, and a cut from cherry-picks names work-branch commits main never gets (v4.1.1 shipped three such lines); name the release (`v4.1.0`) instead, or no commit |
| `bundle_stale` | `node tools/bundle.ts --check` fails |

Merge or abandon another branch, then `git worktree remove <path>` and
`git branch -D <branch>`. A first release, with no `vX.Y.Z` tag before
it, has no `tag_after_release` check and scans every doc line.

- **Rehearsals and suites keep their scratch files off the disk.** The
  `--dry-run` sandboxes, git-history-tools' signer and a few tests write to
  `$TMPDIR` (`os.tmpdir()`); the test harness's own fixtures go to
  `$NJ_TEST_ROOT`, or `/tmp` without it. Point both at a tmpfs for every
  rehearsal or suite run, e.g. `export TMPDIR=/tmp/<dir>`, and put throwaway
  clones under `/tmp` too.

## 1. Bump the version — four places

All to `X.Y.Z`:

1. `package.json` — `"version"`.
2. `package-lock.json` — **both** root entries: the top-level `"version"`
   (line 3) and `packages[""].version` (line 9). Leave every other package's
   `version` alone, even one that happens to read the old number.
3. `SKILL.md` — `metadata.version`.
4. `test/ac/ac-39-version.ts` — `const VERSION`, and the comment above it.

Then rebuild (the bundles carry the version) and check:

```sh
node tools/bundle.ts
node tools/bundle.ts --check        # six "byte-identical" lines
sh bin/nanojira --version           # nanojira X.Y.Z
git grep -n 'OLD.VERSION' -- ':!docs/CHANGES.md' ':!docs/DECISIONS.md' ':!dist'
```

The last line should find nothing that pins the version (a historical
mention such as SPECIFICATION's "the v4.0.0 CLI rename" is fine).

## 2. CHANGES

`docs/CHANGES.md` gets its `## X.Y.Z` entry: user-facing changes only,
bold-lead bullets, a breaking change first (or named in a one-line intro),
a `docs/GUIDE.md` § pointer per feature, feedback ids in parentheses.

Commit the bump and CHANGES together as one ordinary signed commit — the
squash below needs a clean tree.

## 3. The release message

A file whose first line is the **title** — lower-case, and *without* the
`nanojira vX.Y.Z: ` prefix (git-release-squash adds that itself;
`release.ts` refuses a title that already carries it). An optional body
follows after a blank line:

```text
dry-run on every write, tags, show --notes, quieter writes

- --dry-run on every write command
- nanojira tags and a generated TAGS.md
```

The squashed commit's subject becomes `nanojira vX.Y.Z: <title>`; the tag
message is the file verbatim, `<title>\n\n<body>` (the v3.12.2 form).
`--message '<title>'` instead of `--message-file` gives a title-only tag.

## 4. Dry run, then apply

The signing identity goes in as one-off `GIT_CONFIG_*` variables — never
into any git config file:

```sh
export GIT_CONFIG_COUNT=3 \
  GIT_CONFIG_KEY_0=user.name       GIT_CONFIG_VALUE_0='<owner name>' \
  GIT_CONFIG_KEY_1=user.email      GIT_CONFIG_VALUE_1='<owner email>' \
  GIT_CONFIG_KEY_2=user.signingkey GIT_CONFIG_VALUE_2=<owner key fingerprint>
export NJ_NODE=<the runtime node>   # optional: ac-15 otherwise uses the Node running it (>= 24)

node tools/release.ts X.Y.Z --message-file /tmp/release-msg.txt
```

The dry run writes nothing and **skips the test gate** (it says so:
`test gate runs with --apply`). Expect no `release: refused:` line, then
git-release-squash's plan:
`tail: squashes N commit(s) (<oldest>..<head>) into "nanojira vX.Y.Z: <title>"`
and `dry run, no ref changed`. Check N and the subject.

```sh
node tools/release.ts X.Y.Z --message-file /tmp/release-msg.txt --apply
```

`--apply` runs `npm test` first (the full suite; the `GIT_CONFIG_*`
variables are stripped from its environment so they cannot override the
test fixtures' own keys) and refuses on red — fix the tree; `RELEASE_TEST_CMD`
exists for release.ts's own regression test, not to skip the gate. Then it
squashes every commit since the last tag into one signed commit plus a
signed annotated tag, writes a backup bundle *beside* the repository
directory (`../nanojira.backup-<UTC stamp>.bundle`), and prints
git-release-squash's two verify lines, then release.ts's own, one per
section (DECISIONS 228). Every line must read OK; `old tags vs origin` may
read `SKIPPED (origin unreachable)` when there is no network:

```text
verify: tree delta: OK
verify: signatures: OK
verify: squash: OK
verify: release commit: OK
verify: release tag: OK
verify: old tags vs origin: OK (not pushed yet)
verify: content: OK
verify: refs: OK
verify: history signatures: OK
```

- `squash`: `main` is the previous release tag plus exactly one commit,
  the tag points at it, no tag lies between, and its tree is the
  pre-squash `HEAD`'s.
- `release commit`: author and committer are one identity, a user ID of
  the pinned key (the owner, never a WIP name), both dates are
  the anonymous date for its position, the subject is
  `nanojira vX.Y.Z: <title>`, and it carries one signature, from the key
  pinned in `package.json`'s `"releaseKey"`,
  `BEEEE63B314331D0054DBEBE2FEE273AD7BB6092` (DECISIONS 226), made at the
  pinned time: the key's creation time + 60 s (DECISIONS 190), never the
  real one.
- `release tag`: annotated and named for itself, one signature block, by
  the pinned key at the pinned time, tagged by the commit's identity (a
  user ID of the pinned key) at its date.
- `old tags vs origin`: every older tag on origin is byte-identical to the
  local one, origin has no tag this repo lacks and no branch besides
  `main`, and origin is either before the push (`main` at the previous
  release, no vX.Y.Z) or after it (`main` and the tag exactly as here).
- `content`: package.json, the lock's root x2, `SKILL.md`, the CHANGES
  heading and the version in `dist/` all say X.Y.Z, and the tag exported
  by `tools/export-skill.mts` says `nanojira X.Y.Z` too.
- `refs`: `main` and tags only, no other branch or worktree.
- `history signatures`: every commit and annotated tag reachable from a
  branch or tag is signed by the pinned key (`verify: signatures` accepts
  any key in the keyring).

A FAIL line names what is wrong (a signature by another key reads
`release_key_mismatch: … expected <pin>, found <fingerprint>`), and
release.ts exits 1 after printing `release: verify FAILED`. A
`"releaseKey"` that is not 40 hex digits is refused with
`release_key_invalid` before the test gate, dry run included. So
`GIT_CONFIG_VALUE_2` (the signing key) must be the pinned key or one of
its signing subkeys.

Exit status 0. Anything else: **roll back** (below) — by the time verify
runs, `main` and the tag are already rewritten.

**`verify: signatures` covers the whole history, not just the release.** It
runs `git verify-commit` on every commit reachable from any local branch or
tag (`git rev-list --branches --tags`), then `git verify-tag` on every
annotated tag. Every one of them must carry a good signature from a key in
the local keyring. So a leftover branch, an old commit or an old tag signed
with a key that no longer verifies turns it red, however clean the new
release commit is. Until the whole-history re-sign of 2026-10-18 (`main`
38e8252), commits and tags signed with an earlier key did exactly that.
Since then every commit and tag carries the current key and the verify is
green. Before an old signing key stops verifying, re-sign the history
(*Signing key change*, below).

**No working time in the release objects.** `tail` gives the squashed commit
and its tag anonymous dates, and signs both at a pinned time
(`gpg --faked-system-time`). The same tree, parent, message and key
therefore give the same commit and tag ids, and neither carries the moment
of the release. The bump/CHANGES commit (§ 2) still has
real dates, but the squash replaces it, so it never reaches the remote.

## 5. Verify and export

The verify lines of § 4 are the post-squash check. Then:

```sh
git status                           # clean
node tools/export-skill.mts vX.Y.Z <dest>
ls <dest>                            # SKILL.md bin/ dist/ LICENSE references/
```

After the push (§ 6), check the published state with the same sections,
read-only:

```sh
node tools/release.ts --verify-only vX.Y.Z
```

It prints the same `verify:` lines for the local repo, plus
`verify: origin == local: OK` once `git ls-remote origin` shows `main` and
the tag exactly as they are locally; there, an unreachable origin is a
FAIL, not SKIPPED. Exit 0 only when every line is OK.

## 6. Push — only with the owner's go

The squash rewrote `main`: any remote that already has the individual
commits since the last tag needs a force-push. Ask first; never push as
part of the release itself.

## Signing key change

`verify: signatures` (§ 4) only needs a good signature from a key in the
local keyring. As long as the old public key stays there, valid and not
revoked, the release stays green without a re-sign. It turns red once the
old key no longer verifies: removed from the keyring (as the key before the
current one was in 2026-10), expired or revoked. `git-sign check` is
stricter: it accepts only the policy key and flags every old signature at
once. So re-sign the history with git-history-tools' `git-sign` **before**
the old key stops verifying, and before the next release, on `main` with no
other branch (§ 0). Identity and key come from git-sign's policy file
(`--policy=<file>` if given, else
`$XDG_CONFIG_HOME/git-history-tools/policy.json`, else
`~/.config/git-history-tools/policy.json`), never
from git config: put the new `signingKey` there first. The release commits
carry anonymous dates from 1970, so the policy needs `"anonymousBefore"`
(e.g. `"1971-01-01T00:00:00Z"`) for `check` to accept them as anonymous.
Every writing step is a dry run until `--apply`:

```sh
# dry run: "root-inclusive: <N> commits", one "would be re-signed" line each
npx git-sign resign-commits . main --from-root
npx git-sign resign-commits . main --from-root --map-out=/tmp/resign-map.txt --apply
# dry run: every tag not validly signed by the policy key
npx git-sign resign-tags .
npx git-sign resign-tags . --apply
# "check: 0 violation(s) across <N> commit(s) and <M> tag(s)", exit 0
npx git-sign check . HEAD --tags
```

- `resign-commits` changes nothing but the signature: tree, parents (mapped),
  author, committer and message stay byte-identical. It writes a backup
  bundle first, then moves `main` and every affected tag in one atomic
  transaction. It refuses a commit whose author or committer is not the
  policy identity: a key change is not an identity change.
- `resign-tags` re-signs annotated tags only. Lightweight tags carry no
  signature and are reported as skipped.
- `<rev> --from-root` re-signs the root and every descendant of it, i.e.
  the whole history; a bare `<rev>` without `--from-root` is refused.
- `check` with a single revision checks every commit from the root, plus all
  tags with `--tags`.
- The new public key must be in the keyring of everyone who verifies.
- Every commit and tag id changes, so the remote needs a force-push of
  `main` and of every moved tag (git-sign prints one
  `git push --force-with-lease=…` line per ref). That push is the owner's
  call (§ 6).

Then release as usual. The release itself uses the identity from the
`GIT_CONFIG_*` variables (§ 4), so they must name the same new key.

Put the new key's primary fingerprint into `package.json`'s `"releaseKey"`
in the same change (DECISIONS 226): release.ts checks the new release
against it, and `tools/export-skill.mts` exports only tags signed by it.
After a re-sign every old tag carries the new key, so old tags still
export; a tag that was not re-signed no longer does.

## Rollback

git-release-squash moves `main` with the reflog message
`git-release-squash tail`; the entry just below it is the old head. The
squash keeps the tree byte-identical, so resetting the ref leaves the
working tree consistent:

```sh
git reflog -n 3 main                 # main@{1} = the head before the squash
git tag -d vX.Y.Z
git update-ref refs/heads/main <old-head> <squashed-head>
git log --oneline -3; git status
```

If the reflog no longer has it, the backup bundle does:
`git bundle list-heads ../nanojira.backup-<stamp>.bundle` shows every ref as
it was before the squash; `git fetch ../nanojira.backup-<stamp>.bundle
'+refs/heads/main:refs/heads/main-before-release'` brings the old `main`
back as a branch to reset to. Delete the bundle only once the release is
verified.
