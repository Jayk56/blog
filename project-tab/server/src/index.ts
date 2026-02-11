import { createServer, type Server } from 'node:http'

import { EventBus } from './bus'
import { EventClassifier } from './classifier'
import { createApp, attachWebSocketUpgrade } from './app'
import { TickService } from './tick'
import { TrustEngine } from './intelligence/trust-engine'
import { DecisionQueue } from './intelligence/decision-queue'
import { KnowledgeStore as KnowledgeStoreImpl } from './intelligence/knowledge-store'
import { CoherenceMonitor } from './intelligence/coherence-monitor'
import { MockEmbeddingService } from './intelligence/embedding-service'
import { MockCoherenceReviewService } from './intelligence/coherence-review-service'
import { ContextInjectionService } from './intelligence/context-injection-service'
import { ChildProcessManager } from './gateway/child-process-manager'
import { LocalProcessPlugin } from './gateway/local-process-plugin'
import { TokenService } from './gateway/token-service'
import type { AgentHandle, AgentPlugin, KnowledgeSnapshot } from './types'
import type { ControlMode } from './types/events'
import type { AgentRegistry as IAgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from './routes'
import { AgentRegistry as AgentRegistryImpl } from './registry/agent-registry'
import { WebSocketHub } from './ws-hub'

// ── Environment configuration ─────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001)
const tickMode = process.env.TICK_MODE === 'manual' ? 'manual' : 'wall_clock'
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 1000)
const dbPath = process.env.DB_PATH ?? ':memory:'
const dockerEnabled = process.env.DOCKER_ENABLED ?? 'auto'
const dockerImage = process.env.DOCKER_IMAGE ?? 'project-tab/adapter-shim:latest'
const backendUrl = process.env.BACKEND_URL ?? `http://localhost:${port}`
const defaultPlugin = process.env.DEFAULT_PLUGIN ?? 'openai'
const shimCommand = process.env.SHIM_COMMAND ?? 'python'
const shimArgs = (process.env.SHIM_ARGS ?? '-m,adapter_shim,--mock').split(',')
const enableLayer2 = process.env.ENABLE_LAYER2 === 'true'
const tokenTtlMs = Number(process.env.TOKEN_TTL_MS ?? 3_600_000)

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Core services
  const tickService = new TickService({ mode: tickMode, intervalMs: tickIntervalMs })
  const eventBus = new EventBus(10_000, { maxQueuePerAgent: 500 })
  const classifier = new EventClassifier()

  // Token service
  const tokenService = new TokenService({ defaultTtlMs: tokenTtlMs })

  async function generateToken(agentId: string): Promise<{ token: string; expiresAt: string }> {
    const issued = await tokenService.issueToken(agentId)
    return { token: issued.token, expiresAt: issued.expiresAt }
  }

  // Intelligence layer
  const trustEngine = new TrustEngine()
  trustEngine.subscribeTo(tickService)

  const decisionQueue = new DecisionQueue()
  decisionQueue.subscribeTo(tickService)

  // Agent registry
  const agentRegistryImpl = new AgentRegistryImpl()

  const registry: IAgentRegistry = {
    getHandle(agentId: string): AgentHandle | null {
      const entry = agentRegistryImpl.getById(agentId)
      return entry?.handle ?? null
    },
    listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[] {
      const all = agentRegistryImpl.getAll().map((e) => e.handle)
      if (!filter) return all
      return all.filter((h) => {
        if (filter.status && h.status !== filter.status) return false
        if (filter.pluginName && h.pluginName !== filter.pluginName) return false
        return true
      })
    },
    registerHandle(handle: AgentHandle): void {
      agentRegistryImpl.register(handle, {
        agentId: handle.id,
        transport: { type: 'in_process', eventSink: () => {} },
        providerType: 'local_process',
        createdAt: new Date().toISOString(),
        lastHeartbeatAt: null
      })
    },
    updateHandle(agentId: string, updates: Partial<AgentHandle>): void {
      const entry = agentRegistryImpl.getById(agentId)
      if (entry) {
        agentRegistryImpl.updateHandle(agentId, { ...entry.handle, ...updates })
      }
    },
    removeHandle(agentId: string): void {
      agentRegistryImpl.unregister(agentId)
    }
  }

  // Knowledge store and coherence monitor
  const knowledgeStoreImpl = new KnowledgeStoreImpl(dbPath)
  const coherenceMonitor = new CoherenceMonitor({ enableLayer2 })

  // Wire coherence monitor services
  const embeddingService = new MockEmbeddingService()
  const reviewService = new MockCoherenceReviewService()
  coherenceMonitor.setEmbeddingService(embeddingService)
  coherenceMonitor.setReviewService(reviewService)
  coherenceMonitor.setArtifactContentProvider((_artifactId) => {
    // Content retrieval not yet implemented; Layer 2 review will skip content-less artifacts
    return undefined
  })
  coherenceMonitor.subscribeTo(tickService)

  const knowledgeStore: KnowledgeStore = {
    async getSnapshot(_workstream?: string): Promise<KnowledgeSnapshot> {
      return knowledgeStoreImpl.getSnapshot(decisionQueue.listPending())
    },
    async appendEvent(): Promise<void> {
      // Events are delivered via EventBus
    }
  }

  // Checkpoint store
  const checkpointStore: CheckpointStore = {
    storeCheckpoint: (state, decisionId, maxPerAgent) => knowledgeStoreImpl.storeCheckpoint(state, decisionId, maxPerAgent),
    getCheckpoints: (agentId) => knowledgeStoreImpl.getCheckpoints(agentId),
    getLatestCheckpoint: (agentId) => knowledgeStoreImpl.getLatestCheckpoint(agentId),
    getCheckpointCount: (agentId) => knowledgeStoreImpl.getCheckpointCount(agentId),
    deleteCheckpoints: (agentId) => knowledgeStoreImpl.deleteCheckpoints(agentId),
  }

  // ── Plugin registration ───────────────────────────────────────────────

  const plugins = new Map<string, AgentPlugin>()
  const gateway: AgentGateway = {
    getPlugin(pluginName: string) {
      return plugins.get(pluginName)
    },
    async spawn(brief, pluginName) {
      const plugin = plugins.get(pluginName)
      if (!plugin) {
        throw new Error(`No plugin registered with name "${pluginName}"`)
      }
      return plugin.spawn(brief)
    }
  }

  // Local process plugin (always available)
  const processManager = new ChildProcessManager()
  const openaiPlugin = new LocalProcessPlugin({
    name: 'openai',
    processManager,
    eventBus,
    shimCommand,
    shimArgs,
    backendUrl,
    generateToken,
  })
  plugins.set('openai', openaiPlugin)
  // eslint-disable-next-line no-console
  console.log(`[plugin] registered "openai" (local process: ${shimCommand} ${shimArgs.join(' ')})`)

  // Docker container plugin (conditional)
  const dockerPlugins = await wireDockerPlugin(plugins, backendUrl, tokenService, eventBus)

  // ── Control mode ────────────────────────────────────────────────────

  let currentControlMode: ControlMode = 'orchestrator'
  const controlMode: ControlModeManager = {
    getMode() { return currentControlMode },
    setMode(mode: ControlMode) { currentControlMode = mode }
  }

  // ── Context injection ───────────────────────────────────────────────

  const contextInjection = new ContextInjectionService(
    tickService, eventBus, knowledgeStore, registry, gateway, controlMode
  )
  contextInjection.start()

  // ── WebSocket hub ───────────────────────────────────────────────────

  const wsHub = new WebSocketHub(() => ({
    snapshot: knowledgeStoreImpl.getSnapshot(decisionQueue.listPending()),
    activeAgents: registry.listHandles(),
    trustScores: trustEngine.getAllScores(),
    controlMode: currentControlMode
  }))

  // ── Wire app ────────────────────────────────────────────────────────

  const app = createApp({
    tickService,
    eventBus,
    wsHub,
    trustEngine,
    decisionQueue,
    registry,
    knowledgeStore,
    checkpointStore,
    gateway,
    controlMode,
    tokenService,
    contextInjection,
    defaultPlugin,
  })

  const server = createServer(app as any)
  attachWebSocketUpgrade(server, wsHub)

  // ── Event bus subscriptions ─────────────────────────────────────────

  // Classifier + WS fan-out
  eventBus.subscribe({}, (envelope) => {
    const classified = classifier.classify(envelope)
    wsHub.publishClassifiedEvent(classified)
  })

  // Decision queue + auto-checkpoint
  eventBus.subscribe({ eventType: 'decision' }, (envelope) => {
    if (envelope.event.type === 'decision') {
      decisionQueue.enqueue(envelope.event, tickService.currentTick())

      const agentId = envelope.event.agentId
      const decisionId = envelope.event.decisionId

      registry.updateHandle(agentId, { status: 'waiting_on_human' })

      const handle = registry.getHandle(agentId)
      if (handle) {
        const plugin = gateway.getPlugin(handle.pluginName)
        if (plugin) {
          plugin.requestCheckpoint(handle, decisionId).then((state) => {
            checkpointStore.storeCheckpoint(state, decisionId)
            // eslint-disable-next-line no-console
            console.log(`[checkpoint] stored decision checkpoint for agent ${agentId}, decision ${decisionId}`)
          }).catch((err: Error) => {
            // eslint-disable-next-line no-console
            console.error(`[checkpoint] failed to checkpoint agent ${agentId} on decision ${decisionId}:`, err.message)
          })
        }
      }
    }
  })

  // Artifact storage + coherence check
  eventBus.subscribe({ eventType: 'artifact' }, (envelope) => {
    if (envelope.event.type === 'artifact') {
      knowledgeStoreImpl.storeArtifact(envelope.event)

      const issue = coherenceMonitor.processArtifact(envelope.event)
      if (issue) {
        knowledgeStoreImpl.storeCoherenceIssue(issue)

        const coherenceEnvelope = {
          sourceEventId: `coherence-${issue.issueId}`,
          sourceSequence: -1,
          sourceOccurredAt: new Date().toISOString(),
          runId: envelope.runId,
          ingestedAt: new Date().toISOString(),
          event: issue
        }
        const classified = classifier.classify(coherenceEnvelope)
        wsHub.publishClassifiedEvent(classified)
      }
    }
  })

  // Lifecycle tracking
  eventBus.subscribe({ eventType: 'lifecycle' }, (envelope) => {
    if (envelope.event.type === 'lifecycle') {
      const agentId = envelope.event.agentId
      const action = envelope.event.action
      if (action === 'started') {
        const handle = registry.getHandle(agentId)
        if (handle) {
          knowledgeStoreImpl.registerAgent(handle, {
            role: 'agent',
            workstream: '',
            pluginName: handle.pluginName,
          })
        } else {
          knowledgeStoreImpl.registerAgent(
            { id: agentId, pluginName: 'unknown', status: 'running', sessionId: '' },
            { role: 'agent', workstream: '', pluginName: 'unknown' }
          )
        }
      } else if (action === 'paused') {
        knowledgeStoreImpl.updateAgentStatus(agentId, 'paused')
      } else if (action === 'resumed') {
        knowledgeStoreImpl.updateAgentStatus(agentId, 'running')
      } else if (action === 'killed' || action === 'crashed') {
        knowledgeStoreImpl.removeAgent(agentId)
      }
    }
  })

  // Trust tracking: completion events
  eventBus.subscribe({ eventType: 'completion' }, (envelope) => {
    if (envelope.event.type === 'completion') {
      const agentId = envelope.event.agentId
      const outcome = envelope.event.outcome

      let trustOutcome: import('./intelligence/trust-engine').TrustOutcome | null = null
      if (outcome === 'success') {
        trustOutcome = 'task_completed_clean'
      } else if (outcome === 'partial') {
        trustOutcome = 'task_completed_partial'
      } else if (outcome === 'abandoned' || outcome === 'max_turns') {
        trustOutcome = 'task_abandoned_or_max_turns'
      }

      if (trustOutcome) {
        const previousScore = trustEngine.getScore(agentId) ?? 50
        trustEngine.applyOutcome(agentId, trustOutcome, tickService.currentTick())
        const newScore = trustEngine.getScore(agentId) ?? 50

        if (previousScore !== newScore) {
          wsHub.broadcast({
            type: 'trust_update',
            agentId,
            previousScore,
            newScore,
            delta: newScore - previousScore,
            reason: trustOutcome
          })
        }
      }
    }
  })

  // Trust tracking: error events
  eventBus.subscribe({ eventType: 'error' }, (envelope) => {
    if (envelope.event.type === 'error' && envelope.event.severity !== 'warning') {
      const agentId = envelope.event.agentId
      const previousScore = trustEngine.getScore(agentId) ?? 50
      trustEngine.applyOutcome(agentId, 'error_event', tickService.currentTick())
      const newScore = trustEngine.getScore(agentId) ?? 50

      if (previousScore !== newScore) {
        wsHub.broadcast({
          type: 'trust_update',
          agentId,
          previousScore,
          newScore,
          delta: newScore - previousScore,
          reason: 'error_event'
        })
      }
    }
  })

  // ── Start ───────────────────────────────────────────────────────────

  tickService.start()

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[project-tab-server] listening on :${port} (tickMode=${tickService.getMode()}, intervalMs=${tickIntervalMs}, db=${dbPath}, defaultPlugin=${defaultPlugin})`
      )
      resolve()
    })
  })

  // ── Graceful shutdown ───────────────────────────────────────────────

  setupShutdown(server, tickService, contextInjection, openaiPlugin, knowledgeStoreImpl, registry, gateway)
}

// ── Docker plugin wiring ──────────────────────────────────────────────────

async function wireDockerPlugin(
  plugins: Map<string, AgentPlugin>,
  backendUrl: string,
  tokenService: TokenService,
  _eventBus: EventBus,
): Promise<void> {
  if (dockerEnabled === 'false') {
    // eslint-disable-next-line no-console
    console.log('[plugin] Docker disabled via DOCKER_ENABLED=false')
    return
  }

  try {
    const { default: Docker } = await import('dockerode')
    const docker = new Docker()

    // Probe Docker connectivity
    await docker.ping()

    const { ContainerOrchestrator } = await import('./gateway/container-orchestrator')
    const { ContainerPlugin } = await import('./gateway/container-plugin')
    const { createDefaultProvisioner } = await import('./gateway/mcp-provisioner')

    const orchestrator = new ContainerOrchestrator(docker)
    const mcpProvisioner = createDefaultProvisioner()

    const claudePlugin = new ContainerPlugin({
      name: 'claude',
      version: '1.0.0',
      capabilities: {
        supportsPause: false,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: true,
      },
      orchestrator,
      image: dockerImage,
      backendUrl,
      generateToken: (agentId: string) => {
        // ContainerPlugin expects sync generateToken. Token signing (HS256 via jose)
        // resolves in a microtask, so the result object is populated before the next
        // await in ContainerPlugin.spawn(). This is safe because createSandbox() is
        // the first await after generateToken(), giving the microtask queue time to flush.
        // TODO: Refactor ContainerPlugin to accept async generateToken.
        const result = { token: '', expiresAt: '' }
        tokenService.issueToken(agentId).then((issued) => {
          result.token = issued.token
          result.expiresAt = issued.expiresAt
        })
        return result
      },
      mcpProvisioner,
    })

    plugins.set('claude', claudePlugin)
    // eslint-disable-next-line no-console
    console.log(`[plugin] registered "claude" (Docker container: ${dockerImage})`)
  } catch (err) {
    if (dockerEnabled === 'true') {
      throw new Error(`DOCKER_ENABLED=true but Docker is unavailable: ${err instanceof Error ? err.message : String(err)}`)
    }
    // auto mode: Docker not available, skip silently
    // eslint-disable-next-line no-console
    console.log(`[plugin] Docker not available, skipping container plugin (${err instanceof Error ? err.message : 'unknown error'})`)
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────

function setupShutdown(
  server: Server,
  tickService: TickService,
  contextInjection: ContextInjectionService,
  localPlugin: LocalProcessPlugin,
  knowledgeStore: KnowledgeStoreImpl,
  registry: IAgentRegistry,
  gateway: AgentGateway,
): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    // eslint-disable-next-line no-console
    console.log(`\n[shutdown] received ${signal}, cleaning up...`)

    tickService.stop()
    contextInjection.stop()

    // Kill all registered agents via their respective plugins (with per-agent timeout)
    const agents = registry.listHandles()
    for (const handle of agents) {
      try {
        const plugin = gateway.getPlugin(handle.pluginName)
        if (plugin) {
          await Promise.race([
            plugin.kill(handle, { grace: true, graceTimeoutMs: 2000 }),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
          ])
        }
      } catch {
        // best effort
      }
      registry.removeHandle(handle.id)
    }

    // Also clean up any local processes not tracked in registry
    try {
      await localPlugin.killAll()
    } catch {
      // best effort
    }

    try {
      knowledgeStore.close()
    } catch {
      // best effort
    }

    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('[shutdown] server closed')
      process.exit(0)
    })

    // Force exit after 5s if server.close() hangs
    setTimeout(() => process.exit(1), 5000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

// ── Entry point ───────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] bootstrap failed:', err)
  process.exit(1)
})
