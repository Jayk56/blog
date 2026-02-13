import type { Server } from 'node:http'

import express, { type Express } from 'express'
import cors from 'cors'

import type { WebSocketHub } from './ws-hub'
import { createApiRouter, type ApiRouteDeps } from './routes'

/** Dependencies needed to build the Express application. */
export type AppDeps = ApiRouteDeps

/**
 * Creates the configured Express app instance.
 */
export function createApp(deps: AppDeps): Express {
  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use('/api', createApiRouter(deps))

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  return app
}

/**
 * Attaches WebSocket upgrade handling to an HTTP server.
 */
export function attachWebSocketUpgrade(server: Server, wsHub: WebSocketHub, path = '/ws'): void {
  server.on('upgrade', (request, socket, head) => {
    if ((request.url ?? '').startsWith(path)) {
      wsHub.handleUpgrade(request, socket, head)
      return
    }

    socket.destroy()
  })
}
