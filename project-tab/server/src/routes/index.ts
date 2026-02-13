import { Router } from 'express'

import type { AuthService } from '../auth'
import { createAuthMiddleware } from '../auth'
import type { TickService } from '../tick'
import type { EventBus } from '../bus'
import type { WebSocketHub } from '../ws-hub'
import type { ArtifactEvent } from '../types/events'
import type { KnowledgeStore as KnowledgeStoreClass } from '../intelligence/knowledge-store'
import type { RecoveryResult } from '../gateway/volume-recovery'
import type { TrustEngine } from '../intelligence/trust-engine'
import type { DecisionQueue } from '../intelligence/decision-queue'
import type {
  AgentRegistry,
  KnowledgeStore,
  AgentGateway,
  CheckpointStore,
  ControlModeManager,
} from '../types/service-interfaces'
import { createAgentsRouter } from './agents'
import { createAuthRouter } from './auth'
import { createArtifactsRouter } from './artifacts'
import { createBrakeRouter } from './brake'
import { createControlModeRouter } from './control'
import { createDecisionsRouter } from './decisions'
import { createQuarantineRouter } from './quarantine'
import { createTickRouter } from './tick'
import { createTokenRouter } from './token'
import { createEventsRouter } from './events'
import { createTrustRouter } from './trust'
import type { TokenService } from '../gateway/token-service'
export type { AgentRegistry, ArtifactUploadResult, KnowledgeStore, AgentGateway, CheckpointStore, ControlModeManager } from '../types/service-interfaces'

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
  userAuthService?: AuthService
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

  if (deps.userAuthService) {
    router.use('/auth', createAuthRouter({ authService: deps.userAuthService }))
  }

  // Token renewal is sandbox-authenticated, so keep it available without
  // frontend user auth middleware.
  if (deps.tokenService) {
    router.use('/token', createTokenRouter({ tokenService: deps.tokenService }))
  }

  // Protect all operational API routes when user auth is enabled.
  if (deps.userAuthService) {
    router.use(createAuthMiddleware({ authService: deps.userAuthService }))
  }

  router.use('/agents', createAgentsRouter(deps))
  router.use('/decisions', createDecisionsRouter(deps))
  router.use('/', createArtifactsRouter(deps))
  router.use('/brake', createBrakeRouter(deps))
  router.use('/control-mode', createControlModeRouter(deps))
  router.use('/trust', createTrustRouter(deps))
  router.use('/events', createEventsRouter(deps))
  router.use('/quarantine', createQuarantineRouter())
  router.use('/tick', createTickRouter({ tickService: deps.tickService }))

  return router
}
