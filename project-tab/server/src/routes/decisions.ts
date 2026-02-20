import { Router } from 'express'

import { resolveDecisionRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import { resolveDecisionWithSideEffects } from '../lib/resolve-decision'

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

    const result = resolveDecisionWithSideEffects(decisionId, body.resolution, deps)
    if (!result.resolved) {
      res.status(409).json({ error: 'Decision already resolved or not pending' })
      return
    }

    res.status(200).json({ resolved: true, decisionId, agentId: result.agentId })
  })

  return router
}
