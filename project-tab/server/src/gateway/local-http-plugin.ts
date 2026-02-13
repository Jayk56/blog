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
  LocalHttpTransport,
} from '../types'
import { AdapterHttpClient } from './adapter-http-client'
export { AdapterHttpError } from './adapter-http-client'

/** Options for creating a LocalHttpPlugin. */
export interface LocalHttpPluginOptions {
  name: string
  version: string
  capabilities: PluginCapabilities
  transport: LocalHttpTransport
  /** Fetch function — injectable for testing. */
  fetchFn?: typeof globalThis.fetch
}

/**
 * LocalHttpPlugin implements AgentPlugin by making HTTP calls
 * to an adapter shim running as a local child process.
 *
 * Commands flow as JSON-over-HTTP to the shim's RPC endpoints.
 * Events flow back over a separate WebSocket connection managed
 * by EventStreamClient (not this class).
 */
export class LocalHttpPlugin implements AgentPlugin {
  readonly name: string
  readonly version: string
  readonly capabilities: PluginCapabilities
  private readonly client: AdapterHttpClient

  constructor(options: LocalHttpPluginOptions) {
    this.name = options.name
    this.version = options.version
    this.capabilities = options.capabilities
    this.client = new AdapterHttpClient(
      options.transport.rpcEndpoint,
      options.fetchFn
    )
  }

  /** POST /spawn — initialize agent with brief, returns AgentHandle. */
  async spawn(brief: AgentBrief): Promise<AgentHandle> {
    return this.client.post<AgentHandle>('/spawn', brief)
  }

  /** POST /pause — pause agent, returns SerializedAgentState. */
  async pause(handle: AgentHandle): Promise<SerializedAgentState> {
    return this.client.post<SerializedAgentState>('/pause', handle)
  }

  /** POST /resume — resume agent from serialized state, returns AgentHandle. */
  async resume(state: SerializedAgentState): Promise<AgentHandle> {
    return this.client.post<AgentHandle>('/resume', state)
  }

  /** POST /kill — kill agent with options, returns KillResponse. */
  async kill(handle: AgentHandle, options?: KillRequest): Promise<KillResponse> {
    return this.client.post<KillResponse>('/kill', options ?? { grace: true })
  }

  /** POST /resolve — resolve a pending decision. */
  async resolveDecision(
    handle: AgentHandle,
    decisionId: string,
    resolution: Resolution
  ): Promise<void> {
    await this.client.post<void>('/resolve', { handle, decisionId, resolution })
  }

  /** POST /inject-context — inject context into a running agent. */
  async injectContext(
    _handle: AgentHandle,
    injection: ContextInjection
  ): Promise<void> {
    await this.client.post<void>('/inject-context', injection)
  }

  /** POST /update-brief — update agent brief mid-session. */
  async updateBrief(
    handle: AgentHandle,
    changes: Partial<AgentBrief>
  ): Promise<void> {
    await this.client.post<void>('/update-brief', { handle, changes })
  }

  /** POST /checkpoint — request a checkpoint snapshot without stopping the agent. */
  async requestCheckpoint(
    _handle: AgentHandle,
    decisionId: string
  ): Promise<SerializedAgentState> {
    return this.client.post<SerializedAgentState>('/checkpoint', { decisionId })
  }
}
