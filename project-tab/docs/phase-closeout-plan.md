# Phase 1+2 Closeout Plan

> Produced by gap analysis of `AGENT-PLUGIN-DESIGN.md` Phase 1 (lines 3134-3191) and Phase 2 (lines 3192-3205) acceptance criteria against the current codebase.

---

## Overview

The codebase already has substantial infrastructure:

- **Working**: EventBus (backpressure, dedup, sequence gaps), EventStreamClient (WS + reconnect + validation), LocalProcessPlugin/LocalHttpPlugin (spawn/kill/pause/resume/checkpoint RPC), ChildProcessManager (port allocation, health polling, exit listeners), Zod validation schemas + quarantine module, TrustEngine (scoring + decay + tick subscription), DecisionQueue (enqueue/resolve/timeout/orphan/suspend), KnowledgeStore (SQLite, artifacts, agents, checkpoints, coherence issues), CoherenceMonitor (Layer 0 path conflicts + Layer 1 embedding + Layer 2 LLM review), ContextInjectionService, WebSocketHub, Classifier, TickService, routes for agents/decisions/brake/artifacts/trust/control-mode/tick/token, TokenService (JWT), ContainerPlugin + ContainerOrchestrator + VolumeRecoveryService, MCPProvisioner, adapter shims (OpenAI Python + Claude TypeScript) with mock modes.
- **Integration tests**: `test/integration/phase1-acceptance.test.ts` with mock adapter shim framework.

Eight gaps remain. Each is detailed below with current state, files to modify, interface changes, test approach, and dependencies.

---

## Gap 1: Event Validation / Quarantine Pipeline

### Acceptance Criteria
> "Event validation pipeline quarantines malformed events from the adapter and logs them; well-formed events pass through with EventEnvelope wrapping" (Phase 1 criterion 10)

### Current State
- `src/validation/schemas.ts` — Full Zod schemas for all event types, `validateAdapterEvent()` function exists.
- `src/validation/quarantine.ts` — `quarantineEvent()`, `getQuarantined()`, `clearQuarantine()`, `validateOrQuarantine()` exist. In-memory array storage.
- `src/gateway/event-stream-client.ts` — **Already calls `validateAdapterEvent()` on each incoming WS message**, quarantines failures, stamps `ingestedAt` on valid events, and publishes `EventEnvelope` to EventBus. Also validates `agentId` matches expected.

### Gap Analysis
The core pipeline is **already wired**:
1. EventStreamClient receives raw WS message -> JSON.parse -> `validateAdapterEvent(parsed)` -> quarantine on failure -> `EventEnvelope` on success -> `eventBus.publish()`.
2. Quarantine is in-memory only — no persistence or API exposure.

**Remaining work:**
- **Expose quarantine via REST API**: A `GET /api/quarantine` endpoint so the frontend (or integration tests) can verify quarantined events. Also `DELETE /api/quarantine` to clear.
- **Log quarantine events more structurally**: Currently console.error only. Add a quarantine count to EventBus metrics or expose via the health endpoint.
- **Integration test coverage**: The `mock-adapter-shim.ts` already supports sending malformed events. Write a test that sends malformed events and verifies they appear in `getQuarantined()` and do NOT propagate to subscribers.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/routes/quarantine.ts` | **New file.** Create `createQuarantineRouter(deps)` with `GET /api/quarantine` (returns `getQuarantined()`) and `DELETE /api/quarantine` (calls `clearQuarantine()`). |
| `src/routes/index.ts` | Import and mount quarantine router at `/quarantine`. |
| `test/routes/quarantine.test.ts` | **New file.** Unit tests for the quarantine REST endpoints. |
| `test/integration/phase1-acceptance.test.ts` | Add test case: send malformed event from mock shim -> verify quarantined -> verify bus did NOT deliver it. |

### Interface Changes
- New route: `GET /api/quarantine` returns `{ events: QuarantinedEvent[] }`
- New route: `DELETE /api/quarantine` returns `{ cleared: true }`

### Test Approach
1. Unit test: call `quarantineEvent()` directly, verify `getQuarantined()` returns it.
2. Unit test: quarantine REST endpoints with mocked quarantine module.
3. Integration test: mock adapter shim sends `{ sourceEventId: "bad", event: { type: "INVALID" } }`, verify it appears in quarantine and EventBus subscriber callback count is 0.

### Dependencies
- None. This is self-contained.

---

## Gap 2: Artifact Upload Flow

### Acceptance Criteria
> "ArtifactEvent triggers eager upload from adapter shim to backend via POST /api/artifacts; adapter rewrites uri to backendUri from ArtifactUploadResult before forwarding over WebSocket; event bus only sees stable artifact:// URIs" (Phase 1 criterion 5)

### Current State
- `src/routes/artifacts.ts` — `POST /api/artifacts` exists but only checks `agentId`/`artifactId` from body and returns `{ backendUri: "artifact://...", artifactId, stored: true }`. **Does NOT actually store content** (no content field in the request body, no file storage).
- Adapter shims (both OpenAI and Claude mock runners) emit `ArtifactEvent` over WS with a `uri` field, but **do NOT upload to `POST /api/artifacts`** before emitting. The mock runners don't call the backend at all — they just emit events.
- `SandboxBootstrap.artifactUploadEndpoint` is injected into the shim env but the shims don't use it.
- `index.ts` event bus subscription for `artifact` events calls `knowledgeStoreImpl.storeArtifact()` and `coherenceMonitor.processArtifact()` — this works but the artifact event may have a shim-local `uri` rather than a stable `artifact://` URI.

