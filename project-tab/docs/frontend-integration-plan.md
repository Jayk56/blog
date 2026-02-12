# Frontend-Backend Integration Plan

## Overview

The project-tab frontend currently runs entirely on mock data: five scenario datasets loaded into a `useReducer` + React Context state engine. The backend (project-tab/server/) provides a real API surface with REST routes, a WebSocket hub, and services for agents, decisions, trust, coherence, artifacts, brake, and control mode. This document maps the path from mock-powered prototype to live-backend integration.

---

## 1. Type System Gap Analysis

The frontend and backend have **independent type systems** that overlap conceptually but diverge structurally. Integration requires a shared contract or an adapter layer.

### Key Divergences

| Concept | Frontend (`src/types/`) | Backend (`server/src/types/`) | Gap |
|---------|------------------------|-------------------------------|-----|
| **Severity** | `'critical' \| 'high' \| 'medium' \| 'low' \| 'info'` | `'warning' \| 'low' \| 'medium' \| 'high' \| 'critical'` | Frontend has `info`, backend has `warning` |
| **BlastRadius** | Object: `{ artifactCount, workstreamCount, agentCount, magnitude }` | String enum: `'trivial' \| 'small' \| 'medium' \| 'large' \| 'unknown'` | Completely different shape |
| **ActionKind** | `'approve' \| 'reject' \| 'defer' \| 'delegate' \| 'override'` | `'create' \| 'update' \| 'delete' \| 'review' \| 'deploy'` | Different semantic domains |
| **DecisionItem** | Rich object with `options[]`, `attentionScore`, `resolved`, `resolution` | `DecisionEvent` (option or tool_approval subtypes) | Backend decisions are events; frontend has a richer resolved/unresolved model |
| **CoherenceIssue** | Full lifecycle: `detected \| confirmed \| in_progress \| resolved \| accepted \| dismissed` | `CoherenceEvent` with `category: 'contradiction' \| 'duplication' \| 'gap' \| 'dependency_violation'` | Backend is event-based; frontend tracks lifecycle |
| **Artifact** | `Artifact` with `qualityScore`, `provenance`, `status` | `ArtifactSummary` (compact: id/name/kind/status/workstream) | Frontend is richer; backend snapshots are compact |
| **TrustProfile** | Full trajectory sparkline data + scoreByDomain | `{ agentId, score }` pairs | Backend only tracks current score; frontend wants history |
| **Agent** | `Agent` in `Project.agents[]` with name/role/trustScore/active | `AgentHandle` with pluginName/status/sessionId | Different abstraction level |
| **ControlConfig** | `topology[]`, `checkpoints[]`, `bias`, `pendingRecommendations[]` | Only `ControlMode` string | Backend has minimal control; frontend has rich config |
| **Resolution** | `DecisionResolution` with `chosenOptionId`, `actionKind`, `rationale`, `resolvedAtTick` | `Resolution` union: `OptionDecisionResolution \| ToolApprovalResolution` | Backend adds tool_approval; frontend tracks tick |

### Recommendation

Create a **shared types package** at `project-tab/shared/types/` that both sides import, OR (more pragmatically for now) create an **adapter layer** in the frontend API client that maps backend responses to frontend types. The adapter approach is recommended because:

1. The frontend type system is richer and designed for UI rendering
2. The backend type system is designed for runtime agent coordination
3. Forcing both to share types would constrain both sides

---

## 2. Action-to-API Mapping

Each `ProjectAction` in the frontend reducer maps to zero or more backend API calls. Some actions remain local-only (UI state), some become API calls with optimistic updates, and some are replaced entirely by server-pushed events.

