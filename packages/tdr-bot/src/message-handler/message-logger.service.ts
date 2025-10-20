import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Mutex } from 'async-mutex'
import * as fs from 'fs-extra'
import * as path from 'path'

import { Message } from './types'

const MESSAGES_PER_FILE = 1000
const FILE_PREFIX = 'message-history'

// Use current directory for dev mode, /mnt/logs for production
const LOG_DIR = process.env.NODE_ENV === 'development' ? './logs' : '/mnt/logs'

interface MessageLogEntry {
  timestamp: string
  messageId: string
  channelId: string
  channelName: string | null
  authorId: string
  authorName: string
  content: string
  mentions: string[]
  attachments: string[]
  embedCount: number
}

/**
 * Service for logging Discord messages to JSONL files with automatic rotation.
 * Logs are stored in /mnt/logs as message-history-{index}.jsonl files.
 * Each file contains up to 1000 messages before rotating to the next index.
 */
@Injectable()
export class MessageLoggerService implements OnModuleInit {
  private readonly logger = new Logger(MessageLoggerService.name)
  private readonly mutex = new Mutex()
  private currentIndex = 0
  private currentFileMessageCount = 0

  async onModuleInit() {
    try {
      await this.initializeLogDirectory()
      await this.initializeCurrentLogFile()
      this.logger.log(
        `Message logger initialized: file index ${this.currentIndex}, message count ${this.currentFileMessageCount}`,
      )
    } catch (error) {
      this.logger.error('Failed to initialize message logger', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Log a Discord message to the current JSONL log file.
   * This method is thread-safe and handles file rotation automatically.
   */
  async logMessage(message: Message): Promise<void> {
    const release = await this.mutex.acquire()

    try {
      const logEntry = this.serializeMessage(message)
      const logLine = JSON.stringify(logEntry) + '\n'

      const filePath = this.getLogFilePath(this.currentIndex)
      await fs.appendFile(filePath, logLine, 'utf-8')

      this.currentFileMessageCount++

      // Rotate to next file if we've reached the message limit
      if (this.currentFileMessageCount >= MESSAGES_PER_FILE) {
        await this.rotateLogFile()
      }
    } catch (error) {
      this.logger.error('Failed to log message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: message.id,
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

  /**
   * Serialize a Discord message to a log entry object.
   */
  private serializeMessage(message: Message): MessageLogEntry {
    return {
      timestamp: message.createdAt.toISOString(),
      messageId: message.id,
      channelId: message.channelId,
      channelName: 'name' in message.channel ? message.channel.name : null,
      authorId: message.author.id,
      authorName: message.author.displayName,
      content: message.content,
      mentions: message.mentions.users.map(user => user.id),
      attachments: message.attachments.map(attachment => attachment.url),
      embedCount: message.embeds.length,
    }
  }
}
