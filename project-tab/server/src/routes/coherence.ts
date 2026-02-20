import { Router } from 'express'
import type { CoherenceMonitor } from '../intelligence/coherence-monitor'

interface CoherenceDeps {
  coherenceMonitor: CoherenceMonitor
}

/**
 * Creates routes for /api/coherence endpoints.
 */
export function createCoherenceRouter(deps: CoherenceDeps): Router {
  const router = Router()

  router.get('/feedback-loop', (_req, res) => {
    const status = deps.coherenceMonitor.getFeedbackLoopStatus()
    const history = deps.coherenceMonitor.getThresholdHistory()
    res.status(200).json({ ...status, history })
  })

  return router
}
