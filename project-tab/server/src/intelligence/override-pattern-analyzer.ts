/** Audit log entry shape returned by KnowledgeStore.listAuditLog(). */
export interface AuditLogEntry {
  entityType: string
  entityId: string
  action: string
  callerAgentId?: string
  timestamp: string
  details?: unknown
}

/** A temporal cluster of overrides within a window of ticks. */
export interface TemporalCluster {
  startTick: number
  endTick: number
  count: number
  agentIds: string[]
}

/** Full override pattern analysis report. */
export interface OverridePatternReport {
  overridesByWorkstream: Record<string, number>
  overridesByArtifactKind: Record<string, number>
  overridesByToolCategory: Record<string, number>
  overridesByAgent: Record<string, number>
  temporalClusters: TemporalCluster[]
  totalOverrides: number
  analysisWindow: { startTick: number | null; endTick: number | null }
}

/** Shape of trust_outcome audit log details relevant to override analysis. */
interface TrustOutcomeDetails {
  agentId: string
  outcome: string
  tick: number
  affectedWorkstreams?: string[]
  affectedArtifactKinds?: string[]
  toolName?: string
}

const TEMPORAL_WINDOW_SIZE = 5
const TEMPORAL_BURST_THRESHOLD = 3

function isOverrideOutcome(outcome: string): boolean {
  return outcome.includes('override') || outcome === 'human_picks_non_recommended'
}

function isTrustOutcomeDetails(d: unknown): d is TrustOutcomeDetails {
  if (typeof d !== 'object' || d === null) return false
  const obj = d as Record<string, unknown>
  return typeof obj.outcome === 'string' && typeof obj.tick === 'number'
}

/**
 * Analyzes audit log entries to surface override patterns — where humans
 * disagree with agent recommendations. Groups overrides by workstream,
 * artifact kind, tool category, and agent, and detects temporal bursts.
 */
export class OverridePatternAnalyzer {
  analyzeOverrides(auditRecords: AuditLogEntry[]): OverridePatternReport {
    const overridesByWorkstream: Record<string, number> = {}
    const overridesByArtifactKind: Record<string, number> = {}
    const overridesByToolCategory: Record<string, number> = {}
    const overridesByAgent: Record<string, number> = {}

    const overrideTicks: Array<{ tick: number; agentId: string }> = []
    let minTick: number | null = null
    let maxTick: number | null = null

    for (const entry of auditRecords) {
      if (entry.entityType !== 'trust_outcome') continue
      if (!isTrustOutcomeDetails(entry.details)) continue
      if (!isOverrideOutcome(entry.details.outcome)) continue

      const { agentId, tick, affectedWorkstreams, affectedArtifactKinds, toolName } = entry.details

      // Count by agent
      overridesByAgent[agentId] = (overridesByAgent[agentId] ?? 0) + 1

      // Count by workstream
      if (affectedWorkstreams) {
        for (const ws of affectedWorkstreams) {
          overridesByWorkstream[ws] = (overridesByWorkstream[ws] ?? 0) + 1
        }
      }

      // Count by artifact kind
      if (affectedArtifactKinds) {
        for (const kind of affectedArtifactKinds) {
          overridesByArtifactKind[kind] = (overridesByArtifactKind[kind] ?? 0) + 1
        }
      }

      // Count by tool category
      if (toolName) {
        overridesByToolCategory[toolName] = (overridesByToolCategory[toolName] ?? 0) + 1
      }

      overrideTicks.push({ tick, agentId })

      if (minTick === null || tick < minTick) minTick = tick
      if (maxTick === null || tick > maxTick) maxTick = tick
    }

    // Temporal clustering: group into 5-tick windows
    const temporalClusters = this.buildTemporalClusters(overrideTicks)

    return {
      overridesByWorkstream,
      overridesByArtifactKind,
      overridesByToolCategory,
      overridesByAgent,
      temporalClusters,
      totalOverrides: overrideTicks.length,
      analysisWindow: { startTick: minTick, endTick: maxTick },
    }
  }

  private buildTemporalClusters(
    overrideTicks: Array<{ tick: number; agentId: string }>
  ): TemporalCluster[] {
    if (overrideTicks.length === 0) return []

    // Sort by tick
    const sorted = [...overrideTicks].sort((a, b) => a.tick - b.tick)
    const minTick = sorted[0].tick
    const maxTick = sorted[sorted.length - 1].tick

    const clusters: TemporalCluster[] = []

    for (let windowStart = minTick; windowStart <= maxTick; windowStart += TEMPORAL_WINDOW_SIZE) {
      const windowEnd = windowStart + TEMPORAL_WINDOW_SIZE - 1
      const inWindow = sorted.filter((o) => o.tick >= windowStart && o.tick <= windowEnd)

      if (inWindow.length > TEMPORAL_BURST_THRESHOLD) {
        const agentIds = [...new Set(inWindow.map((o) => o.agentId))]
        clusters.push({
          startTick: windowStart,
          endTick: windowEnd,
          count: inWindow.length,
          agentIds,
        })
      }
    }

    return clusters
  }
}
