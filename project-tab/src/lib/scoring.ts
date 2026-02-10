/**
 * Scoring functions — pure functions that compute derived metrics
 * from project state. All functions take state (or subsets of it)
 * as input and return numbers.
 *
 * These drive the VitalStrip indicators, decision queue ordering,
 * trust calibration, and mode shift recommendations.
 */

import type {
  DecisionItem,
  CoherenceIssue,
  TrustProfile,
  TrustSnapshot,
  Artifact,
  DecisionLogEntry,
  Severity,
  ProjectState,
  ReviewPattern,
  Metrics,
  CoherenceScore,
} from '../types/index.js';

// ── Severity weights ──────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 5,
  info: 1,
};

// ── Attention Priority ────────────────────────────────────────────

/**
 * Compute attention priority score for a decision (0-100).
 * Higher = needs attention sooner. Used to sort the decision queue.
 *
 * Factors:
 * - Severity (40% weight)
 * - Inverse confidence — low confidence means human judgment is more critical (25%)
 * - Blast radius magnitude (20%)
 * - Urgency — how close to or past the due tick (15%)
 */
export function attentionPriority(
  decision: DecisionItem,
  currentTick: number,
): number {
  // Severity component (0-40)
  const severityScore = SEVERITY_WEIGHT[decision.severity];

  // Confidence component (0-25): lower confidence = higher priority
  const confidenceScore = (1 - decision.confidence) * 25;

  // Blast radius component (0-20)
  const radiusMap = { small: 5, medium: 12, large: 20 } as const;
  const radiusScore = radiusMap[decision.blastRadius.magnitude];

  // Urgency component (0-15): overdue items get max, approaching items get partial
  let urgencyScore = 0;
  if (decision.dueByTick !== null) {
    const ticksRemaining = decision.dueByTick - currentTick;
    if (ticksRemaining <= 0) {
      urgencyScore = 15; // overdue
    } else if (ticksRemaining <= 3) {
      urgencyScore = 15 - ticksRemaining * 3; // approaching
    }
  }

  return Math.min(100, Math.round(severityScore + confidenceScore + radiusScore + urgencyScore));
}

// ── Coherence Score ───────────────────────────────────────────────

/**
 * Compute overall coherence score (0-100) from the set of coherence issues.
 * Starts at 100 and decrements based on open issue severity.
 * Only issues in active states (detected, confirmed, in_progress) count.
 */
export function coherenceScore(issues: CoherenceIssue[]): number {
  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);
  let penalty = 0;

  for (const issue of issues) {
    if (activeStatuses.has(issue.status)) {
      penalty += SEVERITY_WEIGHT[issue.severity];
    }
  }

  return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * Compute coherence trend by comparing current score to a previous score.
 */
export function coherenceTrend(
  currentScore: number,
  previousScore: number,
): 'improving' | 'stable' | 'declining' {
  const delta = currentScore - previousScore;
  if (delta > 2) return 'improving';
  if (delta < -2) return 'declining';
  return 'stable';
}

/**
 * Build a full CoherenceScore object from the set of issues.
 */
export function buildCoherenceScore(
  issues: CoherenceIssue[],
  previousScore: number,
): CoherenceScore {
  const score = coherenceScore(issues);
  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);

  const openIssuesBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const issue of issues) {
    if (activeStatuses.has(issue.status)) {
      openIssuesBySeverity[issue.severity]++;
    }
  }

  return {
    value: score,
    trend: coherenceTrend(score, previousScore),
    openIssuesBySeverity,
  };
}

// ── Rework Risk ───────────────────────────────────────────────────

/**
 * Compute rework risk (0-100) — probability that current work will
 * need to be redone. Based on:
 * - Unresolved high-severity coherence issues (major factor)
 * - Low trust scores across agents
 * - High override/rework rate in decision history
 */
export function reworkRisk(state: ProjectState): number {
  if (!state.project) return 0;

  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);

  // Factor 1: High-severity open coherence issues (0-40)
  const highSeverityIssues = state.coherenceIssues.filter(
    (i) => activeStatuses.has(i.status) && (i.severity === 'critical' || i.severity === 'high'),
  );
  const issueFactor = Math.min(40, highSeverityIssues.length * 10);

  // Factor 2: Low average trust (0-30)
  const avgTrust = averageTrustScore(state.trustProfiles);
  const trustFactor = Math.round((1 - avgTrust) * 30);

  // Factor 3: Override/rework rate from decision log (0-30)
  const resolvedDecisions = state.decisionLog.filter(
    (d) => d.actionKind === 'override' || d.reversed,
  );
  const totalDecisions = state.decisionLog.length;
  const overrideRate = totalDecisions > 0 ? resolvedDecisions.length / totalDecisions : 0;
  const overrideFactor = Math.round(overrideRate * 30);

  return Math.min(100, issueFactor + trustFactor + overrideFactor);
}

// ── Trust Score ───────────────────────────────────────────────────

/**
 * Compute trust score for an agent from their performance history (0-1).
 * Based on success rate minus penalties for overrides and rework.
 *
 * Formula: successRate - (overrideRate * 0.3) - (reworkRate * 0.5)
 * Clamped to [0, 1].
 */
export function trustScore(snapshot: TrustSnapshot): number {
  if (snapshot.totalTasks === 0) return 0.5; // neutral starting point

  const successRate = snapshot.successCount / snapshot.totalTasks;
  const overrideRate = snapshot.overrideCount / snapshot.totalTasks;
  const reworkRate = snapshot.reworkCount / snapshot.totalTasks;

  const score = successRate - overrideRate * 0.3 - reworkRate * 0.5;
  return Math.max(0, Math.min(1, score));
}

