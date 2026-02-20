/**
 * State adapter: maps backend types to frontend types.
 *
 * The backend and frontend have independent type systems that overlap
 * conceptually but diverge structurally. This module bridges the gap
 * by converting server responses into the rich frontend types that
 * the UI components expect.
 */

import type {
  StateSyncMessage,
  ServerAgentHandle,
  ServerArtifactSummary,
  ServerCoherenceIssueSummary,
  ServerDecisionSummary,
  ServerEventEnvelope,
  ServerOptionDecisionEvent,
  ServerSeverity,
  ServerBlastRadius,
  ServerControlMode,
  ServerWorkstreamSummary,
  ServerResolution,
  ServerBrakeAction,
} from '../types/server.js';

import type {
  Agent,
  Artifact,
  Checkpoint,
  CoherenceIssue,
  ControlMode,
  DecisionItem,
  Project,
  ProjectState,
  Severity,
  TimelineEvent,
  TrustProfile,
  Workstream,
  BlastRadius,
  DecisionOption,
  DecisionType,
} from '../types/index.js';

// ── Enum Adapters ─────────────────────────────────────────────────

/**
 * Map backend severity to frontend severity.
 * Backend has 'warning' where frontend has 'info'.
 */
export function adaptSeverity(s: ServerSeverity): Severity {
  if (s === 'warning') return 'info';
  return s;
}

/**
 * Map backend blast radius string to frontend BlastRadius object.
 * Backend uses a string enum; frontend has a rich object.
 */
export function adaptBlastRadius(br: ServerBlastRadius): BlastRadius {
  const magnitudeMap: Record<ServerBlastRadius, BlastRadius['magnitude']> = {
    trivial: 'small',
    small: 'small',
    medium: 'medium',
    large: 'large',
    unknown: 'medium',
  };
  const countMap: Record<ServerBlastRadius, number> = {
    trivial: 1,
    small: 2,
    medium: 4,
    large: 8,
    unknown: 3,
  };
  return {
    artifactCount: countMap[br],
    workstreamCount: Math.max(1, Math.floor(countMap[br] / 2)),
    agentCount: Math.max(1, Math.floor(countMap[br] / 3)),
    magnitude: magnitudeMap[br],
  };
}

/**
 * Map backend control mode to frontend control mode.
 * Both use the same enum values, so this is a type-safe passthrough.
 */
export function adaptControlMode(mode: ServerControlMode): ControlMode {
  return mode;
}

// ── Entity Adapters ───────────────────────────────────────────────

/**
 * Map a backend AgentHandle to a frontend Agent.
 * Fills in display defaults for fields the backend doesn't provide.
 */
export function adaptAgentHandle(handle: ServerAgentHandle, trustScore?: number): Agent {
  return {
    id: handle.id,
    name: handle.pluginName ? `${handle.pluginName} Agent` : `Agent ${handle.id.slice(0, 8)}`,
    role: handle.pluginName || 'agent',
    trustScore: trustScore !== undefined ? trustScore / 100 : 0.5,
    active: handle.status === 'running' || handle.status === 'waiting_on_human',
  };
}

/**
 * Map a backend ArtifactSummary to a frontend Artifact.
 * Fills in defaults for the richer frontend Provenance and status types.
 */
export function adaptArtifactSummary(summary: ServerArtifactSummary): Artifact {
  // Map backend status to frontend status
  const statusMap: Record<ServerArtifactSummary['status'], Artifact['status']> = {
    draft: 'draft',
    in_review: 'in_review',
    approved: 'approved',
    rejected: 'needs_rework',
  };

  // Map backend artifact kind to frontend kind
  const kindMap: Record<string, Artifact['kind']> = {
    code: 'code',
    document: 'document',
    design: 'design',
    config: 'configuration',
    test: 'test',
    other: 'code',
  };

  return {
    id: summary.id,
    name: summary.name,
    kind: kindMap[summary.kind] ?? 'code',
    description: `${summary.name} (${summary.kind})`,
    workstreamId: summary.workstream,
    provenance: {
      sourceArtifactIds: [],
      producerAgentId: 'unknown',
      validatorAgentIds: [],
      humanReviewerId: null,
      relatedDecisionIds: [],
      producedAtTick: 0,
      lastModifiedAtTick: 0,
    },
    qualityScore: summary.status === 'approved' ? 0.9 : summary.status === 'in_review' ? 0.7 : 0.5,
    status: statusMap[summary.status],
  };
}

