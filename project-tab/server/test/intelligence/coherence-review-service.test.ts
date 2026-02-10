import { describe, expect, it } from 'vitest'

import {
  ReviewRateLimiter,
  MockCoherenceReviewService,
  buildReviewPrompt
} from '../../src/intelligence/coherence-review-service'
import type { CoherenceCandidate, CoherenceReviewRequest } from '../../src/intelligence/coherence-review-service'

function makeCandidate(overrides: Partial<CoherenceCandidate> = {}): CoherenceCandidate {
  return {
    candidateId: `candidate-${Math.random().toString(36).slice(2, 8)}`,
    artifactIdA: 'art-1',
    artifactIdB: 'art-2',
    workstreamA: 'ws-backend',
    workstreamB: 'ws-frontend',
    similarityScore: 0.9,
    candidateCategory: 'duplication',
    detectedAt: new Date().toISOString(),
    promotedToLayer2: true,
    ...overrides
  }
}

describe('ReviewRateLimiter', () => {
  it('allows reviews up to the limit', () => {
    const limiter = new ReviewRateLimiter(3)
    const now = Date.now()

    expect(limiter.canReview(now)).toBe(true)
    limiter.record(now)
    expect(limiter.canReview(now)).toBe(true)
    limiter.record(now)
    expect(limiter.canReview(now)).toBe(true)
    limiter.record(now)
    expect(limiter.canReview(now)).toBe(false)
  })

  it('prunes old entries after one hour', () => {
    const limiter = new ReviewRateLimiter(2)
    const now = Date.now()
    const overOneHourAgo = now - 3_600_002

    limiter.record(overOneHourAgo)
    limiter.record(overOneHourAgo + 1) // still over an hour ago

    // Both should be pruned
    expect(limiter.canReview(now)).toBe(true)
    expect(limiter.reviewsInWindow(now)).toBe(0)
  })

  it('tracks reviews in the current window', () => {
    const limiter = new ReviewRateLimiter(10)
    const now = Date.now()

    limiter.record(now - 1000)
    limiter.record(now - 500)
    limiter.record(now)

    expect(limiter.reviewsInWindow(now)).toBe(3)
    expect(limiter.remaining(now)).toBe(7)
  })

  it('remaining returns 0 when at limit', () => {
    const limiter = new ReviewRateLimiter(1)
    const now = Date.now()
    limiter.record(now)
    expect(limiter.remaining(now)).toBe(0)
  })

  it('handles rolling window correctly', () => {
    const limiter = new ReviewRateLimiter(2)
    const base = Date.now()

    limiter.record(base)
    limiter.record(base + 100)

    // At limit
    expect(limiter.canReview(base + 200)).toBe(false)

    // One hour after first review, first entry is pruned
    expect(limiter.canReview(base + 3_600_001)).toBe(true)
    expect(limiter.reviewsInWindow(base + 3_600_001)).toBe(1)
  })
})

describe('MockCoherenceReviewService', () => {
  it('confirms all candidates by default', async () => {
    const service = new MockCoherenceReviewService()

    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate({ candidateId: 'c-1' }), makeCandidate({ candidateId: 'c-2' })],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: []
    }

    const results = await service.review(request)

    expect(results).toHaveLength(2)
    expect(results[0].confirmed).toBe(true)
    expect(results[1].confirmed).toBe(true)
  })

  it('tracks call count and last request', async () => {
    const service = new MockCoherenceReviewService()

    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate()],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: []
    }

    await service.review(request)
    expect(service.callCount).toBe(1)
    expect(service.lastRequest).toBe(request)
  })

  it('uses custom registered responses', async () => {
    const service = new MockCoherenceReviewService()
    service.registerResponse('c-custom', {
      confirmed: false,
      explanation: 'Not a real issue'
    })

    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate({ candidateId: 'c-custom' })],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: []
    }

    const results = await service.review(request)
    expect(results[0].confirmed).toBe(false)
    expect(results[0].explanation).toBe('Not a real issue')
  })

  it('resets counters', async () => {
    const service = new MockCoherenceReviewService()
    await service.review({
      candidates: [makeCandidate()],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: []
    })

    service.resetCounters()
    expect(service.callCount).toBe(0)
    expect(service.lastRequest).toBeNull()
  })
})

describe('buildReviewPrompt', () => {
  it('includes candidate information', () => {
    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate({
        candidateId: 'c-1',
        artifactIdA: 'art-A',
        artifactIdB: 'art-B',
        workstreamA: 'ws-auth',
        workstreamB: 'ws-api',
        similarityScore: 0.92
      })],
      artifactContents: new Map([
        ['art-A', 'function login() { ... }'],
        ['art-B', 'function authenticate() { ... }']
      ]),
      relevantDecisions: [],
      workstreamBriefs: []
    }

    const prompt = buildReviewPrompt(request)

    expect(prompt).toContain('c-1')
    expect(prompt).toContain('art-A')
    expect(prompt).toContain('art-B')
    expect(prompt).toContain('ws-auth')
    expect(prompt).toContain('ws-api')
    expect(prompt).toContain('0.920')
    expect(prompt).toContain('function login')
    expect(prompt).toContain('function authenticate')
  })

  it('includes workstream briefs', () => {
    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate()],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: [
        { id: 'ws-1', name: 'Auth', goals: ['Implement SSO', 'Add MFA'] }
      ]
    }

    const prompt = buildReviewPrompt(request)
    expect(prompt).toContain('Auth')
    expect(prompt).toContain('Implement SSO')
    expect(prompt).toContain('Add MFA')
  })

  it('includes recent decisions', () => {
    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate()],
      artifactContents: new Map(),
      relevantDecisions: [
        { id: 'd-1', title: 'Use JWT tokens', agentId: 'agent-1' }
      ],
      workstreamBriefs: []
    }

    const prompt = buildReviewPrompt(request)
    expect(prompt).toContain('Use JWT tokens')
    expect(prompt).toContain('agent-1')
  })

  it('includes response format instructions', () => {
    const request: CoherenceReviewRequest = {
      candidates: [makeCandidate()],
      artifactContents: new Map(),
      relevantDecisions: [],
      workstreamBriefs: []
    }

    const prompt = buildReviewPrompt(request)
    expect(prompt).toContain('candidateId')
    expect(prompt).toContain('confirmed')
    expect(prompt).toContain('category')
    expect(prompt).toContain('severity')
    expect(prompt).toContain('explanation')
    expect(prompt).toContain('suggestedResolution')
    expect(prompt).toContain('notifyAgentIds')
  })
})
