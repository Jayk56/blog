import { Router } from 'express'
import { randomUUID } from 'node:crypto'

import { toolGateRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { Severity, BlastRadius, ToolApprovalEvent, EventEnvelope } from '../types/events'

type ToolGateDeps = Pick<
  ApiRouteDeps,
  'decisionQueue' | 'eventBus' | 'tickService' | 'registry'
>

/** Default timeout for blocking wait (5 minutes). */
const WAIT_TIMEOUT_MS = 300_000

/** Classify tool severity for the decision queue. */
export function classifySeverity(toolName: string): Severity {
  switch (toolName) {
    case 'Bash':
      return 'high'
    case 'Write':
    case 'Edit':
      return 'medium'
    default:
      return 'low'
  }
}

/** Classify tool blast radius for the decision queue. */
export function classifyBlastRadius(toolName: string): BlastRadius {
  switch (toolName) {
    case 'Bash':
      return 'large'
    case 'Write':
    case 'Edit':
      return 'medium'
    default:
      return 'small'
  }
}

/**
 * Creates routes for /api/tool-gate endpoints.
 *
 * POST /request-approval — blocking endpoint called by the PreToolUse hook script.
 * Enqueues a ToolApprovalEvent in the decision queue, publishes to the event bus,
 * and long-polls until the human resolves it or the timeout expires.
 *
 * GET /stats — returns aggregate counts of tool-gate decisions grouped by status.
 */
export function createToolGateRouter(deps: ToolGateDeps): Router {
  const router = Router()

  // Track the latest reasoning text per agent from status events.
  // When a tool-gate request arrives, we attach the most recent reasoning
  // so the human reviewer can see WHY the agent wants to use the tool.
  const latestReasoning = new Map<string, string>()

  deps.eventBus.subscribe({ eventType: 'status' }, (envelope) => {
    const evt = envelope.event
    if (evt.type === 'status' && typeof evt.message === 'string' && evt.message.length > 0) {
      latestReasoning.set(evt.agentId, evt.message)
    }
  })

  router.get('/stats', (_req, res) => {
    const all = deps.decisionQueue.listAll()
    const toolApprovals = all.filter(d => d.event.subtype === 'tool_approval')
    const total = toolApprovals.length
    const pending = toolApprovals.filter(d => d.status === 'pending').length
    const resolved = toolApprovals.filter(d => d.status === 'resolved').length
    const timedOut = toolApprovals.filter(d => d.status === 'timed_out').length
    res.status(200).json({ total, pending, resolved, timedOut })
  })

  router.post('/request-approval', async (req, res) => {
    const body = parseBody(req, res, toolGateRequestSchema)
    if (!body) return

    const { agentId, toolName, toolInput, toolUseId } = body

    // Verify agent exists
    const handle = deps.registry.getHandle(agentId)
    if (!handle) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const decisionId = randomUUID()
    const tick = deps.tickService.currentTick()

    // Attach the agent's most recent reasoning text (from the preceding assistant message)
    const reasoning = latestReasoning.get(agentId)

    // Construct ToolApprovalEvent
    const event: ToolApprovalEvent = {
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId,
      toolName,
      toolArgs: toolInput,
      reasoning,
      severity: classifySeverity(toolName),
      blastRadius: classifyBlastRadius(toolName),
    }

    // Enqueue first so waitForResolution callback is registered before publishing
    deps.decisionQueue.enqueue(event, tick)

    // Publish to event bus for WebSocket broadcast to frontend
    const envelope: EventEnvelope = {
      sourceEventId: randomUUID(),
      sourceSequence: 0,
      sourceOccurredAt: new Date().toISOString(),
      runId: `tool-gate-${agentId}`,
      ingestedAt: new Date().toISOString(),
      event,
    }
    deps.eventBus.publish(envelope)

    // Block until resolved or timeout
    try {
      const resolution = await Promise.race([
        deps.decisionQueue.waitForResolution(decisionId),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('timeout')), WAIT_TIMEOUT_MS)
        ),
      ])

      res.status(200).json({
        decisionId,
        action: resolution.type === 'tool_approval' ? resolution.action : 'approve',
        rationale: resolution.type === 'tool_approval' ? resolution.rationale : undefined,
        timedOut: false,
      })
    } catch {
      // Timeout — auto-resolve with reject
      const timeoutResolution = {
        type: 'tool_approval' as const,
        action: 'reject' as const,
        rationale: 'Timed out waiting for human approval',
        actionKind: 'review' as const,
      }
      deps.decisionQueue.resolve(decisionId, timeoutResolution)

      res.status(200).json({
        decisionId,
        action: 'reject',
        rationale: 'Timed out waiting for human approval',
        timedOut: true,
      })
    }
  })

  return router
}
