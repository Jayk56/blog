"""Tests for the CodexEventMapper."""

from __future__ import annotations

import json
import os

from adapter_shim.event_mapper import CodexEventMapper, infer_artifact_kind


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name: str) -> list[dict]:
    path = os.path.join(FIXTURES_DIR, name)
    events = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


class TestInferArtifactKind:
    def test_code_extensions(self):
        assert infer_artifact_kind("src/app.ts") == "code"
        assert infer_artifact_kind("lib/utils.py") == "code"
        assert infer_artifact_kind("main.go") == "code"
        assert infer_artifact_kind("Component.tsx") == "code"
        assert infer_artifact_kind("index.js") == "code"

    def test_document_extensions(self):
        assert infer_artifact_kind("README.md") == "document"
        assert infer_artifact_kind("notes.txt") == "document"
        assert infer_artifact_kind("docs/guide.rst") == "document"

    def test_config_extensions(self):
        assert infer_artifact_kind("package.json") == "config"
        assert infer_artifact_kind("config.yaml") == "config"
        assert infer_artifact_kind("settings.toml") == "config"
        assert infer_artifact_kind("app.cfg") == "config"

    def test_test_files(self):
        assert infer_artifact_kind("utils.test.ts") == "test"
        assert infer_artifact_kind("app.spec.js") == "test"
        assert infer_artifact_kind("test_main.py") == "test"

    def test_unknown_extensions(self):
        assert infer_artifact_kind("image.png") == "other"
        assert infer_artifact_kind("archive.tar.gz") == "other"

    def test_nested_paths(self):
        assert infer_artifact_kind("src/deep/nested/file.rs") == "code"


