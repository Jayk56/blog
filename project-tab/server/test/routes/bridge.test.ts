import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { listenEphemeral } from '../helpers/listen-ephemeral'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import { TeamsBridgePlugin } from '../../src/gateway/teams-bridge-plugin'
import { createApp } from '../../src/app'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, KnowledgeSnapshot, FrontendMessage } from '../../src/types'
import type { ControlMode } from '../../src/types/events'

// ── Helpers ──────────────────────────────────────────────────────────────

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

function createTestDeps(bridgePlugin: TeamsBridgePlugin): {
  deps: ApiRouteDeps
  registry: AgentRegistry
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
    bridgePlugin,
  }

  return { deps, registry }
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
  if (res.status === 204) {
    return { status: res.status, body: null }
  }
  return { status: res.status, body: await res.json() as any }
}

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

function makeValidAdapterEvent(agentId = 'agent-1') {
  return {
    sourceEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sourceSequence: 1,
    sourceOccurredAt: '2025-06-01T00:00:00Z',
    runId: 'run-1',
    event: {
      type: 'status',
      agentId,
      message: 'Working on feature',
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/bridge/events', () => {
  let bridgeDir: string
  let bridgePlugin: TeamsBridgePlugin
  let app: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    bridgeDir = await mkdtemp(join(tmpdir(), 'bridge-route-'))
    bridgePlugin = new TeamsBridgePlugin(bridgeDir)
    const { deps } = createTestDeps(bridgePlugin)
    app = createTestApp(deps)
    await app.start()
  })

  afterEach(async () => {
    await app.close()
    await rm(bridgeDir, { recursive: true, force: true })
  })

  it('accepts valid event and returns 200', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/events', makeValidAdapterEvent())

    expect(res.status).toBe(200)
    expect(res.body.ingested).toBe(true)
  })

  it('rejects malformed payload and returns 400', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/events', {
      bad: 'data',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('rejects event with missing required fields', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/events', {
      sourceEventId: 'evt-1',
      // missing sourceSequence, sourceOccurredAt, runId, event
    })

    expect(res.status).toBe(400)
  })

  it('auto-registers unknown agent on first event', async () => {
    const { deps, registry } = createTestDeps(bridgePlugin)
    const localApp = createTestApp(deps)
    await localApp.start()

    try {
      await httpPost(localApp.baseUrl, '/api/bridge/events', makeValidAdapterEvent('new-agent'))

      const handle = registry.getHandle('new-agent')
      expect(handle).not.toBeNull()
      expect(handle!.pluginName).toBe('teams-bridge')
      expect(handle!.status).toBe('running')
    } finally {
      await localApp.close()
    }
  })
})

describe('POST /api/bridge/register', () => {
  let bridgeDir: string
  let bridgePlugin: TeamsBridgePlugin
  let app: ReturnType<typeof createTestApp>
  let registry: AgentRegistry

  beforeEach(async () => {
    bridgeDir = await mkdtemp(join(tmpdir(), 'bridge-route-'))
    bridgePlugin = new TeamsBridgePlugin(bridgeDir)
    const result = createTestDeps(bridgePlugin)
    registry = result.registry
    app = createTestApp(result.deps)
    await app.start()
  })

  afterEach(async () => {
    await app.close()
    await rm(bridgeDir, { recursive: true, force: true })
  })

  it('creates agent and returns 201', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/register', {
      agentId: 'maya-1',
      role: 'coder',
      workstream: 'backend',
    })

    expect(res.status).toBe(201)
    expect(res.body.registered).toBe(true)
    expect(res.body.agentId).toBe('maya-1')
  })

  it('registers the agent in the registry', async () => {
    await httpPost(app.baseUrl, '/api/bridge/register', {
      agentId: 'david-1',
    })

    const handle = registry.getHandle('david-1')
    expect(handle).not.toBeNull()
    expect(handle!.pluginName).toBe('teams-bridge')
  })

  it('returns 200 with alreadyExists for duplicate registration', async () => {
    await httpPost(app.baseUrl, '/api/bridge/register', {
      agentId: 'maya-1',
    })

    const res = await httpPost(app.baseUrl, '/api/bridge/register', {
      agentId: 'maya-1',
    })

    expect(res.status).toBe(200)
    expect(res.body.alreadyExists).toBe(true)
  })

  it('rejects registration with empty agentId', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/register', {
      agentId: '',
    })

    expect(res.status).toBe(400)
  })

  it('rejects registration with missing agentId', async () => {
    const res = await httpPost(app.baseUrl, '/api/bridge/register', {})

    expect(res.status).toBe(400)
  })
})

