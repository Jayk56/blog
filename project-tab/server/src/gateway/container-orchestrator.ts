import Docker from 'dockerode'
import type { ContainerTransport, SandboxBootstrap } from '../types'
import type { WorkspaceRequirements, WorkspaceMount } from '../types/brief'
import { pollHealth, PortPool } from './port-pool'

/** Health poll configuration. */
const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_STARTUP_TIMEOUT_MS = 30_000

/** Default container internal port the adapter shim listens on. */
const CONTAINER_INTERNAL_PORT = 8080

/** Default resource limits applied when WorkspaceRequirements omits them. */
const DEFAULT_MEMORY_MB = 512
const DEFAULT_CPU_CORES = 1

/** Result of creating a container sandbox. */
export interface ContainerCreateResult {
  containerId: string
  transport: ContainerTransport
  port: number
}

/** Options for creating a container sandbox. */
export interface ContainerCreateOptions {
  /** Docker image to use (e.g. 'project-tab/adapter-openai:latest'). */
  image: string
  /** Bootstrap config injected as an environment variable. */
  bootstrap: SandboxBootstrap
  /** Workspace requirements from the agent brief. */
  workspaceRequirements?: WorkspaceRequirements
  /** Extra environment variables. */
  env?: Record<string, string>
  /** Custom health poll interval in ms (for testing). */
  healthPollIntervalMs?: number
  /** Custom startup timeout in ms (for testing). */
  healthStartupTimeoutMs?: number
}

/**
 * ContainerOrchestrator manages Docker containers for agent sandboxes.
 * Mirrors the ChildProcessManager pattern but uses Docker containers
 * instead of local child processes.
 */
export class ContainerOrchestrator {
  private readonly portPool = new PortPool(9200, 9299)
  private readonly containers = new Map<string, string>() // agentId -> containerId
  private readonly exitListeners = new Map<
    string,
    Array<(exitCode: number) => void>
  >()
  private readonly docker: Docker
  /** Fetch function -- injectable for testing. */
  private readonly fetchFn: typeof globalThis.fetch

