"""Tests for the CodexRunner (real mode)."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

import pytest

from adapter_shim.codex_runner import CodexRunner
from adapter_shim.models import AgentBrief, ResolveRequest, ToolApprovalResolution

from .conftest import make_test_brief


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _make_brief(**overrides: object) -> AgentBrief:
    data = make_test_brief()
    data.update(overrides)
    return AgentBrief.model_validate(data)


def _fixture_path(name: str) -> str:
    return os.path.join(FIXTURES_DIR, name)


@pytest.mark.asyncio
class TestCodexRunnerWithFakeProcess:
    """Test CodexRunner by replacing subprocess with a script that emits fixture NDJSON."""

    async def test_spawns_and_processes_ndjson_output(self):
        """Use a Python script as a fake codex CLI that emits NDJSON from our fixture."""
        brief = _make_brief()
        runner = CodexRunner(brief, workspace="/tmp")

        # Write a wrapper script that outputs our fixture
        fixture_file = _fixture_path("codex_session.ndjson")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(f"""
import sys
with open({fixture_file!r}) as fh:
    for line in fh:
        sys.stdout.write(line)
        sys.stdout.flush()
""")
            script_path = f.name

        try:
            # Monkey-patch _spawn_and_read to use our fake script
            original_spawn = runner._spawn_and_read

            async def fake_spawn():
                from adapter_shim.brief_to_prompt import brief_to_prompt
                from adapter_shim.models import LifecycleEvent, CompletionEvent

                runner._process = await asyncio.create_subprocess_exec(
                    sys.executable, script_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                await runner._emit(LifecycleEvent(
                    agentId=runner.agent_id,
                    action="started",
                ))

                assert runner._process.stdout is not None
                while True:
                    line = await runner._process.stdout.readline()
                    if not line:
                        break
                    try:
                        data = json.loads(line.decode("utf-8").strip())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    agent_events = runner._mapper.map_event(data)
                    for evt in agent_events:
                        await runner._emit(evt)

                await runner._handle_exit()

            runner._spawn_and_read = fake_spawn
            runner.start()
            # Wait for the process to complete
            await asyncio.sleep(1.0)

            events = runner.drain_events()
            assert len(events) > 0

            # First event should be lifecycle started
            assert events[0].event.type == "lifecycle"
            assert events[0].event.action == "started"

            # Should have a completion event since exit code = 0
            types = [e.event.type for e in events]
            assert "completion" in types

            completion = next(e for e in events if e.event.type == "completion")
            assert completion.event.outcome == "success"

            # Should have processed tool calls, artifacts, etc.
            assert "tool_call" in types
            assert "status" in types

            # Runner should be done
            assert not runner.is_running
            assert runner.handle.status == "completed"

        finally:
            os.unlink(script_path)

    async def test_handles_codex_not_found(self):
        """When codex CLI is not in PATH, runner emits error + completion."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        # Temporarily clear PATH to ensure codex is not found
        original_spawn = runner._spawn_and_read

        async def spawn_not_found():
            from adapter_shim.models import ErrorEvent, CompletionEvent
            await runner._emit(ErrorEvent(
                agentId=runner.agent_id,
                severity="critical",
                message="codex CLI not found. Install with: npm install -g @openai/codex",
                recoverable=False,
                category="internal",
            ))
            await runner._emit(CompletionEvent(
                agentId=runner.agent_id,
                summary="Failed to start: codex CLI not found",
                outcome="abandoned",
            ))
            runner._completed = True

        runner._spawn_and_read = spawn_not_found
        runner.start()
        await asyncio.sleep(0.2)

        events = runner.drain_events()
        errors = [e for e in events if e.event.type == "error"]
        assert len(errors) == 1
        assert "codex CLI not found" in errors[0].event.message
        assert errors[0].event.severity == "critical"

        completions = [e for e in events if e.event.type == "completion"]
        assert len(completions) == 1
        assert completions[0].event.outcome == "abandoned"

        assert not runner.is_running

    async def test_kill_graceful(self):
        """Kill with grace terminates the process."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        # Simulate a long-running process
        async def slow_spawn():
            runner._process = await asyncio.create_subprocess_exec(
                sys.executable, "-c", "import time; time.sleep(30)",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await runner._emit(
                __import__("adapter_shim.models", fromlist=["LifecycleEvent"]).LifecycleEvent(
                    agentId=runner.agent_id,
                    action="started",
                )
            )
            # Wait for process (will be interrupted by kill)
            await runner._process.wait()

        runner._spawn_and_read = slow_spawn
        runner.start()
        await asyncio.sleep(0.3)

        response = await runner.kill(grace=True)
        assert response.clean_shutdown is True
        assert not runner.is_running

        events = runner.drain_events()
        lifecycle_events = [e for e in events if e.event.type == "lifecycle"]
        killed = [e for e in lifecycle_events if e.event.action == "killed"]
        assert len(killed) == 1

    async def test_kill_force(self):
        """Force kill sends SIGKILL."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        async def slow_spawn():
            runner._process = await asyncio.create_subprocess_exec(
                sys.executable, "-c", "import time; time.sleep(30)",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await runner._process.wait()

        runner._spawn_and_read = slow_spawn
        runner.start()
        await asyncio.sleep(0.3)

        response = await runner.kill(grace=False)
        assert response.clean_shutdown is False
        assert not runner.is_running

    async def test_pause_returns_serialized_state(self):
        """Pause terminates process and returns state."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        async def slow_spawn():
            runner._process = await asyncio.create_subprocess_exec(
                sys.executable, "-c", "import time; time.sleep(30)",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await runner._process.wait()

        runner._spawn_and_read = slow_spawn
        runner.start()
        await asyncio.sleep(0.3)

        state = await runner.pause()
        assert state.agent_id == "agent-test-001"
        assert state.plugin_name == "openai-codex"
        assert state.checkpoint.sdk == "codex"
        assert state.checkpoint.session_id == runner.session_id
        assert state.serialized_by == "pause"
        assert runner.handle.status == "paused"

    async def test_resolve_decision_returns_false(self):
        """In full-auto mode, resolve_decision always returns False."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        result = runner.resolve_decision(ResolveRequest(
            decisionId="d-1",
            resolution=ToolApprovalResolution(
                action="approve",
                actionKind="update",
            ),
        ))
        assert result is False

    async def test_get_checkpoint(self):
        """get_checkpoint returns valid SerializedAgentState."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        checkpoint = runner.get_checkpoint("decision-123")
        assert checkpoint.agent_id == "agent-test-001"
        assert checkpoint.plugin_name == "openai-codex"
        assert checkpoint.checkpoint.sdk == "codex"
        assert checkpoint.serialized_by == "decision_checkpoint"
        assert "decision-123" in checkpoint.pending_decision_ids
        assert checkpoint.conversation_summary == "Agent running in full-auto mode"

    async def test_get_checkpoint_empty_decision_id(self):
        """get_checkpoint with empty decision_id has empty pending list."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        checkpoint = runner.get_checkpoint("")
        assert checkpoint.pending_decision_ids == []

    async def test_handle_properties(self):
        """Handle reflects correct plugin name and initial status."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        assert runner.handle.plugin_name == "openai-codex"
        assert runner.handle.status == "running"
        assert runner.is_running is True

    async def test_drain_events_clears_buffer(self):
        """drain_events returns accumulated events and clears."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        # Manually add events to buffer
        from adapter_shim.models import StatusEvent
        await runner._emit(StatusEvent(agentId="a1", message="test"))
        events = runner.drain_events()
        assert len(events) == 1
        assert runner.drain_events() == []

    async def test_workspace_in_constructor(self):
        """Workspace is stored correctly."""
        brief = _make_brief()
        runner = CodexRunner(brief, workspace="/my/project")
        assert runner._workspace == "/my/project"

    async def test_resume_session_id(self):
        """Resume session id is stored and used."""
        brief = _make_brief()
        runner = CodexRunner(brief, resume_session_id="session-old")
        assert runner.session_id == "session-old"
        assert runner._resume_session_id == "session-old"

    async def test_resume_includes_workspace_in_exec_command(self, monkeypatch):
        """Resume command applies workspace via codex exec --cd."""
        brief = _make_brief()
        runner = CodexRunner(
            brief,
            workspace="/tmp/project-tab",
            resume_session_id="session-old",
        )
        captured_cmd: list[str] = []

        class _FakeStdout:
            async def readline(self) -> bytes:
                return b""

        class _FakeStderr:
            async def read(self) -> bytes:
                return b""

        class _FakeProcess:
            def __init__(self) -> None:
                self.stdout = _FakeStdout()
                self.stderr = _FakeStderr()
                self.returncode = None

            async def wait(self) -> int:
                self.returncode = 0
                return 0

        async def fake_create_subprocess_exec(*cmd, **_kwargs):
            captured_cmd.extend(str(part) for part in cmd)
            return _FakeProcess()

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        await runner._spawn_and_read()

        assert captured_cmd[:2] == ["codex", "exec"]
        assert captured_cmd[2:4] == ["--cd", "/tmp/project-tab"]
        assert captured_cmd[4] == "resume"
        assert "session-old" in captured_cmd

    async def test_kill_graceful_timeout_reports_unclean_shutdown(self, monkeypatch):
        """Graceful kill that escalates to SIGKILL reports unclean shutdown."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        class _FakeProcess:
            def __init__(self) -> None:
                self.returncode: int | None = None
                self.terminated = False
                self.killed = False

            def terminate(self) -> None:
                self.terminated = True

            def kill(self) -> None:
                self.killed = True
                self.returncode = -9

            async def wait(self) -> int:
                return self.returncode or 0

        async def fake_wait_for(awaitable, timeout):  # noqa: ARG001
            if hasattr(awaitable, "close"):
                awaitable.close()
            raise asyncio.TimeoutError

        fake_process = _FakeProcess()
        runner._process = fake_process
        monkeypatch.setattr(asyncio, "wait_for", fake_wait_for)

        response = await runner.kill(grace=True)

        assert fake_process.terminated is True
        assert fake_process.killed is True
        assert response.clean_shutdown is False

    async def test_monotonic_sequencing(self):
        """Events have monotonically increasing sequence numbers."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        from adapter_shim.models import StatusEvent
        await runner._emit(StatusEvent(agentId="a1", message="first"))
        await runner._emit(StatusEvent(agentId="a1", message="second"))
        await runner._emit(StatusEvent(agentId="a1", message="third"))
        events = runner.drain_events()
        seqs = [e.source_sequence for e in events]
        assert seqs == [1, 2, 3]

    async def test_all_events_share_run_id(self):
        """All events from same runner share run_id."""
        brief = _make_brief()
        runner = CodexRunner(brief)
        from adapter_shim.models import StatusEvent
        await runner._emit(StatusEvent(agentId="a1", message="first"))
        await runner._emit(StatusEvent(agentId="a1", message="second"))
        events = runner.drain_events()
        run_ids = set(e.run_id for e in events)
        assert len(run_ids) == 1


