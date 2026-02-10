/**
 * Timeline and decision log types.
 *
 * The timeline captures everything that happens in the project —
 * agent actions, human decisions, system events, coherence detections.
 * It serves as the project's institutional memory.
 *
 * "Every decision, both human and agent, is logged with context so the
 * project has an institutional memory that any participant can query."
 *
 * The decision log (displayed in the Controls workspace) is a filtered
 * view of the timeline showing only decision-related events.
 */

import type { ActionKind } from './decisions.js';
import type { Severity } from './project.js';

/**
 * Who or what produced this timeline event.
 */
export type EventSource =
  | 'human'     // Direct human action
  | 'agent'     // Agent-produced event
  | 'system';   // Automated system event (coherence scan, mode shift, etc.)

/**
 * Category of timeline event. Used for filtering and display.
 */
export type EventCategory =
  | 'decision_created'      // A new decision was surfaced
  | 'decision_resolved'     // A decision was acted on
  | 'decision_reversed'     // A previous decision was undone
  | 'artifact_produced'     // An agent produced a new artifact
  | 'artifact_updated'      // An existing artifact was modified
  | 'coherence_detected'    // The system found a coherence issue
  | 'coherence_resolved'    // A coherence issue was resolved
  | 'mode_changed'          // Control mode was changed
  | 'phase_changed'         // Project phase advanced
  | 'emergency_brake'       // Emergency brake engaged/disengaged
  | 'context_injected'      // Human pushed new context to agents
  | 'checkpoint_reached'    // A checkpoint gate was hit
  | 'agent_activity'        // General agent work (for the activity feed)
  | 'trust_changed';        // Trust score significantly shifted

/**
 * A single event in the project timeline.
 */
export interface TimelineEvent {
  id: string;
  /** When this event occurred (tick number). */
  tick: number;
  /** Who or what produced this event. */
  source: EventSource;
  /** If source is 'agent', which agent. */
  agentId: string | null;
  /** Event category for filtering. */
  category: EventCategory;
  /** Severity level (for visual treatment in the timeline). */
  severity: Severity;
  /** Short title for the event. */
  title: string;
  /** Detailed description of what happened. */
  description: string;
  /** IDs of related artifacts. */
  relatedArtifactIds: string[];
  /** IDs of related decisions. */
  relatedDecisionIds: string[];
  /** IDs of related coherence issues. */
  relatedCoherenceIssueIds: string[];
}

/**
 * An entry in the decision log. This is a projection of timeline events
 * filtered to decision-related events, enriched with resolution details.
 * Displayed in the Controls workspace with reversal and retroactive
 * review actions.
 */
export interface DecisionLogEntry {
  id: string;
  /** The tick when this decision event occurred. */
  tick: number;
  /** Who made the decision. */
  source: EventSource;
  /** Agent ID if the decision was agent-made. */
  agentId: string | null;
  /** Title of the decision. */
  title: string;
  /** Summary of what was decided. */
  summary: string;
  /** The action taken. */
  actionKind: ActionKind;
  /** Human's rationale (if provided). */
  rationale: string;
  /** Whether this decision is reversible. */
  reversible: boolean;
  /** Whether this decision has been reversed. */
  reversed: boolean;
  /** Whether this decision has been flagged for retroactive review. */
  flaggedForReview: boolean;
}
