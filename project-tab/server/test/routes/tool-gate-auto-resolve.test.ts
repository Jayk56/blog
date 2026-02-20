import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import express from 'express'

import { listenEphemeral } from '../helpers/listen-ephemeral'
import { createToolGateRouter, classifyBashRisk, shouldAutoResolve } from '../../src/routes/tool-gate'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import type { AgentRegistry, AgentGateway, ControlModeManager } from '../../src/types/service-interfaces'
import type { WebSocketHub } from '../../src/ws-hub'
import type { AgentHandle } from '../../src/types'
import type { ControlMode } from '../../src/types/events'

// ── Test helpers ─────────────────────────────────────────────────

function createMockRegistry(handles: Map<string, AgentHandle> = new Map()): AgentRegistry {
  return {
    getHandle: (id: string) => handles.get(id) ?? null,
    listHandles: () => Array.from(handles.values()),
    registerHandle: (handle: AgentHandle) => { handles.set(handle.id, handle) },
    updateHandle: () => {},
    removeHandle: (id: string) => { handles.delete(id) },
  }
}

function createMockWsHub(): WebSocketHub {
  return {
    broadcast: () => {},
    handleUpgrade: () => {},
  } as unknown as WebSocketHub
}

function createMockGateway(): AgentGateway {
  return {
    getPlugin: () => undefined,
    spawn: async () => ({ id: '', pluginName: '', status: 'running' as const, sessionId: '' }),
  }
}

function createMockControlMode(initial: ControlMode = 'orchestrator'): ControlModeManager {
  let mode: ControlMode = initial
  return {
    getMode: () => mode,
    setMode: (m: ControlMode) => { mode = m },
  }
}

