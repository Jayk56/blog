import { Router } from 'express'

import type { TickService } from '../tick'
import type { EventBus } from '../bus'
import type { WebSocketHub } from '../ws-hub'
import type { AgentPlugin, AgentHandle, KnowledgeSnapshot, SerializedAgentState } from '../types'
import type { ArtifactEvent } from '../types/events'
import type { StoredCheckpoint, KnowledgeStore as KnowledgeStoreClass } from '../intelligence/knowledge-store'
import type { RecoveryResult } from '../gateway/volume-recovery'
import type { TrustEngine } from '../intelligence/trust-engine'
import type { DecisionQueue } from '../intelligence/decision-queue'
import { createAgentsRouter } from './agents'
import { createArtifactsRouter } from './artifacts'
import { createBrakeRouter } from './brake'
import { createControlModeRouter } from './control'
import { createDecisionsRouter } from './decisions'
import { createQuarantineRouter } from './quarantine'
import { createTickRouter } from './tick'
import { createTokenRouter } from './token'
import { createTrustRouter } from './trust'
import type { ControlMode } from '../types/events'
import type { TokenService } from '../gateway/token-service'

/** Agent registry interface used by routes. */
export interface AgentRegistry {
  getHandle(agentId: string): AgentHandle | null
  listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[]
  registerHandle(handle: AgentHandle): void
  updateHandle(agentId: string, updates: Partial<AgentHandle>): void
  removeHandle(agentId: string): void
}

/** Result returned from artifact upload. */
export interface ArtifactUploadResult {
  backendUri: string
  artifactId: string
  stored: boolean
}

/** Knowledge store interface used by routes. */
export interface KnowledgeStore {
  getSnapshot(workstream?: string): Promise<KnowledgeSnapshot>
  appendEvent(envelope: import('../types').EventEnvelope): Promise<void>
  storeArtifactContent?(agentId: string, artifactId: string, content: string, mimeType?: string): ArtifactUploadResult
}

/** Agent gateway interface used by routes. */
export interface AgentGateway {
  getPlugin(pluginName: string): AgentPlugin | undefined
  spawn(brief: import('../types').AgentBrief, pluginName: string): Promise<AgentHandle>
}

/** Checkpoint store interface used by routes. */
export interface CheckpointStore {
  storeCheckpoint(state: SerializedAgentState, decisionId?: string, maxPerAgent?: number): void
  getCheckpoints(agentId: string): StoredCheckpoint[]
  getLatestCheckpoint(agentId: string): StoredCheckpoint | undefined
  getCheckpointCount(agentId: string): number
  deleteCheckpoints(agentId: string): number
}

/** Control mode manager interface for routes. */
export interface ControlModeManager {
  getMode(): ControlMode
  setMode(mode: ControlMode): void
}

/** Dependencies required by API route modules. */
export interface ApiRouteDeps {
  tickService: TickService
  eventBus: EventBus
  wsHub: WebSocketHub
  trustEngine: TrustEngine
  decisionQueue: DecisionQueue
  registry: AgentRegistry
  knowledgeStore: KnowledgeStore
  checkpointStore: CheckpointStore
  gateway: AgentGateway
  controlMode: ControlModeManager
  tokenService?: TokenService
  contextInjection?: {
    registerAgent(brief: import('../types').AgentBrief): void
    removeAgent(id: string): void
    updateAgentBrief(agentId: string, changes: Partial<import('../types').AgentBrief>): void
    onBriefUpdated(agentId: string): Promise<boolean>
  }
  defaultPlugin?: string
  volumeRecovery?: {
    recover(agentId: string, knownArtifacts: ArtifactEvent[]): Promise<RecoveryResult>
  }
  /** Direct reference to the KnowledgeStore implementation for artifact queries. */
  knowledgeStoreImpl?: KnowledgeStoreClass
}

/**
 * Creates the root /api router and mounts all backend-core route groups.
 */
export function createApiRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', tick: deps.tickService.currentTick() })
  })

  router.use('/agents', createAgentsRouter(deps))
  router.use('/decisions', createDecisionsRouter(deps))
  router.use('/', createArtifactsRouter(deps))
  router.use('/brake', createBrakeRouter(deps))
  router.use('/control-mode', createControlModeRouter(deps))
  router.use('/trust', createTrustRouter(deps))
  router.use('/quarantine', createQuarantineRouter())
  router.use('/tick', createTickRouter({ tickService: deps.tickService }))

  if (deps.tokenService) {
    router.use('/token', createTokenRouter({ tokenService: deps.tokenService }))
  }

  return router
}
