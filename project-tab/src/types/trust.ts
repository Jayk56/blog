/**
 * Trust system types.
 *
 * Trust calibration is one of the blog post's open design questions:
 * "The system needs a trust model that varies by domain, task type,
 * and even by the specific agent's track record on similar tasks."
 *
 * Trust trajectories are displayed as sparklines in the Controls workspace,
 * showing how trust in each agent evolves over time (by tick/session).
 * Trust scores directly influence control mode recommendations —
 * higher trust enables more ecosystem-mode operation.
 */

/**
 * A single trust measurement at a point in time.
 * Collected each tick to build trust trajectories.
 */
export interface TrustSnapshot {
  /** The tick this snapshot was taken at. */
  tick: number;
  /** Overall trust score at this tick (0-1). */
  score: number;
  /** Number of tasks completed successfully up to this tick. */
  successCount: number;
  /** Number of times the human overrode this agent's output. */
  overrideCount: number;
  /** Number of times this agent's work needed rework. */
  reworkCount: number;
  /** Total tasks assigned up to this tick. */
  totalTasks: number;
}

/**
 * A trust profile for a single agent. Contains the current score
 * plus the full trajectory for sparkline rendering.
 *
 * "Make trust visible. Show the PM their own trust patterns."
 */
export interface TrustProfile {
  /** ID of the agent this profile belongs to. */
  agentId: string;
  /** Current trust score (0-1). Same as the latest snapshot's score. */
  currentScore: number;
  /** Trend direction based on recent snapshots. */
  trend: 'increasing' | 'stable' | 'decreasing';
  /** Full trajectory of trust snapshots for sparkline rendering. */
  trajectory: TrustSnapshot[];
  /**
   * Breakdown of outcomes by artifact kind. Some agents may be
   * trusted for code but not for documentation, etc.
   *
   * "The system needs a trust model that varies by domain, task type,
   * and even by the specific agent's track record on similar tasks."
   */
  scoreByDomain: Record<string, number>;
}
