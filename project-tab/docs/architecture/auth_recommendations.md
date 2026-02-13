# Auth Module Architecture Recommendations

## Module Profile

**Files**: `auth-service.ts`, `middleware.ts`, `index.ts`

**Fan-out** (imports from other modules):
- `jose` (external: SignJWT, jwtVerify, JWTPayload, errors)
- `node:crypto` (randomBytes)
- `express` (Request, RequestHandler)

No imports from other internal project modules. This module is a **leaf dependency** with zero internal fan-out.

**Fan-in** (other modules importing from auth):
- `src/routes/index.ts` imports `AuthService` type and `createAuthMiddleware`
- `src/routes/auth.ts` imports `AuthService`, `createAuthMiddleware`, `getRequestAuth`
- `src/index.ts` imports `AuthService` class

**Instability**: Low. Pure leaf module with no internal dependencies. Only consumed by routes and bootstrap.

**Export ratio**: Clean -- `index.ts` exports 2 classes/functions and 6 type aliases. All exports are intentional production API.

## Depth Assessment

This module is **appropriately shallow** for its purpose:

- `auth-service.ts` (119 lines): JWT issue/validate/refresh cycle. Clean, focused implementation.
- `middleware.ts` (107 lines): Express middleware for bearer token validation. Includes `getRequestAuth()` for downstream handlers.
- `index.ts` (17 lines): Barrel re-export.

**Interface-to-implementation ratio**: Good. The public API is small (3 methods on AuthService, 2 exports from middleware) and the implementation is proportional.

## Boundary Health

**Clean boundaries**: This module imports nothing from the rest of the project. It's self-contained with only external dependencies (jose, express, node:crypto).

**Concerns**:

1. **Structural duplication with `gateway/token-service.ts`**: Both AuthService and TokenService:
   - Use `jose` SignJWT/jwtVerify
   - Accept injectable `secret`, `defaultTtlMs`, `issuer`, `nowFn`
   - Expose `issueToken()`, `validateToken()`, `renewToken()`/`refreshToken()`
   - Expose `getSecret()` for testing
   - Use the same validation pattern (clock tolerance, issuer check, claim validation)

   The files differ only in:
   - Claims type: `UserTokenClaims` (userId, role, scopes) vs `SandboxTokenClaims` (agentId, sandboxId)
   - Default TTL: 8 hours vs 1 hour
   - Default issuer: `project-tab-api` vs `project-tab-backend`
   - Method naming: `refreshToken()` vs `renewToken()`

2. **Jose error handling duplication**: The pattern for checking `instanceof joseErrors.JWTExpired || instanceof joseErrors.JWSSignatureVerificationFailed || ...` is duplicated in three places:
   - `auth/middleware.ts:44-52`
   - `routes/token.ts:49-57`
   - Both check the same 6 jose error types

3. **`AuthenticatedRequest` type augmentation**: `middleware.ts:15-17` extends `Request` with an optional `auth` property using intersection type. This works but the pattern of casting `(req as AuthenticatedRequest).auth` at line 105 is fragile.

## Co-Change Partners

**Expected**:
- `auth/auth-service.ts` <-> `auth/middleware.ts`: middleware validates tokens issued by the service
- `auth/` <-> `routes/auth.ts`: route handlers call service methods

**Surprising**:
- `auth/auth-service.ts` <-> `gateway/token-service.ts`: structurally identical services that should co-evolve when security policies change

## Specific Recommendations

### 1. Unify with TokenService into a generic JWT service (HIGH)

**Problem**: `auth/auth-service.ts` and `gateway/token-service.ts` are ~90% identical in structure and logic. Security-sensitive code should not be duplicated because fixes (e.g., tightening clock tolerance, adding audience validation, rotating algorithms) must be applied to both.

**Fix**: Create `src/auth/jwt-service.ts` as a generic base:
```typescript
interface JwtServiceOptions<T extends JWTPayload> {
  secret?: Uint8Array
  defaultTtlMs?: number
  issuer?: string
  nowFn?: () => number
  buildClaims: (input: unknown) => T
  validateClaims: (payload: JWTPayload) => T
}

class JwtService<T extends JWTPayload> {
  issueToken(claims: T, ttlMs?: number): Promise<IssuedToken>
  validateToken(token: string): Promise<T>
  renewToken(token: string, validateRenewal?: (claims: T) => void): Promise<IssuedToken>
}
```

Then `AuthService = JwtService<UserTokenClaims>` and `TokenService = JwtService<SandboxTokenClaims>` become thin wrappers or factory functions. Both would share the same signing, verification, and error-handling code.

### 2. Extract jose error classification helper (MEDIUM)

**Problem**: The pattern of checking `err instanceof joseErrors.JWTExpired || err instanceof joseErrors.JWSSignatureVerification || ...` is duplicated in `auth/middleware.ts:44-52` and `routes/token.ts:49-57`. Both also check `message.includes('missing required')` or `message.includes('mismatch')`.

**Fix**: Create a `isJoseAuthError(err: unknown): boolean` helper in `auth/` and export it. Both middleware.ts and routes/token.ts can use it. This ensures a consistent set of errors is treated as 401 vs 500.

### 3. Use Express module augmentation instead of intersection type (LOW)

**Problem**: `AuthenticatedRequest` at `middleware.ts:15-17` uses `Request & { auth?: AuthenticatedUser }`. The `getRequestAuth()` function at line 70 casts to this type. This works but is a non-standard pattern.

**Fix**: Use Express declaration merging to add `auth` to the Request type globally:
```typescript
declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser
    }
  }
}
```
This eliminates the need for casting in `getRequestAuth()` and makes `req.auth` available in any route handler without importing the intersection type.

### 4. Consider adding role-based access control middleware (LOW)

**Problem**: The `AuthRole` type defines `admin | operator | viewer` but no middleware checks roles. All authenticated users have equal access to all endpoints.

**Fix**: When RBAC is needed, add a `requireRole(role: AuthRole)` middleware factory that checks `req.auth.role`. For now, this is informational -- the role field is in place but not enforced.
