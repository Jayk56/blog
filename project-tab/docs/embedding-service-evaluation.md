# Embedding Service Evaluation: Model Selection & Granularity Analysis

*Generated 2026-02-14 for Phase 3A-2 planning.*

## 1. What the Embedding Service Does

The `EmbeddingService` interface (`server/src/intelligence/embedding-service.ts`) drives Layer 1 of the `CoherenceMonitor` -- the system's cross-workstream conflict and duplication detector.

**Pipeline:**

1. Agents produce artifacts (code, config, documents, tests) across workstreams
2. Every 10 ticks, the coherence monitor collects changed artifacts
3. Each artifact's **full file content** is passed to `embedBatch()`
4. The resulting vectors are compared cross-workstream via cosine similarity
5. Pairs above **0.85** are promoted to Layer 2 (LLM deep review)
6. Pairs between **0.70--0.85** emit advisory-severity coherence issues

The current `MockEmbeddingService` produces deterministic 64-dimensional hash vectors. Only identical text produces identical vectors -- no semantic similarity.

**Interface:**

```typescript
interface EmbeddingService {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}
```

---

## 2. Codebase Profile: What Gets Embedded

### 2.1 Artifact Kinds

The system tracks 8 artifact kinds. The `isEmbeddable()` function in the coherence monitor determines which are eligible for embedding:

| Kind | Embeddable | Notes |
|------|:---:|-------|
| `code` | Yes | If text MIME type or unspecified |
| `config` | Yes | If text |
| `test` | Yes | If text |
| `document` | Yes | If text or `application/json` |
| `research` | Yes | If text |
| `decision_record` | Yes | If text |
| `data` | Conditional | Only if explicitly `text/*` |
| `design` | No | Always excluded (images, wireframes) |

### 2.2 File Size Distribution

Analysis of the 238 embeddable source files (`.ts`, `.tsx`, `.py`) in the project-tab codebase:

| Metric | Lines | Est. Tokens (~4 chars/tok) |
|--------|------:|--------:|
| Min | 0 | 0 |
| Median | 173 | ~575 |
| Mean | 249 | ~830 |
| P75 | 336 | ~1,120 |
| P90 | 583 | ~1,940 |
| Max | 1,513 | ~13,530 |

**91.6% of files are under 512 lines (~1,700 tokens)** -- comfortably within any model's context window.

The remaining 8.4% (20 files) range from 583 to 1,513 lines (~1,940--13,530 tokens). One outlier, `scenarios.ts`, reaches ~19,490 tokens due to dense data literals.

### 2.3 Largest Files and Token Estimates

| Lines | ~Tokens | Path | Type |
|------:|--------:|------|------|
| 1,513 | 13,530 | `server/test/integration/phase1-acceptance.test.ts` | Test |
| 1,453 | 10,915 | `server/test/routes/wiring.test.ts` | Test |
| 1,148 | 9,102 | `server/test/intelligence/context-injection-service.test.ts` | Test |
| 1,077 | 9,633 | `server/test/intelligence/knowledge-store-sqlite.test.ts` | Test |
| 977 | 8,842 | `server/src/intelligence/knowledge-store.ts` | Source |
| 976 | 19,490 | `src/data/scenarios.ts` | Data |
| 938 | 7,056 | `src/lib/reducer.ts` | Source |

Key observation: **12 of the 15 largest files are test files.** In a production deployment where agents produce artifacts, agent-produced code files will typically be smaller than the project's own test suite. The mock scenarios simulate artifacts of 1--10 KB (code) to 50--200 KB (documents).

### 2.4 Function/Class Density (Dilution Risk Indicator)

Files with high function density are most vulnerable to embedding dilution -- a duplicated function's signal gets drowned out by the file's other contents.

