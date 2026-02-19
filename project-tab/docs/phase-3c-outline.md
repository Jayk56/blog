# Phase 3C Outline: Learning, Adaptation & Self-Improvement

*Drafted 2026-02-18. This is an outline — deliverable specs will be fleshed out when 3A data is available.*

---

## Overview

Phase 3A plugs in real models (embeddings, LLM review) and starts recording feedback signals (3A-8). Phase 3B polishes the frontend and adds temporal navigation. Phase 3C **closes the feedback loops** — the system learns from its own operation and adapts.

The deliverables below are grouped into three tiers:

1. **Closed-loop analysis** (3C-1 through 3C-3) — analyze the data 3A-8 is recording
2. **Reflection & adaptation** (3C-4 through 3C-7) — system-level retrospectives and self-modification
3. **Hardening & scale** (3C-8 through 3C-10) — trust hardening and performance at scale

### Prerequisites

- Phase 3A complete (real models flowing, 3A-8 recording feedback data)
- Sufficient data volume: at minimum one multi-agent project run (~50+ decisions, ~100+ artifacts, ~20+ Layer 2 reviews)

### Key Design Decision: Agent Tasks vs. Bare LLM Calls

The system's core thesis is that agents with tools and context outperform bare LLM calls. Tier 2 analytical tasks (retrospectives, constraint inference, rework analysis) should follow this same principle — they should be **agent tasks**, not server-side LLM calls.

**Bare LLM calls** are appropriate when:
- All context is already assembled by the server (no exploration needed)
- The task runs frequently and must be fast/cheap
- The scope is focused comparison, not open-ended analysis

This applies to the existing coherence pipeline: Layer 2 review and Layer 1c sweep. The server has both artifacts, their metadata, and the similarity score. There's nothing for an agent to go discover.

**Agent tasks** are appropriate when:
- The analysis would benefit from pulling in more context than we can predict upfront
- The task runs infrequently (cost is acceptable)
- The task is exploratory or analytical — following threads, forming hypotheses, cross-referencing

This applies to Tier 2 deliverables: retrospectives (3C-4), constraint inference (3C-5), rework causal linking (3C-7), and potentially control mode ROI (3C-6). These are the system's own self-improvement tasks — they should use the same agent infrastructure the system manages for external agents.

**Implication for LlmReviewService**: The existing `LlmReviewService` (raw fetch, internal provider branching) stays as-is. We considered extracting an `LlmClient` interface for reuse across 3C services, but since 3C analytical tasks will be agent tasks rather than direct LLM calls, the only consumers of `LlmReviewService` remain Layer 2 review and Layer 1c sweep. An `LlmClient` abstraction would be premature — revisit if we add more direct LLM call sites.

---

## Tier 1: Closed-Loop Analysis

These consume the data that 3A-8 records and surface actionable insights.

### 3C-1: Decision Override Pattern Analysis

**What**: Analyze `TrustOutcomeRecord` data from 3A-8a to identify clustering in human overrides.

**Signals to compute**:
- Override rate by workstream ("85% of overrides happen in ws-backend")
- Override rate by artifact kind ("code artifacts overridden 3x more than docs")
- Override rate by tool category ("write tools overridden 4x more than read tools")
- Override rate by agent ("Agent X gets overridden on API decisions but not on tests")
- Temporal clustering ("overrides spike after control mode changes")

**Output**:
- `OverridePatternReport` type — computed periodically or on-demand
- Surfaced in a new "Insights" panel in the Controls workspace
- Optionally: auto-suggest escalation rule changes ("consider escalating code writes for Agent X")

**Depends on**: 3A-8a (TrustOutcomeRecord in audit_log), sufficient decision volume

---

### 3C-2: Context Injection Optimization

**What**: Analyze `InjectionRecord` data from 3A-8b to measure injection utility and optimize frequency.

**Signals to compute**:
- **Injection relevance**: overlap between `artifactIdsIncluded` and `artifactIdsReferencedInWindow` — did the agent use what we sent?
- **Injection efficiency by trigger type**: periodic vs reactive vs staleness — which produces higher relevance?
- **Optimal frequency per control mode**: is the current `periodicIntervalTicks` too frequent or too sparse?
- **Wasted injections**: injections where `agentEventsInWindow === 0` (agent did nothing after injection)

**Output**:
- `InjectionEfficiencyReport` type
- Recommendation for per-mode policy tuning (e.g., "reduce orchestrator periodic interval from 10 to 20 ticks — 60% of injections are wasted")
- Optional: adaptive injection policy that self-tunes frequency based on observed relevance

