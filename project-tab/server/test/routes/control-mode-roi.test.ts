import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'

import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { createInsightsRouter } from '../../src/routes/insights'
import { listenEphemeral } from '../helpers/listen-ephemeral'
import type { ControlMode } from '../../src/types/events'

let server: Server | null = null

afterEach(() => {
  if (server) {
    server.close()
    server = null
  }
})

async function createTestServer(initialMode: ControlMode = 'orchestrator', currentTick = 100) {
  const ks = new KnowledgeStore(':memory:')
  let mode = initialMode

  const app = express()
  app.use(express.json())
  app.use(
    '/api/insights',
    createInsightsRouter({
      knowledgeStoreImpl: ks,
      controlMode: {
        getMode: () => mode,
        setMode: (m: ControlMode) => { mode = m },
      },
      tickService: {
        currentTick: () => currentTick,
      } as any,
    }),
  )

  server = createServer(app as any)
  const port = await listenEphemeral(server)
  const baseUrl = `http://localhost:${port}`

  return { baseUrl, ks }
}

async function postROI(baseUrl: string) {
  return fetch(`${baseUrl}/api/insights/control-mode-roi`, { method: 'POST' })
}

describe('POST /api/insights/control-mode-roi', () => {
  it('returns empty report when no audit data exists', async () => {
    const { baseUrl } = await createTestServer()

    const res = await postROI(baseUrl)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalDecisionsAnalyzed).toBe(0)
    expect(body.perModeMetrics).toHaveLength(1)
    expect(body.perModeMetrics[0].mode).toBe('orchestrator')
    expect(body.perModeMetrics[0].totalTicks).toBe(101) // 0 to 100 inclusive
  })

  it('attributes trust outcomes to correct mode using intervals', async () => {
    const { baseUrl, ks } = await createTestServer('adaptive', 80)

    // Mode change at tick 30: orchestrator -> adaptive
    ks.appendAuditLog('control_mode_change', 'mc-30', 'mode_changed', undefined, {
      previousMode: 'orchestrator',
      newMode: 'adaptive',
      tick: 30,
    })

    // Trust outcome in orchestrator mode
    ks.appendAuditLog('trust_outcome', 'd-10', 'decision_resolution', 'agent-1', {
      agentId: 'agent-1',
      outcome: 'human_overrides_agent_decision',
      tick: 10,
    })

    // Trust outcome in adaptive mode
    ks.appendAuditLog('trust_outcome', 'd-50', 'decision_resolution', 'agent-1', {
      agentId: 'agent-1',
      outcome: 'human_approves_tool_call',
      tick: 50,
    })

    const res = await postROI(baseUrl)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalDecisionsAnalyzed).toBe(2)

    const orch = body.perModeMetrics.find((m: any) => m.mode === 'orchestrator')
    const adapt = body.perModeMetrics.find((m: any) => m.mode === 'adaptive')

    expect(orch.totalDecisions).toBe(1)
    expect(orch.overrideCount).toBe(1)
    expect(adapt.totalDecisions).toBe(1)
    expect(adapt.overrideCount).toBe(0)
  })

  it('includes coherence issues in the report', async () => {
    const { baseUrl, ks } = await createTestServer('orchestrator', 50)

    ks.appendAuditLog('coherence_issue', 'ci-10', 'create', undefined, { tick: 10 })
    ks.appendAuditLog('trust_outcome', 'd-5', 'decision_resolution', 'agent-1', {
      agentId: 'agent-1',
      outcome: 'human_approves_tool_call',
      tick: 5,
    })

    const res = await postROI(baseUrl)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.perModeMetrics[0].coherenceIssueCount).toBe(1)
    expect(body.perModeMetrics[0].coherenceIssueRate).toBe(1)
  })

  it('returns 503 when knowledge store is not available', async () => {
    const app = express()
    app.use(express.json())
    app.use(
      '/api/insights',
      createInsightsRouter({
        knowledgeStoreImpl: undefined,
        controlMode: { getMode: () => 'orchestrator' as ControlMode, setMode: () => {} },
        tickService: { currentTick: () => 0 } as any,
      }),
    )

    server = createServer(app as any)
    const port = await listenEphemeral(server)

    const res = await fetch(`http://localhost:${port}/api/insights/control-mode-roi`, { method: 'POST' })
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('Knowledge store not available')
  })

  it('returns analysis window spanning trust outcome ticks', async () => {
    const { baseUrl, ks } = await createTestServer('orchestrator', 100)

    ks.appendAuditLog('trust_outcome', 'd-20', 'decision_resolution', 'a1', {
      agentId: 'a1', outcome: 'human_approves_tool_call', tick: 20,
    })
    ks.appendAuditLog('trust_outcome', 'd-80', 'decision_resolution', 'a1', {
      agentId: 'a1', outcome: 'human_approves_tool_call', tick: 80,
    })

    const res = await postROI(baseUrl)
    const body = await res.json()

    expect(body.analysisWindow).toEqual({ startTick: 20, endTick: 80 })
  })
})
