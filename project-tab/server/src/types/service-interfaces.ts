import type { AgentBrief, KnowledgeSnapshot } from './brief'
import type { ControlMode, DecisionEvent, EventEnvelope } from './events'
import type { AgentHandle, AgentPlugin, SerializedAgentState } from './plugin'

/** A stored checkpoint with its database metadata. */
export interface StoredCheckpoint {
  id: number
  agentId: string
  sessionId: string
  serializedBy: SerializedAgentState['serializedBy']
  decisionId?: string
  state: SerializedAgentState
  estimatedSizeBytes: number
  createdAt: string
}

/** Agent registry interface used by routes. */
export interface AgentRegistry {
  getHandle(agentId: string): AgentHandle | null
  listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[]
  registerHandle(handle: AgentHandle): void
  updateHandle(agentId: string, updates: Partial<AgentHandle>): void
  removeHandle(agentId: string): void
}

/** Result returned from artifact upload. */
export interface ArtifactUploadResult {
  backendUri: string
  artifactId: string
  stored: boolean
}

/** Knowledge store interface used by routes. */
export interface KnowledgeStore {
  getSnapshot(pendingDecisions?: DecisionEvent[]): Promise<KnowledgeSnapshot>
  appendEvent(envelope: EventEnvelope): Promise<void>
  storeArtifactContent?(agentId: string, artifactId: string, content: string, mimeType?: string): ArtifactUploadResult
}

/** Agent gateway interface used by routes. */
export interface AgentGateway {
  getPlugin(pluginName: string): AgentPlugin | undefined
  spawn(brief: AgentBrief, pluginName: string): Promise<AgentHandle>
}

/** Checkpoint store interface used by routes. */
export interface CheckpointStore {
  storeCheckpoint(state: SerializedAgentState, decisionId?: string, maxPerAgent?: number): void
  getCheckpoints(agentId: string): StoredCheckpoint[]
  getLatestCheckpoint(agentId: string): StoredCheckpoint | undefined
  getCheckpointCount(agentId: string): number
  deleteCheckpoints(agentId: string): number
}

/** Control mode manager interface for routes. */
export interface ControlModeManager {
  getMode(): ControlMode
  setMode(mode: ControlMode): void
}
