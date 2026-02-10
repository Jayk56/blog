import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventBus } from '../src/bus'
import type { EventEnvelope } from '../src/types'

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  const defaultEvent: EventEnvelope = {
    sourceEventId: 'evt-1',
    sourceSequence: 1,
    sourceOccurredAt: '2026-02-10T00:00:00.000Z',
    runId: 'run-1',
    ingestedAt: '2026-02-10T00:00:01.000Z',
    event: {
      type: 'status',
      agentId: 'agent-a',
      message: 'hello'
    }
  }

  return {
    ...defaultEvent,
    ...overrides,
    event: overrides.event ?? defaultEvent.event
  }
}

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus(10_000)
  })

  it('publishes to catch-all subscribers', () => {
    const seen: EventEnvelope[] = []
    bus.subscribe({}, (envelope) => seen.push(envelope))

    const envelope = makeEnvelope()
    bus.publish(envelope)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.sourceEventId).toBe('evt-1')
  })

  it('filters by agentId', () => {
    const seen: string[] = []
    bus.subscribe({ agentId: 'agent-a' }, (envelope) => seen.push(envelope.event.agentId))

    bus.publish(makeEnvelope({ sourceEventId: 'evt-a', event: { type: 'status', agentId: 'agent-a', message: 'a' } }))
    bus.publish(makeEnvelope({ sourceEventId: 'evt-b', event: { type: 'status', agentId: 'agent-b', message: 'b' } }))

    expect(seen).toEqual(['agent-a'])
  })

  it('filters by event type', () => {
    const seen: string[] = []
    bus.subscribe({ eventType: 'artifact' }, (envelope) => seen.push(envelope.event.type))

    bus.publish(makeEnvelope({ sourceEventId: 'evt-1', event: { type: 'status', agentId: 'agent-a', message: 'x' } }))
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-2',
        event: {
          type: 'artifact',
          agentId: 'agent-a',
          artifactId: 'art-1',
          name: 'file.ts',
          kind: 'code',
          workstream: 'core',
          status: 'draft',
          qualityScore: 0.8,
          provenance: { createdBy: 'agent-a', createdAt: '2026-02-10T00:00:00.000Z' }
        }
      })
    )

    expect(seen).toEqual(['artifact'])
  })

  it('deduplicates by sourceEventId', () => {
    const seen: string[] = []
    bus.subscribe({}, (envelope) => seen.push(envelope.sourceEventId))

    const envelope = makeEnvelope({ sourceEventId: 'evt-dup' })

    expect(bus.publish(envelope)).toBe(true)
    expect(bus.publish(envelope)).toBe(false)

    expect(seen).toEqual(['evt-dup'])
    expect(bus.getMetrics().totalDeduplicated).toBe(1)
  })

  it('detects sequence gaps per agent and run', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    bus.publish(makeEnvelope({ sourceEventId: 'evt-1', sourceSequence: 1 }))
    bus.publish(makeEnvelope({ sourceEventId: 'evt-2', sourceSequence: 4 }))

    const warnings = bus.getSequenceGapWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.previousSequence).toBe(1)
    expect(warnings[0]?.currentSequence).toBe(4)

    warnSpy.mockRestore()
  })

  it('unsubscribes subscribers cleanly', () => {
    const seen: string[] = []
    const id = bus.subscribe({}, (envelope) => seen.push(envelope.sourceEventId))

    bus.unsubscribe(id)
    bus.publish(makeEnvelope({ sourceEventId: 'evt-after-unsub' }))

    expect(seen).toHaveLength(0)
  })

  it('includes totalDropped in metrics', () => {
    const metrics = bus.getMetrics()
    expect(metrics.totalDropped).toBe(0)
  })
})

