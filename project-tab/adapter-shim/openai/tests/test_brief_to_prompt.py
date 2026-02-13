"""Tests for brief_to_prompt conversion."""

from __future__ import annotations

from adapter_shim.brief_to_prompt import brief_to_prompt
from adapter_shim.models import AgentBrief

from .conftest import make_test_brief


def _make_brief(**overrides: object) -> AgentBrief:
    data = make_test_brief()
    data.update(overrides)
    return AgentBrief.model_validate(data)


class TestBriefToPrompt:
    def test_includes_role_and_workstream(self):
        brief = _make_brief(role="backend-dev", workstream="api")
        prompt = brief_to_prompt(brief)
        assert 'You are a backend-dev working on the "api" workstream.' in prompt

    def test_includes_description(self):
        brief = _make_brief(description="Build the REST endpoints")
        prompt = brief_to_prompt(brief)
        assert "Build the REST endpoints" in prompt

    def test_includes_project_title_and_description(self):
        brief = _make_brief()
        prompt = brief_to_prompt(brief)
        assert "## Project" in prompt
        assert "Test Project: A test project" in prompt

    def test_includes_goals(self):
        data = make_test_brief()
        data["projectBrief"]["goals"] = ["Ship v1", "Write tests"]
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert "## Goals" in prompt
        assert "- Ship v1" in prompt
        assert "- Write tests" in prompt

    def test_includes_constraints_from_brief_and_project(self):
        data = make_test_brief()
        data["constraints"] = ["No external deps"]
        data["projectBrief"]["constraints"] = ["Use TypeScript"]
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert "## Constraints" in prompt
        assert "- No external deps" in prompt
        assert "- Use TypeScript" in prompt

    def test_no_constraints_section_when_empty(self):
        data = make_test_brief()
        data["constraints"] = []
        data["projectBrief"]["constraints"] = None
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert "## Constraints" not in prompt

    def test_includes_knowledge_context_when_present(self):
        data = make_test_brief()
        data["knowledgeSnapshot"]["estimatedTokens"] = 500
        data["knowledgeSnapshot"]["workstreams"] = [
            {"id": "w1", "name": "api", "status": "active", "activeAgentIds": [], "artifactCount": 0, "pendingDecisionCount": 0, "recentActivity": ""},
        ]
        data["knowledgeSnapshot"]["artifactIndex"] = [
            {"id": "a1", "name": "file.ts", "kind": "code", "status": "draft", "workstream": "api"},
        ]
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert "## Context" in prompt
        assert "1 active workstream(s)" in prompt
        assert "1 artifact(s)" in prompt

    def test_no_context_section_when_zero_tokens(self):
        data = make_test_brief()
        data["knowledgeSnapshot"]["estimatedTokens"] = 0
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert "## Context" not in prompt

    def test_truncates_long_prompt(self):
        data = make_test_brief()
        data["description"] = "x" * 9000
        brief = AgentBrief.model_validate(data)
        prompt = brief_to_prompt(brief)
        assert len(prompt) == 8000
        assert prompt.endswith("...")

    def test_returns_string(self):
        brief = _make_brief()
        result = brief_to_prompt(brief)
        assert isinstance(result, str)
        assert len(result) > 0
