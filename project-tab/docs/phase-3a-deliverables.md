# Phase 3A Deliverables: Real Model Integration + Coherence Pipeline Hardening

*Updated 2026-02-18. Incorporates findings from [embedding-service-evaluation.md](./embedding-service-evaluation.md) and [llm-vs-embedding-prefilter-research.md](./llm-vs-embedding-prefilter-research.md).*

### Implementation Status

| Deliverable | Status | Notes |
|---|---|---|
| 3A-2 VoyageEmbeddingService | **Complete** | All spec requirements met, 4 unit tests |
| 3A-3 LlmReviewService | **Complete** | Uses raw `fetch` instead of `@anthropic-ai/sdk` (see deviation note below) |
| 3A-4 Content Hash (Layer 1b) | **Complete** | 3 unit tests in `coherence-layers.test.ts` |
| 3A-5 Content Provider | **Complete** | Wired in `index.ts` with Gap 2 fallback |
| 3A-6 Layer 1c Sweep | **Complete** | 4 unit tests in `coherence-layers.test.ts` (not `coherence-monitor.test.ts`) |
| 3A-7 Experiment Harness | **Not started** | No `test/experiments/` directory yet |
| 3A-8 Feedback Instrumentation | **Complete** | All 3 sub-parts implemented, tests in `trust-engine.test.ts`, `context-injection-service.test.ts`, and `wiring.test.ts` |

**Spec deviations**:
- **3A-3**: Spec calls for `@anthropic-ai/sdk` and `openai` packages. Implementation uses raw `fetch()` with internal provider branching (`fetchAnthropic`/`fetchOpenAi` methods). Works correctly and is easier to test (mock `fetch` vs mock SDK), but doesn't match the stated dependency. Decision: keep as-is — the `CoherenceReviewService` interface boundary means the internal HTTP approach can be swapped later if needed, and the only consumers (Layer 2 review + Layer 1c sweep) use a narrow API surface.
- **3A-6**: Tests live in `coherence-layers.test.ts` alongside other layer tests, not in `coherence-monitor.test.ts` as spec states.
- **3A-8a**: Decision outcome recording tests live in `wiring.test.ts` (integration-style), not a dedicated `decisions.test.ts`.

---

## Overview

Phase 3A replaces mock implementations with real models in the CoherenceMonitor's three-layer pipeline, adds two new detection paths identified by the research as necessary for production-quality coherence monitoring, and builds an evaluation harness to validate thresholds empirically.

**Prerequisites**: Phase 1+2 closeout gaps should be resolved first (particularly Gap 2: Artifact Upload Flow, which provides artifact content for Layer 2). The coherence pipeline can be developed and tested independently using the existing mock adapter shim's artifact events.

**Architecture after Phase 3A**:

```
Layer 0 (structural — already complete)
  ├ File conflict detection
  ├ Decision conflict on shared artifacts
  ├ Dependency violation
  └ Duplicate artifact (contentHash exact match)

Layer 1a (embedding similarity — 3A-2)
  └ Cross-workstream cosine similarity via VoyageEmbeddingService
     ├ ≥0.85 → promote to Layer 2
     └ 0.70–0.85 → advisory issue

Layer 1b (content hash cross-comparison — 3A-4)  [NEW]
  └ Cross-workstream contentHash match (catches exact function copies)
     └ Match → promote to Layer 2

Layer 1c (periodic LLM sweep — 3A-6)  [NEW]
  └ Full-corpus LLM review when total artifact tokens <200K
     └ Issues emitted directly (no Layer 2 confirmation needed)

Layer 2 (LLM deep review — 3A-3)
  └ Candidates from Layer 1a/1b reviewed by LLM
     ├ Confirmed → CoherenceEvent emitted
     └ Dismissed → recorded as false positive

Artifact content provider (3A-5)
  └ Wires GET /api/artifacts/:id/content into Layer 2 context assembly
```

---

## Deliverable 3A-2: VoyageEmbeddingService

**What**: Real implementation of the `EmbeddingService` interface using Voyage AI's embedding API.

**Why**: Replace `MockEmbeddingService` (deterministic hash vectors, no semantic similarity) with real embeddings for Layer 1a cross-workstream comparison.

### Model Selection

