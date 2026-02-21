#!/usr/bin/env bash
# worktree-create.sh — WorktreeCreate hook for Claude Code
#
# Replaces the default git worktree creation to layer bridge hooks on top.
# Creates the worktree, then writes per-worktree .claude/settings.local.json
# with bridge hooks configured using the worktree name as the agent ID.
#
# stdin:   JSON { "name": "<worktree-name>", "cwd": "<project-root>", ... }
# stdout:  absolute path to the created worktree directory
# stderr:  log messages (must not pollute stdout)
#
# Env (optional):
#   BRIDGE_SERVER_URL - Override server URL (default: http://localhost:3001)
#
# Requires: jq, git

set -euo pipefail

# ── Read stdin ────────────────────────────────────────────────────────────

INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.name')
CWD=$(echo "$INPUT" | jq -r '.cwd')

if [[ -z "$NAME" || "$NAME" == "null" ]]; then
  echo "[bridge] Error: no worktree name provided" >&2
  exit 1
fi

# ── Create git worktree ──────────────────────────────────────────────────

WORKTREE_DIR="$CWD/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

# Base on HEAD so the agent works on the same code the user is looking at.
echo "[bridge] Creating worktree '$NAME' at $WORKTREE_DIR (branch: $BRANCH)" >&2
git -C "$CWD" worktree add "$WORKTREE_DIR" -b "$BRANCH" HEAD >&2

# ── Write bridge hook settings ───────────────────────────────────────────

CLAUDE_DIR="$WORKTREE_DIR/.claude"
mkdir -p "$CLAUDE_DIR"

# Resolve absolute path to the bridge hooks directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/../hooks" && pwd)"

SERVER_URL="${BRIDGE_SERVER_URL:-http://localhost:3001}"

# Each hook command bakes in env vars so the hook scripts know
# which agent they're reporting for and where to send events.
ENV_PREFIX="BRIDGE_SERVER_URL=$SERVER_URL BRIDGE_AGENT_ID=$NAME BRIDGE_RUN_ID=$NAME"

cat > "$CLAUDE_DIR/settings.local.json" << SETTINGS_EOF
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ENV_PREFIX node $HOOKS_DIR/post-tool-use.mjs",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ENV_PREFIX node $HOOKS_DIR/session-stop.mjs"
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF

echo "[bridge] Hooks installed for agent '$NAME' → $SERVER_URL" >&2

# ── Register agent with the server ───────────────────────────────────────

# Fire-and-forget registration so the agent appears in the dashboard
# before it makes its first tool call.
curl -sf -X POST "$SERVER_URL/api/bridge/register" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"$NAME\"}" >/dev/null 2>&1 &

# ── Output worktree path (required by Claude Code) ───────────────────────

echo "$WORKTREE_DIR"
