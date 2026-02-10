"""Tests for Pydantic models matching the TypeScript wire protocol types."""

from __future__ import annotations

import pytest

from adapter_shim.models import (
    AdapterEvent,
    AgentBrief,
    AgentHandle,
    ArtifactEvent,
    CompletionEvent,
    ContextInjection,
    ErrorEvent,
    KillRequest,
    KillResponse,
    LifecycleEvent,
    OptionDecisionEvent,
    OptionDecisionResolution,
    Provenance,
    ResolveRequest,
    SandboxHealthResponse,
    SandboxResourceUsage,
    SdkCheckpoint,
    SerializedAgentState,
    StatusEvent,
    ToolApprovalEvent,
    ToolApprovalResolution,
    ToolCallEvent,
)

from .conftest import make_test_brief


class TestAgentBrief:
    def test_parse_from_camel_case(self):
        data = make_test_brief()
        brief = AgentBrief.model_validate(data)
        assert brief.agent_id == "agent-test-001"
        assert brief.role == "test-agent"
        assert brief.workstream == "testing"
        assert brief.control_mode == "orchestrator"
        assert brief.project_brief.title == "Test Project"
        assert brief.knowledge_snapshot.version == 1

    def test_serialize_to_camel_case(self):
        data = make_test_brief()
        brief = AgentBrief.model_validate(data)
        output = brief.model_dump(by_alias=True)
        assert "agentId" in output
        assert "controlMode" in output
        assert "projectBrief" in output
        assert output["agentId"] == "agent-test-001"


class TestAgentHandle:
    def test_round_trip(self):
        handle = AgentHandle(
            id="agent-1",
            pluginName="openai-mock",
            status="running",
            sessionId="session-abc",
        )
        d = handle.model_dump(by_alias=True)
        assert d["pluginName"] == "openai-mock"
        assert d["sessionId"] == "session-abc"
        parsed = AgentHandle.model_validate(d)
        assert parsed.plugin_name == "openai-mock"


