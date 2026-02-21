/**
 * Phase 1 Closeout Integration Tests
 *
 * Validates the Phase 1 acceptance criteria from AGENT-PLUGIN-DESIGN.md (lines 3166-3183).
 * These tests verify end-to-end behavior through the full pipeline, covering gaps
 * identified in the closeout plan.
 *
 * Criteria covered:
 *  1. Adapter shim starts as child process on allocated port (AC1)
 *  2. Health check polling + ready handshake (AC2)
 *  3. Event streaming: StatusEvent, ToolCallEvent flow to frontend WS (AC3)
 *  4. DecisionEvent renders in queue, resolve via POST, adapter resumes (AC4)
 *  5. ArtifactEvent triggers upload flow (AC5)
 *  6. Emergency brake stops agent (AC6)
 *  7. Crash detection on child process exit / WS drop (AC7)
 *  8. Event validation quarantines malformed events (AC8)
 *  9. StateSyncMessage includes active agents (AC9)
 * 10. Trust engine updates visible via TrustUpdateMessage (AC10)
 * 11. Layer 0 coherence detects file conflicts from artifact events (AC11)
 * 12. providerConfig passthrough (AC12)
 * 13. Orphaned decision policy with grace period (AC13)
 * 14. Event bus backpressure (AC14)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createServer, type Server } from 'node:http'

import { EventBus } from '../../src/bus'
import { EventClassifier } from '../../src/classifier'
import { TickService } from '../../src/tick'
import { WebSocketHub, type StateSnapshotProvider } from '../../src/ws-hub'
import { attachWebSocketUpgrade, createApp } from '../../src/app'
import { EventStreamClient } from '../../src/gateway/event-stream-client'
import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import { TokenService } from '../../src/gateway/token-service'
import { AgentRegistry as AgentRegistryImpl } from '../../src/registry/agent-registry'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor'
import { MockEmbeddingService } from '../../src/intelligence/embedding-service'
import { MockCoherenceReviewService } from '../../src/intelligence/coherence-review-service'
import { clearQuarantine, getQuarantined } from '../../src/validation/quarantine'

import type {
  AdapterEvent,
  AgentHandle,
  AgentPlugin,
  ArtifactEvent,
  DecisionEvent,
  EventEnvelope,
  FrontendMessage,
  KnowledgeSnapshot,
  StateSyncMessage,
  TrustUpdateMessage,
  WorkspaceEventMessage,
  SerializedAgentState,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import type {
  AgentRegistry,
  AgentGateway,
  CheckpointStore,
  ControlModeManager,
} from '../../src/routes'

import { listenEphemeral } from '../helpers/listen-ephemeral'
import { createMockAdapterShim, type MockAdapterShim } from './mock-adapter-shim'
import {
  makeAgentBrief,
  makeAdapterEvent,
  emptySnapshot,
  resetSeqCounter,
  shimEvent,
  statusAndToolCallSequence,
  decisionBlockSequence,
  artifactSequence,
  artifactConflictSequence,
  crashSequence,
  malformedEventSequence,
  backpressureSequence,
  brakeAndOrphanSequence,
  trustUpdateSequence,
} from './fixtures'

// ── Helpers ────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Connect a WS client and collect messages. */
async function connectWsClient(wsUrl: string) {
  const messages: FrontendMessage[] = []

  return new Promise<{
    ws: WebSocket
    messages: FrontendMessage[]
    syncMsg: StateSyncMessage
    waitFor: (predicate: (m: FrontendMessage) => boolean, timeoutMs?: number) => Promise<FrontendMessage>
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
          waitFor(predicate, timeoutMs = 5000) {
            const found = messages.find(predicate)
            if (found) return Promise.resolve(found)

            return new Promise((res, rej) => {
              const timeout = setTimeout(() => rej(new Error('waitFor timed out')), timeoutMs)
              const handler = (raw: unknown) => {
                const m = JSON.parse((raw as Buffer).toString()) as FrontendMessage
                if (predicate(m)) {
                  clearTimeout(timeout)
                  ws.off('message', handler)
                  res(m)
                }
              }
              ws.on('message', handler)
            })
          },
          close() {
            ws.close()
          },
        })
      }
    })

    ws.on('error', reject)
    setTimeout(() => reject(new Error('WS connect timed out')), 5000)
  })
}

