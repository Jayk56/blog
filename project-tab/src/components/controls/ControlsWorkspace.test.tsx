import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ControlsWorkspace from './ControlsWorkspace'
import { ProjectContext, type ProjectContextValue } from '../../lib/context.js'
import type { ProjectState } from '../../types/index.js'
import { initialState } from '../../lib/reducer.js'
import { scenarios } from '../../data/index.js'

// ── Helpers ──────────────────────────────────────────────────────

function renderWithContext(
  state: ProjectState = initialState,
  dispatch = vi.fn(),
) {
  const value: ProjectContextValue = { state, dispatch }
  return {
    dispatch,
    ...render(
      <MemoryRouter>
        <ProjectContext value={value}>
          <ControlsWorkspace />
        </ProjectContext>
      </MemoryRouter>,
    ),
  }
}

const mayaState = scenarios[0].state
const davidState = scenarios[1].state

// ── Tests ────────────────────────────────────────────────────────

describe('ControlsWorkspace', () => {
  it('shows placeholder when no project is loaded', () => {
    renderWithContext()
    expect(screen.getByText(/No project loaded/)).toBeInTheDocument()
  })

  it('renders the Controls heading with project name', () => {
    renderWithContext(mayaState)
    expect(screen.getByRole('heading', { name: 'Controls' })).toBeInTheDocument()
    expect(screen.getByText(/Configure how.*Client C/)).toBeInTheDocument()
  })

  // ── ModeSelector ────────────────────────────────────────────

  it('renders all three control mode buttons', () => {
    renderWithContext(mayaState)
    // Mode labels appear in both ModeSelector and ControlTopology, so use getAllByText
    expect(screen.getAllByText('Orchestrator').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Adaptive').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ecosystem').length).toBeGreaterThan(0)
  })

  it('shows "active" badge on the current mode', () => {
    renderWithContext(mayaState)
    // Maya is in ecosystem mode
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('dispatches set-mode when a mode button is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    // "Orchestrator" appears in both ModeSelector and ControlTopology
    // The mode buttons are the ones in the ModeSelector section
    const orchestratorElements = screen.getAllByText('Orchestrator')
    await user.click(orchestratorElements[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-mode', mode: 'orchestrator' })
  })

  it('shows pending mode recommendation for David scenario', () => {
    renderWithContext(davidState)
    expect(screen.getByText('System Recommendation')).toBeInTheDocument()
    expect(screen.getByText(/rework rate is only 8%/)).toBeInTheDocument()
  })

  it('dispatches accept-recommendation when Accept is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(davidState)
    await user.click(screen.getByText('Accept'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'accept-recommendation',
      recommendationId: 'david-rec1',
    })
  })

  it('dispatches reject-recommendation when Dismiss is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(davidState)
    await user.click(screen.getByText('Dismiss'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'reject-recommendation',
      recommendationId: 'david-rec1',
    })
  })

  // ── QualityDial ─────────────────────────────────────────────

  it('renders the quality/throughput dial', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Throughput vs Quality')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('Throughput')).toBeInTheDocument()
  })

  it('shows the current bias value', () => {
    renderWithContext(mayaState)
    // Maya bias is 50
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('shows the descriptive text for balanced bias', () => {
    renderWithContext(mayaState)
    // bias.value = 50 -> "Balanced" description
    expect(screen.getByText(/Balanced/)).toBeInTheDocument()
  })

  // ── ControlTopology ─────────────────────────────────────────

  it('renders control topology section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Control Topology')).toBeInTheDocument()
    // "Orchestrator" and "Ecosystem" labels appear in both ModeSelector and topology
    expect(screen.getAllByText('Orchestrator').length).toBeGreaterThanOrEqual(2)
  })

  it('shows all four topology dimensions', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('By Project Phase')).toBeInTheDocument()
    expect(screen.getByText('By Risk Level')).toBeInTheDocument()
    expect(screen.getByText('By Domain Expertise')).toBeInTheDocument()
    expect(screen.getByText('By Team Maturity')).toBeInTheDocument()
  })

  it('shows topology dimension labels', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Execution')).toBeInTheDocument()
    expect(screen.getByText('Human Expert')).toBeInTheDocument()
    expect(screen.getByText('Established')).toBeInTheDocument()
  })

  // ── TrustTrajectories ───────────────────────────────────────

  it('renders trust trajectories section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Trust Trajectories')).toBeInTheDocument()
  })

  it('shows active agents with trust scores', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Writing Agent')).toBeInTheDocument()
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.getByText('SEO Agent')).toBeInTheDocument()
  })

  it('shows trust score values for agents', () => {
    renderWithContext(mayaState)
    // Maya research agent has currentScore 0.85 = 85
    expect(screen.getByText(/85/)).toBeInTheDocument()
    // Maya writer agent has currentScore 0.72 = 72
    expect(screen.getByText(/72/)).toBeInTheDocument()
  })

  it('shows trust trend arrows', () => {
    renderWithContext(mayaState)
    // Review Agent has trend 'increasing', should show ↑
    const trendElements = screen.getAllByText(/[↑→↓]/)
    expect(trendElements.length).toBeGreaterThan(0)
  })

  it('shows success/override/rework breakdown', () => {
    renderWithContext(mayaState)
    expect(screen.getAllByText(/success/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/override/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/rework/).length).toBeGreaterThan(0)
  })

  // ── ReviewPatterns ──────────────────────────────────────────

  it('renders review patterns section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Review Patterns')).toBeInTheDocument()
  })

  it('shows review patterns by artifact kind', () => {
    renderWithContext(mayaState)
    // Maya has document and research review patterns
    expect(screen.getByText('document')).toBeInTheDocument()
    expect(screen.getByText('research')).toBeInTheDocument()
  })

  it('shows review rate percentages', () => {
    renderWithContext(mayaState)
    // Maya document review rate is 80%
    expect(screen.getByText('reviewing 80%')).toBeInTheDocument()
    // Maya research review rate is 100%
    expect(screen.getByText('reviewing 100%')).toBeInTheDocument()
  })

  it('shows system suggestions for review patterns', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(/could review fewer drafts/)).toBeInTheDocument()
    expect(screen.getByText(/consistently high quality/)).toBeInTheDocument()
  })

  it('shows "insufficient data" when no review patterns exist', () => {
    const emptyPatternsState: ProjectState = {
      ...mayaState,
      metrics: { ...mayaState.metrics, reviewPatterns: [] },
    }
    renderWithContext(emptyPatternsState)
    expect(screen.getByText(/Insufficient data/)).toBeInTheDocument()
  })

  // ── DecisionLog ─────────────────────────────────────────────

  it('renders decision log section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Decision Log')).toBeInTheDocument()
  })

  it('shows decision log entries', () => {
    renderWithContext(mayaState)
    // Maya has one decision log entry
    expect(screen.getByText('Approved Post 1 for publication')).toBeInTheDocument()
  })

  it('shows tick and source on log entries', () => {
    renderWithContext(mayaState)
    // Maya dl1 is tick 5, source human
    expect(screen.getByText('T5')).toBeInTheDocument()
    expect(screen.getByText('human')).toBeInTheDocument()
  })

  it('shows "Inject Context" button', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Inject Context')).toBeInTheDocument()
  })

  it('shows context injection form when button is clicked', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)
    await user.click(screen.getByText('Inject Context'))
    expect(screen.getByPlaceholderText(/Push new context/)).toBeInTheDocument()
  })

  it('dispatches inject-context when context is submitted', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    await user.click(screen.getByText('Inject Context'))
    const input = screen.getByPlaceholderText(/Push new context/)
    await user.type(input, 'Important update for all agents')
    await user.click(screen.getByText('Send'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'inject-context',
      context: 'Important update for all agents',
    })
  })

  it('shows "No decisions logged yet" when log is empty', () => {
    const emptyLogState: ProjectState = {
      ...mayaState,
      decisionLog: [],
    }
    renderWithContext(emptyLogState)
    expect(screen.getByText('No decisions logged yet.')).toBeInTheDocument()
  })

  it('shows multiple log entries sorted by tick (most recent first)', () => {
    renderWithContext(davidState)
    // David has 3 log entries at ticks 4, 8, 11
    const entries = screen.getAllByText(/^T\d+$/)
    const ticks = entries.map(el => parseInt(el.textContent!.slice(1)))
    // Should be sorted descending
    for (let i = 0; i < ticks.length - 1; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i + 1])
    }
  })
})
