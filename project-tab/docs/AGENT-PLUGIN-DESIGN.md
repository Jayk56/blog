# Agent Plugin System — Design Document

*Draft: 2026-02-09*

## Overview

Project Tab is an intelligence briefing system for human-agent project management.
The prototype runs on mock data. This document designs the **plugin system** that
lets real AI agents — from any SDK (Claude, OpenAI, Gemini, or others) — slot into
the same backend and drive the same UI.

Two core insights shape this design:

**1. SDK convergence.** All three major agent SDKs converge on the same
fundamental pattern. They differ in API surface and terminology, but the
operations are identical. The plugin system abstracts over these differences
so the Project Tab backend doesn't care what's powering each agent.

**2. The backend is a job dispatcher, not an SDK host.** Agents need real
computer workspaces — browsers, terminals, filesystems — to generate documents,
pull web data, run builds, and execute code. They cannot run in-process inside
the backend. Instead, each agent runs as a **remote process in its own
sandbox**, kicked off from a job queue, using the native SDK for its provider.
The backend dispatches work, consumes events, and manages project intelligence.
The plugin interface is an **RPC boundary** (HTTP/gRPC/WebSocket), not
in-process TypeScript method calls. This dissolves the "which language?" question
entirely: each adapter runs in whatever language its SDK prefers.

---

## Design Principles

1. **Agents receive briefs, not instructions.** The human writes intent in the
   Brief Editor. The system translates that into an `AgentBrief` — a structured
   document with role, scope, constraints, escalation protocol, and available
   tools. Agents don't know about the UI.

2. **Agents emit events, not reports.** Instead of doing work and returning a
   blob, agents stream typed events (`AdapterEvent` at the wire boundary,
   wrapped into `EventEnvelope` by the backend) as they go. The backend
   classifies and routes events to the appropriate workspace.

3. **Block on decisions, not permissions.** The worst HITL is "may I use this
   tool?" for every action. Agents should block on genuine decisions that need
   human judgment. The control mode determines what counts as a decision vs.
   an auto-approved action.

4. **Share knowledge, not context.** Multiple agents don't share conversation
   threads. They share a structured knowledge base (artifacts, decisions,
   constraints). Each agent reads from and writes to this shared layer.

5. **Trust evolves naturally.** Every agent action is tracked. Human overrides
   reduce trust; clean completions increase it. As trust rises, more actions
   auto-approve. The system literally learns how much to trust each agent.

---

## Architecture

The system has two tiers: a **backend server** that owns project intelligence
and a **fleet of agent sandboxes** that do the actual work. They communicate
over an RPC boundary.

```
┌──────────────────────────────────────────────────────────────┐
│                     React Frontend                            │
│   Briefing │ Queue │ Map │ Brief Editor │ Controls            │
│                         │                                     │
│                    WebSocket                                  │
└─────────────────────────┼────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────────┐
│                   Backend Server (TypeScript)                  │
│                         │                                     │
│  ┌──────────────────────┴───────────────────────────┐        │
│  │              Project Intelligence Layer           │        │
│  │                                                   │        │
│  │  Decision Queue    ← scores, prioritizes, serves  │        │
│  │  Trust Engine      ← tracks per-agent trust        │        │
│  │  Coherence Monitor ← cross-workstream consistency  │        │
│  │  Narrative Builder ← generates briefings           │        │
│  │  Control Policy    ← enforces mode rules           │        │
│  │  Knowledge Store   ← artifacts, provenance, state  │        │
│  └──────────────────────┬───────────────────────────┘        │
│                         │                                     │
│  ┌──────────────────────┴───────────────────────────┐        │
│  │              Agent Gateway (RPC boundary)         │        │
│  │                                                   │        │
│  │  AgentBrief    → dispatched to sandbox            │        │
│  │  AdapterEvent  ← received from sandbox             │        │
│  │  AgentHandle   → network-addressed lifecycle ctrl │        │
│  │  Resolution    → human decisions pushed to sandbox│        │
│  │                                                   │        │
│  │  Protocol: HTTP/gRPC (commands) + WebSocket (events)      │
│  └──────────────────────┬───────────────────────────┘        │
│                         │                                     │
│  ┌──────────────────────┴───────────────────────────┐        │
│  │              Sandbox Orchestrator                  │        │
│  │  Provisions containers/processes per agent         │        │
│  │  Manages sandbox lifecycle (create/destroy)        │        │
│  │  Configures MCP servers + tool scopes per sandbox  │        │
│  │  Routes events from sandboxes to Event Bus         │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
              │                    │                    │
         ─ ─ ─ ─ ─ ─ ─    ─ ─ ─ ─ ─ ─ ─    ─ ─ ─ ─ ─ ─ ─
        │  Agent Sandbox │ │  Agent Sandbox │ │  Agent Sandbox │
        │                │ │                │ │                │
        │  SDK: Claude   │ │  SDK: OpenAI   │ │  SDK: Gemini   │
        │  Lang: TS      │ │  Lang: Python  │ │  Lang: Python  │
        │  Adapter shim  │ │  Adapter shim  │ │  Adapter shim  │
        │                │ │                │ │                │
        │  ┌───────────┐ │ │  ┌───────────┐ │ │  ┌───────────┐ │
        │  │MCP Servers│ │ │  │MCP Servers│ │ │  │MCP Servers│ │
        │  │FS│Git│Exec│ │ │  │FS│Git│Exec│ │ │  │FS│Git│Exec│ │
        │  └───────────┘ │ │  └───────────┘ │ │  └───────────┘ │
        │                │ │                │ │                │
        │  Browser       │ │  Browser       │ │  Browser       │
        │  Terminal       │ │  Terminal       │ │  Terminal       │
        │  Filesystem     │ │  Filesystem     │ │  Filesystem     │
         ─ ─ ─ ─ ─ ─ ─    ─ ─ ─ ─ ─ ─ ─    ─ ─ ─ ─ ─ ─ ─
```

**Backend Server**: Owns all project intelligence — decision scoring, trust
tracking, coherence monitoring, narrative generation. Written in TypeScript
(matches frontend, runs the intelligence layer). Contains no SDK code. It
never imports `claude-agent-sdk`, `openai-agents`, or `google-adk`.

**Agent Gateway**: The RPC boundary. Commands flow down (spawn, pause, kill,
resolve, inject context) over HTTP/gRPC. Events flow up (status, decisions,
artifacts) over a persistent WebSocket or server-sent events connection from
each sandbox. The gateway speaks a language-neutral wire protocol — JSON over
HTTP — so the sandbox can be implemented in any language.

**Sandbox Orchestrator**: Provisions and destroys agent sandboxes. Each sandbox
is a container (Docker), VM, or managed cloud environment. The orchestrator
configures each sandbox with the right MCP servers, filesystem scope, tool
allow-lists, and secret references before the agent starts.

**Agent Sandbox**: An isolated environment where one agent runs. Contains the
native SDK for that provider, an adapter shim that translates between the SDK
and the gateway's wire protocol, MCP servers scoped to that agent, and real
computer workspace resources (browser, terminal, filesystem). The sandbox is
the agent's world — it has no access to other sandboxes or the backend's
internal state.

The **language question dissolves**: the backend is TypeScript. Each sandbox
runs whatever language its SDK prefers (TypeScript for Claude, Python for
OpenAI/Gemini). The RPC boundary makes this transparent.

---

## Plugin Interface

### AgentBrief — What the agent receives

```typescript
interface AgentBrief {
  // Identity
  agentId: string
  role: string                    // "Research Agent", "Code Review Agent"
  description: string             // what this agent does

  // Scope
  workstream: string              // which workstream this agent owns
  readableWorkstreams: string[]   // other workstreams it can read
  constraints: string[]           // rules it must follow

  // Behavior
  escalationProtocol: EscalationProtocol
  controlMode: ControlMode        // orchestrator | adaptive | ecosystem
  // NOTE: trustScore is NOT part of AgentBrief. Trust is backend-only state
  // managed by the Trust Engine (see "Trust score calibration"). The backend
  // uses the score when evaluating EscalationPredicates and building the
  // escalationProtocol, but the score itself never reaches the agent. The
  // agent experiences trust indirectly: high-trust agents see fewer HITL
  // interruptions; low-trust agents see more.

  // Context
  projectBrief: ProjectBrief      // goals, description, checkpoints
  knowledgeSnapshot: KnowledgeSnapshot  // current artifacts, decisions, issues
  modelPreference?: string        // e.g. "opus", "gpt-4o", "gemini-2.0-flash"

  // Tools
  allowedTools: string[]          // tool names this agent can use
  mcpServers?: MCPServerConfig[]  // additional MCP tool servers

  // Workspace — what the Sandbox Orchestrator provisions in the container.
  // This is separate from tools: tools define what the agent can *do*,
  // workspace defines what system resources the sandbox *has*.
  workspaceRequirements?: WorkspaceRequirements

  // Output expectations
  outputSchema?: JsonSchema       // expected structured output shape (maps to
                                  // output_type in OpenAI/Gemini, MCP tool schema in Claude)

  // Policies
  guardrailPolicy?: GuardrailPolicy
  delegationPolicy?: {
    canSpawnSubagents: boolean
    allowedHandoffs: string[]     // agent IDs this agent can hand off to
    maxDepth: number              // nesting limit (Claude enforces 1)
  }

  // Session limits
  sessionPolicy?: {
    maxTurns?: number             // maps to OpenAI max_turns, prompt-enforced elsewhere
    contextBudgetTokens?: number  // triggers summarization when exceeded
    historyPolicy: 'full' | 'summarized' | 'recent_n'
    historyN?: number             // required when historyPolicy is 'recent_n'. Default: 50.
                                  // Number of most recent conversation turns to retain.
  }

  // Context refresh — when and how the backend pushes updated knowledge.
  // Defaults from control mode if omitted. See "ContextInjection timing policy".
  contextInjectionPolicy?: ContextInjectionPolicy

  // Secrets — references only, never values. Adapter resolves at spawn time.
  secretRefs?: SecretRef[]

  // Escape hatch for adapter-specific options
  providerConfig?: Record<string, unknown>
}

interface SecretRef {
  name: string                    // logical name: "deploy_token", "db_password"
  vaultKey: string                // key in the secret store (env var, secret manager)
  scope: 'agent' | 'project'     // who can access this secret
}

interface GuardrailPolicy {
  inputGuardrails: GuardrailSpec[]   // validate agent input before execution
  outputGuardrails: GuardrailSpec[]  // validate agent output after completion
  toolGuardrails: GuardrailSpec[]    // wrap individual tool calls
}

interface GuardrailSpec {
  name: string
  description: string
  action: 'block' | 'warn' | 'log'  // what happens when tripped
}

interface EscalationProtocol {
  // When to surface decisions vs. act autonomously
  alwaysEscalate: string[]        // e.g. ["delete files", "modify production"]
  escalateWhen: EscalationRule[]  // conditional rules
  neverEscalate: string[]         // always auto-approve
}

interface EscalationRule {
  predicate: EscalationPredicate  // typed, evaluable by backend
  description: string             // human-readable explanation
}

// Evaluated by the backend escalation engine, not by the agent.
// 'confidence' and 'blastRadius' come from the DecisionEvent/ToolApprovalEvent.
// 'trustScore' is read from the Trust Engine at evaluation time (not from the brief).
type EscalationPredicate =
  | { field: 'confidence'; op: 'lt' | 'gt' | 'lte' | 'gte'; value: number }
  | { field: 'blastRadius'; op: 'eq' | 'gte'; value: BlastRadius }
  | { field: 'trustScore'; op: 'lt' | 'gt' | 'lte' | 'gte'; value: number }
  | { field: 'affectsMultipleWorkstreams'; op: 'eq'; value: boolean }
  | { type: 'and'; rules: EscalationPredicate[] }
  | { type: 'or'; rules: EscalationPredicate[] }

// Workspace requirements — tells the Sandbox Orchestrator what system-level
// resources to provision. Separate from tools: tools define capabilities,
// workspace defines infrastructure.
interface WorkspaceRequirements {
  // Filesystem mounts from the project into the sandbox
  mounts: WorkspaceMount[]

  // System-level capabilities the sandbox needs
  capabilities: SandboxCapability[]

  // Resource limits
  resourceLimits?: {
    cpuCores?: number             // default: 2
    memoryMb?: number             // default: 4096
    diskMb?: number               // default: 10240
    timeoutMs?: number            // max sandbox lifetime, default: 3600000 (1hr)
  }

  // Base image override (default per provider: claude -> node, openai -> python)
  baseImage?: string              // e.g. "project-tab/sandbox-python:latest"
}

interface WorkspaceMount {
  hostPath: string                // project-relative path, e.g. "./src"
  sandboxPath: string             // path inside sandbox, e.g. "/workspace/src"
  readOnly: boolean               // code review agent: true, coding agent: false
}

type SandboxCapability =
  | 'terminal'                    // shell access (most agents need this)
  | 'browser'                     // headless browser for web research/testing
  | 'git'                         // git CLI and credentials
  | 'docker'                      // Docker-in-Docker (for build/deploy agents)
  | 'network_external'            // outbound internet access
  | 'network_internal_only'       // sandbox-to-backend only, no internet
  | 'gpu'                         // GPU access (for ML agents)
```

**Phase 1: explicit requirements only.** In Phase 1, `workspaceRequirements`
is required for all agents using `LocalHttpTransport` or `ContainerTransport`.
Omitting it is a configuration error. This forces the brief author to think
about what the sandbox needs, and avoids silent misprovisioning.

**Phase 2+: inference as fallback.** Once real usage patterns emerge, the
Sandbox Orchestrator can infer defaults from `allowedTools` as a convenience.
This is a **fallback**, not the primary mechanism — explicit requirements
always override inference.

Inference rules (Phase 2+, when `workspaceRequirements` is omitted):

| Tool / Role Pattern | Inferred Capabilities |
|---|---|
| `allowedTools` includes `Read`, `Write`, `Edit` | `terminal`, mount project source |
| `allowedTools` includes `Bash` | `terminal` |
| `allowedTools` includes `WebSearch`, `WebFetch` | `browser`, `network_external` |
| `allowedTools` includes `Git` | `git`, `terminal` |
| `role` contains "deploy" | `docker`, `network_external` |
| `role` contains "research" | `browser`, `network_external` |

**Important caveats**:
- Tool names in `allowedTools` are freeform strings. The inference table uses
  canonical names from the Claude Agent SDK (`Read`, `Write`, etc.). MCP tool
  names or custom tools won't match and will silently fall through.
- Role-based inference uses substring matching, which is deliberately broad.
- If inference produces an **empty capability set** (no tool names or roles
  matched), the Sandbox Orchestrator emits a warning and provisions a minimal
  sandbox (`terminal` + `network_internal_only` only). The warning surfaces
  in the Briefing workspace as a `StatusEvent` so the human can add explicit
  requirements.

### Brief Editor -> AgentBrief translation

The `AgentBrief` is a structured TypeScript object, but humans author briefs
in the Brief Editor workspace using freeform markdown with structured
metadata fields. The translation uses a **template + override** model:

1. **Agent templates**: The backend ships a library of agent templates (e.g.,
   "Code Review Agent", "Research Agent", "Deploy Agent"). Each template is a
   partial `AgentBrief` with sensible defaults for `allowedTools`,
   `escalationProtocol`, `workspaceRequirements`, `guardrailPolicy`, and
   `sessionPolicy`. The human selects a template when creating an agent.

2. **Brief Editor form**: The Brief Editor renders the template's fields as
   editable form sections. Structured fields (`allowedTools`, `constraints`,
   `controlMode`) are presented as dropdowns, checklists, or sliders. The
   `description` and `constraints` fields accept freeform markdown. The Brief
   Editor validates the brief against the `AgentBrief` schema before
   submission (client-side Zod validation).

3. **LLM-assisted authoring (Phase 3+)**: The Brief Editor can invoke an LLM
   to translate a natural language project description into structured
   `AgentBrief` fields. The human reviews and edits the generated brief
   before confirming. This is a UI convenience -- the backend always receives
   a fully structured `AgentBrief`.

4. **Backend assembly**: On submission, the backend merges the template
   defaults with the human's overrides, fills computed fields (e.g.,
   `knowledgeSnapshot` from the Knowledge Store, `agentId` generation), and
   produces the final `AgentBrief`. The `projectBrief` field is populated
   from the project-level configuration, not per-agent input.

**Phase 0**: Templates are hardcoded per mock scenario. No Brief Editor form.
**Phase 1**: One or two templates. Brief Editor renders editable fields.
**Phase 2+**: Template library grows. LLM-assisted authoring in Phase 3+.

### AgentEvent — What the agent emits

Every event emitted by an adapter is sent as an `AdapterEvent` (source
identity + payload). The backend then adds ingestion metadata and wraps it
as an `EventEnvelope` for ordering and correlation guarantees. The envelope
model has two layers of identity:

1. **Source identity** (generated immutably by the adapter): `sourceEventId`,
   `sourceSequence`, `sourceOccurredAt`, `runId`. These fields survive
   transport, reconnection, and replay unchanged. Adapters MUST generate
   these before emitting the event.
2. **Ingestion metadata** (added by the backend on receipt): `ingestedAt`.
   This is the backend's wall-clock timestamp for when it received the event.

Separating source identity from ingestion metadata is critical for replay
and deduplication correctness: replayed events carry the same
`sourceEventId` and `sourceSequence` as the original, so the event bus can
deduplicate them regardless of how many times they traverse the transport.

Tick ownership note: `tick` and `dueByTick` are backend-stamped fields.
Adapters MAY omit them. If omitted, the backend stamps them from
`TickService.currentTick()` during ingestion. If the adapter provides them
(e.g., MockPlugin in manual tick mode), the backend uses the adapter's
values. In production (wall-clock mode), adapters SHOULD omit these fields
and let the backend be the single authority.

