/**
 * Experiment 5: Positional Bias
 *
 * Tests whether the LLM's ability to detect issues is affected by the
 * position of the target artifacts in the sweep corpus. Uses 3 representative
 * issues (easy/medium/hard) x 5 positional configurations = 15 LLM calls,
 * run in parallel.
 *
 * Gate: ANTHROPIC_API_KEY required
 * API cost: ~$2.50 (first run; cached thereafter)
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
import { CachedLlmService } from './experiment-cache.js'
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
  placeA: (totalSlots: number) => number
  placeB: (totalSlots: number) => number
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

interface RunSpec {
  issueId: number
  difficulty: string
  position: string
  artifacts: LlmSweepArtifact[]
  targetKey: string
}

const useOpenAi = process.env.EXPERIMENT_PROVIDER === 'openai'
const llmApiKey = useOpenAi ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
const llmModel = useOpenAi ? 'gpt-5.2' : 'claude-sonnet-4-6'

describe.skipIf(!llmApiKey)('Experiment 5: Positional Bias', () => {
  let corpus: CorpusArtifact[]
  let groundTruth: GroundTruthIssue[]
  let llmService: CachedLlmService
  let targetIssues: GroundTruthIssue[]

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
    targetIssues = TARGET_ISSUE_IDS.map(id => groundTruth.find(i => i.id === id)!)
  })

  it('should produce results for all position configurations', async () => {
    const rng = mulberry32(42)

    // Pre-build all run specs so the RNG sequence is deterministic
    const specs: RunSpec[] = []

    for (const issue of targetIssues) {
      const targetA = corpus.find(a => a.artifactId === issue.artifactIdA)!
      const targetB = corpus.find(a => a.artifactId === issue.artifactIdB)!

      const distractors = corpus.filter(
        a => a.artifactId !== issue.artifactIdA && a.artifactId !== issue.artifactIdB
      )

      for (const config of POSITIONAL_CONFIGS) {
        const shuffledDistractors = [...distractors]
        for (let i = shuffledDistractors.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[shuffledDistractors[i], shuffledDistractors[j]] = [shuffledDistractors[j], shuffledDistractors[i]]
        }

        const totalSlots = 50
        const selectedDistractors = shuffledDistractors.slice(0, totalSlots - 2)

        const slots: LlmSweepArtifact[] = selectedDistractors.map(a => ({
          artifactId: a.artifactId,
          workstream: a.workstream,
          content: a.content,
        }))

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

        const [firstPos, firstArt, secondPos, secondArt] =
          posA <= posB
            ? [posA, artA, posB, artB]
            : [posB, artB, posA, artA]

        slots.splice(Math.min(secondPos, slots.length), 0, secondArt)
        slots.splice(Math.min(firstPos, slots.length), 0, firstArt)

        specs.push({
          issueId: issue.id,
          difficulty: issue.difficulty,
          position: config.name,
          artifacts: slots,
          targetKey: makePairKey(issue.artifactIdA, issue.artifactIdB),
        })
      }
    }

    // Run all 9 sweeps in parallel
    const results = await Promise.all(
      specs.map(async (spec) => {
        const issues = await llmService.sweepCorpus({ artifacts: spec.artifacts })
        const detected = issues.some(
          i => makePairKey(i.artifactIdA, i.artifactIdB) === spec.targetKey
        )
        return {
          issueId: spec.issueId,
          difficulty: spec.difficulty,
          position: spec.position,
          detected,
          rawIssueCount: issues.length,
        }
      })
    )

    // Build summary table
    const summary: Record<string, Record<string, boolean>> = {}
    for (const result of results) {
      const key = `issue_${result.issueId}_${result.difficulty}`
      if (!summary[key]) summary[key] = {}
      summary[key][result.position] = result.detected
    }

    // Always write results before asserting
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
        detectionGrid: results,
        summary,
        detectionRateByDifficulty: TARGET_ISSUE_IDS.map(id => {
          const issueResults = results.filter(r => r.issueId === id)
          const rate = issueResults.filter(r => r.detected).length / issueResults.length
          return {
            issueId: id,
            difficulty: issueResults[0]?.difficulty,
            detectionRate: rate,
            detectedPositions: issueResults.filter(r => r.detected).map(r => r.position),
          }
        }),
      },
    })

    // Verify all 9 configurations ran
    expect(results.length).toBe(TARGET_ISSUE_IDS.length * POSITIONAL_CONFIGS.length)
  }, 600_000)
})
