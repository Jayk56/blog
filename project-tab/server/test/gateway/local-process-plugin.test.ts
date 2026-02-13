import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalProcessPlugin, type LocalProcessPluginOptions } from '../../src/gateway/local-process-plugin'
import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import { EventBus } from '../../src/bus'
import type {
  AgentBrief,
  AgentHandle,
  EventEnvelope,
  KillResponse,
  LocalHttpTransport,
  PluginCapabilities,
  SerializedAgentState,
} from '../../src/types'

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMinimalBrief(agentId = 'agent-1'): AgentBrief {
  return {
    agentId,
    role: 'coder',
    description: 'A coding agent',
    workstream: 'core',
    readableWorkstreams: ['core'],
    constraints: [],
    escalationProtocol: {
      alwaysEscalate: [],
      escalateWhen: [],
      neverEscalate: [],
    },
    controlMode: 'orchestrator',
    projectBrief: {
      title: 'Test Project',
      description: 'A test project',
      goals: ['ship it'],
      checkpoints: ['done'],
    },
    knowledgeSnapshot: {
      version: 1,
      generatedAt: '2026-02-10T00:00:00.000Z',
      workstreams: [],
      pendingDecisions: [],
      recentCoherenceIssues: [],
      artifactIndex: [],
      activeAgents: [],
      estimatedTokens: 0,
    },
    allowedTools: ['read_file', 'write_file'],
  }
}

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'openai',
    status: 'running',
    sessionId: 'session-1',
    ...overrides,
  }
}

function makeTransport(port = 9100): LocalHttpTransport {
  return {
    type: 'local_http',
    rpcEndpoint: `http://localhost:${port}`,
    eventStreamEndpoint: `ws://localhost:${port}/events`,
  }
}

function makeSerializedState(agentId = 'agent-1'): SerializedAgentState {
  return {
    agentId,
    pluginName: 'openai',
    sessionId: 'session-1',
    checkpoint: { sdk: 'mock', scriptPosition: 5 },
    briefSnapshot: makeMinimalBrief(agentId),
    pendingDecisionIds: [],
    lastSequence: 10,
    serializedAt: '2026-02-10T00:00:00.000Z',
    serializedBy: 'pause',
    estimatedSizeBytes: 1024,
  }
}

function makeTokenGenerator() {
  return vi.fn(async (_agentId: string) => ({
    token: 'test-token',
    expiresAt: '2026-02-12T00:00:00.000Z',
  }))
}

type ExitListener = (code: number | null, signal: string | null) => void

/** Captured exit listeners from mock process manager, keyed by agentId. */
const capturedExitListeners = new Map<string, ExitListener[]>()

/** Creates a mock ChildProcessManager that captures exit listeners. */
function makeMockProcessManager(): ChildProcessManager {
  const pm = new ChildProcessManager(vi.fn() as unknown as typeof globalThis.fetch)
  capturedExitListeners.clear()

  vi.spyOn(pm, 'spawnShim').mockResolvedValue({
    process: { kill: vi.fn(), pid: 12345 } as any,
    transport: makeTransport(),
    port: 9100,
  })
  vi.spyOn(pm, 'killProcess').mockImplementation(() => {})
  vi.spyOn(pm, 'cleanup').mockImplementation(() => {})
  vi.spyOn(pm, 'onExit').mockImplementation((agentId: string, listener: ExitListener) => {
    const listeners = capturedExitListeners.get(agentId) ?? []
    listeners.push(listener)
    capturedExitListeners.set(agentId, listeners)
  })

  return pm
}

