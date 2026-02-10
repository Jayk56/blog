import { describe, expect, it } from 'vitest'

import {
  cosineSimilarity,
  MockEmbeddingService,
  createVectorsWithSimilarity
} from '../../src/intelligence/embedding-service'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5)
  })

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for zero magnitude vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it('computes correct similarity for known vectors', () => {
    const a = [1, 1, 0]
    const b = [1, 0, 1]
    // dot = 1, |a| = sqrt(2), |b| = sqrt(2), cos = 1/2
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it('is symmetric', () => {
    const a = [3, 1, 4, 1, 5]
    const b = [2, 7, 1, 8, 2]
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10)
  })
})

describe('createVectorsWithSimilarity', () => {
  it('creates vectors with exact target similarity', () => {
    const [a, b] = createVectorsWithSimilarity(0.85)
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.85, 5)
  })

  it('creates identical vectors for similarity 1.0', () => {
    const [a, b] = createVectorsWithSimilarity(1.0)
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
  })

  it('creates orthogonal vectors for similarity 0.0', () => {
    const [a, b] = createVectorsWithSimilarity(0.0)
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  it('creates vectors with various target similarities', () => {
    for (const target of [0.1, 0.3, 0.5, 0.7, 0.9, 0.95]) {
      const [a, b] = createVectorsWithSimilarity(target)
      expect(cosineSimilarity(a, b)).toBeCloseTo(target, 4)
    }
  })

  it('respects custom dimensions', () => {
    const [a, b] = createVectorsWithSimilarity(0.6, 128)
    expect(a.length).toBe(128)
    expect(b.length).toBe(128)
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.6, 5)
  })
})

describe('MockEmbeddingService', () => {
  it('returns consistent embeddings for the same text', async () => {
    const service = new MockEmbeddingService()
    const e1 = await service.embed('hello world')
    const e2 = await service.embed('hello world')
    expect(e1).toEqual(e2)
  })

  it('returns different embeddings for different texts', async () => {
    const service = new MockEmbeddingService()
    const e1 = await service.embed('hello world')
    const e2 = await service.embed('goodbye world')
    // Should not be exactly equal
    expect(e1).not.toEqual(e2)
  })

  it('returns unit vectors', async () => {
    const service = new MockEmbeddingService()
    const emb = await service.embed('test text')
    const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1.0, 5)
  })

  it('returns vectors of correct dimensionality', async () => {
    const service = new MockEmbeddingService(128)
    const emb = await service.embed('test')
    expect(emb.length).toBe(128)
  })

  it('handles batch embedding', async () => {
    const service = new MockEmbeddingService()
    const results = await service.embedBatch(['a', 'b', 'c'])
    expect(results.length).toBe(3)
    // Each should be a valid vector
    for (const emb of results) {
      expect(emb.length).toBe(64)
    }
  })

  it('batch results match individual results', async () => {
    const service = new MockEmbeddingService()
    const texts = ['alpha', 'beta', 'gamma']
    const batch = await service.embedBatch(texts)
    for (let i = 0; i < texts.length; i++) {
      const individual = await service.embed(texts[i])
      expect(batch[i]).toEqual(individual)
    }
  })

  it('tracks call count', async () => {
    const service = new MockEmbeddingService()
    expect(service.callCount).toBe(0)
    await service.embed('a')
    expect(service.callCount).toBe(1)
    await service.embedBatch(['b', 'c'])
    expect(service.callCount).toBe(2)
    expect(service.lastBatchSize).toBe(2)
  })

  it('resets counters', async () => {
    const service = new MockEmbeddingService()
    await service.embed('a')
    service.resetCounters()
    expect(service.callCount).toBe(0)
    expect(service.lastBatchSize).toBe(0)
  })

  it('uses registered embeddings when available', async () => {
    const service = new MockEmbeddingService(4)
    const custom = [0.5, 0.5, 0.5, 0.5]
    service.registerEmbedding('custom text', custom)

    const result = await service.embed('custom text')
    expect(result).toEqual(custom)
  })

  it('registered embeddings are used in batch calls', async () => {
    const service = new MockEmbeddingService(4)
    const custom = [1, 0, 0, 0]
    service.registerEmbedding('special', custom)

    const results = await service.embedBatch(['normal', 'special'])
    expect(results[1]).toEqual(custom)
    expect(results[0]).not.toEqual(custom)
  })

  it('identical texts have cosine similarity 1.0', async () => {
    const service = new MockEmbeddingService()
    const e1 = await service.embed('identical text')
    const e2 = await service.embed('identical text')
    expect(cosineSimilarity(e1, e2)).toBeCloseTo(1.0, 5)
  })
})
