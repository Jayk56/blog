import { spawn, type ChildProcess } from 'node:child_process'
import type { LocalHttpTransport, SandboxBootstrap } from '../types'
import { pollHealth } from './port-pool'

const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_STARTUP_TIMEOUT_MS = 30_000

export interface SpawnResult {
  process: ChildProcess
  transport: LocalHttpTransport
  port: number
}

export interface SpawnShimOptions {
  command: string
  args: string[]
  env?: Record<string, string>
  bootstrap: SandboxBootstrap
  healthPollIntervalMs?: number
  healthStartupTimeoutMs?: number
}

export class ChildProcessManager {
  private readonly processes = new Map<string, ChildProcess>()
  private readonly exitListeners = new Map<string, Array<(code: number | null, signal: string | null) => void>>()
  private readonly fetchFn: typeof globalThis.fetch

  constructor(fetchFn?: typeof globalThis.fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  async spawnShim(agentId: string, options: SpawnShimOptions): Promise<SpawnResult> {
    const pollInterval = options.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS
    const startupTimeout = options.healthStartupTimeoutMs ?? HEALTH_STARTUP_TIMEOUT_MS

    const env = {
      ...process.env,
      ...options.env,
      AGENT_PORT: '0',
      AGENT_BOOTSTRAP: JSON.stringify(options.bootstrap),
    }

    const child = spawn(options.command, options.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    this.processes.set(agentId, child)

    // Set up exit listener tracking
    const listeners = this.exitListeners.get(agentId) ?? []
    this.exitListeners.set(agentId, listeners)

    child.on('exit', (code, signal) => {
      const currentListeners = this.exitListeners.get(agentId) ?? []
      for (const listener of currentListeners) {
        listener(code, signal)
      }
    })

    // Wait for port announcement from stdout
    const port = await this.waitForPortAnnouncement(agentId, child, startupTimeout)

    // Pipe stderr with agent ID prefix
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        console.log(`[agent:${agentId}:stderr] ${line}`)
      }
    })

    // Poll GET /health until ready or timeout
    try {
      await pollHealth(port, pollInterval, startupTimeout, this.fetchFn)
    } catch (err) {
      child.kill('SIGKILL')
      this.processes.delete(agentId)
      throw err
    }

    const transport: LocalHttpTransport = {
      type: 'local_http',
      rpcEndpoint: `http://localhost:${port}`,
      eventStreamEndpoint: `ws://localhost:${port}/events`,
    }

    return { process: child, transport, port }
  }

  private waitForPortAnnouncement(agentId: string, child: ChildProcess, timeoutMs: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let buffer = ''
      let resolved = false

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          child.kill('SIGKILL')
          this.processes.delete(agentId)
          reject(new Error(`Adapter shim for ${agentId} did not announce port within ${timeoutMs}ms`))
        }
      }, timeoutMs)

      const onExit = () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          reject(new Error(`Adapter shim for ${agentId} exited before announcing port`))
        }
      }
      child.on('exit', onExit)

      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (resolved) {
            // After port found, just log
            if (line.trim()) {
              console.log(`[agent:${agentId}:stdout] ${line}`)
            }
            continue
          }

          try {
            const parsed = JSON.parse(line)
            if (typeof parsed?.port === 'number') {
              resolved = true
              clearTimeout(timer)
              child.off('exit', onExit)
              resolve(parsed.port)
              continue
            }
          } catch {
            // Not JSON — log and continue
          }

          if (line.trim()) {
            console.log(`[agent:${agentId}:stdout] ${line}`)
          }
        }
      })
    })
  }

  onExit(agentId: string, listener: (code: number | null, signal: string | null) => void): void {
    const listeners = this.exitListeners.get(agentId) ?? []
    listeners.push(listener)
    this.exitListeners.set(agentId, listeners)
  }

  killProcess(agentId: string): void {
    const child = this.processes.get(agentId)
    if (child) {
      child.kill('SIGTERM')
      this.processes.delete(agentId)
    }
  }

  forceKillProcess(agentId: string): void {
    const child = this.processes.get(agentId)
    if (child) {
      child.kill('SIGKILL')
      this.processes.delete(agentId)
    }
  }

  cleanup(agentId: string): void {
    this.processes.delete(agentId)
    this.exitListeners.delete(agentId)
  }

  getProcess(agentId: string): ChildProcess | undefined {
    return this.processes.get(agentId)
  }
}