/**
 * Map a backend CoherenceIssueSummary to a frontend CoherenceIssue.
 */
export function adaptCoherenceIssueSummary(issue: ServerCoherenceIssueSummary): CoherenceIssue {
  // Map backend coherence category to frontend
  const categoryMap: Record<string, CoherenceIssue['category']> = {
    contradiction: 'dependency_conflict',
    duplication: 'style_divergence',
    gap: 'cross_cutting_concern',
    dependency_violation: 'dependency_conflict',
  };

  return {
    id: issue.id,
    title: issue.title,
    description: issue.title,
    category: categoryMap[issue.category] ?? 'cross_cutting_concern',
    severity: adaptSeverity(issue.severity),
    status: 'detected',
    workstreamIds: issue.affectedWorkstreams,
    agentIds: [],
    artifactIds: [],
    suggestedResolution: null,
    detectedAtTick: 0,
    resolvedAtTick: null,
  };
}

/**
 * Map a backend DecisionSummary to a frontend DecisionItem.
 * When the summary includes option data (from enriched state_sync snapshots),
 * the decision is fully actionable. Otherwise falls back to minimal defaults.
 */
export function adaptDecisionSummary(summary: ServerDecisionSummary, tick: number): DecisionItem {
  const severity = adaptSeverity(summary.severity);
  const confidence = summary.confidence ?? 0.5;

  // Build options from enriched summary data when available
  let options: DecisionOption[] = [];
  if (summary.subtype === 'option' && summary.options && summary.options.length > 0) {
    options = summary.options.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description,
      consequence: o.tradeoffs ?? '',
      recommended: o.id === summary.recommendedOptionId,
      actionKind: 'approve' as const,
    }));
  } else if (summary.subtype === 'tool_approval') {
    const toolName = summary.toolName ?? 'tool';
    options = [
      { id: 'approve', label: 'Approve', description: `Allow ${toolName}`, consequence: '', recommended: true, actionKind: 'approve' as const },
      { id: 'reject', label: 'Reject', description: `Deny ${toolName}`, consequence: '', recommended: false, actionKind: 'reject' as const },
    ];
  }

  const blastRadius = summary.blastRadius
    ? adaptBlastRadius(summary.blastRadius)
    : { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' as const };

  return {
    id: summary.id,
    title: summary.title,
    summary: summary.summary ?? summary.title,
    type: 'architectural' as DecisionType,
    subtype: summary.subtype,
    severity,
    confidence,
    blastRadius,
    options,
    affectedArtifactIds: summary.affectedArtifactIds ?? [],
    relatedWorkstreamIds: [],
    sourceAgentId: summary.agentId,
    attentionScore: computeAttentionScore(severity, confidence),
    requiresRationale: summary.requiresRationale ?? false,
    createdAtTick: tick,
    dueByTick: summary.dueByTick ?? null,
    resolved: false,
    resolution: null,
    toolArgs: summary.toolArgs,
    reasoning: summary.reasoning,
  };
}

/**
 * Map a backend OptionDecisionEvent to a frontend DecisionItem.
 */
export function adaptOptionDecisionEvent(event: ServerOptionDecisionEvent, tick: number): DecisionItem {
  const options: DecisionOption[] = event.options.map((o) => ({
    id: o.id,
    label: o.label,
    description: o.description,
    consequence: o.tradeoffs ?? '',
    recommended: o.id === event.recommendedOptionId,
    actionKind: 'approve',
  }));

  return {
    id: event.decisionId,
    title: event.title,
    summary: event.summary,
    type: 'architectural' as DecisionType,
    subtype: 'option',
    severity: adaptSeverity(event.severity),
    confidence: event.confidence,
    blastRadius: adaptBlastRadius(event.blastRadius),
    options,
    affectedArtifactIds: event.affectedArtifactIds,
    relatedWorkstreamIds: [],
    sourceAgentId: event.agentId,
    attentionScore: computeAttentionScore(adaptSeverity(event.severity), event.confidence),
    requiresRationale: event.requiresRationale,
    createdAtTick: tick,
    dueByTick: event.dueByTick ?? null,
    resolved: false,
    resolution: null,
  };
}

/**
 * Map a backend WorkstreamSummary to a frontend Workstream.
 */
