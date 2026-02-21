import type { AuditLogEntry } from './override-pattern-analyzer'

/** Classification of what caused the rework. */
export type ReworkCause =
  | 'coherence_driven'
  | 'override_driven'
  | 'cascade'
  | 'voluntary_improvement'

/** A single causal link for an artifact update. */
export interface ReworkCausalLink {
  artifactId: string
  updateTick: number
  cause: ReworkCause
  triggerEntityId: string | null
  triggerTick: number | null
  description: string
}

/** Aggregate rework statistics. */
export interface ReworkAggregate {
  coherenceDriven: number
  overrideDriven: number
  cascade: number
  voluntaryImprovement: number
  total: number
}

/** Full rework causal analysis report. */
export interface ReworkCausalReport {
  links: ReworkCausalLink[]
  aggregate: ReworkAggregate
  aggregateRates: {
    coherenceDrivenRate: number
    overrideDrivenRate: number
    cascadeRate: number
    voluntaryImprovementRate: number
  }
  analysisWindow: { startTick: number | null; endTick: number | null }
}

/** Minimal store interface for rework analysis. */
export interface ReworkAnalysisStore {
  listAuditLog(entityType?: string, entityId?: string): AuditLogEntry[]
}

/** Details shape for artifact audit entries with tick. */
interface ArtifactAuditDetails {
  tick: number
  artifactId?: string
  workstream?: string
}

/** Details shape for coherence issue audit entries. */
interface CoherenceAuditDetails {
  tick: number
  affectedArtifactIds?: string[]
  issueId?: string
}

/** Details shape for override audit entries. */
interface OverrideAuditDetails {
  tick: number
  outcome: string
  affectedArtifactIds?: string[]
}

function hasTick(d: unknown): d is { tick: number } {
  return typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).tick === 'number'
}

// How many ticks back to look for a causal trigger before an artifact update
const LOOKBACK_WINDOW = 10

/**
 * Traces artifact rework (multiple updates) to upstream causes:
 * coherence issues, human overrides, cascade from dependency changes,
 * or voluntary improvements.
 *
 * Operates on audit log data — no database queries needed.
 */
export class ReworkCausalLinker {
  /**
   * Analyze audit log entries to produce a rework causal report.
   * Identifies artifact updates that have identifiable upstream triggers.
   */
  analyzeRework(auditRecords: AuditLogEntry[]): ReworkCausalReport {
    // Step 1: Collect all artifact update events with ticks
    const artifactUpdates = this.collectArtifactUpdates(auditRecords)
    if (artifactUpdates.length === 0) {
      return this.emptyReport()
    }

    // Step 2: Collect coherence issues indexed by affected artifact + tick
    const coherenceEvents = this.collectCoherenceEvents(auditRecords)

    // Step 3: Collect override events indexed by affected artifact + tick
    const overrideEvents = this.collectOverrideEvents(auditRecords)

    // Step 4: Collect all artifact update ticks for cascade detection
    const allUpdateTicks = this.buildArtifactUpdateMap(artifactUpdates)

    // Step 5: For each artifact update, find the cause
    const links: ReworkCausalLink[] = []
    const aggregate: ReworkAggregate = {
      coherenceDriven: 0,
      overrideDriven: 0,
      cascade: 0,
      voluntaryImprovement: 0,
      total: 0,
    }

    for (const update of artifactUpdates) {
      const link = this.classifyUpdate(
        update,
        coherenceEvents,
        overrideEvents,
        allUpdateTicks,
      )
      links.push(link)
      aggregate.total++
      aggregate[this.aggregateKey(link.cause)]++
    }

    const total = aggregate.total || 1
    const ticks = artifactUpdates.map((u) => u.tick)

    return {
      links,
      aggregate,
      aggregateRates: {
        coherenceDrivenRate: aggregate.coherenceDriven / total,
        overrideDrivenRate: aggregate.overrideDriven / total,
        cascadeRate: aggregate.cascade / total,
        voluntaryImprovementRate: aggregate.voluntaryImprovement / total,
      },
      analysisWindow: {
        startTick: Math.min(...ticks),
        endTick: Math.max(...ticks),
      },
    }
  }

  // ── Collection ───────────────────────────────────────────────────

  private collectArtifactUpdates(
    records: AuditLogEntry[],
  ): Array<{ artifactId: string; tick: number }> {
    const updates: Array<{ artifactId: string; tick: number }> = []
    for (const entry of records) {
      if (entry.entityType !== 'artifact') continue
      if (entry.action !== 'update') continue
      if (!hasTick(entry.details)) continue
      const details = entry.details as ArtifactAuditDetails
      const artifactId = details.artifactId ?? entry.entityId
      updates.push({ artifactId, tick: details.tick })
    }
    return updates.sort((a, b) => a.tick - b.tick)
  }