### Gap Analysis
The spec requires a two-step flow:
1. Adapter shim produces artifact content -> calls `POST /api/artifacts` with content and metadata -> gets back `backendUri`.
2. Adapter shim then emits `ArtifactEvent` over WS with `uri` set to the `backendUri` (not the local path).
3. Backend EventBus only ever sees `artifact://` URIs.

**Remaining work:**
- **Backend `POST /api/artifacts`**: Accept artifact content (as JSON base64 or multipart), store it (in-memory map or on disk for Phase 1), return `backendUri`.
- **Adapter shim changes**: Both OpenAI and Claude mock runners should upload artifacts to the backend before emitting the ArtifactEvent on WS. The mock runners need to know the `artifactUploadEndpoint` from the bootstrap config.
- **URI rewriting verification**: Integration test that the EventBus only receives events with `artifact://` URIs.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/routes/artifacts.ts` | Enhance `POST /api/artifacts` to accept `content` (base64 string), `mimeType`, `sizeBytes`, `contentHash` fields. Store content in an in-memory `Map<string, Buffer>` keyed by `artifact://agentId/artifactId`. Return `ArtifactUploadResult` with `backendUri`. Add `GET /api/artifacts/:id/content` to retrieve stored content. |
| `src/routes/index.ts` | Pass artifact content store through deps if needed (or keep it module-scoped in artifacts.ts for Phase 1). |
| `adapter-shim/openai/adapter_shim/mock_runner.py` | In the artifact event emission, first POST to `artifactUploadEndpoint` with content, get `backendUri`, set `uri = backendUri` on the event before emitting. Needs access to bootstrap config for the endpoint URL. |
| `adapter-shim/openai/adapter_shim/app.py` | Pass bootstrap config through to MockRunner (or store on AppState). Parse `AGENT_BOOTSTRAP` env var. |
| `adapter-shim/claude/src/mock-runner.ts` | Same as OpenAI: upload artifact content before emitting event. |
| `adapter-shim/claude/src/app.ts` | Parse bootstrap config and pass to MockRunner. |
| `test/integration/phase1-acceptance.test.ts` | Test: spawn agent -> mock shim emits ArtifactEvent -> verify EventBus sees `artifact://` URI -> verify `GET /api/artifacts/:id/content` returns content. |

### Interface Changes
- Enhanced `POST /api/artifacts` request body:
  ```ts
  { agentId: string, artifactId: string, content: string /* base64 */, mimeType?: string, sizeBytes?: number, contentHash?: string }
  ```
- Enhanced `POST /api/artifacts` response:
  ```ts
  { backendUri: string, artifactId: string, stored: true }
  ```
  (same shape, but now actually stores content)
- New `GET /api/artifacts/:id/content` returns raw content with appropriate Content-Type.

### Test Approach
1. Unit test: `POST /api/artifacts` stores content, returns backendUri. `GET /api/artifacts/:id/content` retrieves it.
2. Integration test: mock shim uploads artifact, then emits ArtifactEvent with artifact:// URI. Verify EventBus envelope has correct URI.
3. Adapter shim tests: verify mock runner calls upload endpoint before emitting event.

### Dependencies
- Mock adapter shim changes are needed for integration tests to validate the full flow.
- If adapter shim changes are deferred, the backend endpoint can still be tested in isolation.

---

