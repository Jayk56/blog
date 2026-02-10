/**
 * Embedding service interface and implementations for Layer 1 coherence monitoring.
 *
 * Provides text embedding computation and cosine similarity for cross-workstream
 * artifact comparison.
 */

/** Embedding service interface. Implementations must be stateless per-call. */
export interface EmbeddingService {
  /** Compute an embedding vector for a single text input. */
  embed(text: string): Promise<number[]>

  /** Compute embedding vectors for multiple texts in a single batch call. */
  embedBatch(texts: string[]): Promise<number[][]>
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1] where 1 means identical direction.
 *
 * Returns 0 if either vector has zero magnitude (degenerate case).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

/**
 * Mock embedding service for testing.
 *
 * Uses a deterministic hash-based embedding: each unique text produces a
 * consistent embedding vector. Texts with the same content produce
 * identical embeddings (similarity 1.0). Different texts produce vectors
 * that are generally dissimilar.
 *
 * You can also pre-register specific text->embedding mappings for precise
 * control over similarity scores in tests.
 */
export class MockEmbeddingService implements EmbeddingService {
  private readonly dimensions: number
  private readonly registry = new Map<string, number[]>()
  public callCount = 0
  public lastBatchSize = 0

  constructor(dimensions = 64) {
    this.dimensions = dimensions
  }

  /** Pre-register a specific embedding for a text string. */
  registerEmbedding(text: string, embedding: number[]): void {
    this.registry.set(text, embedding)
  }

  async embed(text: string): Promise<number[]> {
    this.callCount++
    this.lastBatchSize = 1

    const registered = this.registry.get(text)
    if (registered) return registered

    return this.hashToEmbedding(text)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.callCount++
    this.lastBatchSize = texts.length

    return texts.map((text) => {
      const registered = this.registry.get(text)
      if (registered) return registered
      return this.hashToEmbedding(text)
    })
  }

  /** Reset call tracking counters. */
  resetCounters(): void {
    this.callCount = 0
    this.lastBatchSize = 0
  }

  /**
   * Generate a deterministic embedding from text content.
   * Uses a simple hash function spread across dimensions.
   */
  private hashToEmbedding(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0)

    // Simple deterministic hash spread
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
    }

    for (let d = 0; d < this.dimensions; d++) {
      // Mix hash with dimension index for spread
      const mixed = ((hash * (d + 1) * 2654435761) | 0) >>> 0
      // Map to [-1, 1] range
      vec[d] = (mixed / 0xFFFFFFFF) * 2 - 1
    }

    // Normalize to unit vector
    let norm = 0
    for (let d = 0; d < this.dimensions; d++) {
      norm += vec[d] * vec[d]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let d = 0; d < this.dimensions; d++) {
        vec[d] /= norm
      }
    }

    return vec
  }
}

/**
 * Create two unit vectors with a specific cosine similarity.
 * Useful for test fixtures where you need precise control over similarity scores.
 *
 * @param similarity Target cosine similarity in [0, 1]
 * @param dimensions Vector dimensionality
 * @returns Tuple of two unit vectors with the specified cosine similarity
 */
export function createVectorsWithSimilarity(
  similarity: number,
  dimensions = 64
): [number[], number[]] {
  // Vector A: unit vector along first dimension
  const a = new Array<number>(dimensions).fill(0)
  a[0] = 1

  // Vector B: blend of A and an orthogonal vector
  const b = new Array<number>(dimensions).fill(0)
  b[0] = similarity
  b[1] = Math.sqrt(1 - similarity * similarity)

  return [a, b]
}
