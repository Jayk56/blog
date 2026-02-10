/**
 * Tests for the auto-checkpoint-on-decision flow (D6).
 *
 * When a decision event arrives on the EventBus, the backend should:
 * 1. Enqueue the decision in the DecisionQueue
 * 2. Update the agent's status to 'waiting_on_human'
 * 3. Request a checkpoint from the adapter shim (via plugin.requestCheckpoint)
 * 4. Store the checkpoint in the CheckpointStore
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import type { AgentHandle, AgentPlugin, DecisionEvent, SerializedAgentState, KnowledgeSnapshot, AgentBrief } from '../../src/types'
import type { AgentRegistry, AgentGateway, CheckpointStore } from '../../src/routes'

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

function makeMinimalBrief(agentId: string): AgentBrief {
  return {
    agentId,
    role: 'developer',
    description: 'Test agent',
    workstream: 'ws-1',
    readableWorkstreams: [],
    constraints: [],
    escalationProtocol: { alwaysEscalate: [], escalateWhen: [], neverEscalate: [] },
    controlMode: 'adaptive',
    projectBrief: { title: 'Test', description: 'Test', goals: [], checkpoints: [] },
    knowledgeSnapshot: emptySnapshot(),
    allowedTools: [],
  }
}

function makeCheckpointState(agentId: string, decisionId: string): SerializedAgentState {
  return {
    agentId,
    pluginName: 'mock',
    sessionId: `session-${agentId}`,
    checkpoint: { sdk: 'mock', scriptPosition: 5 },
    briefSnapshot: makeMinimalBrief(agentId),
    conversationSummary: 'Agent blocked on decision',
    pendingDecisionIds: [decisionId],
    lastSequence: 10,
    serializedAt: new Date().toISOString(),
    serializedBy: 'decision_checkpoint',
    estimatedSizeBytes: 256,
  }
}

function makeDecisionEvent(agentId: string, decisionId: string): DecisionEvent {
  return {
    type: 'decision',
    subtype: 'tool_approval',
    agentId,
    decisionId,
    toolName: 'execute_code',
    toolArgs: { code: 'print("hello")' },
  }
}

// ── Test setup ───────────────────────────────────────────────────────────

interface TestContext {
  eventBus: EventBus
  tickService: TickService
  decisionQueue: DecisionQueue
  registry: AgentRegistry
  gateway: AgentGateway
  checkpointStore: CheckpointStore
  mockPlugin: AgentPlugin & { checkpointCalls: Array<{ handle: AgentHandle; decisionId: string }> }
  handles: Map<string, AgentHandle>
  storedCheckpoints: Map<string, Array<{ state: SerializedAgentState; decisionId?: string }>>
}

function createTestContext(): TestContext {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()
  const decisionQueue = new DecisionQueue()

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

  const checkpointCalls: Array<{ handle: AgentHandle; decisionId: string }> = []

  const mockPlugin: AgentPlugin & { checkpointCalls: typeof checkpointCalls } = {
    name: 'mock',
    version: '1.0.0',
    capabilities: { supportsPause: true, supportsResume: true, supportsKill: true, supportsHotBriefUpdate: true },
    checkpointCalls,
    async spawn() { return {} as AgentHandle },
    async pause() { return {} as SerializedAgentState },
    async resume() { return {} as AgentHandle },
    async kill() { return { cleanShutdown: true, artifactsExtracted: 0 } },
    async resolveDecision() {},
    async injectContext() {},
    async updateBrief() {},
    async requestCheckpoint(handle: AgentHandle, decisionId: string) {
      checkpointCalls.push({ handle, decisionId })
      return makeCheckpointState(handle.id, decisionId)
    },
  }

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

  const storedCheckpoints = new Map<string, Array<{ state: SerializedAgentState; decisionId?: string }>>()
  const checkpointStore: CheckpointStore = {
    storeCheckpoint(state, decisionId, maxPerAgent = 3) {
      const list = storedCheckpoints.get(state.agentId) ?? []
      list.unshift({ state, decisionId })
      if (list.length > maxPerAgent) list.length = maxPerAgent
      storedCheckpoints.set(state.agentId, list)
    },
    getCheckpoints(agentId) { return (storedCheckpoints.get(agentId) ?? []) as any },
    getLatestCheckpoint(agentId) { return (storedCheckpoints.get(agentId) ?? [])[0] as any },
    getCheckpointCount(agentId) { return (storedCheckpoints.get(agentId) ?? []).length },
    deleteCheckpoints(agentId) { const n = (storedCheckpoints.get(agentId) ?? []).length; storedCheckpoints.delete(agentId); return n },
  }

  return { eventBus, tickService, decisionQueue, registry, gateway, checkpointStore, mockPlugin, handles, storedCheckpoints }
}

/**
 * Wire the decision event subscription exactly as index.ts does.
 * This tests the wiring logic in isolation without starting a full server.
 */