**Depends on**: 3A-8b (InjectionRecord in audit_log), sufficient injection volume (~50+ records)

---

### 3C-3: Domain-Specific Trust

**What**: Use the domain-tagged outcome log from 3A-8c to compute and display per-domain trust scores.

**Changes to TrustEngine**:
- Maintain a parallel `domainScores: Map<ArtifactKind, number>` per agent (same delta/decay mechanics, applied per-domain)
- When a trust outcome has `artifactKinds` context, apply delta to those domains in addition to the global score
- Domain scores decay independently (an agent idle on code but active on docs only decays code trust)

**Changes to Escalation**:
- `EscalationPredicate` gains optional `domainTrustThreshold` field: "escalate if trust for this artifact kind < 60"
- This enables: "Agent X is trusted for read-only analysis but must escalate code writes"

**Frontend**:
- `TrustTrajectories` already has `scoreByDomain` in its type — wire it to real data
- Show domain breakdown on hover/expand in the Controls workspace

**Depends on**: 3A-8c (domain outcome log), Phase 3B (TrustTrajectories component)

---

## Tier 2: Reflection & Adaptation

System-level capabilities for reviewing past performance and adjusting future behavior.

### 3C-4: Phase Retrospectives

**What**: Formalize checkpoints as phase boundaries and generate retrospective summaries at each boundary.

**Implementation model**: **Agent task** (not a bare LLM call). A retrospective agent is spawned at phase boundaries with access to audit log queries, decision history, trust trajectories, and coherence events. The agent can follow threads — e.g., "overrides spiked after tick 45, let me look at what decisions were involved and what changed in the brief." This exploratory analysis produces richer insights than a static data dump sent to an LLM.

**Concept**:
- When a checkpoint is toggled "reached," treat it as a phase boundary
- Spawn a retrospective agent task with read access to project data
- Agent explores the phase: decisions made, trust changes, coherence issues detected, overrides, rework
- Compare current phase metrics against previous phase ("override rate dropped 40% since Phase 2")
- Surface as a "Retrospective" view in the Briefing workspace

**Data sources** (all already logged — agent queries these via tools):
- `audit_log` entries between checkpoint ticks
- Trust trajectory snapshots
- Decision log with resolutions
- Coherence events
- Injection records (if 3C-2 is complete)

**Output**: `PhaseRetrospective` type with:
- Summary (~200 words)
- Key metrics comparison (this phase vs previous)
- Top 3 insights ("most overrides were on ws-backend code artifacts")
- Suggested adjustments for next phase

**Depends on**: Agent infrastructure (adapter shim), sufficient per-phase data

---

### 3C-5: Constraint Inference

**What**: Automatically suggest new brief constraints based on observed patterns.

**Implementation model**: **Agent task**. A constraint inference agent is spawned periodically (or at phase boundaries) with access to override patterns, coherence history, and the current brief. The agent can form and test hypotheses — e.g., "I see overrides clustering in ws-backend for code artifacts, let me check if there's a pattern in which tools are involved" — rather than just pattern-matching on pre-aggregated data.

**Triggers**:
- Recurring coherence issues between the same workstream pair → suggest coordination constraint
- Repeated overrides for a specific tool/artifact kind → suggest escalation rule
- Repeated rework on artifacts from one workstream → suggest review requirement

**Mechanism**:
- Agent task spawned at phase boundaries (or every N ticks) to explore override patterns (3C-1) and coherence history
- Agent generates `ConstraintSuggestion` proposals surfaced in Brief Editor as "Suggested constraints"
- Human approves/dismisses suggestions — dismissals are tracked as feedback for future suggestions

**Key design choice**: The system **suggests**, never auto-applies. Constraints always require human approval.

**Depends on**: 3C-1 (override patterns), coherence event history, agent infrastructure

---

### 3C-6: Control Mode ROI Measurement

**What**: Measure the effectiveness of each control mode and mode transitions.

**Implementation model**: **Computational + agent task hybrid**. The signal computation (aggregation, rates, latencies) is straightforward arithmetic over logged data — no LLM needed. However, the *interpretation* ("orchestrator mode caught more issues but the latency cost wasn't worth it for this project type") and *recommendation* generation benefits from an agent that can cross-reference the numbers with project context.

