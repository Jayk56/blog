import type { TickService } from '../tick'
import type { EventBus, EventBusHandler } from '../bus'
import type {
  AgentBrief,
  AgentHandle,
  AgentPlugin,
  ContextInjection,
  ContextInjectionPolicy,
  ContextReactiveTrigger,
  EventEnvelope,
  KnowledgeSnapshot,
} from '../types'
import type { ControlMode, Severity } from '../types/events'
import type { AgentRegistry, AgentGateway, KnowledgeStore, ControlModeManager } from '../types/service-interfaces'

/**
 * Per-agent injection tracking state.
 */
interface AgentInjectionState {
  /** The brief this agent was spawned with (or last updated). */
  brief: AgentBrief
  /** Tick at which the last injection was delivered. */
  lastInjectionTick: number
  /** The snapshot version included in the last injection. */
  lastSnapshotVersion: number
  /** Count of events in readable workstreams since last injection. */
  stalenessCounter: number
  /** Timestamps of injections within the current hour window (for rate limiting). */
  injectionTimestamps: number[]
  /** Whether at least one injection has been delivered. */
  hasEverInjected: boolean
}

/**
 * Default ContextInjectionPolicy per control mode, matching the design doc table.
 */
const DEFAULT_POLICIES: Record<ControlMode, ContextInjectionPolicy> = {
  orchestrator: {
    periodicIntervalTicks: 10,
    reactiveEvents: [
      { on: 'artifact_approved', workstreams: 'readable' },
      { on: 'decision_resolved', workstreams: 'readable' },
      { on: 'coherence_issue', severity: 'high' },
    ],
    stalenessThreshold: 5,
    maxInjectionsPerHour: 12,
    cooldownTicks: 5,
  },
  adaptive: {
    periodicIntervalTicks: 20,
    reactiveEvents: [
      { on: 'artifact_approved', workstreams: 'readable' },
      { on: 'decision_resolved', workstreams: 'readable' },
    ],
    stalenessThreshold: 10,
    maxInjectionsPerHour: 12,
    cooldownTicks: 5,
  },
  ecosystem: {
    periodicIntervalTicks: 50,
    reactiveEvents: [
      { on: 'coherence_issue', severity: 'critical' },
    ],
    stalenessThreshold: 20,
    maxInjectionsPerHour: 12,
    cooldownTicks: 5,
  },
}