| File | Lines | Functions | Lines/Function |
|------|------:|----------:|--------------:|
| `knowledge-store-sqlite.test.ts` | 1,077 | 112 | 9.6 |
| `wiring.test.ts` | 1,453 | 101 | 14.4 |
| `phase2-closeout.test.ts` | 988 | 93 | 10.6 |
| `phase1-acceptance.test.ts` | 1,513 | 86 | 17.6 |
| `knowledge-store.ts` | 977 | 53 | 18.4 |
| `reducer.ts` | 938 | 52 | 18.0 |
| `models.py` | 506 | 44 classes | 11.5 |

For the production source files (`knowledge-store.ts`, `reducer.ts`), each function averages ~18 lines. A duplicated 18-line function in a 977-line file contributes ~1.8% of the embedding signal. At that ratio, even identical functions would not push cosine similarity above the 0.70 advisory threshold when the surrounding code diverges.

### 2.5 Mock Scenario Artifact Volumes

| Scenario | Artifacts | Workstreams | Artifacts/Workstream | Primary Kinds |
|----------|:---------:|:-----------:|:--------------------:|---------------|
| Maya (Content Studio) | 5 | 4 | 1.25 | document, research |
| David (SaaS Team) | 7 | 4 | 1.75 | code, document |
| Priya (Portfolio PM) | 3 | 3 | 1.0 | design, research, document |
| Rosa (Research Lab) | 5 | 4 | 1.25 | research, data |
| Sam (Consultant) | 3 | 3 | 1.0 | document, design, decision_record |

Total cross-workstream pairs in a typical scenario: 5--15. This is a small comparison space -- embedding cost and storage are not limiting factors at this scale.

---

## 3. Model Comparison

### 3.1 Candidate Models

| Model | Dims | Context | Price/1M tokens | MTEB | Matryoshka | Key Trait |
|-------|-----:|--------:|----------------:|-----:|:---:|-----------|
| OpenAI `text-embedding-3-small` | 1,536 | 8K | $0.02 | Lower tier | Yes (to 256) | Cheapest API option |
| OpenAI `text-embedding-3-large` | 3,072 | 8K | $0.13 | 64.6 | Yes (to 256) | Wide ecosystem |
| Google `gemini-embedding-001` | 3,072 | **2K** | $0.15 | **68.3** | Yes (to 768) | Best MTEB, shortest context |
| Voyage `voyage-4` | 2,048 | **32K** | $0.06 | 68.6% acc | Yes (to 256) | Best balance |
| Voyage `voyage-4-lite` | 2,048 | **32K** | $0.02 | 66.1% acc | Yes (to 256) | Cheap + beats OpenAI large |
| Voyage `voyage-code-3` | -- | 32K | ~$0.06 | -- | -- | Code-specialized |
| Cohere `embed-v4` | 1,536 | **128K** | $0.12 | 65.2 | Yes (to 256) | Longest context, multimodal |

### 3.2 Context Window vs. Artifact Sizes

| Model Context | Files That Fit Without Chunking | Coverage |
|--------------:|:-------------------------------:|---------:|
| 2K tokens (Gemini) | ~195 of 238 | 81.9% |
| 8K tokens (OpenAI) | ~233 of 238 | 97.9% |
| 32K tokens (Voyage) | 238 of 238 | 100% |
| 128K tokens (Cohere) | 238 of 238 | 100% |

**Gemini's 2K context is disqualifying for this use case.** 18% of the codebase's own files exceed it, and agent-produced documents (research reports, design specs) will routinely exceed 2K tokens. Chunking adds complexity and degrades whole-file similarity comparisons.

OpenAI's 8K context covers 97.9% of files. The 5 files that exceed it are all large test suites (>9K tokens) -- these are unlikely to be agent-produced artifacts in production, so 8K is likely sufficient.

Voyage's 32K context provides full coverage with substantial headroom for large documents.

### 3.3 Cost Projection

Based on the mock scenarios (3--7 artifacts per project, re-embedded on change):

| Model | Cost per Full Re-embed (23 artifacts, ~50K tokens) | Monthly Estimate (100 re-embeds) |
|-------|---------------------------------------------------:|---:|
| OpenAI 3-small | $0.001 | $0.10 |
| Voyage 4-lite | $0.001 | $0.10 |
| Voyage 4 | $0.003 | $0.30 |
| Cohere v4 | $0.006 | $0.60 |
| OpenAI 3-large | $0.007 | $0.65 |
| Gemini embedding-001 | $0.008 | $0.75 |

