# Coherence Pipeline Experiment Results

## Background

The coherence monitor has a multi-layer detection pipeline:

- **Layer 0**: File/content hash conflicts (exact match)
- **Layer 1a**: Embedding similarity (Voyage `voyage-4-lite`, threshold 0.70)
- **Layer 1c**: LLM sweep — sends the full artifact corpus to an LLM to discover issues
- **Layer 2**: LLM review — reviews individual candidate pairs to confirm or dismiss

The experiment harness (`experiment-4-hybrid`) compares four approaches:

| Approach | Description |
|----------|-------------|
| **A** | Embedding-only (Layer 1a) |
| **B** | Embedding + Layer 2 (Layer 1a then L2 filter) |
| **C** | Full hybrid (Layer 1a + Layer 1c sweep + Layer 2) |
| **D** | LLM-only (Layer 1c sweep on full corpus, no embeddings) |

Ground truth: **15 known issues** in a synthetic corpus.

## Corpus

50 synthetic artifacts across 5 workstreams with 15 planted coherence issues:

| Workstream | Files | Agent |
|---|---|---|
| `ws-backend` | 12 | `agent-backend` |
| `ws-frontend` | 10 | `agent-frontend` |
| `ws-infra` | 8 | `agent-infra` |
| `ws-docs` | 10 | `agent-docs` |
| `ws-research` | 10 | `agent-research` |

The 15 planted issues span three difficulty tiers:

| Difficulty | Count | Detection strategy |
|---|---|---|
| Easy (1-3) | 3 | Embedding similarity alone (>0.85) |
| Medium (4-8) | 5 | Embedding + LLM review, or threshold tuning |
| Hard (9-15) | 7 | LLM-only (semantic contradictions, config drift) |

Issue categories include `duplication`, `contradiction`, and `dependency_violation`. See `corpus/ground-truth.json` for full details.

### Regenerating the corpus

The corpus files are committed as test fixtures. The generator script exists for reproducibility:

```bash
npx tsx test/experiments/corpus/generate-corpus.ts
```

Output is deterministic (seeded PRNG, seed 42). Running twice produces identical files.

---

## Quick Start

```bash
cd server

# Run with Voyage embeddings only (experiments 1 & 2)
VOYAGE_API_KEY=voy-xxx npx vitest run test/experiments/experiment-1-threshold.test.ts
VOYAGE_API_KEY=voy-xxx npx vitest run test/experiments/experiment-2-dilution.test.ts

# Run with Anthropic LLM only (experiments 3 & 5)
ANTHROPIC_API_KEY=sk-ant-xxx npx vitest run test/experiments/experiment-3-llm-context.test.ts
ANTHROPIC_API_KEY=sk-ant-xxx npx vitest run test/experiments/experiment-5-positional.test.ts

# Run the hybrid comparison (needs both keys)
VOYAGE_API_KEY=voy-xxx ANTHROPIC_API_KEY=sk-ant-xxx npx vitest run test/experiments/experiment-4-hybrid.test.ts

# Run all experiments at once
VOYAGE_API_KEY=voy-xxx ANTHROPIC_API_KEY=sk-ant-xxx npx vitest run test/experiments/
```

Without API keys, all experiments skip automatically and don't affect the main test suite.

## Individual Experiments

### Experiment 1: Threshold sensitivity (~$0.05, ~30s)

Embeds all 50 artifacts via Voyage, computes cross-workstream similarities, then sweeps thresholds from 0.50 to 0.90 and scores precision/recall/F1 at each.

**Key question:** What similarity threshold best balances false positives vs missed issues?

### Experiment 2: Dilution curve (~$0.02, ~30s)

Isolates `validateEmail()` (~50 tokens), embeds it, then wraps it in progressively larger files (100 to 5000 tokens) at three positions (start/middle/end). Measures how similarity degrades.

**Key question:** At what file size does embedding similarity drop below detection thresholds?

### Experiment 3: LLM full-context detection (~$2.50, ~5min)

Sends the full corpus to `sweepCorpus()` 5 times with different shuffled orderings. Computes mean/stddev for P/R/F1 and per-issue detection rate.

**Key question:** How consistently does the LLM detect issues across different artifact orderings?

### Experiment 4: Hybrid pipeline comparison (~$1.05, ~5min)

Compares 4 detection approaches on the same corpus:

