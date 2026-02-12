/**
 * Tests for the WebSocket service module.
 * Uses a mock WebSocket implementation since jsdom doesn't provide a real one.
 */

import { createWebSocketService } from './ws-service.js';
import type { WebSocketService } from './ws-service.js';

// ── Mock WebSocket ──────────────────────────────────────────────

type WSHandler = ((event: { data: string }) => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: WSHandler = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.();
  }
}

// ── Setup ───────────────────────────────────────────────────────

let service: WebSocketService;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
  // @ts-expect-error -- mock WebSocket for testing
  globalThis.WebSocket = MockWebSocket;
  service = createWebSocketService({ url: 'ws://localhost:3001', reconnectBaseMs: 100, reconnectMaxMs: 1000 });
});

afterEach(() => {
  service.disconnect();
  vi.useRealTimers();
});

// ── Connection ──────────────────────────────────────────────────

describe('connect', () => {
  it('creates a WebSocket connection', () => {
    service.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:3001');
  });

  it('reports isConnected as false before open', () => {
    service.connect();
    expect(service.isConnected()).toBe(false);
  });

  it('reports isConnected as true after open', () => {
    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    expect(service.isConnected()).toBe(true);
  });

  it('fires onConnectionChange when connected', () => {
    const handler = vi.fn();
    service.onConnectionChange(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    expect(handler).toHaveBeenCalledWith(true);
  });
});

// ── Disconnect ──────────────────────────────────────────────────

describe('disconnect', () => {
  it('closes the socket', () => {
    service.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    service.disconnect();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('reports isConnected as false', () => {
    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    service.disconnect();
    expect(service.isConnected()).toBe(false);
  });

  it('fires onConnectionChange with false', () => {
    const handler = vi.fn();
    service.onConnectionChange(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    handler.mockClear();
    service.disconnect();
    expect(handler).toHaveBeenCalledWith(false);
  });
});

// ── Reconnection ────────────────────────────────────────────────

describe('reconnection', () => {
  it('reconnects after close', () => {
    service.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    // Advance past reconnect delay
    vi.advanceTimersByTime(2000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect after intentional disconnect', () => {
    service.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    service.disconnect();

    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('fires onConnectionChange with false on disconnect', () => {
    const handler = vi.fn();
    service.onConnectionChange(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    handler.mockClear();
    MockWebSocket.instances[0].simulateClose();
    expect(handler).toHaveBeenCalledWith(false);
  });
});

// ── Message Handling ────────────────────────────────────────────

describe('message handling', () => {
  it('dispatches state_sync messages', () => {
    const handler = vi.fn();
    service.onStateSync(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    const msg = {
      type: 'state_sync',
      snapshot: { version: 1, generatedAt: '', workstreams: [], pendingDecisions: [], recentCoherenceIssues: [], artifactIndex: [], activeAgents: [], estimatedTokens: 0 },
      activeAgents: [],
      trustScores: [],
      controlMode: 'adaptive',
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('dispatches event messages', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    const msg = {
      type: 'event',
      workspace: 'queue',
      secondaryWorkspaces: [],
      envelope: { sourceEventId: 'e1', sourceSequence: 1, sourceOccurredAt: '', runId: 'r1', ingestedAt: '', event: { type: 'status', agentId: 'a1', message: 'test' } },
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('dispatches trust_update messages', () => {
    const handler = vi.fn();
    service.onTrustUpdate(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    const msg = { type: 'trust_update', agentId: 'a1', previousScore: 50, newScore: 55, delta: 5, reason: 'good' };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('dispatches decision_resolved messages', () => {
    const handler = vi.fn();
    service.onDecisionResolved(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    const msg = {
      type: 'decision_resolved',
      decisionId: 'dec-1',
      resolution: { type: 'option', chosenOptionId: 'opt-1', rationale: 'ok', actionKind: 'review' },
      agentId: 'a1',
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('dispatches brake messages', () => {
    const handler = vi.fn();
    service.onBrake(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    const msg = {
      type: 'brake',
      action: { scope: { type: 'all' }, reason: 'stop', behavior: 'pause', initiatedBy: 'human', timestamp: '' },
      affectedAgentIds: ['a1'],
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('ignores invalid JSON', () => {
    const handler = vi.fn();
    service.onStateSync(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage('not json');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Unsubscribe ─────────────────────────────────────────────────

describe('unsubscribe', () => {
  it('stops receiving messages after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = service.onStateSync(handler);
    service.connect();
    MockWebSocket.instances[0].simulateOpen();

    unsub();

    const msg = {
      type: 'state_sync',
      snapshot: { version: 1, generatedAt: '', workstreams: [], pendingDecisions: [], recentCoherenceIssues: [], artifactIndex: [], activeAgents: [], estimatedTokens: 0 },
      activeAgents: [],
      trustScores: [],
      controlMode: 'adaptive',
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify(msg));
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops receiving connection change after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = service.onConnectionChange(handler);
    unsub();

    service.connect();
    MockWebSocket.instances[0].simulateOpen();
    expect(handler).not.toHaveBeenCalled();
  });
});
