import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import QueueWorkspace from './QueueWorkspace'
import { ProjectContext, type ProjectContextValue } from '../../lib/context.js'
import type { ProjectState } from '../../types/index.js'
import { initialState } from '../../lib/reducer.js'
import { scenarios } from '../../data/index.js'

// -- Helpers ----------------------------------------------------------

function renderWithContext(
  state: ProjectState = initialState,
  dispatch = vi.fn(),
) {
  const value: ProjectContextValue = { state, dispatch, api: null, connected: false }
  return {
    dispatch,
    ...render(
      <MemoryRouter>
        <ProjectContext value={value}>
          <QueueWorkspace />
        </ProjectContext>
      </MemoryRouter>,
    ),
  }
}

const mayaState = scenarios[0].state
const davidState = scenarios[1].state

// -- Tests ------------------------------------------------------------

describe('QueueWorkspace', () => {
  it('shows placeholder when no project is loaded', () => {
    renderWithContext()
    expect(screen.getByText('No project loaded')).toBeInTheDocument()
  })

  it('renders the decision list with pending decisions', () => {
    renderWithContext(mayaState)
    // Maya has 3 pending decisions
    expect(screen.getByText(/pending/)).toBeInTheDocument()
    expect(screen.getByText(/sorted by priority/)).toBeInTheDocument()
  })

  it('shows decision titles in the list', () => {
    renderWithContext(mayaState)
    // Titles appear in both the list and detail panel
    expect(screen.getAllByText(/Conflicting market size data for Post 4/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Post 2 metaphor doesn't match brand voice/).length).toBeGreaterThan(0)
  })

  it('auto-selects the highest priority decision', () => {
    renderWithContext(mayaState)
    // The highest priority decision (maya-d1, score 85) should be shown in detail
    expect(screen.getByText(/Two reputable sources disagree/)).toBeInTheDocument()
  })

  it('shows decision detail with options when a decision is selected', () => {
    renderWithContext(mayaState)
    // Maya d1 options -- labels appear on option cards
    expect(screen.getAllByText(/Use Gartner/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Use IDC/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Cite both with context/).length).toBeGreaterThan(0)
  })

  it('shows severity badges on decisions', () => {
    renderWithContext(mayaState)
    // Maya d1 is severity high
    const highBadges = screen.getAllByText('high')
    expect(highBadges.length).toBeGreaterThan(0)
  })

  it('shows confidence percentage', () => {
    renderWithContext(mayaState)
    // Maya d1 has confidence 0.65 = 65% -- appears in list and detail
    const confidenceElements = screen.getAllByText('65%')
    expect(confidenceElements.length).toBeGreaterThan(0)
  })

  it('shows "Queue is clear" when all decisions are resolved', () => {
    const clearedState: ProjectState = {
      ...mayaState,
      decisions: mayaState.decisions.map(d => ({
        ...d,
        resolved: true,
        resolution: { chosenOptionId: d.options[0].id, actionKind: 'approve' as const, rationale: 'test', resolvedAtTick: 1, reversed: false },
      })),
    }
    renderWithContext(clearedState)
    // Right panel shows "Queue is clear" when no pending decisions
    const clearMessages = screen.getAllByText('Queue is clear')
    expect(clearMessages.length).toBeGreaterThan(0)
  })

  it('shows recommended badge on recommended options', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('recommended')).toBeInTheDocument()
  })

  it('shows rationale field as required when decision requires it', () => {
    renderWithContext(mayaState)
    // Maya d1 has requiresRationale: true
    expect(screen.getByText('Rationale (required)')).toBeInTheDocument()
  })

  it('dispatches resolve-decision when an option is clicked with rationale', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)

    // Fill in the rationale first (d1 requires it)
    const textarea = screen.getByPlaceholderText('Why did you choose this option?')
    await user.type(textarea, 'Conservative approach is safer')

    // Click the recommended option button
    const optionButtons = screen.getAllByRole('button', { name: /Use Gartner/i })
    // The one inside the detail panel (not the list item)
    const resolveButton = optionButtons[optionButtons.length - 1]
    await user.click(resolveButton)

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resolve-decision',
      decisionId: 'maya-d1',
      chosenOptionId: 'maya-d1-o1',
      actionKind: 'approve',
    }))
  })

  it('disables option buttons when rationale is required but empty', () => {
    renderWithContext(mayaState)
    // Maya d1 requires rationale - buttons should be disabled when textarea is empty
    const buttons = screen.getAllByRole('button')
    const optionButtons = buttons.filter(b =>
      b.textContent?.includes('Use Gartner') ||
      b.textContent?.includes('Use IDC') ||
      b.textContent?.includes('Cite both')
    )
    // Filter to the ones in the detail panel (they have disabled prop)
    const disabledButtons = optionButtons.filter(b => b.hasAttribute('disabled'))
    expect(disabledButtons.length).toBeGreaterThan(0)
  })

  it('shows affected artifacts with provenance links', () => {
    renderWithContext(mayaState)
    // Maya d1 affects artifacts maya-a4 and maya-a5
    expect(screen.getByText('post-4-research.md')).toBeInTheDocument()
    expect(screen.getByText('post-4-outline.md')).toBeInTheDocument()
  })

  it('shows blast radius information', () => {
    renderWithContext(mayaState)
    // Maya d1 has blast radius magnitude 'medium'
    expect(screen.getByText('Blast Radius')).toBeInTheDocument()
    const mediumElements = screen.getAllByText(/medium/i)
    expect(mediumElements.length).toBeGreaterThan(0)
  })

  it('shows overdue status for overdue decisions', () => {
    // Create a state where a decision is overdue
    const overdueState: ProjectState = {
      ...davidState,
      project: { ...davidState.project!, currentTick: 20 },
    }
    renderWithContext(overdueState)
    // David d2 has dueByTick: 15, so at tick 20 it should show overdue
    const overdueElements = screen.getAllByText(/overdue/i)
    expect(overdueElements.length).toBeGreaterThan(0)
  })

  // -- Part 1: Tool Approval Mock Data Tests --------------------------

  it('David scenario has 5 pending decisions including tool_approval', () => {
    renderWithContext(davidState)
    // David has 5 pending decisions (3 option + 2 tool_approval)
    expect(screen.getByText(/5 pending/)).toBeInTheDocument()
  })

  it('shows tool_approval decisions in the David queue', () => {
    renderWithContext(davidState)
    expect(screen.getByText(/Agent requests: Run database migration script/)).toBeInTheDocument()
    expect(screen.getByText(/Agent requests: Write WebSocket config file/)).toBeInTheDocument()
  })

  // -- Part 2: Filter Bar Tests ---------------------------------------

  it('renders collapsible filter bar with Filters toggle', () => {
    renderWithContext(mayaState)
    expect(screen.getByRole('button', { name: /toggle filters/i })).toBeInTheDocument()
  })

  it('expands filter bar to show severity chips and type dropdown', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)

    // Expand filters
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))

    // Severity chips should be visible
    const severityLabel = screen.getByText('Severity')
    expect(severityLabel).toBeInTheDocument()

    // Should have severity filter buttons
    expect(screen.getByRole('button', { name: /filter by critical severity/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter by high severity/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter by medium severity/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter by low severity/i })).toBeInTheDocument()

    // Type dropdown should be visible
    expect(screen.getByRole('combobox', { name: /filter by decision type/i })).toBeInTheDocument()

    // Show resolved checkbox
    expect(screen.getByRole('checkbox', { name: /show resolved/i })).toBeInTheDocument()
  })

  it('filters by severity when chips are toggled', async () => {
    const user = userEvent.setup()
    renderWithContext(davidState)

    // David has 5 pending: 3 high, 1 medium, 1 low
    expect(screen.getByText(/5 pending/)).toBeInTheDocument()

    // Expand filters
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))

    // Deactivate high severity
    await user.click(screen.getByRole('button', { name: /filter by high severity/i }))

    // Should show only medium + low (2 decisions)
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()
  })

  it('filters by subtype using dropdown', async () => {
    const user = userEvent.setup()
    renderWithContext(davidState)

    // David has 5 pending: 3 option + 2 tool_approval
    expect(screen.getByText(/5 pending/)).toBeInTheDocument()

    // Expand filters
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))

    // Select "Tool Approval" from dropdown
    const dropdown = screen.getByRole('combobox', { name: /filter by decision type/i })
    await user.selectOptions(dropdown, 'tool_approval')

    // Should show only 2 tool_approval decisions
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()
    expect(screen.getAllByText(/Agent requests: Run database migration script/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Agent requests: Write WebSocket config file/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows resolved decisions when show resolved toggle is enabled', async () => {
    const user = userEvent.setup()
    // Create state with one resolved decision
    const stateWithResolved: ProjectState = {
      ...mayaState,
      decisions: mayaState.decisions.map((d, i) =>
        i === 0
          ? { ...d, resolved: true, resolution: { chosenOptionId: d.options[0].id, actionKind: 'approve' as const, rationale: 'test', resolvedAtTick: 1, reversed: false } }
          : d,
      ),
    }
    renderWithContext(stateWithResolved)

    // Should show 2 pending (one is resolved and hidden)
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()

    // Expand filters and enable show resolved
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))
    await user.click(screen.getByRole('checkbox', { name: /show resolved/i }))

    // Now all 3 decisions should be visible (2 pending text, but 3 items in list)
    // The resolved one should appear with reduced opacity
    expect(screen.getAllByText(/Conflicting market size data for Post 4/).length).toBeGreaterThan(0)
  })

  // -- Part 2: Batch Selection Tests ----------------------------------

  it('renders checkboxes on each decision row', () => {
    renderWithContext(mayaState)
    // Each decision row has a checkbox plus the "select all" checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    // 3 decision checkboxes + 1 select-all checkbox = 4
    expect(checkboxes.length).toBe(4)
  })

  it('select-all checkbox selects all visible decisions', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)

    // Click select all
    const selectAll = screen.getByRole('checkbox', { name: /select all visible/i })
    await user.click(selectAll)

    // Batch action bar should appear
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    expect(screen.getByText(/Approve Selected/)).toBeInTheDocument()
    expect(screen.getByText(/Clear Selection/)).toBeInTheDocument()
  })

  it('individual checkbox toggles selection', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)

    // Select the first decision checkbox (not select-all)
    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] is select-all, checkboxes[1..3] are individual
    await user.click(checkboxes[1])

    // Should show 1 selected
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('batch approve dispatches resolve-decision for each selected', async () => {
    const user = userEvent.setup()
    // Use David state where d2 and d3 don't require rationale
    const { dispatch } = renderWithContext(davidState)

    // Expand filters first to make sure we can see tool decisions
    // Select david-d2 (WebSocket reconnection) and david-d3 (API docs) -- neither requires rationale
    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] = select all
    // The decisions are sorted by attention score: d1(90), d2(82), d4(80), d5(58), d3(25)
    // So checkbox indices: [0]=selectAll, [1]=d1, [2]=d2, [3]=d4, [4]=d5, [5]=d3
    // d2 is at index 2, d3 is at index 5
    await user.click(checkboxes[2]) // david-d2
    await user.click(checkboxes[5]) // david-d3

    // Should show 2 selected
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()

    // Click approve selected
    await user.click(screen.getByText(/Approve Selected/))

    // Should have dispatched resolve-decision for both
    const resolveActions = dispatch.mock.calls.filter(
      (call) => call[0]?.type === 'resolve-decision',
    )
    expect(resolveActions.length).toBe(2)
  })

  it('cannot batch approve when any selected decision requires rationale', async () => {
    const user = userEvent.setup()
    renderWithContext(davidState)

    // Select david-d1 which requires rationale
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1]) // david-d1 (highest priority, requires rationale)

    // Should show rationale warning
    expect(screen.getByText(/Rationale required/)).toBeInTheDocument()

    // Approve button should be disabled
    const approveButton = screen.getByText(/Approve Selected/).closest('button')
    expect(approveButton).toHaveAttribute('disabled')
  })

  it('clear selection button removes all selections', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)

    // Select all
    const selectAll = screen.getByRole('checkbox', { name: /select all visible/i })
    await user.click(selectAll)
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()

    // Clear selection
    await user.click(screen.getByText(/Clear Selection/))

    // Batch bar should disappear
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  // -- Part 3: Temporal Navigation Tests --------------------------------

  it('hides decisions not yet created when viewing a past tick', () => {
    // David has 5 decisions with createdAtTick values: d1=13, d2=12, d3=14, d4=14, d5=14
    // Viewing at tick 13 should show only d1 (tick 13) and d2 (tick 12) = 2 pending
    const historyState: ProjectState = {
      ...davidState,
      viewingTick: 13,
    }
    renderWithContext(historyState)
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()
  })

  it('shows future-resolved decisions as unresolved when viewing past tick', () => {
    // Maya d1 createdAtTick=7. We resolve it at tick 10 and view at tick 7.
    // At tick 7: d1 (created 7) and d2 (created 6) are visible, d3 (created 8) is hidden.
    // d1 is resolved at tick 10 > viewingTick 7, so it should appear unresolved.
    // That gives us 2 pending decisions (d1 masked as unresolved + d2 unresolved).
    const stateWithResolved: ProjectState = {
      ...mayaState,
      decisions: mayaState.decisions.map((d, i) =>
        i === 0
          ? {
              ...d,
              resolved: true,
              resolution: {
                chosenOptionId: d.options[0].id,
                actionKind: 'approve' as const,
                rationale: 'test',
                resolvedAtTick: 10,
                reversed: false,
              },
            }
          : d,
      ),
      viewingTick: 7,
    }
    renderWithContext(stateWithResolved)
    // d1 (created 7, resolved at 10 > viewingTick 7 -> masked as unresolved) + d2 (created 6, unresolved)
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()
  })

  it('clears selection when filter changes hide the selected decision', async () => {
    const user = userEvent.setup()
    renderWithContext(davidState)

    // David has 5 pending decisions. Select david-d3 (severity=low).
    // Decisions are sorted by attentionScore: d1(90), d2(82), d4(80), d5(58), d3(25)
    // Checkboxes: [0]=selectAll, [1]=d1, [2]=d2, [3]=d4, [4]=d5, [5]=d3
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[5]) // select david-d3 (low severity)

    // Confirm selection is active
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    // Expand filters
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))

    // Deactivate 'low' severity — this hides david-d3 from the visible list
    await user.click(screen.getByRole('button', { name: /filter by low severity/i }))

    // Selection should now be cleared (batch action bar gone)
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it('intersects selections with visible list — keeps matching selections when filter changes', async () => {
    const user = userEvent.setup()
    renderWithContext(davidState)

    // David decisions sorted by attentionScore: d1(90,high), d2(82,high), d4(80,high), d5(58,medium), d3(25,low)
    // Checkboxes: [0]=selectAll, [1]=d1(high), [2]=d2(high), [3]=d4(high), [4]=d5(medium), [5]=d3(low)
    const checkboxes = screen.getAllByRole('checkbox')

    // Select d1 (high severity) and d3 (low severity)
    await user.click(checkboxes[1]) // david-d1 (high)
    await user.click(checkboxes[5]) // david-d3 (low)

    // Confirm both are selected
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()

    // Expand filters and deactivate 'low' severity
    await user.click(screen.getByRole('button', { name: /toggle filters/i }))
    await user.click(screen.getByRole('button', { name: /filter by low severity/i }))

    // Only d3 (low) should be pruned — d1 (high) stays selected
    // Batch action bar should show 1 selected, not 0 and not 2
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('disables batch approve when viewing history', async () => {
    const user = userEvent.setup()
    // At viewingTick 13, David has 2 decisions visible (d1=tick 13, d2=tick 12)
    const historyState: ProjectState = {
      ...davidState,
      viewingTick: 13,
    }
    renderWithContext(historyState)

    // Select a decision (checkbox[0] is select-all, checkbox[1] is first decision)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    // Batch approve should be disabled because we're viewing history
    const approveButton = screen.getByText(/Approve Selected/).closest('button')
    expect(approveButton).toHaveAttribute('disabled')
  })

  it('shows historical banner in decision detail when viewing history', () => {
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 7,
    }
    renderWithContext(historyState)
    expect(screen.getByText(/Viewing historical state — actions disabled/)).toBeInTheDocument()
  })

  it('disables resolve option buttons in decision detail when viewing history', () => {
    // Maya d1 has requiresRationale: true — in live mode buttons are disabled until
    // rationale is filled. In history mode they should be disabled regardless.
    // Use a state where d1 doesn't require rationale so we can test history-only disabling.
    const historyState: ProjectState = {
      ...mayaState,
      decisions: mayaState.decisions.map((d) =>
        d.id === 'maya-d1' ? { ...d, requiresRationale: false } : d,
      ),
      viewingTick: 7,
    }
    renderWithContext(historyState)

    // Find the option buttons in the detail panel (they appear as buttons with option labels)
    const buttons = screen.getAllByRole('button')
    const optionButtons = buttons.filter(
      (b) =>
        b.textContent?.includes('Use Gartner') ||
        b.textContent?.includes('Use IDC') ||
        b.textContent?.includes('Cite both'),
    )
    expect(optionButtons.length).toBeGreaterThan(0)
    // Every option button should be disabled in history mode
    optionButtons.forEach((b) => {
      expect(b).toHaveAttribute('disabled')
    })
  })

  it('disables rationale textarea in decision detail when viewing history', () => {
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 7,
    }
    renderWithContext(historyState)

    const textarea = screen.getByPlaceholderText('Why did you choose this option?')
    expect(textarea).toHaveAttribute('disabled')
  })

  it('shows "Tick N" (not overdue) for a decision when effectiveTick is before dueByTick', () => {
    // David d2 has dueByTick=15, currentTick=15 in the David scenario.
    // At viewingTick=10, effectiveTick=10. Since 15 > 10, it should show "Tick 15" not "Overdue".
    // We also need d2 to be visible: d2.createdAtTick=12, so viewingTick must be >= 12.
    // Use viewingTick=13 so d2 (createdAtTick=12) is visible.
    // At effectiveTick=13, dueByTick=15 > 13, so it should show "Tick 15" not "Overdue".
    const historyState: ProjectState = {
      ...davidState,
      project: { ...davidState.project!, currentTick: 20 }, // live tick is past due
      viewingTick: 13,
    }
    renderWithContext(historyState)

    // d2 has dueByTick=15 and effectiveTick=13, so 15 > 13 means NOT overdue
    // The detail panel should show "Tick 15" for d2's due status.
    // At viewingTick=13 with currentTick=20, d1 (createdAtTick=13, dueByTick=16) is also visible.
    // d1 has the highest attention score so it will be auto-selected. dueByTick=16 > 13, so "Tick 16".
    // Let's verify no "Overdue" badge appears for the auto-selected decision.
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
    // The due tick label should be present
    expect(screen.getByText('Tick 16')).toBeInTheDocument()
  })

  it('does not disable resolve buttons when live (viewingTick null)', () => {
    // In live mode with a decision that doesn't require rationale, buttons should be enabled
    const liveState: ProjectState = {
      ...mayaState,
      decisions: mayaState.decisions.map((d) =>
        d.id === 'maya-d1' ? { ...d, requiresRationale: false } : d,
      ),
      viewingTick: null,
    }
    renderWithContext(liveState)

    const buttons = screen.getAllByRole('button')
    const optionButtons = buttons.filter(
      (b) =>
        b.textContent?.includes('Use Gartner') ||
        b.textContent?.includes('Use IDC') ||
        b.textContent?.includes('Cite both'),
    )
    expect(optionButtons.length).toBeGreaterThan(0)
    // In live mode without rationale requirement, buttons should be enabled
    optionButtons.forEach((b) => {
      expect(b).not.toHaveAttribute('disabled')
    })
  })
})
