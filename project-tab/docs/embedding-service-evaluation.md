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

### 2.2 Artifact Characteristics by Kind

The project-tab codebase is code-heavy, but the system is designed for arbitrary organizations running arbitrary projects. Different artifact kinds have fundamentally different size profiles, semantic structures, and embedding behaviors.

| Kind | Typical Token Range | Semantic Structure | Duplication Pattern | Embedding Effectiveness |
|------|--------------------:|-------------------|---------------------|:-----------------------:|
| `code` (small module) | 100--500 | Dense, function-centric | Exact function copies, shared utilities | Good |
| `code` (large module) | 500--5,000 | Many functions, mixed concerns | Buried function-level overlap | Poor (dilution) |
| `config` | 50--500 | Key-value, declarative | Drift between environments/workstreams | Good |
| `test` | 200--5,000 | Repetitive structure, high boilerplate | Overlapping test coverage | Moderate (noisy) |
| `document` | 1,000--20,000+ | Narrative, thematic | Thematic overlap, repeated conclusions | **Good** (theme permeates vector) |
| `research` | 1,000--10,000 | Dense domain terminology, citations | Independent discovery of same findings | **Good** (high signal-to-noise) |
| `decision_record` | 100--500 | Structured, rationale-focused | Contradictory or redundant decisions | **Good** (short, semantically dense) |
| `data` | Variable (100--100,000+) | Tabular, repetitive, low semantic content | Overlapping datasets | **Poor** (embeddings capture format, not meaning) |
| `design` | N/A | Visual (excluded from embedding) | N/A | N/A |

**Key insight:** The analysis in section 2.3 below is based on this project's TypeScript/Python source files. In production, the artifact mix will vary dramatically by organization:

