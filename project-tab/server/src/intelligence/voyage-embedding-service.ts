import type { EmbeddingService } from './embedding-service'

const DEFAULT_ENDPOINT = 'https://api.voyageai.com/v1/embeddings'
const DEFAULT_MAX_TOKENS_PER_MINUTE = 16_000_000

export interface VoyageEmbeddingConfig {
  apiKey: string
  model: 'voyage-4-lite' | 'voyage-code-3' | 'voyage-4'
  outputDimension: number
  maxBatchSize: number
  maxRetries: number
  retryBaseMs: number
  /** Optional override used by tests. */
  endpoint?: string
  /** Optional override used by tests. */
  maxTokensPerMinute?: number
  /** Optional fetch override used by tests. */
  fetchImpl?: typeof fetch
  /** Optional timer override used by tests. */
  sleepFn?: (ms: number) => Promise<void>
  /** Optional clock override used by tests. */
  nowFn?: () => number
}

interface VoyageEmbeddingApiResponse {
  data: Array<{ embedding: number[] }>
}

const DEFAULT_CONFIG: Omit<VoyageEmbeddingConfig, 'apiKey'> = {
  model: 'voyage-4-lite',
  outputDimension: 512,
  maxBatchSize: 128,
  maxRetries: 3,
  retryBaseMs: 1000,
}

export class VoyageEmbeddingService implements EmbeddingService {
  private readonly config: VoyageEmbeddingConfig
  private readonly fetchImpl: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly nowFn: () => number
  private readonly maxTokensPerMinute: number

  private windowStartedAtMs = 0
  private tokensUsedInWindow = 0

  constructor(config: Partial<VoyageEmbeddingConfig> & Pick<VoyageEmbeddingConfig, 'apiKey'>) {
    const merged: VoyageEmbeddingConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    }

    if (!merged.apiKey?.trim()) {
      throw new Error('VoyageEmbeddingService requires a non-empty apiKey')
    }
    if (merged.outputDimension <= 0) {
      throw new Error('VoyageEmbeddingService outputDimension must be > 0')
    }
    if (merged.maxBatchSize <= 0) {
      throw new Error('VoyageEmbeddingService maxBatchSize must be > 0')
    }
    if (merged.maxRetries < 0) {
      throw new Error('VoyageEmbeddingService maxRetries must be >= 0')
    }
    if (merged.retryBaseMs < 0) {
      throw new Error('VoyageEmbeddingService retryBaseMs must be >= 0')
    }

    this.config = merged
    this.fetchImpl = merged.fetchImpl ?? fetch
    this.sleepFn = merged.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.nowFn = merged.nowFn ?? (() => Date.now())
    this.maxTokensPerMinute = merged.maxTokensPerMinute ?? DEFAULT_MAX_TOKENS_PER_MINUTE
    this.windowStartedAtMs = this.nowFn()
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedBatch([text])
    return vectors[0] ?? []
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const output: number[][] = []
    for (let i = 0; i < texts.length; i += this.config.maxBatchSize) {
      const chunk = texts.slice(i, i + this.config.maxBatchSize)
      const embeddings = await this.requestWithRetry(chunk)
      output.push(...embeddings)
    }
    return output
  }

  private async requestWithRetry(inputs: string[]): Promise<number[][]> {
    const estimatedTokens = this.estimateTokens(inputs)
    let attempt = 0

    while (attempt <= this.config.maxRetries) {
      await this.waitForTpmBudget(estimatedTokens)

      const response = await this.fetchImpl(this.config.endpoint ?? DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: inputs,
          model: this.config.model,
          output_dimension: this.config.outputDimension,
          input_type: 'document',
        }),
      })

      if (response.ok) {
        this.recordTpmUsage(estimatedTokens)
        const parsed = await response.json() as VoyageEmbeddingApiResponse
        const embeddings = parsed.data?.map((entry) => entry.embedding)
        if (!embeddings || embeddings.length !== inputs.length) {
          throw new Error('Voyage embeddings response did not match request size')
        }
        return embeddings
      }

      const shouldRetry = response.status === 429 || response.status >= 500
      if (!shouldRetry || attempt === this.config.maxRetries) {
        const details = await safeReadText(response)
        throw new Error(`Voyage embeddings request failed (${response.status}): ${details}`)
      }

      const waitMs = this.computeBackoffMs(attempt)
      await this.sleepFn(waitMs)
      attempt += 1
    }

    throw new Error('Voyage embeddings request failed after retries')
  }

  private estimateTokens(inputs: string[]): number {
    let totalChars = 0
    for (const input of inputs) {
      totalChars += input.length
    }
    return Math.ceil(totalChars / 4)
  }

  private async waitForTpmBudget(estimatedTokens: number): Promise<void> {
    while (true) {
      this.resetTpmWindowIfNeeded()
      if (this.tokensUsedInWindow + estimatedTokens <= this.maxTokensPerMinute) {
        return
      }

      const now = this.nowFn()
      const windowEndsAt = this.windowStartedAtMs + 60_000
      const waitMs = Math.max(1, windowEndsAt - now)
      await this.sleepFn(waitMs)
    }
  }

  private resetTpmWindowIfNeeded(): void {
    const now = this.nowFn()
    if ((now - this.windowStartedAtMs) >= 60_000) {
      this.windowStartedAtMs = now
      this.tokensUsedInWindow = 0
    }
  }

  private recordTpmUsage(tokens: number): void {
    this.resetTpmWindowIfNeeded()
    this.tokensUsedInWindow += tokens
  }

  private computeBackoffMs(attempt: number): number {
    const base = this.config.retryBaseMs * (2 ** attempt)
    const jitter = Math.floor(base * Math.random() * 0.1)
    return base + jitter
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text || '<empty body>'
  } catch {
    return '<unreadable body>'
  }
}
