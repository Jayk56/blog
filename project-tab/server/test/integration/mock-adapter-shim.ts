/**
 * Mock Adapter Shim for integration testing.
 *
 * Simulates the real OpenAI adapter shim's HTTP+WS interface:
 *  - GET  /health     -> health check
 *  - POST /spawn      -> starts emitting scripted events
 *  - POST /kill       -> stops the agent
 *  - POST /resolve    -> resumes after a decision block
 *  - WS   /events     -> streams AdapterEvent messages to the backend gateway
 *
 * Used by integration tests so they don't need the real Python shim or an
 * OpenAI API key. Scripted event sequences cover all 18 Phase 1 acceptance
 * criteria.
 */
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

import type { AdapterEvent, AgentBrief } from '../../src/types'

/** A single scripted event entry for the mock shim. */
export interface MockShimEvent {
  delayMs: number
  event: AdapterEvent
  /** If set, the shim blocks here until the decision is resolved via POST /resolve. */
  blockOnDecisionId?: string
}

/** Configuration for the mock adapter shim. */
export interface MockShimConfig {
  port: number
  events: MockShimEvent[]
  /** If true, health check initially returns unhealthy, then healthy after startupDelayMs. */
  simulateSlowStartup?: boolean
  startupDelayMs?: number
  /** If true, the shim "crashes" after emitting crashAfterEvents events. */
  crashAfterEvents?: number
}

interface ShimState {
  healthy: boolean
  running: boolean
  agentId: string | null
  brief: AgentBrief | null
  eventIndex: number
  pendingDecisionId: string | null
  killed: boolean
  sequence: number
}

/**
 * Creates and starts a mock adapter shim HTTP+WS server.
 * Returns a handle to control and eventually close it.
 */
export function createMockAdapterShim(config: MockShimConfig) {
  const state: ShimState = {
    healthy: !config.simulateSlowStartup,
    running: false,
    agentId: null,
    brief: null,
    eventIndex: 0,
    pendingDecisionId: null,
    killed: false,
    sequence: 0,
  }

  const wss = new WebSocketServer({ noServer: true })
  const connectedClients = new Set<WebSocket>()
  let eventTimer: NodeJS.Timeout | null = null
  let resolveBlock: (() => void) | null = null

  // If simulating slow startup, become healthy after delay
  if (config.simulateSlowStartup && config.startupDelayMs) {
    setTimeout(() => {
      state.healthy = true
    }, config.startupDelayMs)
  }

  function broadcastEvent(adapterEvent: AdapterEvent): void {
    const payload = JSON.stringify(adapterEvent)
    for (const ws of connectedClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  async function emitEvents(): Promise<void> {
    while (state.eventIndex < config.events.length && state.running && !state.killed) {
      const entry = config.events[state.eventIndex]!

      // Simulate crash
      if (config.crashAfterEvents !== undefined && state.eventIndex >= config.crashAfterEvents) {
        // Close all WS connections and shut down ungracefully
        for (const ws of connectedClients) {
          ws.terminate()
        }
        connectedClients.clear()
        state.running = false
        state.healthy = false
        // Force close the server to simulate a real crash
        server.close()
        return
      }

      if (entry.delayMs > 0) {
        await new Promise<void>((resolve) => {
          eventTimer = setTimeout(resolve, entry.delayMs)
        })
      }

      if (!state.running || state.killed) break

      broadcastEvent(entry.event)
      state.eventIndex++

      // If this event blocks on a decision, wait for resolution
      if (entry.blockOnDecisionId) {
        state.pendingDecisionId = entry.blockOnDecisionId
        await new Promise<void>((resolve) => {
          resolveBlock = resolve
        })
        state.pendingDecisionId = null
        resolveBlock = null
      }
    }
  }

  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    const method = req.method ?? 'GET'

    if (method === 'GET' && url === '/health') {
      if (state.healthy) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'healthy',
          agentStatus: state.running ? 'running' : 'completed',
          uptimeMs: Date.now(),
          resourceUsage: { cpuPercent: 5, memoryMb: 128, diskMb: 50, collectedAt: new Date().toISOString() },
          pendingEventBufferSize: 0,
        }))
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'unhealthy' }))
      }
      return
    }

    if (method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {}

        if (url === '/spawn') {
          // LocalHttpPlugin sends brief directly; manual callers may wrap in { brief }
          const brief = parsed.brief ?? parsed
          state.agentId = brief?.agentId ?? 'mock-agent'
          state.brief = brief ?? null
          state.running = true
          state.killed = false
          state.eventIndex = 0
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            id: state.agentId,
            pluginName: 'openai-mock',
            status: 'running',
            sessionId: `session-${state.agentId}`,
          }))
          // Start emitting events asynchronously
          emitEvents().catch(() => { /* swallow errors after shutdown */ })
          return
        }

        if (url === '/kill') {
          state.killed = true
          state.running = false
          if (eventTimer) clearTimeout(eventTimer)
          if (resolveBlock) resolveBlock()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            cleanShutdown: true,
            artifactsExtracted: 0,
          }))
          return
        }

        if (url === '/resolve') {
          if (resolveBlock) {
            resolveBlock()
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (url === '/pause') {
          state.running = false
          if (eventTimer) clearTimeout(eventTimer)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (url === '/resume') {
          state.running = true
          emitEvents().catch(() => { /* swallow */ })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (url === '/inject-context') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (url === '/update-brief') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? ''
    if (url.startsWith('/events')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws) => {
    connectedClients.add(ws as WebSocket)
    ws.on('close', () => {
      connectedClients.delete(ws as WebSocket)
    })
    ws.on('error', () => {
      connectedClients.delete(ws as WebSocket)
    })
  })

  return {
    server,
    state,

    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.port, () => resolve())
      })
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        state.running = false
        state.killed = true
        if (eventTimer) clearTimeout(eventTimer)
        if (resolveBlock) resolveBlock()
        for (const ws of connectedClients) {
          ws.terminate()
        }
        connectedClients.clear()
        wss.close()
        server.close(() => resolve())
      })
    },

    getState() {
      return { ...state }
    },

    getPort() {
      return config.port
    },
  }
}

export type MockAdapterShim = ReturnType<typeof createMockAdapterShim>
