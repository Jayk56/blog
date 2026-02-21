import { describe, expect, it } from 'vitest'

import {
  ControlModeROIService,
  type ModeInterval,
  type ControlModeROIReport,
} from '../../src/intelligence/control-mode-roi-service'
import type { AuditLogEntry } from '../../src/intelligence/override-pattern-analyzer'
import type { ControlMode } from '../../src/types/events'

function makeTrustOutcomeEntry(
  tick: number,
  outcome: string,
  overrides?: { agentId?: string; autoResolved?: boolean },
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
      effectiveDelta: 0,
      newScore: 50,
      tick,
      decisionSubtype: 'option',
      severity: 'medium',
      blastRadius: 'small',
      autoResolved: overrides?.autoResolved ?? false,
    },
  }
}

function makeCoherenceIssueEntry(tick: number): AuditLogEntry {
  return {
    entityType: 'coherence_issue',
    entityId: `ci-${tick}`,
    action: 'create',
    timestamp: new Date().toISOString(),
    details: { tick },
  }
}

function makeModeChangeEntry(
  tick: number,
  previousMode: ControlMode,
  newMode: ControlMode,
): AuditLogEntry {
  return {
    entityType: 'control_mode_change',
    entityId: `mc-${tick}`,
    action: 'mode_changed',
    timestamp: new Date().toISOString(),
    details: { previousMode, newMode, tick },
  }
}