**Signals to compute** (server-side aggregation):
- Decision queue latency by mode (time from decision created to resolved)
- Override rate by mode
- Coherence issue rate by mode
- Task completion rate by mode
- Cost per mode (LLM calls, injection frequency, human review time)

**Output**:
- `ControlModeROI` report comparing modes across the project's history
- "Orchestrator mode caught 12 more issues but added 45min of decision queue latency"
- Inform the mode recommendation algorithm: currently heuristic, could become data-driven

**Depends on**: Sufficient data across multiple mode transitions within a project

---

### 3C-7: Rework Causal Linking

**What**: When an artifact is updated multiple times, correlate the rework with upstream causes.

**Implementation model**: **Agent task**. Causal linking requires following chains across multiple data sources (coherence events, overrides, dependency graph, artifact update history). An agent can trace "artifact A was updated at tick 50 → was there a coherence issue involving A before tick 50? → yes, at tick 47, triggered by a dependency change in artifact B at tick 45" more effectively than a single LLM call with a data dump.

**Causal chain identification**:
- Artifact updated after coherence issue detected → coherence-driven rework
- Artifact updated after human override → override-driven rework
- Artifact updated after another artifact in a dependency chain changed → cascade rework
- Artifact updated with no identifiable trigger → voluntary improvement

**Output**:
- `ReworkCausalReport` per artifact with identified cause chain
- Aggregate: "35% of rework is coherence-driven, 25% is override-driven, 40% is cascade"
- Surface in Map workspace as rework annotations on artifact nodes

**Depends on**: Coherence event history, override patterns (3C-1), dependency tracking (Layer 0), agent infrastructure

---

## Tier 3: Hardening & Scale

These are already specified in the design doc (`AGENT-PLUGIN-DESIGN.md`) but not yet formalized as deliverables.

### 3C-8: False Positive Auto-Tuning

**What**: Layer 2 confirmation/dismissal results feed back into Layer 1 threshold adjustment.

**Already specified** in `AGENT-PLUGIN-DESIGN.md` (lines 2759-2834):
- Track Layer 2 confirmation rate per 24-hour window
- If >50% false positives → increase `layer1PromotionThreshold` by 0.02
- If <10% false positives → decrease by 0.01
- Clamp to [0.75, 0.95], require ≥20 reviews before adjusting
- `CoherenceFeedbackLoopConfig` interface already typed

**Remaining work**: Implement the `enabled: true` code path, persist threshold history, add frontend display of current threshold + adjustment history.

**Depends on**: 3A-3 (real Layer 2 reviews), sufficient review volume (≥20 per window)

---

### 3C-9: Trust Hardening

**What**: Address the two known anti-gaming weaknesses documented in the design doc.

**9a: Decay ceiling** (design doc line 1946):
- Add `decayCeiling` config parameter (default: 50)
- Inactive agents decay toward baseline but never above `decayCeiling`
- For strict projects, set `decayCeiling: 30` so idle agents stay low-trust

**9b: Risk-weighted deltas** (design doc line 1957):
- Add `effectiveDelta = baseDelta * riskWeight(toolCategory)`
- `riskWeight` derived from `EscalationPredicate.blastRadius`: local=0.5, workstream=1.0, cross-workstream=1.5, project=2.0
- Prevents trust-farming through trivial approvals

**Depends on**: 3A-8c (domain-tagged outcomes provide the tool category data)

---

### 3C-10: Trust Calibration Profiles

**What**: Pre-built calibration profiles for different project risk levels.

**Profiles** (from design doc line 3331):
- **Conservative**: Slower trust gain (+1 max), faster trust loss (-4 for override), lower decay ceiling (30)
- **Balanced**: Current defaults
- **Permissive**: Faster trust gain (+4 for clean completion), slower trust loss (-1 for override), higher autonomy thresholds

**Also includes**: Per-project profile storage and a UI selector in Controls workspace.

**Depends on**: 3C-9 (decay ceiling, risk-weighted deltas as building blocks)

---

## Deferred Beyond 3C

| Item | Rationale |
|---|---|
| **Cross-project pattern extraction** | Requires multiple completed projects with sufficient data. Single-project learning (3C-1 through 3C-7) must mature first. |
| **Agent self-proposals** | In ecosystem mode, agents propose their own task breakdown. Requires high trust + domain-specific trust (3C-3) to be meaningful. |
| **Adaptive brief evolution** | System auto-updates brief fields based on learnings. High risk — constraint inference (3C-5) with human approval is the safe precursor. |
| **ANN index** | O(log n) similarity lookup. Only needed when artifact count exceeds brute-force feasibility (~500+). |
| **Kind-aware chunking** | Tree-sitter parsing for function-level embedding. Only needed for code-heavy projects at scale. |

