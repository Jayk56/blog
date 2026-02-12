import { WebSocket } from 'ws'

import type { EventBus } from '../bus'
import type { EventEnvelope } from '../types'
import { validateAdapterEvent } from '../validation/schemas'
import { quarantineEvent } from '../validation/quarantine'

/** Minimal interface for a WebSocket constructor (allows test mocks). */
export interface WebSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void
  close(): void
  readyState?: number
}

/** A constructor that creates WebSocketLike instances. */
export type WebSocketFactory = new (url: string) => WebSocketLike

/** Options for creating an EventStreamClient. */
export interface EventStreamClientOptions {
  /** WebSocket URL to connect to (e.g. ws://localhost:9100/events). */
  url: string
  /** Agent ID for logging and event filtering. */
  agentId: string
  /** EventBus to publish validated events into. */
  eventBus: EventBus
  /** Maximum reconnect backoff delay in ms. Default: 30000. */
  maxReconnectDelayMs?: number
  /** Initial reconnect delay in ms. Default: 500. */
  initialReconnectDelayMs?: number
  /** Callback when the connection drops unexpectedly. */
  onDisconnect?: () => void
  /** WebSocket constructor — injectable for testing. */
  WebSocketCtor?: WebSocketFactory
}

/**
 * EventStreamClient connects to an adapter shim's WS /events endpoint
 * and pipes validated events into the EventBus.
 *
 * Features:
 * - Validates incoming events via validateAdapterEvent()
 * - Stamps ingestedAt to produce EventEnvelope
 * - Reconnects with exponential backoff (max 30s) on disconnect
 * - Quarantines malformed events
 */
export class EventStreamClient {
  private ws: WebSocketLike | null = null
  private readonly url: string
  private readonly agentId: string
  private readonly eventBus: EventBus
  private readonly maxReconnectDelayMs: number
  private readonly initialReconnectDelayMs: number
  private readonly onDisconnect?: () => void
  private readonly WebSocketCtor: WebSocketFactory

  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private quarantineSeq = 0

  constructor(options: EventStreamClientOptions) {
    this.url = options.url
    this.agentId = options.agentId
    this.eventBus = options.eventBus
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 500
    this.onDisconnect = options.onDisconnect
    this.WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as WebSocketFactory)
  }

  /** Connect to the event stream. */
  connect(): void {
    if (this.closed) return

    this.ws = new this.WebSocketCtor(this.url)

    this.ws.on('open', () => {
      // eslint-disable-next-line no-console
      console.log(`[EventStreamClient:${this.agentId}] connected to ${this.url}`)
      this.reconnectAttempts = 0
    })

    this.ws.on('message', (data: unknown) => {
      this.handleMessage(data)
    })

    this.ws.on('close', () => {
      if (!this.closed) {
        // eslint-disable-next-line no-console
        console.warn(`[EventStreamClient:${this.agentId}] connection closed, scheduling reconnect`)
        this.onDisconnect?.()
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(`[EventStreamClient:${this.agentId}] WebSocket error:`, message)
      // 'close' event will follow, which triggers reconnect
    })
  }

  /** Permanently close the connection and stop reconnecting. */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /** Whether the client has been permanently closed. */
  get isClosed(): boolean {
    return this.closed
  }

  /** Current reconnect attempt count (resets on successful connect). */
  get currentReconnectAttempts(): number {
    return this.reconnectAttempts
  }

  /** Handle an incoming WebSocket message. */
  private handleMessage(data: unknown): void {
    let parsed: unknown
    try {
      const str = data instanceof Buffer ? data.toString() : String(data)
      parsed = JSON.parse(str)
    } catch {
      // eslint-disable-next-line no-console
      console.error(`[EventStreamClient:${this.agentId}] received non-JSON message`)
      this.emitQuarantineWarning('Received non-JSON message from adapter')
      return
    }

    const result = validateAdapterEvent(parsed)

    if (!result.ok) {
      const entry = quarantineEvent(result.raw, result.error)
      const issues = result.error.issues.map((i) => i.message)
      // eslint-disable-next-line no-console
      console.error(
        `[EventStreamClient:${this.agentId}] invalid event quarantined`,
        { issues, raw: result.raw, quarantinedAt: entry.quarantinedAt }
      )
      this.emitQuarantineWarning(
        `Malformed adapter event quarantined: ${issues.join('; ')}`
      )
      return
    }

    // Verify that the event's agentId matches the expected agent for this connection
    if (result.event.event.agentId !== this.agentId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[EventStreamClient:${this.agentId}] rejecting event with mismatched agentId: ${result.event.event.agentId}`
      )
      return
    }

    const envelope: EventEnvelope = {
      ...result.event,
      ingestedAt: new Date().toISOString(),
    }

    this.eventBus.publish(envelope)
  }

  /**
   * Emits a synthetic ErrorEvent (severity: warning) into the EventBus
   * when an incoming event fails validation or cannot be parsed.
   */
  private emitQuarantineWarning(message: string): void {
    const now = new Date().toISOString()
    const warningEnvelope: EventEnvelope = {
      sourceEventId: `quarantine-${this.agentId}-${Date.now()}-${++this.quarantineSeq}`,
      sourceSequence: -1,
      sourceOccurredAt: now,
      runId: `quarantine-${this.agentId}`,
      ingestedAt: now,
      event: {
        type: 'error',
        agentId: this.agentId,
        severity: 'warning',
        message,
        recoverable: true,
        category: 'internal',
      },
    }
    this.eventBus.publish(warningEnvelope)
  }

  /** Schedule a reconnection with exponential backoff. */
  private scheduleReconnect(): void {
    if (this.closed) return

    this.reconnectAttempts++
    const delay = Math.min(
      this.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    )

    // eslint-disable-next-line no-console
    console.log(
      `[EventStreamClient:${this.agentId}] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