export function adaptWorkstreamSummary(ws: ServerWorkstreamSummary): Workstream {
  const statusMap: Record<string, Workstream['status']> = {
    active: 'active',
    blocked: 'blocked',
    complete: 'complete',
    paused: 'paused',
  };

  return {
    id: ws.id,
    name: ws.name,
    description: ws.recentActivity || ws.name,
    agentIds: ws.activeAgentIds,
    dependsOn: [],
    status: statusMap[ws.status] ?? 'active',
  };
}

// ── Composite Adapters ────────────────────────────────────────────

/**
 * Convert a full StateSyncMessage into partial ProjectState.
 * This is the main entry point for initial state hydration from the backend.
 */
export function adaptStateSyncToState(msg: StateSyncMessage): Partial<ProjectState> {
  const snapshot = msg.snapshot;

  // Build trust score lookup
  const trustMap = new Map(msg.trustScores.map((t) => [t.agentId, t.score]));

  // Adapt agents
  const agents: Agent[] = msg.activeAgents.map((h) =>
    adaptAgentHandle(h, trustMap.get(h.id)),
  );

  // Adapt artifacts
  const artifacts: Artifact[] = snapshot.artifactIndex.map(adaptArtifactSummary);

  // Adapt coherence issues
  const coherenceIssues: CoherenceIssue[] = snapshot.recentCoherenceIssues.map(adaptCoherenceIssueSummary);

  // Adapt decisions
  const decisions: DecisionItem[] = snapshot.pendingDecisions.map((d) =>
    adaptDecisionSummary(d, snapshot.version),
  );

  // Adapt workstreams
  const workstreams: Workstream[] = snapshot.workstreams.map(adaptWorkstreamSummary);

  // Build trust profiles
  const trustProfiles: TrustProfile[] = msg.trustScores.map((t) => ({
    agentId: t.agentId,
    currentScore: t.score / 100,
    trend: 'stable' as const,
    trajectory: [{
      tick: snapshot.version,
      score: t.score / 100,
      successCount: 0,
      overrideCount: 0,
      reworkCount: 0,
      totalTasks: 0,
    }],
    scoreByDomain: {},
  }));

  // Map project config checkpoints (string labels) to frontend Checkpoint objects
  const checkpoints: Checkpoint[] = (msg.projectConfig?.checkpoints ?? []).map((label, i) => ({
    id: `cp-${i}`,
    name: label,
    trigger: 'custom' as const,
    description: label,
    enabled: true,
    customCondition: null,
  }));

  // Build project from real config when available, otherwise minimal defaults
  const cfg = msg.projectConfig;
  const project: Project = {
    id: cfg?.id ?? 'live-project',
    name: cfg?.title ?? 'Live Project',
    description: cfg?.description ?? 'Connected to backend server',
    persona: 'live',
    phase: 'execution',
    controlMode: adaptControlMode(msg.controlMode),
    riskProfile: {
      level: 'medium',
      domainExpertise: 'shared',
      teamMaturity: 'established',
    },
    agents,
    workstreams,
    goals: cfg?.goals ?? [],
    constraints: cfg?.constraints ?? [],
    currentTick: snapshot.version,
    emergencyBrakeEngaged: false,
    createdAt: snapshot.generatedAt,
  };

  return {
    project,
    decisions,
    coherenceIssues,
    artifacts,
    trustProfiles,
    controlConfig: {
      mode: adaptControlMode(msg.controlMode),
      topology: [],
      checkpoints,
      bias: { value: 50 },
      riskAwareGating: true,
      pendingRecommendations: [],
    },
  };
}

/**
 * Convert a backend EventEnvelope to a frontend TimelineEvent.
 */
