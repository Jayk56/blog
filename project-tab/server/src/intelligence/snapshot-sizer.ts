import type {
  KnowledgeSnapshot,
  WorkstreamSummary,
  DecisionSummary,
  CoherenceIssueSummary,
  ArtifactSummary,
  AgentSummary
} from '../types/brief'

/** Default token budget for snapshot sizing. */
export const DEFAULT_TOKEN_BUDGET = 4000

/** Options controlling how a snapshot is scoped and trimmed. */
export interface SnapshotSizingOptions {
  /** Maximum token budget for the snapshot. Default: 4000. */
  tokenBudget?: number
  /** The agent's own workstream (used when trimming artifacts/decisions). */
  agentWorkstream?: string
  /** Workstreams the agent can read. If set, filters workstreams/artifacts/decisions. */
  readableWorkstreams?: string[]
}

/**
 * Estimates token count for a snapshot based on JSON serialization size.
 * Uses ~4 characters per token as a rough heuristic.
 */
export function estimateSnapshotTokens(snapshot: KnowledgeSnapshot): number {
  const jsonSize = JSON.stringify({
    workstreams: snapshot.workstreams,
    pendingDecisions: snapshot.pendingDecisions,
    recentCoherenceIssues: snapshot.recentCoherenceIssues,
    artifactIndex: snapshot.artifactIndex,
    activeAgents: snapshot.activeAgents
  }).length
  return Math.ceil(jsonSize / 4)
}

/**
 * Scope and trim a KnowledgeSnapshot to fit within a token budget.
 *
 * Scoping (applied first):
 *  - If readableWorkstreams is provided, only include workstreams, artifacts,
 *    and decisions from those workstreams.
 *
 * Trimming priority (applied in order until under budget):
 *  1. recentCoherenceIssues — drop affectedWorkstreams detail
 *  2. artifactIndex — keep only agent's own workstream
 *  3. activeAgents — drop pluginName and modelPreference
 *  4. pendingDecisions — keep only same-workstream decisions
 *
 * Returns a new snapshot with updated estimatedTokens.
 */
export function sizeSnapshot(
  snapshot: KnowledgeSnapshot,
  options: SnapshotSizingOptions = {}
): KnowledgeSnapshot {
  const budget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET

  // Start with scoped copy
  let result = scopeSnapshot(snapshot, options)

  // Check if already under budget
  let tokens = estimateSnapshotTokens(result)
  if (tokens <= budget) {
    return { ...result, estimatedTokens: tokens }
  }

  // Trim level 1: Summarize coherence issues (drop affectedWorkstreams)
  result = trimCoherenceIssues(result)
  tokens = estimateSnapshotTokens(result)
  if (tokens <= budget) {
    return { ...result, estimatedTokens: tokens }
  }

  // Trim level 2: Artifacts — only agent's own workstream
  if (options.agentWorkstream) {
    result = trimArtifactsToOwnWorkstream(result, options.agentWorkstream)
    tokens = estimateSnapshotTokens(result)
    if (tokens <= budget) {
      return { ...result, estimatedTokens: tokens }
    }
  }

  // Trim level 3: Agents — drop pluginName and modelPreference
  result = trimAgentDetails(result)
  tokens = estimateSnapshotTokens(result)
  if (tokens <= budget) {
    return { ...result, estimatedTokens: tokens }
  }

  // Trim level 4: Decisions — only same-workstream
  if (options.agentWorkstream) {
    result = trimDecisionsToOwnWorkstream(result, options.agentWorkstream, snapshot)
    tokens = estimateSnapshotTokens(result)
    if (tokens <= budget) {
      return { ...result, estimatedTokens: tokens }
    }
  }

  // Still over budget — return what we have with updated token count
  return { ...result, estimatedTokens: tokens }
}

/**
 * Scope a snapshot to only include data from readable workstreams.
 */
function scopeSnapshot(
  snapshot: KnowledgeSnapshot,
  options: SnapshotSizingOptions
): KnowledgeSnapshot {
  if (!options.readableWorkstreams || options.readableWorkstreams.length === 0) {
    return { ...snapshot }
  }

  const readable = new Set(options.readableWorkstreams)

  const workstreams = snapshot.workstreams.filter((ws) => readable.has(ws.id))

  const artifactIndex = snapshot.artifactIndex.filter((a) => readable.has(a.workstream))

  // For decisions, we need agent->workstream mapping from the activeAgents list
  const agentWorkstreams = new Map<string, string>()
  for (const agent of snapshot.activeAgents) {
    agentWorkstreams.set(agent.id, agent.workstream)
  }

  const pendingDecisions = snapshot.pendingDecisions.filter((d) => {
    const ws = agentWorkstreams.get(d.agentId)
    return ws ? readable.has(ws) : true // keep if we can't determine workstream
  })

  // Coherence issues — keep if any affected workstream is readable
  const recentCoherenceIssues = snapshot.recentCoherenceIssues.filter((ci) =>
    ci.affectedWorkstreams.some((ws) => readable.has(ws))
  )

  return {
    ...snapshot,
    workstreams,
    artifactIndex,
    pendingDecisions,
    recentCoherenceIssues,
    activeAgents: snapshot.activeAgents // agents are always visible
  }
}

/**
 * Trim level 1: Simplify coherence issues by removing affectedWorkstreams arrays.
 */
function trimCoherenceIssues(snapshot: KnowledgeSnapshot): KnowledgeSnapshot {
  const trimmed: CoherenceIssueSummary[] = snapshot.recentCoherenceIssues.map((ci) => ({
    ...ci,
    affectedWorkstreams: [] // drop to save tokens
  }))

  return { ...snapshot, recentCoherenceIssues: trimmed }
}

/**
 * Trim level 2: Keep only artifacts in the agent's own workstream.
 */
function trimArtifactsToOwnWorkstream(
  snapshot: KnowledgeSnapshot,
  agentWorkstream: string
): KnowledgeSnapshot {
  return {
    ...snapshot,
    artifactIndex: snapshot.artifactIndex.filter((a) => a.workstream === agentWorkstream)
  }
}

/**
 * Trim level 3: Drop pluginName and modelPreference from active agents.
 * Uses the special sentinel value '' for pluginName since it's required by the schema.
 */
function trimAgentDetails(snapshot: KnowledgeSnapshot): KnowledgeSnapshot {
  const trimmed: AgentSummary[] = snapshot.activeAgents.map((a) => {
    const { modelPreference, pluginName, ...rest } = a
    return { ...rest, pluginName: '' }
  })

  return { ...snapshot, activeAgents: trimmed }
}

/**
 * Trim level 4: Keep only decisions from the agent's own workstream.
 * Uses the original (pre-scoping) snapshot to find agent-to-workstream mappings.
 */
function trimDecisionsToOwnWorkstream(
  snapshot: KnowledgeSnapshot,
  agentWorkstream: string,
  originalSnapshot: KnowledgeSnapshot
): KnowledgeSnapshot {
  // Build agent->workstream map from the original snapshot
  const agentWorkstreams = new Map<string, string>()
  for (const agent of originalSnapshot.activeAgents) {
    agentWorkstreams.set(agent.id, agent.workstream)
  }

  return {
    ...snapshot,
    pendingDecisions: snapshot.pendingDecisions.filter((d) => {
      const ws = agentWorkstreams.get(d.agentId)
      return ws === agentWorkstream
    })
  }
}
