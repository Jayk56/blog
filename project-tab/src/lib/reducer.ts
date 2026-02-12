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
  Artifact,
  TimelineEvent,
  DecisionLogEntry,
} from '../types/index.js';
import type { ServerEventEnvelope } from '../types/server.js';
import { adaptOptionDecisionEvent, adaptSeverity, adaptBlastRadius } from '../services/state-adapter.js';
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

    // ── Server-pushed actions ───────────────────────────────────
    case 'server-state-sync':
      next = handleServerStateSync(state, action.serverState);
      break;

    case 'server-event':
      next = handleServerEvent(state, action.event, action.envelope);
      break;

    case 'server-trust-update':
      next = handleServerTrustUpdate(state, action.agentId, action.newScore);
      break;

    case 'server-decision-resolved':
      next = handleServerDecisionResolved(state, action.decisionId, action.resolution);
      break;

    case 'server-brake':
      next = handleServerBrake(state, action.engaged);
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

// ── Server-pushed action handlers ────────────────────────────────

function handleServerStateSync(
  state: ProjectState,
  serverState: Partial<ProjectState>,
): ProjectState {
  // Only merge fields that the server actually sent (not undefined).
  // Don't overwrite populated arrays with empty ones — partial syncs
  // (e.g. after control-mode change) may carry placeholder empty collections
  // that shouldn't erase the client's richer state.
  const merged = { ...state }
  for (const [key, value] of Object.entries(serverState)) {
    if (value === undefined) continue
    const existing = (state as any)[key]
    if (Array.isArray(value) && value.length === 0 && Array.isArray(existing) && existing.length > 0) {
      continue // keep populated client array
    }
    (merged as any)[key] = value
  }
  // Preserve local-only fields
  merged.autoSimulate = state.autoSimulate
  merged.activeScenarioId = state.activeScenarioId
  return merged
}

function handleServerTrustUpdate(
  state: ProjectState,
  agentId: string,
  newScore: number,
): ProjectState {
  const normalizedScore = newScore > 1 ? newScore / 100 : newScore;
  const trustProfiles = state.trustProfiles.map((p) => {
    if (p.agentId !== agentId) return p;
    const currentTick = state.project?.currentTick ?? 0;
    return {
      ...p,
      currentScore: normalizedScore,
      trend: normalizedScore > p.currentScore
        ? 'increasing' as const
        : normalizedScore < p.currentScore
          ? 'decreasing' as const
          : 'stable' as const,
      trajectory: [
        ...p.trajectory,
        {
          tick: currentTick,
          score: normalizedScore,
          successCount: 0,
          overrideCount: 0,
          reworkCount: 0,
          totalTasks: 0,
        },
      ],
    };
  });

  // Also update the agent's trust score in the project
  const project = state.project
    ? {
        ...state.project,
        agents: state.project.agents.map((a) =>
          a.id === agentId ? { ...a, trustScore: normalizedScore } : a,
        ),
      }
    : state.project;

  return { ...state, trustProfiles, project };
}

function handleServerDecisionResolved(
  state: ProjectState,
  decisionId: string,
  serverResolution?: import('../types/server.js').ServerResolution,
): ProjectState {
  const tick = state.project?.currentTick ?? 0;
  const decisions = state.decisions.map((d) => {
    if (d.id !== decisionId) return d;
    // Build a frontend resolution from the server payload when available
    if (serverResolution) {
      const chosenOptionId = serverResolution.type === 'option'
        ? serverResolution.chosenOptionId
        : serverResolution.action;
      const rationale = serverResolution.rationale ?? '';
      // Derive actionKind from the chosen option on this decision (preserves frontend semantics)
      // rather than reverse-mapping the lossy backend actionKind
      const chosenOption = d.options.find((o) => o.id === chosenOptionId);
      const actionKind: ActionKind = chosenOption?.actionKind ?? 'approve';
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
    }
    return { ...d, resolved: true };
  });
  return { ...state, decisions };
}

/**
 * Handle a server-originated brake broadcast.
 * Updates brake state without adding a timeline event, since the local
 * `emergency-brake` dispatch (if any) already added one. If no local
 * brake event exists for the current tick, we add the timeline entry.
 */
function handleServerBrake(state: ProjectState, engaged: boolean): ProjectState {
  if (!state.project) return state;

  const tick = state.project.currentTick;

  // Check if a brake timeline event already exists for this tick
  const hasBrakeEvent = state.timeline.some(
    (e) => e.category === 'emergency_brake' && e.tick === tick,
  );

  if (hasBrakeEvent) {
    // Just update the brake state, skip duplicate timeline entry
    return {
      ...state,
      project: {
        ...state.project,
        emergencyBrakeEngaged: engaged,
      },
      autoSimulate: engaged ? false : state.autoSimulate,
    };
  }

  // No existing brake event for this tick — add one (server-only brake)
  return handleEmergencyBrake(state, engaged);
}

