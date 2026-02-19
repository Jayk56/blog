/**
 * Experiment 4: Hybrid Pipeline Comparison
 *
 * Compares 4 detection approaches:
 *   A. Embedding-only (Layer 1a, threshold 0.70)
 *   B. Embedding + Layer 2 (LLM review of candidates)
 *   C. Full hybrid (Layers 1a + 1b + 1c + 2)
 *   D. LLM-only (sweepCorpus on full corpus)
 *
 * Gate: VOYAGE_API_KEY + ANTHROPIC_API_KEY required
 * API cost: ~$1.05
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor.js'
import { VoyageEmbeddingService } from '../../src/intelligence/voyage-embedding-service.js'
import { LlmReviewService } from '../../src/intelligence/llm-review-service.js'
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

describe.skipIf(!process.env.VOYAGE_API_KEY || !process.env.ANTHROPIC_API_KEY)(
  'Experiment 4: Hybrid Pipeline Comparison',
  () => {
    let corpus: CorpusArtifact[]
    let groundTruth: GroundTruthIssue[]
    let voyageService: VoyageEmbeddingService
    let llmService: LlmReviewService

    beforeAll(() => {
      corpus = loadCorpus()
      groundTruth = loadGroundTruth()

      voyageService = new VoyageEmbeddingService({
        apiKey: process.env.VOYAGE_API_KEY!,
      })

      llmService = new LlmReviewService({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      })
    })

    it('full hybrid recall >= embedding-only recall', async () => {
      const artifactProvider = buildArtifactProvider(corpus)
      const contentProvider = buildContentProvider(corpus)

      const approaches: Record<string, ScoringResult> = {}

      // --- Approach A: Embedding-only ---
      {
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

        approaches['A_embedding_only'] = scoreDetections(detectedPairs, groundTruth)
      }

      // --- Approach B: Embedding + Layer 2 ---
      {
        const monitor = new CoherenceMonitor({
          layer1AdvisoryThreshold: 0.70,
          enableLayer2: true,
          enableLayer1c: false,
          layer2MaxReviewsPerHour: 100,
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
            // Find the candidate that was reviewed
            const candidate = monitor.getCandidates().find(c => c.candidateId === r.candidateId)
            return candidate
              ? { artifactIdA: candidate.artifactIdA, artifactIdB: candidate.artifactIdB }
              : null
          })
          .filter((p): p is { artifactIdA: string; artifactIdB: string } => p !== null)

        approaches['B_embedding_layer2'] = scoreDetections(confirmedPairs, groundTruth)
      }

      // --- Approach C: Full hybrid ---
      {
        const monitor = new CoherenceMonitor({
          layer1AdvisoryThreshold: 0.70,
          enableLayer2: true,
          enableLayer1c: true,
          layer2MaxReviewsPerHour: 100,
          layer1cScanIntervalTicks: 1,
        })
        monitor.setEmbeddingService(voyageService)
        monitor.setReviewService(llmService)
        monitor.setSweepService(llmService)
        monitor.setArtifactContentProvider(contentProvider)

        for (const a of corpus) {
          monitor.processArtifact(toArtifactEvent(a))
        }

        await monitor.runLayer1Scan(1, artifactProvider, contentProvider)
        const reviewResults = await monitor.runLayer2Review(contentProvider)

        const listArtifacts = () => corpus.map(a => toArtifactEvent(a))
        const sweepIssues = await monitor.runLayer1cSweep(1, listArtifacts, contentProvider)

        // Union: confirmed L2 + L1c sweep issues
        const allPairs = new Map<string, { artifactIdA: string; artifactIdB: string }>()

        for (const r of reviewResults.filter(r => r.confirmed)) {
          const candidate = monitor.getCandidates().find(c => c.candidateId === r.candidateId)
          if (candidate) {
            const key = makePairKey(candidate.artifactIdA, candidate.artifactIdB)
            allPairs.set(key, { artifactIdA: candidate.artifactIdA, artifactIdB: candidate.artifactIdB })
          }
        }

        for (const issue of sweepIssues) {
          if (issue.affectedArtifactIds.length >= 2) {
            const key = makePairKey(issue.affectedArtifactIds[0], issue.affectedArtifactIds[1])
            allPairs.set(key, {
              artifactIdA: issue.affectedArtifactIds[0],
              artifactIdB: issue.affectedArtifactIds[1],
            })
          }
        }

        approaches['C_full_hybrid'] = scoreDetections([...allPairs.values()], groundTruth)
      }

      // --- Approach D: LLM-only ---
      {
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

        approaches['D_llm_only'] = scoreDetections(detectedPairs, groundTruth)
      }

      // Assertion: full hybrid >= embedding-only
      expect(approaches['C_full_hybrid'].recall).toBeGreaterThanOrEqual(
        approaches['A_embedding_only'].recall
      )

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
    }, 300_000)
  }
)
