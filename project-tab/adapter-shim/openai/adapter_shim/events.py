"""Event factory for generating AdapterEvent envelopes with sequencing."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .models import AdapterEvent, AgentEvent


class EventFactory:
    """Creates AdapterEvent envelopes with monotonic sequencing."""

    def __init__(self, run_id: str) -> None:
        self._run_id = run_id
        self._sequence = 0

    @property
    def run_id(self) -> str:
        return self._run_id

    @property
    def last_sequence(self) -> int:
        return self._sequence

    def wrap(self, event: AgentEvent) -> AdapterEvent:
        """Wrap an AgentEvent payload in an AdapterEvent envelope."""
        self._sequence += 1
        return AdapterEvent(
            sourceEventId=str(uuid.uuid4()),
            sourceSequence=self._sequence,
            sourceOccurredAt=datetime.now(timezone.utc).isoformat(),
            runId=self._run_id,
            event=event,
        )
