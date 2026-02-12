/**
 * WebSocket connection manager for the project-tab backend.
 *
 * Handles connection, reconnection with exponential backoff + jitter,
 * typed message parsing, and subscription management.
 * All on*() methods return unsubscribe functions for React useEffect cleanup.
 */

import type {
  StateSyncMessage,
  WorkspaceEventMessage,
  TrustUpdateMessage,
  DecisionResolvedMessage,
  BrakeMessage,
  ServerFrontendMessage,
} from '../types/server.js';

// ── Config ────────────────────────────────────────────────────────

export interface WebSocketServiceConfig {
  url: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

// ── Interface ─────────────────────────────────────────────────────

export interface WebSocketService {
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;

  onStateSync(handler: (msg: StateSyncMessage) => void): () => void;
  onEvent(handler: (msg: WorkspaceEventMessage) => void): () => void;
  onTrustUpdate(handler: (msg: TrustUpdateMessage) => void): () => void;
  onDecisionResolved(handler: (msg: DecisionResolvedMessage) => void): () => void;
  onBrake(handler: (msg: BrakeMessage) => void): () => void;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
}

// ── Implementation ────────────────────────────────────────────────

export function createWebSocketService(config: WebSocketServiceConfig): WebSocketService {
  const {
    url,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30000,
  } = config;

  let socket: WebSocket | null = null;
  let connected = false;
  let intentionalDisconnect = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Typed listener sets
  const stateSyncListeners = new Set<(msg: StateSyncMessage) => void>();
  const eventListeners = new Set<(msg: WorkspaceEventMessage) => void>();
  const trustUpdateListeners = new Set<(msg: TrustUpdateMessage) => void>();
  const decisionResolvedListeners = new Set<(msg: DecisionResolvedMessage) => void>();
  const brakeListeners = new Set<(msg: BrakeMessage) => void>();
  const connectionChangeListeners = new Set<(connected: boolean) => void>();

  function setConnected(value: boolean) {
    if (connected !== value) {
      connected = value;
      for (const handler of connectionChangeListeners) {
        handler(value);
      }
    }
  }

  function getReconnectDelay(): number {
    const exponential = reconnectBaseMs * Math.pow(2, reconnectAttempt);
    const capped = Math.min(exponential, reconnectMaxMs);
    // Add jitter: 0.5x to 1.5x
    const jitter = capped * (0.5 + Math.random());
    return jitter;
  }

  function scheduleReconnect() {
    if (intentionalDisconnect) return;

    const delay = getReconnectDelay();
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      doConnect();
    }, delay);
  }

  function handleMessage(data: string) {
    let msg: ServerFrontendMessage;
    try {
      msg = JSON.parse(data) as ServerFrontendMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'state_sync':
        for (const handler of stateSyncListeners) handler(msg);
        break;
      case 'event':
        for (const handler of eventListeners) handler(msg);
        break;
      case 'trust_update':
        for (const handler of trustUpdateListeners) handler(msg);
        break;
      case 'decision_resolved':
        for (const handler of decisionResolvedListeners) handler(msg);
        break;
      case 'brake':
        for (const handler of brakeListeners) handler(msg);
        break;
    }
  }

  function doConnect() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      reconnectAttempt = 0;
      setConnected(true);
    };

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleMessage(event.data);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      socket = null;
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose will fire after onerror, so reconnection is handled there
    };
  }

  function subscribe<T>(set: Set<(msg: T) => void>, handler: (msg: T) => void): () => void {
    set.add(handler);
    return () => { set.delete(handler); };
  }

  return {
    connect() {
      intentionalDisconnect = false;
      reconnectAttempt = 0;
      doConnect();
    },

    disconnect() {
      intentionalDisconnect = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
        socket = null;
      }
      setConnected(false);
    },

    isConnected() {
      return connected;
    },

    onStateSync(handler) { return subscribe(stateSyncListeners, handler); },
    onEvent(handler) { return subscribe(eventListeners, handler); },
    onTrustUpdate(handler) { return subscribe(trustUpdateListeners, handler); },
    onDecisionResolved(handler) { return subscribe(decisionResolvedListeners, handler); },
    onBrake(handler) { return subscribe(brakeListeners, handler); },
    onConnectionChange(handler) { return subscribe(connectionChangeListeners, handler); },
  };
}
