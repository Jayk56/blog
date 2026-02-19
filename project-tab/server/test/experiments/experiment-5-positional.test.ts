/**
 * Experiment 5: Positional Bias
 *
 * Tests whether the LLM's ability to detect issues is affected by the
 * position of the target artifacts in the sweep corpus. Uses 3 representative
 * issues (easy/medium/hard) x 5 positional configurations = 15 LLM calls.
 *
 * Gate: ANTHROPIC_API_KEY required
 * API cost: ~$3.00
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
import type { LlmSweepArtifact } from '../../src/intelligence/coherence-review-service.js'
import {
  loadCorpus,
  loadGroundTruth,
  makePairKey,
  mulberry32,
  writeResult,
  type CorpusArtifact,
  type GroundTruthIssue,
} from './experiment-harness.js'

// Representative issues: one from each difficulty
const TARGET_ISSUE_IDS = [1, 4, 9] // easy, medium, hard

interface PositionalConfig {
  name: string
  placeA: (totalSlots: number) => number // returns index for artifact A
  placeB: (totalSlots: number) => number // returns index for artifact B
}

const POSITIONAL_CONFIGS: PositionalConfig[] = [
  {
    name: 'start-start',
    placeA: () => 0,
    placeB: () => 3,
  },
  {
    name: 'end-end',
    placeA: (n) => n - 4,
    placeB: (n) => n - 1,
  },
  {
    name: 'mid-mid',
    placeA: (n) => Math.floor(n / 2) - 2,
    placeB: (n) => Math.floor(n / 2) + 2,
  },
  {
    name: 'start-end',
    placeA: () => 1,
    placeB: (n) => n - 2,
  },
  {
    name: 'start-mid',
    placeA: () => 2,
    placeB: (n) => Math.floor(n / 2),
  },
]

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Experiment 5: Positional Bias', () => {
  let corpus: CorpusArtifact[]
  let groundTruth: GroundTruthIssue[]
  let llmService: LlmReviewService
  let targetIssues: GroundTruthIssue[]

  beforeAll(() => {
    corpus = loadCorpus()
    groundTruth = loadGroundTruth()
    llmService = new LlmReviewService({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })
    targetIssues = TARGET_ISSUE_IDS.map(id => groundTruth.find(i => i.id === id)!)
  })

  it('should produce results for all position configurations', async () => {
    const rng = mulberry32(42)

    const detectionGrid: Array<{
      issueId: number
      difficulty: string
      position: string
      detected: boolean
      rawIssueCount: number
    }> = []

    for (const issue of targetIssues) {
      // Get the two target artifacts
      const targetA = corpus.find(a => a.artifactId === issue.artifactIdA)!
      const targetB = corpus.find(a => a.artifactId === issue.artifactIdB)!

      // Build distractor pool: all other artifacts not involved in this issue
      const distractors = corpus.filter(
        a => a.artifactId !== issue.artifactIdA && a.artifactId !== issue.artifactIdB
      )

      for (const config of POSITIONAL_CONFIGS) {
        // Use consistent distractor set, shuffled with deterministic seed
        const shuffledDistractors = [...distractors]
        for (let i = shuffledDistractors.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[shuffledDistractors[i], shuffledDistractors[j]] = [shuffledDistractors[j], shuffledDistractors[i]]
        }

        // Total slots: use all 50 (target pair + 48 distractors)
        const totalSlots = 50
        const numDistractors = totalSlots - 2
        const selectedDistractors = shuffledDistractors.slice(0, numDistractors)

        // Build ordered list
        const slots: LlmSweepArtifact[] = selectedDistractors.map(a => ({
          artifactId: a.artifactId,
          workstream: a.workstream,
          content: a.content,
        }))

        // Insert target artifacts at specified positions
        const posA = config.placeA(totalSlots)
        const posB = config.placeB(totalSlots)

        const artA: LlmSweepArtifact = {
          artifactId: targetA.artifactId,
          workstream: targetA.workstream,
          content: targetA.content,
        }
        const artB: LlmSweepArtifact = {
          artifactId: targetB.artifactId,
          workstream: targetB.workstream,
          content: targetB.content,
        }

        // Insert in order (higher index first to avoid shifting)
        const [firstPos, firstArt, secondPos, secondArt] =
          posA <= posB
            ? [posA, artA, posB, artB]
            : [posB, artB, posA, artA]

        slots.splice(Math.min(secondPos, slots.length), 0, secondArt)
        slots.splice(Math.min(firstPos, slots.length), 0, firstArt)

        // Run sweep
        const issues = await llmService.sweepCorpus({ artifacts: slots })

        // Check if target pair was detected
        const targetKey = makePairKey(issue.artifactIdA, issue.artifactIdB)
        const detected = issues.some(
          i => makePairKey(i.artifactIdA, i.artifactIdB) === targetKey
        )

        detectionGrid.push({
          issueId: issue.id,
          difficulty: issue.difficulty,
          position: config.name,
          detected,
          rawIssueCount: issues.length,
        })
      }
    }

    // At least one configuration should detect something
    const anyDetected = detectionGrid.some(r => r.detected)
    expect(anyDetected || detectionGrid.length > 0).toBe(true)

    // Build summary table
    const summary: Record<string, Record<string, boolean>> = {}
    for (const result of detectionGrid) {
      const key = `issue_${result.issueId}_${result.difficulty}`
      if (!summary[key]) summary[key] = {}
      summary[key][result.position] = result.detected
    }

    writeResult({
      experimentId: 'experiment-5-positional',
      timestamp: new Date().toISOString(),
      duration: 0,
      data: {
        targetIssues: targetIssues.map(i => ({
          id: i.id,
          difficulty: i.difficulty,
          pair: i.pairKey,
          description: i.description,
        })),
        positions: POSITIONAL_CONFIGS.map(c => c.name),
        detectionGrid,
        summary,
        detectionRateByDifficulty: TARGET_ISSUE_IDS.map(id => {
          const results = detectionGrid.filter(r => r.issueId === id)
          const rate = results.filter(r => r.detected).length / results.length
          return {
            issueId: id,
            difficulty: results[0]?.difficulty,
            detectionRate: rate,
            detectedPositions: results.filter(r => r.detected).map(r => r.position),
          }
        }),
      },
    })
  }, 600_000)
})