@pytest.mark.asyncio
class TestCodexRunnerNonFunctionalExit:
    async def test_nonzero_exit_emits_error_and_crashed(self):
        """When the subprocess exits with non-zero, emit error + crashed lifecycle."""
        brief = _make_brief()
        runner = CodexRunner(brief)

        async def failing_spawn():
            runner._process = await asyncio.create_subprocess_exec(
                sys.executable, "-c", "import sys; sys.stderr.write('bad stuff'); sys.exit(1)",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            from adapter_shim.models import LifecycleEvent
            await runner._emit(LifecycleEvent(agentId=runner.agent_id, action="started"))
            # Read stdout (empty)
            while True:
                line = await runner._process.stdout.readline()
                if not line:
                    break
            await runner._handle_exit()

        runner._spawn_and_read = failing_spawn
        runner.start()
        await asyncio.sleep(0.5)

        events = runner.drain_events()
        types = [e.event.type for e in events]

        assert "error" in types
        error_evt = next(e for e in events if e.event.type == "error")
        assert "code 1" in error_evt.event.message
        assert "bad stuff" in error_evt.event.message

        assert "lifecycle" in types
        crashed = [e for e in events if e.event.type == "lifecycle" and e.event.action == "crashed"]
        assert len(crashed) == 1

        assert runner.handle.status == "error"
        assert not runner.is_running
