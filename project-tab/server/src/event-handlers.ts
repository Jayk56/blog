import type { EventBus } from './bus'
import type { EventClassifier } from './classifier'
import type { AgentGateway, AgentRegistry, CheckpointStore } from './types/service-interfaces'
import type { EventEnvelope } from './types'
import type { CoherenceMonitor } from './intelligence/coherence-monitor'
import type { DecisionQueue } from './intelligence/decision-queue'
import type { KnowledgeStore } from './intelligence/knowledge-store'
import type { TickService } from './tick'
import type { TrustEngine, TrustOutcome } from './intelligence/trust-engine'
import type { WebSocketHub } from './ws-hub'

export interface EventHandlerDeps {
  eventBus: EventBus
  knowledgeStore: KnowledgeStore
  classifier: EventClassifier
  wsHub: WebSocketHub
  decisionQueue: DecisionQueue
  tickService: TickService
  registry: AgentRegistry
  gateway: AgentGateway
  checkpointStore: CheckpointStore
  coherenceMonitor: CoherenceMonitor
  trustEngine: TrustEngine
}

type ClassificationDeps = Pick<EventHandlerDeps, 'knowledgeStore' | 'classifier' | 'wsHub'>
type DecisionDeps = Pick<EventHandlerDeps, 'decisionQueue' | 'tickService' | 'registry' | 'gateway' | 'checkpointStore'>
type ArtifactDeps = Pick<EventHandlerDeps, 'knowledgeStore' | 'coherenceMonitor' | 'classifier' | 'wsHub'>
type LifecycleDeps = Pick<EventHandlerDeps, 'knowledgeStore' | 'registry'>
type CompletionDeps = Pick<EventHandlerDeps, 'trustEngine' | 'tickService' | 'wsHub' | 'knowledgeStore' | 'registry' | 'gateway' | 'checkpointStore'>
type ErrorDeps = Pick<EventHandlerDeps, 'trustEngine' | 'tickService' | 'wsHub' | 'knowledgeStore'>

/** Default number of ticks an agent may remain idle before auto-kill. */
export const DEFAULT_IDLE_TIMEOUT_TICKS = 500

/** Module-level idle entry tracking. Exposed for assign route to clear on reassignment. */
const _idleEntryTicks = new Map<string, number>()

/** Clear idle tracking for an agent (called when agent is assigned new work). */
export function clearIdleTracking(agentId: string): void {
  _idleEntryTicks.delete(agentId)
}

export function wireEventHandlers(deps: EventHandlerDeps): void {
  const persistedIssueIds = new Set<string>()
  let coherenceRunInFlight = false
  const idleEntryTick = _idleEntryTicks

  const publishCoherenceIssue = (issue: import('./types/events').CoherenceEvent, runId: string): void => {
    if (persistedIssueIds.has(issue.issueId)) return
    persistedIssueIds.add(issue.issueId)

    deps.knowledgeStore.storeCoherenceIssue(issue)

    const coherenceEnvelope: EventEnvelope = {
      sourceEventId: `coherence-${issue.issueId}`,
      sourceSequence: -1,
      sourceOccurredAt: new Date().toISOString(),
      runId,
      ingestedAt: new Date().toISOString(),
      event: issue,
    }
    const classified = deps.classifier.classify(coherenceEnvelope)
    deps.wsHub.publishClassifiedEvent(classified)
  }

  const flushMonitorIssues = (runId: string): void => {
    for (const issue of deps.coherenceMonitor.getDetectedIssues()) {
      publishCoherenceIssue(issue, runId)
    }
  }

  const contentProvider = (artifactId: string): string | undefined => {
    const artifact = deps.knowledgeStore.getArtifact(artifactId)
    if (!artifact) return undefined
    const stored = deps.knowledgeStore.getArtifactContent(artifact.agentId, artifactId)
    if (stored) return stored.content
    return undefined
  }

  const runCoherencePipeline = async (tick: number, runId: string): Promise<void> => {
    if (coherenceRunInFlight) return
    coherenceRunInFlight = true
    try {
      if (deps.coherenceMonitor.shouldRunLayer1Scan(tick)) {
        await deps.coherenceMonitor.runLayer1Scan(
          tick,
          (artifactId) => deps.knowledgeStore.getArtifact(artifactId),
          contentProvider
        )
      }

      if (deps.coherenceMonitor.shouldRunLayer1cSweep(tick)) {
        await deps.coherenceMonitor.runLayer1cSweep(
          tick,
          () => deps.knowledgeStore.listArtifacts(),
          contentProvider
        )
      }

      if (deps.coherenceMonitor.getConfig().enableLayer2) {
        let batch: import('./intelligence/coherence-review-service').CoherenceReviewResult[]
        do {
          batch = await deps.coherenceMonitor.runLayer2Review(contentProvider)
        } while (batch.length > 0)
      }

      flushMonitorIssues(runId)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[coherence] pipeline error:', error instanceof Error ? error.message : String(error))
    } finally {
      coherenceRunInFlight = false
    }
  }

  deps.eventBus.subscribe({}, (envelope) => {
    handleClassificationAndFanOut(envelope, deps)
  })

  deps.eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
    handleDecisionAndAutoCheckpoint(envelope, deps)
  })

  deps.eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
    handleArtifactStorageAndCoherence(envelope, deps, publishCoherenceIssue)
    void runCoherencePipeline(deps.tickService.currentTick(), envelope.runId)
  })

  deps.eventBus.subscribe({ eventType: 'lifecycle' }, (envelope) => {
    handleLifecycleTracking(envelope, deps)
  })

  deps.eventBus.subscribe({ eventType: 'completion' }, (envelope) => {
    handleCompletionTrustTracking(envelope, deps)
    // Track when agents enter idle state for timeout cleanup
    if (envelope.event.type === 'completion') {
      const outcome = envelope.event.outcome
      if (outcome === 'success' || outcome === 'partial') {
        idleEntryTick.set(envelope.event.agentId, deps.tickService.currentTick())
      } else {
        idleEntryTick.delete(envelope.event.agentId)
      }
    }
  })

  deps.eventBus.subscribe({ eventType: 'error' }, (envelope) => {
    handleErrorTrustTracking(envelope, deps)
  })

  deps.tickService.onTick((tick) => {
    void runCoherencePipeline(tick, 'system')

    // Auto-kill idle agents that haven't been assigned new work within the timeout
    for (const [agentId, entryTick] of idleEntryTick) {
      if (tick - entryTick >= DEFAULT_IDLE_TIMEOUT_TICKS) {
        const handle = deps.registry.getHandle(agentId)
        if (handle && handle.status === 'idle') {
          const plugin = deps.gateway.getPlugin(handle.pluginName)
          if (plugin) {
            plugin.kill(handle, { grace: true }).catch(() => { /* best effort */ })
          }
          deps.registry.removeHandle(agentId)
          deps.knowledgeStore.removeAgent(agentId)
          // eslint-disable-next-line no-console
          console.log(`[idle-timeout] auto-killed idle agent ${agentId} after ${DEFAULT_IDLE_TIMEOUT_TICKS} ticks`)
        }
        idleEntryTick.delete(agentId)
      }
    }
  })
}

