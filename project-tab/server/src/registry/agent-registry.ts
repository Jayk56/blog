import type { AgentHandle, SandboxInfo } from '../types'

/** Registered agent entry combining runtime handle and sandbox info. */
export interface RegisteredAgent {
  handle: AgentHandle
  sandbox: SandboxInfo
}

/**
 * AgentRegistry tracks all active agents and their sandbox info.
 * Provides lookup, registration, unregistration, and bulk operations.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>()

  /** Register a new agent with its handle and sandbox info. */
  register(handle: AgentHandle, sandbox: SandboxInfo): void {
    if (this.agents.has(handle.id)) {
      throw new Error(`Agent ${handle.id} is already registered`)
    }
    this.agents.set(handle.id, { handle, sandbox })
  }

  /** Unregister an agent by ID. Returns true if it existed. */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  /** Get a registered agent by ID, or undefined if not found. */
  getById(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId)
  }

  /** Get all registered agents. */
  getAll(): RegisteredAgent[] {
    return [...this.agents.values()]
  }

  /** Get count of registered agents. */
  get size(): number {
    return this.agents.size
  }

  /** Update the handle for a registered agent (e.g. status change). */
  updateHandle(agentId: string, handle: AgentHandle): void {
    const entry = this.agents.get(agentId)
    if (!entry) {
      throw new Error(`Agent ${agentId} is not registered`)
    }
    entry.handle = handle
  }

  /** Update the sandbox info for a registered agent (e.g. heartbeat). */
  updateSandbox(agentId: string, sandbox: Partial<SandboxInfo>): void {
    const entry = this.agents.get(agentId)
    if (!entry) {
      throw new Error(`Agent ${agentId} is not registered`)
    }
    entry.sandbox = { ...entry.sandbox, ...sandbox }
  }

  /**
   * Kill all agents. Returns all agent IDs that were registered.
   * Caller is responsible for actually issuing kill commands.
   */
  killAll(): string[] {
    const ids = [...this.agents.keys()]
    this.agents.clear()
    return ids
  }
}
