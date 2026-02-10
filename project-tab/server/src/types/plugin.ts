import type { AgentBrief, ContextInjection } from './brief'
import type { PluginTransport } from './transport'
import type { Resolution } from './resolution'

/** Plugin capability flags for lifecycle semantics. */
export interface PluginCapabilities {
  supportsPause: boolean
  supportsResume: boolean
  supportsKill: boolean
  supportsHotBriefUpdate: boolean
}

/** SDK-specific checkpoint payload held opaquely by backend. */
export type SdkCheckpoint =
  | { sdk: 'openai'; runStateJson: string }
  | { sdk: 'claude'; sessionId: string; lastMessageId?: string }
  | { sdk: 'gemini'; sessionId: string; stateSnapshot?: Record<string, unknown> }
  | { sdk: 'mock'; scriptPosition: number }

/** Serialized agent execution state used by pause/resume/kill flows. */
export interface SerializedAgentState {
  agentId: string
  pluginName: string
  sessionId: string
  checkpoint: SdkCheckpoint
  briefSnapshot: AgentBrief
  conversationSummary?: string
  pendingDecisionIds: string[]
  lastSequence: number
  serializedAt: string
  serializedBy: 'pause' | 'kill_grace' | 'crash_recovery' | 'decision_checkpoint'
  estimatedSizeBytes: number
}

/** Kill call options for graceful or force termination. */
export interface KillRequest {
  grace: boolean
  graceTimeoutMs?: number
}

/** Kill result with cleanup metadata. */
export interface KillResponse {
  state?: SerializedAgentState
  artifactsExtracted: number
  cleanShutdown: boolean
}

/** Runtime handle used by backend layers to reference an active agent. */
export interface AgentHandle {
  id: string
  pluginName: string
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error'
  sessionId: string
  pendingBriefChanges?: Partial<AgentBrief>
}

/** Runtime sandbox descriptor owned by orchestration and gateway layers. */
export interface SandboxInfo {
  agentId: string
  transport: PluginTransport
  providerType: 'docker' | 'cloud_run' | 'vm' | 'local_process' | 'in_process'
  createdAt: string
  lastHeartbeatAt: string | null
  resourceUsage?: SandboxResourceUsage
}

/** Current infrastructure resource usage reported by sandbox health polling. */
export interface SandboxResourceUsage {
  cpuPercent: number
  memoryMb: number
  diskMb: number
  collectedAt: string
}

/** Health response shape exposed by adapter shim /health endpoint. */
export interface SandboxHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  agentStatus: AgentHandle['status']
  uptimeMs: number
  resourceUsage: SandboxResourceUsage
  pendingEventBufferSize: number
}

/** Adapter contract implemented by each provider plugin. */
export interface AgentPlugin {
  readonly name: string
  readonly version: string
  readonly capabilities: PluginCapabilities
  spawn(brief: AgentBrief): Promise<AgentHandle>
  pause(handle: AgentHandle): Promise<SerializedAgentState>
  resume(state: SerializedAgentState): Promise<AgentHandle>
  kill(handle: AgentHandle, options?: KillRequest): Promise<KillResponse>
  resolveDecision(handle: AgentHandle, decisionId: string, resolution: Resolution): Promise<void>
  injectContext(handle: AgentHandle, injection: ContextInjection): Promise<void>
  updateBrief(handle: AgentHandle, changes: Partial<AgentBrief>): Promise<void>
  /** Request a checkpoint snapshot without stopping the agent (used for decision-on-checkpoint). */
  requestCheckpoint(handle: AgentHandle, decisionId: string): Promise<SerializedAgentState>
}
