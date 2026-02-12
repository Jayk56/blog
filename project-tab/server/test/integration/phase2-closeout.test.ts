/**
 * Phase 2 Closeout Integration Tests
 *
 * Validates Phase 2 acceptance criteria from AGENT-PLUGIN-DESIGN.md (lines 3192-3204).
 * Tests cover:
 *  1. KnowledgeStore SQLite with optimistic concurrency (P2-1)
 *  2. ContainerPlugin sandbox provisioning (mocked Docker) (P2-2)
 *  3. Agent registry tracks multi-agent fleet (P2-3)
 *  4. MCP provisioning resolves servers for agent briefs (P2-4)
 *  5. Token service issues and validates JWTs (P2-5)
 *  6. Checkpoint-on-decision flow (P2-6)
 *  7. ContextInjectionService periodic + reactive (P2-7)
 *  8. Cross-provider: two agents from different plugins on same project (P2-8)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createServer } from 'node:http'

import { EventBus } from '../../src/bus'
import { EventClassifier } from '../../src/classifier'
import { TickService } from '../../src/tick'
import { WebSocketHub, type StateSnapshotProvider } from '../../src/ws-hub'
import { attachWebSocketUpgrade, createApp } from '../../src/app'
import { EventStreamClient } from '../../src/gateway/event-stream-client'
import { TokenService } from '../../src/gateway/token-service'
import { MCPProvisioner, type ToolMCPMapping, type BackendMCPServer } from '../../src/gateway/mcp-provisioner'
import { AgentRegistry as AgentRegistryImpl } from '../../src/registry/agent-registry'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore, ConflictError } from '../../src/intelligence/knowledge-store'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor'
import { MockEmbeddingService } from '../../src/intelligence/embedding-service'
import { MockCoherenceReviewService } from '../../src/intelligence/coherence-review-service'
import { ContextInjectionService } from '../../src/intelligence/context-injection-service'

import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ArtifactEvent,
  DecisionEvent,
  EventEnvelope,
  FrontendMessage,
  KnowledgeSnapshot,
  SerializedAgentState,
  StateSyncMessage,
  WorkspaceEventMessage,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import type {
  AgentRegistry,
  AgentGateway,
  CheckpointStore,
  ControlModeManager,
} from '../../src/routes'

import { createMockAdapterShim, type MockAdapterShim, type MockShimEvent } from './mock-adapter-shim'
import {
  makeAgentBrief,
  makeAdapterEvent,
  emptySnapshot,
  resetSeqCounter,
  shimEvent,
  statusAndToolCallSequence,
  decisionBlockSequence,
} from './fixtures'

// ── Helpers ────────────────────────────────────────────────────────

let portCounter = 9850

function allocPort(): number {
  return portCounter++
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeMinimalBrief(agentId: string, overrides: Partial<AgentBrief> = {}): AgentBrief {
  return makeAgentBrief({ agentId, ...overrides })
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

/** Connect a WS client and collect messages. */
async function connectWsClient(wsUrl: string) {
  const messages: FrontendMessage[] = []

  return new Promise<{
    ws: WebSocket
    messages: FrontendMessage[]
    syncMsg: StateSyncMessage
    close: () => void
  }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let firstMessage = true

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as FrontendMessage
      messages.push(msg)

      if (firstMessage) {
        firstMessage = false
        resolve({
          ws,
          messages,
          syncMsg: msg as StateSyncMessage,
          close() { ws.close() },
        })
      }
    })

    ws.on('error', reject)
    setTimeout(() => reject(new Error('WS connect timed out')), 5000)
  })
}

// ── P2-1: KnowledgeStore SQLite with optimistic concurrency ──────

