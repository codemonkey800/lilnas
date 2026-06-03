// Mock the dynamic imports BEFORE importing the module under test.
const mockDb = {
  $client: {
    prepare: jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ n: 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return { get: () => ({ integrity_check: 'ok' }) }
      }
      return { get: () => ({ n: 7 }) }
    }),
  },
}

const mockRunMigrations = jest.fn()
const mockLoggerInfo = jest.fn()
const mockLoggerError = jest.fn()
const mockCloseDb = jest.fn()

jest.mock('src/db/client', () => ({ db: mockDb, closeDb: mockCloseDb }))
jest.mock('src/db/migrate', () => ({ runMigrations: mockRunMigrations }))
jest.mock('src/lib/logger', () => ({
  logger: { info: mockLoggerInfo, error: mockLoggerError },
}))

import { register } from 'src/instrumentation'

// Replace process.exit directly (not via jest.spyOn) so Jest's worker-level
// process.exit detection sees a no-op instead of an actual termination call.
let exitCode: number | null = null
const realExit = process.exit
;(process as { exit: (code?: number | string | null) => void }).exit = ((
  code?: number | string | null,
) => {
  exitCode = typeof code === 'number' ? code : null
}) as never

afterAll(() => {
  process.exit = realExit
})

describe('register()', () => {
  const mutableEnv = process.env as Record<string, string | undefined>
  const originalRuntime = mutableEnv.NEXT_RUNTIME

  beforeEach(() => {
    exitCode = null
    mockRunMigrations.mockReset()
    mockLoggerInfo.mockReset()
    mockLoggerError.mockReset()
    mockCloseDb.mockReset()
    // Default: integrity check passes.
    mockDb.$client.prepare = jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ n: 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return { get: () => ({ integrity_check: 'ok' }) }
      }
      return { get: () => ({ n: 7 }) }
    })
  })

  afterEach(() => {
    if (originalRuntime === undefined) {
      delete mutableEnv.NEXT_RUNTIME
    } else {
      mutableEnv.NEXT_RUNTIME = originalRuntime
    }
  })

  it('runs migrations and logs applied/total when NEXT_RUNTIME is nodejs', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    let migrationCallCount = 0
    mockDb.$client.prepare = jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ n: 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return { get: () => ({ integrity_check: 'ok' }) }
      }
      migrationCallCount++
      return { get: () => ({ n: migrationCallCount === 1 ? 7 : 9 }) }
    })

    await register()
    expect(mockRunMigrations).toHaveBeenCalledTimes(1)
    expect(mockRunMigrations).toHaveBeenCalledWith(mockDb)
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { applied: 2, total: 9 },
      'swole migrations applied',
    )
    expect(exitCode).toBeNull()
  })

  it('logs applied: 0 on subsequent boot with no new migrations', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    mockDb.$client.prepare = jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ n: 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return { get: () => ({ integrity_check: 'ok' }) }
      }
      return { get: () => ({ n: 9 }) }
    })
    await register()
    expect(mockLoggerInfo).toHaveBeenLastCalledWith(
      { applied: 0, total: 9 },
      'swole migrations applied',
    )
  })

  it('treats a missing __drizzle_migrations table as count 0 (first-boot path)', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    let probeCount = 0
    mockDb.$client.prepare = jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        probeCount++
        return { get: () => ({ n: probeCount === 1 ? 0 : 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return { get: () => ({ integrity_check: 'ok' }) }
      }
      return { get: () => ({ n: 5 }) }
    })
    await register()
    expect(mockLoggerInfo).toHaveBeenLastCalledWith(
      { applied: 5, total: 5 },
      'swole migrations applied',
    )
  })

  it('skips entirely when NEXT_RUNTIME is not nodejs', async () => {
    mutableEnv.NEXT_RUNTIME = 'edge'
    await register()
    expect(mockRunMigrations).not.toHaveBeenCalled()
    expect(mockLoggerInfo).not.toHaveBeenCalled()
  })

  it('skips entirely when NEXT_RUNTIME is undefined', async () => {
    delete mutableEnv.NEXT_RUNTIME
    await register()
    expect(mockRunMigrations).not.toHaveBeenCalled()
    expect(mockLoggerInfo).not.toHaveBeenCalled()
  })

  it('process.exit(1) when runMigrations throws — boot must fail loudly (#5)', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    const boom = new Error('migration 0003 failed')
    mockRunMigrations.mockImplementationOnce(() => {
      throw boom
    })
    await register()
    expect(mockLoggerError).toHaveBeenCalledWith(
      { err: boom },
      'swole boot failed; exiting',
    )
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      expect.anything(),
      'swole migrations applied',
    )
    expect(exitCode).toBe(1)
  })

  it('process.exit(1) when PRAGMA integrity_check fails (#7)', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    mockDb.$client.prepare = jest.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ n: 1 }) }
      }
      if (sql.startsWith('PRAGMA integrity_check')) {
        return {
          get: () => ({ integrity_check: 'database disk image is malformed' }),
        }
      }
      return { get: () => ({ n: 5 }) }
    })
    await register()
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining('integrity_check failed'),
        }),
      }),
      'swole boot failed; exiting',
    )
    expect(exitCode).toBe(1)
  })

  it('registers SIGTERM/SIGINT handlers that close the DB and exit cleanly (#27)', async () => {
    mutableEnv.NEXT_RUNTIME = 'nodejs'
    const onceSpy = jest.spyOn(process, 'once')
    await register()
    const sigtermCall = onceSpy.mock.calls.find(c => c[0] === 'SIGTERM')
    const sigintCall = onceSpy.mock.calls.find(c => c[0] === 'SIGINT')
    expect(sigtermCall).toBeDefined()
    expect(sigintCall).toBeDefined()

    // Invoke the SIGTERM handler — it should call closeDb and exit 0.
    const sigtermHandler = sigtermCall![1] as () => void
    sigtermHandler()
    expect(mockCloseDb).toHaveBeenCalled()
    expect(exitCode).toBe(0)
    onceSpy.mockRestore()
  })
})
