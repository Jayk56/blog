# Gemini Agent SDK Shim Plan (Backend Workstream)

## Goal

Add a Gemini-based adapter shim that matches the existing Project Tab wire protocol and can run alongside OpenAI and Claude plugins without changing frontend contracts.

## Current Baseline

- Existing shims:
  - `adapter-shim/openai` (Python, FastAPI)
  - `adapter-shim/claude` (TypeScript, Express)
- Backend already supports Gemini checkpoint typing:
  - `server/src/types/plugin.ts`
  - `server/src/validation/schemas.ts`
- Runtime plugin registration currently only wires `openai` in `server/src/index.ts`.
- Spawn plugin selection currently relies on `brief.modelPreference` in `server/src/routes/agents.ts`.

## Scope

- In scope:
  - New Gemini shim package in `adapter-shim/gemini` (Python).
  - Mock runner + real runner + event mapper.
  - Backend plugin wiring for Gemini local-process execution.
  - Tests for shim, plugin wiring, and cross-provider flow.
- Out of scope (phase-later):
  - Vertex-hosted deployment path.
  - Advanced memory/RAG backends.
  - Full autonomous sub-agent trees.

## Implementation Strategy

Build Gemini shim from the OpenAI Python shim scaffold to minimize protocol drift and speed delivery. Keep app layer identical; isolate provider-specific behavior in `gemini_runner.py` and `event_mapper.py`.

## Phase Plan

### Phase 0: ADK Contract Verification (1-2 days)

- Validate current Gemini ADK APIs for:
  - Streaming event surface.
  - Tool interception callbacks (`before_tool_call`-style gating).
  - Session continuity and resume behavior.
  - State serialization shape suitable for `stateSnapshot`.
- Produce a short compatibility note in the shim README (what is exact vs best-effort).

Exit criteria:
- One throwaway spike script confirms event stream + tool interception + session reuse.

### Phase 1: Gemini Shim Scaffold + Mock Mode (2 days)

- Create `adapter-shim/gemini` with:
  - `pyproject.toml`
  - `adapter_shim/__main__.py`
  - `adapter_shim/app.py`
  - `adapter_shim/models.py`
  - `adapter_shim/events.py`
  - `adapter_shim/mock_runner.py`
  - `adapter_shim/artifact_upload.py`
  - `adapter_shim/brief_to_prompt.py`
- Keep endpoint parity with existing shim contract:
  - `GET /health`, `POST /spawn|kill|pause|resume|resolve|checkpoint|inject-context|update-brief`, `WS /events`.
- Include debug endpoint in mock mode:
  - `GET /debug/config` for providerConfig passthrough verification.

Exit criteria:
- Endpoint and websocket tests pass in mock mode.

### Phase 2: Real Gemini Runner + Event Mapping (3-4 days)

- Implement `adapter_shim/gemini_runner.py`:
  - Start Gemini session/run.
  - Stream provider events.
  - Handle cancellation/kill.
  - Pause/checkpoint serialization with `checkpoint.sdk = "gemini"`.
- Implement `adapter_shim/event_mapper.py`:
  - Provider stream -> `AgentEvent` conversion (`status`, `tool_call`, `decision`, `artifact`, `completion`, `error`, `lifecycle`, `progress`, optional `raw_provider`).
  - Tool-call correlation and duration tracking.
  - Artifact kind inference + URI rewriting hook.
- Decision handling:
  - Block on intercepted tool calls.
  - Map backend `POST /resolve` to unblock callback and continue execution.
  - Support `alwaysApprove` via shim-side allow-list (session scoped).

Exit criteria:
- Real runner unit tests pass with mocked provider stream.
- Decision blocking/resolution works end-to-end in shim tests.

### Phase 3: Backend Gemini Plugin Wiring (1-2 days)

- Register Gemini local-process plugin in `server/src/index.ts`.
- Add provider-specific shim env config (recommended):
  - `OPENAI_SHIM_COMMAND`, `OPENAI_SHIM_ARGS`
  - `GEMINI_SHIM_COMMAND`, `GEMINI_SHIM_ARGS`
- Keep default plugin behavior stable.
- Improve spawn plugin selection in `server/src/routes/agents.ts`:
  - Prefer explicit plugin selector when provided.
  - Fallback to `defaultPlugin`.
  - Avoid overloading model ID as plugin name.

Exit criteria:
- Backend can spawn Gemini and OpenAI plugins concurrently.

### Phase 4: Integration + Cross-Provider Tests (2 days)

- Add shim tests mirroring OpenAI structure:
  - `test_endpoints.py`, `test_websocket.py`, `test_mock_runner.py`, `test_gemini_runner.py`, `test_event_mapper.py`, `test_models.py`, `test_events.py`, `test_artifact_upload.py`.
- Add backend integration test:
  - Spawn OpenAI + Gemini agents in same project.
  - Verify both streams reach EventBus.
  - Verify independent trust/queue behavior.
  - Verify one crash does not kill sibling agent.

Exit criteria:
- New tests pass in CI with deterministic mock fixtures.

## File-Level Change Map

- New:
  - `adapter-shim/gemini/**`
  - `server/test/integration/cross-provider-gemini.test.ts` (or extend existing cross-provider file)
- Modified:
  - `server/src/index.ts`
  - `server/src/routes/agents.ts`
  - `server/src/validation/schemas.ts` (if spawn request schema gains explicit plugin selector)
  - `server/test/routes/wiring.test.ts`
  - `server/test/routes/provider-config.test.ts` (only if request shape changes)

## Acceptance Criteria

- Protocol parity:
  - All required endpoints present and schema-compatible.
  - WS events are valid `AdapterEvent` envelopes.
- Lifecycle:
  - Spawn/kill/pause/resume/checkpoint work without backend exceptions.
- Decision flow:
  - Tool approval decisions block and resume correctly.
- Artifacts:
  - Artifact uploads rewrite local URIs to backend `artifact://` URIs when bootstrap endpoint is set.
- Recovery:
  - Backend crash detection emits synthetic error/lifecycle events for Gemini shim exits.
- Interop:
  - Gemini and OpenAI agents can run simultaneously under one backend instance.

## Risks and Mitigations

- ADK API churn risk:
  - Mitigation: Phase 0 verification gate before implementation.
- Pause/resume is best-effort, not exact mid-thought replay:
  - Mitigation: document capability semantics and checkpoint expectations.
- Deadlock risk in tool interception callbacks:
  - Mitigation: timeout + fallback error event path + integration tests for unresolved decisions.
- Plugin selection ambiguity (`modelPreference` overload):
  - Mitigation: add explicit plugin selector in spawn request.

## Delivery Estimate

- Total: 8-12 working days.
- Suggested checkpoint cadence:
  - End of week 1: Phases 0-2 complete (shim usable locally).
  - Mid week 2: Phases 3-4 complete (backend wired + integration coverage).
