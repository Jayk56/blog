import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ContextInjection,
  KillRequest,
  KillResponse,
  PluginCapabilities,
  Resolution,
  SerializedAgentState,
} from '../types'

/**
 * TeamsBridgePlugin implements AgentPlugin for Claude Code Agent Teams.
 *
 * Unlike LocalProcessPlugin/ContainerPlugin, this plugin doesn't spawn
 * processes. Instead, agents self-register by posting events to the
 * bridge ingest endpoint. The plugin tracks handles and translates
 * lifecycle operations into file-based signals.
 */
export class TeamsBridgePlugin implements AgentPlugin {
  readonly name = 'teams-bridge'
  readonly version = '1.0.0'
  readonly capabilities: PluginCapabilities = {
    supportsPause: false,
    supportsResume: false,
    supportsKill: false,
    supportsHotBriefUpdate: false,
  }

  private readonly handles = new Map<string, AgentHandle>()
  private readonly bridgeDir: string
  private readonly lastSequences = new Map<string, number>()
  private readonly contextStore = new Map<string, ContextInjection>()

  constructor(bridgeDir?: string) {
    this.bridgeDir = bridgeDir || join(process.cwd(), '.bridge')
  }

  /**
   * spawn() is a registration-only operation for bridge agents.
   * The actual agent is spawned by the Agent Teams team lead, not by this plugin.
   */
  async spawn(brief: AgentBrief): Promise<AgentHandle> {
    const handle: AgentHandle = {
      id: brief.agentId,
      pluginName: this.name,
      status: 'running',
      sessionId: `bridge-${brief.agentId}-${Date.now()}`,
    }
    this.handles.set(brief.agentId, handle)
    return handle
  }

  /**
   * Registers a pre-built handle directly (used by the bridge register endpoint).
   */
  registerHandle(handle: AgentHandle): void {
    this.handles.set(handle.id, handle)
  }

  async pause(_handle: AgentHandle): Promise<SerializedAgentState> {
    throw new Error('TeamsBridgePlugin does not support pause')
  }

  async resume(_state: SerializedAgentState): Promise<AgentHandle> {
    throw new Error('TeamsBridgePlugin does not support resume')
  }

  /**
   * kill() writes a brake sentinel file for the agent.
   * The agent's PreToolUse hook can check this file to stop work.
   */
  async kill(handle: AgentHandle, _options?: KillRequest): Promise<KillResponse> {
    try {
      const brakeDir = join(this.bridgeDir, 'brake')
      await mkdir(brakeDir, { recursive: true })
      await writeFile(
        join(brakeDir, handle.id),
        JSON.stringify({ reason: 'killed', at: new Date().toISOString() }),
        'utf-8'
      )
    } catch {
      // Best effort — the file-drop may fail if the bridge dir doesn't exist
    }

    this.handles.delete(handle.id)
    return { cleanShutdown: false, artifactsExtracted: 0 }
  }

  async resolveDecision(_handle: AgentHandle, _decisionId: string, _resolution: Resolution): Promise<void> {
    // No-op: bridge agents in full-auto mode don't receive decision resolutions
  }

  /**
   * injectContext() writes context to .bridge/context/{agentId}.md
   * for the agent's hooks or CLAUDE.md instructions to pick up.
   */
  async injectContext(handle: AgentHandle, injection: ContextInjection): Promise<void> {
    const contextDir = join(this.bridgeDir, 'context')
    await mkdir(contextDir, { recursive: true })
    await writeFile(
      join(contextDir, `${handle.id}.md`),
      injection.content,
      'utf-8'
    )
    this.contextStore.set(handle.id, injection)
  }

  async updateBrief(_handle: AgentHandle, _changes: Partial<AgentBrief>): Promise<void> {
    // No-op: hot brief updates are not supported for bridge agents
  }

  /**
   * requestCheckpoint() returns a synthetic state from the last known event sequence.
   */
  async requestCheckpoint(handle: AgentHandle, decisionId: string): Promise<SerializedAgentState> {
    return {
      agentId: handle.id,
      pluginName: this.name,
      sessionId: handle.sessionId,
      checkpoint: { sdk: 'mock', scriptPosition: this.lastSequences.get(handle.id) ?? 0 },
      briefSnapshot: { agentId: handle.id, role: 'bridge', description: 'Bridge agent', workstream: 'default', readableWorkstreams: [], constraints: [], escalationProtocol: { alwaysEscalate: [], escalateWhen: [], neverEscalate: [] }, controlMode: 'orchestrator', projectBrief: { title: 'Bridge', description: 'Bridge agent', goals: [], checkpoints: [] }, knowledgeSnapshot: { version: 0, generatedAt: new Date().toISOString(), workstreams: [], pendingDecisions: [], recentCoherenceIssues: [], artifactIndex: [], activeAgents: [], estimatedTokens: 0 }, allowedTools: [] },
      pendingDecisionIds: decisionId ? [decisionId] : [],
      lastSequence: this.lastSequences.get(handle.id) ?? 0,
      serializedAt: new Date().toISOString(),
      serializedBy: 'decision_checkpoint',
      estimatedSizeBytes: 256,
    }
  }

  /** Get a registered handle by agent ID. */
  getHandle(agentId: string): AgentHandle | undefined {
    return this.handles.get(agentId)
  }

  /** Update the last known sequence number for an agent. */
  updateSequence(agentId: string, sequence: number): void {
    this.lastSequences.set(agentId, sequence)
  }

  /** Read pending context for an agent and clear it. */
  async consumeContext(agentId: string): Promise<ContextInjection | null> {
    const injection = this.contextStore.get(agentId)
    if (!injection) return null

    // Clear the stored context and remove the file
    this.contextStore.delete(agentId)
    try {
      await unlink(join(this.bridgeDir, 'context', `${agentId}.md`))
    } catch {
      // File may not exist — that's fine
    }
    return injection
  }

  /** Check if brake is active for an agent. */
  async isBrakeActive(agentId: string): Promise<boolean> {
    try {
      await readFile(join(this.bridgeDir, 'brake', agentId), 'utf-8')
      return true
    } catch {
      return false
    }
  }

  /** Clear brake for an agent. */
  async clearBrake(agentId: string): Promise<void> {
    try {
      await unlink(join(this.bridgeDir, 'brake', agentId))
    } catch {
      // File may not exist — that's fine
    }
  }
}
