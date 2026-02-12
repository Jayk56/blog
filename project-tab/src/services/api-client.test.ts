/**
 * Tests for the API client module.
 * Uses mocked fetch to verify request/response shapes.
 */

import { createApiClient, ApiError } from './api-client.js';
import type { ApiClient } from './api-client.js';

// ── Fetch Mock ──────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;
let client: ApiClient;

function mockResponse(body: unknown, status = 200, statusText = 'OK') {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockErrorResponse(body: unknown, status: number, statusText = 'Error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
  client = createApiClient({ baseUrl: 'http://localhost:3001/api' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Health ─────────────────────────────────────────────────────

describe('getHealth', () => {
  it('returns health data', async () => {
    mockResponse({ status: 'ok', tick: 5 });
    const result = await client.getHealth();
    expect(result).toEqual({ status: 'ok', tick: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/health',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
  });
});

// ── Agents ────────────────────────────────────────────────────

describe('listAgents', () => {
  it('returns array of agent handles', async () => {
    const agents = [{ id: 'a1', pluginName: 'openai', status: 'running', sessionId: 'sess-1' }];
    mockResponse({ agents });
    const result = await client.listAgents();
    expect(result).toEqual(agents);
  });
});

describe('getAgent', () => {
  it('returns a single agent handle', async () => {
    const agent = { id: 'a1', pluginName: 'openai', status: 'running', sessionId: 'sess-1' };
    mockResponse({ agent });
    const result = await client.getAgent('a1');
    expect(result).toEqual(agent);
  });

  it('throws ApiError on 404', async () => {
    mockErrorResponse({ error: 'Agent not found' }, 404, 'Not Found');
    await expect(client.getAgent('nonexistent')).rejects.toThrow(ApiError);
  });
});

describe('spawnAgent', () => {
  it('sends POST with brief and returns handle', async () => {
    const agent = { id: 'a2', pluginName: 'claude', status: 'running', sessionId: 'sess-2' };
    mockResponse({ agent }, 201);
    const result = await client.spawnAgent({ agentId: 'a2', role: 'coder' });
    expect(result).toEqual(agent);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/agents/spawn',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('killAgent', () => {
  it('sends POST with kill options', async () => {
    mockResponse({ killed: true, cleanShutdown: true, artifactsExtracted: 2, orphanedDecisions: 0 });
    const result = await client.killAgent('a1', { grace: true, graceTimeoutMs: 5000 });
    expect(result.killed).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/agents/a1/kill',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ grace: true, graceTimeoutMs: 5000 }),
      }),
    );
  });
});

describe('pauseAgent', () => {
  it('sends POST to pause endpoint', async () => {
    mockResponse({ paused: true, agentId: 'a1' });
    const result = await client.pauseAgent('a1');
    expect(result.paused).toBe(true);
  });
});

describe('resumeAgent', () => {
  it('sends POST to resume endpoint', async () => {
    mockResponse({ resumed: true, agentId: 'a1' });
    const result = await client.resumeAgent('a1');
    expect(result.resumed).toBe(true);
  });
});

describe('updateAgentBrief', () => {
  it('sends PATCH with brief changes', async () => {
    mockResponse({ updated: true, agentId: 'a1' });
    const result = await client.updateAgentBrief('a1', { description: 'New desc' });
    expect(result.updated).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/agents/a1/brief',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

// ── Checkpoints ──────────────────────────────────────────────

describe('getCheckpoints', () => {
  it('returns checkpoints array', async () => {
    const checkpoints = [{ id: 1, agentId: 'a1', storedAt: '2024-01-01' }];
    mockResponse({ agentId: 'a1', checkpoints });
    const result = await client.getCheckpoints('a1');
    expect(result).toEqual(checkpoints);
  });
});

describe('getLatestCheckpoint', () => {
  it('returns latest checkpoint', async () => {
    const checkpoint = { id: 1, agentId: 'a1', storedAt: '2024-01-01' };
    mockResponse({ agentId: 'a1', checkpoint });
    const result = await client.getLatestCheckpoint('a1');
    expect(result).toEqual(checkpoint);
  });

  it('returns null on 404', async () => {
    mockErrorResponse({ error: 'No checkpoints' }, 404, 'Not Found');
    const result = await client.getLatestCheckpoint('a1');
    expect(result).toBeNull();
  });
});

// ── Decisions ────────────────────────────────────────────────

describe('listPendingDecisions', () => {
  it('returns decisions array', async () => {
    const decisions = [{ id: 'dec-1', status: 'pending' }];
    mockResponse({ decisions });
    const result = await client.listPendingDecisions();
    expect(result).toEqual(decisions);
  });
});

describe('resolveDecision', () => {
  it('sends POST with resolution', async () => {
    mockResponse({ resolved: true, decisionId: 'dec-1', agentId: 'a1' });
    const result = await client.resolveDecision('dec-1', {
      type: 'option',
      chosenOptionId: 'opt-1',
      rationale: 'Best choice',
      actionKind: 'review',
    });
    expect(result.resolved).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/decisions/dec-1/resolve',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('chosenOptionId'),
      }),
    );
  });
});

// ── Artifacts & Coherence ───────────────────────────────────

describe('listArtifacts', () => {
  it('returns artifacts array', async () => {
    const artifacts = [{ id: 'art-1', name: 'app.ts' }];
    mockResponse({ artifacts });
    const result = await client.listArtifacts();
    expect(result).toEqual(artifacts);
  });
});

describe('getArtifact', () => {
  it('returns a single artifact', async () => {
    const artifact = { id: 'art-1', name: 'app.ts' };
    mockResponse({ artifact });
    const result = await client.getArtifact('art-1');
    expect(result).toEqual(artifact);
  });
});

describe('listCoherenceIssues', () => {
  it('returns issues array', async () => {
    const issues = [{ id: 'coh-1', title: 'API drift' }];
    mockResponse({ issues });
    const result = await client.listCoherenceIssues();
    expect(result).toEqual(issues);
  });
});

// ── Control ─────────────────────────────────────────────────

describe('getControlMode', () => {
  it('returns control mode', async () => {
    mockResponse({ controlMode: 'adaptive' });
    const result = await client.getControlMode();
    expect(result).toBe('adaptive');
  });
});

describe('setControlMode', () => {
  it('sends PUT with new mode', async () => {
    mockResponse({ controlMode: 'orchestrator' });
    const result = await client.setControlMode('orchestrator');
    expect(result.controlMode).toBe('orchestrator');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/control-mode',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ controlMode: 'orchestrator' }),
      }),
    );
  });
});

// ── Trust ───────────────────────────────────────────────────

describe('getAgentTrust', () => {
  it('returns trust data', async () => {
    mockResponse({ agentId: 'a1', score: 75, config: { initialScore: 50, outcomes: {} } });
    const result = await client.getAgentTrust('a1');
    expect(result.score).toBe(75);
  });
});

// ── Tick ────────────────────────────────────────────────────

describe('advanceTick', () => {
  it('sends POST with steps', async () => {
    mockResponse({ tick: 6, advancedBy: 1, mode: 'manual' });
    const result = await client.advanceTick(1);
    expect(result.tick).toBe(6);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/tick/advance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ steps: 1 }),
      }),
    );
  });

  it('defaults to 1 step', async () => {
    mockResponse({ tick: 6, advancedBy: 1, mode: 'manual' });
    await client.advanceTick();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/tick/advance',
      expect.objectContaining({
        body: JSON.stringify({ steps: 1 }),
      }),
    );
  });
});

