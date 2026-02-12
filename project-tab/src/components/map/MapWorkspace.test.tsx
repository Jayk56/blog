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

  it('shows cross-cutting patterns in knowledge tab when present', async () => {
    const user = userEvent.setup()
    // Rosa scenario has cross-cutting decisions
    renderMap(scenarios[3].state)

    await user.click(screen.getByText('Knowledge'))
    expect(screen.getByText('Cross-Cutting Patterns')).toBeInTheDocument()
  })
})
