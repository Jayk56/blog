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

  /**
   * The tick being viewed for temporal navigation.
   * null = live (show up to currentTick).
   * When set to a number, all workspaces filter data to show
   * only what existed at or before this tick.
   */
  viewingTick: number | null;
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

/** Set the viewing tick for temporal navigation. null = live. */
export interface SetViewingTickAction {
  type: 'set-viewing-tick';
  tick: number | null;
}

/** Update the project description text. */
export interface UpdateDescriptionAction {
  type: 'update-description';
  description: string;
}

/** Replace the full goals array. */
export interface UpdateGoalsAction {
  type: 'update-goals';
  goals: string[];
}

/** Remove a constraint by index. */
export interface RemoveConstraintAction {
  type: 'remove-constraint';
  index: number;
}

/** Edit a constraint in-place by index. */
export interface EditConstraintAction {
  type: 'edit-constraint';
  index: number;
  value: string;
}

// ── Server-pushed actions ─────────────────────────────────────────

/** Full state sync from backend on connect/reconnect. */
export interface ServerStateSyncAction {
  type: 'server-state-sync';
  /** Partial state produced by the state adapter from the backend snapshot. */
  serverState: Partial<ProjectState>;
}

/** A workspace-scoped event from the backend. */
export interface ServerEventAction {
  type: 'server-event';
  event: import('./timeline.js').TimelineEvent;
  /** Raw server event envelope, used to populate decisions/artifacts/coherence from event data. */
  envelope?: import('./server.js').ServerEventEnvelope;
}

/** Trust score delta from backend. */
export interface ServerTrustUpdateAction {
  type: 'server-trust-update';
  agentId: string;
  previousScore: number;
  newScore: number;
  delta: number;
  reason: string;
}

/** A decision was resolved (possibly by another client). */
export interface ServerDecisionResolvedAction {
  type: 'server-decision-resolved';
  decisionId: string;
  agentId: string;
  /** Resolution payload from the server (chosenOptionId, rationale, etc.). */
  resolution?: import('./server.js').ServerResolution;
}

/** Emergency brake was applied from backend. */
export interface ServerBrakeAction {
  type: 'server-brake';
  engaged: boolean;
  affectedAgentIds: string[];
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
  | ToggleAutoSimulateAction
  | SetViewingTickAction
  | UpdateDescriptionAction
  | UpdateGoalsAction
  | RemoveConstraintAction
  | EditConstraintAction
  | ServerStateSyncAction
  | ServerEventAction
  | ServerTrustUpdateAction
  | ServerDecisionResolvedAction
  | ServerBrakeAction;
