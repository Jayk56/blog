#!/usr/bin/env bash
#
# Dogfood script for Phase 3C using long-running specialist agents.
#
# Instead of spawning fresh agents per wave (dogfood-3c.sh), this script
# uses 3 specialist agents that accumulate trust across assignments:
#
# | Agent              | Wave 1              | Wave 2                           | Wave 3+          |
# |--------------------|---------------------|----------------------------------|------------------|
# | intelligence-team  | 3C-9 trust harden   | 3C-3 domain trust, 3C-10 profs   | 3C-6 ROI         |
# | analytics-team     | 3C-1 override pats  | 3C-2 injection, 3C-5 constraints | 3C-4, 3C-7       |
# | ml-team            | 3C-8 FP tuning      | (idle)                           | assigned on need |
#
# Wave transitions use POST /api/agents/:id/assign (assign-on-idle).
# Trust scores carry over — by wave 2, agents at trust ~55-60 start
# auto-resolving safe bash in adaptive mode.
#
# Usage:
#   ./scripts/dogfood-3c-specialist.sh               # Full setup + wave 1
#   ./scripts/dogfood-3c-specialist.sh --wave 2      # Assign wave 2 work
#   ./scripts/dogfood-3c-specialist.sh --wave 3      # Assign wave 3 work
#   ./scripts/dogfood-3c-specialist.sh --seed-only   # Just seed
#   ./scripts/dogfood-3c-specialist.sh --status      # Check status
#

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
SHIM_DIR="$PROJECT_DIR/adapter-shim/claude"
SEED_FILE="$PROJECT_DIR/seeds/phase-3c.json"

SERVER_PORT=3001
SERVER_URL="http://localhost:$SERVER_PORT"

# ── Parse args ────────────────────────────────────────────────────────
WAVE=""
SEED_ONLY=false
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wave)
      WAVE="$2"
      shift 2
      ;;
    --seed-only)
      SEED_ONLY=true
      shift
      ;;
    --status)
      STATUS_ONLY=true
      shift
      ;;
    *)
      echo "Unknown arg: $1"
      exit 1
      ;;
  esac
done

# ── Helper: spawn an agent ───────────────────────────────────────────
spawn_agent() {
  local brief_json="$1"
  local agent_id
  agent_id=$(echo "$brief_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['brief']['agentId'])")

  echo "   Spawning $agent_id..."
  local response
  response=$(curl -s -X POST "$SERVER_URL/api/agents/spawn" \
    -H 'Content-Type: application/json' \
    -d "$brief_json")

  echo "   $agent_id response: $(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent',{}).get('status','unknown'))" 2>/dev/null || echo "see below")"
}

# ── Helper: assign new work to an idle agent ─────────────────────────
assign_agent() {
  local agent_id="$1"
  local brief_json="$2"

  echo "   Assigning new work to $agent_id..."
  local response
  response=$(curl -s -X POST "$SERVER_URL/api/agents/$agent_id/assign" \
    -H 'Content-Type: application/json' \
    -d "$brief_json")

  local assigned
  assigned=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('assigned', False))" 2>/dev/null || echo "false")

  if [ "$assigned" = "True" ]; then
    echo "   $agent_id assigned successfully (trust preserved)"
  else
    echo "   $agent_id assign response: $response"
  fi
}

# ── Status check ──────────────────────────────────────────────────────
if $STATUS_ONLY; then
  echo "=== Agent Status ==="
  curl -s "$SERVER_URL/api/agents" | python3 -c "
import sys, json
d = json.load(sys.stdin)
agents = d.get('agents', [])
for a in agents:
    sid = a.get('id', '?')
    status = a.get('status', '?')
    print(f'  {sid}: {status}')
if not agents:
    print('  (no agents)')
