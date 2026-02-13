# Intelligence Module Architecture Recommendations

## Module Profile

**Files**: `trust-engine.ts`, `decision-queue.ts`, `knowledge-store.ts`, `coherence-monitor.ts`, `context-injection-service.ts`, `snapshot-sizer.ts`, `embedding-service.ts`, `coherence-review-service.ts`, `index.ts`

**Fan-out** (imports from other modules):
- `../tick` (TickService) -- used by TrustEngine, DecisionQueue, CoherenceMonitor, ContextInjectionService
- `../bus` (EventBus, EventBusHandler) -- used by ContextInjectionService
- `../types/*` -- events, brief, plugin types consumed heavily
- `../routes` (AgentRegistry, AgentGateway, KnowledgeStore, ControlModeManager) -- used by ContextInjectionService

**Fan-in** (other modules importing from intelligence):
- `src/routes/index.ts` imports TrustEngine, DecisionQueue, and types
- `src/routes/decisions.ts` imports TrustOutcome
- `src/index.ts` imports all major classes (TrustEngine, DecisionQueue, KnowledgeStore, CoherenceMonitor, MockEmbeddingService, MockCoherenceReviewService, ContextInjectionService)
- `src/routes/events.ts` imports EventFilter from knowledge-store

**Instability**: Medium-high. This module is consumed by routes and index.ts but also has significant outbound dependencies on types, tick, bus, and routes.

**Export ratio**: High -- `index.ts` re-exports 22 symbols (6 classes, 3 functions, 13 types). Many internal row types and helper functions are properly module-private.

## Depth Assessment

This module is **deep**: substantial implementation complexity behind relatively narrow interfaces.

- `KnowledgeStore` (941 lines): Deep class with 10 tables, audit logging, optimistic concurrency, snapshot generation, checkpoint management. Interface is broad (35+ public methods) but well-organized by domain section.
- `CoherenceMonitor` (503 lines): Three-layer detection system behind a single `processArtifact()` entry point plus async scan methods. Good depth.
- `TrustEngine` (243 lines): Clean, focused. Config-driven scoring with calibration mode. Well-bounded interface.
- `DecisionQueue` (305 lines): Good depth with timeout/orphan/grace-period lifecycle management behind simple enqueue/resolve interface.
- `ContextInjectionService` (448 lines): Deepest coupling -- depends on 6 external services injected via constructor. Three independent trigger mechanisms (periodic, reactive, staleness) behind one `scheduleInjection()` method.

**Interface-to-implementation ratio**: Good for TrustEngine, DecisionQueue, CoherenceMonitor. Poor for KnowledgeStore (too many public methods, some exist only for route convenience).

## Boundary Health

**Type leakage -- moderate concerns**:

1. `KnowledgeStore.getSnapshot()` accepts `QueuedDecision[]` from DecisionQueue. This couples the snapshot generation to the decision queue's internal type. The KnowledgeStore shouldn't need to know about `QueuedDecision` -- it should receive a `DecisionSummary[]` instead.

2. `ContextInjectionService` constructor takes 6 external dependencies (TickService, EventBus, KnowledgeStore, AgentRegistry, AgentGateway, ControlModeManager). This is the highest fan-out of any class in the codebase. The dependency types come from `../routes` (an interface-defining barrel), which creates a circular conceptual dependency: routes depend on intelligence, and intelligence depends on route-defined interfaces.

3. `index.ts` re-exports `MockEmbeddingService`, `MockCoherenceReviewService`, and `createVectorsWithSimilarity` -- these are test utilities that leak through the production barrel export. They should be importable from test-specific paths only.

4. `StoredCheckpoint` and `ConflictError` are exported from `knowledge-store.ts` and consumed by routes. `StoredCheckpoint` includes `SerializedAgentState` from types/plugin, creating a transitive coupling chain.

## Co-Change Partners

**Expected co-change pairs**:
- `knowledge-store.ts` <-> `decision-queue.ts`: snapshot generation depends on QueuedDecision
- `trust-engine.ts` <-> `routes/decisions.ts`: trust outcome mapping on resolution
- `coherence-monitor.ts` <-> `embedding-service.ts` <-> `coherence-review-service.ts`: layered detection pipeline

