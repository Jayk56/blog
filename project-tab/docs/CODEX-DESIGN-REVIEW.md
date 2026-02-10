# Codex Design Review — AGENT-PLUGIN-DESIGN.md

## Review 1 (Pre-hardening)

*Reviewed 2026-02-09 by OpenAI Codex (gpt-5.3-codex) in read-only mode.*
*Input: AGENT-PLUGIN-DESIGN.md (3062 lines) + 3 SDK research summaries (509 lines).*

---

### Verdict: Buildable with specific fixes needed

The architecture is sound and the plugin abstraction is well-placed. Phase 0 and Phase 1 are buildable from this spec with scope discipline. The issues below should be addressed before or during implementation.

---

### Critical (2)

#### 1. Event identity/sequence model is internally inconsistent

`EventEnvelope` is created by backend ingestion (lines 370, 372), but replay and dedup depend on stable `sequence` and `eventId` across reconnects (lines 714, 728, 1637). If the backend re-stamps events, replayed duplicates get new IDs and sequence gaps are undetectable or misdetected.

**Fix:** Adapters should generate immutable `sourceEventId`, `sourceSequence`, `sourceOccurredAt`. The backend adds `ingestedAt` only. This preserves identity across transport/replay.

#### 2. Phase plan contradicts itself on trust engine timing

Phase 3 says "Implement trust engine" (line 2923), but Phase 0/1 acceptance criteria already require trust deltas and trust updates (lines 2849, 2892, 2896). This will create planning and test confusion.

**Fix:** Explicitly make a minimal trust engine Phase 0 work (delta application, [10,100] clamping, decay). Reserve "advanced trust" (calibration profiles, simulation framework) for Phase 3.

---

### High (5)

#### 3. Control-mode changes are not actually immediate for major SDKs

Mode switch pushes `updateBrief()` (line 2072), but for OpenAI/Claude hot brief updates are unsupported (lines 1509, 2074). Policy changes remain latent until agent restart, which is risky for Controls UX and safety expectations.

#### 4. Tick-based semantics are core but clock/tick source is undefined

`tick`, `dueByTick`, decay ticks, periodic scan ticks all drive behavior (lines 402, 1792, 1947, 2596) but no authoritative tick service definition appears. Need: clock source, increment rules, relationship to wall-clock time.

#### 5. Gemini SDK mapping is provisional

Gemini research explicitly says post-mid-2025 updates may be missing (gemini-adk.md:3), yet the capability matrix makes concrete method claims (lines 1515, 1522). Treat Gemini adapter details as provisional until re-verified with current ADK documentation.

#### 6. Artifact URI translation responsibility is contradictory

One section says backend rewrites URI after upload (line 1264), but the next says adapter translates before forwarding and backend never sees sandbox paths (lines 1269, 1271). Pick one owner (recommend: backend) and make the contract explicit.

#### 7. Backpressure is acknowledged but deferred too late

High event volume risk is an open question (line 3024), and hardening is Phase 4 (line 2950), but heavy `tool_call` streams are already part of Phase 1 acceptance (line 2887). Add basic bounded queue/backpressure policy in Phase 1, not Phase 4.

---

### Medium (5)

#### 8. Plugin abstraction has underspecified fields

`historyPolicy: 'recent_n'` has no `n` parameter (line 208). `allowedTools` as freeform strings (line 184) weakens cross-SDK policy consistency (already noted in inference caveat at line 323).

#### 9. Trust model is gameable/coarse

Inactivity raises low-trust agents toward 50 (line 1793), and `alwaysApprove` gives a large +3 delta (line 1804) without normalization by action risk or sample size. Long-term autonomy needs risk-weighting and anti-gaming controls.

#### 10. Coherence Layer 1 practicality is optimistic

Pairwise scans and full-content embedding assumptions (lines 2463, 2480) may degrade quickly with larger artifact sets or large code/doc files. Need chunking/indexing strategy and stronger cost/performance guardrails.

#### 11. Acceptance criteria include partially untestable items

