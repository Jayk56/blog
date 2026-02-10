import type { AgentEvent, EventEnvelope } from './types'

/** Event bus subscription filter. */
export interface EventBusFilter {
  agentId?: string
  eventType?: AgentEvent['type']
}

/** Event bus subscriber callback. */
export type EventBusHandler = (envelope: EventEnvelope) => void

/** Sequence gap warning emitted by the bus. */
export interface SequenceGapWarning {
  agentId: string
  runId: string
  previousSequence: number
  currentSequence: number
}

/** Event bus metrics snapshot. */
export interface EventBusMetrics {
  totalPublished: number
  totalDeduplicated: number
  totalDelivered: number
  totalDropped: number
}

/** Backpressure configuration. */
export interface BackpressureConfig {
  maxQueuePerAgent: number
  /** Hard cap for high-priority events. Defaults to 2x maxQueuePerAgent. */
  maxHighPriorityPerAgent?: number
}

interface Subscription {
  id: string
  filter: EventBusFilter
  handler: EventBusHandler
}

/** Event types considered high priority and preserved during backpressure. */
const HIGH_PRIORITY_TYPES: ReadonlySet<AgentEvent['type']> = new Set([
  'decision',
  'artifact',
  'error',
  'completion'
])

/** Event types considered low priority and eligible for dropping during backpressure. */
const LOW_PRIORITY_TYPES: ReadonlySet<AgentEvent['type']> = new Set([
  'tool_call',
  'progress',
  'status'
])

function isLowPriority(type: AgentEvent['type']): boolean {
  return LOW_PRIORITY_TYPES.has(type)
}

function isHighPriority(type: AgentEvent['type']): boolean {
  return HIGH_PRIORITY_TYPES.has(type)
}

/**
 * EventBus handles in-memory publish/subscribe, deduplication, sequence checks,
 * and per-agent backpressure.
 */
export class EventBus {
  private readonly subscriptions = new Map<string, Subscription>()
  private readonly dedupSet = new Set<string>()
  private readonly dedupQueue: string[] = []
  private readonly dedupCapacity: number
  private readonly lastSequenceByRun = new Map<string, number>()
  private readonly warnings: SequenceGapWarning[] = []

  private readonly agentQueues = new Map<string, EventEnvelope[]>()
  private readonly maxQueuePerAgent: number
  private readonly maxHighPriorityPerAgent: number

  private totalPublished = 0
  private totalDeduplicated = 0
  private totalDelivered = 0
  private totalDropped = 0

  constructor(dedupCapacity = 10_000, backpressure?: BackpressureConfig) {
    this.dedupCapacity = dedupCapacity
    this.maxQueuePerAgent = backpressure?.maxQueuePerAgent ?? 500
    this.maxHighPriorityPerAgent = backpressure?.maxHighPriorityPerAgent ?? this.maxQueuePerAgent * 2
  }

  /** Publishes an event to all matching subscribers. Duplicate source events are dropped. */
  publish(envelope: EventEnvelope): boolean {
    if (this.isDuplicate(envelope.sourceEventId)) {
      this.totalDeduplicated += 1
      return false
    }

    this.trackDedup(envelope.sourceEventId)
    this.totalPublished += 1
    this.detectSequenceGap(envelope)

    const dropped = this.applyBackpressure(envelope)

    for (const subscription of this.subscriptions.values()) {
      if (this.matches(subscription.filter, envelope)) {
        subscription.handler(envelope)
        this.totalDelivered += 1
      }
    }

    // Emit backpressure warning after delivering the actual event
    if (dropped > 0) {
      this.emitBackpressureWarning(envelope.event.agentId, dropped, envelope.runId)
    }

    return true
  }

  /** Registers a filtered subscriber and returns a subscription id. */
  subscribe(filter: EventBusFilter, handler: EventBusHandler): string {
    const id = globalThis.crypto?.randomUUID?.() ?? `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`
    this.subscriptions.set(id, { id, filter, handler })
    return id
  }

