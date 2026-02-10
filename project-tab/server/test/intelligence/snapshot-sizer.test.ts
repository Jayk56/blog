import { describe, expect, it } from 'vitest'

import {
  sizeSnapshot,
  estimateSnapshotTokens,
  DEFAULT_TOKEN_BUDGET
} from '../../src/intelligence/snapshot-sizer'
import type { SnapshotSizingOptions } from '../../src/intelligence/snapshot-sizer'
import type {
  KnowledgeSnapshot,
  WorkstreamSummary,
  DecisionSummary,
  CoherenceIssueSummary,
  ArtifactSummary,
  AgentSummary
} from '../../src/types/brief'
import { knowledgeSnapshotSchema } from '../../src/validation/schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkstream(id: string, overrides: Partial<WorkstreamSummary> = {}): WorkstreamSummary {
  return {
    id,
    name: id,
    status: 'active',
    activeAgentIds: [],
    artifactCount: 0,
    pendingDecisionCount: 0,
    recentActivity: 'Initialized',
    ...overrides
  }
}

function makeDecision(id: string, agentId: string): DecisionSummary {
  return { id, title: `Decision ${id}`, severity: 'medium', agentId, subtype: 'option' }
}

function makeCoherenceIssue(id: string, workstreams: string[] = ['ws-1']): CoherenceIssueSummary {
  return {
    id,
    title: `Issue ${id}`,
    severity: 'medium',
    category: 'duplication',
    affectedWorkstreams: workstreams
  }
}

function makeArtifact(id: string, workstream: string): ArtifactSummary {
  return { id, name: `${id}.ts`, kind: 'code', status: 'draft', workstream }
}

function makeAgent(id: string, workstream: string, pluginName: string = 'mock', modelPreference?: string): AgentSummary {
  return {
    id,
    role: 'coder',
    workstream,
    status: 'running',
    pluginName,
    ...(modelPreference ? { modelPreference } : {})
  }
}

function makeSnapshot(overrides: Partial<KnowledgeSnapshot> = {}): KnowledgeSnapshot {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens: 0,
    ...overrides
  }
}

/** Create a large snapshot that exceeds a given token budget. */
function makeLargeSnapshot(targetTokens: number): KnowledgeSnapshot {
  const workstreams: WorkstreamSummary[] = []
  const artifacts: ArtifactSummary[] = []
  const agents: AgentSummary[] = []
  const decisions: DecisionSummary[] = []
  const coherence: CoherenceIssueSummary[] = []

  // Generate enough data to exceed budget
  for (let i = 0; i < 20; i++) {
    workstreams.push(makeWorkstream(`ws-${i}`, {
      recentActivity: `Activity description for workstream ${i} with some extra text to consume tokens.`
    }))
  }

  for (let i = 0; i < 50; i++) {
    artifacts.push(makeArtifact(`art-${i}`, `ws-${i % 20}`))
  }

  for (let i = 0; i < 10; i++) {
    agents.push(makeAgent(`agent-${i}`, `ws-${i % 20}`, 'claude', 'opus'))
  }

  for (let i = 0; i < 20; i++) {
    decisions.push(makeDecision(`dec-${i}`, `agent-${i % 10}`))
  }

  for (let i = 0; i < 15; i++) {
    coherence.push(makeCoherenceIssue(`ci-${i}`, [`ws-${i % 20}`, `ws-${(i + 1) % 20}`]))
  }

  const snapshot = makeSnapshot({
    workstreams,
    artifactIndex: artifacts,
    activeAgents: agents,
    pendingDecisions: decisions,
    recentCoherenceIssues: coherence
  })

  return snapshot
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimateSnapshotTokens', () => {
  it('returns 0-ish for empty snapshot', () => {
    const snapshot = makeSnapshot()
    const tokens = estimateSnapshotTokens(snapshot)
    // Empty JSON still has some characters
    expect(tokens).toBeGreaterThanOrEqual(0)
    expect(tokens).toBeLessThan(50)
  })

  it('returns higher count for larger snapshots', () => {
    const small = makeSnapshot({
      artifactIndex: [makeArtifact('a1', 'ws-1')]
    })
    const large = makeSnapshot({
      artifactIndex: Array.from({ length: 20 }, (_, i) => makeArtifact(`a${i}`, 'ws-1'))
    })

    expect(estimateSnapshotTokens(large)).toBeGreaterThan(estimateSnapshotTokens(small))
  })
})

describe('DEFAULT_TOKEN_BUDGET', () => {
  it('is 4000', () => {
    expect(DEFAULT_TOKEN_BUDGET).toBe(4000)
  })
})