- A **consulting firm** (Sam's scenario) produces mostly `document` and `decision_record` artifacts -- short, semantically dense, well-suited to whole-file embedding
- A **research lab** (Rosa's scenario) produces `research` and `data` artifacts -- research docs embed well, but data artifacts need content-hash or schema-level comparison instead
- A **SaaS team** (David's scenario) produces `code`, `config`, and `test` artifacts -- the most susceptible to the dilution problem
- A **content studio** (Maya's scenario) produces `document` and `research` -- often long-form, where context window becomes the binding constraint

The context window and granularity recommendations in this report must account for document-heavy organizations where artifacts routinely exceed 8K tokens, not just the code-file profile of this codebase.

### 2.3 File Size Distribution (This Codebase)

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

### 2.4 Largest Files and Token Estimates

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

### 2.5 Function/Class Density (Dilution Risk Indicator)

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

### 2.6 Mock Scenario Artifact Volumes

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

**Gemini's 2K context is disqualifying for this use case.** 18% of this codebase's own files exceed it, and agent-produced documents (research reports, design specs) will routinely exceed 2K tokens. Chunking adds complexity and degrades whole-file similarity comparisons.

OpenAI's 8K context covers 97.9% of *this codebase's* files. However, this codebase is code-heavy with a median of ~575 tokens per file. **Document-heavy organizations tell a different story:**

| Artifact Kind | Typical Token Range | Fits in 2K? | Fits in 8K? | Fits in 32K? |
|---------------|--------------------:|:-----------:|:-----------:|:------------:|
| `code` (small) | 100--500 | Yes | Yes | Yes |
| `code` (large) | 500--5,000 | Often no | Usually | Yes |
| `config` | 50--500 | Yes | Yes | Yes |
| `decision_record` | 100--500 | Yes | Yes | Yes |
| `research` | 1,000--10,000 | Rarely | Often | Yes |
| `document` (short) | 1,000--5,000 | Rarely | Usually | Yes |
| `document` (long) | 5,000--20,000+ | No | Often no | Usually |
| `data` (text) | 100--100,000+ | Varies | Varies | Varies |

For a consulting firm producing 10-page research reports or a content studio generating long-form documents, **8K is not sufficient** -- these artifacts routinely hit 10K--20K tokens. The 32K window becomes necessary, not just nice-to-have.

Voyage's 32K context provides coverage for all realistic artifacts across organization types. Cohere's 128K provides further headroom for data-heavy use cases, though embeddings of raw data have limited semantic value regardless of context window.

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

### 4.1 Effectiveness by Artifact Kind

Whole-file embedding effectiveness varies dramatically by artifact type. The dilution problem is primarily a *code* problem -- other artifact kinds have different semantic structures that interact with embeddings differently.

| Kind | Embedding Effectiveness | Why |
|------|:-----------------------:|-----|
| `code` (small, <500 tok) | **Good** | File ≈ function-level granularity; high signal-to-noise |
| `code` (large, >500 tok) | **Poor** | Many functions dilute per-function signal; 18-line function contributes ~1.8% in a 977-line file |
| `config` | **Good** | Small, declarative, structurally similar when overlapping |
| `test` | **Moderate** | High boilerplate ratio creates noise; test structure similarity ≠ tested-code similarity |
| `document` | **Good** | Thematic duplication permeates the entire text; shared topic = shared vector direction |
| `research` | **Good** | Dense domain terminology creates strong semantic fingerprints; independent discovery of same findings produces naturally similar vectors |
| `decision_record` | **Good** | Short and semantically dense; overlapping or contradictory decisions share vocabulary |
| `data` | **Poor** | Embedding captures format/structure, not data semantics; "CSV with 3 columns" ≠ meaningful similarity |

**The implication:** For organizations like consulting firms (Sam), content studios (Maya), and research labs (Rosa), whole-file embedding is actually well-suited to their primary artifact types. The dilution problem is concentrated in SaaS/engineering teams (David) producing large code files.

### 4.2 Detection Matrix by Scenario and Artifact Kind

| Scenario | Artifact Kind | Similarity Signal | Detected? |
|----------|--------------|:-----------------:|:---------:|
| Two agents write near-identical code files | `code` | Strong | Yes |
| Two agents write the same utility function in large, different files | `code` | Weak (~1-5%) | **No** |
| Same class reimplemented in different module contexts | `code` | Weak | **No** |
| Two agents produce research reports reaching the same conclusion | `research` | **Strong** | Yes |
| Two workstreams produce overlapping project documentation | `document` | **Moderate-Strong** | Yes |
| Contradictory decisions made in parallel workstreams | `decision_record` | **Moderate** | Likely |
| Config drift between workstream environments | `config` | **Strong** | Yes |
| Two agents generate overlapping datasets | `data` | Weak (format, not content) | **No** |
| Long research document with one duplicated section | `research` | Moderate (diluted by length) | Marginal |
| Two short memos covering the same topic | `document` | **Strong** | Yes |

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

### 4.4 Does This Matter? It Depends on the Organization

The severity of the granularity gap depends on the artifact mix, which varies by organization type:

**Document-heavy organizations (consulting, content, research):**

Whole-file embedding works well. Documents, research reports, and decision records are the primary artifacts, and their semantic structure aligns with how embeddings work -- thematic overlap produces naturally similar vectors. The main risk is long documents (>8K tokens) where a single duplicated section gets diluted by length, but this is a milder version of the code dilution problem since thematic language tends to repeat throughout a document.

**Code-heavy organizations (SaaS teams, engineering):**

The granularity gap is a real concern at scale. Function-level duplication across workstreams is the dominant coherence risk, and whole-file embedding systematically misses it. At mock-scenario scale (3--7 artifacts, 3--4 workstreams) a human can spot overlaps manually. At production scale (dozens of agents, hundreds of code artifacts), the gap becomes material.

**Mixed organizations (portfolio management, cross-functional teams):**

The gap is artifact-kind-dependent. Code artifacts need granularity mitigation; document artifacts do not. The system could apply different strategies per artifact kind (see Section 5).

**Data-heavy organizations (analytics, ML pipelines):**

Embeddings are the wrong tool for `data` artifacts entirely. These need structural comparison (schema matching, column overlap detection) or content hashing, not semantic embedding. This is a gap in the current `isEmbeddable()` logic -- `data` artifacts with `text/*` MIME type will be embedded, but the resulting vectors carry minimal semantic value.

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

### 5.5 Option E: Kind-Aware Embedding Strategy

Apply different strategies per artifact kind, since the granularity problem is not uniform:

| Kind | Strategy | Rationale |
|------|----------|-----------|
| `code` (>300 lines) | Chunk at function/class boundaries + whole-file | Dilution makes whole-file insufficient |
| `code` (<300 lines) | Whole-file | File ≈ function granularity; chunking adds no value |
| `config` | Whole-file + content hash | Small files; hash catches exact drift |
| `test` | Whole-file (lower priority) | Test overlap is less critical than source overlap |
| `document` | Whole-file | Thematic overlap works well at file level |
| `research` | Whole-file | Domain terminology creates strong semantic signal |
| `decision_record` | Whole-file | Short, dense; ideal for whole-file embedding |
| `data` | Content hash / schema comparison only | Embeddings carry minimal semantic value for tabular data |

- **Pro**: Targets mitigation effort where the problem actually exists
- **Pro**: Avoids unnecessary chunking cost for artifact kinds that don't need it
- **Con**: More complex logic in `runLayer1Scan()` -- needs kind-aware branching
- **Integration point**: The `isEmbeddable()` function already switches on artifact kind; extend this to return a strategy enum rather than a boolean

### 5.6 Recommended Approach

**Phase 3A (near-term):** Implement whole-file embedding with the chosen model (Option D baseline). This matches the current architecture, unblocks Layer 1 and 2 with real models, and is sufficient for mock-scenario-scale usage. Works well for document-heavy organizations out of the box.

**Phase 3A addendum:** Add `contentHash`-based exact deduplication (Option A) as a lightweight parallel check. The `content_hash` field already exists in the knowledge store schema but is not used for cross-artifact comparison. Also consider excluding `data` artifacts from embedding entirely (or flagging them for hash-only comparison), since embeddings provide minimal value for tabular/structured data.

**Phase 3C (when scaling):** Introduce kind-aware embedding strategy (Option E) behind a feature flag. Chunk `code` artifacts at function boundaries when they exceed a size threshold (~300 lines). Keep whole-file embedding for `document`, `research`, and `decision_record` artifacts where it works well. The `EmbeddingService` interface does not need to change -- chunking and kind-awareness are pre-processing concerns in the coherence monitor's `runLayer1Scan()`.

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
| **Model** | `voyage-4-lite` (primary) or `text-embedding-3-small` (safe default) | 32K context handles long documents from any organization type; same price as OpenAI small; better accuracy |
| **Dimensions** | 512 (via Matryoshka truncation) | Sufficient for cross-workstream similarity; 4x storage savings vs full dims |
| **Granularity** | Whole-file for Phase 3A; kind-aware chunking for Phase 3C | Whole-file works well for documents, research, decisions; only code artifacts need function-level chunking |
| **Dedup gap** | Add content-hash cross-comparison using existing `content_hash` field | Zero embedding cost; catches exact function-level copies |
| **Data artifacts** | Exclude from embedding; use hash/schema comparison | Embeddings of tabular data carry minimal semantic value |
| **Context window** | 32K strongly preferred over 8K | Document-heavy organizations routinely produce 10K--20K token artifacts; 8K is insufficient for consulting/content/research use cases |
| **Gemini** | Not recommended despite best MTEB score | 2K context is disqualifying for whole-file embedding of any non-trivial artifact |
| **Cost** | Negligible at current scale ($0.10--$0.75/month) | Not a differentiating factor |
