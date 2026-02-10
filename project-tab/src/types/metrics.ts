/**
 * Metrics and review pattern types.
 *
 * Metrics track quantitative project health indicators. Review patterns
 * are the "mirror" — showing the human their own review behavior so they
 * can calibrate how much oversight to apply.
 *
 * "Show the PM their own trust patterns — 'You review 95% of code outputs
 * but only 40% of documentation outputs. Your documentation error rate is
 * still low. You could probably review 20% and maintain quality.'"
 */

import type { ArtifactKind } from './artifacts.js';

/**
 * Review pattern analysis for a specific artifact kind.
 * Part of the "mirror" in the Controls workspace.
 */
export interface ReviewPattern {
  /** Which type of artifact this pattern covers. */
  artifactKind: ArtifactKind;
  /** What percentage of outputs of this kind the human reviews (0-100). */
  reviewRate: number;
  /** What percentage of reviewed outputs needed rework (0-100). */
  reworkRate: number;
  /** What percentage of unreviewed outputs had issues found later (0-100). */
  missRate: number;
  /** System suggestion for the review rate, based on observed quality. */
  suggestedReviewRate: number;
  /** Explanation of the suggestion. */
  suggestion: string;
}

/**
 * Aggregate project metrics. Displayed in the VitalStrip and
 * used by the scoring engine to compute attention priorities
 * and mode shift recommendations.
 */
export interface Metrics {
  /**
   * Coherence score (0-100). Aggregate measure of how well
   * agent-produced work fits together. Drops as unresolved
   * coherence issues accumulate.
   */
  coherenceScore: number;
  /** Trend of the coherence score. */
  coherenceTrend: 'improving' | 'stable' | 'declining';

  /**
   * Rework risk (0-100). Probability that current work will need
   * to be redone, based on coherence issues, trust scores, and
   * historical rework rates.
   */
  reworkRisk: number;

  /**
   * Number of decisions awaiting human action.
   */
  pendingDecisionCount: number;

  /**
   * Number of open coherence issues.
   */
  openCoherenceIssueCount: number;

  /**
   * Human intervention rate (0-100). What percentage of agent outputs
   * required human correction or override. Used for trust calibration.
   */
  humanInterventionRate: number;

  /**
   * High-severity miss rate (0-100). Percentage of high-severity
   * issues that were not caught by the review process. A key safety metric.
   */
  highSeverityMissRate: number;

  /**
   * Average trust score across all active agents (0-1).
   */
  averageTrustScore: number;

  /**
   * Total number of decisions made (human + agent + system) since
   * project start. Gives a sense of project complexity/pace.
   */
  totalDecisionCount: number;

  /**
   * Total artifacts produced across all workstreams.
   */
  totalArtifactCount: number;

  /** Review patterns by artifact kind (the "mirror"). */
  reviewPatterns: ReviewPattern[];
}