| Frontend Action | Backend API | Method | Notes |
|----------------|-------------|--------|-------|
| `load-scenario` | **None** (remove) | - | Replace with initial state from WS `state_sync` message on connect |
| `advance-tick` | `POST /api/tick/advance` | `{ steps: 1 }` | Only in manual tick mode. Server broadcasts updated state. |
| `resolve-decision` | `POST /api/decisions/:id/resolve` | `{ resolution: { type: 'option', chosenOptionId, rationale, actionKind } }` | Server broadcasts `decision_resolved` to all clients |
| `resolve-issue` | No direct endpoint yet | - | **Gap**: Backend has no coherence issue resolution endpoint. Needs new `PATCH /api/coherence/:id` route. |
| `set-mode` | `PUT /api/control-mode` | `{ controlMode }` | Server broadcasts `state_sync` with updated mode |
| `set-bias` | No endpoint | - | **Gap**: Backend has no throughput/quality bias concept. Keep as local-only UI state for now. |
| `emergency-brake` | `POST /api/brake` | `{ scope: { type: 'all' }, reason, behavior: 'pause', initiatedBy }` | Server broadcasts `brake` message. Release via `POST /api/brake/release`. |
| `inject-context` | `PATCH /api/agents/:id/brief` | Send as brief update per agent | Requires iterating active agents. Consider a new bulk endpoint. |
| `reverse-decision` | No endpoint | - | **Gap**: Backend has no decision reversal concept. Needs new `POST /api/decisions/:id/reverse` route. |
| `retroactive-review` | No endpoint | - | **Gap**: Keep as local-only for now; future backend route. |
| `toggle-checkpoint` | No endpoint | - | **Gap**: Backend has no checkpoint toggle concept. Keep local. |
| `accept-recommendation` | `PUT /api/control-mode` | Apply the recommended mode | Combine with local recommendation status update |
| `reject-recommendation` | **None** (local only) | - | Just updates local recommendation status |
| `toggle-auto-simulate` | **None** (local only) | - | UI-only flag; could drive tick service mode in future |

### New Backend Routes Needed

1. `PATCH /api/coherence/:id` -- Update coherence issue status
2. `POST /api/decisions/:id/reverse` -- Reverse a previously resolved decision
3. `POST /api/context/inject` -- Bulk context injection to all agents (convenience)

---

## 3. WebSocket Subscription Model

### Backend Messages (server -> frontend)

The `WebSocketHub` broadcasts these `FrontendMessage` types:

| Message Type | When Sent | Contains |
|-------------|-----------|----------|
| `state_sync` | On initial WS connect | Full `KnowledgeSnapshot`, `activeAgents`, `trustScores`, `controlMode` |
| `event` | On every classified agent event | `workspace` target, `secondaryWorkspaces`, full `EventEnvelope` |
| `trust_update` | When a decision resolution changes trust | `agentId`, `previousScore`, `newScore`, `delta`, `reason` |
| `decision_resolved` | When a decision is resolved via API | `decisionId`, `resolution`, `agentId` |
| `brake` | When emergency brake is applied | `BrakeAction`, `affectedAgentIds` |

### Frontend Consumption Design

```
WebSocketService (singleton)
  |
  |-- on connect: receive state_sync -> hydrate ProjectState
  |-- on message: classify and dispatch to React state
  |
  +-- EventEmitter pattern with typed listeners:
        onStateSync(handler)
        onEvent(handler)       // workspace-scoped events
        onTrustUpdate(handler)
        onDecisionResolved(handler)
        onBrake(handler)
        onDisconnect(handler)
        onReconnect(handler)
```

**Connection lifecycle:**
1. Connect to `ws://localhost:3001` (or configured URL)
2. Receive `state_sync` -- populate initial ProjectState
3. Listen for incremental updates -- merge into state
4. On disconnect: show banner, attempt reconnect with exponential backoff + jitter
5. On reconnect: receive fresh `state_sync` to re-sync

**Mapping WS messages to state updates:**

| WS Message | State Update |
|-----------|-------------|
| `state_sync` | Replace `project`, `decisions`, `coherenceIssues`, `artifacts`, `trustProfiles` from snapshot data. Adapt backend compact types to rich frontend types. |
| `event` (decision_created) | Append new `DecisionItem` to `state.decisions` |
| `event` (artifact_produced/updated) | Upsert in `state.artifacts` |
| `event` (coherence_detected/resolved) | Upsert in `state.coherenceIssues` |
| `event` (status/lifecycle/progress) | Append to `state.timeline`, update agent status |
| `trust_update` | Update matching `TrustProfile` score + append trajectory point |
| `decision_resolved` | Mark decision as resolved, append to decisionLog |
| `brake` | Set `project.emergencyBrakeEngaged`, update agent statuses |

---

## 4. State Management Approach: Hybrid

**Recommendation: Keep `useReducer` for local/optimistic state, layer server state on top.**

### Why Hybrid

- The existing reducer is well-structured and handles derived value recomputation (metrics, briefing, topology)
- Optimistic updates give instant UI feedback for human actions
- Server state provides the ground truth and handles multi-client sync
- Keeping the reducer means minimal changes to existing workspace components

### Architecture

```
[WebSocket]          [REST API Client]
     |                      |
     v                      v
[WebSocketService] ---> [State Adapter] ---> dispatch(action)
                              |
                              v
                    [projectReducer (existing)]
                              |
                              v
                    [ProjectState (existing)]
                              |
                              v
                    [ProjectContext (existing)]
                              |
                              v
                    [Workspace Components (existing)]
```

