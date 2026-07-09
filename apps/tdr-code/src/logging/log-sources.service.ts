import fs from 'node:fs'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import { LOG_DIR, LOG_STREAMS, resolveLogPath } from 'src/logging/log-paths'
import type { LogSource, LogStream } from 'src/logging/log-view.types'

@Injectable()
export class LogSourcesService {
  // Same test-only override seam as LogReaderService.setLogDirForTests —
  // production code always resolves paths through log-paths.ts's own
  // LOG_DIR constant, never a client-supplied value (R17).
  private logDir: string = LOG_DIR

  constructor(private readonly logger: PinoLogger) {}

  setLogDirForTests(dir: string): void {
    this.logDir = dir
  }

  private resolvePath(stream: LogStream): string {
    return resolveLogPath(stream, this.logDir)
  }

  async getSources(): Promise<LogSource[]> {
    const sources: LogSource[] = []
    for (const stream of LOG_STREAMS) {
      sources.push(await this.statOne(stream))
    }
    return sources
  }

  private async statOne(stream: LogStream): Promise<LogSource> {
    try {
      const stat = await fs.promises.stat(this.resolvePath(stream))
      return { stream, exists: true, size: stat.size }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // A stream that has never been written to (frontend-server before
        // its first request) is a normal empty/tab-bootstrap state (R2),
        // never an error — mirrors LogReaderService.readWindow's identical
        // ENOENT-is-not-an-error contract.
        return { stream, exists: false, size: 0 }
      }
      // Anything else (e.g. EACCES) is a real, unexpected problem — surface
      // it as a failure for this request rather than silently reporting a
      // fake exists:false, which would hide a permissions/ops issue behind
      // what looks like an empty-state UI.
      this.logger.error(
        { err, event: LOG_EVENTS.logSourceStatFailed, stream },
        'log source stat failed',
      )
      throw err
    }
  }
}
