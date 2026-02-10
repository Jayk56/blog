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

/** HTTP error from the adapter shim. */
export class AdapterHttpError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(`Adapter shim returned ${statusCode} from ${endpoint}: ${body}`)
    this.name = 'AdapterHttpError'
  }
}

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
  private readonly rpcEndpoint: string
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: LocalHttpPluginOptions) {
    this.name = options.name
    this.version = options.version
    this.capabilities = options.capabilities
    this.rpcEndpoint = options.transport.rpcEndpoint
    this.fetchFn = options.fetchFn ?? globalThis.fetch
  }

  /** POST /spawn — initialize agent with brief, returns AgentHandle. */
  async spawn(brief: AgentBrief): Promise<AgentHandle> {
    return this.post<AgentHandle>('/spawn', brief)
  }

  /** POST /pause — pause agent, returns SerializedAgentState. */
  async pause(handle: AgentHandle): Promise<SerializedAgentState> {
    return this.post<SerializedAgentState>('/pause', handle)
  }

  /** POST /resume — resume agent from serialized state, returns AgentHandle. */
  async resume(state: SerializedAgentState): Promise<AgentHandle> {
    return this.post<AgentHandle>('/resume', state)
  }

  /** POST /kill — kill agent with options, returns KillResponse. */
  async kill(handle: AgentHandle, options?: KillRequest): Promise<KillResponse> {
    return this.post<KillResponse>('/kill', options ?? { grace: true })
  }

  /** POST /resolve — resolve a pending decision. */
  async resolveDecision(
    handle: AgentHandle,
    decisionId: string,
    resolution: Resolution
  ): Promise<void> {
    await this.post<void>('/resolve', { handle, decisionId, resolution })
  }

  /** POST /inject-context — inject context into a running agent. */
  async injectContext(
    _handle: AgentHandle,
    injection: ContextInjection
  ): Promise<void> {
    await this.post<void>('/inject-context', injection)
  }

  /** POST /update-brief — update agent brief mid-session. */
  async updateBrief(
    handle: AgentHandle,
    changes: Partial<AgentBrief>
  ): Promise<void> {
    await this.post<void>('/update-brief', { handle, changes })
  }

  /** POST /checkpoint — request a checkpoint snapshot without stopping the agent. */
  async requestCheckpoint(
    _handle: AgentHandle,
    decisionId: string
  ): Promise<SerializedAgentState> {
    return this.post<SerializedAgentState>('/checkpoint', { decisionId })
  }

  /** Make a POST request to the adapter shim. */
  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.rpcEndpoint}${endpoint}`

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new AdapterHttpError(endpoint, response.status, text)
    }

    // Some endpoints may return no body (204 or empty 200)
    const text = await response.text()
    if (!text) {
      return undefined as T
    }

    return JSON.parse(text) as T
  }
}
