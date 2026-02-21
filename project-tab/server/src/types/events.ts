/** Core enums / union types from the event specification. */
export type Severity = 'warning' | 'low' | 'medium' | 'high' | 'critical'

/** Blast radius for decisions and risky actions. */
export type BlastRadius = 'trivial' | 'small' | 'medium' | 'large' | 'unknown'

/** Project-level control strategy. */
export type ControlMode = 'orchestrator' | 'adaptive' | 'ecosystem'

/** Artifact categories in the knowledge graph. */
export type ArtifactKind = 'code' | 'document' | 'design' | 'config' | 'test' | 'other'

/** Coherence issue classification categories. */
export type CoherenceCategory = 'contradiction' | 'duplication' | 'gap' | 'dependency_violation'

/** High-level action type used by resolution and policy logic. */
export type ActionKind = 'create' | 'update' | 'delete' | 'review' | 'deploy'

/** Option supplied in an option decision event. */
export interface DecisionOption {
  id: string
  label: string
  description: string
  tradeoffs?: string
}

/** Lineage and ownership data for artifacts. */
export interface Provenance {
  createdBy: string
  createdAt: string
  modifiedBy?: string
  modifiedAt?: string
  sourceArtifactIds?: string[]
  sourcePath?: string
}

/** Adapter-origin metadata + typed event payload. */
export interface AdapterEvent {
  sourceEventId: string
  sourceSequence: number
  sourceOccurredAt: string
  runId: string
  event: AgentEvent
}

/** Backend-ingested event envelope with ingestion timestamp. */
export interface EventEnvelope extends AdapterEvent {
  ingestedAt: string
}

/** Union of all events an adapter can emit. */
export type AgentEvent =
  | StatusEvent
  | DecisionEvent
  | ArtifactEvent
  | CoherenceEvent
  | ToolCallEvent
  | CompletionEvent
  | ErrorEvent
  | DelegationEvent
  | GuardrailEvent
  | LifecycleEvent
  | ProgressEvent
  | RawProviderEvent

/** Informational status update. */
export interface StatusEvent {
  type: 'status'
  agentId: string
  message: string
  tick?: number
}

/** Decision event union. */
export type DecisionEvent = OptionDecisionEvent | ToolApprovalEvent

/** Human chooses from proposed options. */
export interface OptionDecisionEvent {
  type: 'decision'
  subtype: 'option'
  agentId: string
  decisionId: string
  title: string
  summary: string
  severity: Severity
  confidence: number
  blastRadius: BlastRadius
  options: DecisionOption[]
  recommendedOptionId?: string
  affectedArtifactIds: string[]
  requiresRationale: boolean
  dueByTick?: number | null
}

/** Human approves/rejects/modifies a tool call. */
export interface ToolApprovalEvent {
  type: 'decision'
  subtype: 'tool_approval'
  agentId: string
  decisionId: string
  toolName: string
  toolArgs: Record<string, unknown>
  /** Agent's reasoning for this tool call (captured from the preceding assistant text). */
  reasoning?: string
  severity?: Severity
  confidence?: number
  blastRadius?: BlastRadius
  affectedArtifactIds?: string[]
  dueByTick?: number | null
}

/** Artifact creation/update event. */
export interface ArtifactEvent {
  type: 'artifact'
  agentId: string
  artifactId: string
  name: string
  kind: ArtifactKind
  workstream: string
  status: 'draft' | 'in_review' | 'approved' | 'rejected'
  qualityScore: number
  provenance: Provenance
  uri?: string
  mimeType?: string
  sizeBytes?: number
  contentHash?: string
}

/** Cross-workstream consistency issue. */
export interface CoherenceEvent {
  type: 'coherence'
  agentId: string
  issueId: string
  title: string
  description: string
  category: CoherenceCategory
  severity: Severity
  affectedWorkstreams: string[]
  affectedArtifactIds: string[]
}

/** Tool call observability event. */
export interface ToolCallEvent {
  type: 'tool_call'
  agentId: string
  toolCallId: string
  toolName: string
  phase: 'requested' | 'running' | 'completed' | 'failed'
  input: Record<string, unknown>
  output?: unknown
  approved: boolean
  durationMs?: number
}

/** Agent completed or exited task run. */
export interface CompletionEvent {
  type: 'completion'
  agentId: string
  summary: string
  artifactsProduced: string[]
  decisionsNeeded: string[]
  outcome: 'success' | 'partial' | 'abandoned' | 'max_turns'
  reason?: string
}

/** Error emitted by adapter/runtime. */
export interface ErrorEvent {
  type: 'error'
  agentId: string
  severity: Severity
  message: string
  recoverable: boolean
  errorCode?: string
  category: 'provider' | 'tool' | 'model' | 'timeout' | 'internal'
  context?: {
    toolName?: string
    lastAction?: string
  }
}

/** Parent-child agent delegation update. */
export interface DelegationEvent {
  type: 'delegation'
  agentId: string
  action: 'spawned' | 'handoff' | 'returned'
  childAgentId: string
  childRole: string
  reason: string
  delegationDepth: number
  rootAgentId: string
}

/** Guardrail pass/trip result. */
export interface GuardrailEvent {
  type: 'guardrail'
  agentId: string
  guardrailName: string
  level: 'input' | 'output' | 'tool'
  tripped: boolean
  message: string
}

/** Lifecycle transition event. */
export interface LifecycleEvent {
  type: 'lifecycle'
  agentId: string
  action: 'started' | 'paused' | 'resumed' | 'killed' | 'crashed' | 'idle' | 'session_start' | 'session_end'
  reason?: string
}

/** Progress update for long-running operation. */
export interface ProgressEvent {
  type: 'progress'
  agentId: string
  operationId: string
  description: string
  progressPct: number | null
}

/** Provider-native raw event for debugging. */
export interface RawProviderEvent {
  type: 'raw_provider'
  agentId: string
  providerName: string
  eventType: string
  payload: Record<string, unknown>
}