export function adaptEnvelopeToTimelineEvent(envelope: ServerEventEnvelope, tick: number): TimelineEvent {
  const event = envelope.event;
  const base = {
    id: envelope.sourceEventId,
    tick,
    source: 'agent' as const,
    agentId: event.agentId,
    relatedArtifactIds: [] as string[],
    relatedDecisionIds: [] as string[],
    relatedCoherenceIssueIds: [] as string[],
  };

  switch (event.type) {
    case 'status':
      return {
        ...base,
        category: 'agent_activity',
        severity: 'info',
        title: `Status: ${event.message.slice(0, 50)}`,
        description: event.message,
      };
    case 'decision':
      return {
        ...base,
        category: 'decision_created',
        severity: adaptSeverity(event.severity ?? 'medium'),
        title: event.subtype === 'option' ? event.title : `Tool approval: ${event.toolName}`,
        description: event.subtype === 'option' ? event.summary : `Tool: ${event.toolName}`,
        relatedDecisionIds: [event.decisionId],
      };
    case 'artifact':
      return {
        ...base,
        category: event.status === 'draft' ? 'artifact_produced' : 'artifact_updated',
        severity: 'info',
        title: `Artifact: ${event.name}`,
        description: `${event.kind} artifact in ${event.workstream}`,
        relatedArtifactIds: [event.artifactId],
      };
    case 'coherence':
      return {
        ...base,
        category: 'coherence_detected',
        severity: adaptSeverity(event.severity),
        title: event.title,
        description: event.description,
        relatedCoherenceIssueIds: [event.issueId],
      };
    case 'lifecycle':
      return {
        ...base,
        category: 'agent_activity',
        severity: event.action === 'crashed' || event.action === 'killed' ? 'high' : 'info',
        title: `Agent ${event.action}`,
        description: event.reason ?? `Agent ${event.agentId} ${event.action}`,
      };
    case 'completion':
      return {
        ...base,
        category: 'agent_activity',
        severity: event.outcome === 'success' ? 'info' : 'medium',
        title: `Agent completed: ${event.outcome}`,
        description: event.summary,
      };
    case 'error':
      return {
        ...base,
        category: 'agent_activity',
        severity: adaptSeverity(event.severity),
        title: `Error: ${event.message.slice(0, 50)}`,
        description: event.message,
      };
    case 'tool_call':
      return {
        ...base,
        category: 'agent_activity',
        severity: 'info',
        title: `Tool: ${event.toolName} (${event.phase})`,
        description: `Tool call ${event.toolCallId}: ${event.toolName}`,
      };
    case 'progress':
      return {
        ...base,
        category: 'agent_activity',
        severity: 'info',
        title: event.description,
        description: event.progressPct !== null ? `${event.progressPct}% complete` : event.description,
      };
  }
}

/**
 * Build the frontend resolution payload for sending to the backend API.
 * Handles both option-style and tool-approval decisions.
 */
export function adaptFrontendResolution(
  chosenOptionId: string,
  actionKind: string,
  rationale: string,
  subtype?: 'option' | 'tool_approval',
): ServerResolution {
  if (subtype === 'tool_approval') {
    // Map frontend actionKind (approve/reject) to tool-approval action
    const actionMap: Record<string, 'approve' | 'reject' | 'modify'> = {
      approve: 'approve',
      reject: 'reject',
      override: 'modify',
    };
    return {
      type: 'tool_approval',
      action: actionMap[actionKind] ?? 'approve',
      rationale,
      actionKind: mapFrontendActionKind(actionKind),
    };
  }

  return {
    type: 'option',
    chosenOptionId,
    rationale,
    actionKind: mapFrontendActionKind(actionKind),
  };
}

/**
 * Adapt a server brake message for the frontend emergency-brake action.
 */
export function adaptBrakeAction(action: ServerBrakeAction): { engaged: boolean; reason: string } {
  return {
    engaged: true,
    reason: action.reason,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function computeAttentionScore(severity: Severity, confidence: number): number {
  const severityWeights: Record<Severity, number> = {
    critical: 90,
    high: 70,
    medium: 50,
    low: 30,
    info: 10,
  };
  const base = severityWeights[severity] ?? 50;
  // Lower confidence = needs more attention
  const confidenceFactor = 1 + (1 - confidence) * 0.5;
  return Math.min(100, Math.round(base * confidenceFactor));
}

/**
 * Map frontend action kinds to backend action kinds.
 * Frontend uses approve/reject/defer/delegate/override;
 * backend uses create/update/delete/review/deploy.
 */
function mapFrontendActionKind(kind: string): ServerResolution extends { actionKind: infer K } ? K : never {
  const map: Record<string, 'create' | 'update' | 'delete' | 'review' | 'deploy'> = {
    approve: 'review',
    reject: 'review',
    defer: 'review',
    delegate: 'review',
    override: 'update',
  };
  return (map[kind] ?? 'review') as 'create' | 'update' | 'delete' | 'review' | 'deploy';
}
