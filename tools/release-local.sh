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
mkdir -p "$DIR/$VER.tmp"
git show "$TAG:dist/nj" > "$DIR/$VER.tmp/nj"
git show "$TAG:dist/nj-mcp" > "$DIR/$VER.tmp/nj-mcp"
chmod 755 "$DIR/$VER.tmp/nj" "$DIR/$VER.tmp/nj-mcp"
git show "$TAG:docs/CHANGES.md" > "$DIR/$VER.tmp/CHANGES.md" 2>/dev/null || rm -f "$DIR/$VER.tmp/CHANGES.md"
mv "$DIR/$VER.tmp" "$DIR/$VER"
ln -sfn "$VER" "$DIR/current"
echo "installed $TAG as $DIR/$VER; current -> $VER"
