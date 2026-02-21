import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { listenEphemeral } from '../helpers/listen-ephemeral'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { WebSocketHub } from '../../src/ws-hub'
import { createApp } from '../../src/app'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, KnowledgeSnapshot, FrontendMessage } from '../../src/types'
import type { ControlMode, EventEnvelope } from '../../src/types/events'

function emptySnapshot(): KnowledgeSnapshot {
  return {
    version: 0,
    generatedAt: new Date().toISOString(),
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens: 0,
  }
}

function createTestDeps(opts?: { withKnowledgeStoreImpl?: boolean }): {
  deps: ApiRouteDeps
  ks: KnowledgeStore | undefined
} {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()

  const wsHub = new WebSocketHub(() => ({
    snapshot: emptySnapshot(),
    activeAgents: [],
    trustScores: [],
    controlMode: 'orchestrator' as const,
  }))

  const handles = new Map<string, AgentHandle>()
  const registry: AgentRegistry = {
    getHandle(id) { return handles.get(id) ?? null },
    listHandles() { return Array.from(handles.values()) },
    registerHandle(h) { handles.set(h.id, h) },
    updateHandle(id, updates) {
      const existing = handles.get(id)
      if (existing) Object.assign(existing, updates)
    },
    removeHandle(id) { handles.delete(id) },
  }

  const knowledgeStore = {
    async getSnapshot() { return emptySnapshot() },
    async appendEvent() {},
    updateAgentStatus() {},
  }

  const checkpointStore: CheckpointStore = {
    storeCheckpoint() {},
    getCheckpoints() { return [] },
    getLatestCheckpoint() { return undefined },
    getCheckpointCount() { return 0 },
    deleteCheckpoints() { return 0 },
  }

  const gateway: AgentGateway = {
    getPlugin() { return undefined },
    async spawn() { throw new Error('Not implemented') },
  }

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  let ks: KnowledgeStore | undefined
  let knowledgeStoreImpl: KnowledgeStore | undefined

  if (opts?.withKnowledgeStoreImpl !== false) {
    ks = new KnowledgeStore(':memory:')
    knowledgeStoreImpl = ks
  }

  const deps: ApiRouteDeps = {
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore,
    checkpointStore,
    gateway,
    controlMode,
    knowledgeStoreImpl,
  }

  return { deps, ks }
}

