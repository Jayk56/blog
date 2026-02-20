import type { TickService } from '../tick'
import type { DecisionEvent, Resolution } from '../types'
import type { ArtifactKind } from '../types/events'

/**
 * Type-safe keys for the trust delta table. Each key corresponds to
 * an outcome in the "Trust score update rules" table from the design doc.
 */
export type TrustOutcome =
  | 'human_approves_recommended_option'    // +2
  | 'human_approves_tool_call'             // +1
  | 'human_approves_always'                // +3
  | 'human_picks_non_recommended'          // -1
  | 'human_modifies_tool_args'             // -1
  | 'human_rejects_tool_call'              // -2
  | 'human_overrides_agent_decision'       // -3
  | 'task_completed_clean'                 // +3
  | 'task_completed_partial'               // +1
  | 'task_abandoned_or_max_turns'          // -1
  | 'error_event'                          // -2

/** Default base delta table per the design doc. */
const DEFAULT_DELTA_TABLE: Record<TrustOutcome, number> = {
  human_approves_recommended_option: 2,
  human_approves_tool_call: 1,
  human_approves_always: 3,
  human_picks_non_recommended: -1,
  human_modifies_tool_args: -1,
  human_rejects_tool_call: -2,
  human_overrides_agent_decision: -3,
  task_completed_clean: 3,
  task_completed_partial: 1,
  task_abandoned_or_max_turns: -1,
  error_event: -2
}

/** Configuration for the trust engine, all parameters tunable per-project. */
export interface TrustCalibrationConfig {
  initialScore: number
  floorScore: number
  ceilingScore: number
  decayTargetScore: number
  decayRatePerTick: number
  diminishingReturnThresholdHigh: number
  diminishingReturnThresholdLow: number
  deltaTable: Partial<Record<TrustOutcome, number>>
  calibrationMode: boolean
  /** Max score an inactive agent can retain. Applied after normal decay when agent idle > inactivityThresholdTicks. */
  decayCeiling: number
  /** Number of ticks of inactivity before decayCeiling is enforced. */
  inactivityThresholdTicks: number
  /** Whether risk-weighted deltas are enabled. */
  riskWeightingEnabled: boolean
  /** Multipliers per blast-radius level for positive trust deltas. */
  riskWeightMap: Record<string, number>
}

/** Default risk-weight multipliers per blast-radius level. */
const DEFAULT_RISK_WEIGHT_MAP: Record<string, number> = {
  trivial: 0.5,
  small: 0.75,
  medium: 1.0,
  large: 1.5,
  unknown: 1.0
}

/** Defaults matching the design doc. */
const DEFAULT_CONFIG: TrustCalibrationConfig = {
  initialScore: 50,
  floorScore: 10,
  ceilingScore: 100,
  decayTargetScore: 50,
  decayRatePerTick: 0.01,
  diminishingReturnThresholdHigh: 90,
  diminishingReturnThresholdLow: 20,
  deltaTable: {},
  calibrationMode: false,
  decayCeiling: 50,
  inactivityThresholdTicks: 0,
  riskWeightingEnabled: false,
  riskWeightMap: { ...DEFAULT_RISK_WEIGHT_MAP }
}

/** Per-agent trust state tracked internally. */
interface AgentTrustState {
  score: number
  lastActivityTick: number
  decayAccumulator: number
  /** Per-domain trust scores, lazily initialized on first domain outcome. */
  domainScores: Map<ArtifactKind, number>
  /** Per-domain decay accumulators, mirrors decayAccumulator logic per-domain. */
  domainDecayAccumulators: Map<ArtifactKind, number>
  /** Per-domain last activity tick for independent decay. */
  domainLastActivityTick: Map<ArtifactKind, number>
}

/** Calibration log entry emitted when calibrationMode is true. */
export interface CalibrationLogEntry {
  agentId: string
  outcome: TrustOutcome
  baseDelta: number
  effectiveDelta: number
  wouldBeScore: number
  currentScore: number
  timestamp: string
}