### New Actions for Server-Pushed State

Add new action types to the `ProjectAction` union for server-originated updates:

```typescript
// New actions for server-pushed state
interface ServerStateSyncAction {
  type: 'server-state-sync';
  snapshot: KnowledgeSnapshot;  // backend type
  activeAgents: AgentHandle[];
  trustScores: Array<{ agentId: string; score: number }>;
  controlMode: ControlMode;
}

interface ServerEventAction {
  type: 'server-event';
  envelope: EventEnvelope;
  workspace: string;
}

interface ServerTrustUpdateAction {
  type: 'server-trust-update';
  agentId: string;
  previousScore: number;
  newScore: number;
  delta: number;
  reason: string;
}

interface ServerDecisionResolvedAction {
  type: 'server-decision-resolved';
  decisionId: string;
  resolution: Resolution;
  agentId: string;
}

interface ServerBrakeAction {
  type: 'server-brake';
  action: BrakeAction;
  affectedAgentIds: string[];
}
```

### Optimistic Update Pattern

For user actions that call the API:

1. **Dispatch optimistic action** to reducer immediately (instant UI feedback)
2. **Call REST API** in parallel
3. **On success**: No-op (state already correct) or update with server confirmation
4. **On failure**: Dispatch rollback action to revert optimistic change, show error toast

Example for `resolve-decision`:
```typescript
// 1. Optimistic local update
dispatch({ type: 'resolve-decision', decisionId, chosenOptionId, actionKind, rationale });

// 2. API call
try {
  await api.resolveDecision(decisionId, { type: 'option', chosenOptionId, rationale, actionKind });
  // Server will broadcast decision_resolved to all clients
} catch (err) {
  // 3. Rollback
  dispatch({ type: 'rollback-resolve-decision', decisionId });
  showError('Failed to resolve decision');
}
```

---

## 5. API Client Module

Create `src/services/api-client.ts` with typed methods for all endpoints.

```typescript
// src/services/api-client.ts

export interface ApiClientConfig {
  baseUrl: string;  // e.g. 'http://localhost:3001/api'
}

export interface ApiClient {
  // Health
  getHealth(): Promise<{ status: string; tick: number }>;

  // Agents
  listAgents(): Promise<AgentHandle[]>;
  getAgent(id: string): Promise<AgentHandle>;
  spawnAgent(brief: AgentBrief): Promise<AgentHandle>;
  killAgent(id: string, opts: { grace: boolean; graceTimeoutMs?: number }): Promise<KillResult>;
  pauseAgent(id: string): Promise<void>;
  resumeAgent(id: string): Promise<void>;
  updateAgentBrief(id: string, changes: Partial<AgentBrief>): Promise<void>;

  // Checkpoints
  getCheckpoints(agentId: string): Promise<StoredCheckpoint[]>;
  getLatestCheckpoint(agentId: string): Promise<StoredCheckpoint | null>;

  // Decisions
  listPendingDecisions(): Promise<QueuedDecision[]>;
  resolveDecision(id: string, resolution: Resolution): Promise<void>;

  // Artifacts & Coherence
  listArtifacts(): Promise<ArtifactSummary[]>;
  getArtifact(id: string): Promise<ArtifactSummary>;
  listCoherenceIssues(): Promise<CoherenceIssueSummary[]>;

  // Control
  getControlMode(): Promise<ControlMode>;
  setControlMode(mode: ControlMode): Promise<void>;

  // Trust
  getAgentTrust(agentId: string): Promise<{ score: number; config: TrustConfig }>;

  // Tick
  advanceTick(steps?: number): Promise<{ tick: number }>;

  // Brake
  engageBrake(action: BrakeAction): Promise<{ affectedAgentIds: string[] }>;
  releaseBrake(): Promise<{ resumedAgentIds: string[]; failedAgentIds: string[] }>;
}
```

Implementation should use `fetch` (no heavy HTTP library needed) with:
- Consistent error handling (throw typed errors)
- Request/response logging in development
- Base URL from environment variable or config

---

## 6. WebSocket Service

Create `src/services/ws-service.ts` as a singleton connection manager.