function createTestApp(deps: ApiRouteDeps) {
  const app = createApp(deps)
  const server = createServer(app as any)
  let baseUrl = ''

  return {
    server,
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

async function httpGet(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.json() as any }
}

function makeEnvelope(overrides: Partial<EventEnvelope> & { event: EventEnvelope['event'] }): EventEnvelope {
  return {
    sourceEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sourceSequence: 1,
    sourceOccurredAt: '2025-06-01T00:00:00Z',
    runId: 'run-1',
    ingestedAt: '2025-06-01T00:00:01Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/events', () => {
  it('returns 501 when knowledgeStoreImpl is unavailable', async () => {
    const { deps } = createTestDeps({ withKnowledgeStoreImpl: false })
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(501)
      expect(res.body.error).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns all events when no filters are given', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'maya-1', message: 'hello' },
    }))
    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'maya-2', message: 'world' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(2)
      expect(res.body.count).toBe(2)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('filters by agentId', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'maya-1', message: 'a' },
    }))
    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'david-1', message: 'b' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?agentId=maya-1')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0].event.agentId).toBe('maya-1')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('filters by types (comma-separated)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))
    ks!.appendEvent(makeEnvelope({
      event: {
        type: 'tool_call',
        agentId: 'a1',
        toolCallId: 'tc-1',
        toolName: 'bash',
        phase: 'completed',
        input: { cmd: 'ls' },
        approved: true,
      },
    }))
    ks!.appendEvent(makeEnvelope({
      event: {
        type: 'artifact',
        agentId: 'a1',
        artifactId: 'art-1',
        name: 'file.ts',
        kind: 'code',
        workstream: 'ws-1',
        status: 'draft',
        qualityScore: 80,
        provenance: { createdBy: 'a1', createdAt: '2025-06-01T00:00:00Z' },
      },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?types=tool_call,status')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(2)
      const types = res.body.events.map((e: any) => e.event.type)
      expect(types).toContain('status')
      expect(types).toContain('tool_call')
      expect(types).not.toContain('artifact')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('respects limit parameter', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 20; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=10')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(10)
      expect(res.body.count).toBe(10)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('filters by since timestamp', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2024-01-01T00:00:00Z',
      event: { type: 'status', agentId: 'a1', message: 'old' },
    }))
    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2025-06-01T00:00:00Z',
      event: { type: 'status', agentId: 'a1', message: 'new' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?since=2025-01-01T00:00:00Z')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0].event.message).toBe('new')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('combines multiple filters', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // maya-1 status, old
    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2024-01-01T00:00:00Z',
      event: { type: 'status', agentId: 'maya-1', message: 'old-status' },
    }))
    // maya-1 status, new
    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2025-06-01T00:00:00Z',
      event: { type: 'status', agentId: 'maya-1', message: 'new-status' },
    }))
    // david-1 status, new
    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2025-06-01T00:00:01Z',
      event: { type: 'status', agentId: 'david-1', message: 'david-status' },
    }))
    // maya-1 tool_call, new
    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2025-06-01T00:00:02Z',
      event: {
        type: 'tool_call',
        agentId: 'maya-1',
        toolCallId: 'tc-2',
        toolName: 'bash',
        phase: 'completed',
        input: {},
        approved: true,
      },
    }))

    try {
      // maya-1 + status + since 2025
      const res = await httpGet(app.baseUrl, '/api/events?agentId=maya-1&types=status&since=2025-01-01T00:00:00Z')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0].event.message).toBe('new-status')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('applies default limit of 100', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // Insert 120 events
    for (let i = 0; i < 120; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(100)
      expect(res.body.count).toBe(100)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('caps limit at 1000', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // We only insert 5 events, but request limit=9999
    for (let i = 0; i < 5; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      // Request limit=9999, should be capped at 1000 (but only 5 events exist)
      const res = await httpGet(app.baseUrl, '/api/events?limit=9999')
      expect(res.status).toBe(200)
      // We get all 5 because there are only 5 in the DB
      expect(res.body.events).toHaveLength(5)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('handles invalid limit gracefully (falls back to default)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=notanumber')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('filters by runId', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      runId: 'run-alpha',
      event: { type: 'status', agentId: 'a1', message: 'alpha' },
    }))
    ks!.appendEvent(makeEnvelope({
      runId: 'run-beta',
      event: { type: 'status', agentId: 'a1', message: 'beta' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?runId=run-alpha')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0].runId).toBe('run-alpha')
    } finally {
      ks!.close()
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Edge-case tests
// ---------------------------------------------------------------------------

describe('GET /api/events — edge cases', () => {
  it('returns empty array and count 0 when no events match', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/events?agentId=nonexistent')
      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
      expect(res.body.count).toBe(0)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('count always matches events.length', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 7; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=5')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(res.body.events.length)
      expect(res.body.count).toBe(5)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('response always has events array and count field', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.events)).toBe(true)
      expect(typeof res.body.count).toBe('number')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('negative limit is clamped to 0 and returns empty result', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=-5')
      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
      expect(res.body.count).toBe(0)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('limit=0 returns empty result', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=0')
      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
      expect(res.body.count).toBe(0)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('limit=1 returns exactly one event', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 5; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=1')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.count).toBe(1)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('empty string agentId is treated as no filter (returns all)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      // ?agentId= is treated the same as omitting the param
      const res = await httpGet(app.baseUrl, '/api/events?agentId=')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('empty string runId is treated as no filter (returns all)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      runId: 'run-1',
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      // ?runId= is treated the same as omitting the param
      const res = await httpGet(app.baseUrl, '/api/events?runId=')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('types with empty segments are filtered out', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))
    ks!.appendEvent(makeEnvelope({
      event: {
        type: 'tool_call',
        agentId: 'a1',
        toolCallId: 'tc-1',
        toolName: 'bash',
        phase: 'completed',
        input: { cmd: 'ls' },
        approved: true,
      },
    }))

    try {
      // types=,,status, should only match 'status', ignoring empty segments
      const res = await httpGet(app.baseUrl, '/api/events?types=,,status,')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0].event.type).toBe('status')
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('types= (all empty) returns all events (no type filter applied)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))
    ks!.appendEvent(makeEnvelope({
      event: {
        type: 'tool_call',
        agentId: 'a1',
        toolCallId: 'tc-1',
        toolName: 'bash',
        phase: 'completed',
        input: {},
        approved: true,
      },
    }))

    try {
      // types= with no actual values should not apply a type filter
      const res = await httpGet(app.baseUrl, '/api/events?types=')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(2)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('since with invalid date string returns 200 (no crash)', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      ingestedAt: '2025-06-01T00:00:00Z',
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?since=not-a-date')
      expect(res.status).toBe(200)
      // 'not-a-date' sorts lexicographically after '2025-…', so nothing matches
      expect(Array.isArray(res.body.events)).toBe(true)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('special characters in agentId do not cause SQL injection or crash', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      event: { type: 'status', agentId: 'normal-agent', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?agentId=' + encodeURIComponent("'; DROP TABLE events; --"))
      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
      expect(res.body.count).toBe(0)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('special characters in runId do not cause SQL injection or crash', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      runId: 'run-1',
      event: { type: 'status', agentId: 'a1', message: 'hi' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events?runId=' + encodeURIComponent("1 OR 1=1; --"))
      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('extremely large limit is capped at 1000', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 3; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      const res = await httpGet(app.baseUrl, '/api/events?limit=999999')
      expect(res.status).toBe(200)
      // Only 3 events exist, so we get 3, but the limit was capped at 1000
      expect(res.body.events).toHaveLength(3)
      expect(res.body.count).toBe(3)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('float limit is truncated via parseInt', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 5; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: 'a1', message: `msg-${i}` },
      }))
    }

    try {
      // parseInt('2.9', 10) === 2
      const res = await httpGet(app.baseUrl, '/api/events?limit=2.9')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(2)
      expect(res.body.count).toBe(2)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('multiple concurrent requests do not interfere with each other', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    for (let i = 0; i < 10; i++) {
      ks!.appendEvent(makeEnvelope({
        sourceSequence: i,
        event: { type: 'status', agentId: `agent-${i % 3}`, message: `msg-${i}` },
      }))
    }

    try {
      const [res1, res2, res3] = await Promise.all([
        httpGet(app.baseUrl, '/api/events?agentId=agent-0'),
        httpGet(app.baseUrl, '/api/events?agentId=agent-1'),
        httpGet(app.baseUrl, '/api/events?limit=3'),
      ])
      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res3.status).toBe(200)

      // agent-0 gets indices 0, 3, 6, 9 => 4 events
      expect(res1.body.events).toHaveLength(4)
      // agent-1 gets indices 1, 4, 7 => 3 events
      expect(res2.body.events).toHaveLength(3)
      // limit=3
      expect(res3.body.events).toHaveLength(3)

      // Verify count consistency for all responses
      expect(res1.body.count).toBe(res1.body.events.length)
      expect(res2.body.count).toBe(res2.body.events.length)
      expect(res3.body.count).toBe(res3.body.events.length)
    } finally {
      ks!.close()
      await app.close()
    }
  })

  it('501 response body includes error field', async () => {
    const { deps } = createTestDeps({ withKnowledgeStoreImpl: false })
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(501)
      expect(typeof res.body.error).toBe('string')
      expect(res.body.error).toMatch(/not supported/i)
    } finally {
      await app.close()
    }
  })

  it('each event in response has expected envelope fields', async () => {
    const { deps, ks } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    ks!.appendEvent(makeEnvelope({
      sourceEventId: 'evt-check',
      sourceSequence: 42,
      sourceOccurredAt: '2025-06-01T12:00:00Z',
      runId: 'run-check',
      ingestedAt: '2025-06-01T12:00:01Z',
      event: { type: 'status', agentId: 'a1', message: 'check fields' },
    }))

    try {
      const res = await httpGet(app.baseUrl, '/api/events')
      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)

      const envelope = res.body.events[0]
      expect(envelope).toHaveProperty('sourceEventId', 'evt-check')
      expect(envelope).toHaveProperty('sourceSequence', 42)
      expect(envelope).toHaveProperty('sourceOccurredAt', '2025-06-01T12:00:00Z')
      expect(envelope).toHaveProperty('runId', 'run-check')
      expect(envelope).toHaveProperty('ingestedAt', '2025-06-01T12:00:01Z')
      expect(envelope).toHaveProperty('event')
      expect(envelope.event).toHaveProperty('type', 'status')
      expect(envelope.event).toHaveProperty('agentId', 'a1')
    } finally {
      ks!.close()
      await app.close()
    }
  })
})
