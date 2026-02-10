import { createServer } from 'node:http'

import { EventBus } from './bus'
import { EventClassifier } from './classifier'
import { createApp, attachWebSocketUpgrade } from './app'
import { TickService } from './tick'
import { TrustEngine } from './intelligence/trust-engine'
import { DecisionQueue } from './intelligence/decision-queue'
import { KnowledgeStore as KnowledgeStoreImpl } from './intelligence/knowledge-store'
import { CoherenceMonitor } from './intelligence/coherence-monitor'
import type { AgentHandle, KnowledgeSnapshot } from './types'
import type { ControlMode } from './types/events'
import type { AgentRegistry as IAgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from './routes'
import { AgentRegistry as AgentRegistryImpl } from './registry/agent-registry'
import { WebSocketHub } from './ws-hub'

const port = Number(process.env.PORT ?? 3001)
const tickMode = process.env.TICK_MODE === 'manual' ? 'manual' : 'wall_clock'
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 1000)

// Core services
const tickService = new TickService({ mode: tickMode, intervalMs: tickIntervalMs })
const eventBus = new EventBus(10_000, { maxQueuePerAgent: 500 })
const classifier = new EventClassifier()

// Intelligence layer
const trustEngine = new TrustEngine()
trustEngine.subscribeTo(tickService)

const decisionQueue = new DecisionQueue()
decisionQueue.subscribeTo(tickService)

// Agent registry - uses real AgentRegistry with route interface adapter
const agentRegistryImpl = new AgentRegistryImpl()

const registry: IAgentRegistry = {
  getHandle(agentId: string): AgentHandle | null {
    const entry = agentRegistryImpl.getById(agentId)
    return entry?.handle ?? null
  },
  listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[] {
    const all = agentRegistryImpl.getAll().map((e) => e.handle)
    if (!filter) return all
    return all.filter((h) => {
      if (filter.status && h.status !== filter.status) return false
      if (filter.pluginName && h.pluginName !== filter.pluginName) return false
      return true
    })
  },
  registerHandle(handle: AgentHandle): void {
    // Create a minimal SandboxInfo for the registry
    agentRegistryImpl.register(handle, {
      agentId: handle.id,
      transport: { type: 'in_process', eventSink: () => {} },
      providerType: 'local_process',
      createdAt: new Date().toISOString(),
      lastHeartbeatAt: null
    })
  },
  updateHandle(agentId: string, updates: Partial<AgentHandle>): void {
    const entry = agentRegistryImpl.getById(agentId)
    if (entry) {
      agentRegistryImpl.updateHandle(agentId, { ...entry.handle, ...updates })
    }
  },
  removeHandle(agentId: string): void {
    agentRegistryImpl.unregister(agentId)
  }
}

// Knowledge store and coherence monitor
const knowledgeStoreImpl = new KnowledgeStoreImpl()
const coherenceMonitor = new CoherenceMonitor()

const knowledgeStore: KnowledgeStore = {
  async getSnapshot(_workstream?: string): Promise<KnowledgeSnapshot> {
    return knowledgeStoreImpl.getSnapshot(decisionQueue.listPending())
  },
  async appendEvent(): Promise<void> {
    // Phase 1: no-op, events are delivered via EventBus
  }
}

// Checkpoint store — delegates to knowledgeStoreImpl
const checkpointStore: CheckpointStore = {
  storeCheckpoint: (state, decisionId, maxPerAgent) => knowledgeStoreImpl.storeCheckpoint(state, decisionId, maxPerAgent),
  getCheckpoints: (agentId) => knowledgeStoreImpl.getCheckpoints(agentId),
  getLatestCheckpoint: (agentId) => knowledgeStoreImpl.getLatestCheckpoint(agentId),
  getCheckpointCount: (agentId) => knowledgeStoreImpl.getCheckpointCount(agentId),
  deleteCheckpoints: (agentId) => knowledgeStoreImpl.deleteCheckpoints(agentId),
}

// Agent gateway stub (plugins register themselves)
const plugins = new Map<string, import('./types').AgentPlugin>()
const gateway: AgentGateway = {
  getPlugin(pluginName: string) {
    return plugins.get(pluginName)
  },
  async spawn(brief, pluginName) {
    const plugin = plugins.get(pluginName)
    if (!plugin) {
      throw new Error(`No plugin registered with name "${pluginName}"`)
    }
    return plugin.spawn(brief)
  }
}

/** Register a plugin with the gateway. */
export function registerPlugin(plugin: import('./types').AgentPlugin): void {
  plugins.set(plugin.name, plugin)
}

// Control mode manager
let currentControlMode: ControlMode = 'orchestrator'
const controlMode: ControlModeManager = {
  getMode() { return currentControlMode },
  setMode(mode: ControlMode) { currentControlMode = mode }
}

// WebSocket hub with real state provider
const wsHub = new WebSocketHub(() => ({
  snapshot: knowledgeStoreImpl.getSnapshot(decisionQueue.listPending()),
  activeAgents: registry.listHandles(),
  trustScores: trustEngine.getAllScores(),
  controlMode: currentControlMode
}))

// Wire app with all dependencies
const app = createApp({
  tickService,
  eventBus,
  wsHub,
  trustEngine,
  decisionQueue,
  registry,
  knowledgeStore,
  checkpointStore,
  gateway,
  controlMode
})

const server = createServer(app as any)

attachWebSocketUpgrade(server, wsHub)