class TestCodexEventMapper:
    def test_thread_started_sets_session_id(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({"type": "thread.started", "thread_id": "t-123"})
        assert events == []
        assert mapper.session_id == "t-123"

    def test_thread_started_fallback_id(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        mapper.map_event({"type": "thread.started", "id": "fallback-id"})
        assert mapper.session_id == "fallback-id"

    def test_turn_started_increments_count(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events1 = mapper.map_event({"type": "turn.started"})
        assert len(events1) == 1
        assert events1[0].type == "status"
        assert "Turn 1 started" in events1[0].message

        events2 = mapper.map_event({"type": "turn.started"})
        assert "Turn 2 started" in events2[0].message

    def test_turn_completed_reports_usage(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "turn.completed",
            "usage": {"input_tokens": 1000, "output_tokens": 500},
        })
        assert len(events) == 1
        assert "in: 1000" in events[0].message
        assert "out: 500" in events[0].message

    def test_turn_completed_zero_usage(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({"type": "turn.completed", "usage": {}})
        assert len(events) == 1
        assert "in: 0" in events[0].message

    def test_turn_failed_emits_error(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "turn.failed",
            "error": {"message": "Rate limit exceeded"},
        })
        assert len(events) == 1
        assert events[0].type == "error"
        assert events[0].severity == "high"
        assert "Rate limit exceeded" in events[0].message
        assert events[0].recoverable is False

    def test_turn_failed_default_message(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({"type": "turn.failed"})
        assert events[0].message == "Turn failed"

    def test_command_execution_lifecycle(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")

        # Started
        started = mapper.map_event({
            "type": "item.started",
            "item_type": "command_execution",
            "item_id": "cmd-1",
            "command": "ls -la",
        })
        assert len(started) == 1
        assert started[0].type == "tool_call"
        assert started[0].tool_name == "Bash"
        assert started[0].phase == "requested"
        assert started[0].input == {"command": "ls -la"}

        # Completed
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "command_execution",
            "item_id": "cmd-1",
            "exit_code": 0,
            "output": "file1.txt\nfile2.txt",
        })
        assert len(completed) == 1
        assert completed[0].phase == "completed"
        assert completed[0].output["exit_code"] == 0
        assert completed[0].duration_ms is not None

    def test_command_execution_failed(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        mapper.map_event({
            "type": "item.started",
            "item_type": "command_execution",
            "item_id": "cmd-fail",
            "command": "npm test",
        })
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "command_execution",
            "item_id": "cmd-fail",
            "exit_code": 1,
            "output": "FAIL",
        })
        assert completed[0].phase == "failed"

    def test_command_tool_call_ids_match(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        started = mapper.map_event({
            "type": "item.started",
            "item_type": "command_execution",
            "item_id": "cmd-x",
            "command": "echo hello",
        })
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "command_execution",
            "item_id": "cmd-x",
            "exit_code": 0,
            "output": "hello",
        })
        assert started[0].tool_call_id == completed[0].tool_call_id

    def test_file_change_emits_tool_call_and_artifact(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        mapper.map_event({
            "type": "item.started",
            "item_type": "file_change",
            "item_id": "f-1",
            "file_path": "src/app.ts",
        })
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "file_change",
            "item_id": "f-1",
            "file_path": "src/app.ts",
        })
        assert len(completed) == 2
        tool_call = completed[0]
        artifact = completed[1]

        assert tool_call.type == "tool_call"
        assert tool_call.tool_name == "Edit"
        assert tool_call.phase == "completed"

        assert artifact.type == "artifact"
        assert artifact.name == "app.ts"
        assert artifact.kind == "code"
        assert artifact.workstream == "ws"
        assert artifact.status == "draft"

    def test_file_change_test_file_infers_test_kind(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        mapper.map_event({
            "type": "item.started",
            "item_type": "file_change",
            "item_id": "f-test",
            "file_path": "src/test_utils.spec.ts",
        })
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "file_change",
            "item_id": "f-test",
            "file_path": "src/test_utils.spec.ts",
        })
        artifact = completed[1]
        assert artifact.kind == "test"

    def test_agent_message_completed(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "agent_message",
            "item_id": "msg-1",
            "content": "I fixed the bug.",
        })
        assert len(events) == 1
        assert events[0].type == "status"
        assert events[0].message == "I fixed the bug."

    def test_agent_message_started_ignored(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.started",
            "item_type": "agent_message",
            "item_id": "msg-1",
        })
        assert events == []

    def test_agent_message_truncation(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        long_text = "x" * 600
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "agent_message",
            "item_id": "msg-long",
            "content": long_text,
        })
        assert len(events[0].message) == 500

    def test_agent_message_list_content(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "agent_message",
            "item_id": "msg-list",
            "content": ["part 1", "part 2"],
        })
        assert events[0].message == "part 1 part 2"

    def test_mcp_tool_call_lifecycle(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        started = mapper.map_event({
            "type": "item.started",
            "item_type": "mcp_tool_call",
            "item_id": "mcp-1",
            "tool_name": "read_file",
            "input": {"path": "README.md"},
        })
        assert len(started) == 1
        assert started[0].tool_name == "read_file"
        assert started[0].phase == "requested"

        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "mcp_tool_call",
            "item_id": "mcp-1",
            "tool_name": "read_file",
            "output": "# README",
        })
        assert len(completed) == 1
        assert completed[0].phase == "completed"
        assert completed[0].tool_name == "read_file"
        assert completed[0].output == "# README"

    def test_mcp_tool_call_ids_match(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        started = mapper.map_event({
            "type": "item.started",
            "item_type": "mcp_tool_call",
            "item_id": "mcp-x",
            "tool_name": "search",
        })
        completed = mapper.map_event({
            "type": "item.completed",
            "item_type": "mcp_tool_call",
            "item_id": "mcp-x",
        })
        assert started[0].tool_call_id == completed[0].tool_call_id

    def test_todo_list_progress(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "todo_list",
            "item_id": "todo-1",
            "items": [
                {"text": "Task A", "completed": True},
                {"text": "Task B", "completed": True},
                {"text": "Task C", "completed": False},
            ],
        })
        assert len(events) == 1
        assert events[0].type == "progress"
        assert events[0].description == "Todo: 2/3 completed"
        assert abs(events[0].progress_pct - 66.666) < 1.0

    def test_todo_list_empty(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "todo_list",
            "item_id": "todo-empty",
            "items": [],
        })
        assert len(events) == 1
        assert events[0].progress_pct == 0

    def test_todo_list_started_ignored(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.started",
            "item_type": "todo_list",
            "item_id": "todo-2",
        })
        assert events == []

    def test_reasoning_ignored(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.started",
            "item_type": "reasoning",
            "item_id": "r-1",
        })
        assert events == []
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "reasoning",
            "item_id": "r-1",
        })
        assert events == []

    def test_unknown_event_type_returns_empty(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({"type": "something.unknown"})
        assert events == []

    def test_unknown_item_type_returns_empty(self):
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "unknown_type",
            "item_id": "u-1",
        })
        assert events == []

    def test_all_events_have_correct_agent_id(self):
        mapper = CodexEventMapper(agent_id="agent-42", workstream="ws")
        mapper.map_event({"type": "turn.started"})
        events = mapper.map_event({
            "type": "item.started",
            "item_type": "command_execution",
            "item_id": "c-1",
            "command": "echo hi",
        })
        for e in events:
            assert e.agent_id == "agent-42"

    def test_full_fixture_session(self):
        """Process the entire NDJSON fixture and validate event counts/types."""
        fixture = _load_fixture("codex_session.ndjson")
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")

        all_events = []
        for data in fixture:
            all_events.extend(mapper.map_event(data))

        assert mapper.session_id == "thread-abc-123"

        types = [e.type for e in all_events]
        assert types.count("status") >= 3  # turn started, turn completed, agent message
        assert types.count("tool_call") >= 4  # cmd started/completed, file started/completed pairs
        assert types.count("artifact") >= 2  # two file changes
        assert types.count("progress") >= 1  # todo list
        assert types.count("error") >= 1  # turn.failed

    def test_orphaned_completed_gets_new_tool_call_id(self):
        """item.completed without prior item.started still produces an event."""
        mapper = CodexEventMapper(agent_id="a1", workstream="ws")
        events = mapper.map_event({
            "type": "item.completed",
            "item_type": "command_execution",
            "item_id": "orphan-1",
            "exit_code": 0,
            "output": "ok",
        })
        assert len(events) == 1
        assert events[0].tool_call_id  # has a UUID
        assert events[0].duration_ms is None  # no start_time to compute from