/** Severity ordering for >= comparison in coherence_issue triggers. */
const SEVERITY_ORDER: Record<Severity, number> = {
  warning: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

/**
 * ContextInjectionService evaluates injection policies for each active agent
 * and pushes updated KnowledgeSnapshots or deltas via the adapter plugin.
 *
 * Three independent triggers:
 * 1. Periodic — every N ticks, full snapshot refresh
 * 2. Reactive — on specific event bus events, incremental delta
 * 3. Staleness — when event count in readable workstreams exceeds threshold
 *
 * Budget controls: cooldownTicks, maxInjectionsPerHour, contextBudgetTokens.
 */
export class ContextInjectionService {
  private readonly agents = new Map<string, AgentInjectionState>()
  private tickHandler: ((tick: number) => void) | null = null
  private busSubscriptionId: string | null = null

  constructor(
    private readonly tickService: TickService,
    private readonly eventBus: EventBus,
    private readonly knowledgeStore: KnowledgeStore,
    private readonly registry: AgentRegistry,
    private readonly gateway: AgentGateway,
    private readonly controlMode: ControlModeManager,
  ) {}

  /** Subscribe to tick service and event bus. */
  start(): void {
    this.tickHandler = (tick: number) => this.onTick(tick)
    this.tickService.onTick(this.tickHandler)

    this.busSubscriptionId = this.eventBus.subscribe({}, (envelope) => {
      this.onEvent(envelope)
    })
  }

  /** Unsubscribe from tick service and event bus. */
  stop(): void {
    if (this.tickHandler) {
      this.tickService.removeOnTick(this.tickHandler)
      this.tickHandler = null
    }
    if (this.busSubscriptionId) {
      this.eventBus.unsubscribe(this.busSubscriptionId)
      this.busSubscriptionId = null
    }
  }

  /** Register an agent for context injection tracking. */
  registerAgent(brief: AgentBrief): void {
    this.agents.set(brief.agentId, {
      brief,
      lastInjectionTick: this.tickService.currentTick(),
      lastSnapshotVersion: -1,
      stalenessCounter: 0,
      injectionTimestamps: [],
      hasEverInjected: false,
    })
  }

  /** Update the stored brief for an agent (e.g., after updateBrief). */
  updateAgentBrief(agentId: string, changes: Partial<AgentBrief>): void {
    const state = this.agents.get(agentId)
    if (state) {
      state.brief = { ...state.brief, ...changes }
    }
  }

  /** Remove an agent from injection tracking. */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId)
  }

  /** Get the injection state for an agent (for testing/inspection). */
  getAgentState(agentId: string): Readonly<AgentInjectionState> | undefined {
    return this.agents.get(agentId)
  }

  /** Get the effective policy for an agent. */
  getEffectivePolicy(agentId: string): ContextInjectionPolicy {
    const state = this.agents.get(agentId)
    if (state?.brief.contextInjectionPolicy) {
      return state.brief.contextInjectionPolicy
    }
    return DEFAULT_POLICIES[this.controlMode.getMode()]
  }

  /** Get default policy for a given control mode. */
  static getDefaultPolicy(mode: ControlMode): ContextInjectionPolicy {
    return { ...DEFAULT_POLICIES[mode] }
  }

  // ── Tick handler ────────────────────────────────────────────────

  private onTick(tick: number): void {
    for (const [agentId, state] of this.agents) {
      const policy = this.getEffectivePolicy(agentId)

      // Check periodic injection
      if (policy.periodicIntervalTicks !== null) {
        const ticksSinceLastInjection = tick - state.lastInjectionTick
        if (ticksSinceLastInjection >= policy.periodicIntervalTicks) {
          this.scheduleInjection(agentId, 'periodic', 'recommended')
        }
      }

      // Check staleness threshold
      if (policy.stalenessThreshold !== null) {
        if (state.stalenessCounter >= policy.stalenessThreshold) {
          this.scheduleInjection(agentId, 'staleness', 'recommended')
        }
      }
    }
  }

  // ── Event bus handler ───────────────────────────────────────────

  private onEvent(envelope: EventEnvelope): void {
    const event = envelope.event
    const sourceAgentId = event.agentId

    // For each tracked agent, check if this event is in their readable
    // workstreams, and if so, bump staleness and check reactive triggers.
    for (const [agentId, state] of this.agents) {
      // Skip events from the agent itself (they already know about their own events)
      if (agentId === sourceAgentId) continue

      const eventWorkstream = this.getEventWorkstream(envelope)
      if (!eventWorkstream) continue

      const isReadable = this.isWorkstreamReadable(state.brief, eventWorkstream)
      if (!isReadable) continue

      // Bump staleness counter for this agent
      state.stalenessCounter += 1

      // Check reactive triggers
      const policy = this.getEffectivePolicy(agentId)
      if (this.matchesReactiveTrigger(envelope, policy.reactiveEvents, state.brief)) {
        this.scheduleInjection(agentId, 'reactive', 'recommended')
      }
    }

    // Special case: brief_updated fires for the agent whose brief changed
    if (event.type === 'lifecycle' && event.action === 'session_start') {
      // Not a brief update trigger — handled by registerAgent
    }
  }

  // ── Injection scheduling ────────────────────────────────────────

  /**
   * Schedule and execute an injection for an agent.
   * Applies cooldown, rate limiting, version deduplication, and budget checks.
   */
  async scheduleInjection(
    agentId: string,
    reason: 'periodic' | 'reactive' | 'staleness' | 'brief_updated',
    priority: ContextInjection['priority'],
  ): Promise<boolean> {
    const state = this.agents.get(agentId)
    if (!state) return false

    const handle = this.registry.getHandle(agentId)
    if (!handle || handle.status !== 'running') return false

    const policy = this.getEffectivePolicy(agentId)
    const currentTick = this.tickService.currentTick()

    // Cooldown check (required priority and first-ever injection bypass)
    if (priority !== 'required' && state.hasEverInjected) {
      const ticksSinceLast = currentTick - state.lastInjectionTick
      if (ticksSinceLast < policy.cooldownTicks) {
        return false
      }
    }

    // Rate limit check
    const now = Date.now()
    this.pruneOldTimestamps(state, now)
    if (state.injectionTimestamps.length >= policy.maxInjectionsPerHour) {
      // Only required priority punches through the rate limit
      if (priority === 'required') {
        // Drop supplementary/recommended from the record to make room
      } else {
        return false
      }
    }

    // Get snapshot
    const snapshot = await this.knowledgeStore.getSnapshot()

    // Version deduplication
    if (snapshot.version === state.lastSnapshotVersion && snapshot.version !== -1) {
      return false
    }

    // Budget check
    const budgetTokens = state.brief.sessionPolicy?.contextBudgetTokens
    if (budgetTokens && snapshot.estimatedTokens > budgetTokens) {
      if (priority === 'supplementary') {
        return false
      }
      // For recommended/required, we still inject but could trim in the future
    }

    // Build injection payload
    const injection: ContextInjection = {
      content: reason === 'reactive'
        ? this.buildDeltaContent(snapshot)
        : this.buildFullContent(snapshot),
      format: 'json',
      snapshotVersion: snapshot.version,
      estimatedTokens: snapshot.estimatedTokens,
      priority,
    }

    // Deliver via plugin
    const plugin = this.gateway.getPlugin(handle.pluginName)
    if (!plugin) return false

    try {
      await plugin.injectContext(handle, injection)
    } catch {
      return false
    }

    // Update tracking state
    state.lastInjectionTick = currentTick
    state.lastSnapshotVersion = snapshot.version
    state.stalenessCounter = 0
    state.injectionTimestamps.push(now)
    state.hasEverInjected = true

    return true
  }

  /**
   * Trigger a brief_updated injection for a specific agent.
   * Called externally when an agent's brief is updated.
   */
  async onBriefUpdated(agentId: string): Promise<boolean> {
    return this.scheduleInjection(agentId, 'brief_updated', 'required')
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Check if an event matches any of the reactive triggers for an agent. */
  private matchesReactiveTrigger(
    envelope: EventEnvelope,
    triggers: ContextReactiveTrigger[],
    brief: AgentBrief,
  ): boolean {
    const event = envelope.event

    for (const trigger of triggers) {
      switch (trigger.on) {
        case 'artifact_approved':
          if (event.type === 'artifact' && event.status === 'approved') {
            if (this.workstreamMatchesTrigger(event.workstream, trigger.workstreams, brief)) {
              return true
            }
          }
          break

        case 'decision_resolved':
          // Decision resolution is tracked through the decision queue, not events.
          // We look for completion events or lifecycle events that indicate resolution.
          // In practice, the DecisionQueue resolve flow would emit an event.
          // For now, we check for 'completion' events as a proxy.
          if (event.type === 'completion') {
            if (this.workstreamMatchesTrigger(
              this.getAgentWorkstream(event.agentId),
              trigger.workstreams,
              brief,
            )) {
              return true
            }
          }
          break

        case 'coherence_issue':
          if (event.type === 'coherence') {
            if (SEVERITY_ORDER[event.severity] >= SEVERITY_ORDER[trigger.severity]) {
              return true
            }
          }
          break

        case 'agent_completed':
          if (event.type === 'completion') {
            const completedWorkstream = this.getAgentWorkstream(event.agentId)
            if (completedWorkstream && brief.readableWorkstreams.includes(completedWorkstream)) {
              return true
            }
          }
          break

        case 'brief_updated':
          // Handled separately via onBriefUpdated()
          break
      }
    }

    return false
  }

  /** Check if a workstream matches a trigger's workstream scope. */
  private workstreamMatchesTrigger(
    eventWorkstream: string | undefined,
    scope: 'own' | 'readable' | 'all',
    brief: AgentBrief,
  ): boolean {
    if (!eventWorkstream) return false

    switch (scope) {
      case 'own':
        return eventWorkstream === brief.workstream
      case 'readable':
        return eventWorkstream === brief.workstream ||
          brief.readableWorkstreams.includes(eventWorkstream)
      case 'all':
        return true
    }
  }

  /** Get the workstream associated with an event, if determinable. */
  private getEventWorkstream(envelope: EventEnvelope): string | undefined {
    const event = envelope.event

    if (event.type === 'artifact') {
      return event.workstream
    }

    if (event.type === 'coherence') {
      return event.affectedWorkstreams[0]
    }

    // For other event types, look up the agent's workstream
    return this.getAgentWorkstream(event.agentId)
  }

  /** Look up an agent's workstream from their stored brief. */
  private getAgentWorkstream(agentId: string): string | undefined {
    return this.agents.get(agentId)?.brief.workstream
  }

  /** Check if a workstream is readable by an agent (own + readableWorkstreams). */
  private isWorkstreamReadable(brief: AgentBrief, workstream: string): boolean {
    return brief.workstream === workstream ||
      brief.readableWorkstreams.includes(workstream)
  }

  /** Build full snapshot content as JSON string. */
  private buildFullContent(snapshot: KnowledgeSnapshot): string {
    return JSON.stringify(snapshot)
  }

  /** Build delta content — for now, same as full but marked as delta. */
  private buildDeltaContent(snapshot: KnowledgeSnapshot): string {
    // In Phase 2+, this would compute a real delta from the last injection.
    // For now, send the full snapshot with a marker.
    return JSON.stringify({ ...snapshot, isDelta: true })
  }

  /** Remove injection timestamps older than 1 hour. */
  private pruneOldTimestamps(state: AgentInjectionState, now: number): void {
    const oneHourAgo = now - 60 * 60 * 1000
    state.injectionTimestamps = state.injectionTimestamps.filter((t) => t > oneHourAgo)
  }
}