// Subscribe event bus to classifier + WS fan-out
eventBus.subscribe({}, (envelope) => {
  const classified = classifier.classify(envelope)
  wsHub.publishClassifiedEvent(classified)
})

// Subscribe event bus to decision queue (auto-enqueue decision events)
// Also triggers auto-checkpoint: serialize agent state when it blocks for human input
eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
  if (envelope.event.type === 'decision') {
    decisionQueue.enqueue(envelope.event, tickService.currentTick())

    const agentId = envelope.event.agentId
    const decisionId = envelope.event.decisionId

    // Update agent status to waiting_on_human
    registry.updateHandle(agentId, { status: 'waiting_on_human' })

    // Auto-checkpoint: request serialized state from the adapter shim
    const handle = registry.getHandle(agentId)
    if (handle) {
      const plugin = gateway.getPlugin(handle.pluginName)
      if (plugin) {
        plugin.requestCheckpoint(handle, decisionId).then((state) => {
          checkpointStore.storeCheckpoint(state, decisionId)
          // eslint-disable-next-line no-console
          console.log(`[checkpoint] stored decision checkpoint for agent ${agentId}, decision ${decisionId}`)
        }).catch((err: Error) => {
          // eslint-disable-next-line no-console
          console.error(`[checkpoint] failed to checkpoint agent ${agentId} on decision ${decisionId}:`, err.message)
        })
      }
    }
  }
})

// Subscribe event bus to knowledge store (store artifacts)
eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
  if (envelope.event.type === 'artifact') {
    knowledgeStoreImpl.storeArtifact(envelope.event)

    // Run coherence check
    const issue = coherenceMonitor.processArtifact(envelope.event)
    if (issue) {
      knowledgeStoreImpl.storeCoherenceIssue(issue)

      // Publish coherence event to the bus for UI delivery
      const coherenceEnvelope = {
        sourceEventId: `coherence-${issue.issueId}`,
        sourceSequence: -1,
        sourceOccurredAt: new Date().toISOString(),
        runId: envelope.runId,
        ingestedAt: new Date().toISOString(),
        event: issue
      }
      // Deliver to WS subscribers (skip bus to avoid dedup issues with synthetic events)
      const classified = classifier.classify(coherenceEnvelope)
      wsHub.publishClassifiedEvent(classified)
    }
  }
})

// Subscribe to lifecycle events to track agent status in knowledge store
eventBus.subscribe({ eventType: 'lifecycle' }, (envelope) => {
  if (envelope.event.type === 'lifecycle') {
    const agentId = envelope.event.agentId
    const action = envelope.event.action
    if (action === 'started') {
      // Register the agent in the knowledge store so updateAgentStatus/removeAgent work
      const handle = registry.getHandle(agentId)
      if (handle) {
        knowledgeStoreImpl.registerAgent(handle, {
          role: 'agent',
          workstream: '',
          pluginName: handle.pluginName,
        })
      } else {
        // Handle not yet in registry — register with minimal info
        knowledgeStoreImpl.registerAgent(
          { id: agentId, pluginName: 'unknown', status: 'running', sessionId: '' },
          { role: 'agent', workstream: '', pluginName: 'unknown' }
        )
      }
    } else if (action === 'paused') {
      knowledgeStoreImpl.updateAgentStatus(agentId, 'paused')
    } else if (action === 'resumed') {
      knowledgeStoreImpl.updateAgentStatus(agentId, 'running')
    } else if (action === 'killed' || action === 'crashed') {
      knowledgeStoreImpl.removeAgent(agentId)
    }
  }
})

// Subscribe to completion events for trust tracking
eventBus.subscribe({ eventType: 'completion' }, (envelope) => {
  if (envelope.event.type === 'completion') {
    const agentId = envelope.event.agentId
    const outcome = envelope.event.outcome

    let trustOutcome: import('./intelligence/trust-engine').TrustOutcome | null = null
    if (outcome === 'success') {
      trustOutcome = 'task_completed_clean'
    } else if (outcome === 'partial') {
      trustOutcome = 'task_completed_partial'
    } else if (outcome === 'abandoned' || outcome === 'max_turns') {
      trustOutcome = 'task_abandoned_or_max_turns'
    }

    if (trustOutcome) {
      const previousScore = trustEngine.getScore(agentId) ?? 50
      trustEngine.applyOutcome(agentId, trustOutcome, tickService.currentTick())
      const newScore = trustEngine.getScore(agentId) ?? 50

      if (previousScore !== newScore) {
        wsHub.broadcast({
          type: 'trust_update',
          agentId,
          previousScore,
          newScore,
          delta: newScore - previousScore,
          reason: trustOutcome
        })
      }
    }
  }
})

// Subscribe to error events for trust tracking
eventBus.subscribe({ eventType: 'error' }, (envelope) => {
  if (envelope.event.type === 'error' && envelope.event.severity !== 'warning') {
    const agentId = envelope.event.agentId
    const previousScore = trustEngine.getScore(agentId) ?? 50
    trustEngine.applyOutcome(agentId, 'error_event', tickService.currentTick())
    const newScore = trustEngine.getScore(agentId) ?? 50

    if (previousScore !== newScore) {
      wsHub.broadcast({
        type: 'trust_update',
        agentId,
        previousScore,
        newScore,
        delta: newScore - previousScore,
        reason: 'error_event'
      })
    }
  }
})

tickService.start()

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[project-tab-server] listening on :${port} (tickMode=${tickService.getMode()}, intervalMs=${tickIntervalMs})`
  )
})
