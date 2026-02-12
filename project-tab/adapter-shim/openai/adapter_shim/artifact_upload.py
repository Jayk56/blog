"""Artifact upload helper for uploading content to the backend on ArtifactEvents."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from .models import AdapterEvent, ArtifactEvent


def get_bootstrap_config() -> dict[str, Any] | None:
    """Parse the AGENT_BOOTSTRAP env var if present."""
    raw = os.environ.get("AGENT_BOOTSTRAP")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def get_artifact_upload_endpoint() -> str | None:
    """Get the artifact upload endpoint from bootstrap config."""
    config = get_bootstrap_config()
    if config and "artifactUploadEndpoint" in config:
        return config["artifactUploadEndpoint"]
    return None


async def upload_artifact_content(
    endpoint: str,
    agent_id: str,
    artifact_id: str,
    content: str = "",
    mime_type: str | None = None,
) -> str | None:
    """Upload artifact content to the backend, return backendUri or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload: dict[str, Any] = {
                "agentId": agent_id,
                "artifactId": artifact_id,
                "content": content,
            }
            if mime_type:
                payload["mimeType"] = mime_type

            response = await client.post(endpoint, json=payload)
            if response.status_code == 201:
                data = response.json()
                return data.get("backendUri")
    except Exception:
        # Best-effort: if upload fails, we still forward the event with original URI
        pass
    return None


async def rewrite_artifact_uri(event: AdapterEvent, endpoint: str) -> AdapterEvent:
    """If the event contains an ArtifactEvent, upload content and rewrite the URI."""
    inner = event.event
    if not isinstance(inner, ArtifactEvent):
        return event

    backend_uri = await upload_artifact_content(
        endpoint=endpoint,
        agent_id=inner.agent_id,
        artifact_id=inner.artifact_id,
        content="",  # Mock mode has no real content
        mime_type=inner.mime_type,
    )

    if backend_uri:
        # Create a copy with rewritten URI
        updated_inner = inner.model_copy(update={"uri": backend_uri})
        return event.model_copy(update={"event": updated_inner})

    return event
