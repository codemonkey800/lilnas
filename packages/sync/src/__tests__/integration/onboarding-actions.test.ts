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

// Mock auth before importing actions
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import action under test (setup file mocks src/db and next/cache)
const { saveProfile } = await import('src/app/onboarding/actions')
type OnboardingData = Parameters<typeof saveProfile>[0]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validOnboardingData(
  overrides: Partial<OnboardingData> = {},
): OnboardingData {
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

describe('saveProfile (onboarding)', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('creates a new profile on first save', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    const result = await saveProfile(validOnboardingData())

    expect(result).toEqual({ success: true })

    const profile = await findProfile(user.id)

    expect(profile).toBeDefined()
    expect(profile!.displayName).toBe('Alice')
    expect(profile!.birthday).toBe('1990-01-15')
    expect(profile!.pronouns).toBe('she/her')
    expect(profile!.loveLang).toBe('quality-time')
    expect(profile!.onboardingCompleted).toBe(true)
  })

  it('updates existing profile on subsequent save', async () => {
    const user = await createTestUser()
    await createTestProfile(user.id, { displayName: 'Old Name' })
    await mockAuthAs(user.id)

    const result = await saveProfile(
      validOnboardingData({ displayName: 'New Name' }),
    )

    expect(result).toEqual({ success: true })

    const profile = await findProfile(user.id)

    expect(profile!.displayName).toBe('New Name')
    expect(profile!.onboardingCompleted).toBe(true)
  })

  it('rejects empty display name', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    const result = await saveProfile(
      validOnboardingData({ displayName: '   ' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Display name is required.',
    })
  })

  it('rejects unauthenticated user', async () => {
    await mockAuthAs(null)

    const result = await saveProfile(validOnboardingData())

    expect(result).toEqual({ success: false, error: 'You must be logged in.' })
  })

  it('serializes interests array as JSON', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    await saveProfile(
      validOnboardingData({ interests: ['reading', 'gaming', 'travel'] }),
    )

    const profile = await findProfile(user.id)

    expect(profile!.interests).toBe(
      JSON.stringify(['reading', 'gaming', 'travel']),
    )
  })

  it('serializes goals array as JSON', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    await saveProfile(
      validOnboardingData({ goals: ['weekly-checkins', 'gratitude'] }),
    )

    const profile = await findProfile(user.id)

    expect(profile!.goals).toBe(
      JSON.stringify(['weekly-checkins', 'gratitude']),
    )
  })

  it('trims display name whitespace', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    await saveProfile(validOnboardingData({ displayName: '  Padded Name  ' }))

    const profile = await findProfile(user.id)

    expect(profile!.displayName).toBe('Padded Name')
  })

  it('stores null for empty optional fields', async () => {
    const user = await createTestUser()
    await mockAuthAs(user.id)

    await saveProfile(
      validOnboardingData({ birthday: '', pronouns: '', loveLang: '' }),
    )

    const profile = await findProfile(user.id)

    expect(profile!.birthday).toBeNull()
    expect(profile!.pronouns).toBeNull()
    expect(profile!.loveLang).toBeNull()
  })
})
