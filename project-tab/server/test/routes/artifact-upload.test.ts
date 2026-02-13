import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { WebSocketHub } from '../../src/ws-hub'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, AgentPlugin, FrontendMessage, KnowledgeSnapshot, PluginCapabilities } from '../../src/types'
import type { ControlMode } from '../../src/types/events'
import { createApp } from '../../src/app'
import { listenEphemeral } from '../helpers/listen-ephemeral'

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

function createTestDeps(): {
  deps: ApiRouteDeps
  knowledgeStoreImpl: KnowledgeStore
} {
  const tickService = new TickService({ mode: 'manual' })
  const eventBus = new EventBus()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()
  const knowledgeStoreImpl = new KnowledgeStore(':memory:')

  const wsHub = new WebSocketHub(() => ({
    snapshot: emptySnapshot(),
    activeAgents: [],
    trustScores: [],
    controlMode: 'orchestrator' as const,
  }))

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

  const checkpointStore: CheckpointStore = {
    storeCheckpoint() {},
    getCheckpoints() { return [] },
    getLatestCheckpoint() { return undefined },
    getCheckpointCount() { return 0 },
    deleteCheckpoints() { return 0 },
  }

  const gateway: AgentGateway = {
    getPlugin() { return undefined },
    async spawn(brief, pluginName) { throw new Error('not implemented') },
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
      async getSnapshot() { return knowledgeStoreImpl.getSnapshot() },
      async appendEvent() {},
      storeArtifactContent(agentId: string, artifactId: string, content: string, mimeType?: string) {
        return knowledgeStoreImpl.storeArtifactContent(agentId, artifactId, content, mimeType)
      },
    },
    checkpointStore,
    gateway,
    controlMode,
    knowledgeStoreImpl,
  }

  return { deps, knowledgeStoreImpl }
}

function createTestApp(deps: ApiRouteDeps) {
  const app = createApp(deps)
  const server = createServer(app as any)
  let baseUrl = ''

  return {
    server,
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

async function httpGet(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.text(), json: async () => JSON.parse(await res.clone().text()) }
}

async function httpPost(baseUrl: string, path: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('Artifact Upload: POST /api/artifacts', () => {
  it('stores content and returns backendUri', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        artifactId: 'art-1',
        content: 'Hello, World!',
        mimeType: 'text/plain',
      })

      expect(res.status).toBe(201)
      expect(res.body.backendUri).toBe('artifact://agent-1/art-1')
      expect(res.body.artifactId).toBe('art-1')
      expect(res.body.stored).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('stores content even without mimeType', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        artifactId: 'art-2',
        content: 'some code',
      })

      expect(res.status).toBe(201)
      expect(res.body.backendUri).toBe('artifact://agent-1/art-2')
      expect(res.body.stored).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('works without content (no-op store)', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        artifactId: 'art-3',
      })

      expect(res.status).toBe(201)
      expect(res.body.backendUri).toBe('artifact://agent-1/art-3')
      expect(res.body.stored).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns 400 when missing agentId', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        artifactId: 'art-1',
        content: 'data',
      })

      expect(res.status).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('returns 400 when missing artifactId', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        content: 'data',
      })

      expect(res.status).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('overwrites content on duplicate artifactId', async () => {
    const { deps, knowledgeStoreImpl } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        artifactId: 'art-overwrite',
        content: 'version-1',
      })

      await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-1',
        artifactId: 'art-overwrite',
        content: 'version-2',
      })

      const stored = knowledgeStoreImpl.getArtifactContent('agent-1', 'art-overwrite')
      expect(stored).toBeDefined()
      expect(stored!.content).toBe('version-2')
    } finally {
      await app.close()
    }
  })
})

describe('Artifact Content Retrieval: GET /api/artifacts/:id/content', () => {
  it('returns stored content by artifact ID', async () => {
    const { deps, knowledgeStoreImpl } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // Register the artifact first
    knowledgeStoreImpl.storeArtifact({
      type: 'artifact',
      agentId: 'agent-1',
      artifactId: 'art-content-1',
      name: 'test.txt',
      kind: 'document',
      workstream: 'ws-test',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: 'agent-1',
        createdAt: new Date().toISOString(),
      },
    })

    // Store content directly
    knowledgeStoreImpl.storeArtifactContent('agent-1', 'art-content-1', 'Hello Content', 'text/plain')

    try {
      const res = await fetch(`${app.baseUrl}/api/artifacts/art-content-1/content`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/plain')
      const body = await res.text()
      expect(body).toBe('Hello Content')
    } finally {
      await app.close()
    }
  })

  it('returns 404 when content not found', async () => {
    const { deps } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      const res = await fetch(`${app.baseUrl}/api/artifacts/nonexistent/content`)
      expect(res.status).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('returns content without Content-Type when mimeType is null', async () => {
    const { deps, knowledgeStoreImpl } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    // Register the artifact first
    knowledgeStoreImpl.storeArtifact({
      type: 'artifact',
      agentId: 'agent-1',
      artifactId: 'art-no-mime',
      name: 'test.dat',
      kind: 'other',
      workstream: 'ws-test',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: 'agent-1',
        createdAt: new Date().toISOString(),
      },
    })

    knowledgeStoreImpl.storeArtifactContent('agent-1', 'art-no-mime', 'raw data')

    try {
      const res = await fetch(`${app.baseUrl}/api/artifacts/art-no-mime/content`)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toBe('raw data')
    } finally {
      await app.close()
    }
  })
})

describe('Artifact Upload + Retrieval round-trip', () => {
  it('POST uploads content, GET retrieves it', async () => {
    const { deps, knowledgeStoreImpl } = createTestDeps()
    const app = createTestApp(deps)
    await app.start()

    try {
      // Register the artifact first
      knowledgeStoreImpl.storeArtifact({
        type: 'artifact',
        agentId: 'agent-rt',
        artifactId: 'art-roundtrip',
        name: 'test.md',
        kind: 'document',
        workstream: 'ws-test',
        status: 'draft',
        qualityScore: 0.8,
        provenance: {
          createdBy: 'agent-rt',
          createdAt: new Date().toISOString(),
        },
      })

      // Upload
      const uploadRes = await httpPost(app.baseUrl, '/api/artifacts', {
        agentId: 'agent-rt',
        artifactId: 'art-roundtrip',
        content: 'roundtrip content',
        mimeType: 'text/markdown',
      })
      expect(uploadRes.status).toBe(201)
      expect(uploadRes.body.backendUri).toBe('artifact://agent-rt/art-roundtrip')

      // Retrieve
      const getRes = await fetch(`${app.baseUrl}/api/artifacts/art-roundtrip/content`)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toContain('text/markdown')
      const body = await getRes.text()
      expect(body).toBe('roundtrip content')
    } finally {
      await app.close()
    }
  })
})