```typescript
// src/services/ws-service.ts

export interface WebSocketServiceConfig {
  url: string;  // e.g. 'ws://localhost:3001'
  reconnectBaseMs?: number;    // default 1000
  reconnectMaxMs?: number;     // default 30000
  heartbeatIntervalMs?: number; // default 30000
}

export interface WebSocketService {
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;

  // Typed event handlers
  onStateSync(handler: (msg: StateSyncMessage) => void): () => void;
  onEvent(handler: (msg: WorkspaceEventMessage) => void): () => void;
  onTrustUpdate(handler: (msg: TrustUpdateMessage) => void): () => void;
  onDecisionResolved(handler: (msg: DecisionResolvedMessage) => void): () => void;
  onBrake(handler: (msg: BrakeMessage) => void): () => void;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
}
```

The service owns reconnection logic. All `on*` methods return unsubscribe functions for use in React `useEffect` cleanup.

---

## 7. State Adapter Layer

Create `src/services/state-adapter.ts` to map between backend and frontend types.

Key mapping functions:

```typescript
// Backend KnowledgeSnapshot -> Frontend ProjectState (partial)
function adaptStateSyncToState(msg: StateSyncMessage): Partial<ProjectState>;

// Backend EventEnvelope -> Frontend TimelineEvent
function adaptEnvelopeToTimelineEvent(envelope: EventEnvelope): TimelineEvent;

// Backend DecisionEvent -> Frontend DecisionItem
function adaptDecisionEventToItem(event: DecisionEvent): DecisionItem;

// Backend ArtifactSummary -> Frontend Artifact (with defaults for missing fields)
function adaptArtifactSummary(summary: ArtifactSummary): Artifact;

// Backend AgentHandle -> Frontend Agent
function adaptAgentHandle(handle: AgentHandle, trustScore?: number): Agent;

// Frontend Resolution -> Backend Resolution (for API calls)
function adaptFrontendResolution(
  chosenOptionId: string,
  actionKind: string,
  rationale: string
): Resolution;
```

The adapter handles all type mismatches from section 1 (Severity enum differences, BlastRadius shape differences, etc.) and fills in defaults for fields the backend doesn't provide (e.g., trust trajectory history, attention scores).

---

## 8. Component Change Impact

### Minimal Changes (consume context as before)

These components consume `useProject()` / `useProjectState()` and don't need structural changes -- they'll automatically receive server-pushed state through the existing context:

- **BriefingWorkspace** -- reads `state.briefing`, `state.timeline`, `state.metrics`
- **MapWorkspace / KnowledgeMap / CoherenceMap** -- reads `state.coherenceIssues`, `state.artifacts`, `state.project.workstreams`
- **VitalStrip** -- reads `state.metrics`, `state.project`
- **NarrativeBriefing / ActivityFeed / ActionSummary** -- reads briefing text and timeline

### Dispatch Changes (actions now hit API too)

These components dispatch actions that must now also call the API:

| Component | Current Dispatch | New Behavior |
|-----------|-----------------|-------------|
| **QueueWorkspace / DecisionDetail** | `dispatch({ type: 'resolve-decision', ... })` | Call `api.resolveDecision()` + optimistic dispatch |
| **ControlsWorkspace / ModeSelector** | `dispatch({ type: 'set-mode', mode })` | Call `api.setControlMode()` + optimistic dispatch |
| **ControlsWorkspace / QualityDial** | `dispatch({ type: 'set-bias', bias })` | Keep local-only (no backend equivalent) |
| **ControlsWorkspace (brake button)** | `dispatch({ type: 'emergency-brake', engaged })` | Call `api.engageBrake()` or `api.releaseBrake()` |
| **BriefEditorWorkspace** | `dispatch({ type: 'inject-context', context })` | Call `api.updateAgentBrief()` per agent |
| **Shell / VitalStrip** | `dispatch({ type: 'advance-tick' })` | Call `api.advanceTick()` |
| **DecisionLog** | `dispatch({ type: 'reverse-decision', ... })` | Future: call backend reversal endpoint |

### New Components Needed

1. **ConnectionStatus** -- small indicator (green/amber/red) showing WS connection state. Place in VitalStrip.
2. **AgentList** -- render real agents from `AgentHandle[]` instead of mock scenario agents. Consider adding to Briefing or Controls workspace.

### Removed/Changed

- **Scenario switcher** in VitalStrip -- no longer needed once connected to real backend. Could be preserved as a demo/debug mode toggle.

---

## 9. ProjectProvider Changes

The `ProjectProvider` needs to be the integration point where the WS service and API client are wired into the reducer.

