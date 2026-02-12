import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import QueueWorkspace from './QueueWorkspace'
import { ProjectContext, type ProjectContextValue } from '../../lib/context.js'
import type { ProjectState } from '../../types/index.js'
import { initialState } from '../../lib/reducer.js'
import { scenarios } from '../../data/index.js'

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────

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
    // Maya d1 options — labels appear on option cards
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
    // Maya d1 has confidence 0.65 = 65% — appears in list and detail
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
})