function handleServerEvent(
  state: ProjectState,
  event: TimelineEvent,
  envelope?: ServerEventEnvelope,
): ProjectState {
  // Add the event to timeline
  const timeline = [...state.timeline, event];

  // Also update state based on event category
  let nextState = { ...state, timeline };

  // Extract decision/artifact/coherence IDs from the event
  const decisionId = event.relatedDecisionIds[0];
  const issueId = event.relatedCoherenceIssueIds[0];
  const tick = state.project?.currentTick ?? 0;
  const serverEvent = envelope?.event;

  switch (event.category) {
    case 'decision_created':
      // If the raw server event is available, map it to a frontend DecisionItem
      if (serverEvent && serverEvent.type === 'decision' && serverEvent.subtype === 'option') {
        const existing = nextState.decisions.find((d) => d.id === serverEvent.decisionId);
        if (!existing) {
          const newDecision = adaptOptionDecisionEvent(serverEvent, tick);
          nextState.decisions = [...nextState.decisions, newDecision];
        }
      } else if (serverEvent && serverEvent.type === 'decision' && serverEvent.subtype === 'tool_approval') {
        // Tool approval decisions: create a minimal DecisionItem if not already present
        const existing = nextState.decisions.find((d) => d.id === serverEvent.decisionId);
        if (!existing) {
          const newDecision: DecisionItem = {
            id: serverEvent.decisionId,
            title: `Tool approval: ${serverEvent.toolName}`,
            summary: `Approve tool call: ${serverEvent.toolName}`,
            type: 'architectural',
            subtype: 'tool_approval',
            severity: adaptSeverity(serverEvent.severity ?? 'medium'),
            confidence: serverEvent.confidence ?? 0.5,
            blastRadius: adaptBlastRadius(serverEvent.blastRadius ?? 'medium'),
            options: [
              { id: 'approve', label: 'Approve', description: `Allow ${serverEvent.toolName}`, consequence: '', recommended: true, actionKind: 'approve' },
              { id: 'reject', label: 'Reject', description: `Deny ${serverEvent.toolName}`, consequence: '', recommended: false, actionKind: 'reject' },
            ],
            affectedArtifactIds: serverEvent.affectedArtifactIds ?? [],
            relatedWorkstreamIds: [],
            sourceAgentId: serverEvent.agentId,
            attentionScore: 50,
            requiresRationale: false,
            createdAtTick: tick,
            dueByTick: serverEvent.dueByTick ?? null,
            resolved: false,
            resolution: null,
          };
          nextState.decisions = [...nextState.decisions, newDecision];
        }
      }
      break;

    case 'artifact_produced':
      // If the raw server event is available, create a frontend Artifact
      if (serverEvent && serverEvent.type === 'artifact') {
        const existing = nextState.artifacts.find((a) => a.id === serverEvent.artifactId);
        if (!existing) {
          const newArtifact = adaptServerArtifactEvent(serverEvent, tick);
          nextState.artifacts = [...nextState.artifacts, newArtifact];
        }
      }
      break;

    case 'artifact_updated':
      // If the raw server event is available, update the existing Artifact or add it
      if (serverEvent && serverEvent.type === 'artifact') {
        const existingIdx = nextState.artifacts.findIndex((a) => a.id === serverEvent.artifactId);
        if (existingIdx >= 0) {
          const updated = adaptServerArtifactEvent(serverEvent, tick);
          // Preserve provenance from existing artifact, update modification tick
          const existing = nextState.artifacts[existingIdx];
          updated.provenance = {
            ...existing.provenance,
            lastModifiedAtTick: tick,
          };
          nextState.artifacts = nextState.artifacts.map((a, i) =>
            i === existingIdx ? updated : a,
          );
        } else {
          // Artifact not yet in state — add it
          const newArtifact = adaptServerArtifactEvent(serverEvent, tick);
          nextState.artifacts = [...nextState.artifacts, newArtifact];
        }
      }
      break;

    case 'coherence_detected':
      // Coherence events arrive via timeline but carry limited metadata.
      // The backend sends full coherence issue details via state_sync.
      break;

    case 'decision_resolved':
      // Mark the decision as resolved if it exists
      if (decisionId) {
        nextState.decisions = nextState.decisions.map((d) => {
          if (d.id !== decisionId) return d;
          return { ...d, resolved: true };
        });
      }
      break;

    case 'coherence_resolved':
      // Mark the coherence issue as resolved if it exists
      if (issueId) {
        nextState.coherenceIssues = nextState.coherenceIssues.map((i) => {
          if (i.id !== issueId) return i;
          return {
            ...i,
            status: 'resolved',
            resolvedAtTick: tick,
          };
        });
      }
      break;

    default:
      // For other event types (agent_activity, mode_changed, etc.),
      // just the timeline entry is sufficient
      break;
  }

  return nextState;
}

/**
 * Map a ServerArtifactEvent to a frontend Artifact.
 * Used for incremental artifact updates from WebSocket events.
 */
function adaptServerArtifactEvent(
  event: Extract<import('../types/server.js').ServerAgentEvent, { type: 'artifact' }>,
  tick: number,
): Artifact {
  const kindMap: Record<string, Artifact['kind']> = {
    code: 'code',
    document: 'document',
    design: 'design',
    config: 'configuration',
    test: 'test',
    other: 'code',
  };

  const statusMap: Record<string, Artifact['status']> = {
    draft: 'draft',
    in_review: 'in_review',
    approved: 'approved',
    rejected: 'needs_rework',
  };

  return {
    id: event.artifactId,
    name: event.name,
    kind: kindMap[event.kind] ?? 'code',
    description: `${event.name} (${event.kind})`,
    workstreamId: event.workstream,
    provenance: {
      sourceArtifactIds: event.provenance.sourceArtifactIds ?? [],
      producerAgentId: event.provenance.createdBy ?? event.agentId,
      validatorAgentIds: [],
      humanReviewerId: null,
      relatedDecisionIds: [],
      producedAtTick: tick,
      lastModifiedAtTick: tick,
    },
    qualityScore: event.qualityScore,
    status: statusMap[event.status] ?? 'draft',
  };
}
