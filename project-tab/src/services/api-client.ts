/**
 * Typed REST API client for the project-tab backend.
 *
 * Uses native fetch. All methods throw ApiError on non-2xx responses.
 * Designed to be instantiated once and passed through React context.
 */

import type {
  ServerAgentHandle,
  ServerArtifactSummary,
  ServerBrakeAction,
  ServerCoherenceIssueSummary,
  ServerControlMode,
  ServerKnowledgeSnapshot,
  ServerQueuedDecision,
  ServerResolution,
  ServerStoredCheckpoint,
  ServerTrustConfig,
} from '../types/server.js';

// ── Error Type ────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`API error ${status}: ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

// ── Config ────────────────────────────────────────────────────────

export interface ApiClientConfig {
  baseUrl: string;
}

// ── Client Interface ──────────────────────────────────────────────

export interface ApiClient {
  // Health
  getHealth(): Promise<{ status: string; tick: number }>;

  // Agents
  listAgents(): Promise<ServerAgentHandle[]>;
  getAgent(id: string): Promise<ServerAgentHandle>;
  spawnAgent(brief: Record<string, unknown>): Promise<ServerAgentHandle>;
  killAgent(id: string, opts: { grace: boolean; graceTimeoutMs?: number }): Promise<{
    killed: boolean;
    cleanShutdown: boolean;
    artifactsExtracted: number;
    orphanedDecisions: number;
  }>;
  pauseAgent(id: string): Promise<{ paused: boolean; agentId: string }>;
  resumeAgent(id: string): Promise<{ resumed: boolean; agentId: string }>;
  updateAgentBrief(id: string, changes: Record<string, unknown>): Promise<{ updated: boolean; agentId: string }>;

  // Checkpoints
  getCheckpoints(agentId: string): Promise<ServerStoredCheckpoint[]>;
  getLatestCheckpoint(agentId: string): Promise<ServerStoredCheckpoint | null>;

  // Decisions
  listPendingDecisions(): Promise<ServerQueuedDecision[]>;
  resolveDecision(id: string, resolution: ServerResolution): Promise<{ resolved: boolean; decisionId: string; agentId: string }>;

  // Artifacts & Coherence
  listArtifacts(): Promise<ServerArtifactSummary[]>;
  getArtifact(id: string): Promise<ServerArtifactSummary>;
  listCoherenceIssues(): Promise<ServerCoherenceIssueSummary[]>;

  // Control
  getControlMode(): Promise<ServerControlMode>;
  setControlMode(mode: ServerControlMode): Promise<{ controlMode: ServerControlMode }>;

  // Trust
  getAgentTrust(agentId: string): Promise<{ agentId: string; score: number; config: ServerTrustConfig }>;

  // Tick
  advanceTick(steps?: number): Promise<{ tick: number; advancedBy: number; mode: string }>;

  // Brake
  engageBrake(action: Omit<ServerBrakeAction, 'timestamp'>): Promise<{ brakeApplied: boolean; behavior: string; affectedAgentIds: string[] }>;
  releaseBrake(): Promise<{ released: boolean; resumedAgentIds: string[]; failedAgentIds: string[] }>;

  // Project
  updateProject(changes: {
    title?: string;
    description?: string;
    goals?: string[];
    constraints?: string[];
  }): Promise<{ updated: boolean }>;

  // Snapshot (convenience — fetches full state via health + agents + trust)
  getSnapshot(): Promise<ServerKnowledgeSnapshot>;
}

// ── Implementation ────────────────────────────────────────────────

