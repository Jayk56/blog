/**
 * Experiment 1: Threshold Sensitivity
 *
 * Sweeps similarity thresholds from 0.50 to 0.90 against all cross-workstream
 * pairs to find the optimal precision/recall tradeoff for embedding-based detection.
 *
 * Gate: VOYAGE_API_KEY required
 * API cost: ~$0.05
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { VoyageEmbeddingService } from '../../src/intelligence/voyage-embedding-service.js'
import { cosineSimilarity } from '../../src/intelligence/embedding-service.js'
import {
  loadCorpus,
  loadGroundTruth,
  makePairKey,
  scoreDetections,
  writeResult,
  type CorpusArtifact,
  type GroundTruthIssue,
} from './experiment-harness.js'

const THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]

describe.skipIf(!process.env.VOYAGE_API_KEY)('Experiment 1: Threshold Sensitivity', () => {
  let corpus: CorpusArtifact[]
  let groundTruth: GroundTruthIssue[]
  let embeddings: Map<string, number[]>
  let crossWorkstreamSimilarities: Map<string, number>

  beforeAll(async () => {
    corpus = loadCorpus()
    groundTruth = loadGroundTruth()

    const voyageService = new VoyageEmbeddingService({
      apiKey: process.env.VOYAGE_API_KEY!,
    })

    // Embed all 50 artifacts
    const texts = corpus.map(a => a.content)
    const vectors = await voyageService.embedBatch(texts)

    embeddings = new Map()
    for (let i = 0; i < corpus.length; i++) {
      embeddings.set(corpus[i].artifactId, vectors[i])
    }

    // Compute all cross-workstream pair similarities
    crossWorkstreamSimilarities = new Map()
    for (let i = 0; i < corpus.length; i++) {
      for (let j = i + 1; j < corpus.length; j++) {
        if (corpus[i].workstream === corpus[j].workstream) continue
        const key = makePairKey(corpus[i].artifactId, corpus[j].artifactId)
        const sim = cosineSimilarity(
          embeddings.get(corpus[i].artifactId)!,
          embeddings.get(corpus[j].artifactId)!
        )
        crossWorkstreamSimilarities.set(key, sim)
      }
    }
  }, 60_000)

  it('should find at least one threshold with recall > 0 for easy issues', () => {
    const thresholdResults: Array<{
      threshold: number
      all: ReturnType<typeof scoreDetections>
      easy: ReturnType<typeof scoreDetections>
      medium: ReturnType<typeof scoreDetections>
      hard: ReturnType<typeof scoreDetections>
    }> = []

    for (const threshold of THRESHOLDS) {
      const detectedPairs: Array<{ artifactIdA: string; artifactIdB: string }> = []

      for (const [key, sim] of crossWorkstreamSimilarities) {
        if (sim >= threshold) {
          const [a, b] = key.split(':')
          detectedPairs.push({ artifactIdA: a, artifactIdB: b })
        }
      }

      thresholdResults.push({
        threshold,
        all: scoreDetections(detectedPairs, groundTruth),
        easy: scoreDetections(detectedPairs, groundTruth, 'easy'),
        medium: scoreDetections(detectedPairs, groundTruth, 'medium'),
        hard: scoreDetections(detectedPairs, groundTruth, 'hard'),
      })
    }

    // At least one threshold should detect easy issues
    const bestEasyRecall = Math.max(...thresholdResults.map(r => r.easy.recall))
    expect(bestEasyRecall).toBeGreaterThan(0)

    // Write results
    const similarityMatrix: Record<string, number> = {}
    for (const [key, sim] of crossWorkstreamSimilarities) {
      similarityMatrix[key] = Math.round(sim * 10000) / 10000
    }

    writeResult({
      experimentId: 'experiment-1-threshold',
      timestamp: new Date().toISOString(),
      duration: 0,
      data: {
        totalPairs: crossWorkstreamSimilarities.size,
        thresholdResults,
        topSimilarPairs: [...crossWorkstreamSimilarities.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([key, sim]) => ({ pair: key, similarity: Math.round(sim * 10000) / 10000 })),
      },
    })
  })
})