Latency p95 target references Phase 3 observability (line 1668) but appears in Phase 1 acceptance language (line 2896). Ensure each phase's criteria are testable with that phase's infrastructure.

#### 12. MockPlugin all-capabilities-true hides degradation paths

Phase 0 sets all capabilities true (line 2672), so unsupported-path behavior (pause/kill/hot-update degradation) isn't exercised before Phase 1. Run MockPlugin in mixed capability modes to test degrade paths early.

---

### Phase 0 Recommendations

If building tomorrow:

1. **Define `SourceEvent`** with immutable `sourceEventId`, `sourceSequence`, `sourceOccurredAt` from the adapter; backend adds `ingestedAt` only
2. **Freeze minimal event set** for Phase 0: `status`, `decision`, `artifact`, `completion`, `error`
3. **Build minimal trust engine in Phase 0** (delta application, clamping, decay) — reserve advanced calibration for Phase 3
4. **Add a tick service spec** — clock source, increment rules, relationship to wall-clock time
5. **Run MockPlugin in mixed capability modes** (not all-true) to test degradation paths early
6. **Choose one URI rewrite owner** (prefer backend) and make the adapter contract explicit
7. **Add basic backpressure** (bounded queue, drop policy) in Phase 1, not Phase 4

---

### Answers to Review Focus Areas

1. **Plugin abstraction correctness/completeness:** Strong foundation, but incomplete on event identity semantics, tick model, and a few underspecified fields (`recent_n`, tool canonicalization).

2. **SDK adapter mapping accuracy:** Mostly aligned with research for Claude/OpenAI, but Gemini mapping should be tagged provisional given stale-source warning.

3. **Architecture soundness (dispatcher + sandbox + RPC):** Direction is sound and implementation-feasible; biggest architectural fix needed is event metadata ownership (source IDs/sequences must survive transport/replay).

4. **Phase 0/1 buildability + testability:** Buildable with scope discipline, but acceptance criteria currently mix later-phase concerns and have contradictions (trust timing, observability assumptions).

5. **Biggest implementation risks/gaps:** Event correctness model, control-mode immediacy gap, undefined tick semantics, deferred backpressure, and URI translation ambiguity.

6. **Trust system quality:** Good starting heuristic, calibratable, but too coarse for long-term autonomy without risk-weighting and anti-gaming controls.

7. **Coherence 3-layer practicality:** Layer 0 is practical now; Layer 1/2 are reasonable later, but need chunking/indexing strategy and stronger cost/perf guardrails.

8. **Over-engineering:** Replay/token-renewal/checkpoint granularity and some policy surfaces are heavy for early phases; simplify Phase 0/1 aggressively.

9. **Event pipeline concerns:** Main concern is correctness under reconnect/replay; secondary concerns are versioning/schema evolution and backpressure handling.

10. **What to change for Phase 0:** See recommendations above.

---
---

## Review 2 (Post-hardening)

*Reviewed 2026-02-10 by OpenAI Codex (gpt-5.3-codex) in read-only mode.*
*Input: AGENT-PLUGIN-DESIGN.md (3330 lines) + 3 SDK research summaries (509 lines) + Review 1 findings.*

---

### Verdict: NO-SHIP — 4 blocking issues remain

Strong overall improvement. The architecture is sound and most prior issues are resolved. Current blockers are spec-level consistency issues, not foundational architecture flaws. Fix the 4 items below and this is ready to build.

---

### New Findings (4 blocking, 5 non-blocking)

#### 1. Critical — Blocks Phase 0/1: Event identity contract still inconsistent at transport boundaries

`EventEnvelope` says source identity is adapter-generated (`sourceEventId`, `sourceSequence`, `sourceOccurredAt`, `runId`) (lines 375, 388). But `InProcessTransport.eventSink` is typed as raw `AgentEvent` (line 668), and the shim contract says "Push `AgentEvent` objects over WebSocket" (line 841).

This leaves unclear where source identity is actually carried on the wire in Phase 0/1. The conceptual fix from Review 1 Issue #1 is correct, but the transport contract doesn't reflect it.

