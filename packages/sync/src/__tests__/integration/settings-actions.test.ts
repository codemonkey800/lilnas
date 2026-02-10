import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { profiles } from 'src/db/schema'

import {
  createTestProfile,
  createTestUser,
  mockAuthAs,
  testDb,
  truncateAll,
} from './helpers'

vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

const { updateProfile } = await import('src/app/(app)/settings/actions')
type ProfileData = Parameters<typeof updateProfile>[0]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validProfileData(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    displayName: 'Alice',
    birthday: '1990-01-15',
    pronouns: 'she/her',
    loveLang: 'quality-time',
    interests: ['hiking', 'cooking'],
    goals: ['communication', 'date-nights'],
    ...overrides,
  }
}

async function findProfile(userId: string) {
  const rows = await testDb
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)

  return rows[0]
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('updateProfile (settings)', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('updates an existing profile', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id, {
      displayName: 'Old Name',
      pronouns: 'they/them',
    })
    await mockAuthAs(user.id)

    const result = await updateProfile(
      validProfileData({ displayName: 'New Name', pronouns: 'he/him' }),
    )

    expect(result).toEqual({ success: true })

    const profile = await findProfile(user.id)
    expect(profile!.displayName).toBe('New Name')
    expect(profile!.pronouns).toBe('he/him')
  })

  it('trims display name whitespace', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id)
    await mockAuthAs(user.id)

    await updateProfile(validProfileData({ displayName: '  Padded  ' }))

    const profile = await findProfile(user.id)
    expect(profile!.displayName).toBe('Padded')
  })

  it('serializes interests and goals as JSON', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id)
    await mockAuthAs(user.id)

    await updateProfile(
      validProfileData({
        interests: ['reading', 'music'],
        goals: ['gratitude'],
      }),
    )

    const profile = await findProfile(user.id)
    expect(profile!.interests).toBe(JSON.stringify(['reading', 'music']))
    expect(profile!.goals).toBe(JSON.stringify(['gratitude']))
  })

  it('stores null for empty optional fields', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id, {
      birthday: '2000-01-01',
      pronouns: 'she/her',
      loveLang: 'words',
    })
    await mockAuthAs(user.id)

    await updateProfile(
      validProfileData({ birthday: '', pronouns: '', loveLang: '' }),
    )

    const profile = await findProfile(user.id)
    expect(profile!.birthday).toBeNull()
    expect(profile!.pronouns).toBeNull()
    expect(profile!.loveLang).toBeNull()
  })

  it('rejects empty display name', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id)
    await mockAuthAs(user.id)

    const result = await updateProfile(validProfileData({ displayName: '   ' }))

    expect(result).toEqual({
      success: false,
      error: 'Display name is required.',
    })
  })

  it('rejects unauthenticated user', async () => {
    await mockAuthAs(null)

    const result = await updateProfile(validProfileData())

    expect(result).toEqual({ success: false, error: 'You must be logged in.' })
  })

  it('silently succeeds when user has no profile (no-op update)', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    const result = await updateProfile(validProfileData())

    expect(result).toEqual({ success: true })

    // Verify no profile was inadvertently created
    const profile = await findProfile(user.id)
    expect(profile).toBeUndefined()
  })
})