" 2>/dev/null || echo "Server not reachable"
  echo ""
  echo "=== Trust Scores ==="
  for agent_id in intelligence-team analytics-team ml-team; do
    trust=$(curl -s "$SERVER_URL/api/trust/$agent_id" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('score','?'))" 2>/dev/null || echo "?")
    echo "  $agent_id: $trust"
  done
  exit 0
fi

# ── Project brief (shared across all agents) ──────────────────────────
PROJECT_BRIEF='{
  "title": "Phase 3C: Learning, Adaptation & Self-Improvement",
  "description": "Close the feedback loops — the system learns from its own operation and adapts.",
  "goals": [
    "Override pattern analysis surfaces actionable insights",
    "FP auto-tuning adjusts Layer 1 thresholds from Layer 2 data",
    "Trust hardening prevents gaming via decay ceiling and risk-weighted deltas",
    "Domain-specific trust enables per-artifact-kind escalation",
    "Calibration profiles ship with UI selector",
    "Context injection self-tunes based on relevance",
    "Phase retrospectives generate summaries at checkpoints",
    "Constraint inference suggests brief improvements",
    "Control mode ROI informs mode recommendations",
    "Rework causal linking traces churn to causes",
    "All 1058+ existing tests passing, zero TS errors"
  ],
  "checkpoints": [
    "Wave 1 complete: override patterns, FP auto-tuning, trust hardening",
    "Wave 2 complete: injection optimization, domain trust, calibration profiles",
    "Wave 3 complete: retrospectives, constraint inference, control mode ROI, rework linking"
  ]
}'

KNOWLEDGE_SNAPSHOT='{
  "version": 1,
  "generatedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
  "workstreams": [],
  "pendingDecisions": [],
  "recentCoherenceIssues": [],
  "artifactIndex": [],
  "activeAgents": [],
  "estimatedTokens": 0
}'

