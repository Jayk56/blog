import type { ControlMode } from '../types/events'
import type { AuditLogEntry } from './override-pattern-analyzer'

/** A period during which a specific control mode was active. */
export interface ModeInterval {
  mode: ControlMode
  startTick: number
  endTick: number | null // null = still active
}

/** Per-mode aggregated metrics. */
export interface PerModeMetrics {
  mode: ControlMode
  totalDecisions: number
  overrideCount: number
  overrideRate: number
  coherenceIssueCount: number
  coherenceIssueRate: number
  taskCompletedCount: number
  taskAbandonedCount: number
  taskCompletionRate: number
  autoResolvedCount: number
  autoResolvedRate: number
  totalTicks: number
}

/** Pairwise comparison between two modes. */
export interface ModeComparison {
  modeA: ControlMode
  modeB: ControlMode
  overrideRateDelta: number
  coherenceRateDelta: number
  summary: string
}

/** A recommendation for which mode to use. */
export interface ModeRecommendation {
  recommendedMode: ControlMode
  reason: string
  confidence: 'low' | 'medium' | 'high'
}

/** Full control mode ROI report. */
export interface ControlModeROIReport {
  perModeMetrics: PerModeMetrics[]
  comparisons: ModeComparison[]
  recommendations: ModeRecommendation[]
  analysisWindow: { startTick: number | null; endTick: number | null }
  totalDecisionsAnalyzed: number
}

/** Shape of trust_outcome audit details relevant to ROI analysis. */
interface TrustOutcomeDetails {
  outcome?: string
  tick: number
  autoResolved?: boolean
}

/** Shape of coherence_issue audit details. */
interface CoherenceIssueDetails {
  tick?: number
}

/** Shape of control_mode_change audit details. */
interface ControlModeChangeDetails {
  previousMode: ControlMode
  newMode: ControlMode
  tick: number
}

const OVERRIDE_OUTCOMES = new Set([
  'human_overrides_agent_decision',
  'human_picks_non_recommended',
  'human_rejects_tool_call',
  'human_modifies_tool_args',
])

const TASK_COMPLETED_OUTCOMES = new Set([
  'task_completed_clean',
  'task_completed_partial',
])

const TASK_ABANDONED_OUTCOMES = new Set([
  'task_abandoned_or_max_turns',
])

const MIN_DECISIONS_FOR_COMPARISON = 5

function isTrustOutcomeDetails(d: unknown): d is TrustOutcomeDetails {
  if (typeof d !== 'object' || d === null) return false
  const obj = d as Record<string, unknown>
  return typeof obj.tick === 'number'
}

function isCoherenceIssueDetails(d: unknown): d is CoherenceIssueDetails {
  if (typeof d !== 'object' || d === null) return false
  return true
}

function isControlModeChangeDetails(d: unknown): d is ControlModeChangeDetails {
  if (typeof d !== 'object' || d === null) return false
  const obj = d as Record<string, unknown>
  return typeof obj.tick === 'number' && typeof obj.newMode === 'string'
}

/**
 * Computes per-control-mode metrics from audit log data to measure
 * the ROI of each mode and generate mode recommendations.
 */
export class ControlModeROIService {
  /**
   * Build mode intervals from control_mode_change audit entries.
   * Returns intervals sorted by startTick.
   */
  buildModeIntervals(
    modeChangeEntries: AuditLogEntry[],
    currentMode: ControlMode,
    currentTick: number,
  ): ModeInterval[] {
    const changes: ControlModeChangeDetails[] = []
    for (const entry of modeChangeEntries) {
      if (entry.entityType !== 'control_mode_change') continue
      if (!isControlModeChangeDetails(entry.details)) continue
      changes.push(entry.details)
    }

    changes.sort((a, b) => a.tick - b.tick)

    if (changes.length === 0) {
      // No mode changes recorded — entire history is the current mode
      // Use null endTick so persisted audit entries beyond currentTick still match
      return [{ mode: currentMode, startTick: 0, endTick: null }]
    }

    const intervals: ModeInterval[] = []

    // Interval from start to first mode change
    intervals.push({
      mode: changes[0].previousMode,
      startTick: 0,
      endTick: changes[0].tick - 1,
    })

    // Intervals between mode changes (last interval is open-ended)
    for (let i = 0; i < changes.length; i++) {
      const nextEnd = i + 1 < changes.length ? changes[i + 1].tick - 1 : null
      intervals.push({
        mode: changes[i].newMode,
        startTick: changes[i].tick,
        endTick: nextEnd,
      })
    }

    return intervals
  }

