#!/bin/sh
# Install an accepted, tagged nanojira release into the shared workspace bin
# (DECISIONS 159). Other teams run <dir>/current/nj, never this working tree.
#   tools/release-local.sh v3.6
set -eu
TAG=${1:?usage: tools/release-local.sh <tag>}
DIR=${NJ_RELEASE_DIR:-/home/dev/workspace/bin/nanojira}
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no tag $TAG" >&2; exit 1; }
VER=$(git show "$TAG:package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')
[ -n "$VER" ] || { echo "no version in $TAG:package.json" >&2; exit 1; }
[ ! -e "$DIR/$VER" ] || { echo "$DIR/$VER exists; releases are immutable" >&2; exit 1; }

# put <file> <content>: write via a temp file and an atomic rename.
put() { printf '%s\n' "$2" > "$1.tmp" && chmod 755 "$1.tmp" && mv -f "$1.tmp" "$1"; }

# The bundle is CommonJS; the .cjs extension keeps it CommonJS under any
# package.json scope. No symlinks: plain sh and .cmd wrappers (DECISIONS 179).
mkdir -p "$DIR/$VER.tmp"
for b in nj nj-mcp; do
  git show "$TAG:dist/$b" > "$DIR/$VER.tmp/$b.cjs"
  chmod 755 "$DIR/$VER.tmp/$b.cjs"
  put "$DIR/$VER.tmp/$b" "#!/bin/sh
exec node \"\$(dirname \"\$0\")/$b.cjs\" \"\$@\""
  put "$DIR/$VER.tmp/$b.cmd" "@node \"%~dp0$b.cjs\" %*"
done
git show "$TAG:docs/CHANGES.md" > "$DIR/$VER.tmp/CHANGES.md" 2>/dev/null || rm -f "$DIR/$VER.tmp/CHANGES.md"
mv "$DIR/$VER.tmp" "$DIR/$VER"

# current/ is a real directory of wrappers into ../<version>/. A symlink left
# by an older release is removed first (only the link, never its target).
[ ! -L "$DIR/current" ] || rm "$DIR/current"
mkdir -p "$DIR/current"
for b in nj nj-mcp; do
  put "$DIR/current/$b" "#!/bin/sh
exec \"\$(dirname \"\$0\")/../$VER/$b\" \"\$@\""
  put "$DIR/current/$b.cmd" "@\"%~dp0..\\$VER\\$b.cmd\" %*"
done
echo "installed $TAG as $DIR/$VER; current -> $VER"
