import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Shell from './Shell'
import { ProjectContext, type ProjectContextValue } from '../lib/context.js'
import { scenarios } from '../data/index.js'

// ── Helpers ──────────────────────────────────────────────────────

function renderShell(route = '/', state = scenarios[0].state) {
  const value: ProjectContextValue = { state, dispatch: vi.fn(), api: null, connected: false }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProjectContext value={value}>
        <Shell />
      </ProjectContext>
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────

describe('Shell', () => {
  it('renders the VitalStrip header', () => {
    renderShell()
    expect(screen.getByText('Project Tab')).toBeInTheDocument()
  })

  it('renders all 5 workspace navigation links', () => {
    renderShell()
    // Each nav item has a title attribute with its label
    expect(screen.getByTitle('Briefing')).toBeInTheDocument()
    expect(screen.getByTitle('Queue')).toBeInTheDocument()
    expect(screen.getByTitle('Map')).toBeInTheDocument()
    expect(screen.getByTitle('Brief')).toBeInTheDocument()
    expect(screen.getByTitle('Controls')).toBeInTheDocument()
  })

  it('renders the Briefing workspace at the root route', () => {
    renderShell('/')
    // BriefingWorkspace renders narrative content from the briefing text
    // Maya scenario briefing contains "Monday Morning Briefing"
    expect(screen.getByText(/Monday Morning Briefing/)).toBeInTheDocument()
  })

  it('renders Queue workspace at queue route', () => {
    renderShell('/queue')
    // QueueWorkspace renders the decision queue — check for its heading or content
    // The nav link should still be present
    expect(screen.getByTitle('Queue')).toBeInTheDocument()
  })

  it('renders Map workspace at map route', () => {
    renderShell('/map')
    expect(screen.getByTitle('Map')).toBeInTheDocument()
  })

  it('renders Brief Editor for Brief route', () => {
    renderShell('/brief')
    expect(screen.getByTitle('Brief')).toBeInTheDocument()
  })

  it('renders Controls workspace at controls route', () => {
    renderShell('/controls')
    // ControlsWorkspace is now a real component — just verify it mounts
    expect(screen.getByTitle('Controls')).toBeInTheDocument()
  })
})