## Gap 3: Crash Detection

### Acceptance Criteria
> "Adapter shim crash (kill child process) is detected via child_process exit event + WebSocket drop; backend marks agent as crashed and emits ErrorEvent" (Phase 1 criterion 9)

### Current State
- `ChildProcessManager.onExit()` — registers exit listeners. **Exists but is never called** from `LocalProcessPlugin.spawn()`. The exit listener infrastructure is there but not wired.
- `EventStreamClient` — has `onDisconnect` callback option. **It IS passed in the constructor options** but `LocalProcessPlugin.spawn()` does not set it.
- `index.ts` lifecycle event handler (line 269-295) handles `action: 'crashed'` by calling `knowledgeStoreImpl.removeAgent()`. But this depends on the adapter sending a lifecycle event — a crashed adapter can't send its own crash event.
- Agent handle status includes `'error'` which would be used for crashed agents.

### Gap Analysis
Need to wire crash detection:
1. `LocalProcessPlugin.spawn()` should register a `processManager.onExit()` listener for the agent.
2. When the child exits unexpectedly (while the agent is still in `agents` map), emit a synthetic `ErrorEvent` with `category: 'internal'` and a `LifecycleEvent` with `action: 'crashed'`.
3. Also wire `EventStreamClient.onDisconnect` to trigger crash detection (belt-and-suspenders: process exit + WS drop).
4. Update registry handle status to `'error'`.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/gateway/local-process-plugin.ts` | In `spawn()`, after successful plugin.spawn() RPC: (1) Register `processManager.onExit(agentId, (code, signal) => { ... })` that emits synthetic `ErrorEvent` + `LifecycleEvent` to EventBus and marks agent as crashed. (2) Set `EventStreamClient.onDisconnect` callback that triggers the same crash handling (with dedup so only one fires). |
| `test/gateway/local-process-plugin.test.ts` | Add test: spawn agent -> kill child process -> verify ErrorEvent emitted -> verify LifecycleEvent with action='crashed' emitted -> verify agent record cleaned up. |
| `test/integration/phase1-acceptance.test.ts` | Add test: mock shim "crashes" (shim closes server) -> verify backend detects crash -> ErrorEvent + LifecycleEvent appear on frontend WS. |

### Interface Changes
- `LocalProcessPluginOptions` gains optional `onCrash?: (agentId: string) => void` callback for external notification (e.g., for registry cleanup in index.ts). Or the plugin can publish directly to the EventBus (it already has a reference).
- No new types needed — `ErrorEvent` and `LifecycleEvent` already support all needed fields.

### Synthetic crash events shape:
```ts
// ErrorEvent
{
  type: 'error',
  agentId,
  severity: 'critical',
  message: `Agent process exited unexpectedly (code=${code}, signal=${signal})`,
  recoverable: false,
  category: 'internal',
}

