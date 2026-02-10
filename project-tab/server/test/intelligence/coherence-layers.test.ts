import { describe, expect, it, beforeEach } from 'vitest'

import { CoherenceMonitor, isEmbeddable } from '../../src/intelligence/coherence-monitor'
import {
  MockEmbeddingService,
  createVectorsWithSimilarity,
  cosineSimilarity
} from '../../src/intelligence/embedding-service'
import { MockCoherenceReviewService } from '../../src/intelligence/coherence-review-service'
import { TickService } from '../../src/tick'
import type { ArtifactEvent } from '../../src/types/events'

function makeArtifact(overrides: Partial<ArtifactEvent> = {}): ArtifactEvent {
  return {
    type: 'artifact',
    agentId: 'agent-1',
    artifactId: `art-${Math.random().toString(36).slice(2, 8)}`,
    name: 'main.ts',
    kind: 'code',
    workstream: 'ws-backend',
    status: 'draft',
    qualityScore: 0.8,
    provenance: {
      createdBy: 'agent-1',
      createdAt: new Date().toISOString(),
      sourcePath: '/src/main.ts'
    },
    ...overrides
  }
}

describe('isEmbeddable', () => {
  it('allows code with text/* mimeType', () => {
    expect(isEmbeddable('code', 'text/typescript')).toBe(true)
    expect(isEmbeddable('code', 'text/plain')).toBe(true)
  })

  it('allows code with no mimeType (default embeddable)', () => {
    expect(isEmbeddable('code')).toBe(true)
  })

  it('allows document with text/* and application/json', () => {
    expect(isEmbeddable('document', 'text/markdown')).toBe(true)
    expect(isEmbeddable('document', 'application/json')).toBe(true)
  })

  it('rejects design kind (images)', () => {
    expect(isEmbeddable('design', 'image/png')).toBe(false)
    expect(isEmbeddable('design')).toBe(false)
  })

  it('rejects binary other kind', () => {
    expect(isEmbeddable('other', 'application/octet-stream')).toBe(false)
  })

  it('allows other kind with text/* mimeType', () => {
    expect(isEmbeddable('other', 'text/csv')).toBe(true)
  })

  it('rejects other kind with no mimeType', () => {
    expect(isEmbeddable('other')).toBe(false)
  })

  it('allows config with no mimeType', () => {
    expect(isEmbeddable('config')).toBe(true)
  })

  it('allows test with text mimeType', () => {
    expect(isEmbeddable('test', 'text/typescript')).toBe(true)
  })
})

describe('CoherenceMonitor — Layer 0 backward compatibility', () => {
  it('still detects file conflicts as before', () => {
    const monitor = new CoherenceMonitor()
    monitor.processArtifact(makeArtifact({
      agentId: 'a-1',
      artifactId: 'art-1',
      provenance: { createdBy: 'a-1', createdAt: new Date().toISOString(), sourcePath: '/src/app.ts' }
    }))

    const conflict = monitor.processArtifact(makeArtifact({
      agentId: 'a-2',
      artifactId: 'art-2',
      workstream: 'ws-frontend',
      provenance: { createdBy: 'a-2', createdAt: new Date().toISOString(), sourcePath: '/src/app.ts' }
    }))

    expect(conflict).toBeDefined()
    expect(conflict!.category).toBe('duplication')
    expect(conflict!.severity).toBe('high')
  })

  it('tracks changed artifact IDs for Layer 1 when processing', () => {
    const monitor = new CoherenceMonitor()
    const event = makeArtifact({ artifactId: 'art-tracked' })
    monitor.processArtifact(event)
    expect(monitor.getChangedArtifactIds().has('art-tracked')).toBe(true)
  })

  it('reset clears Layer 1 and Layer 2 state', () => {
    const monitor = new CoherenceMonitor()
    monitor.processArtifact(makeArtifact({ artifactId: 'art-1' }))
    expect(monitor.getChangedArtifactIds().size).toBe(1)

    monitor.reset()
    expect(monitor.getChangedArtifactIds().size).toBe(0)
    expect(monitor.getEmbeddings().size).toBe(0)
    expect(monitor.getCandidates().length).toBe(0)
  })
})

