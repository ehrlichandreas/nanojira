# Releasing nanojira

The maintainer's procedure for cutting `vX.Y.Z`, from a clean `main` to an
exported skill folder. `tools/release.ts` wraps git-release-squash
(git-history-tools); why it behaves the way it does is DECISIONS 190–194 and
202. Nothing here pushes: **pushing is the owner's call, never part of a
release.**

## 0. Before you start

- Everything that ships has landed on `main`; the working tree is clean.
- **No other local branch.** `git branch` lists `main` only, `git worktree
  list` the main checkout only. `release.ts --apply` refuses otherwise and
  names them: git-release-squash verifies the signature of every commit on
  every branch *after* it has rewritten `main`, so one unsigned WIP branch
  turns that verify red when it is too late to stop. Merge or abandon each
  one, then `git worktree remove <path>` and `git branch -D <branch>`.

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
