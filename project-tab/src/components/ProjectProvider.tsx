/**
 * ProjectProvider — wraps the app with project state context.
 *
 * Supports two modes:
 * - Mock mode (default when no VITE_API_URL): uses scenario data
 * - Live mode (when VITE_API_URL is set): connects to backend via WS + REST
 *
 * The mode is determined by environment variables:
 *   VITE_API_URL  — e.g. 'http://localhost:3001/api'
 *   VITE_WS_URL   — e.g. 'ws://localhost:3001'
 */

import { useReducer, useEffect, useRef, useState, type ReactNode } from 'react'
import { projectReducer, initialState, registerScenarioLoader } from '../lib/reducer.js'
import { ProjectContext } from '../lib/context.js'
import { getScenarioById, getDefaultScenario } from '../data/index.js'
import { createApiClient } from '../services/api-client.js'
import type { ApiClient } from '../services/api-client.js'
import { createWebSocketService } from '../services/ws-service.js'
import type { WebSocketService } from '../services/ws-service.js'
import { adaptStateSyncToState, adaptEnvelopeToTimelineEvent } from '../services/state-adapter.js'

const API_URL = import.meta.env.VITE_API_URL as string | undefined
const WS_URL = import.meta.env.VITE_WS_URL as string | undefined

const isLiveMode = Boolean(API_URL)

export default function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialState)
  const [connected, setConnected] = useState(false)
  const [api, setApi] = useState<ApiClient | null>(null)
  const wsRef = useRef<WebSocketService | null>(null)
  const currentTickRef = useRef<number>(0)

  // Keep currentTickRef in sync with state
  useEffect(() => {
    currentTickRef.current = state.project?.currentTick ?? 0
  }, [state.project?.currentTick])

  // In mock mode, set up scenario loader and load default scenario
  useEffect(() => {
    if (isLiveMode) return

    registerScenarioLoader((id: string) => {
      const scenario = getScenarioById(id)
      return scenario?.state ?? null
    })

    const defaultScenario = getDefaultScenario()
    dispatch({ type: 'load-scenario', scenarioId: defaultScenario.id })
  }, [])

  // In live mode, set up API client and WebSocket service
  useEffect(() => {
    if (!isLiveMode || !API_URL) return

    // Also register the scenario loader so mock mode can still be triggered
    registerScenarioLoader((id: string) => {
      const scenario = getScenarioById(id)
      return scenario?.state ?? null
    })

    const apiClient = createApiClient({ baseUrl: API_URL })
    setApi(apiClient)

    const wsUrl = WS_URL || API_URL.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
    const ws = createWebSocketService({ url: wsUrl })
    wsRef.current = ws

    const unsubs = [
      ws.onStateSync((msg) => {
        const serverState = adaptStateSyncToState(msg)
        dispatch({ type: 'server-state-sync', serverState })
      }),
      ws.onEvent((msg) => {
        const tick = currentTickRef.current
        const event = adaptEnvelopeToTimelineEvent(msg.envelope, tick)
        dispatch({ type: 'server-event', event, envelope: msg.envelope })
      }),
      ws.onTrustUpdate((msg) => {
        dispatch({
          type: 'server-trust-update',
          agentId: msg.agentId,
          previousScore: msg.previousScore,
          newScore: msg.newScore,
          delta: msg.delta,
          reason: msg.reason,
        })
      }),
      ws.onDecisionResolved((msg) => {
        dispatch({
          type: 'server-decision-resolved',
          decisionId: msg.decisionId,
          agentId: msg.agentId,
          resolution: msg.resolution,
        })
      }),
      ws.onBrake((msg) => {
        dispatch({
          type: 'server-brake',
          engaged: true,
          affectedAgentIds: msg.affectedAgentIds,
        })
      }),
      ws.onConnectionChange((isConnected) => {
        setConnected(isConnected)
      }),
    ]

    ws.connect()

    return () => {
      unsubs.forEach((fn) => fn())
      ws.disconnect()
      wsRef.current = null
      setApi(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ProjectContext value={{
      state,
      dispatch,
      api,
      connected: isLiveMode ? connected : false,
    }}>
      {children}
    </ProjectContext>
  )
}