describe('CoherenceMonitor — config', () => {
  it('uses default config when none provided', () => {
    const monitor = new CoherenceMonitor()
    const config = monitor.getConfig()
    expect(config.layer1ScanIntervalTicks).toBe(10)
    expect(config.layer1PromotionThreshold).toBe(0.85)
    expect(config.layer1MaxArtifactsPerScan).toBe(500)
    expect(config.layer2MaxReviewsPerHour).toBe(10)
    expect(config.enableLayer2).toBe(false)
  })

  it('merges partial config', () => {
    const monitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 5,
      enableLayer2: true
    })
    const config = monitor.getConfig()
    expect(config.layer1ScanIntervalTicks).toBe(5)
    expect(config.enableLayer2).toBe(true)
    // Defaults preserved
    expect(config.layer1PromotionThreshold).toBe(0.85)
  })
})

describe('CoherenceMonitor — shouldRunLayer1Scan', () => {
  it('returns false without embedding service', () => {
    const monitor = new CoherenceMonitor()
    monitor.processArtifact(makeArtifact({ artifactId: 'art-1' }))
    expect(monitor.shouldRunLayer1Scan(10)).toBe(false)
  })

  it('returns false with no changed artifacts', () => {
    const monitor = new CoherenceMonitor()
    monitor.setEmbeddingService(new MockEmbeddingService())
    expect(monitor.shouldRunLayer1Scan(10)).toBe(false)
  })

  it('returns false when not enough ticks have elapsed', () => {
    const monitor = new CoherenceMonitor({ layer1ScanIntervalTicks: 10 })
    monitor.setEmbeddingService(new MockEmbeddingService())
    monitor.processArtifact(makeArtifact({ artifactId: 'art-1' }))
    expect(monitor.shouldRunLayer1Scan(5)).toBe(false)
  })

  it('returns true when interval has elapsed and artifacts changed', () => {
    const monitor = new CoherenceMonitor({ layer1ScanIntervalTicks: 10 })
    monitor.setEmbeddingService(new MockEmbeddingService())
    monitor.processArtifact(makeArtifact({ artifactId: 'art-1' }))
    expect(monitor.shouldRunLayer1Scan(10)).toBe(true)
  })
})

