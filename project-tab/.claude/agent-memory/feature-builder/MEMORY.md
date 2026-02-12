# Feature Builder Agent Memory

## Project Tab Server

### Test Patterns
- Tests use `vitest` with `describe/it/expect` pattern
- HTTP route tests use `fetch` directly (no supertest) with `createServer` and port allocation
- Use `vi.useFakeTimers()` for time-dependent tests; `Date.now()` is frozen in fake timer mode
- EventBus deduplicates events by `sourceEventId` — synthetic events need unique IDs (include counter)
- Test port ranges: 9300+ for route wiring tests, 9500+ for quarantine tests

### Build/Run Commands
- Run tests: `cd project-tab/server && npx vitest run`
- Run single test: `cd project-tab/server && npx vitest run test/path/to/test.ts`
- No supertest dependency; use native fetch + express + createServer pattern

### Codebase Patterns
- Event pipeline: WS message -> JSON.parse -> validateAdapterEvent (Zod) -> quarantine/EventEnvelope -> EventBus.publish
- Synthetic events use sourceSequence: -1, special runId prefix, and category: 'internal'
- Routes follow factory pattern: `createXxxRouter(deps)` returning Router
- Routes wired in `src/routes/index.ts` via `createApiRouter(deps)`
- Quarantine is in-memory (module-scoped array), not persisted

### File Locations (common gotchas)
- Event bus: `src/bus.ts` (NOT event-bus.ts)
- Types: `src/types/` directory with barrel `index.ts` (NOT a single types.ts)
- Volume recovery: `src/gateway/volume-recovery.ts` (NOT volume-recovery-service.ts)
- Classifier: `src/classifier.ts` — coherence events route to `map` workspace (NOT queue), with queue as secondary for high severity

### Docker/Volume Patterns
- Volume naming: `project-tab-workspace-${agentId}` (matches ContainerOrchestrator)
- wireDockerPlugin returns { volumeRecovery, docker } for startup scan
- Startup volume scan runs async after server.listen() — doesn't block

### Crash Detection Pattern
- LocalProcessPlugin.spawn() wires: ChildProcessManager.onExit() + EventStreamClient.onDisconnect for crash detection
- Uses `crashHandled` flag per AgentRecord to deduplicate between process exit and WS disconnect
- Clean exit (code 0) is not treated as a crash
- Intentional kill()/killAll() set crashHandled=true before cleanup to prevent false crash events
- ChildProcessManager mock: capture exit listeners via module-scoped Map (not on PM instance — avoids private field TS conflicts)

### Orphan Grace Period Pattern
- DecisionQueue.scheduleOrphanTriage() keeps decisions as 'pending' with badge='grace period' during grace window
- DecisionQueue.handleAgentKilled() still used for immediate triage (brake)
- Grace period expiry happens in onTick() — checks graceDeadlineTick field
- agents.ts kill route uses scheduleOrphanTriage, brake.ts still uses handleAgentKilled

### Artifact Upload Pattern
- KnowledgeStore has `artifact_content` table for raw content + `storeArtifactContent()`/`getArtifactContent()` methods
- POST /api/artifacts stores content if KnowledgeStore supports it, returns backendUri (artifact://agentId/artifactId)
- GET /api/artifacts/:id/content retrieves raw content (must be registered before /:id route due to Express specificity)
- Adapter shims intercept ArtifactEvents in WS drain, upload to backend, rewrite URI before forwarding
- Bootstrap config (`AGENT_BOOTSTRAP` env var) provides `artifactUploadEndpoint` to adapter shims
- Upload is best-effort — if it fails, event is forwarded with original URI

### providerConfig Passthrough
- Already wired at every layer: types, Zod schema, adapter models, LocalHttpPlugin.spawn()
- Debug endpoint GET /debug/config on both adapter shims exposes received providerConfig
- Test port ranges: 9600+ for artifact upload tests, 9700+ for provider config tests

### Known Issues
- Pre-existing: e2e/smoke.test.ts has race condition when run in full suite (database closed during teardown while events still processing)
- Multiple agents may edit `src/routes/index.ts` concurrently — re-read before editing
- phase1-closeout.test.ts has failing orphan grace period tests (tickService.tick is not a function) — Task #4 builder's issue
