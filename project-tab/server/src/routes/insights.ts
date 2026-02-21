import { Router } from 'express'

import type { ApiRouteDeps } from './index'
import { OverridePatternAnalyzer } from '../intelligence/override-pattern-analyzer'
import { InjectionOptimizer } from '../intelligence/injection-optimizer'
import { ReworkCausalLinker } from '../intelligence/rework-causal-linker'
import { ControlModeROIService } from '../intelligence/control-mode-roi-service'
import type { InjectionRecord } from '../intelligence/context-injection-service'

type InsightsDeps = Pick<ApiRouteDeps, 'knowledgeStoreImpl' | 'controlMode' | 'tickService'>

/**
 * Creates routes for /api/insights endpoints.
 */
export function createInsightsRouter(deps: InsightsDeps): Router {
  const router = Router()
  const analyzer = new OverridePatternAnalyzer()
  const injectionOptimizer = new InjectionOptimizer()
  const reworkLinker = new ReworkCausalLinker()
  const roiService = new ControlModeROIService()

  router.post('/override-patterns', (_req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(503).json({ error: 'Knowledge store not available' })
      return
    }

    const auditRecords = deps.knowledgeStoreImpl.listAuditLog('trust_outcome')
    const report = analyzer.analyzeOverrides(auditRecords)
    res.status(200).json(report)
  })

  router.post('/injection-efficiency', (_req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(503).json({ error: 'Knowledge store not available' })
      return
    }

    const auditRecords = deps.knowledgeStoreImpl.listAuditLog('context_injection')
    const injectionRecords: InjectionRecord[] = auditRecords.map((entry) => entry.details as InjectionRecord)
    const report = injectionOptimizer.analyzeEfficiency(injectionRecords)
    res.status(200).json(report)
  })

  router.post('/rework-analysis', (_req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(503).json({ error: 'Knowledge store not available' })
      return
    }

    const auditRecords = deps.knowledgeStoreImpl.listAuditLog()
    const report = reworkLinker.analyzeRework(auditRecords)
    res.status(200).json(report)
  })

  router.post('/control-mode-roi', (_req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(503).json({ error: 'Knowledge store not available' })
      return
    }

    const trustOutcomeEntries = deps.knowledgeStoreImpl.listAuditLog('trust_outcome')
    const coherenceIssueEntries = deps.knowledgeStoreImpl.listAuditLog('coherence_issue')
    const modeChangeEntries = deps.knowledgeStoreImpl.listAuditLog('control_mode_change')

    const currentMode = deps.controlMode.getMode()
    const currentTick = deps.tickService.currentTick()
    const intervals = roiService.buildModeIntervals(modeChangeEntries, currentMode, currentTick)

    const report = roiService.analyze(trustOutcomeEntries, coherenceIssueEntries, intervals, currentTick)
    res.status(200).json(report)
  })

  return router
}
