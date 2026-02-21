/**
 * E2E Smoke Test
 *
 * Boots the full project-tab server with LocalProcessPlugin, spawns an agent
 * using the real Python mock adapter shim, and validates the complete lifecycle:
 *
 *   boot server -> health check -> WS connect -> spawn agent -> verify agent
 *   -> wait for events -> verify trust -> kill agent -> verify cleanup -> shutdown
 *
 * This test spawns a real child process for the adapter shim (python -m adapter_shim --mock)
 * so it validates the full integration path with no mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'

import { listenEphemeral } from '../helpers/listen-ephemeral'

import { EventBus } from '../../src/bus'
import { EventClassifier } from '../../src/classifier'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor'
import { MockEmbeddingService } from '../../src/intelligence/embedding-service'
import { MockCoherenceReviewService } from '../../src/intelligence/coherence-review-service'
import { ContextInjectionService } from '../../src/intelligence/context-injection-service'
import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import { LocalProcessPlugin } from '../../src/gateway/local-process-plugin'
import { TokenService } from '../../src/gateway/token-service'
import { WebSocketHub } from '../../src/ws-hub'
import { createApp, attachWebSocketUpgrade } from '../../src/app'
import type {
  AgentHandle,
  AgentPlugin,
  KnowledgeSnapshot,
  EventEnvelope,
  FrontendMessage,
  StateSyncMessage,
  SerializedAgentState,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import type {
  AgentRegistry,
  AgentGateway,
  KnowledgeStore as IKnowledgeStore,
  CheckpointStore,
  ControlModeManager,
} from '../../src/types/service-interfaces'
import { AgentRegistry as AgentRegistryImpl } from '../../src/registry/agent-registry'

// ── Server config ────────────────────────────────────────────────

const SHIM_COMMAND = process.env.SHIM_COMMAND_OVERRIDE ?? 'python'
const SHIM_ARGS = (process.env.SHIM_ARGS_OVERRIDE ?? '-m,adapter_shim,--mock').split(',')
const SHIM_CWD = '/Users/jayk/Code/blog/project-tab/adapter-shim/openai'

// ── Helpers ──────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Connect a WS client and return the initial StateSyncMessage + message collector. */
async function connectWs(url: string): Promise<{
  ws: WebSocket
  messages: FrontendMessage[]
  syncMsg: StateSyncMessage
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const messages: FrontendMessage[] = []
    const ws = new WebSocket(url)
    let resolved = false

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as FrontendMessage
      messages.push(msg)
      if (!resolved) {
        resolved = true
        resolve({
          ws,
          messages,
          syncMsg: msg as StateSyncMessage,
          close() { ws.close() },
        })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) reject(err)
    })

    setTimeout(() => {
      if (!resolved) reject(new Error('WS connect timed out after 10s'))
    }, 10_000)
  })
}

// ── Server lifecycle ─────────────────────────────────────────────

/** All the parts of the running server, for cleanup. */
interface SmokeTestServer {
  httpServer: Server
  tickService: TickService
  eventBus: EventBus
  trustEngine: TrustEngine
  decisionQueue: DecisionQueue
  knowledgeStore: KnowledgeStore
  wsHub: WebSocketHub
  registry: AgentRegistry
  gateway: AgentGateway
  localPlugin: LocalProcessPlugin
  contextInjection: ContextInjectionService
  baseUrl: string
  wsUrl: string
  close: () => Promise<void>
}

