/**
 * Express application implementing the adapter shim wire protocol.
 *
 * Capabilities for Claude:
 *   supportsPause: false
 *   supportsResume: 'partial'
 *   supportsKill: 'partial'
 *   supportsHotBriefUpdate: false
 */

import express, { type Request, type Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import type http from 'node:http'
import { getArtifactUploadEndpoint, rewriteArtifactUri } from './artifact-upload.js'
import { ClaudeRunner } from './claude-runner.js'
import { MockRunner } from './mock-runner.js'
import type {
  AdapterEvent,
  AgentBrief,
  ContextInjection,
  KillRequest,
  ResolveRequest,
  SandboxHealthResponse,
  SerializedAgentState,
} from './models.js'

const MAX_EVENT_BUFFER = 1000

export interface AppState {
  mock: boolean
  workspace?: string
  runner: MockRunner | ClaudeRunner | null
  eventBuffer: AdapterEvent[]
  wsConnected: boolean
  startTime: number
}

export function createApp(options: { mock?: boolean; workspace?: string } = {}): express.Express {
  const app = express()
  app.use(express.json())

  const state: AppState = {
    mock: options.mock ?? false,
    workspace: options.workspace,
    runner: null,
    eventBuffer: [],
    wsConnected: false,
    startTime: Date.now(),
  }

  // Store state on app for access from WS setup
  ;(app as any).__state = state

  // GET /health
  app.get('/health', (_req: Request, res: Response) => {
    const uptimeMs = Date.now() - state.startTime
    let agentStatus = 'completed'
    if (state.runner) {
      agentStatus = state.runner.handle.status
    }

    const response: SandboxHealthResponse = {
      status: 'healthy',
      agentStatus: agentStatus as any,
      uptimeMs,
      resourceUsage: {
        cpuPercent: 0.0,
        memoryMb: 0.0,
        diskMb: 0.0,
        collectedAt: new Date().toISOString(),
      },
      pendingEventBufferSize: state.eventBuffer.length,
    }
    res.json(response)
  })

  // POST /spawn
  app.post('/spawn', async (req: Request, res: Response) => {
    if (state.runner !== null && state.runner.isRunning) {
      res.status(409).json({ detail: 'Agent already running' })
      return
    }

    const brief: AgentBrief = req.body

    // Enable decision gating unless the brief requests full autonomy
    const enableDecisionGating = brief.controlMode !== 'ecosystem'

    let runner: MockRunner | ClaudeRunner
    if (state.mock) {
      runner = new MockRunner(brief)
    } else {
      runner = new ClaudeRunner(brief, {
        workspace: state.workspace,
        enableDecisionGating,
      })
    }
    state.runner = runner
    runner.start()

    // Give the runner a moment to emit initial events
    await new Promise(r => setTimeout(r, 50))

    res.json(runner.handle)
  })

  // POST /kill
  app.post('/kill', async (req: Request, res: Response) => {
    if (state.runner === null) {
      res.status(404).json({ detail: 'No agent running' })
      return
    }

    const request: KillRequest = req.body ?? {}
    const grace = request.grace ?? true
    const response = await state.runner.kill(grace)
    drainToBuffer(state)
    res.json(response)
  })

  // POST /pause
  app.post('/pause', async (_req: Request, res: Response) => {
    if (state.runner === null) {
      res.status(404).json({ detail: 'No agent running' })
      return
    }

    const serialized = await state.runner.pause()
    drainToBuffer(state)
    res.json(serialized)
  })

  // POST /resume
  app.post('/resume', async (req: Request, res: Response) => {
    const agentState: SerializedAgentState = req.body
    const brief = agentState.briefSnapshot

    const enableDecisionGating = brief.controlMode !== 'ecosystem'

    let runner: MockRunner | ClaudeRunner
    if (state.mock) {
      runner = new MockRunner(brief)
    } else {
      const resumeSessionId = agentState.checkpoint?.sessionId ?? agentState.sessionId
      runner = new ClaudeRunner(brief, {
        workspace: state.workspace,
        resumeSessionId,
        enableDecisionGating,
      })
    }
    state.runner = runner
    runner.start()

    await new Promise(r => setTimeout(r, 50))
    res.json(runner.handle)
  })

  // POST /resolve
  app.post('/resolve', async (req: Request, res: Response) => {
    if (state.runner === null) {
      res.status(404).json({ detail: 'No agent running' })
      return
    }

    const request: ResolveRequest = req.body
    const resolved = state.runner.resolveDecision(request)
    if (!resolved) {
      res.status(404).json({ detail: `No pending decision with id ${request.decisionId}` })
      return
    }

    // Give the runner time to process the resolution and emit events
    await new Promise(r => setTimeout(r, 150))
    res.json({ status: 'resolved', decisionId: request.decisionId })
  })

  // Only expose debug config endpoint in mock mode
  if (state.mock) {
    app.get('/debug/config', (_req: Request, res: Response) => {
      if (state.runner === null) {
        res.json({ providerConfig: null })
        return
      }
      res.json({ providerConfig: state.runner.brief.providerConfig ?? null })
    })
  }

  // POST /inject-context
  app.post('/inject-context', (_req: Request, res: Response) => {
    // Plumbing only in Phase 1 -- accept but don't act
    res.json({ status: 'accepted' })
  })

  // POST /update-brief
  app.post('/update-brief', (req: Request, res: Response) => {
    if (state.runner === null) {
      res.status(404).json({ detail: 'No agent running' })
      return
    }
    // Store pending changes on handle; applied on next spawn/resume cycle
    // Claude does not support hot brief update
    res.json({ status: 'accepted' })
  })

  return app
}

/**
 * Set up WebSocket /events endpoint on an HTTP server.
 * The WS streams AdapterEvents from the mock runner to the backend.
 */
export function setupWebSocket(server: http.Server, app: express.Express): WebSocketServer {
  const state: AppState = (app as any).__state
  const wss = new WebSocketServer({ server, path: '/events' })
  const uploadEndpoint = getArtifactUploadEndpoint()

  wss.on('connection', (ws: WebSocket) => {
    state.wsConnected = true

    const sendEvent = async (event: AdapterEvent) => {
      if (uploadEndpoint) {
        event = await rewriteArtifactUri(event, uploadEndpoint)
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    }

    let draining = false
    const interval = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval)
        return
      }

      // Prevent re-entry when artifact upload latency exceeds 50ms
      if (draining) return
      draining = true

      try {
        drainToBuffer(state)

        while (state.eventBuffer.length > 0) {
          const event = state.eventBuffer.shift()!
          await sendEvent(event)
        }

        // If runner is done and no more events, do a final drain
        if (state.runner && !state.runner.isRunning && state.eventBuffer.length === 0) {
          setTimeout(async () => {
            drainToBuffer(state)
            while (state.eventBuffer.length > 0) {
              const event = state.eventBuffer.shift()!
              await sendEvent(event)
            }
          }, 50)
        }
      } finally {
        draining = false
      }
    }, 50)

    ws.on('close', () => {
      state.wsConnected = false
      clearInterval(interval)
    })

    ws.on('error', () => {
      state.wsConnected = false
      clearInterval(interval)
    })
  })

  return wss
}

function drainToBuffer(state: AppState): void {
  if (state.runner === null) return
  const events = state.runner.drainEvents()
  state.eventBuffer.push(...events)
  // Cap buffer size
  if (state.eventBuffer.length > MAX_EVENT_BUFFER) {
    state.eventBuffer = state.eventBuffer.slice(-MAX_EVENT_BUFFER)
  }
}
