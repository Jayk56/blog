# Adapter Shims

Adapter shims are the RPC boundary between the project-tab backend and AI agent
sandboxes. Each shim translates a provider-specific CLI or SDK into a common wire
protocol (HTTP + WebSocket), so the backend doesn't care what powers each agent.

The backend connects to shims via `LocalHttpPlugin` (ports 9100-9199) or
`ContainerPlugin` (ports 9200-9299). From the backend's perspective, every shim
looks identical.

```
Backend (port 3001)
  |
  |-- LocalHttpPlugin --> OpenAI Adapter Shim (port 9100)  --> codex CLI
  |-- LocalHttpPlugin --> Claude Adapter Shim (port 9101)  --> claude CLI
  |-- ContainerPlugin --> Any adapter in Docker (port 9200) --> any SDK
```

## Wire Protocol

Every adapter must implement these HTTP endpoints and one WebSocket endpoint.

### HTTP Endpoints

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| GET | /health | -- | `SandboxHealthResponse` | Liveness + agent status |
| POST | /spawn | `AgentBrief` | `AgentHandle` | Start an agent with a brief |
| POST | /kill | `KillRequest` | `KillResponse` | Terminate the agent |
| POST | /pause | -- | `SerializedAgentState` | Pause and serialize state |
| POST | /resume | `SerializedAgentState` | `AgentHandle` | Resume from serialized state |
| POST | /resolve | `ResolveRequest` | `{status, decisionId}` | Resolve a pending decision |
| POST | /checkpoint | `{decisionId}` | `SerializedAgentState` | Snapshot state without stopping |
| POST | /inject-context | `ContextInjection` | `{status: "accepted"}` | Inject knowledge context |
| POST | /update-brief | `{...changes}` | `{status: "accepted"}` | Queue brief changes |

### WebSocket

| Path | Direction | Payload |
|------|-----------|---------|
| WS /events | Server -> Client | `AdapterEvent` (JSON) |

The WS endpoint streams events as they're produced. The app layer polls the
runner's internal buffer every 50ms and forwards events to connected clients.
Buffer cap: 1000 events (oldest dropped on overflow).

## AdapterEvent Envelope

Every event is wrapped in an envelope before sending over WS:

```
{
  "sourceEventId":    "uuid",           // unique per event
  "sourceSequence":   1,                // monotonic, starts at 1
  "sourceOccurredAt": "ISO-8601",       // when the event occurred
  "runId":            "uuid",           // stable for the lifetime of one run
  "event":            { ... }           // AgentEvent payload (see below)
}
```

## AgentEvent Types

The `event` field is one of these discriminated unions (keyed by `type`):

| Type | Key Fields | Description |
|------|-----------|-------------|
| `status` | `agentId`, `message` | Free-text status update |
| `tool_call` | `agentId`, `toolCallId`, `toolName`, `phase`, `input`, `output` | Tool invocation lifecycle (requested/running/completed/failed) |
| `decision` (subtype: `tool_approval`) | `agentId`, `decisionId`, `toolName`, `toolArgs`, `severity` | Agent needs human approval for a tool call |
| `decision` (subtype: `option`) | `agentId`, `decisionId`, `title`, `options[]`, `severity` | Agent presents options for human choice |
| `artifact` | `agentId`, `artifactId`, `name`, `kind`, `workstream`, `uri` | File produced or modified |
| `completion` | `agentId`, `summary`, `outcome`, `artifactsProduced[]` | Agent finished (success/partial/abandoned/max_turns) |
| `error` | `agentId`, `severity`, `message`, `category`, `recoverable` | Something went wrong |
| `lifecycle` | `agentId`, `action` | Started/paused/resumed/killed/crashed |
| `progress` | `agentId`, `operationId`, `description`, `progressPct` | Progress on a tracked operation |

## Runner Interface

Internally, each adapter has runner classes that implement this contract. The app
layer (HTTP+WS endpoints) consumes runners through these methods only:

**Properties:**
- `brief` -- the AgentBrief that was passed to spawn
- `agentId` -- unique agent identifier
- `sessionId` -- conversation/session token (used for resume)
- `handle` -- `AgentHandle` with current status
- `isRunning` -- whether the agent is active

**Methods:**
- `start()` -- begin execution (async internally)
- `drainEvents()` -> `AdapterEvent[]` -- return buffered events (synchronous, non-blocking)
- `resolveDecision(request)` -> `bool` -- unblock a pending decision
- `kill(grace)` -> `KillResponse` -- terminate the agent
- `pause()` -> `SerializedAgentState` -- pause and serialize
- `getCheckpoint(decisionId)` -> `SerializedAgentState` -- snapshot without stopping

