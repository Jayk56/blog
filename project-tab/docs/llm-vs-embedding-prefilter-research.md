# LLM vs. Embedding Pre-Filter: Research Report & Evaluation Experiments

*Generated 2026-02-17 for Phase 3A-2 planning.*

## Executive Summary

The question: **As LLM context windows reach 1M+ tokens, can we skip embedding-based pre-filtering and just have an LLM review the entire artifact corpus for coherence issues?**

The short answer: **Not reliably, and not cost-effectively at scale -- but the hybrid pipeline we already have (Layer 1 embedding + Layer 2 LLM) is close to the emerging best practice.** The real question is whether the thresholds, cost ratios, and failure modes are calibrated correctly, which is what the experiments in Section 5 are designed to answer.

---

## 1. The Research Landscape (2024--2026)

### 1.1 RAG vs. Long-Context: Head-to-Head Benchmarks

| Study | Finding | Implication for Us |
|-------|---------|-------------------|
| **Li et al., EMNLP 2024** ([arXiv:2407.16833](https://arxiv.org/abs/2407.16833)) | Long-context (LC) outperforms RAG by 3.6--13.1% on average. But RAG is dramatically cheaper. Proposes "Self-Route" (route to LC or RAG based on model self-reflection) saving 39--65% cost while matching LC performance. | Our Layer 1→2 pipeline is architecturally similar to Self-Route: cheap pre-filter routes candidates to expensive LLM review. |
| **LaRA, ICML 2025** ([OpenReview](https://openreview.net/forum?id=CLF25dahgA)) | "No silver bullet" -- 2,326 test cases across 11 LLMs. Optimal approach depends on model, task, context length, and retrieval characteristics. | Confirms we need to evaluate empirically rather than assume one approach wins. |
| **ICLR 2025** ([Proceedings](https://proceedings.iclr.cc/paper_files/paper/2025/file/5df5b1f121c915d8bdd00db6aac20827-Paper-Conference.pdf)) | Increasing retrieved passages does NOT consistently improve performance. Hard negatives actively hurt. | Relevant to Layer 2: if we pass too many false-positive candidates, the LLM may perform worse than with fewer, better candidates. |
| **Databricks 2024** ([Blog](https://www.databricks.com/blog/long-context-rag-performance-llms)) | Most models degrade after 32K--64K tokens. Only a few maintain consistent long-context performance. | A 500K token artifact corpus would exceed the reliable range for most models. |

### 1.2 The "Lost in the Middle" Problem -- Critical for Duplication Detection

This is the most important finding for our use case. Duplication detection requires the LLM to notice relationships between items at **arbitrary positions** in a long context -- exactly where attention is weakest.

| Study | Finding | Impact |
|-------|---------|--------|
| **Liu et al., TACL 2024** ([arXiv:2307.03172](https://arxiv.org/abs/2307.03172)) | Performance degrades by >30% when relevant information shifts from start/end to middle. U-shaped attention curve mirrors human serial position effect. | An LLM reviewing 50 artifacts would reliably compare the first few and last few, but miss relationships in the middle. |
| **NoLiMa, ICML 2025** ([arXiv:2502.05167](https://arxiv.org/abs/2502.05167)) | When lexical overlap is removed (semantic-only matching), effective context length shrinks to **1K tokens** with distractors. GPT-4o drops from 99.3% (short) to 69.7% at longer contexts. | **Devastating for our use case.** Near-duplicates have high semantic similarity but potentially low lexical overlap. This is exactly the NoLiMa failure mode. |
| **Chroma "Context Rot", July 2025** ([Research](https://research.trychroma.com/context-rot)) | 18 models tested. Performance degrades on even simple tasks as context grows. Counter-intuitively, randomly shuffled haystacks performed *better* than coherent ones. | Suggests that structured artifact corpora (grouped by workstream) may actually make detection harder, not easier. |

**Key insight:** The NIAH benchmarks showing 99%+ recall at 1M tokens are for **literal string retrieval** -- a much easier task than semantic similarity detection. For the kind of soft matching our coherence monitor needs, effective context length is dramatically shorter.

### 1.3 LLMs as Embedding Models

Recent work shows LLMs can produce competitive embeddings, blurring the line between the two approaches:

- **LLM2Vec** ([arXiv:2404.05961](https://arxiv.org/abs/2404.05961)): Transforms decoder-only LLMs into text encoders. Strong MTEB results without synthetic data.
- **NV-Embed (NVIDIA)** ([arXiv:2405.17428](https://arxiv.org/abs/2405.17428)): Shows decoder-only LLMs can outperform dedicated embedding models when adapted.
- **Qwen3-Embedding-8B**: Highest MTEB score (70.58) of any model, open-source. Self-hosted LLM producing embeddings.

This doesn't change the architectural recommendation (embeddings for pre-filter, LLM for judgment) but suggests the embedding quality ceiling is rising fast.

### 1.4 Anthropic's Own Recommendation

From Anthropic's "Contextual Retrieval" blog (September 2024, [link](https://www.anthropic.com/news/contextual-retrieval)):

> If your knowledge base is <200K tokens (~500 pages), just put everything in the prompt.

Our mock scenarios produce ~50K tokens of artifacts. At production scale with dozens of agents, this could reach 200K--500K tokens. So we're right at the boundary where the pure-LLM approach starts to break down.

---

## 2. Cost Analysis: Embedding Pre-Filter vs. Full-Context LLM

### 2.1 Per-Scan Cost Comparison

Assuming a coherence scan every 10 ticks, with 23 artifacts totaling ~50K tokens (mock scenario scale):

| Approach | Cost per Scan | Monthly (100 scans) | Notes |
|----------|-------------:|--------------------:|-------|
| **Embedding only** (Layer 1) | $0.001 | $0.10 | voyage-4-lite at $0.02/1M tokens |
| **LLM only** (stuff all artifacts) | $0.15 | $15.00 | Claude Sonnet at $3/1M input tokens |
| **LLM only** (GPT-4o-mini) | $0.008 | $0.75 | $0.15/1M input tokens |
| **Hybrid** (Layer 1 + Layer 2 for ~5 candidates) | $0.01 | $1.00 | Embedding + LLM on ~5K focused tokens |

### 2.2 At Production Scale (200 artifacts, ~500K tokens)

| Approach | Cost per Scan | Monthly (100 scans) | Notes |
|----------|-------------:|--------------------:|-------|
| **Embedding only** | $0.01 | $1.00 | Still negligible |
| **LLM only** (Claude Sonnet) | $1.50 | $150.00 | 150x more than embedding |
| **LLM only** (GPT-4o-mini) | $0.075 | $7.50 | Cheap but quality concerns at this scale |
| **Hybrid** (Layer 1 + Layer 2) | $0.05 | $5.00 | Embedding + LLM on focused candidates |

### 2.3 The Cost Trajectory Argument

LLM costs are dropping ~10x per year. Counter-arguments:

- Even at 10x cheaper, the LLM-only approach is still 15x more expensive than hybrid at production scale
- Embedding costs are also dropping (and may eventually be free via open-source self-hosted models)
- The cost gap narrows but never closes because embedding is fundamentally a simpler operation

**However:** If the hybrid approach misses important coherence issues that the LLM-only approach catches, the cost difference is irrelevant. That's what the experiments need to measure.

---

## 3. OpenAI Frontier: Enterprise Agent Platform Comparison

### 3.1 What Frontier Is

[OpenAI Frontier](https://openai.com/index/introducing-openai-frontier/) (launched February 5, 2026) is an enterprise platform for building, deploying, and managing AI agents -- which OpenAI calls "AI coworkers." It's not a document scanning tool; it's an **agent operating system** built on four pillars:

1. **Business Context** -- A semantic layer connecting enterprise data sources (CRMs, data warehouses, ticketing tools, internal apps) so all agents share a unified understanding of the organization
2. **Agent Execution** -- An environment where agents reason, use tools, run code, and build memory from past interactions
3. **Evaluation & Optimization** -- Performance tracking and feedback loops so agents improve over time
4. **Enterprise Governance** -- IAM, agent identities, permission scoping, SOC 2 Type II / ISO 27001 compliance

Early adopters include HP, Intuit, Oracle, State Farm, Thermo Fisher, and Uber. Pricing is not public (enterprise sales only). Implementation requires OpenAI's Forward Deployed Engineers and can take months.

### 3.2 The Business Context Semantic Layer

This is the component most architecturally relevant to our Phase 3A work. It provides shared input context to all agents via:

- **RAG (Retrieval-Augmented Generation)**: Connectors pull data from enterprise systems at runtime, inject relevant information into agent prompts
- **Embeddings + Vector Search**: Documents embedded with `text-embedding-3-large`, stored in vector databases, retrieved via cosine similarity
- **MCP Connectors**: Model Context Protocol integrations for Slack, SharePoint, Google Drive, GitHub, etc.
- **Possibly knowledge graph elements**: Not confirmed, but plausible given the need to understand entity relationships across systems

**What the semantic layer does**: Gives agents consistent *input* context so they operate from the same information base.

**What it does NOT do**: Compare agent *outputs* against each other for conflicts, contradictions, or duplication.

### 3.3 Frontier's Coordination Engine

Frontier includes a "Coordination Engine" that manages agent fleets. Based on available documentation, it handles:

- **Task deduplication**: Preventing two agents from performing the same work
- **Permission scoping**: Each agent has a unique identity with specific access rights
- **Workflow orchestration**: Routing tasks to the right agent, managing parallel execution
- **Audit logging**: All agent actions are logged and traceable

**Critically, this operates at the task/permission/workflow level, not the content/semantic level.** It prevents two agents from being *assigned* the same work, but it does not detect when two agents independently produce *conflicting outputs* on different work.

### 3.4 Frontier's Evaluation & Optimization

The evaluation system is **outcome-based**:

- Performance monitoring via built-in tracing (every LLM call, tool call, handoff)
- Feedback loops: did the task succeed? Did the human approve?
- Behavioral adjustment based on feedback (prompt tuning, routing changes)
- Memory-based improvement: successful patterns reinforced over time

**There is no documented evidence that Evaluation & Optimization performs:**
- Cross-artifact conflict detection
- Embedding-based similarity checking between agent outputs
- Automated semantic consistency verification
- Coherence monitoring of the kind our Layer 0/1/2 pipeline does

### 3.5 Frontier's Memory System

Four layers, relevant because memory architecture affects how conflicts could theoretically be caught:

| Layer | Scope | Mechanism |
|-------|-------|-----------|
| Short-term | Single session | Conversation history |
| Medium-term | Cross-session | Context compaction via Responses API |
| Long-term | Per-agent | Embedding-based vector memory, similarity retrieval |
| Institutional | Org-wide | The shared semantic layer (Business Context) |

The long-term memory layer uses embeddings internally -- the same technique our Layer 1 uses, but applied to agent *experience* rather than agent *outputs*.

### 3.6 Frontier vs. Phase 3A: The Fundamental Difference

**Frontier provides shared context *inputs* to reduce the probability of conflicts. Our coherence pipeline compares agent *outputs* to detect conflicts that occur despite shared context.**

These are complementary layers, not alternatives:

| Dimension | OpenAI Frontier | Our CoherenceMonitor (Phase 3A) |
|---|---|---|
| **Goal** | Prevent conflicts by aligning agent inputs | Detect conflicts by comparing agent outputs |
| **When** | Pre-execution (shared context) + post-execution (outcome eval) | Post-production (after artifacts are generated) |
| **Conflict detection** | Task-level deduplication (Coordination Engine) | Semantic content comparison (embedding + LLM) |
| **Cross-agent output comparison** | **Not documented** | **Core function** |
| **Architecture** | RAG + connectors + vector search + orchestration | Layer 0 structural + Layer 1 embedding + Layer 2 LLM |
| **Detection granularity** | Coarse (task/workflow) | Fine-grained (artifact content, function-level) |
| **Structured output** | Traces and performance metrics | Category, severity, explanation, suggested resolution |
| **Cost** | Enterprise pricing (likely 6-7 figures/year) | ~$0.01--$5/scan depending on approach |
| **Implementation** | Months, requires OpenAI FDEs | Days to weeks for basic pipeline |
| **Vendor lock-in** | High (despite "open" claims) | Low (swappable models, stores) |

### 3.7 What Frontier Does That We Should Consider Adopting

| Frontier Feature | Relevance to Phase 3A |
|---|---|
| **Shared semantic layer** | Our `ContextInjectionService` (3A-1) is the equivalent -- pushing shared context to agents. Frontier validates this architectural choice. |
| **Hybrid retrieval** (embedding + keyword) | Our Layer 1 is embedding-only. Adding keyword/lexical matching (like BM25 or Jaccard) could catch conflicts that embeddings miss when there's exact string overlap. |
| **Multi-layer memory** | Our knowledge store already has artifact provenance and audit logs. The pattern of promoting short-term observations to long-term memory aligns with how we could track recurring coherence patterns. |
| **Automatic chunking** (~800 tokens, 400 overlap) | We have no chunking in Phase 3A. Frontier's chunking parameters are a reasonable starting point for Phase 3C. |
| **Built-in tracing** | Our event bus and audit log serve a similar function, but structured observability traces would improve debugging. |

### 3.8 What We Do That Frontier Doesn't

| Our Capability | Frontier Equivalent |
|---|---|
| **Layer 0**: Structural file-path conflict detection | None |
| **Layer 1**: All-pairs cross-workstream embedding comparison | None (semantic layer is for retrieval, not comparison) |
| **Layer 2**: LLM review with structured coherence output | None (evaluation is outcome-based, not content-based) |
| **Workstream-aware pair filtering** | None (Coordination Engine works at task level) |
| **Severity/category classification of issues** | None |
| **Suggested resolution generation** | None |

### 3.9 Competitive Landscape (Updated)

| Vendor | Product | Shared Context? | Output Coherence Checking? | Architecture |
|--------|---------|:---:|:---:|---|
| **OpenAI** | Frontier | **Yes** (semantic layer) | No | RAG + connectors + Coordination Engine |
| **Microsoft** | Copilot 365 / Agent 365 | **Yes** (Graph-grounded) | No | Semantic search + agent fleet observability |
| **Google** | NotebookLM / Vertex AI | Partial | No | Gemini + document ingestion |
| **Anthropic** | Claude Connectors / Cowork | Partial (MCP) | No | MCP-based data access, long context |
| **Cohere** | Compass / North | **Yes** (Embed + Rerank) | No | Embed + Rerank pipeline |
| **Salesforce** | Agentforce | **Yes** (Data Cloud) | No | Governed data + agent actions |
| **Us** | CoherenceMonitor | Via ContextInjectionService | **Yes** | Layer 0/1/2 structured pipeline |

**No vendor -- including Frontier -- offers output-level coherence monitoring.** Every platform focuses on giving agents the right inputs. None systematically verify that outputs are consistent. This remains a differentiating capability.

The strongest framing: **Frontier is the infrastructure layer (shared context, execution, governance). Coherence monitoring is the quality assurance layer (output verification). One does not replace the other -- a complete system needs both.**

---

## 4. Synthesis: How Much Value Does Embedding Pre-Filtering Add?

### 4.1 Arguments For Keeping the Embedding Pre-Filter (Layer 1)

| Argument | Evidence |
|----------|----------|
| **Position-independent comparison** | Embeddings compare all pairs equally; LLMs miss items in the middle of context (Liu et al., 2024) |
| **Semantic similarity detection degrades in long context** | NoLiMa shows effective context drops to 1K tokens for semantic matching with distractors |
| **100--150x cheaper** at production scale | $0.01 vs $1.50 per scan at 500K tokens |
| **Deterministic** | Same input always produces same similarity score; LLM outputs are stochastic |
| **Incremental** | New artifacts can be embedded and compared without re-processing the entire corpus |
| **The N² problem** | Embedding comparison is O(N²) vector ops (microseconds); LLM comparison requires O(N²) reasoning (impossible in single pass) |

### 4.2 Arguments For Reducing or Eliminating the Pre-Filter

| Argument | Evidence |
|----------|----------|
| **Embedding dilution misses function-level duplication** | See embedding evaluation report Section 4 |
| **LLMs catch nuanced conflicts embeddings can't** | Contradictions, dependency violations, semantic-but-not-lexical overlap |
| **Cost gap is narrowing** | GPT-4o-mini at $0.15/1M tokens approaches embedding cost |
| **Small corpus sizes** | At mock-scenario scale (50K tokens), LLM-only is $0.15/scan -- trivial |
| **Anthropic's own guidance** | "If <200K tokens, skip RAG" |
| **Simplicity** | One less service to configure, deploy, and maintain |

### 4.3 The Verdict

**The embedding pre-filter adds clear value in three specific ways:**

1. **It makes Layer 2 work better.** The ICLR 2025 paper shows that hard negatives (irrelevant items) in retrieved context actively hurt LLM performance. Layer 1 filters the candidate space so Layer 2 sees only plausible pairs, not noise.

2. **It solves the positional attention problem.** The LLM doesn't need to "find" the duplicates in a 500K-token haystack. Layer 1 presents them as focused pairs for judgment.

3. **It scales.** 200 artifacts = 19,900 cross-workstream pairs. No LLM can evaluate 19,900 pairs in a single pass. Embeddings do it in milliseconds.

**The pre-filter's weakness is false negatives** -- pairs that Layer 1 scores below 0.70 that are actually coherence issues. This is the dilution problem for code, and the thematic-dilution problem for very long documents.

### 4.4 Recommended Architecture Evolution

```
Current:   Layer 0 (structural) → Layer 1 (embedding) → Layer 2 (LLM)

Proposed:  Layer 0 (structural)
           ├→ Layer 1a (embedding similarity, ≥0.70)  ──→ Layer 2 (LLM review)
           ├→ Layer 1b (content hash, exact matches)   ──→ Layer 2 (LLM review)
           └→ Layer 1c (periodic LLM sweep, <200K tok) ──→ direct issue emission
```

Layer 1c is the new addition: a periodic (less frequent than Layer 1a) pass where the full artifact corpus is given to an LLM to look for issues that embeddings miss -- but only when the corpus is small enough. This catches the false negatives from embedding dilution while keeping the cost manageable.

---

## 5. Evaluation Experiments

### 5.1 Experiment Design Overview

We propose 5 experiments using the existing `CoherenceMonitor` infrastructure, with synthetic artifact data designed to test specific failure modes.

All experiments follow the same structure:
1. **Generate** a set of artifacts with known coherence issues (ground truth)
2. **Run** each detection approach (embedding-only, LLM-only, hybrid)
3. **Measure** precision, recall, cost, and latency against ground truth

#### Ground Truth Corpus

Build a synthetic corpus of ~50 artifacts across 5 workstreams, with 15 planted coherence issues:

| # | Issue Type | Artifact Kind | Detection Difficulty |
|---|-----------|---------------|---------------------|
| 1--3 | Near-identical files | `code` | Easy (high embedding similarity) |
| 4--6 | Duplicated functions in large files | `code` | Hard (embedding dilution) |
| 7--8 | Thematic overlap in research docs | `research` | Medium (should embed well) |
| 9--10 | Contradictory decisions | `decision_record` | Medium (semantic, not lexical) |
| 11--12 | Config drift | `config` | Easy (small files, high signal) |
| 13 | Same conclusion, different framing | `document` | Hard (semantic-only overlap) |
| 14 | API contract mismatch (David scenario) | `code` + `document` | Hard (cross-kind) |
| 15 | Dependency violation | `code` | Hard (structural, not textual) |

Plus ~35 "clean" artifacts with no coherence issues (to measure false positive rate).

---

### 5.2 Experiment 1: Embedding Threshold Sensitivity

**Question:** How sensitive are detection rates to the Layer 1 similarity thresholds?

**Method:**
1. Embed all 50 artifacts with a real embedding model (voyage-4-lite or text-embedding-3-small)
2. Compute all cross-workstream cosine similarities
3. For each threshold in `[0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]`:
   - Count true positives (known issues detected)
   - Count false positives (clean pairs flagged)
   - Compute precision and recall

**Expected output:**

```
Threshold | TP | FP | FN | Precision | Recall | F1
----------|----|----|----|-----------+--------+----
0.50      | ?? | ?? | ?? | ??        | ??     | ??
0.55      | ...
...
0.90      | ?? | ?? | ?? | ??        | ??     | ??
```

**What we learn:** The optimal threshold for our artifact mix. If recall drops sharply above 0.60, the current 0.70 advisory threshold may be too aggressive.

**Implementation:**

```typescript
// experiment-1-threshold-sensitivity.test.ts

import { EmbeddingService, cosineSimilarity } from '../src/intelligence/embedding-service'
// Use real embedding service (voyage-4-lite or openai)

describe('Experiment 1: Threshold Sensitivity', () => {
  const groundTruth: Map<string, boolean> = new Map() // pairKey → isIssue
  const artifacts: Map<string, { content: string; workstream: string }> = new Map()

  beforeAll(async () => {
    // Load synthetic corpus (see Section 5.7 for corpus generation)
    // Populate groundTruth with known issue pairs
    // Embed all artifacts
  })

  const thresholds = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]

  for (const threshold of thresholds) {
    it(`evaluates at threshold ${threshold}`, () => {
      let tp = 0, fp = 0, fn = 0, tn = 0

      for (const [pairKey, similarity] of allPairSimilarities) {
        const isIssue = groundTruth.get(pairKey) ?? false
        const detected = similarity >= threshold

        if (detected && isIssue) tp++
        else if (detected && !isIssue) fp++
        else if (!detected && isIssue) fn++
        else tn++
      }

      console.log(`${threshold} | TP=${tp} FP=${fp} FN=${fn} | P=${tp/(tp+fp)} R=${tp/(tp+fn)}`)
    })
  }
})
```

---

### 5.3 Experiment 2: Embedding Dilution Measurement

**Question:** At what file size does embedding dilution cause function-level duplicates to become undetectable?

**Method:**
1. Create a "target function" of ~50 tokens (a realistic utility function)
2. Embed the function in isolation → reference vector
3. Create wrapper files of increasing size: 100, 200, 500, 1000, 2000, 5000 tokens
4. In each wrapper, embed the same function surrounded by unrelated code
5. Compute cosine similarity between reference vector and each wrapper
6. Repeat for 3 different embedding models

**Expected output:**

```
Wrapper Size | Model A Similarity | Model B Similarity | Model C Similarity
-------------|--------------------|--------------------|-------------------
100 tokens   | 0.92               | 0.89               | 0.91
200 tokens   | 0.81               | 0.78               | 0.83
500 tokens   | 0.62               | 0.59               | 0.65
1000 tokens  | 0.45               | 0.41               | 0.48
2000 tokens  | 0.31               | 0.28               | 0.33
5000 tokens  | 0.18               | 0.15               | 0.20
```

**What we learn:** The empirical dilution curve. This tells us the file size threshold above which chunking becomes necessary, and whether different models resist dilution differently.

**Implementation:**

```typescript
// experiment-2-dilution-curve.test.ts

const TARGET_FUNCTION = `
export function validateEmail(email: string): boolean {
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/
  if (!email || typeof email !== 'string') return false
  if (email.length > 254) return false
  return pattern.test(email.trim().toLowerCase())
}
`

const FILLER_CODE_POOL = [
  // ~50 unrelated functions to draw from as padding
  // Each ~50-100 tokens
]

describe('Experiment 2: Dilution Curve', () => {
  const wrapperSizes = [100, 200, 500, 1000, 2000, 5000]

  it('measures similarity decay as file size grows', async () => {
    const referenceEmbedding = await embeddingService.embed(TARGET_FUNCTION)

    for (const size of wrapperSizes) {
      const wrapper = buildWrapperFile(TARGET_FUNCTION, FILLER_CODE_POOL, size)
      const wrapperEmbedding = await embeddingService.embed(wrapper)
      const similarity = cosineSimilarity(referenceEmbedding, wrapperEmbedding)

      console.log(`${size} tokens | similarity: ${similarity.toFixed(4)}`)
    }
  })
})
```

---

### 5.4 Experiment 3: LLM-Only Detection (Full-Context)

**Question:** Can an LLM, given the full artifact corpus in its context window, find all 15 planted coherence issues?

**Method:**
1. Concatenate all 50 artifacts into a single prompt (~50K--100K tokens)
2. Ask the LLM: "Review these artifacts from 5 workstreams. Identify all cases of duplication, contradiction, conflict, or dependency violation between artifacts in different workstreams."
3. Parse the LLM's response against ground truth
4. Repeat 5 times (measure stochastic variance)
5. Test with artifacts in different orderings (first, middle, last) to measure positional bias

**Expected output:**

```
Run | Issues Found | TP | FP | FN | Missed Issue Types
----|-------------|----|----|----|-----------------
1   | 11          | 9  | 2  | 6  | function-level dupes, cross-kind mismatch
2   | 13          | 10 | 3  | 5  | function-level dupes, dependency violation
3   | 10          | 8  | 2  | 7  | ...
4   | 12          | 9  | 3  | 6  | ...
5   | 11          | 9  | 2  | 6  | ...
Avg | 11.4        | 9  | 2.4| 6  | ...
```

**What we learn:** The LLM-only recall ceiling, which issue types it misses, and how much variance there is between runs.

**Implementation:**

```typescript
// experiment-3-llm-full-context.test.ts

const REVIEW_PROMPT = `You are a coherence monitor for a multi-agent project management system.
Below are artifacts produced by agents across 5 workstreams. Your task is to identify ALL
cases where artifacts in DIFFERENT workstreams have:
- Duplicated content or functionality
- Contradictory information or approaches
- Dependency violations (one assumes something another contradicts)
- Configuration drift

For each issue found, respond with JSON:
{
  "issues": [
    {
      "artifactA": "<id>",
      "artifactB": "<id>",
      "category": "duplication|contradiction|gap|dependency_violation",
      "severity": "low|medium|high|critical",
      "explanation": "<why this is an issue>"
    }
  ]
}

ARTIFACTS:
---
${allArtifactsFormatted}
`

describe('Experiment 3: LLM Full-Context Detection', () => {
  for (let run = 0; run < 5; run++) {
    it(`run ${run + 1}: full-context coherence review`, async () => {
      const shuffledArtifacts = shuffleArtifacts(allArtifacts, run) // vary ordering
      const response = await llm.complete(buildPrompt(shuffledArtifacts))
      const found = parseIssues(response)
      const { tp, fp, fn } = scoreAgainstGroundTruth(found, groundTruth)

      console.log(`Run ${run + 1} | Found=${found.length} TP=${tp} FP=${fp} FN=${fn}`)
    })
  }
})
```

---

### 5.5 Experiment 4: Hybrid Pipeline Precision

**Question:** Does the Layer 1→2 hybrid pipeline catch more issues than either approach alone?

**Method:**
1. Run Layer 1 (embedding) on all 50 artifacts at the current 0.70 threshold
2. For candidates above 0.70, run Layer 2 (LLM review) with full artifact content
3. Separately, run Layer 1c (periodic LLM sweep on the full corpus)
4. Compare:
   - Layer 1 only: which issues are surfaced?
   - Layer 1 + Layer 2: which issues survive LLM verification?
   - Layer 1 + Layer 2 + Layer 1c: what does the LLM sweep catch that embeddings missed?
   - LLM-only (Experiment 3): baseline comparison

**Expected output:**

```
Approach                  | TP | FP | FN | Precision | Recall | F1   | Cost/Scan
--------------------------|----|----|----|-----------+--------+------+---------
Embedding only (≥0.70)    |  8 |  4 |  7 | 0.67      | 0.53   | 0.59 | $0.001
Embedding (≥0.70) + L2    |  7 |  1 |  8 | 0.88      | 0.47   | 0.61 | $0.01
Embedding + L2 + LLM sweep|  12|  2 |  3 | 0.86      | 0.80   | 0.83 | $0.16
LLM only (full context)   |  9 |  2 |  6 | 0.82      | 0.60   | 0.69 | $0.15
```

**What we learn:** Whether the hybrid approach outperforms either approach alone, and what Layer 1c (LLM sweep) adds relative to its cost.

---

### 5.6 Experiment 5: Positional Bias in LLM Detection

**Question:** Does the LLM miss coherence issues between artifacts placed in the middle of a long context?

**Method:**
1. Take 3 known coherence issue pairs (easy, medium, hard difficulty)
2. For each pair, create 5 context configurations:
   - Both artifacts at the **start** of context
   - Both at the **end**
   - Both in the **middle**
   - One at start, one at end (maximum separation)
   - One at start, one in middle
3. Surround with 30--40 distractor artifacts
4. Ask the LLM to find coherence issues
5. Measure detection rate per configuration

**Expected output:**

```
Issue Difficulty | Start-Start | End-End | Mid-Mid | Start-End | Start-Mid
----------------|-------------|---------|---------|-----------|----------
Easy             | 5/5         | 5/5     | 4/5     | 5/5       | 4/5
Medium           | 5/5         | 4/5     | 2/5     | 3/5       | 3/5
Hard             | 4/5         | 3/5     | 1/5     | 2/5       | 2/5
```

**What we learn:** The severity of positional bias for our specific task. If mid-mid detection rates are significantly lower, it validates the embedding pre-filter's role (embeddings have no positional bias).

---

### 5.7 Synthetic Corpus Specification

To run these experiments, we need a reproducible synthetic corpus. Here's the specification:

#### Workstream Layout

| Workstream | Focus | Artifact Count |
|-----------|-------|:-:|
| `ws-backend` | API server, data models | 12 |
| `ws-frontend` | UI components, state management | 10 |
| `ws-infra` | Deployment configs, CI/CD | 8 |
| `ws-docs` | User documentation, API docs | 10 |
| `ws-research` | Technical research, benchmarks | 10 |

#### Planted Issues (Ground Truth)

| # | Type | Artifacts | Kind | Description |
|---|------|----------|------|-------------|
| 1 | Near-identical file | `ws-backend/utils.ts` vs `ws-frontend/helpers.ts` | code | 90% identical utility files |
| 2 | Near-identical file | `ws-backend/validation.ts` vs `ws-infra/validate.ts` | code | Same validation logic |
| 3 | Near-identical config | `ws-backend/.env` vs `ws-infra/.env` | config | Same env vars, different values |
| 4 | Buried function dupe | `ws-backend/auth-handler.ts` (500 lines) vs `ws-frontend/api-client.ts` (400 lines) | code | Both contain `parseJWT()` |
| 5 | Buried function dupe | `ws-backend/db-queries.ts` (600 lines) vs `ws-infra/migration.ts` (300 lines) | code | Both contain `normalizeTimestamp()` |
| 6 | Buried function dupe | `ws-frontend/form-utils.ts` (400 lines) vs `ws-docs/examples.ts` (200 lines) | code | Both contain `validateEmail()` |
| 7 | Thematic overlap | `ws-research/caching-strategies.md` vs `ws-docs/performance-guide.md` | research/doc | Both discuss Redis caching |
| 8 | Thematic overlap | `ws-research/auth-comparison.md` vs `ws-docs/security-overview.md` | research/doc | Both analyze OAuth vs JWT |
| 9 | Contradictory decision | `ws-backend/adr-003.md` vs `ws-frontend/adr-001.md` | decision_record | Backend chose REST, frontend expects GraphQL |
| 10 | Contradictory decision | `ws-infra/adr-002.md` vs `ws-backend/adr-004.md` | decision_record | Infra chose Postgres 15, backend assumes Postgres 16 features |
| 11 | Config drift | `ws-backend/tsconfig.json` vs `ws-frontend/tsconfig.json` | config | Different `target` and `lib` settings |
| 12 | Config drift | `ws-backend/eslint.config.js` vs `ws-frontend/eslint.config.js` | config | Contradictory rules |
| 13 | Same conclusion, different framing | `ws-research/scaling-report.md` vs `ws-docs/capacity-plan.md` | doc | Both conclude "need 3x more cache" but written independently |
| 14 | API contract mismatch | `ws-backend/api-spec.ts` vs `ws-frontend/api-types.ts` | code | Different response shapes for same endpoint |
| 15 | Dependency violation | `ws-frontend/package.json` vs `ws-backend/package.json` | config | Frontend imports a backend-internal module |

#### Clean Artifacts (No Issues)

35 additional artifacts with no cross-workstream coherence issues. Mix of code (15), documents (10), configs (5), research (5). These must be semantically distinct enough to not trigger false positives but realistic enough to serve as plausible distractors.

---

## 6. Implementation Plan

### Phase 1: Corpus Generation (1 session)

Create `server/test/experiments/corpus/` with:
- 50 synthetic artifact files matching the specification above
- `ground-truth.json` mapping pair keys to expected issues
- `corpus-manifest.json` listing all artifacts with metadata

### Phase 2: Experiment Harness (1 session)

Create `server/test/experiments/` with:
- `experiment-harness.ts` -- shared utilities for loading corpus, scoring results, formatting output
- `experiment-1-threshold.test.ts` through `experiment-5-positional.test.ts`
- Feature-flagged to use real embedding service (requires API key) or mock

### Phase 3: Execution & Analysis (1-2 sessions)

- Run experiments with real embedding models (requires API keys)
- Run experiments with real LLMs (requires API keys)
- Collect results into `server/test/experiments/results/`
- Analyze and update the embedding evaluation report with empirical data

### Cost Estimate for Running All Experiments

| Experiment | Embedding Cost | LLM Cost | Total |
|-----------|---------------:|----------:|------:|
| 1: Threshold sensitivity | ~$0.05 (50 artifacts × 3 models) | $0 | $0.05 |
| 2: Dilution curve | ~$0.02 (6 sizes × 3 models) | $0 | $0.02 |
| 3: LLM full-context | $0 | ~$2.50 (5 runs × ~100K tokens) | $2.50 |
| 4: Hybrid pipeline | ~$0.05 | ~$1.00 | $1.05 |
| 5: Positional bias | $0 | ~$3.00 (15 configs × ~100K tokens) | $3.00 |
| **Total** | **~$0.12** | **~$6.50** | **~$6.62** |

---

## 7. Summary

| Question | Answer |
|----------|--------|
| **Can LLMs replace embedding pre-filtering?** | Not reliably at scale. Lost-in-the-middle and NoLiMa research shows semantic detection degrades in long contexts. Embeddings provide position-independent, deterministic, incremental comparison. |
| **Is the embedding pre-filter worth its complexity?** | Yes, for three reasons: (1) it makes Layer 2 work better by filtering noise, (2) it solves the positional attention problem, (3) it scales to O(N²) comparisons that LLMs can't do in a single pass. |
| **Should we add a periodic LLM sweep (Layer 1c)?** | Probably, to catch false negatives from embedding dilution. But only when corpus <200K tokens. |
| **Does OpenAI's enterprise offering replace Phase 3A?** | No. No vendor offers coherence monitoring. OpenAI File Search is a retrieval tool, not a comparison tool. Our three-layer architecture is differentiated. |
| **What should we validate empirically?** | Threshold sensitivity, dilution curves, LLM-only ceiling, hybrid vs. standalone precision, and positional bias severity. The 5 experiments above will answer these quantitatively. |

---

## Sources

### Academic Papers
- [Li et al., "RAG or Long-Context LLMs?" (EMNLP 2024)](https://arxiv.org/abs/2407.16833)
- [Modarressi et al., "NoLiMa" (ICML 2025)](https://arxiv.org/abs/2502.05167)
- [Liu et al., "Lost in the Middle" (TACL 2024)](https://arxiv.org/abs/2307.03172)
- ["Long-Context LLMs Meet RAG" (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/5df5b1f121c915d8bdd00db6aac20827-Paper-Conference.pdf)
- [LaRA Benchmark (ICML 2025)](https://openreview.net/forum?id=CLF25dahgA)
- [LLM2Vec (arXiv:2404.05961)](https://arxiv.org/abs/2404.05961)
- [NV-Embed (arXiv:2405.17428)](https://arxiv.org/abs/2405.17428)

### Industry Research
- [Chroma "Context Rot" (July 2025)](https://research.trychroma.com/context-rot)
- [Databricks Long-Context RAG Study](https://www.databricks.com/blog/long-context-rag-performance-llms)
- [Anthropic Contextual Retrieval (September 2024)](https://www.anthropic.com/news/contextual-retrieval)
- [Anthropic Long Context Prompting](https://www.anthropic.com/news/claude-2-1-prompting)
- [Pinecone "Less is More"](https://www.pinecone.io/blog/why-use-retrieval-instead-of-larger-context/)
- [RAGFlow 2025 Year-End Review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)

### OpenAI Frontier
- [Introducing OpenAI Frontier](https://openai.com/index/introducing-openai-frontier/)
- [OpenAI Frontier Product Page](https://openai.com/business/frontier/)
- [OpenAI launches new enterprise platform (CNBC)](https://www.cnbc.com/2026/02/05/open-ai-frontier-enterprise-customers.html)
- [OpenAI launches Frontier (TechCrunch)](https://techcrunch.com/2026/02/05/openai-launches-a-way-for-enterprises-to-build-and-manage-ai-agents/)
- [OpenAI Frontier: Complete Guide (ALM Corp)](https://almcorp.com/blog/openai-frontier-enterprise-ai-agent-platform-guide/)
- [An honest OpenAI Frontier review (eesel.ai)](https://www.eesel.ai/blog/openai-frontier-review)
- [OpenAI Frontier: Enterprise AI Agent Platform Guide (NxCode)](https://www.nxcode.io/resources/news/openai-frontier-enterprise-ai-agent-platform-guide-2026)
- [OpenAI Frontier reshapes enterprise software (Fortune)](https://fortune.com/2026/02/05/openai-frontier-ai-agent-platform-enterprises-challenges-saas-salesforce-workday/)

### Other Product Documentation
- [Google Gemini Long Context Docs](https://ai.google.dev/gemini-api/docs/long-context)
- [Claude Connectors](https://claude.com/connectors)
- [Cohere Embed v4](https://cohere.com/embed)
- [OpenAI Agents SDK: Multi-Agent Orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK: Sessions & Memory](https://openai.github.io/openai-agents-python/sessions/)
