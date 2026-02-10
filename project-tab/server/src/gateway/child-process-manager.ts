import { spawn, type ChildProcess } from 'node:child_process'
import type { LocalHttpTransport, SandboxBootstrap } from '../types'

/** Port allocation range for local adapter shims. */
const PORT_MIN = 9100
const PORT_MAX = 9199

/** Health poll configuration. */
const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_STARTUP_TIMEOUT_MS = 30_000

/** Result of spawning a child process shim. */
export interface SpawnResult {
  process: ChildProcess
  transport: LocalHttpTransport
  port: number
}

/** Options for spawning a child process shim. */
export interface SpawnShimOptions {
  /** Command to spawn the adapter shim (e.g. 'python', 'node'). */
  command: string
  /** Arguments for the command (e.g. ['adapter.py']). */
  args: string[]
  /** Environment variables to set on the child process. */
  env?: Record<string, string>
  /** Bootstrap config to write to a temp file for the shim. */
  bootstrap: SandboxBootstrap
  /** Custom health poll interval in ms (for testing). */
  healthPollIntervalMs?: number
  /** Custom startup timeout in ms (for testing). */
  healthStartupTimeoutMs?: number
}

/**
 * ChildProcessManager manages spawning adapter shim child processes,
 * allocating ports, and polling for readiness.
 */
export class ChildProcessManager {
  private readonly allocatedPorts = new Set<number>()
  private readonly processes = new Map<string, ChildProcess>()
  private readonly exitListeners = new Map<string, Array<(code: number | null, signal: string | null) => void>>()
  /** Fetch function — injectable for testing. */
  private readonly fetchFn: typeof globalThis.fetch

  constructor(fetchFn?: typeof globalThis.fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  /** Allocate an unused port from the 9100-9199 pool. */
  allocatePort(): number {
    for (let port = PORT_MIN; port <= PORT_MAX; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port)
        return port
      }
    }
    throw new Error(`No ports available in range ${PORT_MIN}-${PORT_MAX}`)
  }

  /** Release a port back to the pool. */
  releasePort(port: number): void {
    this.allocatedPorts.delete(port)
  }

  /**
   * Spawn an adapter shim as a child process.
   * Allocates a port, spawns the process, and polls GET /health until ready.
   * Returns the ChildProcess and LocalHttpTransport once the shim is healthy.
   */
  async spawnShim(agentId: string, options: SpawnShimOptions): Promise<SpawnResult> {
    const port = this.allocatePort()
    const pollInterval = options.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS
    const startupTimeout = options.healthStartupTimeoutMs ?? HEALTH_STARTUP_TIMEOUT_MS

    const env = {
      ...process.env,
      ...options.env,
      AGENT_PORT: String(port),
      AGENT_BOOTSTRAP: JSON.stringify(options.bootstrap),
    }

    const child = spawn(options.command, options.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    // Track the process
    this.processes.set(agentId, child)

    // Pipe stdout/stderr with agent ID prefix
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        // eslint-disable-next-line no-console
        console.log(`[agent:${agentId}:stdout] ${line}`)
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        // eslint-disable-next-line no-console
        console.error(`[agent:${agentId}:stderr] ${line}`)
      }
    })

    // Set up exit listener tracking
    const listeners = this.exitListeners.get(agentId) ?? []
    this.exitListeners.set(agentId, listeners)

    child.on('exit', (code, signal) => {
      const currentListeners = this.exitListeners.get(agentId) ?? []
      for (const listener of currentListeners) {
        listener(code, signal)
      }
    })

    // Poll GET /health until ready or timeout
    try {
      await this.pollHealth(port, pollInterval, startupTimeout)
    } catch (err) {
      // Cleanup on failure
      child.kill('SIGKILL')
      this.processes.delete(agentId)
      this.releasePort(port)
      throw err
    }

    const transport: LocalHttpTransport = {
      type: 'local_http',
      rpcEndpoint: `http://localhost:${port}`,
      eventStreamEndpoint: `ws://localhost:${port}/events`,
    }

    return { process: child, transport, port }
  }

  /** Register a callback for when a child process exits. */
  onExit(agentId: string, listener: (code: number | null, signal: string | null) => void): void {
    const listeners = this.exitListeners.get(agentId) ?? []
    listeners.push(listener)
    this.exitListeners.set(agentId, listeners)
  }

  /** Kill a child process by agent ID. */
  killProcess(agentId: string): void {
    const child = this.processes.get(agentId)
    if (child) {
      child.kill('SIGTERM')
      this.processes.delete(agentId)
    }
  }

  /** Force-kill a child process (SIGKILL). */
  forceKillProcess(agentId: string): void {
    const child = this.processes.get(agentId)
    if (child) {
      child.kill('SIGKILL')
      this.processes.delete(agentId)
    }
  }

  /** Cleanup: remove the process from tracking and release its port. */
  cleanup(agentId: string, port: number): void {
    this.processes.delete(agentId)
    this.exitListeners.delete(agentId)
    this.releasePort(port)
  }

  /** Get the child process for a given agent. */
  getProcess(agentId: string): ChildProcess | undefined {
    return this.processes.get(agentId)
  }

  /** Poll GET /health on the given port until a successful response or timeout. */
  private async pollHealth(
    port: number,
    intervalMs: number,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const url = `http://localhost:${port}/health`

    while (Date.now() < deadline) {
      try {
        const response = await this.fetchFn(url, {
          signal: AbortSignal.timeout(intervalMs),
        })
        if (response.ok) {
          return
        }
      } catch {
        // Connection refused, timeout, etc. — keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(
      `Adapter shim on port ${port} did not become healthy within ${timeoutMs}ms`
    )
  }
}
