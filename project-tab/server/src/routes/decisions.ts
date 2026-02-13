import { Router } from 'express'

import { resolveDecisionRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import { mapResolutionToTrustOutcome } from '../intelligence/trust-engine'

type DecisionsDeps = Pick<
  ApiRouteDeps,
  'decisionQueue' | 'trustEngine' | 'tickService' | 'wsHub' | 'registry' | 'gateway'
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
