import type { TickService } from '../tick'
import type { DecisionEvent, Resolution } from '../types'

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
  calibrationMode: false
}

/** Per-agent trust state tracked internally. */
interface AgentTrustState {
  score: number
  lastActivityTick: number
  decayAccumulator: number
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
  private readonly config: TrustCalibrationConfig
  private readonly agents = new Map<string, AgentTrustState>()
  private readonly calibrationLog: CalibrationLogEntry[] = []
  private tickHandler: ((tick: number) => void) | null = null

  constructor(config: Partial<TrustCalibrationConfig> = {}) {
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
        decayAccumulator: 0
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
  }

  /**
   * Apply a trust outcome delta to an agent's score.
   * Returns the effective delta applied (after diminishing returns).
   * In calibration mode, logs but does not mutate.
   */
  applyOutcome(agentId: string, outcome: TrustOutcome, currentTick = 0): number {
    const state = this.agents.get(agentId)
    if (!state) {
      return 0
    }

    const baseDelta = this.getBaseDelta(outcome)
    const effectiveDelta = this.applyDiminishingReturns(state.score, baseDelta)

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
      return effectiveDelta
    }

    const previousScore = state.score
    state.score = this.clamp(state.score + effectiveDelta)
    state.lastActivityTick = currentTick
    state.decayAccumulator = 0

    return state.score - previousScore
  }

  /** Returns the calibration log entries (only populated when calibrationMode is true). */
  getCalibrationLog(): readonly CalibrationLogEntry[] {
    return this.calibrationLog
  }

  /** Clears the calibration log. */
  clearCalibrationLog(): void {
    this.calibrationLog.length = 0
  }

  /** Look up the base delta for an outcome, honoring config overrides. */
  private getBaseDelta(outcome: TrustOutcome): number {
    return this.config.deltaTable[outcome] ?? DEFAULT_DELTA_TABLE[outcome]
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
      if (state.lastActivityTick < tick) {
        state.decayAccumulator += this.config.decayRatePerTick

        if (state.decayAccumulator >= 1) {
          state.decayAccumulator -= 1

          if (state.score > this.config.decayTargetScore) {
            state.score = Math.max(this.config.decayTargetScore, state.score - 1)
          } else if (state.score < this.config.decayTargetScore) {
            state.score = Math.min(this.config.decayTargetScore, state.score + 1)
          }
        }
      }
    }
  }
}
