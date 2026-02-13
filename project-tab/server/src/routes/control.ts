import { Router } from 'express'

import { setControlModeRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'

type ControlModeDeps = Pick<
  ApiRouteDeps,
  'controlMode' | 'wsHub' | 'registry' | 'trustEngine' | 'knowledgeStore'
>

/**
 * Creates routes for /api/control-mode endpoints.
 */
export function createControlModeRouter(deps: ControlModeDeps): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.status(200).json({ controlMode: deps.controlMode.getMode() })
  })

  router.put('/', async (req, res) => {
    const body = parseBody(req, res, setControlModeRequestSchema)
    if (!body) {
      return
    }

    deps.controlMode.setMode(body.controlMode)
    const snapshot = await deps.knowledgeStore.getSnapshot()

    // Broadcast state sync to frontend with updated control mode
    deps.wsHub.broadcast({
      type: 'state_sync',
      snapshot,
      activeAgents: deps.registry.listHandles(),
      trustScores: deps.trustEngine.getAllScores(),
      controlMode: body.controlMode
    })

    res.status(200).json({ controlMode: body.controlMode })
  })

  return router
}
