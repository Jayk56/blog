import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BriefEditorWorkspace from './BriefEditorWorkspace'
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
          <BriefEditorWorkspace />
        </ProjectContext>
      </MemoryRouter>,
    ),
  }
}

const mayaState = scenarios[0].state
const davidState = scenarios[1].state
const samState = scenarios[4].state

// ── Tests ────────────────────────────────────────────────────────

describe('BriefEditorWorkspace', () => {
  it('shows placeholder when no project is loaded', () => {
    renderWithContext()
    expect(screen.getByText(/No project loaded/)).toBeInTheDocument()
  })

  it('renders the Brief Editor heading with project name', () => {
    renderWithContext(mayaState)
    expect(screen.getByRole('heading', { name: 'Brief Editor' })).toBeInTheDocument()
    expect(screen.getByText(/Define intent.*Client C/)).toBeInTheDocument()
  })

  // ── ProjectBrief ────────────────────────────────────────────

  it('renders the Project Brief section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Project Brief')).toBeInTheDocument()
  })

  it('shows project description', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(/four blog posts for Client C/i)).toBeInTheDocument()
  })

  it('shows project goals', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(/Deliver four high-quality blog posts/)).toBeInTheDocument()
    expect(screen.getByText(/Maintain consistent brand voice/)).toBeInTheDocument()
    expect(screen.getByText(/Achieve SEO keyword targets/)).toBeInTheDocument()
  })

  it('shows project metadata (phase, mode, risk, persona)', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(/Phase:/)).toBeInTheDocument()
    expect(screen.getByText(/Mode:/)).toBeInTheDocument()
    expect(screen.getByText(/Risk:/)).toBeInTheDocument()
    expect(screen.getByText(/Persona:/)).toBeInTheDocument()
  })

  // ── Constraints ─────────────────────────────────────────────

  it('renders the Constraints section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Constraints')).toBeInTheDocument()
  })

  it('shows existing constraints', () => {
    renderWithContext(mayaState)
    expect(screen.getByText(/conservative market numbers/)).toBeInTheDocument()
    expect(screen.getByText(/Client brand voice guide/)).toBeInTheDocument()
    expect(screen.getByText(/All claims must have cited sources/)).toBeInTheDocument()
  })

  it('shows Add button for constraints', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('shows add constraint form when Add is clicked', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)
    await user.click(screen.getByText('Add'))
    expect(screen.getByPlaceholderText(/date-fns/)).toBeInTheDocument()
  })

  it('dispatches inject-context when a new constraint is added', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    await user.click(screen.getByText('Add'))
    const input = screen.getByPlaceholderText(/date-fns/)
    await user.type(input, 'No external API calls without approval')
    // Click the Add button in the form (not the section header Add)
    const addButtons = screen.getAllByText('Add')
    const formAdd = addButtons[addButtons.length - 1]
    await user.click(formAdd)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'inject-context',
      context: 'No external API calls without approval',
    })
  })

  it('hides add form when Cancel is clicked', async () => {
    const user = userEvent.setup()
    renderWithContext(mayaState)
    await user.click(screen.getByText('Add'))
    expect(screen.getByPlaceholderText(/date-fns/)).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByPlaceholderText(/date-fns/)).not.toBeInTheDocument()
  })

  it('shows David constraints (including technical ones)', () => {
    renderWithContext(davidState)
    expect(screen.getByText(/existing ws library from chat/)).toBeInTheDocument()
    expect(screen.getByText(/All new endpoints require auth middleware/)).toBeInTheDocument()
  })

  // ── Checkpoints ─────────────────────────────────────────────

  it('renders the Checkpoints section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Checkpoints')).toBeInTheDocument()
  })

  it('shows checkpoint names and descriptions', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Phase Transition')).toBeInTheDocument()
    expect(screen.getByText('High-Risk Touch')).toBeInTheDocument()
    expect(screen.getByText('Before Merge')).toBeInTheDocument()
    expect(screen.getByText('Daily Summary')).toBeInTheDocument()
  })

  it('dispatches toggle-checkpoint when a toggle is clicked', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderWithContext(mayaState)
    // Multiple checkpoints are enabled; click the first toggle
    const toggleButtons = screen.getAllByTitle('Disable checkpoint')
    await user.click(toggleButtons[0])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'toggle-checkpoint',
      checkpointId: 'cp-phase',
      enabled: false,
    })
  })

  // ── AgentsPanel ─────────────────────────────────────────────

  it('renders the Active Agents section', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Active Agents')).toBeInTheDocument()
  })

  it('shows active agents with names and roles', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Writing Agent')).toBeInTheDocument()
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.getByText('SEO Agent')).toBeInTheDocument()
  })

  it('shows agent roles', () => {
    renderWithContext(mayaState)
    expect(screen.getByText('Literature research and data gathering')).toBeInTheDocument()
    expect(screen.getByText('Drafting and content production')).toBeInTheDocument()
  })

  it('shows trust scores for each agent', () => {
    renderWithContext(mayaState)
    // Maya research agent trust = 85, writer = 72, review = 90, SEO = 88
    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('shows trend arrows for agents', () => {
    renderWithContext(mayaState)
    // Review Agent has trend increasing = ↑, others stable = →
    const trendElements = screen.getAllByText(/[↑→↓]/)
    expect(trendElements.length).toBeGreaterThan(0)
  })

  it('shows link to Controls workspace for trust trajectories', () => {
    renderWithContext(mayaState)
    const link = screen.getByText('View trust trajectories')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/controls')
  })

  it('renders Sam scenario with first-project constraints', () => {
    renderWithContext(samState)
    expect(screen.getByText(/Client D data must never/)).toBeInTheDocument()
    expect(screen.getByText(/existing Kafka infrastructure/)).toBeInTheDocument()
  })
})
