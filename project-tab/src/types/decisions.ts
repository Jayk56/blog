/**
 * Decision system types.
 *
 * The decision queue is the heart of human-agent coordination. It surfaces
 * places where agents are blocked on human judgment, prioritized by
 * attention score (severity x confidence x urgency).
 *
 * From the blog post: "a prioritized list of places where human judgment
 * is needed, with context to make the decision quickly."
 */

import type { Severity } from './project.js';

/**
 * How a decision was resolved.
 * - approve: Accept the recommended option
 * - reject: Reject the recommended option, pick an alternative
 * - defer: Postpone the decision
 * - delegate: Let an agent decide (ecosystem mode)
 * - override: Human overrides all options with a custom directive
 */
export type ActionKind =
  | 'approve'
  | 'reject'
  | 'defer'
  | 'delegate'
  | 'override';

/**
 * Category of decision. Different types have different UI treatments
 * and different implications for trust scoring.
 */
export type DecisionType =
  | 'architectural'    // System design choices (David's duplicate dependencies)
  | 'content'          // Tone, framing, creative direction (Maya's controversial topic)
  | 'prioritization'   // What to work on next (Priya's cross-team dependencies)
  | 'quality'          // Accept/reject quality of an output
  | 'coordination'     // Cross-agent or cross-workstream alignment
  | 'risk'             // Security, compliance, safety concerns
  | 'exploratory';     // Research direction, hypothesis selection (Rosa's pathways)

/**
 * A possible action the human can take on a decision. Each decision
 * has 2+ options, one of which may be recommended by the system.
 */
export interface DecisionOption {
  id: string;
  /** Short label shown on the option button, e.g. "Use date-fns". */
  label: string;
  /** Longer explanation of what this option entails. */
  description: string;
  /** What happens downstream if this option is chosen. */
  consequence: string;
  /** Whether the system recommends this option. At most one per decision. */
  recommended: boolean;
  /** The action kind this option maps to. */
  actionKind: ActionKind;
}

/**
 * Blast radius indicates how many artifacts, workstreams, or agents
 * are affected by this decision. Shown as a visual indicator in the
 * decision queue (dot scale or radial).
 */
export interface BlastRadius {
  /** Number of artifacts directly affected. */
  artifactCount: number;
  /** Number of workstreams affected. */
  workstreamCount: number;
  /** Number of agents whose work would change. */
  agentCount: number;
  /** Overall magnitude: small (1-2 things), medium (3-5), large (6+). */
  magnitude: 'small' | 'medium' | 'large';
}

/**
 * A decision item in the queue. This is the central unit of human-agent
 * interaction in the Project tab.
 *
 * "The skill shifts from managing process to evaluating results."
 */
export interface DecisionItem {
  id: string;
  /** Short title shown in the queue list. */
  title: string;
  /** Full context for making the decision. */
  summary: string;
  /** What type of decision this is. */
  type: DecisionType;
  /** How severe/important this decision is. */
  severity: Severity;
  /**
   * System confidence in its recommendation (0-1).
   * Low confidence = human judgment more critical.
   * Shown as a visual bar in the UI.
   */
  confidence: number;
  /** How far the effects of this decision ripple. */
  blastRadius: BlastRadius;
  /** Available actions the human can take. */
  options: DecisionOption[];
  /** IDs of artifacts affected by this decision. */
  affectedArtifactIds: string[];
  /** IDs of workstreams this decision relates to. */
  relatedWorkstreamIds: string[];
  /** Which agent surfaced this decision. */
  sourceAgentId: string;
  /**
   * Attention priority score (0-100). Computed from severity, confidence,
   * urgency, and blast radius. Higher = needs attention sooner.
   * Used to sort the decision queue.
   */
  attentionScore: number;
  /** Whether a rationale is required when resolving this decision. */
  requiresRationale: boolean;
  /** Tick when this decision was created. */
  createdAtTick: number;
  /** Tick by which this decision should be resolved (null = no deadline). */
  dueByTick: number | null;
  /** Whether this decision has been resolved. */
  resolved: boolean;
  /** Resolution details, populated when the decision is acted on. */
  resolution: DecisionResolution | null;
}

/** Captured when a human resolves a decision. */
export interface DecisionResolution {
  /** Which option was chosen. */
  chosenOptionId: string;
  /** The action kind of the chosen option. */
  actionKind: ActionKind;
  /** Human's rationale for the decision (for the audit trail). */
  rationale: string;
  /** Tick when the decision was resolved. */
  resolvedAtTick: number;
  /** Whether this resolution was later reversed. */
  reversed: boolean;
}
