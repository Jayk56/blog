# Claude Agent SDK -- Research Summary for Project Tab Backend

*Researched 2026-02-09. Source: Anthropic platform docs at platform.claude.com*

## 1. What Is It?

**Official name**: Claude Agent SDK (formerly "Claude Code SDK").

**Packages**:
- TypeScript: `@anthropic-ai/claude-agent-sdk` (npm)
- Python: `claude_agent_sdk` (pip, package name `claude-agent-sdk`)

**Repos**: `github.com/anthropics/claude-agent-sdk-typescript`, `github.com/anthropics/claude-agent-sdk-python`, `github.com/anthropics/claude-agent-sdk-demos`

**Release status**: GA. Documented on official Anthropic platform docs with changelogs, issue trackers, and partner branding guidelines.

**Tagline**: "Build production AI agents with Claude Code as a library."

## 2. Architecture

The SDK is **Claude Code exposed as a programmatic library**. It wraps the same agent loop, tool execution engine, and context management that power the Claude Code CLI.

**Core abstractions**:
- **`query()`**: Primary function. Pass a `prompt` + `ClaudeAgentOptions`, get back an async iterator of messages. Claude autonomously calls tools, reads files, runs commands.
- **`ClaudeAgentOptions`**: Controls allowed tools, hooks, permissions, subagent definitions, MCP servers, system prompt sources.
- **`AgentDefinition`**: Defines a subagent with description, prompt, tool restrictions, model override.
- **Hooks**: Callbacks for lifecycle events (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, etc.).
- **`canUseTool` callback**: Human-in-the-loop approval mechanism.

**Hub-and-spoke model**: Main agent can spawn subagents via the `Task` tool, but subagents cannot spawn their own subagents (no recursive nesting).

## 3. Agent Lifecycle

- **Spawning**: Call `query()` to start an agent.
- **Termination**: Agent runs until complete, or return `{ continue: false }` from any hook.
- **Resuming**: Capture `session_id` from init message, pass `resume: sessionId` in subsequent `query()` call. Full conversation history preserved.
- **Forking**: `forkSession: true` creates branching paths from same starting point.
- **Missing**: No built-in "pause mid-execution" or explicit "kill" API. Must abort the async iterator.

## 4. Structured Output

No built-in mechanism to force typed output schemas. Approach:
- Define **custom MCP tools** with specific JSON schemas for `reportDecision`, `logArtifact`, `flagCoherenceIssue`
- Use **hooks** (`PostToolUse`) to intercept and capture structured tool calls
- Rely on prompt engineering for compliance

The `AskUserQuestion` tool demonstrates structured multi-choice schemas.

## 5. Human-in-the-Loop

Well-supported via multiple mechanisms:

1. **`canUseTool` callback**: Fires on unapproved tool use. Pause execution, return allow/deny/modify.
2. **`AskUserQuestion` tool**: Agent proactively asks structured multiple-choice questions (1-4 questions, 2-4 options each).
3. **`PermissionRequest` hook** (TS only): Route approval requests to external systems.
4. **Streaming input**: Send messages to agent mid-execution for interrupts/redirects.

**Limitation**: `AskUserQuestion` not available in subagents.

## 6. Multi-Agent

- Main agent spawns subagents via `Task` tool
- Subagents have **separate context** (isolated conversations)
- Multiple subagents can run **concurrently**
- Each gets own tools, model override, prompt
- **No peer-to-peer communication** between subagents
- **No recursive nesting** (subagents can't spawn sub-subagents)
- For true multi-agent orchestration, manage multiple `query()` calls from your backend

## 7. Tool Use

Comprehensive built-in tools:

| Tool | Capability |
|------|-----------|
| `Read` | Read any file |
| `Write` | Create new files |
| `Edit` | Precise string-replacement edits |
| `Bash` | Terminal commands, scripts, git |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents (regex) |
| `WebSearch` | Web search |
| `WebFetch` | Fetch and parse web pages |
| `AskUserQuestion` | Structured clarifying questions |
| `Task` | Invoke subagents |

MCP servers supported for additional tools. Tool access controlled via `allowed_tools`.

## 8. Observability

**Async message stream** from every `query()` call plus **11 hook events** (TypeScript):

| Hook | Captures |
|------|---------|
| `PreToolUse` | Tool call request (before execution) |
| `PostToolUse` | Tool execution result |
| `PostToolUseFailure` | Tool errors (TS only) |
| `SubagentStart` | Subagent spawning (TS only) |
| `SubagentStop` | Subagent completion |
| `SessionStart/End` | Session lifecycle (TS only) |
| `Notification` | Agent status messages (TS only) |
| `UserPromptSubmit` | User prompt submission |
| `PreCompact` | Conversation compaction |
| `PermissionRequest` | Permission dialog (TS only) |

**Key: TypeScript SDK has significantly richer hooks than Python.**

## 9. State Persistence

- Sessions persist as conversation transcript files on filesystem
- Resume via `session_id`, fork via `forkSession`
- `CLAUDE.md` files for project memory across sessions
- Automatic transcript cleanup after configurable period
- **Gap**: No database-backed persistence. Need custom layer for production multi-user.

## 10. Trust/Control Hooks

Strong support:
- **Dynamic tool restriction**: Change `allowed_tools` per `query()` call
- **PreToolUse hooks**: Deny, allow, ask, or modify any tool call
- **Permission flow**: Deny rules checked first, then Ask, then Allow
- **Model selection per subagent**: opus/sonnet/haiku per agent
- **Emergency brake**: `{ continue: false }` from any hook

## 11. Integration Pattern

```
React Frontend (Project Tab)
    |
    | WebSocket
    |
Node.js/TypeScript Backend
    |-- Claude Agent SDK (TypeScript) - richer hooks than Python
    |     |-- query() calls per agent/workstream
    |     |-- Hooks -> emit events to frontend via WS
    |     |-- canUseTool -> surface decisions, wait for response
    |     |-- Session resume/fork
    |
    |-- Application Database (trust, decisions, artifacts, provenance)
    |-- MCP Servers (custom tools, external integrations)
```

## 12. Gaps for Project Tab

**Must build yourself**:
1. Structured decision/artifact schema enforcement (custom tools + prompting)
2. Multi-agent orchestration layer (manage multiple query() calls)
3. Inter-agent context sharing (inject summaries between agents)
4. Trust trajectory tracking and scoring
5. Coherence monitoring / knowledge graph
6. Narrative generation (Briefing)
7. Database layer for production state
8. True pause/resume (only session-level, not mid-execution)

**Works well out of the box**:
- Agent execution loop with comprehensive tools
- Human-in-the-loop (canUseTool + AskUserQuestion)
- Real-time event streaming (hooks)
- Dynamic control enforcement (PreToolUse gating)
- Session persistence and resume
- MCP integration
