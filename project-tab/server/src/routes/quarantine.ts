import { Router } from 'express'

import { getQuarantined, clearQuarantine } from '../validation/quarantine'

/**
 * Creates the quarantine router with endpoints for inspecting and clearing
 * quarantined malformed events.
 */
export function createQuarantineRouter(): Router {
  const router = Router()

  /** GET /api/quarantine — returns all quarantined malformed events. */
  router.get('/', (_req, res) => {
    const events = getQuarantined()
    res.status(200).json({ events })
  })

  /** DELETE /api/quarantine — clears the quarantine store. */
  router.delete('/', (_req, res) => {
    clearQuarantine()
    res.status(200).json({ cleared: true })
  })

  return router
}
