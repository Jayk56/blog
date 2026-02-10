import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AdapterHttpError,
  LocalHttpPlugin,
  type LocalHttpPluginOptions,
} from '../../src/gateway/local-http-plugin'
import type {
  AgentBrief,
  AgentHandle,
  KillResponse,
  LocalHttpTransport,
  PluginCapabilities,
  SerializedAgentState,
} from '../../src/types'

function makeTransport(): LocalHttpTransport {
  return {
    type: 'local_http',
    rpcEndpoint: 'http://localhost:9100',
    eventStreamEndpoint: 'ws://localhost:9100/events',
  }
}

function makeCapabilities(): PluginCapabilities {
  return {
    supportsPause: true,
    supportsResume: true,
    supportsKill: true,
    supportsHotBriefUpdate: true,
  }
}

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'openai-local',
    status: 'running',
    sessionId: 'session-1',
    ...overrides,
  }
}

function makeMinimalBrief(): AgentBrief {
  return {
    agentId: 'agent-1',
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

/** Creates a mock fetch that returns json for a given endpoint. */
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

function makePlugin(fetchFn: typeof globalThis.fetch): LocalHttpPlugin {
  const opts: LocalHttpPluginOptions = {
    name: 'openai-local',
    version: '1.0.0',
    capabilities: makeCapabilities(),
    transport: makeTransport(),
    fetchFn,
  }
  return new LocalHttpPlugin(opts)
}

describe('LocalHttpPlugin', () => {
  it('exposes name, version, and capabilities', () => {
    const plugin = makePlugin(mockFetch({}))
    expect(plugin.name).toBe('openai-local')
    expect(plugin.version).toBe('1.0.0')
    expect(plugin.capabilities.supportsPause).toBe(true)
  })

  describe('spawn', () => {
    it('sends POST /spawn with brief and returns AgentHandle', async () => {
      const expectedHandle = makeHandle()
      const fetchMock = mockFetch({
        '/spawn': { status: 200, body: expectedHandle },
      })
      const plugin = makePlugin(fetchMock)

      const handle = await plugin.spawn(makeMinimalBrief())

      expect(handle).toEqual(expectedHandle)
      expect(fetchMock).toHaveBeenCalledOnce()

      const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:9100/spawn')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' })

      const sentBody = JSON.parse(init.body as string)
      expect(sentBody.agentId).toBe('agent-1')
      expect(sentBody.role).toBe('coder')
    })

    it('throws AdapterHttpError on non-2xx response', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 500, body: { error: 'internal error' } },
      })
      const plugin = makePlugin(fetchMock)

      await expect(plugin.spawn(makeMinimalBrief())).rejects.toThrow(AdapterHttpError)
      await expect(plugin.spawn(makeMinimalBrief())).rejects.toThrow('500')
    })
  })

  describe('pause', () => {
    it('sends POST /pause and returns SerializedAgentState', async () => {
      const state: SerializedAgentState = {
        agentId: 'agent-1',
        pluginName: 'openai-local',
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
        '/pause': { status: 200, body: state },
      })
      const plugin = makePlugin(fetchMock)

      const result = await plugin.pause(makeHandle())
      expect(result.agentId).toBe('agent-1')
      expect(result.serializedBy).toBe('pause')
    })
  })

  describe('resume', () => {
    it('sends POST /resume and returns AgentHandle', async () => {
      const expectedHandle = makeHandle({ status: 'running' })
      const fetchMock = mockFetch({
        '/resume': { status: 200, body: expectedHandle },
      })
      const plugin = makePlugin(fetchMock)

      const state: SerializedAgentState = {
        agentId: 'agent-1',
        pluginName: 'openai-local',
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
    it('sends POST /kill with KillRequest body', async () => {
      const killResponse: KillResponse = {
        artifactsExtracted: 3,
        cleanShutdown: true,
      }
      const fetchMock = mockFetch({
        '/kill': { status: 200, body: killResponse },
      })
      const plugin = makePlugin(fetchMock)

      const result = await plugin.kill(makeHandle(), { grace: true, graceTimeoutMs: 10_000 })
      expect(result.cleanShutdown).toBe(true)
      expect(result.artifactsExtracted).toBe(3)

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.grace).toBe(true)
      expect(sentBody.graceTimeoutMs).toBe(10_000)
    })

    it('sends default grace:true when no options provided', async () => {
      const killResponse: KillResponse = {
        artifactsExtracted: 0,
        cleanShutdown: true,
      }
      const fetchMock = mockFetch({
        '/kill': { status: 200, body: killResponse },
      })
      const plugin = makePlugin(fetchMock)

      const result = await plugin.kill(makeHandle())
      expect(result.cleanShutdown).toBe(true)

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.grace).toBe(true)
      expect(sentBody.graceTimeoutMs).toBeUndefined()
    })
  })

  describe('resolveDecision', () => {
    it('sends POST /resolve with handle, decisionId, and resolution', async () => {
      const fetchMock = mockFetch({
        '/resolve': { status: 200 },
      })
      const plugin = makePlugin(fetchMock)

      await plugin.resolveDecision(makeHandle(), 'dec-1', {
        type: 'option',
        chosenOptionId: 'opt-a',
        rationale: 'best choice',
        actionKind: 'update',
      })

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.decisionId).toBe('dec-1')
      expect(sentBody.resolution.chosenOptionId).toBe('opt-a')
    })
  })

  describe('injectContext', () => {
    it('sends POST /inject-context with injection payload (no handle wrapper)', async () => {
      const fetchMock = mockFetch({
        '/inject-context': { status: 200 },
      })
      const plugin = makePlugin(fetchMock)

      await plugin.injectContext(makeHandle(), {
        content: '# Update\nNew info',
        format: 'markdown',
        snapshotVersion: 2,
        estimatedTokens: 100,
        priority: 'recommended',
      })

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.content).toBe('# Update\nNew info')
      expect(sentBody.format).toBe('markdown')
      expect(sentBody.snapshotVersion).toBe(2)
      expect(sentBody.estimatedTokens).toBe(100)
      expect(sentBody.priority).toBe('recommended')
      // handle should NOT be in the payload
      expect(sentBody.handle).toBeUndefined()
    })
  })

  describe('updateBrief', () => {
    it('sends POST /update-brief with handle and changes', async () => {
      const fetchMock = mockFetch({
        '/update-brief': { status: 200 },
      })
      const plugin = makePlugin(fetchMock)

      await plugin.updateBrief(makeHandle(), { role: 'reviewer' })

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.changes.role).toBe('reviewer')
    })
  })

  describe('requestCheckpoint', () => {
    it('sends POST /checkpoint with decisionId and returns SerializedAgentState', async () => {
      const state: SerializedAgentState = {
        agentId: 'agent-1',
        pluginName: 'openai-local',
        sessionId: 'session-1',
        checkpoint: { sdk: 'openai', runStateJson: '{}' },
        briefSnapshot: makeMinimalBrief(),
        conversationSummary: 'Agent blocked on decision',
        pendingDecisionIds: ['dec-1'],
        lastSequence: 10,
        serializedAt: '2026-02-10T00:00:00.000Z',
        serializedBy: 'decision_checkpoint',
        estimatedSizeBytes: 512,
      }
      const fetchMock = mockFetch({
        '/checkpoint': { status: 200, body: state },
      })
      const plugin = makePlugin(fetchMock)

      const result = await plugin.requestCheckpoint(makeHandle(), 'dec-1')
      expect(result.agentId).toBe('agent-1')
      expect(result.serializedBy).toBe('decision_checkpoint')
      expect(result.pendingDecisionIds).toContain('dec-1')

      const sentBody = JSON.parse(
        ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
      )
      expect(sentBody.decisionId).toBe('dec-1')
    })

    it('throws AdapterHttpError when checkpoint fails', async () => {
      const fetchMock = mockFetch({
        '/checkpoint': { status: 500, body: { error: 'internal error' } },
      })
      const plugin = makePlugin(fetchMock)

      await expect(plugin.requestCheckpoint(makeHandle(), 'dec-1')).rejects.toThrow(AdapterHttpError)
    })
  })

  describe('error handling', () => {
    it('throws AdapterHttpError with status code and body on failure', async () => {
      const fetchMock = mockFetch({
        '/spawn': { status: 422, body: { error: 'invalid brief' } },
      })
      const plugin = makePlugin(fetchMock)

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
      const fetchMock = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof globalThis.fetch
      const plugin = makePlugin(fetchMock)

      await expect(plugin.spawn(makeMinimalBrief())).rejects.toThrow('Failed to fetch')
    })
  })
})
