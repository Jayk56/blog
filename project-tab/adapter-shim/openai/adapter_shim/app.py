"""FastAPI application implementing the adapter shim wire protocol."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .artifact_upload import get_artifact_upload_endpoint, rewrite_artifact_uri
from .codex_runner import CodexRunner
from .mock_runner import MockRunner
from .models import (
    AgentBrief,
    AgentHandle,
    ContextInjection,
    KillRequest,
    KillResponse,
    ResolveRequest,
    SandboxHealthResponse,
    SandboxResourceUsage,
    SerializedAgentState,
)

MAX_EVENT_BUFFER = 1000


def create_app(*, mock: bool = False, workspace: str | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="OpenAI Adapter Shim", version="0.1.0")

    state = AppState(mock=mock, workspace=workspace)

    @app.get("/health")
    async def health() -> dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        uptime_ms = int((time.monotonic() - state.start_time) * 1000)
        agent_status: str = "running"
        if state.runner:
            agent_status = state.runner.handle.status
        else:
            agent_status = "completed"

        response = SandboxHealthResponse(
            status="healthy",
            agentStatus=agent_status,
            uptimeMs=uptime_ms,
            resourceUsage=SandboxResourceUsage(
                cpuPercent=0.0,
                memoryMb=0.0,
                diskMb=0.0,
                collectedAt=now_iso,
            ),
            pendingEventBufferSize=len(state.event_buffer),
        )
        return response.model_dump(by_alias=True)

    @app.post("/spawn")
    async def spawn(brief: AgentBrief) -> dict:
        if state.runner is not None and state.runner.is_running:
            raise HTTPException(status_code=409, detail="Agent already running")

        if state.mock:
            runner: MockRunner | CodexRunner = MockRunner(brief)
        else:
            runner = CodexRunner(brief, workspace=state.workspace)
        state.runner = runner
        runner.start()

        # Give the runner a moment to emit initial events
        await asyncio.sleep(0.05)

        return runner.handle.model_dump(by_alias=True)

    @app.post("/kill")
    async def kill(request: KillRequest | None = None) -> dict:
        if state.runner is None:
            raise HTTPException(status_code=404, detail="No agent running")

        grace = request.grace if request else True
        response = await state.runner.kill(grace=grace)
        # Drain final events into the shared buffer
        _drain_to_buffer(state)
        return response.model_dump(by_alias=True)

    @app.post("/pause")
    async def pause() -> dict:
        if state.runner is None:
            raise HTTPException(status_code=404, detail="No agent running")

        serialized = await state.runner.pause()
        _drain_to_buffer(state)
        return serialized.model_dump(by_alias=True)

    @app.post("/resume")
    async def resume(agent_state: SerializedAgentState) -> dict:
        brief = agent_state.brief_snapshot
        if state.mock:
            runner: MockRunner | CodexRunner = MockRunner(brief)
        else:
            resume_session_id = agent_state.session_id
            runner = CodexRunner(
                brief,
                workspace=state.workspace,
                resume_session_id=resume_session_id,
            )
        state.runner = runner
        runner.start()
        await asyncio.sleep(0.05)
        return runner.handle.model_dump(by_alias=True)

    @app.post("/resolve")
    async def resolve(request: ResolveRequest) -> dict:
        if state.runner is None:
            raise HTTPException(status_code=404, detail="No agent running")

        resolved = state.runner.resolve_decision(request)
        if not resolved:
            raise HTTPException(
                status_code=404,
                detail=f"No pending decision with id {request.decision_id}",
            )
        # Give the runner time to process the resolution and emit events
        await asyncio.sleep(0.2)
        return {"status": "resolved", "decisionId": request.decision_id}

    @app.post("/checkpoint")
    async def checkpoint(request: dict) -> dict:
        if state.runner is None:
            raise HTTPException(status_code=404, detail="No agent running")

        decision_id = request.get("decisionId", "")
        serialized = state.runner.get_checkpoint(decision_id)
        return serialized.model_dump(by_alias=True)

    # Only expose debug config endpoint in mock mode
    if mock:
        @app.get("/debug/config")
        async def debug_config() -> dict:
            if state.runner is None:
                return {"providerConfig": None}
            provider_config = state.runner.brief.provider_config
            return {"providerConfig": provider_config}

    @app.post("/inject-context")
    async def inject_context(injection: ContextInjection) -> dict:
        # Plumbing only in Phase 1 -- accept but don't act
        return {"status": "accepted"}

    @app.post("/update-brief")
    async def update_brief(changes: dict) -> dict:
        if state.runner is None:
            raise HTTPException(status_code=404, detail="No agent running")
        # Store pending changes on handle; applied on next spawn/resume cycle
        current = state.runner.handle
        state.runner._status = AgentHandle(
            id=current.id,
            pluginName=current.plugin_name,
            status=current.status,
            sessionId=current.session_id,
            pendingBriefChanges=changes,
        )
        return {"status": "accepted"}

    @app.websocket("/events")
    async def events_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        state.ws_connected = True
        upload_endpoint = get_artifact_upload_endpoint()

        try:
            while True:
                # Drain events from the runner into the shared buffer
                _drain_to_buffer(state)

                # Send all buffered events
                while state.event_buffer:
                    event = state.event_buffer.pop(0)
                    # Rewrite artifact URIs if upload endpoint is configured
                    if upload_endpoint:
                        event = await rewrite_artifact_uri(event, upload_endpoint)
                    await websocket.send_json(
                        event.model_dump(by_alias=True, exclude_none=True)
                    )

                # Check if the runner is done and no more events
                if state.runner and not state.runner.is_running and not state.event_buffer:
                    # Wait briefly for any final events
                    await asyncio.sleep(0.1)
                    _drain_to_buffer(state)
                    while state.event_buffer:
                        event = state.event_buffer.pop(0)
                        if upload_endpoint:
                            event = await rewrite_artifact_uri(event, upload_endpoint)
                        await websocket.send_json(
                            event.model_dump(by_alias=True, exclude_none=True)
                        )

                await asyncio.sleep(0.05)
        except WebSocketDisconnect:
            state.ws_connected = False
        except Exception:
            state.ws_connected = False

    return app


class AppState:
    """Mutable application state shared across endpoints."""

    def __init__(self, *, mock: bool = False, workspace: str | None = None) -> None:
        self.mock = mock
        self.workspace = workspace
        self.runner: MockRunner | CodexRunner | None = None
        self.event_buffer: list = []
        self.ws_connected = False
        self.start_time = time.monotonic()


def _drain_to_buffer(state: AppState) -> None:
    """Move events from the runner's internal buffer to the shared buffer."""
    if state.runner is None:
        return
    events = state.runner.drain_events()
    state.event_buffer.extend(events)
    # Cap buffer size
    if len(state.event_buffer) > MAX_EVENT_BUFFER:
        state.event_buffer = state.event_buffer[-MAX_EVENT_BUFFER:]