**Primary: `voyage-4-lite`** ($0.02/1M tokens, 32K context, 2048 native dims)

| Criterion | Assessment |
|---|---|
| Context window | 32K — covers 100% of code files AND long-form documents (research reports, design specs) without chunking |
| Quality | Outperforms OpenAI `text-embedding-3-large` on retrieval benchmarks at 1/6.5x cost |
| Matryoshka | Truncate to 512 dims for 4x storage savings with minimal quality loss |
| Price | Same as OpenAI `text-embedding-3-small` ($0.02/1M tokens) |
| Rate limit | 16M TPM / 2,000 RPM — can embed the full mock corpus (~50K tokens) 320x per minute |
| Batch API | Supported |

**Configurable alternative: `voyage-code-3`** ($0.06/1M tokens, 32K context)
- Optimized for code retrieval tasks
- Worth using for code-heavy projects (David scenario)
- Rate limit: 3M TPM / 2,000 RPM
- Selected via `CoherenceMonitorConfig.embeddingModel`

### Spec

```typescript
// server/src/intelligence/voyage-embedding-service.ts

export interface VoyageEmbeddingConfig {
  apiKey: string                    // VOYAGE_API_KEY env var
  model: 'voyage-4-lite' | 'voyage-code-3' | 'voyage-4'  // default: 'voyage-4-lite'
  outputDimension: number           // default: 512 (Matryoshka truncation)
  maxBatchSize: number              // default: 128 (Voyage batch limit)
  maxRetries: number                // default: 3
  retryBaseMs: number               // default: 1000
}

export class VoyageEmbeddingService implements EmbeddingService {
  constructor(config: VoyageEmbeddingConfig)

  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
}
```

### Implementation Details

- **API endpoint**: `POST https://api.voyageai.com/v1/embeddings`
- **Request body**: `{ input: string[], model: string, output_dimension?: number, input_type: "document" }`
- **Batch chunking**: If `texts.length > maxBatchSize`, split into sub-batches and call sequentially
- **Rate limiting**: Track TPM usage; if approaching 16M limit, delay with exponential backoff
- **Error handling**: Retry on 429 (rate limit) and 5xx with exponential backoff + jitter; throw on 4xx
- **Matryoshka truncation**: Set `output_dimension: 512` in the API request (server-side truncation, no client work needed)
- **Normalization**: Voyage returns L2-normalized vectors; no client normalization needed

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/intelligence/voyage-embedding-service.ts` | **New.** `VoyageEmbeddingService` class implementing `EmbeddingService` |
| `server/src/index.ts` | Wire `VoyageEmbeddingService` into `CoherenceMonitor` when `VOYAGE_API_KEY` env var is set; fall back to `MockEmbeddingService` when absent |
| `server/test/intelligence/voyage-embedding-service.test.ts` | **New.** Unit tests with mocked HTTP (no real API calls in CI). Test: batch chunking, retry logic, error handling, config validation |
| `server/.env.example` | Add `VOYAGE_API_KEY=` and `VOYAGE_EMBEDDING_MODEL=voyage-4-lite` |

### Definition of Done

- `VoyageEmbeddingService` passes all unit tests with mocked HTTP
- When `VOYAGE_API_KEY` is set, `CoherenceMonitor` uses real embeddings
- When `VOYAGE_API_KEY` is absent, falls back to `MockEmbeddingService` (existing behavior)
- Batch calls respect `maxBatchSize` (128) and split correctly
- Rate limit errors trigger retry with backoff
- `npx vitest run` passes, `npx tsc --noEmit` clean

---

## Deliverable 3A-3: Real CoherenceReviewService (Layer 2)

**What**: Real implementation of the `CoherenceReviewService` interface using an LLM for deep coherence review.

**Why**: Replace `MockCoherenceReviewService` (auto-confirms everything) with actual LLM judgment for Layer 2 candidate review.

### Model Selection

**Primary: Claude Sonnet** (`claude-sonnet-4-5-20250929`) via Anthropic API
- Good balance of quality and cost for structured analysis
- ~$0.01–0.02 per review (2K–5K input tokens + 200–500 output tokens)
- Structured JSON output via system prompt

**Alternative**: GPT-4o-mini ($0.15/1M input) for cost-sensitive deployments.

### Spec

```typescript
// server/src/intelligence/llm-review-service.ts

