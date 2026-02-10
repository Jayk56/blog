import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocket, WebSocketServer } from 'ws'

import type { ClassifiedEvent } from './classifier'
import type { FrontendMessage, StateSyncMessage, WorkspaceEventMessage } from './types'

/** Shape returned by the state provider for connect-time sync messages. */
export type StateSnapshotProvider = () => Omit<StateSyncMessage, 'type'>

type TrackedSocket = WebSocket & { isAlive?: boolean }

/**
 * WebSocketHub manages frontend socket connections and message fan-out.
 */
export class WebSocketHub {
  private readonly wss: WebSocketServer
  private readonly sockets = new Set<TrackedSocket>()
  private readonly heartbeatTimer: NodeJS.Timeout
  private readonly getState: StateSnapshotProvider

  constructor(getState: StateSnapshotProvider) {
    this.getState = getState
    this.wss = new WebSocketServer({ noServer: true })

    this.wss.on('connection', (socket) => {
      this.onConnection(socket as TrackedSocket)
    })

    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat()
    }, 30_000)
  }

  /** Handles HTTP upgrade requests and attaches accepted sockets to the hub. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request)
    })
  }

  /** Broadcasts a frontend message to all connected clients. */
  broadcast(message: FrontendMessage): void {
    const payload = JSON.stringify(message)
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload)
      }
    }
  }

  /** Alias for broadcast to match route/service naming. */
  sendToAll(message: FrontendMessage): void {
    this.broadcast(message)
  }

  /** Returns the current number of active frontend connections. */
  getConnectionCount(): number {
    return this.sockets.size
  }

  /** Broadcasts a classified envelope as a workspace-scoped event message. */
  publishClassifiedEvent(classified: ClassifiedEvent): void {
    const message: WorkspaceEventMessage = {
      type: 'event',
      workspace: classified.workspace,
      secondaryWorkspaces: classified.secondaryWorkspaces,
      envelope: classified.envelope
    }
    this.broadcast(message)
  }

  /** Releases resources and closes all sockets. */
  close(): void {
    clearInterval(this.heartbeatTimer)
    for (const socket of this.sockets) {
      socket.terminate()
    }
    this.sockets.clear()
    this.wss.close()
  }

  private onConnection(socket: TrackedSocket): void {
    socket.isAlive = true
    this.sockets.add(socket)

    socket.on('pong', () => {
      socket.isAlive = true
    })

    socket.on('close', () => {
      this.sockets.delete(socket)
    })

    socket.on('error', () => {
      this.sockets.delete(socket)
    })

    const stateSync: StateSyncMessage = {
      type: 'state_sync',
      ...this.getState()
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(stateSync))
    }
  }

  private runHeartbeat(): void {
    for (const socket of this.sockets) {
      if (socket.isAlive === false) {
        socket.terminate()
        this.sockets.delete(socket)
        continue
      }

      socket.isAlive = false
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping()
      }
    }
  }
}
