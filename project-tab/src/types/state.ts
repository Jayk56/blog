/**
 * Application state and reducer action types.
 *
 * State is managed via useReducer at the Shell level and passed
 * down through React context. This file defines the full state shape
 * and the action union for the reducer.
 *
 * The reducer handles: load-scenario, advance-tick, resolve-decision,
 * resolve-issue, set-mode, set-bias, emergency-brake, inject-context,
 * reverse-decision, retroactive-review, toggle-checkpoint,
 * accept/reject-recommendation.
 */

import type { Project, ControlMode } from './project.js';
import type { DecisionItem, ActionKind } from './decisions.js';
import type { CoherenceIssue, CoherenceStatus } from './coherence.js';
import type { Artifact } from './artifacts.js';
import type { TrustProfile } from './trust.js';
import type { TimelineEvent, DecisionLogEntry } from './timeline.js';
import type { ControlConfig, ThroughputQualityBias } from './control.js';
import type { Metrics } from './metrics.js';

/**
 * The complete application state for a loaded scenario.
 * Everything the UI needs to render all five workspaces.
 */
export interface ProjectState {
  /** The loaded project (null before a scenario is loaded). */
  project: Project | null;

  /** All decisions (both pending and resolved). */
  decisions: DecisionItem[];

  /** All coherence issues (all statuses). */
  coherenceIssues: CoherenceIssue[];

  /** All artifacts in the project. */
  artifacts: Artifact[];

  /** Trust profiles for each agent. */
  trustProfiles: TrustProfile[];

  /** Full timeline of project events. */
  timeline: TimelineEvent[];

  /** Decision log (projected from timeline). */
  decisionLog: DecisionLogEntry[];

  /** Control system configuration. */
  controlConfig: ControlConfig;

  /** Computed metrics for the current state. */
  metrics: Metrics;

  /**
   * Generated narrative briefing text. Produced by buildBriefing()
   * from the current state — what changed, what needs attention,
   * what agents did autonomously.
   */
  briefing: string;

  /**
   * Which scenario is currently loaded (by ID).
   * Used by the scenario switcher in the VitalStrip.
   */
  activeScenarioId: string | null;

  /**
   * Whether the simulation is auto-advancing ticks.
   */
  autoSimulate: boolean;
}

// ── Reducer Actions ────────────────────────────────────────────────

/** Load a scenario dataset, replacing all current state. */
export interface LoadScenarioAction {
  type: 'load-scenario';
  scenarioId: string;
}

/**
 * Advance the simulation by one tick. Triggers new events,
 * decisions, and coherence scans in the mock data.
 */
export interface AdvanceTickAction {
  type: 'advance-tick';
}

/** Resolve a pending decision with a chosen option and rationale. */
export interface ResolveDecisionAction {
  type: 'resolve-decision';
  decisionId: string;
  chosenOptionId: string;
  actionKind: ActionKind;
  rationale: string;
}

/** Update the status of a coherence issue. */
export interface ResolveCoherenceIssueAction {
  type: 'resolve-issue';
  issueId: string;
  newStatus: CoherenceStatus;
}

/** Change the control mode (orchestrator / adaptive / ecosystem). */
export interface SetModeAction {
  type: 'set-mode';
  mode: ControlMode;
}

/** Adjust the throughput vs. quality dial. */
export interface SetBiasAction {
  type: 'set-bias';
  bias: ThroughputQualityBias;
}

/**
 * Engage or disengage the emergency brake.
 * "The freedom to let go requires the certainty that you can grab back."
 */
export interface EmergencyBrakeAction {
  type: 'emergency-brake';
  engaged: boolean;
}

/**
 * Push new context information to all active agent sessions.
 * Used when requirements change mid-flight.
 */
export interface InjectContextAction {
  type: 'inject-context';
  context: string;
}

/**
 * Reverse a previous decision and cascade the change
 * through dependent work.
 */
export interface ReverseDecisionAction {
  type: 'reverse-decision';
  decisionId: string;
  reason: string;
}

/**
 * Flag a previously-resolved decision for retroactive review.
 * "When you learn something that changes your evaluation."
 */
export interface RetroactiveReviewAction {
  type: 'retroactive-review';
  decisionId: string;
}

/** Toggle a checkpoint gate on or off. */
export interface ToggleCheckpointAction {
  type: 'toggle-checkpoint';
  checkpointId: string;
  enabled: boolean;
}

/** Accept a mode shift recommendation from the system. */
export interface AcceptRecommendationAction {
  type: 'accept-recommendation';
  recommendationId: string;
}

/** Reject a mode shift recommendation from the system. */
export interface RejectRecommendationAction {
  type: 'reject-recommendation';
  recommendationId: string;
}

/** Toggle auto-simulation on/off. */
export interface ToggleAutoSimulateAction {
  type: 'toggle-auto-simulate';
}

/**
 * Union of all possible reducer actions.
 * The reducer in lib/reducer.ts will handle each of these.
 */
export type ProjectAction =
  | LoadScenarioAction
  | AdvanceTickAction
  | ResolveDecisionAction
  | ResolveCoherenceIssueAction
  | SetModeAction
  | SetBiasAction
  | EmergencyBrakeAction
  | InjectContextAction
  | ReverseDecisionAction
  | RetroactiveReviewAction
  | ToggleCheckpointAction
  | AcceptRecommendationAction
  | RejectRecommendationAction
  | ToggleAutoSimulateAction;
