import { sql } from 'drizzle-orm'
import type { Mock } from 'vitest'

import { testDb } from 'src/__tests__/integration-setup'
import { partnerships, profiles, users } from 'src/db/schema'

// Re-export for convenience in test files
export { testDb }

// ---------------------------------------------------------------------------
// Auth mock helper
// ---------------------------------------------------------------------------

/**
 * Import the mocked auth module and configure it to return a session
 * for the given userId. Call with `null` to simulate unauthenticated.
 */
export async function mockAuthAs(userId: string | null): Promise<void> {
  // auth() has overloaded signatures in NextAuth v5 (session getter +
  // middleware). Cast through unknown to a plain Mock so mockResolvedValue
  // works cleanly against the mocked module.
  const authModule = await import('src/auth')
  const mockedAuth = authModule.auth as unknown as Mock

  if (userId) {
    mockedAuth.mockResolvedValue({
      user: { id: userId },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    })
  } else {
    mockedAuth.mockResolvedValue(null)
  }
}

// ---------------------------------------------------------------------------
// Table truncation
// ---------------------------------------------------------------------------

const TABLES_IN_DELETE_ORDER = [partnerships, profiles, users] as const

/**
 * Truncate all application tables between tests. Uses DELETE (not TRUNCATE)
 * to avoid issues with table locks and CASCADE in parallel tests.
 */
export async function truncateAll(): Promise<void> {
  for (const table of TABLES_IN_DELETE_ORDER) {
    await testDb.delete(table)
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

interface CreateUserOptions {
  id?: string
  email?: string
  name?: string
  passwordHash?: string
}

/**
 * Insert a user into the test database and return the created row.
 */
export async function createTestUser(
  overrides: CreateUserOptions = {},
): Promise<{ id: string; email: string | null }> {
  const id = overrides.id ?? crypto.randomUUID()
  const email = overrides.email ?? `${id.slice(0, 8)}@test.com`

  const rows = await testDb
    .insert(users)
    .values({
      id,
      email,
      name: overrides.name ?? null,
      passwordHash: overrides.passwordHash ?? null,
    })
    .returning({ id: users.id, email: users.email })

  return rows[0]!
}

interface CreateProfileOptions {
  displayName?: string
  birthday?: string
  pronouns?: string
  loveLang?: string
  interests?: string
  goals?: string
  onboardingCompleted?: boolean
}

/**
 * Insert a profile for the given user. Returns the created profile id.
 */
export async function createTestProfile(
  userId: string,
  overrides: CreateProfileOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(profiles)
    .values({
      userId,
      displayName: overrides.displayName ?? 'Test User',
      birthday: overrides.birthday ?? null,
      pronouns: overrides.pronouns ?? null,
      loveLang: overrides.loveLang ?? null,
      interests: overrides.interests ?? null,
      goals: overrides.goals ?? null,
      onboardingCompleted: overrides.onboardingCompleted ?? false,
    })
    .returning({ id: profiles.id })

  return rows[0]!
}

/**
 * Insert a partnership directly (for setting up test preconditions).
 */
export async function createTestPartnership(
  inviterId: string,
  inviteeId: string,
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'dissolved',
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(partnerships)
    .values({ inviterId, inviteeId, status })
    .returning({ id: partnerships.id })

  return rows[0]!
}

/**
 * Read a partnership row by id.
 */
export async function getPartnership(
  id: string,
): Promise<{ status: string } | undefined> {
  const [row] = await testDb
    .select({ status: partnerships.status })
    .from(partnerships)
    .where(sql`${partnerships.id} = ${id}`)
    .limit(1)

  return row
}
