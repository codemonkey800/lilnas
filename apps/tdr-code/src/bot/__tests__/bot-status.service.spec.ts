import { BotStatusService } from 'src/bot/bot-status.service'
import {
  finalize,
  insertGeneration,
  markRunning,
} from 'src/db/bot-generation.repo'
import { createTestDb } from 'src/db/test-db'

function buildService(db: ReturnType<typeof createTestDb>['db']) {
  return new BotStatusService(db)
}

describe('BotStatusService.getStatus', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
    // Override stale threshold to a fixed value for predictable tests.
    process.env.BOT_HEARTBEAT_MS = '5000'
    process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS = '15000'
  })

  afterEach(() => {
    testDb.close()
    delete process.env.BOT_HEARTBEAT_MS
    delete process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS
  })

  it('no rows → never-seen', () => {
    const svc = buildService(testDb.db)
    expect(svc.getStatus()).toEqual({ status: 'never-seen', lastSeenAt: null })
  })

  it('running + fresh heartbeat → online', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    const svc = buildService(testDb.db)
    const result = svc.getStatus(now)
    expect(result.status).toBe('online')
    expect(result.lastSeenAt).toBeNull()
  })

  it('running but heartbeat stale → offline', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const heartbeatTime = new Date(Date.now() - 60_000)
    markRunning(testDb.db, gen.id, 1234, heartbeatTime)
    const svc = buildService(testDb.db)
    const result = svc.getStatus(new Date())
    expect(result.status).toBe('offline')
    expect(result.lastSeenAt).toBe(heartbeatTime.toISOString())
  })

  it('starting (not yet running) → starting', () => {
    insertGeneration(testDb.db, { startedAt: new Date() })
    const svc = buildService(testDb.db)
    const result = svc.getStatus()
    expect(result.status).toBe('starting')
  })

  it('ended (stopped) → offline', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const endedAt = new Date()
    finalize(testDb.db, gen.id, 'stopped', 0, endedAt)
    const svc = buildService(testDb.db)
    const result = svc.getStatus()
    expect(result.status).toBe('offline')
    expect(result.lastSeenAt).toBe(endedAt.toISOString())
  })

  it('ended (crashed) → offline', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    finalize(testDb.db, gen.id, 'crashed', 1, new Date())
    expect(buildService(testDb.db).getStatus().status).toBe('offline')
  })

  it('terminal row with fresh heartbeat still → offline (gates on ended_at)', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const now = new Date()
    markRunning(testDb.db, gen.id, 1234, now)
    finalize(testDb.db, gen.id, 'stopped', 0, now)
    const svc = buildService(testDb.db)
    // Even though heartbeat is fresh, endedAt is set → offline.
    expect(svc.getStatus(now).status).toBe('offline')
  })

  it('failed status (breaker tripped) → offline-failed', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    finalize(testDb.db, gen.id, 'failed', 1, new Date())
    const result = buildService(testDb.db).getStatus()
    expect(result.status).toBe('offline-failed')
  })
})
