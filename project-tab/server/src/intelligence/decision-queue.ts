import type { DecisionEvent, OptionDecisionEvent, ToolApprovalEvent } from '../types/events'
import type { Resolution } from '../types/resolution'
import type { TickService } from '../tick'

/** Decision timeout policy. */
export interface DecisionTimeoutPolicy {
  timeoutTicks: number | null
  onTimeout: 'auto_recommend'
  /** Grace period (in ticks) before orphaned decisions enter triage after agent kill. Default: 30. */
  orphanGracePeriodTicks: number
}

/** Default timeout policy: 300 ticks, auto_recommend on expiry. */
const DEFAULT_TIMEOUT_POLICY: DecisionTimeoutPolicy = {
  timeoutTicks: 300,
  onTimeout: 'auto_recommend',
  orphanGracePeriodTicks: 30,
}

/** Status of a queued decision. */
export type DecisionStatus = 'pending' | 'resolved' | 'timed_out' | 'triage' | 'suspended'

/** A decision entry in the queue with metadata. */
export interface QueuedDecision {
  event: DecisionEvent
  status: DecisionStatus
  enqueuedAtTick: number
  resolvedAt?: string
  resolution?: Resolution
  badge?: string
  priority: number
  /** Tick at which a grace-period orphan should move to triage. */
  graceDeadlineTick?: number
}

/** Resolution callback for awaiting callers. */
type ResolutionCallback = (resolution: Resolution) => void

/**
 * DecisionQueue manages pending decisions from agents, supports resolution,
 * timeout via tick subscription, and orphaned decision handling on agent kill.
 */
export class DecisionQueue {
  private readonly decisions = new Map<string, QueuedDecision>()
  private readonly pendingCallbacks = new Map<string, ResolutionCallback>()
  private readonly timeoutPolicy: DecisionTimeoutPolicy
  private tickHandler: ((tick: number) => void) | null = null

  constructor(timeoutPolicy: Partial<DecisionTimeoutPolicy> = {}) {
    this.timeoutPolicy = { ...DEFAULT_TIMEOUT_POLICY, ...timeoutPolicy }
  }

  /** Subscribe to tick service for timeout tracking. */
  subscribeTo(tickService: TickService): void {
    this.tickHandler = (tick: number) => this.onTick(tick)
    tickService.onTick(this.tickHandler)
  }

  /** Unsubscribe from tick service. */
  unsubscribeFrom(tickService: TickService): void {
    if (this.tickHandler) {
      tickService.removeOnTick(this.tickHandler)
      this.tickHandler = null
    }
  }

  /**
   * Enqueue a decision event. Returns the decision ID.
   * If the decision already exists, it is a no-op returning the existing ID.
   */
  enqueue(event: DecisionEvent, currentTick: number): string {
    const id = event.decisionId

    if (this.decisions.has(id)) {
      return id
    }

    const priority = this.computePriority(event)

    this.decisions.set(id, {
      event,
      status: 'pending',
      enqueuedAtTick: currentTick,
      priority
    })

    return id
  }

  /**
   * Resolve a decision. Returns the queued decision with its resolution,
   * or undefined if the decision doesn't exist or isn't pending.
   */
  resolve(decisionId: string, resolution: Resolution): QueuedDecision | undefined {
    const entry = this.decisions.get(decisionId)
    if (!entry || entry.status !== 'pending') {
      return undefined
    }

    entry.status = 'resolved'
    entry.resolvedAt = new Date().toISOString()
    entry.resolution = resolution

    const callback = this.pendingCallbacks.get(decisionId)
    if (callback) {
      callback(resolution)
      this.pendingCallbacks.delete(decisionId)
    }

    return entry
  }

  /** Wait for a decision to be resolved. Returns a promise that resolves with the Resolution. */
  waitForResolution(decisionId: string): Promise<Resolution> {
    const entry = this.decisions.get(decisionId)

    if (entry?.resolution) {
      return Promise.resolve(entry.resolution)
    }

    return new Promise<Resolution>((resolve) => {
      this.pendingCallbacks.set(decisionId, resolve)
    })
  }

  /** Get a specific queued decision by ID. */
  get(decisionId: string): QueuedDecision | undefined {
    return this.decisions.get(decisionId)
  }

  /** List all pending decisions, optionally filtered by agentId. */
  listPending(agentId?: string): QueuedDecision[] {
    const result: QueuedDecision[] = []
    for (const entry of this.decisions.values()) {
      if (entry.status !== 'pending') continue
      if (agentId && entry.event.agentId !== agentId) continue
      result.push(entry)
    }
    return result.sort((a, b) => b.priority - a.priority)
  }

  /** List all decisions regardless of status. */
  listAll(): QueuedDecision[] {
    return Array.from(this.decisions.values())
  }

