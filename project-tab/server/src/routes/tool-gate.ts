import { Router } from 'express'
import { randomUUID } from 'node:crypto'

import { toolGateRequestSchema } from '../validation/schemas'
import { parseBody } from './utils'
import type { ApiRouteDeps } from './index'
import type { Severity, BlastRadius, ControlMode, ToolApprovalEvent, EventEnvelope } from '../types/events'
import { resolveDecisionWithSideEffects } from '../lib/resolve-decision'

type ToolGateDeps = Pick<
  ApiRouteDeps,
  'decisionQueue' | 'eventBus' | 'tickService' | 'registry' | 'controlMode' | 'trustEngine' | 'wsHub' | 'gateway' | 'knowledgeStoreImpl'
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
 * Classify a bash command as 'safe' or 'destructive'.
 * Matches on the first command token (before &&, ;, |).
 * Unrecognized commands default to 'destructive' (safe default).
 */
export function classifyBashRisk(command: string): 'safe' | 'destructive' {
  const trimmed = command.trim()
  // Extract the first token before any chaining operators
  const firstSegment = trimmed.split(/\s*(?:&&|\|\||[;|])\s*/)[0] ?? ''
  // Get the command name (possibly with path prefix like npx/node)
  const tokens = firstSegment.trim().split(/\s+/)
  const first = tokens[0] ?? ''

  // Handle prefix commands: npx, node -e, python -c, etc.
  const baseCmd = first.replace(/^.*\//, '') // strip path prefix

  const safeCommands = new Set([
    // Shell builtins / navigation
    'cd', 'pushd', 'popd', 'source', 'export', 'set', 'true', 'false',
    // Test runners
    'npx', 'npm', 'jest', 'pytest', 'vitest', 'mocha',
    // Read-only git
    'git',
    // Build / inspection tools
    'node', 'tsc', 'tsx', 'bun', 'deno',
    'ls', 'pwd', 'which', 'echo', 'cat', 'head', 'tail', 'wc',
    'grep', 'rg', 'find', 'tree', 'file', 'stat', 'du', 'df',
    'env', 'printenv', 'whoami', 'hostname', 'date', 'uname',
    // Directory creation (non-destructive)
    'mkdir',
  ])

  const destructiveCommands = new Set([
    'rm', 'unlink', 'rmdir', 'kill', 'pkill', 'killall',
    'mv', 'cp', // can overwrite files
    'chmod', 'chown', 'chgrp',
    'docker', 'kubectl',
    'curl', 'wget', // network mutations possible
  ])

  // Check the base command first
  if (destructiveCommands.has(baseCmd)) {
    return 'destructive'
  }

  if (!safeCommands.has(baseCmd)) {
    return 'destructive' // unrecognized = destructive (safe default)
  }

  // For known-safe base commands, check subcommands for destructive patterns
  if (baseCmd === 'git') {
    const gitSubcmd = tokens[1] ?? ''
    const safeGitSubcommands = new Set([
      'status', 'diff', 'log', 'branch', 'show', 'stash', 'tag',
      'remote', 'config', 'describe', 'shortlog', 'blame', 'ls-files',
      'ls-tree', 'rev-parse', 'name-rev', 'reflog',
    ])
    if (!safeGitSubcommands.has(gitSubcmd)) {
      return 'destructive'
    }
  }

  if (baseCmd === 'npm' || baseCmd === 'npx') {
    const sub = tokens[1] ?? ''
    const destructiveNpmSubs = new Set(['publish', 'unpublish', 'deprecate', 'uninstall'])
    if (destructiveNpmSubs.has(sub)) {
      return 'destructive'
    }
  }

  return 'safe'
}

/** Auto-resolve trust thresholds for adaptive mode. */
const ADAPTIVE_THRESHOLDS = {
  small: 30,
  medium: 50,
  largeSafe: 60,
  largeDestructive: 80,
} as const

/**
 * Determine whether a tool-gate request should be auto-resolved.
 * Returns true if the request should be auto-approved without human intervention.
 */
export function shouldAutoResolve(
  mode: ControlMode,
  blastRadius: BlastRadius,
  trustScore: number,
  bashRisk?: 'safe' | 'destructive',
): boolean {
  if (mode === 'orchestrator') return false

  if (mode === 'ecosystem') {
    // Ecosystem auto-approves everything except destructive bash
    if (blastRadius === 'large' && bashRisk === 'destructive') return false
    return true
  }

  // Adaptive mode — threshold depends on blast radius and bash risk
  if (mode === 'adaptive') {
    if (blastRadius === 'small' || blastRadius === 'trivial') {
      return trustScore >= ADAPTIVE_THRESHOLDS.small
    }
    if (blastRadius === 'medium') {
      return trustScore >= ADAPTIVE_THRESHOLDS.medium
    }
    if (blastRadius === 'large') {
      const threshold = bashRisk === 'destructive'
        ? ADAPTIVE_THRESHOLDS.largeDestructive
        : ADAPTIVE_THRESHOLDS.largeSafe
      return trustScore >= threshold
    }
  }

  return false
}

/**
 * Creates routes for /api/tool-gate endpoints.
 *
 * POST /request-approval — blocking endpoint called by the PreToolUse hook script.
 * Enqueues a ToolApprovalEvent in the decision queue, publishes to the event bus,
 * and either auto-resolves (ecosystem/adaptive mode) or long-polls until the human
 * resolves it or the timeout expires.
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
    const blastRadius = classifyBlastRadius(toolName)
    const event: ToolApprovalEvent = {
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId,
      toolName,
      toolArgs: toolInput,
      reasoning,
      severity: classifySeverity(toolName),
      blastRadius,
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

    // Check if we should auto-resolve based on control mode + trust
    const mode = deps.controlMode.getMode()
    const trustScore = deps.trustEngine.getScore(agentId) ?? 50
    const bashRisk = toolName === 'Bash'
      ? classifyBashRisk(typeof toolInput?.command === 'string' ? toolInput.command : '')
      : undefined

    if (shouldAutoResolve(mode, blastRadius, trustScore, bashRisk)) {
      const autoResolution = {
        type: 'tool_approval' as const,
        action: 'approve' as const,
        rationale: `Auto-approved by ${mode} mode`,
        actionKind: 'review' as const,
        autoResolved: true,
      }

      resolveDecisionWithSideEffects(decisionId, autoResolution, deps)

      res.status(200).json({
        decisionId,
        action: 'approve',
        rationale: autoResolution.rationale,
        timedOut: false,
        autoResolved: true,
      })
      return
    }

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
