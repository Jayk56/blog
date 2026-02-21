import { describe, expect, it } from 'vitest'

import {
  ReworkCausalLinker,
  type ReworkCausalReport,
} from '../../src/intelligence/rework-causal-linker'
import type { AuditLogEntry } from '../../src/intelligence/override-pattern-analyzer'

// ── Helpers ────────────────────────────────────────────────────────

function makeArtifactUpdate(tick: number, artifactId: string): AuditLogEntry {
  return {
    entityType: 'artifact',
    entityId: artifactId,
    action: 'update',
    timestamp: new Date().toISOString(),
    details: { tick, artifactId },
  }
}

function makeCoherenceIssue(
  tick: number,
  issueId: string,
  affectedArtifactIds: string[],
): AuditLogEntry {
  return {
    entityType: 'coherence_issue',
    entityId: issueId,
    action: 'create',
    timestamp: new Date().toISOString(),
    details: { tick, affectedArtifactIds, issueId },
  }
}

function makeOverride(
  tick: number,
  entityId: string,
  affectedArtifactIds: string[],
): AuditLogEntry {
  return {
    entityType: 'trust_outcome',
    entityId,
    action: 'decision_resolution',
    timestamp: new Date().toISOString(),
    details: {
      tick,
      outcome: 'human_overrides_agent_decision',
      affectedArtifactIds,
    },
  }
}