describe('CoherenceMonitor — Layer 1 scan', () => {
  let monitor: CoherenceMonitor
  let embeddingService: MockEmbeddingService
  const artifacts = new Map<string, ArtifactEvent>()
  const contents = new Map<string, string>()

  beforeEach(() => {
    monitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 1,
      layer1PromotionThreshold: 0.85,
      layer1AdvisoryThreshold: 0.70
    })
    embeddingService = new MockEmbeddingService(8)
    monitor.setEmbeddingService(embeddingService)
    artifacts.clear()
    contents.clear()
  })

  function addArtifact(id: string, workstream: string, content: string, kind: ArtifactEvent['kind'] = 'code') {
    const event = makeArtifact({
      artifactId: id,
      workstream,
      kind,
      provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString() }
    })
    artifacts.set(id, event)
    contents.set(id, content)
    monitor.processArtifact(event)
  }

  it('computes embeddings for changed artifacts', async () => {
    addArtifact('art-1', 'ws-a', 'some code')

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getEmbeddings().size).toBe(1)
    expect(monitor.getEmbeddings().has('art-1')).toBe(true)
  })

  it('uses batch embedding call', async () => {
    addArtifact('art-1', 'ws-a', 'code a')
    addArtifact('art-2', 'ws-a', 'code b')

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(embeddingService.callCount).toBe(1) // single batch call
    expect(embeddingService.lastBatchSize).toBe(2)
  })

  it('clears changed artifact IDs after scan', async () => {
    addArtifact('art-1', 'ws-a', 'code a')
    expect(monitor.getChangedArtifactIds().size).toBe(1)

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getChangedArtifactIds().size).toBe(0)
  })

  it('updates last scan tick', async () => {
    addArtifact('art-1', 'ws-a', 'code')

    await monitor.runLayer1Scan(
      42,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getLastScanTick()).toBe(42)
  })

  it('detects cross-workstream similarity above promotion threshold', async () => {
    // Register embeddings with high similarity
    const [vecA, vecB] = createVectorsWithSimilarity(0.92, 8)
    embeddingService.registerEmbedding('code alpha', vecA)
    embeddingService.registerEmbedding('code alpha duplicate', vecB)

    addArtifact('art-a', 'ws-backend', 'code alpha')
    addArtifact('art-b', 'ws-frontend', 'code alpha duplicate')

    const candidates = await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(candidates.length).toBe(1)
    expect(candidates[0].promotedToLayer2).toBe(true)
    expect(candidates[0].similarityScore).toBeCloseTo(0.92, 2)
    expect(candidates[0].artifactIdA).toBeDefined()
    expect(candidates[0].artifactIdB).toBeDefined()
  })

  it('creates advisory issues for medium-similarity pairs', async () => {
    const [vecA, vecB] = createVectorsWithSimilarity(0.75, 8)
    embeddingService.registerEmbedding('text-x', vecA)
    embeddingService.registerEmbedding('text-y', vecB)

    addArtifact('art-x', 'ws-a', 'text-x')
    addArtifact('art-y', 'ws-b', 'text-y')

    const candidates = await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(candidates.length).toBe(1)
    expect(candidates[0].promotedToLayer2).toBe(false)

    // Advisory issue should have been emitted
    const issues = monitor.getDetectedIssues()
    const advisory = issues.find((i) => i.severity === 'low' && i.title.includes('Potential overlap'))
    expect(advisory).toBeDefined()
  })

  it('skips same-workstream artifact pairs', async () => {
    // Even with identical embeddings, same-workstream pairs should not be flagged
    const vec = [1, 0, 0, 0, 0, 0, 0, 0]
    embeddingService.registerEmbedding('identical', vec)

    addArtifact('art-1', 'ws-same', 'identical')
    addArtifact('art-2', 'ws-same', 'identical')

    const candidates = await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(candidates.length).toBe(0)
  })

  it('skips non-embeddable artifacts (design kind)', async () => {
    addArtifact('art-design', 'ws-a', 'image data', 'design')

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getEmbeddings().size).toBe(0)
  })

  it('skips artifacts without content', async () => {
    addArtifact('art-no-content', 'ws-a', '') // empty
    contents.delete('art-no-content') // no content available

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getEmbeddings().size).toBe(0)
  })

  it('respects layer1MaxArtifactsPerScan limit', async () => {
    const limitedMonitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 1,
      layer1MaxArtifactsPerScan: 2
    })
    limitedMonitor.setEmbeddingService(embeddingService)

    // Add 5 artifacts
    for (let i = 0; i < 5; i++) {
      const event = makeArtifact({
        artifactId: `art-${i}`,
        workstream: `ws-${i}`,
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString() }
      })
      artifacts.set(`art-${i}`, event)
      contents.set(`art-${i}`, `content ${i}`)
      limitedMonitor.processArtifact(event)
    }

    await limitedMonitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(limitedMonitor.getEmbeddings().size).toBe(2)
  })

  it('does not duplicate candidates on re-scan', async () => {
    const [vecA, vecB] = createVectorsWithSimilarity(0.90, 8)
    embeddingService.registerEmbedding('alpha', vecA)
    embeddingService.registerEmbedding('beta', vecB)

    // First scan
    addArtifact('art-a', 'ws-1', 'alpha')
    addArtifact('art-b', 'ws-2', 'beta')

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(monitor.getCandidates().length).toBe(1)

    // Second scan with same artifacts changed again
    monitor.processArtifact(artifacts.get('art-a')!)
    await monitor.runLayer1Scan(
      2,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    // Should still be 1 candidate, not 2
    expect(monitor.getCandidates().length).toBe(1)
  })

  it('returns empty array without embedding service', async () => {
    const plainMonitor = new CoherenceMonitor()
    plainMonitor.processArtifact(makeArtifact({ artifactId: 'art-1' }))

    const result = await plainMonitor.runLayer1Scan(
      1,
      () => undefined,
      () => undefined
    )

    expect(result).toEqual([])
  })
})

describe('CoherenceMonitor — TickService integration', () => {
  it('subscribes and unsubscribes from tick service', () => {
    const monitor = new CoherenceMonitor()
    const tickService = new TickService({ mode: 'manual' })

    monitor.subscribeTo(tickService)
    // Verify subscription works by checking handler count is not zero
    // (TickService does not expose handler count, but we can test unsubscribe)
    monitor.unsubscribeFrom(tickService)
    // Should not throw
  })
})

