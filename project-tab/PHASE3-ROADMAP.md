# Project Tab: Vision vs. Implementation Gap Analysis & Phase 3 Roadmap

*Generated 2026-02-14 from analysis of the design post, live UI review, and codebase exploration.*

## Vision Summary

The [design post](/posts/ai-project-management-design/) envisions the Project Tab as an **adaptive control system for human-agent teams** -- not a task tracker, but a sensemaking workspace where "the system shows humans what's happening and asks them what to do about it."

Grounded in 5 organizational theory frameworks (Mintzberg, Thompson, Galbraith, Simon, Weick), it describes two control philosophies:

- **Orchestrator** (mechanistic): Human reviews everything, all coordination flows through the human
- **Ecosystem** (organic): Agents self-organize with boundaries, human intervenes selectively

The ideal system supports **fluid movement along the spectrum** between them, with the system recommending where to be based on observed project dynamics.

### The 7-Point Ideal

1. Define intent at the project level
2. System decomposes into workstreams based on constraints
3. Agents execute, producing artifacts and making small decisions autonomously
4. System maintains real-time understanding of project state (coherence, not completion %)
5. Human attention directed precisely where it matters
6. Knowledge flows freely within projects, isolated between them
7. Every decision (human and agent) logged with context as institutional memory

---

## Current Implementation Scorecard

### Feature Coverage by Category

| Category | Features in Vision | Implemented | Partial | Missing |
|----------|-------------------|-------------|---------|---------|
| Coordination & Integration | 5 | 4 | 1 | 0 |
| Work Orchestration | 4 | 2 | 0 | 2 |
| Knowledge & Context | 5 | 2 | 1 | 2 |
| Governance & Control | 5 | 3 | 1 | 1 |
| Adaptive Control | 6 | 5 | 1 | 0 |
| Agent Coordination (Ecosystem) | 5 | 2 | 1 | 2 |
| Human Override | 4 | 3 | 1 | 0 |

### Workspace-by-Workspace Assessment

#### Briefing -- "What happened while I was away?"
- **Implemented**: Synthesized narratives, action summaries ("since last visit", "needs attention"), agent activity feed, emergency brake banner, recent activity timeline with severity dots
- **Gap**: Narratives are heuristic-generated via `buildBriefing()`, not LLM-generated. No temporal navigation (M9).

#### Queue -- "What needs my attention?"
- **Implemented**: Prioritized decision list, decision detail with severity/confidence/blast radius, provenance drawer, rationale gating on high-severity decisions, `tool_approval` decisions with tool args and agent reasoning (live mode)
- **Gap**: `tool_approval` not exercisable in mock mode. No filtering/sorting controls. No batch operations.

#### Map -- "Why is something off?"
- **Implemented**: Coherence tab with issues/workstreams, knowledge tab with artifacts by workstream, issue detail with suggested resolution, artifact detail with provenance
- **Gap**: No visual graph/relationship visualization (flat lists, not node-edge graph). No cross-workstream dependency lines. Backend coherence layers not exposed in UI.

#### Brief Editor -- "Here's what I want to happen."
- **Implemented**: Project description/goals display, constraint adding, checkpoint gate toggles, agent roster with trust scores
- **Gap**: Goals and description are read-only. Constraints can be added but not edited/removed. No agent lifecycle actions (spawn/kill/pause).

#### Controls -- "Here's how I want the system to operate."
- **Implemented**: Mode selector (orchestrator/adaptive/ecosystem), quality/throughput dial, control topology (4 dimensions with current/recommended), trust trajectories with sparklines, review pattern analysis with AI suggestions, decision log with reverse/flag actions, emergency brake, context injection
- **Gap**: Control shift recommendations are mock-only data. Sparklines have no hover detail.

### Architecture Alignment

| Vision Concept | Architecture Component | Status |
|---------------|----------------------|--------|
| Decision Queue | `DecisionQueue` + Queue workspace | **Full** |
| Trust Calibration | `TrustEngine` (11 outcomes, decay, calibration) | **Full** |
| Coherence Detection | `CoherenceMonitor` (3 layers) | Layer 0 real, **1+2 mock** |
| Knowledge Store | `KnowledgeStore` (SQLite, 11 tables, audit log) | **Full** |
| Context Injection | `ContextInjectionService` (periodic/reactive/staleness) | Backend full, **adapter stub** |
| Adaptive Control | Control mode + topology + recommendations | **Full** |
| Emergency Brake | Brake API + WS broadcast + decision suspension | **Full** |
| Agent Lifecycle | Plugin system (Local/Container) + adapter shims | **Full** |
| Provenance | Event bus + artifact tracking + audit log | **Full** |
| Project Isolation | Per-agent sandbox dirs, JWT tokens, plugin boundaries | **Full** |
| Synthesized Status | `buildBriefing()` from state signals | **Heuristic** (not LLM) |

---

## Phase 3 Roadmap