async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new ApiError(res.status, res.statusText, body);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { baseUrl } = config;

  return {
    // ── Health ──────────────────────────────────────────────
    async getHealth() {
      return request<{ status: string; tick: number }>(baseUrl, '/health');
    },

    // ── Agents ──────────────────────────────────────────────
    async listAgents() {
      const data = await request<{ agents: ServerAgentHandle[] }>(baseUrl, '/agents');
      return data.agents;
    },

    async getAgent(id) {
      const data = await request<{ agent: ServerAgentHandle }>(baseUrl, `/agents/${encodeURIComponent(id)}`);
      return data.agent;
    },

    async spawnAgent(brief) {
      const data = await request<{ agent: ServerAgentHandle }>(baseUrl, '/agents/spawn', {
        method: 'POST',
        body: JSON.stringify({ brief }),
      });
      return data.agent;
    },

    async killAgent(id, opts) {
      return request(baseUrl, `/agents/${encodeURIComponent(id)}/kill`, {
        method: 'POST',
        body: JSON.stringify(opts),
      });
    },

    async pauseAgent(id) {
      return request(baseUrl, `/agents/${encodeURIComponent(id)}/pause`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async resumeAgent(id) {
      return request(baseUrl, `/agents/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async updateAgentBrief(id, changes) {
      return request(baseUrl, `/agents/${encodeURIComponent(id)}/brief`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
    },

    // ── Checkpoints ─────────────────────────────────────────
    async getCheckpoints(agentId) {
      const data = await request<{ agentId: string; checkpoints: ServerStoredCheckpoint[] }>(
        baseUrl,
        `/agents/${encodeURIComponent(agentId)}/checkpoints`,
      );
      return data.checkpoints;
    },

    async getLatestCheckpoint(agentId) {
      try {
        const data = await request<{ agentId: string; checkpoint: ServerStoredCheckpoint }>(
          baseUrl,
          `/agents/${encodeURIComponent(agentId)}/checkpoints/latest`,
        );
        return data.checkpoint;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },

    // ── Decisions ───────────────────────────────────────────
    async listPendingDecisions() {
      const data = await request<{ decisions: ServerQueuedDecision[] }>(baseUrl, '/decisions');
      return data.decisions;
    },

    async resolveDecision(id, resolution) {
      return request(baseUrl, `/decisions/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
    },

    // ── Artifacts & Coherence ───────────────────────────────
    async listArtifacts() {
      const data = await request<{ artifacts: ServerArtifactSummary[] }>(baseUrl, '/artifacts');
      return data.artifacts;
    },

    async getArtifact(id) {
      const data = await request<{ artifact: ServerArtifactSummary }>(baseUrl, `/artifacts/${encodeURIComponent(id)}`);
      return data.artifact;
    },

    async listCoherenceIssues() {
      const data = await request<{ issues: ServerCoherenceIssueSummary[] }>(baseUrl, '/coherence');
      return data.issues;
    },

    // ── Control ─────────────────────────────────────────────
    async getControlMode() {
      const data = await request<{ controlMode: ServerControlMode }>(baseUrl, '/control-mode');
      return data.controlMode;
    },

    async setControlMode(mode) {
      return request(baseUrl, '/control-mode', {
        method: 'PUT',
        body: JSON.stringify({ controlMode: mode }),
      });
    },

    // ── Trust ───────────────────────────────────────────────
    async getAgentTrust(agentId) {
      return request(baseUrl, `/trust/${encodeURIComponent(agentId)}`);
    },

    // ── Tick ────────────────────────────────────────────────
    async advanceTick(steps = 1) {
      return request(baseUrl, '/tick/advance', {
        method: 'POST',
        body: JSON.stringify({ steps }),
      });
    },

    // ── Brake ───────────────────────────────────────────────
    async engageBrake(action) {
      return request(baseUrl, '/brake', {
        method: 'POST',
        body: JSON.stringify({
          ...action,
          timestamp: new Date().toISOString(),
        }),
      });
    },

    async releaseBrake() {
      return request(baseUrl, '/brake/release', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    // ── Project ─────────────────────────────────────────────
    async updateProject(changes) {
      return request(baseUrl, '/project', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
    },

    // ── Snapshot (convenience) ──────────────────────────────
    async getSnapshot() {
      const health = await request<{ status: string; tick: number }>(baseUrl, '/health');
      const agentsData = await request<{ agents: ServerAgentHandle[] }>(baseUrl, '/agents');
      const artifactsData = await request<{ artifacts: ServerArtifactSummary[] }>(baseUrl, '/artifacts');
      const decisionsData = await request<{ decisions: ServerQueuedDecision[] }>(baseUrl, '/decisions');
      const coherenceData = await request<{ issues: ServerCoherenceIssueSummary[] }>(baseUrl, '/coherence');

      // Build a minimal snapshot from available data
      const snapshot: ServerKnowledgeSnapshot = {
        version: health.tick,
        generatedAt: new Date().toISOString(),
        workstreams: [],
        pendingDecisions: decisionsData.decisions
          .filter((d) => d.status === 'pending')
          .map((d) => ({
            id: d.id,
            title: d.event.type === 'decision' ? ('title' in d.event ? d.event.title : d.event.toolName) : d.id,
            severity: (d.event.type === 'decision' && d.event.severity) ? d.event.severity : 'medium',
            agentId: d.event.agentId,
            subtype: d.event.subtype,
          })),
        recentCoherenceIssues: coherenceData.issues,
        artifactIndex: artifactsData.artifacts,
        activeAgents: agentsData.agents.map((a) => ({
          id: a.id,
          role: 'agent',
          workstream: '',
          status: a.status,
          pluginName: a.pluginName,
        })),
        estimatedTokens: 0,
      };

      return snapshot;
    },
  };
}
