import { Router } from 'express'

import type { ApiRouteDeps } from './index'

/**
 * Creates routes for /api/trust endpoints.
 */
export function createTrustRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/:agentId', (req, res) => {
    const agentId = req.params.agentId
    const score = deps.trustEngine.getScore(agentId)

    if (score === undefined) {
      res.status(404).json({ error: 'Agent trust profile not found' })
      return
    }

    res.status(200).json({
      agentId,
      score,
      config: deps.trustEngine.getConfig()
    })
  })

  return router
}
