import { Router } from 'express'

import { resolveDecisionRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import { mapResolutionToTrustOutcome } from '../intelligence/trust-engine'

type DecisionsDeps = Pick<
  ApiRouteDeps,
  'decisionQueue' | 'trustEngine' | 'tickService' | 'wsHub' | 'registry' | 'gateway' | 'knowledgeStoreImpl'
>

/**
 * Creates routes for /api/decisions endpoints.
 */
export function createDecisionsRouter(deps: DecisionsDeps): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const pending = deps.decisionQueue.listPending()
    res.status(200).json({ decisions: pending })
  })

  router.post('/:id/resolve', (req, res) => {
    const body = parseBody(req, res, resolveDecisionRequestSchema)
    if (!body) {
      return
    }

    const decisionId = req.params.id
    const queued = deps.decisionQueue.get(decisionId)
    if (!queued) {
      res.status(404).json({ error: 'Decision not found' })
      return
    }

    const resolved = deps.decisionQueue.resolve(decisionId, body.resolution)
    if (!resolved) {
      res.status(409).json({ error: 'Decision already resolved or not pending' })
      return
    }

    const agentId = resolved.event.agentId
    const handle = deps.registry.getHandle(agentId)
    const currentTick = deps.tickService.currentTick()

    const affectedArtifactIds = resolved.event.subtype === 'option'
      ? resolved.event.affectedArtifactIds
      : (resolved.event.affectedArtifactIds ?? [])
    const affectedWorkstreams = new Set<string>()
    const affectedArtifactKinds = new Set<import('../types/events').ArtifactKind>()
    for (const artifactId of affectedArtifactIds) {
      const artifact = deps.knowledgeStoreImpl?.getArtifact(artifactId)
      if (!artifact) continue
      affectedWorkstreams.add(artifact.workstream)
      affectedArtifactKinds.add(artifact.kind)
    }

    // Apply trust delta based on resolution type
    const trustOutcome = mapResolutionToTrustOutcome(body.resolution, resolved.event)
    const previousScore = deps.trustEngine.getScore(agentId) ?? 50
    let effectiveDelta = 0
    if (trustOutcome) {
      effectiveDelta = deps.trustEngine.applyOutcome(
        agentId,
        trustOutcome,
        currentTick,
        {
          artifactKinds: [...affectedArtifactKinds],
          workstreams: [...affectedWorkstreams],
          toolCategory: resolved.event.subtype === 'tool_approval'
            ? classifyToolCategory(resolved.event.toolName)
            : undefined,
        }
      )
    }
    const newScore = deps.trustEngine.getScore(agentId) ?? 50
    for (const domainOutcome of deps.trustEngine.flushDomainLog(agentId)) {
      deps.knowledgeStoreImpl?.appendAuditLog(
        'trust_domain_outcome',
        agentId,
        'record',
        agentId,
        domainOutcome
      )
    }
    deps.knowledgeStoreImpl?.appendAuditLog(
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
      }
    )

    // Broadcast trust update to frontend
    if (previousScore !== newScore) {
      deps.wsHub.broadcast({
        type: 'trust_update',
        agentId,
        previousScore,
        newScore,
        delta: newScore - previousScore,
        reason: trustOutcome ?? 'resolution'
      })
    }

    // Forward resolution to the running agent if it's still alive
    if (handle) {
      const plugin = deps.gateway.getPlugin(handle.pluginName)
      if (plugin) {
        plugin.resolveDecision(handle, decisionId, body.resolution).catch((err: Error) => {
          // eslint-disable-next-line no-console
          console.error(`[decisions] failed to forward resolution to agent ${agentId}:`, err.message)
        })
      }
    }

    // Broadcast decision resolved to frontend
    deps.wsHub.broadcast({
      type: 'decision_resolved',
      decisionId,
      resolution: body.resolution,
      agentId
    })

    res.status(200).json({ resolved: true, decisionId, agentId })
  })

  return router
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
