import { Router } from 'express'

import { resolveDecisionRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { TrustOutcome } from '../intelligence/trust-engine'

/**
 * Creates routes for /api/decisions endpoints.
 */
export function createDecisionsRouter(deps: ApiRouteDeps): Router {
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

    // Apply trust delta based on resolution type
    const trustOutcome = mapResolutionToTrustOutcome(body.resolution, resolved.event)
    const previousScore = deps.trustEngine.getScore(agentId) ?? 50
    if (trustOutcome) {
      deps.trustEngine.applyOutcome(agentId, trustOutcome, deps.tickService.currentTick())
    }
    const newScore = deps.trustEngine.getScore(agentId) ?? 50

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

/** Maps a resolution + decision event to a TrustOutcome for the trust engine. */
function mapResolutionToTrustOutcome(
  resolution: import('../types').Resolution,
  event: import('../types').DecisionEvent
): TrustOutcome | null {
  if (resolution.type === 'option') {
    if (event.subtype === 'option' && event.recommendedOptionId) {
      if (resolution.chosenOptionId === event.recommendedOptionId) {
        return 'human_approves_recommended_option'
      }
      return 'human_picks_non_recommended'
    }
    return 'human_approves_recommended_option'
  }

  if (resolution.type === 'tool_approval') {
    if (resolution.action === 'approve') {
      if (resolution.alwaysApprove) {
        return 'human_approves_always'
      }
      return 'human_approves_tool_call'
    }
    if (resolution.action === 'reject') {
      return 'human_rejects_tool_call'
    }
    if (resolution.action === 'modify') {
      return 'human_modifies_tool_args'
    }
  }

  return null
}
