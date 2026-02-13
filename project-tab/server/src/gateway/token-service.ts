import type { JWTPayload } from 'jose'

import {
  JwtService,
  type IssuedToken,
  type JwtServiceOptions,
} from '../identity'

/** Default token TTL: 1 hour. */
const DEFAULT_TTL_MS = 60 * 60 * 1000

/** Token payload claims specific to project-tab sandbox tokens. */
export interface SandboxTokenClaims extends JWTPayload {
  /** Agent ID this token is scoped to. */
  agentId: string
  /** Sandbox ID (container or process). */
  sandboxId?: string
}

export type { IssuedToken } from '../identity'

/** Options for creating a TokenService. */
export interface TokenServiceOptions extends JwtServiceOptions {}

/**
 * TokenService manages JWT tokens for sandbox-to-backend authentication.
 * Each token is scoped to a specific agent and sandbox, with a short TTL.
 * Sandboxes renew tokens at 80% of TTL via POST /api/token/renew.
 */
export class TokenService extends JwtService<SandboxTokenClaims> {
  constructor(options: TokenServiceOptions = {}) {
    super({
      ...options,
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_TTL_MS,
      issuer: options.issuer ?? 'project-tab-backend',
    })
  }

  /**
   * Issue a new JWT token scoped to a specific agent.
   * Used at sandbox provision time and for token renewal.
   */
  async issueToken(
    agentId: string,
    sandboxId?: string,
    ttlMs?: number
  ): Promise<IssuedToken> {
    return this.signToken(
      {
        agentId,
        sandboxId,
      } satisfies SandboxTokenClaims,
      agentId,
      ttlMs
    )
  }

  /**
   * Validate a token and return its claims.
   * Throws if the token is expired, tampered, or invalid.
   */
  async validateToken(token: string): Promise<SandboxTokenClaims> {
    return this.verifyToken(token)
  }

  /**
   * Renew a token: validate the current token, then issue a new one
   * for the same agent/sandbox with a fresh TTL.
   */
  async renewToken(
    currentToken: string,
    agentId: string
  ): Promise<IssuedToken> {
    const claims = await this.validateToken(currentToken)

    if (claims.agentId !== agentId) {
      throw new Error(
        `Token agentId mismatch: token is for ${claims.agentId}, request is for ${agentId}`
      )
    }

    return this.issueToken(agentId, claims.sandboxId)
  }

  /** Get the secret (for testing or sharing with other services). */
  getSecret(): Uint8Array {
    return this.secret
  }

  protected validateClaims(payload: JWTPayload): SandboxTokenClaims {
    if (!payload.agentId || typeof payload.agentId !== 'string') {
      throw new Error('Token missing required agentId claim')
    }

    return payload as SandboxTokenClaims
  }
}
