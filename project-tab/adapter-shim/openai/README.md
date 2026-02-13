# OpenAI Adapter Shim

Python adapter shim implementing the project-tab wire protocol. Translates
between the Codex CLI (`codex exec --json`) and the common event stream.

Two modes:
- **Mock** -- scripted event sequence for integration testing (no API key needed)
- **Real** -- spawns the Codex CLI in full-auto mode, parses NDJSON stdout

## Setup

Requires Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Running

```bash
# Mock mode
python -m adapter_shim --port 9100 --mock

# Real mode (requires codex CLI on PATH)
python -m adapter_shim --port 9100 --workspace /path/to/project
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 9100 (or `AGENT_PORT` env) | Port to listen on |
| `--host` | 127.0.0.1 | Host to bind to |
| `--mock` | false | Scripted mock mode |
| `--workspace` | None | Working directory passed as `--cd` to Codex |

## Directory Layout

```
adapter_shim/
  __main__.py          Entry point (argparse + uvicorn)
  app.py               FastAPI app factory, HTTP + WS endpoints, AppState
  models.py            Pydantic models for all wire protocol types
  events.py            EventFactory -- wraps AgentEvent in AdapterEvent envelope
  mock_runner.py       MockRunner (PLUGIN_NAME = "openai-mock")
  codex_runner.py      CodexRunner (PLUGIN_NAME = "openai-codex")
  brief_to_prompt.py   Converts AgentBrief -> prompt string for Codex CLI
  event_mapper.py      CodexEventMapper -- maps Codex NDJSON -> AgentEvent[]
  artifact_upload.py   Optional artifact URI rewriting via AGENT_BOOTSTRAP env

tests/
  conftest.py          Shared fixtures (make_test_brief, async client)
  test_endpoints.py    HTTP endpoint integration tests
  test_websocket.py    WebSocket event streaming tests
  test_mock_runner.py  MockRunner event sequence tests
  test_codex_runner.py CodexRunner tests (mock subprocess)
  test_brief_to_prompt.py  Prompt rendering tests
  test_event_mapper.py     Event mapping tests for all Codex NDJSON types
  test_events.py       EventFactory envelope tests
  test_models.py       Pydantic model round-trip tests
  test_artifact_upload.py  Artifact upload rewriting tests
  fixtures/
    codex_session.ndjson   Hand-written Codex output covering all event types
```

## Modules

### app.py

FastAPI application factory. `create_app(mock, workspace)` returns a configured
app with all wire protocol endpoints. Selects `MockRunner` or `CodexRunner`
based on the `mock` flag. The WS `/events` endpoint polls `drainEvents()` every
50ms and forwards to connected clients. Event buffer capped at 1000.

### mock_runner.py

`MockRunner` emits a scripted sequence for integration testing:

1. `LifecycleEvent(started)`
2. `StatusEvent("Starting task...")`
3. `ToolCallEvent` sequence (file_search: requested -> running -> completed)
4. `ToolApprovalEvent` -- blocks until `POST /resolve`
5. After resolve: `ArtifactEvent` (report.md, kind=document)
6. `CompletionEvent(success)`

Plugin name: `openai-mock`

### codex_runner.py

`CodexRunner` spawns `codex exec --full-auto --json [--cd workspace] <prompt>`
and reads NDJSON from stdout. Uses `CodexEventMapper` to convert lines into
wire protocol events.

- Resume: `codex exec resume <session_id> --full-auto --json <prompt>`
- Kill: SIGTERM, wait 5s, SIGKILL if needed
- Pause: terminate + serialize state with session_id in checkpoint
- CLI not found: `ErrorEvent` + `CompletionEvent(abandoned)`
- Non-zero exit: `ErrorEvent` + `LifecycleEvent(crashed)`

Plugin name: `openai-codex`

### brief_to_prompt.py

`brief_to_prompt(brief: AgentBrief) -> str`

Renders a structured prompt from the brief:
- Role and workstream
- Description
- Project title and description
- Goals (bulleted)
- Constraints (merged from brief + project brief)
- Knowledge snapshot summary (workstream/decision/artifact counts)

Capped at ~8000 characters (~2000 tokens).

### event_mapper.py

`CodexEventMapper` -- stateful class that tracks open tool calls by `item_id`.

| Codex NDJSON Event | Wire Protocol Event(s) |
|---|---|
| `thread.started` | Extract `thread_id` as session_id (no event emitted) |
| `turn.started` | `StatusEvent("Turn N started")` |
| `turn.completed` | `StatusEvent` with input/output token counts |
| `turn.failed` | `ErrorEvent(severity=high, category=model)` |
| `item.started` type=`command_execution` | `ToolCallEvent(phase=requested, toolName=Bash)` |
| `item.completed` type=`command_execution` | `ToolCallEvent(phase=completed/failed by exit_code)` |
| `item.started` type=`file_change` | `ToolCallEvent(phase=requested, toolName=Edit)` |
| `item.completed` type=`file_change` | `ToolCallEvent(completed)` + `ArtifactEvent` |
| `item.completed` type=`agent_message` | `StatusEvent` (text truncated to 500 chars) |
| `item.*` type=`mcp_tool_call` | `ToolCallEvent` with provider tool name |
| `item.completed` type=`todo_list` | `ProgressEvent` with completion percentage |
| `item.*` type=`reasoning` | Skipped |

Tool call correlation: `item.started` stores `{tool_call_id, tool_name, start_time}`
keyed by `item_id`. `item.completed` pops the entry and calculates duration.

### events.py

`EventFactory(run_id)` wraps `AgentEvent` payloads in `AdapterEvent` envelopes
with a monotonically increasing sequence number, UUID event ID, and ISO-8601
timestamp.

### artifact_upload.py

If the `AGENT_BOOTSTRAP` environment variable contains a JSON object with an
`artifactUploadEndpoint` key, artifact events are uploaded to that endpoint and
their URIs are rewritten to the backend-returned `backendUri`.

## Testing

```bash
source .venv/bin/activate
python -m pytest          # 128 tests
python -m pytest -x -v    # verbose, stop on first failure
```

| Test File | Count | Covers |
|-----------|-------|--------|
| test_endpoints.py | 17 | All HTTP endpoints |
| test_websocket.py | 3 | WS event streaming |
| test_mock_runner.py | 11 | Mock event sequence, kill, pause |
| test_codex_runner.py | 35 | Mock subprocess, kill, pause, errors |
| test_brief_to_prompt.py | 8 | Prompt rendering edge cases |
| test_event_mapper.py | 24 | All NDJSON event types, artifact inference |
| test_events.py | 6 | Envelope sequencing |
| test_models.py | 15 | Pydantic serialization round-trips |
| test_artifact_upload.py | 9 | URI rewriting |