/**
 * Compute trust trend from a trajectory of snapshots.
 */
export function trustTrend(
  trajectory: TrustSnapshot[],
): 'increasing' | 'stable' | 'decreasing' {
  if (trajectory.length < 2) return 'stable';

  const recent = trajectory.slice(-3);
  const first = recent[0].score;
  const last = recent[recent.length - 1].score;
  const delta = last - first;

  if (delta > 0.05) return 'increasing';
  if (delta < -0.05) return 'decreasing';
  return 'stable';
}

/**
 * Average trust score across all active agent profiles.
 */
export function averageTrustScore(profiles: TrustProfile[]): number {
  if (profiles.length === 0) return 0.5;
  const sum = profiles.reduce((acc, p) => acc + p.currentScore, 0);
  return sum / profiles.length;
}

// ── High-Severity Miss Rate ───────────────────────────────────────

/**
 * Percentage of high-severity items resolved without human review (0-100).
 * A safety metric — if this is high, the review process isn't catching
 * important issues.
 */
export function highSeverityMissRate(state: ProjectState): number {
  const highSevDecisions = state.decisions.filter(
    (d) => d.resolved && (d.severity === 'critical' || d.severity === 'high'),
  );

  if (highSevDecisions.length === 0) return 0;

  // Count decisions resolved by delegation (agent decided, human didn't review)
  const delegated = highSevDecisions.filter(
    (d) => d.resolution?.actionKind === 'delegate',
  );

  return Math.round((delegated.length / highSevDecisions.length) * 100);
}

// ── Human Intervention Rate ───────────────────────────────────────

/**
 * Percentage of decisions made by humans vs agents (0-100).
 * 100 = all human, 0 = all agent.
 */
export function humanInterventionRate(state: ProjectState): number {
  const resolved = state.decisionLog.filter(
    (d) => d.source === 'human' || d.source === 'agent',
  );

  if (resolved.length === 0) return 0;

  const humanDecisions = resolved.filter((d) => d.source === 'human');
  return Math.round((humanDecisions.length / resolved.length) * 100);
}

// ── Review Patterns ───────────────────────────────────────────────

/**
 * Compute review patterns per artifact kind — the "mirror" that shows
 * the human their own review behavior.
 */
export function computeReviewPatterns(
  artifacts: Artifact[],
  _decisionLog: DecisionLogEntry[],
): ReviewPattern[] {
  // Group artifacts by kind
  const byKind = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    const list = byKind.get(a.kind) ?? [];
    list.push(a);
    byKind.set(a.kind, list);
  }

  const patterns: ReviewPattern[] = [];

  for (const [kind, arts] of byKind) {
    const total = arts.length;
    if (total === 0) continue;

    const reviewed = arts.filter((a) => a.provenance.humanReviewerId !== null);
    const needsRework = arts.filter((a) => a.status === 'needs_rework');

    const reviewRate = Math.round((reviewed.length / total) * 100);
    const reworkRate =
      reviewed.length > 0
        ? Math.round((needsRework.filter((a) => a.provenance.humanReviewerId !== null).length / reviewed.length) * 100)
        : 0;
    const missRate =
      total - reviewed.length > 0
        ? Math.round(
            (needsRework.filter((a) => a.provenance.humanReviewerId === null).length /
              (total - reviewed.length)) *
              100,
          )
        : 0;

    // Suggest: if miss rate is low and review rate is high, suggest reducing
    const suggestedReviewRate =
      missRate < 10 && reviewRate > 60
        ? Math.max(20, reviewRate - 30)
        : reviewRate;

    const suggestion =
      suggestedReviewRate < reviewRate
        ? `You review ${reviewRate}% of ${kind} outputs but the unreviewed miss rate is only ${missRate}%. You could likely reduce to ${suggestedReviewRate}%.`
        : `Current review rate of ${reviewRate}% for ${kind} appears appropriate.`;

    patterns.push({
      artifactKind: kind as Artifact['kind'],
      reviewRate,
      reworkRate,
      missRate,
      suggestedReviewRate,
      suggestion,
    });
  }

  return patterns;
}

// ── Compute All Metrics ───────────────────────────────────────────

/**
 * Compute the full Metrics object from project state.
 * Called after every state mutation to keep derived values current.
 */
export function computeMetrics(state: ProjectState): Metrics {
  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);
  const pendingDecisions = state.decisions.filter((d) => !d.resolved);
  const openIssues = state.coherenceIssues.filter((i) => activeStatuses.has(i.status));

  return {
    coherenceScore: coherenceScore(state.coherenceIssues),
    coherenceTrend: coherenceTrend(
      coherenceScore(state.coherenceIssues),
      state.metrics.coherenceScore,
    ),
    reworkRisk: reworkRisk(state),
    pendingDecisionCount: pendingDecisions.length,
    openCoherenceIssueCount: openIssues.length,
    humanInterventionRate: humanInterventionRate(state),
    highSeverityMissRate: highSeverityMissRate(state),
    averageTrustScore: averageTrustScore(state.trustProfiles),
    totalDecisionCount: state.decisionLog.length,
    totalArtifactCount: state.artifacts.length,
    reviewPatterns: computeReviewPatterns(state.artifacts, state.decisionLog),
  };
}
