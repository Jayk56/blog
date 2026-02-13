# Core Module Architecture Recommendations

## Module Profile

**Files**: `bus.ts`, `ws-hub.ts`, `tick.ts`, `classifier.ts`, `app.ts`, `index.ts`, plus `types/` (6 files) and `validation/` (2 files)

### Core Services

**`bus.ts` (EventBus)** -- 293 lines
- Fan-out: `./types` (AgentEvent, EventEnvelope)
- Fan-in: `src/index.ts`, `src/intelligence/context-injection-service.ts`, `src/gateway/local-process-plugin.ts`, `src/gateway/event-stream-client.ts`
- Instability: Low. Consumed widely, depends only on types.

**`ws-hub.ts` (WebSocketHub)** -- 125 lines
- Fan-out: `ws`, `node:http`, `node:stream`, `./classifier` (ClassifiedEvent), `./types` (FrontendMessage, StateSyncMessage, WorkspaceEventMessage)
- Fan-in: `src/app.ts`, `src/routes/index.ts`, `src/index.ts`
- Instability: Low.

**`tick.ts` (TickService)** -- 101 lines
- Fan-out: None (zero imports from project modules)
- Fan-in: `src/intelligence/trust-engine.ts`, `src/intelligence/decision-queue.ts`, `src/intelligence/coherence-monitor.ts`, `src/intelligence/context-injection-service.ts`, `src/routes/tick.ts`, `src/routes/index.ts`, `src/index.ts`
- Instability: Very low. Pure leaf dependency consumed by 7 files.

**`classifier.ts` (EventClassifier)** -- 94 lines
- Fan-out: `./types` (EventEnvelope, GuardrailEvent, Severity)
- Fan-in: `src/ws-hub.ts`, `src/index.ts`
- Instability: Low.

**`app.ts`** -- 42 lines
- Fan-out: `express`, `cors`, `./ws-hub`, `./routes`
- Fan-in: `src/index.ts`
- Instability: Medium. Thin wiring file.

**`index.ts`** -- 630 lines
- Fan-out: Everything. Imports from 15+ internal modules.
- Fan-in: None (entry point).
- Instability: Maximum. This is the application bootstrap file.

### Types Module (`types/`)

**Files**: `index.ts`, `events.ts`, `brief.ts`, `plugin.ts`, `transport.ts`, `resolution.ts`, `messages.ts`

Combined ~630 lines of type definitions. No runtime logic. Zero internal fan-out (types only reference each other). Maximum fan-in -- consumed by every module in the codebase.

### Validation Module (`validation/`)

**Files**: `schemas.ts`, `quarantine.ts`

- `schemas.ts` (503 lines): Zod schemas for all event types, request bodies, and the agent brief. Imports only from `../types`.
- `quarantine.ts` (49 lines): In-memory quarantine store for malformed events. Imports from `../types` and `./schemas`.

## Depth Assessment

**Deep services** (good):
- `EventBus` (293 lines): Publish/subscribe, deduplication, sequence gap detection, per-agent backpressure with priority tiers. Substantial behavior behind `publish()`/`subscribe()`.
- `TickService` (101 lines): Clean abstraction -- manual vs wall-clock modes, monotonic increment, handler management.

**Shallow services** (appropriate):
- `WebSocketHub` (125 lines): Thin layer over `ws.WebSocketServer`. Heartbeat, broadcast, state sync on connect.
- `EventClassifier` (94 lines): Pure function wrapped in a class. Single `classify()` method with a switch statement.
- `app.ts` (42 lines): Express app factory. Appropriately thin.

**Concerning depth**:
- `index.ts` (630 lines): Bootstrap file with too many responsibilities. Contains service construction, adapter wiring, Docker plugin conditional loading, volume recovery scan, event bus subscription setup, shutdown handler, and 3 helper functions.
- `schemas.ts` (503 lines): Large file but structurally simple (Zod schema declarations). Every schema mirrors a type definition 1:1.

## Boundary Health

### Types Module

**Clean**: Types are pure interfaces/type aliases with no runtime code. They form the stable foundation of the architecture.

**Concern -- types/brief.ts is oversized**: At 250 lines, `brief.ts` defines 23 interfaces/types covering project briefs, MCP configs, secrets, guardrails, escalation, workspaces, session policy, context injection policy, snapshots, AND the `AgentBrief` type. This file mixes application-domain types (ProjectBrief, AgentBrief) with infrastructure types (MCPServerConfig, WorkspaceMount, SandboxCapability) and snapshot types (KnowledgeSnapshot, WorkstreamSummary).

### Validation Module

**Concern -- schemas.ts duplicates type structure**: Every type in `types/events.ts` has a corresponding Zod schema in `schemas.ts`. When a field is added to an event type, both files must be updated. There's no codegen or compile-time check to ensure they stay in sync.

### index.ts (Bootstrap)

**Concern -- too many responsibilities**: The bootstrap function handles:
1. Service construction (lines 47-124)
2. Registry adapter creation (lines 77-109)
3. Plugin registration (lines 146-177)
4. Docker plugin conditional loading (lines 179, 413-481)
5. Control mode manager (lines 183-187)
6. Context injection setup (lines 191-194)
7. WebSocket hub creation (lines 198-203)
8. App creation and server setup (lines 207-231)
9. Event bus subscription wiring (lines 236-373) -- 137 lines of subscription handlers
10. Startup volume recovery (lines 392-398)
11. Shutdown handler (lines 402, 557-621)