export interface LlmReviewConfig {
  provider: 'anthropic' | 'openai'  // default: 'anthropic'
  apiKey: string                    // ANTHROPIC_API_KEY or OPENAI_API_KEY
  model: string                     // default: 'claude-sonnet-4-5-20250929'
  maxTokens: number                 // default: 2048 (output)
  temperature: number               // default: 0 (deterministic)
}

export class LlmReviewService implements CoherenceReviewService {
  constructor(config: LlmReviewConfig)

  async review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]>
}
```

### Implementation Details

- **Prompt**: Reuse the existing `buildReviewPrompt()` from `coherence-review-service.ts` — it already produces a well-structured prompt with workstream context, artifact content, and JSON output instructions
- **Response parsing**: Parse JSON array from LLM response; validate against `CoherenceReviewResult` shape; fall back to "confirmed with explanation" if parsing fails
- **Anthropic SDK**: Use `@anthropic-ai/sdk` (`new Anthropic().messages.create()`)
- **OpenAI SDK**: Use `openai` package as alternative
- **Rate limiting**: Handled externally by `ReviewRateLimiter` (already implemented in `CoherenceMonitor`)
- **Error handling**: Retry on transient errors (429, 5xx); log and skip on parse failures

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/intelligence/llm-review-service.ts` | **New.** `LlmReviewService` implementing `CoherenceReviewService` |
| `server/src/index.ts` | Wire `LlmReviewService` into `CoherenceMonitor` when API key is set; set `enableLayer2: true` |
| `server/test/intelligence/llm-review-service.test.ts` | **New.** Unit tests with mocked LLM responses. Test: successful review, JSON parse failure fallback, retry on transient error, multi-candidate batching |
| `server/package.json` | Add `@anthropic-ai/sdk` dependency |
| `server/.env.example` | Add `ANTHROPIC_API_KEY=` and `COHERENCE_REVIEW_MODEL=` |

### Definition of Done

- `LlmReviewService` passes all unit tests with mocked LLM
- Reuses existing `buildReviewPrompt()` (no prompt duplication)
- JSON parse failures don't crash — fall back gracefully
- `enableLayer2` flag respected (false by default, true when API key present)
- `npx vitest run` passes, `npx tsc --noEmit` clean

---

## Deliverable 3A-4: Content Hash Cross-Comparison (Layer 1b)

**What**: Add a parallel detection path in `CoherenceMonitor.runLayer1Scan()` that compares `contentHash` values across workstreams.

**Why**: The embedding evaluation report (Section 4.3) shows that embedding dilution makes function-level duplication undetectable in files >200 tokens. Content hash comparison catches exact copies at zero embedding cost. The `content_hash` field already exists in the `ArtifactEvent` type and the knowledge store schema but is not used for cross-artifact comparison.

### Spec

During each Layer 1 scan cycle, after embedding comparison:

