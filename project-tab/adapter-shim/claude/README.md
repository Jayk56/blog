# Claude Adapter Shim

TypeScript adapter shim implementing the project-tab wire protocol. Translates
between the Claude CLI (`claude -p --output-format stream-json`) and the common
event stream.

Two modes:
- **Mock** -- scripted Claude-themed event sequence for integration testing
- **Real** -- spawns the Claude CLI, parses stream-json NDJSON from stdout

Capabilities:
- `supportsPause`: false (pause kills the process; resume starts fresh with session ID)
- `supportsResume`: partial (resumes via `claude --resume <sessionId>`)
- `supportsKill`: partial (SIGTERM, escalates to SIGKILL)

## Setup

Requires Node 18+.

```bash
npm install
```

## Running

```bash
# Mock mode
npx tsx src/index.ts --port 9100 --mock

# Real mode (requires claude CLI on PATH)
npx tsx src/index.ts --port 9100 --workspace /path/to/project
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 9100 (or `AGENT_PORT` env) | Port to listen on |
| `--host` | 127.0.0.1 | Host to bind to |
| `--mock` | false | Scripted mock mode |
| `--workspace` | undefined | Working directory (cwd for claude process) |

npm scripts: `npm start` (live), `npm run start:mock` (mock), `npm test` (vitest).

## Directory Layout

```
src/
  index.ts             Entry point (arg parsing, HTTP server, WS setup)
  app.ts               Express app factory + WebSocket setup, AppState
  models.ts            TypeScript interfaces for all wire protocol types
  events.ts            EventFactory -- wraps AgentEvent in AdapterEvent envelope
  mock-runner.ts       MockRunner (PLUGIN_NAME = "claude-mock")
  claude-runner.ts     ClaudeRunner (PLUGIN_NAME = "claude-cli")
  brief-to-prompt.ts   Converts AgentBrief -> prompt string for Claude CLI
  event-mapper.ts      ClaudeEventMapper -- maps Claude stream-json -> AgentEvent[]
  artifact-upload.ts   Optional artifact URI rewriting via AGENT_BOOTSTRAP env

test/
  helpers.ts           Shared fixtures (makeTestBrief, TestClient, startTestServer)
  endpoints.test.ts    HTTP endpoint integration tests
  websocket.test.ts    WebSocket event streaming tests
  mock-runner.test.ts  MockRunner event sequence tests
  claude-runner.test.ts  ClaudeRunner tests (mock subprocess)
  brief-to-prompt.test.ts  Prompt rendering tests
  event-mapper.test.ts     Event mapping tests for all Claude stream-json types
  events.test.ts       EventFactory envelope tests
  models.test.ts       TypeScript model validation tests
  artifact-upload.test.ts  Artifact upload rewriting tests
  fixtures/
    claude_session.ndjson  Hand-written Claude output covering all message types
```

## Modules

### app.ts

Express application factory. `createApp({mock, workspace})` returns a configured
Express app. `setupWebSocket(server, app)` attaches the WS `/events` endpoint.
Selects `MockRunner` or `ClaudeRunner` based on the `mock` option. The WS
interval polls `drainEvents()` every 50ms. Event buffer capped at 1000.

### mock-runner.ts

`MockRunner` emits a Claude-themed scripted sequence:

1. `LifecycleEvent(started)`
2. `StatusEvent("Analyzing codebase...")`
3. `ToolCallEvent` sequence (Read tool: requested -> running -> completed)
4. `StatusEvent("Planning implementation...")`
5. `ToolCallEvent` sequence (Edit tool: requested -> completed)
6. `OptionDecisionEvent` -- architecture pattern choice, blocks until `POST /resolve`
7. After resolve: `ArtifactEvent` (pipeline.ts, kind=code)
8. `CompletionEvent(success)`

Plugin name: `claude-mock`

### claude-runner.ts

`ClaudeRunner` spawns `claude -p <prompt> --output-format stream-json --max-turns 50`
and reads NDJSON via `readline` on stdout. Uses `ClaudeEventMapper` to convert
lines into wire protocol events.

- Resume: `claude --resume <sessionId> -p <prompt> --output-format stream-json`
- Kill: SIGTERM, wait 5s, SIGKILL if needed
- Pause: terminate + serialize state with session_id in checkpoint
- Spawn error (ENOENT): `ErrorEvent` + `CompletionEvent(abandoned)`
- Non-zero exit: `ErrorEvent` + `LifecycleEvent(crashed)`

Plugin name: `claude-cli`

### brief-to-prompt.ts

`briefToPrompt(brief: AgentBrief): string`

Renders a structured prompt from the brief. Same logic as the Python version:
role, workstream, description, project brief, goals, constraints, knowledge
snapshot summary. Capped at ~8000 characters.

### event-mapper.ts

`ClaudeEventMapper` -- stateful class that tracks open tool calls by `tool_use.id`.

| Claude stream-json Event | Wire Protocol Event(s) |
|---|---|
| `{type: "system", subtype: "init"}` | Extract `session_id` (no event emitted) |
| `{type: "assistant"}` with text content blocks | `StatusEvent` (truncated to 500 chars) |
| `{type: "assistant"}` with `tool_use` content blocks | `ToolCallEvent(phase=requested)` per block |
| `{type: "result"}` with `tool_result` blocks | `ToolCallEvent(phase=completed/failed)` per block |
| `{type: "result"}` with `tool_result` for Write/Edit | + `ArtifactEvent` if `file_path` in input |
| `{type: "result", subtype: "success"}` | `CompletionEvent(outcome=success)` |
| `{type: "result", subtype: "error"}` | `CompletionEvent(outcome=abandoned)` |
| `{type: "result", subtype: "max_turns"}` | `CompletionEvent(outcome=max_turns)` |

Tool call correlation: `tool_use` blocks store `{toolCallId, toolName, startTime, input}`
keyed by `tool_use.id`. Matched when `tool_result` arrives with the same ID.

Artifact detection: `Write` or `Edit` tool completions where the input contains
`file_path` or `filePath` emit an `ArtifactEvent` with kind inferred from the
file extension.

### events.ts

`EventFactory(runId)` wraps `AgentEvent` payloads in `AdapterEvent` envelopes
with monotonic sequence numbers, UUID event IDs, and ISO-8601 timestamps.

### artifact-upload.ts

If the `AGENT_BOOTSTRAP` environment variable contains a JSON object with an
`artifactUploadEndpoint` key, artifact events are uploaded to that endpoint and
their URIs are rewritten to the backend-returned `backendUri`.

## Testing

```bash
npx vitest run          # 139 tests
npx vitest run --reporter=verbose   # verbose output
npx vitest              # watch mode
npm run typecheck       # tsc --noEmit
```

| Test File | Count | Covers |
|-----------|-------|--------|
| endpoints.test.ts | 17 | All HTTP endpoints |
| websocket.test.ts | 3 | WS event streaming |
| mock-runner.test.ts | 17 | Mock event sequence, kill, pause, decisions |
| claude-runner.test.ts | 25 | Mock subprocess, kill, pause, errors, full session |
| brief-to-prompt.test.ts | 13 | Prompt rendering, edge cases |
| event-mapper.test.ts | 30 | All stream-json types, artifact detection |
| events.test.ts | 6 | Envelope sequencing |
| models.test.ts | 19 | Type validation |
| artifact-upload.test.ts | 9 | URI rewriting |
