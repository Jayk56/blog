# Architecture Tech Debt Register

Updated: February 13, 2026

The following P3 items are intentionally deferred and accepted as technical debt for now.

## Debt Register
- `routes` dependency shape: keep `ApiRouteDeps` as the top-level composition contract in `server/src/routes/index.ts` while route modules continue using `Pick<ApiRouteDeps, ...>`.
  Reason: current route-level picks already reduced coupling enough for near-term work; full contract split is lower priority.
  Risk: continued central dependency churn in `ApiRouteDeps`.
  Revisit trigger: next time a new route family is added or `ApiRouteDeps` changes in more than 3 files.
- `ContextInjectionService` dependency facade: defer introducing a dedicated `ContextInjectionDeps` object in `server/src/intelligence/context-injection-service.ts`.
  Reason: existing constructor dependencies are stable and test coverage is adequate for current scope.
  Risk: constructor coupling may grow as new intelligence features are added.
  Revisit trigger: next context policy change requiring new external service dependencies.
- Auth request typing ergonomics: defer Express declaration-merging for `req.auth` and keep current middleware casting approach in `server/src/auth/middleware.ts`.
  Reason: behavior is correct and low-risk; this is mostly a typing ergonomics improvement.
  Risk: type casts remain repetitive and can hide typing drift.
  Revisit trigger: next auth middleware expansion (RBAC/scopes or additional auth context fields).
- RBAC enforcement middleware: defer role/scope authorization middleware beyond authentication.
  Reason: current endpoints do not yet require differentiated permissions in production usage.
  Risk: authorization gaps if privileged endpoints are introduced without role checks.
  Revisit trigger: first endpoint with admin/operator-only semantics.
- Type/schema deduplication: defer full unification between `server/src/types/events.ts` and `server/src/validation/schemas.ts`.
  Reason: migration risk is non-trivial and current duplication is manageable short-term.
  Risk: drift between compile-time and runtime contracts.
  Revisit trigger: next event payload shape change or new event type addition.
- Internal helper exposure cleanup: defer removing the `isEmbeddable` export from `server/src/intelligence/coherence-monitor.ts`.
  Reason: low impact and no current external misuse.
  Risk: accidental external coupling to an internal helper.
  Revisit trigger: next `coherence-monitor` API cleanup pass.

## Exit Criteria
- Convert accepted items into scheduled implementation tasks before the next major architecture refactor cycle.
- Re-evaluate this register during the next architecture review and either:
  1. implement the items, or
  2. renew the debt acceptance with updated risk notes.
