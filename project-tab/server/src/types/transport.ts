import type { AdapterEvent } from './events'

/** Backend transport abstraction for plugin implementations. */
export type PluginTransport = InProcessTransport | LocalHttpTransport | ContainerTransport

/** In-process transport (Phase 0 mock plugin). */
export interface InProcessTransport {
  type: 'in_process'
  eventSink: (event: AdapterEvent) => void
}

/** Localhost HTTP + WS transport (Phase 1 local adapter shim). */
export interface LocalHttpTransport {
  type: 'local_http'
  rpcEndpoint: string
  eventStreamEndpoint: string
}

/** Containerized or remote sandbox transport. */
export interface ContainerTransport {
  type: 'container'
  sandboxId: string
  rpcEndpoint: string
  eventStreamEndpoint: string
  healthEndpoint: string
}

/** Bootstrap config injected into each sandbox at provision time. */
export interface SandboxBootstrap {
  backendUrl: string
  backendToken: string
  tokenExpiresAt: string
  agentId: string
  artifactUploadEndpoint: string
}

/** Sandbox-to-backend token renewal request body. */
export interface TokenRenewRequest {
  agentId: string
  currentToken: string
}

/** Sandbox-to-backend token renewal response body. */
export interface TokenRenewResponse {
  backendToken: string
  tokenExpiresAt: string
}
