import type { ArtifactKind, BlastRadius, ControlMode, Severity } from './events'
import type { KnowledgeSnapshot } from './snapshot'

/** Lightweight JSON schema representation used for structured agent outputs. */
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  enum?: Array<string | number | boolean | null>
  description?: string
  [key: string]: unknown
}

/** Project-level brief shared with each agent. */
export interface ProjectBrief {
  id?: string
  title: string
  description: string
  goals: string[]
  checkpoints: string[]
  constraints?: string[]
}

/** MCP server config attached to a brief. */
export interface MCPServerConfig {
  name: string
  transport?: 'stdio' | 'http' | 'sse' | 'ws' | string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  config?: Record<string, unknown>
}

/** Secret reference descriptor (value never included). */
export interface SecretRef {
  name: string
  vaultKey: string
  scope: 'agent' | 'project'
}

/** Guardrail policy bundle for input/output/tool phases. */
export interface GuardrailPolicy {
  inputGuardrails: GuardrailSpec[]
  outputGuardrails: GuardrailSpec[]
  toolGuardrails: GuardrailSpec[]
}

/** Individual guardrail configuration. */
export interface GuardrailSpec {
  name: string
  description: string
  action: 'block' | 'warn' | 'log'
}

/** Decision escalation settings. */
export interface EscalationProtocol {
  alwaysEscalate: string[]
  escalateWhen: EscalationRule[]
  neverEscalate: string[]
}

/** Human-readable escalation rule + machine predicate. */
export interface EscalationRule {
  predicate: EscalationPredicate
  description: string
}

/** Discriminated escalation predicate tree evaluated by backend. */
export type EscalationPredicate =
  | { field: 'confidence'; op: 'lt' | 'gt' | 'lte' | 'gte'; value: number }
  | { field: 'blastRadius'; op: 'eq' | 'gte'; value: BlastRadius }
  | { field: 'trustScore'; op: 'lt' | 'gt' | 'lte' | 'gte'; value: number }
  | { field: 'domainTrustScore'; op: 'lt' | 'gt' | 'lte' | 'gte'; value: number; domain: ArtifactKind }
  | { field: 'affectsMultipleWorkstreams'; op: 'eq'; value: boolean }
  | { type: 'and'; rules: EscalationPredicate[] }
  | { type: 'or'; rules: EscalationPredicate[] }

/** Sandbox resource and mount requirements. */
export interface WorkspaceRequirements {
  mounts: WorkspaceMount[]
  capabilities: SandboxCapability[]
  resourceLimits?: {
    cpuCores?: number
    memoryMb?: number
    diskMb?: number
    timeoutMs?: number
  }
  baseImage?: string
}

/** Host path mounted into sandbox. */
export interface WorkspaceMount {
  hostPath: string
  sandboxPath: string
  readOnly: boolean
}

/** System-level capabilities provisioned for an agent sandbox. */
export type SandboxCapability =
  | 'terminal'
  | 'browser'
  | 'git'
  | 'docker'
  | 'network_external'
  | 'network_internal_only'
  | 'gpu'

/** Agent session policy for turn/history/budget. */
export interface SessionPolicy {
  maxTurns?: number
  contextBudgetTokens?: number
  historyPolicy: 'full' | 'summarized' | 'recent_n'
  historyN?: number
}

/** Reactive trigger definitions for context injection policy. */
export type ContextReactiveTrigger =
  | { on: 'artifact_approved'; workstreams: 'own' | 'readable' | 'all' }
  | { on: 'decision_resolved'; workstreams: 'own' | 'readable' | 'all' }
  | { on: 'coherence_issue'; severity: Severity }
  | { on: 'agent_completed'; workstreams: 'readable' }
  | { on: 'brief_updated' }

/** Policy controlling when backend injects refreshed context. */
export interface ContextInjectionPolicy {
  periodicIntervalTicks: number | null
  reactiveEvents: ContextReactiveTrigger[]
  stalenessThreshold: number | null
  maxInjectionsPerHour: number
  cooldownTicks: number
}

/** Context payload sent mid-session to running agents. */
export interface ContextInjection {
  content: string
  format: 'markdown' | 'json' | 'plain'
  snapshotVersion: number
  estimatedTokens: number
  priority: 'required' | 'recommended' | 'supplementary'
}

/** Workstream-specific context injected into agent brief. */
export interface WorkstreamContext {
  description: string
  keyFiles: string[]
  exports?: string[]
  dependencies?: string[]
  status?: 'active' | 'paused' | 'completed'
  // Runtime enrichment from live state
  activeAgentIds?: string[]
  artifactCount?: number
  pendingDecisionCount?: number
  recentCoherenceIssueCount?: number
}

/** Full typed agent brief sent to adapter at spawn time. */
export interface AgentBrief {
  agentId: string
  role: string
  description: string
  workstream: string
  readableWorkstreams: string[]
  constraints: string[]
  escalationProtocol: EscalationProtocol
  controlMode: ControlMode
  projectBrief: ProjectBrief
  knowledgeSnapshot: KnowledgeSnapshot
  modelPreference?: string
  allowedTools: string[]
  mcpServers?: MCPServerConfig[]
  workspaceRequirements?: WorkspaceRequirements
  outputSchema?: JsonSchema
  guardrailPolicy?: GuardrailPolicy
  delegationPolicy?: {
    canSpawnSubagents: boolean
    allowedHandoffs: string[]
    maxDepth: number
  }
  sessionPolicy?: SessionPolicy
  contextInjectionPolicy?: ContextInjectionPolicy
  secretRefs?: SecretRef[]
  providerConfig?: Record<string, unknown>
  workstreamContext?: WorkstreamContext
}

export type {
  KnowledgeSnapshot,
  WorkstreamSummary,
  DecisionSummary,
  CoherenceIssueSummary,
  ArtifactSummary,
  AgentSummary
} from './snapshot'
