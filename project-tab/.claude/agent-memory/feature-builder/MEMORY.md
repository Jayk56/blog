# Feature Builder Agent Memory

## Project Tab Frontend (`project-tab/`)

### Build/Run Commands
- TypeScript check: `cd /Users/jayk/Code/blog/project-tab && npx tsc --noEmit`
- Run tests: `cd /Users/jayk/Code/blog/project-tab && npx vitest run`
- Dev server: `cd /Users/jayk/Code/blog/project-tab && npm run dev`

### Key File Locations
- Types: `src/types/` with barrel `src/types/index.ts`
- Decision types: `src/types/decisions.ts` (DecisionItem has optional subtype, toolArgs, reasoning)
- Artifact types: `src/types/artifacts.ts` (ArtifactKind: code, document, design, data, test, configuration, research, decision_record)
- Scenario mock data: `src/data/scenarios.ts` (5 scenarios: maya, david, priya, rosa, sam)
- Queue components: `src/components/queue/`
- Map components: `src/components/map/` (MapWorkspace, CoherenceMap, KnowledgeMap, MapDetailPanel, ArtifactNode, DependencyEdge, WorkstreamCluster)
- Context provider: `src/lib/context.ts` (ProjectContext, useProjectState, useProjectDispatch, useApi)
- State adapter: `src/services/state-adapter.ts` (adaptFrontendResolution)
- CSS tokens: `src/index.css` (dark theme, @theme block with custom colors)

### Test Patterns (Frontend)
- Uses `@testing-library/react` + `userEvent.setup()` + `MemoryRouter`
- Test helper: `renderWithContext(state, dispatch)` wraps in `ProjectContext`
- `noUnusedLocals: true` in tsconfig -- unused imports cause build errors
- `EventCategory` type does NOT include 'tool_approval' -- use 'decision_created' for tool approval events
- SVG text in jsdom: accessible via getByText, but names appear in both graph nodes and detail panels (use getAllByText)
- React SVG: `<text>` does NOT support `textTransform` attribute -- use `style={{ textTransform: 'uppercase' }}`

### Knowledge Graph Component Architecture
- Custom DAG layout (no dagre) -- topological sort + rank assignment + horizontal positioning
- Workstreams side-by-side, artifacts ranked by dependency depth within each
- Fallback: card grid when no dependency edges exist among visible artifacts
- Tick filtering: `producedAtTick <= effectiveTick` (uses `currentTick`, ready for `useEffectiveTick`)
- David scenario: 7 artifacts, 7 edges, 3 workstreams with artifacts (ws-integration has none)
- Maya scenario: 5 artifacts, 1 edge (maya-a4 -> maya-a5)

## Project Tab Server

### Test Patterns
- Tests use `vitest` with `describe/it/expect` pattern
- HTTP route tests use `fetch` directly (no supertest) with `createServer` and port allocation
- Use `vi.useFakeTimers()` for time-dependent tests; `Date.now()` is frozen in fake timer mode
- EventBus deduplicates events by `sourceEventId` -- synthetic events need unique IDs (include counter)
- Test port ranges: 9300+ for route wiring tests, 9500+ for quarantine tests

### Build/Run Commands
- Run tests: `cd project-tab/server && npx vitest run`
- Run single test: `cd project-tab/server && npx vitest run test/path/to/test.ts`
- No supertest dependency; use native fetch + express + createServer pattern

### Codebase Patterns
- Event pipeline: WS message -> JSON.parse -> validateAdapterEvent (Zod) -> quarantine/EventEnvelope -> EventBus.publish
- Synthetic events use sourceSequence: -1, special runId prefix, and category: 'internal'
- Routes follow factory pattern: `createXxxRouter(deps)` returning Router
- Routes wired in `src/routes/index.ts` via `createApiRouter(deps)`
- Quarantine is in-memory (module-scoped array), not persisted

