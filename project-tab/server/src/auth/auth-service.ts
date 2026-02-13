import type { JWTPayload } from 'jose'

import {
  JwtService,
  type IssuedToken,
  type JwtServiceOptions,
} from '../identity'

/** Supported API roles for frontend users/operators. */
export type AuthRole = 'admin' | 'operator' | 'viewer'

/** JWT claims for authenticated API users. */
export interface UserTokenClaims extends JWTPayload {
  userId: string
  role: AuthRole
  scopes?: string[]
}

/** Result returned when issuing a user auth token. */
export type IssuedUserToken = IssuedToken

/** Input for token issuance. */
export interface IssueUserTokenInput {
  userId: string
  role: AuthRole
  scopes?: string[]
}

/** Options for creating an AuthService. */
export interface AuthServiceOptions extends JwtServiceOptions {}

/** Default API auth token TTL: 8 hours. */
const DEFAULT_AUTH_TTL_MS = 8 * 60 * 60 * 1000

/**
 * Issues and validates JWT tokens used for frontend/API authentication.
 */
export class AuthService extends JwtService<UserTokenClaims> {
  constructor(options: AuthServiceOptions = {}) {
    super({
      ...options,
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_AUTH_TTL_MS,
      issuer: options.issuer ?? 'project-tab-api',
    })
  }

  async issueToken(
    input: IssueUserTokenInput,
    ttlMs?: number
  ): Promise<IssuedUserToken> {
    return this.signToken(
      {
        userId: input.userId,
        role: input.role,
        scopes: input.scopes,
      } satisfies UserTokenClaims,
      input.userId,
      ttlMs
    )
  }

  async validateToken(token: string): Promise<UserTokenClaims> {
    return this.verifyToken(token)
  }

  async refreshToken(currentToken: string): Promise<IssuedUserToken> {
    const claims = await this.validateToken(currentToken)

    return this.issueToken({
      userId: claims.userId,
      role: claims.role,
      scopes: claims.scopes,
    })
  }

  /** Exposed for tests and service composition. */
  getSecret(): Uint8Array {
    return this.secret
  }

  protected validateClaims(payload: JWTPayload): UserTokenClaims {
    if (!payload.userId || typeof payload.userId !== 'string') {
      throw new Error('Token missing required userId claim')
    }

    if (!payload.role || !isAuthRole(payload.role)) {
      throw new Error('Token missing required role claim')
    }

    if (payload.scopes !== undefined && !Array.isArray(payload.scopes)) {
      throw new Error('Token scopes claim must be an array when provided')
    }

    return payload as UserTokenClaims
  }
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === 'admin' || value === 'operator' || value === 'viewer'
}
