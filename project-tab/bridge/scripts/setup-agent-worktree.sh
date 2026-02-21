#!/usr/bin/env bash
# setup-agent-worktree.sh — Create a git worktree with bridge hooks for the spike
#
# Creates an isolated worktree at .claude/worktrees/<name>/ and writes
# per-worktree .claude/settings.local.json with PostToolUse + Stop hooks
# that report events to the project-tab server as agent <name>.
#
# Usage:
#   ./project-tab/bridge/scripts/setup-agent-worktree.sh <agent-name>
#   ./project-tab/bridge/scripts/setup-agent-worktree.sh maya-1
#   BRIDGE_SERVER_URL=http://localhost:3001 ./project-tab/bridge/scripts/setup-agent-worktree.sh david-1
#
# After setup, start Claude Code from the worktree:
#   cd .claude/worktrees/<agent-name> && claude
#
# Env (optional):
#   BRIDGE_SERVER_URL - Override server URL (default: http://localhost:3001)
#
# Requires: git

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: $0 <agent-name>" >&2
  echo "  e.g. $0 maya-1" >&2
  exit 1
fi

# ── Resolve project root (git root) ─────────────────────────────────────

PROJECT_ROOT="$(git rev-parse --show-toplevel)"

# ── Create git worktree ──────────────────────────────────────────────────

WORKTREE_DIR="$PROJECT_ROOT/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

if [[ -d "$WORKTREE_DIR" ]]; then
  echo "[bridge] Worktree '$NAME' already exists at $WORKTREE_DIR" >&2
  echo "[bridge] To recreate, first run: git worktree remove $WORKTREE_DIR" >&2
  exit 1
fi

# Base on HEAD so the agent works on the same code the user is looking at.
echo "[bridge] Creating worktree '$NAME' (branch: $BRANCH from HEAD)"
git -C "$PROJECT_ROOT" worktree add "$WORKTREE_DIR" -b "$BRANCH" HEAD

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

echo "[bridge] Hooks installed for agent '$NAME' → $SERVER_URL"

# ── Register agent with the server (best-effort) ────────────────────────

if curl -sf -X POST "$SERVER_URL/api/bridge/register" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"$NAME\"}" >/dev/null 2>&1; then
  echo "[bridge] Agent '$NAME' registered with server"
else
  echo "[bridge] Server not reachable — agent will auto-register on first tool call"
fi

# ── Done ─────────────────────────────────────────────────────────────────

echo ""
echo "Ready! Start a session with:"
echo "  cd $WORKTREE_DIR && claude"
