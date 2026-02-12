import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub } from '../../src/ws-hub'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, AgentPlugin, AgentBrief, KnowledgeSnapshot, PluginCapabilities } from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import { createApp } from '../../src/app'

function emptySnapshot(): KnowledgeSnapshot {
  return {
    version: 0,
    generatedAt: new Date().toISOString(),
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens: 0,
  }
}

/** Creates a mock plugin that captures the brief passed to spawn(). */
function createMockPlugin(name = 'mock'): AgentPlugin & { lastBrief: AgentBrief | null } {
  const plugin: AgentPlugin & { lastBrief: AgentBrief | null } = {
    name,
    version: '1.0.0',
    capabilities: {
      supportsPause: true,
      supportsResume: true,
      supportsKill: true,
      supportsHotBriefUpdate: true,
    },
    lastBrief: null,
    async spawn(brief) {
      plugin.lastBrief = brief
      return {
        id: brief.agentId,
        pluginName: name,
        status: 'running' as const,
        sessionId: `session-${brief.agentId}`,
      }
    },
    async kill() { return { cleanShutdown: true, artifactsExtracted: 0 } },
    async pause() { return {} as any },
    async resume() { return {} as any },
    async resolveDecision() {},
    async injectContext() {},
    async updateBrief() {},
    async requestCheckpoint() { return {} as any },
  }
  return plugin
}

function createTestDeps(): {
  deps: ApiRouteDeps
  mockPlugin: ReturnType<typeof createMockPlugin>
} {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()

  const wsHub = new WebSocketHub(() => ({
    snapshot: emptySnapshot(),
    activeAgents: [],
    trustScores: [],
    controlMode: 'orchestrator' as const,
  }))
  wsHub.broadcast = () => {} // suppress broadcasts in tests

  const handles = new Map<string, AgentHandle>()
  const registry: AgentRegistry = {
    getHandle(id) { return handles.get(id) ?? null },
    listHandles(filter) {
      const all = Array.from(handles.values())
      if (!filter) return all
      return all.filter((h) => {
        if (filter.status && h.status !== filter.status) return false
        if (filter.pluginName && h.pluginName !== filter.pluginName) return false
        return true
      })
    },
    registerHandle(h) { handles.set(h.id, h) },
    updateHandle(id, updates) {
      const existing = handles.get(id)
      if (existing) Object.assign(existing, updates)
    },
    removeHandle(id) { handles.delete(id) },
  }

  const mockPlugin = createMockPlugin()
  const plugins = new Map<string, AgentPlugin>()
  plugins.set('mock', mockPlugin)

  const gateway: AgentGateway = {
    getPlugin(name) { return plugins.get(name) },
    async spawn(brief, pluginName) {
      const plugin = plugins.get(pluginName)
      if (!plugin) throw new Error(`No plugin: ${pluginName}`)
      return plugin.spawn(brief)
    },
  }

  const checkpointStore: CheckpointStore = {
    storeCheckpoint() {},
    getCheckpoints() { return [] },
    getLatestCheckpoint() { return undefined },
    getCheckpointCount() { return 0 },
    deleteCheckpoints() { return 0 },
  }

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  const deps: ApiRouteDeps = {
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore: {
      async getSnapshot() { return emptySnapshot() },
      async appendEvent() {},
    },
    checkpointStore,
    gateway,
    controlMode,
  }

  return { deps, mockPlugin }
}

function makeMinimalBrief(agentId: string, providerConfig?: Record<string, unknown>) {
  return {
    agentId,
    role: 'Test Agent',
    description: 'A test agent',
    workstream: 'test-ws',
    readableWorkstreams: [],
    constraints: [],
    escalationProtocol: {
      alwaysEscalate: [],
      escalateWhen: [],
      neverEscalate: [],
    },
    controlMode: 'orchestrator' as const,
    projectBrief: {
      title: 'Test Project',
      description: 'Test description',
      goals: ['test'],
      checkpoints: ['cp1'],
    },
    knowledgeSnapshot: emptySnapshot(),
    modelPreference: 'mock',
    allowedTools: ['bash'],
    ...(providerConfig !== undefined ? { providerConfig } : {}),
  }
}

let testPort = 9700

function createTestApp(deps: ApiRouteDeps) {
  const app = createApp(deps)
  const port = testPort++
  const server = createServer(app as any)
  const baseUrl = `http://localhost:${port}`

  return {
    server,
    baseUrl,
    async start() {
      await new Promise<void>((resolve) => server.listen(port, resolve))
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('providerConfig passthrough: backend -> plugin', () => {
  it('passes providerConfig from spawn request to plugin.spawn()', async () => {
    const { deps, mockPlugin } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    const providerConfig = { temperature: 0.7, maxTokens: 4096, topP: 0.9 }

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-provider-1', providerConfig),
      })

      expect(res.status).toBe(201)
      expect(mockPlugin.lastBrief).not.toBeNull()
      expect(mockPlugin.lastBrief!.providerConfig).toEqual(providerConfig)
    } finally {
      await app.close()
    }
  })

  it('passes undefined providerConfig when not provided', async () => {
    const { deps, mockPlugin } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-no-provider'),
      })

      expect(res.status).toBe(201)
      expect(mockPlugin.lastBrief).not.toBeNull()
      expect(mockPlugin.lastBrief!.providerConfig).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('passes complex nested providerConfig', async () => {
    const { deps, mockPlugin } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    const providerConfig = {
      model: 'gpt-4o',
      temperature: 0.3,
      stop: ['\n\n'],
      response_format: { type: 'json_object' },
    }

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-complex-config', providerConfig),
      })

      expect(res.status).toBe(201)
      expect(mockPlugin.lastBrief!.providerConfig).toEqual(providerConfig)
    } finally {
      await app.close()
    }
  })

  it('preserves providerConfig through Zod validation', async () => {
    const { deps, mockPlugin } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    const providerConfig = { custom_key: 'custom_value', nested: { deep: true } }

    try {
      const res = await httpPost(app.baseUrl, '/api/agents/spawn', {
        brief: makeMinimalBrief('agent-zod-valid', providerConfig),
      })

      expect(res.status).toBe(201)
      // Zod schema has providerConfig as z.record(z.string(), z.unknown()).optional()
      // so arbitrary keys should pass through
      expect(mockPlugin.lastBrief!.providerConfig).toEqual(providerConfig)
    } finally {
      await app.close()
    }
  })
})