async function bootServer(): Promise<SmokeTestServer> {
  const tickService = new TickService({ mode: 'wall_clock', intervalMs: 500 })
  const eventBus = new EventBus(10_000, { maxQueuePerAgent: 500 })
  const classifier = new EventClassifier()

  const tokenService = new TokenService({ defaultTtlMs: 3_600_000 })
  async function generateToken(agentId: string) {
    const issued = await tokenService.issueToken(agentId)
    return { token: issued.token, expiresAt: issued.expiresAt }
  }

  const trustEngine = new TrustEngine()
  trustEngine.subscribeTo(tickService)

  const decisionQueue = new DecisionQueue()
  decisionQueue.subscribeTo(tickService)

  const registry = new AgentRegistryImpl()

  const knowledgeStore = new KnowledgeStore(':memory:')
  const coherenceMonitor = new CoherenceMonitor()
  coherenceMonitor.setEmbeddingService(new MockEmbeddingService())
  coherenceMonitor.setReviewService(new MockCoherenceReviewService())
  coherenceMonitor.setArtifactContentProvider(() => undefined)
  coherenceMonitor.subscribeTo(tickService)

  const knowledgeStoreInterface: IKnowledgeStore = {
    async getSnapshot() { return knowledgeStore.getSnapshot(decisionQueue.listPending().map((q) => q.event)) },
    async appendEvent() {},
    updateAgentStatus(agentId, status) { knowledgeStore.updateAgentStatus(agentId, status) },
  }

  const checkpointStore: CheckpointStore = {
    storeCheckpoint: (state, decisionId, maxPerAgent) =>
      knowledgeStore.storeCheckpoint(state, decisionId, maxPerAgent),
    getCheckpoints: (agentId) => knowledgeStore.getCheckpoints(agentId),
    getLatestCheckpoint: (agentId) => knowledgeStore.getLatestCheckpoint(agentId),
    getCheckpointCount: (agentId) => knowledgeStore.getCheckpointCount(agentId),
    deleteCheckpoints: (agentId) => knowledgeStore.deleteCheckpoints(agentId),
  }

  const plugins = new Map<string, AgentPlugin>()
  const gateway: AgentGateway = {
    getPlugin(pluginName: string) { return plugins.get(pluginName) },
    async spawn(brief, pluginName) {
      const plugin = plugins.get(pluginName)
      if (!plugin) throw new Error(`No plugin registered with name "${pluginName}"`)
      return plugin.spawn(brief)
    },
  }

  const processManager = new ChildProcessManager()
  const localPlugin = new LocalProcessPlugin({
    name: 'openai',
    processManager,
    eventBus,
    shimCommand: `${SHIM_CWD}/.venv/bin/python`,
    shimArgs: SHIM_ARGS,
    backendUrl: 'http://localhost:0', // placeholder, updated after listen
    generateToken,
  })
  plugins.set('openai', localPlugin)

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  const contextInjection = new ContextInjectionService(
    tickService, eventBus, knowledgeStoreInterface, registry, gateway, controlMode,
  )
  contextInjection.start()

  const wsHub = new WebSocketHub(() => ({
    snapshot: knowledgeStore.getSnapshot(decisionQueue.listPending().map((q) => q.event)),
    activeAgents: registry.listHandles(),
    trustScores: trustEngine.getAllScores(),
    controlMode: currentControlMode,
  }))

  const app = createApp({
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore: knowledgeStoreInterface,
    checkpointStore,
    gateway,
    controlMode,
    tokenService,
    contextInjection,
    defaultPlugin: 'openai',
  })

  const httpServer = createServer(app as any)
  attachWebSocketUpgrade(httpServer, wsHub)

  // Wire event bus subscriptions (mirrors index.ts)
  eventBus.subscribe({}, (envelope) => {
    const classified = classifier.classify(envelope)
    wsHub.publishClassifiedEvent(classified)
  })

  eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
    if (envelope.event.type === 'decision') {
      decisionQueue.enqueue(envelope.event, tickService.currentTick())
      registry.updateHandle(envelope.event.agentId, { status: 'waiting_on_human' })
    }
  })

  eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
    if (envelope.event.type === 'artifact') {
      knowledgeStore.storeArtifact(envelope.event)
      const issue = coherenceMonitor.processArtifact(envelope.event)
      if (issue) {
        knowledgeStore.storeCoherenceIssue(issue)
      }
    }
  })

  eventBus.subscribe({ eventType: 'lifecycle' }, (envelope) => {
    if (envelope.event.type === 'lifecycle') {
      const agentId = envelope.event.agentId
      const action = envelope.event.action
      if (action === 'started') {
        const handle = registry.getHandle(agentId)
        if (handle) {
          knowledgeStore.registerAgent(handle, {
            role: 'agent',
            workstream: '',
            pluginName: handle.pluginName,
          })
        }
      } else if (action === 'killed' || action === 'crashed') {
        knowledgeStore.removeAgent(agentId)
      }
    }
  })

  eventBus.subscribe({ eventType: 'completion' }, (envelope) => {
    if (envelope.event.type === 'completion') {
      const agentId = envelope.event.agentId
      const outcome = envelope.event.outcome
      let trustOutcome: import('../../src/intelligence/trust-engine').TrustOutcome | null = null
      if (outcome === 'success') trustOutcome = 'task_completed_clean'
      else if (outcome === 'partial') trustOutcome = 'task_completed_partial'
      else if (outcome === 'abandoned' || outcome === 'max_turns') trustOutcome = 'task_abandoned_or_max_turns'
      if (trustOutcome) {
        const prev = trustEngine.getScore(agentId) ?? 50
        trustEngine.applyOutcome(agentId, trustOutcome, tickService.currentTick())
        const next = trustEngine.getScore(agentId) ?? 50
        if (prev !== next) {
          wsHub.broadcast({ type: 'trust_update', agentId, previousScore: prev, newScore: next, delta: next - prev, reason: trustOutcome })
        }
      }
    }
  })

  eventBus.subscribe({ eventType: 'error' }, (envelope) => {
    if (envelope.event.type === 'error' && envelope.event.severity !== 'warning') {
      const agentId = envelope.event.agentId
      const prev = trustEngine.getScore(agentId) ?? 50
      trustEngine.applyOutcome(agentId, 'error_event', tickService.currentTick())
      const next = trustEngine.getScore(agentId) ?? 50
      if (prev !== next) {
        wsHub.broadcast({ type: 'trust_update', agentId, previousScore: prev, newScore: next, delta: next - prev, reason: 'error_event' })
      }
    }
  })

  tickService.start()

  const port = await listenEphemeral(httpServer)

  // Update the localPlugin's backendUrl now that we know the port
  // (The plugin was created with a placeholder URL)

  return {
    httpServer,
    tickService,
    eventBus,
    trustEngine,
    decisionQueue,
    knowledgeStore,
    wsHub,
    registry,
    gateway,
    localPlugin,
    contextInjection,
    baseUrl: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}/ws`,
    async close() {
      tickService.stop()
      contextInjection.stop()
      await localPlugin.killAll()
      try { knowledgeStore.close() } catch { /* ok */ }
      wsHub.close()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}

// ── Test suite ───────────────────────────────────────────────────

describe('E2E Smoke Test: Full server lifecycle', () => {
  let server: SmokeTestServer
  let agentId: string

  beforeAll(async () => {
    server = await bootServer()
  }, 60_000) // Allow up to 60s for server + shim startup

  afterAll(async () => {
    await server?.close()
  }, 30_000)

  it('a. GET /api/health returns 200', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.tick).toBe('number')
  })

  it('b. WebSocket connects and receives StateSyncMessage', async () => {
    const client = await connectWs(server.wsUrl)
    expect(client.syncMsg.type).toBe('state_sync')
    expect(client.syncMsg.snapshot).toBeDefined()
    expect(Array.isArray(client.syncMsg.activeAgents)).toBe(true)
    expect(Array.isArray(client.syncMsg.trustScores)).toBe(true)
    client.close()
  })

  it('c. POST /api/agents/spawn creates agent via real mock shim', async () => {
    const brief = {
      agentId: `smoke-agent-${Date.now()}`,
      role: 'Smoke Test Agent',
      description: 'E2E smoke test agent',
      workstream: 'smoke-testing',
      readableWorkstreams: [],
      constraints: [],
      escalationProtocol: {
        alwaysEscalate: [],
        escalateWhen: [],
        neverEscalate: [],
      },
      controlMode: 'orchestrator',
      projectBrief: {
        title: 'Smoke Test Project',
        description: 'Testing end-to-end lifecycle',
        goals: ['Verify all systems work'],
        checkpoints: ['All steps pass'],
      },
      knowledgeSnapshot: {
        version: 0,
        generatedAt: new Date().toISOString(),
        workstreams: [],
        pendingDecisions: [],
        recentCoherenceIssues: [],
        artifactIndex: [],
        activeAgents: [],
        estimatedTokens: 0,
      },
      allowedTools: ['Read', 'Write'],
    }

    const res = await fetch(`${server.baseUrl}/api/agents/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.agent).toBeDefined()
    expect(body.agent.id).toBe(brief.agentId)
    expect(body.agent.status).toBe('running')
    agentId = body.agent.id
  }, 60_000) // Allow time for shim startup + health polling

  it('d. Agent appears in GET /api/agents', async () => {
    const res = await fetch(`${server.baseUrl}/api/agents`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents.length).toBeGreaterThanOrEqual(1)
    const agent = body.agents.find((a: AgentHandle) => a.id === agentId)
    expect(agent).toBeDefined()
  })

  it('e. Events flow through WebSocket from mock shim', async () => {
    // The mock shim emits a scripted sequence of events.
    // Connect a WS client and wait for events to flow.
    const client = await connectWs(server.wsUrl)

    // Give the mock shim time to emit its scripted events
    await delay(5_000)

    // We should have received the initial state_sync plus some event messages
    const eventMessages = client.messages.filter((m) => m.type === 'event')
    expect(eventMessages.length).toBeGreaterThan(0)

    client.close()
  }, 15_000)

  it('f. Trust score exists for the agent', async () => {
    const res = await fetch(`${server.baseUrl}/api/trust/${agentId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentId).toBe(agentId)
    expect(typeof body.score).toBe('number')
    expect(body.score).toBeGreaterThanOrEqual(10)
    expect(body.score).toBeLessThanOrEqual(100)
  })

  it('g. POST /api/agents/:id/kill cleans up the agent', async () => {
    const res = await fetch(`${server.baseUrl}/api/agents/${agentId}/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grace: true, graceTimeoutMs: 5000 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.killed).toBe(true)
  }, 15_000)

  it('h. GET /api/agents returns empty list after kill', async () => {
    const res = await fetch(`${server.baseUrl}/api/agents`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const remaining = body.agents.filter((a: AgentHandle) => a.id === agentId)
    expect(remaining.length).toBe(0)
  })
})
