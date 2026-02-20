"""Real runner that spawns the Codex CLI and maps its NDJSON output."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from .brief_to_prompt import brief_to_prompt
from .event_mapper import CodexEventMapper
from .events import EventFactory
from .models import (
    AgentBrief,
    AgentHandle,
    CompletionEvent,
    ErrorEvent,
    KillResponse,
    LifecycleEvent,
    ResolveRequest,
    SdkCheckpoint,
    SerializedAgentState,
)

if TYPE_CHECKING:
    from .models import AdapterEvent


class CodexRunner:
    """Runs the Codex CLI and maps its streaming NDJSON output to wire protocol events."""

    PLUGIN_NAME = "openai-codex"

    def __init__(
        self,
        brief: AgentBrief,
        *,
        workspace: str | None = None,
        resume_session_id: str | None = None,
        continuation: bool = False,
    ) -> None:
        self.brief = brief
        self.agent_id = brief.agent_id
        self.session_id = resume_session_id or str(uuid.uuid4())
        self._workspace = workspace
        self._resume_session_id = resume_session_id
        self._continuation = continuation
        self._factory = EventFactory(run_id=str(uuid.uuid4()))
        self._mapper = CodexEventMapper(agent_id=self.agent_id, workstream=brief.workstream)
        self._status = AgentHandle(
            id=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            status="running",
            sessionId=self.session_id,
        )
        self._event_buffer: list[AdapterEvent] = []
        self._process: asyncio.subprocess.Process | None = None
        self._read_task: asyncio.Task[None] | None = None
        self._killed = False
        self._completed = False

    @property
    def handle(self) -> AgentHandle:
        return self._status

    @property
    def is_running(self) -> bool:
        return not self._killed and not self._completed

    def start(self) -> None:
        """Spawn the Codex CLI subprocess and begin reading output."""
        self._read_task = asyncio.create_task(self._spawn_and_read())

    async def _emit(self, event: object) -> None:
        adapter_event = self._factory.wrap(event)  # type: ignore[arg-type]
        self._event_buffer.append(adapter_event)

    async def _spawn_and_read(self) -> None:
        prompt = brief_to_prompt(self.brief, continuation=self._continuation)

        if self._resume_session_id:
            cmd = ["codex", "exec"]
            if self._workspace:
                cmd.extend(["--cd", self._workspace])
            cmd.extend([
                "resume", self._resume_session_id,
                "--full-auto", "--json", prompt,
            ])
        else:
            cmd = ["codex", "exec", "--full-auto", "--json"]
            if self._workspace:
                cmd.extend(["--cd", self._workspace])
            cmd.append(prompt)

        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            await self._emit(ErrorEvent(
                agentId=self.agent_id,
                severity="critical",
                message="codex CLI not found. Install with: npm install -g @openai/codex",
                recoverable=False,
                category="internal",
            ))
            await self._emit(CompletionEvent(
                agentId=self.agent_id,
                summary="Failed to start: codex CLI not found",
                outcome="abandoned",
            ))
            self._completed = True
            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="error",
                sessionId=self.session_id,
            )
            return

        # Emit lifecycle started
        await self._emit(LifecycleEvent(
            agentId=self.agent_id,
            action="started",
        ))

        # Read stdout line by line
        assert self._process.stdout is not None
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            try:
                data = json.loads(line.decode("utf-8").strip())
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            agent_events = self._mapper.map_event(data)
            for evt in agent_events:
                await self._emit(evt)

            # Update session_id if mapper extracted one
            if self._mapper.session_id and self.session_id != self._mapper.session_id:
                self.session_id = self._mapper.session_id
                self._status = AgentHandle(
                    id=self.agent_id,
                    pluginName=self.PLUGIN_NAME,
                    status="running",
                    sessionId=self.session_id,
                )

        await self._handle_exit()

    async def _handle_exit(self) -> None:
        if self._process is None:
            return
        exit_code = await self._process.wait()
        if exit_code == 0:
            await self._emit(CompletionEvent(
                agentId=self.agent_id,
                summary="Codex session completed successfully",
                outcome="success",
            ))
            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="completed",
                sessionId=self.session_id,
            )
        else:
            # Read stderr for error details
            stderr_text = ""
            if self._process.stderr:
                stderr_bytes = await self._process.stderr.read()
                stderr_text = stderr_bytes.decode("utf-8", errors="replace")[:500]
            await self._emit(ErrorEvent(
                agentId=self.agent_id,
                severity="high",
                message=f"Codex exited with code {exit_code}" + (f": {stderr_text}" if stderr_text else ""),
                recoverable=False,
                category="internal",
            ))
            await self._emit(LifecycleEvent(
                agentId=self.agent_id,
                action="crashed",
                reason=f"Exit code {exit_code}",
            ))
            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="error",
                sessionId=self.session_id,
            )
        self._completed = True

    def resolve_decision(self, request: ResolveRequest) -> bool:
        """No-op in v1 (full-auto mode)."""
        return False

    async def kill(self, grace: bool = True) -> KillResponse:
        self._killed = True
        forced = not grace
        if self._process and self._process.returncode is None:
            if grace:
                self._process.terminate()
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    forced = True
                    self._process.kill()
                    await self._process.wait()
            else:
                self._process.kill()
                await self._process.wait()

        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass

        await self._emit(LifecycleEvent(
            agentId=self.agent_id,
            action="killed",
            reason="kill requested" + (" (graceful)" if not forced else " (force)"),
        ))
        self._status = AgentHandle(
            id=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            status="completed",
            sessionId=self.session_id,
        )
        self._completed = True
        return KillResponse(state=None, artifactsExtracted=0, cleanShutdown=not forced)

    async def pause(self) -> SerializedAgentState:
        self._killed = True
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()

        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass

        await self._emit(LifecycleEvent(
            agentId=self.agent_id,
            action="paused",
        ))
        self._status = AgentHandle(
            id=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            status="paused",
            sessionId=self.session_id,
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        return SerializedAgentState(
            agentId=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            sessionId=self.session_id,
            checkpoint=SdkCheckpoint(
                sdk="codex",
                sessionId=self.session_id,
            ),
            briefSnapshot=self.brief,
            pendingDecisionIds=[],
            lastSequence=self._factory.last_sequence,
            serializedAt=now_iso,
            serializedBy="pause",
            estimatedSizeBytes=512,
        )

    def get_checkpoint(self, decision_id: str) -> SerializedAgentState:
        now_iso = datetime.now(timezone.utc).isoformat()
        return SerializedAgentState(
            agentId=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            sessionId=self.session_id,
            checkpoint=SdkCheckpoint(
                sdk="codex",
                sessionId=self.session_id,
            ),
            briefSnapshot=self.brief,
            conversationSummary="Agent running in full-auto mode",
            pendingDecisionIds=[decision_id] if decision_id else [],
            lastSequence=self._factory.last_sequence,
            serializedAt=now_iso,
            serializedBy="decision_checkpoint",
            estimatedSizeBytes=512,
        )

    def drain_events(self) -> list[AdapterEvent]:
        events = list(self._event_buffer)
        self._event_buffer.clear()
        return events
