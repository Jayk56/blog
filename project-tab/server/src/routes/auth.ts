import { Router } from 'express'
import { z } from 'zod'

import type { AuthService } from '../auth'
import { createAuthMiddleware, getRequestAuth } from '../auth'
import { parseBody } from './utils'

/** Dependencies for /api/auth routes. */
export interface AuthRouteDeps {
  authService: AuthService
}

const loginRequestSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'operator', 'viewer']).default('operator'),
  scopes: z.array(z.string()).optional(),
  ttlMs: z.number().int().positive().max(7 * 24 * 60 * 60 * 1000).optional(),
})

/**
 * Creates routes for API-user authentication.
 */
export function createAuthRouter(deps: AuthRouteDeps): Router {
  const router = Router()
  const requireAuth = createAuthMiddleware({ authService: deps.authService })

  // Development-friendly token issuance for frontend/API clients.
  router.post('/login', (req, res) => {
    const body = parseBody(req, res, loginRequestSchema)
    if (!body) {
      return
    }

    deps.authService.issueToken({
      userId: body.userId,
      role: body.role ?? 'operator',
      scopes: body.scopes,
    }, body.ttlMs).then((issued) => {
      res.status(200).json({
        accessToken: issued.token,
        tokenType: 'Bearer',
        expiresAt: issued.expiresAt,
        user: {
          userId: body.userId,
          role: body.role,
          scopes: body.scopes ?? [],
        },
      })
    }).catch((err: Error) => {
      res.status(500).json({ error: 'Login failed', message: err.message })
    })
  })

  router.use('/me', requireAuth)
  router.get('/me', (req, res) => {
    const auth = getRequestAuth(req)
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing auth context' })
      return
    }

    res.status(200).json({ user: auth })
  })

  router.use('/refresh', requireAuth)
  router.post('/refresh', (req, res) => {
    const authHeader = req.headers.authorization
    const rawHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader
    const [scheme, value] = rawHeader?.trim().split(/\s+/, 2) ?? []
    const token = scheme?.toLowerCase() === 'bearer' ? (value ?? '') : ''
    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization bearer token',
      })
      return
    }

    deps.authService.refreshToken(token).then((issued) => {
      res.status(200).json({
        accessToken: issued.token,
        tokenType: 'Bearer',
        expiresAt: issued.expiresAt,
      })
    }).catch((err: Error) => {
      res.status(401).json({ error: 'Unauthorized', message: err.message })
    })
  })

  return router
}