The app layer has **zero runner-specific logic** -- it selects a runner class at
spawn time based on `--mock` flag and then interacts purely through this interface.

## Three-Module Pattern

Real (non-mock) runners follow a consistent three-module structure:

1. **brief-to-prompt** -- Converts `AgentBrief` into a plain-text prompt string
   for the CLI/SDK. Renders role, workstream, description, project brief, goals,
   constraints, and knowledge snapshot summary. Capped at ~8000 characters.

2. **event-mapper** -- Stateful class that converts provider-specific streaming
   events (NDJSON lines, SDK callbacks) into `AgentEvent[]`. Tracks open tool
   calls by ID to correlate start/complete pairs. Extracts session IDs.

3. **runner** -- Spawns the CLI subprocess (or SDK streaming call), reads output,
   feeds it through the event mapper, buffers results. Implements the full
   runner interface including kill/pause/resume lifecycle.

## Artifact Kind Inference

When a file is created or modified, the event mapper infers the artifact kind
from the file path:

| Pattern | Kind |
|---------|------|
| `.test.` / `.spec.` / `test_` prefix | `test` |
| `.ts` `.js` `.py` `.rs` `.go` `.java` `.tsx` `.jsx` | `code` |
| `.md` `.txt` `.rst` | `document` |
| `.json` `.yaml` `.yml` `.toml` `.ini` `.cfg` | `config` |
| everything else | `other` |

Test patterns are checked first (a file named `foo.test.ts` is `test`, not `code`).

## SdkCheckpoint and Resume

`SerializedAgentState` contains an `SdkCheckpoint` with these fields:

| Field | Used By | Purpose |
|-------|---------|---------|
| `sdk` | All | Runner identifier ("codex", "claude", "mock") |
| `sessionId` | CLI runners | CLI session token for `--resume` |
| `runStateJson` | SDK runners (future) | Serialized message history |
| `lastMessageId` | SDK runners (future) | Last API message ID |
| `stateSnapshot` | Any | Freeform state dict |
| `scriptPosition` | Mock runners | Position in scripted sequence |

CLI runners resume via session ID: `codex exec resume <id>` or
`claude --resume <id>`. Future SDK runners would serialize message history
into `runStateJson`.

## Adding a New Adapter

1. Create a directory: `adapter-shim/<provider>/`
2. Define models matching the wire protocol types (or import from a shared package)
3. Implement a **MockRunner** with a scripted event sequence for testing
4. Build the app layer (HTTP endpoints + WS /events) consuming the runner interface
5. Write integration tests against the mock runner
6. Implement **brief-to-prompt** for your provider's prompt format
7. Implement an **event mapper** for your provider's streaming output format
8. Implement a **real runner** that spawns the CLI/SDK and uses the event mapper
9. Wire the real runner into the app layer (select based on `--mock` flag)
10. Add `--workspace` CLI flag for the agent's working directory
11. Write unit tests for brief-to-prompt, event mapper, and runner (with mock subprocess)

Use the existing adapters as reference implementations.

## Existing Adapters

| Directory | Language | Framework | CLI | Plugin Names |
|-----------|----------|-----------|-----|-------------|
| `openai/` | Python 3.10+ | FastAPI + uvicorn | `codex exec --json` | `openai-codex`, `openai-mock` |
| `claude/` | TypeScript | Express + ws | `claude -p --output-format stream-json` | `claude-cli`, `claude-mock` |

## Running

```bash
# OpenAI adapter -- mock mode
cd openai && source .venv/bin/activate
python -m adapter_shim --port 9100 --mock

# OpenAI adapter -- real mode (requires codex CLI)
python -m adapter_shim --port 9100 --workspace /path/to/project

# Claude adapter -- mock mode
cd claude
npx tsx src/index.ts --port 9100 --mock

# Claude adapter -- real mode (requires claude CLI)
npx tsx src/index.ts --port 9100 --workspace /path/to/project
```

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 9100 (or `AGENT_PORT` env) | Port to listen on |
| `--host` | 127.0.0.1 | Host to bind to |
| `--mock` | false | Run with scripted mock events |
| `--workspace` | cwd | Working directory for the agent |

## Testing

```bash
# OpenAI (128 tests)
cd openai && source .venv/bin/activate && python -m pytest

# Claude (139 tests)
cd claude && npx vitest run
```
