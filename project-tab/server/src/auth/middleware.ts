import type { Request, RequestHandler } from 'express'
import { errors as joseErrors } from 'jose'

import type { AuthRole } from './auth-service'
import type { AuthService, UserTokenClaims } from './auth-service'

/** Authenticated user context attached to an Express request. */
export interface AuthenticatedUser {
  userId: string
  role: AuthRole
  scopes: string[]
}

/** Request type including attached auth context. */
export type AuthenticatedRequest = Request & {
  auth?: AuthenticatedUser
}

/** Options for creating the API auth middleware. */
export interface AuthMiddlewareOptions {
  authService: AuthService
}

/**
 * Enforces Authorization: Bearer <token> for protected API routes.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): RequestHandler {
  return (req, res, next) => {
    const token = getBearerToken(req.headers.authorization)
    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization bearer token',
      })
      return
    }

    options.authService.validateToken(token).then((claims) => {
      attachAuthContext(req, claims)
      next()
    }).catch((err: unknown) => {
      const message = (err as Error).message

      const isAuthError =
        err instanceof joseErrors.JWTExpired ||
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWTClaimValidationFailed ||
        err instanceof joseErrors.JWSInvalid ||
        err instanceof joseErrors.JWTInvalid ||
        err instanceof joseErrors.JOSEError ||
        message.includes('missing required')

      if (isAuthError) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Token validation failed',
        })
        return
      }

      res.status(500).json({
        error: 'Authentication failed',
        message,
      })
    })
  }
}

/** Reads auth context previously attached by createAuthMiddleware(). */
export function getRequestAuth(req: Request): AuthenticatedUser | null {
  return (req as AuthenticatedRequest).auth ?? null
}

function getBearerToken(headerValue: string | string[] | undefined): string | null {
  if (!headerValue) {
    return null
  }

  const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!rawValue || typeof rawValue !== 'string') {
    return null
  }

  const [scheme, value] = rawValue.trim().split(/\s+/, 2)
  if (!scheme || !value) {
    return null
  }

  if (scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return value
}

function attachAuthContext(req: Request, claims: UserTokenClaims): void {
  const out: AuthenticatedUser = {
    userId: claims.userId,
    role: claims.role,
    scopes: Array.isArray(claims.scopes)
      ? claims.scopes.filter((s): s is string => typeof s === 'string')
      : [],
  }

  ;(req as AuthenticatedRequest).auth = out
}