  /**
   * Handle orphaned decisions when an agent is killed.
   * Marks all pending decisions from that agent as 'triage' with an
   * "agent killed" badge and elevated priority.
   */
  handleAgentKilled(agentId: string): QueuedDecision[] {
    const orphaned: QueuedDecision[] = []

    for (const entry of this.decisions.values()) {
      if (entry.event.agentId === agentId && entry.status === 'pending') {
        entry.status = 'triage'
        entry.badge = 'agent killed'
        entry.priority += 100
        orphaned.push(entry)
      }
    }

    return orphaned
  }

  /**
   * Schedule orphan triage for an agent's pending decisions after a grace period.
   * Decisions remain pending (resolvable by the human) during the grace window.
   * After graceDeadlineTick passes, onTick() moves them to 'triage'.
   */
  scheduleOrphanTriage(agentId: string, currentTick: number): QueuedDecision[] {
    const scheduled: QueuedDecision[] = []
    const deadline = currentTick + this.timeoutPolicy.orphanGracePeriodTicks

    for (const entry of this.decisions.values()) {
      if (entry.event.agentId === agentId && entry.status === 'pending') {
        entry.badge = 'grace period'
        entry.graceDeadlineTick = deadline
        scheduled.push(entry)
      }
    }

    return scheduled
  }

  /**
   * Suspend all pending decisions from an agent (used by brake-initiated kill).
   */
  suspendAgentDecisions(agentId: string): QueuedDecision[] {
    const suspended: QueuedDecision[] = []

    for (const entry of this.decisions.values()) {
      if (entry.event.agentId === agentId && entry.status === 'pending') {
        entry.status = 'suspended'
        entry.badge = 'source agent braked'
        suspended.push(entry)
      }
    }

    return suspended
  }

  /**
   * Resume suspended decisions for an agent (when agent is un-braked).
   */
  resumeAgentDecisions(agentId: string): QueuedDecision[] {
    const resumed: QueuedDecision[] = []

    for (const entry of this.decisions.values()) {
      if (entry.event.agentId === agentId && entry.status === 'suspended') {
        entry.status = 'pending'
        entry.badge = undefined
        resumed.push(entry)
      }
    }

    return resumed
  }

  /** Compute a priority score for a decision based on severity and subtype. */
  private computePriority(event: DecisionEvent): number {
    let priority = 0

    const severityMap: Record<string, number> = {
      critical: 50,
      high: 40,
      medium: 30,
      low: 20,
      warning: 10
    }

    if (event.subtype === 'option') {
      const optEvent = event as OptionDecisionEvent
      priority += severityMap[optEvent.severity] ?? 0
    } else {
      const toolEvent = event as ToolApprovalEvent
      priority += severityMap[toolEvent.severity ?? 'medium'] ?? 0
    }

    return priority
  }

  /** Tick handler for timeout and grace period processing. */
  private onTick(currentTick: number): void {
    for (const entry of this.decisions.values()) {
      if (entry.status !== 'pending') continue

      // Check grace period expiry first (orphaned decisions awaiting triage)
      if (entry.graceDeadlineTick != null && currentTick >= entry.graceDeadlineTick) {
        entry.status = 'triage'
        entry.badge = 'agent killed'
        entry.priority += 100
        entry.graceDeadlineTick = undefined
        continue
      }

      // Skip timeout processing if timeoutTicks is null
      if (this.timeoutPolicy.timeoutTicks === null) continue

      // Check explicit dueByTick first
      const dueByTick = entry.event.dueByTick
      const timedOutByDue = dueByTick != null && currentTick >= dueByTick
      const timedOutByPolicy = (currentTick - entry.enqueuedAtTick) >= this.timeoutPolicy.timeoutTicks

      if (timedOutByDue || timedOutByPolicy) {
        this.autoRecommend(entry)
      }
    }
  }

  /** Auto-recommend a timed-out decision. */
  private autoRecommend(entry: QueuedDecision): void {
    entry.status = 'timed_out'

    let resolution: Resolution

    if (entry.event.subtype === 'option') {
      const optEvent = entry.event as OptionDecisionEvent
      const recommendedId = optEvent.recommendedOptionId ?? optEvent.options[0]?.id ?? ''
      resolution = {
        type: 'option',
        chosenOptionId: recommendedId,
        rationale: 'Auto-recommended due to timeout',
        actionKind: 'review'
      }
    } else {
      resolution = {
        type: 'tool_approval',
        action: 'approve',
        rationale: 'Auto-approved due to timeout',
        actionKind: 'review'
      }
    }

    entry.resolution = resolution
    entry.resolvedAt = new Date().toISOString()

    const callback = this.pendingCallbacks.get(entry.event.decisionId)
    if (callback) {
      callback(resolution)
      this.pendingCallbacks.delete(entry.event.decisionId)
    }
  }
}