describe('CoherenceMonitor — Layer 2 review', () => {
  let monitor: CoherenceMonitor
  let embeddingService: MockEmbeddingService
  let reviewService: MockCoherenceReviewService
  const artifacts = new Map<string, ArtifactEvent>()
  const contents = new Map<string, string>()

  beforeEach(() => {
    monitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 1,
      layer1PromotionThreshold: 0.85,
      layer1AdvisoryThreshold: 0.70,
      layer2MaxReviewsPerHour: 10,
      enableLayer2: true
    })
    embeddingService = new MockEmbeddingService(8)
    reviewService = new MockCoherenceReviewService()
    monitor.setEmbeddingService(embeddingService)
    monitor.setReviewService(reviewService)
    artifacts.clear()
    contents.clear()
  })

  function addArtifact(id: string, workstream: string, content: string) {
    const event = makeArtifact({
      artifactId: id,
      workstream,
      provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString() }
    })
    artifacts.set(id, event)
    contents.set(id, content)
    monitor.processArtifact(event)
  }

  async function createPromotedCandidate() {
    const [vecA, vecB] = createVectorsWithSimilarity(0.92, 8)
    embeddingService.registerEmbedding('func login() {}', vecA)
    embeddingService.registerEmbedding('func authenticate() {}', vecB)

    addArtifact('art-auth-1', 'ws-backend', 'func login() {}')
    addArtifact('art-auth-2', 'ws-frontend', 'func authenticate() {}')

    await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )
  }

  it('reviews promoted candidates and emits confirmed issues', async () => {
    await createPromotedCandidate()

    expect(monitor.getPendingLayer2Candidates().length).toBe(1)

    const results = await monitor.runLayer2Review((id) => contents.get(id))

    expect(results.length).toBe(1)
    expect(results[0].confirmed).toBe(true)
    expect(reviewService.callCount).toBe(1)

    // Should emit a CoherenceEvent for confirmed issue
    const issues = monitor.getDetectedIssues()
    const confirmed = issues.find((i) => i.title.includes('Confirmed'))
    expect(confirmed).toBeDefined()
    expect(confirmed!.severity).toBe('medium')
  })

  it('marks reviewed candidates as dismissed (no re-review)', async () => {
    await createPromotedCandidate()

    await monitor.runLayer2Review((id) => contents.get(id))
    expect(monitor.getPendingLayer2Candidates().length).toBe(0)

    // Second review should be a no-op
    const secondResults = await monitor.runLayer2Review((id) => contents.get(id))
    expect(secondResults.length).toBe(0)
    expect(reviewService.callCount).toBe(1) // not called again
  })

  it('does not emit CoherenceEvent for dismissed candidates', async () => {
    reviewService.registerResponse('candidate-1', { confirmed: false })

    await createPromotedCandidate()
    const issuesBefore = monitor.getDetectedIssues().length

    await monitor.runLayer2Review((id) => contents.get(id))

    // No new confirmed issues
    const confirmedIssues = monitor.getDetectedIssues().filter((i) => i.title.includes('Confirmed'))
    expect(confirmedIssues.length).toBe(0)
  })

  it('returns empty when Layer 2 is disabled', async () => {
    const disabledMonitor = new CoherenceMonitor({ enableLayer2: false })
    disabledMonitor.setReviewService(reviewService)

    const results = await disabledMonitor.runLayer2Review(() => undefined)
    expect(results).toEqual([])
  })

  it('returns empty when no review service is set', async () => {
    const noServiceMonitor = new CoherenceMonitor({ enableLayer2: true })

    const results = await noServiceMonitor.runLayer2Review(() => undefined)
    expect(results).toEqual([])
  })

  it('returns empty when no pending candidates', async () => {
    const results = await monitor.runLayer2Review(() => undefined)
    expect(results).toEqual([])
    expect(reviewService.callCount).toBe(0)
  })

  it('respects rate limiting', async () => {
    const limitedMonitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 1,
      layer1PromotionThreshold: 0.85,
      layer1AdvisoryThreshold: 0.70,
      layer2MaxReviewsPerHour: 1,
      enableLayer2: true
    })
    limitedMonitor.setEmbeddingService(embeddingService)
    limitedMonitor.setReviewService(reviewService)

    // Create promoted candidate
    const [vecA, vecB] = createVectorsWithSimilarity(0.92, 8)
    embeddingService.registerEmbedding('content-a', vecA)
    embeddingService.registerEmbedding('content-b', vecB)

    const evA = makeArtifact({ artifactId: 'art-r1', workstream: 'ws-1', provenance: { createdBy: 'a', createdAt: new Date().toISOString() } })
    const evB = makeArtifact({ artifactId: 'art-r2', workstream: 'ws-2', provenance: { createdBy: 'a', createdAt: new Date().toISOString() } })
    artifacts.set('art-r1', evA)
    artifacts.set('art-r2', evB)
    contents.set('art-r1', 'content-a')
    contents.set('art-r2', 'content-b')
    limitedMonitor.processArtifact(evA)
    limitedMonitor.processArtifact(evB)

    await limitedMonitor.runLayer1Scan(1, (id) => artifacts.get(id), (id) => contents.get(id))

    // First review succeeds
    const r1 = await limitedMonitor.runLayer2Review((id) => contents.get(id))
    expect(r1.length).toBe(1)

    // Now add new promoted candidates
    const [vecC, vecD] = createVectorsWithSimilarity(0.95, 8)
    embeddingService.registerEmbedding('content-c', vecC)
    embeddingService.registerEmbedding('content-d', vecD)

    const evC = makeArtifact({ artifactId: 'art-r3', workstream: 'ws-3', provenance: { createdBy: 'a', createdAt: new Date().toISOString() } })
    const evD = makeArtifact({ artifactId: 'art-r4', workstream: 'ws-4', provenance: { createdBy: 'a', createdAt: new Date().toISOString() } })
    artifacts.set('art-r3', evC)
    artifacts.set('art-r4', evD)
    contents.set('art-r3', 'content-c')
    contents.set('art-r4', 'content-d')
    limitedMonitor.processArtifact(evC)
    limitedMonitor.processArtifact(evD)

    await limitedMonitor.runLayer1Scan(2, (id) => artifacts.get(id), (id) => contents.get(id))

    // Second review should be rate-limited
    const r2 = await limitedMonitor.runLayer2Review((id) => contents.get(id))
    expect(r2.length).toBe(0)

    expect(limitedMonitor.getRateLimiter().remaining()).toBe(0)
  })

  it('batches up to 5 candidates per review', async () => {
    // Create 7 promoted candidates. Use orthogonal base vectors for each pair
    // so that cross-pair similarity stays below threshold.
    // Need a fresh embedding service with enough dimensions (7 pairs * 2 dims = 14 needed).
    const wideEmbedding = new MockEmbeddingService(16)
    monitor.setEmbeddingService(wideEmbedding)

    for (let i = 0; i < 7; i++) {
      // Place pair in dimensions [i*2, i*2+1] with high similarity
      const vecA = new Array(16).fill(0)
      const vecB = new Array(16).fill(0)
      const angle = Math.acos(0.95)
      vecA[i * 2] = 1
      vecB[i * 2] = Math.cos(angle)
      vecB[i * 2 + 1] = Math.sin(angle)

      wideEmbedding.registerEmbedding(`pair-a-${i}`, vecA)
      wideEmbedding.registerEmbedding(`pair-b-${i}`, vecB)

      addArtifact(`art-a-${i}`, `ws-left-${i}`, `pair-a-${i}`)
      addArtifact(`art-b-${i}`, `ws-right-${i}`, `pair-b-${i}`)
    }

    await monitor.runLayer1Scan(1, (id) => artifacts.get(id), (id) => contents.get(id))

    const promoted = monitor.getPendingLayer2Candidates()
    expect(promoted.length).toBe(7)

    // First review should process 5
    const results = await monitor.runLayer2Review((id) => contents.get(id))
    expect(results.length).toBe(5)

    // 2 remaining
    expect(monitor.getPendingLayer2Candidates().length).toBe(2)
  })

  it('passes artifact content to review service', async () => {
    await createPromotedCandidate()

    await monitor.runLayer2Review((id) => contents.get(id))

    expect(reviewService.lastRequest).not.toBeNull()
    const req = reviewService.lastRequest!
    expect(req.artifactContents.size).toBeGreaterThan(0)
  })

  it('stores review results', async () => {
    await createPromotedCandidate()

    await monitor.runLayer2Review((id) => contents.get(id))

    expect(monitor.getReviewResults().length).toBe(1)
  })

  it('uses custom review responses for classification', async () => {
    reviewService.registerResponse('candidate-1', {
      confirmed: true,
      category: 'contradiction',
      severity: 'high',
      explanation: 'These two approaches are incompatible',
      notifyAgentIds: ['agent-x']
    })

    await createPromotedCandidate()
    await monitor.runLayer2Review((id) => contents.get(id))

    const issues = monitor.getDetectedIssues()
    const confirmed = issues.find((i) => i.title.includes('Confirmed'))
    expect(confirmed).toBeDefined()
    expect(confirmed!.category).toBe('contradiction')
    expect(confirmed!.severity).toBe('high')
  })
})