describe('ControlModeROIService', () => {
  const service = new ControlModeROIService()

  // ── buildModeIntervals ──────────────────────────────────────────

  describe('buildModeIntervals', () => {
    it('returns single interval for current mode when no changes recorded', () => {
      const intervals = service.buildModeIntervals([], 'orchestrator', 100)

      expect(intervals).toHaveLength(1)
      expect(intervals[0]).toEqual({ mode: 'orchestrator', startTick: 0, endTick: null })
    })

    it('builds intervals from mode change entries', () => {
      const entries = [
        makeModeChangeEntry(20, 'orchestrator', 'adaptive'),
        makeModeChangeEntry(50, 'adaptive', 'ecosystem'),
      ]

      const intervals = service.buildModeIntervals(entries, 'ecosystem', 100)

      expect(intervals).toHaveLength(3)
      expect(intervals[0]).toEqual({ mode: 'orchestrator', startTick: 0, endTick: 19 })
      expect(intervals[1]).toEqual({ mode: 'adaptive', startTick: 20, endTick: 49 })
      expect(intervals[2]).toEqual({ mode: 'ecosystem', startTick: 50, endTick: null })
    })

    it('handles single mode change', () => {
      const entries = [makeModeChangeEntry(30, 'orchestrator', 'adaptive')]

      const intervals = service.buildModeIntervals(entries, 'adaptive', 60)

      expect(intervals).toHaveLength(2)
      expect(intervals[0]).toEqual({ mode: 'orchestrator', startTick: 0, endTick: 29 })
      expect(intervals[1]).toEqual({ mode: 'adaptive', startTick: 30, endTick: null })
    })

    it('ignores non-control_mode_change entries', () => {
      const entries: AuditLogEntry[] = [
        { entityType: 'trust_outcome', entityId: 'd-1', action: 'x', timestamp: '', details: { tick: 5 } },
        makeModeChangeEntry(20, 'orchestrator', 'adaptive'),
      ]

      const intervals = service.buildModeIntervals(entries, 'adaptive', 50)

      expect(intervals).toHaveLength(2)
    })

    it('sorts unsorted entries by tick', () => {
      const entries = [
        makeModeChangeEntry(50, 'adaptive', 'ecosystem'),
        makeModeChangeEntry(20, 'orchestrator', 'adaptive'),
      ]

      const intervals = service.buildModeIntervals(entries, 'ecosystem', 100)

      expect(intervals[0].mode).toBe('orchestrator')
      expect(intervals[1].mode).toBe('adaptive')
      expect(intervals[2].mode).toBe('ecosystem')
    })
  })

  // ── modeAtTick ──────────────────────────────────────────────────

  describe('modeAtTick', () => {
    const intervals: ModeInterval[] = [
      { mode: 'orchestrator', startTick: 0, endTick: 19 },
      { mode: 'adaptive', startTick: 20, endTick: 49 },
      { mode: 'ecosystem', startTick: 50, endTick: 100 },
    ]

    it('returns correct mode for tick within first interval', () => {
      expect(service.modeAtTick(intervals, 5)).toBe('orchestrator')
    })

    it('returns correct mode for tick at interval boundary', () => {
      expect(service.modeAtTick(intervals, 20)).toBe('adaptive')
      expect(service.modeAtTick(intervals, 19)).toBe('orchestrator')
    })

    it('returns correct mode for tick in last interval', () => {
      expect(service.modeAtTick(intervals, 75)).toBe('ecosystem')
    })

    it('returns null for tick outside all intervals', () => {
      expect(service.modeAtTick(intervals, 200)).toBeNull()
    })

    it('handles null endTick (still active)', () => {
      const active: ModeInterval[] = [{ mode: 'adaptive', startTick: 0, endTick: null }]
      expect(service.modeAtTick(active, 9999)).toBe('adaptive')
    })
  })

  // ── analyze: empty inputs ───────────────────────────────────────

  describe('analyze', () => {
    it('returns empty report for no intervals', () => {
      const report = service.analyze([], [], [])

      expect(report.perModeMetrics).toEqual([])
      expect(report.comparisons).toEqual([])
      expect(report.recommendations).toEqual([])
      expect(report.totalDecisionsAnalyzed).toBe(0)
      expect(report.analysisWindow).toEqual({ startTick: null, endTick: null })
    })

    it('returns empty metrics when intervals exist but no decisions', () => {
      const intervals: ModeInterval[] = [{ mode: 'orchestrator', startTick: 0, endTick: 50 }]

      const report = service.analyze([], [], intervals)

      expect(report.perModeMetrics).toHaveLength(1)
      expect(report.perModeMetrics[0].totalDecisions).toBe(0)
      expect(report.perModeMetrics[0].overrideRate).toBe(0)
      expect(report.totalDecisionsAnalyzed).toBe(0)
    })

    // ── per-mode metrics ────────────────────────────────────────

    it('counts overrides per mode', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 19 },
        { mode: 'adaptive', startTick: 20, endTick: 50 },
      ]
      const entries = [
        makeTrustOutcomeEntry(5, 'human_overrides_agent_decision'),
        makeTrustOutcomeEntry(10, 'human_approves_recommended_option'),
        makeTrustOutcomeEntry(25, 'human_picks_non_recommended'),
        makeTrustOutcomeEntry(30, 'human_approves_tool_call'),
        makeTrustOutcomeEntry(35, 'human_rejects_tool_call'),
      ]

      const report = service.analyze(entries, [], intervals)

      const orch = report.perModeMetrics.find((m) => m.mode === 'orchestrator')!
      const adapt = report.perModeMetrics.find((m) => m.mode === 'adaptive')!

      expect(orch.totalDecisions).toBe(2)
      expect(orch.overrideCount).toBe(1)
      expect(orch.overrideRate).toBe(0.5)

      expect(adapt.totalDecisions).toBe(3)
      expect(adapt.overrideCount).toBe(2) // picks_non_recommended + rejects_tool_call
      expect(adapt.overrideRate).toBeCloseTo(2 / 3)
    })

    it('counts task completions and abandonments', () => {
      const intervals: ModeInterval[] = [{ mode: 'adaptive', startTick: 0, endTick: 50 }]
      const entries = [
        makeTrustOutcomeEntry(5, 'task_completed_clean'),
        makeTrustOutcomeEntry(10, 'task_completed_partial'),
        makeTrustOutcomeEntry(15, 'task_abandoned_or_max_turns'),
        makeTrustOutcomeEntry(20, 'human_approves_tool_call'),
      ]

      const report = service.analyze(entries, [], intervals)
      const m = report.perModeMetrics[0]

      expect(m.taskCompletedCount).toBe(2)
      expect(m.taskAbandonedCount).toBe(1)
      expect(m.taskCompletionRate).toBeCloseTo(2 / 3)
    })

    it('counts auto-resolved decisions', () => {
      const intervals: ModeInterval[] = [{ mode: 'ecosystem', startTick: 0, endTick: 50 }]
      const entries = [
        makeTrustOutcomeEntry(5, 'human_approves_tool_call', { autoResolved: true }),
        makeTrustOutcomeEntry(10, 'human_approves_tool_call', { autoResolved: true }),
        makeTrustOutcomeEntry(15, 'human_approves_tool_call', { autoResolved: false }),
      ]

      const report = service.analyze(entries, [], intervals)
      const m = report.perModeMetrics[0]

      expect(m.autoResolvedCount).toBe(2)
      expect(m.autoResolvedRate).toBeCloseTo(2 / 3)
    })

    it('counts coherence issues per mode', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 29 },
        { mode: 'adaptive', startTick: 30, endTick: 60 },
      ]
      const trustEntries = [
        makeTrustOutcomeEntry(5, 'human_approves_tool_call'),
        makeTrustOutcomeEntry(35, 'human_approves_tool_call'),
      ]
      const coherenceEntries = [
        makeCoherenceIssueEntry(10),
        makeCoherenceIssueEntry(15),
        makeCoherenceIssueEntry(40),
      ]

      const report = service.analyze(trustEntries, coherenceEntries, intervals)

      const orch = report.perModeMetrics.find((m) => m.mode === 'orchestrator')!
      const adapt = report.perModeMetrics.find((m) => m.mode === 'adaptive')!

      expect(orch.coherenceIssueCount).toBe(2)
      expect(orch.coherenceIssueRate).toBe(2) // 2 issues / 1 decision
      expect(adapt.coherenceIssueCount).toBe(1)
      expect(adapt.coherenceIssueRate).toBe(1)
    })

    it('calculates totalTicks per mode from intervals', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 19 },  // 20 ticks
        { mode: 'adaptive', startTick: 20, endTick: 49 },     // 30 ticks
      ]

      const report = service.analyze([], [], intervals)

      const orch = report.perModeMetrics.find((m) => m.mode === 'orchestrator')!
      const adapt = report.perModeMetrics.find((m) => m.mode === 'adaptive')!

      expect(orch.totalTicks).toBe(20)
      expect(adapt.totalTicks).toBe(30)
    })

    it('computes analysis window from trust outcome ticks', () => {
      const intervals: ModeInterval[] = [{ mode: 'adaptive', startTick: 0, endTick: 100 }]
      const entries = [
        makeTrustOutcomeEntry(15, 'human_approves_tool_call'),
        makeTrustOutcomeEntry(80, 'human_approves_tool_call'),
      ]

      const report = service.analyze(entries, [], intervals)

      expect(report.analysisWindow).toEqual({ startTick: 15, endTick: 80 })
    })

    it('ignores entries with tick outside any interval', () => {
      const intervals: ModeInterval[] = [{ mode: 'orchestrator', startTick: 10, endTick: 30 }]
      const entries = [
        makeTrustOutcomeEntry(5, 'human_overrides_agent_decision'),  // before interval
        makeTrustOutcomeEntry(15, 'human_approves_tool_call'),        // inside
        makeTrustOutcomeEntry(50, 'human_overrides_agent_decision'),  // after interval
      ]

      const report = service.analyze(entries, [], intervals)

      expect(report.totalDecisionsAnalyzed).toBe(1)
    })

    it('ignores malformed trust outcome entries', () => {
      const intervals: ModeInterval[] = [{ mode: 'adaptive', startTick: 0, endTick: 50 }]
      const entries: AuditLogEntry[] = [
        { entityType: 'trust_outcome', entityId: 'd-1', action: 'x', timestamp: '', details: undefined },
        { entityType: 'trust_outcome', entityId: 'd-2', action: 'x', timestamp: '', details: 'bad' },
        { entityType: 'trust_outcome', entityId: 'd-3', action: 'x', timestamp: '', details: { tick: 10, outcome: 'human_approves_tool_call' } },
      ]

      const report = service.analyze(entries, [], intervals)

      // Only the last entry has valid details with tick
      expect(report.totalDecisionsAnalyzed).toBe(1)
    })

    it('ignores coherence_issue entries with action other than create', () => {
      const intervals: ModeInterval[] = [{ mode: 'adaptive', startTick: 0, endTick: 50 }]
      const coherenceEntries: AuditLogEntry[] = [
        { entityType: 'coherence_issue', entityId: 'ci-1', action: 'resolve', timestamp: '', details: { tick: 10 } },
        makeCoherenceIssueEntry(20),
      ]

      const report = service.analyze([], coherenceEntries, intervals)
      const m = report.perModeMetrics[0]

      expect(m.coherenceIssueCount).toBe(1)
    })

    it('sorts perModeMetrics alphabetically by mode', () => {
      const intervals: ModeInterval[] = [
        { mode: 'ecosystem', startTick: 0, endTick: 9 },
        { mode: 'adaptive', startTick: 10, endTick: 19 },
        { mode: 'orchestrator', startTick: 20, endTick: 30 },
      ]

      const report = service.analyze([], [], intervals)
      const modes = report.perModeMetrics.map((m) => m.mode)

      expect(modes).toEqual(['adaptive', 'ecosystem', 'orchestrator'])
    })

    // ── comparisons ────────────────────────────────────────────

    it('generates comparisons only between modes with >= 5 decisions', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 49 },
        { mode: 'adaptive', startTick: 50, endTick: 100 },
      ]
      const entries: AuditLogEntry[] = []
      // 6 decisions for orchestrator
      for (let i = 0; i < 6; i++) {
        entries.push(makeTrustOutcomeEntry(i * 5, 'human_approves_tool_call'))
      }
      // 3 decisions for adaptive (insufficient)
      for (let i = 0; i < 3; i++) {
        entries.push(makeTrustOutcomeEntry(50 + i * 5, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      // Only orchestrator has >= 5 decisions, so no pairwise comparisons
      expect(report.comparisons).toHaveLength(0)
    })

    it('generates pairwise comparison when both modes have enough data', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 49 },
        { mode: 'adaptive', startTick: 50, endTick: 100 },
      ]
      const entries: AuditLogEntry[] = []
      // 5 decisions for orchestrator: 2 overrides
      entries.push(makeTrustOutcomeEntry(1, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(2, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(3, 'human_approves_tool_call'))
      entries.push(makeTrustOutcomeEntry(4, 'human_approves_tool_call'))
      entries.push(makeTrustOutcomeEntry(5, 'human_approves_tool_call'))
      // 5 decisions for adaptive: 0 overrides
      for (let i = 0; i < 5; i++) {
        entries.push(makeTrustOutcomeEntry(50 + i, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.comparisons).toHaveLength(1)
      expect(report.comparisons[0].modeA).toBe('adaptive')
      expect(report.comparisons[0].modeB).toBe('orchestrator')
      // adaptive has 0% override, orchestrator has 40%
      expect(report.comparisons[0].overrideRateDelta).toBeCloseTo(-0.4)
      expect(report.comparisons[0].summary).toContain('override rate')
    })

    it('summary says no significant differences when rates are close', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 49 },
        { mode: 'adaptive', startTick: 50, endTick: 100 },
      ]
      const entries: AuditLogEntry[] = []
      // Both modes have same pattern: 5 approvals each
      for (let i = 0; i < 5; i++) {
        entries.push(makeTrustOutcomeEntry(i, 'human_approves_tool_call'))
      }
      for (let i = 0; i < 5; i++) {
        entries.push(makeTrustOutcomeEntry(50 + i, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.comparisons[0].summary).toBe('No significant differences observed')
    })

    // ── recommendations ────────────────────────────────────────

    it('returns low-confidence default recommendation when no mode has enough data', () => {
      const intervals: ModeInterval[] = [{ mode: 'orchestrator', startTick: 0, endTick: 10 }]
      const entries = [makeTrustOutcomeEntry(5, 'human_approves_tool_call')]

      const report = service.analyze(entries, [], intervals)

      expect(report.recommendations).toHaveLength(1)
      expect(report.recommendations[0].confidence).toBe('low')
      expect(report.recommendations[0].recommendedMode).toBe('adaptive')
    })

    it('returns low-confidence when only one mode has data', () => {
      const intervals: ModeInterval[] = [{ mode: 'ecosystem', startTick: 0, endTick: 100 }]
      const entries: AuditLogEntry[] = []
      for (let i = 0; i < 6; i++) {
        entries.push(makeTrustOutcomeEntry(i * 10, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.recommendations).toHaveLength(1)
      expect(report.recommendations[0].recommendedMode).toBe('ecosystem')
      expect(report.recommendations[0].confidence).toBe('low')
    })

    it('recommends mode with best combined score', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 49 },
        { mode: 'adaptive', startTick: 50, endTick: 100 },
      ]
      const entries: AuditLogEntry[] = []
      // Orchestrator: 4 overrides out of 5 (high override rate)
      entries.push(makeTrustOutcomeEntry(1, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(2, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(3, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(4, 'human_overrides_agent_decision'))
      entries.push(makeTrustOutcomeEntry(5, 'task_completed_clean'))
      // Adaptive: 0 overrides, 5 clean completions (great)
      for (let i = 0; i < 5; i++) {
        entries.push(makeTrustOutcomeEntry(50 + i, 'task_completed_clean'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.recommendations).toHaveLength(1)
      expect(report.recommendations[0].recommendedMode).toBe('adaptive')
    })

    it('assigns medium confidence with 20-49 total decisions', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 99 },
        { mode: 'adaptive', startTick: 100, endTick: 200 },
      ]
      const entries: AuditLogEntry[] = []
      // 15 for orchestrator
      for (let i = 0; i < 15; i++) {
        entries.push(makeTrustOutcomeEntry(i * 5, 'human_approves_tool_call'))
      }
      // 10 for adaptive
      for (let i = 0; i < 10; i++) {
        entries.push(makeTrustOutcomeEntry(100 + i * 5, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.recommendations[0].confidence).toBe('medium')
    })

    it('assigns high confidence with >= 50 total decisions', () => {
      const intervals: ModeInterval[] = [
        { mode: 'orchestrator', startTick: 0, endTick: 499 },
        { mode: 'adaptive', startTick: 500, endTick: 1000 },
      ]
      const entries: AuditLogEntry[] = []
      for (let i = 0; i < 30; i++) {
        entries.push(makeTrustOutcomeEntry(i * 10, 'human_approves_tool_call'))
      }
      for (let i = 0; i < 25; i++) {
        entries.push(makeTrustOutcomeEntry(500 + i * 10, 'human_approves_tool_call'))
      }

      const report = service.analyze(entries, [], intervals)

      expect(report.recommendations[0].confidence).toBe('high')
    })
  })
})
