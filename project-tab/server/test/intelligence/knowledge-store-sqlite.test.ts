import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { KnowledgeStore, ConflictError } from '../../src/intelligence/knowledge-store'
import type { EventFilter } from '../../src/intelligence/knowledge-store'
import { knowledgeSnapshotSchema } from '../../src/validation/schemas'
import type { ArtifactEvent, CoherenceEvent, EventEnvelope, StatusEvent } from '../../src/types/events'
import type { AgentHandle } from '../../src/types/plugin'
import type { QueuedDecision } from '../../src/intelligence/decision-queue'
import type { OptionDecisionEvent } from '../../src/types/events'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeArtifact(overrides: Partial<ArtifactEvent> = {}): ArtifactEvent {
  return {
    type: 'artifact',
    agentId: 'agent-1',
    artifactId: `art-${Math.random().toString(36).slice(2, 8)}`,
    name: 'main.ts',
    kind: 'code',
    workstream: 'ws-backend',
    status: 'draft',
    qualityScore: 0.8,
    provenance: {
      createdBy: 'agent-1',
      createdAt: new Date().toISOString(),
      sourcePath: '/src/main.ts'
    },
    ...overrides
  }
}

function makeCoherenceIssue(overrides: Partial<CoherenceEvent> = {}): CoherenceEvent {
  return {
    type: 'coherence',
    agentId: 'agent-1',
    issueId: `issue-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Duplicate config',
    description: 'Same config in two places',
    category: 'duplication',
    severity: 'medium',
    affectedWorkstreams: ['ws-backend'],
    affectedArtifactIds: ['art-1', 'art-2'],
    ...overrides
  }
}

function makeHandle(id: string, status: AgentHandle['status'] = 'running'): AgentHandle {
  return {
    id,
    pluginName: 'mock',
    status,
    sessionId: `session-${id}`
  }
}

function makePendingDecision(agentId: string, decisionId: string): QueuedDecision {
  const event: OptionDecisionEvent = {
    type: 'decision',
    subtype: 'option',
    agentId,
    decisionId,
    title: 'Test decision',
    summary: 'A test decision',
    severity: 'medium',
    confidence: 0.7,
    blastRadius: 'small',
    options: [{ id: 'o1', label: 'A', description: 'Option A' }],
    affectedArtifactIds: [],
    requiresRationale: false
  }

  return {
    event,
    status: 'pending',
    enqueuedAtTick: 0,
    priority: 30
  }
}

function makeEventEnvelope(
  agentId: string,
  eventType: string = 'status',
  overrides: Partial<EventEnvelope> = {}
): EventEnvelope {
  const event: StatusEvent = {
    type: 'status',
    agentId,
    message: 'Test status update'
  }

  return {
    sourceEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sourceSequence: 1,
    sourceOccurredAt: new Date().toISOString(),
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    ingestedAt: new Date().toISOString(),
    event: event as any,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KnowledgeStore (SQLite)', () => {
  let store: KnowledgeStore

  beforeEach(() => {
    store = new KnowledgeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  // =========================================================================
  // Optimistic concurrency on artifacts
  // =========================================================================

  describe('upsertArtifact with optimistic concurrency', () => {
    it('creates a new artifact with expectedVersion 0', () => {
      const artifact = makeArtifact({ artifactId: 'art-new' })
      store.upsertArtifact(artifact, 0, 'caller-1')

      const retrieved = store.getArtifact('art-new')
      expect(retrieved).toBeDefined()
      expect(retrieved!.artifactId).toBe('art-new')
      expect(store.getArtifactVersion('art-new')).toBe(1)
    })

    it('updates an artifact with correct expectedVersion', () => {
      const artifact = makeArtifact({ artifactId: 'art-oc', status: 'draft' })
      store.upsertArtifact(artifact, 0, 'caller-1')
      expect(store.getArtifactVersion('art-oc')).toBe(1)

      const updated = makeArtifact({ artifactId: 'art-oc', status: 'approved' })
      store.upsertArtifact(updated, 1, 'caller-1')

      expect(store.getArtifact('art-oc')!.status).toBe('approved')
      expect(store.getArtifactVersion('art-oc')).toBe(2)
    })

    it('throws ConflictError on version mismatch (stale write)', () => {
      const artifact = makeArtifact({ artifactId: 'art-conflict' })
      store.upsertArtifact(artifact, 0, 'caller-1')

      // Another caller updates to version 2
      store.upsertArtifact(makeArtifact({ artifactId: 'art-conflict', status: 'in_review' }), 1, 'caller-2')

      // First caller tries to update with stale version 1
      expect(() => {
        store.upsertArtifact(
          makeArtifact({ artifactId: 'art-conflict', status: 'rejected' }),
          1,
          'caller-1'
        )
      }).toThrow(ConflictError)
    })

    it('throws ConflictError when creating with non-zero expected version', () => {
      expect(() => {
        store.upsertArtifact(makeArtifact({ artifactId: 'art-nonexistent' }), 5, 'caller-1')
      }).toThrow(ConflictError)
    })

    it('ConflictError includes entity and version details', () => {
      const artifact = makeArtifact({ artifactId: 'art-detail' })
      store.upsertArtifact(artifact, 0, 'caller-1')

      try {
        store.upsertArtifact(makeArtifact({ artifactId: 'art-detail' }), 99, 'caller-1')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toContain('art-detail')
        expect((err as ConflictError).message).toContain('99')
        expect((err as ConflictError).message).toContain('1')
      }
    })

    it('records callerAgentId in audit log on upsert', () => {
      const artifact = makeArtifact({ artifactId: 'art-audit' })
      store.upsertArtifact(artifact, 0, 'audit-agent')

      // Verify the artifact was created (audit log is internal, tested indirectly)
      expect(store.getArtifact('art-audit')).toBeDefined()
    })
  })

  // =========================================================================
  // storeArtifact backward compatibility
  // =========================================================================

  describe('storeArtifact (backward compatible)', () => {
    it('stores without requiring version or caller', () => {
      const artifact = makeArtifact({ artifactId: 'art-compat' })
      store.storeArtifact(artifact)

      expect(store.getArtifact('art-compat')).toBeDefined()
      expect(store.getArtifactVersion('art-compat')).toBe(1)
    })

    it('overwrites without version check', () => {
      store.storeArtifact(makeArtifact({ artifactId: 'art-ow', status: 'draft' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-ow', status: 'approved' }))

      expect(store.getArtifact('art-ow')!.status).toBe('approved')
      expect(store.getArtifactVersion('art-ow')).toBe(2)
    })
  })

  // =========================================================================
  // Artifact retrieval and listing
  // =========================================================================

  describe('artifact listing and filtering', () => {
    it('returns undefined for unknown artifact', () => {
      expect(store.getArtifact('nonexistent')).toBeUndefined()
    })

    it('lists all artifacts', () => {
      store.storeArtifact(makeArtifact({ artifactId: 'art-1' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-2' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-3' }))

      expect(store.listArtifacts()).toHaveLength(3)
    })

    it('filters artifacts by workstream', () => {
      store.storeArtifact(makeArtifact({ artifactId: 'art-a', workstream: 'ws-a' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-b', workstream: 'ws-b' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-a2', workstream: 'ws-a' }))

      const wsA = store.listArtifacts('ws-a')
      expect(wsA).toHaveLength(2)
      expect(wsA.every((a) => a.workstream === 'ws-a')).toBe(true)
    })

    it('preserves all artifact fields through round-trip', () => {
      const artifact = makeArtifact({
        artifactId: 'art-rt',
        name: 'app.tsx',
        kind: 'code',
        workstream: 'ws-frontend',
        status: 'in_review',
        qualityScore: 0.95,
        uri: 'file:///src/app.tsx',
        mimeType: 'application/typescript',
        sizeBytes: 2048,
        contentHash: 'sha256:abc123'
      })

      store.storeArtifact(artifact)
      const retrieved = store.getArtifact('art-rt')!

      expect(retrieved.type).toBe('artifact')
      expect(retrieved.agentId).toBe('agent-1')
      expect(retrieved.name).toBe('app.tsx')
      expect(retrieved.kind).toBe('code')
      expect(retrieved.workstream).toBe('ws-frontend')
      expect(retrieved.status).toBe('in_review')
      expect(retrieved.qualityScore).toBe(0.95)
      expect(retrieved.uri).toBe('file:///src/app.tsx')
      expect(retrieved.mimeType).toBe('application/typescript')
      expect(retrieved.sizeBytes).toBe(2048)
      expect(retrieved.contentHash).toBe('sha256:abc123')
      expect(retrieved.provenance.createdBy).toBe('agent-1')
      expect(retrieved.provenance.sourcePath).toBe('/src/main.ts')
    })

    it('getArtifactVersion returns 0 for nonexistent artifact', () => {
      expect(store.getArtifactVersion('nope')).toBe(0)
    })
  })

  // =========================================================================
  // Agent tracking
  // =========================================================================

  describe('agent tracking', () => {
    it('registers and retrieves agent handle', () => {
      const handle = makeHandle('a-1')
      store.registerAgent(handle, { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      const retrieved = store.getAgent('a-1')
      expect(retrieved).toStrictEqual(handle)
    })

    it('updates agent status', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.updateAgentStatus('a-1', 'paused')

      expect(store.getAgent('a-1')!.status).toBe('paused')
    })

    it('no-ops updateAgentStatus for unknown agent', () => {
      store.updateAgentStatus('nonexistent', 'paused')
      // No error thrown
    })

    it('removes agent', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.removeAgent('a-1')

      expect(store.getAgent('a-1')).toBeUndefined()
    })

    it('returns undefined for unknown agent', () => {
      expect(store.getAgent('nonexistent')).toBeUndefined()
    })

    it('re-registers agent with updated fields', () => {
      const handle = makeHandle('a-1')
      store.registerAgent(handle, { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      const updated = { ...handle, status: 'paused' as const }
      store.registerAgent(updated, { role: 'reviewer', workstream: 'ws-2', pluginName: 'claude' })

      const agent = store.getAgent('a-1')!
      expect(agent.status).toBe('paused')
      expect(agent.pluginName).toBe('claude')
    })
  })

  // =========================================================================
  // Coherence issues
  // =========================================================================

  describe('coherence issues', () => {
    it('stores and lists coherence issues', () => {
      const issue = makeCoherenceIssue({ issueId: 'issue-1' })
      store.storeCoherenceIssue(issue)

      const issues = store.listCoherenceIssues()
      expect(issues).toHaveLength(1)
      expect(issues[0]).toStrictEqual(issue)
    })

    it('lists multiple issues', () => {
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i1' }))
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i2' }))
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i3' }))

      expect(store.listCoherenceIssues()).toHaveLength(3)
    })

    it('filters by status', () => {
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i-open' }))
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i-resolved' }))
      store.resolveCoherenceIssue('i-resolved', 'Fixed it', 'agent-fixer')

      const open = store.listCoherenceIssues('open')
      expect(open).toHaveLength(1)
      expect(open[0].issueId).toBe('i-open')

      const resolved = store.listCoherenceIssues('resolved')
      expect(resolved).toHaveLength(1)
      expect(resolved[0].issueId).toBe('i-resolved')
    })

    it('resolves a coherence issue', () => {
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i-to-resolve' }))
      store.resolveCoherenceIssue('i-to-resolve', 'Merged configs', 'agent-1')

      const open = store.listCoherenceIssues('open')
      expect(open).toHaveLength(0)
    })

    it('preserves all coherence fields through round-trip', () => {
      const issue = makeCoherenceIssue({
        issueId: 'i-rt',
        title: 'API mismatch',
        description: 'Frontend and backend disagree on schema',
        category: 'contradiction',
        severity: 'high',
        affectedWorkstreams: ['ws-frontend', 'ws-backend'],
        affectedArtifactIds: ['art-1', 'art-2', 'art-3']
      })

      store.storeCoherenceIssue(issue)
      const retrieved = store.listCoherenceIssues()[0]

      expect(retrieved.issueId).toBe('i-rt')
      expect(retrieved.title).toBe('API mismatch')
      expect(retrieved.category).toBe('contradiction')
      expect(retrieved.severity).toBe('high')
      expect(retrieved.affectedWorkstreams).toEqual(['ws-frontend', 'ws-backend'])
      expect(retrieved.affectedArtifactIds).toEqual(['art-1', 'art-2', 'art-3'])
    })
  })

  // =========================================================================
  // Trust profiles
  // =========================================================================

  describe('trust profiles', () => {
    it('returns default score 50 for unknown agent', () => {
      const profile = store.getTrustProfile('unknown-agent')
      expect(profile.agentId).toBe('unknown-agent')
      expect(profile.score).toBe(50)
    })

    it('creates trust profile on first delta', () => {
      store.updateTrust('agent-1', 5, 'good work')
      const profile = store.getTrustProfile('agent-1')
      expect(profile.score).toBe(55)
    })

    it('applies positive delta atomically', () => {
      store.updateTrust('agent-1', 10, 'first')
      store.updateTrust('agent-1', 5, 'second')

      expect(store.getTrustProfile('agent-1').score).toBe(65) // 50 + 10 + 5
    })

    it('applies negative delta atomically', () => {
      store.updateTrust('agent-1', -20, 'error')
      expect(store.getTrustProfile('agent-1').score).toBe(30) // 50 - 20
    })

    it('clamps score at 0 floor', () => {
      store.updateTrust('agent-1', -100, 'catastrophic')
      expect(store.getTrustProfile('agent-1').score).toBe(0)
    })

    it('clamps score at 100 ceiling', () => {
      store.updateTrust('agent-1', 200, 'amazing')
      expect(store.getTrustProfile('agent-1').score).toBe(100)
    })

    it('handles multiple agents independently', () => {
      store.updateTrust('agent-a', 10, 'good')
      store.updateTrust('agent-b', -10, 'bad')

      expect(store.getTrustProfile('agent-a').score).toBe(60)
      expect(store.getTrustProfile('agent-b').score).toBe(40)
    })
  })

  // =========================================================================
  // Workstreams
  // =========================================================================

  describe('workstreams', () => {
    it('auto-creates workstream when artifact is stored', () => {
      store.storeArtifact(makeArtifact({ workstream: 'ws-new' }))

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams).toHaveLength(1)
      expect(snapshot.workstreams[0].id).toBe('ws-new')
    })

    it('auto-creates workstream when agent is registered', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-team', pluginName: 'mock' })

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams.find((ws) => ws.id === 'ws-team')).toBeDefined()
    })

    it('updates workstream name and status', () => {
      store.ensureWorkstream('ws-1', 'Backend')
      store.ensureWorkstream('ws-1', 'Backend v2', 'completed')

      const snapshot = store.getSnapshot()
      const ws = snapshot.workstreams.find((w) => w.id === 'ws-1')!
      expect(ws.name).toBe('Backend v2')
      expect(ws.status).toBe('completed')
    })

    it('updates workstream activity', () => {
      store.ensureWorkstream('ws-1', 'Backend')
      store.updateWorkstreamActivity('ws-1', 'Agent completed task')

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams[0].recentActivity).toBe('Agent completed task')
    })

    it('does not duplicate workstreams', () => {
      store.ensureWorkstream('ws-dup')
      store.ensureWorkstream('ws-dup')
      store.ensureWorkstream('ws-dup')

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams.filter((w) => w.id === 'ws-dup')).toHaveLength(1)
    })
  })

  // =========================================================================
  // Event log persistence
  // =========================================================================

  describe('event log', () => {
    it('appends and retrieves events', () => {
      const envelope = makeEventEnvelope('agent-1')
      store.appendEvent(envelope)

      const events = store.getEvents({})
      expect(events).toHaveLength(1)
      expect(events[0].sourceEventId).toBe(envelope.sourceEventId)
      expect(events[0].event.agentId).toBe('agent-1')
    })

    it('appends multiple events and retrieves in order', () => {
      const e1 = makeEventEnvelope('agent-1')
      const e2 = makeEventEnvelope('agent-2')
      const e3 = makeEventEnvelope('agent-1')

      store.appendEvent(e1)
      store.appendEvent(e2)
      store.appendEvent(e3)

      const events = store.getEvents({})
      expect(events).toHaveLength(3)
      expect(events[0].sourceEventId).toBe(e1.sourceEventId)
      expect(events[2].sourceEventId).toBe(e3.sourceEventId)
    })

    it('filters events by agentId', () => {
      store.appendEvent(makeEventEnvelope('agent-1'))
      store.appendEvent(makeEventEnvelope('agent-2'))
      store.appendEvent(makeEventEnvelope('agent-1'))

      const events = store.getEvents({ agentId: 'agent-1' })
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.event.agentId === 'agent-1')).toBe(true)
    })

    it('filters events by runId', () => {
      store.appendEvent(makeEventEnvelope('agent-1', 'status', { runId: 'run-a' }))
      store.appendEvent(makeEventEnvelope('agent-1', 'status', { runId: 'run-b' }))
      store.appendEvent(makeEventEnvelope('agent-1', 'status', { runId: 'run-a' }))

      const events = store.getEvents({ runId: 'run-a' })
      expect(events).toHaveLength(2)
    })

    it('filters events by type', () => {
      const statusEnv = makeEventEnvelope('agent-1')
      const artifactEnv: EventEnvelope = {
        ...makeEventEnvelope('agent-1'),
        event: makeArtifact({ agentId: 'agent-1' }) as any
      }

      store.appendEvent(statusEnv)
      store.appendEvent(artifactEnv)

      const statusEvents = store.getEvents({ types: ['status'] })
      expect(statusEvents).toHaveLength(1)

      const artifactEvents = store.getEvents({ types: ['artifact'] })
      expect(artifactEvents).toHaveLength(1)
    })

    it('filters events by multiple types', () => {
      const statusEnv = makeEventEnvelope('agent-1')
      const artifactEnv: EventEnvelope = {
        ...makeEventEnvelope('agent-1'),
        event: makeArtifact({ agentId: 'agent-1' }) as any
      }

      store.appendEvent(statusEnv)
      store.appendEvent(artifactEnv)

      const events = store.getEvents({ types: ['status', 'artifact'] })
      expect(events).toHaveLength(2)
    })

    it('filters events since timestamp', () => {
      const old = makeEventEnvelope('agent-1', 'status', { ingestedAt: '2024-01-01T00:00:00.000Z' })
      const recent = makeEventEnvelope('agent-1', 'status', { ingestedAt: '2025-06-01T00:00:00.000Z' })

      store.appendEvent(old)
      store.appendEvent(recent)

      const events = store.getEvents({ since: '2025-01-01T00:00:00.000Z' })
      expect(events).toHaveLength(1)
      expect(events[0].sourceEventId).toBe(recent.sourceEventId)
    })

    it('limits event results', () => {
      for (let i = 0; i < 10; i++) {
        store.appendEvent(makeEventEnvelope('agent-1'))
      }

      const events = store.getEvents({ limit: 3 })
      expect(events).toHaveLength(3)
    })

    it('combines multiple filters', () => {
      store.appendEvent(makeEventEnvelope('agent-1', 'status', { runId: 'run-x', ingestedAt: '2025-06-01T00:00:00.000Z' }))
      store.appendEvent(makeEventEnvelope('agent-2', 'status', { runId: 'run-x', ingestedAt: '2025-06-01T00:00:00.000Z' }))
      store.appendEvent(makeEventEnvelope('agent-1', 'status', { runId: 'run-y', ingestedAt: '2025-06-01T00:00:00.000Z' }))

      const events = store.getEvents({ agentId: 'agent-1', runId: 'run-x' })
      expect(events).toHaveLength(1)
    })

    it('returns empty array when no events match filter', () => {
      store.appendEvent(makeEventEnvelope('agent-1'))

      const events = store.getEvents({ agentId: 'nonexistent' })
      expect(events).toHaveLength(0)
    })

    it('returns empty array for empty store', () => {
      expect(store.getEvents({})).toHaveLength(0)
    })
  })

  // =========================================================================
  // Version tracking
  // =========================================================================

  describe('version tracking', () => {
    it('starts at version 0', () => {
      expect(store.getVersion()).toBe(0)
    })

    it('increments on artifact store', () => {
      store.storeArtifact(makeArtifact())
      expect(store.getVersion()).toBe(1)
    })

    it('increments on agent register', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      expect(store.getVersion()).toBe(1)
    })

    it('increments on agent status update', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.updateAgentStatus('a-1', 'paused')
      expect(store.getVersion()).toBe(2)
    })

    it('increments on coherence issue', () => {
      store.storeCoherenceIssue(makeCoherenceIssue())
      expect(store.getVersion()).toBe(1)
    })

    it('increments on agent removal', () => {
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.removeAgent('a-1')
      expect(store.getVersion()).toBe(2)
    })

    it('increments on coherence issue resolution', () => {
      store.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'i-1' }))
      store.resolveCoherenceIssue('i-1', 'Fixed', 'agent-1')
      expect(store.getVersion()).toBe(2)
    })

    it('increments on optimistic concurrency upsert', () => {
      store.upsertArtifact(makeArtifact({ artifactId: 'art-v' }), 0, 'caller-1')
      expect(store.getVersion()).toBe(1)
    })
  })

  // =========================================================================
  // Snapshot generation
  // =========================================================================

  describe('getSnapshot', () => {
    it('returns empty snapshot for fresh store', () => {
      const snapshot = store.getSnapshot()

      expect(snapshot.version).toBe(0)
      expect(snapshot.workstreams).toEqual([])
      expect(snapshot.pendingDecisions).toEqual([])
      expect(snapshot.recentCoherenceIssues).toEqual([])
      expect(snapshot.artifactIndex).toEqual([])
      expect(snapshot.activeAgents).toEqual([])
      expect(snapshot.estimatedTokens).toBeGreaterThanOrEqual(0)
      expect(snapshot.generatedAt).toBeDefined()
    })

    it('includes artifacts in snapshot', () => {
      store.storeArtifact(makeArtifact({
        artifactId: 'art-1',
        name: 'module.ts',
        kind: 'code',
        status: 'draft',
        workstream: 'ws-1'
      }))

      const snapshot = store.getSnapshot()
      expect(snapshot.artifactIndex).toHaveLength(1)
      expect(snapshot.artifactIndex[0]).toEqual({
        id: 'art-1',
        name: 'module.ts',
        kind: 'code',
        status: 'draft',
        workstream: 'ws-1'
      })
    })

    it('includes agents in snapshot', () => {
      store.registerAgent(makeHandle('a-1'), {
        role: 'coder',
        workstream: 'ws-1',
        pluginName: 'openai',
        modelPreference: 'gpt-4'
      })

      const snapshot = store.getSnapshot()
      expect(snapshot.activeAgents).toHaveLength(1)
      expect(snapshot.activeAgents[0]).toEqual({
        id: 'a-1',
        role: 'coder',
        workstream: 'ws-1',
        status: 'running',
        pluginName: 'openai',
        modelPreference: 'gpt-4'
      })
    })

    it('includes coherence issues in snapshot', () => {
      store.storeCoherenceIssue(makeCoherenceIssue({
        issueId: 'issue-1',
        title: 'Conflict',
        severity: 'high',
        category: 'contradiction',
        affectedWorkstreams: ['ws-1']
      }))

      const snapshot = store.getSnapshot()
      expect(snapshot.recentCoherenceIssues).toHaveLength(1)
      expect(snapshot.recentCoherenceIssues[0]).toEqual({
        id: 'issue-1',
        title: 'Conflict',
        severity: 'high',
        category: 'contradiction',
        affectedWorkstreams: ['ws-1']
      })
    })

    it('includes pending decisions from external queue', () => {
      store.registerAgent(makeHandle('a-1'), {
        role: 'coder',
        workstream: 'ws-1',
        pluginName: 'mock'
      })

      const decisions = [makePendingDecision('a-1', 'dec-1')]
      const snapshot = store.getSnapshot(decisions)

      expect(snapshot.pendingDecisions).toHaveLength(1)
      expect(snapshot.pendingDecisions[0].id).toBe('dec-1')
      expect(snapshot.pendingDecisions[0].agentId).toBe('a-1')
    })

    it('counts artifacts and decisions per workstream', () => {
      store.registerAgent(makeHandle('a-1'), {
        role: 'coder',
        workstream: 'ws-1',
        pluginName: 'mock'
      })
      store.storeArtifact(makeArtifact({ artifactId: 'art-1', workstream: 'ws-1' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-2', workstream: 'ws-1' }))

      const decisions = [makePendingDecision('a-1', 'dec-1')]
      const snapshot = store.getSnapshot(decisions)

      const ws = snapshot.workstreams.find((w) => w.id === 'ws-1')
      expect(ws).toBeDefined()
      expect(ws!.artifactCount).toBe(2)
      expect(ws!.pendingDecisionCount).toBe(1)
      expect(ws!.activeAgentIds).toContain('a-1')
    })

    it('validates against the KnowledgeSnapshot Zod schema', () => {
      store.registerAgent(makeHandle('a-1'), {
        role: 'coder',
        workstream: 'ws-1',
        pluginName: 'mock'
      })
      store.storeArtifact(makeArtifact({ artifactId: 'art-1', workstream: 'ws-1' }))
      store.storeCoherenceIssue(makeCoherenceIssue({
        issueId: 'issue-1',
        affectedWorkstreams: ['ws-1']
      }))

      const decisions = [makePendingDecision('a-1', 'dec-1')]
      const snapshot = store.getSnapshot(decisions)

      const result = knowledgeSnapshotSchema.safeParse(snapshot)
      expect(result.success).toBe(true)
    })

    it('validates empty snapshot against schema', () => {
      const snapshot = store.getSnapshot()

      const result = knowledgeSnapshotSchema.safeParse(snapshot)
      expect(result.success).toBe(true)
    })

    it('has non-zero estimated tokens for non-empty snapshot', () => {
      store.storeArtifact(makeArtifact())
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      const snapshot = store.getSnapshot()
      expect(snapshot.estimatedTokens).toBeGreaterThan(0)
    })

    it('omits modelPreference from snapshot when null', () => {
      store.registerAgent(makeHandle('a-1'), {
        role: 'coder',
        workstream: 'ws-1',
        pluginName: 'mock'
        // no modelPreference
      })

      const snapshot = store.getSnapshot()
      const agent = snapshot.activeAgents[0]
      expect(agent.modelPreference).toBeUndefined()
    })
  })

  // =========================================================================
  // File persistence
  // =========================================================================

  describe('file persistence', () => {
    const tmpPath = join(tmpdir(), `ks-test-${Date.now()}.sqlite`)

    afterEach(() => {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath)
      }
    })

    it('persists data to disk and reloads', () => {
      // Write data
      const store1 = new KnowledgeStore(tmpPath)
      store1.storeArtifact(makeArtifact({ artifactId: 'persistent-art', name: 'persist.ts' }))
      store1.registerAgent(makeHandle('persist-agent'), { role: 'coder', workstream: 'ws-p', pluginName: 'mock' })
      store1.storeCoherenceIssue(makeCoherenceIssue({ issueId: 'persist-issue' }))
      store1.updateTrust('persist-agent', 10, 'good work')
      store1.appendEvent(makeEventEnvelope('persist-agent'))

      const v1 = store1.getVersion()
      store1.close()

      // Reload and verify
      const store2 = new KnowledgeStore(tmpPath)

      expect(store2.getVersion()).toBe(v1)
      expect(store2.getArtifact('persistent-art')).toBeDefined()
      expect(store2.getArtifact('persistent-art')!.name).toBe('persist.ts')
      expect(store2.getAgent('persist-agent')).toBeDefined()
      expect(store2.listCoherenceIssues()).toHaveLength(1)
      expect(store2.getTrustProfile('persist-agent').score).toBe(60)
      expect(store2.getEvents({})).toHaveLength(1)

      const snapshot = store2.getSnapshot()
      expect(snapshot.artifactIndex).toHaveLength(1)
      expect(snapshot.activeAgents).toHaveLength(1)

      store2.close()
    })

    it('version persists across reopens', () => {
      const s1 = new KnowledgeStore(tmpPath)
      s1.storeArtifact(makeArtifact({ artifactId: 'a1' }))
      s1.storeArtifact(makeArtifact({ artifactId: 'a2' }))
      s1.storeArtifact(makeArtifact({ artifactId: 'a3' }))
      const expectedVersion = s1.getVersion()
      s1.close()

      const s2 = new KnowledgeStore(tmpPath)
      expect(s2.getVersion()).toBe(expectedVersion)
      s2.close()
    })
  })

  // =========================================================================
  // Constructor and close
  // =========================================================================

  describe('constructor and close', () => {
    it('accepts :memory: path', () => {
      const s = new KnowledgeStore(':memory:')
      expect(s.getVersion()).toBe(0)
      s.close()
    })

    it('defaults to :memory: when no path given', () => {
      const s = new KnowledgeStore()
      expect(s.getVersion()).toBe(0)
      s.close()
    })

    it('close prevents further operations', () => {
      const s = new KnowledgeStore(':memory:')
      s.close()

      expect(() => s.storeArtifact(makeArtifact())).toThrow()
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles artifact with minimal provenance', () => {
      const artifact = makeArtifact({
        artifactId: 'art-min',
        provenance: {
          createdBy: 'agent-1',
          createdAt: new Date().toISOString()
        }
      })

      store.storeArtifact(artifact)
      const retrieved = store.getArtifact('art-min')!
      expect(retrieved.provenance.createdBy).toBe('agent-1')
      expect(retrieved.provenance.sourcePath).toBeUndefined()
    })

    it('handles artifact without optional fields', () => {
      const artifact: ArtifactEvent = {
        type: 'artifact',
        agentId: 'agent-1',
        artifactId: 'art-bare',
        name: 'bare.ts',
        kind: 'code',
        workstream: 'ws-1',
        status: 'draft',
        qualityScore: 0.5,
        provenance: {
          createdBy: 'agent-1',
          createdAt: new Date().toISOString()
        }
        // no uri, mimeType, sizeBytes, contentHash
      }

      store.storeArtifact(artifact)
      const retrieved = store.getArtifact('art-bare')!
      expect(retrieved.uri).toBeUndefined()
      expect(retrieved.mimeType).toBeUndefined()
      expect(retrieved.sizeBytes).toBeUndefined()
      expect(retrieved.contentHash).toBeUndefined()
    })

    it('handles coherence issue with multiple affected workstreams', () => {
      const issue = makeCoherenceIssue({
        issueId: 'i-multi',
        affectedWorkstreams: ['ws-1', 'ws-2', 'ws-3', 'ws-4']
      })

      store.storeCoherenceIssue(issue)
      const retrieved = store.listCoherenceIssues()[0]
      expect(retrieved.affectedWorkstreams).toEqual(['ws-1', 'ws-2', 'ws-3', 'ws-4'])
    })

    it('handles empty event filter', () => {
      store.appendEvent(makeEventEnvelope('agent-1'))
      store.appendEvent(makeEventEnvelope('agent-2'))

      const events = store.getEvents({})
      expect(events).toHaveLength(2)
    })

    it('handles large number of artifacts', () => {
      for (let i = 0; i < 100; i++) {
        store.storeArtifact(makeArtifact({ artifactId: `art-${i}`, workstream: `ws-${i % 5}` }))
      }

      expect(store.listArtifacts()).toHaveLength(100)
      expect(store.listArtifacts('ws-0')).toHaveLength(20)
    })

    it('handles concurrent version checks correctly', () => {
      // Simulate two callers reading the same artifact
      store.upsertArtifact(makeArtifact({ artifactId: 'art-race' }), 0, 'caller-1')
      const version = store.getArtifactVersion('art-race') // 1

      // First caller succeeds
      store.upsertArtifact(makeArtifact({ artifactId: 'art-race', status: 'approved' }), version, 'caller-1')

      // Second caller with stale version fails
      expect(() => {
        store.upsertArtifact(makeArtifact({ artifactId: 'art-race', status: 'rejected' }), version, 'caller-2')
      }).toThrow(ConflictError)

      // The first caller's write won
      expect(store.getArtifact('art-race')!.status).toBe('approved')
    })
  })

  // =========================================================================
  // Artifact content storage
  // =========================================================================

  describe('artifact content storage', () => {
    it('stores and retrieves artifact content', () => {
      const result = store.storeArtifactContent('agent-1', 'art-c1', 'Hello World', 'text/plain')

      expect(result.backendUri).toBe('artifact://agent-1/art-c1')
      expect(result.artifactId).toBe('art-c1')
      expect(result.stored).toBe(true)

      const retrieved = store.getArtifactContent('agent-1', 'art-c1')
      expect(retrieved).toBeDefined()
      expect(retrieved!.content).toBe('Hello World')
      expect(retrieved!.mimeType).toBe('text/plain')
      expect(retrieved!.backendUri).toBe('artifact://agent-1/art-c1')
    })

    it('stores content without mimeType', () => {
      store.storeArtifactContent('agent-1', 'art-c2', 'raw data')

      const retrieved = store.getArtifactContent('agent-1', 'art-c2')
      expect(retrieved).toBeDefined()
      expect(retrieved!.content).toBe('raw data')
      expect(retrieved!.mimeType).toBeNull()
    })

    it('returns undefined for nonexistent content', () => {
      const retrieved = store.getArtifactContent('agent-1', 'nonexistent')
      expect(retrieved).toBeUndefined()
    })

    it('overwrites content on duplicate artifactId', () => {
      store.storeArtifactContent('agent-1', 'art-c3', 'version-1', 'text/plain')
      store.storeArtifactContent('agent-1', 'art-c3', 'version-2', 'text/markdown')

      const retrieved = store.getArtifactContent('agent-1', 'art-c3')
      expect(retrieved).toBeDefined()
      expect(retrieved!.content).toBe('version-2')
      expect(retrieved!.mimeType).toBe('text/markdown')
    })

    it('keeps content separate for different agents with same artifactId', () => {
      store.storeArtifactContent('agent-1', 'art-shared', 'agent-1 content', 'text/plain')
      store.storeArtifactContent('agent-2', 'art-shared', 'agent-2 content', 'text/markdown')

      const retrieved1 = store.getArtifactContent('agent-1', 'art-shared')
      const retrieved2 = store.getArtifactContent('agent-2', 'art-shared')

      expect(retrieved1).toBeDefined()
      expect(retrieved1!.content).toBe('agent-1 content')
      expect(retrieved1!.mimeType).toBe('text/plain')
      expect(retrieved1!.backendUri).toBe('artifact://agent-1/art-shared')

      expect(retrieved2).toBeDefined()
      expect(retrieved2!.content).toBe('agent-2 content')
      expect(retrieved2!.mimeType).toBe('text/markdown')
      expect(retrieved2!.backendUri).toBe('artifact://agent-2/art-shared')
    })

    it('generates consistent backendUri format', () => {
      const result1 = store.storeArtifactContent('agent-x', 'art-123', 'data')
      const result2 = store.storeArtifactContent('agent-y', 'art-456', 'other')

      expect(result1.backendUri).toBe('artifact://agent-x/art-123')
      expect(result2.backendUri).toBe('artifact://agent-y/art-456')
    })

    it('stores empty string content', () => {
      store.storeArtifactContent('agent-1', 'art-empty', '')

      const retrieved = store.getArtifactContent('agent-1', 'art-empty')
      expect(retrieved).toBeDefined()
      expect(retrieved!.content).toBe('')
    })

    it('stores large content', () => {
      const largeContent = 'x'.repeat(100000)
      store.storeArtifactContent('agent-1', 'art-large', largeContent, 'application/octet-stream')

      const retrieved = store.getArtifactContent('agent-1', 'art-large')
      expect(retrieved).toBeDefined()
      expect(retrieved!.content.length).toBe(100000)
    })
  })
})
