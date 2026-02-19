/**
 * Filesystem-backed caches for experiment API calls.
 *
 * First run populates the cache; subsequent runs skip the API entirely.
 * Set EXPERIMENT_NO_CACHE=true to bypass.
 *
 * Cache dir: server/test/experiments/cache/
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EmbeddingService } from '../../src/intelligence/embedding-service.js'
import type {
  CoherenceReviewRequest,
  CoherenceReviewResult,
  CoherenceReviewService,
  LlmSweepIssue,
  LlmSweepRequest,
  LlmSweepService,
} from '../../src/intelligence/coherence-review-service.js'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const CACHE_DIR = join(__dirname, 'cache')
const EMBEDDINGS_DIR = join(CACHE_DIR, 'embeddings')
const LLM_DIR = join(CACHE_DIR, 'llm')

function noCache(): boolean {
  return process.env.EXPERIMENT_NO_CACHE === 'true'
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ── Embedding Cache ─────────────────────────────────────────────────────────

/**
 * Wraps an EmbeddingService with a per-text filesystem cache.
 * Cache file: cache/embeddings/{model}.json — a map of textHash → vector.
 */
export class CachedEmbeddingService implements EmbeddingService {
  private readonly inner: EmbeddingService
  private readonly model: string
  private cache: Record<string, number[]>
  private readonly cachePath: string
  private dirty = false

  constructor(inner: EmbeddingService, model: string) {
    this.inner = inner
    this.model = model
    ensureDir(EMBEDDINGS_DIR)
    this.cachePath = join(EMBEDDINGS_DIR, `${model}.json`)
    this.cache = existsSync(this.cachePath)
      ? JSON.parse(readFileSync(this.cachePath, 'utf-8'))
      : {}
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text])
    return results[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (noCache()) {
      return this.inner.embedBatch(texts)
    }

    const results: (number[] | null)[] = texts.map(() => null)
    const misses: { index: number; text: string }[] = []

    for (let i = 0; i < texts.length; i++) {
      const key = sha256(this.model + ':' + texts[i])
      if (this.cache[key]) {
        results[i] = this.cache[key]
      } else {
        misses.push({ index: i, text: texts[i] })
      }
    }

    const hits = texts.length - misses.length
    if (hits > 0) {
      process.stderr.write(`[cache] embeddings: ${hits} hits, ${misses.length} misses\n`)
    }

    if (misses.length > 0) {
      const freshVectors = await this.inner.embedBatch(misses.map(m => m.text))
      for (let i = 0; i < misses.length; i++) {
        const key = sha256(this.model + ':' + misses[i].text)
        this.cache[key] = freshVectors[i]
        results[misses[i].index] = freshVectors[i]
        this.dirty = true
      }
      this.flush()
    }

    return results as number[][]
  }

  private flush(): void {
    if (!this.dirty) return
    writeFileSync(this.cachePath, JSON.stringify(this.cache))
    this.dirty = false
  }
}

// ── LLM Cache ───────────────────────────────────────────────────────────────

/**
 * Wraps a CoherenceReviewService + LlmSweepService with filesystem cache.
 * Each unique request gets its own file: cache/llm/{hash}.json
 */
export class CachedLlmService implements CoherenceReviewService, LlmSweepService {
  private readonly inner: CoherenceReviewService & LlmSweepService
  private readonly model: string

  constructor(inner: CoherenceReviewService & LlmSweepService, model: string) {
    this.inner = inner
    this.model = model
    ensureDir(LLM_DIR)
  }

  async review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]> {
    if (noCache()) {
      return this.inner.review(request)
    }

    // Build a stable cache key from the request
    const keyData = JSON.stringify({
      model: this.model,
      type: 'review',
      // Exclude candidateId — CoherenceMonitor generates fresh UUIDs each run.
      // The LLM response depends on the artifact pair + content, not the ID.
      candidates: request.candidates.map(c => ({
        artifactIdA: c.artifactIdA,
        artifactIdB: c.artifactIdB,
        similarityScore: c.similarityScore,
      })),
      contents: [...request.artifactContents.entries()].sort(([a], [b]) => a.localeCompare(b)),
    })
    const hash = sha256(keyData)
    const cachePath = join(LLM_DIR, `review-${hash.slice(0, 16)}.json`)

    if (existsSync(cachePath)) {
      process.stderr.write(`[cache] review hit: ${cachePath}\n`)
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
      return cached.response
    }

    process.stderr.write(`[cache] review miss: calling API\n`)
    const response = await this.inner.review(request)
    writeFileSync(cachePath, JSON.stringify({ model: this.model, type: 'review', hash, response }))
    return response
  }

  async sweepCorpus(request: LlmSweepRequest): Promise<LlmSweepIssue[]> {
    if (noCache()) {
      return this.inner.sweepCorpus(request)
    }

    // Cache key: model + artifact order (order matters — experiments test positional sensitivity)
    const keyData = JSON.stringify({
      model: request.model ?? this.model,
      type: 'sweep',
      artifacts: request.artifacts.map(a => ({
        artifactId: a.artifactId,
        workstream: a.workstream,
        content: a.content,
      })),
      prompt: request.prompt,
    })
    const hash = sha256(keyData)
    const cachePath = join(LLM_DIR, `sweep-${hash.slice(0, 16)}.json`)

    if (existsSync(cachePath)) {
      process.stderr.write(`[cache] sweep hit: ${cachePath}\n`)
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
      return cached.response
    }

    process.stderr.write(`[cache] sweep miss: calling API\n`)
    const response = await this.inner.sweepCorpus(request)
    writeFileSync(cachePath, JSON.stringify({
      model: request.model ?? this.model,
      type: 'sweep',
      hash,
      artifactCount: request.artifacts.length,
      response,
    }))
    return response
  }
}
