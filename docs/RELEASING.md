# Releasing nanojira

The maintainer's procedure for cutting `vX.Y.Z`, from a clean `main` to an
exported skill folder. `tools/release.ts` wraps git-release-squash
(git-history-tools); why it behaves the way it does is DECISIONS 190–194,
202 and 208. Nothing here pushes: **pushing is the owner's call, never part
of a release.**

## 0. Before you start

- Everything that ships has landed on `main`; the working tree is clean.
- **No other local branch.** `git branch` lists `main` only, `git worktree
  list` the main checkout only. `release.ts --apply` refuses otherwise and
  names them: git-release-squash verifies the signature of every commit on
  every branch *after* it has rewritten `main` (§ 4), so one unsigned WIP
  branch turns that verify red when it is too late to stop. Merge or abandon
  each one, then `git worktree remove <path>` and `git branch -D <branch>`.
- **No tag of any kind after the last release.** `tail` squashes the commits
  after the newest *tagged* commit, and any tag counts: a lightweight or
  annotated helper tag (a test baseline, a bookmark) on a commit after
  `vPREV` silently shrinks the release to the commits after that tag. This
  must print the previous release tag and nothing else:

  ```sh
  git tag --contains vPREV
  ```

- **`node_modules` matches the lock.** `release.ts` runs
  `node_modules/.bin/git-release-squash` from this checkout, so the release
  is cut with whatever git-history-tools is installed there, not with the
  commit the lock names. Run `npm ci` in the release checkout, then compare
  the installed commit with the locked one; the two lines must be
  identical. The version number alone proves nothing: two different
  commits can both call themselves `0.3.1`.

  ```sh
  npm ci
  for f in node_modules/.package-lock.json package-lock.json; do
    node -p "require('./$f').packages['node_modules/git-history-tools'].resolved"
  done
  ```

  If other clones or worktrees symlink this `node_modules`, `npm ci`
  rewrites it under them too: run it only while nothing runs there.
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
`test gate runs with --apply`). Expect no branch warning, then
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
directory (`../nanojira.backup-<UTC stamp>.bundle`), and prints two lines
that must both read OK:

```text
verify: tree delta: OK
verify: signatures: OK
```

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

```sh
git tag -v vX.Y.Z                    # Good signature, the owner's key
git log --oneline -3                 # one new commit on top of the previous tag
git status                           # clean
node tools/export-skill.mts vX.Y.Z <dest>
sh <dest>/bin/nanojira --version     # nanojira X.Y.Z
ls <dest>                            # SKILL.md bin/ dist/ LICENSE references/
```

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
