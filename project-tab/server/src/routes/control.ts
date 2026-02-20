import { Router } from 'express'

import { setControlModeRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'

type ControlModeDeps = Pick<
  ApiRouteDeps,
  'controlMode' | 'wsHub' | 'registry' | 'trustEngine' | 'knowledgeStore' | 'gateway'
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

    // Propagate control mode to all running agents so their decision gating updates
    const activeAgents = deps.registry.listHandles()
    for (const handle of activeAgents) {
      const plugin = deps.gateway.getPlugin(handle.pluginName)
      if (plugin) {
        plugin.updateBrief(handle, { controlMode: body.controlMode }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          // eslint-disable-next-line no-console
          console.error(`[control-mode] failed to update brief for agent ${handle.id}: ${msg}`)
        })
      }
    }

    const snapshot = await deps.knowledgeStore.getSnapshot()

    // Broadcast state sync to frontend with updated control mode
    deps.wsHub.broadcast({
      type: 'state_sync',
      snapshot,
      activeAgents,
      trustScores: deps.trustEngine.getAllScores(),
      controlMode: body.controlMode
    })

    res.status(200).json({ controlMode: body.controlMode })
  })

  return router
}