  /**
   * Determine which mode was active at a given tick.
   */
  modeAtTick(intervals: ModeInterval[], tick: number): ControlMode | null {
    for (const interval of intervals) {
      const end = interval.endTick ?? Infinity
      if (tick >= interval.startTick && tick <= end) {
        return interval.mode
      }
    }
    return null
  }

  /**
   * Analyze control mode ROI from audit log data.
   */
  analyze(
    trustOutcomeEntries: AuditLogEntry[],
    coherenceIssueEntries: AuditLogEntry[],
    intervals: ModeInterval[],
    currentTick = 0,
  ): ControlModeROIReport {
    if (intervals.length === 0) {
      return {
        perModeMetrics: [],
        comparisons: [],
        recommendations: [],
        analysisWindow: { startTick: null, endTick: null },
        totalDecisionsAnalyzed: 0,
      }
    }

    // Accumulators per mode
    const accum = new Map<ControlMode, {
      totalDecisions: number
      overrideCount: number
      coherenceIssueCount: number
      taskCompletedCount: number
      taskAbandonedCount: number
      autoResolvedCount: number
      totalTicks: number
    }>()

    const ensureAccum = (mode: ControlMode) => {
      if (!accum.has(mode)) {
        accum.set(mode, {
          totalDecisions: 0,
          overrideCount: 0,
          coherenceIssueCount: 0,
          taskCompletedCount: 0,
          taskAbandonedCount: 0,
          autoResolvedCount: 0,
          totalTicks: 0,
        })
      }
      return accum.get(mode)!
    }

    // Calculate total ticks per mode from intervals
    for (const interval of intervals) {
      const a = ensureAccum(interval.mode)
      const end = interval.endTick ?? currentTick
      a.totalTicks += Math.max(0, end - interval.startTick + 1)
    }

    // Attribute trust outcomes to modes
    let minTick: number | null = null
    let maxTick: number | null = null
    let totalDecisions = 0

    for (const entry of trustOutcomeEntries) {
      if (entry.entityType !== 'trust_outcome') continue
      if (!isTrustOutcomeDetails(entry.details)) continue

      const { tick, outcome, autoResolved } = entry.details
      const mode = this.modeAtTick(intervals, tick)
      if (!mode) continue

      const a = ensureAccum(mode)
      a.totalDecisions++
      totalDecisions++

      if (minTick === null || tick < minTick) minTick = tick
      if (maxTick === null || tick > maxTick) maxTick = tick

      if (autoResolved) {
        a.autoResolvedCount++
      }

      if (outcome && OVERRIDE_OUTCOMES.has(outcome)) {
        a.overrideCount++
      }
      if (outcome && TASK_COMPLETED_OUTCOMES.has(outcome)) {
        a.taskCompletedCount++
      }
      if (outcome && TASK_ABANDONED_OUTCOMES.has(outcome)) {
        a.taskAbandonedCount++
      }
    }

    // Attribute coherence issues to modes
    for (const entry of coherenceIssueEntries) {
      if (entry.entityType !== 'coherence_issue') continue
      if (entry.action !== 'create') continue
      if (!isCoherenceIssueDetails(entry.details)) continue

      const tick = (entry.details as CoherenceIssueDetails).tick
      if (tick == null) continue

      if (minTick === null || tick < minTick) minTick = tick
      if (maxTick === null || tick > maxTick) maxTick = tick

      const mode = this.modeAtTick(intervals, tick)
      if (!mode) continue

      ensureAccum(mode).coherenceIssueCount++
    }

    // Build per-mode metrics
    const perModeMetrics: PerModeMetrics[] = []
    for (const [mode, a] of accum) {
      const taskTotal = a.taskCompletedCount + a.taskAbandonedCount
      perModeMetrics.push({
        mode,
        totalDecisions: a.totalDecisions,
        overrideCount: a.overrideCount,
        overrideRate: a.totalDecisions > 0 ? a.overrideCount / a.totalDecisions : 0,
        coherenceIssueCount: a.coherenceIssueCount,
        coherenceIssueRate: a.totalDecisions > 0 ? a.coherenceIssueCount / a.totalDecisions : 0,
        taskCompletedCount: a.taskCompletedCount,
        taskAbandonedCount: a.taskAbandonedCount,
        taskCompletionRate: taskTotal > 0 ? a.taskCompletedCount / taskTotal : 0,
        autoResolvedCount: a.autoResolvedCount,
        autoResolvedRate: a.totalDecisions > 0 ? a.autoResolvedCount / a.totalDecisions : 0,
        totalTicks: a.totalTicks,
      })
    }

    // Sort by mode name for deterministic output
    perModeMetrics.sort((a, b) => a.mode.localeCompare(b.mode))

    // Build pairwise comparisons (only between modes with enough data)
    const comparisons = this.buildComparisons(perModeMetrics)

    // Generate recommendations
    const recommendations = this.generateRecommendations(perModeMetrics)

    return {
      perModeMetrics,
      comparisons,
      recommendations,
      analysisWindow: { startTick: minTick, endTick: maxTick },
      totalDecisionsAnalyzed: totalDecisions,
    }
  }