export function handleClassificationAndFanOut(envelope: EventEnvelope, deps: ClassificationDeps): void {
  deps.knowledgeStore.appendEvent(envelope)
  const classified = deps.classifier.classify(envelope)
  deps.wsHub.publishClassifiedEvent(classified)
}

export function handleDecisionAndAutoCheckpoint(envelope: EventEnvelope, deps: DecisionDeps): void {
  if (envelope.event.type !== 'decision') return

  deps.decisionQueue.enqueue(envelope.event, deps.tickService.currentTick())

  const agentId = envelope.event.agentId
  const decisionId = envelope.event.decisionId

  deps.registry.updateHandle(agentId, { status: 'waiting_on_human' })

  const handle = deps.registry.getHandle(agentId)
  if (!handle) return

  const plugin = deps.gateway.getPlugin(handle.pluginName)
  if (!plugin) return

  plugin.requestCheckpoint(handle, decisionId).then((state) => {
    deps.checkpointStore.storeCheckpoint(state, decisionId)
    // eslint-disable-next-line no-console
    console.log(`[checkpoint] stored decision checkpoint for agent ${agentId}, decision ${decisionId}`)
  }).catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[checkpoint] failed to checkpoint agent ${agentId} on decision ${decisionId}:`, err.message)
  })
}

export function handleArtifactStorageAndCoherence(
  envelope: EventEnvelope,
  deps: ArtifactDeps,
  onCoherenceIssue?: (issue: import('./types/events').CoherenceEvent, runId: string) => void
): void {
  if (envelope.event.type !== 'artifact') return

  deps.knowledgeStore.storeArtifact(envelope.event)

  const issue = deps.coherenceMonitor.processArtifact(envelope.event)
  if (!issue) return

  if (onCoherenceIssue) {
    onCoherenceIssue(issue, envelope.runId)
    return
  }

  deps.knowledgeStore.storeCoherenceIssue(issue)

  const coherenceEnvelope: EventEnvelope = {
    sourceEventId: `coherence-${issue.issueId}`,
    sourceSequence: -1,
    sourceOccurredAt: new Date().toISOString(),
    runId: envelope.runId,
    ingestedAt: new Date().toISOString(),
    event: issue,
  }
  const classified = deps.classifier.classify(coherenceEnvelope)
  deps.wsHub.publishClassifiedEvent(classified)
}

export function handleLifecycleTracking(envelope: EventEnvelope, deps: LifecycleDeps): void {
  if (envelope.event.type !== 'lifecycle') return

  const agentId = envelope.event.agentId
  const action = envelope.event.action
  if (action === 'started') {
    const handle = deps.registry.getHandle(agentId)
    if (handle) {
      deps.knowledgeStore.registerAgent(handle, {
        role: 'agent',
        workstream: '',
        pluginName: handle.pluginName,
      })
    } else {
      deps.knowledgeStore.registerAgent(
        { id: agentId, pluginName: 'unknown', status: 'running', sessionId: '' },
        { role: 'agent', workstream: '', pluginName: 'unknown' }
      )
    }
  } else if (action === 'paused') {
    deps.knowledgeStore.updateAgentStatus(agentId, 'paused')
  } else if (action === 'resumed') {
    deps.knowledgeStore.updateAgentStatus(agentId, 'running')
  } else if (action === 'killed' || action === 'crashed') {
    deps.knowledgeStore.removeAgent(agentId)
  }
}

export function handleCompletionTrustTracking(envelope: EventEnvelope, deps: CompletionDeps): void {
  if (envelope.event.type !== 'completion') return

  const agentId = envelope.event.agentId
  const trustOutcome = mapCompletionOutcomeToTrustOutcome(envelope.event.outcome)
  if (!trustOutcome) return

  const previousScore = deps.trustEngine.getScore(agentId) ?? 50
  const artifactKinds = new Set<import('./types/events').ArtifactKind>()
  const workstreams = new Set<string>()
  for (const artifactId of envelope.event.artifactsProduced) {
    const artifact = deps.knowledgeStore.getArtifact(artifactId)
    if (!artifact) continue
    artifactKinds.add(artifact.kind)
    workstreams.add(artifact.workstream)
  }

  deps.trustEngine.applyOutcome(
    agentId,
    trustOutcome,
    deps.tickService.currentTick(),
    {
      artifactKinds: [...artifactKinds],
      workstreams: [...workstreams],
    }
  )
  const newScore = deps.trustEngine.getScore(agentId) ?? 50
  flushDomainOutcomes(agentId, deps)

  if (previousScore !== newScore) {
    deps.wsHub.broadcast({
      type: 'trust_update',
      agentId,
      previousScore,
      newScore,
      delta: newScore - previousScore,
      reason: trustOutcome,
    })
  }

  // Transition to idle on success/partial; completed (terminal) on abandoned/max_turns
  const outcome = envelope.event.outcome
  if (outcome === 'success' || outcome === 'partial') {
    deps.registry.updateHandle(agentId, { status: 'idle' })
    deps.knowledgeStore.updateAgentStatus(agentId, 'idle')

    // Auto-checkpoint so we have session state for later resume
    const handle = deps.registry.getHandle(agentId)
    if (handle) {
      const plugin = deps.gateway.getPlugin(handle.pluginName)
      if (plugin) {
        plugin.requestCheckpoint(handle, `completion-${agentId}`)
          .then(state => {
            // Tag as idle_completion so checkpoint store knows the provenance
            state.serializedBy = 'idle_completion'
            deps.checkpointStore.storeCheckpoint(state, `completion-${agentId}`)
          })
          .catch(() => { /* best effort */ })
      }
    }
  } else {
    deps.registry.updateHandle(agentId, { status: 'completed' })
    deps.knowledgeStore.updateAgentStatus(agentId, 'completed')
  }
}

export function handleErrorTrustTracking(envelope: EventEnvelope, deps: ErrorDeps): void {
  if (envelope.event.type !== 'error' || envelope.event.severity === 'warning') return

  const agentId = envelope.event.agentId
  const previousScore = deps.trustEngine.getScore(agentId) ?? 50
  deps.trustEngine.applyOutcome(
    agentId,
    'error_event',
    deps.tickService.currentTick(),
    {
      toolCategory: classifyToolCategory(envelope.event.context?.toolName),
    }
  )
  const newScore = deps.trustEngine.getScore(agentId) ?? 50
  flushDomainOutcomes(agentId, deps)

  if (previousScore !== newScore) {
    deps.wsHub.broadcast({
      type: 'trust_update',
      agentId,
      previousScore,
      newScore,
      delta: newScore - previousScore,
      reason: 'error_event',
    })
  }
}

function mapCompletionOutcomeToTrustOutcome(outcome: 'success' | 'partial' | 'abandoned' | 'max_turns'): TrustOutcome | null {
  if (outcome === 'success') {
    return 'task_completed_clean'
  }
  if (outcome === 'partial') {
    return 'task_completed_partial'
  }
  if (outcome === 'abandoned' || outcome === 'max_turns') {
    return 'task_abandoned_or_max_turns'
  }
  return null
}

function flushDomainOutcomes(agentId: string, deps: Pick<EventHandlerDeps, 'trustEngine' | 'knowledgeStore'>): void {
  const outcomes = deps.trustEngine.flushDomainLog(agentId)
  for (const outcome of outcomes) {
    deps.knowledgeStore.appendAuditLog(
      'trust_domain_outcome',
      agentId,
      'record',
      agentId,
      outcome
    )
  }
}

function classifyToolCategory(toolName: string | undefined): string | undefined {
  if (!toolName) return undefined
  const normalized = toolName.toLowerCase()
  if (normalized.includes('read') || normalized.includes('list') || normalized.includes('grep') || normalized.includes('search') || normalized.includes('cat')) {
    return 'read'
  }
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch') || normalized.includes('update')) {
    return 'write'
  }
  return 'execute'
}
