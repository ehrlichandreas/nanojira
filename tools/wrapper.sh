# Parameter expansion and a loop over the lines instead of basename/dirname/
# sed: one subshell and the `node --version` probe are the only processes
# before the exec, and nothing is written (no here-document, which bash < 5.1
# and zsh back with a temp file) (DECISIONS 213).
# A symlinked launcher (say, one on PATH) is followed to the real file first,
# one link at a time, so dist/ is found next to the real launcher and the
# real file's name picks the bundle; readlink runs only for a link
# (DECISIONS 242). Without a working readlink, or after 40 hops (a loop), it
# stops with 127 rather than guess a directory. Every message goes out
# through printf '%s', never echo: dash's echo reads a backslash in a path.
self=$0
hops=0
while [ -L "$self" ]; do
  hops=$((hops + 1))
  if [ "$hops" -gt 40 ]; then
    printf '%s\n' "${0##*/}: too many symlinks from $0" >&2
    exit 127
  fi
  link=$(readlink -- "$self" 2>/dev/null) || {
    printf '%s\n' "${0##*/}: cannot follow the symlink $self (readlink failed)" >&2
    exit 127
  }
  case $link in
    /*) self=$link ;;
    *) case $self in */*) self=${self%/*}/$link ;; *) self=$link ;; esac ;;
  esac
done
case $self in
  */*) name=${self##*/}; d=${self%/*}; [ -n "$d" ] || d=/ ;;
  *) name=$self; d=. ;;
esac
dir=$(CDPATH='' cd -P -- "$d" >/dev/null 2>&1 && pwd -P) || {
  printf '%s\n' "$name: cannot resolve the directory of $self" >&2
  exit 127
}
node=${NJ_NODE:-node}
if ! command -v "$node" >/dev/null 2>&1; then
  printf '%s\n' "$name: node not found (looked for '$node')" >&2
  exit 127
fi
version=$("$node" --version 2>/dev/null)
# What `sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p'` printed: the digits of every
# line that starts with v<digits>. -- one per line, quirks included.
major=
nl='
'
set -f; IFS=$nl
for line in $version; do
  rest=${line#v}
  [ "$rest" != "$line" ] || continue
  digits=${rest%%[!0-9]*}
  [ -n "$digits" ] || continue
  case ${rest#"$digits"} in
    .*) major=${major:+$major
}$digits ;;
  esac
done
unset IFS; set +f
if [ -z "$major" ] || [ "$major" -lt 24 ] 2>/dev/null; then
  printf '%s\n' "$name: node too old (requires Node.js >= 24)" >&2
  exit 127
fi
unset NODE_OPTIONS
entry="$dir/../dist/$name.mjs"
if [ ! -f "$entry" ]; then
  printf '%s\n' "$name: $entry not found" >&2
  exit 127
fi
exec "$node" "$entry" "$@"