describe('P2-1: KnowledgeStore SQLite + Optimistic Concurrency', () => {
  let store: KnowledgeStore

  beforeEach(() => {
    store = new KnowledgeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('stores and retrieves artifacts with full provenance', () => {
    const artifact: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-ks-1',
      artifactId: 'art-ks-1',
      name: 'design.md',
      kind: 'document',
      workstream: 'ws-core',
      status: 'draft',
      qualityScore: 0.88,
      provenance: {
        createdBy: 'agent-ks-1',
        createdAt: new Date().toISOString(),
        sourcePath: '/docs/design.md',
      },
    }

    store.storeArtifact(artifact)

    const retrieved = store.getArtifact('art-ks-1')
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('design.md')
    expect(retrieved!.agentId).toBe('agent-ks-1')
    expect(retrieved!.provenance.sourcePath).toBe('/docs/design.md')
  })

  it('stores and lists coherence issues', () => {
    store.storeCoherenceIssue({
      type: 'coherence',
      agentId: 'agent-ks-coh',
      issueId: 'coh-1',
      title: 'File conflict on /shared.ts',
      description: 'Two agents modified the same file',
      category: 'duplication',
      severity: 'high',
      affectedWorkstreams: ['ws-a', 'ws-b'],
      affectedArtifactIds: ['art-a', 'art-b'],
    })

    const issues = store.listCoherenceIssues()
    expect(issues.length).toBe(1)
    expect(issues[0]!.category).toBe('duplication')
    expect(issues[0]!.severity).toBe('high')
  })

  it('registers and lists agents', () => {
    const handle: AgentHandle = {
      id: 'agent-ks-reg',
      pluginName: 'openai',
      status: 'running',
      sessionId: 'session-reg',
    }

    store.registerAgent(handle, {
      role: 'Developer',
      workstream: 'ws-core',
      pluginName: 'openai',
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.activeAgents.length).toBe(1)
    expect(snapshot.activeAgents[0]!.id).toBe('agent-ks-reg')
    expect(snapshot.activeAgents[0]!.role).toBe('Developer')
  })

  it('removes agent and updates snapshot', () => {
    const handle: AgentHandle = {
      id: 'agent-ks-remove',
      pluginName: 'openai',
      status: 'running',
      sessionId: 'session-remove',
    }

    store.registerAgent(handle, {
      role: 'Tester',
      workstream: 'ws-test',
      pluginName: 'openai',
    })

    store.removeAgent('agent-ks-remove')
    const snapshot = store.getSnapshot()
    expect(snapshot.activeAgents.length).toBe(0)
  })

  it('getSnapshot produces well-formed KnowledgeSnapshot', () => {
    const snapshot = store.getSnapshot()
    expect(snapshot.version).toBeTypeOf('number')
    expect(snapshot.generatedAt).toBeTypeOf('string')
    expect(Array.isArray(snapshot.workstreams)).toBe(true)
    expect(Array.isArray(snapshot.pendingDecisions)).toBe(true)
    expect(Array.isArray(snapshot.recentCoherenceIssues)).toBe(true)
    expect(Array.isArray(snapshot.artifactIndex)).toBe(true)
    expect(Array.isArray(snapshot.activeAgents)).toBe(true)
    expect(typeof snapshot.estimatedTokens).toBe('number')
  })

  it('stores and retrieves artifact content', () => {
    store.storeArtifactContent('agent-1', 'art-content-1', 'console.log("test")', 'text/javascript')

    const content = store.getArtifactContent('agent-1', 'art-content-1')
    expect(content).toBeDefined()
    expect(content!.content).toBe('console.log("test")')
    expect(content!.mimeType).toBe('text/javascript')
  })

  it('stores and retrieves checkpoints with pruning', () => {
    for (let i = 0; i < 5; i++) {
      const state: SerializedAgentState = {
        ...makeCheckpointState('agent-cp', `dec-${i}`),
        serializedAt: new Date(Date.now() + i * 1000).toISOString(),
      }
      store.storeCheckpoint(state, `dec-${i}`)
    }

    const checkpoints = store.getCheckpoints('agent-cp')
    expect(checkpoints.length).toBe(3) // Default max is 3
    expect(store.getCheckpointCount('agent-cp')).toBe(3)

    const latest = store.getLatestCheckpoint('agent-cp')
    expect(latest).toBeDefined()
    expect(latest!.decisionId).toBe('dec-4')
  })
})

// ── P2-3: Agent Registry Tracks Multi-Agent Fleet ────────────────

describe('P2-3: Agent Registry Multi-Agent Fleet', () => {
  it('registers and tracks multiple agents', () => {
    const registry = new AgentRegistryImpl()

    for (let i = 0; i < 5; i++) {
      registry.register(
        { id: `agent-${i}`, pluginName: i < 3 ? 'openai' : 'claude', status: 'running', sessionId: `s-${i}` },
        {
          agentId: `agent-${i}`,
          transport: { type: 'in_process', eventSink: () => {} },
          providerType: 'local_process',
          createdAt: new Date().toISOString(),
          lastHeartbeatAt: null,
        },
      )
    }

    expect(registry.size).toBe(5)
    expect(registry.getAll().length).toBe(5)

    // Filter by plugin
    const openaiAgents = registry.getAll().filter((e) => e.handle.pluginName === 'openai')
    expect(openaiAgents.length).toBe(3)

    const claudeAgents = registry.getAll().filter((e) => e.handle.pluginName === 'claude')
    expect(claudeAgents.length).toBe(2)
  })

  it('getById returns null for non-existent agent', () => {
    const registry = new AgentRegistryImpl()
    expect(registry.getById('nonexistent')).toBeUndefined()
  })

  it('updateHandle changes agent status', () => {
    const registry = new AgentRegistryImpl()
    registry.register(
      { id: 'agent-upd', pluginName: 'openai', status: 'running', sessionId: 's-upd' },
      {
        agentId: 'agent-upd',
        transport: { type: 'in_process', eventSink: () => {} },
        providerType: 'local_process',
        createdAt: new Date().toISOString(),
        lastHeartbeatAt: null,
      },
    )

    registry.updateHandle('agent-upd', { ...registry.getById('agent-upd')!.handle, status: 'paused' })
    expect(registry.getById('agent-upd')!.handle.status).toBe('paused')
  })

  it('unregister removes agent and decrements size', () => {
    const registry = new AgentRegistryImpl()
    registry.register(
      { id: 'agent-unreg', pluginName: 'openai', status: 'running', sessionId: 's-unreg' },
      {
        agentId: 'agent-unreg',
        transport: { type: 'in_process', eventSink: () => {} },
        providerType: 'local_process',
        createdAt: new Date().toISOString(),
        lastHeartbeatAt: null,
      },
    )

    registry.unregister('agent-unreg')
    expect(registry.size).toBe(0)
    expect(registry.getById('agent-unreg')).toBeUndefined()
  })

  it('killAll removes all agents', () => {
    const registry = new AgentRegistryImpl()
    for (let i = 0; i < 3; i++) {
      registry.register(
        { id: `agent-kill-${i}`, pluginName: 'openai', status: 'running', sessionId: `s-${i}` },
        {
          agentId: `agent-kill-${i}`,
          transport: { type: 'in_process', eventSink: () => {} },
          providerType: 'local_process',
          createdAt: new Date().toISOString(),
          lastHeartbeatAt: null,
        },
      )
    }

    const killed = registry.killAll()
    expect(killed).toHaveLength(3)
    expect(registry.size).toBe(0)
  })
})

// ── P2-4: MCP Provisioning ───────────────────────────────────────

describe('P2-4: MCP Provisioning', () => {
  it('resolves stdio MCP servers from tool mappings', () => {
    const toolMappings: ToolMCPMapping[] = [
      {
        toolPattern: 'filesystem_*',
        serverTemplate: {
          name: 'mcp-filesystem',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
      },
    ]

    const provisioner = new MCPProvisioner(toolMappings, [])

    const result = provisioner.provision(
      undefined,
      ['filesystem_read', 'filesystem_write'],
      [],
      'test-token',
    )

    expect(result.servers.length).toBeGreaterThanOrEqual(1)
    const fsServer = result.servers.find((s) => s.name === 'mcp-filesystem')
    expect(fsServer).toBeDefined()
    expect(fsServer!.transport).toBe('stdio')
    expect(fsServer!.command).toBe('npx')
  })

  it('resolves backend MCP servers with auth', () => {
    const backendServers: BackendMCPServer[] = [
      {
        name: 'knowledge-graph',
        transport: 'http',
        url: 'http://localhost:3001/mcp/knowledge',
        requiresAuth: true,
      },
    ]

    const provisioner = new MCPProvisioner([], backendServers)

    const result = provisioner.provision(
      undefined,
      [],
      [],
      'jwt-test-token',
    )

    const kgServer = result.servers.find((s) => s.name === 'knowledge-graph')
    expect(kgServer).toBeDefined()
    expect(kgServer!.transport).toBe('http')
    expect(kgServer!.url).toBe('http://localhost:3001/mcp/knowledge')
    expect(kgServer!.headers?.['Authorization']).toContain('jwt-test-token')
  })

  it('returns empty servers when no relevant tools or mcpServers', () => {
    const provisioner = new MCPProvisioner([], [])

    const result = provisioner.provision(undefined, [], [], 'token')

    expect(result.servers).toHaveLength(0)
  })

  it('generates valid envKey and envValue', () => {
    const provisioner = new MCPProvisioner(
      [],
      [{
        name: 'test-server',
        transport: 'http',
        url: 'http://localhost:9999',
        requiresAuth: false,
      }],
    )

    const result = provisioner.provision(undefined, [], [], 'token')

    expect(result.envKey).toBe('MCP_SERVERS')
    const parsed = JSON.parse(result.envValue)
    expect(Array.isArray(parsed)).toBe(true)
  })
})

// ── P2-5: Token Service ──────────────────────────────────────────

describe('P2-5: Token Service', () => {
  it('issues JWT token scoped to agent', async () => {
    const tokenService = new TokenService({ defaultTtlMs: 60_000 })
    const { token, expiresAt } = await tokenService.issueToken('agent-token-1')

    expect(token).toBeTypeOf('string')
    expect(token.split('.').length).toBe(3) // JWT format: header.payload.signature
    expect(expiresAt).toBeTypeOf('string')
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('validates a token it issued', async () => {
    const tokenService = new TokenService({ defaultTtlMs: 60_000 })
    const { token } = await tokenService.issueToken('agent-token-2')

    const claims = await tokenService.validateToken(token)
    expect(claims).toBeDefined()
    expect(claims.agentId).toBe('agent-token-2')
  })

  it('rejects expired token', async () => {
    // Use a fixed clock that returns "now" then can be advanced.
    // JWT exp is in seconds, so TTL must be at least 1000ms to register
    // as a 1-second expiration window, and we advance past it.
    let now = Date.now()
    const tokenService = new TokenService({
      defaultTtlMs: 1000, // 1s TTL
      nowFn: () => now,
    })

    const { token } = await tokenService.issueToken('agent-expire')

    // Advance clock well past TTL (+ clockTolerance of 5s)
    now += 10_000

    await expect(tokenService.validateToken(token)).rejects.toThrow()
  })

  it('issues tokens with custom sandbox ID', async () => {
    const tokenService = new TokenService()
    const { token } = await tokenService.issueToken('agent-sandbox', 'sandbox-abc')

    const claims = await tokenService.validateToken(token)
    expect(claims.agentId).toBe('agent-sandbox')
    expect(claims.sandboxId).toBe('sandbox-abc')
  })

  it('renewal: renews a valid token', async () => {
    // Use a clock we can advance so the renewed token gets a different iat/exp
    let now = Date.now()
    const tokenService = new TokenService({
      defaultTtlMs: 60_000,
      nowFn: () => now,
    })
    const original = await tokenService.issueToken('agent-renew')

    // Advance clock by 2 seconds so the renewed JWT has a different iat
    now += 2000

    const renewed = await tokenService.renewToken(original.token, 'agent-renew')
    expect(renewed.token).toBeTypeOf('string')
    expect(renewed.token).not.toBe(original.token) // Should be a new token
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(now)
  })
})

// ── P2-6: Checkpoint-on-Decision ─────────────────────────────────

describe('P2-6: Checkpoint-on-Decision Flow', () => {
  it('decision event triggers checkpoint request and storage', async () => {
    const tickService = new TickService({ mode: 'manual' })
    const eventBus = new EventBus()
    const decisionQueue = new DecisionQueue()
    const knowledgeStore = new KnowledgeStore(':memory:')

    const checkpointCalls: Array<{ agentId: string; decisionId: string }> = []

    const mockPlugin: AgentPlugin = {
      name: 'mock',
      version: '1.0.0',
      capabilities: { supportsPause: true, supportsResume: true, supportsKill: true, supportsHotBriefUpdate: true },
      async spawn() { return {} as AgentHandle },
      async pause() { return {} as SerializedAgentState },
      async resume() { return {} as AgentHandle },
      async kill() { return { cleanShutdown: true, artifactsExtracted: 0 } },
      async resolveDecision() {},
      async injectContext() {},
      async updateBrief() {},
      async requestCheckpoint(handle: AgentHandle, decisionId: string) {
        checkpointCalls.push({ agentId: handle.id, decisionId })
        return makeCheckpointState(handle.id, decisionId)
      },
    }

    const plugins = new Map<string, AgentPlugin>()
    plugins.set('mock', mockPlugin)

    const handles = new Map<string, AgentHandle>()
    handles.set('agent-cp-1', {
      id: 'agent-cp-1',
      pluginName: 'mock',
      status: 'running',
      sessionId: 'session-cp-1',
    })

    // Wire decision events -> queue + checkpoint
    eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
      if (envelope.event.type === 'decision') {
        decisionQueue.enqueue(envelope.event, tickService.currentTick())

        const agentId = envelope.event.agentId
        const decisionId = envelope.event.decisionId
        const handle = handles.get(agentId)
        if (handle) {
          const plugin = plugins.get(handle.pluginName)
          if (plugin) {
            plugin.requestCheckpoint(handle, decisionId).then((state) => {
              knowledgeStore.storeCheckpoint(state, decisionId)
            }).catch(() => {})
          }
        }
      }
    })

    // Emit a decision event
    eventBus.publish({
      sourceEventId: 'ev-cp-1',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-cp',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'decision',
        subtype: 'tool_approval',
        agentId: 'agent-cp-1',
        decisionId: 'dec-cp-1',
        toolName: 'execute_code',
        toolArgs: { code: 'print("hello")' },
      },
    })

    await delay(100)

    // Verify checkpoint was requested
    expect(checkpointCalls.length).toBe(1)
    expect(checkpointCalls[0]!.agentId).toBe('agent-cp-1')
    expect(checkpointCalls[0]!.decisionId).toBe('dec-cp-1')

    // Verify checkpoint was stored
    const latest = knowledgeStore.getLatestCheckpoint('agent-cp-1')
    expect(latest).toBeDefined()
    expect(latest!.decisionId).toBe('dec-cp-1')
    expect(latest!.state.serializedBy).toBe('decision_checkpoint')

    knowledgeStore.close()
  })
})

// ── P2-7: ContextInjectionService ────────────────────────────────

describe('P2-7: ContextInjectionService Periodic + Reactive', () => {
  it('ContextInjectionService can be instantiated with all dependencies', () => {
    const tickService = new TickService({ mode: 'manual' })
    const eventBus = new EventBus()

    const registry: AgentRegistry = {
      getHandle() { return null },
      listHandles() { return [] },
      registerHandle() {},
      updateHandle() {},
      removeHandle() {},
    }

    const knowledgeStore = {
      async getSnapshot() { return emptySnapshot() },
      async appendEvent() {},
    }

    const gateway: AgentGateway = {
      getPlugin() { return undefined },
      async spawn() { throw new Error('not implemented') },
    }

    const controlMode: ControlModeManager = {
      getMode() { return 'orchestrator' as ControlMode },
      setMode() {},
    }

    const service = new ContextInjectionService(
      tickService,
      eventBus,
      knowledgeStore,
      registry,
      gateway,
      controlMode,
    )

    // Start and stop without error
    service.start()
    service.stop()
  })

  it('registers and removes agents for context injection tracking', () => {
    const tickService = new TickService({ mode: 'manual' })
    const eventBus = new EventBus()

    const registry: AgentRegistry = {
      getHandle() { return null },
      listHandles() { return [] },
      registerHandle() {},
      updateHandle() {},
      removeHandle() {},
    }

    const knowledgeStore = {
      async getSnapshot() { return emptySnapshot() },
      async appendEvent() {},
    }

    const gateway: AgentGateway = {
      getPlugin() { return undefined },
      async spawn() { throw new Error('not implemented') },
    }

    const controlMode: ControlModeManager = {
      getMode() { return 'orchestrator' as ControlMode },
      setMode() {},
    }

    const service = new ContextInjectionService(
      tickService,
      eventBus,
      knowledgeStore,
      registry,
      gateway,
      controlMode,
    )

    service.start()

    const brief = makeMinimalBrief('agent-ctx-1')
    service.registerAgent(brief)
    service.removeAgent('agent-ctx-1')

    service.stop()
  })
})

// ── P2-8: Cross-Provider: Two Agents from Different Plugins ──────

describe('P2-8: Cross-Provider Integration', () => {
  let shim1: MockAdapterShim
  let shim2: MockAdapterShim

  beforeEach(() => {
    portCounter = 9850 + Math.floor(Math.random() * 50)
    resetSeqCounter()
  })

  afterEach(async () => {
    await shim1?.close()
    await shim2?.close()
  })

  it('two agents on different mock shims share the same EventBus', async () => {
    const agentA = 'agent-cross-a'
    const agentB = 'agent-cross-b'

    const portA = allocPort()
    const portB = allocPort()

    // Build event sequences with explicitly unique sourceEventIds
    // (each fixture function calls resetSeqCounter(), so we use custom overrides)
    const eventsA: MockShimEvent[] = [
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentA, message: 'Started' }, { sourceEventId: 'a-evt-1', sourceSequence: 1 }) },
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentA, message: 'Working' }, { sourceEventId: 'a-evt-2', sourceSequence: 2 }) },
    ]
    const eventsB: MockShimEvent[] = [
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentB, message: 'Started' }, { sourceEventId: 'b-evt-1', sourceSequence: 1 }) },
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentB, message: 'Working' }, { sourceEventId: 'b-evt-2', sourceSequence: 2 }) },
    ]

    shim1 = createMockAdapterShim({ port: portA, events: eventsA })
    await shim1.start()

    shim2 = createMockAdapterShim({ port: portB, events: eventsB })
    await shim2.start()

    // Shared event bus
    const eventBus = new EventBus()
    const allEvents: EventEnvelope[] = []
    eventBus.subscribe({}, (env) => allEvents.push(env))

    // Connect EventStreamClients for both agents
    const streamA = new EventStreamClient({
      url: `ws://localhost:${portA}/events`,
      agentId: agentA,
      eventBus,
    })
    streamA.connect()

    const streamB = new EventStreamClient({
      url: `ws://localhost:${portB}/events`,
      agentId: agentB,
      eventBus,
    })
    streamB.connect()

    // Wait for WS connections to establish
    await delay(100)

    // Spawn both agents
    await fetch(`http://localhost:${portA}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentA }) }),
    })

    await fetch(`http://localhost:${portB}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentB }) }),
    })

    await delay(500)

    // Both agents' events should appear in the shared event bus
    const agentAEvents = allEvents.filter((e) =>
      'agentId' in e.event && (e.event as { agentId: string }).agentId === agentA,
    )
    const agentBEvents = allEvents.filter((e) =>
      'agentId' in e.event && (e.event as { agentId: string }).agentId === agentB,
    )

    expect(agentAEvents.length).toBeGreaterThan(0)
    expect(agentBEvents.length).toBeGreaterThan(0)

    streamA.close()
    streamB.close()
  })

  it('decisions from both agents appear in a shared DecisionQueue', async () => {
    const agentA = 'agent-cross-dec-a'
    const agentB = 'agent-cross-dec-b'

    const portA = allocPort()
    const portB = allocPort()

    // Build decision sequences with unique sourceEventIds per agent
    const decEventsA: MockShimEvent[] = [
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentA, message: 'Starting' }, { sourceEventId: 'dec-a-evt-1', sourceSequence: 1 }) },
      {
        delayMs: 10,
        event: makeAdapterEvent({
          type: 'decision', subtype: 'tool_approval', agentId: agentA,
          decisionId: 'dec-cross-a', toolName: 'Bash', toolArgs: {},
        }, { sourceEventId: 'dec-a-evt-2', sourceSequence: 2 }),
        blockOnDecisionId: 'dec-cross-a',
      },
    ]
    const decEventsB: MockShimEvent[] = [
      { delayMs: 10, event: makeAdapterEvent({ type: 'status', agentId: agentB, message: 'Starting' }, { sourceEventId: 'dec-b-evt-1', sourceSequence: 1 }) },
      {
        delayMs: 10,
        event: makeAdapterEvent({
          type: 'decision', subtype: 'tool_approval', agentId: agentB,
          decisionId: 'dec-cross-b', toolName: 'Write', toolArgs: {},
        }, { sourceEventId: 'dec-b-evt-2', sourceSequence: 2 }),
        blockOnDecisionId: 'dec-cross-b',
      },
    ]

    shim1 = createMockAdapterShim({ port: portA, events: decEventsA })
    await shim1.start()

    shim2 = createMockAdapterShim({ port: portB, events: decEventsB })
    await shim2.start()

    const eventBus = new EventBus()
    const decisionQueue = new DecisionQueue()
    const tickService = new TickService({ mode: 'manual' })

    eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
      if (envelope.event.type === 'decision') {
        decisionQueue.enqueue(envelope.event, tickService.currentTick())
      }
    })

    const streamA = new EventStreamClient({
      url: `ws://localhost:${portA}/events`,
      agentId: agentA,
      eventBus,
    })
    streamA.connect()

    const streamB = new EventStreamClient({
      url: `ws://localhost:${portB}/events`,
      agentId: agentB,
      eventBus,
    })
    streamB.connect()

    // Spawn both
    await fetch(`http://localhost:${portA}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentA }) }),
    })
    await fetch(`http://localhost:${portB}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentB }) }),
    })

    await delay(500)

    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(2)

    const agentIds = pending.map((d) => d.event.agentId)
    expect(agentIds).toContain(agentA)
    expect(agentIds).toContain(agentB)

    streamA.close()
    streamB.close()
  })

  it('coherence conflict across different-provider agents', async () => {
    const agentA = 'agent-cross-coh-a'
    const agentB = 'agent-cross-coh-b'

    const eventBus = new EventBus()
    const coherenceMonitor = new CoherenceMonitor()
    const knowledgeStore = new KnowledgeStore(':memory:')

    eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
      if (envelope.event.type === 'artifact') {
        knowledgeStore.storeArtifact(envelope.event)
        const issue = coherenceMonitor.processArtifact(envelope.event)
        if (issue) {
          knowledgeStore.storeCoherenceIssue(issue)
        }
      }
    })

    // Agent A produces artifact on "openai" plugin
    eventBus.publish({
      sourceEventId: 'evt-cross-art-a',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: `run-${agentA}`,
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'artifact',
        agentId: agentA,
        artifactId: 'art-cross-a',
        name: 'package.json',
        kind: 'config',
        workstream: 'ws-openai',
        status: 'draft',
        qualityScore: 0.9,
        provenance: {
          createdBy: agentA,
          createdAt: new Date().toISOString(),
          sourcePath: '/package.json',
        },
      } as ArtifactEvent,
    })

    // Agent B produces artifact on "claude" plugin with same sourcePath
    eventBus.publish({
      sourceEventId: 'evt-cross-art-b',
      sourceSequence: 2,
      sourceOccurredAt: new Date().toISOString(),
      runId: `run-${agentB}`,
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'artifact',
        agentId: agentB,
        artifactId: 'art-cross-b',
        name: 'package.json',
        kind: 'config',
        workstream: 'ws-claude',
        status: 'draft',
        qualityScore: 0.85,
        provenance: {
          createdBy: agentB,
          createdAt: new Date().toISOString(),
          sourcePath: '/package.json', // Same path!
        },
      } as ArtifactEvent,
    })

    await delay(50)

    // Coherence issue should be detected
    const issues = knowledgeStore.listCoherenceIssues()
    expect(issues.length).toBe(1)
    expect(issues[0]!.category).toBe('duplication')
    expect(issues[0]!.severity).toBe('high')

    const detected = coherenceMonitor.getDetectedIssues()
    expect(detected[0]!.affectedArtifactIds).toContain('art-cross-a')
    expect(detected[0]!.affectedArtifactIds).toContain('art-cross-b')

    knowledgeStore.close()
  })

  it('trust scores tracked independently for cross-provider agents', () => {
    const trustEngine = new TrustEngine()

    trustEngine.registerAgent('agent-openai')
    trustEngine.registerAgent('agent-claude')

    // Apply different outcomes
    trustEngine.applyOutcome('agent-openai', 'human_approves_tool_call')
    trustEngine.applyOutcome('agent-openai', 'human_approves_tool_call')
    trustEngine.applyOutcome('agent-claude', 'human_overrides_agent_decision')

    const openaiScore = trustEngine.getScore('agent-openai')!
    const claudeScore = trustEngine.getScore('agent-claude')!

    expect(openaiScore).toBe(52) // 50 + 1 + 1
    expect(claudeScore).toBe(47) // 50 - 3

    // Independent histories
    const allScores = trustEngine.getAllScores()
    expect(allScores.length).toBe(2)
    expect(allScores.find((s) => s.agentId === 'agent-openai')!.score).toBe(52)
    expect(allScores.find((s) => s.agentId === 'agent-claude')!.score).toBe(47)
  })

  it('killing one agent does not affect the other', async () => {
    const agentA = 'agent-kill-a'
    const agentB = 'agent-kill-b'
    const portA = allocPort()
    const portB = allocPort()

    resetSeqCounter()
    shim1 = createMockAdapterShim({
      port: portA,
      events: statusAndToolCallSequence(agentA),
    })
    await shim1.start()

    resetSeqCounter()
    shim2 = createMockAdapterShim({
      port: portB,
      events: statusAndToolCallSequence(agentB),
    })
    await shim2.start()

    // Spawn both
    await fetch(`http://localhost:${portA}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentA }) }),
    })
    await fetch(`http://localhost:${portB}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: agentB }) }),
    })

    // Kill agent A
    const killRes = await fetch(`http://localhost:${portA}/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(killRes.status).toBe(200)

    // Agent B should still be healthy
    const healthRes = await fetch(`http://localhost:${portB}/health`)
    expect(healthRes.status).toBe(200)
    const body = await healthRes.json() as any
    expect(body.status).toBe('healthy')
  })
})
