/**
 * Test Server Helper for integration tests.
 *
 * Boots the full backend server (Express + WebSocket) on a dynamically
 * allocated test port. Provides helpers for HTTP requests and WebSocket
 * connections to simplify test assertions.
 */
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'

import { EventBus } from '../../src/bus'
import { EventClassifier } from '../../src/classifier'
import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import { WebSocketHub, type StateSnapshotProvider } from '../../src/ws-hub'
import { createApp, attachWebSocketUpgrade } from '../../src/app'
import type { AgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from '../../src/routes'
import type {
  FrontendMessage,
  KnowledgeSnapshot,
  AgentHandle,
  StateSyncMessage,
  EventEnvelope,
} from '../../src/types'
import type { ControlMode } from '../../src/types/events'

/** Port pool for integration tests: 9200-9299 (avoids 9100-9199 shim pool). */
let nextTestPort = 9200

export function allocateTestPort(): number {
  return nextTestPort++
}

/** Reset port counter between test suites. */
export function resetTestPortCounter(): void {
  nextTestPort = 9200
}

/** Empty knowledge snapshot for test state sync. */
export function emptySnapshot(): KnowledgeSnapshot {
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

/** All components of a running test server. */
export interface TestServer {
  server: Server
  app: ReturnType<typeof createApp>
  eventBus: EventBus
  classifier: EventClassifier
  tickService: TickService
  wsHub: WebSocketHub
  port: number
  baseUrl: string
  wsUrl: string

  /** Override the state snapshot provider for StateSyncMessage testing. */
  setStateProvider(provider: StateSnapshotProvider): void

  /** Shut down the test server. */
  close(): Promise<void>
}

export interface TestServerOptions {
  stateProvider?: StateSnapshotProvider
  tickMode?: 'manual' | 'wall_clock'
}

/**
 * Creates and starts a full test server instance.
 */
export async function createTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const port = allocateTestPort()
  const tickService = new TickService({ mode: options.tickMode ?? 'manual' })
  const eventBus = new EventBus()
  const classifier = new EventClassifier()
  const trustEngine = new TrustEngine()
  const decisionQueue = new DecisionQueue()

  let stateProvider: StateSnapshotProvider = options.stateProvider ?? (() => ({
    snapshot: emptySnapshot(),
    activeAgents: [],
    trustScores: [],
    controlMode: 'orchestrator' as const,
  }))

  const wsHub = new WebSocketHub(() => stateProvider())

  // In-memory registry for tests
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

  const knowledgeStore: KnowledgeStore = {
    async getSnapshot() { return emptySnapshot() },
    async appendEvent() {},
    updateAgentStatus() {},
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
    async spawn() { throw new Error('No plugins registered in test server') },
  }

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode) { currentControlMode = mode },
  }

  const app = createApp({
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
  })
  const server = createServer(app as any)

  attachWebSocketUpgrade(server, wsHub)

  // Wire event bus -> classifier -> ws hub
  eventBus.subscribe({}, (envelope) => {
    const classified = classifier.classify(envelope)
    wsHub.publishClassifiedEvent(classified)
  })

  tickService.start()

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })

  return {
    server,
    app,
    eventBus,
    classifier,
    tickService,
    wsHub,
    port,
    baseUrl: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}/ws`,

    setStateProvider(provider: StateSnapshotProvider) {
      stateProvider = provider
    },

    async close() {
      tickService.stop()
      wsHub.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

/**
 * WebSocket test client that connects to the test server and collects messages.
 */
export class WsTestClient {
  private ws: WebSocket | null = null
  private messages: FrontendMessage[] = []
  private resolvers: Array<(msg: FrontendMessage) => void> = []

  constructor(private readonly wsUrl: string) {}

  /** Connect to the WebSocket server and start collecting messages. */
  async connect(): Promise<StateSyncMessage> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)

      this.ws.on('open', () => {
        // First message should be StateSyncMessage
      })

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as FrontendMessage
        this.messages.push(msg)

        // Resolve any pending waiters
        const resolversCopy = [...this.resolvers]
        this.resolvers = []
        for (const resolver of resolversCopy) {
          resolver(msg)
        }
      })

      this.ws.on('error', (err) => {
        reject(err)
      })

      // Wait for the first message (state_sync)
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for StateSyncMessage'))
      }, 5000)

      this.ws!.once('message', (data) => {
        clearTimeout(timeout)
        const msg = JSON.parse(data.toString()) as StateSyncMessage
        resolve(msg)
      })
    })
  }

  /** Wait for a message matching a predicate, with timeout. */
  async waitForMessage(
    predicate: (msg: FrontendMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<FrontendMessage> {
    // Check already-received messages first
    const existing = this.messages.find(predicate)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for matching message`))
      }, timeoutMs)

      const check = (msg: FrontendMessage) => {
        if (predicate(msg)) {
          clearTimeout(timeout)
          resolve(msg)
        } else {
          this.resolvers.push(check)
        }
      }

      this.resolvers.push(check)
    })
  }

  /** Wait for N messages of a specific type. */
  async waitForMessages(
    predicate: (msg: FrontendMessage) => boolean,
    count: number,
    timeoutMs = 5000,
  ): Promise<FrontendMessage[]> {
    const results: FrontendMessage[] = []

    const deadline = Date.now() + timeoutMs
    while (results.length < count) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for ${count} messages (got ${results.length})`)
      }
      const msg = await this.waitForMessage(
        (m) => predicate(m) && !results.includes(m),
        remaining,
      )
      results.push(msg)
    }

    return results
  }

  /** Get all collected messages. */
  getMessages(): FrontendMessage[] {
    return [...this.messages]
  }

  /** Get messages matching a type filter. */
  getMessagesByType<T extends FrontendMessage['type']>(
    type: T,
  ): Array<Extract<FrontendMessage, { type: T }>> {
    return this.messages.filter(
      (m): m is Extract<FrontendMessage, { type: T }> => m.type === type,
    )
  }

  /** Close the WebSocket connection. */
  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messages = []
    this.resolvers = []
  }
}

/**
 * HTTP helper for making requests to the test server.
 */
export async function httpGet(baseUrl: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`)
  const body = await res.json()
  return { status: res.status, body }
}

export async function httpPost(
  baseUrl: string,
  path: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseBody = await res.json()
  return { status: res.status, body: responseBody }
}

export async function httpPut(
  baseUrl: string,
  path: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseBody = await res.json()
  return { status: res.status, body: responseBody }
}
