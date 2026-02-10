"""Pydantic models mirroring the TypeScript wire protocol types."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Enums as Literal unions ──────────────────────────────────────────────

Severity = Literal["warning", "low", "medium", "high", "critical"]
BlastRadius = Literal["trivial", "small", "medium", "large", "unknown"]
ControlMode = Literal["orchestrator", "adaptive", "ecosystem"]
ArtifactKind = Literal["code", "document", "design", "config", "test", "other"]
CoherenceCategory = Literal["contradiction", "duplication", "gap", "dependency_violation"]
ActionKind = Literal["create", "update", "delete", "review", "deploy"]
AgentStatus = Literal["running", "paused", "waiting_on_human", "completed", "error"]
HealthStatus = Literal["healthy", "degraded", "unhealthy"]


# ── Brief sub-types ──────────────────────────────────────────────────────

class ProjectBrief(BaseModel):
    id: str | None = None
    title: str
    description: str
    goals: list[str]
    checkpoints: list[str]
    constraints: list[str] | None = None


class MCPServerConfig(BaseModel):
    name: str
    transport: str | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    config: dict[str, Any] | None = None


class SecretRef(BaseModel):
    name: str
    vault_key: str = Field(alias="vaultKey")
    scope: Literal["agent", "project"]

    model_config = {"populate_by_name": True}


class GuardrailSpec(BaseModel):
    name: str
    description: str
    action: Literal["block", "warn", "log"]


class GuardrailPolicy(BaseModel):
    input_guardrails: list[GuardrailSpec] = Field(alias="inputGuardrails", default_factory=list)
    output_guardrails: list[GuardrailSpec] = Field(alias="outputGuardrails", default_factory=list)
    tool_guardrails: list[GuardrailSpec] = Field(alias="toolGuardrails", default_factory=list)

    model_config = {"populate_by_name": True}


class EscalationPredicate(BaseModel):
    field: str | None = None
    op: str | None = None
    value: Any = None
    type: str | None = None
    rules: list[EscalationPredicate] | None = None


class EscalationRule(BaseModel):
    predicate: EscalationPredicate
    description: str


class EscalationProtocol(BaseModel):
    always_escalate: list[str] = Field(alias="alwaysEscalate", default_factory=list)
    escalate_when: list[EscalationRule] = Field(alias="escalateWhen", default_factory=list)
    never_escalate: list[str] = Field(alias="neverEscalate", default_factory=list)

    model_config = {"populate_by_name": True}


class WorkspaceMount(BaseModel):
    host_path: str = Field(alias="hostPath")
    sandbox_path: str = Field(alias="sandboxPath")
    read_only: bool = Field(alias="readOnly")

    model_config = {"populate_by_name": True}


class WorkspaceRequirements(BaseModel):
    mounts: list[WorkspaceMount] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    resource_limits: dict[str, Any] | None = Field(alias="resourceLimits", default=None)
    base_image: str | None = Field(alias="baseImage", default=None)

    model_config = {"populate_by_name": True}


class SessionPolicy(BaseModel):
    max_turns: int | None = Field(alias="maxTurns", default=None)
    context_budget_tokens: int | None = Field(alias="contextBudgetTokens", default=None)
    history_policy: Literal["full", "summarized", "recent_n"] = Field(alias="historyPolicy")
    history_n: int | None = Field(alias="historyN", default=None)

    model_config = {"populate_by_name": True}


class ContextReactiveTrigger(BaseModel):
    on: str
    workstreams: str | None = None
    severity: Severity | None = None

    model_config = {"populate_by_name": True}


class ContextInjectionPolicy(BaseModel):
    periodic_interval_ticks: int | None = Field(alias="periodicIntervalTicks", default=None)
    reactive_events: list[ContextReactiveTrigger] = Field(alias="reactiveEvents", default_factory=list)
    staleness_threshold: int | None = Field(alias="stalenessThreshold", default=None)
    max_injections_per_hour: int = Field(alias="maxInjectionsPerHour", default=10)
    cooldown_ticks: int = Field(alias="cooldownTicks", default=0)

    model_config = {"populate_by_name": True}


class WorkstreamSummary(BaseModel):
    id: str
    name: str
    status: str
    active_agent_ids: list[str] = Field(alias="activeAgentIds", default_factory=list)
    artifact_count: int = Field(alias="artifactCount", default=0)
    pending_decision_count: int = Field(alias="pendingDecisionCount", default=0)
    recent_activity: str = Field(alias="recentActivity", default="")

    model_config = {"populate_by_name": True}


class DecisionSummary(BaseModel):
    id: str
    title: str
    severity: Severity
    agent_id: str = Field(alias="agentId")
    subtype: Literal["option", "tool_approval"]

    model_config = {"populate_by_name": True}


class CoherenceIssueSummary(BaseModel):
    id: str
    title: str
    severity: Severity
    category: CoherenceCategory
    affected_workstreams: list[str] = Field(alias="affectedWorkstreams", default_factory=list)

    model_config = {"populate_by_name": True}


class ArtifactSummary(BaseModel):
    id: str
    name: str
    kind: ArtifactKind
    status: Literal["draft", "in_review", "approved", "rejected"]
    workstream: str


class AgentSummaryModel(BaseModel):
    id: str
    role: str
    workstream: str
    status: AgentStatus
    plugin_name: str = Field(alias="pluginName")
    model_preference: str | None = Field(alias="modelPreference", default=None)

    model_config = {"populate_by_name": True}


class KnowledgeSnapshot(BaseModel):
    version: int
    generated_at: str = Field(alias="generatedAt")
    workstreams: list[WorkstreamSummary] = Field(default_factory=list)
    pending_decisions: list[DecisionSummary] = Field(alias="pendingDecisions", default_factory=list)
    recent_coherence_issues: list[CoherenceIssueSummary] = Field(alias="recentCoherenceIssues", default_factory=list)
    artifact_index: list[ArtifactSummary] = Field(alias="artifactIndex", default_factory=list)
    active_agents: list[AgentSummaryModel] = Field(alias="activeAgents", default_factory=list)
    estimated_tokens: int = Field(alias="estimatedTokens", default=0)

    model_config = {"populate_by_name": True}


class DelegationPolicy(BaseModel):
    can_spawn_subagents: bool = Field(alias="canSpawnSubagents", default=False)
    allowed_handoffs: list[str] = Field(alias="allowedHandoffs", default_factory=list)
    max_depth: int = Field(alias="maxDepth", default=1)

    model_config = {"populate_by_name": True}


class AgentBrief(BaseModel):
    agent_id: str = Field(alias="agentId")
    role: str
    description: str
    workstream: str
    readable_workstreams: list[str] = Field(alias="readableWorkstreams", default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    escalation_protocol: EscalationProtocol = Field(alias="escalationProtocol")
    control_mode: ControlMode = Field(alias="controlMode")
    project_brief: ProjectBrief = Field(alias="projectBrief")
    knowledge_snapshot: KnowledgeSnapshot = Field(alias="knowledgeSnapshot")
    model_preference: str | None = Field(alias="modelPreference", default=None)
    allowed_tools: list[str] = Field(alias="allowedTools", default_factory=list)
    mcp_servers: list[MCPServerConfig] | None = Field(alias="mcpServers", default=None)
    workspace_requirements: WorkspaceRequirements | None = Field(alias="workspaceRequirements", default=None)
    output_schema: dict[str, Any] | None = Field(alias="outputSchema", default=None)
    guardrail_policy: GuardrailPolicy | None = Field(alias="guardrailPolicy", default=None)
    delegation_policy: DelegationPolicy | None = Field(alias="delegationPolicy", default=None)
    session_policy: SessionPolicy | None = Field(alias="sessionPolicy", default=None)
    context_injection_policy: ContextInjectionPolicy | None = Field(alias="contextInjectionPolicy", default=None)
    secret_refs: list[SecretRef] | None = Field(alias="secretRefs", default=None)
    provider_config: dict[str, Any] | None = Field(alias="providerConfig", default=None)

    model_config = {"populate_by_name": True}


# ── Context Injection ────────────────────────────────────────────────────

class ContextInjection(BaseModel):
    content: str
    format: Literal["markdown", "json", "plain"]
    snapshot_version: int = Field(alias="snapshotVersion")
    estimated_tokens: int = Field(alias="estimatedTokens")
    priority: Literal["required", "recommended", "supplementary"]

    model_config = {"populate_by_name": True}


# ── Plugin / Agent Handle types ──────────────────────────────────────────

class AgentHandle(BaseModel):
    id: str
    plugin_name: str = Field(alias="pluginName")
    status: AgentStatus
    session_id: str = Field(alias="sessionId")
    pending_brief_changes: dict[str, Any] | None = Field(alias="pendingBriefChanges", default=None)

    model_config = {"populate_by_name": True}


class SandboxResourceUsage(BaseModel):
    cpu_percent: float = Field(alias="cpuPercent", default=0.0)
    memory_mb: float = Field(alias="memoryMb", default=0.0)
    disk_mb: float = Field(alias="diskMb", default=0.0)
    collected_at: str = Field(alias="collectedAt")

    model_config = {"populate_by_name": True}


class SandboxHealthResponse(BaseModel):
    status: HealthStatus
    agent_status: AgentStatus = Field(alias="agentStatus")
    uptime_ms: int = Field(alias="uptimeMs")
    resource_usage: SandboxResourceUsage = Field(alias="resourceUsage")
    pending_event_buffer_size: int = Field(alias="pendingEventBufferSize", default=0)

    model_config = {"populate_by_name": True}


# ── Kill / Pause / Resume types ──────────────────────────────────────────

class SdkCheckpoint(BaseModel):
    sdk: str
    run_state_json: str | None = Field(alias="runStateJson", default=None)
    session_id: str | None = Field(alias="sessionId", default=None)
    last_message_id: str | None = Field(alias="lastMessageId", default=None)
    state_snapshot: dict[str, Any] | None = Field(alias="stateSnapshot", default=None)
    script_position: int | None = Field(alias="scriptPosition", default=None)

    model_config = {"populate_by_name": True}


class SerializedAgentState(BaseModel):
    agent_id: str = Field(alias="agentId")
    plugin_name: str = Field(alias="pluginName")
    session_id: str = Field(alias="sessionId")
    checkpoint: SdkCheckpoint
    brief_snapshot: AgentBrief = Field(alias="briefSnapshot")
    conversation_summary: str | None = Field(alias="conversationSummary", default=None)
    pending_decision_ids: list[str] = Field(alias="pendingDecisionIds", default_factory=list)
    last_sequence: int = Field(alias="lastSequence")
    serialized_at: str = Field(alias="serializedAt")
    serialized_by: Literal["pause", "kill_grace", "crash_recovery", "decision_checkpoint"] = Field(alias="serializedBy")
    estimated_size_bytes: int = Field(alias="estimatedSizeBytes")

    model_config = {"populate_by_name": True}


class KillRequest(BaseModel):
    grace: bool = True
    grace_timeout_ms: int | None = Field(alias="graceTimeoutMs", default=None)

    model_config = {"populate_by_name": True}


class KillResponse(BaseModel):
    state: SerializedAgentState | None = None
    artifacts_extracted: int = Field(alias="artifactsExtracted", default=0)
    clean_shutdown: bool = Field(alias="cleanShutdown", default=True)

    model_config = {"populate_by_name": True}


# ── Resolution types ─────────────────────────────────────────────────────

class OptionDecisionResolution(BaseModel):
    type: Literal["option"] = "option"
    chosen_option_id: str = Field(alias="chosenOptionId")
    rationale: str
    action_kind: ActionKind = Field(alias="actionKind")

    model_config = {"populate_by_name": True}


class ToolApprovalResolution(BaseModel):
    type: Literal["tool_approval"] = "tool_approval"
    action: Literal["approve", "reject", "modify"]
    modified_args: dict[str, Any] | None = Field(alias="modifiedArgs", default=None)
    always_approve: bool | None = Field(alias="alwaysApprove", default=None)
    rationale: str | None = None
    action_kind: ActionKind = Field(alias="actionKind")

    model_config = {"populate_by_name": True}


class ResolveRequest(BaseModel):
    decision_id: str = Field(alias="decisionId")
    resolution: OptionDecisionResolution | ToolApprovalResolution

    model_config = {"populate_by_name": True}


# ── Event payload types (for AdapterEvent.event) ─────────────────────────

class DecisionOption(BaseModel):
    id: str
    label: str
    description: str
    tradeoffs: str | None = None


class Provenance(BaseModel):
    created_by: str = Field(alias="createdBy")
    created_at: str = Field(alias="createdAt")
    modified_by: str | None = Field(alias="modifiedBy", default=None)
    modified_at: str | None = Field(alias="modifiedAt", default=None)
    source_artifact_ids: list[str] | None = Field(alias="sourceArtifactIds", default=None)
    source_path: str | None = Field(alias="sourcePath", default=None)

    model_config = {"populate_by_name": True}


class StatusEvent(BaseModel):
    type: Literal["status"] = "status"
    agent_id: str = Field(alias="agentId")
    message: str
    tick: int | None = None

    model_config = {"populate_by_name": True}


class ToolApprovalEvent(BaseModel):
    type: Literal["decision"] = "decision"
    subtype: Literal["tool_approval"] = "tool_approval"
    agent_id: str = Field(alias="agentId")
    decision_id: str = Field(alias="decisionId")
    tool_name: str = Field(alias="toolName")
    tool_args: dict[str, Any] = Field(alias="toolArgs")
    severity: Severity | None = None
    confidence: float | None = None
    blast_radius: BlastRadius | None = Field(alias="blastRadius", default=None)
    affected_artifact_ids: list[str] | None = Field(alias="affectedArtifactIds", default=None)
    due_by_tick: int | None = Field(alias="dueByTick", default=None)

    model_config = {"populate_by_name": True}


class OptionDecisionEvent(BaseModel):
    type: Literal["decision"] = "decision"
    subtype: Literal["option"] = "option"
    agent_id: str = Field(alias="agentId")
    decision_id: str = Field(alias="decisionId")
    title: str
    summary: str
    severity: Severity
    confidence: float
    blast_radius: BlastRadius = Field(alias="blastRadius")
    options: list[DecisionOption]
    recommended_option_id: str | None = Field(alias="recommendedOptionId", default=None)
    affected_artifact_ids: list[str] = Field(alias="affectedArtifactIds", default_factory=list)
    requires_rationale: bool = Field(alias="requiresRationale", default=False)
    due_by_tick: int | None = Field(alias="dueByTick", default=None)

    model_config = {"populate_by_name": True}


class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    agent_id: str = Field(alias="agentId")
    tool_call_id: str = Field(alias="toolCallId")
    tool_name: str = Field(alias="toolName")
    phase: Literal["requested", "running", "completed", "failed"]
    input: dict[str, Any] = Field(default_factory=dict)
    output: Any = None
    approved: bool = True
    duration_ms: int | None = Field(alias="durationMs", default=None)

    model_config = {"populate_by_name": True}


class ArtifactEvent(BaseModel):
    type: Literal["artifact"] = "artifact"
    agent_id: str = Field(alias="agentId")
    artifact_id: str = Field(alias="artifactId")
    name: str
    kind: ArtifactKind
    workstream: str
    status: Literal["draft", "in_review", "approved", "rejected"]
    quality_score: float = Field(alias="qualityScore")
    provenance: Provenance
    uri: str | None = None
    mime_type: str | None = Field(alias="mimeType", default=None)
    size_bytes: int | None = Field(alias="sizeBytes", default=None)
    content_hash: str | None = Field(alias="contentHash", default=None)

    model_config = {"populate_by_name": True}


class CompletionEvent(BaseModel):
    type: Literal["completion"] = "completion"
    agent_id: str = Field(alias="agentId")
    summary: str
    artifacts_produced: list[str] = Field(alias="artifactsProduced", default_factory=list)
    decisions_needed: list[str] = Field(alias="decisionsNeeded", default_factory=list)
    outcome: Literal["success", "partial", "abandoned", "max_turns"]
    reason: str | None = None

    model_config = {"populate_by_name": True}


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    agent_id: str = Field(alias="agentId")
    severity: Severity
    message: str
    recoverable: bool
    error_code: str | None = Field(alias="errorCode", default=None)
    category: Literal["provider", "tool", "model", "timeout", "internal"]
    context: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class LifecycleEvent(BaseModel):
    type: Literal["lifecycle"] = "lifecycle"
    agent_id: str = Field(alias="agentId")
    action: Literal["started", "paused", "resumed", "killed", "crashed", "session_start", "session_end"]
    reason: str | None = None

    model_config = {"populate_by_name": True}


class ProgressEvent(BaseModel):
    type: Literal["progress"] = "progress"
    agent_id: str = Field(alias="agentId")
    operation_id: str = Field(alias="operationId")
    description: str
    progress_pct: float | None = Field(alias="progressPct", default=None)

    model_config = {"populate_by_name": True}


# Union of all event payloads
AgentEvent = (
    StatusEvent
    | ToolApprovalEvent
    | OptionDecisionEvent
    | ToolCallEvent
    | ArtifactEvent
    | CompletionEvent
    | ErrorEvent
    | LifecycleEvent
    | ProgressEvent
)


class AdapterEvent(BaseModel):
    source_event_id: str = Field(alias="sourceEventId")
    source_sequence: int = Field(alias="sourceSequence")
    source_occurred_at: str = Field(alias="sourceOccurredAt")
    run_id: str = Field(alias="runId")
    event: AgentEvent

    model_config = {"populate_by_name": True}
