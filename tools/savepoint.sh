#!/usr/bin/env bash
# THE SAVEPOINT — uncommitted work must not be destroyable.
#
# WHY THIS EXISTS. Five times in this project's history a whole session's uncommitted work was wiped:
# twice by `git checkout <file>` used to undo a mutation, once by an external `git merge -s ours`,
# twice by a container restart reverting the checkout to an old lineage. Each time the remedy written
# down was a PARAGRAPH — "mutate on a scratchpad copy, never git checkout" — and each time the next
# occurrence proved that a rule nobody can enforce is not a rule. This file is the enforcement.
#
# THREE LAYERS, because the fifth occurrence defeated the first two. They are ordered by what they
# survive, and every claim below was MEASURED rather than assumed:
#
#   LAYER 1 — THE INDEX (`git add -A`). Local, instant, and the one that answers the failure that
#     happened most often:
#       unstaged + `git checkout -- f`  → f reverts to HEAD.  THE WORK IS GONE, UNRECOVERABLY.
#       STAGED   + `git checkout -- f`  → f reverts to the INDEX.  THE WORK SURVIVES.
#       STAGED   + `reset --hard`       → gone from the tree, but the blob is a DANGLING OBJECT and
#                                         `--recover` prints it.
#
#   LAYER 2 — A SCRATCHPAD MIRROR, for when git itself is what went wrong (a bad merge, a
#     wrong-lineage checkout). It defaults to $HOME rather than /tmp because a container restart
#     wipes /tmp — measured 2026-08-21, when it took the mirror with it.
#
#   LAYER 3 — A REMOTE SAVEPOINT BRANCH, the only layer that is OFF THIS MACHINE, and therefore the
#     only one that survives the container being replaced. `git stash create` builds a commit object
#     of the working tree WITHOUT touching the tree, and that object pushes like any other. Proven
#     end to end: uncommitted edits plus a brand-new untracked file survived a full
#     `reset --hard && git clean -fd` and came back with `git checkout FETCH_HEAD -- .`.
#     It goes to refs/heads/savepoint/<branch> rather than a refs/wip/* namespace because this
#     session's git proxy answers 403 to any ref outside refs/heads/* — measured, not assumed.
#
# It also installs a copy of ITSELF to $HOME. On 2026-08-21 the revert took this script with the tree
# — a safety tool that lives inside the thing it protects is unavailable in exactly the moment it is
# needed, so ~/.omerta-savepoint.sh is the copy that outlives the checkout.
#
# THE FLOOR IS STILL A COMMIT. A savepoint is a safety net; push each fix the moment its mutation
# passes. Today the work came back because it had been pushed — not because of layers 1 or 2.
#
# USE: run it after any meaningful edit, and ALWAYS before any git command that can discard —
# checkout, restore, reset, stash, merge, rebase, clean. Idempotent; costs a second.
#
#   tools/savepoint.sh              snapshot now (index + mirror + remote savepoint branch)
#   tools/savepoint.sh --local      skip the remote push (offline)
#   tools/savepoint.sh --list       what snapshots exist, local and remote
#   tools/savepoint.sh --recover    everything still recoverable after a disaster
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

SNAP_ROOT="${SAVEPOINT_DIR:-$HOME/.omerta-savepoints}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)"
WIP_REF="refs/heads/savepoint/${BRANCH}"

case "${1:-}" in
--list)
  echo "== local snapshots ($SNAP_ROOT) =="
  ls -1t "$SNAP_ROOT" 2>/dev/null | head -40 || echo "  none yet"
  echo "== remote savepoint branches =="
  git ls-remote origin 'refs/heads/savepoint/*' 2>/dev/null | sed 's/^/  /' || echo "  none / offline"
  exit 0 ;;
--recover)
  # Ordered by what survives what. After a container replaced the checkout, only the remote is left.
  echo "== 1. REMOTE savepoint branches — survives this machine being replaced =="
  git ls-remote origin 'refs/heads/savepoint/*' 2>/dev/null | sed 's/^/  /' || echo "  none / offline"
  echo "     recover with:  git fetch origin savepoint/<branch> && git checkout FETCH_HEAD -- ."
  echo
  echo "== 2. LOCAL snapshots ($SNAP_ROOT) — survives a bad git command, not a new container =="
  ls -1t "$SNAP_ROOT" 2>/dev/null | head -10 | sed 's/^/  /' || echo "  none"
  echo
  echo "== 3. DANGLING blobs git still holds — survives reset --hard on staged work =="
  git fsck --unreachable 2>/dev/null | awk '$2=="blob"{print $3}' | while read -r o; do
    printf '\n--- %s (%s bytes) ---\n' "$o" "$(git cat-file -s "$o")"
    git cat-file -p "$o" | head -5
  done
  echo
  echo "     recover one with:  git cat-file -p <sha> > path/to/file"
  exit 0 ;;
esac

# LAYER 1 — the index. This is what makes `git checkout -- <file>` restore the work instead of
# destroying it, and it must run before anything else can go wrong.
git add -A

mapfile -t CHANGED < <(git diff --cached --name-only HEAD 2>/dev/null)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "savepoint: tree matches HEAD — nothing uncommitted to protect"
  exit 0
fi

# LAYER 2 — the mirror. Only files that DIFFER from HEAD, so a near-clean tree costs nothing.
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
{ echo "branch: $BRANCH"; echo "head:   $(git rev-parse HEAD)";
  echo "files:"; printf '  %s\n' "${CHANGED[@]}"; } > "$DEST/_savepoint.txt"

ls -1t "$SNAP_ROOT" 2>/dev/null | tail -n +41 | while read -r old; do rm -rf "${SNAP_ROOT:?}/$old"; done

# Keep a copy of this script OUTSIDE the tree it protects. The 2026-08-21 revert took the script
# along with the work, so the tool was missing at the one moment it mattered.
cp -p "$0" "$HOME/.omerta-savepoint.sh" 2>/dev/null && chmod +x "$HOME/.omerta-savepoint.sh" 2>/dev/null

# LAYER 3 — off this machine. `stash create` snapshots the working tree into a commit object without
# disturbing the tree; untracked files are included because layer 1 already staged them.
REMOTE=""
if [ "${1:-}" != "--local" ] && git remote get-url origin >/dev/null 2>&1; then
  WIP="$(git stash create 2>/dev/null)"
  [ -n "$WIP" ] || WIP="$(git rev-parse HEAD)"   # nothing to stash → at least pin the base commit
  if git push -q -f origin "$WIP:$WIP_REF" 2>/dev/null; then
    REMOTE=" + pushed $WIP_REF"
  else
    REMOTE=" (remote push FAILED — this snapshot is local-only and will not survive a new container)"
  fi
fi

echo "savepoint: ${#CHANGED[@]} file(s) staged + mirrored to $DEST$REMOTE"
