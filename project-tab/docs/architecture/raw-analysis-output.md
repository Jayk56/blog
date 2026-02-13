# Architecture Analysis — Raw Output

Generated: 2026-02-12
Target: `project-tab/server/src/`

---

## 1. Co-Change Coupling

```
================================================================
  Co-Change Coupling Report — project-tab/server/src
================================================================

Total commits analyzed: 3

── Per-Module Commit Counts ──────────────────────────────────
  Module               Commits
  ------               -------
  top-level            3
  routes               3
  gateway              3
  validation           2
  types                2
  intelligence         2
  registry             1

── Co-Change Coupling Matrix ─────────────────────────────────
  (Reads: A and B changed together N times.
   Ratio = N / min(commits_A, commits_B))

  Module A        Module B          Co-chg    Ratio
  --------        --------          ------    -----
  routes          top-level              3     1.00
  gateway         top-level              3     1.00
  gateway         routes                 3     1.00
  types           validation             2     1.00
  top-level       validation             2     1.00
  top-level       types                  2     1.00
  routes          validation             2     1.00
  routes          types                  2     1.00
  intelligence    validation             2     1.00
  intelligence    types                  2     1.00
  intelligence    top-level              2     1.00
  intelligence    routes                 2     1.00
  gateway         validation             2     1.00
  gateway         types                  2     1.00
  gateway         intelligence           2     1.00
  registry        validation             1     1.00
  registry        types                  1     1.00
  registry        top-level              1     1.00
  registry        routes                 1     1.00
  intelligence    registry               1     1.00
  gateway         registry               1     1.00

── Interpretation ────────────────────────────────────────────
  Ratio 1.00 = every commit to one module also touches the other.
  High coupling (>0.70) suggests tight dependency or shared concern.
  Low coupling (<0.30) suggests good module isolation.

```

---

## 2. Hotspots (Churn x Complexity)

```
================================================================
  Hotspot Report — project-tab/server/src
================================================================

Total commits analyzed: 3
Hotspot score = churn (commits) x complexity (LOC)

── All Files by Hotspot Score ──────────────────────────────────
  Score     Churn    LOC  Module         File
  -----     -----    ---  ------         ----
  1887          3    629  top-level      index.ts
  1880          2    940  intelligence   intelligence/knowledge-store.ts
  1004          2    502  validation     validation/schemas.ts
  882           3    294  routes         routes/agents.ts
  708           2    354  gateway        gateway/volume-recovery.ts
  614           2    307  gateway        gateway/local-process-plugin.ts
  610           2    305  intelligence   intelligence/decision-queue.ts
  530           2    265  gateway        gateway/container-plugin.ts
  503           1    503  intelligence   intelligence/coherence-monitor.ts
  498           2    249  types          types/brief.ts
  448           1    448  intelligence   intelligence/context-injection-service.ts
  434           2    217  gateway        gateway/event-stream-client.ts
  408           3    136  routes         routes/index.ts
  328           1    328  gateway        gateway/mcp-provisioner.ts
  328           1    328  gateway        gateway/container-orchestrator.ts
  292           1    292  top-level      bus.ts
  243           1    243  intelligence   intelligence/trust-engine.ts
  225           1    225  types          types/events.ts
  216           2    108  routes         routes/artifacts.ts
  207           1    207  intelligence   intelligence/snapshot-sizer.ts
  203           1    203  gateway        gateway/child-process-manager.ts
  201           1    201  intelligence   intelligence/coherence-review-service.ts
  160           2     80  top-level      global.d.ts
  153           1    153  intelligence   intelligence/embedding-service.ts
  136           1    136  routes         routes/brake.ts
  135           1    135  gateway        gateway/local-http-plugin.ts
  124           1    124  top-level      ws-hub.ts
  120           1    120  gateway        gateway/token-service.ts
  117           1    117  routes         routes/decisions.ts
  101           1    101  top-level      tick.ts
  98            1     98  types          types/plugin.ts
  93            1     93  top-level      classifier.ts
  79            1     79  types          types/messages.ts
  71            1     71  registry       registry/agent-registry.ts
  69            1     69  routes         routes/token.ts
  53            1     53  routes         routes/control.ts
  48            1     48  validation     validation/quarantine.ts
  47            1     47  types          types/transport.ts
  43            1     43  routes         routes/tick.ts
  41            1     41  top-level      app.ts
  32            1     32  types          types/resolution.ts
  28            1     28  routes         routes/utils.ts
  28            1     28  routes         routes/trust.ts
  25            1     25  routes         routes/quarantine.ts
  21            1     21  intelligence   intelligence/index.ts
  6             1      6  types          types/index.ts

── Module Aggregates ───────────────────────────────────────────
  Module         Tot.Score Tot.Churn    Tot.LOC  Files
  ------         --------- ---------    -------  -----
  intelligence       4266       11       3021      9
  gateway            3400       13       2257      9
  top-level          2698       10       1360      7
  routes             2005       16       1037     11
  validation         1052        3        550      2
  types               985        8        736      7
  registry             71        1         71      1

── Interpretation ────────────────────────────────────────────
  High hotspot score = file changes often AND is large.
  Top hotspots are prime candidates for refactoring or splitting.
  Compare module aggregates to spot systemic complexity.

```