class TestEventTypes:
    def test_status_event(self):
        e = StatusEvent(agentId="a1", message="hello")
        d = e.model_dump(by_alias=True)
        assert d["type"] == "status"
        assert d["agentId"] == "a1"
        assert d["message"] == "hello"

    def test_lifecycle_event(self):
        e = LifecycleEvent(agentId="a1", action="started")
        d = e.model_dump(by_alias=True)
        assert d["type"] == "lifecycle"
        assert d["action"] == "started"

    def test_tool_call_event(self):
        e = ToolCallEvent(
            agentId="a1",
            toolCallId="tc-1",
            toolName="file_search",
            phase="completed",
            input={"query": "test"},
            output={"results": []},
            approved=True,
            durationMs=100,
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "tool_call"
        assert d["toolCallId"] == "tc-1"
        assert d["durationMs"] == 100
        assert d["phase"] == "completed"

    def test_tool_approval_event(self):
        e = ToolApprovalEvent(
            agentId="a1",
            decisionId="d-1",
            toolName="execute_code",
            toolArgs={"code": "print(1)"},
            severity="medium",
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "decision"
        assert d["subtype"] == "tool_approval"
        assert d["toolName"] == "execute_code"

    def test_option_decision_event(self):
        e = OptionDecisionEvent(
            agentId="a1",
            decisionId="d-2",
            title="Choose approach",
            summary="Pick one",
            severity="medium",
            confidence=0.8,
            blastRadius="small",
            options=[{"id": "opt-1", "label": "Option A", "description": "First option"}],
            requiresRationale=True,
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "decision"
        assert d["subtype"] == "option"
        assert d["requiresRationale"] is True

    def test_artifact_event(self):
        e = ArtifactEvent(
            agentId="a1",
            artifactId="art-1",
            name="report.md",
            kind="document",
            workstream="testing",
            status="draft",
            qualityScore=0.9,
            provenance=Provenance(
                createdBy="a1",
                createdAt="2025-01-01T00:00:00Z",
            ),
            uri="/workspace/report.md",
            mimeType="text/markdown",
            sizeBytes=1024,
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "artifact"
        assert d["artifactId"] == "art-1"
        assert d["provenance"]["createdBy"] == "a1"
        assert d["mimeType"] == "text/markdown"

    def test_completion_event(self):
        e = CompletionEvent(
            agentId="a1",
            summary="Done",
            artifactsProduced=["art-1"],
            decisionsNeeded=[],
            outcome="success",
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "completion"
        assert d["outcome"] == "success"
        assert d["artifactsProduced"] == ["art-1"]

    def test_error_event(self):
        e = ErrorEvent(
            agentId="a1",
            severity="high",
            message="Something broke",
            recoverable=False,
            category="internal",
        )
        d = e.model_dump(by_alias=True)
        assert d["type"] == "error"
        assert d["recoverable"] is False


class TestAdapterEvent:
    def test_envelope_structure(self):
        inner = StatusEvent(agentId="a1", message="testing")
        envelope = AdapterEvent(
            sourceEventId="evt-123",
            sourceSequence=1,
            sourceOccurredAt="2025-01-01T00:00:00Z",
            runId="run-456",
            event=inner,
        )
        d = envelope.model_dump(by_alias=True)
        assert d["sourceEventId"] == "evt-123"
        assert d["sourceSequence"] == 1
        assert d["runId"] == "run-456"
        assert d["event"]["type"] == "status"


class TestResolution:
    def test_tool_approval_resolution(self):
        r = ToolApprovalResolution(
            action="approve",
            actionKind="update",
        )
        d = r.model_dump(by_alias=True)
        assert d["type"] == "tool_approval"
        assert d["action"] == "approve"
        assert d["actionKind"] == "update"

    def test_option_decision_resolution(self):
        r = OptionDecisionResolution(
            chosenOptionId="opt-1",
            rationale="Best option",
            actionKind="create",
        )
        d = r.model_dump(by_alias=True)
        assert d["type"] == "option"
        assert d["chosenOptionId"] == "opt-1"

    def test_resolve_request(self):
        req = ResolveRequest(
            decisionId="d-1",
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        )
        d = req.model_dump(by_alias=True)
        assert d["decisionId"] == "d-1"
        assert d["resolution"]["type"] == "tool_approval"


class TestSandboxHealth:
    def test_health_response(self):
        h = SandboxHealthResponse(
            status="healthy",
            agentStatus="running",
            uptimeMs=5000,
            resourceUsage=SandboxResourceUsage(
                cpuPercent=10.5,
                memoryMb=128.0,
                diskMb=50.0,
                collectedAt="2025-01-01T00:00:00Z",
            ),
            pendingEventBufferSize=3,
        )
        d = h.model_dump(by_alias=True)
        assert d["status"] == "healthy"
        assert d["uptimeMs"] == 5000
        assert d["resourceUsage"]["cpuPercent"] == 10.5


class TestKillRequest:
    def test_default_grace(self):
        k = KillRequest()
        assert k.grace is True

    def test_force_kill(self):
        k = KillRequest(grace=False)
        assert k.grace is False


class TestSerializedAgentState:
    def test_round_trip(self):
        brief = AgentBrief.model_validate(make_test_brief())
        state = SerializedAgentState(
            agentId="a1",
            pluginName="openai-mock",
            sessionId="s1",
            checkpoint=SdkCheckpoint(sdk="mock", scriptPosition=5),
            briefSnapshot=brief,
            pendingDecisionIds=["d-1"],
            lastSequence=5,
            serializedAt="2025-01-01T00:00:00Z",
            serializedBy="pause",
            estimatedSizeBytes=256,
        )
        d = state.model_dump(by_alias=True)
        assert d["agentId"] == "a1"
        assert d["checkpoint"]["sdk"] == "mock"
        assert d["checkpoint"]["scriptPosition"] == 5
        parsed = SerializedAgentState.model_validate(d)
        assert parsed.agent_id == "a1"
