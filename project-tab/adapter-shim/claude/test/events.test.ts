/**
 * Tests for EventFactory sequencing and envelope generation.
 */

import { describe, it, expect } from 'vitest'
import { EventFactory } from '../src/events.js'
import type { StatusEvent, LifecycleEvent } from '../src/models.js'

describe('EventFactory', () => {
  it('produces monotonic sequence numbers', () => {
    const factory = new EventFactory('run-1')
    const e1 = factory.wrap({ type: 'status', agentId: 'a1', message: 'first' } as StatusEvent)
    const e2 = factory.wrap({ type: 'status', agentId: 'a1', message: 'second' } as StatusEvent)
    const e3 = factory.wrap({ type: 'status', agentId: 'a1', message: 'third' } as StatusEvent)
    expect(e1.sourceSequence).toBe(1)
    expect(e2.sourceSequence).toBe(2)
    expect(e3.sourceSequence).toBe(3)
  })

  it('generates unique event IDs', () => {
    const factory = new EventFactory('run-1')
    const e1 = factory.wrap({ type: 'status', agentId: 'a1', message: 'one' } as StatusEvent)
    const e2 = factory.wrap({ type: 'status', agentId: 'a1', message: 'two' } as StatusEvent)
    expect(e1.sourceEventId).not.toBe(e2.sourceEventId)
  })

  it('preserves run ID', () => {
    const factory = new EventFactory('run-42')
    const e = factory.wrap({ type: 'lifecycle', agentId: 'a1', action: 'started' } as LifecycleEvent)
    expect(e.runId).toBe('run-42')
  })

  it('produces ISO 8601 timestamps', () => {
    const factory = new EventFactory('run-1')
    const e = factory.wrap({ type: 'status', agentId: 'a1', message: 'test' } as StatusEvent)
    expect(e.sourceOccurredAt).toContain('T')
  })

  it('tracks lastSequence', () => {
    const factory = new EventFactory('run-1')
    expect(factory.lastSequence).toBe(0)
    factory.wrap({ type: 'status', agentId: 'a1', message: 'one' } as StatusEvent)
    expect(factory.lastSequence).toBe(1)
    factory.wrap({ type: 'status', agentId: 'a1', message: 'two' } as StatusEvent)
    expect(factory.lastSequence).toBe(2)
  })

  it('preserves event payload', () => {
    const factory = new EventFactory('run-1')
    const inner: LifecycleEvent = { type: 'lifecycle', agentId: 'agent-x', action: 'started', reason: 'boot' }
    const envelope = factory.wrap(inner)
    expect(envelope.event.type).toBe('lifecycle')
    expect((envelope.event as LifecycleEvent).agentId).toBe('agent-x')
    expect((envelope.event as LifecycleEvent).action).toBe('started')
    expect((envelope.event as LifecycleEvent).reason).toBe('boot')
  })
})
