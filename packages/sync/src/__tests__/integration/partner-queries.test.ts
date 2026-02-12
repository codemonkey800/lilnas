import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestProfile, createTestUser, truncateAll } from './helpers'

// Mock auth before importing queries (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

const { getPartnerInfo } = await import('src/app/(app)/partner/queries')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('getPartnerInfo', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('returns partner display name, pronouns, and email', async () => {
    const user = await createTestUser({ email: 'alice@test.com' })
    await createTestProfile(user.id, {
      displayName: 'Alice',
      pronouns: 'she/her',
    })

    const result = await getPartnerInfo(user.id)

    expect(result).toEqual({
      displayName: 'Alice',
      pronouns: 'she/her',
      email: 'alice@test.com',
    })
  })

  it('returns null for pronouns when not set', async () => {
    const user = await createTestUser({ email: 'bob@test.com' })
    await createTestProfile(user.id, { displayName: 'Bob' })

    const result = await getPartnerInfo(user.id)

    expect(result).toEqual({
      displayName: 'Bob',
      pronouns: null,
      email: 'bob@test.com',
    })
  })

  it('returns null when partner has no profile', async () => {
    const user = await createTestUser()

    const result = await getPartnerInfo(user.id)

    expect(result).toBeNull()
  })

  it('returns null for a non-existent user id', async () => {
    const result = await getPartnerInfo('non-existent-id')

    expect(result).toBeNull()
  })
})
