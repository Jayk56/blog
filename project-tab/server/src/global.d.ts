declare module 'express' {
  export interface Request {
    body: unknown
    params: Record<string, string>
    query: Record<string, string | string[]>
    url?: string
  }

  export interface Response {
    status(code: number): this
    json(body: unknown): this
    setHeader(name: string, value: string | number | readonly string[]): this
    send(body: unknown): this
  }

  export type NextFunction = () => void
  export type RequestHandler = (req: Request, res: Response, next?: NextFunction) => void

  export interface Router {
    use(...handlers: RequestHandler[]): this
    use(path: string, ...handlers: Array<RequestHandler | Router>): this
    get(path: string, handler: RequestHandler): this
    post(path: string, handler: RequestHandler): this
    put(path: string, handler: RequestHandler): this
    patch(path: string, handler: RequestHandler): this
    delete(path: string, handler: RequestHandler): this
  }

  export interface Express extends Router {}

  export function Router(): Router

  interface ExpressFactory {
    (): Express
    json(): RequestHandler
  }

  const express: ExpressFactory
  export default express
}

declare module 'ws' {
  import type { EventEmitter } from 'node:events'
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'

  export type RawData = Buffer | ArrayBuffer | Buffer[]

  export class WebSocket extends EventEmitter {
    static OPEN: number
    readyState: number
    constructor(url: string)
    send(data: string): void
    ping(): void
    close(): void
    terminate(): void
    on(event: 'pong' | 'close', listener: () => void): this
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    once(event: string, listener: (...args: any[]) => void): this
  }

  export default WebSocket

  export class WebSocketServer extends EventEmitter {
    constructor(options?: { noServer?: boolean })
    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void
    close(): void
    emit(event: 'connection', socket: WebSocket, request: IncomingMessage): boolean
  }
}

declare module 'uuid' {
  export function v4(): string
}
