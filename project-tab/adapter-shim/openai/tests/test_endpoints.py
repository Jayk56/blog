"""Tests for HTTP endpoints of the adapter shim."""

from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from adapter_shim.app import create_app

from .conftest import make_test_brief


@pytest.fixture
def app():
    return create_app(mock=True)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
class TestHealthEndpoint:
    async def test_health_returns_200(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200

    async def test_health_shape(self, client):
        resp = await client.get("/health")
        data = resp.json()
        assert data["status"] == "healthy"
        assert "uptimeMs" in data
        assert "agentStatus" in data
        assert "resourceUsage" in data
        assert "pendingEventBufferSize" in data

    async def test_health_uptime_increases(self, client):
        r1 = await client.get("/health")
        await asyncio.sleep(0.05)
        r2 = await client.get("/health")
        assert r2.json()["uptimeMs"] >= r1.json()["uptimeMs"]


@pytest.mark.asyncio
class TestSpawnEndpoint:
    async def test_spawn_returns_agent_handle(self, client):
        resp = await client.post("/spawn", json=make_test_brief())
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "agent-test-001"
        assert data["pluginName"] == "openai-mock"
        assert data["status"] == "running"
        assert "sessionId" in data

    async def test_spawn_twice_returns_409(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/spawn", json=make_test_brief())
        assert resp.status_code == 409

    async def test_health_reflects_running_agent(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.get("/health")
        data = resp.json()
        # Could be "running" or "waiting_on_human" depending on timing
        assert data["agentStatus"] in ("running", "waiting_on_human")


@pytest.mark.asyncio
class TestKillEndpoint:
    async def test_kill_no_agent_returns_404(self, client):
        resp = await client.post("/kill", json={"grace": True})
        assert resp.status_code == 404

    async def test_kill_after_spawn(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/kill", json={"grace": True})
        assert resp.status_code == 200
        data = resp.json()
        assert "cleanShutdown" in data
        assert data["cleanShutdown"] is True

    async def test_force_kill(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/kill", json={"grace": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["cleanShutdown"] is False


@pytest.mark.asyncio
class TestPauseEndpoint:
    async def test_pause_no_agent_returns_404(self, client):
        resp = await client.post("/pause")
        assert resp.status_code == 404

    async def test_pause_returns_serialized_state(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/pause")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agentId"] == "agent-test-001"
        assert data["pluginName"] == "openai-mock"
        assert "sessionId" in data
        assert "checkpoint" in data
        assert data["checkpoint"]["sdk"] == "mock"
        assert "lastSequence" in data
        assert data["serializedBy"] == "pause"


@pytest.mark.asyncio
class TestResumeEndpoint:
    async def test_resume_from_paused_state(self, client):
        await client.post("/spawn", json=make_test_brief())
        pause_resp = await client.post("/pause")
        state = pause_resp.json()

        resp = await client.post("/resume", json=state)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "running"
        assert data["pluginName"] == "openai-mock"


@pytest.mark.asyncio
class TestResolveEndpoint:
    async def test_resolve_no_agent_returns_404(self, client):
        resp = await client.post("/resolve", json={
            "decisionId": "fake",
            "resolution": {
                "type": "tool_approval",
                "action": "approve",
                "actionKind": "update",
            },
        })
        assert resp.status_code == 404

    async def test_resolve_wrong_decision_returns_404(self, client):
        await client.post("/spawn", json=make_test_brief())
        # Wait for the runner to reach the decision point
        await asyncio.sleep(0.5)

        resp = await client.post("/resolve", json={
            "decisionId": "wrong-id",
            "resolution": {
                "type": "tool_approval",
                "action": "approve",
                "actionKind": "update",
            },
        })
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestInjectContextEndpoint:
    async def test_inject_context_accepts(self, client):
        resp = await client.post("/inject-context", json={
            "content": "Updated context",
            "format": "markdown",
            "snapshotVersion": 2,
            "estimatedTokens": 100,
            "priority": "recommended",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"


@pytest.mark.asyncio
class TestUpdateBriefEndpoint:
    async def test_update_brief_no_agent_returns_404(self, client):
        resp = await client.post("/update-brief", json={"role": "updated-role"})
        assert resp.status_code == 404

    async def test_update_brief_stores_changes(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/update-brief", json={"role": "updated-role"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"


@pytest.mark.asyncio
class TestCheckpointEndpoint:
    async def test_checkpoint_no_agent_returns_404(self, client):
        resp = await client.post("/checkpoint", json={"decisionId": "dec-1"})
        assert resp.status_code == 404

    async def test_checkpoint_returns_serialized_state(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/checkpoint", json={"decisionId": "dec-1"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["agentId"] == "agent-test-001"
        assert data["pluginName"] == "openai-mock"
        assert "sessionId" in data
        assert "checkpoint" in data
        assert data["checkpoint"]["sdk"] == "mock"
        assert data["serializedBy"] == "decision_checkpoint"
        assert "lastSequence" in data
        assert data["pendingDecisionIds"] == ["dec-1"]

    async def test_checkpoint_includes_brief_snapshot(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/checkpoint", json={"decisionId": "dec-1"})
        data = resp.json()
        assert "briefSnapshot" in data
        assert data["briefSnapshot"]["agentId"] == "agent-test-001"

    async def test_checkpoint_includes_conversation_summary(self, client):
        await client.post("/spawn", json=make_test_brief())
        resp = await client.post("/checkpoint", json={"decisionId": "dec-1"})
        data = resp.json()
        assert "conversationSummary" in data
        assert isinstance(data["conversationSummary"], str)

    async def test_checkpoint_does_not_stop_agent(self, client):
        await client.post("/spawn", json=make_test_brief())
        # Take a checkpoint
        resp = await client.post("/checkpoint", json={"decisionId": "dec-1"})
        assert resp.status_code == 200

        # Agent should still be running/active (health check still works)
        health = await client.get("/health")
        assert health.status_code == 200
        assert health.json()["agentStatus"] in ("running", "waiting_on_human")
