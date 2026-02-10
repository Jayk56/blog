# Feature Builder Agent Memory

## Project Tab Server Architecture
- Express + WS server at `project-tab/server/`
- ESM modules, TypeScript strict, Vitest for testing
- `global.d.ts` has custom module declarations for `ws`, `express`, `uuid`
- Routes use dependency injection: `ApiRouteDeps` interface passed through `createApp` -> `createApiRouter` -> each router factory

## Key Patterns
- Route factories accept `deps: ApiRouteDeps` containing all services
- `AgentRegistry` (from gateway-builder) uses `register(handle, sandbox)` / `getById()` interface - different from the route-facing `AgentRegistry` interface which uses `registerHandle()` / `getHandle()`
- Adapter pattern: real `AgentRegistry` class adapted to route interface in `index.ts`
- Zod-inferred types can differ from hand-written TS types (e.g., `unknown` vs `EscalationPredicate`) - use `as unknown as Type` cast when passing validated Zod output to typed functions

## Testing
- `vitest run` for all tests, `vitest run test/file.test.ts` for specific
- Route tests use real HTTP (createServer + fetch) not supertest
- Test ports: 9200+ for integration, 9300+ for route wiring tests
- Mock plugins record calls in a `calls` map for assertion

## EventBus Backpressure
- Per-agent queue (default 500), drops low-priority first (tool_call, progress, status)
- High-priority preserved: decision, artifact, error, completion
- Emits ErrorEvent(severity: 'warning') on drops, delivered directly to subscribers
- Warning events use sourceSequence -1 as synthetic marker

## Service Wiring in index.ts
- EventBus subscribes to: classifier+WS fanout, decision enqueue, artifact storage+coherence, lifecycle tracking, completion trust, error trust
- KnowledgeStore.getSnapshot() takes pending decisions from DecisionQueue as input
- Trust updates broadcast TrustUpdateMessage over WebSocket