/** Creates a mock fetch for LocalHttpPlugin RPC calls. */
function mockFetch(responses: Record<string, { status: number; body?: unknown }>) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    const path = new URL(urlStr).pathname

    const config = responses[path]
    if (!config) {
      return new Response('Not Found', { status: 404 })
    }

    const bodyStr = config.body !== undefined ? JSON.stringify(config.body) : ''
    return new Response(bodyStr, {
      status: config.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
}

function makePlugin(
  processManager: ChildProcessManager,
  overrides: Partial<LocalProcessPluginOptions> = {},
): LocalProcessPlugin {
  return new LocalProcessPlugin({
    name: 'openai',
    processManager,
    eventBus: new EventBus(100),
    shimCommand: 'python',
    shimArgs: ['-m', 'adapter_shim', '--mock'],
    backendUrl: 'http://localhost:3001',
    generateToken: makeTokenGenerator(),
    ...overrides,
  })
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('LocalProcessPlugin', () => {
  let processManager: ChildProcessManager

  beforeEach(() => {
    processManager = makeMockProcessManager()
  })

  it('exposes name, version, and capabilities', () => {
    const plugin = makePlugin(processManager)
    expect(plugin.name).toBe('openai')
    expect(plugin.version).toBe('1.0.0')
    expect(plugin.capabilities.supportsKill).toBe(true)
    expect(plugin.capabilities.supportsPause).toBe(true)
  })

  it('accepts custom version and capabilities', () => {
    const plugin = makePlugin(processManager, {
      version: '2.0.0',
      capabilities: {
        supportsPause: false,
        supportsResume: false,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
    })
    expect(plugin.version).toBe('2.0.0')
    expect(plugin.capabilities.supportsPause).toBe(false)
  })

  describe('spawn', () => {
    it('spawns a child process and delegates RPC spawn call', async () => {
      // The mock ChildProcessManager returns a transport on port 9100.
      // We need to also mock the global fetch for the LocalHttpPlugin spawn call.
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      // Override the global fetch for this test
      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        const result = await plugin.spawn(makeMinimalBrief())

        expect(processManager.spawnShim).toHaveBeenCalledOnce()
        expect(result.id).toBe('agent-1')
        expect(result.status).toBe('running')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('calls generateToken with the agent ID', async () => {
      const generateToken = makeTokenGenerator()
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { generateToken })
        await plugin.spawn(makeMinimalBrief('agent-42'))

        expect(generateToken).toHaveBeenCalledWith('agent-42')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('passes bootstrap config to child process manager', async () => {
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const callArgs = vi.mocked(processManager.spawnShim).mock.calls[0]
        expect(callArgs[0]).toBe('agent-1')
        expect(callArgs[1].command).toBe('python')
        expect(callArgs[1].args).toEqual(['-m', 'adapter_shim', '--mock'])
        expect(callArgs[1].bootstrap).toBeDefined()
        expect(callArgs[1].bootstrap.agentId).toBe('agent-1')
        expect(callArgs[1].bootstrap.backendUrl).toBe('http://localhost:3001')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('kill', () => {
    it('kills the agent process and cleans up', async () => {
      const handle = makeHandle()
      const killResponse: KillResponse = { artifactsExtracted: 2, cleanShutdown: true }

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/kill': { status: 200, body: killResponse },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const result = await plugin.kill(handle)

        expect(result.cleanShutdown).toBe(true)
        expect(result.artifactsExtracted).toBe(2)
        expect(processManager.killProcess).toHaveBeenCalledWith('agent-1')
        expect(processManager.cleanup).toHaveBeenCalledWith('agent-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('handles kill failure gracefully', async () => {
      const handle = makeHandle()

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/kill': { status: 500, body: { error: 'shim crashed' } },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const result = await plugin.kill(handle)

        // Should still clean up even on RPC failure
        expect(result.cleanShutdown).toBe(false)
        expect(result.artifactsExtracted).toBe(0)
        expect(processManager.killProcess).toHaveBeenCalledWith('agent-1')
        expect(processManager.cleanup).toHaveBeenCalledWith('agent-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('throws for unknown agent', async () => {
      const plugin = makePlugin(processManager)
      const handle = makeHandle({ id: 'unknown-agent' })

      await expect(plugin.kill(handle)).rejects.toThrow('No agent process found')
    })
  })

  describe('pause', () => {
    it('delegates to per-agent plugin', async () => {
      const handle = makeHandle()
      const state = makeSerializedState()

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/pause': { status: 200, body: state },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const result = await plugin.pause(handle)
        expect(result.agentId).toBe('agent-1')
        expect(result.serializedBy).toBe('pause')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('resume', () => {
    it('delegates to per-agent plugin', async () => {
      const handle = makeHandle()
      const state = makeSerializedState()

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/resume': { status: 200, body: handle },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const result = await plugin.resume(state)
        expect(result.id).toBe('agent-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('injectContext', () => {
    it('delegates to per-agent plugin', async () => {
      const handle = makeHandle()

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/inject-context': { status: 200 },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        await plugin.injectContext(handle, {
          content: '{"test": true}',
          format: 'json',
          snapshotVersion: 1,
          estimatedTokens: 100,
          priority: 'recommended',
        })

        // Should have called /inject-context
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/inject-context'),
          expect.any(Object)
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('requestCheckpoint', () => {
    it('delegates to per-agent plugin', async () => {
      const handle = makeHandle()
      const state = makeSerializedState()

      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/checkpoint': { status: 200, body: state },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        const result = await plugin.requestCheckpoint(handle, 'dec-1')
        expect(result.agentId).toBe('agent-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('killAll', () => {
    it('kills all managed agents', async () => {
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })

      // Allow multiple agents on different ports
      let portCounter = 9100
      vi.mocked(processManager.spawnShim).mockImplementation(async (agentId) => ({
        process: { kill: vi.fn(), pid: 12345 } as any,
        transport: makeTransport(portCounter++),
        port: portCounter - 1,
      }))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief('agent-1'))
        await plugin.spawn(makeMinimalBrief('agent-2'))

        await plugin.killAll()

        expect(processManager.killProcess).toHaveBeenCalledWith('agent-1')
        expect(processManager.killProcess).toHaveBeenCalledWith('agent-2')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('crash detection', () => {
    it('emits ErrorEvent and LifecycleEvent on unexpected process exit', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        // Simulate process crash (non-zero exit code)
        const listeners = capturedExitListeners.get('agent-1') ?? []
        expect(listeners).toHaveLength(1)
        listeners[0](1, null)

        expect(seen).toHaveLength(2)

        const errorEvent = seen.find((e) => e.event.type === 'error')
        expect(errorEvent).toBeDefined()
        expect(errorEvent!.event.type).toBe('error')
        if (errorEvent!.event.type === 'error') {
          expect(errorEvent!.event.severity).toBe('critical')
          expect(errorEvent!.event.recoverable).toBe(false)
          expect(errorEvent!.event.category).toBe('internal')
          expect(errorEvent!.event.message).toContain('code=1')
        }

        const lifecycleEvent = seen.find((e) => e.event.type === 'lifecycle')
        expect(lifecycleEvent).toBeDefined()
        if (lifecycleEvent!.event.type === 'lifecycle') {
          expect(lifecycleEvent!.event.action).toBe('crashed')
          expect(lifecycleEvent!.event.reason).toContain('code=1')
        }
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('emits crash events on signal kill', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        // Simulate signal-killed process
        const listeners = capturedExitListeners.get('agent-1') ?? []
        listeners[0](null, 'SIGKILL')

        expect(seen).toHaveLength(2)
        const errorEvent = seen.find((e) => e.event.type === 'error')
        if (errorEvent!.event.type === 'error') {
          expect(errorEvent!.event.message).toContain('SIGKILL')
        }
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('does not emit crash events on clean exit (code 0)', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        const listeners = capturedExitListeners.get('agent-1') ?? []
        listeners[0](0, null)

        expect(seen).toHaveLength(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('deduplicates crash events (only fires once)', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        // First crash trigger via process exit
        const listeners = capturedExitListeners.get('agent-1') ?? []
        listeners[0](1, null)

        expect(seen).toHaveLength(2)

        // Second crash trigger (e.g., WS disconnect) should be deduped
        // We simulate this by calling the exit listener again
        listeners[0](1, null)

        // Still only 2 events (the original ErrorEvent + LifecycleEvent)
        expect(seen).toHaveLength(2)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('does not fire crash handler after intentional kill', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const killResponse: KillResponse = { artifactsExtracted: 0, cleanShutdown: true }
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
        '/kill': { status: 200, body: killResponse },
      })

      const seen: EventEnvelope[] = []
      eventBus.subscribe({}, (env) => seen.push(env))

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        // Intentional kill
        await plugin.kill(handle)

        // Now simulate process exit (which happens after kill)
        const listeners = capturedExitListeners.get('agent-1') ?? []
        if (listeners.length > 0) {
          listeners[0](0, null)
        }

        // No crash events should have been emitted
        expect(seen).toHaveLength(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('cleans up agent record on crash', async () => {
      const eventBus = new EventBus(100)
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager, { eventBus })
        await plugin.spawn(makeMinimalBrief())

        // Verify agent has a transport (is tracked)
        expect(plugin.getTransport('agent-1')).toBeDefined()

        // Trigger crash
        const listeners = capturedExitListeners.get('agent-1') ?? []
        listeners[0](1, null)

        // Agent record should be cleaned up
        expect(plugin.getTransport('agent-1')).toBeUndefined()
        expect(processManager.cleanup).toHaveBeenCalledWith('agent-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('registers onExit listener during spawn', async () => {
      const handle = makeHandle()
      const fetchSpy = mockFetch({
        '/spawn': { status: 200, body: handle },
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchSpy
      try {
        const plugin = makePlugin(processManager)
        await plugin.spawn(makeMinimalBrief())

        expect(processManager.onExit).toHaveBeenCalledWith('agent-1', expect.any(Function))
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