```typescript
// Updated ProjectProvider sketch
export default function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialState);
  const wsService = useRef<WebSocketService>(null);
  const apiClient = useRef<ApiClient>(null);

  useEffect(() => {
    // Initialize API client
    apiClient.current = createApiClient({
      baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
    });

    // Initialize WebSocket
    wsService.current = createWebSocketService({
      url: import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
    });

    // Wire WS messages to dispatch
    const unsubs = [
      wsService.current.onStateSync((msg) => {
        dispatch({ type: 'server-state-sync', ...msg });
      }),
      wsService.current.onEvent((msg) => {
        dispatch({ type: 'server-event', envelope: msg.envelope, workspace: msg.workspace });
      }),
      wsService.current.onTrustUpdate((msg) => {
        dispatch({ type: 'server-trust-update', ...msg });
      }),
      wsService.current.onDecisionResolved((msg) => {
        dispatch({ type: 'server-decision-resolved', ...msg });
      }),
      wsService.current.onBrake((msg) => {
        dispatch({ type: 'server-brake', action: msg.action, affectedAgentIds: msg.affectedAgentIds });
      }),
    ];

    wsService.current.connect();

    return () => {
      unsubs.forEach(fn => fn());
      wsService.current?.disconnect();
    };
  }, []);

  // Expose api client through context for components that dispatch + call API
  return (
    <ProjectContext value={{ state, dispatch, api: apiClient.current }}>
      {children}
    </ProjectContext>
  );
}
```

The `ProjectContextValue` type expands to include the API client:

```typescript
export interface ProjectContextValue {
  state: ProjectState;
  dispatch: React.Dispatch<ProjectAction>;
  api: ApiClient | null;  // null during initialization
}
```

---

## 10. File Structure

New files to create:

```
project-tab/src/
  services/
    api-client.ts          # REST API client with typed methods
    ws-service.ts          # WebSocket connection manager
    state-adapter.ts       # Backend <-> frontend type mapping
    index.ts               # Barrel export
  types/
    server.ts              # Backend message types re-exported for frontend use
```

Modified files:

```
project-tab/src/
  types/state.ts           # Add server-* action types to ProjectAction union
  lib/reducer.ts           # Add handlers for server-* actions
  lib/context.ts           # Add api to ProjectContextValue
  components/
    ProjectProvider.tsx     # Wire WS + API into reducer
    spine/VitalStrip.tsx    # Add ConnectionStatus, optionally keep scenario switcher for demo mode
```

---

## 11. Implementation Phases

### Phase A: Foundation (API Client + WS Service + State Adapter)

Create the three service files and the server type re-exports. This is pure infrastructure with no UI changes. Testable in isolation.

Deliverables:
- `src/services/api-client.ts` -- all typed methods, fetch-based
- `src/services/ws-service.ts` -- connect/reconnect/typed handlers
- `src/services/state-adapter.ts` -- all mapping functions
- `src/types/server.ts` -- backend message types for frontend consumption

### Phase B: State Wiring (Reducer + Provider + New Actions)

Wire the services into the existing state system. Add server-* actions to the reducer. Update ProjectProvider to manage WS lifecycle.

Deliverables:
- Updated `src/types/state.ts` with server action types
- Updated `src/lib/reducer.ts` with server action handlers
- Updated `src/lib/context.ts` with API client in context
- Updated `src/components/ProjectProvider.tsx` with WS + API wiring

### Phase C: Component Updates

Update workspace components to call API alongside dispatch. Add ConnectionStatus indicator. Support both mock mode (scenario data) and live mode (backend connection).

Deliverables:
- Updated dispatch sites in Queue, Controls, BriefEditor, VitalStrip
- ConnectionStatus component in VitalStrip
- Dual-mode support: `VITE_MODE=mock` uses scenarios, `VITE_MODE=live` uses backend

---

## 12. Open Questions

1. **Briefing generation**: Currently computed client-side by `buildBriefing()`. Should this move to the backend, or continue as a client-side derived value from server state?

2. **Metrics computation**: Currently `computeMetrics()` runs in the reducer. Same question -- server-side or keep as derived?

3. **Topology computation**: `getTopologyPoints()` runs client-side. Backend has minimal control config. Keep client-side.

4. **Decision attention scoring**: `attentionScore` is a frontend concept. Backend `DecisionEvent` has `severity` + `confidence` but no composite score. Keep scoring client-side.

5. **Trust trajectory history**: Backend only stores current score per agent. Frontend wants sparkline trajectory data. Options: (a) accumulate trajectory client-side from `trust_update` messages, (b) add trajectory storage to backend, (c) derive from timeline events.

6. **Mock mode preservation**: The five scenario datasets are valuable for demos and development. Recommend keeping them accessible via a `?mock=true` query param or env var, with the real backend being the default.
