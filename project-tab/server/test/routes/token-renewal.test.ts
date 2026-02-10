import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'

import { createApp } from '../../src/app'
import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import { TokenService } from '../../src/gateway/token-service'
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

const TEST_SECRET = new Uint8Array(32).fill(99)

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

let tokenService: TokenService
let testPort = 9400

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

  tokenService = new TokenService({
    secret: TEST_SECRET,
    defaultTtlMs: 3600_000,
    issuer: 'test',
  })

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
    tokenService,
  }
}

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('Route: POST /api/token/renew', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    const deps = createTestDeps()
    const app = createApp(deps)
    const port = testPort++
    server = createServer(app as any)
    baseUrl = `http://localhost:${port}`
    await new Promise<void>((resolve) => server.listen(port, resolve))
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('renews a valid token and returns new JWT', async () => {
    const original = await tokenService.issueToken('agent-1', 'sandbox-abc')

    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
      currentToken: original.token,
    })

    expect(res.status).toBe(200)
    expect(typeof res.body.backendToken).toBe('string')
    expect(typeof res.body.tokenExpiresAt).toBe('string')
    // JWT is a valid 3-part string
    expect(res.body.backendToken.split('.')).toHaveLength(3)

    // New token should be valid
    const claims = await tokenService.validateToken(res.body.backendToken)
    expect(claims.agentId).toBe('agent-1')
    expect(claims.sandboxId).toBe('sandbox-abc')
  })

  it('returns 400 when agentId is missing', async () => {
    const original = await tokenService.issueToken('agent-1')

    const res = await httpPost(baseUrl, '/api/token/renew', {
      currentToken: original.token,
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('agentId')
  })

  it('returns 400 when currentToken is missing', async () => {
    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('currentToken')
  })

  it('returns 401 when token is invalid', async () => {
    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
      currentToken: 'invalid-jwt-string',
    })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token validation failed')
  })

  it('returns 401 when agentId does not match token', async () => {
    const original = await tokenService.issueToken('agent-1')

    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-2',
      currentToken: original.token,
    })

    expect(res.status).toBe(401)
    expect(res.body.message).toContain('mismatch')
  })

  it('returns 401 when token is expired beyond tolerance', async () => {
    // Issue a token that was created 2 hours ago (well past 1hr TTL + 5s tolerance)
    const twoHoursAgo = Date.now() - 2 * 3600_000
    const pastService = new TokenService({
      secret: TEST_SECRET,
      defaultTtlMs: 3600_000,
      issuer: 'test',
      nowFn: () => twoHoursAgo,
    })
    const { token } = await pastService.issueToken('agent-1')

    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
      currentToken: token,
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 when token is signed with wrong secret', async () => {
    const otherService = new TokenService({
      secret: new Uint8Array(32).fill(77),
      issuer: 'test',
    })
    const { token } = await otherService.issueToken('agent-1')

    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
      currentToken: token,
    })

    expect(res.status).toBe(401)
  })

  it('renewed token has correct expiration', async () => {
    const original = await tokenService.issueToken('agent-1')
    const beforeRenew = Date.now()

    const res = await httpPost(baseUrl, '/api/token/renew', {
      agentId: 'agent-1',
      currentToken: original.token,
    })

    expect(res.status).toBe(200)
    const newExpiry = new Date(res.body.tokenExpiresAt).getTime()
    // New token should expire ~1 hour from now
    const expectedExpiry = beforeRenew + 3600_000
    // Allow 5 second tolerance for test execution time
    expect(Math.abs(newExpiry - expectedExpiry)).toBeLessThan(5000)
  })
})
