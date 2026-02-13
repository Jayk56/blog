import { describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'

import { AuthService } from '../../src/auth'

const TEST_SECRET = new Uint8Array(32).fill(7)

describe('AuthService', () => {
  it('issues and validates a user token', async () => {
    const service = new AuthService({
      secret: TEST_SECRET,
      issuer: 'test-api',
      defaultTtlMs: 60_000,
    })

    const issued = await service.issueToken({
      userId: 'user-1',
      role: 'admin',
      scopes: ['agents:write', 'decisions:write'],
    })

    const claims = await service.validateToken(issued.token)
    expect(claims.userId).toBe('user-1')
    expect(claims.role).toBe('admin')
    expect(claims.scopes).toEqual(['agents:write', 'decisions:write'])
  })

  it('refreshes a valid token with fresh expiry', async () => {
    let now = 1_000_000
    const service = new AuthService({
      secret: TEST_SECRET,
      issuer: 'test-api',
      defaultTtlMs: 60_000,
      nowFn: () => now,
    })

    const original = await service.issueToken({
      userId: 'user-2',
      role: 'operator',
    })

    now += 20_000
    const refreshed = await service.refreshToken(original.token)
    expect(refreshed.token).not.toBe(original.token)

    const claims = await service.validateToken(refreshed.token)
    expect(claims.userId).toBe('user-2')
    expect(claims.role).toBe('operator')
  })

  it('rejects tokens with invalid signatures', async () => {
    const serviceA = new AuthService({ secret: new Uint8Array(32).fill(1), issuer: 'test-api' })
    const serviceB = new AuthService({ secret: new Uint8Array(32).fill(2), issuer: 'test-api' })

    const token = await serviceA.issueToken({ userId: 'user-3', role: 'viewer' })
    await expect(serviceB.validateToken(token.token)).rejects.toThrow()
  })

  it('rejects tokens missing required claims', async () => {
    const service = new AuthService({ secret: TEST_SECRET, issuer: 'test-api' })

    const nowSec = Math.floor(Date.now() / 1000)
    const malformed = await new SignJWT({
      role: 'admin',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 60)
      .setIssuer('test-api')
      .sign(TEST_SECRET)

    await expect(service.validateToken(malformed)).rejects.toThrow('userId')
  })
})
