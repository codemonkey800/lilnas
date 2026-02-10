import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, vi } from 'vitest'

import * as schema from 'src/db/schema'

// ---------------------------------------------------------------------------
// Test database connection
//
// Schema is pushed by `drizzle-kit push` in scripts/test-integration.sh
// before vitest starts — no need to create tables here.
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://sync_test:testpass@localhost:5433/sync_test'

const pool = new Pool({ connectionString: TEST_DATABASE_URL })
export const testDb = drizzle(pool, { schema })

// ---------------------------------------------------------------------------
// Mock src/db to use the test database
// ---------------------------------------------------------------------------

vi.mock('src/db', () => ({
  db: testDb,
}))

// ---------------------------------------------------------------------------
// Mock next/cache (revalidatePath is a Next.js runtime concern)
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Cleanup — close pool after all tests
// ---------------------------------------------------------------------------

afterAll(async () => {
  await pool.end()
})
