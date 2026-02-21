# Feature Builder Memory

## Project Tab Server

### Setup
- Server at `project-tab/server/`, ESM (`"type": "module"`)
- Test runner: `npx vitest run` from server dir
- Type check: `npx tsc --noEmit`
- TS target: ES2022, module: ES2022, moduleResolution: Bundler

### Dependencies
- Need `npm install` before first test run (node_modules not always present)
- `ws` package: use named import `{ WebSocket }` not default import `import WebSocket from 'ws'`
- Zod v3 for validation

### Testing Patterns
- Tests in `test/` mirroring `src/` structure
- Helper factory functions like `makeHandle()`, `makeEnvelope()` with Partial overrides
- `vi.useFakeTimers()` / `vi.useRealTimers()` for timer-dependent tests
- For WS testing: use EventEmitter-based mock with `simulateOpen()`, `simulateClose()`, `simulateMessage()`
- Injectable dependencies (fetch, WebSocket constructor) for testability

### Architecture
- EventBus: in-memory pub/sub with dedup and sequence gap detection
- Types in `src/types/` -- AgentPlugin, AgentHandle, SandboxInfo, LocalHttpTransport, etc.
- Validation schemas in `src/validation/schemas.ts` -- Zod schemas matching types
- Quarantine in `src/validation/quarantine.ts` -- stores malformed events

### Intelligence Layer (built in this session)
- **TrustEngine** (`src/intelligence/trust-engine.ts`): Per-agent trust, delta table, diminishing returns, decay via tick, calibration mode
- **DecisionQueue** (`src/intelligence/decision-queue.ts`): Pending decisions, resolution callbacks, timeout via ticks, orphaned/suspend/resume
- **KnowledgeStore** (`src/intelligence/knowledge-store.ts`): In-memory artifacts/agents/coherence/workstreams, `getSnapshot()` validated by Zod
- **CoherenceMonitor** (`src/intelligence/coherence-monitor.ts`): Layer 0 file conflict detection via sourcePath ownership
- Barrel export: `src/intelligence/index.ts`
- 103 tests in `test/intelligence/` (4 files)
- Key decision: KnowledgeStore does NOT own decisions; accepts `QueuedDecision[]` in `getSnapshot()`
- Trust decay uses accumulator pattern: decayRatePerTick accumulates, fires 1-point decay when >= 1

### Integration Tests (built for Phase 1+2 AC)
- 29 tests in `test/integration/phase1-acceptance.test.ts`
- 16 tests in `test/integration/phase1-closeout.test.ts` (gaps: crash detection, artifact upload, quarantine REST, providerConfig, orphan grace, coherence via bus, backpressure)
- 29 tests in `test/integration/phase2-closeout.test.ts` (KnowledgeStore, registry, MCP, tokens, checkpoint-on-decision, context injection, cross-provider)
- 4 tests in `test/integration/coherence-via-bus.test.ts`
- Mock adapter shim: `test/integration/mock-adapter-shim.ts` -- HTTP+WS server simulating Python adapter
- Test server helper: `test/integration/test-server.ts` -- boots full Express+WS backend
- Fixtures: `test/integration/fixtures.ts` -- scripted event sequences
- GOTCHA: When concatenating fixture sequences, beware of `resetSeqCounter()` causing sourceEventId dedup collisions
- GOTCHA: ESM project -- never use `require()`, always use static `import` at top of file
- Port strategy (IMPORTANT -- ports must not overlap between files running in parallel):
  - `local-process-plugin.test.ts`: 9100+
  - `phase1-acceptance.test.ts`: 9200-9249
  - `wiring.test.ts`: 9300+
  - `recover-artifacts.test.ts` / `token-renewal.test.ts`: 9400+
  - `coherence-via-bus.test.ts`: 9500+
  - `artifact-upload.test.ts` / `quarantine.test.ts`: 9600+
  - `provider-config.test.ts`: 9700+
  - `phase1-closeout.test.ts`: 9750-9799
  - `phase2-closeout.test.ts`: 9850-9899

### Route Testing with KnowledgeStoreImpl
- For routes using `knowledgeStoreImpl`, pass real `KnowledgeStore(':memory:')` as deps
- Port range for events tests: 9600+ (shared with artifact-upload/quarantine)
- `ToolCallEvent` fields: `toolCallId`, `phase`, `input`, `approved` (NOT `toolArgs`/`startedAt`)
- Pre-existing test failures: auth.test.ts "refreshes access tokens", e2e/smoke.test.ts tests g & h

### API Gotchas
- `TokenService.validateToken()` NOT `verifyToken()`
- `TokenService.renewToken(token, agentId)` requires TWO args
- `MCPProvisioner(toolMappings[], backendServers[])` -- positional, not options object
- `MCPProvisioner.provision(mcpServers, allowedTools, mounts, backendToken)` -- 4 separate args
- `ToolMCPMapping.serverTemplate` (not top-level serverName/transport/command/args)
- JWT `exp` in seconds: 100ms TTL rounds to 0s. Use >= 1000ms for expiration tests
- `jose`: same iat+exp second => identical JWT bytes. Advance clock >= 1s between issue and renew
- `AgentRegistryImpl.getById()` returns `undefined` not `null`