**Fix:** Either (a) change `eventSink` to accept `EventEnvelope` (adapter builds the full envelope), or (b) define an intermediate `AdapterEvent` type that carries source identity fields alongside the `AgentEvent` payload, with the backend adding `ingestedAt` to produce the final `EventEnvelope`.

#### 2. Critical — Blocks Phase 0/1: Tick ownership undefined for agent-emitted fields

`TickService` is explicitly backend-authoritative (line 1819), but `StatusEvent.tick` is a required field (line 421) and `DecisionEvent.dueByTick` is required (lines 441, 459). The spec never says who computes these values.

For remote adapters, this can't be correct unless the backend stamps them after ingestion. As written, timeout behavior can diverge across adapters.

**Fix:** Either (a) make `tick` and `dueByTick` optional on the agent-emitted event and have the backend stamp them from `TickService.currentTick()`, or (b) explicitly state that these are backend-stamped fields (like `ingestedAt`) and not part of the adapter's emitted payload.

#### 3. High — Blocks Phase 0/1: Decision-timeout phase placement contradictory

The doc defines timeout behavior as a core policy (line 2074) and Phase 0 acceptance references timeout timing (line 3110) and failure injection cites timeout-policy testing (line 2971). But Phase 3 says "Implement decision timeout policy" (line 3191).

This reintroduces the same pattern as the trust-timing contradiction from Review 1 Issue #2.

**Fix:** Same approach as trust: split into "minimal timeout policy" (Phase 0: `auto_recommend` on expiry, configurable `timeoutTicks`) and "advanced timeout policy" (Phase 3: `escalate`, `extend`, `maxExtensions`).

#### 4. High — Blocks Phase 0/1: `ErrorEvent` schema conflicts with backpressure acceptance criteria

`ErrorEvent` has no `severity` field (line 515), but Phase 1 acceptance requires emitting `ErrorEvent` with `severity: 'warning'` for backpressure drops (lines 3138, 3163). The `Severity` enum also excludes `'warning'` (line 584).

**Fix:** Either (a) add `severity` field to `ErrorEvent` and add `'warning'` to the `Severity` enum, or (b) change the backpressure notification to use `StatusEvent` with a `backpressure` category instead.

---

### Non-blocking findings

#### 5. High — Does not block Phase 0/1: Control-mode mitigation is overstated

The doc correctly acknowledges no hot brief updates (lines 2209, 2224), then claims stricter backend rules apply immediately (line 2238). That only applies to decisions that are actually emitted. Actions that never escalate under old callback setup can still execute until restart. Prior Issue #3 is improved but not fully resolved for safety semantics.

#### 6. High — Does not block Phase 0/1: Gemini adapter mapping still not tagged provisional

Research says Gemini ADK info may be missing post-mid-2025 updates (gemini-adk.md:3), but mapping tables use concrete claims (lines 1530, 1541, 1623) without provisional labeling. Prior Issue #5 remains unresolved as a documentation integrity risk (Phase 2+ impact only).

#### 7. Medium — Does not block Phase 0/1: `PluginCapabilities` booleans can't encode "partial"

Interface is boolean-only (line 619), while capability matrix relies on "Partial" behavior (lines 1533, 1534). This pushes critical behavior into prose and invites adapter divergence.

#### 8. Medium — Does not block Phase 0/1: Tool canonicalization remains weak

`allowedTools` is freeform (line 184), inference uses Claude-style canonical names (line 325), and control examples use lowercase generic names (line 2133). Prior Issue #8 partially fixed (`historyN` added), but cross-SDK tool policy normalization still lacks a formal enum/registry.

#### 9. Low — Does not block Phase 0/1: Endpoint naming inconsistency

Wire table uses `POST /api/artifacts` (line 715), Phase 1 task list says `POST /artifacts` (line 3127), acceptance returns to `/api/artifacts` (line 3152).

---

### Retest of Prior 12 Issues

