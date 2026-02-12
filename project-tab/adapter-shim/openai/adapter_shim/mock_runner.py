"""Mock agent runner that emits a scripted sequence of events.

The scripted sequence is:
  1. LifecycleEvent(started)
  2. StatusEvent("Starting task...")
  3. ToolCallEvent(requested) -> ToolCallEvent(running) -> ToolCallEvent(completed)
  4. DecisionEvent(tool_approval) -- then WAIT for POST /resolve
  5. After resolve: ArtifactEvent
  6. CompletionEvent(success)
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from .events import EventFactory
from .models import (
    AgentBrief,
    AgentHandle,
    ArtifactEvent,
    CompletionEvent,
    KillResponse,
    LifecycleEvent,
    Provenance,
    ResolveRequest,
    SerializedAgentState,
    StatusEvent,
    ToolApprovalEvent,
    ToolCallEvent,
)

if TYPE_CHECKING:
    from .models import AdapterEvent


class MockRunner:
    """Runs a scripted mock agent that emits events over time."""

    PLUGIN_NAME = "openai-mock"

    def __init__(self, brief: AgentBrief) -> None:
        self.brief = brief
        self.agent_id = brief.agent_id
        self.session_id = str(uuid.uuid4())
        self._factory = EventFactory(run_id=str(uuid.uuid4()))
        self._status: AgentHandle = AgentHandle(
            id=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            status="running",
            sessionId=self.session_id,
        )
        self._event_buffer: list[AdapterEvent] = []
        self._ws_connected = False
        self._decision_future: asyncio.Future[ResolveRequest] | None = None
        self._pending_decision_id: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._killed = False
        self._completed = False

    @property
    def handle(self) -> AgentHandle:
        return self._status

    @property
    def is_running(self) -> bool:
        return not self._killed and not self._completed

    def start(self) -> None:
        """Start the mock event sequence in the background."""
        self._task = asyncio.create_task(self._run_script())

    async def _emit(self, event: object) -> None:
        """Wrap and buffer an event."""
        adapter_event = self._factory.wrap(event)  # type: ignore[arg-type]
        self._event_buffer.append(adapter_event)

    async def _run_script(self) -> None:
        """Execute the scripted event sequence."""
        try:
            # Step 1: LifecycleEvent(started)
            await self._emit(LifecycleEvent(
                agentId=self.agent_id,
                action="started",
            ))
            await asyncio.sleep(0.1)

            if self._killed:
                return

            # Step 2: StatusEvent
            await self._emit(StatusEvent(
                agentId=self.agent_id,
                message="Starting task...",
            ))
            await asyncio.sleep(0.1)

            if self._killed:
                return

            # Step 3: ToolCallEvent sequence
            tool_call_id = str(uuid.uuid4())
            await self._emit(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="file_search",
                phase="requested",
                input={"query": "project requirements"},
                approved=True,
            ))
            await asyncio.sleep(0.05)

            await self._emit(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="file_search",
                phase="running",
                input={"query": "project requirements"},
                approved=True,
            ))
            await asyncio.sleep(0.1)

            await self._emit(ToolCallEvent(
                agentId=self.agent_id,
                toolCallId=tool_call_id,
                toolName="file_search",
                phase="completed",
                input={"query": "project requirements"},
                output={"results": ["requirements.md"]},
                approved=True,
                durationMs=150,
            ))
            await asyncio.sleep(0.05)

            if self._killed:
                return

            # Step 4: DecisionEvent(tool_approval) -- wait for resolve
            decision_id = str(uuid.uuid4())
            self._pending_decision_id = decision_id
            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="waiting_on_human",
                sessionId=self.session_id,
            )

            await self._emit(ToolApprovalEvent(
                agentId=self.agent_id,
                decisionId=decision_id,
                toolName="execute_code",
                toolArgs={"code": "print('hello world')", "language": "python"},
                severity="medium",
                confidence=0.85,
                blastRadius="small",
            ))

            # Create a future and wait for resolution
            loop = asyncio.get_running_loop()
            self._decision_future = loop.create_future()
            try:
                await self._decision_future
            except asyncio.CancelledError:
                return

            self._pending_decision_id = None
            self._decision_future = None

            if self._killed:
                return

            # Step 5: After resolve -- ArtifactEvent
            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="running",
                sessionId=self.session_id,
            )

            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            artifact_id = str(uuid.uuid4())
            await self._emit(ArtifactEvent(
                agentId=self.agent_id,
                artifactId=artifact_id,
                name="report.md",
                kind="document",
                workstream=self.brief.workstream,
                status="draft",
                qualityScore=0.9,
                provenance=Provenance(
                    createdBy=self.agent_id,
                    createdAt=now_iso,
                ),
                uri="/workspace/output/report.md",
                mimeType="text/markdown",
                sizeBytes=1024,
            ))
            await asyncio.sleep(0.05)

            if self._killed:
                return

            # Step 6: CompletionEvent(success)
            await self._emit(CompletionEvent(
                agentId=self.agent_id,
                summary="Mock task completed successfully. Generated report.md.",
                artifactsProduced=[artifact_id],
                decisionsNeeded=[],
                outcome="success",
            ))

            self._status = AgentHandle(
                id=self.agent_id,
                pluginName=self.PLUGIN_NAME,
                status="completed",
                sessionId=self.session_id,
            )
            self._completed = True

        except asyncio.CancelledError:
            pass

    def resolve_decision(self, request: ResolveRequest) -> bool:
        """Resolve a pending decision. Returns True if resolved."""
        if (
            self._decision_future is not None
            and not self._decision_future.done()
            and request.decision_id == self._pending_decision_id
        ):
            self._decision_future.set_result(request)
            return True
        return False

    async def kill(self, grace: bool = True) -> KillResponse:
        """Kill the mock agent."""
        self._killed = True
        if self._decision_future and not self._decision_future.done():
            self._decision_future.cancel()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        await self._emit(LifecycleEvent(
            agentId=self.agent_id,
            action="killed",
            reason="kill requested" + (" (graceful)" if grace else " (force)"),
        ))

        self._status = AgentHandle(
            id=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            status="completed",
            sessionId=self.session_id,
        )

        return KillResponse(
            state=None,
            artifactsExtracted=0,
            cleanShutdown=grace,
        )

    async def pause(self) -> SerializedAgentState:
        """Pause the mock agent and return serialized state."""
        self._killed = True
        if self._decision_future and not self._decision_future.done():
            self._decision_future.cancel()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
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
        from .models import SdkCheckpoint

        return SerializedAgentState(
            agentId=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            sessionId=self.session_id,
            checkpoint=SdkCheckpoint(
                sdk="mock",
                scriptPosition=self._factory.last_sequence,
            ),
            briefSnapshot=self.brief,
            pendingDecisionIds=[self._pending_decision_id] if self._pending_decision_id else [],
            lastSequence=self._factory.last_sequence,
            serializedAt=now_iso,
            serializedBy="pause",
            estimatedSizeBytes=256,
        )

    def get_checkpoint(self, decision_id: str) -> SerializedAgentState:
        """Return a checkpoint snapshot without stopping the agent."""
        now_iso = datetime.now(timezone.utc).isoformat()
        from .models import SdkCheckpoint

        return SerializedAgentState(
            agentId=self.agent_id,
            pluginName=self.PLUGIN_NAME,
            sessionId=self.session_id,
            checkpoint=SdkCheckpoint(
                sdk="mock",
                scriptPosition=self._factory.last_sequence,
            ),
            briefSnapshot=self.brief,
            conversationSummary="Agent blocked on decision",
            pendingDecisionIds=[decision_id] if decision_id else [],
            lastSequence=self._factory.last_sequence,
            serializedAt=now_iso,
            serializedBy="decision_checkpoint",
            estimatedSizeBytes=256,
        )

    def drain_events(self) -> list[AdapterEvent]:
        """Drain all buffered events."""
        events = list(self._event_buffer)
        self._event_buffer.clear()
        return events
