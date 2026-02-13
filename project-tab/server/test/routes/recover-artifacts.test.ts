import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { listenEphemeral } from '../helpers/listen-ephemeral'

import { EventBus } from '../../src/bus'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { WebSocketHub } from '../../src/ws-hub'
import { createApp, attachWebSocketUpgrade } from '../../src/app'
import type { ApiRouteDeps, AgentRegistry, AgentGateway, CheckpointStore, ControlModeManager } from '../../src/routes'
import type { AgentHandle, KnowledgeSnapshot } from '../../src/types'
import type { ArtifactEvent, ControlMode } from '../../src/types/events'
import type { RecoveryResult } from '../../src/gateway/volume-recovery'

// ── Helpers ──────────────────────────────────────────────────────────

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

async function bootServer(deps: Partial<ApiRouteDeps> = {}) {
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

  const handles = new Map<string, AgentHandle>()
  const registry: AgentRegistry = {
    getHandle(id) { return handles.get(id) ?? null },
    listHandles() { return Array.from(handles.values()) },
    registerHandle(h) { handles.set(h.id, h) },
    updateHandle(id, updates) {
      const existing = handles.get(id)
      if (existing) Object.assign(existing, updates)
    },
    removeHandle(id) { handles.delete(id) },
  }

  const knowledgeStore = {
    async getSnapshot() { return emptySnapshot() },
    async appendEvent() {},
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
    async spawn() { throw new Error('Not available') },
  }

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  const fullDeps: ApiRouteDeps = {
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore,
    checkpointStore,
    gateway,
    controlMode,
    ...deps,
  }

  const app = createApp(fullDeps)
  const server = createServer(app as any)

  const port = await listenEphemeral(server)

  return {
    server,
    port,
    baseUrl: `http://localhost:${port}`,
    registry,
    async close() {
      tickService.stop()
      wsHub.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/agents/:id/recover-artifacts', () => {
  it('returns 503 when volume recovery is not configured', async () => {
    const srv = await bootServer()

    const res = await fetch(`${srv.baseUrl}/api/agents/agent-1/recover-artifacts`, {
      method: 'POST',
    })

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Volume recovery not available')

    await srv.close()
  })

  it('returns 503 when knowledgeStoreImpl is not available', async () => {
    const mockRecovery = {
      async recover() {
        return {} as RecoveryResult
      },
    }

    const srv = await bootServer({ volumeRecovery: mockRecovery })

    const res = await fetch(`${srv.baseUrl}/api/agents/agent-1/recover-artifacts`, {
      method: 'POST',
    })

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Knowledge store not available')

    await srv.close()
  })

  it('calls volume recovery with known artifacts for the agent', async () => {
    const knowledgeStoreImpl = new KnowledgeStore()

    // Store some artifacts for agent-1
    const artifact: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-1',
      artifactId: 'art-1',
      name: 'main.ts',
      kind: 'code',
      workstream: 'ws-backend',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: 'agent-1',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/main.ts',
      },
    }
    knowledgeStoreImpl.storeArtifact(artifact)

    // Store an artifact for a different agent (should not be included)
    knowledgeStoreImpl.storeArtifact({
      ...artifact,
      agentId: 'agent-2',
      artifactId: 'art-2',
      provenance: { ...artifact.provenance, createdBy: 'agent-2' },
    })

    const recoveredArtifacts: ArtifactEvent[][] = []
    const mockRecovery = {
      async recover(agentId: string, knownArtifacts: ArtifactEvent[]): Promise<RecoveryResult> {
        recoveredArtifacts.push(knownArtifacts)
        return {
          agentId,
          volumeName: `project-tab-workspace-${agentId}`,
          filesScanned: 1,
          skipped: [{ path: '/src/main.ts', artifactId: 'art-1' }],
          reuploaded: [],
          orphans: [],
          volumeDeleted: true,
          errors: [],
        }
      },
    }

    const srv = await bootServer({
      volumeRecovery: mockRecovery,
      knowledgeStoreImpl,
    })

    const res = await fetch(`${srv.baseUrl}/api/agents/agent-1/recover-artifacts`, {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentId).toBe('agent-1')
    expect(body.filesScanned).toBe(1)
    expect(body.volumeDeleted).toBe(true)
    expect(body.skipped).toHaveLength(1)

    // Should only pass agent-1's artifacts
    expect(recoveredArtifacts).toHaveLength(1)
    expect(recoveredArtifacts[0]).toHaveLength(1)
    expect(recoveredArtifacts[0]![0]!.artifactId).toBe('art-1')

    knowledgeStoreImpl.close()
    await srv.close()
  })

  it('returns 500 when recovery fails', async () => {
    const knowledgeStoreImpl = new KnowledgeStore()
    const mockRecovery = {
      async recover(): Promise<RecoveryResult> {
        throw new Error('Docker connection refused')
      },
    }

    const srv = await bootServer({
      volumeRecovery: mockRecovery,
      knowledgeStoreImpl,
    })

    const res = await fetch(`${srv.baseUrl}/api/agents/agent-1/recover-artifacts`, {
      method: 'POST',
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Recovery failed')
    expect(body.message).toContain('Docker connection refused')

    knowledgeStoreImpl.close()
    await srv.close()
  })
})
