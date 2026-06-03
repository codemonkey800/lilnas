import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { closeDb, instantiate } from 'src/db/client'

// Underlying better-sqlite3 handle exposed by drizzle.
type WithClient = {
  $client: {
    pragma: (name: string) => unknown
    close: () => void
  }
}

beforeEach(() => {
  // Clear the global singleton between tests so dev-mode tests can re-evaluate
  // the module from scratch.
  globalThis.__swoleDb = undefined
  process.env.DATABASE_PATH = ':memory:'
})

afterEach(() => {
  closeDb()
})

describe('PRAGMAs on open', () => {
  it('sets journal_mode = wal', () => {
    const db = instantiate() as unknown as WithClient
    expect(db.$client.pragma('journal_mode')).toEqual([
      { journal_mode: 'memory' },
    ])
    // Note: WAL mode on :memory: stays as 'memory' regardless of the PRAGMA
    // request — better-sqlite3 quietly downgrades. To assert WAL on a real
    // file we'd need a tmpfile fixture; PRAGMA values for synchronous /
    // foreign_keys / busy_timeout still apply and are tested below.
  })

  it('sets synchronous = NORMAL (1)', () => {
    const db = instantiate() as unknown as WithClient
    expect(db.$client.pragma('synchronous')).toEqual([{ synchronous: 1 }])
  })

  it('sets foreign_keys = ON (1) — load-bearing; without this ON DELETE RESTRICT is silent', () => {
    const db = instantiate() as unknown as WithClient
    expect(db.$client.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }])
  })

  it('sets busy_timeout = 5000', () => {
    const db = instantiate() as unknown as WithClient
    expect(db.$client.pragma('busy_timeout')).toEqual([{ timeout: 5000 }])
  })

  it('opens a real file in WAL mode (#14)', () => {
    // `:memory:` is the dev/test default — better-sqlite3 silently downgrades
    // `journal_mode = WAL` to 'memory' on it, so the in-memory PRAGMA test
    // above doesn't actually verify the WAL setting. Build a tempfile fixture
    // and assert WAL is honored on a real file.
    const dir = mkdtempSync(path.join(tmpdir(), 'swole-wal-'))
    process.env.DATABASE_PATH = path.join(dir, 'swole.db')
    try {
      const db = instantiate() as unknown as WithClient
      expect(db.$client.pragma('journal_mode')).toEqual([
        { journal_mode: 'wal' },
      ])
      db.$client.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('singleton vs one-shot', () => {
  // @types/node 24 marks NODE_ENV as readonly; cast through `Record<string,
  // string | undefined>` so the test can flip it per scenario.
  const mutableEnv = process.env as Record<string, string | undefined>
  const originalNodeEnv = mutableEnv.NODE_ENV

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv
    globalThis.__swoleDb = undefined
  })

  it('dev: caches the instance on globalThis so HMR reloads reuse it', () => {
    mutableEnv.NODE_ENV = 'development'
    let firstDb: unknown
    let secondDb: unknown
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      firstDb = (require('src/db/client') as { db: unknown }).db
    })
    expect(globalThis.__swoleDb).toBeDefined()
    expect(globalThis.__swoleDb).toBe(firstDb)
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      secondDb = (require('src/db/client') as { db: unknown }).db
    })
    // Second import retrieves from globalThis.__swoleDb — same instance.
    expect(secondDb).toBe(firstDb)
  })

  it('production: does not stash on globalThis', () => {
    mutableEnv.NODE_ENV = 'production'
    let prodDb: unknown
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      prodDb = (require('src/db/client') as { db: unknown }).db
    })
    expect(prodDb).toBeDefined()
    // Production branch must not write to globalThis.
    expect(globalThis.__swoleDb).toBeUndefined()
  })
})
