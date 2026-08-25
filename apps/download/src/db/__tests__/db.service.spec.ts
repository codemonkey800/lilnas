import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'

describe('DbService', () => {
  const originalDatabasePath = process.env.DATABASE_PATH

  beforeEach(() => {
    process.env.DATABASE_PATH = ':memory:'
  })

  afterEach(() => {
    process.env.DATABASE_PATH = originalDatabasePath
  })

  it('connects, migrates, and passes integrity check with no throw', () => {
    const service = new DbService()
    expect(() => service.runMigrations()).not.toThrow()
    expect(() => service.checkIntegrity()).not.toThrow()
    expect(service.db).toBeDefined()
    service.onModuleDestroy()
  })

  // The restart path, which an in-memory database can't exercise: a second
  // boot against an already-migrated file must be a no-op rather than
  // re-running anything. This is what proves migration 0006's table rebuild
  // is safe to ship - `schema.spec.ts` proves the 0005 -> 0006 SQL preserves
  // rows, and this proves the migrator won't run it twice against a database
  // that already has it.
  it('re-migrates an already-migrated database without touching its rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilnas-download-db-'))
    const dbPath = path.join(dir, 'download.db')
    process.env.DATABASE_PATH = dbPath

    try {
      const first = new DbService()
      first.runMigrations()
      first.db
        .insert(jobs)
        .values({
          id: 'job-1',
          mediaId: 'tvdb:81189',
          origin: 'service',
          scope: { seasonNumber: 3 },
          status: 'searching',
          type: 'show',
        })
        .run()
      first.onModuleDestroy()

      const second = new DbService()
      expect(() => second.runMigrations()).not.toThrow()
      expect(() => second.checkIntegrity()).not.toThrow()

      expect(second.db.select().from(jobs).all()).toMatchObject([
        { id: 'job-1', mediaId: 'tvdb:81189', scope: { seasonNumber: 3 } },
      ])
      second.onModuleDestroy()
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })
})
