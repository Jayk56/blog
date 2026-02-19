/**
 * Experiment 2: Dilution Curve
 *
 * Measures how embedding similarity degrades as a target function is buried
 * in increasingly large wrapper files. Tests 3 positions (start/middle/end)
 * at each wrapper size.
 *
 * Gate: VOYAGE_API_KEY required
 * API cost: ~$0.02
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { VoyageEmbeddingService } from '../../src/intelligence/voyage-embedding-service.js'
import { cosineSimilarity } from '../../src/intelligence/embedding-service.js'
import {
  loadCorpus,
  mulberry32,
  estimateTokens,
  writeResult,
  type CorpusArtifact,
} from './experiment-harness.js'

const WRAPPER_SIZES = [100, 200, 500, 1000, 2000, 5000]
const POSITIONS = ['start', 'middle', 'end'] as const

// The target function to track through dilution
const VALIDATE_EMAIL_SNIPPET = `
export function validateEmail(email: string): boolean {
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  return re.test(email)
}
`.trim()

describe.skipIf(!process.env.VOYAGE_API_KEY)('Experiment 2: Dilution Curve', () => {
  let corpus: CorpusArtifact[]
  let voyageService: VoyageEmbeddingService
  let referenceVector: number[]
  let fillerBlocks: string[]

  beforeAll(async () => {
    corpus = loadCorpus()

    voyageService = new VoyageEmbeddingService({
      apiKey: process.env.VOYAGE_API_KEY!,
    })

    // Embed the target function in isolation
    referenceVector = await voyageService.embed(VALIDATE_EMAIL_SNIPPET)

    // Extract filler code blocks from corpus artifacts (code kind only)
    fillerBlocks = []
    for (const a of corpus) {
      if (a.kind !== 'code') continue
      // Split on double newlines to get chunks
      const chunks = a.content.split(/\n\n+/).filter(c => c.trim().length > 20)
      for (const chunk of chunks) {
        // Exclude chunks that contain the target function
        if (!chunk.includes('validateEmail')) {
          fillerBlocks.push(chunk)
        }
      }
    }
  }, 60_000)

  it('should observe dilution: similarity decreases with larger wrapper', async () => {
    const rng = mulberry32(42)
    const results: Array<{
      wrapperSize: number
      position: string
      actualTokens: number
      similarity: number
    }> = []

    const textsToEmbed: Array<{ wrapperSize: number; position: string; text: string }> = []

    for (const targetSize of WRAPPER_SIZES) {
      for (const position of POSITIONS) {
        // Build wrapper content
        const filler: string[] = []
        let fillerTokens = 0
        const targetTokens = targetSize - estimateTokens(VALIDATE_EMAIL_SNIPPET)
        const shuffled = [...fillerBlocks]
        // Deterministic shuffle
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }

        for (const block of shuffled) {
          if (fillerTokens >= targetTokens) break
          filler.push(block)
          fillerTokens += estimateTokens(block)
        }

        let text: string
        const fillerText = filler.join('\n\n')
        const halfIdx = Math.floor(filler.length / 2)
        const firstHalf = filler.slice(0, halfIdx).join('\n\n')
        const secondHalf = filler.slice(halfIdx).join('\n\n')

        switch (position) {
          case 'start':
            text = VALIDATE_EMAIL_SNIPPET + '\n\n' + fillerText
            break
          case 'end':
            text = fillerText + '\n\n' + VALIDATE_EMAIL_SNIPPET
            break
          case 'middle':
            text = firstHalf + '\n\n' + VALIDATE_EMAIL_SNIPPET + '\n\n' + secondHalf
            break
        }

        textsToEmbed.push({ wrapperSize: targetSize, position, text })
      }
    }

    // Batch embed all wrappers
    const vectors = await voyageService.embedBatch(textsToEmbed.map(t => t.text))

    for (let i = 0; i < textsToEmbed.length; i++) {
      const sim = cosineSimilarity(referenceVector, vectors[i])
      results.push({
        wrapperSize: textsToEmbed[i].wrapperSize,
        position: textsToEmbed[i].position,
        actualTokens: estimateTokens(textsToEmbed[i].text),
        similarity: Math.round(sim * 10000) / 10000,
      })
    }

    // Assertion: similarity at smallest wrapper > similarity at largest wrapper
    const smallestAvg = results
      .filter(r => r.wrapperSize === WRAPPER_SIZES[0])
      .reduce((sum, r) => sum + r.similarity, 0) / POSITIONS.length

    const largestAvg = results
      .filter(r => r.wrapperSize === WRAPPER_SIZES[WRAPPER_SIZES.length - 1])
      .reduce((sum, r) => sum + r.similarity, 0) / POSITIONS.length

    expect(smallestAvg).toBeGreaterThan(largestAvg)

    // Write results
    writeResult({
      experimentId: 'experiment-2-dilution',
      timestamp: new Date().toISOString(),
      duration: 0,
      data: {
        targetFunction: 'validateEmail',
        targetTokens: estimateTokens(VALIDATE_EMAIL_SNIPPET),
        fillerPoolSize: fillerBlocks.length,
        wrapperSizes: WRAPPER_SIZES,
        positions: POSITIONS,
        results,
        summary: WRAPPER_SIZES.map(size => {
          const sizeResults = results.filter(r => r.wrapperSize === size)
          const avg = sizeResults.reduce((s, r) => s + r.similarity, 0) / sizeResults.length
          return {
            wrapperSize: size,
            avgSimilarity: Math.round(avg * 10000) / 10000,
            byPosition: Object.fromEntries(
              sizeResults.map(r => [r.position, r.similarity])
            ),
          }
        }),
      },
    })
  }, 60_000)
})
