/**
 * ProjectProvider — wraps the app with project state context.
 *
 * Sets up useReducer with projectReducer and registers the
 * scenario loader so 'load-scenario' actions can find data.
 * Loads the default scenario on mount.
 */

import { useReducer, useEffect, type ReactNode } from 'react'
import { projectReducer, initialState, registerScenarioLoader } from '../lib/reducer.js'
import { ProjectContext } from '../lib/context.js'
import { getScenarioById, getDefaultScenario } from '../data/index.js'

export default function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialState)

  // Register the scenario loader once on mount
  useEffect(() => {
    registerScenarioLoader((id: string) => {
      const scenario = getScenarioById(id)
      return scenario?.state ?? null
    })

    // Load the default scenario
    const defaultScenario = getDefaultScenario()
    dispatch({ type: 'load-scenario', scenarioId: defaultScenario.id })
  }, [])

  return (
    <ProjectContext value={{ state, dispatch }}>
      {children}
    </ProjectContext>
  )
}
