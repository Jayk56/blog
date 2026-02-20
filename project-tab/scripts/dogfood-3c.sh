#!/usr/bin/env bash
#
# Dogfood script for Phase 3C: Learning, Adaptation & Self-Improvement
#
# Starts the server, seeds with the phase-3c.json plan, and spawns agents
# wave by wave. Run with --wave N to spawn a specific wave (default: full setup + wave 1).
#
# Usage:
#   ./scripts/dogfood-3c.sh             # Start server, seed, spawn Wave 1
#   ./scripts/dogfood-3c.sh --wave 2    # Spawn Wave 2 agents (server already running)
#   ./scripts/dogfood-3c.sh --wave 3    # Spawn Wave 3
#   ./scripts/dogfood-3c.sh --wave 4    # Spawn Wave 4
#   ./scripts/dogfood-3c.sh --wave 5    # Spawn Wave 5
#   ./scripts/dogfood-3c.sh --seed-only # Just seed, don't spawn agents
#   ./scripts/dogfood-3c.sh --status    # Check agent status
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

  local status
  status=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")

  if [ "$status" = "spawned" ] || [ "$status" = "running" ]; then
    echo "   $agent_id spawned successfully"
  else
    echo "   $agent_id spawn response: $response"
  fi
}

# ── Status check ──────────────────────────────────────────────────────
if $STATUS_ONLY; then
  echo "=== Agent Status ==="
  curl -s "$SERVER_URL/api/agents" | python3 -m json.tool 2>/dev/null || echo "Server not reachable"
  echo ""
  echo "=== Pending Decisions ==="
  curl -s "$SERVER_URL/api/decisions" | python3 -m json.tool 2>/dev/null || echo "Server not reachable"
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
    "Wave 3 complete: retrospectives, constraint inference, control mode ROI",
    "Wave 4 complete: rework causal linking",
    "All tests passing, zero TS errors, frontend builds clean"
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

