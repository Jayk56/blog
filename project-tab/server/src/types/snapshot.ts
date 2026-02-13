import type { ArtifactKind, BlastRadius, CoherenceCategory, Severity } from './events'

/** Workstream summary used in knowledge snapshots. */
export interface WorkstreamSummary {
  id: string
  name: string
  status: string
  activeAgentIds: string[]
  artifactCount: number
  pendingDecisionCount: number
  recentActivity: string
}

/** Compact pending decision summary in snapshots. */
export interface DecisionSummary {
  id: string
  title: string
  severity: Severity
  agentId: string
  subtype: 'option' | 'tool_approval'
  /** Option data for option decisions (so reconnecting clients can hydrate the queue). */
  options?: Array<{ id: string; label: string; description: string; tradeoffs?: string }>
  /** Recommended option ID for option decisions. */
  recommendedOptionId?: string
  /** Confidence score for this decision. */
  confidence?: number
  /** Blast radius for this decision. */
  blastRadius?: BlastRadius
  /** Affected artifact IDs. */
  affectedArtifactIds?: string[]
  /** Whether rationale is required. */
  requiresRationale?: boolean
  /** Summary text for option decisions. */
  summary?: string
  /** Due-by tick for this decision. */
  dueByTick?: number | null
  /** Tool name for tool_approval decisions. */
  toolName?: string
}

/** Compact coherence summary in snapshots. */
export interface CoherenceIssueSummary {
  id: string
  title: string
  severity: Severity
  category: CoherenceCategory
  affectedWorkstreams: string[]
}

/** Compact artifact metadata in snapshots. */
export interface ArtifactSummary {
  id: string
  name: string
  kind: ArtifactKind
  status: 'draft' | 'in_review' | 'approved' | 'rejected'
  workstream: string
}

/** Compact agent status in snapshots. */
export interface AgentSummary {
  id: string
  role: string
  workstream: string
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error'
  pluginName: string
  modelPreference?: string
}

/** Shared project state snapshot injected into agents and sent to frontend. */
export interface KnowledgeSnapshot {
  version: number
  generatedAt: string
  workstreams: WorkstreamSummary[]
  pendingDecisions: DecisionSummary[]
  recentCoherenceIssues: CoherenceIssueSummary[]
  artifactIndex: ArtifactSummary[]
  activeAgents: AgentSummary[]
  estimatedTokens: number
}
