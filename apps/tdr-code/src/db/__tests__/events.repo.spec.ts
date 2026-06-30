import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertEvent } from 'src/db/events.repo'
import { createTestDb } from 'src/db/test-db'

describe('events.repo', () => {
  it('insertEvent creates a row with correct fields', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const now = new Date()
      const row = insertEvent(db, {
        generationId: gen.id,
        type: 'bot_restart',
        level: 'info',
        context: { attempt: 1 },
        createdAt: now,
      })
      expect(row.generationId).toBe(gen.id)
      expect(row.type).toBe('bot_restart')
      expect(row.level).toBe('info')
      expect(row.context).toEqual({ attempt: 1 })
      expect(row.sessionId).toBeNull()
      expect(row.channelId).toBeNull()
    } finally {
      close()
    }
  })

  it('insertEvent accepts a global event with null session and channel (bot_restart)', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const row = insertEvent(db, {
        generationId: gen.id,
        sessionId: null,
        channelId: null,
        type: 'bot_restart',
        level: 'info',
        context: {},
        createdAt: new Date(),
      })
      expect(row.sessionId).toBeNull()
      expect(row.channelId).toBeNull()
    } finally {
      close()
    }
  })

  it('accepts transcript_write_failed after migration 0003 widened the CHECK', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      expect(() =>
        insertEvent(db, {
          generationId: gen.id,
          channelId: 'ch1',
          type: 'transcript_write_failed',
          level: 'error',
          context: { op: 'onToolCall', errorCode: 'SQLITE_BUSY' },
          createdAt: new Date(),
        }),
      ).not.toThrow()
    } finally {
      close()
    }
  })

  it('insertEvent with all event types does not throw', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const types = [
        'session_created',
        'session_evicted',
        'turn_started',
        'turn_completed',
        'turn_cancelled',
        'turn_errored',
        'turn_interrupted',
        'bot_restart',
        'command_anomaly',
        'transcript_write_failed',
      ] as const
      for (const type of types) {
        expect(() =>
          insertEvent(db, {
            generationId: gen.id,
            type,
            level: 'info',
            context: {},
            createdAt: new Date(),
          }),
        ).not.toThrow()
      }
    } finally {
      close()
    }
  })

  it('rejects insertEvent with a non-existent generationId (FK violation)', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        insertEvent(db, {
          generationId: 9999,
          type: 'bot_restart',
          level: 'info',
          context: {},
          createdAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })
})