/** Optional context attached to trust outcomes for future domain-specific analysis. */
export interface TrustOutcomeContext {
  artifactKinds?: ArtifactKind[]
  workstreams?: string[]
  toolCategory?: string
  blastRadius?: string
}

/** Domain-tagged trust outcome record for deferred analysis. */
export interface DomainOutcomeRecord {
  agentId: string
  outcome: TrustOutcome
  effectiveDelta: number
  tick: number
  artifactKinds: ArtifactKind[]
  workstreams: string[]
  toolCategory?: string
  timestamp: string
}

/** Maps a resolution + decision event to a TrustOutcome for the trust engine. */
export function mapResolutionToTrustOutcome(
  resolution: Resolution,
  event: DecisionEvent
): TrustOutcome | null {
  if (resolution.type === 'option') {
    if (event.subtype === 'option' && event.recommendedOptionId) {
      if (resolution.chosenOptionId === event.recommendedOptionId) {
        return 'human_approves_recommended_option'
      }
      return 'human_picks_non_recommended'
    }
    return 'human_approves_recommended_option'
  }

  if (resolution.type === 'tool_approval') {
    if (resolution.action === 'approve') {
      if (resolution.alwaysApprove) {
        return 'human_approves_always'
      }
      return 'human_approves_tool_call'
    }
    if (resolution.action === 'reject') {
      return 'human_rejects_tool_call'
    }
    if (resolution.action === 'modify') {
      return 'human_modifies_tool_args'
    }
  }

  return null
}

/**
 * TrustEngine tracks per-agent trust scores, applies deltas from decision
 * resolutions and completions, decays inactive agents toward baseline,
 * and supports a calibration mode for tuning.
 */
export class TrustEngine {
  private config: TrustCalibrationConfig
  private readonly agents = new Map<string, AgentTrustState>()
  private readonly calibrationLog: CalibrationLogEntry[] = []
  private readonly domainOutcomeLogs = new Map<string, DomainOutcomeRecord[]>()
  private tickHandler: ((tick: number) => void) | null = null

