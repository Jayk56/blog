import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import VitalStrip from './VitalStrip'
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
          <VitalStrip />
        </ProjectContext>
      </MemoryRouter>,
    ),
  }
}

// Use the Maya scenario as a representative loaded state
const mayaState = scenarios[0].state

// ── Tests ────────────────────────────────────────────────────────

describe('VitalStrip', () => {
  it('renders the "Project Tab" brand name', () => {
    renderWithContext()
    expect(screen.getByText('Project Tab')).toBeInTheDocument()
  })

  it('renders scenario switcher with all scenarios', () => {
    renderWithContext(mayaState)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    // All five scenarios should be present as options
    for (const scenario of scenarios) {
      expect(screen.getByText(scenario.label)).toBeInTheDocument()
    }
  })

  it('shows project phase and control mode when loaded', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('execution')).toBeInTheDocument()
    expect(screen.getByText('ecosystem')).toBeInTheDocument()
  })

  it('shows coherence score, rework risk, and decision count', () => {
    renderWithContext(mayaState)
    // The metrics from Maya scenario
    expect(screen.getByText(/Coherence:/)).toBeInTheDocument()
    expect(screen.getByText(/Risk:/)).toBeInTheDocument()
    expect(screen.getByText(/Decisions:/)).toBeInTheDocument()
  })

  it('shows the current tick number', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(`T${mayaState.project!.currentTick}`)).toBeInTheDocument()
  })

  it('dispatches advance-tick when tick button is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    const advanceButton = screen.getByTitle('Advance one tick')
    await user.click(advanceButton)
    expect(dispatch).toHaveBeenCalledWith({ type: 'advance-tick' })
  })

  it('dispatches toggle-auto-simulate when auto button is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    const autoButton = screen.getByTitle(/simulate/i)
    await user.click(autoButton)
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggle-auto-simulate' })
  })

  it('dispatches emergency-brake when brake button is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    const brakeButton = screen.getByTitle(/Emergency Brake/i)
    await user.click(brakeButton)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'emergency-brake',
      engaged: true,
    })
  })

  it('shows "Resume" text when emergency brake is engaged', () => {
    const brakedState: ProjectState = {
      ...mayaState,
      project: { ...mayaState.project!, emergencyBrakeEngaged: true },
    }
    renderWithContext(brakedState)
    expect(screen.getByText('Resume')).toBeInTheDocument()
  })

  it('shows "Brake" text when emergency brake is not engaged', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Brake')).toBeInTheDocument()
  })

  it('dispatches load-scenario when scenario is changed', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'david')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'load-scenario',
      scenarioId: 'david',
    })
  })

  // ── Temporal Navigation Tests ─────────────────────────────────

  it('renders tick scrubber slider when project is loaded', () => {
    renderWithContext(mayaState)
    const slider = screen.getByRole('slider', { name: /tick scrubber/i })
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', String(mayaState.project!.currentTick))
  })

  it('shows "live" indicator when viewingTick is null', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('shows "Live" button and warning-colored tick when viewing history', () => {
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 3,
    }
    renderWithContext(historyState)
    // Tick label shows T3 in warning color
    expect(screen.getByText('T3')).toBeInTheDocument()
    // Live button appears to return to current
    expect(screen.getByRole('button', { name: /return to live/i })).toBeInTheDocument()
  })

  it('dispatches set-viewing-tick with null when Live button clicked', async () => {
    const user = userEvent.setup()
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 3,
    }
    const { dispatch } = renderWithContext(historyState)
    await user.click(screen.getByRole('button', { name: /return to live/i }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-viewing-tick',
      tick: null,
    })
  })

  it('disables advance-tick button when viewing history', () => {
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 3,
    }
    renderWithContext(historyState)
    const advanceButton = screen.getByTitle('Advance one tick')
    expect(advanceButton).toBeDisabled()
  })

  it('disables auto-simulate button when viewing history', () => {
    const historyState: ProjectState = {
      ...mayaState,
      viewingTick: 3,
    }
    renderWithContext(historyState)
    const autoButton = screen.getByTitle(/simulate/i)
    expect(autoButton).toBeDisabled()
  })

  it('advance-tick and auto-simulate are enabled when at live (viewingTick null)', () => {
    renderWithContext(mayaState)
    const advanceButton = screen.getByTitle('Advance one tick')
    const autoButton = screen.getByTitle(/simulate/i)
    expect(advanceButton).not.toBeDisabled()
    expect(autoButton).not.toBeDisabled()
  })
})
