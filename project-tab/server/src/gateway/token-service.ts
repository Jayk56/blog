import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes } from 'node:crypto'

/** Default token TTL: 1 hour. */
const DEFAULT_TTL_MS = 60 * 60 * 1000

/** Token payload claims specific to project-tab sandbox tokens. */
export interface SandboxTokenClaims extends JWTPayload {
  /** Agent ID this token is scoped to. */
  agentId: string
  /** Sandbox ID (container or process). */
  sandboxId?: string
}

/** Result of issuing a new token. */
export interface IssuedToken {
  token: string
  expiresAt: string
}

/** Options for creating a TokenService. */
export interface TokenServiceOptions {
  /** HMAC secret for signing JWTs. If not provided, a random 256-bit key is generated. */
  secret?: Uint8Array
  /** Default TTL in milliseconds. Defaults to 1 hour. */
  defaultTtlMs?: number
  /** Issuer claim for JWTs. */
  issuer?: string
  /** Clock function for testing (returns current time in ms). */
  nowFn?: () => number
}

/**
 * TokenService manages JWT tokens for sandbox-to-backend authentication.
 * Each token is scoped to a specific agent and sandbox, with a short TTL.
 * Sandboxes renew tokens at 80% of TTL via POST /api/token/renew.
 */
export class TokenService {
  private readonly secret: Uint8Array
  private readonly defaultTtlMs: number
  private readonly issuer: string
  private readonly nowFn: () => number

  constructor(options: TokenServiceOptions = {}) {
    this.secret = options.secret ?? randomBytes(32)
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS
    this.issuer = options.issuer ?? 'project-tab-backend'
    this.nowFn = options.nowFn ?? (() => Date.now())
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
    const now = this.nowFn()
    const ttl = ttlMs ?? this.defaultTtlMs
    const expiresAtMs = now + ttl
    const expiresAt = new Date(expiresAtMs).toISOString()

    const jwt = await new SignJWT({
      agentId,
      sandboxId,
    } satisfies SandboxTokenClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(expiresAtMs / 1000))
      .setIssuer(this.issuer)
      .setSubject(agentId)
      .sign(this.secret)

    return { token: jwt, expiresAt }
  }

  /**
   * Validate a token and return its claims.
   * Throws if the token is expired, tampered, or invalid.
   */
  async validateToken(token: string): Promise<SandboxTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.issuer,
      clockTolerance: 5, // 5 seconds of clock skew tolerance
      currentDate: new Date(this.nowFn()),
    })

    if (!payload.agentId || typeof payload.agentId !== 'string') {
      throw new Error('Token missing required agentId claim')
    }

    return payload as SandboxTokenClaims
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
}
