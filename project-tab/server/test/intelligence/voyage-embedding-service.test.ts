import { describe, expect, it, vi } from 'vitest'

import { VoyageEmbeddingService } from '../../src/intelligence/voyage-embedding-service'

describe('VoyageEmbeddingService', () => {
  it('validates required apiKey', () => {
    expect(() => new VoyageEmbeddingService({ apiKey: '' })).toThrow(/apiKey/)
  })

  it('splits embedBatch requests by maxBatchSize', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { input: string[] }
      return new Response(JSON.stringify({
        data: payload.input.map((input) => ({ embedding: [input.length, 0, 0] }))
      }), { status: 200 })
    })

    const service = new VoyageEmbeddingService({
      apiKey: 'test-key',
      maxBatchSize: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const result = await service.embedBatch(['alpha', 'beta', 'gamma', 'delta', 'epsilon'])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual([
      [5, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
      [5, 0, 0],
      [7, 0, 0],
    ])
  })

  it('retries on 429 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ embedding: [1, 2, 3] }],
      }), { status: 200 }))

    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const service = new VoyageEmbeddingService({
      apiKey: 'test-key',
      retryBaseMs: 1,
      sleepFn,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const result = await service.embed('hello')

    expect(result).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledTimes(1)
  })

  it('throws immediately for non-retryable 4xx errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('bad request', { status: 400 })
    )

    const service = new VoyageEmbeddingService({
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await expect(service.embed('x')).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
