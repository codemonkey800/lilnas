import { insertGeneration } from 'src/db/bot-generation.repo'
import { livePgids, recordSpawn } from 'src/db/claude-process.repo'
import { createTestDb } from 'src/db/test-db'
import { reapGeneration } from 'src/supervisor/reaper'

const FAKE_PGIDS = [42001, 42002, 42003]

describe('reapGeneration', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
    // Mock process.kill so we don't actually kill anything.
    jest.spyOn(process, 'kill').mockImplementation(() => true)
  })

  afterEach(() => {
    testDb.close()
    jest.restoreAllMocks()
  })

  it('reaps live PGIDs via process.kill(-pgid, SIGKILL)', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    recordSpawn(testDb.db, {
      generationId: gen.id,
      pgid: FAKE_PGIDS[0]!,
      channelId: null,
      spawnedAt: new Date(),
    })

    reapGeneration(testDb.db, gen.id)

    expect(process.kill).toHaveBeenCalledWith(-FAKE_PGIDS[0]!, 'SIGKILL')
    expect(livePgids(testDb.db, gen.id)).toHaveLength(0)
  })

  it('graceful exit: no live PGIDs → no-op (no kill calls)', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    reapGeneration(testDb.db, gen.id)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('empty generation with no claude_process rows → no-op', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    expect(() => reapGeneration(testDb.db, gen.id)).not.toThrow()
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('killing an already-dead PGID is swallowed (ESRCH)', () => {
    jest.restoreAllMocks()
    jest.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 'SIGKILL')
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return true
    })

    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    recordSpawn(testDb.db, {
      generationId: gen.id,
      pgid: 99001,
      channelId: null,
      spawnedAt: new Date(),
    })

    expect(() => reapGeneration(testDb.db, gen.id)).not.toThrow()
    expect(livePgids(testDb.db, gen.id)).toHaveLength(0)
  })

  it('PGID-reuse TTL guard: old row is marked exited without kill', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    // Spawn with a date 2 hours ago (well past the 30-min TTL).
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000)
    recordSpawn(testDb.db, {
      generationId: gen.id,
      pgid: 88001,
      channelId: null,
      spawnedAt: oldDate,
    })

    reapGeneration(testDb.db, gen.id)

    expect(process.kill).not.toHaveBeenCalled()
    expect(livePgids(testDb.db, gen.id)).toHaveLength(0)
  })

  it('reaps multiple PGIDs in one call', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    for (const pgid of FAKE_PGIDS) {
      recordSpawn(testDb.db, {
        generationId: gen.id,
        pgid,
        channelId: null,
        spawnedAt: new Date(),
      })
    }

    reapGeneration(testDb.db, gen.id)

    expect(process.kill).toHaveBeenCalledTimes(FAKE_PGIDS.length)
    expect(livePgids(testDb.db, gen.id)).toHaveLength(0)
  })
})
