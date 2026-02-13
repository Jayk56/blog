# Routes Module Architecture Recommendations

## Module Profile

**Files**: `index.ts`, `agents.ts`, `decisions.ts`, `brake.ts`, `artifacts.ts`, `control.ts`, `trust.ts`, `events.ts`, `auth.ts`, `token.ts`, `quarantine.ts`, `tick.ts`, `utils.ts`

**Fan-out** (imports from other modules):
- `../auth` (AuthService, createAuthMiddleware, getRequestAuth)
- `../tick` (TickService)
- `../bus` (EventBus)
- `../ws-hub` (WebSocketHub)
- `../types/*` (AgentPlugin, AgentHandle, KnowledgeSnapshot, SerializedAgentState, AgentBrief, Resolution, DecisionEvent, ControlMode)
- `../intelligence/trust-engine` (TrustEngine, TrustOutcome)
- `../intelligence/decision-queue` (DecisionQueue)
- `../intelligence/knowledge-store` (StoredCheckpoint, KnowledgeStore as KnowledgeStoreClass, EventFilter)
- `../gateway/volume-recovery` (RecoveryResult)
- `../gateway/token-service` (TokenService)
- `../validation/schemas` (all request schemas)
- `../validation/quarantine` (getQuarantined, clearQuarantine)

**Fan-in** (other modules importing from routes):
- `src/app.ts` imports `createApiRouter`, `ApiRouteDeps`
- `src/index.ts` imports `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `CheckpointStore`, `ControlModeManager` interfaces
- `src/intelligence/context-injection-service.ts` imports `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `ControlModeManager` from routes

**Instability**: High. This module has the highest fan-out in the codebase (imports from 8+ other modules) and also serves as the interface definition point for service contracts consumed by intelligence.

**Export ratio**: High -- `index.ts` exports 6 interfaces, 1 type alias, and 1 factory function. Individual route files each export a single factory function.

## Depth Assessment

This module is appropriately **shallow**: route handlers are thin orchestration layers that validate input, delegate to services, and format responses. This is correct for a routes module.

- `agents.ts` (294 lines): Handles spawn, kill, pause, resume, brief update, checkpoint, volume recovery. This is the most complex route file -- it touches registry, gateway, trust, decisions, context injection, checkpoint store, knowledge store, and WS hub in a single handler (`POST /spawn`).
- `brake.ts` (136 lines): Clean with a helper function `resolveAffectedHandles()` for scope resolution.
- `decisions.ts` (117 lines): Well-structured with `mapResolutionToTrustOutcome()` helper.
- `artifacts.ts` (108 lines): Straightforward CRUD + upload.
- `control.ts` (53 lines): Simple get/set with broadcast.
- `trust.ts` (28 lines): Minimal -- single GET endpoint.
- `events.ts` (53 lines): Query-only with filter parsing.
- `auth.ts` (91 lines): Login, me, refresh.
- `token.ts` (69 lines): Token renewal for sandboxes.
- `quarantine.ts` (25 lines): GET/DELETE on quarantine store.
- `tick.ts` (43 lines): Manual tick advancement.
- `utils.ts` (28 lines): `parseBody()` and `notImplemented()`.

## Boundary Health

**Critical concern -- `routes/index.ts` as interface definition point**:

The `routes/index.ts` file defines 5 service interfaces (`AgentRegistry`, `KnowledgeStore`, `AgentGateway`, `CheckpointStore`, `ControlModeManager`) that are consumed not just by routes but by the intelligence module (`context-injection-service.ts`). This makes routes a _dependency root_ for interface contracts, which is architecturally backward -- routes should depend on service interfaces, not define them.

**Type leakage**:

1. `ApiRouteDeps` is a god-object with 14 fields (lines 73-98). It includes optional fields (`tokenService?`, `userAuthService?`, `contextInjection?`, `volumeRecovery?`, `knowledgeStoreImpl?`) that make the dependency graph unclear. Some route files only need 2-3 of these 14 fields.

2. `agents.ts` casts `body.brief as unknown as AgentBrief` (line 41) and `body as unknown as Partial<AgentBrief>` (line 181) -- these double-casts bypass the type system and suggest the Zod schema output type doesn't align with the TypeScript type.

3. `control.ts:29-47` constructs a fake snapshot inline for the broadcast message when control mode changes. This includes hardcoded empty arrays and `estimatedTokens: 0`. The correct approach would be to fetch the actual snapshot.