1. Build a `Map<contentHash, { artifactId, workstream, agentId }[]>` from all stored artifacts
2. Find hash collisions where artifacts belong to different workstreams
3. For each collision pair, create a `CoherenceCandidate` with `similarityScore: 1.0` and `promotedToLayer2: true`
4. Skip pairs where both artifacts have the same `agentId` (agent updating its own artifact)

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/intelligence/coherence-monitor.ts` | Add `contentHashIndex: Map<string, { artifactId, workstream, agentId }[]>` to Layer 1 state. Update `processArtifact()` to index content hashes. Add `runContentHashComparison()` private method called from `runLayer1Scan()`. New candidates emitted alongside embedding candidates. |
| `server/test/intelligence/coherence-monitor.test.ts` | Add tests: two artifacts in different workstreams with same contentHash → candidate promoted to Layer 2. Same workstream → no candidate. Same agent → no candidate. |

### Definition of Done

- Artifacts with identical `contentHash` in different workstreams produce `CoherenceCandidate` entries
- Candidates are promoted to Layer 2 (similarity 1.0)
- No false positives from same-workstream or same-agent matches
- Works alongside embedding comparison (both run in `runLayer1Scan()`)
- `npx vitest run` passes, `npx tsc --noEmit` clean

---

## Deliverable 3A-5: Artifact Content Provider Wiring

**What**: Wire the artifact content retrieval into Layer 2 context assembly so the LLM sees full artifact content during review.

**Why**: Layer 2 currently receives artifact content via a callback (`contentProvider`), but the content store (from Gap 2: Artifact Upload) isn't connected to the coherence monitor. This deliverable closes that loop.

### Current State

- `CoherenceMonitor.setArtifactContentProvider()` exists but is never called in `index.ts`
- `runLayer2Review()` already uses `contentProvider` to assemble `artifactContents` map
- Gap 2 (Artifact Upload) adds content storage to `POST /api/artifacts` and `GET /api/artifacts/:id/content`
- `KnowledgeStore` already stores artifact metadata including `contentHash` and `sizeBytes`

### Spec

In `server/src/index.ts`, after wiring the knowledge store:

```typescript
coherenceMonitor.setArtifactContentProvider((artifactId: string) => {
  return artifactContentStore.get(artifactId)  // from Gap 2's in-memory content store
})
```

If Gap 2 is not yet complete, provide a fallback that reads from the knowledge store's `uri` field (for `artifact://` URIs that map to stored content).

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/index.ts` | Call `coherenceMonitor.setArtifactContentProvider()` with a function that retrieves content from the artifact content store |
| `server/test/integration/phase1-acceptance.test.ts` | Verify Layer 2 review receives artifact content (not undefined) when reviewing promoted candidates |

### Definition of Done

- Layer 2 reviews include full artifact content in the prompt
- Content retrieval works for both uploaded artifacts (Gap 2) and mock artifacts
- `npx vitest run` passes

---

## Deliverable 3A-6: Periodic LLM Sweep (Layer 1c)

**What**: A new periodic detection path where the full artifact corpus is given to an LLM to find coherence issues that embeddings miss.

**Why**: The pre-filter research (Section 4.3) identifies a false negative gap: embedding dilution causes function-level duplication to be invisible to Layer 1a. Layer 1c catches these by having an LLM review the full corpus, but only when it's small enough to fit reliably in a context window. The NoLiMa research shows this is effective up to ~200K tokens with careful prompting.

### Spec

```typescript
// New config fields in CoherenceMonitorConfig
interface CoherenceMonitorConfig {
  // ... existing fields ...

  /** Whether Layer 1c (LLM sweep) is enabled (default: false). */
  enableLayer1c: boolean

  /** Minimum ticks between Layer 1c runs (default: 300 — ~5 minutes at 1 tick/sec). */
  layer1cScanIntervalTicks: number

  /** Max total artifact tokens for Layer 1c to run (default: 200000). */
  layer1cMaxCorpusTokens: number

  /** Model for Layer 1c sweep (default: same as layer2Model). */
  layer1cModel: string
}
```

### Implementation Details

- **Trigger**: Change-gated. Runs only when **both** conditions are met:
  1. At least `layer1cScanIntervalTicks` (default 300 — ~5 minutes) have elapsed since the last sweep
  2. New artifacts have been created or updated since the last sweep (tracked via a `layer1cDirty` flag set by `processArtifact()`)
  If no artifacts have changed, the sweep is skipped entirely regardless of elapsed ticks. This prevents idle projects from burning LLM costs.
- **Token gate**: Before running, estimate total artifact corpus tokens. If above `layer1cMaxCorpusTokens`, skip with advisory log.
- **Token estimation**: Use character count ÷ 4 as rough token estimate (same heuristic used in the evaluation doc)
- **Prompt**: Different from Layer 2 — this is a full-corpus review, not a candidate-pair review:
  ```
  You are a coherence monitor for a multi-agent project. Review ALL artifacts below
  and identify ANY cases of: duplication, contradiction, dependency violation, or
  configuration drift between artifacts in DIFFERENT workstreams.

  Focus especially on:
  - Functions or classes that appear in multiple files across workstreams
  - Contradictory assumptions or decisions
  - API contracts that don't match between consumer and producer

  [Grouped by workstream, with artifact content]
  ```
- **Output**: Issues emitted directly as `CoherenceEvent` (no Layer 2 confirmation — the LLM IS the review)
- **Dedup**: Before emitting, check against existing detected issues to avoid duplicates (match on artifact pair)
- **LLM service**: Reuse the same LLM client from 3A-3 (Anthropic SDK), but with a different prompt
- **Rate limiting**: Separate from Layer 2's `ReviewRateLimiter` — use a simple "last run tick" check

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/intelligence/coherence-monitor.ts` | Add Layer 1c state (`lastSweepTick`, `layer1cDirty` flag, config fields). Set `layer1cDirty = true` in `processArtifact()`. Add `runLayer1cSweep()` method. Call from `onTick()` when interval elapsed AND dirty flag set; clear flag after sweep. Add `buildLayer1cPrompt()` helper. |
| `server/src/intelligence/coherence-review-service.ts` | Add `LlmSweepService` interface (or reuse `CoherenceReviewService` with a different request shape). Consider a simpler `sweepCorpus(artifacts: { id, workstream, content }[]): Promise<CoherenceReviewResult[]>` interface. |
| `server/test/intelligence/coherence-monitor.test.ts` | Add tests: Layer 1c runs when interval elapsed AND dirty. Skips when not dirty (no changes). Skips when corpus too large. Clears dirty flag after sweep. Deduplicates against existing issues. Emits issues directly. |

