import { BaseMessage } from '@langchain/core/messages'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Mutex } from 'async-mutex'
import * as fs from 'fs-extra'
import * as path from 'path'

import { ImageResponse } from 'src/schemas/graph'
import { StateChangeEvent } from 'src/state/state.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

const MESSAGES_PER_FILE = 1000
const FILE_PREFIX = 'graph-history'

// Use current directory for dev mode, /mnt/logs for production
const LOG_DIR = process.env.NODE_ENV === 'development' ? './logs' : '/mnt/logs'

interface GraphHistoryLogEntry {
  id?: string
  content: string
  type: string
  kwargs: Record<string, unknown>
  images?: ImageResponse[]
  timestamp: string
}

/**
 * Service for logging graph conversation history to JSONL files with automatic rotation.
 * Logs are stored in /mnt/logs as graph-history-{index}.jsonl files.
 * Each file contains up to 1000 messages before rotating to the next index.
 *
 * This logs the MessageState format directly, making historical conversations
 * render-ready for the UI without transformation.
 */
@Injectable()
export class GraphHistoryLoggerService implements OnModuleInit {
  private readonly logger = new Logger(GraphHistoryLoggerService.name)
  private readonly mutex = new Mutex()
  private currentIndex = 0
  private currentFileMessageCount = 0

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async onModuleInit() {
    try {
      await this.initializeLogDirectory()
      await this.initializeCurrentLogFile()

      // Subscribe to state changes
      this.eventEmitter.on('state.change', this.handleStateChange.bind(this))

      this.logger.log(
        `Graph history logger initialized: file index ${this.currentIndex}, message count ${this.currentFileMessageCount}`,
      )
    } catch (error) {
      this.logger.error('Failed to initialize graph history logger', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Handle state changes - log new graph states when they're added
   */
  private async handleStateChange(event: StateChangeEvent): Promise<void> {
    try {
      const prevHistory = event.prevState.graphHistory
      const nextHistory = event.nextState.graphHistory

      if (!prevHistory || !nextHistory) {
        return
      }

      const prevLength = prevHistory.length
      const nextLength = nextHistory.length

      // Only log if new graph state was added
      if (nextLength > prevLength) {
        const newGraphState = nextHistory[nextLength - 1]
        const prevGraphState = prevHistory[prevLength - 1]

        // Build set of message IDs from previous graph state to avoid duplicates
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

  /**
   * Log all messages from a graph state
   */
  private async logGraphState(
    graphState: {
      messages: BaseMessage[]
      images?: ImageResponse[]
    },
    prevMessageIds?: Set<string>,
  ): Promise<void> {
    // Build images map (same logic as api.controller.ts)
    const imagesMap = new Map<string, ImageResponse[]>()

    if (graphState.images && graphState.images.length > 0) {
      const parentId = graphState.images[0].parentId

      if (parentId) {
        imagesMap.set(parentId, graphState.images)
      }
    }

    // Filter messages: exclude system prompt and previously logged messages
    const messagesToLog = graphState.messages.filter(m => {
      // Exclude TDR system prompt
      if (m.id === TDR_SYSTEM_PROMPT_ID) return false

      // Exclude messages that were already logged in previous graph state
      if (prevMessageIds && m.id && prevMessageIds.has(m.id)) return false

      return true
    })

    // Transform and log each new message
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

  /**
   * Write a log entry to the current JSONL file with rotation
   */
  private async writeLogEntry(entry: GraphHistoryLogEntry): Promise<void> {
    const release = await this.mutex.acquire()

    try {
      const logLine = JSON.stringify(entry) + '\n'
      const filePath = this.getLogFilePath(this.currentIndex)

      await fs.appendFile(filePath, logLine, 'utf-8')
      this.currentFileMessageCount++

      // Rotate to next file if we've reached the message limit
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

  /**
   * Ensure the logs directory exists, create it if it doesn't.
   */
  private async initializeLogDirectory(): Promise<void> {
    try {
      await fs.ensureDir(LOG_DIR)
      this.logger.log(`Ensured log directory exists: ${LOG_DIR}`)
    } catch (error) {
      this.logger.error('Failed to create log directory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        logDir: LOG_DIR,
      })
      throw error
    }
  }

  /**
   * Initialize the current log file by finding the highest index
   * and counting messages in that file.
   */
  private async initializeCurrentLogFile(): Promise<void> {
    try {
      const highestIndex = await this.findHighestLogIndex()

      if (highestIndex === -1) {
        // No log files exist, start from 0
        this.currentIndex = 0
        this.currentFileMessageCount = 0
        return
      }

      // Check if the highest index file exists and count its lines
      const filePath = this.getLogFilePath(highestIndex)
      const fileExists = await fs.pathExists(filePath)

      if (!fileExists) {
        // File was deleted, start from 0
        this.currentIndex = 0
        this.currentFileMessageCount = 0
        return
      }

      const lineCount = await this.countLinesInFile(filePath)

      if (lineCount >= MESSAGES_PER_FILE) {
        // Current file is full, move to next index
        this.currentIndex = highestIndex + 1
        this.currentFileMessageCount = 0
      } else {
        // Continue with current file
        this.currentIndex = highestIndex
        this.currentFileMessageCount = lineCount
      }
    } catch (error) {
      this.logger.error('Failed to initialize current log file', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      // Default to starting from 0
      this.currentIndex = 0
      this.currentFileMessageCount = 0
    }
  }

  /**
   * Scan the logs directory and find the highest log file index.
   * Returns -1 if no log files exist.
   */
  private async findHighestLogIndex(): Promise<number> {
    try {
      const files = await fs.readdir(LOG_DIR)
      const logFiles = files.filter(
        file => file.startsWith(FILE_PREFIX) && file.endsWith('.jsonl'),
      )

      if (logFiles.length === 0) {
        return -1
      }

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

  /**
   * Count the number of lines in a file.
   */
  private async countLinesInFile(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      if (content.length === 0) {
        return 0
      }
      // Count newline characters
      const lines = content.split('\n')
      // If the last line is empty (file ends with newline), don't count it
      return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    } catch (error) {
      this.logger.error('Failed to count lines in file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath,
      })
      return 0
    }
  }

  /**
   * Get the full file path for a given log index.
   */
  private getLogFilePath(index: number): string {
    return path.join(LOG_DIR, `${FILE_PREFIX}-${index}.jsonl`)
  }

  /**
   * Rotate to the next log file by incrementing the index and resetting the counter.
   */
  private async rotateLogFile(): Promise<void> {
    this.currentIndex++
    this.currentFileMessageCount = 0
    this.logger.log(`Rotated to new log file: index ${this.currentIndex}`)
  }
}
