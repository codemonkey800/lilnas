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
      this.logger.log(
        { userId, contextType, timestamp: now, ttl: CONTEXT_TTL_MS },
        'Context set for user',
      )
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
      const age = now - entry.createdAt
      if (age > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log(
          {
            userId,
            contextType: entry.contextType,
            age,
            ttl: CONTEXT_TTL_MS,
          },
          'Context expired and removed for user',
        )
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
      const entry = this.contexts.get(userId)
      const deleted = this.contexts.delete(userId)
      if (deleted && entry) {
        const age = Date.now() - entry.createdAt
        this.logger.log(
          { userId, contextType: entry.contextType, age },
          'Context cleared for user',
        )
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
      const age = now - entry.createdAt
      if (age > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log(
          {
            userId,
            contextType: entry.contextType,
            age,
            ttl: CONTEXT_TTL_MS,
          },
          'Context expired and removed for user',
        )
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
      const age = now - entry.createdAt
      if (age > CONTEXT_TTL_MS) {
        this.contexts.delete(userId)
        this.logger.log(
          {
            userId,
            contextType: entry.contextType,
            age,
            ttl: CONTEXT_TTL_MS,
          },
          'Context expired and removed for user',
        )
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
      const contextTypeCounts: Record<string, number> = {}

      for (const [userId, entry] of this.contexts.entries()) {
        const age = now - entry.createdAt
        if (age > CONTEXT_TTL_MS) {
          this.contexts.delete(userId)
          cleanedCount++
          contextTypeCounts[entry.contextType] =
            (contextTypeCounts[entry.contextType] || 0) + 1
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(
          {
            cleanedCount,
            remainingContexts: this.contexts.size,
            contextTypeCounts,
            ttl: CONTEXT_TTL_MS,
          },
          'Cleaned up expired contexts',
        )
      }

      return cleanedCount
    } finally {
      release()
    }
  }
}