| # | Issue | Status |
|---|---|---|
| 1 | Event identity/sequence model | **Partially resolved** — concept fixed, transport contract still inconsistent |
| 2 | Trust engine phase timing | **Resolved** |
| 3 | Control-mode immediacy gap | **Partially resolved** — better disclosure/mitigation, not fully immediate |
| 4 | Undefined tick source | **Mostly resolved** — TickService defined, but ownership gap for `tick`/`dueByTick` stamping |
| 5 | Gemini mapping provisional | **Not resolved** — still presented as definitive (Phase 2+ impact only) |
| 6 | Artifact URI ownership | **Resolved** — adapter shim is single owner |
| 7 | Backpressure deferred | **Resolved** — Phase 1 bounded queue |
| 8 | Underspecified plugin fields | **Partially resolved** — `historyN` fixed, tool normalization still loose |
| 9 | Trust model gameable | **Partially resolved** — documented + deferred mitigations |
| 10 | Coherence Layer 1 optimistic | **Resolved** — scan limits/guards added |
| 11 | Untestable acceptance criteria | **Mostly resolved** — p95 moved to Phase 3 |
| 12 | MockPlugin all-true | **Resolved** — mixed capability profiles required |

---

### Phase 0/1 Buildability Assessment

- Strong overall improvement and much more implementable than pre-hardening version
- Current blockers are spec-level consistency issues, not foundational architecture flaws
- Trust system coherence (Phase 0 minimal vs Phase 3 advanced) is now internally sensible
- Biggest simplification needed: tighten transport contracts so implementation teams don't guess

### Phase 0 Recommendations (updated)

1. ~~Resolve `eventSink` / wire contract to carry source identity fields~~ **DONE** — `AdapterEvent` type added
2. ~~Declare backend as tick/dueByTick stamp owner (or make fields optional on emitted events)~~ **DONE** — fields optional, backend stamps
3. ~~Split decision timeout policy into Phase 0 minimal + Phase 3 advanced~~ **DONE** — `auto_recommend` in Phase 0, `escalate`/`extend`/`maxExtensions` in Phase 3
4. ~~Add `severity` to `ErrorEvent` (or change backpressure notification type)~~ **DONE** — `severity: Severity` added, `'warning'` in enum
5. ~~Tag Gemini mapping rows as provisional in the capability matrix~~ **DONE** — provisional note added
6. ~~Normalize endpoint naming (`/api/artifacts` everywhere)~~ **DONE**

---
---

## Review 3 (Post-Codex fixes)

*Reviewed 2026-02-10 by OpenAI Codex (gpt-5.3-codex) in read-only mode.*
*Input: AGENT-PLUGIN-DESIGN.md (3335 lines) + Review 1 & 2 findings.*

---

### Verdict: NO-SHIP — 1 blocking issue remained

3 of 4 Review 2 blockers were resolved. One remained:

#### High (blocking): Decision-timeout phase placement still internally inconsistent

Phase 0 deliverables said minimal timeout is `auto_recommend + timeoutTicks` only, but:
- Failure injection text expected testing `escalate` and `cancel` (line 2987)
- Default Adaptive mode policy set timeout action to `escalate` (line 2124)

**Status: RESOLVED (manual fix applied)**
- Failure injection now says `auto_recommend` is Phase 0; `escalate`/`cancel` are Phase 3
- Adaptive mode default changed to `auto_recommend` for Phase 0/1; `escalate` noted as Phase 3
- Tick dual-authority constrained to mock/manual mode; production adapters SHOULD omit tick fields
- Residual `AgentEvent` prose in architecture diagram and design principles updated to `AdapterEvent`

### All Review 2 blockers: final status

| # | Issue | Status |
|---|---|---|
| 1 | AdapterEvent transport contract | **RESOLVED** |
| 2 | Tick/dueByTick ownership | **RESOLVED** |
| 3 | Decision-timeout phase placement | **RESOLVED** |
| 4 | ErrorEvent severity schema | **RESOLVED** |

**The design doc is now ready for Phase 0/1 implementation.**
