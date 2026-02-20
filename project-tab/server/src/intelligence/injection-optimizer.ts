import type { InjectionRecord } from './context-injection-service'
import type { ControlMode } from '../types/events'

/** Per-reason injection breakdown. */
export interface ReasonBreakdown {
  count: number
  avgOverlapRate: number
}

/** Per-control-mode frequency recommendation. */
export interface ModeRecommendation {
  mode: ControlMode
  currentInterval: number
  suggestedInterval: number
  reason: string
}

/** Full efficiency report for injection analysis. */
export interface InjectionEfficiencyReport {
  totalInjections: number
  avgArtifactsIncluded: number
  avgArtifactsReferenced: number
  overlapRate: number
  unusedArtifactRate: number
  perReasonBreakdown: Record<string, ReasonBreakdown>
  perModeRecommendations: ModeRecommendation[]
  analysisWindow: { firstTick: number; lastTick: number }
}

/** Default periodic intervals per control mode (mirrored from ContextInjectionService). */
const DEFAULT_INTERVALS: Record<ControlMode, number> = {
  orchestrator: 10,
  adaptive: 20,
  ecosystem: 50,
}

/**
 * Analyzes injection efficiency by comparing what artifacts were injected
 * versus what the agent actually referenced in the post-injection window.
 */
export class InjectionOptimizer {
  /**
   * Compute an efficiency report from a set of injection records.
   */
  analyzeEfficiency(records: InjectionRecord[]): InjectionEfficiencyReport {
    if (records.length === 0) {
      return {
        totalInjections: 0,
        avgArtifactsIncluded: 0,
        avgArtifactsReferenced: 0,
        overlapRate: 0,
        unusedArtifactRate: 0,
        perReasonBreakdown: {},
        perModeRecommendations: [],
        analysisWindow: { firstTick: 0, lastTick: 0 },
      }
    }

    // Per-record overlap computation
    const overlapRates: number[] = []
    let totalIncluded = 0
    let totalReferenced = 0

    // Per-reason accumulators
    const reasonAccum: Record<string, { count: number; overlapSum: number }> = {}

    for (const record of records) {
      const included = new Set(record.artifactIdsIncluded)
      const referenced = new Set(record.artifactIdsReferencedInWindow)

      totalIncluded += included.size
      totalReferenced += referenced.size

      // Overlap = |referenced ∩ included| / |included|
      let recordOverlap = 0
      if (included.size > 0) {
        let intersectionCount = 0
        for (const id of referenced) {
          if (included.has(id)) intersectionCount++
        }
        recordOverlap = intersectionCount / included.size
      }
      overlapRates.push(recordOverlap)

      // Accumulate per-reason
      if (!reasonAccum[record.reason]) {
        reasonAccum[record.reason] = { count: 0, overlapSum: 0 }
      }
      reasonAccum[record.reason].count++
      reasonAccum[record.reason].overlapSum += recordOverlap
    }

    const avgOverlap = overlapRates.reduce((a, b) => a + b, 0) / overlapRates.length

    // Build per-reason breakdown
    const perReasonBreakdown: Record<string, ReasonBreakdown> = {}
    for (const [reason, acc] of Object.entries(reasonAccum)) {
      perReasonBreakdown[reason] = {
        count: acc.count,
        avgOverlapRate: acc.count > 0 ? acc.overlapSum / acc.count : 0,
      }
    }

    // Build per-mode recommendations
    const perModeRecommendations = this.generateModeRecommendations(avgOverlap)

    // Analysis window
    const ticks = records.map((r) => r.tick)
    const firstTick = Math.min(...ticks)
    const lastTick = Math.max(...ticks)

    return {
      totalInjections: records.length,
      avgArtifactsIncluded: totalIncluded / records.length,
      avgArtifactsReferenced: totalReferenced / records.length,
      overlapRate: avgOverlap,
      unusedArtifactRate: 1 - avgOverlap,
      perReasonBreakdown,
      perModeRecommendations,
      analysisWindow: { firstTick, lastTick },
    }
  }

  /**
   * Suggest a periodicIntervalTicks adjustment based on overlap rate.
   * High overlap (>80%): decrease interval (inject more often — it's useful).
   * Low overlap (<30%): increase interval (injections mostly wasted).
   * Returns adjusted value clamped to [5, 100].
   */
  suggestInterval(currentInterval: number, overlapRate: number): number {
    let suggested = currentInterval
    if (overlapRate > 0.8) {
      // Useful injections — inject more frequently
      suggested = Math.round(currentInterval * 0.7)
    } else if (overlapRate < 0.3) {
      // Low utility — inject less frequently
      suggested = Math.round(currentInterval * 1.5)
    }
    return Math.max(5, Math.min(100, suggested))
  }

  private generateModeRecommendations(overlapRate: number): ModeRecommendation[] {
    const modes: ControlMode[] = ['orchestrator', 'adaptive', 'ecosystem']
    return modes.map((mode) => {
      const current = DEFAULT_INTERVALS[mode]
      const suggested = this.suggestInterval(current, overlapRate)
      let reason: string
      if (suggested < current) {
        reason = `High overlap (${(overlapRate * 100).toFixed(0)}%) — agents use injected context frequently, decrease interval`
      } else if (suggested > current) {
        reason = `Low overlap (${(overlapRate * 100).toFixed(0)}%) — agents rarely use injected context, increase interval`
      } else {
        reason = `Overlap rate (${(overlapRate * 100).toFixed(0)}%) is within acceptable range, no change needed`
      }
      return { mode, currentInterval: current, suggestedInterval: suggested, reason }
    })
  }
}
