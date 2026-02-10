/**
 * Project state reducer.
 *
 * Pure function: (state, action) → state. No side effects.
 * Handles all state transitions for the project prototype.
 *
 * After each mutation the reducer recomputes derived values
 * (metrics, briefing, topology) so the UI always has fresh data.
 */

import type {
  ProjectState,
  ProjectAction,
  ActionKind,
  DecisionItem,
  CoherenceIssue,
  TimelineEvent,
  DecisionLogEntry,
} from '../types/index.js';
import { computeMetrics } from './scoring.js';
import { buildBriefing } from './narrative.js';
import { getTopologyPoints } from './topology.js';

// ── Initial State ─────────────────────────────────────────────────

export const initialState: ProjectState = {
  project: null,
  decisions: [],
  coherenceIssues: [],
  artifacts: [],
  trustProfiles: [],
  timeline: [],
  decisionLog: [],
  controlConfig: {
    mode: 'adaptive',
    topology: [],
    checkpoints: [],
    bias: { value: 50 },
    riskAwareGating: true,
    pendingRecommendations: [],
  },
  metrics: {
    coherenceScore: 100,
    coherenceTrend: 'stable',
    reworkRisk: 0,
    pendingDecisionCount: 0,
    openCoherenceIssueCount: 0,
    humanInterventionRate: 0,
    highSeverityMissRate: 0,
    averageTrustScore: 0.5,
    totalDecisionCount: 0,
    totalArtifactCount: 0,
    reviewPatterns: [],
  },
  briefing: 'No project loaded. Select a scenario to begin.',
  activeScenarioId: null,
  autoSimulate: false,
};

// ── Scenario registry ─────────────────────────────────────────────
// Populated at runtime by data/scenarios.ts via registerScenario().
// The reducer looks up scenarios here when handling 'load-scenario'.

type ScenarioLoader = (id: string) => ProjectState | null;
let scenarioLoader: ScenarioLoader = () => null;

/**
 * Register the scenario loading function. Called once at app startup
 * from the data module.
 */
export function registerScenarioLoader(loader: ScenarioLoader): void {
  scenarioLoader = loader;
}

// ── Reducer ───────────────────────────────────────────────────────

export function projectReducer(
  state: ProjectState,
  action: ProjectAction,
): ProjectState {
  let next: ProjectState;

  switch (action.type) {
    case 'load-scenario':
      next = handleLoadScenario(state, action.scenarioId);
      break;

    case 'advance-tick':
      next = handleAdvanceTick(state);
      break;

    case 'resolve-decision':
      next = handleResolveDecision(
        state,
        action.decisionId,
        action.chosenOptionId,
        action.actionKind,
        action.rationale,
      );
      break;

    case 'resolve-issue':
      next = handleResolveIssue(state, action.issueId, action.newStatus);
      break;

    case 'set-mode':
      next = handleSetMode(state, action.mode);
      break;

    case 'set-bias':
      next = handleSetBias(state, action.bias);
      break;

    case 'emergency-brake':
      next = handleEmergencyBrake(state, action.engaged);
      break;

    case 'inject-context':
      next = handleInjectContext(state, action.context);
      break;

    case 'reverse-decision':
      next = handleReverseDecision(state, action.decisionId, action.reason);
      break;

    case 'retroactive-review':
      next = handleRetroactiveReview(state, action.decisionId);
      break;

    case 'toggle-checkpoint':
      next = handleToggleCheckpoint(state, action.checkpointId, action.enabled);
      break;

    case 'accept-recommendation':
      next = handleAcceptRecommendation(state, action.recommendationId);
      break;

    case 'reject-recommendation':
      next = handleRejectRecommendation(state, action.recommendationId);
      break;

    case 'toggle-auto-simulate':
      next = { ...state, autoSimulate: !state.autoSimulate };
      break;

    default: {
      // Exhaustive check
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }

  // Recompute derived values after every state change
  return recomputeDerived(next);
}

// ── Derived value recomputation ───────────────────────────────────

function recomputeDerived(state: ProjectState): ProjectState {
  if (!state.project) return state;

  const metrics = computeMetrics(state);
  const briefing = buildBriefing(state);
  const topology = getTopologyPoints({
    phase: state.project.phase,
    riskLevel: state.project.riskProfile.level,
    domainExpertise: state.project.riskProfile.domainExpertise,
    teamMaturity: state.project.riskProfile.teamMaturity,
  });

  return {
    ...state,
    metrics,
    briefing,
    controlConfig: {
      ...state.controlConfig,
      topology,
    },
  };
}

// ── Action Handlers ───────────────────────────────────────────────

function handleLoadScenario(state: ProjectState, scenarioId: string): ProjectState {
  const scenario = scenarioLoader(scenarioId);
  if (!scenario) {
    console.warn(`Unknown scenario: ${scenarioId}`);
    return state;
  }

  return {
    ...scenario,
    activeScenarioId: scenarioId,
    autoSimulate: false,
  };
}

function handleAdvanceTick(state: ProjectState): ProjectState {
  if (!state.project || state.project.emergencyBrakeEngaged) return state;

  const nextTick = state.project.currentTick + 1;

  return {
    ...state,
    project: {
      ...state.project,
      currentTick: nextTick,
    },
  };
}

function handleResolveDecision(
  state: ProjectState,
  decisionId: string,
  chosenOptionId: string,
  actionKind: ActionKind,
  rationale: string,
): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;

  // Update the decision
  const decisions: DecisionItem[] = state.decisions.map((d) => {
    if (d.id !== decisionId) return d;
    return {
      ...d,
      resolved: true,
      resolution: {
        chosenOptionId,
        actionKind,
        rationale,
        resolvedAtTick: tick,
        reversed: false,
      },
    };
  });

  const decision = state.decisions.find((d) => d.id === decisionId);
  const chosenOption = decision?.options.find((o) => o.id === chosenOptionId);

  // Add timeline event
  const event: TimelineEvent = {
    id: `evt-${tick}-resolve-${decisionId}`,
    tick,
    source: 'human',
    agentId: null,
    category: 'decision_resolved',
    severity: decision?.severity ?? 'medium',
    title: `Resolved: ${decision?.title ?? decisionId}`,
    description: `Chose "${chosenOption?.label ?? chosenOptionId}". Rationale: ${rationale}`,
    relatedArtifactIds: decision?.affectedArtifactIds ?? [],
    relatedDecisionIds: [decisionId],
    relatedCoherenceIssueIds: [],
  };

  // Add decision log entry
  const logEntry: DecisionLogEntry = {
    id: `log-${tick}-${decisionId}`,
    tick,
    source: 'human',
    agentId: null,
    title: decision?.title ?? decisionId,
    summary: `Chose "${chosenOption?.label ?? chosenOptionId}"`,
    actionKind,
    rationale,
    reversible: true,
    reversed: false,
    flaggedForReview: false,
  };

  return {
    ...state,
    decisions,
    timeline: [...state.timeline, event],
    decisionLog: [...state.decisionLog, logEntry],
  };
}