  constructor(config: Partial<TrustCalibrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Reconfigure the engine at runtime. Existing agent scores are preserved. */
  reconfigure(config: Partial<TrustCalibrationConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Subscribe to tick service for decay processing. */
  subscribeTo(tickService: TickService): void {
    this.tickHandler = (tick: number) => this.onTick(tick)
    tickService.onTick(this.tickHandler)
  }

  /** Unsubscribe from tick service. */
  unsubscribeFrom(tickService: TickService): void {
    if (this.tickHandler) {
      tickService.removeOnTick(this.tickHandler)
      this.tickHandler = null
    }
  }

  /** Returns the current config (read-only snapshot). */
  getConfig(): Readonly<TrustCalibrationConfig> {
    return { ...this.config }
  }

  /** Register an agent with the initial trust score. */
  registerAgent(agentId: string, currentTick = 0): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        score: this.config.initialScore,
        lastActivityTick: currentTick,
        decayAccumulator: 0,
        domainScores: new Map(),
        domainDecayAccumulators: new Map(),
        domainLastActivityTick: new Map(),
      })
    }
  }

  /** Get the trust score for an agent. Returns undefined if agent not registered. */
  getScore(agentId: string): number | undefined {
    return this.agents.get(agentId)?.score
  }

  /** Get all trust scores as an array suitable for StateSyncMessage. */
  getAllScores(): Array<{ agentId: string; score: number }> {
    const result: Array<{ agentId: string; score: number }> = []
    for (const [agentId, state] of this.agents) {
      result.push({ agentId, score: state.score })
    }
    return result
  }

  /** Remove an agent from tracking (e.g., after kill). */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId)
    this.domainOutcomeLogs.delete(agentId)
  }

  /**
   * Apply a trust outcome delta to an agent's score.
   * Returns the effective delta applied (after diminishing returns).
   * In calibration mode, logs but does not mutate.
   */
  applyOutcome(
    agentId: string,
    outcome: TrustOutcome,
    currentTick = 0,
    context?: TrustOutcomeContext
  ): number {
    const state = this.agents.get(agentId)
    if (!state) {
      return 0
    }

    const baseDelta = this.getBaseDelta(outcome)
    const riskAdjustedDelta = this.config.riskWeightingEnabled && context?.blastRadius
      ? this.applyRiskWeighting(baseDelta, context.blastRadius)
      : baseDelta
    const effectiveDelta = this.applyDiminishingReturns(state.score, riskAdjustedDelta)

    if (this.config.calibrationMode) {
      const wouldBeScore = this.clamp(state.score + effectiveDelta)
      this.calibrationLog.push({
        agentId,
        outcome,
        baseDelta,
        effectiveDelta,
        wouldBeScore,
        currentScore: state.score,
        timestamp: new Date().toISOString()
      })
      this.recordDomainOutcome(agentId, outcome, effectiveDelta, currentTick, context)
      return effectiveDelta
    }

    const previousScore = state.score
    state.score = this.clamp(state.score + effectiveDelta)
    state.lastActivityTick = currentTick
    state.decayAccumulator = 0
    this.updateDomainScores(state, riskAdjustedDelta, currentTick, context)
    this.recordDomainOutcome(agentId, outcome, state.score - previousScore, currentTick, context)

    return state.score - previousScore
  }

  /** Returns and clears buffered domain outcomes for an agent. */
  flushDomainLog(agentId: string): DomainOutcomeRecord[] {
    const records = this.domainOutcomeLogs.get(agentId) ?? []
    this.domainOutcomeLogs.delete(agentId)
    return records
  }

  /** Returns the calibration log entries (only populated when calibrationMode is true). */
  getCalibrationLog(): readonly CalibrationLogEntry[] {
    return this.calibrationLog
  }

  /** Clears the calibration log. */
  clearCalibrationLog(): void {
    this.calibrationLog.length = 0
  }

  /** Get all domain scores for an agent. Returns empty map if agent not registered or no domain outcomes yet. */
  getDomainScores(agentId: string): Map<ArtifactKind, number> {
    const state = this.agents.get(agentId)
    if (!state) return new Map()
    return new Map(state.domainScores)
  }

  /** Get a single domain score for an agent. Returns undefined if agent not registered or domain not tracked. */
  getDomainScore(agentId: string, kind: ArtifactKind): number | undefined {
    return this.agents.get(agentId)?.domainScores.get(kind)
  }

  /** Get all domain scores for all agents. */
  getAllDomainScores(): Array<{ agentId: string; domainScores: Record<ArtifactKind, number> }> {
    const result: Array<{ agentId: string; domainScores: Record<ArtifactKind, number> }> = []
    for (const [agentId, state] of this.agents) {
      if (state.domainScores.size > 0) {
        const domainScores = Object.fromEntries(state.domainScores) as Record<ArtifactKind, number>
        result.push({ agentId, domainScores })
      }
    }
    return result
  }

  /** Look up the base delta for an outcome, honoring config overrides. */
  private getBaseDelta(outcome: TrustOutcome): number {
    return this.config.deltaTable[outcome] ?? DEFAULT_DELTA_TABLE[outcome]
  }

  /**
   * Apply risk weighting to a trust delta based on blast radius.
   * Only positive deltas (trust gains) are weighted — negative deltas pass through unchanged
   * to prevent reducing trust-loss severity for high-risk actions.
   */
  applyRiskWeighting(baseDelta: number, blastRadius: string): number {
    if (baseDelta <= 0) return baseDelta
    const weight = this.config.riskWeightMap[blastRadius] ?? this.config.riskWeightMap['unknown'] ?? 1.0
    return Math.floor(baseDelta * weight)
  }

  /**
   * Apply diminishing returns at extremes.
   * When score > threshold_high or score < threshold_low, deltas are halved
   * (rounded toward zero).
   */
  private applyDiminishingReturns(currentScore: number, delta: number): number {
    const { diminishingReturnThresholdHigh, diminishingReturnThresholdLow } = this.config

    // At high extreme, positive deltas are halved
    if (currentScore > diminishingReturnThresholdHigh && delta > 0) {
      return Math.floor(delta / 2)
    }

    // At low extreme, negative deltas are halved (toward zero)
    if (currentScore < diminishingReturnThresholdLow && delta < 0) {
      return Math.ceil(delta / 2)
    }

    return delta
  }

  /** Clamp a score to [floor, ceiling]. */
  private clamp(score: number): number {
    return Math.max(this.config.floorScore, Math.min(this.config.ceilingScore, score))
  }

  /**
   * Tick handler for decay processing.
   * Each tick, accumulate decay for inactive agents. When the accumulator
   * reaches the threshold (1 / decayRatePerTick), apply 1 point of decay
   * toward the baseline.
   */
  private onTick(tick: number): void {
    for (const [, state] of this.agents) {
      // Global score decay
      if (state.lastActivityTick < tick) {
        state.decayAccumulator += this.config.decayRatePerTick

        if (state.decayAccumulator >= 1) {
          state.decayAccumulator -= 1

          // When agent has been idle long enough, use the lower of decayTarget and decayCeiling
          // as the convergence point so the agent decays past baseline down to the ceiling.
          const idleTicks = tick - state.lastActivityTick
          const effectiveTarget = idleTicks > this.config.inactivityThresholdTicks
            ? Math.max(this.config.floorScore, Math.min(this.config.decayTargetScore, this.config.decayCeiling))
            : this.config.decayTargetScore

          if (state.score > effectiveTarget) {
            state.score = Math.max(effectiveTarget, state.score - 1)
          } else if (state.score < effectiveTarget) {
            state.score = Math.min(effectiveTarget, state.score + 1)
          }
        }
      }

      // Per-domain score decay (same rate, independent per domain)
      for (const [kind, domainScore] of state.domainScores) {
        const domainLastActivity = state.domainLastActivityTick.get(kind) ?? 0
        if (domainLastActivity < tick) {
          const acc = (state.domainDecayAccumulators.get(kind) ?? 0) + this.config.decayRatePerTick
          state.domainDecayAccumulators.set(kind, acc)

          if (acc >= 1) {
            state.domainDecayAccumulators.set(kind, acc - 1)
            const target = this.config.decayTargetScore

            if (domainScore > target) {
              state.domainScores.set(kind, Math.max(target, domainScore - 1))
            } else if (domainScore < target) {
              state.domainScores.set(kind, Math.min(target, domainScore + 1))
            }
          }
        }
      }
    }
  }

  /** Update per-domain scores when context includes artifactKinds. Takes the pre-diminished delta so each domain applies its own diminishing returns. */
  private updateDomainScores(
    state: AgentTrustState,
    riskAdjustedDelta: number,
    currentTick: number,
    context?: TrustOutcomeContext
  ): void {
    if (!context?.artifactKinds?.length) return

    for (const kind of context.artifactKinds) {
      // Lazy initialization: create domain score on first outcome
      if (!state.domainScores.has(kind)) {
        state.domainScores.set(kind, this.config.initialScore)
        state.domainDecayAccumulators.set(kind, 0)
        state.domainLastActivityTick.set(kind, currentTick)
      }

      const current = state.domainScores.get(kind)!
      const domainDelta = this.applyDiminishingReturns(current, riskAdjustedDelta)
      state.domainScores.set(kind, this.clamp(current + domainDelta))
      state.domainDecayAccumulators.set(kind, 0)
      state.domainLastActivityTick.set(kind, currentTick)
    }
  }

  private recordDomainOutcome(
    agentId: string,
    outcome: TrustOutcome,
    effectiveDelta: number,
    tick: number,
    context?: TrustOutcomeContext
  ): void {
    if (!context) return
    if (!context.artifactKinds?.length && !context.workstreams?.length && !context.toolCategory) return

    const list = this.domainOutcomeLogs.get(agentId) ?? []
    list.push({
      agentId,
      outcome,
      effectiveDelta,
      tick,
      artifactKinds: [...(context.artifactKinds ?? [])],
      workstreams: [...(context.workstreams ?? [])],
      toolCategory: context.toolCategory,
      timestamp: new Date().toISOString(),
    })
    this.domainOutcomeLogs.set(agentId, list)
  }
}
