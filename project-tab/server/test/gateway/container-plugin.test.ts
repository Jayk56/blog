import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ContainerPlugin,
  type ContainerPluginOptions,
} from '../../src/gateway/container-plugin'
import { ContainerOrchestrator } from '../../src/gateway/container-orchestrator'
import { AdapterHttpError } from '../../src/gateway/local-http-plugin'
import type {
  AgentBrief,
  AgentHandle,
  ContainerTransport,
  KillResponse,
  PluginCapabilities,
  SerializedAgentState,
} from '../../src/types'

// ---- Helpers ----

function makeCapabilities(): PluginCapabilities {
  return {
    supportsPause: true,
    supportsResume: true,
    supportsKill: true,
    supportsHotBriefUpdate: false,
  }
}

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'openai-container',
    status: 'running',
    sessionId: 'session-1',
    ...overrides,
  }
}

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

function makeTransport(port = 9200): ContainerTransport {
  return {
    type: 'container',
    sandboxId: `sandbox-agent-1-abc123def456`,
    rpcEndpoint: `http://localhost:${port}`,
    eventStreamEndpoint: `ws://localhost:${port}/events`,
    healthEndpoint: `http://localhost:${port}/health`,
  }
}

/** Creates a mock fetch that returns json for a given path. */
function mockFetch(
  responses: Record<string, { status: number; body?: unknown }>
) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    const path = new URL(urlStr).pathname

    const config = responses[path]
    if (!config) {
      return new Response('Not Found', { status: 404 })
    }

    const bodyStr =
      config.body !== undefined ? JSON.stringify(config.body) : ''
    return new Response(bodyStr, {
      status: config.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
}

/** Creates a mock orchestrator with spied methods. */
function makeMockOrchestrator(): ContainerOrchestrator {
  const orch = new ContainerOrchestrator(
    {} as import('dockerode'),
    vi.fn() as unknown as typeof globalThis.fetch
  )
  // Override createSandbox to return a predictable result
  vi.spyOn(orch, 'createSandbox').mockResolvedValue({
    containerId: 'abc123def456',
    transport: makeTransport(),
    port: 9200,
  })
  vi.spyOn(orch, 'cleanup').mockResolvedValue(undefined)
  vi.spyOn(orch, 'onExit').mockImplementation(() => {})
  vi.spyOn(orch, 'stopContainer').mockResolvedValue(undefined)
  vi.spyOn(orch, 'killContainer').mockResolvedValue(undefined)
  vi.spyOn(orch, 'destroyContainer').mockResolvedValue(undefined)
  return orch
}

function makeTokenGenerator() {
  return vi.fn(async (_agentId: string) => ({
    token: 'generated-token',
    expiresAt: '2026-02-12T00:00:00.000Z',
  }))
}

function makePlugin(
  orchestrator: ContainerOrchestrator,
  fetchFn: typeof globalThis.fetch,
  overrides: Partial<ContainerPluginOptions> = {}
): ContainerPlugin {
  return new ContainerPlugin({
    name: 'openai-container',
    version: '1.0.0',
    capabilities: makeCapabilities(),
    orchestrator,
    image: 'project-tab/adapter-openai:latest',
    backendUrl: 'http://localhost:3001',
    generateToken: makeTokenGenerator(),
    fetchFn,
    ...overrides,
  })
}

describe('ContainerPlugin', () => {
  let orchestrator: ContainerOrchestrator

  beforeEach(() => {
    orchestrator = makeMockOrchestrator()
  })

  it('exposes name, version, and capabilities', () => {
    const plugin = makePlugin(orchestrator, mockFetch({}))
    expect(plugin.name).toBe('openai-container')
    expect(plugin.version).toBe('1.0.0')
    expect(plugin.capabilities.supportsPause).toBe(true)
    expect(plugin.capabilities.supportsHotBriefUpdate).toBe(false)
  })

  describe('spawn', () => {
    it('creates a sandbox and sends POST /spawn with brief', async () => {
      const expectedHandle = makeHandle()
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: expectedHandle },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      const handle = await plugin.spawn(makeMinimalBrief())

      expect(handle).toEqual(expectedHandle)
      expect(orchestrator.createSandbox).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('passes bootstrap with generated token to orchestrator', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const tokenGen = makeTokenGenerator()
      const plugin = makePlugin(orchestrator, fetchMock, {
        generateToken: tokenGen,
      })

      await plugin.spawn(makeMinimalBrief())

      expect(tokenGen).toHaveBeenCalledWith('agent-1')
      const createCall = (orchestrator.createSandbox as ReturnType<typeof vi.fn>)
        .mock.calls[0]
      expect(createCall[0]).toBe('agent-1')
      expect(createCall[1].bootstrap.backendToken).toBe('generated-token')
      expect(createCall[1].bootstrap.backendUrl).toBe('http://localhost:3001')
      expect(createCall[1].bootstrap.artifactUploadEndpoint).toBe(
        'http://localhost:3001/api/artifacts'
      )
    })

    it('uses workspace baseImage from brief if specified', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      const brief = makeMinimalBrief()
      brief.workspaceRequirements = {
        mounts: [],
        capabilities: [],
        baseImage: 'custom-image:v2',
      }

      await plugin.spawn(brief)

      const createCall = (orchestrator.createSandbox as ReturnType<typeof vi.fn>)
        .mock.calls[0]
      expect(createCall[1].image).toBe('custom-image:v2')
    })

    it('falls back to plugin default image when brief has no baseImage', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())

      const createCall = (orchestrator.createSandbox as ReturnType<typeof vi.fn>)
        .mock.calls[0]
      expect(createCall[1].image).toBe('project-tab/adapter-openai:latest')
    })

    it('sends brief as POST body to /spawn', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())

      const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:9200/spawn')
      expect(init.method).toBe('POST')

      const sentBody = JSON.parse(init.body as string)
      expect(sentBody.agentId).toBe('agent-1')
      expect(sentBody.role).toBe('coder')
    })

    it('throws AdapterHttpError on non-2xx from /spawn', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 500, body: { error: 'internal error' } },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await expect(plugin.spawn(makeMinimalBrief())).rejects.toThrow(
        AdapterHttpError
      )
    })
  })

  describe('pause', () => {
    it('sends POST /pause and returns SerializedAgentState', async () => {
      const state: SerializedAgentState = {
        agentId: 'agent-1',
        pluginName: 'openai-container',
        sessionId: 'session-1',
        checkpoint: { sdk: 'openai', runStateJson: '{}' },
        briefSnapshot: makeMinimalBrief(),
        pendingDecisionIds: [],
        lastSequence: 5,
        serializedAt: '2026-02-10T00:00:00.000Z',
        serializedBy: 'pause',
        estimatedSizeBytes: 1024,
      }
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/pause': { status: 200, body: state },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      const result = await plugin.pause(makeHandle())

      expect(result.agentId).toBe('agent-1')
      expect(result.serializedBy).toBe('pause')
    })

    it('throws when agent has no container', async () => {
      const fetchMock = mockFetch({})
      const plugin = makePlugin(orchestrator, fetchMock)

      await expect(plugin.pause(makeHandle())).rejects.toThrow(
        'No container found for agent agent-1'
      )
    })
  })

  describe('resume', () => {
    it('sends POST /resume and returns AgentHandle', async () => {
      const expectedHandle = makeHandle({ status: 'running' })
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/resume': { status: 200, body: expectedHandle },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())

      const state: SerializedAgentState = {
        agentId: 'agent-1',
        pluginName: 'openai-container',
        sessionId: 'session-1',
        checkpoint: { sdk: 'openai', runStateJson: '{}' },
        briefSnapshot: makeMinimalBrief(),
        pendingDecisionIds: [],
        lastSequence: 5,
        serializedAt: '2026-02-10T00:00:00.000Z',
        serializedBy: 'pause',
        estimatedSizeBytes: 1024,
      }

      const result = await plugin.resume(state)
      expect(result.status).toBe('running')
    })
  })

  describe('kill', () => {
    it('sends POST /kill and destroys container', async () => {
      const killResponse: KillResponse = {
        artifactsExtracted: 3,
        cleanShutdown: true,
      }
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/kill': { status: 200, body: killResponse },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      const result = await plugin.kill(makeHandle(), {
        grace: true,
        graceTimeoutMs: 10_000,
      })

      expect(result.cleanShutdown).toBe(true)
      expect(result.artifactsExtracted).toBe(3)
      expect(orchestrator.cleanup).toHaveBeenCalledWith('agent-1', 9200)
    })

    it('sends default grace:true when no options provided', async () => {
      const killResponse: KillResponse = {
        artifactsExtracted: 0,
        cleanShutdown: true,
      }
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/kill': { status: 200, body: killResponse },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      const result = await plugin.kill(makeHandle())

      const killCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('/kill')
      ) as [string, RequestInit]
      const sentBody = JSON.parse(killCall[1].body as string)
      expect(sentBody.grace).toBe(true)
      expect(result.cleanShutdown).toBe(true)
    })

    it('synthesizes response when shim is already dead', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/spawn')) {
          return new Response(JSON.stringify(makeHandle()), { status: 200 })
        }
        if (url.includes('/kill')) {
          throw new TypeError('connection refused')
        }
        return new Response('Not Found', { status: 404 })
      }) as unknown as typeof globalThis.fetch

      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      const result = await plugin.kill(makeHandle())

      expect(result.cleanShutdown).toBe(false)
      expect(result.artifactsExtracted).toBe(0)
      // Container should still be cleaned up
      expect(orchestrator.cleanup).toHaveBeenCalledWith('agent-1', 9200)
    })

    it('removes agent from internal tracking after kill', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/kill': {
          status: 200,
          body: { artifactsExtracted: 0, cleanShutdown: true },
        },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      await plugin.kill(makeHandle())

      expect(plugin.getTransport('agent-1')).toBeUndefined()
    })
  })

  describe('resolveDecision', () => {
    it('sends POST /resolve with handle, decisionId, and resolution', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/resolve': { status: 200 },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      await plugin.resolveDecision(makeHandle(), 'dec-1', {
        type: 'option',
        chosenOptionId: 'opt-a',
        rationale: 'best choice',
        actionKind: 'update',
      })

      const resolveCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('/resolve')
      ) as [string, RequestInit]

      const sentBody = JSON.parse(resolveCall[1].body as string)
      expect(sentBody.decisionId).toBe('dec-1')
      expect(sentBody.resolution.chosenOptionId).toBe('opt-a')
    })
  })

  describe('injectContext', () => {
    it('sends POST /inject-context with injection payload', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/inject-context': { status: 200 },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      await plugin.injectContext(makeHandle(), {
        content: '# Update\nNew info',
        format: 'markdown',
        snapshotVersion: 2,
        estimatedTokens: 100,
        priority: 'recommended',
      })

      const injectCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('/inject-context')
      ) as [string, RequestInit]

      const sentBody = JSON.parse(injectCall[1].body as string)
      expect(sentBody.content).toBe('# Update\nNew info')
      expect(sentBody.format).toBe('markdown')
    })
  })

  describe('updateBrief', () => {
    it('sends POST /update-brief with handle and changes', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
        '/update-brief': { status: 200 },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      await plugin.updateBrief(makeHandle(), { role: 'reviewer' })

      const updateCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('/update-brief')
      ) as [string, RequestInit]

      const sentBody = JSON.parse(updateCall[1].body as string)
      expect(sentBody.changes.role).toBe('reviewer')
    })
  })

  describe('getTransport', () => {
    it('returns transport for active agent', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())

      const transport = plugin.getTransport('agent-1')
      expect(transport).toBeDefined()
      expect(transport!.type).toBe('container')
      expect(transport!.sandboxId).toContain('agent-1')
    })

    it('returns undefined for unknown agent', () => {
      const plugin = makePlugin(orchestrator, mockFetch({}))
      expect(plugin.getTransport('nonexistent')).toBeUndefined()
    })
  })

  describe('onContainerExit', () => {
    it('delegates to orchestrator.onExit', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: makeHandle() },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      const listener = vi.fn()
      plugin.onContainerExit('agent-1', listener)

      expect(orchestrator.onExit).toHaveBeenCalledWith('agent-1', listener)
    })
  })

  describe('error handling', () => {
    it('throws AdapterHttpError with status code and body on failure', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 422, body: { error: 'invalid brief' } },
      })
      const plugin = makePlugin(orchestrator, fetchMock)

      try {
        await plugin.spawn(makeMinimalBrief())
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterHttpError)
        const httpErr = err as AdapterHttpError
        expect(httpErr.endpoint).toBe('/spawn')
        expect(httpErr.statusCode).toBe(422)
        expect(httpErr.body).toContain('invalid brief')
      }
    })

    it('propagates network errors from fetch', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/spawn')) {
          return new Response(JSON.stringify(makeHandle()), { status: 200 })
        }
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof globalThis.fetch

      const plugin = makePlugin(orchestrator, fetchMock)

      await plugin.spawn(makeMinimalBrief())
      await expect(plugin.pause(makeHandle())).rejects.toThrow(
        'Failed to fetch'
      )
    })
  })
})