**Cost is negligible at this scale.** Even at 10x the mock scenario volume, monthly embedding cost stays under $10 for any model. Cost should not drive the decision.

---

## 4. The Granularity Problem

### 4.1 What Whole-File Embedding Catches

| Scenario | Similarity Signal | Detected? |
|----------|:-----------------:|:---------:|
| Two agents create near-identical files | Strong | Yes |
| Similar small config files across workstreams | Strong | Yes |
| Two small single-purpose modules with overlapping logic | Moderate-Strong | Yes |
| Two research documents covering the same topic | Moderate | Likely |

### 4.2 What Whole-File Embedding Misses

| Scenario | Similarity Signal | Detected? |
|----------|:-----------------:|:---------:|
| Same utility function in two large, otherwise different files | Weak (~1-5% of signal) | **No** |
| Same class reimplemented in different module contexts | Weak | **No** |
| Copied helper buried in unrelated code | Minimal | **No** |
| Same algorithm with different variable names in large files | Minimal | **No** |

### 4.3 Dilution Math

For a duplicated function of length `f` in a file of length `F`, the function contributes approximately `f/F` of the embedding signal. For the signal to push cosine similarity above 0.70, the duplicated portion needs to dominate the vector.

Assuming the non-duplicated portions are orthogonal (uncorrelated), approximate similarity contribution from the duplicated portion:

| File Size (tokens) | Function Size (tokens) | Signal Ratio | Likely Detected? |
|--------------------:|-----------------------:|-------------:|:---:|
| 200 | 50 | 25% | Marginal |
| 500 | 50 | 10% | No |
| 1,000 | 50 | 5% | No |
| 200 | 100 | 50% | Likely |
| 500 | 100 | 20% | Marginal |
| 1,000 | 100 | 10% | No |

Files under ~200 tokens with >25% shared content will produce detectable signals. Larger files will not, unless the duplication is extensive.

### 4.4 Does This Matter for the Project-Tab Use Case?

**For the mock scenarios (3--7 artifacts, 3--4 workstreams): Minimally.**

The artifact volumes are small enough that a human reviewing the queue can spot overlaps manually. Cross-workstream artifacts are sparse (1--2 per workstream), and the primary coherence concern is at the document/module level, not the function level.

**For production scale (dozens of agents, hundreds of artifacts): Yes.**

As agent count and artifact volume grow, function-level duplication becomes the dominant coherence risk. Multiple agents writing utility functions, API handlers, or data transformations in parallel will produce duplication at the function level that whole-file embedding cannot detect.

---

## 5. Mitigation Strategies for Granularity Gaps

### 5.1 Option A: Content Hash Deduplication (Low Cost, Catches Exact Copies)

Add a parallel pass that extracts and normalizes function/class bodies, then compares via content hash. No embedding cost.

- **Catches**: Copy-paste duplication, auto-generated boilerplate
- **Misses**: Semantic duplication (same logic, different names)
- **Complexity**: Requires language-aware parsing (tree-sitter or regex-based)
- **Integration point**: Runs alongside Layer 1, produces its own coherence candidates

### 5.2 Option B: Chunk-Level Embedding (Medium Cost, Catches Semantic Overlap)

For files above a size threshold, split into function/class-level chunks before embedding. Each chunk stored with its parent artifact ID.

- **Catches**: Semantic duplication at function level
- **Misses**: Cross-function semantic patterns
- **Complexity**: AST parsing per language, chunk management, expanded comparison space
- **Cost impact**: Multiplies embedding calls by average chunks-per-file (~5--20x for large files)
- **Integration point**: Extends `embedBatch()` input preparation in Layer 1 scan

### 5.3 Option C: Summary Embedding (Higher Cost, Best Semantic Density)

Use a fast LLM to generate structured summaries per file before embedding. The summary captures "this file contains functions X, Y, Z that do A, B, C" -- a semantically dense representation.