describe('CoherenceMonitor — end-to-end Layer 0 + 1 + 2 flow', () => {
  it('processes artifact through all layers', async () => {
    const monitor = new CoherenceMonitor({
      layer1ScanIntervalTicks: 1,
      layer1PromotionThreshold: 0.85,
      layer1AdvisoryThreshold: 0.70,
      enableLayer2: true
    })

    const embeddingService = new MockEmbeddingService(8)
    const reviewService = new MockCoherenceReviewService()
    monitor.setEmbeddingService(embeddingService)
    monitor.setReviewService(reviewService)

    const artifacts = new Map<string, ArtifactEvent>()
    const contents = new Map<string, string>()

    // Register similar embeddings
    const [vecA, vecB] = createVectorsWithSimilarity(0.93, 8)
    embeddingService.registerEmbedding('implement user auth', vecA)
    embeddingService.registerEmbedding('build authentication system', vecB)

    // Layer 0: Process artifacts (no file conflicts in this case)
    const evA = makeArtifact({
      artifactId: 'auth-module',
      agentId: 'agent-backend',
      workstream: 'ws-backend',
      provenance: { createdBy: 'agent-backend', createdAt: new Date().toISOString() }
    })
    const evB = makeArtifact({
      artifactId: 'auth-service',
      agentId: 'agent-frontend',
      workstream: 'ws-frontend',
      provenance: { createdBy: 'agent-frontend', createdAt: new Date().toISOString() }
    })

    artifacts.set('auth-module', evA)
    artifacts.set('auth-service', evB)
    contents.set('auth-module', 'implement user auth')
    contents.set('auth-service', 'build authentication system')

    expect(monitor.processArtifact(evA)).toBeUndefined() // no conflict
    expect(monitor.processArtifact(evB)).toBeUndefined() // no conflict (different paths)

    // Layer 1: Scan should find the similar pair
    const candidates = await monitor.runLayer1Scan(
      1,
      (id) => artifacts.get(id),
      (id) => contents.get(id)
    )

    expect(candidates.length).toBe(1)
    expect(candidates[0].promotedToLayer2).toBe(true)
    expect(candidates[0].similarityScore).toBeGreaterThan(0.85)

    // Layer 2: Review should confirm the issue
    reviewService.registerResponse(candidates[0].candidateId, {
      confirmed: true,
      category: 'duplication',
      severity: 'high',
      explanation: 'Both agents are implementing authentication independently',
      suggestedResolution: 'Consolidate auth implementation into the backend workstream'
    })

    const reviews = await monitor.runLayer2Review((id) => contents.get(id))

    expect(reviews.length).toBe(1)
    expect(reviews[0].confirmed).toBe(true)
    expect(reviews[0].category).toBe('duplication')

    // Should have emitted a confirmed CoherenceEvent
    const issues = monitor.getDetectedIssues()
    const confirmed = issues.find((i) => i.title.includes('Confirmed'))
    expect(confirmed).toBeDefined()
    expect(confirmed!.description).toContain('Both agents are implementing authentication independently')
    expect(confirmed!.affectedArtifactIds).toContain('auth-module')
    expect(confirmed!.affectedArtifactIds).toContain('auth-service')
  })
})