### Temporal Navigation
- `viewingTick: number | null` on ProjectState (null = live)
- `useEffectiveTick()` hook in `src/lib/context.ts` -- returns viewingTick ?? currentTick
- All workspace filtering uses effectiveTick: timeline (BriefingWorkspace), decisions (QueueWorkspace), coherence issues (CoherenceMap), trust trajectories (TrustTrajectories), overdue badge (DecisionDetail)
- TrustTrajectories: when effectiveTick is set and clippedTrajectory is empty, displayScore=null renders "no data at this tick" (never falls back to live profile values)
- DecisionDetail: overdue comparison uses `effectiveTick ?? state.project.currentTick` (prop threaded from QueueWorkspace)
- TypeScript check command: `npx tsc --noEmit -p tsconfig.app.json` (use tsconfig.app.json, not bare --noEmit)
- VitalStrip has range slider + live/history indicator
- Advance-tick and auto-simulate disabled when viewing history
- Reducer: advance-tick and load-scenario reset viewingTick to null
- Adding new fields to ProjectState: must also add to all 5 scenario objects in `src/data/scenarios.ts`
- Decision createdAtTick values in David scenario: d1=13, d2=12, d3=14, d4=14, d5=14

### Inline Edit Index Testing Nuance
- When testing index-based editing with mocked dispatch, state doesn't change (items stay in list)
- The "delete item currently being edited cancels edit" case is NOT directly testable via UI: when in edit mode, that item renders input+Save+Cancel (no Remove button visible)
- Instead test: delete-above-shifts-index and delete-below-no-change, both are UI-reachable
- While editing item[i], getAllByTitle('Remove goal/constraint') skips the edited item (it shows no Remove button), so indexes shift by 1

### History Mode Read-Only Pattern
- `state.viewingTick !== null` = "viewing historical state" -- expose as `isHistorical` local var in component
- Components using `useProjectState()` can read `viewingTick` directly -- no prop threading needed
- DecisionDetail: disable resolve buttons with `disabled={isHistorical || otherCondition}`, disable textarea with `disabled={isHistorical}`
- CoherenceMap IssueDetail (in MapDetailPanel.tsx): add `disabled={isHistorical}` to Resolve/Accept/Dismiss buttons
- DecisionLog: disable Inject Context, Reverse, Flag buttons; add info paragraph when isHistorical
- ModeSelector: disable all 3 mode buttons + Accept/Dismiss recommendation buttons; add info paragraph
- QualityDial: disable range slider input
- ProjectBrief: disable Add goal, Edit goal, Remove goal buttons; make description paragraph non-clickable when historical
- ConstraintsSection: disable Add, Edit constraint, Remove constraint buttons
- CheckpointsSection: disable toggle buttons
- Reducer `set-viewing-tick`: spread `...(action.tick !== null ? { autoSimulate: false } : {})` to stop timer race
- david-ci1 detectedAtTick: 13 -- use viewingTick >= 13 in tests to make it visible
- Maya decision createdAtTick: d1=7, d2=6, d3=8
- When multiple components show the same "Viewing historical state" message, use `getAllByText` not `getByText` in tests

### QueueWorkspace Selection Pattern
- `filteredDecisions` useMemo must be declared BEFORE any `useEffect` that reads it (React const TDZ rules)
- Selection cleanup: use intersection against `filteredDecisions` (covers tick changes, filter changes, resolution in one effect)
- Pattern: `useEffect(() => { const visibleIds = new Set(filteredDecisions.map(d => d.id)); setSelectedIds(prev => { ... return next.size === prev.size ? prev : next }) }, [filteredDecisions])`
- The `prev` identity shortcut (return prev if size unchanged) prevents unnecessary re-renders
- David scenario severity: d1=high(90), d2=high(82), d4=high(80), d5=medium(58), d3=low(25)

### Temporal Masking Patterns
- QueueWorkspace: `tickFilteredDecisions` useMemo filters by `createdAtTick <= effectiveTick`, then maps resolved decisions with `resolvedAtTick > effectiveTick` back to unresolved
- KnowledgeMap cross-cutting: same pattern -- `isUnresolvedAtTick = !d.resolved || (d.resolution?.resolvedAtTick != null && d.resolution.resolvedAtTick > effectiveTick)`
- Server-state-sync: preserves `viewingTick` (along with `autoSimulate`, `activeScenarioId`) and local brief edits (`description`, `goals`, `constraints`)

### Known Issues
- Pre-existing: adapter-shim/claude/test/claude-runner.test.ts fails at mock setup for node:child_process
- Pre-existing: e2e/smoke.test.ts has race condition when run in full suite
