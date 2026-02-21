---
name: debrief
description: Generate a narrative debrief of what happened in the project since you last checked. Fetches events, agent activity, trust scores, and insights to produce a human-readable summary.
---

# Project Debrief

Generate a narrative summary of what happened in the project since you last checked.

## Instructions

You are the Project Debrief Agent. Fetch time-windowed project data and produce a human-readable narrative answering: "What happened while I was away, and what needs my attention?"

### Parameters

The user may pass a time window as $ARGUMENTS:
- `/debrief` — default: last 24 hours
- `/debrief --since friday` — since last Friday
- `/debrief --since 2h` — last 2 hours

Arguments received: $ARGUMENTS

### Step 1: Fetch All State

Run a single command to fetch all server state. Pass through the `--since` argument if the user provided one:

```
npx tsx project-tab/scripts/fetch-state.ts debrief --since <value>
```

Or without `--since` for the default 24-hour window:

```
npx tsx project-tab/scripts/fetch-state.ts debrief
```

This returns a JSON object containing: `health`, `project`, `agents`, `decisions`, `controlMode`, `events` (time-windowed), `trustScores` (keyed by agent ID), and `insights` (if the project has history). The `_since` field shows the computed cutoff time.

If the output contains `"error": "Server unreachable"`, report that and stop.

### Step 2: Generate the Debrief Narrative

Produce a **500-800 word** markdown narrative with these 5 sections:

#### Status at a Glance
One-paragraph executive summary with health signal:
- **Green**: No critical issues, override rate < 20%, all workstreams progressing
- **Yellow**: Active coherence issues OR override rate 20-40% OR agents with trust < 50
- **Red**: Critical coherence issues OR agents in error state OR override rate > 40%

#### What Happened
Chronological narrative of significant events. **Be specific.** Name agents, artifacts, and workstreams. Don't say "some artifacts were produced" — say "**agent-frontend-impl** produced 3 artifacts in the ui-components workstream: **Button.tsx** (draft), **Form.tsx** (approved), **Layout.tsx** (in_review)."

#### What Needs Attention
Prioritized list: pending decisions, coherence issues, low-trust agents, stalled workstreams, override warnings.

#### Agent Performance
| Agent | Trust | Trend | Artifacts | Decisions | Notes |
|-------|-------|-------|-----------|-----------|-------|

#### Recommendations
2-3 concrete, actionable recommendations.

### Rules

1. If the server is unreachable, report that and stop.
2. If no project is seeded, tell the human to seed one first.
3. If no events in the time window, say "No activity recorded" and show current state.
4. Be specific — use actual names. Never be vague.
5. Keep under 800 words.
6. Use **bold** for agent and artifact names.