describe('EventBus backpressure', () => {
  it('does not drop events when under the per-agent queue limit', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 10 })
    const seen: string[] = []
    bus.subscribe({}, (envelope) => seen.push(envelope.sourceEventId))

    for (let i = 0; i < 10; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-${i}`,
          sourceSequence: i,
          event: { type: 'status', agentId: 'agent-a', message: `msg-${i}` }
        })
      )
    }

    expect(seen).toHaveLength(10)
    expect(bus.getMetrics().totalDropped).toBe(0)
  })

  it('drops oldest low-priority events when queue exceeds limit', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 5 })
    const seen: string[] = []
    bus.subscribe({}, (envelope) => seen.push(envelope.sourceEventId))

    // Fill queue to 5 with low-priority status events
    for (let i = 0; i < 5; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-${i}`,
          sourceSequence: i,
          event: { type: 'status', agentId: 'agent-a', message: `msg-${i}` }
        })
      )
    }

    // Push one more - this should trigger dropping the oldest low-priority event
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-overflow',
        sourceSequence: 5,
        event: { type: 'status', agentId: 'agent-a', message: 'overflow' }
      })
    )

    // All 6 events + 1 backpressure warning were delivered to subscribers
    expect(seen).toHaveLength(7)
    // But 1 was dropped from the queue
    expect(bus.getMetrics().totalDropped).toBe(1)
    expect(bus.getAgentQueueSize('agent-a')).toBe(5)
  })

  it('preserves high-priority events during backpressure drops', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 5 })
    const seen: EventEnvelope[] = []
    bus.subscribe({}, (envelope) => seen.push(envelope))

    // Add 3 high-priority events (decision, artifact, error)
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-decision',
        sourceSequence: 0,
        event: {
          type: 'decision',
          subtype: 'option',
          agentId: 'agent-a',
          decisionId: 'd1',
          title: 'Test',
          summary: 'Test decision',
          severity: 'medium',
          confidence: 0.8,
          blastRadius: 'small',
          options: [{ id: 'o1', label: 'Option 1', description: 'desc' }],
          affectedArtifactIds: [],
          requiresRationale: false
        }
      })
    )

    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-artifact',
        sourceSequence: 1,
        event: {
          type: 'artifact',
          agentId: 'agent-a',
          artifactId: 'art-1',
          name: 'file.ts',
          kind: 'code',
          workstream: 'core',
          status: 'draft',
          qualityScore: 0.8,
          provenance: { createdBy: 'agent-a', createdAt: '2026-02-10T00:00:00.000Z' }
        }
      })
    )

    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-error',
        sourceSequence: 2,
        event: {
          type: 'error',
          agentId: 'agent-a',
          severity: 'high',
          message: 'test error',
          recoverable: true,
          category: 'internal'
        }
      })
    )

    // Fill remaining 2 slots with low-priority
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-tool1',
        sourceSequence: 3,
        event: {
          type: 'tool_call',
          agentId: 'agent-a',
          toolCallId: 'tc1',
          toolName: 'bash',
          phase: 'completed',
          input: {},
          approved: true
        }
      })
    )

    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-tool2',
        sourceSequence: 4,
        event: {
          type: 'tool_call',
          agentId: 'agent-a',
          toolCallId: 'tc2',
          toolName: 'bash',
          phase: 'completed',
          input: {},
          approved: true
        }
      })
    )

    // Queue is now full (5). Add one more low-priority event.
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-overflow-tool',
        sourceSequence: 5,
        event: {
          type: 'tool_call',
          agentId: 'agent-a',
          toolCallId: 'tc3',
          toolName: 'bash',
          phase: 'completed',
          input: {},
          approved: true
        }
      })
    )

    // Queue should still be 5 (dropped one low-priority)
    expect(bus.getAgentQueueSize('agent-a')).toBe(5)
    expect(bus.getMetrics().totalDropped).toBe(1)

    // All 6 events were delivered to subscriber (delivery happens before dropping)
    expect(seen).toHaveLength(6 + 1) // +1 for the backpressure warning ErrorEvent
  })

  it('emits backpressure warning ErrorEvent when drops occur', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 3 })
    const warnings: EventEnvelope[] = []
    bus.subscribe({}, (envelope) => {
      if (envelope.event.type === 'error' && envelope.event.message.includes('backpressure')) {
        warnings.push(envelope)
      }
    })

    // Fill queue
    for (let i = 0; i < 3; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-${i}`,
          sourceSequence: i,
          event: { type: 'status', agentId: 'agent-a', message: `msg-${i}` }
        })
      )
    }

    // Trigger overflow
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-over',
        sourceSequence: 3,
        event: { type: 'status', agentId: 'agent-a', message: 'overflow' }
      })
    )

    expect(warnings).toHaveLength(1)
    const warningEvt = warnings[0]!.event
    expect(warningEvt.type).toBe('error')
    if (warningEvt.type === 'error') {
      expect(warningEvt.severity).toBe('warning')
      expect(warningEvt.message).toContain('backpressure')
      expect(warningEvt.message).toContain('agent-a')
      expect(warningEvt.recoverable).toBe(true)
      expect(warningEvt.category).toBe('internal')
    }
  })

  it('keeps separate queues per agent', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 3 })
    bus.subscribe({}, () => {})

    // Fill agent-a queue
    for (let i = 0; i < 3; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-a-${i}`,
          sourceSequence: i,
          event: { type: 'status', agentId: 'agent-a', message: `a-${i}` }
        })
      )
    }

    // Fill agent-b queue
    for (let i = 0; i < 3; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-b-${i}`,
          sourceSequence: i,
          event: { type: 'status', agentId: 'agent-b', message: `b-${i}` }
        })
      )
    }

    expect(bus.getAgentQueueSize('agent-a')).toBe(3)
    expect(bus.getAgentQueueSize('agent-b')).toBe(3)

    // Overflow agent-a only
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-a-over',
        sourceSequence: 3,
        event: { type: 'status', agentId: 'agent-a', message: 'overflow' }
      })
    )

    expect(bus.getAgentQueueSize('agent-a')).toBe(3)
    expect(bus.getAgentQueueSize('agent-b')).toBe(3) // unaffected
    expect(bus.getMetrics().totalDropped).toBe(1)
  })

  it('drops non-high-priority events when no low-priority events remain', () => {
    const bus = new EventBus(10_000, { maxQueuePerAgent: 3 })
    bus.subscribe({}, () => {})

    // Fill with medium-priority events (lifecycle, delegation, guardrail, etc.)
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-lc1',
        sourceSequence: 0,
        event: { type: 'lifecycle', agentId: 'agent-a', action: 'started', reason: 'test' }
      })
    )
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-lc2',
        sourceSequence: 1,
        event: { type: 'lifecycle', agentId: 'agent-a', action: 'paused', reason: 'test' }
      })
    )
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-lc3',
        sourceSequence: 2,
        event: { type: 'lifecycle', agentId: 'agent-a', action: 'resumed', reason: 'test' }
      })
    )

    // Overflow with a high-priority event -- should drop one lifecycle
    bus.publish(
      makeEnvelope({
        sourceEventId: 'evt-decision-hp',
        sourceSequence: 3,
        event: {
          type: 'decision',
          subtype: 'option',
          agentId: 'agent-a',
          decisionId: 'd1',
          title: 'Test',
          summary: 'Test',
          severity: 'medium',
          confidence: 0.8,
          blastRadius: 'small',
          options: [{ id: 'o1', label: 'Option 1', description: 'desc' }],
          affectedArtifactIds: [],
          requiresRationale: false
        }
      })
    )

    expect(bus.getAgentQueueSize('agent-a')).toBe(3)
    expect(bus.getMetrics().totalDropped).toBe(1)
  })

  it('drops oldest high-priority events when high-priority hard cap is exceeded', () => {
    // maxQueuePerAgent=3, maxHighPriorityPerAgent=5
    const bus = new EventBus(10_000, { maxQueuePerAgent: 3, maxHighPriorityPerAgent: 5 })
    bus.subscribe({}, () => {})

    // Fill with 6 high-priority decision events (exceeds hard cap of 5)
    for (let i = 0; i < 6; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-hp-${i}`,
          sourceSequence: i,
          event: {
            type: 'decision',
            subtype: 'option',
            agentId: 'agent-a',
            decisionId: `d${i}`,
            title: `Decision ${i}`,
            summary: 'Test',
            severity: 'medium',
            confidence: 0.8,
            blastRadius: 'small',
            options: [{ id: 'o1', label: 'Option 1', description: 'desc' }],
            affectedArtifactIds: [],
            requiresRationale: false
          }
        })
      )
    }

    // Queue should be capped at the high-priority limit (5)
    expect(bus.getAgentQueueSize('agent-a')).toBe(5)
    // Dropped: 3 events exceeded normal cap, but they're all high-priority so
    // first pass (low-priority) drops 0, second pass (non-high) drops 0,
    // then high-priority cap drops oldest. Total dropped across all publishes >= 1
    expect(bus.getMetrics().totalDropped).toBeGreaterThanOrEqual(1)
  })

  it('uses default high-priority cap of 2x maxQueuePerAgent', () => {
    // maxQueuePerAgent=3, default maxHighPriorityPerAgent=6
    const bus = new EventBus(10_000, { maxQueuePerAgent: 3 })
    bus.subscribe({}, () => {})

    // Fill with 7 high-priority events (exceeds default 2x cap of 6)
    for (let i = 0; i < 7; i++) {
      bus.publish(
        makeEnvelope({
          sourceEventId: `evt-hp-def-${i}`,
          sourceSequence: i,
          event: {
            type: 'error',
            agentId: 'agent-a',
            severity: 'high',
            message: `error ${i}`,
            recoverable: true,
            category: 'internal'
          }
        })
      )
    }

    // Default hard cap is 2*3 = 6
    expect(bus.getAgentQueueSize('agent-a')).toBe(6)
    expect(bus.getMetrics().totalDropped).toBeGreaterThanOrEqual(1)
  })

  it('returns 0 for unknown agent queue size', () => {
    const bus = new EventBus()
    expect(bus.getAgentQueueSize('nonexistent')).toBe(0)
  })
})