function createTestApp(controlMode: ControlMode = 'orchestrator') {
  const eventBus = new EventBus()
  const tickService = new TickService({ mode: 'manual' })
  const decisionQueue = new DecisionQueue({ timeoutTicks: 100 })
  const trustEngine = new TrustEngine()
  const wsHub = createMockWsHub()
  const gateway = createMockGateway()
  const controlModeManager = createMockControlMode(controlMode)

  const handles = new Map<string, AgentHandle>()
  handles.set('agent-1', { id: 'agent-1', pluginName: 'test', status: 'running', sessionId: 's1' })
  const registry = createMockRegistry(handles)

  // Register agent in trust engine so getScore returns a value
  trustEngine.registerAgent('agent-1')

  const deps = {
    decisionQueue,
    eventBus,
    tickService,
    registry,
    controlMode: controlModeManager,
    trustEngine,
    wsHub,
    gateway,
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tool-gate', createToolGateRouter(deps))

  const server = createServer(app as any)
  let baseUrl = ''

  return {
    app, server, deps,
    get baseUrl() { return baseUrl },
    async start() {
      const port = await listenEphemeral(server)
      baseUrl = `http://localhost:${port}`
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// ── Unit tests: classifyBashRisk ──────────────────────────────────

describe('classifyBashRisk', () => {
  it('classifies test runners as safe', () => {
    expect(classifyBashRisk('npx vitest run')).toBe('safe')
    expect(classifyBashRisk('npm test')).toBe('safe')
    expect(classifyBashRisk('jest --watch')).toBe('safe')
    expect(classifyBashRisk('pytest -v')).toBe('safe')
  })

  it('classifies read-only git as safe', () => {
    expect(classifyBashRisk('git status')).toBe('safe')
    expect(classifyBashRisk('git diff')).toBe('safe')
    expect(classifyBashRisk('git log --oneline')).toBe('safe')
    expect(classifyBashRisk('git branch -a')).toBe('safe')
  })

  it('classifies inspection tools as safe', () => {
    expect(classifyBashRisk('ls -la')).toBe('safe')
    expect(classifyBashRisk('pwd')).toBe('safe')
    expect(classifyBashRisk('which node')).toBe('safe')
    expect(classifyBashRisk('echo hello')).toBe('safe')
    expect(classifyBashRisk('node -e "console.log(1)"')).toBe('safe')
  })

  it('classifies build tools as safe', () => {
    expect(classifyBashRisk('npx tsc --noEmit')).toBe('safe')
    expect(classifyBashRisk('npm run build')).toBe('safe')
    expect(classifyBashRisk('npx tsx /tmp/scratch.ts')).toBe('safe')
  })

  it('classifies file deletion as destructive', () => {
    expect(classifyBashRisk('rm -rf /tmp/foo')).toBe('destructive')
    expect(classifyBashRisk('unlink /tmp/file')).toBe('destructive')
    expect(classifyBashRisk('rmdir /tmp/dir')).toBe('destructive')
  })

  it('classifies git mutations as destructive', () => {
    expect(classifyBashRisk('git push origin main')).toBe('destructive')
    expect(classifyBashRisk('git reset --hard HEAD')).toBe('destructive')
    expect(classifyBashRisk('git rebase main')).toBe('destructive')
    expect(classifyBashRisk('git checkout .')).toBe('destructive')
    expect(classifyBashRisk('git clean -fd')).toBe('destructive')
  })

  it('classifies package mutations as destructive', () => {
    expect(classifyBashRisk('npm publish')).toBe('destructive')
    expect(classifyBashRisk('npm unpublish')).toBe('destructive')
  })

  it('classifies unrecognized commands as destructive (safe default)', () => {
    expect(classifyBashRisk('some-custom-script --flag')).toBe('destructive')
    expect(classifyBashRisk('make deploy')).toBe('destructive')
  })

  it('classifies cd and shell builtins as safe', () => {
    expect(classifyBashRisk('cd /some/path && npx vitest run')).toBe('safe')
    expect(classifyBashRisk('mkdir -p /tmp/foo')).toBe('safe')
    expect(classifyBashRisk('export FOO=bar')).toBe('safe')
  })

  it('handles chained commands by checking only the first', () => {
    expect(classifyBashRisk('ls -la && rm -rf /')).toBe('safe')
    expect(classifyBashRisk('rm -rf / && echo done')).toBe('destructive')
  })
})

// ── Unit tests: shouldAutoResolve ─────────────────────────────────

describe('shouldAutoResolve', () => {
  it('orchestrator mode always returns false', () => {
    expect(shouldAutoResolve('orchestrator', 'small', 100)).toBe(false)
    expect(shouldAutoResolve('orchestrator', 'medium', 100)).toBe(false)
    expect(shouldAutoResolve('orchestrator', 'large', 100, 'safe')).toBe(false)
  })

  it('ecosystem mode auto-approves small and medium blast', () => {
    expect(shouldAutoResolve('ecosystem', 'small', 0)).toBe(true)
    expect(shouldAutoResolve('ecosystem', 'medium', 0)).toBe(true)
  })

  it('ecosystem mode auto-approves safe bash but escalates destructive', () => {
    expect(shouldAutoResolve('ecosystem', 'large', 0, 'safe')).toBe(true)
    expect(shouldAutoResolve('ecosystem', 'large', 0, 'destructive')).toBe(false)
  })

  it('adaptive mode uses trust thresholds for small blast', () => {
    expect(shouldAutoResolve('adaptive', 'small', 30)).toBe(true)
    expect(shouldAutoResolve('adaptive', 'small', 29)).toBe(false)
  })

  it('adaptive mode uses trust thresholds for medium blast', () => {
    expect(shouldAutoResolve('adaptive', 'medium', 50)).toBe(true)
    expect(shouldAutoResolve('adaptive', 'medium', 49)).toBe(false)
  })

  it('adaptive mode uses trust thresholds for large safe bash', () => {
    expect(shouldAutoResolve('adaptive', 'large', 60, 'safe')).toBe(true)
    expect(shouldAutoResolve('adaptive', 'large', 59, 'safe')).toBe(false)
  })

  it('adaptive mode uses higher threshold for destructive bash', () => {
    expect(shouldAutoResolve('adaptive', 'large', 80, 'destructive')).toBe(true)
    expect(shouldAutoResolve('adaptive', 'large', 79, 'destructive')).toBe(false)
  })
})

// ── Integration tests: tool-gate auto-resolve ─────────────────────

describe('POST /api/tool-gate/request-approval auto-resolve', () => {
  let testApp: ReturnType<typeof createTestApp>

  afterEach(async () => {
    await testApp.close()
  })

  it('orchestrator mode: always creates blocking decision', async () => {
    testApp = createTestApp('orchestrator')
    await testApp.start()

    const { decisionQueue } = testApp.deps

    // Start request (will block)
    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Write',
        toolInput: { file_path: '/tmp/test.ts', content: 'hello' },
        toolUseId: 'tu-1',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // Decision should be pending (not auto-resolved)
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)

    // Manually resolve to unblock
    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: 'manual',
      actionKind: 'review',
    })

    const res = await requestPromise
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBeUndefined()
  })

  it('ecosystem mode + Write (medium blast): auto-approved with autoResolved flag', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Write',
        toolInput: { file_path: '/tmp/test.ts', content: 'hello' },
        toolUseId: 'tu-2',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBe(true)
    expect(body.timedOut).toBe(false)
  })

  it('ecosystem mode + Bash safe command: auto-approved', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Bash',
        toolInput: { command: 'npx vitest run' },
        toolUseId: 'tu-3',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBe(true)
  })

  it('ecosystem mode + Bash destructive command: escalated (blocks)', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    const { decisionQueue } = testApp.deps

    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /tmp/foo' },
        toolUseId: 'tu-4',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // Should be pending, not auto-resolved
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)

    // Resolve manually
    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: 'manual',
      actionKind: 'review',
    })

    const res = await requestPromise
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBeUndefined()
  })

  it('ecosystem mode + Bash unrecognized command: escalated (safe default)', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    const { decisionQueue } = testApp.deps

    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Bash',
        toolInput: { command: 'some-unknown-script --deploy' },
        toolUseId: 'tu-5',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)

    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'reject',
      rationale: 'unknown command',
      actionKind: 'review',
    })

    const res = await requestPromise
    const body = await res.json() as any
    expect(body.action).toBe('reject')
  })

  it('adaptive mode + trust 60 + Edit (medium): auto-approved', async () => {
    testApp = createTestApp('adaptive')
    await testApp.start()

    // Pump trust score to 60 (initial is 50, need +10)
    const { trustEngine, tickService } = testApp.deps
    // Apply positive outcomes to raise score
    trustEngine.applyOutcome('agent-1', 'human_approves_always', tickService.currentTick(), {})  // +3
    trustEngine.applyOutcome('agent-1', 'human_approves_always', tickService.currentTick(), {})  // +3
    trustEngine.applyOutcome('agent-1', 'human_approves_always', tickService.currentTick(), {})  // +3
    trustEngine.applyOutcome('agent-1', 'human_approves_always', tickService.currentTick(), {})  // +3
    const score = trustEngine.getScore('agent-1')!
    expect(score).toBeGreaterThanOrEqual(60)

    const res = await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Edit',
        toolInput: { file_path: '/tmp/test.ts', old_string: 'a', new_string: 'b' },
        toolUseId: 'tu-6',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBe(true)
  })

  it('adaptive mode + trust 40 + Edit (medium): escalated', async () => {
    testApp = createTestApp('adaptive')
    await testApp.start()

    // Lower trust to 40 (initial is 50, need -10)
    const { trustEngine, tickService, decisionQueue } = testApp.deps
    trustEngine.applyOutcome('agent-1', 'human_rejects_tool_call', tickService.currentTick(), {})  // -2
    trustEngine.applyOutcome('agent-1', 'human_rejects_tool_call', tickService.currentTick(), {})  // -2
    trustEngine.applyOutcome('agent-1', 'human_rejects_tool_call', tickService.currentTick(), {})  // -2
    trustEngine.applyOutcome('agent-1', 'human_rejects_tool_call', tickService.currentTick(), {})  // -2
    trustEngine.applyOutcome('agent-1', 'human_rejects_tool_call', tickService.currentTick(), {})  // -2
    const score = trustEngine.getScore('agent-1')!
    expect(score).toBeLessThanOrEqual(40)

    const requestPromise = fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Edit',
        toolInput: { file_path: '/tmp/test.ts', old_string: 'a', new_string: 'b' },
        toolUseId: 'tu-7',
      }),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const pending = decisionQueue.listPending()
    expect(pending.length).toBe(1)

    decisionQueue.resolve(pending[0].event.decisionId, {
      type: 'tool_approval',
      action: 'approve',
      rationale: 'manual',
      actionKind: 'review',
    })

    const res = await requestPromise
    const body = await res.json() as any
    expect(body.action).toBe('approve')
    expect(body.autoResolved).toBeUndefined()
  })

  it('auto-resolved decisions appear in decision queue history', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/test.ts' },
        toolUseId: 'tu-8',
      }),
    })

    const all = testApp.deps.decisionQueue.listAll()
    const toolApprovals = all.filter(d => d.event.subtype === 'tool_approval')
    expect(toolApprovals.length).toBe(1)
    expect(toolApprovals[0].status).toBe('resolved')
    expect(toolApprovals[0].resolution?.type).toBe('tool_approval')
    if (toolApprovals[0].resolution?.type === 'tool_approval') {
      expect(toolApprovals[0].resolution.autoResolved).toBe(true)
    }
  })

  it('auto-resolved decisions do not change trust scores', async () => {
    testApp = createTestApp('ecosystem')
    await testApp.start()

    const scoreBefore = testApp.deps.trustEngine.getScore('agent-1')!

    await fetch(`${testApp.baseUrl}/api/tool-gate/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        toolName: 'Write',
        toolInput: { file_path: '/tmp/test.ts', content: 'hello' },
        toolUseId: 'tu-9',
      }),
    })

    const scoreAfter = testApp.deps.trustEngine.getScore('agent-1')!
    expect(scoreAfter).toBe(scoreBefore)
  })
})
