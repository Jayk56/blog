import { Router } from 'express'

import type { TickService } from '../tick'
import { tickAdvanceRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'

/** Tick route dependencies. */
export interface TickRouteDeps {
  tickService: TickService
}

/**
 * Creates routes for /api/tick endpoints.
 */
export function createTickRouter(deps: TickRouteDeps): Router {
  const router = Router()

  router.post('/advance', (req, res) => {
    const body = parseBody(req, res, tickAdvanceRequestSchema)
    if (!body) {
      return
    }

    if (deps.tickService.getMode() !== 'manual') {
      res.status(409).json({
        error: 'Invalid mode',
        message: 'Tick advancement is only available in manual mode',
        mode: deps.tickService.getMode()
      })
      return
    }

    const tick = deps.tickService.advance(body.steps)

    res.status(200).json({
      tick,
      advancedBy: body.steps,
      mode: deps.tickService.getMode()
    })
  })

  return router
}
