import { describe, expect, it, vi } from 'vitest'

import {
  RetrospectiveService,
  type RetrospectiveStore,
  type PhaseRetrospective,
} from '../../src/intelligence/retrospective-service'
import type { AuditLogEntry } from '../../src/intelligence/override-pattern-analyzer'

// ── Helpers ────────────────────────────────────────────────────────

function makeTrustOutcome(
  tick: number,
  outcome: string,
  overrides?: { agentId?: string; workstreams?: string[]; artifactKinds?: string[] },
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
      tick,
      affectedWorkstreams: overrides?.workstreams ?? [],
      affectedArtifactKinds: overrides?.artifactKinds ?? [],
      affectedArtifactIds: [],
    },
  }
}

function makeCoherenceIssue(tick: number, workstreams: string[]): AuditLogEntry {
  return {
    entityType: 'coherence_issue',
    entityId: `coh-${tick}`,
    action: 'create',
    timestamp: new Date().toISOString(),
    details: { tick, affectedWorkstreams: workstreams },
  }
}

function makeArtifactUpdate(tick: number, artifactId: string): AuditLogEntry {
  return {
    entityType: 'artifact',
    entityId: artifactId,
    action: 'update',
    timestamp: new Date().toISOString(),
    details: { tick, artifactId },
  }
}

