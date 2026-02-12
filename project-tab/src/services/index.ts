/**
 * Barrel export for all service modules.
 */

// API Client
export { createApiClient, ApiError } from './api-client.js';
export type { ApiClient, ApiClientConfig } from './api-client.js';

// WebSocket Service
export { createWebSocketService } from './ws-service.js';
export type { WebSocketService, WebSocketServiceConfig } from './ws-service.js';

// State Adapter
export {
  adaptSeverity,
  adaptBlastRadius,
  adaptControlMode,
  adaptAgentHandle,
  adaptArtifactSummary,
  adaptCoherenceIssueSummary,
  adaptDecisionSummary,
  adaptOptionDecisionEvent,
  adaptWorkstreamSummary,
  adaptStateSyncToState,
  adaptEnvelopeToTimelineEvent,
  adaptFrontendResolution,
  adaptBrakeAction,
} from './state-adapter.js';
