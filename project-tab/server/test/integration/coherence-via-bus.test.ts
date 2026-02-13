/**
 * Integration test: Layer 0 coherence detection through the full event bus pipeline.
 *
 * Validates Gap 4 acceptance criterion:
 * "Layer 0 coherence detects file conflict when real agent produces ArtifactEvent
 * with provenance.sourcePath matching an existing artifact's path"
 *
 * Tests that:
 * 1. Two ArtifactEvents from different agents with same sourcePath produce a CoherenceEvent
 * 2. The CoherenceEvent is stored in the KnowledgeStore
 * 3. The CoherenceEvent is broadcast to the WsHub as a classified event
 * 4. The event bus correctly wires artifact -> coherence monitor -> ws hub
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createServer } from 'node:http'

import { EventBus } from '../../src/bus'
import { EventClassifier } from '../../src/classifier'
import { TickService } from '../../src/tick'
import { WebSocketHub, type StateSnapshotProvider } from '../../src/ws-hub'
import { attachWebSocketUpgrade } from '../../src/app'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor'
import type {
  ArtifactEvent,
  EventEnvelope,
  FrontendMessage,
  KnowledgeSnapshot,
  WorkspaceEventMessage,
} from '../../src/types'

import { listenEphemeral } from '../helpers/listen-ephemeral'

// ── Helpers ────────────────────────────────────────────────────────

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeArtifactEnvelope(artifact: ArtifactEvent, seqNum: number): EventEnvelope {
  return {
    sourceEventId: `evt-art-${seqNum}`,
    sourceSequence: seqNum,
    sourceOccurredAt: new Date().toISOString(),
    runId: `run-${artifact.agentId}`,
    ingestedAt: new Date().toISOString(),
    event: artifact,
  }
}

async function connectWsClient(wsUrl: string) {
  const messages: FrontendMessage[] = []

  return new Promise<{
    messages: FrontendMessage[]
    close: () => void
  }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let firstMessage = true

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as FrontendMessage
      messages.push(msg)

      if (firstMessage) {
        firstMessage = false
        resolve({
          messages,
          close() { ws.close() },
        })
      }
    })

    ws.on('error', reject)
    setTimeout(() => reject(new Error('WS connect timed out')), 5000)
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Layer 0 coherence via event bus pipeline', () => {
  let eventBus: EventBus
  let knowledgeStore: KnowledgeStore
  let coherenceMonitor: CoherenceMonitor
  let classifier: EventClassifier
  let wsHub: WebSocketHub
  let tickService: TickService
  let server: ReturnType<typeof createServer>
  let wsUrl: string

  beforeEach(async () => {
    tickService = new TickService({ mode: 'manual' })
    eventBus = new EventBus()
    classifier = new EventClassifier()
    knowledgeStore = new KnowledgeStore()
    coherenceMonitor = new CoherenceMonitor()

    wsHub = new WebSocketHub(() => ({
      snapshot: emptySnapshot(),
      activeAgents: [],
      trustScores: [],
      controlMode: 'orchestrator' as const,
    }))

    server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    attachWebSocketUpgrade(server, wsHub)

    // Wire: event bus -> classifier -> ws hub (all events)
    eventBus.subscribe({}, (envelope) => {
      const classified = classifier.classify(envelope)
      wsHub.publishClassifiedEvent(classified)
    })

    // Wire: artifact events -> knowledge store + coherence monitor
    // This mirrors the exact wiring from index.ts lines 246-266
    eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
      if (envelope.event.type === 'artifact') {
        knowledgeStore.storeArtifact(envelope.event)

        const issue = coherenceMonitor.processArtifact(envelope.event)
        if (issue) {
          knowledgeStore.storeCoherenceIssue(issue)

          const coherenceEnvelope: EventEnvelope = {
            sourceEventId: `coherence-${issue.issueId}`,
            sourceSequence: -1,
            sourceOccurredAt: new Date().toISOString(),
            runId: envelope.runId,
            ingestedAt: new Date().toISOString(),
            event: issue,
          }
          const classified2 = classifier.classify(coherenceEnvelope)
          wsHub.publishClassifiedEvent(classified2)
        }
      }
    })

    tickService.start()

    const port = await listenEphemeral(server)
    wsUrl = `ws://localhost:${port}/ws`
  })

  afterEach(async () => {
    tickService.stop()
    wsHub.close()
    knowledgeStore.close()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  it('detects file conflict when two agents write to the same sourcePath', async () => {
    const client = await connectWsClient(wsUrl)

    // Agent A writes to /config/shared.json
    const artifactA: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-a',
      artifactId: 'art-a1',
      name: 'shared-config.json',
      kind: 'config',
      workstream: 'frontend',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: 'agent-a',
        createdAt: new Date().toISOString(),
        sourcePath: '/config/shared.json',
      },
    }

    // Agent B writes to the SAME path
    const artifactB: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-b',
      artifactId: 'art-b1',
      name: 'shared-config.json',
      kind: 'config',
      workstream: 'backend',
      status: 'draft',
      qualityScore: 0.85,
      provenance: {
        createdBy: 'agent-b',
        createdAt: new Date().toISOString(),
        sourcePath: '/config/shared.json',
      },
    }

    // Publish both through the event bus
    eventBus.publish(makeArtifactEnvelope(artifactA, 1))
    eventBus.publish(makeArtifactEnvelope(artifactB, 2))

    // Wait for events to flow through
    await delay(200)

    // 1. CoherenceMonitor should have detected the conflict
    const issues = coherenceMonitor.getDetectedIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.type).toBe('coherence')
    expect(issues[0]!.category).toBe('duplication')
    expect(issues[0]!.severity).toBe('high')
    expect(issues[0]!.title).toContain('/config/shared.json')

    // 2. KnowledgeStore should have both artifacts stored
    const storedA = knowledgeStore.getArtifact('art-a1')
    expect(storedA).toBeDefined()
    expect(storedA!.provenance.sourcePath).toBe('/config/shared.json')

    const storedB = knowledgeStore.getArtifact('art-b1')
    expect(storedB).toBeDefined()

    // 3. KnowledgeStore should have the coherence issue
    const coherenceIssues = knowledgeStore.listCoherenceIssues()
    expect(coherenceIssues).toHaveLength(1)
    expect(coherenceIssues[0]!.category).toBe('duplication')
    expect(coherenceIssues[0]!.affectedArtifactIds).toContain('art-a1')
    expect(coherenceIssues[0]!.affectedArtifactIds).toContain('art-b1')

    // 4. WsHub should have broadcast both artifact events AND the coherence event
    const eventMsgs = client.messages.filter(
      (m): m is WorkspaceEventMessage => m.type === 'event',
    )

    // We expect: artifact-a (map), artifact-b (map), coherence (map, with queue as secondary for high severity)
    const artifactMsgs = eventMsgs.filter(
      (m) => m.envelope.event.type === 'artifact',
    )
    const coherenceMsgs = eventMsgs.filter(
      (m) => m.envelope.event.type === 'coherence',
    )

    expect(artifactMsgs.length).toBe(2)
    expect(artifactMsgs.every((m) => m.workspace === 'map')).toBe(true)

    // Coherence events route to 'map' workspace (classifier.ts line 42-47)
    // with 'queue' as secondary workspace for high severity
    expect(coherenceMsgs.length).toBe(1)
    expect(coherenceMsgs[0]!.workspace).toBe('map')
    expect(coherenceMsgs[0]!.envelope.event.type).toBe('coherence')

    client.close()
  })

  it('does not produce coherence event when same agent writes to same path', async () => {
    const client = await connectWsClient(wsUrl)

    const artifact1: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-a',
      artifactId: 'art-1',
      name: 'index.ts',
      kind: 'code',
      workstream: 'frontend',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: 'agent-a',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/index.ts',
      },
    }

    const artifact2: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-a',
      artifactId: 'art-2',
      name: 'index.ts',
      kind: 'code',
      workstream: 'frontend',
      status: 'in_review',
      qualityScore: 0.95,
      provenance: {
        createdBy: 'agent-a',
        createdAt: new Date().toISOString(),
        sourcePath: '/src/index.ts',
      },
    }

    eventBus.publish(makeArtifactEnvelope(artifact1, 1))
    eventBus.publish(makeArtifactEnvelope(artifact2, 2))

    await delay(200)

    // No coherence issues should be detected
    expect(coherenceMonitor.getDetectedIssues()).toHaveLength(0)
    expect(knowledgeStore.listCoherenceIssues()).toHaveLength(0)

    // Only artifact events on WS, no coherence events
    const eventMsgs = client.messages.filter(
      (m): m is WorkspaceEventMessage => m.type === 'event',
    )
    const coherenceMsgs = eventMsgs.filter(
      (m) => m.envelope.event.type === 'coherence',
    )
    expect(coherenceMsgs).toHaveLength(0)

    client.close()
  })

  it('does not flag artifacts without sourcePath', async () => {
    const artifactNoPath: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-a',
      artifactId: 'art-np1',
      name: 'design.figma',
      kind: 'design',
      workstream: 'frontend',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: 'agent-a',
        createdAt: new Date().toISOString(),
        // No sourcePath
      },
    }

    const artifactNoPath2: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-b',
      artifactId: 'art-np2',
      name: 'design-v2.figma',
      kind: 'design',
      workstream: 'backend',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: 'agent-b',
        createdAt: new Date().toISOString(),
        // No sourcePath
      },
    }

    eventBus.publish(makeArtifactEnvelope(artifactNoPath, 1))
    eventBus.publish(makeArtifactEnvelope(artifactNoPath2, 2))

    await delay(100)

    expect(coherenceMonitor.getDetectedIssues()).toHaveLength(0)
    expect(coherenceMonitor.getPathOwnership().size).toBe(0)
  })

  it('CoherenceEvent includes correct affected artifacts and workstreams', async () => {
    const client = await connectWsClient(wsUrl)

    const artifact1: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-frontend',
      artifactId: 'art-fe-1',
      name: 'package.json',
      kind: 'config',
      workstream: 'ws-frontend',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: 'agent-frontend',
        createdAt: new Date().toISOString(),
        sourcePath: '/package.json',
      },
    }

    const artifact2: ArtifactEvent = {
      type: 'artifact',
      agentId: 'agent-backend',
      artifactId: 'art-be-1',
      name: 'package.json',
      kind: 'config',
      workstream: 'ws-backend',
      status: 'draft',
      qualityScore: 0.85,
      provenance: {
        createdBy: 'agent-backend',
        createdAt: new Date().toISOString(),
        sourcePath: '/package.json',
      },
    }

    eventBus.publish(makeArtifactEnvelope(artifact1, 1))
    eventBus.publish(makeArtifactEnvelope(artifact2, 2))

    await delay(200)

    const issues = coherenceMonitor.getDetectedIssues()
    expect(issues).toHaveLength(1)

    const issue = issues[0]!
    expect(issue.affectedArtifactIds).toContain('art-fe-1')
    expect(issue.affectedArtifactIds).toContain('art-be-1')
    expect(issue.description).toContain('agent-frontend')
    expect(issue.description).toContain('agent-backend')
    expect(issue.title).toContain('/package.json')

    // Verify the coherence event was broadcast via WsHub
    const eventMsgs = client.messages.filter(
      (m): m is WorkspaceEventMessage => m.type === 'event' && m.envelope.event.type === 'coherence',
    )
    expect(eventMsgs).toHaveLength(1)

    const wsIssue = eventMsgs[0]!.envelope.event
    expect(wsIssue.type).toBe('coherence')
    if (wsIssue.type === 'coherence') {
      expect(wsIssue.severity).toBe('high')
      expect(wsIssue.category).toBe('duplication')
    }

    client.close()
  })
})
