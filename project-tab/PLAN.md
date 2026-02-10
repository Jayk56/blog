# Project Tab Prototype — Build Plan

## Vision

An intelligence briefing system for human-agent project management. The UI is
organized around **attention routing**: show the human what needs their judgment,
surface what's drifting, and keep everything else accessible but out of the way.

The prototype is standalone (React + Vite + Tailwind v4 + TypeScript) and runs
entirely on mock data. No backend. The goal is to validate the interaction model
described in the blog post — five workspaces, a persistent vital-signs strip,
and an adaptive control system that shifts between orchestrator and ecosystem
modes.

---

## Architecture

```
src/
  types/           — shared TypeScript types (project, decisions, issues, etc.)
  data/            — mock scenarios (Maya, David, Priya, Rosa, Sam)
  lib/             — pure logic: scoring, reducers, narrative generation
  components/
    Shell.tsx      — layout: vital strip + sidebar nav + routed workspace
    spine/         — VitalStrip (persistent top bar)
    briefing/      — Workspace 1: narrative catch-up view
    queue/         — Workspace 2: decision triage (master-detail)
    map/           — Workspace 3: coherence map + knowledge graph
    brief-editor/  — Workspace 4: intent specification editor
    controls/      — Workspace 5: mode selector, trust, review patterns
    shared/        — reusable pieces (severity badges, sparklines, etc.)
```

State is managed via `useReducer` at the Shell level and passed down through
context. No external state library for the prototype.

---

## Milestones

### M0 — Scaffolding ✅
- [x] Vite + React + TS + Tailwind v4 project
- [x] Directory structure
- [x] Shell with sidebar nav, routed workspaces, VitalStrip placeholder
- [x] Build passes

### M1 — Type System & Mock Data ✅
Core types and at least three scenario datasets.

- [x] **types/project.ts** — `Project`, `ProjectPhase`, `ControlMode`,
      `RiskProfile`, `Severity`
- [x] **types/decisions.ts** — `DecisionItem`, `DecisionOption`, `ActionKind`,
      `DecisionType`
- [x] **types/coherence.ts** — `CoherenceIssue`, `CoherenceCategory`,
      `CoherenceStatus`
- [x] **types/artifacts.ts** — `Artifact`, `ArtifactKind`, `Provenance`
- [x] **types/trust.ts** — `TrustProfile`, `TrustSnapshot` (for trajectories)
- [x] **types/timeline.ts** — `TimelineEvent`, `DecisionLogEntry`
- [x] **types/control.ts** — `Checkpoint`, `ModeShiftRecommendation`,
      `ControlTopologyPoint`
- [x] **types/metrics.ts** — `Metrics`, `ReviewPattern`
- [x] **types/state.ts** — `ProjectState`, `ProjectAction` (reducer action union)
- [x] **data/scenarios.ts** — Maya (content studio), David (SaaS team),
      Priya (portfolio PM) scenarios with full mock data
- [x] **data/scenarios.ts** — Rosa (research) and Sam (consultant) scenarios
      (can be lighter — used for Map and Brief Editor demos)

### M2 — State Engine ✅
Reducer, scoring functions, narrative builder.

- [x] **lib/reducer.ts** — projectReducer handling: load-scenario, advance-tick,
      resolve-decision, resolve-issue, set-mode, set-bias, emergency-brake,
      inject-context, reverse-decision, retroactive-review, toggle-checkpoint,
      accept/reject-recommendation
- [x] **lib/scoring.ts** — attention priority, coherence score, rework risk,
      trust score, high-severity miss rate, human intervention rate
- [x] **lib/narrative.ts** — `buildBriefing()` that generates multi-paragraph
      narrative summaries from project state (what changed, what needs attention,
      what agents did autonomously)
- [x] **lib/topology.ts** — `getRecommendedPosition()` that maps phase + risk +
      domain expertise + team maturity → position on orchestrator/ecosystem
      spectrum
