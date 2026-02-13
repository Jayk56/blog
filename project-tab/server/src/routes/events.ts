import { Router } from 'express'

import type { ApiRouteDeps } from './index'
import type { EventFilter } from '../intelligence/knowledge-store'

/**
 * Creates routes for /api/events endpoint.
 * Exposes the persisted event log with optional query filters.
 */
export function createEventsRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/', (req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(501).json({ error: 'Event query not supported' })
      return
    }

    const filter: EventFilter = {}

    if (typeof req.query.agentId === 'string' && req.query.agentId !== '') {
      filter.agentId = req.query.agentId
    }
    if (typeof req.query.runId === 'string' && req.query.runId !== '') {
      filter.runId = req.query.runId
    }
    if (typeof req.query.types === 'string') {
      const parsed = req.query.types.split(',').filter(Boolean) as NonNullable<EventFilter['types']>
      if (parsed.length > 0) {
        filter.types = parsed
      }
    }
    if (typeof req.query.since === 'string' && req.query.since !== '') {
      filter.since = req.query.since
    }

    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100
    filter.limit = Math.max(0, Math.min(Number.isNaN(rawLimit) ? 100 : rawLimit, 1000))

    try {
      if (filter.limit === 0) {
        res.status(200).json({ events: [], count: 0 })
        return
      }
      const events = deps.knowledgeStoreImpl.getEvents(filter)
      res.status(200).json({ events, count: events.length })
    } catch (err) {
      res.status(500).json({ error: 'Failed to query events', message: (err as Error).message })
    }
  })

  return router
}