```typescript
interface AdapterEvent {
  // Source identity — generated by adapter, immutable across transport/replay
  sourceEventId: string           // globally unique (UUID v7 for time-ordering),
                                  // generated by adapter at emission time
  sourceSequence: number          // monotonic counter within a run, generated by adapter
  sourceOccurredAt: string        // ISO 8601 timestamp, adapter's wall clock at emission
  runId: string                   // which execution run produced this

  // Payload
  event: AgentEvent               // the typed payload
}

interface EventEnvelope extends AdapterEvent {
  // Ingestion metadata — added by backend on receipt
  ingestedAt: string              // ISO 8601 timestamp, backend's wall clock at ingestion
}

type AgentEvent =
  | StatusEvent         // "I'm starting X", "I finished Y"
  | DecisionEvent       // "I need a human decision on this"
  | ArtifactEvent       // "I produced/updated this artifact"
  | CoherenceEvent      // "I found an inconsistency"
  | ToolCallEvent       // "I'm calling this tool" (for observability)
  | CompletionEvent     // "I'm done with my task"
  | ErrorEvent          // "Something went wrong"
  | DelegationEvent     // agent spawned or handed off to a sub-agent
  | GuardrailEvent      // guardrail tripped or passed
  | LifecycleEvent      // agent started, paused, resumed, killed
  | ProgressEvent       // long-running operation progress update
  | RawProviderEvent    // escape hatch for SDK-specific events

interface StatusEvent {
  type: 'status'
  agentId: string
  message: string
  tick?: number
}

type DecisionEvent = OptionDecisionEvent | ToolApprovalEvent

// Human chooses from agent-proposed options (design decisions, direction choices)
interface OptionDecisionEvent {
  type: 'decision'
  subtype: 'option'
  agentId: string
  decisionId: string
  title: string
  summary: string
  severity: Severity
  confidence: number              // 0-1
  blastRadius: BlastRadius
  options: DecisionOption[]
  recommendedOptionId?: string    // which option the agent recommends (for trust scoring)
  affectedArtifactIds: string[]
  requiresRationale: boolean
  dueByTick?: number | null
}

// Agent needs approval for a specific tool call (SDK HITL interruption).
// The adapter provides toolName/toolArgs from the SDK interruption. Risk
// fields (severity, blastRadius, confidence) are optional — if omitted, the
// backend fills them from the ToolRiskClassification registry (see below).
interface ToolApprovalEvent {
  type: 'decision'
  subtype: 'tool_approval'
  agentId: string
  decisionId: string
  toolName: string
  toolArgs: Record<string, unknown>
  severity?: Severity             // inferred from ToolRiskClassification if absent
  confidence?: number             // inferred if absent
  blastRadius?: BlastRadius       // inferred from ToolRiskClassification if absent
  affectedArtifactIds?: string[]  // inferred if absent
  dueByTick?: number | null
}

interface ArtifactEvent {
  type: 'artifact'
  agentId: string
  artifactId: string
  name: string
  kind: ArtifactKind
  workstream: string              // which workstream owns this artifact. Filled by
                                  // the backend from the agent's brief if the adapter
                                  // omits it. Required for event bus classification,
                                  // Knowledge Store scoping, and Layer 0 coherence checks.
  status: 'draft' | 'in_review' | 'approved' | 'rejected'
  qualityScore: number
  provenance: Provenance
  uri?: string                    // file path, URL, or content-addressable hash
  mimeType?: string               // e.g. "text/typescript", "image/png"
  sizeBytes?: number
  contentHash?: string            // SHA-256 for dedup and integrity
}

interface CoherenceEvent {
  type: 'coherence'
  agentId: string
  issueId: string
  title: string
  description: string
  category: CoherenceCategory
  severity: Severity
  affectedWorkstreams: string[]
  affectedArtifactIds: string[]
}

interface ToolCallEvent {
  type: 'tool_call'
  agentId: string
  toolCallId: string              // ties request/running/completed phases together
  toolName: string
  phase: 'requested' | 'running' | 'completed' | 'failed'
  input: Record<string, unknown>
  output?: unknown                // present on completed/failed
  approved: boolean
  durationMs?: number             // present on completed/failed
}

interface CompletionEvent {
  type: 'completion'
  agentId: string
  summary: string
  artifactsProduced: string[]
  decisionsNeeded: string[]
  outcome: 'success' | 'partial' | 'abandoned' | 'max_turns'
  reason?: string                 // explanation for non-success outcomes
}

interface ErrorEvent {
  type: 'error'
  agentId: string
  severity: Severity
  message: string
  recoverable: boolean
  errorCode?: string              // maps from PluginError.code when applicable
  category: 'provider' | 'tool' | 'model' | 'timeout' | 'internal'
  context?: {
    toolName?: string             // which tool was involved, if any
    lastAction?: string           // what the agent was doing when it failed
  }
}

interface DelegationEvent {
  type: 'delegation'
  agentId: string                 // parent agent
  action: 'spawned' | 'handoff' | 'returned'
  childAgentId: string
  childRole: string
  reason: string
  delegationDepth: number         // 0 = top-level, 1 = sub-agent, etc.
  rootAgentId: string             // original top-level agent that started chain
}

interface GuardrailEvent {
  type: 'guardrail'
  agentId: string
  guardrailName: string
  level: 'input' | 'output' | 'tool'
  tripped: boolean                // true = blocked, false = passed
  message: string
}

interface LifecycleEvent {
  type: 'lifecycle'
  agentId: string
  action: 'started' | 'paused' | 'resumed' | 'killed' | 'crashed' | 'session_start' | 'session_end'
  reason?: string
}

interface ProgressEvent {
  type: 'progress'
  agentId: string
  operationId: string
  description: string
  progressPct: number | null      // 0-100, null if indeterminate
}

interface RawProviderEvent {
  type: 'raw_provider'
  agentId: string
  providerName: string            // "claude", "openai", "gemini"
  eventType: string               // SDK-native event type name
  payload: Record<string, unknown>
}
```

### Supporting Types

These types are referenced throughout the plugin interface and event system.
Types not defined here (`ProjectBrief`, `MCPServerConfig`, `JsonSchema`,
`CoherenceStatus`, `TrustProfile` (per-agent runtime state — score,
trajectory, history), `DecisionItem`, `DecisionLogEntry`, `CoherenceIssue`,
`ConflictError`) are defined at implementation time as they are
backend-internal or configuration-level. `SerializedAgentState` is defined
in the "Session management and checkpointing" section.

```typescript
// Core enums / union types
type Severity = 'warning' | 'low' | 'medium' | 'high' | 'critical'
type BlastRadius = 'trivial' | 'small' | 'medium' | 'large' | 'unknown'
type ControlMode = 'orchestrator' | 'adaptive' | 'ecosystem'
type ArtifactKind = 'code' | 'document' | 'design' | 'config' | 'test' | 'other'
type CoherenceCategory = 'contradiction' | 'duplication' | 'gap' | 'dependency_violation'
type ActionKind = 'create' | 'update' | 'delete' | 'review' | 'deploy'

interface DecisionOption {
  id: string
  label: string
  description: string
  tradeoffs?: string              // what you gain/lose by picking this option
}

interface Provenance {
  createdBy: string               // agentId
  createdAt: string               // ISO 8601
  modifiedBy?: string
  modifiedAt?: string
  sourceArtifactIds?: string[]    // what this was derived from
  sourcePath?: string             // project-relative path (e.g. "src/api.ts"). Set by adapter
                                  // from the sandbox-local path before URI rewriting. Used by
                                  // Layer 0 coherence checks for file conflict detection.
}
```

### AgentPlugin — The adapter contract

The `AgentPlugin` interface is implemented **twice**: once in the backend as an
RPC client (the Agent Gateway), and once in each sandbox as the adapter shim
that translates RPC calls into native SDK operations. The TypeScript types below
define the logical contract; the wire protocol is JSON over HTTP (commands) and
JSON over WebSocket (events).

```typescript
interface PluginCapabilities {
  supportsPause: boolean          // true checkpoint pause vs. abort+restart
  supportsResume: boolean         // restore exact execution state
  supportsKill: boolean           // graceful termination vs. iterator abort
  supportsHotBriefUpdate: boolean // live brief changes vs. restart-required
}

interface AgentPlugin {
  readonly name: string           // "claude", "openai", "gemini"
  readonly version: string
  readonly capabilities: PluginCapabilities

  // Lifecycle — these are RPC calls from backend to sandbox
  spawn(brief: AgentBrief): Promise<AgentHandle>
  pause(handle: AgentHandle): Promise<SerializedAgentState>
  resume(state: SerializedAgentState): Promise<AgentHandle>
  kill(handle: AgentHandle, options?: KillRequest): Promise<KillResponse>
  // KillRequest and KillResponse defined in "Kill over the network" section.
  // Defaults: { grace: true, graceTimeoutMs: 10000 }

  // Communication — commands flow from backend to sandbox.
  // Event streaming is NOT part of this interface — it's a transport-level
  // concern handled by the Agent Gateway (see "Event streaming" below).
  resolveDecision(handle: AgentHandle, decisionId: string, resolution: Resolution): Promise<void>
  injectContext(handle: AgentHandle, injection: ContextInjection): Promise<void>

  // Control
  updateBrief(handle: AgentHandle, changes: Partial<AgentBrief>): Promise<void>
}
```

### Transport abstraction

The `AgentPlugin` interface is transport-agnostic. The backend always calls
the same TypeScript methods. What changes across phases is the **transport
layer** underneath:

```typescript
// The backend codes against AgentPlugin. The transport is injected.
type PluginTransport =
  | InProcessTransport       // Phase 0: MockPlugin, direct method calls
  | LocalHttpTransport       // Phase 1: adapter shim on localhost HTTP+WS
  | ContainerTransport       // Phase 2+: Docker/cloud sandbox HTTP+WS

interface InProcessTransport {
  type: 'in_process'
  // Direct method calls on an AgentPlugin implementation.
  // No network, no serialization. Used only for MockPlugin.
  // The eventSink replaces subscribe() — MockPlugin calls it to push events.
  eventSink: (event: AdapterEvent) => void
}

interface LocalHttpTransport {
  type: 'local_http'
  // Adapter shim runs as a local child process exposing HTTP+WS.
  // Same wire protocol as containers, but on localhost.
  rpcEndpoint: string         // e.g. "http://localhost:9100"
  eventStreamEndpoint: string // e.g. "ws://localhost:9100/events"
}

interface ContainerTransport {
  type: 'container'
  // Adapter shim runs in a Docker container or cloud sandbox.
  sandboxId: string
  rpcEndpoint: string         // e.g. "https://sandbox-abc123.internal:8080"
  eventStreamEndpoint: string // e.g. "wss://sandbox-abc123.internal:8080/events"
  healthEndpoint: string      // e.g. "https://sandbox-abc123.internal:8080/health"
}
```

This resolves the Phase progression: the `AgentPlugin` interface is always the
same. Phase 0 uses `InProcessTransport` (MockPlugin runs in-process, no RPC).
Phase 1 uses `LocalHttpTransport` (real SDK adapter as a local process, real
HTTP+WS on localhost — validates the wire protocol without container overhead).
Phase 2+ uses `ContainerTransport` (full sandbox isolation). The Phase 1 wire
protocol is byte-identical to the Phase 2+ protocol — only the address differs.

**Wire protocol** (applies to `LocalHttpTransport` and `ContainerTransport`):

Commands (backend -> sandbox):

| Method | HTTP Endpoint |
|---|---|
| `spawn()` | `POST /spawn` |
| `pause()` | `POST /pause` |
| `resume()` | `POST /resume` |
| `kill()` | `POST /kill` |
| `resolveDecision()` | `POST /resolve` |
| `injectContext()` | `POST /inject-context` |
| `updateBrief()` | `POST /update-brief` |

Sandbox -> backend (reverse channel):

| Purpose | Endpoint | Direction |
|---|---|---|
| Event stream | `WS /events` on sandbox | sandbox -> backend (persistent) |
| Artifact upload | `POST /api/artifacts` on backend | sandbox -> backend |
| Token renewal | `POST /api/token/renew` on backend | sandbox -> backend (Phase 2+) |
| Health/heartbeat | `GET /health` on sandbox | backend -> sandbox (polled) |

**Event streaming** is a transport-level concern, not an `AgentPlugin` method.
The Agent Gateway manages event connections automatically:

- **`InProcessTransport`**: The MockPlugin pushes events by calling
  `transport.eventSink(adapterEvent)` directly (in-process, no network). The Agent
  Gateway provides the `eventSink` callback when creating the transport —
  it pipes events into the event bus.
- **`LocalHttpTransport` / `ContainerTransport`**: The Agent Gateway connects
  to the sandbox's `WS /events` endpoint when `spawn()` returns successfully.
  The connection is persistent for the lifetime of the sandbox. If the
  connection drops, the Gateway reconnects with exponential backoff (max 30s).
  Each WebSocket message is an `AdapterEvent`; the Gateway stamps
  `ingestedAt` to produce the final `EventEnvelope` before bus ingestion.
  Events received during reconnection are buffered by the adapter shim (up to
  1000 events or 60s, whichever comes first; oldest dropped after that).

**Buffer overflow and sequence gap recovery**: When the buffer overflows and
oldest events are dropped, the backend detects gaps via `EventEnvelope.sourceSequence`
(e.g., sourceSequence 42, 43, ... gap ... 1044). The recovery protocol:

1. **Gap detection**: The event bus notices a sequence jump for this agent.
2. **Gap request**: Backend sends `POST /replay` to the sandbox with the
   missing sequence range. The adapter shim maintains a rolling event log
   (last 5000 events on disk) and replays the requested range.
