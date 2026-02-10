import { describe, expect, it, vi, beforeEach } from 'vitest'

import { TickService } from '../../src/tick'
import { EventBus } from '../../src/bus'
import { ContextInjectionService } from '../../src/intelligence/context-injection-service'
import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ContextInjection,
  EventEnvelope,
  KnowledgeSnapshot,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import type { AgentRegistry, AgentGateway, KnowledgeStore, ControlModeManager } from '../../src/routes'

// ── Test helpers ──────────────────────────────────────────────────

function makeSnapshot(version = 1, estimatedTokens = 100): KnowledgeSnapshot {
  return {
    version,
    generatedAt: new Date().toISOString(),
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens,
  }
}

function makeHandle(id: string, pluginName = 'test-plugin', status: AgentHandle['status'] = 'running'): AgentHandle {
  return { id, pluginName, status, sessionId: `session-${id}` }
}

function makeBrief(overrides: Partial<AgentBrief> = {}): AgentBrief {
  return {
    agentId: 'agent-1',
    role: 'developer',
    description: 'A test agent',
    workstream: 'ws-frontend',
    readableWorkstreams: ['ws-backend'],
    constraints: [],
    escalationProtocol: { alwaysEscalate: [], escalateWhen: [], neverEscalate: [] },
    controlMode: 'adaptive',
    projectBrief: { title: 'Test', description: 'Test project', goals: [], checkpoints: [] },
    knowledgeSnapshot: makeSnapshot(),
    allowedTools: [],
    ...overrides,
  }
}

function makeEnvelope(event: EventEnvelope['event'], runId = 'run-1'): EventEnvelope {
  return {
    sourceEventId: `evt-${Math.random().toString(16).slice(2)}`,
    sourceSequence: 1,
    sourceOccurredAt: new Date().toISOString(),
    runId,
    ingestedAt: new Date().toISOString(),
    event,
  }
}

function createMockPlugin(): AgentPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    capabilities: { supportsPause: true, supportsResume: true, supportsKill: true, supportsHotBriefUpdate: true },
    spawn: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    resolveDecision: vi.fn(),
    injectContext: vi.fn().mockResolvedValue(undefined),
    updateBrief: vi.fn(),
    requestCheckpoint: vi.fn(),
  }
}

// ── Test fixtures setup ───────────────────────────────────────────

interface TestFixture {
  tickService: TickService
  eventBus: EventBus
  knowledgeStore: KnowledgeStore
  registry: AgentRegistry
  gateway: AgentGateway
  controlMode: ControlModeManager
  service: ContextInjectionService
  plugin: AgentPlugin
}

