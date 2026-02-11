import { Router } from 'express'

import {
  killAgentRequestSchema,
  pauseAgentRequestSchema,
  resumeAgentRequestSchema,
  spawnAgentRequestSchema,
  submitCheckpointRequestSchema,
  updateAgentBriefRequestSchema
} from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { AgentBrief, SerializedAgentState } from '../types'

/**
 * Creates routes for /api/agents endpoints.
 */
export function createAgentsRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const agents = deps.registry.listHandles()
    res.status(200).json({ agents })
  })

  router.get('/:id', (req, res) => {
    const handle = deps.registry.getHandle(req.params.id)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    res.status(200).json({ agent: handle })
  })

  router.post('/spawn', (req, res) => {
    const body = parseBody(req, res, spawnAgentRequestSchema)
    if (!body) {
      return
    }

    const brief = body.brief as unknown as AgentBrief
    const pluginName = brief.modelPreference ?? deps.defaultPlugin ?? 'openai'

    deps.gateway.spawn(brief, pluginName).then(async (handle) => {
      deps.registry.registerHandle(handle)
      deps.trustEngine.registerAgent(handle.id, deps.tickService.currentTick())

      const snapshot = await deps.knowledgeStore.getSnapshot()

      deps.wsHub.broadcast({
        type: 'state_sync',
        snapshot,
        activeAgents: deps.registry.listHandles(),
        trustScores: deps.trustEngine.getAllScores(),
        controlMode: deps.controlMode.getMode()
      })

      deps.contextInjection?.registerAgent(brief)

      res.status(201).json({ agent: handle })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Spawn failed', message: err.message })
    })
  })

  router.post('/:id/kill', (req, res) => {
    const body = parseBody(req, res, killAgentRequestSchema)
    if (!body) {
      return
    }

    const handle = deps.registry.getHandle(req.params.id)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const plugin = deps.gateway.getPlugin(handle.pluginName)
    if (!plugin) {
      res.status(500).json({ error: 'Plugin not found', pluginName: handle.pluginName })
      return
    }

    plugin.kill(handle, { grace: body.grace, graceTimeoutMs: body.graceTimeoutMs }).then((killResponse) => {
      // Handle orphaned decisions
      const orphaned = deps.decisionQueue.handleAgentKilled(handle.id)

      deps.registry.removeHandle(handle.id)
      deps.contextInjection?.removeAgent(handle.id)

      res.status(200).json({
        killed: true,
        cleanShutdown: killResponse.cleanShutdown,
        artifactsExtracted: killResponse.artifactsExtracted,
        orphanedDecisions: orphaned.length
      })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Kill failed', message: err.message })
    })
  })

  router.post('/:id/pause', (req, res) => {
    const body = parseBody(req, res, pauseAgentRequestSchema)
    if (body === null) {
      return
    }

    const handle = deps.registry.getHandle(req.params.id)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const plugin = deps.gateway.getPlugin(handle.pluginName)
    if (!plugin) {
      res.status(500).json({ error: 'Plugin not found', pluginName: handle.pluginName })
      return
    }

    plugin.pause(handle).then((state) => {
      deps.registry.updateHandle(handle.id, { status: 'paused' })
      res.status(200).json({ paused: true, agentId: handle.id, serializedState: state })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Pause failed', message: err.message })
    })
  })

  router.post('/:id/resume', (req, res) => {
    const body = parseBody(req, res, resumeAgentRequestSchema)
    if (body === null) {
      return
    }

    const handle = deps.registry.getHandle(req.params.id)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const plugin = deps.gateway.getPlugin(handle.pluginName)
    if (!plugin) {
      res.status(500).json({ error: 'Plugin not found', pluginName: handle.pluginName })
      return
    }

    // Get latest checkpoint for the agent to pass to the plugin
    const checkpoint = deps.checkpointStore.getLatestCheckpoint(handle.id)
    if (!checkpoint) {
      // No checkpoint available — can't resume the actual process
      res.status(409).json({ error: 'No checkpoint available to resume from' })
      return
    }

    plugin.resume(checkpoint.state).then((newHandle) => {
      deps.registry.updateHandle(handle.id, { status: newHandle.status })
      res.status(200).json({ resumed: true, agentId: handle.id })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Resume failed', message: err.message })
    })
  })

  router.patch('/:id/brief', (req, res) => {
    const body = parseBody(req, res, updateAgentBriefRequestSchema)
    if (!body) {
      return
    }

    const handle = deps.registry.getHandle(req.params.id)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const plugin = deps.gateway.getPlugin(handle.pluginName)
    if (!plugin) {
      res.status(500).json({ error: 'Plugin not found', pluginName: handle.pluginName })
      return
    }

    plugin.updateBrief(handle, body as unknown as Partial<AgentBrief>).then(() => {
      const changes = body as unknown as Partial<AgentBrief>
      deps.contextInjection?.updateAgentBrief(handle.id, changes)
      deps.contextInjection?.onBriefUpdated(handle.id).catch(() => {
        // Best effort — injection failure doesn't invalidate the brief update
      })
      res.status(200).json({ updated: true, agentId: handle.id })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Brief update failed', message: err.message })
    })
  })

  // Checkpoint endpoints
  router.post('/:id/checkpoint', (req, res) => {
    const body = parseBody(req, res, submitCheckpointRequestSchema)
    if (!body) {
      return
    }

    const agentId = req.params.id

    // Verify agent ID in URL matches the body
    if (body.agentId !== agentId) {
      res.status(400).json({ error: 'Agent ID in URL does not match body' })
      return
    }

    const handle = deps.registry.getHandle(agentId)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const state: SerializedAgentState = {
      agentId: body.agentId,
      pluginName: body.pluginName,
      sessionId: body.sessionId,
      checkpoint: body.checkpoint as SerializedAgentState['checkpoint'],
      briefSnapshot: body.briefSnapshot as unknown as AgentBrief,
      conversationSummary: body.conversationSummary,
      pendingDecisionIds: body.pendingDecisionIds,
      lastSequence: body.lastSequence,
      serializedAt: body.serializedAt,
      serializedBy: body.serializedBy,
      estimatedSizeBytes: body.estimatedSizeBytes,
    }

    try {
      deps.checkpointStore.storeCheckpoint(state, body.decisionId)
      const count = deps.checkpointStore.getCheckpointCount(agentId)
      res.status(201).json({ stored: true, agentId, checkpointCount: count })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      res.status(500).json({ error: 'Checkpoint storage failed', message })
    }
  })

  router.get('/:id/checkpoints', (req, res) => {
    const agentId = req.params.id

    const handle = deps.registry.getHandle(agentId)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const checkpoints = deps.checkpointStore.getCheckpoints(agentId)
    res.status(200).json({ agentId, checkpoints })
  })

  router.get('/:id/checkpoints/latest', (req, res) => {
    const agentId = req.params.id

    const handle = deps.registry.getHandle(agentId)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const checkpoint = deps.checkpointStore.getLatestCheckpoint(agentId)
    if (!checkpoint) {
      res.status(404).json({ error: 'No checkpoints found for this agent' })
      return
    }

    res.status(200).json({ agentId, checkpoint })
  })

  return router
}
