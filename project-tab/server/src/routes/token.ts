import { Router } from 'express'
import { errors as joseErrors } from 'jose'

import type { TokenService } from '../gateway/token-service'

/** Dependencies for the token renewal route. */
export interface TokenRouteDeps {
  tokenService: TokenService
}

/**
 * Creates routes for POST /api/token/renew.
 * Called by adapter shims in sandboxes when their backend token is
 * approaching expiry (typically at 80% of TTL elapsed).
 */
export function createTokenRouter(deps: TokenRouteDeps): Router {
  const router = Router()

  router.post('/renew', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const agentId = body.agentId as string | undefined
    const currentToken = body.currentToken as string | undefined

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid agentId' })
      return
    }

    if (!currentToken || typeof currentToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid currentToken' })
      return
    }

    try {
      const { token, expiresAt } = await deps.tokenService.renewToken(
        currentToken,
        agentId
      )

      res.status(200).json({
        backendToken: token,
        tokenExpiresAt: expiresAt,
      })
    } catch (err) {
      const message = (err as Error).message

      // jose errors (expired, bad signature, invalid format) and
      // our own validation errors (agentId mismatch) are all 401
      const isAuthError =
        err instanceof joseErrors.JWTExpired ||
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWTClaimValidationFailed ||
        err instanceof joseErrors.JWSInvalid ||
        err instanceof joseErrors.JWTInvalid ||
        err instanceof joseErrors.JOSEError ||
        message.includes('mismatch') ||
        message.includes('missing required')

      if (isAuthError) {
        res.status(401).json({ error: 'Token validation failed', message })
        return
      }

      res.status(500).json({ error: 'Token renewal failed', message })
    }
  })

  return router
}
