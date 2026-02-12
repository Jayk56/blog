"""Tests for artifact upload helper and providerConfig passthrough."""

from __future__ import annotations

import json
import os

import pytest
from httpx import ASGITransport, AsyncClient

from adapter_shim.app import create_app
from adapter_shim.artifact_upload import (
    get_artifact_upload_endpoint,
    get_bootstrap_config,
)


def make_test_brief(agent_id: str = "agent-test-001", provider_config: dict | None = None) -> dict:
    """Create a minimal valid AgentBrief as a dict (camelCase keys)."""
    brief = {
        "agentId": agent_id,
        "role": "test-agent",
        "description": "A test agent for integration testing",
        "workstream": "testing",
        "readableWorkstreams": ["testing"],
        "constraints": [],
        "escalationProtocol": {
            "alwaysEscalate": [],
            "escalateWhen": [],
            "neverEscalate": [],
        },
        "controlMode": "orchestrator",
        "projectBrief": {
            "title": "Test Project",
            "description": "A test project",
            "goals": ["Test goal"],
            "checkpoints": ["Test checkpoint"],
        },
        "knowledgeSnapshot": {
            "version": 1,
            "generatedAt": "2025-01-01T00:00:00Z",
            "workstreams": [],
            "pendingDecisions": [],
            "recentCoherenceIssues": [],
            "artifactIndex": [],
            "activeAgents": [],
            "estimatedTokens": 0,
        },
        "allowedTools": ["file_search", "execute_code"],
    }
    if provider_config is not None:
        brief["providerConfig"] = provider_config
    return brief


@pytest.fixture
def app():
    return create_app(mock=True)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestBootstrapConfig:
    """Tests for bootstrap config parsing."""

    def test_get_bootstrap_config_not_set(self, monkeypatch):
        monkeypatch.delenv("AGENT_BOOTSTRAP", raising=False)
        assert get_bootstrap_config() is None

    def test_get_bootstrap_config_valid(self, monkeypatch):
        config = {
            "backendUrl": "http://localhost:3001",
            "artifactUploadEndpoint": "http://localhost:3001/api/artifacts",
            "agentId": "agent-1",
        }
        monkeypatch.setenv("AGENT_BOOTSTRAP", json.dumps(config))
        result = get_bootstrap_config()
        assert result is not None
        assert result["artifactUploadEndpoint"] == "http://localhost:3001/api/artifacts"

    def test_get_bootstrap_config_invalid_json(self, monkeypatch):
        monkeypatch.setenv("AGENT_BOOTSTRAP", "not-json{{{")
        assert get_bootstrap_config() is None

    def test_get_artifact_upload_endpoint(self, monkeypatch):
        config = {"artifactUploadEndpoint": "http://backend:3001/api/artifacts"}
        monkeypatch.setenv("AGENT_BOOTSTRAP", json.dumps(config))
        endpoint = get_artifact_upload_endpoint()
        assert endpoint == "http://backend:3001/api/artifacts"

    def test_get_artifact_upload_endpoint_missing(self, monkeypatch):
        config = {"backendUrl": "http://localhost:3001"}
        monkeypatch.setenv("AGENT_BOOTSTRAP", json.dumps(config))
        endpoint = get_artifact_upload_endpoint()
        assert endpoint is None


class TestProviderConfigEndpoint:
    """Tests for GET /debug/config providerConfig passthrough."""

    @pytest.mark.anyio
    async def test_debug_config_no_runner(self, client: AsyncClient):
        """Debug config returns null when no agent is running."""
        res = await client.get("/debug/config")
        assert res.status_code == 200
        data = res.json()
        assert data["providerConfig"] is None

    @pytest.mark.anyio
    async def test_debug_config_with_provider_config(self, client: AsyncClient):
        """providerConfig flows through spawn to debug endpoint."""
        provider_config = {"temperature": 0.7, "maxTokens": 4096}
        brief = make_test_brief("agent-config-1", provider_config)

        spawn_res = await client.post("/spawn", json=brief)
        assert spawn_res.status_code == 200

        config_res = await client.get("/debug/config")
        assert config_res.status_code == 200
        data = config_res.json()
        assert data["providerConfig"] == provider_config

    @pytest.mark.anyio
    async def test_debug_config_without_provider_config(self, client: AsyncClient):
        """Debug config returns null when no providerConfig in brief."""
        brief = make_test_brief("agent-no-config")

        spawn_res = await client.post("/spawn", json=brief)
        assert spawn_res.status_code == 200

        config_res = await client.get("/debug/config")
        assert config_res.status_code == 200
        data = config_res.json()
        assert data["providerConfig"] is None

    @pytest.mark.anyio
    async def test_debug_config_complex_nested(self, client: AsyncClient):
        """Complex nested providerConfig is preserved."""
        provider_config = {
            "model": "gpt-4o",
            "temperature": 0.3,
            "stop": ["\n\n"],
            "response_format": {"type": "json_object"},
        }
        brief = make_test_brief("agent-complex", provider_config)

        spawn_res = await client.post("/spawn", json=brief)
        assert spawn_res.status_code == 200

        config_res = await client.get("/debug/config")
        assert config_res.status_code == 200
        data = config_res.json()
        assert data["providerConfig"] == provider_config
