import { PinoLogger } from 'nestjs-pino'

import { BotStatusService } from 'src/bot/bot-status.service'
import { insertGeneration, markRunning } from 'src/db/bot-generation.repo'
import { upsertLiveStatus } from 'src/db/live-status.repo'
import { createTestDb } from 'src/db/test-db'
import { LiveService } from 'src/console/live.service'

function fakeLogger(): PinoLogger {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as unknown as PinoLogger
}

function buildService(db: ReturnType<typeof createTestDb>['db']) {
  const botStatus = new BotStatusService(db)
  return new LiveService(db, botStatus, fakeLogger())
}

describe('LiveService.getLive', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
    process.env.BOT_HEARTBEAT_MS = '5000'
    process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS = '15000'
  })

  afterEach(() => {
    testDb.close()
    delete process.env.BOT_HEARTBEAT_MS
    delete process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS
  })

  it('no generation → never-seen, empty items', () => {
    const svc = buildService(testDb.db)
    const result = svc.getLive()
    expect(result.globalStatus).toBe('never-seen')
    expect(result.botOffline).toBe(true)
    expect(result.items).toHaveLength(0)
  })

  it('running generation, fresh heartbeat, prompting=true → working', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    upsertLiveStatus(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      prompting: true,
      queueDepth: 0,
      lastActivityAt: now,
      lastHeartbeatAt: now,
    })
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.globalStatus).toBe('online')
    expect(result.botOffline).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.state).toBe('working')
    expect(result.items[0]!.channelId).toBe('ch1')
  })

  it('running generation, fresh heartbeat, prompting=false → idle', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    upsertLiveStatus(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: null,
      prompting: false,
      queueDepth: 0,
      lastActivityAt: now,
      lastHeartbeatAt: now,
    })
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.items[0]!.state).toBe('idle')
  })

  it('stale per-channel heartbeat while bot generation is fresh → stale state', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    // Bot-generation heartbeat is fresh so BotStatusService returns 'online'.
    markRunning(testDb.db, gen.id, 1234, now)
    // live_status heartbeat is stale (60s old > 15s threshold).
    const staleAt = new Date(now.getTime() - 60_000)
    upsertLiveStatus(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: null,
      prompting: false,
      queueDepth: 0,
      lastActivityAt: staleAt,
      lastHeartbeatAt: staleAt,
    })
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.items[0]!.state).toBe('stale')
  })

  it('bot offline → last-known state for all rows', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    upsertLiveStatus(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: null,
      prompting: true,
      queueDepth: 0,
      lastActivityAt: now,
      lastHeartbeatAt: now,
    })
    // Finalize the generation to simulate bot offline (BotStatusService returns offline).
    const { finalize } = require('src/db/bot-generation.repo')
    finalize(testDb.db, gen.id, 'stopped', 0, now)
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.botOffline).toBe(true)
    expect(result.globalStatus).toBe('offline')
    expect(result.items[0]!.state).toBe('last-known')
  })

  it('B12: bot online, zero live rows → genuinely-empty, items=[]', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.globalStatus).toBe('online')
    expect(result.botOffline).toBe(false)
    expect(result.items).toHaveLength(0)
  })

  it('prior-generation live_status rows are not shown for the new generation', () => {
    // Create two generations. Insert a live_status row for gen1.
    const gen1 = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen1.id, 1111, now)
    upsertLiveStatus(testDb.db, {
      channelId: 'ch1',
      generationId: gen1.id,
      triggeringUserId: null,
      prompting: true,
      queueDepth: 0,
      lastActivityAt: now,
      lastHeartbeatAt: now,
    })
    // Finalize gen1, start gen2.
    const { finalize } = require('src/db/bot-generation.repo')
    finalize(testDb.db, gen1.id, 'stopped', 0, now)
    const gen2 = insertGeneration(testDb.db, { startedAt: now })
    markRunning(testDb.db, gen2.id, 2222, now)
    // The service should use gen2 (latest) and find no rows for it.
    const svc = buildService(testDb.db)
    const result = svc.getLive(now)
    expect(result.items).toHaveLength(0)
  })
})
