/**
 * Backend message and entity types re-exported for frontend consumption.
 *
 * These mirror the backend types from project-tab/server/src/types/ so the
 * frontend API client, WebSocket service, and state adapter can work with
 * strongly-typed backend payloads without importing from the server directly.
 */

// ── Control & Event Enums ─────────────────────────────────────────

export type ServerControlMode = 'orchestrator' | 'adaptive' | 'ecosystem';

export type ServerSeverity = 'warning' | 'low' | 'medium' | 'high' | 'critical';

export type ServerBlastRadius = 'trivial' | 'small' | 'medium' | 'large' | 'unknown';

export type ServerActionKind = 'create' | 'update' | 'delete' | 'review' | 'deploy';

export type ServerArtifactKind = 'code' | 'document' | 'design' | 'config' | 'test' | 'other';

export type ServerCoherenceCategory = 'contradiction' | 'duplication' | 'gap' | 'dependency_violation';

// ── Agent Handle ──────────────────────────────────────────────────

export interface ServerAgentHandle {
  id: string;
  pluginName: string;
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error';
  sessionId: string;
}

// ── Knowledge Snapshot ────────────────────────────────────────────

export interface ServerWorkstreamSummary {
  id: string;
  name: string;
  status: string;
  activeAgentIds: string[];
  artifactCount: number;
  pendingDecisionCount: number;
  recentActivity: string;
}

export interface ServerDecisionSummary {
  id: string;
  title: string;
  severity: ServerSeverity;
  agentId: string;
  subtype: 'option' | 'tool_approval';
  /** Option data for option decisions (hydrated from full event on reconnect). */
  options?: ServerDecisionOption[];
  recommendedOptionId?: string;
  confidence?: number;
  blastRadius?: ServerBlastRadius;
  affectedArtifactIds?: string[];
  requiresRationale?: boolean;
  summary?: string;
  dueByTick?: number | null;
  toolName?: string;
}

export interface ServerCoherenceIssueSummary {
  id: string;
  title: string;
  severity: ServerSeverity;
  category: ServerCoherenceCategory;
  affectedWorkstreams: string[];
}

export interface ServerArtifactSummary {
  id: string;
  name: string;
  kind: ServerArtifactKind;
  status: 'draft' | 'in_review' | 'approved' | 'rejected';
  workstream: string;
}

export interface ServerAgentSummary {
  id: string;
  role: string;
  workstream: string;
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error';
  pluginName: string;
  modelPreference?: string;
}

export interface ServerKnowledgeSnapshot {
  version: number;
  generatedAt: string;
  workstreams: ServerWorkstreamSummary[];
  pendingDecisions: ServerDecisionSummary[];
  recentCoherenceIssues: ServerCoherenceIssueSummary[];
  artifactIndex: ServerArtifactSummary[];
  activeAgents: ServerAgentSummary[];
  estimatedTokens: number;
}

// ── Decision Option ───────────────────────────────────────────────

export interface ServerDecisionOption {
  id: string;
  label: string;
  description: string;
  tradeoffs?: string;
}

// ── Event Envelope ────────────────────────────────────────────────

export interface ServerEventEnvelope {
  sourceEventId: string;
  sourceSequence: number;
  sourceOccurredAt: string;
  runId: string;
  ingestedAt: string;
  event: ServerAgentEvent;
}

export type ServerAgentEvent =
  | ServerStatusEvent
  | ServerDecisionEvent
  | ServerArtifactEvent
  | ServerCoherenceEvent
  | ServerToolCallEvent
  | ServerCompletionEvent
  | ServerErrorEvent
  | ServerLifecycleEvent
  | ServerProgressEvent;

export interface ServerStatusEvent {
  type: 'status';
  agentId: string;
  message: string;
  tick?: number;
}

export type ServerDecisionEvent = ServerOptionDecisionEvent | ServerToolApprovalEvent;

export interface ServerOptionDecisionEvent {
  type: 'decision';
  subtype: 'option';
  agentId: string;
  decisionId: string;
  title: string;
  summary: string;
  severity: ServerSeverity;
  confidence: number;
  blastRadius: ServerBlastRadius;
  options: ServerDecisionOption[];
  recommendedOptionId?: string;
  affectedArtifactIds: string[];
  requiresRationale: boolean;
  dueByTick?: number | null;
}

export interface ServerToolApprovalEvent {
  type: 'decision';
  subtype: 'tool_approval';
  agentId: string;
  decisionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  severity?: ServerSeverity;
  confidence?: number;
  blastRadius?: ServerBlastRadius;
  affectedArtifactIds?: string[];
  dueByTick?: number | null;
}

