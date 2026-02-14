import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import express from 'express'

import { listenEphemeral } from '../helpers/listen-ephemeral'
import { createToolGateRouter, classifySeverity, classifyBlastRadius } from '../../src/routes/tool-gate'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import type { AgentRegistry } from '../../src/types/service-interfaces'
import type { AgentHandle } from '../../src/types'

// ── Test helpers ─────────────────────────────────────────────────

function createMockRegistry(handles: Map<string, AgentHandle> = new Map()): AgentRegistry {
  return {
    getHandle: (id: string) => handles.get(id) ?? null,
    listHandles: () => Array.from(handles.values()),
    registerHandle: (handle: AgentHandle) => { handles.set(handle.id, handle) },
    updateHandle: () => {},
    removeHandle: (id: string) => { handles.delete(id) },
  }
}

function createTestApp() {
  const eventBus = new EventBus()
  const tickService = new TickService({ mode: 'manual' })
  const decisionQueue = new DecisionQueue({ timeoutTicks: 100 })
  const handles = new Map<string, AgentHandle>()
  handles.set('agent-1', { id: 'agent-1', pluginName: 'test', status: 'running', sessionId: 's1' })
  const registry = createMockRegistry(handles)

  const deps = { decisionQueue, eventBus, tickService, registry }

  const app = express()
  app.use(express.json())
  app.use('/api/tool-gate', createToolGateRouter(deps))

  const server = createServer(app as any)
  let baseUrl = ''

  return {
    app, server, deps,
    get baseUrl() { return baseUrl },
    async start() {
      const port = await listenEphemeral(server)
      baseUrl = `http://localhost:${port}`
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('classifySeverity', () => {
  it('returns high for Bash', () => {
    expect(classifySeverity('Bash')).toBe('high')
  })

  it('returns medium for Write and Edit', () => {
    expect(classifySeverity('Write')).toBe('medium')
    expect(classifySeverity('Edit')).toBe('medium')
  })

  it('returns low for other tools', () => {
    expect(classifySeverity('Read')).toBe('low')
    expect(classifySeverity('Glob')).toBe('low')
  })
})

describe('classifyBlastRadius', () => {
  it('returns large for Bash', () => {
    expect(classifyBlastRadius('Bash')).toBe('large')
  })

  it('returns medium for Write and Edit', () => {
    expect(classifyBlastRadius('Write')).toBe('medium')
    expect(classifyBlastRadius('Edit')).toBe('medium')
  })

  it('returns small for other tools', () => {
    expect(classifyBlastRadius('Read')).toBe('small')
  })
})

describe('GET /api/tool-gate/stats', () => {
  let testApp: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    testApp = createTestApp()
    await testApp.start()
  })

  afterEach(async () => {
    await testApp.close()
  })

  it('returns zeroes when no decisions exist', async () => {
    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/stats`)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toEqual({ total: 0, pending: 0, resolved: 0, timedOut: 0 })
  })

  it('counts pending tool approval decisions', async () => {
    const { decisionQueue, tickService } = testApp.deps
    decisionQueue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'agent-1',
      decisionId: 'd1',
      toolName: 'Bash',
      toolArgs: { command: 'echo hello' },
      severity: 'high',
      blastRadius: 'large',
    }, tickService.currentTick())

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/stats`)
    const body = await res.json() as any
    expect(body).toEqual({ total: 1, pending: 1, resolved: 0, timedOut: 0 })
  })

  it('counts resolved decisions correctly', async () => {
    const { decisionQueue, tickService } = testApp.deps
    decisionQueue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'agent-1',
      decisionId: 'd1',
      toolName: 'Bash',
      toolArgs: { command: 'echo hello' },
      severity: 'high',
      blastRadius: 'large',
    }, tickService.currentTick())

    decisionQueue.resolve('d1', {
      type: 'tool_approval',
      action: 'approve',
      rationale: 'Looks good',
      actionKind: 'review',
    })

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/stats`)
    const body = await res.json() as any
    expect(body).toEqual({ total: 1, pending: 0, resolved: 1, timedOut: 0 })
  })

  it('counts timed_out decisions correctly', async () => {
    const { decisionQueue, tickService } = testApp.deps
    decisionQueue.subscribeTo(tickService)

    decisionQueue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'agent-1',
      decisionId: 'd1',
      toolName: 'Bash',
      toolArgs: { command: 'rm -rf /' },
      severity: 'high',
      blastRadius: 'large',
    }, tickService.currentTick())

    // Advance ticks past the timeout threshold (default 100 in test)
    for (let i = 0; i < 101; i++) {
      tickService.advance()
    }

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/stats`)
    const body = await res.json() as any
    expect(body).toEqual({ total: 1, pending: 0, resolved: 0, timedOut: 1 })

    decisionQueue.unsubscribeFrom(tickService)
  })

  it('excludes non-tool_approval decisions from counts', async () => {
    const { decisionQueue, tickService } = testApp.deps

    // Enqueue an option decision (not tool_approval)
    decisionQueue.enqueue({
      type: 'decision',
      subtype: 'option',
      agentId: 'agent-1',
      decisionId: 'd-option',
      prompt: 'Which approach?',
      options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }],
      severity: 'medium',
    }, tickService.currentTick())

    // Enqueue a tool_approval decision
    decisionQueue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'agent-1',
      decisionId: 'd-tool',
      toolName: 'Write',
      toolArgs: { file_path: '/tmp/test.ts', content: '' },
      severity: 'medium',
      blastRadius: 'medium',
    }, tickService.currentTick())

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/stats`)
    const body = await res.json() as any
    // Only the tool_approval should be counted
    expect(body).toEqual({ total: 1, pending: 1, resolved: 0, timedOut: 0 })
  })
})

describe('POST /api/tool-gate/request-approval', () => {
  let testApp: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    testApp = createTestApp()
    await testApp.start()
  })

  afterEach(async () => {
    await testApp.close()
  })

  it('returns 404 for unknown agent', async () => {
    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'nonexistent',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolUseId: 'tu-1',
      }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid request body', async () => {
    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1' }), // missing required fields
    })
    expect(res.status).toBe(400)
  })

  it('enqueues a pending decision and resolves on approve', async () => {
    const { decisionQueue } = testApp.deps

    // Start the request (it will block waiting for resolution)
    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Bash',
        toolInput: { command: 'npx vitest run' },
        toolUseId: 'tu-1',
      }),
    })

    // Wait for the decision to appear in the queue
    await new Promise(resolve => setTimeout(resolve, 50))
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)
    expect(pending[0].event.subtype).toBe('tool_approval')

    // Resolve it
    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: 'LGTM',
      actionKind: 'review',
    })

    const res = await requestPromise
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.rationale).toBe('LGTM')
    expect(body.timedOut).toBe(false)
  })

  it('publishes the decision to the event bus', async () => {
    const { decisionQueue, eventBus } = testApp.deps

    const received: any[] = []
    eventBus.subscribe({}, (envelope) => {
      if (envelope.event.type === 'decision') {
        received.push(envelope.event)
      }
    })

    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Edit',
        toolInput: { file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' },
        toolUseId: 'tu-2',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(received.length).toBe(1)
    expect(received[0].toolName).toBe('Edit')
    expect(received[0].toolArgs).toEqual({ file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' })

    // Resolve to unblock
    const pending = decisionQueue.listPending()
    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: '',
      actionKind: 'review',
    })
    await requestPromise
  })

  it('attaches reasoning from recent status events', async () => {
    const { decisionQueue, eventBus } = testApp.deps

    // Simulate a status event (agent reasoning) arriving via the event bus
    eventBus.publish({
      sourceEventId: 'evt-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'status',
        agentId: 'agent-1',
        message: 'I need to run the test suite to verify the changes compile',
      },
    })

    // Now make a tool-gate request
    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Bash',
        toolInput: { command: 'npx vitest run' },
        toolUseId: 'tu-3',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)

    // The decision should have the reasoning attached
    const event = pending[0].event
    expect(event.subtype).toBe('tool_approval')
    if (event.subtype === 'tool_approval') {
      expect(event.reasoning).toBe('I need to run the test suite to verify the changes compile')
    }

    // Resolve to unblock
    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: '',
      actionKind: 'review',
    })
    await requestPromise
  })
})