- [x] **lib/context.ts** — React context provider wrapping the reducer + derived
      values (scores, narrative, recommendation)
- [x] Unit tests for scoring and reducer

### M3 — Vital Strip (Spine) ✅
The persistent header that's always visible.

- [x] Live-wired to project state: narrative one-liner, coherence score with
      trend arrow, rework risk, decision count, current mode badge
- [x] Emergency brake button (dispatches action, shows paused state)
- [x] Scenario switcher dropdown
- [x] Simulation controls (advance tick, auto-simulate toggle)
- [x] Tick counter display

### M4 — Briefing Workspace ✅
Narrative-first view for catching up.

- [x] Multi-paragraph briefing generated from `buildBriefing()`
- [x] "Since last visit" framing — what changed, what agents did, what's blocked
- [x] Action summary card: N decisions awaiting, N coherence issues, link to
      Queue and Map
- [x] Recent agent activity feed (from decision log, filtered to agent/system
      entries)
- [ ] Per-project briefing when multiple projects are loaded (stretch: portfolio
      view with collapsible per-project summaries)

### M5 — Decision Queue Workspace ✅
Master-detail layout for triage.

- [x] Left panel: decision list sorted by attention priority
  - [x] Each item shows: title, severity badge, confidence bar, blast radius
        indicator, due/overdue status
  - [x] Visual distinction for recommended option
  - [ ] Filter/sort controls (by severity, type, due date)
- [x] Right panel: selected decision detail
  - [x] Full summary and context
  - [x] Confidence gauge (visual bar, not just a number)
  - [x] Blast radius visualization (dot scale or radial)
  - [x] Affected artifacts with provenance links
  - [x] Option cards showing label + consequence inline
  - [x] Rationale text area (required/optional based on decision config)
  - [x] Action buttons for each option (recommended one highlighted)
- [x] Provenance drawer (slide-over): triggered from artifact links
  - [x] Shows: source inputs, producer agent, validators, reviewer, related
        decisions
- [x] Empty state: "Queue is clear" with summary of last decisions made
- [ ] Consequence preview: downstream effects shown when hovering/expanding
      an option

### M6 — Map Workspace ✅
Two sub-views: Coherence Map and Knowledge Map.

- [x] **Tab bar** at top: [Coherence] [Knowledge]
- [x] **Coherence Map** (default) — using structured list fallback
  - [x] Structured list: workstream health grid + active/resolved issue cards
  - [x] Color coding: green (healthy), amber (warning), red (blocked)
  - [x] Click issue → side panel showing coherence issue detail with
        resolve/accept/dismiss actions
  - [x] Click workstream → side panel showing agents, artifacts, trust info
  - [x] Severity-based visual weight (border colors by severity)
  - [ ] Graph visualization upgrade (deferred — list fallback is sufficient)
- [x] **Knowledge Map** (Rosa-inspired) — using tagged card grid fallback
  - [x] Artifact cards grouped by workstream
  - [x] Cross-cutting pattern highlighting for multi-workstream decisions
  - [x] Click artifact → detail panel with provenance and source info
  - [ ] "Create exploration task" action from node context
- [x] **Fallback**: coherence view as structured list, knowledge view as tagged
      card grid. The *data model* matters more than the visual for the prototype.

### M7 — Brief Editor Workspace ✅
Intent specification editor.

- [x] Project brief display: goals, constraints, routing rules
- [x] Constraints section
  - [x] List of active constraints with source attribution (manual vs.
        accumulated from decisions)
  - [x] Add constraint form
  - [ ] Toggle constraint on/off
- [ ] Routing rules section
  - [ ] "When [trigger], route to [human/agent/escalate]"
  - [ ] Add/edit/remove rules
- [x] Active agents panel
  - [x] List of agents on this project with trust score + role
  - [x] Link to trust trajectory in Controls workspace
- [x] Checkpoints section
  - [x] Toggleable checkpoint gates (phase transition, high-risk touch,
        before merge, daily summary)
