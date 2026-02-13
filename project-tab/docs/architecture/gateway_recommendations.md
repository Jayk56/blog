# Gateway Module Architecture Recommendations

## Module Profile

**Files**: `local-http-plugin.ts`, `container-plugin.ts`, `local-process-plugin.ts`, `event-stream-client.ts`, `child-process-manager.ts`, `container-orchestrator.ts`, `mcp-provisioner.ts`, `volume-recovery.ts`, `token-service.ts`

**Fan-out** (imports from other modules):
- `../types/*` -- AgentBrief, AgentHandle, AgentPlugin, ContextInjection, KillRequest/Response, PluginCapabilities, Resolution, SerializedAgentState, transport types, SandboxBootstrap
- `../bus` (EventBus) -- used by LocalProcessPlugin, EventStreamClient
- `../validation/schemas` (validateAdapterEvent) -- used by EventStreamClient
- `../validation/quarantine` (quarantineEvent) -- used by EventStreamClient
- `../types/events` (ArtifactEvent) -- used by VolumeRecoveryService
- `../types/brief` (MCPServerConfig, WorkspaceMount) -- used by MCPProvisioner

**Fan-in** (other modules importing from gateway):
- `src/index.ts` imports ChildProcessManager, LocalProcessPlugin, TokenService, and conditionally ContainerOrchestrator, ContainerPlugin, MCPProvisioner, VolumeRecoveryService
- `src/routes/index.ts` imports TokenService type
- `src/routes/token.ts` imports TokenService
- `src/routes/events.ts` references EventFilter (via intelligence)

**Instability**: High. This module has high fan-out (many type imports) and medium fan-in (consumed mainly by index.ts and routes). It's the most volatile module -- changes to adapter protocol or sandbox lifecycle propagate through here.

**Export ratio**: Low-medium. Most classes are consumed directly (not through a barrel). No `gateway/index.ts` barrel file exists -- each file is imported individually.

## Depth Assessment

This module has **good depth** with clear layering:

**Layer 1 -- Infrastructure managers** (deep, well-encapsulated):
- `ChildProcessManager` (204 lines): Port allocation, process spawning, health polling. Clean interface.
- `ContainerOrchestrator` (329 lines): Docker lifecycle, port allocation, health polling. Mirrors ChildProcessManager's pattern well.

**Layer 2 -- Plugin implementations** (moderate depth):
- `LocalHttpPlugin` (136 lines): Thin HTTP client. Low depth but appropriately so -- it's a transport adapter.
- `ContainerPlugin` (266 lines): Wraps ContainerOrchestrator + HTTP calls. Manages per-agent container records.
- `LocalProcessPlugin` (308 lines): Highest complexity in gateway -- composes ChildProcessManager + LocalHttpPlugin + EventStreamClient per agent, handles crash detection with deduplication.

**Layer 3 -- Cross-cutting services** (variable depth):
- `EventStreamClient` (218 lines): WS reconnection, event validation, agentId verification, quarantine integration. Good depth.
- `MCPProvisioner` (329 lines): Three-source MCP resolution. Medium depth, well-structured.
- `VolumeRecoveryService` (355 lines): Docker volume scan + artifact cross-referencing. Good depth.
- `TokenService` (121 lines): JWT issuance/validation/renewal. Appropriately shallow.

## Boundary Health

**Strengths**:
1. No barrel export file (`gateway/index.ts` does not exist) -- consumers import exactly what they need. This is actually healthier than a promiscuous barrel.
2. `AgentPlugin` interface (in `types/plugin.ts`) provides a clean abstraction boundary. All three plugin implementations honor it.
3. `AdapterHttpError` is defined in `local-http-plugin.ts` and reused by `container-plugin.ts` -- appropriate sharing within the module.

**Concerns**:

1. **LocalProcessPlugin imports from local-http-plugin at the class level** (`local-process-plugin.ts:16-17`). It creates a `LocalHttpPlugin` instance per agent inside `spawn()`. This is a composition pattern, not just a type import. If LocalHttpPlugin changes its constructor signature, LocalProcessPlugin breaks.

2. **EventStreamClient depends on validation/quarantine**, reaching outside the gateway boundary into the validation module. The validation concern could be injected via callback instead.

3. **VolumeRecoveryService imports ArtifactEvent from types/events** to cross-reference volume files against known artifacts. This is a read-only dependency but creates a coupling to the event schema that may be surprising.

4. **TokenService vs AuthService duplication**: `gateway/token-service.ts` and `auth/auth-service.ts` are structurally near-identical (both use `jose`, both do JWT issue/validate/renew, both have injectable clock/secret). They differ only in claims shape and TTL defaults.

## Co-Change Partners

**Expected co-change pairs**:
- `local-http-plugin.ts` <-> `container-plugin.ts`: They share the HTTP-to-shim protocol. A new shim endpoint requires changes to both.
- `child-process-manager.ts` <-> `container-orchestrator.ts`: Parallel implementations of port allocation + health polling + exit monitoring.
- `local-process-plugin.ts` <-> `local-http-plugin.ts` <-> `event-stream-client.ts`: LocalProcessPlugin composes both.