### Definition of Done

- Layer 1c sweep runs every 50 ticks (configurable) when enabled
- Skips gracefully when corpus exceeds 200K estimated tokens
- Issues emitted as `CoherenceEvent` without Layer 2 confirmation
- Does not duplicate issues already detected by Layer 0/1a/1b/2
- Disabled by default (`enableLayer1c: false`)
- `npx vitest run` passes, `npx tsc --noEmit` clean

---

## Deliverable 3A-7: Evaluation Experiment Harness

**What**: Synthetic corpus and experiment framework for empirically validating embedding thresholds, dilution curves, and detection approaches.

**Why**: The research doc (Section 5) identifies 5 experiments needed to calibrate the coherence pipeline. Current thresholds (0.70 advisory, 0.85 promotion) are educated guesses. Running these experiments with real models provides empirical grounding. Total cost: ~$7.

### Spec

#### Synthetic Corpus (50 artifacts, 15 planted issues)

Per the research doc Section 5.7:

| Workstream | Artifacts | Focus |
|---|---|---|
| `ws-backend` | 12 | API server, data models |
| `ws-frontend` | 10 | UI components, state |
| `ws-infra` | 8 | Deployment, CI/CD |
| `ws-docs` | 10 | User docs, API docs |
| `ws-research` | 10 | Technical research |

15 planted coherence issues ranging from easy (near-identical files) to hard (buried function dupes, cross-kind mismatches, dependency violations). 35 clean distractor artifacts.

#### 5 Experiments

| # | Experiment | Measures | Est. Cost |
|---|---|---|---|
| 1 | Threshold sensitivity | Precision/recall at 9 thresholds [0.50–0.90] | $0.05 |
| 2 | Dilution curve | Similarity decay as file size grows around a target function | $0.02 |
| 3 | LLM full-context detection | LLM-only recall ceiling, variance, positional bias | $2.50 |
| 4 | Hybrid pipeline precision | Layer 1+2 vs LLM-only vs embedding-only | $1.05 |
| 5 | Positional bias | Detection rates by artifact position (start/mid/end) | $3.00 |

### Files to Create

| File | Description |
|---|---|
| `server/test/experiments/corpus/` | Directory of 50 synthetic artifact files |
| `server/test/experiments/corpus/ground-truth.json` | Maps pair keys to expected issues with categories |
| `server/test/experiments/corpus/manifest.json` | Lists all artifacts with metadata (kind, workstream, tokens) |
| `server/test/experiments/corpus/generate-corpus.ts` | Script to regenerate the corpus (deterministic) |
| `server/test/experiments/experiment-harness.ts` | Shared utilities: load corpus, score results, format output |
| `server/test/experiments/experiment-1-threshold.test.ts` | Threshold sensitivity sweep |
| `server/test/experiments/experiment-2-dilution.test.ts` | Dilution curve measurement |
| `server/test/experiments/experiment-3-llm-context.test.ts` | LLM full-context detection |
| `server/test/experiments/experiment-4-hybrid.test.ts` | Hybrid pipeline comparison |
| `server/test/experiments/experiment-5-positional.test.ts` | Positional bias measurement |

