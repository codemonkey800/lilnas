import { BaseMessage } from '@langchain/core/messages'
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Mutex } from 'async-mutex'
import * as fs from 'fs-extra'
import * as path from 'path'
import { pairwise, Subscription } from 'rxjs'

import { ImageResponse } from 'src/schemas/graph'
import { AppState, StateService } from 'src/state/state.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

const MESSAGES_PER_FILE = 1000
const FILE_PREFIX = 'graph-history'
const LOG_DIR = process.env.NODE_ENV === 'development' ? './logs' : '/mnt/logs'

interface GraphHistoryLogEntry {
  id?: string
  content: string
  type: string
  kwargs: Record<string, unknown>
  images?: ImageResponse[]
  timestamp: string
}

@Injectable()
export class GraphHistoryLoggerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GraphHistoryLoggerService.name)
  private readonly mutex = new Mutex()
  private currentIndex = 0
  private currentFileMessageCount = 0
  private subscription: Subscription | null = null

  constructor(private readonly state: StateService) {}

  async onModuleInit() {
    try {
      await this.initializeLogDirectory()
      await this.initializeCurrentLogFile()

      this.subscription = this.state.changes$
        .pipe(pairwise())
        .subscribe(([prev, next]: [AppState, AppState]) => {
          void this.handleStateChange(prev, next).catch(error => {
            this.logger.error('Unexpected error in state change handler', {
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          })
        })

      this.logger.log(
        `Graph history logger initialized: file index ${this.currentIndex}, message count ${this.currentFileMessageCount}`,
      )
    } catch (error) {
      this.logger.error('Failed to initialize graph history logger', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe()
  }

  private async handleStateChange(
    prev: AppState,
    next: AppState,
  ): Promise<void> {
    try {
      const prevHistory = prev.graphHistory
      const nextHistory = next.graphHistory

      const prevLength = prevHistory.length
      const nextLength = nextHistory.length

      if (
        nextLength > 0 &&
        (nextLength > prevLength ||
          nextHistory[nextLength - 1] !== prevHistory[prevLength - 1])
      ) {
        const newGraphState = nextHistory[nextLength - 1]
        const prevGraphState = prevHistory[prevLength - 1]

        const prevMessageIds = new Set(
          prevGraphState?.messages
            .map(m => m.id)
            .filter((id): id is string => Boolean(id)) ?? [],
        )

        await this.logGraphState(newGraphState, prevMessageIds)
      }
    } catch (error) {
      this.logger.error('Failed to handle state change', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async logGraphState(
    graphState: {
      messages: BaseMessage[]
      images?: ImageResponse[]
    },
    prevMessageIds?: Set<string>,
  ): Promise<void> {
    const imagesMap = new Map<string, ImageResponse[]>()

    if (graphState.images && graphState.images.length > 0) {
      const parentId = graphState.images[0].parentId
      if (parentId) {
        imagesMap.set(parentId, graphState.images)
      }
    }

    const messagesToLog = graphState.messages.filter(m => {
      if (m.id === TDR_SYSTEM_PROMPT_ID) return false
      if (prevMessageIds && m.id && prevMessageIds.has(m.id)) return false
      return true
    })

    for (const message of messagesToLog) {
      const id = message.id ?? ''
      const images = imagesMap.get(id) ?? []

      const logEntry: GraphHistoryLogEntry = {
        id: message.id,
        content: message.content.toString(),
        type: message.getType(),
        kwargs: message.additional_kwargs ?? {},
        ...(images.length > 0 ? { images } : {}),
        timestamp: new Date().toISOString(),
      }

      await this.writeLogEntry(logEntry)
    }
  }

  private async writeLogEntry(entry: GraphHistoryLogEntry): Promise<void> {
    const release = await this.mutex.acquire()

    try {
      const logLine = JSON.stringify(entry) + '\n'
      const filePath = this.getLogFilePath(this.currentIndex)

      await fs.appendFile(filePath, logLine, 'utf-8')
      this.currentFileMessageCount++

      if (this.currentFileMessageCount >= MESSAGES_PER_FILE) {
        await this.rotateLogFile()
      }
    } catch (error) {
      this.logger.error('Failed to write log entry', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      release()
    }
  }

  private async initializeLogDirectory(): Promise<void> {
    try {
      await fs.ensureDir(LOG_DIR)
    } catch (error) {
      this.logger.error('Failed to create log directory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        logDir: LOG_DIR,
      })
      throw error
    }
  }

  private async initializeCurrentLogFile(): Promise<void> {
    try {
      const highestIndex = await this.findHighestLogIndex()

      if (highestIndex === -1) {
        this.currentIndex = 0
        this.currentFileMessageCount = 0
        return
      }

      const filePath = this.getLogFilePath(highestIndex)
      const fileExists = await fs.pathExists(filePath)

      if (!fileExists) {
        this.currentIndex = 0
        this.currentFileMessageCount = 0
        return
      }

      const lineCount = await this.countLinesInFile(filePath)

      if (lineCount >= MESSAGES_PER_FILE) {
        this.currentIndex = highestIndex + 1
        this.currentFileMessageCount = 0
      } else {
        this.currentIndex = highestIndex
        this.currentFileMessageCount = lineCount
      }
    } catch (error) {
      this.logger.error('Failed to initialize current log file', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      this.currentIndex = 0
      this.currentFileMessageCount = 0
    }
  }

  private async findHighestLogIndex(): Promise<number> {
    try {
      const files = await fs.readdir(LOG_DIR)
      const logFiles = files.filter(
        file => file.startsWith(FILE_PREFIX) && file.endsWith('.jsonl'),
      )

      if (logFiles.length === 0) return -1

      const indices = logFiles
        .map(file => {
          const match = file.match(new RegExp(`${FILE_PREFIX}-(\\d+)\\.jsonl`))
          return match ? parseInt(match[1], 10) : -1
        })
        .filter(index => index >= 0)

      return indices.length > 0 ? Math.max(...indices) : -1
    } catch (error) {
      this.logger.error('Failed to find highest log index', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return -1
    }
  }

  private async countLinesInFile(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      if (content.length === 0) return 0
      const lines = content.split('\n')
      return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    } catch (error) {
      this.logger.error('Failed to count lines in file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath,
      })
      return 0
    }
  }

  private getLogFilePath(index: number): string {
    return path.join(LOG_DIR, `${FILE_PREFIX}-${index}.jsonl`)
  }

  private async rotateLogFile(): Promise<void> {
    this.currentIndex++
    this.currentFileMessageCount = 0
    this.logger.log(`Rotated to new log file: index ${this.currentIndex}`)
  }
}