### Phase 3A -- Close the Intelligence Loop
*Highest leverage. Makes the "computed, not curated" promise real.*

| # | Deliverable | Description | Key Files |
|---|------------|-------------|-----------|
| 3A-1 | Wire context injection through adapters | Both shims accept `/inject-context` but don't act ("Plumbing only in Phase 1"). Backend `ContextInjectionService` is fully built. Need to push context into running Claude/Codex sessions. | `adapter-shim/claude/src/app.ts:208`, `adapter-shim/openai/adapter_shim/app.py:149` |
| 3A-2 | Real embedding service | Replace `MockEmbeddingService` with OpenAI `text-embedding-3-small` (behind feature flag). Activates Layer 1 coherence detection. | `server/src/intelligence/embedding-service.ts`, `server/src/index.ts:83` |
| 3A-3 | Real coherence review service | Replace `MockCoherenceReviewService` with Claude API (behind feature flag). Activates Layer 2 deep coherence review. | `server/src/intelligence/coherence-review-service.ts`, `server/src/index.ts:84` |
| 3A-4 | LLM-generated briefing summaries | Add a periodic job that uses an LLM to produce comprehension summaries from event log + knowledge store snapshots, replacing the heuristic `buildBriefing()`. | `src/lib/narrative.ts`, new server route |
| 3A-5 | Artifact content provider | Wire `setArtifactContentProvider` to actually read file contents from agent sandboxes. Currently always returns `undefined`, preventing Layer 2 review. | `server/src/index.ts:88` |

### Phase 3B -- Visual & Interaction Polish
*Makes the UI match the vision's expressiveness.*

| # | Deliverable | Description | Key Files |
|---|------------|-------------|-----------|
| 3B-1 | Knowledge graph visualization | Replace flat artifact list with interactive node-edge graph (D3 force layout or dagre). Show workstream dependencies, artifact relationships, cross-cutting patterns. | `src/components/map/MapWorkspace.tsx` |
| 3B-2 | Brief editor CRUD | Make goals and description editable inline. Add remove/edit for constraints. Connect to `POST /api/project/seed` or new update endpoint. | `src/components/brief-editor/BriefEditorWorkspace.tsx` |
| 3B-3 | Tool approval mock scenario | Add `tool_approval` decisions to David's mock scenario so the feature is demo-able without a live backend. | `src/data/scenarios.ts` |
| 3B-4 | Temporal navigation (M9) | Scrub through ticks to see how project state evolved. Replay briefing, map, and queue at historical points. | New component, state history tracking |
| 3B-5 | Queue filtering & batch operations | Add filter by severity/type/agent/workstream. Batch approve for low-priority decisions. | `src/components/queue/QueueWorkspace.tsx` |

### Phase 3C -- Advanced Features
*Vision features that require new infrastructure.*

| # | Deliverable | Description | Org Theory Root |
|---|------------|-------------|-----------------|
| 3C-1 | Pattern library | Extract abstracted solution patterns from completed projects. Share across projects without leaking proprietary info. Sam's story. | Nelson & Winter's organizational routines |
| 3C-2 | Pipeline builder UI | Visual editor for workstream decomposition and dependency definition. Human adjustment of auto-generated seed. | Thompson's sequential interdependence |
| 3C-3 | Decision reversal cascade | When a human reverses a decision, propagate changes through dependent work. Currently UI-only with no cascade logic. | Simon's decision-making model |
| 3C-4 | Cost tracking | Resource/spend tracking per agent, per workstream, per project. | Resource dependency theory |
| 3C-5 | Handoff packages | Auto-generate project knowledge transfer documents from decision log + work history. Sam's story. | March & Simon's organizational memory |
| 3C-6 | Cross-project learning | Detect reusable patterns across projects while maintaining isolation boundaries. | Complex adaptive systems |
| 3C-7 | Agent work proposals | In ecosystem mode, agents propose their own task breakdown before executing. Human reviews and approves. | Adhocracy's mutual adjustment |

---

## Open Design Questions (from the post)

These remain unresolved and should inform Phase 3 design decisions:

1. **Trust calibration** -- How does the trust model vary by domain, task type, and agent track record? TrustEngine exists but calibration is manual.
2. **Attention economy of review** -- When agents produce faster than humans can review, how do you allocate review quality? Review Patterns in Controls is a start.
3. **Emergent behavior detection** -- How to reliably distinguish good emergence (Rosa's cross-pathway discovery) from bad (David's duplicate dependencies)?
4. **Building trust in Ecosystem mode** -- Agent initiative produces both wins and misses. Graduated autonomy is the proposed pattern but needs real-world testing.

---

## Test Counts (as of 2026-02-14)

| Component | Tests | Status |
|-----------|-------|--------|
| Backend server | 1,019 | Passing |
| Claude adapter shim | 157 | Passing |
| OpenAI adapter shim | 61 | Passing |
| **Total** | **1,237** | **All passing** |
