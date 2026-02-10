/**
 * Barrel export for all lib modules.
 */

// Reducer and initial state
export { projectReducer, initialState, registerScenarioLoader } from './reducer.js';

// Scoring functions
export {
  attentionPriority,
  coherenceScore,
  coherenceTrend,
  buildCoherenceScore,
  reworkRisk,
  trustScore,
  trustTrend,
  averageTrustScore,
  highSeverityMissRate,
  humanInterventionRate,
  computeReviewPatterns,
  computeMetrics,
} from './scoring.js';

// Narrative generation
export { buildBriefing, buildOneLiner } from './narrative.js';

// Topology engine
export {
  getTopologyPoints,
  getRecommendedPosition,
  positionToMode,
  generateModeRecommendation,
} from './topology.js';

// React context
export {
  ProjectContext,
  useProject,
  useProjectState,
  useProjectDispatch,
} from './context.js';
export type { ProjectContextValue } from './context.js';
