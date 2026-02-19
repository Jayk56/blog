// Structured logger for the backend service
import { createWriteStream, WriteStream } from 'fs'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class Logger {
  private level: LogLevel
  private stream: WriteStream | null = null

  constructor(level: LogLevel = 'info', logFile?: string) {
    this.level = level
    if (logFile) {
      this.stream = createWriteStream(logFile, { flags: 'a' })
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private write(entry: LogEntry): void {
    const line = JSON.stringify(entry)
    if (this.stream) {
      this.stream.write(line + '\n')
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) this.write({ timestamp: new Date().toISOString(), level: 'debug', message, context })
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) this.write({ timestamp: new Date().toISOString(), level: 'info', message, context })
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) this.write({ timestamp: new Date().toISOString(), level: 'warn', message, context })
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) this.write({ timestamp: new Date().toISOString(), level: 'error', message, context })
  }
}
