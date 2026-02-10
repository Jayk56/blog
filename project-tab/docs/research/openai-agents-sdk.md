# OpenAI Agents SDK -- Research Summary for Project Tab Backend

*Researched 2026-02-09. Source: PyPI, GitHub, OpenAI documentation*

## 1. What Is It?

**Official name**: OpenAI Agents SDK (package: `openai-agents`, import as `from agents import ...`)

**Version**: v0.8.3 (Feb 10, 2026). 55 releases, 18.9k stars, 217 contributors, 4,500+ dependents.

**Repos**: `github.com/openai/openai-agents-python` (Python), `github.com/openai/openai-agents-js` (JS/TS)

**Release status**: Open-source, MIT license. Official successor to OpenAI Swarm. Production-ready.

**Provider-agnostic**: Supports 100+ LLMs via LiteLLM. Works with both Responses API and Chat Completions API.

## 2. Architecture

Small set of primitives:

- **Agent**: LLM configured with `instructions`, `tools`, `handoffs`, `guardrails`, optional `output_type` (Pydantic model)
- **Runner**: Execution engine. `Runner.run(agent, input)` kicks off agent loop. Also `run_streamed()`.
- **Handoff**: Transfer control between agents
- **Guardrail**: Input/output/tool-level validation checks
- **Session**: Persistent memory for conversation history (SQLite, Redis, SQLAlchemy, custom)
- **Tracing**: Built-in observability with traces and spans

Core is a **single-agent loop** that becomes multi-agent through handoffs and agent-as-tool patterns. Sequential delegation, not concurrent swarm.

## 3. Agent Lifecycle

- **Spawning**: Declarative `Agent()` objects. Run via `Runner.run(agent, input)`.
- **Runner loop**: LLM call -> check for final output/handoff/tool calls -> execute -> loop. `max_turns` to limit.
- **Pause/Resume**: `RunState` serialization. `result.to_state()` -> serialize to JSON -> store -> restore with `RunState.from_json()` -> resume with `Runner.run(agent, state)`. Genuine pause/resume with persistence.
- **Termination**: Loop ends on final output, `max_turns`, or guardrail tripwire. No explicit "kill".
- **Important**: Agents are stateless config objects. Runner executes them request-response. Continuity via Sessions.

## 4. Structured Output

**First-class via Pydantic models.** Set `output_type` on Agent to any `BaseModel`. SDK uses OpenAI Structured Outputs to guarantee schema conformance.

Function tools also get automatic schema generation from type annotations via `@function_tool`.

## 5. Human-in-the-Loop

**Built-in, first-class.** Best HITL story of the three SDKs.

1. **`needs_approval=True`** on `@function_tool` (or async callback for per-call decisions)
2. Runner pauses, `result.interruptions` contains `ToolApprovalItem` entries
3. Serialize: `result.to_state().to_string()` -> store in DB
4. Later: load state, `state.approve(interruption)` or `state.reject(interruption)`
5. Resume: `Runner.run(agent, state)`
6. **Blanket approvals**: `state.approve(interruption, always_approve=True)`

The `needs_approval` callback is perfect for control modes: Orchestrator = always True, Adaptive = check trust/blast-radius, Ecosystem = mostly False.

## 6. Multi-Agent

Two patterns:

### Handoffs (LLM-directed)
Agent declares `handoffs=[other_agents]`. LLM decides when to delegate. Sequential transfer, not concurrent.

### Agent as Tool (code-directed)
`agent.as_tool()` wraps agent as callable tool. Supports `needs_approval`.

### Code orchestration
For concurrency: `asyncio.gather(Runner.run(agent_a, task_a), Runner.run(agent_b, task_b))`

**No built-in supervisor/orchestrator.** You build the orchestration layer in Python.

## 7. Tool Use

- **`@function_tool`**: Decorated Python functions. Auto-schema from type annotations. Pydantic validation.
- **MCP servers**: `MCPServerStdio`, `MCPServerSse`, `MCPServerStreamableHttp`
- **Hosted tools**: `WebSearchTool`, `FileSearchTool`, `CodeInterpreterTool`, `ImageGenerationTool`
- **Shell/Patch tools**: `ShellTool`, `ApplyPatchTool` with approval support

## 8. Guardrails

Three levels:
1. **Input guardrails**: Before/alongside agent execution. Tripwire raises exception.
2. **Output guardrails**: After completion. Same tripwire pattern.
3. **Tool guardrails**: Wrap individual tools. Can block/skip/replace calls or results.

Guardrails can be agent-powered (cheap model validates expensive model).

**For trust/control**: Input guardrails for scope enforcement, output guardrails for quality thresholds, tool guardrails for review gates based on control mode.

## 9. Observability/Tracing

- **Automatic tracing** of all runs (agent invocations, LLM calls, tool executions, handoffs)
- Integrates with OpenAI dashboard, Logfire, AgentOps, Braintrust, etc.
- **Custom trace processors** for own backends
- **`Runner.run_streamed()`** returns `RunResultStreaming` with `.stream_events()` async generator
- **Custom spans** for tracing custom logic

`stream_events()` is the key integration point for feeding the React frontend via WebSocket.

## 10. State Persistence

**Sessions**:
- `SQLiteSession` (file or in-memory)
- `RedisSession` (distributed)
- `SQLAlchemySession` (any SQL DB)
- `EncryptedSession`
- Custom via `Session` protocol

**RunState**: Full execution state serialized to JSON for HITL pause/resume. Stored anywhere.

**Not persisted**: Agent definitions (code-level config). Must reconstruct Agent objects.

## 11. Integration Pattern

```
React Frontend (Project Tab)
    |
    | WebSocket + REST API
    |
Python Backend (FastAPI/Starlette)
    |-- Agent Definitions (Agent objects with tools, guardrails, handoffs)
    |-- Orchestrator Layer (asyncio, manages concurrent agents)
    |-- State Store (SQLite/Postgres for sessions, RunStates, project state)
    |-- Event Bridge (stream_events -> WebSocket)
    |
    |-- OpenAI Agents SDK
            |-- Runner.run_streamed() per active agent
            |-- Sessions for conversation persistence
            |-- RunState for HITL pause/resume
            |-- Guardrails for trust/control
            |-- Tracing for observability
```

### Decision Queue Flow
1. Agent hits tool with `needs_approval=callback` (callback checks trust)
2. Runner pauses. `result.interruptions` contains pending approval.
3. Backend serializes `RunState` to DB, emits WebSocket event.
4. Frontend renders decision in Queue.
5. Human approves/rejects via UI.
6. Backend loads RunState, `state.approve()`, resumes `Runner.run()`.

### Emergency Brake
Cancel all `asyncio.Task` objects running `Runner.run()`. Serialize RunStates for later resume.

## 12. Gaps for Project Tab

**Must build yourself**:
1. Orchestrator/supervisor layer (no built-in agent pool management)
2. Trust trajectories (no per-agent trust concept)
3. Attention scoring / decision prioritization
4. Coherence monitoring (cross-workstream)
5. Provenance tracking (artifact lineage)
6. Narrative generation (Briefing)
7. Control mode switching logic (guardrails provide hooks, policy is yours)
8. WebSocket event bridge (stream_events -> frontend)
9. Inter-agent shared context (agents don't see each other's outputs)

**Works well out of the box**:
- Agent definition and execution
- Structured output (Pydantic, enforced)
- HITL with serializable state (best of the three)
- Session persistence (multiple backends)
- Guardrails (input/output/tool level)
- Streaming events
- Tracing and observability
- MCP integration
- Model flexibility (LiteLLM, not locked to OpenAI)
