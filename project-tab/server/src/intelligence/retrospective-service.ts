import type { AuditLogEntry } from './override-pattern-analyzer'
import { OverridePatternAnalyzer } from './override-pattern-analyzer'

/** Metrics for a single phase window. */
export interface PhaseMetrics {
  totalDecisions: number
  totalOverrides: number
  overrideRate: number
  coherenceIssueCount: number
  artifactUpdates: number
  trustOutcomes: {
    positive: number
    negative: number
    neutral: number
  }
}

/** Comparison of current phase to previous phase. */
export interface MetricsComparison {
  current: PhaseMetrics
  previous: PhaseMetrics | null
  deltas: {
    overrideRateChange: number | null
    coherenceIssueChange: number | null
    decisionVolumeChange: number | null
  }
}

/** A single insight derived from phase data. */
export interface PhaseInsight {
  text: string
  category: 'override' | 'coherence' | 'trust' | 'artifact'
}

/** Full phase retrospective report. */
export interface PhaseRetrospective {
  phaseLabel: string
  summary: string
  metricsComparison: MetricsComparison
  insights: PhaseInsight[]
  suggestedAdjustments: string[]
  analysisWindow: { startTick: number | null; endTick: number | null }
}

/** Minimal store interface for retrospective analysis. */
export interface RetrospectiveStore {
  listAuditLog(entityType?: string, entityId?: string): AuditLogEntry[]
}

/** Details shape for trust_outcome audit entries. */
interface TrustOutcomeDetails {
  outcome: string
  tick: number
  affectedWorkstreams?: string[]
}

/** Details shape for coherence_issue audit entries. */
interface CoherenceIssueDetails {
  tick?: number
}

/** Details shape for artifact_update audit entries. */
interface ArtifactUpdateDetails {
  tick?: number
}

function hasTick(d: unknown): d is { tick: number } {
  return typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).tick === 'number'
}

function hasOutcome(d: unknown): d is TrustOutcomeDetails {
  return typeof d === 'object' && d !== null &&
    typeof (d as Record<string, unknown>).outcome === 'string' &&
    typeof (d as Record<string, unknown>).tick === 'number'
}

const POSITIVE_OUTCOMES = new Set([
  'human_approves_recommended_option',
  'human_approves_always',
  'human_approves_tool_call',
  'task_completed_clean',
  'task_completed_partial',
])

const NEGATIVE_OUTCOMES = new Set([
  'human_overrides_agent_decision',
  'human_picks_non_recommended',
  'human_rejects_tool_call',
  'human_modifies_tool_args',
  'task_abandoned_or_max_turns',
  'error_event',
])

/**
 * Generates phase retrospective reports from audit log data.
 *
 * Analyzes decisions, overrides, coherence issues, and trust outcomes
 * within a tick window to produce summaries, metric comparisons, and
 * actionable insights.
 */
export class RetrospectiveService {
  private readonly overrideAnalyzer = new OverridePatternAnalyzer()

  constructor(private readonly store: RetrospectiveStore) {}

  /**
   * Generate a retrospective for a phase defined by tick boundaries.
   *
   * @param phaseLabel - Human-readable label (e.g., "Phase 2")
   * @param startTick - Inclusive start tick for the phase
   * @param endTick - Inclusive end tick for the phase
   * @param prevStartTick - Optional start tick for the previous phase (for comparison)
   * @param prevEndTick - Optional end tick for the previous phase (for comparison)
   */
  generateRetrospective(
    phaseLabel: string,
    startTick: number,
    endTick: number,
    prevStartTick?: number,
    prevEndTick?: number,
  ): PhaseRetrospective {
    const allAudit = this.store.listAuditLog()

    const currentMetrics = this.computeMetrics(allAudit, startTick, endTick)
    const previousMetrics =
      prevStartTick !== undefined && prevEndTick !== undefined
        ? this.computeMetrics(allAudit, prevStartTick, prevEndTick)
        : null

    const comparison = this.buildComparison(currentMetrics, previousMetrics)
    const insights = this.deriveInsights(allAudit, startTick, endTick, comparison)
    const adjustments = this.suggestAdjustments(comparison, insights)
    const summary = this.buildSummary(phaseLabel, comparison, insights)

    return {
      phaseLabel,
      summary,
      metricsComparison: comparison,
      insights,
      suggestedAdjustments: adjustments,
      analysisWindow: { startTick, endTick },
    }
  }

  // ── Metrics computation ──────────────────────────────────────────

  private computeMetrics(
    allAudit: AuditLogEntry[],
    startTick: number,
    endTick: number,
  ): PhaseMetrics {
    let totalDecisions = 0
    let totalOverrides = 0
    let coherenceIssueCount = 0
    let artifactUpdates = 0
    let positive = 0
    let negative = 0
    let neutral = 0

    for (const entry of allAudit) {
      const details = entry.details
      if (!hasTick(details)) continue
      if (details.tick < startTick || details.tick > endTick) continue

      if (entry.entityType === 'trust_outcome') {
        totalDecisions++
        if (hasOutcome(details)) {
          if (this.isOverride(details.outcome)) {
            totalOverrides++
          }
          if (POSITIVE_OUTCOMES.has(details.outcome)) positive++
          else if (NEGATIVE_OUTCOMES.has(details.outcome)) negative++
          else neutral++
        }
      }

      if (entry.entityType === 'coherence_issue' && entry.action === 'create') {
        coherenceIssueCount++
      }

      if (entry.entityType === 'artifact' && (entry.action === 'update' || entry.action === 'create')) {
        artifactUpdates++
      }
    }

    return {
      totalDecisions,
      totalOverrides,
      overrideRate: totalDecisions > 0 ? totalOverrides / totalDecisions : 0,
      coherenceIssueCount,
      artifactUpdates,
      trustOutcomes: { positive, negative, neutral },
    }
  }