describe('sizeSnapshot', () => {
  // =========================================================================
  // Basic behavior — no trimming needed
  // =========================================================================

  describe('no trimming needed', () => {
    it('returns snapshot unchanged when under budget', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1')],
        artifactIndex: [makeArtifact('a1', 'ws-1')],
        activeAgents: [makeAgent('ag1', 'ws-1', 'mock', 'gpt-4')]
      })

      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })

      expect(result.workstreams).toHaveLength(1)
      expect(result.artifactIndex).toHaveLength(1)
      expect(result.activeAgents).toHaveLength(1)
      expect(result.activeAgents[0].pluginName).toBe('mock')
      expect(result.activeAgents[0].modelPreference).toBe('gpt-4')
    })

    it('updates estimatedTokens even when no trimming needed', () => {
      const snapshot = makeSnapshot({ estimatedTokens: 999 })
      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })

      expect(result.estimatedTokens).not.toBe(999) // recalculated
    })

    it('uses DEFAULT_TOKEN_BUDGET when not specified', () => {
      const snapshot = makeSnapshot()
      const result = sizeSnapshot(snapshot)

      // Should not throw, uses default budget
      expect(result.estimatedTokens).toBeDefined()
    })
  })

  // =========================================================================
  // Workstream scoping
  // =========================================================================

  describe('workstream scoping', () => {
    it('filters workstreams to readableWorkstreams', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1'), makeWorkstream('ws-2'), makeWorkstream('ws-3')]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1', 'ws-3'],
        tokenBudget: 10000
      })

      expect(result.workstreams).toHaveLength(2)
      expect(result.workstreams.map((ws) => ws.id)).toEqual(['ws-1', 'ws-3'])
    })

    it('filters artifacts to readable workstreams', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1'), makeWorkstream('ws-2')],
        artifactIndex: [
          makeArtifact('a1', 'ws-1'),
          makeArtifact('a2', 'ws-2'),
          makeArtifact('a3', 'ws-1')
        ]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1'],
        tokenBudget: 10000
      })

      expect(result.artifactIndex).toHaveLength(2)
      expect(result.artifactIndex.every((a) => a.workstream === 'ws-1')).toBe(true)
    })

    it('filters decisions to readable workstreams via agent mapping', () => {
      const snapshot = makeSnapshot({
        activeAgents: [
          makeAgent('ag-1', 'ws-1'),
          makeAgent('ag-2', 'ws-2')
        ],
        pendingDecisions: [
          makeDecision('d1', 'ag-1'),
          makeDecision('d2', 'ag-2')
        ]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1'],
        tokenBudget: 10000
      })

      expect(result.pendingDecisions).toHaveLength(1)
      expect(result.pendingDecisions[0].agentId).toBe('ag-1')
    })

    it('filters coherence issues to readable workstreams', () => {
      const snapshot = makeSnapshot({
        recentCoherenceIssues: [
          makeCoherenceIssue('ci-1', ['ws-1']),
          makeCoherenceIssue('ci-2', ['ws-2']),
          makeCoherenceIssue('ci-3', ['ws-1', 'ws-2'])
        ]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1'],
        tokenBudget: 10000
      })

      // ci-1 matches (ws-1), ci-3 matches (has ws-1)
      expect(result.recentCoherenceIssues).toHaveLength(2)
    })

    it('keeps all agents regardless of workstream scoping', () => {
      const snapshot = makeSnapshot({
        activeAgents: [
          makeAgent('ag-1', 'ws-1'),
          makeAgent('ag-2', 'ws-2')
        ]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1'],
        tokenBudget: 10000
      })

      // Agents are always visible per spec
      expect(result.activeAgents).toHaveLength(2)
    })

    it('no scoping when readableWorkstreams is empty', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1'), makeWorkstream('ws-2')]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: [],
        tokenBudget: 10000
      })

      expect(result.workstreams).toHaveLength(2)
    })

    it('no scoping when readableWorkstreams is not provided', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1'), makeWorkstream('ws-2')]
      })

      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })

      expect(result.workstreams).toHaveLength(2)
    })
  })

  // =========================================================================
  // Trimming — level 1: coherence issues
  // =========================================================================

  describe('trim level 1: coherence issues', () => {
    it('drops affectedWorkstreams from coherence issues', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, { tokenBudget: 1 }) // force all trims

      for (const ci of result.recentCoherenceIssues) {
        expect(ci.affectedWorkstreams).toEqual([])
      }
    })

    it('preserves other coherence fields after trimming', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, { tokenBudget: 1 })

      for (const ci of result.recentCoherenceIssues) {
        expect(ci.id).toBeDefined()
        expect(ci.title).toBeDefined()
        expect(ci.severity).toBeDefined()
        expect(ci.category).toBeDefined()
      }
    })
  })

  // =========================================================================
  // Trimming — level 2: artifacts to own workstream
  // =========================================================================

  describe('trim level 2: artifacts to own workstream', () => {
    it('filters artifacts to agent workstream when over budget', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, {
        tokenBudget: 1,
        agentWorkstream: 'ws-0'
      })

      // Only artifacts from ws-0 should remain
      expect(result.artifactIndex.every((a) => a.workstream === 'ws-0')).toBe(true)
      expect(result.artifactIndex.length).toBeLessThan(large.artifactIndex.length)
    })

    it('keeps all artifacts when agentWorkstream not specified', () => {
      const snapshot = makeSnapshot({
        artifactIndex: [
          makeArtifact('a1', 'ws-1'),
          makeArtifact('a2', 'ws-2')
        ]
      })

      // Even with tiny budget, without agentWorkstream, can't filter
      const result = sizeSnapshot(snapshot, { tokenBudget: 1 })
      expect(result.artifactIndex).toHaveLength(2)
    })
  })

  // =========================================================================
  // Trimming — level 3: agent details
  // =========================================================================

  describe('trim level 3: agent details', () => {
    it('drops pluginName and modelPreference when over budget', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, { tokenBudget: 1 })

      for (const agent of result.activeAgents) {
        expect(agent.pluginName).toBe('')
        expect(agent.modelPreference).toBeUndefined()
      }
    })

    it('preserves other agent fields', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, { tokenBudget: 1 })

      for (const agent of result.activeAgents) {
        expect(agent.id).toBeDefined()
        expect(agent.role).toBeDefined()
        expect(agent.workstream).toBeDefined()
        expect(agent.status).toBeDefined()
      }
    })
  })

  // =========================================================================
  // Trimming — level 4: decisions to own workstream
  // =========================================================================

  describe('trim level 4: decisions to own workstream', () => {
    it('filters decisions to agent workstream when all trims applied', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, {
        tokenBudget: 1,
        agentWorkstream: 'ws-0'
      })

      // Decisions should be filtered to agent-0's workstream (ws-0)
      // agent-0 is the only agent in ws-0
      for (const d of result.pendingDecisions) {
        expect(d.agentId).toBe('agent-0')
      }
    })

    it('keeps all decisions when agentWorkstream not specified', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, { tokenBudget: 1 })

      // Without agentWorkstream, decisions cannot be filtered by workstream
      expect(result.pendingDecisions).toHaveLength(large.pendingDecisions.length)
    })
  })

  // =========================================================================
  // Progressive trimming
  // =========================================================================

  describe('progressive trimming', () => {
    it('applies trims in order — stops after coherence trim if under budget', () => {
      // Create a snapshot just barely over budget due to coherence issue detail
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1')],
        recentCoherenceIssues: Array.from({ length: 30 }, (_, i) =>
          makeCoherenceIssue(`ci-${i}`, Array.from({ length: 10 }, (_, j) => `ws-${j}`))
        ),
        activeAgents: [makeAgent('ag-1', 'ws-1', 'claude', 'opus')]
      })

      const tokensBeforeTrim = estimateSnapshotTokens(snapshot)
      // Set budget between trimmed and untrimmed size
      const trimmedSnapshot = makeSnapshot({
        ...snapshot,
        recentCoherenceIssues: snapshot.recentCoherenceIssues.map(ci => ({
          ...ci,
          affectedWorkstreams: []
        }))
      })
      const tokensAfterCoherenceTrim = estimateSnapshotTokens(trimmedSnapshot)

      // Budget that allows coherence-trimmed but not original
      const result = sizeSnapshot(snapshot, { tokenBudget: tokensAfterCoherenceTrim + 10 })

      // Coherence should be trimmed
      for (const ci of result.recentCoherenceIssues) {
        expect(ci.affectedWorkstreams).toEqual([])
      }

      // But agents should NOT be trimmed (still have pluginName)
      expect(result.activeAgents[0].pluginName).toBe('claude')
      expect(result.activeAgents[0].modelPreference).toBe('opus')
    })

    it('applies multiple trim levels when needed', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, {
        tokenBudget: 500,
        agentWorkstream: 'ws-0'
      })

      // All trim levels should have been applied
      // Coherence: empty affectedWorkstreams
      for (const ci of result.recentCoherenceIssues) {
        expect(ci.affectedWorkstreams).toEqual([])
      }

      // Artifacts: only ws-0
      for (const a of result.artifactIndex) {
        expect(a.workstream).toBe('ws-0')
      }

      // Agents: stripped
      for (const ag of result.activeAgents) {
        expect(ag.pluginName).toBe('')
        expect(ag.modelPreference).toBeUndefined()
      }
    })
  })

  // =========================================================================
  // Schema validation after trimming
  // =========================================================================

  describe('schema validation', () => {
    it('trimmed snapshot validates against Zod schema', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, {
        tokenBudget: 500,
        agentWorkstream: 'ws-0'
      })

      const parsed = knowledgeSnapshotSchema.safeParse(result)
      expect(parsed.success).toBe(true)
    })

    it('scoped snapshot validates against Zod schema', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1'), makeWorkstream('ws-2')],
        artifactIndex: [makeArtifact('a1', 'ws-1'), makeArtifact('a2', 'ws-2')],
        activeAgents: [makeAgent('ag-1', 'ws-1'), makeAgent('ag-2', 'ws-2')],
        pendingDecisions: [makeDecision('d1', 'ag-1'), makeDecision('d2', 'ag-2')],
        recentCoherenceIssues: [makeCoherenceIssue('ci-1', ['ws-1'])]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-1'],
        tokenBudget: 10000
      })

      const parsed = knowledgeSnapshotSchema.safeParse(result)
      expect(parsed.success).toBe(true)
    })

    it('empty scoped snapshot validates against Zod schema', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1')],
        artifactIndex: [makeArtifact('a1', 'ws-1')]
      })

      const result = sizeSnapshot(snapshot, {
        readableWorkstreams: ['ws-nonexistent'],
        tokenBudget: 10000
      })

      const parsed = knowledgeSnapshotSchema.safeParse(result)
      expect(parsed.success).toBe(true)
    })
  })

  // =========================================================================
  // estimatedTokens field
  // =========================================================================

  describe('estimatedTokens field', () => {
    it('updates estimatedTokens after trimming', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const originalTokens = estimateSnapshotTokens(large)
      const result = sizeSnapshot(large, {
        tokenBudget: 1000,
        agentWorkstream: 'ws-0'
      })

      expect(result.estimatedTokens).toBeLessThan(originalTokens)
    })

    it('estimatedTokens matches actual estimate', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1')],
        artifactIndex: [makeArtifact('a1', 'ws-1')]
      })

      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })
      expect(result.estimatedTokens).toBe(estimateSnapshotTokens(result))
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles empty snapshot', () => {
      const result = sizeSnapshot(makeSnapshot(), { tokenBudget: 100 })
      expect(result.workstreams).toEqual([])
      expect(result.artifactIndex).toEqual([])
    })

    it('handles zero token budget', () => {
      const snapshot = makeSnapshot({
        workstreams: [makeWorkstream('ws-1')]
      })

      // Should not throw, just returns trimmed result
      const result = sizeSnapshot(snapshot, { tokenBudget: 0 })
      expect(result).toBeDefined()
    })

    it('handles snapshot with only coherence issues', () => {
      const snapshot = makeSnapshot({
        recentCoherenceIssues: [
          makeCoherenceIssue('ci-1', ['ws-1', 'ws-2']),
          makeCoherenceIssue('ci-2', ['ws-3'])
        ]
      })

      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })
      expect(result.recentCoherenceIssues).toHaveLength(2)
    })

    it('preserves version and generatedAt through sizing', () => {
      const snapshot = makeSnapshot({
        version: 42,
        generatedAt: '2025-06-01T12:00:00.000Z'
      })

      const result = sizeSnapshot(snapshot, { tokenBudget: 10000 })
      expect(result.version).toBe(42)
      expect(result.generatedAt).toBe('2025-06-01T12:00:00.000Z')
    })

    it('scoping + trimming works together', () => {
      const large = makeLargeSnapshot(DEFAULT_TOKEN_BUDGET)
      const result = sizeSnapshot(large, {
        tokenBudget: 500,
        agentWorkstream: 'ws-0',
        readableWorkstreams: ['ws-0', 'ws-1']
      })

      // Scoped to ws-0 and ws-1
      for (const ws of result.workstreams) {
        expect(['ws-0', 'ws-1']).toContain(ws.id)
      }

      // Trimmed artifacts to own workstream
      for (const a of result.artifactIndex) {
        expect(a.workstream).toBe('ws-0')
      }

      // Schema valid
      const parsed = knowledgeSnapshotSchema.safeParse(result)
      expect(parsed.success).toBe(true)
    })
  })
})
