"""Tests for the WebSocket /events endpoint."""

from __future__ import annotations

import threading
import time

import pytest
from starlette.testclient import TestClient

from adapter_shim.app import create_app

from .conftest import make_test_brief


class TestWebSocketEvents:
    def test_ws_receives_events_after_spawn(self):
        """Spawn an agent and verify events arrive over WebSocket."""
        app = create_app(mock=True)

        with TestClient(app) as tc:
            with tc.websocket_connect("/events") as ws:
                resp = tc.post("/spawn", json=make_test_brief())
                assert resp.status_code == 200

                # The first event should be lifecycle(started)
                data = ws.receive_json(mode="text")
                assert data["event"]["type"] == "lifecycle"
                assert data["event"]["action"] == "started"
                assert "sourceEventId" in data
                assert "sourceSequence" in data
                assert "runId" in data

    def test_ws_full_mock_sequence(self):
        """Run the full mock sequence and verify all event types arrive."""
        app = create_app(mock=True)

        with TestClient(app) as tc:
            with tc.websocket_connect("/events") as ws:
                resp = tc.post("/spawn", json=make_test_brief())
                assert resp.status_code == 200

                # Collect events until we see the decision
                events = []
                decision_id = None
                for _ in range(50):
                    data = ws.receive_json(mode="text")
                    events.append(data)
                    if data.get("event", {}).get("type") == "decision":
                        decision_id = data["event"]["decisionId"]
                        break

                assert decision_id is not None

                # Resolve the decision
                resolve_resp = tc.post("/resolve", json={
                    "decisionId": decision_id,
                    "resolution": {
                        "type": "tool_approval",
                        "action": "approve",
                        "actionKind": "update",
                    },
                })
                assert resolve_resp.status_code == 200

                # Collect remaining events until completion
                for _ in range(50):
                    data = ws.receive_json(mode="text")
                    events.append(data)
                    if data.get("event", {}).get("type") == "completion":
                        break

                # Verify the full sequence
                types = [e["event"]["type"] for e in events]
                assert "lifecycle" in types
                assert "status" in types
                assert "tool_call" in types
                assert "decision" in types
                assert "artifact" in types
                assert "completion" in types

                # Verify sequencing is monotonic
                sequences = [e["sourceSequence"] for e in events]
                assert sequences == sorted(sequences)

                # Verify all share the same runId
                run_ids = set(e["runId"] for e in events)
                assert len(run_ids) == 1

    def test_event_camel_case_serialization(self):
        """Verify all events use camelCase field names on the wire."""
        app = create_app(mock=True)

        with TestClient(app) as tc:
            with tc.websocket_connect("/events") as ws:
                tc.post("/spawn", json=make_test_brief())

                # Get first event
                data = ws.receive_json(mode="text")

                # Top-level envelope fields must be camelCase
                assert "sourceEventId" in data
                assert "sourceSequence" in data
                assert "sourceOccurredAt" in data
                assert "runId" in data
                assert "event" in data

                # No snake_case at top level
                assert "source_event_id" not in data
                assert "source_sequence" not in data

                # Inner event should use camelCase too
                inner = data["event"]
                assert "agentId" in inner
                assert "agent_id" not in inner