---

## 3. Fan-In / Fan-Out (Instability Metrics)

```
============================================================
  Fan-In / Fan-Out Analysis — project-tab/server/src/
============================================================

Module            Ca(in)  Ce(out)  Instability
--------------- -------- -------- ------------
intelligence           2        3         0.60
gateway                2        3         0.60
registry               1        1         0.50
routes                 2        6         0.75
auth                   2        0         0.00
types                  6        0         0.00
validation             2        1         0.33
core                   3        6         0.67

Edge list (unique module-to-module dependencies):

  Source          --> Target
  ---------------     ---------------
  core            --> auth
  core            --> gateway
  core            --> intelligence
  core            --> registry
  core            --> routes
  core            --> types
  gateway         --> core
  gateway         --> types
  gateway         --> validation
  intelligence    --> core
  intelligence    --> routes
  intelligence    --> types
  registry        --> types
  routes          --> auth
  routes          --> core
  routes          --> gateway
  routes          --> intelligence
  routes          --> types
  routes          --> validation
  validation      --> types

Legend:
  Ca = Afferent coupling (fan-in): how many modules depend ON this module
  Ce = Efferent coupling (fan-out): how many modules this module depends ON
  Instability = Ce/(Ca+Ce): 0=stable (many dependents), 1=unstable (many dependencies)
```

---

## 4. Export Ratio (Module Depth)

```
============================================================
  Export Ratio Analysis — project-tab/server/src/
============================================================

Module             Total Exported   Re-exp    Ratio   Depth
--------------- -------- -------- -------- --------   ----------
intelligence          58       35        7      60%   moderate
gateway               48       34        0      71%   SHALLOW
registry               2        2        0     100%   SHALLOW
routes                27       24        0      89%   SHALLOW
auth                  15       11        0      73%   SHALLOW
types                 79       79        6     100%   SHALLOW
validation            54       44        0      81%   SHALLOW
core                  46       18        0      39%   DEEP

------------------------------------------------------------
  Per-File Breakdown (files with 5+ declarations)
------------------------------------------------------------

  File                                           Total Export   Ratio
  --------------------------------------------- ------ ------ -------
  auth/auth-service.ts                               8      6     75%
  auth/middleware.ts                                 7      5     71%
  bus.ts                                            11      6     55%
  gateway/child-process-manager.ts                   7      3     43%
  gateway/container-orchestrator.ts                 10      3     30%
  gateway/mcp-provisioner.ts                         6      6    100%
  gateway/token-service.ts                           5      4     80%
  gateway/volume-recovery.ts                         7      7    100%
  index.ts                                          21      0      0%
  intelligence/coherence-monitor.ts                  5      2     40%
  intelligence/coherence-review-service.ts           7      7    100%
  intelligence/decision-queue.ts                     6      4     67%
  intelligence/index.ts                              5      5    100%
  intelligence/knowledge-store.ts                   11      4     36%
  intelligence/snapshot-sizer.ts                     9      4     44%
  intelligence/trust-engine.ts                       7      4     57%
  routes/index.ts                                    8      8    100%
  types/brief.ts                                    23     23    100%
  types/events.ts                                   25     25    100%
  types/messages.ts                                 10     10    100%
  types/plugin.ts                                   10     10    100%
  types/transport.ts                                 7      7    100%
  validation/quarantine.ts                           6      5     83%
  validation/schemas.ts                             48     39     81%

Legend:
  Total    = All declarations (function, class, interface, type, const, enum)
  Exported = Declarations with 'export' keyword
  Re-exp   = Re-export lines (export { } from / export * from)
  Ratio    = Exported / Total (lower = deeper information hiding)
  Depth    = DEEP (<=40%), moderate (41-70%), SHALLOW (>70%)
```