- **Catches**: Broad semantic overlap including renamed functions
- **Misses**: Fine-grained implementation details
- **Complexity**: Adds LLM dependency to the embedding pipeline
- **Cost impact**: LLM call per artifact (small input, small output -- ~$0.01-0.05 per artifact)
- **Integration point**: Pre-processing step before `embed()`

### 5.4 Option D: Rely on Layer 2 (Zero Additional Embedding Cost)

Accept that Layer 1 is a coarse filter. When the artifact content provider (3A-5) is wired up, Layer 2's LLM review sees full file contents and can spot function-level duplication.

- **Catches**: Anything the LLM can reason about
- **Misses**: Pairs that never reach Layer 2 because Layer 1 similarity is too low
- **Complexity**: None beyond completing 3A-5
- **Limitation**: Chicken-and-egg -- the pairs most affected by dilution are exactly the pairs that fail to reach Layer 2

### 5.5 Recommended Approach

**Phase 3A (near-term):** Implement whole-file embedding with the chosen model (Option D baseline). This matches the current architecture, unblocks Layer 1 and 2 with real models, and is sufficient for mock-scenario-scale usage.

**Phase 3A addendum:** Add `contentHash`-based exact deduplication (Option A) as a lightweight parallel check. The `content_hash` field already exists in the knowledge store schema but is not used for cross-artifact comparison.

**Phase 3C (when scaling):** Introduce chunk-level embedding (Option B) behind a feature flag, gated on file size (e.g., >300 lines). The `EmbeddingService` interface does not need to change -- chunking is a pre-processing concern in the coherence monitor's `runLayer1Scan()`.

---

## 6. Model Recommendation

### Primary: `voyage-4-lite` ($0.02/1M tokens, 32K context, 2,048 dims)

| Criterion | Assessment |
|-----------|-----------|
| Context window | 32K -- covers 100% of files, no chunking needed |
| Quality | Outperforms OpenAI `text-embedding-3-large` on retrieval benchmarks at 1/6.5x the cost |
| Matryoshka | Supports truncation to 256/512/1,024 dims for storage optimization |
| Price | Same as OpenAI `text-embedding-3-small` ($0.02/1M tokens) |
| Batch API | Supported, with 33% discount |

### Alternative: `text-embedding-3-small` (current plan target)

| Criterion | Assessment |
|-----------|-----------|
| Context window | 8K -- covers 97.9% of files |
| Quality | Lower tier on benchmarks, but adequate for whole-file similarity |
| Ecosystem | Widest SDK support, most documentation, simplest integration |
| Price | $0.02/1M tokens |
| Risk | Lowest integration risk; OpenAI embedding API is the most battle-tested |

### If code-specific accuracy matters: `voyage-code-3`

Optimized for code retrieval tasks. Worth evaluating if the majority of artifacts are `code` kind (as in David's scenario). Same 32K context window.

### Not recommended: `gemini-embedding-001`

Despite the best MTEB score (68.3), the 2K token context window is incompatible with whole-file embedding of code artifacts. Would require a chunking strategy from day one, adding complexity before any benefit is realized.

---

## 7. Summary

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Model** | `voyage-4-lite` (primary) or `text-embedding-3-small` (safe default) | 32K context avoids all chunking; same price as OpenAI small; better accuracy |
| **Dimensions** | 512 (via Matryoshka truncation) | Sufficient for cross-workstream similarity; 4x storage savings vs full dims |
| **Granularity** | Whole-file for Phase 3A; chunk-level behind feature flag for Phase 3C | Matches current architecture; adequate at mock-scenario scale |
| **Dedup gap** | Add content-hash cross-comparison using existing `content_hash` field | Zero embedding cost; catches exact function-level copies |
| **Context window** | Not a bottleneck except for Gemini | 8K (OpenAI) or 32K (Voyage) covers all realistic artifacts |
| **Cost** | Negligible at current scale ($0.10--$0.75/month) | Not a differentiating factor |