function makeArtifactEnvelope(artifact: ArtifactEvent, seqNum: number): EventEnvelope {
  return {
    sourceEventId: `evt-art-${seqNum}`,
    sourceSequence: seqNum,
    sourceOccurredAt: new Date().toISOString(),
    runId: `run-${artifact.agentId}`,
    ingestedAt: new Date().toISOString(),
    event: artifact,
  }
}

/** Boot a backend server with intelligence modules wired. */
async function bootFullBackend(options: {
  tickMode?: 'manual' | 'wall_clock'
} = {}) {
  const tickService = new TickService({ mode: options.tickMode ?? 'manual' })
  const eventBus = new EventBus()
  const classifier = new EventClassifier()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()
  const knowledgeStore = new KnowledgeStore(':memory:')
  const coherenceMonitor = new CoherenceMonitor()

  coherenceMonitor.setEmbeddingService(new MockEmbeddingService())
  coherenceMonitor.setReviewService(new MockCoherenceReviewService())
  coherenceMonitor.setArtifactContentProvider(() => undefined)

  const wsHub = new WebSocketHub(() => ({
    snapshot: knowledgeStore.getSnapshot(decisionQueue.listPending().map((q) => q.event)),
    activeAgents: [],
    trustScores: trustEngine.getAllScores(),
    controlMode: 'orchestrator' as const,
  }))

  const server = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })

  attachWebSocketUpgrade(server, wsHub)

  // Wire event bus -> classifier -> ws hub
  eventBus.subscribe({}, (envelope) => {
    const classified = classifier.classify(envelope)
    wsHub.publishClassifiedEvent(classified)
  })

  // Wire artifact events -> knowledge store + coherence
  eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
    if (envelope.event.type === 'artifact') {
      knowledgeStore.storeArtifact(envelope.event)
      const issue = coherenceMonitor.processArtifact(envelope.event)
      if (issue) {
        knowledgeStore.storeCoherenceIssue(issue)
        const coherenceEnvelope: EventEnvelope = {
          sourceEventId: `coherence-${issue.issueId}`,
          sourceSequence: -1,
          sourceOccurredAt: new Date().toISOString(),
          runId: envelope.runId,
          ingestedAt: new Date().toISOString(),
          event: issue,
        }
        const classified2 = classifier.classify(coherenceEnvelope)
        wsHub.publishClassifiedEvent(classified2)
      }
    }
  })

  // Wire decision events -> queue
  eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
    if (envelope.event.type === 'decision') {
      decisionQueue.enqueue(envelope.event, tickService.currentTick())
    }
  })

  // Wire trust on completion
  eventBus.subscribe({ eventType: 'completion' }, (envelope) => {
    if (envelope.event.type === 'completion') {
      const agentId = envelope.event.agentId
      const outcome = envelope.event.outcome
      let trustOutcome: import('../../src/intelligence/trust-engine').TrustOutcome | null = null
      if (outcome === 'success') trustOutcome = 'task_completed_clean'
      else if (outcome === 'partial') trustOutcome = 'task_completed_partial'
      if (trustOutcome) {
        const prev = trustEngine.getScore(agentId) ?? 50
        trustEngine.applyOutcome(agentId, trustOutcome, tickService.currentTick())
        const next = trustEngine.getScore(agentId) ?? 50
        if (prev !== next) {
          wsHub.broadcast({
            type: 'trust_update',
            agentId,
            previousScore: prev,
            newScore: next,
            delta: next - prev,
            reason: trustOutcome,
          })
        }
      }
    }
  })

  // Wire error -> trust
  eventBus.subscribe({ eventType: 'error' }, (envelope) => {
    if (envelope.event.type === 'error' && envelope.event.severity !== 'warning') {
      const agentId = envelope.event.agentId
      const prev = trustEngine.getScore(agentId) ?? 50
      trustEngine.applyOutcome(agentId, 'error_event', tickService.currentTick())
      const next = trustEngine.getScore(agentId) ?? 50
      if (prev !== next) {
        wsHub.broadcast({
          type: 'trust_update',
          agentId,
          previousScore: prev,
          newScore: next,
          delta: next - prev,
          reason: 'error_event',
        })
      }
    }
  })

  tickService.start()

  const port = await listenEphemeral(server)

  return {
    server,
    eventBus,
    classifier,
    tickService,
    trustEngine,
    decisionQueue,
    knowledgeStore,
    coherenceMonitor,
    wsHub,
    port,
    wsUrl: `ws://localhost:${port}/ws`,
    async close() {
      tickService.stop()
      wsHub.close()
      try { knowledgeStore.close() } catch { /* ok */ }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

// ── Phase 1 Closeout Tests ──────────────────────────────────────

describe('Phase 1 Closeout: Crash Detection (Gap 3)', () => {
  let backend: Awaited<ReturnType<typeof bootFullBackend>>
  let shim: MockAdapterShim

  beforeEach(() => {
    resetSeqCounter()
    clearQuarantine()
  })

  afterEach(async () => {
    try { await shim?.close() } catch { /* may already be crashed */ }
    await backend?.close()
  })

  it('crash detection: WS disconnect triggers onDisconnect callback', async () => {
    const agentId = 'agent-crash-ws'

    shim = createMockAdapterShim({
      events: crashSequence(agentId),
      crashAfterEvents: 2,
    })
    await shim.start()
    const shimPort = shim.getPort()

    backend = await bootFullBackend()

    let disconnectCalled = false
    const streamClient = new EventStreamClient({
      url: `ws://localhost:${shimPort}/events`,
      agentId,
      eventBus: backend.eventBus,
      onDisconnect() { disconnectCalled = true },
      maxReconnectDelayMs: 100,
      initialReconnectDelayMs: 50,
    })
    streamClient.connect()

    // Spawn to trigger events + crash
    await fetch(`http://localhost:${shimPort}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId }) }),
    })

    await delay(500)
    expect(disconnectCalled).toBe(true)
    streamClient.close()
  })

  it('crash detection: synthetic ErrorEvent + LifecycleEvent are emitted to EventBus', async () => {
    const agentId = 'agent-crash-events'
    backend = await bootFullBackend()
    backend.trustEngine.registerAgent(agentId)

    const errorEvents: EventEnvelope[] = []
    const lifecycleEvents: EventEnvelope[] = []

    backend.eventBus.subscribe({ eventType: 'error' }, (env) => {
      if (env.event.type === 'error' && env.event.agentId === agentId) {
        errorEvents.push(env)
      }
    })

    backend.eventBus.subscribe({ eventType: 'lifecycle' }, (env) => {
      if (env.event.type === 'lifecycle' && env.event.agentId === agentId) {
        lifecycleEvents.push(env)
      }
    })

    // Simulate crash by publishing synthetic events (as LocalProcessPlugin does)
    const now = new Date().toISOString()
    const runId = `crash-${agentId}-test`

    backend.eventBus.publish({
      sourceEventId: `crash-error-${agentId}`,
      sourceSequence: -1,
      sourceOccurredAt: now,
      runId,
      ingestedAt: now,
      event: {
        type: 'error',
        agentId,
        severity: 'critical',
        message: `Agent process exited unexpectedly (code=1, signal=null)`,
        recoverable: false,
        category: 'internal',
      },
    })

    backend.eventBus.publish({
      sourceEventId: `crash-lifecycle-${agentId}`,
      sourceSequence: -1,
      sourceOccurredAt: now,
      runId,
      ingestedAt: now,
      event: {
        type: 'lifecycle',
        agentId,
        action: 'crashed',
        reason: 'Process exit code=1 signal=null',
      },
    })

    await delay(50)

    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0]!.event.type).toBe('error')
    if (errorEvents[0]!.event.type === 'error') {
      expect(errorEvents[0]!.event.severity).toBe('critical')
      expect(errorEvents[0]!.event.recoverable).toBe(false)
      expect(errorEvents[0]!.event.category).toBe('internal')
    }

    expect(lifecycleEvents.length).toBe(1)
    expect(lifecycleEvents[0]!.event.type).toBe('lifecycle')
    if (lifecycleEvents[0]!.event.type === 'lifecycle') {
      expect(lifecycleEvents[0]!.event.action).toBe('crashed')
    }
  })

  it('crash detection: ErrorEvent triggers trust penalty via bus subscription', async () => {
    const agentId = 'agent-crash-trust'
    backend = await bootFullBackend()
    backend.trustEngine.registerAgent(agentId)

    const initialScore = backend.trustEngine.getScore(agentId)!

    // Emit a crash error event
    backend.eventBus.publish({
      sourceEventId: `crash-error-${agentId}`,
      sourceSequence: -1,
      sourceOccurredAt: new Date().toISOString(),
      runId: `crash-${agentId}`,
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'error',
        agentId,
        severity: 'critical',
        message: 'Agent crashed',
        recoverable: false,
        category: 'internal',
      },
    })

    await delay(50)

    const newScore = backend.trustEngine.getScore(agentId)!
    expect(newScore).toBeLessThan(initialScore)
  })

  it('crash events flow through to frontend WS as WorkspaceEventMessage', async () => {
    const agentId = 'agent-crash-ws-flow'
    backend = await bootFullBackend()
    backend.trustEngine.registerAgent(agentId)

    const client = await connectWsClient(backend.wsUrl)

    // Emit crash events
    backend.eventBus.publish({
      sourceEventId: `crash-error-${agentId}`,
      sourceSequence: -1,
      sourceOccurredAt: new Date().toISOString(),
      runId: `crash-${agentId}`,
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'error',
        agentId,
        severity: 'critical',
        message: 'Agent process crashed',
        recoverable: false,
        category: 'internal',
      },
    })

    await delay(200)

    const errorMsgs = client.messages.filter(
      (m): m is WorkspaceEventMessage =>
        m.type === 'event' && m.envelope.event.type === 'error',
    )
    expect(errorMsgs.length).toBe(1)

    // Trust update should also arrive
    const trustMsgs = client.messages.filter(
      (m): m is TrustUpdateMessage => m.type === 'trust_update',
    )
    expect(trustMsgs.length).toBe(1)
    expect(trustMsgs[0]!.delta).toBeLessThan(0)

    client.close()
  })
})

describe('Phase 1 Closeout: Artifact Upload Flow (Gap 2)', () => {
  beforeEach(() => {
    resetSeqCounter()
  })

  it('POST /api/artifacts stores content and returns artifact:// URI', async () => {
    const knowledgeStore = new KnowledgeStore(':memory:')

    const deps = createMinimalDeps(knowledgeStore)
    const app = createApp(deps)
    const server = createServer(app as any)

    const port = await listenEphemeral(server)

    try {
      // Register the artifact first
      knowledgeStore.storeArtifact({
        type: 'artifact',
        agentId: 'agent-upload',
        artifactId: 'art-upload-1',
        name: 'script.js',
        kind: 'code',
        workstream: 'ws-test',
        status: 'draft',
        qualityScore: 0.8,
        provenance: {
          createdBy: 'agent-upload',
          createdAt: new Date().toISOString(),
        },
      })

      const res = await fetch(`http://localhost:${port}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-upload',
          artifactId: 'art-upload-1',
          content: 'console.log("hello")',
          mimeType: 'text/javascript',
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.backendUri).toBe('artifact://agent-upload/art-upload-1')
      expect(body.stored).toBe(true)

      // Verify content is retrievable
      const contentRes = await fetch(`http://localhost:${port}/api/artifacts/art-upload-1/content`)
      expect(contentRes.status).toBe(200)
      const content = await contentRes.text()
      expect(content).toBe('console.log("hello")')
    } finally {
      knowledgeStore.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('ArtifactEvent in EventBus triggers KnowledgeStore storage', async () => {
    const backend = await bootFullBackend()

    const artifact: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-art-bus',
      artifactId: 'art-bus-1',
      name: 'module.ts',
      kind: 'code',
      workstream: 'core',
      status: 'draft',
      qualityScore: 0.92,
      provenance: {
        createdBy: 'agent-art-bus',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/module.ts',
      },
      uri: 'artifact://agent-art-bus/art-bus-1',
    }

    backend.eventBus.publish(makeArtifactEnvelope(artifact, 1))
    await delay(50)

    const stored = backend.knowledgeStore.getArtifact('art-bus-1')
    expect(stored).toBeDefined()
    expect(stored!.name).toBe('module.ts')
    expect(stored!.provenance.sourcePath).toBe('/src/module.ts')

    await backend.close()
  })
})

describe('Phase 1 Closeout: Quarantine REST API (Gap 1)', () => {
  beforeEach(() => {
    clearQuarantine()
  })

  it('GET /api/quarantine returns quarantined events after malformed event ingestion', async () => {
    const knowledgeStore = new KnowledgeStore(':memory:')
    const deps = createMinimalDeps(knowledgeStore)
    const app = createApp(deps)
    const server = createServer(app as any)

    const port = await listenEphemeral(server)

    const shim = createMockAdapterShim({
      events: malformedEventSequence('agent-quarantine'),
    })
    await shim.start()
    const shimPort = shim.getPort()

    // Connect EventStreamClient (which quarantines malformed events)
    const eventBus = new EventBus()
    const streamClient = new EventStreamClient({
      url: `ws://localhost:${shimPort}/events`,
      agentId: 'agent-quarantine',
      eventBus,
    })
    streamClient.connect()

    // Trigger events
    await fetch(`http://localhost:${shimPort}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: makeAgentBrief({ agentId: 'agent-quarantine' }) }),
    })

    await delay(200)

    // Query quarantine via REST
    const res = await fetch(`http://localhost:${port}/api/quarantine`)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.events.length).toBeGreaterThanOrEqual(1)

    // Clear quarantine
    const clearRes = await fetch(`http://localhost:${port}/api/quarantine`, { method: 'DELETE' })
    expect(clearRes.status).toBe(200)
    const clearBody = await clearRes.json() as any
    expect(clearBody.cleared).toBe(true)

    // Verify cleared
    const emptyRes = await fetch(`http://localhost:${port}/api/quarantine`)
    const emptyBody = await emptyRes.json() as any
    expect(emptyBody.events).toHaveLength(0)

    streamClient.close()
    await shim.close()
    knowledgeStore.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

describe('Phase 1 Closeout: providerConfig Passthrough (Gap 5)', () => {
  let shim: MockAdapterShim

  beforeEach(() => {
    resetSeqCounter()
  })

  afterEach(async () => {
    await shim?.close()
  })

  it('adapter shim receives opaque providerConfig from AgentBrief via POST /spawn', async () => {
    shim = createMockAdapterShim({
      events: [],
    })
    await shim.start()
    const shimPort = shim.getPort()

    const brief = makeAgentBrief({
      agentId: 'agent-provider-cfg',
      providerConfig: {
        temperature: 0.7,
        maxTokens: 4096,
        experimental: { featureFlag: true },
      },
    })

    const res = await fetch(`http://localhost:${shimPort}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    })
    expect(res.status).toBe(200)

    // The mock shim stores the brief it received
    const state = shim.getState()
    expect(state.brief).toBeDefined()
    expect(state.brief!.providerConfig).toEqual({
      temperature: 0.7,
      maxTokens: 4096,
      experimental: { featureFlag: true },
    })
  })

  it('providerConfig survives full brief -> spawn -> shim roundtrip', async () => {
    shim = createMockAdapterShim({
      events: statusAndToolCallSequence('agent-cfg-rt'),
    })
    await shim.start()
    const shimPort = shim.getPort()

    const providerConfig = {
      model: 'gpt-4.5-turbo',
      temperature: 0.3,
      maxTokens: 8192,
      stop: ['\n\n'],
      nested: { deep: { value: 42 } },
    }

    const brief = makeAgentBrief({
      agentId: 'agent-cfg-rt',
      providerConfig,
    })

    await fetch(`http://localhost:${shimPort}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    })

    const state = shim.getState()
    expect(state.brief!.providerConfig).toEqual(providerConfig)
  })
})

describe('Phase 1 Closeout: Orphaned Decision Grace Period (Gap 6)', () => {
  beforeEach(() => {
    resetSeqCounter()
  })

  it('scheduleOrphanTriage sets grace period badge and deadline', () => {
    const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
    const agentId = 'agent-orphan-grace'

    const event: DecisionEvent = {
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId: 'dec-grace-1',
      toolName: 'Deploy',
      toolArgs: { target: 'staging' },
      severity: 'high',
      blastRadius: 'large',
    }
    queue.enqueue(event, 5)

    const scheduled = queue.scheduleOrphanTriage(agentId, 10)
    expect(scheduled.length).toBe(1)
    expect(scheduled[0]!.badge).toBe('grace period')
    expect(scheduled[0]!.graceDeadlineTick).toBe(20) // 10 + 10
    expect(scheduled[0]!.status).toBe('pending') // Still resolvable
  })

  it('decision remains resolvable during grace period', () => {
    const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
    const agentId = 'agent-orphan-resolve'

    queue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId: 'dec-grace-resolve',
      toolName: 'Read',
      toolArgs: {},
    }, 0)

    queue.scheduleOrphanTriage(agentId, 5)

    // Should still be resolvable
    const resolved = queue.resolve('dec-grace-resolve', {
      type: 'tool_approval',
      action: 'approve',
      actionKind: 'review',
    })
    expect(resolved).toBeDefined()
    expect(resolved!.status).toBe('resolved')
  })

  it('grace period expiry moves decision to triage on tick', () => {
    const tickService = new TickService({ mode: 'manual' })
    const queue = new DecisionQueue({ orphanGracePeriodTicks: 5 })
    queue.subscribeTo(tickService)

    const agentId = 'agent-orphan-expire'
    queue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId: 'dec-grace-expire',
      toolName: 'Write',
      toolArgs: {},
    }, 0)

    queue.scheduleOrphanTriage(agentId, 0)

    // Before deadline
    tickService.advance()
    tickService.advance()
    tickService.advance()
    let entry = queue.get('dec-grace-expire')
    expect(entry!.status).toBe('pending')

    // At/past deadline (tick 5)
    tickService.advance()
    tickService.advance()
    entry = queue.get('dec-grace-expire')
    expect(entry!.status).toBe('triage')
    expect(entry!.badge).toBe('agent killed')

    tickService.stop()
  })

  it('immediate handleAgentKilled still works for emergency brake', () => {
    const queue = new DecisionQueue()
    const agentId = 'agent-brake-immediate'

    queue.enqueue({
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId: 'dec-brake-1',
      toolName: 'Bash',
      toolArgs: {},
      severity: 'critical',
      blastRadius: 'large',
    }, 0)

    const orphaned = queue.handleAgentKilled(agentId)
    expect(orphaned.length).toBe(1)
    expect(orphaned[0]!.status).toBe('triage')
    expect(orphaned[0]!.badge).toBe('agent killed')
    expect(orphaned[0]!.priority).toBeGreaterThan(0)
  })

  it('integration: grace period in full pipeline with tick service', () => {
    const tickService = new TickService({ mode: 'manual' })
    const eventBus = new EventBus()
    const queue = new DecisionQueue({ orphanGracePeriodTicks: 3 })
    queue.subscribeTo(tickService)

    // Wire decision events to queue
    eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
      if (envelope.event.type === 'decision') {
        queue.enqueue(envelope.event, tickService.currentTick())
      }
    })

    tickService.start()

    // Emit a decision event
    eventBus.publish({
      sourceEventId: 'evt-grace-pipeline',
      sourceSequence: 1,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-grace',
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'decision',
        subtype: 'tool_approval',
        agentId: 'agent-grace-pipeline',
        decisionId: 'dec-grace-pipeline',
        toolName: 'Deploy',
        toolArgs: {},
      },
    })

    expect(queue.listPending().length).toBe(1)

    // Simulate agent kill with grace period
    queue.scheduleOrphanTriage('agent-grace-pipeline', tickService.currentTick())
    expect(queue.get('dec-grace-pipeline')!.badge).toBe('grace period')

    // Advance past grace period
    tickService.advance()
    tickService.advance()
    tickService.advance()

    expect(queue.get('dec-grace-pipeline')!.status).toBe('triage')
    expect(queue.get('dec-grace-pipeline')!.badge).toBe('agent killed')

    tickService.stop()
  })
})

describe('Phase 1 Closeout: Layer 0 Coherence via ArtifactEvent (Gap 4)', () => {
  let backend: Awaited<ReturnType<typeof bootFullBackend>>

  beforeEach(() => {
    resetSeqCounter()
  })

  afterEach(async () => {
    await backend?.close()
  })

  it('two agents with same sourcePath trigger CoherenceEvent on WS', async () => {
    backend = await bootFullBackend()
    const client = await connectWsClient(backend.wsUrl)

    const artifact1: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-coh-a',
      artifactId: 'art-coh-a',
      name: 'shared.ts',
      kind: 'code',
      workstream: 'ws-a',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: 'agent-coh-a',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/shared.ts',
      },
    }

    const artifact2: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-coh-b',
      artifactId: 'art-coh-b',
      name: 'shared.ts',
      kind: 'code',
      workstream: 'ws-b',
      status: 'draft',
      qualityScore: 0.85,
      provenance: {
        createdBy: 'agent-coh-b',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/shared.ts', // Same path
      },
    }

    backend.eventBus.publish(makeArtifactEnvelope(artifact1, 1))
    backend.eventBus.publish(makeArtifactEnvelope(artifact2, 2))

    await delay(200)

    // Verify coherence issue in KnowledgeStore
    const issues = backend.knowledgeStore.listCoherenceIssues()
    expect(issues.length).toBe(1)
    expect(issues[0]!.category).toBe('duplication')
    expect(issues[0]!.severity).toBe('high')

    // Verify CoherenceEvent arrived on WS
    const coherenceMsgs = client.messages.filter(
      (m): m is WorkspaceEventMessage =>
        m.type === 'event' && m.envelope.event.type === 'coherence',
    )
    expect(coherenceMsgs.length).toBe(1)
    expect(coherenceMsgs[0]!.workspace).toBe('map')

    client.close()
  })
})