---

## 5. Boundary Permeability (Type Leakage)

```
========================================
  Type Boundary Permeability Analysis
  2026-02-12 21:33
========================================

Source: /Users/jayk/Code/blog/project-tab/server/src

--- Exported Types Per Module ---

  auth              9 types
  gateway          32 types
  intelligence     24 types
  registry          2 types
  routes           10 types
  types            79 types
  validation        1 types
  core             25 types

--- Cross-Module Type References ---

  SOURCE          -> TARGET           TYPES REFERENCED
  ------------------------------------------------------
  auth            -> routes             1
  auth            -> core               1
  gateway         -> routes             2
  gateway         -> core               6
  intelligence    -> routes             6
  intelligence    -> core               8
  registry        -> intelligence       1
  registry        -> routes             1
  registry        -> core               1
  routes          -> intelligence       4
  routes          -> registry           1
  routes          -> core               6
  types           -> gateway           19
  types           -> intelligence      26
  types           -> registry           2
  types           -> routes            11
  types           -> validation         1
  types           -> core              13
  core            -> auth               3
  core            -> gateway            3
  core            -> intelligence       4
  core            -> routes             6
  core            -> types              2

--- Summary ---

  Module pairs with cross-references: 23
  Total type references across boundaries: 128

--- Most Permeable Boundaries (top 5) ---

   26 types: types           -> intelligence
  AgentBrief
  AgentEvent
  AgentHandle
  AgentPlugin
  AgentSummary
  ArtifactEvent
  ArtifactKind
  ArtifactSummary
  CoherenceCategory
  CoherenceEvent
  CoherenceIssueSummary
  ContextInjection
  ContextInjectionPolicy
  ContextReactiveTrigger
  ControlMode
  DecisionEvent
  DecisionSummary
  EventEnvelope
  KnowledgeSnapshot
  OptionDecisionEvent
  Resolution
  SerializedAgentState
  Severity
  StateSyncMessage
  ToolApprovalEvent
  WorkstreamSummary
   19 types: types           -> gateway
  AgentBrief
  AgentHandle
  AgentPlugin
  ArtifactEvent
  ContainerTransport
  ContextInjection
  ErrorEvent
  EventEnvelope
  KillRequest
  KillResponse
  LifecycleEvent
  LocalHttpTransport
  MCPServerConfig
  PluginCapabilities
  Resolution
  SandboxBootstrap
  SerializedAgentState
  WorkspaceMount
  WorkspaceRequirements
   13 types: types           -> core
  AgentEvent
  AgentHandle
  AgentPlugin
  ArtifactEvent
  ControlMode
  ErrorEvent
  EventEnvelope
  FrontendMessage
  GuardrailEvent
  KnowledgeSnapshot
  Severity
  StateSyncMessage
  WorkspaceEventMessage
   11 types: types           -> routes
  AgentBrief
  AgentHandle
  AgentPlugin
  ArtifactEvent
  BrakeScope
  ControlMode
  DecisionEvent
  EventEnvelope
  KnowledgeSnapshot
  Resolution
  SerializedAgentState
    8 types: intelligence    -> core
  CoherenceMonitor
  ContextInjectionService
  DecisionQueue
  KnowledgeStore
  MockCoherenceReviewService
  MockEmbeddingService
  TrustEngine
  TrustOutcome

--- Interpretation ---

  High permeability (many types crossing boundary) suggests:
    - Wide contract surface between modules
    - Tight coupling that may hinder independent evolution
    - Consider narrowing the interface with facade patterns

  Low permeability suggests:
    - Narrow, well-encapsulated module boundary
    - Modules can evolve independently

```

