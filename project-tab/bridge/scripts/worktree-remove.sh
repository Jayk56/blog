#!/usr/bin/env bash
# worktree-remove.sh — WorktreeRemove hook for Claude Code
#
# Paired with worktree-create.sh. Removes the git worktree and prunes.
#
# stdin:   JSON { "worktree_path": "<absolute-path>", ... }
# stdout:  (unused)
# stderr:  log messages
#
# Requires: jq, git

set -euo pipefail

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')

if [[ -z "$WORKTREE_PATH" || "$WORKTREE_PATH" == "null" ]]; then
  echo "[bridge] Error: no worktree_path provided" >&2
  exit 1
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "[bridge] Worktree directory does not exist: $WORKTREE_PATH" >&2
  exit 0
fi

echo "[bridge] Removing worktree at $WORKTREE_PATH" >&2
git worktree remove "$WORKTREE_PATH" --force >&2 2>/dev/null || true
git worktree prune >&2 2>/dev/null || true

echo "[bridge] Worktree removed" >&2
