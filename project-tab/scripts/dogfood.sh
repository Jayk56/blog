#!/usr/bin/env bash
#
# Dogfood script: starts the server with the Claude adapter shim,
# seeds the project, and spawns an agent with decision gating.
#
# Usage: ./scripts/dogfood.sh
#
# Prerequisites:
#   - `claude` CLI installed and authenticated
#   - Server deps installed (cd server && npm install)
#   - Adapter shim deps installed (cd adapter-shim/claude && npm install)
#

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
SHIM_DIR="$PROJECT_DIR/adapter-shim/claude"

SERVER_PORT=3001
SERVER_URL="http://localhost:$SERVER_PORT"

echo "=== Project-Tab Dogfood Setup ==="
echo "Project dir: $PROJECT_DIR"
echo ""

# ── 1. Start the server ───────────────────────────────────────────────
echo "[1/3] Starting server with Claude adapter shim..."

SHIM_ENTRY="$SHIM_DIR/src/index.ts"

export PORT=$SERVER_PORT
export SHIM_COMMAND=npx
export SHIM_ARGS="tsx,$SHIM_ENTRY,--workspace,$PROJECT_DIR"
export DB_PATH=":memory:"
export BACKEND_URL="$SERVER_URL"

cd "$SERVER_DIR"
npx tsx src/index.ts &
SERVER_PID=$!

# Clean up on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Wait for server to be ready
echo "   Waiting for server on :$SERVER_PORT..."
for i in $(seq 1 30); do
  if curl -sf "$SERVER_URL/api/health" > /dev/null 2>&1; then
    echo "   Server ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "   ERROR: Server failed to start within 30s"
    exit 1
  fi
  sleep 1
done

# ── 2. Seed the project ──────────────────────────────────────────────
echo ""
echo "[2/3] Seeding project from $PROJECT_DIR..."

cd "$SERVER_DIR"
npx tsx scripts/bootstrap.ts "$PROJECT_DIR" --post --no-llm --server "$SERVER_URL" 2>&1 | tail -3

echo ""
echo "   Project seeded."

# ── 3. Spawn the agent ──────────────────────────────────────────────
echo ""
echo "[3/3] Spawning agent..."

# The plugin registered in the server is always "openai" (the name),
# but SHIM_COMMAND/SHIM_ARGS configure it to run the Claude adapter shim.
# Brief omits modelPreference so it uses the default plugin ("openai").
SPAWN_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/agents/spawn" \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": {
      "agentId": "dogfood-agent-1",
      "role": "backend-engineer",
      "description": "Add a GET /api/tool-gate/stats endpoint that returns aggregate counts of tool-gate decisions grouped by status. The endpoint should query the DecisionQueue for all decisions and filter those with subtype=tool_approval, then return { total, pending, resolved, timedOut }. Add the route handler inside createToolGateRouter in server/src/routes/tool-gate.ts. Write tests by appending a new describe block to server/test/routes/tool-gate.test.ts following the existing test patterns there. Run the test suite with: npx vitest run test/routes/tool-gate.test.ts to verify everything passes.",
      "workstream": "lib",
      "readableWorkstreams": ["lib", "types"],
      "constraints": [
        "Only modify files under server/src/routes/ and server/test/routes/",
        "Follow existing patterns in tool-gate.ts and decisions.ts",
        "Run npx vitest run test/routes/tool-gate.test.ts after changes to verify"
      ],
      "escalationProtocol": {
        "alwaysEscalate": [],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": {
        "title": "project-tab",
        "description": "Human-agent project management backend with decision gating",
        "goals": ["Add tool-gate stats endpoint", "All tests passing"],
        "checkpoints": ["Stats endpoint returns correct counts", "All vitest tests pass"]
      },
      "knowledgeSnapshot": {
        "version": 1,
        "generatedAt": "2026-02-14T08:00:00Z",
        "workstreams": [],
        "pendingDecisions": [],
        "recentCoherenceIssues": [],
        "artifactIndex": [],
        "activeAgents": [],
        "estimatedTokens": 0
      },
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }')

echo "$SPAWN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SPAWN_RESPONSE"

echo ""
echo "=== Dogfood Active ==="
echo ""
echo "Server:    $SERVER_URL"
echo "Health:    $SERVER_URL/api/health"
echo "Decisions: $SERVER_URL/api/decisions"
echo "Agents:    $SERVER_URL/api/agents"
echo ""
echo "Start the frontend in another terminal:"
echo "  cd $PROJECT_DIR && npm run dev"
echo ""
echo "Then open http://localhost:5173 and watch the Queue workspace"
echo "for tool approval decisions to approve/reject."
echo ""
echo "Press Ctrl+C to shut down."
echo ""

# Wait for server
wait $SERVER_PID
