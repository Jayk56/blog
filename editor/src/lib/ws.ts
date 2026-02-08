import { useCallback, useEffect, useRef, useMemo } from 'react'

export interface WebSocketEvent {
  type: string
  [key: string]: any
}

type EventCallback = (event: WebSocketEvent) => void

interface WSInstance {
  ws: WebSocket | null
  callbacks: Map<string, Set<EventCallback>>
  reconnectTimeout: NodeJS.Timeout | null
}

const wsInstance: WSInstance = {
  ws: null,
  callbacks: new Map(),
  reconnectTimeout: null,
}

function connect() {
  if (wsInstance.ws?.readyState === WebSocket.OPEN) return

  try {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://localhost:3001`
    wsInstance.ws = new WebSocket(wsUrl)

    wsInstance.ws.onopen = () => {
      console.log('WebSocket connected')
    }

    wsInstance.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const callbacks = wsInstance.callbacks.get(data.type)
        if (callbacks) {
          callbacks.forEach((cb) => cb(data))
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    wsInstance.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 3s...')
      wsInstance.ws = null
      wsInstance.reconnectTimeout = setTimeout(() => {
        connect()
      }, 3000)
    }

    wsInstance.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  } catch (error) {
    console.error('Failed to create WebSocket:', error)
  }
}

export function subscribe(
  type: string,
  callback: EventCallback
): () => void {
  if (!wsInstance.callbacks.has(type)) {
    wsInstance.callbacks.set(type, new Set())
  }
  wsInstance.callbacks.get(type)!.add(callback)

  // Connect on first subscription
  if (!wsInstance.ws) {
    connect()
  }

  return () => {
    const callbacks = wsInstance.callbacks.get(type)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        wsInstance.callbacks.delete(type)
      }
    }
  }
}

export function useWebSocket() {
  const subscribeFnRef = useRef(subscribe)

  useEffect(() => {
    // Connect on mount
    if (!wsInstance.ws) {
      connect()
    }
  }, [])

  const stableSubscribe = useCallback(
    (type: string, callback: EventCallback): (() => void) => {
      return subscribeFnRef.current(type, callback)
    },
    []
  )

  return useMemo(() => ({
    subscribe: stableSubscribe,
  }), [stableSubscribe])
}