function handleResolveIssue(
  state: ProjectState,
  issueId: string,
  newStatus: CoherenceIssue['status'],
): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;
  const issue = state.coherenceIssues.find((i) => i.id === issueId);

  const coherenceIssues: CoherenceIssue[] = state.coherenceIssues.map((i) => {
    if (i.id !== issueId) return i;
    return {
      ...i,
      status: newStatus,
      resolvedAtTick: ['resolved', 'accepted', 'dismissed'].includes(newStatus) ? tick : null,
    };
  });

  // Add timeline event for resolutions
  const isResolution = ['resolved', 'accepted', 'dismissed'].includes(newStatus);
  const event: TimelineEvent = {
    id: `evt-${tick}-issue-${issueId}`,
    tick,
    source: 'human',
    agentId: null,
    category: isResolution ? 'coherence_resolved' : 'coherence_detected',
    severity: issue?.severity ?? 'medium',
    title: `${isResolution ? 'Resolved' : 'Updated'}: ${issue?.title ?? issueId}`,
    description: `Status changed to ${newStatus}`,
    relatedArtifactIds: issue?.artifactIds ?? [],
    relatedDecisionIds: [],
    relatedCoherenceIssueIds: [issueId],
  };

  return {
    ...state,
    coherenceIssues,
    timeline: [...state.timeline, event],
  };
}

function handleSetMode(
  state: ProjectState,
  mode: ProjectState['controlConfig']['mode'],
): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;

  const event: TimelineEvent = {
    id: `evt-${tick}-mode-${mode}`,
    tick,
    source: 'human',
    agentId: null,
    category: 'mode_changed',
    severity: 'info',
    title: `Control mode changed to ${mode}`,
    description: `Human switched control mode from ${state.project.controlMode} to ${mode}`,
    relatedArtifactIds: [],
    relatedDecisionIds: [],
    relatedCoherenceIssueIds: [],
  };

  return {
    ...state,
    project: {
      ...state.project,
      controlMode: mode,
    },
    controlConfig: {
      ...state.controlConfig,
      mode,
    },
    timeline: [...state.timeline, event],
  };
}

function handleSetBias(
  state: ProjectState,
  bias: ProjectState['controlConfig']['bias'],
): ProjectState {
  return {
    ...state,
    controlConfig: {
      ...state.controlConfig,
      bias,
    },
  };
}

