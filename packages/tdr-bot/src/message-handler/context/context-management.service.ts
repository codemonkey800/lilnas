import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Mutex } from 'async-mutex'

import { CONTEXT_CLEANUP_CRON, CONTEXT_TTL_MS } from 'src/constants/context'

import { BaseContext, ContextEntry } from './interfaces/context.interface'

@Injectable()
export class ContextManagementService {
  private readonly logger = new Logger(ContextManagementService.name)
  private readonly contexts = new Map<string, ContextEntry<BaseContext>>()
  private readonly mutex = new Mutex()

  async setContext<T extends BaseContext>(
    userId: string,
    contextType: string,
    context: T,
  ): Promise<void> {
    const release = await this.mutex.acquire()
    try {
      const now = Date.now()
      const contextEntry: ContextEntry<T> = {
        contextType,
        data: context,
        createdAt: now,
        lastAccessed: now,
      }

      this.contexts.set(userId, contextEntry as ContextEntry<BaseContext>)
      this.logger.log({ userId, contextType }, 'Context set for user')
    } finally {
      release()
    }
  }

  async getContext<T extends BaseContext>(userId: string): Promise<T | null> {
    const release = await this.mutex.acquire()
    try {
      const entry = this.contexts.get(userId)
      if (!entry) {
        return null
      }

      // Check if context has expired
      const now = Date.now()
      if (now - entry.createdAt > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log({ userId }, 'Context expired and removed for user')
        return null
      }

      // Update last accessed time
      entry.lastAccessed = now
      return entry.data as T
    } finally {
      release()
    }
  }

  async clearContext(userId: string): Promise<boolean> {
    const release = await this.mutex.acquire()
    try {
      const deleted = this.contexts.delete(userId)
      if (deleted) {
        this.logger.log({ userId }, 'Context cleared for user')
      }
      return deleted
    } finally {
      release()
    }
  }

  async hasContext(userId: string): Promise<boolean> {
    const release = await this.mutex.acquire()
    try {
      const entry = this.contexts.get(userId)
      if (!entry) {
        return false
      }

      // Check if context has expired
      const now = Date.now()
      if (now - entry.createdAt > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log({ userId }, 'Context expired and removed for user')
        return false
      }

      return true
    } finally {
      release()
    }
  }

  async getContextType(userId: string): Promise<string | null> {
    const release = await this.mutex.acquire()
    try {
      const entry = this.contexts.get(userId)
      if (!entry) {
        return null
      }

      // Check if context has expired
      const now = Date.now()
      if (now - entry.createdAt > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log({ userId }, 'Context expired and removed for user')
        return null
      }

      // Update last accessed time
      entry.lastAccessed = now
      return entry.contextType
    } finally {
      release()
    }
  }

  @Cron(CONTEXT_CLEANUP_CRON)
  private async cleanupExpiredContexts(): Promise<number> {
    const release = await this.mutex.acquire()
    try {
      const now = Date.now()
      let cleanedCount = 0

      for (const [userId, entry] of this.contexts.entries()) {
        if (now - entry.createdAt > CONTEXT_TTL_MS) {
          this.contexts.delete(userId)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(
          { cleanedCount, totalContexts: this.contexts.size },
          'Cleaned up expired contexts',
        )
      }

      return cleanedCount
    } finally {
      release()
    }
  }
}
