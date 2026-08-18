import { DbService } from 'src/db/db.service'

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
})
