import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import {
  GATED_HOST_MAX_AGE_MS,
  GatedHostsService,
} from 'src/services/gated-hosts.service'
import { ServiceRegistryService } from 'src/services/service-registry.service'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as PinoLogger
}

function readRows(db: Db) {
  return db.select().from(schema.gatedHost).all()
}

const HOUR_MS = 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)

describe('GatedHostsService', () => {
  let testDb: ReturnType<typeof createTestDb>
  let logger: PinoLogger
  let service: GatedHostsService

  beforeEach(() => {
    testDb = createTestDb()
    logger = fakeLogger()
    service = new GatedHostsService(testDb.db, logger)
  })

  afterEach(() => {
    testDb.close()
  })

  it('records a lilnas.io host the first time it is seen', () => {
    service.recordSeen('hop-road.dev.lilnas.io', NOW)

    expect(readRows(testDb.db)).toEqual([
      {
        host: 'hop-road.dev.lilnas.io',
        firstSeenAt: new Date(NOW),
        lastSeenAt: new Date(NOW),
      },
    ])
  })

  it('ignores hosts outside lilnas.io, including look-alike suffixes', () => {
    service.recordSeen('example.com', NOW)
    service.recordSeen('evil-lilnas.io', NOW)
    service.recordSeen('lilnas.io.evil.com', NOW)
    service.recordSeen('lilnas.io', NOW)
    service.recordSeen('bad_host.lilnas.io', NOW)

    expect(readRows(testDb.db)).toEqual([])
  })

  it('does not touch the DB again for the same host within an hour', () => {
    service.recordSeen('swole.lilnas.io', NOW)
    service.recordSeen('swole.lilnas.io', NOW + HOUR_MS - 1)

    expect(readRows(testDb.db)[0]?.lastSeenAt).toEqual(new Date(NOW))
  })

  it('bumps lastSeenAt (and keeps firstSeenAt) once an hour has passed', () => {
    service.recordSeen('swole.lilnas.io', NOW)
    service.recordSeen('swole.lilnas.io', NOW + HOUR_MS)

    expect(readRows(testDb.db)).toEqual([
      {
        host: 'swole.lilnas.io',
        firstSeenAt: new Date(NOW),
        lastSeenAt: new Date(NOW + HOUR_MS),
      },
    ])
  })

  it('swallows and logs a failed write instead of throwing onto /verify', () => {
    testDb.close()

    expect(() => service.recordSeen('swole.lilnas.io', NOW)).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'gated-host-record-failed' }),
      expect.any(String),
    )

    // Reopened so afterEach's close() has something to close.
    testDb = createTestDb()
  })

  it('lists only hosts seen within the max age, sorted', () => {
    service.recordSeen('zeta.dev.lilnas.io', NOW)
    service.recordSeen('alpha.dev.lilnas.io', NOW)
    service.recordSeen('stale.dev.lilnas.io', NOW - GATED_HOST_MAX_AGE_MS - 1)

    expect(service.listActiveHosts(NOW)).toEqual([
      'alpha.dev.lilnas.io',
      'zeta.dev.lilnas.io',
    ])
  })
})

describe('ServiceRegistryService.getServices — gated-host merge', () => {
  let testDb: ReturnType<typeof createTestDb>
  let gatedHosts: GatedHostsService
  let registry: ServiceRegistryService

  beforeEach(() => {
    testDb = createTestDb()
    const logger = fakeLogger()
    gatedHosts = new GatedHostsService(testDb.db, logger)
    registry = new ServiceRegistryService(logger, gatedHosts)
  })

  afterEach(() => {
    testDb.close()
    jest.restoreAllMocks()
  })

  function stubComposeScan(
    entries: Awaited<ReturnType<ServiceRegistryService['getServices']>>,
  ) {
    jest
      .spyOn(
        registry as unknown as {
          getComposeServices: () => Promise<typeof entries>
        },
        'getComposeServices',
      )
      .mockResolvedValue(entries)
  }

  it('adds a host seen by /verify, gated by lilnas-auth, even a *.dev.lilnas.io one', async () => {
    stubComposeScan([{ host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' }])
    gatedHosts.recordSeen('hop-road.dev.lilnas.io')

    await expect(registry.getServices()).resolves.toEqual([
      { host: 'hop-road.dev.lilnas.io', gatedBy: 'lilnas-auth' },
      { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
    ])
  })

  it('keeps the compose entry (and its classification) when both sources know a host', async () => {
    stubComposeScan([{ host: 'swole.lilnas.io', gatedBy: 'forward-auth' }])
    gatedHosts.recordSeen('swole.lilnas.io')

    await expect(registry.getServices()).resolves.toEqual([
      { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
    ])
  })

  it('still drops blocklisted hosts', async () => {
    stubComposeScan([])
    gatedHosts.recordSeen('auth.lilnas.io')

    await expect(registry.getServices()).resolves.toEqual([])
  })

  it('sees a newly recorded host immediately, without waiting out the compose-scan cache', async () => {
    stubComposeScan([])
    await expect(registry.getServices()).resolves.toEqual([])

    gatedHosts.recordSeen('new.dev.lilnas.io')

    await expect(registry.getServices()).resolves.toEqual([
      { host: 'new.dev.lilnas.io', gatedBy: 'lilnas-auth' },
    ])
  })
})
