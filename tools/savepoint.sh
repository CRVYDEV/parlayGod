#!/usr/bin/env bash
# THE SAVEPOINT — uncommitted work must not be destroyable by a git command.
#
# WHY THIS EXISTS. Four times in this project's history a whole session's uncommitted work was
# wiped: twice by `git checkout <file>` used to undo a mutation, once by an external
# `git merge -s ours`, once by a container restart reverting the checkout to an old lineage. Each
# time the remedy written down was a PARAGRAPH — "mutate on a scratchpad copy, never git checkout"
# — and each time the next occurrence proved that a rule nobody can enforce is not a rule. This
# file is the enforcement.
#
# WHAT IT DOES, and the git semantics are measured rather than assumed:
#
#   unstaged + `git checkout -- f`   → f reverts to HEAD.  THE WORK IS GONE, UNRECOVERABLY.
#   STAGED   + `git checkout -- f`   → f reverts to the INDEX.  THE WORK SURVIVES.
#   STAGED   + `reset --hard`        → gone from disk, but the blob is a DANGLING OBJECT and is
#                                      recoverable with `git fsck --unreachable` (see --recover).
#
# So `git add -A` alone converts the disaster that actually happened into a no-op, and the ones it
# cannot prevent into something recoverable. The scratchpad mirror underneath is the second layer,
# for the case git itself is the thing that went wrong (a bad merge, a wrong-lineage checkout, or a
# reset that also expires the objects).
#
# USE: run it after any meaningful edit, and ALWAYS before any git command that can discard —
# checkout, restore, reset, stash, merge, rebase, clean. It is idempotent and costs milliseconds.
#
#   tools/savepoint.sh              snapshot now
#   tools/savepoint.sh --list       what snapshots exist
#   tools/savepoint.sh --recover    print every dangling blob git still holds (post-disaster)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

SNAP_ROOT="${SAVEPOINT_DIR:-${TMPDIR:-/tmp}/omerta-savepoints}"

case "${1:-}" in
--list)
  ls -1t "$SNAP_ROOT" 2>/dev/null | head -40 || echo "no snapshots yet"
  exit 0 ;;
--recover)
  # After a reset/merge that took the tree: staged blobs are unreachable, not deleted. This is the
  # difference between "gone" and "one command away", which is the whole reason to stage.
  echo "== dangling blobs git still holds (newest objects last) =="
  git fsck --unreachable 2>/dev/null | awk '$2=="blob"{print $3}' | while read -r o; do
    printf '\n--- %s (%s bytes) ---\n' "$o" "$(git cat-file -s "$o")"
    git cat-file -p "$o" | head -5
  done
  echo
  echo "recover one with:  git cat-file -p <sha> > path/to/file"
  echo "== scratchpad snapshots =="
  ls -1t "$SNAP_ROOT" 2>/dev/null | head -10
  exit 0 ;;
esac

# LAYER 1 — the index. This is the load-bearing half: it is what makes `git checkout -- <file>`
# restore the work instead of destroying it. Everything below is defence in depth.
git add -A

# LAYER 2 — a scratchpad mirror, for when git itself is the problem. Only files that DIFFER from
# HEAD, so a clean tree costs nothing and the snapshot is small enough to keep many of them.
mapfile -t CHANGED < <(git diff --cached --name-only HEAD 2>/dev/null)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "savepoint: tree matches HEAD — nothing uncommitted to protect"
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
DEST="$SNAP_ROOT/$STAMP"
mkdir -p "$DEST"
for f in "${CHANGED[@]}"; do
  [ -f "$f" ] || continue                      # a deletion has nothing to copy
  mkdir -p "$DEST/$(dirname "$f")"
  cp -p "$f" "$DEST/$f"
done
# The branch and HEAD are recorded too: after a wrong-lineage checkout the hardest question is not
# "what were the files" but "what were they built ON".
{ echo "branch: $(git rev-parse --abbrev-ref HEAD)"; echo "head:   $(git rev-parse HEAD)";
  echo "files:"; printf '  %s\n' "${CHANGED[@]}"; } > "$DEST/_savepoint.txt"

# Keep the last 40. Old snapshots are worthless; a full disk that stops new ones is not.
ls -1t "$SNAP_ROOT" 2>/dev/null | tail -n +41 | while read -r old; do rm -rf "${SNAP_ROOT:?}/$old"; done

echo "savepoint: ${#CHANGED[@]} file(s) staged (git checkout can no longer destroy them) + mirrored to $DEST"