---

## Dependency Graph

```
                    ┌─────────────────────────────┐
                    │  3A-8 (Feedback Recording)   │
                    └──────┬──────┬──────┬─────────┘
                           │      │      │
              ┌────────────┘      │      └────────────┐
              v                   v                   v
    3C-1 (Override         3C-2 (Injection      3C-3 (Domain
     Patterns)              Optimization)        Trust)
              │                   │                   │
              └─────────┬─────────┘                   │
                        v                             │
              3C-5 (Constraint                        │
               Inference)                             │
                        │                             │
              3C-4 (Phase ←───────────────────────────┘
            Retrospectives)
                        │
              3C-6 (Control
              Mode ROI)
                        │
              3C-7 (Rework
            Causal Linking)

    ─── Hardening track (parallel) ───

    3A-3 (Layer 2 reviews)
              │
              v
    3C-8 (FP Auto-Tuning)

    3A-8c (Domain outcomes)
              │
              v
    3C-9 (Trust Hardening)
              │
              v
    3C-10 (Calibration Profiles)
```

### Recommended Build Order

**Wave 1 (as soon as 3A data is available):**
- 3C-1: Override pattern analysis — quick win, most actionable
- 3C-8: False positive auto-tuning — already spec'd, config interface typed
- 3C-9: Trust hardening — small, well-defined scope

**Wave 2 (depends on Wave 1):**
- 3C-2: Injection optimization — needs injection record volume
- 3C-3: Domain-specific trust — needs domain outcome volume
- 3C-10: Calibration profiles — builds on 3C-9

**Wave 3 (depends on Wave 2):**
- 3C-4: Phase retrospectives — richer with 3C-1/3C-2/3C-3 data
- 3C-5: Constraint inference — needs override pattern + coherence history
- 3C-6: Control mode ROI — needs data across mode transitions

**Wave 4 (depends on Wave 3):**
- 3C-7: Rework causal linking — needs all upstream analysis for full causal chains

---

## Design Decisions (Resolved)

1. **Agent tasks vs. bare LLM calls**: Tier 2 analytical tasks (3C-4, 3C-5, 3C-6 interpretation, 3C-7) are agent tasks, not server-side LLM calls. The system should eat its own cooking — exploratory analysis benefits from the same tools-and-context pattern that external agents use. Tier 1 (closed-loop analysis) and Tier 3 (hardening) remain server-side computation or config changes. The existing coherence pipeline (Layer 2 review, Layer 1c sweep) stays as bare LLM calls — those are focused comparison tasks where the server already has all context assembled.

2. **No shared LlmClient abstraction**: Since Tier 2 tasks are agent tasks (not direct LLM calls), the only consumers of the `LlmReviewService` remain Layer 2 and Layer 1c. An `LlmClient` interface was considered and rejected as premature — the current raw-fetch implementation with internal provider branching is adequate for two call sites doing one thing. Revisit if direct LLM call sites proliferate.

## Open Questions

1. **Data retention**: How long do we keep feedback records? Unbounded growth vs. rolling windows vs. archive-and-summarize?
2. **Multi-project**: Should 3C stay single-project scoped, or should we design the data model to support cross-project queries from the start?
3. **Agent task cost model**: Tier 2 tasks are agent tasks, which are more expensive than bare LLM calls but produce richer analysis. Should retrospective agents have a token/turn budget? Should they be spawned automatically at phase boundaries or require human trigger?
4. **Constraint inference confidence**: What threshold of evidence should the system require before suggesting a constraint? Too eager = noise, too conservative = missed insights.
5. **Feedback on feedback**: When a human dismisses a constraint suggestion (3C-5), should that train the suggestion model? Risk of the system learning "never suggest anything."

---

## References

- [Phase 3A Deliverables](./phase-3a-deliverables.md) — 3A-8 feedback instrumentation (data source for 3C)
- [AGENT-PLUGIN-DESIGN.md](./AGENT-PLUGIN-DESIGN.md) — Trust hardening (line 1934), false positive feedback loop (line 2759), calibration profiles (line 3331)
- [Embedding Service Evaluation](./embedding-service-evaluation.md) — Threshold calibration context
- [LLM vs. Embedding Pre-Filter Research](./llm-vs-embedding-prefilter-research.md) — Hybrid pipeline validation
