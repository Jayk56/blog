import { Router } from 'express'

import { brakeActionSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { AgentHandle } from '../types'
import type { BrakeScope } from '../types/messages'

type BrakeDeps = Pick<
  ApiRouteDeps,
  'registry' | 'knowledgeStore' | 'gateway' | 'decisionQueue' | 'wsHub' | 'checkpointStore'
>

/**
 * Resolve which agent handles are affected by a given brake scope.
 * For workstream scope, queries the KnowledgeStore snapshot to find
 * agents assigned to that workstream.
 */
async function resolveAffectedHandles(deps: BrakeDeps, scope: BrakeScope): Promise<AgentHandle[]> {
  const allHandles = deps.registry.listHandles()
  const activeHandles = allHandles.filter((h) => h.status === 'running' || h.status === 'paused')

  if (scope.type === 'all') {
    return activeHandles
  }

  if (scope.type === 'agent') {
    const handle = deps.registry.getHandle(scope.agentId)
    return handle ? [handle] : []
  }

  // workstream scope: query knowledge store for agent-to-workstream mapping
  const snapshot = await deps.knowledgeStore.getSnapshot()
  const agentIdsInWorkstream = new Set(
    snapshot.activeAgents
      .filter((a) => a.workstream === scope.workstream)
      .map((a) => a.id)
  )

  return activeHandles.filter((h) => agentIdsInWorkstream.has(h.id))
}

/**
 * Creates routes for /api/brake endpoints.
 */
export function createBrakeRouter(deps: BrakeDeps): Router {
  const router = Router()

  router.post('/', (req, res) => {
    const body = parseBody(req, res, brakeActionSchema)
    if (!body) {
      return
    }

    resolveAffectedHandles(deps, body.scope).then((affectedHandles) => {
      const affectedAgentIds: string[] = []
      const actionPromises: Promise<void>[] = []

      for (const handle of affectedHandles) {
        affectedAgentIds.push(handle.id)
        const plugin = deps.gateway.getPlugin(handle.pluginName)

        if (body.behavior === 'kill' && plugin) {
          actionPromises.push(
            plugin.kill(handle, { grace: false }).then(() => {
              deps.decisionQueue.handleAgentKilled(handle.id)
              deps.registry.removeHandle(handle.id)
            }).catch((err: Error) => {
              // eslint-disable-next-line no-console
              console.error(`[brake] failed to kill agent ${handle.id}:`, err.message)
            })
          )
        } else if (body.behavior === 'pause' && plugin) {
          actionPromises.push(
            plugin.pause(handle).then(() => {
              deps.registry.updateHandle(handle.id, { status: 'paused' })
              deps.decisionQueue.suspendAgentDecisions(handle.id)
            }).catch((err: Error) => {
              // eslint-disable-next-line no-console
              console.error(`[brake] failed to pause agent ${handle.id}:`, err.message)
            })
          )
        }
      }

      return Promise.all(actionPromises).then(() => {
        deps.wsHub.broadcast({
          type: 'brake',
          action: body,
          affectedAgentIds
        })

        res.status(200).json({
          brakeApplied: true,
          behavior: body.behavior,
          affectedAgentIds
        })
      })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Brake failed', message: err.message })
    })
  })

  router.post('/release', (_req, res) => {
    // Resume all paused agents via their plugins
    const pausedHandles = deps.registry.listHandles({ status: 'paused' })
    const resumePromises: Promise<{ agentId: string; success: boolean }>[] = []

    for (const handle of pausedHandles) {
      const plugin = deps.gateway.getPlugin(handle.pluginName)
      const checkpoint = deps.checkpointStore.getLatestCheckpoint(handle.id)

      if (plugin && checkpoint) {
        resumePromises.push(
          plugin.resume(checkpoint.state).then((newHandle) => {
            deps.registry.updateHandle(handle.id, { status: newHandle.status })
            deps.decisionQueue.resumeAgentDecisions(handle.id)
            return { agentId: handle.id, success: true }
          }).catch((err: Error) => {
            // eslint-disable-next-line no-console
            console.error(`[brake/release] failed to resume agent ${handle.id}:`, err.message)
            return { agentId: handle.id, success: false }
          })
        )
      } else {
        // No plugin or checkpoint — just update metadata as fallback
        deps.registry.updateHandle(handle.id, { status: 'running' })
        deps.decisionQueue.resumeAgentDecisions(handle.id)
        resumePromises.push(Promise.resolve({ agentId: handle.id, success: true }))
      }
    }

    Promise.all(resumePromises).then((results) => {
      const resumed = results.filter((r) => r.success).map((r) => r.agentId)
      const failed = results.filter((r) => !r.success).map((r) => r.agentId)
      res.status(200).json({ released: true, resumedAgentIds: resumed, failedAgentIds: failed })
    })
  })

  return router
}
