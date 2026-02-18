import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProjectContext } from '../../lib/context.js'
import type { ProjectState } from '../../types/index.js'
import { initialState } from '../../lib/reducer.js'
import { scenarios } from '../../data/index.js'
import MapWorkspace from './MapWorkspace.js'

function renderMap(state: ProjectState = scenarios[0].state) {
  const dispatch = vi.fn()
  const result = render(
    <MemoryRouter>
      <ProjectContext value={{ state, dispatch, api: null, connected: false }}>
        <MapWorkspace />
      </ProjectContext>
    </MemoryRouter>,
  )
  return { ...result, dispatch }
}

describe('MapWorkspace', () => {
  it('shows placeholder when no project is loaded', () => {
    renderMap(initialState)
    expect(screen.getByText(/no project loaded/i)).toBeInTheDocument()
  })

  it('renders coherence tab by default', () => {
    renderMap()
    // Coherence tab should be active and show coherence score
    expect(screen.getByText('Coherence')).toBeInTheDocument()
    expect(screen.getByText('Knowledge')).toBeInTheDocument()
    expect(screen.getByText(/Coherence Score/)).toBeInTheDocument()
  })

  it('renders workstreams section', () => {
    renderMap()
    expect(screen.getByText('Workstreams')).toBeInTheDocument()
    // Maya scenario has workstreams
    expect(screen.getByText(/Post 1: Market Trends/)).toBeInTheDocument()
  })

  it('switches to knowledge tab', async () => {
    const user = userEvent.setup()
    renderMap()

    await user.click(screen.getByText('Knowledge'))
    // Knowledge tab shows artifact cards grouped by workstream
    // Maya scenario should show artifacts
    expect(screen.getByText(/post-1-market-trends.md/)).toBeInTheDocument()
  })

  it('renders active coherence issues', () => {
    // David scenario has active coherence issues
    renderMap(scenarios[1].state)
    expect(screen.getByText('Active Issues')).toBeInTheDocument()
    expect(screen.getByText(/API response format mismatch/)).toBeInTheDocument()
  })

  it('renders resolved issues section when present', () => {
    // David scenario has a resolved issue (duplicate date library)
    renderMap(scenarios[1].state)
    expect(screen.getByText('Resolved Issues')).toBeInTheDocument()
    expect(screen.getByText(/Duplicate date formatting utilities/)).toBeInTheDocument()
  })

  it('opens detail panel when clicking a workstream', async () => {
    const user = userEvent.setup()
    renderMap()

    await user.click(screen.getByText(/Post 1: Market Trends/))
    // Detail panel should appear with workstream details
    expect(screen.getByText('workstream Detail')).toBeInTheDocument()
  })

  it('opens detail panel when clicking a coherence issue', async () => {
    const user = userEvent.setup()
    renderMap(scenarios[1].state)

    await user.click(screen.getByText(/API response format mismatch between preference endpoints/))
    expect(screen.getByText('issue Detail')).toBeInTheDocument()
    expect(screen.getByText('Suggested Resolution')).toBeInTheDocument()
  })

  it('dispatches resolve-issue action from detail panel', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderMap(scenarios[1].state)

    // Click the active issue to open detail panel
    await user.click(screen.getByText(/API response format mismatch between preference endpoints/))

    // Click resolve button
    await user.click(screen.getByText('Resolve'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'resolve-issue',
      issueId: 'david-ci1',
      newStatus: 'resolved',
    })
  })

  // ── Temporal Navigation: History Mode Read-Only Tests ────────────

  it('disables issue action buttons when viewing historical state', async () => {
    const user = userEvent.setup()
    // david-ci1 has detectedAtTick: 13 and resolvedAtTick: null
    // Use viewingTick: 15 so the issue is visible (>=13) but still active (not yet resolved)
    const historyState: ProjectState = {
      ...scenarios[1].state,
      viewingTick: 15,
    }
    renderMap(historyState)

    // Click the active issue to open detail panel
    await user.click(screen.getByText(/API response format mismatch between preference endpoints/))

    // Action buttons should be disabled in history mode
    const resolveButton = screen.getByText('Resolve').closest('button')
    const acceptButton = screen.getByText('Accept').closest('button')
    const dismissButton = screen.getByText('Dismiss').closest('button')

    expect(resolveButton).toHaveAttribute('disabled')
    expect(acceptButton).toHaveAttribute('disabled')
    expect(dismissButton).toHaveAttribute('disabled')
  })

  it('shows historical state message when issue actions are disabled', async () => {
    const user = userEvent.setup()
    // david-ci1 has detectedAtTick: 13 — use viewingTick: 15 to make it visible
    const historyState: ProjectState = {
      ...scenarios[1].state,
      viewingTick: 15,
    }
    renderMap(historyState)

    // Click the active issue to open detail panel
    await user.click(screen.getByText(/API response format mismatch between preference endpoints/))

    // Should show the historical state message
    expect(screen.getByText(/Viewing historical state — actions disabled/)).toBeInTheDocument()
  })

  it('does not disable issue action buttons when in live mode', async () => {
    const user = userEvent.setup()
    // Live mode: viewingTick is null (default)
    renderMap(scenarios[1].state)

    // Click the active issue to open detail panel
    await user.click(screen.getByText(/API response format mismatch between preference endpoints/))

    // Action buttons should be enabled in live mode
    const resolveButton = screen.getByText('Resolve').closest('button')
    const acceptButton = screen.getByText('Accept').closest('button')
    const dismissButton = screen.getByText('Dismiss').closest('button')

    expect(resolveButton).not.toHaveAttribute('disabled')
    expect(acceptButton).not.toHaveAttribute('disabled')
    expect(dismissButton).not.toHaveAttribute('disabled')
  })

  it('shows cross-cutting patterns in knowledge tab when present', async () => {
    const user = userEvent.setup()
    // Rosa scenario has cross-cutting decisions
    renderMap(scenarios[3].state)

    await user.click(screen.getByText('Knowledge'))
    expect(screen.getByText('Cross-Cutting Patterns')).toBeInTheDocument()
  })

  // ── Cross-cutting decisions temporal masking ─────────────────────

  describe('cross-cutting decisions temporal masking', () => {
    it('shows a future-resolved cross-cutting decision when viewing a tick before resolution', async () => {
      const user = userEvent.setup()
      // David-d1 spans 3 workstreams, created at tick 13.
      // Mark it resolved at tick 20, then view at tick 15 where it should appear as unresolved.
      const stateWithFutureResolution: ProjectState = {
        ...scenarios[1].state,
        decisions: scenarios[1].state.decisions.map((d) =>
          d.id === 'david-d1'
            ? {
                ...d,
                resolved: true,
                resolution: {
                  chosenOptionId: 'david-d1-o1',
                  actionKind: 'approve' as const,
                  rationale: 'Consistency matters',
                  resolvedAtTick: 20,
                  reversed: false,
                },
              }
            : d,
        ),
        viewingTick: 15,
      }
      renderMap(stateWithFutureResolution)

      await user.click(screen.getByText('Knowledge'))
      // Decision resolved at tick 20 but we're viewing tick 15 -- should still appear
      expect(screen.getByText('Cross-Cutting Patterns')).toBeInTheDocument()
      expect(screen.getByText('Notification preference API response format inconsistency')).toBeInTheDocument()
    })

    it('hides a resolved cross-cutting decision when viewing a tick after resolution', async () => {
      const user = userEvent.setup()
      // Same decision resolved at tick 20, but now viewing at tick 25 (live, past resolution)
      const stateResolved: ProjectState = {
        ...scenarios[1].state,
        project: {
          ...scenarios[1].state.project!,
          currentTick: 25,
        },
        decisions: scenarios[1].state.decisions.map((d) =>
          d.id === 'david-d1'
            ? {
                ...d,
                resolved: true,
                resolution: {
                  chosenOptionId: 'david-d1-o1',
                  actionKind: 'approve' as const,
                  rationale: 'Consistency matters',
                  resolvedAtTick: 20,
                  reversed: false,
                },
              }
            : // Also resolve d2 so no other cross-cutting decisions remain
              d.id === 'david-d2'
              ? {
                  ...d,
                  resolved: true,
                  resolution: {
                    chosenOptionId: 'david-d2-o1',
                    actionKind: 'approve' as const,
                    rationale: 'Industry standard',
                    resolvedAtTick: 20,
                    reversed: false,
                  },
                }
              : d.id === 'david-d4'
                ? {
                    ...d,
                    resolved: true,
                    resolution: {
                      chosenOptionId: 'david-d4-o1',
                      actionKind: 'approve' as const,
                      rationale: 'Approved',
                      resolvedAtTick: 20,
                      reversed: false,
                    },
                  }
                : d,
        ),
        viewingTick: null, // live mode at tick 25
      }
      renderMap(stateResolved)

      await user.click(screen.getByText('Knowledge'))
      // All cross-cutting decisions are resolved before tick 25 -- section should not appear
      expect(screen.queryByText('Cross-Cutting Patterns')).not.toBeInTheDocument()
    })
  })

  // ── Knowledge Graph Visualization Tests ─────────────────────────

  describe('Knowledge Graph (DAG visualization)', () => {
    it('renders graph view for David scenario (rich DAG with 7 artifacts)', async () => {
      const user = userEvent.setup()
      // David scenario (index 1) has multiple dependency edges
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // Should render the SVG graph, not the card grid
      expect(screen.getByTestId('knowledge-graph')).toBeInTheDocument()
    })

    it('renders David scenario with workstream clusters for workstreams that have artifacts', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // David has artifacts in 3 workstreams: Database Layer, Backend Services, Frontend Components
      // Integration workstream has no artifacts, so no cluster
      expect(screen.getByTestId('workstream-cluster-Database Layer')).toBeInTheDocument()
      expect(screen.getByTestId('workstream-cluster-Backend Services')).toBeInTheDocument()
      expect(screen.getByTestId('workstream-cluster-Frontend Components')).toBeInTheDocument()
    })

    it('renders David scenario with all 7 artifact nodes', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // Check for all 7 david artifacts
      expect(screen.getByTestId('artifact-node-david-a1')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a2')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a3')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a4')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a5')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a6')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-node-david-a7')).toBeInTheDocument()
    })

    it('renders dependency edges for David scenario', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // David scenario has edges: a1->a2, a1->a3, a2->a4, a3->a6, a2->a7, a3->a7, a4->a7
      const edges = screen.getAllByTestId('dependency-edge')
      expect(edges.length).toBeGreaterThanOrEqual(7)
    })

    it('renders Maya scenario with graph view (has 1 edge: a4->a5)', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[0].state)

      await user.click(screen.getByText('Knowledge'))
      // Maya has 1 edge (maya-a4 -> maya-a5), so should render as graph
      expect(screen.getByTestId('knowledge-graph')).toBeInTheDocument()
      // Should still show maya artifact names
      expect(screen.getByText(/post-1-market-trends.md/)).toBeInTheDocument()
    })

    it('opens MapDetailPanel when clicking an artifact node', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // Click on david-a1 artifact node
      const node = screen.getByTestId('artifact-node-david-a1')
      await user.click(node)

      // Detail panel should open for this artifact
      expect(screen.getByText('artifact Detail')).toBeInTheDocument()
      // The artifact name appears in both the graph node and detail panel
      const nameMatches = screen.getAllByText('migrations/add_notifications.sql')
      expect(nameMatches.length).toBeGreaterThanOrEqual(2) // graph node + detail panel
    })

    it('highlights connected edges when a node is selected', async () => {
      const user = userEvent.setup()
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // Click david-a1 which has outgoing edges to a2 and a3
      const node = screen.getByTestId('artifact-node-david-a1')
      await user.click(node)

      // The node should be selected (accent border)
      // We can verify the node has the selected stroke by checking the rect inside
      const nodeGroup = screen.getByTestId('artifact-node-david-a1')
      const rect = nodeGroup.querySelector('rect')
      expect(rect?.getAttribute('stroke')).toBe('#6366f1')
    })

    it('keeps cross-cutting patterns above the graph', async () => {
      const user = userEvent.setup()
      // David scenario has cross-cutting decisions (decisions spanning multiple workstreams)
      renderMap(scenarios[1].state)

      await user.click(screen.getByText('Knowledge'))
      // Cross-cutting patterns section should be present
      expect(screen.getByText('Cross-Cutting Patterns')).toBeInTheDocument()
      // And the graph should also be present
      expect(screen.getByTestId('knowledge-graph')).toBeInTheDocument()
    })

    it('re-layouts graph when tick changes (tick filtering)', async () => {
      const user = userEvent.setup()
      // Create a modified David state with a lower currentTick to filter some artifacts
      const earlyDavidState = {
        ...scenarios[1].state,
        project: {
          ...scenarios[1].state.project!,
          currentTick: 5, // Only a1 (tick 3) visible, a2 (tick 6) filtered out
        },
      }
      renderMap(earlyDavidState)

      await user.click(screen.getByText('Knowledge'))
      // At tick 5, only a1 (producedAtTick=3) is visible
      // No edges exist among visible artifacts, so falls back to card grid
      expect(screen.getByTestId('knowledge-card-grid')).toBeInTheDocument()
    })

    it('shows card grid fallback when no dependency edges exist', async () => {
      const user = userEvent.setup()
      // Create a state with artifacts that have no sourceArtifactIds
      const noEdgeState: ProjectState = {
        ...scenarios[0].state,
        artifacts: scenarios[0].state.artifacts.map((a) => ({
          ...a,
          provenance: { ...a.provenance, sourceArtifactIds: [] },
        })),
      }
      renderMap(noEdgeState)

      await user.click(screen.getByText('Knowledge'))
      // With no edges, should render card grid fallback
      expect(screen.getByTestId('knowledge-card-grid')).toBeInTheDocument()
    })
  })
})
