import { Router } from 'express'

import type { ApiRouteDeps } from './index'
import { OverridePatternAnalyzer } from '../intelligence/override-pattern-analyzer'
import { InjectionOptimizer } from '../intelligence/injection-optimizer'
import type { InjectionRecord } from '../intelligence/context-injection-service'

type InsightsDeps = Pick<ApiRouteDeps, 'knowledgeStoreImpl'>

/**
 * Creates routes for /api/insights endpoints.
 */
export function createInsightsRouter(deps: InsightsDeps): Router {
  const router = Router()
  const analyzer = new OverridePatternAnalyzer()
  const injectionOptimizer = new InjectionOptimizer()

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

  return router
}
