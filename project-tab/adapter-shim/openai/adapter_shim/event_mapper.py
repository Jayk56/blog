"""Map Codex CLI NDJSON events to wire protocol AgentEvent objects."""

from __future__ import annotations

import os.path
import uuid
from datetime import datetime, timezone
from typing import Any

from .models import (
    ArtifactEvent,
    ArtifactKind,
    ErrorEvent,
    AgentEvent,
    ProgressEvent,
    Provenance,
    StatusEvent,
    ToolCallEvent,
)


def infer_artifact_kind(file_path: str) -> ArtifactKind:
    """Infer artifact kind from file extension."""
    base = os.path.basename(file_path)
    _, ext = os.path.splitext(base)
    ext = ext.lower()

    # Test files
    if ".test." in base or ".spec." in base or base.startswith("test_"):
        return "test"

    if ext in (".ts", ".js", ".py", ".rs", ".go", ".java", ".tsx", ".jsx"):
        return "code"
    if ext in (".md", ".txt", ".rst"):
        return "document"
    if ext in (".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"):
        return "config"
    return "other"


class CodexEventMapper:
    """Stateful mapper that converts Codex NDJSON lines into AgentEvent objects."""

    def __init__(self, agent_id: str, workstream: str) -> None:
        self.agent_id = agent_id
        self.workstream = workstream
        self.session_id: str | None = None
        self._turn_count = 0
        self._open_tool_calls: dict[str, dict[str, Any]] = {}

    def map_event(self, data: dict[str, Any]) -> list[AgentEvent]:
        """Map a parsed NDJSON object to zero or more AgentEvents."""
        event_type = data.get("type", "")
        events: list[AgentEvent] = []

        if event_type == "thread.started":
            self.session_id = data.get("thread_id") or data.get("id")
            return events

        if event_type == "turn.started":
            self._turn_count += 1
            events.append(StatusEvent(
                agentId=self.agent_id,
                message=f"Turn {self._turn_count} started",
            ))
            return events

        if event_type == "turn.completed":
            usage = data.get("usage", {})
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)
            events.append(StatusEvent(
                agentId=self.agent_id,
                message=f"Turn completed (in: {input_tokens}, out: {output_tokens} tokens)",
            ))
            return events

        if event_type == "turn.failed":
            error_msg = data.get("error", {}).get("message", "Turn failed")
            events.append(ErrorEvent(
                agentId=self.agent_id,
                severity="high",
                message=error_msg,
                recoverable=False,
                category="model",
            ))
            return events

        if event_type in ("item.started", "item.completed"):
            return self._handle_item(event_type, data)

        return events

    def _handle_item(self, event_type: str, data: dict[str, Any]) -> list[AgentEvent]:
        """Handle item.started and item.completed events.

        Codex nests item fields under data["item"], e.g.:
            {"type": "item.started", "item": {"id": "item_2", "type": "command_execution", ...}}
        """
        events: list[AgentEvent] = []
        # Unwrap nested item object (real Codex format)
        item = data.get("item", {})
        item_type = item.get("type", data.get("item_type", ""))
        item_id = item.get("id", data.get("item_id", data.get("id", "")))

        if item_type == "reasoning":
            return events

        if item_type == "command_execution":
            return self._handle_command(event_type, item_id, data)

        if item_type == "file_change":
            return self._handle_file_change(event_type, item_id, data)

        if item_type == "agent_message":
            if event_type == "item.completed":
                text = item.get("text", item.get("content", data.get("content", data.get("text", ""))))
                if isinstance(text, list):
                    text = " ".join(str(t) for t in text)
                if len(text) > 500:
                    text = text[:497] + "..."
                events.append(StatusEvent(
                    agentId=self.agent_id,
                    message=text,
                ))
            return events

        if item_type == "mcp_tool_call":
            return self._handle_mcp_tool(event_type, item_id, data)

        if item_type == "todo_list":
            if event_type == "item.completed":
                items = item.get("items", data.get("items", []))
                done = sum(1 for i in items if i.get("completed", False))
                total = len(items)
                pct = (done / total * 100) if total > 0 else 0
                events.append(ProgressEvent(
                    agentId=self.agent_id,
                    operationId=item_id or str(uuid.uuid4()),
                    description=f"Todo: {done}/{total} completed",
                    progressPct=pct,
                ))
            return events

        return events

    def _handle_command(self, event_type: str, item_id: str, data: dict[str, Any]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        item = data.get("item", data)
        if event_type == "item.started":
            tool_call_id = str(uuid.uuid4())
            command = item.get("command", data.get("command", data.get("input", {}).get("command", "")))
            self._open_tool_calls[item_id] = {
                "tool_call_id": tool_call_id,
                "tool_name": "Bash",
                "start_time": datetime.now(timezone.utc),
            }
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="Bash",
                phase="requested",
                input={"command": command},
                approved=True,
            ))
        elif event_type == "item.completed":
            tc = self._open_tool_calls.pop(item_id, None)
            tool_call_id = tc["tool_call_id"] if tc else str(uuid.uuid4())
            exit_code = item.get("exit_code", data.get("exit_code", data.get("status", 0)))
            duration_ms = None
            if tc:
                elapsed = (datetime.now(timezone.utc) - tc["start_time"]).total_seconds()
                duration_ms = int(elapsed * 1000)
            phase = "completed" if exit_code == 0 else "failed"
            output = item.get("aggregated_output", item.get("output", data.get("output", data.get("stdout", ""))))
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="Bash",
                phase=phase,
                output={"stdout": output, "exit_code": exit_code},
                approved=True,
                durationMs=duration_ms,
            ))
        return events

    def _handle_file_change(self, event_type: str, item_id: str, data: dict[str, Any]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        item = data.get("item", data)
        file_path = item.get("file_path", item.get("path", data.get("file_path", data.get("path", ""))))
        if event_type == "item.started":
            tool_call_id = str(uuid.uuid4())
            self._open_tool_calls[item_id] = {
                "tool_call_id": tool_call_id,
                "tool_name": "Edit",
                "start_time": datetime.now(timezone.utc),
                "file_path": file_path,
            }
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="Edit",
                phase="requested",
                input={"file_path": file_path},
                approved=True,
            ))
        elif event_type == "item.completed":
            tc = self._open_tool_calls.pop(item_id, None)
            tool_call_id = tc["tool_call_id"] if tc else str(uuid.uuid4())
            fp = file_path or (tc.get("file_path", "") if tc else "")
            duration_ms = None
            if tc:
                elapsed = (datetime.now(timezone.utc) - tc["start_time"]).total_seconds()
                duration_ms = int(elapsed * 1000)
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="Edit",
                phase="completed",
                input={"file_path": fp},
                output={"success": True},
                approved=True,
                durationMs=duration_ms,
            ))
            # Also emit ArtifactEvent
            if fp:
                now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                events.append(ArtifactEvent(
                    agentId=self.agent_id,
                    artifactId=str(uuid.uuid4()),
                    name=os.path.basename(fp),
                    kind=infer_artifact_kind(fp),
                    workstream=self.workstream,
                    status="draft",
                    qualityScore=0.5,
                    provenance=Provenance(
                        createdBy=self.agent_id,
                        createdAt=now_iso,
                    ),
                    uri=fp,
                ))
        return events

    def _handle_mcp_tool(self, event_type: str, item_id: str, data: dict[str, Any]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        item = data.get("item", data)
        tool_name = item.get("tool_name", item.get("name", data.get("tool_name", data.get("name", "mcp_tool"))))
        if event_type == "item.started":
            tool_call_id = str(uuid.uuid4())
            self._open_tool_calls[item_id] = {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "start_time": datetime.now(timezone.utc),
            }
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName=tool_name,
                phase="requested",
                input=item.get("input", item.get("arguments", data.get("input", data.get("arguments", {})))),
                approved=True,
            ))
        elif event_type == "item.completed":
            tc = self._open_tool_calls.pop(item_id, None)
            tool_call_id = tc["tool_call_id"] if tc else str(uuid.uuid4())
            duration_ms = None
            if tc:
                elapsed = (datetime.now(timezone.utc) - tc["start_time"]).total_seconds()
                duration_ms = int(elapsed * 1000)
            events.append(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName=tc["tool_name"] if tc else tool_name,
                phase="completed",
                output=item.get("output", item.get("result", data.get("output", data.get("result", None)))),
                approved=True,
                durationMs=duration_ms,
            ))
        return events