  constructor(docker?: Docker, fetchFn?: typeof globalThis.fetch) {
    this.docker = docker ?? new Docker()
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  /** Allocate an unused port from the 9200-9299 pool. */
  allocatePort(): number {
    return this.portPool.allocate()
  }

  /** Release a port back to the pool. */
  releasePort(port: number): void {
    this.portPool.release(port)
  }

  /**
   * Create and start a Docker container for an agent sandbox.
   * Allocates a host port, creates the container with appropriate config,
   * starts it, and polls /health until ready.
   */
  async createSandbox(
    agentId: string,
    options: ContainerCreateOptions
  ): Promise<ContainerCreateResult> {
    const port = this.allocatePort()
    const pollInterval =
      options.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS
    const startupTimeout =
      options.healthStartupTimeoutMs ?? HEALTH_STARTUP_TIMEOUT_MS

    const env = this.buildEnv(options)
    const binds = this.buildBinds(agentId, options.workspaceRequirements)
    const hostConfig = this.buildHostConfig(
      port,
      binds,
      options.workspaceRequirements
    )

    let container: Docker.Container
    try {
      container = await this.docker.createContainer({
        Image: options.image,
        Env: env,
        ExposedPorts: { [`${CONTAINER_INTERNAL_PORT}/tcp`]: {} },
        HostConfig: hostConfig,
        Labels: {
          'project-tab.agent-id': agentId,
          'project-tab.managed': 'true',
        },
      })

      await container.start()
    } catch (err) {
      this.releasePort(port)
      throw err
    }

    const containerId = container.id
    this.containers.set(agentId, containerId)

    // Set up exit listener tracking
    const listeners = this.exitListeners.get(agentId) ?? []
    this.exitListeners.set(agentId, listeners)

    // Monitor container for exit events
    this.monitorContainer(agentId, container)

    // Poll /health until ready
    try {
      await pollHealth(port, pollInterval, startupTimeout, this.fetchFn)
    } catch (err) {
      // Cleanup on health timeout
      try {
        await container.stop({ t: 0 })
        await container.remove({ force: true })
      } catch {
        // Best effort cleanup
      }
      this.containers.delete(agentId)
      this.exitListeners.delete(agentId)
      this.releasePort(port)
      throw err
    }

    const sandboxId = `sandbox-${agentId}-${containerId.slice(0, 12)}`
    const transport: ContainerTransport = {
      type: 'container',
      sandboxId,
      rpcEndpoint: `http://localhost:${port}`,
      eventStreamEndpoint: `ws://localhost:${port}/events`,
      healthEndpoint: `http://localhost:${port}/health`,
    }

    return { containerId, transport, port }
  }

  /** Register a callback for when a container exits. */
  onExit(
    agentId: string,
    listener: (exitCode: number) => void
  ): void {
    const listeners = this.exitListeners.get(agentId) ?? []
    listeners.push(listener)
    this.exitListeners.set(agentId, listeners)
  }

  /** Gracefully stop a container (SIGTERM, then force after timeout). */
  async stopContainer(agentId: string, timeoutSeconds = 10): Promise<void> {
    const containerId = this.containers.get(agentId)
    if (!containerId) return

    const container = this.docker.getContainer(containerId)
    try {
      await container.stop({ t: timeoutSeconds })
    } catch {
      // Container may already be stopped
    }
  }

  /** Force-kill a container (SIGKILL). */
  async killContainer(agentId: string): Promise<void> {
    const containerId = this.containers.get(agentId)
    if (!containerId) return

    const container = this.docker.getContainer(containerId)
    try {
      await container.kill()
    } catch {
      // Container may already be stopped
    }
  }

  /** Remove a container and release its resources. */
  async destroyContainer(agentId: string): Promise<void> {
    const containerId = this.containers.get(agentId)
    if (!containerId) return

    const container = this.docker.getContainer(containerId)
    try {
      await container.remove({ force: true })
    } catch {
      // Container may already be removed
    }
    this.containers.delete(agentId)
    this.exitListeners.delete(agentId)
  }

  /** Full lifecycle cleanup: stop, remove, release port. */
  async cleanup(agentId: string, port: number): Promise<void> {
    await this.destroyContainer(agentId)
    this.releasePort(port)
  }

  /** Get the container ID for a given agent. */
  getContainerId(agentId: string): string | undefined {
    return this.containers.get(agentId)
  }

  /** Build environment variables array for Docker container. */
  private buildEnv(options: ContainerCreateOptions): string[] {
    const env: string[] = [
      `AGENT_BOOTSTRAP=${JSON.stringify(options.bootstrap)}`,
      `AGENT_PORT=${CONTAINER_INTERNAL_PORT}`,
    ]

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        env.push(`${key}=${value}`)
      }
    }

    return env
  }

  /** Build bind mounts from WorkspaceRequirements. */
  private buildBinds(
    agentId: string,
    requirements?: WorkspaceRequirements
  ): string[] {
    const binds: string[] = []

    // Always mount a persistent workspace volume
    binds.push(`project-tab-workspace-${agentId}:/workspace`)

    if (requirements?.mounts) {
      for (const mount of requirements.mounts) {
        const mode = mount.readOnly ? 'ro' : 'rw'
        binds.push(`${mount.hostPath}:${mount.sandboxPath}:${mode}`)
      }
    }

    return binds
  }

  /** Build Docker HostConfig from workspace requirements. */
  private buildHostConfig(
    port: number,
    binds: string[],
    requirements?: WorkspaceRequirements
  ): Docker.HostConfig {
    const memoryMb =
      requirements?.resourceLimits?.memoryMb ?? DEFAULT_MEMORY_MB
    const cpuCores =
      requirements?.resourceLimits?.cpuCores ?? DEFAULT_CPU_CORES

    return {
      PortBindings: {
        [`${CONTAINER_INTERNAL_PORT}/tcp`]: [
          { HostPort: String(port) },
        ],
      },
      Binds: binds,
      Memory: memoryMb * 1024 * 1024,
      NanoCpus: cpuCores * 1e9,
      AutoRemove: false,
    }
  }

  /** Monitor a container for exit events and notify listeners. */
  private monitorContainer(
    agentId: string,
    container: Docker.Container
  ): void {
    container
      .wait()
      .then((data: { StatusCode: number }) => {
        const listeners = this.exitListeners.get(agentId) ?? []
        for (const listener of listeners) {
          listener(data.StatusCode)
        }
      })
      .catch(() => {
        // Container was removed before exiting naturally
      })
  }

}