function createFixture(mode: ControlMode = 'adaptive'): TestFixture {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()

  let snapshotVersion = 1
  const knowledgeStore: KnowledgeStore = {
    getSnapshot: vi.fn().mockImplementation(async () => makeSnapshot(snapshotVersion++)),
    appendEvent: vi.fn().mockResolvedValue(undefined),
  }

  const handles = new Map<string, AgentHandle>()
  const registry: AgentRegistry = {
    getHandle: (id) => handles.get(id) ?? null,
    listHandles: () => [...handles.values()],
    registerHandle: (h) => handles.set(h.id, h),
    updateHandle: (id, updates) => {
      const h = handles.get(id)
      if (h) handles.set(id, { ...h, ...updates })
    },
    removeHandle: (id) => handles.delete(id),
  }

  const plugin = createMockPlugin()
  const plugins = new Map<string, AgentPlugin>([['test-plugin', plugin]])

  const gateway: AgentGateway = {
    getPlugin: (name) => plugins.get(name),
    spawn: vi.fn(),
  }

  let currentMode: ControlMode = mode
  const controlMode: ControlModeManager = {
    getMode: () => currentMode,
    setMode: (m) => { currentMode = m },
  }

  const service = new ContextInjectionService(
    tickService,
    eventBus,
    knowledgeStore,
    registry,
    gateway,
    controlMode,
  )

  return { tickService, eventBus, knowledgeStore, registry, gateway, controlMode, service, plugin }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ContextInjectionService', () => {
  describe('initialization and lifecycle', () => {
    it('starts and stops cleanly', () => {
      const { service } = createFixture()
      service.start()
      service.stop()
      // No errors thrown
    })

    it('registers and removes agents', () => {
      const { service } = createFixture()
      const brief = makeBrief()
      service.registerAgent(brief)
      expect(service.getAgentState('agent-1')).toBeDefined()
      service.removeAgent('agent-1')
      expect(service.getAgentState('agent-1')).toBeUndefined()
    })

    it('updates agent brief', () => {
      const { service } = createFixture()
      const brief = makeBrief()
      service.registerAgent(brief)
      service.updateAgentBrief('agent-1', { role: 'designer' })
      expect(service.getAgentState('agent-1')!.brief.role).toBe('designer')
    })

    it('updateAgentBrief is a no-op for unknown agent', () => {
      const { service } = createFixture()
      service.updateAgentBrief('unknown', { role: 'x' })
      // No error thrown
    })
  })

  describe('default policies per control mode', () => {
    it('returns orchestrator defaults (aggressive)', () => {
      const policy = ContextInjectionService.getDefaultPolicy('orchestrator')
      expect(policy.periodicIntervalTicks).toBe(10)
      expect(policy.stalenessThreshold).toBe(5)
      expect(policy.reactiveEvents).toHaveLength(3)
    })

    it('returns adaptive defaults (balanced)', () => {
      const policy = ContextInjectionService.getDefaultPolicy('adaptive')
      expect(policy.periodicIntervalTicks).toBe(20)
      expect(policy.stalenessThreshold).toBe(10)
      expect(policy.reactiveEvents).toHaveLength(2)
    })

    it('returns ecosystem defaults (conservative)', () => {
      const policy = ContextInjectionService.getDefaultPolicy('ecosystem')
      expect(policy.periodicIntervalTicks).toBe(50)
      expect(policy.stalenessThreshold).toBe(20)
      expect(policy.reactiveEvents).toHaveLength(1)
    })
  })

  describe('effective policy resolution', () => {
    it('uses per-agent policy when present on brief', () => {
      const { service } = createFixture()
      const customPolicy = {
        periodicIntervalTicks: 99,
        reactiveEvents: [],
        stalenessThreshold: 42,
        maxInjectionsPerHour: 6,
        cooldownTicks: 3,
      }
      service.registerAgent(makeBrief({ contextInjectionPolicy: customPolicy }))
      const policy = service.getEffectivePolicy('agent-1')
      expect(policy.periodicIntervalTicks).toBe(99)
      expect(policy.stalenessThreshold).toBe(42)
    })

    it('falls back to control mode default when no per-agent policy', () => {
      const { service } = createFixture('orchestrator')
      service.registerAgent(makeBrief())
      const policy = service.getEffectivePolicy('agent-1')
      expect(policy.periodicIntervalTicks).toBe(10) // orchestrator default
    })

    it('returns control mode default for unknown agent', () => {
      const { service } = createFixture('ecosystem')
      const policy = service.getEffectivePolicy('unknown-agent')
      expect(policy.periodicIntervalTicks).toBe(50) // ecosystem default
    })
  })

  describe('periodic injection', () => {
    it('triggers injection after periodicIntervalTicks', async () => {
      const { service, tickService, registry, plugin } = createFixture('adaptive')
      service.start()

      const brief = makeBrief()
      const handle = makeHandle('agent-1')
      registry.registerHandle(handle)
      service.registerAgent(brief)

      // Advance 20 ticks (adaptive default periodicIntervalTicks = 20)
      for (let i = 0; i < 20; i++) {
        tickService.advance(1)
      }

      // Give async injection time to complete
      await vi.waitFor(() => {
        expect(plugin.injectContext).toHaveBeenCalled()
      })

      service.stop()
    })

    it('does not trigger before interval elapses', async () => {
      const { service, tickService, registry, plugin } = createFixture('adaptive')
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief())

      // Advance only 10 ticks (less than adaptive default of 20)
      for (let i = 0; i < 10; i++) {
        tickService.advance(1)
      }

      // Wait a bit to ensure no async injection fires
      await new Promise((r) => setTimeout(r, 20))
      expect(plugin.injectContext).not.toHaveBeenCalled()

      service.stop()
    })

    it('does not trigger when periodicIntervalTicks is null', async () => {
      const { service, tickService, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        contextInjectionPolicy: {
          periodicIntervalTicks: null,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 5,
        },
      }))

      for (let i = 0; i < 100; i++) {
        tickService.advance(1)
      }

      await new Promise((r) => setTimeout(r, 20))
      expect(plugin.injectContext).not.toHaveBeenCalled()

      service.stop()
    })
  })

  describe('staleness threshold', () => {
    it('triggers injection when staleness exceeds threshold', async () => {
      const { service, tickService, eventBus, registry, plugin } = createFixture('adaptive')
      service.start()

      // Register two agents in different workstreams that can read each other
      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        // Set high periodic to avoid periodic triggers
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: 3,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0, // no cooldown for this test
        },
      }))

      registry.registerHandle(makeHandle('agent-2'))
      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: ['ws-frontend'],
      }))

      // Emit events from agent-2 in ws-backend (readable by agent-1)
      for (let i = 0; i < 3; i++) {
        eventBus.publish(makeEnvelope({
          type: 'status',
          agentId: 'agent-2',
          message: `status update ${i}`,
        }))
      }

      // Need a tick to trigger staleness check
      tickService.advance(1)

      await vi.waitFor(() => {
        expect(plugin.injectContext).toHaveBeenCalled()
      })

      // Verify staleness counter was reset
      const state = service.getAgentState('agent-1')
      expect(state!.stalenessCounter).toBe(0)

      service.stop()
    })

    it('does not bump staleness for events in non-readable workstreams', () => {
      const { service, eventBus } = createFixture()
      service.start()

      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: [], // cannot read anything else
      }))
      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      // Event from agent-2 in ws-backend — not readable by agent-1
      eventBus.publish(makeEnvelope({
        type: 'status',
        agentId: 'agent-2',
        message: 'hello',
      }))

      expect(service.getAgentState('agent-1')!.stalenessCounter).toBe(0)

      service.stop()
    })

    it('does not bump staleness for agent own events', () => {
      const { service, eventBus } = createFixture()
      service.start()

      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-frontend'],
      }))

      // Event from agent-1 itself
      eventBus.publish(makeEnvelope({
        type: 'status',
        agentId: 'agent-1',
        message: 'my own event',
      }))

      expect(service.getAgentState('agent-1')!.stalenessCounter).toBe(0)

      service.stop()
    })
  })

  describe('reactive injection', () => {
    it('triggers on artifact_approved in readable workstream', async () => {
      const { service, eventBus, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [{ on: 'artifact_approved', workstreams: 'readable' }],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      registry.registerHandle(makeHandle('agent-2'))
      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      // Artifact approved from agent-2 in ws-backend
      eventBus.publish(makeEnvelope({
        type: 'artifact',
        agentId: 'agent-2',
        artifactId: 'art-1',
        name: 'schema.sql',
        kind: 'code',
        workstream: 'ws-backend',
        status: 'approved',
        qualityScore: 90,
        provenance: { createdBy: 'agent-2', createdAt: new Date().toISOString() },
      }))

      await vi.waitFor(() => {
        expect(plugin.injectContext).toHaveBeenCalled()
      })

      service.stop()
    })

    it('does not trigger on artifact_approved when scope is own and event is from other workstream', async () => {
      const { service, eventBus, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [{ on: 'artifact_approved', workstreams: 'own' }],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      eventBus.publish(makeEnvelope({
        type: 'artifact',
        agentId: 'agent-2',
        artifactId: 'art-1',
        name: 'schema.sql',
        kind: 'code',
        workstream: 'ws-backend', // not agent-1's own workstream
        status: 'approved',
        qualityScore: 90,
        provenance: { createdBy: 'agent-2', createdAt: new Date().toISOString() },
      }))

      await new Promise((r) => setTimeout(r, 20))
      expect(plugin.injectContext).not.toHaveBeenCalled()

      service.stop()
    })

    it('triggers on coherence_issue matching severity threshold', async () => {
      const { service, eventBus, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [{ on: 'coherence_issue', severity: 'high' }],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      // Emit critical coherence issue (>= high)
      eventBus.publish(makeEnvelope({
        type: 'coherence',
        agentId: 'agent-2',
        issueId: 'coh-1',
        title: 'Schema conflict',
        description: 'Two agents define conflicting schemas',
        category: 'contradiction',
        severity: 'critical',
        affectedWorkstreams: ['ws-backend'],
        affectedArtifactIds: [],
      }))

      await vi.waitFor(() => {
        expect(plugin.injectContext).toHaveBeenCalled()
      })

      service.stop()
    })

    it('does not trigger on coherence_issue below severity threshold', async () => {
      const { service, eventBus, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [{ on: 'coherence_issue', severity: 'high' }],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      // Emit medium severity (< high)
      eventBus.publish(makeEnvelope({
        type: 'coherence',
        agentId: 'agent-2',
        issueId: 'coh-1',
        title: 'Minor issue',
        description: 'Minor',
        category: 'duplication',
        severity: 'medium',
        affectedWorkstreams: ['ws-backend'],
        affectedArtifactIds: [],
      }))

      await new Promise((r) => setTimeout(r, 20))
      expect(plugin.injectContext).not.toHaveBeenCalled()

      service.stop()
    })

    it('triggers on agent_completed in readable workstream', async () => {
      const { service, eventBus, registry, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [{ on: 'agent_completed', workstreams: 'readable' }],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      eventBus.publish(makeEnvelope({
        type: 'completion',
        agentId: 'agent-2',
        summary: 'Done',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'success',
      }))

      await vi.waitFor(() => {
        expect(plugin.injectContext).toHaveBeenCalled()
      })

      service.stop()
    })
  })

  describe('cooldown enforcement', () => {
    it('blocks injection during cooldown period', async () => {
      const { service, tickService, registry, plugin, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 10,
        },
      }))

      // First injection should succeed
      const result1 = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result1).toBe(true)

      // Advance only 5 ticks (less than cooldown of 10)
      for (let i = 0; i < 5; i++) tickService.advance(1)

      // Reset mock to get a new version
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(100))

      // Second injection should be blocked by cooldown
      const result2 = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result2).toBe(false)

      service.stop()
    })

    it('allows required priority to bypass cooldown', async () => {
      const { service, registry, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 100, // very long cooldown
        },
      }))

      // First injection
      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(200))

      // Required priority should bypass cooldown
      const result = await service.scheduleInjection('agent-1', 'brief_updated', 'required')
      expect(result).toBe(true)

      service.stop()
    })
  })

  describe('rate limiting', () => {
    it('blocks injection when maxInjectionsPerHour exceeded', async () => {
      const { service, tickService, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 3,
          cooldownTicks: 0, // no cooldown
        },
      }))

      let version = 10
      // Fill up the rate limit
      for (let i = 0; i < 3; i++) {
        ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(version++))
        const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
        expect(result).toBe(true)
      }

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(version++))

      // 4th injection should be blocked
      const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result).toBe(false)

      service.stop()
    })
  })

  describe('snapshot version deduplication', () => {
    it('skips injection when snapshot version matches last injected version', async () => {
      const { service, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      // First injection with version 5
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(5))
      const result1 = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result1).toBe(true)

      // Second injection with same version 5
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(5))
      const result2 = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result2).toBe(false)

      expect(plugin.injectContext).toHaveBeenCalledTimes(1)

      service.stop()
    })

    it('allows injection when snapshot version changes', async () => {
      const { service, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(5))
      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(6))
      const result2 = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result2).toBe(true)

      expect(plugin.injectContext).toHaveBeenCalledTimes(2)

      service.stop()
    })
  })

  describe('budget enforcement', () => {
    it('blocks supplementary injection when exceeding token budget', async () => {
      const { service, registry, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        sessionPolicy: {
          contextBudgetTokens: 50,
          historyPolicy: 'full',
        },
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      // Snapshot has 100 estimated tokens, budget is 50
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(1, 100))
      const result = await service.scheduleInjection('agent-1', 'periodic', 'supplementary')
      expect(result).toBe(false)

      service.stop()
    })

    it('allows recommended injection even when exceeding budget', async () => {
      const { service, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        sessionPolicy: {
          contextBudgetTokens: 50,
          historyPolicy: 'full',
        },
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(1, 100))
      const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result).toBe(true)

      service.stop()
    })
  })

  describe('injection delivery', () => {
    it('calls plugin.injectContext with correct payload', async () => {
      const { service, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      const handle = makeHandle('agent-1')
      registry.registerHandle(handle)
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      const snapshot = makeSnapshot(42, 200)
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(snapshot)

      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      expect(plugin.injectContext).toHaveBeenCalledWith(handle, {
        content: JSON.stringify(snapshot),
        format: 'json',
        snapshotVersion: 42,
        estimatedTokens: 200,
        priority: 'recommended',
      })

      service.stop()
    })

    it('uses delta content for reactive injections', async () => {
      const { service, registry, knowledgeStore, plugin } = createFixture()
      service.start()

      const handle = makeHandle('agent-1')
      registry.registerHandle(handle)
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      const snapshot = makeSnapshot(10)
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(snapshot)

      await service.scheduleInjection('agent-1', 'reactive', 'recommended')

      const call = (plugin.injectContext as any).mock.calls[0]
      const injection: ContextInjection = call[1]
      const content = JSON.parse(injection.content)
      expect(content.isDelta).toBe(true)

      service.stop()
    })

    it('returns false when agent is not running', async () => {
      const { service, registry } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1', 'test-plugin', 'paused'))
      service.registerAgent(makeBrief())

      const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result).toBe(false)

      service.stop()
    })

    it('returns false when agent is not registered', async () => {
      const { service } = createFixture()
      service.start()

      const result = await service.scheduleInjection('unknown', 'periodic', 'recommended')
      expect(result).toBe(false)

      service.stop()
    })

    it('returns false when plugin is not found', async () => {
      const { service, registry, gateway } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1', 'nonexistent-plugin'))
      service.registerAgent(makeBrief())

      const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result).toBe(false)

      service.stop()
    })

    it('returns false when plugin.injectContext throws', async () => {
      const { service, registry, plugin, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      ;(plugin.injectContext as any).mockRejectedValueOnce(new Error('connection failed'))
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(99))

      const result = await service.scheduleInjection('agent-1', 'periodic', 'recommended')
      expect(result).toBe(false)

      service.stop()
    })
  })

  describe('onBriefUpdated', () => {
    it('triggers a required injection on brief update', async () => {
      const { service, registry, plugin, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(50))

      const result = await service.onBriefUpdated('agent-1')
      expect(result).toBe(true)

      const call = (plugin.injectContext as any).mock.calls[0]
      expect(call[1].priority).toBe('required')

      service.stop()
    })
  })

  describe('state tracking', () => {
    it('resets staleness counter after successful injection', async () => {
      const { service, registry, knowledgeStore, eventBus } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        workstream: 'ws-frontend',
        readableWorkstreams: ['ws-backend'],
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      service.registerAgent(makeBrief({
        agentId: 'agent-2',
        workstream: 'ws-backend',
        readableWorkstreams: [],
      }))

      // Bump staleness
      eventBus.publish(makeEnvelope({
        type: 'status',
        agentId: 'agent-2',
        message: 'hello',
      }))
      expect(service.getAgentState('agent-1')!.stalenessCounter).toBe(1)

      // Inject
      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(30))
      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      expect(service.getAgentState('agent-1')!.stalenessCounter).toBe(0)

      service.stop()
    })

    it('updates lastInjectionTick after successful injection', async () => {
      const { service, tickService, registry, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      tickService.advance(15)

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(1))
      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      expect(service.getAgentState('agent-1')!.lastInjectionTick).toBe(15)

      service.stop()
    })

    it('updates lastSnapshotVersion after successful injection', async () => {
      const { service, registry, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 999,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      ;(knowledgeStore.getSnapshot as any).mockResolvedValueOnce(makeSnapshot(77))
      await service.scheduleInjection('agent-1', 'periodic', 'recommended')

      expect(service.getAgentState('agent-1')!.lastSnapshotVersion).toBe(77)

      service.stop()
    })
  })

  describe('edge cases', () => {
    it('handles multiple agents simultaneously', async () => {
      const { service, tickService, registry, plugin, knowledgeStore } = createFixture('orchestrator')
      service.start()

      for (let i = 1; i <= 3; i++) {
        registry.registerHandle(makeHandle(`agent-${i}`))
        service.registerAgent(makeBrief({
          agentId: `agent-${i}`,
          workstream: `ws-${i}`,
          readableWorkstreams: [],
          contextInjectionPolicy: {
            periodicIntervalTicks: 5,
            reactiveEvents: [],
            stalenessThreshold: null,
            maxInjectionsPerHour: 12,
            cooldownTicks: 0,
          },
        }))
      }

      // Each getSnapshot call needs a unique version
      let v = 100
      ;(knowledgeStore.getSnapshot as any).mockImplementation(async () => makeSnapshot(v++))

      // Advance past the periodic interval
      for (let i = 0; i < 5; i++) tickService.advance(1)

      await vi.waitFor(() => {
        expect((plugin.injectContext as any).mock.calls.length).toBeGreaterThanOrEqual(3)
      })

      service.stop()
    })

    it('does not crash on empty agent list', () => {
      const { service, tickService } = createFixture()
      service.start()
      tickService.advance(100)
      service.stop()
      // No error
    })

    it('handles agent removed during tick processing', async () => {
      const { service, tickService, registry, knowledgeStore } = createFixture()
      service.start()

      registry.registerHandle(makeHandle('agent-1'))
      service.registerAgent(makeBrief({
        agentId: 'agent-1',
        contextInjectionPolicy: {
          periodicIntervalTicks: 5,
          reactiveEvents: [],
          stalenessThreshold: null,
          maxInjectionsPerHour: 12,
          cooldownTicks: 0,
        },
      }))

      // Remove agent after registration
      service.removeAgent('agent-1')

      for (let i = 0; i < 10; i++) tickService.advance(1)

      await new Promise((r) => setTimeout(r, 20))
      // No errors thrown

      service.stop()
    })
  })
})