// LifecycleEvent
{
  type: 'lifecycle',
  agentId,
  action: 'crashed',
  reason: `Process exit code=${code} signal=${signal}`,
}
```

### Test Approach
1. Unit test with mock ChildProcessManager: simulate process exit -> verify EventBus receives ErrorEvent + LifecycleEvent.
2. Unit test: WS disconnect callback -> verify crash handler fires.
3. Integration test: mock adapter shim server closes mid-stream -> verify backend crash detection flow.

### Dependencies
- EventBus must be passed to LocalProcessPlugin (already is).
- AgentRegistry update happens through the existing `index.ts` lifecycle event subscription.

---

## Gap 4: Layer 0 Coherence Triggering from Artifact Events

### Acceptance Criteria
> "Layer 0 coherence detects file conflict when real agent produces ArtifactEvent with provenance.sourcePath matching an existing artifact's path" (Phase 1 criterion 12)

### Current State
- `CoherenceMonitor.processArtifact()` — **Already implements Layer 0 path conflict detection**. Tracks `pathOwnership` map, returns `CoherenceEvent` when two different agents write to the same `sourcePath`.
- `index.ts` line 246-266 — **Already wired**: EventBus subscribes to `artifact` events, calls `coherenceMonitor.processArtifact()`, stores the issue, and publishes it to WsHub.

### Gap Analysis
**This is already fully implemented.** The gap may be in test coverage rather than functionality.

**Remaining work:**
- Verify the integration test covers this scenario: two agents produce ArtifactEvents with the same `sourcePath` from different agents -> CoherenceEvent appears on frontend WS.
- Ensure the mock adapter shim fixture `artifactConflictSequence` is used in a test.

### Files to Create/Modify

| File | Change |
|------|--------|
| `test/integration/phase1-acceptance.test.ts` | Add/verify test case: two artifact events with same sourcePath from different agents -> CoherenceEvent broadcast on WS with category='duplication', severity='high'. |

### Interface Changes
- None. All types and wiring exist.

### Test Approach
1. Integration test: publish two ArtifactEvents with same `provenance.sourcePath` but different `agentId` -> verify CoherenceEvent appears in WsHub broadcast.
2. This can be done purely through the EventBus without needing the mock adapter shim.

### Dependencies
- None.

---

## Gap 5: providerConfig Passthrough

### Acceptance Criteria
> "providerConfig passthrough works: adapter receives opaque config from AgentBrief.providerConfig and applies it to SDK initialization (e.g., temperature, maxTokens)" (Phase 1 criterion 13)

### Current State
- `AgentBrief.providerConfig` — defined as `Record<string, unknown>` in `src/types/brief.ts` line 230.
- Zod schema includes `providerConfig: z.record(z.string(), z.unknown()).optional()` in `src/validation/schemas.ts` line 390.
- `LocalHttpPlugin.spawn()` sends the entire `AgentBrief` to `POST /spawn` on the adapter shim. Since `providerConfig` is part of the brief, it **is already being sent**.
- OpenAI adapter `models.py` — `AgentBrief` has `provider_config: dict[str, Any] | None` (line 224).
- Claude adapter `models.ts` — `AgentBrief` interface includes `providerConfig`.
- **Neither mock runner actually reads or applies `providerConfig`** — they ignore it.

### Gap Analysis
The passthrough **plumbing is already complete** — the backend sends the full brief including `providerConfig` to the adapter shim, and the adapter shim models parse it. The gap is:
1. Mock runners should log/store `providerConfig` to prove they received it (for test verification).
2. Integration test should verify `providerConfig` arrives at the adapter shim.

### Files to Create/Modify

| File | Change |
|------|--------|
| `adapter-shim/openai/adapter_shim/mock_runner.py` | Store `self.provider_config = brief.provider_config` on init. |
| `adapter-shim/claude/src/mock-runner.ts` | Store `this.providerConfig = brief.providerConfig` on init. |
| `adapter-shim/openai/adapter_shim/app.py` | Add `GET /debug/config` endpoint that returns the stored providerConfig (test-only). |
| `adapter-shim/claude/src/app.ts` | Add `GET /debug/config` endpoint. |
| `test/integration/phase1-acceptance.test.ts` | Test: spawn with `providerConfig: { temperature: 0.7 }` -> GET mock shim `/debug/config` -> verify it received the config. |

### Interface Changes
- New debug endpoint `GET /debug/config` on adapter shims (mock mode only). Returns `{ providerConfig: ... }`.

### Test Approach
1. Integration test: spawn agent with providerConfig in brief -> query adapter shim debug endpoint -> verify config received.
2. Or: mock adapter shim stores received brief -> test reads it from mock shim state.

### Dependencies
- None. The plumbing already works.

---

## Gap 6: Orphaned Decision Grace Period

### Acceptance Criteria
> "OrphanedDecisionPolicy fires after grace period on explicit agent kill; tool approval decisions are handled per policy (triage by default)" (Phase 1 criterion 14)

### Current State
- `DecisionQueue.handleAgentKilled()` — **Immediately** moves all pending decisions from the killed agent to `status: 'triage'` with badge `'agent killed'` and elevated priority. No grace period.
- `routes/agents.ts` kill handler (line 86) calls `deps.decisionQueue.handleAgentKilled(handle.id)` synchronously inside the kill response.
- `routes/brake.ts` kill behavior also calls `handleAgentKilled()` synchronously.

### Gap Analysis
The spec says orphaned decisions should enter triage **after a grace period**, not immediately. This allows:
- A brief window where the human can still resolve them normally.
- Time for the system to determine if the kill was intentional (brake) vs crash.

**Remaining work:**
- Add `orphanGracePeriodTicks` configuration to DecisionQueue (default: e.g., 30 ticks = 30 seconds at 1 tick/sec).
- When an agent is killed, mark its decisions as `'pending'` with badge `'grace period'` and a `graceDeadlineTick`.
- On each tick, check if any grace-period decisions have passed their deadline -> move to `'triage'`.
- If a human resolves during the grace period, it processes normally.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/intelligence/decision-queue.ts` | (1) Add `orphanGracePeriodTicks` to constructor config (default: 30). (2) Add `graceDeadlineTick?: number` field to `QueuedDecision`. (3) Rename current `handleAgentKilled()` to immediately-triage logic. (4) Add new `scheduleOrphanTriage(agentId: string, currentTick: number)` that sets `badge = 'grace period'` and `graceDeadlineTick = currentTick + orphanGracePeriodTicks` on pending decisions. (5) In `onTick()`, check for grace-period decisions whose deadline has passed -> move to `'triage'`. (6) Keep `handleAgentKilled()` as the immediate version for brake kill (no grace needed there). |
| `src/routes/agents.ts` | Change kill handler to call `decisionQueue.scheduleOrphanTriage(handle.id, tickService.currentTick())` instead of `handleAgentKilled()`. Add `tickService` to the route deps. |
| `src/routes/brake.ts` | Keep using `handleAgentKilled()` (immediate triage for emergency brake). |
| `test/intelligence/decision-queue.test.ts` | Add tests: (1) `scheduleOrphanTriage()` sets badge and deadline. (2) Decision is still resolvable during grace period. (3) After grace ticks pass, decision moves to `'triage'`. (4) Immediate `handleAgentKilled()` still works for brake. |
| `test/integration/phase1-acceptance.test.ts` | Test: spawn agent -> get decision -> kill agent -> verify decision enters grace period -> advance ticks -> verify decision moves to triage. |

