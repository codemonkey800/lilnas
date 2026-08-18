import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity, runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
// See db.service.ts's identical comment: schema.ts has zero table exports
// until Phase 1.
// eslint-disable-next-line import/namespace
import * as schema from 'src/db/schema'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

describe('schema + migrations', () => {
  it('applies migrations cleanly with zero app-level tables (Phase 1 adds `jobs`)', () => {
    const { sqlite, close } = createTestDb()
    try {
      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      expect(tableNames).toEqual([])
    } finally {
      close()
    }
  })

  it('re-asserts foreign_keys = ON after migrate()', () => {
    const sqlite = new BetterSqlite3(':memory:')
    applyPragmas(sqlite)
    const db = drizzle(sqlite, { schema })

    const pragmaSpy = jest.spyOn(sqlite, 'pragma')
    runMigrations(db)

    const reassertionCalls = pragmaSpy.mock.calls.filter(
      ([arg]) => arg === 'foreign_keys = ON',
    )
    expect(reassertionCalls.length).toBeGreaterThanOrEqual(1)

    const fkStatus = sqlite.pragma('foreign_keys') as Array<{
      foreign_keys: number
    }>
    expect(fkStatus[0]?.foreign_keys).toBe(1)
    sqlite.close()
  })

  it('checkIntegrity() passes on a freshly migrated database', () => {
    const { db, close } = createTestDb()
    try {
      expect(() => checkIntegrity(db)).not.toThrow()
    } finally {
      close()
    }
  })

  it('checkIntegrity() throws when the underlying check reports a problem', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      jest.spyOn(sqlite, 'prepare').mockReturnValue({
        get: () => ({ integrity_check: 'corruption detected' }),
      } as unknown as ReturnType<BetterSqlite3.Database['prepare']>)

      expect(() => checkIntegrity(db)).toThrow(/integrity_check failed/)
    } finally {
      close()
    }
  })
})
