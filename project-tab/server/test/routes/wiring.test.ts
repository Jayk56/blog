import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, AgentPlugin, FrontendMessage, KnowledgeSnapshot, PluginCapabilities } from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import { createApp } from '../../src/app'
import { createServer, type Server } from 'node:http'

/** Creates a mock AgentPlugin that records calls. */
function createMockPlugin(name = 'mock'): AgentPlugin & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    spawn: [],
    kill: [],
    pause: [],
    resume: [],
    resolveDecision: [],
    updateBrief: [],
    injectContext: [],
    requestCheckpoint: [],
  }

  return {
    name,
    version: '1.0.0',
    capabilities: {
      supportsPause: true,
      supportsResume: true,
      supportsKill: true,
      supportsHotBriefUpdate: true,
    },
    calls,
    async spawn(brief) {
      const handle: AgentHandle = {
        id: brief.agentId,
        pluginName: name,
        status: 'running',
        sessionId: `session-${brief.agentId}`,
      }
      calls.spawn.push([brief])
      return handle
    },
    async kill(handle, options) {
      calls.kill.push([handle, options])
      return { cleanShutdown: true, artifactsExtracted: 0 }
    },
    async pause(handle) {
      calls.pause.push([handle])
      return {
        agentId: handle.id,
        pluginName: name,
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
      calls.resume.push([state])
      return {
        id: state.agentId,
        pluginName: name,
        status: 'running' as const,
        sessionId: state.sessionId,
      }
    },
    async resolveDecision(handle, decisionId, resolution) {
      calls.resolveDecision.push([handle, decisionId, resolution])
    },
    async injectContext(handle, injection) {
      calls.injectContext.push([handle, injection])
    },
    async updateBrief(handle, changes) {
      calls.updateBrief.push([handle, changes])
    },
    async requestCheckpoint(handle, decisionId) {
      calls.requestCheckpoint.push([handle, decisionId])
      return {
        agentId: handle.id,
        pluginName: name,
        sessionId: handle.sessionId,
        checkpoint: { sdk: 'mock' as const, scriptPosition: 0 },
        briefSnapshot: {} as any,
        conversationSummary: 'Agent blocked on decision',
        pendingDecisionIds: [decisionId],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint' as const,
        estimatedSizeBytes: 256,
      }
    },
  }
}

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

