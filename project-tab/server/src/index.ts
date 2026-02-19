import { createServer, type Server } from 'node:http'

import { EventBus } from './bus'
import { EventClassifier } from './classifier'
import { createApp, attachWebSocketUpgrade } from './app'
import { wireEventHandlers } from './event-handlers'
import { runStartupVolumeRecovery, wireDockerPlugin } from './startup'
import { TickService } from './tick'
import { TrustEngine } from './intelligence/trust-engine'
import { DecisionQueue } from './intelligence/decision-queue'
import { KnowledgeStore as KnowledgeStoreImpl } from './intelligence/knowledge-store'
import { CoherenceMonitor } from './intelligence/coherence-monitor'
import { MockEmbeddingService } from './intelligence/embedding-service'
import { MockCoherenceReviewService } from './intelligence/coherence-review-service'
import { VoyageEmbeddingService } from './intelligence/voyage-embedding-service'
import { LlmReviewService } from './intelligence/llm-review-service'
import { ContextInjectionService } from './intelligence/context-injection-service'
import { ChildProcessManager } from './gateway/child-process-manager'
import { LocalProcessPlugin } from './gateway/local-process-plugin'
import { AuthService } from './auth'
import { TokenService } from './gateway/token-service'
import type { AgentPlugin, KnowledgeSnapshot } from './types'
import type { ControlMode } from './types/events'
import type { AgentRegistry, AgentGateway, KnowledgeStore, CheckpointStore, ControlModeManager } from './types/service-interfaces'
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
const voyageApiKey = process.env.VOYAGE_API_KEY
const voyageEmbeddingModel = (process.env.VOYAGE_EMBEDDING_MODEL ?? 'voyage-4-lite') as 'voyage-4-lite' | 'voyage-code-3' | 'voyage-4'
const anthropicApiKey = process.env.ANTHROPIC_API_KEY
const openAiApiKey = process.env.OPENAI_API_KEY
const defaultReviewModel = anthropicApiKey ? 'claude-sonnet-4-6' : 'gpt-5.2'
const coherenceReviewModel = process.env.COHERENCE_REVIEW_MODEL ?? defaultReviewModel
const enableLayer2 = process.env.ENABLE_LAYER2 === 'true' || Boolean(anthropicApiKey || openAiApiKey)
const enableLayer1c = process.env.ENABLE_LAYER1C === 'true'
const layer1cScanIntervalTicks = Number(process.env.LAYER1C_SCAN_INTERVAL_TICKS ?? 300)
const layer1cMaxCorpusTokens = Number(process.env.LAYER1C_MAX_CORPUS_TOKENS ?? 200_000)
const layer1cModel = process.env.LAYER1C_MODEL ?? coherenceReviewModel
const tokenTtlMs = Number(process.env.TOKEN_TTL_MS ?? 3_600_000)
const apiAuthEnabled = process.env.API_AUTH_ENABLED === 'true'
const apiAuthTtlMs = Number(process.env.API_AUTH_TTL_MS ?? 8 * 60 * 60 * 1000)
const apiAuthIssuer = process.env.API_AUTH_ISSUER ?? 'project-tab-api'
const apiAuthSecret = process.env.API_AUTH_SECRET

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Core services
  const tickService = new TickService({ mode: tickMode, intervalMs: tickIntervalMs })
  const eventBus = new EventBus(10_000, { maxQueuePerAgent: 500 })
  const classifier = new EventClassifier()

  // Token service
  const tokenService = new TokenService({ defaultTtlMs: tokenTtlMs })
  const userAuthService = apiAuthEnabled
    ? new AuthService({
      secret: apiAuthSecret ? new TextEncoder().encode(apiAuthSecret) : undefined,
      defaultTtlMs: apiAuthTtlMs,
      issuer: apiAuthIssuer,
    })
    : undefined

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
  const registry = new AgentRegistryImpl()

  // Knowledge store and coherence monitor
  const knowledgeStoreImpl = new KnowledgeStoreImpl(dbPath)
  const coherenceMonitor = new CoherenceMonitor({
    enableLayer2,
    enableLayer1c,
    embeddingModel: voyageEmbeddingModel,
    layer2Model: coherenceReviewModel,
    layer1cScanIntervalTicks,
    layer1cMaxCorpusTokens,
    layer1cModel,
  })

  // Wire coherence monitor services
  const embeddingService = voyageApiKey
    ? new VoyageEmbeddingService({
      apiKey: voyageApiKey,
      model: voyageEmbeddingModel,
    })
    : new MockEmbeddingService()

  const reviewService = anthropicApiKey
    ? new LlmReviewService({
      provider: 'anthropic',
      apiKey: anthropicApiKey,
      model: coherenceReviewModel,
    })
    : openAiApiKey
      ? new LlmReviewService({
        provider: 'openai',
        apiKey: openAiApiKey,
        model: coherenceReviewModel,
      })
      : new MockCoherenceReviewService()

  coherenceMonitor.setEmbeddingService(embeddingService)
  coherenceMonitor.setReviewService(reviewService)
  if (reviewService instanceof LlmReviewService) {
    coherenceMonitor.setSweepService(reviewService)
  }
  coherenceMonitor.setArtifactContentProvider((artifactId) => {
    const artifact = knowledgeStoreImpl.getArtifact(artifactId)
    if (!artifact) return undefined

    const direct = knowledgeStoreImpl.getArtifactContent(artifact.agentId, artifactId)
    if (direct) return direct.content

    // Gap 2 fallback: if URI follows artifact://agentId/artifactId, resolve from content store.
    if (artifact.uri?.startsWith('artifact://')) {
      const trimmed = artifact.uri.slice('artifact://'.length)
      const [agentId, uriArtifactId] = trimmed.split('/', 2)
      if (agentId && uriArtifactId) {
        const fromUri = knowledgeStoreImpl.getArtifactContent(agentId, uriArtifactId)
        if (fromUri) return fromUri.content
      }
    }

    return undefined
  })
  coherenceMonitor.subscribeTo(tickService)

  const knowledgeStore: KnowledgeStore = {
    async getSnapshot(): Promise<KnowledgeSnapshot> {
      return knowledgeStoreImpl.getSnapshot(decisionQueue.listPending().map((q) => q.event))
    },
    async appendEvent(): Promise<void> {
      // Events are delivered via EventBus
    },
    appendAuditLog(entityType, entityId, action, callerAgentId, details) {
      knowledgeStoreImpl.appendAuditLog(entityType, entityId, action, callerAgentId, details)
    },
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
    onAgentCrash: (agentId) => {
      registry.removeHandle(agentId)
    },
  })
  plugins.set('openai', openaiPlugin)
  // eslint-disable-next-line no-console
  console.log(`[plugin] registered "openai" (local process: ${shimCommand} ${shimArgs.join(' ')})`)

  // Docker container plugin (conditional)
  const { volumeRecovery, docker: dockerClient } = await wireDockerPlugin({
    dockerEnabled: dockerEnabled as 'auto' | 'true' | 'false',
    dockerImage,
    plugins,
    backendUrl,
    generateToken,
    knowledgeStoreImpl,
  })

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
    snapshot: knowledgeStoreImpl.getSnapshot(decisionQueue.listPending().map((q) => q.event)),
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
    userAuthService,
    contextInjection,
    defaultPlugin,
    volumeRecovery: volumeRecovery ? {
      async recover(agentId: string, knownArtifacts: import('./types/events').ArtifactEvent[]) {
        return volumeRecovery.recover(agentId, knownArtifacts)
      },
    } : undefined,
    knowledgeStoreImpl,
  })

  const server = createServer(app as any)
  attachWebSocketUpgrade(server, wsHub)

  // ── Event bus subscriptions ─────────────────────────────────────────

  wireEventHandlers({
    eventBus,
    knowledgeStore: knowledgeStoreImpl,
    classifier,
    wsHub,
    decisionQueue,
    tickService,
    registry,
    gateway,
    checkpointStore,
    coherenceMonitor,
    trustEngine,
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

  // ── Startup volume recovery scan ──────────────────────────────────

  if (volumeRecovery && dockerClient) {
    // Run asynchronously — don't block server startup
    runStartupVolumeRecovery({
      volumeRecovery,
      docker: dockerClient,
      knowledgeStoreImpl,
      registry,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[volume-recovery] startup scan error:', err instanceof Error ? err.message : String(err))
    })
  }

  // ── Graceful shutdown ───────────────────────────────────────────────

  setupShutdown(server, tickService, contextInjection, openaiPlugin, knowledgeStoreImpl, registry, gateway)
}

// ── Graceful shutdown ─────────────────────────────────────────────────────

function setupShutdown(
  server: Server,
  tickService: TickService,
  contextInjection: ContextInjectionService,
  localPlugin: LocalProcessPlugin,
  knowledgeStore: KnowledgeStoreImpl,
  registry: AgentRegistry,
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