// ── Brake ───────────────────────────────────────────────────

describe('engageBrake', () => {
  it('sends POST with brake action', async () => {
    mockResponse({ brakeApplied: true, behavior: 'pause', affectedAgentIds: ['a1'] });
    const result = await client.engageBrake({
      scope: { type: 'all' },
      reason: 'Safety',
      behavior: 'pause',
      initiatedBy: 'human',
    });
    expect(result.brakeApplied).toBe(true);
    expect(result.affectedAgentIds).toEqual(['a1']);
  });
});

describe('releaseBrake', () => {
  it('sends POST to release endpoint', async () => {
    mockResponse({ released: true, resumedAgentIds: ['a1'], failedAgentIds: [] });
    const result = await client.releaseBrake();
    expect(result.released).toBe(true);
  });
});

// ── Error Handling ──────────────────────────────────────────

describe('ApiError', () => {
  it('throws ApiError with status on non-2xx response', async () => {
    mockErrorResponse({ error: 'Server error' }, 500, 'Internal Server Error');
    try {
      await client.getHealth();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toEqual({ error: 'Server error' });
    }
  });

  it('includes status text in message', async () => {
    mockErrorResponse({ error: 'Not found' }, 404, 'Not Found');
    try {
      await client.getAgent('missing');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toContain('404');
    }
  });
});

// ── URL Encoding ────────────────────────────────────────────

describe('URL encoding', () => {
  it('encodes agent IDs in URL paths', async () => {
    const agent = { id: 'a/b', pluginName: 'test', status: 'running', sessionId: 's1' };
    mockResponse({ agent });
    await client.getAgent('a/b');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/agents/a%2Fb',
      expect.anything(),
    );
  });
});
