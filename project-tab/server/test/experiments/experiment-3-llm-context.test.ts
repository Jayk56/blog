/**
 * Experiment 3: LLM Full-Context Detection
 *
 * Sends the full corpus to the LLM sweep service 5 times with different
 * orderings to measure detection consistency across artifact positions.
 *
 * Gate: ANTHROPIC_API_KEY required
 * API cost: ~$2.50
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
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

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Experiment 3: LLM Full-Context Detection', () => {
  let corpus: CorpusArtifact[]
  let groundTruth: GroundTruthIssue[]
  let llmService: LlmReviewService

  beforeAll(() => {
    corpus = loadCorpus()
    groundTruth = loadGroundTruth()
    llmService = new LlmReviewService({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })
  })

  it('should detect at least one ground truth issue across runs', async () => {
    const runResults: Array<{
      runIndex: number
      seed: number
      issues: LlmSweepIssue[]
      scoring: ScoringResult
    }> = []

    for (let runIndex = 0; runIndex < NUM_RUNS; runIndex++) {
      const seed = 42 + runIndex
      const shuffled = seededShuffle(corpus, seed)

      const artifacts: LlmSweepArtifact[] = shuffled.map(a => ({
        artifactId: a.artifactId,
        workstream: a.workstream,
        content: a.content,
      }))

      const issues = await llmService.sweepCorpus({ artifacts })

      const detectedPairs = issues.map(i => ({
        artifactIdA: i.artifactIdA,
        artifactIdB: i.artifactIdB,
      }))

      const scoring = scoreDetections(detectedPairs, groundTruth)

      runResults.push({ runIndex, seed, issues, scoring })
    }

    // At least one run should detect at least one issue
    const bestRecall = Math.max(...runResults.map(r => r.scoring.recall))
    expect(bestRecall).toBeGreaterThan(0)

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
  }, 600_000)
})
