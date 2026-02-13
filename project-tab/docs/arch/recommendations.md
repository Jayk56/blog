# Architecture Recommendations (Module-by-Module + Regrouping)

## Scope and Method
- Modules reviewed: `core`, `auth`, `routes`, `registry`, `gateway`, `intelligence`.
- For each module, analysis was done on code first, then compared against the corresponding file in `docs/architecture/*_recommendations.md`.
- This document consolidates exports, internal mechanics, concrete improvements, and proposed better system groupings.

## Core
### Exports
- `server/src/app.ts`: `createApp`, `attachWebSocketUpgrade`, `AppDeps`.
- `server/src/bus.ts`: `EventBus` and related types (`EventBusFilter`, `EventBusHandler`, `SequenceGapWarning`, `EventBusMetrics`, `BackpressureConfig`).
- `server/src/classifier.ts`: `EventClassifier`, `Workspace`, `ClassifiedEvent`.
- `server/src/tick.ts`: `TickService` and tick types.
- `server/src/ws-hub.ts`: `WebSocketHub`, `StateSnapshotProvider`.
- `server/src/index.ts`: bootstrap and runtime wiring helpers.

### Internal Mechanics
- `server/src/index.ts` is the orchestration center for service creation, plugin wiring, event subscriptions, recovery, and shutdown.
- `EventBus` is the in-memory backbone for fan-out, dedupe, sequence checking, and backpressure.
- `WebSocketHub` + `EventClassifier` convert runtime events to workspace-targeted stream messages and state-sync payloads.
- `TickService` drives tick-based subsystems (`trust`, `decision queue`, `context injection`, coherence cadence).

### Improvements
- Extract event subscription logic from `server/src/index.ts` into a dedicated `core/event-handlers` module.
- Move Docker wiring/recovery helpers out of bootstrap into dedicated modules to keep entrypoint thin.
- Reduce schema/type duplication between `server/src/types/events.ts` and `server/src/validation/schemas.ts` by adopting one source of truth.
- Split oversized type files (especially `server/src/types/brief.ts`) into domain-specific type modules.

### Doc Alignment
- Strong alignment with `docs/architecture/core_recommendations.md`: concentration in bootstrap, schema duplication risk, and type file bloat were all confirmed.

## Auth
### Exports
- `server/src/auth/index.ts` re-exports `AuthService`, middleware helpers, and auth types.
- `server/src/auth/auth-service.ts`: token issue/validate/refresh and auth claims types.
- `server/src/auth/middleware.ts`: `createAuthMiddleware`, `getRequestAuth`, request/user auth types.

### Internal Mechanics
- `AuthService` signs/verifies user JWTs and validates claim shape.
- Middleware extracts Bearer token, validates claims, and attaches user auth context on request.
- Integration is primarily through route wiring in `server/src/routes/index.ts` and startup in `server/src/index.ts`.

### Improvements
- Unify JWT primitives with `server/src/gateway/token-service.ts` via shared JWT service layer.
- Consolidate jose error classification to avoid duplicate 401/500 logic.
- Prefer Express declaration merging for `req.auth` over repeated intersection/cast patterns.
- Add role/scopes enforcement middleware where authorization is required, not just authentication.

### Doc Alignment
- Strong alignment with `docs/architecture/auth_recommendations.md`: duplication with gateway token logic and request typing ergonomics remain key refactors.

## Routes
### Exports
- `server/src/routes/index.ts`: `createApiRouter` and shared route dependency interfaces.
- Route factories: `createAgentsRouter`, `createArtifactsRouter`, `createAuthRouter`, `createBrakeRouter`, `createControlModeRouter`, `createDecisionsRouter`, `createEventsRouter`, `createQuarantineRouter`, `createTickRouter`, `createTokenRouter`, `createTrustRouter`.
- Utility helpers in `server/src/routes/utils.ts`.

