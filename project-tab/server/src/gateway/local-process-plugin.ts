import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ContextInjection,
  KillRequest,
  KillResponse,
  LocalHttpTransport,
  PluginCapabilities,
  Resolution,
  SandboxBootstrap,
  SerializedAgentState,
} from '../types'
import { ChildProcessManager } from './child-process-manager'
import { LocalHttpPlugin } from './local-http-plugin'
import { EventStreamClient } from './event-stream-client'
import type { EventBus } from '../bus'

/** Per-agent record tracking the spawned shim, its RPC client, and event stream. */
interface AgentRecord {
  plugin: LocalHttpPlugin
  eventStream: EventStreamClient
  port: number
}

/** Options for creating a LocalProcessPlugin. */
export interface LocalProcessPluginOptions {
  name: string
  version?: string
  capabilities?: PluginCapabilities
  processManager: ChildProcessManager
  eventBus: EventBus
  /** Command to spawn the adapter shim (e.g. 'python'). */
  shimCommand: string
  /** Arguments for the command (e.g. ['-m', 'adapter_shim', '--mock']). */
  shimArgs: string[]
  /** Base URL of this backend (injected into sandbox bootstrap). */
  backendUrl: string
  /** Function to generate a backend token for a new agent sandbox. */
  generateToken: (agentId: string) => Promise<{ token: string; expiresAt: string }>
}

/**
 * LocalProcessPlugin implements AgentPlugin by spawning adapter shims
 * as local child processes via ChildProcessManager.
 *
 * On spawn(): allocates a port, spawns a shim process, creates a per-agent
 * LocalHttpPlugin for RPC, and connects an EventStreamClient for events.
 *
 * Pattern mirrors ContainerPlugin's per-agent record management.
 */
export class LocalProcessPlugin implements AgentPlugin {
  readonly name: string
  readonly version: string
  readonly capabilities: PluginCapabilities

  private readonly processManager: ChildProcessManager
  private readonly eventBus: EventBus
  private readonly shimCommand: string
  private readonly shimArgs: string[]
  private readonly backendUrl: string
  private readonly generateToken: LocalProcessPluginOptions['generateToken']
  private readonly agents = new Map<string, AgentRecord>()

  constructor(options: LocalProcessPluginOptions) {
    this.name = options.name
    this.version = options.version ?? '1.0.0'
    this.capabilities = options.capabilities ?? {
      supportsPause: true,
      supportsResume: true,
      supportsKill: true,
      supportsHotBriefUpdate: true,
    }
    this.processManager = options.processManager
    this.eventBus = options.eventBus
    this.shimCommand = options.shimCommand
    this.shimArgs = options.shimArgs
    this.backendUrl = options.backendUrl
    this.generateToken = options.generateToken
  }

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

    const result = await this.processManager.spawnShim(agentId, {
      command: this.shimCommand,
      args: this.shimArgs,
      bootstrap,
    })

    // Create a per-agent LocalHttpPlugin for RPC
    const plugin = new LocalHttpPlugin({
      name: `${this.name}:${agentId}`,
      version: this.version,
      capabilities: this.capabilities,
      transport: result.transport,
    })

    // Connect an EventStreamClient for the agent's event stream
    const eventStream = new EventStreamClient({
      url: result.transport.eventStreamEndpoint,
      agentId,
      eventBus: this.eventBus,
    })
    eventStream.connect()

    this.agents.set(agentId, { plugin, eventStream, port: result.port })

    // Delegate the spawn RPC call to the per-agent plugin
    try {
      return await plugin.spawn(brief)
    } catch (err) {
      // Clean up the spawned process if the RPC spawn call fails
      eventStream.close()
      this.processManager.killProcess(agentId)
      this.processManager.cleanup(agentId, result.port)
      this.agents.delete(agentId)
      throw err
    }
  }

  async pause(handle: AgentHandle): Promise<SerializedAgentState> {
    return this.getRecord(handle.id).plugin.pause(handle)
  }

  async resume(state: SerializedAgentState): Promise<AgentHandle> {
    return this.getRecord(state.agentId).plugin.resume(state)
  }

  async kill(handle: AgentHandle, options?: KillRequest): Promise<KillResponse> {
    const record = this.getRecord(handle.id)

    let response: KillResponse
    try {
      response = await record.plugin.kill(handle, options)
    } catch {
      response = { artifactsExtracted: 0, cleanShutdown: false }
    }

    // Disconnect event stream and clean up
    record.eventStream.close()
    this.processManager.killProcess(handle.id)
    this.processManager.cleanup(handle.id, record.port)
    this.agents.delete(handle.id)

    return response
  }

  async resolveDecision(handle: AgentHandle, decisionId: string, resolution: Resolution): Promise<void> {
    return this.getRecord(handle.id).plugin.resolveDecision(handle, decisionId, resolution)
  }

  async injectContext(handle: AgentHandle, injection: ContextInjection): Promise<void> {
    return this.getRecord(handle.id).plugin.injectContext(handle, injection)
  }

  async updateBrief(handle: AgentHandle, changes: Partial<AgentBrief>): Promise<void> {
    return this.getRecord(handle.id).plugin.updateBrief(handle, changes)
  }

  async requestCheckpoint(handle: AgentHandle, decisionId: string): Promise<SerializedAgentState> {
    return this.getRecord(handle.id).plugin.requestCheckpoint(handle, decisionId)
  }

  /** Get the transport for an active agent (used by gateway for WS connection). */
  getTransport(agentId: string): LocalHttpTransport | undefined {
    const record = this.agents.get(agentId)
    if (!record) return undefined
    return {
      type: 'local_http',
      rpcEndpoint: `http://localhost:${record.port}`,
      eventStreamEndpoint: `ws://localhost:${record.port}/events`,
    } as unknown as LocalHttpTransport
  }

  /** Kill all agents managed by this plugin. */
  async killAll(): Promise<void> {
    const ids = Array.from(this.agents.keys())
    for (const id of ids) {
      const record = this.agents.get(id)
      if (record) {
        record.eventStream.close()
        this.processManager.killProcess(id)
        this.processManager.cleanup(id, record.port)
        this.agents.delete(id)
      }
    }
  }

  private getRecord(agentId: string): AgentRecord {
    const record = this.agents.get(agentId)
    if (!record) {
      throw new Error(`No agent process found for ${agentId}`)
    }
    return record
  }
}
