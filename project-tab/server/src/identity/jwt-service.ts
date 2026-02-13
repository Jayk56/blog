import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes, randomUUID } from 'node:crypto'

/** Result of issuing a new token. */
export interface IssuedToken {
  token: string
  expiresAt: string
}

/** Shared options for JWT signing/verification services. */
export interface JwtServiceOptions {
  /** HMAC secret for signing JWTs. If not provided, a random 256-bit key is generated. */
  secret?: Uint8Array
  /** Default TTL in milliseconds. */
  defaultTtlMs?: number
  /** Issuer claim for JWTs. */
  issuer?: string
  /** Clock function for testing (returns current time in ms). */
  nowFn?: () => number
}

const DEFAULT_TTL_MS = 60 * 60 * 1000
const DEFAULT_ISSUER = 'project-tab'

/**
 * Generic HS256 JWT service with shared issue/verify mechanics.
 * Subclasses are responsible for validating and narrowing custom claims.
 */
export abstract class JwtService<TClaims extends JWTPayload> {
  protected readonly secret: Uint8Array
  protected readonly defaultTtlMs: number
  protected readonly issuer: string
  protected readonly nowFn: () => number

  constructor(options: JwtServiceOptions = {}) {
    this.secret = options.secret ?? randomBytes(32)
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS
    this.issuer = options.issuer ?? DEFAULT_ISSUER
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  async signToken(
    claims: TClaims,
    subject: string,
    ttlMs?: number
  ): Promise<IssuedToken> {
    const now = this.nowFn()
    const ttl = ttlMs ?? this.defaultTtlMs
    const expiresAtMs = now + ttl
    const expiresAt = new Date(expiresAtMs).toISOString()

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(expiresAtMs / 1000))
      .setIssuer(this.issuer)
      .setSubject(subject)
      .setJti(randomUUID())
      .sign(this.secret)

    return { token, expiresAt }
  }

  async verifyToken(token: string): Promise<TClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.issuer,
      clockTolerance: 5,
      currentDate: new Date(this.nowFn()),
    })

    return this.validateClaims(payload)
  }

  protected abstract validateClaims(payload: JWTPayload): TClaims
}
