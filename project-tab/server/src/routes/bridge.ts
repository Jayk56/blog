import { Router } from 'express'
import { z } from 'zod'

import { adapterEventSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { EventEnvelope } from '../types/events'
import type { TeamsBridgePlugin } from '../gateway/teams-bridge-plugin'

const registerSchema = z.object({
  agentId: z.string().min(1),
  role: z.string().min(1).optional(),
  workstream: z.string().min(1).optional(),
})

type BridgeDeps = Pick<ApiRouteDeps, 'eventBus' | 'registry' | 'trustEngine' | 'tickService' | 'wsHub' | 'knowledgeStore' | 'controlMode'> & {
  bridgePlugin: TeamsBridgePlugin
}

/**
 * Creates routes for /api/bridge endpoints.
 *
 * POST /api/bridge/events           - Ingest an AdapterEvent from an agent hook
 * POST /api/bridge/register         - Agent self-registration (lifecycle:started)
 * GET  /api/bridge/context/:agentId - Agent polls for pending context injection
 * GET  /api/bridge/brake/:agentId   - Agent checks if brake is active
 */
export function createBridgeRouter(deps: BridgeDeps): Router {
  const router = Router()

  // POST /api/bridge/events — ingest an AdapterEvent from an agent hook
  router.post('/events', (req, res) => {
    const body = parseBody(req, res, adapterEventSchema)
    if (!body) return

    const now = new Date().toISOString()
    const envelope: EventEnvelope = {
      sourceEventId: body.sourceEventId,
      sourceSequence: body.sourceSequence,
      sourceOccurredAt: body.sourceOccurredAt,
      runId: body.runId,
      event: body.event as EventEnvelope['event'],
      ingestedAt: now,
    }

    // Track sequence for checkpoint
    const agentId = body.event.agentId
    deps.bridgePlugin.updateSequence(agentId, body.sourceSequence)

    // Auto-register unknown agents on first event
    if (!deps.registry.getHandle(agentId)) {
      const handle = {
        id: agentId,
        pluginName: 'teams-bridge',
        status: 'running' as const,
        sessionId: `bridge-${agentId}-${Date.now()}`,
      }
      deps.bridgePlugin.registerHandle(handle)
      deps.registry.registerHandle(handle)
      deps.trustEngine.registerAgent(agentId, deps.tickService.currentTick())
    }

    // Publish to EventBus — the existing handler chain takes over
    deps.eventBus.publish(envelope)

    res.status(200).json({ ingested: true })
  })

  // POST /api/bridge/register — agent self-registration
  router.post('/register', (req, res) => {
    const body = parseBody(req, res, registerSchema)
    if (!body) return

    const { agentId } = body

    // Check if already registered
    if (deps.registry.getHandle(agentId)) {
      res.status(200).json({ registered: true, agentId, alreadyExists: true })
      return
    }

    const handle = {
      id: agentId,
      pluginName: 'teams-bridge',
      status: 'running' as const,
      sessionId: `bridge-${agentId}-${Date.now()}`,
    }

    deps.bridgePlugin.registerHandle(handle)
    deps.registry.registerHandle(handle)
    deps.trustEngine.registerAgent(agentId, deps.tickService.currentTick())

    // Emit a lifecycle:started event through the bus
    const now = new Date().toISOString()
    const startedEnvelope: EventEnvelope = {
      sourceEventId: `bridge-register-${agentId}-${Date.now()}`,
      sourceSequence: 0,
      sourceOccurredAt: now,
      runId: `bridge-${agentId}`,
      ingestedAt: now,
      event: {
        type: 'lifecycle',
        agentId,
        action: 'started',
        reason: 'Agent self-registered via bridge',
      },
    }
    deps.eventBus.publish(startedEnvelope)

    res.status(201).json({ registered: true, agentId })
  })

  // GET /api/bridge/context/:agentId — agent polls for pending context
  router.get('/context/:agentId', (req, res) => {
    const { agentId } = req.params

    deps.bridgePlugin.consumeContext(agentId).then((injection) => {
      if (!injection) {
        res.status(204).end()
        return
      }
      res.status(200).json({ injection })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Failed to read context', message: err.message })
    })
  })

  // GET /api/bridge/brake/:agentId — agent checks if brake is active
  router.get('/brake/:agentId', (req, res) => {
    const { agentId } = req.params

    deps.bridgePlugin.isBrakeActive(agentId).then((active) => {
      res.status(200).json({ active })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Failed to check brake', message: err.message })
    })
  })

  return router
}