# ── Wave 1 agents (no dependencies) ──────────────────────────────────
spawn_wave_1() {
  echo ""
  echo "[Wave 1] Spawning 3 parallel agents: Override Patterns, FP Auto-Tuning, Trust Hardening"
  echo ""

  # 3C-1: Override Pattern Analysis
  spawn_agent '{
    "brief": {
      "agentId": "3c-1-override-patterns",
      "role": "analytics-engineer",
      "description": "Build Override Pattern Analysis service.\n\n## What exists\n- TrustOutcomeRecord written to audit_log after decision resolution (3A-8a)\n- DomainOutcomeRecord type in trust-engine.ts with fields: agentId, outcome, effectiveDelta, tick, artifactKinds[], workstreams[], toolCategory\n- KnowledgeStore.listAuditLog(entityType?, entityId?) queries audit log\n- TrustEngine.flushDomainLog(agentId) returns buffered domain outcomes\n\n## What to build\n1. Create server/src/intelligence/override-pattern-analyzer.ts:\n   - OverridePatternReport type: { overridesByWorkstream, overridesByArtifactKind, overridesByToolCategory, overridesByAgent, temporalClusters, totalOverrides, analysisWindow }\n   - OverridePatternAnalyzer class with analyzeOverrides(auditRecords: AuditLogEntry[]): OverridePatternReport\n   - Temporal clustering: group overrides into 5-tick windows, flag windows with >3 overrides\n   - Override = any outcome containing \"override\" or \"human_picks_non_recommended\"\n\n2. Add route POST /api/insights/override-patterns in a new server/src/routes/insights.ts:\n   - Query audit_log for entity_type=trust_outcome\n   - Filter to override outcomes\n   - Call analyzer, return report\n   - Wire through ApiRouteDeps\n\n3. Add types to server/src/types/ as needed\n\n4. Write tests in server/test/intelligence/override-pattern-analyzer.test.ts:\n   - Empty audit log returns zero counts\n   - Single override counted correctly in all dimensions\n   - Multiple overrides aggregate by workstream/kind/tool/agent\n   - Temporal clustering detects burst patterns\n   - Non-override outcomes are excluded\n   - 8-12 tests total\n\n## Definition of Done\n- OverridePatternAnalyzer service with full test coverage\n- POST /api/insights/override-patterns endpoint returns valid report\n- All existing 1058+ tests still passing\n- Zero TypeScript errors\n- Run: npx vitest run to verify",
      "workstream": "3c-1-override-patterns",
      "readableWorkstreams": ["3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "Follow existing DI pattern: service in intelligence/, route in routes/, wire through ApiRouteDeps",
        "Use Zod parseBody for request validation on new endpoints",
        "TypeScript strict mode — no implicit any",
        "Do NOT modify trust-engine.ts scoring logic — only read from it",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas", "Changing event bus message shapes"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # 3C-8: FP Auto-Tuning
  spawn_agent '{
    "brief": {
      "agentId": "3c-8-fp-auto-tuning",
      "role": "ml-engineer",
      "description": "Build False Positive Auto-Tuning for coherence Layer 1→Layer 2 feedback loop.\n\n## What exists\n- CoherenceMonitor in server/src/intelligence/coherence-monitor.ts\n- layer1PromotionThreshold (default 0.75) in CoherenceMonitorConfig\n- Layer 2 reviews produce CoherenceReviewResult with confirmed: boolean, confidence: high|likely|low\n- ReviewRateLimiter tracks reviews per hour window\n- runLayer2Review() batches pending candidates (up to 5 per call)\n- getReviewResults() returns all Layer 2 results\n\n## What to build\n1. Add CoherenceFeedbackLoopConfig type to coherence-monitor.ts:\n   - enabled: boolean (default false)\n   - minReviewsBeforeAdjust: number (default 20)\n   - fpThresholdHigh: number (default 0.50) — above this, increase threshold\n   - fpThresholdLow: number (default 0.10) — below this, decrease threshold\n   - increaseStep: number (default 0.02)\n   - decreaseStep: number (default 0.01)\n   - minPromotionThreshold: number (default 0.75)\n   - maxPromotionThreshold: number (default 0.95)\n\n2. Add feedback loop logic to CoherenceMonitor:\n   - Track 24-hour review window: {confirmed: number, dismissed: number, windowStart: Date}\n   - After each Layer 2 batch completes, update window counters\n   - When window has >= minReviews: compute FP rate = dismissed / (confirmed + dismissed)\n   - If FP rate > fpThresholdHigh: layer1PromotionThreshold += increaseStep (clamp to max)\n   - If FP rate < fpThresholdLow: layer1PromotionThreshold -= decreaseStep (clamp to min)\n   - Log adjustment to audit log with old/new threshold and FP rate\n   - Roll window every 24 hours\n\n3. Add methods:\n   - getFeedbackLoopStatus(): { fpRate, reviewCount, currentThreshold, lastAdjustment, windowStart }\n   - getThresholdHistory(): Array<{timestamp, oldThreshold, newThreshold, fpRate, reviewCount}>\n\n4. Add endpoint GET /api/coherence/feedback-loop in server/src/routes/coherence.ts (or extend existing if present)\n\n5. Write tests in server/test/intelligence/coherence-feedback-loop.test.ts:\n   - Disabled by default — no adjustment when enabled=false\n   - No adjustment below minimum review count\n   - High FP rate increases threshold by increaseStep\n   - Low FP rate decreases threshold by decreaseStep\n   - Threshold clamped to [min, max]\n   - Window rolls after 24 hours\n   - Mixed results (boundary FP rate) — no adjustment\n   - 8-10 tests total\n\n## Definition of Done\n- CoherenceFeedbackLoopConfig type with sensible defaults\n- Feedback loop logic integrated into CoherenceMonitor\n- GET /api/coherence/feedback-loop endpoint returns status\n- Threshold history tracked and queryable\n- All existing 1058+ tests still passing\n- Zero TypeScript errors\n- Run: npx vitest run to verify",
      "workstream": "3c-8-fp-auto-tuning",
      "readableWorkstreams": ["3c-8-fp-auto-tuning", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "Feedback loop MUST be disabled by default (enabled: false) for backward compatibility",
        "Do NOT change existing Layer 1 or Layer 2 logic — only add the feedback mechanism",
        "Threshold adjustment is server-side computation — no LLM calls",
        "Use audit_log for persisting threshold change history",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Changing coherence detection thresholds in existing code"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # 3C-9: Trust Hardening
  spawn_agent '{
    "brief": {
      "agentId": "3c-9-trust-hardening",
      "role": "security-engineer",
      "description": "Build Trust Hardening: decay ceiling + risk-weighted deltas.\n\n## What exists\n- TrustEngine in server/src/intelligence/trust-engine.ts\n- TrustCalibrationConfig: initialScore=50, floorScore=10, ceilingScore=100, decayTargetScore=50, decayRatePerTick=0.01\n- AgentTrustState: { score, lastActivityTick, decayAccumulator }\n- onTick() decay: state.score = Math.max(decayTargetScore, state.score - 1) when score > baseline\n- applyOutcome(agentId, outcome, tick, context?) applies delta from deltaTable\n- applyDiminishingReturns(delta, score) halves at extremes (>90 or <20)\n- TrustOutcomeContext: { artifactKinds?, workstreams?, toolCategory? }\n- blastRadiusSchema in validation/schemas.ts: trivial|small|medium|large|unknown\n\n## What to build\n\n### Part A: Decay Ceiling\n1. Add decayCeiling: number to TrustCalibrationConfig (default 50 = same as decayTargetScore, so no-op by default)\n2. In onTick() decay logic: after computing new score, also apply Math.min(score, decayCeiling) when agent has been inactive for > N ticks\n3. Purpose: inactive agents cannot retain high trust scores indefinitely. If decayCeiling=30, an idle agent at score 80 will decay down to 30 (not stop at 50)\n\n### Part B: Risk-Weighted Deltas\n1. Add riskWeights config to TrustCalibrationConfig:\n   - riskWeightingEnabled: boolean (default false)\n   - riskWeightMap: Record<string, number> with defaults: { trivial: 0.5, small: 0.75, medium: 1.0, large: 1.5, unknown: 1.0 }\n2. Add applyRiskWeighting(baseDelta: number, blastRadius: string): number method\n   - effectiveDelta = baseDelta * riskWeightMap[blastRadius]\n   - Only applies to positive deltas (trust gains) — negative deltas (trust losses) use full weight\n   - This prevents trust-farming through trivial approvals\n3. Call applyRiskWeighting in applyOutcome() when riskWeightingEnabled and context has blast radius info\n   - Extract blast radius from context or default to \"unknown\"\n\n### Part C: Schema updates\n1. Update TrustCalibrationConfig Zod schema in validation/schemas.ts if one exists\n2. Ensure config is serializable for API responses\n\n4. Write tests in server/test/intelligence/trust-hardening.test.ts:\n   - Decay ceiling: idle agent decays past decayTargetScore down to ceiling\n   - Decay ceiling: active agent not affected by ceiling\n   - Decay ceiling: default (50) is no-op with default decayTargetScore (50)\n   - Decay ceiling: ceiling < decayTarget causes deeper decay\n   - Risk weighting: trivial blast radius halves positive delta\n   - Risk weighting: large blast radius amplifies positive delta\n   - Risk weighting: negative delta not reduced (trust loss always full)\n   - Risk weighting: disabled by default — no change to existing behavior\n   - Risk weighting: unknown blast radius uses 1.0 (neutral)\n   - Backward compatibility: all existing trust tests still pass with new defaults\n   - 10-14 tests total\n\n## Definition of Done\n- decayCeiling config added with backward-compatible default\n- Risk weighting config added, disabled by default\n- onTick() respects decay ceiling for inactive agents\n- applyOutcome() applies risk weighting when enabled\n- All existing 1058+ tests still passing (CRITICAL — trust tests are sensitive)\n- Zero TypeScript errors\n- Run: npx vitest run to verify",
      "workstream": "3c-9-trust-hardening",
      "readableWorkstreams": ["3c-9-trust-hardening", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/validation/, server/src/types/, server/test/",
        "MUST NOT break existing trust scoring behavior — new features disabled by default",
        "Risk weighting only applies to positive deltas (trust gains), not losses",
        "Decay ceiling must default to same value as decayTargetScore (no-op by default)",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after EVERY change — trust tests are fragile",
        "Do not modify the deltaTable values or outcome mapping logic"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas", "Changing default trust config values"],
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
  echo "Wave 1 agents spawned. Monitor in the Queue workspace."
}

# ── Wave 2 agents (depend on Wave 1) ─────────────────────────────────
spawn_wave_2() {
  echo ""
  echo "[Wave 2] Spawning 4 agents: Injection Optimization, Domain Trust, Constraint Inference, Calibration Profiles"
  echo ""

  # 3C-2: Context Injection Optimization
  spawn_agent '{
    "brief": {
      "agentId": "3c-2-injection-optimization",
      "role": "analytics-engineer",
      "description": "Build Context Injection Optimization service.\n\n## What exists\n- ContextInjectionService in server/src/intelligence/context-injection-service.ts\n- InjectionRecord type: { tick, reason, priority, snapshotVersion, artifactIdsIncluded, agentEventsInWindow, artifactIdsReferencedInWindow }\n- flushInjectionRecords(agentId) returns InjectionRecord[] for audit flush\n- Records persisted to audit_log with entity_type=context_injection\n- Frequency: periodicIntervalTicks per control mode (10/20/50), maxInjectionsPerHour=12, cooldown=5 ticks\n\n## What to build\n1. Create server/src/intelligence/injection-optimizer.ts:\n   - InjectionEfficiencyReport type: { totalInjections, avgArtifactsIncluded, avgArtifactsReferenced, overlapRate, unusedArtifactRate, perReasonBreakdown, perModeRecommendations, analysisWindow }\n   - overlapRate = avg(referencedInWindow ∩ included) / avg(included) — measures how much of each injection was actually useful\n   - unusedArtifactRate = 1 - overlapRate\n   - perReasonBreakdown: { periodic, reactive, staleness, brief_updated } with counts and avg overlap\n   - perModeRecommendations: for each control mode suggest frequency adjustments based on overlap\n   - InjectionOptimizer class with analyzeEfficiency(records: InjectionRecord[]): InjectionEfficiencyReport\n\n2. Add optional self-tuning to ContextInjectionService:\n   - selfTuningEnabled: boolean config (default false)\n   - When enabled and after N injections, compute overlap and adjust periodicIntervalTicks\n   - High overlap (>80%): decrease interval (inject more often, its useful)\n   - Low overlap (<30%): increase interval (injections mostly wasted)\n   - Clamp intervals to [5, 100] ticks\n\n3. Add endpoint POST /api/insights/injection-efficiency in routes/insights.ts (extend from 3C-1)\n\n4. Write tests in server/test/intelligence/injection-optimizer.test.ts:\n   - Empty records returns zero report\n   - Perfect overlap (all included artifacts referenced) → overlapRate=1.0\n   - Zero overlap → overlapRate=0.0\n   - Mixed overlap computed correctly\n   - Per-reason breakdown aggregates correctly\n   - Self-tuning adjusts interval in correct direction\n   - 8-10 tests\n\n## Definition of Done\n- InjectionOptimizer service with full test coverage\n- POST /api/insights/injection-efficiency returns valid report\n- Self-tuning config added (disabled by default)\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-2-injection-optimization",
      "readableWorkstreams": ["3c-2-injection-optimization", "3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "Self-tuning MUST be disabled by default",
        "Do NOT modify existing injection scheduling logic — only add analysis layer",
        "Extend the insights router from 3C-1 if it exists, otherwise create new",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying injection frequency defaults"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # 3C-3: Domain-Specific Trust
  spawn_agent '{
    "brief": {
      "agentId": "3c-3-domain-trust",
      "role": "backend-engineer",
      "description": "Build Domain-Specific Trust scoring.\n\n## What exists\n- TrustEngine tracks global per-agent score (0-100)\n- DomainOutcomeRecord: { agentId, outcome, effectiveDelta, tick, artifactKinds[], workstreams[], toolCategory }\n- domainOutcomeLogs: Map<string, DomainOutcomeRecord[]> (in-memory only)\n- flushDomainLog(agentId) returns and clears buffer\n- ArtifactKind type: code|document|design|config|test|other (in events.ts)\n- TrustOutcomeContext passed to applyOutcome() with domain info\n- GET /api/trust/:agentId returns { agentId, score, config }\n\n## What to build\n1. Extend AgentTrustState in trust-engine.ts:\n   - Add domainScores: Map<ArtifactKind, number> (per-agent per-domain scores)\n   - Initialize each domain at initialScore (50) on first domain outcome\n   - Domain scores decay independently (same rate as global, but per-domain)\n\n2. Update applyOutcome() to update domain scores:\n   - When context.artifactKinds is provided, apply delta to each matching domain score\n   - Domain score uses same diminishing returns and floor/ceiling as global\n   - Global score still computed as before (unchanged)\n\n3. Add to TrustEngine public API:\n   - getDomainScores(agentId): Map<ArtifactKind, number>\n   - getDomainScore(agentId, kind: ArtifactKind): number\n   - getAllDomainScores(): Array<{ agentId, domainScores: Record<ArtifactKind, number> }>\n\n4. Persist domain scores:\n   - Store in KnowledgeStore alongside trust profiles\n   - Add domain_scores column or separate table\n\n5. Extend GET /api/trust/:agentId to include domainScores in response\n\n6. Add domainTrustThreshold to escalation logic:\n   - If an agents domain score for the relevant artifact kind is below threshold, escalate\n   - Add to EscalationPredicate type if it exists\n\n7. Write tests in server/test/intelligence/domain-trust.test.ts:\n   - Domain score initialized on first domain outcome\n   - Domain scores updated independently per artifact kind\n   - Domain decay applies per-domain on tick\n   - Global score unchanged by domain logic\n   - getDomainScores returns correct map\n   - Low domain score triggers escalation\n   - No domain outcomes = no domain scores (backward compat)\n   - 10-12 tests\n\n## Definition of Done\n- Per-agent per-domain trust scores tracked and decayed\n- Domain scores included in /api/trust/:agentId response\n- Domain threshold in escalation predicates\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-3-domain-trust",
      "readableWorkstreams": ["3c-3-domain-trust", "3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "MUST NOT change global trust scoring behavior",
        "Domain scores are additive — they do NOT replace the global score",
        "Initialize domain scores lazily (only when first domain outcome arrives)",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after EVERY change to trust-engine.ts"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas", "Changing event bus message shapes"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # 3C-5: Constraint Inference
  spawn_agent '{
    "brief": {
      "agentId": "3c-5-constraint-inference",
      "role": "analytics-engineer",
      "description": "Build Constraint Inference service.\n\n## What exists\n- ProjectConfig.constraints: string[] stored in KnowledgeStore\n- PATCH /api/project updates constraints via projectPatchSchema\n- ConstraintsSection.tsx: add/edit/remove constraints in Brief Editor\n- Audit log contains trust outcomes, coherence issues, injection records\n- Override pattern analysis (3C-1) provides OverridePatternReport\n\n## What to build\n1. Create server/src/intelligence/constraint-inference-service.ts:\n   - ConstraintSuggestion type: { id, text, reasoning, confidence: high|medium|low, source: override_pattern|coherence_pattern|domain_analysis, relatedEvidence: string[] }\n   - ConstraintInferenceService class:\n     - constructor(knowledgeStore, trustEngine)\n     - suggestConstraints(): ConstraintSuggestion[]\n     - Logic: analyze audit log patterns to infer useful constraints:\n       a. Frequent overrides in a workstream → suggest constraint scoping that workstream\n       b. Recurring coherence issues between workstreams → suggest coordination constraint\n       c. High override rate for a tool category → suggest tool-specific constraints\n     - Each suggestion includes reasoning text explaining why\n\n2. Add endpoint POST /api/project/suggest-constraints in routes/project.ts:\n   - Calls ConstraintInferenceService.suggestConstraints()\n   - Returns { suggestions: ConstraintSuggestion[] }\n   - Wire through ApiRouteDeps\n\n3. Track suggestion feedback:\n   - POST /api/project/constraint-feedback with { suggestionId, accepted: boolean }\n   - Store in audit_log for future inference refinement\n   - Accepted suggestions auto-added to project constraints via existing PATCH logic\n\n4. Frontend: Add suggestion UI to ConstraintsSection.tsx:\n   - \"Suggested constraints\" section below existing constraints\n   - Each suggestion shows text + reasoning + confidence badge\n   - Accept button: dispatches add-constraint + calls constraint-feedback API\n   - Dismiss button: calls constraint-feedback API with accepted=false\n   - Fetch suggestions on component mount via API\n\n5. Write tests in server/test/intelligence/constraint-inference.test.ts:\n   - No audit data returns empty suggestions\n   - Override pattern in workstream suggests workstream constraint\n   - Coherence pattern between workstreams suggests coordination constraint\n   - High tool override rate suggests tool constraint\n   - Confidence levels assigned correctly\n   - Feedback stored in audit log\n   - 8-10 tests\n\n## Definition of Done\n- ConstraintInferenceService generates data-driven suggestions\n- POST /api/project/suggest-constraints endpoint\n- POST /api/project/constraint-feedback endpoint\n- Frontend shows suggestions with accept/dismiss\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-5-constraint-inference",
      "readableWorkstreams": ["3c-5-constraint-inference", "3c-1-override-patterns", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/brief-editor/",
        "This is a Tier 1 (server-side computation) service — no LLM calls",
        "Constraint suggestions are just string proposals — human must accept/dismiss",
        "Follow existing dark theme with indigo accents for frontend components",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying public API signatures"],
        "escalateWhen": [],
        "neverEscalate": ["Read", "Glob", "Grep"]
      },
      "controlMode": "orchestrator",
      "projectBrief": '"$PROJECT_BRIEF"',
      "knowledgeSnapshot": '"$KNOWLEDGE_SNAPSHOT"',
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }'

  # 3C-10: Calibration Profiles
  spawn_agent '{
    "brief": {
      "agentId": "3c-10-calibration-profiles",
      "role": "backend-engineer",
      "description": "Build Trust Calibration Profiles with UI selector.\n\n## What exists\n- TrustCalibrationConfig: { initialScore, floorScore, ceilingScore, decayTargetScore, decayRatePerTick, diminishingReturnThresholdHigh/Low, deltaTable, calibrationMode }\n- DEFAULT_CONFIG with balanced defaults (initial=50, floor=10, ceiling=100, etc.)\n- TrustEngine constructor: new TrustEngine(config: Partial<TrustCalibrationConfig>)\n- GET /api/trust/:agentId returns score + config\n- 3C-9 adds decayCeiling and riskWeighting to config (depends on that being done first)\n- ControlsWorkspace.tsx has ModeSelector, QualityDial, TrustTrajectories, etc.\n\n## What to build\n1. Define calibration profiles in server/src/intelligence/calibration-profiles.ts:\n   - CalibrationProfileName type: conservative|balanced|permissive\n   - CalibrationProfile type: { name, displayName, description, config: Partial<TrustCalibrationConfig> }\n   - PROFILES constant:\n     - Conservative: { initialScore: 30, ceilingScore: 60, decayCeiling: 25, decayRatePerTick: 0.02, riskWeightingEnabled: true, riskWeightMap: { trivial: 0.3, small: 0.5, medium: 1.0, large: 2.0 } }\n     - Balanced: current defaults (no overrides needed)\n     - Permissive: { initialScore: 70, ceilingScore: 100, decayCeiling: 60, decayRatePerTick: 0.005, floorScore: 30 }\n   - getProfile(name: CalibrationProfileName): CalibrationProfile\n   - listProfiles(): CalibrationProfile[]\n\n2. Add profile storage:\n   - Store active profile name in KnowledgeStore alongside ProjectConfig\n   - Default: balanced\n\n3. Add routes in server/src/routes/trust.ts:\n   - GET /api/trust/profiles — list all available profiles\n   - POST /api/trust/profile/:name — activate a profile\n     - Reconfigures TrustEngine with profile config\n     - Logs change to audit log\n     - Broadcasts trust config update via WebSocket\n\n4. Add TrustEngine method:\n   - reconfigure(config: Partial<TrustCalibrationConfig>): void — updates config at runtime\n   - Existing agent scores preserved, only config changes\n\n5. Frontend: Add CalibrationProfileSelector component in src/components/controls/:\n   - Dropdown or radio group: Conservative / Balanced / Permissive\n   - Show profile description\n   - On select: POST /api/trust/profile/:name\n   - Display current active profile\n   - Add to ControlsWorkspace.tsx alongside ModeSelector\n\n6. Write tests in server/test/intelligence/calibration-profiles.test.ts:\n   - All 3 profiles return valid TrustCalibrationConfig\n   - Conservative has lower ceilings and faster decay\n   - Permissive has higher initial scores\n   - Balanced matches default config\n   - Profile activation reconfigures engine\n   - Agent scores preserved on reconfigure\n   - GET /api/trust/profiles returns all 3\n   - POST /api/trust/profile/:name activates correctly\n   - Invalid profile name returns 400\n   - 8-12 tests\n\n## Definition of Done\n- 3 calibration profiles defined with distinct risk postures\n- Profile activation endpoint reconfigures TrustEngine at runtime\n- Frontend selector in Controls workspace\n- Profile changes logged to audit log\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-10-calibration-profiles",
      "readableWorkstreams": ["3c-10-calibration-profiles", "3c-9-trust-hardening", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/controls/",
        "Depends on 3C-9 trust hardening being complete (uses decayCeiling, riskWeighting)",
        "Balanced profile MUST match current defaults exactly (backward compat)",
        "Profile activation must NOT reset existing agent scores",
        "Follow existing dark theme with indigo accents for frontend components",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying trust scoring formulas", "Changing default trust config values"],
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
  echo "Wave 2 agents spawned. Monitor in the Queue workspace."
}

# ── Wave 3 agent (depends on Waves 1+2) ──────────────────────────────
spawn_wave_3() {
  echo ""
  echo "[Wave 3] Spawning 1 agent: Phase Retrospectives"
  echo ""

  # 3C-4: Phase Retrospectives
  spawn_agent '{
    "brief": {
      "agentId": "3c-4-phase-retrospectives",
      "role": "analytics-engineer",
      "description": "Build Phase Retrospectives — rich summaries generated at checkpoint boundaries.\n\n## What exists\n- BriefingService in server/src/intelligence/briefing-service.ts (LLM-based briefing generation)\n- KnowledgeStore: listAuditLog(), getSnapshot(), listArtifacts(), getEvents()\n- ProjectConfig.checkpoints: string[] — checkpoint labels\n- TrustEngine.getAllScores(), getDomainScores() (from 3C-3)\n- CoherenceMonitor.getReviewResults(), getFeedbackLoopStatus() (from 3C-8)\n- OverridePatternAnalyzer (from 3C-1)\n- InjectionOptimizer (from 3C-2)\n\n## What to build\n1. Create server/src/intelligence/retrospective-service.ts:\n   - PhaseRetrospective type: { phaseLabel, generatedAt, summary (markdown), metricsComparison: { metric, before, after, change }[], topInsights: string[], suggestedAdjustments: string[], trustTrajectory: { agentId, startScore, endScore }[], coherenceStats: { layer1Issues, layer2Reviews, fpRate }, overrideStats: { total, byWorkstream }, tickRange: { start, end } }\n   - RetrospectiveService class:\n     - constructor(knowledgeStore, trustEngine, coherenceMonitor, overrideAnalyzer?)\n     - generateRetrospective(checkpointLabel: string, tickRange: {start, end}): PhaseRetrospective\n     - Logic: gather all metrics for tick range, compute deltas, identify top insights\n     - This is Tier 2 (agent task) — data gathering is server-side, interpretation can use LLM if available\n\n2. Add endpoint POST /api/project/retrospective in routes/project.ts:\n   - Body: { checkpoint: string, tickRange: { start: number, end: number } }\n   - Calls RetrospectiveService.generateRetrospective()\n   - Returns PhaseRetrospective\n\n3. Store retrospectives:\n   - Save to KnowledgeStore (new table or audit_log with entity_type=retrospective)\n   - GET /api/project/retrospectives — list all generated retrospectives\n\n4. Frontend: Surface in BriefingWorkspace.tsx:\n   - New Retrospectives section below main briefing\n   - List of past retrospectives with expand/collapse\n   - Generate retrospective button (triggers POST)\n   - Display markdown summary, metrics table, insights list\n\n5. Write tests in server/test/intelligence/retrospective-service.test.ts:\n   - Empty tick range returns minimal retrospective\n   - Metrics comparison computed correctly\n   - Trust trajectory captured per agent\n   - Coherence stats aggregated\n   - Override stats from analyzer\n   - Retrospective stored and retrievable\n   - 8-10 tests\n\n## Definition of Done\n- RetrospectiveService generates rich summaries from system data\n- POST /api/project/retrospective endpoint\n- GET /api/project/retrospectives lists history\n- Frontend displays retrospectives in Briefing workspace\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-4-phase-retrospectives",
      "readableWorkstreams": ["3c-4-phase-retrospectives", "3c-1-override-patterns", "3c-2-injection-optimization", "3c-3-domain-trust", "3c-8-fp-auto-tuning", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/briefing/",
        "Data gathering is server-side computation (Tier 1), interpretation is Tier 2 agent task",
        "If no LLM available, generate a structured template retrospective (no LLM required path)",
        "Follow existing dark theme with indigo accents for frontend components",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying public API signatures", "Changing event bus message shapes"],
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
  echo "Wave 3 agent spawned."
}

# ── Wave 4 agent (depends on Waves 1-3) ──────────────────────────────
spawn_wave_4() {
  echo ""
  echo "[Wave 4] Spawning 1 agent: Control Mode ROI"
  echo ""

  # 3C-6: Control Mode ROI Measurement
  spawn_agent '{
    "brief": {
      "agentId": "3c-6-control-mode-roi",
      "role": "analytics-engineer",
      "description": "Build Control Mode ROI Measurement.\n\n## What exists\n- DecisionQueue in server/src/intelligence/decision-queue.ts\n- TrustEngine with getAllScores(), getDomainScores()\n- ControlMode: orchestrator|adaptive|ecosystem\n- Audit log with trust outcomes, decisions, coherence issues\n- RetrospectiveService (from 3C-4), ConstraintInferenceService (from 3C-5)\n\n## What to build\n1. Create server/src/intelligence/control-mode-roi-service.ts:\n   - ControlModeROI type: { mode, analysisWindow: {start, end}, metrics: { avgDecisionLatencyMs, overrideRate, coherenceIssueRate, taskCompletionRate, estimatedCostPerTick }, comparison?: { currentMode: ControlModeROI, alternativeModes: ControlModeROI[] }, recommendation?: { suggestedMode, reasoning, confidence } }\n   - ControlModeROIService class:\n     - constructor(knowledgeStore, decisionQueue, trustEngine)\n     - computeROI(mode: ControlMode, tickRange: {start, end}): ControlModeROI\n     - Compute metrics from audit log:\n       a. avgDecisionLatencyMs: time from decision created to resolved\n       b. overrideRate: human overrides / total decisions\n       c. coherenceIssueRate: coherence issues / total ticks\n       d. taskCompletionRate: completed artifacts / total artifacts\n       e. estimatedCostPerTick: (decisions requiring human attention) / ticks\n     - compareROI(currentMode, tickRange): comparison + recommendation\n     - Recommendation is Tier 2 (agent task) — structured comparison is Tier 1\n\n2. Add endpoint POST /api/insights/control-mode-roi in routes/insights.ts:\n   - Body: { tickRange: { start, end } }\n   - Returns current mode ROI + comparison with alternatives\n\n3. Store ROI snapshots:\n   - Save to audit_log with entity_type=control_mode_roi\n   - Enable trend tracking over time\n\n4. Write tests in server/test/intelligence/control-mode-roi.test.ts:\n   - Empty tick range returns zero metrics\n   - Decision latency computed correctly from timestamps\n   - Override rate computed as fraction\n   - Coherence issue rate computed per tick\n   - Comparison generates alternative mode projections\n   - Recommendation generated with reasoning\n   - 8-10 tests\n\n## Definition of Done\n- ControlModeROIService computes per-mode metrics\n- POST /api/insights/control-mode-roi endpoint\n- Comparison and recommendation generation\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-6-control-mode-roi",
      "readableWorkstreams": ["3c-6-control-mode-roi", "3c-4-phase-retrospectives", "3c-5-constraint-inference", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/",
        "Server-side aggregation is Tier 1 (no LLM), interpretation/recommendation is Tier 2",
        "If no LLM, return metrics without recommendation",
        "Do NOT modify DecisionQueue internals — only query via public API",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying public API signatures"],
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
  echo "Wave 4 agent spawned."
}

# ── Wave 5 agent (depends on Waves 1-4) ──────────────────────────────
spawn_wave_5() {
  echo ""
  echo "[Wave 5] Spawning 1 agent: Rework Causal Linking"
  echo ""

  # 3C-7: Rework Causal Linking
  spawn_agent '{
    "brief": {
      "agentId": "3c-7-rework-causal-linking",
      "role": "analytics-engineer",
      "description": "Build Rework Causal Linking — trace artifact churn to upstream causes.\n\n## What exists\n- KnowledgeStore: listArtifacts(), getEvents(), listAuditLog()\n- CoherenceMonitor: getReviewResults() with confirmed/dismissed issues\n- TrustEngine with outcome history (trust_outcome audit records)\n- Artifact events track updates: artifact_approved, artifact_rejected, artifact_updated\n- Decision audit log tracks overrides and resolutions\n\n## What to build\n1. Create server/src/intelligence/rework-causal-linker.ts:\n   - ReworkCause type: coherence_issue|human_override|dependency_cascade|voluntary_improvement\n   - ReworkLink type: { artifactId, artifactKind, workstream, updateTick, cause: ReworkCause, evidence: string, upstreamArtifactId?, upstreamDecisionId?, upstreamCoherenceIssueId? }\n   - ReworkCausalReport type: { artifactId, links: ReworkLink[], totalReworks, primaryCause: ReworkCause }\n   - AggregateReworkStats type: { totalReworks, byCause: Record<ReworkCause, number>, byWorkstream, byArtifactKind, topChurnArtifacts: { artifactId, reworkCount }[] }\n   - ReworkCausalLinker class:\n     - constructor(knowledgeStore, coherenceMonitor)\n     - analyzeArtifact(artifactId): ReworkCausalReport\n       - Find all update events for artifact\n       - For each update, classify cause:\n         a. Check if a coherence issue was raised for this artifact just before update → coherence_issue\n         b. Check if a human override decision preceded update → human_override\n         c. Check if an upstream artifact was updated in same tick window → dependency_cascade\n         d. Otherwise → voluntary_improvement\n       - Link to upstream evidence (coherence issue ID, decision ID, upstream artifact ID)\n     - analyzeAll(tickRange): AggregateReworkStats\n       - Run analysis for all artifacts with updates in range\n       - Aggregate by cause, workstream, kind\n       - Identify top churn artifacts\n\n2. Add endpoint POST /api/insights/rework-analysis in routes/insights.ts:\n   - Body: { artifactId?: string, tickRange?: { start, end } }\n   - If artifactId: return per-artifact ReworkCausalReport\n   - If tickRange: return AggregateReworkStats\n\n3. Frontend: Add rework annotations to MapWorkspace.tsx:\n   - On artifact nodes, show small rework indicator (icon + count)\n   - Tooltip or drawer shows cause breakdown\n   - Color-code by primary cause (red=coherence, orange=override, blue=cascade, green=voluntary)\n\n4. Write tests in server/test/intelligence/rework-causal-linker.test.ts:\n   - Artifact with no updates returns empty links\n   - Update preceded by coherence issue classified correctly\n   - Update preceded by human override classified correctly\n   - Upstream artifact update triggers dependency cascade\n   - Unlinked update classified as voluntary improvement\n   - Aggregate stats sum correctly\n   - Top churn artifacts sorted by count\n   - 8-12 tests\n\n## Definition of Done\n- ReworkCausalLinker traces updates to upstream causes\n- Per-artifact and aggregate analysis endpoints\n- Frontend rework annotations on Map workspace nodes\n- All existing tests passing, zero TS errors\n- Run: npx vitest run to verify",
      "workstream": "3c-7-rework-causal-linking",
      "readableWorkstreams": ["3c-7-rework-causal-linking", "3c-6-control-mode-roi", "types", "intelligence"],
      "constraints": [
        "Only create/modify files under server/src/intelligence/, server/src/routes/, server/src/types/, server/test/, src/components/map/",
        "This is a Tier 2 agent task — data gathering is server-side, causal classification can use heuristics",
        "Do NOT modify artifact event recording — only read existing events",
        "Follow existing dark theme with indigo accents for frontend components",
        "TypeScript strict mode — no implicit any",
        "Run npx vitest run after changes to verify all tests pass"
      ],
      "escalationProtocol": {
        "alwaysEscalate": ["Modifying public API signatures", "Changing event bus message shapes"],
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
  echo "Wave 5 agent spawned."
}

# ── Main ──────────────────────────────────────────────────────────────

if [ -n "$WAVE" ]; then
  # Spawn specific wave (server already running)
  case "$WAVE" in
    1) spawn_wave_1 ;;
    2) spawn_wave_2 ;;
    3) spawn_wave_3 ;;
    4) spawn_wave_4 ;;
    5) spawn_wave_5 ;;
    *)
      echo "Unknown wave: $WAVE (valid: 1-5)"
      exit 1
      ;;
  esac
  exit 0
fi

# Full setup: start server + seed + wave 1
echo "=== Phase 3C Dogfood Setup ==="
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
print(f'   Goals: {len(d.get(\"goals\", []))}')
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
echo "[3/3] Spawning Wave 1 agents..."
spawn_wave_1

echo ""
echo "=========================================="
echo "  Phase 3C Dogfood Active"
echo "=========================================="
echo ""
echo "Server:     $SERVER_URL"
echo "Health:     $SERVER_URL/api/health"
echo "Agents:     $SERVER_URL/api/agents"
echo "Decisions:  $SERVER_URL/api/decisions"
echo ""
echo "Start the frontend in another terminal:"
echo "  cd $PROJECT_DIR && npm run dev"
echo ""
echo "Then open http://localhost:5173 and watch the Queue workspace"
echo "for tool approval decisions to approve/reject."
echo ""
echo "Dependency graph (5 waves):"
echo "  Wave 1: Override Patterns, FP Auto-Tuning, Trust Hardening (3 parallel)"
echo "  Wave 2: Injection Optimization, Domain Trust, Constraint Inference, Calibration Profiles (4 parallel)"
echo "  Wave 3: Phase Retrospectives"
echo "  Wave 4: Control Mode ROI"
echo "  Wave 5: Rework Causal Linking"
echo ""
echo "To spawn next waves:"
echo "  ./scripts/dogfood-3c.sh --wave 2"
echo "  ./scripts/dogfood-3c.sh --wave 3"
echo "  ./scripts/dogfood-3c.sh --wave 4"
echo "  ./scripts/dogfood-3c.sh --wave 5"
echo ""
echo "To check status:"
echo "  ./scripts/dogfood-3c.sh --status"
echo ""
echo "Press Ctrl+C to shut down."
echo ""

wait $SERVER_PID