| Approach | Layers used |
|---|---|
| A. Embedding-only | Layer 1a (threshold 0.70) |
| B. Embedding + Layer 2 | Layer 1a + LLM review |
| C. Full hybrid | Layer 1a + 1b + 1c + 2 |
| D. LLM-only | sweepCorpus (no embeddings) |

**Key question:** Does the hybrid pipeline outperform either approach alone?

### Experiment 5: Positional bias (~$3.00, ~10min)

Tests 3 representative issues (easy/medium/hard) in 5 positional configurations (start-start, end-end, mid-mid, start-end, start-mid) for 15 total LLM calls.

**Key question:** Does the LLM miss issues when the relevant artifacts are far apart in the context window?

### Estimated API costs

| Experiment | Voyage | Anthropic | Total |
|---|---|---|---|
| 1. Threshold | ~$0.05 | - | ~$0.05 |
| 2. Dilution | ~$0.02 | - | ~$0.02 |
| 3. LLM context | - | ~$2.50 | ~$2.50 |
| 4. Hybrid | ~$0.05 | ~$1.00 | ~$1.05 |
| 5. Positional | - | ~$3.00 | ~$3.00 |
| **Total** | **~$0.12** | **~$6.50** | **~$6.62** |

Results are written to `results/` as timestamped JSON files (gitignored). Each file contains the experiment ID, raw data, and scoring metrics.

---

## LLM Improvement Experiment Progression

The following phases document the iterative work to improve the hybrid pipeline (Approach C) beyond the embedding-only baseline (Approach A). All experiments used the experiment-4-hybrid harness against the same 15-issue ground truth corpus.

### Phase 1: Prompt Improvements (Sonnet 4.6, no thinking)

**Changes**: Added confidence tiers, exclusion rules to sweep prompt, sweep-to-L2 pipeline reordering.

**Results (Approach C)**:

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Precision | 47.8% | 56.3% | +8.5pp |
| Recall | 73.3% | 60.0% | -13.3pp |
| F1 | 57.9% | 58.1% | +0.2pp |
| False Positives | 12 | 7 | -5 |

Precision improved, but recall dropped. F1 barely changed.

---

### Phase 2: Adaptive Thinking (Sonnet 4.6)

**Changes**: Added `thinking: { type: "adaptive" }` to Anthropic API calls.

**Results**:

| Approach | P | R | F1 | TP | FP | Notes |
|----------|---|---|----|----|----|----|
| A (embedding-only) | 83.3% | 66.7% | 74.1% | 10 | 2 | Still the best |
| C (full hybrid) | 81.8% | 60.0% | 69.2% | 9 | 2 | Precision jumped |
| D (LLM-only) | 0% | 0% | 0% | 0 | 0 | Sweep returned ZERO results |

**Key finding**: Adaptive thinking killed the sweep entirely. The model became so conservative with extended thinking that it refused to flag anything. Meanwhile, L2 with thinking dismissed true positives from the embedding pipeline. A (no LLM at all) was still the best approach.

---

### Phase 3: Selective Thinking (Sonnet 4.6)

**Changes**: Disabled thinking for sweep calls, kept thinking enabled for Layer 2 review only.

**Results**:

| Approach | P | R | F1 | TP | FP | Notes |
|----------|---|---|----|----|----|----|
| A (embedding-only) | 83.3% | 66.7% | 74.1% | 10 | 2 | Still the best on F1 |
| C (full hybrid) | 55.0% | 73.3% | 62.9% | 11 | 9 | Sweep alive again, found issues 4, 5, 9, 15 |
| D (LLM-only) | 45.0% | 60.0% | 51.4% | 9 | 11 | Sweep producing results but noisy |

The sweep was alive again and finding issues that embeddings miss (4, 5, 9, 15). But A still had the best F1 because L2 was rejecting true embedding positives while passing sweep false positives through.

---

### Phase 4: Provider Switch to GPT-5.2

**Changes**: Switched LLM provider from Anthropic Sonnet 4.6 to OpenAI GPT-5.2 with `reasoning_effort: "medium"` for Layer 2, no reasoning for sweep.

> **Note**: GPT-5.2 requires `max_completion_tokens` (not `max_tokens`), and `temperature` is incompatible with `reasoning_effort`.

**Results**:

| Approach | P | R | F1 | TP | FP | Notes |
|----------|---|---|----|----|----|----|
| A (embedding-only) | 83.3% | 66.7% | 74.1% | 10 | 2 | Unchanged (no LLM) |
| B (embedding + L2) | 100% | 26.7% | 42.1% | 4 | 0 | Unchanged — same 4 confirmed |
| C (full hybrid) | 66.7% | 80.0% | 72.7% | 12 | 6 | First time C approached A's F1 |
| D (LLM-only) | 57.1% | 53.3% | 55.2% | 8 | 6 | Better precision than Sonnet sweep |