  /** Removes an existing subscription. */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId)
  }

  /** Returns bus metrics counters. */
  getMetrics(): EventBusMetrics {
    return {
      totalPublished: this.totalPublished,
      totalDeduplicated: this.totalDeduplicated,
      totalDelivered: this.totalDelivered,
      totalDropped: this.totalDropped
    }
  }

  /** Returns sequence gap warnings captured so far. */
  getSequenceGapWarnings(): SequenceGapWarning[] {
    return [...this.warnings]
  }

  /** Returns the current queue size for a given agent. */
  getAgentQueueSize(agentId: string): number {
    return this.agentQueues.get(agentId)?.length ?? 0
  }

  private isDuplicate(sourceEventId: string): boolean {
    return this.dedupSet.has(sourceEventId)
  }

  private trackDedup(sourceEventId: string): void {
    this.dedupSet.add(sourceEventId)
    this.dedupQueue.push(sourceEventId)

    if (this.dedupQueue.length > this.dedupCapacity) {
      const evicted = this.dedupQueue.shift()
      if (evicted) {
        this.dedupSet.delete(evicted)
      }
    }
  }

  private matches(filter: EventBusFilter, envelope: EventEnvelope): boolean {
    if (filter.agentId && envelope.event.agentId !== filter.agentId) {
      return false
    }

    if (filter.eventType && envelope.event.type !== filter.eventType) {
      return false
    }

    return true
  }

  private detectSequenceGap(envelope: EventEnvelope): void {
    const key = `${envelope.event.agentId}:${envelope.runId}`
    const previous = this.lastSequenceByRun.get(key)

    if (previous !== undefined && envelope.sourceSequence > previous + 1) {
      const warning: SequenceGapWarning = {
        agentId: envelope.event.agentId,
        runId: envelope.runId,
        previousSequence: previous,
        currentSequence: envelope.sourceSequence
      }
      this.warnings.push(warning)
      // eslint-disable-next-line no-console
      console.warn(
        `[EventBus] sequence gap for agent ${warning.agentId} run ${warning.runId}: ${warning.previousSequence} -> ${warning.currentSequence}`
      )
    }

    if (previous === undefined || envelope.sourceSequence > previous) {
      this.lastSequenceByRun.set(key, envelope.sourceSequence)
    }
  }

  /**
   * Applies per-agent backpressure. Tracks per-agent queue and drops oldest
   * low-priority events when the queue exceeds the configured max.
   * Returns the number of events dropped (0 if no dropping was needed).
   */
  private applyBackpressure(envelope: EventEnvelope): number {
    const agentId = envelope.event.agentId
    let queue = this.agentQueues.get(agentId)
    if (!queue) {
      queue = []
      this.agentQueues.set(agentId, queue)
    }

    queue.push(envelope)

    if (queue.length <= this.maxQueuePerAgent) {
      return 0
    }

    // Queue overflowed. Drop oldest low-priority events first.
    let dropped = 0
    const targetDrops = queue.length - this.maxQueuePerAgent

    // Scan from oldest to newest, remove low-priority events until we're within bounds
    let i = 0
    while (dropped < targetDrops && i < queue.length) {
      if (isLowPriority(queue[i]!.event.type)) {
        queue.splice(i, 1)
        dropped += 1
        this.totalDropped += 1
      } else {
        i += 1
      }
    }

    // If still over capacity after removing all eligible low-priority events,
    // drop oldest non-high-priority events
    i = 0
    while (queue.length > this.maxQueuePerAgent && i < queue.length) {
      if (!isHighPriority(queue[i]!.event.type)) {
        queue.splice(i, 1)
        this.totalDropped += 1
        dropped += 1
      } else {
        i += 1
      }
    }

    // If still over the high-priority hard cap (only high-priority remain),
    // drop oldest high-priority events to prevent unbounded memory growth
    if (queue.length > this.maxHighPriorityPerAgent) {
      const excessHp = queue.length - this.maxHighPriorityPerAgent
      queue.splice(0, excessHp)
      this.totalDropped += excessHp
      dropped += excessHp
    }

    return dropped
  }

  /**
   * Emits an ErrorEvent with severity 'warning' when backpressure drops events.
   * The ErrorEvent is itself high-priority and not subject to further dropping.
   */
  private emitBackpressureWarning(agentId: string, droppedCount: number, runId: string): void {
    const warningEnvelope: EventEnvelope = {
      sourceEventId: `backpressure-${agentId}-${Date.now()}`,
      sourceSequence: -1, // synthetic, not part of the agent's real sequence
      sourceOccurredAt: new Date().toISOString(),
      runId,
      ingestedAt: new Date().toISOString(),
      event: {
        type: 'error',
        agentId,
        severity: 'warning',
        message: `backpressure: ${droppedCount} events dropped for agent ${agentId}`,
        recoverable: true,
        category: 'internal'
      }
    }

    // Deliver directly to subscribers without going through the normal publish
    // flow (which would recurse through backpressure logic)
    for (const subscription of this.subscriptions.values()) {
      if (this.matches(subscription.filter, warningEnvelope)) {
        subscription.handler(warningEnvelope)
        this.totalDelivered += 1
      }
    }
  }
}
