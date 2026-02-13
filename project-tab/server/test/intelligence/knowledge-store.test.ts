import { describe, expect, it } from 'vitest'

import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { knowledgeSnapshotSchema } from '../../src/validation/schemas'
import type { ArtifactEvent, CoherenceEvent } from '../../src/types/events'
import type { AgentHandle } from '../../src/types/plugin'
import type { OptionDecisionEvent } from '../../src/types/events'

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

function makePendingDecision(
  agentId: string,
  decisionId: string
): OptionDecisionEvent {
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

  return event
}

describe('KnowledgeStore', () => {
  describe('artifact storage', () => {
    it('stores and retrieves an artifact', () => {
      const store = new KnowledgeStore()
      const artifact = makeArtifact({ artifactId: 'art-1' })

      store.storeArtifact(artifact)
      expect(store.getArtifact('art-1')).toStrictEqual(artifact)
    })

    it('updates existing artifact', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact({ artifactId: 'art-1', status: 'draft' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-1', status: 'approved' }))

      expect(store.getArtifact('art-1')!.status).toBe('approved')
    })

    it('returns undefined for unknown artifact', () => {
      const store = new KnowledgeStore()
      expect(store.getArtifact('nonexistent')).toBeUndefined()
    })

    it('lists all artifacts', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact({ artifactId: 'art-1' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-2' }))

      expect(store.listArtifacts()).toHaveLength(2)
    })

    it('filters artifacts by workstream', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact({ artifactId: 'art-1', workstream: 'ws-a' }))
      store.storeArtifact(makeArtifact({ artifactId: 'art-2', workstream: 'ws-b' }))

      expect(store.listArtifacts('ws-a')).toHaveLength(1)
      expect(store.listArtifacts('ws-a')[0].artifactId).toBe('art-1')
    })
  })

  describe('agent tracking', () => {
    it('registers and retrieves an agent', () => {
      const store = new KnowledgeStore()
      const handle = makeHandle('a-1')
      store.registerAgent(handle, { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      expect(store.getAgent('a-1')).toStrictEqual(handle)
    })

    it('updates agent status', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      store.updateAgentStatus('a-1', 'paused')
      expect(store.getAgent('a-1')!.status).toBe('paused')
    })

    it('removes an agent', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      store.removeAgent('a-1')
      expect(store.getAgent('a-1')).toBeUndefined()
    })
  })

  describe('coherence issues', () => {
    it('stores and lists coherence issues', () => {
      const store = new KnowledgeStore()
      const issue = makeCoherenceIssue({ issueId: 'issue-1' })

      store.storeCoherenceIssue(issue)
      const issues = store.listCoherenceIssues()

      expect(issues).toHaveLength(1)
      expect(issues[0]).toStrictEqual(issue)
    })
  })

  describe('workstreams', () => {
    it('auto-creates workstream when artifact is stored', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact({ workstream: 'ws-new' }))

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams).toHaveLength(1)
      expect(snapshot.workstreams[0].id).toBe('ws-new')
    })

    it('auto-creates workstream when agent is registered', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-team', pluginName: 'mock' })

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams.find((ws) => ws.id === 'ws-team')).toBeDefined()
    })

    it('updates workstream activity', () => {
      const store = new KnowledgeStore()
      store.ensureWorkstream('ws-1', 'Backend')
      store.updateWorkstreamActivity('ws-1', 'Agent completed task')

      const snapshot = store.getSnapshot()
      expect(snapshot.workstreams[0].recentActivity).toBe('Agent completed task')
    })
  })

  describe('version tracking', () => {
    it('starts at version 0', () => {
      const store = new KnowledgeStore()
      expect(store.getVersion()).toBe(0)
    })

    it('increments version on artifact store', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact())
      expect(store.getVersion()).toBe(1)
    })

    it('increments version on agent register', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      expect(store.getVersion()).toBe(1)
    })

    it('increments version on agent status update', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.updateAgentStatus('a-1', 'paused')
      expect(store.getVersion()).toBe(2)
    })

    it('increments version on coherence issue', () => {
      const store = new KnowledgeStore()
      store.storeCoherenceIssue(makeCoherenceIssue())
      expect(store.getVersion()).toBe(1)
    })

    it('increments version on agent removal', () => {
      const store = new KnowledgeStore()
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })
      store.removeAgent('a-1')
      expect(store.getVersion()).toBe(2)
    })
  })

  describe('getSnapshot', () => {
    it('returns empty snapshot for fresh store', () => {
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
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
      const store = new KnowledgeStore()
      const snapshot = store.getSnapshot()

      const result = knowledgeSnapshotSchema.safeParse(snapshot)
      expect(result.success).toBe(true)
    })

    it('has non-zero estimated tokens for non-empty snapshot', () => {
      const store = new KnowledgeStore()
      store.storeArtifact(makeArtifact())
      store.registerAgent(makeHandle('a-1'), { role: 'coder', workstream: 'ws-1', pluginName: 'mock' })

      const snapshot = store.getSnapshot()
      expect(snapshot.estimatedTokens).toBeGreaterThan(0)
    })
  })
})