---

## 6. API Churn Rate

```
========================================
  API Churn Analysis
  2026-02-12 21:33
========================================

Source: /Users/jayk/Code/blog/project-tab/server/src
Repository: /Users/jayk/Code/blog/project-tab

--- Per-Module API Churn ---

  MODULE           COMMITS  API-TOUCH    RATIO
  -------------------------------------------------------
  auth                   0          0      N/A
  gateway                3          2    66.7%
  intelligence           2          1    50.0%
  registry               1          1   100.0%
  routes                 3          2    66.7%
  types                  2          1    50.0%
  validation             2          1    50.0%
  core                   3          2    66.7%

--- Highest Churn Modules ---

  registry: 100.0% (1/1 commits touch exports)
  routes: 66.7% (2/3 commits touch exports)
  gateway: 66.7% (2/3 commits touch exports)
  core: 66.7% (2/3 commits touch exports)
  validation: 50.0% (1/2 commits touch exports)

--- Top Churned Export Names (per module) ---

  gateway:
      1 changes: WebSocketLike
      1 changes: WebSocketFactory
      1 changes: VolumeRecoveryService
      1 changes: VolumeRecoveryOptions
      1 changes: VolumeFile

  intelligence:
      1 changes: TrustOutcome
      1 changes: TrustEngine
      1 changes: TrustCalibrationConfig
      1 changes: StoredCheckpoint
      1 changes: SnapshotSizingOptions

  registry:
      1 changes: RegisteredAgent
      1 changes: AgentRegistry

  routes:
      1 changes: TokenRouteDeps
      1 changes: TickRouteDeps
      1 changes: KnowledgeStore
      1 changes: ControlModeManager
      1 changes: CheckpointStore

  types:
      1 changes: WorkstreamSummary
      1 changes: WorkspaceRequirements
      1 changes: WorkspaceMount
      1 changes: WorkspaceEventMessage
      1 changes: WebSocketMessage

  validation:
      1 changes: QuarantinedEvent

  core:
      1 changes: Workspace
      1 changes: WebSocketServer
      1 changes: WebSocketHub
      1 changes: WebSocket
      1 changes: TickService

--- Interpretation ---

  High API churn ratio (>50%) suggests:
    - Unstable module contract / frequently changing interface
    - Downstream modules must adapt often
    - Consider stabilizing the API before adding dependents

  Low API churn ratio (<20%) suggests:
    - Stable, mature interface
    - Safe for other modules to depend on

  Note: This analysis covers all git history for tracked files.
  New modules with few commits may show artificially high ratios
  (initial commit creates all exports).

```


---

## 7. Baseline Architecture Report (madge/dpdm/knip)