  private collectCoherenceEvents(
    records: AuditLogEntry[],
  ): Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }> {
    const events: Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }> = []
    for (const entry of records) {
      if (entry.entityType !== 'coherence_issue') continue
      if (entry.action !== 'create') continue
      if (!hasTick(entry.details)) continue
      const details = entry.details as CoherenceAuditDetails
      events.push({
        tick: details.tick,
        affectedArtifactIds: Array.isArray(details.affectedArtifactIds) ? details.affectedArtifactIds : [],
        entityId: details.issueId ?? entry.entityId,
      })
    }
    return events
  }

  private collectOverrideEvents(
    records: AuditLogEntry[],
  ): Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }> {
    const events: Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }> = []
    for (const entry of records) {
      if (entry.entityType !== 'trust_outcome') continue
      if (!hasTick(entry.details)) continue
      const details = entry.details as OverrideAuditDetails
      if (!this.isOverrideOutcome(details.outcome)) continue
      events.push({
        tick: details.tick,
        affectedArtifactIds: Array.isArray(details.affectedArtifactIds) ? details.affectedArtifactIds : [],
        entityId: entry.entityId,
      })
    }
    return events
  }

  private buildArtifactUpdateMap(
    updates: Array<{ artifactId: string; tick: number }>,
  ): Map<string, number[]> {
    const map = new Map<string, number[]>()
    for (const u of updates) {
      const ticks = map.get(u.artifactId) ?? []
      ticks.push(u.tick)
      map.set(u.artifactId, ticks)
    }
    return map
  }

  // ── Classification ───────────────────────────────────────────────

  private classifyUpdate(
    update: { artifactId: string; tick: number },
    coherenceEvents: Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }>,
    overrideEvents: Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }>,
    allUpdateTicks: Map<string, number[]>,
  ): ReworkCausalLink {
    // Priority 1: Coherence-driven — a coherence issue affecting this artifact
    // occurred within LOOKBACK_WINDOW ticks before this update
    const coherenceTrigger = this.findTrigger(
      update,
      coherenceEvents,
    )
    if (coherenceTrigger) {
      return {
        artifactId: update.artifactId,
        updateTick: update.tick,
        cause: 'coherence_driven',
        triggerEntityId: coherenceTrigger.entityId,
        triggerTick: coherenceTrigger.tick,
        description: `Updated after coherence issue ${coherenceTrigger.entityId} at tick ${coherenceTrigger.tick}`,
      }
    }

    // Priority 2: Override-driven — a human override affecting this artifact
    // occurred within LOOKBACK_WINDOW ticks before this update
    const overrideTrigger = this.findTrigger(
      update,
      overrideEvents,
    )
    if (overrideTrigger) {
      return {
        artifactId: update.artifactId,
        updateTick: update.tick,
        cause: 'override_driven',
        triggerEntityId: overrideTrigger.entityId,
        triggerTick: overrideTrigger.tick,
        description: `Updated after human override ${overrideTrigger.entityId} at tick ${overrideTrigger.tick}`,
      }
    }

    // Priority 3: Cascade — another artifact was updated within
    // LOOKBACK_WINDOW ticks before this update
    const cascadeTrigger = this.findCascadeTrigger(update, allUpdateTicks)
    if (cascadeTrigger) {
      return {
        artifactId: update.artifactId,
        updateTick: update.tick,
        cause: 'cascade',
        triggerEntityId: cascadeTrigger.artifactId,
        triggerTick: cascadeTrigger.tick,
        description: `Updated after artifact "${cascadeTrigger.artifactId}" changed at tick ${cascadeTrigger.tick}`,
      }
    }

    // Default: Voluntary improvement
    return {
      artifactId: update.artifactId,
      updateTick: update.tick,
      cause: 'voluntary_improvement',
      triggerEntityId: null,
      triggerTick: null,
      description: 'No identifiable upstream trigger — likely voluntary improvement',
    }
  }

  /**
   * Find the closest trigger event within the lookback window that
   * affects the target artifact.
   */
  private findTrigger(
    update: { artifactId: string; tick: number },
    events: Array<{ tick: number; affectedArtifactIds: string[]; entityId: string }>,
  ): { entityId: string; tick: number } | null {
    let best: { entityId: string; tick: number } | null = null

    for (const event of events) {
      if (event.tick >= update.tick) continue
      if (event.tick < update.tick - LOOKBACK_WINDOW) continue
      if (!event.affectedArtifactIds.includes(update.artifactId)) continue

      // Take the closest event (highest tick that's still <= updateTick)
      if (!best || event.tick > best.tick) {
        best = { entityId: event.entityId, tick: event.tick }
      }
    }

    return best
  }

  /**
   * Find a cascade trigger: another artifact updated within the lookback
   * window before this update.
   */
  private findCascadeTrigger(
    update: { artifactId: string; tick: number },
    allUpdateTicks: Map<string, number[]>,
  ): { artifactId: string; tick: number } | null {
    let best: { artifactId: string; tick: number } | null = null

    for (const [artId, ticks] of allUpdateTicks) {
      if (artId === update.artifactId) continue
      for (const t of ticks) {
        if (t >= update.tick) continue
        if (t < update.tick - LOOKBACK_WINDOW) continue
        if (!best || t > best.tick) {
          best = { artifactId: artId, tick: t }
        }
      }
    }

    return best
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private isOverrideOutcome(outcome: string): boolean {
    return typeof outcome === 'string' &&
      (outcome.includes('override') ||
       outcome === 'human_picks_non_recommended' ||
       outcome === 'human_rejects_tool_call' ||
       outcome === 'human_modifies_tool_args')
  }

  private aggregateKey(cause: ReworkCause): keyof Omit<ReworkAggregate, 'total'> {
    const map: Record<ReworkCause, keyof Omit<ReworkAggregate, 'total'>> = {
      coherence_driven: 'coherenceDriven',
      override_driven: 'overrideDriven',
      cascade: 'cascade',
      voluntary_improvement: 'voluntaryImprovement',
    }
    return map[cause]
  }

  private emptyReport(): ReworkCausalReport {
    return {
      links: [],
      aggregate: {
        coherenceDriven: 0,
        overrideDriven: 0,
        cascade: 0,
        voluntaryImprovement: 0,
        total: 0,
      },
      aggregateRates: {
        coherenceDrivenRate: 0,
        overrideDrivenRate: 0,
        cascadeRate: 0,
        voluntaryImprovementRate: 0,
      },
      analysisWindow: { startTick: null, endTick: null },
    }
  }
}
