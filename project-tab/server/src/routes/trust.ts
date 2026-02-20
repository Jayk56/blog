import { Router } from 'express'

import type { ApiRouteDeps } from './index'
import { listProfiles, getProfile, isCalibrationProfileName } from '../intelligence/calibration-profiles'
import type { CalibrationProfileName } from '../intelligence/calibration-profiles'

type TrustDeps = Pick<ApiRouteDeps, 'trustEngine' | 'wsHub' | 'knowledgeStore'>

/** Active profile name — stored in-memory (defaults to balanced). */
let activeProfileName: CalibrationProfileName = 'balanced'

/**
 * Creates routes for /api/trust endpoints.
 */
export function createTrustRouter(deps: TrustDeps): Router {
  const router = Router()

  // GET /api/trust/profiles — list all available calibration profiles
  router.get('/profiles', (_req, res) => {
    const profiles = listProfiles().map(p => ({
      ...p,
      active: p.name === activeProfileName,
    }))
    res.status(200).json({ profiles, activeProfile: activeProfileName })
  })

  // POST /api/trust/profile/:name — activate a calibration profile
  router.post('/profile/:name', (req, res) => {
    const name = req.params.name

    if (!isCalibrationProfileName(name)) {
      res.status(400).json({ error: `Invalid profile name: "${name}". Must be one of: conservative, balanced, permissive` })
      return
    }

    const profile = getProfile(name)
    const previousProfile = activeProfileName
    activeProfileName = name

    deps.trustEngine.reconfigure(profile.config)

    // Audit log
    deps.knowledgeStore.appendAuditLog?.(
      'trust_calibration',
      name,
      'profile_activated',
      undefined,
      { previousProfile, newProfile: name, config: profile.config }
    )

    // Broadcast config change to frontend
    deps.wsHub.broadcast({
      type: 'trust_config_update',
      profile: name,
      displayName: profile.displayName,
      config: deps.trustEngine.getConfig(),
    })

    res.status(200).json({
      activated: true,
      profile: name,
      displayName: profile.displayName,
      config: deps.trustEngine.getConfig(),
    })
  })

  // GET /api/trust/:agentId — existing per-agent trust endpoint
  router.get('/:agentId', (req, res) => {
    const agentId = req.params.agentId
    const score = deps.trustEngine.getScore(agentId)

    if (score === undefined) {
      res.status(404).json({ error: 'Agent trust profile not found' })
      return
    }

    const domainScoresMap = deps.trustEngine.getDomainScores(agentId)
    const domainScores = Object.fromEntries(domainScoresMap)

    res.status(200).json({
      agentId,
      score,
      domainScores,
      config: deps.trustEngine.getConfig()
    })
  })

  return router
}
