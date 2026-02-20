"""Convert an AgentBrief into a prompt string for the Codex CLI."""

from __future__ import annotations

from .models import AgentBrief


def brief_to_prompt(brief: AgentBrief, *, continuation: bool = False) -> str:
    """Render an AgentBrief as a structured prompt string for codex exec."""
    sections: list[str] = []

    if continuation:
        sections.append(
            "Your previous assignment is complete. Here is your next assignment:\n"
        )

    sections.append(f'You are a {brief.role} working on the "{brief.workstream}" workstream.')
    sections.append(brief.description)

    # Project
    pb = brief.project_brief
    sections.append(f"\n## Project\n{pb.title}: {pb.description}")

    # Goals
    if pb.goals:
        goals = "\n".join(f"- {g}" for g in pb.goals)
        sections.append(f"\n## Goals\n{goals}")

    # Constraints
    constraints = brief.constraints or []
    if pb.constraints:
        constraints = constraints + pb.constraints
    if constraints:
        cons = "\n".join(f"- {c}" for c in constraints)
        sections.append(f"\n## Constraints\n{cons}")

    # Knowledge snapshot summary
    ks = brief.knowledge_snapshot
    if ks and ks.estimated_tokens > 0:
        parts: list[str] = []
        if ks.workstreams:
            parts.append(f"{len(ks.workstreams)} active workstream(s)")
        if ks.pending_decisions:
            parts.append(f"{len(ks.pending_decisions)} pending decision(s)")
        if ks.artifact_index:
            parts.append(f"{len(ks.artifact_index)} artifact(s)")
        if parts:
            sections.append(f"\n## Context\n{', '.join(parts)}.")

    result = "\n".join(sections)
    # Rough cap at ~2000 tokens (~8000 chars)
    if len(result) > 8000:
        result = result[:7997] + "..."
    return result