4. `decisions.ts:87-89` uses inline `import()` types for the function signature rather than proper imports.

## Co-Change Partners

**Expected co-change pairs**:
- `routes/index.ts` <-> all individual route files: `ApiRouteDeps` changes affect everything
- `routes/agents.ts` <-> `validation/schemas.ts`: new agent endpoints need schema updates
- `routes/decisions.ts` <-> `intelligence/trust-engine.ts`: trust outcome mapping logic

**Surprising co-change**:
- `routes/index.ts` <-> `intelligence/context-injection-service.ts`: interface definitions in routes are consumed by intelligence
- `routes/agents.ts` <-> 7 other services (registry, gateway, trust, decisions, ws-hub, context-injection, checkpoint-store): the spawn handler is a coordination bottleneck

## Specific Recommendations

### 1. Move service interface definitions to `types/service-interfaces.ts` (HIGH)

**Problem**: `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `CheckpointStore`, `ControlModeManager` are defined in `routes/index.ts` but consumed by both routes and intelligence modules. This creates a backward dependency where intelligence imports from routes.

**Fix**: Create `src/types/service-interfaces.ts` containing these 5 interfaces plus `ArtifactUploadResult`. Have `routes/index.ts` re-export them temporarily for backward compatibility. Update `intelligence/context-injection-service.ts` to import from `../types/service-interfaces` instead.

### 2. Split `ApiRouteDeps` into per-router dependency sets (HIGH)

**Problem**: `ApiRouteDeps` has 14 fields, but individual route modules only use subsets:
- `trust.ts` only needs `trustEngine`
- `tick.ts` only needs `tickService` (already has its own `TickRouteDeps`)
- `quarantine.ts` needs nothing from deps (already standalone)
- `token.ts` only needs `tokenService` (already has its own `TokenRouteDeps`)
- `auth.ts` only needs `authService` (already has its own `AuthRouteDeps`)

Only `agents.ts` and `brake.ts` need the majority of deps.

**Fix**: Define per-router deps interfaces:
- `AgentsRouterDeps` (registry, gateway, trustEngine, decisionQueue, tickService, wsHub, knowledgeStore, checkpointStore, contextInjection, volumeRecovery, knowledgeStoreImpl, defaultPlugin)
- `DecisionsRouterDeps` (decisionQueue, registry, gateway, trustEngine, tickService, wsHub)
- `BrakeRouterDeps` (registry, gateway, decisionQueue, wsHub, knowledgeStore, checkpointStore)
- Keep `ApiRouteDeps` as the union for `createApiRouter()`, but each sub-router factory explicitly declares what it needs.

### 3. Fix the double-cast pattern in agents.ts (MEDIUM)

**Problem**: `body.brief as unknown as AgentBrief` (line 41) and `body as unknown as Partial<AgentBrief>` (line 181) indicate the Zod-inferred type doesn't match the TypeScript `AgentBrief` interface.

**Fix**: Use `z.infer<typeof agentBriefSchema>` as the type for `body.brief` and verify it's structurally compatible with `AgentBrief`. If there's a mismatch (e.g., Zod produces `unknown` for the escalation predicate due to `z.lazy()`), fix the schema or add a narrowing function instead of `as unknown as`.

### 4. Fix control.ts fake snapshot construction (MEDIUM)

**Problem**: `control.ts:29-47` builds a StateSyncMessage with empty arrays and `estimatedTokens: 0` instead of fetching the actual snapshot. This means frontend clients receive incorrect state after a control mode change.

**Fix**: Await `deps.knowledgeStore.getSnapshot()` to get the real snapshot, matching the pattern used in `agents.ts:48`.

### 5. Extract mapResolutionToTrustOutcome to trust-engine (LOW)

**Problem**: `decisions.ts:87-117` defines `mapResolutionToTrustOutcome()` which maps Resolution + DecisionEvent to TrustOutcome. This is trust-engine domain logic living in the routes module.

**Fix**: Move this function to `intelligence/trust-engine.ts` as a static method or module-level function. The decisions route would import it from trust-engine instead of defining it locally.

### 6. Remove `notImplemented()` from utils.ts (LOW)

**Problem**: `utils.ts:22-28` exports `notImplemented()` which returns a 501 for "Wave 2" features. All Wave 2 features have been implemented -- this function is no longer called anywhere.

**Fix**: Delete `notImplemented()` and its JSDoc.