### Internal Mechanics
- `createApiRouter` composes all routers and applies middleware layering for `/api`.
- High-coupling handlers (`agents`, `brake`, `decisions`) coordinate gateway, registry, trust engine, checkpoints, queue, and WS broadcasts.
- Read-focused handlers (`artifacts`, `events`, `trust`, `quarantine`) are mostly thin delegators.
- `control` route performs mode updates and emits sync events.

### Improvements
- Move service interfaces out of `server/src/routes/index.ts` into shared types (`server/src/types/service-interfaces.ts`).
- Split monolithic `ApiRouteDeps` into route-specific dependencies.
- Use real knowledge snapshots in control-mode `state_sync` broadcasts.
- Remove unsafe `as unknown as` casts in route payload flows by aligning schema and static types.
- Move decision-to-trust mapping logic into trust domain instead of route layer.
- Remove unused route utility code (`notImplemented`).

### Doc Alignment
- Strong alignment with `docs/architecture/routes_recommendations.md`: dependency boundary inversion and oversized shared deps are still the biggest issues.

## Registry
### Exports
- `server/src/registry/agent-registry.ts`: `AgentRegistry`, `RegisteredAgent`.
- Routes consume an interface from `server/src/routes/index.ts` via an adapter in `server/src/index.ts`.

### Internal Mechanics
- Concrete registry stores agent handles in an internal `Map`.
- Entrypoint builds an adapter layer to map registry methods to route-facing interface shape.
- Used by lifecycle event handling, context injection gating, recovery checks, and shutdown orchestration.

### Improvements
- Align concrete `AgentRegistry` API with shared interface directly and remove index-level adapter.
- Move service interfaces to shared types so `intelligence` and `routes` do not depend on each other for contracts.
- Remove currently-unused sandbox metadata tracking from registry if gateway owns sandbox details.
- Remove dead/unused API surface (`killAll`) where shutdown path already orchestrates explicit kills.

### Doc Alignment
- Strong alignment with `docs/architecture/registry_recommendations.md`: API mismatch and adapter churn are validated by current code paths.

## Gateway
### Exports
- Process/container lifecycle: `ChildProcessManager`, `ContainerOrchestrator`.
- Plugins: `LocalProcessPlugin`, `ContainerPlugin`, `LocalHttpPlugin`.
- Integration services: `EventStreamClient`, `MCPProvisioner`, `VolumeRecoveryService`, `TokenService`.

### Internal Mechanics
- `LocalProcessPlugin` and `ContainerPlugin` implement similar shim RPC lifecycle with different transport runtimes.
- `EventStreamClient` validates and forwards shim events into `EventBus`.
- `MCPProvisioner` resolves tool/server provisioning rules for runtime environments.
- `VolumeRecoveryService` handles orphaned artifact recovery from Docker volumes.
- `TokenService` handles sandbox JWTs and supports token renewal route flows.

### Improvements
- Introduce shared adapter HTTP client abstraction used by both local/container plugins.
- Extract shared port-pool/health-poll/reconnect utilities between process and container orchestrators.
- Unify JWT implementation primitives with auth module via shared generic JWT service.
- Decouple validation/quarantine concerns from `EventStreamClient` via injectable parser/validator callbacks.
- Simplify `VolumeRecoveryService` skip-path bookkeeping logic and mutation flow.

### Doc Alignment
- Strong alignment with `docs/architecture/gateway_recommendations.md`: transport duplication, JWT duplication, and boundary cleanup are still the main opportunities.

## Intelligence
### Exports
- `server/src/intelligence/index.ts` exports `TrustEngine`, `DecisionQueue`, `KnowledgeStore`, `CoherenceMonitor`, review/embedding helpers, and context/snapshot services.
- Additional exports in feature files for review interfaces, embeddings utilities/mocks, and queue/store/coherence types.

