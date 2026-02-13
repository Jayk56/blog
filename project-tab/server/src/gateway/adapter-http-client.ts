/** HTTP error from the adapter shim. */
export class AdapterHttpError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(`Adapter shim returned ${statusCode} from ${endpoint}: ${body}`)
    this.name = 'AdapterHttpError'
  }
}

/** Shared JSON-over-HTTP client for adapter shim RPC endpoints. */
export class AdapterHttpClient {
  private readonly rpcEndpoint: string
  private readonly fetchFn: typeof globalThis.fetch

  constructor(rpcEndpoint: string, fetchFn?: typeof globalThis.fetch) {
    this.rpcEndpoint = rpcEndpoint
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.rpcEndpoint}${endpoint}`

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new AdapterHttpError(endpoint, response.status, text)
    }

    // Some endpoints may return no body (204 or empty 200)
    const text = await response.text()
    if (!text) {
      return undefined as T
    }

    return JSON.parse(text) as T
  }
}
