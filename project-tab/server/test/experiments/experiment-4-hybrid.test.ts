/**
 * Experiment 4: Hybrid Pipeline Comparison
 *
 * Compares 4 detection approaches, run in parallel:
 *   A. Embedding-only (Layer 1a, threshold 0.70)
 *   B. Embedding + Layer 2 (LLM review of candidates)
 *   C. Full hybrid (Layers 1a + 1b + 1c + 2)
 *   D. LLM-only (sweepCorpus on full corpus)
 *
 * Gate: VOYAGE_API_KEY + ANTHROPIC_API_KEY required
 * API cost: ~$1.05 (first run; cached thereafter)
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor.js'
import { VoyageEmbeddingService } from '../../src/intelligence/voyage-embedding-service.js'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
import { CachedEmbeddingService, CachedLlmService } from './experiment-cache.js'
import type { LlmSweepArtifact } from '../../src/intelligence/coherence-review-service.js'
import {
  loadCorpus,
  loadGroundTruth,
  toArtifactEvent,
  buildArtifactProvider,
  buildContentProvider,
  makePairKey,
  scoreDetections,
  writeResult,
  type CorpusArtifact,
  type GroundTruthIssue,
  type ScoringResult,
} from './experiment-harness.js'

const useOpenAi = process.env.EXPERIMENT_PROVIDER === 'openai'
const llmApiKey = useOpenAi ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
const llmProvider = useOpenAi ? 'openai' : 'anthropic'
const llmModel = useOpenAi ? 'gpt-5.2' : 'claude-sonnet-4-6'

describe.skipIf(!process.env.VOYAGE_API_KEY || !llmApiKey)(
  'Experiment 4: Hybrid Pipeline Comparison',
  () => {
    let corpus: CorpusArtifact[]
    let groundTruth: GroundTruthIssue[]
    let voyageService: CachedEmbeddingService
    let llmService: CachedLlmService

    beforeAll(() => {
      corpus = loadCorpus()
      groundTruth = loadGroundTruth()

      const rawVoyage = new VoyageEmbeddingService({
        apiKey: process.env.VOYAGE_API_KEY!,
      })
      voyageService = new CachedEmbeddingService(rawVoyage, 'voyage-4-lite')

      const rawLlm = new LlmReviewService({
        apiKey: llmApiKey!,
        provider: llmProvider as 'anthropic' | 'openai',
        model: llmModel,
        maxTokens: useOpenAi ? 16000 : 8192,
      })
      llmService = new CachedLlmService(rawLlm, llmModel)
    })

    it('compares 4 detection approaches in parallel', async () => {
      const artifactProvider = buildArtifactProvider(corpus)
      const contentProvider = buildContentProvider(corpus)

      // Each approach gets its own monitor and runs independently
      const [resultA, resultB, resultC, resultD] = await Promise.all([
        // --- Approach A: Embedding-only ---
        (async (): Promise<['A_embedding_only', ScoringResult]> => {
          const monitor = new CoherenceMonitor({
            layer1AdvisoryThreshold: 0.70,
            enableLayer2: false,
            enableLayer1c: false,
          })
          monitor.setEmbeddingService(voyageService)

          for (const a of corpus) {
            monitor.processArtifact(toArtifactEvent(a))
          }

          const candidates = await monitor.runLayer1Scan(1, artifactProvider, contentProvider)

          const detectedPairs = candidates.map(c => ({
            artifactIdA: c.artifactIdA,
            artifactIdB: c.artifactIdB,
          }))

          return ['A_embedding_only', scoreDetections(detectedPairs, groundTruth)]
        })(),

        // --- Approach B: Embedding + Layer 2 ---
        (async (): Promise<['B_embedding_layer2', ScoringResult]> => {
          const monitor = new CoherenceMonitor({
            layer1AdvisoryThreshold: 0.70,
            enableLayer2: true,
            enableLayer1c: false,
            layer2MaxReviewsPerHour: 100,
            layer2Model: llmModel,
          })
          monitor.setEmbeddingService(voyageService)
          monitor.setReviewService(llmService)
          monitor.setArtifactContentProvider(contentProvider)

          for (const a of corpus) {
            monitor.processArtifact(toArtifactEvent(a))
          }

          await monitor.runLayer1Scan(1, artifactProvider, contentProvider)
          const reviewResults = await monitor.runLayer2Review(contentProvider)

          const confirmedPairs = reviewResults
            .filter(r => r.confirmed)
            .map(r => {
              const candidate = monitor.getCandidates().find(c => c.candidateId === r.candidateId)
              return candidate
                ? { artifactIdA: candidate.artifactIdA, artifactIdB: candidate.artifactIdB }
                : null
            })
            .filter((p): p is { artifactIdA: string; artifactIdB: string } => p !== null)

          return ['B_embedding_layer2', scoreDetections(confirmedPairs, groundTruth)]
        })(),

        // --- Approach C: Full hybrid (sweep → Layer 2 pipeline) ---
        (async (): Promise<['C_full_hybrid', ScoringResult]> => {
          const monitor = new CoherenceMonitor({
            layer1AdvisoryThreshold: 0.70,
            enableLayer2: true,
            enableLayer1c: true,
            layer2MaxReviewsPerHour: 100,
            layer1cScanIntervalTicks: 1,
            layer1cModel: llmModel,
            layer2Model: llmModel,
            skipLayer2ForEmbeddings: true,
          })
          monitor.setEmbeddingService(voyageService)
          monitor.setReviewService(llmService)
          monitor.setSweepService(llmService)
          monitor.setArtifactContentProvider(contentProvider)

          for (const a of corpus) {
            monitor.processArtifact(toArtifactEvent(a))
          }

          // Layer 1 scan (embeddings)
          await monitor.runLayer1Scan(1, artifactProvider, contentProvider)

          // Layer 1c sweep (produces candidates, not events)
          const listArtifacts = () => corpus.map(a => toArtifactEvent(a))
          await monitor.runLayer1cSweep(1, listArtifacts, contentProvider)

          // Layer 2 reviews all promoted candidates (from embeddings + sweep)
          // Loop until drained since sweep can produce many candidates
          let batch
          do {
            batch = await monitor.runLayer2Review(contentProvider)
          } while (batch.length > 0)

          // Collect confirmed pairs from detected issues
          const allPairs = new Map<string, { artifactIdA: string; artifactIdB: string }>()
          for (const issue of monitor.getDetectedIssues()) {
            if (issue.affectedArtifactIds.length >= 2) {
              const key = makePairKey(issue.affectedArtifactIds[0], issue.affectedArtifactIds[1])
              allPairs.set(key, {
                artifactIdA: issue.affectedArtifactIds[0],
                artifactIdB: issue.affectedArtifactIds[1],
              })
            }
          }

          return ['C_full_hybrid', scoreDetections([...allPairs.values()], groundTruth)]
        })(),

        // --- Approach D: LLM-only ---
        (async (): Promise<['D_llm_only', ScoringResult]> => {
          const artifacts: LlmSweepArtifact[] = corpus.map(a => ({
            artifactId: a.artifactId,
            workstream: a.workstream,
            content: a.content,
          }))

          const issues = await llmService.sweepCorpus({ artifacts })

          const detectedPairs = issues.map(i => ({
            artifactIdA: i.artifactIdA,
            artifactIdB: i.artifactIdB,
          }))

          return ['D_llm_only', scoreDetections(detectedPairs, groundTruth)]
        })(),
      ])

      const approaches = Object.fromEntries([resultA, resultB, resultC, resultD])

      // Always write results before asserting — this is empirical data
      writeResult({
        experimentId: 'experiment-4-hybrid',
        timestamp: new Date().toISOString(),
        duration: 0,
        data: {
          approaches: Object.fromEntries(
            Object.entries(approaches).map(([name, scoring]) => [
              name,
              {
                ...scoring,
                summary: `P=${(scoring.precision * 100).toFixed(1)}% R=${(scoring.recall * 100).toFixed(1)}% F1=${(scoring.f1 * 100).toFixed(1)}%`,
              },
            ])
          ),
        },
      })

      // Verify all 4 approaches ran (soft — relative performance is the real finding)
      expect(Object.keys(approaches).length).toBe(4)
    }, 600_000)
  }
)
