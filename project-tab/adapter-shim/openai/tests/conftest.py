"""Shared fixtures for adapter shim tests."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from adapter_shim.app import create_app
from adapter_shim.models import (
    AgentBrief,
    EscalationProtocol,
    KnowledgeSnapshot,
    ProjectBrief,
)


def make_test_brief(agent_id: str = "agent-test-001") -> dict:
    """Create a minimal valid AgentBrief as a dict (camelCase keys)."""
    return {
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


@pytest.fixture
def test_brief_dict() -> dict:
    return make_test_brief()


@pytest.fixture
def app():
    return create_app(mock=True)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
