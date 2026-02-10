/**
 * Tests for the WebSocket /events endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { makeTestBrief, startTestServer, type TestClient } from './helpers.js'
import type http from 'node:http'
import type { AdapterEvent, LifecycleEvent, OptionDecisionEvent } from '../src/models.js'

function connectWs(baseUrl: string): Promise<WebSocket> {
  const wsUrl = baseUrl.replace('http://', 'ws://') + '/events'
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/**
 * Collect events from WS. Resolves when `count` events received, or on timeout.
 * Uses a fresh listener each call so multiple calls in the same test work.
 */
function receiveEvents(ws: WebSocket, count: number, timeoutMs = 5000): Promise<AdapterEvent[]> {
  return new Promise((resolve) => {
    const events: AdapterEvent[] = []
    const timeout = setTimeout(() => {
      ws.removeListener('message', onMessage)
      resolve(events)
    }, timeoutMs)

    function onMessage(data: WebSocket.RawData) {
      const event = JSON.parse(data.toString()) as AdapterEvent
      events.push(event)
      if (events.length >= count) {
        clearTimeout(timeout)
        ws.removeListener('message', onMessage)
        resolve(events)
      }
    }

    ws.on('message', onMessage)
  })
}

describe('WebSocket /events', () => {
  let client: TestClient
  let baseUrl: string
  let server: http.Server
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    baseUrl = srv.baseUrl
    server = srv.server
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('receives events including lifecycle(started) after spawn', async () => {
    // Connect WS first, then spawn to ensure we catch the first events
    const ws = await connectWs(baseUrl)
    const eventPromise = receiveEvents(ws, 5, 3000)

    // Small delay to ensure WS is fully ready
    await new Promise(r => setTimeout(r, 50))
    await client.post('/spawn', makeTestBrief())

    const events = await eventPromise
    expect(events.length).toBeGreaterThanOrEqual(1)

    // First event should be lifecycle(started)
    const first = events[0]
    expect(first.event.type).toBe('lifecycle')
    expect((first.event as LifecycleEvent).action).toBe('started')
    expect(first.sourceEventId).toBeDefined()
    expect(first.sourceSequence).toBeDefined()
    expect(first.runId).toBeDefined()

    ws.close()
  })
})

describe('WebSocket full sequence', () => {
  let client: TestClient
  let baseUrl: string
  let server: http.Server
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    baseUrl = srv.baseUrl
    server = srv.server
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('streams full mock event sequence', { timeout: 15000 }, async () => {
    // Connect WS first, set up persistent listener before spawning
    const ws = await connectWs(baseUrl)
    const allEvents: AdapterEvent[] = []
    let decisionId: string | null = null
    let resolvedDecision = false

    const done = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 12000)

      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as AdapterEvent
        allEvents.push(event)

        // When we see the decision, resolve it (fire-and-forget)
        if (event.event.type === 'decision' && !resolvedDecision) {
          resolvedDecision = true
          decisionId = (event.event as OptionDecisionEvent).decisionId
          client.post('/resolve', {
            decisionId,
            resolution: {
              type: 'option',
              chosenOptionId: 'opt-hybrid',
              rationale: 'Good balance',
              actionKind: 'create',
            },
          })
        }

        // When we see completion, we're done
        if (event.event.type === 'completion') {
          clearTimeout(timeout)
          setTimeout(() => resolve(), 100)
        }
      })
    })

    // Now spawn — the listener is already active
    await new Promise(r => setTimeout(r, 50))
    await client.post('/spawn', makeTestBrief())

    await done

    expect(decisionId).not.toBeNull()

    const types = allEvents.map(e => e.event.type)
    expect(types).toContain('lifecycle')
    expect(types).toContain('status')
    expect(types).toContain('tool_call')
    expect(types).toContain('decision')
    expect(types).toContain('artifact')
    expect(types).toContain('completion')

    // Verify sequencing is monotonic
    const sequences = allEvents.map(e => e.sourceSequence)
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1])
    }

    // Verify all share the same runId
    const runIds = new Set(allEvents.map(e => e.runId))
    expect(runIds.size).toBe(1)

    ws.close()
  })
})

describe('WebSocket camelCase serialization', () => {
  let client: TestClient
  let baseUrl: string
  let server: http.Server
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    baseUrl = srv.baseUrl
    server = srv.server
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('uses camelCase field names on the wire', async () => {
    // Connect WS first, then spawn
    const ws = await connectWs(baseUrl)
    await new Promise(r => setTimeout(r, 50))

    await client.post('/spawn', makeTestBrief())
    const events = await receiveEvents(ws, 1, 2000)
    expect(events.length).toBeGreaterThanOrEqual(1)
    const data = events[0] as any

    // Top-level envelope fields must be camelCase
    expect(data.sourceEventId).toBeDefined()
    expect(data.sourceSequence).toBeDefined()
    expect(data.sourceOccurredAt).toBeDefined()
    expect(data.runId).toBeDefined()
    expect(data.event).toBeDefined()

    // No snake_case at top level
    expect(data.source_event_id).toBeUndefined()
    expect(data.source_sequence).toBeUndefined()

    // Inner event should use camelCase too
    expect(data.event.agentId).toBeDefined()
    expect(data.event.agent_id).toBeUndefined()

    ws.close()
  })
})
