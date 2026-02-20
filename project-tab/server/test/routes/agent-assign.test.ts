import { beforeEach, afterEach, describe, expect, it } from 'vitest'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import { wireEventHandlers, clearIdleTracking, DEFAULT_IDLE_TIMEOUT_TICKS } from '../../src/event-handlers'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, AgentPlugin, FrontendMessage, KnowledgeSnapshot } from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import { createApp } from '../../src/app'
import { createServer, type Server } from 'node:http'
import { listenEphemeral } from '../helpers/listen-ephemeral'

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
        conversationSummary: 'checkpoint',
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'decision_checkpoint' as const,
        estimatedSizeBytes: 256,
      }
    },
  }
}

function makeMinimalBrief(agentId: string, overrides?: Partial<{ workstream: string; description: string }>) {
  return {
    agentId,
    role: 'Test Agent',
    description: overrides?.description ?? 'A test agent',
    workstream: overrides?.workstream ?? 'test-ws',
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

function createTestDeps() {
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
  wsHub.broadcast = (msg: FrontendMessage) => { broadcasts.push(msg) }

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

  const knowledgeStore: KnowledgeStore & {
    updateAgentStatus(agentId: string, status: string): void
    removeAgent(agentId: string): void
  } = {
    async getSnapshot() { return emptySnapshot() },
    async appendEvent() {},
    updateAgentStatus() {},
    removeAgent() {},
  }

  const storedCheckpoints = new Map<string, any[]>()
  const checkpointStore: CheckpointStore = {
    storeCheckpoint(state, decisionId, maxPerAgent = 3) {
      const list = storedCheckpoints.get(state.agentId) ?? []
      list.unshift({ id: list.length + 1, agentId: state.agentId, sessionId: state.sessionId, serializedBy: state.serializedBy, decisionId, state, estimatedSizeBytes: state.estimatedSizeBytes, createdAt: new Date().toISOString() })
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

  return { deps, mockPlugin, registry, broadcasts, tickService, trustEngine, eventBus, checkpointStore, storedCheckpoints }
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

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

async function httpGet(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.json() as any }
}

describe('POST /api/agents/:id/assign', () => {
  let app: ReturnType<typeof createTestApp>
  let ctx: ReturnType<typeof createTestDeps>

  beforeEach(async () => {
    ctx = createTestDeps()
    app = createTestApp(ctx.deps)
    await app.start()
  })

  afterEach(async () => {
    await app.close()
  })

  async function spawnAndIdleAgent(agentId: string) {
    // Spawn
    const brief = makeMinimalBrief(agentId)
    const spawn = await httpPost(app.baseUrl, '/api/agents/spawn', { brief })
    expect(spawn.status).toBe(201)

    // Create a checkpoint so assign has something to resume from
    const state = {
      agentId,
      pluginName: 'mock',
      sessionId: `session-${agentId}`,
      checkpoint: { sdk: 'mock', scriptPosition: 0 },
      briefSnapshot: brief,
      pendingDecisionIds: [],
      lastSequence: 0,
      serializedAt: new Date().toISOString(),
      serializedBy: 'idle_completion',
      estimatedSizeBytes: 256,
    }
    ctx.checkpointStore.storeCheckpoint(state as any, `completion-${agentId}`)

    // Set agent to idle
    ctx.registry.updateHandle(agentId, { status: 'idle' })
    return brief
  }

  it('assigns new work to an idle agent and resumes it', async () => {
    await spawnAndIdleAgent('agent-1')

    const newBrief = makeMinimalBrief('agent-1', { workstream: 'new-ws', description: 'New task' })
    const res = await httpPost(app.baseUrl, '/api/agents/agent-1/assign', { brief: newBrief })
    expect(res.status).toBe(200)
    expect(res.body.assigned).toBe(true)
    expect(res.body.agentId).toBe('agent-1')

    // Agent should be running now
    const get = await httpGet(app.baseUrl, '/api/agents/agent-1')
    expect(get.body.agent.status).toBe('running')

    // Plugin.resume should have been called with the new brief
    expect(ctx.mockPlugin.calls.resume.length).toBe(1)
    const resumeState = ctx.mockPlugin.calls.resume[0][0] as any
    expect(resumeState.briefSnapshot.workstream).toBe('new-ws')
  })

  it('returns 409 when agent is running (not idle)', async () => {
    const brief = makeMinimalBrief('agent-2')
    await httpPost(app.baseUrl, '/api/agents/spawn', { brief })

    const newBrief = makeMinimalBrief('agent-2', { workstream: 'new-ws' })
    const res = await httpPost(app.baseUrl, '/api/agents/agent-2/assign', { brief: newBrief })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Agent is not idle')
    expect(res.body.currentStatus).toBe('running')
  })

  it('returns 404 for nonexistent agent', async () => {
    const newBrief = makeMinimalBrief('ghost')
    const res = await httpPost(app.baseUrl, '/api/agents/ghost/assign', { brief: newBrief })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Agent not found')
  })

  it('returns 409 when idle agent has no checkpoint', async () => {
    const brief = makeMinimalBrief('agent-3')
    await httpPost(app.baseUrl, '/api/agents/spawn', { brief })
    ctx.registry.updateHandle('agent-3', { status: 'idle' })

    // Don't store any checkpoint
    const newBrief = makeMinimalBrief('agent-3', { workstream: 'new-ws' })
    const res = await httpPost(app.baseUrl, '/api/agents/agent-3/assign', { brief: newBrief })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('No checkpoint to resume from')
  })

  it('preserves trust score across assignment (no re-registration)', async () => {
    await spawnAndIdleAgent('agent-4')

    // Manually set trust higher than initial
    ctx.trustEngine.registerAgent('agent-4', 0)
    ctx.trustEngine.applyOutcome('agent-4', 'task_completed_clean', 1)
    const scoreBefore = ctx.trustEngine.getScore('agent-4')!
    expect(scoreBefore).toBeGreaterThan(50)

    const newBrief = makeMinimalBrief('agent-4', { workstream: 'new-ws' })
    const res = await httpPost(app.baseUrl, '/api/agents/agent-4/assign', { brief: newBrief })
    expect(res.status).toBe(200)

    // Trust score should be preserved (not reset to 50)
    const scoreAfter = ctx.trustEngine.getScore('agent-4')
    expect(scoreAfter).toBe(scoreBefore)
  })
})

describe('Completion → idle transition (event handler)', () => {
  it('successful completion transitions agent to idle', async () => {
    const ctx = createTestDeps()

    // Wire event handlers so completion events are processed
    wireEventHandlers({
      eventBus: ctx.deps.eventBus,
      knowledgeStore: ctx.deps.knowledgeStore as any,
      classifier: { classify: (e: any) => ({ ...e, classification: 'info' }) } as any,
      wsHub: ctx.deps.wsHub as any,
      decisionQueue: ctx.deps.decisionQueue as any,
      tickService: ctx.deps.tickService as any,
      registry: ctx.registry,
      gateway: ctx.deps.gateway,
      checkpointStore: ctx.checkpointStore,
      coherenceMonitor: { processArtifact: () => null, shouldRunLayer1Scan: () => false, shouldRunLayer1cSweep: () => false, getConfig: () => ({ enableLayer2: false }), getDetectedIssues: () => [] } as any,
      trustEngine: ctx.trustEngine,
    })

    // Register and spawn an agent
    const handle: AgentHandle = { id: 'test-agent', pluginName: 'mock', status: 'running', sessionId: 'sess-1' }
    ctx.registry.registerHandle(handle)
    ctx.trustEngine.registerAgent('test-agent', 0)

    // Emit a successful completion event
    ctx.deps.eventBus.publish({
      sourceEventId: 'evt-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'completion',
        agentId: 'test-agent',
        summary: 'Done',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'success',
      },
    })

    // Allow async checkpoint to settle
    await new Promise(r => setTimeout(r, 50))

    const updated = ctx.registry.getHandle('test-agent')
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('idle')
  })

  it('abandoned completion transitions agent to completed (not idle)', async () => {
    const ctx = createTestDeps()

    wireEventHandlers({
      eventBus: ctx.deps.eventBus,
      knowledgeStore: ctx.deps.knowledgeStore as any,
      classifier: { classify: (e: any) => ({ ...e, classification: 'info' }) } as any,
      wsHub: ctx.deps.wsHub as any,
      decisionQueue: ctx.deps.decisionQueue as any,
      tickService: ctx.deps.tickService as any,
      registry: ctx.registry,
      gateway: ctx.deps.gateway,
      checkpointStore: ctx.checkpointStore,
      coherenceMonitor: { processArtifact: () => null, shouldRunLayer1Scan: () => false, shouldRunLayer1cSweep: () => false, getConfig: () => ({ enableLayer2: false }), getDetectedIssues: () => [] } as any,
      trustEngine: ctx.trustEngine,
    })

    const handle: AgentHandle = { id: 'test-agent-2', pluginName: 'mock', status: 'running', sessionId: 'sess-2' }
    ctx.registry.registerHandle(handle)
    ctx.trustEngine.registerAgent('test-agent-2', 0)

    ctx.deps.eventBus.publish({
      sourceEventId: 'evt-2',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-2',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'completion',
        agentId: 'test-agent-2',
        summary: 'Gave up',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'abandoned',
      },
    })

    await new Promise(r => setTimeout(r, 50))

    const updated = ctx.registry.getHandle('test-agent-2')
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
  })

  it('auto-checkpoint is created on successful completion', async () => {
    const ctx = createTestDeps()

    wireEventHandlers({
      eventBus: ctx.deps.eventBus,
      knowledgeStore: ctx.deps.knowledgeStore as any,
      classifier: { classify: (e: any) => ({ ...e, classification: 'info' }) } as any,
      wsHub: ctx.deps.wsHub as any,
      decisionQueue: ctx.deps.decisionQueue as any,
      tickService: ctx.deps.tickService as any,
      registry: ctx.registry,
      gateway: ctx.deps.gateway,
      checkpointStore: ctx.checkpointStore,
      coherenceMonitor: { processArtifact: () => null, shouldRunLayer1Scan: () => false, shouldRunLayer1cSweep: () => false, getConfig: () => ({ enableLayer2: false }), getDetectedIssues: () => [] } as any,
      trustEngine: ctx.trustEngine,
    })

    const handle: AgentHandle = { id: 'test-agent-3', pluginName: 'mock', status: 'running', sessionId: 'sess-3' }
    ctx.registry.registerHandle(handle)
    ctx.trustEngine.registerAgent('test-agent-3', 0)

    ctx.deps.eventBus.publish({
      sourceEventId: 'evt-3',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-3',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'completion',
        agentId: 'test-agent-3',
        summary: 'Done well',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'success',
      },
    })

    // Allow async checkpoint to complete
    await new Promise(r => setTimeout(r, 100))

    const checkpoint = ctx.checkpointStore.getLatestCheckpoint('test-agent-3')
    expect(checkpoint).toBeDefined()
    expect(checkpoint!.state.serializedBy).toBe('idle_completion')
  })
})

describe('Idle timeout cleanup', () => {
  it('exports DEFAULT_IDLE_TIMEOUT_TICKS', () => {
    expect(DEFAULT_IDLE_TIMEOUT_TICKS).toBe(500)
  })

  it('clearIdleTracking is callable', () => {
    // Just verifies the export exists and doesn't throw
    expect(() => clearIdleTracking('nonexistent')).not.toThrow()
  })
})