export interface ServerArtifactEvent {
  type: 'artifact';
  agentId: string;
  artifactId: string;
  name: string;
  kind: ServerArtifactKind;
  workstream: string;
  status: 'draft' | 'in_review' | 'approved' | 'rejected';
  qualityScore: number;
  provenance: {
    createdBy: string;
    createdAt: string;
    modifiedBy?: string;
    modifiedAt?: string;
    sourceArtifactIds?: string[];
    sourcePath?: string;
  };
  uri?: string;
}

export interface ServerCoherenceEvent {
  type: 'coherence';
  agentId: string;
  issueId: string;
  title: string;
  description: string;
  category: ServerCoherenceCategory;
  severity: ServerSeverity;
  affectedWorkstreams: string[];
  affectedArtifactIds: string[];
}

export interface ServerToolCallEvent {
  type: 'tool_call';
  agentId: string;
  toolCallId: string;
  toolName: string;
  phase: 'requested' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: unknown;
  approved: boolean;
  durationMs?: number;
}

export interface ServerCompletionEvent {
  type: 'completion';
  agentId: string;
  summary: string;
  artifactsProduced: string[];
  decisionsNeeded: string[];
  outcome: 'success' | 'partial' | 'abandoned' | 'max_turns';
  reason?: string;
}

export interface ServerErrorEvent {
  type: 'error';
  agentId: string;
  severity: ServerSeverity;
  message: string;
  recoverable: boolean;
  errorCode?: string;
  category: 'provider' | 'tool' | 'model' | 'timeout' | 'internal';
}

export interface ServerLifecycleEvent {
  type: 'lifecycle';
  agentId: string;
  action: 'started' | 'paused' | 'resumed' | 'killed' | 'crashed' | 'session_start' | 'session_end';
  reason?: string;
}

export interface ServerProgressEvent {
  type: 'progress';
  agentId: string;
  operationId: string;
  description: string;
  progressPct: number | null;
}

// ── Resolution Types ──────────────────────────────────────────────

export interface ServerOptionResolution {
  type: 'option';
  chosenOptionId: string;
  rationale: string;
  actionKind: ServerActionKind;
}

export interface ServerToolApprovalResolution {
  type: 'tool_approval';
  action: 'approve' | 'reject' | 'modify';
  modifiedArgs?: Record<string, unknown>;
  alwaysApprove?: boolean;
  rationale?: string;
  actionKind: ServerActionKind;
}

export type ServerResolution = ServerOptionResolution | ServerToolApprovalResolution;

// ── Brake Types ───────────────────────────────────────────────────

export type ServerBrakeScope =
  | { type: 'all' }
  | { type: 'agent'; agentId: string }
  | { type: 'workstream'; workstream: string };

export interface ServerBrakeAction {
  scope: ServerBrakeScope;
  reason: string;
  behavior: 'pause' | 'kill';
  initiatedBy: string;
  timestamp: string;
}

// ── WebSocket Messages ────────────────────────────────────────────

export interface StateSyncMessage {
  type: 'state_sync';
  snapshot: ServerKnowledgeSnapshot;
  activeAgents: ServerAgentHandle[];
  trustScores: Array<{ agentId: string; score: number }>;
  controlMode: ServerControlMode;
}

export interface WorkspaceEventMessage {
  type: 'event';
  workspace: string;
  secondaryWorkspaces: string[];
  envelope: ServerEventEnvelope;
}

export interface TrustUpdateMessage {
  type: 'trust_update';
  agentId: string;
  previousScore: number;
  newScore: number;
  delta: number;
  reason: string;
}

export interface DecisionResolvedMessage {
  type: 'decision_resolved';
  decisionId: string;
  resolution: ServerResolution;
  agentId: string;
}

export interface BrakeMessage {
  type: 'brake';
  action: ServerBrakeAction;
  affectedAgentIds: string[];
}

export type ServerFrontendMessage =
  | StateSyncMessage
  | WorkspaceEventMessage
  | TrustUpdateMessage
  | DecisionResolvedMessage
  | BrakeMessage;

// ── Trust Config (from trust route response) ──────────────────────

export interface ServerTrustConfig {
  initialScore: number;
  outcomes: Record<string, { delta: number; description: string }>;
}

// ── Queued Decision (from decisions route) ────────────────────────

export interface ServerQueuedDecision {
  id: string;
  event: ServerDecisionEvent;
  enqueuedAt: string;
  status: 'pending' | 'resolved' | 'suspended' | 'orphaned';
  resolution?: ServerResolution;
  resolvedAt?: string;
}

// ── Stored Checkpoint (from agents route) ─────────────────────────

export interface ServerStoredCheckpoint {
  id: number;
  agentId: string;
  decisionId?: string;
  state: unknown;
  storedAt: string;
}