## Co-Change Partners

**Expected**:
- `types/events.ts` <-> `validation/schemas.ts`: Every event type change requires schema update
- `bus.ts` <-> `index.ts`: Event bus subscription handlers live in index.ts
- `app.ts` <-> `routes/index.ts`: App creation depends on route factory

**Surprising**:
- `index.ts` co-changes with everything: Any new service, route, or plugin requires bootstrap changes
- `types/brief.ts` <-> `validation/schemas.ts`: The `agentBriefSchema` (90 lines) mirrors `AgentBrief` (28 fields)

## Specific Recommendations

### 1. Extract event bus subscription handlers from index.ts (HIGH)

**Problem**: `index.ts:236-373` contains 137 lines of event bus subscription handlers for decision enqueue, artifact storage, coherence checking, lifecycle tracking, trust updates for completion events, and trust updates for error events. These are application logic, not bootstrap wiring.

**Fix**: Create `src/event-handlers.ts` that exports a `wireEventHandlers(deps)` function. Each subscription becomes a named function:
```typescript
export function wireEventHandlers(deps: EventHandlerDeps): void {
  deps.eventBus.subscribe({}, (envelope) => handleEventForClassification(deps, envelope))
  deps.eventBus.subscribe({ eventType: 'decision' }, (envelope) => handleDecisionEvent(deps, envelope))
  deps.eventBus.subscribe({ eventType: 'artifact' }, (envelope) => handleArtifactEvent(deps, envelope))
  deps.eventBus.subscribe({ eventType: 'lifecycle' }, (envelope) => handleLifecycleEvent(deps, envelope))
  deps.eventBus.subscribe({ eventType: 'completion' }, (envelope) => handleCompletionEvent(deps, envelope))
  deps.eventBus.subscribe({ eventType: 'error' }, (envelope) => handleErrorEvent(deps, envelope))
}
```
This makes event handling logic testable independently and reduces index.ts by ~140 lines.

### 2. Split types/brief.ts into domain-specific type files (MEDIUM)

**Problem**: `brief.ts` (250 lines) combines 5 distinct type domains:
- Application domain: ProjectBrief, AgentBrief, SessionPolicy
- Infrastructure: MCPServerConfig, WorkspaceRequirements, WorkspaceMount, SandboxCapability
- Security: SecretRef, GuardrailPolicy, GuardrailSpec
- Escalation: EscalationProtocol, EscalationRule, EscalationPredicate
- Snapshots: KnowledgeSnapshot, WorkstreamSummary, DecisionSummary, etc.

**Fix**: Split into:
- `types/brief.ts` -- keep AgentBrief, ProjectBrief, SessionPolicy, ContextInjectionPolicy
- `types/snapshot.ts` -- KnowledgeSnapshot and its component summaries
- `types/workspace.ts` -- MCPServerConfig, WorkspaceRequirements, WorkspaceMount, SandboxCapability, SecretRef
- `types/escalation.ts` -- EscalationProtocol, EscalationRule, EscalationPredicate, GuardrailPolicy

Re-export everything from `types/index.ts` for backward compatibility.

### 3. Consider Zod-inferred types to eliminate type/schema drift (MEDIUM)

**Problem**: Every type in `types/events.ts` has a hand-written Zod schema in `validation/schemas.ts`. These can drift apart silently. For example, if a field is added to `ArtifactEvent` but not to `artifactEventSchema`, the runtime validation won't catch the new field.

**Fix**: Derive TypeScript types from Zod schemas using `z.infer<>`:
```typescript
// In schemas.ts:
export const artifactEventSchema = z.object({ ... })
export type ArtifactEvent = z.infer<typeof artifactEventSchema>
```
This eliminates the manual type definitions in `types/events.ts` for event types. The `types/` module would then re-export the inferred types from schemas. This is a larger refactor but eliminates a whole class of bugs.

### 4. Convert EventClassifier from class to pure function (LOW)

**Problem**: `EventClassifier` is a class with no state and one method (`classify()`). It's instantiated once in `index.ts:50` and never configured.

**Fix**: Replace with a standalone `classifyEvent(envelope: EventEnvelope): ClassifiedEvent` function. The two private helpers (`isHighSeverity`, `isGuardrailBlock`) can remain module-private functions. This eliminates unnecessary class ceremony.

### 5. Extract Docker plugin wiring from index.ts (LOW)

**Problem**: `wireDockerPlugin()` (lines 413-481) and `runStartupVolumeRecovery()` (lines 488-555) are 140 lines of Docker-specific logic in the bootstrap file.

**Fix**: Move to `src/gateway/docker-wiring.ts`. The bootstrap calls `wireDockerPlugin(plugins, ...)` which returns the volume recovery service. This keeps index.ts focused on sequential service construction.

### 6. Add EventBus type safety for subscription filters (LOW)

**Problem**: `EventBusFilter.eventType` is typed as `AgentEvent['type']` but the `subscribe()` call site doesn't verify that the handler actually checks the event type. For example, `eventBus.subscribe({ eventType: 'decision' }, handler)` doesn't guarantee `handler` receives `DecisionEvent`.

**Fix**: Consider a typed overload:
```typescript
subscribe<T extends AgentEvent['type']>(
  filter: { eventType: T },
  handler: (envelope: EventEnvelope & { event: Extract<AgentEvent, { type: T }> }) => void
): string
```
This provides compile-time assurance that filtered handlers receive correctly narrowed event types.
