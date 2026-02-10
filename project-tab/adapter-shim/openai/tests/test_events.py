"""Tests for EventFactory sequencing and envelope generation."""

from __future__ import annotations

from adapter_shim.events import EventFactory
from adapter_shim.models import LifecycleEvent, StatusEvent


class TestEventFactory:
    def test_monotonic_sequence(self):
        factory = EventFactory(run_id="run-1")
        e1 = factory.wrap(StatusEvent(agentId="a1", message="first"))
        e2 = factory.wrap(StatusEvent(agentId="a1", message="second"))
        e3 = factory.wrap(StatusEvent(agentId="a1", message="third"))
        assert e1.source_sequence == 1
        assert e2.source_sequence == 2
        assert e3.source_sequence == 3

    def test_unique_event_ids(self):
        factory = EventFactory(run_id="run-1")
        e1 = factory.wrap(StatusEvent(agentId="a1", message="one"))
        e2 = factory.wrap(StatusEvent(agentId="a1", message="two"))
        assert e1.source_event_id != e2.source_event_id

    def test_run_id_preserved(self):
        factory = EventFactory(run_id="run-42")
        e = factory.wrap(LifecycleEvent(agentId="a1", action="started"))
        assert e.run_id == "run-42"

    def test_timestamp_is_iso8601(self):
        factory = EventFactory(run_id="run-1")
        e = factory.wrap(StatusEvent(agentId="a1", message="test"))
        # ISO 8601 timestamps contain 'T'
        assert "T" in e.source_occurred_at

    def test_last_sequence_tracks(self):
        factory = EventFactory(run_id="run-1")
        assert factory.last_sequence == 0
        factory.wrap(StatusEvent(agentId="a1", message="one"))
        assert factory.last_sequence == 1
        factory.wrap(StatusEvent(agentId="a1", message="two"))
        assert factory.last_sequence == 2

    def test_event_payload_preserved(self):
        factory = EventFactory(run_id="run-1")
        inner = LifecycleEvent(agentId="agent-x", action="started", reason="boot")
        envelope = factory.wrap(inner)
        assert envelope.event.type == "lifecycle"
        assert envelope.event.agent_id == "agent-x"
        assert envelope.event.action == "started"
        assert envelope.event.reason == "boot"
