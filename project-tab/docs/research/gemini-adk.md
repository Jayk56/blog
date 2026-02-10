# Google Gemini Agent Development Kit (ADK) -- Research Summary for Project Tab Backend

*Researched 2026-02-09. Source: Training data through May 2025 + Google Cloud Next '25 announcements. Note: web access was unavailable during this research session, so post-mid-2025 updates may be missing.*

## 1. What Is It?

**Official name**: Agent Development Kit (ADK)

**Package**: `google-adk` on PyPI (Python). Java/Kotlin variant in development.

**Repo**: `github.com/google/adk-python`

**Release status**: Open-source, Apache 2.0 license. Announced at Google Cloud Next '25 (April 2025). Rapidly evolving, started at v0.x.

## 2. Architecture

Built around compositional agent trees:

- **`Agent` (LlmAgent)**: Model + instructions + tools + sub-agents + callbacks
- **`SequentialAgent`**: Runs sub-agents in sequence
- **`ParallelAgent`**: Runs sub-agents concurrently (fan-out)
- **`LoopAgent`**: Runs sub-agents in loop until condition met
- **`CustomAgent`**: Base class for arbitrary orchestration
- **Tool**: Python functions with auto-generated schemas. Supports FunctionTool, LongRunningFunctionTool, built-in tools, LangChain/CrewAI adapters, MCP
- **Session/SessionService**: Conversation + state persistence. State is key-value dict with prefix scoping (`app:`, `user:`, session-local)
- **Runner**: Orchestrates execution, returns async iterable of Events
- **Event**: Every action produces an Event (messages, tool calls, agent transfers, state deltas)
- **ArtifactService**: Binary artifact storage (in-memory, GCS)
- **MemoryService**: Long-term cross-session memory

**Richest built-in orchestration** of the three SDKs. Hierarchical (parent delegates to children), not peer-to-peer.

## 3. Agent Lifecycle

- **Spawning**: Instantiate Agent objects, run via Runner
- **Pause/Resume**: No first-class "pause mid-thought". Session-based continuity (stop processing, resume later with same session).
- **Terminate**: Stop runner execution. `escalate()` for sub-agent -> parent signals.
- **Sessions**: First-class. Create/retrieve/delete via SessionService. Each session has id, user_id, state dict, events.
- **Gap**: No built-in agent fleet management (active/idle/blocked tracking).

## 4. Structured Output

Supports `output_type` via Pydantic models. Agent constrained to return structured JSON matching schema. Works well with Gemini's structured output mode.

## 5. Human-in-the-Loop

No dedicated "ask human" primitive. Supported through:

1. **Tool-based HITL**: Define `request_human_decision` tool. Returns control to app, app surfaces to UI, sends result back as tool return.
2. **Callback-based HITL**: `before_tool_call` / `before_model_call` callbacks intercept execution for approval.
3. **Session state flags**: Agent sets `state["awaiting_human"] = True`, terminates turn. App polls/subscribes.

**Must build**: Decision queue service, WebSocket push, resolution endpoint, timeout/escalation.

## 6. Multi-Agent

Strong multi-agent support:

1. **Agent delegation**: Parent has `sub_agents`, transfers control via special function
2. **`ParallelAgent`**: Run multiple sub-agents concurrently on same input
3. **`SequentialAgent`**: Chain sub-agents, piping context
4. **Shared state**: All agents in session tree share `state` dict
5. **`AgentTool`**: Wrap agent as callable tool

**Gap**: "Ecosystem" mode (peer-to-peer self-organization) requires custom orchestration. ADK model is hierarchical.

## 7. Tool Use

- **FunctionTool**: Python functions with type annotations, auto-schema
- **LongRunningFunctionTool**: Async operations with ticket/poll pattern
- **Built-in**: Google Search, code execution (sandboxed), Vertex AI extensions
- **LangChain/CrewAI adapters**: Wrap existing tools
- **MCP**: First-class support via `MCPToolset`

## 8. Observability

- **Event stream**: Every action produces an Event with author, content, actions, state_delta, timestamps
- **Built-in dev UI**: `adk web` provides chat, event trace, state inspector, tool monitoring
- **Tracing**: OpenTelemetry integration, Google Cloud Trace, Cloud Logging
- **Event-driven architecture aligns naturally with real-time UI updates**

## 9. State / Memory

### Session State
- `session.state` dict persists across turns
- Prefix scoping: `app:key` (all sessions), `user:key` (user sessions), no prefix (session-local)
- State changes tracked as deltas in events

### Persistence Backends
- **InMemorySessionService** (dev)
- **DatabaseSessionService** (SQLite/PostgreSQL)
- **VertexAiSessionService** (managed)

### Memory Service
- **InMemoryMemoryService**: Conversation summaries
- **VertexAiRagMemoryService**: Semantic memory via RAG

### Artifact Storage
- **InMemoryArtifactService** (dev)
- **GcsArtifactService** (Google Cloud Storage)

**Gap**: State model is flat key-value dict. Our deeply nested project state needs mapping layer or external DB as primary store.

## 10. Trust / Control Hooks

Callbacks at key points:
- **`before_model_call`**: Inspect/modify LLM request
- **`after_model_call`**: Inspect/modify response
- **`before_tool_call`**: Intercept tool invocations (approve/deny/modify)
- **`after_tool_call`**: Inspect/modify tool results

All callbacks receive full context (agent, session state, invocation details).

**Dynamic instructions**: Agent instructions can reference session state via templates. Change behavior by updating state.

**Control mode mapping**:
- Orchestrator: `before_tool_call` requires approval for all
- Adaptive: Callbacks check trust scores in state, threshold adjusts
- Ecosystem: Minimal callbacks, boundary enforcement only
- Emergency brake: Flag in shared state, all callbacks check it

## 11. Deployment

- **Local**: `pip install google-adk`, `adk web` / `adk run`. Python 3.9+.
- **Google Cloud**: Vertex AI Agent Engine (managed), Cloud Run (container), GKE
- **Self-hosted**: Open-source core has no GCP dependencies. Vertex-specific services optional.
- **Model flexibility**: Designed for Gemini, others via LiteLLM

## 12. Integration Pattern

```
React Frontend (Project Tab)
    |
    | WebSocket
    |
Python Backend (FastAPI)
    |
    |-- Project Manager Service
    |     - WebSocket hub
    |     - Decision queue (collect, score, serve)
    |     - Control policy engine
    |     - Briefing generator
    |
    |-- ADK Layer
    |     - Root Orchestrator Agent
    |       |-- Agent A (code)
    |       |-- Agent B (design)
    |       |-- Agent C (review)
    |     - SessionService (Postgres/SQLite)
    |     - ArtifactService (local FS / GCS)
    |     - MemoryService
    |
    |-- MCP Servers
          - Filesystem, Git, Code execution, APIs
```

## 13. Gaps for Project Tab

**Must build yourself**:
1. Decision queue with attention scoring
2. Trust trajectory system
3. Coherence monitoring / knowledge map
4. Briefing narrative generation
5. Control mode policy engine
6. Emergency brake
7. Agent fleet visualization (active/idle/blocked)
8. WebSocket layer to React frontend
9. Peer-to-peer agent communication (for ecosystem mode)
10. Temporal navigation (replay from event history)

**Works well out of the box**:
- Agent definition and execution
- Multi-agent orchestration (Sequential, Parallel, Loop)
- Tool use with MCP support
- Session state with prefix scoping
- Event streaming for observability
- Callbacks for control injection
- Structured output via Pydantic
- Artifact storage service
- Memory service (cross-session)
- Flexible deployment (local or cloud)