function createMockStore(entries: AuditLogEntry[] = []): RetrospectiveStore {
  return {
    listAuditLog: vi.fn(() => entries),
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('RetrospectiveService', () => {
  it('returns empty retrospective when no audit data exists', () => {
    const store = createMockStore([])
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.phaseLabel).toBe('Phase 1')
    expect(retro.metricsComparison.current.totalDecisions).toBe(0)
    expect(retro.metricsComparison.current.overrideRate).toBe(0)
    expect(retro.metricsComparison.previous).toBeNull()
    expect(retro.insights).toEqual([])
    expect(retro.analysisWindow).toEqual({ startTick: 1, endTick: 50 })
  })

  it('counts decisions and overrides within tick range', () => {
    const entries = [
      makeTrustOutcome(5, 'human_approves_recommended_option'),
      makeTrustOutcome(10, 'human_overrides_agent_decision', { workstreams: ['backend'] }),
      makeTrustOutcome(15, 'human_picks_non_recommended'),
      makeTrustOutcome(20, 'task_completed_clean'),
      // Outside range
      makeTrustOutcome(55, 'human_overrides_agent_decision'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.current.totalDecisions).toBe(4)
    expect(retro.metricsComparison.current.totalOverrides).toBe(2)
    expect(retro.metricsComparison.current.overrideRate).toBe(0.5)
  })

  it('counts coherence issues within tick range', () => {
    const entries = [
      makeCoherenceIssue(3, ['frontend', 'backend']),
      makeCoherenceIssue(12, ['backend', 'infra']),
      // Outside range
      makeCoherenceIssue(60, ['frontend']),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.current.coherenceIssueCount).toBe(2)
  })

  it('counts artifact updates within tick range', () => {
    const entries = [
      makeArtifactUpdate(5, 'art-1'),
      makeArtifactUpdate(15, 'art-2'),
      makeArtifactUpdate(60, 'art-3'), // outside
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.current.artifactUpdates).toBe(2)
  })

  it('tracks positive/negative/neutral trust outcomes', () => {
    const entries = [
      makeTrustOutcome(1, 'human_approves_recommended_option'), // positive
      makeTrustOutcome(2, 'human_approves_always'),              // positive
      makeTrustOutcome(3, 'task_completed_clean'),               // positive
      makeTrustOutcome(4, 'human_overrides_agent_decision'),     // negative
      makeTrustOutcome(5, 'error_event'),                        // negative
      makeTrustOutcome(6, 'some_other_outcome'),                 // neutral
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.current.trustOutcomes.positive).toBe(3)
    expect(retro.metricsComparison.current.trustOutcomes.negative).toBe(2)
    expect(retro.metricsComparison.current.trustOutcomes.neutral).toBe(1)
  })

  it('compares current phase against previous phase', () => {
    const entries = [
      // Previous phase (ticks 1-25)
      makeTrustOutcome(5, 'human_approves_recommended_option'),
      makeTrustOutcome(10, 'human_overrides_agent_decision'),
      makeCoherenceIssue(15, ['backend']),
      // Current phase (ticks 26-50)
      makeTrustOutcome(30, 'human_approves_recommended_option'),
      makeTrustOutcome(35, 'human_approves_recommended_option'),
      makeTrustOutcome(40, 'human_approves_recommended_option'),
      makeTrustOutcome(45, 'human_overrides_agent_decision'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 2', 26, 50, 1, 25)

    expect(retro.metricsComparison.previous).not.toBeNull()
    expect(retro.metricsComparison.previous!.totalDecisions).toBe(2)
    expect(retro.metricsComparison.previous!.overrideRate).toBe(0.5)
    expect(retro.metricsComparison.current.totalDecisions).toBe(4)
    expect(retro.metricsComparison.current.overrideRate).toBe(0.25)
    // Override rate decreased
    expect(retro.metricsComparison.deltas.overrideRateChange).toBeCloseTo(-0.25)
    // Coherence decreased
    expect(retro.metricsComparison.deltas.coherenceIssueChange).toBe(-1)
  })

  it('deltas are null when no previous phase provided', () => {
    const entries = [makeTrustOutcome(5, 'human_approves_recommended_option')]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.deltas.overrideRateChange).toBeNull()
    expect(retro.metricsComparison.deltas.coherenceIssueChange).toBeNull()
    expect(retro.metricsComparison.deltas.decisionVolumeChange).toBeNull()
  })

  it('generates override workstream insight', () => {
    const entries = [
      makeTrustOutcome(5, 'human_overrides_agent_decision', { workstreams: ['backend'] }),
      makeTrustOutcome(10, 'human_overrides_agent_decision', { workstreams: ['backend'] }),
      makeTrustOutcome(15, 'human_overrides_agent_decision', { workstreams: ['frontend'] }),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    const overrideInsight = retro.insights.find((i) => i.category === 'override' && i.text.includes('backend'))
    expect(overrideInsight).toBeDefined()
    expect(overrideInsight!.text).toContain('2 overrides')
  })

  it('generates coherence trend insight when comparing phases', () => {
    const entries = [
      // Previous phase: 1 coherence issue
      makeCoherenceIssue(5, ['frontend', 'backend']),
      // Current phase: 3 coherence issues
      makeCoherenceIssue(30, ['frontend', 'backend']),
      makeCoherenceIssue(35, ['backend', 'infra']),
      makeCoherenceIssue(40, ['frontend', 'infra']),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 2', 26, 50, 1, 25)

    const cohInsight = retro.insights.find((i) => i.category === 'coherence')
    expect(cohInsight).toBeDefined()
    expect(cohInsight!.text).toContain('increased by 2')
  })

  it('generates trust insight when majority negative', () => {
    const entries = [
      makeTrustOutcome(1, 'human_overrides_agent_decision'),
      makeTrustOutcome(2, 'error_event'),
      makeTrustOutcome(3, 'human_picks_non_recommended'),
      makeTrustOutcome(4, 'human_approves_recommended_option'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    const trustInsight = retro.insights.find((i) => i.category === 'trust')
    expect(trustInsight).toBeDefined()
    expect(trustInsight!.text).toContain('majority negative')
  })

  it('suggests escalation adjustment when override rate > 30%', () => {
    const entries = [
      makeTrustOutcome(1, 'human_overrides_agent_decision'),
      makeTrustOutcome(2, 'human_approves_recommended_option'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.suggestedAdjustments.some((a) => a.includes('escalation'))).toBe(true)
  })

  it('suggests workstream boundary review when > 3 coherence issues', () => {
    const entries = [
      makeCoherenceIssue(1, ['a', 'b']),
      makeCoherenceIssue(2, ['a', 'b']),
      makeCoherenceIssue(3, ['a', 'b']),
      makeCoherenceIssue(4, ['a', 'b']),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.suggestedAdjustments.some((a) => a.includes('workstream boundaries'))).toBe(true)
  })

  it('builds a readable summary string', () => {
    const entries = [
      makeTrustOutcome(5, 'human_approves_recommended_option'),
      makeTrustOutcome(10, 'human_overrides_agent_decision', { workstreams: ['backend'] }),
      makeCoherenceIssue(15, ['backend']),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.summary).toContain('Phase 1')
    expect(retro.summary).toContain('2 decision(s)')
    expect(retro.summary).toContain('1 coherence issue')
  })

  it('caps insights at 5', () => {
    // Create a scenario with many potential insights
    const entries = [
      // Override insight workstream
      makeTrustOutcome(1, 'human_overrides_agent_decision', { workstreams: ['ws-1'] }),
      makeTrustOutcome(2, 'human_overrides_agent_decision', { workstreams: ['ws-1'] }),
      makeTrustOutcome(3, 'human_overrides_agent_decision', { workstreams: ['ws-1'] }),
      makeTrustOutcome(4, 'human_overrides_agent_decision', { workstreams: ['ws-1'] }),
      // These create temporal burst → another insight
      // Negative trust → another insight
      makeTrustOutcome(5, 'error_event'),
      makeTrustOutcome(6, 'error_event'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.insights.length).toBeLessThanOrEqual(5)
  })

  it('ignores entries without tick in details', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'trust_outcome',
        entityId: 'd-1',
        action: 'decision_resolution',
        timestamp: new Date().toISOString(),
        details: { outcome: 'human_overrides_agent_decision' }, // no tick
      },
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 1', 1, 50)

    expect(retro.metricsComparison.current.totalDecisions).toBe(0)
  })

  it('summary includes previous phase comparison when override rate changes', () => {
    const entries = [
      // Previous: 100% override rate
      makeTrustOutcome(5, 'human_overrides_agent_decision'),
      // Current: 0% override rate
      makeTrustOutcome(30, 'human_approves_recommended_option'),
      makeTrustOutcome(35, 'task_completed_clean'),
    ]
    const store = createMockStore(entries)
    const service = new RetrospectiveService(store)

    const retro = service.generateRetrospective('Phase 2', 26, 50, 1, 25)

    expect(retro.summary).toContain('improved')
    expect(retro.summary).toContain('100%')
    expect(retro.summary).toContain('0%')
  })
})
