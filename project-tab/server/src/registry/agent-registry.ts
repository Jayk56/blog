import type { AgentHandle } from '../types'
import type { AgentRegistry as AgentRegistryInterface } from '../types/service-interfaces'

/**
 * AgentRegistry tracks all active agent handles in memory.
 */
export class AgentRegistry implements AgentRegistryInterface {
  private readonly agents = new Map<string, AgentHandle>()

  /** Register a new agent handle. */
  registerHandle(handle: AgentHandle): void {
    if (this.agents.has(handle.id)) {
      throw new Error(`Agent ${handle.id} is already registered`)
    }
    this.agents.set(handle.id, handle)
  }

  /** Remove an agent by ID. */
  removeHandle(agentId: string): void {
    this.agents.delete(agentId)
  }

  /** Get a registered agent handle by ID, or null if not found. */
  getHandle(agentId: string): AgentHandle | null {
    return this.agents.get(agentId) ?? null
  }

  /** List registered agent handles with optional filtering. */
  listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[] {
    const all = [...this.agents.values()]
    if (!filter) {
      return all
    }
    return all.filter((handle) => {
      if (filter.status && handle.status !== filter.status) return false
      if (filter.pluginName && handle.pluginName !== filter.pluginName) return false
      return true
    })
  }

  /** Get count of registered agents. */
  get size(): number {
    return this.agents.size
  }

  /** Update selected fields for a registered agent handle. */
  updateHandle(agentId: string, updates: Partial<AgentHandle>): void {
    const existing = this.agents.get(agentId)
    if (!existing) return
    this.agents.set(agentId, { ...existing, ...updates, id: agentId })
  }
}