### Interface Changes
- New `QueuedDecision` fields:
  ```ts
  graceDeadlineTick?: number
  ```
- New `DecisionQueue` method:
  ```ts
  scheduleOrphanTriage(agentId: string, currentTick: number): QueuedDecision[]
  ```
- `DecisionTimeoutPolicy` extended (or separate config):
  ```ts
  orphanGracePeriodTicks: number  // default 30
  ```

### Test Approach
1. Unit tests for DecisionQueue with manual tick service.
2. Integration test with mock adapter shim: spawn, receive decision, kill agent, verify grace period, advance ticks, verify triage.

### Dependencies
- TickService must be accessible from the agents route (already available through deps.tickService in the app context; just needs to be added to `ApiRouteDeps`).

---

## Gap 7: Volume Recovery Wiring in Bootstrap

### Acceptance Criteria (Phase 2)
> "Implement persistent volumes for artifact recovery on unclean teardown" (Phase 2)

### Current State
- `src/gateway/volume-recovery.ts` — **Fully implemented** `VolumeRecoveryService` with `recover()`, `classifyFiles()`, Docker volume operations.
- `test/gateway/volume-recovery.test.ts` — **Comprehensive tests exist** (volume existence check, file listing, classification, re-upload, orphan detection, volume deletion).
- `index.ts` — **NOT wired.** VolumeRecoveryService is never instantiated or called in bootstrap.