### Implementation Details

- All experiments are vitest test files but gated behind `VOYAGE_API_KEY` / `ANTHROPIC_API_KEY` env vars (skip in CI without keys)
- Use `describe.skipIf(!process.env.VOYAGE_API_KEY)` pattern
- Results written to `server/test/experiments/results/` as JSON for analysis
- The corpus generation script is deterministic (seeded random) so results are reproducible

### Definition of Done

- Synthetic corpus of 50 artifacts with 15 planted issues and manifest
- All 5 experiment test files runnable with real API keys
- Experiments skip gracefully without API keys (not fail)
- Results output as structured JSON
- `npx vitest run` passes (experiments skip without keys), `npx tsc --noEmit` clean

---

## Deliverable 3A-8: Feedback Instrumentation (Record Now, Analyze in 3C)

**What**: Lightweight recording infrastructure for three feedback signals that Phase 3C will analyze. No UI, no analysis — just structured data accumulation.

**Why**: Phase 3C introduces override pattern analysis, context injection optimization, and domain-specific trust. All three require historical data. If we don't start recording until 3C, we'll have no baseline to learn from. These are small additions to existing call sites.

### 3A-8a: Decision Override Context Recording

Currently `applyOutcome(agentId, outcome, tick)` records *what* happened but not *why* or *where*. The resolution call site in `routes/decisions.ts` has access to the full `DecisionEvent` (including `affectedArtifactIds`, `blastRadius`, `severity`, `toolName` for tool approvals) but discards this context after trust scoring.

**Record**: After each decision resolution, write a `TrustOutcomeRecord` to the `audit_log`:

```typescript
interface TrustOutcomeRecord {
  agentId: string
  outcome: TrustOutcome
  effectiveDelta: number
  newScore: number
  tick: number
  // Context from the DecisionEvent:
  decisionSubtype: 'option' | 'tool_approval'
  severity?: Severity
  blastRadius?: BlastRadius
  toolName?: string                  // tool_approval only
  affectedArtifactIds: string[]
  affectedWorkstreams: string[]      // derived from artifact lookups
  affectedArtifactKinds: string[]    // derived from artifact lookups
}
```

**Call site**: `routes/decisions.ts` after the `applyOutcome()` call (line ~50). Look up artifact metadata from `KnowledgeStore` to populate workstream/kind fields.

### 3A-8b: Context Injection Utility Tracking

Currently `scheduleInjection()` returns `true`/`false` for delivery success but doesn't track whether the agent acted on injected content. The simplest useful signal: count agent events in the N ticks after injection and tag them as "post-injection."

**Record**: Extend `AgentInjectionState` with:

```typescript
interface InjectionRecord {
  tick: number
  reason: 'periodic' | 'reactive' | 'staleness' | 'brief_updated'
  priority: ContextInjection['priority']
  snapshotVersion: number
  artifactIdsIncluded: string[]     // what was in the snapshot
  agentEventsInWindow: number       // filled in after windowTicks elapse
  artifactIdsReferencedInWindow: string[]  // artifacts the agent touched post-injection
}
```

**Mechanism**:
1. On successful injection, push an `InjectionRecord` with `agentEventsInWindow: 0` and `artifactIdsReferencedInWindow: []`
2. On each subsequent agent event (within `windowTicks`, default 20), increment the counter and collect referenced artifact IDs
3. After the window closes, write the completed record to `audit_log`

This doesn't analyze utility — it just records the correlation data. Phase 3C will compute overlap between `artifactIdsIncluded` and `artifactIdsReferencedInWindow` to measure injection relevance.

### 3A-8c: Domain-Tagged Trust Outcomes

Currently trust is global per agent. The `TrustEngine.applyOutcome()` method takes `(agentId, outcome, tick)` — no domain context. Adding an optional domain tag lets us accumulate per-domain data without changing the scoring algorithm.

**Record**: Add an optional `context` parameter to `applyOutcome()`:

```typescript
interface TrustOutcomeContext {
  artifactKinds?: ArtifactKind[]    // e.g., ['code', 'config']
  workstreams?: string[]            // e.g., ['ws-backend']
  toolCategory?: string             // e.g., 'write', 'read', 'execute'
}

// Updated signature (backward compatible — context is optional):
applyOutcome(agentId: string, outcome: TrustOutcome, currentTick?: number, context?: TrustOutcomeContext): number
```

