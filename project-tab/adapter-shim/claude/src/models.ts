/**
 * Wire protocol types matching the project-tab backend TypeScript interfaces.
 * All field names are camelCase on the wire.
 */

// ── Enums ──────────────────────────────────────────────────────────────

export type Severity = 'warning' | 'low' | 'medium' | 'high' | 'critical'
export type BlastRadius = 'trivial' | 'small' | 'medium' | 'large' | 'unknown'
export type ControlMode = 'orchestrator' | 'adaptive' | 'ecosystem'
export type ArtifactKind = 'code' | 'document' | 'design' | 'config' | 'test' | 'other'
export type AgentStatus = 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'idle' | 'error'
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'
export type ActionKind = 'create' | 'update' | 'delete' | 'review' | 'deploy'

// ── Brief sub-types ────────────────────────────────────────────────────

export interface ProjectBrief {
  id?: string
  title: string
  description: string
  goals: string[]
  checkpoints: string[]
  constraints?: string[]
}

export interface MCPServerConfig {
  name: string
  transport?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  config?: Record<string, unknown>
}

export interface EscalationProtocol {
  alwaysEscalate: string[]
  escalateWhen: Array<{ predicate: Record<string, unknown>; description: string }>
  neverEscalate: string[]
}

export interface KnowledgeSnapshot {
  version: number
  generatedAt: string
  workstreams: Array<Record<string, unknown>>
  pendingDecisions: Array<Record<string, unknown>>
  recentCoherenceIssues: Array<Record<string, unknown>>
  artifactIndex: Array<Record<string, unknown>>
  activeAgents: Array<Record<string, unknown>>
  estimatedTokens: number
}

export interface AgentBrief {
  agentId: string
  role: string
  description: string
  workstream: string
  readableWorkstreams?: string[]
  constraints?: string[]
  escalationProtocol: EscalationProtocol
  controlMode: ControlMode
  projectBrief: ProjectBrief
  knowledgeSnapshot: KnowledgeSnapshot
  modelPreference?: string
  allowedTools?: string[]
  mcpServers?: MCPServerConfig[]
  workspaceRequirements?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  guardrailPolicy?: Record<string, unknown>
  delegationPolicy?: Record<string, unknown>
  sessionPolicy?: Record<string, unknown>
  contextInjectionPolicy?: Record<string, unknown>
  secretRefs?: Array<Record<string, unknown>>
  providerConfig?: Record<string, unknown>
}

// ── Agent Handle ───────────────────────────────────────────────────────

export interface AgentHandle {
  id: string
  pluginName: string
  status: AgentStatus
  sessionId: string
  pendingBriefChanges?: Record<string, unknown>
}

// ── Context Injection ──────────────────────────────────────────────────

export interface ContextInjection {
  content: string
  format: 'markdown' | 'json' | 'plain'
  snapshotVersion: number
  estimatedTokens: number
  priority: 'required' | 'recommended' | 'supplementary'
}

// ── Kill / Pause / Resume types ────────────────────────────────────────

export interface KillRequest {
  grace?: boolean
  graceTimeoutMs?: number
}

export interface SdkCheckpoint {
  sdk: string
  runStateJson?: string
  sessionId?: string
  lastMessageId?: string
  stateSnapshot?: Record<string, unknown>
  scriptPosition?: number
}

export interface SerializedAgentState {
  agentId: string
  pluginName: string
  sessionId: string
  checkpoint: SdkCheckpoint
  briefSnapshot: AgentBrief
  conversationSummary?: string
  pendingDecisionIds: string[]
  lastSequence: number
  serializedAt: string
  serializedBy: 'pause' | 'kill_grace' | 'crash_recovery' | 'decision_checkpoint' | 'idle_completion'
  estimatedSizeBytes: number
}

export interface KillResponse {
  state: SerializedAgentState | null
  artifactsExtracted: number
  cleanShutdown: boolean
}

// ── Resolution types ───────────────────────────────────────────────────

export interface OptionDecisionResolution {
  type: 'option'
  chosenOptionId: string
  rationale: string
  actionKind: ActionKind
}

export interface ToolApprovalResolution {
  type: 'tool_approval'
  action: 'approve' | 'reject' | 'modify'
  modifiedArgs?: Record<string, unknown>
  alwaysApprove?: boolean
  rationale?: string
  actionKind: ActionKind
}

export type Resolution = OptionDecisionResolution | ToolApprovalResolution

export interface ResolveRequest {
  decisionId: string
  resolution: Resolution
}

// ── Health ──────────────────────────────────────────────────────────────

export interface SandboxResourceUsage {
  cpuPercent: number
  memoryMb: number
  diskMb: number
  collectedAt: string
}

export interface SandboxHealthResponse {
  status: HealthStatus
  agentStatus: AgentStatus
  uptimeMs: number
  resourceUsage: SandboxResourceUsage
  pendingEventBufferSize: number
}

// ── Event payload types ────────────────────────────────────────────────

export interface DecisionOption {
  id: string
  label: string
  description: string
  tradeoffs?: string
}

export interface Provenance {
  createdBy: string
  createdAt: string
  modifiedBy?: string
  modifiedAt?: string
  sourceArtifactIds?: string[]
  sourcePath?: string
}

export interface StatusEvent {
  type: 'status'
  agentId: string
  message: string
  tick?: number
}

export interface ToolApprovalEvent {
  type: 'decision'
  subtype: 'tool_approval'
  agentId: string
  decisionId: string
  toolName: string
  toolArgs: Record<string, unknown>
  severity?: Severity
  confidence?: number
  blastRadius?: BlastRadius
  affectedArtifactIds?: string[]
  dueByTick?: number
}

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
  affectedArtifactIds?: string[]
  requiresRationale?: boolean
  dueByTick?: number
}

export interface ToolCallEvent {
  type: 'tool_call'
  agentId: string
  toolCallId: string
  toolName: string
  phase: 'requested' | 'running' | 'completed' | 'failed'
  input?: Record<string, unknown>
  output?: unknown
  approved?: boolean
  durationMs?: number
}

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

export interface CompletionEvent {
  type: 'completion'
  agentId: string
  summary: string
  artifactsProduced: string[]
  decisionsNeeded: string[]
  outcome: 'success' | 'partial' | 'abandoned' | 'max_turns'
  reason?: string
}

export interface ErrorEvent {
  type: 'error'
  agentId: string
  severity: Severity
  message: string
  recoverable: boolean
  errorCode?: string
  category: 'provider' | 'tool' | 'model' | 'timeout' | 'internal'
  context?: Record<string, unknown>
}

export interface LifecycleEvent {
  type: 'lifecycle'
  agentId: string
  action: 'started' | 'paused' | 'resumed' | 'killed' | 'crashed' | 'session_start' | 'session_end'
  reason?: string
}

export interface ProgressEvent {
  type: 'progress'
  agentId: string
  operationId: string
  description: string
  progressPct?: number
}

export type AgentEvent =
  | StatusEvent
  | ToolApprovalEvent
  | OptionDecisionEvent
  | ToolCallEvent
  | ArtifactEvent
  | CompletionEvent
  | ErrorEvent
  | LifecycleEvent
  | ProgressEvent

// ── Adapter Event envelope ─────────────────────────────────────────────

export interface AdapterEvent {
  sourceEventId: string
  sourceSequence: number
  sourceOccurredAt: string
  runId: string
  event: AgentEvent
}
