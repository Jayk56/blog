"""Tests for the mock runner scripted event sequence."""

from __future__ import annotations

import asyncio

import pytest

from adapter_shim.mock_runner import MockRunner
from adapter_shim.models import (
    AgentBrief,
    ResolveRequest,
    ToolApprovalResolution,
)

from .conftest import make_test_brief


def _make_runner() -> MockRunner:
    brief = AgentBrief.model_validate(make_test_brief())
    return MockRunner(brief)


@pytest.mark.asyncio
class TestMockRunnerSequence:
    async def test_emits_lifecycle_started_first(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.2)

        events = runner.drain_events()
        assert len(events) >= 1
        first = events[0]
        assert first.event.type == "lifecycle"
        assert first.event.action == "started"

    async def test_emits_status_event_second(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.3)

        events = runner.drain_events()
        assert len(events) >= 2
        second = events[1]
        assert second.event.type == "status"
        assert second.event.message == "Starting task..."

    async def test_emits_tool_call_phases(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.5)

        events = runner.drain_events()
        tool_calls = [e for e in events if e.event.type == "tool_call"]
        assert len(tool_calls) == 3  # requested, running, completed
        phases = [tc.event.phase for tc in tool_calls]
        assert phases == ["requested", "running", "completed"]
        # All should reference file_search
        for tc in tool_calls:
            assert tc.event.tool_name == "file_search"

    async def test_emits_decision_and_waits(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        events = runner.drain_events()
        decisions = [e for e in events if e.event.type == "decision"]
        assert len(decisions) == 1
        decision = decisions[0]
        assert decision.event.subtype == "tool_approval"
        assert decision.event.tool_name == "execute_code"

        # Runner should be waiting (not yet emitting artifact/completion)
        assert runner.handle.status == "waiting_on_human"

    async def test_full_sequence_with_resolve(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        # Drain pre-resolve events
        pre_events = runner.drain_events()
        decisions = [e for e in pre_events if e.event.type == "decision"]
        assert len(decisions) == 1
        decision_id = decisions[0].event.decision_id

        # Resolve the decision
        resolved = runner.resolve_decision(ResolveRequest(
            decisionId=decision_id,
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        assert resolved is True

        # Wait for post-resolve events
        await asyncio.sleep(0.5)
        post_events = runner.drain_events()

        # Should have artifact + completion events
        types = [e.event.type for e in post_events]
        assert "artifact" in types
        assert "completion" in types

        # Check artifact
        artifact_event = next(e for e in post_events if e.event.type == "artifact")
        assert artifact_event.event.name == "report.md"
        assert artifact_event.event.kind == "document"

        # Check completion
        completion_event = next(e for e in post_events if e.event.type == "completion")
        assert completion_event.event.outcome == "success"

        # Runner should be done
        assert runner.handle.status == "completed"
        assert not runner.is_running

    async def test_monotonic_sequencing(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        pre_events = runner.drain_events()
        decisions = [e for e in pre_events if e.event.type == "decision"]
        decision_id = decisions[0].event.decision_id

        runner.resolve_decision(ResolveRequest(
            decisionId=decision_id,
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        await asyncio.sleep(0.5)
        post_events = runner.drain_events()

        all_events = pre_events + post_events
        sequences = [e.source_sequence for e in all_events]
        assert sequences == sorted(sequences)
        assert len(set(sequences)) == len(sequences)  # All unique

    async def test_all_events_share_run_id(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        pre_events = runner.drain_events()
        decisions = [e for e in pre_events if e.event.type == "decision"]
        decision_id = decisions[0].event.decision_id

        runner.resolve_decision(ResolveRequest(
            decisionId=decision_id,
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        await asyncio.sleep(0.5)
        post_events = runner.drain_events()

        all_events = pre_events + post_events
        run_ids = set(e.run_id for e in all_events)
        assert len(run_ids) == 1

    async def test_kill_stops_runner(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.2)

        response = await runner.kill(grace=True)
        assert response.clean_shutdown is True
        assert not runner.is_running

        # Should have a killed lifecycle event
        events = runner.drain_events()
        lifecycle_events = [e for e in events if e.event.type == "lifecycle"]
        killed = [e for e in lifecycle_events if e.event.action == "killed"]
        assert len(killed) == 1

    async def test_pause_returns_state(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.3)

        state = await runner.pause()
        assert state.agent_id == "agent-test-001"
        assert state.plugin_name == "openai-mock"
        assert state.checkpoint.sdk == "mock"
        assert state.serialized_by == "pause"
        assert not runner.is_running

    async def test_resolve_wrong_id_returns_false(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        resolved = runner.resolve_decision(ResolveRequest(
            decisionId="nonexistent",
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        assert resolved is False

    async def test_all_events_have_agent_id(self):
        runner = _make_runner()
        runner.start()
        await asyncio.sleep(0.6)

        pre_events = runner.drain_events()
        decisions = [e for e in pre_events if e.event.type == "decision"]
        decision_id = decisions[0].event.decision_id

        runner.resolve_decision(ResolveRequest(
            decisionId=decision_id,
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        await asyncio.sleep(0.5)
        post_events = runner.drain_events()

        all_events = pre_events + post_events
        for event in all_events:
            assert event.event.agent_id == "agent-test-001"