- [ ] Brief versioning (stretch): show diff of brief at different ticks

### M8 — Controls Workspace ✅
Configuration + system introspection.

- [x] **Control mode selector**: Orchestrator / Adaptive / Ecosystem buttons
      with description of each
- [x] **Control topology visualization**: the spectrum bars from the blog post
  - [x] By phase, by risk level, by domain expertise, by team maturity
  - [x] "You are here" indicator based on current project state
  - [x] System recommendation with accept/override
- [x] **Throughput vs. Quality dial**: slider with labeled endpoints
- [x] **Trust trajectories panel**
  - [x] Per-agent sparkline showing trust score over time (by tick/session)
  - [x] Current score + trend indicator (up/down/stable)
  - [x] Success/override/rework breakdown
- [x] **Review pattern analysis** (the mirror)
  - [x] "You review X% of code outputs, Y% of doc outputs"
  - [x] Rework rate by category
  - [x] System suggestion: "You could reduce doc reviews to Z%"
- [ ] **Risk-aware gating toggle**
- [x] **Decision log** (moved here from being its own panel)
  - [x] Timestamped history of all decisions (human, agent, system)
  - [x] Reversal action on reversible entries
  - [x] Retroactive review flag
  - [x] Context injection input

### M9 — Polish & Cross-Cutting

**From visual review (2026-02-09):**

- [ ] **VitalStrip overflow at <900px** — "Project Tab" wraps, metrics stack,
      Brake button clips off-screen. Needs responsive collapse (hide project
      name, abbreviate metrics, or wrap to two rows).
- [ ] **Emergency brake confirmation** — one-click halt with no "are you sure?"
      feels risky for the most destructive action. Add a confirmation step
      (hold-to-confirm, or a brief modal).
- [ ] **Briefing visual hierarchy** — all five narrative paragraphs are the same
      weight/style. The "morning newspaper" feel needs: larger opening line,
      card treatment for attention items, muted tone for agent activity section.
- [ ] **Queue: empty rationale display** — resolved decisions show
      `Rationale: ` (empty) when none was provided. Should omit the line or
      show "No rationale provided."
- [ ] **Map: empty space on Coherence tab** — the workstream grid leaves a lot
      of dead space below when there's only 1 issue. Consider a summary or
      health sparklines to fill the space.
- [ ] **Knowledge Map: artifact dependency edges** — artifacts are grouped by
      workstream but have no visual connections. Provenance data (sourceInputs)
      exists to draw dependency lines between related artifacts.
- [ ] **Throughput/Quality slider feedback** — moving the slider doesn't
      indicate what review gates change. Add a preview or label update showing
      the practical effect.
- [ ] **Transition animations** — workspace switches are instant, drawer
      appears/disappears without slide, decisions pop out of the list without
      fade. Add CSS transitions for drawer slide-in, card removal, workspace
      fade.
- [ ] **Sidebar hover feedback** — inactive nav items don't have enough hover
      feedback. Add a subtle bg highlight on hover for non-active items.