```

=== CIRCULAR DEPENDENCIES (madge) ===

Server:
✔ No circular dependencies


=== CIRCULAR DEPENDENCIES (dpdm cross-check) ===

⚠ dpdm found circular chains (may be barrel-file false positives):
• Circular Dependencies
  1) src/routes/index.ts -> src/routes/agents.ts
  2) src/routes/index.ts -> src/routes/artifacts.ts
  3) src/routes/index.ts -> src/routes/brake.ts
  4) src/routes/index.ts -> src/routes/control.ts
  5) src/routes/index.ts -> src/routes/decisions.ts
  6) src/routes/index.ts -> src/routes/events.ts
  7) src/routes/index.ts -> src/routes/trust.ts

• Warnings


=== UNUSED CODE (knip) ===

Server:
  Unused files:          2
  Unused exports:        29
  Unused exported types: 51
  Unused dependencies:   1
⚠ Significant interface bloat detected

Server detail:
Unused files (2)
src/intelligence/index.ts      
test/integration/test-server.ts
Unused dependencies (1)
uuid  package.json:19:6
Unused exports (29)
notImplemented                function  src/routes/utils.ts:23:17         
validateOrQuarantine          function  src/validation/quarantine.ts:38:17
severitySchema                          src/validation/schemas.ts:5:14    
blastRadiusSchema                       src/validation/schemas.ts:6:14    
controlModeSchema                       src/validation/schemas.ts:7:14    
artifactKindSchema                      src/validation/schemas.ts:8:14    
coherenceCategorySchema                 src/validation/schemas.ts:9:14    
actionKindSchema                        src/validation/schemas.ts:10:14   
decisionOptionSchema                    src/validation/schemas.ts:12:14   
provenanceSchema                        src/validation/schemas.ts:19:14   
statusEventSchema                       src/validation/schemas.ts:28:14   
optionDecisionEventSchema               src/validation/schemas.ts:35:14   
toolApprovalEventSchema                 src/validation/schemas.ts:52:14   
artifactEventSchema                     src/validation/schemas.ts:66:14   
coherenceEventSchema                    src/validation/schemas.ts:82:14   
toolCallEventSchema                     src/validation/schemas.ts:94:14   
completionEventSchema                   src/validation/schemas.ts:106:14  
errorEventSchema                        src/validation/schemas.ts:116:14  
delegationEventSchema                   src/validation/schemas.ts:132:14  
guardrailEventSchema                    src/validation/schemas.ts:143:14  
lifecycleEventSchema                    src/validation/schemas.ts:152:14  
progressEventSchema                     src/validation/schemas.ts:159:14  
rawProviderEventSchema                  src/validation/schemas.ts:167:14  
agentEventSchema                        src/validation/schemas.ts:175:14  
adapterEventSchema                      src/validation/schemas.ts:191:14  
eventEnvelopeSchema                     src/validation/schemas.ts:199:14  
optionResolutionSchema                  src/validation/schemas.ts:423:14  
toolApprovalResolutionSchema            src/validation/schemas.ts:430:14  
resolutionSchema                        src/validation/schemas.ts:439:14  
Unused exported types (51)
AppDeps                   type       src/app.ts:10:13                           
IssuedUserToken           interface  src/auth/auth-service.ts:15:18             
IssueUserTokenInput       interface  src/auth/auth-service.ts:21:18             
AuthServiceOptions        interface  src/auth/auth-service.ts:28:18             
AuthRole                  type       src/auth/index.ts:3:8                      
AuthServiceOptions        type       src/auth/index.ts:4:8                      
IssueUserTokenInput       type       src/auth/index.ts:5:8                      
IssuedUserToken           type       src/auth/index.ts:6:8                      
UserTokenClaims           type       src/auth/index.ts:7:8                      
AuthenticatedRequest      type       src/auth/index.ts:13:8                     
AuthenticatedUser         type       src/auth/index.ts:14:8                     
AuthMiddlewareOptions     type       src/auth/index.ts:15:8                     
AuthenticatedUser         interface  src/auth/middleware.ts:8:18                
AuthenticatedRequest      type       src/auth/middleware.ts:15:13               
AuthMiddlewareOptions     interface  src/auth/middleware.ts:20:18               
EventBusFilter            interface  src/bus.ts:4:18                            
SequenceGapWarning        interface  src/bus.ts:13:18                           
EventBusMetrics           interface  src/bus.ts:21:18                           
BackpressureConfig        interface  src/bus.ts:29:18                           
SpawnResult               interface  src/gateway/child-process-manager.ts:13:18 
SpawnShimOptions          interface  src/gateway/child-process-manager.ts:20:18 
EventStreamClientOptions  interface  src/gateway/event-stream-client.ts:19:18   
MCPProvisionResult        interface  src/gateway/mcp-provisioner.ts:38:18       
SandboxTokenClaims        interface  src/gateway/token-service.ts:8:18          
IssuedToken               interface  src/gateway/token-service.ts:16:18         
TokenServiceOptions       interface  src/gateway/token-service.ts:22:18         
RecoveryAction            type       src/gateway/volume-recovery.ts:18:13       
VolumeRecoveryOptions     interface  src/gateway/volume-recovery.ts:44:18       
CoherenceMonitorConfig    interface  src/intelligence/coherence-monitor.ts:13:18
DecisionTimeoutPolicy     interface  src/intelligence/decision-queue.ts:6:18    
TrustCalibrationConfig    interface  src/intelligence/trust-engine.ts:36:18     
CalibrationLogEntry       interface  src/intelligence/trust-engine.ts:69:18     
RegisteredAgent           interface  src/registry/agent-registry.ts:4:18        
AuthRouteDeps             interface  src/routes/auth.ts:9:18                    
TickRouteDeps             interface  src/routes/tick.ts:8:18                    
TokenRouteDeps            interface  src/routes/token.ts:7:18                   
TickMode                  type       src/tick.ts:2:13                           
TickConfig                interface  src/tick.ts:5:18                           
TickHandler               type       src/tick.ts:11:13                          
GuardrailSpec             interface  src/types/brief.ts:52:18                   
EscalationRule            interface  src/types/brief.ts:66:18                   
EscalationPredicate       type       src/types/brief.ts:72:13                   
BrakeReleaseCondition     type       src/types/messages.ts:13:13                
BrakeAction               interface  src/types/messages.ts:19:18                
WebSocketMessage          type       src/types/messages.ts:79:13                
SandboxHealthResponse     interface  src/types/plugin.ts:76:18                  
LegacyResolution          interface  src/types/resolution.ts:25:18              
TokenRenewRequest         interface  src/types/transport.ts:38:18               
TokenRenewResponse        interface  src/types/transport.ts:44:18               
QuarantinedEvent          interface  src/validation/quarantine.ts:6:18          
MockShimConfig            interface  test/integration/mock-adapter-shim.ts:29:18


=== LAYER VIOLATION CHECK (import analysis) ===

intelligence/ importing from routes/:
✖ VIOLATION: intelligence depends on routes
src/intelligence/context-injection-service.ts:import type { AgentRegistry, AgentGateway, KnowledgeStore, ControlModeManager } from '../routes'
intelligence/ importing from gateway/:
✔ Clean
registry/ importing from routes/:
✔ Clean
registry/ importing from gateway/:
✔ Clean

✖ 1 layer violation(s) found

=== DONE ===

Report complete. Review warnings above for actionable items.
```

---

## Summary of Key Findings

| Metric | Key Finding |
|---|---|
| **Co-change coupling** | All ratios 1.00 (only 3 bulk commits; not yet diagnostic) |
| **Hotspots** | `knowledge-store.ts` (940 LOC), `index.ts` (629 LOC), `schemas.ts` (502 LOC) are largest files with highest churn |
| **Fan-in/fan-out** | `types` and `auth` are maximally stable (I=0.00); `routes` is most unstable (I=0.75, fan-out to 6 modules) |
| **Export ratio** | Only `core` is deep (39%); most modules are shallow (71-100% export ratio) |
| **Boundary permeability** | `types` -> `intelligence` has widest boundary (26 types cross); 128 total cross-boundary type references |
| **API churn** | Too few commits (3) for meaningful signal; ratios will normalize over time |
| **Circular deps** | None real (dpdm barrel-file false positives only in routes/) |
| **Unused code** | 51 unused exported types, 29 unused exports, 1 unused dep (uuid) -- significant bloat |
| **Layer violations** | 1: `intelligence/context-injection-service.ts` imports from `routes/` |