function handleEmergencyBrake(state: ProjectState, engaged: boolean): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;

  const event: TimelineEvent = {
    id: `evt-${tick}-brake-${engaged}`,
    tick,
    source: 'human',
    agentId: null,
    category: 'emergency_brake',
    severity: 'critical',
    title: engaged ? 'Emergency brake ENGAGED' : 'Emergency brake released',
    description: engaged
      ? 'All agent work has been halted'
      : 'Agent work has been resumed',
    relatedArtifactIds: [],
    relatedDecisionIds: [],
    relatedCoherenceIssueIds: [],
  };

  return {
    ...state,
    project: {
      ...state.project,
      emergencyBrakeEngaged: engaged,
    },
    autoSimulate: engaged ? false : state.autoSimulate,
    timeline: [...state.timeline, event],
  };
}

function handleInjectContext(state: ProjectState, context: string): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;

  const event: TimelineEvent = {
    id: `evt-${tick}-context`,
    tick,
    source: 'human',
    agentId: null,
    category: 'context_injected',
    severity: 'info',
    title: 'New context injected',
    description: context,
    relatedArtifactIds: [],
    relatedDecisionIds: [],
    relatedCoherenceIssueIds: [],
  };

  return {
    ...state,
    project: {
      ...state.project,
      constraints: [...state.project.constraints, context],
    },
    timeline: [...state.timeline, event],
  };
}

function handleReverseDecision(
  state: ProjectState,
  decisionId: string,
  reason: string,
): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;
  const decision = state.decisions.find((d) => d.id === decisionId);

  // Mark the decision's resolution as reversed
  const decisions: DecisionItem[] = state.decisions.map((d) => {
    if (d.id !== decisionId || !d.resolution) return d;
    return {
      ...d,
      resolved: false,
      resolution: { ...d.resolution, reversed: true },
    };
  });

  // Mark the decision log entry as reversed
  const decisionLog: DecisionLogEntry[] = state.decisionLog.map((d) => {
    if (!d.title || d.title !== decision?.title) return d;
    return { ...d, reversed: true };
  });

  const event: TimelineEvent = {
    id: `evt-${tick}-reverse-${decisionId}`,
    tick,
    source: 'human',
    agentId: null,
    category: 'decision_reversed',
    severity: 'high',
    title: `Reversed: ${decision?.title ?? decisionId}`,
    description: reason,
    relatedArtifactIds: decision?.affectedArtifactIds ?? [],
    relatedDecisionIds: [decisionId],
    relatedCoherenceIssueIds: [],
  };

  return {
    ...state,
    decisions,
    decisionLog,
    timeline: [...state.timeline, event],
  };
}

function handleRetroactiveReview(state: ProjectState, decisionId: string): ProjectState {
  const decisionLog: DecisionLogEntry[] = state.decisionLog.map((d) => {
    // Find the log entry for this decision
    const decision = state.decisions.find((dec) => dec.id === decisionId);
    if (d.title !== decision?.title) return d;
    return { ...d, flaggedForReview: true };
  });

  return { ...state, decisionLog };
}

function handleToggleCheckpoint(
  state: ProjectState,
  checkpointId: string,
  enabled: boolean,
): ProjectState {
  const checkpoints = state.controlConfig.checkpoints.map((c) => {
    if (c.id !== checkpointId) return c;
    return { ...c, enabled };
  });

  return {
    ...state,
    controlConfig: { ...state.controlConfig, checkpoints },
  };
}

function handleAcceptRecommendation(
  state: ProjectState,
  recommendationId: string,
): ProjectState {
  if (!state.project) return state;

  const rec = state.controlConfig.pendingRecommendations.find(
    (r) => r.id === recommendationId,
  );
  if (!rec) return state;

  // Update the recommendation status
  const pendingRecommendations = state.controlConfig.pendingRecommendations.map(
    (r) => {
      if (r.id !== recommendationId) return r;
      return { ...r, status: 'accepted' as const };
    },
  );

  // Apply the mode change
  const next = handleSetMode(
    {
      ...state,
      controlConfig: { ...state.controlConfig, pendingRecommendations },
    },
    rec.recommendedMode,
  );

  return next;
}

function handleRejectRecommendation(
  state: ProjectState,
  recommendationId: string,
): ProjectState {
  const pendingRecommendations = state.controlConfig.pendingRecommendations.map(
    (r) => {
      if (r.id !== recommendationId) return r;
      return { ...r, status: 'rejected' as const };
    },
  );

  return {
    ...state,
    controlConfig: { ...state.controlConfig, pendingRecommendations },
  };
}
