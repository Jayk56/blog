/** Tick service mode. */
export type TickMode = 'wall_clock' | 'manual'

/** Tick service configuration. */
export interface TickConfig {
  intervalMs?: number
  mode?: TickMode
}

/** Tick callback handler. */
export type TickHandler = (tick: number) => void

/**
 * TickService provides a monotonic logical clock used by backend subsystems.
 */
export class TickService {
  private readonly intervalMs: number
  private readonly mode: TickMode
  private tick = 0
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly handlers = new Set<TickHandler>()

  constructor(config: TickConfig = {}) {
    this.intervalMs = config.intervalMs ?? 1000
    this.mode = config.mode ?? 'wall_clock'
  }

  /** Returns the current tick value. */
  currentTick(): number {
    return this.tick
  }

  /** Registers a tick subscriber. */
  onTick(handler: TickHandler): void {
    this.handlers.add(handler)
  }

  /** Removes a previously registered tick subscriber. */
  removeOnTick(handler: TickHandler): void {
    this.handlers.delete(handler)
  }

  /** Starts ticking based on configured mode. */
  start(): void {
    if (this.running) {
      return
    }

    this.running = true

    if (this.mode === 'wall_clock') {
      this.timer = setInterval(() => {
        this.increment(1)
      }, this.intervalMs)
    }
  }

  /** Stops ticking but keeps current tick counter intact. */
  stop(): void {
    this.running = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Advances ticks explicitly in manual mode. */
  advance(steps = 1): number {
    if (this.mode !== 'manual') {
      throw new Error('TickService.advance() is only available in manual mode')
    }

    if (steps < 1 || !Number.isFinite(steps)) {
      throw new Error('steps must be a positive finite number')
    }

    this.increment(Math.floor(steps))
    return this.tick
  }

  /** Returns true when the service is currently running. */
  isRunning(): boolean {
    return this.running
  }

  /** Returns the configured ticking mode. */
  getMode(): TickMode {
    return this.mode
  }

  private increment(steps: number): void {
    for (let i = 0; i < steps; i += 1) {
      this.tick += 1
      for (const handler of this.handlers) {
        handler(this.tick)
      }
    }
  }
}
