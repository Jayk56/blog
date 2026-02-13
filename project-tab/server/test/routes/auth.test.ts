import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'

import { createApp } from '../../src/app'
import { listenEphemeral } from '../helpers/listen-ephemeral'
import { AuthService } from '../../src/auth'
import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import type {
  ApiRouteDeps,
  AgentRegistry,
  AgentGateway,
  KnowledgeStore,
  ControlModeManager,
} from '../../src/routes'
import type {
  AgentHandle,
  AgentPlugin,
  KnowledgeSnapshot,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'

const AUTH_SECRET = new Uint8Array(32).fill(3)

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

function createMockPlugin(): AgentPlugin {
  return {
    name: 'mock',
    version: '1.0.0',
    capabilities: {
      supportsPause: true,
      supportsResume: true,
      supportsKill: true,
      supportsHotBriefUpdate: true,
    },
    async spawn(brief) {
      return {
        id: brief.agentId,
        pluginName: 'mock',
        status: 'running',
        sessionId: `session-${brief.agentId}`,
      }
    },
    async kill() {
      return { cleanShutdown: true, artifactsExtracted: 0 }
    },
    async pause(handle) {
      return {
        agentId: handle.id,
        pluginName: 'mock',
        sessionId: handle.sessionId,
        checkpoint: { sdk: 'mock' as const, scriptPosition: 0 },
        briefSnapshot: {} as any,
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'pause' as const,
        estimatedSizeBytes: 0,
      }
    },
    async resume(state) {
      return {
        id: state.agentId,
        pluginName: 'mock',
        status: 'running' as const,
        sessionId: state.sessionId,
      }
    },
    async resolveDecision() {},
    async injectContext() {},
    async updateBrief() {},
    async requestCheckpoint(handle) {
      return {
        agentId: handle.id,
        pluginName: 'mock',
        sessionId: handle.sessionId,
        checkpoint: { sdk: 'mock' as const, scriptPosition: 0 },
        briefSnapshot: {} as any,
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint' as const,
        estimatedSizeBytes: 0,
      }
    },
  }
}

function createTestDeps(): ApiRouteDeps {
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
  wsHub.broadcast = () => {}

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

  const knowledgeStore: KnowledgeStore = {
    async getSnapshot() { return emptySnapshot() },
    async appendEvent() {},
  }

  const mockPlugin = createMockPlugin()
  const plugins = new Map<string, AgentPlugin>()
  plugins.set('mock', mockPlugin)

  const gateway: AgentGateway = {
    getPlugin(name) { return plugins.get(name) },
    async spawn(brief, pluginName) {
      const plugin = plugins.get(pluginName)
      if (!plugin) throw new Error(`No plugin: ${pluginName}`)
      return plugin.spawn(brief)
    },
  }

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  return {
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore,
    checkpointStore: {
      storeCheckpoint: () => {},
      getCheckpoints: () => [],
      getLatestCheckpoint: () => undefined,
      getCheckpointCount: () => 0,
      deleteCheckpoints: () => 0,
    },
    gateway,
    controlMode,
    userAuthService: new AuthService({
      secret: AUTH_SECRET,
      issuer: 'test-api',
      defaultTtlMs: 3_600_000,
    }),
  }
}

async function httpGet(baseUrl: string, path: string, token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, { headers })
  return { status: res.status, body: await res.json() as any }
}

async function httpPost(baseUrl: string, path: string, body: unknown = {}, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('Auth module routes', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    const deps = createTestDeps()
    const app = createApp(deps)
    server = createServer(app as any)
    const port = await listenEphemeral(server)
    baseUrl = `http://localhost:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('issues auth tokens via POST /api/auth/login', async () => {
    const res = await httpPost(baseUrl, '/api/auth/login', {
      userId: 'dev-user',
      role: 'admin',
      scopes: ['agents:write'],
    })

    expect(res.status).toBe(200)
    expect(typeof res.body.accessToken).toBe('string')
    expect(res.body.user.userId).toBe('dev-user')
    expect(res.body.user.role).toBe('admin')
  })

  it('protects operational routes when user auth is enabled', async () => {
    const unauth = await httpGet(baseUrl, '/api/agents')
    expect(unauth.status).toBe(401)

    const login = await httpPost(baseUrl, '/api/auth/login', {
      userId: 'operator-1',
      role: 'operator',
    })
    const token = login.body.accessToken as string

    const authed = await httpGet(baseUrl, '/api/agents', token)
    expect(authed.status).toBe(200)
    expect(authed.body.agents).toEqual([])
  })

  it('exposes authenticated user context through GET /api/auth/me', async () => {
    const login = await httpPost(baseUrl, '/api/auth/login', {
      userId: 'viewer-1',
      role: 'viewer',
      scopes: ['read:all'],
    })
    const token = login.body.accessToken as string

    const me = await httpGet(baseUrl, '/api/auth/me', token)
    expect(me.status).toBe(200)
    expect(me.body.user).toEqual({
      userId: 'viewer-1',
      role: 'viewer',
      scopes: ['read:all'],
    })
  })

  it('refreshes access tokens', async () => {
    const login = await httpPost(baseUrl, '/api/auth/login', {
      userId: 'admin-2',
      role: 'admin',
    })
    const token = login.body.accessToken as string

    const refreshed = await httpPost(baseUrl, '/api/auth/refresh', {}, token)
    expect(refreshed.status).toBe(200)
    expect(typeof refreshed.body.accessToken).toBe('string')
    expect(refreshed.body.accessToken).not.toBe(token)
  })

  it('keeps health endpoint public', async () => {
    const health = await httpGet(baseUrl, '/api/health')
    expect(health.status).toBe(200)
    expect(health.body.status).toBe('ok')
  })
})
