/**
 * React context provider for project state.
 *
 * Wraps useReducer with projectReducer and exposes:
 * - Full project state
 * - Dispatch function for all actions
 * - Derived values (scores, narrative, recommendation)
 * - Convenience accessors
 */

import { createContext, useContext } from 'react';
import type { ProjectState, ProjectAction } from '../types/index.js';
import type { ApiClient } from '../services/api-client.js';
import { initialState } from './reducer.js';

// ── Context shape ─────────────────────────────────────────────────

export interface ProjectContextValue {
  /** The full project state. */
  state: ProjectState;
  /** Dispatch an action to the reducer. */
  dispatch: React.Dispatch<ProjectAction>;
  /** REST API client. Null when in mock mode or during initialization. */
  api: ApiClient | null;
  /** Whether the frontend is connected to a live backend. */
  connected: boolean;
}

// ── Context ───────────────────────────────────────────────────────

export const ProjectContext = createContext<ProjectContextValue>({
  state: initialState,
  dispatch: () => {
    console.warn('ProjectContext dispatch called outside provider');
  },
  api: null,
  connected: false,
});

// ── Hook ──────────────────────────────────────────────────────────

/**
 * Access the project state and dispatch function.
 * Must be used within a ProjectProvider.
 */
export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}

/**
 * Convenience hook: just the state (no dispatch).
 */
export function useProjectState(): ProjectState {
  return useContext(ProjectContext).state;
}

/**
 * Convenience hook: just the dispatch function.
 */
export function useProjectDispatch(): React.Dispatch<ProjectAction> {
  return useContext(ProjectContext).dispatch;
}

/**
 * Convenience hook: the API client (null in mock mode).
 */
export function useApi(): ApiClient | null {
  return useContext(ProjectContext).api;
}

/**
 * Convenience hook: whether connected to live backend.
 */
export function useConnected(): boolean {
  return useContext(ProjectContext).connected;
}
