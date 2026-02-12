import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import { EventStreamClient, type WebSocketFactory } from '../../src/gateway/event-stream-client'
import { EventBus } from '../../src/bus'
import type { EventEnvelope, ErrorEvent } from '../../src/types'
import { clearQuarantine, getQuarantined } from '../../src/validation/quarantine'

/** Minimal mock WebSocket that extends EventEmitter. */
class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = []
  readyState = 1 // OPEN

  constructor(public url: string) {
    super()
    MockWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = 3 // CLOSED
  }

  /** Simulate receiving a message. */
  simulateMessage(data: string): void {
    this.emit('message', Buffer.from(data))
  }

  /** Simulate connection open. */
  simulateOpen(): void {
    this.emit('open')
  }

  /** Simulate connection close. */
  simulateClose(): void {
    this.emit('close')
  }

  /** Simulate error. */
  simulateError(err: Error): void {
    this.emit('error', err)
  }
}

function makeValidEvent() {
  return {
    sourceEventId: 'evt-1',
    sourceSequence: 1,
    sourceOccurredAt: '2026-02-10T00:00:00.000Z',
    runId: 'run-1',
    event: {
      type: 'status',
      agentId: 'agent-1',
      message: 'working',
    },
  }
}

describe('EventStreamClient', () => {
  let eventBus: EventBus

  beforeEach(() => {
    MockWebSocket.instances = []
    eventBus = new EventBus()
    clearQuarantine()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeClient(overrides: Partial<{
    url: string
    agentId: string
    eventBus: EventBus
    maxReconnectDelayMs: number
    initialReconnectDelayMs: number
    onDisconnect: () => void
    WebSocketCtor: WebSocketFactory
  }> = {}) {
    return new EventStreamClient({
      url: 'ws://localhost:9100/events',
      agentId: 'agent-1',
      eventBus,
      WebSocketCtor: MockWebSocket as unknown as WebSocketFactory,
      ...overrides,
    })
  }

  it('creates a WebSocket connection on connect()', () => {
    const client = makeClient()
    client.connect()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:9100/events')

    client.close()
  })

  it('publishes valid events to the EventBus', () => {
    const client = makeClient()
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    ws.simulateMessage(JSON.stringify(makeValidEvent()))

    expect(seen).toHaveLength(1)
    expect(seen[0]!.sourceEventId).toBe('evt-1')
    expect(seen[0]!.event.type).toBe('status')
    expect(seen[0]!.ingestedAt).toBeDefined()

    client.close()
  })

  it('quarantines invalid events and emits warning ErrorEvent instead of original', () => {
    const client = makeClient()
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    // Invalid: missing runId and agentId in event
    ws.simulateMessage(JSON.stringify({
      sourceEventId: 'evt-bad',
      sourceSequence: 1,
      sourceOccurredAt: 'not-a-date',
      event: { type: 'status', message: 'no agentId' },
    }))

    // Should NOT publish the original event, but SHOULD publish a warning ErrorEvent
    expect(seen).toHaveLength(1)
    expect(seen[0]!.event.type).toBe('error')
    const errorEvt = seen[0]!.event as ErrorEvent
    expect(errorEvt.severity).toBe('warning')
    expect(errorEvt.recoverable).toBe(true)
    expect(errorEvt.category).toBe('internal')
    expect(errorEvt.message).toContain('Malformed adapter event quarantined')

    client.close()
  })

  it('emits warning ErrorEvent for non-JSON messages', () => {
    const client = makeClient()
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    ws.simulateMessage('this is not json {{{')

    // Should emit a warning ErrorEvent for the non-JSON message
    expect(seen).toHaveLength(1)
    expect(seen[0]!.event.type).toBe('error')
    const errorEvt = seen[0]!.event as ErrorEvent
    expect(errorEvt.severity).toBe('warning')
    expect(errorEvt.recoverable).toBe(true)
    expect(errorEvt.category).toBe('internal')
    expect(errorEvt.message).toContain('non-JSON')

    client.close()
  })

  it('resets reconnect attempts on successful open', () => {
    const client = makeClient()
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    expect(client.currentReconnectAttempts).toBe(0)

    client.close()
  })

  it('schedules reconnect with exponential backoff on close', () => {
    const client = makeClient({
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
    })
    client.connect()

    const ws1 = MockWebSocket.instances[0]!
    ws1.simulateOpen()
    ws1.simulateClose()

    expect(client.currentReconnectAttempts).toBe(1)
    expect(MockWebSocket.instances).toHaveLength(1) // Not yet reconnected

    // Advance past first reconnect delay (100ms)
    vi.advanceTimersByTime(100)
    expect(MockWebSocket.instances).toHaveLength(2) // Reconnected

    // Second disconnect
    const ws2 = MockWebSocket.instances[1]!
    ws2.simulateClose()
    expect(client.currentReconnectAttempts).toBe(2)

    // Second delay should be 200ms (100 * 2^1)
    vi.advanceTimersByTime(199)
    expect(MockWebSocket.instances).toHaveLength(2) // Not yet
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(3) // Now reconnected

    client.close()
  })

  it('caps reconnect delay at maxReconnectDelayMs', () => {
    const client = makeClient({
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 500,
    })
    client.connect()

    // Simulate many disconnects to push backoff past max
    for (let i = 0; i < 10; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!
      ws.simulateOpen()
      ws.simulateClose()
      // Advance enough time for the max delay
      vi.advanceTimersByTime(500)
    }

    // The 10th reconnect attempt should still work
    expect(MockWebSocket.instances.length).toBeGreaterThan(5)

    client.close()
  })

  it('calls onDisconnect callback when connection drops', () => {
    const onDisconnect = vi.fn()
    const client = makeClient({ onDisconnect })
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()
    ws.simulateClose()

    expect(onDisconnect).toHaveBeenCalledOnce()

    client.close()
  })

  it('does not reconnect after close()', () => {
    const client = makeClient({ initialReconnectDelayMs: 100 })
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()
    client.close()

    expect(client.isClosed).toBe(true)

    // Even if close event fires, should not reconnect
    ws.simulateClose()
    vi.advanceTimersByTime(10_000)

    expect(MockWebSocket.instances).toHaveLength(1) // No new connections
  })

  it('does not connect when already closed', () => {
    const client = makeClient()
    client.close()
    client.connect()

    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('rejects events with mismatched agentId', () => {
    const client = makeClient({ agentId: 'agent-1' })
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    // Send event with a different agentId
    const mismatchedEvent = {
      sourceEventId: 'evt-wrong-agent',
      sourceSequence: 1,
      sourceOccurredAt: '2026-02-10T00:00:00.000Z',
      runId: 'run-1',
      event: {
        type: 'status',
        agentId: 'agent-other',
        message: 'should be rejected',
      },
    }
    ws.simulateMessage(JSON.stringify(mismatchedEvent))

    expect(seen).toHaveLength(0)

    client.close()
  })

  it('accepts events with matching agentId', () => {
    const client = makeClient({ agentId: 'agent-1' })
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    ws.simulateMessage(JSON.stringify(makeValidEvent()))

    expect(seen).toHaveLength(1)
    expect(seen[0]!.event.agentId).toBe('agent-1')

    client.close()
  })

  it('handles multiple valid events in sequence', () => {
    const client = makeClient()
    client.connect()

    const ws = MockWebSocket.instances[0]!
    ws.simulateOpen()

    const seen: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => seen.push(env))

    const evt1 = makeValidEvent()
    const evt2 = { ...makeValidEvent(), sourceEventId: 'evt-2', sourceSequence: 2 }
    const evt3 = { ...makeValidEvent(), sourceEventId: 'evt-3', sourceSequence: 3 }

    ws.simulateMessage(JSON.stringify(evt1))
    ws.simulateMessage(JSON.stringify(evt2))
    ws.simulateMessage(JSON.stringify(evt3))

    expect(seen).toHaveLength(3)
    expect(seen.map((e) => e.sourceEventId)).toEqual(['evt-1', 'evt-2', 'evt-3'])

    client.close()
  })

  describe('quarantine pipeline', () => {
    it('stores malformed event in quarantine and emits warning', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      ws.simulateMessage(JSON.stringify({
        sourceEventId: 'evt-bad',
        sourceSequence: 1,
        sourceOccurredAt: '2026-02-10T00:00:00.000Z',
        runId: 'run-1',
        event: { type: 'status', message: 'missing agentId' },
      }))

      // Quarantine should have the malformed event
      const quarantined = getQuarantined()
      expect(quarantined).toHaveLength(1)
      expect(quarantined[0]!.quarantinedAt).toBeTypeOf('string')
      expect(quarantined[0]!.raw).toBeDefined()

      // Warning should be emitted
      expect(seen).toHaveLength(1)
      expect(seen[0]!.event.type).toBe('error')

      client.close()
    })

    it('warning event uses client agentId as the error agentId', () => {
      const client = makeClient({ agentId: 'agent-xyz' })
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      ws.simulateMessage(JSON.stringify({
        sourceEventId: 'evt-bad',
        sourceSequence: 0,
        sourceOccurredAt: 'invalid-date',
        event: { type: 'unknown_type' },
      }))

      expect(seen).toHaveLength(1)
      expect(seen[0]!.event.agentId).toBe('agent-xyz')

      client.close()
    })

    it('warning event sourceEventId starts with quarantine- prefix', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      ws.simulateMessage(JSON.stringify({ garbage: true }))

      expect(seen).toHaveLength(1)
      expect(seen[0]!.sourceEventId).toMatch(/^quarantine-/)

      client.close()
    })

    it('warning event has ingestedAt and sourceOccurredAt timestamps', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      ws.simulateMessage(JSON.stringify({ garbage: true }))

      expect(seen).toHaveLength(1)
      expect(seen[0]!.ingestedAt).toBeTypeOf('string')
      expect(seen[0]!.sourceOccurredAt).toBeTypeOf('string')

      client.close()
    })

    it('valid events pass through unchanged with EventEnvelope wrapping', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const validEvent = makeValidEvent()
      ws.simulateMessage(JSON.stringify(validEvent))

      expect(seen).toHaveLength(1)
      expect(seen[0]!.sourceEventId).toBe(validEvent.sourceEventId)
      expect(seen[0]!.sourceSequence).toBe(validEvent.sourceSequence)
      expect(seen[0]!.sourceOccurredAt).toBe(validEvent.sourceOccurredAt)
      expect(seen[0]!.runId).toBe(validEvent.runId)
      expect(seen[0]!.event).toEqual(validEvent.event)
      expect(seen[0]!.ingestedAt).toBeTypeOf('string')

      client.close()
    })

    it('quarantine warning includes validation error details in message', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      // Missing required fields: runId and agentId
      ws.simulateMessage(JSON.stringify({
        sourceEventId: 'evt-partial',
        sourceSequence: 1,
        sourceOccurredAt: 'not-a-datetime',
        event: { type: 'status', message: 'no agent' },
      }))

      expect(seen).toHaveLength(1)
      const errorEvt = seen[0]!.event as ErrorEvent
      expect(errorEvt.message).toContain('Malformed adapter event quarantined')
      // The message should contain the validation error text
      expect(errorEvt.message.length).toBeGreaterThan(30)

      client.close()
    })

    it('multiple quarantined events produce multiple warnings', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      ws.simulateMessage(JSON.stringify({ bad: 1 }))
      ws.simulateMessage(JSON.stringify({ bad: 2 }))
      ws.simulateMessage('not json')

      // 3 quarantine warnings (2 malformed JSON + 1 non-JSON)
      const warnings = seen.filter((e) => e.event.type === 'error')
      expect(warnings).toHaveLength(3)

      // Quarantine store should have 2 entries (non-JSON doesn't go through quarantineEvent)
      const quarantined = getQuarantined()
      expect(quarantined).toHaveLength(2)

      client.close()
    })

    it('mixed valid and invalid events are handled correctly', () => {
      const client = makeClient()
      client.connect()

      const ws = MockWebSocket.instances[0]!
      ws.simulateOpen()

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      // Send: valid, invalid, valid
      ws.simulateMessage(JSON.stringify(makeValidEvent()))
      ws.simulateMessage(JSON.stringify({ bad: true }))
      ws.simulateMessage(JSON.stringify({ ...makeValidEvent(), sourceEventId: 'evt-2', sourceSequence: 2 }))

      // Should see: valid event, quarantine warning, valid event
      expect(seen).toHaveLength(3)
      expect(seen[0]!.event.type).toBe('status')
      expect(seen[1]!.event.type).toBe('error')
      expect(seen[2]!.event.type).toBe('status')

      client.close()
    })
  })
})