This was the first time Approach C came close to A's F1. GPT-5.2 produced a cleaner sweep and better L2 filtering than Sonnet 4.6.

---

### Phase 5: Layer 2 Architecture Experiments (GPT-5.2)

Tested three modifications to Layer 2 to push C beyond A.

#### Option 3 — Flip L2 default (presume confirmed, reject only with evidence)

| Approach | P | R | F1 | TP | FP |
|----------|---|---|----|----|-----|
| C | 65.0% | 86.7% | 74.3% | 13 | 7 |

Better recall than baseline, F1 slightly improved. But more false positives.

#### Option 1 — Skip L2 for embedding candidates (only filter sweep through L2)

| Approach | P | R | F1 | TP | FP |
|----------|---|---|----|----|-----|
| C | **73.7%** | **93.3%** | **82.4%** | 14 | 5 |

Only missed issue 6. **Highest F1, best balance of precision and recall.** This was the winning configuration.

#### Option 2 — Batch review with full corpus context

| Approach | P | R | F1 | TP | FP |
|----------|---|---|----|----|-----|
| C | 60.9% | 93.3% | 73.7% | 14 | 9 |

Matched recall but corpus context confused L2, letting through more false positives.

---

## Key Findings

1. **Embeddings are high-precision, low-recall.** Approach A consistently delivers P=83.3% R=66.7%. The 2 false positives (`doc-examples:res-error-handling`, `doc-capacity:res-caching`) are persistent across all runs. The 5 missed issues (4, 5, 6, 9, 15) require semantic understanding beyond embedding similarity.

2. **Layer 2 in its original form is harmful.** Approach B demonstrates this clearly — L2 takes A's 10 true positives and throws away 6, keeping only 4. It is too conservative when reviewing pairs in isolation.

3. **The sweep adds genuine recall.** Issues 4, 5, 9, and 15 are consistently found by the sweep but never by embeddings. Issue 6 is missed by everything.

4. **Thinking/reasoning makes sweeps too conservative.** Both Anthropic adaptive thinking and deep reasoning cause the sweep to return empty results. The sweep works best as a quick, broad scan without extended reasoning.

5. **L2 with reasoning is a good filter for sweep noise.** When restricted to only sweep candidates, L2 with reasoning effectively filters false positives (5 FP in Option 1 vs 7-9 FP in other approaches).

6. **Don't second-guess high-quality signals.** The winning architecture trusts embedding candidates (auto-emit) and only uses L2 to vet the noisier sweep results.

7. **GPT-5.2 outperforms Sonnet 4.6 for this task.** Better sweep precision, faster (~2 min vs 5-7 min), and likely cheaper.

---

## Chosen Solution: Option 1 (`skipLayer2ForEmbeddings`)

### Architecture

```
Artifacts
  |
  |---> Layer 1a (embeddings, threshold 0.70)
  |       |
  |       '---> Auto-confirmed ---> Emit issue (no L2 review)
  |
  '---> Layer 1c (LLM sweep, NO reasoning/thinking)
          |
          '---> Layer 2 (LLM review, WITH reasoning, GPT-5.2 medium effort)
                  |
                  |---> Confirmed ---> Emit issue
                  '---> Dismissed ---> Drop
```

### Configuration

```typescript
// CoherenceMonitor config
{
  skipLayer2ForEmbeddings: true
}

// Sweep call: no reasoning (maximum recall)
// Layer 2 call: reasoning_effort "medium" (precision filtering)
```

### Performance

| Metric | Value |
|--------|-------|
| Precision | 73.7% |
| Recall | 93.3% |
| F1 | 82.4% |
| True Positives | 14 / 15 |
| False Positives | 5 |
| False Negatives | 1 |

---

## Remaining Gaps

- **Issue 6** is missed by all approaches — may need a different detection strategy or richer corpus representation.
- **2 embedding false positives** (`doc-examples:res-error-handling`, `doc-capacity:res-caching`) persist — could be addressed with a post-filter or embedding threshold tuning.
- **3 sweep false positives** (`be-adr-004:inf-ci-pipeline`, `be-adr-004:inf-docker-compose`, `be-router:inf-dockerfile`) survive L2 — room for prompt improvement.