  // ── Comparison ───────────────────────────────────────────────────

  private buildComparison(
    current: PhaseMetrics,
    previous: PhaseMetrics | null,
  ): MetricsComparison {
    return {
      current,
      previous,
      deltas: {
        overrideRateChange: previous !== null
          ? current.overrideRate - previous.overrideRate
          : null,
        coherenceIssueChange: previous !== null
          ? current.coherenceIssueCount - previous.coherenceIssueCount
          : null,
        decisionVolumeChange: previous !== null
          ? current.totalDecisions - previous.totalDecisions
          : null,
      },
    }
  }

  // ── Insights ─────────────────────────────────────────────────────

  private deriveInsights(
    allAudit: AuditLogEntry[],
    startTick: number,
    endTick: number,
    comparison: MetricsComparison,
  ): PhaseInsight[] {
    const insights: PhaseInsight[] = []

    // Override pattern insights
    const phaseAudit = allAudit.filter((e) => {
      if (!hasTick(e.details)) return false
      return e.details.tick >= startTick && e.details.tick <= endTick
    })
    const overrideReport = this.overrideAnalyzer.analyzeOverrides(phaseAudit)

    // Top workstream for overrides
    const wsEntries = Object.entries(overrideReport.overridesByWorkstream)
    if (wsEntries.length > 0) {
      const [topWs, topCount] = wsEntries.sort((a, b) => b[1] - a[1])[0]
      insights.push({
        text: `Most overrides occurred in the "${topWs}" workstream (${topCount} override${topCount !== 1 ? 's' : ''})`,
        category: 'override',
      })
    }

    // Temporal bursts
    if (overrideReport.temporalClusters.length > 0) {
      insights.push({
        text: `${overrideReport.temporalClusters.length} temporal burst(s) of overrides detected`,
        category: 'override',
      })
    }

    // Coherence trend
    if (comparison.deltas.coherenceIssueChange !== null) {
      if (comparison.deltas.coherenceIssueChange > 0) {
        insights.push({
          text: `Coherence issues increased by ${comparison.deltas.coherenceIssueChange} compared to previous phase`,
          category: 'coherence',
        })
      } else if (comparison.deltas.coherenceIssueChange < 0) {
        insights.push({
          text: `Coherence issues decreased by ${Math.abs(comparison.deltas.coherenceIssueChange)} compared to previous phase`,
          category: 'coherence',
        })
      }
    }

    // Trust balance
    const { positive, negative } = comparison.current.trustOutcomes
    if (positive + negative > 0) {
      const posRate = positive / (positive + negative)
      if (posRate < 0.5) {
        insights.push({
          text: `Trust outcomes are majority negative (${negative} negative vs ${positive} positive)`,
          category: 'trust',
        })
      }
    }

    return insights.slice(0, 5) // cap at 5 insights
  }

  // ── Adjustments ──────────────────────────────────────────────────

  private suggestAdjustments(
    comparison: MetricsComparison,
    insights: PhaseInsight[],
  ): string[] {
    const adjustments: string[] = []

    if (comparison.current.overrideRate > 0.3) {
      adjustments.push(
        'Consider increasing escalation requirements — override rate exceeds 30%'
      )
    }

    if (comparison.current.coherenceIssueCount > 3) {
      adjustments.push(
        'Review workstream boundaries — multiple coherence issues suggest overlap'
      )
    }

    if (comparison.deltas.overrideRateChange !== null && comparison.deltas.overrideRateChange > 0.1) {
      adjustments.push(
        'Override rate increased significantly — review agent briefs and constraints'
      )
    }

    const hasNegTrust = insights.some(
      (i) => i.category === 'trust' && i.text.includes('majority negative')
    )
    if (hasNegTrust) {
      adjustments.push(
        'Agents are underperforming on trust — consider tighter tool restrictions or more specific briefs'
      )
    }

    return adjustments
  }

  // ── Summary ──────────────────────────────────────────────────────

  private buildSummary(
    phaseLabel: string,
    comparison: MetricsComparison,
    insights: PhaseInsight[],
  ): string {
    const { current, previous } = comparison
    const parts: string[] = []

    parts.push(
      `${phaseLabel} processed ${current.totalDecisions} decision(s) with an override rate of ${(current.overrideRate * 100).toFixed(0)}%.`
    )

    if (current.coherenceIssueCount > 0) {
      parts.push(
        `${current.coherenceIssueCount} coherence issue(s) were detected.`
      )
    }

    if (previous) {
      if (comparison.deltas.overrideRateChange! > 0) {
        parts.push(
          `Override rate increased from ${(previous.overrideRate * 100).toFixed(0)}% to ${(current.overrideRate * 100).toFixed(0)}%.`
        )
      } else if (comparison.deltas.overrideRateChange! < 0) {
        parts.push(
          `Override rate improved from ${(previous.overrideRate * 100).toFixed(0)}% to ${(current.overrideRate * 100).toFixed(0)}%.`
        )
      }
    }

    if (insights.length > 0) {
      parts.push(`Key finding: ${insights[0].text}.`)
    }

    return parts.join(' ')
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private isOverride(outcome: string): boolean {
    return outcome.includes('override') ||
      outcome === 'human_picks_non_recommended' ||
      outcome === 'human_rejects_tool_call' ||
      outcome === 'human_modifies_tool_args'
  }
}
