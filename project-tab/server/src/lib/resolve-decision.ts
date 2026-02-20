import type { DecisionQueue } from '../intelligence/decision-queue'
import type { TrustEngine } from '../intelligence/trust-engine'
import { mapResolutionToTrustOutcome } from '../intelligence/trust-engine'
import type { TickService } from '../tick'
import type { WebSocketHub } from '../ws-hub'
import type { AgentRegistry, AgentGateway } from '../types/service-interfaces'
import type { KnowledgeStore } from '../intelligence/knowledge-store'
import type { Resolution } from '../types/resolution'
import type { ArtifactKind } from '../types/events'

export interface ResolveContext {
  decisionQueue: DecisionQueue
  trustEngine: TrustEngine
  tickService: TickService
  wsHub: WebSocketHub
  registry: AgentRegistry
  gateway: AgentGateway
  knowledgeStoreImpl?: KnowledgeStore
}

/**
 * Resolve a decision and execute all side effects: trust delta, audit logging,
 * WS broadcasts, and forwarding to the agent's adapter.
 *
 * Used by both human-resolved (decisions.ts) and auto-resolved (tool-gate.ts) paths.
 *
 * When `autoResolved` is set on the resolution, trust deltas are skipped (no human
 * judgment = no trust signal) but audit logging and broadcasts still fire.
 */
export function resolveDecisionWithSideEffects(
  decisionId: string,
  resolution: Resolution,
  ctx: ResolveContext,
): { resolved: boolean; agentId?: string } {
  const resolved = ctx.decisionQueue.resolve(decisionId, resolution)
  if (!resolved) {
    return { resolved: false }
  }

  const agentId = resolved.event.agentId
  const handle = ctx.registry.getHandle(agentId)
  const currentTick = ctx.tickService.currentTick()

  const affectedArtifactIds = resolved.event.subtype === 'option'
    ? resolved.event.affectedArtifactIds
    : (resolved.event.affectedArtifactIds ?? [])
  const affectedWorkstreams = new Set<string>()
  const affectedArtifactKinds = new Set<ArtifactKind>()
  for (const artifactId of affectedArtifactIds) {
    const artifact = ctx.knowledgeStoreImpl?.getArtifact(artifactId)
    if (!artifact) continue
    affectedWorkstreams.add(artifact.workstream)
    affectedArtifactKinds.add(artifact.kind)
  }

  const isAutoResolved = resolution.type === 'tool_approval' && resolution.autoResolved === true

  // Apply trust delta based on resolution type — skip for auto-resolved decisions
  let effectiveDelta = 0
  const previousScore = ctx.trustEngine.getScore(agentId) ?? 50
  let newScore = previousScore

  if (!isAutoResolved) {
    const trustOutcome = mapResolutionToTrustOutcome(resolution, resolved.event)
    if (trustOutcome) {
      effectiveDelta = ctx.trustEngine.applyOutcome(
        agentId,
        trustOutcome,
        currentTick,
        {
          artifactKinds: [...affectedArtifactKinds],
          workstreams: [...affectedWorkstreams],
          toolCategory: resolved.event.subtype === 'tool_approval'
            ? classifyToolCategory(resolved.event.toolName)
            : undefined,
        },
      )
    }
    newScore = ctx.trustEngine.getScore(agentId) ?? 50
    for (const domainOutcome of ctx.trustEngine.flushDomainLog(agentId)) {
      ctx.knowledgeStoreImpl?.appendAuditLog(
        'trust_domain_outcome',
        agentId,
        'record',
        agentId,
        domainOutcome,
      )
    }
  }

  const trustOutcome = isAutoResolved ? undefined : mapResolutionToTrustOutcome(resolution, resolved.event)

  ctx.knowledgeStoreImpl?.appendAuditLog(
    'trust_outcome',
    decisionId,
    'decision_resolution',
    agentId,
    {
      agentId,
      outcome: trustOutcome,
      effectiveDelta,
      newScore,
      tick: currentTick,
      decisionSubtype: resolved.event.subtype,
      severity: resolved.event.subtype === 'option' ? resolved.event.severity : resolved.event.severity,
      blastRadius: resolved.event.subtype === 'option' ? resolved.event.blastRadius : resolved.event.blastRadius,
      toolName: resolved.event.subtype === 'tool_approval' ? resolved.event.toolName : undefined,
      affectedArtifactIds,
      affectedWorkstreams: [...affectedWorkstreams],
      affectedArtifactKinds: [...affectedArtifactKinds],
      autoResolved: isAutoResolved,
    },
  )

  // Broadcast trust update to frontend
  if (previousScore !== newScore) {
    ctx.wsHub.broadcast({
      type: 'trust_update',
      agentId,
      previousScore,
      newScore,
      delta: newScore - previousScore,
      reason: trustOutcome ?? 'resolution',
    })
  }

  // Forward resolution to the running agent if it's still alive
  if (handle) {
    const plugin = ctx.gateway.getPlugin(handle.pluginName)
    if (plugin) {
      plugin.resolveDecision(handle, decisionId, resolution).catch((err: Error) => {
        // eslint-disable-next-line no-console
        console.error(`[resolve-decision] failed to forward resolution to agent ${agentId}:`, err.message)
      })
    }
  }

  // Broadcast decision resolved to frontend
  ctx.wsHub.broadcast({
    type: 'decision_resolved',
    decisionId,
    resolution,
    agentId,
  })

  return { resolved: true, agentId }
}

function classifyToolCategory(toolName: string | undefined): string | undefined {
  if (!toolName) return undefined
  const normalized = toolName.toLowerCase()
  if (normalized.includes('read') || normalized.includes('list') || normalized.includes('grep') || normalized.includes('search') || normalized.includes('cat')) {
    return 'read'
  }
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch') || normalized.includes('update')) {
    return 'write'
  }
  return 'execute'
}
