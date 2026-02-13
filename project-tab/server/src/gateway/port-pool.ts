/** Reusable contiguous port allocator with explicit min/max range. */
export class PortPool {
  private readonly allocated = new Set<number>()
  private readonly portMin: number
  private readonly portMax: number

  constructor(portMin: number, portMax: number) {
    this.portMin = portMin
    this.portMax = portMax
  }

  /** Allocate the first free port in the configured range. */
  allocate(): number {
    for (let port = this.portMin; port <= this.portMax; port++) {
      if (!this.allocated.has(port)) {
        this.allocated.add(port)
        return port
      }
    }
    throw new Error(`No ports available in range ${this.portMin}-${this.portMax}`)
  }

  /** Release a previously allocated port back to the pool. */
  release(port: number): void {
    this.allocated.delete(port)
  }
}

/** Poll GET /health on the given port until response.ok or timeout. */
export async function pollHealth(
  port: number,
  intervalMs: number,
  timeoutMs: number,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const url = `http://localhost:${port}/health`

  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url, {
        signal: AbortSignal.timeout(intervalMs),
      })
      if (response.ok) {
        return
      }
    } catch {
      // Connection refused, timeout, etc. -- keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Service on port ${port} did not become healthy within ${timeoutMs}ms`)
}