function createTestDeps(): {
  deps: ApiRouteDeps
  mockPlugin: ReturnType<typeof createMockPlugin>
  registry: AgentRegistry
  broadcasts: FrontendMessage[]
} {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()

  const broadcasts: FrontendMessage[] = []

  const wsHub = new WebSocketHub(() => ({
    snapshot: emptySnapshot(),
    activeAgents: [],
    trustScores: [],
    controlMode: 'orchestrator' as const,
  }))

  // Intercept broadcasts
  const originalBroadcast = wsHub.broadcast.bind(wsHub)
  wsHub.broadcast = (msg: FrontendMessage) => {
    broadcasts.push(msg)
    // Don't actually send (no connected sockets in test)
  }

  const handles = new Map<string, AgentHandle>()
  const registry: AgentRegistry = {
    getHandle(id) { return handles.get(id) ?? null },
    listHandles(filter) {
      const all = Array.from(handles.values())
      if (!filter) return all
      return all.filter((h) => {
        if (filter.status && h.status !== filter.status) return false
        if (filter.pluginName && h.pluginName !== filter.pluginName) return false
        return true
      })
    },
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

  const storedCheckpoints = new Map<string, any[]>()
  const checkpointStore: CheckpointStore = {
    storeCheckpoint(state, decisionId, maxPerAgent = 3) {
      const list = storedCheckpoints.get(state.agentId) ?? []
      list.unshift({ state, decisionId, createdAt: new Date().toISOString() })
      if (list.length > maxPerAgent) list.length = maxPerAgent
      storedCheckpoints.set(state.agentId, list)
    },
    getCheckpoints(agentId) { return storedCheckpoints.get(agentId) ?? [] },
    getLatestCheckpoint(agentId) { return (storedCheckpoints.get(agentId) ?? [])[0] },
    getCheckpointCount(agentId) { return (storedCheckpoints.get(agentId) ?? []).length },
    deleteCheckpoints(agentId) { const n = (storedCheckpoints.get(agentId) ?? []).length; storedCheckpoints.delete(agentId); return n },
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
  }

  return { deps, mockPlugin, registry, broadcasts }
}

let testPort = 9300

function createTestApp(deps: ApiRouteDeps) {
  const app = createApp(deps)
  const port = testPort++
  const server = createServer(app as any)
  const baseUrl = `http://localhost:${port}`

  return {
    server,
    port,
    baseUrl,
    async start() {
      await new Promise<void>((resolve) => server.listen(port, resolve))
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

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

async function httpPut(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

async function httpPatch(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

function makeMinimalBrief(agentId: string) {
  return {
    agentId,
    role: 'Test Agent',
    description: 'A test agent',
    workstream: 'test-ws',
    readableWorkstreams: [],
    constraints: [],
    escalationProtocol: {
      alwaysEscalate: [],
      escalateWhen: [],
      neverEscalate: [],
    },
    controlMode: 'orchestrator' as const,
    projectBrief: {
      title: 'Test Project',
      description: 'Test description',
      goals: ['test'],
      checkpoints: ['cp1'],
    },
    knowledgeSnapshot: emptySnapshot(),
    modelPreference: 'mock',
    allowedTools: ['bash'],
  }
}

describe('Route wiring: GET /api/agents', () => {
  it('returns empty list when no agents registered', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/agents')
      expect(res.status).toBe(200)
      expect(res.body.agents).toEqual([])
    } finally {
      await app.close()
    }
  })

  it('returns registered agents', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    try {
      const res = await httpGet(app.baseUrl, '/api/agents')
      expect(res.status).toBe(200)
      expect(res.body.agents).toHaveLength(1)
      expect(res.body.agents[0].id).toBe('agent-1')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/agents/:id', () => {
  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/nonexistent')
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('returns agent by ID', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/agent-1')
      expect(res.status).toBe(200)
      expect(res.body.agent.id).toBe('agent-1')
      expect(res.body.agent.status).toBe('running')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/spawn', () => {
  it('spawns an agent via the gateway', async () => {
    const { deps, mockPlugin } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-spawn-1'),
      })

      expect(res.status).toBe(201)
      expect(res.body.agent.id).toBe('agent-spawn-1')
      expect(res.body.agent.status).toBe('running')
      expect(mockPlugin.calls.spawn).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('registers the agent in the registry after spawn', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-reg-1'),
      })

      const handle = registry.getHandle('agent-reg-1')
      expect(handle).not.toBeNull()
      expect(handle!.status).toBe('running')
    } finally {
      await app.close()
    }
  })

  it('registers the agent in the trust engine after spawn', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-trust-1'),
      })

      const score = deps.trustEngine.getScore('agent-trust-1')
      expect(score).toBe(50) // default initial score
    } finally {
      await app.close()
    }
  })

  it('returns 400 on invalid brief', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: { invalid: true },
      })

      expect(res.status).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/:id/kill', () => {
  it('kills an agent and handles orphaned decisions', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // Register an agent
    registry.registerHandle({
      id: 'agent-kill-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-kill-1',
    })

    // Add a pending decision for the agent
    deps.decisionQueue.enqueue({
      type: 'decision',
      subtype: 'option',
      agentId: 'agent-kill-1',
      decisionId: 'decision-1',
      title: 'Test Decision',
      summary: 'Test',
      severity: 'medium',
      confidence: 0.8,
      blastRadius: 'small',
      options: [{ id: 'o1', label: 'Option 1', description: 'desc' }],
      affectedArtifactIds: [],
      requiresRationale: false,
    }, 0)

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-kill-1/kill', {
        grace: true,
      })

      expect(res.status).toBe(200)
      expect(res.body.killed).toBe(true)
      expect(res.body.orphanedDecisions).toBe(1)
      expect(mockPlugin.calls.kill).toHaveLength(1)

      // Agent should be removed from registry
      expect(registry.getHandle('agent-kill-1')).toBeNull()

      // Decision should be in triage
      const decision = deps.decisionQueue.get('decision-1')
      expect(decision?.status).toBe('triage')
      expect(decision?.badge).toBe('agent killed')
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/nonexistent/kill', {
        grace: true,
      })
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/:id/pause', () => {
  it('pauses an agent', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-pause-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-pause-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-pause-1/pause', {})
      expect(res.status).toBe(200)
      expect(res.body.paused).toBe(true)
      expect(mockPlugin.calls.pause).toHaveLength(1)

      // Status should be updated
      const handle = registry.getHandle('agent-pause-1')
      expect(handle?.status).toBe('paused')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/:id/resume', () => {
  it('resumes an agent via plugin when checkpoint exists', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-resume-1',
      pluginName: 'mock',
      status: 'paused',
      sessionId: 'session-resume-1',
    })

    // Store a checkpoint so resume has state to work with
    deps.checkpointStore.storeCheckpoint({
      agentId: 'agent-resume-1',
      pluginName: 'mock',
      sessionId: 'session-resume-1',
      checkpoint: { sdk: 'mock', scriptPosition: 5 },
      briefSnapshot: {} as any,
      pendingDecisionIds: [],
      lastSequence: 10,
      serializedAt: new Date().toISOString(),
      serializedBy: 'pause',
      estimatedSizeBytes: 256,
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-resume-1/resume', {})
      expect(res.status).toBe(200)
      expect(res.body.resumed).toBe(true)
      expect(res.body.agentId).toBe('agent-resume-1')

      // Plugin.resume should have been called
      expect(mockPlugin.calls.resume).toHaveLength(1)

      // Status should be updated
      const handle = registry.getHandle('agent-resume-1')
      expect(handle?.status).toBe('running')
    } finally {
      await app.close()
    }
  })

  it('returns 409 when no checkpoint exists', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-resume-no-cp',
      pluginName: 'mock',
      status: 'paused',
      sessionId: 'session-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-resume-no-cp/resume', {})
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('No checkpoint')
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/nonexistent/resume', {})
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/decisions', () => {
  it('returns pending decisions from queue', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    deps.decisionQueue.enqueue({
      type: 'decision',
      subtype: 'option',
      agentId: 'agent-1',
      decisionId: 'dec-1',
      title: 'Pick an option',
      summary: 'Test',
      severity: 'medium',
      confidence: 0.8,
      blastRadius: 'small',
      options: [{ id: 'o1', label: 'A', description: 'Option A' }],
      affectedArtifactIds: [],
      requiresRationale: false,
    }, 0)

    try {
      const res = await httpGet(app.baseUrl, '/api/decisions')
      expect(res.status).toBe(200)
      expect(res.body.decisions).toHaveLength(1)
      expect(res.body.decisions[0].event.decisionId).toBe('dec-1')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/decisions/:id/resolve', () => {
  it('resolves a decision and applies trust delta', async () => {
    const { deps, registry, broadcasts } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // Register agent and trust
    registry.registerHandle({
      id: 'agent-dec-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })
    deps.trustEngine.registerAgent('agent-dec-1')

    // Enqueue a decision with a recommended option
    deps.decisionQueue.enqueue({
      type: 'decision',
      subtype: 'option',
      agentId: 'agent-dec-1',
      decisionId: 'dec-resolve-1',
      title: 'Choose',
      summary: 'Test',
      severity: 'medium',
      confidence: 0.8,
      blastRadius: 'small',
      options: [
        { id: 'o1', label: 'A', description: 'Option A' },
        { id: 'o2', label: 'B', description: 'Option B' },
      ],
      recommendedOptionId: 'o1',
      affectedArtifactIds: [],
      requiresRationale: false,
    }, 0)

    try {
      const res = await httpPost(app.baseUrl, '/api/decisions/dec-resolve-1/resolve', {
        resolution: {
          type: 'option',
          chosenOptionId: 'o1',
          rationale: 'Looks good',
          actionKind: 'update',
        },
      })

      expect(res.status).toBe(200)
      expect(res.body.resolved).toBe(true)

      // Trust should have increased (human approved recommended)
      const score = deps.trustEngine.getScore('agent-dec-1')
      expect(score).toBe(52) // 50 + 2

      // Should have broadcasts: trust_update and decision_resolved
      const trustUpdates = broadcasts.filter((m) => m.type === 'trust_update')
      expect(trustUpdates).toHaveLength(1)
      if (trustUpdates[0]?.type === 'trust_update') {
        expect(trustUpdates[0].delta).toBe(2)
      }

      const decResolved = broadcasts.filter((m) => m.type === 'decision_resolved')
      expect(decResolved).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown decision', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/decisions/nonexistent/resolve', {
        resolution: {
          type: 'option',
          chosenOptionId: 'o1',
          rationale: 'test',
          actionKind: 'update',
        },
      })
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('applies negative trust for rejection', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-reject-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })
    deps.trustEngine.registerAgent('agent-reject-1')

    deps.decisionQueue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'agent-reject-1',
      decisionId: 'dec-reject-1',
      toolName: 'bash',
      toolArgs: { cmd: 'rm -rf /' },
    }, 0)

    try {
      const res = await httpPost(app.baseUrl, '/api/decisions/dec-reject-1/resolve', {
        resolution: {
          type: 'tool_approval',
          action: 'reject',
          rationale: 'Dangerous',
          actionKind: 'review',
        },
      })

      expect(res.status).toBe(200)
      const score = deps.trustEngine.getScore('agent-reject-1')
      expect(score).toBe(48) // 50 - 2
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/brake', () => {
  it('kills all agents on emergency brake', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-brake-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })
    registry.registerHandle({
      id: 'agent-brake-2',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-2',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake', {
        scope: { type: 'all' },
        reason: 'Emergency test',
        behavior: 'kill',
        initiatedBy: 'human',
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.brakeApplied).toBe(true)
      expect(res.body.behavior).toBe('kill')
      expect(res.body.affectedAgentIds).toHaveLength(2)

      // Agents should be removed
      expect(registry.getHandle('agent-brake-1')).toBeNull()
      expect(registry.getHandle('agent-brake-2')).toBeNull()

      // Plugin should have been called
      expect(mockPlugin.calls.kill).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  it('pauses agents on brake with pause behavior', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-brake-pause-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake', {
        scope: { type: 'all' },
        reason: 'Pause test',
        behavior: 'pause',
        initiatedBy: 'human',
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.brakeApplied).toBe(true)
      expect(res.body.behavior).toBe('pause')

      // Agent should be paused, not removed
      const handle = registry.getHandle('agent-brake-pause-1')
      expect(handle?.status).toBe('paused')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/brake/release', () => {
  it('resumes paused agents via plugin when checkpoint exists', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-release-1',
      pluginName: 'mock',
      status: 'paused',
      sessionId: 'session-1',
    })

    // Store a checkpoint so the plugin can be called
    deps.checkpointStore.storeCheckpoint({
      agentId: 'agent-release-1',
      pluginName: 'mock',
      sessionId: 'session-1',
      checkpoint: { sdk: 'mock', scriptPosition: 0 },
      briefSnapshot: {} as any,
      pendingDecisionIds: [],
      lastSequence: 0,
      serializedAt: new Date().toISOString(),
      serializedBy: 'pause',
      estimatedSizeBytes: 256,
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake/release')
      expect(res.status).toBe(200)
      expect(res.body.released).toBe(true)
      expect(res.body.resumedAgentIds).toContain('agent-release-1')

      const handle = registry.getHandle('agent-release-1')
      expect(handle?.status).toBe('running')

      // Plugin.resume should have been called
      expect(mockPlugin.calls.resume).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('falls back to metadata-only update when no checkpoint exists', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-release-no-cp',
      pluginName: 'mock',
      status: 'paused',
      sessionId: 'session-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake/release')
      expect(res.status).toBe(200)
      expect(res.body.released).toBe(true)
      expect(res.body.resumedAgentIds).toContain('agent-release-no-cp')

      const handle = registry.getHandle('agent-release-no-cp')
      expect(handle?.status).toBe('running')

      // Plugin.resume should NOT have been called (no checkpoint)
      expect(mockPlugin.calls.resume).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/control-mode', () => {
  it('returns current control mode', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/control-mode')
      expect(res.status).toBe(200)
      expect(res.body.controlMode).toBe('orchestrator')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: PUT /api/control-mode', () => {
  it('changes control mode', async () => {
    const { deps, broadcasts } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPut(app.baseUrl, '/api/control-mode', {
        controlMode: 'ecosystem',
      })

      expect(res.status).toBe(200)
      expect(res.body.controlMode).toBe('ecosystem')

      // Verify mode was changed
      const getRes = await httpGet(app.baseUrl, '/api/control-mode')
      expect(getRes.body.controlMode).toBe('ecosystem')

      // Verify state sync was broadcast
      const syncs = broadcasts.filter((m) => m.type === 'state_sync')
      expect(syncs.length).toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/trust/:agentId', () => {
  it('returns trust profile for registered agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    deps.trustEngine.registerAgent('agent-trust-query')

    try {
      const res = await httpGet(app.baseUrl, '/api/trust/agent-trust-query')
      expect(res.status).toBe(200)
      expect(res.body.agentId).toBe('agent-trust-query')
      expect(res.body.score).toBe(50)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/trust/nonexistent')
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/artifacts', () => {
  it('returns artifacts from knowledge store', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/artifacts')
      expect(res.status).toBe(200)
      expect(res.body.artifacts).toEqual([])
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/artifacts', () => {
  it('accepts artifact upload from adapter shim', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-upload-1',
        artifactId: 'art-1',
        content: 'file contents here',
      })

      expect(res.status).toBe(201)
      expect(res.body.backendUri).toBe('artifact://agent-upload-1/art-1')
      expect(res.body.stored).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns 400 when missing agentId or artifactId', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {})
      expect(res.status).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/health', () => {
  it('returns health with tick', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(res.body.tick).toBe(0)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/:id/checkpoint', () => {
  it('stores a checkpoint for an agent', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-cp-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-cp-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-cp-1/checkpoint', {
        agentId: 'agent-cp-1',
        pluginName: 'mock',
        sessionId: 'session-cp-1',
        checkpoint: { sdk: 'mock', scriptPosition: 5 },
        briefSnapshot: makeMinimalBrief('agent-cp-1'),
        conversationSummary: 'Working on something',
        pendingDecisionIds: ['dec-1'],
        lastSequence: 10,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint',
        estimatedSizeBytes: 512,
        decisionId: 'dec-1',
      })

      expect(res.status).toBe(201)
      expect(res.body.stored).toBe(true)
      expect(res.body.agentId).toBe('agent-cp-1')
      expect(res.body.checkpointCount).toBe(1)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/nonexistent/checkpoint', {
        agentId: 'nonexistent',
        pluginName: 'mock',
        sessionId: 'session-1',
        checkpoint: { sdk: 'mock', scriptPosition: 0 },
        briefSnapshot: makeMinimalBrief('nonexistent'),
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint',
        estimatedSizeBytes: 256,
      })
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('returns 400 when agent ID in URL does not match body', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-cp-mismatch',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/agent-cp-mismatch/checkpoint', {
        agentId: 'different-agent',
        pluginName: 'mock',
        sessionId: 'session-1',
        checkpoint: { sdk: 'mock', scriptPosition: 0 },
        briefSnapshot: makeMinimalBrief('different-agent'),
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint',
        estimatedSizeBytes: 256,
      })
      expect(res.status).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/agents/:id/checkpoints', () => {
  it('returns checkpoints for an agent', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-cp-list',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    // Store a checkpoint first
    await httpPost(app.baseUrl, '/api/agents/agent-cp-list/checkpoint', {
      agentId: 'agent-cp-list',
      pluginName: 'mock',
      sessionId: 'session-1',
      checkpoint: { sdk: 'mock', scriptPosition: 5 },
      briefSnapshot: makeMinimalBrief('agent-cp-list'),
      pendingDecisionIds: ['dec-1'],
      lastSequence: 10,
      serializedAt: new Date().toISOString(),
      serializedBy: 'decision_checkpoint',
      estimatedSizeBytes: 512,
      decisionId: 'dec-1',
    })

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/agent-cp-list/checkpoints')
      expect(res.status).toBe(200)
      expect(res.body.agentId).toBe('agent-cp-list')
      expect(res.body.checkpoints).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for unknown agent', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/nonexistent/checkpoints')
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: GET /api/agents/:id/checkpoints/latest', () => {
  it('returns latest checkpoint for an agent', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-cp-latest',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    // Store two checkpoints
    await httpPost(app.baseUrl, '/api/agents/agent-cp-latest/checkpoint', {
      agentId: 'agent-cp-latest',
      pluginName: 'mock',
      sessionId: 'session-1',
      checkpoint: { sdk: 'mock', scriptPosition: 5 },
      briefSnapshot: makeMinimalBrief('agent-cp-latest'),
      pendingDecisionIds: ['dec-1'],
      lastSequence: 10,
      serializedAt: new Date(Date.now()).toISOString(),
      serializedBy: 'decision_checkpoint',
      estimatedSizeBytes: 512,
      decisionId: 'dec-1',
    })

    await httpPost(app.baseUrl, '/api/agents/agent-cp-latest/checkpoint', {
      agentId: 'agent-cp-latest',
      pluginName: 'mock',
      sessionId: 'session-1',
      checkpoint: { sdk: 'mock', scriptPosition: 10 },
      briefSnapshot: makeMinimalBrief('agent-cp-latest'),
      pendingDecisionIds: ['dec-2'],
      lastSequence: 20,
      serializedAt: new Date(Date.now() + 1000).toISOString(),
      serializedBy: 'decision_checkpoint',
      estimatedSizeBytes: 512,
      decisionId: 'dec-2',
    })

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/agent-cp-latest/checkpoints/latest')
      expect(res.status).toBe(200)
      expect(res.body.agentId).toBe('agent-cp-latest')
      expect(res.body.checkpoint).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns 404 when no checkpoints exist', async () => {
    const { deps, registry } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({
      id: 'agent-cp-empty',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    try {
      const res = await httpGet(app.baseUrl, '/api/agents/agent-cp-empty/checkpoints/latest')
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/brake (workstream scope)', () => {
  it('only affects agents in the specified workstream', async () => {
    const { deps, mockPlugin, registry } = createTestDeps()

    // Override getSnapshot to return agents with workstream info
    ;(deps.knowledgeStore as any).getSnapshot = async () => ({
      ...emptySnapshot(),
      activeAgents: [
        { id: 'agent-ws-a1', role: 'coder', workstream: 'backend', status: 'running', pluginName: 'mock' },
        { id: 'agent-ws-a2', role: 'coder', workstream: 'frontend', status: 'running', pluginName: 'mock' },
        { id: 'agent-ws-a3', role: 'coder', workstream: 'backend', status: 'running', pluginName: 'mock' },
      ],
    })

    const app = createTestApp(deps)
    await app.start()

    // Register all three agents
    registry.registerHandle({ id: 'agent-ws-a1', pluginName: 'mock', status: 'running', sessionId: 's1' })
    registry.registerHandle({ id: 'agent-ws-a2', pluginName: 'mock', status: 'running', sessionId: 's2' })
    registry.registerHandle({ id: 'agent-ws-a3', pluginName: 'mock', status: 'running', sessionId: 's3' })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake', {
        scope: { type: 'workstream', workstream: 'backend' },
        reason: 'Workstream brake test',
        behavior: 'kill',
        initiatedBy: 'human',
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.brakeApplied).toBe(true)
      expect(res.body.affectedAgentIds).toHaveLength(2)
      expect(res.body.affectedAgentIds).toContain('agent-ws-a1')
      expect(res.body.affectedAgentIds).toContain('agent-ws-a3')
      expect(res.body.affectedAgentIds).not.toContain('agent-ws-a2')

      // Backend agents removed, frontend agent still present
      expect(registry.getHandle('agent-ws-a1')).toBeNull()
      expect(registry.getHandle('agent-ws-a3')).toBeNull()
      expect(registry.getHandle('agent-ws-a2')).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  it('returns empty affected list when no agents match the workstream', async () => {
    const { deps, registry } = createTestDeps()

    ;(deps.knowledgeStore as any).getSnapshot = async () => ({
      ...emptySnapshot(),
      activeAgents: [
        { id: 'agent-ws-b1', role: 'coder', workstream: 'backend', status: 'running', pluginName: 'mock' },
      ],
    })

    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({ id: 'agent-ws-b1', pluginName: 'mock', status: 'running', sessionId: 's1' })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake', {
        scope: { type: 'workstream', workstream: 'nonexistent-ws' },
        reason: 'No match test',
        behavior: 'kill',
        initiatedBy: 'human',
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.brakeApplied).toBe(true)
      expect(res.body.affectedAgentIds).toHaveLength(0)

      // Agent should still be alive
      expect(registry.getHandle('agent-ws-b1')).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  it('pauses only agents in the specified workstream', async () => {
    const { deps, registry } = createTestDeps()

    ;(deps.knowledgeStore as any).getSnapshot = async () => ({
      ...emptySnapshot(),
      activeAgents: [
        { id: 'agent-ws-p1', role: 'coder', workstream: 'infra', status: 'running', pluginName: 'mock' },
        { id: 'agent-ws-p2', role: 'coder', workstream: 'ui', status: 'running', pluginName: 'mock' },
      ],
    })

    const app = createTestApp(deps)
    await app.start()

    registry.registerHandle({ id: 'agent-ws-p1', pluginName: 'mock', status: 'running', sessionId: 's1' })
    registry.registerHandle({ id: 'agent-ws-p2', pluginName: 'mock', status: 'running', sessionId: 's2' })

    try {
      const res = await httpPost(app.baseUrl, '/api/brake', {
        scope: { type: 'workstream', workstream: 'infra' },
        reason: 'Pause workstream test',
        behavior: 'pause',
        initiatedBy: 'human',
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.affectedAgentIds).toEqual(['agent-ws-p1'])

      expect(registry.getHandle('agent-ws-p1')?.status).toBe('paused')
      expect(registry.getHandle('agent-ws-p2')?.status).toBe('running')
    } finally {
      await app.close()
    }
  })
})

describe('Route wiring: POST /api/agents/spawn (state_sync snapshot)', () => {
  it('broadcasts state_sync with real snapshot data from knowledge store', async () => {
    const { deps, broadcasts } = createTestDeps()

    const fakeSnapshot = {
      version: 5,
      generatedAt: new Date().toISOString(),
      workstreams: [{ id: 'ws-1', label: 'Backend', status: 'active' as const, activeAgentIds: ['a1'], pendingDecisionCount: 1, artifactCount: 3 }],
      pendingDecisions: [{ decisionId: 'd1', agentId: 'a1', title: 'Pick DB', severity: 'medium' as const, enqueuedAt: new Date().toISOString() }],
      recentCoherenceIssues: [],
      artifactIndex: [{ artifactId: 'art-1', name: 'schema.sql', kind: 'code' as const, status: 'draft' as const, workstream: 'ws-1' }],
      activeAgents: [{ id: 'a1', role: 'coder', workstream: 'ws-1', status: 'running' as const, pluginName: 'mock' }],
      estimatedTokens: 1200,
    }

    ;(deps.knowledgeStore as any).getSnapshot = async () => fakeSnapshot

    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-snapshot-1'),
      })

      expect(res.status).toBe(201)

      // Find the state_sync broadcast
      const syncs = broadcasts.filter((m) => m.type === 'state_sync')
      expect(syncs.length).toBeGreaterThanOrEqual(1)

      const sync = syncs[syncs.length - 1]
      if (sync.type === 'state_sync') {
        // Should contain real snapshot data, not empty arrays
        expect(sync.snapshot.version).toBe(5)
        expect(sync.snapshot.workstreams).toHaveLength(1)
        expect(sync.snapshot.workstreams[0].id).toBe('ws-1')
        expect(sync.snapshot.pendingDecisions).toHaveLength(1)
        expect(sync.snapshot.artifactIndex).toHaveLength(1)
        expect(sync.snapshot.estimatedTokens).toBe(1200)
      }
    } finally {
      await app.close()
    }
  })
})