**Surprising co-change**:
- `token-service.ts` <-> `auth/auth-service.ts`: Any change to JWT structure or validation semantics should be mirrored in both. They're effectively the same service with different claim types.
- `mcp-provisioner.ts` <-> `types/brief.ts`: MCPServerConfig lives in brief.ts but is primarily consumed and processed by MCPProvisioner. Schema changes to MCPServerConfig always require MCPProvisioner updates.

## Specific Recommendations

### 1. Unify TokenService and AuthService into a single generic JWT service (HIGH)

**Problem**: `gateway/token-service.ts` (121 lines) and `auth/auth-service.ts` (119 lines) are structurally near-identical:
- Both use `jose` SignJWT/jwtVerify
- Both have `issueToken()`, `validateToken()`, `renewToken()`/`refreshToken()`
- Both accept injectable secret, TTL, issuer, clock
- Both export `getSecret()` for testing
- The only difference is the claims shape (`SandboxTokenClaims` vs `UserTokenClaims`)

**Fix**: Create a generic `JwtService<TClaims>` base that handles signing, verification, and renewal. Instantiate it twice with different claim types and TTL defaults. This eliminates ~100 lines of duplicated logic and ensures security fixes (e.g., clock tolerance, validation) apply uniformly.

### 2. Extract shared infrastructure patterns from ChildProcessManager and ContainerOrchestrator (MEDIUM)

**Problem**: `child-process-manager.ts` and `container-orchestrator.ts` duplicate three patterns:
- Port allocation pool (both use `allocatedPorts: Set<number>`, `allocatePort()`, `releasePort()`) -- nearly identical implementations in different port ranges (9100-9199 vs 9200-9299)
- Health polling (`pollHealth()` method) -- identical logic
- Exit listener tracking (`exitListeners: Map`) -- identical pattern

**Fix**: Extract a `PortPool` class and a `healthPoll()` utility function. The port range can be parameterized. This reduces duplication by ~60 lines and ensures health polling timeout behavior is consistent.

### 3. Inject validation into EventStreamClient instead of direct import (MEDIUM)

**Problem**: `event-stream-client.ts` imports `validateAdapterEvent` from `../validation/schemas` and `quarantineEvent` from `../validation/quarantine`. This creates a dependency from gateway -> validation that could be avoided.

**Fix**: Accept a `validateEvent: (raw: unknown) => AdapterEvent | null` callback in `EventStreamClientOptions`. The wiring in `index.ts` or `local-process-plugin.ts` can close over the validation/quarantine functions. This makes EventStreamClient testable without importing validation schemas and removes the cross-boundary dependency.

### 4. Add a gateway barrel export file (MEDIUM)

**Problem**: No `gateway/index.ts` exists. Consumers import individual files:
- `src/index.ts` has 8 separate imports from gateway files
- Some imports are conditional (Docker plugin is dynamically imported)

**Fix**: Create `gateway/index.ts` that exports the public API surface. This makes it easier to see what the module exposes and control what leaks. The dynamic Docker imports can remain as direct file imports since they're lazy-loaded.

Recommended exports:
```typescript
export { LocalHttpPlugin, AdapterHttpError } from './local-http-plugin'
export { ContainerPlugin } from './container-plugin'
export { LocalProcessPlugin } from './local-process-plugin'
export { EventStreamClient } from './event-stream-client'
export { ChildProcessManager } from './child-process-manager'
export { ContainerOrchestrator } from './container-orchestrator'
export { MCPProvisioner, createDefaultProvisioner } from './mcp-provisioner'
export { VolumeRecoveryService } from './volume-recovery'
export { TokenService } from './token-service'
```

### 5. Consider merging LocalHttpPlugin into LocalProcessPlugin (LOW)

**Problem**: `LocalProcessPlugin` creates a new `LocalHttpPlugin` instance per agent inside `spawn()` (line 108). The `LocalHttpPlugin` is never used standalone in production -- it only exists as a building block for `LocalProcessPlugin`. The `ContainerPlugin` has its own HTTP client logic (duplicate `post()` method).

**Fix**: If `LocalHttpPlugin` is only used as an internal implementation detail of `LocalProcessPlugin`, inline its `post()` method. Alternatively, extract a shared `AdapterHttpClient` class that both `LocalProcessPlugin` and `ContainerPlugin` can use, replacing the duplicated `post()` methods in both `local-http-plugin.ts:113-134` and `container-plugin.ts:240-264`.

### 6. Reduce VolumeRecoveryService skip-path bug (LOW)

**Problem**: In `volume-recovery.ts:128-131`, the skip case sets `path` to `action.artifactId` instead of the file path. This is then overwritten at lines 172-182 with a second pass that fixes the paths. The code works but the double-pass is confusing.

**Fix**: Build `skipped` entries correctly in the first pass and remove the second pass at lines 172-182.