# ── Wave 1: Initial spawn of 3 specialist agents ─────────────────────
spawn_wave_1() {
  echo ""
  echo "[Wave 1] Spawning 3 specialist agents"
  echo ""

  # intelligence-team: Trust, coherence, calibration specialist
  spawn_agent '{
    "brief": {
      "agentId": "intelligence-team",
      "role": "security-engineer",
      "description": "Build Trust Hardening: decay ceiling + risk-weighted deltas.\n\nSee 3C-9 spec. Add decayCeiling to TrustCalibrationConfig, implement risk-weighted deltas for trust gains, add applyRiskWeighting method.\n\nDefinition of Done:\n- decayCeiling config added with backward-compatible default\n- Risk weighting config added, disabled by default\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-9-trust-hardening",
      "readableWorkstreams": ["3c-9-trust-hardening", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/validation/, server/src/types/, server/test/",
        "MUST NOT break existing trust scoring behavior — new features disabled by default",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after EVERY change"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # analytics-team: Pattern analysis, insights specialist
  spawn_agent '{
    "brief": {
      "agentId": "analytics-team",
      "role": "analytics-engineer",
      "description": "Build Override Pattern Analysis service.\n\nSee 3C-1 spec. Create OverridePatternAnalyzer with analyzeOverrides(), add POST /api/insights/override-patterns route.\n\nDefinition of Done:\n- OverridePatternAnalyzer service with full test coverage\n- POST /api/insights/override-patterns endpoint returns valid report\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-1-override-patterns",
      "readableWorkstreams": ["3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # ml-team: Feedback loops, tuning specialist
  spawn_agent '{
    "brief": {
      "agentId": "ml-team",
      "role": "ml-engineer",
      "description": "Build False Positive Auto-Tuning for coherence Layer 1→Layer 2 feedback loop.\n\nSee 3C-8 spec. Add CoherenceFeedbackLoopConfig, implement feedback loop logic in CoherenceMonitor, add GET /api/coherence/feedback-loop endpoint.\n\nDefinition of Done:\n- Feedback loop logic integrated into CoherenceMonitor\n- GET /api/coherence/feedback-loop endpoint returns status\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-8-fp-auto-tuning",
      "readableWorkstreams": ["3c-8-fp-auto-tuning", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "Feedback loop MUST be disabled by default",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Changing coherence detection thresholds"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  echo ""
  echo "Wave 1: 3 specialist agents spawned."
  echo "   intelligence-team → 3C-9 trust hardening"
  echo "   analytics-team    → 3C-1 override patterns"
  echo "   ml-team           → 3C-8 FP auto-tuning"
}

# ── Wave 2: Assign new work to idle agents ────────────────────────────
assign_wave_2() {
  echo ""
  echo "[Wave 2] Assigning new work to idle specialists (trust preserved)"
  echo ""

  # intelligence-team: trust hardening done → domain trust + calibration profiles
  assign_agent "intelligence-team" '{
    "brief": {
      "agentId": "intelligence-team",
      "role": "backend-engineer",
      "description": "Build Domain-Specific Trust scoring AND Calibration Profiles.\n\nPart 1 (3C-3): Extend AgentTrustState with domainScores map, update applyOutcome() for per-domain scoring, add getDomainScores() API, extend GET /api/trust/:agentId.\n\nPart 2 (3C-10): Define 3 calibration profiles (conservative/balanced/permissive), add GET /api/trust/profiles and POST /api/trust/profile/:name routes, add TrustEngine.reconfigure().\n\nDefinition of Done:\n- Per-agent per-domain trust scores tracked\n- 3 calibration profiles with UI selector\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-3-domain-trust",
      "readableWorkstreams": ["3c-3-domain-trust", "3c-10-calibration-profiles", "3c-9-trust-hardening", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/controls/",
        "MUST NOT change global trust scoring behavior",
        "Balanced profile MUST match current defaults exactly",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after EVERY change"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "adaptive",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # analytics-team: override patterns done → injection optimization + constraint inference
  assign_agent "analytics-team" '{
    "brief": {
      "agentId": "analytics-team",
      "role": "analytics-engineer",
      "description": "Build Context Injection Optimization AND Constraint Inference.\n\nPart 1 (3C-2): Create InjectionOptimizer with analyzeEfficiency(), add self-tuning to ContextInjectionService, add POST /api/insights/injection-efficiency.\n\nPart 2 (3C-5): Create ConstraintInferenceService with suggestConstraints(), add POST /api/project/suggest-constraints and POST /api/project/constraint-feedback.\n\nDefinition of Done:\n- InjectionOptimizer with full test coverage\n- ConstraintInferenceService generates suggestions\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-2-injection-optimization",
      "readableWorkstreams": ["3c-2-injection-optimization", "3c-5-constraint-inference", "3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/brief-editor/",
        "Self-tuning MUST be disabled by default",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying injection frequency defaults"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "adaptive",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # ml-team stays idle (FP tuning done, no wave 2 work)
  echo "   ml-team: staying idle (available for on-demand assignment)"

  echo ""
  echo "Wave 2 assigned. Trust scores carry over from wave 1."
}

# ── Wave 3: Final assignments ─────────────────────────────────────────
assign_wave_3() {
  echo ""
  echo "[Wave 3] Assigning final deliverables to idle specialists"
  echo ""

  # intelligence-team: domain trust done → control mode ROI
  assign_agent "intelligence-team" '{
    "brief": {
      "agentId": "intelligence-team",
      "role": "analytics-engineer",
      "description": "Build Control Mode ROI Measurement.\n\nSee 3C-6 spec. Create ControlModeROIService, add POST /api/insights/control-mode-roi endpoint.\n\nDefinition of Done:\n- ControlModeROIService computes per-mode metrics\n- Comparison and recommendation generation\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-6-control-mode-roi",
      "readableWorkstreams": ["3c-6-control-mode-roi", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes"
      ],
      "escalationProtocol": {
        "alwaysEscalate": [],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "adaptive",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # analytics-team: injection/constraints done → retrospectives + rework linking
  assign_agent "analytics-team" '{
    "brief": {
      "agentId": "analytics-team",
      "role": "analytics-engineer",
      "description": "Build Phase Retrospectives AND Rework Causal Linking.\n\nPart 1 (3C-4): Create RetrospectiveService, add POST /api/project/retrospective endpoint.\n\nPart 2 (3C-7): Create ReworkCausalLinker, add POST /api/insights/rework-analysis endpoint.\n\nDefinition of Done:\n- RetrospectiveService generates summaries\n- ReworkCausalLinker traces updates to causes\n- All existing tests still passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-4-phase-retrospectives",
      "readableWorkstreams": ["3c-4-phase-retrospectives", "3c-7-rework-causal-linking", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/briefing/",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes"
      ],
      "escalationProtocol": {
        "alwaysEscalate": [],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "adaptive",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # ml-team: assign if needed, otherwise stays idle
  echo "   ml-team: still idle (auto-kill after 500 ticks if not assigned)"

  echo ""
  echo "Wave 3 assigned. By now, agents at trust ~55-60 auto-resolve safe tools."
}

# ── Main ──────────────────────────────────────────────────────────────

if [ -n "$WAVE" ]; then
  case "$WAVE" in
    1) spawn_wave_1 ;;
    2) assign_wave_2 ;;
    3) assign_wave_3 ;;
    *)
      echo "Unknown wave: $WAVE (valid: 1-3)"
      exit 1
      ;;
  esac
  exit 0
fi

# Full setup: start server + seed + wave 1
echo "=== Phase 3C Specialist Dogfood ==="
echo "Project dir: $PROJECT_DIR"
echo "Seed file:   $SEED_FILE"
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

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

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
echo "[2/3] Seeding project from $SEED_FILE..."

SEED_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/project/seed" \
  -H 'Content-Type: application/json' \
  -d @"$SEED_FILE")

echo "   $SEED_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print(f'   ERROR: {d[\"error\"]}')
    sys.exit(1)
ws = d.get('workstreams', [])
print(f'   Seeded: {d.get(\"title\", \"?\")}')
print(f'   Workstreams: {len(ws)}')
" 2>/dev/null || echo "   Response: $SEED_RESPONSE"

if $SEED_ONLY; then
  echo ""
  echo "Seed complete (--seed-only). Server running on $SERVER_URL"
  echo "Press Ctrl+C to shut down."
  wait $SERVER_PID
  exit 0
fi

# ── 3. Spawn Wave 1 ──────────────────────────────────────────────────
echo ""
echo "[3/3] Spawning Wave 1 specialist agents..."
spawn_wave_1

echo ""
echo "=========================================="
echo "  Phase 3C Specialist Dogfood Active"
echo "=========================================="
echo ""
echo "Server:     $SERVER_URL"
echo "Agents:     $SERVER_URL/api/agents"
echo ""
echo "3 specialist agents spawned:"
echo "  intelligence-team  → trust, coherence, calibration"
echo "  analytics-team     → patterns, insights, constraints"
echo "  ml-team            → feedback loops, tuning"
echo ""
echo "Wave transitions use assign-on-idle (trust preserved):"
echo "  Wave 1: Initial spawn (3 agents, trust=50)"
echo "  Wave 2: POST /assign with new briefs (trust ~55-60)"
echo "  Wave 3: Final deliverables (trust ~60-65, auto-resolve)"
echo ""
echo "To assign next waves (wait for Wave N to complete first):"
echo "  ./scripts/dogfood-3c-specialist.sh --wave 2"
echo "  ./scripts/dogfood-3c-specialist.sh --wave 3"
echo ""
echo "To check status and trust scores:"
echo "  ./scripts/dogfood-3c-specialist.sh --status"
echo ""
echo "Press Ctrl+C to shut down."
echo ""

wait $SERVER_PID