### Gap Analysis
The service exists and is tested but never runs. It should be wired into:
1. Bootstrap: scan for leftover volumes from previous crashed sessions.
2. Crash detection: when an agent crashes, schedule volume recovery.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/index.ts` | In `wireDockerPlugin()`: if Docker is available, create `VolumeRecoveryService` instance. After server starts, run a startup scan: list Docker volumes matching `project-tab-workspace-*` pattern -> for each, cross-reference with KnowledgeStore artifacts -> run `recover()`. Also: expose `volumeRecovery` through deps so crash detection can trigger it. |
| `src/routes/agents.ts` | Add `POST /api/agents/:id/recover-artifacts` endpoint that triggers volume recovery for a specific agent. (This endpoint is mentioned in the design doc routes list.) |
| `test/integration/phase1-acceptance.test.ts` | Test: verify volume recovery runs on startup when orphaned volumes exist (requires Docker mock or skip in CI). |

### Interface Changes
- New `ApiRouteDeps` field:
  ```ts
  volumeRecovery?: { recover(agentId: string, knownArtifacts: ArtifactEvent[]): Promise<RecoveryResult> }
  ```
- New endpoint `POST /api/agents/:id/recover-artifacts` returns `RecoveryResult`.

### Test Approach
1. Unit test for the wiring: verify VolumeRecoveryService is created when Docker is available.
2. Integration test: mock Docker volume listing -> verify recovery runs.
3. The existing `volume-recovery.test.ts` already covers the service logic extensively.

### Dependencies
- Docker availability (conditional — skip if Docker not available).
- KnowledgeStore must expose artifact queries by agent (already does via `getSnapshot()`).

---

## Gap 8: Cross-Provider Validation

### Acceptance Criteria (Phase 2)
> "Run two agents from different providers on the same project" (Phase 2)

### Current State
- `index.ts` registers both `openai` (LocalProcessPlugin) and `claude` (ContainerPlugin, conditional on Docker) plugins.
- `routes/agents.ts` spawn handler uses `brief.modelPreference ?? deps.defaultPlugin ?? 'openai'` to select plugin.
- Agent registry tracks `pluginName` per agent.
- Both adapter shims implement the same wire protocol.

### Gap Analysis
The infrastructure supports multi-provider already, but there's no **test** that actually spawns two agents on different plugins in the same project. The gap is:
1. An integration test that spawns agent A on plugin "openai" and agent B on plugin "claude".
2. Verifies both agents' events flow through the same EventBus.
3. Verifies coherence monitoring works cross-agent (Layer 0 file conflict between different-provider agents).
4. Verifies decisions from both appear in the same queue.

### Files to Create/Modify

| File | Change |
|------|--------|
| `test/integration/cross-provider.test.ts` | **New file.** Integration test with two mock adapter shims on different ports. Register as "openai" and "claude" plugins. Spawn one agent on each. Verify: (1) Both agents' events appear in EventBus. (2) Decisions from both appear in DecisionQueue. (3) Artifact conflict across agents triggers CoherenceEvent. (4) Trust scores tracked independently. (5) Kill one agent doesn't affect the other. |
| `test/integration/mock-adapter-shim.ts` | May need minor enhancements to support running two shims simultaneously (different ports). Already supports configurable port, so this should work. |

### Interface Changes
- None. All infrastructure exists.

### Test Approach
1. Start two mock adapter shims on ports 9100 and 9101.
2. Create two LocalProcessPlugin instances (or one LocalProcessPlugin + one ContainerPlugin-like mock).
3. Spawn agents on each.
4. Verify cross-cutting concerns: shared event bus, shared decision queue, shared coherence monitor.

### Dependencies
- Gaps 1-6 should be resolved first (validation, artifact upload, crash detection are prerequisites for meaningful cross-provider testing).

---

## Dependency Graph

```
Gap 1 (Validation/Quarantine)  ─┐
Gap 4 (Coherence Triggering)   ─┤── independent, can be built in parallel
Gap 5 (providerConfig)         ─┘

Gap 3 (Crash Detection)        ─── depends on EventBus (exists)

Gap 2 (Artifact Upload)        ─── depends on adapter shim changes
Gap 6 (Orphan Grace Period)    ─── depends on TickService in routes (minor wiring)

Gap 7 (Volume Recovery Wiring) ─── depends on Docker (optional, conditional)
Gap 8 (Cross-Provider Test)    ─── depends on Gaps 1-6 being complete
```

### Recommended Build Order

**Phase A (parallel, no dependencies):**
- Gap 1: Quarantine REST endpoints + integration test
- Gap 3: Crash detection wiring in LocalProcessPlugin
- Gap 4: Coherence integration test (already mostly implemented)
- Gap 5: providerConfig verification in adapter shims

**Phase B (depends on Phase A):**
- Gap 2: Artifact upload flow (adapter shim + backend changes)
- Gap 6: Orphaned decision grace period

**Phase C (depends on Phase B):**
- Gap 7: Volume recovery wiring in bootstrap
- Gap 8: Cross-provider integration test

---

## Summary Table

| Gap | Effort | Files Changed | New Files | Status |
|-----|--------|--------------|-----------|--------|
| 1. Validation/Quarantine REST | Small | 1 modified | 2 new | Mostly done, needs REST exposure |
| 2. Artifact Upload Flow | Medium | 4 modified | 0 | Plumbing exists, needs content storage + adapter changes |
| 3. Crash Detection | Medium | 1 modified | 0 | Infrastructure exists, needs wiring |
| 4. Coherence Triggering | Small | 0 modified | 0 | **Already implemented**, needs test |
| 5. providerConfig Passthrough | Small | 4 modified | 0 | **Already works**, needs verification |
| 6. Orphan Grace Period | Medium | 2 modified | 0 | DecisionQueue needs grace period logic |
| 7. Volume Recovery Wiring | Medium | 2 modified | 0 | Service exists, needs bootstrap wiring |
| 8. Cross-Provider Test | Medium | 0 modified | 1 new | Pure test, all infra exists |
