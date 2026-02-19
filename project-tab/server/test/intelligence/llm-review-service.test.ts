import { describe, expect, it, vi } from 'vitest'

import type { CoherenceReviewRequest } from '../../src/intelligence/coherence-review-service'
import { LlmReviewService } from '../../src/intelligence/llm-review-service'

function makeRequest(): CoherenceReviewRequest {
  return {
    candidates: [
      {
        candidateId: 'c-1',
        artifactIdA: 'art-1',
        artifactIdB: 'art-2',
        workstreamA: 'ws-a',
        workstreamB: 'ws-b',
        similarityScore: 0.91,
        candidateCategory: 'duplication',
        detectedAt: new Date().toISOString(),
        promotedToLayer2: true,
      },
      {
        candidateId: 'c-2',
        artifactIdA: 'art-3',
        artifactIdB: 'art-4',
        workstreamA: 'ws-a',
        workstreamB: 'ws-c',
        similarityScore: 0.87,
        candidateCategory: 'contradiction',
        detectedAt: new Date().toISOString(),
        promotedToLayer2: true,
      },
    ],
    artifactContents: new Map([
      ['art-1', 'const a = 1'],
      ['art-2', 'const a = 1'],
    ]),
    relevantDecisions: [],
    workstreamBriefs: [],
  }
}

describe('LlmReviewService', () => {
  it('returns parsed review results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        {
          candidateId: 'c-1',
          confirmed: true,
          category: 'duplication',
          severity: 'high',
          explanation: 'Exact duplicate logic',
          notifyAgentIds: ['agent-1'],
        },
        {
          candidateId: 'c-2',
          confirmed: false,
          category: 'contradiction',
          severity: 'medium',
          explanation: 'False positive',
          notifyAgentIds: [],
        },
      ]) }],
    }), { status: 200 }))

    const service = new LlmReviewService({
      provider: 'anthropic',
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const result = await service.review(makeRequest())

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      candidateId: 'c-1',
      confirmed: true,
      category: 'duplication',
      severity: 'high',
    })
    expect(result[1]).toMatchObject({
      candidateId: 'c-2',
      confirmed: false,
      category: 'contradiction',
    })
  })

  it('falls back to confirmed results when JSON parsing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'not-json' }],
    }), { status: 200 }))

    const service = new LlmReviewService({
      provider: 'anthropic',
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const result = await service.review(makeRequest())

    expect(result).toHaveLength(2)
    expect(result.every((entry) => entry.confirmed)).toBe(true)
    expect(result[0].explanation).toContain('defaulting to confirmed')
  })

  it('retries on transient errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify([
          {
            candidateId: 'c-1',
            confirmed: true,
            explanation: 'ok',
            notifyAgentIds: [],
          },
          {
            candidateId: 'c-2',
            confirmed: true,
            explanation: 'ok',
            notifyAgentIds: [],
          },
        ]) }],
      }), { status: 200 }))

    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const service = new LlmReviewService({
      provider: 'anthropic',
      apiKey: 'test-key',
      retryBaseMs: 1,
      sleepFn,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const result = await service.review(makeRequest())

    expect(result).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledTimes(1)
  })

  it('supports full-corpus sweep parsing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        {
          artifactIdA: 'a-1',
          artifactIdB: 'a-2',
          category: 'duplication',
          severity: 'medium',
          explanation: 'Same function body appears twice',
          notifyAgentIds: [],
        },
        {
          artifactIdA: 'a-2',
          artifactIdB: 'a-1',
          category: 'duplication',
          severity: 'medium',
          explanation: 'duplicate reverse order',
          notifyAgentIds: [],
        },
      ]) }],
    }), { status: 200 }))

    const service = new LlmReviewService({
      provider: 'anthropic',
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const issues = await service.sweepCorpus({
      artifacts: [
        { artifactId: 'a-1', workstream: 'ws-a', content: 'function a(){}' },
        { artifactId: 'a-2', workstream: 'ws-b', content: 'function a(){}' },
      ],
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      artifactIdA: 'a-1',
      artifactIdB: 'a-2',
      category: 'duplication',
    })
  })
})
