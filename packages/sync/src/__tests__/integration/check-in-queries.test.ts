import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestCheckIn,
  createTestCheckInQuestion,
  createTestCheckInResponse,
  createTestPartnership,
  createTestProfile,
  createTestUser,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing queries (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import queries under test (these resolve to the mocked db/auth)
const { getCheckIn, getCheckIns } = await import(
  'src/app/(app)/check-ins/queries'
)

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('check-in queries', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // getCheckIn
  // -----------------------------------------------------------------------

  describe('getCheckIn', () => {
    it('returns check-in with questions and responses for a member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestProfile(alice.id, { displayName: 'Alice' })
      await createTestProfile(bob.id, { displayName: 'Bob' })
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        title: 'Our Check-in',
        status: 'in_progress',
        startedAt: new Date(),
      })
      const q = await createTestCheckInQuestion(ci.id, {
        questionText: 'How are you?',
        orderIndex: 0,
      })
      await createTestCheckInResponse(q.id, alice.id, {
        responseText: 'Great!',
        isDraft: false,
      })
      await mockAuthAs(alice.id)

      const result = await getCheckIn(ci.id)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(ci.id)
      expect(result!.title).toBe('Our Check-in')
      expect(result!.status).toBe('in_progress')
      expect(result!.questions).toHaveLength(1)
      expect(result!.questions[0]!.questionText).toBe('How are you?')
      expect(result!.responses).toHaveLength(1)
      expect(result!.responses[0]!.responseText).toBe('Great!')
    })

    it('only returns current user responses in draft state (privacy)', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestProfile(alice.id, { displayName: 'Alice' })
      await createTestProfile(bob.id, { displayName: 'Bob' })
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const q = await createTestCheckInQuestion(ci.id)
      await createTestCheckInResponse(q.id, alice.id, {
        responseText: 'Alice answer',
        isDraft: true,
      })
      await createTestCheckInResponse(q.id, bob.id, {
        responseText: 'Bob answer',
        isDraft: true,
      })

      // Alice should only see her own response
      await mockAuthAs(alice.id)
      const aliceResult = await getCheckIn(ci.id)
      expect(aliceResult!.responses).toHaveLength(1)
      expect(aliceResult!.responses[0]!.userId).toBe(alice.id)

      // Bob should only see his own response
      await mockAuthAs(bob.id)
      const bobResult = await getCheckIn(ci.id)
      expect(bobResult!.responses).toHaveLength(1)
      expect(bobResult!.responses[0]!.userId).toBe(bob.id)
    })

    it('returns both partners responses in in_progress state', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestProfile(alice.id, { displayName: 'Alice' })
      await createTestProfile(bob.id, { displayName: 'Bob' })
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      const q = await createTestCheckInQuestion(ci.id)
      await createTestCheckInResponse(q.id, alice.id, {
        responseText: 'Alice answer',
        isDraft: false,
      })
      await createTestCheckInResponse(q.id, bob.id, {
        responseText: 'Bob answer',
        isDraft: false,
      })

      await mockAuthAs(alice.id)
      const result = await getCheckIn(ci.id)

      expect(result!.responses).toHaveLength(2)
      const userIds = result!.responses.map(r => r.userId).sort()
      expect(userIds).toEqual([alice.id, bob.id].sort())
    })

    it('includes displayName from profiles on each response', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestProfile(alice.id, { displayName: 'Alice Display' })
      await createTestProfile(bob.id, { displayName: 'Bob Display' })
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      const q = await createTestCheckInQuestion(ci.id)
      await createTestCheckInResponse(q.id, alice.id, {
        responseText: 'Answer',
        isDraft: false,
      })

      await mockAuthAs(alice.id)
      const result = await getCheckIn(ci.id)

      expect(result!.responses[0]!.displayName).toBe('Alice Display')
    })

    it('returns null for a non-member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      await mockAuthAs(outsider.id)

      const result = await getCheckIn(ci.id)

      expect(result).toBeNull()
    })

    it('returns null for unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await getCheckIn('any-id')

      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // getCheckIns
  // -----------------------------------------------------------------------

  describe('getCheckIns', () => {
    it('returns all check-ins for the partnership ordered by most recent', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )

      // Create check-ins with staggered creation times (via insertion order)
      await createTestCheckIn(partnership.id, alice.id, {
        title: 'First Check-in',
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      await createTestCheckIn(partnership.id, alice.id, {
        title: 'Second Check-in',
        status: 'draft',
      })

      await mockAuthAs(alice.id)
      const result = await getCheckIns()

      expect(result).not.toBeNull()
      expect(result).toHaveLength(2)
      // Most recent first — ci2 was inserted after ci1
      expect(result![0]!.title).toBe('Second Check-in')
      expect(result![1]!.title).toBe('First Check-in')
    })

    it('includes questionCount per check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        title: 'With Questions',
      })
      await createTestCheckInQuestion(ci.id, { orderIndex: 0 })
      await createTestCheckInQuestion(ci.id, {
        questionText: 'Q2?',
        orderIndex: 1,
      })
      await createTestCheckInQuestion(ci.id, {
        questionText: 'Q3?',
        orderIndex: 2,
      })

      await mockAuthAs(alice.id)
      const result = await getCheckIns()

      expect(result).toHaveLength(1)
      expect(result![0]!.questionCount).toBe(3)
    })

    it('returns empty array when partnership has no check-ins', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')

      await mockAuthAs(alice.id)
      const result = await getCheckIns()

      expect(result).toEqual([])
    })

    it('returns null for unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await getCheckIns()

      expect(result).toBeNull()
    })

    it('returns null for user without active partnership', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await getCheckIns()

      expect(result).toBeNull()
    })
  })
})