describe('GET /api/bridge/context/:id', () => {
  let bridgeDir: string
  let bridgePlugin: TeamsBridgePlugin
  let app: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    bridgeDir = await mkdtemp(join(tmpdir(), 'bridge-route-'))
    bridgePlugin = new TeamsBridgePlugin(bridgeDir)
    const { deps } = createTestDeps(bridgePlugin)
    app = createTestApp(deps)
    await app.start()
  })

  afterEach(async () => {
    await app.close()
    await rm(bridgeDir, { recursive: true, force: true })
  })

  it('returns 204 when no content is available', async () => {
    const res = await httpGet(app.baseUrl, '/api/bridge/context/nonexistent')

    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })

  it('returns 200 with content when context has been injected', async () => {
    const handle: AgentHandle = {
      id: 'agent-ctx',
      pluginName: 'teams-bridge',
      status: 'running',
      sessionId: 'bridge-agent-ctx-1234',
    }
    bridgePlugin.registerHandle(handle)

    await bridgePlugin.injectContext(handle, {
      content: '# Context for agent',
      format: 'markdown',
      snapshotVersion: 1,
      estimatedTokens: 30,
      priority: 'recommended',
    })

    const res = await httpGet(app.baseUrl, '/api/bridge/context/agent-ctx')

    expect(res.status).toBe(200)
    expect(res.body.injection).toBeDefined()
    expect(res.body.injection.content).toBe('# Context for agent')
  })

  it('consumes context (second call returns 204)', async () => {
    const handle: AgentHandle = {
      id: 'agent-consume',
      pluginName: 'teams-bridge',
      status: 'running',
      sessionId: 'bridge-agent-consume-1234',
    }
    bridgePlugin.registerHandle(handle)

    await bridgePlugin.injectContext(handle, {
      content: 'one-time context',
      format: 'markdown',
      snapshotVersion: 1,
      estimatedTokens: 10,
      priority: 'recommended',
    })

    const first = await httpGet(app.baseUrl, '/api/bridge/context/agent-consume')
    expect(first.status).toBe(200)

    const second = await httpGet(app.baseUrl, '/api/bridge/context/agent-consume')
    expect(second.status).toBe(204)
  })
})

describe('GET /api/bridge/brake/:id', () => {
  let bridgeDir: string
  let bridgePlugin: TeamsBridgePlugin
  let app: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    bridgeDir = await mkdtemp(join(tmpdir(), 'bridge-route-'))
    bridgePlugin = new TeamsBridgePlugin(bridgeDir)
    const { deps } = createTestDeps(bridgePlugin)
    app = createTestApp(deps)
    await app.start()
  })

  afterEach(async () => {
    await app.close()
    await rm(bridgeDir, { recursive: true, force: true })
  })

  it('returns active: false when no brake exists', async () => {
    const res = await httpGet(app.baseUrl, '/api/bridge/brake/agent-1')

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })

  it('returns active: true when brake file exists', async () => {
    // Manually create a brake file
    const brakeDir = join(bridgeDir, 'brake')
    await mkdir(brakeDir, { recursive: true })
    await writeFile(
      join(brakeDir, 'agent-braked'),
      JSON.stringify({ reason: 'killed', at: new Date().toISOString() }),
      'utf-8'
    )

    const res = await httpGet(app.baseUrl, '/api/bridge/brake/agent-braked')

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(true)
  })

  it('returns active: true after kill() sets brake', async () => {
    const handle: AgentHandle = {
      id: 'agent-kill-brake',
      pluginName: 'teams-bridge',
      status: 'running',
      sessionId: 'bridge-agent-kill-brake-1234',
    }
    bridgePlugin.registerHandle(handle)
    await bridgePlugin.kill(handle)

    const res = await httpGet(app.baseUrl, '/api/bridge/brake/agent-kill-brake')

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(true)
  })
})
