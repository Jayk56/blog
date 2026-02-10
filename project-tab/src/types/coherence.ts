/**
 * Coherence tracking types.
 *
 * Coherence is the central challenge when multiple agents produce work
 * independently. From the blog post: "when work is distributed across
 * many agents that don't share context, how do you maintain architectural
 * coherence?"
 *
 * David's duplicate date libraries, API contract drift between frontend
 * and backend agents — these are coherence issues. The system detects them
 * through automated scanning and surfaces them for human resolution.
 */

import type { Severity } from './project.js';

/**
 * Category of coherence issue. Maps to the kinds of inconsistencies
 * that emerge when agents work in parallel without shared context.
 */
export type CoherenceCategory =
  | 'dependency_conflict'    // Duplicate/conflicting libraries (David's Luxon vs date-fns)
  | 'api_contract_drift'     // Frontend/backend interface mismatch
  | 'style_divergence'       // Inconsistent coding patterns, naming conventions
  | 'architectural_drift'    // Deviations from intended system architecture
  | 'data_model_conflict'    // Conflicting data schemas or formats
  | 'cross_cutting_concern'  // Issues spanning multiple workstreams
  | 'constraint_violation';  // Work that violates a declared project constraint

/**
 * Current status of a coherence issue in its lifecycle.
 */
export type CoherenceStatus =
  | 'detected'    // System found the issue, not yet reviewed
  | 'confirmed'   // Human reviewed and confirmed it's a real issue
  | 'in_progress' // Being actively resolved
  | 'resolved'    // Fixed
  | 'accepted'    // Human accepted the inconsistency (tech debt, intentional divergence)
  | 'dismissed';  // False positive, not actually an issue

/**
 * A coherence issue detected between workstreams, agents, or artifacts.
 * These are displayed in the Map workspace as edges in the coherence graph,
 * colored by status (green = healthy, amber = warning, red = blocked).
 */
export interface CoherenceIssue {
  id: string;
  /** Short title describing the inconsistency. */
  title: string;
  /** Detailed description of what's inconsistent and why it matters. */
  description: string;
  /** What kind of coherence problem this is. */
  category: CoherenceCategory;
  /** How severe the inconsistency is. */
  severity: Severity;
  /** Current lifecycle status. */
  status: CoherenceStatus;
  /**
   * IDs of the workstreams involved in the inconsistency.
   * Always at least two — coherence is about relationships.
   */
  workstreamIds: string[];
  /** IDs of agents whose work is involved. */
  agentIds: string[];
  /** IDs of artifacts exhibiting the inconsistency. */
  artifactIds: string[];
  /** System's suggested resolution, if any. */
  suggestedResolution: string | null;
  /** Tick when the issue was detected. */
  detectedAtTick: number;
  /** Tick when the issue was resolved (null if still open). */
  resolvedAtTick: number | null;
}

/**
 * Overall coherence score for the project, computed from the set
 * of active coherence issues weighted by severity. Displayed in
 * the VitalStrip as a persistent indicator.
 */
export interface CoherenceScore {
  /**
   * Aggregate score (0-100). 100 = perfectly coherent.
   * Drops as unresolved issues accumulate.
   */
  value: number;
  /** Trend direction compared to previous tick. */
  trend: 'improving' | 'stable' | 'declining';
  /** Count of open issues by severity for the summary. */
  openIssuesBySeverity: Record<Severity, number>;
}
