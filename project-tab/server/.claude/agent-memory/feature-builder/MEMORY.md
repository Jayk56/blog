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
- CRITICAL: Never use `execSync` to spawn a process that calls back into an in-process server -- `execSync` blocks the event loop, deadlocking the server. Use async `exec` wrapped in a promise instead.
- `listenEphemeral(server)` helper at `test/helpers/listen-ephemeral.ts` binds to port 0 and returns the assigned port
- `__dirname` works in vitest tests (no ESM import.meta needed)
- Local tsx binary at `node_modules/.bin/tsx` -- use it directly to avoid `npx` resolution overhead

## Scripts (`scripts/lib/`)
- `seed-file.ts`: Read/write/merge/validate/diff `project-seed.json` files. `computeSeedDiff()` + `formatDiff()` for D5 refresh preview.
- `enrichment.ts`: JSDoc extraction, barrel parsing, dependency graph, description synthesis, `extractFileExports()` for non-barrel modules, `collectJsDocCandidates()` extracts raw JSDoc material for description service
- `description-service.ts` (D3): `DescriptionSynthesisService` interface + 3 impls (Heuristic/LLM/Mock). Heuristic scores by relevance: +10 text mentions ws name, +5 file name match, +3 capital-letter start, -5 @param/@returns/TODO, +2 per sibling concept mentioned (breadth bonus). LLM uses Anthropic haiku with heuristic fallback. Mock tracks calls + allows registerResponse overrides.
- `scanner.ts`: `scanWorkstreams()`, `mapTestFiles()`, `scanRootFiles()`, `buildArtifacts()`, `pickKeyFiles()`
- `detectCircularDependencies()`: DFS cycle detection on workstream dependency graph
- `validateSeedFile()` checks: keyFiles, artifacts, src dirs, circular deps, test dirs, exports/barrel
- Types in `src/types/project-config.ts`: `WorkstreamDefinition`, `ProjectSeedPayload`, etc.
- Test helpers: `makeSeedPayload()`, `makeWorkstream()` with `tmpDir` fixture in `test/scripts/seed-file.test.ts`
- Bootstrap test has `buildEnrichedWorkstreams()` helper that mirrors `bootstrap.ts` enrichment pipeline -- keep in sync when changing bootstrap logic
- Bootstrap CLI: `--no-llm` flag forces heuristic descriptions. Without it + ANTHROPIC_API_KEY env, uses LLM. `--diff` mode (D5) compares existing seed against fresh scan without writing.
- Gateway has no barrel index.ts, so exports come from `extractFileExports` fallback (D2). Cap at 20 symbols.
- `extractLeadingJsDoc()` returns only the FIRST qualifying multi-line JSDoc per file (>= 3 lines, followed by `export`). Single-line JSDocs handled separately by `extractSingleLineJsDocs()`.

## EventBus Backpressure
- Per-agent queue (default 500), drops low-priority first (tool_call, progress, status)
- High-priority preserved: decision, artifact, error, completion
- Emits ErrorEvent(severity: 'warning') on drops, delivered directly to subscribers
- Warning events use sourceSequence -1 as synthetic marker

## Service Wiring in index.ts
- EventBus subscribes to: classifier+WS fanout, decision enqueue, artifact storage+coherence, lifecycle tracking, completion trust, error trust
- KnowledgeStore.getSnapshot() takes pending decisions from DecisionQueue as input
- Trust updates broadcast TrustUpdateMessage over WebSocket
