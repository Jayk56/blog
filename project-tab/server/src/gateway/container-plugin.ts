import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ContextInjection,
  ContainerTransport,
  KillRequest,
  KillResponse,
  PluginCapabilities,
  Resolution,
  SandboxBootstrap,
  SerializedAgentState,
} from '../types'
import {
  ContainerOrchestrator,
  type ContainerCreateResult,
} from './container-orchestrator'
import { AdapterHttpClient, AdapterHttpError } from './adapter-http-client'
import type { MCPProvisioner } from './mcp-provisioner'

/** Tracked container info per agent. */
interface ContainerRecord {
  result: ContainerCreateResult
  transport: ContainerTransport
  client: AdapterHttpClient
}

/** Options for creating a ContainerPlugin. */
export interface ContainerPluginOptions {
  name: string
  version: string
  capabilities: PluginCapabilities
  orchestrator: ContainerOrchestrator
  /** Docker image to use for agent sandboxes. */
  image: string
  /** Base URL of this backend (injected into sandbox bootstrap). */
  backendUrl: string
  /** Function to generate a backend token for a new agent sandbox. */
  generateToken: (agentId: string) => Promise<{ token: string; expiresAt: string }>
  /** Fetch function -- injectable for testing. */
  fetchFn?: typeof globalThis.fetch
  /** Optional MCP server provisioner for configuring sandbox-local MCP servers. */
  mcpProvisioner?: MCPProvisioner
}

/**
 * ContainerPlugin implements AgentPlugin by running adapter shims
 * inside Docker containers via ContainerOrchestrator.
 *
 * Commands flow as JSON-over-HTTP to the container's RPC endpoints.
 * Events flow back over a separate WebSocket connection managed
 * by EventStreamClient (not this class).
 */
export class ContainerPlugin implements AgentPlugin {
  readonly name: string
  readonly version: string
  readonly capabilities: PluginCapabilities
  private readonly orchestrator: ContainerOrchestrator
  private readonly image: string
  private readonly backendUrl: string
  private readonly generateToken: ContainerPluginOptions['generateToken']
  private readonly clientFactory: (rpcEndpoint: string) => AdapterHttpClient
  private readonly mcpProvisioner: MCPProvisioner | null
  private readonly agents = new Map<string, ContainerRecord>()

  constructor(options: ContainerPluginOptions) {
    this.name = options.name
    this.version = options.version
    this.capabilities = options.capabilities
    this.orchestrator = options.orchestrator
    this.image = options.image
    this.backendUrl = options.backendUrl
    this.generateToken = options.generateToken
    const fetchFn = options.fetchFn ?? globalThis.fetch
    this.clientFactory = (rpcEndpoint: string) =>
      new AdapterHttpClient(rpcEndpoint, fetchFn)
    this.mcpProvisioner = options.mcpProvisioner ?? null
  }

  /** Provision a container, then POST /spawn with the brief. */
  async spawn(brief: AgentBrief): Promise<AgentHandle> {
    const agentId = brief.agentId
    const { token, expiresAt } = await this.generateToken(agentId)

    const bootstrap: SandboxBootstrap = {
      backendUrl: this.backendUrl,
      backendToken: token,
      tokenExpiresAt: expiresAt,
      agentId,
      artifactUploadEndpoint: `${this.backendUrl}/api/artifacts`,
    }

    // Provision MCP servers and inject config as env vars
    const env: Record<string, string> = {}
    if (this.mcpProvisioner) {
      const mounts = brief.workspaceRequirements?.mounts ?? []
      const mcpResult = this.mcpProvisioner.provision(
        brief.mcpServers,
        brief.allowedTools,
        mounts,
        token
      )
      env[mcpResult.envKey] = mcpResult.envValue
    }

    const result = await this.orchestrator.createSandbox(agentId, {
      image: brief.workspaceRequirements?.baseImage ?? this.image,
      bootstrap,
      workspaceRequirements: brief.workspaceRequirements,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    const record: ContainerRecord = {
      result,
      transport: result.transport,
      client: this.clientFactory(result.transport.rpcEndpoint),
    }
    this.agents.set(agentId, record)

    // POST /spawn to the container's adapter shim
    return record.client.post<AgentHandle>('/spawn', brief)
  }

  /** POST /pause to the container's adapter shim. */
  async pause(handle: AgentHandle): Promise<SerializedAgentState> {
    const record = this.getRecord(handle.id)
    return record.client.post<SerializedAgentState>('/pause', handle)
  }

  /** POST /resume to the container's adapter shim. */
  async resume(state: SerializedAgentState): Promise<AgentHandle> {
    const record = this.getRecord(state.agentId)
    return record.client.post<AgentHandle>('/resume', state)
  }

  /** POST /kill to the container, then destroy the container. */
  async kill(
    handle: AgentHandle,
    options?: KillRequest
  ): Promise<KillResponse> {
    const record = this.getRecord(handle.id)

    let response: KillResponse
    try {
      response = await record.client.post<KillResponse>(
        '/kill',
        options ?? { grace: true }
      )
    } catch (error) {
      if (error instanceof AdapterHttpError) {
        // Shim is reachable but returned an HTTP error: treat as unclean shutdown.
      }
      // If the shim is already dead, synthesize a response
      response = { artifactsExtracted: 0, cleanShutdown: false }
    }

    // Tear down the container
    await this.orchestrator.cleanup(handle.id, record.result.port)
    this.agents.delete(handle.id)

    return response
  }

  /** POST /resolve to the container. */
  async resolveDecision(
    handle: AgentHandle,
    decisionId: string,
    resolution: Resolution
  ): Promise<void> {
    const record = this.getRecord(handle.id)
    await record.client.post<void>('/resolve', {
      handle,
      decisionId,
      resolution,
    })
  }

  /** POST /inject-context to the container. */
  async injectContext(
    _handle: AgentHandle,
    injection: ContextInjection
  ): Promise<void> {
    const record = this.getRecord(_handle.id)
    await record.client.post<void>('/inject-context', injection)
  }

  /** POST /update-brief to the container. */
  async updateBrief(
    handle: AgentHandle,
    changes: Partial<AgentBrief>
  ): Promise<void> {
    const record = this.getRecord(handle.id)
    await record.client.post<void>('/update-brief', {
      handle,
      changes,
    })
  }

  /** POST /checkpoint to the container to request a checkpoint snapshot. */
  async requestCheckpoint(
    handle: AgentHandle,
    decisionId: string
  ): Promise<SerializedAgentState> {
    const record = this.getRecord(handle.id)
    return record.client.post<SerializedAgentState>('/checkpoint', {
      handle,
      decisionId,
    })
  }

  /** Get the transport for an active agent (used by gateway for WS connection). */
  getTransport(agentId: string): ContainerTransport | undefined {
    return this.agents.get(agentId)?.transport
  }

  /** Register a container exit listener for crash detection. */
  onContainerExit(
    agentId: string,
    listener: (exitCode: number) => void
  ): void {
    this.orchestrator.onExit(agentId, listener)
  }

  private getRecord(agentId: string): ContainerRecord {
    const record = this.agents.get(agentId)
    if (!record) {
      throw new Error(`No container found for agent ${agentId}`)
    }
    return record
  }
}