The trust engine continues to apply a single global delta. But it also appends the context to a per-agent `domainOutcomes` log (in-memory array, flushed to `audit_log` periodically or on agent removal). Phase 3C will use this log to compute domain-specific scores.

### Files to Create/Modify

| File | Change |
|---|---|
| `server/src/intelligence/trust-engine.ts` | Add optional `TrustOutcomeContext` param to `applyOutcome()`. Accumulate `domainOutcomes` log. Add `flushDomainLog(agentId)` method. |
| `server/src/intelligence/context-injection-service.ts` | Add `InjectionRecord` tracking. Extend `AgentInjectionState` with `recentInjections: InjectionRecord[]`. Add post-injection event counting in `onEvent()`. Add `flushInjectionRecords(agentId)` to write completed records to audit log. |
| `server/src/routes/decisions.ts` | After `applyOutcome()`, build `TrustOutcomeRecord` from decision event context and write to `audit_log`. |
| `server/src/event-handlers.ts` | Pass `TrustOutcomeContext` to `applyOutcome()` calls in `handleCompletionTrustTracking` and `handleErrorTrustTracking`. |
| `server/test/intelligence/trust-engine.test.ts` | Test that `applyOutcome` with context still applies correct global delta. Test domain log accumulation and flush. |
| `server/test/intelligence/context-injection-service.test.ts` | Test injection record creation, window counting, and flush. |
| `server/test/routes/decisions.test.ts` | Test that resolution writes `TrustOutcomeRecord` to audit log with artifact context. |

### Definition of Done

- `applyOutcome()` accepts optional context — existing calls work unchanged
- Decision resolution writes `TrustOutcomeRecord` to audit log with workstream/kind/tool metadata
- Context injection records delivery + post-injection event correlation window
- Domain outcome log accumulates per agent and flushes on removal
- No new analysis, UI, or behavioral changes — recording only
- `npx vitest run` passes, `npx tsc --noEmit` clean

---

## Dependency Graph

```
3A-4 (Content Hash)     3A-2 (Voyage Embedding)     3A-7 (Experiment Harness)     3A-8 (Feedback Instrumentation)
     |                        |                            |                            |
     |                        |                     (needs 3A-2 for real runs)   (no dependencies)
     |                        |                            |                            |
     v                        v                            |                            |
3A-5 (Content Provider) ← needed by both →                 |                            |
     |                                                     |                            |
     v                                                     |                            |
3A-3 (LLM Review Service)                                  |                            |
     |                                                     |                            |
     v                                                     |                            |
3A-6 (LLM Sweep) ─────────────── uses LLM client from 3A-3                             |
                                                                                        |
     (3A-8 starts recording as soon as it lands — data accumulates throughout 3A/3B/3C) |
```

### Recommended Build Order

**Phase A (parallel, no dependencies):**
- **3A-2**: VoyageEmbeddingService (the foundation — everything else builds on real embeddings)
- **3A-4**: Content hash cross-comparison (small, self-contained addition to CoherenceMonitor)
- **3A-7 corpus**: Synthetic corpus generation (needed before experiments can run)
- **3A-8**: Feedback instrumentation (no dependencies — the earlier it lands, the more data 3C has)