function makeNonOverrideTrustOutcome(tick: number): AuditLogEntry {
  return {
    entityType: 'trust_outcome',
    entityId: `d-${tick}`,
    action: 'decision_resolution',
    timestamp: new Date().toISOString(),
    details: {
      tick,
      outcome: 'human_approves_recommended_option',
      affectedArtifactIds: [],
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ReworkCausalLinker', () => {
  const linker = new ReworkCausalLinker()

  it('returns empty report for no audit entries', () => {
    const report = linker.analyzeRework([])

    expect(report.links).toEqual([])
    expect(report.aggregate.total).toBe(0)
    expect(report.analysisWindow).toEqual({ startTick: null, endTick: null })
  })

  it('returns empty report when no artifact updates exist', () => {
    const entries = [
      makeCoherenceIssue(5, 'coh-1', ['art-1']),
      makeOverride(10, 'd-1', ['art-1']),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toEqual([])
    expect(report.aggregate.total).toBe(0)
  })

  it('classifies coherence-driven rework', () => {
    const entries = [
      makeCoherenceIssue(10, 'coh-1', ['art-1']),
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('coherence_driven')
    expect(report.links[0].triggerEntityId).toBe('coh-1')
    expect(report.links[0].triggerTick).toBe(10)
    expect(report.aggregate.coherenceDriven).toBe(1)
  })

  it('classifies override-driven rework', () => {
    const entries = [
      makeOverride(10, 'd-override-1', ['art-1']),
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('override_driven')
    expect(report.links[0].triggerEntityId).toBe('d-override-1')
    expect(report.links[0].triggerTick).toBe(10)
    expect(report.aggregate.overrideDriven).toBe(1)
  })

  it('classifies cascade rework when another artifact updated recently', () => {
    const entries = [
      makeArtifactUpdate(10, 'art-other'),
      makeArtifactUpdate(15, 'art-target'),
    ]

    const report = linker.analyzeRework(entries)

    // art-other has no prior trigger → voluntary
    // art-target has art-other updated at tick 10 → cascade
    const targetLink = report.links.find((l) => l.artifactId === 'art-target')
    expect(targetLink).toBeDefined()
    expect(targetLink!.cause).toBe('cascade')
    expect(targetLink!.triggerEntityId).toBe('art-other')
    expect(targetLink!.triggerTick).toBe(10)
    expect(report.aggregate.cascade).toBe(1)
  })

  it('classifies voluntary improvement when no trigger found', () => {
    const entries = [
      makeArtifactUpdate(50, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('voluntary_improvement')
    expect(report.links[0].triggerEntityId).toBeNull()
    expect(report.links[0].triggerTick).toBeNull()
    expect(report.aggregate.voluntaryImprovement).toBe(1)
  })

  it('prioritizes coherence over override when both triggers exist', () => {
    const entries = [
      makeCoherenceIssue(10, 'coh-1', ['art-1']),
      makeOverride(11, 'd-1', ['art-1']),
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('coherence_driven')
  })

  it('does not match triggers outside the lookback window (10 ticks)', () => {
    const entries = [
      makeCoherenceIssue(1, 'coh-1', ['art-1']),
      // Update at tick 20 — coherence at tick 1 is 19 ticks ago (> 10)
      makeArtifactUpdate(20, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('voluntary_improvement')
  })

  it('matches triggers at the exact lookback boundary', () => {
    const entries = [
      makeCoherenceIssue(10, 'coh-1', ['art-1']),
      // Update at tick 20 — coherence at tick 10 is exactly 10 ticks ago (within window)
      makeArtifactUpdate(20, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('coherence_driven')
  })

  it('picks the closest trigger when multiple coherence issues exist', () => {
    const entries = [
      makeCoherenceIssue(10, 'coh-old', ['art-1']),
      makeCoherenceIssue(14, 'coh-close', ['art-1']),
      makeArtifactUpdate(18, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links[0].triggerEntityId).toBe('coh-close')
    expect(report.links[0].triggerTick).toBe(14)
  })

  it('ignores coherence issues that do not affect the updated artifact', () => {
    const entries = [
      makeCoherenceIssue(10, 'coh-1', ['art-other']),
      makeArtifactUpdate(15, 'art-target'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('voluntary_improvement')
  })

  it('ignores non-override trust outcomes', () => {
    const entries = [
      makeNonOverrideTrustOutcome(10),
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toHaveLength(1)
    expect(report.links[0].cause).toBe('voluntary_improvement')
  })

  it('computes aggregate rates correctly', () => {
    const entries = [
      // Coherence-driven
      makeCoherenceIssue(5, 'coh-1', ['art-1']),
      makeArtifactUpdate(10, 'art-1'),
      // Override-driven
      makeOverride(20, 'd-1', ['art-2']),
      makeArtifactUpdate(25, 'art-2'),
      // Voluntary
      makeArtifactUpdate(50, 'art-3'),
      makeArtifactUpdate(60, 'art-4'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.aggregate.total).toBe(4)
    expect(report.aggregate.coherenceDriven).toBe(1)
    expect(report.aggregate.overrideDriven).toBe(1)
    // art-3 and art-4 are independent (no trigger within 10 ticks of each other for cascade)
    // art-3 at tick 50, art-4 at tick 60: 60-50=10 is within window → cascade
    expect(report.aggregate.cascade + report.aggregate.voluntaryImprovement).toBe(2)

    expect(report.aggregateRates.coherenceDrivenRate).toBe(0.25)
    expect(report.aggregateRates.overrideDrivenRate).toBe(0.25)
  })

  it('computes analysis window correctly', () => {
    const entries = [
      makeArtifactUpdate(5, 'art-1'),
      makeArtifactUpdate(42, 'art-2'),
      makeArtifactUpdate(17, 'art-3'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.analysisWindow).toEqual({ startTick: 5, endTick: 42 })
  })

  it('handles human_picks_non_recommended as override trigger', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'trust_outcome',
        entityId: 'd-pick-1',
        action: 'decision_resolution',
        timestamp: new Date().toISOString(),
        details: {
          tick: 10,
          outcome: 'human_picks_non_recommended',
          affectedArtifactIds: ['art-1'],
        },
      },
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links[0].cause).toBe('override_driven')
  })

  it('ignores artifact create events (only tracks updates)', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'artifact',
        entityId: 'art-1',
        action: 'create',
        timestamp: new Date().toISOString(),
        details: { tick: 5, artifactId: 'art-1' },
      },
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toEqual([])
    expect(report.aggregate.total).toBe(0)
  })

  it('does not trigger cascade from the same artifact', () => {
    // An artifact updating itself at an earlier tick should not be counted as cascade
    const entries = [
      makeArtifactUpdate(10, 'art-1'),
      makeArtifactUpdate(15, 'art-1'),
    ]

    const report = linker.analyzeRework(entries)

    // Both should be voluntary — first has no prior, second has only self as prior
    const firstLink = report.links.find((l) => l.updateTick === 10)
    const secondLink = report.links.find((l) => l.updateTick === 15)
    expect(firstLink!.cause).toBe('voluntary_improvement')
    expect(secondLink!.cause).toBe('voluntary_improvement')
  })

  it('ignores entries with missing tick', () => {
    const entries: AuditLogEntry[] = [
      {
        entityType: 'artifact',
        entityId: 'art-1',
        action: 'update',
        timestamp: new Date().toISOString(),
        details: { artifactId: 'art-1' }, // no tick
      },
    ]

    const report = linker.analyzeRework(entries)

    expect(report.links).toEqual([])
  })
})
