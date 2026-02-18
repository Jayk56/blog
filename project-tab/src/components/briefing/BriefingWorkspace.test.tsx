import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectContext } from '../../lib/context.js'
import type { ProjectState } from '../../types/index.js'
import { initialState } from '../../lib/reducer.js'
import BriefingWorkspace from './BriefingWorkspace.js'

// Minimal project state for testing
const loadedState: ProjectState = {
  ...initialState,
  project: {
    id: 'test',
    name: 'Test Project',
    description: 'A test project',
    persona: 'test',
    phase: 'execution',
    controlMode: 'adaptive',
    riskProfile: { level: 'medium', domainExpertise: 'shared', teamMaturity: 'established' },
    agents: [
      { id: 'agent-1', name: 'Test Agent', role: 'testing', trustScore: 0.8, active: true },
    ],
    workstreams: [],
    goals: ['Ship it'],
    constraints: [],
    currentTick: 5,
    emergencyBrakeEngaged: false,
    createdAt: '2026-01-01T00:00:00Z',
  },
  briefing: '**Test Project** is in the **execution** phase.',
  metrics: {
    ...initialState.metrics,
    pendingDecisionCount: 2,
    openCoherenceIssueCount: 1,
    coherenceScore: 75,
    reworkRisk: 20,
  },
  timeline: [
    {
      id: 'e1',
      tick: 5,
      source: 'agent',
      agentId: 'agent-1',
      category: 'artifact_produced',
      severity: 'info',
      title: 'Built new component',
      description: 'Agent produced a React component.',
      relatedArtifactIds: [],
      relatedDecisionIds: [],
      relatedCoherenceIssueIds: [],
    },
  ],
}

function renderWithProviders(state: ProjectState) {
  return render(
    <MemoryRouter>
      <ProjectContext.Provider value={{ state, dispatch: () => {}, api: null, connected: false }}>
        <BriefingWorkspace />
      </ProjectContext.Provider>
    </MemoryRouter>,
  )
}

describe('BriefingWorkspace', () => {
  it('shows placeholder when no project is loaded', () => {
    renderWithProviders(initialState)
    expect(screen.getByText(/select a scenario/i)).toBeInTheDocument()
  })

  it('renders narrative briefing when project is loaded', () => {
    renderWithProviders(loadedState)
    expect(screen.getByText('Test Project')).toBeInTheDocument()
    expect(screen.getByText(/execution/)).toBeInTheDocument()
  })

  it('renders action summary with correct counts', () => {
    renderWithProviders(loadedState)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/decisions awaiting/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/coherence issue$/)).toBeInTheDocument()
  })

  it('renders activity feed with timeline events', () => {
    renderWithProviders(loadedState)
    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    expect(screen.getByText('Built new component')).toBeInTheDocument()
  })

  it('shows emergency brake banner when engaged', () => {
    const brakeState: ProjectState = {
      ...loadedState,
      project: { ...loadedState.project!, emergencyBrakeEngaged: true },
    }
    renderWithProviders(brakeState)
    expect(screen.getByText(/emergency brake engaged/i)).toBeInTheDocument()
  })

  it('filters timeline events by viewingTick', () => {
    const stateWithHistory: ProjectState = {
      ...loadedState,
      timeline: [
        {
          id: 'e-early',
          tick: 2,
          source: 'agent',
          agentId: 'agent-1',
          category: 'artifact_produced',
          severity: 'info',
          title: 'Early event',
          description: 'Happened at tick 2.',
          relatedArtifactIds: [],
          relatedDecisionIds: [],
          relatedCoherenceIssueIds: [],
        },
        {
          id: 'e-late',
          tick: 5,
          source: 'agent',
          agentId: 'agent-1',
          category: 'artifact_produced',
          severity: 'info',
          title: 'Late event',
          description: 'Happened at tick 5.',
          relatedArtifactIds: [],
          relatedDecisionIds: [],
          relatedCoherenceIssueIds: [],
        },
      ],
      viewingTick: 3,
    }
    renderWithProviders(stateWithHistory)
    // Only the early event (tick 2) should be visible
    expect(screen.getByText('Early event')).toBeInTheDocument()
    expect(screen.queryByText('Late event')).not.toBeInTheDocument()
  })
})
