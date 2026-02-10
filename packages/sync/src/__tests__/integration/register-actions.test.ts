import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { users } from 'src/db/schema'
import { verifyPassword } from 'src/lib/password'

import { createTestUser, testDb, truncateAll } from './helpers'

// Import action under test (setup file mocks src/db and next/cache)
const { register } = await import('src/app/(auth)/register/actions')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value)
  }
  return fd
}

async function findUserByEmail(email: string) {
  const rows = await testDb
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  return rows[0]
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('register', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('registers a user with valid credentials', async () => {
    const result = await register(
      formData({ email: 'alice@test.com', password: 'securepass123' }),
    )

    expect(result).toEqual({ success: true })

    const user = await findUserByEmail('alice@test.com')

    expect(user).toBeDefined()
    expect(user!.email).toBe('alice@test.com')
  })

  it('stores a hashed password, not plaintext', async () => {
    await register(
      formData({ email: 'alice@test.com', password: 'securepass123' }),
    )

    const user = await findUserByEmail('alice@test.com')

    expect(user!.passwordHash).not.toBe('securepass123')
    expect(user!.passwordHash).toBeTruthy()

    // Verify the hash matches the original password
    const matches = await verifyPassword('securepass123', user!.passwordHash!)
    expect(matches).toBe(true)
  })

  it('rejects invalid email (no @)', async () => {
    const result = await register(
      formData({ email: 'not-an-email', password: 'securepass123' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Please enter a valid email address.',
    })
  })

  it('rejects missing email', async () => {
    const result = await register(formData({ password: 'securepass123' }))

    expect(result).toEqual({
      success: false,
      error: 'Please enter a valid email address.',
    })
  })

  it('rejects short password (< 8 characters)', async () => {
    const result = await register(
      formData({ email: 'alice@test.com', password: 'short' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Password must be at least 8 characters.',
    })
  })

  it('rejects missing password', async () => {
    const result = await register(formData({ email: 'alice@test.com' }))

    expect(result).toEqual({
      success: false,
      error: 'Password must be at least 8 characters.',
    })
  })

  it('rejects duplicate email', async () => {
    await createTestUser({ email: 'alice@test.com' })

    const result = await register(
      formData({ email: 'alice@test.com', password: 'securepass123' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'An account with this email already exists.',
    })
  })

  it('does not normalize email case (case-sensitive uniqueness)', async () => {
    await register(
      formData({ email: 'alice@test.com', password: 'securepass123' }),
    )

    // The register action does not normalize email to lowercase,
    // so differently-cased emails create separate accounts.
    const result = await register(
      formData({ email: 'ALICE@TEST.COM', password: 'securepass123' }),
    )

    expect(result).toEqual({ success: true })
  })
})
