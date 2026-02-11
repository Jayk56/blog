import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalProcessPlugin, type LocalProcessPluginOptions } from '../../src/gateway/local-process-plugin'
import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import { EventBus } from '../../src/bus'
import type {
  AgentBrief,
  AgentHandle,
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

/** Creates a mock ChildProcessManager. */
function makeMockProcessManager(): ChildProcessManager {
  const pm = new ChildProcessManager(vi.fn() as unknown as typeof globalThis.fetch)

  vi.spyOn(pm, 'spawnShim').mockResolvedValue({
    process: { kill: vi.fn(), pid: 12345 } as any,
    transport: makeTransport(),
    port: 9100,
  })
  vi.spyOn(pm, 'killProcess').mockImplementation(() => {})
  vi.spyOn(pm, 'cleanup').mockImplementation(() => {})
  vi.spyOn(pm, 'onExit').mockImplementation(() => {})

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
        expect(processManager.cleanup).toHaveBeenCalledWith('agent-1', 9100)
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
        expect(processManager.cleanup).toHaveBeenCalledWith('agent-1', 9100)
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
})
