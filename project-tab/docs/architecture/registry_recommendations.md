# Registry Module Architecture Recommendations

## Module Profile

**Files**: `agent-registry.ts` (1 file, 72 lines)

**Fan-out** (imports from other modules):
- `../types` -- `AgentHandle`, `SandboxInfo`

**Fan-in** (other modules importing from registry):
- `src/index.ts` imports `AgentRegistry as AgentRegistryImpl` (line 21)

**Instability**: Low. Minimal dependencies, consumed by one file. Very stable module.

**Export ratio**: Low -- exports 1 class (`AgentRegistry`) and 1 interface (`RegisteredAgent`).

## Depth Assessment

This module is **shallow**: 72 lines, 8 public methods, all trivially wrapping a `Map<string, RegisteredAgent>`. The methods are:
- `register()`, `unregister()`, `getById()`, `getAll()`, `size`, `updateHandle()`, `updateSandbox()`, `killAll()`

There is no complex logic, no persistence, no validation beyond existence checks. The class is essentially a type-safe Map wrapper.

**Interface-to-implementation ratio**: Very low -- almost 1:1. The interface IS the implementation.

## Boundary Health

**Clean boundaries**: The module imports only `AgentHandle` and `SandboxInfo` from `../types`. No leaked internals. No transitive dependencies.

**Key structural issue**: The `AgentRegistry` class in `src/registry/agent-registry.ts` has a **different interface** than the `AgentRegistry` interface defined in `src/routes/index.ts:29-35`. The routes interface defines:
```typescript
interface AgentRegistry {
  getHandle(agentId: string): AgentHandle | null
  listHandles(filter?): AgentHandle[]
  registerHandle(handle: AgentHandle): void
  updateHandle(agentId: string, updates: Partial<AgentHandle>): void
  removeHandle(agentId: string): void
}
```

But the actual class uses different method names:
```typescript
class AgentRegistry {
  register(handle: AgentHandle, sandbox: SandboxInfo): void
  unregister(agentId: string): boolean
  getById(agentId: string): RegisteredAgent | undefined
  getAll(): RegisteredAgent[]
  updateHandle(agentId: string, handle: AgentHandle): void
  updateSandbox(agentId: string, sandbox: Partial<SandboxInfo>): void
  killAll(): string[]
}
```

This mismatch is bridged by a manual adapter in `src/index.ts:77-109` that wraps the class to match the routes interface. The adapter adds logic like filtering by status/pluginName and fabricating default SandboxInfo on register.

## Co-Change Partners

**Expected**:
- `registry/agent-registry.ts` <-> `routes/index.ts` (AgentRegistry interface) <-> `index.ts` (adapter bridge)

**Surprising**: Due to the adapter pattern in `index.ts`, any method signature change to either the class or the routes interface requires changing the bridge code. This is a three-way co-change obligation.

## Specific Recommendations

### 1. Align AgentRegistry class to the routes interface (HIGH)

**Problem**: The class and the routes-defined interface have different method names and signatures. An adapter bridge in `index.ts:77-109` (33 lines) manually translates between them.

**Fix**: Rename the class methods to match what routes expect:
- `register()` -> `registerHandle()` (drop the mandatory `sandbox` parameter; make it optional or use a default)
- `unregister()` -> `removeHandle()`
- `getById()` -> `getHandle()` (return `AgentHandle | null` instead of `RegisteredAgent | undefined`)
- `getAll()` -> `listHandles()` (with optional filter support)

This eliminates the 33-line adapter bridge in `index.ts` and removes the three-way co-change obligation. The class would directly implement the `AgentRegistry` interface from routes.

### 2. Move the AgentRegistry interface to `types/service-interfaces.ts` (HIGH)

**Problem**: The `AgentRegistry` interface is defined in `src/routes/index.ts`. This is an awkward location -- it's a service contract, not a route concern. Other modules (intelligence/context-injection-service.ts) also depend on this interface.

**Fix**: Move `AgentRegistry`, `AgentGateway`, `KnowledgeStore`, `CheckpointStore`, `ControlModeManager` interfaces to `src/types/service-interfaces.ts`. Have `routes/index.ts` re-export them for backward compatibility, then gradually update imports. (This recommendation overlaps with intelligence recommendation #1.)

### 3. Consider whether SandboxInfo tracking belongs here (MEDIUM)

**Problem**: `RegisteredAgent` bundles `AgentHandle` + `SandboxInfo`, but `SandboxInfo` is only set once (at registration in `index.ts`) with a dummy value:
```typescript
transport: { type: 'in_process', eventSink: () => {} },
providerType: 'local_process',
lastHeartbeatAt: null
```
The `updateSandbox()` method exists but is never called anywhere in the codebase.

**Fix**: Remove `SandboxInfo` from the registry. If sandbox tracking is needed in the future, it can live in the gateway module where sandbox lifecycle is actually managed. This simplifies the registry to just `Map<string, AgentHandle>` and removes the `RegisteredAgent` wrapper type entirely.

### 4. Remove `killAll()` method (LOW)

**Problem**: `killAll()` clears the registry and returns IDs, but the caller must issue actual kill commands separately. This method is never called in production code (shutdown in `index.ts:580-594` iterates handles manually via `registry.listHandles()` and calls `plugin.kill()` per agent).

**Fix**: Remove `killAll()`. The shutdown procedure already handles this correctly without it.