function wireDecisionSubscription(ctx: TestContext) {
  ctx.eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
    if (envelope.event.type === 'decision') {
      ctx.decisionQueue.enqueue(envelope.event, ctx.tickService.currentTick())

      const agentId = envelope.event.agentId
      const decisionId = envelope.event.decisionId

      // Update agent status to waiting_on_human
      ctx.registry.updateHandle(agentId, { status: 'waiting_on_human' })

      // Auto-checkpoint
      const handle = ctx.registry.getHandle(agentId)
      if (handle) {
        const plugin = ctx.gateway.getPlugin(handle.pluginName)
        if (plugin) {
          plugin.requestCheckpoint(handle, decisionId).then((state) => {
            ctx.checkpointStore.storeCheckpoint(state, decisionId)
          }).catch(() => {
            // Silently ignore for tests
          })
        }
      }
    }
  })
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Auto-checkpoint on decision event', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    wireDecisionSubscription(ctx)
  })

  it('enqueues decision in the DecisionQueue', () => {
    // Register an agent
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    const event = makeDecisionEvent('agent-1', 'dec-1')

    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event,
    })

    const pending = ctx.decisionQueue.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].event.decisionId).toBe('dec-1')
  })

  it('updates agent status to waiting_on_human', () => {
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: makeDecisionEvent('agent-1', 'dec-1'),
    })

    const handle = ctx.registry.getHandle('agent-1')
    expect(handle?.status).toBe('waiting_on_human')
  })

  it('calls plugin.requestCheckpoint with the decision ID', async () => {
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: makeDecisionEvent('agent-1', 'dec-1'),
    })

    // Wait for async checkpoint call to complete
    await new Promise((r) => setTimeout(r, 50))

    expect(ctx.mockPlugin.checkpointCalls).toHaveLength(1)
    expect(ctx.mockPlugin.checkpointCalls[0].handle.id).toBe('agent-1')
    expect(ctx.mockPlugin.checkpointCalls[0].decisionId).toBe('dec-1')
  })

  it('stores the checkpoint in the CheckpointStore', async () => {
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: makeDecisionEvent('agent-1', 'dec-1'),
    })

    // Wait for async checkpoint call to complete
    await new Promise((r) => setTimeout(r, 50))

    const stored = ctx.storedCheckpoints.get('agent-1')
    expect(stored).toBeDefined()
    expect(stored).toHaveLength(1)
    expect(stored![0].decisionId).toBe('dec-1')
    expect(stored![0].state.serializedBy).toBe('decision_checkpoint')
    expect(stored![0].state.pendingDecisionIds).toContain('dec-1')
  })

  it('handles multiple decisions from same agent', async () => {
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    for (let i = 0; i < 3; i++) {
      ctx.eventBus.publish({
        sourceEventId: `ev-${i}`,
        sourceSequence: i,
        sourceOccurredAt: new Date().toISOString(),
        runId: 'run-1',
        ingestedAt: new Date().toISOString(),
        event: makeDecisionEvent('agent-1', `dec-${i}`),
      })
    }

    await new Promise((r) => setTimeout(r, 100))

    expect(ctx.mockPlugin.checkpointCalls).toHaveLength(3)
    const stored = ctx.storedCheckpoints.get('agent-1')
    expect(stored).toHaveLength(3)
  })

  it('does not crash when agent has no plugin', () => {
    ctx.handles.set('agent-orphan', {
      id: 'agent-orphan',
      pluginName: 'nonexistent-plugin',
      status: 'running',
      sessionId: 'session-1',
    })

    // Should not throw
    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: makeDecisionEvent('agent-orphan', 'dec-1'),
    })

    // Decision should still be enqueued
    const pending = ctx.decisionQueue.listPending()
    expect(pending).toHaveLength(1)
  })

  it('does not crash when agent is not registered', () => {
    // No agent registered, but event still has an agentId
    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: makeDecisionEvent('unknown-agent', 'dec-1'),
    })

    // Decision should still be enqueued
    const pending = ctx.decisionQueue.listPending()
    expect(pending).toHaveLength(1)
  })

  it('stores checkpoint for option decisions too', async () => {
    ctx.handles.set('agent-1', {
      id: 'agent-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-1',
    })

    ctx.eventBus.publish({
      sourceEventId: 'ev-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-1',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'decision',
        subtype: 'option',
        agentId: 'agent-1',
        decisionId: 'dec-option-1',
        title: 'Choose approach',
        summary: 'Which approach?',
        severity: 'medium',
        confidence: 0.8,
        blastRadius: 'small',
        options: [
          { id: 'o1', label: 'Option A', description: 'First approach' },
          { id: 'o2', label: 'Option B', description: 'Second approach' },
        ],
        affectedArtifactIds: [],
        requiresRationale: false,
      } as DecisionEvent,
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(ctx.mockPlugin.checkpointCalls).toHaveLength(1)
    expect(ctx.mockPlugin.checkpointCalls[0].decisionId).toBe('dec-option-1')

    const stored = ctx.storedCheckpoints.get('agent-1')
    expect(stored).toHaveLength(1)
    expect(stored![0].decisionId).toBe('dec-option-1')
  })
})

describe('Checkpoint storage with KnowledgeStore (SQLite)', () => {
  let store: KnowledgeStore

  beforeEach(() => {
    store = new KnowledgeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('stores decision_checkpoint and retrieves with decision ID', () => {
    const state = makeCheckpointState('agent-1', 'dec-1')
    store.storeCheckpoint(state, 'dec-1')

    const latest = store.getLatestCheckpoint('agent-1')
    expect(latest).toBeDefined()
    expect(latest!.decisionId).toBe('dec-1')
    expect(latest!.serializedBy).toBe('decision_checkpoint')
    expect(latest!.state.pendingDecisionIds).toContain('dec-1')
    expect(latest!.state.conversationSummary).toBe('Agent blocked on decision')
  })

  it('prunes old decision checkpoints beyond maxPerAgent', () => {
    for (let i = 0; i < 5; i++) {
      const state: SerializedAgentState = {
        ...makeCheckpointState('agent-1', `dec-${i}`),
        serializedAt: new Date(Date.now() + i * 1000).toISOString(),
      }
      store.storeCheckpoint(state, `dec-${i}`)
    }

    const checkpoints = store.getCheckpoints('agent-1')
    expect(checkpoints).toHaveLength(3) // default max is 3
    // Should keep newest 3
    const ids = checkpoints.map((c) => c.decisionId)
    expect(ids).toContain('dec-4')
    expect(ids).toContain('dec-3')
    expect(ids).toContain('dec-2')
  })
})