### Server Wiring (after API wiring task)
- `AppDeps` = `ApiRouteDeps` -- full dependency injection bag
- Routes accept deps via closure, no longer use `notImplemented()`
- Decision resolution pipeline: DecisionsRouter resolves -> TrustEngine delta -> WsHub broadcast TrustUpdateMessage
- Brake route: scope-based agent kill/pause, orphaned decisions handled

## Claude Adapter Shim (`project-tab/adapter-shim/claude/`)
- TypeScript Express + ws, 139 vitest tests passing (62 existing + 77 new for real mode)
- Mock mode: `npx tsx src/index.ts --port 9100 --mock`
- Real mode: `npx tsx src/index.ts --port 9100 --workspace /path/to/project`
- New --workspace flag sets cwd for spawned claude processes
- **Real mode modules**:
  - `src/brief-to-prompt.ts`: Converts AgentBrief to prompt string (~8000 char cap)
  - `src/event-mapper.ts`: ClaudeEventMapper maps Claude CLI stream-json NDJSON to AgentEvent objects
  - `src/claude-runner.ts`: Spawns `claude` CLI with --output-format stream-json
- Artifact detection on Write/Edit tool results; `inferArtifactKind()` classifies by extension
- resolveDecision is no-op (full-auto mode v1)
- Kill uses SIGTERM -> SIGKILL fallback (5s grace)
- Testing: `vi.mock('node:child_process')` with FakeProcess (EventEmitter + Readable streams)
- Must use `await import()` after `vi.mock()` for ESM compatibility
- NDJSON fixture at `test/fixtures/claude_session.ndjson`

## Python Adapter Shim (`project-tab/adapter-shim/openai/`)
- Python 3.14.3 on macOS, requires venv (Homebrew blocks system-wide pip)
- venv at `adapter-shim/openai/.venv/`
- Run tests: `cd project-tab/adapter-shim/openai && source .venv/bin/activate && python -m pytest -v`
- Entry point: `python -m adapter_shim --port 9100 [--mock] [--workspace /path]`
- FastAPI + uvicorn + Pydantic v2, 128 tests passing (61 mock + 67 real mode)
- pytest-asyncio with `asyncio_mode = auto` in pytest.ini
- Starlette TestClient works for sync WS tests; avoid blocking receive_json in loops that might never get data
- All Pydantic models use `Field(alias="camelCase")` + `populate_by_name=True` + `model_dump(by_alias=True)`
- MockRunner emits scripted sequence and blocks on asyncio.Future for decision resolution
- **Real mode modules**:
  - `brief_to_prompt.py`: Converts AgentBrief to structured prompt for Codex CLI (~8000 char cap)
  - `event_mapper.py`: CodexEventMapper maps Codex NDJSON to AgentEvent objects (stateful, tracks open tool calls)
  - `codex_runner.py`: CodexRunner spawns `codex exec --full-auto --json`, maps NDJSON output via event_mapper
  - `infer_artifact_kind()`: File extension -> ArtifactKind, test file detection (.test., .spec., test_ prefix)
- **Runner interface**: Both MockRunner and CodexRunner share: start(), kill(), pause(), resolve_decision(), get_checkpoint(), drain_events(), handle, is_running
- CodexRunner.resolve_decision() always returns False (full-auto mode, no decisions)
- Tests use monkey-patching of _spawn_and_read to inject fake subprocess behavior
- NDJSON fixture at `tests/fixtures/codex_session.ndjson` covers all event types

## Teams Bridge (`project-tab/bridge/`)
- Bridge hooks at `bridge/hooks/` — plain .mjs files (no TypeScript)
- Hook lib: `lib/event-factory.mjs` (createAdapterEvent, createToolCallEvent, createArtifactEvent, createCompletionEvent, createLifecycleEvent, createErrorEvent)
- Hook lib: `lib/bridge-client.mjs` (getConfig, postEvent, readStdinJson — reads BRIDGE_SERVER_URL + BRIDGE_AGENT_ID env vars)
- Hooks: `post-tool-use.mjs`, `task-completed.mjs`, `teammate-idle.mjs` — all fire-and-forget, 5s timeout, exit 0 always
- Server plugin: `server/src/gateway/teams-bridge-plugin.ts` — AgentPlugin with all capabilities=false
- Bridge routes: `server/src/routes/bridge.ts` — POST /events, POST /register, GET /context/:agentId, GET /brake/:agentId
- Routes mounted at `/api/bridge` in `routes/index.ts`, plugin registered in `index.ts`
- `LifecycleEvent.action` extended with 'idle' (both types and Zod schema)
- Zod `toolCallEventSchema.input` is optional but TS type `ToolCallEvent.input` is required — cast with `as EventEnvelope['event']` when creating envelopes from Zod-validated data
- `ApiRouteDeps.bridgePlugin?: TeamsBridgePlugin` — optional dep, bridge router only mounted when present