  private buildComparisons(metrics: PerModeMetrics[]): ModeComparison[] {
    const comparisons: ModeComparison[] = []
    const viable = metrics.filter((m) => m.totalDecisions >= MIN_DECISIONS_FOR_COMPARISON)

    for (let i = 0; i < viable.length; i++) {
      for (let j = i + 1; j < viable.length; j++) {
        const a = viable[i]
        const b = viable[j]

        const overrideRateDelta = a.overrideRate - b.overrideRate
        const coherenceRateDelta = a.coherenceIssueRate - b.coherenceIssueRate

        const parts: string[] = []
        if (Math.abs(overrideRateDelta) > 0.05) {
          const higher = overrideRateDelta > 0 ? a.mode : b.mode
          const lower = overrideRateDelta > 0 ? b.mode : a.mode
          parts.push(
            `${higher} had ${(Math.abs(overrideRateDelta) * 100).toFixed(0)}% higher override rate than ${lower}`,
          )
        }
        if (Math.abs(coherenceRateDelta) > 0.05) {
          const higher = coherenceRateDelta > 0 ? a.mode : b.mode
          const lower = coherenceRateDelta > 0 ? b.mode : a.mode
          parts.push(
            `${higher} had ${(Math.abs(coherenceRateDelta) * 100).toFixed(0)}% more coherence issues per decision than ${lower}`,
          )
        }

        comparisons.push({
          modeA: a.mode,
          modeB: b.mode,
          overrideRateDelta,
          coherenceRateDelta,
          summary: parts.length > 0 ? parts.join('; ') : 'No significant differences observed',
        })
      }
    }

    return comparisons
  }

  private generateRecommendations(metrics: PerModeMetrics[]): ModeRecommendation[] {
    const viable = metrics.filter((m) => m.totalDecisions >= MIN_DECISIONS_FOR_COMPARISON)

    if (viable.length === 0) {
      return [{
        recommendedMode: 'adaptive',
        reason: 'Insufficient data across modes — defaulting to adaptive',
        confidence: 'low',
      }]
    }

    if (viable.length === 1) {
      return [{
        recommendedMode: viable[0].mode,
        reason: `Only ${viable[0].mode} has sufficient data (${viable[0].totalDecisions} decisions)`,
        confidence: 'low',
      }]
    }

    // Score each mode: lower override rate + higher completion rate + lower coherence rate = better
    const scored = viable.map((m) => ({
      mode: m.mode,
      // Lower override rate is better (weight: 0.4)
      // Higher completion rate is better (weight: 0.4)
      // Lower coherence issue rate is better (weight: 0.2)
      score: (1 - m.overrideRate) * 0.4 + m.taskCompletionRate * 0.4 + (1 - m.coherenceIssueRate) * 0.2,
      decisions: m.totalDecisions,
    }))

    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]

    const totalDecisions = viable.reduce((sum, m) => sum + m.totalDecisions, 0)
    const confidence: ModeRecommendation['confidence'] =
      totalDecisions >= 50 ? 'high' : totalDecisions >= 20 ? 'medium' : 'low'

    const bestMetrics = viable.find((m) => m.mode === best.mode)!
    const parts: string[] = []
    if (bestMetrics.overrideRate < 0.2) {
      parts.push(`low override rate (${(bestMetrics.overrideRate * 100).toFixed(0)}%)`)
    }
    if (bestMetrics.taskCompletionRate > 0.7) {
      parts.push(`high task completion (${(bestMetrics.taskCompletionRate * 100).toFixed(0)}%)`)
    }

    return [{
      recommendedMode: best.mode,
      reason: parts.length > 0
        ? `${best.mode} performs best: ${parts.join(', ')}`
        : `${best.mode} has the best overall score across ${best.decisions} decisions`,
      confidence,
    }]
  }
}