### Internal Mechanics
- Tick-driven intelligence loop: trust decay, decision timeouts, coherence scans, and injection scheduling.
- Coherence path: Layer 0/1/2 detection (`artifact` conflict, embedding similarity, review service confirmation).
- `KnowledgeStore` persists artifacts/events/issues/checkpoints/trust and composes snapshots.
- `ContextInjectionService` reacts to runtime signals, builds bounded snapshots, and pushes context to active agents via gateway.

### Improvements
- Remove test-oriented exports from production barrel (`Mock*`, deterministic vector test helpers).
- Decouple `KnowledgeStore.getSnapshot` from queue internals by accepting pre-shaped summaries.
- Introduce a narrow `ContextInjectionDeps` interface instead of importing broad route-defined contracts.
- Split `KnowledgeStore` into narrower domain interfaces (artifact/event/checkpoint/trust surfaces).
- Keep internal helpers like `isEmbeddable` private unless needed externally.

### Doc Alignment
- Strong alignment with `docs/architecture/intelligence_recommendations.md`: interface coupling and oversized public surface are accurately captured.

## Cross-Module Findings
- `server/src/index.ts` is overloaded with orchestration concerns and should delegate composition steps to dedicated modules.
- Service interface contracts are placed in `routes`, causing boundary inversion and avoidable coupling.
- JWT logic exists in both `auth` and `gateway` and should share a common implementation layer.
- Local/container gateway paths have high duplication in transport mechanics and HTTP adapter calls.
- Some module barrels leak test/mocks into production-facing API surfaces.

## Recommended Regrouping (Target Architecture)
### 1) `core/` (Runtime Kernel)
- `core/bootstrap`: startup sequencing, configuration loading, shutdown.
- `core/event`: `EventBus`, classifier, event-handler wiring.
- `core/transport`: Express app + WebSocket hub composition.
- `core/time`: tick primitives and tick orchestration hooks.

### 2) `platform/` (Execution + Provisioning)
- `platform/gateway/infrastructure`: process/container orchestration, event stream transport utilities.
- `platform/gateway/plugins`: local/container plugin adapters and shared shim HTTP client.
- `platform/provisioning`: MCP/tool provisioning and backend server mapping.
- `platform/recovery`: volume recovery and orphan cleanup workflows.

### 3) `identity/` (Authentication + Tokening)
- `identity/jwt`: shared generic JWT service and shared error classification helpers.
- `identity/user-auth`: user auth claims/service/middleware.
- `identity/sandbox-auth`: sandbox token claims/service for agent runtime.

### 4) `domain/agent-runtime/` (Operational Domain)
- `domain/registry`: handle registry and lifecycle state map.
- `domain/decisions`: queue policies and resolution contracts.
- `domain/trust`: trust scoring and trust outcome policies.
- `domain/coherence`: monitor/review/embedding pipeline.
- `domain/knowledge`: persistence store + domain snapshots.
- `domain/context-delivery`: context injection orchestration.

### 5) `interfaces/http/` (API Layer)
- Route handlers grouped by concern (`operations`, `observability`, `security`, `control`).
- Route factories consume narrow contracts from shared interfaces, not concrete classes.

### 6) `types/contracts/`
- Shared service interfaces and DTO contracts used by routes/intelligence/gateway.
- Validation-generated or validation-linked type strategy to prevent schema drift.

## Suggested Migration Sequence
1. Extract shared service interfaces to `server/src/types/service-interfaces.ts` and rewire imports.
2. Remove index-level registry adapter by aligning registry API to shared contract.
3. Extract event handler wiring from `server/src/index.ts` into `core/event-handlers`.
4. Create shared `identity/jwt` primitives and migrate both auth and gateway token services.
5. Introduce shared gateway adapter HTTP client + transport utilities.
6. Narrow barrels to production API surfaces only and keep test helpers module-local.

## Accepted Deferred Tech Debt (P3)
See `docs/arch/tech-debt-register.md` for the current accepted/deferred P3 architecture debt register, risk notes, and revisit triggers.