**Phase B (depends on Phase A):**
- **3A-3**: LlmReviewService (needs 3A-2 conceptually for the full pipeline, but can be built in parallel)
- **3A-5**: Artifact content provider wiring (small, depends on understanding 3A-3's needs)
- **3A-7 experiments**: Run experiments 1-2 (embedding-only, need 3A-2)

**Phase C (depends on Phase B):**
- **3A-6**: Layer 1c LLM sweep (needs 3A-3's LLM client)
- **3A-7 experiments**: Run experiments 3-5 (need both 3A-2 and 3A-3)

---

## Environment Setup

### Required API Keys

| Variable | Service | Required For |
|---|---|---|
| `VOYAGE_API_KEY` | Voyage AI | 3A-2 (embeddings), 3A-7 experiments 1-2 |
| `ANTHROPIC_API_KEY` | Anthropic | 3A-3 (Layer 2 review), 3A-6 (Layer 1c sweep), 3A-7 experiments 3-5 |

### Rate Limits (Voyage AI Account)

| Model | TPM | RPM | Usage |
|---|---|---|---|
| `voyage-4-lite` | 16,000,000 | 2,000 | Primary embedding model |
| `voyage-code-3` | 3,000,000 | 2,000 | Code-specific alternative |
| `voyage-4` | 8,000,000 | 2,000 | Higher quality alternative (not recommended as primary due to 3x cost) |

### New Dependencies

| Package | Version | Deliverable |
|---|---|---|
| `@anthropic-ai/sdk` | latest | 3A-3, 3A-6 |

Note: No Voyage SDK needed — their API is a simple REST endpoint callable with `fetch`.

---

## Cost Projections

### Per-Scan Costs (Mock Scenario Scale: ~50K tokens, 23 artifacts)

| Layer | Cost per Scan | Monthly (100 scans) |
|---|---|---|
| Layer 1a (voyage-4-lite embedding) | $0.001 | $0.10 |
| Layer 1b (content hash) | $0 | $0 |
| Layer 1c (LLM sweep, change-gated, ~every 300 ticks) | $0.03 | $0.60* |
| Layer 2 (LLM review, ~5 candidates) | $0.01 | $1.00 |
| **Total** | **~$0.04** | **~$1.70** |

*Layer 1c monthly estimate assumes ~20 sweeps/month (change-gated — idle periods don't trigger sweeps).

### Experiment Costs (One-Time)

| Experiment | Cost |
|---|---|
| 1: Threshold sensitivity | ~$0.05 |
| 2: Dilution curve | ~$0.02 |
| 3: LLM full-context | ~$2.50 |
| 4: Hybrid pipeline | ~$1.05 |
| 5: Positional bias | ~$3.00 |
| **Total** | **~$6.62** |

---

## Deferred to Phase 3C

These items were evaluated in the research and determined to be premature for 3A:

| Item | Rationale for Deferral |
|---|---|
| **Kind-aware chunking** (code files >300 lines at function boundaries) | Requires language-aware parsing (tree-sitter). Whole-file embedding is sufficient for documents/research/decisions. Only code artifacts need chunking, and only at scale. |
| **ANN index** (hnswlib for O(log n) similarity lookup) | Brute-force cosine comparison is adequate for <500 artifacts. ANN adds complexity for marginal benefit at current scale. |
| **False positive auto-tuning** (Layer 2 feedback → Layer 1 threshold adjustment) | Needs real-world data volume (≥20 Layer 2 reviews per feedback window). Static thresholds are fine until we have production usage data. |
| **Gemini embedding model** | 2K token context window is disqualifying for whole-file embedding. Re-evaluate if Google extends the context window. |

---

## Verification Checklist

1. **Type check**: `cd server && npx tsc --noEmit` — 0 errors
2. **Tests**: `cd server && npx vitest run` — all pass
3. **Without API keys**: Server starts normally, falls back to mock services, all existing functionality works
4. **With Voyage key**: Layer 1a produces real embeddings, cross-workstream similarity scores are meaningful
5. **With Anthropic key**: Layer 2 reviews produce structured LLM judgments, Layer 1c sweeps find issues
6. **Content hash**: Identical artifacts across workstreams detected immediately
7. **Experiments**: All 5 experiments run to completion with real keys, results saved as JSON

---

## References

- [Embedding Service Evaluation](./embedding-service-evaluation.md) — Model comparison, dilution analysis, granularity recommendations
- [LLM vs. Embedding Pre-Filter Research](./llm-vs-embedding-prefilter-research.md) — Hybrid pipeline validation, Layer 1c justification, experiment designs
- [AGENT-PLUGIN-DESIGN.md](./AGENT-PLUGIN-DESIGN.md) — Coherence monitor design (Layer 0/1/2), CoherenceMonitorConfig, Phase 3 scope
- [Phase 1+2 Closeout Plan](./phase-closeout-plan.md) — Gap 2 (Artifact Upload) is a prerequisite for 3A-5
- [Frontend Integration Plan](./frontend-integration-plan.md) — State adapter and WS service for frontend coherence display
