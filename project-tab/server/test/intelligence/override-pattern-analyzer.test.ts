import { describe, expect, it } from 'vitest'

import {
  OverridePatternAnalyzer,
  type AuditLogEntry,
  type OverridePatternReport,
} from '../../src/intelligence/override-pattern-analyzer'

function makeAuditEntry(
  outcome: string,
  tick: number,
  overrides?: {
    agentId?: string
    workstreams?: string[]
    artifactKinds?: string[]
    toolName?: string
  }
): AuditLogEntry {
  return {
    entityType: 'trust_outcome',
    entityId: `d-${tick}`,
    action: 'decision_resolution',
    callerAgentId: overrides?.agentId ?? 'agent-1',
    timestamp: new Date().toISOString(),
    details: {
      agentId: overrides?.agentId ?? 'agent-1',
      outcome,
      effectiveDelta: -1,
      newScore: 45,
      tick,
      decisionSubtype: 'option',
      severity: 'medium',
      blastRadius: 'small',
      toolName: overrides?.toolName,
      affectedArtifactIds: [],
      affectedWorkstreams: overrides?.workstreams ?? [],
      affectedArtifactKinds: overrides?.artifactKinds ?? [],
    },
  }
}

describe('OverridePatternAnalyzer', () => {
  const analyzer = new OverridePatternAnalyzer()

  it('returns zero counts for empty audit log', () => {
    const report = analyzer.analyzeOverrides([])

    expect(report.totalOverrides).toBe(0)
    expect(report.overridesByWorkstream).toEqual({})
    expect(report.overridesByArtifactKind).toEqual({})
    expect(report.overridesByToolCategory).toEqual({})
    expect(report.overridesByAgent).toEqual({})
    expect(report.temporalClusters).toEqual([])
    expect(report.analysisWindow).toEqual({ startTick: null, endTick: null })
  })

  it('counts a single human_overrides_agent_decision correctly', () => {
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 5, {
        agentId: 'agent-a',
        workstreams: ['backend'],
        artifactKinds: ['code'],
        toolName: 'Bash',
      }),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(1)
    expect(report.overridesByAgent).toEqual({ 'agent-a': 1 })
    expect(report.overridesByWorkstream).toEqual({ backend: 1 })
    expect(report.overridesByArtifactKind).toEqual({ code: 1 })
    expect(report.overridesByToolCategory).toEqual({ Bash: 1 })
    expect(report.analysisWindow).toEqual({ startTick: 5, endTick: 5 })
  })

  it('counts a single human_picks_non_recommended correctly', () => {
    const entries = [
      makeAuditEntry('human_picks_non_recommended', 10, {
        agentId: 'agent-b',
        workstreams: ['frontend'],
        artifactKinds: ['test'],
      }),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(1)
    expect(report.overridesByAgent).toEqual({ 'agent-b': 1 })
    expect(report.overridesByWorkstream).toEqual({ frontend: 1 })
    expect(report.overridesByArtifactKind).toEqual({ test: 1 })
  })

  it('excludes non-override outcomes', () => {
    const entries = [
      makeAuditEntry('human_approves_recommended_option', 1),
      makeAuditEntry('human_approves_tool_call', 2),
      makeAuditEntry('task_completed_clean', 3),
      makeAuditEntry('error_event', 4),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(0)
  })

  it('aggregates multiple overrides across dimensions', () => {
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 1, {
        agentId: 'agent-1',
        workstreams: ['backend'],
        artifactKinds: ['code'],
        toolName: 'Write',
      }),
      makeAuditEntry('human_picks_non_recommended', 2, {
        agentId: 'agent-1',
        workstreams: ['backend', 'infra'],
        artifactKinds: ['config'],
        toolName: 'Bash',
      }),
      makeAuditEntry('human_overrides_agent_decision', 3, {
        agentId: 'agent-2',
        workstreams: ['frontend'],
        artifactKinds: ['code'],
        toolName: 'Write',
      }),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(3)
    expect(report.overridesByAgent).toEqual({ 'agent-1': 2, 'agent-2': 1 })
    expect(report.overridesByWorkstream).toEqual({ backend: 2, infra: 1, frontend: 1 })
    expect(report.overridesByArtifactKind).toEqual({ code: 2, config: 1 })
    expect(report.overridesByToolCategory).toEqual({ Write: 2, Bash: 1 })
    expect(report.analysisWindow).toEqual({ startTick: 1, endTick: 3 })
  })

  it('detects temporal burst when >3 overrides in a 5-tick window', () => {
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 1, { agentId: 'a1' }),
      makeAuditEntry('human_overrides_agent_decision', 2, { agentId: 'a1' }),
      makeAuditEntry('human_picks_non_recommended', 3, { agentId: 'a2' }),
      makeAuditEntry('human_overrides_agent_decision', 4, { agentId: 'a1' }),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.temporalClusters).toHaveLength(1)
    expect(report.temporalClusters[0].startTick).toBe(1)
    expect(report.temporalClusters[0].endTick).toBe(5)
    expect(report.temporalClusters[0].count).toBe(4)
    expect(report.temporalClusters[0].agentIds).toContain('a1')
    expect(report.temporalClusters[0].agentIds).toContain('a2')
  })

  it('does not flag a window with exactly 3 overrides', () => {
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 1),
      makeAuditEntry('human_overrides_agent_decision', 2),
      makeAuditEntry('human_overrides_agent_decision', 3),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.temporalClusters).toHaveLength(0)
  })

  it('produces separate clusters for distinct windows', () => {
    // Window 1-5: 4 overrides (flagged)
    // Window 6-10: 1 override (not flagged)
    // Window 11-15: 5 overrides (flagged)
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 1),
      makeAuditEntry('human_overrides_agent_decision', 2),
      makeAuditEntry('human_overrides_agent_decision', 3),
      makeAuditEntry('human_overrides_agent_decision', 5),
      makeAuditEntry('human_overrides_agent_decision', 8),
      makeAuditEntry('human_overrides_agent_decision', 11),
      makeAuditEntry('human_overrides_agent_decision', 12),
      makeAuditEntry('human_overrides_agent_decision', 13),
      makeAuditEntry('human_overrides_agent_decision', 14),
      makeAuditEntry('human_overrides_agent_decision', 15),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.temporalClusters).toHaveLength(2)
    expect(report.temporalClusters[0].startTick).toBe(1)
    expect(report.temporalClusters[1].startTick).toBe(11)
    expect(report.temporalClusters[1].count).toBe(5)
  })

  it('ignores audit entries with non-trust_outcome entityType', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'artifact',
        entityId: 'art-1',
        action: 'create',
        timestamp: new Date().toISOString(),
        details: { outcome: 'human_overrides_agent_decision', tick: 1 },
      },
    ]

    const report = analyzer.analyzeOverrides(entries)
    expect(report.totalOverrides).toBe(0)
  })

  it('ignores entries with missing or malformed details', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'trust_outcome',
        entityId: 'd-1',
        action: 'decision_resolution',
        timestamp: new Date().toISOString(),
        details: undefined,
      },
      {
        entityType: 'trust_outcome',
        entityId: 'd-2',
        action: 'decision_resolution',
        timestamp: new Date().toISOString(),
        details: 'not an object',
      },
      {
        entityType: 'trust_outcome',
        entityId: 'd-3',
        action: 'decision_resolution',
        timestamp: new Date().toISOString(),
        details: { outcome: 'human_overrides_agent_decision' }, // missing tick
      },
    ]

    const report = analyzer.analyzeOverrides(entries)
    expect(report.totalOverrides).toBe(0)
  })

  it('handles overrides with no workstreams or artifact kinds', () => {
    const entries = [
      makeAuditEntry('human_overrides_agent_decision', 5, {
        agentId: 'agent-x',
        workstreams: [],
        artifactKinds: [],
      }),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(1)
    expect(report.overridesByAgent).toEqual({ 'agent-x': 1 })
    expect(report.overridesByWorkstream).toEqual({})
    expect(report.overridesByArtifactKind).toEqual({})
    expect(report.overridesByToolCategory).toEqual({})
  })

  it('mixed overrides and non-overrides counts only overrides', () => {
    const entries = [
      makeAuditEntry('human_approves_recommended_option', 1),
      makeAuditEntry('human_overrides_agent_decision', 2, { agentId: 'a1' }),
      makeAuditEntry('task_completed_clean', 3),
      makeAuditEntry('human_picks_non_recommended', 4, { agentId: 'a2' }),
      makeAuditEntry('human_approves_tool_call', 5),
    ]

    const report = analyzer.analyzeOverrides(entries)

    expect(report.totalOverrides).toBe(2)
    expect(report.overridesByAgent).toEqual({ a1: 1, a2: 1 })
  })
})