- [ ] **Review Patterns: generic suggestions** — "appears appropriate" for every
      scenario is too generic. Make suggestions scenario-aware (e.g., for
      David's 50% code review rate, note his low rework supports it).

**Original M9 items:**

- [ ] **Temporal navigation**: tick scrubber that lets you step through project
      history and see state-at-point-in-time across all workspaces
- [ ] **Keyboard shortcuts**: j/k for navigating decision list, Enter for
      expanding detail, Esc for closing drawers
- [ ] **Responsive behavior**: collapse sidebar to icons-only (already is),
      stack panels vertically on narrow viewports
- [ ] **Metrics export**: download session metrics as JSON
- [ ] **Dark mode refinement**: ensure contrast ratios meet WCAG AA
- [ ] Accessibility: focus management, ARIA labels, keyboard-navigable
      decision options

---

## Workspace ↔ Interaction Mode Mapping

| Workspace      | Interaction Mode | Primary Question                          |
|----------------|------------------|-------------------------------------------|
| Briefing       | Catch up         | "What happened while I was away?"         |
| Queue          | Triage           | "What needs my judgment right now?"       |
| Map            | Diagnose         | "Why is something off?"                   |
| Brief Editor   | Direct           | "Here's what I want to happen"            |
| Controls       | Configure        | "Here's how I want the system to operate" |

## Control Mode ↔ UI Behavior

| Aspect                | Orchestrator              | Ecosystem                   |
|-----------------------|---------------------------|-----------------------------|
| Default workspace     | Queue (decisions to make) | Briefing (what happened)    |
| Decision flow         | Dense queue, review all   | Sparse, selective review    |
| Interrupt behavior    | Pull (check queue)        | Push (system interrupts)    |
| Coherence monitoring  | Manual review at gates    | Continuous automated scan   |
| Emergency brake       | Rarely needed             | Essential safety net        |

---

## Open Design Questions

1. **Graph library choice for Map workspace.** react-flow is full-featured but
   heavy. A minimal SVG renderer is lighter but more work. d3-force is flexible
   but harder to integrate with React. Decision: start with the list/card
   fallback, upgrade to graph if the prototype warrants it.

2. **Multi-project portfolio view.** The blog post personas work across 3-6
   projects simultaneously. The current plan is single-project. A portfolio
   landing page that summarizes all projects and lets you drill in is a natural
   extension but adds significant scope. Decision: defer to a stretch goal
   after M8.

3. **Notification/interrupt system.** The Ecosystem model depends on push
   notifications. In a prototype without real agents, this could be simulated
   via timeline events that trigger toast-like interrupts. Worth prototyping
   but not blocking.

4. **Temporal navigation UX.** A tick scrubber is simple but the question is
   what exactly "rewind" means — do you see the full state at that tick, or
   just the diff? Full state replay is more powerful but requires the reducer
   to support snapshots. Decision: start with the decision log as history,
   add scrubber in M9 if time allows.

---

## Tech Stack

| Layer       | Choice             | Rationale                              |
|-------------|--------------------|----------------------------------------|
| Framework   | React 19 + TS      | Match existing blog editor stack       |
| Bundler     | Vite               | Fast dev, already in use               |
| Styling     | Tailwind CSS v4    | Utility-first, custom theme tokens     |
| Routing     | React Router v7    | Workspace navigation                   |
| Icons       | Lucide React       | Consistent with editor, tree-shakeable |
| State       | useReducer+Context | Sufficient for prototype complexity    |
| Graph (opt) | List/card fallback  | Chose structured list over graph lib   |
| Testing     | Vitest             | Vite-native, fast                      |

---

## File Inventory (current)

```
project-tab/
├── PLAN.md                ← this file
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts         ← includes vitest config
├── eslint.config.js
└── src/
    ├── App.tsx             ← BrowserRouter + ProjectProvider + Shell route
    ├── App.test.tsx
    ├── App.css             ← empty (Tailwind handles styling)
    ├── index.css           ← Tailwind import + theme tokens
    ├── main.tsx            ← React root
    ├── test/
    │   └── setup.ts        ← vitest setup (testing-library matchers)
    ├── types/
    │   ├── index.ts        ← barrel export for all types
    │   ├── project.ts      ← Project, ProjectPhase, ControlMode, RiskProfile, Severity
    │   ├── decisions.ts    ← DecisionItem, DecisionOption, ActionKind, DecisionType
    │   ├── coherence.ts    ← CoherenceIssue, CoherenceCategory, CoherenceStatus
    │   ├── artifacts.ts    ← Artifact, ArtifactKind, Provenance
    │   ├── trust.ts        ← TrustProfile, TrustSnapshot
    │   ├── timeline.ts     ← TimelineEvent, DecisionLogEntry
    │   ├── control.ts      ← Checkpoint, ModeShiftRecommendation, ControlTopologyPoint
    │   ├── metrics.ts      ← Metrics, ReviewPattern
    │   └── state.ts        ← ProjectState, ProjectAction (reducer action union)
    ├── data/
    │   ├── index.ts        ← barrel export
    │   └── scenarios.ts    ← Maya, David, Priya, Rosa, Sam scenario datasets
    ├── lib/
    │   ├── index.ts        ← barrel export for all lib modules
    │   ├── reducer.ts      ← projectReducer + initialState
    │   ├── reducer.test.ts
    │   ├── scoring.ts      ← attention priority, coherence, rework risk, trust, metrics
    │   ├── scoring.test.ts
    │   ├── narrative.ts    ← buildBriefing(), buildOneLiner()
    │   ├── narrative.test.ts
    │   ├── topology.ts     ← getRecommendedPosition(), positionToMode()
    │   ├── topology.test.ts
    │   └── context.ts      ← ProjectContext, useProject, useProjectState, useProjectDispatch
    └── components/
        ├── Shell.tsx        ← sidebar nav + VitalStrip + routed workspaces
        ├── Shell.test.tsx
        ├── ProjectProvider.tsx ← useReducer + scenario loader + context provider
        ├── spine/
        │   ├── VitalStrip.tsx  ← persistent header: metrics, scenario switcher, sim controls, brake
        │   └── VitalStrip.test.tsx
        ├── briefing/
        │   ├── BriefingWorkspace.tsx       ← main container
        │   ├── BriefingWorkspace.test.tsx
        │   ├── NarrativeBriefing.tsx       ← multi-paragraph briefing with markdown bold
        │   ├── ActionSummary.tsx           ← decision/issue count cards with links
        │   └── ActivityFeed.tsx            ← recent timeline events feed
        ├── queue/
        │   ├── QueueWorkspace.tsx          ← master-detail layout
        │   ├── QueueWorkspace.test.tsx     ← queue workspace tests
        │   ├── DecisionList.tsx            ← left panel: sorted decision list
        │   ├── DecisionDetail.tsx          ← right panel: full context + action buttons
        │   └── ProvenanceDrawer.tsx        ← slide-over artifact lineage view
        ├── map/
        │   ├── MapWorkspace.tsx            ← tab container (coherence/knowledge)
        │   ├── MapWorkspace.test.tsx
        │   ├── CoherenceMap.tsx            ← structured list: issues + workstream health grid
        │   ├── KnowledgeMap.tsx            ← tagged card grid: artifacts by workstream
        │   └── MapDetailPanel.tsx          ← side panel for issues, workstreams, artifacts
        ├── brief-editor/
        │   ├── BriefEditorWorkspace.tsx    ← main container
        │   ├── BriefEditorWorkspace.test.tsx ← brief editor workspace tests
        │   ├── ProjectBrief.tsx            ← goals and description display
        │   ├── ConstraintsSection.tsx      ← constraint list + add form
        │   ├── CheckpointsSection.tsx      ← toggleable checkpoint gates
        │   └── AgentsPanel.tsx             ← agent roster with trust scores
        ├── controls/
        │   ├── ControlsWorkspace.tsx       ← main container
        │   ├── ControlsWorkspace.test.tsx  ← controls workspace tests
        │   ├── ModeSelector.tsx            ← orchestrator/adaptive/ecosystem + recommendations
        │   ├── ControlTopology.tsx         ← spectrum bars (phase, risk, expertise, maturity)
        │   ├── QualityDial.tsx             ← throughput vs quality slider
        │   ├── TrustTrajectories.tsx       ← per-agent sparklines + breakdown
        │   ├── ReviewPatterns.tsx          ← the "mirror" — review behavior analysis
        │   └── DecisionLog.tsx            ← decision history + reversal/review/context
        └── shared/
            └── SeverityBadge.tsx           ← colored severity pill
```