3. **If replay unavailable** (events already evicted from the shim's log):
   the backend marks the gap as unrecoverable, emits a `StatusEvent`
   ("Event gap detected: sequences N-M lost for agent X"), and requests a
   full `KnowledgeSnapshot` refresh for the affected agent to ensure the
   Knowledge Store is consistent.
4. **Idempotency**: Replayed events carry the same `sourceEventId` and
   `sourceSequence` as the original emission. The event bus deduplicates
   via `sourceEventId`, so replays are safe.

This adds one more endpoint to the sandbox wire protocol (Phase 3 — not
needed in Phase 1, which accepts data loss on buffer overflow):

| Purpose | Endpoint | Direction |
|---|---|---|
| Event replay | `POST /replay` on sandbox | backend -> sandbox (Phase 3) |

**Sandbox-to-backend discovery**: The sandbox needs to know the backend's
address to upload artifacts (and potentially for future reverse-channel
operations). This is injected at provision time:

```typescript
// Included in the spawn payload sent to the sandbox
interface SandboxBootstrap {
  backendUrl: string              // e.g. "https://backend.internal:3000"
  backendToken: string            // short-lived JWT for authenticating sandbox -> backend calls
  tokenExpiresAt: string          // ISO 8601; sandbox requests renewal before expiry
  agentId: string                 // so the sandbox knows its own identity
  artifactUploadEndpoint: string  // e.g. "https://backend.internal:3000/api/artifacts"
}
```

The `backendToken` authenticates all sandbox-to-backend calls (artifact upload,
health responses, etc.). It is scoped to the specific agent and sandbox — a
token from sandbox A cannot be used to upload artifacts as sandbox B. The
Sandbox Orchestrator generates the token at provision time and includes it in
the spawn payload.

**Token renewal**: The `backendToken` is a short-lived JWT (default TTL: 1
hour). The sandbox adapter shim is responsible for renewing it before expiry:

```typescript
// Sandbox -> backend token renewal
// POST /api/token/renew on backend
interface TokenRenewRequest {
  agentId: string
  currentToken: string            // the expiring token (proves identity)
}

interface TokenRenewResponse {
  backendToken: string            // new JWT
  tokenExpiresAt: string          // ISO 8601
}
```

The adapter shim should request renewal when 80% of the TTL has elapsed
(i.e., 48 minutes into a 60-minute token). If renewal fails (backend
unreachable), the shim retries with exponential backoff. If the token expires
before renewal, sandbox-to-backend calls fail with 401 — the adapter shim
buffers artifact uploads and retries after a successful renewal.

**Phase 1 simplification**: With `LocalHttpTransport`, the sandbox is a local
child process on the same machine. Phase 1 can use a long-lived token (TTL:
24 hours) or skip authentication entirely (trusting localhost). The renewal
mechanism is a Phase 2 concern for containerized sandboxes on the network.

### Adapter shim specification

The **adapter shim** runs inside each sandbox (or as a local child process in Phase 1). It translates between the wire protocol and the native SDK.

**Process lifecycle (LocalHttpTransport, Phase 1)**:

1. Backend Agent Gateway asks Sandbox Orchestrator to create a sandbox
2. Orchestrator writes `SandboxBootstrap` to a temp JSON file (`/tmp/pt-bootstrap-<uuid>.json`)
3. Orchestrator allocates a port from the pool (9100-9199) and spawns the child process:
   - **Python adapter** (OpenAI, Gemini): `python -m adapter_shim --port 9100 --bootstrap /tmp/pt-bootstrap-<uuid>.json`
   - **TypeScript adapter** (Claude): `node dist/adapter-shim.js --port 9100 --bootstrap /tmp/pt-bootstrap-<uuid>.json`
   - Spawned via `child_process.spawn()` with `stdio: ['ignore', 'pipe', 'pipe']`.
     Stdout/stderr are piped to the backend logger, prefixed with the agent ID.
4. Child process reads bootstrap file, deletes it (secrets hygiene), starts HTTP+WS server on the specified port
5. **Ready signal**: Orchestrator polls `GET /health` on the assigned port with 500ms interval, up to 30s timeout. First successful response (any status) means the shim is ready. If the timeout expires, Orchestrator kills the child process and reports `provider_unavailable` to the Gateway.
6. Orchestrator returns `LocalHttpTransport { rpcEndpoint: "http://localhost:9100", eventStreamEndpoint: "ws://localhost:9100/events" }`
7. Gateway connects to `WS /events`
8. Gateway calls `POST /spawn` with `AgentBrief` in request body
9. Adapter shim initializes SDK, starts agent execution
10. Agent runs, events flow over WebSocket to Gateway

**Crash detection**: The Gateway detects shim death via two signals:
- WebSocket `/events` connection drops (immediate detection)
- `GET /health` returns non-200 or times out (polled every 30s, detected within 90s)
- The `child_process` 'exit' event fires (immediate detection for `LocalHttpTransport` only)

On any of these, the Gateway marks the agent as crashed and follows the crash recovery flow (see "Crash recovery" under "Session management and checkpointing"). In Phase 1, crash = full restart (no checkpointing); Phase 2+ adds checkpoint-on-decision and recovery options.

For `ContainerTransport` (Phase 2+): same flow, but Orchestrator starts a Docker container instead of `child_process.spawn()`. Image includes adapter shim, SDK, and MCP servers. Bootstrap is injected via container environment or mounted file.

**Adapter shim contract** — the shim must:
- Start an HTTP server exposing all endpoints from the wire protocol table
- Start a WebSocket server at `/events` for the event stream
- Accept `POST /spawn` with `AgentBrief`, initialize the SDK, return `AgentHandle`
- Translate `POST /resolve`, `POST /pause`, `POST /kill` to native SDK calls
- Push `AdapterEvent` objects over the WebSocket as JSON
- Upload artifacts eagerly via `SandboxBootstrap.artifactUploadEndpoint`
- Respond to `GET /health` with `SandboxHealthResponse`

**Port discovery**: Orchestrator manages a port pool (9100-9199) for `LocalHttpTransport`. For containers, internal port 8080 mapped to unique host port or DNS name.

**Capability-gated lifecycle semantics:**

- **`pause()`**: When `supportsPause` is false (Claude, Gemini), the adapter aborts
  the execution iterator and saves enough session state to approximate a restart.
  The backend must not assume execution resumes at the exact point of interruption.
- **`resume()`**: When `supportsResume` is false, the adapter starts a fresh
  execution turn with the saved session context. The agent sees the prior
  conversation but re-enters from the top of its loop.
- **`kill()`**: When `supportsKill` is partial (OpenAI) or false (Gemini), the
  adapter cancels the async task. No graceful shutdown hook fires.
- **`updateBrief()`**: When `supportsHotBriefUpdate` is false (OpenAI, Claude),
  changes are queued in `AgentHandle.pendingBriefChanges` and applied on the next
  `spawn()` or `resume()` cycle. The method resolves immediately but the agent
  doesn't see the changes until restart.

**Decision resolution**: When `resolveDecision()` is called, the backend passes
the `decisionId` from the original `DecisionEvent`. The adapter is responsible
for maintaining an internal mapping from `decisionId` to the SDK-specific
interruption reference (e.g., Claude's callback promise, OpenAI's `ToolApprovalItem`,
Gemini's blocked callback). This interruption reference is adapter-internal state
and never appears in events or crosses the plugin boundary. The backend only needs
the `decisionId`; the adapter resolves it to the correct SDK primitive internally.
The adapter cleans up the mapping entry after resolution.

```typescript
// AgentHandle is lean — it's what the Intelligence Layer passes around.
// Trust Engine, Decision Queue, Knowledge Store all reference agents by handle.
// No infrastructure details leak into this type.
interface AgentHandle {
  id: string
  pluginName: string
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error'
  // Note: crashed agents are set to 'error'. The crash is surfaced via
  // LifecycleEvent (action: 'crashed') and ErrorEvent (category: 'internal').
  // 'error' is the terminal status; recovery creates a new AgentHandle.
  sessionId: string               // SDK-specific session reference
  pendingBriefChanges?: Partial<AgentBrief>  // queued when hot update unsupported
}

// SandboxInfo is owned by the Sandbox Orchestrator and Agent Gateway.
// The Intelligence Layer never sees this — it's an infrastructure concern.
// The Agent Gateway uses it to route RPC calls; the Orchestrator uses it
// for lifecycle management and health monitoring.
interface SandboxInfo {
  agentId: string                 // links back to AgentHandle.id
  transport: PluginTransport      // how to reach this sandbox (see Transport Abstraction)
  providerType: 'docker' | 'cloud_run' | 'vm' | 'local_process' | 'in_process'
  createdAt: string               // ISO 8601
  lastHeartbeatAt: string | null  // null if never received or in-process
  resourceUsage?: SandboxResourceUsage
}

// Populated by the Agent Gateway's health poller. The Gateway polls each
// sandbox's GET /health endpoint on a configurable interval (default: 30s).
// The health response includes resource usage metrics alongside the heartbeat.
interface SandboxResourceUsage {
  cpuPercent: number
  memoryMb: number
  diskMb: number
  collectedAt: string             // ISO 8601, when this sample was taken
}

// GET /health response from the sandbox adapter shim
interface SandboxHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  agentStatus: AgentHandle['status']  // current agent status inside sandbox
  uptimeMs: number
  resourceUsage: SandboxResourceUsage
  pendingEventBufferSize: number  // events buffered during WS reconnection
}

interface Resolution {
  resolutionType: 'approve' | 'reject' | 'modify' | 'choose_option'
  chosenOptionId?: string           // for 'choose_option' (OptionDecisionEvent)
  modifiedArgs?: Record<string, unknown>  // for 'modify' (ToolApprovalEvent)
  alwaysApprove?: boolean           // blanket approval for this tool+pattern
  rationale: string
  actionKind: ActionKind
}

// alwaysApprove semantics: When `alwaysApprove: true`, the adapter adds the
// tool name to a per-agent session allow-list. The approval persists for the
// current agent session only -- it resets on agent restart. It applies to the
// exact `toolName` from the resolved decision, not to patterns or wildcards.
// The approval is agent-scoped (not project-wide) and session-scoped (not
// persistent). For persistent tool auto-approval, modify the agent's
// `escalationProtocol.neverEscalate` list in the brief.

interface ContextInjection {
  content: string
  format: 'markdown' | 'json' | 'plain'
  snapshotVersion: number           // knowledge store version this came from
  estimatedTokens: number           // pre-calculated so backend can check budget
  priority: 'required' | 'recommended' | 'supplementary'
}
```

The `priority` field controls what gets dropped when the agent's context window is
near capacity. `required` injections always go through (and may trigger conversation
compaction). `recommended` is dropped if the budget is exceeded. `supplementary` is
dropped first. The backend checks `estimatedTokens` against the agent's
`sessionPolicy.contextBudgetTokens` before calling the adapter.

### ContextInjection timing policy

When does the backend push updated context to running agents? There are three
triggers, evaluated independently. Any of them can fire an injection.

```typescript
interface ContextInjectionPolicy {
  // Trigger 1: Periodic refresh
  periodicIntervalTicks: number | null  // null = disabled. Default: 20 ticks.
  // Every N ticks, rebuild the agent's KnowledgeSnapshot and inject it.

  // Trigger 2: Event-driven (reactive)
  reactiveEvents: ContextReactiveTrigger[]
  // Fire when specific events occur in workstreams the agent can read.

  // Trigger 3: Staleness threshold
  stalenessThreshold: number | null     // null = disabled. Default: 10 events.
  // If N+ events have been processed in the agent's readable workstreams
  // since its last injection, fire a refresh.

  // Budget control
  maxInjectionsPerHour: number          // rate limit. Default: 12.
  cooldownTicks: number                 // minimum ticks between injections. Default: 5.
}

type ContextReactiveTrigger =
  | { on: 'artifact_approved'; workstreams: 'own' | 'readable' | 'all' }
  | { on: 'decision_resolved'; workstreams: 'own' | 'readable' | 'all' }
  | { on: 'coherence_issue'; severity: Severity }
  | { on: 'agent_completed'; workstreams: 'readable' }
  | { on: 'brief_updated' }            // always fires (own brief changed)
```

**How the three triggers interact**:

1. **Periodic** is the baseline. It ensures agents don't go stale even if
   nothing interesting happens in their readable workstreams. Default: every
   20 ticks. This is a full snapshot refresh.

2. **Reactive** fires on specific events of interest. For example, when an
   artifact is approved in a workstream the agent reads, it should know about
   the new artifact. Reactive injections are **incremental** — the backend
   sends only the delta since the last injection (new/changed artifacts,
   resolved decisions, new coherence issues) rather than a full snapshot.
   This keeps `estimatedTokens` low.

3. **Staleness threshold** is a catch-all. If many small events accumulate
   (status updates, tool calls) without triggering a reactive injection, the
   agent's context drifts. The staleness counter resets after every injection.

**Cost model**: Every injection consumes context window tokens. The tradeoff:

| Strategy | Freshness | Token Cost | Risk |
|---|---|---|---|
| Aggressive (periodic=5, staleness=3) | Very fresh | High — frequent injections eat context budget | Context overflow, compaction churn |
| Balanced (periodic=20, staleness=10) | Good | Moderate — 2-3 injections per hour typical | Acceptable staleness for most workloads |
| Conservative (periodic=50, reactive only) | Stale unless triggered | Low — injections only on meaningful changes | Agent makes decisions on outdated context |
| Disabled (periodic=null, no reactive) | Static | Zero — agent works from spawn-time snapshot only | Fine for short-lived agents (< 10 minutes) |

**Default policy per control mode**:

| Control Mode | Periodic | Reactive | Staleness | Rationale |
|---|---|---|---|---|
| Orchestrator | 10 ticks | artifact_approved, decision_resolved, coherence_issue(high+) | 5 events | Human is watching closely; agents should be maximally current |
| Adaptive | 20 ticks | artifact_approved, decision_resolved | 10 events | Balanced — most projects |
| Ecosystem | 50 ticks | coherence_issue(critical) only | 20 events | Agents are autonomous; minimize interruptions |

**Incremental vs. full refresh**: Reactive injections send a delta
(`ContextInjection` with only changed items). Periodic injections send a
full `KnowledgeSnapshot` rebuild. The `snapshotVersion` field on
`ContextInjection` lets the adapter detect duplicates — if the agent already
has version N, an injection with version N is a no-op.

**Budget enforcement**: Before sending any injection, the backend:
1. Checks `maxInjectionsPerHour` — if exceeded, drops `supplementary` and
   `recommended` injections (only `required` still go through)
2. Checks `cooldownTicks` — if the last injection was too recent, queues the
   injection for later (except `required` priority)
3. Checks `estimatedTokens` against `sessionPolicy.contextBudgetTokens` —
   if the injection would exceed the budget, trims the content (same priority
   order as `KnowledgeSnapshot` sizing) or triggers compaction

The `ContextInjectionPolicy` can be set per-agent via `AgentBrief` or
defaulted from the project's control mode. Per-agent overrides take precedence.

**Phase progression for ContextInjection**:
- **Phase 1**: Disabled. Agents use their spawn-time `KnowledgeSnapshot` only.
  With a single agent and no cross-workstream activity, there is nothing to
  inject. The `injectContext()` RPC endpoint exists in the wire protocol (so
  Phase 1 validates the plumbing) but the backend never calls it.
- **Phase 2**: Periodic + reactive injection enabled. With two agents in
  different workstreams, reactive triggers (`artifact_approved`,
  `decision_resolved`) become meaningful. The staleness threshold catches
  accumulated drift.
- **Phase 3+**: Full policy with per-control-mode defaults, budget enforcement,
  and rate limiting.

### providerConfig guidelines

`AgentBrief.providerConfig` is an escape hatch (`Record<string, unknown>`) for
adapter-specific options that don't map to any first-class field. It exists
because SDK surfaces evolve faster than the plugin interface, and some features
are genuinely provider-specific. But an unguarded escape hatch becomes a
dumping ground that undermines the abstraction.

**Principle**: If a capability affects how the backend manages the agent
(trust, decisions, coherence, lifecycle), it belongs in the first-class
interface. If it only affects how the SDK executes internally, it can live in
`providerConfig`.

**Valid uses** (SDK-internal tuning that the backend doesn't need to know about):

```typescript
// Claude: model-specific generation parameters
providerConfig: {
  temperature: 0.7,
  maxTokens: 4096,
  systemPromptCaching: true,         // Claude-specific optimization
}

// OpenAI: tracing and session configuration
providerConfig: {
  tracingDisabled: false,
  sessionBackend: 'redis',           // OpenAI SDK session store choice
  litellmModel: 'anthropic/claude-3-opus',  // LiteLLM routing override
}

// Gemini: execution and safety settings
providerConfig: {
  safetySettings: { harassment: 'block_none' },  // Gemini safety filters
  executionMode: 'parallel',                      // ADK runner mode
}
```

**Anti-patterns**: Do not put tool access control (`blockedTools`,
`disableToolApproval`), context management (`maxContextTokens`), trust/
escalation bypasses (`autoApproveAll`, `skipGuardrails`), or secrets
(`apiKey`) in `providerConfig`. These belong in their respective first-class
fields (`allowedTools`, `sessionPolicy`, `guardrailPolicy`, `secretRefs`).

**`experimental` sub-namespace**: For new SDK features that affect backend
behavior but lack a first-class field, use `providerConfig.experimental`.
These keys bypass shadowing validation, are pass-through to the adapter, and
must be promoted to first-class fields or removed at each major version
audit. If the backend needs to reason about a capability for trust or
escalation, it must be first-class.

**Validation**: The backend rejects `providerConfig` keys that shadow
first-class `AgentBrief` fields in strict mode (orchestrator default).
`experimental` keys are exempt. `providerConfig` is stored opaquely on
persistence -- the backend validates only that it contains no secret values
(see Redaction under Security Boundaries).

### Tool risk classification

When a `ToolApprovalEvent` arrives without risk metadata (severity, blastRadius,
confidence), the backend classifies it using a `ToolRiskClassification` registry.
This registry is configured at plugin registration time, not by the adapter.

```typescript
interface ToolRiskClassification {
  toolPattern: string             // glob match on tool name, e.g. "write", "deploy*", "rm"
  defaultSeverity: Severity
  defaultBlastRadius: BlastRadius
  defaultConfidence: number       // adapter's baseline confidence for this tool type
  requiresRationale: boolean
}

// The backend registers plugins with their tool classifications
interface PluginRegistration {
  plugin: AgentPlugin
  toolClassifications: ToolRiskClassification[]
}
```

When a `ToolApprovalEvent` is missing risk fields, the backend matches
`toolName` against the registered patterns (most specific match wins) and
fills the defaults. If no pattern matches, the tool gets `severity: 'high'`,
`blastRadius: 'unknown'` — fail-safe to human review.

### Error handling contract

All `AgentPlugin` methods reject with a `PluginError`. The backend maps these
to `ErrorEvent` for the frontend and decides whether to retry, surface to the
human, or kill the agent.

```typescript
type PluginError =
  | { code: 'provider_unavailable'; message: string; retryable: boolean }
  | { code: 'invalid_state'; message: string; handle?: AgentHandle }
  | { code: 'decision_not_found'; decisionId: string }
  | { code: 'rate_limited'; retryAfterMs: number }
  | { code: 'context_overflow'; currentTokens: number; maxTokens: number }
  | { code: 'capability_unsupported'; capability: keyof PluginCapabilities }
```

**Error-to-action mapping:**

| PluginError code | Backend action |
|---|---|
| `provider_unavailable` | If `retryable`: exponential backoff retry. Otherwise: emit `ErrorEvent`, mark agent `error`. |
| `invalid_state` | Emit `ErrorEvent`. Attempt `kill()` + re-`spawn()` if agent brief is available. |
| `decision_not_found` | Log warning. Stale resolution — the decision was already resolved or timed out. |
| `rate_limited` | Queue retry after `retryAfterMs`. Emit `StatusEvent` ("Agent paused: rate limited"). |
| `context_overflow` | Trigger conversation compaction via adapter, then retry. If still overflowing, emit `ErrorEvent`. |
| `capability_unsupported` | Programming error — backend should check `capabilities` before calling. Log and surface as bug. |

### Agent registry

The `AgentPlugin` interface is intentionally focused on single-agent operations.
Fleet management — tracking which agents are running, their health, and their
relationships — is the backend's responsibility via an `AgentRegistry`.

```typescript
interface AgentRegistry {
  // Registration
  registerPlugin(registration: PluginRegistration): void

  // Fleet management
  getHandle(agentId: string): AgentHandle | null
  listHandles(filter?: { status?: AgentHandle['status']; pluginName?: string }): AgentHandle[]
  getHealthStatus(agentId: string): AgentHealthStatus

  // Lifecycle (delegates to the appropriate plugin)
  spawnAgent(brief: AgentBrief, pluginName: string): Promise<AgentHandle>
  killAll(): Promise<void>        // emergency brake across all plugins
}

interface AgentHealthStatus {
  agentId: string
  status: AgentHandle['status']
  pluginName: string
  uptime: number                  // ms since spawn
  eventsEmitted: number
  lastEventAt: string | null      // ISO timestamp
  pendingDecisions: number
}
```

The Controls workspace queries the registry for the fleet view. The emergency
brake calls `killAll()`, which iterates all running handles and calls `kill()`
on each plugin. The registry also emits `LifecycleEvent` when agents start, stop,
or change status.

### Security boundaries

Three key isolation concerns cut across the plugin system:

**1. Knowledge Store access control**

Agents never access the Knowledge Store directly. The backend mediates all
reads and writes, enforcing scoping rules from the agent's brief:

- **Reads**: `getArtifacts()` filtered to `workstream` + `readableWorkstreams`.
  Agents cannot see artifacts from workstreams outside their scope.
- **Writes**: `upsertArtifact()` restricted to the agent's own `workstream`.
  Attempting to write outside scope is rejected and logged.
- **Trust**: `updateTrust()` is backend-internal only. No agent can modify
  trust profiles (its own or others').
- **Decisions**: `resolveDecision()` is only callable via human interaction
  through the UI, never by agents directly.

The Knowledge Store interface (defined in the Knowledge Store section) is
backend-internal. Agents interact with knowledge only through their
`knowledgeSnapshot` (read, received at spawn) and `ArtifactEvent`/
`DecisionEvent` emissions (write, mediated by the backend).

**2. MCP server scoping (sandbox-local)**

With the sandbox architecture, MCP servers run **inside each agent's sandbox**,
not in the backend. Isolation is enforced at the sandbox boundary:

- **Working directory**: The sandbox's filesystem mount defines the agent's
  scope. A code review agent's sandbox mounts `./src/` read-only; a deploy
  agent mounts `./infra/` read-write. The MCP filesystem server inside the
  sandbox simply serves the mounted paths — no additional scoping needed.
- **Tool allow-lists**: Enforced at two levels. The Sandbox Orchestrator only
  provisions MCP servers for tools in the agent's `allowedTools` list (tools
  not provisioned can't be called). As a second gate, the adapter shim's
  `PreToolUse`/`before_tool_call` callbacks reject disallowed calls.
- **Instance strategy**: One sandbox per agent, each with its own MCP server
  instances. No sharing between sandboxes. For MCP servers that need
  backend-side resources (e.g., a shared API gateway or database proxy),
  the backend runs a network-accessible MCP server that sandboxes connect
  to via SSE/HTTP transport, authenticated per-agent.
- **Sandbox destruction**: When an agent is killed or completes, its sandbox
  is destroyed. MCP servers inside it are terminated automatically. Artifact
  extraction must happen before destruction — see "Artifact Extraction and
  Sandbox Teardown" section below.

**3. Secret management**

Secrets (API keys, deploy tokens, database credentials) are never stored in
`AgentBrief` or serialized state. The brief contains `SecretRef` objects that
reference secrets by name. The resolution flow:

```
AgentBrief.secretRefs[].vaultKey
    → Sandbox Orchestrator resolves from secret store at provision time
    → Injected as environment variables into the sandbox container
    → Adapter shim reads from env, passes to SDK session / MCP server config
    → Secret values never cross the RPC boundary (never in events or logs)
```

Scoping: `scope: 'agent'` means only this specific agent can access the secret.
`scope: 'project'` means any agent in the project can access it. The backend
checks scope against the agent's `agentId` before resolving.

**Credential isolation per adapter**: Each adapter gets its own credential scope.
A Claude adapter's API key is not visible to a Gemini adapter — the backend
resolves secret refs scoped to the adapter's plugin name before passing them.

**Redaction**: `providerConfig` and `mcpServers` fields may contain secret
references (e.g., `"apiKey": "$OPENAI_API_KEY"`). Event logging, serialization,
and any persistence of `AgentBrief` or `SerializedAgentState` must redact
fields matching the `$SECRET_NAME` pattern. The adapter is responsible for
resolving references to actual values at spawn time and keeping resolved
values in-memory only.

### Artifact extraction and sandbox teardown

Agents produce artifacts inside their sandbox filesystem. These artifacts must
be extracted before the sandbox is destroyed, or they are lost. This is a
critical data-integrity concern that spans normal completion, crashes, and
forced kills.

**Extraction flow**:

```
Agent emits ArtifactEvent (uri = sandbox-local path, e.g. "/workspace/output/report.md")
    → Adapter shim intercepts ArtifactEvent before forwarding to backend
    → Adapter shim uploads artifact content to backend via POST /api/artifacts
    → Backend stores content, returns ArtifactUploadResult with backendUri
    → Adapter shim rewrites ArtifactEvent.uri to the returned backendUri
      (e.g. "artifact://project-123/agent-456/report.md")
    → Adapter shim forwards the rewritten ArtifactEvent over WebSocket
    → Event bus receives ArtifactEvent with stable backend URI only
```

**URI translation**: The **adapter shim** is the single owner of URI
rewriting. The adapter uploads content via eager upload, receives the
stable `backendUri` in the `ArtifactUploadResult` response, and rewrites
`ArtifactEvent.uri` before forwarding over WebSocket. The event bus never
sees sandbox-internal paths. This avoids a race condition where the event
could reach the bus before the upload completes (which would happen if the
backend did the rewrite). The backend-managed URI scheme (`artifact://`)
is opaque to agents and stable across sandbox restarts.

```typescript
interface ArtifactUpload {
  agentId: string
  artifactId: string
  sandboxUri: string           // original path inside sandbox
  content: Buffer | ReadableStream
  mimeType: string
  contentHash: string          // SHA-256, computed by adapter shim
  sizeBytes: number
}

interface ArtifactUploadResult {
  backendUri: string           // stable URI (e.g. "artifact://project-123/agent-456/report.md")
  version: number              // Knowledge Store version after write
  storedAt: string             // ISO 8601 timestamp (provenance)
  sizeBytes: number            // echoed back for verification
}
```

**Teardown scenarios and guarantees**:

| Scenario | Extraction guarantee | Mechanism |
|---|---|---|
| **Normal completion** | All artifacts extracted | Adapter shim uploads all artifacts, then emits `CompletionEvent`, then signals ready-to-destroy |
| **Pause** | All artifacts extracted up to pause point | Same as completion — adapter shim uploads before confirming pause |
| **Kill (graceful)** | Best-effort extraction | Backend sends `POST /kill`. Adapter shim has a grace period (default: 10s) to upload pending artifacts before the sandbox is force-destroyed |
| **Kill (force / brake)** | Recovery from sandbox filesystem | Sandbox Orchestrator mounts a persistent volume at `/workspace`. On force-kill, the volume survives sandbox destruction. Backend can scan the volume for un-extracted artifacts after the fact |
| **Crash (adapter shim dies)** | Recovery from sandbox filesystem | Same persistent volume recovery. Backend detects crash via missed heartbeats, initiates volume scan |
| **Crash (sandbox infra dies)** | Data loss for un-uploaded artifacts | If the sandbox VM/container vanishes without the persistent volume surviving, un-uploaded artifacts are lost. Mitigation: adapter shim uploads artifacts eagerly (as soon as `ArtifactEvent` is emitted, not batched at completion) |

**Eager upload policy**: The adapter shim uploads artifact content to the
backend immediately when the agent emits an `ArtifactEvent`, not at
completion. This minimizes the data-loss window. The completion handler only
needs to verify all uploads succeeded, not perform them.

**Persistent volume strategy** (Phase 2+): Each sandbox gets a persistent
volume mounted at `/workspace` that outlives the container. The Sandbox
Orchestrator tracks which volumes belong to which agents. On unclean
teardown, the backend runs a recovery scan:

1. List un-extracted files on the persistent volume
2. For each file, check if a matching `ArtifactEvent` (by path) was received
3. If yes and content was already uploaded: skip (already extracted)
4. If yes but content upload failed: re-upload from volume
5. If no matching event: log as orphan file (agent produced it but never
   reported it — surface to human for triage)
6. After recovery, delete the persistent volume

**Phase 0-1**: No persistent volumes. Eager upload is the only protection.
A crash before upload means data loss. Acceptable for prototype development.

### Session management and checkpointing for remote agents

With agents running in remote sandboxes, pause/resume/kill become network
operations with failure modes that don't exist in an in-process model. This
section defines how `SerializedAgentState` works across the RPC boundary,
what gets checkpointed, and the recovery story for each failure scenario.

#### What is SerializedAgentState?

`SerializedAgentState` is the minimum data needed to resume an agent where it
left off (or approximate where it left off, depending on SDK capabilities).
The adapter shim inside the sandbox is responsible for producing it.

```typescript
interface SerializedAgentState {
  // Identity
  agentId: string
  pluginName: string
  sessionId: string               // SDK-specific session reference

  // SDK-specific checkpoint
  checkpoint: SdkCheckpoint

  // Agent context at time of serialization
  briefSnapshot: AgentBrief       // the brief the agent was running with
  conversationSummary?: string    // compressed conversation history (for SDKs
                                  // that don't persist full history natively)
  pendingDecisionIds: string[]    // decisions the agent is blocked on
  lastSequence: number            // last EventEnvelope.sourceSequence emitted

  // Metadata
  serializedAt: string            // ISO 8601
  serializedBy: 'pause' | 'kill_grace' | 'crash_recovery'
  estimatedSizeBytes: number
}

// SDK-specific checkpoint data. Each adapter defines its own shape.
// The backend treats this as an opaque blob — only the adapter can interpret it.
type SdkCheckpoint =
  | { sdk: 'openai'; runStateJson: string }    // OpenAI RunState (true checkpoint)
  | { sdk: 'claude'; sessionId: string; lastMessageId?: string }  // session ref
  | { sdk: 'gemini'; sessionId: string; stateSnapshot?: Record<string, unknown> }
  | { sdk: 'mock'; scriptPosition: number }    // MockPlugin script cursor
```

#### Pause/resume over the network

```
Backend calls POST /pause on sandbox
    -> Adapter shim tells SDK to stop (abort iterator / serialize RunState / stop runner)
    -> Adapter shim extracts SdkCheckpoint from SDK
    -> Adapter shim uploads any pending artifacts (eager upload)
    -> Adapter shim builds SerializedAgentState
    -> Returns SerializedAgentState as POST /pause response body
    -> Backend stores state in Knowledge Store
    -> Backend updates AgentHandle.status = 'paused'
    -> Backend emits LifecycleEvent (action: 'paused')
    -> Sandbox enters idle state (process alive, SDK not running)

Backend calls POST /resume on sandbox (SerializedAgentState in body)
    -> Adapter shim reconstructs SDK session from SdkCheckpoint
    -> Applies any pendingBriefChanges
    -> SDK resumes (new query() with session / Runner.run with RunState / etc.)
    -> Returns new AgentHandle
    -> Backend reconnects event stream WebSocket
    -> Backend emits LifecycleEvent (action: 'resumed')
```

**Size concern**: `SerializedAgentState` can be large depending on the SDK.

| SDK | Typical checkpoint size | Transfer concern |
|---|---|---|
| OpenAI | 1-10 MB (full RunState JSON) | Large POST response; use chunked transfer |
| Claude | < 1 KB (session ID reference) | Trivial — state is server-side at Anthropic |
| Gemini | 10 KB - 1 MB (session state dict) | Moderate — depends on state complexity |

The backend sets a max size limit on the `POST /pause` response (default: 50
MB) and rejects oversized states with `context_overflow`. The adapter shim can
mitigate by triggering conversation compaction before serialization.

#### Kill over the network

Two variants with different reliability guarantees:

**Graceful kill** (`POST /kill` with `grace: true`):
1. Backend sends kill with grace period (default: 10s)
2. Adapter shim stops SDK, extracts `SerializedAgentState`
3. Adapter shim uploads pending artifacts
4. Returns `SerializedAgentState` in kill response
5. Backend stores state (for potential future resume)
6. Sandbox Orchestrator destroys the sandbox

**Force kill** (`POST /kill` with `grace: false`):
1. Backend sends kill with no grace period
2. Adapter shim immediately terminates (best-effort partial state)
3. If sandbox doesn't respond within 5s, Orchestrator force-destroys it
4. Persistent volume recovery (Phase 2+) salvages artifacts
5. No `SerializedAgentState` guaranteed — agent may not be resumable

```typescript
interface KillRequest {
  grace: boolean
  graceTimeoutMs?: number         // default: 10000. Ignored if grace=false.
}

interface KillResponse {
  state?: SerializedAgentState    // present if grace=true and serialization succeeded
  artifactsExtracted: number      // artifacts uploaded during grace period
  cleanShutdown: boolean          // true if SDK terminated cleanly
}
```

#### Crash recovery

When a sandbox crashes (adapter shim dies, container OOM-killed, VM evicted),
the backend detects it via missed heartbeats and/or WebSocket disconnection.

**Recovery timeline**:

1. **Detection** (0-90s): Gateway notices WS disconnection + health endpoint
   unreachable. After 3 consecutive failed health polls (30s interval = 90s
   max detection time), agent is marked as crashed.

2. **Assessment** (immediate): Backend checks:
   - Does the agent have a stored `SerializedAgentState` from a previous
     pause or checkpoint? If yes, it's resumable.
   - Does the sandbox have a persistent volume? If yes, artifacts recoverable.
   - What was the agent's last `EventEnvelope.sourceSequence`? This tells us
     how much work was lost since the last checkpoint.

3. **Recovery options** (surfaced to human via Decision Queue):
   - **Resume from last checkpoint**: Spawn a new sandbox and resume from
     stored state. Agent loses work since last checkpoint.
   - **Restart from scratch**: Fresh agent with same brief. All in-sandbox
     work lost, but eagerly-uploaded artifacts survive.
   - **Abandon**: Mark agent as `error`. Human reviews extracted artifacts.

4. **Automatic recovery** (configurable per agent):

```typescript
interface CrashRecoveryPolicy {
  autoRestart: boolean              // default: false (require human approval)
  autoRestartConditions?: {
    minTrustScore: number           // auto-restart only if trust >= this. Default: 70
    maxConsecutiveCrashes: number   // stop after N crashes. Default: 3
    cooldownMs: number              // wait before restart. Default: 30000
  }
  preferResumeOverRestart: boolean  // try checkpoint resume first. Default: true
}
```

#### Checkpointing strategy

Proactive checkpointing minimizes data loss on crash.

**Checkpoint-on-decision**: When an agent emits a `DecisionEvent` and blocks
waiting for human input, the adapter shim automatically serializes state.
Natural checkpoint — agent is idle, state is consistent, zero cost. Happens
inside the adapter shim without a `POST /pause` from the backend.

**Periodic checkpointing** (Phase 3+): Backend calls `POST /pause` then
immediately `POST /resume` on a schedule (default: every 30 minutes). Produces
a `SerializedAgentState` with only a few seconds of interruption. For SDKs
where `supportsPause` is false, the pause aborts execution and resume
re-enters from the loop top — may lose in-progress reasoning.

**Checkpoint storage**: Stored in Knowledge Store. Backend keeps last N
checkpoints per agent (default: 3). Older checkpoints deleted.

**Phase progression**:
- **Phase 1**: No checkpointing. Crash = full restart.
- **Phase 2**: Checkpoint-on-decision only (low cost, high value).
- **Phase 3+**: Periodic checkpointing + crash recovery policy +
  auto-restart for high-trust agents.

---

## SDK Adapter Mapping

### Capability matrix per SDK:

*Note: Gemini ADK mapping is provisional — based on pre-mid-2025 documentation. Verify against current ADK docs before building the Gemini adapter.*

| Capability | Claude Agent SDK | OpenAI Agents SDK | Gemini ADK |
|---|---|---|---|
| `supportsPause` | **No** — abort iterator + save session_id | **Yes** — `RunState` serialization | **No** — stop runner + persist session |
| `supportsResume` | **Partial** — new `query({ resume })` restarts from session, not mid-execution | **Yes** — `RunState.from_json()` restores exact state | **Partial** — new run with same session |
| `supportsKill` | **Partial** — `{ continue: false }` from hooks for graceful stop, or abort iterator | **Partial** — cancel asyncio task (terminates execution, but no graceful cleanup hook fires) | **No** — stop runner |
| `supportsHotBriefUpdate` | **No** — requires new `query()` turn | **No** — requires Agent recreation | **Partial** — state template updates |

### How each SDK implements the plugin interface:

| Plugin Method | Claude Agent SDK | OpenAI Agents SDK | Gemini ADK |
|---|---|---|---|
| `spawn()` | `query(prompt, options)` | `Runner.run(agent, input)` | `runner.run_async(session_id, message)` |
| `pause()` | Abort iterator + save `session_id` (best-effort) | `result.to_state().to_string()` (true checkpoint) | Stop runner + persist session (best-effort) |
| `resume()` | `query({ resume: sessionId })` | `RunState.from_json()` + `Runner.run(agent, state)` | New `runner.run_async()` with same session |
| `kill()` | `{ continue: false }` from any hook, or abort iterator | Cancel asyncio task | Stop runner |
| Event streaming (transport-level) | Hook callbacks (PreToolUse, PostToolUse, etc.) + message stream -> adapter shim pushes over WS | `Runner.run_streamed()` + `stream_events()` -> adapter shim pushes over WS | Event stream from runner -> adapter shim pushes over WS |
| `resolveDecision()` | Return from `canUseTool` callback | `state.approve(interruption)` + resume | Return tool result to session |
| `injectContext()` | Send via streaming input | Append to session messages | Update session state |
| `updateBrief()` | Queue changes, apply on next `query()` | Queue changes, recreate Agent on next `resume()` | Update agent instructions via state templates |

### Structured output strategy per SDK:

| SDK | How agents emit typed events | Schema enforcement |
|---|---|---|
| **Claude** | Custom MCP tools (`reportDecision`, `logArtifact`, `flagCoherence`) that Claude calls. Hook interception captures structured input. | **Weak** — prompt + tool schema, no runtime guarantee. Backend must validate and repair/reject malformed events. |
| **OpenAI** | Pydantic `output_type` on agents for structured final output. `@function_tool` with schemas for mid-stream events. | **Strong** — Structured Outputs enforces schema. Guardrails add output validation. |
| **Gemini** | Pydantic `output_type` for structured responses. FunctionTools for mid-stream events. Callbacks intercept and validate. | **Moderate** — `output_type` constrains responses. Callbacks provide validation hooks. |

### Event validation pipeline

Because schema enforcement varies by SDK, every event passes through a
backend validation pipeline before entering the event bus:

```
Adapter emits AdapterEvent
    → Schema validation (Zod / JSON Schema)
    → If valid: wrap in EventEnvelope (preserve source fields, add ingestedAt), route to event bus
    → If repairable: auto-fix (e.g. missing optional fields), mark repaired
    → If invalid: quarantine with raw payload + errors for debugging
    → If unstructured text (no tool call): emit as StatusEvent fallback
```

```typescript
interface EventValidationResult {
  valid: boolean
  event?: AgentEvent              // parsed event if valid or repaired
  raw: unknown                    // original data from adapter
  errors?: string[]               // validation errors
  repaired?: boolean              // true if auto-repaired (missing defaults, etc.)
}
```

**Claude-specific concern**: Claude may produce unstructured text instead of
calling the event-reporting MCP tools. The Claude adapter must detect this
and emit the text as a `StatusEvent` rather than silently dropping it. For
critical events (decisions, artifacts), the adapter retries with a corrective
prompt: "Please use the `reportDecision` tool to submit your decision in the
required format."

**Claude `OptionDecisionEvent` reliability**: The `request_decision` MCP tool
requires Claude to provide structured options (each with `id`, `label`,
`description`, `tradeoffs`). Since Claude's structured output is prompt-based
(not schema-enforced like OpenAI/Gemini), the Claude adapter uses a
multi-step correction strategy:

1. **Tool schema enforcement**: The `request_decision` MCP tool defines a
   strict JSON Schema for its input. Claude usually respects tool schemas
   even without native structured output enforcement.
2. **PostToolUse validation**: The Claude adapter's `PostToolUse` hook
   validates the tool call arguments against the `OptionDecisionEvent` schema.
   If fields are missing or malformed, the adapter returns an error result to
   Claude with specific guidance: "The `options` array is missing `tradeoffs`
   on option 2. Please call `request_decision` again with complete options."
3. **Retry budget**: The adapter retries up to 2 times for schema violations
   on `request_decision`. After 3 failed attempts, the adapter emits the
   best-effort event with `repaired: true` (filling missing optional fields
   with defaults) and logs a warning.
4. **Fallback**: If Claude never calls `request_decision` and instead
   describes its decision in text, the adapter emits the text as a
   `StatusEvent` and sends a corrective prompt. If the corrective prompt
   also fails, the adapter creates a synthetic `OptionDecisionEvent` with
   a single option ("Agent proposed: [summary of text]") so the decision
   still enters the Queue for human review rather than being silently lost.

This concern does not apply to `ToolApprovalEvent`, which is produced by the
adapter from `canUseTool` callbacks (not from agent tool calls).

### HITL mapping per SDK:

| SDK | How `ToolApprovalEvent` is produced | How `Resolution` is delivered |
|---|---|---|
| **Claude** | `canUseTool` callback fires. Adapter emits `ToolApprovalEvent` with tool name/args and holds the callback promise as `interruptionRef`. | `approve`: resolve promise with allow. `reject`: resolve with deny. `modify`: resolve with modified args. `alwaysApprove`: update `PreToolUse` allow-list. |
| **OpenAI** | `needs_approval=callback` triggers interruption. Adapter serializes `RunState`, emits `ToolApprovalEvent` with `interruption` as `interruptionRef`. | Load `RunState`, call `state.approve(interruption)` / `state.reject(interruption)`. `alwaysApprove`: set `always_approve=True`. Resume `Runner.run()`. |
| **Gemini** | `before_tool_call` callback intercepts. Adapter emits `ToolApprovalEvent`, blocks callback pending resolution. | `approve`: return tool call result from callback. `reject`: return error. `modify`: alter args before forwarding. No native `alwaysApprove`; adapter maintains allow-list. |

For `OptionDecisionEvent` (human picks from agent-proposed options), all SDKs
use the same pattern: the adapter defines a custom `request_decision` tool that
the agent calls. The backend holds the tool call, surfaces the options to the
UI, and returns the chosen option as the tool result. Claude-specific
reliability concerns are addressed in the correction strategy above.

---

## Event Routing

Every event emitted by an adapter arrives as an `AdapterEvent` (defined
above) before entering the routing pipeline. The adapter generates source
identity fields (`sourceEventId`, `sourceSequence`, `sourceOccurredAt`);
the backend adds `ingestedAt` to produce an `EventEnvelope` and forwards it
to the event bus. The envelope provides global ordering, deduplication, and
trace correlation regardless of which SDK produced the event.

```
Agent Adapter → Envelope → Event Bus → Classifier → Workspace Router
                                          │
                              ┌───────────┼───────────┐
                              ↓           ↓           ↓
                        Decision      Knowledge    Trust
                        Queue         Store        Engine
                              │           │           │
                              └───────────┼───────────┘
                                          ↓
                                   WebSocket Hub
                                          ↓
                                   React Frontend
```

### Ordering guarantees

- Events from a single agent are processed in `sourceSequence` order. The event
  bus buffers out-of-order events (up to a configurable window) before delivering.
- Cross-agent ordering uses `sourceOccurredAt` timestamps. No global total order
  is guaranteed -- workspaces handle concurrent agent events independently.
- The Knowledge Store uses optimistic concurrency on writes (version checks)
  to prevent stale-read overwrites when multiple agents update the same artifact.
- Duplicate detection: the event bus drops envelopes with previously seen
  `sourceEventId` values (idempotency). Because `sourceEventId` is generated
  by the adapter and is immutable across replay, replayed events are
  correctly deduplicated.

### Latency budget

The event pipeline has multiple hops in the sandbox model. Target latencies
for the critical path (agent action -> UI update):

```
Agent emits event in sandbox
    → Adapter shim forwards over WS     ~1-5ms (local network / loopback)
    → Backend validates + adds ingestedAt ~1-2ms (Zod validation)
    → Event bus classifies + routes      ~0.5ms (in-memory dispatch)
    → WebSocket Hub pushes to frontend   ~1-2ms
    ─────────────────────────────────────────────
    Total target: < 50ms p95 (local Docker)
                  < 200ms p95 (cloud sandbox, same region)
```

These targets apply to lightweight events (`StatusEvent`, `ToolCallEvent`,
`LifecycleEvent`). Events that trigger Knowledge Store writes (`ArtifactEvent`
with content upload, `DecisionEvent` with scoring) have higher latency due to
the write path — target < 200ms p95 for local, < 500ms p95 for cloud.

The Briefing workspace's "feeling of real-time" depends on `StatusEvent` and
`ProgressEvent` latency. At < 50ms p95, updates appear instantaneous. The
Queue workspace's decision rendering is less latency-sensitive (decisions
persist for human review — 500ms is acceptable).

**Monitoring**: The backend should track p50/p95/p99 of
`eventEnvelope.sourceOccurredAt` to `WebSocket send timestamp` for each event type.
This is a Phase 3 observability deliverable.

### Classification rules:

| Event Type | Primary Workspace | Secondary |
|---|---|---|
| `decision` | Queue | Briefing (activity feed) |
| `artifact` | Map (knowledge) | Brief Editor (agents panel) |
| `coherence` | Map (coherence) | Briefing (attention) |
| `status` | Briefing (activity) | — |
| `tool_call` | Controls (decision log) | — |
| `completion` | Briefing (narrative) | Controls (trust update) |
| `error` | Briefing (alert) | Controls |
| `delegation` | Briefing (activity) | Map (topology) |
| `guardrail` | Controls (decision log) | Briefing (alert if tripped) |
| `lifecycle` | Briefing (activity) | Controls |
| `progress` | Briefing (activity) | — |
| `raw_provider` | — (logged only) | Controls (debug) |

### WebSocket message protocol

After classification and routing, the WebSocket Hub delivers messages to the
React frontend. Each message is workspace-scoped so the frontend can dispatch
to the correct component without re-classifying.

```typescript
type WebSocketMessage =
  | EventMessage              // routed agent event
  | StateSyncMessage          // full state push (on connect or reconnect)
  | BrakeMessage              // emergency brake notification
  | TrustUpdateMessage        // trust score change
  | DecisionResolvedMessage   // decision outcome (for optimistic UI updates)

interface EventMessage {
  type: 'event'
  workspace: string              // primary workspace target
  secondaryWorkspaces: string[]  // additional workspaces to notify
  envelope: EventEnvelope
}

interface StateSyncMessage {
  type: 'state_sync'
  snapshot: KnowledgeSnapshot
  activeAgents: AgentHandle[]
  trustScores: { agentId: string; score: number }[]  // current trust per agent
                                                      // (frontend-only; not in snapshot
                                                      // because agents must not see scores)
  controlMode: ControlMode
}

interface BrakeMessage {
  type: 'brake'
  action: BrakeAction
  affectedAgentIds: string[]
}

interface TrustUpdateMessage {
  type: 'trust_update'
  agentId: string
  previousScore: number
  newScore: number
  delta: number
  reason: string
}

interface DecisionResolvedMessage {
  type: 'decision_resolved'
  decisionId: string
  resolution: Resolution
  agentId: string
}
```

On initial connection (or reconnect after disconnect), the server sends a
`StateSyncMessage` with the current snapshot. After that, incremental updates
arrive as individual messages. The frontend should reconcile based on
`EventEnvelope.sourceSequence` to handle messages that arrive out of order
during reconnection.

### Frontend REST API

The wire protocol tables above define sandbox-facing endpoints. The frontend
needs a separate set of REST endpoints to interact with the backend. These
are standard HTTP endpoints on the backend server, authenticated per user.

| Endpoint | Method | Purpose | Used by |
|---|---|---|---|
| `/api/agents` | `GET` | List all agents with status | Controls, Briefing |
| `/api/agents/:id` | `GET` | Get agent detail (handle + brief) | Controls |
| `/api/agents/spawn` | `POST` | Spawn a new agent (brief in body) | Brief Editor |
| `/api/agents/:id/kill` | `POST` | Kill an agent | Controls |
| `/api/agents/:id/pause` | `POST` | Pause an agent | Controls |
| `/api/agents/:id/resume` | `POST` | Resume a paused agent | Controls |
| `/api/agents/:id/brief` | `PATCH` | Update agent brief (Partial\<AgentBrief\> in body) | Brief Editor |
| `/api/decisions` | `GET` | List pending decisions | Queue |
| `/api/decisions/:id/resolve` | `POST` | Resolve a decision (Resolution in body) | Queue |
| `/api/artifacts` | `GET` | List artifacts (filtered by workstream) | Map |
| `/api/artifacts/:id` | `GET` | Get artifact detail + content | Map |
| `/api/coherence` | `GET` | List coherence issues | Map |
| `/api/brake` | `POST` | Trigger emergency brake (BrakeAction in body) | Controls |
| `/api/brake/release` | `POST` | Release brake | Controls |
| `/api/control-mode` | `GET` | Get current control mode | Controls |
| `/api/control-mode` | `PUT` | Change control mode | Controls |
| `/api/trust/:agentId` | `GET` | Get trust profile | Controls |

The frontend uses REST for commands (spawn, kill, resolve, brake) and
WebSocket for real-time updates (events, state sync). This is a clean split:
REST for request-response operations, WebSocket for streaming.

**Phase 1 scope**: Implement `spawn`, `kill`, `decisions`, `decisions/:id/resolve`,
and `agents` endpoints. These are the minimum needed for the Phase 1 vertical
slice (spawn agent -> see decision in Queue -> resolve -> see completion).
Other endpoints are Phase 2+.

### Tick Service

Many parts of the system reference "ticks" — `dueByTick` on decisions,
`periodicIntervalTicks` and `cooldownTicks` on context injection,
`trustDecayTicks` on trust decay, decision `timeoutTicks`. This section
defines the authoritative tick model.

**What a tick is**: A tick is a logical time unit managed by the backend's
`TickService`. It is **not** wall-clock time — it is an abstraction that
decouples system timing from real-time pressure, enabling deterministic
testing, replay, and speed-adjusted demos.

**Clock source and increment rules**:

```typescript
interface TickService {
  currentTick(): number             // returns the current tick count
  onTick(handler: (tick: number) => void): void  // subscribe to tick events
  start(): void                     // begin ticking
  stop(): void                      // pause ticking (e.g. when no agents running)
}

interface TickConfig {
  intervalMs: number                // wall-clock milliseconds per tick. Default: 1000 (1s)
  mode: 'wall_clock' | 'manual'    // manual = test mode (advance via API)
}
```

**Increment rules**:

1. In `wall_clock` mode, the `TickService` increments the tick counter once
   every `intervalMs` milliseconds. Default: 1 tick per second.
2. In `manual` mode (testing, step-through demos), ticks only advance when
   explicitly triggered via `POST /api/tick/advance` or programmatically.
3. The tick counter is monotonically increasing, starts at 0 on backend
   startup, and resets on restart (it is not persisted across restarts in
   Phase 0-2; persistence is a Phase 3+ concern).
4. When no agents are running, the TickService SHOULD pause to avoid
   meaningless tick accumulation. The tick counter does not reset or
   skip — it simply stops incrementing while paused and resumes from
   where it left off on the next `spawn()`.

**Relationship to wall-clock time**:

| `intervalMs` | Tick rate | Use case |
|---|---|---|
| 1000 (default) | 1 tick/sec | Normal operation |
| 100 | 10 ticks/sec | Fast demo (10x speed multiplier) |
| ∞ (manual mode) | On demand | Unit tests, step-through debugging |

**How other systems consume ticks**:

- **Decision timeout**: `dueByTick` (adapter-provided or backend-stamped at
  ingestion) is an absolute tick number. When
  `currentTick() >= dueByTick`, the timeout policy fires.
- **Trust decay**: The trust engine subscribes to `onTick` and applies decay
  every `decayRatePerTick` interval (default: 1 point per 100 ticks of
  inactivity for an agent).
- **Context injection**: `periodicIntervalTicks` drives periodic refresh;
  `cooldownTicks` enforces minimum spacing between injections.
- **Coherence scans**: Layer 1 periodic scans run every N ticks.

**Phase plan**: The TickService is a Phase 0 deliverable (required for
trust decay, decision timeouts, and context injection timing). Phase 0
implements `wall_clock` and `manual` modes. The speed multiplier
(variable `intervalMs`) is available from Phase 0 for demo scripts.

### Trust score update rules:

Trust updates are applied **atomically per event** via the Knowledge Store's
`updateTrust()` method. When multiple events resolve concurrently, each delta
is applied against the latest score (read-then-write with optimistic locking).

**Trust score semantics:**

- **Range**: Clamped to **[10, 100]**. No agent reaches 0 -- there is always
  a recovery path. New agents start at 50.
- **Decay**: Trust decays toward 50 at a rate of 1 point per `trustDecayTicks`
  inactive ticks (configurable, default 100). Agents above 50 lose 1, agents
  below 50 gain 1. This prevents stale high-trust from persisting indefinitely
  and allows low-trust agents to recover through inactivity.
- **Diminishing returns**: At extremes (score > 90 or score < 20), all deltas
  are halved (rounded toward zero). It is harder to reach the ceiling and
  harder to hit the floor.

| Outcome | Base Delta | Trigger |
|---|---|---|
| Human approves agent's recommended option | +2 | Decision resolved (option, choose_option) |
| Human approves tool call | +1 | Decision resolved (tool_approval, approve) |
| Human approves with `alwaysApprove` | +3 | Decision resolved (tool_approval, approve, alwaysApprove=true) |
| Human picks non-recommended option | -1 | Decision resolved (option, choose_option) |
| Human modifies tool args and approves | -1 | Decision resolved (tool_approval, modify) |
| Human rejects tool call | -2 | Decision resolved (tool_approval, reject) |
| Human overrides agent action via brake | -3 | Emergency brake on agent's work |
| Artifact passes review without rework | +1 | Artifact status -> approved |
| Artifact requires rework | -2 | Artifact status -> rejected / rework |
| Agent flags genuine coherence issue | +1 | Coherence issue confirmed |
| Agent misses coherence issue (human finds it) | -2 | Human-created coherence issue |
| Decision auto-resolved via timeout | 0 | Timeout policy fires (not agent's fault) |
| Agent completes task successfully | +1 | CompletionEvent (outcome=success) |
| Agent partially completes task | 0 | CompletionEvent (outcome=partial) |
| Agent abandons or hits max_turns | -1 | CompletionEvent (outcome=abandoned/max_turns) |

*Base Delta is the value before diminishing returns are applied.*

**Anti-gaming considerations and known coarseness (Phase 3 hardening):**

The delta table above is intentionally simple for Phase 0-2. Two known
weaknesses are deferred to Phase 3 with explicit rationale:

1. **Decay toward 50 rewards inactivity for low-trust agents.** A low-trust
   agent (score 25) that sits idle will drift back to 50 without demonstrating
   improved behavior. This is a deliberate tradeoff: the alternative (no
   recovery without positive actions) permanently punishes agents after early
   failures, discouraging re-use. The decay is slow (1 point per 100 ticks
   default) and only reaches 50, never high-trust territory. An agent that
   decays to 50 still faces the full escalation protocol for adaptive mode
   (the trust < 70 rule fires). **Phase 3 mitigation**: Add a
   `decayCeiling` parameter (default: 50) that caps how high decay alone can
   push a score. For stricter projects, set `decayCeiling: 30` so inactive
   agents recover only to low-trust baseline, not neutral.

2. **`alwaysApprove` gives +3 without risk normalization.** A human clicking
   `alwaysApprove` on a low-risk `read` tool grants the same +3 as approving
   a high-risk `deploy` tool. This means an agent can farm trust through
   trivial approvals. Current mitigation: diminishing returns at score > 90
   halve the delta to +1, limiting the ceiling effect. The delta table is
   also tunable per-project via `TrustCalibrationConfig.deltaTable`, so
   operators can reduce the `alwaysApprove` delta. **Phase 3 mitigation**:
   Add a risk-weighted delta modifier where `effectiveDelta = baseDelta *
   riskWeight(toolCategory)`. The `EscalationPredicate.blastRadius` field
   already classifies actions into `low`/`medium`/`high`/`critical` — Phase 3
   reuses this classification to weight trust deltas (e.g., `low` = 0.5x,
   `critical` = 2.0x). This requires the trust engine to read the originating
   action's risk classification, which is already available in the
   `DecisionEvent` context.

3. **No sample-size normalization.** An agent with 3 approvals out of 3
   decisions has the same trust trajectory as one with 300 out of 300. Phase 3
   can add a confidence interval that widens the auto-approve threshold for
   agents with few data points, but this is unnecessary in Phase 0-2 where
   MockPlugin scenarios have controlled sample sizes and Phase 1 runs a
   single real agent under close human supervision.

### Trust score calibration

The delta values and decay rate above are initial guesses. This section defines
how to validate and tune them.

**Trust visibility**: Trust scores are **backend-only state**, never sent to
agents. The score determines which escalation rules fire and how the backend
routes decisions, but the agent never sees it. Rationale: an agent that knows
it has low trust may over-escalate (asking for approval on everything to "earn
trust back"), which defeats adaptive control. An agent that knows it has high
trust may become overconfident. Trust affects the agent's *environment* (what
gets auto-approved vs. escalated), not its *self-image*.

This is enforced structurally: `trustScore` is not a field on `AgentBrief`,
not included in `AgentSummary` (which appears in `KnowledgeSnapshot`), and
not present in any data injected into agents. The backend reads trust from
the Trust Engine when evaluating `EscalationPredicate` rules and when
building the `escalationProtocol` for a brief. The frontend receives trust
via `TrustUpdateMessage` and `StateSyncMessage.trustScores`.

**Calibration strategy -- simulation-first, then live tuning**:

**Phase 0-1: Simulation with MockPlugin scenarios.** The MockPlugin's scripted
scenarios produce deterministic event sequences. Run each scenario through the
trust engine with the current delta table and verify:

1. **Convergence**: Does a "good" agent (Maya's Research Agent: mostly approvals,
   clean completions) reach trust > 80 within a reasonable number of ticks?
2. **Recovery**: Does a "struggling" agent (one that gets several rejections)
   stabilize above the floor (> 20) and recover when it starts performing well?
3. **Separation**: Do agents with different quality levels end up at meaningfully
   different trust scores? If a good agent and a bad agent both converge to 50,
   the system isn't discriminating.
4. **Responsiveness**: Does the score react quickly enough to a sudden behavior
   change (e.g., a good agent starts producing bad artifacts)?

```typescript
// Type-safe keys for the trust delta table. Each key corresponds to
// an outcome in the "Trust score update rules" table above.
type TrustOutcome =
  | 'human_approves_recommended_option'    // +2
  | 'human_approves_tool_call'             // +1
  | 'human_approves_always'                // +3
  | 'human_picks_non_recommended'          // -1
  | 'human_modifies_tool_args'             // -1
  | 'human_rejects_tool_call'              // -2
  | 'human_overrides_via_brake'            // -3
  | 'artifact_approved'                    // +1
  | 'artifact_rejected'                    // -2
  | 'coherence_issue_confirmed'            // +1
  | 'coherence_issue_missed'               // -2
  | 'decision_auto_resolved'               // 0
  | 'task_completed_success'               // +1
  | 'task_completed_partial'               // 0
  | 'task_abandoned_or_max_turns'          // -1

interface TrustCalibrationConfig {
  // All trust parameters are configurable per-project
  initialScore: number                // default: 50
  floorScore: number                  // default: 10
  ceilingScore: number                // default: 100
  decayTargetScore: number            // default: 50
  decayRatePerTick: number            // default: 0.01 (1 point per 100 ticks)
  diminishingReturnThresholdHigh: number  // default: 90
  diminishingReturnThresholdLow: number   // default: 20
  deltaTable: Partial<Record<TrustOutcome, number>>  // override base deltas per outcome

  // Calibration mode: log proposed deltas without applying them
  calibrationMode: boolean            // default: false
}
```

**`calibrationMode`**: When true, the trust engine logs what deltas it *would*
apply without actually changing scores. This lets operators observe the trust
trajectory over a real project before committing to the parameters. The
Briefing workspace shows a "trust calibration" overlay comparing actual
(frozen) scores with hypothetical (computed) scores.

**Phase 2: Live tuning with real agents.** Once real agents are running:

1. Enable `calibrationMode` for the first project run. Observe proposed deltas.
2. Adjust delta table values based on whether the proposed trajectories match
   human intuition ("this agent is doing well, its score should be going up").
3. Disable `calibrationMode` and run live for several sessions.
4. Compare trust-based escalation decisions against what the human would have
   chosen manually. If the system is escalating things the human wouldn't care
   about (false escalation) or missing things the human would want to see
   (false auto-approval), adjust thresholds.

**Phase 3+: Per-project profiles.** Different project types may need different
calibration. A high-stakes production deployment should have tighter deltas
(slower trust gain, faster trust loss) than a low-stakes content project.
Profiles are implemented as `TrustCalibrationProfile` presets with a
`negativeDeltaMultiplier` that scales all negative deltas in the delta table:

```typescript
interface TrustCalibrationProfile {
  name: 'conservative' | 'balanced' | 'permissive'
  config: TrustCalibrationConfig
  negativeDeltaMultiplier: number   // applied to all negative base deltas
  positiveDeltaMultiplier: number   // applied to all positive base deltas
}
// NOTE: `TrustCalibrationProfile` is a project-level preset for tuning the
// trust engine. `TrustProfile` (referenced by KnowledgeStore.getTrustProfile)
// is per-agent runtime state (score, trajectory, history). They are distinct
// types — calibration profiles configure the engine; trust profiles are its
// output per agent.
```

The multiplier is applied at evaluation time: `effectiveDelta = baseDelta *
(delta < 0 ? negativeDeltaMultiplier : positiveDeltaMultiplier)`, rounded
toward zero. Explicit `deltaTable` overrides take precedence over multipliers.

| Profile | Initial Score | Decay Rate | Neg Multiplier | Pos Multiplier | Use Case |
|---|---|---|---|---|---|
| `conservative` | 30 | 0.02 | 1.5x | 0.75x | Production, compliance, security |
| `balanced` | 50 | 0.01 | 1.0x | 1.0x | General development |
| `permissive` | 70 | 0.005 | 0.5x | 1.25x | Prototyping, content, low-risk |

### Decision timeout policy

`OptionDecisionEvent` and `ToolApprovalEvent` MAY include `dueByTick`; if
omitted, the backend stamps it at ingestion from `TickService.currentTick()`.
The system needs defined behavior when a decision expires without human
response. Without this, agents hang indefinitely waiting for approval.

```typescript
interface DecisionTimeoutPolicy {
  timeoutTicks: number | null        // null = no timeout (block forever)
  onTimeout: 'auto_recommend' | 'escalate' | 'cancel' | 'extend'
  maxExtensions?: number             // how many times timeout can auto-extend
}
```

**Timeout behaviors:**

- **`auto_recommend`**: The system resolves the decision using the agent's
  recommended option (for `OptionDecisionEvent`) or auto-approves (for
  `ToolApprovalEvent`). Trust is not affected -- the human chose to delegate
  by not responding.
- **`escalate`**: The decision severity is increased by one level and it
  returns to the top of the Queue with a "timed out" badge. If already at
  maximum severity, falls through to `cancel`.
- **`cancel`**: The decision is cancelled. For tool approvals, the tool call
  is rejected. The agent receives a cancellation and must find an alternative
  approach. Trust delta: 0 (not the agent's fault).
- **`extend`**: The timeout resets. After `maxExtensions` (default: 2),
  falls through to `escalate`.

**Default policy per control mode:**

| Control Mode | Default Timeout | Default Action |
|---|---|---|
| Orchestrator | null (no timeout) | -- (human must respond) |
| Adaptive | 50 ticks | `auto_recommend` (Phase 0/1); `escalate` (Phase 3) |
| Ecosystem | 20 ticks | `auto_recommend` |

The default policy can be overridden per agent via `AgentBrief` or per
decision via the `DecisionEvent` itself.

---

## Control Mode Enforcement

The plugin interface doesn't enforce control modes directly. Instead, the
backend evaluates typed **policy predicates** (see `EscalationPredicate` above)
against each action and translates the result into adapter-specific
approval/deny signals when calling `spawn()` or `updateBrief()`.

The escalation engine runs in the backend, not in the agent. This means
escalation behavior is deterministic and consistent regardless of which SDK
adapter is powering the agent.

### Orchestrator Mode

```typescript
const orchestratorBrief: Partial<AgentBrief> = {
  controlMode: 'orchestrator',
  escalationProtocol: {
    alwaysEscalate: ['write', 'edit', 'execute', 'deploy', 'delete'],
    escalateWhen: [],               // alwaysEscalate covers everything risky
    neverEscalate: ['read', 'search'],
  },
  allowedTools: ['read', 'search', 'analyze'],
}
```

The adapter translates this into:
- **Claude**: All tools go through `canUseTool`, most require human approval
- **OpenAI**: `needs_approval=True` on all write tools, guardrails on outputs
- **Gemini**: `before_tool_call` blocks all write operations pending approval

### Ecosystem Mode

```typescript
const ecosystemBrief: Partial<AgentBrief> = {
  controlMode: 'ecosystem',
  escalationProtocol: {
    alwaysEscalate: ['delete', 'deploy'],
    escalateWhen: [
      {
        predicate: { field: 'confidence', op: 'lt', value: 0.5 },
        description: 'Low confidence decisions need human review',
      },
    ],
    neverEscalate: ['read', 'search', 'write', 'edit', 'execute'],
  },
  allowedTools: ['read', 'write', 'edit', 'execute', 'search', 'deploy'],
}
```

### Adaptive Mode

```typescript
// For an agent whose current trust score is 82 (read from Trust Engine):
const adaptiveBrief: Partial<AgentBrief> = {
  controlMode: 'adaptive',
  // trustScore is NOT in the brief. The backend reads it from the Trust Engine
  // when evaluating the EscalationPredicates below at decision time.
  escalationProtocol: {
    alwaysEscalate: ['delete', 'deploy'],
    escalateWhen: [
      {
        predicate: {
          type: 'and',
          rules: [
            { field: 'confidence', op: 'lt', value: 0.8 },
            { field: 'blastRadius', op: 'gte', value: 'medium' },
          ],
        },
        description: 'Low confidence + non-trivial blast radius',
      },
      {
        predicate: { field: 'trustScore', op: 'lt', value: 70 },
        description: 'Low-trust agent -- escalate all non-trivial actions',
      },
      {
        predicate: { field: 'affectsMultipleWorkstreams', op: 'eq', value: true },
        description: 'Cross-workstream actions need human sign-off',
      },
    ],
    neverEscalate: [],
  },
}
// With trust at 82, the trustScore < 70 rule doesn't fire, so only
// cross-workstream and low-confidence+high-blast-radius rules apply.
```

### Mode Transitions

Control mode can be changed at any time from the Controls workspace. When
the mode changes:

1. All running agents receive an `updateBrief()` with the new `controlMode`
   and corresponding `escalationProtocol`.
2. Since most adapters don't support hot brief updates, the changes are queued
   in `AgentHandle.pendingBriefChanges` and apply on the next agent restart
   or resume.
3. Pending decisions in the Queue are **not** re-evaluated -- they were
   created under the old mode's rules and should be resolved as-is.
4. Agents still running under the old brief continue to *emit* decisions as
   if under the old escalation protocol, but the **backend escalation engine**
   re-evaluates all incoming decisions against the new project-level control
   mode (see Known limitation and escalation-side enforcement mitigation
   below). This means stricter rules apply immediately at the backend even
   before agents pick up the updated brief.
5. A `StateSyncMessage` is pushed to the frontend with the updated
   `controlMode`.

**Known limitation: mode changes are not immediate for most SDKs.** The
OpenAI Agents SDK and Claude Agent SDK do not support updating an agent's
instructions mid-run (`supportsHotBriefUpdate: false`). When the human
switches from Ecosystem to Orchestrator mode (a safety-critical transition),
agents already running continue under the old, more permissive escalation
rules until their next restart or HITL resume point. This creates a window
where the Controls workspace shows the new mode but running agents behave
under the old mode.

**Mitigations:**

- **UI indicator**: The Controls workspace shows per-agent brief sync status.
  Agents with `pendingBriefChanges !== undefined` display a "mode change
  pending" badge so the human can see which agents have not yet picked up
  the new mode.
- **Escalation-side enforcement**: Even when the agent's brief still reflects
  the old mode, the **backend escalation engine** applies the new mode's
  rules to incoming decisions. The backend evaluates `EscalationPredicate`
  rules using the *project-level* control mode (which changed immediately),
  not the agent's brief copy. This means new decisions from a stale-brief
  agent are still escalated under the stricter rules. The agent may produce
  decisions it wouldn't have under the new brief, but the backend correctly
  routes them.
- **Force restart option**: The Controls workspace offers a "restart agents
  to apply mode change" action that kills and respawns all agents with the
  updated brief. This is opt-in because it interrupts in-progress work.
- **Decision checkpoint**: Adapters that support pause (Gemini partial, Mock)
  can be paused, briefed, and resumed. For OpenAI/Claude, the adapter queues
  the change and applies it the next time the agent blocks on a decision
  (the resume path re-reads the brief from `AgentHandle`).

### Emergency Brake

The prototype has a single brake button. In production with multiple agents
and workstreams, the brake needs scoping:

```typescript
type BrakeScope =
  | { type: 'all' }                       // stop everything
  | { type: 'agent'; agentId: string }    // stop one agent
  | { type: 'workstream'; workstream: string }  // stop all agents in a workstream

interface BrakeAction {
  scope: BrakeScope
  reason: string
  behavior: 'pause' | 'kill'             // pause for review vs. terminate
  initiatedBy: string                     // user ID or 'system' (auto-brake)
  timestamp: string                       // ISO 8601
  releaseCondition?: BrakeReleaseCondition  // how/when to release (default: manual)
}

type BrakeReleaseCondition =
  | { type: 'manual' }                        // human must explicitly release
  | { type: 'timer'; releaseAfterMs: number } // auto-release after delay
  | { type: 'decision'; decisionId: string }  // release when a specific decision resolves
```

Default is `manual`. Timer-based release is useful for workstream brakes
(e.g. brake for 10 minutes while reviewing, then auto-release). Decision-based
release lets you tie the brake to a pending human decision -- once the human
resolves it, the agents resume automatically.

When the brake fires:

1. The backend identifies affected agents based on `scope`.
2. For each agent, it calls `pause()` or `kill()` on the adapter (respecting
   capability flags -- if `supportsPause` is false, pause degrades to
   abort-and-save).
3. A `LifecycleEvent` with action `'paused'` or `'killed'` is emitted for
   each affected agent.
4. Trust deltas (-3) are applied to all braked agents.
5. All pending decisions from braked agents are marked as `'suspended'` in the
   Decision Queue (not discarded -- they can be resumed).
6. The Briefing workspace shows a brake notification with scope and reason.

After review, the human can resume individual agents or the entire scope.

### In-flight decisions on agent kill

When an agent is killed (via brake or explicit kill from Controls), its pending
decisions in the Decision Queue need a defined disposition. The behavior differs
based on the kill context:

**Brake-initiated kill** (emergency brake with `behavior: 'kill'`):
Pending decisions are marked `'suspended'`. They remain in the Queue with a
"source agent braked" badge. The human can resume the agent later, at which
point suspended decisions become active again. If the human decides not to
resume, the suspended decisions follow the explicit-kill policy below.

**Explicit kill** (human kills agent from Controls, or system kills due to
unrecoverable error):
The agent will not be resumed. Its pending decisions enter a **grace period**
(configurable, default: 30 seconds) before the `OrphanedDecisionPolicy` fires.
During the grace period, decisions show as "agent killed -- pending triage" in
the Queue. This gives the human a moment to spawn a replacement agent before
decisions get cancelled. After the grace period expires (or immediately if
`gracePeriodMs: 0`), the policy fires:

```typescript
interface OrphanedDecisionPolicy {
  default: OrphanedDecisionAction
  gracePeriodMs: number               // default: 30000 (30 seconds)
  perSubtype?: {
    option?: OrphanedDecisionAction
    tool_approval?: OrphanedDecisionAction
  }
}

type OrphanedDecisionAction =
  | 'triage'                          // leave in Queue for human, badge as "agent killed"
  | 'cancel'                          // auto-reject tool approvals, expire option decisions
  | 'reassign'                        // assign to replacement agent of same role (if available)
```

**Default policy**: `{ default: 'triage', gracePeriodMs: 30000 }`. All orphaned
decisions stay in the Queue with an "agent killed" badge and elevated visual
priority. The human can then resolve them manually (choose an option,
approve/reject a tool call) or dismiss them. This is the safest default because
it preserves human agency.

**When `cancel` fires**: Tool approval decisions are auto-rejected (the tool
call does not execute). Option decisions are expired with no resolution -- any
downstream work that depended on the decision outcome must be re-triggered by
whatever agent picks up the workstream next. Trust delta: 0 (not the killed
agent's fault, not the human's fault).

**When `reassign` fires**: The backend checks the Agent Registry for another
running agent with the same `role` in the same `workstream`. If found, the
decision gets a `reassignedTo` field pointing to the replacement agent, while
`agentId` is preserved as the original creator (maintaining provenance for
trust scoring and audit). A `ContextInjection` is sent to the replacement
agent summarizing the orphaned decision context. If no replacement is
available, falls through to `triage`. Reassignment emits a `StatusEvent`
noting the transfer.

**Provenance**: The `agentId` on a decision always reflects the agent that
originally created it. When a decision is reassigned, the trust engine knows
the decision originated from agent A (who was killed) and is now being handled
in the context of agent B. Resolution trust deltas apply to agent B (who is
now responsible), not agent A (who is dead).

**Configuration**: The policy is set at the project level in `ControlConfig`
and can be overridden per control mode:

| Control Mode | Recommended Policy |
|---|---|
| Orchestrator | `{ default: 'triage' }` -- human reviews everything |
| Adaptive | `{ default: 'triage', perSubtype: { tool_approval: 'cancel' } }` -- triage options, cancel tool calls |
| Ecosystem | `{ default: 'cancel', perSubtype: { option: 'triage' } }` -- cancel tool calls, triage design decisions |

---

## Knowledge Store

The shared knowledge layer that all agents read from and write to. **Agents
never access the store directly** -- the backend mediates all access, enforces
workstream scoping (see Security Boundaries above), and logs the caller for
audit. All write operations use **optimistic concurrency control** -- each
entity carries a `version` field, and writes fail with a conflict error if
the version has changed since the caller's last read.

**Phase progression for storage backend**:
- **Phase 0-1**: In-memory `KnowledgeStore` implementation. All state lives
  in backend process memory. Fast, zero setup, lost on restart. Sufficient
  for development and testing with MockPlugin and a single real agent.
- **Phase 2+**: SQLite or Postgres backend with the same `KnowledgeStore`
  interface. The in-memory version remains available for tests.

```typescript
interface KnowledgeStore {
  // Artifacts
  getArtifacts(workstream?: string): Promise<Artifact[]>
  getArtifact(id: string): Promise<Artifact | null>
  upsertArtifact(artifact: Artifact, expectedVersion: number, callerAgentId: string): Promise<void>
    // throws ConflictError if artifact.version !== expectedVersion
    // callerAgentId recorded in audit log

  // Decisions
  // Note: KnowledgeStore.resolveDecision() persists the resolution in the store.
  // This is separate from AgentPlugin.resolveDecision(), which delivers the
  // resolution to the running agent via RPC. The backend calls both: first
  // AgentPlugin (to unblock the agent), then KnowledgeStore (to persist).
  getPendingDecisions(): Promise<DecisionItem[]>
  getDecisionLog(): Promise<DecisionLogEntry[]>
  resolveDecision(id: string, resolution: Resolution, expectedVersion: number, callerAgentId: string): Promise<void>
    // throws ConflictError if already resolved or version mismatch

  // Coherence
  getCoherenceIssues(status?: CoherenceStatus): Promise<CoherenceIssue[]>
  addCoherenceIssue(issue: CoherenceIssue, callerAgentId: string): Promise<void>
  resolveCoherenceIssue(id: string, resolution: string, callerAgentId: string): Promise<void>

  // Trust
  getTrustProfile(agentId: string): Promise<TrustProfile>
  updateTrust(agentId: string, delta: number, reason: string): Promise<void>
    // atomic read-modify-write; no version param needed (delta-based)
    // caller is always the backend trust engine, not an agent directly

  // Context (for injecting into agent briefs)
  getSnapshot(workstream?: string): Promise<KnowledgeSnapshot>

  // Event log (for replay and temporal navigation)
  appendEvent(envelope: EventEnvelope): Promise<void>
  getEvents(filter: EventFilter): Promise<EventEnvelope[]>
}

interface EventFilter {
  agentId?: string
  runId?: string
  types?: AgentEvent['type'][]
  since?: string                   // ISO 8601
  limit?: number
}

// What an agent receives as project context in its brief.
// Scoped to the agent's readable workstreams to limit size.
interface KnowledgeSnapshot {
  version: number                          // monotonic, for freshness/dedup
  generatedAt: string                      // ISO 8601

  // Workstream summaries (only workstreams this agent can read)
  workstreams: WorkstreamSummary[]

  // Pending decisions (summaries only -- full detail via tool call)
  pendingDecisions: DecisionSummary[]

  // Recent coherence issues (last N, configurable)
  recentCoherenceIssues: CoherenceIssueSummary[]

  // Artifact index: metadata only, not full content
  artifactIndex: ArtifactSummary[]

  // Who else is working (so agents can coordinate)
  activeAgents: AgentSummary[]

  // Token budget tracking -- backend estimates before injecting
  estimatedTokens: number
}

interface WorkstreamSummary {
  id: string
  name: string
  status: string
  activeAgentIds: string[]
  artifactCount: number
  pendingDecisionCount: number
  recentActivity: string              // 1-2 sentence summary
}

interface DecisionSummary {
  id: string
  title: string
  severity: Severity
  agentId: string
  subtype: 'option' | 'tool_approval'
}

interface CoherenceIssueSummary {
  id: string
  title: string
  severity: Severity
  category: CoherenceCategory
  affectedWorkstreams: string[]
}

interface ArtifactSummary {
  id: string
  name: string
  kind: ArtifactKind
  status: 'draft' | 'in_review' | 'approved' | 'rejected'
  workstream: string
}

interface AgentSummary {
  id: string
  role: string
  workstream: string
  status: 'running' | 'paused' | 'waiting_on_human' | 'completed' | 'error'
  // NOTE: trustScore is intentionally EXCLUDED from AgentSummary. The trust
  // calibration section establishes that agents must not see their numeric
  // trust score (it affects their environment, not their self-image). Since
  // KnowledgeSnapshot is injected into agents, including trustScore here
  // would leak it. The frontend gets trust data via TrustUpdateMessage
  // over WebSocket, not from the snapshot. The snapshot trimming rule
  // "drop trust scores from activeAgents" (see Snapshot sizing) refers to
  // this deliberate omission.
  pluginName: string              // "claude", "openai", "gemini", "mock"
  modelPreference?: string        // "opus", "gpt-4o", "gemini-2.0-flash"
}
```

**Snapshot sizing**: The backend builds snapshots with a configurable token
budget (default: 4000 tokens). When the snapshot exceeds the budget, sections
are trimmed in priority order: `recentCoherenceIssues` (summarize further),
`artifactIndex` (only artifacts in agent's own workstream), `activeAgents`
(drop `pluginName` and `modelPreference`), `pendingDecisions` (only
same-workstream decisions). Note: `trustScore` is never included in
`AgentSummary` — trust data reaches the frontend via `TrustUpdateMessage`,
not the snapshot (see Trust score calibration section).
The `estimatedTokens` field lets adapters verify the snapshot fits within the
model's context budget alongside the system prompt and conversation history.

**Consistency model:**

- **Within a single agent's event processing**: read-after-write consistency.
  If agent A writes an artifact and immediately reads it back, it sees its own
  write.
- **Cross-agent**: eventual consistency. Agent B may not see agent A's write
  immediately. The next `getSnapshot()` call or `injectContext()` refresh
  brings agent B up to date.
- **Conflict resolution**: `ConflictError` on version mismatch. The caller
  must re-read, merge, and retry. The backend event processor handles this
  automatically for events; manual Knowledge Store calls from the UI should
  surface conflicts to the user.
- **Event log retention**: The `appendEvent()` / `getEvents()` methods operate
  on "hot" storage. Event log retention should be configurable (e.g. keep last
  30 days or 100k events per project). Older events are archived to cold
  storage for replay and audit. `getEvents()` only queries hot storage; a
  separate replay API loads archived events on demand for temporal navigation.
  Retention policy is a Phase 4 concern.

When an agent is spawned, it receives a `KnowledgeSnapshot` in its brief. When
it emits events, the backend updates the store. Other agents can be refreshed
with updated snapshots via `injectContext()`.

This is the "shared knowledge, not shared context" principle. Agents don't
share conversation threads -- they share structured state.

---

## Coherence Monitoring

The architecture diagram lists a "Coherence Monitor" in the Project Intelligence
Layer. This section defines how it detects inconsistencies across workstreams,
artifacts, and agent decisions.

### Detection model: three layers

Coherence monitoring uses a layered approach. Each layer is progressively more
expensive. Lower layers act as fast filters that gate access to higher layers.

```
Layer 0: Structural checks     — instant, deterministic, free       [Phase 0+]
Layer 1: Semantic similarity    — fast, embedding-based, cheap       [Phase 2+]
Layer 2: LLM-based deep review — slow, model-powered, expensive     [Phase 2+]
```

**Phase boundaries**: Layer 0 is always-on from Phase 0. Layers 1 and 2
require real embedding models and LLM calls respectively, so they are
Phase 2+ capabilities. In Phase 0, the `MockEmbeddingService` and
`MockCoherenceReviewService` (see Phase 0 MockPlugin section) allow testing
the Layer 1/2 *pipeline* with pre-computed data, but the interfaces are not
connected to real models until Phase 2. In Phase 1, coherence monitoring
operates in Layer 0 only (structural checks). The `CoherenceMonitorConfig`
fields for Layers 1/2 exist from Phase 0 but have no effect until real
service implementations are wired in.

#### Layer 0: Structural checks (always-on)

Deterministic, zero-cost checks that run synchronously on every `ArtifactEvent`
and `DecisionEvent` before they enter the event bus.

| Check | Trigger | Detection |
|---|---|---|
| **File conflict** | Two agents write to the same logical path within the same tick window | Exact match on backend-managed URI (`artifact://...`). Since Layer 0 runs after the adapter shim rewrites sandbox-local paths (see "Artifact extraction and sandbox teardown"), it compares stable backend URIs. For project-relative source file conflicts (e.g., two agents editing `src/api.ts`), the adapter must include the original project-relative path in `ArtifactEvent.provenance.sourcePath` so the monitor can compare pre-rewrite paths. |
| **Decision conflict on shared artifacts** | Two `OptionDecisionEvent`s reference overlapping `affectedArtifactIds` with incompatible recommended options | Set intersection on artifact IDs + option label diff. Note: only catches conflicts on *shared* artifacts — semantic contradictions affecting disjoint artifacts require Layer 1/2. |
| **Dependency violation** | Agent produces an artifact that depends on (`sourceArtifactIds`) an artifact from a workstream outside its `readableWorkstreams` | Provenance chain walk against brief scope |
| **Duplicate artifact** | Two artifacts with the same `contentHash` appear in different workstreams | Hash-table lookup on `ArtifactEvent.contentHash` |

Layer 0 fires immediately. When a check trips, the monitor emits a
`CoherenceEvent` with the appropriate `category` and `severity` based on the
check type (file conflicts are `high`, duplicates are `low`).

**Cost**: O(1) per event. Maintained via in-memory indexes (URI map, hash set,
artifact-to-workstream map) that the Knowledge Store updates on every write.

#### Layer 1: Semantic similarity (periodic)

Embedding-based comparison that runs on a configurable schedule (default: every
10 ticks, or immediately when Layer 0 flags a potential issue in a related
workstream).

**Mechanism**:

1. **Artifact embedding**: When a text-based artifact is created or updated,
   the backend computes an embedding vector using a cheap embedding model
   (e.g., `text-embedding-3-small` at ~$0.02/1M tokens, or a local model like
   `nomic-embed-text` for zero marginal cost). Embeddings are stored alongside
   the artifact in the Knowledge Store. **Important**: embedding computation
   depends on artifact content being available in the backend. Since the eager
   upload policy (see "Artifact extraction and sandbox teardown") uploads
   content on every `ArtifactEvent`, the content is available by the time the
   event reaches the coherence monitor. If the upload fails or is still
   in-flight, the embedding is deferred until the next Layer 1 scan cycle.

   **Non-text artifact handling**: Layer 1 only applies to artifacts with
   embeddable text content. The embedding eligibility rule:

   | `ArtifactKind` | `mimeType` pattern | Action |
   |---|---|---|
   | `code`, `config`, `test` | `text/*` | Embed full content |
   | `document` | `text/*`, `application/json` | Embed full content |
   | `document` | `application/pdf` | Embed extracted text (if available via `uri`) |
   | `design` | `image/*` | **Skip Layer 1** — rely on Layer 0 (structural) and Layer 2 (LLM with vision) |
   | any | binary or unknown | **Skip Layer 1** — mark as `embeddingStatus: 'skipped'` |

   Artifacts skipped by Layer 1 are still covered by Layer 0 structural
   checks (file conflicts, hash dedup) and can be explicitly promoted to
   Layer 2 review by a human from the Map workspace. Layer 2's LLM call
   can handle multi-modal content if the configured model supports vision.

2. **Cross-workstream scan**: On each scan cycle, the monitor computes cosine
   similarity between all artifact pairs across different workstreams. Pairs
   above a configurable threshold (default: 0.85) are flagged as potential
   coherence issues.

3. **Decision-artifact alignment**: The monitor also checks whether recent
   `DecisionEvent` outcomes are consistent with existing artifact content by
   comparing the decision description embedding against affected artifact
   embeddings. Low similarity (< 0.3) between a decision and its
   `affectedArtifactIds` suggests the decision may be stale or misdirected.

**Output**: Candidate coherence issues with a `similarityScore` annotation.
These are not yet emitted as `CoherenceEvent`s — they are queued for Layer 2
confirmation if `similarityScore > 0.85`, or auto-emitted as `severity: 'low'`
advisory issues if `0.70 < similarityScore <= 0.85`.

**Cost**: Embedding computation is cheap (~0.001s per artifact). The
cross-workstream scan is O(n*m) where n and m are artifact counts per
workstream, but practical project sizes (< 200 artifacts) keep this under 50ms.

**Scalability guard (scope: Phase 2+)**: The naive pairwise scan is adequate
for Phase 0-2 project sizes. For larger artifact sets (200+ artifacts per
workstream), two mitigations apply:

- **Scan window**: Only compare artifacts modified since the last scan cycle
  against the full set, reducing the hot path from O(n*m) to O(delta*m) where
  delta is the number of changed artifacts per cycle. The
  `layer1ScanIntervalTicks` already bounds scan frequency; the window bounds
  per-scan work.
- **ANN index (Phase 3+)**: Replace brute-force cosine similarity with an
  approximate nearest neighbor index (e.g., HNSW via `hnswlib-node` or a
  vector database). This drops per-scan lookup to O(delta * log(n)) at the
  cost of index maintenance on artifact create/update. The
  `EmbeddingService` interface already abstracts the similarity computation,
  so the switch is internal to the implementation.

Until Phase 3, the `CoherenceMonitorConfig` enforces a hard limit:
`layer1MaxArtifactsPerScan: number` (default: 500). If the artifact count
exceeds this, the scan skips with a `warning`-severity log and the Briefing
workspace shows a "coherence scan skipped — artifact limit exceeded" notice.
This prevents silent performance degradation while making the scope limit
visible to the human operator.

```typescript
interface CoherenceCandidate {
  artifactIdA: string
  artifactIdB: string
  workstreamA: string
  workstreamB: string
  similarityScore: number           // 0-1, cosine similarity
  candidateCategory: CoherenceCategory
  detectedAt: string                // ISO 8601
  promotedToLayer2: boolean         // true if queued for LLM review
}
```

#### Layer 2: LLM-based deep review (on-demand)

The most expensive layer. Triggered only when Layer 0 or Layer 1 flags a
candidate that exceeds the promotion threshold, or when a human requests a
coherence audit from the Map workspace.

**Mechanism**:

1. **Context assembly**: The monitor gathers the full content of the flagged
   artifacts (not just embeddings), recent decision history affecting those
   artifacts, and the relevant workstream briefs.

2. **Structured LLM call**: A dedicated coherence-review prompt asks a model
   (default: the cheapest capable model, e.g. `sonnet` or `gpt-4o-mini`) to:
   - Confirm or dismiss the candidate issue
   - Classify the `CoherenceCategory` (`contradiction`, `duplication`, `gap`,
     `dependency_violation`)
   - Assess `severity`
   - Recommend a resolution approach
   - Identify which agents should be notified

3. **Result**: If confirmed, a `CoherenceEvent` is emitted with the LLM's
   classification. If dismissed, the candidate is marked as false positive
   (used to tune Layer 1 thresholds over time).

**Cost model**: Each Layer 2 review consumes approximately 2,000-5,000 input
tokens (artifact content + context) and 200-500 output tokens. At
$3/1M input tokens (sonnet-class), each review costs ~$0.01-0.02. The system
caps Layer 2 reviews at a configurable rate (default: 10 per hour per project)
to prevent cost runaway.

```typescript
interface CoherenceReviewRequest {
  candidates: CoherenceCandidate[]   // batch up to 5 candidates per review
  artifactContents: Map<string, string>  // full content for flagged artifacts
  relevantDecisions: DecisionLogEntry[]
  workstreamBriefs: { id: string; name: string; goals: string[] }[]
}

interface CoherenceReviewResult {
  candidateId: string                // maps back to CoherenceCandidate
  confirmed: boolean
  category?: CoherenceCategory
  severity?: Severity
  explanation: string
  suggestedResolution?: string
  notifyAgentIds: string[]
}
```

### False positive feedback loop (Phase 3 enhancement)

**For Phases 0-2**: Use static, configurable thresholds. The
`layer1PromotionThreshold` (default 0.85) and `layer1AdvisoryThreshold`
(default 0.70) are set per-project and tuned manually based on observed
false positive rates. This is simpler and more predictable while the system
lacks real-world data.

**For Phase 3+**: Layer 2 results feed back into Layer 1 tuning automatically.
When the LLM dismisses a candidate, the system records the artifact pair and
similarity score as a false positive. Over time, the per-project similarity
threshold auto-adjusts:

- If > 50% of Layer 2 reviews are false positives in a 24-hour window, the
  promotion threshold increases by 0.02 (fewer candidates promoted).
- If < 10% are false positives, the threshold decreases by 0.01 (more
  candidates promoted, catching subtler issues).
- Threshold is clamped to [0.75, 0.95] to prevent extreme drift.

Auto-adjustment requires sufficient data volume to be meaningful (at least
20 Layer 2 reviews in the feedback window). Below that threshold, the system
stays on static thresholds.

### Coherence score computation

The project-level coherence score (displayed in the Briefing workspace) is
computed from the current state of all coherence issues:

```
coherenceScore = 100 - sum(issuePenalties)

where issuePenalty =
  - critical: 15 points
  - high: 8 points
  - medium: 3 points
  - low: 1 point

Clamped to [0, 100]. Only open/investigating issues count (resolved = 0).
```

The `coherenceTrend` is derived from the score delta over the last 10 ticks.

### Configuration

```typescript
// Phase 0-2: Core coherence configuration
interface CoherenceMonitorConfig {
  // Layer 0 (always-on, no config needed — runs on every event)

  // Layer 1 (Phase 0: uses MockEmbeddingService; Phase 2+: real embeddings)
  layer1ScanIntervalTicks: number    // default: 10
  layer1PromotionThreshold: number   // default: 0.85 (promote to L2)
  layer1AdvisoryThreshold: number    // default: 0.70 (auto-emit low-severity)
  layer1MaxArtifactsPerScan: number  // default: 500 (skip scan with warning if exceeded)
  embeddingModel: string             // default: "text-embedding-3-small"

  // Layer 2 (Phase 0: uses MockCoherenceReviewService; Phase 2+: real LLM)
  layer2MaxReviewsPerHour: number    // default: 10
  layer2Model: string                // default: "sonnet" (cheapest capable)
  enableLayer2: boolean              // default: true (false = advisory-only mode)

  // Phase 3+ auto-tuning (ignored in Phase 0-2; static thresholds used instead)
  feedbackLoop?: CoherenceFeedbackLoopConfig
}

// Phase 3+: Automatic threshold tuning from Layer 2 false positive feedback.
// See "False positive feedback loop" section above.
interface CoherenceFeedbackLoopConfig {
  enabled: boolean                   // default: false (Phase 0-2: always false)
  falsePositiveWindowHours: number   // default: 24
  thresholdAdjustStepUp: number      // default: 0.02 (increase on high FP rate)
  thresholdAdjustStepDown: number    // default: 0.01 (decrease on low FP rate)
  thresholdClampMin: number          // default: 0.75
  thresholdClampMax: number          // default: 0.95
  minReviewsForAdjustment: number    // default: 20 (minimum L2 reviews before adjusting)
}
```

When `enableLayer2` is false, the system operates in "advisory-only" mode:
Layer 1 candidates above the promotion threshold are emitted directly as
`CoherenceEvent`s with `severity: 'medium'` and a note that they are
unconfirmed. This is useful for cost-sensitive projects or during Phase 0/1
before the LLM review pipeline is built.

---

## Mixed-Provider Example

A project might use different providers for different agents:

```
Project: "Real-Time Notification System" (David's scenario)

  Backend Agent     → Claude (opus)    — deep code reasoning
  Frontend Agent    → OpenAI (gpt-4o)  — fast UI iteration
  Code Review Agent → Claude (sonnet)  — cost-effective review
  Testing Agent     → Gemini (flash)   — fast test generation
  Database Agent    → Claude (opus)    — careful schema work
```

Each agent runs through its own adapter but emits the same `AgentEvent` types.
The backend doesn't care which SDK is behind each agent. Trust scores, decision
routing, and coherence monitoring work identically regardless of provider.

**Provider visibility in the UI**: Events carry `agentId`, not provider info.
The frontend joins against the agent registry (`AgentHandle.pluginName` and
`AgentBrief.modelPreference`) to display provider/model metadata alongside
events when relevant. This is intentional — events are provider-agnostic by
design, and the registry is the single source of truth for agent metadata.
The `StateSyncMessage` (sent on WebSocket connect) includes `activeAgents`
with enough metadata for the frontend to build this mapping without extra
API calls. Provider info is a UI annotation, not an event property.

This is where the plugin system pays for itself — you pick the best model for
each role without changing any backend or frontend code.

---

## Implementation Phases

### Phase 0: Mock adapter and event pipeline validation

Before wiring real SDKs, build a `MockPlugin` adapter that exercises the entire
event pipeline using scripted scenarios. This validates the backend's event bus,
workspace routing, decision queue, and frontend rendering without incurring any
API costs. The prototype's 5 scenarios provide the input data.

**MockPlugin implements `AgentPlugin`** with configurable capabilities. By
default all capabilities are `true` (it can simulate any lifecycle operation),
but MockPlugin must also run in **mixed capability modes** that mirror real
SDK limitations. This is critical: if Phase 0 only tests the all-true happy
path, degradation behavior (pause-to-abort, queued brief updates, partial
kill) is never exercised before Phase 1 when real SDKs hit those paths.

MockPlugin uses `InProcessTransport` — no sandbox, no network, direct method
calls. This is intentional: Phase 0 validates the event pipeline and
Intelligence Layer, not the RPC boundary. The transport abstraction (see
"Transport abstraction" section) means the same `AgentPlugin` interface
works whether the transport is in-process, localhost HTTP, or container.

```typescript
interface MockPlugin extends AgentPlugin {
  readonly name: 'mock'
  readonly capabilities: PluginCapabilities  // configurable per scenario
}

// Predefined capability profiles that mirror real SDK limitations.
// Each scenario should run against at least the 'all' and one restricted profile.
const MockCapabilityProfiles = {
  // All capabilities enabled — validates happy path
  all: {
    supportsPause: true,
    supportsResume: true,
    supportsKill: true,
    supportsHotBriefUpdate: true,
  },
  // Mirrors Claude Agent SDK: no pause, no hot brief update
  claude: {
    supportsPause: false,
    supportsResume: true,
    supportsKill: true,
    supportsHotBriefUpdate: false,
  },
  // Mirrors OpenAI Agents SDK: no hot brief update
  openai: {
    supportsPause: true,
    supportsResume: true,
    supportsKill: true,       // partial in practice, true here for simplicity
    supportsHotBriefUpdate: false,
  },
  // Minimal capabilities — worst-case degradation testing
  minimal: {
    supportsPause: false,
    supportsResume: false,
    supportsKill: true,
    supportsHotBriefUpdate: false,
  },
} as const satisfies Record<string, PluginCapabilities>

// A scripted sequence of events with timing and optional HITL interruptions
interface MockScenarioScript {
  scenarioId: string                   // maps to prototype scenario: "maya", "david", etc.
  agents: MockAgentScript[]
}

interface MockAgentScript {
  agentId: string
  role: string
  events: MockEventEntry[]
}

interface MockEventEntry {
  delayMs: number                      // delay before emitting (simulates real-time pacing)
  event: AgentEvent                    // the event to emit
  hitlBlock?: {                        // if present, agent blocks here until resolved
    decisionId: string
    autoResolveAfterMs?: number        // optional: auto-resolve after timeout (for testing)
    autoResolution?: Resolution        // what resolution to apply if auto-resolving
  }
  failureInjection?: MockFailure      // optional: simulate error conditions
}

type MockFailure =
  | { type: 'error'; error: PluginError }           // adapter throws
  | { type: 'timeout'; durationMs: number }         // event delayed beyond normal
  | { type: 'malformed_event'; raw: unknown }       // invalid event data (tests validation)
  | { type: 'crash'; restartAfterMs: number }       // agent "crashes" and restarts
  | { type: 'guardrail_trip'; guardrailName: string; message: string }
```

**Scenario-to-script mapping** (derived from the 5 prototype scenarios):

| Scenario | Script Focus | Key Events Exercised |
|---|---|---|
| **Maya** (solo creator, ecosystem) | Multi-agent content pipeline, high-trust auto-approve | status, artifact, decision (option), completion |
| **David** (team lead, orchestrator) | Cross-workstream coordination, dependency conflicts | decision (tool_approval), coherence, artifact, delegation |
| **Priya** (portfolio PM, adaptive) | Multiple concurrent agents, trust-driven escalation | tool_call, decision, progress, trust updates |
| **Rosa** (research director, Map-focused) | Knowledge graph construction, artifact provenance | artifact (heavy), coherence, status |
| **Sam** (consultant, Brief Editor-focused) | Brief iteration, agent reconfiguration | lifecycle, status, completion |

**HITL simulation**: When a `MockEventEntry` has `hitlBlock`, the mock adapter
pauses its event sequence at that point and emits a `DecisionEvent`. The
backend surfaces it to the Queue workspace normally. Resolution comes from
either (a) human interaction via the UI (manual testing), or (b) the
`autoResolveAfterMs` timer (automated testing). This validates the full
decision lifecycle: emit -> queue -> render -> resolve -> resume.

**Failure injection**: Each `MockEventEntry` can optionally inject a failure
to test resilience. The failure types map to real failure modes:

- `error`: Tests error-to-action mapping (retry, kill+respawn, surface to UI)
- `timeout`: Tests decision timeout policy (`auto_recommend` in Phase 0; `escalate` and `cancel` strategies are Phase 3)
- `malformed_event`: Tests the event validation pipeline (quarantine, repair)
- `crash`: Tests agent restart and session recovery
- `guardrail_trip`: Tests guardrail event routing and UI alerts

**Degradation testing with capability profiles**: Each of the 5 scenarios
must run against at least two `MockCapabilityProfiles` — `all` (happy path)
and one restricted profile. This validates that the backend correctly handles
the degradation semantics described in "Capability-gated lifecycle semantics"
before real SDKs are connected in Phase 1.

| Scenario | Required Profiles | Key Degradation Paths Tested |
|---|---|---|
| **David** (orchestrator) | `all`, `claude` | Brake fires `pause()` -> degrades to abort-and-save when `supportsPause: false`; brief update queued in `pendingBriefChanges` when `supportsHotBriefUpdate: false` |
| **Maya** (ecosystem) | `all`, `openai` | Mode transition from ecosystem -> orchestrator queues brief update; agent continues under old escalation rules until restart |
| **Priya** (adaptive) | `all`, `minimal` | Resume after decision degrades to fresh execution turn when `supportsResume: false`; agent loses exact execution point but retains conversation history |
| **Sam** (brief editor) | `all`, `claude` | Brief edit triggers `updateBrief()` -> queued, not applied until agent restart; Controls UI shows "brief update pending" badge |

The integration test suite runs each scenario-profile pair and asserts:
1. The backend detects the unsupported capability and applies the correct
   degradation path (not an error).
2. The degradation is transparent to the frontend — the UI shows the correct
   agent state (e.g., "paused" vs. "killed" after brake).
3. `LifecycleEvent` emissions reflect the actual degraded action (e.g.,
   `action: 'killed'` when pause degrades to abort-and-save).

**Mock coherence scenarios**: The MockPlugin cannot compute real embeddings or
make LLM calls, so coherence testing uses pre-computed data injected via
dependency inversion:

```typescript
interface MockCoherenceScenario {
  // Pre-computed Layer 1 results (skip embedding computation)
  artifactSimilarities: {
    artifactIdA: string
    artifactIdB: string
    similarityScore: number           // pre-computed, injected directly
  }[]

  // Scripted Layer 2 results (skip LLM call)
  layer2Results: {
    candidateId: string
    result: CoherenceReviewResult     // pre-scripted LLM response
  }[]

  // Layer 0 triggers (structural conflicts baked into event sequences)
  // These fire naturally from the event data -- no mocking needed
}
```

**Injection mechanism**: The Coherence Monitor depends on two pluggable
services: an `EmbeddingService` (computes similarity scores) and a
`CoherenceReviewService` (runs LLM deep reviews). In production, these call
real models. In Phase 0, mock implementations are injected:

```typescript
// Pluggable interfaces used by the Coherence Monitor
interface EmbeddingService {
  computeSimilarity(artifactIdA: string, artifactIdB: string): Promise<number>
}

interface CoherenceReviewService {
  review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]>
}

// Mock implementations for Phase 0
class MockEmbeddingService implements EmbeddingService {
  constructor(private similarities: MockCoherenceScenario['artifactSimilarities']) {}

  async computeSimilarity(artifactIdA: string, artifactIdB: string): Promise<number> {
    const match = this.similarities.find(
      s => (s.artifactIdA === artifactIdA && s.artifactIdB === artifactIdB)
        || (s.artifactIdA === artifactIdB && s.artifactIdB === artifactIdA)
    )
    return match?.similarityScore ?? 0  // no match = no similarity
  }
}

class MockCoherenceReviewService implements CoherenceReviewService {
  constructor(private results: MockCoherenceScenario['layer2Results']) {}

  async review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]> {
    return request.candidates.map(c => {
      const scripted = this.results.find(
        r => r.candidateId === c.artifactIdA + ':' + c.artifactIdB
      )
      return scripted?.result ?? {
        candidateId: c.artifactIdA + ':' + c.artifactIdB,
        confirmed: false,
        explanation: 'No scripted result (mock)',
      }
    })
  }
}
```

The Coherence Monitor constructor accepts these interfaces. The backend wires
in mock or real implementations based on the active transport phase. This
means Layer 0 runs identically in all phases (it's deterministic), Layer 1
and Layer 2 are fully testable in Phase 0 with pre-computed data, and the
same Coherence Monitor code runs unchanged when real models are connected.

Each of the 5 scenarios includes at least one coherence path:
- **David**: dependency conflict between frontend/backend workstreams (Layer 0
  file conflict + Layer 1 high similarity on API contract artifacts)
- **Maya**: content duplication across blog posts (Layer 1 advisory)
- **Priya**: cross-project contradiction detected by Layer 2 review

**Phase 0 deliverables**:
- `MockPlugin` adapter implementing `AgentPlugin` interface (using `InProcessTransport` with `eventSink`)
- Minimal trust engine: delta application from the trust update rules table, [10,100] clamping, decay toward baseline (50), diminishing returns at extremes, `TrustCalibrationConfig` with default values, `calibrationMode` logging. This is the runtime trust engine -- it applies deltas, clamps scores, and decays inactive agents. Advanced features (calibration profiles, simulation framework, trajectory visualization) are Phase 3.
- Minimal decision timeout policy: `auto_recommend` on expiry with configurable `timeoutTicks`
- In-memory `KnowledgeStore` implementation (same interface as Phase 2 persistent store, lost on restart)
- Script files for all 5 scenarios (JSON, loadable at runtime)
- At least one failure-injection variant per scenario
- Mock coherence scenarios with pre-computed similarity scores and scripted
  Layer 2 results for testing the coherence pipeline without real
  embeddings or LLM calls
- Integration test suite that runs each scenario through the event pipeline
  and asserts correct workspace routing, decision queue behavior,
  coherence monitoring, and WebSocket message delivery
- Manual testing mode: scripts run in real-time with configurable speed
  multiplier (1x = realistic pacing, 10x = fast demo, 0x = step-through)

**Phase 0 acceptance criteria** — all must pass before starting Phase 1:

- [ ] `MockPlugin` implements `AgentPlugin` interface using `InProcessTransport` with `eventSink`
- [ ] At least one scenario (recommend: David) runs end-to-end: mock events flow through event bus -> classifier -> WebSocket Hub -> frontend renders in correct workspaces
- [ ] `DecisionEvent` appears in Queue workspace, auto-resolves via `MockEventEntry.hitlBlock.autoResolveAfterMs` timer, mock agent resumes emitting subsequent events
- [ ] Minimal trust engine applies correct deltas from decision resolution (approve = +1/+2, reject = -2, etc. per trust update rules table), clamps to [10,100], and applies diminishing returns at extremes (>90, <20)
- [ ] Layer 0 coherence monitor detects file conflict from mock scenario event data (two agents writing same URI)
- [ ] Emergency brake (`AgentRegistry.killAll()`) kills mock agent; orphaned decisions enter triage in Queue with "agent killed" badge
- [ ] In-memory `KnowledgeStore` stores artifacts from `ArtifactEvent`, serves `KnowledgeSnapshot` via `getSnapshot()`
- [ ] `EventEnvelope` wrapping works: adapters generate `sourceEventId`, `sourceSequence`, `sourceOccurredAt`, `runId`; backend adds `ingestedAt`; duplicate `sourceEventId` is deduplicated
- [ ] At least one failure injection variant runs: `malformed_event` triggers quarantine, `error` triggers error-to-action mapping
- [ ] WebSocket `StateSyncMessage` sent on frontend connect with current snapshot, active agents, trust scores, control mode
- [ ] `TrustCalibrationConfig` loads with default values; `calibrationMode: true` logs proposed deltas without mutating scores
- [ ] `providerConfig` validation rejects keys that shadow first-class `AgentBrief` fields (e.g., `allowedTools` in `providerConfig` is rejected); `experimental` sub-namespace keys pass through
- [ ] `MockCoherenceScenario` pre-computed similarities flow through `MockEmbeddingService` -> Layer 1 scan -> promotion to Layer 2 -> `MockCoherenceReviewService` returns scripted result -> `CoherenceEvent` emitted
- [ ] `OrphanedDecisionPolicy` with `default: 'triage'` keeps decisions in Queue after mock agent kill; decisions show "agent killed" badge and elevated visual priority
- [ ] `TickService` runs in `wall_clock` mode (default 1 tick/sec) and `manual` mode (for tests); trust decay, decision timeouts, and context injection timing all consume ticks via `onTick` subscriptions
- [ ] MockPlugin runs at least one scenario (recommend: David) with `MockCapabilityProfiles.claude` (supportsPause=false, supportsHotBriefUpdate=false); brake degrades pause to abort-and-save; brief update queues in `pendingBriefChanges`; `LifecycleEvent` reflects degraded action
- [ ] Trust decay toward baseline fires on inactive agents: agent above 50 loses 1 point per `trustDecayTicks` inactive ticks; agent below 50 gains 1 point (verified via MockPlugin scenario with `TickService` in manual mode)

### Phase 1: Single-provider vertical slice (`LocalHttpTransport`)
- Pick one SDK (recommend: OpenAI Agents SDK for strongest HITL story)
- Implement adapter shim as a local child process exposing HTTP+WS on localhost
- The adapter shim uses the **same wire protocol** as Phase 2+ containers
  (JSON over HTTP for commands, JSON over WebSocket for events). This means
  Phase 1 validates the real RPC boundary, not a simplified stand-in.
- Build Agent Gateway in the backend: `LocalHttpTransport` connects to the
  adapter shim on `http://localhost:<port>`. The gateway implements `AgentPlugin`
  by translating method calls into HTTP requests.
- Build event validation pipeline (Zod schema validation, quarantine for malformed events)
- Wire one agent through to the Queue workspace (spawn -> decision -> resolve -> resume)
- Implement `EventEnvelope` wrapping with sequence numbers and dedup
- Define frontend WebSocket message protocol and deliver events to UI
- Implement eager artifact upload: adapter shim uploads via `POST /api/artifacts`
  on every `ArtifactEvent` (validates extraction flow without containers)
- ContextInjection: disabled (agent uses spawn-time snapshot only; `POST /inject-context`
  endpoint exists but backend never calls it — validates plumbing for Phase 2)
- In-memory `KnowledgeStore` implementation (artifacts, decisions, events — lost on restart)
- Frontend REST API: `/api/agents/spawn`, `/api/agents/:id/kill`, `/api/decisions`, `/api/decisions/:id/resolve`, `/api/agents`
- No checkpointing — agent crash = full restart. Auth: long-lived token or skip (localhost).
- Basic event bus backpressure: bounded per-agent ingestion queue (max 500
  events). When the queue is full, the event bus drops the oldest low-priority
  events (`ToolCallEvent`, `ProgressEvent`, `StatusEvent`) first, preserving
  high-priority events (`DecisionEvent`, `ArtifactEvent`, `ErrorEvent`,
  `CompletionEvent`). An `ErrorEvent` with `severity: 'warning'`
  ("backpressure: N events dropped for agent X") is emitted to the frontend
  when drops occur. `ErrorEvent` is high-priority and therefore not itself
  subject to backpressure dropping. This is sufficient for Phase 1 where a
  single real agent can produce bursts of `ToolCallEvent` during rapid
  tool-call loops.
- Validate end-to-end: gateway -> HTTP -> adapter shim -> SDK -> events -> WS -> bus -> classifier -> UI

**Phase 1 acceptance criteria** — all must pass before starting Phase 2:

- [ ] OpenAI adapter shim starts as a child process via `child_process.spawn()` on an allocated port from the 9100-9199 pool
- [ ] Shim responds to `GET /health` within the 30s startup timeout and completes the ready handshake (Orchestrator polls at 500ms interval)
- [ ] `POST /spawn` with `AgentBrief` creates a real OpenAI agent; `StatusEvent` and `ToolCallEvent` stream over the sandbox WebSocket to the backend event bus and onward to the frontend
- [ ] `DecisionEvent` (from `needs_approval` tool interruption) renders in Queue workspace; human resolves via `POST /api/decisions/:id/resolve`; adapter resumes agent via `RunState.approve()` / `RunState.reject()`
- [ ] `ArtifactEvent` triggers eager upload from adapter shim to backend via `POST /api/artifacts`; adapter rewrites `uri` to `backendUri` from `ArtifactUploadResult` before forwarding over WebSocket; event bus only sees stable `artifact://` URIs
- [ ] Emergency brake (`POST /api/brake`) stops real agent via `POST /kill` on the adapter shim; orphaned decisions enter triage
- [ ] Frontend REST endpoints functional: `GET /api/agents`, `POST /api/agents/spawn`, `POST /api/agents/:id/kill`, `GET /api/decisions`, `POST /api/decisions/:id/resolve`
- [ ] Trust score updates after decision resolution are visible in the frontend via `TrustUpdateMessage` over WebSocket
- [ ] Adapter shim crash (kill child process) is detected via `child_process` exit event + WebSocket drop; backend marks agent as crashed and emits `ErrorEvent`
- [ ] Event validation pipeline quarantines malformed events from the adapter and logs them; well-formed events pass through with `EventEnvelope` wrapping
- [ ] `StateSyncMessage` on frontend WebSocket connect includes the real agent in `activeAgents`
- [ ] Trust engine applies deltas from real decision resolutions; `TrustUpdateMessage` reflects score changes in frontend within 2 seconds of decision resolution (manual observation; formal p95 latency tracking is a Phase 3 observability deliverable)
- [ ] Layer 0 coherence detects file conflict when real agent produces `ArtifactEvent` with `provenance.sourcePath` matching an existing artifact's path
- [ ] `providerConfig` passthrough works: adapter receives opaque config from `AgentBrief.providerConfig` and applies it to SDK initialization (e.g., `temperature`, `maxTokens`)
- [ ] `OrphanedDecisionPolicy` fires after grace period on explicit agent kill; tool approval decisions are handled per policy (`triage` by default)
- [ ] Event bus backpressure: bounded per-agent queue (500 events) drops low-priority events (`ToolCallEvent`, `ProgressEvent`, `StatusEvent`) first when full; high-priority events (`DecisionEvent`, `ArtifactEvent`, `ErrorEvent`, `CompletionEvent`) are preserved; frontend receives `ErrorEvent` (severity: `'warning'`) notification when drops occur

**Transport progression summary**:
| Phase | Transport | What it validates |
|---|---|---|
| Phase 0 | `InProcessTransport` | Event pipeline, Intelligence Layer, workspace routing, decision queue |
| Phase 1 | `LocalHttpTransport` | Wire protocol, RPC boundary, artifact extraction, adapter shim pattern |
| Phase 2+ | `ContainerTransport` | Sandbox isolation, MCP provisioning, workspace resources, health monitoring |

### Phase 2: Knowledge Store + second provider + containerized sandboxes (`ContainerTransport`)
- Build the Knowledge Store with SQLite/Postgres and optimistic concurrency (version fields)
- Define `KnowledgeSnapshot` sizing and token budget enforcement
- Build Sandbox Orchestrator with Docker container provisioning and `WorkspaceRequirements`
- Add a second SDK adapter (recommend: Claude Agent SDK for code-heavy tasks) in its own container
- Implement agent registry for tracking multi-agent fleet state with `SandboxInfo`
- Configure sandbox-local MCP servers (filesystem, git) with per-agent scoping
- Implement persistent volumes for artifact recovery on unclean teardown
- Enable ContextInjection: periodic + reactive triggers for cross-workstream updates
- Implement checkpoint-on-decision: adapter shim auto-serializes state on HITL pause
- Implement `SandboxBootstrap` token renewal (`POST /api/token/renew`)
- Run two agents from different providers on the same project
- Validate cross-agent coherence monitoring and snapshot injection

### Phase 3: Full control system
- Advanced trust engine features: `TrustCalibrationProfile` presets (conservative/balanced/permissive), per-profile delta multipliers, simulation framework for testing calibration changes before applying, trajectory visualization in Briefing workspace. *(Note: The minimal trust engine — delta application, [10,100] clamping, decay toward baseline, diminishing returns, `TrustCalibrationConfig`, and `calibrationMode` — is a Phase 0 deliverable. Phase 3 adds the tuning and simulation layer on top.)*
- Build escalation policy engine with typed `EscalationPredicate` evaluation
- Build control mode switching (orchestrator/adaptive/ecosystem)
- Add emergency brake with scoped targeting (all/agent/workstream) and pause/kill behavior
- Advanced decision timeout policy: `escalate`, `cancel`, `extend`, and `maxExtensions` strategies (on top of the Phase 0 minimal `auto_recommend` + `timeoutTicks` policy)
- Wire up Briefing narrative generation from event history
- Add sandbox health monitoring (heartbeats, resource usage, stale detection)
- Implement periodic checkpointing (POST /pause + POST /resume on schedule)
- Implement crash recovery policy with auto-restart for high-trust agents
- Add event replay (`POST /replay`) for sequence gap recovery

**Backend restart behavior (Phases 1-3)**: A backend restart loses all
in-memory `AgentHandle` references and `SandboxInfo` mappings. Running
sandboxes continue to exist but the backend can't reach them. In Phase 1
(`LocalHttpTransport`), the child process is also killed on backend exit —
all agent state is lost. In Phase 2+ (`ContainerTransport`), containers
survive backend restart, but the backend must re-discover them. For Phases
1-3, this is acceptable: restart = kill all agents. Phase 4 adds proper
reconnection.

### Phase 4: Production hardening
- Sandbox reconnection on backend restart: Orchestrator queries container runtime
  for running sandboxes, re-establishes event stream connections, rebuilds
  `SandboxInfo` registry from container metadata
- Secret management: Sandbox Orchestrator resolves secrets at provision time
- Audit logging (all decisions, trust changes, brake actions, resolution history)
- Temporal navigation (replay from event log via `getEvents()`)
- Advanced event bus backpressure (per-agent rate throttling, batching low-priority events into summaries, adaptive queue sizing). Basic bounded-queue backpressure is Phase 1.
- Cloud sandbox providers (Cloud Run, Fly.io, etc.) as alternatives to local Docker
- Portfolio view (multiple projects)

---

## Open Questions

1. ~~**Backend language and cross-language deployment**~~ **RESOLVED — SDK host
   vs. job dispatcher.** The real question was never "TypeScript vs. Python?"
   — it was "does the backend host SDK code or dispatch jobs?" The answer:
   **job dispatcher**. Agents need real computer workspaces (browsers,
   terminals, filesystems) which cannot run inside the backend process. Each
   agent runs in its own sandbox with the native SDK. The backend is TypeScript
   (matches frontend, owns project intelligence). Sandboxes run whatever
   language their SDK prefers. The plugin interface is an RPC boundary — JSON
   over HTTP for commands, JSON over WebSocket for events. See the Architecture
   section for details.

2. ~~**Event bus implementation**~~ **RESOLVED — phased approach.** Phase 0-2:
   in-process pub/sub (TypeScript `EventEmitter` or similar). The event bus is
   an internal interface with a `subscribe(filter, handler)` / `publish(envelope)`
   contract. Phase 3+: if multi-tenant or horizontal scaling is needed, swap
   the in-process implementation for Redis Streams or NATS behind the same
   interface. The event bus contract (typed `EventEnvelope` in, workspace-routed
   messages out) stays the same. Backpressure handling (see OQ #7) is
   implemented at the interface level so it works with either backend.

3. ~~**Knowledge store backend**~~ **RESOLVED — in-memory first, then SQLite,
   then Postgres.** Phase 0-1: In-memory `KnowledgeStore` implementation. All
   state lives in backend process memory — fast, zero setup, lost on restart.
   Sufficient for development and testing with MockPlugin and a single real
   agent. Phase 2: SQLite via `better-sqlite3` (synchronous, embedded, zero
   config) for persistence across restarts. Phase 3+: if concurrent writes from
   multiple sandbox event streams cause SQLite contention, migrate to Postgres
   with JSON columns for flexible artifact/decision storage. The `KnowledgeStore`
   interface (defined above) is backend-internal and implementation-agnostic.
   The optimistic concurrency design (version fields on every entity) works
   identically with all backends. Migration path: implement
   `PostgresKnowledgeStore` behind the same interface, run data migration
   script, swap at startup config.

4. ~~**MCP server sharing**~~ **RESOLVED — sandbox-local MCP.** With the
   sandbox architecture, each agent gets its own MCP server instances running
   inside its sandbox. No sharing, no contention, no state leakage. The
   Sandbox Orchestrator configures MCP servers per agent at provision time
   based on `AgentBrief.mcpServers` and `allowedTools`. Stdio transport
   works fine (one client per process, one process per sandbox). The remaining
   question is how to provide MCP servers that need backend-side resources
   (e.g., a shared database or API gateway) — these run as network-accessible
   MCP servers on the backend, connected from the sandbox via SSE/HTTP
   transport and authenticated with the sandbox's `backendToken` (see
   `SandboxBootstrap`). This is a Phase 2+ concern — Phase 1 uses
   sandbox-local MCP servers only.

5. ~~**Context window management**~~ **RESOLVED — three-layer budget system.**
   Addressed by: `KnowledgeSnapshot` token budgeting (default 4000 tokens with
   priority trimming), `sessionPolicy.contextBudgetTokens` for per-agent limits,
   and `ContextInjection.estimatedTokens` for mid-session refresh sizing.
   On the remaining sub-questions: (a) Model-aware budgets: yes, the
   `sessionPolicy.contextBudgetTokens` default should scale with the model's
   context window. The adapter knows its model's capacity and can set a
   sensible default (e.g., 10% of context window). This is adapter-internal —
   no plugin interface change needed. (b) Role-based snapshot format: no.
   The snapshot structure stays uniform; role-based emphasis is achieved via
   the existing priority trimming (trim sections the agent's role is less
   likely to need). Adding role-specific snapshot shapes would complicate
   the Knowledge Store interface for marginal benefit.

6. **Cost management**: Different providers have different pricing. The
   control mode should factor in cost -- Ecosystem mode with opus on every
   agent gets expensive fast. Trust-based model selection (high trust =
   cheaper model, low trust = smarter model) could help.

7. ~~**Event bus backpressure**~~ **PARTIALLY RESOLVED — bounded queue in Phase 1.**
   Phase 1 implements a bounded per-agent ingestion queue (500 events) with
   priority-aware dropping: low-priority events (`ToolCallEvent`,
   `ProgressEvent`, `StatusEvent`) are dropped first, preserving high-priority
   events (`DecisionEvent`, `ArtifactEvent`, `ErrorEvent`, `CompletionEvent`).
   A notification `ErrorEvent` (severity: `'warning'`) is emitted when drops
   occur (high-priority, so not itself subject to dropping). Phase 4 adds
   advanced strategies: per-agent rate throttling, batching low-priority events
   into summaries, and adaptive queue sizing.

8. ~~**In-flight decisions on agent kill**~~ **RESOLVED — OrphanedDecisionPolicy.**
   Brake-initiated kills mark decisions as `'suspended'` (resumable). Explicit
   kills apply the `OrphanedDecisionPolicy`: default is `'triage'` (leave in
   Queue with "agent killed" badge for human review), with `'cancel'` and
   `'reassign'` as alternatives. Policy is configurable per control mode.
   See "In-flight decisions on agent kill" subsection under Emergency Brake.

9. ~~**Trust score calibration**~~ **RESOLVED -- simulation + calibration mode
   + per-project profiles.** All trust parameters (deltas, decay rate, floor,
   ceiling, diminishing return thresholds) are configurable per-project via
   `TrustCalibrationConfig`. Validation strategy: Phase 0-1 uses MockPlugin
   simulation to verify convergence, recovery, separation, and responsiveness.
   Phase 2 uses `calibrationMode` (log proposed deltas without applying) for
   live tuning. Phase 3+ adds `TrustCalibrationProfile` presets
   (conservative/balanced/permissive) with per-profile delta multipliers.
   Trust scores are backend-only -- agents do not see their numeric score.
   See "Trust score calibration" subsection under Trust score update rules.

10. ~~**Testing without real SDKs**~~ **RESOLVED — Phase 0 MockPlugin.** The
    `MockPlugin` adapter is now specified as Phase 0 in the Implementation
    Phases section. It produces scripted `AgentEvent` sequences from the 5
    prototype scenarios, simulates HITL interruptions with auto-resolve timers,
    and supports failure injection (errors, malformed events, crashes, guardrail
    trips, timeouts) for resilience testing. See Phase 0 for the full spec.

---

## Related Documents

- [PLAN.md](../PLAN.md) — Prototype build plan (M0-M9)
- [Research: Claude Agent SDK](research/claude-agent-sdk.md)
- [Research: OpenAI Agents SDK](research/openai-agents-sdk.md)
- [Research: Gemini ADK](research/gemini-adk.md)