**Surprising co-change**:
- `context-injection-service.ts` <-> `routes/index.ts`: ContextInjectionService imports route-defined interfaces (AgentRegistry, AgentGateway, KnowledgeStore, ControlModeManager). Any change to these interfaces forces changes in both routes AND intelligence.

## Specific Recommendations

### 1. Extract route-consumed interfaces out of `routes/index.ts` into `types/` (HIGH)

**Problem**: `ContextInjectionService` imports `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `ControlModeManager` from `../routes`. This creates a dependency cycle at the module boundary level: intelligence -> routes -> intelligence.

**Fix**: Move `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `CheckpointStore`, `ControlModeManager` interfaces from `src/routes/index.ts` into a new `src/types/service-interfaces.ts`. Both routes and intelligence can then import from `types/` without cross-referencing each other.

### 2. Stop exporting test utilities from `index.ts` (HIGH)

**Problem**: `MockEmbeddingService`, `MockCoherenceReviewService`, `createVectorsWithSimilarity` are exported from the barrel `intelligence/index.ts`. These are test-only utilities.

**Fix**: Remove these from `intelligence/index.ts`. Test files should import directly from `intelligence/embedding-service` and `intelligence/coherence-review-service`. This reduces the public surface area by 3 symbols.

### 3. Decouple `KnowledgeStore.getSnapshot()` from `QueuedDecision` (MEDIUM)

**Problem**: `getSnapshot(pendingDecisions?: QueuedDecision[])` in `knowledge-store.ts:639` accepts decision-queue internals. The knowledge store shouldn't know about the queue's internal representation.

**Fix**: Accept `DecisionSummary[]` instead of `QueuedDecision[]`. Move the `buildDecisionSummaries()` mapping logic (lines 706-738) into the caller (currently `src/index.ts:128`). The KnowledgeStore's snapshot would then just include whatever summaries it's given.

### 4. Introduce a facade for ContextInjectionService dependencies (MEDIUM)

**Problem**: `ContextInjectionService` constructor takes 6 distinct service references. This is the highest coupling point in the codebase and makes the class difficult to test without extensive mocking.

**Fix**: Create a `ContextInjectionDeps` interface that bundles these dependencies:
```typescript
interface ContextInjectionDeps {
  tick: { currentTick(): number; onTick(h: TickHandler): void; removeOnTick(h: TickHandler): void }
  events: { subscribe(filter: EventBusFilter, handler: EventBusHandler): string; unsubscribe(id: string): void }
  knowledge: { getSnapshot(): Promise<KnowledgeSnapshot> }
  registry: { getHandle(id: string): AgentHandle | null }
  gateway: { getPlugin(name: string): AgentPlugin | undefined }
  controlMode: { getMode(): ControlMode }
}
```
This narrows the actual surface consumed and makes the dependency contracts explicit.

### 5. Reduce KnowledgeStore public API surface (LOW)

**Problem**: `KnowledgeStore` exports 35+ public methods. Many are convenience accessors (e.g., `getArtifactVersion`, `getCheckpointCount`, `getCheckpoints`) that exist solely for route handlers or tests.

**Fix**: Group methods behind domain-specific sub-interfaces:
- `ArtifactStore` for artifact CRUD
- `EventLog` for event append/query
- `CheckpointStore` for checkpoint lifecycle
- `TrustProfileStore` for trust persistence

The route layer already defines some of these (e.g., `CheckpointStore` in routes/index.ts). Align the KnowledgeStore's implementation to these existing interfaces.

### 6. Internalize `isEmbeddable` function (LOW)

**Problem**: `isEmbeddable` is exported from `coherence-monitor.ts` and re-exported from `index.ts`. It's only used within `CoherenceMonitor.runLayer1Scan()`.

**Fix**: Keep it as a module-private function. Remove from the barrel export. Tests can exercise it indirectly through `runLayer1Scan()`.
