import type { KnowledgeSnapshot } from './brief'
import type { ControlMode, EventEnvelope } from './events'
import type { AgentHandle } from './plugin'
import type { Resolution } from './resolution'

/** Emergency brake scope selector. */
export type BrakeScope =
  | { type: 'all' }
  | { type: 'agent'; agentId: string }
  | { type: 'workstream'; workstream: string }

/** Brake auto-release policy. */
export type BrakeReleaseCondition =
  | { type: 'manual' }
  | { type: 'timer'; releaseAfterMs: number }
  | { type: 'decision'; decisionId: string }

/** Brake command payload. */
export interface BrakeAction {
  scope: BrakeScope
  reason: string
  behavior: 'pause' | 'kill'
  initiatedBy: string
  timestamp: string
  releaseCondition?: BrakeReleaseCondition
}

/** Classified event message sent to frontend workspaces. */
export interface WorkspaceEventMessage {
  type: 'event'
  workspace: string
  secondaryWorkspaces: string[]
  envelope: EventEnvelope
}

/** Full state synchronization message sent on connect/reconnect. */
export interface StateSyncMessage {
  type: 'state_sync'
  snapshot: KnowledgeSnapshot
  activeAgents: AgentHandle[]
  trustScores: Array<{ agentId: string; score: number }>
  controlMode: ControlMode
}

/** Brake notification message. */
export interface BrakeMessage {
  type: 'brake'
  action: BrakeAction
  affectedAgentIds: string[]
}

/** Trust score delta message. */
export interface TrustUpdateMessage {
  type: 'trust_update'
  agentId: string
  previousScore: number
  newScore: number
  delta: number
  reason: string
}

/** Decision resolution fan-out message. */
export interface DecisionResolvedMessage {
  type: 'decision_resolved'
  decisionId: string
  resolution: Resolution
  agentId: string
}

/** Union of all frontend WebSocket messages. */
export type FrontendMessage =
  | WorkspaceEventMessage
  | StateSyncMessage
  | BrakeMessage
  | TrustUpdateMessage
  | DecisionResolvedMessage

/** Alias matching design doc naming. */
export type WebSocketMessage = FrontendMessage
