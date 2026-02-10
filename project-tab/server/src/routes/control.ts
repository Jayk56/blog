import { Router } from 'express'

import { setControlModeRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'

/**
 * Creates routes for /api/control-mode endpoints.
 */
export function createControlModeRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.status(200).json({ controlMode: deps.controlMode.getMode() })
  })

  router.put('/', (req, res) => {
    const body = parseBody(req, res, setControlModeRequestSchema)
    if (!body) {
      return
    }

    deps.controlMode.setMode(body.controlMode)

    // Broadcast state sync to frontend with updated control mode
    deps.wsHub.broadcast({
      type: 'state_sync',
      snapshot: {
        version: 0,
        generatedAt: new Date().toISOString(),
        workstreams: [],
        pendingDecisions: [],
        recentCoherenceIssues: [],
        artifactIndex: [],
        activeAgents: deps.registry.listHandles().map((h) => ({
          id: h.id,
          role: 'agent',
          workstream: '',
          status: h.status,
          pluginName: h.pluginName
        })),
        estimatedTokens: 0
      },
      activeAgents: deps.registry.listHandles(),
      trustScores: deps.trustEngine.getAllScores(),
      controlMode: body.controlMode
    })

    res.status(200).json({ controlMode: body.controlMode })
  })

  return router
}
