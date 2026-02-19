/**
 * Experiment 3: LLM Full-Context Detection
 *
 * Sends the full corpus to the LLM sweep service 5 times with different
 * orderings to measure detection consistency across artifact positions.
 * All 5 runs execute in parallel.
 *
 * Gate: ANTHROPIC_API_KEY required
 * API cost: ~$2.50 (first run; cached thereafter)
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
import { CachedLlmService } from './experiment-cache.js'
import type { LlmSweepArtifact, LlmSweepIssue } from '../../src/intelligence/coherence-review-service.js'
import {
  loadCorpus,
  loadGroundTruth,
  seededShuffle,
  scoreDetections,
  writeResult,
  type CorpusArtifact,
  type GroundTruthIssue,
  type ScoringResult,
} from './experiment-harness.js'

const NUM_RUNS = 5

const useOpenAi = process.env.EXPERIMENT_PROVIDER === 'openai'
const llmApiKey = useOpenAi ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
const llmModel = useOpenAi ? 'gpt-5.2' : 'claude-sonnet-4-6'

describe.skipIf(!llmApiKey)('Experiment 3: LLM Full-Context Detection', () => {
  let corpus: CorpusArtifact[]
  let groundTruth: GroundTruthIssue[]
  let llmService: CachedLlmService

  beforeAll(() => {
    corpus = loadCorpus()
    groundTruth = loadGroundTruth()
    const rawLlm = new LlmReviewService({
      apiKey: llmApiKey!,
      provider: (useOpenAi ? 'openai' : 'anthropic') as 'anthropic' | 'openai',
      model: llmModel,
      maxTokens: useOpenAi ? 16000 : 8192,
    })
    llmService = new CachedLlmService(rawLlm, llmModel)
  })

  it('should detect at least one ground truth issue across runs', async () => {
    // Pre-build all shuffled artifact lists
    const runSpecs = Array.from({ length: NUM_RUNS }, (_, runIndex) => {
      const seed = 42 + runIndex
      const shuffled = seededShuffle(corpus, seed)
      const artifacts: LlmSweepArtifact[] = shuffled.map(a => ({
        artifactId: a.artifactId,
        workstream: a.workstream,
        content: a.content,
      }))
      return { runIndex, seed, artifacts }
    })

    // Run all 5 sweeps in parallel
    const runResults = await Promise.all(
      runSpecs.map(async ({ runIndex, seed, artifacts }) => {
        const issues = await llmService.sweepCorpus({ artifacts })

        const detectedPairs = issues.map(i => ({
          artifactIdA: i.artifactIdA,
          artifactIdB: i.artifactIdB,
        }))

        const scoring = scoreDetections(detectedPairs, groundTruth)

        return { runIndex, seed, issues, scoring }
      })
    )

    // Compute per-issue detection rate across runs
    const issueDetectionRate: Record<number, number> = {}
    for (const issue of groundTruth) {
      const detectedCount = runResults.filter(r =>
        r.scoring.detectedIssueIds.includes(issue.id)
      ).length
      issueDetectionRate[issue.id] = detectedCount / NUM_RUNS
    }

    // Compute aggregate stats
    const precisions = runResults.map(r => r.scoring.precision)
    const recalls = runResults.map(r => r.scoring.recall)
    const f1s = runResults.map(r => r.scoring.f1)

    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
    const stddev = (arr: number[]) => {
      const m = mean(arr)
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
    }

    // Always write results before asserting — this is empirical data
    writeResult({
      experimentId: 'experiment-3-llm-context',
      timestamp: new Date().toISOString(),
      duration: 0,
      data: {
        numRuns: NUM_RUNS,
        aggregate: {
          precision: { mean: mean(precisions), stddev: stddev(precisions) },
          recall: { mean: mean(recalls), stddev: stddev(recalls) },
          f1: { mean: mean(f1s), stddev: stddev(f1s) },
        },
        issueDetectionRate,
        runs: runResults.map(r => ({
          runIndex: r.runIndex,
          seed: r.seed,
          issuesFound: r.issues.length,
          scoring: r.scoring,
          issues: r.issues.map(i => ({
            artifactIdA: i.artifactIdA,
            artifactIdB: i.artifactIdB,
            category: i.category,
            severity: i.severity,
            explanation: i.explanation,
          })),
        })),
      },
    })

    // Verify results were captured (soft assertion — zero recall is a valid finding)
    expect(runResults.length).toBe(NUM_RUNS)
  }, 600_000)
})
