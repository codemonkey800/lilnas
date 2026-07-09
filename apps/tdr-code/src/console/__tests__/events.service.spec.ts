import type { DiscordDirectoryService } from 'src/console/discord-directory.service'
import { EventsService } from 'src/console/events.service'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertEvent } from 'src/db/events.repo'
import { createTestDb } from 'src/db/test-db'

function fakeDiscordDirectory(): DiscordDirectoryService {
  return {
    getChannelName: jest.fn().mockResolvedValue(null),
  } as unknown as DiscordDirectoryService
}

function buildService(db: ReturnType<typeof createTestDb>['db']) {
  return new EventsService(db, fakeDiscordDirectory())
}

describe('EventsService.listEvents', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  function seedEvents(
    db: ReturnType<typeof createTestDb>['db'],
    count: number,
  ) {
    const gen = insertGeneration(db, { startedAt: new Date() })
    for (let i = 0; i < count; i++) {
      insertEvent(db, {
        generationId: gen.id,
        type: i % 2 === 0 ? 'bot_restart' : 'turn_errored',
        level: i % 3 === 0 ? 'error' : 'info',
        context: {},
        createdAt: new Date(Date.now() + i * 1000),
      })
    }
    return gen
  }

  it('empty DB → empty items', async () => {
    const svc = buildService(testDb.db)
    const result = await svc.listEvents({ limit: 10 })
    expect(result.items).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })

  it('returns newest first with pagination', async () => {
    seedEvents(testDb.db, 6)
    const svc = buildService(testDb.db)
    const result = await svc.listEvents({ limit: 5 })
    expect(result.items).toHaveLength(5)
    expect(result.nextCursor).not.toBeNull()
    const ids = result.items.map(i => i.id)
    expect(ids).toEqual([...ids].sort((a, b) => b - a))
  })

  it('type filter: only matching events returned', async () => {
    seedEvents(testDb.db, 4)
    const svc = buildService(testDb.db)
    const result = await svc.listEvents({ type: 'bot_restart', limit: 10 })
    expect(result.items.every(i => i.type === 'bot_restart')).toBe(true)
  })

  it('level filter: only matching events returned', async () => {
    seedEvents(testDb.db, 6)
    const svc = buildService(testDb.db)
    const result = await svc.listEvents({ level: 'error', limit: 10 })
    expect(result.items.every(i => i.level === 'error')).toBe(true)
  })

  it('two events with same created_at, distinct id → stable keyset', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const ts = new Date()
    for (let i = 0; i < 4; i++) {
      insertEvent(testDb.db, {
        generationId: gen.id,
        type: 'bot_restart',
        level: 'info',
        context: {},
        createdAt: ts,
      })
    }
    const svc = buildService(testDb.db)
    const page1 = await svc.listEvents({ limit: 2 })
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await svc.listEvents({ cursor: page1.nextCursor!, limit: 2 })
    const p1Ids = new Set(page1.items.map(i => i.id))
    for (const item of page2.items) {
      expect(p1Ids.has(item.id)).toBe(false)
    }
  })

  it('event with null sessionId → DTO has null sessionId', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    insertEvent(testDb.db, {
      generationId: gen.id,
      type: 'bot_restart',
      level: 'info',
      context: {},
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = await svc.listEvents({ limit: 10 })
    expect(result.items[0]!.sessionId).toBeNull()
    expect(result.items[0]!.channelId).toBeNull()
  })
})