describe('Phase 1 Closeout: Event Bus Backpressure (existing AC16)', () => {
  it('EventBus deduplicates repeated events within window', () => {
    const bus = new EventBus(5)
    const seen: string[] = []
    bus.subscribe({}, (env) => seen.push(env.sourceEventId))

    for (let i = 0; i < 10; i++) {
      bus.publish({
        sourceEventId: `evt-dedup-${i}`,
        sourceSequence: i,
        sourceOccurredAt: new Date().toISOString(),
        runId: 'run-dedup',
        ingestedAt: new Date().toISOString(),
        event: { type: 'status', agentId: 'agent-bp', message: `msg-${i}` },
      })
    }

    expect(seen.length).toBe(10)

    // Recent event is deduplicated
    const deduped = bus.publish({
      sourceEventId: 'evt-dedup-9',
      sourceSequence: 10,
      sourceOccurredAt: new Date().toISOString(),
      runId: 'run-dedup',
      ingestedAt: new Date().toISOString(),
      event: { type: 'status', agentId: 'agent-bp', message: 'duplicate' },
    })
    expect(deduped).toBe(false)
    expect(bus.getMetrics().totalDeduplicated).toBeGreaterThan(0)
  })
})

// ── Helper: create minimal deps for Express app ──────────────────

function createMinimalDeps(knowledgeStore: KnowledgeStore) {
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

  const checkpointStore: CheckpointStore = {
    storeCheckpoint() {},
    getCheckpoints() { return [] },
    getLatestCheckpoint() { return undefined },
    getCheckpointCount() { return 0 },
    deleteCheckpoints() { return 0 },
  }

  const gateway: AgentGateway = {
    getPlugin() { return undefined },
    async spawn() { throw new Error('Not implemented in test') },
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
    knowledgeStore: {
      async getSnapshot() { return knowledgeStore.getSnapshot() },
      async appendEvent() {},
      updateAgentStatus() {},
      storeArtifactContent(agentId: string, artifactId: string, content: string, mimeType?: string) {
        return knowledgeStore.storeArtifactContent(agentId, artifactId, content, mimeType)
      },
    },
    checkpointStore,
    gateway,
    controlMode,
    knowledgeStoreImpl: knowledgeStore,
  } satisfies import('../../src/routes').ApiRouteDeps
}
